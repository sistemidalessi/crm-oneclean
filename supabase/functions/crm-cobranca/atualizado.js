// Boleto vencido atualizado ao cliente (04/11/2026, pedido do Anderson: "enviar o vencido já atualizado com juros e multa,
// a partir do 1º dia de atraso, e enviar direto"; o aviso do cartório fica no 3º dia útil). Partes puras, sem Deno: a
// função (crm-cobranca) importa e os testes do Node (testes/cobranca-atualizado.test.js) também.
// Juros e multa são os do PRÓPRIO boleto no banco (detalhe da API de Cobrança do BB): juros "taxa mensal" (tipo 2) dia a dia
// sobre o valor, contados do vencimento; multa percentual (tipo 2) a partir da data da multa. O banco calcula o mesmo na
// hora do pagamento: o PDF mostra o valor de HOJE, e pago noutro dia o banco cobra o daquele dia.

const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const dia = iso => new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
const isoDe = d => d.toISOString().slice(0, 10);
const digitos = v => String(v == null ? '' : v).replace(/\D/g, '');

// primeiro dia útil a partir do vencimento (vencido em sábado, domingo ou feriado, paga-se sem encargo no dia útil seguinte).
// util(iso) → boolean (o calendário de feriados vem de fora; sem ele, só sábado e domingo)
export function vencimentoEfetivo(vencimento, util) {
  const d = dia(vencimento);
  const ok = util || (x => { const w = dia(x).getUTCDay(); return w !== 0 && w !== 6; });
  for (let i = 0; i < 10 && !ok(isoDe(d)); i++) d.setUTCDate(d.getUTCDate() + 1);
  return isoDe(d);
}

// encargos até hoje. b = { valor, vencimento, juros: { tipo, pct, valor }, multa: { tipo, pct, valor, data } }
// juros tipo 1 = valor por dia; tipo 2 = taxa mensal (÷ 30 por dia); multa tipo 1 = valor fixo; tipo 2 = percentual.
export function encargos(b, hoje, util) {
  const valor = r2(b.valor), venc = String(b.vencimento).slice(0, 10);
  const efetivo = vencimentoEfetivo(venc, util);
  if (!(hoje > efetivo)) return { atrasado: false, dias: 0, multa: 0, juros: 0, encargos: 0, total: valor };
  const dias = Math.round((dia(hoje) - dia(venc)) / 864e5);
  const j = b.juros || {}, m = b.multa || {};
  let juros = 0, multa = 0;
  if (Number(j.tipo) === 2 && Number(j.pct) > 0) juros = valor * Number(j.pct) / 100 / 30 * dias;
  else if (Number(j.tipo) === 1 && Number(j.valor) > 0) juros = Number(j.valor) * dias;
  const dataMulta = m.data ? String(m.data).slice(0, 10) : venc;
  if (hoje >= dataMulta) {
    if (Number(m.tipo) === 2 && Number(m.pct) > 0) multa = valor * Number(m.pct) / 100;
    else if (Number(m.tipo) === 1 && Number(m.valor) > 0) multa = Number(m.valor);
  }
  juros = r2(juros); multa = r2(multa);
  return { atrasado: true, dias, multa, juros, encargos: r2(juros + multa), total: r2(valor + juros + multa) };
}

// número da nota no "seu número" do boleto do site ("2552", "2363-01", "002862/01", "00286201")
export function notaDoSeuNumero(seu) {
  const s = String(seu || '').trim();
  let m = /^0*(\d{1,7})\s*[-\/]\s*\d{1,3}$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(\d{6})(\d{2})$/.exec(s);   // "00286201": nota de 6 dígitos + parcela (seu número dos boletos do CRM)
  if (m) return Number(m[1]);
  m = /^0*(\d{1,7})$/.exec(s);
  return m ? Number(m[1]) : null;
}

