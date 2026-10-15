'use strict';
// Fiscal (Fase 1 da saída do FKN): leitura da tributação no XML (nfe.js) e regra/verificações (fiscal.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../nfe.js');
const F = require('../fiscal.js');

const chave = '35261012345678000199550010000012341000012345';
const XML = '<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe versao="4.00" Id="NFe' + chave + '">' +
  '<ide><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-10-15T10:00:00-03:00</dhEmi><tpNF>1</tpNF><finNFe>1</finNFe><natOp>VENDA</natOp></ide>' +
  '<emit><CNPJ>12345678000199</CNPJ><xNome>EMPRESA EXEMPLO</xNome></emit>' +
  '<dest><CNPJ>44555666000199</CNPJ><xNome>CLIENTE EXEMPLO</xNome><enderDest><xLgr>RUA A</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>3548708</cMun><xMun>SAO BERNARDO DO CAMPO</xMun><UF>SP</UF><CEP>09700000</CEP></enderDest>' +
  '<indIEDest>1</indIEDest><IE>635000000111</IE></dest>' +
  '<det nItem="1"><prod><cProd>300005</cProd><cEAN>7891234567895</cEAN><xProd>PAPEL HIGIENICO ROLAO</xProd><NCM>48182000</NCM><CFOP>5102</CFOP><uCom>FD</uCom><qCom>2</qCom><vUnCom>50</vUnCom><vProd>100.00</vProd></prod>' +
  '<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS00></ICMS>' +
  '<PIS><PISAliq><CST>01</CST><vBC>82.00</vBC><pPIS>1.65</pPIS><vPIS>1.35</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vBC>82.00</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>6.23</vCOFINS></COFINSAliq></COFINS></imposto></det>' +
  '<det nItem="2"><prod><cProd>010001</cProd><cEAN>SEM GTIN</cEAN><xProd>DETERGENTE 5L</xProd><NCM>34022000</NCM><CEST>1100100</CEST><CFOP>5405</CFOP><uCom>GL</uCom><qCom>1</qCom><vUnCom>30</vUnCom><vProd>30.00</vProd></prod>' +
  '<imposto><ICMS><ICMS60><orig>0</orig><CST>60</CST><vBCSTRet>28.00</vBCSTRet><vICMSSTRet>2.10</vICMSSTRet></ICMS60></ICMS><PIS><PISNT><CST>06</CST></PISNT></PIS><COFINS><COFINSNT><CST>06</CST></COFINSNT></COFINS></imposto></det>' +
  '<total><ICMSTot><vProd>130.00</vProd><vNF>130.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>' + chave + '</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>';

test('leitor do XML: tributação de cada item e dados fiscais do destinatário', () => {
  const d = N.lerXml(XML);
  assert.deepEqual([d.cliente.ie, d.cliente.ind_ie, d.cliente.cmun], ['635000000111', '1', '3548708']);
  const [a, b] = d.itens.map(i => i.fiscal);
  assert.deepEqual([a.gtin, a.origem, a.cst_icms, a.aliq_icms, a.v_icms, a.cst_pis, a.aliq_pis, a.cst_cofins, a.aliq_cofins], ['7891234567895', '0', '00', 18, 18, '01', 1.65, '01', 7.6]);
  assert.deepEqual([b.gtin, b.cest, b.cst_icms, b.v_st_ret, b.aliq_icms, b.cst_pis, b.aliq_pis], [null, '1100100', '60', 2.1, null, '06', null], 'SEM GTIN vira nulo; PISNT sem alíquota');
  const lote = N.loteFiscal([d]);
  assert.equal(lote.length, 1);
  assert.deepEqual(Object.keys(lote[0]), ['chave', 'dest', 'itens']);
  assert.deepEqual([lote[0].itens[0].ordem, lote[0].itens[0].codigo, lote[0].itens[0].cfop, lote[0].itens[0].cst_icms], [1, '300005', '5102', '00']);
  // o planejador não manda a tributação para crm_nota_itens
  const pl = N.planeja({ empresas: [], produtos: [], opcoes: [], usuarios: [], contatos: [], notas: [] }, [d], { filtro: 'todas', cadastrarProdutos: false });
  assert.ok(pl.criar.nota_itens.length === 2 && pl.criar.nota_itens.every(i => !('fiscal' in i)));
});

const combo = (o) => Object.assign({ cfop: '5102', cst_icms: '00', aliq_icms: 18, red_bc_icms: null, cst_pis: '01', aliq_pis: 1.65, cst_cofins: '01', aliq_cofins: 7.6, n: 1, ultima: '2026-10-01', primeira: '2026-01-01' }, o);

