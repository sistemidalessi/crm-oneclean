'use strict';
// Leads sugeridos (01/11/2026): mensagem pronta, contatos (IA primeiro, Receita marcada) e formatos. Dados inventados.
const test = require('node:test');
const assert = require('node:assert');
const L = require('../leads.js');

test('telefone e celular', () => {
  assert.strictEqual(L.foneBR('1140000001'), '(11) 4000-0001');
  assert.strictEqual(L.foneBR('5511940000001'), '(11) 94000-0001');
  assert.strictEqual(L.celular('11940000001'), '11940000001');
  assert.strictEqual(L.celular('1140000001'), null);
  assert.strictEqual(L.cnpjBR('00000000000191'), '00.000.000/0001-91');
});

test('contatos: o da IA vem antes e o da Receita fica marcado; repetido não entra duas vezes', () => {
  const c = L.contatos({ tel1: '1140000001', email: 'contador@exemplo.com.br',
    contato: { telefone: '(11) 4000-0001', whatsapp: '11940000002', email: 'compras@exemplo.com.br', site: 'https://exemplo.com.br', fonte_telefone: 'site da empresa' } });
  assert.deepStrictEqual(c.map(x => x.tipo), ['whatsapp', 'telefone', 'email', 'email', 'site']);
  assert.strictEqual(c[1].alerta, false);                      // o mesmo número da Receita não repete
  assert.strictEqual(c[3].valor, 'contador@exemplo.com.br');
  assert.strictEqual(c[3].alerta, true);
  assert.deepStrictEqual(L.contatos({}), []);
});

test('mensagem pelo segmento, com o nome da vendedora e a cidade', () => {
  const m = L.mensagem({ segmento: 'Condomínio', cidade: 'SAO BERNARDO DO CAMPO' }, 'Renata Exemplo', 9);
  assert.match(m, /^Bom dia! Meu nome é Renata, sou da OneClean/);
  assert.match(m, /aqui de São Bernardo/);
  assert.match(m, /condomínio/);
  const t = L.mensagem({ segmento: 'Indústria', cidade: 'DIADEMA' }, 'Alysson', 15);
  assert.match(t, /^Boa tarde! Meu nome é Alysson/);
  assert.match(t, /entrega em Diadema/);
  assert.match(L.mensagem({ segmento: 'Outro', cidade: 'MAUA' }, '', 10), /cotação/);
});

test('nome e idade', () => {
  assert.strictEqual(L.nomeDe({ razao: 'LIMPEZA EXEMPLO DE SERVICOS LTDA' }), 'Limpeza Exemplo de Servicos LTDA');
  assert.strictEqual(L.nomeDe({ fantasia: 'BRILHO TOTAL', razao: 'X' }), 'Brilho Total');
  assert.strictEqual(L.idade('2026-07-01', '2026-11-03'), 'aberta há 4 meses');
  assert.strictEqual(L.idade('2026-10-20', '2026-11-03'), 'aberta há 14 dias');
  assert.strictEqual(L.idade('2020-01-01', '2026-11-03'), 'aberta há 6 anos');
  assert.strictEqual(L.cidadeBonita('SAO CAETANO DO SUL'), 'São Caetano do Sul');
});

test('leitor do CSV da Receita (aspas, ";" dentro do campo, aspas dobradas)', () => {
  const { campos } = require('../ferramentas/prospeccao-receita.js');
  assert.deepStrictEqual(campos('"123";"A;B";"diz ""oi""";""'), ['123', 'A;B', 'diz "oi"', '']);
  assert.deepStrictEqual(campos('"1";"2"'), ['1', '2']);
});
