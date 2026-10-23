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

## Histórico: onde registrar e onde procurar

- **O histórico fica em `docs/historico/AAAA-MM.md`, um arquivo por mês** (o que foi feito, quando, por
  pedido de quem, números conferidos, limpezas no banco com o nome do backup, decisões do Anderson).
  **Nunca registrar histórico novo neste CLAUDE.md**: acrescentar no fim do arquivo do mês corrente
  (criar o arquivo no 1º registro do mês, com o título `# Histórico — <mês> de <ano>`).
- Este arquivo guarda só o que vale em toda conversa: o que é o sistema, arquitetura, regras, comandos,
  segurança e publicação. Mudou uma **regra** (algo que vale daqui para frente)? Ajustar aqui, em uma
  ou duas linhas, e contar a história no arquivo do mês. Manter este arquivo abaixo de 30 mil caracteres.
- Antes de mexer numa área, procurar nela em `docs/historico/` (ex.: `grep -n "Caixa" docs/historico/*.md`):
  lá estão os detalhes, os casos reais e o porquê de cada regra. Até 23/10/2026 tudo estava aqui e foi
  movido sem mudanças para `2026-09.md` e `2026-10.md`.
- **Quando o Anderson disser "se atualize no projeto":** primeiro `git fetch` e `git status`. Pasta limpa e
  atrás do GitHub → `git pull`. Mudanças não commitadas ou conflito → **parar e avisar o Anderson antes de
  qualquer coisa**. Depois ler o CLAUDE.md e o `git log`.
- **No computador do escritório: ler e começar por `PENDENCIAS-ESCRITORIO.md`** (o que só dá para fazer
  de lá, como o SSH da VPS, e as perguntas que esperam o Anderson). Item resolvido: apagar a linha e commitar.
- Planos e documentos da empresa ficam no repositório **privado** `sistemi-dalessi` (`docs/plano-sair-do-fkn.md`,
  `docs/oneclean/…`: fiscal, concorrentes, SQL para o SQL Editor). **Este repositório é público.**

## O que é

CRM de equipe de vendas no estilo do Agendor, feito como **produto** da Sistemi Dalessi. Primeira
instalação: **OneClean** (produtos de limpeza e descartáveis; venda B2B com recompra frequente — daí o
peso de pós-venda, recompra e cliente inativo). Nasceu em 29/09/2026 para trocar o Agendor; desde então
virou o sistema de gestão da OneClean: vendas, notas, contas a receber/pagar e caixa, estoque, compras,
pedidos, NF-e, rotas de entrega, e-mails e WhatsApp. A **virada para só o CRM** (sair do FKN) é em
03/11/2026 (orçamento, pedido e NF-e de produção a partir daí). Desktop primeiro; o celular é usado pelo
motorista, pela logística e como app instalado (PWA).

- O sistema de gestão antigo da OneClean é o **FKN** (SIFWin, da FKN Informática) — com N; **não escrever
  "FKM"**. Dados em COBOL (.DAT/.IDX), não dá para ler direto: chega por CSV (relatórios) e pelos XML das notas.
- A OneClean tem duas razões sociais no FKN (DISTRIBUIDORA e BRASIL): **as duas valem como OneClean**.
- O "Caixa" do CRM conversa com o sistema da **Agilité** (outra empresa do grupo, `agilite-sistema-gestao`):
  leitura do caixa (`crm-caixa-leitura`) e espelho das transferências entre empresas (`crm-caixa-espelho`).
  **O leitor de frases do Caixa (`frases.js` `interpretar`) é o mesmo código nos dois sistemas**: mudou lá,
  copiar para cá; mudou aqui, avisar a Agilité.

## Instalação OneClean (este repositório)

- Endereço: https://sistemidalessi.github.io/crm-oneclean/ (GitHub Pages, branch `main`, raiz).
- Supabase: organização **OneClean**, projeto **OneClean CRM**, ref `udhigavckigciqnicgyy` (sa-east-1),
  **plano Pro** (limite de gastos ligado). Esta é a cópia viva do código; `sistemi-dalessi/crm/` é só
  histórico (a versão genérica do produto: sem `turma`, nome "CRM").
