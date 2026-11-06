/* CRM Sistemi Dalessi — Fiscal dos agentes (06/11/2026). Anderson: "nada pode simplesmente travar ou parar de funcionar,
   e ninguém aqui fica em cima disso". Configurações → Fiscal dos agentes (só o administrador): o que está travado agora
   (conferido de hora em hora pelo banco, crm_fiscal_conferir), o que se resolveu, os prazos dos próximos dias e os
   aparelhos que recebem o aviso no celular (Web Push, exceção nº 11 da regra de envio do CLAUDE.md: só os aparelhos do
   Anderson). O link "#agentes" (o toque na notificação) abre direto aqui. */
(function () {
  'use strict';
  const CRM = window.CRM, R = window.CRMRegras;
  const { esc } = CRM;
  let sit = null, carregando = false, erro = null;

  const quando = v => { if (!v) return '—'; const d = new Date(String(v).replace(' ', 'T')); return isNaN(d) ? esc(v) : esc(R.dataBR(R.diaLocal(d.toISOString())) + ' ' + R.horaLocal(d.toISOString())); };
  const dataBR = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');
  const b64 = s => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); const b = atob(t + '==='.slice((t.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const suporta = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

  async function carrega() {
    if (carregando) return; carregando = true;
    try { sit = await CRM.store().fiscalAgentes({ acao: 'situacao' }); erro = null; } catch (e) { erro = e.message; }
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

      '<section class="cartao"><h2>Prazos dos próximos 14 dias</h2>' +
      (pz.length ? '<table class="tabela"><thead><tr><th>Dia</th><th>Prazo</th><th>Situação</th></tr></thead><tbody>' +
        pz.map(x => '<tr><td>' + esc(dataBR(x.data)) + '</td><td>' + esc(x.titulo) + '</td><td><small>' + esc(x.situacao || '') + '</small></td></tr>').join('') + '</tbody></table>'
        : '<p class="vazio">Nenhum prazo nos próximos 14 dias.</p>') + '</section>' +

      '<section class="cartao"><h2>Resolvidos (14 dias)</h2>' +
      (res.length ? '<table class="tabela"><thead><tr><th>Área</th><th>O que foi</th><th>Abriu</th><th>Resolveu</th></tr></thead><tbody>' +
        res.map(p => '<tr><td>' + esc(p.area) + '</td><td><small>' + esc(p.texto) + '</small></td><td>' + quando(p.primeiro_em) + '</td><td>' + quando(p.resolvido_em) + '</td></tr>').join('') + '</tbody></table>'
        : '<p class="vazio">Nada resolvido nos últimos 14 dias.</p>') +
      '<p class="dica">Pulso público (só a hora e os números, para a rotina "Fiscal dos agentes" da nuvem): <code>' + esc(sit.pulso || '') + '</code></p></section>';
  }

  CRM.ajustes.secao('agentes', 'Fiscal dos agentes', tela, null, 'historico');
  Object.assign(CRM.acoes, {
    'agentes-atualizar': () => { sit = null; erro = null; CRM.render(); },
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
