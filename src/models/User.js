const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const userSchema = new mongoose.Schema({
  nome: {
    type: String,
    required: [true, 'Nome é obrigatório'],
    trim: true
  },
  nomeNegocio: {
    type: String,
    required: [true, 'Nome do negócio é obrigatório'],
    trim: true
  },
  cnpj: {
    type: String,
    trim: true,
    default: ''
  },
  endereco: {
    type: String,
    trim: true,
    default: ''
  },
  cidade: {
    type: String,
    trim: true,
    default: ''
  },
  estado: {
    type: String,
    trim: true,
    default: ''
  },
  taxaPrazo: {
    type: Number,
    default: 0,
    min: 0
  },
  logoUrl: {
    type: String,
    default: ''
  },
  pdvCores: {
    headerBg: { type: String, default: '#1e293b' },
    headerText: { type: String, default: '#ffffff' },
    destaque: { type: String, default: '#16a34a' },
    fundo: { type: String, default: '#eef2ff' },
    painelBg: { type: String, default: '#ffffff' }
  },
  email: {
    type: String,
    required: [true, 'E-mail é obrigatório'],
    unique: true,
    lowercase: true,
    trim: true
  },
  senha: {
    type: String,
    required: [true, 'Senha é obrigatória'],
    minlength: 6,
    select: false
  }
}, { timestamps: true })

// Hash senha antes de salvar
userSchema.pre('save', async function (next) {
  if (!this.isModified('senha')) return next()
  this.senha = await bcrypt.hash(this.senha, 12)
  next()
})

// Comparar senha
userSchema.methods.compararSenha = async function (senhaInformada) {
  return await bcrypt.compare(senhaInformada, this.senha)
}

module.exports = mongoose.model('User', userSchema)
