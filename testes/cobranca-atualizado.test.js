'use strict';
// Boleto vencido atualizado (crm-cobranca, 04/11/2026): juros e multa do próprio boleto, ligação ao título e quem recebe.
// Dados fictícios.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../supabase/functions/crm-cobranca/atualizado.js');

const bol = (o) => Object.assign({ valor: 678.35, vencimento: '2026-10-28', juros: { tipo: 2, pct: 2, valor: 0 }, multa: { tipo: 2, pct: 5, valor: 0, data: '2026-10-29' },
  linha: '00190000090380488010600001464171916130000067835', estado: 1, doc: '11222333000181', seu: '2552', limite: '2026-11-27' }, o || {});

test('encargos: multa de 5% e juros de 2% ao mês dia a dia, contados do vencimento', () => {
  const e = A.encargos(bol(), '2026-11-04');
  assert.deepStrictEqual(e, { atrasado: true, dias: 7, multa: 33.92, juros: 3.17, encargos: 37.09, total: 715.44 });
  // no dia do vencimento, nada
  assert.strictEqual(A.encargos(bol(), '2026-10-28').atrasado, false);
});

test('vencido em sábado, domingo ou feriado: paga-se sem encargo no dia útil seguinte', () => {
  const sab = bol({ vencimento: '2026-10-31', multa: { tipo: 2, pct: 5, data: '2026-11-01' } });
  assert.strictEqual(A.vencimentoEfetivo('2026-10-31'), '2026-11-02');
  assert.strictEqual(A.encargos(sab, '2026-11-02').atrasado, false);
  // com o feriado de 02/11 no calendário, ainda vale em 03/11
  const util = d => !['2026-11-02'].includes(d) && ![0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay());
  assert.strictEqual(A.encargos(sab, '2026-11-03', util).atrasado, false);
  const e = A.encargos(sab, '2026-11-04', util);
  assert.strictEqual(e.atrasado, true); assert.strictEqual(e.dias, 4);
});

test('nota pelo "seu número" do boleto do site e do CRM', () => {
  assert.strictEqual(A.notaDoSeuNumero('2552'), 2552);
  assert.strictEqual(A.notaDoSeuNumero('2363-01'), 2363);
  assert.strictEqual(A.notaDoSeuNumero('002862/01'), 2862);
  assert.strictEqual(A.notaDoSeuNumero('00286201'), 2862);
  assert.strictEqual(A.notaDoSeuNumero('ABC'), null);
});

test('liga o boleto a um título só (CNPJ, valor e vencimento; desempate pela nota)', () => {
  const docs = new Map([['e1', '11.222.333/0001-81'], ['e2', '99888777000166']]);
  const tits = [
    { empresa_id: 'e1', duplicata: '002552/01', nota_numero: 2552, valor: 678.35, vencimento: '2026-10-28' },
    { empresa_id: 'e2', duplicata: '002553/01', nota_numero: 2553, valor: 678.35, vencimento: '2026-10-28' }];
  const r = A.casa([bol()], tits, docs);
  assert.strictEqual(r.casados.length, 1); assert.strictEqual(r.casados[0].titulo.duplicata, '002552/01');
  // dois títulos iguais do mesmo cliente: a nota do seu número desempata
  const dois = tits.concat([{ empresa_id: 'e1', duplicata: '002560/01', nota_numero: 2560, valor: 678.35, vencimento: '2026-10-28' }]);
  assert.strictEqual(A.casa([bol()], dois, docs).casados[0].titulo.duplicata, '002552/01');
  assert.strictEqual(A.casa([bol({ seu: '' })], dois, docs).sem.length, 1);
});

test('quem recebe: um envio por cliente; fora o cartório, o combinado, o que já foi e o vencido do prazo-limite', () => {
  const t = (d, o) => Object.assign({ empresa_id: 'e1', duplicata: d, nota_numero: Number(d.slice(0, 6)), valor: 678.35, vencimento: '2026-10-28' }, o || {});
  const casados = [
    { boleto: bol(), titulo: t('002552/01') },
    { boleto: bol({ valor: 100 }), titulo: t('002552/02', { valor: 100 }) },
    { boleto: bol({ estado: 3 }), titulo: t('002400/01', { empresa_id: 'e2' }) },
    { boleto: bol(), titulo: t('002401/01', { empresa_id: 'e3', previsao: '2026-11-10' }) },
    { boleto: bol(), titulo: t('002402/01', { empresa_id: 'e4' }) },
    { boleto: bol({ limite: '2026-11-01' }), titulo: t('002403/01', { empresa_id: 'e5' }) }];
  const r = A.quemRecebeBoleto({ casados, hoje: '2026-11-04', ja: new Set(['e4|002402/01']), pagos: new Set(), semAviso: new Set() });
  assert.strictEqual(r.lista.length, 1);
  assert.strictEqual(r.lista[0].itens.length, 2);
  assert.strictEqual(r.lista[0].original, 778.35);
  assert.deepStrictEqual(r.fora.map(x => x.motivo), ['em cartório', 'data combinada com o cliente', 'passou do prazo-limite do banco (precisa de boleto novo)']);
});

