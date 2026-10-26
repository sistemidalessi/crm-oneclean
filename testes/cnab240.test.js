// CNAB 240 de cobrança do Banco do Brasil (26/10/2026): posições conferidas com "Particularidades BB — Leiaute CNAB 240 —
// Agosto/2017". Posições do manual começam em 1; aqui pos(l, de, ate) faz a conta.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../cnab240.js');

const CFG = { convenio: '3804880', carteira: '17', variacao: '19', agencia: '1234-5', conta: '12345-X', multa_pct: 2, juros_mes_pct: 1 };
const EMIT = { razao: 'Empresa de Teste Ltda', cnpj: '12.345.678/0001-99' };
const TIT = [
  { nosso_numero: '38048801000000001', documento: '2-000012/01', id_empresa: '2-000012/01', vencimento: '2026-11-30', emissao: '2026-11-03', valor: 1234.56,
    pagador: { doc: '11.222.333/0001-81', nome: 'Condomínio São José', logradouro: 'Rua das Flores', numero: '100', complemento: 'Bloco B', bairro: 'Centro', cep: '09715-000', cidade: 'São Bernardo do Campo', uf: 'SP' } },
  { nosso_numero: '38048801000000002', documento: '2-000013/01', vencimento: '2026-12-10', emissao: '2026-11-03', valor: 99.9,
    pagador: { doc: '123.456.789-09', nome: 'Maria da Silva', logradouro: 'Av. Brasil', numero: '5', bairro: 'Jardim', cep: '01001000', cidade: 'São Paulo', uf: 'SP' } }
];
const pos = (l, de, ate) => l.slice(de - 1, ate);
const linhas = s => s.split('\r\n').filter(Boolean);

test('remessa: toda linha com 240 posições, CRLF, e a ordem dos registros', () => {
  const s = K.remessa(CFG, EMIT, TIT, { hoje: '2026-11-03', hora: '081500', seq: 7 });
  assert.ok(s.endsWith('\r\n'));
  const L = linhas(s);
  L.forEach(l => assert.equal(l.length, 240));
  assert.deepEqual(L.map(l => l[7] + (l[7] === '3' ? l[13] : '')), ['0', '1', '3P', '3Q', '3R', '3P', '3Q', '3R', '5', '9']);
  assert.ok(L.every(l => /^[\x20-\x7E]+$/.test(l)), 'só ASCII, sem acento');
});

test('remessa: header de arquivo e de lote nas posições do BB', () => {
  const [ha, hl] = linhas(K.remessa(CFG, EMIT, TIT, { hoje: '2026-11-03', hora: '081500', seq: 7, teste: true }));
  assert.equal(pos(ha, 1, 3), '001'); assert.equal(pos(ha, 4, 7), '0000'); assert.equal(pos(ha, 8, 8), '0');
  assert.equal(pos(ha, 18, 18), '2'); assert.equal(pos(ha, 19, 32), '12345678000199');
  assert.equal(pos(ha, 33, 52), '003804880' + '0014' + '17' + '019' + '  ');
  assert.equal(pos(ha, 53, 57), '01234'); assert.equal(pos(ha, 58, 58), '5');
  assert.equal(pos(ha, 59, 70), '000000012345'); assert.equal(pos(ha, 71, 71), 'X');
  assert.equal(pos(ha, 73, 102).trim(), 'EMPRESA DE TESTE LTDA'); assert.equal(pos(ha, 103, 132).trim(), 'BANCO DO BRASIL S.A.');
  assert.equal(pos(ha, 143, 143), '1'); assert.equal(pos(ha, 144, 151), '03112026'); assert.equal(pos(ha, 152, 157), '081500');
  assert.equal(pos(ha, 158, 163), '000007'); assert.equal(pos(ha, 164, 166), '083');
  assert.equal(pos(hl, 4, 7), '0001'); assert.equal(pos(hl, 8, 9), '1R'); assert.equal(pos(hl, 10, 11), '01'); assert.equal(pos(hl, 14, 16), '042');
  assert.equal(pos(hl, 18, 18), '2'); assert.equal(pos(hl, 19, 33), '012345678000199');
  assert.equal(pos(hl, 34, 53), '003804880' + '0014' + '17' + '019' + 'TS', 'teste: TS nas posições 52-53');
  assert.equal(pos(hl, 54, 59), '012345'); assert.equal(pos(hl, 60, 72), '000000012345X');
  assert.equal(pos(hl, 184, 191), '00000007'); assert.equal(pos(hl, 192, 199), '03112026');
  const sem = linhas(K.remessa(CFG, EMIT, TIT, { hoje: '2026-11-03', seq: 7 }))[1];
  assert.equal(pos(sem, 52, 53), '  ', 'produção: brancos');
});

