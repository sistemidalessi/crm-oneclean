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
  papel        text not null default 'vendedor' check (papel in ('admin','gestor','vendedor','comprador','logistica','motorista')),
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
alter table public.crm_usuarios add constraint crm_usuarios_papel_check check (papel in ('admin','gestor','vendedor','comprador','logistica','motorista'));

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
   where public.crm_eh_membro() and u.ativo and u.recebe_leads and u.papel not in ('comprador', 'logistica', 'motorista')
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
-- Ao alterar, a empresa do negócio tem de ser uma que a vendedora já vê (a mesma regra do insert): sem isso ela
-- trocava o empresa_id do próprio negócio para o cliente de outra carteira e, pelo crm_empresas_minhas() (que conta
-- as empresas dos negócios dela), passava a ver e editar a ficha, os contatos, os boletos e as notas dele
-- (auditoria de segurança de 22/10/2026, item 1). Gestora e administrador continuam livres (crm_eh_gestor).
create policy altera on public.crm_negocios for update to authenticated
  using ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and responsavel_id = (select auth.uid())))
  with check ((select public.crm_eh_gestor()) or ((select public.crm_eh_membro()) and responsavel_id = (select auth.uid()) and public.crm_ve_empresa(empresa_id)));
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
-- duplicata "002527/01" (série 1, FKN) ou "2-000012/01" (série 2, CRM): a nota é achada pelo número E pela série
declare pre text := split_part(old.duplicata, '/', 1);
  ser int := case when pre ~ '^\d+-' then split_part(pre, '-', 1)::int else 1 end;
  num bigint := coalesce(old.nota_numero, nullif(regexp_replace(case when pre ~ '^\d+-' then split_part(pre, '-', 2) else pre end, '\D', '', 'g'), '')::bigint);
begin
  -- recebido no Caixa ("Recebi"): o dinheiro já está lá
  if exists (select 1 from public.crm_fin_lancamentos where titulo_duplicata = old.duplicata and situacao = 'pago') then return old; end if;
  insert into public.crm_fin_titulos_baixados (duplicata, nota_numero, empresa_id, cliente_nome, vencimento, previsao, valor, origem, resolvido, resolvido_em)
  select old.duplicata, num, old.empresa_id, old.cliente_nome, old.vencimento, old.previsao, old.valor, old.origem, c.r, case when c.r is not null then now() end
    from (select case when exists (select 1 from public.crm_notas where numero = num and coalesce(nullif(regexp_replace(coalesce(serie, ''), '\D', '', 'g'), '')::int, 1) = ser and cancelada) then 'cancelada' end r) c
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
  select numero, serie, emitida_em, cancelada into n from public.crm_notas where id = i.nota_id;
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
  values (i.codigo, n.emitida_em, 'saida', -round(i.quantidade * f, 3), i.quantidade, un, f, conf, p_item,
    'NF ' || case when coalesce(nullif(regexp_replace(coalesce(n.serie, ''), '\D', '', 'g'), '')::int, 1) = 1 then n.numero::text
                  else nullif(regexp_replace(n.serie, '\D', '', 'g'), '')::int || '-' || n.numero end, null);   -- série 2 do CRM: "NF 2-1"
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
      when j.qc > j.qk and exists (select 1 from public.crm_estoque_avulsas av where av.codigo = j.codigo and av.estornada_em is null and av.criado_em <= f.gerado_em and av.criado_em >= j.inicio) then 'entrada avulsa no CRM (compra sem nota de compra; o FKN não tem)'
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
-- ICMS-ST que veio em cada item da nota de compra (19/10/2026): base, alíquota, ICMS próprio do substituto e ICMS-ST do
-- item inteiro (estoque.js stDoDet). A revenda com CST 60 informa isso, proporcional, da compra mais recente (fiscal.js).
alter table public.crm_compra_itens add column if not exists st_cst text;
alter table public.crm_compra_itens add column if not exists st_base numeric(16,2);
alter table public.crm_compra_itens add column if not exists st_aliq numeric(7,4);
alter table public.crm_compra_itens add column if not exists st_proprio numeric(16,2);
alter table public.crm_compra_itens add column if not exists st_valor numeric(16,2);
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

-- Completa o ICMS-ST dos itens gravados antes da leitura do ST (19/10/2026): o navegador relê o XML guardado
-- (crm-compras-xml) e manda [{chave, ordem, st_cst, st_base, st_aliq, st_proprio, st_valor}]; só preenche o que está vazio.
create or replace function public.crm_compra_itens_st(p jsonb) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (public.crm_eh_admin() or public.crm_eh_comprador()) then raise exception 'só o administrador ou o comprador'; end if;
  update public.crm_compra_itens i set st_cst = x.st_cst, st_base = x.st_base, st_aliq = x.st_aliq, st_proprio = x.st_proprio, st_valor = x.st_valor
    from jsonb_to_recordset(coalesce(p, '[]'::jsonb)) as x(chave text, ordem integer, st_cst text, st_base numeric, st_aliq numeric, st_proprio numeric, st_valor numeric),
         public.crm_compras c
   where c.chave = x.chave and i.compra_id = c.id and i.ordem = x.ordem and i.st_cst is null and x.st_cst is not null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.crm_compra_itens_st(jsonb) from public, anon;
grant execute on function public.crm_compra_itens_st(jsonb) to authenticated;

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
-- 20/10/2026: a vendedora não lê mais a tabela direto (os itens têm o custo); lê por crm_pedidos_ler, sem o custo.
create policy ler on public.crm_pedidos for select to authenticated using (
  (select public.crm_eh_gestor()) or (select public.crm_eh_logistica()) or (select public.crm_eh_comprador()));
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
declare vc boolean := public.crm_eh_gestor() or public.crm_eh_comprador(); -- custo: administrador, gestora e comprador (20/10/2026: a vendedora não vê; logística também não)
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
-- Nota emitida pelo CRM (24/10/2026, ensaio da virada): fatura o pedido dela pela ligação em crm_nfe, nunca pela
-- semelhança (com dois pedidos parecidos do mesmo cliente, o "Repetir pedido", a nota do novo faturava o antigo, que
-- perdia a reserva sem ter saído). Nota do CRM sem pedido (bonificação, remessa, devolução) não fatura pedido nenhum.
create or replace function public.crm_pedidos_casar_int() returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  if not (public.crm_eh_ativo() or coalesce(auth.role(), '') = 'service_role') then return 0; end if;
  update public.crm_pedidos p set situacao = 'faturado', nota_id = nt.id, faturado_em = nt.emitida_em, atualizado_em = now()
    from public.crm_nfe f join public.crm_notas nt on nt.chave = f.chave
   where f.pedido_id = p.id and f.outra_id is null and f.ambiente = 'producao' and f.situacao = 'autorizada' and not nt.cancelada
     and p.situacao in ('aberto', 'separacao', 'separado');
  get diagnostics n = row_count;
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
       and not exists (select 1 from public.crm_nfe f where f.chave = nt.chave)
       and exists (select 1 from public.crm_nota_itens ni where ni.nota_id = nt.id and coalesce(ni.cfop, '') not in ('5922', '6922'))
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
create index if not exists crm_nfe_chave on public.crm_nfe (chave);
revoke all on function public.crm_pedidos_atualizar() from public, anon;
grant execute on function public.crm_pedidos_atualizar() to authenticated, service_role;

-- Grava o pedido (novo ou em aberto): equipe de vendas, cliente da carteira. Só a gestora escolhe outro(a) vendedor(a).
-- Custo fora da vista da vendedora (20/10/2026, Anderson: "preços de custo as vendedoras não enxergam"; muda a decisão
-- de 16/10, quando a equipe de vendas via custo e margem como no FKN). Custo e margem: administrador, gestora e comprador.
-- 1) O pedido como cada um pode ver: sem o custo dos itens para quem não é gestora/administrador/comprador.
create or replace function public.crm_pedido_saida(r public.crm_pedidos) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.crm_eh_gestor() or public.crm_eh_comprador() then return to_jsonb(r); end if;
  return to_jsonb(r) || jsonb_build_object('itens',
    coalesce((select jsonb_agg(o.i - 'custo' order by o.n) from jsonb_array_elements(r.itens) with ordinality o(i, n)), '[]'::jsonb));
end;
$$;
revoke all on function public.crm_pedido_saida(public.crm_pedidos) from public, anon;
grant execute on function public.crm_pedido_saida(public.crm_pedidos) to authenticated;
-- 2) A lista de pedidos da tela (os em aberto, em separação ou separados e os dos últimos dias), pela função: a
-- vendedora deixa de ler a tabela direto (a política "ler" fica só com gestora, administrador, logística e comprador).
create or replace function public.crm_pedidos_ler(p_desde timestamptz) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select public.crm_pedido_saida(p) from public.crm_pedidos p
   where p.id in (select public.crm_pedidos_meus())
     and (p.situacao in ('aberto', 'separacao', 'separado') or p.criado_em >= p_desde)
   order by p.criado_em desc, p.id;
$$;
revoke all on function public.crm_pedidos_ler(timestamptz) from public, anon;
grant execute on function public.crm_pedidos_ler(timestamptz) to authenticated;
-- 3) As funções que gravam o pedido (abaixo) devolvem o pedido por public.crm_pedido_saida.
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
  return public.crm_pedido_saida(r);
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
  return public.crm_pedido_saida(r);
end;
$$;
revoke all on function public.crm_pedido_situacao(uuid, text, text) from public, anon;
grant execute on function public.crm_pedido_situacao(uuid, text, text) to authenticated;

-- Liberar (gestora/administrador e, desde 21/10/2026, a logística): os bloqueios de agora ficam liberados; um bloqueio
-- novo volta a segurar. p_liberar = false desfaz. Entrada recebida (SEM ENTRADA): os mesmos.
create or replace function public.crm_pedido_liberar(p_id uuid, p_liberar boolean, p_entrada boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.crm_pedidos;
begin
  if not (public.crm_eh_gestor() or public.crm_eh_logistica()) then raise exception 'só a gestora, a logística ou o administrador libera pedido'; end if;
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
  return public.crm_pedido_saida(r);
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
  return public.crm_pedido_saida(r);
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
  return public.crm_pedido_saida(r);
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
  return public.crm_pedido_saida(r);
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

-- =================================================================== Tabela do IBPT (Lei 12.741/2012), 16/10/2026
-- Os tributos aproximados que a NF-e do CRM escreve ("Trib aprox R$: … Federal, … Estadual e … Municipal"), como o FKN.
-- O administrador carrega o CSV do IBPT de SP (TIBPT-SP.csv; só o tipo 0, NCM) na aba Fiscal; a crm-fiscal lê pelo NCM.
-- Carga nova sobrescreve linha a linha (sem apagar): NCM que saiu da tabela fica com a versão antiga (raro).
create table if not exists public.crm_ibpt (
  codigo       text not null,
  ex           text not null default '',
  descricao    text,
  nac_fed      numeric(7,2),
  imp_fed      numeric(7,2),
  estadual     numeric(7,2),
  municipal    numeric(7,2),
  vig_ini      date,
  vig_fim      date,
  chave        text,
  versao       text,
  fonte        text,
  carregado_em timestamptz not null default now(),
  primary key (codigo, ex)
);
alter table public.crm_ibpt enable row level security;
revoke all on public.crm_ibpt from anon, authenticated, public;
grant select on public.crm_ibpt to authenticated;
drop policy if exists ler on public.crm_ibpt;
create policy ler on public.crm_ibpt for select to authenticated using ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()));

create or replace function public.crm_ibpt_carregar(p_linhas jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.crm_eh_admin() then raise exception 'só o administrador carrega a tabela do IBPT'; end if;
  insert into public.crm_ibpt (codigo, ex, descricao, nac_fed, imp_fed, estadual, municipal, vig_ini, vig_fim, chave, versao, fonte, carregado_em)
  select x->>'codigo', coalesce(x->>'ex', ''), x->>'descricao', (x->>'nac_fed')::numeric, (x->>'imp_fed')::numeric, (x->>'estadual')::numeric, (x->>'municipal')::numeric,
         (x->>'vig_ini')::date, (x->>'vig_fim')::date, x->>'chave', x->>'versao', x->>'fonte', now()
    from jsonb_array_elements(p_linhas) x
   where x->>'codigo' ~ '^[0-9]{8}$'
  on conflict (codigo, ex) do update set descricao = excluded.descricao, nac_fed = excluded.nac_fed, imp_fed = excluded.imp_fed, estadual = excluded.estadual,
    municipal = excluded.municipal, vig_ini = excluded.vig_ini, vig_fim = excluded.vig_fim, chave = excluded.chave, versao = excluded.versao, fonte = excluded.fonte,
    carregado_em = now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.crm_ibpt_carregar(jsonb) from public, anon;
grant execute on function public.crm_ibpt_carregar(jsonb) to authenticated;

-- ICMS-ST retido (CST 60) como o FKN informa: a nota mais recente de cada produto com CST 60 (série do FKN, último ano;
-- eram 120 dias até 19/10/2026), preferindo a que traz o vICMSSTRet (o FKN às vezes manda o CST 60 sem os valores). A crm-fiscal ("Aprender o ICMS-ST", aba Fiscal) lê esses XML e guarda o valor por unidade em
-- crm_fiscal_produtos.regra.st_ret[unidade]. Só a chave de serviço.
create or replace function public.crm_fiscal_st_amostras() returns table (codigo text, chave text, emitida_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'só o serviço'; end if;
  return query
  select distinct on (i.codigo) i.codigo, n.chave, n.emitida_em
    from public.crm_fiscal_itens i join public.crm_notas n on n.id = i.nota_id
   where i.cst_icms in ('60', '500') and not n.cancelada and n.chave is not null and n.emitida_em > now() - interval '1 year'
   order by i.codigo, (coalesce(i.v_st_ret, 0) > 0) desc, n.emitida_em desc;
end;
$$;
revoke all on function public.crm_fiscal_st_amostras() from public, anon, authenticated;
grant execute on function public.crm_fiscal_st_amostras() to service_role;

-- Turma (mascotes, 17/10/2026): números do "guia do dia" do assistente, num pedido só. SECURITY INVOKER: cada bloco
-- conta só o que a RLS deixa a pessoa ver (a vendedora, os pedidos dela; o Caixa, só o administrador). Bloco que a
-- pessoa não pode ler volta vazio (o erro de permissão é engolido ali, sem derrubar os outros).
create or replace function public.crm_turma_resumo() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r jsonb := '{}'::jsonb;
  x jsonb;
begin
  begin
    select jsonb_build_object(
      'bloqueados', count(*) filter (where situacao = 'aberto' and exists (select 1 from unnest(bloqueios) b where b <> all (liberado))),
      'liberados',  count(*) filter (where situacao = 'aberto' and not exists (select 1 from unnest(bloqueios) b where b <> all (liberado))),
      'separacao',  count(*) filter (where situacao = 'separacao'),
      'separado',   count(*) filter (where situacao = 'separado'))
      into x from public.crm_pedidos_situacoes();
    r := r || jsonb_build_object('pedidos', x);
  exception when others then null; end;
  begin
    select jsonb_build_object(
      'pendentes',  count(*) filter (where situacao = 'pendente'),
      'rejeitadas', count(*) filter (where situacao = 'rejeitada' and criado_em > now() - interval '3 days'))
      into x from public.crm_nfe where ambiente = 'producao' and situacao in ('pendente', 'rejeitada');
    r := r || jsonb_build_object('nfe', x);
  exception when others then null; end;
  begin
    -- 22/10/2026: o saldo é o do livro do estoque do CRM (o da listagem do FKN para de mudar na virada)
    select jsonb_build_object('abaixo_minimo', count(*)) into x from public.crm_estoque e left join public.crm_estoque_saldo s on s.codigo = e.codigo
     where e.codigo !~ '\.\d+$' and coalesce(e.situacao, '') <> 'INATIVO' and coalesce(e.estoque_min, 0) > 0
       and coalesce(s.saldo, e.estoque_atual, e.quantidade, 0) < e.estoque_min;
    r := r || jsonb_build_object('estoque', x);
    select jsonb_build_object('sem_explicacao', coalesce((resumo->>'sem_explicacao')::int, 0), 'gerado_em', gerado_em) into x
      from public.crm_estoque_fotos where resumo is not null order by gerado_em desc limit 1;
    if x is not null then r := jsonb_set(r, '{estoque}', (r->'estoque') || x); end if;
  exception when others then null; end;
  begin
    select jsonb_build_object(
      'vencidas', count(*) filter (where vencimento < hoje), 'vencidas_valor', coalesce(sum(valor) filter (where vencimento < hoje), 0),
      'hoje', count(*) filter (where vencimento = hoje), 'hoje_valor', coalesce(sum(valor) filter (where vencimento = hoje), 0))
      into x from public.crm_fin_lancamentos where tipo = 'saida' and situacao = 'aberto' and vencimento <= hoje;
    r := r || jsonb_build_object('caixa', x);
  exception when others then null; end;
  begin
    select jsonb_build_object('vencidos', count(*), 'valor', coalesce(sum(valor), 0)) into x
      from public.crm_titulos where vencimento < hoje and not abono and cartorio_em is null;
    r := r || jsonb_build_object('receber', x);
  exception when others then null; end;
  begin
    -- notas de compra da Sefaz (19/10/2026): fornecedor que nunca vendeu para a empresa e o prazo da resposta definitiva
    select jsonb_build_object(
      'desconhecidos', (select count(distinct d.emitente_doc) from public.crm_dfe d
         where d.situacao = 'autorizada' and d.emitente_doc is not null and not public.crm_dfe_doc_conhecido(d.emitente_doc)
           and not exists (select 1 from public.crm_fornecedor_docs f where f.doc = d.emitente_doc)),
      'prazo', (select count(*) from public.crm_dfe d where d.situacao = 'autorizada' and d.conclusiva_tipo is null and d.emitida_em is not null
         and d.emitida_em + make_interval(days => public.crm_dfe_prazo_dias()) < now() + interval '30 days'
         and (exists (select 1 from public.crm_fornecedor_docs f where f.doc = d.emitente_doc and f.situacao = 'desconhecido') or public.crm_dfe_lembrete_todas())))
      into x;
    r := r || jsonb_build_object('compras_sefaz', x);
  exception when others then null; end;
  -- 22/10/2026: notas de compra no galpão ("Chegou" da logística) esperando a entrada do comprador
  begin
    select jsonb_build_object('chegaram', count(*)) into x from public.crm_compras_chegadas();
    r := r || jsonb_build_object('compras_galpao', x);
  exception when others then null; end;
  return r;
end;
$$;
revoke all on function public.crm_turma_resumo() from public, anon;
grant execute on function public.crm_turma_resumo() to authenticated;

-- Assistente com IA da turma (crm-assistente, 17/10/2026). A conversa fica guardada inteira (os blocos da resposta
-- voltam à IA sem mexer, como a API pede) e cada pergunta deixa uma linha de uso (tokens e custo estimado). Quem
-- grava é só a Edge Function (chave de serviço); cada um lê só as próprias conversas; o uso, cada um o seu e o
-- administrador todos. As CONSULTAS da IA rodam com o login de quem pergunta (RLS de sempre).
create table if not exists public.crm_assistente_conversas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.crm_usuarios(user_id) on delete cascade,
  titulo        text,
  mensagens     jsonb not null default '[]'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists crm_assistente_conversas_user on public.crm_assistente_conversas (user_id, atualizado_em desc);
create table if not exists public.crm_assistente_uso (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.crm_usuarios(user_id) on delete cascade,
  conversa_id    uuid references public.crm_assistente_conversas(id) on delete set null,
  criado_em      timestamptz not null default now(),
  tela           text,
  mascote        text,
  ferramentas    text[] not null default '{}',
  tokens_entrada integer not null default 0,
  tokens_saida   integer not null default 0,
  cache_lido     integer not null default 0,
  cache_escrito  integer not null default 0,
  custo_usd      numeric(10,5) not null default 0,
  erro           text
);
create index if not exists crm_assistente_uso_user on public.crm_assistente_uso (user_id, criado_em desc);
alter table public.crm_assistente_conversas enable row level security;
alter table public.crm_assistente_uso enable row level security;
revoke all on public.crm_assistente_conversas, public.crm_assistente_uso from anon, public;
grant select on public.crm_assistente_conversas, public.crm_assistente_uso to authenticated;
drop policy if exists le on public.crm_assistente_conversas;
create policy le on public.crm_assistente_conversas for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists le on public.crm_assistente_uso;
create policy le on public.crm_assistente_uso for select to authenticated using (user_id = (select auth.uid()) or (select public.crm_eh_admin()));

-- Notas de COMPRA pela Sefaz (17/10/2026, comprador sênior; servico-fiscal/dfe.js). A crm-fiscal consulta a
-- Distribuição de DF-e do Ambiente Nacional continuando do último NSU e guarda aqui o RESUMO de cada nota emitida
-- contra o CNPJ da empresa (fornecedor, valor, data, situação). O XML completo (com os itens e os preços) vem depois
-- da Ciência da Operação e fica no bucket privado crm-compras-xml (<chave>.xml); o navegador do comprador lê o XML com
-- o mesmo leitor da entrada de compra (estoque.js → compraDoXml) e grava em crm_compras. Só a chave de serviço grava;
-- lê o administrador e o comprador. crm_dfe_estado: o NSU e a hora da próxima consulta (regra da Sefaz: 1 hora de espera
-- quando não há mais nada; senão cStat 656 e o CNPJ fica bloqueado).
create table if not exists public.crm_dfe (
  chave            text primary key check (chave ~ '^\d{44}$'),
  nsu              bigint,
  emitente_doc     text,
  emitente_nome    text,
  emitida_em       timestamptz,
  valor            numeric(14,2),
  tp_nf            smallint,
  situacao         text not null default 'autorizada' check (situacao in ('autorizada', 'cancelada', 'denegada')),
  protocolo        text,
  manifestada_em   timestamptz,
  manifesto_cstat  integer,
  manifesto_motivo text,
  xml_em           timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index if not exists crm_dfe_emitida on public.crm_dfe (emitida_em desc);
create table if not exists public.crm_dfe_estado (
  id            smallint primary key default 1 check (id = 1),
  ult_nsu       bigint not null default 0,
  max_nsu       bigint not null default 0,
  proxima_em    timestamptz,
  ultimo_cstat  integer,
  ultimo_motivo text,
  ultima_em     timestamptz
);
alter table public.crm_dfe enable row level security;
alter table public.crm_dfe_estado enable row level security;
grant select on public.crm_dfe, public.crm_dfe_estado to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'crm_dfe' and policyname = 'le') then
    create policy le on public.crm_dfe for select to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'crm_dfe_estado' and policyname = 'le') then
    create policy le on public.crm_dfe_estado for select to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('crm-compras-xml', 'crm-compras-xml', false, 2097152, array['text/xml','application/xml'])
  on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = excluded.allowed_mime_types;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'crm_compras_xml_le') then
    create policy crm_compras_xml_le on storage.objects for select to authenticated using (bucket_id = 'crm-compras-xml' and ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())));
  end if;
end $$;

