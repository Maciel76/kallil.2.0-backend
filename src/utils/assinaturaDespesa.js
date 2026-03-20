const Despesa = require('../models/Despesa')

async function sincronizarDespesaAssinatura(userId, { nomePlano, valorMensal, dataReferencia = new Date() }) {
  const valorNormalizado = Number(Number(valorMensal || 0).toFixed(2))

  return Despesa.findOneAndUpdate(
    { userId, categoria: 'Assinatura', origem: 'assinatura' },
    {
      userId,
      descricao: `Assinatura ${nomePlano} - cobrança mensal`,
      valor: valorNormalizado,
      categoria: 'Assinatura',
      fixa: true,
      origem: 'assinatura',
      recorrencia: 'mensal',
      data: dataReferencia
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }
  )
}

async function removerDespesaAssinatura(userId) {
  await Despesa.deleteMany({ userId, categoria: 'Assinatura', origem: 'assinatura' })
}

module.exports = {
  sincronizarDespesaAssinatura,
  removerDespesaAssinatura
}