// Liga cada boleto vencido do banco a UM título do CRM: mesmo CNPJ (raiz + filial) do cliente, mesmo valor (±1 centavo) e
// mesmo vencimento; com mais de um candidato, desempata pela nota do "seu número". Sem um título certo, fica de fora.
// boletos: saída da crm-bb { acao: 'vencidos' }; titulos: crm_titulos com empresa_id; docs: Map(empresa_id → CNPJ/CPF em dígitos)
export function casa(boletos, titulos, docs) {
  const out = [], sem = [];
  for (const b of boletos || []) {
    const doc = digitos(b.doc);
    const cands = (titulos || []).filter(t => digitos(docs.get(t.empresa_id)) === doc && Math.abs(r2(t.valor) - r2(b.valor)) < 0.011 &&
      String(t.vencimento).slice(0, 10) === String(b.vencimento).slice(0, 10));
    let t = cands.length === 1 ? cands[0] : null;
    if (!t && cands.length > 1) {
      const nf = notaDoSeuNumero(b.seu);
      const porNota = cands.filter(x => nf && Number(x.nota_numero) === nf);
      if (porNota.length === 1) t = porNota[0];
    }
    if (t) out.push({ boleto: b, titulo: t }); else sem.push({ boleto: b, candidatos: cands.length });
  }
  return { casados: out, sem };
}

// Quem recebe hoje o boleto atualizado: casado, em atraso (depois do vencimento efetivo), fora do cartório no banco
// (estado 3) e no CRM, sem data combinada (previsão de hoje em diante), cliente fora da lista "sem aviso", o cliente não
// disse que pagou, ainda dentro do prazo-limite de recebimento do banco e sem boleto atualizado já mandado deste título.
// ja: Set(`${empresa_id}|${duplicata}`) dos que já receberam. Um envio por cliente, com todos os boletos dele.
export function quemRecebeBoleto({ casados, hoje, util, ja, pagos, semAviso }) {
  const porCliente = new Map(), fora = [];
  for (const { boleto: b, titulo: t } of casados || []) {
    const k = t.empresa_id + '|' + t.duplicata;
    const motivo = Number(b.estado) === 3 || t.cartorio_em ? 'em cartório'
      : t.previsao && String(t.previsao) >= hoje ? 'data combinada com o cliente'
      : semAviso && semAviso.has(t.empresa_id) ? 'cliente sem aviso'
      : pagos && pagos.has(k) ? 'o cliente disse que pagou'
      : ja && ja.has(k) ? null
      : b.limite && hoje > String(b.limite) ? 'passou do prazo-limite do banco (precisa de boleto novo)'
      : !digitos(b.linha) ? 'o banco não devolveu a linha digitável' : '';
    if (motivo === null) continue;   // já recebeu: nem conta
    const e = encargos(b, hoje, util);
    if (!e.atrasado) continue;
    if (motivo) { fora.push({ empresa_id: t.empresa_id, duplicata: t.duplicata, nota_numero: t.nota_numero, valor: r2(b.valor), motivo }); continue; }
    if (!porCliente.has(t.empresa_id)) porCliente.set(t.empresa_id, []);
    porCliente.get(t.empresa_id).push({ boleto: b, titulo: t, ...e });
  }
  const lista = [...porCliente.entries()].map(([empresa_id, l]) => {
    l.sort((a, b) => String(a.titulo.vencimento).localeCompare(String(b.titulo.vencimento)));
    return { empresa_id, itens: l, original: r2(l.reduce((s, x) => s + r2(x.boleto.valor), 0)), total: r2(l.reduce((s, x) => s + x.total, 0)) };
  });
  return { lista, fora };
}

const dm = v => String(v).slice(8, 10) + '/' + String(v).slice(5, 7) + '/' + String(v).slice(0, 4);
export function moeda(v) {
  const [i, d] = Math.abs(Number(v) || 0).toFixed(2).split('.');
  return (v < 0 ? '-' : '') + 'R$ ' + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
}
const juntaE = l => (l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1]);
const docDe = t => (t.nota_numero ? 'NF ' + t.nota_numero : 'duplicata ' + t.duplicata);

