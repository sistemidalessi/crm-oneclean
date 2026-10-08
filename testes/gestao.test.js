'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../regras.js');
const G = require('../gestao.js');

const HOJE = '2026-09-30';
function base() {
  const D = { usuarios: [{ user_id: 'u1', nome: 'Ana Exemplo', papel: 'vendedor', ativo: true }, { user_id: 'adm', nome: 'Admin', papel: 'admin', ativo: true }],
    etapas: [], opcoes: [], produtos: [], metas: [{ usuario_id: 'u1', mes: '2026-09-01', valor: 1000 }], empresas: [], contatos: [], negocios: [], negocio_itens: [], propostas: [], atividades: [], notas: [], nota_itens: [] };
  D.empresas = [
    { id: 'P', nome: 'Padaria Exemplo', situacao: 'cliente', responsavel_id: 'u1' },
    { id: 'S', nome: 'Sumida Exemplo', situacao: 'cliente', responsavel_id: 'u1' },
    { id: 'L', nome: 'Lead Exemplo', situacao: 'lead', responsavel_id: 'u1' }
  ];
  let k = 0;
  const nota = (emp, dia, itens) => {
    const id = 'n' + (++k);
    D.notas.push({ id, empresa_id: emp, emitida_em: dia + 'T10:00:00-03:00', valor_total: itens.reduce((s, i) => s + i.valor_total, 0), cancelada: false });
    itens.forEach((it, i) => D.nota_itens.push(Object.assign({ id: id + 'i' + i, nota_id: id, cfop: '5102' }, it)));
  };
  const det = q => ({ descricao: 'DETERGENTE 5L', unidade: 'GL', quantidade: q, valor_total: q * 25 });
  const pap = q => ({ descricao: 'PAPEL TOALHA', unidade: 'FD', quantidade: q, valor_total: q * 10 });
  // Padaria: a cada 21 dias; última em 19/09 (próxima 10/10).
  ['2026-07-18', '2026-08-08', '2026-08-29', '2026-09-19'].forEach(d => nota('P', d, [det(4), pap(10)]));
  // Sumida: comprava a cada ~15 dias até junho.
  ['2026-05-01', '2026-05-16', '2026-05-31', '2026-06-15'].forEach(d => nota('S', d, [pap(20)]));
  D.atividades = [
    { id: 'a1', empresa_id: 'P', tipo: 'whatsapp', descricao: 'ok', concluida: true, concluida_em: '2026-09-30T12:00:00Z', data_hora: '2026-09-30T12:00:00Z', responsavel_id: 'u1' },
    { id: 'a2', empresa_id: 'L', tipo: 'ligacao', descricao: 'ligar', concluida: false, data_hora: '2026-09-20T12:00:00Z', responsavel_id: 'u1' }
  ];
  return D;
}

test('painel de gestão: mês, equipe, tops e clientes sumidos', () => {
  const D = base(), ix = R.indexa(D), cfg = R.config({});
  const p = G.painel(D, ix, cfg, HOJE);
  assert.equal(p.mes.atual.valor, 200, 'setembro: uma nota da padaria (4×25 + 10×10)');
  assert.equal(p.mes.anterior.valor, 400, 'agosto: duas notas');
  assert.equal(p.mes.projecao, 200, 'dia 30 de 30: a projeção é o próprio mês');
  assert.equal(p.ano.notas, 8);
  assert.deepEqual(p.equipe.map(u => u.nome), ['Ana Exemplo'], 'administrador fora da tabela da equipe');
  const ana = p.equipe[0];
  assert.equal(ana.valorMes, 200); assert.equal(ana.meta, 1000); assert.equal(Math.round(ana.pctMeta), 20);
  assert.equal(ana.contatosHoje, 1); assert.equal(ana.atrasadas, 1); assert.equal(ana.clientesAtivos, 1);
  assert.deepEqual(p.sumidos.map(s => s.empresa.id), ['S'], 'comprava a cada 15 dias e sumiu desde junho');
  assert.equal(p.topClientes[0].nome, 'Padaria Exemplo');
});

