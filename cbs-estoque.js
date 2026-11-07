/* CRM Sistemi Dalessi — Estoque de abertura para o crédito presumido de CBS (07/11/2026, pedido do Anderson a partir
   de um reel; avaliação em sistemi-dalessi/docs/avaliacoes/2026-11-07-…).
   Em 01/01/2027 o PIS/COFINS acabam e nasce a CBS. Quem está no regime regular da CBS pode apropriar crédito presumido
   sobre o estoque existente em 01/01/2027 (LC 214/2025, art. 381; Decreto 12.955/2026, arts. 605 a 611):
   - 9,25% do valor do estoque para o bem nacional (importado: o PIS/COFINS-Importação pago) — art. 381, § 3º;
   - só nos casos do caput: regime cumulativo em 31/12/2026 (não é o nosso: a OneClean é Lucro Real), bens com ST ou
     MONOFÁSICOS de PIS/COFINS (Lei 10.147/2000, art. 1º, I: perfumaria, toucador e higiene pessoal) e a parcela com
     vedação parcial de crédito;
   - fora: alíquota zero, isenção, suspensão ou não incidência na compra; uso e consumo; imobilizado e imóveis (§ 1º);
   - inventário em 31/12/2026, uma vez só, pelo custo de aquisição das regras do IRPJ, no Livro de Inventário com
     quantidade, valor unitário, NCM e descrição de cada item (Decreto, arts. 606, 608 a 610);
   - apurar e apropriar até 30/06/2027; usar em 12 parcelas mensais, só contra a CBS (§ 4º); devolução de bem do estoque de
     abertura estorna o crédito (art. 611); o direito extingue em 5 anos (art. 383).
   No Lucro Real a compra normal (CST 01) já deu crédito de PIS/COFINS, então o que entra é o que NÃO gerou crédito na
   compra: monofásicos (o fornecedor vende com CST 02/03/04) e ST (CST 05). A classificação aqui é SUGESTÃO pelo que as
   notas dizem; quem valida item a item e decide a apropriação é o contador (Fiscontasp).
   Parte pura no começo (testes/cbs-estoque.test.js); a seção da tela Fiscal vem depois. */
