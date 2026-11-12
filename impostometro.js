/* CRM Sistemi Dalessi — Impostômetro (12/11/2026, pedido do Anderson: "na parte que só aparece pra mim, um espaço chamado
   impostômetro, que simula o valor dos impostos um a um e o total, com a maior precisão possível"). Só o administrador.

   A OneClean é do Lucro Real. Os números de cada mês vêm do banco (crm_impostometro): o que as notas de saída destacaram, o
   crédito das notas de compra, as devoluções, as guias do DIFAL e o Caixa. A conta é aqui, testada
   (testes/impostometro.test.js):

   - ICMS (RICMS-SP, apuração mensal): débito das saídas − créditos (compras de revenda, crédito do Simples, devoluções de
     venda) − saldo credor do mês anterior. Sobrando crédito, ele passa para o mês seguinte.
   - PIS e COFINS não cumulativos (Leis 10.637/2002 e 10.833/2003): débito das saídas (+ 0,65% e 4% sobre os rendimentos
     financeiros, Decreto 8.426/2015) − créditos de 1,65% e 7,6% (compras de revenda sem o ICMS da nota, Lei 14.592/2023;
     aluguel e energia pagos a PJ, art. 3º, III e IV; devoluções de venda) − saldo credor anterior.
   - IRPJ e CSLL (Lucro Real): pela ESTIMATIVA mensal (Lei 9.430/1996, art. 2º; base de 8% e 12% da receita de revenda,
     Lei 9.249/1995, arts. 15 e 20, mais os rendimentos inteiros) ou pelo RESULTADO do mês (balancete de suspensão ou
     redução, Lei 8.981/1995, art. 35). 15% + adicional de 10% sobre o que passar de R$ 20.000 no mês; CSLL 9%.
   - DIFAL e FCP: as guias GNRE do robô.  INSS: 20% sobre o pró-labore pago (Lei 8.212/1991, art. 22, III).
   - Informativo (já está no custo, não é guia da OneClean): ICMS-ST e IPI pagos nas compras; CBS e IBS do teste de 2026
     (0,9% + 0,1%, que não se pagam: compensam com PIS/COFINS).

   Estimativa, não guia: o valor a pagar é do contador. A tela diz o que ficou de fora em cada mês. */
