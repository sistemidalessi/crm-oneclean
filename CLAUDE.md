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

## LIMITE DE TRÁFEGO DO SUPABASE (07/10/2026) — recarga leve

O painel do Supabase mostrou **"Exceeding usage limits"** (plano grátis). Causa: cada computador baixava
**tudo** a cada 5 minutos e ao voltar para a janela — ~870 cargas completas por dia, ~24 MB cada (14 MB só de
`crm_nota_itens`); o banco tem só 33 MB, o problema era o **tráfego de saída** (5 GB/mês no grátis).
Correção (`dados.js` `carregarMudancas`/`aplicaMudancas`/`marcaRecarga`, `app.js` `CRM.recarregar`):
a recarga automática traz só as linhas com `atualizado_em` depois da marca (o mais novo visto, relógio do
banco, menos 2 min); tabelas pequenas ou sem `atualizado_em` confiável (`INTEIRAS`: usuários, config, etapas,
opções, modelos, metas, filtros, **títulos** — a data deles é a da listagem do FKN —, campanhas e envios de
e-mail) vêm inteiras; **de hora em hora** a conferência do que foi apagado em outro computador (só as chaves).
Carga completa só ao entrar (login zera a marca) e em "Recarregar dados". Teste: `testes/recarga.test.js`.
**Plano Pro** contratado pelo Anderson em 07/10 (US$ 25/mês, ciclo novo 07/10–07/11, 250 GB de tráfego, backup diário, limite de gastos ligado: não cobra extra). **Não voltar** a recarregar tudo em timer. Tabela nova grande: entra em `PARCIAIS` (precisa de
`atualizado_em` com gatilho).

## INCIDENTE 01/10/2026 (manhã): CRM vazio para todos os logins — resolvido

Primeiro dia sem o Agendor: com a equipe toda abrindo o CRM, as leituras passavam do
`statement_timeout` (8 s do papel `authenticated`) e o banco devolvia 500. O app mostrava as telas
vazias. **Nenhum dado se perdeu.** Causa: as políticas de leitura chamavam `crm_ve_empresa(id)` /
`crm_ve_nota(id)` **uma vez por linha** (função SECURITY DEFINER não é embutida pelo Postgres), cada
uma com subconsultas; uma página de 1.000 atividades levava 2,2 s para uma vendedora, e os itens de
nota, ainda mais. Correção (migrations `crm_rls_rapida`, `crm_rls_rapida_insert_returning` e
`crm_rls_rapida_negocios_indices`, já no `schema.sql`): carteira em conjunto
(`crm_empresas_minhas()`, `crm_negocios_meus()`, `crm_notas_minhas()`, usadas como
`coluna in (select ...)`, calculadas uma vez por consulta) e `(select crm_eh_*())` /
`(select auth.uid())` em todas as políticas. Leitura caiu para milissegundos; o mesmo acesso de
antes (ensaio de ataque com saída idêntica à do schema antigo; contagens por usuário no banco real
iguais). **Travas para não voltar:** `testes/rls-rapida.test.js` reprova política de leitura com
`crm_ve_*` ou papel/`auth.uid()` fora de subconsulta; `supabase/teste-rls/volume.sql` (roda.sh)
carrega ~4× o volume da OneClean e falha se alguma leitura passar de 1 s (com o schema antigo,
27 s). No app: leitura que falha por demora/rede tenta de novo 3 vezes (`comTentativas` em
`dados.js`); sem carga nenhuma, a tela diz "seus dados estão guardados" e tenta sozinha; com dados
antigos, só aparece a faixa `#faixaCarga`. Ao criar política nova: copiar o formato das que existem.

## ONDE PARAMOS (01/10/2026, manhã) — retomar daqui

**Estado:** 1º dia da equipe só no CRM. De manhã o CRM abriu vazio (políticas lentas; ver
INCIDENTE acima) e foi resolvido e travado por teste. No mesmo dia: versão nova sem Ctrl+F5
(`ferramentas/carimba-versao.js`), sinal de vida do vigia (**vigia do servidor atualizado às
10:25, sinal chegando**), cliente da nota × cadastro antigo (39 mesclados; conferência em
Duplicados), matriz/filial (`grupo_id`), tipo de cliente (novo/recorrente/reativado/inativo).
Vigia agora com `--desde 202512`: a pasta só tem notas desde dez/2025 (CNPJ novo); dezembro
tinha 1 nota, fora da equipe — o histórico da equipe começa em jan/2026. O sistema de gestão da
OneClean é o **FKN** (SIFWin, da FKN Informática) — com N; não escrever "FKM".

**Feito pelo Anderson em 01/10:** conferência de Duplicados (39 vazios apagados, 65 cadastros
juntados, 26 marcados "outra empresa", grupos ligados), chave de teste excluída, `pg_net` removido,
token do Agendor revogado (novo gerado e não usado), `C:\Migracao` apagada; o backup do CRM já não
estava na pasta do Financeiro. Supabase conferido (cadastro público e login anônimo desligados, confirmação de e-mail ligada,
Site URL e Redirect URL = endereço do Pages). Estoque real subido em 01/10 (listagem do FKN).

**01/10, tarde — FKN no CRM (feito):** listagem cadastral de produtos (SIFN108) em Compras
(fornecedor, linha, família, mínimo/máximo, já pedido, caixa fechada, pedido por fornecedor) e
**contas a receber** (SIFN016, tabela `crm_titulos`) na ficha, Recompra, Fila do dia e Gestão —
ver "FKN: listagem de produtos e contas a receber" abaixo. A OneClean tem duas razões sociais no
FKN (DISTRIBUIDORA e BRASIL): **as duas valem como OneClean** (decisão do Anderson); as notas no CRM
são todas de um CNPJ só e os números das duplicatas do contas a receber são os
números dessas notas (174 títulos: 172 ligados pela nota, 2 pelo CNPJ, nenhum sem cliente).
**Feito em 01/10:** listagem de produtos e contas a receber subidos (depois, pelo vigia)
(os dois botões aceitam o CSV salvo pelo FKN).

**Quadros clicáveis (01/10, pedido da líder) — feito:** em Relatórios todos os quadros (vendido,
faturado, ganhos, iniciados, perdidos, taxa, ciclo, em andamento, previstas, leads, clientes,
atividades com pendentes/atrasadas) abrem a lista do que contam (`detalhe.js`, `CRM.mostraLista`,
janela `#dlgLista`; cada linha abre a ficha; exporta CSV). As listas saem do próprio cálculo do
quadro (`R.dashboard(...).listas`, `R.faturamento(...).lista`) — número e lista sempre batem;
não recalcular à parte. Gestão: faturamento do mês/ano, clientes que compraram, negócios abertos,
conversão. Compras: os quadros aplicam o filtro (sugestão, em falta, parado, curva A). O Início já
era clicável (rola até a lista).

**E-mail para todos (01/10, pedido dos vendedores):** o botão E-mail da empresa (topo da ficha,
listas, Recompra, Fila, sequência sem pessoa) abre o e-mail para **todos** os endereços cadastrados:
o da empresa e o de cada pessoa (principal primeiro), separando campos com vários (";", ",",
espaço) e sem repetir (`CRM.fichas.emailsDe`, `linkEmail`). O botão na linha de uma pessoa (ou
tarefa ligada a uma pessoa) continua só para ela. O botão mostra quantos são: "E-mail (15)".

**Arquivos do FKN pelo vigia (01/10) — feito:** `vigia-notas.js --pasta-fkn` olha uma pasta e
manda `{fkn:{nome, base64}}` à `crm-notas` quando um CSV muda (o mais novo de cada tipo; outro
CSV qualquer é ignorado). A função lê com **`fkn.js`** (leitores puros tirados de `gestao.js` e
`financeiro.js`; agora fixado no motor junto com regras.js e nfe.js — mexeu, refixar e publicar)
e troca o retrato de `crm_estoque` / `crm_titulos`. Travas: listagem com < metade dos produtos
atuais, contas a receber sem TOTAL GERAL ou com soma diferente → 422, nada muda, e o vigia não
insiste até o arquivo mudar. Entrega aparece em Integrações → Últimas entregas. Testado: vigia
contra servidor falso (testes/vigia.test.js) e a função transpilada no Node com banco falso e os
arquivos reais. **Ligado no servidor em 01/10 15:18** (vigia `2026-10-01b`, `--pasta-fkn D:\sistema\CRM-FKN`,
na rede `\\Servidor\sistema\CRM-FKN`); 1ª entrega real às 15:24: 174 títulos e 2.265 linhas de
produtos. Para atualizar: puxar o relatório no FKN e salvar o CSV nessa pasta.
**Lembrete (01/10, pedido do Anderson):** de segunda a sexta, a partir das 7h (manhã) e das 13h
(tarde), se a última entrega de um dos dois relatórios for de antes do começo do turno, Compras
mostra a faixa "Hora de puxar os relatórios do FKN" e o menu Compras ganha um "!" (admin e
comprador). Datas pela função `crm_fkn_atualizado()` (o comprador não lê títulos); regra em
`CRMDados.lembreteFkn`; pasta mostrada = `cfg.pasta_fkn` (Configurações → Geral → Notas fiscais).
O FKN não gera relatório sozinho. Perguntar à FKN Informática se exporta por linha de comando: **adiado por decisão do Anderson (02/10)**, não insistir.
**Colinha e conferência (02/10, pedido do Anderson):** em Compras, a "Colinha: como puxar os
relatórios do FKN" (passo a passo no SIFWin + checklist de cada um) abre no topo junto com o aviso e
fica fechada no fim da tela no resto do tempo. Como o relatório é puxado à mão, `fkn.js`
(`conferirListagemProdutos`, `conferirContasReceber`) recusa o arquivo com opção faltando —
produtos sem Estoque/pendências, Índices/preços ou Fornecedor; contas a receber que não seja "Em
aberto", com período preenchido, sem os dados cadastrais (CNPJ) ou sem TOTAL GERAL; e menos de 40%
dos títulos atuais (filtro esquecido) — tanto pelo vigia quanto pelo botão. A recusa vai para
`crm_integracao_log` (`resumo.fkn_recusa`, `fkn_tipo`) e `crm_fkn_situacao()` (jsonb: datas +
recusas mais novas que a última entrega boa) faz o aviso de Compras dizer o que marcar.

**A fazer:** fase 3 (WhatsApp oficial da Meta, e-mail, Google Agenda) e IA.

- **Vigia de notas pronto** (seção "Vigia de notas" abaixo e no README): Edge Function
  `crm-notas` publicada no banco real e testada (chave errada 401, chave certa 200; os
  registros de teste foram apagados), tabelas `crm_integracoes`/`crm_integracao_log`
  (migration `crm_integracoes_vigia_notas`), tela Configurações → Integrações e
  `ferramentas/vigia-notas.js` testado contra um servidor falso com os XML reais de setembro.
  **Instalado e rodando no servidor da OneClean em 30/09 às 12h:** Windows Server 2012 R2
  (por isso Node **18.20.8**, o último que instala nele; PowerShell 4 sem `curl.exe` e
  sem TLS 1.2 por padrão), `C:\CRM\vigia-notas.js`, pasta
  `D:\SISTEMA\Unimake\uninfe30\63237702000103\Enviados\Autorizados`, tarefa do Windows
  "CRM - vigia de notas" (ao iniciar, SYSTEM, sem limite de tempo). 1ª volta: 2.558 XML
  de 2026 → **857 notas da equipe, R$ 1.015.485,30**, zero erro (setembro: 119 notas,
  R$ 125.254,36 — igual à conta feita com o .rar); 137 empresas completadas, 86 clientes
  novos, CNPJ em 184 empresas (eram 59), 943 produtos no catálogo. Chave trocada às 13:51
  (a primeira apareceu em fotos) e conferida; excluir a chave apaga o registro de entregas dela (cascade), as notas ficam.
- Setembro nos XML reais: 303 notas; com o filtro da equipe entram **119 (R$ 125.254,36)** —
  Isabela 50, Renata 32, Alysson 28, Sarah 9 —; ficam de fora DIRETO (130) e SILMARA
  (vendedora externa, 54). Bate com o Agendor de setembro (R$ 122.502,16). O FKN escreve
  o vendedor no `infCpl` ("…;VENDEDOR: ALYSSON;COD. CLIENTE: 01153;").
- Duplicados: 31 grupos "quase certos" mesclados com autorização (2.045 → 2.011 empresas),
  backup em `crm_backup.mescla_empresas` (schema fora da API). Os demais ficam para
  conferência manual em Configurações → Duplicados.

- **Etapas ajustadas em 30/09 (pedido do Anderson):** Funil de Vendas — LDR 10%, CONTATO FEITO 20%,
  LISTA SOLICITADA 40%, ORÇAMENTO ENVIADO 55% (histórico: 207 ganhos × 168 perdidos), COMPRA
  FUTURA 30%, CARTEIRA 80%; Funil de Pós-Vendas fica 0% (pedido já vendido, 306 abertos /
  R$ 371 mil — não é previsão de venda). Funil padrão "Vendas" (sem negócio) apagado. A Gestão
  conta "negócios abertos" e conversão só do funil de vendas (o primeiro que não é pós-venda).
- **Papel comprador (30/09, noite) — feito:** aba **Compras** própria (admin e comprador), com
  pesquisa por produto/código, "o que mostrar" (sugestão de pedido, em falta, parado, vendidos,
  todos), curva, prazo (15–90 dias), ordenação e exportação do que está filtrado; clientes com
  compra prevista e tendência. A Gestão ficou com um resumo de compras e link. Comprador vê só a
  aba Compras (sem busca, "+ Novo" e sino). Banco (migration `crm_papel_comprador`):
  `crm_eh_ativo()` (qualquer usuário: lê config/etapas/opções/produtos/modelos/equipe) ×
  `crm_eh_membro()` (só admin/gestor/vendedor: cria e mexe em cadastro, negócio, tarefa);
  `crm_eh_comprador()`; notas e itens legíveis pelo comprador; `crm_estoque` admin ou comprador;
  `crm_clientes_compras()` dá ao comprador só id/nome/situação/segmento/ciclo/responsável das
  empresas (o app troca `D.empresas` por isso); rodízio nunca cai no comprador; `crm-usuarios`
  aceita o papel e cria comprador sem receber leads. Ataque de RLS estendido (comprador lê notas,
  grava estoque, não vê empresa/contato/negócio/tarefa/histórico, não cria cliente nem tarefa;
  vendedora e gestora não veem estoque) — "OK: nenhuma permissão furada".
- **Compras — ainda a fazer:**
  1. ~~Fornecedor/grupo nos filtros~~ — feito em 01/10 pela listagem cadastral (SIFN108).
  2. Estoque automático: o FKN não agenda a exportação. Opções: o vigia manda o
     `exp_estoque.csv` sozinho quando o arquivo muda (alguém ainda exporta à mão no FKN) +
     lembrete para quem exporta (ex.: aviso na Gestão quando o estoque tiver mais de 3 dias, já
     existe o selo "desatualizado"; e/ou tarefa recorrente para o comprador).
- **Extração final do Agendor feita e importada em 30/09 ~17h** (reextração com "Atualizar
  negócios e tarefas"): Agendor 2.029 empresas / 28 pessoas / 3.172 negócios / 5.420 tarefas
  recentes; importou 1 empresa nova + 2 completadas, 31 negócios novos + 10 atualizados, 143
  tarefas novas + 114 atualizadas. CRM ficou com 2.098 empresas, 3.172 negócios (= Agendor),
  5.720 atividades. Setembro no CRM: ganhos 111 / R$ 127.871,57, perdidos 68 / R$ 151.088,92.
  A API do Agendor passou a recusar o histórico por empresa (erro 400 pedindo filtro de data):
  sem efeito, o histórico antigo já tinha entrado em 29/09. Feito em 01/10: token do Agendor
  revogado, `C:\Migracao` apagada e backup fora da pasta do Financeiro.

## Registro de 30/09/2026, manhã

- **Feito:** Relatórios com "Total vendido" e linha "Total da equipe" na tabela por
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
  que imita os papéis do Supabase; falha se aparecer "NÃO devia" ou se alguma leitura ficar
  lenta no teste de volume).
- **Versão nova sem Ctrl+F5:** o `index.html` leva `?v=` em cada arquivo e a versão geral em
  `<meta name="crm-versao">`, carimbados por `node ferramentas/carimba-versao.js` (rodar antes de
  todo commit que mexe em .js/.css/logo; `testes/versao.test.js` reprova se esquecer). O app
  aberto confere a versão publicada a cada ~4 min e ao voltar para a janela; se mudou, recarrega
  sozinho quando não há janela aberta nem campo com texto (`confereVersao` em `app.js`). Se o
  navegador insistir na versão antiga, não entra em laço: mostra a faixa `#faixaVersao`.
- **Vendedor da nota; DIRETO e externos (01/10/2026):** `crm_notas.vendedor_nome/vendedor_id` (o
  "VENDEDOR: …" do infCpl). Faturamento (Relatórios) e Gestão contam a venda para quem vendeu; sem
  vendedor, a carteira. `crm_usuarios.nomes_nota` = como o usuário aparece na nota quando não é pelo
  nome (Anderson = `DIRETO`; Configurações → Equipe, "Nome na nota fiscal"). Vendedor vê as notas da
  carteira **e** as que vendeu (`crm_notas_minhas`, política `le`). Nota já importada sem vendedor é
  completada quando chega de novo (apagar `vigia-notas-estado.json` no servidor reenvia tudo, sem
  duplicar). Silmara (externa) entra quando tiver usuário (casa pelo primeiro nome).
  **Feito em 01/10:** Silmara é usuária (vendedor, equipe "Vendas Externas", fora do rodízio de
  leads) e o Anderson confirmou em 02/10 que **ela entra no faturamento mesmo sendo externa**: as
  notas dela já estão todas ligadas a ela (440, R$ 661.498,29 em 2026 até 02/10; carteira de 71).
  **Ex-vendedores** (`cfg.vendedores_antigos`, Configurações → Geral → Notas fiscais; hoje NICOLLY,
  NICOLI BIANCA, NICOLAS, JULIA): as notas entram com `vendedor_nome` e **sem** `vendedor_id` — contam
  no total e em Compras como "NOME (ex-vendedor)", não vão para a carteira de ninguém (pedido do
  Anderson: não misturar com o DIRETO). Os clientes deles sem dono foram divididos como lead entre as
  vendedoras do rodízio.
