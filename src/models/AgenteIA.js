const mongoose = require('mongoose')

const agenteIASchema = new mongoose.Schema({
  // Dono do negócio ao qual o agente está vinculado
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  nome: { type: String, required: true, trim: true },
  funcao: { type: String, default: '' },
  descricao: { type: String, default: '' },

  // Visual
  cor: { type: String, default: '#16a34a' },
  icone: { type: String, default: 'fas fa-comments' },

  // Ativar/desativar
  ativo: { type: Boolean, default: true, index: true },

  // Especialidades (ids) — referência ao catálogo global
  especialidades: [{ type: String }],

  // Prompt + comportamento
  prompt: { type: String, default: '' },
  saudacao: { type: String, default: '' },
  horarioInicio: { type: String, default: '08:00' },
  horarioFim: { type: String, default: '20:00' },

  // Uso
  atendimentos: { type: Number, default: 0 },
  totalTokens: { type: Number, default: 0 },

  // Auditoria
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

// Um usuário pode ter agentes com nomes únicos (ajuda a evitar duplicidades)
agenteIASchema.index({ userId: 1, nome: 1 }, { unique: false })

agenteIASchema.pre('save', function (next) {
  this.updatedAt = new Date()
  next()
})

module.exports = mongoose.model('AgenteIA', agenteIASchema)