(function (raiz) {
  'use strict';

  const PERCENTUAL = 9.25;
  // Lei 10.147/2000, art. 1º, I, "b": posições 33.03 a 33.07 (exceto 33.06), 3401.11.90 (exceto o Ex 01), 3401.20.10 e 9603.21.00.
  const MONOFASICO_NCM = [/^330[3457]/, /^34011190$/, /^34012010$/, /^96032100$/];
  // Alíquota zero conhecida na linha da OneClean: papel higiênico 4818.10.00 (Lei 10.925/2004, art. 1º, XXVIII; fiscal.js).
  const ZERO_NCM = [/^48181000$/];
  const CST = { '01': 'tributada (alíquota básica)', '02': 'alíquota diferenciada (monofásico, do fabricante)', '03': 'alíquota por unidade (monofásico)',
    '04': 'monofásico, revenda a alíquota zero', '05': 'substituição tributária', '06': 'alíquota zero', '07': 'isenta', '08': 'sem incidência',
    '09': 'suspensão', '49': 'outras operações de saída (sem receita)', '99': 'outras operações' };
  const GRUPOS = [
    ['presumido', 'Crédito presumido', 'sem crédito de PIS/COFINS na compra: monofásico ou ST'],
    ['credito', 'Já deu crédito', 'PIS/COFINS normal na compra (Lucro Real): fora'],
    ['zero', 'Alíquota zero / isento', 'sem PIS/COFINS na compra: fora'],
    ['conferir', 'A conferir', 'sem nota de compra no CRM ou sinais que não batem'],
    ['negativo', 'Saldo negativo', 'acertar o estoque antes do inventário']
  ];
  const nomeGrupo = g => (GRUPOS.find(x => x[0] === g) || [])[1] || g;
  const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
  const r2 = v => Math.round(num(v) * 100) / 100;
  const ncmDe = l => String(l.ncm || l.compra_ncm || '').replace(/\D/g, '');
  const ehMonofasico = ncm => !!ncm && MONOFASICO_NCM.some(re => re.test(ncm));
  const ehZeroNcm = ncm => !!ncm && ZERO_NCM.some(re => re.test(ncm));
  const textoCst = c => (c ? 'CST ' + c + (CST[c] ? ' (' + CST[c] + ')' : '') : '');

  // Classificação de um produto do inventário: { grupo, como, motivo }. Ordem dos sinais: o CST de PIS/COFINS que o
  // fornecedor usou na última nota de compra (o mais seguro); o NCM (lista da Lei 10.147 e o papel higiênico); o CST da
  // nossa venda (regra fiscal). Sinais que se contradizem viram "conferir", nunca uma escolha calada.
  function classifica(l) {
    if (num(l.saldo) < 0) return { grupo: 'negativo', como: '', motivo: 'saldo negativo no CRM: vendido sem entrada' };
    const ncm = ncmDe(l), mono = ehMonofasico(ncm), zero = ehZeroNcm(ncm);
    const cst = String(l.pis_cst || l.cofins_cst || '').padStart(l.pis_cst || l.cofins_cst ? 2 : 0, '0');
    if (cst) {
      if (cst === '01') {
        if (mono) return { grupo: 'conferir', como: 'CST da compra × NCM', motivo: 'o NCM é monofásico (Lei 10.147), mas o fornecedor cobrou PIS/COFINS normal (CST 01)' };
        return { grupo: 'credito', como: 'CST da compra', motivo: textoCst(cst) };
      }
      if (cst === '02' || cst === '03' || cst === '04') return { grupo: 'presumido', como: 'CST da compra', motivo: textoCst(cst) + (mono ? '' : '; NCM fora da lista da Lei 10.147: conferir') };
      if (cst === '05') return { grupo: 'presumido', como: 'CST da compra', motivo: textoCst(cst) };
      if (cst === '06' || cst === '07' || cst === '08' || cst === '09') return { grupo: 'zero', como: 'CST da compra', motivo: textoCst(cst) };
      if (cst === '49') return { grupo: 'conferir', como: 'CST da compra', motivo: 'última nota sem receita (bonificação ou remessa, CST 49): ver a compra anterior' };
    }
    if (mono) return { grupo: 'presumido', como: 'NCM', motivo: 'NCM da Lei 10.147/2000 (monofásico)' + (cst ? '; compra com ' + textoCst(cst) : '; sem CST de compra no CRM') };
    if (zero) return { grupo: 'zero', como: 'NCM', motivo: 'papel higiênico 4818.10.00 (alíquota zero, Lei 10.925/2004)' + (cst ? '; compra com ' + textoCst(cst) : '') };
    const venda = String(l.venda_cst_pis || l.venda_cst_cofins || '');
    if (venda === '04') return { grupo: 'presumido', como: 'CST da venda', motivo: 'vendemos com CST 04 (revenda de monofásico); sem nota de compra no CRM' };
    if (venda === '06') return { grupo: 'zero', como: 'CST da venda', motivo: 'vendemos com CST 06 (alíquota zero); sem nota de compra no CRM' };
    if (venda === '01') return { grupo: 'credito', como: 'CST da venda', motivo: 'vendemos com CST 01 (tributado normal) e sem nota de compra no CRM: a compra em geral deu crédito' };
    return { grupo: 'conferir', como: '', motivo: cst ? 'compra com ' + textoCst(cst) : 'sem nota de compra no CRM e sem regra fiscal de venda' };
  }

  // Linhas do banco (crm_cbs_inventario) → linhas classificadas, em ordem alfabética de descrição.
  function monta(linhas) {
    return (linhas || []).map(l => Object.assign({}, l, { saldo: num(l.saldo), custo_medio: l.custo_medio == null ? null : num(l.custo_medio), valor: r2(l.valor), ncm: ncmDe(l) || null }, classifica(l)))
      .sort((a, b) => String(a.descricao || '').localeCompare(String(b.descricao || ''), 'pt-BR'));
  }

  // Totais por grupo (número e lista sempre batem: a lista vem das mesmas linhas) e o crédito presumido estimado.
  function resume(linhas) {
    const g = {};
    GRUPOS.forEach(x => { g[x[0]] = { n: 0, valor: 0 }; });
    (linhas || []).forEach(l => { const t = g[l.grupo] || (g[l.grupo] = { n: 0, valor: 0 }); t.n++; t.valor = r2(t.valor + (l.saldo > 0 ? l.valor : 0)); });
    const total = r2((linhas || []).reduce((s, l) => s + (l.saldo > 0 ? l.valor : 0), 0));
    return { grupos: g, total, base: g.presumido.valor, credito: r2(g.presumido.valor * PERCENTUAL / 100), percentual: PERCENTUAL,
      semCompra: (linhas || []).filter(l => !l.compra_numero && l.saldo > 0).length, semCst: (linhas || []).filter(l => l.compra_numero && !l.pis_cst && l.saldo > 0).length };
  }

  // Totais por NCM (para o contador: o Livro de Inventário é por item, mas a conferência dele é por classificação fiscal).
  function porNcm(linhas) {
    const m = new Map();
    (linhas || []).forEach(l => {
      if (l.saldo <= 0) return;
      const k = l.ncm || '(sem NCM)', t = m.get(k) || { ncm: k, n: 0, valor: 0, presumido: 0 };
      t.n++; t.valor = r2(t.valor + l.valor); if (l.grupo === 'presumido') t.presumido = r2(t.presumido + l.valor);
      m.set(k, t);
    });
    return [...m.values()].sort((a, b) => a.ncm.localeCompare(b.ncm));
  }

  const dataBR = v => (v ? String(v).slice(8, 10) + '/' + String(v).slice(5, 7) + '/' + String(v).slice(0, 4) : '');
  // CSV para o contador: um produto por linha, com tudo que a classificação usou.
  function csv(linhas, data) {
    const cab = ['Código', 'Produto', 'Unidade', 'NCM', 'CEST', 'Origem', 'Linha', 'Saldo em ' + dataBR(data), 'Custo médio', 'Valor a custo',
      'Classificação', 'Pelo quê', 'Motivo', 'Crédito presumido (9,25%)', 'Última compra NF', 'Data da compra', 'Fornecedor', 'NCM na compra', 'CFOP do fornecedor',
      'Custo unitário na compra', 'CST PIS compra', 'Alíq. PIS compra', 'CST COFINS compra', 'Alíq. COFINS compra', 'CST PIS venda', 'CST COFINS venda', 'Compra achada por'];
    const l = (linhas || []).map(x => [x.codigo, x.descricao || '', x.unidade || '', x.ncm || '', x.cest || '', x.origem == null ? '' : x.origem, x.linha || '', x.saldo,
      x.custo_medio == null ? '' : x.custo_medio, x.valor, nomeGrupo(x.grupo), x.como || '', x.motivo || '', x.grupo === 'presumido' ? r2(x.valor * PERCENTUAL / 100) : '',
      x.compra_numero || '', x.compra_em ? dataBR(x.compra_em) : '', x.fornecedor || '', x.compra_ncm || '', x.compra_cfop || '', x.compra_custo == null ? '' : num(x.compra_custo),
      x.pis_cst || '', x.pis_aliq == null ? '' : num(x.pis_aliq), x.cofins_cst || '', x.cofins_aliq == null ? '' : num(x.cofins_aliq), x.venda_cst_pis || '', x.venda_cst_cofins || '', x.compra_como || '']);
    return { cabecalho: cab, linhas: l };
  }

  // Itens de uma nota de compra lida do XML (nfe.js lerXml) → o PIS/COFINS de cada item, para completar os gravados sem ele.
  function pisDosItens(d, chave) {
    return ((d && d.itens) || []).map(it => { const f = it.fiscal || {}; return { chave, ordem: it.ordem, pis_cst: f.cst_pis || null, pis_aliq: f.aliq_pis == null ? null : f.aliq_pis,
      pis_valor: f.v_pis == null ? null : f.v_pis, cofins_cst: f.cst_cofins || null, cofins_aliq: f.aliq_cofins == null ? null : f.aliq_cofins, cofins_valor: f.v_cofins == null ? null : f.v_cofins }; })
      .filter(x => x.pis_cst);
  }

  const api = { PERCENTUAL, GRUPOS, CST, classifica, monta, resume, porNcm, csv, pisDosItens, ehMonofasico, nomeGrupo };
  raiz.CRMCbs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ------------------------------------------------------------ seção da tela Fiscal (só administrador; a função do banco deixa a gestora)
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, C = raiz.CRMCbs, R = raiz.CRMRegras, N = raiz.CRMNfe;
  if (!CRM || !CRM.telas) return;
  const esc = CRM.esc;
  const DATA_INVENTARIO = '2026-12-31';
  const st = { data: null, linhas: null, carregando: false, rodando: '', busca: '', mostrar: 'todos', semPis: null, buscandoPis: false };
  const dataPadrao = () => (R.hojeISO() >= DATA_INVENTARIO ? DATA_INVENTARIO : R.hojeISO());
  const dataBR = v => (v ? String(v).slice(8, 10) + '/' + String(v).slice(5, 7) + '/' + String(v).slice(0, 4) : '');
  const qtd = v => String(+Number(v).toFixed(3)).replace('.', ',');

  async function levantar() {
    if (st.carregando) return;
    st.carregando = true; st.linhas = null; CRM.render();
    try {
      const [l, sem] = await Promise.all([CRM.store().cbsInventario(st.data), CRM.store().comprasSemPis().catch(() => [])]);
      st.linhas = C.monta(l); st.semPis = sem;
    } catch (e) { st.linhas = []; CRM.falhou(e); }
    st.carregando = false; CRM.render();
  }
  // Notas de compra gravadas antes de 07/11/2026: relê o XML guardado e completa o PIS/COFINS dos itens (só o vazio).
  async function completarPis() {
    const store = CRM.store(), chaves = (await store.comprasSemPis()).slice(), lista = [];
    let semXml = 0, feitas = 0;
    const andamento = () => { st.rodando = 'Lendo as notas guardadas: ' + feitas + ' de ' + (feitas + chaves.length) + '…'; const el = document.getElementById('cbsAndamento'); if (el) el.textContent = st.rodando; };
    andamento();
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let c; (c = chaves.shift());) {
        let xml = null;
        try { xml = await store.dfeXml(c); } catch (e) { xml = null; }
        feitas++;
        if (!xml) { semXml++; andamento(); continue; }
        try { lista.push(...C.pisDosItens(N.lerXml(xml), c)); } catch (e) { semXml++; }
        andamento();
      }
    }));
    let n = 0;
    for (let i = 0; i < lista.length; i += 500) n += (await store.compraItensPis(lista.slice(i, i + 500))) || 0;
    return { completados: n, semXml };
  }

  function filtradas() {
    const b = R.normaliza(st.busca || '');
    return (st.linhas || []).filter(l => (st.mostrar === 'todos' || l.grupo === st.mostrar) &&
      (!b || R.normaliza([l.codigo, l.descricao, l.ncm, l.fornecedor].join(' ')).indexOf(b) !== -1));
  }
  function linhaHtml(l) {
    const cor = l.grupo === 'presumido' ? 'verde' : l.grupo === 'conferir' || l.grupo === 'negativo' ? 'ambar' : 'cinza';
    return '<tr><td><strong>' + esc(l.descricao || l.codigo) + '</strong><small>' + esc(l.codigo) + (l.linha ? ' · ' + esc(l.linha) : '') + '</small></td>' +
      '<td>' + esc(l.ncm ? l.ncm.slice(0, 4) + '.' + l.ncm.slice(4, 6) + '.' + l.ncm.slice(6) : '—') + '</td>' +
      '<td class="num">' + esc(qtd(l.saldo)) + ' ' + esc(l.unidade || '') + '</td><td class="num">' + (l.custo_medio == null ? '—' : esc(R.moeda(l.custo_medio))) + '</td><td class="num">' + esc(R.moeda(l.valor)) + '</td>' +
      '<td>' + (l.compra_numero ? 'NF ' + esc(l.compra_numero) + ' ' + esc(dataBR(l.compra_em)) + '<small>' + esc(l.fornecedor || '') + ' · ' + esc(l.compra_como || '') + '</small>' : '<small>sem compra no CRM</small>') + '</td>' +
      '<td>' + (l.pis_cst ? esc(l.pis_cst + '/' + (l.cofins_cst || '—')) : '—') + (l.venda_cst_pis ? '<small>venda ' + esc(l.venda_cst_pis) + '</small>' : '') + '</td>' +
      '<td>' + CRM.selo(C.nomeGrupo(l.grupo), cor) + '<small>' + esc((l.como ? 'pelo ' + l.como + ': ' : '') + l.motivo) + '</small></td></tr>';
  }

  // Quantas notas ainda estão sem o PIS/COFINS lido: busca ao abrir a tela, para o botão "Ler o PIS/COFINS" aparecer antes
  // do levantamento (07/11/2026: o Anderson abriu a seção e não achou o botão, que só vinha depois de "Levantar o estoque").
  function buscaSemPis() {
    if (st.semPis !== null || st.buscandoPis) return;
    st.buscandoPis = true;
    setTimeout(async () => {
      try { st.semPis = await CRM.store().comprasSemPis(); } catch (e) { st.semPis = []; }
      st.buscandoPis = false; CRM.render();
    }, 0);
  }
  function secaoFiscal() {
    if (st.data === null) st.data = dataPadrao();
    buscaSemPis();
    const r = st.linhas ? C.resume(st.linhas) : null, l = st.linhas ? filtradas() : [];
    const kpi = (g, nome, sub) => { const t = r.grupos[g] || { n: 0, valor: 0 }; return '<button type="button" class="kpi clicavel' + (st.mostrar === g ? ' ativo' : '') + (g === 'presumido' ? ' verde' : '') + '" data-acao="cbs-mostrar" data-id="' + g + '"><span>' + esc(nome) + '</span><strong>' + t.n + '</strong><small>' + esc(R.moeda(t.valor) + ' · ' + sub) + '</small></button>'; };
    return '<section class="cartao"><h2>5. Estoque de abertura para o crédito de CBS <small>LC 214/2025, art. 381 · Decreto 12.955/2026, arts. 605 a 611 · inventário de 31/12/2026</small></h2>' +
      '<p>Em 01/01/2027 o PIS/COFINS acabam. O estoque que <strong>não gerou crédito</strong> de PIS/COFINS na compra (monofásicos de higiene e perfumaria, ST) dá <strong>crédito presumido de CBS de 9,25%</strong> do valor, ' +
      'apropriado até 30/06/2027 e usado em 12 parcelas só contra a CBS. No Lucro Real a compra normal (CST 01) já deu crédito e fica fora; alíquota zero (papel higiênico), isento e uso e consumo também. ' +
      'A classificação abaixo é <strong>sugestão</strong> pelo CST das notas de compra, pelo NCM e pela nossa venda: quem valida item a item e decide a apropriação é o contador.</p>' +
      '<p class="acoes"><label class="campo">Posição em <input type="date" value="' + esc(st.data) + '" max="' + esc(DATA_INVENTARIO) + '" data-cbs-data></label>' +
      '<button type="button" class="btn" data-acao="cbs-levantar"' + (st.carregando ? ' disabled' : '') + '>' + (st.carregando ? 'Levantando…' : 'Levantar o estoque') + '</button>' +
      (st.linhas && st.linhas.length ? '<button type="button" class="btn sec" data-acao="cbs-csv">Exportar para o contador (CSV)</button>' : '') +
      (st.semPis && st.semPis.length ? '<button type="button" class="btn sec" data-acao="cbs-completar"' + (st.rodando ? ' disabled' : '') + ' title="Notas de compra gravadas antes de 07/11/2026: relê o XML guardado e completa o CST de PIS/COFINS dos itens">Ler o PIS/COFINS de ' + st.semPis.length + ' notas guardadas</button>' : '') + '</p>' +
      (st.rodando ? '<p class="dica" id="cbsAndamento">' + esc(st.rodando) + '</p>' : '') +
      (!st.linhas ? (st.carregando ? '<p class="vazio">Carregando…</p>' : '<p class="dica">Hoje serve para testar; no fechamento, a data é 31/12/2026 (fim do dia). O custo é o médio do CRM (valor pago na nota: com ICMS, IPI, ST e frete, sem tirar créditos); o contador ajusta à regra do IRPJ se precisar.</p>')
        : !st.linhas.length ? '<p class="vazio">Nenhum produto com saldo nessa data.</p>'
        : '<div class="kpis">' + kpi('presumido', 'Crédito presumido', 'sem crédito na compra') + kpi('credito', 'Já deu crédito', 'fora') + kpi('zero', 'Alíquota zero / isento', 'fora') +
          kpi('conferir', 'A conferir', 'com o contador') + kpi('negativo', 'Saldo negativo', 'acertar antes') +
          '<button type="button" class="kpi clicavel' + (st.mostrar === 'todos' ? ' ativo' : '') + '" data-acao="cbs-mostrar" data-id="todos"><span>Todos</span><strong>' + st.linhas.length + '</strong><small>' + esc(R.moeda(r.total) + ' a custo em ' + dataBR(st.data)) + '</small></button></div>' +
          '<p><strong>Crédito presumido estimado: ' + esc(R.moeda(r.credito)) + '</strong> (9,25% de ' + esc(R.moeda(r.base)) + ' do grupo "Crédito presumido"). ' +
          (r.semCompra ? r.semCompra + ' produto(s) sem nota de compra no CRM (classificados pelo NCM ou pela venda). ' : '') +
          (r.semCst ? r.semCst + ' com compra sem o CST de PIS/COFINS lido: clique em "Ler o PIS/COFINS". ' : '') + '</p>' +
          '<p class="acoes"><input type="search" placeholder="Procurar produto, código, NCM ou fornecedor" value="' + esc(st.busca) + '" data-cbs-busca class="of-busca"></p>' +
          (l.length ? '<div class="tabela-rolagem"><table class="tabela fi-tabela"><thead><tr><th>Produto</th><th>NCM</th><th>Saldo</th><th>Custo médio</th><th>Valor</th><th>Última compra</th><th>PIS/COFINS</th><th>Classificação</th></tr></thead><tbody>' +
            l.slice(0, 300).map(linhaHtml).join('') + '</tbody></table></div>' + (l.length > 300 ? '<p class="dica">Mostrando 300 de ' + l.length + '; use a busca ou o CSV.</p>' : '')
            : '<p class="vazio">Nada aqui. 👍</p>')) + '</section>';
  }

  CRM.cbs = {
    secaoFiscal,
    depois(c) {
      const d = c.querySelector('[data-cbs-data]');
      if (d) d.addEventListener('change', () => { if (d.value) { st.data = d.value; st.linhas = null; } });
      const b = c.querySelector('[data-cbs-busca]');
      if (b) b.addEventListener('input', () => { st.busca = b.value; CRM.render(); });
    }
  };
  Object.assign(CRM.acoes, {
    'cbs-levantar': () => { levantar(); },
    'cbs-mostrar': id => { st.mostrar = id; CRM.render(); },
    'cbs-csv': () => {
      const f = C.csv(st.linhas || [], st.data);
      CRM.baixarCSV('inventario-cbs-' + st.data, f.cabecalho, f.linhas);
      const n = C.porNcm(st.linhas || []);
      CRM.baixarCSV('inventario-cbs-por-ncm-' + st.data, ['NCM', 'Produtos', 'Valor a custo', 'Valor no grupo crédito presumido', 'Crédito presumido (9,25%)'],
        n.map(x => [x.ncm, x.n, x.valor, x.presumido, Math.round(x.presumido * C.PERCENTUAL) / 100]));
    },
    'cbs-completar': async () => {
      if (st.rodando) return;
      st.rodando = 'Lendo as notas guardadas…'; CRM.render();
      try {
        const r = await completarPis();
        CRM.toast(r.completados + ' item(ns) de compra com o PIS/COFINS lido' + (r.semXml ? '; ' + r.semXml + ' nota(s) sem XML guardado' : '') + '.');
        st.rodando = ''; await levantar();
      } catch (e) { CRM.falhou(e); st.rodando = ''; CRM.render(); }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
