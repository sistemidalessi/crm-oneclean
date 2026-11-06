/* CRM Sistemi Dalessi — Leads sugeridos (01/11/2026, pedido do Anderson a partir de um reel: "o Claude acha cliente
   pra você"; simulação aprovada no mesmo dia). Toda manhã de dia útil, cada vendedor(a) recebe 5 empresas que ainda não
   estão no CRM, parecidas com os clientes que ela atende e perto de onde o caminhão já entrega (base aberta de CNPJ da
   Receita, crm_prospec_*), com o contato que a IA achou, o que os clientes parecidos mais compram e uma mensagem pronta
   para o WhatsApp DELA (nunca o da empresa: lead frio não fala com o número dos boletos). "Virar lead" abre o Novo lead
   já preenchido (a busca da Receita e da Sefaz roda sozinha). A gestão escolhe segmentos, cidades, quantidade e quem
   recebe, e vê o resultado. Parte pura no começo (testes/leads.test.js). */
(function (raiz) {
  'use strict';
  const MOTIVOS = ['Já tem fornecedor', 'Não atende / sem retorno', 'Pequena demais', 'Compra pela administradora', 'Fechou / não existe', 'Não é perfil'];
  const CIDADES = ['SAO BERNARDO DO CAMPO', 'SANTO ANDRE', 'SAO CAETANO DO SUL', 'DIADEMA', 'MAUA', 'RIBEIRAO PIRES', 'RIO GRANDE DA SERRA',
    'SAO PAULO', 'GUARULHOS', 'OSASCO', 'FERRAZ DE VASCONCELOS'];
  const NOME_CIDADE = { 'SAO BERNARDO DO CAMPO': 'São Bernardo do Campo', 'SANTO ANDRE': 'Santo André', 'SAO CAETANO DO SUL': 'São Caetano do Sul',
    DIADEMA: 'Diadema', MAUA: 'Mauá', 'RIBEIRAO PIRES': 'Ribeirão Pires', 'RIO GRANDE DA SERRA': 'Rio Grande da Serra', 'SAO PAULO': 'São Paulo',
    GUARULHOS: 'Guarulhos', OSASCO: 'Osasco', 'FERRAZ DE VASCONCELOS': 'Ferraz de Vasconcelos' };
  const cidadeBonita = c => NOME_CIDADE[c] || String(c || '').toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase());
  const titulo = s => String(s || '').toLowerCase().replace(/(^|[\s/(-])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(De|Da|Do|Das|Dos|E|Em)\b/g, m => m.toLowerCase()).replace(/\b(Ltda|Me|Epp|S\/a|Sa|Eireli)\b/gi, m => m.toUpperCase());

  // telefone só com números (DDD + número) → "(11) 4000-0001" / "(11) 94000-0001"
  function foneBR(d) {
    const s = String(d || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (s.length === 11) return '(' + s.slice(0, 2) + ') ' + s.slice(2, 7) + '-' + s.slice(7);
    if (s.length === 10) return '(' + s.slice(0, 2) + ') ' + s.slice(2, 6) + '-' + s.slice(6);
    return s || '';
  }
  const celular = d => { const s = String(d || '').replace(/\D/g, '').replace(/^55(?=\d{11}$)/, ''); return s.length === 11 && s[2] === '9' ? s : null; };

  // Os contatos de uma sugestão, na ordem de uso: primeiro o que a IA achou publicado pela empresa, depois o da Receita
  // (marcado: muitas vezes é do contador). → [{ tipo: 'telefone'|'whatsapp'|'email'|'site'|'instagram', valor, fonte, alerta }]
  function contatos(l) {
    const c = l.contato || {}, out = [], ja = new Set();
    const add = (tipo, valor, fonte, alerta) => { if (!valor) return; const k = tipo === 'email' ? String(valor).toLowerCase() : String(valor).replace(/\D/g, '') || valor; if (ja.has(tipo + k)) return; ja.add(tipo + k); out.push({ tipo, valor, fonte, alerta: !!alerta }); };
    add('whatsapp', c.whatsapp, c.fonte_telefone || 'achado pela IA');
    add('telefone', c.telefone, c.fonte_telefone || 'achado pela IA');
    add('telefone', l.tel1, 'Receita · pode ser do contador', true);
    add('telefone', l.tel2, 'Receita · pode ser do contador', true);
    add('email', c.email, c.fonte_email || 'achado pela IA');
    add('email', l.email, 'Receita · pode ser do contador', true);
    add('site', c.site, 'achado pela IA');
    add('instagram', c.instagram, 'achado pela IA');
    return out;
  }

  // Mensagem pronta para o WhatsApp da vendedora (ou roteiro da ligação), pelo segmento.
  function mensagem(l, vendedora, hora, empresa) {
    const nome = String(vendedora || '').trim().split(/\s+/)[0] || 'equipe';
    const oi = (hora == null ? 9 : hora) < 12 ? 'Bom dia!' : 'Boa tarde!';
    const cid = l.cidade === 'SAO BERNARDO DO CAMPO' ? 'aqui de São Bernardo' : 'de São Bernardo, com entrega em ' + cidadeBonita(l.cidade);
    const eu = oi + ' Meu nome é ' + nome + ', sou da ' + (empresa || 'OneClean') + ', distribuidora de produtos de limpeza e descartáveis ' + cid + '. ';
    const seg = {
      'Condomínio': 'Atendemos vários condomínios da região, com entrega no nosso caminhão. Posso mandar uma cotação dos itens que o condomínio mais usa, como cloro, aromatizante e sacos de lixo? Com quem falo sobre as compras?',
      'Serviços': 'Atendemos empresas de limpeza e facilities do ABC com material para os postos: sacos de lixo, água sanitária, sabonete e papel, com entrega no nosso caminhão. Posso mandar a tabela dos itens que vocês mais usam nos contratos?',
      'Escola': 'Fornecemos material de limpeza e higiene para escolas e creches da região: sabonete líquido, papel, água sanitária, com entrega no nosso caminhão. Posso mandar uma cotação? Com quem falo sobre as compras da escola?',
      'Saúde': 'Fornecemos material de limpeza, higiene e descartáveis para clínicas e consultórios da região: papel toalha, sabonete, álcool 70%, luvas. Posso mandar uma cotação? Com quem falo sobre as compras?',
      'Indústria': 'Fornecemos material de limpeza, descartáveis e EPIs para indústrias do ABC, com entrega no nosso caminhão. Posso mandar uma cotação para a limpeza, os banheiros e o refeitório? Com quem falo sobre as compras?'
    }[l.segmento] || 'Posso mandar uma cotação de material de limpeza e descartáveis? Com quem falo sobre as compras?';
    return eu + seg;
  }

  // Nome para mostrar: fantasia (se houver) e a razão social
  const nomeDe = l => titulo(l.fantasia || l.razao || l.cnpj);
  const cnpjBR = c => (/^[0-9A-Z]{14}$/.test(String(c || '')) ? c.slice(0, 2) + '.' + c.slice(2, 5) + '.' + c.slice(5, 8) + '/' + c.slice(8, 12) + '-' + c.slice(12) : c || '');
  function idade(abertura, hoje) {
    if (!abertura) return '';
    const d = Math.round((Date.parse(hoje) - Date.parse(abertura)) / 86400000);
    if (d < 60) return 'aberta há ' + d + ' dias';
    if (d < 730) return 'aberta há ' + Math.floor(d / 30) + ' meses';
    return 'aberta há ' + Math.floor(d / 365) + ' anos';
  }

  const L = { MOTIVOS, CIDADES, cidadeBonita, titulo, foneBR, celular, contatos, mensagem, nomeDe, cnpjBR, idade };
  raiz.CRMLeads = L;
  if (typeof module !== 'undefined') module.exports = L;

  // ------------------------------------------------------------ tela
  const CRM = raiz.CRM;
  if (!CRM || !CRM.telas) return;
  const { esc } = CRM;
  const E = () => CRM.estado;
  let dados = null, carregando = false, vendSel = null, aba = 'lista', gestao = null, parecidos = null, situacao = null;
  const recarrega = () => { dados = null; gestao = null; CRM.render(); };
  const vendedores = () => CRM.usuariosAtivos().filter(u => u.papel === 'vendedor' || u.papel === 'gestor');
  const cfgP = () => (E().cfg && E().cfg.prospeccao) || {};

  async function carrega() {
    if (carregando) return;
    carregando = true;
    const st = CRM.store();
    try {
      const [l, p] = await Promise.all([st.prospecMinhas(vendSel), parecidos ? parecidos : st.prospecParecidos()]);
      parecidos = p || [];
      dados = l || [];
    } catch (e) { dados = []; CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }
  async function carregaGestao() {
    if (carregando) return;
    carregando = true;
    const st = CRM.store();
    const desde = new Date(Date.now() - 27 * 86400000).toISOString().slice(0, 10);
    try {
      const [res, base, sit] = await Promise.all([st.prospecResultado(desde), st.prospecBaseResumo(), CRM.ehAdmin() ? st.prospeccao({ acao: 'situacao' }).catch(() => null) : null]);
      gestao = { res: res || [], base: base || [], desde };
      situacao = sit;
    } catch (e) { gestao = { res: [], base: [], desde }; CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }

  const icone = { whatsapp: '🟢', telefone: '☎', email: '✉', site: '🌐', instagram: '◎' };
  function cartao(l) {
    const aberta = l.situacao === 'nova' || l.situacao === 'amanha';
    const vend = CRM.nomeUsuario(l.vendedor_id);
    const msg = mensagem(l, vend, new Date().getHours(), CRM.nomeInstalacao());
    const cs = contatos(l);
    const zap = cs.map(x => celular(x.valor)).find(Boolean);
    const comp = (parecidos || []).filter(p => p.segmento === l.segmento);
    const deOntem = aberta && l.dia < CRM.hoje();
    const c = l.contato || {};
    const estado = !aberta ? (l.situacao === 'lead' ? CRM.selo('Virou lead', 'verde') + (l.empresa_id ? ' <button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(l.empresa_id) + '">abrir a ficha</button>' : '')
      : l.situacao === 'descartada' ? CRM.selo('Descartada: ' + (l.motivo_descarte || ''), 'vermelho') : CRM.selo('Expirou', 'cinza')) : '';
    // 02/11/2026: "mandei" e "respondeu" (para medir a abordagem, não só a lista)
    const marcas = (l.respondeu_em ? CRM.selo('💬 Respondeu em ' + R().dataBR(R().diaLocal(l.respondeu_em)), 'verde') + ' '
      : l.mandou_em ? CRM.selo('✓ Mensagem mandada em ' + R().dataBR(R().diaLocal(l.mandou_em)) + ' · esperando resposta', 'azul') + ' ' : '');
    return '<article class="cartao lead-sug' + (aberta ? '' : ' lead-feito') + (l.mandou_em && !l.respondeu_em && aberta ? ' lead-esperando' : '') + '">' +
      '<div class="lead-topo"><div><h3>' + esc(nomeDe(l)) + '</h3><small>' + esc(titulo(l.razao || '')) + ' · CNPJ ' + esc(cnpjBR(l.cnpj)) + '</small>' +
        '<div class="lead-porque">' + (deOntem ? '<span class="lead-ontem">de ' + esc(R().dataBR(l.dia)) + '</span>' : '') + (l.situacao === 'amanha' ? '<span class="lead-ontem">deixado para hoje</span>' : '') +
        (l.motivos || []).map(m => '<span>' + esc(m) + '</span>').join('') + '</div></div>' +
        CRM.selo(l.segmento || '—', { 'Condomínio': 'azul', 'Serviços': 'verde', 'Escola': 'ambar', 'Saúde': 'roxo', 'Indústria': 'cinza' }[l.segmento] || 'cinza') + '</div>' +
      '<div class="lead-corpo"><div><p class="lead-rot">Contato e endereço</p><dl class="lead-dados">' +
        cs.map(x => '<dt>' + icone[x.tipo] + ' ' + esc({ whatsapp: 'WhatsApp', telefone: 'Telefone', email: 'E-mail', site: 'Site', instagram: 'Instagram' }[x.tipo]) + '</dt><dd>' +
          (x.tipo === 'site' ? '<a href="' + esc(x.valor) + '" target="_blank" rel="noopener">' + esc(String(x.valor).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) + '</a>'
            : x.tipo === 'email' ? '<a href="mailto:' + esc(x.valor) + '">' + esc(x.valor) + '</a>'
            : x.tipo === 'instagram' ? esc(x.valor) : '<a href="tel:+55' + esc(String(x.valor).replace(/\D/g, '')) + '">' + esc(foneBR(x.valor)) + '</a>') +
          ' <small class="' + (x.alerta ? 'lead-alerta' : '') + '">· ' + esc(x.fonte) + '</small></dd>').join('') +
        (!cs.length ? '<dt>Contato</dt><dd><small>nenhum achado</small></dd>' : '') +
        '<dt>Endereço</dt><dd>' + esc([titulo(l.endereco || ''), titulo(l.bairro || ''), cidadeBonita(l.cidade)].filter(Boolean).join(', ')) + (l.cep ? ' · CEP ' + esc(String(l.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2')) : '') + '</dd>' +
        '<dt>Empresa</dt><dd>' + esc([idade(l.abertura, CRM.hoje()), l.porte, c.porte].filter(Boolean).join(' · ') || '—') + '</dd>' +
        (l.atividade ? '<dt>Atividade</dt><dd>' + esc(l.atividade) + '</dd>' : '') +
        (c.observacao ? '<dt>A IA viu</dt><dd>' + esc(c.observacao) + '</dd>' : '') +
        (!l.contato ? '<dt></dt><dd><small>a IA ainda vai procurar o site e o contato</small></dd>' : c.erro ? '<dt></dt><dd><small class="lead-alerta">' + esc(c.erro) + '</small></dd>' : '') +
      '</dl></div><div class="lead-lado">' +
        (comp.length ? '<div><p class="lead-rot">O que os ' + esc(comp[0].total) + ' clientes de ' + esc(String(l.segmento).toLowerCase()) + ' mais compram</p><ul class="lead-compram">' +
          comp.map(p => '<li>' + esc(R().nomeDeItem(p.descricao)) + ' <small>(' + p.clientes + ')</small></li>').join('') + '</ul></div>' : '') +
        '<div><p class="lead-rot">Mensagem pronta (para o seu WhatsApp ou para a ligação)</p><p class="lead-msg">' + esc(msg) + '</p></div>' +
      '</div></div>' +
      (marcas ? '<div class="lead-marcas">' + marcas + '</div>' : '') +
      anotacoesHTML(l, aberta) +
      '<div class="lead-acoes">' + (aberta
        ? '<button type="button" class="btn" data-acao="lead-virar" data-id="' + l.id + '">Virar lead</button>' +
          (zap ? '<button type="button" class="btn sec" data-acao="lead-zap" data-id="' + l.id + '" data-url="' + esc('https://wa.me/55' + zap + '?text=' + encodeURIComponent(msg)) + '">Abrir no meu WhatsApp</button>' : '') +
          '<button type="button" class="btn sec" data-acao="lead-copiar" data-id="' + l.id + '">Copiar mensagem</button>' +
          '<button type="button" class="btn sec' + (l.mandou_em ? ' ativo' : '') + '" data-acao="lead-mandei" data-id="' + l.id + '" title="Marque quando mandar a mensagem ou ligar">' + (l.mandou_em ? '✓ Mandei' : 'Mandei a mensagem') + '</button>' +
          '<button type="button" class="btn sec' + (l.respondeu_em ? ' ativo' : '') + '" data-acao="lead-respondeu" data-id="' + l.id + '" title="Marque quando a empresa responder (mesmo que seja um não)">' + (l.respondeu_em ? '💬 Respondeu' : 'Respondeu') + '</button>' +
          '<button type="button" class="btn sec" data-acao="lead-descartar" data-id="' + l.id + '">Descartar</button>' +
          (l.situacao !== 'amanha' ? '<button type="button" class="btn sec" data-acao="lead-amanha" data-id="' + l.id + '">Deixar para amanhã</button>' : '') +
          (!l.contato || c.erro || !c.achou ? '<button type="button" class="btn sec" data-acao="lead-contato" data-id="' + l.id + '">Procurar o contato de novo</button>' : '')
        : estado + ' <button type="button" class="mini" data-acao="lead-desfazer" data-id="' + l.id + '">desfazer</button>') + '</div></article>';
  }

  // Anotações das tentativas (06/11/2026, pedido da equipe: "liguei, mandei mensagem e ainda não falei com o comprador; só
  // viro lead quando falar com ele"): o histórico fica no cartão enquanto não vira lead e vai para o histórico da empresa
  // quando vira (crm_prospec_tratar). Anotação nos últimos 7 dias segura a sugestão na lista (não expira).
  const COMO = [['ligacao', '☎ Liguei'], ['whatsapp', '🟢 WhatsApp'], ['email', '✉ E-mail'], ['visita', '🚗 Visita'], ['nota', '📝 Outra']];
  const comoRot = c => (COMO.find(x => x[0] === c) || COMO[4])[1];
  const quandoAnot = iso => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  function anotacoesHTML(l, aberta) {
    const an = Array.isArray(l.anotacoes) ? l.anotacoes : [];
    if (!aberta && !an.length) return '';
    return '<div class="lead-anot"><p class="lead-rot">Anotações das tentativas' + (an.length ? ' (' + an.length + ')' : '') + '</p>' +
      (an.length ? '<ul class="lead-anot-lista">' + an.map(a => '<li><small>' + esc(quandoAnot(a.em)) + ' · ' + esc(comoRot(a.como)) +
          (a.por && a.por !== l.vendedor_id ? ' · ' + esc(R().primeiroNome(CRM.nomeUsuario(a.por))) : '') + '</small> ' + esc(a.texto || '') + '</li>').join('') + '</ul>'
        : '<p class="dica">Ligou, mandou WhatsApp ou e-mail e ainda não falou com o comprador? Anote aqui cada tentativa. Quando virar lead, as anotações vão para o histórico da empresa.</p>') +
      (aberta ? '<div class="lead-anot-form"><select data-lead-como="' + l.id + '" aria-label="Como foi">' + CRM.opcoesHTML(COMO, 'ligacao') + '</select>' +
        '<input type="text" data-lead-anot="' + l.id + '" maxlength="500" placeholder="ex.: liguei, a recepção pediu e-mail; o comprador é o Sr. Paulo, volta na segunda" aria-label="Anotação">' +
        '<button type="button" class="btn sec" data-acao="lead-anotar" data-id="' + l.id + '">Anotar</button></div>' : '') + '</div>';
  }
  async function anotar(id) {
    const i = document.querySelector('[data-lead-anot="' + id + '"]'), c = document.querySelector('[data-lead-como="' + id + '"]');
    const t = i ? i.value.trim() : '';
    if (t.length < 3) { CRM.toast('Escreva a anotação.', true); if (i) i.focus(); return; }
    try {
      await CRM.store().prospecAnotar(Number(id), t, c ? c.value : 'nota');
      const l = achar(id);
      if (l) l.anotacoes = (l.anotacoes || []).concat([{ em: new Date().toISOString(), como: c ? c.value : 'nota', texto: t }]);
      CRM.toast('Anotado.'); CRM.render();
    } catch (e) { CRM.falhou(e); }
  }

  const R = () => raiz.CRMRegras;
  function telaLista() {
    const gest = CRM.ehGestor();
    if (gest && !vendSel) { const vs = vendedores(); vendSel = (vs.find(u => u.user_id === CRM.meuId()) || vs[0] || {}).user_id || null; }
    if (!dados) { setTimeout(carrega, 0); return '<div class="cartao"><p class="vazio">Carregando…</p></div>'; }
    const abertas = dados.filter(l => l.situacao === 'nova' || l.situacao === 'amanha'), feitas = dados.filter(l => !(l.situacao === 'nova' || l.situacao === 'amanha'));
    const leads = feitas.filter(l => l.situacao === 'lead').length, esperando = abertas.filter(l => l.mandou_em && !l.respondeu_em).length;
    const ligado = cfgP().ligado;
    return '<div class="lead-contador">' + CRM.selo(abertas.length + (abertas.length === 1 ? ' para tratar' : ' para tratar'), abertas.length ? 'azul' : 'cinza') + ' ' +
        CRM.selo(feitas.length + ' tratada(s) hoje', 'cinza') + ' ' + CRM.selo(leads + (leads === 1 ? ' virou lead hoje' : ' viraram lead hoje'), 'verde') +
        (esperando ? ' ' + CRM.selo(esperando + ' esperando resposta', 'azul') : '') + '</div>' +
      (!dados.length ? '<section class="cartao"><p class="vazio">' + (ligado ? 'Nenhuma empresa sugerida agora. A lista nova chega às 7h de cada dia útil.' : 'Os leads sugeridos ainda estão desligados. Quando o administrador ligar, a lista chega às 7h de cada dia útil.') + '</p></section>' : '') +
      abertas.map(cartao).join('') +
      (feitas.length ? '<h2 class="lead-h2">Tratadas hoje</h2>' + feitas.map(cartao).join('') : '') +
      '<p class="dica">Mandou a mensagem? Marque <strong>Mandei</strong> (abrir pelo botão do WhatsApp já marca). A empresa respondeu, mesmo que seja um não? Marque <strong>Respondeu</strong>. ' +
        'A mandada fica aqui 7 dias esperando a resposta; a que respondeu fica até você virar lead ou descartar. ' +
        'Ainda não falou com o comprador? Anote cada tentativa no cartão (a anotação segura a empresa aqui por 7 dias) e vire lead quando falar com ele: as anotações vão junto para o histórico. ' +
        'O que não for tratado continua aqui amanhã. Depois de 3 listas sem ser tratado, volta para a base e pode ir para outra pessoa. A primeira conversa é pela sua linha (ligação ou o seu WhatsApp); o WhatsApp da empresa não fala com quem ainda não é cliente.</p>';
  }

  function telaGestao() {
    if (!gestao) { setTimeout(carregaGestao, 0); return '<div class="cartao"><p class="vazio">Carregando…</p></div>'; }
    const cfg = cfgP(), adm = CRM.ehAdmin();
    const t = gestao.res.reduce((a, r) => { ['sugeridos', 'mandadas', 'responderam', 'tratados', 'leads', 'descartadas', 'compraram'].forEach(k => { a[k] = (a[k] || 0) + (r[k] || 0); }); a.faturado = (a.faturado || 0) + Number(r.faturado || 0); return a; }, {});
    const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '—');
    const kpi = (v, rot) => '<div class="kpi"><span>' + esc(rot) + '</span><strong>' + esc(String(v)) + '</strong></div>';
    const segs = (cfg.segmentos || []), base = new Map(gestao.base.map(b => [b.segmento, b]));
    const vendIds = new Set(cfg.vendedores || []);
    return '<section class="kpis">' + kpi(t.sugeridos || 0, 'Sugeridos (4 semanas)') + kpi((t.mandadas || 0) + ' (' + pct(t.mandadas, t.sugeridos) + ')', 'Mensagens mandadas') +
        kpi((t.responderam || 0) + ' (' + pct(t.responderam, t.mandadas) + ' das mandadas)', 'Responderam') + kpi((t.tratados || 0) + ' (' + pct(t.tratados, t.sugeridos) + ')', 'Tratados') +
        kpi(t.leads || 0, 'Viraram lead') + kpi(t.compraram || 0, '1ª compra') + kpi(R().moeda(t.faturado || 0), 'Faturado com eles') + '</section>' +
      '<section class="cartao"><h2>Por vendedor(a) · desde ' + esc(R().dataBR(gestao.desde)) + '</h2>' +
        (gestao.res.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Vendedor(a)</th><th class="num">Sugeridos</th><th class="num">Mandadas</th><th class="num">Responderam</th><th class="num">Tratados</th><th class="num">Viraram lead</th><th class="num">1ª compra</th><th class="num">Faturado</th><th>Descarte mais comum</th></tr></thead><tbody>' +
          gestao.res.map(r => '<tr><td>' + esc(r.nome) + '</td><td class="num">' + r.sugeridos + '</td><td class="num">' + (r.mandadas || 0) + '</td><td class="num">' + (r.responderam || 0) +
            ' <small>(' + pct(r.responderam || 0, r.mandadas || 0) + ')</small></td><td class="num">' + r.tratados + ' <small>(' + pct(r.tratados, r.sugeridos) + ')</small></td><td class="num">' + r.leads + '</td><td class="num">' + r.compraram + '</td><td class="num">' +
            esc(R().moeda(r.faturado || 0)) + '</td><td>' + esc(r.motivo || '—') + '</td></tr>').join('') + '</tbody></table></div>'
          : '<p class="vazio">Ainda não há sugestões nas últimas 4 semanas.</p>') +
        '<p class="dica">Mandadas e responderam: o que cada um marcou nos cartões (abrir o WhatsApp pelo botão já marca "mandei"). 1ª compra e faturado: notas dos leads emitidas depois de a sugestão virar lead.</p></section>' +
      '<section class="cartao"><h2>Configuração</h2>' +
        '<p>' + (cfg.ligado ? CRM.selo('Ligado', 'verde') + ' a lista sai às 7h de cada dia útil.' : CRM.selo('Desligado', 'cinza') + ' nenhuma lista sai enquanto estiver desligado.') + '</p>' +
        '<div class="tabela-rolagem"><table class="tabela" data-sem-filtro><thead><tr><th>Segmento</th><th>Atividades na Receita (CNAE)</th><th class="num">Empresas na base</th></tr></thead><tbody>' +
          segs.map(s => '<tr><td>' + (s.ligado === false ? '' : '✓ ') + esc(s.nome) + '</td><td><small>' + esc(s.clientes ? 'as mesmas atividades dos clientes de ' + s.nome.toLowerCase() : (s.cnaes || []).join(' · ')) + '</small></td><td class="num">' +
            ((base.get(s.nome) || {}).empresas || 0).toLocaleString('pt-BR') + '</td></tr>').join('') + '</tbody></table></div>' +
        '<p class="dica">Base da Receita: ' + (gestao.base.length ? 'carga ' + esc(gestao.base[0].carga) + ', empresas ativas sem MEI nas cidades ligadas' : 'ainda não carregada') + '. Ela é atualizada sozinha todo mês.</p>' +
        '<p><b>Cidades:</b> ' + esc((cfg.cidades || []).map(cidadeBonita).join(', ')) + '</p>' +
        '<p><b>Por dia, para cada pessoa:</b> ' + esc(String(cfg.por_dia || 5)) + ' · <b>Recebem:</b> ' + esc(vendedores().filter(u => vendIds.has(u.user_id)).map(u => u.nome).join(', ') || '—') + '</p>' +
        '<p><b>Regras:</b> abertas nos últimos ' + esc(String(cfg.recentes_meses || 24)) + ' meses primeiro' + (cfg.sem_mei !== false ? '; sem MEI' : '') +
          '; descartada não volta por ' + esc(String(cfg.descarte_meses || 6)) + ' meses' + (cfg.so_com_contato !== false ? '; só com telefone ou e-mail' : '') + '.</p>' +
        '<p><button type="button" class="btn sec" data-acao="lead-config">Mudar a configuração</button>' +
          (adm ? ' <button type="button" class="btn sec" data-acao="lead-gerar">Gerar a lista de hoje agora</button> <button type="button" class="btn sec" data-acao="lead-senha">Senha da atualização mensal (GitHub)</button>' : '') + '</p>' +
        (adm && situacao ? '<p class="dica">IA que procura o contato: ' + (situacao.ia ? 'ligada' : 'sem a chave') + ' · gasto neste mês US$ ' + esc(String(situacao.gasto_mes)) + ' (entra no limite do mês da IA).</p>' : '') +
      '</section>';
  }

  CRM.telas.leads = {
    render() {
      if (!(CRM.ehGestor() || CRM.papel() === 'vendedor')) return '<div class="cartao"><p class="vazio">Esta tela é de quem vende.</p></div>';
      const gest = CRM.ehGestor();
      if (!gest) aba = 'lista';
      const vs = vendedores();
      return '<div class="cabecalho"><div><h1>Leads sugeridos</h1><p class="sub">empresas parecidas com os clientes que você atende, perto de onde o caminhão já entrega · lista nova às 7h de cada dia útil</p></div><span class="flex"></span>' +
          (gest ? '<div class="abas-mini lead-abas"><button type="button" class="mini' + (aba === 'lista' ? ' ativo' : '') + '" data-acao="lead-aba" data-id="lista">Lista</button><button type="button" class="mini' + (aba === 'gestao' ? ' ativo' : '') + '" data-acao="lead-aba" data-id="gestao">Configuração e resultado</button></div>' : '') +
          (gest && aba === 'lista' ? '<label class="filtro-inline">Ver como <select id="leadVend">' + CRM.opcoesHTML(vs.map(u => [u.user_id, u.nome]), vendSel) + '</select></label>' : '') + '</div>' +
        (aba === 'gestao' ? telaGestao() : telaLista());
    },
    depois() {
      const s = document.getElementById('leadVend');
      if (s) s.addEventListener('change', () => { vendSel = s.value; dados = null; CRM.render(); });
      document.querySelectorAll('[data-lead-anot]').forEach(i => i.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); anotar(i.dataset.leadAnot); } }));
    }
  };

  const achar = id => (dados || []).find(l => String(l.id) === String(id));
  async function marcar(id, marca, liga, aviso) {
    try { await CRM.store().prospecMarcar(Number(id), marca, liga); if (aviso) CRM.toast(aviso); dados = null; CRM.render(); } catch (e) { CRM.falhou(e); }
  }
  async function tratar(id, sit, motivo, empresa) {
    try { await CRM.store().prospecTratar(Number(id), sit, motivo || null, empresa || null); dados = null; CRM.render(); } catch (e) { CRM.falhou(e); }
  }
  function formConfig() {
    const cfg = cfgP(), segs = cfg.segmentos || [], vs = vendedores(), ids = new Set(cfg.vendedores || []), cid = new Set(cfg.cidades || []);
    CRM.abrirForm({
      titulo: 'Leads sugeridos · configuração', largura: 'largo',
      campos: [{ tipo: 'secao', rotulo: 'Segmentos' }].concat(segs.map((s, i) => ({ nome: 'seg_' + i, rotulo: s.nome, tipo: 'checkbox' })),
        [{ tipo: 'secao', rotulo: 'Cidades' }], CIDADES.map(c => ({ nome: 'cid_' + c, rotulo: cidadeBonita(c), tipo: 'checkbox' })),
        [{ tipo: 'secao', rotulo: 'Quem recebe' }], vs.map(u => ({ nome: 'v_' + u.user_id, rotulo: u.nome, tipo: 'checkbox' })),
        [{ tipo: 'secao', rotulo: 'Quantidade e regras' }, { nome: 'por_dia', rotulo: 'Empresas por dia para cada pessoa', tipo: 'numero' },
          { nome: 'recentes_meses', rotulo: 'Abertas há até (meses) vêm primeiro', tipo: 'numero' }, { nome: 'descarte_meses', rotulo: 'Descartada volta depois de (meses)', tipo: 'numero' },
          { nome: 'sem_mei', rotulo: 'Deixar de fora MEI', tipo: 'checkbox' }, { nome: 'so_com_contato', rotulo: 'Só empresa com telefone ou e-mail', tipo: 'checkbox' },
          { nome: 'ia_contato', rotulo: 'A IA procura o site e o contato de cada empresa (≈ US$ 0,02 cada)', tipo: 'checkbox', largo: true }],
        CRM.ehAdmin() ? [{ nome: 'ligado', rotulo: 'Ligado (a lista sai às 7h de cada dia útil)', tipo: 'checkbox', largo: true }] : []),
      valores: Object.assign({ por_dia: cfg.por_dia || 5, recentes_meses: cfg.recentes_meses || 24, descarte_meses: cfg.descarte_meses || 6, sem_mei: cfg.sem_mei !== false,
        so_com_contato: cfg.so_com_contato !== false, ia_contato: cfg.ia_contato !== false, ligado: !!cfg.ligado },
        ...segs.map((s, i) => ({ ['seg_' + i]: s.ligado !== false })), ...CIDADES.map(c => ({ ['cid_' + c]: cid.has(c) })), ...vs.map(u => ({ ['v_' + u.user_id]: ids.has(u.user_id) }))),
      aoSalvar: async v => {
        const por = Math.round(Number(v.por_dia) || 0);
        if (por < 1 || por > 50) throw new Error('Empresas por dia: de 1 a 50.');
        const novo = Object.assign({}, cfg, {
          segmentos: segs.map((s, i) => Object.assign({}, s, { ligado: !!v['seg_' + i] })),
          cidades: CIDADES.filter(c => v['cid_' + c]), vendedores: vs.filter(u => v['v_' + u.user_id]).map(u => u.user_id),
          por_dia: por, recentes_meses: Math.max(1, Math.round(Number(v.recentes_meses) || 24)), descarte_meses: Math.max(1, Math.round(Number(v.descarte_meses) || 6)),
          sem_mei: !!v.sem_mei, so_com_contato: !!v.so_com_contato, ia_contato: !!v.ia_contato
        });
        if (CRM.ehAdmin()) novo.ligado = !!v.ligado;
        if (!novo.cidades.length) throw new Error('Escolha pelo menos uma cidade.');
        await CRM.salvarConfig({ prospeccao: novo });
        CRM.toast('Configuração salva. Vale para a próxima lista.'); gestao = null; CRM.render();
      }
    });
  }

  Object.assign(CRM.acoes, {
    'lead-aba': id => { aba = id; CRM.render(); },
    'lead-copiar': async id => {
      const l = achar(id); if (!l) return;
      const msg = mensagem(l, CRM.nomeUsuario(l.vendedor_id), new Date().getHours(), CRM.nomeInstalacao());
      try { await navigator.clipboard.writeText(msg); CRM.toast('Mensagem copiada. Cole no seu WhatsApp.'); } catch (e) { CRM.toast('Não consegui copiar: selecione o texto da mensagem.', true); }
    },
    // abre a conversa no WhatsApp da pessoa e já marca "mandei" (ela desmarca se não mandou)
    'lead-zap': (id, el) => {
      const url = el && el.dataset ? el.dataset.url : '';
      if (url) window.open(url, '_blank', 'noopener');
      const l = achar(id);
      if (l && !l.mandou_em) marcar(id, 'mandei', true, 'Marquei "mandei". Se não mandou, clique em "✓ Mandei" para desmarcar.');
    },
    'lead-mandei': id => { const l = achar(id); if (l) marcar(id, 'mandei', !l.mandou_em); },
    'lead-respondeu': id => { const l = achar(id); if (l) marcar(id, 'respondeu', !l.respondeu_em); },
    'lead-anotar': id => anotar(id),
    'lead-amanha': id => tratar(id, 'amanha'),
    'lead-desfazer': id => tratar(id, 'nova'),
    'lead-descartar': id => {
      CRM.abrirForm({ titulo: 'Descartar', intro: 'Por que esta empresa não serve agora? O motivo ajuda a melhorar a busca. Ela não volta por ' + (cfgP().descarte_meses || 6) + ' meses.',
        campos: [{ nome: 'motivo', rotulo: 'Motivo', tipo: 'select', opcoes: [['', '— escolha —']].concat(MOTIVOS.map(m => [m, m])), obrigatorio: true }, { nome: 'obs', rotulo: 'Detalhe (opcional)' }],
        salvarTexto: 'Descartar',
        aoSalvar: async v => { if (!v.motivo) throw new Error('Escolha o motivo.'); await tratar(id, 'descartada', v.motivo + (v.obs ? ' — ' + v.obs : '')); } });
    },
    'lead-virar': id => {
      const l = achar(id); if (!l) return;
      const cs = contatos(l), c = l.contato || {};
      const tel = cs.find(x => (x.tipo === 'whatsapp' || x.tipo === 'telefone') && !x.alerta) || cs.find(x => x.tipo === 'whatsapp' || x.tipo === 'telefone');
      const em = cs.find(x => x.tipo === 'email' && !x.alerta) || cs.find(x => x.tipo === 'email');
      CRM.fichas.formLead({
        valores: { nome: nomeDe(l), telefone: tel ? foneBR(tel.valor) : '', email: em ? em.valor : '', cnpj: cnpjBR(l.cnpj), cidade: cidadeBonita(l.cidade), segmento: l.segmento,
          origem: 'Leads sugeridos', situacao: 'lead', responsavel_id: l.vendedor_id,
          observacoes: ['Leads sugeridos (' + R().dataBR(l.dia) + ').', c.site ? 'Site: ' + c.site : '', c.instagram ? 'Instagram: ' + c.instagram : '', c.observacao || ''].filter(Boolean).join(' ') },
        aoCriar: async emp => { await CRM.store().prospecTratar(Number(id), 'lead', null, emp.id); dados = null; }
      });
    },
    'lead-contato': async id => {
      CRM.toast('Procurando o site e o contato… (até 1 minuto)');
      try { await CRM.store().prospeccao({ acao: 'contato', id: Number(id) }); dados = null; CRM.render(); CRM.toast('Pronto.'); } catch (e) { CRM.falhou(e); }
    },
    'lead-config': () => formConfig(),
    'lead-gerar': async () => {
      // Pelo banco (03/11/2026): montar a lista leva ~7–10 s e a chamada direta passa do limite de 8 s. O botão pede ao
      // agendador, que roda em até 1 minuto, monta a lista no banco e manda a IA procurar os contatos.
      if (!confirm('Gerar a lista de hoje agora? Ela sai em até 1 minuto e a IA procura os contatos em seguida (uns 3 minutos). Se a lista de hoje já existe, só procura os contatos que faltam. Fora de dia útil a lista sai, mas os contatos ficam para pedir no cartão.')) return;
      try {
        const r = await CRM.store().prospecAgora();
        CRM.toast(r && r.ja_pedido ? 'Já pedido: a lista sai em até 1 minuto.' : 'Pedido feito: a lista sai em até 1 minuto. A tela se atualiza sozinha em 2 minutos.');
        setTimeout(() => { dados = null; recarrega(); }, 120000);
      } catch (e) { CRM.falhou(e); }
    },
    'lead-senha': async () => {
      if (!confirm('Gerar uma senha nova para a atualização mensal da base da Receita? A senha antiga deixa de valer na hora: cole a nova nos Secrets do GitHub.')) return;
      try {
        const r = await CRM.store().prospeccao({ acao: 'senha_carga' });
        CRM.abrirForm({ titulo: 'Senha da atualização mensal', salvarTexto: 'Pronto, colei',
          intro: 'Ela aparece só agora. No GitHub: repositório crm-oneclean → Settings → Secrets and variables → Actions → New repository secret. Nome: CRM_CARGA_SENHA. Valor: a senha abaixo. Depois feche esta janela.',
          campos: [{ nome: 'senha', rotulo: 'Senha (selecione e copie)', largo: true }], valores: { senha: r.senha }, aoSalvar: async () => {} });
      } catch (e) { CRM.falhou(e); }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
