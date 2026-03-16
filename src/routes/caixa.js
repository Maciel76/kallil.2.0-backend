const express = require('express')
const router = express.Router()
const Caixa = require('../models/Caixa')
const Venda = require('../models/Venda')
const Despesa = require('../models/Despesa')
const auth = require('../middleware/auth')
const { verificarAssinatura, verificarLimite } = require('../middleware/assinatura')

router.use(auth)
router.use(verificarAssinatura)

// POST /api/caixa/abrir — abre um novo caixa (permite múltiplos)
router.post('/abrir', verificarLimite('caixas'), async (req, res) => {
  try {
    const { valorInicial = 0, nome } = req.body

    // Se for dono, operador fica como '-----' até um operador entrar
    // Se for operador (abrindo diretamente), preenche o nome
    let operadorNome = '-----'
    let operadorId = null

    if (req.userRole === 'operador') {
      const User = require('../models/User')
      const currentUser = await User.findById(req.userRealId)
      operadorNome = currentUser ? currentUser.nome : ''
      operadorId = req.userRealId
    }

    // Calcular próximo número de caixa
    const caixasAbertos = await Caixa.find({ userId: req.userId, status: 'aberto' })
    const numeros = caixasAbertos.map(c => c.numero || 0).filter(n => !isNaN(n))
    const numero = numeros.length > 0
      ? Math.max(...numeros) + 1
      : 1

    const caixa = await Caixa.create({
      userId: req.userId,
      numero,
      nome: nome || `Caixa ${numero}`,
      operador: operadorNome,
      operadorId,
      valorInicial,
      saldoFinal: valorInicial
    })

    res.status(201).json(caixa)
  } catch (error) {
    console.error('Erro ao abrir caixa:', error)
    res.status(500).json({ message: 'Erro ao abrir caixa.', error: error.message })
  }
})

// POST /api/caixa/entrar/:id — operador entra em um caixa existente
router.post('/entrar/:id', async (req, res) => {
  try {
    const { valorAbertura } = req.body
    const caixa = await Caixa.findOne({ _id: req.params.id, userId: req.userId, status: 'aberto' })
    if (!caixa) {
      return res.status(400).json({ message: 'Caixa não encontrado ou já fechado.' })
    }

    // Verificar se já está em uso por outro operador
    if (caixa.operadorId && caixa.operadorId.toString() !== req.userRealId.toString()) {
      return res.status(400).json({ message: 'Este caixa já está em uso por outro operador.' })
    }

    const User = require('../models/User')
    const operador = await User.findById(req.userRealId)

    caixa.operador = operador ? operador.nome : ''
    caixa.operadorId = req.userRealId
    if (valorAbertura !== undefined && valorAbertura !== null) {
      caixa.valorInicial = valorAbertura
      caixa.saldoFinal = valorAbertura
    }
    await caixa.save()

    res.json(caixa)
  } catch (error) {
    console.error('Erro ao entrar no caixa:', error)
    res.status(500).json({ message: 'Erro ao entrar no caixa.', error: error.message })
  }
})

// POST /api/caixa/fechar/:id — fecha um caixa específico
router.post('/fechar/:id', async (req, res) => {
  try {
    const { valorFechamento } = req.body
    const caixa = await Caixa.findOne({ _id: req.params.id, userId: req.userId, status: 'aberto' })
    if (!caixa) {
      return res.status(400).json({ message: 'Caixa não encontrado ou já fechado.' })
    }

    // Calcular totais baseado nas vendas vinculadas a este caixa
    const vendas = await Venda.find({
      caixaId: caixa._id,
      status: { $in: ['pago', 'fiado'] }
    })
    const despesas = await Despesa.find({
      userId: req.userId,
      data: { $gte: caixa.aberturaEm, $lte: new Date() }
    })

    const vendasPagas = vendas.filter(v => v.status === 'pago')
    const vendasFiado = vendas.filter(v => v.status === 'fiado')

    const totalVendas = vendasPagas.reduce((acc, v) => acc + v.totalFinal, 0)
    const totalVendasPrazo = vendasFiado.reduce((acc, v) => acc + v.totalFinal, 0)
    const totalDespesas = despesas.reduce((acc, d) => acc + d.valor, 0)
    const lucroTotal = vendas.reduce((acc, v) => acc + (v.lucroTotal || 0), 0)
    const saldoFinal = caixa.valorInicial + totalVendas - totalDespesas

    // Garantir campo numero para caixas antigos
    if (!caixa.numero) caixa.numero = 1

    caixa.totalVendas = totalVendas
    caixa.totalVendasPrazo = totalVendasPrazo
    caixa.totalDespesas = totalDespesas
    caixa.lucroTotal = lucroTotal
    caixa.saldoFinal = saldoFinal
    if (valorFechamento !== undefined && valorFechamento !== null) {
      caixa.valorFechamento = valorFechamento
    }
    caixa.status = 'fechado'
    caixa.fechamentoEm = new Date()
    await caixa.save()

    res.json(caixa)
  } catch (error) {
    console.error('Erro ao fechar caixa:', error)
    res.status(500).json({ message: 'Erro ao fechar caixa.', error: error.message })
  }
})

