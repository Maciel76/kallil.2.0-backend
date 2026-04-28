const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const User = require('../models/User')
const WhatsAppInstance = require('../models/WhatsAppInstance')
const Workflow = require('../models/Workflow')
const WorkflowSession = require('../models/WorkflowSession')
const WhatsAppService = require('../services/whatsappService')

// Sessões ativas em memória (separadas das do admin para clareza)
const activeSessions = new Map()

router.use(auth)
// Bloqueia admin (admin já tem /api/whatsapp e operadores não têm acesso)
router.use((req, res, next) => {
  if (req.userRole === 'operador') {
    return res.status(403).json({ message: 'Operadores não têm acesso à automação.' })
  }
  next()
})

// Valida add-on WhatsApp ativo (admin não precisa)
router.use(async (req, res, next) => {
  try {
    if (req.userRole === 'admin') return next()
    const user = await User.findById(req.userId).select('planoWhatsapp whatsappAssinaturaExpira')
    if (!user) return res.status(401).json({ message: 'Usuário não encontrado.' })
    const ativo = user.planoWhatsapp && user.whatsappAssinaturaExpira && user.whatsappAssinaturaExpira > new Date()
    if (!ativo) {
      return res.status(403).json({
        message: 'Plano de Automação WhatsApp inativo.',
        code: 'WHATSAPP_PLAN_REQUIRED'
      })
    }
    next()
  } catch (err) {
    res.status(500).json({ message: 'Erro ao validar plano.' })
  }
})

// ===================================================================
// INSTÂNCIA
// ===================================================================

// GET /api/automacao/instance — instância do usuário
router.get('/instance', async (req, res) => {
  try {
    const instance = await WhatsAppInstance.findOne({ userId: req.userRealId })
    if (!instance) return res.json({ instance: null })
    const wa = activeSessions.get(instance._id.toString())
    res.json({
      instance,
      connected: wa ? wa.connected : false
    })
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar instância.' })
  }
})

// POST /api/automacao/instance — cria instância
router.post('/instance', async (req, res) => {
  try {
    const { name } = req.body
    if (!name) return res.status(400).json({ message: 'Nome é obrigatório.' })
    const exists = await WhatsAppInstance.findOne({ userId: req.userRealId })
    if (exists) return res.status(400).json({ message: 'Você já possui uma instância. Remova antes de criar outra.' })
    const instance = await WhatsAppInstance.create({ userId: req.userRealId, name })
    res.status(201).json({ instance })
  } catch (err) {
    console.error('[AUTOMACAO] criar instância:', err.message)
    res.status(500).json({ message: 'Erro ao criar instância.' })
  }
})

// POST /api/automacao/instance/connect
router.post('/instance/connect', async (req, res) => {
  try {
    const instance = await WhatsAppInstance.findOne({ userId: req.userRealId })
    if (!instance) return res.status(404).json({ message: 'Instância não encontrada.' })
    if (instance.status === 'connected') return res.json({ message: 'Já conectado', status: 'connected', instance })

    const key = instance._id.toString()
    if (activeSessions.has(key)) {
      const old = activeSessions.get(key)
      try { await old.disconnect() } catch (e) {}
      activeSessions.delete(key)
    }
    instance.status = 'connecting'
    await instance.save()

    const whatsapp = new WhatsAppService(instance)
    activeSessions.set(key, whatsapp)
    whatsapp.initialize().catch(err => console.error('[AUTOMACAO] init err:', err.message))

    res.json({ message: 'Conexão iniciada', status: 'connecting', instance })
  } catch (err) {
    console.error('[AUTOMACAO] connect:', err.message)
    res.status(500).json({ message: 'Erro ao conectar.' })
  }
})

