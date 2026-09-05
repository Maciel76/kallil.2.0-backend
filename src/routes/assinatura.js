const express = require('express')
const router = express.Router()
const User = require('../models/User')
const PlanoConfig = require('../models/PlanoConfig')
const auth = require('../middleware/auth')
const { authorize } = require('../middleware/auth')
const { sincronizarDespesaAssinatura, removerDespesaAssinatura } = require('../utils/assinaturaDespesa')
const { notifyPlanUpgrade, notifyPlanRenewal } = require('../services/whatsappNotifications')
const { resolverRecursosPlano } = require('../middleware/assinatura')

// =======================================
// ROTAS PÚBLICAS (usuário autenticado)
// =======================================

// GET /api/assinatura/meu-plano — retorna info do plano do usuário logado
router.get('/meu-plano', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' })

    const config = await PlanoConfig.getConfig()
    const agora = new Date()

    // Atualizar status se expirou
    if (user.assinaturaStatus === 'teste' && user.testeExpira && user.testeExpira < agora) {
      user.assinaturaStatus = 'expirado'
      await user.save()
    }
    if (user.plano === 'pago' && user.assinaturaExpira && user.assinaturaExpira < agora) {
      user.assinaturaStatus = 'expirado'
      user.plano = 'gratuito'
      await user.save()
      await removerDespesaAssinatura(user._id)
    }

    // Plano do catálogo contratado — define os limites quando existir
    const planoContratado = user.planoSlug
      ? config.planos.find(p => p.slug === user.planoSlug)
      : null

    const limitesPagos = planoContratado
      ? {
          maxProdutos: planoContratado.limites.maxProdutos,
          maxVendasMes: planoContratado.limites.maxVendasMes,
          maxOperadores: planoContratado.limites.maxOperadores,
          maxCaixas: planoContratado.limites.maxCaixas,
          maxClientes: planoContratado.limites.maxClientes,
          relatoriosAvancados: planoContratado.recursos.relatoriosAvancados,
          personalizacaoPDV: planoContratado.recursos.personalizacaoPDV,
          suportePrioritario: planoContratado.recursos.suportePrioritario
        }
      : config.pago

    // WhatsApp ativo → limites do plano pago (superior)
    const whatsappAtivoAgora = !!(user.planoWhatsapp && user.whatsappAssinaturaExpira && user.whatsappAssinaturaExpira > agora)
    const limites = whatsappAtivoAgora || (user.plano === 'pago' && user.assinaturaStatus === 'ativo')
      ? limitesPagos
      : (user.assinaturaStatus === 'teste' && user.testeExpira > agora ? limitesPagos : config.gratuito)

    // Verifica e desativa plano whatsapp se expirado
    if (user.planoWhatsapp && user.whatsappAssinaturaExpira && user.whatsappAssinaturaExpira < agora) {
      user.planoWhatsapp = false
      await user.save()
    }

    // Operadores herdam o plano do dono
    const donoDoPlano = user.role === 'operador' && user.donoId
      ? (await User.findById(user.donoId)) || user
      : user
    const recursosPlano = await resolverRecursosPlano(donoDoPlano)

    res.json({
      plano: user.plano,
      planoSlug: user.planoSlug || (user.plano === 'pago' ? 'pago' : 'gratuito'),
      planoNome: planoContratado ? planoContratado.nome : config.pago.nome,
      status: user.assinaturaStatus,
      assinaturaInicio: user.assinaturaInicio,
      assinaturaExpira: user.assinaturaExpira,
      testeExpira: user.testeExpira,
      planoWhatsapp: user.planoWhatsapp,
      whatsappAssinaturaInicio: user.whatsappAssinaturaInicio,
      whatsappAssinaturaExpira: user.whatsappAssinaturaExpira,
      limites: {
        maxProdutos: limites.maxProdutos,
        maxVendasMes: limites.maxVendasMes,
        maxOperadores: limites.maxOperadores,
        maxCaixas: limites.maxCaixas,
        maxClientes: limites.maxClientes,
        relatoriosAvancados: limites.relatoriosAvancados,
        personalizacaoPDV: limites.personalizacaoPDV,
        suportePrioritario: limites.suportePrioritario
      },
      planoProf: {
        nome: config.pago.nome,
        valorMensal: config.pago.valorMensal,
        ativo: (config.planos.find(p => p.slug === 'pago') || {}).ativo !== false
      },
      planoWhatsappInfo: {
        nome: config.whatsapp?.nome || 'Automação WhatsApp',
        valorMensal: config.whatsapp?.valorMensal || 89.90,
        ativo: config.whatsapp?.ativo !== false
      },
      // Recursos liberados pelo plano contratado somados aos add-ons ativos
      recursos: recursosPlano,
      planosDisponiveis: config.planos.filter(p => p.ativo).sort((a, b) => a.ordem - b.ordem)
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar plano.' })
  }
})

