// Orquestrador do agente de IA: monta o prompt do sistema com base de
// conhecimento (RAG), chama a DeepSeek, detecta pedido de humano, e loga uso.

const deepseek = require('./deepseekService')
const rag = require('./ragService')
const AgenteIA = require('../models/AgenteIA')
const UsoIA = require('../models/UsoIA')

const SINAL_TRANSFERE = '<<TRANSFERIR_HUMANO>>'

function montarHoraAtual() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Monta o system prompt do agente.
 */
function montarSystemPrompt(agente, contextoBase) {
  const partes = []
  partes.push(`Você é ${agente.nome}, ${agente.funcao || 'um atendente virtual'}.`)
  partes.push(agente.descricao || '')

  if (agente.prompt && agente.prompt.trim()) {
    partes.push(`\nRegras de comportamento:\n${agente.prompt.trim()}`)
  }

  if (agente.especialidades && agente.especialidades.length > 0) {
    const mapa = {
      atendimento: 'cumprimentar e ouvir o cliente com educação',
      vendas: 'mostrar produtos, sugerir e ajudar a fechar pedidos',
      agendamento: 'ajudar a marcar, remarcar ou cancelar horários',
      suporte: 'resolver dúvidas técnicas passo a passo',
      cobranca: 'lembrar pagamentos e enviar instruções de forma amigável',
      marketing: 'divulgar novidades e promoções',
      recomendacao: 'recomendar produtos com base no que o cliente pediu',
      humano: 'transferir para humano quando o cliente pedir'
    }
    const habil = agente.especialidades.map(e => mapa[e] || e).join('; ')
    partes.push(`\nSuas habilidades: ${habil}.`)
  }

  if (contextoBase) {
    partes.push(`\nInformações relevantes da base de conhecimento do negócio (use apenas se forem úteis para responder o cliente):\n${contextoBase}`)
  }

  partes.push(`
Regras importantes:
- Responda sempre em português do Brasil, de forma amigável e objetiva.
- Use no máximo 3 frases por mensagem, a menos que o cliente peça mais detalhes.
- Se não souber a resposta, diga que vai transferir para um humano.
- Se o cliente pedir explicitamente para falar com humano, atendente, ou reclamou muito, você DEVE iniciar a resposta com a marcação ${SINAL_TRANSFERE}.`)

  return partes.filter(Boolean).join('\n')
}

/**
 * @param {object} params
 * @param {object} params.agente   - documento AgenteIA
 * @param {string} params.userId   - id do dono
 * @param {string} params.mensagem - mensagem do cliente
 * @param {string} [params.contextoCliente] - id/extra do cliente
 * @returns {Promise<{resposta: string, transferiu: boolean, usou: object, itensBase: Array}>}
 */
async function responder({ agente, userId, mensagem, contextoCliente = '' }) {
  // 1) RAG: busca os 5 itens mais relevantes da base
  const relevantes = await rag.buscarRelevantes(userId, mensagem, 5)
  const contextoBase = relevantes.map(r => rag.itemParaContexto(r.item)).join('\n\n')

  // 2) System prompt
  const systemPrompt = montarSystemPrompt(agente, contextoBase)
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: mensagem }
  ]

  // 3) Chama DeepSeek
  const { content, usage } = await deepseek.chat(messages, { temperature: 0.7, max_tokens: 600 })

  // 4) Detecta transferência pra humano
  let resposta = content || ''
  let transferiu = false
  if (resposta.startsWith(SINAL_TRANSFERE)) {
    transferiu = true
    resposta = resposta.replace(SINAL_TRANSFERE, '').trim()
  }

  // 5) Loga uso
  await UsoIA.create({
    userId,
    agenteId: agente._id,
    contexto: contextoCliente.startsWith('agente') ? 'agente' : 'cliente',
    telefoneCliente: contextoCliente,
    mensagemUsuario: mensagem,
    respostaIA: resposta,
    transferiuHumano: transferiu,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    itensBaseUsados: relevantes.map(r => r.item._id)
  })

  // 6) Atualiza contador do agente
  await AgenteIA.updateOne({ _id: agente._id }, {
    $inc: {
      atendimentos: 1,
      totalTokens: usage.total_tokens || 0
    }
  })

  return {
    resposta,
    transferiu,
    usou: usage,
    itensBase: relevantes.map(r => ({ id: r.item._id, tipo: r.item.tipo, score: r.score }))
  }
}

module.exports = { responder, montarSystemPrompt }
