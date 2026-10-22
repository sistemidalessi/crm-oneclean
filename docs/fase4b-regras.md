# Fase 4b — regras das notas que não são venda (pesquisa de 22/10/2026)

**O que o CRM faz hoje, por operação** (código em `servico-fiscal/outras.js` e `servico-fiscal/pedido.js`, testes em
`testes/nfe-outras.test.js` e `testes/nfe-4b.test.js`). Abaixo, a pesquisa completa com as fontes. Os pontos da seção 7
("incerto") ficam marcados para o contador; o que o CRM escolheu em cada um está aqui:

| Operação | O CRM emite | Escolha nos pontos incertos |
|---|---|---|
| Devolução a fornecedor sem ST | 5202/6202, finNFe 4, tpNF 1, a compra referenciada **por item** (`DFeReferenciado`: a Sefaz rejeita com 321 sem ele e com 1010 se também houver o NFref no cabeçalho; testado em homologação em 22/10), CST 00 com a base e a alíquota da compra (proporcional), IPI devolvido em `impostoDevol`, PIS/COFINS 49 | — |
| Devolução a fornecedor substituto (compra com ST destacado) | 5411/6411, ICMS próprio do fornecedor em **CST 90** com base e valor, ST proporcional em `vOutro` + `infAdFisco` | CST 90 (o 10 exigiria os campos de ST, que o substituído não pode usar) |
| Devolução a fornecedor substituído (compra CST 60) | 5411/6411, CST 60 repetindo o ST retido da compra | — |
| Bonificação | 5910/6910, ICMS como na venda (00 a 18% ou 60), PIS/COFINS 49, sem cobrança | nota própria (5910), não desconto de 100% na venda |
| Entrega futura — faturamento | 5922/6922, ICMS **CST 90 sem base** com **cBenef SP099999** (rejeição 930 sem ele; Portaria SRE 70/2025) e a fundamentação no texto, PIS/COFINS como na venda (01), com as parcelas; não mexe no estoque | 90 em vez de 41; finNFe 6 só a partir de 2027 |
| Entrega futura — remessa | 5117/6117, "Remessa - Entrega Futura", NFref da 5922, ICMS como na venda, PIS/COFINS 49, sem cobrança; baixa o estoque | — |
| Devolução de cliente **não contribuinte** | entrada (tpNF 0), 1202/1411, finNFe 4, NFref da venda, CST 00 com a base da venda (crédito), PIS/COFINS 50 com a alíquota da venda (98 no de alíquota zero) | aviso quando passou de 45 dias |
| Devolução de cliente **contribuinte** | **não emite**: a nota é do cliente (o CRM recusa e explica) | dar entrada pela nota dele (a fazer) |

---

# Pesquisa fiscal — Fase 4b (devolução a fornecedor, bonificação, entrega futura, devolução de cliente) e MDF-e

Distribuidora de produtos de limpeza e descartáveis, São Bernardo do Campo (SP), NF-e modelo 55, leiaute 4.00.
Pesquisa feita em 22/10/2026.

---

## 0. Antes de ler: como foi feita e até onde vai

- **Limite técnico desta sessão:** a ferramenta que abre páginas não conseguiu acessar nenhum site (nem os
  oficiais: legislacao.fazenda.sp.gov.br, confaz, planalto, normas.receita, nfe.fazenda). Só a busca funcionou.
  Por isso o conteúdo abaixo vem dos **trechos das páginas oficiais devolvidos pela busca** (respostas à consulta
  da Sefaz-SP, portarias, pareceres da Receita) e, onde não houve trecho oficial, de **fontes secundárias,
  marcadas como tal**. As citações são o sentido do texto, **não transcrição literal**. Antes de fixar a regra
  no código, alguém com acesso deve abrir os links oficiais da seção 9 e conferir o artigo.
- **Regime da empresa:** regime normal (CRT 3), **Lucro Real**, PIS/COFINS **não cumulativos** (1,65% + 7,6%
  nos XML de venda, conforme a leitura dos 2.609 XML registrada no `CLAUDE.md` do `crm-oneclean`). Não é
  contribuinte do IPI (comércio atacadista; só passaria a ser se importasse direto — RIPI, art. 9º, I).
- **Respostas à Consulta (RC) da Sefaz-SP** valem diretamente só para o consulente, mas a própria Sefaz diz que
  orientam casos iguais. Onde a regra sai só de RC, está dito.

### Três mudanças de fundo que atravessam as quatro operações

1. **A ST quase acabou para o que a empresa vende em SP.** Pela ordem:
   - Portaria SRE 94/2025 (DOE 23/12/2025): perfumaria e higiene pessoal (Anexo XI da Portaria CAT 68/2019,
     onde estava o **papel higiênico**) fora da ST a partir de **01/04/2026**. (Confirmado em várias fontes
     secundárias; texto oficial não aberto.)
   - Portaria SRE 9/2026 (DOE 18/03/2026): papel e papelaria (Anexo XIX). **Data divergente** nas fontes
     (01/07/2026 ou 01/08/2026).
   - Portaria SRE 20/2026 (DOE 04–05/05/2026): **produtos de limpeza** (Anexos XII e XIII da CAT 68/2019 e
     Portarias SRE 55/25 e 57/25 — água sanitária e alvejantes) fora a partir de **01/08/2026**; estoque pela
     **Portaria CAT 28/2020**. (Página oficial encontrada: legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-20-de-2026.aspx.)
   - Portaria SRE 19/2026 (outros segmentos, 01/08/2026) e **Portaria SRE 34/2026** (174 itens — autopeças,
     tintas, materiais elétricos, ferramentas etc. —, efeitos em **01/10/2026**).
   - **Consequência:** nas notas novas quase tudo sai como tributação normal (CST 00, 18%). Mas **as
     devoluções de mercadoria comprada ou vendida antes dessas datas continuam carregando a ST** da nota
     original (RC 34300/2026 e RC 34023/2026, adiante). O sistema precisa decidir pela **nota de origem**, não
     pela regra de hoje do produto.
