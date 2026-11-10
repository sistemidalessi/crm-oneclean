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

// 10/11/2026: o e-mail sai pela caixa da própria empresa (limite por hora), e as notas do mesmo cliente vão num e-mail só
test('notas do mesmo cliente vão juntas; lote grande vai só com os XML', () => {
  const agora = Date.parse('2026-11-10T15:00:00Z');
  const nota = (numero, empresa_id, min) => ({ id: 'n' + numero, numero, empresa_id, autorizada_em: new Date(agora - min * 60000).toISOString() });
  const pend = [nota(3001, 'a', 30), nota(3002, 'a', 29), nota(3003, 'b', 20)];
  for (let i = 0; i < 62; i++) pend.push(nota(3100 + i, 'grande', 40 - i * 0.5));
  const g = N.gruposDeEnvio(pend, agora);
  assert.equal(g[0].notas.length, 62);      // o cliente que espera há mais tempo sai primeiro
  assert.equal(g[0].comPdf, false);         // 62 DANFEs não cabem numa chamada: só os XML, e gasta 1 do orçamento
  assert.deepEqual(g[1].notas.map(n => n.numero), [3001, 3002]);
  assert.equal(g[1].comPdf, true);
  assert.deepEqual(g[2].notas.map(n => n.numero), [3003]);
  assert.equal(g.length, 3);
});
test('o cliente só entra quando o lote dele terminou (3 minutos sem nota nova) e a rodada desenha no máximo 6 DANFEs', () => {
  const agora = Date.parse('2026-11-10T15:00:00Z');
  const nota = (numero, empresa_id, min) => ({ id: 'n' + numero, numero, empresa_id, autorizada_em: new Date(agora - min * 60000).toISOString() });
  assert.equal(N.gruposDeEnvio([nota(1, 'a', 10), nota(2, 'a', 1)], agora).length, 0);
  assert.equal(N.gruposDeEnvio([nota(1, 'a', 10), nota(2, 'a', 4)], agora).length, 1);
  // 4 + 4: o segundo cliente fica para a rodada seguinte
  const g = N.gruposDeEnvio([nota(1, 'a', 50), nota(2, 'a', 50), nota(3, 'a', 50), nota(4, 'a', 50), nota(5, 'b', 40), nota(6, 'b', 40), nota(7, 'b', 40), nota(8, 'b', 40)], agora);
  assert.equal(g.length, 1);
  assert.equal(g[0].notas.length, 4);
  // nota sem cliente não se junta com outra
  assert.equal(N.gruposDeEnvio([nota(1, null, 10), nota(2, null, 10)], agora).length, 2);
});
test('assunto, texto e nome do PDF do e-mail com várias notas', () => {
  const notas = [{ numero: 3002, valor: 100, autorizada_em: '2026-11-10T15:00:00Z' }, { numero: 3001, valor: 50.5, autorizada_em: '2026-11-10T14:00:00Z' }];
  assert.equal(N.assuntoGrupo(notas, 'Distribuidora Exemplo'), 'Distribuidora Exemplo · 2 notas fiscais (nº 3.001 a 3.002)');
  const t = N.textoGrupo(notas, { empresa: 'Distribuidora Exemplo', cliente: 'Cliente Exemplo Ltda', comPdf: true, boletos: [{ vencimento: '2026-12-08', valor: 150.5 }] });
  assert.match(t, /Seguem as 2 notas fiscais/);
  assert.match(t, /150,50/);
  assert.ok(t.indexOf('NF 3.001') < t.indexOf('NF 3.002'));
  assert.match(t, /um PDF com as DANFEs e os boletos/);
  const s = N.textoGrupo(notas, { empresa: 'Distribuidora Exemplo', comPdf: false });
  assert.match(s, /As DANFEs seguem com a mercadoria/);
  assert.equal(N.arquivoGrupo(notas, 'Distribuidora Exemplo', true), 'DANFE e boleto Distribuidora Exemplo NF 3001 a 3002.pdf');
  assert.match(N.htmlGrupo(notas, { empresa: 'Distribuidora Exemplo' }), /<p>Olá!<\/p>/);
});
test('nenhuma função manda mais pelo Brevo: todas passam pela crm-enviar-email (caixa da empresa)', () => {
  const fs = require('fs'), path = require('path'), R = path.join(__dirname, '..', 'supabase', 'functions');
  for (const f of ['crm-fiscal', 'crm-cobranca', 'crm-contador', 'crm-email']) {
    const s = fs.readFileSync(path.join(R, f, 'index.ts'), 'utf8');
    assert.doesNotMatch(s, /api\.brevo\.com|BREVO_API_KEY/, f);
    assert.match(s, /crm-enviar-email/, f);
  }
  const e = fs.readFileSync(path.join(R, 'crm-enviar-email', 'index.ts'), 'utf8');
  assert.match(e, /EMAIL_SENHA/);
  assert.doesNotMatch(e, /@oneclean/);   // repositório público: o endereço da caixa fica no banco
});

// 10/11/2026: a medida do produto (saco de lixo "90 x 95 cm") sai ao lado do nome no orçamento e no PDF
test('a medida do produto vai ao lado do nome no documento do orçamento e do pedido', () => {
  const fs = require('fs'), path = require('path'), R = path.join(__dirname, '..');
  const f = fs.readFileSync(path.join(R, 'fichas.js'), 'utf8'), p = fs.readFileSync(path.join(R, 'produtos.js'), 'utf8');
  assert.match(f, /esc\(frase\(it\.descricao\)\) \+ \(medidaDe\(it\.codigo\) \? ' · ' \+ esc\(medidaDe\(it\.codigo\)\)/);
  assert.match(f, /garanteMedidas\(\)\);\n    if \(!ncms\) await garanteNcm\(\);/);   // o PDF espera a medida chegar
  assert.match(p, /CRM\.produtos = \{ medida, garanteMedidas, medidasProntas/);
  assert.match(fs.readFileSync(path.join(R, 'supabase/schema.sql'), 'utf8'), /add column if not exists medida text/);
});

// 10/11/2026: a sessão caiu por outra janela com um formulário aberto (o comprador no meio da entrada de uma nota)
test('sessão encerrada em outra janela: o formulário aberto fica, com o aviso, e o erro diz que a sessão caiu', () => {
  const fs = require('fs'), path = require('path'), R = path.join(__dirname, '..');
  const a = fs.readFileSync(path.join(R, 'app.js'), 'utf8'), d = fs.readFileSync(path.join(R, 'dados.js'), 'utf8');
  assert.match(a, /if \(dlg && E\.eu\) \{ avisaSessaoCaiu\(dlg\); return; \}/);
  assert.match(a, /if \(document\.querySelector\('dialog\[open\]'\)\) return;/);   // o login do dia espera o formulário fechar
  assert.match(d, /permission denied\/i\.test\(m\)\) return raiz\.CRM_SEM_SESSAO \? SEM_SESSAO/);
});

// 10/11/2026 (decisão do Anderson): a tela de login do dia e a do aplicativo instalado não encerram a sessão das outras janelas
test('o login do dia é só a tela: não encerra a sessão; outra pessoa entrando em outra janela recarrega esta', () => {
  const fs = require('fs'), path = require('path');
  const a = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const i = a.indexOf('async function pedeLoginDoDia'), f = a.slice(i, a.indexOf('\n  }', i));
  assert.doesNotMatch(f, /signOut/);
  assert.match(f, /telaLogin\(null,/);
  assert.match(a, /sessao\.user\.id !== E\.eu\.user_id\) \{ location\.reload\(\); return; \}/);
});
