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

## ONDE PARAMOS (30/09/2026, tarde) — retomar daqui

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
  (vendedora externa, 54). Bate com o Agendor de setembro (R$ 122.502,16). O FKM escreve
  o vendedor no `infCpl` ("…;VENDEDOR: ALYSSON;COD. CLIENTE: 01153;").
- Duplicados: 31 grupos "quase certos" mesclados com autorização (2.045 → 2.011 empresas),
  backup em `crm_backup.mescla_empresas` (schema fora da API). Os demais ficam para
  conferência manual em Configurações → Duplicados.

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
  vendedor da nota. O FKM da OneClean escreve "VENDEDOR: NOME;" no `infCpl` (conferido
  com os XML reais de setembro de 2026).
- RLS: gestor importa e corrige; vendedor lê as notas das empresas que vê (`crm_ve_nota`
  para os itens). Mesclar empresas leva as notas junto.
- Volume: as notas e os itens também carregam na memória no login. Com dezenas de
  milhares de itens ainda vai; se passar de ~100 mil itens, agregar no servidor (view)
  em vez de trazer item a item.

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
node --test testes/*.test.js           # regras e importador (rodar também com TZ=UTC)
sh supabase/teste-rls/roda.sh           # se mexeu no schema/permissões
```
e abrir o `index.html` no modo local (menu do usuário → "Carregar dados de
exemplo") para passear pelas telas. Não há build nem lint.
