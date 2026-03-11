const express = require('express')
const router = express.Router()
const Cliente = require('../models/Cliente')
const Venda = require('../models/Venda')
const auth = require('../middleware/auth')

router.use(auth)

// GET /api/clientes
router.get('/', async (req, res) => {
  try {
    const { busca, comDivida } = req.query
    const filtro = { userId: req.userId }

    if (busca) {
      filtro.$or = [
        { nome: { $regex: busca, $options: 'i' } },
        { telefone: { $regex: busca, $options: 'i' } }
      ]
    }
    if (comDivida === 'true') filtro.totalDevido = { $gt: 0 }

    const clientes = await Cliente.find(filtro).sort({ nome: 1 })
    res.json(clientes)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar clientes.' })
  }
})

// POST /api/clientes
router.post('/', async (req, res) => {
  try {
    const { nome, telefone, endereco } = req.body
    if (!nome) return res.status(400).json({ message: 'Nome é obrigatório.' })

    const cliente = await Cliente.create({ userId: req.userId, nome, telefone, endereco })
    res.status(201).json(cliente)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar cliente.' })
  }
})

// PUT /api/clientes/:id
router.put('/:id', async (req, res) => {
  try {
    const { nome, telefone, endereco } = req.body
    const cliente = await Cliente.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { nome, telefone, endereco },
      { new: true, runValidators: true }
    )
    if (!cliente) return res.status(404).json({ message: 'Cliente não encontrado.' })
    res.json(cliente)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar cliente.' })
  }
})

// PUT /api/clientes/:id/pagar
router.put('/:id/pagar', async (req, res) => {
  try {
    const { valor } = req.body
    const cliente = await Cliente.findOne({ _id: req.params.id, userId: req.userId })
    if (!cliente) return res.status(404).json({ message: 'Cliente não encontrado.' })

    const valorPago = Math.min(valor || cliente.totalDevido, cliente.totalDevido)
    cliente.totalDevido = Math.max(0, cliente.totalDevido - valorPago)
    await cliente.save()

    res.json(cliente)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao registrar pagamento.' })
  }
})

// GET /api/clientes/:id/vendas — vendas fiado do cliente
router.get('/:id/vendas', async (req, res) => {
  try {
    const vendas = await Venda.find({
      userId: req.userId,
      clienteId: req.params.id,
      status: 'fiado'
    }).sort({ createdAt: -1 })
    res.json(vendas)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar vendas do cliente.' })
  }
})

// GET /api/clientes/:id/historico — todo histórico de compras
router.get('/:id/historico', async (req, res) => {
  try {
    const vendas = await Venda.find({
      userId: req.userId,
      clienteId: req.params.id,
      status: { $ne: 'espera' }
    }).sort({ createdAt: -1 }).limit(50)
    res.json(vendas)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar histórico.' })
  }
})

// DELETE /api/clientes/:id
router.delete('/:id', async (req, res) => {
  try {
    const cliente = await Cliente.findOne({ _id: req.params.id, userId: req.userId })
    if (!cliente) return res.status(404).json({ message: 'Cliente não encontrado.' })
    if (cliente.totalDevido > 0) {
      return res.status(400).json({ message: 'Não é possível remover cliente com dívida pendente.' })
    }
    await Cliente.findByIdAndDelete(req.params.id)
    res.json({ message: 'Cliente removido com sucesso.' })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover cliente.' })
  }
})

module.exports = router
