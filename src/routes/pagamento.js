const express = require('express')
const router = express.Router()
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago')
const User = require('../models/User')
const Pagamento = require('../models/Pagamento')
const PlanoConfig = require('../models/PlanoConfig')
const auth = require('../middleware/auth')
const crypto = require('crypto')

// Inicializar Mercado Pago
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
})

// =============================================
// POST /api/pagamento/criar-preferencia
// Cria uma preferência de pagamento no MP
// =============================================
router.post('/criar-preferencia', auth, async (req, res) => {
  try {
    const { meses } = req.body
    if (!meses || ![1, 3, 6, 12].includes(Number(meses))) {
      return res.status(400).json({ message: 'Período inválido. Escolha 1, 3, 6 ou 12 meses.' })
    }

    const user = await User.findById(req.userId)
    if (!user || user.role !== 'dono') {
      return res.status(403).json({ message: 'Apenas donos podem assinar planos.' })
    }

    // Já tem plano pago ativo?
    if (user.plano === 'pago' && user.assinaturaStatus === 'ativo' && user.assinaturaExpira > new Date()) {
      return res.status(400).json({ message: 'Você já possui um plano ativo.' })
    }

    const config = await PlanoConfig.getConfig()
    const valorMensal = config.pago.valorMensal

    // Calcular valor com desconto
    const descontos = { 1: 0, 3: 0.05, 6: 0.10, 12: 0.20 }
    const desconto = descontos[Number(meses)] || 0
    const valorTotal = Number((valorMensal * Number(meses) * (1 - desconto)).toFixed(2))

    // Criar registro de pagamento local
    const pagamento = await Pagamento.create({
      userId: user._id,
      plano: 'pago',
      meses: Number(meses),
      valorTotal,
      status: 'pendente'
    })

    // Criar preferência no Mercado Pago
    const preference = new Preference(mpClient)

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    const backUrl = process.env.BACKEND_URL || 'http://localhost:5005'

    const preferenceData = await preference.create({
      body: {
        items: [
          {
            id: pagamento._id.toString(),
            title: `Plano ${config.pago.nome} - ${meses} ${Number(meses) === 1 ? 'mês' : 'meses'}`,
            description: `Assinatura do plano ${config.pago.nome} por ${meses} ${Number(meses) === 1 ? 'mês' : 'meses'}`,
            quantity: 1,
            unit_price: valorTotal,
            currency_id: 'BRL'
          }
        ],
        payer: {
          name: user.nome,
          email: user.email
        },
        back_urls: {
          success: `${baseUrl}/upgrade-plano?status=sucesso&pagamento=${pagamento._id}`,
          failure: `${baseUrl}/upgrade-plano?status=erro&pagamento=${pagamento._id}`,
          pending: `${baseUrl}/upgrade-plano?status=pendente&pagamento=${pagamento._id}`
        },
        auto_return: 'approved',
        external_reference: pagamento._id.toString(),
        notification_url: `${backUrl}/api/pagamento/webhook`,
        statement_descriptor: 'KALLIL PDV'
      }
    })

    // Salvar ID da preferência
    pagamento.mpPreferenceId = preferenceData.id
    await pagamento.save()

    res.json({
      preferenceId: preferenceData.id,
      initPoint: preferenceData.init_point,
      sandboxInitPoint: preferenceData.sandbox_init_point,
      pagamentoId: pagamento._id
    })
  } catch (error) {
    console.error('Erro ao criar preferência MP:', error)
    res.status(500).json({ message: 'Erro ao iniciar pagamento.' })
  }
})

// =============================================
// POST /api/pagamento/webhook
// Recebe notificações do Mercado Pago
// =============================================
router.post('/webhook', async (req, res) => {
  try {
    // Responder 200 imediatamente para o MP
    res.status(200).send('OK')

    const { type, data } = req.body

    if (type === 'payment' && data?.id) {
      await processarPagamento(data.id)
    }
  } catch (error) {
    console.error('Erro no webhook MP:', error)
    // Já respondemos 200 acima
  }
})

// =============================================
// GET /api/pagamento/status/:pagamentoId
// Consulta status de um pagamento
// =============================================
router.get('/status/:pagamentoId', auth, async (req, res) => {
  try {
    const pagamento = await Pagamento.findOne({
      _id: req.params.pagamentoId,
      userId: req.userId
    })

    if (!pagamento) {
      return res.status(404).json({ message: 'Pagamento não encontrado.' })
    }

    // Se ainda pendente, consultar no MP diretamente
    if (pagamento.status === 'pendente' && pagamento.mpPaymentId) {
      await processarPagamento(pagamento.mpPaymentId)
      await pagamento.reload()
    }

    res.json({
      id: pagamento._id,
      status: pagamento.status,
      valorTotal: pagamento.valorTotal,
      meses: pagamento.meses,
      metodoPagamento: pagamento.metodoPagamento,
      createdAt: pagamento.createdAt
    })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao consultar pagamento.' })
  }
})

// =============================================
// GET /api/pagamento/historico
// Lista pagamentos do usuário
// =============================================
router.get('/historico', auth, async (req, res) => {
  try {
    const pagamentos = await Pagamento.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('status valorTotal meses metodoPagamento createdAt')

    res.json(pagamentos)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar histórico.' })
  }
})

// =============================================
// Função auxiliar: processar pagamento do MP
// =============================================
async function processarPagamento(mpPaymentId) {
  try {
    const payment = new Payment(mpClient)
    const mpData = await payment.get({ id: mpPaymentId })

    if (!mpData || !mpData.external_reference) return

    const pagamento = await Pagamento.findById(mpData.external_reference)
    if (!pagamento) return

    // Já processado
    if (pagamento.status === 'aprovado') return

    pagamento.mpPaymentId = String(mpPaymentId)
    pagamento.metodoPagamento = mpData.payment_method_id || null
    pagamento.detalhes = {
      statusDetail: mpData.status_detail,
      paymentType: mpData.payment_type_id,
      transactionAmount: mpData.transaction_amount
    }

    const statusMap = {
      approved: 'aprovado',
      pending: 'pendente',
      in_process: 'pendente',
      rejected: 'rejeitado',
      cancelled: 'cancelado',
      refunded: 'reembolsado',
      charged_back: 'reembolsado'
    }

    pagamento.status = statusMap[mpData.status] || 'pendente'
    await pagamento.save()

    // Se aprovado, ativar plano do usuário
    if (mpData.status === 'approved') {
      await ativarPlano(pagamento.userId, pagamento.meses)
    }
  } catch (error) {
    console.error('Erro ao processar pagamento MP:', error)
  }
}

// =============================================
// Função auxiliar: ativar plano do usuário
// =============================================
async function ativarPlano(userId, meses) {
  const user = await User.findById(userId)
  if (!user) return

  // Se já tem plano ativo, estender
  const base = user.assinaturaExpira && user.assinaturaExpira > new Date()
    ? user.assinaturaExpira
    : new Date()

  user.plano = 'pago'
  user.assinaturaStatus = 'ativo'
  if (!user.assinaturaInicio) user.assinaturaInicio = new Date()
  user.assinaturaExpira = new Date(base.getTime() + meses * 30 * 24 * 60 * 60 * 1000)
  await user.save()
}

module.exports = router
