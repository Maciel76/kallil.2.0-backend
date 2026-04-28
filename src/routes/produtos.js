const express = require("express");
const router = express.Router();
const Produto = require("../models/Produto");
const User = require("../models/User");
const PlanoConfig = require("../models/PlanoConfig");
const auth = require("../middleware/auth");
const {
  verificarAssinatura,
  verificarLimite,
} = require("../middleware/assinatura");

// Todas as rotas exigem autenticação
router.use(auth);
router.use(verificarAssinatura);

// GET /api/produtos — Listar produtos com filtros
router.get("/", async (req, res) => {
  try {
    const { categoria, busca, ativo, estoqueBaixo } = req.query;
    const filtro = { userId: req.userId };

    if (ativo !== undefined) filtro.ativo = ativo === "true";
    else filtro.ativo = true;

    if (categoria) filtro.categoria = categoria;
    if (busca) {
      filtro.$or = [
        { nome: { $regex: busca, $options: "i" } },
        { codigoBarras: { $regex: busca, $options: "i" } },
        { codigosAdicionais: { $regex: busca, $options: "i" } },
      ];
    }

    let produtos = await Produto.find(filtro).sort({ nome: 1 });

    // Filtrar apenas estoque baixo
    if (estoqueBaixo === "true") {
      produtos = produtos.filter((p) => p.estoque <= p.estoqueMinimo);
    }

    res.json(produtos);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar produtos." });
  }
});

// GET /api/produtos/estatisticas — Resumo de estoque e produtos
router.get("/estatisticas", async (req, res) => {
  try {
    const filtro = { userId: req.userId, ativo: true };
    const produtos = await Produto.find(filtro);

    const totalProdutos = produtos.length;
    const totalEstoque = produtos.reduce((acc, p) => acc + p.estoque, 0);
    const valorEstoque = produtos.reduce(
      (acc, p) => acc + p.estoque * p.precoCusto,
      0,
    );
    const valorEstoqueVenda = produtos.reduce(
      (acc, p) => acc + p.estoque * p.precoVenda,
      0,
    );
    const estoqueBaixo = produtos.filter(
      (p) => p.estoque <= p.estoqueMinimo,
    ).length;
    const semEstoque = produtos.filter((p) => p.estoque === 0).length;
    const lucroEstimado = valorEstoqueVenda - valorEstoque;

    res.json({
      totalProdutos,
      totalEstoque,
      valorEstoque,
      valorEstoqueVenda,
      estoqueBaixo,
      semEstoque,
      lucroEstimado,
    });
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar estatísticas." });
  }
});

// GET /api/produtos/barcode/:codigo — Buscar por código de barras
router.get("/barcode/:codigo", async (req, res) => {
  try {
    const codigo = req.params.codigo;
    const produto = await Produto.findOne({
      userId: req.userId,
      ativo: true,
      $or: [{ codigoBarras: codigo }, { codigosAdicionais: codigo }],
    });

    if (!produto)
      return res.status(404).json({ message: "Produto não encontrado." });
    res.json(produto);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar produto." });
  }
});

// GET /api/produtos/categorias — Listar categorias únicas
router.get("/categorias", async (req, res) => {
  try {
    const categorias = await Produto.distinct("categoria", {
      userId: req.userId,
      ativo: true,
    });
    res.json(categorias.sort());
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar categorias." });
  }
});

