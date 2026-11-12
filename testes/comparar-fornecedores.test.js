// Comparar fornecedores (comparar-fornecedores.js): custo líquido de cada cotação para a OneClean (Lucro Real), com os
// créditos de ICMS e de PIS/COFINS. As contas abaixo foram feitas à mão.
const test = require('node:test');
const assert = require('node:assert');
const CF = require('../comparar-fornecedores.js');

const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' esperado ' + b + ', veio ' + a);
const TRIB = { st: false, pisCredito: true };

test('comparar fornecedores: Lucro Real com ICMS de 18%', () => {
  const r = CF.calcular({ regime: 'real', preco: 100, icmsPct: 18 }, TRIB, {});
  perto(r.desembolso, 100);
  perto(r.credIcms, 18);
  perto(r.basePis, 82, 'base sem o ICMS da nota (Lei 14.592/2023)');
  perto(r.credPis, 1.353); perto(r.credCofins, 6.232);
  perto(r.liquido, 74.415);
});

test('comparar fornecedores: Lucro Presumido dá o mesmo resultado que o Real para quem compra', () => {
  const a = CF.calcular({ regime: 'real', preco: 100, icmsPct: 18, ipiPct: 5 }, TRIB, {});
  const b = CF.calcular({ regime: 'presumido', preco: 100, icmsPct: 18, ipiPct: 5 }, TRIB, {});
  perto(a.liquido, b.liquido);
});

test('comparar fornecedores: Simples com e sem o campo de crédito de ICMS', () => {
  const com = CF.calcular({ regime: 'simples', preco: 95, credSNPct: 3.95 }, TRIB, {});
  perto(com.credIcms, 3.7525);
  perto(com.basePis, 91.2475, 'crédito do Simples fora da base (posição conservadora)');
  perto(com.liquido, 95 - 3.7525 - 91.2475 * 0.0925);
  const semTirar = CF.calcular({ regime: 'simples', preco: 95, credSNPct: 3.95 }, TRIB, { tiraCredSNdaBase: false });
  perto(semTirar.basePis, 95);
  const sem = CF.calcular({ regime: 'simples', preco: 95 }, TRIB, {});
  perto(sem.credIcms, 0);
  perto(sem.credPis + sem.credCofins, 95 * 0.0925, 'PIS/COFINS cheio mesmo do Simples (ADI RFB 15/2007)');
  assert.ok(sem.avisos.some(a => /CSOSN 101/.test(a)));
  assert.ok(sem.avisos.some(a => /2027/.test(a)));
});

test('comparar fornecedores: ranking, o "barato" que sai caro e o preço para empatar', () => {
  const r = CF.comparar([{ fornecedor: 'Simples', regime: 'simples', preco: 95, credSNPct: 3.95 }, { fornecedor: 'Real', regime: 'real', preco: 100, icmsPct: 18 }, { fornecedor: 'vazio', preco: '' }], TRIB, {});
  assert.deepEqual(r.lista.map(x => x.fornecedor), ['Real', 'Simples'], 'sem preço fica de fora');
  assert.equal(r.enganoso.fornecedor, 'Simples', 'mais barato na cotação, mais caro de verdade');
  // empate: p × (1 − 0,0395 − 0,0925 × 0,9605) = 74,415
  perto(r.lista[1].empate, 74.415 / (1 - 0.0395 - 0.0925 * 0.9605));
  assert.equal(r.lista[0].empate, null);
  assert.ok(r.lista[1].difPct > 11 && r.lista[1].difPct < 11.5);
});

test('comparar fornecedores: produto com ST na venda não dá crédito de ICMS; ST e IPI fora da base do PIS/COFINS', () => {
  const ST = { st: true, pisCredito: true };
  const r = CF.calcular({ regime: 'real', preco: 100, icmsPct: 18, ipiPct: 10, st: 15, frete: 5, freteIcmsPct: 12 }, ST, {});
  perto(r.desembolso, 100 + 10 + 15 + 5);
  perto(r.credIcms, 0, 'nem da nota nem do frete');
  perto(r.basePis, 100 - 18 + 5 - 0.6, 'sem ST (Tema 1231) e sem IPI; frete sem o ICMS do CT-e');
  const comIpi = CF.calcular({ regime: 'real', preco: 100, icmsPct: 18, ipiPct: 10, st: 15 }, ST, { ipiNaBase: true });
  perto(comIpi.basePis, 92);
  const semSt = CF.calcular({ regime: 'real', preco: 100, icmsPct: 18 }, ST, {});
  assert.ok(semSt.avisos.some(a => /GARE/.test(a)));
  const stIndevida = CF.calcular({ regime: 'real', preco: 100, icmsPct: 18, st: 10 }, TRIB, {});
  assert.ok(stIndevida.avisos.some(a => /não tem ST/.test(a)));
});

test('comparar fornecedores: monofásico sem crédito de PIS/COFINS; base reduzida limita o crédito de ICMS', () => {
  const mono = CF.calcular({ regime: 'real', preco: 100, icmsPct: 18 }, { st: false, pisCredito: false }, {});
  perto(mono.credPis + mono.credCofins, 0);
  const p = CF.produtoPelaVenda({ cst_icms: '20', aliq_icms: 18, red_bc_icms: 61.11, cst_pis: '06' });
  assert.equal(p.st, false); assert.equal(p.pisCredito, false);
  perto(p.limiteIcms, 7.0002);
  const r = CF.calcular({ regime: 'real', preco: 100, icmsPct: 18 }, p, {});
  perto(r.credIcms, 7.0002);
  assert.ok(r.avisos.some(a => /base reduzida/.test(a)));
  assert.equal(CF.produtoPelaVenda({ cst_icms: '60', cst_pis: '01' }).st, true);
  assert.equal(CF.produtoPelaVenda({ cst_icms: '00', cst_pis: '04' }).pisCredito, false);
  assert.ok(CF.produtoPelaVenda({}).conferir.length);
});

test('comparar fornecedores: aproveitamento dos créditos, prazo a valor presente e embalagem', () => {
  const r = CF.calcular({ regime: 'real', preco: 120, qtd: 12, icmsPct: 18, prazo: 60 }, TRIB, { aprovIcms: 50, aprovPis: 100, taxaMes: 2 });
  perto(r.credIcms, 120 * 0.18 * 0.5);
  perto(r.desembolsoVP, 120 / Math.pow(1.02, 2));
  perto(r.un.liquidoVP, (120 / Math.pow(1.02, 2) - 10.8 - 98.4 * 0.0925) / 12);
  perto(r.un.preco, 10);
  const mei = CF.calcular({ regime: 'mei', preco: 50, icmsPct: 18 }, TRIB, {});
  perto(mei.credIcms, 0); perto(mei.basePis, 50);
});

test('comparar fornecedores: número brasileiro e regime pelo CST da nota', () => {
  assert.equal(CF.dec('1.234,56'), 1234.56);
  assert.equal(CF.dec('0,7345'), 0.7345);
  assert.equal(CF.dec('R$ 12'), 12);
  assert.equal(CF.dec(''), 0);
  assert.equal(CF.regimePeloCst('101'), 'simples');
  assert.equal(CF.regimePeloCst('500'), 'simples');
  assert.equal(CF.regimePeloCst('00'), 'real');
  assert.equal(CF.regimePeloCst(null), null);
});
