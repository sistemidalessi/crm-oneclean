/* Rotas de entrega e o celular do motorista (21/10/2026, simulação aprovada pelo Anderson:
   https://claude.ai/artifact/EBJG8G9kkZUY9i9W8p2ZmQ). A logística põe as notas emitidas na rota de um dia, escolhe o
   motorista e a ordem e "manda a rota": cada motorista (papel novo) vê no celular só as paradas dele, abre no Waze ou no
   Google Maps, liga para o cliente e confirma a entrega com a FOTO DO CANHOTO (obrigatória), "tudo certo" ou "teve
   problema" (com observação). Confirmada, o cliente recebe do WhatsApp da empresa a foto do canhoto e o agradecimento
   (crm-whatsapp, acao 'entrega'; não vai à venda direta nem aos clientes da lista). Sem PDF de rota (o app substitui).
   Parte pura (CRMRotas) testada em testes/rotas.test.js; as telas vêm depois. */
(function (raiz) {
  'use strict';
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  // ordem por cidade e bairro (e endereço), para a logística começar de uma rota que faz sentido
  function porBairro(l) {
    return (l || []).slice().sort((a, b) => norm(a.cidade).localeCompare(norm(b.cidade)) || norm(a.bairro).localeCompare(norm(b.bairro)) ||
      norm(a.endereco).localeCompare(norm(b.endereco)) || (a.numero || 0) - (b.numero || 0));
  }
  // os dois mapas que o motorista usa (Anderson: "dá a opção de Waze e o Google Maps")
  function mapas(endereco) {
    const q = String(endereco || '').replace(/\s*·\s*/g, ', ').trim();
    if (!q) return null;
    const e = encodeURIComponent(q);
    return { waze: 'https://waze.com/ul?q=' + e + '&navigate=yes', google: 'https://www.google.com/maps/dir/?api=1&destination=' + e + '&travelmode=driving' };
  }
  const feita = x => x.situacao === 'entregue' || x.situacao === 'problema';
  // a próxima parada do motorista: a primeira ainda pendente, na ordem da rota
  const proxima = l => (l || []).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0)).find(x => !feita(x)) || null;
  function resumo(l) {
    l = l || [];
    return { total: l.length, entregues: l.filter(x => x.situacao === 'entregue').length, problemas: l.filter(x => x.situacao === 'problema').length,
      pendentes: l.filter(x => !feita(x)).length, semMotorista: l.filter(x => !x.motorista_id).length, naoMandadas: l.filter(x => x.motorista_id && !x.liberada).length,
      agradecidos: l.filter(x => x.cli_status && x.cli_status !== 'não manda' && x.cli_status !== 'falhou').length };
  }
  // o selo do agradecimento ao cliente, para a logística acompanhar
  function seloAgradecimento(x) {
    if (!x.cli_status) return feita(x) ? ['agradecimento: aguardando', 'etiqueta'] : null;
    if (x.cli_status === 'não manda') return ['sem agradecimento: ' + (x.cli_erro || ''), 'etiqueta'];
    if (x.cli_status === 'falhou') return ['agradecimento não chegou' + (x.cli_erro ? ': ' + x.cli_erro : ''), 'vermelho'];
    return ['agradecimento ' + x.cli_status + (x.cli_proximo_em ? ' · quer agendar o próximo pedido' : ''), x.cli_status === 'lido' ? 'verde' : 'azul'];
  }
  // posições de uma lista depois de subir/descer um item (a ordem gravada vai de 1 em 1)
  function move(l, id, d) {
    const a = (l || []).slice(), i = a.findIndex(x => x.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= a.length) return null;
    const t = a[i]; a[i] = a[j]; a[j] = t;
    return a.map((x, k) => ({ id: x.id, ordem: k + 1 }));
  }
  const API = { porBairro, mapas, proxima, resumo, seloAgradecimento, move, feita };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  raiz.CRMRotas = API;
})(typeof window !== 'undefined' ? window : globalThis);

