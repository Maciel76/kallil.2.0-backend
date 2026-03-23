const express = require('express')
const router = express.Router()
const Cliente = require('../models/Cliente')
const Venda = require('../models/Venda')
const PagamentoDivida = require('../models/PagamentoDivida')
const User = require('../models/User')
const auth = require('../middleware/auth')
const { verificarAssinatura, verificarLimite } = require('../middleware/assinatura')

router.use(auth)
router.use(verificarAssinatura)

// GET /api/clientes
router.get('/', async (req, res) => {
  try {
    const { busca, comDivida } = req.query
    const filtro = { userId: req.userId }

    if (busca) {
      filtro.$or = [
        { nome: { $regex: busca, $options: 'i' } },
        { telefone: { $regex: busca, $options: 'i' } },
        { cpf: { $regex: busca, $options: 'i' } }
      ]
    }
    if (comDivida === 'true') filtro.totalDevido = { $gt: 0 }

    const clientes = await Cliente.find(filtro).sort({ nome: 1 })
    res.json(clientes)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar clientes.' })
  }
})

// GET /api/clientes/buscar-cpf/:cpf — buscar cliente por CPF
router.get('/buscar-cpf/:cpf', async (req, res) => {
  try {
    const cpfLimpo = req.params.cpf.replace(/\D/g, '')
    if (!cpfLimpo) return res.status(400).json({ message: 'CPF inválido.' })

    const cliente = await Cliente.findOne({ userId: req.userId, cpf: cpfLimpo })
    if (!cliente) return res.status(404).json({ message: 'Cliente não encontrado.' })

    // Buscar dívidas abertas (vendas fiado não pagas)
    const dividas = await Venda.find({
      userId: req.userId,
      clienteId: cliente._id,
      status: 'fiado'
    }).sort({ createdAt: -1 })

    res.json({ cliente, dividas })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar cliente por CPF.' })
  }
})

// POST /api/clientes
router.post('/', verificarLimite('clientes'), async (req, res) => {
  try {
    const { nome, cpf, telefone, endereco } = req.body
    if (!nome) return res.status(400).json({ message: 'Nome é obrigatório.' })

    // Se CPF fornecido, verificar duplicidade
    if (cpf) {
      const cpfLimpo = cpf.replace(/\D/g, '')
      const existente = await Cliente.findOne({ userId: req.userId, cpf: cpfLimpo })
      if (existente) return res.status(400).json({ message: 'Já existe um cliente com este CPF.' })
    }

    const cliente = await Cliente.create({
      userId: req.userId,
      nome,
      cpf: cpf ? cpf.replace(/\D/g, '') : '',
      telefone,
      endereco
    })
    res.status(201).json(cliente)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar cliente.' })
  }
})

// PUT /api/clientes/:id
router.put('/:id', async (req, res) => {
  try {
    const { nome, cpf, telefone, endereco } = req.body
    const update = { nome, telefone, endereco }

    if (cpf !== undefined) {
      const cpfLimpo = cpf ? cpf.replace(/\D/g, '') : ''
      if (cpfLimpo) {
        const existente = await Cliente.findOne({ userId: req.userId, cpf: cpfLimpo, _id: { $ne: req.params.id } })
        if (existente) return res.status(400).json({ message: 'Já existe um cliente com este CPF.' })
      }
      update.cpf = cpfLimpo
    }

    const cliente = await Cliente.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      update,
      { new: true, runValidators: true }
    )
    if (!cliente) return res.status(404).json({ message: 'Cliente não encontrado.' })
    res.json(cliente)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar cliente.' })
  }
})

