'use strict';
// E-mail da nota fiscal ao cliente (crm-fiscal, 04/11/2026): quem recebe, o texto e os anexos. Dados fictícios.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../supabase/functions/crm-fiscal/email-nota.js');

test('o "E-mail para a nota fiscal" vem antes do e-mail da empresa', () => {
  assert.deepEqual(N.destinatarios({ email: 'contato@exemplo.com.br', email_nfe: 'fiscal@exemplo.com.br; Compras@Exemplo.com.br' }),
    { emails: ['fiscal@exemplo.com.br', 'compras@exemplo.com.br'], de: 'email_nfe' });
  assert.deepEqual(N.destinatarios({ email: 'contato@exemplo.com.br', email_nfe: '  ' }), { emails: ['contato@exemplo.com.br'], de: 'email' });
  assert.deepEqual(N.destinatarios({ email: 'sem arroba' }), { emails: [], de: null });
  assert.deepEqual(N.destinatarios(null), { emails: [], de: null });
});
test('separa por ; , e espaço, sem repetir e no máximo 5', () => {
  assert.deepEqual(N.separaEmails('a@x.com, a@x.com;b@x.com c@x.com'), ['a@x.com', 'b@x.com', 'c@x.com']);
  assert.equal(N.destinatarios({ email_nfe: 'a@x.com;b@x.com;c@x.com;d@x.com;e@x.com;f@x.com' }).emails.length, 5);
});
test('assunto, texto e anexos', () => {
  const nfe = { numero: 2871, serie: 1, chave: '35261163237702000103550010000028711000028716', valor: 1234.5, autorizada_em: '2026-11-04T15:00:00Z' };
  assert.equal(N.assunto(nfe, 'Distribuidora Exemplo'), 'Distribuidora Exemplo · Nota fiscal nº 2.871 (série 1)');
  const t = N.texto(nfe, { empresa: 'Distribuidora Exemplo', cliente: 'Padaria Pão Quente', vendedor: 'Bruna' });
  assert.match(t, /nº 2\.871, série 1/);
  assert.match(t, /04\/11\/2026/);
  assert.match(t, /R\$ 1\.234,50/);
  assert.match(t, /3526 1163/);
  assert.match(t, /vai para Bruna/);
  assert.doesNotMatch(N.html(nfe, { empresa: 'A & B' }), /A & B/);
  assert.deepEqual(N.arquivos(nfe, 'Distribuidora Exemplo'), { xml: nfe.chave + '-procNFe.xml', pdf: 'DANFE Distribuidora Exemplo NF 2871.pdf', boleto: 'Boleto Distribuidora Exemplo NF 2871.pdf' });
  assert.doesNotMatch(t, /boleto/i);
});
test('o boleto no texto do e-mail', () => {
  const nfe = { numero: 2871, serie: 1, chave: '35261163237702000103550010000028711000028716', valor: 1234.5 };
  const um = N.texto(nfe, { empresa: 'Distribuidora Exemplo', boletos: [{ vencimento: '2026-12-05', valor: 1234.5 }] });
  assert.match(um, /Também vai o boleto do Banco do Brasil, já registrado no banco: vencimento 05\/12\/2026, R\$ 1\.234,50\./);
  assert.match(um, /Pix do QR Code/);
  const dois = N.texto(nfe, { empresa: 'Distribuidora Exemplo', boletos: [{ vencimento: '2026-12-05', valor: 617.25 }, { vencimento: '2027-01-04', valor: 617.25 }] });
  assert.match(dois, /Também vão os 2 boletos .*05\/12\/2026 \(R\$ 617,25\), 04\/01\/2027 \(R\$ 617,25\)/);
  assert.deepEqual(N.textoBoletos([]), []);
});
test('proporção do PNG pelo cabeçalho', () => {
  const u = new Uint8Array(24); u.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  u.set([0, 0, 1, 144], 16); u.set([0, 0, 0, 100], 20);   // 400 × 100
  assert.equal(N.proporcaoPng(u), 4);
  assert.equal(N.proporcaoPng(new Uint8Array(10)), 0);
});
test('a crm-fiscal manda a nota sozinha uma vez só e tem o botão de mandar de novo', () => {
  const s = require('fs').readFileSync(require('path').join(__dirname, '../supabase/functions/crm-fiscal/index.ts'), 'utf8');
  assert.match(s, /\.is\('email_em', null\)/);
  assert.match(s, /acao === 'email_nota'/);
  assert.match(s, /HASHES\['danfe\.js'\]/);
});

test('a consulta de crédito da equipe usa a mesma política do site, carregada fora do navegador', () => {
  const fs = require('fs'), path = require('path'), R = path.join(__dirname, '..');
  const g = {};
  new Function(fs.readFileSync(path.join(R, 'regras.js'), 'utf8')).call(g);
  new Function('window', 'module', 'require', fs.readFileSync(path.join(R, 'credito.js'), 'utf8'))(g, undefined, undefined);
  assert.equal(typeof g.CRMCredito.propor, 'function');
  assert.equal(typeof g.CRMCredito.daRekta, 'function');
  const p = g.CRMCredito.propor({ score: 800, situacao_cadastral: 'ATIVA' }, { maior_mes: 4000, vencido: 0, hoje: '2026-11-04' });
  assert.equal(p.situacao, 'prazo');
  assert.equal(p.limite, 8000);   // 2 meses de compra: passa do teto automático (R$ 5.000), que a função aplica
  const s = fs.readFileSync(path.join(R, 'supabase/functions/crm-credito-rekta/index.ts'), 'utf8');
  assert.match(s, /c\.acao === 'auto'/);
  assert.match(s, /'credito\.js'/);
  assert.match(s, /só para clientes da sua carteira/);
});
