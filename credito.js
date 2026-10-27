/* CRM Sistemi Dalessi — crédito do cliente (27/10/2026, pedido do Anderson: "está faltando esse módulo para fechar 100%").
   Cliente novo passa pela consulta de crédito: o botão "Consultar crédito" copia o CNPJ e abre o site de consulta (o endereço fica em
   crm_config.dados.credito.url, onde a empresa tem login; o CRM nunca guarda a senha nem entra no site), o PDF volta para o CRM, a IA lê os FATOS
   (crm-caixa-ler, modo credito) e a proposta sai da POLÍTICA abaixo, pura e testada; quem aprova é o administrador.
   O banco (crm_credito, crm_credito_ver, crm_credito_gravar, crm_credito_painel) trava o pedido a prazo com
   SEM ANÁLISE, PRAZO e LIMITE, que só o administrador libera. Tela: aba Crédito do Caixa e a ficha do cliente.
   Testes: testes/credito.test.js. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);

  // ---- política de crédito da OneClean (a proposta; o administrador pode mudar antes de aprovar)
  const POLITICA = {
    compraPadrao: 1500,      // sem compra prevista nem histórico
    scoreMinimo: 400,        // abaixo: só à vista
    scoreBom: 600,           // a partir daqui: 2 meses de compra e 28 dias
    pontualMinima: 80,       // pontualidade abaixo disso desce um degrau
    tetoDoBureau: 0.10,      // nunca mais que 10% do limite sugerido pela consulta
    arredonda: 500,
    revisarMeses: 6
  };
  const SITUACOES = { prazo: 'Liberado a prazo', vista: 'Só à vista', analise: 'Em análise' };
  const BLOQUEIOS = ['SEM ANÁLISE', 'PRAZO', 'LIMITE'];
  const meses = (de, ate) => {
    if (!de || !ate) return null;
    const a = new Date(de + 'T12:00:00Z'), b = new Date(ate + 'T12:00:00Z');
    return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
  };
  const somaMeses = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
  const teto = (v, passo) => Math.ceil(v / passo) * passo;
  const piso = (v, passo) => Math.floor(v / passo) * passo;

  // k: o que a IA leu da consulta (crm-caixa-ler); ctx: { compra_mensal, maior_mes, vencido, hoje }.
  // → { situacao, limite, prazo_max, revisar_em, motivos: [...], atencao: [...] }
  function propor(k, ctx) {
    k = k || {}; ctx = ctx || {};
    const P = POLITICA, hoje = ctx.hoje || new Date().toISOString().slice(0, 10);
    const motivos = [], atencao = [];
    const revisar_em = somaMeses(hoje, P.revisarMeses);
    const fim = (situacao, limite, prazo) => ({ situacao, limite: situacao === 'prazo' ? limite : 0, prazo_max: situacao === 'prazo' ? prazo : null, revisar_em, motivos, atencao });
    const base = Number(ctx.compra_mensal) > 0 ? Number(ctx.compra_mensal) : Number(ctx.maior_mes) > 0 ? Number(ctx.maior_mes) : P.compraPadrao;
    if (!(Number(ctx.compra_mensal) > 0)) motivos.push(Number(ctx.maior_mes) > 0 ? 'compra do mês pelo histórico: ' + R.moeda(base) : 'sem compra prevista: considerei ' + R.moeda(base) + ' por mês');
    (k.alertas || []).forEach(a => a && atencao.push(a));
    if (k.mudanca_societaria) atencao.push(k.mudanca_societaria);
    if (Number(ctx.vencido) > 0) { motivos.push('tem ' + R.moeda(ctx.vencido) + ' vencido com a OneClean'); return fim('analise'); }
    if (k.situacao_cadastral && !/ativ/i.test(k.situacao_cadastral)) { motivos.push('CNPJ ' + k.situacao_cadastral + ' na Receita'); return fim('vista'); }
    const neg = [];
    if (k.pendencias_qtd > 0) neg.push(k.pendencias_qtd + ' pendência(s) financeira(s)' + (k.pendencias_valor ? ' (' + R.moeda(k.pendencias_valor) + ')' : ''));
    if (k.protestos_qtd > 0) neg.push(k.protestos_qtd + ' protesto(s)' + (k.protestos_valor ? ' (' + R.moeda(k.protestos_valor) + ')' : ''));
    if (k.cheques_qtd > 0) neg.push(k.cheques_qtd + ' cheque(s) sem fundo/sustado(s)');
    if (k.acoes_qtd > 0) neg.push(k.acoes_qtd + ' ação(ões) judicial(is)');
    if (k.falencia) neg.push('falência ou recuperação judicial');
    if (k.fraude) neg.push('alerta de fraude');
    if (neg.length) { motivos.push('restrição na consulta: ' + neg.join(', ')); return fim('vista'); }
    const score = Number(k.score) || 0;
    if (!score) { motivos.push('a consulta não trouxe score'); return fim('analise'); }
    if (score < P.scoreMinimo) { motivos.push('score ' + score + ' (abaixo de ' + P.scoreMinimo + ')'); return fim('vista'); }
    let degrau = score >= P.scoreBom ? 2 : 1;
    motivos.push('score ' + score + (k.prob_inadimplencia >= 0 ? ' (' + String(k.prob_inadimplencia).replace('.', ',') + '% de chance de atrasar)' : ''));
    if (k.pontualidade >= 0 && k.pontualidade < P.pontualMinima) { degrau--; motivos.push('pontualidade ' + k.pontualidade + '% (abaixo de ' + P.pontualMinima + '%)'); }
    if (k.atraso_mais_60) { degrau--; motivos.push('atraso acima de 60 dias no último ano'); }
    if (degrau <= 0) return fim('vista');
    const idade = meses(k.fundacao, hoje), mudou = meses(k.mudanca_em, hoje);
    if (idade != null && idade < 12) { degrau = 1; motivos.push('empresa com menos de 1 ano'); }
    if (mudou != null && mudou < 12) { degrau = 1; motivos.push('mudança de sócio ou razão social há menos de 1 ano'); }
    let limite = teto(base * degrau, P.arredonda);
    motivos.push((degrau === 2 ? '2 meses' : '1 mês') + ' de compra: ' + R.moeda(limite));
    if (k.limite_sugerido > 0) {
      const t = piso(k.limite_sugerido * P.tetoDoBureau, P.arredonda);
      if (t < P.arredonda) { motivos.push('limite da consulta baixo demais (' + R.moeda(k.limite_sugerido) + ')'); return fim('vista'); }
      if (limite > t) { limite = t; motivos.push('limitado a 10% do limite da consulta: ' + R.moeda(t)); }
    }
    return fim('prazo', limite, degrau === 2 ? 28 : 21);
  }

  // Fatos da consulta em linhas curtas (para a conferência e a ficha).
  function resumoFatos(k) {
    if (!k) return [];
    const l = [];
    if (k.score) l.push('Score ' + k.score + (k.prob_inadimplencia >= 0 ? ' · ' + String(k.prob_inadimplencia).replace('.', ',') + '% de chance de atrasar' : ''));
    if (k.recomendacao) l.push('Recomendação da consulta: ' + k.recomendacao);
    const neg = (k.pendencias_qtd || 0) + (k.protestos_qtd || 0) + (k.cheques_qtd || 0) + (k.acoes_qtd || 0) + (k.falencia ? 1 : 0) + (k.fraude ? 1 : 0);
    l.push(neg ? 'Restrições: ' + [k.pendencias_qtd ? k.pendencias_qtd + ' pendência(s)' : '', k.protestos_qtd ? k.protestos_qtd + ' protesto(s)' : '', k.cheques_qtd ? k.cheques_qtd + ' cheque(s)' : '',
      k.acoes_qtd ? k.acoes_qtd + ' ação(ões)' : '', k.falencia ? 'falência/recuperação' : '', k.fraude ? 'alerta de fraude' : ''].filter(Boolean).join(', ') : 'Sem restrições, protestos, cheques ou ações');
    if (k.pontualidade >= 0) l.push('Pagamento pontual: ' + k.pontualidade + '%' + (k.atraso_mais_60 ? ' · com atraso acima de 60 dias' : ''));
    if (k.limite_sugerido > 0) l.push('Limite sugerido pela consulta: ' + R.moeda(k.limite_sugerido));
    if (k.faturamento_presumido) l.push('Faturamento presumido: ' + k.faturamento_presumido);
    if (k.fundacao) l.push('Fundada em ' + R.dataBR(k.fundacao));
    if (k.consultas_12m) l.push(k.consultas_12m + ' consulta(s) ao CNPJ em 12 meses');
    return l;
  }

  // O que a equipe vê (crm_credito_ver sem score nem relatório).
  function textoEquipe(v) {
    if (!v || !v.ligado) return '';
    if (v.situacao === 'sem_ficha') return 'Sem análise de crédito: pedido a prazo fica bloqueado até o administrador analisar.';
    if (v.situacao === 'analise') return 'Crédito em análise: pedido a prazo fica bloqueado até o administrador liberar.';
    if (v.situacao === 'vista') return 'Só à vista (pix, transferência ou antecipado).';
    return 'Crédito disponível: ' + R.moeda(v.disponivel || 0) + (v.prazo_max ? ' · prazo até ' + v.prazo_max + ' dias' : '');
  }

  const C = { POLITICA, SITUACOES, BLOQUEIOS, propor, resumoFatos, textoEquipe };
  raiz.CRMCredito = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  if (typeof document === 'undefined' || !raiz.CRM) return;

  // ================================================================== tela (só no navegador)
  const CRM = raiz.CRM, esc = s => CRM.esc(s);
  let painel = null, carregando = false, lidoEm = 0;
  const cacheVer = new Map();
  const cfg = () => (((CRM.estado && CRM.estado.cfg) || {}).credito) || {};
  const linkConsulta = () => cfg().url || '';

  async function carrega(forca) {
    if (carregando || (!forca && painel && Date.now() - lidoEm < 60000)) return;
    carregando = true;
    try { painel = await CRM.store().creditoPainel(); lidoEm = Date.now(); } catch (e) { CRM.falhou(e); painel = painel || { fichas: [], pendentes: [], sugestoes: [] }; }
    finally { carregando = false; }
    if (CRM.estado.aba === 'caixa') CRM.render();
  }

  function seloSit(s) { return CRM.selo(SITUACOES[s] || s, s === 'prazo' ? 'verde' : s === 'vista' ? 'ambar' : 'cinza'); }
  const docTxt = e => (e && e.cnpj) || '';

  function aba() {
    if (!painel) { setTimeout(() => carrega(), 0); return '<section class="cartao"><p class="vazio">Carregando o crédito…</p></section>'; }
    const c = cfg(), lig = !!c.ligado, h = CRM.hoje();
    const fichas = painel.fichas || [], pend = painel.pendentes || [], sug = painel.sugestoes || [];
    const vencidas = fichas.filter(f => f.revisar_em && f.revisar_em < h);
    const perto = fichas.filter(f => f.situacao === 'prazo' && f.limite > 0 && f.usado >= f.limite * 0.8);
    return '<section class="cartao cred-topo"><h2>Crédito dos clientes</h2>' +
      '<p>Cliente novo: <strong>1.</strong> "Analisar" abre o site de consulta com o CNPJ copiado (cole e consulte) · <strong>2.</strong> baixe o PDF e solte na janela que abriu no CRM · ' +
      '<strong>3.</strong> confira a proposta (score, restrições, pontualidade) e aprove. A trava vale no pedido a prazo: SEM ANÁLISE, PRAZO e LIMITE, que só você libera.</p>' +
      '<p class="cred-liga">' + (lig ? CRM.selo('trava ligada', 'verde') + ' <button type="button" class="btn sec" data-acao="cred-ligar">Desligar a trava</button>'
        : CRM.selo('trava desligada', 'cinza') + ' <button type="button" class="btn" data-acao="cred-ligar">Ligar a trava nos pedidos</button>' +
          ' <small>antes, aplique as sugestões dos clientes que já compram (abaixo), senão todo pedido a prazo deles para em SEM ANÁLISE</small>') +
      ' ' + linkConsultar('', 'Abrir o site de consulta', 'btn sec') + ' <button type="button" class="mini" data-acao="cred-endereco" title="trocar o endereço do site de consulta">✎ endereço</button>' +
      ' <button type="button" class="btn sec" data-acao="cred-atualiza" title="atualizar">⟳</button></p>' +
      '<p><label class="cred-busca">Analisar um cliente: <input type="search" id="credBusca" list="credEmpresas" placeholder="nome ou CNPJ"></label>' +
        '<datalist id="credEmpresas">' + ((CRM.estado.D.empresas) || []).filter(e => e.cnpj).slice(0, 4000).map(e => '<option value="' + esc(e.nome + ' · ' + e.cnpj) + '">').join('') + '</datalist>' +
        ' <button type="button" class="btn" data-acao="cred-buscar">Analisar</button></p></section>' +
      (pend.length ? '<section class="cartao"><h2>Para analisar <small>' + pend.length + '</small></h2><div class="tabela-rolagem"><table class="tabela"><tbody>' +
        pend.map(p => '<tr><td><button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(p.empresa_id) + '">' + esc(p.nome) + '</button><small>' + esc(p.cnpj || '') + ' · cadastro ' + esc(R.dataBR(R.diaLocal(p.criado_em))) + '</small></td>' +
          '<td>' + ((p.pedidos || []).map(x => 'pedido ' + x.numero + ' · ' + R.moeda(x.valor) + ' · ' + (x.bloqueios || []).filter(b => BLOQUEIOS.indexOf(b) !== -1).join(', ')).map(esc).join('<br>') || '<small>cliente novo sem análise</small>') + '</td>' +
          '<td class="acoes-linha">' + linkConsultar(p.empresa_id, 'Analisar', 'mini', 'cred-analisar-site') + '</td></tr>').join('') +
        '</tbody></table></div></section>' : '') +
      (sug.length ? '<section class="cartao"><h2>Clientes que já compram <small>' + sug.length + ' sem ficha · sugestão pelo histórico</small></h2>' +
        '<p>Limite = 2 × a maior compra do mês nos últimos 12 meses (de 500 em 500), prazo = o maior que o cliente usa hoje (mínimo 28 dias). Quem tem título vencido fica "em análise". Revisão em 6 meses.</p>' +
        '<p><button type="button" class="btn" data-acao="cred-aplicar">Aplicar as ' + sug.length + ' sugestões</button> <small>Dá para mudar qualquer um depois, um a um.</small></p>' +
        '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Cliente</th><th class="num">Maior mês</th><th class="num">Em aberto</th><th>Sugestão</th><th></th></tr></thead><tbody>' +
        sug.slice(0, 60).map(s => '<tr><td><button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(s.empresa_id) + '">' + esc(s.nome) + '</button><small>' + s.meses + ' mês(es) com compra · última ' + esc(R.dataBR(R.diaLocal(s.ultima))) + '</small></td>' +
          '<td class="num">' + esc(R.moeda(s.maior_mes)) + '</td><td class="num">' + esc(R.moeda(s.aberto)) + (s.vencido > 0 ? '<small class="cx-neg">vencido ' + esc(R.moeda(s.vencido)) + '</small>' : '') + '</td>' +
          '<td>' + seloSit(s.situacao) + (s.situacao === 'prazo' ? ' ' + esc(R.moeda(s.limite)) + ' · ' + s.prazo_max + ' dias' : '') + '</td>' +
          '<td class="acoes-linha"><button type="button" class="mini" data-acao="cred-analisar" data-id="' + esc(s.empresa_id) + '">Ajustar</button></td></tr>').join('') +
        '</tbody></table></div>' + (sug.length > 60 ? '<p class="mais">mostrando os 60 que mais compram</p>' : '') + '</section>' : '') +
      '<section class="cartao"><h2>Fichas de crédito <small>' + fichas.length + (vencidas.length ? ' · ' + vencidas.length + ' com revisão vencida' : '') + (perto.length ? ' · ' + perto.length + ' perto do limite' : '') + '</small></h2>' +
      (fichas.length ? filtrosFichas(fichas) + '<div id="credFichas">' + tabelaFichas(fichas) + '</div>' : '<p class="vazio">Nenhuma ficha ainda.</p>') + '</section>';
  }

  // Fichas: busca por nome/CNPJ, filtro por situação e ordenação pela coluna (27/10/2026, pedido do Anderson:
  // "clicando em situação, vem todos os bloqueados para eu dar uma verificada rápida").
  const vf = { busca: '', filtro: '', ordem: 'nome', desc: false };
  const FILTROS = [['', 'Todas'], ['prazo', 'A prazo'], ['vista', 'Só à vista'], ['analise', 'Em análise'], ['vencido', 'Com título vencido'],
    ['perto', 'Perto do limite'], ['revisar', 'Revisão vencida'], ['historico', 'Pelo histórico'], ['consulta', 'Pela consulta']];
  const dispDe = f => Math.max(0, Number(f.limite) - Number(f.usado));
  function passa(f, h) {
    const k = vf.filtro;
    if (k === 'prazo' || k === 'vista' || k === 'analise') { if (f.situacao !== k) return false; }
    else if (k === 'vencido') { if (!(f.vencido > 0)) return false; }
    else if (k === 'perto') { if (!(f.situacao === 'prazo' && f.limite > 0 && f.usado >= f.limite * 0.8)) return false; }
    else if (k === 'revisar') { if (!(f.revisar_em && f.revisar_em < h)) return false; }
    else if (k === 'historico' || k === 'consulta') { if (f.origem !== k) return false; }
    const t = vf.busca.trim();
    if (!t) return true;
    const dig = t.replace(/[^0-9A-Za-z]/g, '').toUpperCase(), cnpj = String(f.cnpj || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    return R.normaliza(String(f.nome || '')).indexOf(R.normaliza(t)) !== -1 || (dig.length >= 3 && /\d/.test(dig) && cnpj.indexOf(dig) !== -1);
  }
  function filtrosFichas(fichas) {
    const h = CRM.hoje(), conta = k => { const a = vf.filtro; vf.filtro = k; const b = vf.busca; vf.busca = ''; const n = fichas.filter(f => passa(f, h)).length; vf.filtro = a; vf.busca = b; return n; };
    return '<div class="filtro-linha cred-filtros"><input type="search" id="credFiltroBusca" placeholder="procurar por nome ou CNPJ" value="' + esc(vf.busca) + '">' +
      FILTROS.map(([k, r]) => { const n = conta(k); return k && !n ? '' : '<button type="button" class="chip-filtro' + (vf.filtro === k ? ' ativo' : '') + '" data-acao="cred-filtro" data-id="' + k + '">' + esc(r) + ' (' + n + ')</button>'; }).join('') + '</div>';
  }
  function tabelaFichas(fichas) {
    const h = CRM.hoje();
    const chave = { nome: f => R.normaliza(String(f.nome || '')), situacao: f => ({ analise: 0, vista: 1, prazo: 2 }[f.situacao]) + R.normaliza(String(f.nome || '')),
      limite: f => Number(f.limite), usado: f => Number(f.usado), disp: f => (f.situacao === 'prazo' ? dispDe(f) : -1), prazo: f => Number(f.prazo_max || 0), revisar: f => f.revisar_em || '' }[vf.ordem];
    const l = fichas.filter(f => passa(f, h)).sort((a, b) => { const x = chave(a), y = chave(b); return (x < y ? -1 : x > y ? 1 : 0) * (vf.desc ? -1 : 1); });
    const th = (k, rot, cls) => '<th' + (cls ? ' class="' + cls + '"' : '') + '><button type="button" class="ordena' + (vf.ordem === k ? ' ativo' : '') + '" data-acao="cred-ordem" data-id="' + k + '">' + esc(rot) + (vf.ordem === k ? (vf.desc ? ' ▼' : ' ▲') : '') + '</button></th>';
    if (!l.length) return '<p class="vazio">Nenhuma ficha com esse filtro.</p>';
    return '<div class="tabela-rolagem"><table class="tabela"><thead><tr>' + th('nome', 'Cliente') + th('situacao', 'Situação') + th('limite', 'Limite', 'num') + th('usado', 'Usado', 'num') +
      th('disp', 'Disponível', 'num') + th('prazo', 'Prazo') + th('revisar', 'Revisar') + '<th></th></tr></thead><tbody>' +
      l.slice(0, 500).map(f => {
        const disp = dispDe(f), venc = f.revisar_em && f.revisar_em < h;
        return '<tr><td><button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(f.empresa_id) + '">' + esc(f.nome) + '</button><small>' + esc(f.cnpj || '') + ' · ' + esc({ consulta: 'pela consulta', historico: 'pelo histórico', manual: 'à mão' }[f.origem] || '') + (f.score ? ' · score ' + f.score : '') + '</small></td>' +
          '<td>' + seloSit(f.situacao) + (f.vencido > 0 ? ' ' + CRM.selo('vencido ' + R.moeda(f.vencido), 'vermelho') : '') + '</td>' +
          '<td class="num">' + (f.situacao === 'prazo' ? esc(R.moeda(f.limite)) : '—') + '</td><td class="num">' + esc(R.moeda(f.usado)) + '</td>' +
          '<td class="num' + (f.situacao === 'prazo' && disp < Number(f.limite) * 0.2 ? ' cx-neg' : '') + '">' + (f.situacao === 'prazo' ? esc(R.moeda(disp)) : '—') + '</td>' +
          '<td>' + (f.prazo_max ? f.prazo_max + ' dias' : '—') + '</td><td>' + (venc ? CRM.selo(R.dataBR(f.revisar_em), 'ambar') : esc(R.dataBR(f.revisar_em || ''))) + '</td>' +
          '<td class="acoes-linha">' + (f.pdf ? '<button type="button" class="mini" data-acao="cred-pdf" data-id="' + esc(f.empresa_id) + '">Consulta</button> ' : '') +
            '<button type="button" class="mini" data-acao="cred-analisar" data-id="' + esc(f.empresa_id) + '">' + (venc ? 'Revisar' : 'Editar') + '</button></td></tr>';
      }).join('') + '</tbody></table></div>' + (l.length > 500 ? '<p class="mais">mostrando 500 de ' + l.length + ': use a busca</p>' : '<p class="mais">' + l.length + ' ficha(s)</p>');
  }
  function depoisAba(el) {
    carrega();
    const b = el.querySelector('#credBusca');
    if (b) b.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); CRM.acoes['cred-buscar'](); } });
    // a busca redesenha só a tabela (redesenhar a tela tiraria o cursor da caixa)
    const fb = el.querySelector('#credFiltroBusca'), alvo = el.querySelector('#credFichas');
    if (fb && alvo) fb.addEventListener('input', () => { vf.busca = fb.value; alvo.innerHTML = tabelaFichas((painel && painel.fichas) || []); });
  }

  // Botão "Consultar crédito": um link de verdade (<a target=_blank>), que o navegador abre sem bloquear; o clique só
  // copia o CNPJ. Sem endereço configurado, vira botão que pede o endereço.
  // acao 'cred-analisar-site' (27/10/2026, pedido do Anderson: "só deixar o Analisar"): o mesmo clique abre o site com o
  // CNPJ copiado e a janela da análise no CRM, onde se solta o PDF.
  function linkConsultar(id, rotulo, cls, acao) {
    const u = linkConsulta();
    if (!u) return '<button type="button" class="' + cls + '" data-acao="' + (acao ? 'cred-analisar' : 'cred-endereco') + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + '>' + esc(rotulo) + '</button>';
    return '<a class="' + cls + '" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" data-acao="' + (acao || 'cred-consultar') + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + '>' + esc(rotulo) + '</a>';
  }
  function consultar(id) {
    const e = id && CRM.empresa(id), doc = docTxt(e);
    if (doc && navigator.clipboard) navigator.clipboard.writeText(R.chaveDoc ? R.chaveDoc(doc) : doc.replace(/\D/g, '')).then(() => CRM.toast('CNPJ ' + doc + ' copiado: cole no site de consulta (Ctrl+V). Depois solte o PDF em "Analisar".')).catch(() => {});
    else if (doc) CRM.toast('CNPJ do cliente: ' + doc);
  }

  // Formulário da análise: consulta (PDF lido pela IA) → proposta pela política → aprovar.
  async function analisar(id, siteAberto) {
    const e = CRM.empresa(id);
    if (!e) { CRM.toast('Cliente não encontrado (fora da sua lista?).', true); return; }
    let atual = null;
    try { atual = await CRM.store().creditoVer(id); } catch (err) { /* sem ficha */ }
    const ficha = atual && atual.situacao !== 'sem_ficha' ? atual : null;
    const s = (painel && (painel.sugestoes || []).find(x => x.empresa_id === id)) || null;
    const ctx = { maior_mes: s ? s.maior_mes : 0, vencido: s ? s.vencido : (ficha ? 0 : 0), hoje: CRM.hoje() };
    let lida = ficha && ficha.resumo && ficha.resumo.consulta ? ficha.resumo.consulta : null, pdf = null;
    const fatos = () => '<div id="credFatos" class="cred-fatos">' + (lida ? '<ul>' + resumoFatos(lida).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p class="dica">Ainda sem consulta: solte o PDF acima ou preencha à mão.</p>') + '</div>';
    const prop = p => '<div id="credProposta" class="cred-proposta">' + (p ? '<p><strong>Proposta pela política:</strong> ' + seloSit(p.situacao) + (p.situacao === 'prazo' ? ' ' + esc(R.moeda(p.limite)) + ' · ' + p.prazo_max + ' dias' : '') + '</p>' +
      '<ul>' + p.motivos.map(m => '<li>' + esc(m) + '</li>').join('') + '</ul>' + (p.atencao.length ? '<p class="alerta"><strong>Atenção:</strong> ' + esc(p.atencao.join(' · ')) + '</p>' : '') : '') + '</div>';
    const v0 = ficha ? { situacao: ficha.situacao, limite: ficha.limite, prazo_max: ficha.prazo_max, revisar_em: ficha.revisar_em, obs: ficha.obs || '' }
      : s ? { situacao: s.situacao, limite: s.limite, prazo_max: s.prazo_max } : { situacao: 'analise' };
    CRM.abrirForm({
      titulo: 'Crédito: ' + e.nome, largura: 'largo',
      htmlAntes: '<div class="cred-form"><p>' + esc(e.cnpj || 'sem CNPJ') + (ficha ? ' · ficha de ' + esc(R.dataBR(ficha.analisado_em)) + ' · usado hoje ' + esc(R.moeda(ficha.usado || 0)) : s ? ' · em aberto ' + esc(R.moeda(s.aberto)) : '') + '</p>' +
        (siteAberto ? '<p class="dica"><strong>O site da consulta abriu numa aba nova, com o CNPJ copiado:</strong> cole no Documento (Ctrl+V), clique em Consulta, baixe o PDF e solte aqui.</p>' : '') +
        '<div class="cred-passos">' + linkConsultar(id, siteAberto ? 'Abrir o site de novo' : '1. Consultar crédito (copia o CNPJ)', 'btn sec') +
        '<label class="btn sec arquivo">2. Soltar o PDF da consulta<input type="file" id="credArq" accept="application/pdf,image/png,image/jpeg,image/webp"></label>' +
        '<span id="credLendo"></span></div>' + fatos() + prop(lida ? propor(lida, ctx) : null) + '</div>',
      campos: [
        { nome: 'compra', rotulo: 'Compra prevista por mês (R$)', tipo: 'numero', terco: true, ajuda: 'o que o cliente deve comprar por mês; sem isso, vale o histórico ou R$ 1.500' },
        { nome: 'situacao', rotulo: 'Situação', tipo: 'select', obrigatorio: true, terco: true, opcoes: [['prazo', SITUACOES.prazo], ['vista', SITUACOES.vista], ['analise', SITUACOES.analise]] },
        { nome: 'limite', rotulo: 'Limite (R$)', tipo: 'numero', terco: true },
        { nome: 'prazo_max', rotulo: 'Prazo máximo (dias)', tipo: 'numero', passo: '1', max: 365, terco: true, vazioNulo: true },
        { nome: 'revisar_em', rotulo: 'Revisar em', tipo: 'data', terco: true },
        { nome: 'obs', rotulo: 'Observação', tipo: 'textarea', largo: true, linhas: 2 }
      ],
      valores: v0, salvarTexto: 'Aprovar',
      extras: form => {
        const aplica = () => {
          if (!lida) return;
          const comp = Number(String(form.elements.compra.value || '').replace(',', '.')) || 0;
          const p = propor(lida, Object.assign({}, ctx, { compra_mensal: comp }));
          form.querySelector('#credProposta').outerHTML = prop(p);
          form.elements.situacao.value = p.situacao; form.elements.limite.value = p.limite; form.elements.prazo_max.value = p.prazo_max == null ? '' : p.prazo_max;
          form.elements.revisar_em.value = p.revisar_em;
        };
        form.elements.compra.addEventListener('change', aplica);
        const arq = form.querySelector('#credArq'), st = form.querySelector('#credLendo');
        const le = async f => {
          if (!f) return;
          st.textContent = 'Lendo a consulta…';
          try {
            pdf = await CRM.store().creditoEnviar(f, id);
            const r = await CRM.store().creditoLer(pdf);
            lida = r.consulta;
            form.querySelector('#credFatos').outerHTML = fatos();
            st.textContent = r.aviso ? '⚠ ' + r.aviso : (lida.razao_social ? 'Lido: ' + lida.razao_social : 'Lido.');
            const docLido = lida.documento, docCad = R.chaveDoc ? R.chaveDoc(e.cnpj || '') : String(e.cnpj || '').replace(/\D/g, '');
            if (docLido && docCad && docLido !== docCad) st.textContent = '⚠ O CNPJ da consulta (' + docLido + ') não é o do cadastro (' + docCad + '). Confira antes de aprovar.';
            aplica();
          } catch (err) { st.textContent = ''; CRM.falhou(err); }
        };
        arq.addEventListener('change', () => { const f = arq.files[0]; arq.value = ''; le(f); });
        const zona = form.querySelector('.cred-passos');
        zona.addEventListener('dragover', ev => { if (ev.dataTransfer && [].slice.call(ev.dataTransfer.types || []).indexOf('Files') !== -1) { ev.preventDefault(); zona.classList.add('cx-solta'); } });
        zona.addEventListener('dragleave', () => zona.classList.remove('cx-solta'));
        zona.addEventListener('drop', ev => { const f = ev.dataTransfer && ev.dataTransfer.files[0]; if (!f) return; ev.preventDefault(); zona.classList.remove('cx-solta'); le(f); });
      },
      aoSalvar: async v => {
        if (v.situacao === 'prazo' && !(v.limite > 0)) throw new Error('para liberar a prazo, diga o limite');
        await CRM.store().creditoGravar([{ empresa_id: id, situacao: v.situacao, limite: v.situacao === 'prazo' ? v.limite : 0, prazo_max: v.situacao === 'prazo' ? v.prazo_max : null,
          revisar_em: v.revisar_em || null, score: lida && lida.score ? lida.score : null, origem: lida ? 'consulta' : 'manual',
          resumo: lida ? { consulta: lida, compra_mensal: v.compra || null } : null, pdf, obs: v.obs || '' }]);
        cacheVer.delete(id);
        CRM.toast('Crédito de ' + e.nome + ' aprovado: ' + (SITUACOES[v.situacao] || v.situacao) + (v.situacao === 'prazo' ? ' · ' + R.moeda(v.limite) : '') + '.');
        carrega(true);
      }
    });
  }

  // Bloco na ficha do cliente: preenchido depois de abrir (a leitura é por função do banco).
  function blocoFicha(id) { return '<section class="credito" data-credito="' + esc(id) + '"></section>'; }
  async function preencheFicha(raizEl, id) {
    const el = raizEl && raizEl.querySelector('[data-credito="' + id + '"]');
    if (!el || CRM.store().modo !== 'supabase') return;
    let v = cacheVer.get(id);
    try { if (!v || Date.now() - v.em > 60000) { v = { em: Date.now(), d: await CRM.store().creditoVer(id) }; cacheVer.set(id, v); } } catch (e) { return; }
    const d = v.d;
    if (!d) return;
    if (!CRM.ehGestor()) { const t = textoEquipe(d); el.innerHTML = t ? '<h3>Crédito</h3><p class="resumo-compras">' + esc(t) + '</p>' : ''; return; }
    const editar = !CRM.ehAdmin() ? '' : d.situacao === 'sem_ficha' ? ' ' + linkConsultar(id, 'Analisar', 'mini', 'cred-analisar-site')
      : ' <button type="button" class="mini" data-acao="cred-analisar" data-id="' + esc(id) + '">Editar</button>';
    el.innerHTML = '<h3>Crédito' + editar + '</h3><p class="resumo-compras">' + (d.situacao === 'sem_ficha' ? 'Sem análise de crédito' + (d.ligado ? ': pedido a prazo fica bloqueado.' : '.')
      : seloSit(d.situacao) + (d.situacao === 'prazo' ? ' limite <strong>' + esc(R.moeda(d.limite)) + '</strong> · usado ' + esc(R.moeda(d.usado)) + ' · disponível <strong>' + esc(R.moeda(d.disponivel)) + '</strong>' + (d.prazo_max ? ' · até ' + d.prazo_max + ' dias' : '') : '') +
        (d.score ? '<br>score ' + d.score : '') + (d.analisado_em ? ' · analisado em ' + esc(R.dataBR(d.analisado_em)) : '') + (d.revisao_vencida ? ' ' + CRM.selo('revisão vencida', 'ambar') : '') +
        (d.obs ? '<br><em>' + esc(d.obs) + '</em>' : '')) + (d.ligado ? '' : '<br><small>trava de crédito desligada (Caixa → Crédito)</small>') + '</p>';
  }

  CRM.credito = { aba, depoisAba, blocoFicha, preencheFicha, contagem: () => (painel ? (painel.pendentes || []).length : 0), consultar, analisar };

  Object.assign(CRM.acoes, {
    'cred-atualiza': () => carrega(true),
    'cred-filtro': id => { vf.filtro = id || ''; CRM.render(); },
    'cred-ordem': id => { if (vf.ordem === id) vf.desc = !vf.desc; else { vf.ordem = id; vf.desc = ['limite', 'usado', 'disp'].indexOf(id) !== -1; } CRM.render(); },
    'cred-endereco': async () => {
      const c = cfg(), u = prompt('Endereço do site de consulta de crédito (onde você faz a pesquisa):', c.url || '');
      if (u == null) return;
      if (u && !/^https:\/\//i.test(u.trim())) { CRM.toast('O endereço precisa começar com https://', true); return; }
      try { await CRM.salvarConfig({ credito: Object.assign({}, c, { url: u.trim() }) }); CRM.toast(u ? 'Endereço salvo.' : 'Endereço apagado.'); } catch (e) { CRM.falhou(e); }
    },
    'cred-consultar': id => consultar(id),
    'cred-analisar': id => { analisar(id).catch(CRM.falhou); },
    'cred-analisar-site': id => { consultar(id); analisar(id, true).catch(CRM.falhou); },
    'cred-buscar': () => {
      const t = String((document.querySelector('#credBusca') || {}).value || '').trim();
      if (!t) return;
      const doc = (t.split('·').pop() || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase(), nome = t.split('·')[0].trim().toLowerCase();
      const l = (CRM.estado.D.empresas || []).filter(e => (doc.length >= 8 && String(e.cnpj || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase() === doc) || String(e.nome || '').toLowerCase() === nome);
      if (!l.length) { CRM.toast('Não achei esse cliente. Escolha da lista (nome · CNPJ).', true); return; }
      // cliente sem ficha: abre o site junto (ainda dentro do clique, senão o navegador bloqueia a aba)
      const semFicha = !((painel && painel.fichas) || []).some(f => f.empresa_id === l[0].id);
      if (semFicha && linkConsulta()) { raiz.open(linkConsulta(), '_blank', 'noopener'); consultar(l[0].id); }
      analisar(l[0].id, semFicha && !!linkConsulta()).catch(CRM.falhou);
    },
    'cred-pdf': async id => {
      const f = ((painel && painel.fichas) || []).find(x => x.empresa_id === id);
      if (!f || !f.pdf) return;
      const w = raiz.open('', '_blank');
      try { const u = await CRM.store().creditoLink(f.pdf); if (w) w.location = u; else raiz.location.assign(u); } catch (e) { if (w) w.close(); CRM.falhou(e); }
    },
    'cred-aplicar': async () => {
      const sug = (painel && painel.sugestoes) || [];
      if (!sug.length) return;
      const pr = sug.filter(s => s.situacao === 'prazo').length;
      if (!confirm('Criar a ficha de crédito de ' + sug.length + ' cliente(s) pelo histórico? ' + pr + ' liberados a prazo, ' + (sug.length - pr) + ' em análise (têm título vencido). Revisão em 6 meses.')) return;
      const itens = sug.map(s => ({ empresa_id: s.empresa_id, situacao: s.situacao, limite: s.limite, prazo_max: s.situacao === 'prazo' ? s.prazo_max : null, origem: 'historico',
        obs: 'Pelo histórico: maior mês ' + R.moeda(s.maior_mes) + ' em ' + s.meses + ' mês(es) com compra' }));
      try {
        let n = 0;
        for (let i = 0; i < itens.length; i += 200) n += await CRM.store().creditoGravar(itens.slice(i, i + 200));
        cacheVer.clear();
        CRM.toast(n + ' ficha(s) de crédito criadas.');
        carrega(true);
      } catch (e) { CRM.falhou(e); }
    },
    'cred-ligar': async () => {
      const c = cfg(), liga = c.ligado !== true;
      const semFicha = ((painel && painel.sugestoes) || []).length;
      if (liga && !confirm('Ligar a trava de crédito? Pedido a prazo de cliente sem ficha, só à vista, com prazo maior que o permitido ou acima do limite fica BLOQUEADO até você liberar.' +
        (semFicha ? '\n\nAinda há ' + semFicha + ' cliente(s) que já compram sem ficha: os pedidos a prazo deles vão parar em SEM ANÁLISE.' : ''))) return;
      try { await CRM.salvarConfig({ credito: Object.assign({}, c, { ligado: liga }) }); await CRM.store().pedidosAtualizar(); cacheVer.clear(); CRM.toast(liga ? 'Trava de crédito ligada.' : 'Trava de crédito desligada.'); carrega(true); }
      catch (e) { CRM.falhou(e); }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
