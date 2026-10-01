// Fixa na Edge Function crm-notas a versão de regras.js, nfe.js e fkn.js que ela vai baixar do GitHub:
// o commit (padrão: o último, que precisa já estar no GitHub) e o SHA-256 de cada arquivo.
//   node ferramentas/fixa-motor-notas.js [commit]
// Depois, publicar a função de novo (supabase functions deploy crm-notas --no-verify-jwt).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const raiz = path.join(__dirname, '..');
const ARQ = path.join(raiz, 'supabase', 'functions', 'crm-notas', 'index.ts');
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(raiz, f))).digest('hex');

const ARQUIVOS = ['regras.js', 'nfe.js', 'fkn.js'];
function hashesAtuais() { const h = {}; ARQUIVOS.forEach(f => { h[f] = hash(f); }); return h; }

if (require.main === module) {
  const commit = process.argv[2] || execSync('git rev-parse HEAD', { cwd: raiz }).toString().trim();
  for (const f of ARQUIVOS) {
    const noCommit = execSync('git show ' + commit + ':' + f, { cwd: raiz, maxBuffer: 1 << 24 });
    if (crypto.createHash('sha256').update(noCommit).digest('hex') !== hash(f)) throw new Error(f + ' no commit ' + commit + ' é diferente do arquivo atual: faça commit antes');
  }
  const h = hashesAtuais();
  let s = fs.readFileSync(ARQ, 'utf8');
  s = s.replace(/const COMMIT = '[^']*';/, "const COMMIT = '" + commit + "';")
    .replace(/const HASHES: Record<string, string> = \{[^}]*\};/, 'const HASHES: Record<string, string> = { ' + ARQUIVOS.map(f => "'" + f + "': '" + h[f] + "'").join(', ') + ' };');
  fs.writeFileSync(ARQ, s);
  console.log('crm-notas fixada no commit', commit);
}
module.exports = { hashesAtuais, ARQUIVOS };
