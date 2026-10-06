/* CRM Sistemi Dalessi — núcleo: estado, permissões, gravação, automações,
   navegação, busca global, atalhos, lembretes e entrada (login). */
(function () {
  'use strict';
  const R = window.CRMRegras, DD = window.CRMDados, CRM = window.CRM;
  const { $, esc } = CRM;

  // Mesma versão e hash usados na JJ Solene (auditoria jjs-08), conferido
  // contra o pacote do npm. Trocar de versão: recalcular o hash.
  const SUPABASE_JS = {
    src: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js',
    integrity: 'sha384-iLddHTLokph6Omwoyid4XKxHaWa6w41BnoEj0q5oOrzmYPpHIKt1wyjReA7s//pP'
  };

  const pref = (k, p) => { try { return localStorage.getItem('sd-crm-pref-' + k) || p; } catch (e) { return p; } };
  const gravaPref = (k, v) => { try { localStorage.setItem('sd-crm-pref-' + k, v); } catch (e) { /* ok */ } };

  const E = CRM.estado = {
    aba: pref('aba', 'inicio'),
    eu: null,
    D: DD.vazio(),
    ix: R.indexa(DD.vazio()),
    cfg: R.config({}),
    visao: pref('visao', ''),     // gestor: '' = equipe toda; ou o user_id de um vendedor
    filtros: {},                  // por tela
    carregadoEm: 0
  };
  let store = null, sb = null;
  CRM.store = () => store;
  CRM.gravaPref = gravaPref;
  CRM.pref = pref;

  // ------------------------------------------------------------ consultas rápidas
  CRM.hoje = () => R.hojeISO();
  CRM.papel = () => (E.eu ? E.eu.papel : null);
  CRM.ehGestor = () => ['admin', 'gestor'].indexOf(CRM.papel()) !== -1;
  CRM.ehComprador = () => CRM.papel() === 'comprador';
  CRM.ehAdmin = () => CRM.papel() === 'admin';
  CRM.meuId = () => (E.eu ? E.eu.user_id : null);
  CRM.podeEditarEmpresa = e => !!e && (CRM.ehGestor() || e.responsavel_id === CRM.meuId());
  CRM.podeEditarNegocio = n => !!n && (CRM.ehGestor() || n.responsavel_id === CRM.meuId());
  // Filtro de carteira das telas: vendedor = a própria; gestor = a escolhida no topo.
  CRM.carteira = () => (CRM.ehGestor() ? (E.visao || null) : CRM.meuId());
  CRM.usuario = id => E.ix.porId.usuarios.get(id) || null;
  CRM.nomeUsuario = id => { const u = CRM.usuario(id); return u ? u.nome : '—'; };
  CRM.empresa = id => E.ix.porId.empresas.get(id) || null;
  CRM.negocio = id => E.ix.porId.negocios.get(id) || null;
  CRM.contato = id => E.ix.porId.contatos.get(id) || null;
  CRM.etapa = id => E.ix.porId.etapas.get(id) || null;
  CRM.produto = id => E.ix.porId.produtos.get(id) || null;
  CRM.nomeEmpresa = id => { const e = CRM.empresa(id); return e ? e.nome : '(empresa de outro vendedor)'; };
  CRM.doEmpresa = (t, id) => E.ix.porEmpresa[t].get(id) || [];
  CRM.doNegocio = (t, id) => E.ix.porNegocio[t].get(id) || [];
  CRM.resumo = id => E.ix.resumo.get(id) || {};
  CRM.situacao = e => R.situacaoEfetiva(e, E.ix.resumo.get(e.id), E.cfg, CRM.hoje());
  CRM.opcoes = tipo => E.D.opcoes.filter(o => o.tipo === tipo).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR')).map(o => o.nome);
  // Funis em ordem de uso: o que tem mais negócios primeiro (o principal abre por padrão).
  CRM.funis = () => {
    const nomes = [...new Set(E.D.etapas.map(e => e.funil || 'Vendas'))];
    if (nomes.length < 2) return nomes;
    const qtd = new Map(nomes.map(f => [f, 0]));
    E.D.negocios.forEach(n => { const et = CRM.etapa(n.etapa_id); if (et) qtd.set(et.funil || 'Vendas', qtd.get(et.funil || 'Vendas') + 1); });
    return nomes.sort((a, b) => qtd.get(b) - qtd.get(a) || a.localeCompare(b, 'pt-BR'));
  };
  CRM.etapas = funil => E.D.etapas.filter(e => !funil || (e.funil || 'Vendas') === funil).sort((a, b) => a.ordem - b.ordem);
  CRM.usuariosAtivos = () => E.D.usuarios.filter(u => u.ativo !== false && u.papel !== 'comprador').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  CRM.opcoesUsuarios = vazio => (vazio ? [['', vazio]] : []).concat(CRM.usuariosAtivos().map(u => [u.user_id, u.nome]));
  CRM.todasTags = () => [...new Set([].concat(...E.D.empresas.map(e => e.tags || []), ...E.D.contatos.map(c => c.tags || [])))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  CRM.lista = (lista, vazio) => (vazio !== undefined ? [['', vazio]] : []).concat(lista.map(x => [x, x]));

  // ------------------------------------------------------------ gravação
  function reindexa() { E.ix = R.indexa(E.D); E.cfg = R.config((E.D.config[0] || {}).dados); }
  function troca(t, r) {
    const k = DD.chave(t);
    const i = E.D[t].findIndex(x => x[k] === r[k]);
    if (i >= 0) E.D[t][i] = r; else E.D[t].push(r);
  }

  // Leitura que falhou nunca vira tela vazia: sem nenhuma carga ainda, a tela diz que os dados
  // estão guardados e tenta de novo sozinha; com dados antigos na tela, avisa na faixa do topo.
  let novaTentativa = null;
  CRM.recarregar = async function (silencioso) {
    clearTimeout(novaTentativa);
    try {
      const D = await store.carregar();
      // Comprador não lê empresas (RLS): recebe só nome e ritmo, pela função do banco.
      if (CRM.ehComprador() && store.clientesCompras) D.empresas = await store.clientesCompras();
      // Administrador: sinal de vida do vigia de notas (aviso se parar).
      if (CRM.ehAdmin() && store.vigias) E.vigias = await store.vigias().catch(() => E.vigias || []);
      // Só o administrador lê o contas a receber (RLS): gestora e vendedoras recebem as duplicatas em
      // atraso (com detalhe) para o selo da Recompra, da Fila do dia e da ficha.
      if (!CRM.ehAdmin() && !CRM.ehComprador() && store.duplicatasAtraso) E.atrasos = await store.duplicatasAtraso().catch(() => E.atrasos || []);
      // Administrador e comprador: quando chegaram os relatórios do FKN (lembrete em Compras).
      if ((CRM.ehAdmin() || CRM.ehComprador()) && store.fknAtualizado) E.fkn = await store.fknAtualizado().catch(() => E.fkn || null);
      E.D = D;
      E.carregadoEm = Date.now();
      E.falhaCarga = null;
      reindexa();
      CRM.render();
    } catch (e) {
      console.error(e);
      E.falhaCarga = { msg: e.message || String(e), tentativas: ((E.falhaCarga && E.falhaCarga.tentativas) || 0) + 1 };
      const espera = Math.min(120, 15 * E.falhaCarga.tentativas);
      E.falhaCarga.proxima = Date.now() + espera * 1000;
      novaTentativa = setTimeout(() => CRM.recarregar(true), espera * 1000);
      if (!silencioso && E.carregadoEm) CRM.falhou(e);
      // Com dados na tela, só a faixa muda (não atrapalha quem está digitando).
      if (E.carregadoEm) CRM.atualizaFaixaCarga(); else CRM.render();
    }
  };

  // Cadastro repetido: CNPJ/CPF, telefone ou e-mail que já são de outra empresa.
  CRM.duplicados = (q, ignorarId) => store.duplicados ? store.duplicados(q, ignorarId) : Promise.resolve(R.achaDuplicados(E.D, q, ignorarId));
  // Antes de gravar: trava se o dado da própria empresa já é de outra (o banco também trava).
  // Na edição, só confere o que mudou (cadastro antigo repetido continua editável).
  CRM.barraDuplicado = async (v, antes) => {
    const mudou = (campo, chave) => !antes || chave(v[campo]) !== chave(antes[campo]);
    const q = { cnpj: mudou('cnpj', R.chaveDoc) ? v.cnpj : null,
      telefones: ['telefone', 'whatsapp'].filter(c => mudou(c, R.chaveTelefone)).map(c => v[c]),
      emails: mudou('email', R.chaveEmail) ? [v.email] : [] };
    if (!R.chaveDoc(q.cnpj) && !q.telefones.some(R.chaveTelefone) && !q.emails.some(R.chaveEmail)) return;
    const d = (await CRM.duplicados(q, antes && antes.id)).find(x => x.de_empresa);
    if (d) throw new Error('este cliente já está cadastrado: o ' + d.campo + ' é de "' + d.nome + '" (carteira: ' + d.responsavel + '). Abra o cadastro que já existe em vez de criar outro.');
  };
  // Telefone com DDD e e-mail válido (cadastro novo, se a configuração pedir).
  CRM.confereContatoCadastro = (telefones, email) => {
    if (E.cfg.exigir_contato_cadastro === false) return;
    if (!telefones.some(t => R.digitos(t).replace(/^55(?=\d{10,11}$)/, '').length >= 10)) throw new Error('informe o telefone ou WhatsApp com DDD.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim())) throw new Error('informe um e-mail válido.');
  };

  CRM.inserir = async (t, obj) => { const r = await store.inserir(t, obj); troca(t, r); reindexa(); CRM.render(); return r; };
  CRM.inserirVarios = async (t, lista, prog, aoErro) => {
    if (!lista.length) return [];
    const rs = await store.inserirVarios(t, lista, prog, aoErro);
    // Índice por chave: com dezenas de milhares de itens de nota, troca() um a um ficaria quadrático.
    const k = DD.chave(t), pos = new Map(E.D[t].map((x, i) => [x[k], i]));
    rs.forEach(r => { const i = pos.get(r[k]); if (i != null) E.D[t][i] = r; else { pos.set(r[k], E.D[t].length); E.D[t].push(r); } });
    reindexa(); CRM.render(); return rs;
  };
  CRM.atualizar = async (t, id, patch) => { const r = await store.atualizar(t, id, patch); troca(t, r); reindexa(); CRM.render(); return r; };
  CRM.atualizarVarios = async (t, ids, patch) => {
    if (!ids.length) return;
    await store.atualizarVarios(t, ids, patch);
    const k = DD.chave(t), s = new Set(ids), agora = new Date().toISOString();
    E.D[t] = E.D[t].map(r => (s.has(r[k]) ? Object.assign({}, r, patch, { atualizado_em: agora }) : r));
    reindexa(); CRM.render();
  };
  CRM.remover = async (t, id) => { await store.remover(t, id); DD.cascataMemoria(E.D, t, [id]); reindexa(); CRM.render(); };
  CRM.removerVarios = async (t, ids) => { if (!ids.length) return; await store.removerVarios(t, ids); DD.cascataMemoria(E.D, t, ids); reindexa(); CRM.render(); };
  CRM.salvar = (t, id, obj) => (id ? CRM.atualizar(t, id, obj) : CRM.inserir(t, obj));

  CRM.salvarConfig = async patch => {
    const atual = E.D.config[0] || { id: 1, dados: {} };
    const dados = Object.assign({}, atual.dados, patch);
    if (E.D.config.length) await CRM.atualizar('config', 1, { dados });
    else await CRM.inserir('config', { id: 1, dados });
  };

  // ------------------------------------------------------------ automações
  // Tudo que o CRM faz sozinho passa por aqui (e respeita as chaves da configuração).
  function proximoHorario() {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    if (d.getHours() >= 18) { d.setDate(d.getDate() + 1); d.setHours(9); }
    if (d.getHours() < 8) d.setHours(9);
    return d.toISOString();
  }
  const emDias = dias => R.momento(R.somaDias(CRM.hoje(), dias), '09:00');

  const A = CRM.auto = {
    async sistema(empresa_id, negocio_id, texto) {
      try {
        return await CRM.inserir('atividades', { empresa_id, negocio_id: negocio_id || null, tipo: 'sistema', descricao: texto,
          data_hora: new Date().toISOString(), concluida: true, concluida_em: new Date().toISOString(), responsavel_id: CRM.meuId(), automatica: true });
      } catch (e) { console.warn('registro automático falhou', e); return null; }
    },

    async tarefa(dados) {
      try {
        return await CRM.inserir('atividades', Object.assign({ tipo: 'tarefa', concluida: false, automatica: true, responsavel_id: CRM.meuId() }, dados));
      } catch (e) { console.warn('tarefa automática falhou', e); return null; }
    },

    async aoCriarEmpresa(e) {
      if (E.cfg.auto_tarefa_lead && e.situacao === 'lead') {
        await A.tarefa({ empresa_id: e.id, descricao: 'Fazer o primeiro contato', tipo: 'ligacao', data_hora: proximoHorario(), responsavel_id: e.responsavel_id || CRM.meuId() });
      }
    },

    // Mudança central de negócio: etapa, status (ganho/perdido/reaberto), responsável.
    async mudarNegocio(n, patch) {
      const p = Object.assign({}, patch);
      const hoje = CRM.hoje();
      const novoStatus = p.status || n.status;
      if (p.status && p.status !== n.status) {
        p.fechado_em = p.status === 'aberto' ? null : (p.fechado_em || hoje);
        if (p.status !== 'perdido') p.motivo_perda = null;
        if (p.status === 'aberto') p.probabilidade = null;
      }
      const salvo = await CRM.atualizar('negocios', n.id, p);
      const logs = [];
      if (p.etapa_id && p.etapa_id !== n.etapa_id) {
        const de = CRM.etapa(n.etapa_id), para = CRM.etapa(p.etapa_id);
        logs.push('Etapa: ' + (de ? de.nome : '—') + ' → ' + (para ? para.nome : '—'));
      }
      if (p.status && p.status !== n.status) {
        logs.push(p.status === 'ganho' ? 'Negócio GANHO (' + R.moeda(salvo.valor) + ')'
          : p.status === 'perdido' ? 'Negócio PERDIDO' + (salvo.motivo_perda ? ' — motivo: ' + salvo.motivo_perda : '')
          : 'Negócio reaberto');
      }
      if (p.responsavel_id !== undefined && p.responsavel_id !== n.responsavel_id) {
        logs.push('Responsável: ' + CRM.nomeUsuario(n.responsavel_id) + ' → ' + CRM.nomeUsuario(p.responsavel_id));
      }
      if (logs.length) await A.sistema(salvo.empresa_id, salvo.id, salvo.titulo + ' — ' + logs.join('; '));
      if (p.status && p.status !== n.status) {
        if (novoStatus === 'ganho') await A.aoGanhar(salvo);
        if (novoStatus === 'perdido') await A.aoPerder(salvo);
      }
      return salvo;
    },

    async aoGanhar(n) {
      const e = CRM.empresa(n.empresa_id);
      if (e && e.situacao !== 'cliente' && CRM.podeEditarEmpresa(e)) {
        try { await CRM.atualizar('empresas', e.id, { situacao: 'cliente' }); } catch (x) { console.warn(x); }
      }
      const resp = n.responsavel_id || CRM.meuId();
      if (E.cfg.auto_pos_venda) {
        await A.tarefa({ empresa_id: n.empresa_id, negocio_id: n.id, tipo: 'ligacao', responsavel_id: resp,
          descricao: 'Pós-venda: confirmar entrega e satisfação (' + n.titulo + ')', data_hora: emDias(E.cfg.dias_pos_venda) });
      }
      if (E.cfg.auto_recompra) {
        const ciclo = R.cicloRecompra(e, e && E.ix.resumo.get(e.id), E.cfg);
        await A.tarefa({ empresa_id: n.empresa_id, tipo: 'ligacao', responsavel_id: resp,
          descricao: 'Recompra: oferecer reposição', data_hora: emDias(Math.max(1, ciclo - 3)) });
      }
    },

    async aoPerder(n) {
      if (E.cfg.auto_retomar_perda) {
        await A.tarefa({ empresa_id: n.empresa_id, tipo: 'ligacao', responsavel_id: n.responsavel_id || CRM.meuId(),
          descricao: 'Retomar contato (perdido: ' + n.titulo + ')', data_hora: emDias(E.cfg.dias_retomar_perda) });
      }
    },

    async aoEnviarProposta(prop, n) {
      await CRM.inserir('atividades', { empresa_id: n.empresa_id, negocio_id: n.id, tipo: 'proposta', concluida: true,
        concluida_em: new Date().toISOString(), data_hora: new Date().toISOString(), responsavel_id: CRM.meuId(),
        descricao: 'Proposta #' + prop.numero + ' enviada — ' + R.moeda(prop.valor_total) + (prop.validade ? ' (válida até ' + R.dataBR(prop.validade) + ')' : ''), automatica: true });
      const alvo = E.cfg.etapa_ao_enviar_proposta && CRM.etapa(E.cfg.etapa_ao_enviar_proposta);
      const atual = CRM.etapa(n.etapa_id);
      if (alvo && n.status === 'aberto' && (!atual || (atual.funil === alvo.funil && atual.ordem < alvo.ordem))) {
        await A.mudarNegocio(CRM.negocio(n.id), { etapa_id: alvo.id });
      }
    },

    async aoConcluirTarefa(a) {
      if (a.recorrencia) {
        const prox = R.proximaRecorrencia(a.data_hora, a.recorrencia);
        if (prox) await CRM.inserir('atividades', { empresa_id: a.empresa_id, contato_id: a.contato_id, negocio_id: a.negocio_id, tipo: a.tipo,
          descricao: a.descricao, data_hora: prox, concluida: false, responsavel_id: a.responsavel_id, recorrencia: a.recorrencia });
        return;
      }
      // Disciplina de vendas: negócio aberto sem próximo passo esfria.
      const aberto = CRM.doEmpresa('negocios', a.empresa_id).some(n => n.status === 'aberto');
      const outra = CRM.doEmpresa('atividades', a.empresa_id).some(x => !x.concluida);
      if (aberto && !outra && CRM.fichas) CRM.fichas.formTarefa(null, { empresa_id: a.empresa_id, negocio_id: a.negocio_id }, 'Tarefa concluída. Qual o próximo passo?');
    }
  };

  // Responsável de um lead novo: vendedor = ele mesmo; gestor = escolhido ou rodízio.
  CRM.responsavelParaLead = async escolhido => {
    if (!CRM.ehGestor()) return CRM.meuId();
    if (escolhido && escolhido !== '__rodizio') return escolhido;
    if (escolhido === '__rodizio' || E.cfg.rodizio) {
      try { const id = await store.proximoVendedor(); if (id) return id; } catch (e) { console.warn(e); }
    }
    return CRM.meuId();
  };

  CRM.concluirTarefa = async (id, feita) => {
    const a = E.ix.porId.atividades.get(id);
    if (!a) return;
    try {
      const r = await CRM.atualizar('atividades', id, { concluida: feita, concluida_em: feita ? new Date().toISOString() : null });
      if (feita) { CRM.toast('Feito.'); await A.aoConcluirTarefa(r); }
    } catch (e) { CRM.falhou(e); }
  };

  // ------------------------------------------------------------ render
  const ABAS = [
    ['inicio', 'Início', '⌂'], ['fila', 'Fila do dia', '▶'], ['funil', 'Funil', '▥'], ['empresas', 'Empresas', '▦'], ['pessoas', 'Pessoas', '☺'],
    ['negocios', 'Negócios', '$'], ['agenda', 'Atividades', '▣'], ['relatorios', 'Relatórios', '▲'], ['ajustes', 'Configurações', '⚙'], ['compras', 'Compras', '▤'], ['gestao', 'Gestão', '◆'], ['caixa', 'Caixa', '◈']
  ];
  CRM.ABAS = ABAS;
  // Relatórios do FKN que estão pendentes neste turno (manhã/tarde): [{ arquivo, ultimo, turno }].
  CRM.lembreteFkn = () => {
    if (!E.fkn || !(CRM.ehAdmin() || CRM.ehComprador())) return [];
    // O comprador puxa só o estoque; o contas a receber é só do administrador (06/10/2026).
    return [['estoque', 'Listagem cadastral de produtos']].concat(CRM.ehAdmin() ? [['receber', 'Contas a receber por cliente (em aberto)']] : [])
      .map(([k, nome]) => { const l = DD.lembreteFkn(E.fkn[k]); return l ? { arquivo: nome, ultimo: E.fkn[k], turno: l.turno } : null; }).filter(Boolean);
  };
  // Último arquivo do FKN recusado (opção esquecida ao puxar), mais novo que a última entrega boa.
  CRM.recusasFkn = () => ((E.fkn && (CRM.ehAdmin() || CRM.ehComprador()) && E.fkn.recusas) || []).filter(r => CRM.ehAdmin() || r.tipo === 'produtos');
  CRM.recarregarFkn = async () => { if (store && store.fknAtualizado) { E.fkn = await store.fknAtualizado().catch(() => E.fkn); CRM.render(); } };

  let pendente = false;
  CRM.render = () => {
    if (pendente) return;
    pendente = true;
    requestAnimationFrame(() => { pendente = false; renderAgora(); });
  };

  function atualizaFaixaCarga() {
    const faixa = $('#faixaCarga');
    if (!faixa) return;
    faixa.hidden = !(E.falhaCarga && E.carregadoEm);
    if (!faixa.hidden) faixa.innerHTML = 'Não consegui atualizar os dados (' + esc(E.falhaCarga.msg) + '). O que está na tela é de ' +
      new Date(E.carregadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '. <button type="button" class="mini" data-acao="recarregar-dados">Tentar agora</button>';
  }
  CRM.atualizaFaixaCarga = atualizaFaixaCarga;

  // Vigia de notas sem sinal de vida (manda a cada 30 min): só o administrador vê.
  function atualizaFaixaVigia() {
    const f = $('#faixaVigia');
    if (!f) return;
    const parados = CRM.ehAdmin() ? (E.vigias || []).filter(c => DD.situacaoVigia(c).estado === 'parado') : [];
    f.hidden = !parados.length;
    if (parados.length) f.innerHTML = parados.map(c => 'O vigia de notas "' + esc(c.nome) + '" não dá sinal de vida desde ' +
      esc(R.dataBR(R.diaLocal(c.ultimo_sinal)) + ' ' + R.horaLocal(c.ultimo_sinal)) + ': as notas novas não estão entrando.').join(' ') +
      ' Confira se o servidor está ligado e se a tarefa "CRM - vigia de notas" está rodando. ' +
      '<button type="button" class="mini" data-acao="ver-integracoes">ver integrações</button>';
  }

  function renderAgora() {
    if (!E.eu) return;
    // Comprador: só Compras. Compras e Gestão: administrador. Configurações: gestor.
    const abas = CRM.ehComprador() ? ABAS.filter(a => a[0] === 'compras')
      : ABAS.filter(a => (a[0] !== 'ajustes' || CRM.ehGestor()) && ((a[0] !== 'gestao' && a[0] !== 'compras' && a[0] !== 'caixa') || CRM.ehAdmin()));
    if (!abas.some(a => a[0] === E.aba)) E.aba = abas[0][0];
    ['#buscaGlobal', '[data-acao="novo-menu"]', '#sino'].forEach(s => { const el = $(s); if (el) el.hidden = CRM.ehComprador(); });
    const al = R.alertas(E.D, E.ix, E.cfg, CRM.hoje(), CRM.carteira());
    const nTarefas = al.atrasadas.length + al.deHoje.length;
    $('#menuLateral').innerHTML = abas.map(a => '<button type="button" class="nav' + (E.aba === a[0] ? ' ativa' : '') + '" data-acao="aba" data-id="' + a[0] + '"' +
      (E.aba === a[0] ? ' aria-current="page"' : '') + ' title="' + esc(a[1]) + ' (tecla ' + (ABAS.indexOf(a) + 1) + ')"><span class="nav-ico">' + a[2] + '</span><span class="nav-txt">' + esc(a[1]) + '</span>' +
      (a[0] === 'inicio' && nTarefas ? '<span class="bolinha' + (al.atrasadas.length ? ' vermelha' : '') + '">' + nTarefas + '</span>' : '') +
      (a[0] === 'compras' && (CRM.lembreteFkn().length || CRM.recusasFkn().length) ? '<span class="bolinha vermelha" title="Puxar os relatórios do FKN">!</span>' : '') + '</button>').join('');

    const sel = $('#visao');
    if (CRM.ehGestor()) {
      sel.hidden = false;
      sel.innerHTML = CRM.opcoesHTML([['', 'Equipe toda']].concat(CRM.usuariosAtivos().map(u => [u.user_id, u.nome])), E.visao);
    } else sel.hidden = true;
    $('#nomeTopo').textContent = nomeInstalacao() === 'CRM' ? 'Sistemi Dalessi' : nomeInstalacao();
    $('#usuarioTopo').innerHTML = CRM.avatar(E.eu) + '<span class="usu-nome">' + esc(E.eu.nome) + '<small>' + esc(R.rotulo(R.PAPEIS, E.eu.papel)) + '</small></span>';
    const nAlertas = al.atrasadas.length + al.leadsSemAtendimento.length + al.negociosParados.length + al.clientesSemContato.length + al.recompra.length;
    $('#sino').innerHTML = '<span aria-hidden="true">🔔</span>' + (nAlertas ? '<span class="bolinha vermelha">' + nAlertas + '</span>' : '');
    $('#sino').title = al.atrasadas.length + ' tarefa(s) atrasada(s), ' + al.leadsSemAtendimento.length + ' lead(s) sem atendimento, ' +
      al.negociosParados.length + ' negócio(s) parado(s), ' + al.clientesSemContato.length + ' cliente(s) sem contato, ' + al.recompra.length + ' recompra(s)';

    atualizaFaixaCarga();
    atualizaFaixaVigia();
    const c = $('#conteudo');
    if (E.falhaCarga && !E.carregadoEm) {
      c.innerHTML = '<section class="cartao falha-carga"><h2>Não consegui carregar os dados do CRM</h2>' +
        '<p><strong>Seus dados estão guardados no servidor: nada foi apagado.</strong> A leitura falhou: ' + esc(E.falhaCarga.msg) + '</p>' +
        '<p>Vou tentar de novo sozinho em ' + Math.max(1, Math.round((E.falhaCarga.proxima - Date.now()) / 1000)) + ' segundos.</p>' +
        '<p><button type="button" class="btn" data-acao="recarregar-dados">Tentar agora</button></p>' +
        '<p class="dica">Se continuar assim por alguns minutos, avise o administrador.</p></section>';
      return;
    }
    const tela = CRM.telas[E.aba] || CRM.telas.inicio;
    const rolagem = c.scrollTop;
    const foco = document.activeElement && document.activeElement.id && c.contains(document.activeElement) ? document.activeElement.id : null;
    c.innerHTML = tela.render(al);
    if (tela.depois) tela.depois(c);
    CRM.aplicaBarras(c);
    c.scrollTop = rolagem;
    if (foco && document.getElementById(foco)) {
      const el = document.getElementById(foco);
      el.focus();
      // Só campos de texto aceitam cursor (caixa de marcar, data, número etc. dão erro).
      if (el.setSelectionRange && /^(text|textarea|search|tel|url|email|password|)$/.test(el.type || '') && typeof el.value === 'string') { try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) { /* sem cursor */ } }
    }
    if (CRM.fichas) CRM.fichas.renderAbertas();
  }

  CRM.irPara = (aba, filtros) => {
    E.aba = aba; gravaPref('aba', aba);
    if (filtros) E.filtros[aba] = Object.assign({}, E.filtros[aba] || {}, filtros);
    $('#conteudo').scrollTop = 0;
    CRM.render();
  };

  // ------------------------------------------------------------ busca global
  let resultados = [], selecionado = 0;
  function renderBusca() {
    const caixa = $('#resultadosBusca');
    const termo = $('#buscaGlobal').value;
    resultados = R.buscaGlobal(E.D, E.ix, termo, 6);
    if (!termo.trim()) { caixa.hidden = true; return; }
    const rot = { empresa: 'Empresa', contato: 'Pessoa', negocio: 'Negócio', proposta: 'Proposta' };
    caixa.hidden = false;
    caixa.innerHTML = resultados.length ? resultados.map((r, i) => '<button type="button" class="res' + (i === selecionado ? ' sel' : '') + '" data-i="' + i + '">' +
      '<span class="res-tipo">' + rot[r.tipo] + '</span><strong>' + esc(r.titulo) + '</strong><small>' + esc(r.sub) + '</small></button>').join('')
      : '<p class="vazio">Nada encontrado para "' + esc(termo) + '".</p>';
  }
  function abreResultado(r) {
    $('#resultadosBusca').hidden = true;
    $('#buscaGlobal').value = '';
    $('#buscaGlobal').blur();
    if (r.tipo === 'empresa') CRM.fichas.abrirEmpresa(r.id);
    else if (r.tipo === 'contato') CRM.fichas.abrirEmpresa(r.empresa_id);
    else if (r.tipo === 'negocio') CRM.fichas.abrirNegocio(r.id);
    else if (r.tipo === 'proposta') CRM.fichas.abrirNegocio(r.negocio_id);
  }

  // ------------------------------------------------------------ ações por delegação
  const ACOES = CRM.acoes = {
    'recarregar-dados': () => CRM.recarregar().then(() => { if (!E.falhaCarga) CRM.toast('Dados carregados.'); }),
    'ver-integracoes': () => { CRM.gravaPref('ajustes', 'integracoes'); CRM.irPara('ajustes'); },
    aba: id => CRM.irPara(id),
    'abrir-empresa': id => CRM.fichas.abrirEmpresa(id),
    'abrir-negocio': id => CRM.fichas.abrirNegocio(id),
    'editar-tarefa': id => CRM.fichas.formTarefa(E.ix.porId.atividades.get(id)),
    concluir: (id, el) => CRM.concluirTarefa(id, el.checked),
    'novo-menu': (id, el) => CRM.menuFlutuante(el, [
      ['Lead / empresa', () => CRM.fichas.formLead(), 'tecla N'],
      ['Negócio', () => CRM.fichas.formNegocio(null, {})],
      CRM.importarOrcamento ? ['Orçamento do FKN (importar)', () => CRM.importarOrcamento()] : null,
      ['Tarefa', () => CRM.fichas.formTarefa(null, {}), 'tecla T'],
      ['Registrar atividade', () => CRM.fichas.formRegistro(null, {}), 'tecla R']
    ].filter(Boolean)),
    'menu-usuario': (id, el) => CRM.menuFlutuante(el, [
      ['Recarregar dados', () => CRM.recarregar().then(() => CRM.toast('Atualizado.'))],
      ['Ativar lembretes na tela', pedirNotificacao],
      ['Atalhos do teclado', mostraAtalhos],
      store.modo === 'supabase' ? ['Alterar minha senha', formMinhaSenha] : ['Carregar dados de exemplo', () => CRM.ajustes.carregarExemplos()],
      store.modo === 'supabase' ? ['Sair', () => sb.auth.signOut()] : ['Apagar tudo deste navegador', () => CRM.ajustes.apagarTudoLocal()]
    ]),
    sino: () => CRM.irPara('inicio')
  };

  function ligarEventos() {
    document.addEventListener('click', ev => {
      const el = ev.target.closest('[data-acao]');
      if (!el || el.disabled) return;
      const f = ACOES[el.dataset.acao];
      if (f) f(el.dataset.id, el, ev);
    });
    document.addEventListener('change', ev => {
      if (ev.target.id === 'visao') { E.visao = ev.target.value; gravaPref('visao', E.visao); CRM.render(); }
    });
    document.addEventListener('keydown', ev => {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('tr[data-acao], [role=button][data-acao]')) { ev.preventDefault(); ev.target.click(); }
    });

    const busca = $('#buscaGlobal');
    busca.addEventListener('input', () => { selecionado = 0; renderBusca(); });
    busca.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowDown') { selecionado = Math.min(resultados.length - 1, selecionado + 1); renderBusca(); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { selecionado = Math.max(0, selecionado - 1); renderBusca(); ev.preventDefault(); }
      else if (ev.key === 'Enter' && resultados[selecionado]) { abreResultado(resultados[selecionado]); ev.preventDefault(); }
      else if (ev.key === 'Escape') { busca.value = ''; renderBusca(); busca.blur(); }
    });
    $('#resultadosBusca').addEventListener('mousedown', ev => {
      const b = ev.target.closest('[data-i]');
      if (b) { ev.preventDefault(); abreResultado(resultados[+b.dataset.i]); }
    });
    busca.addEventListener('blur', () => setTimeout(() => { $('#resultadosBusca').hidden = true; }, 150));
    busca.addEventListener('focus', () => { if (busca.value) renderBusca(); });

    // Atalhos (fora de campos de texto e sem diálogo aberto).
    document.addEventListener('keydown', ev => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); busca.focus(); busca.select(); return; }
      const t = ev.target;
      if (ev.ctrlKey || ev.metaKey || ev.altKey || !E.eu) return;
      if (t.matches('input, textarea, select, [contenteditable]') || $('dialog[open]')) return;
      const k = ev.key.toLowerCase();
      if (k === '/') { ev.preventDefault(); busca.focus(); }
      else if (k === 'n') { ev.preventDefault(); CRM.fichas.formLead(); }
      else if (k === 't') { ev.preventDefault(); CRM.fichas.formTarefa(null, {}); }
      else if (k === 'r') { ev.preventDefault(); CRM.fichas.formRegistro(null, {}); }
      else if (k === '?') { ev.preventDefault(); mostraAtalhos(); }
      else if (/^[1-8]$/.test(k)) {
        const a = ABAS[+k - 1];
        if (a && (a[0] !== 'ajustes' || CRM.ehGestor())) CRM.irPara(a[0]);
      }
    });

    // Outro computador pode ter mexido: ao voltar para a janela, recarrega
    // (se passou 1 min e não há formulário aberto, para não atropelar o que se digita).
    window.addEventListener('focus', () => {
      if (store && store.modo === 'supabase' && E.eu && Date.now() - E.carregadoEm > 60000 && !$('#dlgForm').open) CRM.recarregar(true);
    });
    setInterval(() => {
      if (store && store.modo === 'supabase' && E.eu && document.visibilityState === 'visible' && Date.now() - E.carregadoEm > 300000 && !$('dialog[open]')) CRM.recarregar(true);
      verificaLembretes();
      if (versaoNova) atualizaSePuder(); else confereVersao();
    }, 60000);
    window.addEventListener('focus', () => confereVersao());
  }

  // ------------------------------------------------------------ versão nova publicada
  // O index.html é carimbado (ferramentas/carimba-versao.js): cada arquivo com ?v= e a versão
  // geral na <meta name="crm-versao">. O CRM que fica aberto o dia todo confere a versão
  // publicada e, quando muda, recarrega sozinho quando ninguém está digitando (sem Ctrl+F5).
  const minhaVersao = (document.querySelector('meta[name="crm-versao"]') || {}).content || '';
  let versaoNova = '', ultimaConsulta = 0;
  async function confereVersao() {
    if (!minhaVersao || !/^https?:$/.test(location.protocol) || Date.now() - ultimaConsulta < 240000) return;
    ultimaConsulta = Date.now();
    try {
      const r = await fetch(location.pathname, { cache: 'no-store' });
      const m = r.ok && /<meta name="crm-versao" content="([0-9a-f]+)">/.exec(await r.text());
      if (m && m[1] !== minhaVersao) versaoNova = m[1];
    } catch (e) { /* sem rede agora: confere na próxima */ }
    if (versaoNova) atualizaSePuder();
  }
  // Janela aberta (ficha, formulário) ou campo com texto: espera a próxima volta.
  function ocupado() {
    if ($('dialog[open]')) return true;
    const a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value);
  }
  function atualizaSePuder() {
    if (!versaoNova || ocupado()) return;
    // Sem laço: se já recarregou para esta versão e o navegador insistiu na antiga, só avisa.
    let tentou = '';
    try { tentou = sessionStorage.getItem('sd-crm-recarregou') || ''; } catch (e) { /* ok */ }
    if (tentou === versaoNova) {
      const f = $('#faixaVersao');
      if (f && f.hidden) { f.textContent = 'Há uma versão nova do CRM. Aperte Ctrl+F5 para atualizar.'; f.hidden = false; }
      return;
    }
    try { sessionStorage.setItem('sd-crm-recarregou', versaoNova); } catch (e) { /* ok */ }
    CRM.toast('Versão nova do CRM: atualizando…');
    setTimeout(() => location.reload(), 1500);
  }
  CRM.versao = { minha: () => minhaVersao, confere: () => { ultimaConsulta = 0; return confereVersao(); } };

  function mostraAtalhos() {
    CRM.abrirForm({
      titulo: 'Atalhos do teclado', campos: [], salvarTexto: 'Fechar',
      htmlAntes: '<table class="tabela atalhos"><tbody>' + [
        ['Ctrl + K  ou  /', 'Buscar qualquer coisa (empresa, pessoa, telefone, e-mail, negócio, nº da proposta)'],
        ['N', 'Novo lead'], ['T', 'Nova tarefa'], ['R', 'Registrar atividade'],
        ['1 a 8', 'Ir para Início, Funil, Empresas, Pessoas, Negócios, Atividades, Relatórios, Configurações'],
        ['Esc', 'Fechar a janela aberta'], ['?', 'Esta ajuda']
      ].map(l => '<tr><td><kbd>' + esc(l[0]) + '</kbd></td><td>' + esc(l[1]) + '</td></tr>').join('') + '</tbody></table>',
      aoSalvar: () => true
    });
  }

  // ------------------------------------------------------------ lembretes
  const avisadas = new Set();
  function pedirNotificacao() {
    if (!('Notification' in window)) { CRM.toast('Este navegador não mostra lembretes.', true); return; }
    Notification.requestPermission().then(p => CRM.toast(p === 'granted' ? 'Lembretes ativados: o CRM avisa 10 minutos antes de cada tarefa (com a aba aberta).' : 'Lembretes bloqueados no navegador.', p !== 'granted'));
  }
  function verificaLembretes() {
    if (!E.eu) return;
    const agora = Date.now();
    E.D.atividades.forEach(a => {
      if (a.concluida || a.responsavel_id !== CRM.meuId() || avisadas.has(a.id)) return;
      const t = new Date(a.data_hora).getTime();
      if (t - agora <= 10 * 60000 && t - agora > -5 * 60000) {
        avisadas.add(a.id);
        const txt = R.horaLocal(a.data_hora) + ' · ' + CRM.nomeEmpresa(a.empresa_id) + ': ' + a.descricao;
        if ('Notification' in window && Notification.permission === 'granted') {
          const n = new Notification('Lembrete do CRM', { body: txt, tag: a.id });
          n.onclick = () => { window.focus(); CRM.fichas.abrirEmpresa(a.empresa_id); };
        } else CRM.toast('⏰ ' + txt);
      }
    });
  }

  // ------------------------------------------------------------ entrada
  const nomeInstalacao = () => (window.CRM_CONFIG && window.CRM_CONFIG.nomeEmpresa) || E.cfg.nome_empresa || 'CRM';
  const logo = () => (window.CRM_CONFIG && window.CRM_CONFIG.logo) || 'assets/logo.jpg';
  // Versão quadrada para o menu e a aba do navegador (sem ela, usa o logo normal).
  const logoIcone = () => (window.CRM_CONFIG && window.CRM_CONFIG.logoIcone) || logo();
  CRM.nomeInstalacao = nomeInstalacao;
  CRM.logo = logo;

  // Tela de entrada (login, senha nova, avisos): fundo no degradê da marca com ondas brancas
  // translúcidas no pé e a mesma onda do orçamento no alto do cartão.
  function ondasEntrada() {
    const cs = getComputedStyle(document.documentElement);
    const a = cs.getPropertyValue('--grad-a').trim() || '#2a4a7a', b = cs.getPropertyValue('--grad-b').trim() || '#0f2340';
    return {
      cartao: '<svg class="onda-cartao" viewBox="0 0 800 48" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="onda-entrada" x1="0" x2="1" y1="0" y2="0">' +
        '<stop offset="0" stop-color="' + esc(a) + '"/><stop offset="1" stop-color="' + esc(b) + '"/></linearGradient></defs>' +
        '<path d="M0 30 C 130 10, 270 8, 410 26 S 690 46, 800 20 V0 H0 Z" fill="url(#onda-entrada)" opacity=".28"/>' +
        '<path d="M0 18 C 150 0, 290 2, 430 16 S 700 32, 800 8 V0 H0 Z" fill="url(#onda-entrada)"/></svg>',
      fundo: '<svg class="ondas-fundo" viewBox="0 0 800 60" preserveAspectRatio="none" aria-hidden="true">' +
        '<path d="M0 26 C 160 4, 300 6, 450 24 S 700 48, 800 18 V60 H0 Z" fill="#fff" opacity=".10"/>' +
        '<path d="M0 40 C 140 22, 320 20, 470 36 S 690 56, 800 34 V60 H0 Z" fill="#fff" opacity=".14"/></svg>'
    };
  }
  function telaEntrada(html) {
    $('#app').hidden = true;
    const o = ondasEntrada();
    $('#tela').innerHTML = '<div class="entrada">' + o.fundo + '<div class="entrada-cartao">' + o.cartao +
      '<img src="' + esc(logo()) + '" alt="" class="logo-grande"><h1>' + esc(nomeInstalacao()) + '</h1>' + html + '</div>' +
      '<p class="rodape-entrada">CRM · Sistemi Dalessi — sistemas sob medida</p></div>';
  }

  function telaAviso(titulo, texto) { telaEntrada('<h2>' + esc(titulo) + '</h2><p>' + esc(texto) + '</p>'); }

  function telaLogin(erro, info) {
    telaEntrada('<form id="formLogin" class="grade-login">' +
      '<label class="campo"><span>E-mail</span><input type="email" id="loginEmail" autocomplete="username" required></label>' +
      '<label class="campo"><span>Senha</span><input type="password" id="loginSenha" autocomplete="current-password" required></label>' +
      (erro ? '<p class="erro-form">' + esc(erro) + '</p>' : '') + (info ? '<p class="ok-form">' + esc(info) + '</p>' : '') +
      '<button type="submit" class="btn largo">Entrar</button>' +
      '<button type="button" class="link" id="esqueci">Esqueci minha senha</button></form>');
    $('#formLogin').addEventListener('submit', async ev => {
      ev.preventDefault();
      const b = $('#formLogin button[type=submit]');
      b.disabled = true;
      const r = await sb.auth.signInWithPassword({ email: $('#loginEmail').value.trim(), password: $('#loginSenha').value });
      b.disabled = false;
      if (r.error) { telaLogin(/invalid/i.test(r.error.message) ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar: ' + r.error.message); return; }
      entrar(r.data.user);
    });
    $('#esqueci').addEventListener('click', async () => {
      const email = $('#loginEmail').value.trim();
      if (!email) { telaLogin('Digite o seu e-mail e clique de novo em "Esqueci minha senha".'); return; }
      const r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      telaLogin(r.error ? 'Não foi possível enviar: ' + r.error.message : null, r.error ? null : 'Se o e-mail estiver cadastrado, chega um link para criar uma senha nova.');
    });
    $('#loginEmail').focus();
  }

  function telaNovaSenha() {
    telaEntrada('<form id="formSenha" class="grade-login"><p>Crie a sua senha nova.</p>' +
      '<label class="campo"><span>Senha nova (mínimo 8 caracteres)</span><input type="password" id="senha1" autocomplete="new-password" minlength="8" required></label>' +
      '<label class="campo"><span>Repita</span><input type="password" id="senha2" autocomplete="new-password" required></label>' +
      '<p class="erro-form" hidden></p><button type="submit" class="btn largo">Salvar senha</button></form>');
    $('#formSenha').addEventListener('submit', async ev => {
      ev.preventDefault();
      const s1 = $('#senha1').value, s2 = $('#senha2').value;
      const erro = $('#formSenha .erro-form');
      if (s1.length < 8 || s1 !== s2) { erro.textContent = s1 !== s2 ? 'As senhas não conferem.' : 'Use pelo menos 8 caracteres.'; erro.hidden = false; return; }
      const r = await sb.auth.updateUser({ password: s1 });
      if (r.error) { erro.textContent = r.error.message; erro.hidden = false; return; }
      history.replaceState(null, '', location.pathname);
      entrar(r.data.user);
    });
  }

  function formMinhaSenha() {
    CRM.abrirForm({
      titulo: 'Alterar minha senha',
      campos: [{ nome: 's1', rotulo: 'Senha nova (mínimo 8)', obrigatorio: true, largo: true }, { nome: 's2', rotulo: 'Repita', obrigatorio: true, largo: true }],
      extras: f => { f.elements.s1.type = 'password'; f.elements.s2.type = 'password'; },
      aoSalvar: async v => {
        if (v.s1.length < 8) throw new Error('use pelo menos 8 caracteres');
        if (v.s1 !== v.s2) throw new Error('as senhas não conferem');
        const r = await sb.auth.updateUser({ password: v.s1 });
        if (r.error) throw new Error(r.error.message);
        CRM.toast('Senha alterada.');
      }
    });
  }

  async function entrar(usuario) {
    let eu = null;
    try { eu = await store.usuarioAtual(usuario.id); } catch (e) { console.error(e); }
    if (!eu) {
      await sb.auth.signOut();
      telaLogin('Este usuário existe, mas não está liberado no CRM (ou foi desativado). Fale com o administrador.');
      return;
    }
    E.eu = eu;
    await abrirApp();
  }

  async function abrirApp() {
    $('#tela').innerHTML = '';
    $('#app').hidden = false;
    $('#faixaModo').hidden = store.modo !== 'local';
    await CRM.recarregar();
    const atual = E.ix.porId.usuarios.get(E.eu.user_id);
    if (atual) E.eu = atual;
    document.title = nomeInstalacao() + ' · CRM';
    CRM.render();
    const al = R.alertas(E.D, E.ix, E.cfg, CRM.hoje(), CRM.meuId());
    if (al.atrasadas.length) CRM.toast('Você tem ' + al.atrasadas.length + ' tarefa(s) atrasada(s).');
  }

  function carregarScript(s) {
    return new Promise((ok, erro) => {
      const el = document.createElement('script');
      el.src = s.src; el.integrity = s.integrity; el.crossOrigin = 'anonymous';
      el.onload = ok; el.onerror = () => erro(new Error('falha ao carregar ' + s.src));
      document.head.appendChild(el);
    });
  }

  // Paleta da instalação (config.js → cores: { principal, destaque }). Os tons intermediários saem
  // da mistura com branco/preto; o texto sobre o destaque fica preto ou branco conforme o contraste.
  function aplicaCores(c) {
    if (!c) return;
    const hex = h => /^#[0-9a-f]{6}$/i.test(h || '') ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : null;
    const mistura = (rgb, alvo, t) => '#' + rgb.map((v, i) => Math.round(v + (alvo[i] - v) * t).toString(16).padStart(2, '0')).join('');
    const luz = rgb => (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    const raiz = document.documentElement.style;
    const p = hex(c.principal), d = hex(c.destaque);
    if (p) {
      raiz.setProperty('--marinho', c.principal);
      raiz.setProperty('--marinho-2', mistura(p, [255, 255, 255], 0.12));
      raiz.setProperty('--marinho-3', mistura(p, [255, 255, 255], 0.25));
    }
    if (d) {
      raiz.setProperty('--ouro', c.destaque);
      raiz.setProperty('--ouro-escuro', mistura(d, [0, 0, 0], 0.15));
      raiz.setProperty('--sobre-ouro', luz(d) > 0.6 ? '#1a1a1a' : '#ffffff');
    }
    // Cores do documento da proposta (cores.documento: { destaque, escuro }).
    const doc = c.documento || {};
    if (hex(doc.destaque)) raiz.setProperty('--doc-destaque', doc.destaque);
    if (hex(doc.escuro)) raiz.setProperty('--doc-escuro', doc.escuro);
    const v = hex(doc.verde);
    if (v) {
      raiz.setProperty('--doc-verde', doc.verde);
      raiz.setProperty('--doc-verde-esc', mistura(v, [0, 0, 0], 0.45)); // números dos itens: verde que se lê no branco
      raiz.setProperty('--doc-verde-claro', mistura(v, [255, 255, 255], 0.88));
    }
    // Degradê da marca (cores.gradiente: [de, até]) — faixas da proposta; o tom escuro do "até"
    // segura o texto branco no cabeçalho da tabela.
    const g = Array.isArray(c.gradiente) ? c.gradiente.map(hex) : [];
    if (g[0] && g[1]) {
      raiz.setProperty('--grad-a', c.gradiente[0]);
      raiz.setProperty('--grad-b', c.gradiente[1]);
      raiz.setProperty('--grad-esc', mistura(g[1], [0, 0, 0], 0.15));
      raiz.setProperty('--grad-claro', mistura(g[0], [255, 255, 255], 0.92));
    }
  }

  async function iniciar() {
    ligarEventos();
    const cfg = window.CRM_CONFIG || {};
    aplicaCores(cfg.cores);
    $('#logoTopo').src = logoIcone();
    // Logo completo no alto do menu, num cartão branco (config.js → logoNoMenu: 'completo').
    if (cfg.logoNoMenu === 'completo' && cfg.logo) {
      $('#logoMenu').src = logo(); $('#logoMenu').alt = nomeInstalacao(); $('#logoMenu').hidden = false;
      document.querySelector('.marca').classList.add('completa');
    }
    const icone = document.querySelector('link[rel=icon]'); if (icone) icone.href = logoIcone();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      store = new DD.Local();
      await store.carregar();
      E.eu = await store.usuarioAtual();
      await abrirApp();
      return;
    }
    try { await carregarScript(SUPABASE_JS); } catch (e) {
      telaAviso('Sem conexão', 'Não foi possível carregar a biblioteca do banco. Confira a internet e recarregue a página.');
      return;
    }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    store = new DD.Supa(sb);
    let recuperando = /type=recovery/.test(location.hash);
    sb.auth.onAuthStateChange(ev => {
      if (ev === 'PASSWORD_RECOVERY') { recuperando = true; telaNovaSenha(); }
      if (ev === 'SIGNED_OUT') { E.eu = null; telaLogin(); }
    });
    const s = await sb.auth.getSession();
    if (recuperando && s.data && s.data.session) { telaNovaSenha(); return; }
    if (s.data && s.data.session) await entrar(s.data.session.user);
    else telaLogin();
  }

  CRM.sb = () => sb;
  document.addEventListener('DOMContentLoaded', () => {
    iniciar().catch(e => { console.error(e); telaAviso('Algo deu errado', String(e && e.message || e)); });
  });
})();
