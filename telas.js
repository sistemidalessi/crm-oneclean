/* CRM Sistemi Dalessi — telas principais (Início, Funil, Empresas, Pessoas,
   Negócios, Atividades, Relatórios). Cada tela: render(alertas) -> HTML; depois(el). */
(function () {
  'use strict';
  const R = window.CRMRegras, CRM = window.CRM;
  const { $, $$, esc } = CRM;
  const E = () => CRM.estado;
  const F = tela => (E().filtros[tela] = E().filtros[tela] || {});
  const LIMITE = 100;

  function vazio(txt) { return '<p class="vazio">' + esc(txt) + '</p>'; }
  function linkEmpresa(id) { return '<button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(id) + '">' + esc(CRM.nomeEmpresa(id)) + '</button>'; }
  function contatoPrincipal(empresaId) {
    const l = CRM.doEmpresa('contatos', empresaId);
    return l.find(c => c.principal) || l[0] || null;
  }
  function telefoneDe(e, c) { return (c && (c.whatsapp || c.celular || c.telefone)) || e.whatsapp || e.telefone || ''; }

  // Botões de contato rápido (WhatsApp / ligar) de uma empresa.
  function acoesRapidas(empresaId, contatoId) {
    const e = CRM.empresa(empresaId); if (!e) return '';
    const c = contatoId ? CRM.contato(contatoId) : contatoPrincipal(empresaId);
    const tel = telefoneDe(e, c);
    return '<span class="acoes-rapidas">' +
      (R.linkWhatsApp(tel) ? '<button type="button" class="mini wa" data-acao="whatsapp" data-id="' + esc(empresaId) + '"' + CRM.attr('data-contato', c && c.id) + ' title="WhatsApp">WhatsApp</button>' : '') +
      (R.linkTelefone(tel) ? '<button type="button" class="mini" data-acao="ligar" data-id="' + esc(empresaId) + '"' + CRM.attr('data-contato', c && c.id) + ' title="Ligar">Ligar</button>' : '') +
      ((c && c.email) || e.email ? '<button type="button" class="mini" data-acao="email" data-id="' + esc(empresaId) + '"' + CRM.attr('data-contato', c && c.email ? c.id : null) +
        CRM.attr('data-para', (c && c.email) || e.email) + ' title="' + esc((c && c.email) || e.email) + '">E-mail</button>' : '') +
      '</span>';
  }
  CRM.acoesRapidas = acoesRapidas;

  function itemTarefa(a, opts) {
    const sit = R.situacaoTarefa(a, CRM.hoje());
    const neg = a.negocio_id && CRM.negocio(a.negocio_id);
    return '<li class="tarefa ' + sit + '">' +
      '<input type="checkbox" data-acao="concluir" data-id="' + esc(a.id) + '"' + (a.concluida ? ' checked' : '') + ' aria-label="Concluída">' +
      '<span class="hora">' + (sit === 'atrasada' ? esc(R.dataBR(a.data_hora).slice(0, 5)) : esc(R.horaLocal(a.data_hora))) + '</span>' +
      CRM.iconeTipo(a.tipo) +
      '<button type="button" class="linha" data-acao="editar-tarefa" data-id="' + esc(a.id) + '">' +
      '<strong>' + esc(a.descricao) + '</strong>' +
      '<small>' + esc(CRM.nomeEmpresa(a.empresa_id)) + (neg ? ' · ' + esc(neg.titulo) : '') +
      ((opts && opts.resp) || CRM.ehGestor() && !CRM.carteira() ? ' · ' + esc(CRM.nomeUsuario(a.responsavel_id)) : '') +
      (a.recorrencia ? ' · ↻ ' + esc(R.rotulo(R.RECORRENCIAS, a.recorrencia)) : '') +
      (sit === 'atrasada' ? ' ' + CRM.selo('atrasada', 'vermelho') : '') + '</small></button>' +
      acoesRapidas(a.empresa_id, a.contato_id) + '</li>';
  }
  CRM.itemTarefa = itemTarefa;

  function listaEmpresasCurta(lista, info) {
    if (!lista.length) return vazio('Nada aqui. 👍');
    return '<ul class="lista">' + lista.slice(0, 8).map(e => '<li><button type="button" class="linha" data-acao="abrir-empresa" data-id="' + esc(e.id) + '">' +
      '<strong>' + esc(e.nome) + '</strong><small>' + info(e) + '</small></button>' + acoesRapidas(e.id) + '</li>').join('') + '</ul>' +
      (lista.length > 8 ? '<p class="mais">e mais ' + (lista.length - 8) + '…</p>' : '');
  }

  // ================================================================ Início
  const inicio = {
    render(al) {
      const hoje = CRM.hoje();
      const eu = E().eu;
      const h = new Date().getHours();
      const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
      const cart = CRM.carteira();
      const agenda = al.atrasadas.concat(al.deHoje).sort((a, b) => (a.data_hora < b.data_hora ? -1 : 1));
      const proximas = E().D.atividades.filter(a => !a.concluida && (!cart || a.responsavel_id === cart) && R.diaLocal(a.data_hora) > hoje && R.diaLocal(a.data_hora) <= R.somaDias(hoje, 3))
        .sort((a, b) => (a.data_hora < b.data_hora ? -1 : 1)).slice(0, 6);

      // meta do mês (da carteira escolhida)
      const mes = hoje.slice(0, 8) + '01';
      const metas = (E().D.metas || []).filter(m => m.mes === mes && (!cart || m.usuario_id === cart));
      const meta = metas.reduce((s, m) => s + R.num(m.valor), 0);
      const vendido = E().D.negocios.filter(n => n.status === 'ganho' && n.fechado_em && n.fechado_em.slice(0, 7) === hoje.slice(0, 7) && (!cart || n.responsavel_id === cart))
        .reduce((s, n) => s + R.num(n.valor), 0);

      const cards = [
        ['Atrasadas', al.atrasadas.length, 'vermelho', 'tarefas-atrasadas'],
        ['Para hoje', al.deHoje.length, 'azul', 'tarefas-hoje'],
        ['Leads sem atendimento', al.leadsSemAtendimento.length, 'roxo', 'leads-sem-atendimento'],
        ['Negócios parados', al.negociosParados.length, 'ambar', 'negocios-parados'],
        ['Clientes sem contato', al.clientesSemContato.length, 'ambar', 'clientes-sem-contato'],
        ['Recompra', al.recompra.length, 'verde', 'recompra']
      ];
      return '<div class="cabecalho"><div><h1>' + esc(saud) + ', ' + esc(R.primeiroNome(eu.nome)) + '</h1>' +
        '<p class="sub">' + esc(new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })) +
        (cart && CRM.ehGestor() ? ' · carteira de ' + esc(CRM.nomeUsuario(cart)) : CRM.ehGestor() ? ' · equipe toda' : '') + '</p></div>' +
        '</div>' +
        '<section class="kpis contadores">' + cards.map(c => '<button type="button" class="kpi ' + c[2] + (c[1] ? '' : ' zerado') + '" data-acao="ir-alerta" data-id="' + c[3] + '">' +
          '<strong>' + c[1] + '</strong><span>' + esc(c[0]) + '</span></button>').join('') + '</section>' +
        '<div class="colunas-inicio">' +
        '<section class="cartao"><h2>O que fazer hoje <small>' + agenda.length + '</small></h2>' +
          (agenda.length ? '<ul class="lista tarefas">' + agenda.map(a => itemTarefa(a)).join('') + '</ul>' : vazio('Nada atrasado nem para hoje.')) +
          (proximas.length ? '<h3>Próximos 3 dias</h3><ul class="lista tarefas">' + proximas.map(a => itemTarefa(a)).join('') + '</ul>' : '') +
          '<p class="acoes"><button type="button" class="btn sec" data-acao="nova-tarefa">+ Tarefa</button> <button type="button" class="btn sec" data-acao="novo-registro">Registrar atividade</button></p>' +
        '</section>' +
        '<div class="pilha">' +
          (meta ? '<section class="cartao"><h2>Meta do mês</h2><div class="meta">' + CRM.barra(vendido, meta) +
            '<p><strong>' + esc(R.moeda(vendido)) + '</strong> de ' + esc(R.moeda(meta)) + ' · ' + esc(R.pct(vendido / meta * 100)) + '</p></div></section>' : '') +
          '<section class="cartao" id="alerta-leads-sem-atendimento"><h2>Leads sem atendimento <small>nenhum contato registrado</small></h2>' +
            listaEmpresasCurta(al.leadsSemAtendimento, e => esc(CRM.nomeUsuario(e.responsavel_id)) + ' · chegou ' + esc(R.dataBR(e.criado_em)) + (e.origem ? ' · ' + esc(e.origem) : '')) + '</section>' +
          '<section class="cartao" id="alerta-negocios-parados"><h2>Negócios parados <small>sem movimento há ' + E().cfg.dias_parado +
            (R.num(E().cfg.dias_esquecido) > 0 ? ' a ' + Math.max(R.num(E().cfg.dias_esquecido), E().cfg.dias_parado) : '+') + ' dias e sem tarefa</small></h2>' +
            (al.negociosParados.length ? '<ul class="lista">' + al.negociosParados.slice(0, 8).map(n => '<li><button type="button" class="linha" data-acao="abrir-negocio" data-id="' + esc(n.id) + '">' +
              '<strong>' + esc(n.titulo) + '</strong><small>' + esc(CRM.nomeEmpresa(n.empresa_id)) + ' · ' + esc(R.moeda(n.valor)) + ' · ' +
              esc((CRM.etapa(n.etapa_id) || {}).nome || '') + ' há ' + R.diasEntre(R.diaLocal(n.etapa_desde || n.criado_em), hoje) + ' dias</small></button>' + acoesRapidas(n.empresa_id) + '</li>').join('') + '</ul>' : vazio('Todos os negócios abertos estão andando.')) +
          '</section>' + esquecidos(al.negociosEsquecidos, hoje) +
          '<section class="cartao" id="alerta-recompra"><h2>Hora da recompra <small>pelo ritmo de compra de cada cliente</small></h2>' + listaRecompra(al.recompra, hoje) + '</section>' +
          '<section class="cartao" id="alerta-clientes-sem-contato"><h2>Clientes sem contato <small>há ' + E().cfg.dias_sem_contato + '+ dias</small></h2>' +
            listaEmpresasCurta(al.clientesSemContato, e => { const r = CRM.resumo(e.id); const u = r.ultimoContato || r.ultimaCompra; return u ? 'último contato ' + esc(R.dataBR(u)) : 'nenhum contato registrado'; }) + '</section>' +
        '</div></div>';
    }
  };

  // Hora da recompra: ritmo do cliente, quando vence, o que costuma levar e o botão com a
  // mensagem pronta (os mais atrasados primeiro).
  function listaRecompra(lista, hoje) {
    if (!lista.length) return vazio('Nenhum cliente na hora de repor. 👍');
    return '<ul class="lista recompra">' + lista.slice(0, 10).map(e => {
      const r = CRM.resumo(e.id), ciclo = R.cicloRecompra(e, r, E().cfg);
      const falta = R.diasEntre(hoje, R.somaDias(r.ultimaCompra, ciclo));
      const quando = falta > 0 ? 'vence em ' + falta + ' dia(s)' : falta === 0 ? 'vence hoje' : 'passou ' + (-falta) + ' dia(s)';
      const itens = R.itensHabituais(E().ix, e.id, 3);
      return '<li><button type="button" class="linha" data-acao="abrir-empresa" data-id="' + esc(e.id) + '"><strong>' + esc(e.nome) + '</strong>' +
        '<small>' + (r.ritmo && !R.num(e.ciclo_recompra_dias) ? 'compra a cada ~' + ciclo + ' dias' : 'ciclo de ' + ciclo + ' dias') + ' · última ' + esc(R.dataBR(r.ultimaCompra)) + ' · ' +
        (falta < 0 ? CRM.selo(quando, 'ambar') : esc(quando)) + (CRM.carteira() ? '' : ' · ' + esc(R.primeiroNome(CRM.nomeUsuario(e.responsavel_id)))) +
        (itens.length ? '<br>costuma levar: ' + esc(itens.map(it => R.nomeDeItem(it.descricao)).join(', ')) : '') + '</small></button>' +
        '<span class="acoes-rapidas"><button type="button" class="mini wa" data-acao="whatsapp-recompra" data-id="' + esc(e.id) + '" title="Abre o WhatsApp com a mensagem de recompra e agenda o retorno em 2 dias">Recompra</button></span>' +
        acoesRapidas(e.id) + '</li>';
    }).join('') + '</ul>' + (lista.length > 10 ? '<p class="mais">e mais ' + (lista.length - 10) + '…</p>' : '');
  }

  // Negócios esquecidos (parados há mais de "dias_esquecido"): não entram no sino; ficam aqui,
  // fechados, para a limpeza — abrir um a um ou encerrar todos como perdidos de uma vez.
  function esquecidos(lista, hoje) {
    if (!lista.length) return '';
    const dias = Math.max(R.num(E().cfg.dias_esquecido), E().cfg.dias_parado);
    const motivos = E().D.opcoes.filter(o => o.tipo === 'motivo_perda').map(o => o.nome);
    const padrao = motivos.find(m => /retorno/i.test(m)) || motivos[0] || '';
    const total = lista.reduce((s, n) => s + R.num(n.valor), 0);
    return '<section class="cartao" id="alerta-negocios-esquecidos"><details><summary><h2>Negócios esquecidos <small>' + lista.length + ' · ' + esc(R.moeda(total)) +
      ' · parados há mais de ' + dias + ' dias — fora dos avisos</small></h2></summary>' +
      '<p class="dica">Ninguém mexeu neles (nem etapa, nem contato) há mais de ' + dias + ' dias. Abra os que ainda valem a pena e crie uma tarefa; o resto pode ser encerrado de uma vez como perdido, com a data do último movimento.</p>' +
      '<ul class="lista">' + lista.slice().sort((a, b) => R.num(b.valor) - R.num(a.valor)).slice(0, 15).map(n => '<li><button type="button" class="linha" data-acao="abrir-negocio" data-id="' + esc(n.id) + '">' +
        '<strong>' + esc(n.titulo) + '</strong><small>' + esc(CRM.nomeEmpresa(n.empresa_id)) + ' · ' + esc(R.moeda(n.valor)) + ' · ' + esc(CRM.nomeUsuario(n.responsavel_id)) +
        ' · parado desde ' + esc(R.dataBR(R.ultimoMovimento(n, E().ix))) + '</small></button></li>').join('') + '</ul>' +
      (lista.length > 15 ? '<p class="dica">Mostrando os 15 de maior valor.</p>' : '') +
      '<p class="acoes">Motivo: <select id="motivoEsquecidos">' + CRM.opcoesHTML(motivos.map(m => [m, m]), padrao) + '</select> ' +
      '<button type="button" class="btn sec" data-acao="encerrar-esquecidos">Encerrar os ' + lista.length + ' como perdidos</button></p></details></section>';
  }

  // ================================================================ Fila do dia
  // Um cliente por vez, na ordem do que pesa mais: tarefas atrasadas, de hoje, recompra, lead
  // novo, cliente sem contato, negócio parado. O que foi resolvido sai sozinho (tarefa concluída,
  // contato registrado, retorno agendado); "Pular" só vale até recarregar a página.
  const pulados = new Set();
  let maiorFila = { dia: '', total: 0 }; // tamanho da fila no começo do dia (nesta página), para o progresso
  function montaFila(al, hoje) {
    const itens = [], porEmpresa = new Map();
    const poe = (chave, empresaId, tipo, motivo, extra) => {
      if (!empresaId || !CRM.empresa(empresaId)) return;
      const ja = porEmpresa.get(empresaId);
      if (ja) { ja.outros.push(motivo); return; }
      const it = Object.assign({ chave, empresaId, tipo, motivo, outros: [] }, extra || {});
      porEmpresa.set(empresaId, it); itens.push(it);
    };
    const porHora = (a, b) => (a.data_hora < b.data_hora ? -1 : 1);
    al.atrasadas.slice().sort(porHora).forEach(a => poe('t:' + a.id, a.empresa_id, 'tarefa', 'Tarefa atrasada desde ' + R.dataBR(a.data_hora).slice(0, 5) + ': ' + a.descricao, { atividade: a }));
    al.deHoje.slice().sort(porHora).forEach(a => poe('t:' + a.id, a.empresa_id, 'tarefa', 'Tarefa de hoje às ' + R.horaLocal(a.data_hora) + ': ' + a.descricao, { atividade: a }));
    al.recompra.forEach(e => poe('r:' + e.id, e.id, 'recompra', 'Hora da recompra'));
    al.leadsSemAtendimento.slice().sort((a, b) => (a.criado_em < b.criado_em ? -1 : 1)).forEach(e => poe('l:' + e.id, e.id, 'lead', 'Lead novo sem atendimento (chegou ' + R.dataBR(e.criado_em) + ')'));
    al.clientesSemContato.forEach(e => { const r = CRM.resumo(e.id), u = r.ultimoContato || r.ultimaCompra;
      poe('c:' + e.id, e.id, 'contato', u ? 'Cliente sem contato há ' + R.diasEntre(R.diaLocal(u), hoje) + ' dias' : 'Cliente sem nenhum contato registrado'); });
    al.negociosParados.forEach(n => poe('n:' + n.id, n.empresa_id, 'parado', 'Negócio parado há ' + R.diasEntre(R.ultimoMovimento(n, E().ix), hoje) + ' dias: ' + n.titulo + ' (' + R.moeda(n.valor) + ')', { negocio: n }));
    return itens;
  }
  const ROTULO_FILA = { tarefa: ['Tarefa', 'azul'], recompra: ['Recompra', 'verde'], lead: ['Lead novo', 'roxo'], contato: ['Sem contato', 'ambar'], parado: ['Negócio parado', 'ambar'] };

  function contextoFila(it) {
    const e = CRM.empresa(it.empresaId), r = CRM.resumo(e.id), hoje = CRM.hoje();
    const linhas = [];
    const c = contatoPrincipal(e.id);
    if (c) linhas.push('Falar com <strong>' + esc(c.nome) + '</strong>' + (c.cargo ? ' · ' + esc(c.cargo) : ''));
    linhas.push(r.ultimoContato ? 'Último contato ' + esc(R.dataBR(r.ultimoContato)) + ' (' + R.diasEntre(R.diaLocal(r.ultimoContato), hoje) + ' dias)' : 'Nenhum contato registrado ainda');
    if (r.compras) linhas.push(esc(R.moeda(r.totalComprado)) + ' em ' + r.compras + ' compra(s) · última ' + esc(R.dataBR(r.ultimaCompra)) +
      (r.ritmo ? ' · compra a cada ~' + R.cicloRecompra(e, r, E().cfg) + ' dias' : ''));
    const itens = R.itensHabituais(E().ix, e.id, 4);
    if (itens.length) linhas.push('Costuma levar: ' + esc(itens.map(x => R.nomeDeItem(x.descricao)).join(', ')));
    const ult = E().D.atividades.filter(a => a.empresa_id === e.id && a.concluida && a.tipo !== 'sistema').sort((a, b) => ((a.concluida_em || a.data_hora) < (b.concluida_em || b.data_hora) ? 1 : -1))[0];
    if (ult) linhas.push('Última anotação: <em>' + esc(String(ult.descricao).slice(0, 160)) + '</em>');
    return linhas.map(l => '<li>' + l + '</li>').join('');
  }

  const fila = {
    render(al) {
      const hoje = CRM.hoje();
      const itens = montaFila(al, hoje);
      const resta = itens.filter(it => !pulados.has(it.chave));
      const eu = CRM.meuId();
      const feitosHoje = E().D.atividades.filter(a => a.concluida && a.tipo !== 'sistema' && a.responsavel_id === eu && R.diaLocal(a.concluida_em || a.data_hora) === hoje).length;
      const cab = '<div class="cabecalho"><div><h1>Fila do dia</h1><p class="sub">' + (CRM.carteira() && CRM.ehGestor() ? 'carteira de ' + esc(CRM.nomeUsuario(CRM.carteira())) + ' · ' : CRM.ehGestor() && !CRM.carteira() ? 'equipe toda · ' : '') +
        resta.length + ' para fazer' + (pulados.size ? ' · ' + pulados.size + ' pulado(s)' : '') + ' · você já registrou <strong>' + feitosHoje + '</strong> contato(s) hoje</p></div>' +
        (pulados.size ? '<button type="button" class="btn sec" data-acao="fila-voltar-pulados">Voltar os pulados</button>' : '') + '</div>';
      if (!resta.length) return cab + '<section class="cartao fila-vazia"><h2>Fila zerada 🎉</h2><p>Nada atrasado, nenhuma recompra, lead ou cliente esperando. Bom momento para prospectar: veja os leads antigos em Empresas.</p></section>';
      const it = resta[0], e = CRM.empresa(it.empresaId), rot = ROTULO_FILA[it.tipo];
      if (maiorFila.dia !== hoje || itens.length > maiorFila.total) maiorFila = { dia: hoje, total: Math.max(itens.length, maiorFila.dia === hoje ? maiorFila.total : 0) };
      const total = maiorFila.total, resolvidos = total - itens.length;
      const botoes = [];
      if (it.tipo === 'recompra') botoes.push('<button type="button" class="btn ouro" data-acao="whatsapp-recompra" data-id="' + esc(e.id) + '">WhatsApp de recompra</button>');
      if (it.tipo === 'tarefa') botoes.push('<button type="button" class="btn ouro" data-acao="fila-concluir" data-id="' + esc(it.atividade.id) + '">✓ Concluir a tarefa</button>',
        '<button type="button" class="btn sec" data-acao="fila-adiar" data-id="' + esc(it.atividade.id) + '">Adiar para amanhã</button>');
      else botoes.push('<button type="button" class="btn' + (it.tipo === 'recompra' ? ' sec' : ' ouro') + '" data-acao="fila-registrar" data-id="' + esc(e.id) + '">Registrar contato</button>',
        '<button type="button" class="btn sec" data-acao="fila-agendar" data-id="' + esc(e.id) + '">Agendar tarefa</button>');
      return cab +
        '<div class="fila-progresso">' + CRM.barra(resolvidos, total, resolvidos + ' de ' + total + ' resolvidos desde que você abriu a fila') + '</div>' +
        '<section class="cartao fila-atual">' +
          '<p class="fila-tipo">' + CRM.selo(rot[0], rot[1]) + ' <span>' + esc(it.motivo) + '</span></p>' +
          (it.outros.length ? '<p class="fila-outros">Também: ' + esc(it.outros.join(' · ')) + '</p>' : '') +
          '<h2><button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(e.id) + '">' + esc(e.nome) + '</button> <small>' + esc(R.rotulo(R.SITUACOES || [], e.situacao) || e.situacao) + ' · ' + esc(CRM.nomeUsuario(e.responsavel_id)) + '</small></h2>' +
          '<ul class="fila-contexto">' + contextoFila(it) + '</ul>' +
          '<div class="fila-contatar"><span>Contatar:</span>' + acoesRapidas(e.id, it.atividade && it.atividade.contato_id) + '</div>' +
          '<div class="fila-botoes">' + botoes.join('') + '<span class="flex"></span><button type="button" class="btn sec" data-acao="fila-pular" data-id="' + esc(it.chave) + '">Pular →</button></div>' +
        '</section>' +
        (resta.length > 1 ? '<section class="cartao"><h2>Depois vêm <small>' + (resta.length - 1) + '</small></h2><ul class="lista">' + resta.slice(1, 8).map(x => '<li><button type="button" class="linha" data-acao="abrir-empresa" data-id="' + esc(x.empresaId) + '"><strong>' +
          esc(CRM.nomeEmpresa(x.empresaId)) + '</strong><small>' + CRM.selo(ROTULO_FILA[x.tipo][0], ROTULO_FILA[x.tipo][1]) + ' ' + esc(x.motivo) + '</small></button></li>').join('') + '</ul>' +
          (resta.length > 8 ? '<p class="mais">e mais ' + (resta.length - 8) + '…</p>' : '') + '</section>' : '');
    }
  };

  // ================================================================ Funil
  const funil = {
    render() {
      const f = F('funil');
      const funis = CRM.funis();
      if (!f.funil || funis.indexOf(f.funil) === -1) f.funil = funis[0] || 'Vendas';
      const etapas = CRM.etapas(f.funil);
      const idsEtapas = new Set(etapas.map(e => e.id));
      const cart = CRM.carteira();
      const hoje = CRM.hoje();
      const ops = E().D.negocios.filter(n => n.status === 'aberto' && (idsEtapas.has(n.etapa_id) || (!n.etapa_id && etapas[0])) &&
        (!cart || n.responsavel_id === cart) && (!f.origem || n.origem === f.origem || (CRM.empresa(n.empresa_id) || {}).origem === f.origem) &&
        (!f.busca || R.casaBusca(f.busca, [n.titulo, CRM.nomeEmpresa(n.empresa_id)])) &&
        (!f.semTarefa || !CRM.doNegocio('atividades', n.id).some(a => !a.concluida) && !(CRM.resumo(n.empresa_id).proxima)));
      const total = ops.reduce((s, n) => s + R.num(n.valor), 0);
      const pond = ops.reduce((s, n) => s + R.num(n.valor) * R.probabilidade(n, CRM.etapa(n.etapa_id)) / 100, 0);
      return '<div class="cabecalho"><h1>Funil</h1>' +
        (funis.length > 1 ? '<div class="abas-funil" role="tablist" aria-label="Funil">' + funis.map(x => '<button type="button" role="tab" data-funil="' + esc(x) + '" aria-selected="' + (x === f.funil) + '"' +
          (x === f.funil ? ' class="ativo"' : '') + '>' + esc(x) + '</button>').join('') + '</div>' : '') +
        '<input type="search" id="fBuscaFunil" placeholder="Filtrar negócio ou empresa…" value="' + esc(f.busca || '') + '">' +
        '<select id="fOrigemFunil" aria-label="Origem">' + CRM.opcoesHTML(CRM.lista(CRM.opcoes('origem'), 'Todas as origens'), f.origem || '') + '</select>' +
        '<label class="check"><input type="checkbox" id="fSemTarefa"' + (f.semTarefa ? ' checked' : '') + '> só sem próximo passo</label>' +
        '<span class="flex"></span><span class="total">' + ops.length + ' negócios · <strong>' + esc(R.moeda(total)) + '</strong> · ponderado ' + esc(R.moeda(pond)) + '</span>' +
        '<button type="button" class="btn ouro" data-acao="novo-negocio">+ Negócio</button></div>' +
        '<div class="funil">' + etapas.map((et, i) => {
          const l = ops.filter(n => n.etapa_id === et.id || (!n.etapa_id && i === 0)).sort((a, b) => (a.previsao_fechamento || '9') < (b.previsao_fechamento || '9') ? -1 : 1);
          const soma = l.reduce((s, n) => s + R.num(n.valor), 0);
          return '<section class="coluna" data-etapa="' + esc(et.id) + '"><header><strong>' + esc(et.nome) + '</strong>' +
            '<span>' + l.length + ' · ' + esc(R.moeda(soma)) + ' · ' + et.probabilidade + '%</span></header>' +
            '<div class="cards">' + l.slice(0, 150).map(n => cartao(n, hoje)).join('') + (l.length > 150 ? '<p class="mais">+' + (l.length - 150) + ' (use o filtro)</p>' : '') + '</div></section>';
        }).join('') + '</div>' +
        '<div class="zonas-fim"><div class="zona ganho" data-status="ganho">🏆 Solte aqui: GANHOU</div><div class="zona perdido" data-status="perdido">Solte aqui: PERDEU</div></div>';
    },
    depois() {
      const f = F('funil');
      const liga = (id, k, tipo) => { const el = $('#' + id); if (el) el.addEventListener(tipo || 'change', () => { f[k] = el.type === 'checkbox' ? el.checked : el.value; CRM.render(); }); };
      document.querySelectorAll('.abas-funil [data-funil]').forEach(b => b.addEventListener('click', () => { f.funil = b.dataset.funil; CRM.render(); }));
      liga('fOrigemFunil', 'origem'); liga('fSemTarefa', 'semTarefa'); liga('fBuscaFunil', 'busca', 'input');
    }
  };

  function cartao(n, hoje) {
    const dias = R.diasEntre(R.diaLocal(n.etapa_desde || n.criado_em), hoje);
    const parado = dias > E().cfg.dias_parado;
    const temTarefa = CRM.doNegocio('atividades', n.id).some(a => !a.concluida) || !!CRM.resumo(n.empresa_id).proxima;
    const atrasado = n.previsao_fechamento && n.previsao_fechamento < hoje;
    return '<article class="card" draggable="true" data-acao="abrir-negocio" data-id="' + esc(n.id) + '" tabindex="0" role="button">' +
      '<div class="card-topo"><strong>' + esc(n.titulo) + '</strong>' + CRM.avatar(CRM.usuario(n.responsavel_id)) + '</div>' +
      '<span class="empresa">' + esc(CRM.nomeEmpresa(n.empresa_id)) + '</span>' +
      '<span class="valores">' + esc(R.moeda(n.valor)) + '</span>' +
      '<span class="card-rodape">' +
      (n.previsao_fechamento ? '<small class="' + (atrasado ? 'atrasado' : '') + '">prev. ' + esc(R.dataBR(n.previsao_fechamento).slice(0, 5)) + '</small>' : '') +
      (parado ? CRM.selo(dias + 'd parado', 'ambar') : '<small>' + dias + 'd na etapa</small>') +
      (temTarefa ? '' : CRM.selo('sem próximo passo', 'vermelho', 'Nenhuma tarefa agendada')) + '</span></article>';
  }

  // ================================================================ listas genéricas
  // Cada lista tem: filtros (E.filtros[tela]), ordenação, limite ("mostrar mais"), seleção p/ ações em massa.
  const selecao = { empresas: new Set(), negocios: new Set(), pessoas: new Set() };
  CRM.selecao = selecao;

  function filtrosSalvos(tela) {
    const meus = (E().D.filtros || []).filter(x => x.tela === tela && x.usuario_id === CRM.meuId());
    return '<select id="fSalvos" aria-label="Filtros salvos"><option value="">★ Filtros salvos</option>' +
      meus.map(x => '<option value="' + esc(x.id) + '">' + esc(x.nome) + '</option>').join('') +
      '<option value="__salvar">+ Salvar o filtro atual…</option>' + (meus.length ? '<option value="__apagar">Apagar um filtro salvo…</option>' : '') + '</select>';
  }

  function ligaFiltrosSalvos(tela) {
    const el = $('#fSalvos'); if (!el) return;
    el.addEventListener('change', () => {
      const v = el.value;
      const f = F(tela);
      if (v === '__salvar') {
        CRM.abrirForm({ titulo: 'Salvar filtro', campos: [{ nome: 'nome', rotulo: 'Nome do filtro', obrigatorio: true, largo: true, dica: 'ex.: Condomínios de Campinas sem contato' }],
          aoSalvar: async x => { const copia = Object.assign({}, f); delete copia.limite; await CRM.inserir('filtros', { usuario_id: CRM.meuId(), tela, nome: x.nome, filtros: copia }); CRM.toast('Filtro salvo.'); } });
      } else if (v === '__apagar') {
        const meus = E().D.filtros.filter(x => x.tela === tela && x.usuario_id === CRM.meuId());
        CRM.abrirForm({ titulo: 'Apagar filtro salvo', campos: [{ nome: 'id', rotulo: 'Filtro', tipo: 'select', opcoes: meus.map(x => [x.id, x.nome]), largo: true }], salvarTexto: 'Apagar',
          aoSalvar: async x => { await CRM.remover('filtros', x.id); CRM.toast('Filtro apagado.'); } });
      } else if (v) {
        const salvo = E().D.filtros.find(x => x.id === v);
        E().filtros[tela] = Object.assign({}, salvo.filtros);
        CRM.render();
        return;
      }
      el.value = '';
    });
  }

  function cabecalhoOrdenavel(tela, col, rotulo, cls) {
    const f = F(tela);
    const ativo = f.ordem === col;
    return '<th class="ordenavel' + (cls ? ' ' + cls : '') + (ativo ? ' ativo' : '') + '" data-acao="ordenar" data-id="' + tela + ':' + col + '">' + esc(rotulo) + (ativo ? (f.desc ? ' ▼' : ' ▲') : '') + '</th>';
  }

  function ordena(lista, f, chaves) {
    const k = chaves[f.ordem] || chaves[Object.keys(chaves)[0]];
    const dir = f.desc ? -1 : 1;
    return lista.map(x => [k(x), x]).sort((a, b) => {
      const va = a[0], vb = b[0];
      if (va == null || va === '') return 1;
      if (vb == null || vb === '') return -1;
      return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR')) * dir;
    }).map(p => p[1]);
  }

  function rodapeLista(tela, total) {
    const lim = F(tela).limite || LIMITE;
    return total > lim ? '<p class="mais"><button type="button" class="btn sec" data-acao="mostrar-mais" data-id="' + tela + '">Mostrar mais (' + (total - lim) + ' restantes)</button></p>' : '';
  }

  function barraSelecao(tela, acoes) {
    const n = selecao[tela].size;
    if (!n) return '';
    return '<div class="barra-selecao"><strong>' + n + ' selecionado(s)</strong>' + acoes.map(a => '<button type="button" class="btn sec" data-acao="massa" data-id="' + tela + ':' + a[0] + '">' + esc(a[1]) + '</button>').join('') +
      '<button type="button" class="link" data-acao="limpar-selecao" data-id="' + tela + '">limpar seleção</button></div>';
  }

  // ================================================================ Empresas
  function empresasFiltradas() {
    const f = F('empresas');
    const cart = CRM.carteira();
    const hoje = CRM.hoje();
    const semContatoDias = R.num(f.semContato);
    const p = f.periodo ? R.periodo(f.periodo, hoje, f.de, f.ate) : null;
    return E().D.empresas.filter(e => {
      if (cart && e.responsavel_id !== cart && !f.todas) return false;
      if (f.responsavel === '__nenhum' ? e.responsavel_id : f.responsavel && e.responsavel_id !== f.responsavel) return false;
      if (f.situacao && CRM.situacao(e) !== f.situacao) return false;
      if (f.segmento && e.segmento !== f.segmento) return false;
      if (f.origem && e.origem !== f.origem) return false;
      if (f.uf && e.uf !== f.uf) return false;
      if (f.cidade && !R.casaBusca(f.cidade, [e.cidade])) return false;
      if (f.tag && (e.tags || []).indexOf(f.tag) === -1) return false;
      if (f.qualificacao && R.num(e.qualificacao) < R.num(f.qualificacao)) return false;
      if (p && !R.noPeriodo(R.diaLocal(e.criado_em), p)) return false;
      const r = CRM.resumo(e.id);
      if (semContatoDias) { const u = r.ultimoContato; if (u && R.diasEntre(R.diaLocal(u), hoje) <= semContatoDias) return false; }
      if (f.semTarefa && r.proxima) return false;
      if (f.busca) {
        const cs = CRM.doEmpresa('contatos', e.id);
        if (!R.casaBusca(f.busca, [e.nome, e.razao_social, e.cnpj, e.telefone, e.whatsapp, e.email, e.cidade, e.bairro].concat(...cs.map(c => [c.nome, c.email, c.telefone, c.celular, c.whatsapp])))) return false;
      }
      return true;
    });
  }

  const COLS_EMPRESA = {
    nome: e => R.normaliza(e.nome), situacao: e => CRM.situacao(e), responsavel: e => CRM.nomeUsuario(e.responsavel_id),
    cidade: e => (e.cidade || '') + (e.uf || ''), ultimo: e => CRM.resumo(e.id).ultimoContato || '', proxima: e => (CRM.resumo(e.id).proxima || {}).data_hora || '',
    comprado: e => CRM.resumo(e.id).totalComprado || 0, criado: e => e.criado_em || ''
  };

  const empresas = {
    render() {
      const f = F('empresas');
      if (!f.ordem) f.ordem = 'nome';
      const lista = ordena(empresasFiltradas(), f, COLS_EMPRESA);
      const lim = f.limite || LIMITE;
      const g = CRM.ehGestor();
      const todosSel = lista.length && lista.slice(0, lim).every(e => selecao.empresas.has(e.id));
      return '<div class="cabecalho"><h1>Empresas <small>' + lista.length + '</small></h1><span class="flex"></span>' + filtrosSalvos('empresas') +
        '<button type="button" class="btn sec" data-acao="exportar-lista" data-id="empresas">Exportar</button>' +
        '<button type="button" class="btn ouro" data-acao="novo-lead">+ Empresa / lead</button></div>' +
        '<div class="filtros">' +
        '<input type="search" id="fBusca" placeholder="Nome, CNPJ, telefone, e-mail, pessoa…" value="' + esc(f.busca || '') + '">' +
        sel('situacao', CRM.lista([], 'Situação').concat(R.SITUACOES), f.situacao) +
        (g ? sel('responsavel', [['', 'Responsável'], ['__nenhum', '(sem responsável)']].concat(CRM.usuariosAtivos().map(u => [u.user_id, u.nome])), f.responsavel) : '') +
        sel('segmento', CRM.lista(CRM.opcoes('segmento'), 'Segmento'), f.segmento) +
        sel('origem', CRM.lista(CRM.opcoes('origem'), 'Origem'), f.origem) +
        sel('tag', CRM.lista(CRM.todasTags(), 'Etiqueta'), f.tag) +
        sel('uf', CRM.lista(R.UFS, 'UF'), f.uf) +
        '<input type="text" id="fCidade" placeholder="Cidade" value="' + esc(f.cidade || '') + '" class="curto">' +
        sel('qualificacao', [['', 'Qualificação'], ['1', '★ ou mais'], ['2', '★★ ou mais'], ['3', '★★★ ou mais'], ['4', '★★★★ ou mais'], ['5', '★★★★★']], f.qualificacao) +
        sel('semContato', [['', 'Último contato'], ['7', 'sem contato há 7+ dias'], ['15', 'há 15+ dias'], ['30', 'há 30+ dias'], ['60', 'há 60+ dias'], ['90', 'há 90+ dias']], f.semContato) +
        sel('periodo', [['', 'Cadastro'], ['hoje', 'hoje'], ['semana', 'esta semana'], ['mes', 'este mês'], ['mes_passado', 'mês passado'], ['trimestre', 'últimos 3 meses'], ['ano', 'este ano']], f.periodo) +
        '<label class="check"><input type="checkbox" id="fSemTarefaEmp"' + (f.semTarefa ? ' checked' : '') + '> sem tarefa</label>' +
        '<button type="button" class="link" data-acao="limpar-filtros" data-id="empresas">limpar</button></div>' +
        barraSelecao('empresas', [['responsavel', 'Trocar responsável'], ['situacao', 'Mudar situação'], ['tag', 'Pôr etiqueta'], ['tirar-tag', 'Tirar etiqueta'], ['tarefa', 'Criar tarefa']]
          .filter(a => g || (a[0] !== 'responsavel')).concat(g ? [['excluir', 'Excluir']] : [])) +
        (lista.length ? '<div class="tabela-rolagem cartao sem-pad"><table class="tabela clicavel"><thead><tr>' +
          '<th class="sel"><input type="checkbox" data-acao="selecionar-todos" data-id="empresas"' + (todosSel ? ' checked' : '') + ' aria-label="Selecionar todos"></th>' +
          cabecalhoOrdenavel('empresas', 'nome', 'Empresa') + cabecalhoOrdenavel('empresas', 'situacao', 'Situação') + cabecalhoOrdenavel('empresas', 'responsavel', 'Responsável') +
          cabecalhoOrdenavel('empresas', 'cidade', 'Cidade') + '<th>Contato</th>' + cabecalhoOrdenavel('empresas', 'ultimo', 'Último contato') +
          cabecalhoOrdenavel('empresas', 'proxima', 'Próximo passo') + cabecalhoOrdenavel('empresas', 'comprado', 'Comprou', 'num') +
          '</tr></thead><tbody>' + lista.slice(0, lim).map(e => {
            const r = CRM.resumo(e.id);
            const c = contatoPrincipal(e.id);
            const sit = CRM.situacao(e);
            return '<tr data-acao="abrir-empresa" data-id="' + esc(e.id) + '" tabindex="0">' +
              '<td class="sel"><input type="checkbox" data-acao="selecionar" data-id="empresas:' + esc(e.id) + '"' + (selecao.empresas.has(e.id) ? ' checked' : '') + ' aria-label="Selecionar"></td>' +
              '<td><strong>' + esc(e.nome) + '</strong> ' + CRM.estrelas(e.qualificacao) + '<small>' + esc([e.segmento, (e.tags || []).join(', ')].filter(Boolean).join(' · ')) + '</small></td>' +
              '<td>' + CRM.seloSituacao(sit) + '</td>' +
              '<td>' + esc(CRM.nomeUsuario(e.responsavel_id)) + '</td>' +
              '<td>' + esc([e.cidade, e.uf].filter(Boolean).join('/')) + '</td>' +
              '<td>' + (c ? esc(c.nome) + '<small>' + esc(telefoneDe(e, c)) + '</small>' : '<small>' + esc(telefoneDe(e, null)) + '</small>') + '</td>' +
              '<td>' + (r.ultimoContato ? esc(R.dataBR(r.ultimoContato)) : '<small>nunca</small>') + '</td>' +
              '<td>' + (r.proxima ? '<span class="' + (R.diaLocal(r.proxima.data_hora) < CRM.hoje() ? 'atrasado' : '') + '">' + esc(R.dataBR(r.proxima.data_hora)) + '</span><small>' + esc(r.proxima.descricao) + '</small>' : '<small>—</small>') + '</td>' +
              '<td class="num">' + (r.totalComprado ? esc(R.moeda(r.totalComprado)) : '—') + '</td></tr>';
          }).join('') + '</tbody></table></div>' + rodapeLista('empresas', lista.length)
          : '<div class="cartao">' + vazio(E().D.empresas.length ? 'Nenhuma empresa com esses filtros.' : 'Nenhuma empresa ainda. Cadastre o primeiro lead ou importe a sua base em Configurações → Importar.') + '</div>');
    },
    depois() { ligaFiltros('empresas'); ligaFiltrosSalvos('empresas'); }
  };

  function sel(k, opcoes, v) { return '<select data-filtro="' + k + '" aria-label="' + esc(opcoes[0][1]) + '">' + CRM.opcoesHTML(opcoes, v || '') + '</select>'; }

  function ligaFiltros(tela) {
    const f = F(tela);
    $$('[data-filtro]').forEach(el => el.addEventListener('change', () => { f[el.dataset.filtro] = el.value; f.limite = null; CRM.render(); }));
    const b = $('#fBusca');
    if (b) b.addEventListener('input', () => { f.busca = b.value; f.limite = null; CRM.render(); });
    const c = $('#fCidade');
    if (c) c.addEventListener('input', () => { f.cidade = c.value; CRM.render(); });
    const st = $('#fSemTarefaEmp');
    if (st) st.addEventListener('change', () => { f.semTarefa = st.checked; CRM.render(); });
  }

  // ================================================================ Pessoas
  const pessoas = {
    render() {
      const f = F('pessoas');
      const cart = CRM.carteira();
      const lista = E().D.contatos.filter(c => {
        const e = CRM.empresa(c.empresa_id);
        if (cart && (!e || e.responsavel_id !== cart)) return false;
        if (f.responsavel && (!e || e.responsavel_id !== f.responsavel)) return false;
        if (f.tag && (c.tags || []).indexOf(f.tag) === -1) return false;
        if (f.aniversario && !(c.aniversario && c.aniversario.slice(5, 7) === CRM.hoje().slice(5, 7))) return false;
        return !f.busca || R.casaBusca(f.busca, [c.nome, c.email, c.telefone, c.celular, c.whatsapp, c.cargo, e && e.nome]);
      }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      const lim = f.limite || LIMITE;
      return '<div class="cabecalho"><h1>Pessoas <small>' + lista.length + '</small></h1><span class="flex"></span>' +
        '<button type="button" class="btn sec" data-acao="exportar-lista" data-id="pessoas">Exportar</button></div>' +
        '<div class="filtros"><input type="search" id="fBusca" placeholder="Nome, e-mail, telefone, cargo, empresa…" value="' + esc(f.busca || '') + '">' +
        (CRM.ehGestor() ? sel('responsavel', CRM.opcoesUsuarios('Responsável da empresa'), f.responsavel) : '') +
        sel('tag', CRM.lista(CRM.todasTags(), 'Etiqueta'), f.tag) +
        sel('aniversario', [['', 'Aniversário'], ['1', 'faz aniversário este mês']], f.aniversario) +
        '<button type="button" class="link" data-acao="limpar-filtros" data-id="pessoas">limpar</button></div>' +
        (lista.length ? '<div class="tabela-rolagem cartao sem-pad"><table class="tabela clicavel"><thead><tr><th>Nome</th><th>Empresa</th><th>Cargo</th><th>Telefone / WhatsApp</th><th>E-mail</th><th></th></tr></thead><tbody>' +
          lista.slice(0, lim).map(c => '<tr data-acao="abrir-empresa" data-id="' + esc(c.empresa_id) + '" tabindex="0">' +
            '<td><strong>' + esc(c.nome) + '</strong>' + (c.principal ? ' ★' : '') + (c.aniversario ? '<small>🎂 ' + esc(R.dataBR(c.aniversario).slice(0, 5)) + '</small>' : '') + '</td>' +
            '<td>' + esc(CRM.nomeEmpresa(c.empresa_id)) + '</td><td>' + esc(c.cargo || '') + '</td>' +
            '<td>' + esc([c.whatsapp || c.celular, c.telefone].filter(Boolean).join(' · ')) + '</td><td>' + esc(c.email || '') + '</td>' +
            '<td>' + acoesRapidas(c.empresa_id, c.id) + '</td></tr>').join('') + '</tbody></table></div>' + rodapeLista('pessoas', lista.length)
          : '<div class="cartao">' + vazio('Nenhuma pessoa encontrada.') + '</div>');
    },
    depois() { ligaFiltros('pessoas'); }
  };

  // ================================================================ Negócios
  function negociosFiltrados() {
    const f = F('negocios');
    const cart = CRM.carteira();
    const p = f.periodo ? R.periodo(f.periodo, CRM.hoje()) : null;
    const campoData = f.campoData || 'criado';
    return E().D.negocios.filter(n => {
      if (cart && n.responsavel_id !== cart) return false;
      if (f.status && n.status !== f.status) return false;
      if (f.etapa && n.etapa_id !== f.etapa) return false;
      if (f.responsavel && n.responsavel_id !== f.responsavel) return false;
      if (f.origem && n.origem !== f.origem && (CRM.empresa(n.empresa_id) || {}).origem !== f.origem) return false;
      if (f.motivo && n.motivo_perda !== f.motivo) return false;
      if (p) {
        const d = campoData === 'fechado' ? n.fechado_em : campoData === 'previsao' ? n.previsao_fechamento : R.diaLocal(n.criado_em);
        if (!R.noPeriodo(d, p)) return false;
      }
      return !f.busca || R.casaBusca(f.busca, [n.titulo, CRM.nomeEmpresa(n.empresa_id)]);
    });
  }

  const COLS_NEGOCIO = {
    titulo: n => R.normaliza(n.titulo), empresa: n => R.normaliza(CRM.nomeEmpresa(n.empresa_id)), etapa: n => (CRM.etapa(n.etapa_id) || {}).ordem || 0,
    status: n => n.status, valor: n => R.num(n.valor), responsavel: n => CRM.nomeUsuario(n.responsavel_id), previsao: n => n.previsao_fechamento || '',
    fechado: n => n.fechado_em || '', criado: n => n.criado_em || ''
  };

  const negocios = {
    render() {
      const f = F('negocios');
      if (!f.ordem) { f.ordem = 'criado'; f.desc = true; }
      if (f.status === undefined) f.status = 'aberto';
      const lista = ordena(negociosFiltrados(), f, COLS_NEGOCIO);
      const lim = f.limite || LIMITE;
      const total = lista.reduce((s, n) => s + R.num(n.valor), 0);
      const g = CRM.ehGestor();
      const todosSel = lista.length && lista.slice(0, lim).every(n => selecao.negocios.has(n.id));
      return '<div class="cabecalho"><h1>Negócios <small>' + lista.length + ' · ' + esc(R.moeda(total)) + '</small></h1><span class="flex"></span>' + filtrosSalvos('negocios') +
        '<button type="button" class="btn sec" data-acao="exportar-lista" data-id="negocios">Exportar</button>' +
        '<button type="button" class="btn ouro" data-acao="novo-negocio">+ Negócio</button></div>' +
        '<div class="filtros"><input type="search" id="fBusca" placeholder="Título ou empresa…" value="' + esc(f.busca || '') + '">' +
        sel('status', [['', 'Todos os status']].concat(R.STATUS_NEGOCIO), f.status) +
        sel('etapa', [['', 'Etapa']].concat(E().D.etapas.slice().sort((a, b) => (a.funil || '').localeCompare(b.funil || '') || a.ordem - b.ordem).map(e => [e.id, (CRM.funis().length > 1 ? e.funil + ' · ' : '') + e.nome])), f.etapa) +
        (g ? sel('responsavel', CRM.opcoesUsuarios('Responsável'), f.responsavel) : '') +
        sel('origem', CRM.lista(CRM.opcoes('origem'), 'Origem'), f.origem) +
        sel('motivo', CRM.lista(CRM.opcoes('motivo_perda'), 'Motivo de perda'), f.motivo) +
        sel('campoData', [['criado', 'Data: criação'], ['fechado', 'Data: fechamento'], ['previsao', 'Data: previsão']], f.campoData) +
        sel('periodo', [['', 'Período'], ['hoje', 'hoje'], ['semana', 'esta semana'], ['mes', 'este mês'], ['mes_passado', 'mês passado'], ['trimestre', 'últimos 3 meses'], ['ano', 'este ano'], ['12meses', 'últimos 12 meses']], f.periodo) +
        '<button type="button" class="link" data-acao="limpar-filtros" data-id="negocios">limpar</button></div>' +
        barraSelecao('negocios', g ? [['responsavel', 'Trocar responsável'], ['etapa', 'Mudar etapa'], ['excluir', 'Excluir']] : [['etapa', 'Mudar etapa']]) +
        (lista.length ? '<div class="tabela-rolagem cartao sem-pad"><table class="tabela clicavel"><thead><tr>' +
          '<th class="sel"><input type="checkbox" data-acao="selecionar-todos" data-id="negocios"' + (todosSel ? ' checked' : '') + ' aria-label="Selecionar todos"></th>' +
          cabecalhoOrdenavel('negocios', 'titulo', 'Negócio') + cabecalhoOrdenavel('negocios', 'empresa', 'Empresa') + cabecalhoOrdenavel('negocios', 'etapa', 'Etapa') +
          cabecalhoOrdenavel('negocios', 'status', 'Status') + cabecalhoOrdenavel('negocios', 'valor', 'Valor', 'num') + cabecalhoOrdenavel('negocios', 'responsavel', 'Responsável') +
          cabecalhoOrdenavel('negocios', 'previsao', 'Previsão') + cabecalhoOrdenavel('negocios', 'fechado', 'Fechado em') + '</tr></thead><tbody>' +
          lista.slice(0, lim).map(n => '<tr data-acao="abrir-negocio" data-id="' + esc(n.id) + '" tabindex="0">' +
            '<td class="sel"><input type="checkbox" data-acao="selecionar" data-id="negocios:' + esc(n.id) + '"' + (selecao.negocios.has(n.id) ? ' checked' : '') + ' aria-label="Selecionar"></td>' +
            '<td><strong>' + esc(n.titulo) + '</strong>' + (n.motivo_perda ? '<small>motivo: ' + esc(n.motivo_perda) + '</small>' : '') + '</td>' +
            '<td>' + esc(CRM.nomeEmpresa(n.empresa_id)) + '</td><td>' + esc((CRM.etapa(n.etapa_id) || {}).nome || '—') + '</td>' +
            '<td>' + CRM.seloStatus(n.status) + '</td><td class="num">' + esc(R.moeda(n.valor)) + '</td>' +
            '<td>' + esc(CRM.nomeUsuario(n.responsavel_id)) + '</td><td>' + esc(R.dataBR(n.previsao_fechamento)) + '</td><td>' + esc(R.dataBR(n.fechado_em)) + '</td></tr>').join('') +
          '</tbody></table></div>' + rodapeLista('negocios', lista.length)
          : '<div class="cartao">' + vazio('Nenhum negócio com esses filtros.') + '</div>');
    },
    depois() { ligaFiltros('negocios'); ligaFiltrosSalvos('negocios'); }
  };

  // ================================================================ Atividades (agenda da semana)
  const agenda = {
    render() {
      const f = F('agenda');
      const hoje = CRM.hoje();
      if (!f.semana) f.semana = R.inicioSemana(hoje);
      const cart = f.responsavel || CRM.carteira();
      const dias = [0, 1, 2, 3, 4, 5, 6].map(i => R.somaDias(f.semana, i));
      const fim = dias[6];
      const ats = E().D.atividades.filter(a => a.tipo !== 'sistema' && (!cart || a.responsavel_id === cart) && (!f.tipo || a.tipo === f.tipo) && (f.feitas || !a.concluida));
      const daSemana = ats.filter(a => { const d = R.diaLocal(a.data_hora); return d >= f.semana && d <= fim; });
      const atrasadas = ats.filter(a => !a.concluida && R.diaLocal(a.data_hora) < f.semana && f.semana <= hoje);
      const nomeDia = d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
      return '<div class="cabecalho"><h1>Atividades</h1>' +
        '<button type="button" class="btn sec" data-acao="agenda-mover" data-id="-7">‹ Semana anterior</button>' +
        '<button type="button" class="btn sec" data-acao="agenda-mover" data-id="0">Hoje</button>' +
        '<button type="button" class="btn sec" data-acao="agenda-mover" data-id="7">Próxima ›</button>' +
        '<span class="sub">' + esc(R.dataBR(f.semana)) + ' a ' + esc(R.dataBR(fim)) + '</span><span class="flex"></span>' +
        (CRM.ehGestor() ? sel('responsavel', CRM.opcoesUsuarios('Conforme o topo'), f.responsavel) : '') +
        sel('tipo', [['', 'Todos os tipos']].concat(R.TIPOS_MANUAIS), f.tipo) +
        '<label class="check"><input type="checkbox" id="fFeitas"' + (f.feitas ? ' checked' : '') + '> mostrar feitas</label>' +
        '<button type="button" class="btn ouro" data-acao="nova-tarefa">+ Tarefa</button></div>' +
        (atrasadas.length ? '<section class="cartao alerta-atraso"><h2>Atrasadas de antes <small>' + atrasadas.length + '</small></h2><ul class="lista tarefas">' +
          atrasadas.sort((a, b) => (a.data_hora < b.data_hora ? -1 : 1)).slice(0, 20).map(a => itemTarefa(a)).join('') + '</ul></section>' : '') +
        '<div class="semana">' + dias.map(d => {
          const l = daSemana.filter(a => R.diaLocal(a.data_hora) === d).sort((a, b) => (a.data_hora < b.data_hora ? -1 : 1));
          return '<section class="dia' + (d === hoje ? ' hoje' : '') + (d < hoje ? ' passado' : '') + '"><header>' + esc(nomeDia(d)) + '<button type="button" class="mini" data-acao="tarefa-no-dia" data-id="' + d + '" title="Nova tarefa neste dia">+</button></header>' +
            (l.length ? l.map(a => '<button type="button" class="evento t-' + esc(a.tipo) + (a.concluida ? ' feito' : '') + (R.situacaoTarefa(a, hoje) === 'atrasada' ? ' atrasado' : '') + '" data-acao="editar-tarefa" data-id="' + esc(a.id) + '">' +
              '<span class="hora">' + esc(R.horaLocal(a.data_hora)) + '</span> ' + CRM.iconeTipo(a.tipo) + ' <strong>' + esc(a.descricao) + '</strong><small>' + esc(CRM.nomeEmpresa(a.empresa_id)) +
              (!cart ? ' · ' + esc(R.primeiroNome(CRM.nomeUsuario(a.responsavel_id))) : '') + '</small></button>').join('') : '<p class="vazio">—</p>') + '</section>';
        }).join('') + '</div>';
    },
    depois() {
      ligaFiltros('agenda');
      const fe = $('#fFeitas'); if (fe) fe.addEventListener('change', () => { F('agenda').feitas = fe.checked; CRM.render(); });
    }
  };

  // ================================================================ Relatórios
  const relatorios = {
    render() {
      const f = F('relatorios');
      if (!f.periodo) f.periodo = 'mes';
      const hoje = CRM.hoje();
      const p = R.periodo(f.periodo, hoje, f.de, f.ate);
      const resp = f.responsavel || CRM.carteira();
      const funis = CRM.funis();
      if (f.funil == null || (f.funil && funis.indexOf(f.funil) === -1)) f.funil = funis.length > 1 ? funis[0] : '';
      const d = R.dashboard(E().D, E().ix, E().cfg, hoje, { periodo: p, responsavel_id: resp, funil: f.funil });
      const fat = ultimoFat = R.faturamento(E().D, E().ix, hoje, { periodo: p, responsavel_id: resp });
      const k = (t, v, s, cls) => '<div class="kpi ' + (cls || '') + '"><span>' + esc(t) + '</span><strong>' + esc(v) + '</strong><small>' + esc(s || '') + '</small></div>';
      const maxMes = Math.max(1, ...d.porMes.map(m => m.valor));
      const maxPrev = Math.max(1, ...d.previsao.map(m => m.valor));
      const tabela = (id, cab, linhas, vaziaTxt) => linhas.length ? '<div class="tabela-rolagem"><table class="tabela" id="' + id + '"><thead><tr>' + cab.map(c => '<th' + (c[1] ? ' class="num"' : '') + '>' + esc(c[0]) + '</th>').join('') + '</tr></thead><tbody>' +
        linhas.map(l => '<tr>' + l.map((c, i) => '<td' + (cab[i][1] ? ' class="num"' : '') + '>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : vazio(vaziaTxt || 'Sem dados no período.');
      const maxVend = Math.max(1, ...d.porVendedor.map(v => Math.max(v.valor, v.meta)));
      const maxOrig = Math.max(1, ...d.porOrigem.map(o => o.leads));
      const maxMot = Math.max(1, ...d.motivosPerda.map(o => o.qtd));
      const maxProd = Math.max(1, ...d.porProduto.map(o => o.valor));
      const maxEt = Math.max(1, ...d.porEtapa.map(o => o.valor));
      const exp = id => '<button type="button" class="mini" data-acao="exportar-tabela" data-id="' + id + '">CSV</button>';
      return '<div class="cabecalho"><h1>Relatórios</h1>' +
        sel('periodo', [['hoje', 'Hoje'], ['semana', 'Esta semana'], ['mes', 'Este mês'], ['mes_passado', 'Mês passado'], ['trimestre', 'Últimos 3 meses'], ['ano', 'Este ano'], ['12meses', 'Últimos 12 meses'], ['tudo', 'Tudo'], ['personalizado', 'Escolher datas…']], f.periodo) +
        (f.periodo === 'personalizado' ? '<input type="date" id="fDe" value="' + esc(f.de || '') + '" aria-label="De"><input type="date" id="fAte" value="' + esc(f.ate || '') + '" aria-label="Até">' : '') +
        (funis.length > 1 ? sel('funil', [['', 'Todos os funis']].concat(funis.map(x => [x, x])), f.funil) : '') +
        (CRM.ehGestor() ? sel('responsavel', CRM.opcoesUsuarios('Conforme o topo'), f.responsavel) : '') +
        '<span class="sub">' + (p.de > '0001' ? esc(R.dataBR(p.de)) + ' a ' + esc(R.dataBR(p.ate)) : 'todo o histórico') + (resp ? ' · ' + esc(CRM.nomeUsuario(resp)) : ' · equipe toda') + '</span>' +
        '<span class="flex"></span><button type="button" class="btn sec" data-acao="imprimir">Imprimir</button></div>' +
        '<section class="kpis">' +
        // Mesmos nomes do painel do Agendor, que a equipe já conhece.
        k('Total vendido', R.moeda(d.realizadas.valor), d.realizadas.qtd + ' negócio(s) ganho(s)' + (resp ? ' · ' + CRM.nomeUsuario(resp) : ' · equipe toda'), 'verde') +
        (fat.existe ? k('Faturado (notas fiscais)', R.moeda(fat.total), fat.notas + ' nota(s) · ' + fat.clientes + ' cliente(s)', 'verde') : '') +
        k('Negócios ganhos', String(d.realizadas.qtd), 'ticket médio ' + R.moeda(d.ticket)) +
        k('Negócios iniciados', String(d.iniciados.qtd), R.moeda(d.iniciados.valor)) +
        k('Negócios perdidos', String(d.perdidas.qtd), R.moeda(d.perdidas.valor), d.perdidas.qtd ? 'alerta' : '') +
        k('Taxa ganhos vs perdidos', R.pct(d.conversao), R.pct(d.conversaoValor) + ' em valor') +
        k('Ciclo médio de vendas', d.ciclo == null ? '—' : Math.round(d.ciclo) + ' dias', 'da criação ao fechamento') +
        k('Em andamento', R.moeda(d.abertas.valor), d.abertas.qtd + ' negócios · ponderado ' + R.moeda(d.abertas.ponderado)) +
        k('Vendas previstas', R.moeda(d.previstas.valor), d.previstas.qtd + ' com previsão no período · ponderado ' + R.moeda(d.previstas.ponderado)) +
        k('Leads novos', String(d.leadsNovos), 'empresas cadastradas no período') +
        k('Clientes', d.clientesNovos + ' novos', d.clientesRecorrentes + ' recorrentes compraram') +
        k('Atividades', String(d.atividadesRealizadas), d.atividadesPendentes + ' pendentes · ' + d.atividadesAtrasadas + ' atrasadas', d.atividadesAtrasadas ? 'alerta' : '') +
        '</section>' +
        '<div class="colunas">' +
        '<section class="cartao"><h2>Vendas por mês <small>12 meses</small></h2><div class="grafico-colunas">' + d.porMes.map(m => '<div class="col" title="' + esc(R.mesCurto(m.mes) + ': ' + R.moeda(m.valor) + ' (' + m.qtd + ')') + '">' +
          '<span class="col-valor">' + (m.valor ? esc(abrevia(m.valor)) : '') + '</span><span class="col-barra"><span data-altura="' + (m.valor / maxMes * 100).toFixed(1) + '"></span></span><span class="col-rot">' + esc(R.mesCurto(m.mes)) + '</span></div>').join('') + '</div></section>' +
        '<section class="cartao"><h2>Previsão de vendas <small>abertos por mês de previsão</small></h2><div class="grafico-colunas">' + d.previsao.map(m => '<div class="col" title="' + esc(R.mesCurto(m.mes) + ': ' + R.moeda(m.valor) + ' · ponderado ' + R.moeda(m.ponderado)) + '">' +
          '<span class="col-valor">' + (m.valor ? esc(abrevia(m.ponderado)) : '') + '</span><span class="col-barra"><span data-altura="' + (m.valor / maxPrev * 100).toFixed(1) + '"></span></span><span class="col-rot">' + esc(R.mesCurto(m.mes)) + '</span></div>').join('') + '</div>' +
          '<p class="dica">Número em cima = valor ponderado pela chance da etapa.</p></section>' +
        '</div>' +
        '<section class="cartao"><h2>Vendas por vendedor ' + exp('tVend') + '</h2>' + tabela('tVend', [['Vendedor'], ['Vendido', 1], ['Meta', 1], ['Atingido'], ['Ganhos', 1], ['Perdidos', 1], ['Conversão', 1], ['Em aberto', 1], ['Atividades', 1], ['Carteira', 1]],
          d.porVendedor.sort((a, b) => b.valor - a.valor).map(v => [esc(v.usuario.nome), esc(R.moeda(v.valor)), v.meta ? esc(R.moeda(v.meta)) : '—',
            CRM.barra(v.valor, v.meta || maxVend, v.atingido == null ? '' : R.pct(v.atingido)), v.ganhos, v.perdidos, esc(R.pct(v.conversao)), esc(R.moeda(v.valorAberto)) + ' (' + v.abertos + ')', v.atividades, v.carteira])
            .concat(d.porVendedor.length > 1 ? [linhaTotal(d.porVendedor)] : [])) + '</section>' +
        secaoFaturamento(fat, exp, tabela) +
        '<div class="colunas">' +
        '<section class="cartao"><h2>Funil agora <small>negócios abertos</small> ' + exp('tEtapa') + '</h2>' + tabela('tEtapa', [['Etapa'], ['Qtd.', 1], ['Valor', 1], [''], ['Ponderado', 1]],
          d.porEtapa.map(x => [esc((CRM.funis().length > 1 ? (x.etapa.funil || '') + ' · ' : '') + x.etapa.nome), x.qtd, esc(R.moeda(x.valor)), CRM.barra(x.valor, maxEt), esc(R.moeda(x.ponderado))])) + '</section>' +
        '<section class="cartao"><h2>Origem dos leads ' + exp('tOrig') + '</h2>' + tabela('tOrig', [['Origem'], ['Leads', 1], [''], ['Viraram clientes', 1], ['Vendido', 1]],
          d.porOrigem.map(o => [esc(o.nome), o.leads, CRM.barra(o.leads, maxOrig), o.clientes + (o.leads ? ' (' + R.pct(o.clientes / o.leads * 100) + ')' : ''), esc(R.moeda(o.valor))])) + '</section>' +
        '</div><div class="colunas">' +
        '<section class="cartao"><h2>Motivos de perda ' + exp('tMot') + '</h2>' + tabela('tMot', [['Motivo'], ['Qtd.', 1], [''], ['Valor perdido', 1]],
          d.motivosPerda.map(o => [esc(o.nome), o.qtd, CRM.barra(o.qtd, maxMot), esc(R.moeda(o.valor))]), 'Nenhuma perda no período.') + '</section>' +
        '<section class="cartao"><h2>Vendas por produto ' + exp('tProd') + '</h2>' + tabela('tProd', [['Produto'], ['Quantidade', 1], ['Valor', 1], ['']],
          d.porProduto.slice(0, 30).map(o => [esc(o.nome), esc(R.numero(o.quantidade)), esc(R.moeda(o.valor)), CRM.barra(o.valor, maxProd)]), 'Nenhuma venda com produtos no período (os itens entram pela ficha do negócio).') + '</section>' +
        '</div><div class="colunas">' +
        '<section class="cartao"><h2>Vendas por origem ' + exp('tVorig') + '</h2>' + tabela('tVorig', [['Origem'], ['Vendas', 1], ['Valor', 1]],
          d.vendasPorOrigem.map(o => [esc(o.nome), o.qtd, esc(R.moeda(o.valor))])) + '</section>' +
        '<section class="cartao"><h2>Atividades realizadas ' + exp('tAtiv') + '</h2>' + tabela('tAtiv', [['Tipo'], ['Qtd.', 1]], d.atividadesPorTipo.map(o => [esc(o.nome), o.qtd])) + '</section>' +
        '</div>';
    },
    depois() {
      ligaFiltros('relatorios');
      const f = F('relatorios');
      ['fDe', 'fAte'].forEach(id => { const el = $('#' + id); if (el) el.addEventListener('change', () => { f[id === 'fDe' ? 'de' : 'ate'] = el.value; CRM.render(); }); });
    }
  };

  let ultimoFat = null;

  // Última linha da tabela por vendedor: o total da equipe.
  function linhaTotal(l) {
    const t = l.reduce((a, v) => ({ valor: a.valor + v.valor, meta: a.meta + v.meta, ganhos: a.ganhos + v.ganhos, perdidos: a.perdidos + v.perdidos,
      abertos: a.abertos + v.abertos, valorAberto: a.valorAberto + v.valorAberto, atividades: a.atividades + v.atividades, carteira: a.carteira + v.carteira }),
    { valor: 0, meta: 0, ganhos: 0, perdidos: 0, abertos: 0, valorAberto: 0, atividades: 0, carteira: 0 });
    const b = x => '<strong>' + x + '</strong>';
    return [b('Total da equipe'), b(esc(R.moeda(t.valor))), t.meta ? b(esc(R.moeda(t.meta))) : '—', t.meta ? CRM.barra(t.valor, t.meta, R.pct(t.valor / t.meta * 100)) : '',
      b(t.ganhos), b(t.perdidos), b(esc(R.pct(t.ganhos + t.perdidos ? t.ganhos / (t.ganhos + t.perdidos) * 100 : null))),
      b(esc(R.moeda(t.valorAberto)) + ' (' + t.abertos + ')'), b(t.atividades), b(t.carteira)];
  }

  // Faturamento pelas notas fiscais importadas: quem comprou, o quê, de que segmento.
  function secaoFaturamento(fat, exp, tabela) {
    if (!fat.existe) {
      return '<section class="cartao"><h2>Faturamento (notas fiscais)</h2><p class="dica">Importe os XML das notas em ' +
        (CRM.ehGestor() ? '<button type="button" class="link" data-acao="aba" data-id="ajustes">Configurações → Importar</button>' : 'Configurações → Importar (gestor)') +
        ' para ver aqui quem mais comprou, os produtos que mais saíram e as vendas por segmento (escola, indústria, condomínio…).</p></section>';
    }
    const max = l => Math.max(1, ...l.map(x => x.valor));
    const mc = max(fat.topClientes.slice(0, 10)), ms = max(fat.porSegmento), mp = max(fat.topProdutosValor.slice(0, 10)), mv = max(fat.porVendedor), mcid = max(fat.porCidade.slice(0, 10));
    const maxQ = Math.max(1, ...fat.topProdutosQtd.slice(0, 10).map(x => x.quantidade));
    const maxMes = Math.max(1, ...fat.porMes.map(m => m.valor));
    const pctTotal = v => fat.total ? R.pct(v / fat.total * 100) : '—';
    const todos = t => '<button type="button" class="mini" data-acao="fat-exportar" data-id="' + t + '" title="Baixar a lista completa (não só o top 10)">todos</button>';
    const nomeCli = c => c.empresa_id ? '<button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(c.empresa_id) + '">' + esc(c.nome) + '</button>' : esc(c.nome);
    return '<h2 class="titulo-secao">Faturamento <small>pelas notas fiscais do período' + (fat.canceladas ? ' · ' + fat.canceladas + ' cancelada(s) fora da conta' : '') + '</small></h2>' +
      '<section class="kpis">' +
      '<div class="kpi verde"><span>Faturado</span><strong>' + esc(R.moeda(fat.total)) + '</strong><small>' + fat.notas + ' nota(s) de venda</small></div>' +
      '<div class="kpi"><span>Clientes que compraram</span><strong>' + fat.clientes + '</strong><small>' + fat.clientesNovos + ' pela 1ª vez · ' + esc(R.moeda(fat.valorClientesNovos)) + '</small></div>' +
      '<div class="kpi"><span>Ticket por nota</span><strong>' + esc(R.moeda(fat.ticket)) + '</strong><small>valor médio de cada nota</small></div>' +
      '</section>' +
      '<section class="cartao"><h2>Faturamento por mês <small>12 meses</small></h2><div class="grafico-colunas">' + fat.porMes.map(m => '<div class="col" title="' + esc(R.mesCurto(m.mes) + ': ' + R.moeda(m.valor) + ' (' + m.qtd + ' notas)') + '">' +
        '<span class="col-valor">' + (m.valor ? esc(abrevia(m.valor)) : '') + '</span><span class="col-barra"><span data-altura="' + (m.valor / maxMes * 100).toFixed(1) + '"></span></span><span class="col-rot">' + esc(R.mesCurto(m.mes)) + '</span></div>').join('') + '</div></section>' +
      '<div class="colunas">' +
      '<section class="cartao"><h2>Top 10 clientes ' + exp('tFatCli') + todos('clientes') + '</h2>' + tabela('tFatCli', [['#'], ['Cliente'], ['Notas', 1], ['Valor', 1], [''], ['% do total', 1]],
        fat.topClientes.slice(0, 10).map((c, i) => [i + 1, nomeCli(c) + (c.novo ? ' <span class="selo verde">1ª compra</span>' : ''), c.notas, esc(R.moeda(c.valor)), CRM.barra(c.valor, mc), pctTotal(c.valor)])) + '</section>' +
      '<section class="cartao"><h2>Vendas por segmento ' + exp('tFatSeg') + '</h2>' + tabela('tFatSeg', [['Segmento'], ['Clientes', 1], ['Notas', 1], ['Valor', 1], [''], ['% do total', 1]],
        fat.porSegmento.map(g => [esc(g.nome), g.clientes, g.notas, esc(R.moeda(g.valor)), CRM.barra(g.valor, ms), pctTotal(g.valor)])) +
        (fat.porSegmento.some(g => g.nome === '(sem segmento)') && CRM.ehGestor() ? '<p class="dica">Sem segmento: preencha na ficha, em massa na lista de Empresas, ou pelo nome em Configurações → Origens, segmentos, motivos.</p>' : '') + '</section>' +
      '</div><div class="colunas">' +
      '<section class="cartao"><h2>Top 10 produtos <small>por valor</small> ' + exp('tFatProd') + todos('produtos') + '</h2>' + tabela('tFatProd', [['#'], ['Produto'], ['Quantidade', 1], ['Valor', 1], [''], ['Clientes', 1]],
        fat.topProdutosValor.slice(0, 10).map((x, i) => [i + 1, esc(x.descricao) + (x.codigo ? ' <small>' + esc(x.codigo) + '</small>' : ''), esc(R.numero(x.quantidade)) + ' ' + esc(x.unidade), esc(R.moeda(x.valor)), CRM.barra(x.valor, mp), x.clientes]),
        'Nenhum item de venda nas notas do período.') + '</section>' +
      '<section class="cartao"><h2>Top 10 produtos <small>por quantidade</small> ' + exp('tFatQtd') + '</h2>' + tabela('tFatQtd', [['#'], ['Produto'], ['Quantidade', 1], [''], ['Valor', 1], ['Notas', 1]],
        fat.topProdutosQtd.slice(0, 10).map((x, i) => [i + 1, esc(x.descricao) + (x.codigo ? ' <small>' + esc(x.codigo) + '</small>' : ''), esc(R.numero(x.quantidade)) + ' ' + esc(x.unidade), CRM.barra(x.quantidade, maxQ), esc(R.moeda(x.valor)), x.notas]),
        'Nenhum item de venda nas notas do período.') + '</section>' +
      '</div><div class="colunas">' +
      '<section class="cartao"><h2>Faturado por vendedor <small>responsável pelo cliente</small> ' + exp('tFatVend') + '</h2>' + tabela('tFatVend', [['Vendedor'], ['Clientes', 1], ['Notas', 1], ['Valor', 1], [''], ['% do total', 1]],
        fat.porVendedor.map(g => [esc(g.nome), g.clientes, g.notas, esc(R.moeda(g.valor)), CRM.barra(g.valor, mv), pctTotal(g.valor)])) + '</section>' +
      '<section class="cartao"><h2>Top 10 cidades ' + exp('tFatCid') + '</h2>' + tabela('tFatCid', [['Cidade'], ['Clientes', 1], ['Notas', 1], ['Valor', 1], ['']],
        fat.porCidade.slice(0, 10).map(g => [esc(g.nome), g.clientes, g.notas, esc(R.moeda(g.valor)), CRM.barra(g.valor, mcid)])) + '</section>' +
      '</div>';
  }

  function abrevia(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + ' mi';
    if (v >= 1e3) return Math.round(v / 1e3) + ' mil';
    return String(Math.round(v));
  }

  // ================================================================ ações das telas
  Object.assign(CRM.acoes, {
    'fat-exportar': t => {
      const f = ultimoFat; if (!f) return;
      if (t === 'clientes') CRM.baixarCSV('faturamento-clientes', ['Cliente', 'Notas', 'Valor', 'Última compra', '1ª compra no período'],
        f.topClientes.map(c => [c.nome, c.notas, String(c.valor.toFixed(2)).replace('.', ','), R.dataBR(c.ultima), c.novo ? 'sim' : 'não']));
      else CRM.baixarCSV('faturamento-produtos', ['Produto', 'Código', 'Unidade', 'Quantidade', 'Valor', 'Notas', 'Clientes'],
        f.topProdutosValor.map(x => [x.descricao, x.codigo, x.unidade, String(x.quantidade).replace('.', ','), String(x.valor.toFixed(2)).replace('.', ','), x.notas, x.clientes]));
    },
    'fila-pular': k => { pulados.add(k); CRM.render(); },
    'fila-voltar-pulados': () => { pulados.clear(); CRM.render(); },
    'fila-concluir': id => CRM.concluirTarefa(id, true),
    'fila-adiar': async id => {
      const a = E().ix.porId.atividades.get(id); if (!a) return;
      const hora = R.horaLocal(a.data_hora) || '09:00';
      try { await CRM.atualizar('atividades', id, { data_hora: R.momento(R.somaDias(CRM.hoje(), 1), hora) }); CRM.toast('Adiada para amanhã às ' + hora + '.'); } catch (e) { CRM.falhou(e); }
    },
    'fila-registrar': id => CRM.fichas.formRegistro(null, { empresa_id: id }),
    'fila-agendar': id => CRM.fichas.formTarefa(null, { empresa_id: id }),
    'encerrar-esquecidos': async () => {
      const lista = R.alertas(E().D, E().ix, E().cfg, CRM.hoje(), CRM.carteira()).negociosEsquecidos;
      const sel = $('#motivoEsquecidos'), motivo = sel ? sel.value : null;
      if (!lista.length || !confirm('Encerrar ' + lista.length + ' negócio(s) esquecido(s) como PERDIDOS' + (motivo ? ' (motivo: ' + motivo + ')' : '') +
        '?\n\nCada um fica com a data do último movimento. Dá para reabrir qualquer um depois, pela ficha do negócio.')) return;
      // Um pedido por data de fechamento (a data é a do último movimento de cada negócio).
      const porDia = new Map();
      lista.forEach(n => { const d = R.ultimoMovimento(n, E().ix) || CRM.hoje(); if (!porDia.has(d)) porDia.set(d, []); porDia.get(d).push(n.id); });
      let feitos = 0;
      try {
        for (const [dia, ids] of porDia) {
          await CRM.atualizarVarios('negocios', ids, { status: 'perdido', fechado_em: dia, motivo_perda: motivo || null });
          feitos += ids.length;
        }
        CRM.toast(feitos + ' negócio(s) encerrado(s).');
      } catch (e) { CRM.falhou(e); if (feitos) CRM.toast(feitos + ' encerrado(s) antes do erro.', true); }
    },
    'ir-alerta': id => {
      const alvo = document.getElementById('alerta-' + id);
      if (id === 'tarefas-atrasadas' || id === 'tarefas-hoje') { const l = $('.colunas-inicio .tarefas'); if (l) l.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'nova-tarefa': () => CRM.fichas.formTarefa(null, {}),
    'novo-registro': () => CRM.fichas.formRegistro(null, {}),
    'novo-negocio': () => CRM.fichas.formNegocio(null, {}),
    'novo-lead': () => CRM.fichas.formLead(),
    'tarefa-no-dia': d => CRM.fichas.formTarefa(null, { data_hora: R.momento(d, '09:00') }),
    'agenda-mover': d => { const f = F('agenda'); f.semana = +d === 0 ? R.inicioSemana(CRM.hoje()) : R.somaDias(f.semana, +d); CRM.render(); },
    ordenar: id => { const [tela, col] = id.split(':'); const f = F(tela); if (f.ordem === col) f.desc = !f.desc; else { f.ordem = col; f.desc = false; } CRM.render(); },
    'mostrar-mais': tela => { const f = F(tela); f.limite = (f.limite || LIMITE) + 200; CRM.render(); },
    'limpar-filtros': tela => { E().filtros[tela] = {}; CRM.render(); },
    selecionar: (id, el) => { const [tela, rid] = id.split(':'); if (el.checked) selecao[tela].add(rid); else selecao[tela].delete(rid); CRM.render(); },
    'selecionar-todos': (tela, el) => {
      const lista = tela === 'empresas' ? empresasFiltradas() : negociosFiltrados();
      const lim = F(tela).limite || LIMITE;
      lista.slice(0, lim).forEach(x => (el.checked ? selecao[tela].add(x.id) : selecao[tela].delete(x.id)));
      CRM.render();
    },
    'limpar-selecao': tela => { selecao[tela].clear(); CRM.render(); },
    massa: id => { const [tela, acao] = id.split(':'); CRM.fichas.acaoEmMassa(tela, acao, [...selecao[tela]]); },
    imprimir: () => window.print(),
    'exportar-tabela': id => {
      const t = document.getElementById(id); if (!t) return;
      const linhas = $$('tr', t).map(tr => $$('th, td', tr).map(c => c.textContent.trim()));
      CRM.baixarCSV('relatorio-' + id.slice(1).toLowerCase(), linhas[0], linhas.slice(1));
    },
    'exportar-lista': tela => {
      const R2 = R;
      if (tela === 'empresas') {
        const l = empresasFiltradas();
        CRM.baixarCSV('empresas', ['Nome', 'Razão social', 'CNPJ', 'Situação', 'Responsável', 'Segmento', 'Origem', 'Qualificação', 'Telefone', 'WhatsApp', 'E-mail', 'Site',
          'CEP', 'Endereço', 'Número', 'Complemento', 'Bairro', 'Cidade', 'UF', 'Etiquetas', 'Último contato', 'Última compra', 'Total comprado', 'Cadastro', 'Observações'],
        l.map(e => { const r = CRM.resumo(e.id); return [e.nome, e.razao_social, e.cnpj, R2.rotulo(R2.SITUACOES, CRM.situacao(e)), CRM.nomeUsuario(e.responsavel_id), e.segmento, e.origem, e.qualificacao,
          e.telefone, e.whatsapp, e.email, e.site, e.cep, e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.uf, e.tags, R2.dataBR(r.ultimoContato), R2.dataBR(r.ultimaCompra),
          r.totalComprado ? String(r.totalComprado).replace('.', ',') : '', R2.dataBR(e.criado_em), e.observacoes]; }));
      } else if (tela === 'negocios') {
        const l = negociosFiltrados();
        CRM.baixarCSV('negocios', ['Título', 'Empresa', 'Etapa', 'Status', 'Valor', 'Responsável', 'Origem', 'Previsão', 'Fechado em', 'Motivo de perda', 'Criado em'],
          l.map(n => [n.titulo, CRM.nomeEmpresa(n.empresa_id), (CRM.etapa(n.etapa_id) || {}).nome, R2.rotulo(R2.STATUS_NEGOCIO, n.status), String(R2.num(n.valor)).replace('.', ','),
            CRM.nomeUsuario(n.responsavel_id), n.origem, R2.dataBR(n.previsao_fechamento), R2.dataBR(n.fechado_em), n.motivo_perda, R2.dataBR(n.criado_em)]));
      } else if (tela === 'pessoas') {
        CRM.baixarCSV('pessoas', ['Nome', 'Empresa', 'Cargo', 'Telefone', 'Celular', 'WhatsApp', 'E-mail', 'Aniversário', 'Principal'],
          E().D.contatos.map(c => [c.nome, CRM.nomeEmpresa(c.empresa_id), c.cargo, c.telefone, c.celular, c.whatsapp, c.email, R2.dataBR(c.aniversario), c.principal ? 'sim' : '']));
      }
    }
  });

  // Arrastar cartões no funil (entre etapas, ou nas zonas de ganho/perda).
  document.addEventListener('dragstart', ev => {
    const card = ev.target.closest && ev.target.closest('.card');
    if (!card) return;
    ev.dataTransfer.setData('text/plain', card.dataset.id);
    ev.dataTransfer.effectAllowed = 'move';
    card.classList.add('arrastando');
    document.body.classList.add('arrastando-card');
  });
  document.addEventListener('dragend', ev => {
    if (ev.target.classList) ev.target.classList.remove('arrastando');
    document.body.classList.remove('arrastando-card');
    $$('.alvo').forEach(c => c.classList.remove('alvo'));
  });
  document.addEventListener('dragover', ev => {
    const alvo = ev.target.closest && ev.target.closest('.coluna, .zona');
    if (!alvo) return;
    ev.preventDefault();
    $$('.alvo').forEach(c => { if (c !== alvo) c.classList.remove('alvo'); });
    alvo.classList.add('alvo');
  });
  document.addEventListener('drop', ev => {
    const alvo = ev.target.closest && ev.target.closest('.coluna, .zona');
    if (!alvo) return;
    ev.preventDefault();
    document.body.classList.remove('arrastando-card');
    const n = CRM.negocio(ev.dataTransfer.getData('text/plain'));
    if (!n) return;
    if (!CRM.podeEditarNegocio(n)) { CRM.toast('Este negócio é de ' + CRM.nomeUsuario(n.responsavel_id) + '.', true); return; }
    if (alvo.dataset.status === 'ganho') { CRM.fichas.formGanho(n); return; }
    if (alvo.dataset.status === 'perdido') { CRM.fichas.formPerda(n); return; }
    const et = alvo.dataset.etapa;
    if (et && et !== n.etapa_id) CRM.auto.mudarNegocio(n, { etapa_id: et }).catch(CRM.falhou);
  });

  CRM.telas = { inicio, fila, funil, empresas, pessoas, negocios, agenda, relatorios, ajustes: { render: () => CRM.ajustes.render(), depois: el => CRM.ajustes.depois(el) } };
})();
