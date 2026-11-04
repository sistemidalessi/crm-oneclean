'use strict';
// Desconto em R$ no item e no pedido inteiro (04/11/2026). Dados fictícios.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../pedidos.js');

test('R$ vira o % que dá exatamente esse valor no item', () => {
  const d = P.descontoPct(10, 5, 4.59);
  assert.strictEqual(P.descontoValor({ quantidade: 5, preco: 4.59, desconto: d }), 10);
  assert.strictEqual(P.descontoPct(0, 5, 4.59), 0);
  assert.strictEqual(P.descontoPct(999, 1, 10), 100);
});

test('desconto no pedido inteiro: % em todos ou R$ espalhado, fechando no centavo', () => {
  const itens = [{ quantidade: 5, preco: 4.59, desconto: 3 }, { quantidade: 24, preco: 5.9, desconto: 0 }, { quantidade: 24, preco: 2.55, desconto: 0 }, { quantidade: 6, preco: 16.8, desconto: 0 }];
  const pc = P.descontoGeral(itens, { pct: 5 });
  assert.ok(pc.every(i => i.desconto === 5));
  const v = P.descontoGeral(itens, { valor: 33.33 });
  assert.strictEqual(Math.round(v.reduce((s, i) => s + P.descontoValor(i), 0) * 100) / 100, 33.33);
  assert.strictEqual(itens[0].desconto, 3, 'não muda a lista original');
  assert.throws(() => P.descontoGeral(itens, { valor: 9999 }), /passa do valor/);
  assert.throws(() => P.descontoGeral([], { valor: 1 }), /não tem valor/);
});
