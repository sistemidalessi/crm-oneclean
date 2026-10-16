'use strict';
// Estoque do CRM (Fase 2 da saída do FKN, 16/10/2026): regras puras da aba Estoque (estoque.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../estoque.js');

test('saldo do CRM ao lado do "atual" do FKN, sem as caixas fechadas', () => {
  const saldo = [{ codigo: 'A', descricao: 'DETERGENTE', unidade: 'GL', saldo: '10', custo_medio: '5.5', ult_mov: '2026-10-16T12:00:00Z' },
    { codigo: 'B', descricao: 'LUVA', unidade: 'PC', saldo: '-2', custo_medio: '3' }];
  const fkn = [{ codigo: 'A', descricao: 'DETERGENTE', estoque_atual: 12, quantidade: 9, pend_cliente: 3, fornecedor: 'FORN' },
    { codigo: 'A.1', descricao: 'DETERGENTE CX C/4', quantidade: 2 },
    { codigo: 'B', descricao: 'LUVA', quantidade: 5, pend_cliente: 1 }, // listagem antiga, sem o "atual": saldo + reservado
    { codigo: 'C', descricao: 'NOVO', estoque_atual: 4 }];
  const l = S.junta(saldo, fkn);
  assert.deepEqual(l.map(x => [x.codigo, x.saldo, x.fkn, x.dif]), [['A', 10, 12, 2], ['B', -2, 6, 8], ['C', null, 4, null]]);
  assert.equal(S.valor(l), 55, 'saldo negativo não vale no valor a custo');
});

test('dias seguidos sem diferença sem explicação (todas as listagens do dia)', () => {
  const f = (iso, n) => ({ gerado_em: iso, resumo: { diferentes: n + 2, sem_explicacao: n } });
  assert.deepEqual(S.sequencia([f('2026-10-18T16:00:00Z', 0), f('2026-10-18T10:00:00Z', 0), f('2026-10-17T16:00:00Z', 0), f('2026-10-16T16:00:00Z', 1), f('2026-10-15T16:00:00Z', 0)]),
    { dias: 2, desde: '2026-10-17', ultimoProblema: '2026-10-16' });
  assert.equal(S.sequencia([f('2026-10-18T16:00:00Z', 0), f('2026-10-18T10:00:00Z', 3)]).dias, 0, 'uma listagem ruim no dia derruba o dia');
  assert.equal(S.sequencia([{ gerado_em: '2026-10-18T16:00:00Z', resumo: null }]).dias, 0, 'listagem não conferida não conta');
});

test('contagem colada: ponto e vírgula, Tab, espaço, vírgula decimal e milhar com ponto', () => {
  const r = S.lerContagem('300005;120\n290027\t3.000\n010001 12,5\n010002;1.234,5\nlixo\n\n300005;118');
  assert.deepEqual(r.lote, [{ codigo: '300005', contado: 118 }, { codigo: '290027', contado: 3000 }, { codigo: '010001', contado: 12.5 }, { codigo: '010002', contado: 1234.5 }]);
  assert.deepEqual(r.erros, ['lixo']);
  assert.equal(S.lerContagem('A;12.5').lote[0].contado, 12.5, 'ponto sem grupo de milhar é decimal');
});
