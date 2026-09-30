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

test('estoque do FKM: leitura do CSV e sugestão de pedido', () => {
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
