const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  extractMessageContent,
  isJidUser,
  isLidUser,
} = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const QRCode = require('qrcode')
const pino = require('pino')
const path = require('path')
const fs = require('fs')
const EventEmitter = require('events')
const WhatsAppInstance = require('../models/WhatsAppInstance')

const logger = pino({ level: 'silent' })

class WhatsAppService extends EventEmitter {
  constructor(instance) {
    super()
    this.instance = instance
    this.socket = null
    this.qrCode = null
    this.connected = false
    this.retryCount = 0
    this.maxRetries = 5
    this.sessionPath = path.join(__dirname, '..', '..', 'sessions', instance._id.toString())
    this._initializing = false
    this._reconnectTimer = null
    this._patrolTimer = null
    this._440count = 0
  }

  _isPrivateChat(jid) {
    if (!jid) return false
    return isJidUser(jid) || isLidUser(jid)
  }

  _extractNumber(jid) {
    if (!jid) return ''
    if (jid.endsWith('@s.whatsapp.net')) return jid.replace('@s.whatsapp.net', '')
    if (jid.endsWith('@lid')) return jid.replace('@lid', '')
    return jid
  }

  _startPatrol() {
    this._stopPatrol()
    this._patrolTimer = setInterval(() => {
      if (this.connected) {
        this._stopPatrol()
        return
      }
      if (this._initializing) return
      this.initialize().catch(() => {})
    }, 120000)
  }

  _stopPatrol() {
    if (this._patrolTimer) {
      clearInterval(this._patrolTimer)
      this._patrolTimer = null
    }
  }

  async initialize() {
    if (this._initializing) return true
    this._initializing = true

    try {
      if (!fs.existsSync(this.sessionPath)) {
        fs.mkdirSync(this.sessionPath, { recursive: true })
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath)
      const { version } = await fetchLatestBaileysVersion()

      if (this.socket) {
        try {
          this.socket.ev.removeAllListeners()
          this.socket.end()
        } catch (e) {
          try { this.socket.ws.close() } catch (_) {}
        }
        this.socket = null
        this.connected = false
        await new Promise(r => setTimeout(r, 2000))
      }

      this.socket = makeWASocket({
        version,
        auth: state,
        logger,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        qrTimeout: 60000,
      })

      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
          try {
            this.qrCode = await QRCode.toDataURL(qr)
            this.emit('qr', this.qrCode)
            await WhatsAppInstance.findByIdAndUpdate(this.instance._id, {
              status: 'connecting',
              qrCode: this.qrCode
            })
          } catch (err) {
            console.error('[WA-PDV] Erro ao gerar QR Code:', err.message)
          }
        }

        if (connection === 'close') {
          this.connected = false
          this._initializing = false

          const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut

          if (statusCode === DisconnectReason.loggedOut) {
            this._stopPatrol()
            await WhatsAppInstance.findByIdAndUpdate(this.instance._id, {
              status: 'disconnected',
              qrCode: null
            })
            this.emit('status', 'disconnected')
            if (fs.existsSync(this.sessionPath)) {
              fs.rmSync(this.sessionPath, { recursive: true, force: true })
            }
          } else if (statusCode === 440) {
            this._440count++
            await WhatsAppInstance.findByIdAndUpdate(this.instance._id, { status: 'connecting' })
            this._startPatrol()
          } else if (shouldReconnect && this.retryCount < this.maxRetries) {
            this.retryCount++
            this._440count = 0
            const delay = Math.min(3000 * this.retryCount, 30000)
            await WhatsAppInstance.findByIdAndUpdate(this.instance._id, { status: 'connecting' })
            if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
            this._reconnectTimer = setTimeout(() => {
              this._reconnectTimer = null
              this.initialize().catch(() => {})
            }, delay)
          } else {
            this._440count = 0
            await WhatsAppInstance.findByIdAndUpdate(this.instance._id, {
              status: 'disconnected',
              qrCode: null
            })
            this.emit('status', 'disconnected')
          }
        }

        if (connection === 'open') {
          this.connected = true
          this.qrCode = null
          this._initializing = false
          this._440count = 0
          this.retryCount = 0
          this._stopPatrol()

          console.log(`[WA-PDV] ✅ Instância ${this.instance._id} CONECTADA`)
          await WhatsAppInstance.findByIdAndUpdate(this.instance._id, {
            status: 'connected',
            qrCode: null
          })
          this.emit('status', 'connected')
        }
      })

      this.socket.ev.on('creds.update', saveCreds)

      return true
    } catch (error) {
      this._initializing = false
      console.error('[WA-PDV] Erro ao inicializar:', error.message)
      throw error
    }
  }

  _normalizeNumber(number) {
    if (!number) throw new Error('Número não fornecido')
    // Remove tudo que não é dígito
    let clean = number.replace(/\D/g, '')
    // Se não começa com 55, adiciona o código do Brasil
    if (!clean.startsWith('55')) {
      clean = '55' + clean
    }
    return clean
  }

  _resolveJid(numberOrJid) {
    if (!numberOrJid) throw new Error('Número/JID não fornecido')
    if (numberOrJid.includes('@')) return numberOrJid
    const normalized = this._normalizeNumber(numberOrJid)
    return `${normalized}@s.whatsapp.net`
  }

  async _resolveJidVerified(numberOrJid) {
    if (!numberOrJid) throw new Error('Número/JID não fornecido')
    if (numberOrJid.includes('@')) return numberOrJid

    const phone = this._normalizeNumber(numberOrJid)

    // Verifica no WhatsApp qual JID é válido
    try {
      const [result] = await this.socket.onWhatsApp(phone)
      if (result && result.exists) {
        console.log(`[WA-PDV] Número verificado: ${phone} -> ${result.jid}`)
        return result.jid
      }

      // Números BR com 13 dígitos (55+DD+9+XXXXXXXX) — tenta sem o 9
      if (phone.length === 13 && phone.startsWith('55')) {
        const withoutNine = phone.slice(0, 4) + phone.slice(5)
        const [r2] = await this.socket.onWhatsApp(withoutNine)
        if (r2 && r2.exists) {
          console.log(`[WA-PDV] Número verificado (sem 9): ${withoutNine} -> ${r2.jid}`)
          return r2.jid
        }
      }

      // Números BR com 12 dígitos (55+DD+XXXXXXXX) — tenta com o 9
      if (phone.length === 12 && phone.startsWith('55')) {
        const withNine = phone.slice(0, 4) + '9' + phone.slice(4)
        const [r3] = await this.socket.onWhatsApp(withNine)
        if (r3 && r3.exists) {
          console.log(`[WA-PDV] Número verificado (com 9): ${withNine} -> ${r3.jid}`)
          return r3.jid
        }
      }
    } catch (err) {
      console.warn(`[WA-PDV] Erro ao verificar ${phone}: ${err.message}`)
    }

    // Fallback
    return `${phone}@s.whatsapp.net`
  }

  async sendMessage(numberOrJid, text) {
    if (!this.socket || !this.connected) {
      throw new Error('WhatsApp não está conectado')
    }
    const jid = await this._resolveJidVerified(numberOrJid)
    await this.socket.sendMessage(jid, { text })
    console.log(`[WA-PDV] Mensagem enviada para ${jid}`)
  }

  async disconnect() {
    this._stopPatrol()
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    if (this.socket) {
      try {
        this.socket.ev.removeAllListeners()
        this.socket.end()
      } catch (e) {
        try { this.socket.ws.close() } catch (_) {}
      }
      this.socket = null
    }
    this.connected = false
    this._initializing = false
  }
}

module.exports = WhatsAppService
