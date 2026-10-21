// DANFE gerada do XML (14/10/2026): leitura dos campos, código de barras da chave e folhas.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../danfe.js');
const { jsPDF } = require('../vendor/jspdf.umd.min.js');

const CHAVE = '35261012345678000199550010000022861000012345';
function xml(n, op) {
  op = op || {};
  const det = Array.from({ length: n }, (_, i) => '<det nItem="' + (i + 1) + '"><prod><cProd>' + (100 + i) + '</cProd><xProd>PRODUTO DE TESTE ' + (i + 1) +
    (i % 3 ? '' : ' COM UMA DESCRIÇÃO BEM COMPRIDA PARA QUEBRAR EM DUAS LINHAS NA COLUNA') + '</xProd><NCM>34022000</NCM><CFOP>5102</CFOP><uCom>UN</uCom>' +
    '<qCom>2.0000</qCom><vUnCom>10.5000</vUnCom><vProd>21.00</vProd></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>21.00</vBC><pICMS>18.00</pICMS><vICMS>3.78</vICMS></ICMS00></ICMS>' +
    '<IPI><IPITrib><pIPI>5.00</pIPI><vIPI>1.05</vIPI></IPITrib></IPI></imposto></det>').join('');
  return '<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe' + CHAVE + '" versao="4.00"><ide><natOp>VENDA</natOp><serie>1</serie><nNF>2286</nNF>' +
    '<dhEmi>2026-09-22T09:12:33-03:00</dhEmi><dhSaiEnt>2026-09-22T10:00:00-03:00</dhSaiEnt><tpNF>1</tpNF><tpAmb>' + (op.homologacao ? 2 : 1) + '</tpAmb></ide>' +
    '<emit><CNPJ>12345678000199</CNPJ><xNome>EMITENTE TESTE LTDA</xNome><enderEmit><xLgr>RUA A</xLgr><nro>1</nro><xBairro>CENTRO</xBairro><xMun>CIDADE</xMun><UF>SP</UF><CEP>09700000</CEP><fone>1140000000</fone></enderEmit><IE>123</IE></emit>' +
    '<dest><CNPJ>98765432000155</CNPJ><xNome>CLIENTE &amp; FILHOS – TESTE</xNome><enderDest><xLgr>AV B</xLgr><nro>2</nro><xBairro>BAIRRO</xBairro><xMun>OUTRA</xMun><UF>SP</UF><CEP>09000000</CEP><fone>11999990000</fone></enderDest></dest>' +
    det + '<total><ICMSTot><vBC>21.00</vBC><vICMS>3.78</vICMS><vProd>' + (21 * n).toFixed(2) + '</vProd><vIPI>1.05</vIPI><vNF>' + (22.05 * n).toFixed(2) + '</vNF></ICMSTot></total>' +
    '<transp><modFrete>1</modFrete><transporta><xNome>TRANSPORTADORA</xNome><CNPJ>11222333000144</CNPJ></transporta><vol><qVol>2</qVol><esp>CX</esp><pesoB>10.5</pesoB></vol><vol><qVol>1</qVol><pesoB>4</pesoB></vol></transp>' +
    '<cobr>' + Array.from({ length: op.dups || 0 }, (_, i) => '<dup><nDup>00' + (i + 1) + '</nDup><dVenc>2026-10-0' + (i + 1) + '</dVenc><vDup>10.00</vDup></dup>').join('') + '</cobr>' +
    '<pag><detPag><tPag>15</tPag><vPag>10</vPag></detPag></pag><infAdic><infCpl>VENDEDOR: TESTE</infCpl></infAdic></infNFe></NFe>' +
    (op.semProtocolo ? '' : '<protNFe><infProt><chNFe>' + CHAVE + '</chNFe><dhRecbto>2026-09-22T09:12:40-03:00</dhRecbto><nProt>135260001234567</nProt><cStat>100</cStat></infProt></protNFe>') + '</nfeProc>';
}

