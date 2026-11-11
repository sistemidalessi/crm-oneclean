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

// Todas as versões de cada função, uma por lista de parâmetros (a última de cada uma vale). 11/11/2026: comparar só a última
// definição de cada NOME acusava como diferente a função que tem duas versões (crm_ceo_pedido_liberar com 2 e 3 parâmetros,
// crm_entrega_confirmar com 4 e 5), embora as duas estivessem iguais ao arquivo.
function definicoes(sql) {
  const r = new Map();
  const re = /create or replace function public\.(crm_\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    let i = m.index + m[0].length, nivel = 1;
    for (; i < sql.length && nivel; i++) { if (sql[i] === '(') nivel++; else if (sql[i] === ')') nivel--; }
    const params = sql.slice(m.index + m[0].length, i - 1).replace(/\s/g, '').toLowerCase();
    const k = /\bas\s+(\$\w*\$)/i.exec(sql.slice(i));
    if (!k) continue;
    const ini = i + k.index + k[0].length;
    r.set(m[1] + '(' + params + ')', { n: m[1], corpo: sql.slice(ini, sql.indexOf(k[1], ini)) });
  }
  return [...r.values()];
}

// Função do banco (com esse nome) cuja versão não bate com nenhuma das versões do arquivo.
function consulta(sql) {
  const vals = definicoes(sql).map(d => "('" + d.n + "','" + md5(normaliza(d.corpo)) + "')").sort().join(',\n');
  const somaBanco = "md5(regexp_replace(regexp_replace(p.prosrc, '--[^\\n]*', '', 'g'), '\\s', '', 'g'))";
  return 'with v(n, m) as (values ' + vals + ')\n' +
    "select coalesce(json_agg(distinct p.proname), '[]') diferentes from pg_proc p " +
    "join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public' " +
    'where p.proname in (select n from v) and ' + somaBanco + ' not in (select v.m from v where v.n = p.proname);\n';
}

if (require.main === module) process.stdout.write(consulta(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8')));
module.exports = { corpos, definicoes, normaliza, consulta };
