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