test('remessa: segmentos P, Q e R do primeiro título', () => {
  const L = linhas(K.remessa(CFG, EMIT, TIT, { hoje: '2026-11-03', seq: 7 }));
  const [p, q, r] = L.slice(2, 5);
  assert.equal(pos(p, 9, 13), '00001'); assert.equal(pos(p, 14, 14), 'P'); assert.equal(pos(p, 16, 17), '01');
  assert.equal(pos(p, 18, 23), '012345'); assert.equal(pos(p, 24, 36), '000000012345X');
  assert.equal(pos(p, 38, 57), '38048801000000001   ', 'nosso número de 17 alinhado à esquerda');
  assert.equal(pos(p, 58, 58), '7', 'carteira 17 simples');
  assert.equal(pos(p, 61, 61), '2', 'a empresa emite o boleto');
  assert.equal(pos(p, 63, 77), '2-000012/01    ');
  assert.equal(pos(p, 78, 85), '30112026'); assert.equal(pos(p, 86, 100), '000000000123456');
  assert.equal(pos(p, 101, 105), '00000'); assert.equal(pos(p, 107, 108), '02', 'duplicata mercantil'); assert.equal(pos(p, 109, 109), 'N');
  assert.equal(pos(p, 110, 117), '03112026');
  assert.equal(pos(p, 118, 118), '2', 'juros por taxa mensal'); assert.equal(pos(p, 119, 126), '01122026'); assert.equal(pos(p, 127, 141), '000000000000100');
  assert.equal(pos(p, 142, 142), '0', 'sem desconto');
  assert.equal(pos(p, 196, 220).trim(), '2-000012/01');
  assert.equal(pos(p, 221, 223), '300', 'entrada sem protesto automático');
  assert.equal(pos(p, 228, 229), '09', 'real');
  assert.equal(pos(q, 9, 14), '00002Q'); assert.equal(pos(q, 16, 17), '01');
  assert.equal(pos(q, 18, 33), '2' + '011222333000181');
  assert.equal(pos(q, 34, 73).trim(), 'CONDOMINIO SAO JOSE');
  assert.equal(pos(q, 74, 113).trim(), 'RUA DAS FLORES 100 BLOCO B');
  assert.equal(pos(q, 129, 136), '09715000'); assert.equal(pos(q, 137, 151).trim(), 'SAO BERNARDO DO'); assert.equal(pos(q, 152, 153), 'SP');
  assert.equal(pos(q, 154, 154), '0', 'sem sacador/avalista');
  assert.equal(pos(r, 9, 14), '00003R'); assert.equal(pos(r, 66, 66), '2', 'multa em percentual');
  assert.equal(pos(r, 67, 74), '01122026'); assert.equal(pos(r, 75, 89), '000000000000200');
  const q2 = L[6];
  assert.equal(pos(q2, 18, 33), '1' + '000012345678909', 'CPF');
});

test('remessa: trailers com as quantidades', () => {
  const L = linhas(K.remessa(CFG, EMIT, TIT, { hoje: '2026-11-03', seq: 7 }));
  const tl = L[L.length - 2], ta = L[L.length - 1];
  assert.equal(pos(tl, 1, 8), '00100015'); assert.equal(pos(tl, 18, 23), '000008', 'header + 6 detalhes + trailer');
  assert.equal(pos(ta, 1, 8), '00199999'); assert.equal(pos(ta, 18, 23), '000001'); assert.equal(pos(ta, 24, 29), '000010');
});

test('remessa: sem multa não vai o R; instrução de baixa vai só com o P', () => {
  const L = linhas(K.remessa(Object.assign({}, CFG, { multa_pct: 0, juros_mes_pct: 0 }), EMIT, [TIT[0], { movimento: 'baixa', nosso_numero: '38048801000000009', documento: '2-000001/01', vencimento: '2026-11-20', valor: 10 }], { hoje: '2026-11-03' }));
  assert.deepEqual(L.map(l => l[7] + (l[7] === '3' ? l[13] : '')), ['0', '1', '3P', '3Q', '3P', '5', '9']);
  assert.equal(pos(L[2], 118, 141), '3' + '0'.repeat(23), 'sem juros');
  assert.equal(pos(L[4], 16, 17), '02');
});

