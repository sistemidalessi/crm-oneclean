'use strict';
// Pedidos ao fornecedor / compras a caminho (20/10/2026): situação do pedido, previsão (a nota do fornecedor manda:
// chega 2 dias depois dela), o que a vendedora lê por produto e os itens que saem da sugestão de Compras.
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../compras-pedidos.js');

const HOJE = '2026-10-20';
const pedidos = [
  { id: 1, fornecedor_nome: 'VIGUT', previsao: '2026-10-27', situacao: 'aberto', criado_em: '2026-10-20T21:00:00Z' },
  { id: 2, fornecedor_nome: 'EMBALAC', previsao: '2026-11-13', situacao: 'aberto', criado_em: '2026-10-14T12:00:00Z' },
  { id: 3, fornecedor_nome: 'BRITISH', previsao: '2026-10-15', situacao: 'aberto', criado_em: '2026-10-08T12:00:00Z' },
  { id: 4, fornecedor_nome: 'COALA', previsao: '2026-10-08', situacao: 'recebido', criado_em: '2026-10-01T12:00:00Z' },
  { id: 5, fornecedor_nome: 'X', previsao: '2026-10-30', situacao: 'cancelado', criado_em: '2026-10-18T12:00:00Z' }
];
const itens = [
  { pedido_id: 1, ordem: 1, codigo: '010148', quantidade: 12, cancelado: 0, custo_unit: 22.9, unidade: 'GL' },
  { pedido_id: 2, ordem: 1, codigo: '370045', quantidade: 200, cancelado: 0 },
  { pedido_id: 3, ordem: 1, codigo: '230003', quantidade: 600, cancelado: 0 },
  { pedido_id: 3, ordem: 2, codigo: '230018', quantidade: 200, cancelado: 0 },
  { pedido_id: 4, ordem: 1, codigo: '000022', quantidade: 48, cancelado: 0 },
  { pedido_id: 5, ordem: 1, codigo: '1', quantidade: 1, cancelado: 0 }
];
const andamento = [
  { pedido_id: 1, ordem: 1, faturado: 0, recebido: 0 },
  { pedido_id: 2, ordem: 1, faturado: 200, recebido: 0, faturado_em: '2026-10-19T14:00:00Z', notas: '4512' },
  { pedido_id: 3, ordem: 1, faturado: 400, recebido: 400, faturado_em: '2026-10-14T12:00:00Z', notas: '881' },
  { pedido_id: 3, ordem: 2, faturado: 200, recebido: 200, faturado_em: '2026-10-14T12:00:00Z', notas: '881' }
];

test('monta: situação, previsão que vale e atraso', () => {
  const l = X.monta(pedidos, itens, andamento, HOJE), p = id => l.find(x => x.id === id);
  assert.equal(p(1).situacaoAtual, 'pedido'); assert.equal(p(1).previsaoEf, '2026-10-27'); assert.equal(p(1).atrasado, false);
  assert.equal(p(1).total, 274.8);
  // a nota do fornecedor de 19/10 manda: chega ~21/10 (e não 13/11)
  assert.equal(p(2).situacaoAtual, 'faturado'); assert.equal(p(2).previsaoEf, '2026-10-21'); assert.equal(p(2).notas, '4512');
  // British: entrou 600 de 800 → parcial; a nota já entrou, vale a previsão do pedido (15/10) → atrasado 5 dias
  assert.equal(p(3).situacaoAtual, 'parcial'); assert.equal(p(3).atrasado, true); assert.equal(p(3).diasAtraso, 5);
  assert.deepEqual(p(3).itens.map(i => i.falta), [200, 0]);
  assert.equal(p(4).situacaoAtual, 'recebido'); assert.equal(p(4).aberto, false); assert.equal(p(4).itens[0].falta, 0);
  assert.equal(p(5).situacaoAtual, 'cancelado'); assert.equal(p(5).aberto, false);
  // em aberto e atrasados primeiro
  assert.equal(l[0].id, 3);
});

test('porProduto e textos: o que a vendedora lê (quantidade e data, sem valor)', () => {
  const m = X.porProduto([
    { codigo: '010148', pedido_id: 1, pedido_em: '2026-10-20T21:00:00Z', previsao: '2026-10-27', falta: 12, faturado: 0, faturado_em: null },
    { codigo: '370045', pedido_id: 2, pedido_em: '2026-10-14T12:00:00Z', previsao: '2026-11-13', falta: 200, faturado: 200, faturado_em: '2026-10-19T14:00:00Z' },
    { codigo: '230003', pedido_id: 3, pedido_em: '2026-10-08T12:00:00Z', previsao: '2026-10-15', falta: 200, faturado: 0, faturado_em: null },
    { codigo: '010148.1', pedido_id: 9, pedido_em: '2026-10-19T12:00:00Z', previsao: '2026-10-25', falta: 2, faturado: 0, faturado_em: null }
  ], HOJE);
  const h = m.get('010148');
  assert.equal(h.falta, 14); assert.equal(h.proxima, '2026-10-25'); assert.equal(h.linhas.length, 2);
  assert.equal(X.textoLinha(h.linhas[1], 'GL'), '12 GL comprados em 20/10 · chegam ~27/10');
  assert.equal(X.textoCaminho(m.get('370045'), 'PT'), '200 PT faturados pelo fornecedor em 19/10 · chegam ~21/10');
  assert.equal(X.textoCaminho(m.get('230003'), 'UN'), '200 UN a caminho · previsão era 15/10 (atrasado)');
  assert.equal(m.get('230003').atrasado, true);
  assert.equal(X.textoCaminho(null), '');
});

test('itensDaSugestao: só o que tem código e quantidade, sem a variante da caixa', () => {
  const f = { itens: [{ codigo: '010148', descricao: 'HIPOCLORITO', unidade: 'GL', comprar: 12, custoUnit: 22.9 }, { codigo: '010618.1', descricao: 'CERA CX', comprar: 2 },
    { codigo: '', descricao: 'SEM CODIGO', comprar: 3 }, { codigo: '010100', comprar: 0 }] };
  assert.deepEqual(X.itensDaSugestao(f), [
    { codigo: '010148', descricao: 'HIPOCLORITO', unidade: 'GL', quantidade: 12, custo_unit: 22.9 },
    { codigo: '010618', descricao: 'CERA CX', unidade: null, quantidade: 2, custo_unit: null }]);
  assert.equal(X.previsaoDe('2026-10-27', 0, '2026-10-19T14:00:00Z'), '2026-10-27');
  assert.equal(X.previsaoDe('2026-10-27', 5, '2026-10-19T14:00:00Z'), '2026-10-21');
});
