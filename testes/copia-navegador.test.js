'use strict';
// Cópia dos dados no navegador (dados.js, usoDoCache; 11/11/2026): quando a tela pode abrir com ela e o que vem depois.
const test = require('node:test');
const assert = require('node:assert/strict');
const DD = require('../dados.js');

const HORA = 3600000;
const agora = Date.UTC(2026, 10, 11, 12, 0, 0);
const copia = (o = {}) => Object.assign({ formato: DD.CACHE_FORMATO, user_id: 'u1', papel: 'vendedor', versao: 'abc', salvoEm: agora - HORA, D: DD.vazio() }, o);
const quem = (o = {}) => Object.assign({ userId: 'u1', papel: 'vendedor', versao: 'abc', agora }, o);

test('mesma pessoa, mesmo papel, mesma versão, cópia recente: abre com ela e traz só o que mudou', () => {
  assert.equal(DD.usoDoCache(copia(), quem()), 'leve');
});

test('sem cópia, ou de outra pessoa, ou de outro papel: não usa', () => {
  assert.equal(DD.usoDoCache(null, quem()), null);
  assert.equal(DD.usoDoCache(undefined, quem()), null);
  assert.equal(DD.usoDoCache(copia({ user_id: 'u2' }), quem()), null, 'outra pessoa entrou neste navegador');
  assert.equal(DD.usoDoCache(copia({ papel: 'admin' }), quem()), null, 'papel mudou: a cópia pode ter o que ela não vê mais');
  assert.equal(DD.usoDoCache(copia({ user_id: '' }), quem({ userId: '' })), null);
});

test('formato antigo ou cópia sem alguma tabela: não usa', () => {
  assert.equal(DD.usoDoCache(copia({ formato: DD.CACHE_FORMATO - 1 }), quem()), null);
  const D = DD.vazio(); delete D.nota_itens;
  assert.equal(DD.usoDoCache(copia({ D }), quem()), null);
  assert.equal(DD.usoDoCache(copia({ D: null }), quem()), null);
});

test('cópia velha (mais de 12 h) ou de outra versão do CRM: abre com ela, mas relê tudo', () => {
  assert.equal(DD.usoDoCache(copia({ salvoEm: agora - 13 * HORA }), quem()), 'completa');
  assert.equal(DD.usoDoCache(copia({ salvoEm: agora - DD.CACHE_VELHO }), quem()), 'leve', 'no limite ainda vale');
  assert.equal(DD.usoDoCache(copia({ versao: 'velha' }), quem()), 'completa', 'versão nova pode ter coluna nova');
});

test('relógio do computador para trás (cópia "do futuro") ou sem data: não usa', () => {
  assert.equal(DD.usoDoCache(copia({ salvoEm: agora + HORA }), quem()), null);
  assert.equal(DD.usoDoCache(copia({ salvoEm: undefined }), quem()), 'completa', 'sem data = velhíssima: relê tudo');
});

test('fora do navegador (sem IndexedDB): ler devolve null e gravar/apagar não quebram', async () => {
  assert.equal(await DD.cache.ler('x'), null);
  assert.equal(await DD.cache.gravar('x', copia()), false);
  assert.equal(await DD.cache.apagar('x'), false);
});
