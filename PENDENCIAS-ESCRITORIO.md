# O que fazer no escritório — CRM OneClean

Atualizado em 27/10/2026. Quando um item for resolvido, apague a linha (ou peça ao Claude).
A mesma lista resumida está no `PENDENCIAS-ESCRITORIO.md` do `agilite-sistema-gestao` (a sessão do escritório abre lá).

## SSH da VPS (escritório ou servidor SISTEMI-SRV, que tem chave própria desde 03/11)

- [x] **Serviço fiscal na VPS `2026-10-23e`**: atualizado pelo Anderson em 26/10 e conferido em Fiscal → Emissão.
- [x] **Serviço fiscal na VPS `2026-10-27a`** (aviso contra boleto falso no texto da nota): atualizado pelo Anderson em 27/10 e conferido.
- [x] **Serviço fiscal na VPS `2026-11-03b`** (nota a prazo em Pix/transferência com tPag 17/18 e o nome do local de entrega no
      "LOCAL DE ENTREGA"; inclui a `2026-10-30a`): atualizado pelo Anderson em 03/11 (`active`) e conferido em Fiscal → Emissão.
- [ ] **Santa Casa (entrega futura):** **ainda há entregas a fazer** (Anderson, 27/10). O faturamento (5922) é de antes de 2026
      e não está no CRM; as remessas de 2026 foram álcool 800 ml, pano multiuso Lifeclean e Bettanin (a última em 03/08). Falta a
      **logística** passar a chave (ou o número) da nota de faturamento e o saldo de cada produto; a remessa pelo CRM é em
      Pedido → Outra operação → Entrega futura — remessa, informando essa chave.

## Perguntas que só você responde

- [ ] **Boleto (26/10):** o gerente indicou o BB Pay; perguntas (protesto, juros/multa, custos, API) mandadas a ele. O
      **CNAB 240 está pronto e desligado** (Validador do BB: 0 erros). O `revoke` foi rodado pelo Anderson
      em 27/10 e conferido. Falta: (2) o gerente confirmar a cobrança por
      arquivo em produção no convênio, a faixa do nosso número a partir de 2000000001 e o 1º arquivo de teste; (3) só então
      Configurações → Integrações → "Ligar pelo arquivo de remessa". Detalhes no plano da Fase 5 (`sistemi-dalessi`,
      `docs/plano-sair-do-fkn.md`).
      **28/10, noite:** perguntas mandadas ao gerente (arquivo liberado em produção e teste, faixa do nosso número a partir de
      2000000001, retorno diário no Gerenciador, dias para baixa, protesto pela instrução 09, BB Pay por arquivo). Esperando a resposta.

- [ ] **Pagar no BB pela API (Pagamentos em Lote; resposta do gerente em 11/11/2026).** O CRM já está pronto em homologação
      (Caixa → Pagar no BB, `crm-bb-pagar`; histórico de 04/11). O gerente respondeu:
      - **Convênio PAG:** a agência cadastra, mas só fica ativo depois de o Anderson **assinar o termo de adesão**.
      - **A aplicação "OneClean Pagamentos" (em teste) não vai para produção:** com o convênio ativo é preciso **criar uma
        aplicação NOVA** no Portal Developers BB e mandar essa para produção → chaves novas nos Secrets (`BB_PAG_CLIENT_ID`,
        `BB_PAG_CLIENT_SECRET`, `BB_PAG_APP_KEY`, digitadas pelo Anderson) e o **mesmo certificado A1** da OneClean no cartão
        "Certificados" dela (`BB_PAG_CERT_PEM`/`BB_PAG_KEY_PEM`; a parte do certificado na função ainda não foi testada).
      - **Liberação:** BB Digital ou app BB PJ no celular, **exceto Pix, que só se autoriza pela própria API** (o "Liberar" do CRM).
      - **Limites** por pagamento e por mês: personalizáveis (decidir com a agência; começar baixo).
      - **Tipos:** boleto, guia, Pix e TED, de segunda a sábado; TED só de segunda a sexta, das 7h às 16h.
      - **Tarifa por lançamento:** boleto R$ 0,00; guia R$ 3,00; **Pix R$ 7,90**; TED R$ 8,20; transferência para conta corrente
        BB R$ 3,40; para poupança BB R$ 5,30; salário R$ 3,40. Ou seja: boleto pelo CRM sai de graça; Pix pelo convênio é caro.
      - **DDA** (boletos emitidos contra o CNPJ): não está na API de lote; há uma **API própria, em piloto**, liberada para quem
        pedir.
      - **Cobrança (convênio 3804880):** abatimento, alteração e baixa de boleto registrado são aceitos (o CRM já faz desde 04/11);
        a API também avisa por **webhook** a baixa operacional (hoje o CRM pergunta de 10 em 10 min).
      Falta, na ordem: (1) Anderson assinar o termo de adesão quando a agência avisar e anotar o número do convênio; (2) dizer à
      agência os limites; (3) pedir a entrada no piloto do DDA; (4) criar a aplicação nova com Pagamentos em Lote e o certificado,
      pedir produção, pôr as chaves nos Secrets; (5) o Claude troca `pagamentos.ambiente` para produção e o 1º teste é um boleto
      pequeno de fornecedor (custo zero), liberado pelo app do BB.

