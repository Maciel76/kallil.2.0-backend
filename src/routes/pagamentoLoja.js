const express = require('express')
const router = express.Router()
const crypto = require('crypto')

const User = require('../models/User')
const CobrancaPix = require('../models/CobrancaPix')
const auth = require('../middleware/auth')
const { authorize } = require('../middleware/auth')
const { encryptToken, decryptToken, maskToken, podeDecifrar } = require('../utils/crypto')
const mp = require('../services/mercadoPago')
const tokenCache = require('../services/mpTokenCache')
const pixWebhook = require('../services/pixWebhook')
const { montarUrlWebhook, basePublica } = require('../utils/webhookUrl')

// =============================================
// POST /api/pagamento-loja/webhook/:userId — aviso do Mercado Pago
// =============================================
// Rota PÚBLICA: quem chama é o Mercado Pago, que não tem token do Kallil.
// Precisa vir antes do router.use(auth) — depois dele, toda chamada do MP
// seria recusada com 401 e o MP desativaria o webhook por falta de resposta.
router.post('/webhook/:userId', pixWebhook.handle)

router.use(auth)

// Quanto tempo o QR Code fica válido. Curto de propósito: no balcão, um PIX
// que não foi pago em meia hora é uma venda que não aconteceu.
const MINUTOS_EXPIRACAO = 30

/** Produção (APP_USR-) x teste (TEST-) — só para mostrar na tela. */
const ambienteDoToken = (token) => {
  if (!token) return ''
  return token.startsWith('TEST-') ? 'teste' : 'producao'
}

/**
 * Estado da integração como a tela de Pagamento espera receber.
 * Nunca devolve o token inteiro — só o mascarado.
 */
const montarEstado = (user) => {
  const guardado = user.mpAccessToken || ''
  const legivel = guardado ? decryptToken(guardado) : ''
  const segredo = user.mpWebhookSecret || ''
  return {
    configurado: !!guardado,
    // Token guardado mas ilegível: a chave de cifra mudou. A tela precisa
    // pedir o token de novo em vez de fingir que está tudo certo.
    credenciaisQuebradas: !!guardado && !podeDecifrar(guardado),
    ativo: !!user.mpAtivo,
    conta: user.mpConta || '',
    ambiente: ambienteDoToken(legivel),
    tokenMascarado: maskToken(legivel),
    atualizadoEm: user.mpAtualizadoEm || null,
    publicKey: user.mpPublicKey || '',
    publicKeyAmbiente: ambienteDoToken(user.mpPublicKey || ''),
    webhook: {
      url: montarUrlWebhook(user._id),
      // URL local não é alcançável pelo Mercado Pago — avisar antes de o
      // lojista colar no painel e ficar esperando um aviso que nunca vem
      urlPublica: basePublica(),
      segredoConfigurado: !!segredo,
      segredoQuebrado: !!segredo && !podeDecifrar(segredo),
      eventos: user.mpWebhookEventos || 0,
      recusados: user.mpWebhookRecusados || 0,
      ultimoEvento: user.mpWebhookUltimoEvento || null
    }
  }
}

/** Erro do MP vira mensagem de tela + status HTTP coerente. */
const responderErroMp = (res, erro, fallback) => {
  const status = erro?.mpStatus
  if (status === 401 || status === 403) {
    return res.status(400).json({
      message: 'O Mercado Pago recusou suas credenciais. Gere um novo Access Token e cadastre de novo.'
    })
  }
  if (status === 404) {
    return res.status(404).json({ message: 'Cobrança não encontrada no Mercado Pago.' })
  }
  if (status && status >= 400 && status < 500) {
    return res.status(400).json({ message: erro.message || fallback })
  }
  return res.status(502).json({ message: fallback, detalhe: erro?.message || '' })
}

/** Carrega o token ativo do dono (operador cobra na conta do dono). */
const credenciaisAtivas = async (userId) => tokenCache.getTokenDoLojista(userId)

