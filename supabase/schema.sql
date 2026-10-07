-- CRM Sistemi Dalessi — esquema completo + RLS (v2: equipe de vendas).
--
-- Rodar num projeto Supabase PRÓPRIO de cada cliente (um banco por empresa;
-- nunca misturar com o banco de outro sistema). SQL Editor -> colar -> Run.
-- Pode rodar de novo: "if not exists" nas tabelas/colunas, "or replace" nas
-- funções, drop/create nas políticas e triggers. Não apaga dado.
--
-- Papéis (crm_usuarios.papel):
--   admin    - tudo, inclusive usuários e configurações;
--   gestor   - vê e edita a base inteira, redistribui carteira, relatórios, configurações;
--   vendedor - vê só a PRÓPRIA carteira: empresas em que é responsável, ou em que
--              tem negócio. Não troca o responsável, não apaga empresa nem negócio.
--   comprador - só a tela Compras: lê notas e itens (para a demanda), produtos, estoque
--              (lê e atualiza) e, por crm_clientes_compras(), só nome/ritmo dos clientes.
--              Não vê contatos, negócios, tarefas nem telefone/e-mail de cliente. Não recebe leads.
-- Quem não está em crm_usuarios (ou está com ativo = false) não vê nada.
--
-- Lições da auditoria de 11/09/2026 aplicadas: nenhuma política "using (true)";
-- SECURITY DEFINER sempre com search_path fixo e sem execute para anon; anon
-- sem privilégio em tabela nenhuma; desligar o cadastro público do Auth na tela
-- (Authentication -> Sign In / Providers -> "Allow new users to sign up" = off).

-- =================================================================== usuários
create table if not exists public.crm_usuarios (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  nome         text not null check (length(btrim(nome)) > 0),
  email        text,
  papel        text not null default 'vendedor' check (papel in ('admin','gestor','vendedor','comprador')),
  equipe       text,
  ativo        boolean not null default true,
  recebe_leads boolean not null default true,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- Telefone/WhatsApp da linha da vendedora (aparece na proposta).
alter table public.crm_usuarios add column if not exists telefone text;

create or replace function public.crm_papel()
returns text language sql stable security definer set search_path = public as $$
  select papel from public.crm_usuarios where user_id = auth.uid() and ativo;
$$;
-- Ativo = qualquer usuário do CRM (lê configuração, produtos, a equipe). Membro = equipe de
-- vendas (admin/gestor/vendedor): só membro cria e mexe em cadastro, negócio e tarefa.
create or replace function public.crm_eh_ativo()
returns boolean language sql stable security definer set search_path = public as $$
  select public.crm_papel() is not null;
$$;
create or replace function public.crm_eh_membro()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.crm_papel() in ('admin','gestor','vendedor'), false);
$$;
create or replace function public.crm_eh_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.crm_papel() in ('admin','gestor'), false);
$$;
create or replace function public.crm_eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.crm_papel() = 'admin', false);
$$;
create or replace function public.crm_eh_comprador()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.crm_papel() = 'comprador', false);
$$;
-- Instalação antiga: a trava de papel nasceu sem o comprador.
alter table public.crm_usuarios drop constraint if exists crm_usuarios_papel_check;
alter table public.crm_usuarios add constraint crm_usuarios_papel_check check (papel in ('admin','gestor','vendedor','comprador'));

create or replace function public.crm_toca_atualizado_em()
returns trigger language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- =================================================================== configuração
create table if not exists public.crm_config (
  id            int primary key default 1 check (id = 1),
  dados         jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
insert into public.crm_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.crm_etapas (
  id            uuid primary key default gen_random_uuid(),
  funil         text not null default 'Vendas',
  nome          text not null check (length(btrim(nome)) > 0),
  ordem         int not null default 0,
  probabilidade int not null default 0 check (probabilidade between 0 and 100),
  externo_id    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Listas editáveis: origem, segmento, motivo_perda.
create table if not exists public.crm_opcoes (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in ('origem','segmento','motivo_perda')),
  nome          text not null check (length(btrim(nome)) > 0),
  ordem         int not null default 0,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (tipo, nome)
);

create table if not exists public.crm_produtos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(btrim(nome)) > 0),
  codigo        text,
  unidade       text,
  categoria     text,
  preco         numeric(14,2) not null default 0 check (preco >= 0),
  ativo         boolean not null default true,
  externo_id    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- Foto do produto: SEM USO desde 02/10/2026 (as fotos saíram do orçamento a pedido do Anderson);
-- a coluna e o bucket crm-fotos ficam por existirem em produção, vazios.
alter table public.crm_produtos add column if not exists foto text;

create table if not exists public.crm_modelos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(btrim(nome)) > 0),
  canal         text not null default 'whatsapp' check (canal in ('whatsapp','email')),
  assunto       text,
  corpo         text not null default '',
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.crm_metas (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references public.crm_usuarios(user_id) on delete cascade,
  mes           date not null check (extract(day from mes) = 1),
  valor         numeric(14,2) not null default 0 check (valor >= 0),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (usuario_id, mes)
);

