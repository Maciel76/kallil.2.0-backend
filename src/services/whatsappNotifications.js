const WhatsAppInstance = require('../models/WhatsAppInstance')

/**
 * Envia notificação WhatsApp para o número cadastrado na instância do admin.
 * Busca a primeira instância conectada que tenha notificationPhone configurado.
 * 
 * @param {string} message - Texto da mensagem
 * @param {Function} getActiveSessions - Função que retorna o Map de sessões ativas
 */
async function sendAdminNotification(message, getActiveSessions) {
  try {
    // Busca instância conectada que tenha número de notificação
    const instance = await WhatsAppInstance.findOne({
      status: 'connected',
      notificationPhone: { $ne: null, $ne: '' }
    })

    if (!instance || !instance.notificationPhone) {
      return
    }

    const activeSessions = getActiveSessions()
    const session = activeSessions.get(instance._id.toString())

    if (!session || !session.connected) {
      return
    }

    await session.sendMessage(instance.notificationPhone, message)
    console.log(`[WA-Notify] ✅ Notificação enviada para ${instance.notificationPhone}`)
  } catch (err) {
    console.error(`[WA-Notify] ❌ Erro ao enviar notificação:`, err.message)
  }
}

/**
 * Notificação de novo usuário cadastrado
 */
async function notifyNewUser({ nome, email, nomeNegocio }, getActiveSessions) {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const message =
    `📋 *Novo Cadastro no Sistema*\n\n` +
    `👤 *Nome:* ${nome}\n` +
    `📧 *E-mail:* ${email}\n` +
    `🏪 *Negócio:* ${nomeNegocio || 'Não informado'}\n` +
    `🕐 *Data:* ${now}`

  await sendAdminNotification(message, getActiveSessions)
}

/**
 * Notificação de upgrade/ativação de plano (pagamento aprovado ou admin)
 */
async function notifyPlanUpgrade({ nome, email, nomeNegocio, meses, assinaturaExpira }, getActiveSessions) {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const expira = assinaturaExpira
    ? new Date(assinaturaExpira).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '—'
  const message =
    `💎 *Upgrade de Plano*\n\n` +
    `👤 *Nome:* ${nome}\n` +
    `📧 *E-mail:* ${email}\n` +
    `🏪 *Negócio:* ${nomeNegocio || 'Não informado'}\n` +
    `📦 *Duração:* ${meses} ${meses === 1 ? 'mês' : 'meses'}\n` +
    `📅 *Expira em:* ${expira}\n` +
    `🕐 *Data:* ${now}`

  await sendAdminNotification(message, getActiveSessions)
}

/**
 * Notificação de renovação de plano
 */
async function notifyPlanRenewal({ nome, email, nomeNegocio, meses, assinaturaExpira }, getActiveSessions) {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const expira = assinaturaExpira
    ? new Date(assinaturaExpira).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '—'
  const message =
    `🔄 *Renovação de Plano*\n\n` +
    `👤 *Nome:* ${nome}\n` +
    `📧 *E-mail:* ${email}\n` +
    `🏪 *Negócio:* ${nomeNegocio || 'Não informado'}\n` +
    `📦 *Duração:* +${meses} ${meses === 1 ? 'mês' : 'meses'}\n` +
    `📅 *Nova expiração:* ${expira}\n` +
    `🕐 *Data:* ${now}`

  await sendAdminNotification(message, getActiveSessions)
}

/**
 * Notificação de nova mensagem de suporte do usuário
 */
async function notifySupportMessage({ nome, email, nomeNegocio, assunto, mensagem, ticketId }, getActiveSessions) {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  const linkSuporte = `${frontendUrl}/admin/painel?pagina=suporte&ticket=${ticketId}`

  const textoMensagem = mensagem.length > 200 ? mensagem.substring(0, 200) + '...' : mensagem

  const message =
    `🆘 *Nova Mensagem de Suporte*\n\n` +
    `👤 *Nome:* ${nome}\n` +
    `📧 *E-mail:* ${email}\n` +
    `🏪 *Negócio:* ${nomeNegocio || 'Não informado'}\n` +
    `📋 *Assunto:* ${assunto}\n\n` +
    `💬 *Mensagem:*\n${textoMensagem}\n\n` +
    `🔗 *Responder agora:*\n${linkSuporte}\n\n` +
    `🕐 *Data:* ${now}`

  await sendAdminNotification(message, getActiveSessions)
}

module.exports = {
  sendAdminNotification,
  notifyNewUser,
  notifyPlanUpgrade,
  notifyPlanRenewal,
  notifySupportMessage,
}
