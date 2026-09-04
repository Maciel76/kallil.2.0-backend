/**
 * Monta a URL de webhook que cada lojista cadastra no painel do Mercado Pago.
 *
 * Ordem de precedência da base:
 *   1) WEBHOOK_BASE_URL   (ex: https://kallil.net)
 *   2) BACKEND_URL
 *   3) PUBLIC_URL
 *   4) FRONTEND_URL
 *
 * O userId na URL identifica a loja. O segredo NÃO vai na URL: ele viaja no
 * header x-signature, então a URL pode ser copiada e colada à vontade.
 */

const BASE_PADRAO = 'https://kallil.net'

function baseEscolhida() {
  const candidatas = [
    process.env.WEBHOOK_BASE_URL,
    process.env.BACKEND_URL,
    process.env.PUBLIC_URL,
    process.env.FRONTEND_URL
  ]
  for (const c of candidatas) {
    if (c && typeof c === 'string' && c.trim()) return c.trim()
  }
  return BASE_PADRAO
}

/** URL pública do webhook desta loja. */
function montarUrlWebhook(userId) {
  if (!userId) return ''
  const base = baseEscolhida().replace(/\/+$/, '')
  return `${base}/api/pagamento-loja/webhook/${String(userId)}`
}

/**
 * A base configurada é alcançável pelo Mercado Pago?
 * localhost e IPs de rede interna não são — e o lojista precisa saber disso
 * antes de colar a URL no painel e ficar esperando um aviso que nunca chega.
 */
function basePublica() {
  const base = baseEscolhida()
  if (/^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|\[::1\])/i.test(base)) return false
  return /^https:\/\//i.test(base)
}

module.exports = { montarUrlWebhook, basePublica, baseEscolhida, BASE_PADRAO }
