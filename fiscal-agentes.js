/* CRM Sistemi Dalessi — Fiscal dos agentes (06/11/2026). Anderson: "nada pode simplesmente travar ou parar de funcionar,
   e ninguém aqui fica em cima disso". Configurações → Fiscal dos agentes (só o administrador): o que está travado agora
   (conferido de hora em hora pelo banco, crm_fiscal_conferir), o que se resolveu, os prazos dos próximos dias e os
   aparelhos que recebem o aviso no celular (Web Push, exceção nº 11 da regra de envio do CLAUDE.md: só os aparelhos do
   Anderson). O link "#agentes" (o toque na notificação) abre direto aqui. */
(function () {
  'use strict';
  const CRM = window.CRM, R = window.CRMRegras;
  const { esc } = CRM;
  let sit = null, carregando = false, erro = null, gn = null;

  const quando = v => { if (!v) return '—'; const d = new Date(String(v).replace(' ', 'T')); return isNaN(d) ? esc(v) : esc(R.dataBR(R.diaLocal(d.toISOString())) + ' ' + R.horaLocal(d.toISOString())); };
  const dataBR = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');
  const b64 = s => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); const b = atob(t + '==='.slice((t.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const suporta = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

  async function carrega() {
    if (carregando) return; carregando = true;
    try { sit = await CRM.store().fiscalAgentes({ acao: 'situacao' }); erro = null; } catch (e) { erro = e.message; }
    try { gn = await leGnre(); } catch (e) { gn = { erro: e.message }; }
    carregando = false; CRM.render();
  }

  async function esteAparelho() {
    if (!suporta()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }

  async function inscrever() {
    if (!suporta()) throw new Error('Este navegador não recebe avisos. No iPhone: abra o CRM no Safari, toque em Compartilhar → "Adicionar à Tela de Início", abra o CRM pelo ícone e clique aqui de novo.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('O aviso foi bloqueado no navegador. Libere as notificações do CRM nas configurações do navegador e tente de novo.');
    const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('sw.js'));
    await navigator.serviceWorker.ready;
    let s = await reg.pushManager.getSubscription();
    if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(sit.chave_publica) });
    const nome = (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : /Windows/.test(navigator.userAgent) ? 'Windows' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Navegador') +
      ' · ' + new Date().toLocaleDateString('pt-BR');
    await CRM.store().fiscalAgentes({ acao: 'inscrever', inscricao: s.toJSON(), aparelho: nome });
    CRM.toast('Pronto: este aparelho recebe os avisos do fiscal. Mande um teste para conferir.');
    await carrega();
  }

  async function sair() {
    const s = await esteAparelho();
    if (s) { await CRM.store().fiscalAgentes({ acao: 'sair', endpoint: s.endpoint }); await s.unsubscribe().catch(() => null); }
    CRM.toast('Este aparelho não recebe mais os avisos do fiscal.');
    await carrega();
  }

  // GNRE do DIFAL (06/11/2026): as guias que o robô gerou (crm_gnre), as notas com DIFAL dos últimos 60 dias e a chave do robô
  async function leGnre() {
    const sb = CRM.store().sb, desde = new Date(Date.now() - 60 * 864e5).toISOString();
    const [g, n, c] = await Promise.all([
      sb.from('crm_gnre').select('id, nfe_id, nota, uf, receita, valor, valor_fcp, situacao, motivo, linha_digitavel, pdf_caminho, vencimento, gerada_em, atualizado_em').order('criado_em', { ascending: false }).limit(100),
      sb.from('crm_nfe').select('id, serie, numero, ambiente, autorizada_em, totais').eq('situacao', 'autorizada').eq('ambiente', 'producao').gte('autorizada_em', desde).order('autorizada_em', { ascending: false }).limit(1500),
      sb.from('crm_config').select('dados').eq('id', 1).maybeSingle()]);
    if (g.error) throw g.error;
    const difal = ((n.data) || []).filter(x => Number((x.totais || {}).vICMSUFDest || 0) + Number((x.totais || {}).vFCPUFDest || 0) > 0);
    return { guias: g.data || [], notas: difal, cfg: ((c.data && c.data.dados) || {}).gnre || {} };
  }
  const SIT_GNRE = { preparada: ['preparada', 'cinza'], enviada: ['no portal…', 'ambar'], gerada: ['gerada: pagar', 'ambar'], paga: ['paga', 'verde'], rejeitada: ['recusada', 'vermelho'], erro: ['erro', 'vermelho'], cancelada: ['cancelada', 'cinza'] };
  function gnreHtml() {
    if (!gn) return '';
    if (gn.erro) return '<section class="cartao"><h2>GNRE do DIFAL</h2><p class="vazio">Não consegui ler as guias: ' + esc(gn.erro) + '</p></section>';
    const lig = gn.cfg.ligado === true, porNota = {};
    gn.guias.forEach(g => { (porNota[g.nfe_id] = porNota[g.nfe_id] || []).push(g); });
    const semGuia = gn.notas.filter(x => !porNota[x.id]);
    const moeda = v => R.moeda(Number(v || 0));
    return '<section class="cartao"><h2>GNRE do DIFAL</h2>' +
      '<p>Venda a consumidor final de outro estado (hoje, o RS) paga o ICMS DIFAL por nota, <strong>antes de a mercadoria sair</strong>. Com o robô ligado, ' +
      'a guia sai sozinha no Portal GNRE uns minutos depois da NF-e autorizada: o código de barras vai para a conta "GNRE DIFAL" do Caixa e o PDF fica no 📎. ' +
      '<strong>Pagar é sempre um clique seu</strong> (no Caixa, "Pagar no BB", ou no app do banco). No RS, o aromatizante paga também o FCP (2%) numa guia própria.</p>' +
      '<p>' + (lig ? CRM.selo('robô ligado', 'verde') : CRM.selo('robô desligado', 'cinza')) + ' ' +
      '<button type="button" class="btn ' + (lig ? 'sec' : 'ouro') + '" data-acao="gnre-ligar" data-id="' + (lig ? 'nao' : 'sim') + '">' + (lig ? 'Desligar o robô' : 'Ligar o robô') + '</button> ' +
      '<button type="button" class="btn sec" data-acao="gnre-config">Conferir as regras do RS no portal</button></p>' +
      (lig ? '' : '<p class="dica">Antes de ligar: o CNPJ da OneClean habilitado no Portal GNRE (Automação → Solicitar uso do WebService) e o serviço fiscal da VPS na versão 2026-11-06a ou mais nova. O "Gerar agora" de cada nota funciona mesmo com o robô desligado.</p>') +
      (gn.cfg.consulta ? '<p class="dica">Regras conferidas no portal: ' + Object.keys(gn.cfg.consulta).map(k => esc(k) + ' (' + esc(String(gn.cfg.consulta[k].codigo || '?')) + ', ' + quando(gn.cfg.consulta[k].em) + ')').join(' · ') + '</p>' : '') +
      (gn.guias.length || semGuia.length ? '<table class="tabela"><thead><tr><th>NF</th><th>UF</th><th>Guia</th><th class="num">Valor</th><th>Situação</th><th>Linha digitável / motivo</th><th></th></tr></thead><tbody>' +
        semGuia.map(x => '<tr><td>' + esc(x.serie + '-' + x.numero) + '</td><td>—</td><td>—</td><td class="num">' + moeda(Number(x.totais.vICMSUFDest || 0) + Number(x.totais.vFCPUFDest || 0)) + '</td><td>' +
          CRM.selo('sem guia', 'vermelho') + '</td><td><small>autorizada ' + quando(x.autorizada_em) + '</small></td><td><button type="button" class="btn mini" data-acao="gnre-gerar" data-id="' + esc(x.id) + '">Gerar agora</button></td></tr>').join('') +
        gn.guias.map(g => { const s = SIT_GNRE[g.situacao] || [g.situacao, 'cinza'];
          return '<tr><td>' + esc(g.nota || '') + '</td><td>' + esc(g.uf) + '</td><td>' + (g.receita === '100129' ? 'FCP' : 'DIFAL') + '</td><td class="num">' + moeda(Number(g.valor) + Number(g.valor_fcp || 0)) + '</td><td>' + CRM.selo(s[0], s[1]) + '</td><td><small>' +
            esc(g.situacao === 'gerada' || g.situacao === 'paga' ? (g.linha_digitavel || '') + (g.vencimento ? ' · até ' + dataBR(g.vencimento) : '') : (g.motivo || '')) + '</small></td><td>' +
            (g.pdf_caminho ? '<button type="button" class="mini" data-acao="gnre-pdf" data-id="' + esc(g.id) + '">PDF</button> ' : '') +
            (['erro', 'rejeitada', 'enviada'].includes(g.situacao) ? '<button type="button" class="mini" data-acao="gnre-gerar" data-id="' + esc(g.nfe_id) + '">gerar de novo</button>' : '') + '</td></tr>'; }).join('') +
        '</tbody></table>' : '<p class="vazio">Nenhuma nota com DIFAL nos últimos 60 dias.</p>') + '</section>';
  }

  const nivel = p => p.nivel === 'grave' ? CRM.selo('grave', 'vermelho') : CRM.selo('atenção', 'ambar');

  function tela() {
    if (!CRM.ehAdmin()) return '<div class="cartao"><p class="vazio">Só o administrador vê o fiscal dos agentes.</p></div>';
    if (CRM.store().modo === 'local') return '<div class="cartao"><p class="vazio">O fiscal dos agentes precisa do banco (Supabase). No modo local não existe.</p></div>';
    if (!sit && !erro) { setTimeout(carrega, 0); return '<div class="cartao"><p class="vazio">Carregando…</p></div>'; }
    if (erro && !sit) return '<div class="cartao"><p class="vazio">Não consegui ler o fiscal: ' + esc(erro) + '</p><p><button type="button" class="btn sec" data-acao="agentes-atualizar">Tentar de novo</button></p></div>';
    const ab = sit.abertos || [], res = sit.resolvidos || [], ap = sit.aparelhos || [], pz = sit.prazos || [];
    const graves = ab.filter(p => p.nivel === 'grave').length;
    return '<section class="cartao"><h2>Fiscal dos agentes</h2>' +
      '<p>De hora em hora o CRM confere o <strong>resultado</strong> de tudo o que roda sozinho: agendadores, NF-e na Sefaz, notas de compra (DF-e), boletos e extrato do BB, espelho com a Agilité, cobrança, leads, XML ao contador, pedidos travados, certificado A1, IBPT, contas vencidas e os prazos. ' +
      'Problema <strong>grave</strong> novo vai na hora ao seu celular (7h às 21h); segunda, quarta e sexta às 8h vem o resumo; toda segunda, mesmo sem nada, um "tudo certo".</p>' +
      '<p>' + (ab.length ? CRM.selo(ab.length + ' em aberto' + (graves ? ' · ' + graves + ' grave' + (graves > 1 ? 's' : '') : ''), graves ? 'vermelho' : 'ambar') : CRM.selo('nada travado', 'verde')) +
      ' <small>Última conferência: ' + quando(sit.verificado_em) + ' · rotina da nuvem passou: ' + quando(sit.visita_nuvem) + ' · último aviso: ' + esc(sit.ultimo_aviso ? String(sit.ultimo_aviso).slice(0, 16).replace('T', ' ') : '—') + '</small></p>' +
      '<p><button type="button" class="btn sec" data-acao="agentes-conferir">Conferir agora</button> <button type="button" class="mini" data-acao="agentes-atualizar">atualizar</button></p></section>' +

      '<section class="cartao"><h2>Avisos no celular</h2>' +
      '<p>Clique no celular (com o CRM instalado na tela de início) para ele passar a receber os avisos. Só o administrador recebe; ninguém mais.</p>' +
      '<p><button type="button" class="btn ouro" data-acao="agentes-inscrever">🔔 Receber os avisos neste aparelho</button> ' +
      '<button type="button" class="btn sec" data-acao="agentes-testar"' + (ap.length ? '' : ' disabled') + '>Mandar um aviso de teste</button> ' +
      '<button type="button" class="mini" data-acao="agentes-sair">parar neste aparelho</button></p>' +
      (ap.length ? '<table class="tabela"><thead><tr><th>Aparelho</th><th>Inscrito em</th><th>Último aviso entregue</th><th>Erro</th></tr></thead><tbody>' +
        ap.map(a => '<tr><td>' + esc(a.aparelho || 'aparelho') + '</td><td>' + quando(a.criado_em) + '</td><td>' + quando(a.ultimo_envio) + '</td><td>' + (a.ultimo_erro ? '<small>' + esc(a.ultimo_erro) + '</small>' : '—') + '</td></tr>').join('') + '</tbody></table>'
        : '<p class="vazio">Nenhum aparelho recebe os avisos ainda: sem isso o fiscal confere, mas não consegue te avisar.</p>') + '</section>' +

      '<section class="cartao"><h2>Em aberto</h2>' +
      (ab.length ? '<table class="tabela"><thead><tr><th></th><th>Área</th><th>O que travou</th><th>O que fazer</th><th>Desde</th></tr></thead><tbody>' +
        ab.map(p => '<tr><td>' + nivel(p) + '</td><td>' + esc(p.area) + '</td><td>' + esc(p.texto) + '</td><td><small>' + esc(p.fazer || '') + '</small></td><td>' + quando(p.primeiro_em) + '</td></tr>').join('') + '</tbody></table>'
        : '<p class="vazio">Nada travado agora.</p>') + '</section>' +

      gnreHtml() +

      '<section class="cartao"><h2>Prazos (10 dias para trás e 30 para frente)</h2>' +
      '<p class="dica">Cada prazo diz a situação pelo dado real: guia lançada no Caixa, XML enviado ao contador, contas e títulos do dia. Declaração que só o contador entrega fica "a confirmar" até você marcar. Sem a prova, o prazo vira aviso no dia anterior e grave no dia.</p>' +
      (pz.length ? '<table class="tabela"><thead><tr><th>Dia</th><th>Prazo</th><th>Situação</th><th></th></tr></thead><tbody>' +
        pz.map(x => '<tr><td>' + esc(dataBR(x.data)) + '</td><td>' + esc(x.titulo) + (x.nota ? '<br><small>' + esc(x.nota) + '</small>' : '') + '</td><td>' +
          (x.tipo === 'caixa' ? '<small>' + esc(x.situacao || '') + '</small>' : CRM.selo(x.situacao || '', x.ok ? 'verde' : (x.data <= hoje() ? 'vermelho' : 'ambar'))) + '</td><td>' + botoesPrazo(x) + '</td></tr>').join('') + '</tbody></table>'
        : '<p class="vazio">Nenhum prazo no período.</p>') + '</section>' +

      '<section class="cartao"><h2>Certidões</h2>' +
      '<p class="dica">O fiscal avisa 15 dias antes de vencer e grave quando vencer. Ponha a validade que está no PDF de cada certidão.</p>' +
      ((sit.certidoes || []).length ? '<table class="tabela"><thead><tr><th>Certidão</th><th>Válida até</th><th></th></tr></thead><tbody>' +
        sit.certidoes.map(c => '<tr><td>' + esc(c.nome) + '</td><td>' + esc(dataBR(c.validade)) + '</td><td><button type="button" class="mini" data-acao="agentes-certidao-apagar" data-id="' + esc(c.nome) + '">tirar</button></td></tr>').join('') + '</tbody></table>'
        : '<p class="vazio">Nenhuma certidão cadastrada.</p>') +
      '<form id="formCertidao" class="form-plano"><div class="campos">' +
      '<label class="campo largo"><span>Certidão</span><input type="text" id="certNome" list="certNomes" placeholder="ex.: CND federal (Receita/PGFN)"></label>' +
      '<datalist id="certNomes">' + ['CND federal (Receita/PGFN)', 'Certidão de débitos estaduais (Sefaz-SP)', 'Certidão de tributos municipais (São Bernardo)', 'CRF do FGTS (Caixa)', 'CNDT (Justiça do Trabalho)'].map(n => '<option value="' + esc(n) + '">').join('') + '</datalist>' +
      '<label class="campo"><span>Válida até</span><input type="date" id="certValidade"></label></div>' +
      '<p><button type="submit" class="btn">Salvar certidão</button></p></form></section>' +

      '<section class="cartao"><h2>Calendário dos impostos</h2>' +
      '<p class="dica">Os marcados "confirmar" dependem do enquadramento da OneClean (o dia do ICMS em SP sai do código de prazo do CNAE): confirme com o contador e acerte o dia aqui. ' +
      '"Sem imposto (créditos)": a OneClean está se creditando e não paga a guia; a declaração continua sendo conferida. Quando os créditos acabarem, desmarque e o fiscal volta a cobrar a guia no dia.</p>' +
      '<form id="formCalendario"><table class="tabela"><thead><tr><th>Usar</th><th>Prazo</th><th>Regra</th><th>Dia</th><th>Sem imposto (créditos)</th></tr></thead><tbody>' +
      (sit.calendario || []).map((c, i) => '<tr><td><input type="checkbox" data-cal-ativo="' + i + '"' + (c.ativo === false ? '' : ' checked') + '></td><td>' + esc(c.titulo) +
        (c.conferir ? ' ' + CRM.selo('confirmar', 'ambar') : '') + '<br><small>' + esc(c.nota || '') + '</small></td><td><small>' + esc(regraTexto(c)) + '</small></td><td>' +
        (c.regra === 'dia' ? '<input type="number" min="1" max="31" step="1" data-cal-dia="' + i + '" value="' + esc(c.dia || '') + '">' : '—') + '</td><td>' +
        (c.tipo === 'guia' ? '<label class="campo check"><input type="checkbox" data-cal-sem="' + i + '"' + (c.sem_imposto ? ' checked' : '') + '> sem guia</label>' : '') + '</td></tr>').join('') +
      '</tbody></table><p><button type="submit" class="btn">Salvar calendário</button></p></form></section>' +

      '<section class="cartao"><h2>Resolvidos (14 dias)</h2>' +
      (res.length ? '<table class="tabela"><thead><tr><th>Área</th><th>O que foi</th><th>Abriu</th><th>Resolveu</th></tr></thead><tbody>' +
        res.map(p => '<tr><td>' + esc(p.area) + '</td><td><small>' + esc(p.texto) + '</small></td><td>' + quando(p.primeiro_em) + '</td><td>' + quando(p.resolvido_em) + '</td></tr>').join('') + '</tbody></table>'
        : '<p class="vazio">Nada resolvido nos últimos 14 dias.</p>') +
      '<p class="dica">Pulso público (só a hora e os números, para a rotina "Fiscal dos agentes" da nuvem): <code>' + esc(sit.pulso || '') + '</code></p></section>';
  }

  const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const regraTexto = c => c.regra === 'dia' ? 'dia ' + c.dia + ' do ' + (c.meses > 1 ? c.meses + 'º ' : '') + 'mês seguinte (dia útil antes)'
    : c.regra === 'ultimo_util' ? 'último dia útil do mês seguinte' : c.regra === 'util' ? c.util + 'º dia útil do ' + (c.meses || 1) + 'º mês seguinte'
    : c.regra === 'anual_ultimo_util' ? 'último dia útil do mês ' + c.mes + ' do ano seguinte' : c.regra;
  function botoesPrazo(x) {
    if (!x.marcavel) return '';
    const id = esc(x.chave + '|' + x.competencia);
    if (/\(marcado\)/.test(x.situacao || '')) return '<button type="button" class="mini" data-acao="agentes-prazo" data-id="' + id + '|">desmarcar</button>';
    if (x.ok) return '';
    return x.tipo === 'guia'
      ? '<button type="button" class="mini" data-acao="agentes-prazo" data-id="' + id + '|sem_guia">sem guia este mês</button> <button type="button" class="mini" data-acao="agentes-prazo" data-id="' + id + '|feito">paguei</button>'
      : '<button type="button" class="mini" data-acao="agentes-prazo" data-id="' + id + '|feito">✓ entregue</button>';
  }
  const rpc = async (nome, args) => { const r = await CRM.store().sb.rpc(nome, args); if (r.error) throw new Error(r.error.message); return r.data; };
  function depois() {
    const fc = document.getElementById('formCertidao');
    if (fc) fc.addEventListener('submit', async ev => {
      ev.preventDefault();
      const nome = document.getElementById('certNome').value.trim(), val = document.getElementById('certValidade').value;
      if (!nome || !val) { CRM.toast('Diga a certidão e a validade.'); return; }
      try { await rpc('crm_fiscal_certidao', { p_nome: nome, p_validade: val, p_obs: null }); CRM.toast('Certidão salva.'); await carrega(); } catch (e) { CRM.falhou(e); }
    });
    const fk = document.getElementById('formCalendario');
    if (fk) fk.addEventListener('submit', async ev => {
      ev.preventDefault();
      const cal = (sit.calendario || []).map((c, i) => {
        const n = Object.assign({}, c);
        const a = fk.querySelector('[data-cal-ativo="' + i + '"]'), d = fk.querySelector('[data-cal-dia="' + i + '"]');
        n.ativo = !!(a && a.checked);
        const si = fk.querySelector('[data-cal-sem="' + i + '"]');
        if (si && !!si.checked !== !!c.sem_imposto) { n.sem_imposto = si.checked; if (si.checked) n.sem_imposto_desde = new Date().toISOString().slice(0, 10); }
        if (d && d.value) { const v = Math.max(1, Math.min(31, Number(d.value) || 0)); if (v !== Number(c.dia)) { n.dia = v; n.conferir = false; n.nota = 'dia acertado pelo administrador em ' + new Date().toLocaleDateString('pt-BR'); } }
        return n;
      });
      try { await CRM.salvarConfig({ prazos_fiscais: cal }); CRM.toast('Calendário salvo.'); await carrega(); } catch (e) { CRM.falhou(e); }
    });
  }

  CRM.ajustes.secao('agentes', 'Fiscal dos agentes', tela, depois, 'historico');
  Object.assign(CRM.acoes, {
    'agentes-atualizar': () => { sit = null; erro = null; CRM.render(); },
    'gnre-gerar': async id => {
      CRM.toast('Mandando ao Portal GNRE… (leva uns 40 segundos)');
      try {
        const r = await CRM.store().gnre({ acao: 'gerar', nfe_id: id });
        const res = (r.resultados || []).concat((r.enviadas || []).filter(x => x.situacao !== 'enviada'));
        const ger = res.filter(x => x.situacao === 'gerada').length, ruim = res.find(x => x.motivo);
        CRM.toast(ger ? 'GNRE gerada: o código de barras já está na conta do Caixa.' : ruim ? 'A guia não saiu: ' + ruim.motivo : 'Enviada; o resultado chega na próxima volta do robô (até 10 min).');
      } catch (e) { CRM.falhou(e); }
      await carrega();
    },
    'gnre-pdf': async id => {
      const w = window.open('', '_blank');
      try { const r = await CRM.store().gnre({ acao: 'pdf', id }); if (w) w.location = r.url; else window.open(r.url, '_blank'); } catch (e) { if (w) w.close(); CRM.falhou(e); }
    },
    'gnre-ligar': async v => {
      try {
        if (v === 'sim' && !confirm('Ligar o robô da GNRE? A partir de agora, cada NF-e com DIFAL gera a guia sozinha no Portal GNRE (pagar continua sendo com você).')) return;
        await CRM.store().gnre({ acao: 'ligar', ligado: v === 'sim' });   // a função grava só o "ligado" (não apaga a consulta da UF)
        CRM.toast(v === 'sim' ? 'Robô da GNRE ligado.' : 'Robô da GNRE desligado.');
      } catch (e) { CRM.falhou(e); }
      await carrega();
    },
    'gnre-config': async () => {
      CRM.toast('Consultando as regras do RS no Portal GNRE… (o portal pode levar até 30 s em cada uma)');
      const res = [];
      for (const receita of ['100102', '100129']) {
        try { const r = await CRM.store().gnre({ acao: 'configuf', uf: 'RS', receita }); res.push((receita === '100102' ? 'DIFAL' : 'FCP') + ': ' + (r.codigo || '?') + ' ' + (r.descricao || '')); }
        catch (e) { res.push((receita === '100102' ? 'DIFAL' : 'FCP') + ': ' + e.message); }
      }
      CRM.toast('Portal respondeu — ' + res.join(' · ') + '. Me chame para eu conferir as regras com a resposta.');
      await carrega();
    },
    'agentes-prazo': async id => {
      const [chave, comp, situ] = String(id).split('|');
      try { await rpc('crm_fiscal_marcar_prazo', { p_chave: chave, p_competencia: comp, p_situacao: situ || null }); await carrega(); } catch (e) { CRM.falhou(e); }
    },
    'agentes-certidao-apagar': async nome => {
      if (!confirm('Tirar a certidão "' + nome + '" da lista?')) return;
      try { await rpc('crm_fiscal_certidao', { p_nome: nome, p_validade: null, p_obs: null }); await carrega(); } catch (e) { CRM.falhou(e); }
    },
    'agentes-inscrever': () => inscrever().catch(CRM.falhou),
    'agentes-sair': () => sair().catch(CRM.falhou),
    'agentes-testar': async () => {
      try { const r = await CRM.store().fiscalAgentes({ acao: 'testar' }); CRM.toast(r.enviadas ? 'Aviso de teste enviado a ' + r.enviadas + ' aparelho(s).' : 'Nenhum aparelho recebeu: ' + (r.motivo || 'confira a inscrição')); await carrega(); } catch (e) { CRM.falhou(e); }
    },
    'agentes-conferir': async () => {
      try { const r = await CRM.store().fiscalAgentes({ acao: 'conferir' }); CRM.toast('Conferido: ' + (r.graves || 0) + ' grave(s), ' + (r.atencao || 0) + ' de atenção.'); await carrega(); } catch (e) { CRM.falhou(e); }
    }
  });
})();
