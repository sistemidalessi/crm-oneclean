// Comparação mensal com os concorrentes (concorrentes.js): preço por unidade de comparação, diferença com a nossa
// tabela, variação sobre o mês anterior e a sugestão de cesta.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../concorrentes.js');

test('concorrentes: preço por unidade de comparação, diferença e mês anterior', () => {
  const cesta = [{ codigo: '300005', unidade_comp: 'metro', fator: 2400, ordem: 1 }, { codigo: '200110', unidade_comp: 'litro', fator: 5, ordem: 2 }, { codigo: '999', ativo: false }];
  const estoque = [{ codigo: '300005.0', descricao: 'PAPEL HIGIENICO ROLAO 8X300M', unidade: 'FD', preco_venda: 96, custo_compra: 60 },
    { codigo: '200110', descricao: 'DETERGENTE 5L', unidade: 'GL', preco_venda: 30 }];
  const concorrentes = [{ id: 1, nome: 'A', ordem: 1 }, { id: 2, nome: 'B', ordem: 2 }, { id: 3, nome: 'C', ativo: false }];
  const precos = [
    { mes: '2026-10-01', concorrente_id: 1, codigo: '300005', preco: 30, quantidade: 600 },   // R$ 0,05/m × nosso 0,04 → +25%
    { mes: '2026-10-01', concorrente_id: 2, codigo: '300005', preco: 28.8, quantidade: 900 }, // R$ 0,032/m → −20%
    { mes: '2026-09-01', concorrente_id: 1, codigo: '300005', preco: 27, quantidade: 600 },   // mês passado 0,045
    { mes: '2026-10-01', concorrente_id: 1, codigo: '200110', preco: 30, quantidade: 5 }       // igual
  ];
  const r = C.comparar({ cesta, estoque, precos, concorrentes, mes: '2026-10-01' });
  assert.equal(r.linhas.length, 2, 'fora da cesta não entra');
  const p = r.linhas[0];
  assert.equal(p.nosso, 0.04); assert.equal(p.custo, 0.025);
  assert.equal(Math.round(p.conc[1].dif), 25); assert.equal(Math.round(p.conc[2].dif), -20);
  assert.equal(Math.round(p.conc[1].variacao * 10) / 10, 11.1);
  assert.equal(p.maisBarato, 2);
  assert.equal(r.linhas[1].maisBarato, null, 'igual ao nosso não é mais barato');
  assert.equal(r.linhas[1].conc[2], null);
  assert.equal(r.faltam, 1); assert.equal(r.total, 4);
  assert.deepEqual([r.resumo[1].lancados, r.resumo[2].maisBaratos], [2, 1]);
  assert.equal(Math.round(r.resumo[1].difMedia * 10) / 10, 12.5);
  assert.equal(C.mesAntes('2026-01-01'), '2025-12-01');
});

test('concorrentes: sugestão de cesta pela curva A', () => {
  const l = C.sugerirCesta([{ codigo: '1', classe: 'A', saldo: 3, precoVenda: 10, valor12: 50, unidade: 'FD' }, { codigo: '2', classe: 'B', saldo: 3, precoVenda: 10, valor12: 90 },
    { codigo: '3', classe: 'A', saldo: 1, precoVenda: 5, valor12: 80 }, { codigo: '4', classe: 'A', saldo: 1, precoVenda: null, valor12: 99 }], 20);
  assert.deepEqual(l.map(x => x.codigo), ['3', '1']);
  assert.equal(l[1].unidade_comp, 'FD');
});
