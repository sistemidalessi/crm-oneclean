/* Turma — os mascotes da instalação (17/10/2026, pedido do Anderson: "na Agilité a gente criou um mascote, o
   Agilitinho… queria trazer isso; tem os de linha de estoque, o do boleto de cobrança, o de compras… e um
   principal, um robozinho"). Só liga quando o config.js da instalação traz `turma` (nomes, imagens e em que tela
   cada um aparece são da instalação; o código é o mesmo para qualquer cliente).
   - O PRINCIPAL fica no topo, de corpo inteiro, com o nome e "N coisas pra fazer" (o formato do Agilitinho da Agilité;
     18/10, pedido do Anderson: os mascotes espalhados pela tela poluíam). Clicar abre o guia do dia (primeiro o da tela
     aberta) e a conversa com a IA. Os números vêm da RLS de cada um (crm_turma_resumo: SECURITY INVOKER), então a
     vendedora nunca vê número do Caixa.
   - O ESPECIALISTA da tela aberta (Estoque, Compras, Cobrança…) aparece só DENTRO do painel: o rosto e o que ele tem a
     dizer daquela área, e é quem responde a conversa.
   - O ANFITRIÃO recebe na tela de entrada; o da cobrança vai no resumo do boleto.
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
  const saudacao = hora => (hora < 5 ? 'Boa noite' : hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite');

  // O guia do dia: [{ id, nivel, texto, aba, sub, mascote }], do mais urgente para o menos.
  // c = { papel, vendas, al, alMeu, alEquipe, resumo, boletos, fkn: [{arquivo}], recusas, vigiasParados, admin, gestor, op, comprador }
  // 20/10/2026 (Anderson: "o Clean fala 3 coisas e quando eu abro, cadê as 3? … tem que funcionar como uma agenda"):
  // tarefas e leads são os DE QUEM ESTÁ LOGADO (alMeu); o da equipe vai para a gestora só como acompanhamento.
  function guia(c) {
    const it = [], poe = (id, nivel, texto, aba, sub, mascote) => it.push({ id, nivel, texto, aba, sub: sub || null, mascote: mascote || null });
    const al = c.al || {}, meu = c.alMeu || al, r = c.resumo || {}, n = a => (a || []).length;
    if (c.vendas) {
      if (c.boletos) poe('boletos', 'urgente', plural(c.boletos, 'cliente com boleto atualizado para mandar', 'clientes com boleto atualizado para mandar'), 'fila', null, 'cobranca');
      if (n(meu.atrasadas)) poe('atrasadas', 'urgente', plural(n(meu.atrasadas), 'tarefa sua atrasada', 'tarefas suas atrasadas'), 'agenda', 'minhas');
      if (n(meu.deHoje)) poe('hoje', 'atencao', plural(n(meu.deHoje), 'tarefa sua para hoje', 'tarefas suas para hoje'), 'agenda', 'minhas');
      if (n(meu.leadsSemAtendimento)) poe('leads', 'atencao', plural(n(meu.leadsSemAtendimento), 'lead seu sem atendimento', 'leads seus sem atendimento'), 'fila');
      const eq = c.gestor ? c.alEquipe : null;
      if (eq && (n(eq.atrasadas) || n(eq.deHoje))) poe('eq-tarefas', 'info', 'Equipe: ' + [n(eq.atrasadas) ? plural(n(eq.atrasadas), 'tarefa atrasada', 'tarefas atrasadas') : '',
        n(eq.deHoje) ? plural(n(eq.deHoje), 'para hoje', 'para hoje') : ''].filter(Boolean).join(' e '), 'agenda', 'equipe');
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
    const su = r.nfe_sem_uso || {};
    if (su.n) {
      const dias = su.prazo ? Math.round((new Date(su.prazo + 'T12:00:00') - new Date((c.hoje || new Date().toISOString().slice(0, 10)) + 'T12:00:00')) / 864e5) : null;
      poe('nfe-sem-uso', dias != null && dias <= 5 ? 'urgente' : 'atencao', plural(su.n, 'número da NF-e sem uso', 'números da NF-e sem uso') +
        ': inutilizar' + (su.prazo ? ' até ' + su.prazo.slice(8, 10) + '/' + su.prazo.slice(5, 7) : ''), 'pedidos', 'nfe');
    }
    if (c.admin || c.comprador) {
      (c.recusas || []).forEach((x, i) => poe('fkn-recusa-' + i, 'urgente', 'Relatório do FKN recusado: puxe de novo com as opções certas', 'compras'));
      (c.fkn || []).forEach((x, i) => poe('fkn-' + i, 'atencao', 'Puxar do FKN: ' + x.arquivo, 'compras'));
      const es = r.estoque || {};
      if (es.sem_explicacao) poe('estoque-dif', 'atencao', plural(es.sem_explicacao, 'diferença de estoque sem explicação', 'diferenças de estoque sem explicação'), 'estoque', 'conferencia');
      if (es.abaixo_minimo) poe('estoque-min', 'info', plural(es.abaixo_minimo, 'produto abaixo do mínimo', 'produtos abaixo do mínimo'), 'compras');
      const cs = r.compras_sefaz || {};
      if (cs.desconhecidos) poe('dfe-desc', 'urgente', plural(cs.desconhecidos, 'fornecedor que nunca vendeu para a empresa apareceu nas notas da Sefaz', 'fornecedores que nunca venderam para a empresa apareceram nas notas da Sefaz'), 'estoque', 'compras', 'auditoria');
      if (cs.prazo) poe('dfe-prazo', 'urgente', plural(cs.prazo, 'nota de compra perto do prazo da resposta à Sefaz', 'notas de compra perto do prazo da resposta à Sefaz'), 'estoque', 'compras', 'auditoria');
      const cg = r.compras_galpao || {};
      if (cg.chegaram) poe('compras-chegou', 'atencao', plural(cg.chegaram, 'nota de compra chegou no galpão: dar entrada', 'notas de compra chegaram no galpão: dar entrada'), 'estoque', 'compras');
    }
    if (c.analise) {
      if (c.analise.pronta) poe('ia-compras', 'atencao', 'Análise de compras de hoje pronta: o que pedir e de quem', 'compras', null, 'compras-setor-interno');
      else if (c.analise.gerando) poe('ia-compras', 'info', 'Preparando a análise de compras de hoje…', 'compras', null, 'compras-setor-interno');
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
  // Selo do principal: só o que pede ação (urgente + atenção) — exatamente a lista "Pra fazer" do painel;
  // os informativos ficam em "Para acompanhar" e não entram na conta.
  const praFazer = itens => (itens || []).filter(x => x.nivel !== 'info');
  const contagem = itens => praFazer(itens).length;
  // a ordem da agenda: urgente antes; no mesmo nível, o da tela aberta primeiro
  const ordemAgenda = (itens, aba) => (itens || []).map((x, i) => [x, i])
    .sort((a, b) => NIVEL[a[0].nivel] - NIVEL[b[0].nivel] || (b[0].aba === aba) - (a[0].aba === aba) || a[1] - b[1]).map(x => x[0]);
  // O que o especialista fala na tela: os itens do guia daquela tela (a sub-aba primeiro) ou a fala de "tudo em dia".
  function falasDaTela(itens, aba, sub, max) {
    const daTela = (itens || []).filter(x => x.aba === aba);
    daTela.sort((a, b) => (sub ? (b.sub === sub) - (a.sub === sub) : 0) || NIVEL[a.nivel] - NIVEL[b.nivel]);
    return daTela.slice(0, max || 3);
  }

  // Marcas de quem está logado nos avisos (19/10, pedido do Anderson: "se tem alguma coisa lá é porque eu ainda não
  // olhei"): "resolvido" some até aparecer coisa nova (o número do aviso subir ou o texto mudar); "amanhã" volta no dia
  // seguinte; sem marca fica pendente. completo = os dados já carregaram: só então a marca de aviso que sumiu é apagada
  // (assim, quando o aviso voltar outro dia, aparece). vencidas: ids das marcas que já não valem (a tela apaga).
  const numDe = t => { const m = String(t || '').match(/\d+/); return m ? Number(m[0]) : null; };
  function aplicaMarcas(itens, marcas, hoje, completo) {
    const m = new Map((marcas || []).map(x => [x.id, x])), ids = new Set(), visiveis = [], marcados = [], vencidas = [];
    (itens || []).forEach(x => {
      ids.add(x.id);
      const k = m.get(x.id);
      let esconde = false;
      if (k && k.tipo === 'amanha') esconde = !!k.ate && hoje < k.ate;
      else if (k && k.tipo === 'resolvido') { const a = numDe(k.texto), b = numDe(x.texto); esconde = a != null && b != null ? b <= a : k.texto === x.texto; }
      if (k && !esconde) vencidas.push(x.id);
      if (esconde) marcados.push(Object.assign({ marca: k }, x)); else visiveis.push(x);
    });
    if (completo) m.forEach((k, id) => { if (!ids.has(id)) vencidas.push(id); });
    return { visiveis, marcados, vencidas };
  }

  const T = { especialista, saudacao, guia, contagem, praFazer, ordemAgenda, falasDaTela, aplicaMarcas, numDe, NIVEL };
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
  let resumo = {}, resumoEm = 0, resumoOk = false, itens = [], painelAberto = false;
  let marcas = [], marcasOk = false, brutos = [], marcados = [], verMarcados = false;
  // Análise de compras do dia (comprador sênior, 19/10/2026): o primeiro administrador ou comprador que abre o CRM no
  // dia faz a IA preparar (uma vez por dia, guardada no banco); o Clean avisa e o painel do comprador mostra.
  let analise = null, analiseDia = '', gerandoAnalise = false;
  const fazAnalise = () => (CRM.ehAdmin() || CRM.ehComprador()) && CRM.store().analiseCompras;
  async function gerarAnalise(refazer) {
    if (gerandoAnalise || !fazAnalise()) return analise;
    gerandoAnalise = true; CRM.render();
    try { analise = await CRM.store().analiseCompras(refazer); analiseDia = CRM.hoje(); }
    catch (e) {
      // a análise leva perto de 1 minuto: o navegador pode desistir de esperar antes de o servidor terminar e gravar
      // (19/10/2026, 1º uso real). Então procura a gravada algumas vezes antes de dar por perdida.
      for (let i = 0; i < 6 && !(analise && analise.texto); i++) {
        await new Promise(r => setTimeout(r, 20000));
        try { analise = await CRM.store().analiseHoje(CRM.hoje()); } catch (e2) { /* tenta de novo */ }
      }
      if (!(analise && analise.texto) && refazer) CRM.falhou(e);
    }
    gerandoAnalise = false; CRM.render();
    return analise;
  }
  CRM.gerandoAnalise = () => gerandoAnalise;

  // perguntar: abre o painel e manda a pergunta (botões prontos das telas, ex.: "Pedir a análise de compras de hoje")
  CRM.turma = { img, dados, ativo: true, atualizar, depoisRender, perguntar: (t, m) => setTimeout(() => { abrePainel(); perguntar(t, m); }, 0), fmt: t => fmt(t), analise: () => analise, gerarAnalise };   // depois do clique (senão o "clique fora" fecha o painel)

  async function atualizar(forca) {
    const st = CRM.store();
    if (!st || !st.turmaResumo || !E().eu) return;
    if (!forca && Date.now() - resumoEm < 60000) return;
    resumoEm = Date.now();
    try { resumo = (await st.turmaResumo()) || {}; resumoOk = true; } catch (e) { /* o guia segue com o que já tem */ }
    if (st.turmaMarcas) try { marcas = (await st.turmaMarcas()) || []; marcasOk = true; } catch (e) { /* sem as marcas, mostra tudo */ }
    if (fazAnalise() && analiseDia !== CRM.hoje()) {
      try { analise = await st.analiseHoje(CRM.hoje()); analiseDia = CRM.hoje(); } catch (e) { analise = null; }
      // ninguém fez ainda hoje: prepara em segundo plano (uma vez por dia neste navegador)
      let ja = ''; try { ja = localStorage.getItem('crm_analise_tentada') || ''; } catch (e) { /* ok */ }
      if (!analise && st.modo === 'supabase' && ja !== CRM.hoje()) { try { localStorage.setItem('crm_analise_tentada', CRM.hoje()); } catch (e) { /* ok */ } gerarAnalise(false); }
    }
    CRM.render();
  }
  setInterval(() => { if (document.visibilityState === 'visible') atualizar(true); }, 5 * 60000);

  // sub-aba da tela aberta (a tela informa: Caixa → cobranca; Pedidos → separacao/nfe)
  const subDe = aba => { const tl = CRM.telas[aba]; try { return tl && tl.turmaSub ? tl.turmaSub() : null; } catch (e) { return null; } };

  function calcula(al) {
    brutos = guiaBruto(al);
    const r = aplicaMarcas(brutos, marcas, CRM.hoje(), resumoOk && marcasOk && !!E().D);
    marcados = r.marcados;
    if (r.vencidas.length) {   // apaga já da memória (não repete o pedido a cada desenho) e depois no banco
      marcas = marcas.filter(k => r.vencidas.indexOf(k.id) === -1);
      const st = CRM.store(); if (st.turmaDesmarcar) st.turmaDesmarcar(r.vencidas).catch(() => {});
    }
    return r.visiveis;
  }
  function guiaBruto(al) {
    const eu = E().eu || {};
    const D = E().D, R = raiz.CRMRegras;
    const meu = D && E().ix ? R.alertas(D, E().ix, E().cfg, CRM.hoje(), CRM.meuId()) : al;
    const equipe = CRM.ehGestor() && D && E().ix ? R.alertas(D, E().ix, E().cfg, CRM.hoje(), null) : null;
    return guia({
      vendas: !CRM.foraDeVendas(), al, alMeu: meu, alEquipe: equipe, resumo,
      boletos: CRM.cobranca && !CRM.foraDeVendas() ? CRM.cobranca.paraFila().length : 0,
      gestor: CRM.ehGestor(), admin: CRM.ehAdmin(), comprador: CRM.ehComprador(), op: CRM.ehLogistica() || CRM.ehGestor(),
      fkn: CRM.lembreteFkn ? CRM.lembreteFkn() : [], recusas: CRM.recusasFkn ? CRM.recusasFkn() : [],
      vigiasParados: CRM.ehAdmin() ? (E().vigias || []).filter(c => raiz.CRMDados.situacaoVigia(c).estado === 'parado').map(c => c.nome) : [],
      papel: eu.papel, hoje: CRM.hoje(),
      analise: fazAnalise() ? { pronta: !!(analise && analise.texto), gerando: gerandoAnalise } : null
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
        if (ev.composedPath().some(el => el.id === 'turmaPainel' || el.id === 'turmaBtn' || (el.classList && el.classList.contains('turma-tela')))) return;
        fechaPainel();
      });
      document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && painelAberto) fechaPainel(); });
    }
    return b;
  }
  function abrePainel() {
    botaoPrincipal();
    const p = $('#turmaPainel');
    if (!p) return;
    painelAberto = true; desenhaPainel(); p.hidden = false;
    situacaoChat();
  }
  function fechaPainel() { painelAberto = false; const p = $('#turmaPainel'); if (p) p.hidden = true; }
  function itemHtml(x, aba) {
    const m = x.mascote || especialista(cfgT, x.aba, x.sub);
    const quando = x.marca ? (x.marca.tipo === 'amanha' ? 'volta amanhã' : 'resolvido') : '';
    return '<div class="turma-linha' + (x.marca ? ' marcado' : '') + '"><button type="button" class="turma-item ' + x.nivel + '" data-acao="turma-ir" data-id="' + esc(x.aba + (x.sub ? ':' + x.sub : '')) + '">' +
      '<img src="' + esc(img(m, true)) + '" alt="">' + '<span>' + esc(x.texto) + (quando ? ' <small>(' + quando + ')</small>' : '') + (aba && x.aba === aba && !x.marca ? ' <small class="turma-aqui">nesta tela</small>' : '') + '</span><b aria-hidden="true">›</b></button>' +
      '<span class="turma-marcar">' + (x.marca
        ? '<button type="button" class="mini" data-acao="turma-desmarcar" data-id="' + esc(x.id) + '" title="Voltar a mostrar como pendente">↺</button>'
        : '<button type="button" class="mini" data-acao="turma-marcar" data-id="resolvido|' + esc(x.id) + '" title="Resolvido: some até aparecer coisa nova">✓</button>' +
          '<button type="button" class="mini" data-acao="turma-marcar" data-id="amanha|' + esc(x.id) + '" title="Lembrar amanhã">⏰</button>') + '</span></div>';
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
      el.innerHTML = '<h4>Pergunte para a turma</h4><p class="turma-quem"></p><div class="turma-msgs"></div>' +
        '<form class="turma-pergunta"><textarea rows="2" maxlength="2000" aria-label="Sua pergunta"></textarea><button type="submit" class="btn">Perguntar</button></form>' +
        '<p class="turma-chat-rodape"><span data-turma-sit></span> <button type="button" class="link" data-acao="turma-nova">nova conversa</button></p>';
      const f = el.querySelector('form'), ta = el.querySelector('textarea');
      f.addEventListener('submit', ev => { ev.preventDefault(); perguntar(ta.value); });
      ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); perguntar(ta.value); } });
      chat.montado = true;
    }
    const ta = el.querySelector('textarea');
    const quem = el.querySelector('.turma-quem');
    // o especialista da tela aberta responde aqui (rosto, nome e a área dele)
    if (quem) quem.innerHTML = q.id && q.id !== cfgT.principal ? '<img src="' + esc(img(q.id, true)) + '" alt=""> Nesta tela quem responde é <strong>' + esc(q.nome) + '</strong>' + (q.papel ? ' <small>(' + esc(q.papel) + ')</small>' : '') : '';
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
  // mascoteId (24/10/2026, Gerente de Vendas): quem responde, quando o botão da tela pede um especialista
  async function perguntar(texto, mascoteId) {
    const t = String(texto || '').trim(), st = CRM.store();
    if (!t || chat.enviando || !st || !st.assistente) return;
    const q = mascoteId && (cfgT.mascotes || {})[mascoteId] ? Object.assign({ id: mascoteId }, dados(mascoteId)) : quemResponde();
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
    const aba = E().aba, sub = subDe(aba);
    // 20/10/2026 (Anderson: "o Clean está falando 3 coisas… quando eu abro, cadê as 3?"): o painel é uma agenda.
    // "Pra fazer (N)" = exatamente o N do topo (urgente e atenção), a tela aberta primeiro; "Para acompanhar" =
    // os informativos, que não entram na conta. O especialista da tela fica na conversa (é quem responde).
    const fazer = ordemAgenda(praFazer(itens), aba), acompanhar = ordemAgenda(itens.filter(x => x.nivel === 'info'), aba);
    const primeiro = String(eu.nome || '').split(' ')[0];
    if (!p.querySelector('#turmaGuia')) p.innerHTML = '<div id="turmaGuia"></div><div id="turmaChat" class="turma-chat"></div>';
    const gh = '<div class="turma-cab"><img src="' + esc(img(cfgT.principal)) + '" alt=""><div><strong>' + esc(saudacao(Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false })) % 24) + (primeiro ? ', ' + primeiro : '') + '!') + '</strong>' +
      '<p>' + esc(fazer.length ? 'Eu sou o ' + d.nome + '. Você tem ' + (fazer.length === 1 ? '1 coisa' : fazer.length + ' coisas') + ' pra fazer:' : 'Eu sou o ' + d.nome + '. Nada pendente pra fazer agora.') + '</p></div></div>' +
      // com conversa aberta, a lista de avisos recolhe numa linha (clicar abre de novo)
      (chat.msgs.length && !chat.verGuia ? (itens.length ? '<p class="turma-recolhido"><button type="button" class="link" data-acao="turma-ver-guia">ver a agenda (' + fazer.length + ' pra fazer)</button></p>' : '')
        : (fazer.length ? '<h4>Pra fazer <span class="turma-n">' + fazer.length + '</span></h4>' + fazer.map(x => itemHtml(x, aba)).join('') : '') +
          (acompanhar.length ? '<h4 class="turma-h-info">Para acompanhar <small>não entram na conta</small></h4>' + acompanhar.map(x => itemHtml(x, aba)).join('') : '') +
          (itens.length ? '<p class="turma-dica">✓ resolvido · ⏰ lembrar amanhã · sem marcar, fica pendente</p>' : '') +
          (marcados.length ? '<p class="turma-recolhido"><button type="button" class="link" data-acao="turma-ver-marcados">' + (verMarcados ? 'esconder' : 'ver') + ' os ' + marcados.length + ' já vistos (resolvidos ou para amanhã)</button></p>' +
            (verMarcados ? marcados.map(x => itemHtml(x)).join('') : '') : ''));
    const g = p.querySelector('#turmaGuia');
    if (g.dataset.html !== gh) { g.innerHTML = gh; g.dataset.html = gh; }
    desenhaChat();
    // o principal no topo, de corpo inteiro, com o nome e quantas coisas há para fazer (como o Agilitinho da Agilité)
    const n = contagem(itens);
    const bh = '<span class="turma-corpo"><img src="' + esc(img(cfgT.principal)) + '" alt="">' + (n ? '<span class="bolinha vermelha">' + n + '</span>' : '') + '</span>' +
      '<span class="turma-txt"><strong>' + esc(d.nome) + '</strong><small class="' + (n ? 'tem' : '') + '">' + esc(n ? n + (n === 1 ? ' coisa pra fazer' : ' coisas pra fazer') : 'tudo em dia') + '</small></span>';
    if (b.dataset.html !== bh) { b.innerHTML = bh; b.dataset.html = bh; }
    b.title = d.nome + (d.papel ? ' · ' + d.papel : '') + ': clique para ver o dia e conversar';
    b.setAttribute('aria-label', d.nome + ': ' + (n ? n + ' coisa(s) para fazer' : 'tudo em dia'));
    const r = b.getBoundingClientRect();
    // com a página rolada o Clean sobe para fora da tela: o painel não acompanha (abria acima da tela, 23/10/2026)
    p.style.setProperty('--turma-topo', Math.max(12, Math.round(r.bottom + 8)) + 'px');
    p.style.setProperty('--turma-dir', Math.max(8, Math.round(window.innerWidth - r.right - 60)) + 'px');
  }

  // ---- o especialista no alto da tela (pedido do Anderson, 18/10): um só, ao lado do título, do tamanho do Clean;
  // clicar abre o painel (onde ele mesmo aparece e responde). Nas telas do principal (Início, Relatórios…) não repete.
  function especialistaNaTela(aba) {
    const c = $('#conteudo');
    if (!c || c.querySelector('.turma-tela')) return;
    const h1 = c.querySelector('.cabecalho h1') || c.querySelector('h1');
    if (!h1) return;
    const sub = subDe(aba), esp = especialista(cfgT, aba, sub);
    if (!esp || esp === cfgT.principal) return;
    const de = dados(esp), n = contagem(falasDaTela(itens, aba, sub, 20)), fala = FALA_TELA[aba + ':' + sub] || FALA_TELA[aba] || '';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'turma-btn turma-tela'; b.dataset.acao = 'turma-painel';
    b.title = de.nome + (de.papel ? ' · ' + de.papel : '') + (!n && fala ? ': ' + fala : '') + ' (clique para ver e conversar)';
    b.innerHTML = '<span class="turma-corpo"><img src="' + esc(img(esp)) + '" alt=""></span>' +
      '<span class="turma-txt"><strong>' + esc(de.nome) + '</strong><small class="' + (n ? 'tem' : '') + '">' + esc(n ? n + (n === 1 ? ' coisa pra fazer aqui' : ' coisas pra fazer aqui') : de.papel) + '</small></span>';
    // título solto no cabeçalho (<h1> direto): entra antes dele. Bloco do título (<div><h1>…<p class="sub">): entra no
    // bloco, à esquerda do título e da linha de baixo (grade, em crm.css).
    const par = h1.parentElement;
    if (!par.classList.contains('cabecalho') && par !== c) par.classList.add('com-turma');
    par.insertBefore(b, h1);
  }

  function depoisRender(aba, al) {
    if (!E().eu) return;
    itens = calcula(al);
    botaoPrincipal();
    desenhaPainel();
    especialistaNaTela(aba);
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
    'turma-ver-marcados': () => { verMarcados = !verMarcados; desenhaPainel(); },
    'turma-marcar': v => {
      const i = String(v).indexOf('|'), tipo = String(v).slice(0, i), id = String(v).slice(i + 1);
      const x = brutos.find(b => b.id === id);
      if (!x) return;
      const m = { id, tipo, texto: x.texto, n: numDe(x.texto), ate: tipo === 'amanha' ? raiz.CRMRegras.somaDias(CRM.hoje(), 1) : null };
      marcas = marcas.filter(k => k.id !== id).concat(m);
      CRM.render();
      CRM.store().turmaMarcar(m).catch(e => CRM.falhou(e));
    },
    'turma-desmarcar': id => {
      marcas = marcas.filter(k => k.id !== id);
      CRM.render();
      CRM.store().turmaDesmarcar([id]).catch(e => CRM.falhou(e));
    },
    'turma-nova': () => { chat.conversa = null; chat.msgs = []; desenhaChat(); const ta = $('#turmaChat textarea'); if (ta) ta.focus(); },
    'turma-ir': id => {
      const [aba, sub] = String(id).split(':');
      fechaPainel();
      // Atividades: as tarefas de quem clicou (ou a equipe toda), na semana de hoje
      if (aba === 'agenda') CRM.irPara(aba, { responsavel: sub === 'minhas' ? CRM.meuId() : '', semana: raiz.CRMRegras.inicioSemana(CRM.hoje()) });
      else CRM.irPara(aba);
      if (sub && aba === 'caixa' && CRM.acoes['cx-vista']) CRM.acoes['cx-vista'](sub);
      if (sub && aba === 'pedidos' && CRM.acoes['pd-ver']) CRM.acoes['pd-ver'](sub);
      if (sub && aba === 'estoque' && CRM.acoes['es-ver']) CRM.acoes['es-ver'](sub);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
