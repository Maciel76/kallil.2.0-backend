const mongoose = require('mongoose')

// Plano do catálogo — criado e gerenciado pelo admin na aba "Planos e Preços"
const planoItemSchema = new mongoose.Schema({
  slug: { type: String, required: true, trim: true, lowercase: true },
  nome: { type: String, required: true, trim: true },
  descricao: { type: String, default: '', trim: true },
  tipo: { type: String, enum: ['base', 'addon'], default: 'base' },
  valorMensal: { type: Number, default: 0, min: 0 },
  valorAnual: { type: Number, default: 0, min: 0 },
  destaque: { type: Boolean, default: false },
  ativo: { type: Boolean, default: true },
  cor: { type: String, default: '#4f46e5' },
  icone: { type: String, default: 'fas fa-gem' },
  ordem: { type: Number, default: 0 },
  // Planos do sistema (gratuito/pago/whatsapp): espelham os campos legados e não podem ser excluídos
  sistema: { type: Boolean, default: false },
  limites: {
    maxProdutos: { type: Number, default: 0 },   // 0 = ilimitado
    maxVendasMes: { type: Number, default: 0 },
    maxOperadores: { type: Number, default: 0 },
    maxClientes: { type: Number, default: 0 },
    maxCaixas: { type: Number, default: 0 }
  },
  recursos: {
    relatoriosAvancados: { type: Boolean, default: false },
    personalizacaoPDV: { type: Boolean, default: false },
    suportePrioritario: { type: Boolean, default: false },
    automacaoWhatsapp: { type: Boolean, default: false }
  },
  beneficios: { type: [String], default: [] }
}, { timestamps: true })

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
  // Add-on: Automação WhatsApp (cobrado separadamente)
  whatsapp: {
    nome: { type: String, default: 'Automação WhatsApp' },
    valorMensal: { type: Number, default: 89.90 },
    ativo: { type: Boolean, default: true },
    // Recursos individuais — admin pode ligar/desligar
    workflows: { type: Boolean, default: true },
    cobrancaAutomatica: { type: Boolean, default: true },
    enviarCupom: { type: Boolean, default: true },
    resumoDiario: { type: Boolean, default: true },
    importacaoIlimitada: { type: Boolean, default: true },
    cobrarClientes: { type: Boolean, default: true }
  },
  // Catálogo de planos gerenciado pelo admin
  planos: { type: [planoItemSchema], default: [] },
  // Dias de teste grátis para novos usuários
  diasTeste: { type: Number, default: 7 }
}, { timestamps: true })

// Catálogo inicial montado a partir dos planos legados do sistema
function montarPlanosPadrao (config) {
  return [
    {
      slug: 'gratuito',
      nome: 'Gratuito',
      descricao: 'Plano de entrada, com funcionalidades limitadas.',
      tipo: 'base',
      valorMensal: 0,
      ativo: true,
      sistema: true,
      ordem: 0,
      cor: '#6b7280',
      icone: 'fas fa-gift',
      limites: {
        maxProdutos: config.gratuito.maxProdutos,
        maxVendasMes: config.gratuito.maxVendasMes,
        maxOperadores: config.gratuito.maxOperadores,
        maxClientes: config.gratuito.maxClientes,
        maxCaixas: config.gratuito.maxCaixas
      },
      recursos: {
        relatoriosAvancados: config.gratuito.relatoriosAvancados,
        personalizacaoPDV: config.gratuito.personalizacaoPDV,
        suportePrioritario: config.gratuito.suportePrioritario,
        automacaoWhatsapp: false
      }
    },
    {
      slug: 'pago',
      nome: config.pago.nome || 'Profissional',
      descricao: 'Funcionalidades completas para assinantes.',
      tipo: 'base',
      valorMensal: config.pago.valorMensal,
      ativo: true,
      destaque: true,
      sistema: true,
      ordem: 1,
      cor: '#4f46e5',
      icone: 'fas fa-gem',
      limites: {
        maxProdutos: config.pago.maxProdutos,
        maxVendasMes: config.pago.maxVendasMes,
        maxOperadores: config.pago.maxOperadores,
        maxClientes: config.pago.maxClientes,
        maxCaixas: config.pago.maxCaixas
      },
      recursos: {
        relatoriosAvancados: config.pago.relatoriosAvancados,
        personalizacaoPDV: config.pago.personalizacaoPDV,
        suportePrioritario: config.pago.suportePrioritario,
        automacaoWhatsapp: false
      }
    },
    {
      slug: 'whatsapp',
      nome: config.whatsapp?.nome || 'Automação WhatsApp',
      descricao: 'Add-on vendido separadamente. Libera o módulo de automação.',
      tipo: 'addon',
      valorMensal: config.whatsapp?.valorMensal ?? 89.90,
      ativo: config.whatsapp?.ativo !== false,
      sistema: true,
      ordem: 2,
      cor: '#25d366',
      icone: 'fab fa-whatsapp',
      recursos: { automacaoWhatsapp: true }
    }
  ]
}

