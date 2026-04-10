const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { authorize } = require('../middleware/auth')
const WhatsAppInstance = require('../models/WhatsAppInstance')
const WhatsAppService = require('../services/whatsappService')

// Armazena instâncias ativas em memória
const activeSessions = new Map()

// Todas as rotas requerem auth + admin
router.use(auth)
router.use(authorize('admin'))

// POST /api/whatsapp/instances — Criar instância
router.post('/instances', async (req, res) => {
  try {
    const { name } = req.body
    if (!name) {
      return res.status(400).json({ message: 'Nome da instância é obrigatório' })
    }

    // Admin só pode ter 1 instância ativa
    const existing = await WhatsAppInstance.findOne({ userId: req.userRealId })
    if (existing) {
      return res.status(400).json({ message: 'Já existe uma instância configurada. Remova a atual antes de criar outra.' })
    }

    const instance = await WhatsAppInstance.create({
      userId: req.userRealId,
      name
    })

    res.status(201).json({ instance })
  } catch (error) {
    console.error('Erro ao criar instância:', error.message)
    res.status(500).json({ message: 'Erro ao criar instância.' })
  }
})

// GET /api/whatsapp/instances — Listar instâncias
router.get('/instances', async (req, res) => {
  try {
    const instances = await WhatsAppInstance.find({ userId: req.userRealId }).sort({ createdAt: -1 })
    res.json({ instances })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar instâncias.' })
  }
})

// POST /api/whatsapp/instances/:id/connect — Conectar instância
router.post('/instances/:id/connect', async (req, res) => {
  try {
    const instance = await WhatsAppInstance.findOne({ _id: req.params.id, userId: req.userRealId })
    if (!instance) {
      return res.status(404).json({ message: 'Instância não encontrada' })
    }

    if (instance.status === 'connected') {
      return res.json({ message: 'Já conectado', status: 'connected', instance })
    }

    const sessionKey = instance._id.toString()

    // Se já tem sessão ativa, desconecta primeiro
    if (activeSessions.has(sessionKey)) {
      const old = activeSessions.get(sessionKey)
      try { await old.disconnect() } catch (e) {}
      activeSessions.delete(sessionKey)
    }

    instance.status = 'connecting'
    await instance.save()

    const whatsapp = new WhatsAppService(instance)
    activeSessions.set(sessionKey, whatsapp)

    whatsapp.initialize().catch(err => {
      console.error('[WA-PDV] Erro ao inicializar:', err.message)
    })

    res.json({
      message: 'Conexão iniciada. Use o endpoint SSE /qr-stream para receber o QR Code.',
      status: 'connecting',
      instance
    })
  } catch (error) {
    console.error('Erro ao conectar:', error.message)
    res.status(500).json({ message: 'Erro ao conectar instância.' })
  }
})

