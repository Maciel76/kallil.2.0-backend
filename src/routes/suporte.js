const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const User = require('../models/User')
const SuporteTicket = require('../models/SuporteTicket')
const { notifySupportMessage } = require('../services/whatsappNotifications')

// Dono e operador usam o suporte, cada um com as próprias conversas: o ticket
// pertence a quem está logado de verdade (req.userRealId), não à conta do dono.
router.use(auth)

const limparTexto = (valor = '') => valor.trim().replace(/\s+/g, ' ')

// Identidade de quem escreve. O operador assina com o próprio nome e e-mail,
// mas herda o nome do negócio do dono para o admin saber de qual loja veio.
const carregarIdentidade = async (req) => {
  const autor = await User.findById(req.userRealId).select('nome email nomeNegocio')
  if (!autor) return null

  const ehOperador = req.userRole === 'operador'
  let nomeNegocio = autor.nomeNegocio || ''

  if (ehOperador && String(req.userId) !== String(req.userRealId)) {
    const dono = await User.findById(req.userId).select('nomeNegocio')
    nomeNegocio = dono?.nomeNegocio || nomeNegocio
  }

  return {
    nome: autor.nome,
    email: autor.email,
    nomeNegocio,
    autorNome: ehOperador ? `${autor.nome} (operador)` : autor.nome
  }
}

router.get('/conversas', async (req, res) => {
  try {
    await SuporteTicket.updateMany(
      { userId: req.userRealId, naoLidasUsuario: { $gt: 0 } },
      { $set: { naoLidasUsuario: 0 } }
    )

    const conversas = await SuporteTicket.find({ userId: req.userRealId })
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

    const usuario = await carregarIdentidade(req)
    if (!usuario) {
      return res.status(404).json({ message: 'Usuário não encontrado.' })
    }

    const nomeAutor = usuario.autorNome

    const ticket = await SuporteTicket.create({
      userId: req.userRealId,
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
          autorNome: nomeAutor,
          texto: mensagem
        }
      ]
    })

    // Notifica admin via WhatsApp sobre nova mensagem de suporte
    try {
      const whatsappRoutes = require('./whatsapp')
      const getActiveSessions = whatsappRoutes.getActiveSessions
      notifySupportMessage({
        nome: nomeAutor,
        email: usuario.email,
        nomeNegocio: usuario.nomeNegocio,
        assunto,
        mensagem,
        ticketId: ticket._id
      }, getActiveSessions)
    } catch (e) {
      console.error('[WA-Notify] Erro ao notificar mensagem de suporte:', e.message)
    }

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

    const ticket = await SuporteTicket.findOne({ _id: req.params.id, userId: req.userRealId })
    if (!ticket) {
      return res.status(404).json({ message: 'Conversa não encontrada.' })
    }

    const usuario = await carregarIdentidade(req)
    if (!usuario) {
      return res.status(404).json({ message: 'Usuário não encontrado.' })
    }

    const nomeAutor = usuario.autorNome

    ticket.userNome = usuario.nome
    ticket.userEmail = usuario.email
    ticket.nomeNegocio = usuario.nomeNegocio || ''
    ticket.status = 'aberto'
    ticket.naoLidasAdmin += 1
    ticket.ultimaMensagemEm = new Date()
    ticket.mensagens.push({
      autorTipo: 'usuario',
      autorNome: nomeAutor,
      texto: mensagem
    })

    await ticket.save()

    // Notifica admin via WhatsApp sobre nova mensagem de suporte
    try {
      const whatsappRoutes = require('./whatsapp')
      const getActiveSessions = whatsappRoutes.getActiveSessions
      notifySupportMessage({
        nome: nomeAutor,
        email: usuario.email,
        nomeNegocio: usuario.nomeNegocio,
        assunto: ticket.assunto,
        mensagem,
        ticketId: ticket._id
      }, getActiveSessions)
    } catch (e) {
      console.error('[WA-Notify] Erro ao notificar mensagem de suporte:', e.message)
    }

    res.json(ticket)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao enviar mensagem ao suporte.' })
  }
})

module.exports = router