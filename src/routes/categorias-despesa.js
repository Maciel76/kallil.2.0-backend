const express = require('express')
const router = express.Router()
const CategoriaDespesa = require('../models/CategoriaDespesa')
const auth = require('../middleware/auth')

router.use(auth)

// Categorias padrão do sistema (sempre disponíveis)
const CATEGORIAS_PADRAO = [
  'Aluguel', 'Fornecedor', 'Energia', 'Transporte', 'Marketing', 'Assinatura', 'Outros'
]

// GET /api/categorias-despesa
router.get('/', async (req, res) => {
  try {
    const personalizadas = await CategoriaDespesa.find({ userId: req.userId }).sort({ nome: 1 })
    res.json({ padrao: CATEGORIAS_PADRAO, personalizadas })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar categorias.' })
  }
})

// POST /api/categorias-despesa
router.post('/', async (req, res) => {
  try {
    const { nome, cor } = req.body
    if (!nome || !nome.trim()) {
      return res.status(400).json({ message: 'Nome da categoria é obrigatório.' })
    }
    if (CATEGORIAS_PADRAO.map(c => c.toLowerCase()).includes(nome.trim().toLowerCase())) {
      return res.status(400).json({ message: 'Essa categoria já existe como padrão.' })
    }
    const categoria = await CategoriaDespesa.create({
      userId: req.userId,
      nome: nome.trim(),
      cor: cor || '#6b7280'
    })
    res.status(201).json(categoria)
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Categoria com esse nome já existe.' })
    }
    res.status(500).json({ message: 'Erro ao criar categoria.' })
  }
})

// DELETE /api/categorias-despesa/:id
router.delete('/:id', async (req, res) => {
  try {
    const categoria = await CategoriaDespesa.findOne({ _id: req.params.id, userId: req.userId })
    if (!categoria) return res.status(404).json({ message: 'Categoria não encontrada.' })
    await categoria.deleteOne()
    res.json({ message: 'Categoria removida com sucesso.' })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover categoria.' })
  }
})

module.exports = router
