require('dotenv').config()
const express = require('express')
const cors = require('cors')
const connectDB = require('./src/config/database')

const app = express()

// Conectar banco
connectDB()

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json())

// Rotas
app.use('/api/auth', require('./src/routes/auth'))
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

// Handler de erros global
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ message: 'Algo deu errado!' })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`)
  console.log(`📡 Ambiente: ${process.env.NODE_ENV || 'development'}`)
})