// =============================================
// GET /api/pagamento-loja/config — estado da integração
// =============================================
router.get('/config', async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .select('+mpAccessToken +mpWebhookSecret')
      .lean()
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' })

    res.json(montarEstado(user))
  } catch (error) {
    res.status(500).json({ message: 'Erro ao carregar configuração de pagamento.' })
  }
})

// =============================================
// PUT /api/pagamento-loja/config — salvar credenciais / ligar e desligar
// =============================================
router.put('/config', authorize('dono'), async (req, res) => {
  try {
    const { accessToken, ativo, publicKey, webhookSecret } = req.body

    const user = await User.findById(req.userId).select('+mpAccessToken +mpWebhookSecret')
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' })

    // --- Public Key: pública por natureza, guardada em texto puro ---
    // Vazio significa "apagar": é o jeito de o lojista tirar uma chave errada.
    if (publicKey !== undefined) {
      const chave = String(publicKey || '').trim()
      if (chave && !/^(APP_USR|TEST)-/.test(chave)) {
        return res.status(400).json({
          message: 'Public Key inválida. Ela começa com APP_USR- (produção) ou TEST- (teste).'
        })
      }
      user.mpPublicKey = chave
    }

    // --- Assinatura secreta do webhook (quem gera é o Mercado Pago) ---
    if (webhookSecret !== undefined) {
      const segredo = String(webhookSecret || '').trim()
      user.mpWebhookSecret = segredo ? encryptToken(segredo) : ''
      // Contadores viram lixo quando a assinatura muda: recomeçam do zero
      user.mpWebhookEventos = 0
      user.mpWebhookRecusados = 0
      user.mpWebhookUltimoEvento = null
    }

    // --- Sem token novo: só interruptor e/ou os campos acima ---
    if (accessToken === undefined) {
      if (ativo !== undefined) {
        if (ativo && !user.mpAccessToken) {
          return res.status(400).json({ message: 'Cadastre o Access Token antes de ativar o PIX.' })
        }
        if (ativo && !podeDecifrar(user.mpAccessToken)) {
          return res.status(400).json({
            message: 'As credenciais salvas não podem mais ser lidas por este servidor. Cadastre o Access Token novamente.'
          })
        }
        user.mpAtivo = !!ativo
      }
      await user.save()
      tokenCache.invalidar(req.userId)
      return res.json(montarEstado(user))
    }

    // --- Cadastro/troca do token ---
    const token = String(accessToken || '').trim()
    if (!token) {
      return res.status(400).json({ message: 'Informe o Access Token do Mercado Pago.' })
    }
    if (!/^(APP_USR|TEST)-/.test(token)) {
      return res.status(400).json({
        message: 'Token inválido. O Access Token do Mercado Pago começa com APP_USR- (produção) ou TEST- (teste).'
      })
    }

    // Confere no Mercado Pago antes de guardar: token que não cobra não entra
    let conta
    try {
      conta = await mp.validarCredenciais(token)
    } catch (erro) {
      if (erro?.mpStatus === 401 || erro?.mpStatus === 403) {
        return res.status(400).json({
          message: 'O Mercado Pago recusou esse token. Confira se copiou o Access Token completo da sua aplicação.'
        })
      }
      return res.status(502).json({ message: 'Não foi possível falar com o Mercado Pago agora. Tente de novo.' })
    }

    user.mpAccessToken = encryptToken(token)
    user.mpConta = conta.email || conta.apelido || ''
    user.mpAtivo = ativo === undefined ? true : !!ativo
    user.mpAtualizadoEm = new Date()
    await user.save()
    tokenCache.invalidar(req.userId)

    res.json(montarEstado(user))
  } catch (error) {
    res.status(500).json({ message: 'Erro ao salvar configuração de pagamento.' })
  }
})

