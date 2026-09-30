# CRM — Sistemi Dalessi

CRM para equipe de vendas, feito pela Sistemi Dalessi. Primeira instalação:
**OneClean Produtos de Limpeza e Descartáveis**, substituindo o Agendor a partir
de 01/10/2026. O código é o mesmo para qualquer cliente; o que muda por
instalação é o `config.js` (nome, logo, banco) e o banco Supabase de cada um.

Responde em poucos segundos: **quem é o cliente, o que está sendo vendido, em
que etapa está, quanto vale, o que aconteceu até agora, quem é o responsável e
qual é o próximo passo.** Feito para uso no computador.

## O que tem

| Tela | O que faz |
|---|---|
| **Início** | "O que fazer hoje": tarefas atrasadas e do dia (com WhatsApp/Ligar ao lado), próximos 3 dias, meta do mês, **leads sem atendimento**, **negócios parados**, **hora da recompra**, **clientes sem contato**. |
| **Funil** | Etapas personalizáveis (vários funis, se quiser), arrastar o negócio entre etapas, soltar em **GANHOU/PERDEU**. Mostra dias na etapa, "parado", "sem próximo passo", previsão vencida. Filtro por origem e busca. |
| **Empresas** | Lista com busca (nome, CNPJ, telefone, e-mail, pessoa), filtros (situação, responsável, segmento, origem, etiqueta, UF, cidade, qualificação, último contato, cadastro, sem tarefa), **filtros salvos**, ordenação, **ações em massa** (trocar responsável levando negócios e tarefas, situação, etiquetas, criar tarefa, excluir) e exportar para Excel. |
| **Pessoas** | Contatos de todas as empresas, com aniversariantes do mês e WhatsApp/Ligar. |
| **Negócios** | Todos os negócios com filtro por status, etapa, vendedor, origem, motivo de perda e período (criação, fechamento ou previsão). |
| **Atividades** | Agenda da semana com as tarefas por dia e hora; atrasadas em destaque; "+" em cada dia. |
| **Relatórios** | Por funil, com os nomes do painel do Agendor: negócios ganhos, iniciados e perdidos, taxa ganhos vs perdidos (em quantidade e em valor); vendas previstas, pipeline, ticket médio, conversão, ciclo médio, leads novos, clientes novos × recorrentes, vendas por mês e previsão, **por vendedor com meta**, funil agora, origem dos leads (e quantos viraram cliente), motivos de perda, vendas por produto e por origem, atividades. Cada tabela exporta CSV. |
| **Faturamento** (dentro de Relatórios) | Pelas **notas fiscais importadas (XML)**: total faturado, clientes que compraram (e quantos pela 1ª vez), ticket por nota, faturamento por mês, **top 10 clientes**, **vendas por segmento** (escola, indústria, condomínio…), **top 10 produtos** por valor e por quantidade, por vendedor e por cidade. Cada tabela exporta CSV; clientes e produtos têm a lista completa. |
| **Configurações** | Automações e alertas, funil/etapas, origens/segmentos/motivos, produtos, **equipe e permissões**, metas, modelos de mensagem, importar, exportar/backup, **duplicados** (mesclar), **histórico de alterações**. |

**Ficha do cliente — tudo em uma tela:** dados, pessoas (com WhatsApp, ligar,
e-mail), registrar o que aconteceu em dois cliques (ligação, WhatsApp, e-mail,
reunião, visita, anotação, ocorrência) com "registrar + próximo passo", linha do
tempo com filtro, próximo passo, negócios em andamento, **compras anteriores**
(total, ticket, última compra, intervalo médio entre compras) e propostas.

**Ficha do negócio:** etapas clicáveis, Ganhei/Perdi (motivo obrigatório),
produtos com quantidade, preço e desconto (o valor do negócio vira a soma),
**propostas numeradas** com validade e condições, que saem prontas para imprimir
ou salvar em PDF; status rascunho → enviada → aprovada/recusada.

**Comunicação:** WhatsApp e e-mail abrem já com o texto do **modelo** escolhido
(`{primeiro_nome}`, `{empresa}`, `{vendedor}`…) e **ficam registrados sozinhos**
no histórico. Ligar abre o discador e o formulário para anotar o resultado.
Tarefa vira evento no **Google Agenda** com um clique.

