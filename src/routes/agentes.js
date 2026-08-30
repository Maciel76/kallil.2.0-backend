// Rotas HTTP para Agentes de IA e Base de Conhecimento
// Compatível com admin e dono de negócio (userId = dono)

const express = require('express')
const mongoose = require('mongoose')
const auth = require('../middleware/auth')
const AgenteIA = require('../models/AgenteIA')
const BaseConhecimento = require('../models/BaseConhecimento')
const UsoIA = require('../models/UsoIA')
const agenteService = require('../services/agenteService')
const deepseek = require('../services/deepseekService')

const router = express.Router()
router.use(auth)

/* ============== AGENTES ============== */

// GET /api/agentes — listar agentes do usuário logado
router.get('/', async (req, res) => {
  try {
    const userId = req.userRealId || req.userId
    const agentes = await AgenteIA.find({ userId }).sort({ createdAt: -1 }).lean()
    res.json({ agentes, enabled: deepseek.isEnabled() })
  } catch (err) {
    console.error('Erro ao listar agentes:', err)
    res.status(500).json({ message: 'Erro ao listar agentes.' })
  }
})

// GET /api/agentes/:id
router.get('/:id', async (req, res) => {
  try {
    const userId = req.userRealId || req.userId
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'ID inválido.' })
    }
    const agente = await AgenteIA.findOne({ _id: req.params.id, userId }).lean()
    if (!agente) return res.status(404).json({ message: 'Agente não encontrado.' })
    res.json({ agente })
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar agente.' })
  }
})

// POST /api/agentes — criar
router.post('/', async (req, res) => {
  try {
    const userId = req.userRealId || req.userId
    const {
      nome, funcao, descricao, cor, icone,
      ativo, especialidades, prompt, saudacao,
      horarioInicio, horarioFim
    } = req.body

    if (!nome || !nome.trim()) {
      return res.status(400).json({ message: 'Nome do agente é obrigatório.' })
    }

    const agente = await AgenteIA.create({
      userId,
      nome: nome.trim(),
      funcao: funcao || '',
      descricao: descricao || '',
      cor: cor || '#16a34a',
      icone: icone || 'fas fa-comments',
      ativo: ativo !== false,
      especialidades: Array.isArray(especialidades) ? especialidades : [],
      prompt: prompt || '',
      saudacao: saudacao || '',
      horarioInicio: horarioInicio || '08:00',
      horarioFim: horarioFim || '20:00'
    })

    res.status(201).json({ agente })
  } catch (err) {
    console.error('Erro ao criar agente:', err)
    res.status(500).json({ message: 'Erro ao criar agente.' })
  }
})

// PUT /api/agentes/:id — atualizar
router.put('/:id', async (req, res) => {
  try {
    const userId = req.userRealId || req.userId
    const update = { ...req.body, updatedAt: new Date() }
    delete update.userId

    const agente = await AgenteIA.findOneAndUpdate(
      { _id: req.params.id, userId },
      update,
      { new: true }
    )
    if (!agente) return res.status(404).json({ message: 'Agente não encontrado.' })
    res.json({ agente })
  } catch (err) {
    res.status(500).json({ message: 'Erro ao atualizar agente.' })
  }
})

// DELETE /api/agentes/:id
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.userRealId || req.userId
    const r = await AgenteIA.deleteOne({ _id: req.params.id, userId })
    if (r.deletedCount === 0) return res.status(404).json({ message: 'Agente não encontrado.' })
    res.json({ message: 'Agente excluído.' })
  } catch (err) {
    res.status(500).json({ message: 'Erro ao excluir agente.' })
  }
})

// POST /api/agentes/:id/testar — testar o agente com uma mensagem
router.post('/:id/testar', async (req, res) => {
  try {
    const userId = req.userRealId || req.userId
    const { mensagem } = req.body
    if (!mensagem || !mensagem.trim()) {
      return res.status(400).json({ message: 'Digite uma mensagem para testar.' })
    }

    const agente = await AgenteIA.findOne({ _id: req.params.id, userId }).lean()
    if (!agente) return res.status(404).json({ message: 'Agente não encontrado.' })

    if (!deepseek.isEnabled()) {
      return res.status(503).json({
        message: 'DeepSeek não está configurado. Defina DEEPSEEK_API_KEY no .env do backend.'
      })
    }

    const out = await agenteService.responder({
      agente,
      userId,
      mensagem: mensagem.trim(),
      contextoCliente: 'agente'
    })
    res.json(out)
  } catch (err) {
    console.error('Erro ao testar agente:', err)
    res.status(500).json({ message: 'Erro ao testar agente: ' + err.message })
  }
})