// =======================================
// ROTAS DE ADMIN
// =======================================

// GET /api/assinatura/config — retorna configuração dos planos (admin)
router.get('/config', auth, authorize('admin'), async (req, res) => {
  try {
    const config = await PlanoConfig.getConfig()
    res.json(config)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar configuração.' })
  }
})

// PUT /api/assinatura/config — atualizar configuração dos planos (admin)
router.put('/config', auth, authorize('admin'), async (req, res) => {
  try {
    const config = await PlanoConfig.getConfig()
    const { gratuito, pago, whatsapp, diasTeste } = req.body

    if (gratuito) {
      if (gratuito.maxProdutos !== undefined) config.gratuito.maxProdutos = gratuito.maxProdutos
      if (gratuito.maxVendasMes !== undefined) config.gratuito.maxVendasMes = gratuito.maxVendasMes
      if (gratuito.maxOperadores !== undefined) config.gratuito.maxOperadores = gratuito.maxOperadores
      if (gratuito.maxClientes !== undefined) config.gratuito.maxClientes = gratuito.maxClientes
      if (gratuito.maxCaixas !== undefined) config.gratuito.maxCaixas = gratuito.maxCaixas
      if (gratuito.relatoriosAvancados !== undefined) config.gratuito.relatoriosAvancados = gratuito.relatoriosAvancados
      if (gratuito.personalizacaoPDV !== undefined) config.gratuito.personalizacaoPDV = gratuito.personalizacaoPDV
      if (gratuito.suportePrioritario !== undefined) config.gratuito.suportePrioritario = gratuito.suportePrioritario
    }

    if (pago) {
      if (pago.nome !== undefined) config.pago.nome = pago.nome
      if (pago.valorMensal !== undefined) config.pago.valorMensal = pago.valorMensal
      if (pago.maxProdutos !== undefined) config.pago.maxProdutos = pago.maxProdutos
      if (pago.maxVendasMes !== undefined) config.pago.maxVendasMes = pago.maxVendasMes
      if (pago.maxOperadores !== undefined) config.pago.maxOperadores = pago.maxOperadores
      if (pago.maxClientes !== undefined) config.pago.maxClientes = pago.maxClientes
      if (pago.maxCaixas !== undefined) config.pago.maxCaixas = pago.maxCaixas
      if (pago.relatoriosAvancados !== undefined) config.pago.relatoriosAvancados = pago.relatoriosAvancados
      if (pago.personalizacaoPDV !== undefined) config.pago.personalizacaoPDV = pago.personalizacaoPDV
      if (pago.suportePrioritario !== undefined) config.pago.suportePrioritario = pago.suportePrioritario
    }

    if (diasTeste !== undefined) config.diasTeste = diasTeste

    if (whatsapp) {
      if (!config.whatsapp) config.whatsapp = {}
      if (whatsapp.nome !== undefined) config.whatsapp.nome = whatsapp.nome
      if (whatsapp.valorMensal !== undefined) config.whatsapp.valorMensal = whatsapp.valorMensal
      if (whatsapp.ativo !== undefined) config.whatsapp.ativo = whatsapp.ativo
      if (whatsapp.workflows !== undefined) config.whatsapp.workflows = whatsapp.workflows
      if (whatsapp.cobrancaAutomatica !== undefined) config.whatsapp.cobrancaAutomatica = whatsapp.cobrancaAutomatica
      if (whatsapp.enviarCupom !== undefined) config.whatsapp.enviarCupom = whatsapp.enviarCupom
      if (whatsapp.resumoDiario !== undefined) config.whatsapp.resumoDiario = whatsapp.resumoDiario
      if (whatsapp.importacaoIlimitada !== undefined) config.whatsapp.importacaoIlimitada = whatsapp.importacaoIlimitada
      if (whatsapp.cobrarClientes !== undefined) config.whatsapp.cobrarClientes = whatsapp.cobrarClientes
    }

    PlanoConfig.sincronizarCatalogo(config)
    await config.save()
    res.json(config)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar configuração.' })
  }
})


