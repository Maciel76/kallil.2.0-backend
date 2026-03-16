require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const connectDB = require('./src/config/database')

const app = express()

// Conectar banco
connectDB()

// Registrar models necessários
require('./src/models/PlanoConfig')

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