// GET /api/automacao/instance/qr-stream — SSE
router.get('/instance/qr-stream', async (req, res) => {
  try {
    const instance = await WhatsAppInstance.findOne({ userId: req.userId })
    if (!instance) return res.status(404).json({ message: 'Instância não encontrada.' })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const wa = activeSessions.get(instance._id.toString())
    if (!wa) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Sessão inexistente. Clique Conectar.' })}\n\n`)
      return res.end()
    }
    if (wa.qrCode) res.write(`data: ${JSON.stringify({ type: 'qr', qrCode: wa.qrCode })}\n\n`)
    if (wa.connected) {
      res.write(`data: ${JSON.stringify({ type: 'status', status: 'connected' })}\n\n`)
      return res.end()
    }

    const onQr = (qr) => res.write(`data: ${JSON.stringify({ type: 'qr', qrCode: qr })}\n\n`)
    const onStatus = (status) => {
      res.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`)
      if (status === 'connected' || status === 'disconnected') {
        cleanup()
        res.end()
      }
    }
    wa.on('qr', onQr)
    wa.on('status', onStatus)

    const cleanup = () => {
      wa.removeListener('qr', onQr)
      wa.removeListener('status', onStatus)
    }
    const timeout = setTimeout(() => {
      res.write(`data: ${JSON.stringify({ type: 'timeout' })}\n\n`)
      cleanup()
      res.end()
    }, 120000)
    req.on('close', () => {
      clearTimeout(timeout)
      cleanup()
    })
  } catch (err) {
    res.status(500).json({ message: 'Erro QR stream.' })
  }
})

// POST /api/automacao/instance/disconnect
router.post('/instance/disconnect', async (req, res) => {
  try {
    const instance = await WhatsAppInstance.findOne({ userId: req.userRealId })
    if (!instance) return res.status(404).json({ message: 'Instância não encontrada.' })
    const key = instance._id.toString()
    const wa = activeSessions.get(key)
    if (wa) {
      await wa.disconnect()
      activeSessions.delete(key)
    }
    instance.status = 'disconnected'
    instance.qrCode = null
    await instance.save()
    res.json({ message: 'Desconectado', instance })
  } catch (err) {
    res.status(500).json({ message: 'Erro ao desconectar.' })
  }
})

// DELETE /api/automacao/instance
router.delete('/instance', async (req, res) => {
  try {
    const instance = await WhatsAppInstance.findOne({ userId: req.userRealId })
    if (!instance) return res.status(404).json({ message: 'Instância não encontrada.' })
    const key = instance._id.toString()
    const wa = activeSessions.get(key)
    if (wa) {
      try { await wa.disconnect() } catch (e) {}
      activeSessions.delete(key)
    }
    await WhatsAppInstance.findByIdAndDelete(instance._id)
    await Workflow.deleteMany({ userId: req.userRealId, instanceId: instance._id })
    res.json({ message: 'Instância removida' })
  } catch (err) {
    res.status(500).json({ message: 'Erro ao remover.' })
  }
})

// ===================================================================
// NOTIFICAÇÕES (preferências e teste)
// ===================================================================

// GET /api/automacao/notificacoes
router.get('/notificacoes', async (req, res) => {
  try {
    const instance = await WhatsAppInstance.findOne({ userId: req.userRealId })
    if (!instance) return res.json({ notificacoes: null, notificationPhone: '' })
    res.json({
      notificacoes: instance.notificacoes,
      notificationPhone: instance.notificationPhone || ''
    })
  } catch (err) {
    res.status(500).json({ message: 'Erro.' })
  }
})

// PUT /api/automacao/notificacoes
router.put('/notificacoes', async (req, res) => {
  try {
    const { notificacoes, notificationPhone } = req.body
    const instance = await WhatsAppInstance.findOne({ userId: req.userRealId })
    if (!instance) return res.status(404).json({ message: 'Configure uma instância primeiro.' })
    if (notificacoes && typeof notificacoes === 'object') {
      Object.assign(instance.notificacoes, notificacoes)
    }
    if (notificationPhone !== undefined) {
      let n = (notificationPhone || '').replace(/\D/g, '')
      if (n) {
        if (n.startsWith('0')) n = '55' + n.slice(1)
        if (!n.startsWith('55')) n = '55' + n
      }
      instance.notificationPhone = n || null
    }
    await instance.save()
    res.json({
      message: 'Preferências salvas',
      notificacoes: instance.notificacoes,
      notificationPhone: instance.notificationPhone || ''
    })
  } catch (err) {
    console.error('[AUTOMACAO] save prefs:', err.message)
    res.status(500).json({ message: 'Erro ao salvar.' })
  }
})

// POST /api/automacao/test-message
router.post('/test-message', async (req, res) => {
  try {
    const { number, message } = req.body
    if (!number || !message) return res.status(400).json({ message: 'number e message obrigatórios.' })
    const instance = await WhatsAppInstance.findOne({ userId: req.userRealId })
    if (!instance) return res.status(404).json({ message: 'Instância não encontrada.' })
    if (instance.status !== 'connected') return res.status(400).json({ message: 'WhatsApp não conectado.' })
    const wa = activeSessions.get(instance._id.toString())
    if (!wa || !wa.connected) return res.status(400).json({ message: 'Sessão inativa. Reconecte.' })
    await wa.sendMessage(number, message)
    res.json({ message: 'Mensagem enviada!' })
  } catch (err) {
    res.status(500).json({ message: 'Erro: ' + err.message })
  }
})

// POST /api/automacao/resumo-agora — força envio de resumo do dia
router.post('/resumo-agora', async (req, res) => {
  try {
    const notifier = require('../services/automacaoNotifier')
    await notifier.enviarResumoDiario(req.userRealId)
    res.json({ message: 'Resumo enviado (verifique seu WhatsApp).' })
  } catch (err) {
    res.status(500).json({ message: 'Erro: ' + err.message })
  }
})

// ===================================================================
// WORKFLOWS
// ===================================================================

// GET /api/automacao/workflows
router.get('/workflows', async (req, res) => {
  try {
    const filter = { userId: req.userRealId }
    if (req.query.instanceId) filter.instanceId = req.query.instanceId
    const list = await Workflow.find(filter).sort({ updatedAt: -1 })
    res.json(list)
  } catch (err) {
    res.status(500).json({ message: 'Erro ao listar.' })
  }
})

// GET /api/automacao/workflows/:id
router.get('/workflows/:id([a-fA-F0-9]{24})', async (req, res) => {
  try {
    const wf = await Workflow.findOne({ _id: req.params.id, userId: req.userRealId })
    if (!wf) return res.status(404).json({ error: 'Workflow não encontrado.' })
    res.json(wf)
  } catch (err) {
    res.status(500).json({ message: 'Erro.' })
  }
})

// POST /api/automacao/workflows
router.post('/workflows', async (req, res) => {
  try {
    const { name, description, instanceId, nodes, edges } = req.body
    if (!name || !instanceId) return res.status(400).json({ error: 'Nome e instância obrigatórios.' })
    const inst = await WhatsAppInstance.findOne({ _id: instanceId, userId: req.userRealId })
    if (!inst) return res.status(400).json({ error: 'Instância inválida.' })

    const wf = await Workflow.create({
      userId: req.userRealId,
      instanceId,
      name,
      description: description || '',
      nodes: nodes || [
        { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 50 }, data: { triggerType: 'all', triggerValue: '' } }
      ],
      edges: edges || []
    })
    res.status(201).json(wf)
  } catch (err) {
    res.status(500).json({ message: 'Erro ao criar.' })
  }
})

// PUT /api/automacao/workflows/:id
router.put('/workflows/:id([a-fA-F0-9]{24})', async (req, res) => {
  try {
    const { name, description, nodes, edges, active } = req.body
    const wf = await Workflow.findOne({ _id: req.params.id, userId: req.userRealId })
    if (!wf) return res.status(404).json({ error: 'Workflow não encontrado.' })
    if (name !== undefined) wf.name = name
    if (description !== undefined) wf.description = description
    if (nodes !== undefined) wf.nodes = nodes
    if (edges !== undefined) wf.edges = edges
    if (active !== undefined) wf.active = active
    await wf.save()
    res.json(wf)
  } catch (err) {
    res.status(500).json({ message: 'Erro: ' + err.message })
  }
})

// DELETE /api/automacao/workflows/:id
router.delete('/workflows/:id([a-fA-F0-9]{24})', async (req, res) => {
  try {
    const wf = await Workflow.findOneAndDelete({ _id: req.params.id, userId: req.userRealId })
    if (!wf) return res.status(404).json({ error: 'Workflow não encontrado.' })
    await WorkflowSession.updateMany({ workflowId: wf._id, status: 'active' }, { status: 'completed' })
    res.json({ message: 'Removido.' })
  } catch (err) {
    res.status(500).json({ message: 'Erro.' })
  }
})

// PUT /api/automacao/workflows/:id/toggle
router.put('/workflows/:id([a-fA-F0-9]{24})/toggle', async (req, res) => {
  try {
    const wf = await Workflow.findOne({ _id: req.params.id, userId: req.userRealId })
    if (!wf) return res.status(404).json({ error: 'Workflow não encontrado.' })
    wf.active = !wf.active
    await wf.save()
    if (!wf.active) {
      await WorkflowSession.updateMany({ workflowId: wf._id, status: 'active' }, { status: 'completed' })
    }
    res.json(wf)
  } catch (err) {
    res.status(500).json({ message: 'Erro.' })
  }
})

// GET /api/automacao/workflows/templates — lista catálogo de templates disponíveis
router.get('/workflows/templates', (req, res) => {
  res.json([
    { id: 'boas-vindas',     nome: '👋 Boas-vindas',           desc: 'Saúda novos contatos pela primeira vez',           icone: 'fas fa-hand-holding-heart',  cor: '#10b981', tag: '⚡ Rápido',         categoria: 'Atendimento' },
    { id: 'atendimento',     nome: '🏢 Atendimento Inicial',   desc: 'Menu interativo de atendimento automático',         icone: 'fas fa-headset',             cor: '#3b82f6', tag: '🔥 Mais usado',     categoria: 'Atendimento' },
    { id: 'pos-venda',       nome: '🛍️ Pós-Venda',             desc: 'Pesquisa de satisfação após compra',                icone: 'fas fa-star',                cor: '#f59e0b', tag: '⭐ Avaliações',     categoria: 'Pós-Venda' },
    { id: 'cobranca',        nome: '💰 Cobrança Educada',      desc: 'Lembrete educado de pagamento em aberto',           icone: 'fas fa-file-invoice-dollar', cor: '#16a34a', tag: '💵 Recupera $',     categoria: 'Financeiro' },
    { id: 'recuperacao',     nome: '🎯 Recuperação',            desc: 'Reativa clientes que estão sem comprar',            icone: 'fas fa-user-plus',           cor: '#8b5cf6', tag: '📈 Vendas',         categoria: 'Marketing' },
    { id: 'aniversario',     nome: '🎂 Aniversariantes',        desc: 'Mensagem especial com cupom no aniversário',        icone: 'fas fa-cake-candles',        cor: '#ec4899', tag: '🎁 Fideliza',       categoria: 'Marketing' },
    { id: 'pesquisa',        nome: '⭐ Pesquisa NPS',            desc: 'Coleta feedback (nota + comentário)',               icone: 'fas fa-poll',                cor: '#06b6d4', tag: '📊 Insights',       categoria: 'Pós-Venda' },
    { id: 'horario',         nome: '🕒 Fora do Horário',        desc: 'Resposta automática quando você está offline',      icone: 'fas fa-moon',                cor: '#6366f1', tag: '🌙 24/7',           categoria: 'Atendimento' },
    { id: 'agendamento',     nome: '📅 Agendamento',            desc: 'Coleta dados para marcar horário/serviço',          icone: 'fas fa-calendar-check',      cor: '#0ea5e9', tag: '📲 Agenda',         categoria: 'Atendimento' },
    { id: 'cardapio',        nome: '🍔 Cardápio Digital',       desc: 'Mostra cardápio e recebe pedidos via menu',         icone: 'fas fa-utensils',            cor: '#dc2626', tag: '🍕 Delivery',       categoria: 'Vendas' },
    { id: 'lead-qualificado',nome: '🎯 Captação de Leads',      desc: 'Coleta nome, telefone e interesse para vendedor',   icone: 'fas fa-magnet',              cor: '#a855f7', tag: '💎 Premium',        categoria: 'Vendas' },
    { id: 'rastreio',        nome: '📦 Rastreio de Pedido',     desc: 'Cliente consulta status do pedido pelo WhatsApp',   icone: 'fas fa-truck',               cor: '#0891b2', tag: '🚚 Logística',      categoria: 'Pós-Venda' },
    { id: 'fila-atendimento',nome: '⏳ Fila de Atendimento',     desc: 'Avisa cliente quando todos atendentes estão ocupados', icone: 'fas fa-hourglass-half',   cor: '#f97316', tag: '⏰ Smart',           categoria: 'Atendimento' },
    { id: 'departamentos',   nome: '🏢 Direcionar Setor',        desc: 'Cliente escolhe Vendas, Suporte ou Financeiro',     icone: 'fas fa-sitemap',             cor: '#0d9488', tag: '🎯 Eficiente',       categoria: 'Atendimento' },
    { id: 'suporte-tecnico', nome: '🛠️ Suporte Técnico',         desc: 'Triagem do problema antes de chamar atendente',     icone: 'fas fa-screwdriver-wrench',  cor: '#475569', tag: '🔧 Triagem',         categoria: 'Suporte' },
    { id: 'confirma-presenca',nome: '✅ Confirmar Presença',     desc: 'Confirma agendamento de consulta/serviço',          icone: 'fas fa-calendar-check',      cor: '#059669', tag: '📲 Reduz no-show',   categoria: 'Atendimento' },
    { id: 'carrinho-abandonado',nome: '🛒 Carrinho Abandonado',  desc: 'Lembra quem não finalizou a compra',                icone: 'fas fa-shopping-cart',       cor: '#e11d48', tag: '💸 Recupera vendas', categoria: 'Vendas' },
    { id: 'boleto-vencendo', nome: '💳 Boleto Vencendo',         desc: 'Lembrete 3 dias antes do vencimento',               icone: 'fas fa-receipt',             cor: '#ca8a04', tag: '⏳ Antecipado',       categoria: 'Financeiro' },
    { id: 'indicacao',       nome: '🤝 Indique e Ganhe',         desc: 'Programa de indicação com cupom para os dois',      icone: 'fas fa-handshake',           cor: '#7c3aed', tag: '🎁 Viral',           categoria: 'Marketing' },
    { id: 'reativacao-30',   nome: '🔄 Reativação 30 dias',      desc: 'Volta clientes inativos há 30+ dias',               icone: 'fas fa-rotate',              cor: '#0284c7', tag: '📈 Retenção',        categoria: 'Marketing' },
    { id: 'promocao-flash',  nome: '⚡ Promoção Relâmpago',      desc: 'Dispara promoção com prazo limitado',               icone: 'fas fa-bolt',                cor: '#fbbf24', tag: '🔥 Urgência',        categoria: 'Marketing' },
    { id: 'cancelamento',    nome: '🛡️ Retenção/Cancelamento',   desc: 'Tenta reter cliente que quer cancelar',             icone: 'fas fa-shield-halved',       cor: '#be123c', tag: '💪 Salva conta',     categoria: 'Suporte' }
  ])
})

// POST /api/automacao/workflows/templates — cria a partir de template
router.post('/workflows/templates', async (req, res) => {
  try {
    const { templateName, instanceId } = req.body
    if (!instanceId) return res.status(400).json({ error: 'Instância obrigatória.' })

    const templates = {
      atendimento: {
        name: '🏢 Atendimento Automático',
        description: 'Menu inicial com opções',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'all' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá {nome}! 👋 Bem-vindo!' } },
          { id: 'menu-1', type: 'menu', position: { x: 250, y: 260 }, data: { message: 'Como posso ajudar?', options: [{ id: 'opt-1', label: 'Informações' }, { id: 'opt-2', label: 'Falar com atendente' }] } },
          { id: 'msg-info', type: 'sendMessage', position: { x: 0, y: 440 }, data: { message: 'ℹ️ Horário: Seg–Sex 9h–18h.' } },
          { id: 'msg-humano', type: 'sendMessage', position: { x: 500, y: 440 }, data: { message: '👤 Um atendente já vai falar com você.' } },
          { id: 'end-1', type: 'end', position: { x: 0, y: 580 }, data: {} },
          { id: 'end-2', type: 'end', position: { x: 500, y: 580 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'menu-1' },
          { id: 'e3', source: 'menu-1', target: 'msg-info', sourceHandle: 'opt-1' },
          { id: 'e4', source: 'menu-1', target: 'msg-humano', sourceHandle: 'opt-2' },
          { id: 'e5', source: 'msg-info', target: 'end-1' },
          { id: 'e6', source: 'msg-humano', target: 'end-2' }
        ]
      },
      'pos-venda': {
        name: '🛍️ Pós-Venda',
        description: 'Pesquisa de satisfação após compra',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'all' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá {nome}! Você comprou conosco recentemente.' } },
          { id: 'wait-1', type: 'waitForReply', position: { x: 250, y: 260 }, data: { variableName: 'avaliacao', message: 'De 1 a 5, como você avaliaria sua experiência?' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 380 }, data: { message: 'Obrigado pela avaliação ({avaliacao})! 🙏' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 500 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'wait-1' },
          { id: 'e3', source: 'wait-1', target: 'msg-2' },
          { id: 'e4', source: 'msg-2', target: 'end-1' }
        ]
      },
      'boas-vindas': {
        name: '👋 Boas-vindas',
        description: 'Saúda novos contatos pela primeira vez',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'firstContact' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá! 👋 Seja muito bem-vindo(a)!' } },
          { id: 'delay-1', type: 'delay', position: { x: 250, y: 240 }, data: { unit: 'seconds', value: 3 } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 360 }, data: { message: 'Sou seu atendente automático. Como posso ajudar hoje?' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 480 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'delay-1' },
          { id: 'e3', source: 'delay-1', target: 'msg-2' },
          { id: 'e4', source: 'msg-2', target: 'end-1' }
        ]
      },
      'cobranca': {
        name: '💰 Cobrança Educada',
        description: 'Lembrete de pagamento em aberto',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'keyword', keyword: 'pagamento' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá {nome}! Tudo bem?' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 260 }, data: { message: 'Notamos que você tem um pagamento de R$ {valor} com vencimento em {vencimento}. 💳' } },
          { id: 'menu-1', type: 'menu', position: { x: 250, y: 400 }, data: { message: 'Como podemos ajudar?', options: [{ id: 'opt-1', label: 'Já paguei' }, { id: 'opt-2', label: 'Quero negociar' }] } },
          { id: 'msg-pago', type: 'sendMessage', position: { x: 0, y: 580 }, data: { message: 'Ótimo! Vamos verificar e te avisar. Obrigado!' } },
          { id: 'msg-neg', type: 'sendMessage', position: { x: 500, y: 580 }, data: { message: 'Sem problemas! Um atendente vai entrar em contato.' } },
          { id: 'end-1', type: 'end', position: { x: 0, y: 720 }, data: {} },
          { id: 'end-2', type: 'end', position: { x: 500, y: 720 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'msg-2' },
          { id: 'e3', source: 'msg-2', target: 'menu-1' },
          { id: 'e4', source: 'menu-1', target: 'msg-pago', sourceHandle: 'opt-1' },
          { id: 'e5', source: 'menu-1', target: 'msg-neg', sourceHandle: 'opt-2' },
          { id: 'e6', source: 'msg-pago', target: 'end-1' },
          { id: 'e7', source: 'msg-neg', target: 'end-2' }
        ]
      },
      'recuperacao': {
        name: '🎯 Recuperação de Clientes',
        description: 'Reativa clientes que estão sem comprar',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'keyword', keyword: 'voltar' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Oi {nome}! Sentimos sua falta por aqui 💚' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 260 }, data: { message: 'Para te receber de volta, preparamos um cupom exclusivo: *VOLTOU10* — 10% OFF na sua próxima compra!' } },
          { id: 'tag-1', type: 'addTag', position: { x: 250, y: 400 }, data: { tag: 'cliente-recuperacao' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 520 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'msg-2' },
          { id: 'e3', source: 'msg-2', target: 'tag-1' },
          { id: 'e4', source: 'tag-1', target: 'end-1' }
        ]
      },
      'aniversario': {
        name: '🎂 Aniversariantes',
        description: 'Mensagem especial de aniversário com cupom',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'keyword', keyword: 'aniversario' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: '🎉 PARABÉNS, {nome}! 🎂' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 260 }, data: { message: 'Para comemorar com você, presenteamos com um cupom de 15% OFF: *NIVER15* (válido por 7 dias).' } },
          { id: 'tag-1', type: 'addTag', position: { x: 250, y: 400 }, data: { tag: 'aniversariante' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 520 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'msg-2' },
          { id: 'e3', source: 'msg-2', target: 'tag-1' },
          { id: 'e4', source: 'tag-1', target: 'end-1' }
        ]
      },
      'pesquisa': {
        name: '⭐ Pesquisa de Satisfação',
        description: 'Coleta feedback do cliente em 3 etapas',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'keyword', keyword: 'feedback' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá {nome}! Sua opinião é muito importante para nós.' } },
          { id: 'wait-1', type: 'waitForReply', position: { x: 250, y: 260 }, data: { variableName: 'nota', message: 'De 1 a 10, qual a chance de você nos recomendar?' } },
          { id: 'wait-2', type: 'waitForReply', position: { x: 250, y: 400 }, data: { variableName: 'comentario', message: 'Quer deixar algum comentário?' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 540 }, data: { message: 'Obrigado pelo feedback! Sua nota foi {nota}. 💚' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 660 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'wait-1' },
          { id: 'e3', source: 'wait-1', target: 'wait-2' },
          { id: 'e4', source: 'wait-2', target: 'msg-2' },
          { id: 'e5', source: 'msg-2', target: 'end-1' }
        ]
      },
      'horario': {
        name: '🕒 Fora do Horário',
        description: 'Resposta automática quando você está offline',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'all' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá {nome}! 🌙 Recebemos sua mensagem.' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 260 }, data: { message: 'Estamos fora do horário de atendimento. Nosso horário: Seg–Sex 9h–18h, Sáb 9h–13h.' } },
          { id: 'msg-3', type: 'sendMessage', position: { x: 250, y: 400 }, data: { message: 'Retornaremos seu contato no próximo expediente. 💚' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 520 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'msg-2' },
          { id: 'e3', source: 'msg-2', target: 'msg-3' },
          { id: 'e4', source: 'msg-3', target: 'end-1' }
        ]
      },
      'agendamento': {
        name: '📅 Agendamento',
        description: 'Coleta dados para marcar horário/serviço',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'keyword', keyword: 'agendar' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá {nome}! Vamos agendar seu horário. 📅' } },
          { id: 'wait-1', type: 'waitForReply', position: { x: 250, y: 260 }, data: { variableName: 'servico', message: 'Qual serviço você deseja?' } },
          { id: 'wait-2', type: 'waitForReply', position: { x: 250, y: 400 }, data: { variableName: 'data_pref', message: 'Qual data e horário você prefere? (ex: 12/05 às 14h)' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 540 }, data: { message: 'Recebido! Vamos confirmar:\n*Serviço:* {servico}\n*Data:* {data_pref}\nEm breve confirmaremos seu agendamento. ✅' } },
          { id: 'tag-1', type: 'addTag', position: { x: 250, y: 680 }, data: { tag: 'aguardando-agendamento' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 800 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'wait-1' },
          { id: 'e3', source: 'wait-1', target: 'wait-2' },
          { id: 'e4', source: 'wait-2', target: 'msg-2' },
          { id: 'e5', source: 'msg-2', target: 'tag-1' },
          { id: 'e6', source: 'tag-1', target: 'end-1' }
        ]
      },
      'cardapio': {
        name: '🍔 Cardápio Digital',
        description: 'Mostra cardápio e recebe pedidos via menu',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'keyword', keyword: 'cardapio' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá {nome}! 🍕 Confira nosso cardápio:' } },
          { id: 'menu-1', type: 'menu', position: { x: 250, y: 260 }, data: { message: 'Qual categoria deseja?', options: [{ id: 'opt-1', label: 'Pizzas 🍕' }, { id: 'opt-2', label: 'Lanches 🍔' }, { id: 'opt-3', label: 'Bebidas 🥤' }] } },
          { id: 'msg-pizza', type: 'sendMessage', position: { x: -100, y: 460 }, data: { message: '🍕 *Pizzas*\n• Margherita - R$ 39\n• Calabresa - R$ 42\n• Portuguesa - R$ 45\n\nDigite o nome para pedir.' } },
          { id: 'msg-lanche', type: 'sendMessage', position: { x: 250, y: 460 }, data: { message: '🍔 *Lanches*\n• X-Burger - R$ 22\n• X-Salada - R$ 25\n• X-Tudo - R$ 32' } },
          { id: 'msg-beb', type: 'sendMessage', position: { x: 600, y: 460 }, data: { message: '🥤 *Bebidas*\n• Refri 350ml - R$ 6\n• Suco - R$ 8\n• Água - R$ 4' } },
          { id: 'wait-1', type: 'waitForReply', position: { x: 250, y: 620 }, data: { variableName: 'pedido', message: 'O que vai querer?' } },
          { id: 'msg-confirma', type: 'sendMessage', position: { x: 250, y: 760 }, data: { message: 'Pedido recebido: {pedido}\nUm atendente já vai confirmar. 👨‍🍳' } },
          { id: 'tag-1', type: 'addTag', position: { x: 250, y: 880 }, data: { tag: 'pedido-aguardando' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 1000 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'menu-1' },
          { id: 'e3', source: 'menu-1', target: 'msg-pizza', sourceHandle: 'opt-1' },
          { id: 'e4', source: 'menu-1', target: 'msg-lanche', sourceHandle: 'opt-2' },
          { id: 'e5', source: 'menu-1', target: 'msg-beb',   sourceHandle: 'opt-3' },
          { id: 'e6', source: 'msg-pizza', target: 'wait-1' },
          { id: 'e7', source: 'msg-lanche', target: 'wait-1' },
          { id: 'e8', source: 'msg-beb', target: 'wait-1' },
          { id: 'e9', source: 'wait-1', target: 'msg-confirma' },
          { id: 'e10', source: 'msg-confirma', target: 'tag-1' },
          { id: 'e11', source: 'tag-1', target: 'end-1' }
        ]
      },
      'lead-qualificado': {
        name: '🎯 Captação de Leads',
        description: 'Coleta nome, telefone e interesse para o vendedor',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'keyword', keyword: 'orcamento' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá! Que ótimo seu interesse. 🎯 Para passar para um especialista, preciso de algumas informações.' } },
          { id: 'wait-1', type: 'waitForReply', position: { x: 250, y: 260 }, data: { variableName: 'nome_lead', message: 'Qual seu nome completo?' } },
          { id: 'wait-2', type: 'waitForReply', position: { x: 250, y: 400 }, data: { variableName: 'interesse', message: 'O que você procura? (descreva brevemente)' } },
          { id: 'wait-3', type: 'waitForReply', position: { x: 250, y: 540 }, data: { variableName: 'urgencia', message: 'Quando pretende contratar? (esta semana, mês, sem pressa)' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 680 }, data: { message: 'Perfeito {nome_lead}! 🎉 Recebi seus dados e um especialista entrará em contato em até 1 hora útil.' } },
          { id: 'tag-1', type: 'addTag', position: { x: 250, y: 820 }, data: { tag: 'lead-qualificado' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 940 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'wait-1' },
          { id: 'e3', source: 'wait-1', target: 'wait-2' },
          { id: 'e4', source: 'wait-2', target: 'wait-3' },
          { id: 'e5', source: 'wait-3', target: 'msg-2' },
          { id: 'e6', source: 'msg-2', target: 'tag-1' },
          { id: 'e7', source: 'tag-1', target: 'end-1' }
        ]
      },
      'rastreio': {
        name: '📦 Rastreio de Pedido',
        description: 'Cliente consulta status do pedido pelo WhatsApp',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'keyword', keyword: 'rastrear' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá {nome}! 📦 Vamos rastrear seu pedido.' } },
          { id: 'wait-1', type: 'waitForReply', position: { x: 250, y: 260 }, data: { variableName: 'numero_pedido', message: 'Qual o número do seu pedido?' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 400 }, data: { message: 'Pedido *{numero_pedido}* localizado! 🔍\n\n📍 *Status:* Em transporte\n🚚 *Previsão:* 1-2 dias úteis\n\nQuer falar com um atendente?' } },
          { id: 'menu-1', type: 'menu', position: { x: 250, y: 540 }, data: { message: 'Escolha:', options: [{ id: 'opt-1', label: 'Sim, falar com atendente' }, { id: 'opt-2', label: 'Não, obrigado' }] } },
          { id: 'msg-atend', type: 'sendMessage', position: { x: 0, y: 720 }, data: { message: '👤 Um atendente já vai falar com você.' } },
          { id: 'msg-fim', type: 'sendMessage', position: { x: 500, y: 720 }, data: { message: 'Tudo bem! Qualquer coisa é só chamar. 💚' } },
          { id: 'end-1', type: 'end', position: { x: 0, y: 860 }, data: {} },
          { id: 'end-2', type: 'end', position: { x: 500, y: 860 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'wait-1' },
          { id: 'e3', source: 'wait-1', target: 'msg-2' },
          { id: 'e4', source: 'msg-2', target: 'menu-1' },
          { id: 'e5', source: 'menu-1', target: 'msg-atend', sourceHandle: 'opt-1' },
          { id: 'e6', source: 'menu-1', target: 'msg-fim',   sourceHandle: 'opt-2' },
          { id: 'e7', source: 'msg-atend', target: 'end-1' },
          { id: 'e8', source: 'msg-fim', target: 'end-2' }
        ]
      },
      'fila-atendimento': {
        name: '⏳ Fila de Atendimento',
        description: 'Avisa cliente que está em fila quando todos atendentes estão ocupados',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'keyword', keyword: 'atendente' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá {nome}! 👋 Você está na fila de atendimento.' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 260 }, data: { message: '⏳ Tempo médio de espera: *5 minutos*\n📊 Sua posição na fila: *Em breve*\n\nFique tranquilo, vamos te chamar! 💚' } },
          { id: 'tag-1', type: 'addTag', position: { x: 250, y: 400 }, data: { tag: 'fila-espera' } },
          { id: 'delay-1', type: 'delay', position: { x: 250, y: 520 }, data: { duration: 300, unit: 'seconds' } },
          { id: 'msg-3', type: 'sendMessage', position: { x: 250, y: 640 }, data: { message: 'Obrigado pela paciência {nome}! Um atendente estará com você em instantes. 🙏' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 760 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'msg-2' },
          { id: 'e3', source: 'msg-2', target: 'tag-1' },
          { id: 'e4', source: 'tag-1', target: 'delay-1' },
          { id: 'e5', source: 'delay-1', target: 'msg-3' },
          { id: 'e6', source: 'msg-3', target: 'end-1' }
        ]
      },
      'departamentos': {
        name: '🏢 Direcionar para Setor',
        description: 'Cliente escolhe entre Vendas, Suporte ou Financeiro',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'all' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá {nome}! 👋 Bem-vindo ao nosso atendimento.' } },
          { id: 'menu-1', type: 'menu', position: { x: 250, y: 260 }, data: { message: 'Como podemos te ajudar?', options: [{ id: 'opt-1', label: '🛒 Vendas / Comprar' }, { id: 'opt-2', label: '🛠️ Suporte / Problemas' }, { id: 'opt-3', label: '💳 Financeiro / Boletos' }, { id: 'opt-4', label: '👤 Outro assunto' }] } },
          { id: 'msg-vendas', type: 'sendMessage', position: { x: -200, y: 480 }, data: { message: '🛒 Encaminhando você para o time de *Vendas*. Em instantes um consultor responderá!' } },
          { id: 'tag-vendas', type: 'addTag', position: { x: -200, y: 620 }, data: { tag: 'setor-vendas' } },
          { id: 'msg-suporte', type: 'sendMessage', position: { x: 100, y: 480 }, data: { message: '🛠️ Encaminhando para *Suporte Técnico*. Tenha em mãos detalhes do problema.' } },
          { id: 'tag-suporte', type: 'addTag', position: { x: 100, y: 620 }, data: { tag: 'setor-suporte' } },
          { id: 'msg-fin', type: 'sendMessage', position: { x: 400, y: 480 }, data: { message: '💳 Encaminhando para *Financeiro*. Aguarde o retorno em até 1 hora útil.' } },
          { id: 'tag-fin', type: 'addTag', position: { x: 400, y: 620 }, data: { tag: 'setor-financeiro' } },
          { id: 'msg-outro', type: 'sendMessage', position: { x: 700, y: 480 }, data: { message: '👤 Um atendente irá falar com você em instantes.' } },
          { id: 'tag-outro', type: 'addTag', position: { x: 700, y: 620 }, data: { tag: 'setor-geral' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 760 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'menu-1' },
          { id: 'e3', source: 'menu-1', target: 'msg-vendas',  sourceHandle: 'opt-1' },
          { id: 'e4', source: 'menu-1', target: 'msg-suporte', sourceHandle: 'opt-2' },
          { id: 'e5', source: 'menu-1', target: 'msg-fin',     sourceHandle: 'opt-3' },
          { id: 'e6', source: 'menu-1', target: 'msg-outro',   sourceHandle: 'opt-4' },
          { id: 'e7',  source: 'msg-vendas',  target: 'tag-vendas' },
          { id: 'e8',  source: 'msg-suporte', target: 'tag-suporte' },
          { id: 'e9',  source: 'msg-fin',     target: 'tag-fin' },
          { id: 'e10', source: 'msg-outro',   target: 'tag-outro' },
          { id: 'e11', source: 'tag-vendas',  target: 'end-1' },
          { id: 'e12', source: 'tag-suporte', target: 'end-1' },
          { id: 'e13', source: 'tag-fin',     target: 'end-1' },
          { id: 'e14', source: 'tag-outro',   target: 'end-1' }
        ]
      },
      'suporte-tecnico': {
        name: '🛠️ Suporte Técnico',
        description: 'Triagem de problema antes de chamar atendente',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'keyword', keyword: 'suporte' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá {nome}! 🛠️ Vamos resolver seu problema rapidinho.' } },
          { id: 'menu-1', type: 'menu', position: { x: 250, y: 260 }, data: { message: 'Qual o tipo do problema?', options: [{ id: 'opt-1', label: '🔌 Não liga / sem energia' }, { id: 'opt-2', label: '📶 Sem conexão / internet' }, { id: 'opt-3', label: '⚙️ Funcionamento incorreto' }, { id: 'opt-4', label: '❓ Outro' }] } },
          { id: 'msg-energia', type: 'sendMessage', position: { x: -100, y: 480 }, data: { message: '🔌 *Checklist rápido:*\n1. Verifique se o cabo está conectado\n2. Teste outra tomada\n3. Aguarde 30s e ligue novamente\n\nResolveu?' } },
          { id: 'msg-internet', type: 'sendMessage', position: { x: 200, y: 480 }, data: { message: '📶 *Checklist rápido:*\n1. Reinicie o roteador (30s desligado)\n2. Confirme se outros aparelhos conectam\n3. Verifique a senha do Wi-Fi\n\nResolveu?' } },
          { id: 'msg-funcionamento', type: 'sendMessage', position: { x: 500, y: 480 }, data: { message: '⚙️ Para te ajudar melhor, descreva em detalhes o que está acontecendo.' } },
          { id: 'msg-outro', type: 'sendMessage', position: { x: 800, y: 480 }, data: { message: '❓ Sem problema! Descreva sua questão e um técnico vai te ajudar.' } },
          { id: 'wait-desc', type: 'waitForReply', position: { x: 350, y: 660 }, data: { variableName: 'descricao_problema', message: 'Descreva o problema:' } },
          { id: 'msg-final', type: 'sendMessage', position: { x: 350, y: 800 }, data: { message: '✅ Anotamos: "{descricao_problema}"\n\nUm técnico responderá em até 30 minutos. ⏱️' } },
          { id: 'tag-1', type: 'addTag', position: { x: 350, y: 940 }, data: { tag: 'suporte-aberto' } },
          { id: 'end-1', type: 'end', position: { x: 350, y: 1060 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'menu-1' },
          { id: 'e3', source: 'menu-1', target: 'msg-energia',       sourceHandle: 'opt-1' },
          { id: 'e4', source: 'menu-1', target: 'msg-internet',      sourceHandle: 'opt-2' },
          { id: 'e5', source: 'menu-1', target: 'msg-funcionamento', sourceHandle: 'opt-3' },
          { id: 'e6', source: 'menu-1', target: 'msg-outro',         sourceHandle: 'opt-4' },
          { id: 'e7',  source: 'msg-energia',       target: 'wait-desc' },
          { id: 'e8',  source: 'msg-internet',      target: 'wait-desc' },
          { id: 'e9',  source: 'msg-funcionamento', target: 'wait-desc' },
          { id: 'e10', source: 'msg-outro',         target: 'wait-desc' },
          { id: 'e11', source: 'wait-desc', target: 'msg-final' },
          { id: 'e12', source: 'msg-final', target: 'tag-1' },
          { id: 'e13', source: 'tag-1', target: 'end-1' }
        ]
      },
      'confirma-presenca': {
        name: '✅ Confirmar Presença',
        description: 'Confirma agendamento de consulta/serviço',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'manual' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá {nome}! 📅 Lembrete do seu agendamento:' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 260 }, data: { message: '📌 *Serviço:* {servico}\n🕐 *Data/Hora:* {data_pref}\n📍 *Local:* {local}' } },
          { id: 'menu-1', type: 'menu', position: { x: 250, y: 400 }, data: { message: 'Você confirma sua presença?', options: [{ id: 'opt-1', label: '✅ Sim, confirmo' }, { id: 'opt-2', label: '🔄 Preciso remarcar' }, { id: 'opt-3', label: '❌ Cancelar' }] } },
          { id: 'msg-conf', type: 'sendMessage', position: { x: -100, y: 600 }, data: { message: '✨ Perfeito! Te esperamos no horário marcado. Até lá! 💚' } },
          { id: 'tag-conf', type: 'addTag', position: { x: -100, y: 740 }, data: { tag: 'presenca-confirmada' } },
          { id: 'msg-rem', type: 'sendMessage', position: { x: 250, y: 600 }, data: { message: '🔄 Sem problemas! Um atendente vai falar com você para encontrar uma nova data.' } },
          { id: 'tag-rem', type: 'addTag', position: { x: 250, y: 740 }, data: { tag: 'remarcar' } },
          { id: 'msg-canc', type: 'sendMessage', position: { x: 600, y: 600 }, data: { message: '😢 Lamentamos! Seu agendamento foi cancelado. Quando quiser, é só chamar.' } },
          { id: 'tag-canc', type: 'addTag', position: { x: 600, y: 740 }, data: { tag: 'agendamento-cancelado' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 880 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'msg-2' },
          { id: 'e3', source: 'msg-2', target: 'menu-1' },
          { id: 'e4', source: 'menu-1', target: 'msg-conf', sourceHandle: 'opt-1' },
          { id: 'e5', source: 'menu-1', target: 'msg-rem',  sourceHandle: 'opt-2' },
          { id: 'e6', source: 'menu-1', target: 'msg-canc', sourceHandle: 'opt-3' },
          { id: 'e7', source: 'msg-conf', target: 'tag-conf' },
          { id: 'e8', source: 'msg-rem',  target: 'tag-rem' },
          { id: 'e9', source: 'msg-canc', target: 'tag-canc' },
          { id: 'e10', source: 'tag-conf', target: 'end-1' },
          { id: 'e11', source: 'tag-rem',  target: 'end-1' },
          { id: 'e12', source: 'tag-canc', target: 'end-1' }
        ]
      },
      'carrinho-abandonado': {
        name: '🛒 Carrinho Abandonado',
        description: 'Lembra clientes que não finalizaram a compra',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'manual' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Oi {nome}! 👋 Você esqueceu algo no seu carrinho... 🛒' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 260 }, data: { message: '🎁 Vamos te dar um empurrãozinho!\n\nUse o cupom *VOLTA10* para *10% OFF* — válido só hoje!' } },
          { id: 'delay-1', type: 'delay', position: { x: 250, y: 400 }, data: { duration: 3600, unit: 'seconds' } },
          { id: 'menu-1', type: 'menu', position: { x: 250, y: 520 }, data: { message: 'Conseguiu finalizar?', options: [{ id: 'opt-1', label: '✅ Sim, finalizei' }, { id: 'opt-2', label: '🤔 Tive dúvidas' }, { id: 'opt-3', label: '❌ Não vou comprar' }] } },
          { id: 'msg-ok', type: 'sendMessage', position: { x: -100, y: 720 }, data: { message: 'Ótimo! 🎉 Em breve seu pedido chega. Obrigado!' } },
          { id: 'msg-duvida', type: 'sendMessage', position: { x: 250, y: 720 }, data: { message: 'Sem problema! Um atendente vai te ajudar com as dúvidas em instantes.' } },
          { id: 'tag-duvida', type: 'addTag', position: { x: 250, y: 860 }, data: { tag: 'duvida-compra' } },
          { id: 'msg-no', type: 'sendMessage', position: { x: 600, y: 720 }, data: { message: 'Tudo bem! Quando quiser, estamos aqui. 💚' } },
          { id: 'tag-no', type: 'addTag', position: { x: 600, y: 860 }, data: { tag: 'carrinho-perdido' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 1000 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'msg-2' },
          { id: 'e3', source: 'msg-2', target: 'delay-1' },
          { id: 'e4', source: 'delay-1', target: 'menu-1' },
          { id: 'e5', source: 'menu-1', target: 'msg-ok',     sourceHandle: 'opt-1' },
          { id: 'e6', source: 'menu-1', target: 'msg-duvida', sourceHandle: 'opt-2' },
          { id: 'e7', source: 'menu-1', target: 'msg-no',     sourceHandle: 'opt-3' },
          { id: 'e8',  source: 'msg-ok', target: 'end-1' },
          { id: 'e9',  source: 'msg-duvida', target: 'tag-duvida' },
          { id: 'e10', source: 'tag-duvida', target: 'end-1' },
          { id: 'e11', source: 'msg-no', target: 'tag-no' },
          { id: 'e12', source: 'tag-no', target: 'end-1' }
        ]
      },
      'boleto-vencendo': {
        name: '💳 Boleto Vencendo',
        description: 'Lembrete 3 dias antes do vencimento',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'manual' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Olá {nome}! 👋 Lembrete amigável sobre seu boleto.' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 260 }, data: { message: '💳 *Valor:* {valor}\n📅 *Vencimento:* {data_venc} (em 3 dias)\n\nO link/código está disponível no seu painel.' } },
          { id: 'menu-1', type: 'menu', position: { x: 250, y: 400 }, data: { message: 'Como podemos ajudar?', options: [{ id: 'opt-1', label: '✅ Já paguei' }, { id: 'opt-2', label: '📲 Reenviar boleto' }, { id: 'opt-3', label: '🔄 Negociar prazo' }] } },
          { id: 'msg-pago', type: 'sendMessage', position: { x: -100, y: 600 }, data: { message: 'Ótimo! 🙌 Vamos confirmar no sistema. Obrigado pela parceria!' } },
          { id: 'msg-reenv', type: 'sendMessage', position: { x: 250, y: 600 }, data: { message: '📲 Em instantes você receberá o boleto novamente. Aguarde!' } },
          { id: 'tag-reenv', type: 'addTag', position: { x: 250, y: 740 }, data: { tag: 'reenviar-boleto' } },
          { id: 'msg-neg', type: 'sendMessage', position: { x: 600, y: 600 }, data: { message: '🤝 Entendido! Um atendente do financeiro vai conversar com você.' } },
          { id: 'tag-neg', type: 'addTag', position: { x: 600, y: 740 }, data: { tag: 'negociar-pagamento' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 880 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'msg-2' },
          { id: 'e3', source: 'msg-2', target: 'menu-1' },
          { id: 'e4', source: 'menu-1', target: 'msg-pago',  sourceHandle: 'opt-1' },
          { id: 'e5', source: 'menu-1', target: 'msg-reenv', sourceHandle: 'opt-2' },
          { id: 'e6', source: 'menu-1', target: 'msg-neg',   sourceHandle: 'opt-3' },
          { id: 'e7', source: 'msg-pago', target: 'end-1' },
          { id: 'e8', source: 'msg-reenv', target: 'tag-reenv' },
          { id: 'e9', source: 'tag-reenv', target: 'end-1' },
          { id: 'e10', source: 'msg-neg', target: 'tag-neg' },
          { id: 'e11', source: 'tag-neg', target: 'end-1' }
        ]
      },
      'indicacao': {
        name: '🤝 Indique e Ganhe',
        description: 'Programa de indicação com cupom para os dois lados',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'keyword', keyword: 'indicar' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Que demais {nome}! 🎉 Adoramos indicações.' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 260 }, data: { message: '🎁 *Como funciona:*\n• Você indica um amigo\n• Os dois ganham *R$ 20 OFF*\n• Sem limite de indicações!' } },
          { id: 'wait-1', type: 'waitForReply', position: { x: 250, y: 400 }, data: { variableName: 'amigo_nome', message: 'Qual o nome do seu amigo?' } },
          { id: 'wait-2', type: 'waitForReply', position: { x: 250, y: 540 }, data: { variableName: 'amigo_telefone', message: 'E o telefone dele? (com DDD)' } },
          { id: 'msg-3', type: 'sendMessage', position: { x: 250, y: 680 }, data: { message: '✅ Indicação registrada!\n\n👤 *{amigo_nome}*\n📲 *{amigo_telefone}*\n\nQuando ele comprar, você ganha o cupom! 💚' } },
          { id: 'tag-1', type: 'addTag', position: { x: 250, y: 820 }, data: { tag: 'indicador' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 940 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'msg-2' },
          { id: 'e3', source: 'msg-2', target: 'wait-1' },
          { id: 'e4', source: 'wait-1', target: 'wait-2' },
          { id: 'e5', source: 'wait-2', target: 'msg-3' },
          { id: 'e6', source: 'msg-3', target: 'tag-1' },
          { id: 'e7', source: 'tag-1', target: 'end-1' }
        ]
      },
      'reativacao-30': {
        name: '🔄 Reativação 30 dias',
        description: 'Volta clientes inativos há 30+ dias',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'manual' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Oi {nome}! 👋 Faz tempo que não te vejo por aqui...' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 260 }, data: { message: '🎁 Para te trazer de volta, separei um *cupom exclusivo*: \n\n🏷️ *VOLTA20* — 20% OFF (válido por 7 dias)' } },
          { id: 'menu-1', type: 'menu', position: { x: 250, y: 400 }, data: { message: 'Quer aproveitar?', options: [{ id: 'opt-1', label: '🛒 Sim, ver novidades!' }, { id: 'opt-2', label: '🤔 Quero mais detalhes' }, { id: 'opt-3', label: '🚫 Não, obrigado' }] } },
          { id: 'msg-ver', type: 'sendMessage', position: { x: -100, y: 600 }, data: { message: '🔥 Vou te mandar nossas novidades agora! Em instantes...' } },
          { id: 'tag-ver', type: 'addTag', position: { x: -100, y: 740 }, data: { tag: 'reativado-interessado' } },
          { id: 'msg-det', type: 'sendMessage', position: { x: 250, y: 600 }, data: { message: 'Um atendente vai conversar com você e tirar todas as dúvidas. 💚' } },
          { id: 'tag-det', type: 'addTag', position: { x: 250, y: 740 }, data: { tag: 'reativacao-duvida' } },
          { id: 'msg-nao', type: 'sendMessage', position: { x: 600, y: 600 }, data: { message: 'Tudo bem! Quando precisar de algo, é só chamar. 😊' } },
          { id: 'tag-nao', type: 'addTag', position: { x: 600, y: 740 }, data: { tag: 'desinteressado' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 880 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'msg-2' },
          { id: 'e3', source: 'msg-2', target: 'menu-1' },
          { id: 'e4', source: 'menu-1', target: 'msg-ver', sourceHandle: 'opt-1' },
          { id: 'e5', source: 'menu-1', target: 'msg-det', sourceHandle: 'opt-2' },
          { id: 'e6', source: 'menu-1', target: 'msg-nao', sourceHandle: 'opt-3' },
          { id: 'e7', source: 'msg-ver', target: 'tag-ver' },
          { id: 'e8', source: 'msg-det', target: 'tag-det' },
          { id: 'e9', source: 'msg-nao', target: 'tag-nao' },
          { id: 'e10', source: 'tag-ver', target: 'end-1' },
          { id: 'e11', source: 'tag-det', target: 'end-1' },
          { id: 'e12', source: 'tag-nao', target: 'end-1' }
        ]
      },
      'promocao-flash': {
        name: '⚡ Promoção Relâmpago',
        description: 'Dispara promoção com prazo limitado e gatilho de urgência',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'manual' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: '🚨 *PROMOÇÃO RELÂMPAGO* 🚨' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 260 }, data: { message: 'Oi {nome}! Só pra você: ⚡\n\n🔥 *{produto}*\n💸 De ~R$ {preco_de}~ por *R$ {preco_por}*\n⏰ Válido só nas próximas *3 HORAS*!' } },
          { id: 'menu-1', type: 'menu', position: { x: 250, y: 400 }, data: { message: 'Quer garantir o seu?', options: [{ id: 'opt-1', label: '🛒 Quero comprar AGORA' }, { id: 'opt-2', label: '📷 Ver fotos primeiro' }, { id: 'opt-3', label: '⏰ Avise antes de acabar' }] } },
          { id: 'msg-comprar', type: 'sendMessage', position: { x: -100, y: 600 }, data: { message: 'Boa! 🎉 Um vendedor já vai falar com você para fechar.' } },
          { id: 'tag-comprar', type: 'addTag', position: { x: -100, y: 740 }, data: { tag: 'promo-quente' } },
          { id: 'msg-fotos', type: 'sendMessage', position: { x: 250, y: 600 }, data: { message: '📷 Em instantes te mando as fotos!' } },
          { id: 'tag-fotos', type: 'addTag', position: { x: 250, y: 740 }, data: { tag: 'promo-interessado' } },
          { id: 'msg-aviso', type: 'sendMessage', position: { x: 600, y: 600 }, data: { message: '⏰ Combinado! Te aviso meia hora antes de acabar. 🙌' } },
          { id: 'tag-aviso', type: 'addTag', position: { x: 600, y: 740 }, data: { tag: 'promo-aguardando' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 880 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'msg-2' },
          { id: 'e3', source: 'msg-2', target: 'menu-1' },
          { id: 'e4', source: 'menu-1', target: 'msg-comprar', sourceHandle: 'opt-1' },
          { id: 'e5', source: 'menu-1', target: 'msg-fotos',   sourceHandle: 'opt-2' },
          { id: 'e6', source: 'menu-1', target: 'msg-aviso',   sourceHandle: 'opt-3' },
          { id: 'e7', source: 'msg-comprar', target: 'tag-comprar' },
          { id: 'e8', source: 'msg-fotos',   target: 'tag-fotos' },
          { id: 'e9', source: 'msg-aviso',   target: 'tag-aviso' },
          { id: 'e10', source: 'tag-comprar', target: 'end-1' },
          { id: 'e11', source: 'tag-fotos',   target: 'end-1' },
          { id: 'e12', source: 'tag-aviso',   target: 'end-1' }
        ]
      },
      'cancelamento': {
        name: '🛡️ Retenção de Cancelamento',
        description: 'Tenta reter cliente que quer cancelar oferecendo benefícios',
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 250, y: 0 }, data: { triggerType: 'keyword', keyword: 'cancelar' } },
          { id: 'msg-1', type: 'sendMessage', position: { x: 250, y: 120 }, data: { message: 'Poxa {nome}, sentimos muito! 😔' } },
          { id: 'wait-1', type: 'waitForReply', position: { x: 250, y: 260 }, data: { variableName: 'motivo_cancel', message: 'Pode nos contar o que aconteceu? Sua opinião nos ajuda muito.' } },
          { id: 'msg-2', type: 'sendMessage', position: { x: 250, y: 400 }, data: { message: 'Entendido. 🙏 Antes de prosseguir, temos uma proposta especial pra você:' } },
          { id: 'msg-3', type: 'sendMessage', position: { x: 250, y: 540 }, data: { message: '🎁 *Oferta de Retenção:*\n• 30% OFF nos próximos 3 meses\n• Suporte prioritário\n• Sem multa de fidelidade' } },
          { id: 'menu-1', type: 'menu', position: { x: 250, y: 680 }, data: { message: 'O que prefere?', options: [{ id: 'opt-1', label: '🎁 Aceito a oferta' }, { id: 'opt-2', label: '💬 Quero falar com gerente' }, { id: 'opt-3', label: '❌ Cancelar mesmo assim' }] } },
          { id: 'msg-ret', type: 'sendMessage', position: { x: -100, y: 880 }, data: { message: '🎉 Que ótimo! Já estamos aplicando o desconto. Bem-vindo de volta!' } },
          { id: 'tag-ret', type: 'addTag', position: { x: -100, y: 1020 }, data: { tag: 'retido' } },
          { id: 'msg-ger', type: 'sendMessage', position: { x: 250, y: 880 }, data: { message: '💼 Um gerente vai conversar com você em até 1 hora. Vamos resolver!' } },
          { id: 'tag-ger', type: 'addTag', position: { x: 250, y: 1020 }, data: { tag: 'retencao-gerente' } },
          { id: 'msg-cancel', type: 'sendMessage', position: { x: 600, y: 880 }, data: { message: '😢 Entendemos. Em instantes processamos seu cancelamento. Foi um prazer te atender!' } },
          { id: 'tag-cancel', type: 'addTag', position: { x: 600, y: 1020 }, data: { tag: 'cancelar-confirmado' } },
          { id: 'end-1', type: 'end', position: { x: 250, y: 1160 }, data: {} }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'msg-1' },
          { id: 'e2', source: 'msg-1', target: 'wait-1' },
          { id: 'e3', source: 'wait-1', target: 'msg-2' },
          { id: 'e4', source: 'msg-2', target: 'msg-3' },
          { id: 'e5', source: 'msg-3', target: 'menu-1' },
          { id: 'e6', source: 'menu-1', target: 'msg-ret',    sourceHandle: 'opt-1' },
          { id: 'e7', source: 'menu-1', target: 'msg-ger',    sourceHandle: 'opt-2' },
          { id: 'e8', source: 'menu-1', target: 'msg-cancel', sourceHandle: 'opt-3' },
          { id: 'e9',  source: 'msg-ret',    target: 'tag-ret' },
          { id: 'e10', source: 'msg-ger',    target: 'tag-ger' },
          { id: 'e11', source: 'msg-cancel', target: 'tag-cancel' },
          { id: 'e12', source: 'tag-ret',    target: 'end-1' },
          { id: 'e13', source: 'tag-ger',    target: 'end-1' },
          { id: 'e14', source: 'tag-cancel', target: 'end-1' }
        ]
      }
    }

    const tpl = templates[templateName]
    if (!tpl) return res.status(400).json({ error: 'Template inválido', available: Object.keys(templates) })

    const wf = await Workflow.create({ userId: req.userRealId, instanceId, ...tpl })
    res.status(201).json(wf)
  } catch (err) {
    res.status(500).json({ message: 'Erro: ' + err.message })
  }
})

// Helper para outros módulos
router.getActiveSessions = () => activeSessions

module.exports = router