// Texto do modelo "boleto_vencido" (WhatsApp, com o PDF no cabeçalho) e do e-mail. Cordial e sem falar de cartório (isso é o
// aviso do 3º dia útil). {{1}} cliente · {{2}} vendedor(a) · {{3}} notas e vencimentos · {{4}} valor de hoje ·
// {{5}} linha(s) digitável(is).
export const CORPO_BOLETO = (empresa) => 'Olá, {{1}}! Aqui é {{2}}, da ' + empresa + '.\n\n' +
  'Ainda não identificamos o pagamento de {{3}}. Para facilitar, segue em PDF o boleto atualizado, já com juros e multa até hoje.\n\n' +
  'Valor para pagar hoje: {{4}}\nLinha digitável: {{5}}\n\n' +
  'O código é o mesmo do boleto original: o banco calcula os encargos do dia na hora do pagamento. Se já tiver pago, por favor desconsidere e toque em "Já paguei". Qualquer dúvida, fale comigo pelo botão abaixo. Obrigado!';
const formataLinha = l => {
  const d = digitos(l);
  return d.length !== 47 ? d : d.slice(0, 5) + '.' + d.slice(5, 10) + ' ' + d.slice(10, 15) + '.' + d.slice(15, 21) + ' ' + d.slice(21, 26) + '.' + d.slice(26, 32) + ' ' + d[32] + ' ' + d.slice(33);
};
export function parametrosBoleto({ cliente, vendedora, envio, hoje }) {
  const it = envio.itens;
  const p3 = it.length === 1 ? 'a ' + docDe(it[0].titulo) + ', que venceu em ' + dm(it[0].titulo.vencimento)
    : 'as ' + juntaE(it.map(x => docDe(x.titulo) + ' (venceu em ' + dm(x.titulo.vencimento) + ')'));
  const p4 = moeda(envio.total) + ' (original ' + moeda(envio.original) + ', com juros e multa até ' + dm(hoje) + ')';
  const p5 = it.map(x => formataLinha(x.boleto.linha)).join(' / ');
  return [cliente || 'tudo bem', vendedora || 'o financeiro', p3, p4, p5];
}
export function faixaPdf(x, hoje) {
  return 'BOLETO ATUALIZADO ATÉ ' + dm(hoje) + ': pague ' + moeda(x.total) + ' (original ' + moeda(x.boleto.valor) + ' + multa ' + moeda(x.multa) +
    ' + juros ' + moeda(x.juros) + ', ' + x.dias + ' dia' + (x.dias === 1 ? '' : 's') + ' de atraso). Mesmo código de barras: pago em outro dia, o banco calcula os encargos daquele dia.';
}
export const textoFinal = (corpo, p) => corpo.replace(/\{\{(\d)\}\}/g, (_, n) => p[Number(n) - 1] || '');
export function textoEmailBoleto(corpo, p, tel) {
  return textoFinal(corpo, p)
    .replace('fale comigo pelo botão abaixo', 'é só responder este e-mail' + (tel ? ' ou me chamar no WhatsApp ' + tel : ''))
    .replace(' e toque em "Já paguei"', '');
}

// resumo da rodada para o administrador (vai ao CEO do grupo, no WhatsApp dele): uma linha por cliente
export function resumoRodada({ hoje, boletos, avisos, fora, sem, alertas }) {
  const l = [];
  const b = (boletos || []).filter(x => x.enviado), a = (avisos || []).filter(x => x.enviado);
  l.push('Cobrança automática de ' + dm(hoje) + ':');
  l.push('Boletos atualizados enviados: ' + b.length + (b.length ? ' (' + moeda(b.reduce((s, x) => s + (Number(x.total) || 0), 0)) + ')' : ''));
  b.forEach(x => l.push('• ' + x.empresa + ': ' + x.docs + ', ' + moeda(x.total) + ' por ' + (x.canais || []).join(' e ')));
  l.push('Avisos de atraso (3º dia útil, com o prazo do cartório): ' + a.length);
  a.forEach(x => l.push('• ' + x.empresa + (x.canais ? ' por ' + x.canais.join(' e ') : '')));
  const naoFoi = (boletos || []).filter(x => !x.enviado).concat((avisos || []).filter(x => !x.enviado));
  if (naoFoi.length) { l.push('Não saiu (falta contato ou falhou): ' + naoFoi.length); naoFoi.forEach(x => l.push('• ' + x.empresa + ': ' + (x.erro || 'sem canal'))); }
  if ((fora || []).length) { l.push('Fora do envio: ' + fora.length); fora.forEach(x => l.push('• ' + (x.nome || x.empresa_id) + ' ' + (x.nota_numero ? 'NF ' + x.nota_numero : x.duplicata) + ': ' + x.motivo)); }
  if ((sem || []).length) l.push('Boletos vencidos no banco sem título certo no CRM: ' + sem.length + ' (conferir em Caixa → Cobrança)');
  if (alertas) l.push('Prazo do cartório vencido (decidir o cartório): ' + alertas);
  return l.join('\n');
}

