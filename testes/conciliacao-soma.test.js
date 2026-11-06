'use strict';
// Conciliação do extrato do BB (06/11/2026): uma linha do banco que junta vários lançamentos do dia (um Pix que paga várias
// contas) e o caminho inverso, lançamento dado como pago no Caixa sem linha no banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
const caixa = fs.readFileSync(path.join(__dirname, '..', 'caixa.js'), 'utf8');
const fn = nome => { const i = sql.lastIndexOf('create or replace function public.' + nome + '('); return sql.slice(i, sql.indexOf('\n$$;', i)); };

test('a conciliação procura a soma entre as transferências entre empresas, depois pelo nome, e só sugere entre todos', () => {
  const f = fn('crm_fin_extrato_conciliar');
  assert.ok(f.includes("case grp when 1 then l3.entre_empresas"));
  assert.ok(f.includes('ids := public.crm_fin_soma_achar(cids, cvals, x.valor);'));
  assert.ok(f.includes("if ids is not null and grp < 3 then"), 'grupos 1 e 2 conferem sozinhos');
  assert.ok(f.includes("jsonb_build_object('tipo', 'soma', 'ids', to_jsonb(ids)"), 'grupo 3 vira sugestão');
  // a soma vem depois do mesmo valor no mesmo dia e da tarifa: não troca o que já casava
  assert.ok(f.indexOf('crm_fin_soma_achar') > f.indexOf("-- tarifa do banco"));
});

test('juntar à mão: só o administrador, soma no centavo, lançamento ainda sem linha do banco', () => {
  const f = fn('crm_fin_extrato_ligar_soma');
  assert.ok(f.includes("if not public.crm_eh_admin() then raise exception 'só o administrador'; end if;"));
  assert.ok(f.includes('if abs(soma - x.valor) >= 0.005 then'));
  assert.ok(f.includes('not public.crm_fin_extrato_usado(id)'));
  assert.ok(f.includes("if x.situacao <> 'conferir' then raise exception"));
  assert.ok(sql.includes('revoke all on function public.crm_fin_extrato_ligar_soma(bigint, uuid[]) from public, anon;'));
  assert.ok(sql.includes('revoke all on function public.crm_fin_soma_achar(uuid[], numeric[], numeric) from public, anon, authenticated;'));
});

test('a busca da soma acha o subconjunto exato (mesmo algoritmo, em JS)', () => {
  // espelho do crm_fin_soma_dfs: maior primeiro, corta quando o que sobra não alcança
  const achar = (vals, alvo) => {
    const v = vals.map(x => Math.round(x * 100)), suf = []; suf[v.length] = 0;
    for (let k = v.length - 1; k >= 0; k--) suf[k] = suf[k + 1] + v[k];
    const dfs = (i, resto, esc) => { if (resto === 0) return esc; if (resto < 0 || i >= v.length || suf[i] < resto) return null;
      if (v[i] <= resto) { const r = dfs(i + 1, resto - v[i], esc.concat(i)); if (r) return r; } return dfs(i + 1, resto, esc); };
    const r = dfs(0, Math.round(alvo * 100), []); return r && r.length >= 2 ? r : null;
  };
  // valores de exemplo: 9 de 11 somam o Pix; o maior e o de 2.000 ficam de fora
  const vals = [9000, 7123.45, 4500, 3210.55, 2000, 1800, 900, 640, 300, 250, 100];
  const r = achar(vals, 18824);
  assert.ok(r);
  assert.equal(Math.round(r.reduce((t, i) => t + vals[i] * 100, 0)) / 100, 18824);
  assert.ok(r.indexOf(0) < 0 && r.indexOf(4) < 0, 'o maior e o de 2.000 ficam de fora');
  assert.equal(achar([100, 50], 75), null);
  assert.equal(achar([100], 100), null, 'um só não é soma');
});

test('tela: "pago no Caixa, mas não saiu no banco" olha também o dia de hoje e espera a tarifa agrupada', () => {
  assert.ok(caixa.includes("x.pago_em === hoje() && lidoHoje && x.baixado_em && Date.parse(x.baixado_em) < lidoHoje"));
  assert.ok(caixa.includes("x.categoria !== 'Tarifas bancárias' || x.pago_em <= R.somaDias(hoje(), -5)"));
  assert.ok(caixa.includes("'cx-ext-juntar'") && caixa.includes("'cx-ext-soma'") && caixa.includes("'cx-ext-naosaiu'"));
});
