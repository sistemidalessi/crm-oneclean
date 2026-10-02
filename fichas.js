/* CRM Sistemi Dalessi — fichas (cliente e negócio), formulários de cadastro,
   comunicação (WhatsApp / ligação / e-mail com registro automático),
   propostas imprimíveis e ações em massa. */
(function () {
  'use strict';
  const R = window.CRMRegras, CRM = window.CRM;
  const { $, $$, esc } = CRM;
  const E = () => CRM.estado;

  const fichas = CRM.fichas = {};
  let abertaEmpresa = null, abertoNegocio = null;
  const filtroLinha = { tipo: '' };

  // ------------------------------------------------------------ utilidades
  const agoraISO = () => new Date().toISOString();
  function proximaHora() {
    const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
    if (d.getHours() >= 18) { d.setDate(d.getDate() + 1); d.setHours(9); }
    return d.toISOString();
  }
  const principal = id => { const l = CRM.doEmpresa('contatos', id); return l.find(c => c.principal) || l[0] || null; };
  const telDe = (e, c) => (c && (c.whatsapp || c.celular || c.telefone)) || (e && (e.whatsapp || e.telefone)) || '';

  function datalistEmpresas() {
    return '<datalist id="dlEmpresas">' + E().D.empresas.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map(e => '<option value="' + esc(e.nome) + '">' + esc([e.cidade, CRM.nomeUsuario(e.responsavel_id)].filter(Boolean).join(' · ')) + '</option>').join('') + '</datalist>';
  }
  function resolveEmpresa(nome) {
    const n = R.normaliza(nome);
    const l = E().D.empresas.filter(e => R.normaliza(e.nome) === n);
    if (!l.length) throw new Error('empresa "' + nome + '" não encontrada. Cadastre primeiro como lead (tecla N).');
    return l[0];
  }
  const campoEmpresa = (pre) => ({ nome: 'empresa_nome', rotulo: 'Empresa', obrigatorio: true, largo: true, dica: 'comece a digitar…', padrao: pre && pre.empresa_id ? CRM.nomeEmpresa(pre.empresa_id) : '' });
  function ligaDatalist(form) {
    const el = form.elements.empresa_nome;
    if (el) el.setAttribute('list', 'dlEmpresas');
  }

  // Aviso enquanto digita: mesmo CNPJ/CPF, telefone ou e-mail de outra empresa (consulta todas
  // as carteiras, pelo banco) trava o cadastro; mesmo nome ou dado de uma pessoa de contato só avisa.
  let timerDup = null;
  function checaDuplicado(form, ignorarId) {
    const v = n => (form.elements[n] ? form.elements[n].value : '');
    const nome = R.chaveNome(v('nome'));
    const mesmoNome = nome.length >= 4 ? E().D.empresas.filter(e => e.id !== ignorarId && R.chaveNome(e.nome) === nome).slice(0, 3) : [];
    const daEmpresa = { cnpj: v('cnpj'), telefones: [v('telefone'), v('whatsapp')], emails: [v('email')] };
    const doContato = { telefones: [v('contato_telefone')], emails: [v('contato_email')] };
    clearTimeout(timerDup);
    timerDup = setTimeout(async () => {
      let a = [], b = [];
      try { [a, b] = await Promise.all([CRM.duplicados(daEmpresa, ignorarId), v('contato_telefone') || v('contato_email') ? CRM.duplicados(doContato, ignorarId) : []]); } catch (e) { console.error(e); }
      const nomeDe = x => CRM.empresa(x.empresa_id) ? '<button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(x.empresa_id) + '">' + esc(x.nome) + '</button>' : '<strong>' + esc(x.nome) + '</strong>';
      const trava = a.filter(x => x.de_empresa);
      const vistos = new Set(trava.map(x => x.empresa_id));
      const avisos = a.filter(x => !x.de_empresa).concat(b).filter(x => !vistos.has(x.empresa_id) && vistos.add(x.empresa_id))
        .concat(mesmoNome.filter(e => !vistos.has(e.id)).map(e => ({ empresa_id: e.id, nome: e.nome, responsavel: CRM.nomeUsuario(e.responsavel_id), campo: 'mesmo nome' })));
      const txt = l => l.slice(0, 3).map(x => nomeDe(x) + ' (' + esc(x.campo) + ' · carteira: ' + esc(x.responsavel) + ')').join(', ');
      CRM.avisoCampo(form, 'nome', trava.length ? '⛔ Já cadastrado: ' + txt(trava) + '. Não dá para salvar outro com o mesmo CNPJ, telefone ou e-mail.'
        : avisos.length ? '⚠ Parecido: ' + txt(avisos) + '. Confira se não é o mesmo cliente.' : '');
    }, 350);
  }

  // ------------------------------------------------------------ ficha do cliente
  fichas.abrirEmpresa = id => {
    if (!CRM.empresa(id)) { CRM.toast('Esta empresa é da carteira de outro vendedor.', true); return; }
    abertaEmpresa = id;
    filtroLinha.tipo = '';
    const dlg = $('#dlgEmpresa');
    renderEmpresa();
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  };

  fichas.renderAbertas = () => {
    if (abertaEmpresa && $('#dlgEmpresa').open) renderEmpresa();
    if (abertoNegocio && $('#dlgNegocio').open) renderNegocio();
  };

  function renderEmpresa() {
    const dlg = $('#dlgEmpresa');
    const e = CRM.empresa(abertaEmpresa);
    if (!e) { if (dlg.open) dlg.close(); return; }
    const rasc = $('#regTexto', dlg) ? { texto: $('#regTexto', dlg).value, tipo: ($('input[name=regTipo]:checked', dlg) || {}).value } : null;
    const pode = CRM.podeEditarEmpresa(e);
    const r = CRM.resumo(e.id);
    const contatos = CRM.doEmpresa('contatos', e.id).slice().sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0) || a.nome.localeCompare(b.nome, 'pt-BR'));
    const negs = CRM.doEmpresa('negocios', e.id);
    const abertos = negs.filter(n => n.status === 'aberto');
    const fechados = negs.filter(n => n.status !== 'aberto').sort((a, b) => ((b.fechado_em || '') < (a.fechado_em || '') ? -1 : 1));
    const ativs = CRM.doEmpresa('atividades', e.id);
    const pendentes = ativs.filter(a => !a.concluida).sort((a, b) => (a.data_hora < b.data_hora ? -1 : 1));
    const hist = ativs.filter(a => a.concluida && (!filtroLinha.tipo || (filtroLinha.tipo === 'contatos' ? ['ligacao', 'whatsapp', 'email', 'reuniao', 'visita'].indexOf(a.tipo) !== -1 : a.tipo === filtroLinha.tipo)))
      .sort((a, b) => ((b.concluida_em || b.data_hora) > (a.concluida_em || a.data_hora) ? 1 : -1));
    const props = [].concat(...negs.map(n => CRM.doNegocio('propostas', n.id)));
    const endereco = [[e.logradouro, e.numero].filter(Boolean).join(', '), e.complemento, e.bairro, [e.cidade, e.uf].filter(Boolean).join('/'), e.cep].filter(Boolean).join(' · ');
    const dado = (rot, v) => (v ? '<dt>' + esc(rot) + '</dt><dd>' + v + '</dd>' : '');
    const sit = CRM.situacao(e);
    const ganhos = fechados.filter(n => n.status === 'ganho');
    const notas = (E().ix.porEmpresa.notas.get(e.id) || []).slice().sort((a, b) => String(b.emitida_em).localeCompare(String(a.emitida_em)));
    // Matriz e filiais (ou unidades do mesmo cliente): cada CNPJ é um cadastro, ligado pelo grupo.
    const principal = (e.grupo_id && CRM.empresa(e.grupo_id)) || e;
    const doGrupo = [principal].concat(E().D.empresas.filter(x => x.grupo_id === principal.id));
    const linkEmp = x => '<button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(x.id) + '">' + esc(x.nome) + '</button>';
    const desde = R.somaDias(CRM.hoje(), -365);
    const fatGrupo = doGrupo.reduce((t, x) => t + (E().ix.porEmpresa.notas.get(x.id) || []).filter(n => !n.cancelada && R.diaLocal(n.emitida_em) >= desde).reduce((s, n) => s + R.num(n.valor_total), 0), 0);
    const grupo = doGrupo.length < 2 ? '' : (e.grupo_id ? 'Unidade de ' + linkEmp(principal) : '<strong>Principal</strong> do grupo') +
      '<br><small>' + doGrupo.filter(x => x.id !== e.id).map(linkEmp).join(' · ') + '</small>' +
      '<br><small>' + doGrupo.length + ' cadastro(s) · faturado pelo grupo em 12 meses: ' + esc(R.moeda(fatGrupo)) + '</small>';

    dlg.innerHTML = '<div class="ficha">' +
      '<header class="ficha-topo"><div class="ficha-titulo"><h2>' + esc(e.nome) + '</h2>' + CRM.seloSituacao(sit) + CRM.seloTipoCliente(e, true) + (CRM.seloFinanceiro ? CRM.seloFinanceiro(e.id, true) : '') + CRM.estrelas(e.qualificacao) +
        (e.tags || []).map(t => CRM.selo(t, 'etiqueta')).join('') +
        '<span class="resp">' + CRM.avatar(CRM.usuario(e.responsavel_id)) + esc(CRM.nomeUsuario(e.responsavel_id)) + '</span></div>' +
        '<span class="flex"></span>' +
        '<button type="button" class="btn sec wa" data-acao="whatsapp" data-id="' + esc(e.id) + '">WhatsApp</button>' +
        '<button type="button" class="btn sec" data-acao="ligar" data-id="' + esc(e.id) + '">Ligar</button>' +
        '<button type="button" class="btn sec" data-acao="email" data-id="' + esc(e.id) + '">E-mail</button>' +
        '<button type="button" class="btn sec" data-acao="negocio-empresa">+ Negócio</button>' +
        '<button type="button" class="btn sec" data-acao="tarefa-empresa">+ Tarefa</button>' +
        (pode ? '<button type="button" class="btn sec" data-acao="editar-empresa">Editar</button>' : '') +
        '<button type="button" class="x" data-acao="fechar-empresa" aria-label="Fechar">×</button></header>' +
      '<div class="ficha-corpo tres">' +
      // ---- coluna 1: dados + contatos
      '<div class="ficha-col">' +
        '<section><dl class="dados">' +
          dado('Grupo', grupo) + dado('Razão social', esc(e.razao_social)) + dado('CNPJ/CPF', esc(e.cnpj) + (e.cnpj && R.digitos(e.cnpj).length === 14 && !R.cnpjValido(e.cnpj) ? ' ' + CRM.selo('inválido?', 'ambar') : '')) +
          dado('Telefone', esc(e.telefone)) + dado('WhatsApp', esc(e.whatsapp)) +
          dado('E-mail', e.email ? (separaEmails(e.email).length ? separaEmails(e.email).map(m => '<a href="mailto:' + esc(m) + '">' + esc(m) + '</a>').join('<br>') : esc(e.email)) : '') +
          dado('Site', e.site ? '<a href="' + esc(/^https?:/i.test(e.site) ? e.site : 'https://' + e.site) + '" target="_blank" rel="noopener noreferrer">' + esc(e.site) + '</a>' : '') +
          dado('Endereço', endereco ? '<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(endereco) + '" target="_blank" rel="noopener noreferrer">' + esc(endereco) + '</a>' : '') +
          dado('Segmento', esc(e.segmento)) + dado('Origem', esc(e.origem)) +
          dado('Recompra', e.ciclo_recompra_dias ? 'a cada ' + e.ciclo_recompra_dias + ' dias' : '') +
          dado('Cadastro', esc(R.dataBR(e.criado_em))) +
        '</dl>' + (e.observacoes ? '<p class="obs">' + esc(e.observacoes) + '</p>' : '') + '</section>' +
        '<section><h3>Pessoas <button type="button" class="mini" data-acao="novo-contato">+ pessoa</button></h3>' +
        (contatos.length ? '<ul class="lista contatos">' + contatos.map(c => '<li><button type="button" class="linha" data-acao="editar-contato" data-id="' + esc(c.id) + '">' +
          '<strong>' + esc(c.nome) + (c.principal ? ' ★' : '') + '</strong><small>' + esc([c.cargo, c.whatsapp || c.celular, c.telefone, c.email].filter(Boolean).join(' · ')) + '</small></button>' +
          CRM.acoesRapidas(e.id, c.id) + '</li>').join('') + '</ul>'
          : '<p class="vazio">Nenhuma pessoa cadastrada.</p>') + '</section>' +
      '</div>' +
      // ---- coluna 2: registrar + histórico
      '<div class="ficha-col historico">' +
        '<form id="formRegistroRapido" class="registro">' +
          '<div class="chips">' + R.TIPOS_MANUAIS.filter(t => t[0] !== 'tarefa' && t[0] !== 'proposta').map((t, i) =>
            '<label class="chip"><input type="radio" name="regTipo" value="' + t[0] + '"' + ((rasc && rasc.tipo ? rasc.tipo === t[0] : i === 0) ? ' checked' : '') + '>' + CRM.iconeTipo(t[0]) + ' ' + esc(t[1]) + '</label>').join('') + '</div>' +
          '<textarea id="regTexto" rows="2" placeholder="O que aconteceu? (resultado da ligação, o que foi combinado…)">' + esc(rasc ? rasc.texto : '') + '</textarea>' +
          '<div class="linha-form">' +
            (contatos.length ? '<select id="regContato" aria-label="Pessoa"><option value="">com quem?</option>' + contatos.map(c => '<option value="' + esc(c.id) + '">' + esc(c.nome) + '</option>').join('') + '</select>' : '') +
            (abertos.length ? '<select id="regNegocio" aria-label="Negócio"><option value="">negócio (opcional)</option>' + abertos.map(n => '<option value="' + esc(n.id) + '">' + esc(n.titulo) + '</option>').join('') + '</select>' : '') +
            '<button type="submit" class="btn">Registrar</button>' +
            '<button type="submit" class="btn sec" data-proximo="1" title="Registra e já agenda o próximo passo">Registrar + próximo passo</button>' +
          '</div></form>' +
        '<div class="filtro-linha">' + [['', 'Tudo'], ['contatos', 'Contatos'], ['proposta', 'Propostas'], ['ocorrencia', 'Ocorrências'], ['nota', 'Anotações'], ['sistema', 'Movimentações']].map(t =>
          '<button type="button" class="chip-filtro' + (filtroLinha.tipo === t[0] ? ' ativo' : '') + '" data-acao="filtro-linha" data-id="' + t[0] + '">' + esc(t[1]) + '</button>').join('') +
          (CRM.ehGestor() && CRM.store().modo === 'supabase' ? '<button type="button" class="chip-filtro" data-acao="alteracoes-empresa">Alterações</button>' : '') + '</div>' +
        '<div id="alteracoes"></div>' +
        (hist.length ? '<ol class="linha-tempo">' + hist.slice(0, 300).map(a => itemHistorico(a)).join('') + '</ol>' + (hist.length > 300 ? '<p class="mais">mostrando os 300 mais recentes</p>' : '') : '<p class="vazio">Nada registrado ainda.</p>') +
      '</div>' +
      // ---- coluna 3: próximo passo, negócios, compras
      '<div class="ficha-col">' +
        '<section class="' + (pendentes.length ? '' : 'sem-proximo') + '"><h3>Próximo passo <button type="button" class="mini" data-acao="tarefa-empresa">+ tarefa</button></h3>' +
          (pendentes.length ? '<ul class="lista tarefas">' + pendentes.map(a => CRM.itemTarefa(a, { resp: true })).join('') + '</ul>' : '<p class="vazio alerta">Nenhum próximo passo agendado.</p>') + '</section>' +
        (CRM.fichaFinanceiro ? CRM.fichaFinanceiro(e.id) : '') +
        '<section><h3>Negócios em andamento <button type="button" class="mini" data-acao="negocio-empresa">+ negócio</button></h3>' +
          (abertos.length ? abertos.map(n => cartaoNegocio(n)).join('') : '<p class="vazio">Nenhum.</p>') + '</section>' +
        '<section><h3>Compras e negócios anteriores</h3>' +
          (r.compras ? '<p class="resumo-compras"><strong>' + esc(R.moeda(r.totalComprado)) + '</strong> em ' + r.compras + ' compra(s) · ticket ' + esc(R.moeda(r.totalComprado / r.compras)) +
            '<br>última em ' + esc(R.dataBR(r.ultimaCompra)) + ' (' + R.diasEntre(r.ultimaCompra, CRM.hoje()) + ' dias)' +
            (r.ritmo ? '<br>ritmo: compra a cada <strong>~' + r.ritmo + ' dias</strong> · próxima prevista ' + esc(R.dataBR(R.somaDias(r.ultimaCompra, R.cicloRecompra(e, r, E().cfg)))) +
              (R.num(e.ciclo_recompra_dias) ? ' <small>(ciclo definido no cadastro: ' + R.num(e.ciclo_recompra_dias) + ' dias)</small>' : '')
              : r.compras > 1 ? ' · compra a cada ~' + intervaloMedio(r.datasCompras || ganhos.map(n => n.fechado_em)) + ' dias' : '') +
            (r.fonteCompras === 'notas' ? '<br><small>pelas notas fiscais</small>' : '') + '</p>' + itensDaFicha(e) : '') +
          (notas.length ? '<div class="notas-cliente"><h3>Notas fiscais <small>' + notas.length + '</small></h3>' + notas.slice(0, 15).map(itemNota).join('') +
            (notas.length > 15 ? '<p class="mais">mostrando as 15 mais recentes</p>' : '') + '</div>' : '') +
          (fechados.length ? '<ul class="lista">' + fechados.slice(0, 30).map(n => '<li><button type="button" class="linha" data-acao="abrir-negocio" data-id="' + esc(n.id) + '"><strong>' + esc(n.titulo) + '</strong>' +
            '<small>' + CRM.seloStatus(n.status) + ' ' + esc(R.dataBR(n.fechado_em)) + ' · ' + esc(R.moeda(n.valor)) + (n.motivo_perda ? ' · ' + esc(n.motivo_perda) : '') + '</small></button></li>').join('') + '</ul>' : (notas.length ? '' : '<p class="vazio">Nenhum ainda.</p>')) + '</section>' +
        (props.length ? '<section><h3>Propostas</h3><ul class="lista">' + props.sort((a, b) => b.numero - a.numero).map(p => '<li><button type="button" class="linha" data-acao="abrir-negocio" data-id="' + esc(p.negocio_id) + '">' +
          '<strong>#' + esc(p.numero) + ' · ' + esc(R.moeda(p.valor_total)) + '</strong><small>' + CRM.seloProposta(p.status) + ' ' + esc(p.enviada_em ? 'enviada ' + R.dataBR(p.enviada_em) : '') + '</small></button></li>').join('') + '</ul></section>' : '') +
      '</div></div></div>';

    $('#formRegistroRapido', dlg).addEventListener('submit', ev => registrarRapido(ev, e));
  }

  function itemNota(n) {
    const itens = (E().ix.porNota.get(n.id) || []).slice().sort((a, b) => a.ordem - b.ordem);
    return '<details><summary>' + esc(R.dataBR(R.diaLocal(n.emitida_em))) + ' · NF ' + esc(n.numero || '') + (n.cancelada ? ' <span class="selo vermelho">cancelada</span>' : '') +
      '<strong>' + esc(R.moeda(n.valor_total)) + '</strong></summary><ul>' +
      itens.map(it => '<li>' + esc(R.numero(it.quantidade)) + ' ' + esc(it.unidade || '') + ' · ' + esc(it.descricao) + ' — ' + esc(R.moeda(it.valor_total)) + '</li>').join('') + '</ul></details>';
  }

  function itensDaFicha(e) {
    const itens = R.itensHabituais(E().ix, e.id);
    if (!itens.length) return '';
    return '<div class="itens-habituais"><h3>Costuma levar <small>nas últimas ' + itens[0].de + ' compras</small> <button type="button" class="mini wa" data-acao="whatsapp-recompra" data-id="' + esc(e.id) + '">WhatsApp de recompra</button></h3><ul>' +
      itens.map(it => '<li>' + esc(R.nomeDeItem(it.descricao)) + ' <small>' + esc(String(+Number(it.quantidade).toFixed(3)).replace('.', ',') + ' ' + (it.unidade || '')) + ' · em ' + it.vezes + ' de ' + it.de + '</small></li>').join('') + '</ul></div>';
  }

  function intervaloMedio(datasCompras) {
    const datas = datasCompras.filter(Boolean).sort();
    if (datas.length < 2) return '—';
    return Math.round(R.diasEntre(datas[0], datas[datas.length - 1]) / (datas.length - 1));
  }

  function cartaoNegocio(n) {
    const et = CRM.etapa(n.etapa_id);
    return '<button type="button" class="mini-card" data-acao="abrir-negocio" data-id="' + esc(n.id) + '"><strong>' + esc(n.titulo) + '</strong>' +
      '<span>' + esc(R.moeda(n.valor)) + ' · ' + esc(et ? et.nome : '—') + '</span><small>' + esc(CRM.nomeUsuario(n.responsavel_id)) +
      (n.previsao_fechamento ? ' · prev. ' + esc(R.dataBR(n.previsao_fechamento)) : '') + '</small></button>';
  }

  function itemHistorico(a) {
    const neg = a.negocio_id && CRM.negocio(a.negocio_id);
    const c = a.contato_id && CRM.contato(a.contato_id);
    const editavel = a.tipo !== 'sistema' && (CRM.ehGestor() || a.responsavel_id === CRM.meuId() || a.criado_por === CRM.meuId());
    return '<li class="t-' + esc(a.tipo) + '"><div class="lt-cab">' + CRM.iconeTipo(a.tipo) + '<span class="tipo">' + esc(R.rotulo(R.TIPOS_ATIVIDADE, a.tipo)) + '</span>' +
      '<time>' + esc(R.dataHoraBR(a.concluida_em || a.data_hora)) + '</time><span class="quem">' + esc(R.primeiroNome(CRM.nomeUsuario(a.responsavel_id))) + '</span>' +
      (c ? '<span class="quem">com ' + esc(c.nome) + '</span>' : '') +
      (neg ? '<button type="button" class="link" data-acao="abrir-negocio" data-id="' + esc(neg.id) + '">' + esc(neg.titulo) + '</button>' : '') +
      (editavel ? '<button type="button" class="mini" data-acao="editar-registro" data-id="' + esc(a.id) + '">editar</button>' : '') +
      '</div><p>' + esc(a.descricao) + '</p></li>';
  }

  async function registrarRapido(ev, e) {
    ev.preventDefault();
    const dlg = $('#dlgEmpresa');
    const texto = $('#regTexto', dlg).value.trim();
    const tipo = ($('input[name=regTipo]:checked', dlg) || {}).value || 'nota';
    const proximo = ev.submitter && ev.submitter.dataset.proximo;
    if (!texto) { CRM.toast('Escreva o que aconteceu.', true); $('#regTexto', dlg).focus(); return; }
    const neg = $('#regNegocio', dlg) ? $('#regNegocio', dlg).value || null : null;
    try {
      await CRM.inserir('atividades', { empresa_id: e.id, tipo, descricao: texto, concluida: true, concluida_em: agoraISO(), data_hora: agoraISO(),
        responsavel_id: CRM.meuId(), contato_id: $('#regContato', dlg) ? $('#regContato', dlg).value || null : null, negocio_id: neg });
      $('#regTexto', dlg).value = '';
      CRM.toast('Registrado.');
      renderEmpresa();
      if (proximo) fichas.formTarefa(null, { empresa_id: e.id, negocio_id: neg }, 'Qual o próximo passo?');
    } catch (x) { CRM.falhou(x); }
  }

  // ------------------------------------------------------------ ficha do negócio
  fichas.abrirNegocio = id => {
    if (!CRM.negocio(id)) { CRM.toast('Negócio não encontrado (pode ser de outro vendedor).', true); return; }
    abertoNegocio = id;
    const dlg = $('#dlgNegocio');
    renderNegocio();
    if (!dlg.open) dlg.showModal();
  };

  function renderNegocio() {
    const dlg = $('#dlgNegocio');
    const n = CRM.negocio(abertoNegocio);
    if (!n) { if (dlg.open) dlg.close(); return; }
    const pode = CRM.podeEditarNegocio(n);
    const et = CRM.etapa(n.etapa_id);
    const etapas = CRM.etapas(et ? et.funil : CRM.funis()[0]);
    const itens = CRM.doNegocio('negocio_itens', n.id).slice().sort((a, b) => a.ordem - b.ordem);
    const props = CRM.doNegocio('propostas', n.id).slice().sort((a, b) => b.numero - a.numero);
    const ativs = CRM.doNegocio('atividades', n.id);
    const pend = ativs.filter(a => !a.concluida).sort((a, b) => (a.data_hora < b.data_hora ? -1 : 1));
    const hist = ativs.filter(a => a.concluida).sort((a, b) => ((b.concluida_em || b.data_hora) > (a.concluida_em || a.data_hora) ? 1 : -1));
    const contato = n.contato_id && CRM.contato(n.contato_id);
    const prob = R.probabilidade(n, et);
    const dias = R.diasEntre(R.diaLocal(n.etapa_desde || n.criado_em), CRM.hoje());

    dlg.innerHTML = '<div class="ficha">' +
      '<header class="ficha-topo"><div class="ficha-titulo"><h2>' + esc(n.titulo) + '</h2>' + CRM.seloStatus(n.status) +
        '<button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(n.empresa_id) + '">' + esc(CRM.nomeEmpresa(n.empresa_id)) + '</button></div>' +
        '<span class="flex"></span>' +
        (pode && n.status === 'aberto' ? '<button type="button" class="btn verde" data-acao="ganhar">🏆 Ganhei</button><button type="button" class="btn perigo" data-acao="perder">Perdi</button>' : '') +
        (pode && n.status !== 'aberto' ? '<button type="button" class="btn sec" data-acao="reabrir">Reabrir</button>' : '') +
        (pode ? '<button type="button" class="btn sec" data-acao="editar-negocio">Editar</button>' : '') +
        '<button type="button" class="x" data-acao="fechar-negocio" aria-label="Fechar">×</button></header>' +
      (n.status === 'aberto' ? '<ol class="etapas-barra">' + etapas.map(x => '<li class="' + (x.id === n.etapa_id ? 'atual' : et && x.ordem < et.ordem ? 'feita' : '') + '">' +
        (pode ? '<button type="button" data-acao="mover-etapa" data-id="' + esc(x.id) + '">' + esc(x.nome) + '</button>' : '<span>' + esc(x.nome) + '</span>') + '</li>').join('') + '</ol>' : '') +
      '<div class="ficha-corpo dois">' +
      '<div class="ficha-col">' +
        '<dl class="dados grade">' +
          '<dt>Valor</dt><dd><strong>' + esc(R.moeda(n.valor)) + '</strong></dd>' +
          '<dt>Chance</dt><dd>' + prob + '%' + (n.probabilidade == null && n.status === 'aberto' ? ' <small>(da etapa)</small>' : '') + '</dd>' +
          '<dt>Previsão</dt><dd>' + esc(R.dataBR(n.previsao_fechamento) || '—') + '</dd>' +
          '<dt>Responsável</dt><dd>' + esc(CRM.nomeUsuario(n.responsavel_id)) + '</dd>' +
          '<dt>Pessoa</dt><dd>' + esc(contato ? contato.nome : '—') + '</dd>' +
          '<dt>Origem</dt><dd>' + esc(n.origem || (CRM.empresa(n.empresa_id) || {}).origem || '—') + '</dd>' +
          '<dt>Criado</dt><dd>' + esc(R.dataBR(n.criado_em)) + '</dd>' +
          (n.status === 'aberto' ? '<dt>Na etapa</dt><dd>' + dias + ' dia(s)</dd>' : '<dt>Fechado</dt><dd>' + esc(R.dataBR(n.fechado_em)) + '</dd>') +
          (n.motivo_perda ? '<dt>Motivo</dt><dd>' + esc(n.motivo_perda) + '</dd>' : '') +
        '</dl>' + (n.observacoes ? '<p class="obs">' + esc(n.observacoes) + '</p>' : '') +
        dadosContatoNegocio(n, contato) +
        '<section><h3>Produtos / serviços ' + (pode ? '<button type="button" class="mini" data-acao="novo-item">+ item</button>' : '') + '</h3>' +
          (itens.length ? '<table class="tabela itens"><thead><tr><th>Item</th><th class="num">Qtd.</th><th class="num">Preço</th><th class="num">Desc.</th><th class="num">Total</th></tr></thead><tbody>' +
            itens.map(it => '<tr' + (pode ? ' data-acao="editar-item" data-id="' + esc(it.id) + '" tabindex="0" class="clicavel"' : '') + '><td>' + esc(it.descricao) + '</td><td class="num">' + esc(R.numero(it.quantidade)) +
              '</td><td class="num">' + esc(R.moeda(it.preco)) + '</td><td class="num">' + (R.num(it.desconto) ? esc(R.numero(it.desconto)) + '%' : '—') + '</td><td class="num">' + esc(R.moeda(R.totalItem(it))) + '</td></tr>').join('') +
            '</tbody><tfoot><tr><td colspan="4">Total</td><td class="num"><strong>' + esc(R.moeda(R.totalItens(itens))) + '</strong></td></tr></tfoot></table>'
            : '<p class="vazio">Sem itens. O valor do negócio é o informado à mão.</p>') + '</section>' +
        '<section><h3>Propostas ' + (pode ? '<button type="button" class="mini" data-acao="nova-proposta">+ gerar proposta</button>' +
          (CRM.importarOrcamento ? '<button type="button" class="mini" data-acao="importar-orcamento" data-id="' + esc(n.id) + '" title="Arquivo CSV do orçamento salvo no FKN">importar do FKN</button>' : '') : '') + '</h3>' +
          (props.length ? '<ul class="lista">' + props.map(p => '<li class="proposta"><div><strong>#' + esc(p.numero) + ' · ' + esc(R.moeda(p.valor_total)) + '</strong> ' + CRM.seloProposta(p.status) +
            '<small>' + esc([p.enviada_em ? 'enviada ' + R.dataBR(p.enviada_em) : '', p.validade ? 'válida até ' + R.dataBR(p.validade) : '', p.respondida_em ? 'resposta ' + R.dataBR(p.respondida_em) : ''].filter(Boolean).join(' · ')) + '</small></div>' +
            '<span class="acoes-rapidas"><button type="button" class="mini" data-acao="imprimir-proposta" data-id="' + esc(p.id) + '">Imprimir / PDF</button>' +
            (pode ? '<button type="button" class="mini" data-acao="enviar-proposta" data-id="' + esc(p.id) + ':whatsapp" title="Abre o WhatsApp com a mensagem; anexe o PDF na conversa">WhatsApp</button>' +
              '<button type="button" class="mini" data-acao="enviar-proposta" data-id="' + esc(p.id) + ':email" title="Abre o e-mail para todos os endereços do cliente; anexe o PDF">E-mail</button>' : '') +
            (pode && p.status === 'rascunho' ? '<button type="button" class="mini" data-acao="proposta-status" data-id="' + esc(p.id) + ':enviada">Marcar enviada</button>' : '') +
            (pode && p.status === 'enviada' ? '<button type="button" class="mini verde" data-acao="proposta-status" data-id="' + esc(p.id) + ':aprovada">Aprovada</button><button type="button" class="mini" data-acao="proposta-status" data-id="' + esc(p.id) + ':recusada">Recusada</button>' : '') +
            (pode ? '<button type="button" class="mini" data-acao="editar-proposta" data-id="' + esc(p.id) + '">editar</button>' : '') + '</span></li>').join('') + '</ul>'
            : '<p class="vazio">Nenhuma proposta. "Gerar proposta" usa os itens acima e fica numerada; "importar do FKN" traz o orçamento feito lá.</p>') + '</section>' +
      '</div>' +
      '<div class="ficha-col historico">' +
        '<section><h3>Próximo passo <button type="button" class="mini" data-acao="tarefa-negocio">+ tarefa</button></h3>' +
          (pend.length ? '<ul class="lista tarefas">' + pend.map(a => CRM.itemTarefa(a, { resp: true })).join('') + '</ul>' : '<p class="vazio alerta">Nenhum próximo passo agendado.</p>') + '</section>' +
        '<section><h3>Histórico do negócio <button type="button" class="mini" data-acao="registro-negocio">+ registrar</button></h3>' +
          (hist.length ? '<ol class="linha-tempo">' + hist.map(itemHistorico).join('') + '</ol>' : '<p class="vazio">Nada ainda.</p>') + '</section>' +
      '</div></div></div>';
  }

  // Dados do contato na ficha do negócio (como no Agendor): e-mail, WhatsApp e telefone da
  // pessoa do negócio (ou a principal da empresa) e da empresa, cada um clicável.
  function dadosContatoNegocio(n, contatoNeg) {
    const e = CRM.empresa(n.empresa_id); if (!e) return '';
    const l = CRM.doEmpresa('contatos', e.id);
    const c = contatoNeg || l.find(x => x.principal) || l[0] || null;
    const linhas = [], vistos = new Set();
    const novo = v => { const k = R.chaveEmail(v) || R.chaveTelefone(v); if (!k || vistos.has(k)) return false; vistos.add(k); return true; };
    const email = (para, contatoId, rot) => novo(para) && linhas.push([rot, '<button type="button" class="link" data-acao="email" data-id="' + esc(e.id) + '"' +
      CRM.attr('data-contato', contatoId) + CRM.attr('data-para', para) + ' title="Escrever e-mail">' + esc(para) + '</button>']);
    const tel = (numero, contatoId, rot) => {
      if (!novo(numero)) return;
      const zap = R.linkWhatsApp(numero) ? ' <button type="button" class="mini wa" data-acao="whatsapp" data-id="' + esc(e.id) + '"' + CRM.attr('data-contato', contatoId) + '>WhatsApp</button>' : '';
      linhas.push([rot, esc(numero) + ' <button type="button" class="mini" data-acao="ligar" data-id="' + esc(e.id) + '"' + CRM.attr('data-contato', contatoId) + '>Ligar</button>' + zap]);
    };
    if (c) {
      linhas.push(['Pessoa', '<button type="button" class="link" data-acao="editar-contato" data-id="' + esc(c.id) + '">' + esc(c.nome) + '</button>' + (c.cargo ? ' <small>' + esc(c.cargo) + '</small>' : '')]);
      email(c.email, c.id, 'E-mail');
      tel(c.whatsapp, c.id, 'WhatsApp');
      tel(c.celular, c.id, 'Celular');
      tel(c.telefone, c.id, 'Telefone');
    }
    const daEmpresa = r => (c ? r + ' da empresa' : r);
    email(e.email, null, daEmpresa('E-mail'));
    tel(e.whatsapp, null, daEmpresa('WhatsApp'));
    tel(e.telefone, null, daEmpresa('Telefone'));
    return '<section class="contato-negocio"><h3>Dados do contato <button type="button" class="mini" data-acao="abrir-empresa" data-id="' + esc(e.id) + '">ficha do cliente</button></h3>' +
      (linhas.length > (c ? 1 : 0) ? '<dl class="dados">' + linhas.map(x => '<dt>' + esc(x[0]) + '</dt><dd>' + x[1] + '</dd>').join('') + '</dl>'
        : (c ? '<dl class="dados"><dt>Pessoa</dt><dd>' + linhas[0][1] + '</dd></dl>' : '') + '<p class="vazio">Nenhum e-mail ou telefone cadastrado para este cliente.</p>') + '</section>';
  }

  // Valor do negócio acompanha os itens (quando há itens).
  async function recalculaValor(negocioId) {
    const itens = CRM.doNegocio('negocio_itens', negocioId);
    if (!itens.length) return;
    const total = R.totalItens(itens);
    const n = CRM.negocio(negocioId);
    if (n && R.num(n.valor) !== total) await CRM.atualizar('negocios', negocioId, { valor: total });
  }

  // ------------------------------------------------------------ formulários: empresa / lead / contato
  const opcoesSituacao = () => R.SITUACOES;
  function camposEmpresa(e, completo) {
    const g = CRM.ehGestor();
    const c = [
      { nome: 'nome', rotulo: 'Nome / nome fantasia', obrigatorio: true, largo: true },
      { nome: 'razao_social', rotulo: 'Razão social' },
      { nome: 'cnpj', rotulo: 'CNPJ ou CPF' },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: opcoesSituacao(), padrao: 'lead' },
      { nome: 'qualificacao', rotulo: 'Qualificação', tipo: 'estrelas' },
      { nome: 'segmento', rotulo: 'Segmento', sugestoes: CRM.opcoes('segmento') },
      { nome: 'origem', rotulo: 'Origem', tipo: 'select', opcoes: CRM.lista(CRM.opcoes('origem'), '—') },
      { nome: 'responsavel_id', rotulo: 'Responsável', tipo: 'select', opcoes: CRM.opcoesUsuarios('(sem responsável)'), desabilitado: !g, padrao: CRM.meuId() },
      { nome: 'tags', rotulo: 'Etiquetas', tipo: 'tags', sugestoes: CRM.todasTags() },
      { tipo: 'secao', rotulo: 'Contato da empresa' },
      { nome: 'telefone', rotulo: 'Telefone', tipo: 'tel' },
      { nome: 'whatsapp', rotulo: 'WhatsApp', tipo: 'tel' },
      { nome: 'email', rotulo: 'E-mail', tipo: 'email' },
      { nome: 'site', rotulo: 'Site / Instagram' }
    ];
    if (completo) c.push(
      { tipo: 'secao', rotulo: 'Endereço' },
      { nome: 'cep', rotulo: 'CEP', terco: true }, { nome: 'logradouro', rotulo: 'Rua / avenida', largo: true },
      { nome: 'numero', rotulo: 'Número', terco: true }, { nome: 'complemento', rotulo: 'Complemento', terco: true }, { nome: 'bairro', rotulo: 'Bairro', terco: true },
      { nome: 'cidade', rotulo: 'Cidade' }, { nome: 'uf', rotulo: 'UF', tipo: 'select', opcoes: CRM.lista(R.UFS, '—') },
      { tipo: 'secao', rotulo: 'Pós-venda' },
      { nome: 'ciclo_recompra_dias', rotulo: 'Compra a cada (dias)', tipo: 'numero', passo: '1', min: 1, vazioNulo: true, ajuda: 'vazio = padrão de ' + E().cfg.ciclo_recompra_padrao + ' dias' },
      { nome: 'observacoes', rotulo: 'Observações importantes', tipo: 'textarea', largo: true }
    );
    return c;
  }

  fichas.formEmpresa = e => {
    const g = CRM.ehGestor();
    CRM.abrirForm({
      titulo: e ? 'Editar empresa' : 'Nova empresa', largura: 'largo',
      campos: camposEmpresa(e, true), valores: e || { responsavel_id: CRM.meuId() },
      extras: form => {
        ['nome', 'cnpj', 'telefone', 'whatsapp', 'email'].forEach(n => form.elements[n] && form.elements[n].addEventListener('input', () => checaDuplicado(form, e && e.id)));
        form.elements.cnpj.addEventListener('blur', () => {
          const d = R.digitos(form.elements.cnpj.value);
          if (d.length === 14 || d.length === 11) form.elements.cnpj.value = R.formataCNPJ(d);
          CRM.avisoCampo(form, 'cnpj', d.length === 14 && !R.cnpjValido(d) ? 'CNPJ parece inválido (confira os dígitos).' : '');
        });
        form.elements.cep.addEventListener('blur', () => { const d = R.digitos(form.elements.cep.value); if (d.length === 8) form.elements.cep.value = d.replace(/(\d{5})(\d{3})/, '$1-$2'); });
      },
      aoSalvar: async v => {
        if (!g) delete v.responsavel_id;
        await CRM.barraDuplicado(v, e);
        if (!e) CRM.confereContatoCadastro([v.telefone, v.whatsapp], v.email);
        if (e) {
          const mudouResp = g && v.responsavel_id !== undefined && v.responsavel_id !== e.responsavel_id;
          await CRM.atualizar('empresas', e.id, v);
          if (mudouResp) await CRM.auto.sistema(e.id, null, 'Responsável: ' + CRM.nomeUsuario(e.responsavel_id) + ' → ' + CRM.nomeUsuario(v.responsavel_id));
        } else {
          v.responsavel_id = await CRM.responsavelParaLead(v.responsavel_id);
          const nova = await CRM.inserir('empresas', v);
          await CRM.auto.aoCriarEmpresa(nova);
          fichas.abrirEmpresa(nova.id);
        }
      },
      aoExcluir: e && g ? async () => { await CRM.remover('empresas', e.id); $('#dlgEmpresa').close(); CRM.toast('Empresa excluída.'); } : null,
      textoExcluir: e ? 'Excluir "' + e.nome + '" e TUDO dela (pessoas, negócios, histórico)? Não tem volta.' : ''
    });
  };

  fichas.formLead = () => {
    const g = CRM.ehGestor();
    const exige = E().cfg.exigir_contato_cadastro !== false;
    const usuarios = CRM.opcoesUsuarios();
    CRM.abrirForm({
      titulo: 'Novo lead', largura: 'largo',
      intro: exige ? 'Obrigatórios: nome, telefone e e-mail — é por eles (e pelo CNPJ, se tiver) que o CRM não deixa o mesmo cliente ser cadastrado duas vezes. O resto dá para completar depois.'
        : 'Só o nome é obrigatório. O resto dá para completar depois.',
      campos: [
        { nome: 'nome', rotulo: 'Empresa (ou nome da pessoa)', obrigatorio: true, largo: true },
        { nome: 'telefone', rotulo: 'Telefone / WhatsApp (com DDD)', tipo: 'tel', obrigatorio: exige },
        { nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: exige },
        { nome: 'cnpj', rotulo: 'CNPJ ou CPF (se já souber)' },
        { nome: 'cidade', rotulo: 'Cidade' },
        { nome: 'segmento', rotulo: 'Segmento', sugestoes: CRM.opcoes('segmento') },
        { nome: 'origem', rotulo: 'Origem', tipo: 'select', opcoes: CRM.lista(CRM.opcoes('origem'), '—') },
        { nome: 'qualificacao', rotulo: 'Qualificação', tipo: 'estrelas' },
        g ? { nome: 'responsavel_id', rotulo: 'Responsável', tipo: 'select', opcoes: [['__rodizio', 'Rodízio automático']].concat(usuarios), padrao: E().cfg.rodizio ? '__rodizio' : CRM.meuId() }
          : { nome: 'resp_info', rotulo: 'O lead fica na sua carteira.', tipo: 'info' },
        { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: opcoesSituacao(), padrao: 'lead' },
        { tipo: 'secao', rotulo: 'Pessoa de contato' },
        { nome: 'contato_nome', rotulo: 'Nome' }, { nome: 'contato_cargo', rotulo: 'Cargo' },
        { nome: 'contato_telefone', rotulo: 'Celular / WhatsApp', tipo: 'tel' }, { nome: 'contato_email', rotulo: 'E-mail', tipo: 'email' },
        { tipo: 'secao', rotulo: 'Já tem negócio? (opcional)' },
        { nome: 'negocio_titulo', rotulo: 'O que quer comprar', dica: 'ex.: kit limpeza mensal' }, { nome: 'negocio_valor', rotulo: 'Valor estimado (R$)', tipo: 'numero' },
        { nome: 'observacoes', rotulo: 'Observação', tipo: 'textarea', largo: true, linhas: 2 }
      ],
      salvarTexto: 'Cadastrar',
      extras: form => {
        ['nome', 'telefone', 'email', 'cnpj', 'contato_telefone', 'contato_email'].forEach(n => form.elements[n] && form.elements[n].addEventListener('input', () => checaDuplicado(form)));
        form.elements.cnpj.addEventListener('blur', () => {
          const d = R.digitos(form.elements.cnpj.value);
          if (d.length === 14 || d.length === 11) form.elements.cnpj.value = R.formataCNPJ(d);
          CRM.avisoCampo(form, 'cnpj', d.length === 14 && !R.cnpjValido(d) ? 'CNPJ parece inválido (confira os dígitos).' : '');
        });
      },
      aoSalvar: async v => {
        await CRM.barraDuplicado({ cnpj: v.cnpj, telefone: v.telefone, email: v.email });
        CRM.confereContatoCadastro([v.telefone], v.email);
        const resp = await CRM.responsavelParaLead(v.responsavel_id);
        const tel = v.telefone;
        const emp = await CRM.inserir('empresas', {
          nome: v.nome, cnpj: v.cnpj ? R.formataCNPJ(v.cnpj) : null, telefone: tel, whatsapp: tel && R.digitos(tel).length >= 10 && /^\(?\d{2}\)?\s*9/.test(tel.trim()) ? tel : null, email: v.email,
          cidade: v.cidade, segmento: v.segmento, origem: v.origem, qualificacao: v.qualificacao || 0, situacao: v.situacao || 'lead', responsavel_id: resp, observacoes: v.observacoes
        });
        if (v.contato_nome) await CRM.inserir('contatos', { empresa_id: emp.id, nome: v.contato_nome, cargo: v.contato_cargo, whatsapp: v.contato_telefone, email: v.contato_email, principal: true });
        if (v.negocio_titulo || v.negocio_valor) {
          const et = CRM.etapas(CRM.funis()[0])[0];
          await CRM.inserir('negocios', { empresa_id: emp.id, titulo: v.negocio_titulo || 'Primeiro pedido', valor: v.negocio_valor || 0, etapa_id: et ? et.id : null,
            responsavel_id: resp, origem: v.origem, contato_id: null });
        }
        await CRM.auto.aoCriarEmpresa(emp);
        CRM.toast('Lead cadastrado' + (resp !== CRM.meuId() ? ' para ' + CRM.nomeUsuario(resp) : '') + '.');
        fichas.abrirEmpresa(emp.id);
      }
    });
  };

  fichas.formContato = (c, empresaId) => {
    const eid = c ? c.empresa_id : empresaId;
    CRM.abrirForm({
      titulo: c ? 'Editar pessoa' : 'Nova pessoa · ' + CRM.nomeEmpresa(eid),
      campos: [
        { nome: 'nome', rotulo: 'Nome', obrigatorio: true }, { nome: 'cargo', rotulo: 'Cargo / função', dica: 'ex.: síndico, compras, gerente' },
        { nome: 'whatsapp', rotulo: 'WhatsApp', tipo: 'tel' }, { nome: 'celular', rotulo: 'Celular', tipo: 'tel' },
        { nome: 'telefone', rotulo: 'Telefone fixo / ramal', tipo: 'tel' }, { nome: 'email', rotulo: 'E-mail', tipo: 'email' },
        { nome: 'aniversario', rotulo: 'Aniversário', tipo: 'data' }, { nome: 'tags', rotulo: 'Etiquetas', tipo: 'tags', sugestoes: CRM.todasTags() },
        { nome: 'principal', rotulo: 'Contato principal da empresa', tipo: 'checkbox', largo: true },
        { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', largo: true, linhas: 2 }
      ],
      valores: c || { principal: !CRM.doEmpresa('contatos', eid).length },
      aoSalvar: async v => {
        if (v.principal) {
          const outros = CRM.doEmpresa('contatos', eid).filter(x => x.principal && (!c || x.id !== c.id)).map(x => x.id);
          if (outros.length) await CRM.atualizarVarios('contatos', outros, { principal: false });
        }
        if (c) await CRM.atualizar('contatos', c.id, v);
        else await CRM.inserir('contatos', Object.assign({ empresa_id: eid }, v));
      },
      aoExcluir: c ? () => CRM.remover('contatos', c.id) : null
    });
  };

  // ------------------------------------------------------------ negócio: criar, ganhar, perder
  function opcoesEtapas() {
    const multi = CRM.funis().length > 1;
    return E().D.etapas.slice().sort((a, b) => (a.funil || '').localeCompare(b.funil || '', 'pt-BR') || a.ordem - b.ordem)
      .map(e => [e.id, (multi ? (e.funil || 'Vendas') + ' · ' : '') + e.nome + ' (' + e.probabilidade + '%)']);
  }

  fichas.formNegocio = (n, pre) => {
    pre = pre || {};
    const g = CRM.ehGestor();
    const eid = n ? n.empresa_id : pre.empresa_id;
    const contatos = eid ? CRM.doEmpresa('contatos', eid) : [];
    const primeira = CRM.etapas(CRM.funis()[0])[0];
    const campos = [];
    if (!eid) campos.push(campoEmpresa(pre));
    campos.push(
      { nome: 'titulo', rotulo: 'Negócio', obrigatorio: true, largo: true, dica: 'ex.: Contrato mensal de descartáveis' },
      { nome: 'etapa_id', rotulo: 'Etapa', tipo: 'select', opcoes: opcoesEtapas(), padrao: primeira && primeira.id },
      { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'numero', ajuda: 'se tiver itens, o valor é a soma deles' },
      { nome: 'previsao_fechamento', rotulo: 'Previsão de fechamento', tipo: 'data' },
      { nome: 'probabilidade', rotulo: 'Chance (%)', tipo: 'numero', passo: '1', max: 100, vazioNulo: true, ajuda: 'vazio = a da etapa' },
      { nome: 'responsavel_id', rotulo: 'Responsável', tipo: 'select', opcoes: CRM.opcoesUsuarios(), desabilitado: !g, padrao: (eid && (CRM.empresa(eid) || {}).responsavel_id) || CRM.meuId() },
      { nome: 'contato_id', rotulo: 'Pessoa', tipo: 'select', opcoes: [['', '—']].concat(contatos.map(c => [c.id, c.nome])) },
      { nome: 'origem', rotulo: 'Origem', tipo: 'select', opcoes: CRM.lista(CRM.opcoes('origem'), '(a da empresa)') },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', largo: true, linhas: 2 }
    );
    CRM.abrirForm({
      titulo: n ? 'Editar negócio' : 'Novo negócio' + (eid ? ' · ' + CRM.nomeEmpresa(eid) : ''), largura: 'largo',
      campos, valores: n || { responsavel_id: (eid && (CRM.empresa(eid) || {}).responsavel_id) || CRM.meuId() },
      htmlDepois: eid ? '' : datalistEmpresas(),
      extras: ligaDatalist,
      aoSalvar: async v => {
        if (!g) v.responsavel_id = n ? n.responsavel_id : CRM.meuId();
        if (v.empresa_nome) { v.empresa_id = resolveEmpresa(v.empresa_nome).id; delete v.empresa_nome; }
        if (n) {
          const mud = {};
          ['etapa_id', 'responsavel_id'].forEach(k => { if (v[k] !== n[k]) mud[k] = v[k]; });
          const resto = Object.assign({}, v); delete resto.etapa_id; delete resto.responsavel_id;
          await CRM.atualizar('negocios', n.id, resto);
          if (Object.keys(mud).length) await CRM.auto.mudarNegocio(CRM.negocio(n.id), mud);
        } else {
          if (eid) v.empresa_id = eid;
          const novo = await CRM.inserir('negocios', v);
          await CRM.auto.sistema(novo.empresa_id, novo.id, 'Negócio criado: ' + novo.titulo + ' (' + R.moeda(novo.valor) + ')');
          const emp = CRM.empresa(novo.empresa_id);
          if (emp && emp.situacao === 'lead' && CRM.podeEditarEmpresa(emp)) await CRM.atualizar('empresas', emp.id, { situacao: 'prospect' });
          fichas.abrirNegocio(novo.id);
        }
      },
      aoExcluir: n && g ? async () => { await CRM.remover('negocios', n.id); $('#dlgNegocio').close(); } : null,
      textoExcluir: 'Excluir este negócio, os itens e as propostas dele?'
    });
  };

  fichas.formGanho = n => {
    CRM.abrirForm({
      titulo: '🏆 Ganhou: ' + n.titulo,
      campos: [
        { nome: 'valor', rotulo: 'Valor fechado (R$)', tipo: 'numero', obrigatorio: true },
        { nome: 'fechado_em', rotulo: 'Data do fechamento', tipo: 'data', obrigatorio: true },
        { nome: 'obs', rotulo: 'Comentário (opcional)', tipo: 'textarea', largo: true, linhas: 2 }
      ],
      valores: { valor: n.valor, fechado_em: CRM.hoje() },
      intro: (E().cfg.auto_pos_venda || E().cfg.auto_recompra) ? 'O CRM vai agendar sozinho: ' + [E().cfg.auto_pos_venda ? 'pós-venda em ' + E().cfg.dias_pos_venda + ' dias' : '', E().cfg.auto_recompra ? 'lembrete de recompra' : ''].filter(Boolean).join(' e ') + '.' : null,
      salvarTexto: 'Marcar como ganho',
      aoSalvar: async v => {
        await CRM.auto.mudarNegocio(n, { status: 'ganho', valor: v.valor, fechado_em: v.fechado_em });
        if (v.obs) await CRM.inserir('atividades', { empresa_id: n.empresa_id, negocio_id: n.id, tipo: 'nota', descricao: v.obs, concluida: true, concluida_em: agoraISO(), data_hora: agoraISO(), responsavel_id: CRM.meuId() });
        CRM.toast('Parabéns! Venda registrada.');
      }
    });
  };

  fichas.formPerda = n => {
    const motivos = CRM.opcoes('motivo_perda');
    CRM.abrirForm({
      titulo: 'Perdeu: ' + n.titulo,
      campos: [
        { nome: 'motivo', rotulo: 'Motivo da perda', tipo: 'select', opcoes: [['', 'Escolha…']].concat(motivos.map(m => [m, m])).concat([['__outro', 'Outro…']]), obrigatorio: true, largo: true },
        { nome: 'outro', rotulo: 'Qual? (se escolheu "Outro")', largo: true },
        { nome: 'obs', rotulo: 'Detalhes (ajuda a entender o que não funcionou)', tipo: 'textarea', largo: true, linhas: 2 }
      ],
      salvarTexto: 'Marcar como perdido',
      aoSalvar: async v => {
        let motivo = v.motivo === '__outro' ? v.outro : v.motivo;
        if (!motivo) throw new Error('diga o motivo');
        if (v.motivo === '__outro' && CRM.ehGestor() && motivos.indexOf(motivo) === -1) { try { await CRM.inserir('opcoes', { tipo: 'motivo_perda', nome: motivo, ordem: 99 }); } catch (x) { /* já existe */ } }
        await CRM.auto.mudarNegocio(n, { status: 'perdido', motivo_perda: motivo });
        if (v.obs) await CRM.inserir('atividades', { empresa_id: n.empresa_id, negocio_id: n.id, tipo: 'nota', descricao: 'Sobre a perda: ' + v.obs, concluida: true, concluida_em: agoraISO(), data_hora: agoraISO(), responsavel_id: CRM.meuId() });
      }
    });
  };

  // ------------------------------------------------------------ itens e propostas
  fichas.formItem = (it, negocioId) => {
    const produtos = E().D.produtos.filter(p => p.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    CRM.abrirForm({
      titulo: it ? 'Editar item' : 'Adicionar item',
      campos: [
        { nome: 'produto_id', rotulo: 'Produto do catálogo', tipo: 'select', opcoes: [['', '(digitar à mão)']].concat(produtos.map(p => [p.id, p.nome + (p.codigo ? ' · ' + p.codigo : '') + ' — ' + R.moeda(p.preco)])), largo: true },
        { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, largo: true },
        { nome: 'quantidade', rotulo: 'Quantidade', tipo: 'numero', passo: '0.001', padrao: 1 },
        { nome: 'preco', rotulo: 'Preço unitário (R$)', tipo: 'numero' },
        { nome: 'desconto', rotulo: 'Desconto (%)', tipo: 'numero', max: 100 }
      ],
      valores: it || { quantidade: 1, desconto: 0 },
      htmlDepois: '<p class="total-item" id="totalItem"></p>',
      extras: form => {
        const atualiza = () => { $('#totalItem').textContent = 'Total do item: ' + R.moeda(R.totalItem({ quantidade: form.elements.quantidade.value, preco: form.elements.preco.value, desconto: form.elements.desconto.value })); };
        form.elements.produto_id.addEventListener('change', () => {
          const p = CRM.produto(form.elements.produto_id.value);
          if (p) { form.elements.descricao.value = p.nome + (p.unidade ? ' (' + p.unidade + ')' : ''); form.elements.preco.value = p.preco; atualiza(); }
        });
        ['quantidade', 'preco', 'desconto'].forEach(n => form.elements[n].addEventListener('input', atualiza));
        atualiza();
      },
      aoSalvar: async v => {
        if (!(v.quantidade > 0)) throw new Error('quantidade precisa ser maior que zero');
        if (it) await CRM.atualizar('negocio_itens', it.id, v);
        else await CRM.inserir('negocio_itens', Object.assign({ negocio_id: negocioId, ordem: CRM.doNegocio('negocio_itens', negocioId).length }, v));
        await recalculaValor(negocioId);
      },
      aoExcluir: it ? async () => { await CRM.remover('negocio_itens', it.id); await recalculaValor(negocioId); } : null
    });
  };

  fichas.formProposta = (p, n) => {
    const cfg = E().cfg;
    const itens = CRM.doNegocio('negocio_itens', n.id);
    CRM.abrirForm({
      titulo: p ? 'Proposta #' + p.numero : 'Gerar proposta · ' + n.titulo,
      intro: p ? null : (itens.length ? 'Os ' + itens.length + ' itens do negócio entram na proposta como estão agora (' + R.moeda(R.totalItens(itens)) + ').' : 'O negócio não tem itens: a proposta sai com o valor do negócio (' + R.moeda(n.valor) + ').'),
      campos: [
        { nome: 'status', rotulo: 'Status', tipo: 'select', opcoes: R.STATUS_PROPOSTA, padrao: 'rascunho' },
        { nome: 'enviada_em', rotulo: 'Enviada em', tipo: 'data' },
        { nome: 'validade', rotulo: 'Válida até', tipo: 'data', padrao: R.somaDias(CRM.hoje(), cfg.proposta_validade_dias) },
        { nome: 'respondida_em', rotulo: 'Aprovada/recusada em', tipo: 'data' },
        { nome: 'condicoes', rotulo: 'Condições (pagamento, entrega, frete…)', tipo: 'textarea', largo: true, padrao: cfg.proposta_condicoes },
        { nome: 'link_anexo', rotulo: 'Link do anexo (Drive, PDF…)', largo: true },
        { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', largo: true, linhas: 2 }
      ],
      valores: p || {},
      salvarTexto: p ? 'Salvar' : 'Gerar proposta',
      aoSalvar: async v => {
        if (p) {
          const antes = p.status;
          const r = await CRM.atualizar('propostas', p.id, v);
          if (antes !== r.status) await aoMudarProposta(r, antes, n);
          return;
        }
        const snap = itens.length ? itens.map(it => ({ descricao: it.descricao, quantidade: R.num(it.quantidade), preco: R.num(it.preco), desconto: R.num(it.desconto), total: R.totalItem(it) }))
          : [{ descricao: n.titulo, quantidade: 1, preco: R.num(n.valor), desconto: 0, total: R.num(n.valor) }];
        const nova = await CRM.inserir('propostas', Object.assign({ negocio_id: n.id, itens: snap, valor_total: R.totalItens(snap) }, v));
        if (nova.status !== 'rascunho') await aoMudarProposta(nova, 'rascunho', n);
        CRM.toast('Proposta #' + nova.numero + ' gerada.');
        fichas.imprimirProposta(nova);
      },
      aoExcluir: p ? () => CRM.remover('propostas', p.id) : null
    });
  };

  async function aoMudarProposta(p, antes, n) {
    if (p.status === 'enviada' && antes === 'rascunho') {
      if (!p.enviada_em) p = await CRM.atualizar('propostas', p.id, { enviada_em: CRM.hoje() });
      await CRM.auto.aoEnviarProposta(p, CRM.negocio(n.id));
    }
    if (p.status === 'aprovada' || p.status === 'recusada') {
      if (!p.respondida_em) await CRM.atualizar('propostas', p.id, { respondida_em: CRM.hoje() });
      await CRM.auto.sistema(n.empresa_id, n.id, 'Proposta #' + p.numero + ' ' + (p.status === 'aprovada' ? 'APROVADA' : 'recusada'));
      const atual = CRM.negocio(n.id);
      if (p.status === 'aprovada' && atual.status === 'aberto' && confirm('Proposta aprovada. Marcar o negócio como GANHO agora?')) fichas.formGanho(Object.assign({}, atual, { valor: p.valor_total }));
      if (p.status === 'recusada' && atual.status === 'aberto' && confirm('Proposta recusada. Marcar o negócio como PERDIDO?')) fichas.formPerda(atual);
    }
  }

  // Proposta / orçamento no layout da empresa (logo e cores da instalação). Serve para a proposta
  // gerada no CRM e para o orçamento importado do FKN (p.dados: pagamento, frete, entrega…).
  fichas.imprimirProposta = p => {
    const n = CRM.negocio(p.negocio_id);
    const e = n && CRM.empresa(n.empresa_id);
    const c = n && n.contato_id ? CRM.contato(n.contato_id) : (e && principal(e.id));
    const vend = n && CRM.usuario(n.responsavel_id);
    const d = p.dados || {};
    const itens = p.itens || [];
    const comCodigo = itens.some(it => it.codigo), comUn = itens.some(it => it.unidade), comDesc = itens.some(it => R.num(it.desconto));
    const qtd = v => String(+Number(v || 0).toFixed(3)).replace('.', ',');
    const precoUnit = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const titulo = p.numero_fkn ? 'Orçamento nº ' + Number(p.numero_fkn).toLocaleString('pt-BR') + (d.versao ? ' · versão ' + d.versao : '') : 'Proposta comercial nº ' + p.numero;
    const emitida = d.emissao || p.enviada_em || R.diaLocal(p.criado_em);
    const endereco = e ? [[e.logradouro, e.numero].filter(Boolean).join(', '), e.bairro, [e.cidade, e.uf].filter(Boolean).join('/'), e.cep].filter(Boolean).join(' · ') : '';
    const ac = (c && c.nome) || d.ac;
    const cond = [['Pagamento', d.pagamento ? d.pagamento + (d.cobranca ? ' · ' + d.cobranca.toLowerCase() : '') : ''], ['Prazo de entrega', d.prazo_entrega],
      ['Frete', d.fkn ? (R.num(d.frete) ? R.moeda(d.frete) : 'grátis') + (d.frete_tipo ? ' (' + String(d.frete_tipo).replace(/^\d+-/, '') + ')' : '') : ''],
      ['Transporte', d.transportadora ? (d.transportadora === 'PROPRIO' ? 'frota própria' : d.transportadora) : ''], ['Entrega em', d.endereco_entrega],
      ['Seu pedido', d.seu_pedido], ['Referência', d.ref]].filter(x => x[1]);
    const cab = '<th class="n">#</th>' + (comCodigo ? '<th>Código</th>' : '') + '<th>Produto</th>' + (comUn ? '<th>Un.</th>' : '') + '<th class="num">Qtd.</th><th class="num">Preço unit.</th>' +
      (comDesc ? '<th class="num">Desc.</th>' : '') + '<th class="num">Total</th>';
    const cols = 5 + (comCodigo ? 1 : 0) + (comUn ? 1 : 0) + (comDesc ? 1 : 0);
    const el = $('#impressao');
    el.innerHTML = '<div class="proposta-doc">' +
      '<header><img src="' + esc(CRM.logo()) + '" alt=""><div class="dir"><p class="doc-tipo">' + esc(titulo) + '</p>' +
        '<p>Emitido em ' + esc(R.dataBR(emitida)) + '</p>' + (p.validade ? '<p><strong>Válido até ' + esc(R.dataBR(p.validade)) + '</strong></p>' : '') + '</div></header>' +
      '<section class="partes"><div class="cliente"><h2>Para</h2><p><strong>' + esc(e ? e.razao_social || e.nome : '') + '</strong>' + (e && e.cnpj ? '<br>CNPJ/CPF ' + esc(e.cnpj) : '') +
        (ac ? '<br>A/C ' + esc(ac) + (c && c.cargo ? ' — ' + esc(c.cargo) : '') : '') + (endereco ? '<br>' + esc(endereco) : '') + '</p></div>' +
        (vend ? '<div class="vendedor"><h2>Seu contato</h2><p><strong>' + esc(vend.nome) + '</strong>' + (vend.telefone ? '<br>' + esc(vend.telefone) : '') + (vend.email ? '<br>' + esc(vend.email) : '') + '</p></div>' : '') +
      '</section>' +
      '<table><thead><tr>' + cab + '</tr></thead><tbody>' +
      itens.map((it, i) => '<tr><td class="n">' + (i + 1) + '</td>' + (comCodigo ? '<td class="cod">' + esc(it.codigo || '') + '</td>' : '') + '<td>' + esc(it.descricao) + '</td>' +
        (comUn ? '<td>' + esc(it.unidade || '') + '</td>' : '') + '<td class="num">' + esc(qtd(it.quantidade)) + '</td><td class="num">' + esc(precoUnit(it.preco)) + '</td>' +
        (comDesc ? '<td class="num">' + (R.num(it.desconto) ? esc(R.numero(it.desconto)) + '%' : '—') + '</td>' : '') +
        '<td class="num">' + esc(R.moeda(it.total != null ? it.total : R.totalItem(it))) + '</td></tr>').join('') +
      '</tbody><tfoot>' + (R.num(d.frete) ? '<tr class="sub"><td colspan="' + (cols - 1) + '">Frete</td><td class="num">' + esc(R.moeda(d.frete)) + '</td></tr>' : '') +
        '<tr><td colspan="' + (cols - 1) + '">Total</td><td class="num">' + esc(R.moeda(p.valor_total)) + '</td></tr></tfoot></table>' +
      (cond.length ? '<section class="condicoes"><h2>Condições</h2><dl>' + cond.map(x => '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>').join('') + '</dl></section>'
        : p.condicoes ? '<section><h2>Condições</h2><p class="pre">' + esc(p.condicoes) + '</p></section>' : '') +
      (p.observacoes ? '<section><h2>Observações</h2><p class="pre">' + esc(p.observacoes) + '</p></section>' : '') +
      '<footer><p class="agradece">Obrigado pela preferência! Qualquer ajuste, é só falar com ' + esc(vend ? R.primeiroNome(vend.nome) : 'a gente') + '.</p>' +
        (E().cfg.proposta_rodape ? '<p class="pre">' + esc(E().cfg.proposta_rodape) + '</p>' : '<p>' + esc(CRM.nomeInstalacao()) + '</p>') + '</footer></div>';
    document.body.classList.add('imprimindo');
    const titAntes = document.title;
    document.title = (p.numero_fkn ? 'Orcamento ' + p.numero_fkn : 'Proposta ' + p.numero) + ' - ' + (e ? e.nome : ''); // nome sugerido do PDF
    const limpa = () => { document.body.classList.remove('imprimindo'); document.title = titAntes; window.removeEventListener('afterprint', limpa); };
    window.addEventListener('afterprint', limpa);
    setTimeout(() => window.print(), 50);
  };

  // Enviar a proposta ao cliente: abre o WhatsApp (ou o e-mail para todos os endereços) com o
  // modelo de envio de orçamento e o resumo (número, valor, validade). O link do WhatsApp não leva
  // arquivo: o PDF ("Imprimir / PDF" → Salvar como PDF) é anexado na conversa. A proposta passa a
  // "enviada" (histórico e etapa, como no "Marcar enviada") e, na volta, o CRM pergunta como foi.
  fichas.enviarProposta = async (pid, canal, el) => {
    const p = E().ix.porId.propostas.get(pid); if (!p) return;
    const n = CRM.negocio(p.negocio_id), e = n && CRM.empresa(n.empresa_id); if (!e) return;
    const c = n.contato_id ? CRM.contato(n.contato_id) : null;
    const nome = p.numero_fkn ? 'Orçamento nº ' + Number(p.numero_fkn).toLocaleString('pt-BR') : 'Proposta nº ' + p.numero;
    const resumo = nome + ' · ' + R.moeda(p.valor_total) + (p.validade ? ' · válido até ' + R.dataBR(p.validade) : '');
    const v = variaveis(e, c || escolheContato(e, null, x => canal === 'email' ? x.email : R.linkWhatsApp(x.whatsapp || x.celular || x.telefone)));
    const modelo = E().D.modelos.find(m => m.canal === canal && /or[çc]amento/i.test(m.nome) && /envi/i.test(m.nome));
    let reg;
    if (canal === 'whatsapp') {
      const cw = c && R.linkWhatsApp(telDe(null, c)) ? c : escolheContato(e, null, x => R.linkWhatsApp(x.whatsapp || x.celular || x.telefone));
      const tel = telDe(e, cw);
      if (!R.linkWhatsApp(tel)) { CRM.toast('Sem número de WhatsApp com DDD neste cliente.', true); return; }
      const texto = (modelo ? R.aplicaModelo(modelo.corpo, v) : v.saudacao + ' Segue o orçamento que combinamos.') + '\n\n' + resumo;
      window.open(R.linkWhatsApp(tel, texto), '_blank', 'noopener');
      reg = await registraAuto(e, cw, 'whatsapp', nome + ' enviado pelo WhatsApp' + (cw ? ' a ' + cw.nome : '') + ': ' + texto);
      esperaVolta(e, cw, reg, 'whatsapp');
    } else {
      const para = emailsDe(e, c && separaEmails(c.email).length ? c : null);
      if (!para.length) { CRM.toast('Sem e-mail cadastrado neste cliente.', true); return; }
      const assunto = modelo ? R.aplicaModelo(modelo.assunto || '', v) : nome + ' — ' + CRM.nomeInstalacao();
      const corpo = (modelo ? R.aplicaModelo(modelo.corpo, v) : v.saudacao + '\n\nSegue em anexo o orçamento.') + '\n\n' + resumo;
      location.href = linkEmail(para, assunto, corpo);
      reg = await registraAuto(e, c, 'email', nome + ' por e-mail para ' + para.join(', ') + ' — "' + assunto + '"');
      esperaVolta(e, c, reg, 'email');
    }
    CRM.toast('Anexe o PDF na mensagem: "Imprimir / PDF" → Salvar como PDF.');
    if (p.status === 'rascunho') {
      try { const r = await CRM.atualizar('propostas', p.id, { status: 'enviada', enviada_em: CRM.hoje() }); await aoMudarProposta(r, 'rascunho', n); } catch (x) { CRM.falhou(x); }
    }
  };

  // ------------------------------------------------------------ tarefas e registros
  fichas.formTarefa = (a, pre, intro) => {
    pre = pre || {};
    const eid = a ? a.empresa_id : pre.empresa_id;
    const e = eid && CRM.empresa(eid);
    const negs = eid ? CRM.doEmpresa('negocios', eid).filter(n => n.status === 'aberto' || (a && n.id === a.negocio_id)) : [];
    const contatos = eid ? CRM.doEmpresa('contatos', eid) : [];
    const campos = [];
    if (!eid) campos.push(campoEmpresa(pre));
    campos.push(
      { nome: 'descricao', rotulo: 'O que fazer', obrigatorio: true, largo: true, dica: 'ex.: ligar para saber se aprovou o orçamento' },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: R.TIPOS_MANUAIS, padrao: 'ligacao' },
      { nome: 'data_hora', rotulo: 'Quando', tipo: 'datahora', obrigatorio: true },
      { nome: 'responsavel_id', rotulo: 'Responsável', tipo: 'select', opcoes: CRM.opcoesUsuarios(), padrao: (e && e.responsavel_id) || CRM.meuId() },
      { nome: 'recorrencia', rotulo: 'Repetir', tipo: 'select', opcoes: R.RECORRENCIAS }
    );
    if (negs.length) campos.push({ nome: 'negocio_id', rotulo: 'Negócio', tipo: 'select', opcoes: [['', '—']].concat(negs.map(n => [n.id, n.titulo])) });
    if (contatos.length) campos.push({ nome: 'contato_id', rotulo: 'Com quem', tipo: 'select', opcoes: [['', '—']].concat(contatos.map(c => [c.id, c.nome])) });
    if (a) campos.push({ nome: 'concluida', rotulo: 'Concluída', tipo: 'checkbox', largo: true });
    const valores = a ? Object.assign({}, a) : Object.assign({ data_hora: pre.data_hora || proximaHora(), responsavel_id: (e && e.responsavel_id) || CRM.meuId(), tipo: 'ligacao' }, pre);
    CRM.abrirForm({
      titulo: a ? 'Tarefa · ' + CRM.nomeEmpresa(a.empresa_id) : 'Nova tarefa' + (e ? ' · ' + e.nome : ''),
      intro, campos, valores, largura: 'largo',
      htmlDepois: eid ? '' : datalistEmpresas(),
      rodape: a ? '<a class="btn sec" target="_blank" rel="noopener noreferrer" href="' + esc(R.linkGoogleAgenda(a.descricao + ' — ' + CRM.nomeEmpresa(a.empresa_id), a.data_hora, 30, 'CRM: ' + CRM.nomeEmpresa(a.empresa_id))) + '">+ Google Agenda</a>' : '',
      extras: ligaDatalist,
      aoSalvar: async v => {
        if (v.empresa_nome) { v.empresa_id = resolveEmpresa(v.empresa_nome).id; delete v.empresa_nome; }
        if (!v.recorrencia) v.recorrencia = null;
        if (a) {
          const concluiu = v.concluida && !a.concluida;
          if (concluiu) v.concluida_em = agoraISO();
          if (!v.concluida) v.concluida_em = null;
          const r = await CRM.atualizar('atividades', a.id, v);
          if (concluiu) await CRM.auto.aoConcluirTarefa(r);
        } else {
          if (eid) v.empresa_id = eid;
          await CRM.inserir('atividades', Object.assign({ concluida: false }, v));
          CRM.toast('Tarefa agendada para ' + R.dataHoraBR(v.data_hora) + '.');
        }
      },
      aoExcluir: a ? () => CRM.remover('atividades', a.id) : null
    });
  };

  fichas.formRegistro = (a, pre) => {
    pre = pre || {};
    const eid = a ? a.empresa_id : pre.empresa_id;
    const campos = [];
    if (!eid) campos.push(campoEmpresa(pre));
    const negs = eid ? CRM.doEmpresa('negocios', eid) : [];
    const contatos = eid ? CRM.doEmpresa('contatos', eid) : [];
    campos.push(
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: R.TIPOS_MANUAIS.filter(t => t[0] !== 'tarefa'), padrao: 'ligacao' },
      { nome: 'data_hora', rotulo: 'Quando aconteceu', tipo: 'datahora' },
      { nome: 'descricao', rotulo: 'O que aconteceu', tipo: 'textarea', obrigatorio: true, largo: true }
    );
    if (contatos.length) campos.push({ nome: 'contato_id', rotulo: 'Com quem', tipo: 'select', opcoes: [['', '—']].concat(contatos.map(c => [c.id, c.nome])) });
    if (negs.length) campos.push({ nome: 'negocio_id', rotulo: 'Negócio', tipo: 'select', opcoes: [['', '—']].concat(negs.map(n => [n.id, n.titulo])) });
    if (!a) campos.push(
      { tipo: 'secao', rotulo: 'Próximo passo (opcional)' },
      { nome: 'prox_descricao', rotulo: 'O que fazer depois', largo: true },
      { nome: 'prox_tipo', rotulo: 'Tipo', tipo: 'select', opcoes: R.TIPOS_MANUAIS, padrao: 'ligacao' },
      { nome: 'prox_data', rotulo: 'Quando', tipo: 'datahora' }
    );
    CRM.abrirForm({
      titulo: a ? 'Editar registro' : 'Registrar atividade' + (eid ? ' · ' + CRM.nomeEmpresa(eid) : ''), largura: 'largo',
      campos, valores: a ? Object.assign({}, a, { data_hora: a.concluida_em || a.data_hora }) : Object.assign({ data_hora: agoraISO() }, pre),
      htmlDepois: eid ? '' : datalistEmpresas(),
      extras: ligaDatalist,
      aoSalvar: async v => {
        if (v.empresa_nome) { v.empresa_id = resolveEmpresa(v.empresa_nome).id; delete v.empresa_nome; }
        const prox = { descricao: v.prox_descricao, tipo: v.prox_tipo, data_hora: v.prox_data };
        delete v.prox_descricao; delete v.prox_tipo; delete v.prox_data;
        v.data_hora = v.data_hora || agoraISO();
        if (a) { v.concluida_em = v.data_hora; await CRM.atualizar('atividades', a.id, v); return; }
        const emp = eid || v.empresa_id;
        await CRM.inserir('atividades', Object.assign({ empresa_id: emp, concluida: true, concluida_em: v.data_hora, responsavel_id: CRM.meuId() }, v));
        if (prox.descricao) {
          await CRM.inserir('atividades', { empresa_id: emp, negocio_id: v.negocio_id || null, contato_id: v.contato_id || null, tipo: prox.tipo || 'ligacao', descricao: prox.descricao,
            data_hora: prox.data_hora || proximaHora(), concluida: false, responsavel_id: (CRM.empresa(emp) || {}).responsavel_id || CRM.meuId() });
        }
        CRM.toast('Registrado.');
      },
      aoExcluir: a ? () => CRM.remover('atividades', a.id) : null
    });
  };

  // ------------------------------------------------------------ comunicação
  function variaveis(e, c) {
    const pn = R.primeiroNome(c ? c.nome : '');
    // "Sr. Carlos Silva" → "Sr. Carlos" (o tratamento sozinho não serve de saudação).
    const trat = String(c ? c.nome : '').trim().match(/^((?:sra?|srta|dra?|d)\.?)\s+(\S+)/i);
    const itens = R.textoItens(R.itensHabituais(E().ix, e.id));
    return { contato: c ? c.nome : '', primeiro_nome: pn, empresa: e.nome, vendedor: E().eu.nome, saudacao: trat ? 'Olá, ' + trat[1] + ' ' + trat[2] + '!' : pn ? 'Olá, ' + pn + '!' : 'Olá!',
      vendedor_primeiro_nome: R.primeiroNome(E().eu.nome), data: R.dataBR(CRM.hoje()), minha_empresa: CRM.nomeInstalacao(),
      itens: itens || 'os produtos de sempre', titulos_vencidos: titulosVencidos(e) };
  }
  // "o título da NF 2205 (R$ 917,88, vencido em 24/09)" — para o modelo de cobrança gentil.
  function titulosVencidos(e) {
    const f = CRM.financeiro ? CRM.financeiro(e.id) : null, hoje = CRM.hoje();
    const l = f ? f.titulos.filter(t => t.vencimento < hoje) : [];
    if (!l.length) return 'o pagamento em aberto';
    const um = t => 'NF ' + (t.nota_numero || t.duplicata) + ' (' + R.moeda(t.valor) + ', vencido em ' + R.dataBR(t.vencimento).slice(0, 5) + ')';
    return (l.length === 1 ? 'o título da ' : 'os títulos ') + l.map(um).join(', ');
  }

  function escolheContato(e, contatoId, pred) {
    if (contatoId) return CRM.contato(contatoId);
    const l = CRM.doEmpresa('contatos', e.id).filter(pred);
    return l.find(c => c.principal) || l[0] || null;
  }

  function comModelo(el, canal, aoEscolher) {
    const modelos = E().D.modelos.filter(m => m.canal === canal);
    if (!modelos.length) { aoEscolher(null); return; }
    CRM.menuFlutuante(el, [['Mensagem em branco', () => aoEscolher(null)], '-'].concat(modelos.map(m => [m.nome, () => aoEscolher(m)])));
  }

  async function registraAuto(e, c, tipo, texto) {
    try {
      const a = await CRM.inserir('atividades', { empresa_id: e.id, contato_id: c ? c.id : null, tipo, descricao: texto, concluida: true, concluida_em: agoraISO(), data_hora: agoraISO(), responsavel_id: CRM.meuId(), automatica: true });
      CRM.toast('Registrado no histórico. Quando voltar, conte como foi.');
      return a;
    } catch (x) { CRM.falhou(x); return null; }
  }

  // ------------------------------------------------------------ volta do WhatsApp / e-mail
  // Depois de abrir o WhatsApp (ou o e-mail), quando a vendedora volta para o CRM aparece um
  // quadro rápido: como foi, o que ficou combinado e o próximo passo — assim a conversa não some
  // e o cliente não fica sem retorno. "Depois" fecha sem mexer em nada.
  const RESULTADOS = [['aguardando', 'Mandei, estou aguardando a resposta'], ['respondeu', 'Respondeu, conversamos'], ['orcamento', 'Pediu orçamento'],
    ['pedido', 'Fechou pedido'], ['sem_interesse', 'Sem interesse agora'], ['nao_atende', 'Não atende / número errado']];
  const PROXIMO = { aguardando: ['2', 'Cobrar a resposta'], respondeu: ['7', 'Retomar o contato'], orcamento: ['1', 'Acompanhar o orçamento'],
    pedido: ['7', 'Pós-venda: conferir se chegou tudo certo'], sem_interesse: ['30', 'Tentar de novo'], nao_atende: ['1', 'Conferir o telefone e tentar outro contato'] };
  let aguardandoVolta = null;
  function esperaVolta(e, c, atividade, tipo, jaAgendado) {
    aguardandoVolta = { empresaId: e.id, contatoId: c ? c.id : null, atividade, tipo, jaAgendado: !!jaAgendado, desde: Date.now() };
  }
  function aoVoltar() {
    const v = aguardandoVolta;
    if (!v || document.visibilityState === 'hidden' || Date.now() - v.desde < 4000) return; // ainda não saiu de verdade
    aguardandoVolta = null;
    if (Date.now() - v.desde > 3 * 3600e3 || document.querySelector('#dlgForm[open]')) return;
    formVolta(v);
  }
  if (typeof window !== 'undefined') { window.addEventListener('focus', aoVoltar); document.addEventListener('visibilitychange', aoVoltar); }
  function formVolta(v) {
    const e = CRM.empresa(v.empresaId); if (!e) return;
    const canal = v.tipo === 'email' ? 'e-mail' : 'WhatsApp';
    CRM.abrirForm({
      titulo: 'Como foi o ' + canal + ' com ' + e.nome + '?', intro: 'Anote o que ficou combinado e deixe o próximo passo agendado. "Cancelar" fecha sem mudar nada.', semFoco: true,
      campos: [
        { nome: 'resultado', rotulo: 'Resultado', tipo: 'select', opcoes: RESULTADOS, padrao: 'aguardando', largo: true },
        { nome: 'anotacao', rotulo: 'O que ficou combinado (opcional)', tipo: 'textarea', linhas: 2, largo: true, dica: 'ex.: pediu orçamento de papel toalha; quer entrega na segunda' },
        { nome: 'proximo', rotulo: 'Próximo passo', tipo: 'select', opcoes: [['', 'Nenhum agora'], ['1', 'Amanhã'], ['2', 'Em 2 dias'], ['7', 'Em 1 semana'], ['30', 'Em 1 mês']],
          padrao: v.jaAgendado ? '' : PROXIMO.aguardando[0], ajuda: v.jaAgendado ? 'o retorno já ficou agendado automaticamente' : '' },
        { nome: 'proximo_desc', rotulo: 'O que fazer', padrao: PROXIMO.aguardando[1] }
      ],
      salvarTexto: 'Registrar',
      extras: form => {
        const r = form.elements.resultado;
        r.addEventListener('change', () => { const p = PROXIMO[r.value]; if (!p) return; if (!v.jaAgendado || r.value !== 'aguardando') form.elements.proximo.value = p[0]; form.elements.proximo_desc.value = p[1]; });
      },
      aoSalvar: async val => {
        const rot = R.rotulo(RESULTADOS, val.resultado);
        if (v.atividade && v.atividade.id) {
          const a = E().ix.porId.atividades.get(v.atividade.id) || v.atividade;
          await CRM.atualizar('atividades', a.id, { descricao: String(a.descricao || '') + '\nResultado: ' + rot + (val.anotacao ? ' — ' + val.anotacao : '') });
        }
        if (val.proximo) {
          await CRM.auto.tarefa({ empresa_id: e.id, contato_id: v.contatoId, tipo: v.tipo === 'email' ? 'email' : 'whatsapp', descricao: val.proximo_desc || PROXIMO[val.resultado][1],
            data_hora: R.momento(R.somaDias(CRM.hoje(), Number(val.proximo)), '09:00'), responsavel_id: e.responsavel_id || CRM.meuId() });
        }
        CRM.toast('Registrado' + (val.proximo ? ' e próximo passo agendado.' : '.'));
      }
    });
  }

  // Para outros módulos (sequencia.js) montarem mensagens do mesmo jeito.
  Object.assign(fichas, { variaveis, telDe, escolheContato, registraAuto, esperaVolta });

  fichas.whatsapp = (empresaId, el) => {
    const e = CRM.empresa(empresaId); if (!e) return;
    const c = escolheContato(e, el && el.dataset.contato, x => R.linkWhatsApp(x.whatsapp || x.celular || x.telefone));
    const tel = telDe(e, c);
    if (!R.linkWhatsApp(tel)) { CRM.toast('Sem número de WhatsApp com DDD nesta empresa.', true); return; }
    comModelo(el, 'whatsapp', m => {
      const texto = m ? R.aplicaModelo(m.corpo, variaveis(e, c)) : '';
      window.open(R.linkWhatsApp(tel, texto), '_blank', 'noopener');
      registraAuto(e, c, 'whatsapp', (m ? 'Mensagem "' + m.nome + '" enviada pelo WhatsApp' : 'Conversa aberta no WhatsApp') + (c ? ' com ' + c.nome : '') + (texto ? ': ' + texto : ''))
        .then(a => esperaVolta(e, c, a, 'whatsapp'));
    });
  };

  // Recompra: WhatsApp com a mensagem de recompra (itens habituais pelas notas) e uma tarefa de
  // retorno em 2 dias — assim o cliente sai de "Hora da recompra" e ninguém esquece de cobrar a resposta.
  fichas.whatsappRecompra = async (empresaId, el) => {
    const e = CRM.empresa(empresaId); if (!e) return;
    const c = escolheContato(e, el && el.dataset.contato, x => R.linkWhatsApp(x.whatsapp || x.celular || x.telefone));
    const tel = telDe(e, c);
    if (!R.linkWhatsApp(tel)) { CRM.toast('Sem número de WhatsApp com DDD nesta empresa.', true); return; }
    const texto = R.aplicaModelo(E().cfg.modelo_recompra, variaveis(e, c));
    window.open(R.linkWhatsApp(tel, texto), '_blank', 'noopener');
    const reg = await registraAuto(e, c, 'whatsapp', 'Recompra oferecida pelo WhatsApp' + (c ? ' a ' + c.nome : '') + ': ' + texto);
    esperaVolta(e, c, reg, 'whatsapp', true);
    await CRM.auto.tarefa({ empresa_id: e.id, contato_id: c ? c.id : null, tipo: 'whatsapp', descricao: 'Retorno da oferta de recompra',
      data_hora: R.momento(R.somaDias(CRM.hoje(), 2), '09:00'), responsavel_id: e.responsavel_id || CRM.meuId() });
  };

  fichas.ligar = (empresaId, el) => {
    const e = CRM.empresa(empresaId); if (!e) return;
    const c = escolheContato(e, el && el.dataset.contato, x => x.telefone || x.celular || x.whatsapp);
    const tel = (c && (c.telefone || c.celular || c.whatsapp)) || e.telefone || e.whatsapp;
    if (R.linkTelefone(tel)) { const a = document.createElement('a'); a.href = R.linkTelefone(tel); a.click(); }
    fichas.formRegistro(null, { empresa_id: e.id, contato_id: c ? c.id : null, tipo: 'ligacao', descricao: 'Ligação para ' + (c ? c.nome + ' ' : '') + '(' + tel + '): ' });
  };

  // E-mails para onde vai a mensagem: da pessoa escolhida (clique na pessoa) ou, pelo botão da
  // empresa, TODOS os cadastrados — o da empresa e os de cada pessoa, principal primeiro; um campo
  // pode ter vários separados por ";" "," ou espaço. Sem repetir.
  const separaEmails = v => String(v == null ? '' : v).split(/[;,\s/]+/).map(s => s.trim().replace(/^<|>$/g, '')).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  function emailsDe(e, contato) {
    const pessoas = CRM.doEmpresa('contatos', e.id).slice().sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0));
    const l = contato ? separaEmails(contato.email) : separaEmails(e.email).concat(...pessoas.map(x => separaEmails(x.email)));
    const vistos = new Set();
    return l.filter(m => { const k = m.toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; });
  }
  const linkEmail = (lista, assunto, corpo) => 'mailto:' + lista.map(m => encodeURIComponent(m).replace(/%40/g, '@')).join(',') + '?subject=' + encodeURIComponent(assunto) + '&body=' + encodeURIComponent(corpo);
  fichas.emailsDe = emailsDe;
  fichas.linkEmail = linkEmail;

  fichas.email = (empresaId, el) => {
    const e = CRM.empresa(empresaId); if (!e) return;
    const escolhido = el && el.dataset.contato ? CRM.contato(el.dataset.contato) : null;
    const para = emailsDe(e, escolhido);
    if (!para.length) { CRM.toast('Sem e-mail cadastrado.', true); return; }
    const c = escolhido || escolheContato(e, null, x => x.email); // para {nome}/{primeiro_nome} do modelo
    comModelo(el, 'email', m => {
      const v = variaveis(e, c);
      const assunto = m ? R.aplicaModelo(m.assunto || '', v) : '';
      const corpo = m ? R.aplicaModelo(m.corpo, v) : '';
      location.href = linkEmail(para, assunto, corpo);
      if (para.length > 1) CRM.toast('E-mail aberto para ' + para.length + ' endereços.');
      registraAuto(e, escolhido, 'email', 'E-mail para ' + para.join(', ') + (assunto ? ' — "' + assunto + '"' : '') + (corpo ? ': ' + corpo : ''))
        .then(a => esperaVolta(e, c, a, 'email'));
    });
  };

  // ------------------------------------------------------------ ações em massa
  async function emSequencia(itens, fn, rotulo) {
    let ok = 0, erro = 0;
    for (const it of itens) {
      try { await fn(it); ok++; } catch (e) { erro++; console.warn(e); }
      if ((ok + erro) % 20 === 0) CRM.toast(rotulo + ': ' + (ok + erro) + ' de ' + itens.length + '…');
    }
    CRM.toast(rotulo + ': ' + ok + ' feito(s)' + (erro ? ', ' + erro + ' sem permissão/erro' : '') + '.', !!erro);
  }

  fichas.acaoEmMassa = (tela, acao, ids) => {
    const n = ids.length;
    const limpa = () => { CRM.selecao[tela].clear(); CRM.render(); };
    if (tela === 'empresas') {
      if (acao === 'responsavel') return CRM.abrirForm({
        titulo: 'Trocar responsável de ' + n + ' empresa(s)',
        campos: [{ nome: 'para', rotulo: 'Novo responsável', tipo: 'select', opcoes: CRM.opcoesUsuarios(), largo: true },
          { nome: 'junto', rotulo: 'Levar junto os negócios abertos e as tarefas pendentes', tipo: 'checkbox', largo: true, padrao: true }],
        aoSalvar: async v => {
          await CRM.atualizarVarios('empresas', ids, { responsavel_id: v.para });
          if (v.junto) {
            const s = new Set(ids);
            await CRM.atualizarVarios('negocios', E().D.negocios.filter(x => s.has(x.empresa_id) && x.status === 'aberto').map(x => x.id), { responsavel_id: v.para });
            await CRM.atualizarVarios('atividades', E().D.atividades.filter(x => s.has(x.empresa_id) && !x.concluida).map(x => x.id), { responsavel_id: v.para });
          }
          for (const id of ids) await CRM.auto.sistema(id, null, 'Carteira transferida para ' + CRM.nomeUsuario(v.para));
          CRM.toast(n + ' empresa(s) agora com ' + CRM.nomeUsuario(v.para) + '.'); limpa();
        }
      });
      if (acao === 'situacao') return CRM.abrirForm({
        titulo: 'Mudar situação de ' + n + ' empresa(s)', campos: [{ nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: R.SITUACOES, largo: true }],
        aoSalvar: async v => { await CRM.atualizarVarios('empresas', ids, { situacao: v.situacao }); limpa(); }
      });
      if (acao === 'tag' || acao === 'tirar-tag') return CRM.abrirForm({
        titulo: (acao === 'tag' ? 'Pôr' : 'Tirar') + ' etiqueta em ' + n + ' empresa(s)', campos: [{ nome: 'tag', rotulo: 'Etiqueta', obrigatorio: true, largo: true, sugestoes: CRM.todasTags() }],
        aoSalvar: async v => {
          await emSequencia(ids, async id => {
            const e = CRM.empresa(id); const t = new Set(e.tags || []);
            if (acao === 'tag') t.add(v.tag); else t.delete(v.tag);
            if (t.size !== (e.tags || []).length) await CRM.atualizar('empresas', id, { tags: [...t] });
          }, 'Etiquetas');
          limpa();
        }
      });
      if (acao === 'tarefa') return CRM.abrirForm({
        titulo: 'Criar tarefa para ' + n + ' empresa(s)',
        intro: 'Cada empresa ganha a tarefa, no nome do responsável dela.',
        campos: [{ nome: 'descricao', rotulo: 'O que fazer', obrigatorio: true, largo: true }, { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: R.TIPOS_MANUAIS, padrao: 'ligacao' },
          { nome: 'data_hora', rotulo: 'Quando', tipo: 'datahora', obrigatorio: true }],
        valores: { data_hora: proximaHora() },
        aoSalvar: async v => {
          await CRM.inserirVarios('atividades', ids.map(id => ({ empresa_id: id, tipo: v.tipo, descricao: v.descricao, data_hora: v.data_hora, concluida: false, responsavel_id: (CRM.empresa(id) || {}).responsavel_id || CRM.meuId() })));
          CRM.toast(n + ' tarefa(s) criada(s).'); limpa();
        }
      });
      if (acao === 'excluir') {
        const txt = prompt('Isto exclui ' + n + ' empresa(s) e TUDO delas (pessoas, negócios, histórico). Para confirmar, digite EXCLUIR');
        if (txt !== 'EXCLUIR') return;
        return CRM.removerVarios('empresas', ids).then(() => { CRM.toast(n + ' empresa(s) excluída(s).'); limpa(); }).catch(CRM.falhou);
      }
    }
    if (tela === 'negocios') {
      if (acao === 'responsavel') return CRM.abrirForm({
        titulo: 'Trocar responsável de ' + n + ' negócio(s)', campos: [{ nome: 'para', rotulo: 'Novo responsável', tipo: 'select', opcoes: CRM.opcoesUsuarios(), largo: true }],
        aoSalvar: async v => { await emSequencia(ids, id => CRM.auto.mudarNegocio(CRM.negocio(id), { responsavel_id: v.para }), 'Responsável'); limpa(); }
      });
      if (acao === 'etapa') return CRM.abrirForm({
        titulo: 'Mudar etapa de ' + n + ' negócio(s)', campos: [{ nome: 'etapa_id', rotulo: 'Etapa', tipo: 'select', opcoes: opcoesEtapas(), largo: true }],
        aoSalvar: async v => { await emSequencia(ids, id => CRM.auto.mudarNegocio(CRM.negocio(id), { etapa_id: v.etapa_id }), 'Etapa'); limpa(); }
      });
      if (acao === 'excluir') {
        if (prompt('Excluir ' + n + ' negócio(s)? Digite EXCLUIR') !== 'EXCLUIR') return;
        return CRM.removerVarios('negocios', ids).then(limpa).catch(CRM.falhou);
      }
    }
  };

  // ------------------------------------------------------------ ações
  Object.assign(CRM.acoes, {
    'fechar-empresa': () => $('#dlgEmpresa').close(),
    'fechar-negocio': () => $('#dlgNegocio').close(),
    'editar-empresa': () => fichas.formEmpresa(CRM.empresa(abertaEmpresa)),
    'novo-contato': () => fichas.formContato(null, abertaEmpresa),
    'editar-contato': id => fichas.formContato(CRM.contato(id)),
    'negocio-empresa': () => fichas.formNegocio(null, { empresa_id: abertaEmpresa }),
    'tarefa-empresa': () => fichas.formTarefa(null, { empresa_id: abertaEmpresa }),
    'editar-registro': id => { const a = E().ix.porId.atividades.get(id); if (a) (a.concluida ? fichas.formRegistro(a) : fichas.formTarefa(a)); },
    'filtro-linha': t => { filtroLinha.tipo = t; renderEmpresa(); },
    'alteracoes-empresa': async () => {
      const alvo = $('#alteracoes');
      alvo.innerHTML = '<p class="vazio">Carregando…</p>';
      try {
        const l = await CRM.store().historico({ empresa_id: abertaEmpresa, limite: 100 });
        alvo.innerHTML = CRM.ajustes.htmlHistorico(l) + '<button type="button" class="link" data-acao="fechar-alteracoes">fechar alterações</button>';
      } catch (e) { alvo.innerHTML = ''; CRM.falhou(e); }
    },
    'fechar-alteracoes': () => { $('#alteracoes').innerHTML = ''; },
    whatsapp: (id, el) => fichas.whatsapp(id, el),
    'whatsapp-recompra': (id, el) => fichas.whatsappRecompra(id, el).catch(CRM.falhou),
    ligar: (id, el) => fichas.ligar(id, el),
    email: (id, el) => fichas.email(id, el),
    ganhar: () => fichas.formGanho(CRM.negocio(abertoNegocio)),
    perder: () => fichas.formPerda(CRM.negocio(abertoNegocio)),
    reabrir: () => CRM.auto.mudarNegocio(CRM.negocio(abertoNegocio), { status: 'aberto' }).catch(CRM.falhou),
    'editar-negocio': () => fichas.formNegocio(CRM.negocio(abertoNegocio)),
    'mover-etapa': id => { const n = CRM.negocio(abertoNegocio); if (n.etapa_id !== id) CRM.auto.mudarNegocio(n, { etapa_id: id }).catch(CRM.falhou); },
    'novo-item': () => fichas.formItem(null, abertoNegocio),
    'editar-item': id => fichas.formItem(E().ix.porId.negocio_itens.get(id), abertoNegocio),
    'nova-proposta': () => fichas.formProposta(null, CRM.negocio(abertoNegocio)),
    'editar-proposta': id => fichas.formProposta(E().ix.porId.propostas.get(id), CRM.negocio(abertoNegocio)),
    'imprimir-proposta': id => fichas.imprimirProposta(E().ix.porId.propostas.get(id)),
    'enviar-proposta': (id, el) => { const [pid, canal] = id.split(':'); fichas.enviarProposta(pid, canal, el).catch(CRM.falhou); },
    'proposta-status': async id => {
      const [pid, st] = id.split(':');
      const p = E().ix.porId.propostas.get(pid);
      const n = CRM.negocio(p.negocio_id);
      try {
        const patch = { status: st };
        if (st === 'enviada') patch.enviada_em = CRM.hoje();
        else patch.respondida_em = CRM.hoje();
        const r = await CRM.atualizar('propostas', pid, patch);
        await aoMudarProposta(r, p.status, n);
      } catch (e) { CRM.falhou(e); }
    },
    'tarefa-negocio': () => { const n = CRM.negocio(abertoNegocio); fichas.formTarefa(null, { empresa_id: n.empresa_id, negocio_id: n.id }); },
    'registro-negocio': () => { const n = CRM.negocio(abertoNegocio); fichas.formRegistro(null, { empresa_id: n.empresa_id, negocio_id: n.id }); }
  });

  document.addEventListener('DOMContentLoaded', () => {
    $('#dlgEmpresa').addEventListener('close', () => { abertaEmpresa = null; });
    $('#dlgNegocio').addEventListener('close', () => { abertoNegocio = null; });
  });
})();