**Automações** (cada uma liga/desliga em Configurações): lead novo ganha a tarefa
"primeiro contato"; **rodízio** de leads entre vendedores; venda ganha cria
**pós-venda** e **lembrete de recompra** no ciclo do cliente; perdido pode criar
"retomar contato"; enviar proposta move o negócio de etapa; tarefas
**recorrentes**; **lembretes** na tela 10 minutos antes; alertas de negócio parado,
cliente sem contato e cliente inativo.

**Atalhos:** `Ctrl+K` ou `/` busca qualquer coisa · `N` novo lead · `T` tarefa ·
`R` registrar atividade · `1`–`8` telas · `?` ajuda.

## Permissões (garantidas no banco, não só na tela)

| Papel | Vê | Pode |
|---|---|---|
| **Vendedor** | só a **própria carteira**: empresas em que é responsável ou em que tem negócio | trabalhar a carteira; não troca responsável, não apaga empresa/negócio, não entra em Configurações |
| **Gestor** | a equipe toda (escolhe no topo "Equipe toda" ou um vendedor) | redistribuir carteira, relatórios, configurações, excluir |
| **Administrador** | tudo | tudo, mais criar/desativar usuários |

**Sem cliente duplicado:** o banco não deixa cadastrar (nem trocar para) um CNPJ/CPF,
telefone ou e-mail que já é de outra empresa, em qualquer carteira; enquanto digita, o
cadastro já avisa de quem é. Cadastro novo pede telefone com DDD e e-mail (CNPJ é opcional).

Usuário desativado perde o acesso na hora. Quem tem login mas não está na
equipe não vê nada. Toda alteração em empresa, pessoa, negócio, proposta,
usuário, etapa e produto fica no **histórico de alterações** (quem, quando, o quê).

## Migração do Agendor — roteiro do dia

1. **Banco pronto** (feito uma vez; ver "Instalar" abaixo) e o administrador entrando.
2. **Equipe:** em Configurações → Equipe, criar os vendedores com o **mesmo nome
   ou e-mail que usam no Agendor** — assim a carteira de cada um é reconhecida
   sozinha. Quem não for reconhecido aparece na tela de importação para você dizer
   de quem é.
3. **Extrair do Agendor** no computador do escritório (precisa de Node 18+):
   ```
   node ferramentas/agendor-exportar.js SEU_TOKEN
   ```
   O token fica no Agendor em **Menu → Integrações**. O script baixa usuários,
   funis, produtos, empresas, pessoas, negócios (com produtos) e tarefas, e
   mostra os totais para conferir com o Agendor. As tarefas antigas vêm empresa
   por empresa e negócio por negócio (a lista geral do Agendor só volta 31 dias),
   por isso essa parte leva alguns minutos. Se o total de negócios vier a menos,
   rode de novo com `--completo`.
   Para conferir o arquivo **sem mostrar dados de clientes**:
   `node ferramentas/agendor-exportar.js --estrutura agendor-exportado-AAAA-MM-DD.json`
4. **Por garantia**, exporte também as planilhas do Agendor (Empresas, Pessoas,
   Negócios) em Excel. Se algo não vier pela API, entra por "Planilha".
5. **Importar:** Configurações → Importar → "Do Agendor" → escolher o arquivo →
   conferir o resumo (criar / completar / ignorar e responsáveis) → Importar.
   Rodar de novo o mesmo arquivo **não duplica** (cada registro guarda o id do Agendor).
   Numa **extração nova** (o Agendor continuou em uso), deixe marcado "Atualizar negócios e
   tarefas com o que mudou na origem": etapa, ganho/perdido, valor e tarefas concluídas ou
   remarcadas passam a valer como no Agendor; empresas e pessoas só são completadas.
6. **Conferir:** totais em Empresas/Negócios, abrir 5 clientes conhecidos e ver
   histórico, negócios e tarefas. Configurações → Duplicados para limpar o que o
   Agendor já tinha repetido.
7. **Notas fiscais:** Configurações → Importar → "Notas fiscais (XML)" → escolher os XML
   (vários de uma vez) ou o .zip exportado pelo sistema de notas/contabilidade → conferir →
   Importar. Liga cada nota ao cliente (CNPJ, razão social ou nome), completa o CNPJ que
   faltava e cadastra quem ainda não estava. Depois, em Configurações → Origens, segmentos,
   motivos → "Preencher pelo nome das empresas", para o relatório por segmento.
8. **Depois:** apagar as etapas-padrão que sobraram sem uso (Configurações →
   Funil), apagar o arquivo exportado (tem dados de clientes) e **revogar o token**
   no Agendor.

