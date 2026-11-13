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
  assert.deepStrictEqual(t, { produtos: 655, frete: 15, geral: 670, margem: 23.21, abaixoMinimo: false, comissao: 31.85, comissaoPct: 5 });
  const esc = P.linha({ quantidade: 1, preco: 1.70, preco_tab: 1.96 }, { plano: P.PLANOS_PADRAO[0] });
  assert.strictEqual(esc.faixa, 'ABAIXO'); assert.strictEqual(esc.comissao, null);  // interno (03/11/2026): o % é do pedido, pela margem
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
  // arredondamento da tabela (04/11/2026): custo 1,773 → mínimo exato 2,3026; a tabela A de 2,30 dá 22,91% e não é "abaixo"
  assert.strictEqual(P.linha({ quantidade: 1, preco: 2.30, preco_tab: 2.30, custo: 1.773 }).abaixoMinimo, false);
  assert.strictEqual(P.linha({ quantidade: 1, preco: 2.29, preco_tab: 2.30, custo: 1.773 }).abaixoMinimo, true);
  assert.strictEqual(P.totais([{ quantidade: 10, preco: 2.30, custo: 1.773 }, { quantidade: 4, preco: 0.51, custo: 0.395 }]).abaixoMinimo, false);
  assert.strictEqual(P.totais([{ quantidade: 10, preco: 2.25, custo: 1.773 }]).abaixoMinimo, true);
  assert.strictEqual(P.margemMinima({ margem_minima: 25 }), 25);
  assert.strictEqual(P.margemMinima({}), 23);
});

test('plano: administrador sem plano e "nenhum" não ganham comissão', () => {
  assert.strictEqual(P.planoDoUsuario({}, 'adm', 'admin'), null);
  assert.strictEqual(P.planoDoUsuario({ comissao_usuarios: { adm: 'interno' } }, 'adm', 'admin').id, 'interno');
  assert.strictEqual(P.planoDoUsuario({ comissao_usuarios: { v: 'nenhum' } }, 'v', 'vendedor'), null);
});

test('apuração do mês: faixa do item pela tabela, plano de quem vendeu, só itens de venda, canceladas fora', () => {
  const notas = [
    { id: 'n1', numero: 10, emitida_em: '2026-09-05T13:00:00Z', vendedor_id: 'int', cliente_nome: 'A' },
    { id: 'n2', numero: 11, emitida_em: '2026-09-06T13:00:00Z', vendedor_id: 'ext', cliente_nome: 'B' },
    { id: 'n3', numero: 12, emitida_em: '2026-09-07T13:00:00Z', vendedor_id: 'int', cancelada: true },
    { id: 'n4', numero: 13, emitida_em: '2026-10-01T13:00:00Z', vendedor_id: 'int' },
    { id: 'n5', numero: 14, emitida_em: '2026-09-08T13:00:00Z', vendedor_id: 'adm' }];
  const itens = new Map([
    ['n1', [{ codigo: 'P1', unidade: 'PT', valor_unitario: 1.96, valor_total: 196, cfop: '5102' },      // A
            { codigo: 'P1', unidade: 'CX', valor_unitario: 100, valor_total: 100, cfop: '5405' },        // caixa a 100 sobre 94,08 → B
            { codigo: 'XX', unidade: 'UN', valor_unitario: 10, valor_total: 10, cfop: '5102' },          // sem tabela → A
            { codigo: 'P1', unidade: 'PT', valor_unitario: 1.96, valor_total: 50, cfop: '5910' }]],      // bonificação: fora
    ['n2', [{ codigo: 'P1', unidade: 'PT', valor_unitario: 2.45, valor_total: 245, cfop: '5102' }]],      // F
    ['n3', [{ codigo: 'P1', unidade: 'PT', valor_unitario: 1.96, valor_total: 999, cfop: '5102' }]],
    ['n4', [{ codigo: 'P1', unidade: 'PT', valor_unitario: 1.96, valor_total: 999, cfop: '5102' }]],
    ['n5', [{ codigo: 'P1', unidade: 'PT', valor_unitario: 1.96, valor_total: 999, cfop: '5102' }]]]);
  const r = P.apuraComissao({ notas, itensPorNota: itens, mes: '2026-09', precos: new Map([['P1', 1.96]]), precoCaixa: new Map([['P1', 94.08]]),
    cfg: { comissao_usuarios: { ext: 'externo' } }, usuarios: [{ user_id: 'int', nome: 'Interna', papel: 'vendedor' }, { user_id: 'ext', nome: 'Externa', papel: 'vendedor' }, { user_id: 'adm', nome: 'Adm', papel: 'admin' }] });
  assert.deepStrictEqual(r.map(x => [x.nome, x.plano, x.base, x.comissao, x.semTabela, x.notas.length]), [['Interna', 'interno', 306, 12.21, 1, 1], ['Externa', 'externo', 245, 24.5, 0, 1]]);
  // interno: 196 × 3,5% + 100 × 5% + 10 × 3,5% = 6,86 + 5 + 0,35
  assert.deepStrictEqual(r[0].porFaixa, { A: { base: 206, comissao: 7.21, pct: 3.5 }, B: { base: 100, comissao: 5, pct: 5 } });
  assert.strictEqual(P.totalComAjustes(12.21, [{ valor: -2.21, motivo: 'devolução' }]), 10);
});

