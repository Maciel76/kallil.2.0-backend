const User = require('../models/User')
const CobrancaPix = require('../models/CobrancaPix')
const { decryptToken } = require('../utils/crypto')
const mp = require('./mercadoPago')

/**
 * Webhook do Mercado Pago, um por lojista.
 *
 * O Mercado Pago chama POST /api/pagamento-loja/webhook/:userId assim que o
 * PIX é pago. A gente confere a assinatura, consulta o pagamento na API (o
 * aviso só traz o ID, nunca o status) e grava o resultado na CobrancaPix.
 *
 * Duas regras que o MP impõe e que moldam este arquivo:
 *  - responder em menos de 22s (na prática, responder JÁ e processar depois);
 *  - qualquer resposta diferente de 2xx faz o MP reenviar o mesmo evento,
 *    então erro nosso responde 200 e erro do remetente responde 401.
 */

/** Aviso do MP é sobre um pagamento? (ele também manda merchant_order etc.) */
function ehEventoDePagamento(corpo, query) {
  const tipo = corpo?.type || corpo?.topic || query?.type || query?.topic || ''
  return tipo === 'payment'
}

/**
 * O ID do pagamento pode vir na query (`data.id` do webhook, `id` do IPN
 * antigo) ou no corpo. Serve para achar a cobrança do nosso lado.
 */
function extrairPagamentoId(corpo, query) {
  return String(
    query?.['data.id'] || query?.id || corpo?.data?.id || corpo?.id || ''
  ).trim()
}

/**
 * O que entra no manifesto da assinatura é especificamente o `data.id` da
 * QUERY STRING — é assim que o Mercado Pago monta o hash do lado dele.
 * Pegar o id do corpo aqui faria toda assinatura válida ser recusada.
 */
function dataIdDaAssinatura(query) {
  return String(query?.['data.id'] || query?.id || '').trim()
}

async function handle(req, res) {
  const { userId } = req.params

  try {
    const dono = await User.findById(userId).select('+mpWebhookSecret +mpAccessToken')
    // Loja inexistente: 200 para o MP parar de reenviar um aviso órfão
    if (!dono) return res.status(200).end()

    const segredo = dono.mpWebhookSecret ? decryptToken(dono.mpWebhookSecret) : ''
    const pagamentoId = extrairPagamentoId(req.body, req.query)

    const conferencia = mp.validarAssinaturaWebhook({
      segredo,
      xSignature: req.headers['x-signature'],
      xRequestId: req.headers['x-request-id'],
      dataId: dataIdDaAssinatura(req.query)
    })

    if (!conferencia.ok) {
      // Sem segredo cadastrado ainda: aceita e processa, senão o lojista que
      // colou só a URL nunca veria o webhook funcionar. Com segredo cadastrado,
      // assinatura errada é recusada.
      if (conferencia.motivo !== 'sem_segredo') {
        await User.updateOne({ _id: userId }, { $inc: { mpWebhookRecusados: 1 } })
        return res.status(401).json({ message: 'Assinatura inválida.' })
      }
    }

    await User.updateOne(
      { _id: userId },
      { $inc: { mpWebhookEventos: 1 }, $set: { mpWebhookUltimoEvento: new Date() } }
    )

    // Responde antes de processar: o MP conta o tempo de resposta
    res.status(200).end()

    if (!ehEventoDePagamento(req.body, req.query) || !pagamentoId) return

    setImmediate(() => {
      processarEvento(userId, pagamentoId).catch((err) => {
        console.error(`[PIX-WEBHOOK] loja ${userId} pagamento ${pagamentoId}:`, err.message)
      })
    })
  } catch (err) {
    // Nunca derruba o servidor nem faz o MP reenviar por erro nosso
    console.error('[PIX-WEBHOOK] erro:', err.message)
    if (!res.headersSent) res.status(200).end()
  }
}

/**
 * Consulta o pagamento no Mercado Pago e atualiza a cobrança local.
 * O aviso do webhook não é confiável como fonte de status — só como gatilho.
 */
async function processarEvento(userId, pagamentoId) {
  const cobranca = await CobrancaPix.findOne({ userId, pagamentoId })
  // Cobrança de outro sistema na mesma conta do MP: não é nossa, ignora
  if (!cobranca) return
  // Já resolvida: nada a fazer (o MP reenvia o mesmo evento várias vezes)
  if (cobranca.status === 'pago') return

  const dono = await User.findById(userId).select('+mpAccessToken')
  const token = dono?.mpAccessToken ? decryptToken(dono.mpAccessToken) : ''
  if (!token) return

  const pagamento = await mp.consultarPagamento({ accessToken: token, pagamentoId })

  cobranca.status = pagamento.status
  cobranca.statusMp = pagamento.statusMp
  cobranca.confirmadoPor = 'webhook'
  if (pagamento.status === 'pago' && !cobranca.pagoEm) cobranca.pagoEm = new Date()
  await cobranca.save()
}

module.exports = { handle, processarEvento, ehEventoDePagamento, extrairPagamentoId, dataIdDaAssinatura }
