/* CRM Sistemi Dalessi — metas de vendas (31/10/2026, decisões do Anderson: a meta mede o FATURAMENTO DAS NOTAS; a Silmara
   também tem meta; o Direto fica de fora; o mínimo da empresa sai do Caixa; por enquanto é só acompanhamento, sem mexer na
   comissão). A meta de cada vendedor(a) tem duas partes: o valor faturado no mês e a quantidade de clientes novos.

   Como a sugestão é feita (fica escrita na tela, para quem decide entender a conta):
   - base = o faturamento por dia útil dos 3 meses anteriores, com mais peso no mais recente (50%, 30%, 20%), vezes os dias
     úteis do mês da meta (dias úteis bancários de São Bernardo, os mesmos do Caixa);
   - meta = base + o crescimento escolhido (padrão 8%), arredondada para R$ 100;
   - clientes novos = a média de clientes novos (1ª compra) dos 3 meses anteriores, com o mesmo crescimento, no mínimo 1.
   O mínimo da empresa (só o administrador vê) é o faturamento que paga as contas do mês:
     custos fixos do Caixa ÷ (margem bruta − impostos sobre a venda − despesas variáveis − comissões).
   Parte pura (CRMMetas) testada em testes/metas.test.js; a tela vem depois. Os números vêm de crm_metas_dados. */
