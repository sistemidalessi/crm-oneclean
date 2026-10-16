'use strict';
// Pedido de venda (Fase 3): faixa da tabela, margem, comissão, totais, situação, bolão e últimas compras. Dados fictícios.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../pedidos.js');

test('faixa da tabela PADRAO: o maior degrau que o preço alcança', () => {
  assert.strictEqual(P.faixaDoPreco(1.96, 1.96), 'A');
  assert.strictEqual(P.faixaDoPreco(2.058, 1.96), 'B');          // +5%
  assert.strictEqual(P.faixaDoPreco(2.05, 1.96), 'A');           // ainda não chegou ao B
  assert.strictEqual(P.faixaDoPreco(2.45, 1.96), 'F');           // +25%
  assert.strictEqual(P.faixaDoPreco(573.64, 6.99), 'F');         // bem acima da tabela
  assert.strictEqual(P.faixaDoPreco(1.80, 1.96), 'NEG');         // até −10%
  assert.strictEqual(P.faixaDoPreco(1.70, 1.96), 'ABAIXO');
  assert.strictEqual(P.faixaDoPreco(10, 0), null);               // sem preço de tabela
  assert.strictEqual(P.precoDaFaixa(1.96, 'C'), 2.156);
  assert.strictEqual(P.faixaDoPreco(2.156, 1.96, P.tabelaDe({ tabela_precos: { C: 12 } })), 'B'); // tabela editada
});

test('margem e desconto sobre a tabela, como na grade do FKN', () => {
  assert.strictEqual(P.margem(1.96, 1.505), 23.21);              // print do pedido 36345
  assert.strictEqual(P.margem(573.64, 4.99), 99.13);             // print do orçamento 22544
  assert.strictEqual(P.sobreTabela(573.64, 6.99), 8106.58);
  assert.strictEqual(P.sobreTabela(1.96, 1.96), 0);
  assert.strictEqual(P.margem(10, null), null);
});

test('linha e totais: comissão pelo plano de quem vendeu', () => {
  const plano = P.PLANOS_PADRAO.find(p => p.id === 'externo');
  const it = { quantidade: 325, preco: 1.96, desconto: 0, preco_tab: 1.96, custo: 1.505 };
  const l = P.linha(it, { plano });
  assert.deepStrictEqual([l.total, l.faixa, l.margem, l.comissao, l.valorComissao], [637, 'A', 23.21, 5, 31.85]); // R$ 31,85 como no FKN
  const t = P.totais([it, { quantidade: 2, preco: 10, desconto: 10, preco_tab: null, custo: null }], 15, { plano });
  assert.deepStrictEqual(t, { produtos: 655, frete: 15, geral: 670, margem: 23.21, comissao: 31.85, comissaoPct: 5 });
  const esc = P.linha({ quantidade: 1, preco: 1.70, preco_tab: 1.96 }, { plano: P.PLANOS_PADRAO[0] });
  assert.strictEqual(esc.faixa, 'ABAIXO'); assert.strictEqual(esc.comissao, 2);  // interno: abaixo da tabela A conta 2%
  assert.strictEqual(P.linha({ quantidade: 1, preco: 1.70, preco_tab: 1.96 }, { plano: P.PLANOS_PADRAO[1] }).comissao, 0);
});

test('plano do usuário: configurado ou o primeiro', () => {
  const cfg = { comissao_usuarios: { u2: 'externo' } };
  assert.strictEqual(P.planoDoUsuario(cfg, 'u2').id, 'externo');
  assert.strictEqual(P.planoDoUsuario(cfg, 'u1').id, 'interno');
  assert.strictEqual(P.planoDoUsuario({ comissao_planos: [{ id: 'x', nome: 'X', faixas: {} }] }, 'u1').id, 'x');
});

test('situação como no Sifn050: bloqueado até liberar, e bloqueio novo volta a segurar', () => {
  assert.strictEqual(P.situacao({ situacao: 'aberto', bloqueios: ['ESTOQUE'] }).rotulo, 'BLOQUEADO');
  assert.strictEqual(P.situacao({ situacao: 'aberto', bloqueios: ['ESTOQUE'], liberado: ['ESTOQUE'] }).rotulo, 'LIBERADO');
  assert.deepStrictEqual(P.situacao({ situacao: 'aberto', bloqueios: ['ESTOQUE', 'ATRASO'], liberado: ['ESTOQUE'] }).bloqueios, ['ATRASO']);
  assert.strictEqual(P.situacao({ situacao: 'aberto', bloqueios: [] }).rotulo, 'LIBERADO');
  assert.strictEqual(P.situacao({ situacao: 'separacao', bolao_id: 7583 }).rotulo, 'EM SEPARAÇÃO · SP 7583');
  assert.strictEqual(P.situacao({ situacao: 'separado' }).rotulo, 'A EMITIR NF');
  assert.strictEqual(P.situacao({ situacao: 'faturado' }, 2704).rotulo, 'FATURADO NF 2704');
});

