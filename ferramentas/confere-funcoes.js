'use strict';
// Confere se as funções do banco são as mesmas do supabase/schema.sql (24/10/2026: o "Conferir a virada" tinha
// ficado com a versão antiga no banco, porque a aplicação caiu e só o arquivo mudou).
// Uso: node ferramentas/confere-funcoes.js > /tmp/confere.sql e rodar o SQL no SQL Editor (ou pelo conector).
// O resultado é a lista das funções diferentes (comentários e espaços não contam); vazio = tudo igual.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function corpos(sql) {
  const r = {};
  const re = /create or replace function public\.(crm_\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const k = /\bas\s+(\$\w*\$)/i.exec(sql.slice(m.index + m[0].length));
    if (!k) continue;
    const ini = m.index + m[0].length + k.index + k[0].length;
    const fim = sql.indexOf(k[1], ini);
    r[m[1]] = sql.slice(ini, fim);   // a última definição vale (como no banco)
  }
  return r;
}
const normaliza = c => c.replace(/--[^\n]*/g, '').replace(/\s/g, '');
const md5 = t => crypto.createHash('md5').update(t).digest('hex');

function consulta(sql) {
  const c = corpos(sql);
  const vals = Object.keys(c).sort().map(n => "('" + n + "','" + md5(normaliza(c[n])) + "')").join(',\n');
  return 'with v(n, m) as (values ' + vals + ')\n' +
    "select coalesce(json_agg(v.n order by v.n), '[]') diferentes from v join pg_proc p on p.proname = v.n " +
    "join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public' " +
    "where md5(regexp_replace(regexp_replace(p.prosrc, '--[^\\n]*', '', 'g'), '\\s', '', 'g')) <> v.m;\n";
}

if (require.main === module) process.stdout.write(consulta(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8')));
module.exports = { corpos, normaliza, consulta };