test('compras: demanda prevista, curva ABC e tendência', () => {
  const D = base(), ix = R.indexa(D), cfg = R.config({});
  const c = G.compras(D, ix, cfg, HOJE, 30);
  assert.deepEqual(c.clientesPrevistos.map(x => x.empresa.id), ['P'], 'a sumida não entra na previsão');
  const det = c.demanda.find(g => g.descricao === 'DETERGENTE 5L');
  assert.equal(det.prevista, 4); assert.equal(det.clientesPrevistos, 1);
  assert.equal(c.demanda.find(g => g.descricao === 'PAPEL TOALHA').prevista, 10);
  // 12 meses: papel (4×10 + 4×20)×10 = 1200 (75%); detergente 4×4×25 = 400. O item que cruza os 80% é A.
  assert.deepEqual(c.abc.A.map(g => g.descricao), ['DETERGENTE 5L', 'PAPEL TOALHA']);
  assert.equal(c.abc.B.length + c.abc.C.length, 0);
  assert.equal(Math.round(c.abc.total), 1600);
  // Previsão curta (7 dias) não pega a padaria (próxima 10/10).
  assert.equal(G.compras(D, ix, cfg, HOJE, 7).demanda.length, 0);
});

test('estoque do FKN: leitura do CSV e sugestão de pedido', () => {
  const csv = 'CODIGO;NOME DO PRODUTO;UNIDADE;LOCALIZAÇÃO;CUSTO;ESTOQUE\r\n010001.0;DETERGENTE 5L;GL;;25,00;1,000\r\n010002.0;PAPEL TOALHA;FD;;1.000,00;100,000\r\n010003.0;CERA PARADA;GL;;300,00;10,000\r\n010004.0;SEM SALDO;UN;;0,00;-3,000\r\n';
  const est = G.lerEstoque(csv);
  assert.deepEqual(est.map(x => [x.codigo, x.quantidade, x.custo_total]), [['010001', 1, 25], ['010002', 100, 1000], ['010003', 10, 300], ['010004', -3, 0]]);
  assert.throws(() => G.lerEstoque('A;B\r\n1;2'), /CÓDIGO e ESTOQUE/);

  const D = base();
  D.nota_itens.forEach(it => { it.codigo = it.descricao === 'DETERGENTE 5L' ? '010001' : '010002'; });
  const ix = R.indexa(D), cfg = R.config({});
  const c = G.compras(D, ix, cfg, HOJE, 30, est.map(x => Object.assign({ atualizado_em: '2026-09-30T18:00:00Z' }, x)));
  // Detergente: previsão 4 (padaria); consumo 90 dias = 4 notas × 4 = 16 → 5,3 em 30 dias (vale o maior);
  // tem 1 → comprar 5.
  const det = c.sugestao.find(g => g.codigo === '010001');
  assert.equal(det.saldo, 1); assert.equal(det.comprar, 5); assert.equal(det.custoUnit, 25);
  // Papel: tem 100, precisa ~10 → não entra na sugestão.
  assert.ok(!c.sugestao.some(g => g.codigo === '010002'));
  assert.deepEqual(c.parado.map(x => x.codigo), ['010003'], 'cera tem saldo e não vendeu em 90 dias');
  assert.equal(c.estoque.produtos, 4); assert.equal(c.estoque.negativos, 1); assert.equal(c.estoque.valor, 1325);
  assert.equal(c.estoque.valorSugestao, 125);
});

test('gestão: negócios abertos e conversão só do funil de vendas (pós-venda fora)', () => {
  const D = base();
  D.etapas = [{ id: 'v1', funil: 'Funil de Vendas', nome: 'Orçamento', ordem: 1, probabilidade: 50 }, { id: 'p1', funil: 'Funil de Pós-Vendas', nome: 'Contato', ordem: 1, probabilidade: 0 }];
  D.negocios = [{ id: 'a', empresa_id: 'P', status: 'aberto', valor: 100, etapa_id: 'v1', responsavel_id: 'u1', criado_em: '2026-09-01T12:00:00Z' },
    { id: 'b', empresa_id: 'P', status: 'aberto', valor: 900, etapa_id: 'p1', responsavel_id: 'u1', criado_em: '2026-09-01T12:00:00Z' }];
  const p = G.painel(D, R.indexa(D), R.config({}), HOJE);
  assert.equal(p.funilVendas, 'Funil de Vendas');
  assert.equal(p.funil.abertas.valor, 100);
  assert.equal(p.funil.abertas.ponderado, 50);
});