// =============================================
// POST /api/pagamento-loja/config/testar — conferir a conexão sem salvar nada
// =============================================
router.post('/config/testar', authorize('dono'), async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('+mpAccessToken').lean()
    const token = user?.mpAccessToken ? decryptToken(user.mpAccessToken) : ''
    if (!token) {
      return res.status(400).json({ message: 'Nenhuma credencial cadastrada para testar.' })
    }

    const conta = await mp.validarCredenciais(token)
    res.json({
      ok: true,
      conta: conta.email || conta.apelido || '',
      ambiente: ambienteDoToken(token),
      message: 'Conexão com o Mercado Pago funcionando.'
    })
  } catch (erro) {
    responderErroMp(res, erro, 'Não foi possível falar com o Mercado Pago agora.')
  }
})

// =============================================
// DELETE /api/pagamento-loja/config — remover credenciais
// =============================================
router.delete('/config', authorize('dono'), async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('+mpAccessToken +mpWebhookSecret')
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' })

    user.mpAccessToken = ''
    user.mpConta = ''
    user.mpAtivo = false
    user.mpAtualizadoEm = null
    user.mpPublicKey = ''
    user.mpWebhookSecret = ''
    await user.save()
    tokenCache.invalidar(req.userId)

    res.json(montarEstado(user))
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover configuração de pagamento.' })
  }
})

// =============================================
// POST /api/pagamento-loja/pix — cobrar uma venda por PIX
// =============================================
router.post('/pix', async (req, res) => {
  try {
    const valor = Number(req.body.valor)
    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ message: 'Valor inválido para cobrança.' })
    }
    if (valor < 0.01) {
      return res.status(400).json({ message: 'O valor mínimo de uma cobrança PIX é R$ 0,01.' })
    }

    const credenciais = await credenciaisAtivas(req.userId)
    if (!credenciais) {
      return res.status(400).json({
        message: 'PIX automático não está configurado. Cadastre o Mercado Pago em Pagamento.'
      })
    }

    // A referência vem do PDV e serve de chave de idempotência: dois cliques
    // no mesmo botão devolvem a MESMA cobrança em vez de criar duas.
    const referencia = String(req.body.referencia || '').trim().slice(0, 60) || crypto.randomUUID()

    const cobranca = await mp.criarPix({
      accessToken: credenciais.token,
      valor,
      descricao: String(req.body.descricao || 'Venda no PDV').slice(0, 120),
      referenciaExterna: referencia,
      minutosParaExpirar: MINUTOS_EXPIRACAO,
      idempotencyKey: `kallil-pdv-${referencia}`,
      metadata: { origem: 'kallil-pdv', loja: String(req.userId), operador: String(req.userRealId || '') }
    })

    if (!cobranca.qrCode) {
      if (cobranca.statusMp === 'rejected') {
        return res.status(400).json({
          message: 'O Mercado Pago recusou a cobrança. Verifique se sua conta está habilitada para receber PIX.'
        })
      }
      return res.status(502).json({
        message: 'A cobrança foi criada mas o Mercado Pago não devolveu o QR Code. Tente de novo.'
      })
    }

    // Registro local: é onde o webhook do Mercado Pago escreve quando o
    // pagamento cai, e o que sobra de comprovante se a tela for fechada.
    // Falhar aqui não pode derrubar a venda — o QR Code já existe.
    try {
      await CobrancaPix.updateOne(
        { userId: req.userId, pagamentoId: cobranca.pagamentoId },
        {
          $set: {
            operadorId: req.userRealId || null,
            referencia,
            valor: cobranca.valor,
            descricao: String(req.body.descricao || 'Venda no PDV').slice(0, 120),
            status: cobranca.status,
            statusMp: cobranca.statusMp,
            expiraEm: cobranca.expiraEm ? new Date(cobranca.expiraEm) : null
          }
        },
        { upsert: true }
      )
    } catch (err) {
      console.error('[PIX] não foi possível registrar a cobrança:', err.message)
    }

    res.json({
      pagamentoId: cobranca.pagamentoId,
      referencia,
      status: cobranca.status,
      qrCode: cobranca.qrCode,
      qrCodeBase64: cobranca.qrCodeBase64,
      ticketUrl: cobranca.ticketUrl,
      valor: cobranca.valor,
      expiraEm: cobranca.expiraEm
    })
  } catch (erro) {
    responderErroMp(res, erro, 'Erro ao gerar o PIX da venda.')
  }
})

