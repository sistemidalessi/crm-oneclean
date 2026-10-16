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
--   logistica - só a tela Separação: pedidos, listas de separação (bolão) e a consulta de estoque;
--              não vê cliente, negócio nem financeiro (o endereço de entrega vem no próprio pedido).
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
  papel        text not null default 'vendedor' check (papel in ('admin','gestor','vendedor','comprador','logistica')),
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
-- Instalação antiga: a trava de papel nasceu sem o comprador (e sem a logística, Fase 3 de 16/10/2026).
alter table public.crm_usuarios drop constraint if exists crm_usuarios_papel_check;
alter table public.crm_usuarios add constraint crm_usuarios_papel_check check (papel in ('admin','gestor','vendedor','comprador','logistica'));

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
-- Chaves de comparação (as mesmas do app, R.chaveDoc, R.chaveTelefone etc.): documento sem pontuação,
-- em maiúsculas (CPF com 11 números; CNPJ com 14, letras permitidas nas 12 primeiras posições desde 07/2026,
-- IN RFB 2.229/2024; texto com prefixo cai nos números, como antes), telefone pelos 8 últimos dígitos (pega
-- com e sem DDD, com e sem o 9 do celular), e-mail em minúsculas.
create or replace function public.crm_doc(t text) returns text language sql immutable set search_path = public as $$
  select case
    when upper(regexp_replace(coalesce(t, ''), '[^0-9A-Za-z]', '', 'g')) ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'
      then upper(regexp_replace(t, '[^0-9A-Za-z]', '', 'g'))
    when length(regexp_replace(coalesce(t, ''), '\D', '', 'g')) in (11, 14) then regexp_replace(t, '\D', '', 'g') end;
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
   where public.crm_eh_membro() and u.ativo and u.recebe_leads and u.papel not in ('comprador', 'logistica')
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
  -- e-mails da cadência: o app não pode mudar a empresa deles, e apagar o cadastro os levaria junto (09/10/2026)
  update public.crm_email_envios set empresa_id = para where empresa_id = any(de);
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

-- =================================================================== espelho Agilité ↔ OneClean (08/10/2026)
-- Pedido do Anderson: "quando eu fizer algo entre Agilité e OneClean, já se lançasse nas duas". Vale só a
-- categoria "Transferência entre empresas" (empréstimo de uma empresa para a outra e a volta). Formato
-- combinado com o sistema da Agilité (o mesmo nos dois sentidos):
--   { versao: 1, origem: 'oneclean'|'agilite', par: '<origem>:<id da ida>', movimentos: [ { ref, papel: 'ida'|'volta',
--     data, tipo (do ponto de vista de quem manda), valor, descricao, situacao: 'realizado'|'previsto' } ] }
--   ou { versao: 1, origem, par, apagar: true }.
-- Recebe: Edge Function crm-caixa-espelho (Bearer = senha de gravação; aqui só o SHA-256, em crm_fin_espelho_cfg) chama
-- crm_espelho_aplicar(). Manda: o gatilho põe o par na fila; o pg_cron roda crm_espelho_tick() a cada
-- minuto, que monta o par (crm_espelho_pacote) e faz o POST pelo pg_net; falhou, tenta de novo em 10 min.
-- Sem eco: o que o espelho grava roda com crm.espelho = '1' e não volta para a fila. Lançamento que veio da
-- Agilité = espelho_ref preenchido (origem fica 'tela').
alter table public.crm_fin_lancamentos add column if not exists espelho_ref text;  -- ref da OUTRA empresa ('agilite:<id>')
alter table public.crm_fin_lancamentos add column if not exists espelho_par text;  -- par a que pertence ('oneclean:<uuid>' ou 'agilite:<id>')
create unique index if not exists crm_fin_lanc_espelho_ref_uq on public.crm_fin_lancamentos (espelho_ref) where espelho_ref is not null;
create index if not exists crm_fin_lanc_espelho_par_idx on public.crm_fin_lancamentos (espelho_par) where espelho_par is not null;

-- para onde mandar e com que senha (a da Agilité): ninguém do app lê; só as funções abaixo
create table if not exists public.crm_fin_espelho_cfg (
  id            smallint primary key default 1 check (id = 1),
  url           text,          -- endereço da Agilité
  senha         text,          -- senha de gravação da Agilité (o CRM manda)
  token_hash    text,          -- SHA-256 da senha que a Agilité usa para gravar aqui
  token_em      timestamptz,
  atualizado_em timestamptz not null default now()
);
alter table public.crm_fin_espelho_cfg add column if not exists token_hash text;
alter table public.crm_fin_espelho_cfg add column if not exists token_em timestamptz;
alter table public.crm_fin_espelho_cfg enable row level security;
revoke all on public.crm_fin_espelho_cfg from anon, authenticated, public;

create table if not exists public.crm_fin_espelho_fila (
  par           text primary key,
  pendente      boolean not null default true,
  mudou_em      timestamptz not null default now(),
  enviar_depois timestamptz not null default now(),
  tentativa_em  timestamptz,
  request_id    bigint,
  tentativas    integer not null default 0,
  ultimo_status integer,
  ultimo_erro   text,
  enviado_em    timestamptz,
  ultimo_pacote jsonb
);
alter table public.crm_fin_espelho_fila enable row level security;
revoke all on public.crm_fin_espelho_fila from anon, authenticated, public;
grant select on public.crm_fin_espelho_fila to authenticated;
drop policy if exists so_admin_le on public.crm_fin_espelho_fila;
create policy so_admin_le on public.crm_fin_espelho_fila for select to authenticated using ((select public.crm_eh_admin()));

create table if not exists public.crm_fin_espelho_log (
  id       bigserial primary key,
  quando   timestamptz not null default now(),
  sentido  text not null check (sentido in ('recebido','enviado')),
  par      text,
  status   integer,
  detalhe  jsonb
);
alter table public.crm_fin_espelho_log enable row level security;
revoke all on public.crm_fin_espelho_log from anon, authenticated, public;
grant select on public.crm_fin_espelho_log to authenticated;
drop policy if exists so_admin_le on public.crm_fin_espelho_log;
create policy so_admin_le on public.crm_fin_espelho_log for select to authenticated using ((select public.crm_eh_admin()));

