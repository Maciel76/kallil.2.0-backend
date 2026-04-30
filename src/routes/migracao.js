const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const Cliente = require('../models/Cliente')
const Produto = require('../models/Produto')
const Despesa = require('../models/Despesa')
const Venda = require('../models/Venda')
const User = require('../models/User')

router.use(auth)

// Helpers ---------------------------------------------------------------

function n(v) {
  if (v === null || v === undefined || v === '') return 0
  const s = String(v).replace(',', '.').replace(/[^\d.\-]/g, '')
  const x = parseFloat(s)
  return isFinite(x) ? x : 0
}

function dataBR(s) {
  if (!s || typeof s !== 'string') return null
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (!m) return null
  const d = new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`)
  return isNaN(d.getTime()) ? null : d
}

function mapearCategoriaDespesa(obs) {
  if (!obs) return 'Outros'
  const t = String(obs).toUpperCase()
  if (/ALUGU/.test(t)) return 'Aluguel'
  if (/ENERGIA|LUZ/.test(t)) return 'Energia'
  if (/COMPRA|FORNEC|ATACAD|MIX/.test(t)) return 'Fornecedor'
  if (/TRANSPORT|FRETE|GASOL|COMBUST/.test(t)) return 'Transporte'
  if (/MARKET|ANUNC|PUBLIC/.test(t)) return 'Marketing'
  return 'Outros'
}

const UNIDADES_VALIDAS = ['un', 'kg', 'g', 'l', 'ml', 'cx', 'pc', 'mt']
function mapearUnidade(u) {
  if (!u) return 'un'
  const x = String(u).toLowerCase().trim()
  return UNIDADES_VALIDAS.includes(x) ? x : 'un'
}

// POST /api/migracao/preview — apenas retorna totais detectados
router.post('/preview', async (req, res) => {
  try {
    const p = req.body || {}
    if (p.meta && p.meta.origem !== 'kallil-legacy') {
      return res.status(400).json({ message: 'Arquivo não é um pacote válido do Kallil antigo.' })
    }
    res.json({
      ok: true,
      totais: {
        clientes: (p.clientes || []).length,
        produtos: (p.produtos || []).length,
        despesas: (p.despesas || []).length,
        contas_receber: (p.contas_receber || []).length,
        vendas: (p.vendas || []).length,
      },
      negocio: p.negocio ? {
        nome_fantasia: p.negocio.nome_fantasia || '',
        cnpj: p.negocio.cnpj || '',
        cidade: p.negocio.cidade || '',
        estado: p.negocio.estado || ''
      } : null
    })
  } catch (err) {
    console.error('[migracao/preview]', err)
    res.status(500).json({ message: 'Erro ao analisar pacote.' })
  }
})

// POST /api/migracao/importar — importa de fato
// body: { pacote: {...}, opcoes: { negocio:bool, clientes:bool, produtos:bool, despesas:bool, contasReceber:bool, limpar:bool } }
router.post('/importar', async (req, res) => {
  const userId = req.userId
  const pacote = req.body?.pacote || req.body
  const opcoes = req.body?.opcoes || {
    negocio: true, clientes: true, produtos: true, despesas: true, contasReceber: true, limpar: false
  }

  if (!pacote || typeof pacote !== 'object') {
    return res.status(400).json({ message: 'Pacote inválido.' })
  }
  if (pacote.meta && pacote.meta.origem !== 'kallil-legacy') {
    return res.status(400).json({ message: 'Pacote não é do Kallil antigo.' })
  }

  const resumo = {
    negocioAtualizado: false,
    clientes: { criados: 0, atualizados: 0, ignorados: 0 },
    produtos: { criados: 0, atualizados: 0, ignorados: 0 },
    despesas: { criadas: 0, ignoradas: 0 },
    contasReceber: { criadas: 0, ignoradas: 0 },
    erros: []
  }

  try {
    // Limpar dados existentes (opcional)
    if (opcoes.limpar) {
      await Promise.all([
        Cliente.deleteMany({ userId }),
        Produto.deleteMany({ userId }),
        Despesa.deleteMany({ userId }),
        Venda.deleteMany({ userId, status: 'fiado' })
      ])
    }

    // 1) Negócio → atualiza User dono
    if (opcoes.negocio !== false && pacote.negocio) {
      const ng = pacote.negocio
      const update = {}
      if (ng.nome_fantasia) update.nomeNegocio = String(ng.nome_fantasia).trim()
      if (ng.cnpj) update.cnpj = String(ng.cnpj).trim()
      if (ng.endereco) update.endereco = String(ng.endereco).trim()
      if (ng.cidade) update.cidade = String(ng.cidade).trim()
      if (ng.estado) update.estado = String(ng.estado).trim()
      if (ng.telefone) update.telefone = String(ng.telefone).trim()
      if (ng.taxa_prazo) update.taxaPrazo = n(ng.taxa_prazo)
      if (ng.logo) update.logoUrl = String(ng.logo).trim()
      if (Object.keys(update).length > 0) {
        await User.updateOne({ _id: userId }, { $set: update })
        resumo.negocioAtualizado = true
      }
    }

    // Mapa para correlacionar id antigo -> novo _id (clientes)
    const mapaClienteIdAntigo = {}

    // 2) Clientes
    if (opcoes.clientes !== false && Array.isArray(pacote.clientes)) {
      for (const c of pacote.clientes) {
        try {
          const nome = `${c.name || ''} ${c.surname || ''}`.trim()
          if (!nome) { resumo.clientes.ignorados++; continue }

          const filtro = { userId }
          if (c.cpf) filtro.cpf = String(c.cpf).trim()
          else filtro.nome = nome

          let cli = await Cliente.findOne(filtro)
          if (cli) {
            cli.nome = nome
            if (c.telefone) cli.telefone = String(c.telefone).trim()
            if (c.endereco) cli.endereco = String(c.endereco).trim()
            await cli.save()
            resumo.clientes.atualizados++
          } else {
            cli = await Cliente.create({
              userId,
              nome,
              cpf: c.cpf ? String(c.cpf).trim() : '',
              telefone: c.telefone ? String(c.telefone).trim() : '',
              endereco: c.endereco ? String(c.endereco).trim() : ''
            })
            resumo.clientes.criados++
          }
          if (c.id !== undefined) mapaClienteIdAntigo[String(c.id)] = cli._id
        } catch (e) {
          resumo.clientes.ignorados++
          resumo.erros.push(`Cliente: ${e.message}`)
        }
      }
    }

    // 3) Produtos
    if (opcoes.produtos !== false && Array.isArray(pacote.produtos)) {
      // Códigos adicionais agrupados por id antigo do produto
      const codigosAdic = {}
      if (Array.isArray(pacote.codigos_produtos)) {
        for (const cp of pacote.codigos_produtos) {
          const k = String(cp.uid_produto)
          if (!codigosAdic[k]) codigosAdic[k] = []
          if (cp.codigo) codigosAdic[k].push(String(cp.codigo).trim())
        }
      }

      for (const p of pacote.produtos) {
        try {
          const nome = (p.nome || '').toString().trim()
          if (!nome) { resumo.produtos.ignorados++; continue }

          const codigoBarras = p.codigo ? String(p.codigo).trim() : ''
          const filtro = codigoBarras
            ? { userId, codigoBarras }
            : { userId, nome }
          const dadosBase = {
            userId,
            nome,
            codigoBarras,
            codigosAdicionais: codigosAdic[String(p.id)] || [],
            categoria: 'Geral',
            unidade: mapearUnidade(p.unidade),
            precoVenda: n(p.valor_venda),
            precoCusto: n(p.valor_compra),
            estoque: Math.max(0, parseInt(p.quantidade, 10) || 0),
            estoqueMinimo: 5,
            vendasTotal: parseInt(p.vendas, 10) || 0,
            ativo: true
          }

          const exist = await Produto.findOne(filtro)
          if (exist) {
            Object.assign(exist, dadosBase)
            await exist.save()
            resumo.produtos.atualizados++
          } else {
            await Produto.create(dadosBase)
            resumo.produtos.criados++
          }
        } catch (e) {
          resumo.produtos.ignorados++
          resumo.erros.push(`Produto: ${e.message}`)
        }
      }
    }

    // 4) Despesas (bit_custos)
    if (opcoes.despesas !== false && Array.isArray(pacote.despesas)) {
      for (const d of pacote.despesas) {
        try {
          const valor = n(d.valor)
          if (valor <= 0) { resumo.despesas.ignoradas++; continue }
          const dt = dataBR(d.data) || new Date()
          await Despesa.create({
            userId,
            descricao: (d.obs || 'Despesa importada').toString().trim().slice(0, 250),
            valor,
            categoria: mapearCategoriaDespesa(d.obs),
            data: dt,
            origem: 'manual'
          })
          resumo.despesas.criadas++
        } catch (e) {
          resumo.despesas.ignoradas++
          resumo.erros.push(`Despesa: ${e.message}`)
        }
      }
    }

    // 5) Contas a receber (bit_venda_prazo) → Vendas com status fiado
    if (opcoes.contasReceber !== false && Array.isArray(pacote.contas_receber)) {
      for (const cr of pacote.contas_receber) {
        try {
          const valor = n(cr.valor)
          if (valor <= 0) { resumo.contasReceber.ignoradas++; continue }
          const pago = String(cr.status) === '2'
          const clienteIdNovo = mapaClienteIdAntigo[String(cr.uid_cliente)] || null
          const dataVenda = dataBR(cr.data) || new Date()
          const dataVenc  = dataBR(cr.data_vencimento)
          await Venda.create({
            userId,
            itens: [{
              nome: 'Item importado',
              qty: 1,
              precoUnit: valor,
              precoCusto: 0,
              subtotal: valor,
              lucro: n(cr.lucro)
            }],
            total: valor,
            desconto: 0,
            descontoTipo: 'valor',
            totalFinal: valor,
            lucroTotal: n(cr.lucro),
            formaPagamento: 'fiado',
            valorRecebido: 0,
            troco: 0,
            status: pago ? 'pago' : 'fiado',
            clienteId: clienteIdNovo,
            clienteNome: cr.nome_cliente || '',
            valorPago: pago ? valor : 0,
            dataVencimento: dataVenc,
            dataPagamento: pago ? dataVenda : null,
            observacoes: cr.obs || '',
            createdAt: dataVenda,
            updatedAt: dataVenda
          })
          if (!pago && clienteIdNovo) {
            await Cliente.updateOne(
              { _id: clienteIdNovo, userId },
              { $inc: { totalDevido: valor } }
            )
          }
          resumo.contasReceber.criadas++
        } catch (e) {
          resumo.contasReceber.ignoradas++
          resumo.erros.push(`Conta a receber: ${e.message}`)
        }
      }
    }

    res.json({ ok: true, resumo })
  } catch (err) {
    console.error('[migracao/importar]', err)
    res.status(500).json({ ok: false, message: err.message || 'Erro ao importar.' })
  }
})

module.exports = router
