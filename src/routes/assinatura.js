const express = require('express')
const router = express.Router()
const User = require('../models/User')
const PlanoConfig = require('../models/PlanoConfig')
const auth = require('../middleware/auth')
const { authorize } = require('../middleware/auth')

// =======================================
// ROTAS PÚBLICAS (usuário autenticado)
// =======================================

// GET /api/assinatura/meu-plano — retorna info do plano do usuário logado
router.get('/meu-plano', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' })

    const config = await PlanoConfig.getConfig()
    const agora = new Date()

    // Atualizar status se expirou
    if (user.assinaturaStatus === 'teste' && user.testeExpira && user.testeExpira < agora) {
      user.assinaturaStatus = 'expirado'
      await user.save()
    }
    if (user.plano === 'pago' && user.assinaturaExpira && user.assinaturaExpira < agora) {
      user.assinaturaStatus = 'expirado'
      user.plano = 'gratuito'
      await user.save()
    }

    const limites = user.plano === 'pago' && user.assinaturaStatus === 'ativo'
      ? config.pago
      : (user.assinaturaStatus === 'teste' && user.testeExpira > agora ? config.pago : config.gratuito)

    res.json({
      plano: user.plano,
      status: user.assinaturaStatus,
      assinaturaInicio: user.assinaturaInicio,
      assinaturaExpira: user.assinaturaExpira,
      testeExpira: user.testeExpira,
      limites: {
        maxProdutos: limites.maxProdutos,
        maxVendasMes: limites.maxVendasMes,
        maxOperadores: limites.maxOperadores,
        maxCaixas: limites.maxCaixas,
        maxClientes: limites.maxClientes,
        relatoriosAvancados: limites.relatoriosAvancados,
        personalizacaoPDV: limites.personalizacaoPDV,
        suportePrioritario: limites.suportePrioritario
      },
      planoProf: {
        nome: config.pago.nome,
        valorMensal: config.pago.valorMensal
      }
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar plano.' })
  }
})

// =======================================
// ROTAS DE ADMIN
// =======================================

// GET /api/assinatura/config — retorna configuração dos planos (admin)
router.get('/config', auth, authorize('admin'), async (req, res) => {
  try {
    const config = await PlanoConfig.getConfig()
    res.json(config)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar configuração.' })
  }
})

// PUT /api/assinatura/config — atualizar configuração dos planos (admin)
router.put('/config', auth, authorize('admin'), async (req, res) => {
  try {
    const config = await PlanoConfig.getConfig()
    const { gratuito, pago, diasTeste } = req.body

    if (gratuito) {
      if (gratuito.maxProdutos !== undefined) config.gratuito.maxProdutos = gratuito.maxProdutos
      if (gratuito.maxVendasMes !== undefined) config.gratuito.maxVendasMes = gratuito.maxVendasMes
      if (gratuito.maxOperadores !== undefined) config.gratuito.maxOperadores = gratuito.maxOperadores
      if (gratuito.maxClientes !== undefined) config.gratuito.maxClientes = gratuito.maxClientes
      if (gratuito.maxCaixas !== undefined) config.gratuito.maxCaixas = gratuito.maxCaixas
      if (gratuito.relatoriosAvancados !== undefined) config.gratuito.relatoriosAvancados = gratuito.relatoriosAvancados
      if (gratuito.personalizacaoPDV !== undefined) config.gratuito.personalizacaoPDV = gratuito.personalizacaoPDV
      if (gratuito.suportePrioritario !== undefined) config.gratuito.suportePrioritario = gratuito.suportePrioritario
    }

    if (pago) {
      if (pago.nome !== undefined) config.pago.nome = pago.nome
      if (pago.valorMensal !== undefined) config.pago.valorMensal = pago.valorMensal
      if (pago.maxProdutos !== undefined) config.pago.maxProdutos = pago.maxProdutos
      if (pago.maxVendasMes !== undefined) config.pago.maxVendasMes = pago.maxVendasMes
      if (pago.maxOperadores !== undefined) config.pago.maxOperadores = pago.maxOperadores
      if (pago.maxClientes !== undefined) config.pago.maxClientes = pago.maxClientes
      if (pago.maxCaixas !== undefined) config.pago.maxCaixas = pago.maxCaixas
      if (pago.relatoriosAvancados !== undefined) config.pago.relatoriosAvancados = pago.relatoriosAvancados
      if (pago.personalizacaoPDV !== undefined) config.pago.personalizacaoPDV = pago.personalizacaoPDV
      if (pago.suportePrioritario !== undefined) config.pago.suportePrioritario = pago.suportePrioritario
    }

    if (diasTeste !== undefined) config.diasTeste = diasTeste

    await config.save()
    res.json(config)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar configuração.' })
  }
})