// ---- o PDF: o mesmo desenho do boleto do CRM (boleto.js, desenha), com "(+) Juros / Multa" e "(=) Valor Cobrado" de hoje e
// a faixa no alto. B = CRMBoleto (boleto.js); jsPDF = a classe; cfg = crm_config.dados.boleto; emit = dados.fiscal.emitente.
// O código de barras é refeito pelos dados do boleto e conferido com o que o banco devolveu: não bate, não sai.
export function dadosDoBoleto(B, cfg, emit, x, hoje) {
  const b = x.boleto, nosso = digitos(b.nosso_numero);
  if (nosso.length !== 17) throw new Error('nosso número inválido');
  const codigo = B.codigoBarras('001', String(b.vencimento).slice(0, 10), r2(b.valor), B.campoLivre(nosso, cfg.carteira || 17));
  if (b.codigo && digitos(b.codigo) !== codigo) throw new Error('o código de barras refeito não bate com o do banco (' + nosso + ')');
  const pg = b.pagador || {};
  const cep = digitos(pg.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2');
  return {
    banco: '001-9', linha: digitos(b.linha), linhaFmt: formataLinha(b.linha), codigo, nossoNumero: nosso,
    vencimento: String(b.vencimento).slice(0, 10), valor: r2(b.valor), documento: String(x.titulo.duplicata || b.seu || '').slice(0, 15),
    emissao: b.emissao || hoje, processamento: hoje, carteira: String(cfg.carteira || 17).padStart(2, '0'),
    variacao: digitos(cfg.variacao) ? digitos(cfg.variacao).padStart(3, '0') : '', especie: 'DM', aceite: 'N', moeda: 'R$',
    nossoImpresso: B.nossoImpresso(nosso),
    localPagamento: cfg.local_pagamento || 'Pagar preferencialmente nos canais de autoatendimento do Banco do Brasil',
    beneficiario: { nome: String(emit.razao || emit.nome || '').toUpperCase(), doc: B.docFmt(emit.cnpj), endereco: B.enderecoLinhas(emit.endereco) },
    agenciaCodigo: String(cfg.agencia || '').trim() + '/' + String(cfg.conta || '').trim(),
    pagador: { nome: String(pg.nome || '').toUpperCase(), doc: B.docFmt(b.doc),
      endereco: [String(pg.endereco || '').toUpperCase(), [cep ? 'CEP: ' + cep : '', [pg.cidade, pg.uf].filter(Boolean).join(' - ')].filter(Boolean).join(', ').toUpperCase()].filter(Boolean) },
    pix: null,
    instrucoes: B.instrucoes({ juros_mes_pct: Number(Number((b.juros || {}).tipo) === 2 ? b.juros.pct : 0), multa_pct: Number(Number((b.multa || {}).tipo) === 2 ? b.multa.pct : 0) }, r2(b.valor), String(b.vencimento).slice(0, 10)),
    simulacao: false
  };
}
export function pdfBoletos(jsPDF, B, envio, { cfg, emit, hoje, aviso }) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  envio.itens.forEach((x, i) => {
    if (i) pdf.addPage();
    B.desenha(pdf, dadosDoBoleto(B, cfg, emit, x, hoje), { aviso: aviso || '', cobrado: { encargos: x.encargos, total: x.total, faixa: faixaPdf(x, hoje) } });
  });
  return pdf.output('arraybuffer');
}
