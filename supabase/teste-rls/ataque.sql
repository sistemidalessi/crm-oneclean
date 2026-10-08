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
select 'Gestora vê títulos (NÃO devia)' t, count(*) from crm_titulos having count(*) > 0;
select 'Gestora vê as duplicatas em atraso de todos (com detalhe)' t, count(*), sum(valor) from crm_duplicatas_atraso();
select 'Gestora gravou títulos da nota pela função' t, crm_titulos_da_nota('[{"duplicata":"000009/01","nota_numero":9,"parcela":1,"vencimento":"2030-01-01","valor":50},{"duplicata":"000001/01","vencimento":"2030-01-01","valor":1}]'::jsonb);
select 'Gestora repassou títulos (junção de duplicados)' t, crm_titulos_troca_empresa(array[(select id from crm_empresas where nome='Só do Bruno')], (select id from crm_empresas where nome='Só do Bruno'));
select pg_temp.como('c0000000-0000-0000-0000-000000000003');
select 'Ana vê títulos e valores (NÃO devia)' t, count(*) from crm_titulos having count(*) > 0;
select 'Ana vê as duplicatas em atraso da carteira' t, count(*), sum(valor) from crm_duplicatas_atraso();
select 'Ana vê atraso que não é da carteira (NÃO devia)' t, count(*) from crm_duplicatas_atraso() v join crm_empresas e on e.id = v.empresa_id where e.nome <> 'Da Ana' having count(*) > 0;
select 'Ana vê título a vencer (NÃO devia)' t, count(*) from crm_duplicatas_atraso() where vencimento >= current_date having count(*) > 0;
select crm_titulos_da_nota('[]'::jsonb); -- FALHA
select crm_titulos_troca_empresa(array[]::uuid[], null); -- FALHA
insert into crm_titulos (duplicata, vencimento) values ('ana/01', current_date); -- FALHA
update crm_titulos set valor = 0 returning 'Ana alterou título (NÃO devia)';
select pg_temp.como('d0000000-0000-0000-0000-000000000004');
select 'Bruno vê títulos (NÃO devia)' t, count(*) from crm_titulos having count(*) > 0;
select 'Bruno vê atraso (o título dele não venceu)' t, count(*) from crm_duplicatas_atraso();
select pg_temp.como('f0000000-0000-0000-0000-000000000006');
select 'Comprador vê títulos (NÃO devia)' t, count(*) from crm_titulos having count(*) > 0;
select 'Comprador vê duplicatas em atraso (NÃO devia)' t, count(*) from crm_duplicatas_atraso() having count(*) > 0;
select crm_titulos_da_nota('[]'::jsonb); -- FALHA
select 'Comprador vê quando chegou o contas a receber (NÃO devia)' t from crm_fkn_atualizado() where receber is not null;
select 'Comprador vê quando chegou o estoque' t, estoque is not null from crm_fkn_atualizado();
select 'Comprador vê a situação do FKN' t, crm_fkn_situacao() ? 'recusas';
select 'Comprador vê a data do contas a receber na situação (NÃO devia)' t where crm_fkn_situacao()->>'receber' is not null;
select 'Comprador vê a data do contas a pagar na situação (NÃO devia)' t where crm_fkn_situacao()->>'pagar' is not null;
reset role; insert into crm_integracao_log (integracao_id, arquivos, erros, resumo) select id, 1, 1, '{"fkn_recusa":"marque Fornecedor","fkn_tipo":"produtos","arquivo":"x.csv"}'::jsonb from crm_integracoes limit 1;
reset role; insert into crm_integracao_log (integracao_id, arquivos, erros, resumo) select id, 1, 1, '{"fkn_recusa":"marque Listar os dados cadastrais","fkn_tipo":"receber","arquivo":"r.csv"}'::jsonb from crm_integracoes limit 1;
set role authenticated; select pg_temp.como('f0000000-0000-0000-0000-000000000006');
select 'Comprador vê a recusa nova do FKN (só a do estoque)' t, jsonb_array_length(crm_fkn_situacao()->'recusas'), crm_fkn_situacao()->'recusas'->0->>'texto';
select 'Comprador vê recusa do contas a receber (NÃO devia)' t from jsonb_array_elements(crm_fkn_situacao()->'recusas') x where x->>'tipo' = 'receber';
select pg_temp.como('a0000000-0000-0000-0000-000000000001');
select 'Admin vê os títulos' t, count(*) from crm_titulos;
select 'Admin vê as duas recusas' t, jsonb_array_length(crm_fkn_situacao()->'recusas');
select pg_temp.como('c0000000-0000-0000-0000-000000000003');
select 'Ana vê datas do FKN (NÃO devia)' t, count(*) from crm_fkn_atualizado() having count(*) > 0;
select 'Ana vê situação do FKN (NÃO devia)' t from (select crm_fkn_situacao() x) y where x is not null;
-- financeiro (contas a pagar, caixa): SÓ o admin — nem a gestora (tem salário e pró-labore)
select pg_temp.como('a0000000-0000-0000-0000-000000000001');
insert into crm_fin_recorrentes (descricao, categoria, valor, dia) values ('Salário vendedora', 'Salários', 3500, 5) returning 'admin criou recorrente' as ok;
insert into crm_fin_lancamentos (descricao, categoria, valor, vencimento, recorrente_id, competencia, origem)
  select 'Salário vendedora', 'Salários', 3500, current_date, id, date_trunc('month', current_date)::date, 'recorrente' from crm_fin_recorrentes returning 'admin gerou a conta do mês' as ok;
