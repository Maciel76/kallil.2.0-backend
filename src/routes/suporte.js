const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { authorize } = require('../middleware/auth')
const User = require('../models/User')
const SuporteTicket = require('../models/SuporteTicket')

router.use(auth)
router.use(authorize('dono'))

const limparTexto = (valor = '') => valor.trim().replace(/\s+/g, ' ')

const carregarPerfilUsuario = async (userId) => {
  return User.findById(userId).select('nome email nomeNegocio')
}

router.get('/conversas', async (req, res) => {
  try {
    await SuporteTicket.updateMany(
      { userId: req.userId, naoLidasUsuario: { $gt: 0 } },
      { $set: { naoLidasUsuario: 0 } }
    )

    const conversas = await SuporteTicket.find({ userId: req.userId })
      .sort({ ultimaMensagemEm: -1 })
      .lean()

    res.json(conversas.map(conversa => ({ ...conversa, naoLidasUsuario: 0 })))
  } catch (error) {
    res.status(500).json({ message: 'Erro ao carregar conversas de suporte.' })
  }
})

router.post('/conversas', async (req, res) => {
  try {
    const assunto = limparTexto(req.body.assunto)
    const mensagem = limparTexto(req.body.mensagem)

    if (assunto.length < 3) {
      return res.status(400).json({ message: 'Informe um assunto com pelo menos 3 caracteres.' })
    }

    if (mensagem.length < 5) {
      return res.status(400).json({ message: 'Descreva sua dúvida com pelo menos 5 caracteres.' })
    }

    const usuario = await carregarPerfilUsuario(req.userId)
    if (!usuario) {
      return res.status(404).json({ message: 'Usuário não encontrado.' })
    }

    const ticket = await SuporteTicket.create({
      userId: req.userId,
      userNome: usuario.nome,
      userEmail: usuario.email,
      nomeNegocio: usuario.nomeNegocio || '',
      assunto,
      status: 'aberto',
      naoLidasAdmin: 1,
      ultimaMensagemEm: new Date(),
      mensagens: [
        {
          autorTipo: 'usuario',
          autorNome: usuario.nome,
          texto: mensagem
        }
      ]
    })

    res.status(201).json(ticket)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao abrir conversa com o suporte.' })
  }
})

router.post('/conversas/:id/mensagens', async (req, res) => {
  try {
    const mensagem = limparTexto(req.body.mensagem)

    if (mensagem.length < 2) {
      return res.status(400).json({ message: 'Digite uma mensagem válida.' })
    }

    const ticket = await SuporteTicket.findOne({ _id: req.params.id, userId: req.userId })
    if (!ticket) {
      return res.status(404).json({ message: 'Conversa não encontrada.' })
    }

    const usuario = await carregarPerfilUsuario(req.userId)
    if (!usuario) {
      return res.status(404).json({ message: 'Usuário não encontrado.' })
    }

    ticket.userNome = usuario.nome
    ticket.userEmail = usuario.email
    ticket.nomeNegocio = usuario.nomeNegocio || ''
    ticket.status = 'aberto'
    ticket.naoLidasAdmin += 1
    ticket.ultimaMensagemEm = new Date()
    ticket.mensagens.push({
      autorTipo: 'usuario',
      autorNome: usuario.nome,
      texto: mensagem
    })

    await ticket.save()

    res.json(ticket)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao enviar mensagem ao suporte.' })
  }
})

module.exports = router