// Listagem cadastral de produtos do FKN (SIFN108) em CSV: um bloco por produto.
const bloco = (cod, v, nome, sit, linha, fam, est, ind, forn) => [
  cod + ';' + v + ';' + nome + ';;' + sit + ';' + linha + ';' + fam + ';',
  '       ESTOQUE:;mín:' + est[0] + ';   máx:' + est[1] + ';   atual:' + est[2] + ';   saldo:' + est[3] + ';   PEND:   cli:' + est[4] + ';   for:' + est[5] + ';   prog:;',
  '       IND:cus/ven  0,0000/;  30,0000   ($);med:      0,000;  comp:' + ind[0] + ';  cus:' + ind[1] + ';  ven:' + ind[2] + ';  tab:       0,000;',
  '       Fornecedor: ' + forn + ';',
  '   localiz:;;',
  '       últ.entrada: 05/09/2026   últ.saída: 16/09/2026   últ.alt.preço: 07/08/2026   data cadastro: 26/07/2024;',
  '       VENDA ULT 6 MESES: ABR/26       0,0 MAI/26       0,0 JUN/26       0,0 JUL/26       0,0 AGO/26       0,0 SET/26       0,0 MÉDIA;',
  '------------------------------------------------------------;'].join('\r\n');
const LISTAGEM = ['EMPRESA EXEMPLO LTDA;PAG.: 1 de 1;', ';DATA: 01/10/2026;', 'SISTEMA DE GESTÃO EMPRESARIAL;14:14;', 'LISTAGEM CADASTRAL DE PRODUTOS;FKN(108)-00;',
  'CÓDIGO;;NOME DO PRODUTO;FANTASIA;SITUAÇÃO;LINHA;FAMÍLIA;', '',
  bloco('010001', 0, 'DETERGENTE 5L', 'ATIVO', 'DOMISSANITARIOS', '107 MULTI USO', ['      2', '     10', '        3', '        1', '      2', '      0'], ['     25,000', '     25,000', '      32,50'], '00059 FORNECEDOR UM LTDA'),
  bloco('010001', 1, 'DETERGENTE 5L CX C/4', 'ATIVO', 'DOMISSANITARIOS', '107 MULTI USO', ['      0', '      0', '        1', '        1', '      0', '      1'], ['    100,000', '    100,000', '     130,00'], '00059 FORNECEDOR UM LTDA'),
  bloco('010002', 0, 'PAPEL TOALHA', 'ATIVO', 'PAPEIS', '200 TOALHA', ['     50', '    200', '      100', '      100', '      0', '      0'], ['     10,000', '     10,000', '      13,00'], '00077 FORNECEDOR DOIS LTDA'),
  bloco('010005', 0, 'LUVA NITRILICA', 'ATIVO', 'EPI', '300 LUVAS', ['     20', '     40', '        5', '        5', '      0', '      3'], ['      4,000', '      4,000', '       5,20'], '00000'),
  bloco('010009', 0, 'PRODUTO ANTIGO', 'INATIVO', 'UTILIDADES', '000', ['      0', '      0', '        0', '        0', '      0', '      0'], ['      1,000', '      1,000', '       1,30'], '00000')
].join('\r\n');

test('listagem de produtos do FKN: fornecedor, mínimo, pedido e a caixa fechada', () => {
  assert.ok(G.ehListagemProdutos(LISTAGEM));
  const l = G.lerArquivoEstoque(LISTAGEM);
  assert.deepEqual(l.map(x => x.codigo), ['010001', '010001.1', '010002', '010005'], 'inativo sem saldo fica de fora');
  const det = l[0];
  assert.deepEqual([det.quantidade, det.estoque_min, det.estoque_max, det.pend_cliente, det.pend_fornecedor, det.custo_unit, det.preco_venda, det.fornecedor_cod, det.fornecedor, det.linha, det.familia, det.ult_entrada],
    [1, 2, 10, 2, 0, 25, 32.5, '00059', 'FORNECEDOR UM LTDA', 'DOMISSANITARIOS', '107 MULTI USO', '2026-09-05'], 'saldo (já sem o reservado para cliente), não o atual');
  assert.equal(l[3].fornecedor, null, 'fornecedor 00000 = sem fornecedor');
  assert.equal(det.custo_total, 25);

  const j = G.juntaVariantes(l);
  const dj = j.find(x => x.codigo === '010001');
  assert.equal(j.length, 3, 'a caixa entra na unidade');
  assert.deepEqual([dj.quantidade, dj.pend_fornecedor, dj.caixa.fator, dj.caixa.saldo], [5, 4, 4, 1], '1 + 1 cx de 4; 1 cx pedida = 4');
  assert.equal(G.fatorCaixa({ custo_unit: 0 }, { descricao: 'CERA CX C/12' }), 12, 'sem custo: pelo nome');

  const D = base();
  D.nota_itens.forEach(it => { it.codigo = it.descricao === 'DETERGENTE 5L' ? '010001' : '010002'; });
  const c = G.compras(D, R.indexa(D), R.config({}), HOJE, 30, l.map(x => Object.assign({ atualizado_em: '2026-10-01T17:00:00Z' }, x)));
  // Detergente: precisa ~5,3 (consumo); tem 5 (1 + 1 cx de 4) e 4 a caminho → não compra.
  const g = c.produtos.find(x => x.codigo === '010001');
  assert.deepEqual([g.saldo, g.pedido, g.comprar, g.fornecedor], [5, 4, 0, 'FORNECEDOR UM LTDA']);
  // Luva: sem venda, mas mínimo 20, tem 5 e 3 pedidas → compra 12 pelo mínimo.
  const luva = c.produtos.find(x => x.codigo === '010005');
  assert.deepEqual([luva.comprar, luva.pelaMinimo], [12, true]);
  assert.ok(c.estoque.completo);
  assert.deepEqual(c.pedidoPorFornecedor.map(f => [f.nome, f.itens.length, f.custo]), [['Sem fornecedor no FKN', 1, 48]]);
  assert.deepEqual(c.listas.fornecedores, ['FORNECEDOR DOIS LTDA', 'FORNECEDOR UM LTDA']);
  assert.ok(!c.parado.some(x => x.codigo === '010001.1'), 'a caixa não aparece como parada separada');
});

