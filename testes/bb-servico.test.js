// Serviço fiscal → Banco do Brasil com o A1 (04/11/2026): só endereços https do próprio BB.
const test = require('node:test');
const assert = require('node:assert');
const B = require('../servico-fiscal/bb');

test('rota /bb só aceita https de *.bb.com.br', () => {
  for (const u of ['https://api-extratos.bb.com.br/extratos/v1/conta-corrente/agencia/1/conta/2', 'https://oauth.bb.com.br/oauth/token', 'https://api.bb.com.br/cobrancas/v2/boletos'])
    assert.doesNotThrow(() => B.alvo(u), u);
  for (const u of ['http://api.bb.com.br/x', 'https://bb.com.br.evil.com/x', 'https://evil.com/bb.com.br', 'https://evilbb.com.br/x', 'ftp://api.bb.com.br', '', null])
    assert.throws(() => B.alvo(u), String(u));
});
test('rota /bb recusa método estranho antes de chamar o banco', () => {
  assert.throws(() => B.chama({}, { url: 'https://api.bb.com.br/x', metodo: 'DELETE' }), /método/);
});
