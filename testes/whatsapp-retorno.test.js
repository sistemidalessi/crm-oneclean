// Retorno do WhatsApp da Meta (crm-whatsapp-retorno): ler o corpo, ordem dos status e o "Já paguei".
const test = require('node:test');
const assert = require('node:assert');
const L = require('../supabase/functions/crm-whatsapp-retorno/logica.js');

test('corpo da Meta vira status e mensagens', () => {
  const corpo = { entry: [{ changes: [{ value: {
    contacts: [{ wa_id: '5511987654321', profile: { name: 'Maria Souza' } }],
    statuses: [{ id: 'wamid.A', status: 'read', recipient_id: '5511987654321' },
      { id: 'wamid.B', status: 'failed', recipient_id: '551133334444', errors: [{ code: 131026, title: 'Message undeliverable' }] }],
    messages: [{ from: '5511987654321', id: 'wamid.C', type: 'button', button: { text: 'Já paguei', payload: 'pagou:0b1c2d3e-0000-4000-8000-000000000001' }, context: { id: 'wamid.A' } },
      { from: '5511987654321', id: 'wamid.D', type: 'text', text: { body: 'Pode mandar de novo?' } },
      { from: '5511987654321', id: 'wamid.E', type: 'image', image: { caption: 'comprovante' } }] } }] }] };
  const ev = L.eventosDoCorpo(corpo);
  assert.strictEqual(ev.length, 5);
  assert.deepStrictEqual([ev[0].tipo, ev[0].status, ev[0].wamid], ['status', 'read', 'wamid.A']);
  assert.match(ev[1].erro, /undeliverable \(código 131026\)/);
  assert.strictEqual(ev[2].payload, 'pagou:0b1c2d3e-0000-4000-8000-000000000001');
  assert.strictEqual(ev[2].contexto, 'wamid.A');
  assert.strictEqual(ev[2].nome, 'Maria Souza');
  assert.strictEqual(ev[3].texto, 'Pode mandar de novo?');
  assert.strictEqual(ev[4].texto, 'comprovante [imagem]');
  assert.deepStrictEqual(L.eventosDoCorpo({}), []);
});

test('status só sobe; falhou vale antes de entregar', () => {
  assert.strictEqual(L.statusCRM('delivered'), 'entregue');
  assert.strictEqual(L.novoStatus('enviado', 'entregue'), 'entregue');
  assert.strictEqual(L.novoStatus('lido', 'entregue'), null);
  assert.strictEqual(L.novoStatus(null, 'lido'), 'lido');
  assert.strictEqual(L.novoStatus('enviado', 'falhou'), 'falhou');
  assert.strictEqual(L.novoStatus('lido', 'falhou'), null);
  assert.strictEqual(L.novoStatus('falhou', 'entregue'), 'entregue');
  assert.strictEqual(L.novoStatus('entregue', 'entregue'), null);
});

test('Já paguei: botão ou texto claro; "pago amanhã" não conta', () => {
  assert.ok(L.ehPagou({ payload: 'pagou:x', texto: 'Já paguei' }));
  assert.ok(L.ehPagou({ texto: 'Já paguei' }));
  assert.ok(L.ehPagou({ texto: 'bom dia, já foi pago ontem' }));
  assert.ok(L.ehPagou({ texto: 'Pagamento efetuado!' }));
  assert.ok(!L.ehPagou({ texto: 'pago amanhã' }));
  assert.ok(!L.ehPagou({ texto: 'ainda não foi pago' }));
  assert.ok(!L.ehPagou({ texto: 'vou pagar na sexta' }));
  assert.ok(!L.ehPagou({ texto: 'Pode mandar de novo?' }));
  assert.strictEqual(L.idDoPayload('pagou:0b1c2d3e-0000-4000-8000-000000000001'), '0b1c2d3e-0000-4000-8000-000000000001');
  assert.strictEqual(L.idDoPayload('outra coisa'), '');
});

test('celular com e sem o 9 (a Meta às vezes devolve sem)', () => {
  assert.deepStrictEqual(L.variantesBR('551187654321'), ['551187654321', '5511987654321']);
  assert.deepStrictEqual(L.variantesBR('5511987654321'), ['5511987654321', '551187654321']);
  assert.deepStrictEqual(L.variantesBR('551133334444'), ['551133334444']);
});

test('respostas automáticas cordiais', () => {
  assert.strictEqual(L.textoPagou('Maria', 'Renata'), 'Obrigado pelo aviso, Maria! O financeiro vai conferir o pagamento no banco e, se precisar de algo, Renata fala com você. Tenha um ótimo dia!');
  assert.match(L.textoRepasse('Renata', '5511987654321'), /Repassei para Renata.*https:\/\/wa\.me\/5511987654321/);
});
