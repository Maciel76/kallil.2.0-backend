const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const auth = require('../middleware/auth')
const { notifyNewUser } = require('../services/whatsappNotifications')

const gerarToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  })
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { nome, nomeNegocio, email, senha, cpf, telefone } = req.body

    if (!nome || !nomeNegocio || !email || !senha || !cpf) {
      return res.status(400).json({ message: 'Todos os campos são obrigatórios.' })
    }

    // Validar formato CPF
    const cpfLimpo = cpf.replace(/\D/g, '')
    if (cpfLimpo.length !== 11) {
      return res.status(400).json({ message: 'CPF inválido.' })
    }

    // Verificar duplicidade de e-mail
    const existe = await User.findOne({ email })
    if (existe) {
      return res.status(400).json({ message: 'E-mail já cadastrado.' })
    }

    // Verificar duplicidade de CPF
    const cpfExiste = await User.findOne({ cpf: cpfLimpo })
    if (cpfExiste) {
      return res.status(400).json({ message: 'CPF já cadastrado.' })
    }

    const telefoneLimpo = telefone ? telefone.replace(/\D/g, '') : ''

    const user = await User.create({ nome, nomeNegocio, email, senha, cpf: cpfLimpo, telefone: telefoneLimpo })
    const token = gerarToken(user._id)

    // Notifica admin via WhatsApp sobre novo cadastro (em background)
    try {
      const whatsappRoutes = require('./whatsapp')
      const getActiveSessions = whatsappRoutes.getActiveSessions
      notifyNewUser({ nome, email, nomeNegocio }, getActiveSessions)
    } catch (e) {
      console.error('[WA-Notify] Erro ao notificar novo cadastro:', e.message)
    }

    res.status(201).json({
      token,
      user: {
        id: user._id, nome: user.nome, nomeNegocio: user.nomeNegocio,
        email: user.email, role: user.role, cpf: user.cpf, cnpj: user.cnpj, endereco: user.endereco,
        cidade: user.cidade, estado: user.estado, taxaPrazo: user.taxaPrazo,
        logoUrl: user.logoUrl, pdvCores: user.pdvCores, telefone: user.telefone,
        plano: user.plano, assinaturaStatus: user.assinaturaStatus,
        assinaturaExpira: user.assinaturaExpira, testeExpira: user.testeExpira, planoWhatsapp: user.planoWhatsapp, whatsappAssinaturaExpira: user.whatsappAssinaturaExpira
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

    if (!user.ativo) {
      return res.status(403).json({ message: 'Conta desativada.' })
    }

    const token = gerarToken(user._id)

    // Se for operador, enriquecer com dados do dono
    if (user.role === 'operador') {
      const dono = await User.findById(user.donoId)
      if (!dono || !dono.ativo) {
        return res.status(403).json({ message: 'Negócio desativado.' })
      }
      return res.json({
        token,
        user: {
          id: user._id, nome: user.nome, email: user.email,
          role: user.role, donoId: user.donoId,
          nomeNegocio: dono.nomeNegocio, logoUrl: dono.logoUrl, pdvCores: dono.pdvCores
        }
      })
    }

    res.json({
      token,
      user: {
        id: user._id, nome: user.nome, nomeNegocio: user.nomeNegocio,
        email: user.email, role: user.role, cnpj: user.cnpj, endereco: user.endereco,
        cidade: user.cidade, estado: user.estado, taxaPrazo: user.taxaPrazo,
        logoUrl: user.logoUrl, pdvCores: user.pdvCores, telefone: user.telefone,
        plano: user.plano, assinaturaStatus: user.assinaturaStatus,
        assinaturaExpira: user.assinaturaExpira, testeExpira: user.testeExpira, planoWhatsapp: user.planoWhatsapp, whatsappAssinaturaExpira: user.whatsappAssinaturaExpira
      }
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor.' })
  }
})

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userRealId)
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' })

    const userData = {
      id: user._id, nome: user.nome, nomeNegocio: user.nomeNegocio,
      email: user.email, role: user.role, cnpj: user.cnpj, endereco: user.endereco,
      cidade: user.cidade, estado: user.estado, taxaPrazo: user.taxaPrazo,
      logoUrl: user.logoUrl, pdvCores: user.pdvCores, telefone: user.telefone,
      plano: user.plano, assinaturaStatus: user.assinaturaStatus,
      assinaturaExpira: user.assinaturaExpira, testeExpira: user.testeExpira, planoWhatsapp: user.planoWhatsapp, whatsappAssinaturaExpira: user.whatsappAssinaturaExpira
    }

    // Operador herda logoUrl, pdvCores e nomeNegocio do dono
    if (user.role === 'operador' && user.donoId) {
      const dono = await User.findById(user.donoId)
      if (dono) {
        userData.logoUrl = dono.logoUrl
        userData.pdvCores = dono.pdvCores
        userData.nomeNegocio = dono.nomeNegocio
      }
    }

    res.json({ user: userData })
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor.' })
  }
})

