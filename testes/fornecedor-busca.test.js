'use strict';
// Fornecedor pelo código, nome, nome fantasia e CNPJ (09/11/2026, áudios do comprador: "como no FKN"). Nomes fictícios.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../regras.js');

const L = [
  { codigo: '00061', nome: 'DISTRIBUIDORA EXEMPLO LTDA', fantasia: 'EXEMPLO DISTRIBUICAO', cnpj: '11.222.333/0001-81' },
  { codigo: '00279', nome: 'QUIMICA MODELO IND E COM LTDA', fantasia: 'MODELO', cnpj: '' },
  { codigo: '00300', nome: 'PAPEIS DE TESTE SA', fantasia: null, cnpj: null }
];

test('rótulo: código — nome (fantasia), sem repetir a fantasia igual ao nome', () => {
  assert.equal(R.fornecedorRotulo(L[0]), '00061 — DISTRIBUIDORA EXEMPLO LTDA (EXEMPLO DISTRIBUICAO)');
  assert.equal(R.fornecedorRotulo(L[2]), '00300 — PAPEIS DE TESTE SA');
  assert.equal(R.fornecedorRotulo({ nome: 'X', fantasia: 'x' }), 'X');
});

test('acha pelo código, com ou sem os zeros da frente', () => {
  assert.equal(R.fornecedorAcha('00061', L), L[0]);
  assert.equal(R.fornecedorAcha('61', L), L[0]);
  assert.equal(R.fornecedorAcha('279', L), L[1]);
});

test('acha pelo CNPJ (com ou sem pontuação), pelo nome, pelo nome fantasia e pelo rótulo da lista', () => {
  assert.equal(R.fornecedorAcha('11222333000181', L), L[0]);
  assert.equal(R.fornecedorAcha('11.222.333/0001-81', L), L[0]);
  assert.equal(R.fornecedorAcha('papeis de teste sa', L), L[2]);
  assert.equal(R.fornecedorAcha('Modelo', L), L[1]);
  assert.equal(R.fornecedorAcha(R.fornecedorRotulo(L[0]), L), L[0]);
  assert.equal(R.fornecedorAcha('exemplo', L), L[0], 'pedaço que só um tem');
});

test('não acha quando não existe ou quando o pedaço serve para mais de um', () => {
  assert.equal(R.fornecedorAcha('999', L), null);
  assert.equal(R.fornecedorAcha('LTDA', L), null);
  assert.equal(R.fornecedorAcha('', L), null);
});

test('texto da pesquisa traz código sem zeros, fantasia e CNPJ nos dois formatos', () => {
  const t = R.fornecedorTexto(L[0]);
  for (const s of ['00061', '61', 'EXEMPLO DISTRIBUICAO', '11222333000181', '11.222.333/0001-81']) assert.ok(t.includes(s), s);
});
