'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../perfil.js');

test('tipo de cliente: novo, recorrente, reativado, inativo, sem compra', () => {
  const hoje = '2026-10-01', cfg = { dias_inativo: 90, dias_cliente_novo: 90 };
  const t = d => P.tipoCliente(d, hoje, cfg).tipo;
  assert.equal(t([]), 'sem_compra');
  assert.equal(t(['2026-08-10']), 'novo', '1ª compra há 52 dias');
  assert.equal(t(['2026-07-15', '2026-09-20']), 'novo', '1ª compra há 78 dias, já comprou de novo: ainda novo');
  assert.equal(t(['2026-02-01', '2026-03-05', '2026-04-10', '2026-05-12', '2026-06-15', '2026-07-20', '2026-08-25', '2026-09-28']), 'recorrente');
  assert.equal(t(['2026-01-10', '2026-02-10', '2026-09-15']), 'reativado', 'ficou 217 dias parado e voltou há 16 dias');
  const r = P.tipoCliente(['2026-01-10', '2026-02-10', '2026-09-15'], hoje, cfg);
  assert.equal(r.desde, '2026-09-15'); assert.equal(r.parado, 217);
  assert.equal(t(['2026-01-10', '2026-02-10', '2026-05-20', '2026-06-25', '2026-08-01', '2026-09-10']), 'recorrente', 'voltou há mais de 90 dias e seguiu comprando');
  assert.equal(t(['2026-03-01', '2026-05-01']), 'inativo', 'última compra há 153 dias');
  assert.equal(t(['2026-09-01', '2026-09-02', '2026-09-03']).toString(), 'novo', 'compras a até 3 dias contam como uma');
  assert.equal(P.tipoCliente(['2026-09-01', '2026-09-02T10:00:00Z', '2026-09-30'], hoje, cfg).compras, 2);
});
