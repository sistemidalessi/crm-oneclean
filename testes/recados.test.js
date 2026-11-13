'use strict';
// Recados do Diretor de Vendas (recados.js): só os da pessoa, sem resposta, do mais antigo para o mais novo.
const test = require('node:test');
const assert = require('node:assert');
const R = require('../recados.js');

test('recados pendentes: só os meus e sem resposta, do mais antigo', () => {
  const l = [
    { id: 3, para: 'a', criado_em: '2026-11-13T12:00:00Z' },
    { id: 1, para: 'a', criado_em: '2026-11-13T10:00:00Z' },
    { id: 2, para: 'a', criado_em: '2026-11-13T11:00:00Z', respondido_em: '2026-11-13T11:30:00Z', resposta: 'ok, vou tratar' },
    { id: 4, para: 'b', criado_em: '2026-11-13T09:00:00Z' }
  ];
  assert.deepStrictEqual(R.pendentes(l, 'a').map(r => r.id), [1, 3]);
  assert.deepStrictEqual(R.pendentes(l, 'c'), []);
  assert.deepStrictEqual(R.pendentes(null, 'a'), []);
});
