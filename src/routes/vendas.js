const express = require('express')
const router = express.Router()
const Venda = require('../models/Venda')
const Produto = require('../models/Produto')
const Cliente = require('../models/Cliente')
const crypto = require('crypto')
const auth = require('../middleware/auth')
const { verificarAssinatura, verificarLimite } = require('../middleware/assinatura')
const { isFracionado, arredondarQtd, arredondarValor } = require('../utils/unidades')

router.use(auth)
router.use(verificarAssinatura)

// POST /api/vendas — finalizar venda
router.post('/', verificarLimite('vendas'), async (req, res) => {
  try {
    const { itens, desconto = 0, descontoTipo = 'valor', formaPagamento, clienteId, clienteNome, clienteCpf, valorRecebido = 0, dataVencimento, observacoes, caixaId, pagamentos } = req.body

    if (!itens || itens.length === 0) {
      return res.status(400).json({ message: 'A venda deve ter ao menos um item.' })
    }

    // Validar fiado: CPF e data de vencimento obrigatórios
    if (formaPagamento === 'fiado') {
      if (!clienteId) return res.status(400).json({ message: 'Cliente é obrigatório para venda fiado.' })
      if (!dataVencimento) return res.status(400).json({ message: 'Data de vencimento é obrigatória para venda fiado.' })
    }

    // Calcular totais e dar baixa no estoque
    let total = 0
    let lucroTotal = 0
    const itensProcessados = []

    for (const item of itens) {
      const produto = await Produto.findOne({ _id: item.produtoId, userId: req.userId })
      if (!produto) return res.status(404).json({ message: `Produto ${item.produtoId} não encontrado.` })

      // Quantidade: decimal para produtos fracionados (kg, g, l...), inteira para os demais
      const qty = arredondarQtd(item.qty, produto.unidade)
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ message: `Quantidade inválida para o produto ${produto.nome}.` })
      }
      if (!isFracionado(produto.unidade) && !Number.isInteger(qty)) {
        return res.status(400).json({ message: `O produto ${produto.nome} é vendido por unidade e não aceita quantidade fracionada.` })
      }

      const subtotal = arredondarValor(produto.precoVenda * qty)
      const lucro = arredondarValor((produto.precoVenda - produto.precoCusto) * qty)
      total += subtotal
      lucroTotal += lucro

      itensProcessados.push({
        produtoId: produto._id,
        nome: produto.nome,
        qty,
        unidade: produto.unidade || 'un',
        precoUnit: produto.precoVenda,
        precoCusto: produto.precoCusto,
        subtotal,
        lucro
      })

      // Baixar estoque e incrementar vendas (pipeline mantém a operação atômica
      // e arredonda o resultado, evitando 98.30000000000001 em produtos por kg)
      await Produto.updateOne({ _id: produto._id }, [
        {
          $set: {
            estoque: { $round: [{ $subtract: [{ $ifNull: ['$estoque', 0] }, qty] }, 3] },
            vendasTotal: { $round: [{ $add: [{ $ifNull: ['$vendasTotal', 0] }, qty] }, 3] }
          }
        }
      ])
    }

    total = arredondarValor(total)
    lucroTotal = arredondarValor(lucroTotal)

    // Calcular desconto
    let descontoValor = desconto
    if (descontoTipo === 'percentual') {
      descontoValor = total * (desconto / 100)
    }
    descontoValor = arredondarValor(descontoValor)

    const totalFinal = arredondarValor(Math.max(0, total - descontoValor))

    // Pagamento dividido: soma precisa fechar com o total da venda
    const pagamentosValidos = Array.isArray(pagamentos)
      ? pagamentos
          .filter(p => p && p.forma && Number(p.valor) > 0)
          .map(p => ({
            forma: p.forma,
            valor: arredondarValor(Number(p.valor)),
            valorRecebido: arredondarValor(Number(p.valorRecebido) || 0),
            troco: arredondarValor(Number(p.troco) || 0)
          }))
      : []

    if (pagamentosValidos.length > 0) {
      const somaPagamentos = arredondarValor(
        pagamentosValidos.reduce((acc, p) => acc + p.valor, 0)
      )
      if (Math.abs(somaPagamentos - totalFinal) > 0.01) {
        return res.status(400).json({
          message: `A soma dos pagamentos (R$ ${somaPagamentos.toFixed(2)}) não confere com o total da venda (R$ ${totalFinal.toFixed(2)}).`
        })
      }
    }

    // Troco e valor recebido consolidados (só o dinheiro gera troco)
    const trocoDividido = pagamentosValidos
      .filter(p => p.forma === 'dinheiro')
      .reduce((acc, p) => acc + p.troco, 0)
    const recebidoDividido = pagamentosValidos
      .filter(p => p.forma === 'dinheiro')
      .reduce((acc, p) => acc + (p.valorRecebido || p.valor), 0)

    const troco = pagamentosValidos.length > 0
      ? arredondarValor(trocoDividido)
      : (formaPagamento === 'dinheiro' ? Math.max(0, valorRecebido - totalFinal) : 0)
    const recebidoFinal = pagamentosValidos.length > 0
      ? arredondarValor(recebidoDividido)
      : valorRecebido

    const status = formaPagamento === 'fiado' ? 'fiado' : 'pago'

    // Ajustar lucro com desconto
    lucroTotal = arredondarValor(Math.max(0, lucroTotal - descontoValor))

    const venda = await Venda.create({
      userId: req.userId,
      itens: itensProcessados,
      total,
      desconto: descontoValor,
      descontoTipo,
      totalFinal,
      lucroTotal,
      formaPagamento,
      valorRecebido: recebidoFinal,
      troco,
      pagamentos: pagamentosValidos,
      status,
      clienteId: clienteId || null,
      clienteNome: clienteNome || '',
      clienteCpf: clienteCpf || '',
      dataVencimento: formaPagamento === 'fiado' && dataVencimento ? new Date(dataVencimento) : null,
      observacoes: observacoes || '',
      caixaId: caixaId || null
    })

    // Atualizar dívida do cliente se fiado
    if (status === 'fiado' && clienteId) {
      await Cliente.findByIdAndUpdate(clienteId, {
        $inc: { totalDevido: totalFinal }
      })
    }

    // Disparar automações de WhatsApp do dono (sem bloquear o fluxo)
    try {
      const notifier = require('../services/automacaoNotifier')
      if (status === 'fiado') {
        notifier.enviarCobrancaFiado(req.userId, venda).catch(() => {})
      } else {
        notifier.enviarAgradecimentoVenda(req.userId, venda).catch(() => {})
      }
    } catch (e) {
      /* notificações não bloqueiam venda */
    }

    res.status(201).json(venda)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao registrar venda.' })
  }
})

