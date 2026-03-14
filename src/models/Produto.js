const mongoose = require('mongoose')

const produtoSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  nome: {
    type: String,
    required: [true, 'Nome do produto é obrigatório'],
    trim: true
  },
  codigoBarras: {
    type: String,
    trim: true,
    default: ''
  },
  codigosAdicionais: {
    type: [String],
    default: []
  },
  categoria: {
    type: String,
    default: 'Geral',
    trim: true
  },
  unidade: {
    type: String,
    default: 'un',
    enum: ['un', 'kg', 'g', 'l', 'ml', 'cx', 'pc', 'mt']
  },
  precoVenda: {
    type: Number,
    required: [true, 'Preço de venda é obrigatório'],
    min: 0
  },
  precoCusto: {
    type: Number,
    default: 0,
    min: 0
  },
  estoque: {
    type: Number,
    default: 0,
    min: 0
  },
  estoqueMinimo: {
    type: Number,
    default: 5
  },
  vendasTotal: {
    type: Number,
    default: 0
  },
  ativo: {
    type: Boolean,
    default: true
  }
}, { timestamps: true })

// Índice para busca por código de barras
produtoSchema.index({ userId: 1, codigoBarras: 1 })
produtoSchema.index({ userId: 1, nome: 1 })
produtoSchema.index({ userId: 1, codigosAdicionais: 1 })

module.exports = mongoose.model('Produto', produtoSchema)
