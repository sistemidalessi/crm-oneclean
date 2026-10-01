-- Teste de volume das políticas de leitura (roda.sh, depois do ataque).
-- Em 01/10/2026 o CRM abriu vazio para a equipe toda: as políticas chamavam crm_ve_empresa()
-- uma vez POR LINHA e as leituras passavam do statement_timeout (8 s) do Supabase.
-- Aqui o banco ganha bem mais dados que a OneClean tem hoje e cada papel lê cada tabela como o
-- app lê (página de 1.000) e inteira; se alguma leitura passar do limite, sai "LENTO" e roda.sh falha.
\set ON_ERROR_STOP 1
\pset footer off
set session_replication_role = replica;  -- sem gatilhos (duplicado, histórico) na carga
insert into crm_usuarios (user_id,nome,papel) values ('f0000000-0000-0000-0000-000000000006','Compras','comprador') on conflict do nothing;
update crm_usuarios set ativo = true;
insert into crm_empresas (nome, responsavel_id)
  select 'Empresa volume ' || g, (array['c0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000004', null]::uuid[])[1 + g % 3]
    from generate_series(1, 12000) g;
create temp table ev as select id, row_number() over (order by id) n from crm_empresas;
insert into crm_contatos (empresa_id, nome) select id, 'Contato ' || n from ev where n % 2 = 0;
insert into crm_negocios (empresa_id, titulo, responsavel_id)
  select ev.id, 'Negócio ' || g, (array['c0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000004']::uuid[])[1 + g % 2]
    from generate_series(1, 20000) g join ev on ev.n = 1 + g % 12000;
insert into crm_atividades (empresa_id, descricao, responsavel_id)
  select ev.id, 'Tarefa ' || g, (array['c0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000004']::uuid[])[1 + g % 2]
    from generate_series(1, 40000) g join ev on ev.n = 1 + (g * 7) % 12000;
insert into crm_notas (chave, emitida_em, empresa_id, valor_total)
  select '35' || lpad(g::text, 42, '0'), now() - (g || ' hours')::interval, ev.id, 100
    from generate_series(1, 6000) g join ev on ev.n = 1 + (g * 13) % 12000;
insert into crm_nota_itens (nota_id, descricao, quantidade, valor_total)
  select n.id, 'Item ' || i, 1, 10 from crm_notas n cross join generate_series(1, 8) i;
set session_replication_role = origin;
analyze;

do $$
declare
  u record; t text; ms numeric; t0 timestamptz; n bigint;
  limite constant numeric := 1000;  -- ms por leitura; com as políticas rápidas fica na casa de dezenas
begin
  for u in select * from (values ('admin','a0000000-0000-0000-0000-000000000001'), ('gestor','b0000000-0000-0000-0000-000000000002'),
                                 ('vendedor','c0000000-0000-0000-0000-000000000003'), ('comprador','f0000000-0000-0000-0000-000000000006')) v(papel, id) loop
    perform set_config('request.jwt.claim.sub', u.id, false);
    perform set_config('role', 'authenticated', false);
    foreach t in array array['crm_empresas','crm_contatos','crm_negocios','crm_atividades','crm_notas','crm_nota_itens',
                             'crm_negocio_itens','crm_propostas','crm_usuarios','crm_etapas','crm_config'] loop
      t0 := clock_timestamp();
      execute format('select count(*) from (select * from public.%I order by %s limit 1000) x', t,
        case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'criado_em')
             then 'criado_em, 1' else '1' end) into n;
      execute format('select count(*) from public.%I', t) into n;
      ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
      raise notice 'volume|%|%|% linhas|% ms%', u.papel, t, n, ms, case when ms > limite then ' LENTO' else '' end;
    end loop;
    execute 'reset role';
  end loop;
  raise notice 'volume|fim';
end $$;
