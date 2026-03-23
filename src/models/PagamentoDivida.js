const mongoose = require('mongoose')

const pagamentoDividaSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  clienteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cliente',
    required: true
  },
  vendaIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Venda'
  }],
  valor: {
    type: Number,
    required: true,
    min: 0
  },
  formaPagamento: {
    type: String,
    enum: ['dinheiro', 'pix', 'debito', 'credito'],
    default: 'dinheiro'
  },
  operadorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  operadorNome: {
    type: String,
    default: ''
  },
  dividaAnterior: {
    type: Number,
    default: 0
  },
  dividaRestante: {
    type: Number,
    default: 0
  },
  tipo: {
    type: String,
    enum: ['parcial', 'quitacao'],
    default: 'parcial'
  }
}, { timestamps: true })

pagamentoDividaSchema.index({ clienteId: 1, createdAt: -1 })

module.exports = mongoose.model('PagamentoDivida', pagamentoDividaSchema)