## Instalar para um cliente novo

1. **Supabase:** uma organização e um projeto por cliente (nunca no banco de
   outro sistema). SQL Editor → colar [`supabase/schema.sql`](supabase/schema.sql)
   → Run (pode rodar de novo sem perder dado).
2. **Auth:** Authentication → Sign In / Providers → desligar **"Allow new users to
   sign up"**. Em URL Configuration, pôr o endereço do CRM em *Site URL* (é para
   onde vai o link de "esqueci minha senha").
3. **Primeiro administrador:** Authentication → Users → Add user (e-mail e senha),
   depois no SQL Editor:
   ```sql
   insert into public.crm_usuarios (user_id, nome, email, papel, recebe_leads)
   select id, 'Seu nome', email, 'admin', false from auth.users where email = 'SEU-EMAIL';
   ```
   Os outros usuários o administrador cria pela tela (Configurações → Equipe).
4. **Função de usuários:** `supabase functions deploy crm-usuarios` (pasta
   [`supabase/functions/crm-usuarios`](supabase/functions/crm-usuarios/index.ts)).
   Ela guarda a chave de serviço no servidor; o navegador nunca a vê.
5. **`config.js`:** nome da empresa, logo, *Project URL* e chave *anon public*
   (Settings → API). A chave anon é pública por natureza — quem protege é a RLS.
6. **Publicar:** GitHub Pages do repositório (Settings → Pages → branch `main`, raiz).
7. **Notas automáticas (opcional):** `supabase functions deploy crm-notas --no-verify-jwt`
   e o vigia no servidor da pasta de XML (seção abaixo).

## Vigia de notas (importação automática dos XML)

Um programa pequeno ([`ferramentas/vigia-notas.js`](ferramentas/vigia-notas.js), Node 18+,
sem pacote nenhum) roda no computador onde fica a pasta de XML do emissor (UniNFe/FKM),
olha a pasta a cada minuto e manda as notas novas para a Edge Function `crm-notas`. Lá elas
passam pelas **mesmas regras da importação manual** (`nfe.js`): só as notas da equipe, o
cadastro do cliente é completado, nada duplica (a chave de 44 dígitos é única). O vigia não
tem senha nem acesso ao banco: só uma **chave de integração**, que serve apenas para
entregar notas e pode ser desligada a qualquer momento no CRM.

1. **Chave:** no CRM, como administrador, Configurações → Integrações → **Gerar chave para
   o vigia**. A chave aparece **uma vez só** (o banco guarda só o SHA-256 dela), junto com o
   comando pronto do passo 3. Em "Quais notas entram", o padrão é *Automático*: nota com
   vendedor escrito entra se o vendedor é da equipe; nota sem vendedor entra se o cliente é
   da carteira da equipe. "Venda direta" e vendedor externo ficam de fora.