// POST /api/produtos — Criar produto
router.post("/", verificarLimite("produtos"), async (req, res) => {
  try {
    const {
      nome,
      codigoBarras,
      codigosAdicionais,
      categoria,
      unidade,
      precoVenda,
      precoCusto,
      estoque,
      estoqueMinimo,
    } = req.body;

    if (!nome || precoVenda === undefined) {
      return res
        .status(400)
        .json({ message: "Nome e preço de venda são obrigatórios." });
    }

    // Verificar código de barras duplicado (se fornecido)
    if (codigoBarras) {
      const existente = await Produto.findOne({
        userId: req.userId,
        codigoBarras,
        ativo: true,
      });
      if (existente) {
        return res
          .status(400)
          .json({ message: "Já existe um produto com este código de barras." });

        // Verificar duplicatas nos códigos adicionais
        const todosOsCodigos = [
          codigoBarras,
          ...(codigosAdicionais || []),
        ].filter(Boolean);
        for (const cod of todosOsCodigos) {
          const existente = await Produto.findOne({
            userId: req.userId,
            ativo: true,
            $or: [{ codigoBarras: cod }, { codigosAdicionais: cod }],
          });
          if (existente) {
            return res
              .status(400)
              .json({ message: `Já existe um produto com o código "${cod}".` });
          }
        }
      }
    }

    const produto = await Produto.create({
      userId: req.userId,
      nome,
      codigoBarras,
      codigosAdicionais: codigosAdicionais || [],
      categoria,
      unidade,
      precoVenda,
      precoCusto,
      estoque,
      estoqueMinimo,
    });

    res.status(201).json(produto);
  } catch (error) {
    res.status(500).json({ message: "Erro ao criar produto." });
  }
});

// POST /api/produtos/importar — Importação em massa
// Body: { produtos: [{ nome, codigoBarras, quantidade, precoVenda?, precoCusto?, categoria?, unidade?, estoqueMinimo?, descricao?, linha? }] }
router.post("/importar", async (req, res) => {
  try {
    const lista = Array.isArray(req.body?.produtos) ? req.body.produtos : [];
    if (lista.length === 0) {
      return res
        .status(400)
        .json({ message: "Nenhum produto enviado para importação." });
    }
    if (lista.length > 2000) {
      return res
        .status(400)
        .json({ message: "Importação limitada a 2000 produtos por arquivo." });
    }

    // Verificar limite do plano (similar ao verificarLimite, porém em lote)
    const user = await User.findById(req.userId);
    if (user && user.role !== "admin" && req.planoAtual !== "pago") {
      const config = await PlanoConfig.getConfig();
      const max = config?.gratuito?.maxProdutos || 0;
      if (max > 0) {
        const atual = await Produto.countDocuments({
          userId: req.userId,
          ativo: true,
        });
        const disponivel = max - atual;
        if (disponivel <= 0) {
          return res.status(403).json({
            message: `Limite do plano gratuito atingido (${max} produtos). Faça upgrade para importar mais.`,
            limiteAtingido: true,
            atual,
            limite: max,
          });
        }
        if (lista.length > disponivel) {
          return res.status(403).json({
            message: `Seu plano permite cadastrar mais ${disponivel} produto(s), mas o arquivo tem ${lista.length}.`,
            limiteAtingido: true,
            atual,
            limite: max,
            disponivel,
          });
        }
      }
    }

    const erros = [];
    const criados = [];

    // Mapa de códigos do arquivo para detectar duplicatas internas
    const codigosNoArquivo = new Set();

    for (let i = 0; i < lista.length; i++) {
      const item = lista[i] || {};
      const linha = item.linha || i + 2; // header é linha 1

      const nome = String(item.nome || "").trim();
      const codigoBarras = String(item.codigoBarras || "").trim();
      const quantidadeRaw = item.quantidade;
      const quantidade = Number(quantidadeRaw);

      // Validações obrigatórias
      if (!nome) {
        erros.push({
          linha,
          codigo: codigoBarras,
          mensagem: "Nome do produto é obrigatório.",
        });
        continue;
      }
      if (!codigoBarras) {
        erros.push({
          linha,
          codigo: codigoBarras,
          mensagem: "Código é obrigatório.",
        });
        continue;
      }
      if (
        quantidadeRaw === undefined ||
        quantidadeRaw === null ||
        quantidadeRaw === "" ||
        isNaN(quantidade) ||
        quantidade < 0
      ) {
        erros.push({
          linha,
          codigo: codigoBarras,
          mensagem: "Quantidade inválida (precisa ser um número >= 0).",
        });
        continue;
      }

      // Duplicata dentro do próprio arquivo
      if (codigosNoArquivo.has(codigoBarras)) {
        erros.push({
          linha,
          codigo: codigoBarras,
          mensagem: "Código duplicado dentro do arquivo.",
        });
        continue;
      }

      // Já existe no banco?
      const existente = await Produto.findOne({
        userId: req.userId,
        ativo: true,
        $or: [{ codigoBarras }, { codigosAdicionais: codigoBarras }],
      });
      if (existente) {
        erros.push({
          linha,
          codigo: codigoBarras,
          mensagem: `Já existe um produto cadastrado com o código "${codigoBarras}".`,
        });
        continue;
      }

      // Campos opcionais
      const precoVenda = Number(item.precoVenda);
      const precoCusto = Number(item.precoCusto);
      const estoqueMinimo = Number(item.estoqueMinimo);
      const unidadesValidas = ["un", "kg", "g", "l", "ml", "cx", "pc", "mt"];
      const unidade = unidadesValidas.includes(item.unidade)
        ? item.unidade
        : "un";

      try {
        const novo = await Produto.create({
          userId: req.userId,
          nome,
          codigoBarras,
          codigosAdicionais: [],
          categoria:
            (item.categoria && String(item.categoria).trim()) || "Geral",
          unidade,
          precoVenda: isNaN(precoVenda) ? 0 : Math.max(0, precoVenda),
          precoCusto: isNaN(precoCusto) ? 0 : Math.max(0, precoCusto),
          estoque: quantidade,
          estoqueMinimo: isNaN(estoqueMinimo) ? 5 : Math.max(0, estoqueMinimo),
        });
        codigosNoArquivo.add(codigoBarras);
        criados.push(novo);
      } catch (err) {
        erros.push({
          linha,
          codigo: codigoBarras,
          mensagem: err?.message || "Erro ao salvar produto.",
        });
      }
    }

    res.status(200).json({
      totalEnviado: lista.length,
      totalCriados: criados.length,
      totalErros: erros.length,
      criados,
      erros,
    });
  } catch (error) {
    res.status(500).json({ message: "Erro ao importar produtos." });
  }
});

