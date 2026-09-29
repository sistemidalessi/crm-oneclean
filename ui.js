/* CRM Sistemi Dalessi — utilidades de interface (sem regra de negócio).
   HTML montado em string, sempre passando por esc(). Nada inline (CSP). */
(function () {
  'use strict';
  const R = window.CRMRegras;
  const CRM = window.CRM = window.CRM || {};

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attr = (nome, v) => (v == null || v === false ? '' : ' ' + nome + (v === true ? '' : '="' + esc(v) + '"'));

  let toastTimer = null;
  function toast(msg, erro) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast mostra' + (erro ? ' erro' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, erro ? 6000 : 3000);
  }

  function falhou(e) {
    console.error(e);
    toast('Erro: ' + (e && e.message ? e.message : e), true);
  }

  function selo(texto, tipo, titulo) {
    return '<span class="selo ' + (tipo || '') + '"' + attr('title', titulo) + '>' + esc(texto) + '</span>';
  }

  const COR_SITUACAO = { lead: 'azul', prospect: 'roxo', cliente: 'verde', inativo: 'cinza' };
  function seloSituacao(s) { return selo(R.rotulo(R.SITUACOES, s), COR_SITUACAO[s]); }
  const COR_STATUS = { aberto: 'azul', ganho: 'verde', perdido: 'vermelho' };
  function seloStatus(s) { return selo(R.rotulo(R.STATUS_NEGOCIO, s), COR_STATUS[s]); }
  const COR_PROPOSTA = { rascunho: 'cinza', enviada: 'azul', aprovada: 'verde', recusada: 'vermelho' };
  function seloProposta(s) { return selo(R.rotulo(R.STATUS_PROPOSTA, s), COR_PROPOSTA[s]); }

  function estrelas(n) {
    n = Math.max(0, Math.min(5, R.num(n)));
    return n ? '<span class="estrelas" title="Qualificação ' + n + ' de 5">' + '★'.repeat(n) + '<span>' + '★'.repeat(5 - n) + '</span></span>' : '';
  }

  function avatar(usuario) {
    if (!usuario) return '<span class="avatar vazio" title="Sem responsável">?</span>';
    return '<span class="avatar" title="' + esc(usuario.nome) + '">' + esc(R.iniciais(usuario.nome)) + '</span>';
  }

  const ICONE_TIPO = { tarefa: '✓', ligacao: '☎', whatsapp: '✆', email: '✉', reuniao: '◷', visita: '⌂', proposta: '▤', nota: '✎', ocorrencia: '!', sistema: '↻' };
  function iconeTipo(t) { return '<span class="ico-tipo t-' + esc(t) + '" title="' + esc(R.rotulo(R.TIPOS_ATIVIDADE, t)) + '">' + (ICONE_TIPO[t] || '•') + '</span>'; }

  // Barras horizontais: largura aplicada por CSSOM depois do render (CSP proíbe style=).
  function barra(valor, maximo, texto) {
    const p = maximo > 0 ? Math.max(0, Math.min(100, valor / maximo * 100)) : 0;
    return '<span class="barra"><span class="barra-cheia" data-largura="' + p.toFixed(1) + '"></span></span>' + (texto ? '<span class="barra-texto">' + esc(texto) + '</span>' : '');
  }
  function aplicaBarras(el) {
    $$('[data-largura]', el).forEach(b => { b.style.width = b.dataset.largura + '%'; });
    $$('[data-altura]', el).forEach(b => { b.style.height = b.dataset.altura + '%'; });
  }

  function baixar(nome, conteudo, tipo) {
    const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function baixarCSV(nome, cabecalho, linhas) {
    baixar(nome + '-' + R.hojeISO() + '.csv', R.csvGera(cabecalho, linhas), 'text/csv;charset=utf-8');
  }

  function opcoesHTML(lista, valor) {
    return lista.map(o => '<option value="' + esc(o[0]) + '"' + (String(valor == null ? '' : valor) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
  }

  // ------------------------------------------------------------ formulário genérico
  // Campo: { nome, rotulo, tipo, opcoes, obrigatorio, largo, dica, ajuda, padrao, desabilitado, sugestoes, min, max }
  // tipos: texto, textarea, numero, data, hora, datahora, select, checkbox, email, tel, tags, estrelas, secao, info
  function campoHTML(c, v) {
    const val = v == null ? (c.padrao == null ? '' : c.padrao) : v;
    const cls = 'campo' + (c.largo ? ' largo' : '') + (c.terco ? ' terco' : '');
    const nome = esc(c.nome);
    const dis = c.desabilitado ? ' disabled' : '';
    const id = 'f_' + nome;
    if (c.tipo === 'secao') return '<h3 class="secao">' + esc(c.rotulo) + '</h3>';
    if (c.tipo === 'info') return '<p class="info largo">' + esc(c.rotulo) + '</p>';
    if (c.tipo === 'checkbox') {
      return '<label class="' + cls + ' check"><input type="checkbox" name="' + nome + '"' + (val ? ' checked' : '') + dis + '> ' + esc(c.rotulo) + '</label>';
    }
    let input;
    if (c.tipo === 'textarea') {
      input = '<textarea id="' + id + '" name="' + nome + '" rows="' + (c.linhas || 3) + '"' + dis + attr('placeholder', c.dica) + '>' + esc(val) + '</textarea>';
    } else if (c.tipo === 'select') {
      input = '<select id="' + id + '" name="' + nome + '"' + dis + '>' + opcoesHTML(c.opcoes, val) + '</select>';
    } else if (c.tipo === 'estrelas') {
      input = '<select id="' + id + '" name="' + nome + '"' + dis + '>' + opcoesHTML([[0, '—'], [1, '★'], [2, '★★'], [3, '★★★'], [4, '★★★★'], [5, '★★★★★']], val || 0) + '</select>';
    } else if (c.tipo === 'datahora') {
      const d = val ? R.diaLocal(val) : '';
      const h = val ? R.horaLocal(val) : '';
      input = '<span class="dupla"><input type="date" id="' + id + '" name="' + nome + '__dia" value="' + esc(d) + '"' + dis + '>' +
        '<input type="time" name="' + nome + '__hora" value="' + esc(h) + '"' + dis + ' aria-label="Hora"></span>';
    } else if (c.tipo === 'tags') {
      const lista = Array.isArray(val) ? val.join(', ') : val;
      input = '<input type="text" id="' + id + '" name="' + nome + '" value="' + esc(lista) + '" list="dl_' + nome + '"' + dis + attr('placeholder', c.dica || 'separe por vírgula') + '>' +
        '<datalist id="dl_' + nome + '">' + (c.sugestoes || []).map(s => '<option value="' + esc(s) + '">').join('') + '</datalist>';
    } else {
      const tipo = { numero: 'number', data: 'date', hora: 'time', email: 'email', tel: 'tel' }[c.tipo] || 'text';
      input = '<input type="' + tipo + '" id="' + id + '" name="' + nome + '" value="' + esc(val) + '"' + dis +
        (c.tipo === 'numero' ? ' step="' + (c.passo || '0.01') + '" min="' + (c.min == null ? 0 : c.min) + '"' + (c.max != null ? ' max="' + c.max + '"' : '') + ' inputmode="decimal"' : '') +
        attr('placeholder', c.dica) + (c.sugestoes ? ' list="dl_' + nome + '"' : '') + ' autocomplete="off">' +
        (c.sugestoes ? '<datalist id="dl_' + nome + '">' + c.sugestoes.map(s => '<option value="' + esc(s) + '">').join('') + '</datalist>' : '');
    }
    return '<label class="' + cls + '"' + attr('for', c.tipo === 'datahora' ? id : null) + '><span>' + esc(c.rotulo) + (c.obrigatorio ? ' *' : '') + '</span>' + input +
      (c.ajuda ? '<small>' + esc(c.ajuda) + '</small>' : '') + '<small class="aviso-campo" data-aviso="' + nome + '" hidden></small></label>';
  }

  function lerForm(form, campos) {
    const v = {};
    campos.forEach(c => {
      if (c.tipo === 'secao' || c.tipo === 'info' || c.desabilitado) return;
      if (c.tipo === 'datahora') {
        const d = form.elements[c.nome + '__dia'].value;
        const h = form.elements[c.nome + '__hora'].value;
        v[c.nome] = d ? R.momento(d, h || (c.horaPadrao || '09:00')) : null;
        return;
      }
      const el = form.elements[c.nome];
      if (!el) return;
      if (c.tipo === 'checkbox') { v[c.nome] = el.checked; return; }
      const bruto = String(el.value).trim();
      if (c.tipo === 'numero') v[c.nome] = bruto === '' ? (c.vazioNulo ? null : 0) : Number(bruto.replace(',', '.'));
      else if (c.tipo === 'estrelas') v[c.nome] = Number(bruto) || 0;
      else if (c.tipo === 'tags') v[c.nome] = [...new Set(bruto.split(/[,;]/).map(x => x.trim()).filter(Boolean))];
      else v[c.nome] = bruto === '' ? null : bruto;
    });
    return v;
  }

  // o: { titulo, intro, campos, valores, salvarTexto, aoSalvar(v, form), aoExcluir(), textoExcluir, largura, extras(form), rodape }
  let formSeq = 0;
  function abrirForm(o) {
    const dlg = $('#dlgForm');
    // aoSalvar pode abrir outro formulário no mesmo diálogo (ex.: próximo passo);
    // aí este não pode fechar o diálogo ao terminar.
    const meu = String(++formSeq);
    dlg.dataset.form = meu;
    const fechaSeMeu = () => { if (dlg.dataset.form === meu && dlg.open) dlg.close(); };
    dlg.className = 'dlg' + (o.largura ? ' ' + o.largura : '');
    dlg.innerHTML = '<form class="form" novalidate>' +
      '<header><h2>' + esc(o.titulo) + '</h2><button type="button" class="x" data-fechar aria-label="Fechar">×</button></header>' +
      '<div class="form-corpo">' +
      (o.intro ? '<p class="intro">' + esc(o.intro) + '</p>' : '') +
      (o.htmlAntes || '') +
      '<div class="campos">' + o.campos.map(c => campoHTML(c, (o.valores || {})[c.nome])).join('') + '</div>' +
      (o.htmlDepois || '') +
      '</div>' +
      '<p class="erro-form" hidden></p>' +
      '<footer>' + (o.aoExcluir ? '<button type="button" class="btn perigo" data-excluir>' + esc(o.textoBotaoExcluir || 'Excluir') + '</button>' : '') +
      (o.rodape || '') +
      '<span class="flex"></span><button type="button" class="btn sec" data-fechar>Cancelar</button>' +
      '<button type="submit" class="btn">' + esc(o.salvarTexto || 'Salvar') + '</button></footer></form>';

    const form = $('form', dlg);
    const erro = $('.erro-form', dlg);
    const mostraErro = m => { erro.textContent = m; erro.hidden = false; };

    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const v = lerForm(form, o.campos);
      const falta = o.campos.find(c => c.obrigatorio && !c.desabilitado && (v[c.nome] == null || v[c.nome] === '' || (Array.isArray(v[c.nome]) && !v[c.nome].length)));
      if (falta) {
        mostraErro('Preencha "' + falta.rotulo + '".');
        const el = form.elements[falta.nome] || form.elements[falta.nome + '__dia'];
        if (el && el.focus) el.focus();
        return;
      }
      const ruim = o.campos.find(c => c.tipo === 'numero' && v[c.nome] != null && (!isFinite(v[c.nome]) || v[c.nome] < (c.min == null ? 0 : c.min) || (c.max != null && v[c.nome] > c.max)));
      if (ruim) { mostraErro('"' + ruim.rotulo + '" está fora do permitido.'); return; }
      const botao = $('button[type=submit]', form);
      botao.disabled = true;
      try {
        const r = await o.aoSalvar(v, form);
        if (r !== false) fechaSeMeu();
      } catch (e) {
        console.error(e);
        mostraErro('Não foi possível salvar: ' + (e.message || e));
      } finally {
        botao.disabled = false;
      }
    });
    $$('[data-fechar]', dlg).forEach(b => b.addEventListener('click', () => dlg.close()));
    if (o.aoExcluir) {
      $('[data-excluir]', dlg).addEventListener('click', async () => {
        if (!confirm(o.textoExcluir || 'Excluir este registro?')) return;
        try { await o.aoExcluir(); fechaSeMeu(); } catch (e) { mostraErro('Não foi possível excluir: ' + e.message); }
      });
    }
    if (o.extras) o.extras(form, dlg);
    if (!dlg.open) dlg.showModal();
    const primeiro = $('.campos input:not([type=checkbox]):not([disabled]), .campos select:not([disabled]), .campos textarea:not([disabled])', form);
    if (primeiro && !o.semFoco) primeiro.focus();
    return form;
  }

  function avisoCampo(form, nome, html) {
    const el = $('[data-aviso="' + nome + '"]', form);
    if (!el) return;
    el.innerHTML = html || '';
    el.hidden = !html;
  }

  // Menu suspenso simples ancorado num botão (para "+ Novo", modelos de mensagem...).
  function menuFlutuante(ancora, itens) {
    fechaMenus();
    const m = document.createElement('div');
    m.className = 'menu-flutuante';
    m.innerHTML = itens.map((it, i) => it === '-' ? '<hr>' : '<button type="button" data-i="' + i + '">' + esc(it[0]) + (it[2] ? '<small>' + esc(it[2]) + '</small>' : '') + '</button>').join('');
    document.body.appendChild(m);
    const r = ancora.getBoundingClientRect();
    const larg = Math.max(220, r.width);
    m.style.minWidth = larg + 'px';
    const esquerda = Math.min(window.innerWidth - larg - 8, r.left);
    m.style.left = Math.max(8, esquerda) + 'px';
    const abaixo = r.bottom + 4;
    m.style.top = (abaixo + m.offsetHeight > window.innerHeight ? Math.max(8, r.top - m.offsetHeight - 4) : abaixo) + 'px';
    m.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-i]');
      if (!b) return;
      fechaMenus();
      itens[+b.dataset.i][1]();
    });
    // dentro de um <dialog> modal o menu precisa estar no mesmo top layer
    const dlg = ancora.closest('dialog');
    if (dlg) dlg.appendChild(m);
    setTimeout(() => document.addEventListener('click', fechaMenus, { once: true }), 0);
  }
  function fechaMenus() { $$('.menu-flutuante').forEach(m => m.remove()); }

  Object.assign(CRM, {
    $, $$, esc, attr, toast, falhou, selo, seloSituacao, seloStatus, seloProposta, estrelas, avatar, iconeTipo,
    barra, aplicaBarras, baixar, baixarCSV, opcoesHTML, campoHTML, lerForm, abrirForm, avisoCampo, menuFlutuante, fechaMenus
  });
})();
