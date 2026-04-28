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
  // Preferências de notificação automática (usuário dono)
  notificacoes: {
    vendasDiarias: { type: Boolean, default: true },
    horaResumo: { type: String, default: '20:00' }, // HH:MM
    cobrancaAutomatica: { type: Boolean, default: false },
    lembretePagamento: { type: Boolean, default: true },
    diasAntesVencimento: { type: Number, default: 1 },
    agradecimentoCompra: { type: Boolean, default: false },
    mensagemAgradecimento: {
      type: String,
      default: '🙏 Olá {nome}! Obrigado pela sua compra. Em breve seu pedido estará pronto.'
    },
    mensagemCobranca: {
      type: String,
      default: '📌 Olá {nome}, lembrando que sua conta no valor de R$ {valor} vence em {vencimento}.'
    },
    ultimoResumoEnviado: { type: Date, default: null }
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
