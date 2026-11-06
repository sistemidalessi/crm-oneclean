'use strict';
// Tela Produtos (20/10/2026): o cadastro como no FKN — pesquisa por código, descrição ou código de barras, atalhos,
// fornecedor, selos e a navegação anterior/próximo. E o aviso de preço abaixo da tabela A para quem não vê a margem.
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../produtos.js');
const P = require('../pedidos.js');

const disp = [
  { codigo: '280025', descricao: 'LUVA TOP VERDE TAMANHO P SANRO', unidade: 'UN', linha: 'BLACK FRIDAY', fisico: 668, disponivel: 668, reservado: 0, a_caminho: 0, preco_venda: 9.24, custo: 7.11 },
  { codigo: '150034', descricao: 'COPO 180 ML BRANCO KEROCOPO C/100', unidade: 'PT', linha: 'COPOS', fisico: 1343, disponivel: 1343, reservado: 0, preco_venda: 4.36, custo: null },
  { codigo: '150034.1', descricao: 'COPO 180 ML BRANCO KEROCOPO C/100 CX', unidade: 'CX', linha: 'COPOS', disponivel: 53, preco_venda: 108.92, fator: 25, base: '150034' },
  { codigo: '370045', descricao: 'SACO P/ LIXO 100 LTS EMBALAC', unidade: 'PT', linha: 'SACOS P/ LIXO', fisico: 100, disponivel: 100, preco_venda: 49.7 },
  { codigo: '030045', descricao: 'ALCOOL 46 GEL 500 GR ADATA', unidade: 'FR', linha: 'VENCIDOS', situacao: 'INATIVO', disponivel: 0, preco_venda: 48.79 }
];
const ex = {
  eans: [{ codigo: '150034', ean: '17898918330360' }, { codigo: '150034.1', ean: '17898918330360' }],
  estoque: [{ codigo: '370045', estoque_min: 125, fornecedor_cod: '88', fornecedor: 'EMBALAC INDUSTRIA' }, { codigo: '280025', estoque_min: 0, fornecedor_cod: '12', fornecedor: 'FABRICA SAO ROQUE' }],
  forn: [{ codigo: '150034', fornecedor: '40' }], fornecedores: [{ codigo: '40', nome: 'KEROCOPO' }, { codigo: '12', nome: 'SÃO ROQUE (SANRO)' }],
  fiscal: [{ codigo: '280025', ncm: '40151900', gtin: '7896243100897' }]
};
const lista = () => X.cadastro(X.catalogo({ disp }), ex);

test('cadastro: fornecedor do FKN ou trocado no CRM, códigos de barras e NCM', () => {
  const l = lista(), luva = l.find(x => x.codigo === '280025'), copo = l.find(x => x.codigo === '150034'), saco = l.find(x => x.codigo === '370045');
  assert.equal(l.length, 4); // a caixa ".1" fica junto da unidade
  assert.deepEqual(luva.forn, { cod: '12', nome: 'SÃO ROQUE (SANRO)', trocado: false });
  assert.deepEqual(copo.forn, { cod: '40', nome: 'KEROCOPO', trocado: true });
  assert.equal(saco.forn.nome, 'EMBALAC INDUSTRIA');
  assert.deepEqual(luva.eans, ['7896243100897']);
  assert.deepEqual(copo.eans, ['17898918330360']);
  assert.equal(luva.ncm, '40151900');
  assert.equal(saco.ncm, null);
  assert.equal(copo.caixa.fator, 25);
  // sem o fiscal (quem não é administrador), o NCM fica "não sei", não "sem NCM"
  assert.equal(X.cadastro(X.catalogo({ disp }), {}).find(x => x.codigo === '370045').fiscal, undefined);
});