// PUT /api/auth/me — atualizar dados do negócio
router.put('/me', auth, async (req, res) => {
  try {
    const { nome, nomeNegocio, cnpj, endereco, cidade, estado, taxaPrazo, logoUrl, pdvCores, telefone } = req.body
    const updateData = { nome, nomeNegocio, cnpj, endereco, cidade, estado, taxaPrazo }
    if (logoUrl !== undefined) updateData.logoUrl = logoUrl
    if (pdvCores) updateData.pdvCores = pdvCores
    if (telefone !== undefined) updateData.telefone = telefone.replace(/\D/g, '')
    const user = await User.findByIdAndUpdate(
      req.userId,
      updateData,
      { new: true, runValidators: true }
    )
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' })
    res.json({
      user: {
        id: user._id, nome: user.nome, nomeNegocio: user.nomeNegocio,
        email: user.email, role: user.role, cnpj: user.cnpj, endereco: user.endereco,
        cidade: user.cidade, estado: user.estado, taxaPrazo: user.taxaPrazo,
        logoUrl: user.logoUrl, pdvCores: user.pdvCores, telefone: user.telefone,
        plano: user.plano, assinaturaStatus: user.assinaturaStatus,
        assinaturaExpira: user.assinaturaExpira, testeExpira: user.testeExpira, planoWhatsapp: user.planoWhatsapp, whatsappAssinaturaExpira: user.whatsappAssinaturaExpira
      }
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar dados.' })
  }
})

// =============================================
// RESET DE SENHA VIA WHATSAPP
// =============================================

// POST /api/auth/forgot-password — envia código via WhatsApp
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ message: 'Informe o e-mail.' })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
    if (!user) {
      return res.status(404).json({ message: 'E-mail não encontrado.' })
    }

    if (!user.telefone) {
      return res.status(400).json({ message: 'Este usuário não possui WhatsApp cadastrado. Entre em contato com o suporte.' })
    }

    // Gera código de 6 dígitos
    const codigo = String(Math.floor(100000 + Math.random() * 900000))

    // Salva código com expiração de 10 minutos
    user.resetCode = codigo
    user.resetCodeExpira = new Date(Date.now() + 10 * 60 * 1000)
    await user.save()

    // Envia código via WhatsApp
    try {
      const whatsappRoutes = require('./whatsapp')
      const getActiveSessions = whatsappRoutes.getActiveSessions
      const WhatsAppInstance = require('../models/WhatsAppInstance')

      const instance = await WhatsAppInstance.findOne({ status: 'connected' })
      if (!instance) {
        return res.status(503).json({ message: 'Sistema WhatsApp indisponível. Tente novamente mais tarde.' })
      }

      const activeSessions = getActiveSessions()
      const session = activeSessions.get(instance._id.toString())

      if (!session || !session.connected) {
        return res.status(503).json({ message: 'Sistema WhatsApp indisponível. Tente novamente mais tarde.' })
      }

      const mensagem =
        `🔐 *Código de Recuperação de Senha*\n\n` +
        `Seu código é: *${codigo}*\n\n` +
        `⏰ Este código expira em 10 minutos.\n\n` +
        `Se você não solicitou a recuperação de senha, ignore esta mensagem.`

      await session.sendMessage(user.telefone, mensagem)

      // Retorna telefone mascarado para confirmar no frontend
      const tel = user.telefone
      const telMascarado = tel.slice(0, 4) + '****' + tel.slice(-2)

      res.json({ message: 'Código enviado com sucesso.', telefone: telMascarado })
    } catch (waError) {
      console.error('[Reset] Erro ao enviar código WhatsApp:', waError.message)
      return res.status(503).json({ message: 'Erro ao enviar código via WhatsApp. Tente novamente.' })
    }
  } catch (error) {
    console.error('[Reset] Erro:', error.message)
    res.status(500).json({ message: 'Erro interno do servidor.' })
  }
})

// POST /api/auth/verify-reset-code — verifica o código
router.post('/verify-reset-code', async (req, res) => {
  try {
    const { email, codigo } = req.body

    if (!email || !codigo) {
      return res.status(400).json({ message: 'E-mail e código são obrigatórios.' })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
    if (!user) {
      return res.status(404).json({ message: 'E-mail não encontrado.' })
    }

    if (!user.resetCode || !user.resetCodeExpira) {
      return res.status(400).json({ message: 'Nenhum código de recuperação foi solicitado.' })
    }

    if (new Date() > user.resetCodeExpira) {
      user.resetCode = null
      user.resetCodeExpira = null
      await user.save()
      return res.status(400).json({ message: 'Código expirado. Solicite um novo.' })
    }

    if (user.resetCode !== codigo.trim()) {
      return res.status(400).json({ message: 'Código inválido.' })
    }

    res.json({ message: 'Código verificado com sucesso.' })
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor.' })
  }
})

// POST /api/auth/reset-password — define nova senha
router.post('/reset-password', async (req, res) => {
  try {
    const { email, codigo, novaSenha } = req.body

    if (!email || !codigo || !novaSenha) {
      return res.status(400).json({ message: 'Todos os campos são obrigatórios.' })
    }

    if (novaSenha.length < 6) {
      return res.status(400).json({ message: 'A senha deve ter no mínimo 6 caracteres.' })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
    if (!user) {
      return res.status(404).json({ message: 'E-mail não encontrado.' })
    }

    if (!user.resetCode || !user.resetCodeExpira) {
      return res.status(400).json({ message: 'Nenhum código de recuperação ativo.' })
    }

    if (new Date() > user.resetCodeExpira) {
      user.resetCode = null
      user.resetCodeExpira = null
      await user.save()
      return res.status(400).json({ message: 'Código expirado. Solicite um novo.' })
    }

    if (user.resetCode !== codigo.trim()) {
      return res.status(400).json({ message: 'Código inválido.' })
    }

    // Atualiza senha e limpa código
    user.senha = novaSenha
    user.resetCode = null
    user.resetCodeExpira = null
    await user.save()

    res.json({ message: 'Senha alterada com sucesso!' })
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor.' })
  }
})

module.exports = router