-- ============================================================ comprador sênior: fornecedores (18/10/2026)
-- Cadastro dos fornecedores que o comprador preenche (pedido do Anderson): prazo de entrega, pedido mínimo, frete,
-- dias de fazer pedido e contato. O código é o do fornecedor no FKN (fornecedor_cod da listagem SIFN108); sem cadastro,
-- o CRM usa o nome da listagem e 7 dias de prazo. crm_produto_fornecedor: o produto sem fornecedor no FKN (ou com o
-- errado) ganha um aqui; fornecedor nulo = volta ao do FKN (sem apagar linha). crm_custo_historico: cada mudança do
-- último custo de compra na listagem do FKN (gatilho), para o aviso "preço de compra subiu".
create table if not exists public.crm_fornecedores (
  codigo          text primary key check (length(btrim(codigo)) > 0),
  nome            text not null check (length(btrim(nome)) > 0),
  cnpj            text,
  contato         text,
  telefone        text,
  email           text,
  prazo_dias      integer not null default 7 check (prazo_dias between 0 and 180),
  pedido_minimo   numeric(14,2) check (pedido_minimo is null or pedido_minimo >= 0),
  frete           text check (frete is null or frete in ('cif', 'fob', 'cif_acima')),
  frete_cif_acima numeric(14,2) check (frete_cif_acima is null or frete_cif_acima >= 0),
  dias_pedido     smallint[] not null default '{}',
  pagamento       text,
  obs             text,
  ativo           boolean not null default true,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid default auth.uid()
);
create table if not exists public.crm_produto_fornecedor (
  codigo         text primary key,
  fornecedor     text references public.crm_fornecedores(codigo),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
create table if not exists public.crm_custo_historico (
  id             bigint generated always as identity primary key,
  codigo         text not null,
  descricao      text,
  fornecedor_cod text,
  custo_de       numeric(16,4),
  custo_para     numeric(16,4),
  em             timestamptz not null default now()
);
create index if not exists crm_custo_historico_em on public.crm_custo_historico (em desc);
alter table public.crm_fornecedores enable row level security;
alter table public.crm_produto_fornecedor enable row level security;
alter table public.crm_custo_historico enable row level security;
grant select, insert, update on public.crm_fornecedores, public.crm_produto_fornecedor to authenticated;
grant select on public.crm_custo_historico to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'crm_fornecedores' and policyname = 'tudo') then
    create policy tudo on public.crm_fornecedores for all to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())) with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'crm_produto_fornecedor' and policyname = 'tudo') then
    create policy tudo on public.crm_produto_fornecedor for all to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())) with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'crm_custo_historico' and policyname = 'le') then
    create policy le on public.crm_custo_historico for select to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
  end if;
end $$;
create or replace function public.crm_custo_mudou() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.custo_compra, 0) > 0 and coalesce(new.custo_compra, 0) > 0 and new.custo_compra <> old.custo_compra then
    insert into public.crm_custo_historico (codigo, descricao, fornecedor_cod, custo_de, custo_para)
    values (new.codigo, new.descricao, new.fornecedor_cod, old.custo_compra, new.custo_compra);
  end if;
  return new;
end $$;
create or replace trigger crm_estoque_custo after update of custo_compra on public.crm_estoque for each row execute function public.crm_custo_mudou();
-- Resumo por fornecedor (a IA e a tela): produtos ativos, abaixo do mínimo, com pedido em aberto e o cadastro.
create or replace function public.crm_fornecedores_resumo()
returns table (codigo text, nome text, produtos integer, abaixo_minimo integer, com_pedido integer, prazo_dias integer, prazo_estimado boolean,
  pedido_minimo numeric, frete text, frete_cif_acima numeric, dias_pedido smallint[], pagamento text, contato text, telefone text, email text, obs text)
language sql stable security invoker set search_path = public as $$
  with p as (
    select coalesce(pf.fornecedor, e.fornecedor_cod) as cod, e.quantidade, e.estoque_min, e.pend_fornecedor
    from crm_estoque e left join crm_produto_fornecedor pf on pf.codigo = e.codigo
    where e.codigo !~ '\.\d+$' and coalesce(e.situacao, '') <> 'INATIVO'
  ), g as (
    select cod, count(*)::int as produtos,
      count(*) filter (where estoque_min > 0 and quantidade < estoque_min)::int as abaixo,
      count(*) filter (where pend_fornecedor > 0)::int as pedido
    from p where cod is not null group by cod
  ), nomes as (select fornecedor_cod as cod, max(fornecedor) as nome from crm_estoque where fornecedor_cod is not null group by 1)
  select coalesce(f.codigo, g.cod), coalesce(f.nome, n.nome, g.cod), coalesce(g.produtos, 0), coalesce(g.abaixo, 0), coalesce(g.pedido, 0),
    coalesce(f.prazo_dias, 7), f.codigo is null, f.pedido_minimo, f.frete, f.frete_cif_acima, coalesce(f.dias_pedido, '{}'), f.pagamento, f.contato, f.telefone, f.email, f.obs
  from g full join crm_fornecedores f on f.codigo = g.cod left join nomes n on n.cod = coalesce(f.codigo, g.cod)
$$;

-- ============================================================ comparação mensal com os concorrentes (18/10/2026)
-- Pedido do Anderson: acompanhar de perto os maiores concorrentes (a lista fica no banco). A cesta são os produtos que se
-- comparam todo mês, cada um com a UNIDADE DE COMPARAÇÃO (ex.: "metro", "folha", "litro") e quantas dessas há na nossa
-- unidade (fator: o fardo de 8 rolos de 300 m = 2400 metros). O comprador lança o preço que viu no site/cotação de cada
-- concorrente, com quanto vem na embalagem dele (na mesma unidade de comparação); o CRM compara por unidade. Os nomes
-- dos concorrentes são dados da instalação (ficam no banco, não no código).
create table if not exists public.crm_concorrentes (
  id         bigint generated always as identity primary key,
  nome       text not null check (length(btrim(nome)) > 0),
  site       text,
  obs        text,
  ativo      boolean not null default true,
  ordem      integer not null default 0,
  criado_em  timestamptz not null default now()
);
create table if not exists public.crm_cesta (
  codigo        text primary key,
  unidade_comp  text not null default 'unidade',
  fator         numeric(14,4) not null default 1 check (fator > 0),
  ordem         integer not null default 0,
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.crm_precos_concorrente (
  id             bigint generated always as identity primary key,
  mes            date not null check (extract(day from mes) = 1),
  concorrente_id bigint not null references public.crm_concorrentes(id),
  codigo         text not null,
  preco          numeric(14,2) not null check (preco > 0),
  quantidade     numeric(14,4) not null default 1 check (quantidade > 0),   -- quanto vem na embalagem dele, na unidade de comparação
  descricao      text,                                                    -- como o concorrente chama o produto
  link           text,
  obs            text,
  registrado_por uuid default auth.uid(),
  em             timestamptz not null default now(),
  unique (mes, concorrente_id, codigo)
);
alter table public.crm_concorrentes enable row level security;
alter table public.crm_cesta enable row level security;
alter table public.crm_precos_concorrente enable row level security;
grant select, insert, update on public.crm_concorrentes, public.crm_cesta, public.crm_precos_concorrente to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'crm_concorrentes' and policyname = 'tudo') then
    create policy tudo on public.crm_concorrentes for all to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())) with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'crm_cesta' and policyname = 'tudo') then
    create policy tudo on public.crm_cesta for all to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())) with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'crm_precos_concorrente' and policyname = 'tudo') then
    create policy tudo on public.crm_precos_concorrente for all to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())) with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
  end if;
end $$;

-- ============================================================ notas de compra: fornecedor desconhecido e prazo (19/10/2026)
-- Pedido do Anderson (antes de ligar a ciência automática): avisar quando aparece nota de um fornecedor que nunca vendeu
-- para a empresa e lembrar o prazo da resposta definitiva (confirmação, desconhecimento, operação não realizada).
-- crm_fornecedor_docs: o comprador diz "conheço" (e de qual fornecedor do FKN é) ou "não reconheço" cada CNPJ emitente.
-- Conhecido também = CNPJ no cadastro de fornecedores ou de uma nota de compra que já deu entrada. Prazo: config
-- fiscal.dfe_prazo_dias (padrão 90, contado da emissão; Ajuste SINIEF 14/2026 segundo o vigia: conferir com o contador).
-- O lembrete vale para as notas de fornecedor "não reconheço" e, com fiscal.dfe_lembrete_todas = true, para todas.
alter table public.crm_dfe add column if not exists conclusiva_tipo text check (conclusiva_tipo is null or conclusiva_tipo in ('confirmacao', 'desconhecimento', 'nao_realizada'));
alter table public.crm_dfe add column if not exists conclusiva_em timestamptz;
alter table public.crm_dfe add column if not exists conclusiva_cstat integer;
alter table public.crm_dfe add column if not exists conclusiva_motivo text;
alter table public.crm_dfe add column if not exists conclusiva_por uuid;
create table if not exists public.crm_fornecedor_docs (
  doc            text primary key,
  situacao       text not null check (situacao in ('conhecido', 'desconhecido')),
  fornecedor_cod text,
  nome           text,
  obs            text,
  em             timestamptz not null default now(),
  por            uuid default auth.uid()
);
alter table public.crm_fornecedor_docs enable row level security;
grant select, insert, update on public.crm_fornecedor_docs to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'crm_fornecedor_docs' and policyname = 'tudo') then
    create policy tudo on public.crm_fornecedor_docs for all to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())) with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
  end if;
end $$;
create or replace function public.crm_dfe_doc_conhecido(p_doc text) returns boolean language sql stable security invoker set search_path = public as $$
  select exists (select 1 from crm_fornecedor_docs where doc = p_doc and situacao = 'conhecido')
      or exists (select 1 from crm_fornecedores where regexp_replace(upper(coalesce(cnpj, '')), '[^0-9A-Z]', '', 'g') = p_doc)
      or exists (select 1 from crm_compras where fornecedor_doc = p_doc and situacao = 'lancada')
$$;
create or replace function public.crm_dfe_prazo_dias() returns integer language sql stable security invoker set search_path = public as $$
  select coalesce(nullif((select dados->'fiscal'->>'dfe_prazo_dias' from crm_config where id = 1), '')::int, 90)
$$;
create or replace function public.crm_dfe_lembrete_todas() returns boolean language sql stable security invoker set search_path = public as $$
  select coalesce((select (dados->'fiscal'->>'dfe_lembrete_todas')::boolean from crm_config where id = 1), false)
$$;

-- Selo "chegou" das notas de compra pendentes (19/10/2026): o produto nosso de cada item — o item já ligado, a ligação
-- lembrada do fornecedor (crm_compra_vinculos) ou o código de barras (crm_fiscal_produtos.gtin). O navegador compara
-- com a última entrada da listagem do FKN (estoque.js chegadaCompras). Só admin e comprador (os mesmos da RLS de
-- crm_compras); o teste de papel roda uma vez, não por linha.
create or replace function public.crm_compras_itens_produto()
returns table (compra_id uuid, ordem integer, codigo text, como text)
language sql stable security definer set search_path = public as $$
  select i.compra_id, i.ordem, regexp_replace(coalesce(i.codigo, v.codigo, g.codigo), '\.\d+$', ''),
    case when i.codigo is not null then 'item' when v.codigo is not null then 'vinculo' else 'ean' end
  from crm_compras c join crm_compra_itens i on i.compra_id = c.id
  left join crm_compra_vinculos v on v.fornecedor_doc = c.fornecedor_doc and v.cod_fornecedor = i.cod_fornecedor
  left join lateral (select p.codigo from crm_fiscal_produtos p where i.ean ~ '^\d{8,14}$' and p.gtin = i.ean order by p.codigo limit 1) g on true
  where c.situacao = 'pendente' and coalesce(i.codigo, v.codigo, g.codigo) is not null
    and ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()))
$$;
revoke all on function public.crm_compras_itens_produto() from public, anon;
grant execute on function public.crm_compras_itens_produto() to authenticated;

-- Avisos do guia da turma marcados por quem está logado (19/10/2026, pedido do Anderson): "resolvido" (some até o
-- número do aviso subir ou o texto mudar) e "amanhã" (volta no dia seguinte). Fica no banco para valer em qualquer
-- computador; cada um só vê e mexe nas suas (turma.js aplicaMarcas).
create table if not exists public.crm_turma_marcas (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  tipo text not null check (tipo in ('resolvido', 'amanha')),
  texto text, n integer, ate date,
  em timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.crm_turma_marcas enable row level security;
revoke all on public.crm_turma_marcas from anon, public;
grant select, insert, update, delete on public.crm_turma_marcas to authenticated;
drop policy if exists dono on public.crm_turma_marcas;
create policy dono on public.crm_turma_marcas for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Análise de compras do dia pela IA (comprador sênior, 19/10/2026): uma por dia, gravada pela crm-assistente (service
-- role); o comprador e o administrador leem.
create table if not exists public.crm_ia_analises (
  dia date not null,
  tipo text not null check (tipo in ('compras')),
  texto text not null,
  em timestamptz not null default now(),
  por uuid,
  custo_usd numeric(10,5),
  primary key (dia, tipo)
);
alter table public.crm_ia_analises enable row level security;
revoke all on public.crm_ia_analises from anon, public;
grant select on public.crm_ia_analises to authenticated;
drop policy if exists le on public.crm_ia_analises;
create policy le on public.crm_ia_analises for select to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));

-- Fotos e fichas técnicas dos produtos (19/10/2026, pedido do Anderson: "aparecer a foto do produto" para a vendedora e
-- "a IA buscar foto e as fichas técnicas, que normalmente tem no site dos fabricantes... deixando os cadastros da forma
-- mais completa possível"). A IA (Edge Function crm-produto-buscar) procura na web e guarda o que achou como SUGESTÃO;
-- só depois que o comprador (ou o administrador) aprova entra na foto e na ficha que a equipe vê. Bucket público
-- (fotos e fichas de fabricante são públicas por natureza; nada de cliente vai nele): fotos/<codigo>-<n>.<ext>,
-- fichas/<codigo>-<tipo>.pdf e sugestoes/<codigo>/...
create table if not exists public.crm_produto_fotos (
  codigo text primary key,
  caminho text not null,
  fonte text, fonte_url text,
  atualizado_em timestamptz default now(),
  atualizado_por uuid default auth.uid()
);
create table if not exists public.crm_produto_fotos_sugestoes (
  codigo text primary key,
  candidatos jsonb default '[]'::jsonb,   -- [{ caminho, url, pagina, site, tipo, ean_bate, obs }]
  info jsonb,                             -- { marca, fabricante, descricao, especificacoes, ficha, fispq, fonte_url }
  busca text, erro text,
  situacao text default 'sugerida' check (situacao in ('sugerida', 'aprovada', 'recusada', 'sem', 'erro')),
  em timestamptz default now(),
  custo_usd numeric(10,5),
  por uuid default auth.uid()
);
create table if not exists public.crm_produto_info (
  codigo text primary key,
  marca text, fabricante text, descricao text,
  especificacoes jsonb not null default '[]'::jsonb,  -- [{ nome, valor }]: rendimento, diluição, aroma, medidas…
  ficha_caminho text, ficha_url text, fispq_caminho text, fispq_url text, fonte_url text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.crm_produto_fotos enable row level security;
alter table public.crm_produto_fotos_sugestoes enable row level security;
alter table public.crm_produto_info enable row level security;
drop policy if exists le on public.crm_produto_fotos;
create policy le on public.crm_produto_fotos for select to authenticated using ((select public.crm_eh_ativo()));
drop policy if exists grava on public.crm_produto_fotos;
create policy grava on public.crm_produto_fotos for insert to authenticated with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
drop policy if exists muda on public.crm_produto_fotos;
create policy muda on public.crm_produto_fotos for update to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()))
  with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
drop policy if exists tira on public.crm_produto_fotos;
create policy tira on public.crm_produto_fotos for delete to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
drop policy if exists tudo on public.crm_produto_fotos_sugestoes;
create policy tudo on public.crm_produto_fotos_sugestoes for all to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()))
  with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
drop policy if exists le on public.crm_produto_info;
create policy le on public.crm_produto_info for select to authenticated using ((select public.crm_eh_ativo()));
drop policy if exists grava on public.crm_produto_info;
create policy grava on public.crm_produto_info for insert to authenticated with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
drop policy if exists muda on public.crm_produto_info;
create policy muda on public.crm_produto_info for update to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()))
  with check ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('crm-produtos-fotos', 'crm-produtos-fotos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "crm fotos grava" on storage.objects;
create policy "crm fotos grava" on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-produtos-fotos' and ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())));
drop policy if exists "crm fotos muda" on storage.objects;
create policy "crm fotos muda" on storage.objects for update to authenticated
  using (bucket_id = 'crm-produtos-fotos' and ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())));
drop policy if exists "crm fotos le" on storage.objects;
create policy "crm fotos le" on storage.objects for select to authenticated
  using (bucket_id = 'crm-produtos-fotos' and ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())));
drop policy if exists "crm fotos tira" on storage.objects;
create policy "crm fotos tira" on storage.objects for delete to authenticated
  using (bucket_id = 'crm-produtos-fotos' and ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())));
-- Quanto saiu de cada produto nas notas (sem valor), para o catálogo ordenar pelos mais vendidos: qualquer usuário ativo.
create or replace function public.crm_produtos_vendidos(p_dias integer default 90)
returns table (codigo text, quantidade numeric, notas integer)
language sql stable security definer set search_path = public as $$
  select regexp_replace(i.codigo, '\.\d+$', ''), round(sum(i.quantidade), 3), count(distinct n.id)::int
    from public.crm_nota_itens i join public.crm_notas n on n.id = i.nota_id
   where public.crm_eh_ativo() and not coalesce(n.cancelada, false) and coalesce(i.codigo, '') <> ''
     and n.emitida_em >= now() - make_interval(days => least(greatest(coalesce(p_dias, 90), 1), 400))
   group by 1;
$$;
revoke all on function public.crm_produtos_vendidos(integer) from public, anon;
grant execute on function public.crm_produtos_vendidos(integer) to authenticated;
-- "Na sua carteira, quem compra" (ficha do produto, 19/10/2026): SECURITY INVOKER, então a RLS das notas faz a carteira
-- (a vendedora vê os clientes dela; gestora, administrador e comprador veem todos). Índice pelo código sem o ".1" da caixa.
create index if not exists crm_nota_itens_base_idx on public.crm_nota_itens ((regexp_replace(codigo, '\.\d+$', '')));
create or replace function public.crm_produto_clientes(p_codigo text, p_limite integer default 8)
returns table (empresa_id uuid, nome text, ultima timestamptz, quantidade numeric, notas integer)
language sql stable security invoker set search_path = public as $$
  select n.empresa_id, coalesce(max(n.cliente_nome), ''), max(n.emitida_em), round(sum(i.quantidade), 3), count(distinct n.id)::int
    from public.crm_nota_itens i join public.crm_notas n on n.id = i.nota_id
   where regexp_replace(i.codigo, '\.\d+$', '') = regexp_replace(coalesce(p_codigo, ''), '\.\d+$', '')
     and not coalesce(n.cancelada, false)
   group by n.empresa_id
   order by max(n.emitida_em) desc
   limit least(greatest(coalesce(p_limite, 8), 1), 30);
$$;
revoke all on function public.crm_produto_clientes(text, integer) from public, anon;
grant execute on function public.crm_produto_clientes(text, integer) to authenticated;

-- ================================================================
-- Boleto ao CLIENTE pelo WhatsApp da empresa (20/10/2026, pedido do Anderson): modelo boleto_cliente (PDF anexo, em
-- nome do(a) vendedor(a), aviso cordial do cartório, botões "Falar comigo" e "Já paguei"), mandado pela crm-whatsapp
-- (acao 'cliente'); o retorno da Meta (entregue, lido, "Já paguei", respostas) chega pela crm-whatsapp-retorno.
alter table public.crm_boletos add column if not exists wa_entrega text;        -- entregue | lido | falhou (mensagem ao(à) vendedor(a))
alter table public.crm_boletos add column if not exists cli_msg text;           -- id da mensagem ao cliente na Meta
alter table public.crm_boletos add column if not exists cli_status text;        -- enviado | entregue | lido | falhou
alter table public.crm_boletos add column if not exists cli_em timestamptz;
alter table public.crm_boletos add column if not exists cli_erro text;
alter table public.crm_boletos add column if not exists cli_tel text;
alter table public.crm_boletos add column if not exists cli_por uuid;
alter table public.crm_boletos add column if not exists cli_prazo date;         -- data do aviso de cartório na mensagem
alter table public.crm_boletos add column if not exists cli_pagou_em timestamptz; -- o cliente tocou em "Já paguei"
alter table public.crm_boletos add column if not exists cli_falou_em timestamptz; -- o cliente tocou em "Falar comigo"
create index if not exists crm_boletos_wa_msg_idx on public.crm_boletos (wa_msg);
create index if not exists crm_boletos_cli_msg_idx on public.crm_boletos (cli_msg);
-- tudo o que a Meta manda (status, mensagens, cliques e as respostas automáticas); só o administrador lê,
-- quem grava é a Edge Function (service_role)
create table if not exists public.crm_whatsapp_eventos (
  id bigint generated always as identity primary key,
  tipo text not null,            -- status | mensagem | clique | resposta
  wamid text,
  status text,
  de text,
  texto text,
  payload text,
  contexto text,
  bruto jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists crm_whatsapp_eventos_wamid_idx on public.crm_whatsapp_eventos (wamid);
create index if not exists crm_whatsapp_eventos_de_idx on public.crm_whatsapp_eventos (de, criado_em);
alter table public.crm_whatsapp_eventos enable row level security;
revoke all on public.crm_whatsapp_eventos from anon, public, authenticated;
grant select on public.crm_whatsapp_eventos to authenticated;
drop policy if exists le on public.crm_whatsapp_eventos;
create policy le on public.crm_whatsapp_eventos for select to authenticated using ((select public.crm_eh_admin()));

-- Custo da IA no mês somado no banco (20/10/2026: a soma feita na Edge Function lia só as 1.000 primeiras linhas).
-- SECURITY INVOKER: as funções chamam com a chave de serviço; quem chamar logado só soma o que a RLS deixa ver.
create or replace function public.crm_ia_custo_mes(p_desde timestamptz)
returns table (total numeric, fotos numeric)
language sql stable set search_path = public as $$
  select coalesce(sum(custo_usd), 0), coalesce(sum(custo_usd) filter (where tela = 'fotos'), 0)
    from public.crm_assistente_uso where criado_em >= p_desde
$$;

-- Códigos de barras de cada produto para a pesquisa da tela Produtos (20/10/2026): o do cadastro fiscal e os das notas
-- de compra. Só o código de barras sai daqui (as tabelas de origem continuam só do administrador e do comprador).
create or replace function public.crm_produtos_eans() returns table (codigo text, ean text)
language sql stable security definer set search_path = public as $$
  select distinct x.codigo, x.ean from (
    select f.codigo, f.gtin ean from public.crm_fiscal_produtos f where f.gtin ~ '^\d{8,14}$'
    union all
    select i.codigo, i.ean from public.crm_compra_itens i where i.codigo is not null and i.ean ~ '^\d{8,14}$'
  ) x where x.ean !~ '^0+$' and (select public.crm_eh_ativo());
$$;
revoke all on function public.crm_produtos_eans() from public, anon;
grant execute on function public.crm_produtos_eans() to authenticated;

-- Situação e bloqueios dos pedidos que a pessoa vê (20/10/2026), para o guia do Clean (crm_turma_resumo é SECURITY
-- INVOKER e a vendedora não lê mais crm_pedidos direto). Só situação e bloqueios: nada de itens nem custo.
create or replace function public.crm_pedidos_situacoes() returns table (situacao text, bloqueios text[], liberado text[])
language sql stable security definer set search_path = public as $$
  select p.situacao, p.bloqueios, p.liberado from public.crm_pedidos p
   where p.situacao in ('aberto', 'separacao', 'separado') and p.id in (select public.crm_pedidos_meus());
$$;
revoke all on function public.crm_pedidos_situacoes() from public, anon;
grant execute on function public.crm_pedidos_situacoes() to authenticated;

-- NCM de cada produto para o orçamento enviado ao cliente (20/10/2026, Anderson: "sempre nos orçamentos para enviar aos
-- clientes, deve sair o NCM também"). Só o NCM sai daqui: o cadastro fiscal continua só do administrador. O da regra
-- fiscal (lida das notas) vale; na falta, o da nota de compra mais recente.
create or replace function public.crm_produtos_ncm() returns table (codigo text, ncm text)
language sql stable security definer set search_path = public as $$
  select distinct on (x.codigo) x.codigo, x.ncm from (
    select f.codigo, f.ncm, 0 o, f.atualizado_em em from public.crm_fiscal_produtos f where f.ncm ~ '^\d{8}$'
    union all
    select i.codigo, i.ncm, 1, c.emitida_em from public.crm_compra_itens i join public.crm_compras c on c.id = i.compra_id
     where i.codigo is not null and i.ncm ~ '^\d{8}$'
  ) x where (select public.crm_eh_ativo()) order by x.codigo, x.o, x.em desc nulls last;
$$;
revoke all on function public.crm_produtos_ncm() from public, anon;
grant execute on function public.crm_produtos_ncm() to authenticated;

-- =================================================================== Pedidos ao fornecedor (compras a caminho)
-- (20/10/2026, simulação aprovada pelo Anderson: "quando lançar uma compra, aparecer essa informação pra vendedora saber
-- que já foi comprado, quanto foi e +- quando chegar"). O comprador registra o pedido pela sugestão de Compras (um por
-- fornecedor), com a previsão = hoje + prazo do fornecedor (editável). O andamento é calculado, não digitado: a nota do
-- fornecedor (crm_compras, pela Sefaz ou pelo XML) fatura o pedido e a entrada (lançada no CRM, ou a última entrada da
-- listagem do FKN depois da nota, durante o paralelo) dá a baixa; por produto, na ordem em que os pedidos foram feitos.
-- A vendedora vê por crm_a_caminho(): quantidade e datas, sem custo. Tudo do pedido em si: administrador e comprador.
create table if not exists public.crm_compra_pedidos (
  id             bigint generated by default as identity primary key,
  fornecedor_cod text,
  fornecedor_nome text not null,
  previsao       date not null,
  situacao       text not null default 'aberto' check (situacao in ('aberto', 'recebido', 'cancelado')), -- recebido = fechado à mão
  obs            text,
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  fechado_em     timestamptz,
  fechado_por    uuid
);
create table if not exists public.crm_compra_pedido_itens (
  pedido_id  bigint not null references public.crm_compra_pedidos(id) on delete cascade,
  ordem      integer not null,
  codigo     text not null,
  descricao  text,
  unidade    text,
  quantidade numeric(14,3) not null check (quantidade > 0),   -- na unidade do estoque
  custo_unit numeric(14,4),
  cancelado  numeric(14,3) not null default 0 check (cancelado >= 0),
  primary key (pedido_id, ordem)
);
create index if not exists crm_compra_pedido_itens_codigo_idx on public.crm_compra_pedido_itens (codigo);
create index if not exists crm_compra_pedidos_situacao_idx on public.crm_compra_pedidos (situacao, criado_em);
alter table public.crm_compra_pedidos enable row level security;
alter table public.crm_compra_pedido_itens enable row level security;
revoke all on public.crm_compra_pedidos, public.crm_compra_pedido_itens from anon, public;
grant select on public.crm_compra_pedidos, public.crm_compra_pedido_itens to authenticated;
drop policy if exists ler on public.crm_compra_pedidos;
create policy ler on public.crm_compra_pedidos for select to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));
drop policy if exists ler on public.crm_compra_pedido_itens;
create policy ler on public.crm_compra_pedido_itens for select to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));