- **Servidor da OneClean** (Windows Server 2012 R2, Node 18.20.8, PowerShell 4 sem TLS 1.2 por padrão):
  `C:\CRM\vigia-notas.js`, tarefa do Windows "CRM - vigia de notas" (ao iniciar + a cada 10 min), XML em
  `D:\SISTEMA\Unimake\uninfe30\63237702000103\Enviados\Autorizados`, CSV do FKN em `D:\sistema\CRM-FKN`
  (`\\Servidor\sistema\CRM-FKN`). Baixar o vigia **pelo Node** (o `Invoke-WebRequest` falha por TLS).
- **Serviço fiscal** (`servico-fiscal/`, NF-e direto na Sefaz-SP) na **VPS da Agilité**: usuário
  `oneclean-fiscal`, porta 8787 só em 127.0.0.1, Caddy em `fiscal.oneclean.com.br`. Instalação em
  `servico-fiscal/INSTALAR.md`. Atualizar (só do escritório, que tem o SSH):
  `cd /opt/oneclean-fiscal && git pull -q && systemctl restart oneclean-fiscal && systemctl is-active oneclean-fiscal`.

## Arquitetura

- **Estático, sem build, sem npm.** Scripts clássicos (não módulos) carregados em ordem no `index.html`,
  compartilhando `window.CRM`, `CRMRegras`, `CRMDados`, `CRMPlanilha`, `CRMNfe`, `CRMXlsx` etc. Abrir o
  `index.html` direto já funciona (modo local).
- **Camadas:** `regras.js`, `planilha.js`, `nfe.js`, `fkn.js`, `financeiro.js`, `caixa-calculo.js`,
  `cadencia.js`, `perfil.js` e as partes puras de cada tela (`CRMGestao`, `CRMPedidos`, `CRMRotas`…) rodam
  no Node, com teste; `dados.js` é a única que fala com banco; `ui.js` só interface genérica; `app.js` núcleo
  (abas, grupos do menu `GRUPOS`, recarga, versão); as telas em arquivos próprios (`telas.js`, `fichas.js`,
  `ajustes.js`, `gestao.js`, `caixa.js`, `estoque.js`, `pedidos.js`, `emissao.js`, `produtos.js`, `turma.js`…).
  Tela nova = entra em `ABAS` e num grupo de `GRUPOS`.
- **Dados em memória:** carrega as tabelas no login (paginando de 1000 em 1000), indexa (`R.indexa`) e
  renderiza. Gravação: grava no banco e troca o registro na memória (`CRM.inserir/atualizar/remover`).
  Tabelas à parte (fiscal, caixa, estoque) são lidas quando a tela abre.
- **Recarga leve (tráfego do Supabase):** a automática traz só as linhas com `atualizado_em` depois da marca
  (`dados.js` `carregarMudancas`/`aplicaMudancas`/`marcaRecarga`); tabelas pequenas em `INTEIRAS`; de hora em
  hora a conferência do que foi apagado (só as chaves); carga completa só ao entrar e em "Recarregar dados".
  **Não voltar a recarregar tudo em timer.** Tabela nova grande entra em `PARCIAIS` (precisa de `atualizado_em`
  com gatilho). Teste: `testes/recarga.test.js`.
- **Limite de 1.000 linhas do PostgREST** (vale mesmo com `.limit(3000)`): lista que pode passar de 1.000
  linhas → `paginado()` (`dados.js`); soma → no banco. Insert em lote com `defaultToNull: false`; lote
  recusado é regravado um a um (`aoErro`).
- Leitura que falha por demora/rede tenta de novo 3 vezes (`comTentativas`); sem carga, a tela diz "seus dados
  estão guardados" e tenta sozinha; com dados antigos, só a faixa `#faixaCarga`.
- **Render:** HTML em string, **sempre** passando texto por `esc()`. Eventos por delegação em `data-acao`
  (`CRM.acoes`; o 3º parâmetro de uma ação é o evento do clique — não tomar por dado). CSP proíbe `onclick=` e
  `style=`: larguras de barra vão por `data-largura` + `CRM.aplicaBarras` (CSSOM). Cuidado com nomes de
  classe já usados (`.topo`, `.meta`, `.faixa`).
- `renderAgora` guarda e devolve rolagem e `<details>` abertos (dar baixa não sobe a página); `<details>`
  repetidos precisam de `data-chave` própria.