// =============================================
// GET /api/pagamento-loja/pix/:id — conferir se caiu
// =============================================
router.get('/pix/:id', async (req, res) => {
  try {
    // Se o webhook já avisou que caiu, a resposta sai daqui — sem ida ao
    // Mercado Pago. É o que torna a confirmação no PDV quase instantânea.
    const local = await CobrancaPix.findOne({ userId: req.userId, pagamentoId: req.params.id }).lean()
    if (local && local.status === 'pago') {
      return res.json({
        pagamentoId: local.pagamentoId,
        status: 'pago',
        pago: true,
        encerrado: false,
        detalhe: '',
        valor: local.valor,
        expiraEm: local.expiraEm,
        via: local.confirmadoPor || 'consulta'
      })
    }

    const credenciais = await credenciaisAtivas(req.userId)
    if (!credenciais) return res.status(400).json({ message: 'PIX automático não está configurado.' })

    const cobranca = await mp.consultarPagamento({
      accessToken: credenciais.token,
      pagamentoId: req.params.id
    })

    // Mantém o registro local em dia mesmo se o webhook não estiver configurado
    if (local && local.status !== cobranca.status) {
      await CobrancaPix.updateOne(
        { _id: local._id },
        {
          $set: {
            status: cobranca.status,
            statusMp: cobranca.statusMp,
            confirmadoPor: 'consulta',
            ...(cobranca.status === 'pago' && !local.pagoEm ? { pagoEm: new Date() } : {})
          }
        }
      ).catch(() => {})
    }

    res.json({
      pagamentoId: cobranca.pagamentoId,
      status: cobranca.status,
      pago: cobranca.status === 'pago',
      // Estados terminais: o PDV para de consultar e avisa o operador
      encerrado: ['recusado', 'cancelado', 'devolvido'].includes(cobranca.status),
      detalhe: cobranca.detalheStatus,
      valor: cobranca.valor,
      expiraEm: cobranca.expiraEm,
      via: 'consulta'
    })
  } catch (erro) {
    responderErroMp(res, erro, 'Erro ao consultar o pagamento.')
  }
})

// =============================================
// POST /api/pagamento-loja/pix/:id/cancelar — desistir da cobrança
// =============================================
router.post('/pix/:id/cancelar', async (req, res) => {
  try {
    const credenciais = await credenciaisAtivas(req.userId)
    if (!credenciais) return res.status(400).json({ message: 'PIX automático não está configurado.' })

    const cobranca = await mp.cancelarPagamento({
      accessToken: credenciais.token,
      pagamentoId: req.params.id
    })

    await CobrancaPix.updateOne(
      { userId: req.userId, pagamentoId: req.params.id },
      { $set: { status: cobranca.status, statusMp: cobranca.statusMp, confirmadoPor: 'consulta' } }
    ).catch(() => {})

    res.json({ pagamentoId: cobranca.pagamentoId, status: cobranca.status, cancelado: cobranca.status === 'cancelado' })
  } catch (erro) {
    // Cobrança já paga/expirada não cancela — e não é problema do operador
    if (erro?.mpStatus === 400) {
      return res.json({ cancelado: false, message: 'A cobrança não pôde ser cancelada (já foi paga ou expirou).' })
    }
    responderErroMp(res, erro, 'Erro ao cancelar a cobrança.')
  }
})

module.exports = router
