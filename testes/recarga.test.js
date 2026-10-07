'use strict';
// Recarga leve (dados.js: aplicaMudancas, marcaRecarga) — 07/10/2026, limite de tráfego do Supabase.
const test = require('node:test');
const assert = require('node:assert/strict');
const DD = require('../dados.js');

test('a recarga leve dá o mesmo resultado de uma carga completa', () => {
  const D = { empresas: [{ id: 'a', nome: 'A', atualizado_em: '2026-10-07T10:00:00+00:00' }, { id: 'b', nome: 'B', atualizado_em: '2026-10-07T11:00:00+00:00' }],
    nota_itens: [{ id: 'i1', atualizado_em: '2026-10-07T09:00:00+00:00' }], usuarios: [{ user_id: 'u1', nome: 'Ana' }], titulos: [{ id: 't1', duplicata: '1/1' }] };
  assert.equal(DD.marcaRecarga(D), '2026-10-07T10:58:00.000Z', 'mais nova menos 2 minutos');
  // B mudou, C nasceu, um título saiu da listagem (inteira), usuário novo
  let r = { inteiras: { usuarios: [{ user_id: 'u1', nome: 'Ana' }, { user_id: 'u2', nome: 'Bia' }], titulos: [] },
    mudadas: { empresas: [{ id: 'b', nome: 'B2', atualizado_em: '2026-10-07T12:00:00+00:00' }, { id: 'c', nome: 'C', atualizado_em: '2026-10-07T12:01:00+00:00' }], nota_itens: [] }, existentes: null };
  assert.equal(DD.aplicaMudancas(D, r), 2);
  assert.deepEqual(D.empresas.map(e => e.id + ':' + e.nome), ['a:A', 'b:B2', 'c:C']);
  assert.deepEqual([D.usuarios.length, D.titulos.length], [2, 0]);
  // conferência de apagados: A foi apagada em outro computador
  r = { inteiras: {}, mudadas: { empresas: [], nota_itens: [] }, existentes: { empresas: ['b', 'c'], nota_itens: ['i1'] } };
  assert.equal(DD.aplicaMudancas(D, r), 1);
  assert.deepEqual(D.empresas.map(e => e.id), ['b', 'c']);
  assert.equal(D.nota_itens.length, 1);
  assert.ok(DD.INTEIRAS.includes('titulos') && DD.PARCIAIS.includes('nota_itens') && !DD.PARCIAIS.includes('titulos'));
});
