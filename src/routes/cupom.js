const express = require("express");
const router = express.Router();
const Venda = require("../models/Venda");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { formatQtd } = require("../utils/unidades");

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

    // Telefones da loja: mostra os dois separados por " / " quando houver
    const telefonesLoja = [user.telefoneLoja1, user.telefoneLoja2]
      .filter((t) => t && t.trim())
      .join(" / ");

    let itensHTML = "";
    for (const item of venda.itens) {
      itensHTML += `
        <tr>
          <td class="item-nome">${item.nome}</td>
          <td class="item-quantidade">${formatQtd(item.qty, item.unidade)}</td>
          <td class="item-valor">${item.precoUnit.toFixed(2)}</td>
          <td class="item-valor">${item.subtotal.toFixed(2)}</td>
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
      font-size: 11px;
      line-height: 1.25;
      width: 100%;
      max-width: 80mm;
      padding: 3mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 5px 0; }
    .empresa { font-size: 15px; line-height: 1.15; font-weight: bold; margin-bottom: 3px; }
    .info { font-size: 9px; line-height: 1.25; font-weight: 700; color: #000; overflow-wrap: anywhere; }
    .titulo-cupom { font-size: 12px; line-height: 1.2; }
    .itens { width: 100%; table-layout: fixed; border-collapse: collapse; }
    .itens td { padding: 2px 0; font-size: 10px; line-height: 1.2; vertical-align: top; }
    .itens .cabecalho td { font-size: 9px; font-weight: bold; padding-bottom: 3px; border-bottom: 1px solid #000; }
    .itens .item-nome { width: 47%; padding-right: 4px; text-align: left; overflow-wrap: anywhere; font-size: 11px; font-weight: 700; color: #000; }
    .itens .item-quantidade { width: 13%; text-align: center; white-space: nowrap; font-weight: 700; color: #000; }
    .itens .item-valor { width: 20%; text-align: right; white-space: nowrap; font-weight: 700; color: #000; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 6px; font-size: 10px; line-height: 1.25; font-weight: 700; color: #000; padding: 1px 0; }
    .row span:last-child { text-align: right; white-space: nowrap; }
    .section-title { font-size: 9px; font-weight: 700; color: #000; margin-bottom: 2px; }
    .row-total { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 6px; font-size: 15px; line-height: 1.2; font-weight: bold; margin: 5px 0; }
    .row-total span:last-child { text-align: right; white-space: nowrap; }
    .rodape { font-size: 9px; line-height: 1.25; font-weight: 700; color: #000; margin-top: 7px; }
    .logo-cupom { max-width: 42mm; max-height: 18mm; margin: 0 auto 5px auto; display: block; object-fit: contain; }
    tr { page-break-inside: avoid; }

    @media print {
      body { width: 80mm; max-width: 80mm; }
      .logo-cupom { max-width: 42mm; max-height: 18mm; }
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
    ${telefonesLoja ? `<div class="info">Tel: ${telefonesLoja}</div>` : ""}
  </div>

  <div class="divider"></div>
  <div class="center bold titulo-cupom">CUPOM NÃO FISCAL</div>
  <div class="center info">Nº ${numCupom} · ${dataVenda}</div>
  <div class="divider"></div>

  <table class="itens">
    <colgroup>
      <col style="width:47%">
      <col style="width:13%">
      <col style="width:20%">
      <col style="width:20%">
    </colgroup>
    <tr class="cabecalho">
      <td style="text-align:left">Item</td>
      <td style="text-align:center">Qtd</td>
      <td style="text-align:right">Unit</td>
      <td style="text-align:right">Total</td>
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
  <div class="section-title">PAGAMENTO</div>

  ${
    venda.pagamentos && venda.pagamentos.length > 0
      ? venda.pagamentos
          .map(
            (p) => `
  <div class="row">
    <span>${labelPagamento[p.forma] || p.forma}:</span><span>R$ ${p.valor.toFixed(2)}</span>
  </div>`,
          )
          .join("")
      : `
  <div class="row">
    <span>Pagamento:</span><span>${labelPagamento[venda.formaPagamento] || venda.formaPagamento}</span>
  </div>`
  }
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
