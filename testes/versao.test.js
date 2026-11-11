'use strict';
// O index.html leva a versão de cada arquivo (?v=) e a versão geral; é o que faz a equipe pegar
// a versão nova sem Ctrl+F5. Mexeu em qualquer .js/.css/logo e esqueceu de carimbar? Este teste pega.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { carimbo, INDEX } = require('../ferramentas/carimba-versao.js');

test('index.html carimbado com a versão atual dos arquivos', () => {
  const atual = fs.readFileSync(INDEX, 'utf8');
  assert.ok(atual === carimbo(atual), 'arquivo mudou: rode node ferramentas/carimba-versao.js antes do commit');
});

test('todo script e estilo local do index.html tem ?v=', () => {
  const atual = fs.readFileSync(INDEX, 'utf8');
  const sem = [...atual.matchAll(/\s(?:src|href)="((?!https?:|data:|#)[^"]+\.(?:js|css))"/g)].map(m => m[1]);
  assert.deepEqual(sem, []);
  assert.match(atual, /<meta name="crm-versao" content="[0-9a-f]{12}">/);
});

test('o fim de linha não muda o carimbo (CRLF do Windows = LF; 11/11/2026)', () => {
  const os = require('os'), path = require('path');
  const { versaoDe } = require('../ferramentas/carimba-versao.js');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'carimbo-'));
  const texto = 'linha 1\nlinha 2\n';
  fs.writeFileSync(path.join(pasta, 'lf.js'), texto);
  fs.writeFileSync(path.join(pasta, 'crlf.js'), texto.replace(/\n/g, '\r\n'));
  fs.writeFileSync(path.join(pasta, 'outro.js'), 'linha 1\nlinha 3\n');
  assert.equal(versaoDe(path.join(pasta, 'lf.js')), versaoDe(path.join(pasta, 'crlf.js')));
  assert.notEqual(versaoDe(path.join(pasta, 'lf.js')), versaoDe(path.join(pasta, 'outro.js')), 'conteúdo diferente muda o carimbo');
  // a versão geral também: o mesmo index com CRLF dá o mesmo número
  const atual = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
  const geral = h => /crm-versao" content="([0-9a-f]+)"/.exec(carimbo(h))[1];
  assert.equal(geral(atual), geral(atual.replace(/\n/g, '\r\n')));
  fs.rmSync(pasta, { recursive: true, force: true });
});