- **Ordem alfabética em todo o sistema:** `R.ordemAlfa`/`alfaOpcoes`/`comparaAlfa` (sem acento, "Item 2" antes
  de "Item 10"), `alfa: true` nos selects de nomes. Ficam na ordem própria: etapas do funil, status, tipos,
  prazos, meses, códigos fiscais, telefones.
- `ui.js`: select de formulário acrescenta o valor gravado como opção quando ele não está na lista.
- Números e listas dos quadros saem do mesmo cálculo (`R.dashboard(...).listas`, `R.faturamento(...).lista`):
  **número e lista sempre batem; não recalcular à parte.**
- **Dois modos:** `config.js` vazio = local (`localStorage`, admin fictício, dados de exemplo, NF-e simulada);
  preenchido = Supabase com login. `config.js` também tem cores, logo e a `turma` (mascotes).
- `.xlsx` lido por `xlsx-leitor.js` (ZIP/ZIP64 + DecompressionStream + DOMParser). **Não trocar pelo SheetJS
  do npm** (a 0.18.5 tem vulnerabilidades conhecidas). CSV: tenta UTF-8, cai para Windows-1252.
- Bibliotecas de terceiros ficam em `vendor/` (html2canvas, jsPDF, pdf-lib), carregadas só na hora, sem CDN.
- `sw.js` **sem cache** (só deixa instalar o app); a versão nova continua chegando pela rede.

## Banco (Supabase)

- `supabase/schema.sql` é a fonte da verdade, idempotente (roda de novo sem perder dado). Coluna nova:
  `alter table ... add column if not exists` no `schema.sql` + campo no formulário. Tipo novo de atividade:
  `TIPOS_ATIVIDADE` em `regras.js` **e** o `check` de `crm_atividades.tipo`. Mesmo para situações e status.
- **Permissões na RLS, não na tela.** Papéis: admin, gestor, vendedor, comprador, logística, motorista
  (`crm_eh_admin/gestor/membro/ativo/comprador/logistica/motorista()`, `crm_eh_estoque_op()`). O cliente espelha
  só para esconder botões. Ao criar política nova: copiar o formato das que existem.
- **Política de leitura nunca chama função por linha** (`crm_ve_empresa(id)` etc.): usar
  `coluna in (select public.crm_empresas_minhas())` e `(select public.crm_eh_gestor())` / `(select auth.uid())`.
  `testes/rls-rapida.test.js` barra; `supabase/teste-rls/volume.sql` falha se leitura passar de 1 s
  (incidente de 01/10/2026: CRM vazio para todos por política lenta).
- Gravações sensíveis só por função (`crm_pedido_gravar`, `crm_produto_gravar`, `crm_estoque_contagem`,
  `crm_compra_lancar`…); tabelas com custo, financeiro e fiscal têm RLS própria (ver Regras por área).
- **Rodízio** (`crm_proximo_vendedor`) é função no servidor; nunca cai em comprador, logística ou motorista.
- **Histórico de alterações** por trigger (`crm_audita`) em empresas, contatos, negócios, propostas, usuários,
  etapas, produtos. Atividades ficam de fora de propósito. Caixa **sem** auditoria (a gestora lê o histórico).
- **Usuários novos** só pela Edge Function `crm-usuarios` (service_role fica no servidor, confere admin ativo).
  **Nunca pôr service_role no app.**
- `crm_config` é gravado **por partes** (`CRM.salvarConfig` → `crm_config_mesclar`): nunca regravar a
  configuração inteira com a cópia da tela (desfaria o que outro computador salvou, inclusive a emissão em
  produção). `crm_config_guarda`: fiscal, boleto, comissões, tabela de preços, margem mínima e trava de preço
  só o admin muda. Chaves que não podem ser desfeitas por tela aberta ficam em `crm_sistema` (ex.:
  `produtos_dono = crm`, que desliga o FKN; sem volta pela tela).
- Ao mexer em permissão: rodar `sh supabase/teste-rls/roda.sh` (Postgres local que imita os papéis do Supabase;
  falha se aparecer "NÃO devia" ou leitura lenta). Conferir também no banco real numa transação desfeita
  (`set local role authenticated` + `request.jwt.claims`).