test('pesquisa: palavras em qualquer ordem, código de barras inteiro, código exato primeiro e A–Z', () => {
  const l = lista();
  assert.deepEqual(X.pesquisa(l, { busca: 'verde luva' }).map(x => x.codigo), ['280025']);
  assert.deepEqual(X.pesquisa(l, { busca: '17898918330360' }).map(x => x.codigo), ['150034']);
  assert.deepEqual(X.pesquisa(l, {}).map(x => x.codigo), ['150034', '280025', '370045']); // inativo fora, A–Z
  assert.deepEqual(X.pesquisa(l, { atalho: 'inativos' }).map(x => x.codigo), ['030045']);
  assert.deepEqual(X.pesquisa(l, { forn: '__sem' }).map(x => x.codigo), []);
  assert.deepEqual(X.pesquisa(l, { forn: '40' }).map(x => x.codigo), ['150034']);
  assert.deepEqual(X.pesquisa(l, { atalho: 'minimo' }).map(x => x.codigo), ['370045']);
  assert.deepEqual(X.pesquisa(l, { ordem: 'codigo' }).map(x => x.codigo), ['150034', '280025', '370045']);
  // menor margem primeiro; sem custo vai para o fim
  assert.deepEqual(X.pesquisa(l, { ordem: 'margem' }).map(x => x.codigo)[0], '280025');
});

test('atalhos e selos: os de cadastro só para quem cuida dele; NCM só para o administrador', () => {
  const l = lista();
  assert.deepEqual(X.atalhos(l, {}).map(a => a.id), ['todos', 'estoque', 'falta', 'vendidos']);
  const adm = X.atalhos(l, { cuida: true, fiscal: true });
  assert.equal(adm.find(a => a.id === 'semncm').n, 2);
  assert.equal(adm.find(a => a.id === 'minimo').n, 1);
  assert.equal(adm.find(a => a.id === 'inativos').n, 1);
  const saco = l.find(x => x.codigo === '370045');
  assert.deepEqual(X.selosDe(saco, {}), []);
  assert.deepEqual(X.selosDe(saco, { cuida: true, fiscal: true }).map(s => s[0]), ['no mínimo', 'sem NCM', 'sem foto']);
});

test('vizinhos, embalagens e margem', () => {
  const l = X.pesquisa(lista(), {});
  assert.equal(X.vizinhos(l, '280025').ant.codigo, '150034');
  assert.equal(X.vizinhos(l, '280025').prox.codigo, '370045');
  assert.equal(X.vizinhos(l, '150034').ant, null);
  assert.equal(X.vizinhos(l, 'xx').pos, 0);
  const copo = l.find(x => x.codigo === '150034');
  assert.deepEqual(X.embalagens(copo, [{ unidade: 'FD', fator: 50, origem: 'nota' }]).map(e => e.unidade + ':' + e.fator), ['PT:1', 'CX:25', 'FD:50']);
  assert.equal(X.margemDe(9.24, 7.11), 23.1);
  assert.equal(X.margemDe(9.24, null), null);
});

test('abaixoDaTabela: o sinal para a vendedora (que não vê a margem)', () => {
  const tab = { tabela: P.TABELA_PADRAO };
  assert.equal(P.abaixoDaTabela(P.linha({ quantidade: 1, preco: 9.24, preco_tab: 9.24 }, tab)), false);
  assert.equal(P.abaixoDaTabela(P.linha({ quantidade: 1, preco: 9.0, preco_tab: 9.24 }, tab)), true);
  assert.equal(P.abaixoDaTabela(P.linha({ quantidade: 1, preco: 8.0, preco_tab: 9.24 }, tab)), true);
  assert.equal(P.abaixoDaTabela(P.linha({ quantidade: 1, preco: 8.0 }, tab)), false); // sem preço de tabela: não diz
});