2. **Ajuste SINIEF 49/2025 (notas de crédito e de débito).** Efeitos desde **03/08/2026** (Ajuste SINIEF
   15/2026), mas **obrigatório só a partir de 01/01/2027** (Ajuste SINIEF 27/2026, cláusula quinta-A; a
   Sefaz-SP disse o mesmo na RC 34238/2026, segundo resumo). Atinge a entrega futura com pagamento antecipado
   (op. 3) e a recusa na entrega (op. 4). Alterado também pelos Ajustes SINIEF 8/2026 e 34/2026.
3. **PIS e COFINS acabam em 01/01/2027** (LC 214/2025, art. 542, revoga, entre outros, o art. 3º da Lei
   10.833/2003 com efeitos em 01/01/2027; entra a CBS). Tudo o que está abaixo sobre PIS/COFINS vale para
   operações **até 31/12/2026** — na prática, novembro e dezembro de 2026. Devolução em 2027 de venda feita em
   2026 cai em regra de transição: **contador**. Em 2026 o grupo IBS/CBS da NF-e continua informativo.

---

## 1. Devolução de compra a fornecedor (mercadoria comprada para revenda)

### Identificação da NF-e

| Campo | Valor |
|---|---|
| tpNF | **1** (saída) |
| finNFe | **4** (devolução) |
| CFOP | sem ST: **5202** (fornecedor em SP) / **6202** (fora de SP); com ST: **5411** / **6411** |
| NFref | **obrigatório**: `refNFe` = chave da nota de compra (rejeição 321 se faltar; rejeições 327/328 se CFOP e finalidade não baterem — MOC, regras de validação; fontes secundárias citam NT 2013.005 e NT 2025.002 v1.50) |
| Destinatário | o fornecedor (indFinal = 0) |

### Regra-mãe (RICMS/SP)

- **Art. 4º, IV, do RICMS/2000:** devolução é a operação que **anula todos os efeitos** da operação anterior.
- **Art. 57 e art. 127, § 15:** a nota de devolução repete os dados da nota do fornecedor, faz **referência
  expressa** a ela e destaca o ICMS com a **mesma base de cálculo e a mesma alíquota** da operação original —
  também na devolução interestadual (Convênio ICMS 54/2000). Devolução parcial: proporcional às quantidades
  (RC 25888/2022, RC 29285/2024, RC 26751/2022, RC 32326/2025).

### ICMS — mercadoria sem ST

- CST **00** (ou o CST que veio na compra, ex.: 20 com redução), base e alíquota da nota de compra
  (interestadual: 4%, 7% ou 12%, a da origem). O débito anula o crédito tomado na entrada.

### ICMS e ICMS-ST — mercadoria com ST (três casos)

**a) Fornecedor de SP que é o substituto** (nota de compra com ICMS próprio + ICMS-ST destacados, CST 10):
- CFOP **5411**. O **ICMS próprio do fornecedor** vai nos campos normais (vBC, pICMS, vICMS), com a mesma
  base e alíquota (DN CAT 4/2010, item 4; RC 29407/2024; RC 30001/2024).
- O **ICMS-ST não vai nos campos de ST** (o substituído não pode destacá-lo). Vai assim
  (RICMS/SP art. 127, § 5º, e art. 274, § 3º; RC 29407/2024; RC 24732/2021; RC 34023/2026 — esta última,
  de 13/08/2026, só lida em resumo, no mesmo sentido):
  - base e valor do ICMS-ST em **Informações Adicionais de Interesse do Fisco** (`infAdFisco`) /
    informações complementares;
  - o valor do ICMS-ST **somado em `vOutro`** (outras despesas acessórias), para o total da nota bater com o
    que o fornecedor recebeu e a NF-e não ser rejeitada.
- **CST no XML:** as RC não dizem o código. Como o ICMS10 exige os campos de ST preenchidos, o caminho
  comum é **CST 90** (vBC/vICMS da operação própria, sem ST). **Contador confirma.**
- O débito do ICMS próprio destacado pelo substituído (que não se creditou dele na entrada) é neutralizado por
  lançamento de crédito no RAICMS, "Outros créditos" — entendimento de RC antiga (2011), **a confirmar**.
- O fornecedor (substituto) é quem recupera o ST que recolheu; para ele, recolher de novo na revenda
  (RC 28181/2023).

**b) Fornecedor que também é substituído** (nota de compra com CST 60, sem ST destacado — ST embutido no preço):
- CFOP **5411**, CST **60**, **sem destaque**; repetir as informações de "ICMS retido anteriormente" da nota
  de compra (vBCSTRet/vICMSSTRet, se vieram) e citá-las em `infCpl`. Não há `vOutro`, porque o ST não veio
  separado. (Fonte secundária: VRi Consulting, citando RICMS/SP e DN CAT 4/2010.)

**c) Fornecedor de fora de SP que reteve ST para SP** (CFOP **6411**):
- Para SP vale o mesmo de (a) — ICMS próprio nos campos normais, ST em `vOutro` + `infAdFisco`.
- A recuperação do ST pelo fornecedor segue a **lei do estado dele** e o Convênio ICMS 142/2018 (há estados,
  como MG e MT, que querem o ST nos campos próprios ou uma NF-e específica de ressarcimento). **Combinar com o
  fornecedor e com o contador caso a caso.**

### Produto que saiu da ST (Portarias SRE 94/2025, 9/2026, 20/2026)