create table if not exists public.crm_filtros (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null default auth.uid() references public.crm_usuarios(user_id) on delete cascade,
  tela          text not null,
  nome          text not null check (length(btrim(nome)) > 0),
  filtros       jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- =================================================================== base comercial
create table if not exists public.crm_empresas (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null check (length(btrim(nome)) > 0),
  razao_social        text,
  cnpj                text,
  situacao            text not null default 'lead' check (situacao in ('lead','prospect','cliente','inativo')),
  segmento            text,
  origem              text,
  qualificacao        int not null default 0 check (qualificacao between 0 and 5),
  responsavel_id      uuid references public.crm_usuarios(user_id) on delete set null,
  telefone            text,
  whatsapp            text,
  email               text,
  site                text,
  cep                 text,
  logradouro          text,
  numero              text,
  complemento         text,
  bairro              text,
  cidade              text,
  uf                  text,
  tags                text[] not null default '{}',
  observacoes         text,
  ciclo_recompra_dias int check (ciclo_recompra_dias is null or ciclo_recompra_dias > 0),
  externo_id          text,
  criado_por          uuid default auth.uid(),
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create table if not exists public.crm_contatos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.crm_empresas(id) on delete cascade,
  nome          text not null check (length(btrim(nome)) > 0),
  cargo         text,
  telefone      text,
  celular       text,
  whatsapp      text,
  email         text,
  principal     boolean not null default false,
  aniversario   date,
  tags          text[] not null default '{}',
  observacoes   text,
  externo_id    text,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.crm_negocios (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references public.crm_empresas(id) on delete cascade,
  contato_id          uuid references public.crm_contatos(id) on delete set null,
  titulo              text not null check (length(btrim(titulo)) > 0),
  etapa_id            uuid references public.crm_etapas(id) on delete set null,
  status              text not null default 'aberto' check (status in ('aberto','ganho','perdido')),
  valor               numeric(14,2) not null default 0 check (valor >= 0),
  probabilidade       int check (probabilidade is null or probabilidade between 0 and 100),
  previsao_fechamento date,
  responsavel_id      uuid references public.crm_usuarios(user_id) on delete set null,
  origem              text,
  motivo_perda        text,
  fechado_em          date,
  etapa_desde         timestamptz not null default now(),
  observacoes         text,
  externo_id          text,
  criado_por          uuid default auth.uid(),
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create table if not exists public.crm_negocio_itens (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null references public.crm_negocios(id) on delete cascade,
  produto_id    uuid references public.crm_produtos(id) on delete set null,
  descricao     text not null check (length(btrim(descricao)) > 0),
  quantidade    numeric(14,3) not null default 1 check (quantidade > 0),
  preco         numeric(14,2) not null default 0 check (preco >= 0),
  desconto      numeric(5,2) not null default 0 check (desconto between 0 and 100),
  ordem         int not null default 0,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.crm_propostas (
  id            uuid primary key default gen_random_uuid(),
  numero        bigint generated by default as identity,
  negocio_id    uuid not null references public.crm_negocios(id) on delete cascade,
  status        text not null default 'rascunho' check (status in ('rascunho','enviada','aprovada','recusada')),
  enviada_em    date,
  validade      date,
  respondida_em date,
  itens         jsonb not null default '[]'::jsonb,
  valor_total   numeric(14,2) not null default 0,
  condicoes     text,
  observacoes   text,
  link_anexo    text,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- Orçamento importado do FKN (orcamento.js): número do orçamento lá e o que mais veio dele
-- (condição de pagamento, cobrança, frete, transportadora, entrega, A/C…), para o PDF.
alter table public.crm_propostas add column if not exists numero_fkn text;
alter table public.crm_propostas add column if not exists dados jsonb not null default '{}'::jsonb;
create index if not exists crm_propostas_numero_fkn_idx on public.crm_propostas (numero_fkn);

-- Atividade: registro (concluida = true) ou tarefa agendada (concluida = false).
create table if not exists public.crm_atividades (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.crm_empresas(id) on delete cascade,
  contato_id     uuid references public.crm_contatos(id) on delete set null,
  negocio_id     uuid references public.crm_negocios(id) on delete set null,
  tipo           text not null default 'tarefa'
                 check (tipo in ('tarefa','ligacao','reuniao','visita','email','whatsapp','proposta','nota','ocorrencia','sistema')),
  descricao      text not null check (length(btrim(descricao)) > 0),
  data_hora      timestamptz not null default now(),
  concluida      boolean not null default false,
  concluida_em   timestamptz,
  responsavel_id uuid references public.crm_usuarios(user_id) on delete set null,
  recorrencia    text check (recorrencia is null or recorrencia in ('diaria','semanal','quinzenal','mensal')),
  automatica     boolean not null default false,
  externo_id     text,
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Notas fiscais de venda (NF-e importada do XML): base dos relatórios de faturamento
-- (quem mais comprou, produtos, segmentos) e das "compras anteriores" do cliente.
-- Só gestor importa; o vendedor vê as notas das empresas que ele vê.
create table if not exists public.crm_notas (
  id             uuid primary key default gen_random_uuid(),
  chave          text not null check (chave ~ '^[0-9]{44}$'),
  numero         bigint,
  serie          text,
  emitida_em     timestamptz not null,
  empresa_id     uuid references public.crm_empresas(id) on delete set null,
  cliente_doc    text,
  cliente_nome   text,
  cidade         text,
  uf             text,
  natureza       text,
  valor_produtos numeric(14,2) not null default 0,
  valor_total    numeric(14,2) not null default 0,
  cancelada      boolean not null default false,
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create table if not exists public.crm_nota_itens (
  id             uuid primary key default gen_random_uuid(),
  nota_id        uuid not null references public.crm_notas(id) on delete cascade,
  ordem          int not null default 0,
  produto_id     uuid references public.crm_produtos(id) on delete set null,
  codigo         text,
  descricao      text not null check (length(btrim(descricao)) > 0),
  ncm            text,
  cfop           text,
  unidade        text,
  quantidade     numeric(14,4) not null default 0,
  valor_unitario numeric(16,6) not null default 0,
  valor_total    numeric(14,2) not null default 0,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Integrações: o vigia da pasta de XML (ferramentas/vigia-notas.js) entrega as notas pela Edge
-- Function crm-notas com uma chave própria, que só serve para isso. Aqui fica só o hash SHA-256
-- da chave (ela aparece uma vez, na hora de gerar). Só o administrador vê e mexe.
create table if not exists public.crm_integracoes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(btrim(nome)) > 0),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  filtro        text not null default 'auto' check (filtro in ('auto','vendedores','carteira','todas')),
  ativo         boolean not null default true,
  ultimo_uso    timestamptz,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Vendedor da nota (o escrito no infCpl, "VENDEDOR: NOME"): os relatórios de faturamento e a
-- Gestão contam a venda para ele (DIRETO, vendedora externa…); sem ele, a carteira do cliente.
-- nomes_nota: como o usuário aparece nas notas quando não é pelo nome (ex.: DIRETO = o dono).
alter table public.crm_notas add column if not exists vendedor_nome text;
alter table public.crm_notas add column if not exists vendedor_id uuid references public.crm_usuarios(user_id) on delete set null;
create index if not exists crm_notas_vendedor_idx on public.crm_notas (vendedor_id);
alter table public.crm_usuarios add column if not exists nomes_nota text[] not null default '{}';

-- Sinal de vida do vigia (a cada 30 min, mesmo sem nota): hora e resumo (versão, máquina,
-- XML esperando, última falha). Se parar, o CRM avisa o administrador.
alter table public.crm_integracoes add column if not exists ultimo_sinal timestamptz;
alter table public.crm_integracoes add column if not exists sinal jsonb;
-- uso: 'notas' = chave do vigia (entrega notas e relatórios do FKN, função crm-notas); 'caixa' = senha
-- de LEITURA do Caixa (função crm-caixa-leitura, para a aba Geral da Agilité e a gestora do grupo).
-- Uma não serve para a outra.
alter table public.crm_integracoes add column if not exists uso text not null default 'notas' check (uso in ('notas','caixa'));

-- Registro de cada entrega do vigia (só a Edge Function escreve; gestor lê).
create table if not exists public.crm_integracao_log (
  id            bigint generated always as identity primary key,
  integracao_id uuid references public.crm_integracoes(id) on delete cascade,
  quando        timestamptz not null default now(),
  arquivos      int not null default 0,
  notas_novas   int not null default 0,
  valor         numeric(14,2) not null default 0,
  fora          int not null default 0,
  erros         int not null default 0,
  resumo        jsonb
);

-- Histórico de alterações (só o trigger escreve; só gestor lê).
create table if not exists public.crm_historico (
  id          bigint generated always as identity primary key,
  tabela      text not null,
  registro_id uuid,
  empresa_id  uuid,
  acao        text not null,
  usuario_id  uuid default auth.uid(),
  quando      timestamptz not null default now(),
  mudancas    jsonb
);

-- =================================================================== índices
create index if not exists crm_empresas_resp_idx     on public.crm_empresas (responsavel_id);
create index if not exists crm_empresas_cnpj_idx     on public.crm_empresas (cnpj) where cnpj is not null;
create unique index if not exists crm_empresas_ext_uq on public.crm_empresas (externo_id) where externo_id is not null;
-- Códigos de origem (ex. agendor:org:…) dos cadastros mesclados neste: reimportar não os recria.
alter table public.crm_empresas add column if not exists externos_mesclados text[] not null default '{}';
-- Matriz e filiais (mesma raiz de CNPJ) ou unidades do mesmo cliente: cada CNPJ é um cadastro,
-- ligado ao principal do grupo (o principal tem grupo_id nulo). A importação de notas cria a
-- filial já ligada; Configurações → Duplicados liga à mão ("Mesmo grupo").
alter table public.crm_empresas add column if not exists grupo_id uuid references public.crm_empresas(id) on delete set null;
create index if not exists crm_empresas_grupo_idx on public.crm_empresas (grupo_id);
alter table public.crm_empresas drop constraint if exists crm_empresas_grupo_nao_proprio;
alter table public.crm_empresas add constraint crm_empresas_grupo_nao_proprio check (grupo_id is null or grupo_id <> id);
create index if not exists crm_contatos_empresa_idx  on public.crm_contatos (empresa_id);
create unique index if not exists crm_contatos_ext_uq on public.crm_contatos (externo_id) where externo_id is not null;
create index if not exists crm_negocios_empresa_idx  on public.crm_negocios (empresa_id);
create index if not exists crm_negocios_resp_idx     on public.crm_negocios (responsavel_id);
create unique index if not exists crm_negocios_ext_uq on public.crm_negocios (externo_id) where externo_id is not null;
create index if not exists crm_itens_negocio_idx     on public.crm_negocio_itens (negocio_id);
create index if not exists crm_propostas_negocio_idx on public.crm_propostas (negocio_id);
create index if not exists crm_atividades_empresa_idx on public.crm_atividades (empresa_id);
create index if not exists crm_atividades_resp_idx   on public.crm_atividades (responsavel_id, concluida, data_hora);
create unique index if not exists crm_atividades_ext_uq on public.crm_atividades (externo_id) where externo_id is not null;
create unique index if not exists crm_etapas_ext_uq  on public.crm_etapas (externo_id) where externo_id is not null;
create unique index if not exists crm_produtos_ext_uq on public.crm_produtos (externo_id) where externo_id is not null;
create index if not exists crm_historico_empresa_idx on public.crm_historico (empresa_id, quando desc);
create unique index if not exists crm_notas_chave_uq  on public.crm_notas (chave);
create index if not exists crm_notas_empresa_idx     on public.crm_notas (empresa_id, emitida_em);
create index if not exists crm_nota_itens_nota_idx   on public.crm_nota_itens (nota_id);
create index if not exists crm_integracao_log_idx    on public.crm_integracao_log (quando desc);
create index if not exists crm_atividades_negocio_idx on public.crm_atividades (negocio_id);
create index if not exists crm_atividades_contato_idx on public.crm_atividades (contato_id);
create index if not exists crm_negocios_etapa_idx    on public.crm_negocios (etapa_id);
create index if not exists crm_negocios_contato_idx  on public.crm_negocios (contato_id);
create index if not exists crm_nota_itens_produto_idx on public.crm_nota_itens (produto_id);
create index if not exists crm_negocio_itens_produto_idx on public.crm_negocio_itens (produto_id);
create index if not exists crm_filtros_usuario_idx   on public.crm_filtros (usuario_id);
create index if not exists crm_integracao_log_integracao_idx on public.crm_integracao_log (integracao_id);

-- =================================================================== visibilidade
create or replace function public.crm_ve_empresa(e uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.crm_eh_gestor()
      or (public.crm_eh_membro() and (
            exists (select 1 from public.crm_empresas where id = e and responsavel_id = auth.uid())
         or exists (select 1 from public.crm_negocios where empresa_id = e and responsavel_id = auth.uid())));
$$;

create or replace function public.crm_ve_negocio(n uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.crm_negocios x where x.id = n
                 and (public.crm_eh_gestor() or x.responsavel_id = auth.uid() or public.crm_ve_empresa(x.empresa_id)));
$$;

create or replace function public.crm_ve_nota(n uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.crm_notas x where x.id = n
                 and (public.crm_eh_gestor() or public.crm_eh_comprador() or (x.empresa_id is not null and public.crm_ve_empresa(x.empresa_id))));
$$;

-- Carteira em conjunto: as políticas de leitura usam "coluna in (select crm_..._minhas())",
-- que o Postgres calcula UMA vez por consulta (hash). As crm_ve_*(id) acima rodam uma vez POR
-- LINHA e, com a equipe toda abrindo o CRM, estouravam o statement_timeout (01/10/2026: CRM
-- vazio para todos). Nunca voltar a usar crm_ve_* em política de leitura (testes/rls-rapida.test.js).
-- Vazio para quem não é membro; o gestor é tratado à parte nas políticas.
create or replace function public.crm_empresas_minhas() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.crm_empresas where public.crm_eh_membro() and responsavel_id = auth.uid()
  union
  select empresa_id from public.crm_negocios where public.crm_eh_membro() and responsavel_id = auth.uid() and empresa_id is not null;
$$;

create or replace function public.crm_negocios_meus() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.crm_negocios where public.crm_eh_membro()
     and (responsavel_id = auth.uid() or empresa_id in (select public.crm_empresas_minhas()));
$$;

-- Notas das empresas da carteira e as que o próprio vendedor vendeu (vendedor escrito na nota).
create or replace function public.crm_notas_minhas() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.crm_notas where empresa_id in (select public.crm_empresas_minhas())
  union
  select id from public.crm_notas where public.crm_eh_membro() and vendedor_id = auth.uid();
$$;

-- Compras: clientes só com o que a demanda precisa (sem contato, telefone nem e-mail).
create or replace function public.crm_clientes_compras()
returns table (id uuid, nome text, situacao text, segmento text, ciclo_recompra_dias int, responsavel_id uuid)
language sql stable security definer set search_path = public as $$
  select e.id, e.nome, e.situacao, e.segmento, e.ciclo_recompra_dias, e.responsavel_id
    from public.crm_empresas e
   where public.crm_eh_admin() or public.crm_eh_comprador();
$$;

create or replace function public.crm_edita_negocio(n uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.crm_eh_membro() and exists (select 1 from public.crm_negocios x where x.id = n
                 and (public.crm_eh_gestor() or x.responsavel_id = auth.uid()));
$$;

-- =================================================================== cadastro sem duplicado
-- Chaves de comparação (as mesmas do app, R.chaveTelefone etc.): documento só com dígitos
-- (CPF 11 ou CNPJ 14), telefone pelos 8 últimos dígitos (pega com e sem DDD, com e sem o 9
-- do celular), e-mail em minúsculas.
create or replace function public.crm_doc(t text) returns text language sql immutable set search_path = public as $$
  select case when length(regexp_replace(coalesce(t, ''), '\D', '', 'g')) in (11, 14) then regexp_replace(t, '\D', '', 'g') end;
$$;
create or replace function public.crm_tel(t text) returns text language sql immutable set search_path = public as $$
  select case when length(regexp_replace(coalesce(t, ''), '\D', '', 'g')) >= 8 then right(regexp_replace(t, '\D', '', 'g'), 8) end;
$$;
create or replace function public.crm_mail(t text) returns text language sql immutable set search_path = public as $$
  select case when btrim(coalesce(t, '')) like '%_@_%' then lower(btrim(t)) end;
$$;

-- Empresas (de qualquer carteira) que já usam este CNPJ/CPF, telefone ou e-mail. "de_empresa"
-- = o dado é da própria empresa (trava); falso = é de uma pessoa de contato dela (só avisa:
-- um síndico ou comprador pode atender várias empresas).
create or replace function public.crm_acha_duplicado(p_doc text, p_tels text[], p_mails text[], p_ignorar uuid)
returns table (empresa_id uuid, nome text, responsavel text, campo text, de_empresa boolean)
language sql stable security definer set search_path = public as $$
  with alvo as (
    select public.crm_doc(p_doc) doc,
           array(select distinct public.crm_tel(x) from unnest(coalesce(p_tels, '{}'::text[])) x where public.crm_tel(x) is not null) tels,
           array(select distinct public.crm_mail(x) from unnest(coalesce(p_mails, '{}'::text[])) x where public.crm_mail(x) is not null) mails
  ), achados as (
    select e.id, 'CNPJ/CPF' campo, true de_empresa from public.crm_empresas e, alvo where alvo.doc is not null and public.crm_doc(e.cnpj) = alvo.doc
    union all select e.id, 'telefone', true from public.crm_empresas e, alvo where public.crm_tel(e.telefone) = any(alvo.tels) or public.crm_tel(e.whatsapp) = any(alvo.tels)
    union all select e.id, 'e-mail', true from public.crm_empresas e, alvo where public.crm_mail(e.email) = any(alvo.mails)
    union all select c.empresa_id, 'telefone de uma pessoa', false from public.crm_contatos c, alvo
      where public.crm_tel(c.telefone) = any(alvo.tels) or public.crm_tel(c.celular) = any(alvo.tels) or public.crm_tel(c.whatsapp) = any(alvo.tels)
    union all select c.empresa_id, 'e-mail de uma pessoa', false from public.crm_contatos c, alvo where public.crm_mail(c.email) = any(alvo.mails)
  )
  select e.id, e.nome, coalesce(u.nome, 'sem responsável'), string_agg(distinct a.campo, ', '), bool_or(a.de_empresa)
    from achados a join public.crm_empresas e on e.id = a.id left join public.crm_usuarios u on u.user_id = e.responsavel_id
   where p_ignorar is null or e.id <> p_ignorar
   group by e.id, e.nome, u.nome
   order by bool_or(a.de_empresa) desc, e.nome
   limit 5;
$$;

-- Para o app avisar enquanto digita (o vendedor não enxerga a carteira dos outros).
-- Devolve só nome e responsável.
create or replace function public.crm_duplicado_empresa(p_doc text, p_tels text[], p_mails text[], p_ignorar uuid default null)
returns table (empresa_id uuid, nome text, responsavel text, campo text, de_empresa boolean)
language sql stable security definer set search_path = public as $$
  select * from public.crm_acha_duplicado(p_doc, p_tels, p_mails, p_ignorar) where public.crm_eh_membro();
$$;

-- Trava no banco: empresa nova (ou dado alterado) com CNPJ/CPF, telefone ou e-mail de outra
-- empresa é recusada. Só confere o que mudou: cadastro antigo repetido (veio do Agendor)
-- continua editável; para juntar, Configurações -> Duplicados.
create or replace function public.crm_barra_duplicado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  novo boolean := tg_op = 'INSERT';
  d record;
begin
  select * into d from public.crm_acha_duplicado(
      case when novo or public.crm_doc(new.cnpj) is distinct from public.crm_doc(old.cnpj) then new.cnpj end,
      array_remove(array[case when novo or public.crm_tel(new.telefone) is distinct from public.crm_tel(old.telefone) then new.telefone end,
                         case when novo or public.crm_tel(new.whatsapp) is distinct from public.crm_tel(old.whatsapp) then new.whatsapp end], null),
      array_remove(array[case when novo or public.crm_mail(new.email) is distinct from public.crm_mail(old.email) then new.email end], null),
      new.id) x
   where x.de_empresa
   limit 1;
  if found then
    raise exception 'Cadastro duplicado: o % já é de "%" (carteira: %). Abra o cadastro que já existe em vez de criar outro.', d.campo, d.nome, d.responsavel
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Rodízio de leads: o vendedor ativo (que recebe leads) com menos empresas
-- recebidas nos últimos 30 dias. Precisa ser no servidor porque o vendedor
-- não enxerga a carteira dos outros.
create or replace function public.crm_proximo_vendedor()
returns uuid language sql stable security definer set search_path = public as $$
  select u.user_id
    from public.crm_usuarios u
   where public.crm_eh_membro() and u.ativo and u.recebe_leads and u.papel <> 'comprador'
   order by (select count(*) from public.crm_empresas e
              where e.responsavel_id = u.user_id and e.criado_em > now() - interval '30 days'),
            u.nome
   limit 1;
$$;

-- =================================================================== triggers
create or replace function public.crm_marca_etapa()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.etapa_id is distinct from old.etapa_id or new.status is distinct from old.status then
    new.etapa_desde := now();
  end if;
  return new;
end;
$$;

create or replace function public.crm_audita()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  antes jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  depois jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  linha jsonb := coalesce(depois, antes);
  mud jsonb;
  emp uuid;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_array(antes -> k, depois -> k)) into mud
      from jsonb_object_keys(depois) k
     where k not in ('atualizado_em','etapa_desde') and (antes -> k) is distinct from (depois -> k);
    if mud is null then return new; end if;
  elsif tg_op = 'DELETE' then
    mud := antes;
  end if;
  emp := case when tg_table_name = 'crm_empresas' then (linha ->> 'id')::uuid
              else nullif(linha ->> 'empresa_id', '')::uuid end;
  insert into public.crm_historico (tabela, registro_id, empresa_id, acao, mudancas)
  values (tg_table_name, nullif(coalesce(linha ->> 'id', linha ->> 'user_id'), '')::uuid, emp, lower(tg_op), mud);
  return coalesce(new, old);
end;
$$;
revoke all on function public.crm_audita() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['crm_usuarios','crm_config','crm_etapas','crm_opcoes','crm_produtos','crm_modelos',
                           'crm_metas','crm_filtros','crm_empresas','crm_contatos','crm_negocios',
                           'crm_negocio_itens','crm_propostas','crm_atividades','crm_notas','crm_nota_itens','crm_integracoes']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_atualizado_em', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.crm_toca_atualizado_em()',
                   t || '_atualizado_em', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;

  foreach t in array array['crm_empresas','crm_contatos','crm_negocios','crm_propostas','crm_usuarios','crm_etapas','crm_produtos']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audita', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.crm_audita()',
                   t || '_audita', t);
  end loop;
end;
$$;

drop trigger if exists crm_empresas_duplicado on public.crm_empresas;
create trigger crm_empresas_duplicado before insert or update of cnpj, telefone, whatsapp, email on public.crm_empresas
  for each row execute function public.crm_barra_duplicado();

drop trigger if exists crm_negocios_etapa on public.crm_negocios;
create trigger crm_negocios_etapa before update on public.crm_negocios
  for each row execute function public.crm_marca_etapa();

alter table public.crm_integracao_log enable row level security;
revoke all on public.crm_integracao_log from anon, public, authenticated;
grant select on public.crm_integracao_log to authenticated;

alter table public.crm_historico enable row level security;
revoke all on public.crm_historico from anon, public, authenticated;
grant select on public.crm_historico to authenticated;

-- =================================================================== políticas
do $$
declare
  t text;
  p record;
begin
  -- Recomeça do zero as políticas das tabelas do CRM (rodar de novo não acumula).
  for p in select policyname, tablename from pg_policies where schemaname = 'public' and tablename like 'crm\_%'
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;

  -- Cadastros de configuração: todo usuário ativo lê (inclusive o comprador); gestor/admin escreve.
  foreach t in array array['crm_config','crm_etapas','crm_opcoes','crm_produtos','crm_modelos']
  loop
    execute format('create policy le on public.%I for select to authenticated using ((select public.crm_eh_ativo()))', t);
    execute format('create policy grava on public.%I for insert to authenticated with check ((select public.crm_eh_gestor()))', t);
    execute format('create policy altera on public.%I for update to authenticated using ((select public.crm_eh_gestor())) with check ((select public.crm_eh_gestor()))', t);
    execute format('create policy apaga on public.%I for delete to authenticated using ((select public.crm_eh_gestor()))', t);
  end loop;
end;
$$;

-- usuários: todo usuário ativo vê a equipe (para nomes e filtros); só admin mexe.
create policy le on public.crm_usuarios for select to authenticated using ((select public.crm_eh_ativo()));
create policy grava on public.crm_usuarios for insert to authenticated with check ((select public.crm_eh_admin()));
create policy altera on public.crm_usuarios for update to authenticated using ((select public.crm_eh_admin())) with check ((select public.crm_eh_admin()));
create policy apaga on public.crm_usuarios for delete to authenticated using ((select public.crm_eh_admin()));

-- metas: vendedor vê a própria; gestor vê e define todas.
create policy le on public.crm_metas for select to authenticated using ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and usuario_id = (select auth.uid())));
create policy grava on public.crm_metas for insert to authenticated with check ((select public.crm_eh_gestor()));
create policy altera on public.crm_metas for update to authenticated using ((select public.crm_eh_gestor())) with check ((select public.crm_eh_gestor()));
create policy apaga on public.crm_metas for delete to authenticated using ((select public.crm_eh_gestor()));

-- filtros salvos: cada um os seus.
create policy proprios on public.crm_filtros for all to authenticated
  using ((select public.crm_eh_membro()) and usuario_id = (select auth.uid()))
  with check ((select public.crm_eh_membro()) and usuario_id = (select auth.uid()));

-- empresas: carteira própria. O teste direto do responsável na própria linha é
-- necessário: no INSERT ... RETURNING (que o app usa) a subconsulta dentro de
-- crm_empresas_minhas() ainda não enxerga a linha recém-inserida (achado no banco real
-- em 29/09/2026: vendedor não conseguia cadastrar lead).
create policy le on public.crm_empresas for select to authenticated
  using ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and responsavel_id = (select auth.uid())) or id in (select public.crm_empresas_minhas()));
create policy grava on public.crm_empresas for insert to authenticated
  with check ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and responsavel_id = (select auth.uid())));
create policy altera on public.crm_empresas for update to authenticated
  using ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and responsavel_id = (select auth.uid())))
  with check ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and responsavel_id = (select auth.uid())));
