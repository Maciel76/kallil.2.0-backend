const express = require('express')
const router = express.Router()
const Venda = require('../models/Venda')
const User = require('../models/User')
const auth = require('../middleware/auth')

router.use(auth)

// GET /api/cupom/:vendaId — gerar HTML do cupom para impressão térmica 80mm
router.get('/:vendaId', async (req, res) => {
  try {
    const venda = await Venda.findOne({ _id: req.params.vendaId, userId: req.userId })
    if (!venda) return res.status(404).json({ message: 'Venda não encontrada.' })

    const user = await User.findById(req.userId)

    const dataVenda = new Date(venda.createdAt).toLocaleString('pt-BR')
    const numCupom = venda._id.toString().slice(-6).toUpperCase()

    const labelPagamento = {
      dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Cartão Débito',
      credito: 'Cartão Crédito', fiado: 'Fiado/Prazo'
    }

    let itensHTML = ''
    for (const item of venda.itens) {
      itensHTML += `
        <tr>
          <td style="text-align:left">${item.nome}</td>
          <td style="text-align:center">${item.qty}</td>
          <td style="text-align:right">${item.precoUnit.toFixed(2)}</td>
          <td style="text-align:right">${item.subtotal.toFixed(2)}</td>
        </tr>`
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', monospace; font-size: 12px; width: 80mm; padding: 4mm; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .empresa { font-size: 14px; font-weight: bold; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 2px 0; font-size: 11px; }
    .total-row td { font-size: 13px; font-weight: bold; padding-top: 4px; }
    .info { font-size: 10px; color: #333; }
  </style>
</head>
<body>
  <div class="center">
    <div class="empresa">${user.nomeNegocio || 'Meu Negócio'}</div>
    ${user.cnpj ? `<div class="info">CNPJ: ${user.cnpj}</div>` : ''}
    ${user.endereco ? `<div class="info">${user.endereco}</div>` : ''}
    ${user.cidade ? `<div class="info">${user.cidade}${user.estado ? ' - ' + user.estado : ''}</div>` : ''}
  </div>

  <div class="divider"></div>
  <div class="center bold">CUPOM NÃO FISCAL</div>
  <div class="center info">Nº ${numCupom} · ${dataVenda}</div>
  <div class="divider"></div>

  <table>
    <tr style="font-weight:bold; border-bottom:1px solid #000">
      <td style="text-align:left">Item</td>
      <td style="text-align:center">Qtd</td>
      <td style="text-align:right">Unit</td>
      <td style="text-align:right">Sub</td>
    </tr>
    ${itensHTML}
  </table>

  <div class="divider"></div>

  ${venda.desconto > 0 ? `
  <div style="display:flex; justify-content:space-between">
    <span>Subtotal:</span><span>R$ ${venda.total.toFixed(2)}</span>
  </div>
  <div style="display:flex; justify-content:space-between">
    <span>Desconto:</span><span>-R$ ${venda.desconto.toFixed(2)}</span>
  </div>` : ''}

  <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:bold; margin:4px 0">
    <span>TOTAL:</span><span>R$ ${venda.totalFinal.toFixed(2)}</span>
  </div>

  <div class="divider"></div>

  <div style="display:flex; justify-content:space-between">
    <span>Pagamento:</span><span>${labelPagamento[venda.formaPagamento] || venda.formaPagamento}</span>
  </div>
  ${venda.formaPagamento === 'dinheiro' && venda.valorRecebido > 0 ? `
  <div style="display:flex; justify-content:space-between">
    <span>Recebido:</span><span>R$ ${venda.valorRecebido.toFixed(2)}</span>
  </div>
  <div style="display:flex; justify-content:space-between">
    <span>Troco:</span><span>R$ ${venda.troco.toFixed(2)}</span>
  </div>` : ''}
  ${venda.clienteNome ? `
  <div style="display:flex; justify-content:space-between">
    <span>Cliente:</span><span>${venda.clienteNome}</span>
  </div>` : ''}

  <div class="divider"></div>
  <div class="center info" style="margin-top:8px">
    Obrigado pela preferência!<br>
    Kallil 2.0 — Sistema de Vendas
  </div>

  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`

    res.json({ html, numCupom })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar cupom.' })
  }
})

module.exports = router