- **Compras:** cabeçalho fixo (`.tabela-fixa`) e ordenação por coluna (clique; de novo inverte).
- **Tipo de cliente (01/10/2026, pedido da equipe):** `perfil.js` (fora do motor das notas) classifica
  pelas compras (notas de venda + negócios ganhos, a até 3 dias = uma): novo (1ª compra nos últimos
  `dias_cliente_novo`, padrão 90), reativado (voltou nesse prazo depois de mais que `dias_inativo`
  sem comprar), inativo, recorrente, sem compra. Ficha (selo com a data), coluna/filtro/ordem em
  Empresas e exportação. Testado em `testes/perfil.test.js`.
  Limite: as notas começam em 06/01/2026 e os ganhos do Agendor em 30/06/2026; quem comprava em 2025 e
  voltou agora aparece como "novo" até as notas antigas entrarem (vigia com `--desde` anterior).
- **Cliente da nota × cadastro antigo; matriz e filial (01/10/2026):** o Agendor quase não tinha CNPJ
  (1.889 de 1.987); a 1ª nota de cliente antigo criava cadastro repetido (New Aço + 38 mesclados
  por SQL com backup em `crm_backup.mescla_empresas`, lote "notas x agendor 01/10"; análise em
  `crm_backup.analise_duplicados_notas`). Agora `nfe.js` acha o cliente nesta ordem: CNPJ → nome igual
  (**não** se o cadastro tem outro CNPJ: é outra unidade) → **mesma raiz de CNPJ** (8 dígitos) = filial:
  cadastro próprio com `grupo_id` do principal e a mesma carteira → **parecida** (`N.parecida`: cliente
  sem CNPJ da mesma vendedora, domínio do e-mail no nome ou 2 palavras próprias; só se for UM; a razão
  social da nota vira a oficial). Configurações → Duplicados: seção "Clientes das notas × cadastros
  antigos" (juntar / mesmo grupo / outra empresa, esta em `cfg.nao_mesclar_notas`) e "Cadastros vazios
  de mesclas" (`(mesclado em …)`, apagar). Ficha mostra o grupo e o faturado do grupo em 12 meses.
- **Sinal de vida do vigia (01/10/2026):** `vigia-notas.js` manda `{sinal:true, info}` ao ligar e a
  cada 30 min (entrega de nota também conta); a `crm-notas` grava `crm_integracoes.ultimo_sinal` e
  `sinal` (versão, máquina, XML esperando, última falha) sem carregar o motor. O admin carrega
  `store.vigias()` no `recarregar` e vê a faixa `#faixaVigia` se passar de 75 min
  (`CRMDados.situacaoVigia`, testado em `testes/vigia.test.js`, que roda o vigia contra um servidor
  falso). Teste com chave temporária: a ferramenta do Supabase trava em DELETE/DROP (pede
  confirmação); desligar a chave e trocar o hash com UPDATE e pedir ao Anderson para excluir pela tela.
- **Política de leitura nunca chama função por linha** (`crm_ve_empresa(id)` etc.): usar
  `coluna in (select public.crm_empresas_minhas())` e `(select public.crm_eh_gestor())`. Ver o
  incidente de 01/10/2026 no topo; `testes/rls-rapida.test.js` barra.
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
- **Reextração do Agendor** (30/09/2026): `op.atualizarTabelas = ['negocios', 'atividades']`
  (padrão ao abrir um arquivo do Agendor; caixa "Atualizar negócios e tarefas com o que mudou
  na origem") faz o arquivo valer mais que o CRM **só** nessas tabelas: etapa, ganho/perdido,
  valor, fechamento (reaberto limpa `fechado_em`/`motivo_perda`; ganho novo marca a empresa
  como cliente), tarefa concluída/remarcada. Empresas e pessoas seguem "completar o vazio"
  (senão o "Lead" do Agendor desfaria o "cliente" e o CNPJ vindos das notas). Comparação com
  `mesmoValor` (o banco devolve `…+00:00` e números como texto: sem isso tudo "mudaria").
- `planeja` trabalha em **cópias** de `D` (a tela replaneja a cada opção trocada; antes o
  1º plano marcava os registros e o 2º não via mais as mudanças).
- Mesclar empresas guarda o `externo_id` dos cadastros apagados em
  `crm_empresas.externos_mesclados` (preenchido para as 31 mescladas de 30/09 a partir de
  `crm_backup`); o planejador acha a empresa por esses códigos, então reimportar não recria.
- Empresa nova do arquivo com telefone/e-mail de uma que já existe (a trava do banco recusaria
  e os negócios/tarefas dela se perderiam) vai para a existente (`achaPorContato`).
- **Planilha exportada do Agendor** (cabeçalhos "Código da empresa/do Negócio/da atividade"):
  `P.ehPlanilhaAgendor` + `P.prefixaAgendor` transformam os códigos nos mesmos ids da API
  (`agendor:org:…`, `agendor:negocio:…`, `agendor:tarefa:…`), então reimportar a planilha não
  duplica o que veio pela API. Mapeamento exato respeita a ordem dos sinônimos (a coluna
  "WhatsApp" fica com o WhatsApp mesmo havendo "Celular" antes). Conferido em 30/09 com as
  4 planilhas reais: mesmos dados da API; só 36 atividades novas (do dia) e "E-mail 2" (3%)
  a mais. **Não trazem o histórico concluído antigo** (só pendentes e a última semana).
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
  agora agrupa também por telefone e e-mail, mostra o motivo e a carteira de cada um,
  pré-marca o cadastro com mais negócios/histórico e tem "Mesclar os quase certos").
  **"Quase certo" (`R.mesmoCliente`) = mesmo CNPJ, ou mesmo e-mail E telefone E nome
  compatível** (`R.nomesCompativeis`: palavras do nome sem o contato após "|" e sem genéricas,
  uma contida na outra, sem marca de unidade na diferença). **Só e-mail + telefone NÃO basta**:
  na base da OneClean a mesma síndica/compradora atende vários condomínios, filiais e
  unidades (achado ao revisar os nomes em 30/09, antes de mesclar). Em 30/09: 144 pares por
  e-mail/telefone; **31 grupos mesclados (34 cadastros saíram, 2.045 → 2.011)** com backup em
  `crm_backup.mescla_empresas` (schema fora da API: empresa inteira + ids dos filhos movidos,
  para desfazer); o resto (unidades, filiais, condomínios) ficou para conferência manual. A mescla apaga os repetidos **antes** de
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
  grava "Empresa | Contato"). Achou: **completa o cadastro com a nota** (regra do Anderson):
  CNPJ, razão social, e-mail, telefone (se não tiver nenhum) e endereço (inteiro, se não
  tiver CEP nem rua), sempre só o vazio, e vira "cliente". Dado da nota que já é de **outro**
  cliente não entra (a trava de duplicado recusaria o cadastro inteiro); conta em
  `dadosDeOutroCadastro` e aparece na conferência como possível duplicado. Não
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
  se as notas trazem o nome, senão `carteira`; `auto` decide **nota a nota** (com vendedor
  escrito → `vendedores`; sem → `carteira`) e é o padrão do vigia. Cliente novo fica com o
  vendedor da nota. O FKN da OneClean escreve "VENDEDOR: NOME;" no `infCpl` (conferido
  com os XML reais de setembro de 2026).
- RLS: gestor importa e corrige; vendedor lê as notas das empresas que vê (`crm_ve_nota`
  para os itens). Mesclar empresas leva as notas junto.
- Volume: as notas e os itens também carregam na memória no login. Com dezenas de
  milhares de itens ainda vai; se passar de ~100 mil itens, agregar no servidor (view)
  em vez de trazer item a item.

## Avisos do sino (30/09/2026)

- Base antiga importada não é aviso. `cfg.leads_desde` (Configurações → Geral; na OneClean
  `2026-10-01`, gravado em `crm_config`): só lead cadastrado a partir dessa data conta como
  "sem atendimento"; os 910 leads antigos sem contato ficam como lista de prospecção.
- `cfg.dias_esquecido` (padrão 60; 0 desliga): negócio parado há mais que isso (sem mudar de
  etapa nem ter contato com a empresa — `R.ultimoMovimento`) sai de "Negócios parados" e do
  sino e vai para o cartão fechado "Negócios esquecidos" do Início, com o botão de encerrar
  todos como perdidos (motivo à escolha; `fechado_em` = data do último movimento, para não
  inflar os perdidos do mês atual). Em 30/09: 864 parados → ~156 no aviso, 602+ esquecidos.
- Sino esperado depois disso: ~440 na equipe toda (atrasadas 141, parados ~156, clientes sem
  contato 83, recompra 59), antes ~2.050.

## Recompra inteligente (30/09/2026)

- `R.ritmoCompra(datas)`: mediana dos intervalos entre compras (compras a até 3 dias contam
  como uma; precisa de 3; limitado a 7–180 dias). `R.indexa` grava `resumo.ritmo` (pelas
  notas; sem nota, pelos negócios ganhos). `R.cicloRecompra(e, r, cfg)` = ciclo do cadastro
  > ritmo > padrão — usado no aviso, no lembrete ao ganhar venda e nas telas.
- Aviso "Hora da recompra": vence 3 dias antes do ciclo; some depois de 2 ciclos e do prazo de
  inativo (vira cliente sumido); ordenado pelo atraso.
- `R.itensHabituais(ix, empresaId)`: itens de venda (CFOP) das últimas 6 notas que aparecem em
  pelo menos metade delas, até 5, com a quantidade mais comum. `R.textoItens` monta as linhas
  "• Detergente neutro 5L — 4 GL" (`R.nomeDeItem` tira o caixa-alta da nota).
- Botão "Recompra" (Início e ficha): WhatsApp com `cfg.modelo_recompra` (Configurações → Geral;
  variáveis {saudacao} e {itens}, que também valem nos modelos de mensagem), registra no
  histórico e agenda "Retorno da oferta de recompra" em 2 dias (tira o cliente da lista).
- Em 30/09: 103 clientes com 3+ compras nas notas = 90% das notas; ritmo médio ~32 dias.

## Fila do dia (30/09/2026)

- Aba "Fila do dia" (2ª do menu; as teclas 2–9 andaram uma casa): um cliente por vez, montado
  de `R.alertas` na ordem atrasadas → de hoje → recompra → lead novo → sem contato → parado,
  uma entrada por empresa (os outros motivos aparecem em "Também"). O item sai sozinho quando
  resolvido (tarefa concluída, contato registrado, retorno agendado); "Pular" vale só até
  recarregar. Conta "contatos registrados hoje" e o progresso desde que a fila foi aberta.

## Gestão — só administrador (30/09/2026)

- `gestao.js` (carregado depois de `telas.js`): parte pura `CRMGestao.painel` / `CRMGestao.compras`
  (testada em `testes/gestao.test.js`) e a aba "Gestão" (última do menu; o filtro em
  `renderAgora` esconde de quem não é admin e a tela se recusa a desenhar para os outros).
  Não mexe em `regras.js` de propósito: mudar `regras.js` obriga a refixar a `crm-notas`.
- Painel: faturamento do mês pelas notas × o mesmo ponto do mês passado, projeção, ano,
  clientes (novos = 1ª nota no mês), negócios abertos e conversão (`R.dashboard`), equipe
  (faturamento pela carteira do cliente, meta, contatos no mês e hoje, atrasadas, clientes
  ativos 90 dias; admin fora da tabela), tops do ano (`R.faturamento`), fiéis que sumiram
  (ritmo, mais de 2 ciclos sem comprar; "em risco" = total comprado ÷ meses como cliente).
- Compras: curva ABC de 12 meses (o item que cruza os 80% é A; B até 95%), demanda prevista
  (clientes com ritmo cuja próxima compra cai em 15/30/45/60 dias, inclusive os atrasados que
  não sumiram, somando os itens habituais) e tendência (90 dias × 90 anteriores, ±25%, com
  pelo menos 10 unidades). Exporta demanda, ABC, pedido e parado em CSV.
- **Estoque do FKN** (30/09/2026): o FKN (SIFWin, COBOL Micro Focus, dados em .DAT/.IDX — não dá
  para ler direto) exporta a posição de estoque em CSV Windows-1252 em
  `\\Servidor\sistema\SIFN\dados\exp_estoque.csv` (`CODIGO;NOME DO PRODUTO;UNIDADE;LOCALIZAÇÃO;CUSTO;ESTOQUE`,
  código "010503.0" = "010503" da nota; CUSTO = custo total do saldo). Botão "Atualizar estoque"
  na Gestão → `CRMGestao.lerEstoque` → `store.salvarEstoque` (tabela `crm_estoque`, só admin,
  retrato: upsert por código e apaga o que saiu). Sugestão de pedido: precisa = max(previsão dos
  clientes, consumo médio de 90 dias × horizonte); comprar = precisa − saldo (negativo conta 0).
  Também "Em falta" (vendeu em 90 dias e saldo ≤ 0) e "Estoque parado" (saldo sem venda em 90 dias).
  Em 30/09: 1.686 produtos, R$ 312,5 mil a custo, 40 com saldo negativo. Próximo passo: o vigia
  mandar o CSV sozinho quando o arquivo mudar (hoje é pelo botão).

## FKN: listagem de produtos e contas a receber (01/10/2026)

- **Listagem cadastral de produtos (SIFN108)** — no FKN: Cadastros → Produtos → Listagem
  cadastral, salvar em CSV (Windows-1252). É relatório, não tabela: um bloco por produto
  (`código;variante;nome;fantasia;situação;linha;família;`, depois linhas `ESTOQUE:;mín: …`,
  `IND: … comp: … cus: … ven: …`, `Fornecedor: 00059 NOME`, `localiz:`, `últ.entrada/últ.saída`).
  `CRMGestao.lerListagemProdutos` (o botão de Compras escolhe sozinho entre ela e o CSV simples
  `exp_estoque.csv`: `lerArquivoEstoque`). Entra o ativo e o inativo com saldo ou pedido.
  Colunas novas em `crm_estoque` (situacao, linha, familia, fornecedor_cod, fornecedor,
  estoque_min/max, pend_cliente/fornecedor, custo_unit, custo_compra, preco_venda, ult_entrada/saida);
  o CSV simples não mexe nelas (upsert só das colunas que manda).
- **Saldo × atual:** o FKN dá `atual` e `saldo`; **saldo = atual − pendente de cliente** (já
  reservado). Usamos o saldo.
- **Embalagens (variante 1, 2, 3):** o mesmo código tem a unidade (variante 0, a que sai na nota)
  e as caixas fechadas ("CX C/4", "CX 2"…), gravadas como `010284.1`, `.2`. **A caixa é o MESMO
  estoque da unidade visto em caixas** (saldo, atual, pedido, reservado, mínimo e máximo da caixa =
  os da unidade ÷ fator, sem fração): conferido em 15/10/2026 nos 574 pares da listagem real, todos
  batem. Até 15/10 o `juntaVariantes` somava a caixa na unidade e **contava o estoque duas vezes**
  (Estoque a custo R$ 383 mil → real R$ 275 mil; parado R$ 98 mil → real R$ 79 mil; a sugestão de
  compra saía a menos em ~390 produtos). Agora a caixa só dá o fator (sugestão em caixas e o "= N cx
  de F" embaixo do saldo) e some da lista. **Nunca somar a caixa de novo** nem separá-la (aparecia
  como "parada").
- **Conta de compra:** comprar = max(precisa, mínimo do FKN) − saldo − já pedido ao fornecedor
  (saldo negativo conta 0); inativo no FKN não entra; "pelo mínimo" quando foi o mínimo que mandou.
  **Pedido por fornecedor:** a sugestão agrupada por fornecedor, com exportação de cada pedido;
  clicar no nome filtra a tabela. Filtros de fornecedor e linha; "Abaixo do mínimo" e "Já pedidos".
- **Contas a receber (SIFN016)** — no FKN: Contas a receber por cliente → **Em aberto** →
  "listar os dados cadastrais dos clientes" → salvar em CSV. Blocos `CLIENTE: código NOME;TEL;VEND:`,
  `CNPJ....:`, títulos `002531/01;28/09/26;453,00;26/10/26;atraso;BOLETO;`, `TOTAL GERAL`.
  `financeiro.js` (`CRMFinanceiro`, puro e testado): lê, confere a soma com o total geral, liga ao
  cliente (nota de mesmo número e CNPJ; senão o CNPJ, preferindo o cadastro com mais notas) e
  resume. Tabela `crm_titulos` (retrato: upsert por duplicata e apaga o que não veio = pago).
  **RLS:** gestor/admin leem tudo, vendedor só os da carteira (`empresa_id in (select
  crm_empresas_minhas())`), comprador nada; só admin importa; gestor altera (juntar duplicados
  leva os títulos). Mostra: selo vermelho e seção na ficha, selo na Recompra e na Fila do dia
  ("combine o pagamento antes de oferecer pedido novo"), cartão na Gestão (em aberto, vencido,
  vence em 7 dias, vencidos por cliente, por vendedora, sem cadastro, exportar vencidos).
  O atraso é contado do vencimento até hoje: entre uma importação e outra, um título pago ainda
  aparece — por isso a data da atualização vai junto.

## Títulos direto das parcelas da nota (02/10/2026)

- A NF-e traz a cobrança: `<cobr><dup><nDup>001</nDup><dVenc>…</dVenc><vDup>…</vDup>`. O FKN numera
  001, 002…, e no contas a receber a duplicata é **número da nota com 6 dígitos / parcela com 2**
  (nota 2527 → `002527/01`, `/02`, `/03`, mesmos vencimentos e valores — conferido no servidor).
- `nfe.js`: `lerXml` devolve `parcelas` e `forma_pagamento` (tPag → portador: 15 BOLETO, 17 PIX…);
  `planeja` cria `plano.criar.titulos` (origem `nota`) para nota **nova**, de venda e não cancelada;
  cancelamento → `plano.titulosCancelados` (prefixo `002527`) e os títulos `origem='nota'` saem.
- Gravação: vigia (`crm-notas`) faz upsert com `ignoreDuplicates` (o que o FKN já listou não é
  mexido); importação manual filtra o que já existe. `crm_titulos.origem` 'fkn' | 'nota'.
