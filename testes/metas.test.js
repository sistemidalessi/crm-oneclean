'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../metas.js');
const C = require('../caixa-calculo.js');
const util = C.util;

test('dias úteis do mês (sábado, domingo e feriado fora)', () => {
  // novembro/2026: 02 Finados e 20 Consciência Negra caem em dia de semana; 15 é domingo
  assert.strictEqual(M.diasUteis('2026-11', util), 19);
  assert.strictEqual(M.diasUteis('2026-11', util, '2026-11-06'), 4);
});

test('sugestão: faturamento por dia útil com peso maior no mês mais recente, mais o crescimento', () => {
  const v = { meses: { '2026-10': { fat: 22000, novos: 3 }, '2026-09': { fat: 21000, novos: 2 }, '2026-08': { fat: 21000, novos: 1 } } };
  const s = M.sugestao(v, '2026-11', util, 10);
  const du = { o: M.diasUteis('2026-10', util), s: M.diasUteis('2026-09', util), a: M.diasUteis('2026-08', util) };
  const porDia = 0.5 * 22000 / du.o + 0.3 * 21000 / du.s + 0.2 * 21000 / du.a;
  assert.strictEqual(s.valor, Math.round(porDia * 19 * 1.1 / 100) * 100);
  assert.strictEqual(s.novos, 3);                       // média 2 × 1,1 = 2,2 → 3
  assert.strictEqual(s.duMes, 19);
});

test('sugestão: quem começou há pouco não é puxado para baixo pelos meses sem venda', () => {
  const s = M.sugestao({ meses: { '2026-10': { fat: 12000, novos: 7 } } }, '2026-11', util, 0);
  assert.strictEqual(s.valor, Math.round(12000 / M.diasUteis('2026-10', util) * 19 / 100) * 100);
  assert.strictEqual(s.novos, 7);
  assert.strictEqual(M.sugestao({ meses: {} }, '2026-11', util, 8).semHistorico, true);
});

test('mínimo da empresa: custos fixos ÷ o que sobra de cada venda', () => {
  const emp = {
    fixos: [{ categoria: 'Aluguel', valor: 10000 }, { categoria: 'Salários', valor: 20000 }],
    meses: { '2026-10': { fat: 200000 } },
    margem: { '2026-10': { venda: 200000, cmv: 140000, icms: 16000, pis: 2000, cofins: 2000, venda_trib: 200000 } },
    avulsas: { '2026-10': 8000 }, caixa_desde: '2026-10-06'
  };
  const m = M.minimo(emp, ['2026-10'], { comissao_pct: 3 });
  assert.strictEqual(m.margem, 30);
  assert.strictEqual(m.destacado, 10);
  assert.strictEqual(m.impostos, 3);                    // 10% destacado sobre 30% de margem
  assert.strictEqual(m.variaveis, 4);                   // 8.000 ÷ 200.000
  assert.strictEqual(m.contribuicao, 20);               // 30 − 3 − 4 − 3
  assert.strictEqual(m.valor, 150000);                  // 30.000 ÷ 20%
  assert.strictEqual(m.sobra, 50000);
  // o número informado vale mais que o calculado
  assert.strictEqual(M.minimo(emp, ['2026-10'], { impostos_pct: 8, comissao_pct: 3 }).contribuicao, 15);
});

test('acompanhamento: realizado = com nota + sem nota, falta por dia útil e projeção', () => {
  const v = { meses: { '2026-11': { fat: 10000, novos: 2 } }, sem_nota: 2000 };
  const a = M.acompanha(v, { valor: 40000, clientes_novos: 3 }, '2026-11-01', '2026-11-06', util);
  assert.strictEqual(a.realizado, 12000);
  assert.strictEqual(a.pct, 30);
  assert.strictEqual(a.duPassados, 4);
  assert.strictEqual(a.duRestantes, 15);
  assert.strictEqual(a.falta, 28000);
  assert.strictEqual(a.porDia, Math.round(28000 / 15 * 100) / 100);
  assert.strictEqual(a.projecao, 57000);                // 12.000 ÷ 4 × 19
  assert.strictEqual(a.novos, 2); assert.strictEqual(a.metaNovos, 3);
});
