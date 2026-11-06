// Clientes de mesmo nome (unidades da mesma razão social) separados pelo endereço nas listas de escolha (06/11/2026)
const test = require('node:test');
const assert = require('node:assert');
const R = require('../regras.js');

const E = (id, o) => Object.assign({ id, nome: 'SOCIEDADE BENEFICENTE EXEMPLO (SAO PAULO)' }, o);

test('localEmpresa junta rua e número, bairro e cidade', () => {
  assert.strictEqual(R.localEmpresa({ logradouro: 'RUA DAS ACACIAS', numero: '250', bairro: 'CENTRO', cidade: 'SAO PAULO' }), 'RUA DAS ACACIAS, 250 · CENTRO · SAO PAULO');
  assert.strictEqual(R.localEmpresa({ bairro: 'CENTRO' }), 'CENTRO');
  assert.strictEqual(R.localEmpresa(null), '');
});

test('apelidoDe só devolve o apelido diferente do nome', () => {
  assert.strictEqual(R.apelidoDe({ nome: 'ACME LTDA', apelido: 'Acme ltda' }), '');
  assert.strictEqual(R.apelidoDe({ nome: 'ACME LTDA', apelido: 'Creche Jabaquara' }), 'Creche Jabaquara');
  assert.strictEqual(R.apelidoDe({ nome: 'ACME LTDA' }), '');
});

test('rotulosEmpresas: nome único fica só o nome; repetido ganha o endereço', () => {
  const l = [E('a', { bairro: 'PQ JABAQUARA', cidade: 'SAO PAULO' }), E('b', { bairro: 'AMERICANOPOLIS', cidade: 'SAO PAULO' }), { id: 'c', nome: 'OUTRA LTDA', bairro: 'CENTRO' }];
  const r = R.rotulosEmpresas(l);
  assert.strictEqual(r.get('c'), 'OUTRA LTDA');
  assert.strictEqual(r.get('a'), 'SOCIEDADE BENEFICENTE EXEMPLO (SAO PAULO) · PQ JABAQUARA · SAO PAULO');
  assert.strictEqual(r.get('b'), 'SOCIEDADE BENEFICENTE EXEMPLO (SAO PAULO) · AMERICANOPOLIS · SAO PAULO');
});

test('rotulosEmpresas: mesmo endereço desempata pelo código, depois pelo CNPJ', () => {
  const l = [E('a', { bairro: 'AMERICANOPOLIS', codigo: '2010' }), E('b', { bairro: 'AMERICANOPOLIS', cnpj: '11444777000161' }), E('c', {})];
  const r = R.rotulosEmpresas(l);
  assert.strictEqual(r.get('a'), 'SOCIEDADE BENEFICENTE EXEMPLO (SAO PAULO) · AMERICANOPOLIS · cód. 2010');
  assert.strictEqual(r.get('b'), 'SOCIEDADE BENEFICENTE EXEMPLO (SAO PAULO) · AMERICANOPOLIS · 11.444.777/0001-61');
  assert.strictEqual(r.get('c'), 'SOCIEDADE BENEFICENTE EXEMPLO (SAO PAULO)');
  assert.strictEqual(new Set(r.values()).size, 3);
});

test('rotulosEmpresas com nome · CNPJ (lista do pedido): CNPJ diferente já separa', () => {
  const base = x => x.nome + (x.cnpj ? ' · ' + x.cnpj : '');
  const r = R.rotulosEmpresas([E('a', { cnpj: '1', bairro: 'X' }), E('b', { cnpj: '2', bairro: 'Y' })], base);
  assert.strictEqual(r.get('a'), 'SOCIEDADE BENEFICENTE EXEMPLO (SAO PAULO) · 1');
});

test('busca do alto acha pelo bairro e mostra onde fica', () => {
  const D = { empresas: [E('a', { logradouro: 'RUA A', numero: '10', bairro: 'PQ JABAQUARA', cidade: 'SAO PAULO' })], contatos: [], negocios: [], propostas: [] };
  const r = R.buscaGlobal(D, { porId: { empresas: new Map(), negocios: new Map() } }, 'jabaquara', 6);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].sub, 'RUA A, 10 · PQ JABAQUARA · SAO PAULO');
});
