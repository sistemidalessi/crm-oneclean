/* Turma — os mascotes da instalação (17/10/2026, pedido do Anderson: "na Agilité a gente criou um mascote, o
   Agilitinho… queria trazer isso; tem os de linha de estoque, o do boleto de cobrança, o de compras… e um
   principal, um robozinho"). Só liga quando o config.js da instalação traz `turma` (nomes, imagens e em que tela
   cada um aparece são da instalação; o código é o mesmo para qualquer cliente).
   - O PRINCIPAL fica no topo, ao lado do sino, com o contador: clicar abre o guia do dia (o que está esperando a
     pessoa, primeiro o da tela aberta). Os números vêm da RLS de cada um (crm_turma_resumo: SECURITY INVOKER),
     então a vendedora nunca vê número do Caixa.
   - O ESPECIALISTA da tela aparece no canto de baixo e diz o estado daquela área (Estoque, Compras, Cobrança…).
   - Os de LINHA DE PRODUTO aparecem ao lado do produto (pela linha do FKN) e filtram o Estoque.
   - O ANFITRIÃO recebe na tela de entrada.
   A imagem não sabe nada sozinha: cada fala sai de um número do sistema. Nada de estoque, preço ou pagamento
   inventado. Aqui: a parte pura (testes/turma.test.js) e a tela. */