2. **No servidor:** instalar o Node.js LTS (nodejs.org) e copiar `vigia-notas.js` para uma
   pasta própria, por exemplo `C:\CRM\`. **Windows Server 2012 R2 / Windows 8.1** (é o caso
   da OneClean): o Node novo não instala; usar o 18, e no PowerShell ligar o TLS 1.2 antes
   de baixar (não tem `curl.exe`). Abrir o PowerShell de novo depois de instalar o Node:
   ```
   [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
   Invoke-WebRequest https://nodejs.org/dist/v18.20.8/node-v18.20.8-x64.msi -OutFile C:\node18.msi
   Start-Process msiexec -ArgumentList '/i C:\node18.msi' -Wait
   mkdir C:\CRM
   Invoke-WebRequest https://raw.githubusercontent.com/sistemidalessi/crm-oneclean/main/ferramentas/vigia-notas.js -OutFile C:\CRM\vigia-notas.js
   ```
   Colar uma linha por vez (coladas juntas, o PowerShell gruda uma na outra).
3. **Configurar** (no Prompt de Comando, dentro de `C:\CRM`):
   ```
   node vigia-notas.js --configurar --url https://SEU-PROJETO.supabase.co --chave CHAVE --pasta "C:\...\uninfe30\CNPJ\Enviados\Autorizados" --desde 202601
   ```
   `--pasta` é a pasta **Autorizados** (a que tem as subpastas por mês, `202609`,
   `202610`…); vale o caminho local ou o de rede (`\\servidor\...`), desde que a conta que
   roda o vigia enxergue a pasta. `--desde AAAAMM` = primeiro mês a enviar (padrão: janeiro
   do ano atual); meses já importados à mão não duplicam, só aparecem como "já importada".
   Do par que o UniNFe grava (`…-nfe.xml` e `…-procNFe.xml`) vai só o com protocolo;
   pedidos e inutilizações são ignorados.
4. **Testar uma vez:** `node vigia-notas.js --uma-vez` — o resultado aparece na tela, em
   `vigia-notas.log` e no CRM em Configurações → Integrações → "Últimas entregas".
5. **Deixar rodando sempre** (Agendador de Tarefas do Windows, inicia junto com o servidor;
   no **PowerShell como administrador**). O `ExecutionTimeLimit` zero é obrigatório: o
   padrão do Windows mata a tarefa depois de 3 dias.
   ```
   $acao = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\node.exe" -Argument "C:\CRM\vigia-notas.js" -WorkingDirectory "C:\CRM"
   $inicio = New-ScheduledTaskTrigger -AtStartup
   $ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
   Register-ScheduledTask -TaskName "CRM - vigia de notas" -Action $acao -Trigger $inicio -Settings $ajustes -User "SYSTEM" -RunLevel Highest
   Start-ScheduledTask -TaskName "CRM - vigia de notas"
   ```
   Conferir: `Get-Content C:\CRM\vigia-notas.log -Tail 5` (deve ter "vigia ligado"). Se a
   pasta for de rede, a conta SYSTEM pode não enxergá-la: usar o caminho local no servidor
   ou trocar `-User "SYSTEM"` por um usuário com acesso (`-User USUARIO -Password SENHA`).

O que já foi enviado fica em `vigia-notas-estado.json` (apagar esse arquivo = reenviar
tudo, sem duplicar); `vigia-notas.json` guarda a chave — **não copiar para outro lugar**.
Se o CRM ou a internet cair, o vigia tenta de novo na volta seguinte. Chave vazou ou o
servidor foi trocado: gerar outra no CRM, `node vigia-notas.js --configurar --chave NOVA`
(o vigia rodando passa a usar sozinho) e excluir a antiga. Testar a chave sem esperar nota
(PowerShell; resposta `ok : True`):
```
$c = (Get-Content C:\CRM\vigia-notas.json -Raw | ConvertFrom-Json).chave
Invoke-RestMethod -Method Post -Uri https://SEU-PROJETO.supabase.co/functions/v1/crm-notas -Headers @{'x-crm-chave'=$c} -ContentType 'application/json' -Body '{"arquivos":[]}'
```

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html`, `crm.css` | Página (CSP sem nada inline) e visual. |
| `config.js` | Instalação: nome, logo, Supabase. Vazio = modo local (demonstração no navegador). |
| `regras.js` | Regras puras: datas, alertas, painel/relatórios, duplicados, busca, CSV. |
| `planilha.js` | Importação: mapeamento de colunas, planejador sem duplicar, conversão do Agendor. |
| `nfe.js` | Notas fiscais: leitor do XML da NF-e (e do cancelamento) e planejador da importação. |
| `xlsx-leitor.js` | Leitor de .xlsx próprio (sem biblioteca externa). |
| `dados.js` | Banco: modo local (localStorage) e Supabase (paginado de 1000 em 1000). |
| `ui.js`, `app.js` | Interface base; núcleo (estado, permissões, automações, busca, atalhos, login). |
| `telas.js`, `fichas.js`, `ajustes.js` | Telas; fichas e formulários; configurações e importação. |
| `supabase/schema.sql` | Tabelas, índices, triggers (histórico), RLS, rodízio. |
| `supabase/functions/crm-usuarios/` | Edge Function do administrador (criar usuário, senha). |
| `supabase/functions/crm-notas/` | Edge Function que recebe os XML do vigia (chave de integração, regras do `nfe.js` num commit fixo). |
| `supabase/teste-rls/` | Ensaio das permissões num Postgres local (`sh supabase/teste-rls/roda.sh`). |
| `ferramentas/agendor-exportar.js` | Extrator da API v3 do Agendor. |
| `ferramentas/vigia-notas.js` | Vigia da pasta de XML das notas (roda no servidor do emissor). |
| `ferramentas/fixa-motor-notas.js` | Fixa na `crm-notas` o commit e os hashes de `regras.js`/`nfe.js`. |
| `testes/` | Testes das regras e do importador (`node --test testes/*.test.js`). |
