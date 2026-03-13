require('dotenv').config()
const mongoose = require('mongoose')
const Produto = require('./src/models/Produto')
const User = require('./src/models/User')

const produtosSeed = [
  // Lanches
  { nome: 'X-Burger', categoria: 'Lanches', precoVenda: 18.00, precoCusto: 8.50, estoque: 50, estoqueMinimo: 10 },
  { nome: 'X-Salada', categoria: 'Lanches', precoVenda: 20.00, precoCusto: 9.00, estoque: 40, estoqueMinimo: 10 },
  { nome: 'X-Bacon', categoria: 'Lanches', precoVenda: 22.00, precoCusto: 10.50, estoque: 35, estoqueMinimo: 8 },
  { nome: 'X-Tudo', categoria: 'Lanches', precoVenda: 28.00, precoCusto: 14.00, estoque: 30, estoqueMinimo: 5 },
  { nome: 'Hot Dog Simples', categoria: 'Lanches', precoVenda: 10.00, precoCusto: 4.50, estoque: 60, estoqueMinimo: 15 },
  { nome: 'Hot Dog Especial', categoria: 'Lanches', precoVenda: 15.00, precoCusto: 6.50, estoque: 40, estoqueMinimo: 10 },

  // Bebidas
  { nome: 'Coca-Cola Lata', categoria: 'Bebidas', precoVenda: 6.00, precoCusto: 3.20, estoque: 100, estoqueMinimo: 20 },
  { nome: 'Guaraná Lata', categoria: 'Bebidas', precoVenda: 5.50, precoCusto: 2.80, estoque: 80, estoqueMinimo: 20 },
  { nome: 'Suco Natural 500ml', categoria: 'Bebidas', precoVenda: 8.00, precoCusto: 3.00, estoque: 30, estoqueMinimo: 10 },
  { nome: 'Água Mineral 500ml', categoria: 'Bebidas', precoVenda: 3.00, precoCusto: 1.00, estoque: 120, estoqueMinimo: 30 },
  { nome: 'Cerveja Long Neck', categoria: 'Bebidas', precoVenda: 9.00, precoCusto: 4.50, estoque: 60, estoqueMinimo: 15 },
  { nome: 'Energético 250ml', categoria: 'Bebidas', precoVenda: 10.00, precoCusto: 5.50, estoque: 25, estoqueMinimo: 8 },

  // Porções
  { nome: 'Batata Frita', categoria: 'Porções', precoVenda: 16.00, precoCusto: 5.00, estoque: 40, estoqueMinimo: 10 },
  { nome: 'Porção de Frango', categoria: 'Porções', precoVenda: 25.00, precoCusto: 12.00, estoque: 20, estoqueMinimo: 5 },
  { nome: 'Onion Rings', categoria: 'Porções', precoVenda: 18.00, precoCusto: 6.00, estoque: 25, estoqueMinimo: 8 },

  // Doces
  { nome: 'Açaí 300ml', categoria: 'Doces', precoVenda: 14.00, precoCusto: 6.00, estoque: 20, estoqueMinimo: 5 },
  { nome: 'Açaí 500ml', categoria: 'Doces', precoVenda: 20.00, precoCusto: 9.00, estoque: 15, estoqueMinimo: 5 },
  { nome: 'Sorvete Casquinha', categoria: 'Doces', precoVenda: 5.00, precoCusto: 1.80, estoque: 50, estoqueMinimo: 10 },
  { nome: 'Pudim', categoria: 'Doces', precoVenda: 8.00, precoCusto: 3.00, estoque: 10, estoqueMinimo: 3 },

  // Outros
  { nome: 'Marmitex P', categoria: 'Refeições', precoVenda: 15.00, precoCusto: 7.00, estoque: 20, estoqueMinimo: 5 },
  { nome: 'Marmitex G', categoria: 'Refeições', precoVenda: 20.00, precoCusto: 10.00, estoque: 15, estoqueMinimo: 5 },
  { nome: 'Pastel de Carne', categoria: 'Salgados', precoVenda: 7.00, precoCusto: 2.50, estoque: 40, estoqueMinimo: 10 },
  { nome: 'Pastel de Queijo', categoria: 'Salgados', precoVenda: 7.00, precoCusto: 2.50, estoque: 40, estoqueMinimo: 10 },
  { nome: 'Coxinha', categoria: 'Salgados', precoVenda: 6.00, precoCusto: 2.00, estoque: 50, estoqueMinimo: 15 },
  { nome: 'Empada de Frango', categoria: 'Salgados', precoVenda: 6.50, precoCusto: 2.20, estoque: 30, estoqueMinimo: 10 },
]

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log('✅ Conectado ao MongoDB')

    // Criar admin (se não existir)
    let admin = await User.findOne({ email: 'admin@kallil.com' })
    if (!admin) {
      admin = await User.create({
        nome: 'Administrador',
        email: 'admin@kallil.com',
        senha: 'admin123',
        role: 'admin'
      })
      console.log('🔑 Admin criado: admin@kallil.com / admin123')
    } else {
      console.log('🔑 Admin já existe: admin@kallil.com / admin123')
    }

    // Criar usuário de teste / dono (se não existir)
    let user = await User.findOne({ email: 'teste@kallil.com' })
    if (!user) {
      user = await User.create({
        nome: 'Usuário Teste',
        nomeNegocio: 'Lanchonete do Teste',
        email: 'teste@kallil.com',
        senha: '123456',
        role: 'dono'
      })
      console.log('👤 Dono de teste criado: teste@kallil.com / 123456')
    } else {
      console.log('👤 Dono de teste já existe: teste@kallil.com / 123456')
    }

    // Criar operador de teste (se não existir)
    let operador = await User.findOne({ email: 'operador@kallil.com' })
    if (!operador) {
      operador = await User.create({
        nome: 'Operador Teste',
        email: 'operador@kallil.com',
        senha: '123456',
        role: 'operador',
        donoId: user._id
      })
      console.log('🧑‍💼 Operador criado: operador@kallil.com / 123456')
    } else {
      console.log('🧑‍💼 Operador já existe: operador@kallil.com / 123456')
    }

    // Limpar produtos antigos do usuário de teste
    await Produto.deleteMany({ userId: user._id })
    console.log('🗑️  Produtos antigos removidos')

    // Inserir produtos com userId
    const produtosComUser = produtosSeed.map(p => ({ ...p, userId: user._id }))
    await Produto.insertMany(produtosComUser)

    console.log(`📦 ${produtosSeed.length} produtos inseridos com sucesso!`)
    console.log('')
    console.log('=== DADOS DE ACESSO ===')
    console.log('Admin:    admin@kallil.com / admin123')
    console.log('Dono:     teste@kallil.com / 123456')
    console.log('Operador: operador@kallil.com / 123456')
    console.log('=======================')

    await mongoose.disconnect()
    process.exit(0)
  } catch (error) {
    console.error('❌ Erro no seed:', error.message)
    process.exit(1)
  }
}

seed()
