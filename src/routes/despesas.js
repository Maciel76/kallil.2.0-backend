const express = require('express')
const router = express.Router()
const Despesa = require('../models/Despesa')
const auth = require('../middleware/auth')

router.use(auth)

// GET /api/despesas
router.get('/', async (req, res) => {
  try {
    const { inicio, fim, categoria, formaPagamento, pago } = req.query
    const filtro = { userId: req.userId }

    if (inicio || fim) {
      filtro.data = {}
      if (inicio) filtro.data.$gte = new Date(inicio)
      if (fim) filtro.data.$lte = new Date(fim + 'T23:59:59')
    }
    if (categoria) filtro.categoria = categoria
    if (formaPagamento) filtro.formaPagamento = formaPagamento
    if (pago !== undefined && pago !== '') filtro.pago = pago === 'true'

    const despesas = await Despesa.find(filtro).sort({ data: -1 })
    res.json(despesas)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar despesas.' })
  }
})

// POST /api/despesas
router.post('/', async (req, res) => {
  try {
    const { nome, descricao, valor, categoria, data, quandoPagar, formaPagamento, pago } = req.body
    if (!valor) {
      return res.status(400).json({ message: 'Valor é obrigatório.' })
    }
    const ehAssinatura = categoria === 'Assinatura'
    const despesa = await Despesa.create({
      userId: req.userId,
      nome: nome || '',
      descricao: descricao || '',
      valor,
      categoria: categoria || 'Outros',
      data: data || new Date(),
      quandoPagar: quandoPagar || null,
      formaPagamento: formaPagamento || null,
      pago: pago || false,
      fixa: ehAssinatura,
      origem: 'manual',
      recorrencia: ehAssinatura ? 'mensal' : 'nenhuma'
    })
    res.status(201).json(despesa)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar despesa.' })
  }
})

// PATCH /api/despesas/:id/pagar
router.patch('/:id/pagar', async (req, res) => {
  try {
    const despesa = await Despesa.findOne({ _id: req.params.id, userId: req.userId })
    if (!despesa) return res.status(404).json({ message: 'Despesa não encontrada.' })
    despesa.pago = !despesa.pago
    await despesa.save()
    res.json(despesa)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar status de pagamento.' })
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
