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
      '<p class="dica">Os marcados "confirmar" dependem do enquadramento da OneClean (o dia do ICMS em SP sai do código de prazo do CNAE): confirme com o contador e acerte o dia aqui.</p>' +
      '<form id="formCalendario"><table class="tabela"><thead><tr><th>Usar</th><th>Prazo</th><th>Regra</th><th>Dia</th></tr></thead><tbody>' +
      (sit.calendario || []).map((c, i) => '<tr><td><input type="checkbox" data-cal-ativo="' + i + '"' + (c.ativo === false ? '' : ' checked') + '></td><td>' + esc(c.titulo) +
        (c.conferir ? ' ' + CRM.selo('confirmar', 'ambar') : '') + '<br><small>' + esc(c.nota || '') + '</small></td><td><small>' + esc(regraTexto(c)) + '</small></td><td>' +
        (c.regra === 'dia' ? '<input type="number" min="1" max="31" step="1" data-cal-dia="' + i + '" value="' + esc(c.dia || '') + '">' : '—') + '</td></tr>').join('') +
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
        if (d && d.value) { const v = Math.max(1, Math.min(31, Number(d.value) || 0)); if (v !== Number(c.dia)) { n.dia = v; n.conferir = false; n.nota = 'dia acertado pelo administrador em ' + new Date().toLocaleDateString('pt-BR'); } }
        return n;
      });
      try { await CRM.salvarConfig({ prazos_fiscais: cal }); CRM.toast('Calendário salvo.'); await carrega(); } catch (e) { CRM.falhou(e); }
    });
  }

  CRM.ajustes.secao('agentes', 'Fiscal dos agentes', tela, depois, 'historico');
  Object.assign(CRM.acoes, {
    'agentes-atualizar': () => { sit = null; erro = null; CRM.render(); },
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
