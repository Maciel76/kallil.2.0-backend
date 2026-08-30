// Cliente HTTP da API DeepSeek (compatível com o formato OpenAI)
// Docs: https://api-docs.deepseek.com/

const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

function isEnabled() {
  const flag = (process.env.DEEPSEEK_ENABLED || 'true').toLowerCase()
  return flag !== 'false' && !!process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'sk-INSIRA_SUA_CHAVE_AQUI'
}

/**
 * Chama o chat completions da DeepSeek.
 * @param {Array<{role: string, content: string}>} messages
 * @param {Object} options
 * @param {number} options.temperature
 * @param {number} options.max_tokens
 * @returns {Promise<{content: string, usage: object}>}
 */
async function chat(messages, options = {}) {
  if (!isEnabled()) {
    throw new Error('DeepSeek não está habilitado ou DEEPSEEK_API_KEY não definida.')
  }
  const apiKey = process.env.DEEPSEEK_API_KEY
  const url = `${BASE_URL}/chat/completions`

  const body = {
    model: MODEL,
    messages,
    temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
    max_tokens: options.max_tokens || 600,
    stream: false
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    // Timeouts via AbortController
    signal: AbortSignal.timeout(options.timeoutMs || 30000)
  })

  if (!response.ok) {
    const txt = await response.text().catch(() => '')
    throw new Error(`DeepSeek erro HTTP ${response.status}: ${txt.slice(0, 300)}`)
  }

  const data = await response.json()
  return {
    content: data?.choices?.[0]?.message?.content || '',
    usage: data?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  }
}

module.exports = { chat, isEnabled }