test('remessa recusa o que o banco recusaria', () => {
  assert.throws(() => K.remessa(Object.assign({}, CFG, { convenio: '123' }), EMIT, TIT, { hoje: '2026-11-03' }), /convênio/);
  assert.throws(() => K.remessa(CFG, EMIT, [Object.assign({}, TIT[0], { nosso_numero: '12345671000000001' })], { hoje: '2026-11-03' }), /não é deste convênio/);
  assert.throws(() => K.remessa(CFG, EMIT, [Object.assign({}, TIT[0], { pagador: Object.assign({}, TIT[0].pagador, { cep: '0971' }) })], { hoje: '2026-11-03' }), /CEP/);
  assert.throws(() => K.remessa(CFG, EMIT, [Object.assign({}, TIT[0], { emissao: '2026-12-01' })], { hoje: '2026-11-03' }), /emissão depois do vencimento/);
  assert.throws(() => K.remessa(CFG, EMIT, [], { hoje: '2026-11-03' }), /nenhum título/);
  assert.deepEqual(K.falta({}, null), ['convênio (7 dígitos)', 'carteira', 'variação da carteira', 'agência', 'conta', 'emitente (aba Fiscal)']);
});

// retorno de mentira, montado pelas posições do manual (segmentos T e U)
function poe(l, de, v) { return l.slice(0, de - 1) + v + l.slice(de - 1 + v.length); }
function retornoFalso() {
  const b = ' '.repeat(240);
  let ha = poe(poe(poe(poe(b, 1, '00100000'), 33, '003804880'), 143, '2'), 144, '04112026'); ha = poe(ha, 158, '000031');
  let t = poe(poe(poe(b, 1, '00100013'), 9, '00001T'), 16, '06');
  t = poe(t, 38, '38048801000000001   '); t = poe(t, 58, '7'); t = poe(t, 59, '2-000012/01    ');
  t = poe(t, 74, '30112026'); t = poe(t, 82, '000000000123456'); t = poe(t, 106, '2-000012/01'); t = poe(t, 199, '000000000000900'); t = poe(t, 214, '00        ');
  let u = poe(poe(poe(b, 1, '00100013'), 9, '00002U'), 16, '06');
  u = poe(u, 18, '000000000001234'); u = poe(u, 78, '000000000124690'); u = poe(u, 93, '000000000123790'); u = poe(u, 138, '0312202604122026');
  let t2 = poe(poe(poe(b, 1, '00100013'), 9, '00003T'), 16, '03'); t2 = poe(t2, 38, '38048801000000002   '); t2 = poe(t2, 214, '4851      ');
  let u2 = poe(poe(poe(b, 1, '00100013'), 9, '00004U'), 16, '03');
  return [ha, poe(b, 1, '00100011'), t, u, t2, u2, poe(b, 1, '00100015'), poe(b, 1, '00199999')].join('\r\n');
}

test('retorno: liquidação com juros, tarifa e data do crédito; entrada rejeitada com os motivos', () => {
  const r = K.retorno(retornoFalso());
  assert.equal(r.ok, true, r.erros.join('; '));
  assert.equal(r.cabecalho.convenio, '3804880'); assert.equal(r.cabecalho.gerado_em, '2026-11-04'); assert.equal(r.cabecalho.seq, 31);
  assert.equal(r.itens.length, 2);
  const [a, b] = r.itens;
  assert.equal(a.movimento, '06'); assert.equal(a.liquidado, true); assert.equal(a.descricao, 'Liquidação');
  assert.equal(a.nosso_numero, '38048801000000001'); assert.equal(a.documento, '2-000012/01'); assert.equal(a.id_empresa, '2-000012/01');
  assert.equal(a.vencimento, '2026-11-30'); assert.equal(a.valor, 1234.56); assert.equal(a.tarifa, 9);
  assert.equal(a.juros, 12.34); assert.equal(a.pago, 1246.9); assert.equal(a.liquido, 1237.9);
  assert.equal(a.ocorrencia, '2026-12-03'); assert.equal(a.credito, '2026-12-04');
  assert.equal(b.movimento, '03'); assert.equal(b.liquidado, false); assert.deepEqual(b.motivos, ['48', '51']);
});

test('retorno recusa remessa, outro banco e linha cortada', () => {
  const s = K.remessa(CFG, EMIT, TIT, { hoje: '2026-11-03' });
  assert.match(K.retorno(s).erros[0], /remessa/);
  assert.match(K.retorno('341' + ' '.repeat(237)).erros[0], /Banco do Brasil/);
  const cortado = retornoFalso().split('\r\n'); cortado[2] = cortado[2].slice(0, 200);
  const r = K.retorno(cortado.join('\r\n'));
  assert.equal(r.ok, false); assert.match(r.erros.join(' '), /linha 3: 200 posições/);
});