(function (raiz) {
  'use strict';
  const NIVEL = { urgente: 0, atencao: 1, info: 2 };
  const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
  const reais = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const normaliza = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  // Quem fala em cada tela: telas['caixa:cobranca'] (sub-aba) vence telas['caixa'], que vence o principal.
  function especialista(t, aba, sub) {
    if (!t) return null;
    const tl = t.telas || {};
    return (sub && tl[aba + ':' + sub]) || tl[aba] || t.principal;
  }
  // Mascote do produto: a 1ª regra que bate com a descrição (mais precisa: "VASSOURA" na linha SUPER MERCADO); senão, com a linha do FKN.
  function daLinha(t, linha, descricao) {
    const regras = (t && t.linhas) || [];
    for (const txt of [descricao, linha]) {
      const s = normaliza(txt);
      if (!s) continue;
      const r = regras.find(x => new RegExp(x[1]).test(s));
      if (r) return r[0];
    }
    return null;
  }
  const saudacao = hora => (hora < 5 ? 'Boa noite' : hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite');

  // O guia do dia: [{ id, nivel, texto, aba, sub, mascote }], do mais urgente para o menos.
  // c = { papel, vendas, al, resumo, boletos, fkn: [{arquivo}], recusas, vigiasParados, admin, gestor, op, comprador }
  function guia(c) {
    const it = [], poe = (id, nivel, texto, aba, sub, mascote) => it.push({ id, nivel, texto, aba, sub: sub || null, mascote: mascote || null });
    const al = c.al || {}, r = c.resumo || {}, n = a => (a || []).length;
    if (c.vendas) {
      if (c.boletos) poe('boletos', 'urgente', plural(c.boletos, 'cliente com boleto atualizado para mandar', 'clientes com boleto atualizado para mandar'), 'fila', null, 'cobranca');
      if (n(al.atrasadas)) poe('atrasadas', 'urgente', plural(n(al.atrasadas), 'tarefa atrasada', 'tarefas atrasadas'), 'inicio');
      if (n(al.deHoje)) poe('hoje', 'atencao', plural(n(al.deHoje), 'tarefa para hoje', 'tarefas para hoje'), 'inicio');
      if (n(al.leadsSemAtendimento)) poe('leads', 'atencao', plural(n(al.leadsSemAtendimento), 'lead sem atendimento', 'leads sem atendimento'), 'fila');
      if (n(al.recompra)) poe('recompra', 'info', plural(n(al.recompra), 'cliente no ritmo de recompra', 'clientes no ritmo de recompra'), 'fila');
      if (n(al.clientesSemContato)) poe('semcontato', 'info', plural(n(al.clientesSemContato), 'cliente sem contato há tempo', 'clientes sem contato há tempo'), 'fila');
      if (n(al.negociosParados)) poe('parados', 'info', plural(n(al.negociosParados), 'negócio parado', 'negócios parados'), 'funil');
    }
    const p = r.pedidos || {};
    if (c.gestor && p.bloqueados) poe('bloqueados', 'atencao', plural(p.bloqueados, 'pedido esperando liberação', 'pedidos esperando liberação'), 'pedidos');
    if (c.op) {
      if (p.liberados) poe('liberados', 'atencao', plural(p.liberados, 'pedido liberado para mandar à separação', 'pedidos liberados para mandar à separação'), 'pedidos', 'separacao');
      if (p.separacao) poe('separacao', 'info', plural(p.separacao, 'pedido em separação', 'pedidos em separação'), 'pedidos', 'separacao');
      if (p.separado) poe('separado', 'atencao', plural(p.separado, 'pedido separado esperando a NF-e', 'pedidos separados esperando a NF-e'), 'pedidos', 'separacao');
    }
    const nf = r.nfe || {};
    if (nf.pendentes) poe('nfe-pend', 'urgente', plural(nf.pendentes, 'NF-e sem resposta da Sefaz (consultar)', 'NF-e sem resposta da Sefaz (consultar)'), 'pedidos', 'nfe');
    if (nf.rejeitadas) poe('nfe-rej', 'urgente', plural(nf.rejeitadas, 'NF-e rejeitada nos últimos dias', 'NF-e rejeitadas nos últimos dias'), 'pedidos', 'nfe');
    if (c.admin || c.comprador) {
      (c.recusas || []).forEach((x, i) => poe('fkn-recusa-' + i, 'urgente', 'Relatório do FKN recusado: puxe de novo com as opções certas', 'compras'));
      (c.fkn || []).forEach((x, i) => poe('fkn-' + i, 'atencao', 'Puxar do FKN: ' + x.arquivo, 'compras'));
      const es = r.estoque || {};
      if (es.sem_explicacao) poe('estoque-dif', 'atencao', plural(es.sem_explicacao, 'diferença de estoque sem explicação', 'diferenças de estoque sem explicação'), 'estoque', 'conferencia');
      if (es.abaixo_minimo) poe('estoque-min', 'info', plural(es.abaixo_minimo, 'produto abaixo do mínimo', 'produtos abaixo do mínimo'), 'compras');
    }
    if (c.admin) {
      const cx = r.caixa || {}, rc = r.receber || {};
      if (cx.vencidas) poe('cx-venc', 'urgente', plural(cx.vencidas, 'conta vencida sem baixa', 'contas vencidas sem baixa') + ' (' + reais(cx.vencidas_valor) + ')', 'caixa');
      if (cx.hoje) poe('cx-hoje', 'atencao', plural(cx.hoje, 'conta para pagar hoje', 'contas para pagar hoje') + ' (' + reais(cx.hoje_valor) + ')', 'caixa');
      if (rc.vencidos) poe('receber', 'info', plural(rc.vencidos, 'título a receber em atraso', 'títulos a receber em atraso') + ' (' + reais(rc.valor) + ')', 'caixa', 'cobranca');
      (c.vigiasParados || []).forEach((v, i) => poe('vigia-' + i, 'urgente', 'O vigia de notas "' + v + '" parou de dar sinal', 'ajustes'));
    }
    return it.sort((a, b) => NIVEL[a.nivel] - NIVEL[b.nivel]);
  }
  // Selo do principal: só o que pede ação (urgente + atenção).
  const contagem = itens => (itens || []).filter(x => x.nivel !== 'info').length;
  // O que o especialista fala na tela: os itens do guia daquela tela (a sub-aba primeiro) ou a fala de "tudo em dia".
  function falasDaTela(itens, aba, sub, max) {
    const daTela = (itens || []).filter(x => x.aba === aba);
    daTela.sort((a, b) => (sub ? (b.sub === sub) - (a.sub === sub) : 0) || NIVEL[a.nivel] - NIVEL[b.nivel]);
    return daTela.slice(0, max || 3);
  }

  const T = { especialista, daLinha, saudacao, guia, contagem, falasDaTela, NIVEL };
  if (typeof module !== 'undefined' && module.exports) { module.exports = T; return; }
  raiz.CRMTurma = T;

  // ------------------------------------------------------------ tela
  const CRM = raiz.CRM, cfgT = (raiz.CRM_CONFIG || {}).turma;
  if (!CRM || !cfgT || !cfgT.principal) return;
  const { $, esc } = CRM;
  const E = () => CRM.estado;
  const pasta = cfgT.pasta || 'assets/turma/', v = cfgT.versao ? '?v=' + encodeURIComponent(cfgT.versao) : '';
  const dados = id => Object.assign({ nome: id, papel: '' }, (cfgT.mascotes || {})[id] || {});
  const img = (id, rosto) => pasta + id + (rosto ? '-rosto' : '') + '.webp' + v;
  const FALA_TELA = cfgT.falas || {};
  let resumo = {}, resumoEm = 0, itens = [], painelAberto = false, canto = { chave: '', id: '', mini: CRM.pref('turma-canto', '') === 'mini', balao: false, timer: null };
  const escondidos = () => CRM.pref('turma-esconder', '') === 'sim';

  CRM.turma = {
    img, dados, ativo: true,
    // rosto pequeno da linha do produto (Estoque, Compras, pedido): '' quando nenhuma regra bate
    iconeLinha(linha, descricao) {
      const id = daLinha(cfgT, linha, descricao);
      if (!id) return '';
      const d = dados(id);
      return '<img class="turma-linha" src="' + esc(img(id, true)) + '" alt="" title="' + esc(d.nome + (d.papel ? ' · ' + d.papel : '')) + '" loading="lazy">';
    },
    daLinha: (linha, descricao) => daLinha(cfgT, linha, descricao),
    atualizar,
    depoisRender
  };

  async function atualizar(forca) {
    const st = CRM.store();
    if (!st || !st.turmaResumo || !E().eu) return;
    if (!forca && Date.now() - resumoEm < 60000) return;
    resumoEm = Date.now();
    try { resumo = (await st.turmaResumo()) || {}; } catch (e) { /* o guia segue com o que já tem */ }
    CRM.render();
  }
  setInterval(() => { if (document.visibilityState === 'visible') atualizar(true); }, 5 * 60000);

  // sub-aba da tela aberta (a tela informa: Caixa → cobranca; Pedidos → separacao/nfe)
  const subDe = aba => { const tl = CRM.telas[aba]; try { return tl && tl.turmaSub ? tl.turmaSub() : null; } catch (e) { return null; } };

  function calcula(al) {
    const eu = E().eu || {};
    return guia({
      vendas: !CRM.foraDeVendas(), al, resumo,
      boletos: CRM.cobranca && !CRM.foraDeVendas() ? CRM.cobranca.paraFila().length : 0,
      gestor: CRM.ehGestor(), admin: CRM.ehAdmin(), comprador: CRM.ehComprador(), op: CRM.ehLogistica() || CRM.ehGestor(),
      fkn: CRM.lembreteFkn ? CRM.lembreteFkn() : [], recusas: CRM.recusasFkn ? CRM.recusasFkn() : [],
      vigiasParados: CRM.ehAdmin() ? (E().vigias || []).filter(c => raiz.CRMDados.situacaoVigia(c).estado === 'parado').map(c => c.nome) : [],
      papel: eu.papel
    });
  }

  // ---- o principal no topo
  function botaoPrincipal() {
    let b = $('#turmaBtn');
    if (!b) {
      const sino = $('#sino');
      if (!sino) return null;
      b = document.createElement('button');
      b.type = 'button'; b.id = 'turmaBtn'; b.className = 'turma-btn'; b.dataset.acao = 'turma-painel';
      sino.parentNode.insertBefore(b, sino);
      const p = document.createElement('div');
      p.id = 'turmaPainel'; p.className = 'turma-painel'; p.hidden = true; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', dados(cfgT.principal).nome);
      document.body.appendChild(p);
      document.addEventListener('click', ev => {
        if (!painelAberto) return;
        // o caminho do clique na hora (o botão pode ter sido redesenhado no meio do clique)
        if (ev.composedPath().some(el => el.id === 'turmaPainel' || el.id === 'turmaBtn' || el.id === 'turmaCanto')) return;
        fechaPainel();
      });
      document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && painelAberto) fechaPainel(); });
    }
    return b;
  }
  function fechaPainel() { painelAberto = false; const p = $('#turmaPainel'); if (p) p.hidden = true; }
  function itemHtml(x) {
    const m = x.mascote || especialista(cfgT, x.aba, x.sub);
    return '<button type="button" class="turma-item ' + x.nivel + '" data-acao="turma-ir" data-id="' + esc(x.aba + (x.sub ? ':' + x.sub : '')) + '">' +
      '<img src="' + esc(img(m, true)) + '" alt="">' + '<span>' + esc(x.texto) + '</span><b aria-hidden="true">›</b></button>';
  }
  // ---- a conversa com a IA (crm-assistente): fica montada uma vez (o que se digita não some quando a tela redesenha)
  const chat = { conversa: null, msgs: [], enviando: false, situacao: null, montado: false };
  const SUGESTOES = {
    inicio: ['O que tenho para fazer hoje?', 'Quanto vendi este mês?'],
    fila: ['Quem eu devo ligar hoje?', 'Quais clientes estão no ritmo de recompra?'],
    funil: ['Quais negócios estão parados?'], negocios: ['Quais negócios estão parados?'],
    empresas: ['O que o cliente … mais compra?'], pessoas: ['O que tenho para fazer hoje?'],
    pedidos: ['Quais pedidos estão bloqueados?', 'O que falta separar hoje?'],
    agenda: ['Quais tarefas estão atrasadas?'],
    relatorios: ['Quanto a equipe vendeu este mês, por vendedor(a)?', 'Quais produtos mais venderam no mês?'],
    compras: ['O que preciso comprar esta semana?', 'Quais produtos estão abaixo do mínimo e vendem bem?'],
    estoque: ['Qual a cobertura em dias dos produtos mais vendidos?', 'O que está abaixo do mínimo?'],
    caixa: ['Como fica o caixa nos próximos 7 dias?', 'Quais as maiores contas da semana?'],
    gestao: ['Como estão as vendas do mês comparadas ao mês passado?'],
    ofertas: ['Quais produtos parados valem uma oferta?']
  };
  const fmt = t => esc(String(t || '')).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').split('\n')
    .map(l => (/^\s*[-•]\s+/.test(l) ? '<li>' + l.replace(/^\s*[-•]\s+/, '') + '</li>' : l)).join('\n')
    .replace(/(<li>.*<\/li>\n?)+/g, m => '<ul>' + m.replace(/\n/g, '') + '</ul>').replace(/\n/g, '<br>');
  function quemResponde() { const aba = E().aba, id = especialista(cfgT, aba, subDe(aba)); return Object.assign({ id }, dados(id)); }
  function desenhaChat() {
    const el = $('#turmaChat');
    if (!el) return;
    const st = CRM.store(), q = quemResponde();
    if (!st || !st.assistente) { el.innerHTML = '<p class="dica">A conversa com a IA funciona com o sistema ligado ao banco.</p>'; return; }
    if (!chat.montado) {
      el.innerHTML = '<h4>Pergunte para a turma</h4><div class="turma-msgs"></div>' +
        '<form class="turma-pergunta"><textarea rows="2" maxlength="2000" aria-label="Sua pergunta"></textarea><button type="submit" class="btn">Perguntar</button></form>' +
        '<p class="turma-chat-rodape"><span data-turma-sit></span> <button type="button" class="link" data-acao="turma-nova">nova conversa</button></p>';
      const f = el.querySelector('form'), ta = el.querySelector('textarea');
      f.addEventListener('submit', ev => { ev.preventDefault(); perguntar(ta.value); });
      ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); perguntar(ta.value); } });
      chat.montado = true;
    }
    const ta = el.querySelector('textarea');
    ta.placeholder = 'Pergunte ao ' + q.nome + '… (Enter envia)';
    ta.disabled = chat.enviando || (chat.situacao && !chat.situacao.ligado);
    el.querySelector('button[type=submit]').disabled = ta.disabled;
    const sug = (SUGESTOES[E().aba] || SUGESTOES.inicio);
    el.querySelector('.turma-msgs').innerHTML = (chat.msgs.length ? chat.msgs.map(m => m.eu
      ? '<div class="turma-msg eu">' + esc(m.texto) + '</div>'
      : '<div class="turma-msg ia' + (m.erro ? ' erro' : '') + '"><img src="' + esc(img(m.mascote, true)) + '" alt=""><div><b>' + esc(dados(m.mascote).nome) + '</b>' + (m.pensando ? '<span class="turma-pensando">consultando o sistema…</span>' : fmt(m.texto)) + '</div></div>').join('')
      : '<div class="turma-sugestoes">' + sug.map(x => '<button type="button" class="turma-chip" data-acao="turma-sugestao" data-id="' + esc(x) + '">' + esc(x) + '</button>').join('') + '</div>');
    const s = chat.situacao;
    el.querySelector('[data-turma-sit]').textContent = !s ? '' : !s.ligado ? 'A IA ainda não está ligada (falta a chave nos segredos do Supabase).'
      : s.hoje + ' de ' + s.limite + ' perguntas hoje' + (s.custo_mes != null ? ' · uso do mês ≈ US$ ' + Number(s.custo_mes).toFixed(2) : '');
    const ms = el.querySelector('.turma-msgs'); ms.scrollTop = ms.scrollHeight;
  }
  async function situacaoChat() {
    const st = CRM.store();
    if (!st || !st.assistente || chat.situacao) return;
    try { chat.situacao = await st.assistente({ acao: 'situacao' }); } catch (e) { chat.situacao = null; }
    desenhaChat();
  }
  async function perguntar(texto) {
    const t = String(texto || '').trim(), st = CRM.store();
    if (!t || chat.enviando || !st || !st.assistente) return;
    const q = quemResponde();
    chat.msgs.push({ eu: true, texto: t });
    const resp = { mascote: q.id, pensando: true };
    chat.msgs.push(resp);
    chat.enviando = true; chat.verGuia = false;
    desenhaPainel();
    const ta = $('#turmaChat textarea'); if (ta) ta.value = '';
    desenhaChat();
    try {
      const r = await st.assistente({ pergunta: t, conversa_id: chat.conversa, tela: (CRM.ABAS.find(a => a[0] === E().aba) || [])[1] || E().aba, mascote: { id: q.id, nome: q.nome, papel: q.papel } });
      chat.conversa = r.conversa_id || chat.conversa;
      resp.texto = r.resposta;
      if (chat.situacao) chat.situacao.hoje = (chat.situacao.hoje || 0) + 1;
    } catch (e) { resp.texto = (e && e.message) || 'não consegui responder agora'; resp.erro = true; }
    resp.pensando = false; chat.enviando = false;
    desenhaChat();
    const t2 = $('#turmaChat textarea'); if (t2 && painelAberto) t2.focus();
  }

  function desenhaPainel() {
    const p = $('#turmaPainel'), b = $('#turmaBtn');
    if (!p || !b) return;
    const eu = E().eu || {}, d = dados(cfgT.principal);
    const aba = E().aba;
    const aqui = itens.filter(x => x.aba === aba), resto = itens.filter(x => x.aba !== aba);
    const primeiro = String(eu.nome || '').split(' ')[0];
    if (!p.querySelector('#turmaGuia')) {
      p.innerHTML = '<div id="turmaGuia"></div><div id="turmaChat" class="turma-chat"></div>' +
        '<div class="turma-rodape"><label><input type="checkbox" data-turma-esconder> mostrar o ajudante de cada tela</label></div>';
      const chk = p.querySelector('[data-turma-esconder]');
      chk.onchange = () => { CRM.gravaPref('turma-esconder', chk.checked ? '' : 'sim'); canto.chave = ''; canto.id = ''; CRM.render(); };
    }
    p.querySelector('[data-turma-esconder]').checked = !escondidos();
    const gh = '<div class="turma-cab"><img src="' + esc(img(cfgT.principal)) + '" alt=""><div><strong>' + esc(saudacao(new Date().getHours()) + (primeiro ? ', ' + primeiro : '') + '!') + '</strong>' +
      '<p>' + esc(itens.length ? 'Eu sou o ' + d.nome + '. Separei o que está esperando você:' : 'Eu sou o ' + d.nome + '. Por aqui está tudo em dia.') + '</p></div></div>' +
      // com conversa aberta, a lista de avisos recolhe numa linha (clicar abre de novo)
      (chat.msgs.length && !chat.verGuia ? (itens.length ? '<p class="turma-recolhido"><button type="button" class="link" data-acao="turma-ver-guia">ver os ' + itens.length + ' aviso(s) do dia</button></p>' : '')
        : (aqui.length ? '<h4>Nesta tela</h4>' + aqui.map(itemHtml).join('') : '') +
          (resto.length ? '<h4>' + (aqui.length ? 'No resto do sistema' : 'No sistema') + '</h4>' + resto.map(itemHtml).join('') : ''));
    const g = p.querySelector('#turmaGuia');
    if (g.dataset.html !== gh) { g.innerHTML = gh; g.dataset.html = gh; }
    desenhaChat();
    const n = contagem(itens);
    const bh = '<img src="' + esc(img(cfgT.principal, true)) + '" alt=""><span class="turma-nome">' + esc(d.nome) + '</span>' + (n ? '<span class="bolinha vermelha">' + n + '</span>' : '');
    if (b.dataset.html !== bh) { b.innerHTML = bh; b.dataset.html = bh; }
    b.title = d.nome + (d.papel ? ' · ' + d.papel : '') + ': ' + (n ? n + ' coisa(s) para fazer' : 'tudo em dia');
    b.setAttribute('aria-label', b.title);
    const r = b.getBoundingClientRect();
    p.style.setProperty('--turma-topo', Math.round(r.bottom + 8) + 'px');
    p.style.setProperty('--turma-dir', Math.max(8, Math.round(window.innerWidth - r.right - 60)) + 'px');
  }

  // ---- o especialista no canto
  function elCanto() {
    let c = $('#turmaCanto');
    if (!c) {
      c = document.createElement('div');
      c.id = 'turmaCanto'; c.className = 'turma-canto';
      document.body.appendChild(c);
    }
    return c;
  }
  function desenhaCanto(aba, sub) {
    const c = elCanto();
    if (escondidos()) { c.hidden = true; return; }
    const id = especialista(cfgT, aba, sub), d = dados(id);
    const falas = falasDaTela(itens, aba, sub, 3);
    const padrao = FALA_TELA[aba + ':' + sub] || FALA_TELA[aba] || 'Estou por aqui se precisar.';
    const chave = id + '|' + (canto.mini ? 1 : 0) + (canto.balao ? 1 : 0) + '|' + falas.map(x => x.id + x.texto).join('|');
    if (chave === canto.chave) return;
    const trocou = canto.id !== id;
    canto.chave = chave; canto.id = id;
    if (trocou && !canto.mini) canto.balao = true;
    c.hidden = false;
    c.className = 'turma-canto' + (canto.mini ? ' mini' : '') + (trocou ? ' entra' : '');
    c.innerHTML = '<div class="turma-balao"' + (canto.balao ? '' : ' hidden') + '>' +
      '<button type="button" class="turma-fecha" data-acao="turma-mini" aria-label="Encolher">×</button>' +
      '<strong>' + esc(d.nome) + (d.papel ? '<small>' + esc(d.papel) + '</small>' : '') + '</strong>' +
      (falas.length ? '<ul>' + falas.map(x => '<li class="' + x.nivel + '"><button type="button" class="link" data-acao="turma-ir" data-id="' + esc(x.aba + (x.sub ? ':' + x.sub : '')) + '">' + esc(x.texto) + '</button></li>').join('') + '</ul>'
        : '<p>' + esc(padrao) + '</p>') +
      (CRM.store() && CRM.store().assistente ? '<p class="turma-perguntar"><button type="button" class="link" data-acao="turma-perguntar">💬 Perguntar ao ' + esc(d.nome) + '</button></p>' : '') + '</div>' +
      '<button type="button" class="turma-boneco" data-acao="turma-balao" aria-label="' + esc(d.nome) + '">' +
      '<img src="' + esc(img(id, canto.mini)) + '" alt="">' + (canto.mini && falas.some(x => x.nivel !== 'info') ? '<span class="bolinha vermelha">' + falas.filter(x => x.nivel !== 'info').length + '</span>' : '') + '</button>';
    if (trocou && canto.balao) {
      clearTimeout(canto.timer);
      canto.timer = setTimeout(() => { canto.balao = false; canto.chave = ''; desenhaCanto(E().aba, subDe(E().aba)); }, 9000);
    }
    if (trocou) setTimeout(() => c.classList.remove('entra'), 700);
  }

  function depoisRender(aba, al) {
    if (!E().eu) return;
    itens = calcula(al);
    botaoPrincipal();
    desenhaPainel();
    desenhaCanto(aba, subDe(aba));
    if (!resumoEm) atualizar(true);
  }

  Object.assign(CRM.acoes, {
    'turma-painel': () => {
      painelAberto = !painelAberto;
      const p = $('#turmaPainel');
      if (p) { desenhaPainel(); p.hidden = !painelAberto; }
      if (painelAberto) { atualizar(false); situacaoChat(); }
    },
    'turma-sugestao': t => perguntar(t),
    'turma-ver-guia': () => { chat.verGuia = !chat.verGuia; desenhaPainel(); },
    'turma-nova': () => { chat.conversa = null; chat.msgs = []; desenhaChat(); const ta = $('#turmaChat textarea'); if (ta) ta.focus(); },
    // "Perguntar ao …" no balão do canto: abre o painel com o especialista da tela respondendo
    'turma-perguntar': () => {
      painelAberto = true;
      const p = $('#turmaPainel');
      if (p) { desenhaPainel(); p.hidden = false; }
      situacaoChat();
      setTimeout(() => { const ta = $('#turmaChat textarea'); if (ta) ta.focus(); }, 30);
    },
    'turma-ir': id => {
      const [aba, sub] = String(id).split(':');
      fechaPainel();
      CRM.irPara(aba);
      if (sub && aba === 'caixa' && CRM.acoes['cx-vista']) CRM.acoes['cx-vista'](sub);
      if (sub && aba === 'pedidos' && CRM.acoes['pd-ver']) CRM.acoes['pd-ver'](sub);
      if (sub && aba === 'estoque' && CRM.acoes['es-ver']) CRM.acoes['es-ver'](sub);
    },
    'turma-balao': () => {
      if (canto.mini) { canto.mini = false; CRM.gravaPref('turma-canto', ''); canto.balao = true; } else canto.balao = !canto.balao;
      clearTimeout(canto.timer);
      desenhaCanto(E().aba, subDe(E().aba));
    },
    'turma-mini': () => { canto.mini = true; canto.balao = false; CRM.gravaPref('turma-canto', 'mini'); canto.chave = ''; desenhaCanto(E().aba, subDe(E().aba)); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