-- Grava o pedido inteiro: { fornecedor_cod, fornecedor_nome, previsao, obs, itens: [{codigo, descricao, unidade, quantidade, custo_unit}] }.
create or replace function public.crm_compra_pedido_gravar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint; x jsonb; k int := 0; r public.crm_compra_pedidos;
begin
  if not (public.crm_eh_admin() or public.crm_eh_comprador()) then raise exception 'só o administrador e o comprador registram pedido ao fornecedor'; end if;
  if coalesce(btrim(p->>'fornecedor_nome'), '') = '' then raise exception 'diga o fornecedor'; end if;
  if nullif(p->>'previsao', '') is null then raise exception 'diga quando deve chegar'; end if;
  insert into public.crm_compra_pedidos (fornecedor_cod, fornecedor_nome, previsao, obs)
    values (nullif(btrim(p->>'fornecedor_cod'), ''), btrim(p->>'fornecedor_nome'), (p->>'previsao')::date, nullif(btrim(coalesce(p->>'obs', '')), ''))
    returning id into pid;
  for x in select value from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    if coalesce(nullif(x->>'quantidade', '')::numeric, 0) <= 0 then continue; end if;
    if coalesce(btrim(x->>'codigo'), '') = '' then raise exception 'item sem código'; end if;
    k := k + 1;
    insert into public.crm_compra_pedido_itens (pedido_id, ordem, codigo, descricao, unidade, quantidade, custo_unit)
      values (pid, k, regexp_replace(btrim(x->>'codigo'), '\.\d+$', ''), nullif(btrim(coalesce(x->>'descricao', '')), ''), nullif(btrim(coalesce(x->>'unidade', '')), ''),
              (x->>'quantidade')::numeric, nullif(x->>'custo_unit', '')::numeric);
  end loop;
  if k = 0 then raise exception 'o pedido precisa de pelo menos um item com quantidade'; end if;
  select * into r from public.crm_compra_pedidos where id = pid;
  return to_jsonb(r) || jsonb_build_object('itens', k);
end;
$$;
revoke all on function public.crm_compra_pedido_gravar(jsonb) from public, anon;
grant execute on function public.crm_compra_pedido_gravar(jsonb) to authenticated;

-- Andamento de cada item (interna): faturado = o que as notas do fornecedor trouxeram do produto; recebido = o que
-- entrou. Por produto, as notas desde 1 dia antes do primeiro pedido em aberto vão atendendo os pedidos em aberto na
-- ordem. O pedido fechado à mão ("chegou") sai da conta e vale como todo recebido.
-- Unidade: o fator do item (conferência), o da ligação lembrada do fornecedor, o da embalagem do produto ou 1.
create or replace function public.crm_compra_andamento_int()
returns table (pedido_id bigint, ordem integer, codigo text, quantidade numeric, cancelado numeric, faturado numeric, recebido numeric, faturado_em timestamptz, notas text)
language sql stable security definer set search_path = public as $$
  with it as (
    select i.pedido_id, i.ordem, i.codigo cod, i.quantidade, i.cancelado, p.criado_em, p.situacao, greatest(i.quantidade - i.cancelado, 0) q
      from public.crm_compra_pedido_itens i join public.crm_compra_pedidos p on p.id = i.pedido_id
     where p.situacao = 'aberto'),
  acc as (
    select it.*, coalesce(sum(it.q) over (partition by it.cod order by it.criado_em, it.pedido_id, it.ordem rows between unbounded preceding and 1 preceding), 0) ini from it),
  desde as (select it.cod, min(it.criado_em) - interval '1 day' d from it group by it.cod),
  nf as (
    select x.cod, c.numero, c.emitida_em,
           ci.quantidade * coalesce(nullif(ci.fator, 0), case when ci.codigo is null then v.fator end,
             case when x.caixa then (select u.fator from public.crm_estoque_unidades u where u.codigo = x.cod and u.unidade = 'CX') end,
             (select u.fator from public.crm_estoque_unidades u where u.codigo = x.cod and u.unidade = public.crm_un(ci.unidade)), 1) qtd,
           (c.situacao = 'lancada' or (e.ult_entrada is not null and e.ult_entrada >= (c.emitida_em at time zone 'America/Sao_Paulo')::date)) entrou
      from public.crm_compras c
      join public.crm_compra_itens ci on ci.compra_id = c.id
      left join public.crm_compra_vinculos v on v.fornecedor_doc = c.fornecedor_doc and v.cod_fornecedor = ci.cod_fornecedor
      left join lateral (select f.codigo from public.crm_fiscal_produtos f where ci.ean ~ '^\d{8,14}$' and f.gtin = ci.ean order by f.codigo limit 1) g on true
      cross join lateral (select regexp_replace(coalesce(ci.codigo, v.codigo, g.codigo), '\.\d+$', '') cod, coalesce(ci.codigo, v.codigo, g.codigo) ~ '\.\d+$' caixa) x
      left join public.crm_estoque e on e.codigo = x.cod
     where c.situacao <> 'ignorada' and x.cod is not null),
  tot as (
    select n.cod, sum(n.qtd) fat, coalesce(sum(n.qtd) filter (where n.entrou), 0) rec, max(n.emitida_em) ult,
           string_agg(distinct n.numero::text, ', ') nums
      from nf n join desde d on d.cod = n.cod and n.emitida_em >= d.d group by n.cod)
  select a.pedido_id, a.ordem, a.cod, a.quantidade, a.cancelado,
         greatest(0, least(a.q, coalesce(t.fat, 0) - a.ini)), greatest(0, least(a.q, coalesce(t.rec, 0) - a.ini)), t.ult, t.nums
    from acc a left join tot t on t.cod = a.cod
  union all
  select i.pedido_id, i.ordem, i.codigo, i.quantidade, i.cancelado, greatest(i.quantidade - i.cancelado, 0), greatest(i.quantidade - i.cancelado, 0), null, null
    from public.crm_compra_pedido_itens i join public.crm_compra_pedidos p on p.id = i.pedido_id where p.situacao = 'recebido';
$$;
revoke all on function public.crm_compra_andamento_int() from public, anon, authenticated;

-- Andamento para o comprador e o administrador (a tela Pedidos ao fornecedor).
create or replace function public.crm_compra_pedidos_andamento()
returns table (pedido_id bigint, ordem integer, codigo text, quantidade numeric, cancelado numeric, faturado numeric, recebido numeric, faturado_em timestamptz, notas text)
language sql stable security definer set search_path = public as $$
  select * from public.crm_compra_andamento_int() where (select public.crm_eh_admin()) or (select public.crm_eh_comprador());
$$;
revoke all on function public.crm_compra_pedidos_andamento() from public, anon;
grant execute on function public.crm_compra_pedidos_andamento() to authenticated;

-- O que está a caminho, para toda a equipe (a vendedora vê em Produtos e no pedido): sem custo, sem fornecedor.
-- falta = pedido − cancelado − recebido; faturado = o que já veio em nota e ainda não entrou (chega ~2 dias depois da nota).
create or replace function public.crm_a_caminho()
returns table (codigo text, pedido_id bigint, pedido_em timestamptz, previsao date, falta numeric, faturado numeric, faturado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select a.codigo, p.id, p.criado_em, p.previsao, a.quantidade - a.cancelado - a.recebido, greatest(a.faturado - a.recebido, 0), a.faturado_em
    from public.crm_compra_andamento_int() a join public.crm_compra_pedidos p on p.id = a.pedido_id
   where p.situacao = 'aberto' and a.quantidade - a.cancelado - a.recebido > 0 and (select public.crm_eh_ativo());
$$;
revoke all on function public.crm_a_caminho() from public, anon;
grant execute on function public.crm_a_caminho() to authenticated;

-- Ações do comprador num pedido: 'previsao' (nova data), 'chegou' (fecha: tudo entrou), 'cancelar_resto' (cancela o que
-- ainda não entrou), 'cancelar' (o pedido todo, se nada entrou).
create or replace function public.crm_compra_pedido_acao(p_id bigint, p_acao text, p_previsao date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.crm_compra_pedidos;
begin
  if not (public.crm_eh_admin() or public.crm_eh_comprador()) then raise exception 'só o administrador e o comprador mexem no pedido ao fornecedor'; end if;
  select * into r from public.crm_compra_pedidos where id = p_id for update;
  if r.id is null then raise exception 'pedido não encontrado'; end if;
  if p_acao = 'previsao' then
    if p_previsao is null then raise exception 'diga a nova data'; end if;
    update public.crm_compra_pedidos set previsao = p_previsao, atualizado_em = now() where id = p_id;
  elsif p_acao = 'chegou' then
    update public.crm_compra_pedidos set situacao = 'recebido', fechado_em = now(), fechado_por = auth.uid(), atualizado_em = now() where id = p_id;
  elsif p_acao = 'cancelar_resto' then
    update public.crm_compra_pedido_itens i set cancelado = greatest(i.quantidade - a.recebido, 0)
      from public.crm_compra_andamento_int() a where a.pedido_id = i.pedido_id and a.ordem = i.ordem and i.pedido_id = p_id;
    update public.crm_compra_pedidos set situacao = 'recebido', fechado_em = now(), fechado_por = auth.uid(), atualizado_em = now() where id = p_id;
  elsif p_acao = 'cancelar' then
    if exists (select 1 from public.crm_compra_andamento_int() a where a.pedido_id = p_id and a.recebido > 0) then
      raise exception 'parte deste pedido já entrou: use "cancelar o que falta"'; end if;
    update public.crm_compra_pedidos set situacao = 'cancelado', fechado_em = now(), fechado_por = auth.uid(), atualizado_em = now() where id = p_id;
  else raise exception 'ação desconhecida';
  end if;
  select * into r from public.crm_compra_pedidos where id = p_id;
  return to_jsonb(r);
end;
$$;
revoke all on function public.crm_compra_pedido_acao(bigint, text, date) from public, anon;
grant execute on function public.crm_compra_pedido_acao(bigint, text, date) to authenticated;

-- ============================================================ tela ao entrar (20/10/2026)
-- A tela que abre ao entrar no CRM: escolhida pelo administrador (Configurações → Equipe) ou pela própria pessoa
-- (menu do nome → "Tela ao entrar no CRM"); vazia = padrão do papel (app.js, telaInicial: admin Gestão, vendedor Fila do dia,
-- comprador Compras, logística Pedidos). A tabela de usuários só o admin altera; a pessoa muda só esta coluna, pela função.
alter table public.crm_usuarios add column if not exists tela_inicial text;
alter table public.crm_usuarios drop constraint if exists crm_usuarios_tela_inicial_ok;
alter table public.crm_usuarios add constraint crm_usuarios_tela_inicial_ok check (tela_inicial is null or tela_inicial ~ '^[a-z]{2,20}$');

create or replace function public.crm_minha_tela_inicial(p_tela text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not crm_eh_ativo() then raise exception 'sem acesso'; end if;
  if coalesce(p_tela, '') <> '' and p_tela !~ '^[a-z]{2,20}$' then raise exception 'tela inválida'; end if;
  update crm_usuarios set tela_inicial = nullif(p_tela, '') where user_id = auth.uid();
end $$;
revoke all on function public.crm_minha_tela_inicial(text) from public, anon;
grant execute on function public.crm_minha_tela_inicial(text) to authenticated;

-- ============================================================ rotas de entrega e motorista (21/10/2026)
-- Pedido do Anderson: a logística monta a rota do dia pelas notas emitidas e o motorista (papel novo) vê só a rota dele no
-- celular: confirma cada entrega com a FOTO DO CANHOTO (obrigatória), "tudo certo" ou "teve problema" (com observação), e o
-- cliente recebe o agradecimento pelo WhatsApp da empresa (menos os da lista e a venda direta). Sem PDF de rota.
alter table public.crm_usuarios drop constraint if exists crm_usuarios_papel_check;
alter table public.crm_usuarios add constraint crm_usuarios_papel_check check (papel in ('admin','gestor','vendedor','comprador','logistica','motorista'));
create or replace function public.crm_eh_motorista()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.crm_papel() = 'motorista', false);
$$;
revoke all on function public.crm_eh_motorista() from public, anon;
grant execute on function public.crm_eh_motorista() to authenticated;

create table if not exists public.crm_entregas (
  id            uuid primary key default gen_random_uuid(),
  dia           date not null,
  nota_id       uuid not null unique references public.crm_notas(id) on delete cascade,
  empresa_id    uuid references public.crm_empresas(id) on delete set null,
  motorista_id  uuid references public.crm_usuarios(user_id) on delete set null,
  ordem         integer not null default 0,
  liberada      boolean not null default false,   -- "Mandar a rota aos motoristas": só então aparece no celular
  situacao      text not null default 'pendente' check (situacao in ('pendente','entregue','problema')),
  obs           text,
  canhoto       text,                             -- caminho no bucket crm-canhotos
  entregue_em   timestamptz,
  entregue_por  uuid,
  cli_msg       text, cli_status text, cli_em timestamptz, cli_erro text, cli_tel text,
  cli_proximo_em timestamptz,                     -- o cliente tocou em "Agendar próximo pedido"
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por    uuid default auth.uid()
);
create index if not exists crm_entregas_dia on public.crm_entregas (dia, motorista_id, ordem);
create index if not exists crm_entregas_msg on public.crm_entregas (cli_msg) where cli_msg is not null;
drop trigger if exists crm_entregas_atualizado_em on public.crm_entregas;
create trigger crm_entregas_atualizado_em before update on public.crm_entregas for each row execute function public.crm_toca_atualizado_em();
alter table public.crm_entregas enable row level security;
drop policy if exists ler on public.crm_entregas;
create policy ler on public.crm_entregas for select to authenticated
  using ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()) or motorista_id = (select auth.uid()));
drop policy if exists grava on public.crm_entregas;
create policy grava on public.crm_entregas for insert to authenticated with check ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()));
drop policy if exists muda on public.crm_entregas;
create policy muda on public.crm_entregas for update to authenticated
  using ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica())) with check ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()));
drop policy if exists tira on public.crm_entregas;
create policy tira on public.crm_entregas for delete to authenticated using (((select public.crm_eh_gestor()) or (select public.crm_eh_logistica())) and situacao = 'pendente');

-- fotos dos canhotos: bucket privado; quem entrega sobe, a equipe da logística e a gestão leem
insert into storage.buckets (id, name, public) values ('crm-canhotos', 'crm-canhotos', false) on conflict (id) do nothing;
drop policy if exists "crm canhotos le" on storage.objects;
create policy "crm canhotos le" on storage.objects for select to authenticated
  using (bucket_id = 'crm-canhotos' and ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()) or (select public.crm_eh_motorista())));
drop policy if exists "crm canhotos grava" on storage.objects;
create policy "crm canhotos grava" on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-canhotos' and ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()) or (select public.crm_eh_motorista())));

-- endereço de uma linha da empresa, numa linha só (para a rota e para os mapas)
create or replace function public.crm_endereco_texto(e public.crm_empresas) returns text language sql immutable set search_path = public as $$
  select nullif(concat_ws(' · ', nullif(concat_ws(', ', nullif(btrim(coalesce(e.logradouro, '')), ''), nullif(btrim(coalesce(e.numero, '')), '')), ''),
    nullif(btrim(coalesce(e.complemento, '')), ''), nullif(btrim(coalesce(e.bairro, '')), ''),
    nullif(concat_ws('/', nullif(btrim(coalesce(e.cidade, '')), ''), nullif(btrim(coalesce(e.uf, '')), '')), ''),
    nullif(btrim(coalesce(e.cep, '')), '')), '');
$$;

-- notas de venda ainda sem entrega (dos últimos dias), para a logística pôr na rota
create or replace function public.crm_rota_candidatas(p_desde date)
returns table (nota_id uuid, numero integer, emitida_em timestamptz, empresa_id uuid, cliente text, endereco text, bairro text, cidade text,
  valor numeric, vendedor text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.crm_eh_gestor() or public.crm_eh_logistica()) then raise exception 'só a logística'; end if;
  return query
    select n.id, n.numero::integer, n.emitida_em, n.empresa_id, coalesce(e.nome, n.cliente_nome), public.crm_endereco_texto(e), e.bairro, coalesce(e.cidade, n.cidade),
      n.valor_total, case when upper(n.vendedor_nome) = 'DIRETO' then 'Venda direta' else coalesce(u.nome, n.vendedor_nome) end
      from public.crm_notas n
      left join public.crm_empresas e on e.id = n.empresa_id
      left join public.crm_usuarios u on u.user_id = n.vendedor_id
     where not n.cancelada and n.emitida_em >= p_desde::timestamptz
       and not exists (select 1 from public.crm_entregas x where x.nota_id = n.id)
     order by n.emitida_em desc
     limit 300;
end $$;

-- a rota de um dia, com tudo o que a tela da logística mostra
create or replace function public.crm_rota_dia(p_dia date)
returns table (id uuid, nota_id uuid, numero integer, empresa_id uuid, cliente text, endereco text, bairro text, cidade text, valor numeric, vendedor text,
  motorista_id uuid, ordem integer, liberada boolean, situacao text, obs text, canhoto text, entregue_em timestamptz, cli_status text, cli_erro text, cli_em timestamptz, cli_proximo_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.crm_eh_gestor() or public.crm_eh_logistica()) then raise exception 'só a logística'; end if;
  return query
    select x.id, x.nota_id, n.numero::integer, x.empresa_id, coalesce(e.nome, n.cliente_nome), public.crm_endereco_texto(e), e.bairro, coalesce(e.cidade, n.cidade), n.valor_total,
      case when upper(n.vendedor_nome) = 'DIRETO' then 'Venda direta' else coalesce(u.nome, n.vendedor_nome) end, x.motorista_id, x.ordem, x.liberada, x.situacao, x.obs, x.canhoto, x.entregue_em, x.cli_status, x.cli_erro, x.cli_em, x.cli_proximo_em
      from public.crm_entregas x
      join public.crm_notas n on n.id = x.nota_id
      left join public.crm_empresas e on e.id = x.empresa_id
      left join public.crm_usuarios u on u.user_id = n.vendedor_id
     where x.dia = p_dia
     order by x.motorista_id nulls last, x.ordem, n.numero;
end $$;

