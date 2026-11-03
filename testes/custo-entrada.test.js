// Custo da entrada longe do custo atual (03/11/2026: fardo de 5 pacotes do papel 290014 entrou como 1; R$ 33,56 no lugar de 6,71).
const test = require('node:test'), assert = require('node:assert');
const S = require('../estoque.js');

test('fatores lidos da descrição do fornecedor', () => {
  assert.deepStrictEqual(S.fatoresDaDescricao('INTERFOLHA 100% CELULOSE ORIGINAL 23X21 C/ 5 PACOTES FS'), [5]);
  assert.deepStrictEqual(S.fatoresDaDescricao('BOBINA AD 30X40 PICOTADA PECA ROLL BAG C/500 SACOS FD C/8 UN'), [8, 500]);
  assert.deepStrictEqual(S.fatoresDaDescricao('PP HIG F.SIMPLES PERSONAL C/4 30MT (15X4)HPS45'), [4, 15, 60]);
  assert.deepStrictEqual(S.fatoresDaDescricao('PANO MICROFIBRA 30X30 (1X10) VERDE'), [10]);
  assert.deepStrictEqual(S.fatoresDaDescricao('DETERGENTE NEUTRO 5LTS'), []);
});

test('fardo de 5 que entrou como 1: avisa e sugere 5', () => {
  const itens = [{ id: 'a', descricao: 'PAPEL TOALHA INTERFOLHA ORIGINAL CELULOSE 500g', quantidade: 60, valor_total: 1950, ipi: 63.38, st: 0, frete: 0, outras: 0 }];
  const r = S.custosSuspeitos(itens, [{ id: 'a', codigo: '290014', fator: '1' }], new Map([['290014', 6.711]]));
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].sugestao, 5);
  assert.match(r[0].texto, /6,71 cada/);
});

test('a descrição decide quando o custo cabe em mais de um número', () => {
  const itens = [{ id: 'b', descricao: 'BOBINA AD 30X40 PICOTADA PECA ROLL BAG C/500 SACOS FD C/8 UN', quantidade: 4, valor_total: 792.36 }];
  const r = S.custosSuspeitos(itens, [{ id: 'b', codigo: '090005', fator: 1 }], new Map([['090005', 24.761]]));
  assert.strictEqual(r[0].sugestao, 8);
});

test('produto errado (mais barato) avisa sem sugerir número', () => {
  const itens = [{ id: 'c', descricao: 'CABO PLASTIF. 60 CM C/R', quantidade: 24, valor_total: 29.76 }];
  const r = S.custosSuspeitos(itens, [{ id: 'c', codigo: '190048', fator: 1 }], new Map([['190048', 25]]));
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].sugestao, null);
  assert.match(r[0].texto, /mesmo produto/);
});

test('preço parecido, sem custo atual ou item fora do estoque: nada', () => {
  const itens = [{ id: 'd', descricao: 'DETERGENTE', quantidade: 10, valor_total: 210 }];
  assert.deepStrictEqual(S.custosSuspeitos(itens, [{ id: 'd', codigo: 'x', fator: 1 }], new Map([['x', 19.99]])), []);
  assert.deepStrictEqual(S.custosSuspeitos(itens, [{ id: 'd', codigo: 'x', fator: 1 }], new Map()), []);
  assert.deepStrictEqual(S.custosSuspeitos(itens, [{ id: 'd', codigo: 'x', fator: 1, ignorar: true }], new Map([['x', 1]])), []);
});
