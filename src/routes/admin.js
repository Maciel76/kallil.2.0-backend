const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const User = require('../models/User')
const SuporteTicket = require('../models/SuporteTicket')
const Venda = require('../models/Venda')
const Produto = require('../models/Produto')
const Caixa = require('../models/Caixa')
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

// ============================
// === RELATÓRIOS ===
// ============================

// Helper: monta o filtro de data a partir de um período
// Retorna { filtro, periodoAnterior, dias, granularidade }
function montarPeriodo(periodo, inicio, fim) {
  const agora = new Date()
  let dataInicio = null
  let dataFim = new Date(agora)
  dataFim.setHours(23, 59, 59, 999)

  if (periodo === 'hoje') {
    dataInicio = new Date(agora); dataInicio.setHours(0, 0, 0, 0)
  } else if (periodo === 'ontem') {
    dataInicio = new Date(agora); dataInicio.setDate(dataInicio.getDate() - 1); dataInicio.setHours(0, 0, 0, 0)
    dataFim = new Date(agora); dataFim.setDate(dataFim.getDate() - 1); dataFim.setHours(23, 59, 59, 999)
  } else if (periodo === '7dias') {
    dataInicio = new Date(agora); dataInicio.setDate(dataInicio.getDate() - 7); dataInicio.setHours(0, 0, 0, 0)
  } else if (periodo === '30dias') {
    dataInicio = new Date(agora); dataInicio.setDate(dataInicio.getDate() - 30); dataInicio.setHours(0, 0, 0, 0)
  } else if (periodo === 'mes') {
    dataInicio = new Date(agora.getFullYear(), agora.getMonth(), 1)
  } else if (periodo === 'mesAnterior') {
    dataInicio = new Date(agora.getFullYear(), agora.getMonth() - 1, 1)
    dataFim = new Date(agora.getFullYear(), agora.getMonth(), 0, 23, 59, 59, 999)
  } else if (periodo === 'custom' && inicio) {
    dataInicio = new Date(inicio); dataInicio.setHours(0, 0, 0, 0)
    if (fim) { dataFim = new Date(fim); dataFim.setHours(23, 59, 59, 999) }
  } else {
    return { filtro: {}, periodoAnterior: {}, granularidade: 'mes', dias: 0 }
  }

  const filtro = { createdAt: { $gte: dataInicio, $lte: dataFim } }

  // período anterior com a mesma duração
  const ms = dataFim.getTime() - dataInicio.getTime()
  const antFim = new Date(dataInicio.getTime() - 1)
  const antInicio = new Date(antFim.getTime() - ms)
  const periodoAnterior = { createdAt: { $gte: antInicio, $lte: antFim } }

  // granularidade para o gráfico
  const dias = Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)))
  let granularidade = 'mes'
  if (dias <= 2) granularidade = 'hora'
  else if (dias <= 31) granularidade = 'dia'
  else if (dias <= 90) granularidade = 'semana'
  else granularidade = 'mes'

  return { filtro, periodoAnterior, granularidade, dias }
}

// GET /api/admin/relatorios — listagem de donos para filtro
router.get('/relatorios/donos', async (req, res) => {
  try {
    const donos = await User.find({ role: 'dono' })
      .select('_id nome nomeNegocio email ativo')
      .sort({ nome: 1 })
      .lean()

    res.json(donos.map(d => ({
      id: d._id,
      nome: d.nome,
      nomeNegocio: d.nomeNegocio || d.nome,
      email: d.email,
      ativo: d.ativo
    })))
  } catch (error) {
    res.status(500).json({ message: 'Erro ao carregar donos.' })
  }
})

