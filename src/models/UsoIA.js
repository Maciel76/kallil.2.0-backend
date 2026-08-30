const mongoose = require('mongoose')

// Log de cada chamada à API DeepSeek para fins de auditoria e limites
const usoIASchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },

  // 'agente' = teste pelo painel admin
  // 'cliente' = conversa WhatsApp com cliente
  contexto: {
    type: String,
    enum: ['agente', 'cliente'],
    default: 'agente'
  },

  agenteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AgenteIA',
    default: null
  },

  telefoneCliente: { type: String, default: '' },

  // Métricas da chamada DeepSeek
  promptTokens: { type: Number, default: 0 },
  completionTokens: { type: Number, default: 0 },
  totalTokens: { type: Number, default: 0 },

  // Mensagens trocadas (resumo)
  mensagemUsuario: { type: String, default: '' },
  respostaIA: { type: String, default: '' },

  // Se a IA pediu transferência pra humano
  transferiuHumano: { type: Boolean, default: false },

  // Uso de base de conhecimento
  itensBaseUsados: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BaseConhecimento' }],

  createdAt: { type: Date, default: Date.now, index: true }
})

usoIASchema.index({ userId: 1, createdAt: -1 })

module.exports = mongoose.model('UsoIA', usoIASchema)
