const mongoose = require('mongoose')

const whatsappInstanceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Nome da instância é obrigatório'],
    trim: true
  },
  status: {
    type: String,
    enum: ['disconnected', 'connecting', 'connected'],
    default: 'disconnected'
  },
  qrCode: {
    type: String,
    default: null
  },
  notificationPhone: {
    type: String,
    default: null,
    trim: true
  },
  session: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
})

module.exports = mongoose.model('WhatsAppInstance', whatsappInstanceSchema)
