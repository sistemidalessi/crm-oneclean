'use strict';
// Aviso de atraso ao cliente (crm-cobranca): quem recebe, o texto e os alertas de cartório. Dados fictícios.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../supabase/functions/crm-cobranca/avisos.js');

test('dias úteis de atraso e prazo em dias úteis (sábado e domingo não contam)', () => {
  assert.strictEqual(A.diasUteisAtraso('2026-10-16', '2026-10-19'), 1);   // venceu sexta, hoje segunda
  assert.strictEqual(A.diasUteisAtraso('2026-10-16', '2026-10-23'), 5);
  assert.strictEqual(A.diasUteisAtraso('2026-10-23', '2026-10-23'), 0);
  assert.strictEqual(A.prazoUtil('2026-10-23', 5), '2026-10-30');          // sexta + 5 úteis = sexta seguinte
  assert.strictEqual(A.prazoUtil('2026-10-21', 3), '2026-10-26');
  assert.strictEqual(A.diaLongo('2026-10-30'), 'sexta-feira, 30/10/2026');
});

test('quem recebe: 5 dias úteis de atraso, um aviso por cliente, sem repetir, sem cartório nem data combinada', () => {
  const hoje = '2026-10-23';
  const titulos = [
    { empresa_id: 'A', duplicata: '2428/01', nota_numero: 2428, vencimento: '2026-10-16', valor: 100 },   // 5 úteis: entra
    { empresa_id: 'A', duplicata: '2433/01', nota_numero: 2433, vencimento: '2026-10-10', valor: 50.5 },  // 10 úteis: entra junto
    { empresa_id: 'A', duplicata: '2440/01', nota_numero: 2440, vencimento: '2026-10-20', valor: 30 },    // 3 úteis: ainda não
    { empresa_id: 'B', duplicata: '2400/01', nota_numero: 2400, vencimento: '2026-09-30', valor: 10, cartorio_em: '2026-10-20' },
    { empresa_id: 'C', duplicata: '2401/01', nota_numero: 2401, vencimento: '2026-09-30', valor: 10, previsao: '2026-10-27' },
    { empresa_id: 'D', duplicata: '2402/01', nota_numero: 2402, vencimento: '2026-09-30', valor: 10 },   // já avisado
    { empresa_id: 'E', duplicata: '2403/01', nota_numero: 2403, vencimento: '2026-09-30', valor: 10 },   // disse que pagou
    { empresa_id: null, duplicata: '2404/01', vencimento: '2026-09-30', valor: 10 },
    { empresa_id: 'F', duplicata: '2405/01', nota_numero: 2405, vencimento: '2026-09-30', valor: 10 }    // fora da lista de avisos
  ];
  const r = A.quemRecebe({ titulos, hoje, dias: 5, avisos: [{ empresa_id: 'D', duplicatas: ['2402/01'] }], pagos: new Set(['E|2403/01']), semAviso: new Set(['F']) });
  assert.deepStrictEqual(r.map(x => [x.empresa_id, x.titulos.map(t => t.duplicata), x.valor, x.dias]), [['A', ['2433/01', '2428/01'], 150.5, 13]]);
  // a data combinada que já passou não segura o aviso
  const r2 = A.quemRecebe({ titulos: [Object.assign({}, titulos[4], { previsao: '2026-10-20' })], hoje, dias: 5 });
  assert.strictEqual(r2.length, 1);
});

