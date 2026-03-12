const express = require("express");
const router = express.Router();
const Venda = require("../models/Venda");
const User = require("../models/User");
const auth = require("../middleware/auth");

router.use(auth);

// GET /api/cupom/:vendaId — gerar HTML do cupom para impressão térmica 80mm
router.get("/:vendaId", async (req, res) => {
  try {
    const venda = await Venda.findOne({
      _id: req.params.vendaId,
      userId: req.userId,
    });
    if (!venda)
      return res.status(404).json({ message: "Venda não encontrada." });

    const user = await User.findById(req.userId);

    const dataVenda = new Date(venda.createdAt).toLocaleString("pt-BR");
    const numCupom = venda._id.toString().slice(-6).toUpperCase();

    const labelPagamento = {
      dinheiro: "Dinheiro",
      pix: "PIX",
      debito: "Cartão Débito",
      credito: "Cartão Crédito",
      fiado: "Fiado/Prazo",
    };

    let itensHTML = "";
    for (const item of venda.itens) {
      itensHTML += `
        <tr>
          <td style="text-align:left;font-size:20px">${item.nome}</td>
          <td style="text-align:center;font-size:20px">${item.qty}</td>
          <td style="text-align:right;font-size:20px">${item.precoUnit.toFixed(2)}</td>
          <td style="text-align:right;font-size:20px">${item.subtotal.toFixed(2)}</td>
        </tr>`;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @page {
      size: 80mm auto;
      margin: 0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 22px;
      line-height: 1.4;
      width: 100%;
      max-width: 80mm;
      padding: 4mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 8px 0; }
    .empresa { font-size: 26px; font-weight: bold; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 3px 0; font-size: 20px; }
    .total-row td { font-size: 24px; font-weight: bold; padding-top: 6px; }
    .info { font-size: 18px; color: #333; }
    .row { display: flex; justify-content: space-between; font-size: 20px; padding: 2px 0; }
    .row-total { display: flex; justify-content: space-between; font-size: 28px; font-weight: bold; margin: 6px 0; }
    .rodape { font-size: 18px; color: #333; margin-top: 10px; }
    .logo-cupom { max-width: 50mm; max-height: 30mm; margin: 0 auto 6px auto; display: block; object-fit: contain; }

    @media print {
      body { width: 80mm; max-width: 80mm; }
      .logo-cupom { max-width: 50mm; max-height: 30mm; }
    }
  </style>
</head>
<body>
  <div class="center">
    ${user.logoUrl ? `<img src="${user.logoUrl}" alt="Logo" class="logo-cupom" />` : ""}
    <div class="empresa">${user.nomeNegocio || "Meu Negócio"}</div>
    ${user.cnpj ? `<div class="info">CNPJ: ${user.cnpj}</div>` : ""}
    ${user.endereco ? `<div class="info">${user.endereco}</div>` : ""}
    ${user.cidade ? `<div class="info">${user.cidade}${user.estado ? " - " + user.estado : ""}</div>` : ""}
  </div>

  <div class="divider"></div>
  <div class="center bold" style="font-size:22px">CUPOM NÃO FISCAL</div>
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

  ${
    venda.desconto > 0
      ? `
  <div class="row">
    <span>Subtotal:</span><span>R$ ${venda.total.toFixed(2)}</span>
  </div>
  <div class="row">
    <span>Desconto:</span><span>-R$ ${venda.desconto.toFixed(2)}</span>
  </div>`
      : ""
  }

  <div class="row-total">
    <span>TOTAL:</span><span>R$ ${venda.totalFinal.toFixed(2)}</span>
  </div>

  <div class="divider"></div>

  <div class="row">
    <span>Pagamento:</span><span>${labelPagamento[venda.formaPagamento] || venda.formaPagamento}</span>
  </div>
  ${
    venda.formaPagamento === "dinheiro" && venda.valorRecebido > 0
      ? `
  <div class="row">
    <span>Recebido:</span><span>R$ ${venda.valorRecebido.toFixed(2)}</span>
  </div>
  <div class="row">
    <span>Troco:</span><span>R$ ${venda.troco.toFixed(2)}</span>
  </div>`
      : ""
  }
  ${
    venda.clienteNome
      ? `
  <div class="row">
    <span>Cliente:</span><span>${venda.clienteNome}</span>
  </div>`
      : ""
  }

  <div class="divider"></div>
  <div class="center rodape">
    Obrigado pela preferência!<br>
    Kallil 2.0 — Sistema de Vendas
  </div>

  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    res.json({ html, numCupom });
  } catch (error) {
    res.status(500).json({ message: "Erro ao gerar cupom." });
  }
});

module.exports = router;