// GET /api/caixa/abertos — lista todos os caixas abertos
router.get('/abertos', async (req, res) => {
  try {
    const caixas = await Caixa.find({ userId: req.userId, status: 'aberto' }).sort({ numero: 1 })
    
    // Calcular totais em tempo real para cada caixa
    const caixasComTotais = await Promise.all(caixas.map(async (caixa) => {
      const vendas = await Venda.find({
        caixaId: caixa._id,
        status: { $in: ['pago', 'fiado'] }
      })

      const vendasPagas = vendas.filter(v => v.status === 'pago')
      const vendasFiado = vendas.filter(v => v.status === 'fiado')

      const totalVendas = vendasPagas.reduce((acc, v) => acc + v.totalFinal, 0)
      const totalVendasPrazo = vendasFiado.reduce((acc, v) => acc + v.totalFinal, 0)
      const lucroTotal = vendas.reduce((acc, v) => acc + (v.lucroTotal || 0), 0)

      return {
        ...caixa.toObject(),
        totalVendas,
        totalVendasPrazo,
        lucroTotal,
        saldoFinal: caixa.valorInicial + totalVendas,
        qtdVendas: vendasPagas.length
      }
    }))

    res.json(caixasComTotais)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar caixas abertos.' })
  }
})

// GET /api/caixa/atual — compatibilidade (retorna primeiro caixa aberto)
router.get('/atual', async (req, res) => {
  try {
    const caixas = await Caixa.find({ userId: req.userId, status: 'aberto' }).sort({ numero: 1 })
    if (caixas.length === 0) {
      return res.json({ aberto: false, caixa: null, caixas: [] })
    }

    const caixa = caixas[0]
    const vendas = await Venda.find({
      caixaId: caixa._id,
      status: { $in: ['pago', 'fiado'] }
    })

    const vendasPagas = vendas.filter(v => v.status === 'pago')
    const vendasFiado = vendas.filter(v => v.status === 'fiado')

    const totalVendas = vendasPagas.reduce((acc, v) => acc + v.totalFinal, 0)
    const totalVendasPrazo = vendasFiado.reduce((acc, v) => acc + v.totalFinal, 0)
    const lucroTotal = vendas.reduce((acc, v) => acc + (v.lucroTotal || 0), 0)

    res.json({
      aberto: true,
      caixa: {
        ...caixa.toObject(),
        totalVendas,
        totalVendasPrazo,
        lucroTotal,
        saldoFinal: caixa.valorInicial + totalVendas,
        qtdVendas: vendasPagas.length
      },
      caixas: caixas.map(c => ({ _id: c._id, numero: c.numero, nome: c.nome, operador: c.operador }))
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

// GET /api/caixa/:id — detalhes de um caixa específico
router.get('/:id', async (req, res) => {
  try {
    const caixa = await Caixa.findOne({ _id: req.params.id, userId: req.userId })
    if (!caixa) {
      return res.status(404).json({ message: 'Caixa não encontrado.' })
    }

    const vendas = await Venda.find({
      caixaId: caixa._id,
      status: { $in: ['pago', 'fiado'] }
    })

    const vendasPagas = vendas.filter(v => v.status === 'pago')
    const vendasFiado = vendas.filter(v => v.status === 'fiado')

    const totalVendas = vendasPagas.reduce((acc, v) => acc + v.totalFinal, 0)
    const totalVendasPrazo = vendasFiado.reduce((acc, v) => acc + v.totalFinal, 0)
    const lucroTotal = vendas.reduce((acc, v) => acc + (v.lucroTotal || 0), 0)

    res.json({
      ...caixa.toObject(),
      totalVendas,
      totalVendasPrazo,
      lucroTotal,
      saldoFinal: caixa.valorInicial + totalVendas,
      qtdVendas: vendasPagas.length
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar caixa.' })
  }
})

module.exports = router
