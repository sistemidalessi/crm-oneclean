# Registro da legislação fiscal — OneClean (CRM)

Achados do **Vigia da legislação (fiscal OneClean)**: só o que muda algo que o sistema faz (ver `monitoramento.md`).
Cada entrada: data; o que mudou; norma e link oficial; desde quando vale; o que precisa mudar no sistema;
urgência. O vigia só escreve aqui; quem muda o sistema é a sessão de desenvolvimento, com o Anderson.

<!-- novas entradas abaixo desta linha -->

## 07/11/2026 — Crédito presumido de CBS sobre o estoque existente em 01/01/2027 (LC 214/2025, art. 381; Decreto 12.955/2026, arts. 605 a 611)
- **O que mudou:** em 01/01/2027 o PIS/Pasep e a COFINS são extintos e a CBS passa a ser cobrada. A LC 214/2025 (Capítulo
  da utilização do saldo credor, **arts. 378 a 383**) e o regulamento da CBS (Decreto 12.955/2026, **arts. 602 a 613**) dizem o
  que acontece com os créditos e com o estoque na virada. Regra lida (entrada da sessão de desenvolvimento, pedido do Anderson):
  - **art. 378 / Dec. 602:** o saldo credor de PIS/COFINS (inclusive presumido) não usado até a extinção continua válido, sem
    interromper o prazo; deve estar na escrituração; compensa com a CBS (pedido formal) ou, nas condições da RFB, ressarcimento
    e compensação com outros tributos federais;
  - **art. 379 / Dec. 603:** bem devolvido a partir de 01/01/2027 de venda anterior dá crédito de CBS igual ao PIS/COFINS que
    incidiu na venda; só compensa com a CBS, sem ressarcimento;
  - **art. 380 / Dec. 604:** crédito que vinha sendo apropriado por depreciação/quota mensal continua, como crédito presumido de CBS;
  - **art. 381 / Dec. 605 a 611 (o que vale para a OneClean):** contribuinte do regime regular da CBS apropria **crédito presumido
    sobre o estoque de bens materiais existente em 01/01/2027** nas hipóteses: (I) quem estava no **cumulativo** em 31/12/2026
    (não é o caso: a OneClean é **Lucro Real**, não cumulativo); (II) bens sujeitos a **substituição tributária ou monofasia** de
    PIS/COFINS — Lei 10.147/2000, art. 1º, I (perfumaria, toucador e higiene pessoal: posições 33.03 a 33.07 exceto 33.06,
    3401.11.90 exceto Ex 01, 3401.20.10 e 9603.21.00), Lei 10.485/2002 (autopeças), MP 2.158-35 art. 43 e Lei 9.532 art. 53
    (cigarros), Lei 12.402/2011 art. 6º, II; (III) a parcela com vedação parcial de crédito (§§ 7º a 9º do art. 3º das Leis
    10.637 e 10.833). **Só bens novos** comprados de PJ no País ou importados, para revenda ou produção (§ 1º, I). **Fora:**
    bem com alíquota zero, isenção, suspensão ou não incidência de PIS/COFINS na compra (§ 1º, II; na OneClean: papel higiênico
    4818.10.00, Lei 10.925/2004); uso e consumo pessoal (III); ativo imobilizado e imóveis (IV). **Percentual e base (§ 3º):
    9,25% sobre o valor do estoque** para o bem nacional; para o importado, o PIS/COFINS-Importação efetivamente pago (sem o
    adicional). **Inventário (§ 2º; Dec. 606, 608 a 610):** feito em **31/12/2026, uma vez só**, abrangendo mercadorias, produtos
    acabados e em elaboração, matérias-primas e embalagens com documento fiscal idôneo guardado 5 anos; **valorado pelo custo de
    aquisição pelas regras do IRPJ** (nacional e importado separados; produto acabado/em processo só pelo custo de matéria-prima
    e embalagem); registrado no **Livro de Inventário** com quantidade, valor unitário, classificação fiscal (NCM) e descrição de
    cada item. **Apropriação (§ 4º):** apurar e apropriar **até 30/06/2027**; usar em **12 parcelas mensais iguais e sucessivas**
    a partir do período seguinte; **só compensa com a CBS** (nem outros tributos, nem ressarcimento). **Devolução (Dec. 611):**
    bem do estoque de abertura devolvido a partir de 01/01/2027 **estorna** o crédito presumido;
  - **art. 382 / Dec. 612:** a compensação com crédito de PIS/COFINS tem preferência sobre os créditos de CBS do art. 53;
  - **art. 383 / Dec. 613:** o direito de usar os créditos dos arts. 379 a 381 **extingue em 5 anos** do último dia do período de
    apuração em que houve a apropriação.
  No **Lucro Real** a compra normal (CST 01 do fornecedor) já deu crédito de 9,25% de PIS/COFINS (1,65% + 7,6%) e **fica fora**;
  o que entra é o que **não gerou crédito na compra**: monofásicos (o fornecedor vende com CST 02/03/04) e ST (CST 05). O saldo
  credor acumulado de PIS/COFINS continua valendo contra a CBS (art. 378).
