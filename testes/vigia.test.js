'use strict';
// Sinal de vida do vigia de notas: manda ao ligar e a cada 30 min, mesmo sem nota nova; o CRM
// avisa o administrador quando para. Roda o vigia de verdade contra um servidor falso.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const DD = require('../dados.js');

test('situação do vigia: rodando, parado, nunca deu sinal, desligado', () => {
  const agora = Date.parse('2026-10-01T15:00:00Z');
  const s = (min, ativo = true) => DD.situacaoVigia({ ativo, ultimo_sinal: min == null ? null : new Date(agora - min * 60000).toISOString() }, agora);
  assert.deepEqual(s(10), { estado: 'ok', minutos: 10 });
  assert.equal(s(DD.PARADO_MIN).estado, 'ok');
  assert.equal(s(DD.PARADO_MIN + 1).estado, 'parado');
  assert.equal(s(null).estado, 'nunca');
  assert.equal(s(10, false).estado, 'desligada');
});

test('vigia manda sinal de vida sem nota nova, e não repete antes de 30 min', async () => {
  const pedidos = [];
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', c => { corpo += c; });
    req.on('end', () => { pedidos.push({ url: req.url, chave: req.headers['x-crm-chave'], corpo: JSON.parse(corpo) }); res.setHeader('content-type', 'application/json'); res.end('{"ok":true,"sinal":true}'); });
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-'));
  fs.mkdirSync(path.join(dir, 'xml'));
  fs.copyFileSync(path.join(__dirname, '..', 'ferramentas', 'vigia-notas.js'), path.join(dir, 'vigia-notas.js'));
  fs.writeFileSync(path.join(dir, 'vigia-notas.json'), JSON.stringify({ url: 'http://127.0.0.1:' + srv.address().port, chave: 'x'.repeat(40), pasta: path.join(dir, 'xml'), desde: '202601' }));
  const roda = () => new Promise((ok, falha) => execFile(process.execPath, [path.join(dir, 'vigia-notas.js'), '--uma-vez'], (e, out, err) => (e ? falha(new Error(err || e.message)) : ok(out))));
  try {
    await roda();
    assert.equal(pedidos.length, 1, 'mandou o sinal na 1ª volta');
    assert.equal(pedidos[0].url, '/functions/v1/crm-notas');
    assert.equal(pedidos[0].chave, 'x'.repeat(40));
    assert.equal(pedidos[0].corpo.sinal, true);
    assert.equal(pedidos[0].corpo.info.pendentes, 0);
    assert.match(pedidos[0].corpo.info.versao, /^\d{4}-\d{2}-\d{2}$/);
    await roda();
    assert.equal(pedidos.length, 1, 'não repete o sinal antes de 30 min');
    const est = JSON.parse(fs.readFileSync(path.join(dir, 'vigia-notas-estado.json'), 'utf8'));
    est.ultimoSinal = Date.now() - 31 * 60000;
    fs.writeFileSync(path.join(dir, 'vigia-notas-estado.json'), JSON.stringify(est));
    await roda();
    assert.equal(pedidos.length, 2, 'passados 30 min, manda de novo');
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