// =======================================
// CATÁLOGO DE PLANOS (admin)
// =======================================

const CAMPOS_LIMITES = ['maxProdutos', 'maxVendasMes', 'maxOperadores', 'maxClientes', 'maxCaixas']
const CAMPOS_RECURSOS = ['relatoriosAvancados', 'personalizacaoPDV', 'suportePrioritario', 'automacaoWhatsapp', 'pagamentoPix']

const gerarSlug = (texto) => String(texto || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const aplicarDadosPlano = (plano, body) => {
  if (body.nome !== undefined) plano.nome = String(body.nome).trim()
  if (body.descricao !== undefined) plano.descricao = String(body.descricao).trim()
  if (body.tipo !== undefined && ['base', 'addon'].includes(body.tipo)) plano.tipo = body.tipo
  if (body.valorMensal !== undefined) plano.valorMensal = Math.max(0, Number(body.valorMensal) || 0)
  if (body.valorAnual !== undefined) plano.valorAnual = Math.max(0, Number(body.valorAnual) || 0)
  if (body.destaque !== undefined) plano.destaque = !!body.destaque
  if (body.ativo !== undefined) plano.ativo = !!body.ativo
  if (body.cor !== undefined) plano.cor = body.cor
  if (body.icone !== undefined) plano.icone = body.icone
  if (body.ordem !== undefined) plano.ordem = Number(body.ordem) || 0
  if (Array.isArray(body.beneficios)) {
    plano.beneficios = body.beneficios.map(b => String(b).trim()).filter(Boolean)
  }
  if (body.limites) {
    CAMPOS_LIMITES.forEach(campo => {
      if (body.limites[campo] !== undefined) {
        plano.limites[campo] = Math.max(0, Number(body.limites[campo]) || 0)
      }
    })
  }
  if (body.recursos) {
    CAMPOS_RECURSOS.forEach(campo => {
      if (body.recursos[campo] !== undefined) plano.recursos[campo] = !!body.recursos[campo]
    })
  }
}

// GET /api/assinatura/planos — planos ativos do catálogo (qualquer usuário autenticado)
router.get('/planos', auth, async (req, res) => {
  try {
    const config = await PlanoConfig.getConfig()
    const planos = config.planos
      .filter(p => p.ativo)
      .sort((a, b) => a.ordem - b.ordem)
    res.json({ planos, diasTeste: config.diasTeste })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar planos.' })
  }
})

// POST /api/assinatura/config/planos — criar plano (admin)
router.post('/config/planos', auth, authorize('admin'), async (req, res) => {
  try {
    const nome = String(req.body.nome || '').trim()
    if (!nome) return res.status(400).json({ message: 'Informe o nome do plano.' })

    const config = await PlanoConfig.getConfig()
    const slugBase = gerarSlug(req.body.slug || nome) || 'plano'
    let slug = slugBase
    let contador = 2
    while (config.planos.some(p => p.slug === slug)) {
      slug = `${slugBase}-${contador++}`
    }

    const maiorOrdem = config.planos.reduce((max, p) => Math.max(max, p.ordem || 0), -1)
    const plano = config.planos.create({
      slug,
      nome,
      ordem: maiorOrdem + 1,
      ativo: req.body.ativo !== undefined ? !!req.body.ativo : true,
      sistema: false
    })
    aplicarDadosPlano(plano, req.body)
    plano.slug = slug
    plano.sistema = false
    config.planos.push(plano)

    await config.save()
    res.status(201).json(plano)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar plano.' })
  }
})

// PUT /api/assinatura/config/planos/:planoId — atualizar plano (admin)
router.put('/config/planos/:planoId', auth, authorize('admin'), async (req, res) => {
  try {
    const config = await PlanoConfig.getConfig()
    const plano = config.planos.id(req.params.planoId)
    if (!plano) return res.status(404).json({ message: 'Plano não encontrado.' })

    if (req.body.nome !== undefined && !String(req.body.nome).trim()) {
      return res.status(400).json({ message: 'Informe o nome do plano.' })
    }

    aplicarDadosPlano(plano, req.body)
    PlanoConfig.sincronizarLegado(config, plano)

    await config.save()
    res.json(plano)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar plano.' })
  }
})

// PATCH /api/assinatura/config/planos/:planoId/ativo — ativar/desativar plano (admin)
router.patch('/config/planos/:planoId/ativo', auth, authorize('admin'), async (req, res) => {
  try {
    const config = await PlanoConfig.getConfig()
    const plano = config.planos.id(req.params.planoId)
    if (!plano) return res.status(404).json({ message: 'Plano não encontrado.' })

    plano.ativo = req.body.ativo !== undefined ? !!req.body.ativo : !plano.ativo
    PlanoConfig.sincronizarLegado(config, plano)

    await config.save()
    res.json(plano)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao alterar status do plano.' })
  }
})

// DELETE /api/assinatura/config/planos/:planoId — excluir plano (admin)
router.delete('/config/planos/:planoId', auth, authorize('admin'), async (req, res) => {
  try {
    const config = await PlanoConfig.getConfig()
    const plano = config.planos.id(req.params.planoId)
    if (!plano) return res.status(404).json({ message: 'Plano não encontrado.' })
    if (plano.sistema) {
      return res.status(400).json({ message: 'Planos do sistema não podem ser excluídos — desative-o.' })
    }

    plano.deleteOne()
    await config.save()
    res.json({ message: 'Plano excluído.' })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao excluir plano.' })
  }
})

// GET /api/assinatura/admin/resumo — estatísticas de assinaturas (admin)
router.get('/admin/resumo', auth, authorize('admin'), async (req, res) => {
  try {
    const [totalDonos, emTeste, gratuitos, pagos, expirados, cancelados] = await Promise.all([
      User.countDocuments({ role: 'dono' }),
      User.countDocuments({ role: 'dono', assinaturaStatus: 'teste' }),
      User.countDocuments({ role: 'dono', plano: 'gratuito', assinaturaStatus: { $ne: 'teste' } }),
      User.countDocuments({ role: 'dono', plano: 'pago', assinaturaStatus: 'ativo' }),
      User.countDocuments({ role: 'dono', assinaturaStatus: 'expirado' }),
      User.countDocuments({ role: 'dono', assinaturaStatus: 'cancelado' })
    ])

    const config = await PlanoConfig.getConfig()
    const receitaMensal = pagos * config.pago.valorMensal

    res.json({
      totalDonos,
      emTeste,
      gratuitos,
      pagos,
      expirados,
      cancelados,
      receitaMensal,
      valorMensal: config.pago.valorMensal
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar resumo.' })
  }
})

// GET /api/assinatura/admin/usuarios — listar usuários com info de assinatura (admin)
router.get('/admin/usuarios', auth, authorize('admin'), async (req, res) => {
  try {
    const { busca, plano, status, excluirTeste, page = 1, limit = 20 } = req.query
    const filtro = { role: 'dono' }

    if (plano && ['gratuito', 'pago'].includes(plano)) filtro.plano = plano
    if (status && ['ativo', 'teste', 'expirado', 'cancelado'].includes(status)) filtro.assinaturaStatus = status
    // Usado pelo card "Plano gratuito" do painel admin, que nao conta quem esta em teste
    else if (excluirTeste === '1' || excluirTeste === 'true') filtro.assinaturaStatus = { $ne: 'teste' }

    if (busca) {
      const escapedBusca = busca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filtro.$or = [
        { nome: { $regex: escapedBusca, $options: 'i' } },
        { nomeNegocio: { $regex: escapedBusca, $options: 'i' } },
        { email: { $regex: escapedBusca, $options: 'i' } }
      ]
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const total = await User.countDocuments(filtro)
    const usuarios = await User.find(filtro)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))

    const lista = usuarios.map(u => ({
      id: u._id,
      nome: u.nome,
      email: u.email,
      nomeNegocio: u.nomeNegocio,
      plano: u.plano,
      planoSlug: u.planoSlug,
      assinaturaStatus: u.assinaturaStatus,
      assinaturaInicio: u.assinaturaInicio,
      assinaturaExpira: u.assinaturaExpira,
      testeExpira: u.testeExpira,
      planoWhatsapp: u.planoWhatsapp,
      whatsappAssinaturaExpira: u.whatsappAssinaturaExpira,
      ativo: u.ativo,
      createdAt: u.createdAt
    }))

    res.json({ usuarios: lista, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar assinaturas.' })
  }
})

// PATCH /api/assinatura/admin/usuarios/:id — alterar plano de um usuário (admin)
router.patch('/admin/usuarios/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user || user.role !== 'dono') {
      return res.status(404).json({ message: 'Usuário não encontrado.' })
    }

    const { plano, planoSlug, meses } = req.body

    const config = await PlanoConfig.getConfig()
    // Plano escolhido no catálogo da aba "Planos e Preços" (admin)
    let planoCatalogo = null
    if (plano === 'pago' && planoSlug) {
      planoCatalogo = (config.planos || []).find(
        p => p.slug === planoSlug && p.tipo === 'base' && p.slug !== 'gratuito'
      )
      if (!planoCatalogo) {
        return res.status(400).json({ message: 'Plano não encontrado no catálogo.' })
      }
      if (!planoCatalogo.ativo) {
        return res.status(400).json({ message: 'Este plano está desativado no catálogo.' })
      }
    }

    if (plano === 'pago') {
      const duracao = parseInt(meses) || 1
      user.plano = 'pago'
      user.planoSlug = planoCatalogo ? planoCatalogo.slug : ''
      user.assinaturaStatus = 'ativo'
      user.assinaturaInicio = new Date()
      user.assinaturaExpira = new Date(Date.now() + duracao * 30 * 24 * 60 * 60 * 1000)
    } else if (plano === 'gratuito') {
      user.plano = 'gratuito'
      user.planoSlug = ''
      user.assinaturaStatus = 'expirado'
      user.assinaturaExpira = null
      user.assinaturaInicio = null
    }

    await user.save()

    if (plano === 'pago') {
      await sincronizarDespesaAssinatura(user._id, {
        nomePlano: planoCatalogo ? planoCatalogo.nome : config.pago.nome,
        valorMensal: planoCatalogo ? planoCatalogo.valorMensal : config.pago.valorMensal,
        dataReferencia: new Date()
      })
    } else {
      await removerDespesaAssinatura(user._id)
    }

    res.json({
      id: user._id,
      plano: user.plano,
      assinaturaStatus: user.assinaturaStatus,
      assinaturaInicio: user.assinaturaInicio,
      assinaturaExpira: user.assinaturaExpira
    })

    // Notifica admin via WhatsApp sobre alteração de plano
    if (plano === 'pago') {
      try {
        const whatsappRoutes = require('./whatsapp')
        const getActiveSessions = whatsappRoutes.getActiveSessions
        notifyPlanUpgrade({
          nome: user.nome,
          email: user.email,
          nomeNegocio: user.nomeNegocio,
          meses: parseInt(meses) || 1,
          assinaturaExpira: user.assinaturaExpira
        }, getActiveSessions)
      } catch (e) {
        console.error('[WA-Notify] Erro ao notificar upgrade de plano:', e.message)
      }
    }
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar assinatura.' })
  }
})

// PATCH /api/assinatura/admin/usuarios/:id/renovar — renovar assinatura (admin)
router.patch('/admin/usuarios/:id/renovar', auth, authorize('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user || user.role !== 'dono') {
      return res.status(404).json({ message: 'Usuário não encontrado.' })
    }

    const { meses } = req.body
    const duracao = parseInt(meses) || 1

    // Se já tem data de expiração futura, estender a partir dela
    const base = user.assinaturaExpira && user.assinaturaExpira > new Date()
      ? user.assinaturaExpira
      : new Date()

    user.plano = 'pago'
    user.assinaturaStatus = 'ativo'
    if (!user.assinaturaInicio) user.assinaturaInicio = new Date()
    user.assinaturaExpira = new Date(base.getTime() + duracao * 30 * 24 * 60 * 60 * 1000)

    await user.save()

    const config = await PlanoConfig.getConfig()
    // Cobra pelo plano do catálogo que o usuário tem, com fallback no plano legado
    const planoAtual = user.planoSlug
      ? (config.planos || []).find(p => p.slug === user.planoSlug)
      : null
    await sincronizarDespesaAssinatura(user._id, {
      nomePlano: planoAtual ? planoAtual.nome : config.pago.nome,
      valorMensal: planoAtual ? planoAtual.valorMensal : config.pago.valorMensal,
      dataReferencia: new Date()
    })

    res.json({
      id: user._id,
      plano: user.plano,
      assinaturaStatus: user.assinaturaStatus,
      assinaturaInicio: user.assinaturaInicio,
      assinaturaExpira: user.assinaturaExpira
    })

    // Notifica admin via WhatsApp sobre renovação de plano
    try {
      const whatsappRoutes = require('./whatsapp')
      const getActiveSessions = whatsappRoutes.getActiveSessions
      notifyPlanRenewal({
        nome: user.nome,
        email: user.email,
        nomeNegocio: user.nomeNegocio,
        meses: duracao,
        assinaturaExpira: user.assinaturaExpira
      }, getActiveSessions)
    } catch (e) {
      console.error('[WA-Notify] Erro ao notificar renovação de plano:', e.message)
    }
  } catch (error) {
    res.status(500).json({ message: 'Erro ao renovar assinatura.' })
  }
})

