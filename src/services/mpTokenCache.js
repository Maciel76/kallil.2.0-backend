const User = require('../models/User')
const { decryptToken } = require('../utils/crypto')

/**
 * Cache em memória do Access Token do lojista.
 *
 * O PDV consulta o status do PIX a cada poucos segundos enquanto o cliente
 * paga. Sem cache, cada consulta viraria uma leitura no Mongo + uma
 * decifragem AES só para montar o header Authorization.
 */

const TTL_MS = 5 * 60 * 1000 // 5 minutos
const MAX_ENTRADAS = 1000

const cache = new Map() // userId -> { token, conta, email, expiraEm }

/**
 * Devolve as credenciais ativas do dono da loja, ou null quando o PIX
 * automático não está configurado/ligado.
 *
 * `userId` deve ser o ID efetivo (req.userId): o operador cobra usando a
 * conta do dono.
 */
async function getTokenDoLojista(userId) {
  if (!userId) return null
  const chave = String(userId)
  const agora = Date.now()

  const emCache = cache.get(chave)
  if (emCache && emCache.expiraEm > agora) {
    return { token: emCache.token, conta: emCache.conta, email: emCache.email }
  }

  const dono = await User.findById(chave)
    .select('+mpAccessToken')
    .lean()

  if (!dono || !dono.mpAtivo || !dono.mpAccessToken) return null

  const token = decryptToken(dono.mpAccessToken)
  if (!token) return null // credencial ilegível (chave de cifra trocada)

  // LRU simples: descarta a entrada mais antiga quando estoura
  if (cache.size >= MAX_ENTRADAS) {
    cache.delete(cache.keys().next().value)
  }

  const entrada = {
    token,
    conta: dono.mpConta || '',
    email: dono.email || '',
    expiraEm: agora + TTL_MS
  }
  cache.set(chave, entrada)
  return { token: entrada.token, conta: entrada.conta, email: entrada.email }
}

/** Invalida a entrada de um lojista. SEMPRE chamar depois de salvar/remover. */
function invalidar(userId) {
  if (userId) cache.delete(String(userId))
}

/** Limpa tudo (uso administrativo). */
function invalidarTudo() {
  cache.clear()
}

module.exports = { getTokenDoLojista, invalidar, invalidarTudo }
