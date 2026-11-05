/* "Esconder valores" (05/11/2026, pedido do Anderson no Caixa: "preciso de alguma coisa que eu consiga esconder os valores
 * quando precisar"). Vale para o sistema inteiro: ligado, todo valor em reais na tela (R$ 80.225,80, 1.302,60, −43.895,97)
 * fica borrado, inclusive o que aparece depois (abrir um bloco, rolar a grade, janela nova), os campos de dinheiro e o
 * valor que aparecia ao passar o mouse. Nomes, datas e quantidades continuam legíveis. Começa mostrando e volta a mostrar
 * ao recarregar a página (como o da Gestão, de 28/10). Botão no Caixa e na Gestão (CRM.botaoOcultar). */
(function () {
  'use strict';
  const CRM = window.CRM = window.CRM || {};
  // valor com centavos no formato brasileiro, com ou sem "R$" e sinal (não pega data, hora, quantidade nem código)
  const VALOR = /(?:[−-]\s?)?(?:R\$\s?)?(?:[−-]\s?)?\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/g;
  const PULA = 'script, style, textarea, .valor-oculto, [data-acao="valores-ocultar"]';
  let ligado = false, obs = null, agendado = false;

  function marca(raiz) {
    if (!raiz || !document.body) return;
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || n.nodeValue.indexOf(',') === -1) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || p.closest(PULA)) return NodeFilter.FILTER_REJECT;
        VALOR.lastIndex = 0;
        return VALOR.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nos = [];
    while (w.nextNode()) nos.push(w.currentNode);
    nos.forEach(n => {
      const t = n.nodeValue, f = document.createDocumentFragment();
      let i = 0, m;
      VALOR.lastIndex = 0;
      while ((m = VALOR.exec(t))) {
        if (m.index > i) f.appendChild(document.createTextNode(t.slice(i, m.index)));
        const s = document.createElement('span');
        s.className = 'valor-oculto';
        s.textContent = m[0];
        f.appendChild(s);
        i = m.index + m[0].length;
      }
      if (i < t.length) f.appendChild(document.createTextNode(t.slice(i)));
      n.parentNode.replaceChild(f, n);
    });
    // o valor também não aparece ao passar o mouse (title) — guarda para devolver ao mostrar
    const els = raiz.querySelectorAll ? raiz.querySelectorAll('[title]') : [];
    els.forEach(el => {
      if (el.closest('[data-acao="valores-ocultar"]')) return;
      VALOR.lastIndex = 0;
      if (VALOR.test(el.getAttribute('title'))) { el.setAttribute('data-title-oculto', el.getAttribute('title')); el.removeAttribute('title'); }
    });
  }

  function agenda() {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => {
      agendado = false;
      if (!ligado) return;
      obs.disconnect();
      marca(document.body);
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  }

  CRM.valoresOcultos = () => ligado;
  CRM.ocultarValores = (sim) => {
    ligado = sim == null ? !ligado : !!sim;
    document.body.classList.toggle('valores-ocultos', ligado);
    if (ligado) {
      if (!obs) obs = new MutationObserver(agenda);
      marca(document.body);
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    } else {
      if (obs) obs.disconnect();
      document.querySelectorAll('[data-title-oculto]').forEach(el => { el.setAttribute('title', el.getAttribute('data-title-oculto')); el.removeAttribute('data-title-oculto'); });
    }
    document.querySelectorAll('[data-acao="valores-ocultar"]').forEach(b => {
      b.setAttribute('aria-pressed', String(ligado));
      b.textContent = ligado ? '👁 Mostrar valores' : '🙈 Esconder valores';
    });
    if (CRM.render) CRM.render();   // a Gestão borra também as barras dos gráficos
  };
  CRM.botaoOcultar = (classe) => '<button type="button" class="' + (classe || 'btn sec') + '" data-acao="valores-ocultar" aria-pressed="' + ligado + '"' +
    ' title="Borra os valores em reais em todas as telas (para quando alguém estiver olhando); volta a mostrar ao clicar de novo ou ao recarregar a página">' +
    (ligado ? '👁 Mostrar valores' : '🙈 Esconder valores') + '</button>';
  CRM.acoes = CRM.acoes || {};
  CRM.acoes['valores-ocultar'] = () => CRM.ocultarValores();
})();