- **Comprado com ST antes da data e devolvido depois:** a nota de devolução **espelha a nota de compra,
  inclusive o ICMS-ST** (CFOP 5411, mesma estrutura do caso a, b ou c), mesmo com o produto já fora do regime
  (RC 34300/2026, publicada em 02/10/2026; lida só em resumo).
- **Atenção (contador):** se esse produto estava no estoque do dia anterior à exclusão e a empresa tomou o
  crédito do estoque pela **Portaria CAT 28/2020**, devolvê-lo recebendo de volta o ST do fornecedor pode gerar
  recuperação dobrada; o crédito do estoque daquele item precisaria ser estornado. Não achei regra escrita.
- **Comprado depois da data:** devolução normal, CFOP 5202, CST 00.

### IPI

- A empresa **não é contribuinte do IPI**. Quando a compra veio de indústria com IPI destacado:
  - grupo **`impostoDevol`** no item: `pDevol` (percentual devolvido) e `IPI/vIPIDevol` (valor do IPI
    devolvido, proporcional); total em `ICMSTot/vIPIDevol`, que **entra no `vNF`** (regra de validação do total,
    NT 2016.002 e NT 2020.002);
  - **não** preencher o grupo de tributação do IPI (vIPI) nem jogar o IPI em `vOutro` (orientação para não
    contribuinte desde a NT 2016.002 v1.60 — fonte secundária TOTVS; o fórum ACBr avisa que vIPI e vIPIDevol
    juntos dão rejeição).
- O fornecedor industrial se credita pelo RIPI (Decreto 7.212/2010), **art. 229** (crédito do IPI de produtos
  recebidos em devolução) e **art. 231** (a nota de devolução declara número, data e valor do documento
  original, o IPI das quantidades devolvidas e o motivo). Parecer Normativo Cosit 22/2013: vale o IPI destacado
  na nota de saída original.
- O IPI não integra a base do ICMS (CF, art. 155, § 2º, XI: operação entre contribuintes, para
  comercialização) — a devolução repete a compra.

### PIS/COFINS

- CST de saída **49** (outras operações de saída). Não é receita.
- O crédito tomado na compra (Lei 10.637/2002 e Lei 10.833/2003, art. 3º, I) tem de ser **estornado** na
  proporção do que voltou (na EFD-Contribuições, por ajuste na base do crédito da compra — Guia Prático,
  fonte secundária). O CRM pode informar o valor a estornar no grupo PISOutr/COFINSOutr (CST 49) para a
  contabilidade, ou só gerar o relatório. Produto comprado com alíquota zero (papel higiênico): nada a estornar.

### Estoque, financeiro, prazos

- **Estoque:** baixa (saída), ao custo médio do item (o custo da compra devolvida sai do custo médio).
- **Financeiro:** o valor da nota (produto + IPI devolvido + ST em vOutro) vira **abatimento no contas a pagar**
  daquela compra (se a duplicata está aberta) ou **crédito a receber do fornecedor** (se já foi paga).
- **Prazo:** não há prazo no RICMS para a devolução entre contribuintes. O prazo de 45 dias (seção 4) é só
  para devolução de não contribuinte.
- **Cliente não contribuinte:** não se aplica (quem devolve é a própria empresa).

---

## 2. Bonificação / brinde a cliente (CFOP 5910 / 6910)

### Identificação

| Campo | Valor |
|---|---|
| tpNF | **1** |
| finNFe | **1** (normal) |
| CFOP | **5910** (SP) / **6910** (fora de SP) — "Remessa em bonificação, doação ou brinde"; não há CFOP próprio para ST (RC 31044/2024, modificada em 03/04/2025) |
| NFref | não exigido. Boa prática: citar em `infCpl` a venda a que a bonificação se liga |

### ICMS

- **Incide.** Bonificação é abatimento em mercadoria, não desconto em dinheiro; **o valor das mercadorias
  bonificadas não sai da base de cálculo do ICMS nem da base do ICMS-ST**, esteja a bonificação em nota própria
  ou na mesma nota da venda (**Decisão Normativa CAT 4/2000**; RICMS/SP art. 37, § 1º, item 1; RC 22777/2020;
  RC 19757/2019).
- **Base:** o valor da operação; sem preço na nota, o preço corrente da mercadoria no mercado atacadista do
  local (RICMS/SP, art. 38 — citado por fonte secundária; conferir o inciso). Na prática: o preço de venda
  normal do item.
- **Produto sem ST:** CST **00**, 18%, destacado.
- **Produto com ST já retida na entrada (CST 60):** CST **60**, sem destaque e sem complemento — a empresa é
  substituída; quem calcula ST sobre bonificação é o substituto (RC 22777/2020 manda o substituto usar os
  valores da Portaria CAT 89/2019). Preencher os campos de ST retido anteriormente como nas vendas 5405.
- **Divergência a conhecer:** o STJ (REsp 1.111.156/SP, repetitivo, 2009) entende que bonificação
  incondicional **não** integra a base do ICMS; a Sefaz-SP mantém a DN CAT 4/2000. Seguir a Sefaz e deixar a
  discussão para o contador.
- **Brinde em sentido estrito** (RICMS/SP, arts. 455 a 458): é a mercadoria que **não** é objeto normal da
  atividade, comprada para distribuir de graça (caneta, camiseta). Tem regime próprio. O produto da própria
  linha dado ao cliente é **bonificação**, não brinde.

### IPI

- Não há (não contribuinte).

### PIS/COFINS

- **Bonificação em nota própria (5910) = doação:** não é receita da doadora; **não entra na base** —
  CST **49** (Solução de Consulta Cosit 46/2023, COFINS; Cosit 313/2023, PIS).