test('lê os campos da DANFE do XML', () => {
  const d = D.ler(xml(2, { dups: 2 }));
  assert.equal(d.chave, CHAVE);
  assert.equal(d.numero, '2286');
  assert.equal(d.protocolo, '135260001234567');
  assert.equal(d.autorizada, true);
  assert.equal(d.destinatario.nome, 'CLIENTE & FILHOS – TESTE');
  assert.equal(d.itens.length, 2);
  assert.deepEqual([d.itens[0].cst, d.itens[0].icms, d.itens[0].aliqIpi], ['000', 3.78, 5]);
  assert.equal(d.duplicatas[1].vencimento, '2026-10-02');
  assert.equal(d.transporte.quantidade, 3, 'soma os volumes');
  assert.equal(d.transporte.pesoBruto, 14.5);
  assert.equal(d.totais.vNF, 44.1);
  assert.equal(D.ler('<xml/>'), null);
  assert.equal(D.ler(xml(1, { semProtocolo: true })).autorizada, false);
  assert.equal(D.chaveFmt(CHAVE).split(' ').length, 11);
  assert.equal(D.numeroNF('2286'), '000.002.286');
});

test('CNPJ / CPF na DANFE: numérico, alfanumérico e CPF', () => {
  assert.equal(D.doc('98765432000155'), '98.765.432/0001-55');
  assert.equal(D.doc('12ABC34501DE35'), '12.ABC.345/01DE-35');
  assert.equal(D.doc('12345678901'), '123.456.789-01');
  assert.equal(D.doc('EX123'), 'EX123');
});

test('código de barras CODE-128C da chave', () => {
  const b = D.code128c(CHAVE);
  // início + 22 pares + verificador = 24 símbolos de 11 módulos, mais a parada (13)
  assert.equal(b.reduce((s, v) => s + v, 0), 24 * 11 + 13);
  assert.equal(b.length, 24 * 6 + 7);
  assert.deepEqual(b.slice(0, 6), [2, 1, 1, 2, 3, 2], 'começa com o Start C');
  // verificador: (105 + soma(i × par)) mod 103 — "0000" dá 105 % 103 = 2 → padrão 222221
  assert.deepEqual(D.code128c('0000').slice(18, 24), [2, 2, 2, 2, 2, 1]);
  assert.throws(() => D.code128c('123'));
});

test('código de barras da chave com letra (CNPJ alfanumérico): conjunto B nas letras, C nos números', () => {
  // decodifica as larguras de volta (pela tabela do próprio CODE-128) para conferir o conteúdo
  const PAD = {};
  for (let v = 0; v <= 99; v++) PAD[D.code128c(String(v).padStart(2, '0')).slice(6, 12).join('')] = v;
  Object.assign(PAD, { '113141': 99, '114131': 100, '211214': 104, '211232': 105 });
  const decodifica = barras => {
    const s = barras.join(''), vals = [];
    for (let i = 0; i + 6 <= s.length - 7; i += 6) vals.push(PAD[s.slice(i, i + 6)]);
    const chk = vals.pop();
    assert.equal(chk, vals.reduce((t, v, i) => t + v * (i || 1), 0) % 103, 'verificador do código');
    let modo = vals[0] === 105 ? 'C' : 'B', out = '';
    vals.slice(1).forEach(v => {
      if (modo === 'C' && v === 100) modo = 'B';
      else if (modo === 'B' && v === 99) modo = 'C';
      else out += modo === 'C' ? String(v).padStart(2, '0') : String.fromCharCode(v + 32);
    });
    return out;
  };
  const chaveA = '352609AB1CD2EF00017055001000000123100000001' + '7'; // CNPJ fictício AB1CD2EF000170
  assert.equal(chaveA.length, 44);
  assert.equal(decodifica(D.code128(chaveA)), chaveA);
  assert.equal(decodifica(D.code128(CHAVE)), CHAVE);
  assert.deepEqual(D.code128(CHAVE), D.code128c(CHAVE), 'chave só com números: o mesmo CODE-128C de sempre');
  assert.ok(D.code128(chaveA).length / 6 < 36, 'C nos trechos de números: bem mais estreito que tudo no B');
  assert.equal(D.chaveFmt(chaveA), '3526 09AB 1CD2 EF00 0170 5500 1000 0001 2310 0000 0017', 'a chave impressa mantém as letras');
  assert.equal(D.chaveFmt(CHAVE).split(' ').length, 11);
});

test('desenha: uma folha para nota pequena, mais folhas quando passa', () => {
  const folhas = (n, op) => { const pdf = new jsPDF({ unit: 'mm', format: 'a4' }); const t = D.desenha(pdf, D.ler(xml(n, op))); assert.equal(pdf.getNumberOfPages(), t); return t; };
  assert.equal(folhas(5, { dups: 3 }), 1);
  assert.ok(folhas(80) >= 2);
  assert.equal(folhas(1, { dups: 20, homologacao: true }), 1, '20 parcelas (mostra 14) e marca d\'água');
});