create policy apaga on public.crm_empresas for delete to authenticated using ((select public.crm_eh_gestor()));

-- contatos: acompanham a empresa.
create policy tudo on public.crm_contatos for all to authenticated
  using ((select public.crm_eh_gestor()) or empresa_id in (select public.crm_empresas_minhas()))
  with check ((select public.crm_eh_gestor()) or empresa_id in (select public.crm_empresas_minhas()));

-- negócios: dono do negócio ou quem vê a empresa enxerga; só dono/gestor altera.
create policy le on public.crm_negocios for select to authenticated
  using ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and responsavel_id = (select auth.uid())) or empresa_id in (select public.crm_empresas_minhas()));
create policy grava on public.crm_negocios for insert to authenticated
  with check ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and responsavel_id = (select auth.uid()) and public.crm_ve_empresa(empresa_id)));
create policy altera on public.crm_negocios for update to authenticated
  using ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and responsavel_id = (select auth.uid())))
  with check ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and responsavel_id = (select auth.uid())));
create policy apaga on public.crm_negocios for delete to authenticated using ((select public.crm_eh_gestor()));

-- itens e propostas: acompanham o negócio.
create policy le on public.crm_negocio_itens for select to authenticated using ((select public.crm_eh_gestor()) or negocio_id in (select public.crm_negocios_meus()));
create policy grava on public.crm_negocio_itens for insert to authenticated with check (public.crm_edita_negocio(negocio_id));
create policy altera on public.crm_negocio_itens for update to authenticated using (public.crm_edita_negocio(negocio_id)) with check (public.crm_edita_negocio(negocio_id));
create policy apaga on public.crm_negocio_itens for delete to authenticated using (public.crm_edita_negocio(negocio_id));
create policy le on public.crm_propostas for select to authenticated using ((select public.crm_eh_gestor()) or negocio_id in (select public.crm_negocios_meus()));
create policy grava on public.crm_propostas for insert to authenticated with check (public.crm_edita_negocio(negocio_id));
create policy altera on public.crm_propostas for update to authenticated using (public.crm_edita_negocio(negocio_id)) with check (public.crm_edita_negocio(negocio_id));
create policy apaga on public.crm_propostas for delete to authenticated using (public.crm_edita_negocio(negocio_id));

