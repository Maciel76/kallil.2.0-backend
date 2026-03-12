const mongoose = require('mongoose')

const caixaSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  numero: {
    type: Number,
    default: 1,
    min: 1
  },
  nome: {
    type: String,
    default: ''
  },
  operador: {
    type: String,
    default: ''
  },
  valorInicial: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  totalVendas: {
    type: Number,
    default: 0
  },
  totalDespesas: {
    type: Number,
    default: 0
  },
  totalVendasPrazo: {
    type: Number,
    default: 0
  },
  totalRecebidoPrazo: {
    type: Number,
    default: 0
  },
  lucroTotal: {
    type: Number,
    default: 0
  },
  saldoFinal: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['aberto', 'fechado'],
    default: 'aberto'
  },
  aberturaEm: {
    type: Date,
    default: Date.now
  },
  fechamentoEm: {
    type: Date,
    default: null
  }
}, { timestamps: true })

module.exports = mongoose.model('Caixa', caixaSchema)