// ------------------------------------------------------------ telas: Rotas (logística) e Minha rota (motorista)
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, X = raiz.CRMRotas, R = raiz.CRMRegras;
  if (!CRM || !CRM.telas) return;
  // papel novo (fica aqui, e não em regras.js, para não mexer no motor da crm-notas)
  if (R.PAPEIS && !R.PAPEIS.some(x => x[0] === 'motorista')) R.PAPEIS.push(['motorista', 'Motorista (só a rota do dia, no celular)']);
  const esc = CRM.esc, st = () => CRM.store();
  const hojeSP = () => R.hojeISO();
  const somaDias = (iso, n) => R.somaDias(iso, n);
  const hora = iso => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '');
  const dm = iso => (iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) : '');
  const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const diaLongo = iso => SEMANA[new Date(iso + 'T12:00:00').getDay()] + ', ' + dm(iso);
  const motoristas = () => R.ordemAlfa((CRM.estado.D.usuarios || []).filter(u => u.papel === 'motorista' && u.ativo !== false), u => u.nome);
  const nomeMot = id => { const u = (CRM.estado.D.usuarios || []).find(x => x.user_id === id); return u ? u.nome : ''; };
  const SIT = { pendente: ['pendente', 'ambar'], entregue: ['entregue', 'verde'], problema: ['com problema', 'vermelho'] };
  const urls = new Map(); // canhoto → link assinado (vale 10 min)

  // ============================================================ logística
  const f = { dia: null, marcadas: new Set(), mot: '' };
  let dados = null, carregando = false, lidoEm = 0;
  async function carrega(silencio) {
    if (carregando) return;
    carregando = true;
    try {
      const dia = f.dia || (f.dia = hojeSP());
      const [rota, cand] = await Promise.all([st().rotaDia(dia), st().rotaCandidatas(somaDias(dia, -10))]);
      dados = { dia, rota: rota || [], cand: cand || [] };
      lidoEm = Date.now();
    } catch (e) { dados = dados || { dia: f.dia, rota: [], cand: [] }; if (!silencio) CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }
  const recarrega = () => { carregando = false; return carrega(true); };

  function telaRotas() {
    if (!(CRM.ehGestor() || CRM.ehLogistica())) return '<section class="cartao"><p class="vazio">Esta tela é da logística.</p></section>';
    if (!dados || dados.dia !== f.dia) { setTimeout(() => carrega(), 0); return cabRotas() + '<section class="cartao"><p class="vazio">Carregando…</p></section>'; }
    if (Date.now() - lidoEm > 60000 && !carregando) setTimeout(recarrega, 0); // os motoristas vão confirmando: a tela se atualiza sozinha
    const r = X.resumo(dados.rota), mots = motoristas();
    const kpi = (t, v, cls) => '<div class="kpi ' + (cls || '') + '"><span>' + esc(t) + '</span><strong>' + v + '</strong></div>';
    const grupos = new Map();
    dados.rota.forEach(x => { const k = x.motorista_id || ''; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(x); });
    const chaves = [...grupos.keys()].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || nomeMot(a).localeCompare(nomeMot(b)));
    const opMot = (sel, vazio) => '<option value="">' + esc(vazio || '— escolher —') + '</option>' + mots.map(u => '<option value="' + esc(u.user_id) + '"' + (u.user_id === sel ? ' selected' : '') + '>' + esc(u.nome + (u.equipe ? ' (' + u.equipe + ')' : '')) + '</option>').join('');
    return cabRotas() +
      '<section class="kpis">' + kpi('Entregas do dia', r.total) + kpi('Entregues', r.entregues, r.entregues ? 'verde' : '') + kpi('Com problema', r.problemas, r.problemas ? 'vermelho' : '') +
        kpi('Sem motorista', r.semMotorista, r.semMotorista ? 'ambar' : '') + kpi('Agradecimentos enviados', r.agradecidos) + '</section>' +
      (mots.length ? '' : '<p class="aviso-notas">Ainda não há nenhum usuário com o papel <strong>Motorista</strong>. O administrador cria em Configurações → Equipe (um login para cada motorista).</p>') +
      chaves.map(k => blocoMotorista(k, grupos.get(k), opMot)).join('') +
      (r.naoMandadas ? '<p class="acoes"><button type="button" class="btn" data-acao="rt-liberar">Mandar a rota aos motoristas (' + r.naoMandadas + ' parada(s) ainda não foram)</button></p>' : '') +
      blocoCandidatas(opMot);
  }
  function cabRotas() {
    return '<div class="cabecalho"><div><h1>Rotas</h1><p class="sub">as notas emitidas entram aqui; escolha o motorista e a ordem e mande a rota: cada motorista vê as paradas dele no celular</p></div>' +
      '<div class="acoes"><label class="filtro-inline">Dia da entrega <input type="date" data-rt-dia value="' + esc(f.dia || hojeSP()) + '"></label> ' +
      '<button type="button" class="btn sec" data-acao="rt-atualizar"' + (carregando ? ' disabled' : '') + '>Atualizar</button></div></div>';
  }
  function blocoMotorista(k, l, opMot) {
    l = l.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || (a.numero || 0) - (b.numero || 0));
    const r = X.resumo(l);
    return '<section class="cartao"><div class="cabecalho-cartao"><h2>' + (k ? esc(nomeMot(k) || 'Motorista') : 'Sem motorista') + ' <small>' + l.length + ' parada(s)' +
        (k ? ' · ' + r.entregues + ' entregue(s)' + (r.problemas ? ' · ' + r.problemas + ' com problema' : '') : '') + '</small></h2>' +
        (l.length > 1 && l.some(x => !X.feita(x)) ? '<button type="button" class="mini" data-acao="rt-bairro" data-id="' + esc(k) + '">Ordenar por bairro</button>' : '') + '</div>' +
      '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Ordem</th><th>Cliente e endereço</th><th>Nota</th><th>Motorista</th><th>Situação</th></tr></thead><tbody>' +
      l.map((x, i) => {
        const s = SIT[x.situacao] || [x.situacao, ''], ag = X.seloAgradecimento(x);
        return '<tr><td><div class="rt-ordem"><strong>' + (i + 1) + '</strong>' + (X.feita(x) ? '' : '<button type="button" class="mini" data-acao="rt-subir" data-id="' + esc(x.id) + '" aria-label="Subir">↑</button><button type="button" class="mini" data-acao="rt-descer" data-id="' + esc(x.id) + '" aria-label="Descer">↓</button>') + '</div></td>' +
          '<td><strong>' + esc(x.cliente || '—') + '</strong><small class="rt-end">' + esc(x.endereco || 'sem endereço no cadastro') + '</small></td>' +
          '<td>NF ' + esc(x.numero) + '<small class="rt-end">' + esc(R.moeda(x.valor)) + (x.vendedor ? ' · ' + esc(R.primeiroNome(String(x.vendedor).toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()))) : '') + '</small></td>' +
          '<td>' + (X.feita(x) ? esc(nomeMot(x.motorista_id)) : '<label><span class="sr-only">Motorista da NF ' + esc(x.numero) + '</span><select data-rt-mot="' + esc(x.id) + '">' + opMot(x.motorista_id) + '</select></label>') +
            (x.motorista_id && !x.liberada && !X.feita(x) ? '<small class="rt-end">ainda não mandada</small>' : '') + '</td>' +
          '<td>' + CRM.selo(s[0] + (x.entregue_em ? ' ' + hora(x.entregue_em) : ''), s[1]) + (x.obs ? '<small class="rt-obs">' + esc(x.obs) + '</small>' : '') +
            (x.canhoto ? ' <button type="button" class="mini" data-acao="rt-canhoto" data-id="' + esc(x.canhoto) + '">ver canhoto</button>' : '') +
            (ag ? '<small class="rt-end">' + CRM.selo(ag[0], ag[1]) + '</small>' : '') +
            (x.situacao === 'pendente' ? ' <button type="button" class="mini" data-acao="rt-tirar" data-id="' + esc(x.id) + '" title="tirar da rota (a nota volta para a lista de baixo)">tirar</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }
  function blocoCandidatas(opMot) {
    const l = dados.cand;
    return '<section class="cartao"><div class="cabecalho-cartao"><h2>Notas para pôr na rota <small>' + l.length + ' nota(s) dos últimos 10 dias, ainda sem entrega</small></h2></div>' +
      (l.length ? '<div class="acoes"><label class="filtro-inline">Motorista <select data-rt-mot-novo>' + opMot(f.mot, '— escolher depois —') + '</select></label> ' +
          '<button type="button" class="btn" data-acao="rt-por"' + (f.marcadas.size ? '' : ' disabled') + '>Pôr na rota de ' + esc(diaLongo(f.dia)) + ' (' + f.marcadas.size + ')</button> ' +
          '<button type="button" class="mini" data-acao="rt-marcar-todas">' + (f.marcadas.size === l.length ? 'desmarcar todas' : 'marcar todas') + '</button></div>' +
        '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th></th><th>Nota</th><th>Cliente</th><th>Bairro e cidade</th><th>Vendedor(a)</th><th>Emitida</th></tr></thead><tbody>' +
        l.map(n => '<tr><td><input type="checkbox" data-rt-marca="' + esc(n.nota_id) + '"' + (f.marcadas.has(n.nota_id) ? ' checked' : '') + ' aria-label="Pôr a NF ' + esc(n.numero) + ' na rota"></td>' +
          '<td>NF ' + esc(n.numero) + '<small class="rt-end">' + esc(R.moeda(n.valor)) + '</small></td><td>' + esc(n.cliente || '—') + (n.endereco ? '' : ' <small class="neg">sem endereço no cadastro</small>') + '</td>' +
          '<td>' + esc([n.bairro, n.cidade].filter(Boolean).join(' · ')) + '</td><td>' + esc(n.vendedor || '') + '</td><td>' + esc(dm(String(n.emitida_em).slice(0, 10))) + '</td></tr>').join('') +
        '</tbody></table></div>' : '<p class="vazio">Nenhuma nota esperando entrega.</p>') + '</section>';
  }

  async function regravaOrdem(lista) {
    for (const p of lista) await st().entregaAtualizar(p.id, { ordem: p.ordem });
    await recarrega();
  }
  const daRota = id => (dados && dados.rota || []).find(x => x.id === id);
  const doMotorista = k => (dados.rota || []).filter(x => (x.motorista_id || '') === (k || '')).sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || (a.numero || 0) - (b.numero || 0));

  // ============================================================ motorista
  const m = { dia: null, aberta: null, foto: null, fotoUrl: '', como: 'entregue', obs: '', enviando: false };
  let minha = null, carregandoM = false, lidoM = 0;
  async function carregaM(silencio) {
    if (carregandoM) return;
    carregandoM = true;
    try { m.dia = m.dia || hojeSP(); minha = await st().minhaRota(m.dia) || []; lidoM = Date.now(); } catch (e) { minha = minha || []; if (!silencio) CRM.falhou(e); }
    carregandoM = false;
    CRM.render();
  }
  function telaMinha() {
    if (minha === null) { setTimeout(() => carregaM(), 0); return '<section class="cartao"><p class="vazio">Carregando a sua rota…</p></section>'; }
    if (!m.aberta && Date.now() - lidoM > 120000 && !carregandoM) setTimeout(() => { carregandoM = false; carregaM(true); }, 0);
    const x = m.aberta && minha.find(y => y.id === m.aberta);
    if (x) return telaConfirmar(x);
    const l = minha.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0)), prox = X.proxima(l), feitas = l.filter(X.feita).length;
    const pct = l.length ? Math.round(feitas / l.length * 100) : 0;
    return '<div class="mt">' +
      '<header class="mt-topo"><div><strong>Rota de ' + esc(m.dia === hojeSP() ? 'hoje' : diaLongo(m.dia)) + '</strong><span>' + esc(CRM.estado.eu ? CRM.estado.eu.nome : '') + '</span></div>' +
        '<small>' + esc(diaLongo(m.dia)) + ' · ' + feitas + ' de ' + l.length + ' entrega(s) feita(s)</small><div class="mt-barra"><i data-largura="' + pct + '"></i></div></header>' +
      (l.length ? l.map((y, i) => cartaoParada(y, i, prox)).join('') : '<section class="cartao"><p class="vazio">Nenhuma entrega para você ' + (m.dia === hojeSP() ? 'hoje' : 'neste dia') + '. Quando a logística mandar a rota, ela aparece aqui.</p></section>') +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="mt-atualizar">Atualizar</button></p></div>';
  }
  function cartaoParada(y, i, prox) {
    const s = SIT[y.situacao] || [y.situacao, ''], ehProx = prox && prox.id === y.id, mp = X.mapas(y.endereco);
    const tel = String(y.telefone || '').replace(/\D/g, '');
    if (X.feita(y)) return '<article class="cartao mt-parada feita"><div class="mt-linha"><strong>' + (i + 1) + '. ' + esc(y.cliente) + '</strong>' + CRM.selo(s[0] + ' ' + hora(y.entregue_em), s[1]) + '</div><small>' + esc(y.endereco || '') + '</small></article>';
    return '<article class="cartao mt-parada' + (ehProx ? ' proxima' : '') + '">' + (ehProx ? '<span class="mt-rotulo">Próxima entrega</span>' : '') +
      '<div class="mt-linha"><strong>' + (i + 1) + '. ' + esc(y.cliente) + '</strong>' + (ehProx ? '' : CRM.selo('pendente', 'ambar')) + '</div>' +
      '<p class="mt-end">' + esc(y.endereco || 'sem endereço no cadastro: ligue para o cliente') + '</p>' +
      '<small>NF ' + esc(y.numero) + (y.contato ? ' · receber com ' + esc(y.contato) : '') + (tel ? ' · ' + esc(y.telefone) : '') + '</small>' +
      '<div class="mt-botoes">' + (mp ? '<a class="btn sec" href="' + esc(mp.waze) + '" target="_blank" rel="noopener">Waze</a><a class="btn sec" href="' + esc(mp.google) + '" target="_blank" rel="noopener">Google Maps</a>' : '') +
        (tel ? '<a class="btn sec" href="tel:' + esc(tel) + '">Ligar</a>' : '') + '</div>' +
      '<button type="button" class="btn largo' + (ehProx ? '' : ' sec') + '" data-acao="mt-abrir" data-id="' + esc(y.id) + '">Cheguei: confirmar a entrega</button></article>';
  }
  function telaConfirmar(x) {
    const ok = m.como === 'entregue';
    return '<div class="mt">' +
      '<header class="mt-topo"><button type="button" class="mt-voltar" data-acao="mt-voltar" aria-label="Voltar para a rota">‹</button><div><strong>' + esc(x.cliente) + '</strong><span>NF ' + esc(x.numero) + '</span></div></header>' +
      '<section class="cartao mt-passo"><h2>1. Foto do canhoto <span class="neg">(obrigatória)</span></h2>' +
        (m.fotoUrl ? '<img class="mt-foto" src="' + esc(m.fotoUrl) + '" alt="Foto do canhoto">' : '') +
        '<label class="btn ' + (m.fotoUrl ? 'sec' : 'mt-camera') + ' arquivo">' + (m.fotoUrl ? 'Tirar outra foto' : 'Abrir a câmera e fotografar o canhoto') +
          '<input type="file" accept="image/*" capture="environment" data-mt-foto></label></section>' +
      '<section class="cartao mt-passo"><h2>2. Como foi a entrega?</h2><div class="mt-como">' +
        '<button type="button" class="btn ' + (ok ? 'verde' : 'sec') + '" data-acao="mt-como" data-id="entregue" aria-pressed="' + ok + '">Tudo certo</button>' +
        '<button type="button" class="btn ' + (!ok ? 'vermelho' : 'sec') + '" data-acao="mt-como" data-id="problema" aria-pressed="' + !ok + '">Teve problema</button></div>' +
        '<label class="campo"><span>Observação ' + (ok ? '(se quiser)' : '(obrigatória: o que aconteceu?)') + '</span><textarea rows="3" data-mt-obs placeholder="ex.: deixei na portaria com o Sr. Paulo; faltou 1 caixa de luva">' + esc(m.obs) + '</textarea></label></section>' +
      '<button type="button" class="btn largo" data-acao="mt-confirmar"' + (m.enviando ? ' disabled' : '') + '>' + (m.enviando ? 'Enviando…' : 'Confirmar a entrega') + '</button></div>';
  }
  // a foto vai reduzida (até 1600 px, JPEG): sobe rápido pelo celular e ainda dá para ler o canhoto
  async function reduz(file) {
    try {
      const img = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      const b = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.8));
      return b || file;
    } catch (e) { return file; }
  }
  async function confirmar() {
    const x = minha && minha.find(y => y.id === m.aberta);
    if (!x || m.enviando) return;
    if (!m.foto) { CRM.toast('Falta a foto do canhoto: sem ela não dá para confirmar.', true); return; }
    if (m.como === 'problema' && !m.obs.trim()) { CRM.toast('Conte na observação o que aconteceu.', true); return; }
    m.enviando = true; CRM.render();
    try {
      const caminho = await st().canhotoSubir(await reduz(m.foto), x.id, m.dia);
      await st().entregaConfirmar(x.id, m.como, m.obs, caminho);
      const proxNome = (X.proxima(minha.filter(y => y.id !== x.id)) || {}).cliente;
      m.aberta = null; m.foto = null; if (m.fotoUrl) URL.revokeObjectURL(m.fotoUrl); m.fotoUrl = ''; m.obs = ''; m.como = 'entregue';
      CRM.toast('Entrega confirmada.' + (proxNome ? ' Próxima: ' + proxNome + '.' : ' Era a última: rota concluída!'));
      st().whatsapp && st().whatsapp({ acao: 'entrega', entrega: x.id }).catch(e => console.warn('agradecimento', e));
      carregandoM = false; await carregaM(true);
    } catch (e) { CRM.falhou(e); } finally { m.enviando = false; CRM.render(); }
  }

  // ============================================================ ações e registro das telas
  Object.assign(CRM.acoes, {
    'rt-atualizar': () => recarrega(),
    'rt-marcar-todas': () => { if (f.marcadas.size === dados.cand.length) f.marcadas.clear(); else dados.cand.forEach(n => f.marcadas.add(n.nota_id)); CRM.render(); },
    'rt-por': () => {
      const l = dados.cand.filter(n => f.marcadas.has(n.nota_id));
      if (!l.length) return;
      (async () => {
        const base = doMotorista(f.mot).length;
        await st().entregasCriar(X.porBairro(l).map((n, i) => ({ dia: f.dia, nota_id: n.nota_id, empresa_id: n.empresa_id || null, motorista_id: f.mot || null, ordem: base + i + 1 })));
        f.marcadas.clear();
        await recarrega();
        CRM.toast(l.length + ' nota(s) na rota de ' + diaLongo(f.dia) + (f.mot ? ' com ' + nomeMot(f.mot) : '') + '. Confira a ordem e mande a rota.');
      })().catch(CRM.falhou);
    },
    'rt-subir': id => { const x = daRota(id); const p = x && X.move(doMotorista(x.motorista_id), id, -1); if (p) regravaOrdem(p).catch(CRM.falhou); },
    'rt-descer': id => { const x = daRota(id); const p = x && X.move(doMotorista(x.motorista_id), id, 1); if (p) regravaOrdem(p).catch(CRM.falhou); },
    'rt-bairro': k => { const l = doMotorista(k); const feitas = l.filter(X.feita), resto = X.porBairro(l.filter(x => !X.feita(x))); regravaOrdem(feitas.concat(resto).map((x, i) => ({ id: x.id, ordem: i + 1 }))).catch(CRM.falhou); },
    'rt-tirar': id => { const x = daRota(id); if (!x || !confirm('Tirar a NF ' + x.numero + ' (' + x.cliente + ') da rota? Ela volta para "Notas para pôr na rota".')) return; st().entregaApagar(id).then(recarrega).catch(CRM.falhou); },
    'rt-liberar': () => {
      const l = (dados.rota || []).filter(x => x.motorista_id && !x.liberada);
      if (!l.length) return;
      (async () => {
        await st().rotaLiberar(f.dia);
        await recarrega();
        const nomes = [...new Set(l.map(x => R.primeiroNome(nomeMot(x.motorista_id))))];
        CRM.toast('Rota mandada: ' + nomes.join(', ') + ' já vê' + (nomes.length > 1 ? 'em' : '') + ' as paradas no celular.');
      })().catch(CRM.falhou);
    },
    'rt-canhoto': caminho => {
      const w = raiz.open('', '_blank');
      (async () => {
        let u = urls.get(caminho);
        if (!u || u.ate < Date.now()) { u = { url: await st().canhotoUrl(caminho), ate: Date.now() + 9 * 60000 }; urls.set(caminho, u); }
        if (w) w.location = u.url; else raiz.open(u.url, '_blank', 'noopener');
      })().catch(e => { if (w) w.close(); CRM.falhou(e); });
    },
    'mt-atualizar': () => { carregandoM = false; carregaM(); },
    'mt-abrir': id => { m.aberta = id; m.foto = null; m.fotoUrl = ''; m.obs = ''; m.como = 'entregue'; CRM.render(); raiz.scrollTo && raiz.scrollTo(0, 0); },
    'mt-voltar': () => { m.aberta = null; CRM.render(); },
    'mt-como': id => { m.como = id === 'problema' ? 'problema' : 'entregue'; CRM.render(); },
    'mt-confirmar': () => { confirmar(); }
  });

  CRM.telas.rotas = {
    render: telaRotas,
    depois(c) {
      const d = c.querySelector('[data-rt-dia]');
      if (d) d.addEventListener('change', () => { if (d.value) { f.dia = d.value; f.marcadas.clear(); dados = null; CRM.render(); } });
      const mn = c.querySelector('[data-rt-mot-novo]');
      if (mn) mn.addEventListener('change', () => { f.mot = mn.value; });
      c.querySelectorAll('[data-rt-marca]').forEach(cb => cb.addEventListener('change', () => { if (cb.checked) f.marcadas.add(cb.dataset.rtMarca); else f.marcadas.delete(cb.dataset.rtMarca); CRM.render(); }));
      c.querySelectorAll('[data-rt-mot]').forEach(s => s.addEventListener('change', () => {
        const x = daRota(s.dataset.rtMot);
        if (!x) return;
        const ordem = s.value ? doMotorista(s.value).length + 1 : 0;
        st().entregaAtualizar(x.id, { motorista_id: s.value || null, ordem, liberada: false }).then(recarrega).catch(CRM.falhou);
      }));
    }
  };
  CRM.telas.rota = {
    render: telaMinha,
    depois(c) {
      const inp = c.querySelector('[data-mt-foto]');
      if (inp) inp.addEventListener('change', () => {
        const fl = inp.files && inp.files[0];
        if (!fl) return;
        if (m.fotoUrl) URL.revokeObjectURL(m.fotoUrl);
        m.foto = fl; m.fotoUrl = URL.createObjectURL(fl);
        CRM.render();
      });
      const ob = c.querySelector('[data-mt-obs]');
      if (ob) ob.addEventListener('input', () => { m.obs = ob.value; });
      if (CRM.aplicaBarras) CRM.aplicaBarras(c);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