- A listagem do FKN confirma (vira `origem='fkn'`) e tira o pago, mas **não apaga título de nota
  criado depois da hora em que o relatório foi gerado** (cabeçalho DATA + hora, horário de
  Brasília): `delete … where atualizado_em < agora and (origem <> 'nota' or criado_em < geradoEm)`.
- Ficha: título da nota aparece com "(da nota)" até o FKN confirmar.
- Notas já importadas antes de 02/10 não ganham título pela nota (o contas a receber do FKN já os tem).
- **Conferido em produção (02/10, 17:41):** as primeiras 5 notas novas pelo vigia (2564 a 2568,
  de Isabela, Alysson e Silmara) geraram 6 títulos `origem='nota'` (a 2565 em 2 parcelas), com soma
  das parcelas = valor da nota, vencimentos do `<dup>`, portador BOLETO e o mesmo cliente da nota.
  A rotina de conferência de hora em hora foi apagada.
- **Vigia parado de dom 04/10 14:58 a seg 05/10 ~10:05** (último sinal antes; nenhuma nota perdida —
  não houve emissão no período). O Anderson religou a tarefa e, em 05/10, acrescentou o gatilho
  "a cada 10 min" (README, passo 5) para a tarefa voltar sozinha se cair. Causa provável: reinício
  do servidor no domingo — **descartada pelo log**: em 04/10 11:23–11:26 houve "fetch failed" (queda
  de internet no servidor), depois voltou, e ~14:58 o vigia **travou aberto sem registrar erro** (a
  tarefa seguia "Running", então nem o gatilho de 10 min religaria). Correção: vigia **`2026-10-05`**
  com **trava de segurança** — 20 min sem completar uma volta (ou um lote) → registra "vigia travado…"
  e sai com erro; a tarefa (RestartCount + gatilho de 10 min) liga de novo. **Instalado no servidor
  em 05/10 10:12** (sinal chegando com a versão 2026-10-05; tarefa com os dois gatilhos conferidos).
- **05/10 11:53 — contas a receber do FKN aceito de novo** (183 títulos de 124 clientes, R$ 211.980,81,
  todos ligados a cliente) depois de duas recusas por falta de "Listar os dados cadastrais dos
  clientes". Os títulos nascidos das notas 2564–2569 apareceram no relatório com a mesma parcela,
  valor, vencimento e cliente — conferência nota × FKN fechada; o CRM trocou os da nota pelos do FKN
  sem duplicar. Dica dada ao Anderson: no "Salvar como" do FKN, entrar em `\\Servidor\SISTEMA\CRM-FKN`
  (no nível "Rede > servidor" o Windows não deixa salvar).

## WhatsApp: caminho 3 e volta do contato (02/10/2026, decisão do Anderson)

- Decisão: **sem WhatsApp não oficial** (Z-API, Evolution: risco de bloqueio do número); o oficial
  da Meta (API Cloud) fica para depois. Cada vendedora tem **uma linha da empresa (chip próprio)**,
  não usa número pessoal — bom para a API oficial no futuro (cada linha vira um número da conta).
- **Volta do contato** (`fichas.js`, `esperaVolta`/`formVolta`): depois de abrir WhatsApp ou
  e-mail pelo CRM (ficha, listas, recompra, sequência), quando a vendedora volta para a aba (focus
  ou visibilitychange, depois de 4 s e até 3 h) abre "Como foi o WhatsApp com X?": resultado,
  o que ficou combinado (vai para o histórico, na mesma atividade) e o próximo passo (tarefa
  WhatsApp/e-mail às 9h, prazo sugerido pelo resultado). Recompra e sequência já agendam o retorno:
  o próximo passo vem "Nenhum agora".
