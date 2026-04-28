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
    trim: true,
    default: ''
  },
  cpf: {
    type: String,
    trim: true,
    default: '',
    validate: {
      validator: function(v) {
        if (!v) return true
        const limpo = v.replace(/\D/g, '')
        if (limpo.length !== 11) return false
        if (/^(\d)\1{10}$/.test(limpo)) return false
        let soma = 0
        for (let i = 0; i < 9; i++) soma += parseInt(limpo[i]) * (10 - i)
        let resto = (soma * 10) % 11
        if (resto === 10) resto = 0
        if (resto !== parseInt(limpo[9])) return false
        soma = 0
        for (let i = 0; i < 10; i++) soma += parseInt(limpo[i]) * (11 - i)
        resto = (soma * 10) % 11
        if (resto === 10) resto = 0
        return resto === parseInt(limpo[10])
      },
      message: 'CPF inválido'
    }
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
  telefone: {
    type: String,
    trim: true,
    default: ''
  },
  resetCode: {
    type: String,
    default: null
  },
  resetCodeExpira: {
    type: Date,
    default: null
  },
  senha: {
    type: String,
    required: [true, 'Senha é obrigatória'],
    minlength: 6,
    select: false
  },
  role: {
    type: String,
    enum: ['admin', 'dono', 'operador'],
    default: 'dono'
  },
  donoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  ativo: {
    type: Boolean,
    default: true
  },
  // === Campos de Assinatura ===
  plano: {
    type: String,
    enum: ['gratuito', 'pago'],
    default: 'gratuito'
  },
  assinaturaStatus: {
    type: String,
    enum: ['ativo', 'teste', 'expirado', 'cancelado'],
    default: 'teste'
  },
  assinaturaInicio: {
    type: Date,
    default: null
  },
  assinaturaExpira: {
    type: Date,
    default: null
  },
  testeExpira: {
    type: Date,
    default: null
  },
  // === Add-on Automação WhatsApp ===
  planoWhatsapp: {
    type: Boolean,
    default: false
  },
  whatsappAssinaturaInicio: {
    type: Date,
    default: null
  },
  whatsappAssinaturaExpira: {
    type: Date,
    default: null
  }
}, { timestamps: true })

// Hash senha antes de salvar
userSchema.pre('save', async function (next) {
  if (!this.isModified('senha')) return next()
  this.senha = await bcrypt.hash(this.senha, 12)
  next()
})

// Inicializar período de teste para novos donos
userSchema.pre('save', async function (next) {
  if (this.isNew && this.role === 'dono' && !this.testeExpira) {
    const PlanoConfig = mongoose.model('PlanoConfig')
    const config = await PlanoConfig.getConfig()
    this.testeExpira = new Date(Date.now() + config.diasTeste * 24 * 60 * 60 * 1000)
    this.assinaturaStatus = 'teste'
    this.plano = 'gratuito'
  }
  next()
})

// Comparar senha
userSchema.methods.compararSenha = async function (senhaInformada) {
  return await bcrypt.compare(senhaInformada, this.senha)
}

// Para operador, retorna o donoId (dados do negócio ficam no dono)
userSchema.methods.getUserIdEfetivo = function () {
  return this.role === 'operador' && this.donoId ? this.donoId : this._id
}

module.exports = mongoose.model('User', userSchema)
