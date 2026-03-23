const mongoose = require('mongoose')

const clienteSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  nome: {
    type: String,
    required: [true, 'Nome do cliente é obrigatório'],
    trim: true
  },
  cpf: {
    type: String,
    trim: true,
    default: ''
  },
  telefone: {
    type: String,
    trim: true,
    default: ''
  },
  endereco: {
    type: String,
    trim: true,
    default: ''
  },
  totalDevido: {
    type: Number,
    default: 0,
    min: 0
  }
}, { timestamps: true })

clienteSchema.index({ userId: 1, cpf: 1 })

module.exports = mongoose.model('Cliente', clienteSchema)
