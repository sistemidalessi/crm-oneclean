# Registro da legislação fiscal — OneClean (CRM)

Achados do **Vigia da legislação (fiscal OneClean)**: só o que muda algo que o sistema faz (ver `monitoramento.md`).
Cada entrada: data; o que mudou; norma e link oficial; desde quando vale; o que precisa mudar no sistema;
urgência. O vigia só escreve aqui; quem muda o sistema é a sessão de desenvolvimento, com o Anderson.

<!-- novas entradas abaixo desta linha -->

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
