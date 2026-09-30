# CLAUDE.md — CRM Sistemi Dalessi

Guia para o Claude Code. Falar em **português** com o Anderson; UI, comentários e
commits em pt-BR. O que o sistema faz, do ponto de vista de quem usa, está no
`README.md` — ler antes.

> **REGRA Nº 1 — IDIOMA: com o Anderson, TUDO em português do Brasil.** Toda
> mensagem, inclusive os avisos curtos de andamento ("vou fazer X", "deu certo",
> "achei um erro"), perguntas, resumos e explicações. **Nunca escrever em inglês**,
> nem uma frase. Ele já pediu isso mais de quatro vezes; escorregar para o inglês
> no meio do trabalho é o erro que mais o incomoda. Termos técnicos sem tradução
> comum (commit, push, token, API) podem ficar, mas a frase é em português.

## O que é

CRM de equipe de vendas no estilo do Agendor, feito como **produto** da Sistemi
Dalessi. Primeira instalação: **OneClean** (produtos de limpeza e descartáveis;
venda B2B com recompra frequente — daí o peso de pós-venda, recompra e cliente
inativo). Uso só no computador (desktop primeiro; abaixo de 1000 px o menu encolhe).

Nasceu em 29/09/2026 com prazo: o Agendor da OneClean vencia em 01/10/2026 e os
dados precisavam vir de lá. A migração é o caminho mais sensível do sistema.

## Instalação OneClean (este repositório)

- Endereço: https://sistemidalessi.github.io/crm-oneclean/ (GitHub Pages, branch `main`, raiz).
- Supabase: organização **OneClean**, projeto **OneClean CRM**, ref `udhigavckigciqnicgyy`
  (sa-east-1), criado em 29/09/2026. Schema aplicado (migrations `crm_schema_v2`,
  `crm_empresas_le_propria_linha` e, em 30/09, `crm_notas_fiscais`), Edge Function `crm-usuarios` publicada (verify_jwt ligado).
  Permissões atacadas no banco real (vendedor A × vendedor B × de fora × anon), tudo barrado.
- Esta é a cópia viva do código. A origem foi `sistemi-dalessi/crm/`, que fica só
  como histórico; mudança nova entra aqui.

## ONDE PARAMOS (30/09/2026, manhã) — retomar daqui

- **Feito hoje:** Relatórios com "Total vendido" e linha "Total da equipe" na tabela por
  vendedor; **importação de notas fiscais (XML/ZIP da NF-e)** e seção **Faturamento** nos
  Relatórios (top 10 clientes e produtos, segmento, vendedor, cidade, por mês); notas na
  ficha do cliente; "Preencher segmento pelo nome" em Configurações → Origens, segmentos,
  motivos. Tabelas `crm_notas`/`crm_nota_itens` no banco real, RLS atacada localmente e
  gravação testada no banco real (desfeita). **Nenhuma nota importada ainda** — o
  Anderson vai trazer os XML.
- Também em 30/09: **trava de cadastro duplicado** (CNPJ, telefone, e-mail) no banco real
  (migration `crm_trava_cadastro_duplicado`) e telefone + e-mail obrigatórios no cadastro
  novo; filtro de notas só da equipe (vendedor escrito na nota ou carteira).
- Na base real nenhuma empresa tem segmento e só 59 têm CNPJ: a importação das notas é
  o que vai completar o CNPJ; depois, rodar o "Preencher pelo nome".

## Registro de 29/09/2026, noite

- **Importação do Agendor feita** no banco real: 2.045 empresas, 28 pessoas, 3.141
  negócios, 5.537 tarefas. Conferida com o relatório do Agendor de setembro (Funil de
  Vendas): ganhos 104 / R$ 122.502,16 e perdidos 66 / R$ 150.302,78 batem; "iniciados"
  deu 493 × 521 e "em andamento" 2.342 × 2.340, provavelmente pelo que mudou no Agendor
  depois da extração.
