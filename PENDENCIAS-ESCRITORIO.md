# O que fazer no escritório — CRM OneClean

Atualizado em 27/10/2026. Quando um item for resolvido, apague a linha (ou peça ao Claude).
A mesma lista resumida está no `PENDENCIAS-ESCRITORIO.md` do `agilite-sistema-gestao` (a sessão do escritório abre lá).

## Só dá pra fazer estando no escritório (SSH da VPS)

- [x] **Serviço fiscal na VPS `2026-10-23e`**: atualizado pelo Anderson em 26/10 e conferido em Fiscal → Emissão.
- [x] **Serviço fiscal na VPS `2026-10-27a`** (aviso contra boleto falso no texto da nota): atualizado pelo Anderson em 27/10 e conferido.
- [ ] **Santa Casa (entrega futura):** ainda há saldo a entregar do faturamento (5922) feito no FKN? As remessas (5117) iam
      duas por mês até 03/08; em setembro e outubro não houve. Se houver, a remessa pelo CRM pede a chave da nota de faturamento
      (Pedido → Outra operação → Entrega futura — remessa).

## Perguntas que só você responde

- [ ] **Boleto (26/10):** o gerente indicou o BB Pay; perguntas (protesto, juros/multa, custos, API) mandadas a ele. O
      **CNAB 240 está pronto e desligado** (Validador do BB: 0 erros). O `revoke` foi rodado pelo Anderson
      em 27/10 e conferido. Falta: (2) o gerente confirmar a cobrança por
      arquivo em produção no convênio, a faixa do nosso número a partir de 2000000001 e o 1º arquivo de teste; (3) só então
      Configurações → Integrações → "Ligar pelo arquivo de remessa". Detalhes no plano da Fase 5 (`sistemi-dalessi`,
      `docs/plano-sair-do-fkn.md`).

- [ ] **Estoque antes da virada (24/10):** parte das 36 diferenças era erro do CRM (fuso), já corrigido; Belaplast 9758 e
      Leal 23026 reabertas. Falta: (1) **você** dar a ciência das 4 notas sem XML completo (Vigut ×2 e AJA de 23/10, Lotus de
      19/10: Estoque → Notas de compra → Notas da Sefaz → "dar ciência"); (2) o **comprador** dar entrada nas notas pendentes
      que já chegaram e conferir no FKN quando entrou a **Leal 23020 (15/10)** — se foi depois de 16/10 12h, os sacos Leal
      dela faltam no CRM. Depois disso, rodar de novo "Conferir a virada" e ver quantas das 36 sobram (as que sobrarem são as
      do Wellington, abaixo).

- [ ] **ANTES DA VIRADA — compras que não chegam pela Sefaz** (achado em 23/10, noite): na conferência CRM × FKN, **36
      produtos** tiveram entrada no FKN entre 19 e 23/10 sem nota de compra no CRM (ex.: papel interfolha Packpel 290027, 3.000;
      guardanapo Santepel 250002, 230; papel Thorium 290020, 120). Fornecedores como **Sales** (o maior), Barbarella, André
      Carillo e Papa & Parra **nunca** apareceram nas 307 notas que a Sefaz entregou ao CRM (só o CNPJ 63.237.702/0001-03).
      Perguntas ao Wellington: essas compras vêm com NF-e para qual CNPJ (a outra razão social, "BRASIL")? Ou entram sem nota
      (transferência, acerto, nota em papel)? Se for outro CNPJ, o CRM precisa ler o DF-e dele também (certificado A1 daquele
      CNPJ) ou a entrada será à mão. **Sem isso, depois de 03/11 o estoque e o contas a pagar dessas compras ficam faltando.**
      O botão "Conferir a virada" agora mostra essas diferenças como ⛔.
      **Como conferir (combinado em 23/10):** em 3 casos — papel Packpel 290027 (entrada no FKN em 23/10), guardanapo Santepel
      250002 (21/10) e papel Thorium 290020 (19/10) — o Wellington olha no FKN de qual nota foi a entrada: número, fornecedor e
      **CNPJ do destinatário**. Com a chave de 44 dígitos, o Claude confere se a nota existe na Sefaz para o CNPJ da OneClean.
      XML que o fornecedor mandou por e-mail já pode entrar hoje: Estoque → Notas de compra → subir o XML.

