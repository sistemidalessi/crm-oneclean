// Rotas de entrega (21/10/2026): ordem por bairro, links dos mapas, próxima parada, resumo e selo do agradecimento.
const test = require('node:test');
const assert = require('node:assert');
const X = require('../rotas.js');

test('ordem por cidade, bairro e endereço', () => {
  const l = [{ id: 'a', cidade: 'São Paulo', bairro: 'Vila Mariana', endereco: 'Rua B' }, { id: 'b', cidade: 'Santo André', bairro: 'Centro', endereco: 'Rua A' },
    { id: 'c', cidade: 'São Paulo', bairro: 'Água Branca', endereco: 'Rua C' }, { id: 'd', cidade: 'são paulo', bairro: 'vila mariana', endereco: 'Rua A' }];
  assert.deepStrictEqual(X.porBairro(l).map(x => x.id), ['b', 'c', 'd', 'a']);
  assert.deepStrictEqual(l.map(x => x.id), ['a', 'b', 'c', 'd'], 'não mexe na lista original');
});

test('Waze e Google Maps a partir do endereço', () => {
  const m = X.mapas('Rua das Flores, 120 · Centro · São Bernardo do Campo/SP · 09750-000');
  assert.strictEqual(m.waze, 'https://waze.com/ul?q=' + encodeURIComponent('Rua das Flores, 120, Centro, São Bernardo do Campo/SP, 09750-000') + '&navigate=yes');
  assert.match(m.google, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=Rua%20das%20Flores.*&travelmode=driving$/);
  assert.strictEqual(X.mapas(''), null);
});

test('próxima parada e resumo do dia', () => {
  const l = [{ id: '1', ordem: 2, situacao: 'pendente', motorista_id: 'm', liberada: true }, { id: '2', ordem: 1, situacao: 'entregue', motorista_id: 'm', liberada: true, cli_status: 'lido' },
    { id: '3', ordem: 3, situacao: 'problema', motorista_id: 'm', liberada: true, cli_status: 'não manda' }, { id: '4', ordem: 4, situacao: 'pendente' },
    { id: '5', ordem: 5, situacao: 'pendente', motorista_id: 'n', liberada: false }];
  assert.strictEqual(X.proxima(l).id, '1');
  assert.strictEqual(X.proxima([{ id: '9', situacao: 'entregue' }]), null);
  assert.deepStrictEqual(X.resumo(l), { total: 5, entregues: 1, problemas: 1, pendentes: 3, semMotorista: 1, naoMandadas: 1, agradecidos: 1 });
});

test('selo do agradecimento ao cliente', () => {
  assert.strictEqual(X.seloAgradecimento({ situacao: 'pendente' }), null);
  assert.deepStrictEqual(X.seloAgradecimento({ situacao: 'entregue' }), ['agradecimento: aguardando', 'etiqueta']);
  assert.deepStrictEqual(X.seloAgradecimento({ situacao: 'entregue', cli_status: 'não manda', cli_erro: 'venda direta' }), ['sem agradecimento: venda direta', 'etiqueta']);
  assert.deepStrictEqual(X.seloAgradecimento({ situacao: 'entregue', cli_status: 'falhou', cli_erro: 'sem celular' }), ['agradecimento não chegou: sem celular', 'vermelho']);
  assert.deepStrictEqual(X.seloAgradecimento({ situacao: 'entregue', cli_status: 'lido', cli_proximo_em: '2026-10-21T13:00:00Z' }), ['agradecimento lido · quer agendar o próximo pedido', 'verde']);
});

test('subir e descer uma parada', () => {
  const l = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepStrictEqual(X.move(l, 'b', -1), [{ id: 'b', ordem: 1 }, { id: 'a', ordem: 2 }, { id: 'c', ordem: 3 }]);
  assert.deepStrictEqual(X.move(l, 'c', 1), null);
  assert.deepStrictEqual(X.move(l, 'a', -1), null);
});