insert into crm_fin_lancamentos (descricao, valor, vencimento, recorrente_id, competencia)
  select 'de novo', 1, current_date, id, date_trunc('month', current_date)::date from crm_fin_recorrentes; -- FALHA (uma por recorrente e mês)
insert into crm_fin_lancamentos (descricao, valor, vencimento, situacao) values ('pago sem data', 1, current_date, 'pago'); -- FALHA
insert into crm_fin_saldos (data, valor) values (current_date, 8052.79) returning 'admin informou o saldo' as ok;
update crm_fin_lancamentos set situacao = 'pago', pago_em = current_date, baixa = 'caixa', baixado_em = now() returning 'admin pagou no caixa' as ok;
update crm_fin_lancamentos set frase = 'salário 3500 pago hoje', frase_antes = '{"situacao":"aberto"}' returning 'admin baixou por frase' as ok;
insert into crm_fin_regras (tipo, chave, categoria) values ('saida', 'almoco', 'Alimentação') returning 'admin lembrou regra' as ok;
insert into crm_fin_regras (tipo, chave, categoria) values ('saida', 'almoco', 'Outra'); -- FALHA (uma por palavra)
select pg_temp.como('b0000000-0000-0000-0000-000000000002');
select 'Gestora vê contas a pagar (NÃO devia)' t, count(*) from crm_fin_lancamentos having count(*) > 0;
select 'Gestora vê recorrentes (NÃO devia)' t, count(*) from crm_fin_recorrentes having count(*) > 0;
select 'Gestora vê saldo (NÃO devia)' t, count(*) from crm_fin_saldos having count(*) > 0;
select 'Gestora vê regras do caixa (NÃO devia)' t, count(*) from crm_fin_regras having count(*) > 0;
update crm_fin_regras set categoria = 'x' returning 'Gestora alterou regra (NÃO devia)';
insert into crm_fin_lancamentos (descricao, valor, vencimento) values ('gestora', 1, current_date); -- FALHA
insert into crm_fin_saldos (data, valor) values (current_date, 1); -- FALHA
update crm_fin_lancamentos set valor = 0 returning 'Gestora alterou conta (NÃO devia)';
delete from crm_fin_lancamentos returning 'Gestora apagou conta (NÃO devia)';
select pg_temp.como('c0000000-0000-0000-0000-000000000003');
select 'Ana vê contas a pagar (NÃO devia)' t, count(*) from crm_fin_lancamentos having count(*) > 0;
select 'Ana vê saldo (NÃO devia)' t, count(*) from crm_fin_saldos having count(*) > 0;
select 'Ana vê regras do caixa (NÃO devia)' t, count(*) from crm_fin_regras having count(*) > 0;
insert into crm_fin_regras (tipo, chave) values ('saida', 'ana'); -- FALHA
insert into crm_fin_recorrentes (descricao, valor, dia) values ('ana', 1, 1); -- FALHA
select pg_temp.como('f0000000-0000-0000-0000-000000000006');
select 'Comprador vê contas a pagar (NÃO devia)' t, count(*) from crm_fin_lancamentos having count(*) > 0;
select 'Comprador vê recorrentes (NÃO devia)' t, count(*) from crm_fin_recorrentes having count(*) > 0;
select 'Comprador vê saldo (NÃO devia)' t, count(*) from crm_fin_saldos having count(*) > 0;
select 'Comprador vê regras do caixa (NÃO devia)' t, count(*) from crm_fin_regras having count(*) > 0;
update crm_fin_saldos set valor = 0 returning 'Comprador alterou saldo (NÃO devia)';
select pg_temp.como('a0000000-0000-0000-0000-000000000001');
select 'Admin vê financeiro' t, (select count(*) from crm_fin_lancamentos) l, (select count(*) from crm_fin_recorrentes) r, (select count(*) from crm_fin_saldos) s, (select count(*) from crm_fin_regras) g;
select 'Financeiro no histórico (NÃO devia)' t, count(*) from crm_historico where tabela like 'crm_fin%' having count(*) > 0;
-- títulos baixados no FKN (07/10/2026): o título que sai sem "Recebi" no Caixa fica guardado; recebido, nota cancelada e o que volta, não
select pg_temp.como('a0000000-0000-0000-0000-000000000001');
insert into crm_fin_lancamentos (tipo, descricao, valor, vencimento, situacao, pago_em, baixa, titulo_duplicata) values ('entrada', 'Recebido 000002/01', 200, current_date, 'pago', current_date, 'caixa', '000002/01');
delete from crm_titulos where duplicata in ('000002/01', '000003/01');
insert into crm_notas (chave, numero, emitida_em, cancelada) values (repeat('9',44), 9, now(), true);
select pg_temp.como('b0000000-0000-0000-0000-000000000002');
select 'Gestora tirou títulos da nota cancelada pela função' t, crm_titulos_da_nota('[]'::jsonb, array['000009']);
select 'Gestora vê títulos baixados (NÃO devia)' t, count(*) from crm_fin_titulos_baixados having count(*) > 0;
insert into crm_fin_titulos_baixados (duplicata, valor) values ('x', 1); -- FALHA
select pg_temp.como('a0000000-0000-0000-0000-000000000001');
select 'Baixados no FKN (só 000003/01 pendente; 000009/01 cancelada; 000002/01 recebido não entra)' t, string_agg(duplicata || ':' || coalesce(resolvido, 'pendente'), ',' order by duplicata) from crm_fin_titulos_baixados;
select 'Recebido no Caixa virou baixado (NÃO devia)' t, count(*) from crm_fin_titulos_baixados where duplicata = '000002/01' having count(*) > 0;
insert into crm_titulos (duplicata, vencimento, valor) values ('000003/01', current_date, 300);
select 'Título que voltou continua baixado (NÃO devia)' t, count(*) from crm_fin_titulos_baixados where duplicata = '000003/01' having count(*) > 0;
delete from crm_titulos where duplicata = '000003/01';
update crm_fin_titulos_baixados set resolvido = 'nao_entrou', resolvido_em = now() where duplicata = '000003/01' returning 'admin marcou não entrou' as ok;
-- cadência de e-mails (07/10/2026): vendedora só pula (o envio vem da função), só na carteira dela; ninguém desfaz o "não quero receber"
reset role; update crm_empresas set email_sair_em = now(), email_cadencia = 'mensal' where nome = 'Da Ana'; set role authenticated;
select pg_temp.como('b0000000-0000-0000-0000-000000000002');
insert into crm_email_campanhas (assunto, corpo) values ('Novidades de outubro', '{saudacao} Chegaram produtos novos.') returning 'gestora criou campanha' as ok;
select pg_temp.como('c0000000-0000-0000-0000-000000000003');
select 'Ana lê campanhas' t, count(*) from crm_email_campanhas;
insert into crm_email_campanhas (assunto, corpo) values ('ana', 'ana'); -- FALHA
insert into crm_email_envios (empresa_id, tipo, situacao, enviado_por) select id, 'reposicao', 'pulado', 'c0000000-0000-0000-0000-000000000003' from crm_empresas where nome = 'Da Ana' returning 'Ana pulou um e-mail da carteira dela' as ok;
insert into crm_email_envios (empresa_id, tipo, situacao, enviado_por) select id, 'reposicao', 'enviado', 'c0000000-0000-0000-0000-000000000003' from crm_empresas where nome = 'Da Ana'; -- FALHA
reset role; insert into crm_email_envios (empresa_id, tipo, situacao) select id, 'relacionamento', 'enviado' from crm_empresas where nome = 'Só do Bruno'; set role authenticated; select pg_temp.como('c0000000-0000-0000-0000-000000000003');
select 'Ana vê e-mail da carteira do Bruno (NÃO devia)' t, count(*) from crm_email_envios e join crm_empresas x on x.id = e.empresa_id where x.nome = 'Só do Bruno' having count(*) > 0;
insert into crm_email_envios (empresa_id, tipo, situacao, enviado_por) select id, 'reposicao', 'pulado', 'c0000000-0000-0000-0000-000000000003' from (select id from crm_empresas where nome = 'Só do Bruno' union all select null::uuid where false) z; -- não vê a empresa: nada (ou FALHA)
update crm_empresas set email_sair_em = null where nome = 'Da Ana';
select 'Ana desfez o "não quero receber" (NÃO devia)' t, count(*) from crm_empresas where nome = 'Da Ana' and email_sair_em is null having count(*) > 0;
update crm_email_envios set situacao = 'enviado' returning 'Ana alterou e-mail enviado (NÃO devia)';
select pg_temp.como('f0000000-0000-0000-0000-000000000006');
select 'Comprador vê e-mails da cadência (NÃO devia)' t, count(*) from crm_email_envios having count(*) > 0;
select pg_temp.como('a0000000-0000-0000-0000-000000000001');
select 'Admin vê e-mails da cadência' t, count(*) from crm_email_envios;
-- Bruno desativado perde tudo
reset role; update crm_usuarios set ativo=false where nome='Bruno'; set role authenticated; select pg_temp.como('d0000000-0000-0000-0000-000000000004');
select 'Bruno desativado vê' t, count(*) from crm_empresas;
-- anon
reset role; set role anon; select pg_temp.como('');
select count(*) from crm_empresas; -- FALHA
select count(*) from crm_notas; -- FALHA
select count(*) from crm_fin_lancamentos; -- FALHA
select count(*) from crm_fin_saldos; -- FALHA
select count(*) from crm_fin_regras; -- FALHA
select count(*) from crm_fin_titulos_baixados; -- FALHA
select count(*) from crm_email_envios; -- FALHA
select count(*) from crm_email_campanhas; -- FALHA
select crm_proximo_vendedor(); -- FALHA
select * from crm_duplicado_empresa('11222333000181', null, null); -- FALHA
reset role;
select 'historico' t, tabela, acao, mudancas from crm_historico where acao='update';
select 'etapa_desde mudou' t, (select count(*) from crm_negocios where etapa_desde > criado_em) ;