// GET /api/admin/relatorios?periodo=...&donoId=...&inicio=...&fim=...
// Retorna: totais globais, vendas agregadas por dono + formas pagamento + operadores
router.get('/relatorios', async (req, res) => {
  try {
    const { periodo = 'mes', donoId, inicio, fim, busca } = req.query
    const { filtro, periodoAnterior, granularidade, dias } = montarPeriodo(periodo, inicio, fim)

    const baseFiltro = { ...filtro, status: { $ne: 'cancelado' } }
    if (donoId && donoId !== 'todos') {
      baseFiltro.userId = new mongoose.Types.ObjectId(donoId)
    }

    const filtroAnt = { ...periodoAnterior, status: { $ne: 'cancelado' } }
    if (donoId && donoId !== 'todos') filtroAnt.userId = new mongoose.Types.ObjectId(donoId)

    const [vendas, vendasAnt, ultimasVendasRaw] = await Promise.all([
      Venda.find(baseFiltro)
        .select('userId formaPagamento status totalFinal lucroTotal caixaId createdAt')
        .lean(),
      Venda.find(filtroAnt).select('totalFinal lucroTotal status').lean(),
      Venda.find(baseFiltro)
        .select('userId formaPagamento status totalFinal createdAt caixaId')
        .sort({ createdAt: -1 })
        .limit(500)
        .lean()
    ])

    const caixaIds = [...new Set(vendas.map(v => v.caixaId).filter(Boolean))]
    const caixas = caixaIds.length
      ? await Caixa.find({ _id: { $in: caixaIds } }).select('_id operador operadorId nome numero').lean()
      : []
    const caixaMap = {}
    caixas.forEach(c => { caixaMap[String(c._id)] = c })

    const donoIds = [...new Set(vendas.map(v => String(v.userId)))]
    const donosAll = donoIds.length
      ? await User.find({ _id: { $in: donoIds } }).select('_id nome nomeNegocio email').lean()
      : []
    const donoMap = {}
    donosAll.forEach(d => { donoMap[String(d._id)] = d })

    const agregadoPorDono = {}
    const serie = {}
    let totalGeral = 0, qtdGeral = 0, lucroGeral = 0, fiadoGeral = 0
    const formasGeral = {}
    const canais = { delivery: 0, balcao: 0, retirada: 0, whatsapp: 0, outros: 0 }

    vendas.forEach(v => {
      const keyDono = String(v.userId)
      if (!agregadoPorDono[keyDono]) {
        const dono = donoMap[keyDono] || {}
        agregadoPorDono[keyDono] = {
          donoId: keyDono,
          nome: dono.nome || 'Sem nome',
          nomeNegocio: dono.nomeNegocio || dono.nome || 'Sem negócio',
          email: dono.email || '',
          avatar: iniciais(dono.nomeNegocio || dono.nome || '?'),
          totalVendas: 0,
          qtdVendas: 0,
          lucroTotal: 0,
          ticketMedio: 0,
          ultimaVenda: null,
          ativo: true,
          formasPagamento: {},
          operadores: {}
        }
      }

      const item = agregadoPorDono[keyDono]
      item.totalVendas += v.totalFinal || 0
      item.qtdVendas += 1
      item.lucroTotal += v.lucroTotal || 0

      const d = new Date(v.createdAt)
      if (!item.ultimaVenda || new Date(item.ultimaVenda) < d) {
        item.ultimaVenda = v.createdAt
      }

      totalGeral += v.totalFinal || 0
      qtdGeral += 1
      lucroGeral += v.lucroTotal || 0
      if (v.status === 'fiado') fiadoGeral += v.totalFinal || 0

      const forma = v.formaPagamento || 'outros'
      if (!item.formasPagamento[forma]) item.formasPagamento[forma] = { total: 0, quantidade: 0 }
      item.formasPagamento[forma].total += v.totalFinal || 0
      item.formasPagamento[forma].quantidade += 1
      if (!formasGeral[forma]) formasGeral[forma] = { total: 0, quantidade: 0 }
      formasGeral[forma].total += v.totalFinal || 0
      formasGeral[forma].quantidade += 1

      const canal = inferirCanal(v.formaPagamento)
      canais[canal] = (canais[canal] || 0) + 1

      const caixa = v.caixaId ? caixaMap[String(v.caixaId)] : null
      const nomeOp = caixa?.operador?.trim() || (caixa?.operadorId ? `Op-${String(caixa.operadorId).slice(-4)}` : 'Dono / PDV')
      if (!item.operadores[nomeOp]) {
        item.operadores[nomeOp] = { nome: nomeOp, total: 0, quantidade: 0, lucro: 0, formasPagamento: {} }
      }
      item.operadores[nomeOp].total += v.totalFinal || 0
      item.operadores[nomeOp].quantidade += 1
      item.operadores[nomeOp].lucro += v.lucroTotal || 0
      if (!item.operadores[nomeOp].formasPagamento[forma]) item.operadores[nomeOp].formasPagamento[forma] = { total: 0, quantidade: 0 }
      item.operadores[nomeOp].formasPagamento[forma].total += v.totalFinal || 0
      item.operadores[nomeOp].formasPagamento[forma].quantidade += 1

      const chave = chaveSerie(d, granularidade)
      if (!serie[chave]) serie[chave] = { data: chave, total: 0, quantidade: 0 }
      serie[chave].total += v.totalFinal || 0
      serie[chave].quantidade += 1
    })

    let lista = Object.values(agregadoPorDono).map(d => ({
      ...d,
      ticketMedio: d.qtdVendas > 0 ? d.totalVendas / d.qtdVendas : 0
    }))

    if (busca && busca.trim()) {
      const q = busca.toLowerCase()
      lista = lista.filter(d =>
        (d.nomeNegocio || '').toLowerCase().includes(q) ||
        (d.nome || '').toLowerCase().includes(q)
      )
    }

    lista.sort((a, b) => b.totalVendas - a.totalVendas)

    const totalAnt = vendasAnt.reduce((a, v) => a + (v.totalFinal || 0), 0)
    const qtdAnt = vendasAnt.length
    const ticketMedio = qtdGeral > 0 ? totalGeral / qtdGeral : 0
    const ticketMedioAnt = qtdAnt > 0 ? totalAnt / qtdAnt : 0

    let negociosNovos = 0
    if (filtro && filtro.createdAt) {
      negociosNovos = await User.countDocuments({ role: 'dono', createdAt: filtro.createdAt })
    }
    let negociosNovosAnt = 0
    if (periodoAnterior && periodoAnterior.createdAt) {
      negociosNovosAnt = await User.countDocuments({ role: 'dono', createdAt: periodoAnterior.createdAt })
    }

    const variacao = (atual, anterior) => {
      if (!anterior) return atual > 0 ? 100 : 0
      return ((atual - anterior) / anterior) * 100
    }

    const totalDist = Object.values(canais).reduce((a, b) => a + b, 0) || 1
    const distribuicao = Object.entries(canais)
      .map(([canal, qtd]) => ({ canal, qtd, percentual: (qtd / totalDist) * 100 }))
      .filter(d => d.qtd > 0)
      .sort((a, b) => b.qtd - a.qtd)

    const serieArray = Object.values(serie).sort((a, b) => a.data.localeCompare(b.data))

    const resumo = montarResumo({
      total: totalGeral, totalAnt,
      qtd: qtdGeral, qtdAnt,
      ticketMedio, ticketMedioAnt,
      negociosNovos, negociosNovosAnt,
      variacaoTotal: variacao(totalGeral, totalAnt),
      variacaoQtd: variacao(qtdGeral, qtdAnt),
      variacaoTicket: variacao(ticketMedio, ticketMedioAnt)
    })

    const vendasDetalhadas = ultimasVendasRaw.slice(0, 50).map(v => {
      const dono = donoMap[String(v.userId)] || {}
      const caixa = v.caixaId ? caixaMap[String(v.caixaId)] : null
      return {
        id: v._id,
        usuario: dono.nome || 'Sem nome',
        iniciais: iniciais(dono.nome || dono.nomeNegocio || '?'),
        negocio: dono.nomeNegocio || dono.nome || '—',
        formaPagamento: v.formaPagamento,
        total: v.totalFinal,
        status: v.status,
        createdAt: v.createdAt,
        operador: caixa?.operador || '—'
      }
    })

    res.json({
      periodo,
      granularidade,
      dias,
      donoid: donoId || 'todos',
      kpis: {
        faturamentoTotal: totalGeral,
        qtdVendas: qtdGeral,
        ticketMedio,
        negociosAtivos: lista.length,
        variacaoFaturamento: variacao(totalGeral, totalAnt),
        variacaoQtd: variacao(qtdGeral, qtdAnt),
        variacaoTicket: variacao(ticketMedio, ticketMedioAnt),
        negociosNovos,
        variacaoNegocios: variacao(negociosNovos, negociosNovosAnt)
      },
      formasPagamento: formasGeral,
      distribuicao,
      serie: serieArray,
      topNegocios: lista.slice(0, 5),
      totalNegocios: lista.length,
      resumo,
      vendasDetalhadas,
      todosNegocios: lista
    })
  } catch (error) {
    console.error('Erro relatório admin:', error)
    res.status(500).json({ message: 'Erro ao gerar relatório.' })
  }
})

