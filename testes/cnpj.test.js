'use strict';
// CNPJ alfanumérico (IN RFB 2.229/2024, NF-e desde 01/07/2026): letras nas 12 primeiras posições, DV numérico.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../regras.js');
const N = require('../nfe.js');

test('documento: normaliza, valida e formata o CNPJ com letras (exemplo da Receita) sem mudar os antigos', () => {
  assert.equal(R.doc('12.abc.345/01de-35'), '12ABC34501DE35');
  assert.equal(R.chaveDoc('12.ABC.345/01DE-35'), '12ABC34501DE35');
  assert.equal(R.cnpjValido('12.ABC.345/01DE-35'), true, 'DV do exemplo oficial');
  assert.equal(R.cnpjValido('12.ABC.345/01DE-36'), false);
  assert.equal(R.formataCNPJ('12abc34501de35'), '12.ABC.345/01DE-35');
  // antigos: o mesmo de antes
  assert.equal(R.chaveDoc('44.555.666/0001-99'), '44555666000199');
  assert.equal(R.chaveDoc('CNPJ: 44.555.666/0001-99'), '44555666000199', 'prefixo cai nos números, como antes');
  assert.equal(R.chaveDoc('123.456.789-09'), '12345678909');
  assert.equal(R.cnpjValido('11.222.333/0001-81'), true);
  assert.equal(R.formataCNPJ('11222333000181'), '11.222.333/0001-81');
  // CPF não tem letra; DV com letra não vale
  assert.equal(R.chaveDoc('123.456.78A-09'), '');
  assert.equal(R.chaveDoc('12ABC34501DE3X'), '');
  // busca pelo CNPJ com letras
  assert.equal(R.casaBusca('ABC345', ['12.ABC.345/01DE-35']), true);
  assert.equal(R.casaBusca('ABD345', ['12.ABC.345/01DE-35']), false);
});

test('duplicados: o mesmo CNPJ com letras é o mesmo cadastro (com e sem pontuação, maiúscula ou minúscula)', () => {
  const D = { empresas: [{ id: 'a', nome: 'X', cnpj: '12.ABC.345/01DE-35' }, { id: 'b', nome: 'Y', cnpj: '12.ABD.345/01DE-35' }] };
  const r = R.achaDuplicados(D, { cnpj: '12abc34501de35' });
  assert.deepEqual(r.map(x => [x.empresa_id, x.campo, x.de_empresa]), [['a', 'CNPJ/CPF', true]]);
});

test('nota com destinatário de CNPJ alfanumérico: guarda as letras', () => {
  const chave = '35261012345678000199550010000012341000012345';
  const xml = '<nfeProc versao="4.00"><NFe><infNFe versao="4.00" Id="NFe' + chave + '"><ide><mod>55</mod><serie>1</serie><nNF>1234</nNF>' +
    '<dhEmi>2026-10-15T10:00:00-03:00</dhEmi><tpNF>1</tpNF><finNFe>1</finNFe><natOp>VENDA</natOp></ide><emit><CNPJ>12345678000199</CNPJ><xNome>EMPRESA EXEMPLO</xNome></emit>' +
    '<dest><CNPJ>12ABC34501DE35</CNPJ><xNome>CLIENTE NOVO</xNome></dest><det nItem="1"><prod><cProd>1</cProd><xProd>ITEM</xProd><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>10</vUnCom><vProd>10.00</vProd></prod></det>' +
    '<total><ICMSTot><vProd>10.00</vProd><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>' + chave + '</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>';
  assert.equal(N.lerXml(xml).cliente.doc, '12ABC34501DE35');
});
