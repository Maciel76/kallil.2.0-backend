const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const auth = require('../middleware/auth')
const { authorize } = require('../middleware/auth')
const { verificarAssinatura } = require('../middleware/assinatura')

const gerarToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  })
}

// POST /api/operadores/login — login exclusivo para operadores
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body
    if (!email || !senha) {
      return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' })
    }

    const user = await User.findOne({ email, role: 'operador' }).select('+senha')
    if (!user || !(await user.compararSenha(senha))) {
      return res.status(401).json({ message: 'E-mail ou senha incorretos.' })
    }

    if (!user.ativo) {
      return res.status(403).json({ message: 'Conta desativada. Contate o dono do negócio.' })
    }

    // Buscar dados do dono para o operador usar (pdvCores, nomeNegocio, etc)
    const dono = await User.findById(user.donoId)
    if (!dono || !dono.ativo) {
      return res.status(403).json({ message: 'Negócio desativado.' })
    }

    const token = gerarToken(user._id)
    res.json({
      token,
      user: {
        id: user._id,
        nome: user.nome,
        email: user.email,
        role: user.role,
        donoId: user.donoId,
        nomeNegocio: dono.nomeNegocio,
        logoUrl: dono.logoUrl,
        pdvCores: dono.pdvCores
      }
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor.' })
  }
})

// === Rotas protegidas (dono gerencia seus operadores) ===
router.use(auth)
router.use(authorize('dono'))
router.use(verificarAssinatura)

// GET /api/operadores — listar operadores do dono
router.get('/', async (req, res) => {
  try {
    const operadores = await User.find({ donoId: req.userId, role: 'operador' })
      .select('-senha')
      .sort({ createdAt: -1 })
    res.json(operadores)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar operadores.' })
  }
})

// POST /api/operadores — criar operador
router.post('/', async (req, res) => {
  try {
    // Verificar limite de operadores do plano
    if (req.planoAtual !== 'pago') {
      const PlanoConfig = require('../models/PlanoConfig')
      const config = await PlanoConfig.getConfig()
      const maxOp = config.gratuito.maxOperadores
      if (maxOp >= 0) {
        const totalOp = await User.countDocuments({ donoId: req.userId, role: 'operador' })
        if (totalOp >= maxOp) {
          return res.status(403).json({
            message: 'Limite de operadores do plano gratuito atingido. Faça upgrade para o plano profissional.',
            limiteAtingido: true,
            recurso: 'operadores',
            atual: totalOp,
            limite: maxOp
          })
        }
      }
    }

    const { nome, email, senha } = req.body
    if (!nome || !email || !senha) {
      return res.status(400).json({ message: 'Nome, e-mail e senha são obrigatórios.' })
    }
    if (senha.length < 6) {
      return res.status(400).json({ message: 'A senha deve ter no mínimo 6 caracteres.' })
    }

    const existe = await User.findOne({ email })
    if (existe) {
      return res.status(400).json({ message: 'E-mail já cadastrado.' })
    }

    const operador = await User.create({
      nome, email, senha,
      role: 'operador',
      donoId: req.userId
    })

    res.status(201).json({
      id: operador._id,
      nome: operador.nome,
      email: operador.email,
      role: operador.role,
      ativo: operador.ativo,
      createdAt: operador.createdAt
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar operador.' })
  }
})

// PUT /api/operadores/:id — editar operador
router.put('/:id', async (req, res) => {
  try {
    const operador = await User.findOne({ _id: req.params.id, donoId: req.userId, role: 'operador' })
    if (!operador) return res.status(404).json({ message: 'Operador não encontrado.' })

    const { nome, email, senha } = req.body
    if (nome) operador.nome = nome
    if (email && email !== operador.email) {
      const existe = await User.findOne({ email })
      if (existe) return res.status(400).json({ message: 'E-mail já cadastrado.' })
      operador.email = email
    }
    if (senha) {
      if (senha.length < 6) return res.status(400).json({ message: 'Senha mínima: 6 caracteres.' })
      operador.senha = senha
    }
    await operador.save()

    res.json({ id: operador._id, nome: operador.nome, email: operador.email, role: operador.role, ativo: operador.ativo })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao editar operador.' })
  }
})

// PATCH /api/operadores/:id/toggle — ativar/desativar
router.patch('/:id/toggle', async (req, res) => {
  try {
    const operador = await User.findOne({ _id: req.params.id, donoId: req.userId, role: 'operador' })
    if (!operador) return res.status(404).json({ message: 'Operador não encontrado.' })
    operador.ativo = !operador.ativo
    await operador.save()
    res.json({ ativo: operador.ativo })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao alterar status.' })
  }
})

// DELETE /api/operadores/:id — remover
router.delete('/:id', async (req, res) => {
  try {
    const operador = await User.findOneAndDelete({ _id: req.params.id, donoId: req.userId, role: 'operador' })
    if (!operador) return res.status(404).json({ message: 'Operador não encontrado.' })
    res.json({ message: 'Operador removido.' })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover operador.' })
  }
})

module.exports = router