- **Bonificação na própria nota de venda** (item com desconto de 100%): é **desconto incondicional**, excluído
  da receita bruta **só** quando consta da própria nota de venda e não depende de evento posterior (mesmas SC).
  Nesse formato, o ICMS continua incidindo (DN CAT 4/2000) e o PIS/COFINS não.
- **Crédito da compra do produto dado:** não achei regra clara sobre manter ou estornar o crédito de PIS/COFINS
  tomado na compra de mercadoria depois doada (o art. 3º, § 13, das Leis 10.637/10.833 manda estornar em furto,
  roubo, inutilização, deterioração ou sinistro, não cita doação). **Contador.**

### Estoque, financeiro

- **Estoque:** baixa.
- **Financeiro:** **nenhum título**. O custo vira despesa comercial (bonificação concedida). Sem comissão.

### Cliente não contribuinte (condomínio, escola, consumidor)

- Mesmo CFOP 5910, `indFinal = 1`, `indIEDest = 9`, ICMS 18% (operação interna, sem DIFAL). Para 6910 a não
  contribuinte de outro estado haveria DIFAL (fora do escopo, como a venda para o RS).

---

## 3. Venda para entrega futura (5922 + 5117)

### A regra de SP

- **RICMS/SP, art. 129:** nas vendas à ordem ou para entrega futura, pode ser emitida nota de **simples
  faturamento**, **vedado o destaque do imposto**, observada a disciplina da Secretaria (hoje o **Anexo I da
  Portaria SRE 41/2023**, base na Lei 6.374/89, art. 67, § 1º).
- **Portaria SRE 41/2023, Anexo I, art. 1º:** a NF-e de simples faturamento sai **sem destaque do ICMS**, no
  momento do contrato (RC 32309/2025). Tem natureza comercial, não fiscal (RC 20980/2019) e **não movimenta
  estoque** (RC 17783/2018); no Registro de Saídas só preenche documento e observações ("Simples Faturamento")
  (RC 2141/2013).
- **Anexo I, art. 2º:** na saída global ou parcial, emite-se NF-e com o valor da operação, **o destaque do ICMS**,
  a natureza da operação **"Remessa - Entrega Futura"** e a **chave de acesso da NF-e de simples faturamento**.
- **Mercadoria com ST:** o imposto aparece na nota da saída física, com o CST próprio e CFOP 5117/6117
  (RC 23671/2021). Se houver IPI, entra na base e no total (mesma RC; não se aplica à empresa).
- Preço ou quantidade diferentes do faturamento: nota complementar (RC de 2025, citada em resumo).

### Nota 1 — simples faturamento (CFOP 5922 / 6922)

| Campo | Valor |
|---|---|
| tpNF | 1 |
| finNFe | **1** (normal). **Com pagamento antecipado:** `finNFe = 6` (nota de débito), `tpNFDebito = 06`, natOp "Venda para entrega futura - Pagamento antecipado", sem ICMS — facultativo desde 03/08/2026, **obrigatório a partir de 01/01/2027** (Ajuste SINIEF 49/2025, cláusula primeira; 15/2026; 27/2026). A Sefaz-SP entende que é **a própria 5922** que recebe essa finalidade, não uma terceira nota (RC 33279/2026, de 22/06/2026) |
| NFref | não |
| ICMS | **sem destaque**; CST **90** sem base (fontes secundárias; alguns usam 41 — contador confirma) |
| IPI | não |
| PIS/COFINS | **CST 01** sobre o valor do contrato: para a Receita, **a receita nasce na celebração do contrato**, quando o comprador vira dono (Solução de Consulta Cosit 131/2024; Cosit 507/2017). A NT 2025.002 v1.51 passou a aceitar PIS/COFINS na nota de débito tipo 06 |
| Estoque | **não mexe** (o CRM só **reserva** o que foi vendido) |
| Financeiro | **o título a receber nasce aqui** |

### Nota 2 — remessa (CFOP 5117 / 6117)

| Campo | Valor |
|---|---|
| tpNF | 1 |
| finNFe | 1 |
| NFref | **sim**: chave da 5922 (Anexo I, art. 2º). A partir de 2027, com pagamento antecipado, a chave da nota de débito (que é a mesma 5922) |
| natOp | "Remessa - Entrega Futura" |
| ICMS | **destacado aqui** (o fato gerador é a saída): CST **00**, 18%, base = valor da parcela entregue; produto com ST já retida: CST **60** |
| IPI | não |
| PIS/COFINS | **CST 49** (a receita já foi oferecida na 5922). O **ICMS destacado na 5117 sai da base do PIS/COFINS no mês do destaque** (Cosit 131/2024) — ajuste que a contabilidade faz na EFD-Contribuições |
| Estoque | **baixa aqui** (e solta a reserva) |
| Financeiro | **nada novo** (o título já existe) |

### Os 14 do FKN

- As 14 notas 5117 com **CST ICMS 00** e **CST PIS 49** estão coerentes com o art. 129 (ICMS na remessa) e com
  a Cosit 131/2024 (receita na 5922). **Conferir** se as 5922 correspondentes saíram com PIS/COFINS **CST 01**;
  se saíram com 49, a receita dessas vendas não foi tributada em lugar nenhum.

### Cliente não contribuinte (o caso real é de um hospital)

- Mesmos CFOPs (5922/5117), `indFinal = 1`, `indIEDest = 9` se não tiver IE. ICMS 18% na 5117. Nada muda na
  lógica.

### Ponto aberto

- Mercadoria vendida (5922) e ainda não entregue em 31/12 é do cliente, mas está com a empresa: como aparece no
  inventário (Bloco H, "propriedade de terceiros em posse do informante"?) — **contador**.

---