test('texto do WhatsApp e do e-mail, a faixa do PDF e o resumo da rodada', () => {
  const env = { itens: [{ boleto: bol(), titulo: { nota_numero: 2552, duplicata: '002552/01', vencimento: '2026-10-28' }, ...A.encargos(bol(), '2026-11-04') }], original: 678.35, total: 715.44 };
  const p = A.parametrosBoleto({ cliente: 'Maria', vendedora: 'Renata', envio: env, hoje: '2026-11-04' });
  assert.strictEqual(p[2], 'da NF 2552, que venceu em 28/10/2026');
  assert.match(A.textoFinal(A.CORPO_BOLETO('X'), p), /o pagamento da NF 2552, que venceu/);
  assert.strictEqual(p[3], 'R$ 715,44 (original R$ 678,35, com juros e multa até 04/11/2026)');
  assert.match(p[4], /^00190\.00009 03804\.880106/);
  const corpo = A.CORPO_BOLETO('Empresa Exemplo');
  assert.ok(!/cart[oó]rio/i.test(corpo), 'o boleto do 1º dia não fala de cartório');
  const mail = A.textoEmailBoleto(corpo, p, '(11) 99999-0000');
  assert.match(mail, /responder este e-mail ou me chamar no WhatsApp \(11\) 99999-0000/);
  assert.ok(!/Já paguei/.test(mail));
  assert.match(A.faixaPdf(env.itens[0], '2026-11-04'), /pague R\$ 715,44 \(original R\$ 678,35 \+ multa R\$ 33,92 \+ juros R\$ 3,17, 7 dias de atraso\)/);
  const res = A.resumoRodada({ hoje: '2026-11-04', boletos: [{ enviado: true, empresa: 'Cliente A', docs: 'NF 2552', total: 715.44, canais: ['e-mail'] }], avisos: [], fora: [], sem: [], alertas: 0 });
  assert.match(res, /Boletos atualizados enviados: 1 \(R\$ 715,44\)/);
});

test('PDF do boleto atualizado: código de barras refeito confere com o do banco e sai uma página por boleto', () => {
  const { jsPDF } = require('../vendor/jspdf.umd.min.js');
  const B = require('../boleto.js');
  const b = bol({ nosso_numero: '38048801000001464', codigo: '00199161300000678350000003804880100000146417', emissao: '2026-10-01',
    pagador: { nome: 'Cliente Exemplo', endereco: 'Rua Exemplo 100', cidade: 'Diadema', uf: 'SP', cep: '09910170' } });
  const x = { boleto: b, titulo: { duplicata: '002552/01', nota_numero: 2552, vencimento: b.vencimento }, ...A.encargos(b, '2026-11-04') };
  const cfg = { carteira: 17, variacao: 19, agencia: '1234-5', conta: '12345-6' }, emit = { razao: 'Empresa Exemplo Ltda', cnpj: '11222333000181', endereco: { logradouro: 'Rua A', numero: '1', cidade: 'São Paulo', uf: 'SP', cep: '01000000' } };
  const d = A.dadosDoBoleto(B, cfg, emit, x, '2026-11-04');
  assert.strictEqual(d.codigo, b.codigo);
  const buf = A.pdfBoletos(jsPDF, B, { itens: [x, x] }, { cfg, emit, hoje: '2026-11-04', aviso: 'Confira o beneficiário.' });
  const txt = Buffer.from(buf).toString('latin1');
  assert.strictEqual((txt.match(/\/Type \/Page\b/g) || []).length, 2);
  if (process.env.SALVA_PDF) require('fs').writeFileSync(process.env.SALVA_PDF, Buffer.from(buf));
  // código diferente do banco: não sai
  assert.throws(() => A.dadosDoBoleto(B, cfg, emit, Object.assign({}, x, { boleto: Object.assign({}, b, { codigo: '0'.repeat(44) }) }), '2026-11-04'), /não bate/);
});

test('o módulo 11 da função é o mesmo do cobranca.js e o boleto.js monta o código só com ele (como a função carrega)', () => {
  const C = require('../cobranca.js');
  ['0019616130000067835000000380488010000014641', '1234567890123456789012345678901234567890123'].forEach(x => assert.strictEqual(A.mod11(x), C.mod11(x)));
  const codigo = require('fs').readFileSync(require('path').join(__dirname, '..', 'boleto.js'), 'utf8');
  const g = { CRMCobranca: { mod11: A.mod11 } };
  new Function('module', 'require', 'globalThis', 'window', codigo)(undefined, undefined, g, g);
  const B = g.CRMBoleto;
  assert.strictEqual(B.codigoBarras('001', '2026-10-28', 678.35, B.campoLivre('38048801000001464', 17)), '00199161300000678350000003804880100000146417');
});