test('apuração: o preço de tabela do pedido do CRM (foto do dia) vale sobre o de hoje', () => {
  const r = P.apuraComissao({ notas: [{ id: 'n1', numero: 1, emitida_em: '2026-09-05T13:00:00Z', vendedor_id: 'v' }], mes: '2026-09',
    itensPorNota: new Map([['n1', [{ codigo: 'P1', unidade: 'PT', valor_unitario: 2, valor_total: 200, cfop: '5102' }]]]),
    precos: new Map([['P1', 2.2]]), pedidoDaNota: new Map([['n1', { itens: [{ codigo: 'P1', unidade: 'PT', preco_tab: 1.60 }] }]]),
    cfg: {}, usuarios: [{ user_id: 'v', nome: 'V', papel: 'vendedor' }] });
  assert.deepStrictEqual(Object.keys(r[0].porFaixa), ['F']); // 2,00 sobre 1,60 = +25% → F (com o preço de hoje seria abaixo)
});

test('apuração: devolução tira a comissão da venda no mês da devolução, na proporção do valor (22/10/2026)', () => {
  const R = require('../regras.js');
  const venda = { id: 'n1', numero: 2733, emitida_em: '2026-10-20T13:00:00Z', vendedor_id: 'v', cliente_nome: 'CLIENTE X', valor_total: 400 };
  const D = { notas: [venda], devolucoes: [{ id: 'd1', origem: 'cliente', numero: 99, quando: '2026-11-04T12:00:00Z', venda_id: 'n1', valor: 100, itens: [] }] };
  const base = { notas: D.notas, devolucoes: R.devolucoesComoNotas(D), itensPorNota: new Map([['n1', [{ codigo: 'P1', unidade: 'PT', valor_unitario: 2, valor_total: 400, cfop: '5102' }]]]),
    precos: new Map([['P1', 2]]), cfg: {}, usuarios: [{ user_id: 'v', nome: 'V', papel: 'vendedor' }] };
  const out = P.apuraComissao(Object.assign({ mes: '2026-10' }, base)), nov = P.apuraComissao(Object.assign({ mes: '2026-11' }, base));
  assert.deepStrictEqual([out[0].base, out[0].comissao], [400, 14], 'outubro: a venda inteira (faixa A, 3,5%)');
  assert.deepStrictEqual([nov[0].base, nov[0].comissao, nov[0].notas.length], [-100, -3.5, 1], 'novembro: −1/4 da venda');
  assert.deepStrictEqual([nov[0].notas[0].devolucao, nov[0].notas[0].venda, nov[0].porFaixa.A.comissao], [true, 2733, -3.5]);
  // devolução maior que a venda não tira mais que a venda
  D.devolucoes[0].valor = 900;
  assert.strictEqual(P.apuraComissao(Object.assign({ mes: '2026-11' }, base, { devolucoes: R.devolucoesComoNotas(D) }))[0].comissao, -14);
});