-- =================================================================== espelho Agilité ↔ OneClean (08/10/2026)
-- quem não é administrador não lê a fila, o registro, nem a senha; ninguém do app chama aplicar/pacote/tick
reset role; set role authenticated; select pg_temp.como('b0000000-0000-0000-0000-000000000002');
select 'Gestora lê a senha da Agilité (NÃO devia)' t, count(*) from crm_fin_espelho_cfg having count(*) >= 0; -- FALHA
select 'Gestora vê a fila do espelho (NÃO devia)' t, count(*) from crm_fin_espelho_fila having count(*) > 0;
select crm_espelho_configura('https://x.invalido/api', 'senha'); -- FALHA
select crm_espelho_nova_senha(); -- FALHA
select 'Gestora vê a situação do espelho (NÃO devia)' t from (select crm_espelho_situacao() s) x where s is not null;
select crm_espelho_aplicar('{"versao":1,"origem":"agilite","par":"agilite:1","apagar":true}'); -- FALHA
select crm_espelho_pacote('oneclean:00000000-0000-0000-0000-000000000000'); -- FALHA
select crm_espelho_tick(); -- FALHA
select pg_temp.como('a0000000-0000-0000-0000-000000000001');
select 'Admin lê a senha da Agilité (NÃO devia)' t, count(*) from crm_fin_espelho_cfg having count(*) >= 0; -- FALHA
select crm_espelho_aplicar('{"versao":1,"origem":"agilite","par":"agilite:1","apagar":true}'); -- FALHA
select crm_espelho_configura('http://sem-https', 'x'); -- FALHA
select 'admin configurou o espelho' t from (select crm_espelho_configura('https://agilite.exemplo/api/caixa/espelho', 'senha-de-teste')) x;
select 'senha de gravação gerada' t from (select crm_espelho_nova_senha() k) x where length(k) = 64;
select 'Situação não mostra a senha (NÃO devia)' t from (select crm_espelho_situacao()::text s) x where s like '%senha-de-teste%';
select (crm_espelho_situacao() ->> 'tem_senha') = 'true' as espelho_tem_senha;
reset role; set role anon;
select count(*) from crm_fin_espelho_fila; -- FALHA
select crm_espelho_situacao(); -- FALHA
reset role;