-- o celular do motorista: só as entregas liberadas dele, com o endereço e um telefone para ligar
create or replace function public.crm_minha_rota(p_dia date)
returns table (id uuid, numero integer, cliente text, endereco text, telefone text, contato text, ordem integer, situacao text, obs text, entregue_em timestamptz, canhoto text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_eh_ativo() then raise exception 'sem acesso'; end if;
  return query
    select x.id, n.numero::integer, coalesce(e.nome, n.cliente_nome), public.crm_endereco_texto(e),
      coalesce(nullif(c.celular, ''), nullif(c.whatsapp, ''), nullif(c.telefone, ''), nullif(e.whatsapp, ''), nullif(e.telefone, '')), c.nome,
      x.ordem, x.situacao, x.obs, x.entregue_em, x.canhoto
      from public.crm_entregas x
      join public.crm_notas n on n.id = x.nota_id
      left join public.crm_empresas e on e.id = x.empresa_id
      left join lateral (select ct.nome, ct.celular, ct.whatsapp, ct.telefone from public.crm_contatos ct where ct.empresa_id = x.empresa_id
        order by ct.principal desc, ct.criado_em limit 1) c on true
     where x.dia = p_dia and x.liberada and x.motorista_id = auth.uid()
     order by x.ordem, n.numero;
end $$;

-- o motorista confirma a entrega dele: foto do canhoto obrigatória; "teve problema" pede a observação
create or replace function public.crm_entrega_confirmar(p_id uuid, p_situacao text, p_obs text, p_canhoto text)
returns public.crm_entregas language plpgsql security definer set search_path = public as $$
declare r public.crm_entregas;
begin
  select * into r from public.crm_entregas where id = p_id;
  if not found then raise exception 'entrega não encontrada'; end if;
  if not (r.motorista_id = auth.uid() or public.crm_eh_gestor() or public.crm_eh_logistica()) then raise exception 'esta entrega não é sua'; end if;
  if p_situacao not in ('entregue', 'problema') then raise exception 'situação inválida'; end if;
  if coalesce(btrim(p_canhoto), '') = '' or p_canhoto not like 'canhotos/%' then raise exception 'falta a foto do canhoto'; end if;
  if p_situacao = 'problema' and coalesce(btrim(p_obs), '') = '' then raise exception 'conte o que aconteceu na observação'; end if;
  update public.crm_entregas set situacao = p_situacao, obs = nullif(btrim(coalesce(p_obs, '')), ''), canhoto = p_canhoto,
    entregue_em = coalesce(entregue_em, now()), entregue_por = auth.uid()
   where id = p_id returning * into r;
  return r;
end $$;
revoke all on function public.crm_endereco_texto(public.crm_empresas) from public, anon;
revoke all on function public.crm_rota_candidatas(date) from public, anon;
revoke all on function public.crm_rota_dia(date) from public, anon;
revoke all on function public.crm_minha_rota(date) from public, anon;
revoke all on function public.crm_entrega_confirmar(uuid, text, text, text) from public, anon;
grant execute on function public.crm_rota_candidatas(date), public.crm_rota_dia(date), public.crm_minha_rota(date), public.crm_entrega_confirmar(uuid, text, text, text) to authenticated;
grant execute on function public.crm_endereco_texto(public.crm_empresas) to authenticated;

-- ============================================================ estoque operacional da logística (21/10/2026)
-- Pedido do Anderson: a logística faz contagem e ajuste, dá entrada de mercadoria (nota de compra) e vê os movimentos do
-- produto, SEM ver custo (custo e margem só administrador, gestora e comprador). As tabelas do estoque e das compras
-- continuam só do administrador e do comprador (têm custo e valor da nota); a logística lê por estas funções, que
-- devolvem só quantidades, e grava pelas mesmas funções de sempre (contagem e entrada), agora abertas a ela.
create or replace function public.crm_eh_estoque_op()
returns boolean language sql stable security definer set search_path = public as $$
  select public.crm_eh_admin() or public.crm_eh_comprador() or public.crm_eh_logistica();
$$;
create or replace function public.crm_estoque_saldo_op()
returns table (codigo text, descricao text, unidade text, saldo numeric, inicio timestamptz, ult_mov timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_eh_estoque_op() then raise exception 'sem acesso ao estoque'; end if;
  return query select s.codigo, s.descricao, s.unidade, s.saldo, s.inicio, s.ult_mov from public.crm_estoque_saldo s order by s.codigo;
end $$;
create or replace function public.crm_estoque_movs_op(p_codigo text, p_limite integer)
returns table (quando timestamptz, tipo text, quantidade numeric, qtd_doc numeric, unidade_doc text, fator numeric, conferir boolean, motivo text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_eh_estoque_op() then raise exception 'sem acesso ao estoque'; end if;
  return query select m.quando, m.tipo, m.quantidade, m.qtd_doc, m.unidade_doc, m.fator, m.conferir, m.motivo
    from public.crm_estoque_mov m where m.codigo = p_codigo order by m.quando desc limit least(coalesce(p_limite, 200), 500);
end $$;
create or replace function public.crm_compras_op(p_limite integer)
returns table (id uuid, chave text, numero bigint, serie text, emitida_em timestamptz, fornecedor_doc text, fornecedor_nome text, situacao text, lancada_em timestamptz, obs text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_eh_estoque_op() then raise exception 'sem acesso ao estoque'; end if;
  return query select c.id, c.chave, c.numero, c.serie, c.emitida_em, c.fornecedor_doc, c.fornecedor_nome, c.situacao, c.lancada_em, c.obs
    from public.crm_compras c order by c.emitida_em desc nulls last limit least(coalesce(p_limite, 200), 500);
end $$;
create or replace function public.crm_compra_itens_op(p_compras uuid[])
returns table (id uuid, compra_id uuid, ordem integer, cod_fornecedor text, descricao text, ean text, ncm text, cfop text, unidade text, quantidade numeric, codigo text, fator numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_eh_estoque_op() then raise exception 'sem acesso ao estoque'; end if;
  return query select i.id, i.compra_id, i.ordem, i.cod_fornecedor, i.descricao, i.ean, i.ncm, i.cfop, i.unidade, i.quantidade, i.codigo, i.fator
    from public.crm_compra_itens i where i.compra_id = any(p_compras) order by i.compra_id, i.ordem;
end $$;
create or replace function public.crm_compra_vinculos_op()
returns table (fornecedor_doc text, cod_fornecedor text, codigo text, fator numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_eh_estoque_op() then raise exception 'sem acesso ao estoque'; end if;
  return query select v.fornecedor_doc, v.cod_fornecedor, v.codigo, v.fator from public.crm_compra_vinculos v;
end $$;
create or replace function public.crm_estoque_unidades_op()
returns table (codigo text, unidade text, fator numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_eh_estoque_op() then raise exception 'sem acesso ao estoque'; end if;
  return query select u.codigo, u.unidade, u.fator from public.crm_estoque_unidades u;
end $$;
-- contagem/ajuste e entrada da nota de compra: as mesmas funções, agora também para a logística
create or replace function public.crm_estoque_contagem(lote jsonb, p_tipo text, p_motivo text) returns integer language plpgsql security definer set search_path = public as $$
declare x jsonb; s record; n integer := 0; d numeric;
begin
  if not public.crm_eh_estoque_op() then raise exception 'só o administrador, o comprador ou a logística'; end if;
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
create or replace function public.crm_compra_lancar(p_compra uuid, p_itens jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; it record; x jsonb; cod text; f numeric; q numeric; custo numeric; n integer := 0; ign integer := 0; agora timestamptz := now();
begin
  if not public.crm_eh_estoque_op() then raise exception 'só o administrador, o comprador ou a logística'; end if;
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
create or replace function public.crm_compras_itens_produto()
returns table (compra_id uuid, ordem integer, codigo text, como text)
language sql stable security definer set search_path = public as $$
  select i.compra_id, i.ordem, regexp_replace(coalesce(i.codigo, v.codigo, g.codigo), '\.\d+$', ''),
    case when i.codigo is not null then 'item' when v.codigo is not null then 'vinculo' else 'ean' end
  from crm_compras c join crm_compra_itens i on i.compra_id = c.id
  left join crm_compra_vinculos v on v.fornecedor_doc = c.fornecedor_doc and v.cod_fornecedor = i.cod_fornecedor
  left join lateral (select p.codigo from crm_fiscal_produtos p where i.ean ~ '^\d{8,14}$' and p.gtin = i.ean order by p.codigo limit 1) g on true
  where c.situacao = 'pendente' and coalesce(i.codigo, v.codigo, g.codigo) is not null
    and (select public.crm_eh_estoque_op())
$$;
grant execute on function public.crm_eh_estoque_op(), public.crm_estoque_saldo_op(), public.crm_estoque_movs_op(text, integer), public.crm_compras_op(integer),
  public.crm_compra_itens_op(uuid[]), public.crm_compra_vinculos_op(), public.crm_estoque_unidades_op() to authenticated;
revoke all on function public.crm_eh_estoque_op() from public, anon;
revoke all on function public.crm_estoque_saldo_op() from public, anon;
revoke all on function public.crm_estoque_movs_op(text, integer) from public, anon;
revoke all on function public.crm_compras_op(integer) from public, anon;
revoke all on function public.crm_compra_itens_op(uuid[]) from public, anon;
revoke all on function public.crm_compra_vinculos_op() from public, anon;
revoke all on function public.crm_estoque_unidades_op() from public, anon;
-- ============================================================================================================
-- Boleto do Banco do Brasil emitido pelo CRM (22/10/2026, Fase 5 da saída do FKN). Preparação: a tabela dos
-- boletos e a numeração do nosso número. Quem grava é só o serviço (Edge Function com a chave de serviço, quando o
-- caminho for decidido: API de Cobrança do BB ou arquivo de remessa); a tela só lê. Enquanto boleto.ligado não for
-- true no crm_config, a reserva de número recusa — nada muda para a equipe.
create table if not exists public.crm_boletos_bb (
  id uuid primary key default gen_random_uuid(),
  convenio text not null,
  seq bigint not null check (seq between 1 and 9999999999),
  nosso_numero text not null unique check (nosso_numero ~ '^[0-9]{17}$'),
  -- de onde vem: a parcela da nota (o crm_titulos pode ser apagado pela listagem do FKN; por isso sem chave estrangeira)
  titulo_id uuid, nfe_id uuid, nota_numero integer, parcela integer, empresa_id uuid,
  valor numeric(14,2) not null check (valor > 0),
  vencimento date not null,
  emissao date not null default current_date,
  linha_digitavel text check (linha_digitavel is null or linha_digitavel ~ '^[0-9]{47}$'),
  codigo_barras text check (codigo_barras is null or codigo_barras ~ '^[0-9]{44}$'),
  situacao text not null default 'preparado' check (situacao in ('preparado', 'registrado', 'pago', 'baixado', 'cancelado', 'erro')),
  caminho text check (caminho in ('api', 'remessa')),
  registrado_em timestamptz, pago_em date, valor_pago numeric(14,2), retorno jsonb, erro text,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  unique (convenio, seq)
);
create index if not exists crm_boletos_bb_nota on public.crm_boletos_bb (nota_numero, parcela);
create index if not exists crm_boletos_bb_empresa on public.crm_boletos_bb (empresa_id);
create index if not exists crm_boletos_bb_aberto on public.crm_boletos_bb (vencimento) where situacao in ('preparado', 'registrado');
alter table public.crm_boletos_bb enable row level security;
drop policy if exists ler on public.crm_boletos_bb;
-- lê: administrador, gestora e logística (quem emite a nota imprime o boleto junto); escreve: só o serviço
create policy ler on public.crm_boletos_bb for select to authenticated using ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()));

create table if not exists public.crm_boleto_numeracao (
  convenio text primary key check (convenio ~ '^[0-9]{7}$'),
  proximo bigint not null check (proximo between 1 and 9999999999),
  atualizado_em timestamptz not null default now()
);
alter table public.crm_boleto_numeracao enable row level security;  -- sem política: só o serviço

-- Reserva o próximo nosso número do convênio (só o serviço; só com o boleto ligado). O primeiro vem de
-- boleto.inicio_numeracao (faixa que o site do BB não usa, confirmada com o gerente).
create or replace function public.crm_boleto_reservar(p_convenio text) returns bigint language plpgsql security definer set search_path = public as $$
declare cfg jsonb; n bigint;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'só o serviço do boleto reserva número'; end if;
  select dados -> 'boleto' into cfg from public.crm_config where id = 1;
  if coalesce((cfg ->> 'ligado')::boolean, false) is not true then raise exception 'o boleto pelo BB ainda não está ligado'; end if;
  if p_convenio !~ '^[0-9]{7}$' or p_convenio <> coalesce(cfg ->> 'convenio', '') then raise exception 'convênio diferente do configurado'; end if;
  if not exists (select 1 from public.crm_boleto_numeracao where convenio = p_convenio) then
    n := nullif(regexp_replace(coalesce(cfg ->> 'inicio_numeracao', ''), '\D', '', 'g'), '')::bigint;
    if n is null then raise exception 'defina o primeiro número do CRM (boleto.inicio_numeracao)'; end if;
    insert into public.crm_boleto_numeracao (convenio, proximo) values (p_convenio, n) on conflict (convenio) do nothing;
  end if;
  update public.crm_boleto_numeracao set proximo = proximo + 1, atualizado_em = now() where convenio = p_convenio returning proximo - 1 into n;
  return n;
end;
$$;
-- ============================================================================================================
-- Cadastro de produto no CRM (22/10/2026, virada: só o CRM a partir de 03/11). Até a chave ser ligada, quem manda no
-- cadastro é a listagem do FKN (crm-notas grava e apaga o que não veio). Ligada (crm_sistema.produtos_dono = 'crm',
-- só o administrador, por crm_produtos_passar_ao_crm), a listagem do FKN deixa de mexer nos produtos (gatilho abaixo) e
-- de conferir o estoque, e o cadastro passa a ser feito aqui: comprador, logística e administrador (decisão do
-- Anderson); o custo só o administrador e o comprador. Toda alteração fica em crm_produto_hist (quem, quando, antes, depois).
-- Chaves do sistema fora do crm_config (o crm_config é regravado inteiro por quem salva Configurações; uma tela aberta
-- antes desligaria a chave). Escreve só por função do administrador; lê quem está logado.
create table if not exists public.crm_sistema (chave text primary key, valor text, quem uuid default auth.uid(), quando timestamptz not null default now());
alter table public.crm_sistema enable row level security;
drop policy if exists ler on public.crm_sistema;
create policy ler on public.crm_sistema for select to authenticated using ((select public.crm_eh_ativo()));
create or replace function public.crm_produtos_do_crm() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select valor from public.crm_sistema where chave = 'produtos_dono'), '') = 'crm';
$$;
grant execute on function public.crm_produtos_do_crm() to authenticated;

create table if not exists public.crm_produto_hist (
  id bigint generated always as identity primary key,
  codigo text not null,
  acao text not null check (acao in ('novo', 'alterado', 'dono')),
  antes jsonb, depois jsonb,
  quem uuid default auth.uid(), quando timestamptz not null default now()
);
create index if not exists crm_produto_hist_cod on public.crm_produto_hist (codigo, quando desc);
alter table public.crm_produto_hist enable row level security;
drop policy if exists ler on public.crm_produto_hist;
create policy ler on public.crm_produto_hist for select to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));

-- Com o CRM dono do cadastro, o que não vem de crm_produto_gravar (a listagem do FKN pelo crm-notas) não mexe em crm_estoque.
create or replace function public.crm_estoque_guarda() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.crm_produtos_do_crm() and coalesce(current_setting('crm.cadastro', true), '') <> '1' then
    return null; -- ignora a linha (insert, update ou delete)
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists crm_estoque_guarda on public.crm_estoque;
create trigger crm_estoque_guarda before insert or update or delete on public.crm_estoque for each row execute function public.crm_estoque_guarda();

-- A conferência CRM × FKN da listagem perde o sentido com o CRM dono (o FKN para de ser atualizado).
create or replace function public.crm_estoque_foto(p_gerado timestamp with time zone, p_linhas integer) returns jsonb language plpgsql security definer set search_path = public as $$
declare fid bigint; r jsonb;
begin
  if not (public.crm_eh_admin() or public.crm_eh_comprador() or coalesce(auth.role(), '') = 'service_role') then raise exception 'só o administrador ou o comprador'; end if;
  if public.crm_produtos_do_crm() then return jsonb_build_object('foto', null, 'conferencia', null, 'ignorada', 'o cadastro e o estoque são do CRM'); end if;
  insert into public.crm_estoque_fotos (gerado_em, linhas) values (coalesce(p_gerado, now()), p_linhas) returning id into fid;
  perform public.crm_estoque_fatores();
  r := public.crm_estoque_conferir(fid);
  return jsonb_build_object('foto', fid, 'conferencia', r);
end;
$$;

-- Liga a chave (só o administrador). Não tem volta pela tela: é a virada.
create or replace function public.crm_produtos_passar_ao_crm() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.crm_eh_admin() then raise exception 'só o administrador passa o cadastro para o CRM'; end if;
  if public.crm_produtos_do_crm() then return jsonb_build_object('ok', true, 'ja', true); end if;
  insert into public.crm_sistema (chave, valor) values ('produtos_dono', 'crm') on conflict (chave) do update set valor = 'crm', quem = auth.uid(), quando = now();
  insert into public.crm_produto_hist (codigo, acao, depois) values ('*', 'dono', jsonb_build_object('produtos_dono', 'crm'));
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.crm_produtos_passar_ao_crm() to authenticated;

-- Grava um produto (novo ou alterado). p_dados: descricao, unidade, situacao (ATIVO/INATIVO), linha, familia,
-- fornecedor_cod, estoque_min, estoque_max, preco_venda, localizacao, custo_unit e custo_compra (só administrador e
-- comprador), ncm, cest, gtin, origem, modelo (código de um produto com a mesma tributação: a regra fiscal é copiada
-- dele) e novo = true para cadastrar.
create or replace function public.crm_produto_gravar(p_codigo text, p_dados jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare cod text := upper(btrim(coalesce(p_codigo, ''))); d jsonb := coalesce(p_dados, '{}'::jsonb);
  novo boolean := coalesce((d ->> 'novo')::boolean, false); custo boolean := public.crm_eh_admin() or public.crm_eh_comprador();
  e public.crm_estoque; antes jsonb; modelo_f public.crm_fiscal_produtos; fn text; v text; n numeric;
begin
  if not (custo or public.crm_eh_logistica()) then raise exception 'só o administrador, o comprador e a logística cadastram produto'; end if;
  if not public.crm_produtos_do_crm() then raise exception 'o cadastro ainda é do FKN: o administrador passa para o CRM em Produtos ("Passar o cadastro para o CRM")'; end if;
  if cod = '' or cod !~ '^[A-Z0-9][A-Z0-9.\-]{0,19}$' then raise exception 'código inválido (letras, números, ponto ou traço; até 20)'; end if;
  if (custo is false) and (d ? 'custo_unit' or d ? 'custo_compra') then raise exception 'o custo só o administrador e o comprador mudam'; end if;
  select * into e from public.crm_estoque where codigo = cod;
  if novo and e.codigo is not null then raise exception 'já existe um produto com o código %', cod; end if;
  if not novo and e.codigo is null then raise exception 'produto % não encontrado', cod; end if;
  if novo and exists (select 1 from public.crm_estoque_saldo where codigo = cod) then raise exception 'o código % já foi usado no estoque', cod; end if;
  antes := case when novo then null else to_jsonb(e) end;
  -- validações
  if novo or d ? 'descricao' then
    v := btrim(coalesce(d ->> 'descricao', ''));
    if length(v) < 3 or length(v) > 120 then raise exception 'descrição com 3 a 120 letras'; end if;
  end if;
  if novo or d ? 'unidade' then
    v := upper(btrim(coalesce(d ->> 'unidade', '')));
    if v !~ '^[A-Z0-9]{1,6}$' then raise exception 'unidade inválida (ex.: UN, CX, FD, GL, PCT)'; end if;
  end if;
  if d ? 'situacao' and coalesce(d ->> 'situacao', '') not in ('ATIVO', 'INATIVO') then raise exception 'situação: ATIVO ou INATIVO'; end if;
  foreach v in array array['preco_venda', 'estoque_min', 'estoque_max', 'custo_unit', 'custo_compra'] loop
    if d ? v and nullif(d ->> v, '') is not null then
      begin n := (d ->> v)::numeric; exception when others then raise exception '% inválido', v; end;
      if n < 0 then raise exception '% não pode ser negativo', v; end if;
    end if;
  end loop;
  if novo and coalesce(nullif(d ->> 'preco_venda', '')::numeric, 0) <= 0 then raise exception 'diga o preço de venda (tabela A)'; end if;
  if (novo or d ? 'ncm') and regexp_replace(coalesce(d ->> 'ncm', ''), '\D', '', 'g') !~ '^\d{8}$' then raise exception 'NCM com 8 números'; end if;
  if d ? 'cest' and nullif(regexp_replace(coalesce(d ->> 'cest', ''), '\D', '', 'g'), '') is not null and regexp_replace(d ->> 'cest', '\D', '', 'g') !~ '^\d{7}$' then raise exception 'CEST com 7 números'; end if;
  if d ? 'gtin' and nullif(regexp_replace(coalesce(d ->> 'gtin', ''), '\D', '', 'g'), '') is not null and regexp_replace(d ->> 'gtin', '\D', '', 'g') !~ '^(\d{8}|\d{12,14})$' then raise exception 'código de barras com 8, 12, 13 ou 14 números'; end if;
  if d ? 'origem' and coalesce(d ->> 'origem', '') !~ '^[0-8]$' then raise exception 'origem de 0 a 8'; end if;
  if d ? 'fornecedor_cod' and nullif(d ->> 'fornecedor_cod', '') is not null then
    select nome into fn from public.crm_fornecedores where codigo = d ->> 'fornecedor_cod';
    if fn is null then raise exception 'fornecedor % não cadastrado', d ->> 'fornecedor_cod'; end if;
  end if;
  -- a regra fiscal vem de um produto com a mesma tributação: no produto novo e, desde 23/10/2026, no produto que ainda não
  -- tem regra (532 ativos sem nota de venda em 2026: sem regra a nota não sai). Copia só a regra de venda: o ICMS-ST retido
  -- (st_ret, st_entrada) é de cada produto, aprendido das notas, e não serve para outro.
  if novo or (nullif(btrim(coalesce(d ->> 'modelo', '')), '') is not null
              and not exists (select 1 from public.crm_fiscal_produtos x where x.codigo = cod and x.regra ? 'venda')) then
    select * into modelo_f from public.crm_fiscal_produtos where codigo = upper(btrim(coalesce(d ->> 'modelo', ''))) and regra ? 'venda';
    if modelo_f.codigo is null then raise exception 'diga um produto com a mesma tributação e com regra fiscal (a regra é copiada dele)'; end if;
  end if;

  perform set_config('crm.cadastro', '1', true);
  if novo then
    insert into public.crm_estoque (codigo, descricao, unidade, situacao, linha, familia, fornecedor_cod, fornecedor, estoque_min, estoque_max,
        preco_venda, localizacao, custo_unit, custo_compra, quantidade, estoque_atual, custo_total, atualizado_em)
      values (cod, btrim(d ->> 'descricao'), upper(btrim(d ->> 'unidade')), coalesce(d ->> 'situacao', 'ATIVO'), nullif(btrim(coalesce(d ->> 'linha', '')), ''),
        nullif(btrim(coalesce(d ->> 'familia', '')), ''), nullif(d ->> 'fornecedor_cod', ''), fn, nullif(d ->> 'estoque_min', '')::numeric, nullif(d ->> 'estoque_max', '')::numeric,
        (d ->> 'preco_venda')::numeric, nullif(btrim(coalesce(d ->> 'localizacao', '')), ''), case when custo then nullif(d ->> 'custo_unit', '')::numeric end,
        case when custo then nullif(d ->> 'custo_compra', '')::numeric end, 0, 0, 0, now());
    insert into public.crm_estoque_saldo (codigo, descricao, unidade, saldo, custo_medio, inicio, atualizado_em)
      values (cod, btrim(d ->> 'descricao'), upper(btrim(d ->> 'unidade')), 0, case when custo then nullif(d ->> 'custo_unit', '')::numeric end, now(), now())
      on conflict (codigo) do nothing;
    insert into public.crm_fiscal_produtos (codigo, descricao, unidade, ncm, cest, gtin, origem, regra, alertas, situacao, criado_em, atualizado_em)
      values (cod, btrim(d ->> 'descricao'), upper(btrim(d ->> 'unidade')), regexp_replace(d ->> 'ncm', '\D', '', 'g'),
        coalesce(nullif(regexp_replace(coalesce(d ->> 'cest', ''), '\D', '', 'g'), ''), modelo_f.cest), nullif(regexp_replace(coalesce(d ->> 'gtin', ''), '\D', '', 'g'), ''),
        coalesce(nullif(d ->> 'origem', ''), modelo_f.origem, '0'), jsonb_build_object('venda', modelo_f.regra -> 'venda', 'revista', current_date::text, 'modelo', modelo_f.codigo),
        jsonb_build_array(jsonb_build_object('nivel', 'atencao', 'texto', 'Regra de venda copiada do produto ' || modelo_f.codigo || ' (mesma tributação) no cadastro.')), 'proposta', now(), now())
      on conflict (codigo) do nothing;
  else
    update public.crm_estoque set
      descricao = case when d ? 'descricao' then btrim(d ->> 'descricao') else descricao end,
      unidade = case when d ? 'unidade' then upper(btrim(d ->> 'unidade')) else unidade end,
      situacao = case when d ? 'situacao' then d ->> 'situacao' else situacao end,
      linha = case when d ? 'linha' then nullif(btrim(coalesce(d ->> 'linha', '')), '') else linha end,
      familia = case when d ? 'familia' then nullif(btrim(coalesce(d ->> 'familia', '')), '') else familia end,
      fornecedor_cod = case when d ? 'fornecedor_cod' then nullif(d ->> 'fornecedor_cod', '') else fornecedor_cod end,
      fornecedor = case when d ? 'fornecedor_cod' then fn else fornecedor end,
      estoque_min = case when d ? 'estoque_min' then nullif(d ->> 'estoque_min', '')::numeric else estoque_min end,
      estoque_max = case when d ? 'estoque_max' then nullif(d ->> 'estoque_max', '')::numeric else estoque_max end,
      preco_venda = case when d ? 'preco_venda' then nullif(d ->> 'preco_venda', '')::numeric else preco_venda end,
      localizacao = case when d ? 'localizacao' then nullif(btrim(coalesce(d ->> 'localizacao', '')), '') else localizacao end,
      custo_unit = case when custo and d ? 'custo_unit' then nullif(d ->> 'custo_unit', '')::numeric else custo_unit end,
      custo_compra = case when custo and d ? 'custo_compra' then nullif(d ->> 'custo_compra', '')::numeric else custo_compra end,
      atualizado_em = now()
     where codigo = cod;
    update public.crm_estoque_saldo set descricao = coalesce(case when d ? 'descricao' then btrim(d ->> 'descricao') end, descricao),
      unidade = coalesce(case when d ? 'unidade' then upper(btrim(d ->> 'unidade')) end, unidade) where codigo = cod;
    if d ? 'ncm' or d ? 'cest' or d ? 'gtin' or d ? 'origem' or d ? 'descricao' then
      update public.crm_fiscal_produtos set
        ncm = case when d ? 'ncm' then regexp_replace(d ->> 'ncm', '\D', '', 'g') else ncm end,
        cest = case when d ? 'cest' then nullif(regexp_replace(coalesce(d ->> 'cest', ''), '\D', '', 'g'), '') else cest end,
        gtin = case when d ? 'gtin' then nullif(regexp_replace(coalesce(d ->> 'gtin', ''), '\D', '', 'g'), '') else gtin end,
        origem = case when d ? 'origem' then d ->> 'origem' else origem end,
        descricao = case when d ? 'descricao' then btrim(d ->> 'descricao') else descricao end,
        atualizado_em = now()
       where codigo = cod;
    end if;
    if modelo_f.codigo is not null then   -- produto antigo sem regra: ganha a regra de venda do modelo
      insert into public.crm_fiscal_produtos (codigo, descricao, unidade, ncm, cest, gtin, origem, regra, alertas, situacao, criado_em, atualizado_em)
        values (cod, coalesce(nullif(btrim(coalesce(d ->> 'descricao', '')), ''), e.descricao), coalesce(nullif(upper(btrim(coalesce(d ->> 'unidade', ''))), ''), e.unidade),
          nullif(regexp_replace(coalesce(d ->> 'ncm', ''), '\D', '', 'g'), ''), coalesce(nullif(regexp_replace(coalesce(d ->> 'cest', ''), '\D', '', 'g'), ''), modelo_f.cest),
          nullif(regexp_replace(coalesce(d ->> 'gtin', ''), '\D', '', 'g'), ''), coalesce(nullif(d ->> 'origem', ''), modelo_f.origem, '0'),
          jsonb_build_object('venda', modelo_f.regra -> 'venda', 'revista', current_date::text, 'modelo', modelo_f.codigo), '[]'::jsonb, 'proposta', now(), now())
        on conflict (codigo) do update set
          regra = coalesce(public.crm_fiscal_produtos.regra, '{}'::jsonb) || jsonb_build_object('venda', modelo_f.regra -> 'venda', 'revista', current_date::text, 'modelo', modelo_f.codigo),
          ncm = coalesce(excluded.ncm, public.crm_fiscal_produtos.ncm), cest = coalesce(public.crm_fiscal_produtos.cest, excluded.cest), atualizado_em = now();
      update public.crm_fiscal_produtos set alertas = coalesce(alertas, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('nivel', 'atencao',
          'texto', 'Regra de venda copiada do produto ' || modelo_f.codigo || ' (mesma tributação) no cadastro.')) where codigo = cod;
    end if;
  end if;
  perform set_config('crm.cadastro', '', true);
  select * into e from public.crm_estoque where codigo = cod;
  insert into public.crm_produto_hist (codigo, acao, antes, depois) values (cod, case when novo then 'novo' else 'alterado' end, antes, to_jsonb(e));
  return jsonb_build_object('ok', true, 'codigo', cod, 'novo', novo);
end;
$$;
grant execute on function public.crm_produto_gravar(text, jsonb) to authenticated;

-- O que o formulário de edição mostra (a logística não lê crm_estoque, que tem custo): os campos do cadastro, com o custo
-- só para o administrador e o comprador.
create or replace function public.crm_produto_ler(p_codigo text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare custo boolean := public.crm_eh_admin() or public.crm_eh_comprador(); e public.crm_estoque; f public.crm_fiscal_produtos;
begin
  if not (custo or public.crm_eh_logistica()) then raise exception 'só o administrador, o comprador e a logística'; end if;
  select * into e from public.crm_estoque where codigo = upper(btrim(coalesce(p_codigo, '')));
  if e.codigo is null then return null; end if;
  select * into f from public.crm_fiscal_produtos where codigo = e.codigo;
  return jsonb_build_object('codigo', e.codigo, 'descricao', e.descricao, 'unidade', e.unidade, 'situacao', e.situacao, 'linha', e.linha, 'familia', e.familia,
    'fornecedor_cod', e.fornecedor_cod, 'fornecedor', e.fornecedor, 'estoque_min', e.estoque_min, 'estoque_max', e.estoque_max, 'preco_venda', e.preco_venda,
    'localizacao', e.localizacao, 'ncm', f.ncm, 'cest', f.cest, 'gtin', f.gtin, 'origem', f.origem, 'tem_regra', coalesce(f.regra ? 'venda', false),
    'custo_unit', case when custo then e.custo_unit end, 'custo_compra', case when custo then e.custo_compra end, 'dono_crm', public.crm_produtos_do_crm());
end;
$$;
grant execute on function public.crm_produto_ler(text) to authenticated;

-- Sugestão de código para o produto novo: o maior código só de números + 1 (os do FKN são assim).
create or replace function public.crm_produto_proximo_codigo() returns text language sql stable security definer set search_path = public as $$
  select (coalesce(max(codigo::bigint), 0) + 1)::text from public.crm_estoque where codigo ~ '^\d{1,12}$' and (public.crm_eh_admin() or public.crm_eh_comprador() or public.crm_eh_logistica());
$$;
grant execute on function public.crm_produto_proximo_codigo() to authenticated;

-- Embalagem do produto (quantas unidades vêm na caixa, no fardo…): administrador, comprador e logística (a tabela só deixa
-- administrador e comprador gravarem direto).
create or replace function public.crm_produto_embalagem(p_codigo text, p_unidade text, p_fator numeric) returns jsonb language plpgsql security definer set search_path = public as $$
declare cod text := upper(btrim(coalesce(p_codigo, ''))); un text := upper(btrim(coalesce(p_unidade, '')));
begin
  if not (public.crm_eh_admin() or public.crm_eh_comprador() or public.crm_eh_logistica()) then raise exception 'só o administrador, o comprador e a logística'; end if;
  if un !~ '^[A-Z0-9]{1,6}$' then raise exception 'embalagem inválida (ex.: CX, FD, PCT)'; end if;
  if not (coalesce(p_fator, 0) > 0) then raise exception 'diga quantas unidades vêm na embalagem'; end if;
  if not exists (select 1 from public.crm_estoque where codigo = cod) then raise exception 'produto % não encontrado', cod; end if;
  insert into public.crm_estoque_unidades (codigo, unidade, fator, origem, atualizado_em) values (cod, un, p_fator, 'manual', now())
    on conflict (codigo, unidade) do update set fator = excluded.fator, origem = 'manual', atualizado_em = now();
  insert into public.crm_produto_hist (codigo, acao, depois) values (cod, 'alterado', jsonb_build_object('embalagem', un, 'fator', p_fator));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.crm_produto_embalagem(text, text, numeric) from public, anon;
grant execute on function public.crm_produto_embalagem(text, text, numeric) to authenticated;

-- "Chegou" da logística (22/10/2026, virada): a mercadoria da nota de compra chegou no galpão, conferida com a nota; a
-- observação (faltou, veio a mais, avaria) vai para o comprador, que dá a entrada pelo XML. Só enquanto a nota está pendente.
-- O guia do Clean conta as chegadas para o comprador (crm_turma_resumo, bloco compras_galpao).
alter table public.crm_compras add column if not exists chegou_em timestamptz;
alter table public.crm_compras add column if not exists chegou_por uuid;
alter table public.crm_compras add column if not exists chegou_obs text;
create or replace function public.crm_compra_chegou(p_id uuid, p_obs text, p_desfazer boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.crm_compras;
begin
  if not public.crm_eh_estoque_op() then raise exception 'só a logística, o comprador e o administrador'; end if;
  select * into c from public.crm_compras where id = p_id for update;
  if c.id is null then raise exception 'nota de compra não encontrada'; end if;
  if c.situacao <> 'pendente' then raise exception 'a nota já não está esperando entrada'; end if;
  if coalesce(p_desfazer, false) then
    update public.crm_compras set chegou_em = null, chegou_por = null, chegou_obs = null, atualizado_em = now() where id = p_id;
  else
    update public.crm_compras set chegou_em = now(), chegou_por = auth.uid(), chegou_obs = nullif(btrim(coalesce(p_obs, '')), ''), atualizado_em = now() where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.crm_compra_chegou(uuid, text, boolean) from public, anon;
grant execute on function public.crm_compra_chegou(uuid, text, boolean) to authenticated;
create or replace function public.crm_compras_chegadas() returns table(id uuid, chegou_em timestamptz, chegou_nome text, chegou_obs text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_eh_estoque_op() then raise exception 'sem acesso ao estoque'; end if;
  return query select c.id, c.chegou_em, u.nome, c.chegou_obs from public.crm_compras c left join public.crm_usuarios u on u.user_id = c.chegou_por
    where c.chegou_em is not null and c.situacao = 'pendente';
end;
$$;
revoke all on function public.crm_compras_chegadas() from public, anon;
grant execute on function public.crm_compras_chegadas() to authenticated;

-- Fotos e fichas também pela logística (22/10/2026, virada: decisão do Anderson): aprovar o que a IA achou, buscar um
-- produto, subir ou tirar a foto e editar a ficha. Essas tabelas e o bucket não têm custo; a busca em lote e o gasto da IA
-- continuam só com o administrador e o comprador (tela e crm-produto-buscar).
create or replace function public.crm_cuida_fotos() returns boolean language sql stable security definer set search_path = public as $$
  select public.crm_eh_admin() or public.crm_eh_comprador() or public.crm_eh_logistica();
$$;
grant execute on function public.crm_cuida_fotos() to authenticated;
alter policy grava on public.crm_produto_fotos with check ((select public.crm_cuida_fotos()));
alter policy muda on public.crm_produto_fotos using ((select public.crm_cuida_fotos())) with check ((select public.crm_cuida_fotos()));
alter policy tira on public.crm_produto_fotos using ((select public.crm_cuida_fotos()));
alter policy tudo on public.crm_produto_fotos_sugestoes using ((select public.crm_cuida_fotos())) with check ((select public.crm_cuida_fotos()));
alter policy grava on public.crm_produto_info with check ((select public.crm_cuida_fotos()));
alter policy muda on public.crm_produto_info using ((select public.crm_cuida_fotos())) with check ((select public.crm_cuida_fotos()));
alter policy "crm fotos grava" on storage.objects with check (bucket_id = 'crm-produtos-fotos' and (select public.crm_cuida_fotos()));
alter policy "crm fotos muda" on storage.objects using (bucket_id = 'crm-produtos-fotos' and (select public.crm_cuida_fotos()));
alter policy "crm fotos tira" on storage.objects using (bucket_id = 'crm-produtos-fotos' and (select public.crm_cuida_fotos()));
alter policy "crm fotos le" on storage.objects using (bucket_id = 'crm-produtos-fotos' and (select public.crm_cuida_fotos()));

-- "Teve problema" na entrega (22/10/2026, virada): além da logística, a vendedora da nota (ou a dona da carteira) recebe uma
-- tarefa para falar com o cliente. Só na primeira vez que a entrega vira "problema" (confirmar de novo não repete a tarefa).
create or replace function public.crm_entrega_confirmar(p_id uuid, p_situacao text, p_obs text, p_canhoto text)
returns public.crm_entregas language plpgsql security definer set search_path = public as $$
declare r public.crm_entregas; antes text; quem uuid; nf integer; cli text;
begin
  select * into r from public.crm_entregas where id = p_id;
  if not found then raise exception 'entrega não encontrada'; end if;
  if not (r.motorista_id = auth.uid() or public.crm_eh_gestor() or public.crm_eh_logistica()) then raise exception 'esta entrega não é sua'; end if;
  if p_situacao not in ('entregue', 'problema') then raise exception 'situação inválida'; end if;
  if coalesce(btrim(p_canhoto), '') = '' or p_canhoto not like 'canhotos/%' then raise exception 'falta a foto do canhoto'; end if;
  if p_situacao = 'problema' and coalesce(btrim(p_obs), '') = '' then raise exception 'conte o que aconteceu na observação'; end if;
  antes := r.situacao;
  update public.crm_entregas set situacao = p_situacao, obs = nullif(btrim(coalesce(p_obs, '')), ''), canhoto = p_canhoto,
    entregue_em = coalesce(entregue_em, now()), entregue_por = auth.uid()
   where id = p_id returning * into r;
  if p_situacao = 'problema' and antes is distinct from 'problema' then
    select coalesce(n.vendedor_id, e.responsavel_id), n.numero, e.nome into quem, nf, cli
      from public.crm_notas n left join public.crm_empresas e on e.id = coalesce(r.empresa_id, n.empresa_id) where n.id = r.nota_id;
    if quem is not null then
      insert into public.crm_atividades (empresa_id, responsavel_id, tipo, descricao, data_hora, automatica, criado_por)
      values (r.empresa_id, quem, 'tarefa', 'Entrega com problema' || coalesce(' (NF ' || nf || ')', '') || ': ' || r.obs ||
        '. Fale com o cliente' || coalesce(' ' || cli, '') || ' e combine com a logística.', now(), true, auth.uid());
    end if;
  end if;
  return r;
end $$;

-- Compras → contas a pagar (22/10/2026, virada). Com o CRM dono (crm_sistema.produtos_dono = 'crm'), ao dar a entrada na
-- nota de compra, cada parcela da nota (duplicatas do XML) vira uma conta aberta no Caixa, no mesmo formato das que vinham do
-- FKN ("FORNECEDOR · nota-parcela", categoria Fornecedores). Antes da virada não faz nada: as contas vêm do Sifn083.
-- Nota sem parcelas: uma conta só com o total e vencimento na emissão, marcada para conferir. (origem 'tela': ampliar o
-- check de origem pediria drop constraint; a ligação é compra_id.)
alter table public.crm_fin_lancamentos add column if not exists compra_id uuid references public.crm_compras(id) on delete set null;
create unique index if not exists crm_fin_lanc_compra_uq on public.crm_fin_lancamentos (compra_id, parcela) where compra_id is not null;
create or replace function public.crm_compra_pagar() returns trigger language plpgsql security definer set search_path = public as $$
declare p jsonb; k int; i int := 0; forn text; num text;
begin
  if not public.crm_produtos_do_crm() then return new; end if;
  if new.situacao <> 'lancada' or old.situacao = 'lancada' then return new; end if;
  if exists (select 1 from public.crm_fin_lancamentos where compra_id = new.id) then return new; end if;
  forn := coalesce(nullif(btrim(new.fornecedor_nome), ''), 'Fornecedor');
  num := coalesce(new.numero::text, '?');
  k := jsonb_array_length(coalesce(new.parcelas, '[]'::jsonb));
  if k = 0 then
    insert into public.crm_fin_lancamentos (tipo, descricao, fornecedor, categoria, valor, vencimento, origem, compra_id, parcela, parcelas, titulo_duplicata, observacoes)
    values ('saida', forn || ' · ' || num, forn, 'Fornecedores', coalesce(new.valor_total, 0), coalesce((new.emitida_em at time zone 'America/Sao_Paulo')::date, current_date),
      'tela', new.id, 1, 1, num, 'A nota de compra não traz as parcelas: confira o vencimento com o boleto do fornecedor.');
    return new;
  end if;
  for p in select value from jsonb_array_elements(new.parcelas) loop
    i := i + 1;
    insert into public.crm_fin_lancamentos (tipo, descricao, fornecedor, categoria, valor, vencimento, origem, compra_id, parcela, parcelas, titulo_duplicata)
    values ('saida', forn || ' · ' || num || '-' || lpad(coalesce(p->>'n', i::text), 2, '0'), forn, 'Fornecedores', coalesce((p->>'valor')::numeric, 0),
      coalesce(nullif(p->>'vencimento', '')::date, (new.emitida_em at time zone 'America/Sao_Paulo')::date, current_date),
      'tela', new.id, i, k, num || '-' || lpad(coalesce(p->>'n', i::text), 2, '0'))
    on conflict do nothing;
  end loop;
  return new;
end;
$$;
drop trigger if exists crm_compras_pagar on public.crm_compras;
create trigger crm_compras_pagar after update of situacao on public.crm_compras for each row execute function public.crm_compra_pagar();
-- O FKN desligado na virada: o lembrete de puxar os relatórios some (crm_fkn_situacao.desligado) e a crm-notas ignora os
-- relatórios do FKN (registra "ignorado").
create or replace function public.crm_fkn_situacao() returns jsonb language sql stable security definer set search_path = public as $$
  with u as (select (select max(atualizado_em) from public.crm_estoque) estoque, (select max(atualizado_em) from public.crm_titulos) receber,
                    greatest((select max(quando) from public.crm_integracao_log where erros = 0 and resumo->>'fkn' like 'Contas a pagar do FKN:%'),
                             (select max(atualizado_em) from public.crm_fin_lancamentos where chave_fkn is not null)) pagar),
  r as (select distinct on (resumo->>'fkn_tipo') resumo->>'fkn_tipo' tipo, resumo->>'fkn_recusa' texto, resumo->>'arquivo' arquivo, quando
          from public.crm_integracao_log where resumo ? 'fkn_recusa' order by resumo->>'fkn_tipo', quando desc)
  select jsonb_build_object('estoque', u.estoque, 'receber', case when public.crm_eh_admin() then u.receber end,
    'pagar', case when public.crm_eh_admin() then u.pagar end,
    'desligado', public.crm_produtos_do_crm(),
    'recusas', coalesce((select jsonb_agg(jsonb_build_object('tipo', r.tipo, 'texto', r.texto, 'arquivo', r.arquivo, 'quando', r.quando))
                           from r where r.quando > coalesce(case r.tipo when 'produtos' then u.estoque when 'pagar' then u.pagar else u.receber end, '-infinity'::timestamptz)
                            and (r.tipo = 'produtos' or public.crm_eh_admin())), '[]'::jsonb))
    from u where public.crm_eh_admin() or public.crm_eh_comprador();
$$;

-- Baixa do contas a receber sem o FKN (22/10/2026, virada). Rodado pelo Anderson no SQL Editor (o conector trava delete).
-- Até a virada, quem tira o título pago de crm_titulos é a listagem do FKN. Com o CRM dono (crm_sistema.produtos_dono = 'crm'),
-- o "Recebi" do Caixa (lançamento de entrada pago com titulo_duplicata) dá a baixa: valor igual ou maior que o do título
-- (juros) → o título sai; menor → o título fica com o que falta. Fica uma cópia em crm_titulos_recebidos e o "Desfazer a
-- baixa" (ou excluir o lançamento) devolve o título. Antes da virada não muda nada.
create table if not exists public.crm_titulos_recebidos (
  lancamento_id uuid primary key,
  duplicata     text not null,
  dados         jsonb not null,
  parcial       boolean not null default false,
  quando        timestamptz not null default now()
);
alter table public.crm_titulos_recebidos enable row level security;
drop policy if exists so_admin on public.crm_titulos_recebidos;
create policy so_admin on public.crm_titulos_recebidos for select to authenticated using ((select public.crm_eh_admin()));
revoke all on public.crm_titulos_recebidos from anon, public;

create or replace function public.crm_titulo_baixa_caixa() returns trigger language plpgsql security definer set search_path = public as $$
declare t public.crm_titulos; c public.crm_titulos_recebidos; pagoAgora boolean; pagoAntes boolean;
begin
  pagoAgora := tg_op <> 'DELETE' and new.tipo = 'entrada' and new.situacao = 'pago' and new.titulo_duplicata is not null;
  pagoAntes := tg_op <> 'INSERT' and old.tipo = 'entrada' and old.situacao = 'pago' and old.titulo_duplicata is not null;
  -- desfeito (ou excluído): devolve o título como estava
  if pagoAntes and not (pagoAgora and new.titulo_duplicata = old.titulo_duplicata) then
    select * into c from public.crm_titulos_recebidos where lancamento_id = old.id;
    if c.lancamento_id is not null then
      if c.parcial then
        update public.crm_titulos set valor = (c.dados->>'valor')::numeric where duplicata = c.duplicata;
      else
        insert into public.crm_titulos select * from jsonb_populate_record(null::public.crm_titulos, c.dados) on conflict do nothing;
      end if;
      delete from public.crm_titulos_recebidos where lancamento_id = old.id;
    end if;
  end if;
  if pagoAgora and not (pagoAntes and new.titulo_duplicata = old.titulo_duplicata) and public.crm_produtos_do_crm() then
    select * into t from public.crm_titulos where duplicata = new.titulo_duplicata;
    if t.id is not null then
      insert into public.crm_titulos_recebidos (lancamento_id, duplicata, dados, parcial)
      values (new.id, t.duplicata, to_jsonb(t), new.valor < t.valor - 0.01)
      on conflict (lancamento_id) do nothing;
      if new.valor < t.valor - 0.01 then
        update public.crm_titulos set valor = round(t.valor - new.valor, 2) where id = t.id;
      else
        delete from public.crm_titulos where id = t.id;
      end if;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.crm_titulo_baixa_caixa() from public, anon, authenticated;
drop trigger if exists crm_fin_lanc_baixa_titulo on public.crm_fin_lancamentos;
create trigger crm_fin_lanc_baixa_titulo after insert or update of situacao, titulo_duplicata, valor or delete on public.crm_fin_lancamentos
  for each row execute function public.crm_titulo_baixa_caixa();

-- ============================================================================================================
-- Fase 4b (22/10/2026, virada): notas que não são venda. Regras e fontes em docs/fase4b-regras.md.
-- Rascunho de cada nota (tipo, nota de origem, itens, motivo); a emissão reserva o número ligado ao rascunho e, autorizada
-- em produção, os efeitos das devoluções rodam uma vez só (crm_nfe_outra_efeitos).
create table if not exists public.crm_nfe_outras (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in ('devolucao_fornecedor', 'devolucao_cliente', 'bonificacao', 'faturamento_futuro', 'remessa_futura')),
  ref_chave     text check (ref_chave is null or ref_chave ~ '^\d{44}$'),
  compra_id     uuid references public.crm_compras(id) on delete set null,
  nota_id       uuid references public.crm_notas(id) on delete set null,
  pedido_id     uuid references public.crm_pedidos(id) on delete set null,
  empresa_id    uuid references public.crm_empresas(id) on delete set null,
  itens         jsonb not null default '[]'::jsonb,
  motivo        text,
  situacao      text not null default 'rascunho' check (situacao in ('rascunho', 'emitida', 'cancelada')),
  nfe_id        uuid references public.crm_nfe(id) on delete set null,
  efeitos_em    timestamptz,
  efeitos       jsonb,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists crm_nfe_outras_ref on public.crm_nfe_outras (ref_chave);
alter table public.crm_nfe_outras enable row level security;
drop policy if exists ler on public.crm_nfe_outras;
create policy ler on public.crm_nfe_outras for select to authenticated using ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()) or (select public.crm_eh_comprador()));
drop policy if exists grava on public.crm_nfe_outras;
create policy grava on public.crm_nfe_outras for insert to authenticated with check (((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()) or (select public.crm_eh_comprador())) and situacao = 'rascunho');
drop policy if exists muda on public.crm_nfe_outras;
create policy muda on public.crm_nfe_outras for update to authenticated using (((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()) or (select public.crm_eh_comprador())) and situacao = 'rascunho')
  with check (situacao = 'rascunho');
drop trigger if exists crm_nfe_outras_atualizado_em on public.crm_nfe_outras;
create trigger crm_nfe_outras_atualizado_em before update on public.crm_nfe_outras for each row execute function public.crm_toca_atualizado_em();
alter table public.crm_nfe add column if not exists outra_id uuid references public.crm_nfe_outras(id) on delete set null;
alter table public.crm_nfe add column if not exists tipo text not null default 'venda';

-- Reserva do número para a nota que não é venda (rejeitada ou bloqueada tenta de novo no mesmo número). A remessa da entrega
-- futura e a bonificação fecham o pedido (pedido_id); o faturamento não.
create or replace function public.crm_nfe_reservar_outra(p_ambiente text, p_serie integer, p_outra uuid) returns public.crm_nfe
language plpgsql security definer set search_path = public as $$
declare r public.crm_nfe; o public.crm_nfe_outras; n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'só o serviço fiscal reserva número'; end if;
  if p_ambiente not in ('homologacao', 'producao') then raise exception 'ambiente inválido'; end if;
  select * into o from public.crm_nfe_outras where id = p_outra;
  if o.id is null then raise exception 'rascunho da nota não encontrado'; end if;
  perform pg_advisory_xact_lock(hashtext('crm_nfe:' || p_ambiente || ':' || p_serie));
  select * into r from public.crm_nfe where outra_id = p_outra and ambiente = p_ambiente and situacao in ('autorizada', 'pendente', 'reservada', 'rejeitada', 'bloqueada')
     and inutilizada_em is null and (p_ambiente = 'producao' or situacao <> 'autorizada')
   order by criado_em desc limit 1;
  if r.id is not null then
    if r.situacao = 'autorizada' then raise exception 'esta nota já foi autorizada (NF %)', r.numero; end if;
    if r.situacao = 'pendente' then raise exception 'a NF % ficou sem resposta da Sefaz: consulte antes de emitir de novo', r.numero; end if;
    update public.crm_nfe set tentativas = tentativas + 1, atualizado_em = now() where id = r.id returning * into r;
    return r;
  end if;
  insert into public.crm_nfe_numeracao (ambiente, serie) values (p_ambiente, p_serie) on conflict do nothing;
  update public.crm_nfe_numeracao set proximo = proximo + 1 where ambiente = p_ambiente and serie = p_serie returning proximo - 1 into n;
  insert into public.crm_nfe (ambiente, serie, numero, outra_id, tipo, pedido_id, empresa_id, situacao, tentativas)
  values (p_ambiente, p_serie, n, p_outra, o.tipo, case when o.tipo in ('remessa_futura', 'bonificacao') then o.pedido_id end, o.empresa_id, 'reservada', 1) returning * into r;
  return r;
end;
$$;
revoke all on function public.crm_nfe_reservar_outra(text, integer, uuid) from public, anon, authenticated;
grant execute on function public.crm_nfe_reservar_outra(text, integer, uuid) to service_role;

-- Efeitos da devolução autorizada em produção (uma vez só). Bonificação, faturamento e remessa entram como as notas de venda.
--   a fornecedor: saída do estoque (quantidade × fator do item da compra) e abatimento no contas a pagar daquela compra (da
--                 última parcela aberta para a primeira); a sobra vira "a receber do fornecedor".
--   de cliente:   entrada no estoque ao custo médio do momento e abatimento nos títulos da venda (o zerado fica com abono); a
--                 sobra vira "devolver ao cliente" no Caixa.
create or replace function public.crm_nfe_outra_efeitos(p_nfe uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare n public.crm_nfe; o public.crm_nfe_outras; c public.crm_compras; x jsonb; ci record; it jsonb; l record; t record;
  q numeric; f numeric; un text; cod text; resto numeric; nmov int := 0; abat numeric := 0; vnota record; r jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.crm_eh_admin() then raise exception 'só o serviço fiscal'; end if;
  select * into n from public.crm_nfe where id = p_nfe;
  if n.id is null or n.outra_id is null then return jsonb_build_object('ok', false, 'motivo', 'não é nota de outra operação'); end if;
  if n.ambiente <> 'producao' or n.situacao <> 'autorizada' then return jsonb_build_object('ok', false, 'motivo', 'só nota autorizada em produção'); end if;
  select * into o from public.crm_nfe_outras where id = n.outra_id for update;
  if o.efeitos_em is not null then return jsonb_build_object('ok', true, 'ja', true); end if;
  resto := coalesce(n.valor, 0);
  if o.tipo = 'devolucao_fornecedor' then
    select * into c from public.crm_compras where chave = o.ref_chave;
    for x in select value from jsonb_array_elements(o.itens) loop
      select * into ci from public.crm_compra_itens where compra_id = c.id and ordem = (x->>'nItem')::int;
      if ci.id is null or ci.codigo is null or c.situacao <> 'lancada' then continue; end if;   -- sem entrada no estoque, nada a tirar
      q := round((x->>'quantidade')::numeric * coalesce(ci.fator, 1), 3);
      insert into public.crm_estoque_mov (codigo, quando, tipo, quantidade, qtd_doc, unidade_doc, fator, motivo, criado_por)
      values (ci.codigo, now(), 'saida', -q, (x->>'quantidade')::numeric, public.crm_un(ci.unidade), coalesce(ci.fator, 1),
        left('Devolução ao fornecedor NF ' || n.numero || ' (compra ' || coalesce(c.numero::text, '?') || ')', 200), n.criado_por);
      nmov := nmov + 1;
    end loop;
    for l in select id, valor from public.crm_fin_lancamentos where compra_id = c.id and situacao = 'aberto' and tipo = 'saida' order by vencimento desc loop
      exit when resto <= 0;
      if l.valor <= resto then
        update public.crm_fin_lancamentos set situacao = 'pago', pago_em = current_date, baixa = 'fora', baixado_em = now(),
          observacoes = concat_ws(' ', observacoes, 'Abatido pela devolução NF ' || n.numero || '.') where id = l.id;
        abat := abat + l.valor; resto := round(resto - l.valor, 2);
      else
        update public.crm_fin_lancamentos set valor = round(valor - resto, 2), observacoes = concat_ws(' ', observacoes, 'R$ ' || resto || ' abatidos pela devolução NF ' || n.numero || '.') where id = l.id;
        abat := abat + resto; resto := 0;
      end if;
    end loop;
    if resto > 0 then
      insert into public.crm_fin_lancamentos (tipo, descricao, fornecedor, categoria, valor, vencimento, origem, observacoes)
      values ('entrada', 'A receber do fornecedor: devolução NF ' || n.numero, c.fornecedor_nome, 'Outras entradas', resto, current_date + 30, 'tela',
        'Devolução da compra ' || coalesce(c.numero::text, '?') || ' sem conta aberta para abater: combinar com o fornecedor (crédito ou depósito).');
    end if;
  elsif o.tipo = 'devolucao_cliente' then
    for it in select value from jsonb_array_elements(coalesce(n.nota->'itens', '[]'::jsonb)) loop
      cod := regexp_replace(coalesce(it->>'codigo', ''), '\.\d+$', '');
      if cod = '' or not exists (select 1 from public.crm_estoque_saldo where codigo = cod) then continue; end if;
      un := public.crm_un(it->>'unidade');
      select u.fator into f from public.crm_estoque_unidades u where u.codigo = cod and u.unidade = un;
      q := round((it->>'quantidade')::numeric * coalesce(f, 1), 3);
      insert into public.crm_estoque_mov (codigo, quando, tipo, quantidade, custo_unit, qtd_doc, unidade_doc, fator, motivo, criado_por)
      select cod, now(), 'entrada', q, s.custo_medio, (it->>'quantidade')::numeric, un, coalesce(f, 1),
        left('Devolução do cliente NF ' || n.numero, 200), n.criado_por from public.crm_estoque_saldo s where s.codigo = cod;
      nmov := nmov + 1;
    end loop;
    select numero, serie into vnota from public.crm_notas where chave = o.ref_chave;
    -- os títulos da venda pela duplicata, com a série (23/10/2026: pelo número só, a devolução da nota 2-12 abateria os títulos
    -- da nota 12 do FKN, de outro cliente)
    for t in select id, valor from public.crm_titulos where split_part(duplicata, '/', 1) = (case when coalesce(nullif(vnota.serie, '')::int, 1) = 1 then lpad(vnota.numero::text, 6, '0') else vnota.serie::int || '-' || lpad(vnota.numero::text, 6, '0') end) and not abono order by vencimento desc loop
      exit when resto <= 0;
      if t.valor <= resto then
        update public.crm_titulos set abono = true where id = t.id;
        abat := abat + t.valor; resto := round(resto - t.valor, 2);
      else
        update public.crm_titulos set valor = round(valor - resto, 2) where id = t.id;
        abat := abat + resto; resto := 0;
      end if;
    end loop;
    if resto > 0 then
      insert into public.crm_fin_lancamentos (tipo, descricao, categoria, valor, vencimento, origem, observacoes)
      values ('saida', 'Devolver ao cliente: devolução NF ' || n.numero, 'Outras saídas', resto, current_date + 7, 'tela',
        'O cliente já tinha pago a venda: devolver o dinheiro ou deixar de crédito. Se ficar de crédito, exclua este lançamento.');
    end if;
  end if;
  r := jsonb_build_object('estoque', nmov, 'abatido', abat, 'sobra', resto);
  update public.crm_nfe_outras set efeitos_em = now(), efeitos = r where id = o.id;
  return r;
end;
$$;
revoke all on function public.crm_nfe_outra_efeitos(uuid) from public, anon, authenticated;
grant execute on function public.crm_nfe_outra_efeitos(uuid) to service_role;

-- Para montar a devolução: as notas com aquele número e os itens SÓ com as quantidades (a logística não vê custo), e quanto de
-- cada item já foi devolvido em nota emitida.
create or replace function public.crm_nfe_outra_origem(p_tipo text, p_numero bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not (public.crm_eh_gestor() or public.crm_eh_logistica() or public.crm_eh_comprador()) then raise exception 'sem acesso'; end if;
  if p_tipo = 'devolucao_fornecedor' then
    select coalesce(jsonb_agg(jsonb_build_object('chave', c.chave, 'numero', c.numero, 'serie', c.serie, 'emitida_em', c.emitida_em, 'nome', c.fornecedor_nome,
      'doc', c.fornecedor_doc, 'situacao', c.situacao, 'compra_id', c.id,
      'itens', (select coalesce(jsonb_agg(jsonb_build_object('nItem', i.ordem, 'codigo', coalesce(i.codigo, i.cod_fornecedor), 'descricao', i.descricao, 'unidade', i.unidade,
          'quantidade', i.quantidade, 'devolvido', (select coalesce(sum((x->>'quantidade')::numeric), 0) from public.crm_nfe_outras o, jsonb_array_elements(o.itens) x
             where o.ref_chave = c.chave and o.situacao = 'emitida' and (x->>'nItem')::int = i.ordem)) order by i.ordem), '[]'::jsonb)
        from public.crm_compra_itens i where i.compra_id = c.id)) order by c.emitida_em desc), '[]'::jsonb) into r
    from public.crm_compras c where c.numero = p_numero;
  elsif p_tipo = 'devolucao_cliente' then
    select coalesce(jsonb_agg(jsonb_build_object('chave', n.chave, 'numero', n.numero, 'serie', n.serie, 'emitida_em', n.emitida_em, 'nome', n.cliente_nome,
      'doc', n.cliente_doc, 'empresa_id', n.empresa_id, 'nota_id', n.id, 'contribuinte', coalesce(n.dest_ind_ie, '') = '1', 'cancelada', n.cancelada,
      'itens', (select coalesce(jsonb_agg(jsonb_build_object('nItem', i.ordem, 'codigo', i.codigo, 'descricao', i.descricao, 'unidade', i.unidade, 'quantidade', i.quantidade,
          'devolvido', (select coalesce(sum((x->>'quantidade')::numeric), 0) from public.crm_nfe_outras o, jsonb_array_elements(o.itens) x
             where o.ref_chave = n.chave and o.situacao = 'emitida' and (x->>'nItem')::int = i.ordem)) order by i.ordem), '[]'::jsonb)
        from public.crm_nota_itens i where i.nota_id = n.id)) order by n.emitida_em desc), '[]'::jsonb) into r
    from public.crm_notas n where n.numero = p_numero;
  else raise exception 'tipo inválido'; end if;
  return r;
end;
$$;
revoke all on function public.crm_nfe_outra_origem(text, bigint) from public, anon;
grant execute on function public.crm_nfe_outra_origem(text, bigint) to authenticated;
-- crm_pedidos_casar_int (acima, Fase 3) ganhou em 22/10: a nota de simples faturamento (5922/6922) não fatura o pedido:
--   and exists (select 1 from public.crm_nota_itens ni where ni.nota_id = nt.id and coalesce(ni.cfop, '') not in ('5922', '6922'))

-- ============================================================ CRM dono do estoque (22/10/2026, virada)
-- Com a chave produtos_dono = crm, a listagem do FKN para de chegar e o saldo de crm_estoque (o que a Gestão, as Compras, as
-- Ofertas e a IA do comprador leem) ficaria parado. Cada movimento do livro (venda, compra, contagem, estorno) e cada pedido
-- que muda espelham o estoque do CRM em crm_estoque, como o FKN mostrava: estoque_atual = físico (saldo do livro),
-- pend_cliente = reservado (pedidos do CRM em aberto, separação ou separados), quantidade = físico − reservado, custo_total =
-- quantidade × custo médio; a caixa fechada (código .1, .2…) recebe o mesmo em caixas (÷ fator, sem fração). Na entrada de
-- compra: custo_compra = custo da nota (o "custo que subiu" segue pelo gatilho crm_estoque_custo), custo_unit = custo médio,
-- ult_entrada, e o pedido pendente que veio do FKN baixa pelo que entrou (os pedidos novos ficam em Pedidos ao fornecedor).
-- Na saída: ult_saida. Antes da chave, nada muda. crm_estoque_espelhar só copia o que já está no banco (nada vem de quem chama).
create or replace function public.crm_estoque_espelhar(p_codigo text) returns integer language plpgsql security definer set search_path = public as $$
declare ant text := current_setting('crm.cadastro', true); n integer := 0;
begin
  if not public.crm_produtos_do_crm() then return 0; end if;
  perform set_config('crm.cadastro', '1', true);
  with res as (
    select i->>'base' bs, sum((i->>'qtd_est')::numeric) q
      from public.crm_pedidos p cross join lateral jsonb_array_elements(p.itens) i
     where p.situacao in ('aberto', 'separacao', 'separado') and coalesce(i->>'base', '') <> ''
       and (p_codigo is null or i->>'base' = p_codigo) group by 1),
  alvo as (
    select s.codigo, s.saldo fis, coalesce(r.q, 0) rs, s.custo_medio cm
      from public.crm_estoque_saldo s left join res r on r.bs = s.codigo
     where p_codigo is null or s.codigo = p_codigo)
  update public.crm_estoque e set
    estoque_atual = a.fis, pend_cliente = a.rs, quantidade = a.fis - a.rs,
    custo_total = round(greatest(a.fis - a.rs, 0) * coalesce(a.cm, e.custo_unit, 0), 2), atualizado_em = now()
    from alvo a
   where a.codigo = e.codigo
     and (e.estoque_atual is distinct from a.fis or e.quantidade is distinct from a.fis - a.rs or e.pend_cliente is distinct from a.rs
          or e.custo_total is distinct from round(greatest(a.fis - a.rs, 0) * coalesce(a.cm, e.custo_unit, 0), 2));
  get diagnostics n = row_count;
  -- a caixa fechada: o mesmo estoque em caixas (÷ fator, sem fração)
  with res as (
    select i->>'base' bs, sum((i->>'qtd_est')::numeric) q
      from public.crm_pedidos p cross join lateral jsonb_array_elements(p.itens) i
     where p.situacao in ('aberto', 'separacao', 'separado') and coalesce(i->>'base', '') <> ''
       and (p_codigo is null or i->>'base' = p_codigo) group by 1)
  update public.crm_estoque c set
    estoque_atual = trunc(s.saldo / u.fator), pend_cliente = trunc(coalesce(r.q, 0) / u.fator),
    quantidade = trunc((s.saldo - coalesce(r.q, 0)) / u.fator),
    custo_total = round(greatest(s.saldo - coalesce(r.q, 0), 0) * coalesce(s.custo_medio, 0), 2), atualizado_em = now()
    from public.crm_estoque_saldo s join public.crm_estoque_unidades u on u.codigo = s.codigo and u.unidade = 'CX'
    left join res r on r.bs = s.codigo
   where c.codigo ~ '\.\d+$' and s.codigo = regexp_replace(c.codigo, '\.\d+$', '') and coalesce(u.fator, 0) > 0
     and (p_codigo is null or s.codigo = p_codigo)
     and (c.quantidade is distinct from trunc((s.saldo - coalesce(r.q, 0)) / u.fator) or c.estoque_atual is distinct from trunc(s.saldo / u.fator));
  perform set_config('crm.cadastro', coalesce(ant, ''), true);
  return n;
end;
$$;

-- No gatilho, o que depende do movimento: entrada de compra (custo da nota, custo médio, última entrada, pedido do FKN baixado)
-- e saída (última saída).
create or replace function public.crm_estoque_mov_espelho() returns trigger language plpgsql security definer set search_path = public as $$
declare ant text; dia date := (new.quando at time zone 'America/Sao_Paulo')::date;
begin
  if not public.crm_produtos_do_crm() then return null; end if;
  perform public.crm_estoque_espelhar(new.codigo);
  if (new.tipo = 'entrada' and new.quantidade > 0) or new.tipo = 'saida' then
    ant := current_setting('crm.cadastro', true);
    perform set_config('crm.cadastro', '1', true);
    if new.tipo = 'entrada' then
      update public.crm_estoque e set
        custo_compra = case when coalesce(new.custo_unit, 0) > 0 then round(new.custo_unit, 4) else e.custo_compra end,
        custo_unit = coalesce(nullif(s.custo_medio, 0), e.custo_unit),
        pend_fornecedor = greatest(coalesce(e.pend_fornecedor, 0) - new.quantidade, 0),
        ult_entrada = greatest(coalesce(e.ult_entrada, dia), dia), atualizado_em = now()
        from public.crm_estoque_saldo s where s.codigo = e.codigo and e.codigo = new.codigo;
    else
      update public.crm_estoque e set ult_saida = greatest(coalesce(e.ult_saida, dia), dia), atualizado_em = now() where e.codigo = new.codigo;
    end if;
    perform set_config('crm.cadastro', coalesce(ant, ''), true);
  end if;
  return null;
end;
$$;
-- o nome vem depois de crm_estoque_mov_saldo (os gatilhos rodam em ordem alfabética): o saldo já está atualizado
create or replace trigger crm_estoque_mov_zespelho after insert on public.crm_estoque_mov for each row execute function public.crm_estoque_mov_espelho();

create or replace function public.crm_pedidos_espelho() returns trigger language plpgsql security definer set search_path = public as $$
declare b text;
begin
  if not public.crm_produtos_do_crm() then return null; end if;
  if tg_op = 'UPDATE' and new.situacao is not distinct from old.situacao and new.itens is not distinct from old.itens then return null; end if;
  for b in
    select distinct x from (
      select i->>'base' x from jsonb_array_elements(coalesce(new.itens, '[]'::jsonb)) i
      union all
      select i->>'base' from jsonb_array_elements(case when tg_op = 'UPDATE' then coalesce(old.itens, '[]'::jsonb) else '[]'::jsonb end) i) t
     where coalesce(x, '') <> ''
  loop
    perform public.crm_estoque_espelhar(b);
  end loop;
  return null;
end;
$$;
create or replace trigger crm_pedidos_zespelho after insert or update on public.crm_pedidos for each row execute function public.crm_pedidos_espelho();

-- Ao passar o cadastro para o CRM, o espelho de todos os produtos de uma vez (o saldo do livro passa a valer na Gestão).
create or replace function public.crm_produtos_passar_ao_crm() returns jsonb language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.crm_eh_admin() then raise exception 'só o administrador passa o cadastro para o CRM'; end if;
  if public.crm_produtos_do_crm() then return jsonb_build_object('ok', true, 'ja', true); end if;
  insert into public.crm_sistema (chave, valor) values ('produtos_dono', 'crm') on conflict (chave) do update set valor = 'crm', quem = auth.uid(), quando = now();
  insert into public.crm_produto_hist (codigo, acao, depois) values ('*', 'dono', jsonb_build_object('produtos_dono', 'crm'));
  n := public.crm_estoque_espelhar(null);
  return jsonb_build_object('ok', true, 'espelhados', n);
end;
$$;

-- ============================================================ Devolução emitida pelo cliente (22/10/2026, virada)
-- Devolução emitida pelo cliente contribuinte (22/10/2026, virada): a nota chega pela Sefaz como uma compra (o cliente é o
-- emitente e a OneClean o destinatário). O CRM a marca (devolucao, ref_chave = a nossa nota de venda) e a entrada é outra:
-- volta ao estoque pelo CUSTO MÉDIO (não pelo valor da nota), não vira conta a pagar e abate os títulos da venda devolvida
-- (os mais distantes primeiro; o que sobrar, se o cliente já pagou, vira "Devolver ao cliente" no Caixa). efeitos guarda o que
-- foi feito.
alter table public.crm_compras add column if not exists devolucao boolean not null default false;
alter table public.crm_compras add column if not exists ref_chave text;
alter table public.crm_compras add column if not exists efeitos jsonb;

create or replace function public.crm_compra_pagar() returns trigger language plpgsql security definer set search_path = public as $$
declare p jsonb; k int; i int := 0; forn text; num text;
begin
  if not public.crm_produtos_do_crm() then return new; end if;
  if new.situacao <> 'lancada' or old.situacao = 'lancada' then return new; end if;
  if new.devolucao then return new; end if; -- devolução do cliente: não é conta a pagar (abate os títulos da venda)
  if exists (select 1 from public.crm_fin_lancamentos where compra_id = new.id) then return new; end if;
  forn := coalesce(nullif(btrim(new.fornecedor_nome), ''), 'Fornecedor');
  num := coalesce(new.numero::text, '?');
  k := jsonb_array_length(coalesce(new.parcelas, '[]'::jsonb));
  if k = 0 then
    insert into public.crm_fin_lancamentos (tipo, descricao, fornecedor, categoria, valor, vencimento, origem, compra_id, parcela, parcelas, titulo_duplicata, observacoes)
    values ('saida', forn || ' · ' || num, forn, 'Fornecedores', coalesce(new.valor_total, 0), coalesce((new.emitida_em at time zone 'America/Sao_Paulo')::date, current_date),
      'tela', new.id, 1, 1, num, 'A nota de compra não traz as parcelas: confira o vencimento com o boleto do fornecedor.');
    return new;
  end if;
  for p in select value from jsonb_array_elements(new.parcelas) loop
    i := i + 1;
    insert into public.crm_fin_lancamentos (tipo, descricao, fornecedor, categoria, valor, vencimento, origem, compra_id, parcela, parcelas, titulo_duplicata)
    values ('saida', forn || ' · ' || num || '-' || lpad(coalesce(p->>'n', i::text), 2, '0'), forn, 'Fornecedores', coalesce((p->>'valor')::numeric, 0),
      coalesce(nullif(p->>'vencimento', '')::date, (new.emitida_em at time zone 'America/Sao_Paulo')::date, current_date),
      'tela', new.id, i, k, num || '-' || lpad(coalesce(p->>'n', i::text), 2, '0'))
    on conflict do nothing;
  end loop;
  return new;
end;
$$;

create or replace function public.crm_compra_lancar(p_compra uuid, p_itens jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; it record; x jsonb; cod text; f numeric; q numeric; custo numeric; n integer := 0; ign integer := 0; agora timestamptz := now();
  v record; pre text; t record; resto numeric; abat numeric := 0; ntit integer := 0; ef jsonb := null;
begin
  if not public.crm_eh_estoque_op() then raise exception 'só o administrador, o comprador ou a logística'; end if;
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
    -- 23/10/2026: código fora do cadastro ("10087" digitado para o 010087) criava produto que não existe; caixa (.1) também não
    if cod ~ '\.\d+$' or not exists (select 1 from public.crm_estoque e where e.codigo = cod) then raise exception 'item % (%): o código % não está no cadastro de produtos (confira o zero da frente)', it.ordem, it.descricao, cod; end if;
    q := round(it.quantidade * f, 3);
    if q <= 0 then raise exception 'item % (%): quantidade zerada', it.ordem, it.descricao; end if;
    custo := round((it.valor_total + it.ipi + it.st + it.frete + it.outras) / q, 4);
    if c.devolucao then -- a mercadoria é nossa: volta pelo custo médio (não refaz o custo pelo preço de venda)
      custo := coalesce((select s.custo_medio from public.crm_estoque_saldo s where s.codigo = cod), custo);
    end if;
    insert into public.crm_estoque_saldo (codigo, descricao, unidade, inicio)
      select cod, coalesce(e.descricao, it.descricao), public.crm_un(coalesce(e.unidade, it.unidade)), agora - interval '1 second'
      from (select 1) u left join public.crm_estoque e on e.codigo = cod
      on conflict (codigo) do nothing;
    insert into public.crm_estoque_mov (codigo, quando, tipo, quantidade, custo_unit, qtd_doc, unidade_doc, fator, compra_item_id, motivo)
      values (cod, agora, 'entrada', q, custo, it.quantidade, public.crm_un(it.unidade), f, it.id,
        left(case when c.devolucao then 'Devolução do cliente NF ' else 'NF ' end || coalesce(c.numero::text, '?') || ' ' || coalesce(c.fornecedor_nome, ''), 200));
    update public.crm_compra_itens set codigo = cod, fator = f where id = it.id;
    if c.fornecedor_doc is not null and it.cod_fornecedor is not null then
      insert into public.crm_compra_vinculos (fornecedor_doc, cod_fornecedor, codigo, fator) values (c.fornecedor_doc, it.cod_fornecedor, cod, f)
        on conflict (fornecedor_doc, cod_fornecedor) do update set codigo = excluded.codigo, fator = excluded.fator, atualizado_em = now();
    end if;
    n := n + 1;
  end loop;
  if c.devolucao then
    resto := coalesce(c.valor_total, 0);
    select numero, serie into v from public.crm_notas where chave = c.ref_chave;
    if v.numero is null then
      ef := jsonb_build_object('sem_nota', true, 'abatido', 0, 'sobra', resto);
    else
      -- duplicata da nota (nfe.js: "002564/01"; fora da série 1, "2-000012/01")
      pre := case when coalesce(nullif(v.serie, '')::int, 1) = 1 then lpad(v.numero::text, 6, '0') else v.serie::int || '-' || lpad(v.numero::text, 6, '0') end;
      for t in select id, valor from public.crm_titulos where split_part(duplicata, '/', 1) = pre and not abono order by vencimento desc loop
        exit when resto <= 0;
        if t.valor <= resto then
          update public.crm_titulos set abono = true, atualizado_em = now() where id = t.id;
          abat := abat + t.valor; resto := round(resto - t.valor, 2);
        else
          update public.crm_titulos set valor = round(valor - resto, 2), atualizado_em = now() where id = t.id;
          abat := abat + resto; resto := 0;
        end if;
        ntit := ntit + 1;
      end loop;
      if resto > 0 then
        insert into public.crm_fin_lancamentos (tipo, descricao, fornecedor, categoria, valor, vencimento, origem, observacoes)
        values ('saida', 'Devolver ao cliente: devolução NF ' || coalesce(c.numero::text, '?') || ' (venda NF ' || v.numero || ')', c.fornecedor_nome, 'Outras saídas',
          resto, current_date + 7, 'tela', 'O cliente já tinha pago a venda: devolver o dinheiro ou deixar de crédito. Se ficar de crédito, exclua este lançamento.');
      end if;
      ef := jsonb_build_object('venda', v.numero, 'titulos', ntit, 'abatido', abat, 'sobra', resto);
    end if;
  end if;
  update public.crm_compras set situacao = 'lancada', lancada_em = agora, lancada_por = auth.uid(), atualizado_em = agora, efeitos = coalesce(ef, efeitos) where id = c.id;
  return jsonb_build_object('itens', n, 'ignorados', ign) || case when ef is null then '{}'::jsonb else jsonb_build_object('devolucao', ef) end;
end;
$$;

-- As devoluções de cliente entre as notas de compra (para a tela da logística, que lê as compras por crm_compras_op).
create or replace function public.crm_compras_devolucoes() returns table (id uuid, ref_chave text, ref_numero bigint, efeitos jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_eh_estoque_op() then raise exception 'sem acesso ao estoque'; end if;
  return query select c.id, c.ref_chave, n.numero::bigint, case when public.crm_eh_admin() or public.crm_eh_comprador() then c.efeitos end
    from public.crm_compras c left join public.crm_notas n on n.chave = c.ref_chave where c.devolucao order by c.emitida_em desc limit 200;
end;
$$;

-- ============================================================ Devoluções de venda no faturamento e na comissão (22/10/2026)
-- Decisão do Anderson: "devolveu é meio que não houve venda". As devoluções (a nota que o cliente contribuinte emite e a de
-- entrada que o CRM emite para o não contribuinte) descontam do faturamento e da comissão no mês da devolução, na vendedora e
-- no cliente da venda devolvida (regras.js, devolucoesComoNotas; pedidos.js, apuraComissao). Quem vê: quem vê a venda (o mesmo
-- filtro da política "le" de crm_notas).
create or replace function public.crm_devolucoes_venda() returns table (id uuid, origem text, numero bigint, quando timestamptz, venda_id uuid, valor numeric, itens jsonb)
language plpgsql stable security definer set search_path = public as $$
declare todos boolean := public.crm_eh_gestor() or public.crm_eh_comprador(); eu uuid := auth.uid(); membro boolean := public.crm_eh_membro();
begin
  if not public.crm_eh_ativo() then return; end if;
  return query
  with dv as (
    select c.id, 'cliente'::text origem, c.numero::bigint numero, c.emitida_em quando, c.ref_chave, c.valor_total valor,
      (select coalesce(jsonb_agg(jsonb_build_object('codigo', coalesce(i.codigo, i.cod_fornecedor), 'descricao', i.descricao, 'unidade', i.unidade,
         'quantidade', i.quantidade, 'valor_total', i.valor_total) order by i.ordem), '[]'::jsonb) from public.crm_compra_itens i where i.compra_id = c.id) itens
      from public.crm_compras c where c.devolucao and c.situacao <> 'ignorada' and c.ref_chave is not null
    union all
    select n.id, 'crm', n.numero::bigint, coalesce(n.autorizada_em, n.criado_em), o.ref_chave, n.valor,
      (select coalesce(jsonb_agg(jsonb_build_object('codigo', x->>'codigo', 'descricao', x->>'descricao', 'unidade', x->>'unidade', 'quantidade', (x->>'quantidade')::numeric,
         'valor_total', round(coalesce((x->>'quantidade')::numeric, 0) * coalesce((x->>'valorUnitario')::numeric, 0) - coalesce((x->>'desconto')::numeric, 0), 2))), '[]'::jsonb)
         from jsonb_array_elements(coalesce(n.nota->'itens', '[]'::jsonb)) x) itens
      from public.crm_nfe n join public.crm_nfe_outras o on o.id = n.outra_id
     where o.tipo = 'devolucao_cliente' and n.ambiente = 'producao' and n.situacao = 'autorizada')
  select dv.id, dv.origem, dv.numero, dv.quando, v.id, dv.valor, dv.itens
    from dv join public.crm_notas v on v.chave = dv.ref_chave
   where todos or v.empresa_id in (select public.crm_empresas_minhas()) or (membro and v.vendedor_id = eu);
end;
$$;

-- ============================================================ Segurança: auditoria de 22/10/2026 (itens do banco)
-- Testado com o login de cada papel numa transação desfeita e aplicado em produção em 22/10. O item 19 (a trava PREÇO serve
-- de pista do custo para a vendedora) fica aceito: a trava existe por decisão do Anderson e só diz "abaixo da margem".
-- As travas que olham "current_user = 'authenticated'" valem só para o que chega direto pela API (PostgREST): as funções do
-- banco (security definer) e as Edge Functions com a chave de serviço continuam fazendo o seu trabalho. Por isso as funções
-- dos gatilhos são SECURITY INVOKER (com definer, current_user seria sempre o dono). O que precisa ler além do que quem
-- chama enxerga fica em crm_interno, um schema que a API não expõe.
create schema if not exists crm_interno;
grant usage on schema crm_interno to authenticated;
create or replace function crm_interno.doc_de_outro(p_doc text, p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.crm_notas n where public.crm_doc(n.cliente_doc) = p_doc and n.empresa_id is distinct from p_empresa)
      or exists (select 1 from public.crm_titulos t where public.crm_doc(t.cliente_doc) = p_doc and t.empresa_id is distinct from p_empresa);
$$;
grant execute on function crm_interno.doc_de_outro(text, uuid) to authenticated;

-- Item 4: vendedora grava na própria empresa o CNPJ de cliente de outra carteira e passa a receber as notas dele.
-- CNPJ já preenchido só a gestora/administrador troca; CNPJ novo não pode ser o de notas ou títulos de outro cadastro.
create or replace function public.crm_empresa_cnpj_guarda() returns trigger language plpgsql set search_path = public as $$
declare novo text := public.crm_doc(new.cnpj); velho text;
begin
  if current_user <> 'authenticated' or public.crm_eh_gestor() or coalesce(novo, '') = '' then return new; end if;
  if tg_op = 'UPDATE' then
    velho := public.crm_doc(old.cnpj);
    if novo is not distinct from velho then return new; end if;
    if coalesce(velho, '') <> '' then raise exception 'Só a gestora troca o CNPJ de um cadastro que já tem CNPJ.' using errcode = 'P0001'; end if;
  end if;
  if crm_interno.doc_de_outro(novo, new.id) then
    raise exception 'Este CNPJ já aparece em notas de outro cadastro. Peça à gestora para juntar os cadastros.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create or replace trigger crm_empresas_cnpj_guarda before insert or update of cnpj on public.crm_empresas for each row execute function public.crm_empresa_cnpj_guarda();

-- Item 5: o canhoto da confirmação tem de ser a foto DESTA entrega, que existe no bucket e foi subida por quem confirma
-- (ou pela logística/gestão). Item 17: motorista desativado não confirma.
create or replace function public.crm_entrega_confirmar(p_id uuid, p_situacao text, p_obs text, p_canhoto text)
returns public.crm_entregas language plpgsql security definer set search_path = public as $$
declare r public.crm_entregas; antes text; quem uuid; nf integer; cli text; op boolean := public.crm_eh_gestor() or public.crm_eh_logistica();
begin
  if not public.crm_eh_ativo() then raise exception 'sem acesso'; end if;
  select * into r from public.crm_entregas where id = p_id;
  if not found then raise exception 'entrega não encontrada'; end if;
  if not (r.motorista_id = auth.uid() or op) then raise exception 'esta entrega não é sua'; end if;
  if p_situacao not in ('entregue', 'problema') then raise exception 'situação inválida'; end if;
  if coalesce(btrim(p_canhoto), '') = '' or p_canhoto !~ ('^canhotos/\d{4}-\d{2}-\d{2}/' || r.id::text || '-[a-z0-9]+\.jpg$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'crm-canhotos' and o.name = p_canhoto and (op or o.owner = auth.uid())) then
    raise exception 'falta a foto do canhoto';
  end if;
  if p_situacao = 'problema' and coalesce(btrim(p_obs), '') = '' then raise exception 'conte o que aconteceu na observação'; end if;
  antes := r.situacao;
  update public.crm_entregas set situacao = p_situacao, obs = nullif(btrim(coalesce(p_obs, '')), ''), canhoto = p_canhoto,
    entregue_em = coalesce(entregue_em, now()), entregue_por = auth.uid()
   where id = p_id returning * into r;
  if p_situacao = 'problema' and antes is distinct from 'problema' then
    select coalesce(n.vendedor_id, e.responsavel_id), n.numero, e.nome into quem, nf, cli
      from public.crm_notas n left join public.crm_empresas e on e.id = coalesce(r.empresa_id, n.empresa_id) where n.id = r.nota_id;
    if quem is not null then
      insert into public.crm_atividades (empresa_id, responsavel_id, tipo, descricao, data_hora, automatica, criado_por)
      values (r.empresa_id, quem, 'tarefa', 'Entrega com problema' || coalesce(' (NF ' || nf || ')', '') || ': ' || r.obs ||
        '. Fale com o cliente' || coalesce(' ' || cli, '') || ' e combine com a logística.', now(), true, auth.uid());
    end if;
  end if;
  return r;
end $$;

-- Item 17: motorista desativado não lê mais as entregas dele.
alter policy ler on public.crm_entregas
  using ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica()) or ((select public.crm_eh_ativo()) and motorista_id = (select auth.uid())));

-- Item 7: o motorista só lê e só sobe a foto das entregas dele (o nome do arquivo leva o id da entrega); a logística e a
-- gestão leem todas. Endurecimento: bucket só com imagem e até 8 MB.
alter policy "crm canhotos le" on storage.objects
  using (bucket_id = 'crm-canhotos' and ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica())
    or ((select public.crm_eh_motorista()) and exists (select 1 from public.crm_entregas x where x.motorista_id = (select auth.uid())
          and split_part(name, '/', 3) like x.id::text || '-%'))));
alter policy "crm canhotos grava" on storage.objects
  with check (bucket_id = 'crm-canhotos' and ((select public.crm_eh_gestor()) or (select public.crm_eh_logistica())
    or ((select public.crm_eh_motorista()) and exists (select 1 from public.crm_entregas x where x.motorista_id = (select auth.uid())
          and split_part(name, '/', 3) like x.id::text || '-%'))));
update storage.buckets set file_size_limit = 8388608, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'crm-canhotos';

-- Item 15: as chaves de configuração que só o administrador mexe (fiscal, boleto, comissão, tabela de preços, margem e trava
-- de preço) ficam como estavam quando quem grava é a gestora (a tela grava o crm_config inteiro).
create or replace function public.crm_config_guarda() returns trigger language plpgsql set search_path = public as $$
declare k text;
begin
  if current_user <> 'authenticated' or public.crm_eh_admin() then return new; end if;
  foreach k in array array['fiscal', 'boleto', 'comissao_planos', 'comissao_usuarios', 'tabela_precos', 'margem_minima', 'pedido_trava_preco', 'cobranca_aviso', 'cobranca_prazo_cartorio'] loop
    if tg_op = 'UPDATE' and old.dados ? k then new.dados := jsonb_set(coalesce(new.dados, '{}'::jsonb), array[k], old.dados -> k);
    else new.dados := coalesce(new.dados, '{}'::jsonb) - k; end if;
  end loop;
  return new;
end;
$$;
create or replace trigger crm_config_guarda before insert or update on public.crm_config for each row execute function public.crm_config_guarda();

-- Item 16: o "pulado" da cadência que o app grava sai com a hora de agora (data futura tirava o cliente da cadência para sempre).
create or replace function public.crm_email_envio_agora() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then new.criado_em := now(); end if;
  return new;
end;
$$;
create or replace trigger crm_email_envios_agora before insert on public.crm_email_envios for each row execute function public.crm_email_envio_agora();

-- Item 18: o rascunho de NF-e 4b não se altera pela API depois de criado (a prévia e a emissão leem o mesmo rascunho; só o
-- serviço fiscal muda a situação, com a chave de serviço).
alter policy muda on public.crm_nfe_outras using (false) with check (false);

-- Item 20: a gestora, pela API, só cria título nascido de nota e, num título, só troca o cadastro (juntar duplicados);
-- o resto do contas a receber é do administrador.
create or replace function public.crm_titulos_guarda() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' or public.crm_eh_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.origem is distinct from 'nota' then raise exception 'só o administrador lança título à mão'; end if;
  elsif tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['empresa_id', 'atualizado_em']) is distinct from (to_jsonb(old) - array['empresa_id', 'atualizado_em']) then
      raise exception 'só o administrador altera o título (a gestora só troca o cadastro)';
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger crm_titulos_guarda before insert or update on public.crm_titulos for each row execute function public.crm_titulos_guarda();


-- Itens 6 e 19: produto vendido em outra embalagem do mesmo código (FD, PCT, CX sem variante ".N") — o preço da linha é da
-- embalagem, então o preço de tabela e o custo também vão na embalagem (× fator). Antes a trava PREÇO comparava o preço do
-- fardo com o custo da unidade (venda abaixo do custo passava) e a comissão saía na faixa errada.
create or replace function public.crm_pedido_itens_norm(p_itens jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare x jsonb; out jsonb := '[]'::jsonb; cod text; base text; un text; eu text; f numeric; q numeric; pr numeric; d numeric; e record; k int := 0; emb boolean;
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
    -- a linha é de uma embalagem do código da unidade (sem a variante ".N", que já tem preço e custo próprios)
    emb := cod is not null and cod !~ '\.\d+$' and f <> 1;
    out := out || jsonb_build_object('codigo', cod, 'descricao', coalesce(nullif(btrim(x->>'descricao'), ''), e.descricao, cod), 'unidade', un,
      'quantidade', q, 'preco', pr, 'desconto', d, 'total', round(q * pr * (1 - d / 100), 2), 'obs', nullif(btrim(coalesce(x->>'obs', '')), ''),
      'base', base, 'fator', f, 'qtd_est', round(q * f, 3),
      'preco_tab', case when emb then round(e.preco_venda * f, 4) else e.preco_venda end,
      'custo', case when emb then round(e.custo_unit * f, 4) else e.custo_unit end, 'separado', false);
  end loop;
  return out;
end;
$$;

-- Limite diário da IA no servidor (auditoria 22/10/2026, itens 8 e 11): crm-assistente e crm-produto-buscar reservam a
-- linha em crm_assistente_uso ANTES de chamar a IA (erro 'em andamento'), com trava por usuário; duas chamadas ao mesmo
-- tempo não passam do limite. Depois a função atualiza a linha com o custo. Só a service role (as funções) chama.
create or replace function public.crm_ia_reservar(p_user uuid, p_tela text, p_limite integer, p_desde timestamptz) returns bigint
language plpgsql security definer set search_path = public as $$
declare n integer; id bigint; fotos boolean := coalesce(p_tela, '') = 'fotos';
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'só a função da IA'; end if;
  perform pg_advisory_xact_lock(hashtext('crm_ia:' || p_user::text || ':' || fotos::text));
  select count(*) into n from public.crm_assistente_uso u where u.user_id = p_user and u.criado_em >= p_desde and (coalesce(u.tela, '') = 'fotos') = fotos;
  if n >= p_limite then return null; end if;
  insert into public.crm_assistente_uso (user_id, tela, ferramentas, tokens_entrada, tokens_saida, cache_lido, cache_escrito, custo_usd, erro)
  values (p_user, p_tela, '{}', 0, 0, 0, 0, 0, 'em andamento') returning crm_assistente_uso.id into id;
  return id;
end;
$$;

-- Acesso das funções da auditoria de 22/10 (o Anderson roda no SQL Editor: o conector não aceita revoke)
revoke execute on function public.crm_ia_reservar(uuid, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.crm_ia_reservar(uuid, text, integer, timestamptz) to service_role;
revoke execute on function crm_interno.doc_de_outro(text, uuid) from public, anon;
grant execute on function crm_interno.doc_de_outro(text, uuid) to authenticated, service_role;
revoke all on schema crm_interno from public, anon;
grant usage on schema crm_interno to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Configuração gravada por partes (23/10/2026, antes da virada). O app regravava o crm_config inteiro com a cópia que a tela
-- tinha: uma tela aberta antes (outro computador, a gestora salvando metas) desfazia o que outro tinha salvo depois — e a
-- emissão em PRODUÇÃO (dados.fiscal.ambiente) voltaria sozinha para homologação. crm_config_mesclar junta só as chaves que
-- vieram sobre a versão atual do banco; a chave "fiscal" é juntada um nível abaixo (só os campos que vieram). Quem grava
-- continua sendo quem a política deixa (gestora e administrador); a parte fiscal, só o administrador (crm_config_guarda,
-- da auditoria de 22/10, devolve o fiscal, o boleto e a comissão ao valor antigo quando não é o administrador).
create or replace function public.crm_config_mesclar(p jsonb) returns jsonb language plpgsql security invoker set search_path = public as $$
declare d jsonb; k text; n int; r public.crm_config;
begin
  if not public.crm_eh_gestor() then raise exception 'só a gestão muda as configurações'; end if;
  insert into public.crm_config (id, dados) values (1, '{}'::jsonb) on conflict (id) do nothing;
  select coalesce(dados, '{}'::jsonb) into d from public.crm_config where id = 1 for update;
  for k in select jsonb_object_keys(coalesce(p, '{}'::jsonb)) loop
    if k = 'fiscal' and jsonb_typeof(p -> k) = 'object' and jsonb_typeof(d -> k) = 'object' then
      d := jsonb_set(d, array[k], (d -> k) || (p -> k));
    else
      d := jsonb_set(d, array[k], p -> k, true);
    end if;
  end loop;
  update public.crm_config set dados = d, atualizado_em = now() where id = 1 returning * into r;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'configuração não gravada'; end if;
  return to_jsonb(r);
end;
$$;
grant execute on function public.crm_config_mesclar(jsonb) to authenticated;
revoke execute on function public.crm_config_mesclar(jsonb) from anon, public;   -- rodado pelo Anderson (docs/oneclean/sql/2026-10-23-config-mesclar.sql)


-- ============================================================================================================
-- Aviso de atraso ao cliente (23/10/2026, pedido do Anderson): com 5 dias úteis de atraso o cliente recebe, pelo
-- WhatsApp da empresa (modelo cobranca_atraso) e por e-mail, UM aviso cordial já dizendo que, sem o pagamento até o
-- prazo, o título segue para o cartório; o administrador decide o cartório (tarefa quando o prazo vence). Quem envia é a
-- Edge Function crm-cobranca, chamada todo dia útil às 9h05 pelo pg_cron (crm_cobranca_tick) com uma senha que nasce
-- aqui no banco e nunca sai dele (crm_interno não é exposto pela API); o administrador também roda pela tela.
create table if not exists public.crm_cobranca_avisos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null,
  duplicatas     text[] not null,                -- títulos do aviso (a duplicata é estável; o crm_titulos pode ser refeito)
  notas          text,                           -- "a NF 2428, vencida em 10/10/2026"
  valor          numeric(14,2) not null,
  dias           integer,                        -- dias corridos de atraso do título mais antigo, no envio
  prazo          date not null,                  -- depois desta data: hora de decidir o cartório
  vendedor_id    uuid,
  texto          text,
  whatsapp_para  text, wa_msg text, wa_status text, wa_erro text,
  email_para     text[], email_ok boolean, email_erro text,
  enviado_em     timestamptz not null default now(),
  enviado_por    uuid,                           -- vazio = automático
  pagou_em       timestamptz,                    -- tocou em "Já paguei"
  respondeu_em   timestamptz,
  alerta_em      timestamptz                     -- tarefa "decidir o cartório" criada
);
create index if not exists crm_cobranca_avisos_emp on public.crm_cobranca_avisos (empresa_id);
create index if not exists crm_cobranca_avisos_msg on public.crm_cobranca_avisos (wa_msg);
create index if not exists crm_cobranca_avisos_tel on public.crm_cobranca_avisos (whatsapp_para, enviado_em);
alter table public.crm_cobranca_avisos enable row level security;
revoke all on public.crm_cobranca_avisos from anon, public;
grant select on public.crm_cobranca_avisos to authenticated;
drop policy if exists ler on public.crm_cobranca_avisos;
create policy ler on public.crm_cobranca_avisos for select to authenticated using ((select public.crm_eh_admin()));

create schema if not exists crm_interno;
create table if not exists crm_interno.cobranca_cfg (
  id    integer primary key default 1 check (id = 1),
  senha text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  url   text                                   -- https://<projeto>.supabase.co/functions/v1/crm-cobranca: gravar na instalação (update crm_interno.cobranca_cfg set url = …)
);
revoke all on crm_interno.cobranca_cfg from public, anon, authenticated;
insert into crm_interno.cobranca_cfg (id) values (1) on conflict (id) do nothing;

-- a Edge Function confere a senha do agendador (só com a chave de serviço)
create or replace function public.crm_cobranca_senha_ok(p text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from crm_interno.cobranca_cfg where id = 1 and length(coalesce(p, '')) >= 32 and senha = p);
$$;
revoke all on function public.crm_cobranca_senha_ok(text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.crm_cobranca_senha_ok(text) to service_role; end if;
end $$;

-- todo dia útil às 9h05 de São Paulo (12h05 UTC): chama a função; ela confere se o aviso está ligado
create or replace function public.crm_cobranca_tick() returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from crm_interno.cobranca_cfg where id = 1;
  if c.url is null then return; end if;
  perform net.http_post(url := c.url, body := jsonb_build_object('acao', 'rodar', 'origem', 'agendador'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || c.senha), timeout_milliseconds := 120000);
end;
$$;
revoke all on function public.crm_cobranca_tick() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('crm-cobranca-avisos', '5 12 * * 1-5', 'select public.crm_cobranca_tick()');
  end if;
end $$;

-- ============================================================================
-- Segurança (23/10/2026, alertas do Supabase): 10 funções SECURITY DEFINER tinham voltado a aceitar chamada sem login
-- (o padrão do esquema public dá EXECUTE ao anon e a PUBLIC em toda função nova, e a função recriada perde o revoke).
-- Nenhuma vazava dado que importe (as de escrita conferem o papel por dentro; as de gatilho não rodam pela API), mas
-- crm_produtos_ncm devolvia código e NCM a qualquer um. Agora o padrão é outro: função nova nasce só para quem fez login
-- (authenticated e service_role); a que precisar do anon ganha o grant explícito.
-- ============================================================================
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres revoke execute on functions from public;
revoke execute on function public.crm_produtos_ncm(), public.crm_boleto_reservar(text), public.crm_compra_lancar(uuid, jsonb),
  public.crm_custo_mudou(), public.crm_estoque_guarda(), public.crm_estoque_mov_espelho(), public.crm_estoque_mov_saldo(),
  public.crm_estoque_nota_cancelada(), public.crm_estoque_nota_item(), public.crm_pedidos_espelho() from public, anon;
alter function public.crm_endereco_texto(public.crm_empresas) set search_path = public;

-- ============================================================ Conferência da virada (23/10/2026)
-- Uma lista do que pode travar o dia só no CRM (03/11), para o administrador rodar na noite de 30/10 e na manhã de 03/11:
-- nasceu do que a conferência à mão achou em 23/10 (entradas em código que não existe, produto com saldo sem regra fiscal,
-- cliente com o município trocado). Só leitura. Cada item: { chave, titulo, nivel ('ok' | 'aviso' | 'trava'), n, dica, lista }.
create or replace function public.crm_virada_conferir() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '[]'::jsonb; n integer; l jsonb; cfg jsonb; v text;
begin
  if not public.crm_eh_admin() then raise exception 'só o administrador confere a virada'; end if;
  select dados into cfg from public.crm_config where id = 1;

  -- 1. produto vendido no último ano sem regra fiscal de venda (a NF-e não sai)
  select count(*), coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', descricao)) filter (where rn <= 30), '[]') into n, l
  from (select e.codigo, e.descricao, row_number() over (order by e.descricao) rn from public.crm_estoque e
        where coalesce(e.situacao, 'ATIVO') <> 'INATIVO'
          and exists (select 1 from public.crm_nota_itens i join public.crm_notas nn on nn.id = i.nota_id
                      where i.codigo = e.codigo and nn.emitida_em > now() - interval '12 months')
          and not exists (select 1 from public.crm_fiscal_produtos f where f.codigo = e.codigo and f.regra ? 'venda')) y;
  r := r || jsonb_build_object('chave', 'vendidos_sem_regra', 'titulo', 'Produtos vendidos no último ano sem regra fiscal', 'n', n,
    'nivel', case when n = 0 then 'ok' else 'trava' end, 'dica', 'Sem regra a nota não sai. Em Produtos, filtro "Sem regra fiscal": "Mesma tributação que" um parecido.', 'lista', l);

  -- 2. produto ativo com saldo e sem regra
  select count(*), coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', descricao, 'qtd', saldo)) filter (where rn <= 30), '[]') into n, l
  from (select s.codigo, coalesce(e.descricao, s.descricao) descricao, s.saldo, row_number() over (order by s.saldo desc) rn
        from public.crm_estoque_saldo s join public.crm_estoque e on e.codigo = s.codigo
        where s.saldo > 0 and coalesce(e.situacao, 'ATIVO') <> 'INATIVO'
          and not exists (select 1 from public.crm_fiscal_produtos f where f.codigo = s.codigo and f.regra ? 'venda')) y;
  r := r || jsonb_build_object('chave', 'saldo_sem_regra', 'titulo', 'Produtos ativos com estoque e sem regra fiscal', 'n', n,
    'nivel', case when n = 0 then 'ok' else 'aviso' end, 'dica', 'Ainda não venderam, mas têm estoque: dê a regra antes da 1ª venda.', 'lista', l);

  -- 3. inativo com estoque
  select count(*), coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', descricao, 'qtd', saldo)) filter (where rn <= 30), '[]') into n, l
  from (select s.codigo, coalesce(e.descricao, s.descricao) descricao, s.saldo, row_number() over (order by s.saldo desc) rn
        from public.crm_estoque_saldo s join public.crm_estoque e on e.codigo = s.codigo where s.saldo > 0 and e.situacao = 'INATIVO') y;
  r := r || jsonb_build_object('chave', 'inativo_com_saldo', 'titulo', 'Produtos inativos que ainda têm estoque', 'n', n,
    'nivel', case when n = 0 then 'ok' else 'aviso' end, 'dica', 'Para vender: reativar no cadastro e dar a regra fiscal; senão, contar e baixar.', 'lista', l);

  -- 4. saldo em código que o cadastro não tem
  select count(*), coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', descricao, 'qtd', saldo)) filter (where rn <= 30), '[]') into n, l
  from (select s.codigo, s.descricao, s.saldo, row_number() over (order by s.codigo) rn from public.crm_estoque_saldo s
        where s.saldo <> 0 and not exists (select 1 from public.crm_estoque e where e.codigo = s.codigo)) y;
  r := r || jsonb_build_object('chave', 'fora_do_cadastro', 'titulo', 'Estoque em código que o cadastro não tem', 'n', n,
    'nivel', case when n = 0 then 'ok' else 'trava' end, 'dica', 'Mercadoria fora do produto certo (ex.: código digitado sem o zero da frente). Corrigir com estorno e entrada no código certo.', 'lista', l);

  -- 5. cliente que comprou no último ano sem os dados da nota
  select count(*), coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'falta', falta)) filter (where rn <= 30), '[]') into n, l
  from (select a.*, row_number() over (order by a.nome) rn from (select e.id, e.nome, concat_ws(', ',
          case when e.ind_ie is null then 'contribuinte?' end,
          case when e.ind_ie = '1' and coalesce(e.ie, '') = '' then 'inscrição estadual' end,
          case when coalesce(e.codigo_municipio, '') !~ '^\d{7}$' then 'município (IBGE)' end,
          case when coalesce(btrim(e.logradouro), '') = '' then 'rua' end,
          case when coalesce(btrim(e.numero), '') = '' then 'número' end,
          case when coalesce(btrim(e.bairro), '') = '' then 'bairro' end,
          case when regexp_replace(coalesce(e.cep, ''), '\D', '', 'g') !~ '^\d{8}$' then 'CEP' end,
          case when coalesce(e.uf, '') = '' then 'UF' end) falta
        from public.crm_empresas e where e.id in (select n2.empresa_id from public.crm_notas n2 where n2.emitida_em > now() - interval '12 months')) a
        where a.falta <> '') y;
  r := r || jsonb_build_object('chave', 'clientes_sem_dado', 'titulo', 'Clientes do último ano sem os dados da nota', 'n', n,
    'nivel', case when n = 0 then 'ok' else 'aviso' end, 'dica', 'O pedido mostra o que falta e o botão "Completar o cadastro"; dá para acertar antes, na ficha.', 'lista', l);

  -- 6. código do município que não é o da cidade do cadastro (a maioria com o mesmo código diz outra cidade)
  with c as (select id, nome, codigo_municipio cm, cidade, regexp_replace(upper(translate(btrim(coalesce(cidade, '')), 'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ', 'aaaaeeioooucAAAAEEIOOOUC')), '\s+(DO|DA|DE|DOS|DAS)\s+', ' ', 'g') cn
             from public.crm_empresas where codigo_municipio ~ '^\d{7}$' and coalesce(cidade, '') <> ''),
       m as (select distinct on (cm) cm, cn from (select cm, cn, count(*) k from c group by 1, 2) z order by cm, k desc)
  select count(*), coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'falta', c.cidade || ' com o código de ' || initcap(lower(m.cn)))) filter (where true), '[]') into n, l
  from c join m on m.cm = c.cm where c.cn <> m.cn and (select count(*) from c c2 where c2.cm = c.cm) >= 3;
  r := r || jsonb_build_object('chave', 'municipio_trocado', 'titulo', 'Clientes com o código do município de outra cidade', 'n', n,
    'nivel', case when n = 0 then 'ok' else 'aviso' end, 'dica', 'Na ficha, apague e digite o CEP de novo: o CRM busca o município certo.', 'lista', l);

  -- 7. pedido em aberto sem forma de pagamento
  select count(*), coalesce(jsonb_agg(jsonb_build_object('numero', p.numero, 'nome', e.nome)) filter (where true), '[]') into n, l
  from public.crm_pedidos p join public.crm_empresas e on e.id = p.empresa_id
  where p.situacao in ('aberto', 'separacao', 'separado') and coalesce(btrim(p.dados->>'pagamento'), '') = '';
  r := r || jsonb_build_object('chave', 'pedido_sem_pagamento', 'titulo', 'Pedidos em aberto sem forma de pagamento', 'n', n,
    'nivel', case when n = 0 then 'ok' else 'aviso' end, 'dica', 'A nota não sai sem a forma de pagamento.', 'lista', l);

  -- 8. nota de compra parada sem entrada
  select count(*), coalesce(jsonb_agg(jsonb_build_object('numero', numero, 'nome', fornecedor_nome, 'dia', (emitida_em at time zone 'America/Sao_Paulo')::date)) filter (where true), '[]') into n, l
  from public.crm_compras where situacao = 'pendente' and emitida_em < now() - interval '5 days';
  r := r || jsonb_build_object('chave', 'compras_paradas', 'titulo', 'Notas de compra há mais de 5 dias sem entrada', 'n', n,
    'nivel', case when n = 0 then 'ok' else 'aviso' end, 'dica', 'Sem a entrada, o estoque do CRM fica a menos (Estoque → Notas de compra).', 'lista', l);

  -- 9. equipe que nunca entrou
  select count(*), coalesce(jsonb_agg(jsonb_build_object('nome', u.nome, 'papel', u.papel)) filter (where true), '[]') into n, l
  from public.crm_usuarios u left join auth.users a on a.id = u.user_id where u.ativo and a.last_sign_in_at is null;
  r := r || jsonb_build_object('chave', 'equipe_sem_acesso', 'titulo', 'Pessoas da equipe que nunca entraram no CRM', 'n', n,
    'nivel', case when n = 0 then 'ok' else 'aviso' end, 'dica', 'Peça o 1º acesso antes do dia da virada (senha esquecida se resolve com tempo).', 'lista', l);

  -- 10. tabela do IBPT
  select max(vig_fim)::text into v from public.crm_ibpt;
  r := r || jsonb_build_object('chave', 'ibpt', 'titulo', 'Tabela do IBPT (tributos aproximados)', 'n', case when v is null or v < current_date::text then 1 else 0 end,
    'nivel', case when v is not null and v >= current_date::text then 'ok' else 'aviso' end,
    'dica', case when v is null then 'Sem tabela: carregue na aba Fiscal.' when v < current_date::text then 'Venceu em ' || to_char(v::date, 'DD/MM/YYYY') || ': a nota sai, mas com aviso. Carregue a nova ou cole o IBPT_TOKEN.' else 'Vale até ' || to_char(v::date, 'DD/MM/YYYY') || '.' end, 'lista', '[]'::jsonb);

  -- 11. cadastro e emissão (informativo: mudam na virada)
  r := r || jsonb_build_object('chave', 'cadastro_dono', 'titulo', 'Cadastro de produtos no CRM', 'n', 0,
    'nivel', case when public.crm_produtos_do_crm() then 'ok' else 'aviso' end,
    'dica', case when public.crm_produtos_do_crm() then 'O CRM é o dono do cadastro e do estoque.' else 'Ainda vem do FKN: na noite de 30/10, Produtos → "Passar o cadastro para o CRM".' end, 'lista', '[]'::jsonb);
  r := r || jsonb_build_object('chave', 'emissao', 'titulo', 'Emissão da NF-e', 'n', 0,
    'nivel', case when coalesce(cfg->'fiscal'->>'ambiente', '') = 'producao' then 'ok' else 'aviso' end,
    'dica', case when coalesce(cfg->'fiscal'->>'ambiente', '') = 'producao' then 'Em produção, série 2.' else 'Em homologação: em 03/11, antes da 1ª nota, Fiscal → Emissão → "Passar para produção…".' end, 'lista', '[]'::jsonb);

  -- 12. vigia de notas
  select count(*) into n from public.crm_integracoes where ativo and ultimo_sinal > now() - interval '75 minutes';
  r := r || jsonb_build_object('chave', 'vigia', 'titulo', 'Vigia das notas no servidor', 'n', case when n > 0 then 0 else 1 end,
    'nivel', case when n > 0 then 'ok' else 'aviso' end,
    'dica', case when n > 0 then 'Mandou sinal na última hora: as notas do FKN (plano B) continuam entrando.' else 'Sem sinal há mais de 1 hora: confira o servidor do escritório.' end, 'lista', '[]'::jsonb);
  -- 13. última conferência CRM × FKN (antes de passar o cadastro: o que o FKN tem e o CRM não, ou sem explicação)
  select count(*), coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', descricao || ' · CRM ' || round(saldo_crm)::text || ' × FKN ' || round(saldo_fkn)::text,
      'falta', coalesce(nullif(explicacao, ''), 'sem explicação'))) filter (where rn <= 30), '[]') into n, l
  from (select d2.*, row_number() over (order by abs(d2.diferenca) desc) rn from public.crm_estoque_difs d2
        where d2.foto_id = (select id from public.crm_estoque_fotos where conferida_em is not null order by gerado_em desc limit 1)
          and (coalesce(d2.explicacao, '') = '' or d2.explicacao ilike '%sem entrada no CRM%')) y;
  r := r || jsonb_build_object('chave', 'conferencia_fkn', 'titulo', 'Estoque: diferenças com o FKN sem explicação ou com compra sem entrada no CRM', 'n', n,
    'nivel', case when n = 0 then 'ok' else 'trava' end,
    'dica', 'Antes de "Passar o cadastro para o CRM": dar entrada nas notas de compra pendentes e contar o que sobrar; senão o estoque do CRM nasce errado.', 'lista', l);
  return r;