-- atividades: quem vê a empresa vê o histórico; pode agendar para colega.
create policy le on public.crm_atividades for select to authenticated
  using ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and responsavel_id = (select auth.uid())) or empresa_id in (select public.crm_empresas_minhas()));
create policy grava on public.crm_atividades for insert to authenticated with check (public.crm_ve_empresa(empresa_id));
create policy altera on public.crm_atividades for update to authenticated
  using ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and (responsavel_id = (select auth.uid()) or criado_por = (select auth.uid()))))
  with check (public.crm_ve_empresa(empresa_id));
create policy apaga on public.crm_atividades for delete to authenticated
  using ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and (responsavel_id = (select auth.uid()) or criado_por = (select auth.uid()))));

-- notas fiscais: gestor importa e corrige; vendedor lê as das empresas que vê.
create policy le on public.crm_notas for select to authenticated
  using ((select public.crm_eh_gestor()) or (select public.crm_eh_comprador()) or empresa_id in (select public.crm_empresas_minhas())
         or ((select public.crm_eh_membro()) and vendedor_id = (select auth.uid())));
create policy grava on public.crm_notas for insert to authenticated with check ((select public.crm_eh_gestor()));
create policy altera on public.crm_notas for update to authenticated using ((select public.crm_eh_gestor())) with check ((select public.crm_eh_gestor()));
create policy apaga on public.crm_notas for delete to authenticated using ((select public.crm_eh_gestor()));
create policy le on public.crm_nota_itens for select to authenticated using ((select public.crm_eh_gestor()) or (select public.crm_eh_comprador()) or nota_id in (select public.crm_notas_minhas()));
create policy grava on public.crm_nota_itens for insert to authenticated with check ((select public.crm_eh_gestor()));
create policy altera on public.crm_nota_itens for update to authenticated using ((select public.crm_eh_gestor())) with check ((select public.crm_eh_gestor()));
create policy apaga on public.crm_nota_itens for delete to authenticated using ((select public.crm_eh_gestor()));