// GET /api/whatsapp/instances/:id/qr-stream — SSE para QR Code
router.get('/instances/:id/qr-stream', async (req, res) => {
  try {
    const instance = await WhatsAppInstance.findOne({ _id: req.params.id, userId: req.userId })
    if (!instance) {
      return res.status(404).json({ message: 'Instância não encontrada' })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const sessionKey = instance._id.toString()
    const whatsapp = activeSessions.get(sessionKey)

    if (!whatsapp) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Sessão não encontrada. Clique em Conectar primeiro.' })}\n\n`)
      return res.end()
    }

    if (whatsapp.qrCode) {
      res.write(`data: ${JSON.stringify({ type: 'qr', qrCode: whatsapp.qrCode })}\n\n`)
    }

    if (whatsapp.connected) {
      res.write(`data: ${JSON.stringify({ type: 'status', status: 'connected' })}\n\n`)
      return res.end()
    }

    const onQr = (qrCode) => {
      res.write(`data: ${JSON.stringify({ type: 'qr', qrCode })}\n\n`)
    }

    const onStatus = (status) => {
      res.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`)
      if (status === 'connected' || status === 'disconnected') {
        cleanup()
        res.end()
      }
    }

    whatsapp.on('qr', onQr)
    whatsapp.on('status', onStatus)

    const cleanup = () => {
      whatsapp.removeListener('qr', onQr)
      whatsapp.removeListener('status', onStatus)
    }

    const timeout = setTimeout(() => {
      res.write(`data: ${JSON.stringify({ type: 'timeout', message: 'QR Code expirou. Tente reconectar.' })}\n\n`)
      cleanup()
      res.end()
    }, 120000)

    req.on('close', () => {
      clearTimeout(timeout)
      cleanup()
    })
  } catch (error) {
    console.error('Erro no QR stream:', error.message)
    res.status(500).json({ message: 'Erro no QR stream.' })
  }
})

// POST /api/whatsapp/instances/:id/disconnect — Desconectar
router.post('/instances/:id/disconnect', async (req, res) => {
  try {
    const instance = await WhatsAppInstance.findOne({ _id: req.params.id, userId: req.userRealId })
    if (!instance) {
      return res.status(404).json({ message: 'Instância não encontrada' })
    }

    const sessionKey = instance._id.toString()
    const whatsapp = activeSessions.get(sessionKey)

    if (whatsapp) {
      await whatsapp.disconnect()
      activeSessions.delete(sessionKey)
    }

    instance.status = 'disconnected'
    instance.qrCode = null
    await instance.save()

    res.json({ message: 'Desconectado', instance })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao desconectar.' })
  }
})

// DELETE /api/whatsapp/instances/:id — Remover instância
router.delete('/instances/:id', async (req, res) => {
  try {
    const instance = await WhatsAppInstance.findOne({ _id: req.params.id, userId: req.userRealId })
    if (!instance) {
      return res.status(404).json({ message: 'Instância não encontrada' })
    }

    const sessionKey = instance._id.toString()
    const whatsapp = activeSessions.get(sessionKey)
    if (whatsapp) {
      await whatsapp.disconnect()
      activeSessions.delete(sessionKey)
    }

    await WhatsAppInstance.findByIdAndDelete(instance._id)
    res.json({ message: 'Instância removida' })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover instância.' })
  }
})

// POST /api/whatsapp/test — Testar envio de mensagem
router.post('/test', async (req, res) => {
  try {
    const { instanceId, number, message } = req.body

    if (!instanceId || !number || !message) {
      return res.status(400).json({ message: 'instanceId, number e message são obrigatórios' })
    }

    const instance = await WhatsAppInstance.findOne({ _id: instanceId, userId: req.userRealId })
    if (!instance) {
      return res.status(404).json({ message: 'Instância não encontrada' })
    }

    if (instance.status !== 'connected') {
      return res.status(400).json({ message: 'Instância não está conectada' })
    }

    const whatsapp = activeSessions.get(instance._id.toString())
    if (!whatsapp || !whatsapp.connected) {
      return res.status(400).json({ message: 'WhatsApp não está conectado. Desconecte e conecte novamente.' })
    }

    await whatsapp.sendMessage(number, message)
    res.json({ message: 'Mensagem de teste enviada com sucesso!' })
  } catch (error) {
    console.error('Erro ao enviar teste:', error.message)
    res.status(500).json({ message: 'Erro ao enviar mensagem de teste: ' + error.message })
  }
})

// GET /api/whatsapp/status — Status geral da integração  
router.get('/status', async (req, res) => {
  try {
    const instance = await WhatsAppInstance.findOne({ userId: req.userRealId })
    if (!instance) {
      return res.json({ configured: false, status: 'not_configured' })
    }

    const whatsapp = activeSessions.get(instance._id.toString())
    res.json({
      configured: true,
      instanceId: instance._id,
      name: instance.name,
      status: instance.status,
      notificationPhone: instance.notificationPhone || '',
      connected: whatsapp ? whatsapp.connected : false
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao verificar status.' })
  }
})

// PUT /api/whatsapp/notification-phone — Salvar número de notificação
router.put('/notification-phone', async (req, res) => {
  try {
    const { phone } = req.body
    const instance = await WhatsAppInstance.findOne({ userId: req.userRealId })
    if (!instance) {
      return res.status(404).json({ message: 'Instância não encontrada. Crie uma primeiro.' })
    }

    // Normaliza o telefone
    let normalized = ''
    if (phone && phone.trim()) {
      normalized = phone.replace(/\D/g, '')
      if (normalized.startsWith('0')) {
        normalized = '55' + normalized.substring(1)
      }
      if (!normalized.startsWith('55')) {
        normalized = '55' + normalized
      }
    }

    instance.notificationPhone = normalized || null
    await instance.save()

    res.json({ message: 'Número de notificação salvo.', notificationPhone: instance.notificationPhone })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao salvar número.' })
  }
})

// GET /api/whatsapp/notification-phone — Ler número de notificação
router.get('/notification-phone', async (req, res) => {
  try {
    const instance = await WhatsAppInstance.findOne({ userId: req.userRealId })
    if (!instance) {
      return res.json({ notificationPhone: '' })
    }
    res.json({ notificationPhone: instance.notificationPhone || '' })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar número.' })
  }
})

// Exporta activeSessions para uso em outros módulos (notificações)
router.getActiveSessions = () => activeSessions

module.exports = router