## 4. Devolução de venda feita pelo cliente

### Quem emite a nota

| Cliente | Quem emite | Base |
|---|---|---|
| **Contribuinte do ICMS** (tem IE e emite NF-e) | **o cliente**, com a NF-e de devolução dele (5202/5411 ou 6202/6411, finNFe 4, referenciando a nossa venda). A empresa **só dá entrada** com a nota dele | RICMS/SP art. 125, I (RC 26680/2022: na devolução por contribuinte, quem devolve emite) |
| **Não contribuinte** (pessoa física, condomínio, escola ou hospital sem IE, órgão público) | **a própria empresa**, com NF-e de **entrada** | RICMS/SP art. 136, I, "a" (entrada de mercadoria de quem não é obrigado a emitir documento fiscal), art. 452 e **Portaria SRE 41/2023, Anexo IV** (RC 29870/2024, RC 16434/2017) |

- **Contribuinte que não emite a nota dele:** não achei base para a empresa emitir a nota de entrada no lugar de
  um contribuinte. O caminho é cobrar a nota dele. Exceções:
  - recusa no ato da entrega (abaixo);
  - devolução entregue em outro estabelecimento (art. 454-A, também no Anexo IV).
  MEI e casos limite: **contador**.

### NF-e de entrada emitida pela empresa (não contribuinte)

| Campo | Valor |
|---|---|
| tpNF | **0** (entrada) |
| finNFe | **4** |
| CFOP | **1202** (sem ST) / **1411** (com ST); de fora de SP: **2202** / **2411**. O MOC também aceita 1949/2949 com finNFe 4 e indIEDest 9 (exceção da rejeição 327); não recomendado |
| NFref | **sempre** a chave da nossa NF-e de venda. A rejeição 321 dispensa os CFOP 1201, 1202, 1410, 1411, 5921 e 6921 (fonte secundária, NT 2013.005 v1.20), mas o Anexo IV exige os dados do documento original |
| Remetente (grupo dest) | quem devolveu, com **CPF ou CNPJ** (Anexo IV, art. 2º) |

### ICMS — crédito

- **Item vendido com ICMS (CST 00):** a nota de entrada destaca o ICMS com **a mesma base e alíquota da venda**
  (proporcional) e a empresa **se credita** (art. 4º, IV; art. 61, § 16, incluído pelo Decreto 64.772/2020, e
  art. 452 do RICMS/SP). **Condições para o crédito** (Anexo IV, § 1º do art. 2º, texto via LegisWeb):
  **prova cabal** de que a devolução ocorreu **no prazo da garantia** ou, nos demais casos, **em até 45 dias
  contados da saída** da mercadoria. Fora disso a nota é escriturada **sem crédito**.
- **Item vendido com ST (CST 60):** CFOP 1411, CST 60, **sem crédito** e sem ST a recuperar — a venda não teve
  débito.
- **Vendido com ST antes da exclusão e devolvido depois:** entra com CST 60, sem crédito, e volta ao estoque de um
  produto que agora sai tributado a 18%. Se haverá direito a crédito (como o estoque da CAT 28/2020) **não achei
  regra — contador**.
- **Cliente contribuinte:** a nota dele destaca o ICMS com a mesma base e alíquota (art. 57) e a empresa se
  credita na escrituração; com ST, a nota dele traz o ST em `infAdFisco`/`vOutro` e a empresa (substituída) não
  tem ST a recuperar.

### IPI

- Não há (a venda não teve IPI).

### PIS/COFINS

- **Crédito** sobre os bens recebidos em devolução cuja receita integrou o faturamento do mês ou de mês anterior
  e foi tributada, às **alíquotas da venda** (Lei 10.637/2002 e Lei 10.833/2003, **art. 3º, VIII**; revogado a
  partir de 01/01/2027 pela LC 214/2025).
- CST de entrada **50** (com direito a crédito), código da base de cálculo do crédito **12** ("devolução de
  vendas sujeitas à incidência não cumulativa") na EFD-Contribuições — fonte secundária (Guia Prático e fóruns
  do SPED).
- Item vendido com **alíquota zero (CST 06, papel higiênico)** ou monofásico: **sem crédito** — CST **98**
  (outras entradas) ou 73.
- A base do crédito deve excluir o ICMS destacado, para casar com a venda (que excluiu o ICMS da base do
  PIS/COFINS) — **contador confirma**.

### Estoque, financeiro, comissão

- **Estoque:** entrada (volta ao saldo, ao custo da saída). Avariado: mesma entrada fiscal, separado no CRM.
- **Financeiro:** abate o **título a receber** daquela venda (ou gera crédito ao cliente, se já pagou).
- **Comissão:** desconta (já previsto no plano).

### Recusa no ato da entrega (o motorista volta com a mercadoria)

- **Hoje:** é retorno de mercadoria não entregue. A empresa emite a **NF-e de entrada** (art. 136, I; art. 453 do
  RICMS/SP; RC 30604/2024 trata a recusa como devolução) e pode registrar o evento **Insucesso na Entrega**
  (NT 2023.005, tpEvento 110192). O crédito do ICMS segue o art. 63, I, "b" (RC 17778/2018).
- **A partir de 01/01/2027** (Ajuste SINIEF 49/2025, cláusula quinta, com a redação do **Ajuste SINIEF
  34/2026**; fontes secundárias):
  - recusa **total** ou destinatário não localizado: a empresa emite NF-e de entrada com **finNFe = 5** (nota de
    crédito), **tpNFCredito = 03**, referenciando a NF-e original;
  - recusa **parcial**, cliente **contribuinte**: o cliente emite NF-e de saída, **finNFe = 6**,
    **tpNFDebito = 09**;
  - recusa **parcial**, cliente **não contribuinte**: a empresa emite a NF-e de entrada como nota de crédito
    (tipo **06** segundo uma fonte; a Sefaz-SP só diz "código específico");
  - os eventos de manifestação do destinatário passam a valer só para recusa total ou não localização.