-- funcionamento (como a função crm-caixa-espelho e o pg_cron chamam)
delete from crm_fin_lancamentos;
delete from crm_fin_espelho_fila;
-- 1) lançado no CRM: "emprestei 1.500 pra Agilité, devolve dia 14" (ida + volta criada pela frase)
insert into crm_fin_lancamentos (id, tipo, descricao, fornecedor, categoria, valor, vencimento, situacao, pago_em, baixa, baixado_em, entre_empresas, frase_antes)
values ('11111111-1111-1111-1111-111111111111', 'saida', 'Transferência para a Agilité', 'Agilité', 'Transferência entre empresas', 1500, '2026-10-07', 'pago', '2026-10-07', 'caixa', now(), true,
        '{"criou":{"lancamentos":["22222222-2222-2222-2222-222222222222"],"recorrentes":[]}}'),
       ('22222222-2222-2222-2222-222222222222', 'entrada', 'Agilité devolve a transferência', 'Agilité', 'Transferência entre empresas', 1500, '2026-10-14', 'aberto', null, null, null, true, null);
insert into crm_fin_lancamentos (tipo, descricao, categoria, valor, vencimento) values ('saida', 'Fornecedor qualquer', 'Fornecedores', 10, '2026-10-09');
select 'fila depois da frase' t, string_agg(par, ',') from crm_fin_espelho_fila;
select case when (select count(*) from crm_fin_espelho_fila) = 1 and (select par from crm_fin_espelho_fila) = 'oneclean:11111111-1111-1111-1111-111111111111'
  then 'ida e volta da frase = um par só' else 'par errado na fila (NÃO devia)' end;