-- par de um lançamento: o gravado; senão a ida que o criou (frase com "volta"); senão ele mesmo (é a ida)
create or replace function public.crm_espelho_par_de(p_id uuid, p_par text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(p_par,
    (select 'oneclean:' || i.id from public.crm_fin_lancamentos i
      where i.frase_antes -> 'criou' -> 'lancamentos' ? p_id::text limit 1),
    'oneclean:' || p_id);
$$;

-- lançamentos do par (o que está no CRM agora)
create or replace function public.crm_espelho_linhas(p_par text)
returns setof public.crm_fin_lancamentos language sql stable security definer set search_path = public as $$
  with ida as (select case when p_par like 'oneclean:%' and substr(p_par, 10) ~ '^[0-9a-f-]{36}$' then substr(p_par, 10)::uuid end id)
  select l.* from public.crm_fin_lancamentos l, ida
   where l.categoria = 'Transferência entre empresas'
     and (l.espelho_par = p_par or l.id = ida.id
          or l.id::text in (select jsonb_array_elements_text(i.frase_antes -> 'criou' -> 'lancamentos')
                              from public.crm_fin_lancamentos i where i.id = ida.id));
$$;

-- o par como a Agilité espera receber (e marca o par nas linhas, sem voltar para a fila)
create or replace function public.crm_espelho_pacote(p_par text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare movs jsonb; tem_ida boolean;
begin
  select jsonb_agg(jsonb_build_object(
           'ref', coalesce(l.espelho_ref, 'oneclean:' || l.id),
           'papel', case when coalesce(l.espelho_ref, 'oneclean:' || l.id) = p_par then 'ida' else 'volta' end,
           'data', case when l.situacao = 'pago' then l.pago_em else l.vencimento end,
           'tipo', l.tipo, 'valor', l.valor, 'descricao', l.descricao,
           'situacao', case when l.situacao = 'pago' then 'realizado' else 'previsto' end)
         order by (coalesce(l.espelho_ref, 'oneclean:' || l.id) <> p_par), l.vencimento, l.criado_em),
         bool_or(coalesce(l.espelho_ref, 'oneclean:' || l.id) = p_par)
    into movs, tem_ida from public.crm_espelho_linhas(p_par) l;
  -- sem a ida (desfeita): a transferência não existiu, a volta também não → apaga o par inteiro
  if movs is null or not coalesce(tem_ida, false) then
    return jsonb_build_object('versao', 1, 'origem', 'oneclean', 'par', p_par, 'apagar', true);
  end if;
  perform set_config('crm.espelho', '1', true);
  update public.crm_fin_lancamentos set espelho_par = p_par
   where espelho_par is null and id in (select id from public.crm_espelho_linhas(p_par));
  perform set_config('crm.espelho', '', true);
  return jsonb_build_object('versao', 1, 'origem', 'oneclean', 'par', p_par, 'movimentos', movs);
end;
$$;

-- gatilho: transferência entre empresas lançada, ajustada, paga ou desfeita → o par vai para a fila
create or replace function public.crm_espelho_marca()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_par text; c_transf constant text := 'Transferência entre empresas';
begin
  if coalesce(current_setting('crm.espelho', true), '') = '1' then return null; end if;
  if tg_op = 'INSERT' then
    if new.categoria is distinct from c_transf then return null; end if;
    v_id := new.id; v_par := new.espelho_par;
  elsif tg_op = 'DELETE' then
    if old.categoria is distinct from c_transf then return null; end if;
    v_id := old.id; v_par := old.espelho_par;
  else
    if new.categoria is distinct from c_transf and old.categoria is distinct from c_transf then return null; end if;
    if (new.tipo, new.valor, new.vencimento, new.situacao, new.pago_em, new.categoria, new.descricao)
       is not distinct from (old.tipo, old.valor, old.vencimento, old.situacao, old.pago_em, old.categoria, old.descricao) then return null; end if;
    v_id := new.id; v_par := coalesce(new.espelho_par, old.espelho_par);
  end if;
  v_par := public.crm_espelho_par_de(v_id, v_par);
  insert into public.crm_fin_espelho_fila (par) values (v_par)
  on conflict (par) do update set pendente = true, mudou_em = now(), enviar_depois = least(crm_fin_espelho_fila.enviar_depois, now());
  return null;
end;
$$;
drop trigger if exists crm_fin_lanc_espelho on public.crm_fin_lancamentos;
create trigger crm_fin_lanc_espelho after insert or update or delete on public.crm_fin_lancamentos
  for each row execute function public.crm_espelho_marca();

-- recebe o par da Agilité (Edge Function crm-caixa-espelho, com a chave de serviço). 'tipo' vem do ponto
-- de vista dela: aqui inverte. Ref 'oneclean:…' = um original nosso: só data, valor e situação.
create or replace function public.crm_espelho_aplicar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_transf constant text := 'Transferência entre empresas';
  v_par text := p ->> 'par'; m jsonb; refs text[] := '{}';
  r text; t text; d date; v numeric; s text; papel text; lid uuid;
  n_novo int := 0; n_atu int := 0; n_ado int := 0; n_del int := 0; k int;
begin
  if coalesce(p ->> 'versao', '') <> '1' then raise exception 'versao precisa ser 1'; end if;
  if coalesce(p ->> 'origem', '') <> 'agilite' then raise exception 'origem precisa ser agilite'; end if;
  if v_par is null or v_par !~ '^(agilite:[A-Za-z0-9_-]{1,64}|oneclean:[0-9a-f-]{36})$' then raise exception 'par inválido'; end if;
  perform set_config('crm.espelho', '1', true);
  if coalesce(p ->> 'apagar', '') = 'true' then
    delete from public.crm_fin_lancamentos where id in (select id from public.crm_espelho_linhas(v_par));
    get diagnostics n_del = row_count;
    delete from public.crm_fin_espelho_fila where par = v_par;
    insert into public.crm_fin_espelho_log (sentido, par, status, detalhe) values ('recebido', v_par, 200, jsonb_build_object('apagados', n_del));
    return jsonb_build_object('ok', true, 'apagados', n_del);
  end if;
  if jsonb_typeof(p -> 'movimentos') is distinct from 'array' or jsonb_array_length(p -> 'movimentos') not between 1 and 20 then
    raise exception 'movimentos precisa ser uma lista de 1 a 20';
  end if;
  for m in select * from jsonb_array_elements(p -> 'movimentos') loop
    r := m ->> 'ref'; t := m ->> 'tipo'; s := m ->> 'situacao'; papel := coalesce(m ->> 'papel', 'volta');
    if r is null or r !~ '^(agilite:[A-Za-z0-9_-]{1,64}|oneclean:[0-9a-f-]{36})$' then raise exception 'ref inválido: %', r; end if;
    if t not in ('entrada', 'saida') then raise exception 'tipo inválido: %', t; end if;
    if s not in ('realizado', 'previsto') then raise exception 'situacao inválida: %', s; end if;
    if papel not in ('ida', 'volta') then raise exception 'papel inválido: %', papel; end if;
    d := (m ->> 'data')::date; v := round((m ->> 'valor')::numeric, 2);
    if d is null or v is null or v < 0 then raise exception 'data/valor inválidos em %', r; end if;
    t := case t when 'entrada' then 'saida' else 'entrada' end;   -- do nosso lado
    refs := refs || r;
    if r like 'oneclean:%' then
      update public.crm_fin_lancamentos set
          vencimento = case when s = 'previsto' then d else vencimento end, valor = v,
          situacao = case when s = 'realizado' then 'pago' else 'aberto' end,
          pago_em = case when s = 'realizado' then d end,
          baixa = case when s = 'realizado' then coalesce(baixa, 'caixa') end,
          baixado_em = case when s = 'realizado' then coalesce(baixado_em, now()) end,
          espelho_par = v_par
       where id = substr(r, 10)::uuid and categoria = c_transf;
      get diagnostics k = row_count; n_atu := n_atu + k;
      continue;
    end if;
    select id into lid from public.crm_fin_lancamentos where espelho_ref = r;
    if lid is null then  -- lançado à mão aqui antes do espelho existir: adota em vez de duplicar
      select id into lid from public.crm_fin_lancamentos
       where espelho_ref is null and categoria = c_transf and tipo = t and valor = v and (vencimento = d or pago_em = d)
       order by criado_em limit 1;
      if lid is not null then n_ado := n_ado + 1; end if;
    else
      n_atu := n_atu + 1;
    end if;
    if lid is not null then
      update public.crm_fin_lancamentos set espelho_ref = r, espelho_par = v_par,
          vencimento = case when s = 'previsto' then d else vencimento end, valor = v,
          situacao = case when s = 'realizado' then 'pago' else 'aberto' end,
          pago_em = case when s = 'realizado' then d end,
          baixa = case when s = 'realizado' then coalesce(baixa, 'caixa') end,
          baixado_em = case when s = 'realizado' then coalesce(baixado_em, now()) end
       where id = lid;
    else
      insert into public.crm_fin_lancamentos (tipo, descricao, fornecedor, categoria, valor, vencimento, situacao, pago_em, baixa, baixado_em,
          entre_empresas, origem, observacoes, espelho_ref, espelho_par, criado_por)
      values (t,
          case when papel = 'ida' then case when t = 'entrada' then 'Transferência da Agilité' else 'Transferência para a Agilité' end
               else case when t = 'entrada' then 'Agilité devolve a transferência' else 'Devolução da transferência à Agilité' end end,
          'Agilité', c_transf, v, d, case when s = 'realizado' then 'pago' else 'aberto' end, case when s = 'realizado' then d end,
          case when s = 'realizado' then 'caixa' end, case when s = 'realizado' then now() end,
          true, 'tela', left('Lançado no sistema da Agilité: ' || coalesce(m ->> 'descricao', ''), 300), r, v_par, null);
      n_novo := n_novo + 1;
    end if;
    lid := null;
  end loop;
  -- o par vem completo: o que é dele e não veio foi desfeito do outro lado
  delete from public.crm_fin_lancamentos where espelho_par = v_par and coalesce(espelho_ref, 'oneclean:' || id) <> all (refs);
  get diagnostics n_del = row_count;
  insert into public.crm_fin_espelho_log (sentido, par, status, detalhe)
    values ('recebido', v_par, 200, jsonb_build_object('novos', n_novo, 'atualizados', n_atu, 'adotados', n_ado, 'apagados', n_del));
  return jsonb_build_object('ok', true, 'novos', n_novo, 'atualizados', n_atu, 'adotados', n_ado, 'apagados', n_del);
end;
$$;

-- a cada minuto (pg_cron): confere as respostas do pg_net e manda o que está na fila
create or replace function public.crm_espelho_tick()
returns void language plpgsql security definer set search_path = public as $$
declare f record; c_url text; c_senha text; st integer; er text; ct text; pac jsonb; rid bigint;
begin
  for f in select * from public.crm_fin_espelho_fila where request_id is not null loop
    select status_code, error_msg, left(content::text, 300) into st, er, ct from net._http_response where id = f.request_id;
    if found then
      if st = 200 then
        update public.crm_fin_espelho_fila set request_id = null, ultimo_status = 200, ultimo_erro = null, enviado_em = f.tentativa_em,
            tentativas = 0, pendente = (mudou_em > f.tentativa_em) where par = f.par;
      else
        update public.crm_fin_espelho_fila set request_id = null, ultimo_status = st, ultimo_erro = left(coalesce(er, ct, 'sem resposta'), 300),
            enviar_depois = now() + interval '10 minutes', tentativas = tentativas + 1 where par = f.par;
      end if;
      insert into public.crm_fin_espelho_log (sentido, par, status, detalhe)
        values ('enviado', f.par, st, jsonb_build_object('pacote', f.ultimo_pacote, 'resposta', coalesce(er, ct)));
    elsif f.tentativa_em < now() - interval '3 minutes' then
      update public.crm_fin_espelho_fila set request_id = null, ultimo_erro = 'sem resposta em 3 min',
          enviar_depois = now() + interval '10 minutes', tentativas = tentativas + 1 where par = f.par;
    end if;
  end loop;
  select url, senha into c_url, c_senha from public.crm_fin_espelho_cfg where id = 1;
  if c_url is null or c_senha is null then return; end if;
  -- espera 5 s depois da última mudança (a ida e a volta de uma frase chegam juntas)
  for f in select * from public.crm_fin_espelho_fila
            where pendente and request_id is null and enviar_depois <= now() and mudou_em < now() - interval '5 seconds'
            order by mudou_em limit 20 loop
    pac := public.crm_espelho_pacote(f.par);
    rid := net.http_post(url := c_url, body := pac,
             headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || c_senha),
             timeout_milliseconds := 20000);
    update public.crm_fin_espelho_fila set request_id = rid, tentativa_em = now(), ultimo_pacote = pac where par = f.par;
  end loop;
end;
$$;

-- tela de Integrações (só o administrador): guarda endereço e senha da Agilité; a senha nunca volta para o app
create or replace function public.crm_espelho_configura(p_url text, p_senha text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.crm_eh_admin() then raise exception 'só o administrador'; end if;
  if p_url is not null and p_url !~ '^https://[^\s]+$' then raise exception 'o endereço precisa começar com https://'; end if;
  insert into public.crm_fin_espelho_cfg (id, url, senha) values (1, nullif(btrim(p_url), ''), nullif(btrim(p_senha), ''))
  on conflict (id) do update set url = coalesce(nullif(btrim(p_url), ''), crm_fin_espelho_cfg.url),
      senha = coalesce(nullif(btrim(p_senha), ''), crm_fin_espelho_cfg.senha), atualizado_em = now();
  -- trocou endereço ou senha: o que falhou tenta de novo já no próximo minuto
  update public.crm_fin_espelho_fila set enviar_depois = now() where pendente and request_id is null;
end;
$$;
-- senha que a Agilité usa para gravar aqui: gerada no banco, mostrada uma vez, guardada só o SHA-256
create or replace function public.crm_espelho_nova_senha()
returns text language plpgsql security definer set search_path = public as $$
declare tk text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not public.crm_eh_admin() then raise exception 'só o administrador'; end if;
  insert into public.crm_fin_espelho_cfg (id, token_hash, token_em) values (1, encode(sha256(convert_to(tk, 'UTF8')), 'hex'), now())
  on conflict (id) do update set token_hash = excluded.token_hash, token_em = now(), atualizado_em = now();
  return tk;
end;
$$;
create or replace function public.crm_espelho_situacao()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.crm_eh_admin() then jsonb_build_object(
    'url', (select url from public.crm_fin_espelho_cfg where id = 1),
    'tem_senha', coalesce((select senha is not null from public.crm_fin_espelho_cfg where id = 1), false),
    'senha_recebe_em', (select token_em from public.crm_fin_espelho_cfg where id = 1 and token_hash is not null),
    'pendentes', (select count(*) from public.crm_fin_espelho_fila where pendente),
    'com_erro', (select count(*) from public.crm_fin_espelho_fila where pendente and ultimo_erro is not null),
    'ultimo_erro', (select ultimo_erro from public.crm_fin_espelho_fila where pendente and ultimo_erro is not null order by mudou_em desc limit 1),
    'ultimo_enviado', (select max(quando) from public.crm_fin_espelho_log where sentido = 'enviado' and status = 200),
    'ultimo_recebido', (select max(quando) from public.crm_fin_espelho_log where sentido = 'recebido')) end;
$$;
revoke all on function public.crm_espelho_par_de(uuid, text), public.crm_espelho_linhas(text), public.crm_espelho_pacote(text),
  public.crm_espelho_marca(), public.crm_espelho_aplicar(jsonb), public.crm_espelho_tick() from public, anon, authenticated;
revoke all on function public.crm_espelho_configura(text, text), public.crm_espelho_situacao(), public.crm_espelho_nova_senha() from public, anon;
grant execute on function public.crm_espelho_configura(text, text), public.crm_espelho_situacao(), public.crm_espelho_nova_senha() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.crm_espelho_aplicar(jsonb) to service_role;
  end if;
  -- no Supabase (pg_cron + pg_net instalados): a cada minuto
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('crm-espelho', '* * * * *', 'select public.crm_espelho_tick()');
  end if;
end $$;

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

-- =================================================================== anexos do Caixa (13/10/2026)
-- Pedido do Anderson: colar o print do banco, o comprovante ou o boleto (imagem ou PDF) na caixa de frases,
-- escrever "entrou na conta hoje" e o CRM lançar. O arquivo vai para o bucket PRIVADO crm-caixa-anexos
-- (só o administrador envia e lê; o link para abrir é assinado e vale 1 minuto); a Edge Function
-- crm-caixa-ler baixa o arquivo com a chave de serviço, lê com o Claude e devolve os movimentos, que viram
-- frases na mesma conferência de sempre. O lançamento gravado guarda o caminho em anexos.
-- Sem política de apagar de propósito: comprovante não some (Desfazer a frase tira só o lançamento).
alter table public.crm_fin_lancamentos add column if not exists anexos text[];
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('crm-caixa-anexos', 'crm-caixa-anexos', false, 10485760, array['image/png','image/jpeg','image/webp','image/gif','application/pdf'])
  on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'crm_caixa_anexos_le') then
    create policy crm_caixa_anexos_le on storage.objects for select to authenticated using (bucket_id = 'crm-caixa-anexos' and (select public.crm_eh_admin()));
    create policy crm_caixa_anexos_grava on storage.objects for insert to authenticated with check (bucket_id = 'crm-caixa-anexos' and (select public.crm_eh_admin()));
  end if;
end $$;

-- =================================================================== lançamentos excluídos do Caixa (13/10/2026)
-- Pedido do Anderson: botão Excluir na janela do lançamento (conta do FKN lançada por engano: "não é
-- nem pausar, seria excluir"). O lançamento apagado fica guardado aqui inteiro (dados), como cópia de
-- segurança; se veio do FKN (chave_fkn), a chave entra na lista e a próxima listagem do contas a pagar
-- (tela e vigia, fkn.js planoContasPagar) não cria a conta de novo. Só o administrador lê e grava; não
-- há alteração (só desfazer, tirando a linha, para a conta voltar na próxima listagem).
create table if not exists public.crm_fin_excluidos (
  id             uuid primary key default gen_random_uuid(),
  lancamento_id  uuid,
  chave_fkn      text unique,
  descricao      text,
  valor          numeric(14,2),
  vencimento     date,
  dados          jsonb not null default '{}'::jsonb,
  excluido_em    timestamptz not null default now(),
  excluido_por   uuid default auth.uid(),
  criado_em      timestamptz not null default now()
);
alter table public.crm_fin_excluidos add column if not exists criado_em timestamptz not null default now();
alter table public.crm_fin_excluidos enable row level security;
revoke all on public.crm_fin_excluidos from anon, public, authenticated;
grant all on public.crm_fin_excluidos to authenticated;
revoke update, truncate, references, trigger on public.crm_fin_excluidos from authenticated;
drop policy if exists so_admin on public.crm_fin_excluidos;
create policy so_admin on public.crm_fin_excluidos for all to authenticated using ((select public.crm_eh_admin())) with check ((select public.crm_eh_admin()));

-- =================================================================== cobrança: cartório e boletos atualizados (14/10/2026)
-- Pedido do Anderson. (1) Título mandado para o CARTÓRIO (protesto): sai da previsão do Caixa (não se
-- sabe quando o cliente paga) e fica no bloco "Em cartório" com a data e a observação, para voltar
-- quando pagar. A vendedora vê o selo "em cartório" e o título sai da mensagem de cobrança (não se
-- cobra por fora o que está protestado). A listagem do FKN não mexe nestas colunas (o upsert só grava
-- as que traz). (2) BOLETO ATUALIZADO (com juros, 2ª via do BB): o administrador arrasta os PDFs no
-- Caixa → Cobrança, a IA (crm-caixa-ler, modo boleto) lê valor, vencimento e linha digitável, o CRM
-- acha o título e grava aqui; a vendedora da carteira vê na Fila do dia e na ficha, manda pelo
-- WhatsApp dela (mensagem pronta + PDF para anexar) e o CRM anota quem cobrou e quando.
alter table public.crm_titulos add column if not exists cartorio_em date;
alter table public.crm_titulos add column if not exists cartorio_obs text;

-- Duplicatas em atraso com o cartório (substitui crm_duplicatas_atraso no app; a antiga fica por
-- compatibilidade). A observação do cartório não vai para a vendedora: é do administrador.
create or replace function public.crm_atrasos()
returns table (empresa_id uuid, duplicata text, nota_numero integer, parcela integer, vencimento date, valor numeric, abono boolean, portador text, cartorio_em date)
language sql stable security definer set search_path = public as $$
  select t.empresa_id, t.duplicata, t.nota_numero, t.parcela, t.vencimento, t.valor, t.abono, t.portador, t.cartorio_em
    from public.crm_titulos t
   where t.empresa_id is not null and t.vencimento < (now() at time zone 'America/Sao_Paulo')::date
     and (public.crm_eh_gestor() or (public.crm_eh_membro() and t.empresa_id in (select public.crm_empresas_minhas())));
$$;
revoke all on function public.crm_atrasos() from public, anon;
grant execute on function public.crm_atrasos() to authenticated;

create table if not exists public.crm_boletos (
  id              uuid primary key default gen_random_uuid(),
  duplicata       text not null,
  empresa_id      uuid references public.crm_empresas(id) on delete set null,
  nota_numero     integer,
  valor_original  numeric(14,2),
  valor           numeric(14,2) not null,          -- o que o cliente paga (com juros e multa)
  vencimento      date not null,                   -- vencimento do boleto atualizado
  linha_digitavel text,
  arquivo         text,                            -- caminho no bucket crm-boletos
  cobrado_em      timestamptz,
  cobrado_por     uuid,
  criado_por      uuid default auth.uid(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
-- avisado_em: o administrador mandou o boleto ao WhatsApp da vendedora (14/10/2026: nem todas usam o CRM)
alter table public.crm_boletos add column if not exists avisado_em timestamptz;
-- PDF completo (14/10/2026): arquivo passa a ser o PDF montado pelo CRM (resumo + DANFE + boleto do banco) e
-- arquivo_banco guarda o PDF que veio do banco (só o administrador lê; serve para remontar).
alter table public.crm_boletos add column if not exists arquivo_banco text;
-- WhatsApp oficial da Meta (15/10/2026): o envio automático à vendedora (Edge Function crm-whatsapp)
alter table public.crm_boletos add column if not exists wa_msg text;      -- id da mensagem na Meta
alter table public.crm_boletos add column if not exists wa_status text;   -- enviado | entregue | lido | falhou
alter table public.crm_boletos add column if not exists wa_em timestamptz;
alter table public.crm_boletos add column if not exists wa_erro text;
create index if not exists crm_boletos_empresa_idx on public.crm_boletos (empresa_id);
create index if not exists crm_boletos_duplicata_idx on public.crm_boletos (duplicata);
drop trigger if exists crm_boletos_atualizado_em on public.crm_boletos;
create trigger crm_boletos_atualizado_em before update on public.crm_boletos for each row execute function public.crm_toca_atualizado_em();
alter table public.crm_boletos enable row level security;
revoke all on public.crm_boletos from anon, public, authenticated;
grant select, insert, update, delete on public.crm_boletos to authenticated;
-- administrador grava; gestora vê todos; vendedora vê os dos clientes da carteira (e só marca "cobrado"
-- pela função abaixo)
drop policy if exists le on public.crm_boletos;
create policy le on public.crm_boletos for select to authenticated using ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and empresa_id in (select public.crm_empresas_minhas())));
drop policy if exists grava on public.crm_boletos;
create policy grava on public.crm_boletos for insert to authenticated with check ((select public.crm_eh_admin()));
drop policy if exists altera on public.crm_boletos;
create policy altera on public.crm_boletos for update to authenticated using ((select public.crm_eh_admin())) with check ((select public.crm_eh_admin()));
drop policy if exists apaga on public.crm_boletos;
create policy apaga on public.crm_boletos for delete to authenticated using ((select public.crm_eh_admin()));

-- A vendedora (ou quem vê o boleto) marca que mandou ao cliente.
create or replace function public.crm_boleto_cobrado(ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.crm_boletos b set cobrado_em = now(), cobrado_por = auth.uid()
   where b.id = any(ids) and b.cobrado_em is null
     and (public.crm_eh_gestor() or (public.crm_eh_membro() and b.empresa_id in (select public.crm_empresas_minhas())));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.crm_boleto_cobrado(uuid[]) from public, anon;
grant execute on function public.crm_boleto_cobrado(uuid[]) to authenticated;

-- PDFs dos boletos: bucket PRIVADO. O administrador envia; quem vê o boleto na tabela (a política de
-- crm_boletos vale dentro desta) baixa o PDF dele — nunca o de outra carteira.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('crm-boletos', 'crm-boletos', false, 10485760, array['application/pdf','image/png','image/jpeg','image/webp'])
  on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'crm_boletos_le') then
    create policy crm_boletos_le on storage.objects for select to authenticated using (bucket_id = 'crm-boletos' and
      ((select public.crm_eh_admin()) or exists (select 1 from public.crm_boletos b where b.arquivo = name)));
    create policy crm_boletos_grava on storage.objects for insert to authenticated with check (bucket_id = 'crm-boletos' and (select public.crm_eh_admin()));
  end if;
end $$;

-- =================================================================== XML das notas (14/10/2026)
-- O XML autorizado (procNFe) de cada nota fica guardado no bucket PRIVADO crm-notas-xml (nfe/<chave>.xml),
-- para o CRM montar a cópia da DANFE que vai junto com o boleto atualizado (Caixa → Cobrança). O vigia
-- manda o XML e a crm-notas guarda (chave de serviço); a importação manual (XML/ZIP) guarda os que faltam.
-- Só o administrador lê e envia; sem política de apagar.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('crm-notas-xml', 'crm-notas-xml', false, 2097152, array['text/xml','application/xml'])
  on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = excluded.allowed_mime_types;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'crm_notas_xml_le') then
    create policy crm_notas_xml_le on storage.objects for select to authenticated using (bucket_id = 'crm-notas-xml' and (select public.crm_eh_admin()));
    create policy crm_notas_xml_grava on storage.objects for insert to authenticated with check (bucket_id = 'crm-notas-xml' and (select public.crm_eh_admin()));
  end if;
end $$;

-- =================================================================== ofertas: queima de estoque (15/10/2026)
-- Pedido do Anderson: girar o estoque parado (sem venda em 90 dias) com preço de custo + margem pequena,
-- por e-mail (Brevo, em nome da vendedora, crm-email tipo 'oferta') e WhatsApp (a vendedora abre a
-- conversa com o texto pronto). O administrador monta a oferta em Compras (lê o custo do estoque); a
-- oferta guarda SÓ o preço de oferta e o de tabela, nunca o custo (a equipe toda lê a oferta).
create table if not exists public.crm_ofertas (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null check (length(btrim(titulo)) > 0),
  validade       date not null,
  itens          jsonb not null default '[]'::jsonb, -- [{ codigo, descricao, unidade, saldo, preco, preco_tabela, familia }]
  assunto        text not null default '',
  corpo          text not null default '',
  whatsapp       text not null default '',
  ativa          boolean not null default true,
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
drop trigger if exists crm_ofertas_atualizado_em on public.crm_ofertas;
create trigger crm_ofertas_atualizado_em before update on public.crm_ofertas for each row execute function public.crm_toca_atualizado_em();
alter table public.crm_ofertas enable row level security;
revoke all on public.crm_ofertas from anon, public;
grant select, insert, update, delete on public.crm_ofertas to authenticated;
revoke truncate, references, trigger on public.crm_ofertas from authenticated;
drop policy if exists le on public.crm_ofertas;
drop policy if exists grava on public.crm_ofertas;
create policy le on public.crm_ofertas for select to authenticated using ((select public.crm_eh_membro()));
create policy grava on public.crm_ofertas for all to authenticated using ((select public.crm_eh_gestor())) with check ((select public.crm_eh_gestor()));
-- o e-mail da oferta entra no mesmo histórico da cadência (tipo 'oferta'); cada cliente recebe cada oferta uma vez
alter table public.crm_email_envios add column if not exists oferta_id uuid references public.crm_ofertas(id) on delete set null;
alter table public.crm_email_envios drop constraint if exists crm_email_envios_tipo_check;
alter table public.crm_email_envios add constraint crm_email_envios_tipo_check check (tipo in ('reposicao', 'relacionamento', 'oferta'));
create index if not exists crm_email_envios_oferta_idx on public.crm_email_envios (oferta_id) where oferta_id is not null;

-- =================================================================== fiscal: Fase 1 da saída do FKN (15/10/2026)
-- A tributação de cada item das notas autorizadas (CST, alíquotas, CEST, GTIN, origem), lida do XML guardado
-- em crm-notas-xml: é o ponto de partida da regra fiscal de cada produto (o que a contabilidade já recebe todo
-- mês). Fica numa tabela À PARTE de crm_nota_itens de propósito: o app não carrega isto ao abrir (tráfego);
-- só a tela Fiscal, do administrador, lê o resumo pela função crm_fiscal_resumo. Plano: docs/plano-sair-do-fkn.md
-- (repositório sistemi-dalessi).
create table if not exists public.crm_fiscal_itens (
  nota_item_id  uuid primary key references public.crm_nota_itens(id) on delete cascade,
  nota_id       uuid not null references public.crm_notas(id) on delete cascade,
  ordem         integer not null,
  codigo        text,
  emitida_em    timestamptz,
  ncm           text,
  cfop          text,
  gtin          text,
  cest          text,
  origem        text,
  cst_icms      text,     -- CST (ou CSOSN) do ICMS
  aliq_icms     numeric(7,4),
  red_bc_icms   numeric(7,4),
  v_bc_icms     numeric(14,2),
  v_icms        numeric(14,2),
  v_bc_st       numeric(14,2),
  v_icms_st     numeric(14,2),
  v_st_ret      numeric(14,2),  -- ICMS-ST retido antes (CST 60)
  cst_pis       text,
  aliq_pis      numeric(7,4),
  v_pis         numeric(14,2),
  cst_cofins    text,
  aliq_cofins   numeric(7,4),
  v_cofins      numeric(14,2),
  cst_ipi       text,
  v_ipi         numeric(14,2),
  lido_em       timestamptz not null default now()
);
create index if not exists crm_fiscal_itens_codigo_idx on public.crm_fiscal_itens (codigo);
create index if not exists crm_fiscal_itens_nota_idx on public.crm_fiscal_itens (nota_id);
-- A regra fiscal de cada produto (proposta pelas notas, conferida pelo administrador). O CRM emite por ela
-- a partir da Fase 4.
create table if not exists public.crm_fiscal_produtos (
  codigo        text primary key,
  descricao     text,
  unidade       text,
  ncm           text,
  cest          text,
  gtin          text,
  origem        text,
  regra         jsonb not null default '{}'::jsonb,  -- { venda: { cfop, cst_icms, aliq_icms, cst_pis, aliq_pis, cst_cofins, aliq_cofins } }
  alertas       jsonb not null default '[]'::jsonb,
  situacao      text not null default 'proposta' check (situacao in ('proposta', 'conferido')),
  conferido_por uuid,
  conferido_em  timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
drop trigger if exists crm_fiscal_produtos_atualizado_em on public.crm_fiscal_produtos;
create trigger crm_fiscal_produtos_atualizado_em before update on public.crm_fiscal_produtos for each row execute function public.crm_toca_atualizado_em();
alter table public.crm_fiscal_itens enable row level security;
alter table public.crm_fiscal_produtos enable row level security;
revoke all on public.crm_fiscal_itens, public.crm_fiscal_produtos from anon, public;
grant select, insert, update, delete on public.crm_fiscal_itens, public.crm_fiscal_produtos to authenticated;
revoke truncate, references, trigger on public.crm_fiscal_itens, public.crm_fiscal_produtos from authenticated;
drop policy if exists admin on public.crm_fiscal_itens;
drop policy if exists admin on public.crm_fiscal_produtos;
create policy admin on public.crm_fiscal_itens for all to authenticated using ((select public.crm_eh_admin())) with check ((select public.crm_eh_admin()));
create policy admin on public.crm_fiscal_produtos for all to authenticated using ((select public.crm_eh_admin())) with check ((select public.crm_eh_admin()));
-- Destinatário da nota e dados fiscais do cliente (para emitir NF-e): IE, indicador da IE (1 contribuinte,
-- 2 isento, 9 não contribuinte) e o código IBGE do município.
alter table public.crm_notas add column if not exists dest_ie text;
alter table public.crm_notas add column if not exists dest_ind_ie text;
alter table public.crm_notas add column if not exists dest_cmun text;
alter table public.crm_notas add column if not exists fiscal_lido_em timestamptz;
alter table public.crm_empresas add column if not exists ie text;
alter table public.crm_empresas add column if not exists ind_ie text;
alter table public.crm_empresas add column if not exists codigo_municipio text;

-- Grava a tributação lida do XML de um lote de notas: [{ chave, dest: {ie, ind_ie, cmun, cep, logradouro, numero,
-- complemento, bairro, cidade, uf}, itens: [{ ordem, codigo, ncm, cfop, gtin, cest, origem, cst_icms, … }] }].
-- O item é achado pela nota (chave) e pela ordem; o cadastro do cliente só é COMPLETADO (campo vazio), nunca
-- trocado; o endereço só entra inteiro, quando o cadastro não tem nenhum. Só o administrador ou a chave de serviço (crm-notas, o vigia).
create or replace function public.crm_fiscal_grava(lote jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  d jsonb; nid uuid; eid uuid; quando timestamptz; n integer := 0;
begin
  if not (public.crm_eh_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'só o administrador';
  end if;
  for d in select * from jsonb_array_elements(coalesce(lote, '[]'::jsonb)) loop
    select id, empresa_id, emitida_em into nid, eid, quando from public.crm_notas where chave = d->>'chave';
    if nid is null then continue; end if;
    update public.crm_notas set dest_ie = nullif(d#>>'{dest,ie}', ''), dest_ind_ie = nullif(d#>>'{dest,ind_ie}', ''),
      dest_cmun = nullif(d#>>'{dest,cmun}', ''), fiscal_lido_em = now() where id = nid;
    insert into public.crm_fiscal_itens (nota_item_id, nota_id, ordem, codigo, emitida_em, ncm, cfop, gtin, cest, origem,
      cst_icms, aliq_icms, red_bc_icms, v_bc_icms, v_icms, v_bc_st, v_icms_st, v_st_ret, cst_pis, aliq_pis, v_pis,
      cst_cofins, aliq_cofins, v_cofins, cst_ipi, v_ipi, lido_em)
    select i.id, nid, i.ordem, nullif(x->>'codigo', ''), quando, nullif(x->>'ncm', ''), nullif(x->>'cfop', ''), nullif(x->>'gtin', ''),
      nullif(x->>'cest', ''), nullif(x->>'origem', ''), nullif(x->>'cst_icms', ''), (x->>'aliq_icms')::numeric, (x->>'red_bc_icms')::numeric,
      (x->>'v_bc_icms')::numeric, (x->>'v_icms')::numeric, (x->>'v_bc_st')::numeric, (x->>'v_icms_st')::numeric, (x->>'v_st_ret')::numeric,
      nullif(x->>'cst_pis', ''), (x->>'aliq_pis')::numeric, (x->>'v_pis')::numeric, nullif(x->>'cst_cofins', ''), (x->>'aliq_cofins')::numeric,
      (x->>'v_cofins')::numeric, nullif(x->>'cst_ipi', ''), (x->>'v_ipi')::numeric, now()
    from jsonb_array_elements(coalesce(d->'itens', '[]'::jsonb)) x
    join public.crm_nota_itens i on i.nota_id = nid and i.ordem = (x->>'ordem')::integer
    on conflict (nota_item_id) do update set codigo = excluded.codigo, ncm = excluded.ncm, cfop = excluded.cfop, gtin = excluded.gtin,
      cest = excluded.cest, origem = excluded.origem, cst_icms = excluded.cst_icms, aliq_icms = excluded.aliq_icms, red_bc_icms = excluded.red_bc_icms,
      v_bc_icms = excluded.v_bc_icms, v_icms = excluded.v_icms, v_bc_st = excluded.v_bc_st, v_icms_st = excluded.v_icms_st, v_st_ret = excluded.v_st_ret,
      cst_pis = excluded.cst_pis, aliq_pis = excluded.aliq_pis, v_pis = excluded.v_pis, cst_cofins = excluded.cst_cofins, aliq_cofins = excluded.aliq_cofins,
      v_cofins = excluded.v_cofins, cst_ipi = excluded.cst_ipi, v_ipi = excluded.v_ipi, lido_em = now();
    if eid is not null then
      update public.crm_empresas set
        ie = coalesce(nullif(ie, ''), nullif(d#>>'{dest,ie}', '')),
        ind_ie = coalesce(nullif(ind_ie, ''), nullif(d#>>'{dest,ind_ie}', '')),
        codigo_municipio = coalesce(nullif(codigo_municipio, ''), nullif(d#>>'{dest,cmun}', ''))
      where id = eid and (coalesce(ie, '') = '' or coalesce(ind_ie, '') = '' or coalesce(codigo_municipio, '') = '');
      -- endereço: só quando o cadastro não tem endereço nenhum (não mistura o do Agendor com o da nota)
      update public.crm_empresas set cep = nullif(d#>>'{dest,cep}', ''), logradouro = nullif(d#>>'{dest,logradouro}', ''),
        numero = nullif(d#>>'{dest,numero}', ''), complemento = nullif(d#>>'{dest,complemento}', ''), bairro = nullif(d#>>'{dest,bairro}', ''),
        cidade = coalesce(nullif(d#>>'{dest,cidade}', ''), cidade), uf = coalesce(nullif(d#>>'{dest,uf}', ''), uf)
      where id = eid and coalesce(logradouro, '') = '' and coalesce(d#>>'{dest,logradouro}', '') <> '';
      -- mesma rua sem o número (cadastro do Agendor): o número (e o complemento, se faltar) vem da nota
      update public.crm_empresas set numero = nullif(d#>>'{dest,numero}', ''), complemento = coalesce(nullif(complemento, ''), nullif(d#>>'{dest,complemento}', ''))
      where id = eid and coalesce(numero, '') = '' and coalesce(d#>>'{dest,numero}', '') <> ''
        and upper(btrim(logradouro)) = upper(btrim(d#>>'{dest,logradouro}'));
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.crm_fiscal_grava(jsonb) from public, anon;
grant execute on function public.crm_fiscal_grava(jsonb) to authenticated, service_role;

-- Resumo por produto para a tela Fiscal: NCM, CEST, GTIN e origem vistos e cada combinação de tributação
-- (CFOP + CST + alíquotas) com quantas vezes e a última data. Só o administrador.
create or replace function public.crm_fiscal_resumo()
returns table (codigo text, descricao text, unidade text, notas bigint, ultima date, ncms jsonb, cests jsonb, gtins jsonb, origens jsonb, combos jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_eh_admin() then raise exception 'só o administrador'; end if;
  return query
  with f as (
    select fi.*, ni.descricao, ni.unidade from public.crm_fiscal_itens fi join public.crm_nota_itens ni on ni.id = fi.nota_item_id
    join public.crm_notas n on n.id = fi.nota_id where not n.cancelada and fi.codigo is not null
  ), conta as (
    select f.codigo, jsonb_build_object('cfop', f.cfop, 'cst_icms', f.cst_icms, 'aliq_icms', f.aliq_icms, 'red_bc_icms', f.red_bc_icms,
      'cst_pis', f.cst_pis, 'aliq_pis', f.aliq_pis, 'cst_cofins', f.cst_cofins, 'aliq_cofins', f.aliq_cofins,
      'n', count(*), 'ultima', max(f.emitida_em)::date, 'primeira', min(f.emitida_em)::date) c
    from f group by f.codigo, f.cfop, f.cst_icms, f.aliq_icms, f.red_bc_icms, f.cst_pis, f.aliq_pis, f.cst_cofins, f.aliq_cofins
  ), combos as (
    select conta.codigo, jsonb_agg(conta.c order by (conta.c->>'n')::int desc) combos from conta group by conta.codigo
  ), ncm_g as (
    select f.codigo, f.ncm, jsonb_build_object('n', count(*), 'ultima', max(f.emitida_em)::date, 'primeira', min(f.emitida_em)::date) v
    from f where f.ncm is not null group by f.codigo, f.ncm
  ), ncm_a as (
    select ncm_g.codigo, jsonb_object_agg(ncm_g.ncm, ncm_g.v) ncms from ncm_g group by ncm_g.codigo
  ), ag as (
    select f.codigo, (array_agg(f.descricao order by f.emitida_em desc))[1] descricao, (array_agg(f.unidade order by f.emitida_em desc))[1] unidade,
      count(distinct f.nota_id) notas, max(f.emitida_em)::date ultima,
      to_jsonb(array_remove(array_agg(distinct f.cest), null)) cests, to_jsonb(array_remove(array_agg(distinct f.gtin), null)) gtins,
      to_jsonb(array_remove(array_agg(distinct f.origem), null)) origens
    from f group by f.codigo
  )
  select ag.codigo, ag.descricao, ag.unidade, ag.notas, ag.ultima, coalesce(ncm_a.ncms, '{}'::jsonb), ag.cests, ag.gtins, ag.origens, combos.combos
  from ag left join ncm_a on ncm_a.codigo = ag.codigo left join combos on combos.codigo = ag.codigo;
end;
$$;
revoke all on function public.crm_fiscal_resumo() from public, anon;
grant execute on function public.crm_fiscal_resumo() to authenticated;

-- =================================================================== estoque do CRM: Fase 2 da saída do FKN (16/10/2026)
-- O CRM passa a ter o próprio estoque, em paralelo com o FKN: um LIVRO DE MOVIMENTOS (crm_estoque_mov) e o saldo
-- de cada produto (crm_estoque_saldo, mantido pelo gatilho do livro). O livro não se edita nem se apaga: erro se
-- corrige com estorno ou ajuste. Saldo inicial = a listagem do FKN ("atual": o físico, com o reservado para
-- cliente) na hora em que ela foi gerada; depois disso cada item de nota de venda que chega vira saída (gatilho),
-- nota cancelada estorna. A cada listagem do FKN o banco compara os dois saldos na mesma hora
-- (crm_estoque_conferir) e guarda as diferenças com a explicação provável. Unidade: a venda "CX" de um produto
-- controlado em PT/UN multiplica pelo fator da caixa fechada (crm_estoque_unidades).
alter table public.crm_estoque add column if not exists estoque_atual numeric(14,3); -- "atual" da listagem (físico)

create or replace function public.crm_un(t text) returns text language sql immutable set search_path = public as $$
  select nullif(upper(translate(btrim(coalesce(t, '')), 'çÇ', 'cC')), '');
$$;

create table if not exists public.crm_estoque_saldo (
  codigo        text primary key check (length(btrim(codigo)) > 0),
  descricao     text,
  unidade       text,
  saldo         numeric(14,3) not null default 0,
  custo_medio   numeric(16,4),
  inicio        timestamptz not null,           -- o CRM conta este produto a partir daqui (saldo inicial)
  ult_mov       timestamptz,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.crm_estoque_unidades (
  codigo        text not null,
  unidade       text not null,                  -- unidade da nota (crm_un)
  fator         numeric(14,4) not null check (fator > 0),
  origem        text not null default 'auto' check (origem in ('auto', 'manual')),
  atualizado_em timestamptz not null default now(),
  primary key (codigo, unidade)
);
create table if not exists public.crm_estoque_mov (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null references public.crm_estoque_saldo(codigo),
  quando         timestamptz not null,
  tipo           text not null check (tipo in ('inicial', 'saida', 'entrada', 'ajuste', 'inventario', 'estorno')),
  quantidade     numeric(14,3) not null,          -- na unidade do estoque; + entra, − sai
  custo_unit     numeric(16,4),
  qtd_doc        numeric(14,4),                   -- como estava no documento (nota)
  unidade_doc    text,
  fator          numeric(14,4),
  conferir       boolean not null default false,  -- unidade da nota sem fator conhecido (contou 1:1)
  nota_item_id   uuid unique,                     -- saída da nota de venda (uma vez só)
  compra_item_id uuid unique,                     -- entrada da nota de compra
  estorno_de     uuid unique references public.crm_estoque_mov(id),
  motivo         text,
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now()
);
create index if not exists crm_estoque_mov_cod on public.crm_estoque_mov (codigo, quando);
create table if not exists public.crm_estoque_fotos (
  id           bigint generated always as identity primary key,
  gerado_em    timestamptz not null,             -- hora em que a listagem foi gerada no FKN
  recebido_em  timestamptz not null default now(),
  linhas       integer,
  conferida_em timestamptz,
  resumo       jsonb
);
create table if not exists public.crm_estoque_difs (
  foto_id    bigint not null references public.crm_estoque_fotos(id) on delete cascade,
  codigo     text not null,
  descricao  text,
  saldo_crm  numeric(14,3),
  saldo_fkn  numeric(14,3),
  diferenca  numeric(14,3),
  explicacao text,
  primary key (foto_id, codigo)
);
do $$ declare t text; begin
  foreach t in array array['crm_estoque_saldo', 'crm_estoque_unidades', 'crm_estoque_mov', 'crm_estoque_fotos', 'crm_estoque_difs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists ler on public.%I', t);
    execute format('create policy ler on public.%I for select to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()))', t);
  end loop;
end $$;
-- o comprador e o administrador acertam o fator de uma unidade (o resto só pelas funções abaixo)
grant insert, update on public.crm_estoque_unidades to authenticated;
drop policy if exists acerta on public.crm_estoque_unidades;
create policy acerta on public.crm_estoque_unidades for insert to authenticated with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
drop policy if exists acerta2 on public.crm_estoque_unidades;
create policy acerta2 on public.crm_estoque_unidades for update to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()))
  with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));

-- saldo e custo médio a cada movimento (custo médio ponderado só nas entradas com custo)
create or replace function public.crm_estoque_mov_saldo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.crm_estoque_saldo s set
    custo_medio = case
      when new.tipo = 'inicial' then coalesce(new.custo_unit, s.custo_medio)
      when new.tipo = 'entrada' and new.quantidade > 0 and coalesce(new.custo_unit, 0) > 0 then
        case when s.saldo <= 0 or s.custo_medio is null then new.custo_unit
             else round((s.saldo * s.custo_medio + new.quantidade * new.custo_unit) / (s.saldo + new.quantidade), 4) end
      else s.custo_medio end,
    saldo = s.saldo + new.quantidade,
    ult_mov = greatest(coalesce(s.ult_mov, new.quando), new.quando),
    atualizado_em = now()
  where s.codigo = new.codigo;
  return null;
end;
$$;
drop trigger if exists crm_estoque_mov_saldo on public.crm_estoque_mov;
create trigger crm_estoque_mov_saldo after insert on public.crm_estoque_mov for each row execute function public.crm_estoque_mov_saldo();
create or replace function public.crm_estoque_mov_trava() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'o livro de estoque não se edita nem se apaga: corrija com estorno ou ajuste'; end;
$$;
drop trigger if exists crm_estoque_mov_trava on public.crm_estoque_mov;
create trigger crm_estoque_mov_trava before update or delete on public.crm_estoque_mov for each row execute function public.crm_estoque_mov_trava();

-- Saída de um item de nota de venda (uma vez por item). Não move: nota cancelada, CFOP de entrada, simples
-- faturamento da entrega futura (5922/6922: a mercadoria sai na remessa 5117/6117) e serviço; nota emitida antes
-- do saldo inicial do produto (já estava no saldo do FKN). Produto que o livro ainda não tem entra com saldo zero.
create or replace function public.crm_estoque_saida_item(p_item uuid) returns void language plpgsql security definer set search_path = public as $$
declare i record; n record; s record; f numeric; conf boolean := false; un text;
begin
  select id, nota_id, codigo, descricao, unidade, quantidade, cfop into i from public.crm_nota_itens where id = p_item;
  if i.id is null or coalesce(btrim(i.codigo), '') = '' or coalesce(i.quantidade, 0) = 0 then return; end if;
  if i.cfop is not null and (i.cfop !~ '^[56]' or i.cfop in ('5922', '6922', '5933', '6933')) then return; end if;
  select numero, emitida_em, cancelada into n from public.crm_notas where id = i.nota_id;
  if n.emitida_em is null or n.cancelada then return; end if;
  if exists (select 1 from public.crm_estoque_mov where nota_item_id = p_item) then return; end if;
  if not exists (select 1 from public.crm_estoque_saldo) then return; end if; -- o livro ainda não começou
  un := public.crm_un(i.unidade);
  select codigo, unidade, inicio into s from public.crm_estoque_saldo where codigo = i.codigo;
  if s.codigo is null then
    insert into public.crm_estoque_saldo (codigo, descricao, unidade, inicio) values (i.codigo, i.descricao, un, n.emitida_em - interval '1 second')
      on conflict (codigo) do nothing;
    select codigo, unidade, inicio into s from public.crm_estoque_saldo where codigo = i.codigo;
  end if;
  if n.emitida_em <= s.inicio then return; end if;
  select u.fator into f from public.crm_estoque_unidades u where u.codigo = i.codigo and u.unidade = un;
  if f is null then f := 1; conf := un is not null and s.unidade is not null and un <> s.unidade; end if;
  insert into public.crm_estoque_mov (codigo, quando, tipo, quantidade, qtd_doc, unidade_doc, fator, conferir, nota_item_id, motivo, criado_por)
  values (i.codigo, n.emitida_em, 'saida', -round(i.quantidade * f, 3), i.quantidade, un, f, conf, p_item, 'NF ' || n.numero, null);
end;
$$;
revoke all on function public.crm_estoque_saida_item(uuid) from public, anon, authenticated;

create or replace function public.crm_estoque_nota_item() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public.crm_estoque_saida_item(new.id); return null; end if;
  -- item apagado (nota apagada ou mesclada): devolve o que ele tirou
  insert into public.crm_estoque_mov (codigo, quando, tipo, quantidade, qtd_doc, unidade_doc, fator, estorno_de, motivo, criado_por)
  select m.codigo, now(), 'estorno', -m.quantidade, m.qtd_doc, m.unidade_doc, m.fator, m.id, 'item de nota apagado (' || coalesce(m.motivo, '') || ')', auth.uid()
  from public.crm_estoque_mov m where m.nota_item_id = old.id and m.tipo = 'saida' and not exists (select 1 from public.crm_estoque_mov e where e.estorno_de = m.id);
  return old;
end;
$$;
drop trigger if exists crm_estoque_nota_item on public.crm_nota_itens;
create trigger crm_estoque_nota_item after insert on public.crm_nota_itens for each row execute function public.crm_estoque_nota_item();
drop trigger if exists crm_estoque_nota_item_del on public.crm_nota_itens;
create trigger crm_estoque_nota_item_del before delete on public.crm_nota_itens for each row execute function public.crm_estoque_nota_item();

create or replace function public.crm_estoque_nota_cancelada() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.crm_estoque_mov (codigo, quando, tipo, quantidade, qtd_doc, unidade_doc, fator, estorno_de, motivo, criado_por)
  select m.codigo, now(), 'estorno', -m.quantidade, m.qtd_doc, m.unidade_doc, m.fator, m.id, coalesce(m.motivo, 'NF') || ' cancelada', auth.uid()
  from public.crm_estoque_mov m join public.crm_nota_itens i on i.id = m.nota_item_id
  where i.nota_id = new.id and m.tipo = 'saida' and not exists (select 1 from public.crm_estoque_mov e where e.estorno_de = m.id);
  return null;
end;
$$;
drop trigger if exists crm_estoque_nota_cancelada on public.crm_notas;
create trigger crm_estoque_nota_cancelada after update of cancelada on public.crm_notas for each row
  when (new.cancelada and not coalesce(old.cancelada, false)) execute function public.crm_estoque_nota_cancelada();

-- Fator da caixa fechada (variante ".1", ".2"… da listagem do FKN, vendida como "CX" com o código da unidade):
-- custo da caixa ÷ custo da unidade, quando dá inteiro (±5%); senão o "C/ N" da descrição. Com mais de uma caixa
-- (".1", ".2"), vale a primeira; o comprador acerta à mão (origem 'manual' não é sobrescrita).
create or replace function public.crm_estoque_fatores() returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.crm_estoque_unidades (codigo, unidade, fator, origem)
  select distinct on (u.codigo) u.codigo, 'CX', x.f, 'auto'
  from public.crm_estoque v join public.crm_estoque u on u.codigo = regexp_replace(v.codigo, '\.\d+$', '')
  cross join lateral (select coalesce(nullif(v.custo_compra, 0), v.custo_unit) / nullif(coalesce(nullif(u.custo_compra, 0), u.custo_unit), 0) r) c
  cross join lateral (select case when c.r >= 1.5 and abs(c.r - round(c.r)) / c.r < 0.05 then round(c.r)
    else nullif(coalesce(substring(v.descricao from '(?i)C/\s*(\d+)'), substring(v.descricao from '(?i)CX\.?\s*(\d+)\s*X')), '')::numeric end f) x
  where v.codigo ~ '\.\d+$' and x.f > 1 and coalesce(public.crm_un(u.unidade), '') <> 'CX'
  order by u.codigo, v.codigo
  on conflict (codigo, unidade) do update set fator = excluded.fator, atualizado_em = now() where crm_estoque_unidades.origem = 'auto';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.crm_estoque_fatores() from public, anon, authenticated;

-- Conferência CRM × FKN na hora da listagem: saldo do livro até gerado_em × "atual" do FKN. Explicação provável
-- de cada diferença (a ordem importa): unidade da venda a conferir; nota emitida perto da hora da listagem;
-- entrada no FKN depois do início (compra sem entrada no CRM); saída no FKN sem nota no CRM; produto só no CRM.
create or replace function public.crm_estoque_conferir(p_foto bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare f record; r jsonb;
begin
  if not (public.crm_eh_admin() or public.crm_eh_comprador() or coalesce(auth.role(), '') = 'service_role') then raise exception 'só o administrador ou o comprador'; end if;
  select * into f from public.crm_estoque_fotos where id = p_foto;
  if f.id is null or not exists (select 1 from public.crm_estoque_saldo) then return null; end if;
  if f.conferida_em is not null then return f.resumo; end if; -- cada listagem é conferida uma vez (de novo = nova listagem)
  insert into public.crm_estoque_difs (foto_id, codigo, descricao, saldo_crm, saldo_fkn, diferenca, explicacao)
  with crm as (
    select s.codigo, s.descricao, s.inicio, coalesce((select sum(m.quantidade) from public.crm_estoque_mov m where m.codigo = s.codigo and m.quando <= f.gerado_em), 0) q
    from public.crm_estoque_saldo s where s.inicio <= f.gerado_em
  ), fkn as (
    select e.codigo, e.descricao, coalesce(e.estoque_atual, e.quantidade + coalesce(e.pend_cliente, 0)) q, e.ult_entrada, e.ult_saida
    from public.crm_estoque e where e.codigo !~ '\.\d+$'
  ), j as (
    select coalesce(c.codigo, k.codigo) codigo, coalesce(k.descricao, c.descricao) descricao, coalesce(c.q, 0) qc, coalesce(k.q, 0) qk, c.inicio, k.ult_entrada, k.ult_saida, c.codigo is null so_fkn, k.codigo is null so_crm
    from crm c full join fkn k on k.codigo = c.codigo
  )
  select f.id, j.codigo, j.descricao, j.qc, j.qk, j.qk - j.qc,
    case
      when j.so_fkn then 'produto novo no FKN (o CRM ainda não tem)'
      when exists (select 1 from public.crm_estoque_mov m where m.codigo = j.codigo and m.conferir and m.quando <= f.gerado_em) then 'venda em unidade sem fator (confira a unidade)'
      when exists (select 1 from public.crm_estoque_mov m where m.codigo = j.codigo and m.tipo = 'saida' and m.quando between f.gerado_em - interval '30 minutes' and f.gerado_em) then 'nota emitida perto da hora da listagem'
      when j.qk > j.qc and j.ult_entrada >= j.inicio::date then 'entrada no FKN em ' || to_char(j.ult_entrada, 'DD/MM') || ' sem entrada no CRM (nota de compra)'
      when j.qk < j.qc and j.ult_saida >= j.inicio::date then 'saída no FKN (' || to_char(j.ult_saida, 'DD/MM') || ') sem nota no CRM'
      when j.so_crm then 'produto só no CRM (vendido sem cadastro no FKN)'
      else 'sem explicação' end
  from j where abs(j.qk - j.qc) >= 0.0005;
  select jsonb_build_object('produtos', (select count(*) from public.crm_estoque_saldo where inicio <= f.gerado_em),
    'diferentes', count(*), 'sem_explicacao', count(*) filter (where explicacao = 'sem explicação')) into r
  from public.crm_estoque_difs where foto_id = f.id;
  update public.crm_estoque_fotos set conferida_em = now(), resumo = r where id = f.id;
  return r;
end;
$$;
revoke all on function public.crm_estoque_conferir(bigint) from public, anon;
grant execute on function public.crm_estoque_conferir(bigint) to authenticated, service_role;

-- Chegou uma listagem do FKN (vigia ou tela): guarda a hora em que foi gerada, refaz os fatores das caixas e,
-- com o livro já começado, confere.
create or replace function public.crm_estoque_foto(p_gerado timestamptz, p_linhas integer) returns jsonb language plpgsql security definer set search_path = public as $$
declare fid bigint; r jsonb;
begin
  if not (public.crm_eh_admin() or public.crm_eh_comprador() or coalesce(auth.role(), '') = 'service_role') then raise exception 'só o administrador ou o comprador'; end if;
  insert into public.crm_estoque_fotos (gerado_em, linhas) values (coalesce(p_gerado, now()), p_linhas) returning id into fid;
  perform public.crm_estoque_fatores();
  r := public.crm_estoque_conferir(fid);
  return jsonb_build_object('foto', fid, 'conferencia', r);
end;
$$;
revoke all on function public.crm_estoque_foto(timestamptz, integer) from public, anon;
grant execute on function public.crm_estoque_foto(timestamptz, integer) to authenticated, service_role;

-- Começa o estoque do CRM (uma vez, só o administrador): saldo inicial = a última listagem do FKN, na hora em que
-- ela foi gerada; as notas emitidas depois disso que já estão no CRM viram saída na hora.
create or replace function public.crm_estoque_iniciar() returns jsonb language plpgsql security definer set search_path = public as $$
declare f record; it record; n integer; ns integer := 0;
begin
  if not public.crm_eh_admin() then raise exception 'só o administrador'; end if;
  if exists (select 1 from public.crm_estoque_saldo) then raise exception 'o estoque do CRM já foi começado'; end if;
  select * into f from public.crm_estoque_fotos order by gerado_em desc limit 1;
  if f.id is null then raise exception 'falta uma listagem de produtos do FKN com a hora: puxe a listagem e tente de novo'; end if;
  insert into public.crm_estoque_saldo (codigo, descricao, unidade, inicio)
    select e.codigo, e.descricao, public.crm_un(e.unidade), f.gerado_em from public.crm_estoque e where e.codigo !~ '\.\d+$';
  get diagnostics n = row_count;
  perform public.crm_estoque_fatores();
  insert into public.crm_estoque_mov (codigo, quando, tipo, quantidade, custo_unit, motivo)
    select e.codigo, f.gerado_em, 'inicial', coalesce(e.estoque_atual, e.quantidade + coalesce(e.pend_cliente, 0)), nullif(e.custo_unit, 0),
      'saldo do FKN (listagem de ' || to_char(f.gerado_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ')'
    from public.crm_estoque e where e.codigo !~ '\.\d+$';
  for it in select i.id from public.crm_nota_itens i join public.crm_notas nt on nt.id = i.nota_id where nt.emitida_em > f.gerado_em and not nt.cancelada loop
    perform public.crm_estoque_saida_item(it.id); ns := ns + 1;
  end loop;
  return jsonb_build_object('produtos', n, 'itens_depois', ns, 'desde', f.gerado_em, 'conferencia', public.crm_estoque_conferir(f.id));
end;
$$;
revoke all on function public.crm_estoque_iniciar() from public, anon;
grant execute on function public.crm_estoque_iniciar() to authenticated;

-- Ajuste avulso e inventário por contagem (administrador ou comprador): leva o saldo ao contado.
-- lote: [{codigo, contado}]; tipo 'ajuste' (um produto, com motivo) ou 'inventario' (a contagem).
create or replace function public.crm_estoque_contagem(lote jsonb, p_tipo text, p_motivo text) returns integer language plpgsql security definer set search_path = public as $$
declare x jsonb; s record; n integer := 0; d numeric;
begin
  if not (public.crm_eh_admin() or public.crm_eh_comprador()) then raise exception 'só o administrador ou o comprador'; end if;
  if p_tipo not in ('ajuste', 'inventario') then raise exception 'tipo inválido'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'diga o motivo'; end if;
  for x in select * from jsonb_array_elements(coalesce(lote, '[]'::jsonb)) loop
    select codigo, saldo into s from public.crm_estoque_saldo where codigo = x->>'codigo' for update;
    if s.codigo is null then raise exception 'produto % não está no estoque do CRM', x->>'codigo'; end if;
    d := round((x->>'contado')::numeric - s.saldo, 3);
    if d = 0 then continue; end if;
    insert into public.crm_estoque_mov (codigo, quando, tipo, quantidade, motivo) values (s.codigo, now(), p_tipo, d, left(btrim(p_motivo), 300));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.crm_estoque_contagem(jsonb, text, text) from public, anon;
grant execute on function public.crm_estoque_contagem(jsonb, text, text) to authenticated;

-- Entrada de compra pelo XML (Fase 2, 16/10/2026): o comprador sobe o XML da nota do fornecedor (pendente), liga cada
-- item a um produto nosso com o fator de unidade (o CRM lembra a ligação por fornecedor + código do fornecedor) e dá
-- a entrada: soma no estoque com o custo do item (vProd − vDesc + IPI + ST + frete + seguro/outras, ÷ quantidade na
-- unidade do estoque; sem tirar créditos de ICMS/PIS/COFINS) e refaz o custo médio. Durante o paralelo com o FKN as
-- parcelas NÃO viram contas a pagar (o FKN já lança e o Caixa duplicaria): ficam guardadas em parcelas.
-- Sem "on delete cascade" de propósito: nota de compra não se apaga (deixar de lado = situacao 'ignorada').
create table if not exists public.crm_compras (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  numero bigint, serie text, emitida_em timestamptz,
  fornecedor_doc text, fornecedor_nome text,
  valor_produtos numeric(16,2), valor_total numeric(16,2),
  parcelas jsonb not null default '[]'::jsonb,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'lancada', 'ignorada')),
  lancada_em timestamptz, lancada_por uuid, obs text,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create table if not exists public.crm_compra_itens (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.crm_compras(id),
  ordem integer not null,
  cod_fornecedor text, descricao text, ean text, ncm text, cfop text, unidade text,
  quantidade numeric(14,4) not null default 0,
  valor_total numeric(16,2) not null default 0,   -- vProd − vDesc
  ipi numeric(16,2) not null default 0, st numeric(16,2) not null default 0,
  frete numeric(16,2) not null default 0, outras numeric(16,2) not null default 0, -- outras = seguro + outras despesas
  codigo text, fator numeric(14,4),
  unique (compra_id, ordem)
);
create table if not exists public.crm_compra_vinculos (
  fornecedor_doc text not null, cod_fornecedor text not null,
  codigo text not null, fator numeric(14,4) not null default 1 check (fator > 0),
  atualizado_em timestamptz not null default now(),
  primary key (fornecedor_doc, cod_fornecedor)
);
alter table public.crm_compras enable row level security;
alter table public.crm_compra_itens enable row level security;
alter table public.crm_compra_vinculos enable row level security;
revoke all on public.crm_compras, public.crm_compra_itens, public.crm_compra_vinculos from anon, public;
drop policy if exists tudo on public.crm_compras;
create policy tudo on public.crm_compras for select to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
drop policy if exists grava on public.crm_compras;
create policy grava on public.crm_compras for insert to authenticated with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
drop policy if exists muda on public.crm_compras;
create policy muda on public.crm_compras for update to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())) with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
drop policy if exists tudo on public.crm_compra_itens;
create policy tudo on public.crm_compra_itens for select to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
drop policy if exists grava on public.crm_compra_itens;
create policy grava on public.crm_compra_itens for insert to authenticated with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
drop policy if exists tudo on public.crm_compra_vinculos;
create policy tudo on public.crm_compra_vinculos for select to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));

create or replace function public.crm_compra_lancar(p_compra uuid, p_itens jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; it record; x jsonb; cod text; f numeric; q numeric; custo numeric; n integer := 0; ign integer := 0; agora timestamptz := now();
begin
  if not (public.crm_eh_admin() or public.crm_eh_comprador()) then raise exception 'só o administrador ou o comprador'; end if;
  select * into c from public.crm_compras where id = p_compra for update;
  if c.id is null then raise exception 'nota de compra não encontrada'; end if;
  if c.situacao <> 'pendente' then raise exception 'esta nota já foi %', case c.situacao when 'lancada' then 'lançada' else 'deixada de lado' end; end if;
  if not exists (select 1 from public.crm_estoque_saldo) then raise exception 'comece o estoque do CRM antes de dar entrada nas compras'; end if;
  for it in select * from public.crm_compra_itens where compra_id = c.id order by ordem loop
    x := null;
    select e.value into x from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e where e.value->>'id' = it.id::text limit 1;
    if x is null then raise exception 'falta dizer o produto do item % (%)', it.ordem, it.descricao; end if;
    if coalesce((x->>'ignorar')::boolean, false) then ign := ign + 1; continue; end if;
    cod := nullif(btrim(x->>'codigo'), ''); f := nullif(x->>'fator', '')::numeric;
    if cod is null or f is null or f <= 0 then raise exception 'item % (%): diga o produto e o fator', it.ordem, it.descricao; end if;
    q := round(it.quantidade * f, 3);
    if q <= 0 then raise exception 'item % (%): quantidade zerada', it.ordem, it.descricao; end if;
    custo := round((it.valor_total + it.ipi + it.st + it.frete + it.outras) / q, 4);
    insert into public.crm_estoque_saldo (codigo, descricao, unidade, inicio)
      select cod, coalesce(e.descricao, it.descricao), public.crm_un(coalesce(e.unidade, it.unidade)), agora - interval '1 second'
      from (select 1) u left join public.crm_estoque e on e.codigo = cod
      on conflict (codigo) do nothing;
    insert into public.crm_estoque_mov (codigo, quando, tipo, quantidade, custo_unit, qtd_doc, unidade_doc, fator, compra_item_id, motivo)
      values (cod, agora, 'entrada', q, custo, it.quantidade, public.crm_un(it.unidade), f, it.id,
        left('NF ' || coalesce(c.numero::text, '?') || ' ' || coalesce(c.fornecedor_nome, ''), 200));
    update public.crm_compra_itens set codigo = cod, fator = f where id = it.id;
    if c.fornecedor_doc is not null and it.cod_fornecedor is not null then
      insert into public.crm_compra_vinculos (fornecedor_doc, cod_fornecedor, codigo, fator) values (c.fornecedor_doc, it.cod_fornecedor, cod, f)
        on conflict (fornecedor_doc, cod_fornecedor) do update set codigo = excluded.codigo, fator = excluded.fator, atualizado_em = now();
    end if;
    n := n + 1;
  end loop;
  update public.crm_compras set situacao = 'lancada', lancada_em = agora, lancada_por = auth.uid(), atualizado_em = agora where id = c.id;
  return jsonb_build_object('itens', n, 'ignorados', ign);
end;
$$;
revoke all on function public.crm_compra_lancar(uuid, jsonb) from public, anon;
grant execute on function public.crm_compra_lancar(uuid, jsonb) to authenticated;

-- =================================================================== Fase 3: pedido de venda, bloqueios e separação
-- (16/10/2026, plano docs/plano-sair-do-fkn.md, telas do FKN SIFN138 orçamento, SIFN006 pedido e Sifn050 pendência/
-- liberação). Orçamento aprovado (proposta) vira PEDIDO, que reserva o estoque: disponível = físico − reservado pelos
-- pedidos em aberto, em separação ou separados. Bloqueios como no Sifn050 — ESTOQUE (falta, por ordem de chegada),
-- ATRASO (duplicata vencida do cliente), SEM ENTRADA (pagamento à vista/antecipado ainda não recebido) e PREÇO (item
-- com margem abaixo da mínima, 23%) —; a gestora/o administrador libera. A logística junta os pedidos liberados numa
-- LISTA DE SEPARAÇÃO (o "bolão", o "SP" do FKN), separa e marca separado; a nota emitida para o cliente (ainda pelo FKN)
-- chega pelo vigia e fatura o pedido sozinha (crm_pedidos_casar), soltando a reserva. Itens em jsonb de propósito:
-- o pedido se grava inteiro numa função, sem apagar linha. Tudo grava por função (security definer).
-- Item: {codigo, descricao, unidade, quantidade, preco, desconto, obs} + o que o banco calcula: base (código no
-- estoque, sem o ".1" da caixa), fator (caixa → unidade do estoque), qtd_est, total, preco_tab ("ven" do FKN), custo,
-- separado (caixinha da separação).
create or replace function public.crm_eh_logistica()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.crm_papel() = 'logistica', false);
$$;
revoke all on function public.crm_eh_logistica() from public, anon;
grant execute on function public.crm_eh_logistica() to authenticated;

create table if not exists public.crm_boloes (
  id         bigint generated by default as identity primary key,
  dia        date not null default (now() at time zone 'America/Sao_Paulo')::date,
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em  timestamptz not null default now()
);
create table if not exists public.crm_pedidos (
  id               uuid primary key default gen_random_uuid(),
  numero           bigint generated by default as identity unique,
  empresa_id       uuid not null references public.crm_empresas(id),   -- sem cascade: juntar cadastros move (crm_pedidos_troca_empresa)
  negocio_id       uuid references public.crm_negocios(id) on delete set null,
  proposta_id      uuid references public.crm_propostas(id) on delete set null,
  vendedor_id      uuid references public.crm_usuarios(user_id) on delete set null,
  situacao         text not null default 'aberto' check (situacao in ('aberto', 'separacao', 'separado', 'faturado', 'cancelado')),
  tipo             text not null default 'normal' check (tipo in ('normal', 'programado')),
  entrega          date,                                   -- "faturar em" / dia da entrega
  itens            jsonb not null default '[]'::jsonb,
  valor_produtos   numeric(14,2) not null default 0,
  frete            numeric(14,2) not null default 0,
  valor_total      numeric(14,2) not null default 0,
  dados            jsonb not null default '{}'::jsonb,     -- cabeçalho do FKN: pagamento, transportadora, frete p/conta, entrega…
  comentarios      jsonb not null default '[]'::jsonb,     -- [{quando, por, nome, texto}]
  bloqueios        text[] not null default '{}',
  liberado         text[] not null default '{}',           -- bloqueios liberados à mão
  liberado_por     uuid,
  liberado_em      timestamptz,
  entrada_ok       boolean not null default false,         -- pagamento antecipado recebido
  bolao_id         bigint references public.crm_boloes(id),
  nota_id          uuid references public.crm_notas(id) on delete set null,
  faturado_em      timestamptz,
  cancelado_motivo text,
  criado_por       uuid default auth.uid(),
  criado_em        timestamptz not null default now(),
  atualizado_por   uuid,
  atualizado_em    timestamptz not null default now()
);
create unique index if not exists crm_pedidos_proposta_uq on public.crm_pedidos (proposta_id) where proposta_id is not null and situacao <> 'cancelado';
create index if not exists crm_pedidos_empresa_idx on public.crm_pedidos (empresa_id);
create index if not exists crm_pedidos_situacao_idx on public.crm_pedidos (situacao, criado_em);
create index if not exists crm_pedidos_nota_idx on public.crm_pedidos (nota_id);

-- Quem vê o pedido: gestora, administrador, logística e comprador, todos; o(a) vendedor(a), os seus e os da carteira.
create or replace function public.crm_pedidos_meus() returns setof uuid
language sql stable security definer set search_path = public as $$
  with eu as (select public.crm_eh_gestor() or public.crm_eh_logistica() or public.crm_eh_comprador() tudo, public.crm_eh_membro() membro)
  select p.id from public.crm_pedidos p, eu
   where eu.tudo or (eu.membro and (p.vendedor_id = auth.uid() or p.empresa_id in (select public.crm_empresas_minhas())));
$$;
revoke all on function public.crm_pedidos_meus() from public, anon;
grant execute on function public.crm_pedidos_meus() to authenticated;
alter table public.crm_pedidos enable row level security;
alter table public.crm_boloes enable row level security;
revoke all on public.crm_pedidos, public.crm_boloes from anon, public;
grant select on public.crm_pedidos, public.crm_boloes to authenticated;
drop policy if exists ler on public.crm_pedidos;
create policy ler on public.crm_pedidos for select to authenticated using (
  (select public.crm_eh_gestor()) or (select public.crm_eh_logistica()) or (select public.crm_eh_comprador())
  or vendedor_id = (select auth.uid()) or empresa_id in (select public.crm_empresas_minhas()));
drop policy if exists ler on public.crm_boloes;
create policy ler on public.crm_boloes for select to authenticated using ((select public.crm_eh_ativo()));

-- Físico de cada produto (código sem a variante da caixa): o livro do CRM depois de começado; antes, o "atual" do FKN.
create or replace function public.crm_estoque_fisico() returns table (codigo text, fisico numeric)
language sql stable security definer set search_path = public as $$
  select e.codigo, coalesce(s.saldo, e.estoque_atual, e.quantidade + coalesce(e.pend_cliente, 0), 0)
    from public.crm_estoque e left join public.crm_estoque_saldo s on s.codigo = e.codigo
   where e.codigo !~ '\.\d+$' and (select public.crm_eh_ativo());
$$;

-- Falta de cada item, por ordem de chegada (o que já está em separação vem primeiro): o físico vai atendendo os
-- pedidos mais antigos; o que passar dele é falta (na unidade do item). Interna; a de fora filtra quem vê.
create or replace function public.crm_pedidos_faltas_todas() returns table (pedido_id uuid, idx int, base text, falta numeric)
language sql stable security definer set search_path = public as $$
  with it as (
    select p.id, p.situacao, p.criado_em, (o.n - 1)::int idx, o.i->>'base' base, (o.i->>'qtd_est')::numeric q, coalesce((o.i->>'fator')::numeric, 1) f
      from public.crm_pedidos p cross join lateral jsonb_array_elements(p.itens) with ordinality o(i, n)
     where p.situacao in ('aberto', 'separacao', 'separado') and coalesce(o.i->>'base', '') <> ''),
  acc as (
    select it.*, sum(q) over (partition by base order by (situacao = 'aberto'), criado_em, id, idx rows unbounded preceding) cum from it)
  select acc.id, acc.idx, acc.base, round(least(acc.q, acc.cum - b.fisico) / acc.f, 3)
    from acc join public.crm_estoque_fisico() b on b.codigo = acc.base
   where acc.cum - b.fisico > 0.0005 and (select public.crm_eh_ativo());
$$;
revoke all on function public.crm_estoque_fisico(), public.crm_pedidos_faltas_todas() from public, anon, authenticated;
create or replace function public.crm_pedidos_faltas() returns table (pedido_id uuid, idx int, base text, falta numeric)
language sql stable security definer set search_path = public as $$
  select f.* from public.crm_pedidos_faltas_todas() f where f.pedido_id in (select public.crm_pedidos_meus());
$$;
revoke all on function public.crm_pedidos_faltas() from public, anon;
grant execute on function public.crm_pedidos_faltas() to authenticated;

-- Consulta de estoque para quem vende (sem o custo, que é da gestora, do administrador e do comprador): físico,
-- reservado pelos pedidos do CRM, disponível e o que está para chegar do fornecedor. A variante da caixa (".1") sai
-- em caixas (físico da unidade ÷ fator).
create or replace function public.crm_estoque_disponivel()
returns table (codigo text, descricao text, unidade text, localizacao text, linha text, familia text, situacao text,
  fisico numeric, reservado numeric, disponivel numeric, a_caminho numeric, preco_venda numeric, custo numeric, fator numeric, base text)
-- plpgsql de propósito: como função SQL o mesmo corpo levava 500 ms (2.288 produtos); assim, 45 ms
language plpgsql stable security definer set search_path = public as $$
declare vc boolean := public.crm_eh_membro() or public.crm_eh_comprador(); -- custo: equipe de vendas (como no FKN) e comprador; logística não
begin
  if not public.crm_eh_ativo() then return; end if;
  return query
  with res as (
    select i->>'base' bs, sum((i->>'qtd_est')::numeric) q
      from public.crm_pedidos p cross join lateral jsonb_array_elements(p.itens) i
     where p.situacao in ('aberto', 'separacao', 'separado') and coalesce(i->>'base', '') <> '' group by 1),
  fis as (select fc.codigo cod, fc.fisico fi from public.crm_estoque_fisico() fc),
  cx as (select u.codigo cod, u.fator fa from public.crm_estoque_unidades u where u.unidade = 'CX')
  select e.codigo, e.descricao, coalesce(e.unidade, case when x.caixa then 'CX' end), e.localizacao, e.linha, e.familia, e.situacao,
    round(b.fi / f.f, 3), round(coalesce(r.q, 0) / f.f, 3), round((b.fi - coalesce(r.q, 0)) / f.f, 3),
    case when x.caixa then null else e.pend_fornecedor end, e.preco_venda, case when vc then e.custo_unit end, f.f, x.bc
    from public.crm_estoque e
    cross join lateral (select regexp_replace(e.codigo, '\.\d+$', '') bc, e.codigo ~ '\.\d+$' caixa) x
    join fis b on b.cod = x.bc
    left join res r on r.bs = x.bc
    left join cx on cx.cod = x.bc and x.caixa
    cross join lateral (select case when x.caixa then coalesce(cx.fa, 1) else 1 end f) f
   where coalesce(e.situacao, '') <> 'INATIVO' or b.fi > 0;
end;
$$;
revoke all on function public.crm_estoque_disponivel() from public, anon;
grant execute on function public.crm_estoque_disponivel() to authenticated;

-- Itens como o banco guarda: base, fator, quantidade no estoque, total, preço de tabela e custo do momento.
create or replace function public.crm_pedido_itens_norm(p_itens jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare x jsonb; out jsonb := '[]'::jsonb; cod text; base text; un text; eu text; f numeric; q numeric; pr numeric; d numeric; e record; k int := 0;
begin
  if not public.crm_eh_membro() then raise exception 'só a equipe de vendas'; end if;
  for x in select value from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    k := k + 1;
    cod := nullif(upper(btrim(coalesce(x->>'codigo', ''))), '');
    cod := regexp_replace(coalesce(cod, ''), '\.0+$', ''); if cod = '' then cod := null; end if;
    q := coalesce(nullif(x->>'quantidade', '')::numeric, 0);
    pr := coalesce(nullif(x->>'preco', '')::numeric, 0);
    d := coalesce(nullif(x->>'desconto', '')::numeric, 0);
    if q <= 0 then raise exception 'item %: quantidade precisa ser maior que zero', k; end if;
    if pr < 0 or d < 0 or d > 100 then raise exception 'item %: preço ou desconto inválido', k; end if;
    if coalesce(btrim(x->>'descricao'), '') = '' and cod is null then raise exception 'item %: diga o produto', k; end if;
    base := null; f := 1;
    -- caixa com o código da unidade e "CX" (como sai na nota): vale o código da caixa (".1"), com o preço e o custo dela
    if cod is not null and cod !~ '\.\d+$' and public.crm_un(x->>'unidade') = 'CX'
       and coalesce(public.crm_un((select unidade from public.crm_estoque where codigo = cod)), 'CX') <> 'CX' then
      cod := coalesce((select v.codigo from public.crm_estoque v where v.codigo ~ ('^' || cod || '\.\d+$') order by v.codigo limit 1), cod);
    end if;
    select codigo, descricao, unidade, preco_venda, custo_unit into e from public.crm_estoque where codigo = cod;
    if cod is not null then
      base := regexp_replace(cod, '\.\d+$', '');
      select unidade into eu from public.crm_estoque where codigo = base;
      un := public.crm_un(coalesce(nullif(x->>'unidade', ''), e.unidade, case when cod ~ '\.\d+$' then 'CX' end));
      if cod ~ '\.\d+$' or (un = 'CX' and coalesce(public.crm_un(eu), '') <> 'CX') then
        select u.fator into f from public.crm_estoque_unidades u where u.codigo = base and u.unidade = 'CX';
      elsif un is not null and public.crm_un(eu) is not null and un <> public.crm_un(eu) then
        select u.fator into f from public.crm_estoque_unidades u where u.codigo = base and u.unidade = un;
      end if;
      f := coalesce(f, 1);
      if not exists (select 1 from public.crm_estoque where codigo = base) then base := null; end if; -- produto fora do estoque (serviço, avulso)
    else
      un := public.crm_un(x->>'unidade');
    end if;
    out := out || jsonb_build_object('codigo', cod, 'descricao', coalesce(nullif(btrim(x->>'descricao'), ''), e.descricao, cod), 'unidade', un,
      'quantidade', q, 'preco', pr, 'desconto', d, 'total', round(q * pr * (1 - d / 100), 2), 'obs', nullif(btrim(coalesce(x->>'obs', '')), ''),
      'base', base, 'fator', f, 'qtd_est', round(q * f, 3), 'preco_tab', e.preco_venda, 'custo', e.custo_unit, 'separado', false);
  end loop;
  return out;
end;
$$;
revoke all on function public.crm_pedido_itens_norm(jsonb) from public, anon, authenticated;

-- Bloqueios de todos os pedidos em aberto (e o casamento com as notas que chegaram). Barato: roda ao abrir as telas.
create or replace function public.crm_pedidos_atualizar() returns integer language plpgsql security definer set search_path = public as $$
-- PREÇO (16/10, Anderson): item com margem abaixo da mínima (cfg.margem_minima, padrão 23% = tabela A) ou sem preço;
-- sem custo conhecido, abaixo da faixa negativa da tabela. cfg.pedido_trava_preco = false desliga.
declare n integer; neg numeric; mmin numeric; trava boolean; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not (public.crm_eh_ativo() or coalesce(auth.role(), '') = 'service_role') then raise exception 'sem acesso'; end if;
  perform public.crm_pedidos_casar_int();
  select coalesce(nullif(dados->'tabela_precos'->>'NEG', '')::numeric, -10), coalesce(nullif(dados->>'margem_minima', '')::numeric, 23),
         coalesce((dados->>'pedido_trava_preco')::boolean, true)
    into neg, mmin, trava from public.crm_config where id = 1;
  with f as (select distinct pedido_id from public.crm_pedidos_faltas_todas()),
  b as (
    select p.id, array_remove(array[
      case when p.id in (select pedido_id from f) then 'ESTOQUE' end,
      case when exists (select 1 from public.crm_titulos t where t.empresa_id = p.empresa_id and t.vencimento < hoje and not t.abono) then 'ATRASO' end,
      case when not p.entrada_ok and coalesce(p.dados->>'pagamento', '') ~* '(vista|antecipad|pix|transfer|dep[oó]sito)' then 'SEM ENTRADA' end,
      case when trava and exists (select 1 from jsonb_array_elements(p.itens) i
        cross join lateral (select (i->>'preco')::numeric * (1 - coalesce((i->>'desconto')::numeric, 0) / 100) pl, coalesce((i->>'custo')::numeric, 0) c, coalesce((i->>'preco_tab')::numeric, 0) tb) v
        where case when v.c > 0 then v.pl <= 0 or (v.pl - v.c) / v.pl * 100 < mmin - 0.005
                   else v.tb > 0 and v.pl < round(v.tb * (1 + neg / 100), 4) - 0.00005 end) then 'PREÇO' end
    ], null) bl from public.crm_pedidos p where p.situacao = 'aberto')
  update public.crm_pedidos p set bloqueios = b.bl from b where p.id = b.id and p.bloqueios is distinct from b.bl;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- A nota que chegou (vigia ou importação) fatura o pedido: mesmo cliente, emitida depois do pedido (até 20 dias), com
-- pelo menos 60% dos produtos do pedido. Mais de um pedido do cliente: o que mais casa, depois o mais antigo.
create or replace function public.crm_pedidos_casar_int() returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  if not (public.crm_eh_ativo() or coalesce(auth.role(), '') = 'service_role') then return 0; end if;
  for r in
    select distinct on (nt.id) nt.id nota, p.id pedido, nt.emitida_em
      from public.crm_notas nt
      join public.crm_pedidos p on p.empresa_id = nt.empresa_id and p.situacao in ('aberto', 'separacao', 'separado') and p.criado_em <= nt.emitida_em + interval '1 hour'
      cross join lateral (
        select count(*) filter (where i->>'base' in (select regexp_replace(ni.codigo, '\.\d+$', '') from public.crm_nota_itens ni where ni.nota_id = nt.id))::numeric
               / nullif(count(*) filter (where coalesce(i->>'base', '') <> ''), 0) sc
          from jsonb_array_elements(p.itens) i) s
     where nt.emitida_em > now() - interval '20 days' and not nt.cancelada
       and not exists (select 1 from public.crm_pedidos x where x.nota_id = nt.id)
       and s.sc >= 0.6
     order by nt.id, s.sc desc, p.criado_em
  loop
    update public.crm_pedidos set situacao = 'faturado', nota_id = r.nota, faturado_em = r.emitida_em, atualizado_em = now()
     where id = r.pedido and situacao in ('aberto', 'separacao', 'separado');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.crm_pedidos_casar_int() from public, anon, authenticated;
revoke all on function public.crm_pedidos_atualizar() from public, anon;
grant execute on function public.crm_pedidos_atualizar() to authenticated, service_role;

-- Grava o pedido (novo ou em aberto): equipe de vendas, cliente da carteira. Só a gestora escolhe outro(a) vendedor(a).
create or replace function public.crm_pedido_gravar(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.crm_pedidos; emp uuid := nullif(p->>'empresa_id', '')::uuid; its jsonb; vp numeric; fr numeric; vend uuid; pid uuid := nullif(p->>'id', '')::uuid;
begin
  if not public.crm_eh_membro() then raise exception 'só a equipe de vendas faz pedido'; end if;
  if emp is null or not public.crm_ve_empresa(emp) then raise exception 'cliente fora da sua carteira'; end if;
  if pid is not null then
    select * into r from public.crm_pedidos where id = pid for update;
    if r.id is null then raise exception 'pedido não encontrado'; end if;
    if r.situacao <> 'aberto' then raise exception 'o pedido % já está %: peça à logística para voltar ao aberto', r.numero, r.situacao; end if;
    if not (public.crm_eh_gestor() or r.vendedor_id = auth.uid() or public.crm_ve_empresa(r.empresa_id)) then raise exception 'pedido de outra carteira'; end if;
  end if;
  its := public.crm_pedido_itens_norm(p->'itens');
  if jsonb_array_length(its) = 0 then raise exception 'o pedido não tem itens'; end if;
  select coalesce(sum((i->>'total')::numeric), 0) into vp from jsonb_array_elements(its) i;
  fr := greatest(coalesce(nullif(p->>'frete', '')::numeric, 0), 0);
  vend := case when public.crm_eh_gestor() then coalesce(nullif(p->>'vendedor_id', '')::uuid, r.vendedor_id, auth.uid())
               else coalesce(r.vendedor_id, auth.uid()) end;
  if pid is null then
    insert into public.crm_pedidos (empresa_id, negocio_id, proposta_id, vendedor_id, tipo, entrega, itens, valor_produtos, frete, valor_total, dados, atualizado_por)
    values (emp, nullif(p->>'negocio_id', '')::uuid, nullif(p->>'proposta_id', '')::uuid, vend, coalesce(nullif(p->>'tipo', ''), 'normal'),
      nullif(p->>'entrega', '')::date, its, vp, fr, vp + fr, coalesce(p->'dados', '{}'::jsonb), auth.uid())
    returning * into r;
  else
    update public.crm_pedidos set empresa_id = emp, negocio_id = coalesce(nullif(p->>'negocio_id', '')::uuid, negocio_id), vendedor_id = vend,
      tipo = coalesce(nullif(p->>'tipo', ''), tipo), entrega = nullif(p->>'entrega', '')::date, itens = its, valor_produtos = vp, frete = fr,
      valor_total = vp + fr, dados = coalesce(p->'dados', dados), liberado = '{}', liberado_por = null, liberado_em = null,
      atualizado_por = auth.uid(), atualizado_em = now()
    where id = pid returning * into r;
  end if;
  perform public.crm_pedidos_atualizar();
  select * into r from public.crm_pedidos where id = r.id;
  return to_jsonb(r);
end;
$$;
revoke all on function public.crm_pedido_gravar(jsonb) from public, anon;
grant execute on function public.crm_pedido_gravar(jsonb) to authenticated;

-- Muda a situação. separado/aberto (voltar): logística ou gestora; cancelado: quem fez (em aberto), logística ou gestora,
-- com motivo; desfazer o faturado (volta a separado, solta a nota): só a gestora/o administrador.
create or replace function public.crm_pedido_situacao(p_id uuid, p_para text, p_motivo text) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.crm_pedidos; op boolean := public.crm_eh_logistica() or public.crm_eh_gestor();
begin
  select * into r from public.crm_pedidos where id = p_id for update;
  if r.id is null or r.id not in (select public.crm_pedidos_meus()) then raise exception 'pedido não encontrado'; end if;
  if p_para = 'cancelado' then
    if r.situacao in ('faturado', 'cancelado') then raise exception 'o pedido já está %', r.situacao; end if;
    if not (op or (r.situacao = 'aberto' and public.crm_eh_membro())) then raise exception 'pedido em separação: só a logística ou a gestora cancela'; end if;
    if coalesce(btrim(p_motivo), '') = '' then raise exception 'diga o motivo do cancelamento'; end if;
    update public.crm_pedidos set situacao = 'cancelado', cancelado_motivo = left(btrim(p_motivo), 300), atualizado_por = auth.uid(), atualizado_em = now() where id = p_id;
  elsif p_para = 'separado' then
    if not op then raise exception 'só a logística'; end if;
    if r.situacao <> 'separacao' then raise exception 'o pedido não está em separação'; end if;
    update public.crm_pedidos set situacao = 'separado', atualizado_por = auth.uid(), atualizado_em = now() where id = p_id;
  elsif p_para = 'aberto' then
    if not op then raise exception 'só a logística ou a gestora'; end if;
    if r.situacao not in ('separacao', 'separado') then raise exception 'só volta ao aberto o pedido em separação ou separado'; end if;
    update public.crm_pedidos set situacao = 'aberto', bolao_id = null,
      itens = (select coalesce(jsonb_agg(i || '{"separado": false}'::jsonb order by n), '[]'::jsonb) from jsonb_array_elements(r.itens) with ordinality o(i, n)),
      atualizado_por = auth.uid(), atualizado_em = now() where id = p_id;
  elsif p_para = 'desfaturar' then
    if not public.crm_eh_gestor() then raise exception 'só a gestora ou o administrador'; end if;
    if r.situacao <> 'faturado' then raise exception 'o pedido não está faturado'; end if;
    update public.crm_pedidos set situacao = 'separado', nota_id = null, faturado_em = null, atualizado_por = auth.uid(), atualizado_em = now() where id = p_id;
  else
    raise exception 'situação inválida: %', p_para;
  end if;
  perform public.crm_pedidos_atualizar();
  select * into r from public.crm_pedidos where id = p_id;
  return to_jsonb(r);
end;
$$;
revoke all on function public.crm_pedido_situacao(uuid, text, text) from public, anon;
grant execute on function public.crm_pedido_situacao(uuid, text, text) to authenticated;

-- Liberar (gestora/administrador): os bloqueios de agora ficam liberados; um bloqueio novo volta a segurar.
-- p_liberar = false desfaz. Entrada recebida (SEM ENTRADA): também a gestora/o administrador.
create or replace function public.crm_pedido_liberar(p_id uuid, p_liberar boolean, p_entrada boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.crm_pedidos;
begin
  if not public.crm_eh_gestor() then raise exception 'só a gestora ou o administrador libera pedido'; end if;
  select * into r from public.crm_pedidos where id = p_id for update;
  if r.id is null then raise exception 'pedido não encontrado'; end if;
  if r.situacao <> 'aberto' then raise exception 'só se libera pedido em aberto'; end if;
  if p_entrada is not null then update public.crm_pedidos set entrada_ok = p_entrada where id = p_id; end if;
  perform public.crm_pedidos_atualizar();
  select * into r from public.crm_pedidos where id = p_id;
  if p_liberar is not null then
    update public.crm_pedidos set liberado = case when p_liberar then r.bloqueios else '{}' end,
      liberado_por = case when p_liberar then auth.uid() end, liberado_em = case when p_liberar then now() end, atualizado_em = now() where id = p_id;
  end if;
  select * into r from public.crm_pedidos where id = p_id;
  return to_jsonb(r);
end;
$$;
revoke all on function public.crm_pedido_liberar(uuid, boolean, boolean) from public, anon;
grant execute on function public.crm_pedido_liberar(uuid, boolean, boolean) to authenticated;

-- Comentário no pedido (aba Comentários do FKN): quem vê o pedido escreve.
create or replace function public.crm_pedido_comentar(p_id uuid, p_texto text) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.crm_pedidos;
begin
  if coalesce(btrim(p_texto), '') = '' then raise exception 'escreva o comentário'; end if;
  if p_id not in (select public.crm_pedidos_meus()) then raise exception 'pedido não encontrado'; end if;
  update public.crm_pedidos set comentarios = comentarios || jsonb_build_array(jsonb_build_object('quando', now(), 'por', auth.uid(),
    'nome', (select nome from public.crm_usuarios where user_id = auth.uid()), 'texto', left(btrim(p_texto), 2000))), atualizado_em = now()
   where id = p_id returning * into r;
  return to_jsonb(r);
end;
$$;
revoke all on function public.crm_pedido_comentar(uuid, text) from public, anon;
grant execute on function public.crm_pedido_comentar(uuid, text) to authenticated;

-- Lista de separação ("bolão"): a logística junta os pedidos liberados (sem bloqueio que segure) e eles vão para separação.
create or replace function public.crm_bolao_montar(p_pedidos uuid[], p_obs text) returns bigint language plpgsql security definer set search_path = public as $$
declare bid bigint; r record;
begin
  if not (public.crm_eh_logistica() or public.crm_eh_gestor()) then raise exception 'só a logística ou a gestora'; end if;
  if coalesce(array_length(p_pedidos, 1), 0) = 0 then raise exception 'escolha os pedidos'; end if;
  perform public.crm_pedidos_atualizar();
  for r in select id, numero, situacao, bloqueios, liberado from public.crm_pedidos where id = any(p_pedidos) for update loop
    if r.situacao <> 'aberto' then raise exception 'o pedido % não está em aberto', r.numero; end if;
    if exists (select 1 from unnest(r.bloqueios) b where b <> all(r.liberado)) then raise exception 'o pedido % está bloqueado: a gestora precisa liberar', r.numero; end if;
  end loop;
  if (select count(*) from public.crm_pedidos where id = any(p_pedidos)) <> array_length(p_pedidos, 1) then raise exception 'pedido não encontrado'; end if;
  insert into public.crm_boloes (observacao) values (nullif(btrim(coalesce(p_obs, '')), '')) returning id into bid;
  update public.crm_pedidos set situacao = 'separacao', bolao_id = bid, atualizado_por = auth.uid(), atualizado_em = now() where id = any(p_pedidos);
  return bid;
end;
$$;
revoke all on function public.crm_bolao_montar(uuid[], text) from public, anon;
grant execute on function public.crm_bolao_montar(uuid[], text) to authenticated;

-- Caixinha de conferido de um item na separação (p_idx começa em 0).
create or replace function public.crm_pedido_separar_item(p_id uuid, p_idx integer, p_ok boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.crm_pedidos;
begin
  if not (public.crm_eh_logistica() or public.crm_eh_gestor()) then raise exception 'só a logística'; end if;
  update public.crm_pedidos set itens = jsonb_set(itens, array[p_idx::text, 'separado'], to_jsonb(coalesce(p_ok, false)), false), atualizado_em = now()
   where id = p_id and situacao = 'separacao' and p_idx >= 0 and p_idx < jsonb_array_length(itens) returning * into r;
  if r.id is null then raise exception 'pedido fora da separação'; end if;
  return to_jsonb(r);
end;
$$;
revoke all on function public.crm_pedido_separar_item(uuid, integer, boolean) from public, anon;
grant execute on function public.crm_pedido_separar_item(uuid, integer, boolean) to authenticated;

-- Faturar à mão (a nota não casou sozinha): a logística ou a gestora escolhe a nota do cliente.
create or replace function public.crm_pedido_notas_candidatas(p_id uuid) returns table (id uuid, numero bigint, emitida_em timestamptz, valor_total numeric)
language sql stable security definer set search_path = public as $$
  select nt.id, nt.numero, nt.emitida_em, nt.valor_total
    from public.crm_pedidos p join public.crm_notas nt on nt.empresa_id = p.empresa_id
   where p.id = p_id and (public.crm_eh_logistica() or public.crm_eh_gestor()) and not nt.cancelada
     and nt.emitida_em > p.criado_em - interval '1 day' and not exists (select 1 from public.crm_pedidos x where x.nota_id = nt.id)
   order by nt.emitida_em desc limit 20;
$$;
revoke all on function public.crm_pedido_notas_candidatas(uuid) from public, anon;
grant execute on function public.crm_pedido_notas_candidatas(uuid) to authenticated;

create or replace function public.crm_pedido_faturar(p_id uuid, p_nota uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.crm_pedidos;
begin
  if not (public.crm_eh_logistica() or public.crm_eh_gestor()) then raise exception 'só a logística ou a gestora'; end if;
  if not exists (select 1 from public.crm_pedido_notas_candidatas(p_id) c where c.id = p_nota) then raise exception 'essa nota não é deste cliente ou já está em outro pedido'; end if;
  update public.crm_pedidos p set situacao = 'faturado', nota_id = p_nota, faturado_em = (select emitida_em from public.crm_notas where id = p_nota),
    atualizado_por = auth.uid(), atualizado_em = now()
   where p.id = p_id and p.situacao in ('aberto', 'separacao', 'separado') returning * into r;
  if r.id is null then raise exception 'o pedido não está em aberto nem em separação'; end if;
  return to_jsonb(r);
end;
$$;
revoke all on function public.crm_pedido_faturar(uuid, uuid) from public, anon;
grant execute on function public.crm_pedido_faturar(uuid, uuid) to authenticated;

-- Juntar cadastros duplicados: os pedidos dos que somem vão para o que fica (a gestora; ajustes.js).
create or replace function public.crm_pedidos_troca_empresa(p_de uuid[], p_para uuid) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.crm_eh_gestor() then raise exception 'só a gestora ou o administrador'; end if;
  update public.crm_pedidos set empresa_id = p_para, atualizado_em = now() where empresa_id = any(p_de);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.crm_pedidos_troca_empresa(uuid[], uuid) from public, anon;
grant execute on function public.crm_pedidos_troca_empresa(uuid[], uuid) to authenticated;

-- =================================================================== Fase 3b: comissão do mês fechado
-- (16/10/2026, plano docs/plano-sair-do-fkn.md). A comissão nasce na nota emitida (o vendedor escrito na nota), item a
-- item, pela faixa do preço praticado na tabela PADRAO e pelo plano de quem vendeu (interno = papel do escritório;
-- externo = tabela do FKN, hoje só a Silmara). A tela calcula a prévia (pedidos.js apuraComissao); o administrador
-- confere, lança os ajustes (devolução, venda fora das condições) e FECHA o mês: a foto fica aqui e não muda mais (para
-- mexer, "reabrir", que fica registrado). Cada vendedor(a) lê só a própria linha; só o administrador grava.
create table if not exists public.crm_comissoes (
  mes          date not null check (extract(day from mes) = 1),   -- 1º dia do mês
  user_id      uuid not null references public.crm_usuarios(user_id),
  plano        text,
  base         numeric(14,2) not null default 0,                   -- soma dos itens das notas (sem frete)
  comissao     numeric(14,2) not null default 0,                   -- dos itens, antes dos ajustes
  ajustes      jsonb not null default '[]'::jsonb,                 -- [{valor (− desconta), motivo}]
  total        numeric(14,2) not null default 0,                   -- comissão + ajustes
  detalhe      jsonb not null default '{}'::jsonb,                 -- notas, por faixa, itens sem preço de tabela
  fechado_em   timestamptz,
  fechado_por  uuid,
  reaberto_em  timestamptz,
  reaberto_por uuid,
  atualizado_em timestamptz not null default now(),
  primary key (mes, user_id)
);
alter table public.crm_comissoes enable row level security;
revoke all on public.crm_comissoes from anon, public;
grant select on public.crm_comissoes to authenticated;
drop policy if exists ler on public.crm_comissoes;
create policy ler on public.crm_comissoes for select to authenticated using ((select public.crm_eh_admin()) or user_id = (select auth.uid()));

-- Fecha o mês: grava a foto de cada vendedor(a) (linhas: [{user_id, plano, base, comissao, ajustes, detalhe}]). Mês já
-- fechado não se regrava: reabrir antes.
create or replace function public.crm_comissao_fechar(p_mes date, p_linhas jsonb) returns integer language plpgsql security definer set search_path = public as $$
declare x jsonb; n integer := 0; aj jsonb; t numeric;
begin
  if not public.crm_eh_admin() then raise exception 'só o administrador fecha as comissões'; end if;
  if p_mes is null or extract(day from p_mes) <> 1 then raise exception 'mês inválido'; end if;
  if p_mes >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date then raise exception 'o mês ainda não acabou'; end if;
  if exists (select 1 from public.crm_comissoes where mes = p_mes and fechado_em is not null) then raise exception 'o mês já está fechado: reabra antes'; end if;
  for x in select value from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    aj := coalesce(x->'ajustes', '[]'::jsonb);
    if exists (select 1 from jsonb_array_elements(aj) a where coalesce(btrim(a->>'motivo'), '') = '' or (a->>'valor') is null) then raise exception 'ajuste sem valor ou sem motivo'; end if;
    t := coalesce((x->>'comissao')::numeric, 0) + coalesce((select sum((a->>'valor')::numeric) from jsonb_array_elements(aj) a), 0);
    insert into public.crm_comissoes (mes, user_id, plano, base, comissao, ajustes, total, detalhe, fechado_em, fechado_por, atualizado_em)
    values (p_mes, (x->>'user_id')::uuid, x->>'plano', coalesce((x->>'base')::numeric, 0), coalesce((x->>'comissao')::numeric, 0), aj, round(t, 2),
      coalesce(x->'detalhe', '{}'::jsonb), now(), auth.uid(), now())
    on conflict (mes, user_id) do update set plano = excluded.plano, base = excluded.base, comissao = excluded.comissao, ajustes = excluded.ajustes,
      total = excluded.total, detalhe = excluded.detalhe, fechado_em = now(), fechado_por = auth.uid(), atualizado_em = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.crm_comissao_fechar(date, jsonb) from public, anon;
grant execute on function public.crm_comissao_fechar(date, jsonb) to authenticated;

create or replace function public.crm_comissao_reabrir(p_mes date) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.crm_eh_admin() then raise exception 'só o administrador'; end if;
  update public.crm_comissoes set fechado_em = null, fechado_por = null, reaberto_em = now(), reaberto_por = auth.uid(), atualizado_em = now()
   where mes = p_mes and fechado_em is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.crm_comissao_reabrir(date) from public, anon;
grant execute on function public.crm_comissao_reabrir(date) to authenticated;

-- =================================================================== Fase 4: NF-e emitida pelo CRM
-- (16/10/2026, plano docs/plano-sair-do-fkn.md). O serviço fiscal (servico-fiscal/, na VPS) monta, assina e envia à
-- Sefaz-SP; a Edge Function crm-fiscal fala com ele e grava aqui. No paralelo com o FKN o CRM usa uma SÉRIE PRÓPRIA (2;
-- o FKN emite na 1), para os números nunca se chocarem. Numeração por ambiente e série, reservada no banco (uma de cada
-- vez). Regras: nota REJEITADA reaproveita o mesmo número (a Sefaz deixa); PENDENTE (sem resposta) obriga a consultar
-- antes; pedido com nota autorizada não emite outra. Só leitura direta (administrador, gestora, logística); quem grava é
-- a crm-fiscal (chave de serviço).
create table if not exists public.crm_nfe_numeracao (
  ambiente text not null check (ambiente in ('homologacao', 'producao')),
  serie    integer not null check (serie between 0 and 999),
  proximo  integer not null default 1 check (proximo > 0),
  primary key (ambiente, serie)
);
create table if not exists public.crm_nfe (
  id            uuid primary key default gen_random_uuid(),
  ambiente      text not null check (ambiente in ('homologacao', 'producao')),
  serie         integer not null,
  numero        integer not null check (numero > 0),
  pedido_id     uuid references public.crm_pedidos(id) on delete set null,
  empresa_id    uuid references public.crm_empresas(id) on delete set null,
  chave         text unique,
  situacao      text not null default 'reservada' check (situacao in ('reservada', 'pendente', 'autorizada', 'rejeitada', 'denegada', 'cancelada', 'bloqueada')),
  cstat         integer,
  motivo        text,
  protocolo     text,
  autorizada_em timestamptz,
  valor         numeric(14,2),
  totais        jsonb,
  avisos        jsonb,
  nota          jsonb,                 -- o que foi mandado ao serviço fiscal (para conferir e reenviar)
  nfe_xml       text,                  -- o XML assinado (reenviar o MESMO, nunca outro número)
  proc_xml      text,                  -- nota + protocolo (o arquivo que vale)
  nota_id       uuid references public.crm_notas(id) on delete set null,
  eventos       jsonb not null default '[]'::jsonb,   -- [{tipo, seq, protocolo, quando, cstat, motivo, texto, por}]
  tentativas    integer not null default 0,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (ambiente, serie, numero)
);
create index if not exists crm_nfe_pedido_idx on public.crm_nfe (pedido_id);
-- número que não vai ser usado (rejeitada/reservada de pedido que não sai) e foi inutilizado na Sefaz: não volta a ser reaproveitado
alter table public.crm_nfe add column if not exists inutilizada_em timestamptz;
create table if not exists public.crm_nfe_inutilizacoes (
  id            bigint generated always as identity primary key,
  ambiente      text not null,
  serie         integer not null,
  de            integer not null,
  ate           integer not null,
  justificativa text not null,
  cstat         integer,
  motivo        text,
  protocolo     text,
  xml           text,                  -- ProcInutNFe (vai ao contador no fechamento do mês)
  criado_por    uuid,
  criado_em     timestamptz not null default now()
);
alter table public.crm_nfe_inutilizacoes add column if not exists xml text;
alter table public.crm_nfe enable row level security;
alter table public.crm_nfe_numeracao enable row level security;
alter table public.crm_nfe_inutilizacoes enable row level security;
revoke all on public.crm_nfe, public.crm_nfe_numeracao, public.crm_nfe_inutilizacoes from anon, authenticated, public;
grant select on public.crm_nfe, public.crm_nfe_numeracao, public.crm_nfe_inutilizacoes to authenticated;
drop policy if exists ler on public.crm_nfe;
create policy ler on public.crm_nfe for select to authenticated using ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()));
drop policy if exists ler on public.crm_nfe_numeracao;
create policy ler on public.crm_nfe_numeracao for select to authenticated using ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()));
drop policy if exists ler on public.crm_nfe_inutilizacoes;
create policy ler on public.crm_nfe_inutilizacoes for select to authenticated using ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()));

-- Reserva o número da nota do pedido (chamada pela crm-fiscal com a chave de serviço, em nome de quem clicou).
create or replace function public.crm_nfe_reservar(p_ambiente text, p_serie integer, p_pedido uuid, p_empresa uuid) returns public.crm_nfe
language plpgsql security definer set search_path = public as $$
declare r public.crm_nfe; n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'só o serviço fiscal reserva número'; end if;
  if p_ambiente not in ('homologacao', 'producao') then raise exception 'ambiente inválido'; end if;
  perform pg_advisory_xact_lock(hashtext('crm_nfe:' || p_ambiente || ':' || p_serie));
  -- em homologação o mesmo pedido pode ser testado de novo (a nota autorizada lá não conta)
  select * into r from public.crm_nfe where pedido_id = p_pedido and ambiente = p_ambiente and situacao in ('autorizada', 'pendente', 'reservada', 'rejeitada', 'bloqueada')
     and inutilizada_em is null and (p_ambiente = 'producao' or situacao <> 'autorizada')
   order by criado_em desc limit 1;
  if r.id is not null then
    if r.situacao = 'autorizada' then raise exception 'o pedido já tem a NF % autorizada', r.numero; end if;
    if r.situacao = 'pendente' then raise exception 'a NF % deste pedido ficou sem resposta da Sefaz: consulte antes de emitir de novo', r.numero; end if;
    update public.crm_nfe set tentativas = tentativas + 1, atualizado_em = now() where id = r.id returning * into r;
    return r;                                   -- rejeitada/bloqueada/reservada: o mesmo número
  end if;
  insert into public.crm_nfe_numeracao (ambiente, serie) values (p_ambiente, p_serie) on conflict do nothing;
  update public.crm_nfe_numeracao set proximo = proximo + 1 where ambiente = p_ambiente and serie = p_serie returning proximo - 1 into n;
  insert into public.crm_nfe (ambiente, serie, numero, pedido_id, empresa_id, situacao, tentativas)
  values (p_ambiente, p_serie, n, p_pedido, p_empresa, 'reservada', 1) returning * into r;
  return r;
end;
$$;
revoke all on function public.crm_nfe_reservar(text, integer, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_nfe_reservar(text, integer, uuid, uuid) to service_role;
