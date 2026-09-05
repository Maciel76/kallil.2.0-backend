const User = require('../models/User')
const PlanoConfig = require('../models/PlanoConfig')
const Produto = require('../models/Produto')
const Venda = require('../models/Venda')
const Cliente = require('../models/Cliente')
const Caixa = require('../models/Caixa')
const { removerDespesaAssinatura } = require('../utils/assinaturaDespesa')

// Middleware que verifica se a assinatura está ativa
const verificarAssinatura = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId)
    if (!user || user.role === 'admin') return next()

    // Operadores herdam o plano do dono
    const donoId = user.role === 'operador' && user.donoId ? user.donoId : user._id
    const dono = user.role === 'operador' ? await User.findById(donoId) : user

    if (!dono) return next()

    const agora = new Date()

    // Verificar status da assinatura
    // Add-on WhatsApp ativo → equivale a plano pago (hierarquia superior)
    const whatsappAtivo = !!(dono.planoWhatsapp && dono.whatsappAssinaturaExpira && dono.whatsappAssinaturaExpira > agora)
    if (whatsappAtivo) {
      req.planoAtual = 'pago'
      req.whatsappAtivo = true
      req.assinaturaStatus = 'ativo'
      return next()
    }

    if (dono.plano === 'pago' && dono.assinaturaStatus === 'ativo') {
      if (dono.assinaturaExpira && dono.assinaturaExpira < agora) {
        dono.assinaturaStatus = 'expirado'
        dono.plano = 'gratuito'
        await dono.save()
        await removerDespesaAssinatura(dono._id)
      } else {
        req.planoAtual = 'pago'
        req.assinaturaStatus = 'ativo'
        return next()
      }
    }

    // Verificar período de teste
    if (dono.assinaturaStatus === 'teste') {
      if (dono.testeExpira && dono.testeExpira < agora) {
        dono.assinaturaStatus = 'expirado'
        await dono.save()
        req.planoAtual = 'gratuito'
        req.assinaturaStatus = 'expirado'
        return next()
      }
      req.planoAtual = 'pago' // durante teste, tem acesso completo
      req.assinaturaStatus = 'teste'
      return next()
    }

    req.planoAtual = 'gratuito'
    req.assinaturaStatus = dono.assinaturaStatus || 'gratuito'
    next()
  } catch (error) {
    next()
  }
}

// Middleware que verifica limites do plano antes de criar recursos
const verificarLimite = (recurso) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.userId)
      if (!user || user.role === 'admin') return next()

      // Se está no plano pago ativo ou em teste, sem limites
      if (req.planoAtual === 'pago') return next()

      const config = await PlanoConfig.getConfig()
      const limites = config.gratuito

      let count, max
      switch (recurso) {
        case 'produtos':
          count = await Produto.countDocuments({ userId: req.userId })
          max = limites.maxProdutos
          break
        case 'clientes':
          count = await Cliente.countDocuments({ userId: req.userId })
          max = limites.maxClientes
          break
        case 'vendas': {
          const inicioMes = new Date()
          inicioMes.setDate(1)
          inicioMes.setHours(0, 0, 0, 0)
          count = await Venda.countDocuments({ userId: req.userId, createdAt: { $gte: inicioMes } })
          max = limites.maxVendasMes
          break
        }
        case 'caixas':
          count = await Caixa.countDocuments({ userId: req.userId, status: 'aberto' })
          max = limites.maxCaixas
          break
        default:
          return next()
      }

      if (max > 0 && count >= max) {
        return res.status(403).json({
          message: `Limite do plano gratuito atingido para ${recurso}. Faça upgrade para o plano profissional.`,
          limiteAtingido: true,
          recurso,
          atual: count,
          limite: max
        })
      }

      next()
    } catch (error) {
      next()
    }
  }
}

// Middleware que restringe funcionalidades do plano pago
const apenasPlanoProf = (funcionalidade) => {
  return (req, res, next) => {
    if (req.planoAtual === 'pago') return next()
    return res.status(403).json({
      message: `"${funcionalidade}" está disponível apenas no plano profissional. Faça upgrade para acessar.`,
      planoNecessario: true,
      funcionalidade
    })
  }
}

// Recursos efetivos do dono: os do plano base contratado, somados aos dos add-ons ativos
const resolverRecursosPlano = async (dono) => {
  const config = await PlanoConfig.getConfig()
  const planos = config.planos || []
  const agora = new Date()

  const combinar = (destino, plano) => {
    if (!plano || !plano.recursos) return destino
    Object.keys(plano.recursos.toObject ? plano.recursos.toObject() : plano.recursos)
      .forEach(chave => { if (plano.recursos[chave]) destino[chave] = true })
    return destino
  }

  const recursos = {}
  const emTeste = dono.assinaturaStatus === 'teste' && dono.testeExpira && dono.testeExpira > agora
  const pagoAtivo = dono.plano === 'pago' && dono.assinaturaStatus === 'ativo' &&
    (!dono.assinaturaExpira || dono.assinaturaExpira > agora)

  if (pagoAtivo) {
    // Durante o teste vale o plano padrão pago; depois, o plano realmente contratado
    combinar(recursos, planos.find(p => p.slug === (dono.planoSlug || 'pago')))
  } else if (emTeste) {
    combinar(recursos, planos.find(p => p.slug === 'pago'))
  } else {
    combinar(recursos, planos.find(p => p.slug === 'gratuito'))
  }

  const whatsappAtivo = !!(dono.planoWhatsapp && dono.whatsappAssinaturaExpira && dono.whatsappAssinaturaExpira > agora)
  if (whatsappAtivo) combinar(recursos, planos.find(p => p.slug === 'whatsapp'))

  return recursos
}

// Middleware que exige um recurso marcado no plano (aba Planos e Preços do admin)
const exigirRecursoPlano = (chave, funcionalidade) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.userId)
      if (!user) return res.status(401).json({ message: 'Usuário não encontrado.' })
      if (user.role === 'admin') return next()

      // Operadores herdam o plano do dono
      const dono = user.role === 'operador' && user.donoId ? await User.findById(user.donoId) : user
      if (!dono) return res.status(401).json({ message: 'Negócio não encontrado.' })

      const recursos = await resolverRecursosPlano(dono)
      if (recursos[chave]) {
        req.recursosPlano = recursos
        return next()
      }

      return res.status(403).json({
        message: `"${funcionalidade}" não está incluído no seu plano. Fale com o suporte ou faça upgrade para liberar.`,
        planoNecessario: true,
        recurso: chave,
        funcionalidade
      })
    } catch (error) {
      return res.status(500).json({ message: 'Erro ao verificar o plano.' })
    }
  }
}

module.exports = {
  verificarAssinatura,
  verificarLimite,
  apenasPlanoProf,
  resolverRecursosPlano,
  exigirRecursoPlano
}
