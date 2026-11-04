'use strict';
// Gera a função do banco crm_abrevia_razao(texto, max) com a MESMA tabela e a mesma conta de regras.js (abreviaRazao).
// Uso: node ferramentas/gera-abrevia-razao.js > saida.sql (04/11/2026; a razão social da NF-e cabe em 60 letras).
const R = require('../regras.js');
const json = JSON.stringify(R.ABREV_RAZAO).replace(/'/g, "''");
process.stdout.write(`create or replace function public.crm_abrevia_razao(t text, maxlen int default ${R.RAZAO_MAX}) returns text
language plpgsql immutable set search_path = public as $f$
-- gerada por ferramentas/gera-abrevia-razao.js a partir de regras.js (abreviaRazao): não editar à mão
declare s text := btrim(regexp_replace(coalesce(t, ''), '\\s+', ' ', 'g')); p text[]; i int; pre text; pos text; meio text; a text;
  ab constant jsonb := '${json}';
begin
  if length(s) <= maxlen then return s; end if;
  p := string_to_array(s, ' ');
  i := array_length(p, 1);
  while i >= 1 and length(array_to_string(p, ' ')) > maxlen loop
    pre := coalesce(substring(p[i] from '^[^A-Za-z0-9À-ÿ]*'), '');
    if pre <> p[i] then
      pos := coalesce(substring(p[i] from '[^A-Za-z0-9À-ÿ]*$'), '');
      meio := substr(p[i], length(pre) + 1, length(p[i]) - length(pre) - length(pos));
      a := ab ->> upper(translate(meio, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
      if a is not null then p[i] := pre || a || pos; end if;
    end if;
    i := i - 1;
  end loop;
  s := array_to_string(p, ' ');
  if length(s) > maxlen then
    s := left(s, maxlen + 1);
    s := case when position(' ' in s) > 0 then regexp_replace(s, ' [^ ]*$', '') else left(s, maxlen) end;
    s := regexp_replace(s, '(\\s+(E|DE|DA|DO|DAS|DOS|EM|-|&))+$', '', 'i');
    s := regexp_replace(s, '[\\s,;–&-]+$', '');
  end if;
  return s;
end;
$f$;
`);