// 06/11/2026 (Wellington): o comprador acha o inativo (com ou sem estoque) para reativar; a vendedora continua sem ver
test('inativos para quem cuida do cadastro: entram pelo cadastro e aparecem em "Todos" e na pesquisa', () => {
  const est = [{ codigo: '130021', descricao: 'CABO 1,80MT MADEIRA C/ ROSCA', unidade: 'UN', situacao: 'INATIVO', estoque_atual: 0, preco_venda: 9.5, custo_unit: 4 },
    { codigo: '150094.1', descricao: 'COPO CX', situacao: 'INATIVO' }, { codigo: '030045', situacao: 'INATIVO' }, { codigo: '370045', situacao: 'ATIVO' }];
  const fora = X.inativosFora(disp, est);
  assert.deepEqual(fora.map(x => x.codigo), ['130021']); // a caixa e o que já veio no disponível ficam de fora
  assert.equal(fora[0].disponivel, 0);
  const l = X.cadastro(X.catalogo({ disp: disp.concat(fora) }), ex);
  assert.deepEqual(X.pesquisa(l, {}).map(x => x.codigo), ['150034', '280025', '370045']); // vendedora: só ativos
  assert.deepEqual(X.pesquisa(l, { comInativos: true }).map(x => x.codigo), ['030045', '130021', '150034', '280025', '370045']);
  assert.deepEqual(X.pesquisa(l, { busca: 'cabo', comInativos: true }).map(x => x.codigo), ['130021']);
  assert.deepEqual(X.pesquisa(l, { atalho: 'falta', comInativos: true }).map(x => x.codigo), []); // atalhos de trabalho seguem só com ativos
  const n = Object.fromEntries(X.atalhos(l, { cuida: true }).map(a => [a.id, a.n]));
  assert.equal(n.todos, 5); assert.equal(n.inativos, 2);
  assert.equal(Object.fromEntries(X.atalhos(l, {}).map(a => [a.id, a.n])).todos, 3);
});

test('aba Compras: por fornecedor, o mais em conta pelo último custo (06/11/2026, Wellington)', () => {
  const l = [
    { fornecedor_doc: '1', fornecedor_nome: 'DESTRO', emitida_em: '2026-10-20T10:00:00Z', custo_un: 6.7625, qtd: 12 },
    { fornecedor_doc: '1', fornecedor_nome: 'DESTRO', emitida_em: '2026-09-02T10:00:00Z', custo_un: 6.62, qtd: 12 },
    { fornecedor_doc: '2', fornecedor_nome: 'SEVERINI', emitida_em: '2026-10-31T10:00:00Z', custo_un: 8.575, qtd: 36 },
    { fornecedor_doc: '3', fornecedor_nome: 'WMS', emitida_em: '2026-10-27T10:00:00Z', custo_un: null, qtd: 5 }
  ];
  const g = X.comprasPorFornecedor(l);
  assert.equal(g.length, 2);                        // sem custo não entra
  assert.equal(g[0].nome, 'DESTRO');
  assert.equal(g[0].maisEmConta, true);
  assert.equal(g[0].ultimoCusto, 6.7625);           // o último, não o menor
  assert.equal(g[0].menorCusto, 6.62);
  assert.equal(g[0].vezes, 2);
  assert.equal(g[0].qtd, 24);
  assert.equal(g[1].acimaPct, 26.8);
  assert.equal(X.comprasPorFornecedor(l.slice(0, 1))[0].maisEmConta, undefined); // um fornecedor só: sem selo
});

test('aba Pedidos de venda: só os que ainda vão sair, com a quantidade do estoque e a falta (06/11/2026)', () => {
  const peds = [
    { id: 'a', numero: 98, situacao: 'aberto', criado_em: '2026-11-06T10:00:00Z', itens: [{ base: '010079', codigo: '010079', qtd_est: 4, quantidade: 4, fator: 1, unidade: 'FR' }] },
    { id: 'b', numero: 90, situacao: 'separacao', criado_em: '2026-11-05T10:00:00Z', itens: [{ base: '010095', qtd_est: 2 }, { base: '010079', codigo: '010079.1', quantidade: 1, fator: 12, qtd_est: 12, unidade: 'CX' }] },
    { id: 'c', numero: 80, situacao: 'faturado', criado_em: '2026-11-04T10:00:00Z', itens: [{ base: '010079', qtd_est: 9 }] },
    { id: 'd', numero: 70, situacao: 'cancelado', criado_em: '2026-11-03T10:00:00Z', itens: [{ base: '010079', qtd_est: 9 }] }
  ];
  const l = X.pedidosDoProduto(peds, '010079', [{ pedido_id: 'b', idx: 1, base: '010079', falta: 0.5 }]);
  assert.deepEqual(l.map(z => z.pedido.numero), [90, 98]);   // o mais antigo primeiro
  assert.equal(l[0].qtd, 12);
  assert.equal(l[0].falta, 6);                                // 0,5 caixa × 12
  assert.equal(l[1].qtd, 4);
  assert.equal(l[1].falta, 0);
  assert.deepEqual(X.pedidosDoProduto(peds, '999999', []), []);
});
