const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const auth = require('../middleware/auth')

const gerarToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  })
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { nome, nomeNegocio, email, senha } = req.body

    if (!nome || !nomeNegocio || !email || !senha) {
      return res.status(400).json({ message: 'Todos os campos são obrigatórios.' })
    }

    const existe = await User.findOne({ email })
    if (existe) {
      return res.status(400).json({ message: 'E-mail já cadastrado.' })
    }

    const user = await User.create({ nome, nomeNegocio, email, senha })
    const token = gerarToken(user._id)

    res.status(201).json({
      token,
      user: {
        id: user._id, nome: user.nome, nomeNegocio: user.nomeNegocio,
        email: user.email, cnpj: user.cnpj, endereco: user.endereco,
        cidade: user.cidade, estado: user.estado, taxaPrazo: user.taxaPrazo,
        logoUrl: user.logoUrl, pdvCores: user.pdvCores
      }
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor.' })
  }
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body

    if (!email || !senha) {
      return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' })
    }

    const user = await User.findOne({ email }).select('+senha')
    if (!user || !(await user.compararSenha(senha))) {
      return res.status(401).json({ message: 'E-mail ou senha incorretos.' })
    }

    const token = gerarToken(user._id)

    res.json({
      token,
      user: {
        id: user._id, nome: user.nome, nomeNegocio: user.nomeNegocio,
        email: user.email, cnpj: user.cnpj, endereco: user.endereco,
        cidade: user.cidade, estado: user.estado, taxaPrazo: user.taxaPrazo,
        logoUrl: user.logoUrl, pdvCores: user.pdvCores
      }
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor.' })
  }
})

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' })
    res.json({
      user: {
        id: user._id, nome: user.nome, nomeNegocio: user.nomeNegocio,
        email: user.email, cnpj: user.cnpj, endereco: user.endereco,
        cidade: user.cidade, estado: user.estado, taxaPrazo: user.taxaPrazo,
        logoUrl: user.logoUrl, pdvCores: user.pdvCores
      }
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor.' })
  }
})

// PUT /api/auth/me — atualizar dados do negócio
router.put('/me', auth, async (req, res) => {
  try {
    const { nome, nomeNegocio, cnpj, endereco, cidade, estado, taxaPrazo, logoUrl, pdvCores } = req.body
    const updateData = { nome, nomeNegocio, cnpj, endereco, cidade, estado, taxaPrazo }
    if (logoUrl !== undefined) updateData.logoUrl = logoUrl
    if (pdvCores) updateData.pdvCores = pdvCores
    const user = await User.findByIdAndUpdate(
      req.userId,
      updateData,
      { new: true, runValidators: true }
    )
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' })
    res.json({
      user: {
        id: user._id, nome: user.nome, nomeNegocio: user.nomeNegocio,
        email: user.email, cnpj: user.cnpj, endereco: user.endereco,
        cidade: user.cidade, estado: user.estado, taxaPrazo: user.taxaPrazo,
        logoUrl: user.logoUrl, pdvCores: user.pdvCores
      }
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar dados.' })
  }
})

module.exports = router
