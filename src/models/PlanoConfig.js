const mongoose = require('mongoose')

const planoConfigSchema = new mongoose.Schema({
  // Valores e limites do plano gratuito
  gratuito: {
    maxProdutos: { type: Number, default: 30 },
    maxVendasMes: { type: Number, default: 50 },
    maxOperadores: { type: Number, default: 0 },
    maxCaixas: { type: Number, default: 1 },
    relatoriosAvancados: { type: Boolean, default: false },
    personalizacaoPDV: { type: Boolean, default: false },
    maxClientes: { type: Number, default: 20 },
    suportePrioritario: { type: Boolean, default: false }
  },
  // Valores e limites do plano pago
  pago: {
    nome: { type: String, default: 'Profissional' },
    valorMensal: { type: Number, default: 49.90 },
    maxProdutos: { type: Number, default: 0 },       // 0 = ilimitado
    maxVendasMes: { type: Number, default: 0 },       // 0 = ilimitado
    maxOperadores: { type: Number, default: 0 },      // 0 = ilimitado
    maxCaixas: { type: Number, default: 0 },            // 0 = ilimitado
    relatoriosAvancados: { type: Boolean, default: true },
    personalizacaoPDV: { type: Boolean, default: true },
    maxClientes: { type: Number, default: 0 },        // 0 = ilimitado
    suportePrioritario: { type: Boolean, default: true }
  },
  // Dias de teste grátis para novos usuários
  diasTeste: { type: Number, default: 7 }
}, { timestamps: true })

// Garantir que exista apenas um documento de configuração
planoConfigSchema.statics.getConfig = async function () {
  let config = await this.findOne()
  if (!config) {
    config = await this.create({})
  }
  return config
}

module.exports = mongoose.model('PlanoConfig', planoConfigSchema)