- **Esperando o Anderson decidir:** avisos inflados no Início (943 "leads sem
  atendimento", porque o histórico com mais de 31 dias não sai pela API; 851 "negócios
  parados"). Proposta: "leads sem atendimento" só para empresas cadastradas a partir de
  01/10/2026, ou trazer o histórico por planilha (Importar → Planilha → Tarefas e histórico).
- **Lições da importação real (já corrigidas, não reintroduzir):**
  - Insert em lote precisa de `defaultToNull: false`: sem isso o PostgREST grava null
    no campo que falta num registro quando outro do mesmo lote o tem (quebrou em
    `criado_em`). Lote recusado agora é regravado um a um (`aoErro`).
  - Negócio/pessoa sem empresa procura a empresa pelo nome de reserva antes de criar
    (`nomeDeReserva`: tira "1096 - " do começo e " - NOME" em maiúsculas do fim). Antes
    cada negócio virava uma empresa; o banco foi acertado por SQL com a mesma regra.
  - **Nunca pôr nome real de cliente em teste nem em commit** (repositório público):
    os testes usam nomes fictícios no mesmo formato.
- **Visual:** `config.js` → `cores` (principal `#175b6d`, destaque `#a9c451`, do logo),
  `logo`/`logoIcone` (assets/oneclean-*.png, recortados do logo enviado) e
  `logoNoMenu: 'completo'`. Menu "Atividades" (era "Agenda"), abas de funil, painel dos
  Relatórios por funil com os nomes do Agendor.
- Pendências do Anderson e próximos passos: seção "Pendente" do `CLAUDE.md` do
  `sistemi-dalessi`.

## Arquitetura

- **Estático, sem build, sem npm.** Scripts clássicos (não módulos) carregados em
  ordem no `index.html`, compartilhando `window.CRM`, `CRMRegras`, `CRMDados`,
  `CRMPlanilha`, `CRMNfe`, `CRMXlsx`. Abrir o `index.html` direto já funciona (modo local).
- **Camadas:** `regras.js`, `planilha.js` e `nfe.js` são **puras** (rodam no Node, com teste);
  `dados.js` é a única que fala com banco; `ui.js` só interface genérica;
  `app.js` núcleo; `telas.js`/`fichas.js`/`ajustes.js` as telas.
- **Dados em memória:** carrega todas as tabelas no login (paginando de 1000 em
  1000 — limite do PostgREST do Supabase), indexa (`R.indexa`) e renderiza.
  Gravação: grava no banco e troca o registro na memória (`CRM.inserir/atualizar/
  remover`), sem recarregar tudo. Recarrega ao voltar para a janela (após 1 min) e
  a cada 5 min parado. Testado com 5.000 empresas / 30.000 atividades: telas em
  < 0,2 s. Se uma base passar de ~50 mil atividades, a hora de paginar a linha do
  tempo sob demanda chegou.
- **Render:** HTML em string, **sempre** passando texto por `esc()`. Eventos por
  delegação em `data-acao` (`CRM.acoes`). CSP proíbe `onclick=` e `style=`:
  larguras de barra vão por `data-largura` + `CRM.aplicaBarras` (CSSOM).
- **Dois modos:** `config.js` vazio = local (`localStorage`, usuário admin fictício,
  para demonstração); preenchido = Supabase com login.

## Banco (Supabase)

- `supabase/schema.sql` é a fonte da verdade, idempotente (roda de novo sem
  perder dado; recria todas as políticas `crm_*` do zero para não acumular).
- **Permissões na RLS**, não na tela: `crm_papel()`, `crm_eh_gestor()`,
  `crm_ve_empresa()` (responsável OU tem negócio nela), `crm_edita_negocio()`.
  Vendedor só insere empresa/negócio com ele mesmo de responsável. O cliente
  espelha isso só para esconder botões (`CRM.podeEditarEmpresa` etc.).
- **Rodízio** (`crm_proximo_vendedor`) é função no servidor porque o vendedor não
  enxerga a carteira dos outros.
- **Histórico de alterações** por trigger (`crm_audita`) em empresas, contatos,
  negócios, propostas, usuários, etapas, produtos. Atividades ficam de fora de
  propósito (volume); elas já são o histórico.
- **Usuários novos** só pela Edge Function `crm-usuarios` (service_role fica no
  servidor, confere se quem chama é admin ativo). Nunca pôr service_role no app.
- Ao mexer em permissão: rodar `sh supabase/teste-rls/roda.sh` (Postgres local
  que imita os papéis do Supabase; falha se aparecer "NÃO devia").
- Coluna nova: `alter table ... add column if not exists` no `schema.sql` + campo
  no formulário. Tipo novo de atividade: `TIPOS_ATIVIDADE` em `regras.js` **e** o
  `check` de `crm_atividades.tipo`. Mesmo para situações e status.

## Importação (não quebrar)

- Tudo converge para **registros normalizados** → `CRMPlanilha.planeja()` decide
  criar / completar / ignorar. Deduplicação por `externo_id` (ex.
  `agendor:org:123`, índice único parcial no banco), CNPJ, `R.chaveNome` (sem
  acento/pontuação/"Ltda"), e-mail e telefone (últimos 9 dígitos). Grafia
  diferente do mesmo cadastro vira apelido (negócio que cita "Cond. X" acha "Condomínio X").
- Padrão é **completar só o vazio**; sobrescrever é opção explícita.
- Tarefa do Agendor **sem tipo e sem prazo é "Nota"** (anotação): entra como histórico
  (`nota`, concluída), não como tarefa pendente. Na 1ª importação 54 entraram como tarefa
  atrasada; corrigidas no banco em 30/09 (eram as de `data_hora` com segundos = criação).
- Reimportar o mesmo arquivo tem que dar zero criações (teste cobre).
- `converteAgendor` lê a API v3 **defensivamente** (campo ausente = vazio). Os nomes
  de campo foram confirmados nos exemplos oficiais (`agendor/agendor-api-docs`) só
  em parte; o resto segue o padrão conhecido da v3. Se a importação real mostrar
  campo vazio que devia vir, ajustar o `converteAgendor` e reimportar (não
  duplica). O arquivo bruto guarda tudo, então não precisa extrair de novo.
- `.xlsx` lido por `xlsx-leitor.js` (ZIP + DecompressionStream + DOMParser).
  **Não trocar pelo SheetJS do npm**: a 0.18.5 tem vulnerabilidades conhecidas e a
  versão corrigida só existe no CDN deles. CSV: tenta UTF-8, cai para Windows-1252
  (CSV salvo pelo Excel brasileiro).

## Cadastro sem duplicado (pedido do Anderson em 30/09/2026)

- **Trava no banco** (`crm_barra_duplicado`, trigger em `crm_empresas`): empresa nova, ou
  CNPJ/CPF, telefone, WhatsApp ou e-mail alterado, que já seja de **outra empresa** é
  recusada — em qualquer carteira (o vendedor não enxerga a dos outros, por isso tem que
  ser no servidor). Chaves: documento só dígitos (11/14), telefone pelos **8 últimos
  dígitos** (pega com/sem DDD, com/sem o 9, com +55), e-mail minúsculo. Iguais em
  `R.chaveDoc/chaveTelefone/chaveEmail` e `crm_doc/crm_tel/crm_mail`; mudar um, mudar o outro.
- Só confere o que **mudou**: os repetidos que vieram do Agendor (55 grupos por e-mail e
  82 por telefone em 30/09) continuam editáveis; juntar em Configurações → Duplicados (que
  agora agrupa também por telefone e e-mail). A mescla apaga os repetidos **antes** de
  completar o que fica, senão a trava recusaria.
- Dado de **pessoa de contato** igual só **avisa** (síndico/comprador atende várias empresas).
- `crm_duplicado_empresa()` (RPC, só membro) devolve nome + responsável para o aviso
  enquanto digita; `crm_acha_duplicado()` é interna (sem execute para ninguém).
- Cadastro novo (Novo lead / Nova empresa) exige **telefone com DDD e e-mail**
  (`exigir_contato_cadastro`, desliga em Configurações → Geral). **CNPJ não é obrigatório**
  (no primeiro contato quase nunca se tem), mas se vier, entra na trava.
- Importações: a trava também vale. Registro repetido não para a importação; aparece na
  lista de erros do resultado (o lote é regravado um a um).

## Notas fiscais (NF-e) e faturamento

- `nfe.js` (puro, testado em `testes/nfe.test.js`): `lerXml` lê nfeProc/NFe/NFC-e e o evento
  de cancelamento (110111) por regex — o XML é gerado por máquina e regular; sem DOMParser
  para rodar no Node. `planeja` devolve o mesmo formato de plano do importador (a tela de
  conferência e a gravação são as mesmas).
- Chave de 44 dígitos é única no banco: reimportar não duplica; cancelamento que chega
  depois só marca `cancelada`. Emitente = CNPJ mais frequente nas notas de saída; nota de
  entrada, de outra empresa, de devolução (finNFe 4) ou não autorizada fica de fora.
- Cliente: CNPJ/CPF → razão social → nome → nome antes do " | " (o Agendor da OneClean
  grava "Empresa | Contato"). Achou: completa CNPJ/razão social e vira "cliente". Não
  achou: cria como cliente, com `criado_em` = data da 1ª nota e segmento sugerido
  (`R.sugereSegmento`, por palavras do nome). Produto do catálogo por código ou nome
  (opcional; só itens de CFOP de venda).
- Venda = CFOP 5/6/7 com grupo 1 ou 4 (`R.cfopDeVenda`); remessa, bonificação e "outras
  saídas" não entram nos totais nem no top de produtos. `R.faturamento` faz o relatório
  (top clientes, segmento, produtos por valor e quantidade, vendedor = responsável pelo
  cliente, cidades, por mês); `R.indexa` passa as "compras anteriores" da empresa a vir
  das notas quando ela tem nota (senão, dos negócios ganhos).
- **Quais notas entram** (pedido do Anderson: só a equipe do CRM, sem venda direta nem
  vendedor externo): `op.filtro` = `vendedores` (nome do vendedor escrito na nota — a NF-e
  não tem campo próprio; lemos `<obsCont xCampo="Vendedor">` ou "Vendedor: 012 - NOME" no
  `infCpl`; batem com a equipe por nome completo ou primeiro nome único), `carteira` (cliente
  já cadastrado com responsável da equipe; não cria cliente) ou `todas`. Padrão: `vendedores`
  se as notas trazem o nome, senão `carteira`. Cliente novo fica com o vendedor da nota.
  O formato real do XML da OneClean ainda não foi visto: conferir com uma nota de verdade.
- RLS: gestor importa e corrige; vendedor lê as notas das empresas que vê (`crm_ve_nota`
  para os itens). Mesclar empresas leva as notas junto.
- Volume: as notas e os itens também carregam na memória no login. Com dezenas de
  milhares de itens ainda vai; se passar de ~100 mil itens, agregar no servidor (view)
  em vez de trazer item a item.

## Segurança (lições da auditoria de 11/09/2026 aplicadas)

- Nenhuma política `using (true)`; `anon` sem privilégio em tabela nenhuma;
  SECURITY DEFINER sempre com `search_path` fixo e sem execute para `anon`.
- CSP estrita no `index.html`; única origem externa de script é o supabase-js
  **com versão exata e SRI** (mesmo hash da JJ Solene, conferido contra o pacote
  do npm). Trocar de versão = recalcular o hash.
- Cadastro público do Auth **desligado** no painel (não dá por SQL).
- Token do Agendor nunca entra no repositório; o extrator lê da linha de comando.

## Verificar antes de commitar

```
node --test testes/*.test.js           # regras e importador (rodar também com TZ=UTC)
sh supabase/teste-rls/roda.sh           # se mexeu no schema/permissões
```
e abrir o `index.html` no modo local (menu do usuário → "Carregar dados de
exemplo") para passear pelas telas. Não há build nem lint.
