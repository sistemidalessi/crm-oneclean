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
  // próximo dia de entrega: o dia seguinte, pulando sábado e domingo
  const proximoDiaEntrega = iso => { let x = R.somaDias(iso, 1); while ([0, 6].includes(new Date(x + 'T12:00:00').getDay())) x = R.somaDias(x, 1); return x; };
  const diaLongo = iso => SEMANA[new Date(iso + 'T12:00:00').getDay()] + ', ' + dm(iso);
  const motoristas = () => R.ordemAlfa((CRM.estado.D.usuarios || []).filter(u => u.papel === 'motorista' && u.ativo !== false), u => u.nome);
  const nomeMot = id => { const u = (CRM.estado.D.usuarios || []).find(x => x.user_id === id); return u ? u.nome : ''; };
  const SIT = { pendente: ['pendente', 'ambar'], entregue: ['entregue', 'verde'], problema: ['com problema', 'vermelho'] };
  const urls = new Map(); // canhoto → link assinado (vale 10 min)

  // ============================================================ logística
  const f = { dia: null, marcadas: new Set(), mot: '', pend: new Set(), motPend: '' };
  let dados = null, carregando = false, lidoEm = 0, veics = null;
  // Caminhão de cada motorista no dia (03/11/2026, Anderson: "igual a gente escolhe o motorista, eu preciso escolher o caminhão
  // para saber, quando toma multa aquele dia, quem estava com qual"): um caminhão por motorista no dia, gravado em cada entrega.
  const nomeVeic = id => { const v = (veics || []).find(x => x.id === id); return v ? v.nome + (v.placa ? ' ' + v.placa : '') : ''; };
  const veicDoMot = k => ((dados && dados.rota || []).find(x => (x.motorista_id || '') === (k || '') && x.veiculo_id) || {}).veiculo_id || null;
  async function carrega(silencio) {
    if (carregando) return;
    carregando = true;
    try {
      const dia = f.dia || (f.dia = hojeSP());
      const [rota, cand, vs, pend] = await Promise.all([st().rotaDia(dia), st().rotaCandidatas(somaDias(dia, -10)), st().veiculos ? st().veiculos().catch(() => []) : [],
        st().rotaPendentes ? st().rotaPendentes(dia).catch(() => []) : []]);
      veics = vs || [];
      dados = { dia, rota: rota || [], cand: cand || [], pend: pend || [] };
      const ids = new Set(dados.pend.map(x => x.id)); [...f.pend].forEach(id => { if (!ids.has(id)) f.pend.delete(id); });
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
    return cabRotas() + (CRM.diretorLogistica ? CRM.diretorLogistica.bloco() : '') +
      '<section class="kpis">' + kpi('Entregas do dia', r.total) + kpi('Entregues', r.entregues, r.entregues ? 'verde' : '') + kpi('Com problema', r.problemas, r.problemas ? 'vermelho' : '') +
        kpi('Sem motorista', r.semMotorista, r.semMotorista ? 'ambar' : '') + kpi('Agradecimentos enviados', r.agradecidos) + '</section>' +
      (mots.length ? '' : '<p class="aviso-notas">Ainda não há nenhum usuário com o papel <strong>Motorista</strong>. O administrador cria em Configurações → Equipe (um login para cada motorista).</p>') +
      chaves.map(k => blocoMotorista(k, grupos.get(k), opMot)).join('') +
      (r.naoMandadas ? '<p class="acoes"><button type="button" class="btn" data-acao="rt-liberar">Mandar a rota aos motoristas (' + r.naoMandadas + ' parada(s) ainda não foram)</button></p>' : '') +
      blocoPendentes(opMot) + blocoCandidatas(opMot) + blocoRelatorio();
  }
  // Relatório de entregas (28/10/2026, pesquisa em todas as telas): as entregas de um período (até 62 dias, um dia por vez no
  // banco), com pesquisa por cliente, nota, bairro, motorista ou observação, situação e planilha.
  const rel = { chave: '', l: null, lendo: false };
  function blocoRelatorio() {
    const st = CRM.Lista.estado('rt-rel', { de: R.somaDias(hojeSP(), -7), ate: hojeSP() }), de = st.de || R.somaDias(hojeSP(), -7), ate = st.ate || hojeSP(), k = de + '|' + ate;
    if (rel.chave !== k && !rel.lendo) {
      rel.lendo = true;
      const dias = []; for (let d = de; d <= ate && dias.length < 62; d = R.somaDias(d, 1)) dias.push(d);
      (async () => {
        const out = [];
        for (let i = 0; i < dias.length; i += 6) out.push(...[].concat(...await Promise.all(dias.slice(i, i + 6).map(d => CRM.store().rotaDia(d).catch(() => [])))));
        rel.l = out; rel.chave = k;
      })().catch(e => { CRM.falhou(e); rel.l = []; rel.chave = k; }).then(() => { rel.lendo = false; CRM.render(); });
    }
    const base = rel.chave === k ? rel.l || [] : null;
    const l = base ? CRM.Lista.filtra('rt-rel', base, { texto: x => [x.cliente, x.numero, x.bairro, x.cidade, x.endereco, nomeMot(x.motorista_id), x.veiculo, x.obs, x.vendedor], sel: (x, v) => x.situacao === v })
      .sort((a, b) => String(b.dia).localeCompare(String(a.dia)) || (a.ordem || 0) - (b.ordem || 0)) : [];
    CRM.Lista.planilha('rt-rel', 'entregas', ['Dia', 'NF', 'Cliente', 'Bairro', 'Cidade', 'Motorista', 'Caminhão', 'Situação', 'Entregue em', 'Observação'],
      () => l.map(x => [R.dataBR(x.dia), x.numero || '', x.cliente || '', x.bairro || '', x.cidade || '', nomeMot(x.motorista_id) || '', x.veiculo || '', (SIT[x.situacao] || [x.situacao])[0], x.entregue_em ? hora(x.entregue_em) : '', x.obs || '']));
    const conta = s2 => l.filter(x => x.situacao === s2).length;
    return '<section class="cartao"><h2>Relatório de entregas <small>' + (base ? base.length + ' entrega(s) no período' : 'carregando…') + '</small></h2>' +
      CRM.Lista.barra('rt-rel', { periodo: true, rotuloPeriodo: 'Dia de', placeholder: 'Cliente, NF, bairro, motorista, caminhão ou observação', total: base ? base.length : null, achados: l.length,
        sel: [['', 'Todas'], ['entregue', 'Entregues'], ['problema', 'Com problema'], ['pendente', 'Pendentes']] }) +
      (!base ? '<p class="vazio">Carregando…</p>' : !l.length ? '<p class="vazio">Nenhuma entrega nesse período.</p>' :
        '<p class="dica">' + conta('entregue') + ' entregue(s) · ' + conta('problema') + ' com problema · ' + conta('pendente') + ' pendente(s)' + (base.length && (R.somaDias(de, 61) < ate) ? ' · o período vai até 62 dias' : '') + '</p>' +
        '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Dia</th><th>Cliente</th><th>NF</th><th>Motorista</th><th>Caminhão</th><th>Situação</th></tr></thead><tbody>' +
        CRM.Lista.corta('rt-rel', l, 50).map(x => { const s2 = SIT[x.situacao] || [x.situacao, '']; return '<tr><td>' + esc(R.dataBR(x.dia)) + '</td><td><strong>' + esc(x.cliente || '—') + '</strong><small>' + esc([x.bairro, x.cidade].filter(Boolean).join(' · ')) + '</small></td>' +
          '<td>' + esc(x.numero || '') + '</td><td>' + esc(nomeMot(x.motorista_id) || '—') + '</td><td>' + esc(x.veiculo || '—') + '</td><td>' + CRM.selo(s2[0] + (x.entregue_em ? ' ' + hora(x.entregue_em) : ''), s2[1]) + (x.obs ? '<small class="rt-obs">' + esc(x.obs) + '</small>' : '') + '</td></tr>'; }).join('') +
        '</tbody></table></div>' + CRM.Lista.mais('rt-rel', l, 50)) + '</section>';
  }
  function formVeiculos() {
    CRM.abrirForm({
      titulo: '🚚 Caminhões',
      intro: 'Os caminhões que a logística escolhe na rota de cada motorista. Fica guardado em cada entrega: no relatório de entregas, pesquise o dia de uma multa para ver quem estava com qual.',
      htmlAntes: '<table class="tabela"><thead><tr><th>Caminhão</th><th>Placa</th><th>Situação</th><th></th></tr></thead><tbody>' +
        (veics || []).map(v => '<tr><td>' + esc(v.nome) + '</td><td>' + esc(v.placa || '—') + '</td><td>' + (v.ativo === false ? CRM.selo('fora de uso', 'cinza') : CRM.selo('em uso', 'verde')) + '</td>' +
          '<td><button type="button" class="mini" data-acao="rt-veic-editar" data-id="' + v.id + '">✎</button></td></tr>').join('') + '</tbody></table>' +
        '<p class="acoes"><button type="button" class="btn sec" data-acao="rt-veic-novo">+ Cadastrar caminhão</button></p>',
      campos: [], salvarTexto: 'Fechar', aoSalvar: async () => {}
    });
  }
  function formVeiculo(v) {
    CRM.abrirForm({
      titulo: v ? 'Caminhão · ' + v.nome : 'Cadastrar caminhão',
      campos: [{ nome: 'nome', rotulo: 'Caminhão (modelo)', obrigatorio: true, dica: 'ex.: Kia Bongo' }, { nome: 'placa', rotulo: 'Placa', dica: 'ex.: ABC1D23 (para achar o da multa)' },
        { nome: 'ativo', rotulo: 'Situação', tipo: 'select', opcoes: [['1', 'Em uso'], ['0', 'Fora de uso (não aparece para escolher)']] }],
      valores: { nome: v ? v.nome : '', placa: v ? v.placa || '' : '', ativo: v && v.ativo === false ? '0' : '1' },
      aoSalvar: async d => {
        await st().veiculoGravar({ id: v ? v.id : null, nome: d.nome, placa: d.placa, ativo: d.ativo !== '0' });
        veics = await st().veiculos(); CRM.toast('Caminhão gravado.'); CRM.render();
      }
    });
  }
  function cabRotas() {
    return '<div class="cabecalho"><div><h1>Rotas</h1><p class="sub">as notas emitidas entram aqui; escolha o motorista e a ordem e mande a rota: cada motorista vê as paradas dele no celular</p></div>' +
      '<div class="acoes"><label class="filtro-inline">Dia da entrega <input type="date" data-rt-dia value="' + esc(f.dia || hojeSP()) + '"></label> ' +
      '<button type="button" class="btn sec" data-acao="rt-atualizar"' + (carregando ? ' disabled' : '') + '>Atualizar</button>' +
      ' <button type="button" class="btn sec" data-acao="rt-veiculos" title="cadastro dos caminhões (nome e placa)">🚚 Caminhões</button>' +
      (CRM.ehAdmin() ? ' <button type="button" class="mini" data-acao="rt-programada" title="clientes com entrega agendada: não contam como atrasados nem como nota sem rota">Entrega programada (' + programadas().length + ')</button>' : '') + '</div></div>';
  }
  function blocoMotorista(k, l, opMot) {
    l = l.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || (a.numero || 0) - (b.numero || 0));
    const r = X.resumo(l);
    return '<section class="cartao"><div class="cabecalho-cartao"><h2>' + (k ? esc(nomeMot(k) || 'Motorista') : 'Sem motorista') + ' <small>' + l.length + ' parada(s)' +
        (k ? ' · ' + r.entregues + ' entregue(s)' + (r.problemas ? ' · ' + r.problemas + ' com problema' : '') : '') + '</small></h2>' +
        (k ? (vid => '<label class="filtro-inline">🚚 Caminhão <select data-rt-veic="' + esc(k) + '"><option value="">— escolher —</option>' +
          (veics || []).filter(v => v.ativo !== false || v.id === vid).map(v => '<option value="' + v.id + '"' + (v.id === vid ? ' selected' : '') + '>' + esc(v.nome + (v.placa ? ' · ' + v.placa : '')) + '</option>').join('') +
          '</select></label>' + (vid ? '' : ' <small class="neg">sem caminhão</small>'))(veicDoMot(k)) : '') +
        (l.length > 1 && l.some(x => !X.feita(x)) ? '<button type="button" class="mini" data-acao="rt-bairro" data-id="' + esc(k) + '">Ordenar por bairro</button>' : '') +
        ' <button type="button" class="mini" data-acao="rt-romaneio" data-id="' + esc(k) + '" title="folha para o motorista: clientes, endereços de entrega e notas, na ordem da rota">🖨 Romaneio</button></div>' +
      // 05/11/2026 (Anderson: a rota do Erick estava montada e não aparecia no celular dele): parada que mudou de motorista ou
      // entrou depois do "Mandar a rota" fica "não mandada"; o aviso e o botão ficam no próprio cartão do motorista
      (k ? (nm => { const pend = l.filter(x => !x.liberada && !X.feita(x)).length, nome = esc(R.primeiroNome(nomeMot(k) || 'motorista'));
        return pend ? '<div class="rt-aviso">⚠ <strong>' + pend + ' parada(s) ainda não mandada(s):</strong> ' + nome + ' não vê' + (pend === l.length ? ' a rota' : ' essas paradas') + ' no celular. ' +
            '<button type="button" class="btn" data-acao="rt-liberar-um" data-id="' + esc(k) + '">📤 Mandar a rota do ' + nome + '</button></div>'
          : l.length ? '<p class="rt-ok">✓ Rota no celular do ' + nome + '</p>' : ''; })() : '') +
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
  // Romaneio (04/11/2026, Edson: "na FKN sai os endereços de entrega e o nome dos clientes"): a folha do motorista com as
  // paradas na ordem da rota, o endereço de entrega (o local do pedido, quando tem), a nota e o valor, e espaço para quem recebeu.
  function imprimir(html, titulo) {
    const el = document.getElementById('impressao');
    el.innerHTML = html;
    document.body.classList.add('imprimindo');
    const antes = document.title; document.title = titulo;
    const limpa = () => { document.body.classList.remove('imprimindo'); document.title = antes; window.removeEventListener('afterprint', limpa); };
    window.addEventListener('afterprint', limpa);
    setTimeout(() => window.print(), 50);
  }
  function htmlRomaneio(k) {
    const l = doMotorista(k).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || (a.numero || 0) - (b.numero || 0));
    const veic = (l.find(x => x.veiculo) || {}).veiculo || '';
    const total = l.reduce((t, x) => t + (Number(x.valor) || 0), 0);
    return '<div class="sp-doc rt-romaneio"><h1>Romaneio de entrega — ' + esc(diaLongo(dados.dia)) + '</h1>' +
      '<p><strong>Motorista:</strong> ' + esc(k ? nomeMot(k) || '—' : 'sem motorista') + ' &nbsp; <strong>Caminhão:</strong> ' + esc(veic || '____________') +
        ' &nbsp; <strong>Paradas:</strong> ' + l.length + ' &nbsp; <strong>Total das notas:</strong> ' + esc(R.moeda(total)) + '</p>' +
      '<table><thead><tr><th>Nº</th><th>Cliente</th><th>Endereço de entrega</th><th>NF</th><th>Valor</th><th>Recebido por (nome e assinatura)</th></tr></thead><tbody>' +
      l.map((x, i) => '<tr><td class="n">' + (i + 1) + '</td><td><strong>' + esc(x.cliente || '—') + '</strong>' + (x.vendedor ? '<br><small>' + esc(x.vendedor) + '</small>' : '') + '</td>' +
        '<td>' + esc(x.endereco || 'sem endereço no cadastro') + (x.obs ? '<br><small>Obs.: ' + esc(x.obs) + '</small>' : '') + '</td>' +
        '<td>' + esc(x.numero) + '</td><td>' + esc(R.moeda(x.valor)) + '</td><td class="rt-ass"></td></tr>').join('') +
      '</tbody></table>' +
      '<p class="ass">Saída: ____:____ &nbsp; Km saída: ________ &nbsp; Retorno: ____:____ &nbsp; Km retorno: ________</p>' +
      '<p class="ass">Motorista: ______________________________ &nbsp; Conferido por: ______________________________</p></div>';
  }

  // Ficaram de outros dias (12/11/2026, áudio do Edson: "três notas com pendência em aberto… não dá para usar essas mesmas notas
  // numa rota futura"): a nota só pode estar numa entrega, e a parada que ficou pendente (o motorista não concluiu no sistema) ou
  // com problema num dia passado ficava presa lá. Aqui ela passa para a rota do dia escolhido: volta a "pendente", "não mandada",
  // com o motorista escolhido (ou o mesmo) e a observação do histórico. A que foi entregue e não foi confirmada no celular
  // não precisa passar (a tela da logística não confirma entrega; só o motorista, com a foto do canhoto).
  function blocoPendentes(opMot) {
    const l = dados.pend || [];
    if (!l.length) return '';
    return '<section class="cartao"><div class="cabecalho-cartao"><h2>Ficaram de outros dias <small>' + l.length + ' parada(s) pendente(s) ou com problema, ainda não entregue(s)</small></h2></div>' +
      '<p class="ajuda">Marque só as que vão sair de novo e passe para a rota de ' + esc(diaLongo(f.dia)) + ' (para outro dia, troque o Dia da entrega lá em cima). A que já foi entregue e só ficou sem a confirmação no celular não precisa passar.</p>' +
      '<div class="acoes"><label class="filtro-inline">Motorista <select data-rt-mot-pend>' + opMot(f.motPend, '— o mesmo de antes —') + '</select></label> ' +
        '<button type="button" class="btn" data-acao="rt-pend-passar"' + (f.pend.size ? '' : ' disabled') + '>↪ Passar para a rota de ' + esc(diaLongo(f.dia)) + ' (' + f.pend.size + ')</button></div>' +
      '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th></th><th>Dia</th><th>Nota</th><th>Cliente e endereço</th><th>Motorista</th><th>Situação</th></tr></thead><tbody>' +
      l.map(x => { const s = SIT[x.situacao] || [x.situacao, ''];
        return '<tr><td><input type="checkbox" data-rt-pend="' + esc(x.id) + '"' + (f.pend.has(x.id) ? ' checked' : '') + ' aria-label="Passar a NF ' + esc(x.numero) + ' para outro dia"></td>' +
          '<td>' + esc(diaLongo(x.dia)) + '</td><td>NF ' + esc(x.numero) + '<small class="rt-end">' + esc(R.moeda(x.valor)) + (x.vendedor ? ' · ' + esc(x.vendedor) : '') + '</small></td>' +
          '<td><strong>' + esc(x.cliente || '—') + '</strong><small class="rt-end">' + esc(x.endereco || 'sem endereço no cadastro') + '</small></td>' +
          '<td>' + esc(nomeMot(x.motorista_id) || '—') + '</td><td>' + CRM.selo(s[0], s[1]) + (x.obs ? '<small class="rt-obs">' + esc(x.obs) + '</small>' : '') + '</td></tr>'; }).join('') +
      '</tbody></table></div></section>';
  }

  function blocoCandidatas(opMot) {
    const l = dados.cand;
    return '<section class="cartao"><div class="cabecalho-cartao"><h2>Notas para pôr na rota <small>' + l.length + ' nota(s) dos últimos 10 dias, ainda sem entrega</small></h2></div>' +
      (l.length ? '<div class="acoes"><label class="filtro-inline">Motorista <select data-rt-mot-novo>' + opMot(f.mot, '— escolher depois —') + '</select></label> ' +
          // 04/11/2026 (Edson, logística: "só tem essa opção, mas seria pro dia 4"): o dia fica aqui também, ao lado do botão,
          // com o atalho para o próximo dia de entrega (o de cima, "Dia da entrega", continua valendo; os dois são o mesmo)
          '<label class="filtro-inline">para o dia <input type="date" data-rt-dia value="' + esc(f.dia || hojeSP()) + '"></label> ' +
          (f.dia === hojeSP() ? '<button type="button" class="mini" data-acao="rt-proximo-dia" title="montar a rota do próximo dia de entrega">' + esc(diaLongo(proximoDiaEntrega(hojeSP()))) + '</button> ' : '') +
          '<button type="button" class="btn" data-acao="rt-por"' + (f.marcadas.size ? '' : ' disabled') + '>Pôr na rota de ' + esc(diaLongo(f.dia)) + ' (' + f.marcadas.size + ')</button> ' +
          '<button type="button" class="mini" data-acao="rt-marcar-todas">' + (f.marcadas.size === l.length ? 'desmarcar todas' : 'marcar todas') + '</button></div>' +
        '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th></th><th>Nota</th><th>Cliente</th><th>Bairro e cidade</th><th>Vendedor(a)</th><th>Emitida</th></tr></thead><tbody>' +
        l.map(n => '<tr><td><input type="checkbox" data-rt-marca="' + esc(n.nota_id) + '"' + (f.marcadas.has(n.nota_id) ? ' checked' : '') + ' aria-label="Pôr a NF ' + esc(n.numero) + ' na rota"></td>' +
          '<td>NF ' + esc(n.numero) + '<small class="rt-end">' + esc(R.moeda(n.valor)) + '</small></td><td>' + esc(n.cliente || '—') + (n.endereco ? '' : ' <small class="neg">sem endereço no cadastro</small>') + '</td>' +
          '<td>' + esc([n.bairro, n.cidade].filter(Boolean).join(' · ')) + '</td><td>' + esc(n.vendedor || '') + '</td><td>' + esc(dm(String(n.emitida_em).slice(0, 10))) + '</td></tr>').join('') +
        '</tbody></table></div>' : '<p class="vazio">Nenhuma nota esperando entrega.</p>') + '</section>';
  }

  // Entrega programada (30/10/2026, Anderson: "as notas da Uniserv são com entregas programadas… nem coloque aí que está
  // atrasada"): a lista fica em crm_config.dados.entrega_programada e o banco (crm_entrega_programada) tira esses clientes das
  // atrasadas e das notas sem rota do Diretor de Logística
  const programadas = () => String((((CRM.estado.D.config || [])[0] || {}).dados || {}).entrega_programada || '').match(/\d[\d.\/-]{6,}\d/g) || [];
  async function regravaOrdem(lista) {
    for (const p of lista) await st().entregaAtualizar(p.id, { ordem: p.ordem });
    await recarrega();
  }
  const daRota = id => (dados && dados.rota || []).find(x => x.id === id);
  const doMotorista = k => (dados.rota || []).filter(x => (x.motorista_id || '') === (k || '')).sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || (a.numero || 0) - (b.numero || 0));

  // ============================================================ motorista
  const m = { dia: null, aberta: null, foto: null, fotoUrl: '', fotoDados: '', como: 'entregue', obs: '', enviando: false };
  let minha = null, carregandoM = false, lidoM = 0;
  // 05/11/2026 (motoristas: "a opção do canhoto assinado some pra nós"): no Android, abrir a câmera pode tirar o navegador da
  // memória; na volta a página recarregava na lista da rota, sem a entrega aberta e sem a foto. A confirmação em andamento
  // (parada, foto já reduzida, como foi, observação) fica guardada no celular e volta sozinha.
  const CHAVE_ABERTA = 'crm_rota_aberta';
  function guardaAberta() {
    try {
      if (!m.aberta) { raiz.localStorage.removeItem(CHAVE_ABERTA); return; }
      raiz.localStorage.setItem(CHAVE_ABERTA, JSON.stringify({ user: meuIdM(), dia: m.dia, id: m.aberta, como: m.como, obs: m.obs, foto: m.fotoDados || '', em: Date.now() }));
    } catch (e) { /* celular sem espaço: segue sem guardar */ }
  }
  function voltaAberta() {
    try {
      const g = JSON.parse(raiz.localStorage.getItem(CHAVE_ABERTA) || 'null');
      if (!g || g.user !== meuIdM() || g.dia !== m.dia || Date.now() - g.em > 12 * 3600000) { raiz.localStorage.removeItem(CHAVE_ABERTA); return; }
      const y = (minha || []).find(z => z.id === g.id);
      if (!y || X.feita(y)) { raiz.localStorage.removeItem(CHAVE_ABERTA); return; }
      m.aberta = g.id; m.como = g.como || 'entregue'; m.obs = g.obs || '';
      if (g.foto) { m.fotoDados = g.foto; m.fotoUrl = g.foto; m.foto = blobDe(g.foto); }
    } catch (e) { /* nada guardado */ }
  }
  function blobDe(dataUrl) {
    const [cab, b64] = String(dataUrl).split(','), tipo = (/data:([^;]+)/.exec(cab) || [])[1] || 'image/jpeg';
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: tipo });
  }
  const dadosDe = b => new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = erro; r.readAsDataURL(b); });
  // ---- sem internet (04/11/2026): a rota guardada no celular e a fila das confirmações (rota-offline-fila.js)
  const FR = raiz.CRMFilaRota;
  let semSinal = false, guardadaEm = null, naFila = 0, enviandoFila = false;
  const meuIdM = () => (CRM.estado.eu ? CRM.estado.eu.user_id : null);
  function guardaRota(l) {
    if (!FR) return;
    const r = { user: meuIdM(), nome: CRM.estado.eu ? CRM.estado.eu.nome : '', dia: m.dia, em: new Date().toISOString(),
      l: l.map(y => { const mp = X.mapas(y.endereco) || {}; return { id: y.id, ordem: y.ordem, numero: y.numero, cliente: y.cliente, endereco: y.endereco, contato: y.contato || '',
        telefone: y.telefone || '', situacao: y.situacao, entregue_em: y.entregue_em || null, waze: mp.waze || '', google: mp.google || '' }; }) };
    if (FR.guardaRota(r)) guardadaEm = r.em;
  }
  async function contaFila() { try { naFila = FR ? (await FR.lista()).filter(x => x.user === meuIdM()).length : 0; } catch (e) { naFila = 0; } }
  // manda o que foi confirmado sem sinal (a foto e a confirmação), na ordem; para no primeiro erro de rede
  async function enviaFila() {
    if (!FR || enviandoFila || (raiz.navigator && raiz.navigator.onLine === false)) return;
    enviandoFila = true;
    let mandou = 0;
    try {
      for (const rec of (await FR.lista()).filter(x => x.user === meuIdM())) {
        try {
          const caminho = await st().canhotoSubir(rec.foto, rec.id, rec.dia);
          await st().entregaConfirmar(rec.id, rec.como, rec.obs, caminho, rec.em);
          await FR.tira(rec.id); mandou++;
          st().whatsapp && st().whatsapp({ acao: 'entrega', entrega: rec.id }).catch(e => console.warn('agradecimento', e));
        } catch (e) {
          if (FR.semRede(e)) break;
          // a entrega já tinha sido confirmada (ou saiu da rota): não adianta tentar de novo
          if (/não encontrad|already|já confirm|permiss/i.test(String(e.message || e))) { await FR.tira(rec.id); continue; }
          console.warn('fila da rota', e); break;
        }
      }
    } finally { enviandoFila = false; }
    await contaFila();
    if (mandou) { CRM.toast(mandou + ' entrega(s) confirmada(s) sem internet foram enviadas agora.'); carregandoM = false; carregaM(true); }
  }
  if (FR && raiz.addEventListener) {
    raiz.addEventListener('online', () => { semSinal = false; enviaFila(); if (CRM.estado.aba === 'rota') { carregandoM = false; carregaM(true); } });
    raiz.addEventListener('offline', () => { semSinal = true; if (CRM.estado.aba === 'rota') CRM.render(); });
    setInterval(() => { if (naFila && CRM.estado.eu && CRM.ehMotorista()) enviaFila(); }, 60000);
  }
  async function carregaM(silencio) {
    if (carregandoM) return;
    carregandoM = true;
    m.dia = m.dia || hojeSP();
    try {
      minha = await st().minhaRota(m.dia) || []; lidoM = Date.now(); semSinal = false;
      await contaFila();
      // o que está na fila aparece como feito até o envio
      if (naFila) { const fila = new Map((await FR.lista()).map(r => [r.id, r])); minha.forEach(y => { const r = fila.get(y.id); if (r && y.situacao === 'pendente') { y.situacao = r.como; y.entregue_em = r.em; y.na_fila = true; } }); }
      guardaRota(minha);
      if (!m.aberta) voltaAberta();
      if (naFila) setTimeout(enviaFila, 0);
    } catch (e) {
      const g = FR && FR.rotaGuardada();
      if (FR && FR.semRede(e) && g && g.user === meuIdM() && g.dia === m.dia) { minha = g.l; semSinal = true; guardadaEm = g.em; await contaFila(); if (!m.aberta) voltaAberta(); }
      else { minha = minha || []; if (!silencio) CRM.falhou(e); }
    }
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
      (semSinal ? '<p class="alerta">📴 <strong>Sem internet.</strong> Esta é a rota guardada no celular' + (guardadaEm ? ' às ' + esc(hora(guardadaEm)) : '') + ': siga normalmente; o Waze e o Maps funcionam sem sinal. As confirmações ficam guardadas e vão sozinhas quando a internet voltar.</p>' : '') +
      (naFila ? '<p class="aviso-notas">⏳ ' + naFila + ' confirmação(ões) guardada(s) no celular, esperando a internet para ir ao escritório.</p>' : '') +
      (l.length ? l.map((y, i) => cartaoParada(y, i, prox)).join('') : '<section class="cartao"><p class="vazio">Nenhuma entrega para você ' + (m.dia === hojeSP() ? 'hoje' : 'neste dia') + '. Quando a logística mandar a rota, ela aparece aqui.</p></section>') +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="mt-atualizar">Atualizar</button></p>' +
      (FR && guardadaEm && !semSinal ? '<p class="dica">✅ Rota guardada no celular às ' + esc(hora(guardadaEm)) + ': se a internet cair na rua, ela continua aqui (até fechando e abrindo o app).</p>' : '') + '</div>';
  }
  function cartaoParada(y, i, prox) {
    const s = SIT[y.situacao] || [y.situacao, ''], ehProx = prox && prox.id === y.id, mp = X.mapas(y.endereco);
    const tel = String(y.telefone || '').replace(/\D/g, '');
    if (X.feita(y)) return '<article class="cartao mt-parada feita"><div class="mt-linha"><strong>' + (i + 1) + '. ' + esc(y.cliente) + '</strong>' + CRM.selo(s[0] + ' ' + hora(y.entregue_em), s[1]) + (y.na_fila ? ' ' + CRM.selo('esperando a internet', 'ambar') : '') + '</div><small>' + esc(y.endereco || '') + '</small></article>';
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
        '<label class="campo"><span>Observação ' + (ok ? '(se quiser)' : '(obrigatória: o que aconteceu?)') + '</span><textarea rows="3" data-mt-obs placeholder="ex.: deixei na portaria com o Sr. Paulo; faltou 1 caixa de luva">' + esc(m.obs) + '</textarea></label>' +
        (ok ? '' : '<p class="dica">A logística e o(a) vendedor(a) do cliente recebem o aviso para resolver.</p>') + '</section>' +
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
    const foto = await reduz(m.foto);
    const proxNome = (X.proxima(minha.filter(y => y.id !== x.id && !X.feita(y))) || {}).cliente;
    const limpa = () => { m.aberta = null; m.foto = null; if (m.fotoUrl && !m.fotoDados) URL.revokeObjectURL(m.fotoUrl); m.fotoUrl = ''; m.fotoDados = ''; m.obs = ''; m.como = 'entregue'; guardaAberta(); };
    try {
      const caminho = await st().canhotoSubir(foto, x.id, m.dia);
      await st().entregaConfirmar(x.id, m.como, m.obs, caminho);
      limpa();
      CRM.toast('Entrega confirmada.' + (proxNome ? ' Próxima: ' + proxNome + '.' : ' Era a última: rota concluída!'));
      st().whatsapp && st().whatsapp({ acao: 'entrega', entrega: x.id }).catch(e => console.warn('agradecimento', e));
      carregandoM = false; await carregaM(true);
    } catch (e) {
      // sem sinal: a confirmação fica guardada no celular e vai sozinha quando a internet voltar
      if (FR && FR.semRede(e)) {
        try {
          const em = new Date().toISOString();
          await FR.guarda({ id: x.id, dia: m.dia, como: m.como, obs: m.obs, foto, em, user: meuIdM() });
          x.situacao = m.como; x.entregue_em = em; x.na_fila = true; FR.marcaFeita(x.id, m.como, em); semSinal = true;
          await contaFila(); limpa();
          CRM.toast('Sem internet: a entrega ficou guardada no celular e vai sozinha quando o sinal voltar.' + (proxNome ? ' Próxima: ' + proxNome + '.' : ''));
        } catch (e2) { CRM.falhou(e2); }
      } else CRM.falhou(e);
    } finally { m.enviando = false; CRM.render(); }
  }

  // ============================================================ ações e registro das telas
  Object.assign(CRM.acoes, {
    'rt-atualizar': () => recarrega(),
    'rt-romaneio': k => { if (!doMotorista(k).length) return; imprimir(htmlRomaneio(k), 'Romaneio ' + dados.dia + ' ' + (k ? nomeMot(k) || '' : '')); },
    'rt-proximo-dia': () => { f.dia = proximoDiaEntrega(hojeSP()); dados = null; CRM.render(); },
    'rt-programada': () => {
      const d = ((CRM.estado.D.config || [])[0] || {}).dados || {};
      CRM.abrirForm({
        titulo: 'Clientes com entrega programada',
        intro: 'A entrega desses clientes é agendada (ex.: Uniserv): as notas deles não contam como entrega atrasada nem como nota sem rota no Diretor de Logística. Continuam podendo entrar na rota do dia agendado.',
        campos: [{ nome: 'lista', rotulo: 'Um CNPJ por linha (8 primeiros números = todas as filiais); pode escrever o nome depois do número', tipo: 'textarea', largo: true }],
        valores: { lista: d.entrega_programada || '' },
        aoSalvar: async v => { await CRM.salvarConfig({ entrega_programada: v.lista || '' }); CRM.toast('Lista da entrega programada salva.'); }
      });
    },
    // 30/10/2026: com o filtro nas colunas, marca (ou desmarca) só as notas que aparecem
    'rt-marcar-todas': () => {
      const vis = CRM.Lista.visiveis(document, '[data-rt-marca]').map(cb => cb.dataset.rtMarca), todas = vis.length && vis.every(id => f.marcadas.has(id));
      vis.forEach(id => (todas ? f.marcadas.delete(id) : f.marcadas.add(id)));
      CRM.render();
    },
    'rt-veiculos': () => formVeiculos(),
    'rt-veic-editar': id => formVeiculo((veics || []).find(v => v.id === Number(id))),
    'rt-veic-novo': () => formVeiculo(null),
    'rt-por': () => {
      const l = dados.cand.filter(n => f.marcadas.has(n.nota_id));
      if (!l.length) return;
      (async () => {
        const base = doMotorista(f.mot).length;
        await st().entregasCriar(X.porBairro(l).map((n, i) => ({ dia: f.dia, nota_id: n.nota_id, empresa_id: n.empresa_id || null, motorista_id: f.mot || null, veiculo_id: f.mot ? veicDoMot(f.mot) : null, ordem: base + i + 1 })));
        f.marcadas.clear();
        await recarrega();
        CRM.toast(l.length + ' nota(s) na rota de ' + diaLongo(f.dia) + (f.mot ? ' com ' + nomeMot(f.mot) : '') + '. Confira a ordem e mande a rota.');
      })().catch(CRM.falhou);
    },
    'rt-pend-passar': () => {
      const l = (dados.pend || []).filter(x => f.pend.has(x.id));
      if (!l.length) return;
      const comProblema = l.filter(x => x.situacao === 'problema');
      if (!confirm('Passar ' + l.length + ' parada(s) para a rota de ' + diaLongo(f.dia) + '?' + (comProblema.length ? '\n\n' + comProblema.length + ' estava(m) com problema (' +
        comProblema.map(x => 'NF ' + x.numero).join(', ') + '): confira com a vendedora se a mercadoria vai mesmo sair de novo.' : ''))) return;
      (async () => {
        let n = 0;
        for (const x of l) {
          const mot = f.motPend || x.motorista_id || null;
          await st().entregaAtualizar(x.id, { dia: f.dia, motorista_id: mot, veiculo_id: mot ? veicDoMot(mot) : null, ordem: doMotorista(mot).length + (++n),
            liberada: false, situacao: 'pendente', entregue_em: null, entregue_por: null,
            obs: (x.obs ? x.obs + '\n' : '') + 'Passada de ' + dm(x.dia) + ' para ' + dm(f.dia) + (x.situacao === 'problema' ? ' (estava com problema)' : '') + '.' });
        }
        f.pend.clear();
        await recarrega();
        CRM.toast(l.length + ' parada(s) na rota de ' + diaLongo(f.dia) + '. Confira a ordem e mande a rota.');
      })().catch(CRM.falhou);
    },
    'rt-subir': id => { const x = daRota(id); const p = x && X.move(doMotorista(x.motorista_id), id, -1); if (p) regravaOrdem(p).catch(CRM.falhou); },
    'rt-descer': id => { const x = daRota(id); const p = x && X.move(doMotorista(x.motorista_id), id, 1); if (p) regravaOrdem(p).catch(CRM.falhou); },
    'rt-bairro': k => { const l = doMotorista(k); const feitas = l.filter(X.feita), resto = X.porBairro(l.filter(x => !X.feita(x))); regravaOrdem(feitas.concat(resto).map((x, i) => ({ id: x.id, ordem: i + 1 }))).catch(CRM.falhou); },
    'rt-tirar': id => { const x = daRota(id); if (!x || !confirm('Tirar a NF ' + x.numero + ' (' + x.cliente + ') da rota? Ela volta para "Notas para pôr na rota".')) return; st().entregaApagar(id).then(recarrega).catch(CRM.falhou); },
    'rt-liberar-um': k => {
      const l = (dados.rota || []).filter(x => x.motorista_id === k && !x.liberada);
      if (!l.length) return;
      st().rotaLiberar(f.dia, k).then(recarrega).then(() => CRM.toast('Rota mandada: ' + R.primeiroNome(nomeMot(k)) + ' já vê as paradas no celular.')).catch(CRM.falhou);
    },
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
    'mt-abrir': id => { m.aberta = id; m.foto = null; m.fotoUrl = ''; m.fotoDados = ''; m.obs = ''; m.como = 'entregue'; guardaAberta(); CRM.render(); raiz.scrollTo && raiz.scrollTo(0, 0); },
    'mt-voltar': () => { m.aberta = null; m.foto = null; m.fotoUrl = ''; m.fotoDados = ''; guardaAberta(); CRM.render(); },
    'mt-como': id => { m.como = id === 'problema' ? 'problema' : 'entregue'; guardaAberta(); CRM.render(); },
    'mt-confirmar': () => { confirmar(); }
  });

  CRM.telas.rotas = {
    render: telaRotas,
    depois(c) {
      c.querySelectorAll('[data-rt-dia]').forEach(d => d.addEventListener('change', () => { if (d.value) { f.dia = d.value; dados = null; CRM.render(); } }));
      const mn = c.querySelector('[data-rt-mot-novo]');
      if (mn) mn.addEventListener('change', () => { f.mot = mn.value; });
      const mp = c.querySelector('[data-rt-mot-pend]');
      if (mp) mp.addEventListener('change', () => { f.motPend = mp.value; });
      c.querySelectorAll('[data-rt-marca]').forEach(cb => cb.addEventListener('change', () => { if (cb.checked) f.marcadas.add(cb.dataset.rtMarca); else f.marcadas.delete(cb.dataset.rtMarca); CRM.render(); }));
      c.querySelectorAll('[data-rt-pend]').forEach(cb => cb.addEventListener('change', () => { if (cb.checked) f.pend.add(cb.dataset.rtPend); else f.pend.delete(cb.dataset.rtPend); CRM.render(); }));
      c.querySelectorAll('[data-rt-mot]').forEach(s => s.addEventListener('change', () => {
        const x = daRota(s.dataset.rtMot);
        if (!x) return;
        const ordem = s.value ? doMotorista(s.value).length + 1 : 0;
        st().entregaAtualizar(x.id, { motorista_id: s.value || null, ordem, liberada: false, veiculo_id: s.value ? veicDoMot(s.value) : null }).then(recarrega).catch(CRM.falhou);
      }));
      c.querySelectorAll('[data-rt-veic]').forEach(s => s.addEventListener('change', () => {
        st().entregasVeiculo(f.dia, s.dataset.rtVeic, s.value ? Number(s.value) : null)
          .then(() => { CRM.toast(s.value ? '🚚 ' + nomeVeic(Number(s.value)) + ' com ' + nomeMot(s.dataset.rtVeic) + ' em ' + diaLongo(f.dia) + '.' : 'Caminhão tirado.'); return recarrega(); }).catch(CRM.falhou);
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
        if (m.fotoUrl && !m.fotoDados) URL.revokeObjectURL(m.fotoUrl);
        m.foto = fl; m.fotoUrl = URL.createObjectURL(fl); m.fotoDados = '';
        CRM.render();
        // a foto já reduzida fica guardada no celular junto com a entrega aberta (volta se a página recarregar)
        reduz(fl).then(dadosDe).then(d => { if (m.foto !== fl) return; m.fotoDados = d; guardaAberta(); }).catch(() => {});
      });
      const ob = c.querySelector('[data-mt-obs]');
      if (ob) ob.addEventListener('input', () => { m.obs = ob.value; guardaAberta(); });
      if (CRM.aplicaBarras) CRM.aplicaBarras(c);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