- **Cuidados com o conector do Supabase (MCP):** SQL com `delete`, `drop` ou `revoke` (até dentro do corpo de
  uma função, e também via `apply_migration`) pede confirmação que não chega e cai por tempo. Desenhar sem eles
  (migração nova sem `drop ... if exists`; `alter policy` em vez de recriar) e, quando forem inevitáveis, passar
  o SQL ao Anderson para o **SQL Editor** (os `revoke` de função nova sempre vão para ele; conferir depois).
  `delete` no `execute_sql` passa no formato `with alvo as (...), d as (delete ... using alvo ... returning 1)
  select count(*) from d`. O MCP não grava segredo de função. Migração grande pode estourar 60 s: fazer em etapas.
- **Limpeza de dado real:** sempre com autorização do Anderson e **backup antes** em `crm_backup.<assunto>_<data>`
  (schema fora da API). Exclusão de registro de cliente se faz pelo próprio CRM (Editar → Excluir, conta de
  admin), depois do backup e de mover o histórico. Registrar no histórico do mês.
- Daqui não se chama `supabase.co` nem o github.io (a rede da sessão barra): conferir publicação pelo `gh`.

## Publicação

- **Versão nova sem Ctrl+F5:** o `index.html` leva `?v=` em cada arquivo e a versão geral em
  `<meta name="crm-versao">`, carimbados por `node ferramentas/carimba-versao.js` (rodar antes de **todo** commit
  que mexe em .js/.css/logo; `testes/versao.test.js` reprova se esquecer). O app confere a versão publicada a cada
  ~4 min e recarrega sozinho quando não há janela aberta nem campo com texto (`confereVersao`).
- Publicação do Pages presa na fila: um push novo dispara outro build. Conferir:
  `gh api "repos/sistemidalessi/crm-oneclean/actions/runs?per_page=3"` (último `success` = no ar).
- **Motor fixado das Edge Functions:** `crm-notas` baixa `regras.js`, `nfe.js` e `fkn.js`, e `crm-caixa-leitura`
  baixa `caixa-calculo.js`, do raw.githubusercontent num **commit fixo** com SHA-256 conferido. Mexeu num deles:
  commit + push → `node ferramentas/fixa-motor-notas.js` → commit + push → publicar a função de novo
  (`testes/motor.test.js` avisa). Por isso regra nova de tela fica **fora** do `regras.js` quando dá
  (`gestao.js`, `cadencia.js`, `perfil.js`, `TELA_INICIAL_PADRAO` em `app.js`).
- Ao publicar Edge Function, conferir o conteúdo publicado (md5) com o do repositório. `verify_jwt` desligado
  só onde a autenticação é outra: `crm-notas` (chave de integração), `crm-caixa-leitura` e `crm-caixa-espelho`
  (senha própria), `crm-email-sair`, `crm-pdf`, `crm-whatsapp-retorno` (assinatura da Meta).
- **Push só quando o Anderson pedir.**

## Regras por área (detalhes no histórico do mês)

**Importação e cadastro**
- Tudo converge para registros normalizados → `CRMPlanilha.planeja()` decide criar / completar / ignorar, em
  **cópias** de `D`. Deduplicação por `externo_id` (`agendor:org:123`), `externos_mesclados`, CNPJ, `R.chaveNome`,
  e-mail e telefone. Padrão é **completar só o vazio**; sobrescrever é opção explícita (reextração do Agendor:
  só negócios e atividades). **Reimportar o mesmo arquivo tem que dar zero criações** (teste cobre).
- Planilha do Agendor: `P.ehPlanilhaAgendor` + `P.prefixaAgendor` dão os mesmos ids da API. Tarefa sem tipo e sem
  prazo é "Nota" (histórico). Negócio sem empresa procura pelo nome de reserva (`nomeDeReserva`).
- **Nunca pôr nome real de cliente em teste nem em commit** (repositório público): testes com nomes fictícios no
  mesmo formato; conferência com nomes reais só localmente, fora do repositório.
- **Trava de duplicado no banco** (`crm_barra_duplicado`): CNPJ/CPF, telefone (8 últimos dígitos), WhatsApp ou
  e-mail de outra empresa é recusado, só no que mudou. Chaves iguais em `R.chaveDoc/chaveTelefone/chaveEmail` e
  `crm_doc/crm_tel/crm_mail`: **mudou um, mudar o outro**. Dado igual de pessoa de contato só avisa.