// GET /api/agentes/uso/resumo — estatísticas de uso do usuário
router.get('/uso/resumo', async (req, res) => {
  try {
    const userId = req.userRealId || req.userId
    const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const usos = await UsoIA.find({ userId, createdAt: { $gte: desde } }).sort({ createdAt: -1 }).lean()

    const totalTokens = usos.reduce((a, u) => a + (u.totalTokens || 0), 0)
    const promptTokens = usos.reduce((a, u) => a + (u.promptTokens || 0), 0)
    const completionTokens = usos.reduce((a, u) => a + (u.completionTokens || 0), 0)
    const transferencias = usos.filter(u => u.transferiuHumano).length

    // Por dia (últimos 30)
    const porDia = {}
    usos.forEach(u => {
      const k = new Date(u.createdAt).toISOString().slice(0, 10)
      if (!porDia[k]) porDia[k] = { data: k, chamadas: 0, tokens: 0 }
      porDia[k].chamadas += 1
      porDia[k].tokens += u.totalTokens || 0
    })

    res.json({
      totalChamadas: usos.length,
      totalTokens,
      promptTokens,
      completionTokens,
      transferencias,
      serie: Object.values(porDia).sort((a, b) => a.data.localeCompare(b.data))
    })
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar uso.' })
  }
})

/* ============== BASE DE CONHECIMENTO ============== */

// GET /api/agentes/conhecimento — listar (com filtro opcional por tipo e busca)
router.get('/conhecimento/itens', async (req, res) => {
  try {
    const userId = req.userRealId || req.userId
    const { tipo } = req.query
    const filtro = { userId }
    if (tipo && tipo !== 'todos') filtro.tipo = tipo
    const itens = await BaseConhecimento.find(filtro).sort({ createdAt: -1 }).lean()
    res.json({ itens })
  } catch (err) {
    res.status(500).json({ message: 'Erro ao listar itens.' })
  }
})

// POST /api/agentes/conhecimento/itens
router.post('/conhecimento/itens', async (req, res) => {
  try {
    const userId = req.userRealId || req.userId
    const body = req.body || {}
    if (!body.tipo) return res.status(400).json({ message: 'Tipo é obrigatório.' })

    // normalização: tags como array de strings
    let tags = body.tags
    if (typeof tags === 'string') {
      tags = tags.split(',').map(t => t.trim()).filter(Boolean)
    } else if (!Array.isArray(tags)) {
      tags = []
    }

    const item = await BaseConhecimento.create({ ...body, userId, tags })
    res.status(201).json({ item })
  } catch (err) {
    console.error('Erro ao criar item:', err)
    res.status(500).json({ message: 'Erro ao criar item.' })
  }
})

// PUT /api/agentes/conhecimento/itens/:id
router.put('/conhecimento/itens/:id', async (req, res) => {
  try {
    const userId = req.userRealId || req.userId
    const update = { ...req.body, updatedAt: new Date() }
    delete update.userId
    if (typeof update.tags === 'string') {
      update.tags = update.tags.split(',').map(t => t.trim()).filter(Boolean)
    }
    const item = await BaseConhecimento.findOneAndUpdate(
      { _id: req.params.id, userId },
      update,
      { new: true }
    )
    if (!item) return res.status(404).json({ message: 'Item não encontrado.' })
    res.json({ item })
  } catch (err) {
    res.status(500).json({ message: 'Erro ao atualizar item.' })
  }
})

// DELETE /api/agentes/conhecimento/itens/:id
router.delete('/conhecimento/itens/:id', async (req, res) => {
  try {
    const userId = req.userRealId || req.userId
    const r = await BaseConhecimento.deleteOne({ _id: req.params.id, userId })
    if (r.deletedCount === 0) return res.status(404).json({ message: 'Item não encontrado.' })
    res.json({ message: 'Item excluído.' })
  } catch (err) {
    res.status(500).json({ message: 'Erro ao excluir item.' })
  }
})

module.exports = router