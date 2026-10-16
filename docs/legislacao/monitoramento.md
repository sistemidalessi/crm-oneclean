# Monitoramento da legislação fiscal — OneClean (CRM)

Lido todo dia útil pelo **Vigia da legislação (fiscal OneClean)** (tarefa agendada da conta do Anderson). Aqui fica
**o que o sistema usa hoje**; os achados vão para `registro.md`. Atualizar este arquivo quando o sistema mudar
(quem muda é a sessão de desenvolvimento, nunca o vigia).

> **Regra do vigia (não pode ser quebrada):** o vigia só altera `docs/legislacao/registro.md`. Nunca `fiscal.js`,
> testes, `CLAUDE.md`, este arquivo ou qualquer outro — mesmo que a correção pareça óbvia ou que um `CLAUDE.md` fale em
> "já fazer o certo" (isso vale para a sessão de desenvolvimento). O que o código precisa mudar vai escrito em "O que
> muda no sistema". Em 15/10 o vigia mexeu em `fiscal.js` e `CLAUDE.md`; não repetir. Antes do commit: `git status
> --short` e só `registro.md` pode aparecer. Entradas "A CONFIRMAR": tentar confirmar na fonte oficial e acrescentar
> "Confirmado em <data>: …" ou "Não confirmado: …" na própria entrada.

## A empresa
- **OneClean** — distribuidora de produtos de limpeza, descartáveis, EPIs e copa; São Bernardo do Campo/SP;
  **Lucro Real**; vende quase só dentro de SP (contribuintes e não contribuintes). Vendas para outros estados:
  nenhuma hoje (tratar quando aparecer).
- ~280 NF-e de venda por mês; ~60 notas de compra por mês.

## O que o sistema faz ou vai fazer (e onde)
| Assunto | O que usamos hoje | Onde no sistema |
|---|---|---|
| NF-e (modelo 55) | leiaute 4.00; leitura do XML autorizado; **emissão direta na Sefaz-SP a partir da Fase 4** (serviço fiscal na VPS da Agilité, assinatura com o A1) | `nfe.js` (leitura), `fiscal.js` (regras), serviço fiscal (a fazer) |
| Notas Técnicas da NF-e | acompanhar toda NT nova (campos, regras de validação, prazos de produção e homologação) | serviço fiscal (a fazer) |
| Reforma Tributária (IBS/CBS) | campos novos na NF-e a partir de 2026 (LC 214/2025); 2026 é o ano de teste; PIS/COFINS dão lugar à CBS a partir de 2027 | `fiscal.js`, serviço fiscal |
| CFOP usados | 5102 (venda), 5405 (venda com ST já recolhido), 5922/5117 (entrega futura, raro), 5910 (bonificação), 1202/1411 (devolução de cliente), 5949 (remessa em troca) | `fiscal.js` |
| ICMS SP | alíquota interna geral 18%; CST 00 na venda sem ST; **ST**: CST 60 e CEST obrigatório (tabela do Convênio ICMS 142/2018); **produtos de limpeza fora da ST desde 01/08/2026** (Portaria SRE 20/2026 revogou o Anexo XIII da CAT 68/2019): 5102, CST 00, 18% — reconhecidos por CEST 11.xxx.xx ou NCM da lista `LIMPEZA_FORA_ST_SP` (incompleta: conferir com o texto oficial) | `fiscal.js` (verificações, `LIMPEZA_FORA_ST_SP`) |
| PIS/COFINS | não cumulativos, **1,65% e 7,6%** (Leis 10.637/2002 e 10.833/2003); **papel higiênico 4818.10.00 com alíquota zero** (Lei 10.925/2004, art. 1º, XXVIII), CST 06; higiene pessoal do regime monofásico (Lei 10.147/2000) com alíquota zero na revenda | `fiscal.js` (verificações) |
| Notas de compra | distribuição de DF-e (Ambiente Nacional) e manifestação do destinatário (ciência da operação) | serviço fiscal (a fazer) |
| Boleto | API de cobrança do Banco do Brasil (registro e aviso de pagamento); CNAB como plano B | a fazer (Fase 5) |
| Contabilidade | XML de saída + relação de canceladas e inutilizadas do mês; inventário de 31/12 no encerramento de dezembro | Fechar o mês (a fazer) |
| CNPJ alfanumérico | IN RFB 2.229/2024 e NT 2026.004 (NF-e desde 01/07/2026): letras nas 12 primeiras posições, DV numérico (ASCII − 48); a chave de 44 posições também aceita letras. **O CRM aceita desde 16/10/2026** (`regras.js` `doc`/`chaveDoc`/`cnpjValido`, `crm_doc` do banco) | `regras.js`, `schema.sql`, `nfe.js` e leitores |
| Certificado A1 | e-CNPJ da OneClean (Safeweb) — **vence em 29/10/2026** (renovação pedida em 15/10) | serviço fiscal |
| E-mail e WhatsApp | descadastro em todo e-mail de marketing (LGPD); WhatsApp pela API oficial da Meta (preço por mensagem) | `crm-email`, `crm-whatsapp` |

## Fontes oficiais (prefira sempre estas)
- Portal Nacional da NF-e (Notas Técnicas, esquemas XSD, prazos): https://www.nfe.fazenda.gov.br/portal/
- Sefaz-SP (legislação do ICMS, Comunicados CAT, Portarias SRE, substituição tributária): https://portal.fazenda.sp.gov.br/
- CONFAZ (Convênios ICMS, Ajustes SINIEF, CEST): https://www.confaz.fazenda.gov.br/
- Receita Federal (PIS/COFINS, IN, Soluções de Consulta, CBS): https://www.gov.br/receitafederal/
- Reforma Tributária do Consumo (IBS/CBS, regulamentação, Comitê Gestor): https://www.gov.br/fazenda/
- Diário Oficial da União: https://www.in.gov.br/
- Banco do Brasil para desenvolvedores (API de cobrança): https://developers.bb.com.br/