// PUT /api/clientes/:id/pagar — pagar dívidas específicas
router.put('/:id/pagar', async (req, res) => {
  try {
    const { valor, vendaIds, formaPagamento } = req.body
    const cliente = await Cliente.findOne({ _id: req.params.id, userId: req.userId })
    if (!cliente) return res.status(404).json({ message: 'Cliente não encontrado.' })

    const dividaAnterior = cliente.totalDevido
    let valorPago = 0
    const vendasPagas = []

    if (vendaIds && vendaIds.length > 0) {
      // Pagamento por vendas específicas (PDV / Receber Dívida)
      const vendas = await Venda.find({
        _id: { $in: vendaIds },
        userId: req.userId,
        clienteId: cliente._id,
        status: 'fiado'
      })

      for (const venda of vendas) {
        const restanteVenda = venda.totalFinal - (venda.valorPago || 0)
        venda.valorPago = venda.totalFinal
        venda.status = 'pago'
        venda.dataPagamento = new Date()
        venda.formaPagamentoRecebimento = formaPagamento || 'dinheiro'
        await venda.save()
        valorPago += restanteVenda
        vendasPagas.push(venda._id)
      }
    } else {
      // Pagamento genérico (Clientes panel) — abate das vendas mais antigas
      valorPago = Math.min(valor || cliente.totalDevido, cliente.totalDevido)
      let restante = valorPago

      const vendasFiado = await Venda.find({
        userId: req.userId,
        clienteId: cliente._id,
        status: 'fiado'
      }).sort({ createdAt: 1 })

      for (const venda of vendasFiado) {
        if (restante <= 0) break
        const restanteVenda = venda.totalFinal - (venda.valorPago || 0)
        if (restante >= restanteVenda) {
          // Quita essa venda inteira
          venda.valorPago = venda.totalFinal
          venda.status = 'pago'
          venda.dataPagamento = new Date()
          venda.formaPagamentoRecebimento = formaPagamento || 'dinheiro'
          await venda.save()
          restante -= restanteVenda
          vendasPagas.push(venda._id)
        } else {
          // Pagamento parcial nessa venda
          venda.valorPago = (venda.valorPago || 0) + restante
          await venda.save()
          restante = 0
        }
      }
    }

    cliente.totalDevido = Math.max(0, cliente.totalDevido - valorPago)
    await cliente.save()

    // Buscar nome do operador/usuário
    let operadorNome = ''
    try {
      const userReal = await User.findById(req.userRealId).select('nome nomeFantasia')
      operadorNome = userReal?.nome || userReal?.nomeFantasia || ''
    } catch {}

    // Registrar histórico de pagamento
    await PagamentoDivida.create({
      userId: req.userId,
      clienteId: cliente._id,
      vendaIds: vendasPagas,
      valor: valorPago,
      formaPagamento: formaPagamento || 'dinheiro',
      operadorId: req.userRealId,
      operadorNome,
      dividaAnterior,
      dividaRestante: cliente.totalDevido,
      tipo: cliente.totalDevido === 0 ? 'quitacao' : 'parcial'
    })

    res.json(cliente)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao registrar pagamento.' })
  }
})

// GET /api/clientes/:id/vendas — vendas fiado do cliente
router.get('/:id/vendas', async (req, res) => {
  try {
    const vendas = await Venda.find({
      userId: req.userId,
      clienteId: req.params.id,
      status: 'fiado'
    }).sort({ createdAt: -1 })
    res.json(vendas)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar vendas do cliente.' })
  }
})

// GET /api/clientes/:id/historico — todo histórico de compras e pagamentos
router.get('/:id/historico', async (req, res) => {
  try {
    const vendas = await Venda.find({
      userId: req.userId,
      clienteId: req.params.id,
      status: { $ne: 'espera' }
    }).sort({ createdAt: -1 }).limit(50).lean()

    const pagamentos = await PagamentoDivida.find({
      userId: req.userId,
      clienteId: req.params.id
    }).sort({ createdAt: -1 }).limit(50).lean()

    // Marcar tipo para o frontend distinguir
    const vendasMarcadas = vendas.map(v => ({ ...v, _tipo: 'venda' }))
    const pagamentosMarcados = pagamentos.map(p => ({ ...p, _tipo: 'pagamento' }))

    // Mesclar e ordenar por data (mais recente primeiro)
    const historico = [...vendasMarcadas, ...pagamentosMarcados]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    res.json(historico)
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar histórico.' })
  }
})

// DELETE /api/clientes/:id
router.delete('/:id', async (req, res) => {
  try {
    const cliente = await Cliente.findOne({ _id: req.params.id, userId: req.userId })
    if (!cliente) return res.status(404).json({ message: 'Cliente não encontrado.' })
    if (cliente.totalDevido > 0) {
      return res.status(400).json({ message: 'Não é possível remover cliente com dívida pendente.' })
    }
    await Cliente.findByIdAndDelete(req.params.id)
    res.json({ message: 'Cliente removido com sucesso.' })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover cliente.' })
  }
})

module.exports = router