// PATCH /api/assinatura/admin/usuarios/:id/whatsapp — conceder/renovar/revogar add-on WhatsApp (admin)
router.patch('/admin/usuarios/:id/whatsapp', auth, authorize('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user || user.role !== 'dono') {
      return res.status(404).json({ message: 'Usuário não encontrado.' })
    }

    const { acao, meses } = req.body  // acao: 'conceder' | 'revogar' | 'renovar'

    if (acao === 'revogar') {
      user.planoWhatsapp = false
      user.whatsappAssinaturaExpira = null
      user.whatsappAssinaturaInicio = null
    } else {
      const duracao = parseInt(meses) || 1
      const base = (acao === 'renovar' && user.whatsappAssinaturaExpira && user.whatsappAssinaturaExpira > new Date())
        ? user.whatsappAssinaturaExpira
        : new Date()
      user.planoWhatsapp = true
      if (!user.whatsappAssinaturaInicio) user.whatsappAssinaturaInicio = new Date()
      user.whatsappAssinaturaExpira = new Date(base.getTime() + duracao * 30 * 24 * 60 * 60 * 1000)
    }

    await user.save()

    res.json({
      id: user._id,
      planoWhatsapp: user.planoWhatsapp,
      whatsappAssinaturaInicio: user.whatsappAssinaturaInicio,
      whatsappAssinaturaExpira: user.whatsappAssinaturaExpira
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar plano WhatsApp.' })
  }
})

module.exports = router
