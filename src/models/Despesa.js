const mongoose = require('mongoose')

const despesaSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  descricao: {
    type: String,
    required: [true, 'Descrição é obrigatória'],
    trim: true
  },
  valor: {
    type: Number,
    required: [true, 'Valor é obrigatório'],
    min: 0
  },
  categoria: {
    type: String,
    enum: ['Aluguel', 'Fornecedor', 'Energia', 'Transporte', 'Marketing', 'Outros'],
    default: 'Outros'
  },
  data: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true })

module.exports = mongoose.model('Despesa', despesaSchema)