- "Quase certo" (`R.mesmoCliente`) = mesmo CNPJ, ou e-mail E telefone E nome compatível. **Só e-mail + telefone
  não basta** (a mesma síndica atende vários condomínios). Mescla apaga os repetidos antes de completar o que fica.
  "É outra empresa" guarda o par em `cfg.nao_mesclar_notas`; não mesclar o que o Anderson separou.
- Cliente da nota: CNPJ → nome igual (não se o cadastro tem outro CNPJ) → mesma raiz = filial (`grupo_id`) →
  parecida (só se for uma). `CRMNfe.vendasIguaisNotas` acha venda do Agendor = nota de outro cadastro.
- **CNPJ alfanumérico** (desde 07/2026): um normalizador só em `regras.js` (`R.doc`, `R.chaveDoc`, `R.cnpjValido`,
  `R.formataCNPJ`). **Nunca mais tratar CNPJ com `digitos()`/`\D`.** Testes em `testes/cnpj.test.js`.

**Notas fiscais, vigia e FKN**
- `nfe.js` (puro): lê nfeProc/NFe e cancelamento por regex; nota só vale com `protNFe` 100/150 e cancelamento com
  `retEvento` 135/136/155. Chave única: reimportar não duplica. Venda = CFOP 5/6/7 com grupo 1 ou 4
  (`R.cfopDeVenda`). Completa o cadastro só no vazio. Notas da equipe: filtro `vendedores`/`carteira`/`auto`
  (o FKN escreve "VENDEDOR: NOME;" no `infCpl`); `nomes_nota` (admin = DIRETO), `cfg.vendedores_antigos`.
- Títulos nascem das parcelas da nota (`<dup>`), duplicata `prefixoDup(numero, serie)` ("002527/01"; série ≠ 1:
  "2-000012/01").
- **Vigia de notas** (`ferramentas/vigia-notas.js`): lotes para `crm-notas` com `x-crm-chave`; `crm_integracoes`
  guarda **só o SHA-256** da chave; estado local e chave no `.gitignore`. Sinal de vida a cada 30 min (faixa
  `#faixaVigia` após 75 min); trava de 20 min sem completar uma volta → sai com erro e a tarefa religa.
  Chave derivada do `FISCAL_TOKEN` só entrega XML.
- Relatórios do FKN pelo vigia (`fkn.js`): listagem de produtos (SIFN108), contas a receber (SIFN016) e a pagar
  (Sifn083), com conferências que recusam arquivo com opção faltando (vai para `crm_integracao_log`). Com a chave
  `produtos_dono = crm` o FKN está **desligado**: a `crm-notas` ignora todo CSV do FKN.
- **Embalagens do FKN:** a caixa (variante `.1`, `.2`) é o mesmo estoque da unidade visto em caixas. **Nunca somar
  a caixa de novo** nem separá-la; ela só dá o fator.
- Lembrete do FKN só de segunda a sexta; **não acrescentar sábado**. Exportação do FKN por linha de comando:
  adiado pelo Anderson, **não insistir**.

**Vendas, orçamentos e pedidos**
- Orçamento do FKN importado vira proposta no layout da OneClean (`orcamento.js`); reimportar o mesmo número
  atualiza; atualização fica no mesmo negócio (`negocioDoOrcamento`); cliente sem CNPJ não é cadastrado de novo
  (`clienteDoOrcamento`). Etapa avança, **nunca volta**. E-mail lido só com @.
- PDF do orçamento: html2canvas + jsPDF, **sempre na primeira folha** (modo denso e redução até 60%); NCM em cada
  item; assinatura "Sistemi Dalessi" (`cfg.sem_assinatura` tira). Fotos de produto **no orçamento** foram tiradas
  a pedido do Anderson: não reintroduzir sem ele pedir.
- Pedidos (`pedidos.js`): itens em jsonb gravados por função; reserva no disponível; bloqueios ESTOQUE, ATRASO,
  SEM ENTRADA, PREÇO (margem abaixo de `cfg.margem_minima`); liberação: gestora, admin e logística. Nota casa com
  o pedido sozinha. Nota que cobra **não sai sem forma de pagamento** ("PROGRAMADO" exige data).
- "Ganhei" pergunta se já há venda parecida (`fichas.vendaParecida`); pós-venda é tarefa, não funil (o funil de
  Pós-Vendas foi retirado). Só o "Funil de Vendas" existe.