test('texto do aviso: cordial, com as notas, o valor e o prazo do cartório; e-mail sem os botões', () => {
  const ts = [{ nota_numero: 2433, duplicata: '2433/01', vencimento: '2026-10-10' }, { nota_numero: 2428, duplicata: '2428/01', vencimento: '2026-10-16' }];
  assert.strictEqual(A.docsTexto(ts), 'as NF 2433 e 2428, vencidas em 10/10/2026 e 16/10/2026');
  assert.strictEqual(A.docsTexto([ts[0]]), 'a NF 2433, vencida em 10/10/2026');
  assert.strictEqual(A.docsTexto([ts[0], Object.assign({}, ts[0], { duplicata: '2433/02', vencimento: '2026-11-10' })]), 'a NF 2433, com parcelas vencidas em 10/10/2026 e 10/11/2026');
  const p = A.parametros({ cliente: 'Maria', vendedora: 'Renata', titulos: ts, valor: 1234.5, prazo: '2026-10-30' });
  assert.deepStrictEqual(p, ['Maria', 'Renata', 'as NF 2433 e 2428, vencidas em 10/10/2026 e 16/10/2026', 'R$ 1.234,50', 'sexta-feira, 30/10/2026']);
  const corpo = A.CORPO('OneClean');
  const t = A.textoFinal(corpo, p);
  assert.ok(/^Olá, Maria! Aqui é Renata, da OneClean\./.test(t));
  assert.ok(/regularização até sexta-feira, 30\/10\/2026\. Infelizmente, sem o pagamento até essa data, o título seguirá automaticamente para o cartório/.test(t));
  assert.ok(/fale comigo pelo botão abaixo/.test(t) && /toque em "Já paguei"/.test(t));
  const e = A.textoEmail(corpo, p, '(11) 99999-0000');
  assert.ok(/é só responder este e-mail ou me chamar no WhatsApp \(11\) 99999-0000/.test(e) && !/Já paguei/.test(e) && !/botão/.test(e));
  // a Meta não aceita variável no começo nem no fim do texto, e cada variável aparece uma vez
  assert.ok(!/^\{\{/.test(corpo) && !/\}\}[.!]?$/.test(corpo));
  assert.deepStrictEqual(corpo.match(/\{\{\d\}\}/g), ['{{1}}', '{{2}}', '{{3}}', '{{4}}', '{{5}}']);
});

test('alerta do cartório: prazo vencido, sem "Já paguei", com título ainda aberto fora do cartório; uma vez só', () => {
  const avisos = [
    { id: 1, empresa_id: 'A', duplicatas: ['1/01', '2/01'], prazo: '2026-10-22' },
    { id: 2, empresa_id: 'B', duplicatas: ['3/01'], prazo: '2026-10-22' },                 // pago (o título sumiu)
    { id: 3, empresa_id: 'C', duplicatas: ['4/01'], prazo: '2026-10-22', pagou_em: 'x' },  // disse que pagou
    { id: 4, empresa_id: 'D', duplicatas: ['5/01'], prazo: '2026-10-23' },                 // prazo é hoje: ainda não
    { id: 5, empresa_id: 'E', duplicatas: ['6/01'], prazo: '2026-10-20', alerta_em: 'x' }, // já alertado
    { id: 6, empresa_id: 'F', duplicatas: ['7/01'], prazo: '2026-10-20' }                  // já foi ao cartório
  ];
  const titulos = [{ empresa_id: 'A', duplicata: '1/01' }, { empresa_id: 'A', duplicata: '2/01' }, { empresa_id: 'C', duplicata: '4/01' },
    { empresa_id: 'D', duplicata: '5/01' }, { empresa_id: 'E', duplicata: '6/01' }, { empresa_id: 'F', duplicata: '7/01', cartorio_em: '2026-10-21' }];
  const r = A.alertasCartorio({ avisos, titulos, hoje: '2026-10-23' });
  assert.deepStrictEqual(r.map(a => [a.id, a.abertos.length]), [[1, 2]]);
});

test('celulares e e-mails do cliente: contatos antes da empresa, só celular, sem repetir', () => {
  const emp = { whatsapp: '(11) 98888-7777', telefone: '11 4000-0000', email: 'compras@cliente.com; FIN@cliente.com' };
  const cts = [{ whatsapp: '', celular: '11988887777', email: 'maria@cliente.com' }, { celular: '(21) 97777-6666', telefone: '' }];
  assert.deepStrictEqual(A.celularesDoCliente(emp, cts), ['5511988887777', '5521977776666']);
  assert.deepStrictEqual(A.emailsDoCliente(emp, cts), ['compras@cliente.com', 'fin@cliente.com', 'maria@cliente.com']);
});