// POST /api/vendas/espera — colocar venda em espera
router.post('/espera', async (req, res) => {
  try {
    const { itens, desconto = 0, descontoTipo = 'valor', clienteNome, caixaId } = req.body

    if (!itens || itens.length === 0) {
      return res.status(400).json({ message: 'A venda deve ter ao menos um item.' })
    }

    let total = 0
    const itensProcessados = []

    for (const item of itens) {
      const produto = await Produto.findOne({ _id: item.produtoId, userId: req.userId })
      if (!produto) continue

      const qty = arredondarQtd(item.qty, produto.unidade)
      if (!Number.isFinite(qty) || qty <= 0) continue

      const subtotal = arredondarValor(produto.precoVenda * qty)
      total += subtotal

      itensProcessados.push({
        produtoId: produto._id,
        nome: produto.nome,
        qty,
        unidade: produto.unidade || 'un',
        precoUnit: produto.precoVenda,
        precoCusto: produto.precoCusto,
        subtotal,
        lucro: arredondarValor((produto.precoVenda - produto.precoCusto) * qty)
      })
    }

    total = arredondarValor(total)

    let descontoValor = desconto
    if (descontoTipo === 'percentual') {
      descontoValor = total * (desconto / 100)
    }
    descontoValor = arredondarValor(descontoValor)
    const totalFinal = arredondarValor(Math.max(0, total - descontoValor))

    const venda = await Venda.create({
      userId: req.userId,
      itens: itensProcessados,
      total,
      desconto: descontoValor,
      descontoTipo,
      totalFinal,
      lucroTotal: 0,
      formaPagamento: 'dinheiro',
      status: 'espera',
      clienteNome: clienteNome || '',
      hashEspera: crypto.randomBytes(8).toString('hex'),
      caixaId: caixaId || null
    })

    res.status(201).json(venda)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao colocar venda em espera.' })
  }
})