// Espelha um plano do sistema de volta nos campos legados usados pelo restante da API
planoConfigSchema.statics.sincronizarLegado = function (config, plano) {
  if (!plano || !plano.sistema) return

  if (plano.slug === 'gratuito') {
    config.gratuito.maxProdutos = plano.limites.maxProdutos
    config.gratuito.maxVendasMes = plano.limites.maxVendasMes
    config.gratuito.maxOperadores = plano.limites.maxOperadores
    config.gratuito.maxClientes = plano.limites.maxClientes
    config.gratuito.maxCaixas = plano.limites.maxCaixas
    config.gratuito.relatoriosAvancados = plano.recursos.relatoriosAvancados
    config.gratuito.personalizacaoPDV = plano.recursos.personalizacaoPDV
    config.gratuito.suportePrioritario = plano.recursos.suportePrioritario
  }

  if (plano.slug === 'pago') {
    config.pago.nome = plano.nome
    config.pago.valorMensal = plano.valorMensal
    config.pago.maxProdutos = plano.limites.maxProdutos
    config.pago.maxVendasMes = plano.limites.maxVendasMes
    config.pago.maxOperadores = plano.limites.maxOperadores
    config.pago.maxClientes = plano.limites.maxClientes
    config.pago.maxCaixas = plano.limites.maxCaixas
    config.pago.relatoriosAvancados = plano.recursos.relatoriosAvancados
    config.pago.personalizacaoPDV = plano.recursos.personalizacaoPDV
    config.pago.suportePrioritario = plano.recursos.suportePrioritario
  }

  if (plano.slug === 'whatsapp') {
    config.whatsapp.nome = plano.nome
    config.whatsapp.valorMensal = plano.valorMensal
    config.whatsapp.ativo = plano.ativo
  }
}

// Reflete os campos legados no plano do sistema equivalente (usado ao salvar a config antiga)
planoConfigSchema.statics.sincronizarCatalogo = function (config) {
  const aplicar = (slug, dados) => {
    const plano = (config.planos || []).find(p => p.slug === slug)
    if (!plano) return
    Object.assign(plano, dados)
  }

  aplicar('gratuito', {
    limites: {
      maxProdutos: config.gratuito.maxProdutos,
      maxVendasMes: config.gratuito.maxVendasMes,
      maxOperadores: config.gratuito.maxOperadores,
      maxClientes: config.gratuito.maxClientes,
      maxCaixas: config.gratuito.maxCaixas
    },
    recursos: {
      relatoriosAvancados: config.gratuito.relatoriosAvancados,
      personalizacaoPDV: config.gratuito.personalizacaoPDV,
      suportePrioritario: config.gratuito.suportePrioritario,
      automacaoWhatsapp: false
    }
  })

  aplicar('pago', {
    nome: config.pago.nome,
    valorMensal: config.pago.valorMensal,
    limites: {
      maxProdutos: config.pago.maxProdutos,
      maxVendasMes: config.pago.maxVendasMes,
      maxOperadores: config.pago.maxOperadores,
      maxClientes: config.pago.maxClientes,
      maxCaixas: config.pago.maxCaixas
    },
    recursos: {
      relatoriosAvancados: config.pago.relatoriosAvancados,
      personalizacaoPDV: config.pago.personalizacaoPDV,
      suportePrioritario: config.pago.suportePrioritario,
      automacaoWhatsapp: false
    }
  })

  aplicar('whatsapp', {
    nome: config.whatsapp.nome,
    valorMensal: config.whatsapp.valorMensal,
    ativo: config.whatsapp.ativo
  })
}

// Garantir que exista apenas um documento de configuração
planoConfigSchema.statics.getConfig = async function () {
  let config = await this.findOne()
  if (!config) {
    config = await this.create({})
  }
  if (!config.planos || config.planos.length === 0) {
    config.planos = montarPlanosPadrao(config)
    await config.save()
  }
  return config
}

module.exports = mongoose.model('PlanoConfig', planoConfigSchema)
