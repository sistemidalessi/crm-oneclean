'use strict';
// Estoque de abertura para o crédito presumido de CBS (07/11/2026): classificação, totais e CSV (cbs-estoque.js), e o
// PIS/COFINS do fornecedor gravado no item da nota de compra (estoque.js compraDoXml).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../cbs-estoque.js');
const N = require('../nfe.js');
const S = require('../estoque.js');

test('classificação: o CST da compra manda; depois o NCM; depois a venda', () => {
  const g = l => C.classifica(l).grupo;
  assert.equal(g({ saldo: 10, pis_cst: '01', ncm: '34022000' }), 'credito', 'compra tributada normal: Lucro Real já teve o crédito');
  assert.equal(g({ saldo: 10, pis_cst: '04', ncm: '33074900' }), 'presumido', 'monofásico comprado de distribuidor (CST 04)');
  assert.equal(g({ saldo: 10, pis_cst: '02', ncm: '33074900' }), 'presumido', 'monofásico comprado do fabricante (CST 02)');
  assert.equal(g({ saldo: 10, pis_cst: '05', ncm: '24022000' }), 'presumido', 'substituição tributária de PIS/COFINS');
  assert.equal(g({ saldo: 10, pis_cst: '06', ncm: '48181000' }), 'zero', 'alíquota zero na compra');
  assert.equal(g({ saldo: 10, pis_cst: '01', ncm: '33074900' }), 'conferir', 'NCM monofásico com CST 01 do fornecedor: sinais não batem');
  assert.equal(g({ saldo: 10, pis_cst: '49', ncm: '34022000' }), 'conferir', 'bonificação/remessa não diz nada da compra');
  assert.equal(g({ saldo: 10, ncm: '33074900' }), 'presumido', 'sem compra no CRM: o NCM da Lei 10.147 decide');
  assert.equal(C.classifica({ saldo: 10, ncm: '33074900' }).como, 'NCM');
  assert.equal(g({ saldo: 10, ncm: '48181000', venda_cst_pis: '01' }), 'zero', 'papel higiênico: alíquota zero, mesmo vendido com 01 por engano');
  assert.equal(g({ saldo: 10, ncm: '34022000', venda_cst_pis: '01' }), 'credito', 'sem compra e vendido com 01: a compra em geral deu crédito');
  assert.equal(g({ saldo: 10, ncm: '34022000', venda_cst_pis: '04' }), 'presumido', 'vendemos como revenda de monofásico');
  assert.equal(g({ saldo: 10, ncm: '34022000' }), 'conferir', 'nada para decidir');
  assert.equal(g({ saldo: -2, pis_cst: '04', ncm: '33074900' }), 'negativo', 'saldo negativo se acerta antes do inventário');
  assert.equal(g({ saldo: 10, pis_cst: '4', ncm: '33074900' }), 'presumido', 'CST sem o zero da frente');
});

test('monofásicos da Lei 10.147: 33.03 a 33.07 (sem 33.06), 3401.11.90, 3401.20.10, 9603.21.00', () => {
  assert.ok(C.ehMonofasico('33074900'), 'odorizante de ambiente');
  assert.ok(C.ehMonofasico('33051000'), 'xampu');
  assert.ok(C.ehMonofasico('34011190'), 'sabonete');
  assert.ok(C.ehMonofasico('96032100'), 'escova de dente');
  assert.ok(!C.ehMonofasico('33061000'), 'dentifrício fica fora (33.06)');
  assert.ok(!C.ehMonofasico('34012090'), 'sabão em outras formas não é 3401.20.10');
  assert.ok(!C.ehMonofasico('96039000'), 'vassoura não é escova de dente');
  assert.ok(!C.ehMonofasico('34022000'), 'detergente');
});

