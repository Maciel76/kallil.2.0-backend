const express = require('express')
const router = express.Router()
const Caixa = require('../models/Caixa')
const Venda = require('../models/Venda')
const Despesa = require('../models/Despesa')
const auth = require('../middleware/auth')

router.use(auth)

// POST /api/caixa/abrir
router.post('/abrir', async (req, res) => {
  try {
    // Verificar se já existe caixa aberto
    const caixaAberto = await Caixa.findOne({ userId: req.userId, status: 'aberto' })
    if (caixaAberto) {
      return res.status(400).json({ message: 'Já existe um caixa aberto. Feche-o antes de abrir outro.' })
    }

    const { valorInicial = 0 } = req.body
    const caixa = await Caixa.create({
      userId: req.userId,
      valorInicial,
      saldoFinal: valorInicial
    })

    res.status(201).json(caixa)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao abrir caixa.' })
  }
})

// POST /api/caixa/fechar
router.post('/fechar', async (req, res) => {
  try {
    const caixa = await Caixa.findOne({ userId: req.userId, status: 'aberto' })
    if (!caixa) {
      return res.status(400).json({ message: 'Nenhum caixa aberto para fechar.' })
    }

    // Calcular totais do período
    const vendas = await Venda.find({
      userId: req.userId,
      createdAt: { $gte: caixa.aberturaEm },
      status: { $in: ['pago', 'fiado'] }
    })
    const despesas = await Despesa.find({
      userId: req.userId,
      data: { $gte: caixa.aberturaEm }
    })

    const vendasPagas = vendas.filter(v => v.status === 'pago')
    const vendasFiado = vendas.filter(v => v.status === 'fiado')

    const totalVendas = vendasPagas.reduce((acc, v) => acc + v.totalFinal, 0)
    const totalVendasPrazo = vendasFiado.reduce((acc, v) => acc + v.totalFinal, 0)
    const totalDespesas = despesas.reduce((acc, d) => acc + d.valor, 0)
    const lucroTotal = vendas.reduce((acc, v) => acc + (v.lucroTotal || 0), 0)
    const saldoFinal = caixa.valorInicial + totalVendas - totalDespesas

    caixa.totalVendas = totalVendas
    caixa.totalVendasPrazo = totalVendasPrazo
    caixa.totalDespesas = totalDespesas
    caixa.lucroTotal = lucroTotal
    caixa.saldoFinal = saldoFinal
    caixa.status = 'fechado'
    caixa.fechamentoEm = new Date()
    await caixa.save()

    res.json(caixa)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao fechar caixa.' })
  }
})

// GET /api/caixa/atual
router.get('/atual', async (req, res) => {
  try {
    const caixa = await Caixa.findOne({ userId: req.userId, status: 'aberto' })
    if (!caixa) {
      return res.json({ aberto: false, caixa: null })
    }

    // Calcular em tempo real
    const vendas = await Venda.find({
      userId: req.userId,
      createdAt: { $gte: caixa.aberturaEm },
      status: { $in: ['pago', 'fiado'] }
    })
    const despesas = await Despesa.find({
      userId: req.userId,
      data: { $gte: caixa.aberturaEm }
    })

    const vendasPagas = vendas.filter(v => v.status === 'pago')
    const vendasFiado = vendas.filter(v => v.status === 'fiado')

    const totalVendas = vendasPagas.reduce((acc, v) => acc + v.totalFinal, 0)
    const totalVendasPrazo = vendasFiado.reduce((acc, v) => acc + v.totalFinal, 0)
    const totalDespesas = despesas.reduce((acc, d) => acc + d.valor, 0)
    const lucroTotal = vendas.reduce((acc, v) => acc + (v.lucroTotal || 0), 0)

    res.json({
      aberto: true,
      caixa: {
        ...caixa.toObject(),
        totalVendas,
        totalVendasPrazo,
        totalDespesas,
        lucroTotal,
        saldoFinal: caixa.valorInicial + totalVendas - totalDespesas,
        qtdVendas: vendasPagas.length
      }
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar caixa.' })
  }
})

// GET /api/caixa/historico
router.get('/historico', async (req, res) => {
  try {
    const caixas = await Caixa.find({ userId: req.userId, status: 'fechado' })
      .sort({ fechamentoEm: -1 })
      .limit(30)
    res.json(caixas)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar histórico de caixas.' })
  }
})

module.exports = router
