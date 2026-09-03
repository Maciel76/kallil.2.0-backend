// Unidades de medida — regras compartilhadas entre venda, cupom e relatórios.
// Unidades "fracionadas" são pesadas/medidas na balança: a quantidade vem em
// decimais (ex: 1,700 kg) em vez de contagem inteira.
const UNIDADES_FRACIONADAS = ['kg', 'g', 'l', 'ml', 'mt']

// Casas decimais usadas para exibir a quantidade de cada unidade
const CASAS_UNIDADE = { kg: 3, l: 3, mt: 2, g: 0, ml: 0 }

const isFracionado = (unidade) =>
  UNIDADES_FRACIONADAS.includes(String(unidade || 'un').toLowerCase())

const casasUnidade = (unidade) => {
  const casas = CASAS_UNIDADE[String(unidade || 'un').toLowerCase()]
  return casas === undefined ? 0 : casas
}

// Arredonda a quantidade conforme a unidade (evita lixo de ponto flutuante)
const arredondarQtd = (qty, unidade) => {
  const fator = Math.pow(10, casasUnidade(unidade))
  return Math.round((Number(qty) || 0) * fator) / fator
}

// Arredonda valores em dinheiro para 2 casas
const arredondarValor = (valor) => Math.round((Number(valor) || 0) * 100) / 100

// "1,700 kg" para fracionados · "3" para unidades inteiras
const formatQtd = (qty, unidade) => {
  const n = Number(qty) || 0
  if (isFracionado(unidade)) {
    const u = String(unidade).toLowerCase()
    return `${n.toFixed(casasUnidade(u)).replace('.', ',')} ${u}`
  }
  return String(Math.round(n))
}

// Prefixo do item em cupons/mensagens: "1,700 kg x" ou "3x"
const formatQtdItem = (qty, unidade) =>
  isFracionado(unidade) ? `${formatQtd(qty, unidade)} x` : `${formatQtd(qty, unidade)}x`

module.exports = {
  UNIDADES_FRACIONADAS,
  isFracionado,
  casasUnidade,
  arredondarQtd,
  arredondarValor,
  formatQtd,
  formatQtdItem
}
