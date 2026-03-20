const express = require('express')
const router = express.Router()
const Despesa = require('../models/Despesa')
const auth = require('../middleware/auth')

router.use(auth)

// GET /api/despesas
router.get('/', async (req, res) => {
  try {
    const { inicio, fim, categoria } = req.query
    const filtro = { userId: req.userId }

    if (inicio || fim) {
      filtro.data = {}
      if (inicio) filtro.data.$gte = new Date(inicio)
      if (fim) filtro.data.$lte = new Date(fim + 'T23:59:59')
    }
    if (categoria) filtro.categoria = categoria

    const despesas = await Despesa.find(filtro).sort({ data: -1 })
    res.json(despesas)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar despesas.' })
  }
})

// POST /api/despesas
router.post('/', async (req, res) => {
  try {
    const { descricao, valor, categoria, data } = req.body
    if (!descricao || !valor) {
      return res.status(400).json({ message: 'Descrição e valor são obrigatórios.' })
    }
    const ehAssinatura = categoria === 'Assinatura'
    const despesa = await Despesa.create({
      userId: req.userId,
      descricao,
      valor,
      categoria,
      data,
      fixa: ehAssinatura,
      origem: 'manual',
      recorrencia: ehAssinatura ? 'mensal' : 'nenhuma'
    })
    res.status(201).json(despesa)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar despesa.' })
  }
})

// DELETE /api/despesas/:id
router.delete('/:id', async (req, res) => {
  try {
    const despesa = await Despesa.findOne({ _id: req.params.id, userId: req.userId })
    if (!despesa) return res.status(404).json({ message: 'Despesa não encontrada.' })
    if (despesa.fixa) return res.status(400).json({ message: 'Despesas fixas não podem ser removidas.' })
    await despesa.deleteOne()
    res.json({ message: 'Despesa removida com sucesso.' })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover despesa.' })
  }
})

module.exports = router
