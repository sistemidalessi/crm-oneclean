// Fixa nas Edge Functions a versão dos arquivos do site que elas baixam do GitHub: o commit (padrão:
// o último, que precisa já estar no GitHub) e o SHA-256 de cada arquivo.
//   crm-notas          → regras.js, nfe.js, fkn.js
//   crm-caixa-leitura  → caixa-calculo.js
//   node ferramentas/fixa-motor-notas.js [commit]
// Depois, publicar de novo a função que mudou (deploy com verify_jwt desligado).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const raiz = path.join(__dirname, '..');
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(raiz, f))).digest('hex');

const FUNCOES = { 'crm-notas': ['regras.js', 'nfe.js', 'fkn.js'], 'crm-caixa-leitura': ['caixa-calculo.js'] };
const ARQUIVOS = FUNCOES['crm-notas'];
const arquivoDa = f => path.join(raiz, 'supabase', 'functions', f, 'index.ts');
function hashesDe(lista) { const h = {}; lista.forEach(f => { h[f] = hash(f); }); return h; }
const hashesAtuais = () => hashesDe(ARQUIVOS);

if (require.main === module) {
  const commit = process.argv[2] || execSync('git rev-parse HEAD', { cwd: raiz }).toString().trim();
  for (const [fun, lista] of Object.entries(FUNCOES)) {
    for (const f of lista) {
      const noCommit = execSync('git show ' + commit + ':' + f, { cwd: raiz, maxBuffer: 1 << 24 });
      if (crypto.createHash('sha256').update(noCommit).digest('hex') !== hash(f)) throw new Error(f + ' no commit ' + commit + ' é diferente do arquivo atual: faça commit antes');
    }
    const h = hashesDe(lista);
    const arq = arquivoDa(fun);
    const antes = fs.readFileSync(arq, 'utf8');
    const atual = /const HASHES: Record<string, string> = \{([^}]*)\};/.exec(antes);
    // só troca o commit da função cujos arquivos mudaram (a outra não precisa ser publicada de novo)
    if (atual && lista.every(f => atual[1].indexOf("'" + f + "': '" + h[f] + "'") !== -1)) { console.log(fun + ': já fixada nos arquivos atuais'); continue; }
    const s = antes.replace(/const COMMIT = '[^']*';/, "const COMMIT = '" + commit + "';")
      .replace(/const HASHES: Record<string, string> = \{[^}]*\};/, 'const HASHES: Record<string, string> = { ' + lista.map(f => "'" + f + "': '" + h[f] + "'").join(', ') + ' };');
    fs.writeFileSync(arq, s);
    console.log(fun + ' fixada no commit', commit, '— publique esta função de novo');
  }
}
module.exports = { hashesAtuais, hashesDe, ARQUIVOS, FUNCOES, arquivoDa };
