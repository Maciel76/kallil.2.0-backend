const mongoose = require('mongoose')

const despesaSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  nome: {
    type: String,
    trim: true
  },
  descricao: {
    type: String,
    trim: true
  },
  valor: {
    type: Number,
    required: [true, 'Valor é obrigatório'],
    min: 0
  },
  categoria: {
    type: String,
    default: 'Outros',
    trim: true
  },
  formaPagamento: {
    type: String,
    enum: ['dinheiro', 'pix', 'debito', 'credito', 'transferencia', 'boleto', 'outro'],
    default: null
  },
  data: {
    type: Date,
    default: Date.now
  },
  quandoPagar: {
    type: Date,
    default: null
  },
  pago: {
    type: Boolean,
    default: false
  },
  fixa: {
    type: Boolean,
    default: false
  },
  origem: {
    type: String,
    enum: ['manual', 'assinatura'],
    default: 'manual'
  },
  recorrencia: {
    type: String,
    enum: ['nenhuma', 'mensal'],
    default: 'nenhuma'
  }
}, { timestamps: true })

module.exports = mongoose.model('Despesa', despesaSchema)