end;
$$;
revoke all on function public.crm_virada_conferir() from public, anon;
grant execute on function public.crm_virada_conferir() to authenticated;

-- ============================================================ Entrada avulsa (23/10/2026, pedido do Anderson)
-- Compra de balcão sem nota de compra (faltou um item, comprou na loja perto): entra no estoque pelo custo pago, com
-- onde comprou, o motivo e a foto do cupom/recibo, e fica numa lista para o contador. Só administrador e comprador.
-- O administrador pode lançar o pagamento no Caixa junto. Engano: "Estornar" devolve o estoque (o livro não se apaga).
create table if not exists public.crm_estoque_avulsas (
  id            uuid primary key default gen_random_uuid(),
  mov_id        uuid not null unique references public.crm_estoque_mov(id),
  codigo        text not null,
  descricao     text,
  quantidade    numeric(14,3) not null check (quantidade > 0),
  custo_unit    numeric(16,4) not null check (custo_unit > 0),
  valor         numeric(14,2) not null,
  onde          text not null check (length(btrim(onde)) > 0),
  motivo        text not null check (length(btrim(motivo)) > 0),
  comprado_em   date not null,
  comprovante   text,                                   -- caminho no bucket crm-estoque-comprovantes
  lancamento_id uuid references public.crm_fin_lancamentos(id) on delete set null,
  estorno_mov   uuid references public.crm_estoque_mov(id),
  estornada_em  timestamptz,
  estornada_por uuid,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now()
);
create index if not exists crm_estoque_avulsas_dia on public.crm_estoque_avulsas (criado_em desc);
alter table public.crm_estoque_avulsas enable row level security;
revoke all on public.crm_estoque_avulsas from anon, public, authenticated;
grant select on public.crm_estoque_avulsas to authenticated;
drop policy if exists ler on public.crm_estoque_avulsas;
create policy ler on public.crm_estoque_avulsas for select to authenticated using ((select public.crm_eh_admin()) or (select public.crm_eh_comprador()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crm-estoque-comprovantes', 'crm-estoque-comprovantes', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "crm estoque comprovantes le" on storage.objects;
create policy "crm estoque comprovantes le" on storage.objects for select to authenticated
  using (bucket_id = 'crm-estoque-comprovantes' and ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())));