-- estoque (CSV do FKN, tela Gestão → Compras): só o administrador.
create table if not exists public.crm_estoque (
  codigo        text primary key check (length(btrim(codigo)) > 0),
  descricao     text not null,
  unidade       text,
  localizacao   text,
  quantidade    numeric(14,3) not null default 0,
  custo_total   numeric(16,2) not null default 0,
  atualizado_em timestamptz not null default now()
);
alter table public.crm_estoque enable row level security;
revoke all on public.crm_estoque from anon, public;
grant select, insert, update, delete on public.crm_estoque to authenticated;
drop policy if exists tudo on public.crm_estoque;
create policy tudo on public.crm_estoque for all to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())) with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
-- Listagem cadastral de produtos do FKN (SIFN108): fornecedor, linha, família, mínimo/máximo,
-- pendências e custos. O CSV simples de estoque deixa estas colunas como estão.
alter table public.crm_estoque add column if not exists situacao        text;
alter table public.crm_estoque add column if not exists linha           text;
alter table public.crm_estoque add column if not exists familia         text;
alter table public.crm_estoque add column if not exists fornecedor_cod  text;
alter table public.crm_estoque add column if not exists fornecedor      text;
alter table public.crm_estoque add column if not exists estoque_min     numeric(14,3);
alter table public.crm_estoque add column if not exists estoque_max     numeric(14,3);
alter table public.crm_estoque add column if not exists pend_cliente    numeric(14,3);
alter table public.crm_estoque add column if not exists pend_fornecedor numeric(14,3);
alter table public.crm_estoque add column if not exists custo_unit      numeric(16,4);
alter table public.crm_estoque add column if not exists custo_compra    numeric(16,4);
alter table public.crm_estoque add column if not exists preco_venda     numeric(16,4);
alter table public.crm_estoque add column if not exists ult_entrada     date;
alter table public.crm_estoque add column if not exists ult_saida       date;

