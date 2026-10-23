# O que fazer no escritório — CRM OneClean

Atualizado em 23/10/2026. Quando um item for resolvido, apague a linha (ou peça ao Claude).
A mesma lista resumida está no `PENDENCIAS-ESCRITORIO.md` do `agilite-sistema-gestao` (a sessão do escritório abre lá).

## Só dá pra fazer estando no escritório (SSH da VPS)

- [x] **Serviço fiscal na VPS `2026-10-23a`** — atualizado pelo Anderson em 23/10 (`active`). **DIFAL testado em
      homologação no mesmo dia:** NF 2-9 para a BBMD (RS) autorizada (cStat 100), CFOP 6108, ICMS 12% e DIFAL de R$ 3,94; o
      pedido de teste nº 6 foi cancelado. A busca de notas de compra na Sefaz e a ciência já funcionam desde 22/10.
- [x] **Serviço fiscal na VPS `2026-10-23b`** (cesta básica com CST 20 + cBenef e o campo EXTIPI) — atualizado em 23/10 (`active`).
- [x] **Serviço fiscal na VPS `2026-10-23d`** (pedido sem forma de pagamento não emite; "PROGRAMADO 15/11/2026" vira o
      vencimento da duplicata; remessa da entrega futura com a chave do faturamento feito no FKN) — atualizado pelo Anderson
      em 23/10 (`active`).
- [ ] **Serviço fiscal na VPS `2026-10-23e`** (DIFAL do RS: perfumaria 3303/3304/3305/3307 a 25% + FCP 2%): no SSH,
      `cd /opt/oneclean-fiscal && git pull -q && systemctl restart oneclean-fiscal && systemctl is-active oneclean-fiscal`.
      Só pesa na venda à BBMD (RS); sem pressa, mas antes da próxima venda para o RS.
- [ ] **Santa Casa (entrega futura):** ainda há saldo a entregar do faturamento (5922) feito no FKN? As remessas (5117) iam
      duas por mês até 03/08; em setembro e outubro não houve. Se houver, a remessa pelo CRM pede a chave da nota de faturamento
      (Pedido → Outra operação → Entrega futura — remessa).
- [x] **Alíquota do RS no DIFAL (17%):** conferida por mim em 23/10 (RICMS/RS, art. 27, X) e marcada no banco; perfumaria a 25%.

## Perguntas que só você responde

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
      dezembro. O que vence em **29/10/2026** é outro (provavelmente o do FKN/UniNFe): se for, para o FKN seguir de reserva até
      30/11, apontar o FKN para o mesmo certificado da VPS; se não precisar da reserva, nada a fazer.
- [ ] **Tabela do IBPT** (tributos aproximados na nota) está vencida desde 30/09: subir a nova pela aba Fiscal.