---

## 5. MDF-e na entrega com veículo próprio dentro de SP

**Conclusão: hoje não é obrigatório nas entregas intermunicipais dentro de SP** (São Bernardo → Grande SP), desde
que não seja combustível. Passa a ser obrigatório se houver entrega **para outro estado**.

- **Ajuste SINIEF 21/2010, cláusula terceira** (caput reescrito pelo Ajuste SINIEF 45/2023, em vigor desde
  13/12/2023): o emitente de NF-e emite MDF-e no transporte com veículo próprio ou arrendado, ou com transportador
  autônomo. O **Ajuste SINIEF 23/2019** estendeu a obrigação ao transporte **intermunicipal** a partir de
  06/04/2020, **mas com um parágrafo para SP**: "o termo inicial de obrigatoriedade … será o estabelecido em sua
  legislação estadual" (§ 3º citado por fonte secundária; numeração do inciso/parágrafo a conferir no texto do
  Confaz).
- **SP — Portaria CAT 102/2013, art. 2º, II:** o emitente de NF-e emite MDF-e no **transporte interestadual**
  feito em veículos próprios ou arrendados, ou com transportador autônomo (RC 10283/2016, RC 16040/2017,
  RC 27324/2023). O inciso I (CT-e) cobre o intermunicipal de carga fracionada, que não é o caso.
- **RC 30317/2024:** transporte **intermunicipal dentro de SP com veículo próprio**, sem combustível líquido ou
  gasoso, **não exige MDF-e**. A NetCPA confirma que SP não editou a obrigatoriedade intermunicipal de 2020.
- Para saber: Portaria SRE 28/2024 (emissão no fim do carregamento e antes do transporte) e Portaria SRE 22/2026
  (desde 01/06/2026, um MDF-e por UF de descarregamento) — só importam se houver MDF-e.

---

## 6. Tabela-resumo

| Operação | CFOP | finNFe | tpNF | NFref | ICMS | ST | IPI | PIS/COFINS | Estoque | Financeiro |
|---|---|---|---|---|---|---|---|---|---|---|
| **1a. Devolução de compra sem ST** | 5202 / 6202 | 4 | 1 | Obrigatória: a NF-e de compra | CST 00, mesma base e alíquota da compra (art. 4º IV, 57, 127 §15) | — | `impostoDevol` (pDevol + vIPIDevol, soma no vNF) se a compra teve IPI | CST 49 + estorno do crédito da compra | Sai | Abate o contas a pagar, ou crédito a receber do fornecedor |
| **1b. Devolução de compra com ST, fornecedor substituto** | 5411 / 6411 | 4 | 1 | Obrigatória | ICMS próprio do fornecedor nos campos normais (CST 90?, a confirmar) | Base e valor em `infAdFisco`; valor somado em `vOutro` (RC 29407/2024, 34023/2026) | Idem | CST 49 + estorno | Sai | Idem (valor inclui o ST) |
| **1c. Devolução de compra com ST, fornecedor substituído** | 5411 / 6411 | 4 | 1 | Obrigatória | CST 60, sem destaque | Repete o ST retido anteriormente (vBCSTRet/vICMSSTRet, `infCpl`) | Idem | CST 49 + estorno | Sai | Idem |
| **1d. Produto que saiu da ST, comprado com ST** | 5411 | 4 | 1 | Obrigatória | Espelha a compra (RC 34300/2026) | Espelha a compra | Idem | CST 49 + estorno | Sai | Idem; checar crédito da CAT 28/2020 |
| **2. Bonificação** | 5910 / 6910 | 1 | 1 | Não (citar a venda em `infCpl`) | Incide: CST 00 18% sobre o preço normal (DN CAT 4/2000) | CST 60, sem destaque, se ST retida | — | Nota própria: CST 49 (doação, Cosit 46/2023 e 313/2023). Na nota de venda (desconto de 100%): fora da base | Sai | Nenhum título |
| **3a. Entrega futura — faturamento** | 5922 / 6922 | 1; com pagamento antecipado, 6 + tpNFDebito 06 (obrigatório em 2027) | 1 | Não | Vedado o destaque (art. 129; SRE 41/2023 An. I): CST 90 sem base | Não | — | CST 01: receita no contrato (Cosit 131/2024) | Não mexe (só reserva) | **Nasce o título** |
| **3b. Entrega futura — remessa** | 5117 / 6117 | 1 | 1 | Sim: a 5922 | **Destaca**: CST 00 18% (ou 60 com ST) | CST 60 se ST retida (RC 23671/2021) | — | CST 49; o ICMS destacado sai da base no mês | **Baixa** | Nada novo |
| **4a. Devolução de venda, cliente contribuinte** | Nota do cliente: 5202/5411 (6202/6411) | 4 (dele) | 1 (dele) | Nossa venda | Crédito do ICMS que ele destacou | Sem ST a recuperar | — | Crédito: CST 50, base 12 (CST 98 se vendido a alíquota zero) | Entra | Abate o contas a receber |
| **4b. Devolução de venda, não contribuinte (a empresa emite a entrada)** | 1202 / 1411 (2202 / 2411) | 4 | **0** | Sempre a nossa venda (SRE 41/2023, An. IV) | CST 00 mesma base: crédito só com prova cabal e até 45 dias da saída (art. 452; An. IV) | CST 60, sem crédito | — | Crédito: CST 50, base 12 / CST 98 | Entra | Abate o contas a receber |
| **Recusa na entrega (2027)** | Entrada da empresa | 5, tpNFCredito 03 (total) | 0 | NF-e original | Estorna o débito | Idem | — | Idem 4b | Entra | Cancela o título |
| **MDF-e** | — | — | — | — | Não obrigatório dentro de SP com veículo próprio (CAT 102/2013 art. 2º II; RC 30317/2024); obrigatório no interestadual | | | | | |

