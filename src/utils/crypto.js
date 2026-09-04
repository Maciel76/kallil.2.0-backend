const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

/**
 * Criptografia das credenciais do lojista (Access Token do Mercado Pago).
 *
 * O token dá acesso de cobrança à conta do cliente: ele nunca pode ficar
 * legível no banco. Aqui ele é guardado com AES-256-GCM (cifra + selo de
 * autenticidade), e só é aberto na hora de falar com o Mercado Pago.
 */

const ALGO = 'aes-256-gcm'
const IV_LEN = 12 // 96 bits — recomendado para GCM
const KEY_FILE = path.join(__dirname, '..', '..', '.encryption-key')

let chaveEmCache = null

/**
 * Resolve a chave AES-256-GCM.
 *
 * 1) MP_ENCRYPTION_KEY do .env (32 bytes em hex = 64 caracteres) — recomendado
 * 2) arquivo .encryption-key, gerado automaticamente na primeira execução
 *
 * A chave NUNCA pode ser aleatória por processo: se ela mudar a cada reinício,
 * todos os tokens já gravados viram lixo e o lojista precisa reconfigurar o
 * Mercado Pago sem entender o motivo. Por isso o fallback é gravado em disco.
 */
function getKey() {
  if (chaveEmCache) return chaveEmCache

  const hex = process.env.MP_ENCRYPTION_KEY
  if (hex && /^[0-9a-f]{64}$/i.test(hex)) {
    chaveEmCache = Buffer.from(hex, 'hex')
    return chaveEmCache
  }
  if (hex) {
    console.error(
      '[CRYPTO] MP_ENCRYPTION_KEY definida mas inválida (precisa ter 64 caracteres hex). ' +
      'Usando o arquivo de chave local — corrija o .env.'
    )
  }

  try {
    if (fs.existsSync(KEY_FILE)) {
      const doArquivo = fs.readFileSync(KEY_FILE, 'utf8').trim()
      if (/^[0-9a-f]{64}$/i.test(doArquivo)) {
        chaveEmCache = Buffer.from(doArquivo, 'hex')
        return chaveEmCache
      }
      console.error(
        `[CRYPTO] ${KEY_FILE} está corrompido — gerando uma chave nova. ` +
        'Credenciais salvas antes disso precisarão ser reinformadas.'
      )
    }
  } catch (err) {
    console.error(`[CRYPTO] Falha ao ler ${KEY_FILE}: ${err.message}`)
  }

  const gerada = crypto.randomBytes(32)
  try {
    fs.writeFileSync(KEY_FILE, gerada.toString('hex'), { mode: 0o600 })
    console.warn(
      '[CRYPTO] MP_ENCRYPTION_KEY não definida — chave gerada e salva em backend/.encryption-key. ' +
      'Para produção, copie o valor desse arquivo para MP_ENCRYPTION_KEY no .env.'
    )
  } catch (err) {
    console.error(
      `[CRYPTO] NÃO foi possível persistir a chave (${err.message}). ` +
      'Ela vale só para este processo: as credenciais do Mercado Pago serão perdidas ' +
      'no próximo reinício. Defina MP_ENCRYPTION_KEY no .env.'
    )
  }
  chaveEmCache = gerada
  return chaveEmCache
}

/** Detecta se uma string já está no formato cifrado (iv:tag:conteudo). */
function pareceCifrado(valor) {
  if (typeof valor !== 'string') return false
  const partes = valor.split(':')
  if (partes.length !== 3) return false
  return partes.every((p) => /^[0-9a-f]+$/i.test(p) && p.length >= 8)
}

/**
 * Cifra um texto. Retorna `<iv-hex>:<tag-hex>:<conteudo-hex>`.
 * Se já vier cifrado, devolve como está (evita cifrar duas vezes).
 */
function encryptToken(texto) {
  if (texto == null || texto === '') return ''
  if (pareceCifrado(String(texto))) return String(texto)

  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const cifrado = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${cifrado.toString('hex')}`
}

/**
 * Decifra um valor produzido por encryptToken().
 * Texto plano legado (gravado antes desta camada existir) volta como está.
 * Falha de decifragem devolve '' — o chamador trata como "credencial quebrada".
 */
function decryptToken(valor) {
  if (valor == null || valor === '') return ''
  if (!pareceCifrado(String(valor))) return String(valor)

  try {
    const [ivHex, tagHex, dadosHex] = String(valor).split(':')
    const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([
      decipher.update(Buffer.from(dadosHex, 'hex')),
      decipher.final()
    ]).toString('utf8')
  } catch (err) {
    console.warn('[CRYPTO] Falha ao decifrar token do Mercado Pago:', err.message)
    return ''
  }
}

/**
 * O valor guardado ainda abre com a chave atual?
 * Separa "nunca configurou" de "configurou e a chave mudou" — situações que
 * pedem mensagens diferentes na tela.
 */
function podeDecifrar(valor) {
  if (!valor) return false
  if (!pareceCifrado(String(valor))) return true
  return decryptToken(valor) !== ''
}

/** Mascara o token para exibição: "APP_USR-••••••••••abc123". */
function maskToken(texto) {
  if (!texto) return ''
  const str = String(texto)
  if (str.length <= 14) return '••••••••'
  return `${str.slice(0, 8)}${'•'.repeat(10)}${str.slice(-6)}`
}

module.exports = {
  encryptToken,
  decryptToken,
  maskToken,
  pareceCifrado,
  podeDecifrar,
  getKey,
  KEY_FILE
}
