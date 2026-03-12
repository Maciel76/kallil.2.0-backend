const express = require('express')
const router = express.Router()
const Venda = require('../models/Venda')
const Produto = require('../models/Produto')
const Cliente = require('../models/Cliente')
const crypto = require('crypto')
const auth = require('../middleware/auth')

router.use(auth)

// POST /api/vendas — finalizar venda
router.post('/', async (req, res) => {
  try {
    const { itens, desconto = 0, descontoTipo = 'valor', formaPagamento, clienteId, clienteNome, valorRecebido = 0, dataVencimento, observacoes, caixaId } = req.body

    if (!itens || itens.length === 0) {
      return res.status(400).json({ message: 'A venda deve ter ao menos um item.' })
    }

    // Calcular totais e dar baixa no estoque
    let total = 0
    let lucroTotal = 0
    const itensProcessados = []

    for (const item of itens) {
      const produto = await Produto.findOne({ _id: item.produtoId, userId: req.userId })
      if (!produto) return res.status(404).json({ message: `Produto ${item.produtoId} não encontrado.` })

      const subtotal = produto.precoVenda * item.qty
      const lucro = (produto.precoVenda - produto.precoCusto) * item.qty
      total += subtotal
      lucroTotal += lucro

      itensProcessados.push({
        produtoId: produto._id,
        nome: produto.nome,
        qty: item.qty,
        precoUnit: produto.precoVenda,
        precoCusto: produto.precoCusto,
        subtotal,
        lucro
      })

      // Baixar estoque e incrementar vendas
      await Produto.findByIdAndUpdate(produto._id, {
        $inc: { estoque: -item.qty, vendasTotal: item.qty }
      })
    }

    // Calcular desconto
    let descontoValor = desconto
    if (descontoTipo === 'percentual') {
      descontoValor = total * (desconto / 100)
    }

    const totalFinal = Math.max(0, total - descontoValor)
    const troco = formaPagamento === 'dinheiro' ? Math.max(0, valorRecebido - totalFinal) : 0
    const status = formaPagamento === 'fiado' ? 'fiado' : 'pago'

    // Ajustar lucro com desconto
    lucroTotal = Math.max(0, lucroTotal - descontoValor)

    const venda = await Venda.create({
      userId: req.userId,
      itens: itensProcessados,
      total,
      desconto: descontoValor,
      descontoTipo,
      totalFinal,
      lucroTotal,
      formaPagamento,
      valorRecebido,
      troco,
      status,
      clienteId: clienteId || null,
      clienteNome: clienteNome || '',
      dataVencimento: formaPagamento === 'fiado' && dataVencimento ? new Date(dataVencimento) : null,
      observacoes: observacoes || '',
      caixaId: caixaId || null
    })

    // Atualizar dívida do cliente se fiado
    if (status === 'fiado' && clienteId) {
      await Cliente.findByIdAndUpdate(clienteId, {
        $inc: { totalDevido: totalFinal }
      })
    }

    res.status(201).json(venda)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao registrar venda.' })
  }
})

// POST /api/vendas/espera — colocar venda em espera
router.post('/espera', async (req, res) => {
  try {
    const { itens, desconto = 0, descontoTipo = 'valor', clienteNome, caixaId } = req.body

    if (!itens || itens.length === 0) {
      return res.status(400).json({ message: 'A venda deve ter ao menos um item.' })
    }

    let total = 0
    const itensProcessados = []

    for (const item of itens) {
      const produto = await Produto.findOne({ _id: item.produtoId, userId: req.userId })
      if (!produto) continue

      const subtotal = produto.precoVenda * item.qty
      total += subtotal

      itensProcessados.push({
        produtoId: produto._id,
        nome: produto.nome,
        qty: item.qty,
        precoUnit: produto.precoVenda,
        precoCusto: produto.precoCusto,
        subtotal,
        lucro: (produto.precoVenda - produto.precoCusto) * item.qty
      })
    }

    let descontoValor = desconto
    if (descontoTipo === 'percentual') {
      descontoValor = total * (desconto / 100)
    }
    const totalFinal = Math.max(0, total - descontoValor)

    const venda = await Venda.create({
      userId: req.userId,
      itens: itensProcessados,
      total,
      desconto: descontoValor,
      descontoTipo,
      totalFinal,
      lucroTotal: 0,
      formaPagamento: 'dinheiro',
      status: 'espera',
      clienteNome: clienteNome || '',
      hashEspera: crypto.randomBytes(8).toString('hex'),
      caixaId: caixaId || null
    })

    res.status(201).json(venda)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao colocar venda em espera.' })
  }
})

// GET /api/vendas/espera — listar vendas em espera
router.get('/espera', async (req, res) => {
  try {
    const vendas = await Venda.find({
      userId: req.userId,
      status: 'espera'
    }).sort({ createdAt: -1 })
    res.json(vendas)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar vendas em espera.' })
  }
})

// DELETE /api/vendas/espera/:id — remover venda em espera
router.delete('/espera/:id', async (req, res) => {
  try {
    await Venda.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId,
      status: 'espera'
    })
    res.json({ message: 'Venda em espera removida.' })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover venda em espera.' })
  }
})

// GET /api/vendas
router.get('/', async (req, res) => {
  try {
    const { inicio, fim, formaPagamento, status } = req.query
    const filtro = { userId: req.userId, status: { $ne: 'espera' } }

    if (inicio || fim) {
      filtro.createdAt = {}
      if (inicio) filtro.createdAt.$gte = new Date(inicio)
      if (fim) filtro.createdAt.$lte = new Date(fim + 'T23:59:59')
    }

    if (formaPagamento) filtro.formaPagamento = formaPagamento
    if (status) filtro.status = status

    const vendas = await Venda.find(filtro).sort({ createdAt: -1 }).limit(100)
    res.json(vendas)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar vendas.' })
  }
})

// GET /api/vendas/:id
router.get('/:id', async (req, res) => {
  try {
    const venda = await Venda.findOne({ _id: req.params.id, userId: req.userId })
    if (!venda) return res.status(404).json({ message: 'Venda não encontrada.' })
    res.json(venda)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar venda.' })
  }
})

// DELETE /api/vendas/:id — cancelar venda
router.delete('/:id', async (req, res) => {
  try {
    const venda = await Venda.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { status: 'cancelado' },
      { new: true }
    )
    if (!venda) return res.status(404).json({ message: 'Venda não encontrada.' })
    res.json({ message: 'Venda cancelada com sucesso.' })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao cancelar venda.' })
  }
})

module.exports = router