test('listagem de produtos: conferência do relatório puxado no FKN (o que faltou marcar)', () => {
  const K = require('../fkn.js');
  assert.deepEqual(K.conferirListagemProdutos(LISTAGEM).recusa, [], 'a listagem completa passa');
  const tira = re => LISTAGEM.split('\r\n').filter(l => !re.test(l)).join('\r\n');
  assert.match(K.conferirListagemProdutos(tira(/Fornecedor:/)).recusa.join(), /"Fornecedor"/);
  assert.match(K.conferirListagemProdutos(tira(/IND:/)).recusa.join(), /"Índices\/preços"/);
  assert.match(K.conferirListagemProdutos(tira(/ESTOQUE:/)).recusa.join(), /"Estoque\/pendências"/);
  const semDatas = K.conferirListagemProdutos(tira(/últ\.entrada/));
  assert.deepEqual(semDatas.recusa, [], 'sem as datas ainda entra');
  assert.match(semDatas.avisos.join(), /Movimentação/);
  assert.match(K.conferirListagemProdutos('A;B\r\n1;2').recusa.join(), /não achei produtos/);
});

test('equipe: comprador fora, "Direto" (venda do administrador) no fim, total = faturamento do mês', () => {
  const D = base();
  D.usuarios.push({ user_id: 'cmp', nome: 'Comprador Exemplo', papel: 'comprador', ativo: true });
  // venda direta (admin) e uma venda de ex-vendedora (sem dono): entram no total
  D.notas.push({ id: 'nd', empresa_id: 'P', vendedor_id: 'adm', emitida_em: '2026-09-25T10:00:00-03:00', valor_total: 300, cancelada: false });
  D.nota_itens.push({ id: 'ndi', nota_id: 'nd', cfop: '5102', descricao: 'DETERGENTE 5L', unidade: 'GL', quantidade: 12, valor_total: 300 });
  D.notas.push({ id: 'nx', empresa_id: 'P', vendedor_nome: 'EX VENDEDORA', emitida_em: '2026-09-26T10:00:00-03:00', valor_total: 50, cancelada: false });
  D.nota_itens.push({ id: 'nxi', nota_id: 'nx', cfop: '5102', descricao: 'PAPEL TOALHA', unidade: 'FD', quantidade: 5, valor_total: 50 });
  const p = G.painel(D, R.indexa(D), R.config({}), HOJE);
  assert.deepEqual(p.equipe.map(u => u.nome), ['Ana Exemplo', 'Direto'], 'comprador fora; Direto por último');
  assert.equal(p.equipe[1].valorMes, 300);
  assert.equal(p.equipeTotal.valorMes, 550, '200 da Ana + 300 Direto + 50 de ex-vendedora');
  assert.equal(p.equipeTotal.outros.mes, 50);
  assert.equal(p.equipeTotal.valorMes, p.mes.atual.valor, 'o total bate com o faturamento do mês');
});
