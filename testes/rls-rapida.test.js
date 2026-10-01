'use strict';
// Trava contra a lentidão de 01/10/2026 (CRM vazio para a equipe toda): política de acesso que
// chama função por linha estoura o statement_timeout do Supabase quando todos abrem o CRM juntos.
// O teste de volume de verdade fica em supabase/teste-rls/volume.sql (roda.sh); este pega o erro
// já no schema.sql, sem Postgres.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
const ini = sql.indexOf('-- =================================================================== políticas');
const fim = sql.indexOf('-- =================================================================== permissões de função');
const secao = sql.slice(ini, fim).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
// "create policy ... ;" (pode ocupar várias linhas) e os do laço "execute format('create policy ...')".
const politicas = (secao.match(/create policy[\s\S]*?(?:;|'\s*,)/g) || []);

test('políticas: encontradas no schema.sql', () => {
  assert.ok(ini > 0 && fim > ini, 'seções "políticas" e "permissões de função" no schema.sql');
  assert.ok(politicas.length >= 40, 'achou ' + politicas.length + ' políticas');
});

test('políticas de leitura não chamam função por linha (crm_ve_*)', () => {
  const ruins = politicas.filter(p => /for (select|all)\b/.test(p) && /crm_ve_|crm_edita_/.test(p.split(/with check/)[0]));
  assert.deepEqual(ruins, [], 'use "coluna in (select public.crm_..._minhas())" em vez de crm_ve_*(coluna)');
});

test('papel e auth.uid() nas políticas sempre como subconsulta (avaliada uma vez)', () => {
  const soltos = [];
  for (const p of politicas) {
    const sem = p.replace(/\(select (public\.crm_eh_[a-z]+\(\)|auth\.uid\(\))\)/g, '');
    if (/crm_eh_[a-z]+\(\)|auth\.uid\(\)/.test(sem)) soltos.push(p);
  }
  assert.deepEqual(soltos, [], 'escreva (select public.crm_eh_gestor()) e (select auth.uid())');
});

// Segunda proteção (dados.js): leitura cancelada por tempo tenta de novo; sem permissão, não.
test('carga do Supabase tenta de novo quando o servidor demora', { timeout: 30000 }, async () => {
  const DD = require('../dados.js');
  const falhas = new Map();
  const fake = (erroDe) => ({
    from: t => {
      const q = { select: () => q, order: () => q,
        range: async () => {
          const n = (falhas.get(t) || 0) + 1; falhas.set(t, n);
          const e = erroDe(t, n);
          return e ? { data: null, error: { message: e } } : { data: [], error: null };
        } };
      return q;
    }
  });
  const timers = global.setTimeout;
  global.setTimeout = (f) => timers(f, 0); // sem esperar de verdade
  try {
    const d = await new DD.Supa(fake((t, n) => t === 'crm_atividades' && n <= 2 ? 'canceling statement due to statement timeout' : null)).carregar();
    assert.deepEqual(d.atividades, []);
    assert.equal(falhas.get('crm_atividades'), 3, 'duas falhas e a terceira deu certo');
    falhas.clear();
    await assert.rejects(new DD.Supa(fake(t => t === 'crm_notas' ? 'canceling statement due to statement timeout' : null)).carregar(),
      /servidor demorou para responder/);
    assert.equal(falhas.get('crm_notas'), 4, 'desiste depois de 3 novas tentativas, com mensagem em português');
    falhas.clear();
    await assert.rejects(new DD.Supa(fake(t => t === 'crm_notas' ? 'permission denied for table crm_notas' : null)).carregar(), /Sem permissão/);
    assert.equal(falhas.get('crm_notas'), 1, 'sem permissão não repete');
  } finally { global.setTimeout = timers; }
});