- **Norma e link:** LC 214/2025, arts. 378 a 383 — https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm ; Decreto 12.955/2026
  (regulamento da CBS), arts. 602 a 613 — https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12955.htm (publicação
  original: https://www2.camara.leg.br/legin/fed/decret/2026/decreto-12955-29-abril-2026-799019-publicacaooriginal-179077-pe.html).
  **A CONFIRMAR no texto oficial:** o Planalto não abre inteiro pela rede da sessão (a página da LC 214 passa de 360 mil
  caracteres e a do decreto de 500 mil; os artigos 378 a 383 e 602 a 613 ficaram fora do trecho que deu para ler). O texto acima
  foi lido em cópia artigo por artigo (https://modeloinicial.com.br/lei/LCP-214-2025/utilizacao-saldo-credor-pis-da-cofins-@__I_VIII_V
  e https://modeloinicial.com.br/lei/DEC-12955-2026/utilizacao-saldo-credor-contribuicao-o-pis-pasep-da-cofins-dos-creditos-iniciais-cbs-@__II_XIII_II)
  e bate com os resumos de PwC (Tax Intelligence ed. 06/2026), Econet, Simtax e FCR Law. **O contador confere no original.**
  A avaliação de origem está em `sistemi-dalessi/docs/avaliacoes/2026-11-07-videos-cbs-estoque-e-ferramentas-abertas.md`.
- **Desde quando:** estoque de **01/01/2027** (inventário de 31/12/2026); apropriação até 30/06/2027; uso em 12 parcelas; 5 anos.
- **O que muda no sistema (feito em 07/11/2026, sessão de desenvolvimento):** (1) o CST e a alíquota de PIS/COFINS que o
  fornecedor usou passam a ser gravados em cada item da nota de compra (`crm_compra_itens.pis_cst`…; `estoque.js compraDoXml`),
  e as notas gravadas antes se completam pelo XML guardado (`crm_compra_itens_pis`, botão na tela); (2) **Fiscal → "5. Estoque de
  abertura para o crédito de CBS"** (`cbs-estoque.js`, função `crm_cbs_inventario(data)`, só administrador e gestora): posição do
  estoque numa data (31/12/2026; hoje, para teste) por produto e NCM, com saldo, custo médio, valor, a última nota de compra e o
  CST de PIS/COFINS dela, o CST da nossa venda e a **classificação sugerida** (crédito presumido / já deu crédito / alíquota zero /
  a conferir / saldo negativo), o crédito estimado de 9,25% e **CSV para o contador** (por item e por NCM). A classificação é
  sugestão pelas notas; **quem valida item a item e decide a apropriação é o contador** (`PENDENCIAS-ESCRITORIO.md`).
  O que o sistema **não** faz: não apropria nem escritura o crédito (é da EFD-Contribuições/ECD do contador); o custo é o médio
  do CRM (valor pago na nota, com ICMS, IPI, ST e frete, sem tirar créditos) — o contador ajusta à base do IRPJ se precisar.
- **Urgência:** **média-alta** — o inventário é o de 31/12/2026 (menos de 2 meses): os saldos negativos e as compras que ainda
  não entraram no CRM precisam estar acertados até lá, e a classificação precisa passar pelo contador antes.

## 21/10/2026 — SP: IBS e CBS entram na base de cálculo do ICMS a partir de 2027 (entendimento da Sefaz-SP)
- **O que mudou:** a Sefaz-SP respondeu (Resposta à Consulta nº 32931, de 22/01/2026) que, quando o IBS e a CBS forem
  efetivamente cobrados, o valor deles **compõe a base de cálculo do ICMS** (art. 13 da LC 87/1996: a base é o valor da
  operação, com os tributos cobrados do comprador). Em **2026 não entram**: o ano é de teste (CBS 0,9%, IBS 0,1%) e o
  PIS/COFINS continuam integrais. Há uma segunda resposta no mesmo sentido citada por blogs (RC 33.083/2026, não conferida).
  Resposta a consulta vale para quem consultou, mas mostra como a Sefaz-SP vai fiscalizar.
- **Norma e link:** Resposta à Consulta 32931/2026 — portal de consultas da Sefaz-SP
  (https://www.fazenda.sp.gov.br/eCT/); cópia: https://www.legisweb.com.br/legislacao/?id=490049 ; resumo:
  https://www.contabeis.com.br/noticias/75029/sefaz-sp-confirma-ibs-e-cbs-no-calculo-do-icms-a-partir-de-2027/
- **Desde quando:** a partir de 01/01/2027 (quando a CBS passa a ser cobrada de verdade). Texto oficial não lido (a rede
  da sessão barra o site da Sefaz-SP).
- **O que muda no sistema:** o cálculo do ICMS da emissão (`servico-fiscal/nfe.js`: hoje base = produto + frete −
  desconto) precisa, em 2027, incluir CBS (e o IBS, se a regra valer para ele) na base do ICMS, sem mexer em 2026.
  Combinar com o contador antes de virar o ano e acompanhar se o CONFAZ/NT da NF-e trazem campo ou regra de validação para isso.
- **Urgência:** **média** — nada muda em 2026, mas é cálculo de imposto da emissão direta e precisa estar pronto em 01/01/2027.

## 19/10/2026 — Papelaria e papel fora da ST em SP desde 01/07/2026 (Portaria SRE 9/2026)
- **O que mudou:** a Portaria SRE nº 9/2026 (assinada em 17/03, DOE 18/03/2026) revogou anexos da Portaria CAT 68/2019 —
  entre eles o de **papelaria e papel** (revogação integral), além de materiais de construção, bebidas frias/água e
  sorvetes — e as portarias de base de cálculo correspondentes (SRE 88/2025, 89/2025 e 29/2024). Junto com a SRE 94/2025
  (perfumaria e higiene, 01/04/2026), confirma que **papel higiênico, toalhas e demais papéis não têm mais ST em SP**,
  no mais tardar desde 01/07/2026.
- **Norma e link:** Portaria SRE 9/2026 — https://legislacao.fazenda.sp.gov.br/paginas/Portaria-CAT-68-de-2019.aspx
  (consolidada; a rede da sessão barra o site); cópia: https://www.legisweb.com.br/legislacao/?id=492605 ; resumo:
  https://documentacao.senior.com.br/exigenciaslegais/noticias/estadual/2026/2026-03-25-icms-sp-portaria-sre-no-9-2026-excluidos-diversos-produtos-da-substituicao-tributaria-a-partir-de-01-07-2026/
- **Desde quando:** 01/07/2026. Estoque na data: Portaria CAT 28/2020 (crédito do ICMS-ST do estoque, em geral em 12 parcelas).
- **O que muda no sistema:** `fiscal.js` hoje só reconhece **limpeza** fora da ST (`LIMPEZA_FORA_ST_SP`, desde 01/08). Precisa
  tratar também os CEST do segmento **20** (higiene pessoal, inclusive 20.042.00/20.043.00 papel higiênico — desde 01/04/2026)
  e do segmento de **papel/papelaria** (desde 01/07/2026): proposta 5102/CST 00/18%, e as vendas com 5405/CST 60 depois
  dessas datas vão para o contador (pelo registro de 15/10, ~R$ 692 mil em itens do segmento 20 com 5405 desde 01/04).
  Atualizar `monitoramento.md` (linha "ICMS SP"). Conferir com o contador e com o texto oficial a data de cada item
  (toalha 20.044.00: 01/04 ou 01/07).
- **Urgência:** **alta** — já em vigor; afeta o produto mais vendido (papel higiênico/toalha) e a emissão direta da Fase 4.

## 16/10/2026 — CNPJ alfanumérico já vale na NF-e (desde 01/07/2026)
- **O que mudou:** a Receita passou a atribuir CNPJ com letras e números (12 primeiras posições alfanuméricas, 2
  dígitos verificadores numéricos). A **NT 2026.004** (v1.00 de abril, v1.01 de 08/06/2026) mudou o esquema da NF-e/NFC-e:
  campos de CNPJ (emitente, destinatário, transportador, autorizados) e a **chave de acesso de 44 posições** passam a
  aceitar letras; a inutilização (NFeInutilizacao) também.
- **Norma e link:** IN RFB nº 2.229/2024; NT 2026.004 v1.01 — https://www.nfe.fazenda.gov.br/portal/ (Documentos →
  Notas Técnicas). Resumo: https://documentacao.senior.com.br/exigenciaslegais/noticias/federal/2026/2026-06-08-nf-e-nfc-e-nota-tecnica-no-2026-004-v-1-01-cnpj-alfanumerico-atualizacoes/
- **Desde quando:** homologação 15/06/2026, **produção 01/07/2026** (os CNPJs antigos, só números, continuam válidos).
- **O que muda no sistema:** o CRM trata CNPJ como **só dígitos** em vários lugares — `regras.js` `chaveDoc`/`digitos`
  (a chave do "mesmo cadastro"), a trava do banco `crm_doc` (`schema.sql`), `nfe.js` (acha o cliente pelo CNPJ,
  `R.digitos(e.cnpj)`, emitente, raiz de 8 dígitos da filial), `financeiro.js`/`fkn.js` (contas a receber e a pagar),
  `orcamento.js`, `cobranca.js` (CNPJ do boleto) e a chave de 44 dígitos das notas. Um cliente novo com CNPJ
  alfanumérico **perderia as letras**: não seria achado, a trava de duplicado não o pegaria e a validação de 14 dígitos o
  descartaria. O serviço fiscal (Fase 4) precisa do esquema novo e do cálculo do DV alfanumérico (valor ASCII − 48).
- **Urgência:** **média-alta** — a emissão já aceita esses CNPJs desde julho e os primeiros clientes com CNPJ novo podem
  aparecer a qualquer momento; hoje o sistema só lê notas (não quebra a emissão), mas erra o cadastro.
- **Atendido em 16/10/2026** (sessão de desenvolvimento, pedido do Anderson): o CRM guarda, valida, formata, busca e acha
  duplicado com letras; `crm_doc` do banco igual; `crm-notas` v28 e `crm-caixa-ler` v12. Falta só no serviço fiscal (Fase 4):
  esquema novo e DANFE com código de barras para chave com letras (a chave das notas da OneClean segue numérica).

## 16/10/2026 — Manifestação do destinatário: prazo caiu para 90 dias (desde 01/06/2026)
- **O que mudou:** a manifestação conclusiva (confirmação da operação, desconhecimento, operação não realizada) passou de
  180 para **90 dias** contados da autorização da NF-e; a ciência da emissão segue com prazo próprio (curto — conferir).
- **Norma e link:** Ajuste SINIEF 14/2026; NT 2020.001 v1.60 (publicada em 23/04/2026) — https://www.nfe.fazenda.gov.br/portal/
- **Desde quando:** homologação 15/05/2026, produção 01/06/2026.
- **O que muda no sistema:** o serviço fiscal (a fazer) que lê as notas de compra pelo DF-e deve dar ciência logo e
  avisar a confirmação **antes de 90 dias** (lembrete com folga, por exemplo em 60 dias). Atualizar `monitoramento.md`
  (linha "Notas de compra").
- **Urgência:** **baixa** — nada no sistema faz manifestação ainda; vale para o desenho da Fase de notas de compra.

## 16/10/2026 — Tabelas de IBS/CBS (cClassTrib, CST, crédito presumido) v1.70: prazo 16/10/2026
- **O que mudou:** Informe Técnico 2025.002 v1.70 (publicado em 01/10/2026) atualiza as tabelas de classificação
  tributária, CST e crédito presumido do IBS/CBS (9 códigos novos de cClassTrib, indicadores de uso por documento em 10
  códigos, colunas novas na de crédito presumido). Os autorizadores têm até **16/10/2026** para aplicar.
- **Link oficial:** https://www.nfe.fazenda.gov.br/portal/ e https://dfe-portal.svrs.rs.gov.br/NFe/Documentos
- **O que muda no sistema:** o serviço fiscal (a fazer) deve usar a tabela vigente na data da operação (guardar a versão);
  conferir o cClassTrib da venda normal de limpeza/descartáveis/EPI com o contador antes de emitir.
- **Urgência:** **baixa** agora; vira obrigatória quando a emissão direta começar.

## 15/10/2026 — Perfumaria e higiene pessoal fora da ST em SP desde 01/04/2026 (A CONFIRMAR para papel)
- **O que mudou:** notícias de contabilidades citam a **Portaria SRE 94/2025** (DOE 23/12/2025), que revogou o
  **Anexo XI da Portaria CAT 68/2019** (perfumaria e higiene pessoal) e a SRE 48/2025 (MVA), com efeito em
  **01/04/2026**. Uma fonte cita "SRE 09/2026" e uma exclusão de "papel e papelaria" em 01/07/2026 — não confirmado.
- **Link oficial:** https://legislacao.fazenda.sp.gov.br/paginas/Portaria-CAT-68-de-2019.aspx (a rede da sessão barrou
  o site; texto oficial **não lido**).
- **Ponto em aberto:** se o papel higiênico (CEST 20.042.00, 4818.10.00) e as toalhas/interfolhas de papel (CEST
  20.044.00, 4818.20.00) estavam no Anexo XI de SP. Nas notas do CRM, desde 01/04/2026 saíram **R$ 692 mil** em itens de
  CEST do segmento 20 com **5405/CST 60** (toalha bobina, papel higiênico 300005 e mexedor de café são quase tudo) e
  R$ 354 mil com 5102/CST 00. Também há CEST incoerente com o NCM no cadastro do FKN (ex.: mexedor de café 3924.10.00
  com CEST 20.062.00; gel clarificante 2827.32.00 com CEST 20.044.00).
- **O que muda no sistema:** se confirmado, `fiscal.js` trata o segmento 20 como fora da ST desde 01/04/2026 (igual à
  limpeza desde 01/08) e as notas com 5405 depois disso vão para o contador. Até lá, **nada no código**.
- **Urgência:** **alta** — valor grande; confirmar com o contador e com o texto oficial.
- **Confirmado em 19/10/2026 (parcial, por fontes secundárias; texto oficial ainda não lido):** a tabela do Anexo XI
  da CAT 68/2019 trazia o **papel higiênico** (CEST **20.042.00** folha simples e **20.043.00** folha dupla/tripla/
  quádrupla, NCM 4818.10.00), e o Anexo XI foi revogado pela Portaria SRE 94/2025 a partir de **01/04/2026** (fontes:
  https://simtax.com.br/fim-substituicao-tributaria-perfumaria-sp/ , https://www.legisweb.com.br/noticia/?id=32102). A
  "SRE 09/2026" existe (ver entrada de 19/10): ela revogou o anexo de **papelaria e papel** a partir de 01/07/2026. Falta
  ver no texto oficial se toalha/interfolha de papel (CEST 20.044.00, 4818.20.00) estava no Anexo XI ou no de papel;
  pelas duas portarias, desde 01/07/2026 os dois anexos estão revogados.

## 15/10/2026 — ICMS-ST em SP: produtos de limpeza fora da ST desde 01/08/2026
- **O que mudou:** a Portaria SRE nº 20/2026 (DOE 05/05/2026) revogou os Anexos XII (ração) e XIII (**produtos de
  limpeza**: detergentes, desinfetantes, multiuso, sabões, água sanitária, alvejantes) da Portaria CAT 68/2019 e a
  Portaria SRE 55/2025 (base de cálculo da ST de limpeza). Esses itens voltaram ao ICMS normal. Antes (em 01/04/2026), a
  Portaria SRE 94/2025 tirou perfumaria e higiene pessoal; e a Portaria SRE 34/2026 tirou ~174 itens (ferramentas,
  materiais elétricos, autopeças etc.) a partir de 01/10/2026.
- **Norma e link:** Portaria SRE 20/2026 — https://legislacao.fazenda.sp.gov.br/paginas/Portaria-CAT-68-de-2019.aspx
  (texto consolidado da CAT 68/2019 no portal da Sefaz-SP); cópia: https://www.legisweb.com.br/legislacao/?id=495257
- **Desde quando:** 01/08/2026 (limpeza); 01/10/2026 (lista da SRE 34/2026). Estoque na data: Portaria CAT 28/2020
  (levantamento e ressarcimento/complemento).
- **O que muda no sistema:** `fiscal.js` hoje toma a **combinação de venda mais recente** como proposta e trata 5405 +
  CST 60 + CEST como certo. Para produto de limpeza vendido depois de 01/08/2026 o correto passa a ser **5102 + CST 00
  (18%)**; 5405/CST 60 após essa data vira **erro**, e a proposta não pode copiar o histórico de antes de 01/08. Conferir
  também EPIs/ferramentas contra a lista da SRE 34/2026 (desde 01/10). Atualizar `monitoramento.md` (linha "ICMS SP").
  Confirmar com o contador o tratamento do estoque de 31/07 (CAT 28/2020).
- **Urgência:** **alta** — já em vigor; a emissão direta (Fase 4) não pode nascer com ST nesses itens, e notas do FKN
  emitidas desde 01/08 com 5405 merecem conferência.

## 15/10/2026 — NF-e: pacote de Notas Técnicas da Reforma (01/10) e novas datas
- **O que mudou:** em 01/10/2026 o Portal da NF-e publicou: **NT 2025.002-RTC v1.52** (regras de IBS/CBS, ex.: VC02-14,
  VC02-50); **NT 2026.007 v1.10** (emissão por contribuinte só de IBS/CBS sem IE, validado na lista da RFB); **NT
  2026.008 v1.00** (campos novos de **valor líquido** unitário e do produto; IBS/CBS no vProd); **NT 2026.002 v1.11**
  (regras I08-180, BA02-35, VC02-40 — vedação de NF-e que referencia NFC-e / DANFE simplificado — passam de 05/10 para
  **14/12/2026**); **NT 2026.010** (leiaute do **DANFE** com quadro "Total do IBS/CBS/IS", CRT no emitente e IBS/CBS/IS
  por item; não muda o XML). Depois, aviso do ENCAT adiou 2025.002 v1.52, 2026.007 e 2026.008.
- **Link oficial:** https://www.nfe.fazenda.gov.br/portal/ (Documentos → Notas Técnicas) e
  https://dfe-portal.svrs.rs.gov.br/NFe/Documentos (aviso de postergação do ENCAT no portal da SVRS).
- **Desde quando:** 2025.002 v1.52, 2026.007, 2026.008: **homologação 26/10/2026, produção 16/11/2026**; 2026.002
  v1.11: produção 14/12/2026; 2026.010 (DANFE): **produção 01/12/2026**, sem homologação. O adiamento é das regras de
  validação/rejeição, não da obrigação de informar IBS/CBS.
- **O que muda no sistema:** serviço fiscal (a fazer) deve nascer já com o esquema das NTs v1.52/2026.008 (grupo
  IBS/CBS e valor líquido) e testar em homologação a partir de 26/10; `danfe.js` (cópia da DANFE da cobrança) precisa do
  quadro IBS/CBS/IS e do CRT até 01/12; `nfe.js` (leitura) deve aceitar os campos novos sem quebrar. NT 2026.007 não
  atinge a OneClean (tem IE).
- **Urgência:** **média** — nada quebra hoje (o sistema ainda não emite), mas as datas de 26/10, 16/11 e 01/12 caem
  antes ou durante a Fase 4. Conferir as datas no portal oficial (vieram de notícias que citam o aviso).

## 15/10/2026 — início do monitoramento
Monitoramento criado junto com a Fase 1 da saída do FKN. Nenhum achado ainda.
