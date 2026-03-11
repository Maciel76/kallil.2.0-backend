const mongoose = require('mongoose')

const vendaSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  itens: [
    {
      produtoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Produto' },
      nome: String,
      qty: { type: Number, min: 1 },
      precoUnit: Number,
      precoCusto: Number,
      subtotal: Number,
      lucro: Number
    }
  ],
  total: {
    type: Number,
    required: true,
    min: 0
  },
  desconto: {
    type: Number,
    default: 0,
    min: 0
  },
  descontoTipo: {
    type: String,
    enum: ['valor', 'percentual'],
    default: 'valor'
  },
  totalFinal: {
    type: Number,
    required: true,
    min: 0
  },
  lucroTotal: {
    type: Number,
    default: 0
  },
  formaPagamento: {
    type: String,
    enum: ['dinheiro', 'pix', 'debito', 'credito', 'fiado'],
    required: true
  },
  valorRecebido: {
    type: Number,
    default: 0
  },
  troco: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pago', 'fiado', 'cancelado', 'espera'],
    default: 'pago'
  },
  clienteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cliente',
    default: null
  },
  clienteNome: {
    type: String,
    default: ''
  },
  dataVencimento: {
    type: Date,
    default: null
  },
  observacoes: {
    type: String,
    trim: true,
    default: ''
  },
  caixaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Caixa',
    default: null
  },
  hashEspera: {
    type: String,
    default: null
  }
}, { timestamps: true })

module.exports = mongoose.model('Venda', vendaSchema)