test('faturamento: devolução entra negativa no mês dela, na vendedora e no cliente da venda, sem contar como nota', () => {
  const R = require('../regras.js');
  const D = { empresas: [{ id: 'c1', nome: 'CLIENTE X', responsavel_id: 'v' }], usuarios: [{ user_id: 'v', nome: 'Vera', papel: 'vendedor' }],
    notas: [{ id: 'n1', numero: 2733, emitida_em: '2026-10-20T13:00:00Z', empresa_id: 'c1', vendedor_id: 'v', valor_total: 400 }],
    nota_itens: [{ id: 'i1', nota_id: 'n1', codigo: 'P1', descricao: 'PAPEL', quantidade: 4, valor_total: 400, cfop: '5102' }],
    devolucoes: [{ id: 'd1', numero: 99, quando: '2026-11-04T12:00:00Z', venda_id: 'n1', valor: 100, itens: [{ codigo: 'P1', descricao: 'PAPEL', quantidade: 1, valor_total: 100 }] }] };
  const ix = R.indexa(D);
  const out = R.faturamento(D, ix, '2026-11-10', { periodo: R.periodo('mes', '2026-10-15') });
  const nov = R.faturamento(D, ix, '2026-11-10', { periodo: R.periodo('mes', '2026-11-10') });
  assert.deepStrictEqual([out.total, out.notas, out.valorDevolvido], [400, 1, 0]);
  assert.deepStrictEqual([nov.total, nov.notas, nov.valorDevolvido, nov.porVendedor[0].nome, nov.porVendedor[0].valor, nov.topClientes[0].notas], [-100, 0, 100, 'Vera', -100, 0]);
  assert.deepStrictEqual([nov.topProdutosValor[0].quantidade, nov.topProdutosValor[0].valor], [-1, -100]);
  const ano = R.faturamento(D, ix, '2026-11-10', { periodo: R.periodo('ano', '2026-11-10') });
  assert.deepStrictEqual([ano.total, ano.notas, ano.ticket], [300, 1, 300]);
  assert.strictEqual(R.faturamento(D, ix, '2026-11-10', { periodo: R.periodo('ano', '2026-11-10'), responsavel_id: 'outra' }).total, 0);
});

test('repetir pedido: do pedido do CRM ou da nota (com os preços dela, sem bonificação)', () => {
  assert.deepStrictEqual(P.itensParaRepetir({ itens: [{ codigo: 'A', descricao: 'X', unidade: 'GL', quantidade: 2, preco: 5, desconto: 1, base: 'A' }] }),
    [{ codigo: 'A', descricao: 'X', unidade: 'GL', quantidade: 2, preco: 5, desconto: 1 }]);
  assert.deepStrictEqual(P.itensParaRepetir(null, [{ codigo: 'B', descricao: 'Y', unidade: 'UN', quantidade: 3, valor_unitario: 4.5, cfop: '5102' }, { codigo: 'C', descricao: 'Z', quantidade: 1, valor_unitario: 0, cfop: '5910' }]),
    [{ codigo: 'B', descricao: 'Y', unidade: 'UN', quantidade: 3, preco: 4.5, desconto: 0 }]);
});