- [ ] **Conferência da virada de 23/10, noite** (Fiscal → 4. Emissão → "Conferir a virada"; dá para fazer de casa):
      (1) confirmar com o Wellington que o "1070048" da NF 1075533 (Severini, DT.LIQ.YPE 500ML NEUTRO, 3 CX24) é o **010078**
      (entrada refeita lá); (2) Priscila Drumond e Silmara fazerem o 1º acesso antes de 03/11; (3) completar o **número do
      endereço** de DCAS, Colégio Cristo Rei e Cei Divina Providência; (4) a vendedora confirmar o endereço de DCAS, Método SMA,
      SESI 316, SENAI Diadema e ALR (município acertado pelo CEP; as notas do FKN deles saíram com outra cidade); (5) 19
      produtos INATIVOS com estoque (álcool gel Adata 128 un., desinfetantes Gregorutt…): reativar e dar a regra, ou baixar;
      (6) nota de compra AJA Química NF 18231 (16/10) sem entrada.

- [ ] **Aviso automático de atraso** (Caixa → Cobrança): modelo `cobranca_atraso` **em análise na Meta desde 23/10** (enquanto
      isso, só e-mail); "Ver quem recebe hoje" (em 23/10 seriam 6:
      Legas Metal 267 dias, Jeniffer Trust 245, Lipos 128, Qualyprint 105, AP+Elettro e Meraki 77 — Lipos e AP+Elettro sem
      celular nem e-mail no cadastro); "Não avisar este cliente" em quem já negocia; depois "Enviar agora" ou "Ligar o envio automático".
- [ ] **Contagem física (logística):** água sanitária 5 L 010003 (CRM 105 × FKN 5, sem saída no CRM), aromatizante Coala
      010448 (CRM 6 × FKN −30) e Bom Ar 110014 (a nota trouxe 1 CX12 + 2 CJ3: o CRM contou 18, o FKN parece ter contado 12).

- [ ] **Contador:** (1) concorda que o CRM dê ciência em todas as notas recebidas? (2) para a OneClean, alguma nota de compra
      exige resposta definitiva (confirmação ou desconhecimento)? Em que prazo (o CRM usa 90 dias da emissão)? Se todas
      precisarem, ligar `dfe_lembrete_todas` (o Claude liga).
- [ ] **Contador — Reforma em 2027** (antes de 01/01/2027): (1) o IBS e a CBS entram na base do ICMS? A Sefaz-SP diz que
      sim (Resposta à Consulta 32931/2026); há decisão de primeira instância contra. Entram os dois ou só a CBS?
      (2) Qual a alíquota da CBS de 2027? (3) O cliente paga o total com o IBS e a CBS? (4) Como ficam o PIS/COFINS e o
      cClassTrib na nota de 2027? Com as respostas, preencher em Fiscal → 4. Emissão → "Configurar a regra de 2027".
- [ ] **Ciência automática:** o CRM pode dar a ciência sozinho em toda nota nova que a Sefaz mostrar? (Hoje está desligada;
      é só o "fiquei sabendo" à Sefaz, não confirma nem recusa a compra.)
- [ ] **Especialista no alto das telas** (18/10): conferir se ficou do jeito que você queria.
- [ ] **Primeira pergunta real à IA** (clicar no Clean e perguntar): conferir se responde certo.
- [ ] **Certificado A1:** o da VPS (que emite pelo CRM) vale até **23/12/2026** — renovar e instalar na VPS na 1ª quinzena de
      dezembro. **Conferido em 27/10:** o FKN já assina com um certificado da OneClean válido até 23/12/2026 (NF 2780 de 26/10),
      o mesmo prazo do da VPS; o que vencia em 29/10 não está mais em uso. Nada a fazer até dezembro.
- [ ] **Tabela do IBPT** (tributos aproximados na nota) está vencida desde 30/09: subir a nova pela aba Fiscal.
