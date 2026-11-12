/* CRM Sistemi Dalessi — Comparar fornecedores (12/11/2026, pedido do Anderson: "de quem é mais vantajoso comprar o mesmo
   material: fornecedor do Simples Nacional × Lucro Real × Lucro Presumido, sendo a OneClean do Lucro Real e havendo
   produto com substituição tributária; profissional e exata").

   O preço da cotação não é o custo. O custo de verdade para uma empresa do Lucro Real é o que sai do caixa MENOS os
   créditos que a compra gera (ICMS na apuração do mês; PIS e COFINS não cumulativos). As regras usadas, com a lei de
   cada uma (a explicação inteira com as fontes fica em docs/oneclean/fiscal/comparar-fornecedores.md, no repositório da
   Sistemi Dalessi):

   1. PIS/COFINS (Leis 10.637/2002 e 10.833/2003, art. 3º): crédito de 1,65% + 7,6% sobre o custo de aquisição de
      mercadoria para revenda, QUALQUER que seja o regime do fornecedor — também do Simples (ADI RFB 15/2007) e do
      Presumido. Por isso, para quem compra, Lucro Real e Lucro Presumido dão o MESMO resultado: muda só o que a nota traz.
      - Fora da base: o ICMS destacado na nota (Lei 14.592/2023, art. 3º §2º III; STJ Tema 1364), o ICMS-ST pago ao
        fornecedor substituto (STJ Tema 1231, REsp 2.072.621) e o IPI não recuperável (IN RFB 2.121/2022, art. 170, II).
      - Sem crédito: produto monofásico ou de alíquota zero na revenda (CST 04 e 06 na venda da OneClean; art. 3º, I, b,
        e §2º, II).
   2. ICMS (LC 87/1996, arts. 19 e 20): crédito do ICMS destacado pelo fornecedor do regime normal (Real ou Presumido).
      Do Simples, só o valor do campo de crédito da nota (pCredSN / vCredICMSSN, CSOSN 101 e 201; LC 123/2006, art. 23).
      - Produto com ST na venda da OneClean (CST 60): nenhum crédito — a ST já encerrou o imposto; o ICMS-ST pago é custo.
      - Venda com base reduzida (CST 20): o crédito fica limitado à carga da saída (estorno proporcional; LC 87, art. 21, e
        RICMS-SP, art. 67).
   3. IPI: a OneClean é comércio e não recupera o IPI: é custo.
   4. Prazo: o pagamento é trazido a valor presente pela taxa do dinheiro (% ao mês, juros compostos); os créditos entram
      na apuração do mês da compra e ficam pelo valor cheio (mesma data para todos os fornecedores).
   5. % de aproveitamento: a OneClean está acumulando créditos (Anderson, 06/11/2026). Crédito que não se usa não vale o
      valor cheio; o comprador põe quanto do crédito vira dinheiro de fato (100% = usa tudo).

   A partir de 2027 (CBS/IBS, LC 214/2025, arts. 155 e 156) a compra de fornecedor do Simples dá crédito só do que ele
   recolhe no DAS, salvo se ele optar pelo regime regular: a conta muda e a tela avisa.

   Parte pura no começo (testes/comparar-fornecedores.test.js). */