// PUT /api/produtos/:id — Atualizar produto
router.put("/:id", async (req, res) => {
  try {
    // Verificar duplicatas em todos os códigos (principal + adicionais)
    const codigos = [
      req.body.codigoBarras,
      ...(req.body.codigosAdicionais || []),
    ].filter(Boolean);
    for (const cod of codigos) {
      const existente = await Produto.findOne({
        userId: req.userId,
        ativo: true,
        _id: { $ne: req.params.id },
        $or: [{ codigoBarras: cod }, { codigosAdicionais: cod }],
      });
      if (existente) {
        return res
          .status(400)
          .json({ message: `Já existe um produto com o código "${cod}".` });
      }
    }

    const produto = await Produto.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      req.body,
      { new: true, runValidators: true },
    );

    if (!produto)
      return res.status(404).json({ message: "Produto não encontrado." });
    res.json(produto);
  } catch (error) {
    res.status(500).json({ message: "Erro ao atualizar produto." });
  }
});

// PATCH /api/produtos/:id/estoque — Ajustar estoque (entrada/saída)
router.patch("/:id/estoque", async (req, res) => {
  try {
    const { quantidade, tipo } = req.body; // tipo: 'entrada' ou 'saida'

    if (!quantidade || quantidade <= 0) {
      return res.status(400).json({ message: "Quantidade inválida." });
    }

    const produto = await Produto.findOne({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!produto)
      return res.status(404).json({ message: "Produto não encontrado." });

    if (tipo === "entrada") {
      produto.estoque += quantidade;
    } else if (tipo === "saida") {
      if (produto.estoque < quantidade) {
        return res.status(400).json({ message: "Estoque insuficiente." });
      }
      produto.estoque -= quantidade;
    } else {
      return res
        .status(400)
        .json({ message: 'Tipo deve ser "entrada" ou "saida".' });
    }

    await produto.save();
    res.json(produto);
  } catch (error) {
    res.status(500).json({ message: "Erro ao ajustar estoque." });
  }
});

// DELETE /api/produtos/:id — Soft delete
router.delete("/:id", async (req, res) => {
  try {
    const produto = await Produto.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { ativo: false },
      { new: true },
    );

    if (!produto)
      return res.status(404).json({ message: "Produto não encontrado." });
    res.json({ message: "Produto removido com sucesso." });
  } catch (error) {
    res.status(500).json({ message: "Erro ao remover produto." });
  }
});

module.exports = router;
