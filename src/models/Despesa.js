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
    enum: ['Aluguel', 'Fornecedor', 'Energia', 'Transporte', 'Marketing', 'Assinatura', 'Outros'],
    default: 'Outros'
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
  },
  data: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true })

module.exports = mongoose.model('Despesa', despesaSchema)