test('bolão: soma por produto, localização primeiro (vazia por último), depois nome', () => {
  const info = new Map([['A1', { localizacao: 'R2' }], ['B1', { localizacao: 'R1' }], ['C1', {}]]);
  const l = P.bolao([
    { numero: 1, itens: [{ codigo: 'A1', descricao: 'Detergente', unidade: 'GL', quantidade: 2 }, { codigo: 'C1', descricao: 'Balde', unidade: 'UN', quantidade: 1 }] },
    { numero: 2, itens: [{ codigo: 'A1', descricao: 'Detergente', unidade: 'GL', quantidade: 3 }, { codigo: 'B1', descricao: 'Pano', unidade: 'PT', quantidade: 4 }, { codigo: 'A1', descricao: 'Detergente cx', unidade: 'CX', quantidade: 1 }] }
  ], info);
  assert.deepStrictEqual(l.map(x => [x.codigo, x.unidade, x.quantidade]), [['B1', 'PT', 4], ['A1', 'GL', 5], ['A1', 'CX', 1], ['C1', 'UN', 1]]);
  assert.deepStrictEqual(l[1].pedidos, [{ numero: 1, quantidade: 2 }, { numero: 2, quantidade: 3 }]);
});

test('últimas compras do cliente: mais recente primeiro, sem as canceladas', () => {
  const notas = [{ id: 'n1', emitida_em: '2026-09-01', numero: 10 }, { id: 'n2', emitida_em: '2026-10-01', numero: 20 }, { id: 'n3', emitida_em: '2026-10-10', numero: 30, cancelada: true }];
  const it = new Map([['n1', [{ codigo: 'A', descricao: 'Det', quantidade: 2, valor_unitario: 5 }, { codigo: 'B', descricao: 'Pano', quantidade: 1, valor_unitario: 3 }]],
    ['n2', [{ codigo: 'A', descricao: 'Det', quantidade: 4, valor_unitario: 5.5 }]], ['n3', [{ codigo: 'Z', descricao: 'X', quantidade: 1, valor_unitario: 1 }]]]);
  const u = P.ultimasCompras(notas, it);
  assert.deepStrictEqual(u.produtos.map(x => [x.codigo, x.quantidade, x.preco, x.nota, x.vezes]), [['A', 4, 5.5, 20, 2], ['B', 1, 3, 10, 1]]);
  assert.deepStrictEqual(u.ultimaNota.map(x => x.codigo), ['A']);
});

test('procurar produto: código do começo ou palavras do nome, com estoque primeiro', () => {
  const l = [{ codigo: '250011', descricao: 'GUARDANAPO NOBBY 21X22', disponivel: 0 }, { codigo: '250019', descricao: 'GUARDANAPO FOLHA DUPLA', disponivel: 22 }, { codigo: '010043', descricao: 'DETERGENTE NEUTRO 5L', disponivel: 3 }];
  assert.deepStrictEqual(P.procura(l, 'guardanapo').map(x => x.codigo), ['250019', '250011']);
  assert.deepStrictEqual(P.procura(l, '250011').map(x => x.codigo), ['250011']);
  assert.deepStrictEqual(P.procura(l, 'neutro det').map(x => x.codigo), ['010043']);
  assert.deepStrictEqual(P.procura(l, '  '), []);
});

test('itens da proposta viram itens do pedido; endereço de entrega do cadastro', () => {
  assert.deepStrictEqual(P.itensDaProposta({ itens: [{ codigo: '620000', descricao: 'ESCADA', unidade: 'UN', quantidade: 2, preco: 573.64, desconto: 0, total: 1147.28 }] }),
    [{ codigo: '620000', descricao: 'ESCADA', unidade: 'UN', quantidade: 2, preco: 573.64, desconto: 0 }]);
  const d = P.entregaDoCliente({ logradouro: 'RUA CANADA', numero: '658', bairro: 'JARDIM AMERICA', cidade: 'SAO PAULO', uf: 'SP', cep: '01436-000' });
  assert.strictEqual(P.entregaTexto(d), 'RUA CANADA, 658 · JARDIM AMERICA · SAO PAULO/SP · CEP 01436-000');
});

test('margem mínima de 23%: abaixo dela o item avisa (e o pedido bloqueia no banco)', () => {
  assert.strictEqual(P.linha({ quantidade: 1, preco: 1.96, preco_tab: 1.96, custo: 1.505 }).abaixoMinimo, false);  // 23,21%
  assert.strictEqual(P.linha({ quantidade: 1, preco: 1.94, preco_tab: 1.96, custo: 1.505 }).abaixoMinimo, true);   // 22,42%
  assert.strictEqual(P.linha({ quantidade: 1, preco: 1.94, preco_tab: 1.96, custo: 1.505 }, { margemMinima: 20 }).abaixoMinimo, false);
  assert.strictEqual(P.linha({ quantidade: 1, preco: 0, preco_tab: 1.96, custo: 1.505 }).abaixoMinimo, true);      // brinde sem preço
  assert.strictEqual(P.linha({ quantidade: 1, preco: 5, preco_tab: 1.96, custo: null }).abaixoMinimo, false);       // sem custo: não sabe
  assert.strictEqual(P.margemMinima({ margem_minima: 25 }), 25);
  assert.strictEqual(P.margemMinima({}), 23);
});