// GET /api/admin/relatorios/dono/:id — detalhamento de um dono
router.get('/relatorios/dono/:id', async (req, res) => {
  try {
    const { periodo = 'mes', inicio, fim } = req.query
    const donoId = req.params.id

    const dono = await User.findOne({ _id: donoId, role: 'dono' }).select('nome nomeNegocio email').lean()
    if (!dono) return res.status(404).json({ message: 'Negócio não encontrado.' })

    const { filtro } = montarPeriodo(periodo, inicio, fim)
    const fil = { ...filtro, userId: new mongoose.Types.ObjectId(donoId) }

    const vendas = await Venda.find(fil).sort({ createdAt: -1 }).lean()
    const caixaIds = [...new Set(vendas.map(v => v.caixaId).filter(Boolean))]
    const caixas = caixaIds.length
      ? await Caixa.find({ _id: { $in: caixaIds } }).select('_id operador operadorId nome numero').lean()
      : []
    const caixaMap = {}
    caixas.forEach(c => { caixaMap[String(c._id)] = c })

    // agregar por operador
    const porOperador = {}
    vendas.forEach(v => {
      if (v.status === 'cancelado') return
      const caixa = v.caixaId ? caixaMap[String(v.caixaId)] : null
      const nomeOp = caixa?.operador?.trim() || (caixa?.operadorId ? `Op-${String(caixa.operadorId).slice(-4)}` : 'Dono / PDV')
      if (!porOperador[nomeOp]) {
        porOperador[nomeOp] = {
          nome: nomeOp,
          caixa: caixa?.nome || (caixa?.numero ? `Caixa ${caixa.numero}` : '-'),
          total: 0, quantidade: 0, lucro: 0,
          formasPagamento: {}
        }
      }
      porOperador[nomeOp].total += v.totalFinal || 0
      porOperador[nomeOp].quantidade += 1
      porOperador[nomeOp].lucro += v.lucroTotal || 0
      const forma = v.formaPagamento || 'outros'
      if (!porOperador[nomeOp].formasPagamento[forma]) porOperador[nomeOp].formasPagamento[forma] = { total: 0, quantidade: 0 }
      porOperador[nomeOp].formasPagamento[forma].total += v.totalFinal || 0
      porOperador[nomeOp].formasPagamento[forma].quantidade += 1
    })

    res.json({
      dono: {
        id: dono._id,
        nome: dono.nome,
        nomeNegocio: dono.nomeNegocio || dono.nome,
        email: dono.email
      },
      periodo,
      totais: {
        totalVendas: vendas.filter(v => v.status !== 'cancelado').reduce((a, v) => a + v.totalFinal, 0),
        qtdVendas: vendas.filter(v => v.status !== 'cancelado').length,
        lucroTotal: vendas.filter(v => v.status !== 'cancelado').reduce((a, v) => a + (v.lucroTotal || 0), 0),
        fiado: vendas.filter(v => v.status === 'fiado').reduce((a, v) => a + v.totalFinal, 0),
        cancelado: vendas.filter(v => v.status === 'cancelado').reduce((a, v) => a + v.totalFinal, 0)
      },
      operadores: Object.values(porOperador).sort((a, b) => b.total - a.total),
      ultimasVendas: vendas.slice(0, 20).map(v => {
        const caixa = v.caixaId ? caixaMap[String(v.caixaId)] : null
        return {
          id: v._id,
          createdAt: v.createdAt,
          total: v.totalFinal,
          formaPagamento: v.formaPagamento,
          status: v.status,
          lucro: v.lucroTotal,
          operador: caixa?.operador || '-'
        }
      })
    })
  } catch (error) {
    console.error('Erro detalhe dono:', error)
    res.status(500).json({ message: 'Erro ao gerar relatório do dono.' })
  }
})

