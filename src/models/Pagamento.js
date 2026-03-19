const mongoose = require('mongoose')

const pagamentoSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Mercado Pago
  mpPreferenceId: {
    type: String,
    default: null
  },
  mpPaymentId: {
    type: String,
    default: null
  },
  // Dados do plano
  plano: {
    type: String,
    enum: ['pago'],
    default: 'pago'
  },
  meses: {
    type: Number,
    required: true,
    min: 1
  },
  valorTotal: {
    type: Number,
    required: true
  },
  // Status do pagamento
  status: {
    type: String,
    enum: ['pendente', 'aprovado', 'rejeitado', 'cancelado', 'reembolsado'],
    default: 'pendente'
  },
  metodoPagamento: {
    type: String,
    default: null
  },
  detalhes: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true })

pagamentoSchema.index({ userId: 1, createdAt: -1 })
pagamentoSchema.index({ mpPaymentId: 1 })
pagamentoSchema.index({ mpPreferenceId: 1 })

module.exports = mongoose.model('Pagamento', pagamentoSchema)