drop policy if exists "crm estoque comprovantes grava" on storage.objects;
create policy "crm estoque comprovantes grava" on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-estoque-comprovantes' and ((select public.crm_eh_admin()) or (select public.crm_eh_comprador())));

create or replace function public.crm_estoque_entrada_avulsa(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare cod text := nullif(btrim(p->>'codigo'), ''); q numeric := nullif(p->>'quantidade', '')::numeric; c numeric := nullif(p->>'custo_unit', '')::numeric;
  onde text := nullif(btrim(p->>'onde'), ''); mot text := nullif(btrim(p->>'motivo'), ''); comp text := nullif(btrim(p->>'comprovante'), '');
  hoje date := (now() at time zone 'America/Sao_Paulo')::date; dia date; pago boolean := coalesce((p->>'pago')::boolean, false);
  mid uuid; lid uuid; nome text; v numeric;
begin
  if not (public.crm_eh_admin() or public.crm_eh_comprador()) then raise exception 'só o administrador ou o comprador'; end if;
  dia := coalesce(nullif(p->>'comprado_em', '')::date, hoje);
  if cod is null or cod ~ '\.\d+$' or not exists (select 1 from public.crm_estoque e where e.codigo = cod) then
    raise exception 'o código % não está no cadastro de produtos', coalesce(cod, '(vazio)'); end if;
  if q is null or q <= 0 then raise exception 'diga a quantidade que entrou'; end if;
  if c is null or c <= 0 then raise exception 'diga quanto custou cada unidade'; end if;
  if onde is null or mot is null then raise exception 'diga onde comprou e por quê'; end if;
  if dia > hoje or dia < hoje - 60 then raise exception 'a data da compra tem de ser de até 60 dias atrás'; end if;
  if comp is not null and not exists (select 1 from storage.objects o where o.bucket_id = 'crm-estoque-comprovantes' and o.name = comp) then
    raise exception 'o comprovante não foi encontrado'; end if;
  if not exists (select 1 from public.crm_estoque_saldo) then raise exception 'comece o estoque do CRM antes'; end if;
  insert into public.crm_estoque_saldo (codigo, descricao, unidade, inicio)
    select e.codigo, e.descricao, public.crm_un(e.unidade), now() - interval '1 second' from public.crm_estoque e where e.codigo = cod
  on conflict (codigo) do nothing;
  select descricao into nome from public.crm_estoque where codigo = cod;
  v := round(q * c, 2);
  insert into public.crm_estoque_mov (codigo, quando, tipo, quantidade, custo_unit, motivo)
  values (cod, now(), 'entrada', round(q, 3), round(c, 4), left('Entrada avulsa (sem nota de compra): ' || onde || ' · ' || mot, 200)) returning id into mid;
  if coalesce((p->>'caixa')::boolean, false) and public.crm_eh_admin() then
    insert into public.crm_fin_lancamentos (tipo, descricao, fornecedor, categoria, valor, vencimento, situacao, pago_em, baixa, baixado_em, origem, observacoes)
    values ('saida', 'Compra avulsa (sem nota): ' || coalesce(nome, cod), onde, 'Fornecedores', v, dia,
      case when pago then 'pago' else 'aberto' end, case when pago then dia end, case when pago then 'caixa' end, case when pago then now() end,
      'tela', left(mot || ' · comprovante em Estoque → Contagem e ajuste → Entradas avulsas', 500))
    returning id into lid;
  end if;
  insert into public.crm_estoque_avulsas (mov_id, codigo, descricao, quantidade, custo_unit, valor, onde, motivo, comprado_em, comprovante, lancamento_id)
  values (mid, cod, nome, round(q, 3), round(c, 4), v, onde, mot, dia, comp, lid);
  return jsonb_build_object('ok', true, 'valor', v, 'caixa', lid is not null);
end;
$$;
revoke all on function public.crm_estoque_entrada_avulsa(jsonb) from public, anon;
grant execute on function public.crm_estoque_entrada_avulsa(jsonb) to authenticated;

-- Engano na entrada avulsa: estorno no livro (devolve o estoque) e, se o pagamento ainda está aberto no Caixa, ele sai.
create or replace function public.crm_estoque_avulsa_estornar(p_id uuid, p_motivo text) returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; eid uuid; tirou boolean := false;
begin
  if not (public.crm_eh_admin() or public.crm_eh_comprador()) then raise exception 'só o administrador ou o comprador'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'diga o motivo do estorno'; end if;
  select * into a from public.crm_estoque_avulsas where id = p_id for update;
  if a.id is null then raise exception 'entrada avulsa não encontrada'; end if;
  if a.estornada_em is not null then raise exception 'esta entrada já foi estornada'; end if;
  insert into public.crm_estoque_mov (codigo, quando, tipo, quantidade, estorno_de, motivo)
  values (a.codigo, now(), 'estorno', -a.quantidade, a.mov_id, left('Estorno da entrada avulsa: ' || p_motivo, 200)) returning id into eid;
  if a.lancamento_id is not null and public.crm_eh_admin() then
    delete from public.crm_fin_lancamentos where id = a.lancamento_id and situacao = 'aberto';
    tirou := found;
  end if;
  update public.crm_estoque_avulsas set estorno_mov = eid, estornada_em = now(), estornada_por = auth.uid() where id = a.id;
  return jsonb_build_object('ok', true, 'caixa_tirado', tirou, 'caixa_pago', a.lancamento_id is not null and not tirou);
end;
$$;
revoke all on function public.crm_estoque_avulsa_estornar(uuid, text) from public, anon;
grant execute on function public.crm_estoque_avulsa_estornar(uuid, text) to authenticated;
