const mongoose = require('mongoose')

// Cada item da base de conhecimento é um documento
// com tipos possíveis: 'faq', 'documento', 'produto', 'regra'
const baseConhecimentoSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Tipo da entrada (cada tipo tem campos próprios abaixo)
  tipo: {
    type: String,
    enum: ['faq', 'documento', 'produto', 'regra'],
    required: true,
    index: true
  },

  // === Campos comuns ===
  tags: [{ type: String }],

  // === FAQ ===
  pergunta: { type: String, default: '' },
  resposta: { type: String, default: '' },

  // === Documento ===
  titulo: { type: String, default: '' },
  texto: { type: String, default: '' },

  // === Produto ===
  nome: { type: String, default: '' },
  preco: { type: Number, default: 0 },
  categoria: { type: String, default: '' },
  descricao: { type: String, default: '' },
  disponivel: { type: Boolean, default: true },

  // === Regra ===
  gatilho: { type: String, default: '' },
  acao: { type: String, default: '' },

  // Texto consolidado para busca (preenchido no pre-save)
  textoBusca: { type: String, default: '' },

  // Tokens consumidos quando esse item já foi injetado em alguma resposta (opcional)
  usos: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

baseConhecimentoSchema.index({ userId: 1, tipo: 1 })

baseConhecimentoSchema.pre('save', function (next) {
  // Constrói um texto único de busca juntando todos os campos relevantes
  const pedacos = []
  pedacos.push(this.tags.join(' '))
  if (this.tipo === 'faq') {
    pedacos.push(this.pergunta, this.resposta)
  } else if (this.tipo === 'documento') {
    pedacos.push(this.titulo, this.texto)
  } else if (this.tipo === 'produto') {
    pedacos.push(this.nome, this.categoria, this.descricao)
    pedacos.push(this.disponivel ? 'disponível' : 'indisponível')
    pedacos.push(`preço ${this.preco}`)
  } else if (this.tipo === 'regra') {
    pedacos.push(this.gatilho, this.acao)
  }
  this.textoBusca = pedacos.filter(Boolean).join(' ').toLowerCase().trim()
  this.updatedAt = new Date()
  next()
})

module.exports = mongoose.model('BaseConhecimento', baseConhecimentoSchema)
