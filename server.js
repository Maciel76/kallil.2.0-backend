require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const connectDB = require('./src/config/database')

const app = express()

// Conectar banco e criar admin padrão
connectDB().then(async () => {
  try {
    const User = require('./src/models/User')
    require('./src/models/PlanoConfig')
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@kallil.com'
    const adminPass = process.env.ADMIN_PASS
    if (!adminPass) {
      console.warn('⚠️  ADMIN_PASS não definida no .env — admin não será criado')
      return
    }
    const existe = await User.findOne({ email: adminEmail })
    if (!existe) {
      await User.create({ nome: 'Administrador', email: adminEmail, senha: adminPass, role: 'admin' })
      console.log(`🔑 Admin criado: ${adminEmail}`)
    } else {
      // Atualizar senha se mudou no .env
      existe.senha = adminPass
      await existe.save()
    }
  } catch (err) {
    console.error('Erro ao verificar admin:', err.message)
  }

  // Reconectar instâncias WhatsApp ativas
  try {
    const WhatsAppInstance = require('./src/models/WhatsAppInstance')
    const WhatsAppService = require('./src/services/whatsappService')
    const whatsappRoutes = require('./src/routes/whatsapp')
    const automacaoRoutes = require('./src/routes/automacao')
    const automacaoNotifier = require('./src/services/automacaoNotifier')

    // Provider de sessões para o notifier (junta admin + automacao)
    automacaoNotifier.setActiveSessionsProvider(() => {
      const merged = new Map()
      const adm = whatsappRoutes.getActiveSessions ? whatsappRoutes.getActiveSessions() : new Map()
      const aut = automacaoRoutes.getActiveSessions ? automacaoRoutes.getActiveSessions() : new Map()
      adm.forEach((v, k) => merged.set(k, v))
      aut.forEach((v, k) => merged.set(k, v))
      return merged
    })

    const User = require('./src/models/User')
    const activeInstances = await WhatsAppInstance.find({ status: { $in: ['connected', 'connecting'] } })

    if (activeInstances.length > 0) {
      console.log(`📱 Reconectando ${activeInstances.length} instância(s) WhatsApp...`)
    }

    for (const instance of activeInstances) {
      const owner = await User.findById(instance.userId).lean()
      const sessions = owner?.role === 'admin'
        ? whatsappRoutes.getActiveSessions()
        : automacaoRoutes.getActiveSessions()
      const sessionKey = instance._id.toString()
      const whatsapp = new WhatsAppService(instance)
      sessions.set(sessionKey, whatsapp)
      whatsapp.initialize().catch(err => {
        console.error(`[WA-PDV] Erro ao reconectar ${instance._id}:`, err.message)
      })
    }

    automacaoNotifier.startScheduler()
  } catch (err) {
    console.error('Erro ao restaurar sessões WhatsApp:', err.message)
  }
})

// CORS - suporta múltiplas origens via CORS_ORIGINS
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : [process.env.FRONTEND_URL || 'http://localhost:5173']

app.use(cors({
  origin: function (origin, callback) {
    // Permitir requests sem origin (mobile, curl, etc)
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) {
      return callback(null, true)
    }
    return callback(new Error('Bloqueado pelo CORS'))
  },
  credentials: true
}))
app.use(express.json({ limit: '5mb' }))

// Rotas da API
app.use('/api/auth', require('./src/routes/auth'))
app.use('/api/admin', require('./src/routes/admin'))
app.use('/api/assinatura', require('./src/routes/assinatura'))
app.use('/api/operadores', require('./src/routes/operadores'))
app.use('/api/produtos', require('./src/routes/produtos'))
app.use('/api/vendas', require('./src/routes/vendas'))
app.use('/api/despesas', require('./src/routes/despesas'))
app.use('/api/caixa', require('./src/routes/caixa'))
app.use('/api/clientes', require('./src/routes/clientes'))
app.use('/api/relatorios', require('./src/routes/relatorios'))
app.use('/api/cupom', require('./src/routes/cupom'))
app.use('/api/pagamento', require('./src/routes/pagamento'))
app.use('/api/suporte', require('./src/routes/suporte'))
app.use('/api/whatsapp', require('./src/routes/whatsapp'))
app.use('/api/automacao', require('./src/routes/automacao'))

// Rota de saúde
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Kallil 2.0 API rodando 🚀' })
})

// Em produção: servir o frontend buildado
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, 'public')
  app.use(express.static(frontendPath))
  // SPA fallback - qualquer rota que não seja /api retorna o index.html
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(frontendPath, 'index.html'))
    }
  })
}

// Handler de erros global
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ message: 'Algo deu errado!' })
})

const PORT = process.env.PORT || 5005
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`)
  console.log(`📡 Ambiente: ${process.env.NODE_ENV || 'development'}`)
})
