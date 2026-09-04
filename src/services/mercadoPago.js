/**
 * Integração com o Mercado Pago — Checkout Transparente (API /v1/payments).
 *
 * O pagamento nunca sai do Kallil: geramos o QR Code do PIX aqui e o PDV
 * mostra na tela. Cada lojista usa o Access Token da própria conta, então
 * o dinheiro cai direto na conta dele.
 *
 * Docs: https://www.mercadopago.com.br/developers/pt/reference/payments/_payments/post
 */

const nodeCrypto = require('crypto')

const MP_API = 'https://api.mercadopago.com'
const TENTATIVAS = 2 // além da primeira: total de 3 chamadas no pior caso

/**
 * Chamada REST ao Mercado Pago com retry em falha transitória (5xx / 429).
 * Erros de negócio (4xx) sobem na hora, com a descrição real do MP.
 */
async function mpFetch(caminho, { method = 'GET', accessToken, body, idempotencyKey } = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('fetch indisponível — é necessário Node.js 18 ou superior.')
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey

  let ultimoErro
  for (let tentativa = 0; tentativa <= TENTATIVAS; tentativa++) {
    if (tentativa > 0) {
      const espera = Math.min(500 * 2 ** (tentativa - 1), 4000)
      await new Promise((r) => setTimeout(r, espera))
    }

    try {
      const res = await fetch(`${MP_API}${caminho}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      })
      const dados = await res.json().catch(() => ({}))

      if (!res.ok) {
        // O motivo real costuma vir em cause[0].description, não em message
        const causa = Array.isArray(dados?.cause) && dados.cause[0]?.description
        const erro = new Error(causa || dados?.message || dados?.error || `Mercado Pago HTTP ${res.status}`)
        erro.mpStatus = res.status
        erro.mpBody = dados

        const transitorio = res.status >= 500 || res.status === 429
        if (transitorio && tentativa < TENTATIVAS) {
          ultimoErro = erro
          continue
        }
        throw erro
      }

      return dados
    } catch (err) {
      // Erro de rede (sem mpStatus): vale a pena tentar de novo
      if (!err.mpStatus && tentativa < TENTATIVAS) {
        ultimoErro = err
        continue
      }
      throw err
    }
  }

  throw ultimoErro
}

/** Traduz o status do MP para o vocabulário do PDV. */
function traduzirStatus(status) {
  switch (status) {
    case 'approved':
      return 'pago'
    case 'authorized':
    case 'in_process':
    case 'in_mediation':
      return 'processando'
    case 'rejected':
      return 'recusado'
    case 'cancelled':
      return 'cancelado'
    case 'refunded':
    case 'charged_back':
      return 'devolvido'
    default:
      return 'pendente'
  }
}

/** Data no formato com offset que o MP exige (2024-01-01T12:00:00.000-03:00). */
function dataComOffset(data) {
  return data.toISOString().replace('Z', '-00:00')
}

/** Só os dígitos de um CPF/CNPJ, no formato de identificação do MP. */
function identificacao(documento) {
  const digitos = String(documento || '').replace(/\D/g, '')
  if (digitos.length !== 11 && digitos.length !== 14) return undefined
  return { type: digitos.length > 11 ? 'CNPJ' : 'CPF', number: digitos }
}

/**
 * Confere se o Access Token é válido e devolve a conta dona dele.
 * Usado ao salvar as credenciais — evita gravar um token que não cobra nada.
 */
async function validarCredenciais(accessToken) {
  const conta = await mpFetch('/users/me', { accessToken })
  return {
    id: String(conta.id || ''),
    email: conta.email || '',
    apelido: conta.nickname || '',
    pais: conta.site_id || ''
  }
}

/**
 * Cria uma cobrança PIX e devolve o QR Code para mostrar na tela.
 *
 * O e-mail do pagador é um placeholder de propósito: o Mercado Pago recusa
 * a cobrança ("Invalid users involved") quando o pagador é a própria conta
 * que está cobrando — que é exatamente o e-mail do lojista.
 */
async function criarPix({
  accessToken,
  valor,
  descricao = 'Venda no PDV',
  referenciaExterna,
  metadata = {},
  minutosParaExpirar = 30,
  idempotencyKey,
  pagador = {}
}) {
  const expiraEm = new Date(Date.now() + minutosParaExpirar * 60 * 1000)

  const corpo = {
    transaction_amount: Number(Number(valor).toFixed(2)),
    description: String(descricao).slice(0, 255),
    payment_method_id: 'pix',
    date_of_expiration: dataComOffset(expiraEm),
    payer: {
      email: pagador.email || 'cliente@email.com',
      first_name: pagador.nome || 'Cliente',
      ...(identificacao(pagador.documento) ? { identification: identificacao(pagador.documento) } : {})
    }
  }
  if (referenciaExterna) corpo.external_reference = String(referenciaExterna)
  if (metadata && Object.keys(metadata).length) corpo.metadata = metadata

  const mp = await mpFetch('/v1/payments', {
    method: 'POST',
    accessToken,
    body: corpo,
    idempotencyKey
  })

  const transacao = mp?.point_of_interaction?.transaction_data || {}
  return {
    pagamentoId: String(mp.id || ''),
    status: traduzirStatus(mp.status),
    statusMp: mp.status || '',
    detalheStatus: mp.status_detail || '',
    qrCode: transacao.qr_code || '',
    qrCodeBase64: transacao.qr_code_base64 || '',
    ticketUrl: transacao.ticket_url || '',
    valor: mp.transaction_amount,
    expiraEm: mp.date_of_expiration || expiraEm.toISOString(),
    bruto: mp
  }
}

/** Consulta o status atual de uma cobrança. */
async function consultarPagamento({ accessToken, pagamentoId }) {
  const mp = await mpFetch(`/v1/payments/${encodeURIComponent(pagamentoId)}`, { accessToken })
  return {
    pagamentoId: String(mp.id || ''),
    status: traduzirStatus(mp.status),
    statusMp: mp.status || '',
    detalheStatus: mp.status_detail || '',
    valor: mp.transaction_amount,
    valorRecebido: mp.transaction_details?.total_paid_amount ?? mp.transaction_amount,
    expiraEm: mp.date_of_expiration || null,
    bruto: mp
  }
}

/**
 * Cancela uma cobrança pendente.
 * Chamado quando o operador desiste do PIX no PDV — sem isso a cobrança fica
 * viva e o cliente ainda pode pagar depois, sem venda registrada do outro lado.
 */
async function cancelarPagamento({ accessToken, pagamentoId }) {
  const mp = await mpFetch(`/v1/payments/${encodeURIComponent(pagamentoId)}`, {
    method: 'PUT',
    accessToken,
    body: { status: 'cancelled' }
  })
  return { pagamentoId: String(mp.id || ''), status: traduzirStatus(mp.status), statusMp: mp.status || '' }
}

/**
 * Valida a assinatura do webhook do Mercado Pago.
 *
 * O MP manda dois headers:
 *   x-signature:  ts=1704908010,v1=<hmac-sha256-hex>
 *   x-request-id: <uuid da requisição>
 *
 * E o hash é calculado sobre este manifesto:
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * Partes ausentes saem do manifesto inteiras (chave, valor e ponto-e-vírgula).
 * O segredo é a "assinatura secreta" que o Mercado Pago mostra no painel dele
 * na hora de cadastrar a URL — não é algo que a gente escolha.
 *
 * Docs: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 */
function validarAssinaturaWebhook({ segredo, xSignature, xRequestId, dataId }) {
  if (!segredo) return { ok: false, motivo: 'sem_segredo' }
  if (!xSignature) return { ok: false, motivo: 'sem_header_assinatura' }

  const partes = {}
  for (const pedaco of String(xSignature).split(',')) {
    const [chave, ...resto] = pedaco.trim().split('=')
    if (chave && resto.length) partes[chave.trim()] = resto.join('=').trim()
  }
  if (!partes.ts || !partes.v1) return { ok: false, motivo: 'assinatura_malformada' }

  // IDs alfanuméricos entram em minúsculas no manifesto (exigência do MP)
  const id = dataId == null ? '' : String(dataId)
  const idNormalizado = /^[0-9]+$/.test(id) ? id : id.toLowerCase()

  let manifesto = ''
  if (idNormalizado) manifesto += `id:${idNormalizado};`
  if (xRequestId) manifesto += `request-id:${xRequestId};`
  manifesto += `ts:${partes.ts};`

  const esperado = nodeCrypto.createHmac('sha256', segredo).update(manifesto).digest('hex')

  let recebidoBuf
  try {
    recebidoBuf = Buffer.from(partes.v1, 'hex')
  } catch {
    return { ok: false, motivo: 'assinatura_nao_hex' }
  }
  const esperadoBuf = Buffer.from(esperado, 'hex')

  // timingSafeEqual quebra com tamanhos diferentes — confere antes
  if (recebidoBuf.length !== esperadoBuf.length) {
    return { ok: false, motivo: 'tamanho_diferente' }
  }

  const ok = nodeCrypto.timingSafeEqual(recebidoBuf, esperadoBuf)
  return { ok, motivo: ok ? null : 'hash_nao_confere' }
}

module.exports = {
  MP_API,
  mpFetch,
  traduzirStatus,
  validarCredenciais,
  criarPix,
  consultarPagamento,
  cancelarPagamento,
  validarAssinaturaWebhook
}
