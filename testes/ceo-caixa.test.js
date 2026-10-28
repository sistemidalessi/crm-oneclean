// Lançar no caixa pelo app do CEO (28/10/2026): a função crm-ceo-acao sugere a categoria com uma CÓPIA da lista de
// palavras de frases.js (categoriaDe/PALAVRAS) e das palavras genéricas (tokens). As duas têm de ser iguais.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
// o trecho entre o início e o primeiro "];" ou ").split", sem comentários nem espaços
const trecho = (s, inicio, fim) => {
  const i = s.indexOf(inicio);
  assert.ok(i >= 0, 'não achei ' + inicio);
  const j = s.indexOf(fim, i);
  return s.slice(i + inicio.length, j).replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
};

test('a lista de palavras da função é a mesma de frases.js', () => {
  const f = ler('frases.js'), e = ler('supabase/functions/crm-ceo-acao/index.ts');
  assert.strictEqual(trecho(e, 'const PALAVRAS: [RegExp, string][] = [', '];'), trecho(f, 'const PALAVRAS = [', '];'));
});

test('as palavras genéricas da função são as mesmas de frases.js', () => {
  const f = ler('frases.js'), e = ler('supabase/functions/crm-ceo-acao/index.ts');
  assert.strictEqual(trecho(e, 'const GENERICAS = new Set((', ').split'), trecho(f, 'const GENERICAS = new Set((', ').split'));
});
