// Serviço de RAG (Retrieval-Augmented Generation) simples baseado em
// similaridade textual — bag-of-words + cosseno. Para bases pequenas/médias
// isso já é suficiente. Quando a base crescer, trocamos por embeddings
// reais sem mudar a interface pública.

const BaseConhecimento = require('../models/BaseConhecimento')

const STOPWORDS = new Set([
  'a', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas', 'e', 'ou', 'mas',
  'que', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas',
  'em', 'por', 'para', 'com', 'sem', 'pra', 'pelo', 'pela', 'este',
  'esta', 'isto', 'isso', 'aquilo', 'eu', 'tu', 'você', 'voce', 'vc',
  'ele', 'ela', 'nos', 'nós', 'eles', 'elas', 'me', 'te', 'se', 'si',
  'ao', 'aos', 'à', 'às', 'é', 'são', 'foi', 'ser', 'ter', 'haver',
  'tem', 'têm', 'muito', 'muita', 'pouco', 'pouca', 'já', 'ainda',
  'mais', 'menos', 'sim', 'não', 'nao', 'ok', 'oi', 'ola', 'olá',
  'bom', 'boa', 'dia', 'tarde', 'noite', 'por favor', 'pf', 'favor',
  'posso', 'quer', 'quero', 'queria', 'gostaria', 'preciso', 'precisa',
  'saber', 'sobre', 'qual', 'quais', 'como', 'quando', 'onde'
])

function tokenizar(texto = '') {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t))
}

function vetorizar(tokens) {
  const freq = {}
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1
  return freq
}

function cosseno(a, b) {
  let dot = 0, sa = 0, sb = 0
  for (const k in a) {
    sa += a[k] * a[k]
    if (b[k]) dot += a[k] * b[k]
  }
  for (const k in b) sb += b[k] * b[k]
  if (!sa || !sb) return 0
  return dot / (Math.sqrt(sa) * Math.sqrt(sb))
}

/**
 * Busca os N itens mais relevantes da base de um dono.
 * @param {string} userId
 * @param {string} query
 * @param {number} limite
 * @returns {Promise<Array<{item, score}>>}
 */
async function buscarRelevantes(userId, query, limite = 5) {
  const tokens = tokenizar(query)
  if (tokens.length === 0) return []

  const queryVet = vetorizar(tokens)
  const itens = await BaseConhecimento.find({ userId }).lean()

  const scored = itens.map(item => {
    const docTokens = tokenizar(item.textoBusca || '')
    const docVet = vetorizar(docTokens)
    let score = cosseno(queryVet, docVet)

    // Bônus leve para match em tags (sinônimos explícitos)
    const tags = (item.tags || []).map(t => t.toLowerCase())
    for (const t of tags) {
      if (tokens.includes(t)) score += 0.1
    }

    return { item, score }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limite)
}

/**
 * Formata um item da base num trecho legível para ser injetado no prompt.
 */
function itemParaContexto(item) {
  if (item.tipo === 'faq') {
    return `[FAQ] P: ${item.pergunta}\nR: ${item.resposta}`
  }
  if (item.tipo === 'documento') {
    return `[Documento: ${item.titulo}]\n${item.texto}`
  }
  if (item.tipo === 'produto') {
    const status = item.disponivel ? 'disponível' : 'indisponível'
    return `[Produto: ${item.nome}] categoria: ${item.categoria || 'geral'} — R$ ${Number(item.preco || 0).toFixed(2)} — ${status}\n${item.descricao || ''}`
  }
  if (item.tipo === 'regra') {
    return `[Regra] Quando: ${item.gatilho}\nAção: ${item.acao}`
  }
  return ''
}

module.exports = { buscarRelevantes, itemParaContexto }