test('totais por grupo, crédito de 9,25% e CSV com os mesmos números', () => {
  const linhas = C.monta([
    { codigo: 'B', descricao: 'AROMATIZANTE', unidade: 'UN', ncm: '33074900', saldo: '10', custo_medio: '4', valor: '40.00', pis_cst: '04', cofins_cst: '04', compra_numero: 12, compra_em: '2026-10-20T10:00:00+00:00', fornecedor: 'FORN X' },
    { codigo: 'A', descricao: 'DETERGENTE', unidade: 'GL', ncm: '34022000', saldo: '5', custo_medio: '20', valor: '100.00', pis_cst: '01', cofins_cst: '01', compra_numero: 13 },
    { codigo: 'C', descricao: 'PAPEL HIGIENICO', unidade: 'FD', ncm: '48181000', saldo: '3', custo_medio: '50', valor: '150.00', venda_cst_pis: '06' },
    { codigo: 'D', descricao: 'LUVA', unidade: 'PC', ncm: null, compra_ncm: '40151900', saldo: '-1', custo_medio: '2', valor: '0' },
    { codigo: 'E', descricao: 'SABONETE', unidade: 'UN', ncm: '34011190', saldo: '100', custo_medio: '1.5', valor: '150.00', pis_cst: '02', compra_numero: 14 }]);
  assert.deepEqual(linhas.map(l => l.codigo), ['B', 'A', 'D', 'C', 'E'], 'ordem alfabética da descrição');
  const r = C.resume(linhas);
  assert.deepEqual([r.grupos.presumido.n, r.grupos.presumido.valor, r.grupos.credito.n, r.grupos.zero.n, r.grupos.negativo.n], [2, 190, 1, 1, 1]);
  assert.equal(r.total, 440, 'saldo negativo não vale');
  assert.equal(r.credito, 17.58, '9,25% de 190 = 17,575 → 17,58');
  assert.equal(r.semCompra, 1, 'papel higiênico sem nota de compra (o negativo não conta)');
  assert.equal(r.semCst, 0);
  const ncm = C.porNcm(linhas);
  assert.deepEqual(ncm.map(x => [x.ncm, x.n, x.valor, x.presumido]), [['33074900', 1, 40, 40], ['34011190', 1, 150, 150], ['34022000', 1, 100, 0], ['48181000', 1, 150, 0]]);
  const f = C.csv(linhas, '2026-12-31');
  assert.equal(f.cabecalho[7], 'Saldo em 31/12/2026');
  assert.equal(f.linhas.length, 5);
  const b = f.linhas[0];
  assert.deepEqual([b[0], b[10], b[11], b[13], b[14], b[15], b[16], b[20]], ['B', 'Crédito presumido', 'CST da compra', 3.7, 12, '20/10/2026', 'FORN X', '04']);
  assert.equal(f.linhas[1][13], '', 'quem não entra não tem crédito na planilha');
  assert.equal(Math.round(f.linhas.reduce((s, l) => s + (l[13] || 0), 0) * 100) / 100, 17.58, 'a soma da planilha é o crédito do quadro');
});

test('nota de compra do XML guarda o CST e a alíquota de PIS/COFINS do fornecedor; pisDosItens completa os antigos', () => {
  const chave = '35261099888777000166550010000045681000045689';
  const xml = '<nfeProc versao="4.00"><NFe><infNFe versao="4.00" Id="NFe' + chave + '"><ide><mod>55</mod><serie>1</serie><nNF>4568</nNF><dhEmi>2026-11-05T09:00:00-03:00</dhEmi><tpNF>1</tpNF><finNFe>1</finNFe><natOp>VENDA</natOp></ide>' +
    '<emit><CNPJ>99888777000166</CNPJ><xNome>FORNECEDOR EXEMPLO LTDA</xNome></emit><dest><CNPJ>12345678000199</CNPJ><xNome>EMPRESA EXEMPLO</xNome></dest>' +
    '<det nItem="1"><prod><cProd>F-30</cProd><cEAN>SEM GTIN</cEAN><xProd>AROMATIZANTE DE AMBIENTE 360ML</xProd><NCM>33074900</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>12</qCom><vUnCom>8</vUnCom><vProd>96.00</vProd></prod>' +
    '<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST></ICMS00></ICMS><PIS><PISNT><CST>04</CST></PISNT></PIS><COFINS><COFINSNT><CST>04</CST></COFINSNT></COFINS></imposto></det>' +
    '<det nItem="2"><prod><cProd>F-20</cProd><cEAN>SEM GTIN</cEAN><xProd>DETERGENTE NEUTRO 5L</xProd><NCM>34022000</NCM><CFOP>5102</CFOP><uCom>GL</uCom><qCom>10</qCom><vUnCom>20</vUnCom><vProd>200.00</vProd></prod>' +
    '<imposto><PIS><PISAliq><CST>01</CST><vBC>200.00</vBC><pPIS>1.65</pPIS><vPIS>3.30</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vBC>200.00</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>15.20</vCOFINS></COFINSAliq></COFINS></imposto></det>' +
    '<total><ICMSTot><vProd>296.00</vProd><vNF>296.00</vNF></ICMSTot></total></infNFe></NFe>' +
    '<protNFe><infProt><chNFe>' + chave + '</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>';
  const d = N.lerXml(xml);
  const { itens } = S.compraDoXml(d, xml, '12345678000199');
  assert.deepEqual([itens[0].pis_cst, itens[0].cofins_cst, itens[0].pis_aliq, itens[1].pis_cst, itens[1].pis_aliq, itens[1].cofins_aliq, itens[1].cofins_valor], ['04', '04', null, '01', 1.65, 7.6, 15.2]);
  const p = C.pisDosItens(d, chave);
  assert.deepEqual(p.map(x => [x.chave, x.ordem, x.pis_cst, x.cofins_cst, x.pis_valor]), [[chave, 1, '04', '04', null], [chave, 2, '01', '01', 3.3]]);
});
