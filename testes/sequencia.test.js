'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../sequencia.js');

test('sequência do lead: passos, dias e quando para', () => {
  const cfg = {};
  assert.equal(S.passos(cfg).length, 4, 'padrão: 4 passos');
  assert.ok(S.ativa(cfg));
  assert.ok(!S.ativa({ sequencia_ativa: false }));
  assert.ok(!S.ativa({ sequencia_lead: [] }), 'sem passos não há sequência');
  // Dias contam a partir do passo anterior: 0, 2, 5, 10 → +0, +2, +3, +5.
  assert.equal(S.diaDoPasso(cfg, 1, '2026-10-01'), '2026-10-01');
  assert.equal(S.diaDoPasso(cfg, 2, '2026-10-01'), '2026-10-03');
  assert.equal(S.diaDoPasso(cfg, 3, '2026-10-03'), '2026-10-06');
  assert.equal(S.diaDoPasso(cfg, 5, '2026-10-03'), null);
  const d = S.descricao(2, 4, S.passos(cfg)[1]);
  assert.equal(d, '[Sequência 2/4] Ligar para entender a necessidade');
  assert.deepEqual(S.passoDe({ descricao: d }), { n: 2, total: 4 });
  assert.equal(S.passoDe({ descricao: 'Ligar para o cliente' }), null);
  // Continua só enquanto for lead sem negócio aberto/ganho.
  const lead = { id: 'L', situacao: 'lead' };
  assert.ok(S.continua(lead, []));
  assert.ok(S.continua(lead, [{ empresa_id: 'L', status: 'perdido' }]));
  assert.ok(!S.continua(lead, [{ empresa_id: 'L', status: 'aberto' }]));
  assert.ok(!S.continua({ id: 'L', situacao: 'prospect' }, []));
  // Passo sem título fica de fora.
  assert.equal(S.passos({ sequencia_lead: [{ dia: 0, titulo: 'A' }, { dia: 3, titulo: '' }] }).length, 1);
});
