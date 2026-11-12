// Impostômetro (impostometro.js): ICMS, PIS e COFINS com saldo credor de um mês para o outro, IRPJ/CSLL pela estimativa e
// pelo resultado, DIFAL, INSS do pró-labore, projeção do mês. Contas feitas à mão.
const test = require('node:test');
const assert = require('node:assert');
const I = require('../impostometro.js');
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ' esperado ' + b + ', veio ' + a);

const MES = {
  mes: '2026-10',
  vendas: { receita: 400000, icms: 40000, pis: 6000, cofins: 27600, cmv: 280000, itens: 10 },
  devolucoes: { valor: 10000, icms: 1000, pis: 150, cofins: 690 },
  compras: { cred_icms: 30000, base_pis: 200000, ipi: 500, st: 300, itens: 5, sem_produto: 2, sem_produto_valor: 1000, sem_produto_cred_icms: 100, sem_produto_base_pis: 900 },
  gnre: { difal: 50, fcp: 5 },
  caixa: { tem: true, rendimentos: 100, saidas: { Aluguel: 10000, Energia: 1000, 'Pró-labore': 5000, Salários: 20000, Fornecedores: 250000 } }
};

test('impostômetro: ICMS e PIS/COFINS do mês, com os créditos', () => {
  const r = I.apurar([MES], {}).meses[0];
  perto(r.receita, 390000);
  perto(r.icms.debito, 40000);
  perto(r.icms.credito, 30000 + 100 + 1000, 'compras + sem produto + devoluções');
  perto(r.icms.aPagar, 8900);
  // base do crédito: 200.000 + 900 (sem produto) + 11.000 (aluguel e energia)
  perto(r.pis.credito, 211900 * 0.0165 + 150);
  perto(r.pis.debito, 6000 + 100 * 0.0065, 'rendimento financeiro a 0,65%');
  perto(r.cofins.debito, 27600 + 4);
  perto(r.pis.aPagar, 6000.65 - 3496.35 - 150);
  perto(r.inss, 1000, '20% do pró-labore');
  perto(r.difal, 50); perto(r.fcp, 5);
  perto(r.informativo.cbs, 3510); perto(r.informativo.ibs, 390);
});

test('impostômetro: IRPJ/CSLL pela estimativa (8% e 12% da receita) e pelo resultado', () => {
  const r = I.apurar([MES], {}).meses[0];
  perto(r.estimativa.baseIrpj, 390000 * 0.08 + 100);
  perto(r.estimativa.irpj, 31300 * 0.15 + 11300 * 0.10);
  perto(r.estimativa.csll, (46800 + 100) * 0.09);
  assert.equal(r.forma, 'estimativa');
  perto(r.irpj, r.estimativa.irpj);
  const b = I.apurar([MES], { irpj: 'balancete' }).meses[0];
  assert.equal(b.forma, 'balancete');
  // despesas dedutíveis: aluguel 10.000 + energia 1.000 + pró-labore 5.000 + salários 20.000 + INSS 1.000 + DIFAL 50 + FCP 5
  perto(b.balancete.despesas, 37055);
  const impostos = b.icms.doMes + b.pis.doMes + b.cofins.doMes;
  perto(b.balancete.lucro, 390000 - 280000 - impostos - 37055 + 100);
  perto(b.irpj, I.irpjDe(b.balancete.lucro));
  perto(I.irpjDe(20000), 3000); perto(I.irpjDe(30000), 5500); perto(I.irpjDe(-5), 0);
});

test('impostômetro: saldo credor passa para o mês seguinte e começa no saldo informado', () => {
  const credor = Object.assign({}, MES, { mes: '2026-09', vendas: Object.assign({}, MES.vendas, { icms: 20000 }) });
  const r = I.apurar([MES, credor], { inicio: '2026-09', saldo: { icms: 500 } });
  assert.deepEqual(r.meses.map(x => x.mes), ['2026-09', '2026-10'], 'em ordem');
  const set = r.meses[0], out = r.meses[1];
  perto(set.icms.saldoAnterior, 500);
  perto(set.icms.aPagar, 0);
  perto(set.icms.saldoCredor, 31100 - 20000 + 500);
  perto(out.icms.saldoAnterior, 11600);
  perto(out.icms.aPagar, 40000 - 31100 - 11600 > 0 ? 40000 - 31100 - 11600 : 0);
  perto(out.icms.saldoCredor, 2700);
  perto(r.total.icms, 0);
  perto(r.total.receita, 780000);
});

test('impostômetro: premissas (sem os itens sem produto, sem INSS) e projeção do mês', () => {
  const r = I.apurar([MES], { semProduto: false, inssProLabore: false, creditoPis: [] }).meses[0];
  perto(r.icms.credito, 31000);
  perto(r.pis.partes.base, 200000);
  perto(r.inss, 0);
  assert.ok(r.avisos.some(a => /fora dos créditos/.test(a)));
  const p = I.apurar([MES], {}, { mes: '2026-10', fator: 2 }).meses[0];
  perto(p.receita, 780000);
  perto(p.icms.debito, 80000);
  assert.equal(p.projetado, 2);
  perto(I.fatorRitmo(20, 8), 2.5);
  perto(I.fatorRitmo(20, 0), 1);
});

test('impostômetro: avisos do que ficou de fora', () => {
  const m = Object.assign({}, MES, { compras: Object.assign({}, MES.compras, { nao_lidos: 3, nao_lidos_valor: 1200 }), caixa: { tem: false, saidas: {} },
    vendas: Object.assign({}, MES.vendas, { sem_custo: 2 }) });
  const r = I.apurar([m], {}).meses[0];
  assert.ok(r.avisos.some(a => /ICMS lido/.test(a)));
  assert.ok(r.avisos.some(a => /sem o Caixa/.test(a)));
  assert.ok(r.avisos.some(a => /sem custo/.test(a)));
});