---

## 7. O que ficou incerto e precisa do contador

1. **CST do ICMS na devolução ao fornecedor substituto (1b):** 90 com a operação própria e o ST em
   `vOutro` + `infAdFisco`? E como neutralizar o débito do ICMS próprio que a empresa (substituída) não creditou
   na entrada ("Outros créditos" no RAICMS, pela RC de 2011)?
2. **Devolução interestadual com ST (6411):** como cada fornecedor de fora quer receber o ST (`vOutro` como em SP,
   campos próprios como em MT, ou NF-e de ressarcimento pelo Convênio ICMS 142/2018).
3. **Produto que saiu da ST:** devolver ao fornecedor (espelhando o ST) um item que estava no estoque da véspera e
   teve crédito pela **CAT 28/2020** — estornar esse crédito? E na devolução de cliente de item vendido com ST
   antes da data, há crédito?
4. **CST 90 ou 41 na 5922** (simples faturamento sem destaque).
5. **Entrega futura e PIS/COFINS:** confirmar CST 01 na 5922 e 49 na 5117 (Cosit 131/2024), o ajuste da exclusão
   do ICMS no mês da 5117, e **conferir as 5922 antigas do FKN** (se saíram com 49, faltou tributar a receita).
   Como fica no inventário a mercadoria faturada e não entregue.
6. **Bonificação:** confirmar ICMS sobre o preço normal (DN CAT 4/2000, contra o REsp 1.111.156/SP do STJ); manter
   ou estornar o crédito de PIS/COFINS da mercadoria dada; preferir nota própria (5910) ou item com desconto de
   100% na nota de venda (sem PIS/COFINS, com ICMS).
7. **Devolução de cliente:** CST 50 + código 12 (e 98 para alíquota zero); a base do crédito sem o ICMS; como
   provar a devolução de não contribuinte ("prova cabal") e o que fazer depois dos 45 dias; MEI e cliente com IE
   que não emite nota.
8. **2027:** PIS/COFINS extintos (LC 214/2025) — regra de transição para devolução em 2027 de venda de 2026; datas
   e códigos do Ajuste SINIEF 49/2025 (`tpNFCredito`/`tpNFDebito`, sobretudo o da recusa parcial) e do grupo
   IBS/CBS nessas notas.
9. **Datas das portarias de exclusão da ST**, sobretudo a SRE 9/2026 (papel: 01/07 ou 01/08/2026), e a lista
   exata de NCM de cada uma.
10. **MDF-e:** confirmar que o inciso da cláusula terceira e o § de SP (Ajuste SINIEF 23/2019) continuam assim
    depois do Ajuste SINIEF 45/2023.

---

## 8. Pendência de verificação (texto oficial não aberto nesta sessão)

Conferir no texto oficial antes de travar o código: RICMS/SP arts. 4º IV, 37, 38, 57, 61 § 16, 63, 125, 127
(§§ 5º e 15), 129, 136, 274 § 3º, 452–454-A, 455–458; Portaria SRE 41/2023 Anexos I e IV (com a SRE 76/2025);
Portaria CAT 102/2013 art. 2º; Ajuste SINIEF 21/2010 cláusula terceira; Ajustes SINIEF 49/2025, 15/2026, 27/2026,
34/2026; RC 34023/2026, 34300/2026 e 33279/2026 na íntegra; MOC 7.0 e NT 2016.002 (impostoDevol), 2023.005 e
2025.002 (versão vigente).

---

## 9. Fontes

### Oficiais (encontradas na busca; lidas pelos trechos)

**Sefaz-SP (legislacao.fazenda.sp.gov.br)**
- RICMS/2000 integral: https://legislacao.fazenda.sp.gov.br/Paginas/textoricms.aspx
- RICMS arts. 125 a 131: https://legislacao.fazenda.sp.gov.br/Paginas/art125.aspx
- RICMS arts. 452 a 454-A: https://legislacao.fazenda.sp.gov.br/Paginas/art452.aspx
- Portaria SRE 41/2023: https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-41-de-2023.aspx
- Portaria SRE 76/2025: https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-76-de-2025.aspx
- Portaria SRE 20/2026: https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-20-de-2026.aspx
- Portaria CAT 102/2013 (MDF-e): https://legislacao.fazenda.sp.gov.br/Paginas/pcat1022013.aspx
- Decisão Normativa CAT 4/2000 (bonificação): https://legislacao.fazenda.sp.gov.br/Paginas/denorm042000.aspx
- Respostas à Consulta: https://legislacao.fazenda.sp.gov.br/Paginas/RC23671_2021.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC17783_2018.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC20980_2019.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC2141_2013.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC33279_2026.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC25888_2022.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC29407_2024.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC30001_2024.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC24732_2021.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC28181_2023.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC22777_2020.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC19757_2019.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC31044_2024.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC29870_2024.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC26680_2022.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC30604_2024.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC31239_2025.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC16946_2017.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC18800_2018.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC17778_2018.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC30317_2024.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC27324_2023.aspx ·
  https://legislacao.fazenda.sp.gov.br/Paginas/RC16040_2017.aspx
- Notícia da Sefaz-SP sobre a exclusão de 174 itens: https://www.sfp.sp.gov.br/sefaz/noticias/sticmsexclusaoprodutos_quintobloco