- **Modelos de mensagem** (Configurações → Modelos): variáveis novas `{titulos_vencidos}` ("o título
  da NF 2205 (R$ 917,88, vencido em 24/09)"); `{saudacao}` e `{itens}` também listadas na tela.
- Feito em seguida: o orçamento do FKN importado como proposta (seção abaixo).

## Orçamento do FKN → proposta no layout da OneClean (02/10/2026, pedido do Anderson)

A vendedora continua fazendo o orçamento no FKN (preço, estoque e condição ficam lá); salva em
**CSV** e importa no CRM, que monta o documento no layout da empresa, pronto para o cliente.
- **Onde:** "+ Novo" → "Orçamento do FKN (importar)", ou "importar do FKN" na seção Propostas da
  ficha do negócio. `orcamento.js`: parte pura `CRMOrcamento.lerOrcamentoFKN` (testada em
  `testes/orcamento.test.js`, dados fictícios) e a tela.
- **Formato do CSV do FKN** (é a impressão do orçamento): cabeçalho em duas colunas (cliente à
  esquerda; PROPOSTA, VERSÃO, EMISSÃO, VÁLIDO ATÉ, COD.CLI, TEL, SEU PEDIDO à direita), as 3 linhas
  depois de "PROPOSTA:" são nome, endereço e CEP/bairro/cidade/UF; itens `IT; CÓDIGO; NOME; UN; QTDE;
  PREÇO UNIT; %DESC; PREÇO TOTAL;` (preço unitário com 4 casas — "15,4700" é 15,47, não milhar;
  código "010049.0" vira "010049"); rodapé FRETE, VALOR TOTAL, Cond. pagamento, Cobrança, Prazo
  entrega, Vendedor, Transportadora, Endereço de entrega. Arquivo em Windows-1252. Com mais de uma
  página o cabeçalho se repete: itens juntados pelo número. Soma dos itens (+ frete) conferida com o
  total; diferença aparece em ATENÇÃO na tela.
- **O que faz:** acha o cliente pelo CNPJ (ou cadastra como lead, origem "Orçamento FKN"); o
  vendedor escrito no FKN ("ALYSSON") vira o responsável (nomes na nota → nome → primeiro nome);
  negócio novo "Orçamento N" ou um aberto do cliente, na etapa de orçamento/proposta do funil de
  vendas (avança, nunca volta); troca os itens do negócio pelos do orçamento (produto ligado pelo
  código); cria a proposta com `numero_fkn` e `dados` (pagamento, frete, entrega…). **Reimportar o
  mesmo número atualiza** a mesma proposta (nova versão do FKN), não duplica.
- **Layout** (`fichas.imprimirProposta`, CSS `.proposta-doc`): logo, "Orçamento nº · versão",
  emitido/válido até, Para (razão, CNPJ, A/C, endereço) e Seu contato (vendedora com o **telefone
  da linha**, campo novo no cadastro do usuário), tabela com código/un./desconto, frete e total,
  condições, agradecimento e o **rodapé da empresa** (Configurações → Geral → "Propostas e
  orçamentos", `proposta_rodape`). O PDF sai com o nome "Orcamento N - cliente".
- **Enviar** (botões WhatsApp e E-mail na proposta): abre a conversa com o modelo "Orçamento
  enviado" / "Envio de orçamento" + resumo (número, valor, validade); o link do WhatsApp não leva
  arquivo, então a vendedora anexa o PDF. A proposta vira "enviada" (histórico e etapa) e a volta
  do contato pergunta como foi.
- **Passo a passo para as vendedoras** (02/10, telas reais do CRM com cliente de exemplo):
  https://claude.ai/artifact/9A4bGmGhd9c7F5cxiKwi21 (privado; o Anderson compartilha pelo menu
  Share) e em PDF. O passo 1 (FKN: impressão do orçamento → disquete → Tudo → CSV) foi descrito
  pelo jeito dos relatórios; falta o Anderson confirmar/mandar print da tela do FKN.
- Telefones das linhas cadastrados pelo Anderson em 02/10 (só números; o orçamento formata como
  "WhatsApp (11) 94488-4942", `fichas.telBonito`).
- Banco: `crm_propostas.numero_fkn`, `crm_propostas.dados` (jsonb), `crm_usuarios.telefone`
  (aplicados em produção em 02/10). Amostra real conferida (9 itens, soma = total) e apagada.
- Telefone da linha de cada vendedora: **o Anderson vai preencher** (Configurações → Usuários).
  Rodapé da proposta preenchido em 02/10 (autorizado pelo Anderson, dados do caminhão):
  "OneClean · Produtos de Limpeza e Descartáveis · WhatsApp (11) 98719-0372 · vendas@oneclean.com.br ·
  www.oneclean.com.br" (`crm_config.dados.proposta_rodape`; CNPJ ficou de fora até ele passar).
- **Fotos dos produtos: feitas e tiradas no mesmo dia (02/10)** — o Anderson achou desnecessário;
  `fotos.js` apagado. Ficaram em produção, sem uso e vazios, a coluna `crm_produtos.foto` e o bucket
  `crm-fotos` (não reintroduzir sem ele pedir).
- **Modelo do orçamento aprovado pelo Anderson (02/10, fim do dia)** — ele montou o layout em outro
  lugar (PDF "OneClean-Orcamento-Proposta") e pediu para reproduzir **exatamente**, com os itens
  numerados ao lado. `fichas.imprimirProposta` + `.proposta-doc`: faixa turquesa no alto, logo e
  "ORÇAMENTO 22.400" com emissão/validade, frase de destaque (`cfg.proposta_chamada` e
  `proposta_subchamada`, em Configurações → Geral), "Preparado para", três cartões (frete, entrega,
  pagamento) tirados do orçamento do FKN, "Produtos selecionados" numerados com código embaixo,
  "Entrega e atendimento" + "Seu contato" (vendedora, WhatsApp e e-mail) ao lado do "Total do
  pedido", e o botão **"Vamos programar sua entrega? / Confirmar pelo WhatsApp"** (`cfg.proposta_cta`)
  que no PDF é **link clicável** para o WhatsApp da vendedora responsável (telefone do cadastro), com
  a mensagem "Olá, X! Recebi o orçamento nº N (R$ …) e quero programar a entrega." Sem telefone, o
  botão não sai. Cores em `config.js → cores.documento` (`#009cb3`, `#163e50`). Nomes do FKN em
  maiúsculas viram frase e ganham de volta os acentos mais comuns (`ACENTOS`). Cabe numa página
  com ~10 itens. Cuidado com nomes de classe que já existem no CRM (`.topo`, `.meta`, `.faixa`).
  Ajuste pedido no mesmo dia: **o verde da borboleta também** (`cores.documento.verde` `#a9c451`:
  faixa do alto termina em verde, traço verde sob a frase, borda verde no "Preparado para" e no
  Total, bolinha verde nos cartões, números dos itens em verde escuro, botão "Confirmar pelo
  WhatsApp" numa pílula verde com letra preta), **letra preta** (`#1c1c1c`) nos textos de leitura
  (frase, cliente, produtos, valores, contato) — o azul-escuro fica só no cabeçalho da tabela — e
  **logo maior** (86 px de altura).
- **PDF direto, sem tela de impressão (05/10, pedido do Anderson):** "Importar e gerar o PDF" (fim da
  importação) e o botão **"Baixar PDF"** da proposta geram o arquivo na hora: o CRM pergunta onde
  salvar (`showSaveFilePicker`, chamado logo no clique porque o navegador só abre a janela com o
  clique recente; navegador sem a janela → vai para Downloads), desenha o documento numa área fora
  da tela (`.pdf-palco`, 794 px = A4) com **html2canvas** e monta o A4 com **jsPDF** — as duas em
  `vendor/` (html2canvas 1.4.1, jsPDF 2.5.2, MIT; sem CDN, carregadas só na hora) — com o botão
  "Confirmar pelo WhatsApp" clicável por cima (`pdf.link`). **Sempre na primeira folha:** mais de 12
  itens liga o modo `denso` (letras e espaços menores, código ao lado do nome) e, se ainda passar do
  A4, a página inteira é reduzida (até 60%: 45 itens cabem); só acima disso vai para mais folhas,
  cortando entre linhas. Se o PDF não puder ser gerado, cai na impressão antiga. O texto do PDF é
  imagem (não dá para copiar), o que é aceitável para orçamento. `H` leva 40 px de folga: o
  html2canvas desenha o texto um pouco abaixo do DOM (sem a folga, o rodapé cortava).
- **Atualização de orçamento fica no mesmo negócio (05/10, pedido do Anderson):** em 05/10 a Renata
  (22348) e a Isabela (22356) reimportaram o orçamento atualizado e acabaram com negócio novo — a
  lista "Entra no negócio" trazia "Novo negócio" em primeiro. Agora `negocioDoOrcamento` (puro, testado)
  escolhe: negócio da ficha (se importou de dentro dele) → negócio da proposta já importada com o mesmo
  nº → negócio aberto do cliente que já tem orçamento do FKN (número novo do FKN para o mesmo pedido) →
  único aberto → só então "novo". O sugerido vem primeiro ("Mesmo negócio: …"), "Abrir um negócio
  novo (outra venda)" vai para o fim, e o título automático "Orçamento N" acompanha o número novo. A
  proposta antiga fica no negócio como histórico.
  Limpeza do caso da Renata (05/10, autorizada): o negócio antigo da Inco Rubber (R$ 788,12, sem
  proposta) foi apagado pelo Anderson no CRM; antes, backup em `crm_backup.exclui_negocio_2026_10_05`
  (negócio, 13 itens, 8 atividades) e as 8 atividades passaram para o negócio "Orçamento 22348".
  O MCP do Supabase trava em DELETE (inclusive via `apply_migration`): exclusão de registro de cliente
  se faz pelo próprio CRM (Editar → Excluir, conta de admin), depois de backup e de mover o histórico.
- **Orçamento sem CNPJ não cadastra o cliente de novo (05/10):** o Alysson importou 22352 duas vezes e
  22351 uma, sem CNPJ no FKN, e nasceram três "COLÉGIO XINGU" (além do "COLÉGIO XINGU - JOSIANE" do
  Agendor). `clienteDoOrcamento` (puro, testado) procura: CNPJ → empresa do negócio (importação pela
  ficha) → código do cliente no FKN (`crm_titulos.cliente_codigo` ou `dados.codigo_cliente` de proposta
  já importada) → e-mail → nome igual (`chaveNome`). Sem CNPJ aparece o campo **"Cliente no CRM"** com o
  achado e os de nome parecido, mais "Cadastrar cliente novo"; trocar o cliente ali zera negócio/pessoa
  sugeridos. Achado sem CNPJ e o orçamento traz CNPJ → completa a ficha.
- **Select que perdia o valor gravado (05/10):** editar um negócio importado apagava a origem "Orçamento
  FKN" (não está na lista de origens; o navegador caía em "(a da empresa)"). `ui.js` agora acrescenta o
  valor gravado como opção quando ele não está na lista — vale para todo select de formulário (ex.:
  responsável inativo deixava de ser trocado sem querer).
- **Limpeza do Xingu (05/10, autorizada; resposta do Alysson: 22351 e 22352 são vendas separadas, o
  negócio zerado era duplicata):** backup em `crm_backup.xingu_2026_10_05`; tudo junto no "COLÉGIO XINGU"
  de 11:50 (negócios 22352 R$ 2.659,45 e 22351 R$ 2.620,11, cada um com a sua proposta, 7 atividades);
  as duas empresas duplicadas e o negócio zerado foram apagados pelo Anderson no CRM. O "COLÉGIO XINGU -
  JOSIANE" (Agendor, vazio) ficou — esperando o Anderson dizer se é o mesmo. Vendedora não exclui
  negócio (só gestor/admin): duplicata ela pede para a Isabela apagar.
  Depois o Anderson confirmou que o "JOSIANE" é o mesmo: as 4 atividades e o e-mail dp@ passaram para o
  "COLÉGIO XINGU" (backup na mesma tabela), `externos_mesclados` recebeu o id do Agendor, e o cadastro
  vazio ficou como "APAGAR - duplicado de COLÉGIO XINGU" para ele excluir no CRM.
- **E-mail "SEU" (05/10):** com o e-mail vazio no orçamento do FKN, a leitura pegava a palavra da coluna da
  direita ("SEU PEDIDO") — três empresas cadastradas com e-mail "SEU" (corrigidas). Agora só vale com @.
  `clienteDoOrcamento` também sugere nomes com duas palavras em comum (pegaria "NR EXPRESS ORÇ 3" ×
  "NR Express - Matriz…"). "NR EXPRESS ORÇ 3" e "CLUBE ATLETICO YPIRANGA" (criados por orçamento em
  05/10) **não são** os mesmos clientes dos cadastros antigos (resposta do Anderson): ficam separados,
  não mesclar. O cadastro "JOSIANE" foi excluído pelo Anderson; Xingu conferido (2 negócios, 2 propostas,
  11 atividades).
- **Argus juntado (06/10, pedido do Anderson):** "Maxwell Argus Vidros de Segurança" (Agendor: 1 negócio, 7
  atividades, WhatsApp, e-mail) foi para "ARGUS BY VANTECH VIDROS DE SEGURANCA LTDA" (CNPJ, endereço, notas);
  backup em `crm_backup.argus_2026_10_06`, Agendor em `externos_mesclados`, nota "Cadastro mesclado" no
  histórico; o vazio ficou "APAGAR - duplicado de ARGUS BY VANTECH" para o Anderson excluir no CRM.
- **Publicação do Pages presa (05/10, 16:39–19:17):** os builds de `pages-build-deployment` ficaram
  na fila do GitHub sem máquina (um foi cancelado pelo próprio GitHub após 15 min; o "re-run" ficou
  em "not yet queued" e não dava para cancelar). Saída: um push novo dispara outro build. Para conferir
  se o site publicou: `gh api "repos/sistemidalessi/crm-oneclean/actions/runs?per_page=3"` (último com
  `success` = no ar) — daqui o github.io não abre. Enquanto não publica, o CRM segue na versão anterior.
- **Sino conferido (05/10):** soma atrasadas + leads sem atendimento + negócios parados + clientes sem
  contato + recompra (não conta "para hoje"); a bolinha do Início é atrasadas + para hoje. Segue o
  filtro de visão (equipe toda para gestor). Número alto = 164 negócios parados, quase todos do Agendor.
- **Degradê da marca na proposta (02/10):** tirado dos prints do Instagram e do site que o Anderson
  mandou (o ambiente bloqueia `www.oneclean.com.br`): turquesa `#03baca` → azul `#0198cf`, em
  `config.js → cores.gradiente`. Vira as faixas do topo e do rodapé, a borda dos quadros Para/Seu
  contato, o cabeçalho da tabela (do azul-petróleo `#175b6d` ao azul escurecido) e os títulos.
  Também no CRM (pedido do Anderson, 02/10): **menu lateral** em degradê vertical do petróleo
  `#175b6d` ao azul, com a borda direita turquesa → azul; **tela de login** com o fundo no degradê
  do Instagram (turquesa → azul → petróleo), **ondas** brancas translúcidas no pé do fundo e a
  mesma onda do orçamento no alto do cartão (`ondasEntrada` em `app.js`). Botões e destaques seguem
  com o verde `#a9c451`.
- Lembrete dos relatórios do FKN **só de segunda a sexta** (confirmado pelo Anderson em 02/10: não
  trabalham sábado) — é como já está em `lembreteFkn`; não acrescentar sábado.

## Caixa: contas a pagar e caixa do dia — só administrador (06/10/2026, pedido do Anderson)

Troca a planilha `\\servidor\Financeiro\05 - FATURAMENTO GERAL\Fluxo de Caixa Geral\Planilha de Fluxo de
Caixa_OneClean.xlsx`, no mesmo jeito do "Caixa do dia" da Agilité (`agilite-sistema-gestao`:
`src/routes/caixa_dia.js`, `src/agenda/feriados.js`, `src/routes/recorrentes.js`). Decidido com o
Anderson: cada sistema cuida da sua empresa; o "Geral" (as duas) é de quem lê os dois.

- **Quem vê: só o administrador** (tem salário das vendedoras, pró-labore e retiradas). RLS `so_admin`
  nas três tabelas; **sem auditoria em `crm_historico`** de propósito (a gestora lê o histórico).
  `supabase/teste-rls/ataque.sql` cobre gestora, vendedora, comprador e anon (roda.sh: OK em 06/10).
  No banco de verdade as tabelas foram criadas sem os `drop ... if exists` (o MCP trava em comando de
  remoção); `truncate/references/trigger` revogados do `authenticated`.
- **Tabelas:** `crm_fin_lancamentos` (conta a pagar = saída; entrada avulsa = entrada; `situacao`
  aberto/pago/pausado; `baixa` 'caixa' = ✓ no caixa, conta no saldo, 'fora' = pago fora, não mexe no
  saldo; `entre_empresas`; `origem` tela/recorrente/fkn/planilha/titulo; `chave_fkn` e
  `titulo_duplicata` únicos), `crm_fin_recorrentes` (dia fixo, `parcelas` + `parcela_inicio` no mês
  `inicio`; uma conta por recorrente e mês — índice único) e `crm_fin_saldos` (saldo do banco
  informado). Saldo inicial: **Banco do Brasil R$ 8.052,79 em 05/10/2026** (gravado em 06/10).
- **Tela "Caixa"** (`caixa.js`, aba só do admin; dados lidos à parte por `store.carregarFin()`, relidos
  se tiverem mais de 1 min): **Dia a dia** (grade de 15 dias: entradas em cima, saídas embaixo, totais e
  saldo no fim do dia; verde = aconteceu, branco = previsto, tracejado = pago fora; ✓ paga/recebe no
  dia da coluna (futuro → hoje); clique no cartão: ajustar valor e dia, pagar, pausar, desfazer,
  editar; arrastar para outro dia; "+" lança no dia; dia com mais de 5 mostra 4 e junta o resto;
  sábado/domingo/feriado no cabeçalho), blocos "Contas vencidas sem baixa" (Paguei hoje / Já estava
  paga / Pausar) e "A receber vencido" (fora da previsão até entrar); **Contas a pagar** (filtros,
  + Conta a pagar, + Entrada), **Recorrentes** ("Gerar mês" idempotente, mês atual e o próximo) e
  **Contas pausadas**. "Conferir com o banco" grava saldo novo e mostra a diferença.
- **Caixa por frases (06/10, `frases.js`)**: caixa "Escreva o que aconteceu" no topo do Dia a dia (Ctrl+Enter
  confere) e o "+" de cada célula abre a mesma caixa com o dia e a seção da célula ("Formulário completo"
  leva ao formulário antigo). `interpretar()` é o leitor da Agilité (`src/caixa/interpretar.js` do
  `agilite-sistema-gestao`), igual na leitura; `classificar()` propõe, nesta ordem: conta em aberto que
  bate (valor ±8% ou R$ 60, vencimento ±20 dias, uma palavra em comum na descrição/fornecedor; genéricas
  como "fornecedor", "conta", "ltda" não contam) → baixa (futuro: ajusta, ou "já está no caixa");
  entrada × título não recebido (±0,5%; o nome desempata; vários títulos do mesmo cliente que somam o
  valor) → baixa do título igual ao ✓; nome do fornecedor (FKN/recorrentes) ou cliente (empresas):
  metade das palavras, duas, ou a primeira se tiver 5+ letras; regra lembrada (`crm_fin_regras`, chave
  = palavras em ordem alfabética); categoria pela palavra (`PALAVRAS`). "Agilit" marca entre empresas
  (inclusive título de cliente Agilité). **Conferência obrigatória** (tudo editável; nada gravado antes).
  Lançamento por frase grava `frase` (a linha) e, quando baixa/ajusta conta que já existia,
  `frase_antes` (estado anterior). **"Desfazer a frase"** no menu do item: volta `frase_antes` ou apaga o
  que a frase criou (entrada de título apagada = título volta ao receber). `origem` continua 'tela' /
  'titulo' (mudar o check do banco exige DROP, que trava pelo MCP). Testes com nomes fictícios
  (`testes/frases.test.js`); conferido com nomes reais só localmente, fora do repositório.
- **Dia útil** = bancário de São Bernardo do Campo: nacionais, 9/7 (SP), Carnaval, Sexta Santa,
  Corpus Christi e 20/08 (aniversário de SBC); **não** o 25/01 da capital. Conta que vence sem banco
  aparece no próximo dia útil com o aviso; o vencimento gravado não muda.
- **Título a receber** (`crm_titulos`) entra no dia do crédito: pago no vencimento (ou próximo dia
  útil) e cai no dia útil seguinte (como na Agilité; `cfg.caixa_credito_d1 = false` = cai no mesmo
  dia). ✓ cria uma entrada paga com `titulo_duplicata` (some da grade; o título sai do receber quando a
  listagem do FKN mostrar que foi pago).
- Categorias sugeridas em `CATEGORIAS_SAIDA/ENTRADA`; categoria com "Agilité" marca entre empresas
  sozinha. A "GiroCaixa - Facilities" é dívida da própria OneClean (não é entre empresas); os
  empréstimos "BB - OneClean" e "PRONAMPE" são pagos pela Agilité — não lançar como saída daqui.
- **Confirmado pelo Anderson (06/10):** no BB o boleto pago hoje cai no dia útil seguinte (D+1, como
  ficou); feriados = nacionais + estadual + municipais de SBC (como ficou).
- **Primeira carga da planilha (06/10, aba SET-OUT-26):** 41 recorrentes (início 10/2026) com a conta de
  outubro de cada uma na data e no valor da planilha (vermelho/sem cor = em aberto; verde = pago →
  EL-SHADAY 05/10 entrou pago "fora") + GiroCaixa 27 de 27 (27/10, origem 'planilha'). Na planilha,
  verde = pago e o vermelho claro (tema accent2) é a previsão; o verde é o accent3 do tema (9BBB59) ou
  RGB. **Não vieram da planilha** as linhas sem título: duplicatas (linhas 5–16, já estão no CRM pelo
  contas a receber) e fornecedores (linhas 35–55, virão pelo contas a pagar do FKN) — trazer as duas
  contaria em dobro. Até o leitor do FKN entrar, o saldo previsto não tem os boletos de fornecedor.
  A conferir com o Anderson: categoria do EL-SHADAY; "Perua escolar" em retiradas dos sócios e
  "Pedágio" em frete; os "SILMARA" da área de fornecedores e o "Cartão Porto" (agosto) ficaram de fora.
  A planilha e os relatórios antigos enviados na conversa foram apagados depois do uso.
- **Contas a pagar do FKN (06/10, pronto):** relatório **Sifn083 — Contas à Pagar por Conta/Fornecedor**
  (conta 0 a 0, subconta 0, situação GERAL, filial da OneClean, "Dados conta/fornecedor", Em aberto,
  período em branco, ordem por vencimento; CSV em `\\Servidor\sistema\CRM-FKN`). Leitor em `fkn.js`
  (`lerContasPagar`, `conferirContasPagar`, `planoContasPagar`, `lancamentoDoFkn`), usado pela tela
  (Caixa → Contas a pagar → "Atualizar do FKN", mostra o resumo antes de aplicar) e pela `crm-notas`
  (vigia `2026-10-06`, que reconhece "CONTAS A PAGAR" e, ao trocar de versão, olha a pasta de novo).
  Chave da conta = `código da conta|documento` (`chave_fkn`). Conta ≥ 10000 = despesa do plano de
  contas (salário, energia, caminhão, despesas diversas; categoria pelo nome); abaixo, fornecedor.
  Regras: conta nova que bate com saída em aberto lançada à mão/recorrente/planilha (valor igual,
  vencimento ±5 dias) só é **ligada**; conta **antiga** (venceu há mais de 60 dias ou emitida há mais
  de 1 ano) entra **pausada** com "conferir se já foi paga" — o FKN tem pendências de 2018–2025 nunca
  baixadas; a que sumiu do retrato vira paga `baixa 'fora'` no dia do relatório; recusa se não for
  "Em aberto", se tiver período, sem TOTAL GERAL, soma diferente ou menos de 40% do que já há.
  1º arquivo real (06/10 12:01): 361 contas, R$ 444.413,82 (soma = total), 63 fornecedores/contas;
  163 antigas (R$ 197.050,50) e 196 novas (R$ 235.690,92) pelo teste; salário e água da planilha
  reconhecidos. **Vigia `2026-10-06` instalado no servidor às 12:22 de 06/10** — o `Invoke-WebRequest`
  do Windows Server 2012 falha por TLS (nem com Tls12): baixar o vigia **pelo Node** (README). 1ª entrega
  real: 361 contas → 194 abertas (R$ 234.532,91), 163 antigas pausadas (R$ 197.050,50), 4 ligadas às da
  planilha (salário, energia do galpão, pedágio, água da casa). Lembrete do contas a pagar na faixa do
  FKN (só admin; `crm_fkn_situacao()->'pagar'` = última entrega boa pelo vigia ou conta do FKN gravada pela
  tela) e passo 3 (Sifn083) na colinha — 06/10. Leitura para a gestora das duas empresas: ver abaixo.
  No `schema.sql` o bloco do financeiro fica ANTES do contas a receber (a função lê `crm_fin_lancamentos`).
- **Confirmado pelo Anderson (06/10):** "as contas de hoje em diante ainda não foram pagas" — o verde em
  boleto futuro de fornecedor na planilha não era pago; o caixa está certo em tratá-las como previstas.
  Projeção do dia (saldo BB R$ 8.052,79): outubro (06–31) entra R$ 161.919 e sai R$ 271.715; saldo
  previsto negativo desde 06/10, pior dia 23/11 (≈ −R$ 110,6 mil). A parte de 2–3 semanas à frente é
  pessimista: títulos das vendas ainda não faturadas não existem no CRM.

## Leitura do Caixa para a Agilité e a gestora do grupo (06/10/2026, "fase 2")

- **Endereço:** `GET https://udhigavckigciqnicgyy.supabase.co/functions/v1/crm-caixa-leitura?dias=30` (1 a 90),
  `Authorization: Bearer <senha>`. Só lê. Serve a aba **Geral** do sistema da Agilité (as duas empresas,
  com o que passa entre elas anulado) e a sessão gestora do grupo (skill "ceo-do-grupo"). Formato = o do
  `GET /api/ceo/resumo` da Agilité (`src/routes/caixa_leitura.js` do `agilite-sistema-gestao`).
- **Senha:** gerada pelo administrador em Configurações → Integrações → "Leitura do Caixa" (aparece uma
  vez; o banco guarda só o SHA-256 em `crm_integracoes` com `uso = 'caixa'`). Anderson cola direto no
  campo de Configurações do sistema da Agilité — **nunca em chat, e-mail, WhatsApp ou arquivo**. O pedido
  falava em segredo da função (`CAIXA_LEITURA_SECRET`); ficou na tela porque o MCP não grava segredo de
  função e assim a senha nunca passa por uma conversa (e dá para gerar outra e desligar a antiga sozinho).
  A chave do vigia (`uso = 'notas'`) não lê o caixa e a de leitura não entrega notas (`crm-notas` v14).
- **Função** (`supabase/functions/crm-caixa-leitura`, verify_jwt desligado): sem senha/errada → 401;
  outro método → 405; `Cache-Control: no-store`; comparação em tempo constante; não grava nada nem loga
  dado (só a mensagem de erro). Lê as tabelas com a chave de serviço, que nunca sai do servidor.
- **Mesmas contas da tela:** as contas do Caixa saíram de `caixa.js` para **`caixa-calculo.js`** (puro,
  `CRMCaixa`), que a tela usa e a função baixa do GitHub num commit fixo com SHA-256 conferido (como a
  `crm-notas`). Mexeu no `caixa-calculo.js`: commit + push, `node ferramentas/fixa-motor-notas.js` (fixa as
  duas funções; só muda a que precisa), commit + push e publicar a `crm-caixa-leitura` de novo
  (`testes/motor.test.js` avisa). O resumo é `CRMCaixa.resumoLeitura()` (testado em `caixa.test.js`).
- **Conteúdo:** saldo (informado + baixado depois), próximos dias (itens `aconteceu`/`previsto`, pago fora
  com `pago_fora: true` fora das somas), menor saldo, contas vencidas (`vencido`), pausadas agrupadas
  (recorrente → descrição dela; do FKN → fornecedor; motivo), títulos a receber (cliente, vencimento,
  `cai_na_conta`, `atrasado`). **Sem nome de pessoa:** salários, benefícios, encargos, pró-labore,
  retiradas, comissões e reembolso da folha à Agilité somados por dia e categoria (descrição = categoria),
  e também qualquer item cuja descrição ou fornecedor tenha o nome de alguém da equipe. CPF e telefone
  mascarados. `entre_empresas` também no título de cliente Agilité. "hoje" = data de São Paulo.
- Daqui não dá para chamar a função (a rede da sessão barra `supabase.co`); o teste com a senha (saldo e
  saldo de cada dia contra a tela; 401/405) fica para quando o Anderson gerar a senha.

## Acertos de 06/10 à tarde (achados pela aba Geral da Agilité)

- **Material vendido à Agilité contado duas vezes** (recorrente da planilha em 20/10 + duplicata do FKN
  em 21/10, R$ 5.715,40): o título é a fonte de verdade. `ligacoesTitulos` (`caixa-calculo.js`): previsão
  de entrada em aberto, entre empresas, com o MESMO valor (±1 centavo) e vencimento a até 5 dias de um
  título de sacado Agilité fica **ligada** (`titulo_duplicata` na previsão, `situacao = 'aberto'`) e sai da
  grade e das vencidas; o título aparece uma vez, com o condomínio na descrição, `entre_empresas` e
  `referente` na leitura. A tela grava as ligações ao abrir o Caixa; a grade e a leitura também ligam na
  hora as que ainda não foram gravadas. Receber o título (✓, "Recebi" ou frase) **baixa a previsão
  ligada** em vez de inserir outra entrada; "recebido" = `titulo_duplicata` com `situacao = 'pago'`.
  As 6 de outubro ligadas no banco. Mês em que o valor real é diferente do recorrente não liga: aparece a
  previsão e o título (ajustar o valor da previsão ou pausá-la).
- **Reembolsos da folha dos 5** (valor certo = folha da Agilité): outubro acertado — salários 11.302,22
  (06/10), **benefícios de outubro 5.404,40 (06/10, novo)**, Cesta II 392,33 (14/10), FGTS + consignado
  1.167,90 (20/10), novembro em 30/10: VR 2.182,40 + VT 2.525,60 + cesta 696,40. Descrições com o
  componente ("Reembolso folha 09/2026 — FGTS + consignado"); os recorrentes viraram "Reembolso folha — …"
  / "Reembolso benefícios — …" com valor de previsão e a observação "ajustar todo mês com a folha da
  Agilité (~dia 5)". Na leitura, reembolso cuja descrição só tem componente (lista `COMPONENTES`) sai
  com a descrição; com qualquer outra palavra (um nome) volta a somar sem nome. Não havia VR/VT/cesta de
  30/09 lançado no CRM (o Caixa começou em outubro).
- **Frases iguais às da Agilité (06/10, noite, pedido da sessão da Agilité):** `interpretar()` agora é cópia
  do `src/caixa/interpretar.js` dela (commit c81e82e): " - " e " / " separam itens; contexto antes/depois
  vai na frente/atrás do nome; "100,000,00" com vírgula de milhar; "48x de 3.292,29" / "12x de 350" = valor
  da parcela (o número fica guardado); "entrada"/"saída" e "empréstimo" sem verbo dão a direção; "será",
  "vou"… = previsto; **empréstimo**: devolução na mesma frase ("será devolvido 60000 dia 14/10"), em outra
  linha para o mesmo nome (até +25%) ou em parcelas ("48 parcelas de …, todo dia 18, a primeira 18/10").
  Número antes de unidade ("8 diárias", "3 FTs") é quantidade, não valor, e não parte a frase no " e "
  ("Espaço e Vida") — nasceu aqui e a Agilité levou (commit 4d1675c de lá). **Regra combinada: o leitor é o
  mesmo código nos dois sistemas** — mudou lá, copiar para cá; mudou aqui, avisar a Agilité. Conferido
  linha a linha em 06/10 à noite: iguais.
  Gravação do empréstimo (`gravaEmprestimo`): entrada `emprestimo = true`, categoria "Empréstimos recebidos"
  (não é receita); devolução única = saída prevista com `juros`; parcelas = recorrente "Empréstimo — <credor>"
  com `valor_contratado` e a parcela 01 já em Contas a pagar; cada parcela gerada (`gerarMes`) leva `juros` e
  a observação juros + principal pela **tabela Price** (`cronogramaPrice`, taxa por Newton: 2,05% a.m. e
  parcela 01 = juros R$ 2.048,27 + principal R$ 1.244,02 no exemplo de R$ 100 mil em 48× R$ 3.292,29).
  O que a frase criou vai em `frase_antes.criou` da entrada: "Desfazer a frase" apaga entrada, devolução,
  parcelas em aberto e a recorrente (ou só a desliga se já pagou parcela). Conferência: toda entrada tem
  "É empréstimo recebido" com devolve em/valor ou parcelas/valor/1ª/dia, editáveis.
  Casar com conta: palavra **forte** ("diária", "uniforme", "Sekron", "energia", "contabilidade", "exame/ASO")
  não paga sozinha conta de outra categoria e o nome do cliente (condomínio) não conta como palavra em
  comum — a conta fica nas opções. "Lembrar" virou "da próxima vez, classificar "…" igual" e só aparece em
  conta nova fora de folha/benefício. Botão **🎤 Falar** (ditado do Chrome/Edge). Anexo de PDF/imagem/boleto
  da Agilité: ainda não (fica para depois). Banco: `crm_fin_lancamentos.emprestimo/juros` e
  `crm_fin_recorrentes.valor_contratado/taxa_mes_pct`; a leitura manda `emprestimo` e `juros` nos itens.
  Testes com nomes fictícios; a tabela de aceite com os nomes reais rodou só localmente.
  1º uso real (06/10, 16:59): "saiu 502,05 compra de mercadoria" achou o cadastro de cliente "| A/C COMPRAS"
  pela palavra "compra" — corrigido (compra, mercadoria, produto, pedido, material… são genéricas e não acham
  nome) e o fornecedor do lançamento limpo no banco. O cadastro "| A/C COMPRAS" parece mal preenchido: o
  Anderson vai conferir.
- **Leitura conferida com os dados reais (06/10, 15h):** reembolsos em 06, 14, 20 e 30/10 e os 6 títulos
  da Agilité só em 21/10, todos entre empresas. Cliente cadastrado como "Empresa | Contato" (padrão do
  Agendor, 27 clientes com título) saía com o nome do contato: na leitura agora vai só a empresa.
- **Ticket médio visível (pedido do Anderson, 06/10):** Gestão ganhou o quadro "Ticket médio do mês" logo
  depois de "Conversão do mês" (faturamento ÷ notas de venda do mês, seta contra o mês passado inteiro e,
  embaixo, o ticket dos negócios ganhos; clique abre as notas do mês) e a ordem dos quadros passou a ser
  faturamento, projeção, conversão, ticket, clientes, abertos, ano. Relatórios ganhou "Ticket médio" ao
  lado de "Taxa ganhos vs perdidos" (por negócio ganho e, com notas, por nota).
- **Título em atraso remarcado (pedido do Anderson, 06/10 à noite — 3 títulos do Colégio Palavra Viva vencidos
  em 05/10):** arrastar o título na grade (ou clicar → "Ou remarcar para") grava `crm_titulos.previsao`; ele
  passa a aparecer naquele dia (dia útil seguinte se cair sem banco), **em vermelho** ("em atraso: venceu …,
  remarcado para …") e entra no saldo previsto; se a data passar sem receber, volta para "A receber vencido".
  "Tirar a remarcação" volta ao normal. Ao receber, "Valor que entrou" grava o que caiu de fato (juros ou
  parte), com a diferença na observação. A listagem do FKN não apaga a previsão (o upsert só grava as colunas
  que traz). Na leitura: `cai_na_conta` = a data remarcada e `atrasado: true`.
  **Adiantado (08/10, Anderson: "trouxe para hoje porque o cliente adiantou e veio vermelho também"):** remarcado
  para ANTES do dia em que cairia na conta (`adiantado()` em `caixa-calculo.js`) fica **verde** com a etiqueta
  "⏩ adiantado" ("adiantado: vencia …, o cliente paga em …"), `atrasado: false` e `adiantado: true` na grade e na
  leitura (não conta em `vencidos`). Se não pagar no dia adiantado, volta para o dia do vencimento (não vira vencido).
  `crm-caixa-leitura` v10 fixada no commit 7cc1d90.
- **Empréstimo de acerto do caixa em azul (08/10, Anderson: "a Je me emprestou 10 mil para devolver até amanhã… deixar o
  quadradinho em azul"):** na grade, a entrada do empréstimo (`emprestimo: true`), a "Devolução do empréstimo — …" e as
  parcelas "Empréstimo — …" ganham azul forte preenchido com letra branca (pedido do Anderson: destacar do "+ N
  entradas") e a etiqueta "🔁 empréstimo" / "🔁 devolução"
  (`ehEmprestimoLanc` em `caixa-calculo.js`, item `emprestimo` na grade); legenda "🔁 empréstimo (entra e volta)".
  **Leitor de frases (mudou AQUI — avisar a Agilité para levar):** "me/nos emprestou", "peguei emprestado" e
  "emprestado da/do" = entrada de empréstimo, realizada (`EMPRESTOU_PRA_MIM`); "… 10 mil ontem para devolver amanhã" separa
  a cauda "para/pra/e devolver <data>" do pedaço com valor (`CAUDA_DEVOLUCAO` em `pedacos`) e a data vira a devolução;
  "me, nos, emprestou, emprestado, peguei…" saem do nome. Antes, essa frase virava uma SAÍDA de 10 mil.
  Mesmo dia, depois: **transferência entre empresas também em azul** ("🔁 entre empresas"; é empréstimo entre as
  empresas, com volta); leitor: "1500 pra agilite ontem e ela vai devolver dia 14" = saída com volta mesmo com
  "entra e volta" escrito na frase (`PARA_ALGUEM`: pedaço com valor e "pra/para/pro <alguém>" sem verbo = saída),
  "que será devolvido dia 14" / "ela vai devolver" também separam a cauda, e "como"/"dia" saem do nome.
  Lançamentos reais de 08/10 (a pedido do Anderson): empréstimo da Je (entra 10.000 em 07/10, devolve 09/10) e
  empréstimo da OneClean à Agilité (sai 1.500 em 07/10, volta 14/10). Apagados dois errados das tentativas com o
  leitor antigo (entrada de 1.500 "Transferência da Agilité" repetida e R$ 7,00 "Empréstimo — /10.000 como Je
  devolver"), backup em `crm_backup.caixa_lanc_errados_2026_10_08`. Saldo do CRM depois: R$ 15.478,12.
- **Espelho das transferências entre empresas (08/10/2026, pedido da Agilité: "já se lançasse nas duas"):** só a
  categoria "Transferência entre empresas". Formato e regras combinados com o sistema da Agilité (par = ida + volta,
  `tipo` do ponto de vista de quem manda, `ref` sempre o id original, par completo, mesmo ref = atualizar, adotar
  o lançamento manual de mesmo tipo invertido/dia/valor, sem eco, desfazer a ida apaga o par) — tudo no
  `schema.sql`, seção "espelho Agilité ↔ OneClean", e testado em `teste-rls/ataque.sql`.
  - **Recebe:** Edge Function `crm-caixa-espelho` (verify_jwt desligado; Bearer = senha de gravação gerada em
    Configurações → Integrações → "Espelho com a Agilité", `crm_espelho_nova_senha()`; só o SHA-256 em
    `crm_fin_espelho_cfg.token_hash`) chama `crm_espelho_aplicar()` (só service_role). 200 / 401 / 400.
  - **Manda:** gatilho `crm_fin_lanc_espelho` → `crm_fin_espelho_fila` → pg_cron `crm-espelho` (a cada minuto)
    roda `crm_espelho_tick()`, que monta o par (`crm_espelho_pacote`) e faz o POST pelo **pg_net** para
    `https://sistema.agiliteservice.com.br/api/caixa/espelho` com a senha da Agilité (colada pelo Anderson na mesma
    tela, guardada em `crm_fin_espelho_cfg.senha`; nenhum usuário do app lê a tabela). Falhou → de novo em 10 min.
    Espera 5 s depois da última mudança (ida e volta da frase saem juntas). Registro em `crm_fin_espelho_log`.
  - Lançamento que veio da Agilité = `espelho_ref` preenchido ("veio do Caixa da Agilité" na lista); `espelho_par`
    = par a que pertence. Sem eco: o espelho grava com `crm.espelho = '1'`.
  - **Aplicado em produção por partes** (o `apply_migration` com `delete`/`drop` dentro fica parado esperando
    confirmação): extensões pg_cron e pg_net, tabelas, permissões, funções de envio, gatilho e cron. Por isso a
    senha de gravação ficou em `crm_fin_espelho_cfg` (sem mexer na regra `uso` de `crm_integracoes`) e o espelho
    grava com `origem = 'tela'` (sem mexer na regra `origem`). A função `crm_espelho_aplicar` (tem `delete`) foi
    rodada pelo **Anderson no SQL Editor** do Supabase em 08/10 (a confirmação da ferramenta não chegava na tela
    dele) — conferida: só service_role executa. Para repetir: copiar a seção do `schema.sql` e rodar lá.
  - Os refs do CRM são `oneclean:<uuid>` (o exemplo do pedido usava número). 1º contato 08/10 14:40: a Agilité
    recusaria tudo daqui (`REF = /^(agilite|oneclean):\d+$/` em `src/caixa/espelho.js` de lá) — pedido à sessão
    da Agilité para aceitar `oneclean:<uuid>`. A função guarda o pacote recebido no registro (`detalhe.pacote`).
  - 1º envio do CRM (teste de R$ 10 lançado pelo Anderson, 08/10 15:53): pacote certo, a Agilité respondeu **401**.
    A senha guardada no CRM tinha 44 caracteres; a do servidor da Agilité (`data/caixa_espelho_secret`, gerada com
    `randomBytes(32).toString('hex')`) tem **64** (0-9 e a-f). Salvar a senha de novo em Integrações faz o que
    falhou ser reenviado no minuto seguinte (`crm_espelho_configura` zera a espera).
  - **Funcionando nos dois sentidos desde 08/10 16:15** (a Agilité passou a aceitar `oneclean:<uuid>`). Testes reais:
    14:47 par `agilite:123` (1.500 de 07/10) **adotou** os 2 lançamentos daqui; 14:50 a Agilité desfez → apagados aqui
    também (por isso o empréstimo de 1.500 de 07/10 não existe mais nos dois lados — confirmar com o Anderson se
    os 4.500 de 08/10 o substituem); 16:15 teste de R$ 10 do CRM gravado lá (ida 124/volta 125); 17:04 desfeito lá →
    apagado aqui; 17:09 "saída de 4500 pra agilite e devolve dia 14/10" gravado lá (ida 129/volta 130).
    Ainda não mandados: os 1.600 de 06/10 (lançados à mão nos dois lados antes do espelho) — mandar o par faz a
    Agilité adotar o dela.
  - **Baixa no espelho (14/10, pedido do Anderson: "quando eu ticar num, no outro já tem que estar OK"):** daqui já vai e
    já chega — o ✓ manda o par com `situacao: 'realizado'` (o gatilho olha situação e `pago_em`) e `crm_espelho_aplicar`
    marca pago o que chega "realizado". Em 14/10, 14:18–14:21, o Anderson deu ✓ nas 4 voltas de 14/10 (300, 700, 1.600,
    4.500) e a Agilité respondeu ok (voltas 131, 138, 109, 130 lá; o par dos 1.600 foi adotado lá como ida 108/volta 109).
    Até 14/10 a Agilité nunca mandou baixa (só criação). Prompt para a sessão da Agilité conferir os dois sentidos:
    `sistemi-dalessi/docs/prompts/2026-10-14-agilite-espelho-baixa.md`.
    **Testado nos dois sentidos em 14/10 (par `agilite:168`, R$ 10):** 15:20 lançado lá → criado aqui; 15:21 OK lá → pago
    aqui; 15:21 desfeito lá → aberto aqui; 15:26 OK de novo → pago; 15:29 ✓ do Anderson aqui na volta de 21/10 → 15:30
    a Agilité respondeu ok (ida 168, volta 167); 15:31 a Agilité apagou o teste → os 2 apagados aqui. Teste encerrado.
- **Gestão → tabela Equipe (08/10, pedido do Anderson):** comprador (Wellington) fora; o administrador entra como
  **"Direto"** (notas "VENDEDOR: DIRETO", `nomes_nota` do admin), no fim e só se vendeu no ano, sem as colunas de
  contato; linha **Total** embaixo = o faturamento do mês e do ano (o mesmo do quadro), com "Ex-vendedores(as)" quando há nota
  de ex-vendedora ou cliente sem carteira, para a soma bater (`equipeTotal` em `gestao.js`, teste em `gestao.test.js`).
  No topo da Gestão, o 1º quadro é **"Faturamento do mês · Equipe de vendas"** (sem o Direto, `p.mes.equipe`, com
  comparação no mesmo ponto do mês passado); o geral (com o Direto) desceu para uma fileira logo abaixo.
- **Leitura do Caixa pela Agilité, 08/10:** as leituras de 07/10 12:29 tinham dado 401 (senha recusada). O Anderson
  gerou senha nova (10:18) e colou na Agilité; 3 leituras 200 às 10:21. A senha antiga (06/10) foi **desligada**
  (`ativo=false` em `crm_integracoes`, não apagada). A aba Geral da Agilité lê na hora em que é aberta (cache de 1 min,
  botão "Ler o CRM de novo"); o caixa próprio da Agilité NÃO recebe nada da OneClean — cada lado lança a sua ponta
  da passagem entre empresas, e a coluna "diferença entre empresas" da Geral avisa quando só um lado lançou.
- **"Paguei em <vencimento>" nas contas vencidas sem baixa (08/10, Anderson: "paguei ontem, só não dei baixa"):**
  baixa no caixa com a data do vencimento (`cx-nodia`), desconta do saldo se for depois do último saldo do BB
  informado. Os três botões têm dica: "Paguei hoje" (data de hoje, mexe no saldo), "Paguei em …" (data do vencimento,
  mexe no saldo) e "Já estava paga" (`baixa: 'fora'`: o saldo do banco informado já desconta, não mexe no saldo).
- **Transferência entre empresas (06/10 à noite, espelho da Agilité, commit 79fdfe7 de lá):** categoria
  **"Transferência entre empresas"** (nome exato; nas listas de entrada e de saída; `ENTRE_EMPRESAS` também casa
  com ela): só caixa — não é receita, despesa nem empréstimo; na aba Geral da Agilité as duas pontas se anulam.
  Frase que cita a Agilité + palavra de transferência (transferi, enviei, mandei, pix, emprestei, empréstimo,
  adiantamento, devolução, devolv…) e **sem** material/produto/reembolso/folha/salário/benefício → o lançamento +
  a volta prevista (outra direção) se houver data ("recebi 1.600 da Agilité pra pagar as contas de hoje, devolvo
  dia 14" = entrada hoje + saída prevista 14/10), os dois `entre_empresas`; vem antes de material e de
  empréstimo; sem "lembrar". Frase de volta ("devolvi 1.600 pra Agilité") dá baixa na volta prevista, não
  duplica (o ✓ também). Conferência: "Devolve à Agilité em … o valor de …", editáveis. Leitor copiado de novo
  (79fdfe7): "devolve dia 14" depois de SAÍDA = data da volta; enviei/mandei = saída que aconteceu.
  Mesma noite, frase ditada (Agilité `b837d37`, leitor copiado de novo): retornar/retorno/volta/voltar também é
  devolução (`DEVOLUCAO`, e palavra de transferência); " e vai retornar/voltar/devolver dia 14" depois do valor é
  outro pedaço (`INICIO_DEVOLUCAO` em `pedacos()`) — a data da volta, sem deixar o lançamento de hoje previsto.
  A Agilité como o ditado escreve: `AGILITE = /\ba[gj]il+i[tc]/` (agilite, agility, agiliti, ajilite; "agilidade"
  não casa). Leitor lado a lado com o da Agilité: 13 frases, 0 diferenças. Os dois lançamentos de 06/10 e 14/10
  conferidos no banco (um de cada, sem repetição).
- **Baixados no FKN, sem entrada no caixa (07/10, pedido do Anderson, "opção 2"):** a listagem do contas a
  receber do FKN só traz o que está em aberto; título baixado lá sumia do CRM e, se o dinheiro tinha entrado, o
  saldo do caixa ficava abaixo do real. Agora o gatilho `crm_titulos_saiu` (after delete em `crm_titulos`,
  security definer — vale para qualquer caminho: listagem, nota cancelada, tela) guarda o título em
  `crm_fin_titulos_baixados` (RLS só admin, ataque cobre), **exceto** se já teve "Recebi" no Caixa; título de nota
  cancelada já nasce `resolvido = 'cancelada'`; título que volta na listagem sai de lá (`crm_titulos_voltou`).
  No Caixa, bloco aberto "Baixados no FKN, sem entrada no caixa" (`baixadosPendentes` em `caixa-calculo.js`):
  "Entrou…" pede o dia (sugerido: o do crédito, sem passar do dia em que sumiu nem de hoje) e o valor → entrada
  "Recebido: …" em Duplicatas recebidas (ou baixa a previsão ligada) e `resolvido = 'entrou'`; "Não entrou" →
  `nao_entrou` (a previsão ligada, se houver, volta para a grade). Desfazer o recebimento devolve o título ao
  bloco. **Não vira entrada sozinho**: baixa no FKN nem sempre é dinheiro no banco. Os 3 títulos do Colégio Palavra
  Viva que sumiram na listagem de 07/10 08:40 (antes do gatilho) foram colocados à mão no bloco; os outros que
  sumiram entre 06/10 e 07/10 não têm como voltar (o registro da listagem só guarda a contagem) — o saldo do BB
  informado de novo acerta.
- **07/10, consulta de boletos do BB (CBR):** 10 boletos liquidados em 06/10 (R$ 5.233,07, com R$ 67,65 de juros nos
  3 do Palavra Viva) lançados como "Recebido" em 07/10 (D+1) e marcados "entrou" em `crm_fin_titulos_baixados` (7
  deles tinham sumido na listagem de 07/10 08:40). Saldo do BB informado pelo Anderson: R$ 5.241,52 (o CRM dava
  R$ 5.257,49); a diferença de R$ 15,97 lançada como "Tarifa Pix" (Tarifas bancárias), antes do saldo. Daqui para
  frente ele avisa a taxa: "taxa pix 1,99 hoje" cai em Tarifas bancárias (`TAXA_BANCO` olha a frase inteira, porque
  o leitor tira "pix" do nome).
- **Corte do "A receber vencido" (pedido do Anderson, 06/10 à noite: "deixe somente os que venceram hoje, pra
  seguirmos certo daqui pra frente"):** `cfg.caixa_receber_desde` = 2026-10-05 (Configurações → Geral, campo
  "Caixa: A receber vencido mostra só…"). Os 9 títulos antigos (29/01 a 07/08, R$ 11.540,90) saem do bloco do
  Caixa com uma linha dizendo quantos ficaram de fora; **não foram apagados** (voltariam pelo FKN) e continuam
  no contas a receber, na cobrança (selo e duplicatas em atraso) e na leitura da Agilité. Contas a pagar
  vencidas antes de hoje: nenhuma.
- **Transferência real lançada (06/10):** entrada de R$ 1.600 da Agilité hoje (baixa às 17:00, antes do saldo
  do BB informado às 17:54, que já tinha o dinheiro — não conta duas vezes) e devolução prevista em 14/10, as
  duas "Transferência entre empresas" e entre empresas; frase gravada, então "Desfazer a frase" desfaz as duas.
- **Assinatura do produto (pedido do Anderson, 06/10 à noite: "o orçamento já faz a propaganda"):** linha discreta
  no pé de toda proposta/orçamento em PDF — "Orçamento gerado pelo CRM **Sistemi Dalessi** · sistemas sob medida ·
  afdalessi@gmail.com" (`CRM.ASSINATURA_EMAIL`, app.js) — e o e-mail no rodapé do login. Configurações → Geral:
  "Tirar a assinatura…" (`cfg.sem_assinatura`; para cliente que não quiser a marca — pode virar item de preço).
  Quando existir o domínio, trocar o e-mail pelo site. O campo "Nome que aparece no CRM" fica travado quando o
  `config.js` fixa o nome (OneClean).
- **A página não sobe mais ao dar baixa** (pedido do Anderson): `renderAgora` (app.js) guarda e devolve a
  rolagem da página e da janela (celular), a das `.tabela-rolagem`/`.cx-grade-rolagem` e os `<details>`
  abertos (fechavam a cada redesenho: o bloco "A receber vencido" fechava e a página subia). Vale para
  todas as telas; trocar de aba começa do topo. O foco devolvido não rola (`preventScroll`).
  Bloco "+ N saídas/entradas" de cada dia tem `data-chave` fixa (dia + seção): antes todos tinham a mesma
  chave (o resumo sem números) e o fechado de um dia fechava o aberto do outro a cada ✓ (06/10 à noite).

## Cadência de e-mails (07/10/2026, ideia da líder de vendas, melhorada)

Clientes que só tratam por e-mail recebem, **em nome da vendedora da carteira** (a resposta vai para ela),
o lembrete de **reposição** no ritmo de compra deles (com o que costumam levar, pelas notas) e, no intervalo
da cadência (quinzenal ou mensal), a **campanha de relacionamento** que a líder escreve. Decisões do Anderson
(07/10): e-mails da OneClean ficam no **UOL Host** → envio por serviço próprio, o **Brevo** (grátis até 300/dia),
ligado ao domínio; **começa com fila de aprovação** (nada sai sozinho); remetente = vendedora do cliente.

- **Onde:** aba **E-mails** (`emails.js`, todos menos comprador) — fila do dia (editar assunto/texto, desmarcar
  e-mail, Enviar / Enviar os N / Pular desta vez / Tirar da cadência), segurados e por quê, campanhas (só
  gestor cria/edita; variáveis `{saudacao} {primeiro_nome} {contato} {empresa} {vendedor}
  {vendedor_primeiro_nome} {minha_empresa} {itens}`), "Na cadência", "Quem pode entrar" (cliente com e-mail
  e sem ligação/WhatsApp/visita/reunião há 90 dias, os que mais compraram primeiro) e resultado de 30 dias
  (enviados, abertos, clicaram, **compraram até 15 dias depois** pelas notas). Ficha do cliente: "E-mails da
  cadência" com "Mudar". Configurações → Geral: assunto e texto da reposição e limite por dia.
- **Regra** (`cadencia.js`, pura, `testes/cadencia.test.js`; fora do `regras.js` de propósito: ele é o motor
  fixado da `crm-notas`): reposição 3 dias antes do ritmo e uma vez por compra; relacionamento quando passou o
  intervalo desde o último e-mail (enviado ou pulado; erro não conta), com a campanha mais nova que o cliente
  ainda não recebeu (do segmento dele ou de todos). **Segura:** pediu para sair, sem e-mail, e-mail há menos
  de 5 dias, negócio aberto que andou nos últimos `dias_parado` (os parados do Agendor não seguram),
  duplicata em atraso, comprou há menos de 7 dias (relacionamento), sem campanha nova.
- **Banco:** `crm_empresas.email_cadencia` ('quinzenal'|'mensal') e `email_sair_em` (só a função grava;
  gatilho `crm_empresas_trava_sair` impede o CRM de desfazer — LGPD); `crm_email_campanhas` (membro lê, gestor
  grava); `crm_email_envios` (lê quem vê a empresa; o app só grava `pulado`; `enviado`/`erro` vêm da função).
  Ataque cobre.
- **Envio:** Edge Function **`crm-email`** (verify_jwt ligado): acha o cliente **com o login de quem aprova**
  (RLS), destinatários **do banco** (o app só pode tirar), limite por dia (`email_limite_dia`, 200), não envia
  2 vezes em 4 dias, remetente = vendedora da carteira, HTML simples com logo e cor da instalação, rodapé com
  "Não quer mais receber? Clique aqui" e `List-Unsubscribe`; grava o envio e a **atividade "email"** na ficha.
  `acao: 'aberturas'` lê no Brevo aberturas, cliques e devolvidos dos últimos 30 dias. **`crm-email-sair`**
  (verify_jwt desligado): o link abre `sair.html` (as funções não servem HTML) e só um clique confirma (antivírus
  de e-mail abrem links sozinhos); token = HMAC do id da empresa com a chave de serviço. As duas testadas com
  banco e Brevo simulados (outra carteira 404, destinatário de fora recusado, HTML escapado, repetido 409,
  token trocado 400). Publicadas em 07/10 (v1).
- **Falta o Anderson ligar o Brevo** (até lá a aba mostra "O envio ainda não está ligado"):
  1. criar a conta em brevo.com (plano grátis);
  2. Brevo → Remetentes, domínios e IPs → **Domínios** → adicionar `oneclean.com.br`; o Brevo mostra os
     registros DNS (código do Brevo, DKIM e DMARC). Pôr no **painel do UOL Host** (DNS do domínio) sem mexer no
     MX; se já existir um SPF (`v=spf1 …`), não criar outro — só acrescentar o `include` que o Brevo pedir;
     voltar ao Brevo e clicar em autenticar;
  3. Brevo → SMTP e API → **Chaves de API** → gerar "CRM OneClean" e copiar;
  4. Supabase → projeto OneClean CRM → Edge Functions → **Secrets** → `BREVO_API_KEY` = a chave. **Nunca no
     chat, no CRM ou no repositório**;
  5. no CRM, aba E-mails: o aviso some; primeiro envio de teste para um cliente com o e-mail do próprio Anderson.
- **Ligado em 07/10 à tarde:** conta Brevo do Anderson, domínio oneclean.com.br **autenticado** (TXT brevo-code +
  CNAME brevo1/brevo2._domainkey no UOL Host; o DMARC já existia), remetente padrão OneClean <adm@oneclean.com.br>
  (só para envios feitos dentro do Brevo; o CRM usa o da vendedora), `BREVO_API_KEY` nos Secrets. **1º envio real às
  17:13** (teste na ficha "ANDERSON FERNANDES DALESSI", chegou); teste desfeito (segmento e cadência voltaram, campanha
  de teste desativada). Manual para a líder: https://claude.ai/artifact/M3R8viBbhuPdZT7PstmkXf (doc Claude Docs).
- **Manual em PDF (07/10, noite):** a equipe não conseguia abrir o doc; PDF de 5 páginas entregue ao Anderson
  (gerado fora do repositório — não versionar).
- **Depois (fase 2):** envio automático por cliente (o servidor monta a fila todo dia: precisa de pg_cron e da
  regra rodando na função) e a volta do e-mail (resposta do cliente vira atividade).

## Fiscal — Fase 1 da saída do FKN (15/10/2026, pedido do Anderson)

Plano completo em `docs/plano-sair-do-fkn.md` do repositório **sistemi-dalessi** (decisões: NF-e direto na
Sefaz por um serviço fiscal na VPS da Agilité; notas de compra pelo DF-e; boleto pela API do BB).
- **Tributação de cada item lida do XML** (`nfe.js fiscalDoItem`: CST/CSOSN, alíquotas e valores de ICMS, ST,
  PIS, COFINS e IPI, CEST, GTIN, origem; do destinatário: IE, indicador da IE, código do município) →
  **`crm_fiscal_itens`** (tabela à parte, só admin, NÃO carregada ao abrir o CRM) pela função
  **`crm_fiscal_grava(lote)`** (admin ou chave de serviço; acha o item pela chave + ordem; no cliente só
  **completa** IE, indicador e município vazios, e o endereço inteiro quando não há nenhum).
  Grava: a importação manual (admin), a `crm-notas` (vigia, desde 15/10) e o botão "Ler a tributação" da aba Fiscal
  para as notas antigas (baixa o XML guardado, 6 de cada vez).
- **`crm_fiscal_resumo()`** agrega por produto (NCM vistos com datas, CEST, GTIN, origem e cada combinação
  CFOP + CST + alíquotas com contagem e datas). **`fiscal.js analisa`** monta a proposta (a combinação de venda
  mais recente) e as **verificações**; o que é erro conhecido **já vem corrigido na proposta** (pedido do Anderson:
  "o que verificar de erro, a partir daqui já fazemos o certo"): papel higiênico = NCM 4818.10.00 e PIS/COFINS
  CST 06 (alíquota zero, Lei 10.925/2004 art. 1º XXVIII); CST 01 fora de 1,65%/7,6% vira 1,65%/7,6% (Lucro Real);
  ST (5405) exige CST 60 e CEST; CST 60 com 5102 é erro; toalha com NCM de papel higiênico; NCM, GTIN, origem ou
  tributação que mudaram no histórico. **`crm_fiscal_produtos`**: a regra (proposta/conferido), só admin.
- **Aba Fiscal** (só admin): 1) ler a tributação das notas; 2) regra de cada produto com filtros (erro, olhar,
  sem alerta, conferidos), ✎ ajustar, "Conferido", "Marcar os sem alerta", **exportar a tabela para o "de acordo"
  do contador**; 3) clientes com nota que ainda não têm o necessário para a NF-e.
- **Achado de 15/10** (antes de ler os XML): o produto 300005 "PAPEL HIGIENICO ROLAO LUXO POP" saiu com NCM
  4818.10.00 até 15/04/2026 e **4818.20.00 desde 23/04/2026** (691 itens); "TOALHA BOB.BCO.6X20X200" saiu com o
  NCM do papel higiênico. A verificação de PIS/COFINS só aparece depois de ler os XML.
- **Limpeza fora da ST em SP (15/10, achado do vigia):** a Portaria SRE 20/2026 revogou o Anexo XIII da CAT 68/2019 a partir de
  01/08/2026. `analisa` reconhece o produto de limpeza (CEST do segmento 11 ou NCM de `LIMPEZA_FORA_ST_SP`) e corrige a proposta
  com 5405/CST 60 para **5102, CST 00, 18%** (alerta `erro` corrigido); se o FKN emitiu com ST depois de 01/08, o alerta pede
  conferência das notas com o contador (estoque de 31/07: CAT 28/2020). A lista de NCM ficou **incompleta** (a rede da sessão
  barra o site da Sefaz): conferir com o texto oficial ou o contador e completar a constante.
- **Leitura dos XML (15/10, fim da tarde; 2.609 notas válidas, 36.067 itens, 1.189 produtos):** todo papel
  higiênico saiu com PIS/COFINS **CST 01 (1,65% + 7,6%) até ~01/04/2026** e CST 06 (alíquota zero) depois — alguém
  corrigiu em abril —, **menos o 300005**, que no dia 23/04 trocou para o NCM 4818.20.00 e **voltou a sair com CST 01**
  (segue assim até hoje, ~R$ 2.300/mês). PIS+COFINS destacados no papel higiênico nas notas do CRM (dez/2025 a
  15/10/2026): **R$ 24 mil** (R$ 19 mil só do 300005); anos anteriores não estão no CRM — conferir com o contador.
  Papel higiênico sai às vezes com ST (5405/CST 60) e às vezes sem (5102/CST 00 18%), conforme o produto.
  **Erro meu corrigido no mesmo dia:** a regra tomava "DISP.PAPEL HIG.", "DISPENSER P.HIG" e "SUP. PAPELEIRA …
  PAP.HIG" por papel higiênico; agora só conta a descrição que **começa** por PAPEL/PAP./P. HIG. As 4 propostas
  foram acertadas no banco. Também: papel com a regra atual certa mas vendas antigas com CST 01 ganha o aviso
  "PIS/COFINS cobrado … falar com o contador". `crm_fiscal_grava` completa o **número** do endereço quando o cadastro
  (Agendor) tem a mesma rua sem número (18 clientes; a última nota de cada um ficou para reler).
- **Releitura feita pelo Anderson às 20:23 (15/10):** propostas refeitas com as duas correções (1.190 produtos): 89 de
  limpeza com erro corrigido (ST → 5102/00/18%), 6 papéis com PIS/COFINS cobrado na última venda (300005 incluso), 25
  papéis certos hoje com o aviso do PIS/COFINS cobrado até março, dispensers acertados. Endereços: 15 dos 18 completados;
  faltam 3 (Rua Cristoforo Mantegazza, Av. Cons. Rodrigues Alves, Rua da Mooca — a rua da nota não bate com a do
  cadastro; completar à mão). **Retomar daqui (16/10):** ver o que o vigia da legislação gravou de manhã (e se só mexeu
  no `registro.md`); levar ao contador PIS/COFINS do papel, limpeza com ST desde 01/08 e a dúvida da perfumaria/higiene
  (papel e toalha) fora da ST desde 01/04; depois do "de acordo", corrigir no FKN o 300005 e a ST da limpeza; seguir a
  Fase 2 do `plano-sair-do-fkn.md` (estoque no CRM em paralelo).
- **Vigia da legislação fiscal** (tarefa agendada da conta do Anderson, como o "Vigia da legislação (DP
  Agilité)"): lê `docs/legislacao/monitoramento.md` (o que o sistema usa) e `docs/legislacao/registro.md` (o que
  já foi avisado), pesquisa as fontes oficiais e grava achado novo **só** no `registro.md` (commit no main).
  **Na 1ª rodada (15/10) o vigia também mudou `fiscal.js`, testes e este arquivo** (limpeza fora da ST; a lei confere
  — Portaria SRE 20/2026 — e o código foi mantido, revisado). A regra "só `registro.md`" foi reforçada no topo do
  `monitoramento.md`; o texto da tarefa só pode ser mudado pela conversa do vigia. **Sessão do vigia: nunca alterar
  código nem este arquivo.**
  Tarefa `trig_01QWhye9ACBaGp8a6jKiA56D`, dias úteis às 6:52 (Brasília), que acorda **sempre a mesma sessão**
  `session_017tU3t2Bo8G1dgDgutkNbqX` ("Vigia da legislação (fiscal OneClean)"), criada já com este repositório
  anexado — a 1ª versão (sessão nova a cada rodada, sem repositório) parou em 24 s sem abrir o repositório.

## Ofertas: queima de estoque (15/10/2026, pedido do Anderson)

"Fazer girar" o estoque parado (sem venda em 90 dias) com preço de custo + margem pequena, por e-mail
e WhatsApp. Valor real do parado em 15/10: **R$ 79 mil em 271 produtos** (depois da correção das caixas).
- **Montar (só administrador):** Compras → cartão "🔥 Queima de estoque" → "Montar oferta" (ou aba
  Ofertas → "Nova oferta"). Lista o parado com custo, preço de tabela (FKN), preço de oferta editável
  (custo + margem, padrão 10%, para cima no centavo), "Já compraram" e valor parado; vêm marcados os 25 de
  maior valor que algum cliente já comprou. Campo opcional **"Impostos + comissão + frete sobre a venda (%)"**:
  mostra a sobra de cada item, avisa prejuízo e tem "Subir ao mínimo sem prejuízo". **No Lucro Real,
  custo + 10% pode dar prejuízo** (avisado ao Anderson); o percentual certo é do contador.
- **`crm_ofertas`** (RLS: equipe lê, gestor/admin grava; ataque OK: vendedora lê e não grava, comprador e
  anônimo não veem). **Nunca guarda o custo** (`itemParaGravar`): só preço de oferta, de tabela, saldo na
  criação, família e os códigos da mesma família (`familia_codigos`, para achar quem compra parecido).
- **Aba Ofertas (equipe toda; comprador não):** produtos e preços, prévia do e-mail e do WhatsApp,
  resultado (e-mails, aberturas, vendido dos itens desde a criação e vendido a quem recebeu) e **quem recebe**
  (`ofertas.js publico`): já comprou o item, compra a mesma família (12 meses) e, se marcar, todo cliente que
  comprou em 12 meses. Segura duplicata em atraso/cartório, quem pediu para sair, sem e-mail e quem já recebeu.
  A vendedora vê só a carteira dela (RLS).
- **E-mail:** `crm-email` com `tipo: 'oferta'` + `oferta_id` + `destaques` (v10). Oferta ativa e no prazo,
  **uma vez por cliente** (não usa a trava de 4 dias da cadência), mesmo limite diário. A linha `{itens}` do
  texto vira a **tabela de preços tirada do banco** (o app não manda preço), com o que o cliente já comprou
  primeiro; o texto puro leva a lista. `crm_email_envios.oferta_id` e tipo `'oferta'`.
- **WhatsApp:** botão por cliente abre a conversa da vendedora com o texto e a lista (destaques primeiro),
  registra a atividade e espera a volta do contato (mesmo caminho da ficha). Sem API: a Meta cobra marketing caro.
- **"✨ Escrever com IA"** (Textos e IA): Edge Function **`crm-oferta-texto`** (v1, só admin/gestor) — Claude
  escreve assunto, e-mail e WhatsApp com as variáveis do CRM e a linha `{itens}`; não escreve preço nem
  "preço de custo"/"parado". Usa a mesma `ANTHROPIC_API_KEY` do Caixa (limite US$ 10/mês).
- Regra pura em `ofertas.js` (testes `testes/ofertas.test.js`); a tela vem no mesmo arquivo.

## Junção dos negócios duplicados do Funil de Vendas (07/10/2026, pedido da líder via Anderson)

- Herança do Agendor: o mesmo cliente com vários negócios abertos no **Funil de Vendas**. Autorizado pelo Anderson:
  ficou o negócio **com histórico** (mais atividades/propostas; empate → o mais recente) e os outros foram apagados.
- 305 clientes, **1.070 negócios apagados** (backup em `crm_backup` antes), 523 atividades, 3 propostas e 32 itens
  movidos para o negócio que ficou. Abertos no funil: 2.299 → 1.229; nenhum cliente com mais de um aberto; nenhuma
  atividade sem negócio. Feito por `execute_sql` em etapas (o `apply_migration` inteiro estourou os 60 s e foi
  desfeito sem aplicar nada); apagada em lotes.
- **Funil de Pós-Vendas retirado (07/10, noite, pedido do Anderson: "não vai ter utilidade nenhuma"):** herança do
  Agendor (um negócio por venda ganha; 313 negócios, 298 abertos parados em "Contato"). Backup em
  `crm_backup.tira_posvendas_2026_10_07_*` (etapas, negocios, itens, atividades, propostas). **7 negócios reais desta
  semana** (orçamento do FKN importado e/ou ganho em 05–07/10 — o import oferecia o negócio aberto do Pós-Vendas como
  "mesmo negócio") **passaram para o Funil de Vendas, etapa ORÇAMENTO ENVIADO**, com status, itens e propostas.
  Atividades dos outros: para o negócio aberto do cliente no Funil de Vendas (13) ou só na ficha da empresa (10).
  306 negócios e as 5 etapas apagados; sobra só o "Funil de Vendas" (a lista de funis sai das etapas).
  A **tarefa** automática "Pós-venda: confirmar entrega" ao ganhar (`auto_pos_venda`) continua — é tarefa, não funil.
- **Venda em dobro no relatório (08/10/2026, achado pelo Anderson na lista "Negócios ganhos" do Alysson):** o import
  do orçamento oferecia o negócio aberto do Pós-Vendas como "mesmo negócio"; o Alysson importava e dava ganho lá, a
  venda não aparecia no relatório do Funil de Vendas, e ele criava um "PEDIDO …" ganho no Funil de Vendas. Na retirada
  do Pós-Vendas (07/10) os ganhos de lá foram passados ao Funil de Vendas **sem procurar esses pedidos** → 5 vendas
  contadas duas vezes (R$ 9.123,82 → R$ 4.739,36 de 05 a 11/10) e o Vital Inox também com um aberto do mesmo orçamento.
  Corrigido: em cada par ficou um negócio só, no cadastro com CNPJ e notas, com título e valor do "PEDIDO" (o Emilio
  Russeau ficou com R$ 2.631,19, o valor real) e orçamento, itens e histórico juntos; 6 negócios apagados; backup em
  `crm_backup.pedidos_duplicados_2026_10_08*`. Tarefas repetidas (7 "Recompra" e 1 "Pós-venda") apagadas com backup
  em `crm_backup.tarefas_repetidas_2026_10_08`. Auditoria do banco inteiro: nenhum outro par de ganhos repetidos;
  Moinho Beer (ganho "2472" do Agendor em 30/09 e "PEDIDO FECHADO" em 01/10, uma nota só de 02/10): a pedido do Anderson
  apagados o "2472" (R$ 370,40) e o aberto "2471", sobra igual a ele (backup em `crm_backup.moinho_beer_2026_10_08`);
  a venda fica em outubro com o valor do pedido. **Setembro ganho no CRM fica R$ 370,40 abaixo do relatório do Agendor**
  (de propósito: era a mesma venda).
  **Travas no código:** "Ganhei" pergunta quando o cliente (mesmo cadastro ou mesmo CNPJ) já tem venda ganha com valor
  até 5% diferente e até 3 dias de distância (`fichas.vendaParecida`); ganhar de novo não repete a tarefa de pós-venda
  (uma por negócio) nem a de recompra (uma por cliente, a data anda); o import do orçamento só oferece negócios do funil
  de vendas. Cadastros repetidos que causaram parte disso ("Nova Gestão RH" e "- 4R SERVICOS - STREET 100%", sem CNPJ,
  vindos do Agendor) **juntados em 08/10 a pedido do Anderson** nos cadastros com CNPJ e notas (backup nas linhas 74 e
  75 de `crm_backup.mescla_empresas`; o WhatsApp e o contato dos que saíram ficaram na ficha e nas observações).
  Negócio aberto "1493 - STREET 4R" (R$ 520,40, sobra do Agendor, igual ao ganho de 20/08) apagado a pedido do Anderson
  (backup em `crm_backup.apaga_4r_aberto_2026_10_08`).
  **JK Comercial juntada (09/10, pedido do Anderson):** "JK COMERCIAL - JUNIOR" (Agendor: 2 negócios — o ganho de
  07/08 é a NF 2069 — e 13 atividades) foi para "JK COMERCIAL E DISTRIBUIDORA LTDA" (CNPJ, endereço, nota); WhatsApp do
  Junior na ficha, Agendor em `externos_mesclados`, nota "Cadastro mesclado" no histórico; backup na linha 76 de
  `crm_backup.mescla_empresas`; o cadastro antigo foi apagado (vazio).
  **Busca dos casos iguais ao da JK (09/10, pedido do Anderson):** venda ganha de cadastro sem CNPJ com o mesmo valor
  (até 3 dias) de uma nota de outro cadastro — sinal que a tela de Duplicados não usa (lá é nome/telefone/e-mail, e "JK"
  não passava). **14 cadastros do Agendor juntados em 12** com CNPJ (35 negócios, 85 atividades; backup nas linhas
  77–90 de `crm_backup.mescla_empresas` e pares em `crm_backup.junta_2026_10_09`): ADEVA (2), Intelectus, Living Moovie,
  Salmazo, Trufer, Alcance, Laquiatto, e — apesar de marcados "outra empresa" em Duplicados, por decisão do Anderson —
  Club Up, Plestin, Nova Portal (2), Senac Jabaquara e Magma Soldas. **Ficaram separados de propósito:** Ap+Elettro e El
  Shadai (já ligados como grupo), "Ricardo Rodrigues Alves Colégio" × Instituto AD Liberty e as 4 unidades do Serviço
  Promocional N. S. Aparecida (o Anderson preferiu deixar como estão); SESI/SENAI/Radisson são unidades diferentes.
  **O mesmo sinal entrou na tela de Duplicados (09/10, pedido do Anderson):** `CRMNfe.vendasIguaisNotas(empresas, negocios,
  notas)` (puro, testado em `nfe.test.js`) acha venda ganha de cadastro sem CNPJ = nota de outro cadastro com CNPJ (centavo a
  centavo, até 3 dias, fora do mesmo grupo). Em "Clientes das notas × cadastros antigos" vale 6 pontos e aparece em verde
  ("venda de R$ X = NF n"); entra mesmo quando o nome não se parece, quando o cadastro da nota também veio do Agendor e quando
  o cadastro foi marcado "outra empresa" antes (aquela marcação era só pelo nome). "É outra empresa" agora guarda o cadastro
  **e cada par** `b:a` em `cfg.nao_mesclar_notas` (o par esconde também a venda igual); os 5 pares deixados separados pelo
  Anderson (AD Liberty e N. S. Aparecida) já foram gravados assim. Junto: o "mesmo telefone" aparecia para quem não tinha
  telefone nenhum (telefone vazio contava como igual e dava 3 pontos de graça) — corrigido; "É o mesmo" guarda o código do
  Agendor do cadastro que some em `externos_mesclados`; e `crm_titulos_troca_empresa` também move os e-mails da cadência
  (`crm_email_envios`, que a equipe não pode alterar e que sumiam junto com o cadastro apagado).
  **LDR do Alysson zerado (09/10, pedido do Anderson):** os 175 negócios abertos da etapa LDR (todos do Agendor, sem itens
  nem proposta) somavam R$ 12.413,63 por causa de 8 com valor herdado do Agendor; os 8 passaram a R$ 0,00 (os negócios
  continuam lá), backup em `crm_backup.ldr_alysson_valor_2026_10_09` (id, título, valor). LDR da Sarah e da Renata já estavam
  zerados; também zerado o único com valor em CONTATO FEITO ("2018 - Metalúrgica Duluma", R$ 405,58, Sarah; mesmo backup).
  Respostas do Anderson (09/10): os R$ 4.500 de 08/10 substituem os R$ 1.500 de 07/10 e o par dos R$ 1.600 de 06/10 não vai
  para a Agilité (os dois já resolvidos, não reabrir); a devolução da Je fica em 14/10 mesmo; "Água — galpão" (R$ 786,96,
  venc. 07/10) não foi paga: saiu de pausada para aberta (aparece como vencida no Caixa).
- **Histórico na janela da tarefa (13/10, pedido das vendedoras):** ao abrir uma tarefa (Início → "O que fazer hoje", agenda,
  ficha) a janela mostra, abaixo dos campos, o "Histórico do cliente": última compra (ou "Ainda não comprou"), as
  observações do cadastro e os 10 registros mais recentes (sem as movimentações automáticas), só leitura, com o botão
  "ficha do cliente" (abre a ficha por cima; a tarefa continua aberta embaixo). `fichas.historicoNaTarefa`; tarefa nova sem
  cliente escolhido não mostra nada.
  **Mesmo dia, o que a líder queria de fato:** clicar na tarefa (Início → "O que fazer hoje" e "Próximos 3 dias", Atividades →
  "Atrasadas de antes") **abre a ficha do cliente**; a tarefa se edita no lápis ✎ ao lado. Na ficha do cliente e no negócio
  (`itemTarefa(a, { editar: true })`) o clique continua editando a tarefa. Tarefa sem cliente abre a edição. O histórico
  na janela da tarefa ficou (aparece ao editar pelo lápis).
- **R$ 700 de 09/10 à Agilité (acertado em 13/10):** no sistema da Agilité a frase "oneclean e agilite devolverá" (sem vírgula)
  virou um movimento só (entrada prevista em 14/10, sem a ida) e o espelho trouxe isso como saída em aberto em 14/10; aqui o
  Anderson tinha lançado "Mais transferência" em Outras saídas (fora do espelho). Acerto, com backup em
  `crm_backup.transf_700_2026_10_13`: a linha do par `agilite:136` virou a ida paga em 09/10, entrou a volta (entrada 14/10) e o
  "Mais transferência" foi apagado; o espelho levou à Agilité às 13:25 (200; lá ida 136 atualizada e volta 138 criada).
  **Causa no leitor de frases** (corrigida em `frases.js`, `SUJEITO_VOLTA`): "e agilite devolverá dia 14" não era reconhecido
  como a volta (só "e ela/ele/vai devolver"), então o "dia 14" ia para a saída. **Avisar a Agilité para levar** (mesmo código).
  A Agilité levou no mesmo dia (`b1919ca`). E veio de lá (`b266421`, pedido do Anderson): **dia da semana** ("pago na
  sexta-feira" = a última sexta; com verbo de futuro, a próxima; "segunda via"/"quarta parcela" não são data) e
  "lancei/lançamento" fora da descrição. A parte de FT/folga trabalhada é da folha da Agilité (`caixa_dia.js`), não do CRM.
- **Anexo no Caixa lido pela IA (13/10, pedido do Anderson):** na caixa de frases dá para colar (Ctrl+V), arrastar ou escolher
  no 📎 o print do extrato do BB, o comprovante de Pix, o boleto ou um PDF, e escrever "entrou na conta hoje". Ao **Conferir**:
  o arquivo vai para o bucket **privado** `crm-caixa-anexos` (`caixa/AAAA-MM/<uuid>.<ext>`; só o administrador envia e lê; sem
  política de apagar, de propósito) → a Edge Function **`crm-caixa-ler`** (verify_jwt ligado, só papel admin) baixa com a chave
  de serviço e manda ao Claude (`claude-opus-5-5`, effort `low`, saída estruturada em JSON, `fallbacks: "default"`) → volta a
  lista de movimentos (tipo, valor, dia, realizado/previsto, quem, CNPJ/CPF, descrição) → `caixa.js` (`fraseDoMovimento`) faz
  uma frase por movimento (o CNPJ acha o nome do cliente no CRM; números saem do nome para o leitor não tomar por valor; "pix"
  sai das entradas) → **a mesma conferência das frases** (acha o título ou a conta que bate). Gravado, o lançamento guarda o
  caminho em `crm_fin_lancamentos.anexos` (text[]); o item mostra 📎 e a janela tem "📎 Comprovante" (link assinado de 1 min).
  A chave **`ANTHROPIC_API_KEY`** fica só nos Secrets do Supabase (o Anderson cria no console da Anthropic); sem ela a função
  responde 503 e o CRM avisa. No modo local o anexo não funciona (não há Storage). Custo: centavos por documento.
  **Ligado em 13/10:** chave criada pelo Anderson no console da Anthropic (conta dele, workspace Default, limite de gasto
  US$ 10/mês) e colada nos Secrets; 1ª leitura real às 14:31 (Pix de R$ 134,84 da Slip Química: o CNPJ achou o cadastro,
  lançamento com 📎). Sem título em aberto daquele valor: foi venda paga direto no Pix.
- **Excluir lançamento no Caixa (13/10, pedido do Anderson):** conta do FKN lançada por engano "não é nem pausar, seria
  excluir". Botão **Excluir** na janela do lançamento (fora os lançados por frase: para esses é "Desfazer a frase"), na aba
  Contas pausadas e no "Editar tudo" (que já tinha). O apagado fica guardado **inteiro** em `crm_fin_excluidos` (`dados` jsonb;
  só admin; sem alteração). Se veio do FKN, a `chave_fkn` entra lá e `fkn.js` `planoContasPagar` (opção `excluidos`) **não
  cria a conta de novo** — na tela "Atualizar do FKN" e no vigia (`crm-notas` lê a tabela). Para a conta voltar: tirar a linha
  de `crm_fin_excluidos` (com backup) e puxar a listagem. Lançamento espelhado: apagar desfaz o espelho na Agilité (o aviso diz).
  Mesmo dia: a INOVEN 2000190729-02 foi excluída pelo Anderson pelo botão (conferida no banco), e as **6 parcelas em aberto
  da INOVEN** (R$ 4.350,67; boletos 2000190729, 2000194420, 2000197378) foram dadas como **pagas fora do caixa** a pedido dele:
  foram pagas no cartão de crédito e baixadas no FKN (backup em `crm_backup.fin_inoven_cartao_20261013`). O saldo do BB não muda;
  o dinheiro sai na fatura do cartão. Foi **outro cartão** (não o "Cartão Inter" de R$ 605,92 no dia 15): **o Anderson lança a
  fatura no Caixa quando surgir** (decisão dele em 14/10) — não cobrar mais esse cadastro.
- **Cobrança: cartório e boletos atualizados (14/10, pedido do Anderson).** Decisões dele: escolher os títulos do cartório
  (não o cliente inteiro); a vendedora vê o cartório e não cobra; boleto entra pelo PDF do BB lido pela IA; quem manda ao
  cliente é a vendedora, pelo WhatsApp dela.
  - **Cartório:** `crm_titulos.cartorio_em` / `cartorio_obs` (a listagem do FKN não mexe). Botão "Mandar para cartório" na
    janela do título vencido e no "A receber vencido" (lista os vencidos do cliente, todos marcados). O título sai da grade e
    do "A receber vencido" (`titulosCaixa()` em `caixa.js`; a `crm-caixa-leitura` também tira) e vai para o bloco **Em
    cartório** (Recebi… com o valor que entrou; Tirar do cartório). Vendedora: `crm_atrasos()` (substitui
    `crm_duplicatas_atraso`, que ficou por compatibilidade) traz `cartorio_em` sem a observação; selo roxo "em cartório — não
    cobrar", fora do {titulos_vencidos} da cobrança gentil e segura a cadência de e-mails.
  - **Boletos atualizados:** Caixa → aba **Cobrança**: arrastar os PDFs da 2ª via (vários, ou um PDF com vários) → bucket
    privado `crm-boletos` → `crm-caixa-ler` com `modo: 'boleto'` (effort medium; página, pagador, CNPJ, nº do documento,
    valor do documento, valor cobrado, vencimento, linha digitável) → `cobranca.js`: **a linha digitável é conferida pelos
    quatro dígitos verificadores** e manda no valor e no vencimento (fator de vencimento reiniciado em 22/02/2025 = 1000);
    linha que não confere vai embora (o boleto segue só com o PDF). `casaBoleto`: CNPJ + valor original, + nota no "Nº do
    documento", único vencido do CNPJ, ou nota + valor sem CNPJ; em dúvida não escolhe. Conferência com um select por
    boleto → "Mandar às vendedoras" grava `crm_boletos`. **PDF com vários boletos é separado por página** (pdf-lib em
    `vendor/`, carregada só nessa hora): a vendedora nunca recebe o boleto de outro cliente; se não separar, vai sem PDF.
  - **Vendedora:** `crm_boletos` lê só os da carteira (RLS); o PDF só baixa quem vê o boleto (política do bucket olha
    `crm_boletos`). Fila do dia: item **Cobrança** antes de tudo; ficha: bloco amarelo com valor, vencimento, Copiar linha
    digitável, Baixar PDF, **WhatsApp com o boleto** (mensagem `modelo_boleto` em Configurações, padrão em
    `cobranca.js`; baixa o PDF para anexar — o link do WhatsApp não anexa) e "Já mandei". Marca `cobrado_em/por` pela
    função `crm_boleto_cobrado` (ela não altera a tabela) e registra no histórico. Por duplicata vale o boleto mais novo.
- **1º uso real dos boletos (14/10):** o Anderson arrastou 4 PDFs (El Shadai NF 2286, DCAS NF 2357, Pace NF 2363, Santa Casa
  NF 2382): casaram certo, um PDF por cliente, linhas válidas — mas eram os boletos **originais** (valor sem juros, vencimento
  já passado; a linha confirma). A pedido dele foram tirados da Fila (backup `crm_backup.boletos_originais_20261014`) para
  refazer. **Era engano meu:** na 2ª via do BB a linha digitável e o código de barras **mantêm o valor e o vencimento
  originais**; o valor com juros e multa vem só em "(=) Valor cobrado" e o banco calcula os encargos no pagamento (o Anderson
  arrastou de novo e a tela mostrou R$ 3.268,76 cobrado × R$ 3.099,36 da linha). Corrigido no mesmo dia: `confereBoleto` usa o
  vencimento e o original da linha e o **valor cobrado do PDF**; vencido não é erro (só avisa se não houver juros); o título
  achado já vem selecionado; a mensagem diz "R$ 3.268,76 (atualizado com juros e multa; valor original R$ 3.099,36)" + "o banco
  calcula os encargos até o dia do pagamento"; a instrução da IA diz que isso é normal no BB. **Quem fala com o cliente é a
  vendedora** (decisão do Anderson): o boleto chega a ela no CRM (Fila do dia, **sino** — conta os clientes com boleto e leva à
  Fila — e ficha); cliente sem celular (ou só fixo) abre o WhatsApp para ela escolher o contato. Os 4 clientes não têm pessoa com
  celular; El Shadai e Santa Casa só têm telefone fixo.
- **Boleto no WhatsApp da vendedora (14/10, Anderson: a Silmara não usa o CRM).** Depois de "Mandar às vendedoras" abre
  "Mandar no WhatsApp das vendedoras" (também na aba Cobrança enquanto houver boleto sem aviso): **um clique por vendedora** abre
  o WhatsApp do administrador na conversa com ela (`crm_usuarios.telefone`), com cada cliente, valor com juros, **link do PDF
  assinado por 7 dias**, telefone do cliente no CRM e a mensagem pronta para ela copiar; grava `crm_boletos.avisado_em`. Sem a
  API da Meta (fase 3) o CRM não manda sozinho. Cada cliente ganha a tarefa **"Cobrar boleto atualizado…"** da vendedora (sem
  repetir); ela é concluída quando a vendedora manda pelo CRM ou quando o administrador clica **"Já cobrou"** na aba Cobrança.
- **XML das notas guardado (14/10):** bucket privado `crm-notas-xml` (`nfe/<chave>.xml`, só admin) com o procNFe de cada nota,
  para a cópia da DANFE da cobrança. A `crm-notas` guarda o que o vigia manda (sem sobrescrever); a importação manual (XML/ZIP,
  Configurações → Importar) guarda os que faltam, mesmo de nota já importada (`notasXmlGuardar`). Para trás: o Anderson arrasta
  o ZIP de 2026 da pasta `D:\SISTEMA\Unimake\uninfe30\63237702000103\Enviados\Autorizados` (subpastas 202601…202610).
  O ZIP de 2 GB do Windows não abriu (ZIP64): agora `xlsx-leitor.js` lê ZIP64, avisa RAR/7z, e a importação tem **"Escolher
  pasta"** (lê as subpastas pela rede `\\Servidor\sistema\Unimake\…\Autorizados`), lendo 8 por vez com andamento a cada 100
  (um arquivo ruim não para os outros). **Feito em 14/10 pelo Anderson: 2.650 XML; todas as 2.633 notas do CRM têm o XML.**
  A tela de conferência que abre depois pode ser cancelada (guardar o XML não depende de "Importar agora").
- **PDF completo do boleto (14/10, pedido do Anderson: "cada boleto fosse mesmo em PDF, não o link" + o cliente pediu a cópia
  da nota).** Página 1 = resumo com a cara da instalação (modelo aprovado: valor original, juros, valor para pagar, linha
  digitável, como pagar, "Neste arquivo"; **sem** botão e sem contato da vendedora); depois a **DANFE** de cada nota, gerada do
  XML guardado (`danfe.js`: layout retrato do manual, CODE-128C da chave conferido com leitor de código de barras, várias folhas,
  logo da instalação no quadro do emitente, desenho em vetor no jsPDF); por fim o PDF do banco como veio (pdf-lib). Montado no
  navegador do admin logo depois de "Mandar às vendedoras" (`comporPdfs`): vira o `arquivo` do boleto e o do banco fica em
  `crm_boletos.arquivo_banco` (só admin lê) — então link, Baixar PDF e WhatsApp já levam o completo. Boleto mandado antes:
  aba Cobrança → **"Montar PDF com a nota"**; **"Ver PDF"** para conferir. Nota sem XML: vai sem a DANFE (o aviso diz).
  **Compartilhar** (Web Share com arquivo; Windows 10+/Chrome/Edge e celular): "📎 Compartilhar os PDFs com a <vendedora>" manda
  os arquivos de verdade com a mensagem (que também fica copiada, porque o WhatsApp do Windows às vezes não leva o texto);
  "ou mandar com o link" é o caminho antigo. A vendedora tem "📎 Compartilhar o PDF" na ficha/Fila para mandar ao cliente
  (marca como cobrado). Sem Web Share no navegador, os botões não aparecem e fica o WhatsApp com link.
  Achado no caminho: `@media (max-width: 1000px)` escondia `.assinatura`, e o html2canvas desenha numa janela de 794 px —
  **a assinatura sumia também do PDF dos orçamentos**; `.proposta-doc .assinatura { display: block }` resolve os dois.
  **1º uso real (14/10, 12:01–12:03):** os 4 boletos (NF 2286, 2357, 2363, 2382) foram arrastados de novo, o CRM montou os 4
  PDFs completos (XML lido para cada DANFE, ~510 KB cada) e o Anderson mandou pelo **Compartilhar** à Silmara, à Isabela e à
  Renata (sem link gerado). Os boletos da 1ª tentativa (10:45) ficaram sem uso: vale o mais novo de cada duplicata.
- **Somar contas marcadas (14/10, pedido do Anderson: os salários saem da conta da Agilité e ele precisa do total).** Caixa →
  Contas a pagar: caixinha em cada linha (e "marcar todas" no cabeçalho), **Shift+clique** marca o intervalo, barra fixa no alto
  com quantidade, total a pagar (ou saídas, entradas e saldo, se misturar), "Copiar valor" e "Limpar". A marcação fica guardada
  ao filtrar/buscar (some ao recarregar a página); não muda nada no banco. A célula inteira da caixinha marca (o clique um pouco
  ao lado da caixinha abria a conta para editar — achado pelo Anderson no 1º uso).
  **No fluxo de caixa (Dia a dia)** também: **Ctrl+clique** num item da grade marca para somar, ou o botão **"🧮 Somar"** liga o
  modo em que o clique simples marca (em vez de abrir o item); barra igual no alto da grade, item marcado com contorno dourado.
- **Empréstimo/transferência já pago (14/10, pedido do Anderson):** o quadro azul continua azul, mas com **letra e borda verdes**
  quando já foi pago ou recebido (`.cx-it.emprestimo.feito/.fora`); o previsto segue com letra branca. Legenda "🔁 empréstimo já pago".
- **Diferença na conferência com o banco (15/10, pedido do Anderson: CRM R$ 31.980,67 × banco R$ 31.913,29 — "senão essa
  diferença vai ficar perdida; foram tarifas bancárias").** Depois de "Usar este saldo", se o banco der diferente do CRM, abre
  "Diferença de R$ X a menos/a mais no banco" (`formDiferenca` em `caixa.js`) para lançar: conta em aberto do mesmo valor
  ("Era a conta …", até 3, vencendo até 7 dias depois), Tarifas bancárias, Juros/IOF, Outra saída (categoria) — ou, se entrou a
  mais, Rendimento, Estorno de tarifa, Outra entrada — ou "Não lançar". O lançado fica **pago fora do caixa** (`baixa: 'fora'`)
  no dia do saldo, então não mexe no saldo (o banco já conta). Valor editável (parte da diferença); aviso se a diferença passar
  de R$ 300 (pode ser baixa esquecida). Saldo de dia passado com baixas depois dele: só o aviso, sem a janela.
  15/10, 1º uso: o Anderson digitou o saldo e esperou ver a diferença **antes** de salvar (a janela só abria depois) →
  agora a diferença aparece na hora, enquanto digita (`#cxDifConf`, vermelho/verde), e o botão vira "Usar este saldo e lançar
  a diferença". Caso real: CRM 33.784,97 × banco 31.913,29 = 1.871,68 = **1.804,30 do "Recebi" da Santa Casa (002382/01, 09:12)
  que o banco ainda não creditou** + 67,38 de tarifas. Ou seja: diferença grande costuma ser crédito do dia seguinte.
- **PRÓXIMO (combinado em 14/10 para 15/10) — boleto à vendedora sem passar pelo compartilhar.** O Anderson reclamou que o
  "📎 Compartilhar os PDFs" abre o compartilhar do Windows e ele ainda escolhe o WhatsApp e a vendedora. Limite do navegador:
  o link do WhatsApp (wa.me) só leva texto; arquivo só pelo compartilhar, que não escolhe contato. Combinado:
  1. **FEITO em 15/10:** botões invertidos em `cobranca.js` (`botaoAvisar`, `formAvisar`): o principal é "📲 WhatsApp da
     <vendedora>" (abre a conversa dela com a mensagem e o link do "PDF completo (resumo, nota fiscal e boleto)", 7 dias, e a
     dica "abra o link no celular e use o Compartilhar"); "ou compartilhar o arquivo" ficou como segunda opção.
  2. **API oficial da Meta (WhatsApp Cloud API, fase 3):** o "Mandar às vendedoras" envia sozinho, a cada vendedora, a mensagem
     com o PDF anexado (depois, direto ao cliente). Precisa do Anderson: conta comercial da Meta verificada pelo CNPJ, número
     só do CRM (chip novo, não a linha de uma vendedora), modelo de mensagem aprovado (categoria utilidade). Daqui: Edge
     Function de envio (chave nos Secrets) e o botão. **15/10: passo a passo entregue ao Anderson** em
     `sistemi-dalessi/docs/meta-whatsapp-passo-a-passo.md` (utilidade no Brasil ≈ US$ 0,0068/mensagem pela tabela de 01/10/2026,
     segundo fornecedores; 1.000 respostas grátis/mês por número).
     **15/10, feito com o Anderson (prints):** portfólio **OneClean** criado na Meta (ao lado da Agilité; "não precisa ser
     verificada" por ora — sem verificação, até 250 destinatários/dia); app **CRM OneClean** (caso de uso WhatsApp); conta do
     WhatsApp Business **2185767059033904**; número = **linha fixa do galpão +55 11 2786-8106** (verificada por ligação; a linha
     comercial 98719-0372 NÃO serve: já está no WhatsApp e o caminho direto da Meta não tem coexistência — não migrar);
     ID do número **1346241728578054** (eu tinha lido 8578504 no print e o Secret ficou errado; corrigido em 15/10); status "Pendente" (nome OneClean em análise; "Registrar" falha até aprovar); cartão
     cadastrado; usuário do sistema **CRM OneClean** (61595458738738) criado. Falta: atribuir app + conta ao usuário do sistema,
     gerar o token (nunca expira) → Secret `WHATSAPP_TOKEN`; Secrets `WHATSAPP_PHONE_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_APP_ID`;
     registrar o número (PIN de 6 dígitos, com o Anderson); "Criar o modelo" em Integrações; teste no celular dele.
     **Código pronto:** Edge Function `crm-whatsapp` v1 (verify_jwt; só admin): `situacao`, `criar_modelo` (modelo
     `boleto_vendedora`, pt_BR, utilidade, PDF no cabeçalho — exemplo pela carga retomável do app), `teste` (PDF de exemplo ao
     celular do admin) e `enviar` (um envio por cliente à vendedora da carteira, PDF completo por link assinado de 7 dias;
     grava `crm_boletos.wa_msg/wa_status/wa_em/wa_erro`). Tela: cartão "WhatsApp oficial (Meta)" em Configurações → Integrações
     e, na Cobrança, "📤 Enviar a todas pelo WhatsApp da OneClean" (só com número CONNECTED e modelo APPROVED). Falta o
     webhook de entregue/lido (atualizar `wa_status`).
- **Volta do contato (14/10, pedido do Anderson):** o próximo passo da janela "Como foi…" tem também **"Em 15 dias"**.
- **Regra (14/10, Anderson): título recebido antes do vencimento é ADIANTADO.** A Santa Casa (002435/01, R$ 7.422,15) venceria
  em 25/10 e pagou em 14/10: o "Recebi" gravou certo, mas o cartão não dizia que o cliente adiantou. Agora `caixa-calculo.js`
  (`recebidoAntes`): entrada paga ligada a título com `pago_em` antes do vencimento (no dia útil) fica verde "⏩ adiantado" com
  "vencia dd/mm, o cliente pagou em dd/mm", também na leitura da Agilité (`adiantado: true`). Pago no vencimento ou depois, não.
- `execute_sql` com `delete` solto fica parado até o tempo esgotar (a ferramenta espera confirmação); o formato
  `with alvo as (...), d as (delete ... using alvo ... returning 1) select count(*) from d` passa normalmente.
- Na tela de cada pessoa os apagados somem na conferência de hora em hora da recarga leve, ou com F5 / "Recarregar dados".

## Permissões do financeiro (06/10/2026, pedido do Anderson)

- **Contas a receber (`crm_titulos`): só o administrador lê a tabela** (`le` = `crm_eh_admin()`, em
  produção por `alter policy`). Anderson: "tanto Isabela quanto os demais, somente o selo de duplicata
  em atraso, podendo dar detalhes". Gestora e vendedoras recebem só as **duplicatas em atraso, com o
  detalhe** (duplicata, NF, vencimento, valor, portador), pela função `crm_duplicatas_atraso()` —
  gestora: todas; vendedora: as da carteira — em `E.atrasos` (carregado no `recarregar`). O selo
  "vencido R$ … · N dias", o aviso "Combine o pagamento…" (Recompra, Fila do dia) e a seção
  "Duplicatas em atraso" da ficha saem dessa lista; `{titulos_vencidos}` dos modelos também.
- A gestora **grava títulos sem ler a tabela**: importação manual de nota → `crm_titulos_da_nota(novos,
  cancelados)` (insere com `on conflict do nothing` e tira os da nota cancelada); juntar cadastros →
  `crm_titulos_troca_empresa(de[], para)`. As duas recusam quem não é gestor/admin.
- De manhã existiu a `crm_titulos_vencidos()` (só flag, sem valor); trocada pela de cima. No banco de
  verdade ela ficou (o MCP trava em `drop`), sem uso — pode ser apagada pelo SQL Editor.
- **Comprador**: só o relatório de **estoque**. A faixa "Hora de puxar…", o "!" do menu, a recusa e a
  colinha mostram só a listagem de produtos (`CRM.lembreteFkn/recusasFkn`, `colinhaFkn`); as funções
  `crm_fkn_atualizado/situacao` devolvem a data e a recusa do contas a receber só ao administrador.
- **Contas a pagar e caixa**: só administrador (ver "Caixa").
- Ataque (`roda.sh`) cobre: gestora e vendedora não leem títulos; vendedora não vê atraso fora da
  carteira nem título a vencer; comprador não lê títulos, atrasos, contas a pagar nem a data/recusa do
  receber; só admin lê o financeiro.

## Sequência do lead novo (30/09/2026)

- `sequencia.js` (depois de `ajustes.js`) embrulha `CRM.auto.aoCriarEmpresa` e
  `aoConcluirTarefa`: lead cadastrado pela tela ganha o passo 1 (no lugar de "Fazer o primeiro
  contato"); concluir um passo agenda o seguinte (hoje + diferença de dias entre os passos).
  O passo é reconhecido pela descrição "[Sequência n/total] …" (não há coluna própria).
  Para quando o lead deixa de ser lead ou ganha negócio aberto/ganho (`continua`).
  Importação (Agendor, planilha, notas) não dispara a sequência.
- Passos em `cfg.sequencia_lead` (Configurações → Sequência do lead; na OneClean já gravados
  com o texto de limpeza/descartáveis), `cfg.sequencia_ativa`. Botão "Enviar WhatsApp/e-mail
  do passo" (tarefas e Fila do dia) abre com o texto, registra no histórico e conclui o passo.
- `CRM.ajustes.secao(id, rótulo, tela, depois, antesDe)` deixa módulo externo pôr seção em
  Configurações; `CRM.fichas.{variaveis, telDe, escolheContato, registraAuto}` estão expostos.

## Vigia de notas (importação automática) — não quebrar

- `ferramentas/vigia-notas.js` roda no servidor do emissor, lê a pasta `Autorizados`
  (subpastas AAAAMM ≥ `desde`), manda lotes de até 50 arquivos / 8 MB para
  `/functions/v1/crm-notas` com o header `x-crm-chave`. Estado local em
  `vigia-notas-estado.json` (tamanho + data de cada arquivo); os três arquivos locais estão
  no `.gitignore` (o `.json` tem a chave).
- `crm_integracoes` guarda **só o SHA-256** da chave (gerada no navegador em
  Configurações → Integrações, 32 bytes aleatórios, mostrada uma vez); RLS: só admin mexe;
  gestor lê `crm_integracao_log`; ninguém insere log pelo app (só a função, com a service
  role, que fica no servidor).
- A função é publicada com **verify_jwt desligado** (`--no-verify-jwt`): quem autentica é a
  chave de integração. Ela **não copia as regras**: baixa `regras.js` e `nfe.js` do
  raw.githubusercontent num COMMIT fixo e confere o SHA-256 antes de rodar. Mexeu em
  `regras.js` ou `nfe.js`? commit + push → `node ferramentas/fixa-motor-notas.js` →
  publicar a função de novo. `testes/motor.test.js` falha se os hashes fixados não
  baterem com os arquivos atuais — é o lembrete.
- Resposta por arquivo: `importada`, `já importada`, `fora: motivo`, `cancelamento`, `não é
  NF-e (ignorado)`, `erro`, `repetida no envio`; o vigia marca como enviado tudo que teve
  resposta (erro de gravação vai para o log do CRM, não se repete sozinho) e, se o envio
  falhar (rede, 5xx), para a volta e tenta de novo na próxima.

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
node ferramentas/carimba-versao.js     # SEMPRE que mexer em .js/.css/logo (versões no index.html)
node --test testes/*.test.js           # regras, importador e trava das políticas (rodar também com TZ=UTC)
sh supabase/teste-rls/roda.sh           # se mexeu no schema/permissões (ataque + volume)
```
e abrir o `index.html` no modo local (menu do usuário → "Carregar dados de
exemplo") para passear pelas telas. Não há build nem lint.
