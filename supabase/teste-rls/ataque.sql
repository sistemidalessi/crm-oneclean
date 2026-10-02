-- Ataque às permissões do CRM: admin, gestora, dois vendedores, alguém de fora e anon.
-- Linhas marcadas FALHA devem dar erro; '(NÃO devia)' não pode aparecer na saída.
\set ON_ERROR_STOP 0
\pset footer off
insert into crm_usuarios (user_id,nome,papel) values ('a0000000-0000-0000-0000-000000000001','Admin','admin'),('b0000000-0000-0000-0000-000000000002','Gestora','gestor'),('c0000000-0000-0000-0000-000000000003','Ana','vendedor'),('d0000000-0000-0000-0000-000000000004','Bruno','vendedor');
create or replace function pg_temp.como(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;
set role authenticated;
-- vendedora Ana
select pg_temp.como('c0000000-0000-0000-0000-000000000003');
insert into crm_empresas (nome, responsavel_id) values ('Da Ana','c0000000-0000-0000-0000-000000000003') returning 'Ana criou a própria empresa com RETURNING (como o app faz)' as ok;
insert into crm_empresas (nome, responsavel_id) values ('Ana tentando por no Bruno','d0000000-0000-0000-0000-000000000004'); -- FALHA
insert into crm_empresas (nome) values ('sem dono pela Ana'); -- FALHA
-- vendedor Bruno
select pg_temp.como('d0000000-0000-0000-0000-000000000004');
insert into crm_empresas (nome, responsavel_id) values ('Do Bruno','d0000000-0000-0000-0000-000000000004');
insert into crm_contatos (empresa_id, nome) select id,'Contato do Bruno' from crm_empresas where nome='Do Bruno';
insert into crm_atividades (empresa_id, descricao, responsavel_id) select id,'tarefa do Bruno','d0000000-0000-0000-0000-000000000004' from crm_empresas where nome='Do Bruno';
select 'Bruno vê' t, string_agg(nome, ', ') from crm_empresas;
select crm_proximo_vendedor() is not null as rodizio_ok;
-- admin gera chave de integração (só o hash); gestora não
reset role; set role authenticated; select pg_temp.como('a0000000-0000-0000-0000-000000000001');
insert into crm_integracoes (nome, token_hash) values ('Vigia do escritório', repeat('b',64)) returning 'admin criou chave de integração' as ok;
select pg_temp.como('b0000000-0000-0000-0000-000000000002');
insert into crm_integracoes (nome, token_hash) values ('gestora tentando', repeat('c',64)); -- FALHA
select 'Gestora vê integrações (NÃO devia)' t, count(*) from crm_integracoes having count(*) > 0;
-- gestora cria negócio da Ana dentro da empresa do Bruno
reset role; set role authenticated; select pg_temp.como('b0000000-0000-0000-0000-000000000002');
select 'Gestora vê' t, string_agg(nome, ', ' order by nome) from crm_empresas;
insert into crm_etapas (nome) values ('Etapa nova');
insert into crm_negocios (empresa_id, titulo, responsavel_id, etapa_id) select id,'Negócio da Ana na empresa do Bruno','c0000000-0000-0000-0000-000000000003',(select id from crm_etapas order by ordem limit 1) from crm_empresas where nome='Do Bruno';
insert into crm_negocio_itens (negocio_id, descricao, quantidade, preco) select id,'Detergente',10,5 from crm_negocios;
update crm_empresas set responsavel_id='c0000000-0000-0000-0000-000000000003' where nome='sem nada'; -- nada
-- gestora importa notas fiscais: uma na empresa da Ana, uma só do Bruno, uma sem empresa
insert into crm_empresas (nome, responsavel_id) values ('Só do Bruno','d0000000-0000-0000-0000-000000000004');
insert into crm_notas (chave, emitida_em, empresa_id, valor_total) select repeat('1',44), now(), id, 100 from crm_empresas where nome='Da Ana';
insert into crm_notas (chave, emitida_em, empresa_id, valor_total) select repeat('2',44), now(), id, 200 from crm_empresas where nome='Só do Bruno';
insert into crm_notas (chave, emitida_em, valor_total) values (repeat('3',44), now(), 300);
-- venda do Bruno (vendedor escrito na nota) num cliente da Ana: os dois veem; ninguém mais
insert into crm_notas (chave, emitida_em, empresa_id, valor_total, vendedor_id) select repeat('5',44), now(), id, 400, 'd0000000-0000-0000-0000-000000000004' from crm_empresas where nome='Da Ana';
insert into crm_nota_itens (nota_id, descricao, quantidade, valor_total) select id, 'Item', 1, valor_total from crm_notas;
insert into crm_notas (chave, emitida_em) values ('123', now()); -- FALHA (chave inválida)
-- Ana de novo
select pg_temp.como('c0000000-0000-0000-0000-000000000003');
select 'Ana vê empresas' t, string_agg(nome, ', ' order by nome) from crm_empresas;
select 'Ana vê contatos/itens/atividades' t, (select count(*) from crm_contatos) c, (select count(*) from crm_negocio_itens) i, (select count(*) from crm_atividades) a;
update crm_empresas set cidade='X' where nome='Do Bruno' returning 'Ana alterou empresa do Bruno (NÃO devia)';
update crm_negocios set valor=50 returning 'Ana alterou o próprio negócio' as ok;
update crm_empresas set responsavel_id='d0000000-0000-0000-0000-000000000004' where nome='Da Ana'; -- FALHA (check)
delete from crm_empresas where nome='Da Ana' returning 'Ana apagou empresa (NÃO devia)';
update crm_etapas set nome='hack' returning 'Ana mexeu em etapa (NÃO devia)';
insert into crm_etapas (nome) values ('hack'); -- FALHA
update crm_usuarios set papel='admin' where user_id='c0000000-0000-0000-0000-000000000003' returning 'Ana virou admin (NÃO devia)';
select 'Ana vê notas (as da empresa dela: 100 e a venda do Bruno nela, 400)' t, (select string_agg(valor_total::text, ',') from crm_notas) notas, (select count(*) from crm_nota_itens) itens;
insert into crm_notas (chave, emitida_em) values (repeat('4',44), now()); -- FALHA
update crm_notas set valor_total=1 returning 'Ana alterou nota (NÃO devia)';
delete from crm_nota_itens returning 'Ana apagou item de nota (NÃO devia)';
select 'Ana vê histórico' t, count(*) from crm_historico;
select 'Ana vê usuários' t, count(*) from crm_usuarios;
-- cadastro duplicado: travado no banco mesmo em carteira que a Ana não vê
reset role; update crm_empresas set telefone='(11) 98888-7777', email='compras@bruno.com.br', cnpj='11.222.333/0001-81' where nome='Só do Bruno'; set role authenticated; select pg_temp.como('c0000000-0000-0000-0000-000000000003');
insert into crm_empresas (nome, responsavel_id, telefone) values ('Ana copiando telefone','c0000000-0000-0000-0000-000000000003','98888-7777'); -- FALHA (duplicado)
insert into crm_empresas (nome, responsavel_id, email) values ('Ana copiando e-mail','c0000000-0000-0000-0000-000000000003',' Compras@Bruno.com.br'); -- FALHA (duplicado)
insert into crm_empresas (nome, responsavel_id, cnpj) values ('Ana copiando CNPJ','c0000000-0000-0000-0000-000000000003','11222333000181'); -- FALHA (duplicado)
update crm_empresas set whatsapp='11 9 8888 7777' where nome='Da Ana'; -- FALHA (duplicado)
select 'Ana vê o aviso (só nome e carteira)' t, nome, responsavel, campo from crm_duplicado_empresa(null, array['988887777'], null);
update crm_empresas set cidade='Santo André', telefone=telefone where nome='Da Ana' returning 'Ana editou a própria empresa sem mexer nos dados' as ok;
select * from crm_acha_duplicado('11222333000181', null, null, null); -- FALHA (interna)
-- integrações: vendedora não vê nem cria chave; não escreve no registro
insert into crm_integracoes (nome, token_hash) values ('invasão', repeat('a',64)); -- FALHA
select 'Ana vê integrações/registro' t, (select count(*) from crm_integracoes) i, (select count(*) from crm_integracao_log) l;
insert into crm_integracao_log (arquivos) values (1); -- FALHA
-- Bruno: vê a própria empresa, não vê a da Ana
select pg_temp.como('d0000000-0000-0000-0000-000000000004');
select 'Bruno vê empresas' t, string_agg(nome, ', ' order by nome) from crm_empresas;
select 'Bruno vê negócios (o da Ana, na empresa dele)' t, count(*) from crm_negocios;
update crm_negocios set valor=1 returning 'Bruno alterou negócio da Ana (NÃO devia)';
select 'Bruno vê notas (a da empresa dele, 200, e a que ele vendeu, 400)' t, (select string_agg(valor_total::text, ',') from crm_notas) notas, (select count(*) from crm_nota_itens) itens;
-- de fora (logado, não está em crm_usuarios)
select pg_temp.como('e0000000-0000-0000-0000-000000000005');
select 'De fora vê' t, (select count(*) from crm_empresas) e, (select count(*) from crm_usuarios) u, (select count(*) from crm_etapas) et, (select count(*) from crm_config) cfg, (select count(*) from crm_notas) n, (select count(*) from crm_nota_itens) ni;
select crm_proximo_vendedor() as rodizio_de_fora;
insert into crm_empresas (nome, responsavel_id) values ('invasor','e0000000-0000-0000-0000-000000000005'); -- FALHA
-- comprador: só compras (notas, itens, estoque, clientes pela função); nada de cadastro/negócio/contato
reset role; insert into crm_usuarios (user_id,nome,papel,recebe_leads) values ('f0000000-0000-0000-0000-000000000006','Carlos Compras','comprador',true); set role authenticated; select pg_temp.como('f0000000-0000-0000-0000-000000000006');
select 'Comprador vê notas/itens/produtos/config/usuários' t, (select count(*) from crm_notas) n, (select count(*) from crm_nota_itens) ni, (select count(*) from crm_config) cfg, (select count(*) from crm_usuarios) u;
select 'Comprador vê empresas (NÃO devia)' t, count(*) from crm_empresas having count(*) > 0;
select 'Comprador vê contatos (NÃO devia)' t, count(*) from crm_contatos having count(*) > 0;
select 'Comprador vê negócios (NÃO devia)' t, count(*) from crm_negocios having count(*) > 0;
select 'Comprador vê atividades (NÃO devia)' t, count(*) from crm_atividades having count(*) > 0;
select 'Comprador vê histórico (NÃO devia)' t, count(*) from crm_historico having count(*) > 0;
select 'Comprador vê clientes pela função (só nome e ritmo)' t, count(*) from crm_clientes_compras();
insert into crm_estoque (codigo, descricao, quantidade, custo_total) values ('010503','AGUA SANITARIA 2L',68,343.40) returning 'comprador gravou estoque' as ok;
insert into crm_empresas (nome, responsavel_id) values ('comprador criando cliente','f0000000-0000-0000-0000-000000000006'); -- FALHA
insert into crm_atividades (empresa_id, descricao, responsavel_id) select id,'comprador','f0000000-0000-0000-0000-000000000006' from crm_notas where empresa_id is not null limit 1; -- FALHA
update crm_notas set valor_total = 1 returning 'Comprador alterou nota (NÃO devia)';
update crm_produtos set nome = 'hack' returning 'Comprador alterou produto (NÃO devia)';
-- vendedora e gestora não veem estoque nem clientes pela função; rodízio nunca cai no comprador
select pg_temp.como('c0000000-0000-0000-0000-000000000003');
select 'Ana vê estoque (NÃO devia)' t, count(*) from crm_estoque having count(*) > 0;
select 'Ana vê clientes de compras (NÃO devia)' t, count(*) from crm_clientes_compras() having count(*) > 0;
insert into crm_estoque (codigo, descricao) values ('x','x'); -- FALHA
select pg_temp.como('b0000000-0000-0000-0000-000000000002');
select 'Gestora vê estoque (NÃO devia)' t, count(*) from crm_estoque having count(*) > 0;
select 'Rodízio caiu no comprador (NÃO devia)' t from (select crm_proximo_vendedor() r) x where r = 'f0000000-0000-0000-0000-000000000006';
select pg_temp.como('a0000000-0000-0000-0000-000000000001');
select 'Admin vê estoque' t, count(*) from crm_estoque;
-- contas a receber: admin grava; gestora vê tudo; vendedor só os da carteira; comprador nada
select pg_temp.como('a0000000-0000-0000-0000-000000000001');
insert into crm_titulos (duplicata, empresa_id, vencimento, valor) select '000001/01', id, current_date - 10, 100 from crm_empresas where nome='Da Ana';
insert into crm_titulos (duplicata, empresa_id, vencimento, valor) select '000002/01', id, current_date + 10, 200 from crm_empresas where nome='Só do Bruno';
insert into crm_titulos (duplicata, vencimento, valor) values ('000003/01', current_date, 300) returning 'admin gravou títulos' as ok;
select pg_temp.como('b0000000-0000-0000-0000-000000000002');
select 'Gestora vê títulos' t, count(*) from crm_titulos;
insert into crm_titulos (duplicata, vencimento) values ('x', current_date); -- FALHA
update crm_titulos set empresa_id = empresa_id where duplicata = '000003/01' returning 'gestora repassou título (junção de duplicados)' as ok;
select pg_temp.como('c0000000-0000-0000-0000-000000000003');
select 'Ana vê título que não é dela (NÃO devia)' t, count(*) from crm_titulos where duplicata <> '000001/01' having count(*) > 0;
select 'Ana vê o título dela' t, count(*) from crm_titulos;
update crm_titulos set valor = 0 returning 'Ana alterou título (NÃO devia)';
select pg_temp.como('d0000000-0000-0000-0000-000000000004');
select 'Bruno vê título que não é dele (NÃO devia)' t, count(*) from crm_titulos where duplicata <> '000002/01' having count(*) > 0;
select pg_temp.como('f0000000-0000-0000-0000-000000000006');
select 'Comprador vê títulos (NÃO devia)' t, count(*) from crm_titulos having count(*) > 0;
select 'Comprador vê quando chegou o contas a receber' t, receber is not null from crm_fkn_atualizado();
select 'Comprador vê a situação do FKN' t, crm_fkn_situacao() ? 'recusas';
reset role; insert into crm_integracao_log (integracao_id, arquivos, erros, resumo) select id, 1, 1, '{"fkn_recusa":"marque Fornecedor","fkn_tipo":"produtos","arquivo":"x.csv"}'::jsonb from crm_integracoes limit 1;
set role authenticated; select pg_temp.como('f0000000-0000-0000-0000-000000000006');
select 'Comprador vê a recusa nova do FKN' t, jsonb_array_length(crm_fkn_situacao()->'recusas'), crm_fkn_situacao()->'recusas'->0->>'texto';
select pg_temp.como('c0000000-0000-0000-0000-000000000003');
select 'Ana vê datas do FKN (NÃO devia)' t, count(*) from crm_fkn_atualizado() having count(*) > 0;
select 'Ana vê situação do FKN (NÃO devia)' t from (select crm_fkn_situacao() x) y where x is not null;
-- Bruno desativado perde tudo
reset role; update crm_usuarios set ativo=false where nome='Bruno'; set role authenticated; select pg_temp.como('d0000000-0000-0000-0000-000000000004');
select 'Bruno desativado vê' t, count(*) from crm_empresas;
-- anon
reset role; set role anon; select pg_temp.como('');
select count(*) from crm_empresas; -- FALHA
select count(*) from crm_notas; -- FALHA
select crm_proximo_vendedor(); -- FALHA
select * from crm_duplicado_empresa('11222333000181', null, null); -- FALHA
reset role;
select 'historico' t, tabela, acao, mudancas from crm_historico where acao='update';
select 'etapa_desde mudou' t, (select count(*) from crm_negocios where etapa_desde > criado_em) ;
