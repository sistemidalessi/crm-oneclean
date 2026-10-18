'use strict';
// Notas de compra pela Sefaz (Distribuição de DF-e + Ciência da Operação): mensagens nos esquemas oficiais e leitura
// da resposta (docZip em gzip). Dados fictícios.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync, spawnSync } = require('child_process');
const D = require('../servico-fiscal/dfe.js');

const tem = cmd => spawnSync(cmd, ['--version']).status === 0 || spawnSync(cmd, ['version']).status === 0;
const temFerramentas = tem('xmllint') && tem('openssl');
const ESQ = path.join(__dirname, '..', 'servico-fiscal', 'esquemas');
const CHAVE = '35261011222333000181550010000123451123456780';

test('consulta por NSU e por chave e a ciência passam nos esquemas oficiais', { skip: !temFerramentas && 'sem xmllint/openssl' }, () => {
  const A = require('../servico-fiscal/assinatura.js'), S = require('../servico-fiscal/sefaz.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfe-teste-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=TESTE'], { stdio: 'pipe' });
    const keyPem = fs.readFileSync(path.join(dir, 'k.pem'), 'utf8'), certPem = fs.readFileSync(path.join(dir, 'c.pem'), 'utf8');
    const inf = D.ciencia({ ambiente: 'producao', cnpj: '11.222.333/0001-81', chave: CHAVE, quando: '2026-10-20T11:00:00-03:00' });
    const ev = S.envEvento(1, S.montaEvento(inf.infEvento, A.assinaElemento(inf.infEvento, inf.id, certPem, keyPem)));
    const casos = [[D.msgDist({ ambiente: 'producao', cnpj: '11222333000181', ultNSU: 0 }), 'distDFeInt_v1.01.xsd'],
      [D.msgDist({ ambiente: 'homologacao', cnpj: '11222333000181', ultNSU: 1234 }), 'distDFeInt_v1.01.xsd'],
      [D.msgDist({ ambiente: 'producao', cnpj: '11222333000181', chave: CHAVE }), 'distDFeInt_v1.01.xsd'],
      [ev, 'envConfRecebto_v1.00.xsd']];
    for (const [xml, xsd] of casos) {
      const f = path.join(dir, 'm.xml'); fs.writeFileSync(f, xml);
      const r = spawnSync('xmllint', ['--noout', '--schema', path.join(ESQ, xsd), f]);
      assert.strictEqual(r.status, 0, xsd + ': ' + String(r.stderr));
    }
    assert.strictEqual(inf.id, 'ID210210' + CHAVE + '01');
    assert.match(inf.infEvento, /<cOrgao>91<\/cOrgao>/);
    assert.match(D.msgDist({ ambiente: 'producao', cnpj: '1', ultNSU: 1234 }), /<ultNSU>000000000001234<\/ultNSU>/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const z = x => zlib.gzipSync(Buffer.from(x, 'utf8')).toString('base64');
const RES = '<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>' + CHAVE + '</chNFe><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR &amp; CIA</xNome>' +
  '<IE>111</IE><dhEmi>2026-10-15T09:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>1520.40</vNF><digVal>x</digVal><dhRecbto>2026-10-15T09:00:05-03:00</dhRecbto><nProt>135260000000009</nProt><cSitNFe>1</cSitNFe></resNFe>';
const PROC = '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe' + CHAVE + '" versao="4.00"><ide><cUF>35</cUF><tpNF>1</tpNF><dhEmi>2026-10-15T09:00:00-03:00</dhEmi></ide>' +
  '<emit><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR &amp; CIA</xNome></emit><total><ICMSTot><vProd>1500.00</vProd><vNF>1520.40</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><nProt>135260000000009</nProt></infProt></protNFe></nfeProc>';
const EVT = '<resEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><cOrgao>35</cOrgao><CNPJ>11222333000181</CNPJ><chNFe>' + CHAVE + '</chNFe><dhEvento>2026-10-16T10:00:00-03:00</dhEvento><tpEvento>110111</tpEvento></resEvento>';
const resp = docs => '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult>' +
  '<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><verAplic>1</verAplic><cStat>138</cStat><xMotivo>Documento(s) localizado(s)</xMotivo><dhResp>2026-10-20T11:00:00-03:00</dhResp>' +
  '<ultNSU>000000000000003</ultNSU><maxNSU>000000000000010</maxNSU><loteDistDFeInt>' + docs + '</loteDistDFeInt></retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>';

test('resposta da distribuição: NSU, documentos descompactados e o que cada um é', () => {
  const r = D.leDist(resp('<docZip NSU="000000000000001" schema="resNFe_v1.01.xsd">' + z(RES) + '</docZip><docZip NSU="000000000000002" schema="procNFe_v4.00.xsd">' + z(PROC) + '</docZip>' +
    '<docZip NSU="000000000000003" schema="resEvento_1.01.xsd">' + z(EVT) + '</docZip>'));
  assert.deepStrictEqual([r.cStat, r.ultNSU, r.maxNSU, r.docs.length], [138, 3, 10, 3]);
  const [a, b, c] = r.docs.map(D.resumoDoc);
  assert.deepStrictEqual([a.tipo, a.chave, a.emitente_doc, a.emitente_nome, a.valor, a.situacao, a.nsu], ['resumo', CHAVE, '11222333000181', 'FORNECEDOR & CIA', 1520.4, 'autorizada', 1]);
  assert.deepStrictEqual([b.tipo, b.chave, b.valor, b.emitida_em, !!b.xml], ['nota', CHAVE, 1520.4, '2026-10-15T09:00:00-03:00', true]);
  assert.deepStrictEqual([c.tipo, c.cancelada, c.chave], ['evento', true, CHAVE]);
  const vazio = D.leDist(resp('').replace('<cStat>138</cStat>', '<cStat>137</cStat>'));
  assert.deepStrictEqual([vazio.cStat, vazio.docs.length], [137, 0]);
});
