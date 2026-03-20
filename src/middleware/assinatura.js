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

module.exports = { verificarAssinatura, verificarLimite, apenasPlanoProf }
