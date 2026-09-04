const mongoose = require('mongoose')

/**
 * Uma cobrança PIX gerada no PDV.
 *
 * Existe para o webhook ter onde escrever: quando o Mercado Pago avisa que o
 * pagamento caiu, marcamos aqui. O PDV então descobre na consulta seguinte
 * sem precisar bater no Mercado Pago de novo — e mesmo que o operador tenha
 * fechado a tela, fica o registro de que o dinheiro entrou.
 */
const cobrancaPixSchema = new mongoose.Schema({
  // Dono da loja (conta que recebe). Operador cobra na conta do dono.
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Quem estava no caixa quando a cobrança foi criada
  operadorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // ID do pagamento no Mercado Pago
  pagamentoId: {
    type: String,
    required: true,
    index: true
  },
  // external_reference enviado ao MP — também é a chave de idempotência
  referencia: {
    type: String,
    default: '',
    index: true
  },
  valor: {
    type: Number,
    required: true
  },
  descricao: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pendente', 'processando', 'pago', 'recusado', 'cancelado', 'devolvido'],
    default: 'pendente',
    index: true
  },
  statusMp: {
    type: String,
    default: ''
  },
  pagoEm: {
    type: Date,
    default: null
  },
  expiraEm: {
    type: Date,
    default: null
  },
  // Como o status atual foi descoberto: consulta do PDV ou aviso do webhook
  confirmadoPor: {
    type: String,
    enum: ['', 'consulta', 'webhook'],
    default: ''
  }
}, { timestamps: true })

// Uma cobrança por pagamento do MP, por loja
cobrancaPixSchema.index({ userId: 1, pagamentoId: 1 }, { unique: true })
// Listagem por loja, mais recentes primeiro
cobrancaPixSchema.index({ userId: 1, createdAt: -1 })

module.exports = mongoose.model('CobrancaPix', cobrancaPixSchema)
