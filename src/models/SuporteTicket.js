const mongoose = require('mongoose')

const mensagemSchema = new mongoose.Schema({
  autorTipo: {
    type: String,
    enum: ['usuario', 'admin'],
    required: true
  },
  autorNome: {
    type: String,
    required: true,
    trim: true
  },
  texto: {
    type: String,
    required: true,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true })

const suporteTicketSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  userNome: {
    type: String,
    required: true,
    trim: true
  },
  userEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  nomeNegocio: {
    type: String,
    default: '',
    trim: true
  },
  assunto: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['aberto', 'respondido', 'fechado'],
    default: 'aberto'
  },
  naoLidasAdmin: {
    type: Number,
    default: 0,
    min: 0
  },
  naoLidasUsuario: {
    type: Number,
    default: 0,
    min: 0
  },
  ultimaMensagemEm: {
    type: Date,
    default: Date.now,
    index: true
  },
  mensagens: {
    type: [mensagemSchema],
    default: []
  }
}, { timestamps: true })

module.exports = mongoose.model('SuporteTicket', suporteTicketSchema)