- Comissão nasce na nota emitida (`P.apuraComissao`); devolução desconta faturamento e comissão no mês da
  devolução (`devolucoesComoNotas`). Mês fechado não muda.

**Custo, estoque e compras**
- **Custo e margem só para administrador, gestora e comprador** (decisão de 20/10/2026). Vendedora e logística
  não veem custo: leem por funções que devolvem só quantidades (`crm_pedidos_ler`, `crm_estoque_*_op`…).
  `crm_ofertas` **nunca guarda o custo**.
- Estoque do CRM: livro `crm_estoque_mov` (não se edita nem se apaga; erro se corrige com estorno/ajuste) e saldo
  por gatilho; custo médio ponderado. Com a chave ligada, o banco espelha o estoque em `crm_estoque`.
- Sugestão de compra usa o saldo como ele é (negativo conta). Fornecedor com `ativo = false` deixa o produto sem
  fornecedor. Entrada de compra lança contas a pagar só com a chave ligada (antes duplicaria com o FKN).
- Concorrentes: a lista fica no banco (`crm_concorrentes`), **nunca no código**; estratégia e levantamento no
  `sistemi-dalessi` (privado). Sites de concorrente ficam bloqueados na busca de fotos.

**Caixa e financeiro (só administrador)**
- Contas a pagar, caixa e títulos (`crm_titulos`) só o admin lê; gestora e vendedora recebem só as duplicatas em
  atraso (`crm_atrasos()`), a vendedora da carteira. Título em cartório: selo "não cobrar".
- Contas em `caixa-calculo.js` (puro, mesmo cálculo da tela e da leitura da Agilité). Dia útil = bancário de São
  Bernardo do Campo; título cai D+1. "Pago fora" (`baixa 'fora'`) não mexe no saldo.
- Leitura da Agilité **sem nome de pessoa** (salários, pró-labore, retiradas somados por categoria; CPF e telefone
  mascarados).
- Lançamento excluído vai inteiro para `crm_fin_excluidos`; conta do FKN excluída não volta.
- Baixa no FKN **não vira entrada sozinha** (nem sempre é dinheiro no banco): bloco "Baixados no FKN".
- Espelho com a Agilité: só a categoria "Transferência entre empresas"; `ref` **sempre** o id original, par
  completo, sem eco (`crm.espelho = '1'`).
- Boleto: PDF com vários boletos é separado por página — a vendedora **nunca** recebe o boleto de outro cliente
  (se não separar, vai sem PDF). Boleto de exemplo do BB sai com o dígito trocado e **nunca** é registrado.

**Fiscal e NF-e**
- Emissão: navegador → `crm-fiscal` (login de quem clicou) → serviço fiscal na VPS → Sefaz-SP. Emite: admin,
  gestora, logística; configura e fecha o mês: admin.
- **Nota de homologação nunca entra no CRM** (nem estoque, título ou comissão). Número rejeitado é reaproveitado;
  pendente obriga a consultar; inutilizado não volta.
- Regras fiscais em `crm_fiscal_produtos` (só admin); erro conhecido já vem corrigido na proposta (`fiscal.js
  analisa`). Mudança de regra com fonte e backup; o que é incerto vai ao contador (`sistemi-dalessi/docs/oneclean/fiscal/`).
- Reforma 2027: decide pela **data de emissão**, nunca pela de hoje; nota de 2026 sai idêntica.
- Leiaute: devolução referencia só por item (`DFeReferenciado`); CST sem destaque em SP leva cBenef.
- DIFAL (venda a consumidor de outra UF): alíquota interna em `dados.fiscal.difal[UF]` e exceções por NCM
  (`DIFAL_NCM` em `servico-fiscal/pedido.js`, `difal[UF].excecoes`); só cliente sem IE e só venda; GNRE lançada no Caixa.
- Conferência TLS da Sefaz **nunca** é desligada (cadeia extra em `FISCAL_CA`/`cadeia.pem`).
- ICMS-ST retido pela nota de compra: produto achado pelo item, pela ligação ou pelo código de barras na mesma
  unidade; **nunca adivinha o fator**.
- Notas de compra pela Sefaz (DF-e): consulta **sempre em produção** (não emite nada); respeitar `ultNSU` e a
  espera de 1 hora. Ciência da operação é manual, só do admin, quando a mercadoria chegou (decisão do Anderson).