test('verificações: papel higiênico (NCM e PIS/COFINS) corrigidos na proposta', () => {
  const r = F.analisa({ codigo: '300005', descricao: 'PAPEL HIGIENICO ROLAO LUXO POP', unidade: 'FD', notas: 1069,
    ncms: { 48181000: { n: 378, primeira: '2025-12-15', ultima: '2026-04-15' }, 48182000: { n: 691, primeira: '2026-04-23', ultima: '2026-10-14' } },
    cests: [], gtins: [], origens: ['0'], combos: [combo({ n: 691, ultima: '2026-10-14' })] });
  assert.equal(r.ncm, '48181000');
  assert.deepEqual([r.regra.venda.cst_pis, r.regra.venda.aliq_pis, r.regra.venda.cst_cofins, r.regra.venda.aliq_cofins], ['06', 0, '06', 0]);
  const textos = r.alertas.map(a => a.nivel + ': ' + a.texto).join('\n');
  assert.match(textos, /atencao: O NCM mudou no histórico: 4818\.10\.00 \(15\/12\/2025 a 15\/04\/2026, 378 vez\(es\)\) → 4818\.20\.00/);
  assert.match(textos, /erro: Papel higiênico é NCM 4818\.10\.00/);
  assert.match(textos, /alíquota zero \(Lei 10\.925\/2004, art\. 1º, XXVIII\)/);
  assert.equal(r.alertas.filter(a => a.corrigido).length, 2);
});

test('verificações: ST, CEST, Lucro Real, toalha com NCM de papel higiênico e produto sem problema', () => {
  let r = F.analisa({ codigo: 'A', descricao: 'DETERGENTE 5L', ncms: { 34022000: { n: 3, ultima: '2026-10-01' } }, cests: [], gtins: [], origens: ['0'],
    combos: [combo({ cfop: '5405', cst_icms: '00' })] });
  assert.deepEqual(r.alertas.map(a => a.nivel), ['erro', 'erro'], 'CST errado para ST e sem CEST');
  r = F.analisa({ codigo: 'B', descricao: 'ALCOOL 70', ncms: { 22071090: { n: 3, ultima: '2026-10-01' } }, cests: [], gtins: [], origens: ['0'],
    combos: [combo({ cst_icms: '60' })] });
  assert.match(r.alertas[0].texto, /o CFOP certo seria 5405/);
  r = F.analisa({ codigo: 'C', descricao: 'LUVA', ncms: { 40151900: { n: 3, ultima: '2026-10-01' } }, cests: [], gtins: [], origens: ['0'],
    combos: [combo({ aliq_pis: 0.65, aliq_cofins: 3 })] });
  assert.match(r.alertas[0].texto, /no Lucro Real \(não cumulativo\) é 1,65% e 7,6%/);
  assert.deepEqual([r.regra.venda.aliq_pis, r.regra.venda.aliq_cofins], [1.65, 7.6]);
  r = F.analisa({ codigo: 'D', descricao: 'TOALHA BOB.BCO.6X20X200', ncms: { 48181000: { n: 8, ultima: '2026-08-19' } }, cests: [], gtins: [], origens: ['0'], combos: [combo({ cst_pis: '06', aliq_pis: null, cst_cofins: '06', aliq_cofins: null })] });
  assert.match(r.alertas.map(a => a.texto).join(' '), /Toalha com o NCM do papel higiênico/);
  r = F.analisa({ codigo: 'E', descricao: 'SACO P/ LIXO 100L', ncms: { 39232190: { n: 50, ultima: '2026-10-10' } }, cests: ['1006100'], gtins: ['7890000000000'], origens: ['0'],
    combos: [combo({ cfop: '5405', cst_icms: '60', aliq_icms: null, n: 40, ultima: '2026-10-10' }), combo({ cfop: '5405', cst_icms: '60', aliq_icms: null, n: 10, ultima: '2026-03-01' })] });
  assert.deepEqual(r.alertas, [], 'sem problema, sem alerta');
  assert.deepEqual([r.regra.venda.cfop, r.cest, r.gtin], ['5405', '1006100', '7890000000000']);
});

test('clientes: o que falta para emitir a nota', () => {
  const empresas = [
    { id: 'a', cnpj: '44.555.666/0001-99', ind_ie: '1', ie: '635000000111', codigo_municipio: '3548708', logradouro: 'RUA A', numero: '10', cep: '09700000' },
    { id: 'b', cnpj: '44.555.666/0002-70', ind_ie: '1', ie: '', codigo_municipio: '', logradouro: 'RUA B', numero: '1', cep: '09700000' },
    { id: 'c', cnpj: '', ind_ie: '9', ie: '123', codigo_municipio: '3548708', logradouro: '', numero: '', cep: '' },
    { id: 'd', cnpj: '44.555.666/0003-50' }];
  const r = F.clientes(empresas, new Set(['a', 'b', 'c']));
  assert.deepEqual([r.total, r.completos], [3, 1]);
  assert.deepEqual(r.faltando.map(x => x.falta), [['IE (é contribuinte)', 'código do município'], ['CNPJ/CPF', 'tem IE mas está como não contribuinte', 'endereço']]);
});