// GET /api/vendas/espera — listar vendas em espera
router.get('/espera', async (req, res) => {
  try {
    const vendas = await Venda.find({
      userId: req.userId,
      status: 'espera'
    }).sort({ createdAt: -1 })
    res.json(vendas)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar vendas em espera.' })
  }
})

// DELETE /api/vendas/espera/:id — remover venda em espera
router.delete('/espera/:id', async (req, res) => {
  try {
    await Venda.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId,
      status: 'espera'
    })
    res.json({ message: 'Venda em espera removida.' })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover venda em espera.' })
  }
})

// GET /api/vendas
router.get('/', async (req, res) => {
  try {
    const { inicio, fim, formaPagamento, status } = req.query
    const filtro = { userId: req.userId, status: { $ne: 'espera' } }

    if (inicio || fim) {
      filtro.createdAt = {}
      if (inicio) filtro.createdAt.$gte = new Date(inicio)
      if (fim) filtro.createdAt.$lte = new Date(fim + 'T23:59:59')
    }

    if (formaPagamento) filtro.formaPagamento = formaPagamento
    if (status) filtro.status = status

    const vendas = await Venda.find(filtro).sort({ createdAt: -1 }).limit(100)
    res.json(vendas)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar vendas.' })
  }
})

// GET /api/vendas/:id
router.get('/:id', async (req, res) => {
  try {
    const venda = await Venda.findOne({ _id: req.params.id, userId: req.userId })
    if (!venda) return res.status(404).json({ message: 'Venda não encontrada.' })
    res.json(venda)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar venda.' })
  }
})

// DELETE /api/vendas/:id — cancelar venda
// Não apaga o registro (evita burlar o histórico): só marca status='cancelado',
// devolve o estoque baixado, desfaz a dívida em aberto do cliente (se fiado) e
// para de contar essa venda em relatórios, caixa e produtos mais vendidos —
// que já filtram por status em outras rotas.
router.delete('/:id', async (req, res) => {
  try {
    const motivo = (req.body?.motivo || '').trim().slice(0, 300)
    const venda = await Venda.findOne({ _id: req.params.id, userId: req.userId })
    if (!venda) return res.status(404).json({ message: 'Venda não encontrada.' })

    if (venda.status === 'cancelado') {
      return res.status(400).json({ message: 'Esta venda já está cancelada.' })
    }
    if (venda.status === 'espera') {
      return res.status(400).json({ message: 'Venda em espera não pode ser cancelada por aqui — remova-a da lista de espera.' })
    }

    // Devolver o estoque e desfazer a contagem de "vendasTotal" de cada item
    for (const item of venda.itens) {
      const produto = await Produto.findOne({ _id: item.produtoId, userId: req.userId })
      if (!produto) continue
      await Produto.updateOne({ _id: produto._id }, [
        {
          $set: {
            estoque: { $round: [{ $add: [{ $ifNull: ['$estoque', 0] }, item.qty] }, 3] },
            vendasTotal: { $round: [{ $max: [0, { $subtract: [{ $ifNull: ['$vendasTotal', 0] }, item.qty] }] }, 3] }
          }
        }
      ])
    }

    // Reverter a parte ainda em aberto da dívida do cliente (fiado não quitado)
    if (venda.status === 'fiado' && venda.clienteId) {
      const restante = arredondarValor(venda.totalFinal - (venda.valorPago || 0))
      if (restante > 0) {
        await Cliente.updateOne({ _id: venda.clienteId }, [
          { $set: { totalDevido: { $max: [0, { $subtract: [{ $ifNull: ['$totalDevido', 0] }, restante] }] } } }
        ])
      }
    }

    venda.status = 'cancelado'
    venda.canceladoEm = new Date()
    venda.motivoCancelamento = motivo
    await venda.save()

    res.json({ message: 'Venda cancelada com sucesso.', venda })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao cancelar venda.' })
  }
})

module.exports = router
