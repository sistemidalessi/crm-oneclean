/* CRM Sistemi Dalessi — a mesma barra de pesquisa em todas as listas (28/10/2026, pedido do Anderson: "toda a aba, todo o
   módulo tem que ter esse tipo de relatório, de pesquisa… para a gente não ficar parando no dia a dia").
   Cada lista ganha, com uma chamada só: caixa de pesquisa (sem acento, sem maiúscula, várias palavras = todas têm de estar),
   período de/até, um seletor opcional, "mostrar mais" (nada some sem aviso) e "Baixar planilha" com TUDO o que o filtro achou.

     const st = CRM.Lista.estado('nfe');                             // { busca, de, ate, sel, limite }
     const l = CRM.Lista.filtra('nfe', todas, { texto: n => [n.numero, n.cliente], data: n => n.emitida_em });
     html = CRM.Lista.barra('nfe', { periodo: true, total: todas.length, achados: l.length, sel: [['', 'Todas'], ['x', 'X']] }) +
            tabela(CRM.Lista.corta('nfe', l, 100)) + CRM.Lista.mais('nfe', l, 100);
     CRM.Lista.planilha('nfe', 'notas', ['NF', 'Cliente'], () => l.map(n => [n.numero, n.cliente]));

   O estado fica na memória da sessão (volta ao mesmo filtro ao voltar à tela). As mudanças redesenham a tela (CRM.render), e
   o app devolve o cursor à caixa pelo id. Puro na parte de filtrar (testes/listas.test.js). */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  const sem = s => (R && R.normaliza ? R.normaliza(s) : String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim());
  const digitos = s => String(s == null ? '' : s).replace(/\D/g, '');

  // a pesquisa casa se TODAS as palavras aparecem em algum campo; número com pontuação ("08.867.451/0001-32", "2-15")
  // também casa só pelos dígitos
  function casa(busca, campos) {
    const ps = sem(busca).split(/\s+/).filter(Boolean);
    if (!ps.length) return true;
    const lista = (Array.isArray(campos) ? campos : [campos]).filter(x => x != null && x !== '');
    const txt = sem(lista.join(' | ')), dig = lista.map(digitos).join(' | ');
    return ps.every(p => txt.indexOf(p) !== -1 || (/\d/.test(p) && digitos(p).length >= 2 && dig.indexOf(digitos(p)) !== -1));
  }
  // dia (AAAA-MM-DD) de uma data ou momento, no horário de São Paulo
  function dia(v) {
    if (!v) return '';
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (R && R.diaLocal) return R.diaLocal(s) || s.slice(0, 10);
    return s.slice(0, 10);
  }
  // filtra pelas regras do estado st: { busca, de, ate, sel }; o: { texto(l) → campos, data(l) → data, sel(l, valor) → bool }
  function aplica(st, linhas, o) {
    o = o || {};
    return (linhas || []).filter(l => {
      if (st.busca && o.texto && !casa(st.busca, o.texto(l))) return false;
      if ((st.de || st.ate) && o.data) {
        const d = dia(o.data(l));
        if (!d) return false;
        if (st.de && d < st.de) return false;
        if (st.ate && d > st.ate) return false;
      }
      if (st.sel && o.sel && !o.sel(l, st.sel)) return false;
      return true;
    });
  }

  const C = { casa, dia, aplica };
  raiz.CRMListas = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  if (typeof document === 'undefined' || !raiz.CRM) return;

  // ================================================================== tela (só no navegador)
  const CRM = raiz.CRM, esc = s => CRM.esc(s);
  const estados = {}, planilhas = {};
  const estado = (id, padrao) => estados[id] || (estados[id] = Object.assign({ busca: '', de: '', ate: '', sel: '', limite: 0 }, padrao || {}));
  const filtra = (id, linhas, o) => aplica(estado(id), linhas, o);
  const corta = (id, l, n) => l.slice(0, Math.max(n, estado(id).limite || 0));
  // "Mostrar mais": diz quantos faltam, e a planilha leva todos
  function mais(id, l, n) {
    const vis = Math.max(n, estado(id).limite || 0);
    if (l.length <= vis) return '';
    return '<p class="dica lista-mais">Mostrando ' + vis + ' de ' + l.length + '. <button type="button" class="mini" data-acao="ls-mais" data-id="' + esc(id + '|' + (vis + n)) + '">Mostrar mais ' +
      Math.min(n, l.length - vis) + '</button> <button type="button" class="mini" data-acao="ls-mais" data-id="' + esc(id + '|' + l.length) + '">Mostrar todos</button>' +
      (planilhas[id] ? ' · a planilha leva todos' : '') + '</p>';
  }
  // o: { periodo, rotuloPeriodo, sel: [[valor, rótulo]…], rotuloSel, placeholder, total, achados, csv (false = sem botão), extra (html) }
  function barra(id, o) {
    o = o || {};
    const st = estado(id), sid = 'ls_' + id.replace(/[^a-z0-9]/gi, '_');
    const filtrado = st.busca || st.de || st.ate || st.sel;
    return '<div class="lista-barra" data-ls="' + esc(id) + '">' +
      '<label class="lista-busca"><span class="sr">Pesquisar</span><input type="search" id="' + sid + '_b" data-ls-busca="' + esc(id) + '" value="' + esc(st.busca) + '" placeholder="' + esc(o.placeholder || 'Pesquisar…') + '"></label>' +
      (o.sel ? '<label class="filtro-inline">' + esc(o.rotuloSel || '') + ' <select id="' + sid + '_s" data-ls-sel="' + esc(id) + '">' + CRM.opcoesHTML(o.sel, st.sel) + '</select></label>' : '') +
      (o.periodo ? '<label class="filtro-inline">' + esc(o.rotuloPeriodo || 'De') + ' <input type="date" id="' + sid + '_de" data-ls-de="' + esc(id) + '" value="' + esc(st.de) + '"></label>' +
        '<label class="filtro-inline">até <input type="date" id="' + sid + '_ate" data-ls-ate="' + esc(id) + '" value="' + esc(st.ate) + '"></label>' : '') +
      (filtrado ? '<button type="button" class="mini" data-acao="ls-limpa" data-id="' + esc(id) + '">limpar</button>' : '') +
      (o.extra || '') +
      (o.csv === false ? '' : '<button type="button" class="btn sec" data-acao="ls-csv" data-id="' + esc(id) + '">Baixar planilha</button>') +
      (o.total != null ? '<small class="lista-conta">' + (filtrado && o.achados != null ? o.achados + ' de ' + o.total : o.total) + '</small>' : '') +
      '</div>';
  }
  // a planilha é o que o filtro achou AGORA (a função é chamada no clique)
  function planilha(id, nome, cabecalho, linhas) { planilhas[id] = { nome, cabecalho, linhas }; }
  const muda = (id, chave, v) => { const st = estado(id); st[chave] = v; st.limite = 0; CRM.render(); };

  let espera = null;
  document.addEventListener('input', ev => {
    const t = ev.target;
    if (!t || !t.dataset) return;
    if (t.dataset.lsBusca) { const id = t.dataset.lsBusca, v = t.value; clearTimeout(espera); espera = setTimeout(() => muda(id, 'busca', v), 180); }
  });
  document.addEventListener('change', ev => {
    const t = ev.target;
    if (!t || !t.dataset) return;
    if (t.dataset.lsDe) muda(t.dataset.lsDe, 'de', t.value);
    else if (t.dataset.lsAte) muda(t.dataset.lsAte, 'ate', t.value);
    else if (t.dataset.lsSel) muda(t.dataset.lsSel, 'sel', t.value);
  });
  Object.assign(CRM.acoes, {
    'ls-mais': v => { const i = String(v).lastIndexOf('|'); estado(v.slice(0, i)).limite = Number(v.slice(i + 1)) || 0; CRM.render(); },
    'ls-limpa': id => { Object.assign(estado(id), { busca: '', de: '', ate: '', sel: '', limite: 0 }); CRM.render(); },
    'ls-csv': id => {
      const p = planilhas[id];
      if (!p) { CRM.toast('Nada para baixar aqui.', true); return; }
      const l = p.linhas();
      if (!l.length) { CRM.toast('A pesquisa não achou nada para baixar.', true); return; }
      CRM.baixarCSV(p.nome, p.cabecalho, l);
    }
  });
  CRM.Lista = { estado, filtra, corta, mais, barra, planilha, casa, dia };
})(typeof window !== 'undefined' ? window : globalThis);