(function (raiz) {
  'use strict';
  const num = v => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
  const r2 = v => Math.round(v * 100) / 100;
  const mesISO = m => String(m).slice(0, 7);                 // 'AAAA-MM'
  const somaMes = (m, n) => { const [a, b] = mesISO(m).split('-').map(Number); const d = new Date(Date.UTC(a, b - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const PESOS = [0.5, 0.3, 0.2];                             // do mês mais recente para o mais antigo

  // dias úteis de um mês ('AAAA-MM'); util(dia ISO) → bool. Com "ate" (dia ISO), só os dias até ele (inclusive).
  function diasUteis(mes, util, ate) {
    const m = mesISO(mes), [a, b] = m.split('-').map(Number), ult = new Date(Date.UTC(a, b, 0)).getUTCDate();
    let n = 0;
    for (let d = 1; d <= ult; d++) {
      const iso = m + '-' + String(d).padStart(2, '0');
      if (ate && iso > ate) break;
      if (util(iso)) n++;
    }
    return n;
  }

  // sugestão de meta de um(a) vendedor(a): v.meses = { 'AAAA-MM': { fat, novos } }; mes = mês da meta
  function sugestao(v, mes, util, crescimento) {
    const g = 1 + num(crescimento) / 100;
    const base = [1, 2, 3].map(i => { const m = somaMes(mes, -i), x = (v.meses || {})[m] || {}; return { mes: m, fat: num(x.fat), novos: num(x.novos), du: diasUteis(m, util) }; });
    const com = base.filter(b => b.fat > 0);
    const duMes = diasUteis(mes, util);
    if (!com.length) return { base, duMes, porDia: 0, valor: 0, novos: 1, semHistorico: true };
    // pesos só dos meses com venda (quem começou há pouco não é puxado para baixo pelo mês em que ainda não vendia)
    let soma = 0, pesos = 0;
    base.forEach((b, i) => { if (b.fat > 0 && b.du > 0) { soma += PESOS[i] * b.fat / b.du; pesos += PESOS[i]; } });
    const porDia = pesos ? soma / pesos : 0;
    const valor = Math.round(porDia * duMes * g / 100) * 100;
    const mediaNovos = com.reduce((s, b) => s + b.novos, 0) / com.length;
    return { base, duMes, porDia: r2(porDia), valor, novos: Math.max(1, Math.ceil(mediaNovos * g - 0.0001)), mediaNovos: r2(mediaNovos) };
  }

  // mínimo da empresa: emp = crm_metas_dados().empresa; mesesBase = ['AAAA-MM'…] (os meses completos usados); p = parâmetros
  // da configuração (impostos_pct, comissao_pct, variaveis_pct: vazio = calculado). Devolve cada parte da conta.
  function minimo(emp, mesesBase, p) {
    p = p || {};
    if (!emp) return null;
    const fixos = (emp.fixos || []).reduce((s, f) => s + num(f.valor), 0);
    const porCat = {};
    (emp.fixos || []).forEach(f => { porCat[f.categoria] = r2((porCat[f.categoria] || 0) + num(f.valor)); });
    let venda = 0, cmv = 0, trib = 0, vendaTrib = 0, fat = 0;
    mesesBase.forEach(m => {
      const x = (emp.margem || {})[m] || {};
      venda += num(x.venda); cmv += num(x.cmv); trib += num(x.icms) + num(x.pis) + num(x.cofins); vendaTrib += num(x.venda_trib);
      fat += num(((emp.meses || {})[m] || {}).fat);
    });
    const margem = venda > 0 ? (venda - cmv) / venda * 100 : 0;
    const destacado = vendaTrib > 0 ? trib / vendaTrib * 100 : 0;
    // ICMS, PIS e COFINS são não cumulativos: paga-se o destacado na venda menos o crédito da compra. Na conta grosseira, o
    // imposto que fica é o destacado sobre a margem (o valor que a empresa acrescenta). O contador confirma o número certo.
    const impostosCalc = destacado * margem / 100;
    // despesas variáveis: as saídas avulsas do Caixa (frete, combustível, tarifas…) ÷ o faturamento, nos meses com o Caixa
    // inteiro (o Caixa do CRM começou em emp.caixa_desde)
    const desde = emp.caixa_desde ? mesISO(emp.caixa_desde) : null;
    let av = 0, fatAv = 0;
    mesesBase.forEach(m => { if (desde && m >= desde && (emp.avulsas || {})[m] != null) { av += num(emp.avulsas[m]); fatAv += num(((emp.meses || {})[m] || {}).fat); } });
    const variaveisCalc = fatAv > 0 ? av / fatAv * 100 : 0;
    const usa = (v, calc) => (v === '' || v == null || isNaN(Number(v)) ? calc : Number(v));
    const impostos = usa(p.impostos_pct, impostosCalc), variaveis = usa(p.variaveis_pct, variaveisCalc), comissao = usa(p.comissao_pct, 3);
    const contribuicao = margem - impostos - variaveis - comissao;
    const valor = contribuicao > 0 ? Math.round(fixos / (contribuicao / 100) / 100) * 100 : null;
    const fatMedio = mesesBase.length ? fat / mesesBase.length : 0;
    return { fixos: r2(fixos), porCategoria: porCat, margem: r2(margem), destacado: r2(destacado), impostos: r2(impostos), impostosCalc: r2(impostosCalc),
      variaveis: r2(variaveis), variaveisCalc: r2(variaveisCalc), mesesVariaveis: fatAv > 0, comissao: r2(comissao), contribuicao: r2(contribuicao),
      valor, fatMedio: r2(fatMedio), sobra: valor != null ? r2(fatMedio - valor) : null };
  }

  // acompanhamento do mês: realizado = faturado + pedidos fechados sem nota (o acumulado do Fechado × faturado)
  function acompanha(v, meta, mes, hoje, util) {
    const x = (v.meses || {})[mesISO(mes)] || {};
    const fat = num(x.fat), semNota = num(v.sem_nota), realizado = fat + semNota;
    const duTotal = diasUteis(mes, util), mesHoje = mesISO(hoje), m = mesISO(mes);
    const duPassados = m < mesHoje ? duTotal : m > mesHoje ? 0 : diasUteis(mes, util, hoje);
    const duRestantes = Math.max(0, duTotal - duPassados);
    const valor = num(meta && meta.valor), falta = Math.max(0, valor - realizado);
    return {
      fat, semNota, realizado, valor, pct: valor > 0 ? r2(realizado / valor * 100) : null, falta,
      duTotal, duPassados, duRestantes, porDia: duRestantes > 0 ? r2(falta / duRestantes) : null,
      projecao: duPassados > 0 ? r2(realizado / duPassados * duTotal) : null,
      novos: num(x.novos), metaNovos: meta && meta.clientes_novos != null ? num(meta.clientes_novos) : null
    };
  }

  const API = { diasUteis, sugestao, minimo, acompanha, somaMes, PESOS };
  raiz.CRMMetas = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);

// ------------------------------------------------------------ telas: Configurações → Metas e o acompanhamento
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, M = raiz.CRMMetas, R = raiz.CRMRegras;
  if (!CRM || typeof document === 'undefined') return;
  const esc = s => CRM.esc(s);
  const util = s => (raiz.CRMCaixa && raiz.CRMCaixa.util ? raiz.CRMCaixa.util(s) : ![0, 6].includes(new Date(s + 'T12:00:00').getDay()));
  const cfgMetas = () => Object.assign({ crescimento: 8, comissao_pct: 3 }, (CRM.estado.cfg && CRM.estado.cfg.metas) || {});
  const mesAtual = () => CRM.hoje().slice(0, 7);
  const moeda = v => R.moeda(v);
  const pct = v => (v == null ? '—' : String(v.toFixed ? v.toFixed(1) : v).replace('.', ',') + '%');

  // cache dos dados por mês (a tela e o cartão pedem o mesmo)
  const cache = {};
  function dados(mes) {
    const c = cache[mes] || (cache[mes] = { d: null, lendo: false, em: 0 });
    const st = CRM.store();
    if (st && st.metasDados && !c.lendo && (!c.d || Date.now() - c.em > 120000)) {
      c.lendo = true;
      st.metasDados(mes + '-01').then(d => { c.d = d; }).catch(e => { if (!c.d) c.erro = e; })
        .then(() => { c.lendo = false; c.em = Date.now(); CRM.render(); });
    }
    return c.d;
  }
  const recarregar = mes => { if (mes) { if (cache[mes]) cache[mes].em = 0; } else Object.keys(cache).forEach(k => { cache[k].em = 0; cache[k].d = null; }); };

  // ================================================================ Configurações → Metas
  let mesTela = null;
  function telaConfig() {
    // nos últimos dias do mês a tela já abre no mês seguinte (é quando a meta dele é combinada)
    mesTela = mesTela || (Number(CRM.hoje().slice(8, 10)) >= 25 ? M.somaMes(mesAtual(), 1) : mesAtual());
    const meses = [-1, 0, 1, 2].map(i => M.somaMes(mesAtual(), i));
    const d = dados(mesTela), cfg = cfgMetas();
    const cab = '<form id="formMetas" class="form-plano"><div class="acoes"><label class="filtro-inline">Mês da meta <select id="mesMeta">' +
      CRM.opcoesHTML(meses.map(m => [m, R.mesCurto(m + '-01')]), mesTela) + '</select></label> ' +
      '<label class="filtro-inline">Crescimento sobre o histórico <input type="number" step="1" min="-50" max="100" id="metaCresc" value="' + esc(cfg.crescimento) + '" class="curto"> %</label></div>';
    if (!d) return cab + '<p class="vazio">Carregando…</p></form>';
    const vs = d.vendedores || [];
    const linhas = vs.map(v => {
      const s = M.sugestao(v, mesTela, util, cfg.crescimento), mt = v.meta || {};
      const hist = s.base.slice().reverse().map(b => R.mesCurto(b.mes + '-01') + ': ' + moeda(b.fat) + ' (' + b.novos + ' novo' + (b.novos === 1 ? '' : 's') + ')').join(' · ');
      return '<tr><td><strong>' + esc(v.nome) + '</strong>' + (v.externo ? ' <small>externa</small>' : '') + '<small>' + esc(hist) + '</small></td>' +
        '<td class="num">' + (s.semHistorico ? '<small>sem histórico</small>' : moeda(s.valor) + '<small>' + moeda(s.porDia) + '/dia útil × ' + s.duMes + ' dias</small>') + '</td>' +
        '<td class="num"><input type="text" data-moeda name="m_' + esc(v.user_id) + '" value="' + esc(mt.valor != null ? mt.valor : '') + '" class="curto" data-sug="' + esc(s.valor) + '"></td>' +
        '<td class="num">' + s.novos + '<small>média ' + String(s.mediaNovos == null ? 0 : s.mediaNovos).replace('.', ',') + '</small></td>' +
        '<td class="num"><input type="number" min="0" step="1" name="n_' + esc(v.user_id) + '" value="' + esc(mt.clientes_novos != null ? mt.clientes_novos : '') + '" class="curto" data-sug="' + esc(s.novos) + '"></td></tr>';
    }).join('');
    const totSug = vs.reduce((t, v) => t + M.sugestao(v, mesTela, util, cfg.crescimento).valor, 0);
    const totMeta = vs.reduce((t, v) => t + Number((v.meta && v.meta.valor) || 0), 0);
    return cab +
      '<p class="dica">A meta mede o <strong>faturamento das notas</strong> do mês (o que já tem nota, mais os pedidos fechados que ainda vão virar nota) e a ' +
        'quantidade de <strong>clientes novos</strong> (1ª compra). A sugestão usa o faturamento por dia útil dos 3 meses anteriores (50% o mais recente, ' +
        '30% o anterior, 20% o mais antigo), vezes os dias úteis do mês, mais o crescimento. O Direto fica de fora.</p>' +
      '<div class="tabela-rolagem"><table class="tabela" data-sem-filtro><thead><tr><th>Vendedor(a) <small>últimos 3 meses</small></th><th class="num">Sugestão</th><th class="num">Meta de faturamento</th>' +
        '<th class="num">Sugestão</th><th class="num">Meta de clientes novos</th></tr></thead><tbody>' + linhas + '</tbody>' +
        '<tfoot><tr class="total"><td><strong>Total</strong></td><td class="num">' + moeda(totSug) + '</td><td class="num">' + moeda(totMeta) + '</td><td></td><td></td></tr></tfoot></table></div>' +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="metas-sugestao">Usar as sugestões</button> <button type="submit" class="btn">Salvar metas</button></p></form>' +
      (d.empresa ? blocoMinimo(d, cfg, totMeta || totSug, !totMeta) : '');
  }

  // o mínimo da empresa (só o administrador): a conta inteira à vista, cada parte com de onde veio
  function blocoMinimo(d, cfg, totMetas, saoSugestoes) {
    const base = [1, 2, 3].map(i => M.somaMes(mesTela, -i)).filter(m => (d.empresa.margem || {})[m]);
    const mn = M.minimo(d.empresa, base, cfg);
    if (!mn) return '';
    const direto = base.length ? base.reduce((s, m) => s + Number(((d.empresa.meses || {})[m] || {}).direto || 0), 0) / base.length : 0;
    const cats = Object.keys(mn.porCategoria).sort((a, b) => mn.porCategoria[b] - mn.porCategoria[a]);
    const linha = (t, v, s) => '<tr><td>' + t + (s ? '<small>' + s + '</small>' : '') + '</td><td class="num">' + v + '</td></tr>';
    const campo = (nome, valor, calc) => '<input type="number" step="0.1" name="' + nome + '" value="' + esc(valor == null ? '' : valor) + '" placeholder="' + esc(String(calc).replace('.', ',')) + '" class="curto"> %';
    const chega = Math.round((totMetas + direto) / 100) * 100;
    return '<section class="cartao metas-minimo"><h2>Mínimo da empresa <small>o faturamento que paga as contas do mês · só você vê</small></h2>' +
      (mn.valor == null ? '<p class="aviso-notas">Com esses números a margem não cobre os impostos, as despesas e as comissões: confira os percentuais abaixo.</p>' :
        '<div class="kpis"><div class="kpi azul ff-acumulado"><span>Mínimo para pagar as contas</span><strong>' + moeda(mn.valor) + '</strong><small>' +
          moeda(mn.fixos) + ' de custos fixos ÷ ' + pct(mn.contribuicao) + ' que sobra de cada venda</small></div>' +
        '<div class="kpi"><span>Faturamento médio (' + base.length + ' meses)</span><strong>' + moeda(mn.fatMedio) + '</strong><small>' +
          (mn.sobra >= 0 ? moeda(mn.sobra) + ' acima do mínimo' : moeda(-mn.sobra) + ' abaixo do mínimo') + '</small></div>' +
        '<div class="kpi"><span>' + (saoSugestoes ? 'Sugestões' : 'Metas') + ' + Direto</span><strong>' + moeda(chega) + '</strong><small>' + moeda(totMetas) + (saoSugestoes ? ' das sugestões + ' : ' das metas + ') + moeda(direto) + ' do Direto (média)' +
          (chega >= mn.valor ? ' · cobre o mínimo' : ' · não cobre o mínimo') + '</small></div></div>') +
      '<div class="colunas"><div><h3>De cada R$ 100 vendidos</h3><table class="tabela" data-sem-filtro><tbody>' +
        linha('Margem bruta', pct(mn.margem), 'venda − custo médio dos produtos, ' + base.map(m => R.mesCurto(m + '-01')).join(', ')) +
        linha('− Impostos sobre a venda', pct(mn.impostos), 'estimativa: ' + pct(mn.destacado) + ' de ICMS, PIS e COFINS destacados nas notas, sobre a margem (débito − crédito); o contador confirma') +
        linha('− Despesas variáveis', pct(mn.variaveis), mn.mesesVariaveis ? 'frete, combustível, tarifas e outras saídas avulsas do Caixa ÷ faturamento' : 'o Caixa ainda não tem um mês inteiro') +
        linha('− Comissões', pct(mn.comissao), 'estimativa sobre o faturamento total (o Direto não tem comissão)') +
        '<tr class="total"><td><strong>= Sobra para pagar os custos fixos</strong></td><td class="num"><strong>' + pct(mn.contribuicao) + '</strong></td></tr></tbody></table>' +
        '<form id="formMetasParam" class="form-plano"><p class="dica">Para trocar uma estimativa, escreva o número certo (vazio = calculado):</p><p>' +
          '<label class="filtro-inline">Impostos ' + campo('impostos_pct', cfg.impostos_pct, mn.impostosCalc) + '</label> ' +
          '<label class="filtro-inline">Variáveis ' + campo('variaveis_pct', cfg.variaveis_pct, mn.variaveisCalc) + '</label> ' +
          '<label class="filtro-inline">Comissões ' + campo('comissao_pct', cfg.comissao_pct, 3) + '</label> ' +
          '<button type="submit" class="btn sec">Recalcular</button></p></form></div>' +
      '<div><h3>Custos fixos do mês <small>' + moeda(mn.fixos) + ' · contas recorrentes do Caixa</small></h3><table class="tabela" data-sem-filtro><tbody>' +
        cats.map(c => linha(esc(c), moeda(mn.porCategoria[c]))).join('') + '</tbody></table>' +
        '<p class="dica">Sem compra de mercadoria (já está no custo dos produtos) e sem transferência entre as empresas. Mudou uma conta fixa? Ajuste em Caixa → Recorrentes.</p></div></div>' +
      '</section>';
  }

  function depoisConfig(el) {
    const sel = el.querySelector('#mesMeta');
    if (sel) sel.addEventListener('change', () => { mesTela = sel.value; CRM.render(); });
    const cr = el.querySelector('#metaCresc');
    if (cr) cr.addEventListener('change', async () => { try { await CRM.salvarConfig({ metas: Object.assign({}, cfgMetas(), { crescimento: Number(cr.value) || 0 }) }); CRM.render(); } catch (e) { CRM.falhou(e); } });
    const fp = el.querySelector('#formMetasParam');
    if (fp) fp.addEventListener('submit', async ev => {
      ev.preventDefault();
      const v = n => (fp.elements[n].value === '' ? null : Number(String(fp.elements[n].value).replace(',', '.')));
      try { await CRM.salvarConfig({ metas: Object.assign({}, cfgMetas(), { impostos_pct: v('impostos_pct'), variaveis_pct: v('variaveis_pct'), comissao_pct: v('comissao_pct') == null ? 3 : v('comissao_pct') }) }); CRM.toast('Conta do mínimo refeita.'); CRM.render(); } catch (e) { CRM.falhou(e); }
    });
    const f = el.querySelector('#formMetas');
    if (f) f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const d = dados(mesTela);
      if (!d) return;
      const mes = mesTela + '-01';
      try {
        for (const v of d.vendedores || []) {
          const ev1 = f.elements['m_' + v.user_id], ev2 = f.elements['n_' + v.user_id];
          const valor = ev1 && ev1.value !== '' ? Number(ev1.value) : null, novos = ev2 && ev2.value !== '' ? Math.max(0, Math.round(Number(ev2.value))) : null;
          const ex = (CRM.estado.D.metas || []).find(x => x.usuario_id === v.user_id && x.mes === mes);
          if (ex && valor == null && novos == null) await CRM.remover('metas', ex.id);
          else if (ex) await CRM.atualizar('metas', ex.id, { valor: valor || 0, clientes_novos: novos });
          else if (valor != null || novos != null) await CRM.inserir('metas', { usuario_id: v.user_id, mes, valor: valor || 0, clientes_novos: novos });
        }
        recarregar(mesTela);
        CRM.toast('Metas de ' + R.mesCurto(mes) + ' salvas.');
        CRM.render();
      } catch (e) { CRM.falhou(e); }
    });
  }
  CRM.acoes['metas-sugestao'] = () => {
    document.querySelectorAll('#formMetas input[data-sug]').forEach(i => { i.value = i.dataset.sug; i.dispatchEvent(new Event('input', { bubbles: true })); });
    CRM.toast('Sugestões colocadas. Confira e clique em "Salvar metas".');
  };

  // ================================================================ acompanhamento (Gestão, Relatórios e Início)
  // o: { so: user_id (só uma pessoa), titulo }
  function bloco(o) {
    o = o || {};
    const mes = mesAtual(), d = dados(mes);
    if (!d) return '';
    const hoje = CRM.hoje();
    const vs = (d.vendedores || []).filter(v => (!o.so || v.user_id === o.so) && v.meta && (Number(v.meta.valor) > 0 || v.meta.clientes_novos != null));
    if (!vs.length) return CRM.ehGestor() && !o.so ? '<section class="cartao"><h2>Metas de ' + esc(R.mesCurto(mes + '-01')) + '</h2><p class="vazio">Ainda sem metas para este mês. ' +
      (CRM.ehGestor() ? 'Defina em Configurações → Metas (o CRM sugere pelo histórico).' : '') + '</p></section>' : '';
    const ac = vs.map(v => ({ v, a: M.acompanha(v, v.meta, mes, hoje, util) }));
    const T = ac.reduce((t, x) => ({ valor: t.valor + x.a.valor, realizado: t.realizado + x.a.realizado, falta: t.falta + x.a.falta, novos: t.novos + x.a.novos, metaNovos: t.metaNovos + (x.a.metaNovos || 0) }),
      { valor: 0, realizado: 0, falta: 0, novos: 0, metaNovos: 0 });
    const a0 = ac[0].a;
    const ritmo = x => (x.projecao == null || !x.duRestantes ? '' : x.projecao >= x.valor ? '<span class="g-sobe">no ritmo: termina em ' + moeda(x.projecao) + '</span>' : '<span class="g-desce">no ritmo atual termina em ' + moeda(x.projecao) + '</span>');
    const linha = x => '<tr><td><strong>' + esc(x.v.nome) + '</strong></td>' +
      '<td class="num">' + moeda(x.a.valor) + '</td>' +
      '<td class="num"><strong>' + moeda(x.a.realizado) + '</strong>' + (x.a.semNota ? '<small>' + moeda(x.a.fat) + ' com nota + ' + moeda(x.a.semNota) + ' sem nota</small>' : '') + '</td>' +
      '<td>' + CRM.barra(x.a.realizado, x.a.valor || 1, x.a.pct == null ? '' : pct(x.a.pct)) + '<small>' + ritmo(x.a) + '</small></td>' +
      '<td class="num">' + (x.a.falta > 0 ? moeda(x.a.falta) + (x.a.porDia ? '<small>' + moeda(x.a.porDia) + ' por dia útil</small>' : '') : '<span class="g-sobe">batida ✓</span>') + '</td>' +
      '<td class="num">' + x.a.novos + (x.a.metaNovos != null ? ' de ' + x.a.metaNovos : '') + '</td></tr>';
    return '<section class="cartao metas-acomp"><h2>' + esc(o.titulo || 'Metas de ' + R.mesCurto(mes + '-01')) + ' <small>faturamento das notas + pedidos fechados sem nota · ' +
        a0.duPassados + ' de ' + a0.duTotal + ' dias úteis</small></h2>' +
      (vs.length > 1 ? '<div class="kpis"><div class="kpi azul ff-acumulado"><span>Realizado da equipe</span><strong>' + moeda(T.realizado) + '</strong><small>de ' + moeda(T.valor) +
          ' · ' + pct(T.valor ? T.realizado / T.valor * 100 : 0) + '</small></div><div class="kpi"><span>Falta</span><strong>' + moeda(T.falta) + '</strong><small>' +
          (a0.duRestantes ? moeda(T.falta / a0.duRestantes) + ' por dia útil · ' + a0.duRestantes + ' dias' : 'mês encerrado') + '</small></div>' +
          '<div class="kpi verde"><span>Clientes novos</span><strong>' + T.novos + (T.metaNovos ? ' de ' + T.metaNovos : '') + '</strong><small>1ª compra no mês</small></div></div>' : '') +
      '<div class="tabela-rolagem"><table class="tabela" data-sem-filtro><thead><tr><th>Vendedor(a)</th><th class="num">Meta</th><th class="num">Realizado</th><th>Andamento</th><th class="num">Falta</th><th class="num">Clientes novos</th></tr></thead><tbody>' +
        ac.map(linha).join('') + '</tbody></table></div></section>';
  }

  CRM.metas = { telaConfig, depoisConfig, bloco, recarregar };
})(typeof window !== 'undefined' ? window : globalThis);
