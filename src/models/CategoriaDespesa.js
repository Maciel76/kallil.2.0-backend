const mongoose = require('mongoose')

const categoriaDespesaSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  nome: {
    type: String,
    required: [true, 'Nome da categoria é obrigatório'],
    trim: true
  },
  cor: {
    type: String,
    default: '#6b7280'
  }
}, { timestamps: true })

categoriaDespesaSchema.index({ userId: 1, nome: 1 }, { unique: true })

module.exports = mongoose.model('CategoriaDespesa', categoriaDespesaSchema)
