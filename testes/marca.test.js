// A marca da Sistemi Dalessi no pé do que sai do CRM (13/11/2026): um texto só (marca.js), cópias iguais nas Edge Functions,
// e na DANFE e no boleto só no espaço livre da folha (fora dos quadros da nota e da área do banco).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const M = require('../marca.js');
globalThis.CRMMarca = M;   // como no navegador: o danfe.js e o boleto.js pegam o texto do marca.js carregado na página
const D = require('../danfe.js');
const B = require('../boleto.js');
const { jsPDF } = require('../vendor/jspdf.umd.min.js');

const raiz = path.join(__dirname, '..');
const lista = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return ['vendor', 'node_modules', '.git', 'docs'].includes(e.name) ? [] : lista(p, ext);
  return ext.test(e.name) ? [p] : [];
});

test('o texto da marca: sem e-mail pessoal e igual em todas as cópias das Edge Functions', () => {
  assert.equal(M.RODAPE, 'Sistemi Dalessi · Sistemas sob Medida · sistemidalessi.com.br · contato@sistemidalessi.com.br');
  const copias = lista(path.join(raiz, 'supabase', 'functions'), /\.(ts|js)$/)
    .map(f => [f, /const RODAPE_MARCA = '([^']*)'/.exec(fs.readFileSync(f, 'utf8'))]).filter(x => x[1]);
  assert.ok(copias.length >= 4, 'crm-fiscal, crm-cobranca, crm-contador e crm-email');
  copias.forEach(([f, m]) => assert.equal(m[1], M.RODAPE, path.relative(raiz, f) + ' ficou diferente do marca.js'));
  // o Gmail pessoal do Anderson nunca sai em material do CRM
  const gmail = new RegExp('afdalessi' + '@' + 'gmail', 'i');
  lista(raiz, /\.(js|ts|html)$/).forEach(f => assert.ok(!gmail.test(fs.readFileSync(f, 'utf8')), path.relative(raiz, f)));
});

// registra onde cada texto foi escrito
function espia(pdf) {
  const ditos = [];
  const orig = pdf.text.bind(pdf);
  pdf.text = (t, x, y, o) => { ditos.push({ t: [].concat(t).join(' '), x, y, pag: pdf.getNumberOfPages() }); return orig(t, x, y, o); };
  return ditos;
}

test('DANFE: a marca vai em toda folha, na margem de baixo (fora dos quadros), e some com rodape vazio', () => {
  const CHAVE = '35261012345678000199550010000022861000012345';
  const det = Array.from({ length: 60 }, (_, i) => '<det nItem="' + (i + 1) + '"><prod><cProd>' + i + '</cProd><xProd>PRODUTO ' + i + '</xProd><NCM>34022000</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>1</vUnCom><vProd>1.00</vProd></prod><imposto></imposto></det>').join('');
  const x = '<nfeProc><NFe><infNFe Id="NFe' + CHAVE + '"><ide><serie>1</serie><nNF>1</nNF><dhEmi>2026-11-13T09:00:00-03:00</dhEmi><tpNF>1</tpNF><tpAmb>1</tpAmb></ide>' +
    '<emit><CNPJ>12345678000199</CNPJ><xNome>EMITENTE TESTE</xNome><enderEmit><xMun>CIDADE</xMun><UF>SP</UF></enderEmit></emit><dest><CNPJ>98765432000155</CNPJ><xNome>CLIENTE TESTE</xNome><enderDest><UF>SP</UF></enderDest></dest>' +
    det + '<total><ICMSTot><vNF>60.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>' + CHAVE + '</chNFe><nProt>1</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>';
  const d = D.ler(x);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const ditos = espia(pdf);
  const folhas = D.desenha(pdf, d);
  assert.ok(folhas >= 2, 'o teste passa por mais de uma folha');
  const marca = ditos.filter(t => t.t.includes('sistemidalessi.com.br'));
  assert.equal(marca.length, folhas, 'uma por folha');
  marca.forEach(t => assert.ok(t.y > 293 && t.y < 297, 'abaixo dos quadros (que acabam em 292 mm): ' + t.y));
  assert.deepEqual(marca.map(t => t.pag), Array.from({ length: folhas }, (_, i) => i + 1));
  // nada mais escrito naquela faixa
  assert.ok(ditos.filter(t => t.y > 292.5 && !t.t.includes('sistemidalessi')).length === 0);
  const sem = new jsPDF({ unit: 'mm', format: 'a4' }), ds = espia(sem);
  D.desenha(sem, d, { rodape: '' });
  assert.equal(ds.filter(t => t.t.includes('sistemidalessi')).length, 0);
});

test('boleto: a marca fica no pé da folha, bem abaixo do código de barras', () => {
  const CFG = { convenio: '3804880', carteira: '17', variacao: '19', agencia: '1234-5', conta: '12345-6' };
  const EMIT = { razao: 'Empresa de Teste Ltda', cnpj: '12345678000199', endereco: { municipio: 'Cidade', uf: 'SP' } };
  const b = B.montar(CFG, EMIT, { valor: 10, vencimento: '2026-11-30', seq: 2000000001 }, { nome: 'Cliente Teste' }, { hoje: '2026-11-13' });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const ditos = espia(pdf);
  const fim = B.desenha(pdf, b, {});
  const marca = ditos.filter(t => t.t.includes('sistemidalessi.com.br'));
  assert.equal(marca.length, 1);
  assert.ok(marca[0].y > fim + 5 && marca[0].y < 297, 'longe da ficha de compensação: ' + marca[0].y + ' (a ficha acaba em ' + fim + ')');
  const sem = new jsPDF({ unit: 'mm', format: 'a4' }), ds = espia(sem);
  B.desenha(sem, b, { rodape: '' });
  assert.equal(ds.filter(t => t.t.includes('sistemidalessi')).length, 0);
});