(function (raiz) {
  'use strict';
  const n = v => { const x = Number(v); return isFinite(x) ? x : 0; };
  const r2 = v => Math.round(v * 100) / 100;
  const reais = v => 'R$ ' + r2(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const DEDUTIVEIS = ['Água', 'Aluguel', 'Certificado Digital', 'Consulta CNPJ', 'Contabilidade', 'Convênio médico', 'Energia',
    'Frete e combustível', 'Outras saídas', 'Pró-labore', 'Reembolso da folha à Agilité', 'Salários', 'Sistema (FKN)',
    'Telefone e internet', 'Tarifas bancárias'];
  const CREDITO_PIS = ['Aluguel', 'Energia'];
  const PADRAO = { inicio: null, saldo: { icms: 0, pis: 0, cofins: 0 }, semProduto: true, irpj: 'estimativa',
    dedutiveis: DEDUTIVEIS, creditoPis: CREDITO_PIS, inssProLabore: true };

  function premissas(cfg) {
    const c = Object.assign({}, PADRAO, cfg || {});
    c.saldo = Object.assign({ icms: 0, pis: 0, cofins: 0 }, (cfg && cfg.saldo) || {});
    c.dedutiveis = Array.isArray(c.dedutiveis) ? c.dedutiveis : DEDUTIVEIS;
    c.creditoPis = Array.isArray(c.creditoPis) ? c.creditoPis : CREDITO_PIS;
    return c;
  }

  // Multiplica os números de um mês (projeção pelo ritmo ou "e se faturar R$ X"). Saldos e contagens não mudam.
  function projetar(m, fator) {
    if (!m || !(fator > 0) || fator === 1) return m;
    const mult = (o, campos) => { const x = Object.assign({}, o); campos.forEach(k => { x[k] = n(o && o[k]) * fator; }); return x; };
    const caixa = Object.assign({}, m.caixa, { saidas: {} });
    Object.entries((m.caixa && m.caixa.saidas) || {}).forEach(([k, v]) => { caixa.saidas[k] = n(v) * fator; });
    caixa.rendimentos = n(m.caixa && m.caixa.rendimentos) * fator;
    return Object.assign({}, m, {
      vendas: mult(m.vendas, ['receita', 'icms', 'pis', 'cofins', 'ipi', 'st', 'cmv']),
      devolucoes: mult(m.devolucoes, ['valor', 'icms', 'pis', 'cofins']),
      compras: mult(m.compras, ['valor', 'cred_icms', 'cred_sn', 'base_pis', 'ipi', 'st', 'nao_lidos_valor', 'sem_produto_valor', 'sem_produto_cred_icms', 'sem_produto_base_pis']),
      gnre: mult(m.gnre, ['difal', 'fcp']), caixa, projetado: fator });
  }

  // Um imposto não cumulativo: débito − crédito do mês − saldo credor anterior.
  function apura(debito, credito, anterior) {
    const doMes = debito - credito, depois = doMes - anterior;
    return { debito: r2(debito), credito: r2(credito), doMes: r2(doMes), saldoAnterior: r2(anterior), aPagar: r2(Math.max(0, depois)), saldoCredor: r2(Math.max(0, -depois)) };
  }
  const irpjDe = base => (base > 0 ? base * 0.15 + Math.max(0, base - 20000) * 0.10 : 0);

  // Um mês, com o saldo credor que veio do anterior. → { mes, receita, icms, pis, cofins, irpj, csll, difal, fcp, inss, … }
  function mes(m, c, saldo) {
    const v = m.vendas || {}, d = m.devolucoes || {}, cp = m.compras || {}, g = m.gnre || {}, cx = m.caixa || {};
    const saidas = cx.saidas || {};
    const somaCat = lista => lista.reduce((s, k) => s + n(saidas[k]), 0);
    const comSp = c.semProduto !== false;
    const receita = n(v.receita) - n(d.valor);
    const rend = n(cx.rendimentos);

    const credIcmsCompras = n(cp.cred_icms) + (comSp ? n(cp.sem_produto_cred_icms) : 0);
    const icms = apura(n(v.icms), credIcmsCompras + n(d.icms), n(saldo.icms));
    icms.partes = { saidas: r2(n(v.icms)), compras: r2(n(cp.cred_icms)), comprasSemProduto: r2(comSp ? n(cp.sem_produto_cred_icms) : 0), devolucoes: r2(n(d.icms)) };

    const basePisCompras = n(cp.base_pis) + (comSp ? n(cp.sem_produto_base_pis) : 0);
    const baseDespesas = somaCat(c.creditoPis);
    const pis = apura(n(v.pis) + rend * 0.0065, (basePisCompras + baseDespesas) * 0.0165 + n(d.pis), n(saldo.pis));
    const cofins = apura(n(v.cofins) + rend * 0.04, (basePisCompras + baseDespesas) * 0.076 + n(d.cofins), n(saldo.cofins));
    pis.partes = { saidas: r2(n(v.pis)), rendimentos: r2(rend * 0.0065), compras: r2(basePisCompras * 0.0165), despesas: r2(baseDespesas * 0.0165), devolucoes: r2(n(d.pis)), base: r2(basePisCompras + baseDespesas) };
    cofins.partes = { saidas: r2(n(v.cofins)), rendimentos: r2(rend * 0.04), compras: r2(basePisCompras * 0.076), despesas: r2(baseDespesas * 0.076), devolucoes: r2(n(d.cofins)), base: r2(basePisCompras + baseDespesas) };

    const difal = r2(n(g.difal)), fcp = r2(n(g.fcp));
    const proLabore = n(saidas['Pró-labore']);
    const inss = r2(c.inssProLabore ? proLabore * 0.20 : 0);

    // IRPJ/CSLL pelas duas formas
    const baseI = receita * 0.08 + rend, baseC = receita * 0.12 + rend;
    const estimativa = { baseIrpj: r2(baseI), baseCsll: r2(baseC), irpj: r2(irpjDe(baseI)), csll: r2(baseC * 0.09) };
    const despesas = somaCat(c.dedutiveis) + inss + difal + fcp;
    const impostosVenda = icms.doMes + pis.doMes + cofins.doMes;
    const lucro = receita - n(v.cmv) - impostosVenda - despesas + rend;
    const balancete = { lucro: r2(lucro), cmv: r2(n(v.cmv)), despesas: r2(despesas), impostos: r2(impostosVenda),
      irpj: r2(irpjDe(lucro)), csll: r2(Math.max(0, lucro) * 0.09), semCaixa: !cx.tem };
    const forma = c.irpj === 'balancete' ? balancete : estimativa;

    const total = r2(icms.aPagar + pis.aPagar + cofins.aPagar + forma.irpj + forma.csll + difal + fcp + inss);
    const gerado = r2(Math.max(0, icms.doMes) + Math.max(0, pis.doMes) + Math.max(0, cofins.doMes) + forma.irpj + forma.csll + difal + fcp + inss);

    const avisos = [];
    if (n(cp.nao_lidos)) avisos.push(n(cp.nao_lidos) + ' itens de compra sem o ICMS lido do XML (' + reais(n(cp.nao_lidos_valor)) + '): o crédito de ICMS está a menos. Use "Ler o ICMS das notas de compra".');
    if (n(cp.sem_produto)) avisos.push(n(cp.sem_produto) + ' itens de compra sem produto ligado (' + reais(n(cp.sem_produto_valor)) + ')' + (comSp ? ': créditos estimados pela nota do fornecedor (pode haver uso e consumo, que não dá crédito).' : ': fora dos créditos (premissa).'));
    if (n(cp.sem_regra)) avisos.push(n(cp.sem_regra) + ' itens de compra de produto sem regra fiscal de venda: fora dos créditos.');
    if (n(v.sem_fiscal)) avisos.push(n(v.sem_fiscal) + ' itens de venda sem a tributação lida do XML: débito a menos (Fiscal → Ler a tributação).');
    if (n(v.sem_custo)) avisos.push(n(v.sem_custo) + ' itens de venda sem custo no cadastro: o custo das vendas (e o resultado) fica a menos.');
    if (!cx.tem) avisos.push('Mês sem o Caixa no CRM: o IRPJ/CSLL pelo resultado não tem as despesas, e os créditos de aluguel e energia e o INSS do pró-labore ficam de fora.');
    if (!n(cp.itens) && !n(cp.sem_produto)) avisos.push('Mês sem notas de compra no CRM (a busca na Sefaz guarda só os últimos 90 dias): sem créditos das compras.');
    if (balancete.lucro < 0) avisos.push('Pelo resultado do mês houve prejuízo: sem IRPJ/CSLL por essa forma.');

    return { mes: m.mes, projetado: m.projetado || null, receita: r2(receita), devolucoes: r2(n(d.valor)), rendimentos: r2(rend),
      icms, pis, cofins, estimativa, balancete, forma: c.irpj === 'balancete' ? 'balancete' : 'estimativa',
      irpj: forma.irpj, csll: forma.csll, difal, fcp, inss, proLabore: r2(proLabore), total, gerado,
      carga: receita > 0 ? r2(total / receita * 100) : null, cargaGerada: receita > 0 ? r2(gerado / receita * 100) : null,
      informativo: { stCompras: r2(n(cp.st)), ipiCompras: r2(n(cp.ipi)), cbs: r2(receita * 0.009), ibs: r2(receita * 0.001) },
      avisos };
  }

  // Os meses em ordem, com o saldo credor passando de um para o outro a partir de "inicio" (com o saldo inicial informado).
  // projecao: { mes: 'AAAA-MM', fator } multiplica os números daquele mês antes da conta.
  function apurar(meses, cfg, projecao) {
    const c = premissas(cfg);
    const lista = (meses || []).slice().sort((a, b) => String(a.mes).localeCompare(String(b.mes)));
    const inicio = c.inicio || (lista[0] && lista[0].mes);
    let saldo = { icms: 0, pis: 0, cofins: 0 };
    const out = [];
    lista.forEach(m0 => {
      const m = projecao && projecao.mes === m0.mes ? projetar(m0, projecao.fator) : m0;
      if (m.mes === inicio) saldo = { icms: n(c.saldo.icms), pis: n(c.saldo.pis), cofins: n(c.saldo.cofins) };
      if (m.mes < inicio) saldo = { icms: 0, pis: 0, cofins: 0 };
      const r = mes(m, c, saldo);
      r.antesDoInicio = m.mes < inicio;
      out.push(r);
      saldo = { icms: r.icms.saldoCredor, pis: r.pis.saldoCredor, cofins: r.cofins.saldoCredor };
    });
    const soma = k => r2(out.reduce((s, x) => s + n(typeof k === 'function' ? k(x) : x[k]), 0));
    const total = { receita: soma('receita'), icms: soma(x => x.icms.aPagar), pis: soma(x => x.pis.aPagar), cofins: soma(x => x.cofins.aPagar),
      irpj: soma('irpj'), csll: soma('csll'), difal: soma('difal'), fcp: soma('fcp'), inss: soma('inss'), total: soma('total'), gerado: soma('gerado') };
    total.carga = total.receita > 0 ? r2(total.total / total.receita * 100) : null;
    return { meses: out, total, premissas: c };
  }

  // Fator para projetar o mês corrente pelo ritmo: dias úteis do mês ÷ dias úteis já passados (hoje conta inteiro).
  function fatorRitmo(diasUteisMes, diasUteisAteHoje) {
    return diasUteisAteHoje > 0 && diasUteisMes >= diasUteisAteHoje ? diasUteisMes / diasUteisAteHoje : 1;
  }

  // Itens de uma nota de compra lida do XML (nfe.js lerXml) → o ICMS de cada item, para completar os gravados sem ele.
  // Todo item lido vira "lido", mesmo sem ICMS (Simples sem crédito, ST retida): o vazio também é a resposta da nota.
  function icmsDosItens(d, chave) {
    return ((d && d.itens) || []).map(it => { const f = it.fiscal || {};
      return { chave, ordem: it.ordem, icms_base: f.v_bc_icms == null ? null : f.v_bc_icms, icms_aliq: f.aliq_icms == null ? null : f.aliq_icms,
        icms_valor: f.v_icms == null ? null : f.v_icms, cred_sn: f.v_cred_sn == null ? null : f.v_cred_sn }; });
  }

  const I = { apurar, mes, projetar, premissas, fatorRitmo, irpjDe, icmsDosItens, DEDUTIVEIS, CREDITO_PIS };
  raiz.CRMImpostometro = I;
  if (typeof module !== 'undefined') module.exports = I;

  // ------------------------------------------------------------ tela (Financeiro → Impostômetro; só o administrador)
  const CRM = raiz.CRM;
  if (!CRM || !CRM.telas) return;
  const { esc } = CRM;
  const R = raiz.CRMRegras, CX = raiz.CRMCaixa, N = raiz.CRMNfe;
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const nomeMes = m => MESES[+m.slice(5, 7) - 1] + ' de ' + m.slice(0, 4);
  const curto = m => MESES[+m.slice(5, 7) - 1].slice(0, 3) + '/' + m.slice(2, 4);
  const rs = v => (Number(v) < -0.004 ? '− ' + R.moeda(-v) : R.moeda(Math.abs(Number(v)) < 0.005 ? 0 : v));
  const pc = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');
  const mesAntes = m => { const [a, x] = m.split('-').map(Number); return x === 1 ? (a - 1) + '-12' : a + '-' + String(x - 1).padStart(2, '0'); };
  const mesDepois = m => { const [a, x] = m.split('-').map(Number); return x === 12 ? (a + 1) + '-01' : a + '-' + String(x + 1).padStart(2, '0'); };
  const st = { dados: null, carregando: false, periodo: '6', sel: null, projetar: true, simular: '', erro: null, lendo: null, semIcms: null };

  function mesesDoPeriodo() {
    const hoje = CRM.hoje().slice(0, 7);
    if (st.periodo === 'ano') { const l = []; for (let m = hoje.slice(0, 4) + '-01'; m <= hoje; m = mesDepois(m)) l.push(m); return l; }
    const n = Number(st.periodo) || 6, l = [hoje];
    while (l.length < n) l.unshift(mesAntes(l[0]));
    return l;
  }
  async function carrega() {
    if (st.carregando) return;
    st.carregando = true; st.erro = null;
    const store = CRM.store();
    try {
      const meses = mesesDoPeriodo();
      // um mês por chamada, em paralelo: a conta de um mês leva cerca de 1 s no banco
      const partes = await Promise.all(meses.map(m => store.impostometro(m + '-01', m + '-01')));
      st.dados = [].concat(...partes);
      st.semIcms = store.comprasSemIcms ? (await store.comprasSemIcms()).length : 0;
    } catch (e) { st.dados = []; st.erro = e; CRM.falhou(e); }
    st.carregando = false;
    CRM.render();
  }
  const cfgImp = () => (CRM.estado.cfg && CRM.estado.cfg.impostometro) || {};

  // dias úteis de São Bernardo no mês e até hoje (para projetar o mês corrente pelo ritmo)
  function ritmo(mes) {
    const hoje = CRM.hoje();
    if (!CX || hoje.slice(0, 7) !== mes) return 1;
    let total = 0, ate = 0;
    for (let d = mes + '-01'; d.slice(0, 7) === mes; d = CX.soma(d, 1)) if (CX.util(d)) { total++; if (d <= hoje) ate++; }
    return fatorRitmo(total, ate);
  }
  const antecipa = d => { let x = d; while (CX && !CX.util(x)) x = CX.soma(x, -1); return x; };
  const posterga = d => (CX ? CX.posterga(d) : d);
  const ultimoDia = m => { const [a, x] = m.split('-').map(Number); return m + '-' + String(new Date(a, x, 0).getDate()).padStart(2, '0'); };
  const dataBR = d => d.slice(8, 10) + '/' + d.slice(5, 7);
  function vencimentos(mes) {
    const p = mesDepois(mes);
    return { icms: dataBR(posterga(p + '-20')), pis: dataBR(antecipa(p + '-25')), irpj: dataBR(antecipa(ultimoDia(p))), inss: dataBR(antecipa(p + '-20')) };
  }

  function cartao(titulo, valor, linhas, rodape, cor) {
    return '<div class="im-cartao' + (cor ? ' ' + cor : '') + '"><div class="im-tit">' + esc(titulo) + '</div><div class="im-valor">' + rs(valor) + '</div>' +
      (linhas.length ? '<table class="im-linhas">' + linhas.map(([t, v, f]) => '<tr' + (f ? ' class="im-' + f + '"' : '') + '><td>' + esc(t) + '</td><td class="num">' + (typeof v === 'string' ? esc(v) : rs(v)) + '</td></tr>').join('') + '</table>' : '') +
      (rodape ? '<div class="im-rodape">' + rodape + '</div>' : '') + '</div>';
  }
  function cartaoNc(nome, x, venc) {
    return cartao(nome, x.aPagar, [['Débito das saídas', x.debito], ['− Créditos do mês', -x.credito], ['= Imposto do mês', x.doMes, 'sub'],
      ['− Saldo credor anterior', -x.saldoAnterior], ['Saldo credor que fica', x.saldoCredor, x.saldoCredor ? 'verde' : '']], 'vence em ' + esc(venc), x.aPagar ? '' : 'zero');
  }

  CRM.telas.impostometro = {
    render() {
      if (!CRM.ehAdmin()) return '<div class="cartao"><p class="vazio">Esta tela é só do administrador.</p></div>';
      const cab = '<div class="cabecalho"><div><h1>Impostômetro</h1><p class="sub">os impostos da OneClean (Lucro Real) um a um, pelo que as notas destacaram e pelos créditos das compras · estimativa: o valor da guia é do contador</p></div>' +
        '<span class="flex"></span><select id="imPeriodo" aria-label="Período">' + CRM.opcoesHTML([['1', 'Este mês'], ['3', 'Últimos 3 meses'], ['6', 'Últimos 6 meses'], ['12', 'Últimos 12 meses'], ['ano', 'Este ano']], st.periodo) + '</select>' +
        '<button type="button" class="btn sec" data-acao="im-planilha">Baixar planilha</button></div>';
      if (!st.dados) { if (!st.carregando) setTimeout(carrega, 0); return cab + '<div class="cartao"><p class="vazio">Somando as notas de cada mês… (leva alguns segundos)</p></div>'; }
      if (!st.dados.length) return cab + '<div class="cartao"><p class="vazio">' + (st.erro ? 'Não foi possível somar: ' + esc(st.erro.message || st.erro) : 'Sem dados no período.') + '</p></div>';
      const hoje = CRM.hoje().slice(0, 7);
      st.sel = st.sel && st.dados.some(m => m.mes === st.sel) ? st.sel : st.dados[st.dados.length - 1].mes;
      const corrente = st.sel === hoje;
      const fRitmo = corrente ? ritmo(st.sel) : 1;
      const mSel = st.dados.find(m => m.mes === st.sel);
      const simular = R.num(String(st.simular || '').replace(/\./g, '').replace(',', '.'));
      let fator = 1, comoProj = '';
      if (simular > 0 && mSel && R.num(mSel.vendas && mSel.vendas.receita) > 0) { fator = simular / R.num(mSel.vendas.receita); comoProj = 'simulação: faturamento de ' + rs(simular); }
      else if (corrente && st.projetar && fRitmo > 1) { fator = fRitmo; comoProj = 'projetado até o fim do mês pelo ritmo dos dias úteis (×' + fRitmo.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ')'; }
      const ap = apurar(st.dados, cfgImp(), fator !== 1 ? { mes: st.sel, fator } : null);
      const x = ap.meses.find(m => m.mes === st.sel);
      const v = vencimentos(x.mes), c = ap.premissas;
      const outra = x.forma === 'estimativa' ? x.balancete : x.estimativa;

      const topo = '<section class="cartao im-topo"><div class="im-cab"><h2>' + esc(nomeMes(x.mes)) + (comoProj ? ' <small class="im-proj">' + esc(comoProj) + '</small>' : '') + '</h2>' +
        (corrente ? '<label class="im-ck"><input type="checkbox" id="imProjetar"' + (st.projetar ? ' checked' : '') + '> projetar até o fim do mês</label>' : '') +
        '<label class="im-sim">E se o faturamento for R$ <input type="text" inputmode="decimal" id="imSimular" value="' + esc(st.simular) + '" placeholder="' + esc(R.num(mSel.vendas && mSel.vendas.receita).toLocaleString('pt-BR', { maximumFractionDigits: 0 })) + '"></label></div>' +
        '<div class="kpis"><div class="kpi destaque"><span>A pagar no mês</span><strong>' + rs(x.total) + '</strong><small>' + pc(x.carga) + ' do faturamento, já abatido o saldo credor</small></div>' +
        '<div class="kpi"><span>Imposto que o mês gerou</span><strong>' + rs(x.gerado) + '</strong><small>' + pc(x.cargaGerada) + ' · sem usar crédito de meses anteriores</small></div>' +
        '<div class="kpi"><span>Faturamento</span><strong>' + rs(x.receita) + '</strong><small>' + (x.devolucoes ? 'menos ' + rs(x.devolucoes) + ' de devoluções' : 'notas de venda do mês') + '</small></div>' +
        '<div class="kpi"><span>Créditos acumulados</span><strong>' + rs(x.icms.saldoCredor + x.pis.saldoCredor + x.cofins.saldoCredor) + '</strong><small>ICMS ' + rs(x.icms.saldoCredor) + ' · PIS ' + rs(x.pis.saldoCredor) + ' · COFINS ' + rs(x.cofins.saldoCredor) + '</small></div></div>' +
        '<div class="im-grade">' +
          cartaoNc('ICMS', x.icms, v.icms) + cartaoNc('PIS', x.pis, v.pis) + cartaoNc('COFINS', x.cofins, v.pis) +
          cartao('IRPJ', x.irpj, x.forma === 'estimativa' ? [['Base: 8% da receita + rendimentos', x.estimativa.baseIrpj], ['15% + 10% acima de R$ 20 mil', x.irpj, 'sub'], ['Pelo resultado do mês seria', outra.irpj]]
            : [['Lucro do mês (estimado)', x.balancete.lucro], ['15% + 10% acima de R$ 20 mil', x.irpj, 'sub'], ['Pela estimativa seria', outra.irpj]], 'vence em ' + esc(v.irpj) + ' · ' + (x.forma === 'estimativa' ? 'estimativa mensal' : 'pelo resultado (balancete)')) +
          cartao('CSLL', x.csll, x.forma === 'estimativa' ? [['Base: 12% da receita + rendimentos', x.estimativa.baseCsll], ['9%', x.csll, 'sub'], ['Pelo resultado do mês seria', outra.csll]]
            : [['Lucro do mês (estimado)', x.balancete.lucro], ['9%', x.csll, 'sub'], ['Pela estimativa seria', outra.csll]], 'vence em ' + esc(v.irpj)) +
          cartao('DIFAL e FCP', x.difal + x.fcp, [['DIFAL (guias GNRE)', x.difal], ['FCP', x.fcp]], 'pago na emissão da nota') +
          cartao('INSS do pró-labore', x.inss, [['Pró-labore pago', x.proLabore], ['20% da empresa', x.inss, 'sub']], c.inssProLabore ? 'vence em ' + esc(v.inss) : 'fora da conta (premissa)') +
        '</div>' +
        '<details class="im-det"><summary>Já está no custo das compras e o teste da CBS/IBS (informativo, não é guia)</summary><table class="im-linhas">' +
          '<tr><td>ICMS-ST pago aos fornecedores nas compras do mês</td><td class="num">' + rs(x.informativo.stCompras) + '</td></tr>' +
          '<tr><td>IPI pago nas compras do mês (a OneClean é comércio, não recupera)</td><td class="num">' + rs(x.informativo.ipiCompras) + '</td></tr>' +
          '<tr><td>CBS 0,9% do teste de 2026 (não se paga: compensa com PIS/COFINS)</td><td class="num">' + rs(x.informativo.cbs) + '</td></tr>' +
          '<tr><td>IBS 0,1% do teste de 2026 (não se paga)</td><td class="num">' + rs(x.informativo.ibs) + '</td></tr></table></details>' +
        '<details class="im-det"><summary>Memória de cálculo do mês</summary><table class="im-linhas">' +
          '<tr class="im-sub"><td>ICMS — créditos</td><td></td></tr><tr><td>Compras de revenda</td><td class="num">' + rs(x.icms.partes.compras) + '</td></tr>' +
          '<tr><td>Compras sem produto ligado (estimado)</td><td class="num">' + rs(x.icms.partes.comprasSemProduto) + '</td></tr><tr><td>Devoluções de venda</td><td class="num">' + rs(x.icms.partes.devolucoes) + '</td></tr>' +
          '<tr class="im-sub"><td>PIS/COFINS — base do crédito</td><td class="num">' + rs(x.pis.partes.base) + '</td></tr>' +
          '<tr><td>Crédito de PIS: compras / aluguel e energia / devoluções</td><td class="num">' + rs(x.pis.partes.compras) + ' / ' + rs(x.pis.partes.despesas) + ' / ' + rs(x.pis.partes.devolucoes) + '</td></tr>' +
          '<tr><td>Crédito de COFINS: compras / aluguel e energia / devoluções</td><td class="num">' + rs(x.cofins.partes.compras) + ' / ' + rs(x.cofins.partes.despesas) + ' / ' + rs(x.cofins.partes.devolucoes) + '</td></tr>' +
          '<tr><td>PIS e COFINS sobre rendimentos financeiros (0,65% e 4%)</td><td class="num">' + rs(x.pis.partes.rendimentos + x.cofins.partes.rendimentos) + '</td></tr>' +
          '<tr class="im-sub"><td>Resultado do mês (para o IRPJ/CSLL pelo balancete)</td><td></td></tr>' +
          '<tr><td>Faturamento</td><td class="num">' + rs(x.receita) + '</td></tr><tr><td>− Custo das mercadorias vendidas (custo médio, sem o índice)</td><td class="num">' + rs(-x.balancete.cmv) + '</td></tr>' +
          '<tr><td>− ICMS, PIS e COFINS do mês</td><td class="num">' + rs(-x.balancete.impostos) + '</td></tr><tr><td>− Despesas dedutíveis (Caixa) + INSS + DIFAL</td><td class="num">' + rs(-x.balancete.despesas) + '</td></tr>' +
          '<tr><td>+ Rendimentos</td><td class="num">' + rs(x.rendimentos) + '</td></tr><tr class="im-sub"><td>= Lucro estimado</td><td class="num">' + rs(x.balancete.lucro) + '</td></tr></table></details>' +
        (x.avisos.length ? '<ul class="im-avisos">' + x.avisos.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul>' : '') +
        (st.semIcms ? '<p><button type="button" class="btn sec" data-acao="im-ler-icms">Ler o ICMS das notas de compra (' + st.semIcms + ' notas)</button> <small id="imAndamento">' + esc(st.lendo || 'uma vez só: relê os XML guardados e completa o crédito de ICMS') + '</small></p>' : '') +
        '</section>';

      const tab = '<section class="cartao"><h2>Mês a mês</h2><div class="tabela-rolagem"><table class="tabela im-tab"><thead><tr><th>Mês</th><th class="num">Faturamento</th><th class="num">ICMS</th><th class="num">PIS</th><th class="num">COFINS</th>' +
        '<th class="num">IRPJ</th><th class="num">CSLL</th><th class="num">DIFAL/FCP</th><th class="num">INSS</th><th class="num">Total a pagar</th><th class="num">Carga</th><th class="num">Gerado no mês</th><th class="num">Saldo credor<br><small>ICMS · PIS+COFINS</small></th></tr></thead><tbody>' +
        ap.meses.map(m => '<tr class="im-linha' + (m.mes === st.sel ? ' im-sel' : '') + '" data-im-mes="' + esc(m.mes) + '"><td><button type="button" class="link">' + esc(curto(m.mes)) + '</button>' + (m.projetado ? ' <small>proj.</small>' : '') + (m.avisos.length ? ' <span title="' + esc(m.avisos.join('\n')) + '">⚠</span>' : '') + '</td>' +
          '<td class="num">' + rs(m.receita) + '</td><td class="num">' + rs(m.icms.aPagar) + '</td><td class="num">' + rs(m.pis.aPagar) + '</td><td class="num">' + rs(m.cofins.aPagar) + '</td>' +
          '<td class="num">' + rs(m.irpj) + '</td><td class="num">' + rs(m.csll) + '</td><td class="num">' + rs(m.difal + m.fcp) + '</td><td class="num">' + rs(m.inss) + '</td>' +
          '<td class="num"><strong>' + rs(m.total) + '</strong></td><td class="num">' + pc(m.carga) + '</td><td class="num">' + rs(m.gerado) + '</td>' +
          '<td class="num">' + rs(m.icms.saldoCredor) + '<br><small>' + rs(m.pis.saldoCredor + m.cofins.saldoCredor) + '</small></td></tr>').join('') +
        '</tbody><tfoot><tr><td>Total</td><td class="num">' + rs(ap.total.receita) + '</td><td class="num">' + rs(ap.total.icms) + '</td><td class="num">' + rs(ap.total.pis) + '</td><td class="num">' + rs(ap.total.cofins) + '</td>' +
          '<td class="num">' + rs(ap.total.irpj) + '</td><td class="num">' + rs(ap.total.csll) + '</td><td class="num">' + rs(ap.total.difal + ap.total.fcp) + '</td><td class="num">' + rs(ap.total.inss) + '</td>' +
          '<td class="num"><strong>' + rs(ap.total.total) + '</strong></td><td class="num">' + pc(ap.total.carga) + '</td><td class="num">' + rs(ap.total.gerado) + '</td><td></td></tr></tfoot></table></div>' +
        '<p class="dica">O saldo credor passa de um mês para o outro a partir de ' + esc(c.inicio ? nomeMes(c.inicio) : 'o 1º mês do período') + ' (premissas). Clique no mês para ver o detalhe.</p></section>';

      const cats = [...new Set([].concat(...st.dados.map(m => Object.keys((m.caixa && m.caixa.saidas) || {})), c.dedutiveis, c.creditoPis))]
        .filter(k => !/^(Fornecedores|Compra Produto|Retiradas dos sócios|Outras entradas)$/.test(k)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const prem = '<section class="cartao"><details' + (st.premAberta ? ' open' : '') + ' id="imPrem"><summary><strong>Premissas</strong> <small>saldo credor inicial, forma do IRPJ/CSLL, despesas e créditos</small></summary>' +
        '<form id="imForm" class="im-form"><div class="im-grade2">' +
          '<label><span>Começar a conta dos créditos em</span><select name="inicio">' + CRM.opcoesHTML([['', '1º mês do período']].concat(st.dados.map(m => [m.mes, nomeMes(m.mes)])), c.inicio || '') + '</select><small>o mês em que o saldo credor abaixo vale (pergunte ao contador o saldo da EFD)</small></label>' +
          '<label><span>Saldo credor de ICMS no início (R$)</span><input name="saldo_icms" type="text" inputmode="decimal" value="' + esc(String(c.saldo.icms || '').replace('.', ',')) + '"></label>' +
          '<label><span>Saldo credor de PIS no início (R$)</span><input name="saldo_pis" type="text" inputmode="decimal" value="' + esc(String(c.saldo.pis || '').replace('.', ',')) + '"></label>' +
          '<label><span>Saldo credor de COFINS no início (R$)</span><input name="saldo_cofins" type="text" inputmode="decimal" value="' + esc(String(c.saldo.cofins || '').replace('.', ',')) + '"></label>' +
          '<label><span>IRPJ e CSLL pela</span><select name="irpj">' + CRM.opcoesHTML([['estimativa', 'estimativa mensal (8% e 12% da receita)'], ['balancete', 'resultado do mês (balancete de suspensão/redução)']], c.irpj) + '</select><small>a forma que o contador usa</small></label>' +
          '<label class="im-ck"><input type="checkbox" name="semProduto"' + (c.semProduto !== false ? ' checked' : '') + '> contar o crédito das compras sem produto ligado (estimado pela nota)</label>' +
          '<label class="im-ck"><input type="checkbox" name="inssProLabore"' + (c.inssProLabore ? ' checked' : '') + '> INSS de 20% sobre o pró-labore</label>' +
        '</div><div class="im-grade2"><fieldset><legend>Despesas dedutíveis (IRPJ/CSLL pelo resultado)</legend>' + cats.map(k => '<label class="im-ck"><input type="checkbox" name="ded" value="' + esc(k) + '"' + (c.dedutiveis.indexOf(k) !== -1 ? ' checked' : '') + '> ' + esc(k) + '</label>').join('') + '</fieldset>' +
          '<fieldset><legend>Dão crédito de PIS/COFINS (pagas a pessoa jurídica)</legend>' + cats.map(k => '<label class="im-ck"><input type="checkbox" name="cred" value="' + esc(k) + '"' + (c.creditoPis.indexOf(k) !== -1 ? ' checked' : '') + '> ' + esc(k) + '</label>').join('') +
          '<small>aluguel de prédio e energia (art. 3º, III e IV); frete na venda pago a transportadora (IX) só se a categoria tiver só isso</small></fieldset></div>' +
        '<p><button type="submit" class="btn">Salvar as premissas</button></p></form></details></section>';

      const regras = '<section class="cartao"><details><summary><strong>Como o CRM calcula</strong> <small>as regras e a lei de cada uma</small></summary><ul class="cf-regras">' +
        '<li><strong>ICMS</strong> (SP, apuração mensal): débito destacado nas notas de saída − crédito das compras de revenda (ICMS da nota; do Simples, o crédito informado; nada se a venda tem ST; venda com base reduzida limita o crédito à carga) − devoluções de venda − saldo credor do mês anterior.</li>' +
        '<li><strong>PIS e COFINS</strong> não cumulativos (Leis 10.637/2002 e 10.833/2003): débito das notas (+ 0,65% e 4% dos rendimentos, Decreto 8.426/2015) − 1,65% e 7,6% sobre compras de revenda sem o ICMS da nota (Lei 14.592/2023), aluguel e energia − devoluções − saldo credor.</li>' +
        '<li><strong>IRPJ e CSLL</strong> (Lucro Real): estimativa mensal sobre 8% e 12% da receita (Lei 9.249/1995, arts. 15 e 20; Lei 9.430/1996, art. 2º) ou o resultado do mês (balancete, Lei 8.981/1995, art. 35). 15% + 10% do que passar de R$ 20 mil no mês; CSLL 9%.</li>' +
        '<li><strong>DIFAL e FCP</strong>: as guias GNRE geradas pelo robô na emissão. <strong>INSS</strong>: 20% da empresa sobre o pró-labore (Lei 8.212/1991, art. 22, III).</li>' +
        '<li><strong>Fora da conta</strong>: prejuízo fiscal de meses anteriores, adições e exclusões do LALUR, retenções na fonte e créditos de imobilizado. Por isso é estimativa: o valor da guia é do contador.</li></ul></details></section>';
      return cab + topo + tab + prem + regras;
    },
    depois() {
      const p = document.getElementById('imPeriodo');
      if (p) p.addEventListener('change', () => { st.periodo = p.value; st.dados = null; st.sel = null; CRM.render(); });
      const pj = document.getElementById('imProjetar');
      if (pj) pj.addEventListener('change', () => { st.projetar = pj.checked; CRM.render(); });
      const si = document.getElementById('imSimular');
      if (si) si.addEventListener('change', () => { st.simular = si.value; CRM.render(); });
      document.querySelectorAll('[data-im-mes]').forEach(tr => tr.addEventListener('click', () => { st.sel = tr.dataset.imMes; st.simular = ''; CRM.render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
      const pr = document.getElementById('imPrem');
      if (pr) pr.addEventListener('toggle', () => { st.premAberta = pr.open; });
      const f = document.getElementById('imForm');
      if (f) f.addEventListener('submit', async ev => {
        ev.preventDefault();
        const fd = new FormData(f), num = k => R.num(String(fd.get(k) || '').replace(/\./g, '').replace(',', '.'));
        const imp = { inicio: fd.get('inicio') || null, saldo: { icms: num('saldo_icms'), pis: num('saldo_pis'), cofins: num('saldo_cofins') },
          irpj: fd.get('irpj') || 'estimativa', semProduto: !!fd.get('semProduto'), inssProLabore: !!fd.get('inssProLabore'),
          dedutiveis: fd.getAll('ded'), creditoPis: fd.getAll('cred') };
        try { await CRM.salvarConfig({ impostometro: imp }); CRM.toast('Premissas salvas.'); } catch (e) { CRM.falhou(e); }
      });
    }
  };

  Object.assign(CRM.acoes, {
    'im-ler-icms': async () => {
      const store = CRM.store(), chaves = (await store.comprasSemIcms()).slice(), lista = [];
      if (!chaves.length) { CRM.toast('Todas as notas de compra já têm o ICMS lido.'); return; }
      let feitas = 0, semXml = 0; const total = chaves.length;
      const andamento = () => { st.lendo = 'Lendo as notas guardadas: ' + feitas + ' de ' + total + '…'; const el = document.getElementById('imAndamento'); if (el) el.textContent = st.lendo; };
      andamento();
      await Promise.all(Array.from({ length: 6 }, async () => {
        for (let ch; (ch = chaves.shift());) {
          let xml = null;
          try { xml = await store.dfeXml(ch); } catch (e) { xml = null; }
          feitas++;
          if (!xml) { semXml++; andamento(); continue; }
          try { lista.push(...icmsDosItens(N.lerXml(xml), ch)); } catch (e) { semXml++; }
          andamento();
        }
      }));
      let n = 0;
      for (let i = 0; i < lista.length; i += 500) n += (await store.compraItensIcms(lista.slice(i, i + 500))) || 0;
      st.lendo = null; st.dados = null;
      CRM.toast(n + ' itens de compra com o ICMS lido' + (semXml ? '; ' + semXml + ' notas sem o XML guardado' : '') + '.');
      CRM.render();
    },
    'im-planilha': () => {
      if (!st.dados || !st.dados.length) return;
      const ap = apurar(st.dados, cfgImp());
      CRM.baixarCSV('impostometro', ['Mês', 'Faturamento', 'ICMS débito', 'ICMS crédito', 'ICMS saldo anterior', 'ICMS a pagar', 'ICMS saldo credor',
        'PIS débito', 'PIS crédito', 'PIS a pagar', 'PIS saldo credor', 'COFINS débito', 'COFINS crédito', 'COFINS a pagar', 'COFINS saldo credor',
        'IRPJ', 'CSLL', 'Forma IRPJ/CSLL', 'DIFAL', 'FCP', 'INSS pró-labore', 'Total a pagar', 'Carga %', 'Gerado no mês', 'ICMS-ST nas compras', 'IPI nas compras', 'Avisos'],
        ap.meses.map(m => [m.mes, m.receita, m.icms.debito, m.icms.credito, m.icms.saldoAnterior, m.icms.aPagar, m.icms.saldoCredor,
          m.pis.debito, m.pis.credito, m.pis.aPagar, m.pis.saldoCredor, m.cofins.debito, m.cofins.credito, m.cofins.aPagar, m.cofins.saldoCredor,
          m.irpj, m.csll, m.forma, m.difal, m.fcp, m.inss, m.total, m.carga == null ? '' : m.carga, m.gerado, m.informativo.stCompras, m.informativo.ipiCompras, m.avisos.join(' | ')]));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
