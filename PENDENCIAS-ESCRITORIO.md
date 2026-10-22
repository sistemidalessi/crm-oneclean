# O que fazer no escritório — CRM OneClean

Atualizado em 22/10/2026. Quando um item for resolvido, apague a linha (ou peça ao Claude).
A mesma lista resumida está no `PENDENCIAS-ESCRITORIO.md` do `agilite-sistema-gestao` (a sessão do escritório abre lá).

## Só dá pra fazer estando no escritório (SSH da VPS)

- [ ] **Atualizar o serviço fiscal na VPS** (traz a busca das notas de compra na Sefaz, de 17/10, as respostas definitivas
      — confirmar, desconhecer, não realizada —, de 19/10, a regra da Reforma para as notas de 2027, de 22/10, e as **outras
      notas da virada** — devolução a fornecedor e de cliente, bonificação, entrega futura —, também de 22/10; as notas
      de venda de 2026 continuam saindo iguais). No terminal do escritório,
      entrar na VPS e rodar:
      `cd /opt/oneclean-fiscal && git pull -q && systemctl restart oneclean-fiscal && systemctl is-active oneclean-fiscal`
      Tem que responder `active`.
- [ ] **Primeira busca na Sefaz:** no CRM, Estoque → Notas de compra → **"Buscar na Sefaz agora"**. Devem aparecer as notas
      dos fornecedores dos últimos 3 meses (só o resumo: fornecedor, valor, data). Se der erro de certificado do servidor
      da Sefaz nacional, chamar o Claude: é acrescentar a raiz em `/etc/oneclean-fiscal/cadeia.pem` (nunca desligar a
      conferência).
- [ ] **Ciência da Operação:** depois da busca, apertar "Dar ciência e pedir o XML" (até 20 notas por vez). Na consulta
      seguinte (1 hora depois) chegam os XML completos, e "Trazer N nota(s) para a conferência" leva para o CRM. As de
      antes do início do estoque do CRM ficam só como histórico de preço.

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