select case when p ->> 'apagar' is null and jsonb_array_length(p -> 'movimentos') = 2
             and p -> 'movimentos' -> 0 ->> 'papel' = 'ida' and p -> 'movimentos' -> 0 ->> 'situacao' = 'realizado' and p -> 'movimentos' -> 0 ->> 'tipo' = 'saida'
             and p -> 'movimentos' -> 1 ->> 'papel' = 'volta' and p -> 'movimentos' -> 1 ->> 'ref' = 'oneclean:22222222-2222-2222-2222-222222222222'
  then 'pacote da OneClean certo' else 'pacote errado (NÃO devia): ' || p::text end
  from (select crm_espelho_pacote('oneclean:11111111-1111-1111-1111-111111111111') p) x;
select case when count(*) = 2 then 'par marcado nas duas linhas' else 'par não marcado (NÃO devia)' end from crm_fin_lancamentos where espelho_par = 'oneclean:11111111-1111-1111-1111-111111111111';
-- 2) a Agilité deu ✓ na volta (ref original nosso): só data/valor/situação, sem eco
delete from crm_fin_espelho_fila;
select crm_espelho_aplicar('{"versao":1,"origem":"agilite","par":"oneclean:11111111-1111-1111-1111-111111111111","movimentos":[
  {"ref":"oneclean:11111111-1111-1111-1111-111111111111","papel":"ida","data":"2026-10-07","tipo":"entrada","valor":1500,"descricao":"x","situacao":"realizado"},
  {"ref":"oneclean:22222222-2222-2222-2222-222222222222","papel":"volta","data":"2026-10-13","tipo":"saida","valor":1500,"descricao":"x","situacao":"realizado"}]}') ->> 'atualizados' as atualizados_2;
select case when situacao = 'pago' and pago_em = '2026-10-13' and baixa = 'caixa' then 'volta paga pela Agilité' else 'volta não atualizou (NÃO devia)' end from crm_fin_lancamentos where id = '22222222-2222-2222-2222-222222222222';
select case when count(*) = 0 then 'sem eco' else 'eco na fila (NÃO devia)' end from crm_fin_espelho_fila;
-- 3) par nascido na Agilité: cria a entrada e a saída prevista aqui (tipo invertido); de novo = atualiza
select crm_espelho_aplicar('{"versao":1,"origem":"agilite","par":"agilite:45","movimentos":[
  {"ref":"agilite:45","papel":"ida","data":"2026-10-08","tipo":"saida","valor":10,"descricao":"transferi 10 reais pra OneClean","situacao":"realizado"},
  {"ref":"agilite:46","papel":"volta","data":"2026-10-09","tipo":"entrada","valor":10,"descricao":"OneClean devolve","situacao":"previsto"}]}') ->> 'novos' as novos_3;
