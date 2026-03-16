const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const Venda = require('../models/Venda')
const auth = require('../middleware/auth')
const { verificarAssinatura } = require('../middleware/assinatura')

router.use(auth)
router.use(verificarAssinatura)

// GET /api/relatorios/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const fimHoje = new Date()
    fimHoje.setHours(23, 59, 59, 999)

    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)

    const [vendasHoje, vendasMes] = await Promise.all([
      Venda.find({ userId: req.userId, createdAt: { $gte: hoje, $lte: fimHoje }, status: 'pago' }),
      Venda.find({ userId: req.userId, createdAt: { $gte: inicioMes }, status: { $in: ['pago', 'fiado'] } })
    ])

    const totalHoje = vendasHoje.reduce((acc, v) => acc + v.totalFinal, 0)
    const lucroHoje = vendasHoje.reduce((acc, v) => acc + (v.lucroTotal || 0), 0)
    const totalMes = vendasMes.reduce((acc, v) => acc + v.totalFinal, 0)
    const lucroMes = vendasMes.reduce((acc, v) => acc + (v.lucroTotal || 0), 0)

    // Últimos 7 dias
    const seteDias = []
    for (let i = 6; i >= 0; i--) {
      const dia = new Date()
      dia.setDate(dia.getDate() - i)
      dia.setHours(0, 0, 0, 0)
      const fimDia = new Date(dia)
      fimDia.setHours(23, 59, 59, 999)

      const vendas = await Venda.find({
        userId: req.userId,
        createdAt: { $gte: dia, $lte: fimDia },
        status: 'pago'
      })
      seteDias.push({
        data: dia.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }),
        total: vendas.reduce((acc, v) => acc + v.totalFinal, 0),
        quantidade: vendas.length
      })
    }

    // Formas de pagamento (mês)
    const formasPagamento = {}
    vendasMes.forEach(v => {
      formasPagamento[v.formaPagamento] = (formasPagamento[v.formaPagamento] || 0) + v.totalFinal
    })

    res.json({
      totalHoje,
      lucroHoje,
      qtdVendasHoje: vendasHoje.length,
      totalMes,
      lucroMes,
      qtdVendasMes: vendasMes.length,
      graficoSemana: seteDias,
      formasPagamento
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar dashboard.' })
  }
})

// GET /api/relatorios/produtos-mais-vendidos
router.get('/produtos-mais-vendidos', async (req, res) => {
  try {
    const resultado = await Venda.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.userId), status: 'pago' } },
      { $unwind: '$itens' },
      { $group: { _id: '$itens.nome', total: { $sum: '$itens.qty' }, receita: { $sum: '$itens.subtotal' } } },
      { $sort: { total: -1 } },
      { $limit: 5 }
    ])
    res.json(resultado)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar produtos mais vendidos.' })
  }
})

// GET /api/relatorios/formas-pagamento
router.get('/formas-pagamento', async (req, res) => {
  try {
    const { inicio, fim } = req.query
    const filtro = { userId: new mongoose.Types.ObjectId(req.userId), status: 'pago' }

    if (inicio || fim) {
      filtro.createdAt = {}
      if (inicio) filtro.createdAt.$gte = new Date(inicio)
      if (fim) filtro.createdAt.$lte = new Date(fim + 'T23:59:59')
    }

    const resultado = await Venda.aggregate([
      { $match: filtro },
      { $group: { _id: '$formaPagamento', total: { $sum: '$totalFinal' }, quantidade: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ])
    res.json(resultado)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar formas de pagamento.' })
  }
})

// GET /api/relatorios/vendas?inicio=&fim=
router.get('/vendas', async (req, res) => {
  try {
    const { inicio, fim } = req.query
    const filtro = { userId: req.userId, status: { $ne: 'cancelado' } }

    if (inicio || fim) {
      filtro.createdAt = {}
      if (inicio) filtro.createdAt.$gte = new Date(inicio)
      if (fim) filtro.createdAt.$lte = new Date(fim + 'T23:59:59')
    }

    const vendas = await Venda.find(filtro).sort({ createdAt: -1 })
    const totalVendas = vendas.reduce((acc, v) => acc + v.totalFinal, 0)
    const totalDescontos = vendas.reduce((acc, v) => acc + v.desconto, 0)
    const lucroTotal = vendas.reduce((acc, v) => acc + (v.lucroTotal || 0), 0)

    res.json({
      vendas,
      resumo: {
        quantidade: vendas.length,
        totalVendas,
        totalDescontos,
        lucroTotal
      }
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar relatório de vendas.' })
  }
})

// GET /api/relatorios/caixas-resumo?periodo=hoje|ontem|7dias|30dias|mes
router.get('/caixas-resumo', async (req, res) => {
  try {
    const { periodo = 'hoje' } = req.query
    const agora = new Date()
    let inicio, fim

    switch (periodo) {
      case 'hoje':
        inicio = new Date(agora); inicio.setHours(0, 0, 0, 0)
        fim = new Date(agora); fim.setHours(23, 59, 59, 999)
        break
      case 'ontem':
        inicio = new Date(agora); inicio.setDate(inicio.getDate() - 1); inicio.setHours(0, 0, 0, 0)
        fim = new Date(agora); fim.setDate(fim.getDate() - 1); fim.setHours(23, 59, 59, 999)
        break
      case '7dias':
        inicio = new Date(agora); inicio.setDate(inicio.getDate() - 7); inicio.setHours(0, 0, 0, 0)
        fim = new Date(agora); fim.setHours(23, 59, 59, 999)
        break
      case '30dias':
        inicio = new Date(agora); inicio.setDate(inicio.getDate() - 30); inicio.setHours(0, 0, 0, 0)
        fim = new Date(agora); fim.setHours(23, 59, 59, 999)
        break
      case 'mes':
        inicio = new Date(agora.getFullYear(), agora.getMonth(), 1)
        fim = new Date(agora); fim.setHours(23, 59, 59, 999)
        break
      default:
        inicio = new Date(agora); inicio.setHours(0, 0, 0, 0)
        fim = new Date(agora); fim.setHours(23, 59, 59, 999)
    }

    const Caixa = require('../models/Caixa')

    const caixas = await Caixa.find({
      userId: req.userId,
      status: 'fechado',
      fechamentoEm: { $gte: inicio, $lte: fim }
    }).sort({ fechamentoEm: -1 })

    const totalAbertura = caixas.reduce((acc, c) => acc + c.valorInicial, 0)
    const totalFechamento = caixas.reduce((acc, c) => acc + (c.valorFechamento || 0), 0)
    const totalVendas = caixas.reduce((acc, c) => acc + c.totalVendas, 0)
    const totalDespesas = caixas.reduce((acc, c) => acc + c.totalDespesas, 0)
    const lucroEstimado = caixas.reduce((acc, c) => acc + c.lucroTotal, 0)

    res.json({
      caixas: caixas.map(c => ({
        id: c._id,
        nome: c.nome,
        operador: c.operador,
        valorInicial: c.valorInicial,
        valorFechamento: c.valorFechamento,
        totalVendas: c.totalVendas,
        totalDespesas: c.totalDespesas,
        lucroTotal: c.lucroTotal,
        saldoFinal: c.saldoFinal,
        aberturaEm: c.aberturaEm,
        fechamentoEm: c.fechamentoEm
      })),
      resumo: {
        totalCaixas: caixas.length,
        totalAbertura,
        totalFechamento,
        totalVendas,
        totalDespesas,
        lucroEstimado
      }
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar resumo de caixas.' })
  }
})

module.exports = router
