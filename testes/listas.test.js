'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../listas.js');

test('listas: pesquisa sem acento, várias palavras e números com pontuação', () => {
  assert.ok(L.casa('', ['x']));
  assert.ok(L.casa('sao paulo', ['Colégio São Paulo']));
  assert.ok(L.casa('colegio 2-15', ['Colégio Exemplo', '2-15']));
  assert.ok(!L.casa('colegio padaria', ['Colégio Exemplo']));
  assert.ok(L.casa('11.222.333/0001-81', ['11222333000181']));
  assert.ok(L.casa('11222333', ['11.222.333/0001-81']));
});

test('listas: período e seletor', () => {
  const l = [{ n: 1, d: '2026-10-01T15:00:00Z', s: 'a' }, { n: 2, d: '2026-10-20T15:00:00Z', s: 'b' }, { n: 3, d: null, s: 'a' }];
  const o = { texto: x => [x.n], data: x => x.d, sel: (x, v) => x.s === v };
  assert.deepEqual(L.aplica({ de: '2026-10-10' }, l, o).map(x => x.n), [2]);
  assert.deepEqual(L.aplica({ ate: '2026-10-10' }, l, o).map(x => x.n), [1]);
  assert.deepEqual(L.aplica({ sel: 'a' }, l, o).map(x => x.n), [1, 3]);
  assert.deepEqual(L.aplica({ busca: '2' }, l, o).map(x => x.n), [2]);
  assert.deepEqual(L.aplica({}, l, o).map(x => x.n), [1, 2, 3]);
});

test('filtro nas colunas: cada coluna com filtro tem de casar', () => {
  const linha = ['NF 2861', 'COLEGIO INTELLECTUS LTDA', 'PQ. BRASIL · SÃO PAULO', 'Alysson'];
  assert.equal(L.casaColunas([], linha), true);
  assert.equal(L.casaColunas(['', 'intellectus', 'sao paulo'], linha), true);
  assert.equal(L.casaColunas(['2861', '', 'brasil'], linha), true);
  assert.equal(L.casaColunas(['2862'], linha), false);
  assert.equal(L.casaColunas(['', '', '', 'renata'], linha), false);
});
