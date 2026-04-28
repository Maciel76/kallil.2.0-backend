/**
 * Serviço de notificações automáticas para usuários (donos de negócio).
 * - Resumo diário de vendas
 * - Lembrete de pagamento (vendas fiado próximas do vencimento)
 * - Mensagem de agradecimento após compra
 * - Cobrança automática
 *
 * As preferências ficam em WhatsAppInstance.notificacoes.
 */
const WhatsAppInstance = require('../models/WhatsAppInstance')
const Venda = require('../models/Venda')
const Cliente = require('../models/Cliente')

let _getActiveSessions = null

function setActiveSessionsProvider(fn) {
  _getActiveSessions = fn
}

async function _getConnectedInstance(userId) {
  const instance = await WhatsAppInstance.findOne({ userId, status: 'connected' })
  if (!instance) return null
  if (!_getActiveSessions) return null
  const sessions = _getActiveSessions()
  const wa = sessions.get(instance._id.toString())
  if (!wa || !wa.connected) return null
  return { instance, wa }
}

function _replaceVars(text, vars) {
  let r = text || ''
  for (const [k, v] of Object.entries(vars || {})) {
    r = r.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''))
  }
  return r
}

function _money(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Envia mensagem de agradecimento após uma venda concluída.
 */
async function enviarAgradecimentoVenda(userId, venda) {
  try {
    const ctx = await _getConnectedInstance(userId)
    if (!ctx) return
    if (!ctx.instance.notificacoes?.agradecimentoCompra) return
    if (!venda.clienteId) return

    const cliente = await Cliente.findById(venda.clienteId)
    if (!cliente || !cliente.telefone) return

    const template = ctx.instance.notificacoes.mensagemAgradecimento ||
      '🙏 Olá {nome}! Obrigado pela sua compra de R$ {valor}.'
    const texto = _replaceVars(template, {
      nome: cliente.nome,
      valor: _money(venda.totalFinal),
      itens: venda.itens?.length || 0
    })
    await ctx.wa.sendMessage(cliente.telefone, texto)
    console.log(`[AUTOMACAO] ✅ Agradecimento enviado para ${cliente.nome}`)
  } catch (err) {
    console.error('[AUTOMACAO] erro agradecimento:', err.message)
  }
}

/**
 * Envia cobrança automática para venda fiado recém-criada.
 */
async function enviarCobrancaFiado(userId, venda) {
  try {
    const ctx = await _getConnectedInstance(userId)
    if (!ctx) return
    if (!ctx.instance.notificacoes?.cobrancaAutomatica) return
    if (venda.formaPagamento !== 'fiado' || !venda.clienteId) return

    const cliente = await Cliente.findById(venda.clienteId)
    if (!cliente || !cliente.telefone) return

    const venc = venda.dataVencimento
      ? new Date(venda.dataVencimento).toLocaleDateString('pt-BR')
      : '—'
    const template = ctx.instance.notificacoes.mensagemCobranca ||
      '📌 Olá {nome}, sua compra de R$ {valor} vence em {vencimento}.'
    const texto = _replaceVars(template, {
      nome: cliente.nome,
      valor: _money(venda.totalFinal),
      vencimento: venc
    })
    await ctx.wa.sendMessage(cliente.telefone, texto)
    console.log(`[AUTOMACAO] 💰 Cobrança fiado enviada a ${cliente.nome}`)
  } catch (err) {
    console.error('[AUTOMACAO] erro cobrança:', err.message)
  }
}

/**
 * Resumo diário de vendas (envia para o número de notificação do dono).
 */
async function enviarResumoDiario(userId) {
  try {
    const ctx = await _getConnectedInstance(userId)
    if (!ctx) return
    const cfg = ctx.instance.notificacoes
    if (!cfg?.vendasDiarias) return
    if (!ctx.instance.notificationPhone) return

    const inicio = new Date()
    inicio.setHours(0, 0, 0, 0)
    const fim = new Date()
    fim.setHours(23, 59, 59, 999)

    const vendas = await Venda.find({
      userId,
      createdAt: { $gte: inicio, $lte: fim },
      status: { $ne: 'cancelado' }
    })

    const totalVendas = vendas.length
    const faturamento = vendas.reduce((s, v) => s + (v.totalFinal || 0), 0)
    const lucro = vendas.reduce((s, v) => s + (v.lucroTotal || 0), 0)
    const fiado = vendas.filter(v => v.formaPagamento === 'fiado').length
    const fiadoValor = vendas
      .filter(v => v.formaPagamento === 'fiado')
      .reduce((s, v) => s + (v.totalFinal || 0), 0)

    const data = inicio.toLocaleDateString('pt-BR')
    const msg =
      `📊 *Resumo do Dia — ${data}*\n\n` +
      `🧾 Vendas: *${totalVendas}*\n` +
      `💵 Faturamento: *R$ ${_money(faturamento)}*\n` +
      `📈 Lucro estimado: *R$ ${_money(lucro)}*\n` +
      (fiado > 0 ? `📌 Fiado: ${fiado} venda(s) — R$ ${_money(fiadoValor)}\n` : '') +
      `\n_Mensagem automática do Kallil 2.0_`

    await ctx.wa.sendMessage(ctx.instance.notificationPhone, msg)
    ctx.instance.notificacoes.ultimoResumoEnviado = new Date()
    await ctx.instance.save()
    console.log(`[AUTOMACAO] 📊 Resumo diário enviado (user ${userId})`)
  } catch (err) {
    console.error('[AUTOMACAO] erro resumo:', err.message)
  }
}

/**
 * Envia lembretes de pagamento para clientes com fiado próximo do vencimento.
 */
async function enviarLembretesPagamento(userId) {
  try {
    const ctx = await _getConnectedInstance(userId)
    if (!ctx) return
    const cfg = ctx.instance.notificacoes
    if (!cfg?.lembretePagamento) return

    const dias = cfg.diasAntesVencimento || 1
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const alvo = new Date(hoje)
    alvo.setDate(alvo.getDate() + dias)
    const alvoFim = new Date(alvo)
    alvoFim.setHours(23, 59, 59, 999)

    const fiados = await Venda.find({
      userId,
      status: 'fiado',
      formaPagamento: 'fiado',
      dataVencimento: { $gte: alvo, $lte: alvoFim }
    }).populate('clienteId')

    for (const v of fiados) {
      const cli = v.clienteId
      if (!cli || !cli.telefone) continue
      const venc = new Date(v.dataVencimento).toLocaleDateString('pt-BR')
      const template = cfg.mensagemCobranca ||
        '📌 Olá {nome}, lembrando que sua conta de R$ {valor} vence em {vencimento}.'
      const texto = _replaceVars(template, {
        nome: cli.nome,
        valor: _money(v.totalFinal),
        vencimento: venc
      })
      try {
        await ctx.wa.sendMessage(cli.telefone, texto)
        console.log(`[AUTOMACAO] 🔔 Lembrete -> ${cli.nome}`)
      } catch (err) {
        console.error('[AUTOMACAO] lembrete falhou:', err.message)
      }
    }
  } catch (err) {
    console.error('[AUTOMACAO] erro lembretes:', err.message)
  }
}

/**
 * Roda diariamente para todos os usuários: resumo + lembretes.
 * Verifica horaResumo da config para enviar próximo da hora indicada.
 */
async function tickAutomacoes() {
  try {
    const instances = await WhatsAppInstance.find({ status: 'connected' })
    const agora = new Date()
    const hh = String(agora.getHours()).padStart(2, '0')
    const mm = String(agora.getMinutes()).padStart(2, '0')
    const horaAtual = `${hh}:${mm}`

    for (const inst of instances) {
      const cfg = inst.notificacoes
      if (!cfg) continue

      // Resumo diário — envia se hora atual >= horaResumo e não foi enviado hoje
      if (cfg.vendasDiarias && cfg.horaResumo) {
        const ultimo = cfg.ultimoResumoEnviado ? new Date(cfg.ultimoResumoEnviado) : null
        const enviadoHoje =
          ultimo &&
          ultimo.getDate() === agora.getDate() &&
          ultimo.getMonth() === agora.getMonth() &&
          ultimo.getFullYear() === agora.getFullYear()

        if (!enviadoHoje && horaAtual >= cfg.horaResumo) {
          await enviarResumoDiario(inst.userId)
        }
      }

      // Lembretes — uma vez por dia (manhã, 09:00 fixo)
      if (cfg.lembretePagamento && horaAtual === '09:00') {
        await enviarLembretesPagamento(inst.userId)
      }
    }
  } catch (err) {
    console.error('[AUTOMACAO] tick erro:', err.message)
  }
}

function startScheduler() {
  // Tick a cada minuto
  setInterval(tickAutomacoes, 60 * 1000)
  console.log('⏰ Scheduler de automação WhatsApp iniciado')
}

module.exports = {
  setActiveSessionsProvider,
  enviarAgradecimentoVenda,
  enviarCobrancaFiado,
  enviarResumoDiario,
  enviarLembretesPagamento,
  startScheduler
}