(function (raiz) {
  'use strict';

  const ALIQ_PIS = 1.65, ALIQ_COFINS = 7.6;
  const REGIMES = [['real', 'Lucro Real'], ['presumido', 'Lucro Presumido'], ['simples', 'Simples Nacional'], ['mei', 'MEI']];
  const nomeRegime = r => (REGIMES.find(x => x[0] === r) || [r, r || '—'])[1];

  // Número digitado do jeito brasileiro: "1.234,56", "0,7345", "12" (ou número). Vazio → 0.
  function dec(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v == null ? '' : v).trim().replace(/[R$\s%]/g, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return isFinite(n) ? n : 0;
  }
  const r2 = v => Math.round(v * 100) / 100;

  // Premissas: aproveitamento (%) dos créditos, taxa do dinheiro (% a.m.) e as duas posições que a lei não fecha.
  function premissas(cfg) {
    const c = cfg || {};
    const p = (v, d) => (v == null || v === '' ? d : Math.max(0, Math.min(100, dec(v))));
    return {
      aprovIcms: p(c.aprovIcms, 100), aprovPis: p(c.aprovPis, 100), taxaMes: Math.max(0, dec(c.taxaMes)),
      // O crédito de ICMS do Simples é ICMS "incidente na aquisição"? Conservador: sai da base do PIS/COFINS (padrão).
      tiraCredSNdaBase: c.tiraCredSNdaBase !== false,
      // IPI na base do crédito de PIS/COFINS: a Receita diz que não (IN 2.121/2022, art. 170, II). Padrão: fora.
      ipiNaBase: c.ipiNaBase === true,
      // ICMS do frete (CT-e) fora da base do crédito sobre o frete, pela mesma regra da Lei 14.592. Padrão: fora.
      tiraIcmsFreteDaBase: c.tiraIcmsFreteDaBase !== false
    };
  }

  // O produto pela venda da OneClean (regra fiscal do CRM: regra.venda). → { st, pisCredito, limiteIcms }
  // st: a venda sai com ICMS-ST retido (CST 60) → a compra não dá crédito de ICMS.
  // pisCredito: a venda é tributada (CST 01) → a compra dá crédito; 04 (monofásico) e 06 (alíquota zero) não; 02 conferir.
  // limiteIcms: CST 20 (base reduzida) → crédito até a carga efetiva da saída (% sobre o valor), se a regra disser.
  function produtoPelaVenda(venda) {
    const v = venda || {};
    const cst = String(v.cst_icms || '').padStart(2, '0').slice(-2), pis = String(v.cst_pis || '').padStart(2, '0');
    const out = { st: ['60', '10', '30', '70'].includes(cst), pisCredito: !['04', '05', '06', '07', '08', '09'].includes(pis),
      limiteIcms: null, cstIcms: v.cst_icms || null, cstPis: v.cst_pis || null, conferir: [] };
    if (pis === '02' || pis === '03') out.conferir.push('PIS/COFINS da venda com alíquota diferenciada (CST ' + pis + '): confira com o contador se a compra dá crédito.');
    if (!v.cst_icms) out.conferir.push('Produto sem regra fiscal de venda no CRM: marque à mão se tem ST e se dá crédito de PIS/COFINS.');
    if (cst === '20') {
      const aliq = dec(v.aliq_icms), red = dec(v.red_bc_icms != null ? v.red_bc_icms : v.red_bc);
      if (aliq > 0 && red > 0) {
        out.limiteIcms = r2(aliq * (1 - red / 100) * 100) / 100;
        out.conferir.push('Venda com base reduzida (CST 20, carga de ' + String(r2(out.limiteIcms)).replace('.', ',') + '%): o crédito de ICMS foi limitado a essa carga (estorno proporcional). Se o benefício dispensar o estorno, o contador confirma e você apaga o limite.');
      }
      else out.conferir.push('Venda com base reduzida (CST 20): informe a carga efetiva da saída para limitar o crédito de ICMS.');
    }
    return out;
  }

  // Uma cotação. Valores por EMBALAGEM do fornecedor (o que ele cota); "qtd" é quantas unidades nossas vêm nela.
  // cot: { fornecedor, regime, qtd, preco, ipiPct, icmsPct (nota do regime normal), credSNPct (campo de crédito da nota do
  //        Simples), st (R$ de ICMS-ST na nota), stRecolher (R$ de ST que a OneClean recolhe por GARE), frete (R$ pago à
  //        parte pela OneClean, FOB), freteIcmsPct (ICMS do CT-e), prazo (dias) }
  // prod: { st, pisCredito, limiteIcms (% sobre o valor, ou null) }
  function calcular(cot, prod, cfg) {
    const c = cot || {}, p = prod || {}, k = premissas(cfg);
    const regime = c.regime || 'real';
    const normal = regime === 'real' || regime === 'presumido';
    const qtd = dec(c.qtd) > 0 ? dec(c.qtd) : 1;
    const preco = dec(c.preco);
    const ipi = preco * dec(c.ipiPct) / 100;
    const icmsNota = normal ? preco * dec(c.icmsPct) / 100 : 0;
    const credSN = regime === 'simples' ? preco * dec(c.credSNPct) / 100 : 0;
    const st = dec(c.st), stRecolher = dec(c.stRecolher), frete = dec(c.frete);
    const icmsFrete = frete * dec(c.freteIcmsPct) / 100;
    const prazo = Math.max(0, dec(c.prazo));
    const desembolso = preco + ipi + st + stRecolher + frete;

    // ICMS: só o que a lei deixa creditar; com ST na venda, nada (nem o do frete).
    let icmsCredBruto = 0, icmsLimitado = false;
    if (!p.st) {
      icmsCredBruto = (normal ? icmsNota : credSN) + icmsFrete;
      if (p.limiteIcms != null && p.limiteIcms !== '') {
        const teto = (preco + frete) * dec(p.limiteIcms) / 100;
        if (icmsCredBruto > teto) { icmsCredBruto = teto; icmsLimitado = true; }
      }
    }
    const credIcms = icmsCredBruto * k.aprovIcms / 100;

    // PIS/COFINS: base = mercadoria + frete − ICMS da nota (− crédito do Simples) (+ IPI, se marcado) (− ICMS do frete).
    let basePis = 0;
    if (p.pisCredito !== false) {
      basePis = preco - icmsNota - (k.tiraCredSNdaBase ? credSN : 0) + (k.ipiNaBase ? ipi : 0) + frete - (k.tiraIcmsFreteDaBase ? icmsFrete : 0);
      basePis = Math.max(0, basePis);
    }
    const credPisBruto = basePis * ALIQ_PIS / 100, credCofinsBruto = basePis * ALIQ_COFINS / 100;
    const credPis = credPisBruto * k.aprovPis / 100, credCofins = credCofinsBruto * k.aprovPis / 100;
    const creditos = credIcms + credPis + credCofins;

    const fatorVP = k.taxaMes > 0 ? Math.pow(1 + k.taxaMes / 100, prazo / 30) : 1;
    const desembolsoVP = desembolso / fatorVP;
    const liquido = desembolso - creditos, liquidoVP = desembolsoVP - creditos;

    const avisos = [];
    if (regime === 'simples' && !p.st && !dec(c.credSNPct)) avisos.push('Simples sem o campo de crédito na nota (CSOSN 102, 103, 300, 400 ou 500): não dá crédito de ICMS. Pergunte ao fornecedor se a nota sai com CSOSN 101 e o % de crédito.');
    if (regime === 'mei') avisos.push('MEI não destaca ICMS nem dá crédito de ICMS; dá só o crédito de PIS/COFINS.');
    if (p.st && !st && !stRecolher) avisos.push('O produto tem ST na venda da OneClean e a cotação veio sem ST: confira se o fornecedor recolhe a ST na nota ou se a OneClean terá de recolher por GARE (lance em "ST a recolher").');
    if (!p.st && st > 0) avisos.push('O produto não tem ST na venda da OneClean, mas a cotação traz ICMS-ST: a ST não gera crédito e encarece a compra. Confira com o contador (pode ser indevida ou dar ressarcimento).');
    if (ipi > 0) avisos.push('IPI é custo: a OneClean é comércio e não recupera o IPI.');
    if (icmsLimitado) avisos.push('Crédito de ICMS limitado à carga da saída (venda com base reduzida).');
    if (regime === 'simples') avisos.push('Em 2027 (CBS/IBS) a compra de fornecedor do Simples passa a dar crédito só do que ele recolhe no DAS, a não ser que ele opte pelo regime regular: refaça a conta quando a regra valer.');
    if (normal && !p.st && !dec(c.icmsPct)) avisos.push('Cotação do regime normal sem ICMS: confira o % de ICMS que vai sair na nota (em SP, em geral 18%; de outro estado, 12%, 7% ou 4%).');

    const un = v => v / qtd;
    return {
      fornecedor: c.fornecedor || '', regime, regimeNome: nomeRegime(regime), qtd, prazo,
      preco, ipi, icmsNota, credSN, st, stRecolher, frete, icmsFrete, desembolso, fatorVP, desembolsoVP,
      icmsCredBruto, credIcms, basePis, credPisBruto, credCofinsBruto, credPis, credCofins, creditos, liquido, liquidoVP,
      un: { preco: un(preco), desembolso: un(desembolso), desembolsoVP: un(desembolsoVP), credIcms: un(credIcms),
        credPisCofins: un(credPis + credCofins), creditos: un(creditos), liquido: un(liquido), liquidoVP: un(liquidoVP) },
      avisos
    };
  }

  // Preço da embalagem que faria esta cotação empatar com o custo por unidade "alvo" (valor presente). O custo é linear
  // no preço (menos o teto do crédito, que é um "mínimo"): duas aproximações pela inclinação chegam no ponto.
  function precoEmpate(cot, prod, cfg, alvoUn) {
    const f = pr => calcular(Object.assign({}, cot, { preco: pr }), prod, cfg).un.liquidoVP;
    let pr = Math.max(0.01, dec(cot.preco) || 1);
    for (let i = 0; i < 4; i++) {
      const a = f(pr), b = f(pr + 1), incl = b - a;
      if (!(incl > 0)) return null;
      const novo = pr + (alvoUn - a) / incl;
      if (!(novo > 0)) return null;
      if (Math.abs(novo - pr) < 1e-7) break;
      pr = novo;
    }
    return pr;
  }

  // Todas as cotações de um produto, do menor custo líquido (valor presente) por unidade ao maior.
  function comparar(cotacoes, prod, cfg) {
    const lista = (cotacoes || []).filter(c => dec(c.preco) > 0).map((c, i) => Object.assign(calcular(c, prod, cfg), { idx: i, cot: c }));
    lista.sort((a, b) => a.un.liquidoVP - b.un.liquidoVP);
    const melhor = lista[0];
    lista.forEach((x, i) => {
      x.posicao = i + 1;
      x.difUn = melhor ? x.un.liquidoVP - melhor.un.liquidoVP : 0;
      x.difPct = melhor && melhor.un.liquidoVP > 0 ? (x.un.liquidoVP / melhor.un.liquidoVP - 1) * 100 : 0;
      x.empate = i > 0 ? precoEmpate(x.cot, prod, cfg, melhor.un.liquidoVP) : null;
      // O que parece × o que é: o mais barato no preço da cotação nem sempre é o mais barato de verdade.
    });
    const pelaCotacao = lista.slice().sort((a, b) => a.un.preco - b.un.preco)[0];
    return { lista, melhor: melhor || null, enganoso: !!(melhor && pelaCotacao && pelaCotacao !== melhor && pelaCotacao.un.preco < melhor.un.preco) ? pelaCotacao : null };
  }

  // Regime pelo CST/CSOSN do ICMS de uma nota de compra (o XML não diz se é Real ou Presumido: tanto faz para quem compra).
  function regimePeloCst(cst) {
    const s = String(cst || '').trim();
    if (/^[1-9]0[0-9]$/.test(s)) return 'simples';      // CSOSN 101…900
    if (/^\d{2}$/.test(s)) return 'real';                // regime normal (Real ou Presumido)
    return null;
  }

  const CF = { calcular, comparar, precoEmpate, premissas, produtoPelaVenda, regimePeloCst, dec, REGIMES, nomeRegime, ALIQ_PIS, ALIQ_COFINS };
  raiz.CRMCompararFornecedores = CF;
  if (typeof module !== 'undefined') module.exports = CF;

  // ------------------------------------------------------------ tela (Compras → Comparar fornecedores; administrador e comprador)
  const CRM = raiz.CRM;
  if (!CRM || !CRM.telas) return;
  const { esc } = CRM;
  const GUARDA = 'crm_comparar_forn';
  const vazia = () => ({ fornecedor: '', cnpj: '', regime: 'real', qtd: '1', preco: '', ipiPct: '', icmsPct: '18', credSNPct: '', st: '', stRecolher: '', frete: '', freteIcmsPct: '', prazo: '28' });
  let est = null, lista = null;
  const novoEstado = () => ({ codigo: '', prod: null, trib: { st: false, pisCredito: true, limiteIcms: '' }, conferir: [],
    cfg: { aprovIcms: '100', aprovPis: '100', taxaMes: '0', tiraCredSNdaBase: true, ipiNaBase: false, tiraIcmsFreteDaBase: true }, cots: [vazia(), vazia()] });
  function le() { if (est) return est; try { est = JSON.parse(localStorage.getItem(GUARDA) || 'null'); } catch (e) { est = null; } if (!est || !Array.isArray(est.cots)) est = novoEstado(); return est; }
  function guarda() { try { localStorage.setItem(GUARDA, JSON.stringify(est)); } catch (e) { /* sem armazenamento: segue sem lembrar */ } }
  const fmt = (v, casas) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const rs = v => (v == null || !isFinite(v) ? '—' : (v < 0 ? '− ' : '') + 'R$ ' + fmt(Math.abs(v), Math.abs(v) < 10 ? 4 : 2));
  const rs2 = v => (v == null || !isFinite(v) ? '—' : (v < 0 ? '− ' : '') + 'R$ ' + fmt(Math.abs(v), 2));
  const pc = v => fmt(v, 1) + '%';
  const trib = () => ({ st: !!est.trib.st, pisCredito: est.trib.pisCredito !== false, limiteIcms: String(est.trib.limiteIcms || '').trim() === '' ? null : dec(est.trib.limiteIcms) });
  const un = () => (est.prod && est.prod.unidade) || 'unidade';

  async function carregaLista() {
    if (lista) return;
    lista = [];
    try { lista = (await CRM.store().estoque()).filter(x => !/\.\d+$/.test(x.codigo) && x.situacao !== 'INATIVO'); } catch (e) { /* a busca por código segue funcionando */ }
    CRM.render();
  }

  function campo(i, nome, valor, extra) {
    return '<input type="text" inputmode="decimal" class="cf-in' + (extra && extra.largo ? ' cf-largo' : '') + '" data-cf="' + nome + '" data-i="' + i + '" value="' + esc(valor == null ? '' : valor) + '"' +
      (extra && extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : '') + (extra && extra.off ? ' disabled' : '') + (extra && extra.titulo ? ' title="' + esc(extra.titulo) + '"' : '') + '>';
  }

  function linhaCotacao(c, i) {
    const normal = c.regime === 'real' || c.regime === 'presumido';
    return '<tr>' +
      '<td><input type="text" class="cf-in cf-nome" data-cf="fornecedor" data-i="' + i + '" value="' + esc(c.fornecedor) + '" placeholder="Fornecedor ' + (i + 1) + '">' +
        (c.origem ? '<br><small>' + esc(c.origem) + '</small>' : '') + '</td>' +
      '<td><input type="text" class="cf-in cf-cnpj" data-cf="cnpj" data-i="' + i + '" value="' + esc(c.cnpj || '') + '" placeholder="CNPJ"> ' +
        '<button type="button" class="mini" data-acao="cf-receita" data-id="' + i + '" title="Ver na Receita se é do Simples">🔎</button></td>' +
      '<td><select class="cf-in" data-cf="regime" data-i="' + i + '">' + CRM.opcoesHTML(REGIMES, c.regime) + '</select></td>' +
      '<td>' + campo(i, 'qtd', c.qtd, { titulo: 'Quantas unidades nossas (' + un() + ') vêm na embalagem cotada' }) + '</td>' +
      '<td>' + campo(i, 'preco', c.preco, { ph: '0,00' }) + '</td>' +
      '<td>' + campo(i, 'ipiPct', c.ipiPct, { ph: '0' }) + '</td>' +
      '<td>' + (normal ? campo(i, 'icmsPct', c.icmsPct, { ph: '18', titulo: 'ICMS destacado na nota (% sobre o preço)' }) + (c.icmsSugerido ? '<br><small class="atrasado">conferir</small>' : '')
        : c.regime === 'simples' ? campo(i, 'credSNPct', c.credSNPct, { ph: '0', titulo: 'Crédito de ICMS que a nota do Simples informa (pCredSN, CSOSN 101). Sem o campo: 0.' }) + (c.credSNAviso ? '<br><small class="atrasado">' + esc(c.credSNAviso) + '</small>' : '')
        : '<small>não tem</small>') + '</td>' +
      '<td>' + campo(i, 'st', c.st, { ph: '0,00', titulo: 'ICMS-ST cobrado na nota, em R$ por embalagem' }) + '</td>' +
      '<td>' + campo(i, 'stRecolher', c.stRecolher, { ph: '0,00', titulo: 'ST que a OneClean recolhe por GARE (fornecedor de fora sem a ST na nota), R$ por embalagem' }) + '</td>' +
      '<td>' + campo(i, 'frete', c.frete, { ph: '0,00', titulo: 'Frete pago à parte pela OneClean (FOB), R$ por embalagem. Frete já incluso no preço: deixe vazio.' }) + '</td>' +
      '<td>' + campo(i, 'freteIcmsPct', c.freteIcmsPct, { ph: '0', titulo: 'ICMS do CT-e do frete (%)' }) + '</td>' +
      '<td>' + campo(i, 'prazo', c.prazo, { ph: '0' }) + '</td>' +
      '<td><button type="button" class="mini" data-acao="cf-tirar" data-id="' + i + '" title="Tirar este fornecedor">✕</button></td></tr>';
  }

  function memoria(x) {
    const l = [['Preço da embalagem (' + fmt(x.qtd, x.qtd % 1 ? 3 : 0) + ' ' + un() + ')', x.preco]];
    if (x.ipi) l.push(['+ IPI (custo: a OneClean não recupera)', x.ipi]);
    if (x.st) l.push(['+ ICMS-ST na nota (custo)', x.st]);
    if (x.stRecolher) l.push(['+ ST recolhida por GARE (custo)', x.stRecolher]);
    if (x.frete) l.push(['+ Frete à parte', x.frete]);
    l.push(['= Sai do caixa', x.desembolso, 1]);
    if (x.fatorVP !== 1) l.push(['= Sai do caixa, trazido para hoje (' + fmt(x.prazo, 0) + ' dias)', x.desembolsoVP, 1]);
    l.push(['− Crédito de ICMS' + (x.icmsCredBruto && x.credIcms !== x.icmsCredBruto ? ' (' + pc(x.credIcms / x.icmsCredBruto * 100) + ' de ' + rs2(x.icmsCredBruto) + ')' : ''), -x.credIcms]);
    l.push(['   base do PIS/COFINS', x.basePis, 2]);
    l.push(['− Crédito de PIS (1,65%)', -x.credPis]);
    l.push(['− Crédito de COFINS (7,6%)', -x.credCofins]);
    l.push(['= Custo líquido da embalagem' + (x.fatorVP !== 1 ? ' (hoje)' : ''), x.liquidoVP, 1]);
    l.push(['= Custo líquido por ' + un(), x.un.liquidoVP, 1]);
    return '<table class="cf-memoria">' + l.map(([t, v, f]) => '<tr' + (f === 1 ? ' class="cf-total"' : f === 2 ? ' class="cf-base"' : '') + '><td>' + esc(t) + '</td><td class="num">' + (t.indexOf('por ' + un()) > 0 ? rs(v) : rs2(v)) + '</td></tr>').join('') + '</table>';
  }

  function resultadoHTML() {
    const r = comparar(est.cots, trib(), est.cfg);
    if (!r.lista.length) return '<p class="vazio">Preencha o preço de pelo menos um fornecedor.</p>';
    const m = r.melhor, seg = r.lista[1];
    const k = premissas(est.cfg);
    const prazos = new Set(r.lista.map(x => x.prazo));
    let h = '<div class="cf-veredito"><strong>Mais vantajoso: ' + esc(m.fornecedor || 'Fornecedor ' + (m.idx + 1)) + '</strong> (' + esc(m.regimeNome) + ') — custo líquido de ' + rs(m.un.liquidoVP) + ' por ' + esc(un()) +
      (seg ? ', ' + rs(seg.difUn) + ' (' + pc(seg.difPct) + ') abaixo do 2º colocado' : '') + '.</div>';
    if (r.enganoso) h += '<p class="cf-alerta">⚠ ' + esc(r.enganoso.fornecedor || 'Fornecedor ' + (r.enganoso.idx + 1)) + ' tem o menor preço na cotação (' + rs(r.enganoso.un.preco) + ' por ' + esc(un()) +
      '), mas depois dos créditos sai ' + rs(r.enganoso.difUn) + ' mais caro por ' + esc(un()) + '. Para empatar, a embalagem dele teria de custar ' + rs(r.enganoso.empate) + '.</p>';
    if (prazos.size > 1 && !k.taxaMes) h += '<p class="dica">Os prazos são diferentes, mas a taxa do dinheiro está em 0%: o prazo não está pesando na conta. Ponha a taxa em Premissas.</p>';
    h += '<div class="tabela-rolagem"><table class="tabela cf-res"><thead><tr><th>#</th><th>Fornecedor</th><th class="num">Preço da cotação<br><small>por ' + esc(un()) + '</small></th>' +
      '<th class="num">Sai do caixa<br><small>por ' + esc(un()) + '</small></th><th class="num">Crédito de ICMS</th><th class="num">Crédito de PIS + COFINS</th>' +
      '<th class="num">Custo líquido<br><small>' + (k.taxaMes ? 'trazido para hoje' : 'por ' + esc(un())) + '</small></th><th class="num">Diferença</th><th class="num">Preço da embalagem<br><small>para empatar com o 1º</small></th></tr></thead><tbody>' +
      r.lista.map(x => '<tr' + (x === m ? ' class="cf-melhor"' : '') + '><td>' + x.posicao + 'º</td><td><strong>' + esc(x.fornecedor || 'Fornecedor ' + (x.idx + 1)) + '</strong><br><small>' + esc(x.regimeNome) +
        (x.prazo ? ' · ' + fmt(x.prazo, 0) + ' dias' : ' · à vista') + '</small></td>' +
        '<td class="num">' + rs(x.un.preco) + '</td><td class="num">' + rs(x.un.desembolso) + '</td><td class="num">' + rs(x.un.credIcms) + '</td><td class="num">' + rs(x.un.credPisCofins) + '</td>' +
        '<td class="num"><strong>' + rs(x.un.liquidoVP) + '</strong></td><td class="num">' + (x === m ? '—' : '+' + rs(x.difUn) + '<br><small>+' + pc(x.difPct) + '</small>') + '</td>' +
        '<td class="num">' + (x.empate == null ? '—' : rs(x.empate) + '<br><small>hoje ' + rs(x.preco) + '</small>') + '</td></tr>').join('') + '</tbody></table></div>';
    h += r.lista.map(x => '<details class="cf-det"><summary>' + x.posicao + 'º ' + esc(x.fornecedor || 'Fornecedor ' + (x.idx + 1)) + ': memória de cálculo' + (x.avisos.length ? ' · ' + x.avisos.length + ' aviso(s)' : '') + '</summary>' +
      memoria(x) + (x.avisos.length ? '<ul class="cf-avisos">' + x.avisos.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul>' : '') + '</details>').join('');
    return h;
  }

  function atualizaResultado() { const el = document.getElementById('cfResultado'); if (el) el.innerHTML = resultadoHTML(); }

  CRM.telas.compararforn = {
    render() {
      if (!CRM.ehAdmin() && !CRM.ehComprador()) return '<div class="cartao"><p class="vazio">Esta tela é do administrador e do comprador.</p></div>';
      le();
      if (!lista) setTimeout(carregaLista, 0);
      const p = est.prod, t = est.trib, k = est.cfg;
      const ck = (nome, v, txt, dica) => '<label class="cf-ck"><input type="checkbox" data-cft="' + nome + '"' + (v ? ' checked' : '') + '> ' + esc(txt) + (dica ? ' <small>' + esc(dica) + '</small>' : '') + '</label>';
      const ckCfg = (nome, v, txt, dica) => '<label class="cf-ck"><input type="checkbox" data-cfc="' + nome + '"' + (v ? ' checked' : '') + '> ' + esc(txt) + (dica ? ' <small>' + esc(dica) + '</small>' : '') + '</label>';
      const inCfg = (nome, txt, dica) => '<label class="cf-pr"><span>' + esc(txt) + '</span><input type="text" inputmode="decimal" class="cf-in" data-cfc="' + nome + '" value="' + esc(k[nome]) + '">' + (dica ? '<small>' + esc(dica) + '</small>' : '') + '</label>';
      return '<div class="cabecalho"><div><h1>Comparar fornecedores</h1><p class="sub">o mesmo produto em fornecedores do Simples, do Lucro Real e do Lucro Presumido · o custo de verdade para a OneClean (Lucro Real) é o que sai do caixa menos os créditos</p></div>' +
          '<span class="flex"></span><button type="button" class="btn sec" data-acao="cf-planilha">Baixar planilha</button><button type="button" class="btn sec" data-acao="cf-limpar">Começar outra</button></div>' +
        '<section class="cartao"><h2>1. Produto</h2><div class="cf-linha"><input type="search" list="cfProdutos" class="of-busca" id="cfCodigo" placeholder="Código ou nome do produto" value="' + esc(est.codigo) + '">' +
          '<datalist id="cfProdutos">' + (lista || []).map(x => '<option value="' + esc(x.codigo) + '">' + esc(x.descricao) + '</option>').join('') + '</datalist>' +
          '<button type="button" class="btn" data-acao="cf-produto">Buscar</button></div>' +
          (p ? '<p><strong>' + esc(p.codigo) + ' · ' + esc(p.descricao) + '</strong> (' + esc(p.unidade || '') + ')' + (p.ncm ? ' · NCM ' + esc(p.ncm) : '') +
            (p.custo_compra ? ' · última compra ' + rs(p.custo_compra) : '') + (p.custo_unit ? ' · custo médio ' + rs(p.custo_unit) : '') + '</p>' +
            (p.compras && p.compras.length ? '<p><button type="button" class="btn sec" data-acao="cf-trazer">Trazer as últimas compras (' + p.compras.length + ' fornecedor' + (p.compras.length > 1 ? 'es' : '') + ')</button> <small>preenche as cotações com o preço, a embalagem, o IPI e a ST da última nota de cada um; confira o ICMS</small></p>' : '')
            : '<p class="dica">Sem produto, a conta funciona do mesmo jeito: marque abaixo como a OneClean vende o item.</p>') +
          '<h3>Como a OneClean vende este produto</h3><div class="cf-grade">' +
          ck('st', t.st, 'Venda com ICMS-ST (CST 60)', 'a compra não dá crédito de ICMS; a ST paga é custo') +
          ck('pisCredito', t.pisCredito !== false, 'Venda tributada no PIS/COFINS (CST 01)', 'desmarque se for monofásico (04) ou alíquota zero (06): sem crédito') +
          '<label class="cf-pr"><span>Crédito de ICMS limitado a (% do valor)</span><input type="text" inputmode="decimal" class="cf-in" data-cft="limiteIcms" value="' + esc(t.limiteIcms == null ? '' : t.limiteIcms) + '" placeholder="sem limite"><small>só na venda com base reduzida (CST 20): a carga da saída</small></label></div>' +
          (est.conferir && est.conferir.length ? '<ul class="cf-avisos">' + est.conferir.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul>' : '') + '</section>' +
        '<section class="cartao"><h2>2. Cotações</h2><p class="dica">Valores por embalagem do fornecedor, como ele cota. "Vem na embalagem" = quantas ' + esc(un()) + ' vêm nela (ex.: caixa com 12 = 12). Real e Presumido dão o mesmo resultado: muda só o ICMS que a nota traz.</p>' +
          '<div class="tabela-rolagem"><table class="tabela cf-cot"><thead><tr><th>Fornecedor</th><th>CNPJ</th><th>Regime</th><th>Vem na<br>embalagem</th><th>Preço da<br>embalagem (R$)</th><th>IPI<br>(%)</th>' +
          '<th>ICMS da nota (%)<br><small>Simples: crédito informado</small></th><th>ICMS-ST na<br>nota (R$)</th><th>ST a recolher<br>GARE (R$)</th><th>Frete à<br>parte (R$)</th><th>ICMS do<br>frete (%)</th><th>Prazo<br>(dias)</th><th></th></tr></thead><tbody>' +
          est.cots.map(linhaCotacao).join('') + '</tbody></table></div><p><button type="button" class="btn sec" data-acao="cf-mais">+ Fornecedor</button></p></section>' +
        '<section class="cartao"><details' + (k.aberto ? ' open' : '') + ' id="cfPrem"><summary><strong>Premissas</strong> <small>aproveitamento dos créditos, taxa do dinheiro e as posições conservadoras</small></summary><div class="cf-grade">' +
          inCfg('aprovIcms', 'Aproveitamento do crédito de ICMS (%)', 'a OneClean está acumulando crédito: o que não se usa não vale cheio') +
          inCfg('aprovPis', 'Aproveitamento do crédito de PIS/COFINS (%)', '100 = usa todo o crédito no mês') +
          inCfg('taxaMes', 'Taxa do dinheiro (% ao mês)', 'traz o prazo a valor presente; ex.: o custo do capital de giro') +
          ckCfg('tiraCredSNdaBase', k.tiraCredSNdaBase !== false, 'Tirar o crédito de ICMS do Simples da base do PIS/COFINS', 'conservador; a lei não fecha a questão') +
          ckCfg('ipiNaBase', k.ipiNaBase === true, 'Pôr o IPI na base do crédito de PIS/COFINS', 'a Receita diz que não (IN 2.121/2022, art. 170)') +
          ckCfg('tiraIcmsFreteDaBase', k.tiraIcmsFreteDaBase !== false, 'Tirar o ICMS do frete da base do crédito sobre o frete', 'mesma regra do ICMS da nota') +
        '</div></details></section>' +
        '<section class="cartao"><h2>3. Resultado</h2><div id="cfResultado">' + resultadoHTML() + '</div></section>' +
        '<section class="cartao"><details><summary><strong>Como o CRM calcula</strong> <small>as regras e a lei de cada uma</small></summary><ul class="cf-regras">' +
          '<li><strong>PIS/COFINS:</strong> a OneClean (Lucro Real, não cumulativo) credita 1,65% + 7,6% sobre a compra para revenda, de qualquer fornecedor — inclusive do Simples (ADI RFB 15/2007). A base é o preço + frete, sem o ICMS destacado (Lei 14.592/2023), sem o ICMS-ST (STJ, Tema 1231) e sem o IPI (IN RFB 2.121/2022, art. 170). Produto monofásico ou de alíquota zero na revenda não dá crédito.</li>' +
          '<li><strong>ICMS:</strong> credita o ICMS destacado pelo fornecedor do regime normal (Real ou Presumido). Do Simples, só o crédito informado na nota (CSOSN 101/201, LC 123/2006, art. 23). Produto com ST na venda não dá crédito. Venda com base reduzida limita o crédito à carga da saída.</li>' +
          '<li><strong>IPI e ST:</strong> custo. A OneClean é comércio: não recupera o IPI, e a ST paga encerra o imposto.</li>' +
          '<li><strong>Real × Presumido:</strong> para quem compra, dá no mesmo. O que muda é o ICMS da nota (estado de origem, benefício) e o preço.</li>' +
          '<li><strong>Prazo:</strong> o pagamento é trazido a valor presente pela taxa do dinheiro; os créditos entram na apuração do mês da compra.</li>' +
          '<li><strong>2027:</strong> com a CBS/IBS, a compra de fornecedor do Simples passa a dar crédito só do que ele recolhe no DAS (LC 214/2025, arts. 155 e 156), salvo se ele optar pelo regime regular.</li>' +
        '</ul></details></section>';
    },
    depois() {
      if (!est) return;
      const muda = el => {
        const i = +el.dataset.i, nome = el.dataset.cf;
        if (!est.cots[i]) return;
        est.cots[i][nome] = el.value;
        if (nome === 'icmsPct') est.cots[i].icmsSugerido = false;
        if (nome === 'credSNPct') est.cots[i].credSNAviso = '';
        guarda();
        if (nome === 'regime') CRM.render(); else atualizaResultado();
      };
      document.querySelectorAll('[data-cf]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => muda(el)));
      document.querySelectorAll('[data-cft]').forEach(el => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        est.trib[el.dataset.cft] = el.type === 'checkbox' ? el.checked : el.value; guarda(); atualizaResultado(); }));
      document.querySelectorAll('[data-cfc]').forEach(el => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        est.cfg[el.dataset.cfc] = el.type === 'checkbox' ? el.checked : el.value; guarda(); atualizaResultado(); }));
      const pr = document.getElementById('cfPrem');
      if (pr) pr.addEventListener('toggle', () => { est.cfg.aberto = pr.open; guarda(); });
      const cod = document.getElementById('cfCodigo');
      if (cod) cod.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); CRM.acoes['cf-produto'](); } });
    }
  };

  Object.assign(CRM.acoes, {
    'cf-produto': async () => {
      const el = document.getElementById('cfCodigo');
      let cod = String(el ? el.value : '').trim();
      if (!cod) { CRM.toast('Digite o código ou o nome do produto.', true); return; }
      if (!/^\d/.test(cod) && lista) {
        const termo = cod.toUpperCase(), ach = lista.filter(x => String(x.descricao || '').toUpperCase().includes(termo));
        if (ach.length === 1) cod = ach[0].codigo;
        else { CRM.toast(ach.length ? ach.length + ' produtos com esse nome: escolha na lista.' : 'Nenhum produto com esse nome.', true); return; }
      }
      if (/^\d{1,5}$/.test(cod)) cod = cod.padStart(6, '0');
      try {
        const p = await CRM.store().compararProduto(cod);
        if (!p) { CRM.toast('Produto ' + cod + ' não encontrado.', true); return; }
        const v = produtoPelaVenda(p.venda);
        est.codigo = p.codigo; est.prod = p;
        est.trib = { st: v.st, pisCredito: v.pisCredito, limiteIcms: v.limiteIcms == null ? '' : String(v.limiteIcms).replace('.', ',') };
        est.conferir = v.conferir;
        guarda(); CRM.render();
      } catch (e) { CRM.falhou(e); }
    },
    'cf-trazer': () => {
      const p = est.prod; if (!p || !p.compras) return;
      const aliq = dec(p.venda && p.venda.aliq_icms) || 18, lim = trib().limiteIcms;
      const novas = p.compras.map(c => {
        const regime = regimePeloCst(c.cst_icms) || 'real', normal = regime === 'real';
        const cs = String(c.cst_icms || '');
        return Object.assign(vazia(), { fornecedor: c.fornecedor || '', cnpj: c.cnpj || '', regime, qtd: String(c.qtd || 1).replace('.', ','),
          preco: String(c.preco || '').replace('.', ','), ipiPct: c.ipi_pct ? String(c.ipi_pct).replace('.', ',') : '', st: c.st ? String(c.st).replace('.', ',') : '',
          icmsPct: normal && !cs.endsWith('60') ? String(cs === '20' && lim != null ? lim : aliq).replace('.', ',') : '', icmsSugerido: normal && !cs.endsWith('60'),
          credSNAviso: regime === 'simples' ? (/^[12]01$/.test(cs) ? 'a nota tem crédito: informe o %' : 'nota sem crédito (CSOSN ' + cs + ')') : '',
          origem: 'NF ' + (c.nota || '') + (c.emitida_em ? ' de ' + String(c.emitida_em).slice(8, 10) + '/' + String(c.emitida_em).slice(5, 7) + '/' + String(c.emitida_em).slice(0, 4) : '') +
            (c.unidade ? ' · ' + c.unidade : '') + (cs ? ' · CST ' + cs : '') });
      });
      const preenchidas = est.cots.filter(c => dec(c.preco) > 0 && !novas.some(n => n.cnpj && n.cnpj === c.cnpj));
      est.cots = preenchidas.concat(novas);
      guarda(); CRM.render();
      CRM.toast(novas.length + ' fornecedor(es) trazidos das notas. Confira o ICMS de cada um e o prazo.');
    },
    'cf-mais': () => { est.cots.push(vazia()); guarda(); CRM.render(); },
    'cf-tirar': i => { est.cots.splice(+i, 1); if (!est.cots.length) est.cots.push(vazia()); guarda(); CRM.render(); },
    'cf-limpar': () => { if (!confirm('Começar outra comparação? As cotações desta saem da tela.')) return; est = novoEstado(); guarda(); CRM.render(); },
    'cf-receita': async i => {
      const c = est.cots[+i]; const doc = String((c && c.cnpj) || '').replace(/\D/g, '');
      if (doc.length !== 14) { CRM.toast('Digite o CNPJ do fornecedor (14 números).', true); return; }
      const st = CRM.store();
      if (!st.consultaReceita) { CRM.toast('A consulta à Receita não está disponível aqui.', true); return; }
      try {
        const r = await st.consultaReceita(doc), d = (r && r.dados) || {};
        if (!c.fornecedor) c.fornecedor = d.nome_fantasia || d.razao_social || '';
        if (d.opcao_pelo_mei === true) c.regime = 'mei';
        else if (d.opcao_pelo_simples === true) c.regime = 'simples';
        else if (d.opcao_pelo_simples === false && (c.regime === 'simples' || c.regime === 'mei')) c.regime = 'real';
        guarda(); CRM.render();
        CRM.toast(d.opcao_pelo_simples == null ? 'A Receita não informou o Simples (fonte ' + (r.fonte || '?') + '): marque à mão.' :
          d.opcao_pelo_mei ? 'MEI.' : d.opcao_pelo_simples ? 'Optante do Simples Nacional.' : 'Fora do Simples: Lucro Real ou Presumido (para a OneClean dá no mesmo).');
      } catch (e) { CRM.falhou(e); }
    },
    'cf-planilha': () => {
      const r = comparar(est.cots, trib(), est.cfg);
      if (!r.lista.length) { CRM.toast('Nada para baixar: preencha os preços.', true); return; }
      const n = v => +Number(v || 0).toFixed(4);
      CRM.baixarCSV('comparar-fornecedores-' + (est.codigo || 'produto'),
        ['Posição', 'Fornecedor', 'CNPJ', 'Regime', 'Vem na embalagem', 'Preço da embalagem', 'IPI', 'ICMS-ST', 'ST GARE', 'Frete', 'Sai do caixa', 'Sai do caixa (hoje)',
          'Crédito ICMS', 'Base PIS/COFINS', 'Crédito PIS', 'Crédito COFINS', 'Custo líquido (hoje)', 'Custo líquido por unidade (hoje)', 'Diferença por unidade', 'Preço para empatar', 'Avisos'],
        r.lista.map(x => [x.posicao, x.fornecedor, x.cot.cnpj || '', x.regimeNome, n(x.qtd), n(x.preco), n(x.ipi), n(x.st), n(x.stRecolher), n(x.frete), n(x.desembolso), n(x.desembolsoVP),
          n(x.credIcms), n(x.basePis), n(x.credPis), n(x.credCofins), n(x.liquidoVP), n(x.un.liquidoVP), n(x.difUn), x.empate == null ? '' : n(x.empate), x.avisos.join(' | ')]));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