// GET /api/assinatura/admin/resumo — estatísticas de assinaturas (admin)
router.get('/admin/resumo', auth, authorize('admin'), async (req, res) => {
  try {
    const [totalDonos, emTeste, gratuitos, pagos, expirados, cancelados] = await Promise.all([
      User.countDocuments({ role: 'dono' }),
      User.countDocuments({ role: 'dono', assinaturaStatus: 'teste' }),
      User.countDocuments({ role: 'dono', plano: 'gratuito', assinaturaStatus: { $ne: 'teste' } }),
      User.countDocuments({ role: 'dono', plano: 'pago', assinaturaStatus: 'ativo' }),
      User.countDocuments({ role: 'dono', assinaturaStatus: 'expirado' }),
      User.countDocuments({ role: 'dono', assinaturaStatus: 'cancelado' })
    ])

    const config = await PlanoConfig.getConfig()
    const receitaMensal = pagos * config.pago.valorMensal

    res.json({
      totalDonos,
      emTeste,
      gratuitos,
      pagos,
      expirados,
      cancelados,
      receitaMensal,
      valorMensal: config.pago.valorMensal
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar resumo.' })
  }
})

// GET /api/assinatura/admin/usuarios — listar usuários com info de assinatura (admin)
router.get('/admin/usuarios', auth, authorize('admin'), async (req, res) => {
  try {
    const { busca, plano, status, page = 1, limit = 20 } = req.query
    const filtro = { role: 'dono' }

    if (plano && ['gratuito', 'pago'].includes(plano)) filtro.plano = plano
    if (status && ['ativo', 'teste', 'expirado', 'cancelado'].includes(status)) filtro.assinaturaStatus = status

    if (busca) {
      const escapedBusca = busca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filtro.$or = [
        { nome: { $regex: escapedBusca, $options: 'i' } },
        { nomeNegocio: { $regex: escapedBusca, $options: 'i' } },
        { email: { $regex: escapedBusca, $options: 'i' } }
      ]
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const total = await User.countDocuments(filtro)
    const usuarios = await User.find(filtro)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))

    const lista = usuarios.map(u => ({
      id: u._id,
      nome: u.nome,
      email: u.email,
      nomeNegocio: u.nomeNegocio,
      plano: u.plano,
      assinaturaStatus: u.assinaturaStatus,
      assinaturaInicio: u.assinaturaInicio,
      assinaturaExpira: u.assinaturaExpira,
      testeExpira: u.testeExpira,
      ativo: u.ativo,
      createdAt: u.createdAt
    }))

    res.json({ usuarios: lista, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar assinaturas.' })
  }
})

// PATCH /api/assinatura/admin/usuarios/:id — alterar plano de um usuário (admin)
router.patch('/admin/usuarios/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user || user.role !== 'dono') {
      return res.status(404).json({ message: 'Usuário não encontrado.' })
    }

    const { plano, meses } = req.body

    if (plano === 'pago') {
      const duracao = parseInt(meses) || 1
      user.plano = 'pago'
      user.assinaturaStatus = 'ativo'
      user.assinaturaInicio = new Date()
      user.assinaturaExpira = new Date(Date.now() + duracao * 30 * 24 * 60 * 60 * 1000)
    } else if (plano === 'gratuito') {
      user.plano = 'gratuito'
      user.assinaturaStatus = 'expirado'
      user.assinaturaExpira = null
      user.assinaturaInicio = null
    }

    await user.save()
    res.json({
      id: user._id,
      plano: user.plano,
      assinaturaStatus: user.assinaturaStatus,
      assinaturaInicio: user.assinaturaInicio,
      assinaturaExpira: user.assinaturaExpira
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar assinatura.' })
  }
})

// PATCH /api/assinatura/admin/usuarios/:id/renovar — renovar assinatura (admin)
router.patch('/admin/usuarios/:id/renovar', auth, authorize('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user || user.role !== 'dono') {
      return res.status(404).json({ message: 'Usuário não encontrado.' })
    }

    const { meses } = req.body
    const duracao = parseInt(meses) || 1

    // Se já tem data de expiração futura, estender a partir dela
    const base = user.assinaturaExpira && user.assinaturaExpira > new Date()
      ? user.assinaturaExpira
      : new Date()

    user.plano = 'pago'
    user.assinaturaStatus = 'ativo'
    if (!user.assinaturaInicio) user.assinaturaInicio = new Date()
    user.assinaturaExpira = new Date(base.getTime() + duracao * 30 * 24 * 60 * 60 * 1000)

    await user.save()
    res.json({
      id: user._id,
      plano: user.plano,
      assinaturaStatus: user.assinaturaStatus,
      assinaturaInicio: user.assinaturaInicio,
      assinaturaExpira: user.assinaturaExpira
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao renovar assinatura.' })
  }
})

module.exports = router