// 03/11/2026: plano interno pela margem da nota, como no FKN (planilha da Renata de outubro: R$ 775,89)
test('comissão interna pela margem da nota (regra do FKN)', () => {
  const f = P.MARGEM_INTERNO;
  assert.deepStrictEqual([22.99, 23, 24.42, 28.31, 30.5, 35.91, 38, 51.06].map(m => P.pctDaMargem(m, f)), [2, 3.5, 3.5, 5, 5, 5.5, 6, 6]);
  assert.strictEqual(P.rotuloMargem(P.chaveMargem(30.5, f)), 'margem 28–33%');
  assert.strictEqual(P.rotuloMargem(P.chaveMargem(10, f)), 'margem abaixo de 23%');
  const notas = [{ id: 'a', numero: 1, emitida_em: '2026-10-05T13:00:00Z', vendedor_id: 'v' }, { id: 'b', numero: 2, emitida_em: '2026-10-06T13:00:00Z', vendedor_id: 'v' }];
  const itens = new Map([['a', [{ codigo: 'X', valor_unitario: 10, valor_total: 574.49, cfop: '5102' }]], ['b', [{ codigo: 'X', valor_unitario: 99, valor_total: 1398, cfop: '5102' }]]]);
  const r = P.apuraComissao({ notas, itensPorNota: itens, mes: '2026-10', precos: new Map([['X', 10]]), margens: new Map([['a', 24.42], ['b', 41.84]]), usuarios: [{ user_id: 'v', nome: 'V', papel: 'vendedor' }] });
  assert.strictEqual(r[0].comissao, 20.11 + 83.88);   // MaisMu 3,5% e Senac 6%, como na planilha
  assert.deepStrictEqual(r[0].notas.map(n => n.margem), [24.42, 41.84]);
  // sem a margem (sem custo), a nota cai na faixa de preço; o externo continua pela faixa
  const sem = P.apuraComissao({ notas, itensPorNota: itens, mes: '2026-10', precos: new Map([['X', 10]]), margens: new Map(), usuarios: [{ user_id: 'v', nome: 'V', papel: 'vendedor' }] });
  assert.strictEqual(sem[0].semMargem, 2);
  const t = P.totais([{ quantidade: 10, preco: 13, preco_tab: 10, custo: 10 }], 0, { plano: P.PLANOS_PADRAO[0] });
  assert.deepStrictEqual([t.margem, t.comissaoPct, t.comissao], [23.08, 3.5, 4.55]);
  assert.strictEqual(P.totais([{ quantidade: 1, preco: 13, preco_tab: 10 }], 0, { plano: P.PLANOS_PADRAO[0] }).comissao, null);   // sem custo (vendedora)
});

// 03/11/2026: fardo (FD) vendido com o código do pacote usa o preço da caixa ".1" na faixa, não o do pacote (antes caía na F)
test('comissão: fardo pelo preço da caixa', () => {
  const notas = [{ id: 'a', numero: 1, emitida_em: '2026-10-05T13:00:00Z', vendedor_id: 'v' }];
  const itens = new Map([['a', [{ codigo: '300044', unidade: 'FD', valor_unitario: 113.75, valor_total: 113.75, cfop: '5102' }]]]);
  const cfg = { comissao_usuarios: { v: 'externo' } };
  const r = P.apuraComissao({ notas, itensPorNota: itens, mes: '2026-10', cfg, precos: new Map([['300044', 6.44]]), precoCaixa: new Map([['300044', 103.01]]),
    unidades: new Map([['300044', 'PT']]), usuarios: [{ user_id: 'v', nome: 'S', papel: 'vendedor' }] });
  assert.deepStrictEqual(Object.keys(r[0].porFaixa), ['C']);   // 113,75 ÷ 103,01 = +10,4% → faixa C (antes: ÷ 6,44 → F)
});

test('unidade da embalagem no impresso: a sigla fica e a embalagem fechada diz quanto vem dentro', () => {
  assert.strictEqual(P.unidadeEmbalagem('FR', 1, 'FR'), 'FR');
  assert.strictEqual(P.unidadeEmbalagem('FD', 1, 'FD'), 'FD');
  assert.strictEqual(P.unidadeEmbalagem('CX', '25.0000', 'PT'), 'CX c/ 25 PT');
  assert.strictEqual(P.unidadeEmbalagem('FD', 16, 'PT'), 'FD c/ 16 PT');
  assert.strictEqual(P.unidadeEmbalagem('CX', 12, 'CX'), 'CX c/ 12');
  assert.strictEqual(P.unidadeEmbalagem('CX', 12, null), 'CX c/ 12');
  assert.strictEqual(P.unidadeEmbalagem('', 1, 'UN'), '');
  const l = P.bolao([{ numero: 1, itens: [{ codigo: '150034.1', descricao: 'Copo', unidade: 'CX', fator: '25.0000', quantidade: 2 }] }], new Map());
  assert.strictEqual(l[0].fator, 25);
});