// === Helpers do relatório ===
function iniciais(txt = '') {
  return txt.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?'
}

function pad(n) { return String(n).padStart(2, '0') }

function chaveSerie(d, granularidade) {
  if (granularidade === 'hora') {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`
  }
  if (granularidade === 'dia') {
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
  }
  if (granularidade === 'semana') {
    const onejan = new Date(d.getFullYear(), 0, 1)
    const semana = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7)
    return `Sem ${semana}`
  }
  return `${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

function inferirCanal(forma) {
  if (forma === 'pix') return 'whatsapp'
  if (forma === 'credito') return 'delivery'
  if (forma === 'debito') return 'balcao'
  if (forma === 'dinheiro') return 'balcao'
  if (forma === 'fiado') return 'retirada'
  return 'outros'
}

function montarResumo({ total, totalAnt, qtd, qtdAnt, ticketMedio, ticketMedioAnt, negociosNovos, variacaoTotal, variacaoQtd, variacaoTicket }) {
  const fmt = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
  const itens = []

  if (variacaoTotal !== 0) {
    itens.push({
      icone: variacaoTotal >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down',
      texto: `O faturamento total ${variacaoTotal >= 0 ? 'cresceu' : 'caiu'} ${fmtPct(Math.abs(variacaoTotal))} em relação ao período anterior, representando ${variacaoTotal >= 0 ? 'um aumento' : 'uma queda'} de ${fmt(Math.abs(total - totalAnt))}.`,
      tom: variacaoTotal >= 0 ? 'positivo' : 'negativo'
    })
  }
  if (qtd > 0) {
    const variou = variacaoQtd !== 0
    itens.push({
      icone: variou && variacaoQtd < 0 ? 'fa-cart-shopping' : 'fa-cart-shopping',
      texto: `Foram realizadas ${qtd} venda${qtd !== 1 ? 's' : ''}${variou ? `, ${variacaoQtd >= 0 ? 'um aumento' : 'uma queda'} de ${fmtPct(Math.abs(variacaoQtd))} comparado ao período anterior (${qtdAnt}).` : '.'}`,
      tom: variacaoQtd >= 0 ? 'positivo' : 'negativo'
    })
  }
  if (negociosNovos > 0) {
    itens.push({
      icone: 'fa-store',
      texto: `${negociosNovos} novo${negociosNovos !== 1 ? 's' : ''} negócio${negociosNovos !== 1 ? 's' : ''} se cadastraram e realizaram vendas no período.`,
      tom: 'positivo'
    })
  }
  if (ticketMedio > 0 && variacaoTicket !== 0) {
    itens.push({
      icone: 'fa-receipt',
      texto: `O ticket médio ${variacaoTicket >= 0 ? 'teve um crescimento' : 'teve uma queda'} de ${fmtPct(Math.abs(variacaoTicket))}, ${variacaoTicket >= 0 ? 'atingindo' : 'ficando em'} ${fmt(ticketMedio)}.`,
      tom: variacaoTicket >= 0 ? 'positivo' : 'negativo'
    })
  }
  return itens
}

module.exports = router