select crm_espelho_aplicar('{"versao":1,"origem":"agilite","par":"agilite:45","movimentos":[
  {"ref":"agilite:45","papel":"ida","data":"2026-10-08","tipo":"saida","valor":10,"descricao":"x","situacao":"realizado"},
  {"ref":"agilite:46","papel":"volta","data":"2026-10-10","tipo":"entrada","valor":10,"descricao":"x","situacao":"previsto"}]}') ->> 'novos' as novos_de_novo;
select case when count(*) = 2 and bool_and(espelho_ref is not null and entre_empresas)
             and count(*) filter (where tipo = 'entrada' and situacao = 'pago' and descricao = 'Transferência da Agilité') = 1
             and count(*) filter (where tipo = 'saida' and situacao = 'aberto' and vencimento = '2026-10-10') = 1
  then 'espelho da Agilité certo (sem duplicar)' else 'espelho errado (NÃO devia)' end from crm_fin_lancamentos where espelho_par = 'agilite:45';
-- 4) o administrador dá ✓ aqui na devolução espelhada: vai para a fila com o ref original
update crm_fin_lancamentos set situacao = 'pago', pago_em = '2026-10-10', baixa = 'caixa', baixado_em = now() where espelho_ref = 'agilite:46';
select case when p -> 'movimentos' -> 1 ->> 'ref' = 'agilite:46' and p -> 'movimentos' -> 1 ->> 'situacao' = 'realizado' and p -> 'movimentos' -> 1 ->> 'tipo' = 'saida'
  then 'aviso volta com o ref da Agilité' else 'aviso errado (NÃO devia): ' || p::text end
  from crm_fin_espelho_fila f, lateral (select crm_espelho_pacote(f.par) p) x where f.par = 'agilite:45';
-- 5) a Agilité desfez só a volta: o par chega sem ela → some aqui
select crm_espelho_aplicar('{"versao":1,"origem":"agilite","par":"agilite:45","movimentos":[
  {"ref":"agilite:45","papel":"ida","data":"2026-10-08","tipo":"saida","valor":10,"descricao":"x","situacao":"realizado"}]}') ->> 'apagados' as apagados_5;
-- 6) a Agilité desfez a ida: apaga o par inteiro
select crm_espelho_aplicar('{"versao":1,"origem":"agilite","par":"agilite:45","apagar":true}') ->> 'apagados' as apagados_6;
select case when count(*) = 0 then 'par da Agilité apagado' else 'sobrou espelho (NÃO devia)' end from crm_fin_lancamentos where espelho_par = 'agilite:45';
-- 7) adotar o lançamento manual (mesmo tipo invertido, dia e valor) em vez de duplicar
insert into crm_fin_lancamentos (tipo, descricao, categoria, valor, vencimento, situacao, pago_em, baixa, baixado_em, entre_empresas)
values ('entrada', 'Transferência da Agilité (à mão)', 'Transferência entre empresas', 1600, '2026-10-06', 'pago', '2026-10-06', 'caixa', now(), true);
select crm_espelho_aplicar('{"versao":1,"origem":"agilite","par":"agilite:30","movimentos":[
  {"ref":"agilite:30","papel":"ida","data":"2026-10-06","tipo":"saida","valor":1600,"descricao":"x","situacao":"realizado"}]}') ->> 'adotados' as adotados_7;
select case when count(*) = 1 then 'lançamento manual adotado' else 'duplicou o manual (NÃO devia)' end from crm_fin_lancamentos where valor = 1600;
-- 8) desfazer no CRM a ida da frase (apaga as duas): o aviso é "apagar o par"
delete from crm_fin_espelho_fila;
delete from crm_fin_lancamentos where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
select case when crm_espelho_pacote(par) ->> 'apagar' = 'true' then 'desfeito no CRM: apagar o par' else 'não pediu para apagar (NÃO devia)' end
  from crm_fin_espelho_fila where par = 'oneclean:11111111-1111-1111-1111-111111111111';
-- 9) formato inválido: recusa sem gravar
select crm_espelho_aplicar('{"versao":1,"origem":"agilite","par":"agilite:1;drop","movimentos":[]}'); -- FALHA
select crm_espelho_aplicar('{"versao":1,"origem":"oneclean","par":"agilite:1","apagar":true}'); -- FALHA
select crm_espelho_aplicar('{"versao":1,"origem":"agilite","par":"agilite:2","movimentos":[{"ref":"agilite:2","tipo":"saida","valor":-5,"data":"2026-10-08","situacao":"realizado"}]}'); -- FALHA