test('PJ do mês: fixo + comissão do usuário ligado, só ativos, total', () => {
  const pjs = [{ id: 1, nome: 'Zeca', fixo: 7000 }, { id: 2, nome: 'Ana', user_id: 'u1', fixo: '3500' }, { id: 3, nome: 'Bia', user_id: 'u2', fixo: 1000, ativo: false }, { id: 4, nome: 'Caio', user_id: 'u3', fixo: 0 }];
  const r = P.pjDoMes(pjs, new Map([['u1', 1200.5], ['u3', 900.25]]));
  assert.deepStrictEqual(r.linhas.map(l => [l.nome, l.fixo, l.comissao, l.total]), [['Ana', 3500, 1200.5, 4700.5], ['Caio', 0, 900.25, 900.25], ['Zeca', 7000, 0, 7000]]);
  assert.strictEqual(r.total, 12600.75);
  assert.strictEqual(r.fixo, 10500);
});

test('PJ: pagamento no dia útil depois de os condomínios pagarem o dia 11 (regra da Agilité)', () => {
  const C = require('../caixa-calculo.js');
  assert.strictEqual(P.diaPagamentoPj('2026-10', C.util), '2026-11-12');   // 11/11 quarta
  assert.strictEqual(P.diaPagamentoPj('2026-11', C.util), '2026-12-14');   // 11/12 sexta → 14/12
  assert.strictEqual(P.diaPagamentoPj('2026-09', C.util), '2026-10-14');   // 11/10 domingo, 12/10 feriado → 13 paga, 14 cai
  assert.strictEqual(P.diaPagamentoPj('2026-12', C.util), '2027-01-12');
});

test('PJ: lançamentos do Caixa ligados à conta fixa na competência do pagamento', () => {
  const l = P.lancamentosPj([{ nome: 'Ana', recorrente_id: 'r1', fixo: 3500, comissao: 1200.5, total: 4700.5 }, { nome: 'Zeca', fixo: 0, comissao: 0, total: 0 }, { nome: 'Caio', fixo: 7000, comissao: 0, total: 7000 }], '2026-12-14', 'novembro de 2026');
  assert.strictEqual(l.length, 2);
  assert.deepStrictEqual([l[0].descricao, l[0].valor, l[0].vencimento, l[0].competencia, l[0].recorrente_id, l[0].categoria, l[0].tipo], ['PJ Ana — novembro de 2026', 4700.5, '2026-12-14', '2026-12-01', 'r1', 'Salários', 'saida']);
  assert.strictEqual(l[0].observacoes, 'Fixo R$ 3500,00 + comissão de novembro de 2026 R$ 1200,50 (lançado pela aba PJ)');
  assert.strictEqual(l[1].recorrente_id, null);
});

test('repetir pelo nº: local de entrega lido do XML da NF-e', () => {
  const xml = '<NFe><dest><xNome>CLIENTE EXEMPLO</xNome></dest><entrega><CNPJ>00000000000000</CNPJ><xNome>UNIDADE EXEMPLO &amp; CIA</xNome><xLgr>RUA DAS FLORES</xLgr><nro>10</nro><xCpl>FUNDOS</xCpl>' +
    '<xBairro>CENTRO</xBairro><cMun>3550308</cMun><xMun>SAO PAULO</xMun><UF>SP</UF><CEP>01000000</CEP></entrega></NFe>';
  assert.deepStrictEqual(P.entregaDoXml(xml), { local: 'UNIDADE EXEMPLO & CIA', endereco: 'RUA DAS FLORES', numero: '10', compl: 'FUNDOS', bairro: 'CENTRO', cidade: 'SAO PAULO', uf: 'SP', cep: '01000000' });
  assert.strictEqual(P.entregaDoXml('<NFe><dest/></NFe>'), null);
  assert.strictEqual(P.entregaDoXml(null), null);
});
