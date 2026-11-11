'use strict';
// ferramentas/confere-funcoes.js (11/11/2026): uma versão por lista de parâmetros, a última de cada uma vale.
const test = require('node:test');
const assert = require('node:assert/strict');
const { definicoes, consulta } = require('../ferramentas/confere-funcoes.js');

const sql = `
create or replace function public.crm_x(p_a bigint, p_b text) returns int language sql as $$ select 1 $$;
create or replace function public.crm_x(p_a bigint, p_b text, p_c text[]) returns int language sql as $$ select 2 $$;
create or replace function public.crm_x(p_a bigint, p_b text) returns int language sql as $$ select 3 $$;
create or replace function public.crm_y(p_v numeric(14,3)) returns int language plpgsql as $f$ begin return 4; end $f$;
`;

test('duas versões do mesmo nome entram as duas; redefinição da mesma lista de parâmetros vale a última', () => {
  const d = definicoes(sql);
  assert.deepEqual(d.map(x => x.n + ':' + x.corpo.trim()), ['crm_x:select 3', 'crm_x:select 2', 'crm_y:begin return 4; end']);
});

test('a consulta compara cada função do banco com todas as versões do arquivo, não só a última', () => {
  const q = consulta(sql);
  assert.equal((q.match(/\('crm_x','/g) || []).length, 2);
  assert.match(q, /not in \(select v\.m from v where v\.n = p\.proname\)/);
});
