'use strict';
// Função nova no esquema public nasce sem acesso para quem não fez login (alertas do Supabase, 23/10/2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

test('padrão das funções: sem EXECUTE para anon e PUBLIC', () => {
  assert.ok(sql.includes('alter default privileges for role postgres in schema public revoke execute on functions from anon;'));
  assert.ok(sql.includes('alter default privileges for role postgres revoke execute on functions from public;'));
});

test('conferência da virada: só o administrador e sem anon', () => {
  const i = sql.indexOf('create or replace function public.crm_virada_conferir()');
  assert.ok(i > 0);
  assert.ok(sql.slice(i, i + 600).includes("if not public.crm_eh_admin() then raise exception"));
  assert.ok(sql.includes('revoke all on function public.crm_virada_conferir() from public, anon;'));
});

test('devolução de cliente abate os títulos da venda pela duplicata com a série, não só pelo número', () => {
  const i = sql.indexOf('create or replace function public.crm_nfe_outra_efeitos');
  const f = sql.slice(i, sql.indexOf('$$;', i));
  assert.ok(!/where nota_numero = vnota\.numero/.test(f));
  assert.ok(f.includes("split_part(duplicata, '/', 1) = (case when coalesce(nullif(vnota.serie, '')::int, 1) = 1"));
});

test('entrada avulsa: só administrador e comprador; Caixa só pelo administrador', () => {
  const i = sql.indexOf('create or replace function public.crm_estoque_entrada_avulsa');
  const f = sql.slice(i, sql.indexOf('$$;', i));
  assert.ok(f.includes("if not (public.crm_eh_admin() or public.crm_eh_comprador()) then raise exception"));
  assert.ok(f.includes("(p->>'caixa')::boolean, false) and public.crm_eh_admin()"));
  assert.ok(sql.includes('revoke all on function public.crm_estoque_entrada_avulsa(jsonb) from public, anon;'));
  assert.ok(sql.includes("create policy ler on public.crm_estoque_avulsas for select to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));"));
});

test('ensaio da virada: nota emitida pelo CRM fatura o pedido dela (crm_nfe), nunca outro pelo parecido', () => {
  const i = sql.lastIndexOf('create or replace function public.crm_pedidos_casar_int');
  const f = sql.slice(i, sql.indexOf('$$;', i));
  assert.ok(f.includes('from public.crm_nfe f join public.crm_notas nt on nt.chave = f.chave'));
  assert.ok(f.includes("f.pedido_id = p.id and f.outra_id is null and f.ambiente = 'producao' and f.situacao = 'autorizada'"));
  assert.ok(f.includes('and not exists (select 1 from public.crm_nfe f where f.chave = nt.chave)'));
});

test('ensaio da virada: baixa do estoque e título que sai olham a série (NF 2-1 não é a NF 1 do FKN)', () => {
  const i = sql.indexOf('create or replace function public.crm_estoque_saida_item');
  const f = sql.slice(i, sql.indexOf('$$;', i));
  assert.ok(f.includes('select numero, serie, emitida_em, cancelada into n'));
  const j = sql.indexOf('create or replace function public.crm_titulo_saiu');
  const g = sql.slice(j, sql.indexOf('$$;', j));
  assert.ok(g.includes("ser int := case when pre ~ '^\\d+-' then split_part(pre, '-', 1)::int else 1 end;"));
  assert.ok(!/where numero = num and cancelada/.test(g));
});

test('ensaio da virada: simples faturamento (5922/6922) não entra na rota de entrega', () => {
  const i = sql.indexOf('create or replace function public.crm_rota_candidatas');
  const f = sql.slice(i, sql.indexOf('end $$;', i));
  assert.ok(f.includes("and not exists (select 1 from public.crm_nota_itens i where i.nota_id = n.id and i.cfop in ('5922', '6922'))"));
});

test('números da NF-e sem uso: só gestão e logística, sem anônimo, e entram no resumo da turma', () => {
  const i = sql.indexOf('create or replace function public.crm_nfe_sem_uso');
  const f = sql.slice(i, sql.indexOf('end $$;', i));
  assert.ok(f.includes("if not (public.crm_eh_gestor() or public.crm_eh_logistica()) then raise exception 'sem acesso'; end if;"));
  assert.ok(f.includes("f.ambiente = 'producao' and f.situacao in ('reservada', 'rejeitada', 'bloqueada') and f.inutilizada_em is null"));
  assert.ok(sql.includes('revoke all on function public.crm_nfe_sem_uso() from public, anon;'));
  assert.ok(sql.includes("r := r || jsonb_build_object('nfe_sem_uso', x);"));
});

test('virada: nota de compra que já entrou no FKN liga as contas dele em vez de criar outras', () => {
  const i = sql.lastIndexOf('create or replace function public.crm_compra_pagar()');
  const f = sql.slice(i, sql.indexOf('$$;', i));
  assert.ok(f.includes("x.origem = 'fkn' and x.compra_id is null"));
  assert.ok(f.includes('public.crm_nome_chave(split_part(x.descricao, \' · \', 1)) = public.crm_nome_chave(forn)'));
  assert.ok(f.indexOf('if ja > 0 then return new; end if;') < f.indexOf('insert into public.crm_fin_lancamentos'));
  assert.ok(sql.includes('revoke all on function public.crm_nome_chave(text) from public, anon;'));
});

test('conferir a virada avisa quando o contador de pedidos fica atrás do maior número', () => {
  const i = sql.indexOf('create or replace function public.crm_virada_conferir()');
  const f = sql.slice(i, sql.indexOf('$$;', i));
  assert.ok(f.includes("(select last_value from public.crm_pedidos_numero_seq)"));
  assert.ok(f.includes("'chave', 'contador_pedidos'"));
});

test('CEO Grupo Dalessi: o resumo da OneClean só sai pela senha de leitura (service_role), nunca pelo app', () => {
  const i = sql.indexOf('create or replace function public.crm_ceo_resumo()');
  assert.ok(i > 0);
  assert.ok(sql.slice(i, i + 200).includes('stable security definer'));
  assert.ok(sql.includes('revoke all on function public.crm_ceo_resumo() from public, anon, authenticated;'));
  assert.ok(!/grant execute on function public\.crm_ceo_resumo\(\) to (anon|authenticated)/.test(sql));
  const ef = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'crm-caixa-leitura', 'index.ts'), 'utf8');
  const senha = ef.indexOf("if (!ok) return resposta(401");
  const ceo = ef.indexOf("db.rpc('crm_ceo_resumo')");
  assert.ok(senha > 0 && ceo > senha, 'o resumo só depois de conferir a senha');
});