-- =================================================================== financeiro (só o administrador)
-- Contas a pagar, entradas avulsas e caixa do dia (06/10/2026, troca da planilha "Fluxo de Caixa"
-- do Excel). Tem salário, pró-labore e retirada: SÓ o administrador lê e grava — nem a gestora.
-- Sem auditoria em crm_historico de propósito (a gestora lê o histórico).
-- Recorrente: modelo com dia fixo do mês; "Gerar o mês" cria a conta da competência (uma só por
-- recorrente e mês — índice único). Parcela "n de N": parcela_inicio é o número no mês de "inicio".
create table if not exists public.crm_fin_recorrentes (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null default 'saida' check (tipo in ('entrada','saida')),
  descricao       text not null check (length(btrim(descricao)) > 0),
  fornecedor      text,
  categoria       text,
  valor           numeric(14,2) not null default 0 check (valor >= 0),
  dia             smallint not null check (dia between 1 and 31),
  entre_empresas  boolean not null default false,
  parcelas        smallint check (parcelas is null or parcelas > 0),
  parcela_inicio  smallint check (parcela_inicio is null or parcela_inicio > 0),
  inicio          date not null default date_trunc('month', current_date)::date,
  ativo           boolean not null default true,
  observacoes     text,
  criado_por      uuid default auth.uid(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
-- Lançamento = conta a pagar (saída) ou entrada avulsa (ex.: material vendido à Agilité).
-- situacao: aberto (previsto) | pago (aconteceu) | pausado (fora do caixa, aba "Contas pausadas").
-- baixa: 'caixa' = ✓ no caixa do dia (entra no saldo); 'fora' = pago fora (sumiu do FKN, "já estava
-- paga") — aparece, mas não mexe no saldo, que vem do saldo informado do banco.
-- entre_empresas: OneClean ↔ Agilité (reembolso da folha, material vendido): no "Geral" se anulam.
-- titulo_duplicata: título do contas a receber marcado como recebido no caixa do dia.
create table if not exists public.crm_fin_lancamentos (
  id                uuid primary key default gen_random_uuid(),
  tipo              text not null default 'saida' check (tipo in ('entrada','saida')),
  descricao         text not null check (length(btrim(descricao)) > 0),
  fornecedor        text,
  categoria         text,
  valor             numeric(14,2) not null default 0 check (valor >= 0),
  vencimento        date not null,
  situacao          text not null default 'aberto' check (situacao in ('aberto','pago','pausado')),
  pago_em           date,
  baixa             text check (baixa in ('caixa','fora')),
  baixado_em        timestamptz,
  entre_empresas    boolean not null default false,
  origem            text not null default 'tela' check (origem in ('tela','recorrente','fkn','planilha','titulo')),
  recorrente_id     uuid references public.crm_fin_recorrentes(id) on delete set null,
  competencia       date,
  parcela           smallint,
  parcelas          smallint,
  chave_fkn         text,
  titulo_duplicata  text,
  observacoes       text,
  frase             text,
  frase_antes       jsonb,
  criado_por        uuid default auth.uid(),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  constraint crm_fin_lancamentos_pago_ck check (situacao <> 'pago' or pago_em is not null)
);
-- Lançado por frase ("pedágio 350 pago hoje", frases.js): frase = a linha escrita; frase_antes = como
-- a conta estava antes da baixa ou do ajuste (o Desfazer volta para ela; sem frase_antes, o Desfazer
-- apaga o lançamento que a frase criou).
alter table public.crm_fin_lancamentos add column if not exists frase       text;
alter table public.crm_fin_lancamentos add column if not exists frase_antes jsonb;
-- Empréstimo recebido (06/10/2026, frases iguais às da Agilité): a entrada é marcada (não é receita);
-- a devolução em parcelas é uma recorrente com o valor contratado (ou a taxa) e cada parcela gerada
-- leva a parte de juros da tabela Price (caixa-calculo.js, cronogramaPrice).
alter table public.crm_fin_lancamentos add column if not exists emprestimo boolean not null default false;
alter table public.crm_fin_lancamentos add column if not exists juros numeric(14,2) check (juros is null or juros >= 0);
alter table public.crm_fin_recorrentes add column if not exists valor_contratado numeric(14,2) check (valor_contratado is null or valor_contratado > 0);
alter table public.crm_fin_recorrentes add column if not exists taxa_mes_pct numeric(8,4) check (taxa_mes_pct is null or taxa_mes_pct >= 0);
create unique index if not exists crm_fin_lanc_recorrente_uq on public.crm_fin_lancamentos (recorrente_id, competencia) where recorrente_id is not null;
create unique index if not exists crm_fin_lanc_fkn_uq on public.crm_fin_lancamentos (chave_fkn) where chave_fkn is not null;
create unique index if not exists crm_fin_lanc_titulo_uq on public.crm_fin_lancamentos (titulo_duplicata) where titulo_duplicata is not null;
create index if not exists crm_fin_lanc_venc_idx on public.crm_fin_lancamentos (situacao, vencimento);
create index if not exists crm_fin_lanc_pago_idx on public.crm_fin_lancamentos (pago_em);
-- Saldo do banco informado ("Conferir com o banco"): saldo atual = o último informado + o que foi
-- baixado no caixa (baixa = 'caixa') depois dele.
create table if not exists public.crm_fin_saldos (
  id          uuid primary key default gen_random_uuid(),
  data        date not null,
  valor       numeric(14,2) not null,
  observacao  text,
  criado_por  uuid default auth.uid(),
  criado_em   timestamptz not null default now()
);
-- Regra aprendida das frases ("lembrar" na conferência): as palavras da frase (chave, em ordem) →
-- categoria, fornecedor e entre empresas da próxima vez.
create table if not exists public.crm_fin_regras (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null default 'saida' check (tipo in ('entrada','saida')),
  chave           text not null check (length(btrim(chave)) > 0),
  categoria       text,
  fornecedor      text,
  entre_empresas  boolean not null default false,
  criado_por      uuid default auth.uid(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (tipo, chave)
);
do $$
declare t text;
begin
  foreach t in array array['crm_fin_recorrentes','crm_fin_lancamentos','crm_fin_saldos','crm_fin_regras']
  loop
    if t <> 'crm_fin_saldos' then
      execute format('drop trigger if exists %I on public.%I', t || '_atualizado_em', t);
      execute format('create trigger %I before update on public.%I for each row execute function public.crm_toca_atualizado_em()', t || '_atualizado_em', t);
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
    execute format('drop policy if exists so_admin on public.%I', t);
    execute format('create policy so_admin on public.%I for all to authenticated using ((select public.crm_eh_admin())) with check ((select public.crm_eh_admin()))', t);
  end loop;
end $$;

-- contas a receber (listagem SIFN016 do FKN, "em aberto"): retrato dos títulos; cada importação
-- troca o retrato inteiro. Quem lê a tabela: SÓ o administrador (06/10/2026, Anderson: "tanto
-- Isabela quanto os demais, somente o selo de duplicata em atraso, podendo dar detalhes"). Gestora e
-- vendedoras recebem só as duplicatas EM ATRASO (com detalhe) pela função crm_duplicatas_atraso();
-- a gestora grava os títulos das notas que importa e leva os títulos ao juntar cadastros pelas
-- funções crm_titulos_da_nota() e crm_titulos_troca_empresa(), sem ler a tabela. Comprador: nada.
-- O administrador importa a listagem; as notas (vigia ou gestora) criam os títulos das parcelas.
create table if not exists public.crm_titulos (
  id             uuid primary key default gen_random_uuid(),
  duplicata      text not null check (length(btrim(duplicata)) > 0),
  nota_numero    integer,
  parcela        integer,
  empresa_id     uuid references public.crm_empresas(id) on delete set null,
  cliente_codigo text,
  cliente_nome   text,
  cliente_doc    text,
  vendedor_nome  text,
  emitida_em     date,
  vencimento     date not null,
  valor          numeric(14,2) not null default 0,
  portador       text,
  abono          boolean not null default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create unique index if not exists crm_titulos_duplicata_uq on public.crm_titulos (duplicata);
-- origem: 'fkn' (veio da listagem) ou 'nota' (criado pelas parcelas da NF-e, ainda não confirmado
-- pelo FKN). A listagem só apaga título da nota criado antes da hora em que ela foi gerada.
alter table public.crm_titulos add column if not exists origem text not null default 'fkn';
-- previsao: título em atraso remarcado pelo administrador no Caixa (o dia em que espera receber; aparece
-- em vermelho na grade). A listagem do FKN não mexe nela (o upsert só grava as colunas que traz).
alter table public.crm_titulos add column if not exists previsao date;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_titulos_origem_ck') then
    alter table public.crm_titulos add constraint crm_titulos_origem_ck check (origem in ('fkn', 'nota'));
  end if;
end $$;
create index if not exists crm_titulos_empresa_idx on public.crm_titulos (empresa_id);
alter table public.crm_titulos enable row level security;
revoke all on public.crm_titulos from anon, public;
grant select, insert, update, delete on public.crm_titulos to authenticated;
drop policy if exists le on public.crm_titulos;
drop policy if exists grava on public.crm_titulos;
drop policy if exists altera on public.crm_titulos;
drop policy if exists apaga on public.crm_titulos;
create policy le on public.crm_titulos for select to authenticated using ((select public.crm_eh_admin()));
-- gravar: a gestora também (a importação manual de notas cria os títulos das parcelas).
create policy grava on public.crm_titulos for insert to authenticated with check ((select public.crm_eh_gestor()));
-- alterar: a gestora também (ao juntar cadastros duplicados, o título vai para o cadastro que fica).
create policy altera on public.crm_titulos for update to authenticated using ((select public.crm_eh_gestor())) with check ((select public.crm_eh_gestor()));
create policy apaga on public.crm_titulos for delete to authenticated using ((select public.crm_eh_admin()));

-- Duplicatas em atraso (selo da Recompra, da Fila do dia e da ficha, com o detalhe de cada uma). Só as
-- vencidas — o resto do contas a receber fica com o administrador. Gestor/admin: todas; vendedor: as
-- dos clientes da carteira. (A crm_titulos_vencidos(), de 06/10 de manhã, foi trocada por esta.)
drop function if exists public.crm_titulos_vencidos();
create or replace function public.crm_duplicatas_atraso()
returns table (empresa_id uuid, duplicata text, nota_numero integer, parcela integer, vencimento date, valor numeric, abono boolean, portador text)
language sql stable security definer set search_path = public as $$
  select t.empresa_id, t.duplicata, t.nota_numero, t.parcela, t.vencimento, t.valor, t.abono, t.portador
    from public.crm_titulos t
   where t.empresa_id is not null and t.vencimento < (now() at time zone 'America/Sao_Paulo')::date
     and (public.crm_eh_gestor() or (public.crm_eh_membro() and t.empresa_id in (select public.crm_empresas_minhas())));
$$;
-- Títulos das parcelas de nota importada à mão (gestora ou admin): grava os novos (o que já existe não
-- é mexido) e tira os da nota cancelada que ainda não foram confirmados pelo FKN. Devolve quantos.
create or replace function public.crm_titulos_da_nota(novos jsonb, cancelados text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare c integer := 0; r integer := 0;
begin
  if not public.crm_eh_gestor() then raise exception 'sem permissão'; end if;
  insert into public.crm_titulos (duplicata, nota_numero, parcela, empresa_id, cliente_doc, cliente_nome, vendedor_nome, emitida_em, vencimento, valor, portador, origem)
  select x.duplicata, x.nota_numero, x.parcela, x.empresa_id, x.cliente_doc, x.cliente_nome, x.vendedor_nome, x.emitida_em, x.vencimento, coalesce(x.valor, 0), x.portador, 'nota'
    from jsonb_to_recordset(coalesce(novos, '[]'::jsonb)) as x(duplicata text, nota_numero integer, parcela integer, empresa_id uuid, cliente_doc text, cliente_nome text,
         vendedor_nome text, emitida_em date, vencimento date, valor numeric, portador text)
   where x.duplicata is not null and x.vencimento is not null
  on conflict (duplicata) do nothing;
  get diagnostics c = row_count;
  if coalesce(array_length(cancelados, 1), 0) > 0 then
    delete from public.crm_titulos where origem = 'nota' and split_part(duplicata, '/', 1) = any(cancelados);
    get diagnostics r = row_count;
  end if;
  return jsonb_build_object('criados', c, 'removidos', r);
end;
$$;
-- Juntar cadastros duplicados (gestora ou admin): os títulos vão para o cadastro que fica.
create or replace function public.crm_titulos_troca_empresa(de uuid[], para uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.crm_eh_gestor() then raise exception 'sem permissão'; end if;
  update public.crm_titulos set empresa_id = para where empresa_id = any(de);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.crm_duplicatas_atraso(), public.crm_titulos_da_nota(jsonb, text[]), public.crm_titulos_troca_empresa(uuid[], uuid) from public, anon;
grant execute on function public.crm_duplicatas_atraso(), public.crm_titulos_da_nota(jsonb, text[]), public.crm_titulos_troca_empresa(uuid[], uuid) to authenticated;

-- Títulos baixados no FKN (07/10/2026, Anderson): a listagem do contas a receber só traz o que está
-- em aberto, então o título baixado no FKN some do CRM — e o dinheiro, se entrou, não entrava no
-- Caixa. Agora o título que sai da tabela sem ter sido recebido no Caixa fica guardado aqui e aparece
-- no Caixa ("Baixados no FKN, sem entrada no caixa"): o administrador diz o dia e o valor que entraram
-- ou "não entrou" (abatimento, devolução, cancelamento). Não vira entrada sozinho: baixa no FKN nem
-- sempre é dinheiro no banco. Título de nota cancelada já nasce resolvido ('cancelada'); título que
-- volta na listagem sai daqui. Só o administrador lê e grava (o gatilho grava por qualquer caminho).
create table if not exists public.crm_fin_titulos_baixados (
  id             uuid primary key default gen_random_uuid(),
  duplicata      text not null,
  nota_numero    integer,
  empresa_id     uuid references public.crm_empresas(id) on delete set null,
  cliente_nome   text,
  vencimento     date,
  previsao       date,
  valor          numeric(14,2) not null default 0,
  origem         text,
  sumiu_em       timestamptz not null default now(),
  resolvido      text check (resolvido in ('entrou', 'nao_entrou', 'cancelada')),
  resolvido_em   timestamptz,
  lancamento_id  uuid references public.crm_fin_lancamentos(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create unique index if not exists crm_fin_titulos_baixados_aberto_uq on public.crm_fin_titulos_baixados (duplicata) where resolvido is null;
drop trigger if exists crm_fin_titulos_baixados_atualizado_em on public.crm_fin_titulos_baixados;
create trigger crm_fin_titulos_baixados_atualizado_em before update on public.crm_fin_titulos_baixados for each row execute function public.crm_toca_atualizado_em();
alter table public.crm_fin_titulos_baixados enable row level security;
revoke all on public.crm_fin_titulos_baixados from anon, public;
grant select, insert, update, delete on public.crm_fin_titulos_baixados to authenticated;
revoke truncate, references, trigger on public.crm_fin_titulos_baixados from authenticated;
drop policy if exists so_admin on public.crm_fin_titulos_baixados;
create policy so_admin on public.crm_fin_titulos_baixados for all to authenticated using ((select public.crm_eh_admin())) with check ((select public.crm_eh_admin()));

create or replace function public.crm_titulo_saiu()
returns trigger language plpgsql security definer set search_path = public as $$
declare num bigint := coalesce(old.nota_numero, nullif(regexp_replace(split_part(old.duplicata, '/', 1), '\D', '', 'g'), '')::bigint);
begin
  -- recebido no Caixa ("Recebi"): o dinheiro já está lá
  if exists (select 1 from public.crm_fin_lancamentos where titulo_duplicata = old.duplicata and situacao = 'pago') then return old; end if;
  insert into public.crm_fin_titulos_baixados (duplicata, nota_numero, empresa_id, cliente_nome, vencimento, previsao, valor, origem, resolvido, resolvido_em)
  select old.duplicata, num, old.empresa_id, old.cliente_nome, old.vencimento, old.previsao, old.valor, old.origem, c.r, case when c.r is not null then now() end
    from (select case when exists (select 1 from public.crm_notas where numero = num and cancelada) then 'cancelada' end r) c
  on conflict (duplicata) where resolvido is null do nothing;
  return old;
end;
$$;
create or replace function public.crm_titulo_voltou()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.crm_fin_titulos_baixados where duplicata = new.duplicata and resolvido is null;
  return new;
end;
$$;
revoke all on function public.crm_titulo_saiu(), public.crm_titulo_voltou() from public, anon, authenticated;
drop trigger if exists crm_titulos_saiu on public.crm_titulos;
create trigger crm_titulos_saiu after delete on public.crm_titulos for each row execute function public.crm_titulo_saiu();
drop trigger if exists crm_titulos_voltou on public.crm_titulos;
create trigger crm_titulos_voltou after insert on public.crm_titulos for each row execute function public.crm_titulo_voltou();

-- Quando chegou cada relatório do FKN (lembrete em Compras). O comprador puxa só o estoque
-- (06/10/2026): a data do contas a receber é só do administrador. Vendedor e gestor: nada.
create or replace function public.crm_fkn_atualizado()
returns table (estoque timestamptz, receber timestamptz) language sql stable security definer set search_path = public as $$
  select (select max(atualizado_em) from public.crm_estoque),
         case when public.crm_eh_admin() then (select max(atualizado_em) from public.crm_titulos) end
   where public.crm_eh_admin() or public.crm_eh_comprador();
$$;
revoke all on function public.crm_fkn_atualizado() from public, anon;
grant execute on function public.crm_fkn_atualizado() to authenticated;
-- O mesmo, mais o motivo da última recusa de cada relatório (arquivo puxado com opção faltando),
-- se for mais nova que a última entrega boa — o lembrete de Compras mostra o que marcar.
-- 'pagar' (contas a pagar, Sifn083 — só administrador): a última entrega boa pelo vigia ou a última
-- conta do FKN gravada/atualizada pela tela.
create or replace function public.crm_fkn_situacao()
returns jsonb language sql stable security definer set search_path = public as $$
  with u as (select (select max(atualizado_em) from public.crm_estoque) estoque, (select max(atualizado_em) from public.crm_titulos) receber,
                    greatest((select max(quando) from public.crm_integracao_log where erros = 0 and resumo->>'fkn' like 'Contas a pagar do FKN:%'),
                             (select max(atualizado_em) from public.crm_fin_lancamentos where chave_fkn is not null)) pagar),
  r as (select distinct on (resumo->>'fkn_tipo') resumo->>'fkn_tipo' tipo, resumo->>'fkn_recusa' texto, resumo->>'arquivo' arquivo, quando
          from public.crm_integracao_log where resumo ? 'fkn_recusa' order by resumo->>'fkn_tipo', quando desc)
  select jsonb_build_object('estoque', u.estoque, 'receber', case when public.crm_eh_admin() then u.receber end,
    'pagar', case when public.crm_eh_admin() then u.pagar end,
    'recusas', coalesce((select jsonb_agg(jsonb_build_object('tipo', r.tipo, 'texto', r.texto, 'arquivo', r.arquivo, 'quando', r.quando))
                           from r where r.quando > coalesce(case r.tipo when 'produtos' then u.estoque when 'pagar' then u.pagar else u.receber end, '-infinity'::timestamptz)
                            and (r.tipo = 'produtos' or public.crm_eh_admin())), '[]'::jsonb))
    from u where public.crm_eh_admin() or public.crm_eh_comprador();
$$;
revoke all on function public.crm_fkn_situacao() from public, anon;
grant execute on function public.crm_fkn_situacao() to authenticated;

-- integrações: só o administrador; o registro das entregas o gestor também lê.
create policy tudo on public.crm_integracoes for all to authenticated using ((select public.crm_eh_admin())) with check ((select public.crm_eh_admin()));
create policy le on public.crm_integracao_log for select to authenticated using ((select public.crm_eh_gestor()));

-- histórico: só gestor lê.
create policy le on public.crm_historico for select to authenticated using ((select public.crm_eh_gestor()));

-- =================================================================== cadência de e-mails (07/10/2026)
-- Pedido da líder de vendas: clientes que só tratam por e-mail recebem, da vendedora da carteira,
-- um e-mail de reposição no ritmo de compra deles e um de relacionamento (a "campanha" que a líder
-- escreve) a cada quinze dias ou um mês. Começa com FILA DE APROVAÇÃO: o CRM monta a fila do dia na
-- tela (regras.js, filaCadencia) e a vendedora ou a líder aprova; quem envia é a Edge Function
-- crm-email-enviar (Brevo; a chave fica só no Supabase). email_sair_em: o cliente clicou em "não quero
-- receber" (LGPD) — só a função grava; ninguém do CRM desfaz (trava abaixo).
alter table public.crm_empresas add column if not exists email_cadencia text check (email_cadencia in ('quinzenal', 'mensal'));
alter table public.crm_empresas add column if not exists email_sair_em timestamptz;
create or replace function public.crm_empresas_trava_sair()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and new.email_sair_em is distinct from old.email_sair_em then
    new.email_sair_em := old.email_sair_em;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_empresas_trava_sair on public.crm_empresas;
create trigger crm_empresas_trava_sair before update on public.crm_empresas for each row execute function public.crm_empresas_trava_sair();

-- O texto de relacionamento que a líder escreve (variáveis como nos modelos: {saudacao}, {vendedor}…).
-- Cada cliente recebe cada campanha uma vez; segmento vazio = todos.
create table if not exists public.crm_email_campanhas (
  id             uuid primary key default gen_random_uuid(),
  assunto        text not null check (length(btrim(assunto)) > 0),
  corpo          text not null check (length(btrim(corpo)) > 0),
  segmento       text,
  desde          date not null default current_date,
  ativa          boolean not null default true,
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
-- Cada e-mail da cadência: 'enviado'/'erro' gravados pela função; 'pulado' (a vendedora pulou esta
-- vez) pelo app. aberto_em/clicado_em: eventos do Brevo, lidos pela função ("Atualizar aberturas").
create table if not exists public.crm_email_envios (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.crm_empresas(id) on delete cascade,
  responsavel_id uuid references public.crm_usuarios(user_id) on delete set null,
  tipo           text not null check (tipo in ('reposicao', 'relacionamento')),
  campanha_id    uuid references public.crm_email_campanhas(id) on delete set null,
  situacao       text not null default 'enviado' check (situacao in ('enviado', 'erro', 'pulado')),
  para           text[] not null default '{}',
  assunto        text,
  corpo          text,
  erro           text,
  provedor_id    text,
  aberto_em      timestamptz,
  clicado_em     timestamptz,
  enviado_por    uuid default auth.uid(),
  criado_em      timestamptz not null default now()
);
create index if not exists crm_email_envios_empresa_idx on public.crm_email_envios (empresa_id, criado_em);
create index if not exists crm_email_envios_provedor_idx on public.crm_email_envios (provedor_id);
drop trigger if exists crm_email_campanhas_atualizado_em on public.crm_email_campanhas;
create trigger crm_email_campanhas_atualizado_em before update on public.crm_email_campanhas for each row execute function public.crm_toca_atualizado_em();
alter table public.crm_email_campanhas enable row level security;
alter table public.crm_email_envios enable row level security;
revoke all on public.crm_email_campanhas, public.crm_email_envios from anon, public;
grant select, insert, update, delete on public.crm_email_campanhas, public.crm_email_envios to authenticated;
revoke truncate, references, trigger on public.crm_email_campanhas, public.crm_email_envios from authenticated;
drop policy if exists le on public.crm_email_campanhas;
drop policy if exists grava on public.crm_email_campanhas;
create policy le on public.crm_email_campanhas for select to authenticated using ((select public.crm_eh_membro()));
create policy grava on public.crm_email_campanhas for all to authenticated using ((select public.crm_eh_gestor())) with check ((select public.crm_eh_gestor()));
drop policy if exists le on public.crm_email_envios;
drop policy if exists pula on public.crm_email_envios;
drop policy if exists apaga on public.crm_email_envios;
create policy le on public.crm_email_envios for select to authenticated
  using ((select public.crm_eh_gestor()) or empresa_id in (select public.crm_empresas_minhas()));
-- o app só grava "pulado", em nome de quem está usando (o "enviado" vem da função, com a chave de serviço)
create policy pula on public.crm_email_envios for insert to authenticated
  with check (situacao = 'pulado' and enviado_por = (select auth.uid()) and public.crm_ve_empresa(empresa_id));
create policy apaga on public.crm_email_envios for delete to authenticated using ((select public.crm_eh_gestor()));

-- =================================================================== permissões de função
revoke all on function public.crm_papel(), public.crm_eh_ativo(), public.crm_eh_membro(), public.crm_eh_gestor(), public.crm_eh_admin(), public.crm_eh_comprador(),
  public.crm_ve_empresa(uuid), public.crm_ve_negocio(uuid), public.crm_ve_nota(uuid), public.crm_edita_negocio(uuid),
  public.crm_proximo_vendedor(), public.crm_clientes_compras(),
  public.crm_empresas_minhas(), public.crm_negocios_meus(), public.crm_notas_minhas() from public, anon;
grant execute on function public.crm_papel(), public.crm_eh_ativo(), public.crm_eh_membro(), public.crm_eh_gestor(), public.crm_eh_admin(), public.crm_eh_comprador(),
  public.crm_ve_empresa(uuid), public.crm_ve_negocio(uuid), public.crm_ve_nota(uuid), public.crm_edita_negocio(uuid),
  public.crm_proximo_vendedor(), public.crm_clientes_compras(),
  public.crm_empresas_minhas(), public.crm_negocios_meus(), public.crm_notas_minhas() to authenticated;
revoke all on function public.crm_acha_duplicado(text, text[], text[], uuid), public.crm_duplicado_empresa(text, text[], text[], uuid),
  public.crm_barra_duplicado() from public, anon, authenticated;
grant execute on function public.crm_duplicado_empresa(text, text[], text[], uuid) to authenticated;
revoke all on function public.crm_toca_atualizado_em(), public.crm_marca_etapa() from public, anon, authenticated;

-- =================================================================== dados iniciais
-- Só entram se a lista estiver vazia (instalação nova). A importação do Agendor
-- traz as etapas e listas de lá.
insert into public.crm_etapas (funil, nome, ordem, probabilidade)
select 'Vendas', x.nome, x.ordem, x.prob
  from (values ('Prospecção', 1, 10), ('Contato feito', 2, 20), ('Qualificação', 3, 40),
               ('Proposta enviada', 4, 60), ('Negociação', 5, 80)) as x(nome, ordem, prob)
 where not exists (select 1 from public.crm_etapas);

insert into public.crm_opcoes (tipo, nome, ordem)
select x.tipo, x.nome, x.ordem
  from (values
    ('origem','Indicação',1), ('origem','Site',2), ('origem','Google',3), ('origem','Instagram',4),
    ('origem','WhatsApp',5), ('origem','Prospecção ativa',6), ('origem','Feira/Evento',7), ('origem','Cliente antigo',8),
    ('motivo_perda','Preço',1), ('motivo_perda','Comprou do concorrente',2), ('motivo_perda','Prazo de entrega',3),
    ('motivo_perda','Sem orçamento',4), ('motivo_perda','Sem retorno do cliente',5), ('motivo_perda','Produto não atende',6),
    ('motivo_perda','Não era o momento',7)
  ) as x(tipo, nome, ordem)
 where not exists (select 1 from public.crm_opcoes);

-- =================================================================== fotos dos produtos (Storage)
-- SEM USO desde 02/10/2026 (ver crm_produtos.foto). Bucket público para leitura; só gestor/admin
-- envia, troca ou apaga. Fora do Supabase (teste local) não existe
-- o esquema storage: o bloco não faz nada.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('crm-fotos', 'crm-fotos', true, 1048576, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = excluded.allowed_mime_types;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'crm_fotos_le') then
    create policy crm_fotos_le on storage.objects for select to authenticated using (bucket_id = 'crm-fotos' and (select public.crm_eh_ativo()));
    create policy crm_fotos_grava on storage.objects for insert to authenticated with check (bucket_id = 'crm-fotos' and (select public.crm_eh_gestor()));
    create policy crm_fotos_altera on storage.objects for update to authenticated using (bucket_id = 'crm-fotos' and (select public.crm_eh_gestor())) with check (bucket_id = 'crm-fotos' and (select public.crm_eh_gestor()));
    create policy crm_fotos_apaga on storage.objects for delete to authenticated using (bucket_id = 'crm-fotos' and (select public.crm_eh_gestor()));
  end if;
end $$;