- [ ] **Estoque antes da virada (24/10):** parte das 36 diferenças era erro do CRM (fuso), já corrigido; Belaplast 9758 e
      Leal 23026 reabertas. Falta: (1) o **comprador** dar a ciência das notas sem XML completo (desde 27/10 as notas de compra são dele do começo ao fim) (Vigut ×2 e AJA de 23/10, Lotus de
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
- [ ] **Crédito presumido de CBS sobre o estoque de 01/01/2027 (07/11/2026; LC 214/2025, art. 381; Decreto 12.955/2026, arts.
      605 a 611).** O CRM já monta o inventário em Fiscal → "5. Estoque de abertura para o crédito de CBS" (detalhes em
      `docs/legislacao/registro.md`, entrada de 07/11). O que depende de você e do contador (Fiscontasp):
      (1) ~~`revoke` das duas funções no SQL Editor~~ — rodado pelo Anderson em 07/11 e conferido no banco.
      (2) ~~"Ler o PIS/COFINS das notas guardadas"~~ — feito pelo Anderson em 07/11: 1.476 de 1.483 itens de compra com o CST lido
      (2 notas sem XML). Falta só "Levantar o estoque" e "Exportar para o contador" (dois CSV: por item e por NCM).
      **O que a leitura mostrou (07/11, posição de hoje):** crédito presumido sugerido em **16 produtos, R$ 4,4 mil** (≈ R$ 407 de
      crédito); 746 já deram crédito (R$ 272 mil); 37 com alíquota zero/isento (R$ 19 mil: papel higiênico, café, açúcar); 13 a
      conferir (R$ 9,4 mil). Achados para o contador: **Bom Ar (3307) comprado com CST 04 e vendido com CST 01** → PIS/COFINS pago a
      maior na revenda; aromatizantes Coala e álcool perfumado Vigut (3307) **comprados com CST 01** → ou o fornecedor erra ou não são
      monofásicos; **álcool 2207 e lubrificantes 2710 comprados com CST 04** (monofásico de combustíveis, Lei 9.718 art. 5º, que
      não está na lista do art. 381, II) → entram ou não?; sacos de lixo Leal com CST 07 (isento?) e fornecedores com CST 50/73/99
      (código de entrada numa nota de saída) → o CRM manda esses para "a conferir".
      (2b) **Feito em 07/11 (decisão do Anderson):** a revenda dos monofásicos da Lei 10.147 (aromatizantes 3307, sabonete líquido
      3401.20.10, sabonete 3401.11.90) passou a **CST 04** no CRM (65 produtos; backup `crm_backup.fiscal_monofasico_20261107`).
      Mandar ao contador como decisão: (a) **retificar 2026** para recuperar os **R$ 1.389** de PIS/COFINS pagos a maior nessas
      revendas (notas de janeiro a novembro no CRM), se ele achar que compensa; (b) o **álcool 70 e o álcool perfumado estão com NCM
      3307.41.00** nas notas (preparação odorífera que atua por combustão) — parece classificação errada; se o NCM certo for outro
      (2207 ou 3808.94), eles saem do monofásico e a regra deles volta a CST 01.
      (3) **Contador — validar a classificação item a item** (CSV por item: coluna "Classificação" com "pelo quê" e "motivo"). Em 07/11,
      com a data de hoje: 812 produtos com saldo (R$ 305 mil a custo médio); só 275 têm nota de compra no CRM (o estoque começou em 16/10
      pelo saldo do FKN), e **18 produtos, R$ 4,9 mil, têm NCM monofásico** (Lei 10.147: aromatizantes 3307, sabonete 3401.11.90…) — o grupo
      "Crédito presumido" de hoje. Perguntas a ele: (a) a OneClean vende os 3307 (aromatizantes/odorizadores) e 3401.11.90 com **CST 01**
      (PIS/COFINS cobrado): se são monofásicos, a revenda era CST 04 (alíquota zero) — conferir e, se for o caso, recuperar o pago a maior
      (5 anos); (b) o álcool (2207/2208) e outros itens de regime especial entram em alguma hipótese do art. 381? (c) a base é o custo de
      aquisição pelo IRPJ: o custo médio do CRM é o valor pago (com ICMS, IPI, ST e frete, sem tirar crédito) — serve, ou ele quer sem o
      ICMS recuperável? (d) como ele vai escriturar (Livro de Inventário/ECD e EFD-Contribuições) e **apropriar em 2027** (até 30/06/2027,
      12 parcelas só contra a CBS) — e se a RFB já publicou a IN com a forma de apropriação.
      (4) **Até 31/12/2026 (logística e comprador):** zerar os **83 produtos com saldo negativo** (vendido sem entrada) e dar entrada em toda
      compra que chegou — o inventário de 31/12 é feito **uma vez só** (Decreto, art. 608) e o que não estiver no CRM fica fora do crédito.
      (5) **Em 02/01/2027:** Levantar o estoque com a data **31/12/2026**, exportar os dois CSV e mandar ao contador com os XML das compras.
- [ ] **Contador — Reforma em 2027** (antes de 01/01/2027): (1) o IBS e a CBS entram na base do ICMS? A Sefaz-SP diz que
      sim (Resposta à Consulta 32931/2026); há decisão de primeira instância contra. Entram os dois ou só a CBS?
      (2) Qual a alíquota da CBS de 2027? (3) O cliente paga o total com o IBS e a CBS? (4) Como ficam o PIS/COFINS e o
      cClassTrib na nota de 2027? Com as respostas, preencher em Fiscal → 4. Emissão → "Configurar a regra de 2027".
- [ ] **Ciência automática:** o CRM pode dar a ciência sozinho em toda nota nova que a Sefaz mostrar? (Hoje está desligada;
      é só o "fiquei sabendo" à Sefaz, não confirma nem recusa a compra.)
- [ ] **Especialista no alto das telas** (18/10): conferir se ficou do jeito que você queria.
- [ ] **Primeira pergunta real à IA** (clicar no Clean e perguntar): conferir se responde certo.