**IA, mascotes e comunicação**
- IA (`crm-assistente`, `crm-produto-buscar`, `crm-caixa-ler`, `crm-oferta-texto`): **só consulta**, sempre com o
  login de quem pergunta (RLS de sempre), ferramentas por papel, limite diário reservado no banco
  (`crm_ia_reservar`). Modelos: `claude-opus-5-5` (conversa, leitura de anexos), Haiku 5.5 (fotos).
  `ANTHROPIC_API_KEY` só nos Secrets. Foto/ficha aprovada pode ir sozinha ao cadastro (decisão de 21/10).
- Turma (mascotes, `turma.js` + `config.js turma`): o Clean é a agenda (substitui o sino). **Não voltar a espalhar
  mascote pela tela sem o Anderson pedir.** Desenho novo com parte branca: conferir sobre fundo colorido.
- WhatsApp: **sem WhatsApp não oficial** (Z-API, Evolution: risco de bloqueio). O oficial é a API Cloud da Meta
  (`crm-whatsapp`, modelos aprovados; PDF sobe como mídia). Cobrança vai direto ao cliente quando o modelo
  `boleto_cliente` está aprovado; o CRM **não manda sozinho ao cartório**.
- E-mail pelo Brevo (`crm-email`), em nome da vendedora da carteira, com fila de aprovação; descadastro (LGPD) só a
  função grava (`email_sair_em`).
- Login 1 vez por dia no navegador; app instalado pede o login a cada abertura.

## Segurança (lições da auditoria de 11/09/2026 aplicadas)

- Nenhuma política `using (true)`; `anon` sem privilégio em tabela nenhuma;
  SECURITY DEFINER sempre com `search_path` fixo e sem execute para `anon`.
- CSP estrita no `index.html`; única origem externa de script é o supabase-js
  **com versão exata e SRI** (mesmo hash da JJ Solene, conferido contra o pacote
  do npm). Trocar de versão = recalcular o hash.
- Cadastro público do Auth **desligado** no painel (não dá por SQL).
- Token do Agendor nunca entra no repositório; o extrator lê da linha de comando.
- **Segredos só nos Secrets do Supabase ou na VPS — nunca no chat, no CRM, no repositório, em e-mail, WhatsApp
  ou arquivo:** `ANTHROPIC_API_KEY`, `BREVO_API_KEY`, `WHATSAPP_*`, `FISCAL_URL`/`FISCAL_TOKEN`, `IBPT_TOKEN`,
  chaves do BB. Senhas de integração (vigia, leitura do Caixa, espelho) são geradas na tela e o banco guarda
  só o SHA-256; o Anderson cola direto no destino. Na Meta, "Redefinir" troca a chave do app: o certo é "Mostrar".
- **Certificado A1 (.pfx e senha) só existe na VPS** — nunca no repositório, no CRM, no chat. O serviço fiscal só
  escuta em 127.0.0.1.
- Buckets com dado de cliente são privados (`crm-notas-xml`, `crm-boletos`, `crm-canhotos`, `crm-caixa-anexos`,
  `crm-compras-xml`); o público `crm-produtos-fotos` só leva foto e ficha de fabricante. Downloads da IA só de
  http(s) público, com DNS conferido (sem IP interno).
- CSV exportado: texto que começa com `= + - @` ganha apóstrofo (`R.csvCelula`).
- Documentos da empresa (planilhas, manuais em PDF, relatórios) **não são versionados** aqui.
- **Sessão do vigia da legislação: nunca alterar código nem este arquivo** (grava só em
  `docs/legislacao/registro.md`; tarefa `trig_01QWhye9ACBaGp8a6jKiA56D`, sempre a mesma sessão).
- Auditoria de 22/10/2026 (20 itens) fechada: não reabrir sem motivo novo (detalhes em `docs/historico/2026-10.md`).

## Verificar antes de commitar

```
node ferramentas/carimba-versao.js     # SEMPRE que mexer em .js/.css/logo (versões no index.html)
node --test testes/*.test.js           # regras, importador e trava das políticas (rodar também com TZ=UTC)
sh supabase/teste-rls/roda.sh           # se mexeu no schema/permissões (ataque + volume)
```
e abrir o `index.html` no modo local (menu do usuário → "Carregar dados de
exemplo") para passear pelas telas. Não há build nem lint.
