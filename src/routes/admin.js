const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const SuporteTicket = require('../models/SuporteTicket')
const Venda = require('../models/Venda')
const Produto = require('../models/Produto')
const auth = require('../middleware/auth')
const { authorize } = require('../middleware/auth')

const gerarToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  })
}

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// POST /api/admin/login — login exclusivo para admin
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body
    if (!email || !senha) {
      return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' })
    }

    const user = await User.findOne({ email, role: 'admin' }).select('+senha')
    if (!user || !(await user.compararSenha(senha))) {
      return res.status(401).json({ message: 'Credenciais inválidas.' })
    }

    if (!user.ativo) {
      return res.status(403).json({ message: 'Conta desativada.' })
    }

    const token = gerarToken(user._id)
    res.json({
      token,
      user: { id: user._id, nome: user.nome, email: user.email, role: user.role }
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor.' })
  }
})

// === Rotas protegidas (admin only) ===
router.use(auth)
router.use(authorize('admin'))

// GET /api/admin/dashboard — estatísticas do sistema
router.get('/dashboard', async (req, res) => {
  try {
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const inicioSemana = new Date(hoje)
    inicioSemana.setDate(inicioSemana.getDate() - 7)
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)

    const [totalUsuarios, negocios, operadores, novosHoje, novosSemana, novosMes, inativos] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'dono' }),
      User.countDocuments({ role: 'operador' }),
      User.countDocuments({ createdAt: { $gte: hoje } }),
      User.countDocuments({ createdAt: { $gte: inicioSemana } }),
      User.countDocuments({ createdAt: { $gte: inicioMes } }),
      User.countDocuments({ ativo: false })
    ])

    res.json({
      totalUsuarios,
      negocios,
      operadores,
      novosHoje,
      novosSemana,
      novosMes,
      ativos: totalUsuarios - inativos,
      inativos
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao carregar dashboard.' })
  }
})

// GET /api/admin/usuarios — listar todos os usuários do sistema
router.get('/usuarios', async (req, res) => {
  try {
    const { busca, page = 1, limit = 20, role } = req.query
    const filtro = {}

    if (role && ['dono', 'operador', 'admin'].includes(role)) {
      filtro.role = role
    }

    if (busca) {
      const escapedBusca = busca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filtro.$or = [
        { nome: { $regex: escapedBusca, $options: 'i' } },
        { nomeNegocio: { $regex: escapedBusca, $options: 'i' } },
        { email: { $regex: escapedBusca, $options: 'i' } }
      ]
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const total = await User.countDocuments(filtro)
    const usuarios = await User.find(filtro)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))

    const usuariosFormatados = usuarios.map(u => ({
      id: u._id,
      nome: u.nome,
      email: u.email,
      nomeNegocio: u.nomeNegocio,
      role: u.role,
      ativo: u.ativo,
      createdAt: u.createdAt
    }))

    res.json({
      usuarios: usuariosFormatados,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar usuários.' })
  }
})

// PATCH /api/admin/usuarios/:id/toggle — ativar/desativar
router.patch('/usuarios/:id/toggle', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' })
    if (user.role === 'admin') return res.status(400).json({ message: 'Não é possível desativar um admin.' })

    user.ativo = !user.ativo
    await user.save()

    if (!user.ativo && user.role === 'dono') {
      await User.updateMany({ donoId: user._id, role: 'operador' }, { ativo: false })
    }

    res.json({ ativo: user.ativo })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao alterar status.' })
  }
})

router.get('/suporte', async (req, res) => {
  try {
    const { busca, status } = req.query
    const filtro = {}

    if (status && ['aberto', 'respondido', 'fechado'].includes(status)) {
      filtro.status = status
    }

    if (busca) {
      const texto = escapeRegex(busca)
      filtro.$or = [
        { assunto: { $regex: texto, $options: 'i' } },
        { nomeNegocio: { $regex: texto, $options: 'i' } },
        { userNome: { $regex: texto, $options: 'i' } },
        { userEmail: { $regex: texto, $options: 'i' } }
      ]
    }

    const tickets = await SuporteTicket.find(filtro)
      .sort({ ultimaMensagemEm: -1 })
      .lean()

    res.json(tickets.map(ticket => ({
      id: ticket._id,
      assunto: ticket.assunto,
      status: ticket.status,
      userNome: ticket.userNome,
      userEmail: ticket.userEmail,
      nomeNegocio: ticket.nomeNegocio,
      naoLidasAdmin: ticket.naoLidasAdmin,
      naoLidasUsuario: ticket.naoLidasUsuario,
      ultimaMensagemEm: ticket.ultimaMensagemEm,
      ultimaMensagemTexto: ticket.mensagens?.[ticket.mensagens.length - 1]?.texto || ''
    })))
  } catch (error) {
    res.status(500).json({ message: 'Erro ao carregar mensagens de suporte.' })
  }
})

router.get('/suporte/:id', async (req, res) => {
  try {
    const ticket = await SuporteTicket.findById(req.params.id).lean()
    if (!ticket) {
      return res.status(404).json({ message: 'Conversa não encontrada.' })
    }

    await SuporteTicket.updateOne({ _id: req.params.id }, { $set: { naoLidasAdmin: 0 } })

    res.json({ ...ticket, naoLidasAdmin: 0 })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao carregar conversa de suporte.' })
  }
})

router.post('/suporte/:id/responder', async (req, res) => {
  try {
    const mensagem = (req.body.mensagem || '').trim().replace(/\s+/g, ' ')
    if (mensagem.length < 2) {
      return res.status(400).json({ message: 'Digite uma resposta válida.' })
    }

    const ticket = await SuporteTicket.findById(req.params.id)
    if (!ticket) {
      return res.status(404).json({ message: 'Conversa não encontrada.' })
    }

    const admin = await User.findById(req.userId).select('nome')

    ticket.status = 'respondido'
    ticket.naoLidasUsuario += 1
    ticket.naoLidasAdmin = 0
    ticket.ultimaMensagemEm = new Date()
    ticket.mensagens.push({
      autorTipo: 'admin',
      autorNome: admin?.nome || 'Admin',
      texto: mensagem
    })

    await ticket.save()

    res.json(ticket)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao responder conversa.' })
  }
})

router.patch('/suporte/:id/status', async (req, res) => {
  try {
    const { status } = req.body
    if (!['aberto', 'respondido', 'fechado'].includes(status)) {
      return res.status(400).json({ message: 'Status inválido.' })
    }

    const ticket = await SuporteTicket.findById(req.params.id)
    if (!ticket) {
      return res.status(404).json({ message: 'Conversa não encontrada.' })
    }

    ticket.status = status
    await ticket.save()

    res.json({ status: ticket.status })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar status da conversa.' })
  }
})

module.exports = router