**Confaz / Portal da NF-e**
- Ajuste SINIEF 21/2010 (MDF-e): https://www.confaz.fazenda.gov.br/legislacao/ajustes/2010/AJ_021_10
- Ajustes SINIEF 49/2025, 15/2026, 27/2026, 34/2026: índice em https://www.confaz.fazenda.gov.br/legislacao/ajustes
  (endereços diretos não confirmados; reprodução: LegisWeb, abaixo)
- MOC e Notas Técnicas (NT 2016.002, 2020.002, 2023.005, 2025.002): https://www.nfe.fazenda.gov.br/portal/principal.aspx

**Receita Federal / Planalto**
- Solução de Consulta Cosit 131/2024 (entrega futura; documento validado em 16/05/2024):
  https://normas.receita.fazenda.gov.br/sijut2consulta/anexoOutros.action?idArquivoBinario=74105
- SC SRRF04 4038/2024 (vinculada à Cosit 131/2024):
  https://normas.receita.fazenda.gov.br/sijut2consulta/anexoOutros.action?idArquivoBinario=75940
- Busca de soluções de consulta (Cosit 46/2023, 313/2023, 507/2017, 13/2026):
  https://normas.receita.fazenda.gov.br/sijut2consulta/consulta.action
- Lei 10.637/2002: https://www.planalto.gov.br/ccivil_03/leis/2002/l10637.htm
- Lei 10.833/2003: https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833.htm
- RIPI, Decreto 7.212/2010 (arts. 229–232): https://www.planalto.gov.br/ccivil_03/_ato2007-2010/2010/decreto/d7212.htm
- LC 214/2025: https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm
- Constituição, art. 155, § 2º, XI: https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm

### Não oficiais (apoio; reproduções e comentários)

- Reproduções no LegisWeb: Ajuste SINIEF 49/2025 (https://www.legisweb.com.br/legislacao/?id=487469),
  15/2026 (https://www.legisweb.com.br/legislacao/?id=495006), 34/2026 (https://www.legisweb.com.br/legislacao/?id=500929),
  21/2010 (https://www.legisweb.com.br/legislacao/?id=240), Portaria SRE 41/2023 (https://www.legisweb.com.br/legislacao/?id=447115),
  Portaria SRE 34/2026 (https://www.legisweb.com.br/legislacao/?id=497430), SC Cosit 46/2023 (https://www.legisweb.com.br/legislacao/?id=443097),
  SC Cosit 313/2023 (https://www.legisweb.com.br/legislacao/?id=453671), DN CAT 4/2010 (https://www.legisweb.com.br/legislacao/?id=170104),
  RC 33279/2026 (https://www.legisweb.com.br/legislacao/?id=497339)
- Rota da Jurisprudência (resumos das RC 34023/2026, 34300/2026, 34238/2026):
  https://rotadajurisprudencia.com.br/2026/08/sefaz-sp-define-regras-para-emissao-de-nf-e-na-devolucao-de-mercadorias-sujeitas-ao-icms-st/ ·
  https://rotadajurisprudencia.com.br/2026/10/sefaz-sp-define-procedimentos-para-devolucao-de-mercadorias-apos-exclusao-do-regime-de-icms-st/ ·
  https://rotadajurisprudencia.com.br/2026/10/sefaz-sp-esclarece-aplicacao-das-novas-regras-de-notas-fiscais-de-credito-e-debito-durante-a-reforma-tributaria/
- Tribium (RC 33279/2026; Ajuste 34/2026): https://tribium.com.br/noticias/sefaz-sp-esclarece-emissao-de-nf-e-em-venda-para-entrega-futura-com-pagamento-antecipado
- Inventti (Ajuste SINIEF 27/2026): https://inventti.com.br/ajuste-sinief-27-2026-prorroga-para-2027-regras-de-nf-e-e-ct-e-previstas-no-ajuste-sinief-49-2025/
- CRC-MS (Ajuste 49/25 — finalidades): https://crcms.org.br/wp-content/uploads/2026/04/Ajuste-SINIEF-4925-Novas-Finalidades-da-NF-e-e-Impactos-Praticos-1.pdf
- VRi Consulting (devolução interna com ST em SP): https://vriconsulting.com.br/artigo.php?id=68&titulo=devolucao-interna-de-mercadoria-sujeita-ao-regime-de-substituicao-tributaria-icms-st-sp
- TOTVS (vIPIDevol para não contribuinte): https://centraldeatendimento.totvs.com/hc/pt-br/articles/360028217451
- Oobj / CIGAM / NFe.io (rejeições 321, 327, 328): https://oobj.com.br/bc/rejeicao-321-como-resolver ·
  https://www.cigam.com.br/wiki/index.php/Como_Resolver_a_Rejei%C3%A7%C3%A3o_327_-_CFOP_inv%C3%A1lido_para_NF-e_com_finalidade_de_devolu%C3%A7%C3%A3o_de_mercadoria%3F
- NetCPA (MDF-e em SP; Anexo IV): https://netcpa.com.br/colunas/icms-mdf-e-esclarecimentos/6150 ·
  https://netcpa.com.br/colunas/icmssp-devolucao-de-mercadoria-alteracao-no-anexo-iv-da-portaria-sre-4123/26708
- Escritório Taquaral / SMABR / Consulcamp (exclusões da ST em 2026): https://www.escritoriotaquaral.com.br/icms-st-produtos-excluidos-sp/ ·
  https://smabr.com/sefaz-sp-exclui-174-mercadorias-do-regime-de-substituicao-tributaria-do-icms/
- Lopes & Castelo (crédito na devolução de não contribuinte, Dec. 64.772/2020): https://lopescastelo.adv.br/icms-sp-permite-credito-do-imposto-sobre-devolucao-de-nao-contribuinte/
