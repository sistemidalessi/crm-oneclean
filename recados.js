/* Recados do Diretor de Vendas (13/11/2026, pedido do Anderson, pelo celular: "quero um negócio automático; quando eu for
   cobrar através do diretor, é porque eu vou estar na rua"). O administrador (ou o Claude, a pedido dele) grava o recado em
   crm_recados; a Edge Function crm-recados manda por e-mail e, aqui, o recado abre numa janela ao entrar no CRM e só fecha
   com a resposta (gravada por quem recebeu; o banco aceita só "lido" e uma resposta). A resposta vai por e-mail ao
   administrador. Configurações → Recados do diretor (só o administrador): o que foi mandado, quem leu e o que respondeu.
   Regra dos grupos (Anderson, 13/11): cobrança da equipe se separa por departamento — INTERNO (a gestora cobra as
   vendedoras internas) e EXTERNO (cada externa recebe o recado dela; a gestora não cobra externa). */
(function (raiz) {
  'use strict';
  // pendentes(lista, meuId) → recados a responder por esta pessoa, do mais antigo para o mais novo (parte pura, com teste)
  function pendentes(lista, meuId) {
    return (lista || []).filter(r => r && r.para === meuId && !r.respondido_em)
      .sort((a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || '')) || (a.id - b.id));
  }
  const API = { pendentes };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  const CRM = raiz.CRM;
  if (!CRM || typeof document === 'undefined') return;
  const esc = s => CRM.esc(s);
  const quando = v => v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  let lista = null, buscadoEm = 0, buscando = false, aberto = null, todos = null;
  const INTERVALO = 3 * 60 * 1000;

  function dialogo() {
    let d = document.getElementById('dlgRecado');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'dlgRecado'; d.className = 'dlg apresentacao recado';
      d.addEventListener('cancel', ev => ev.preventDefault());   // só fecha com a resposta
      document.body.appendChild(d);
    }
    return d;
  }

  function mostrar(r) {
    const d = dialogo(), T = CRM.turma, rosto = T && T.img ? T.img('gerente-vendas') : '';
    const atrasado = r.prazo && new Date(r.prazo) < new Date();
    d.innerHTML = '<div class="apres-cab">' + (rosto ? '<img src="' + esc(rosto) + '" alt="">' : '') +
      '<div><small>Mensagem do ' + esc(r.de || 'Diretor de Vendas') + '</small><h2>' + esc(r.assunto) + '</h2></div></div>' +
      '<div class="apres-corpo">' + String(r.texto || '').split('\n').filter(l => l.trim()).map(l => '<p>' + esc(l) + '</p>').join('') +
      (r.prazo ? '<p><strong>' + (atrasado ? 'O prazo para responder era ' : 'Responda até ') + esc(quando(r.prazo)) + '.</strong></p>' : '') +
      '<p class="apres-assina">' + esc(r.de || 'Diretor de Vendas') + '</p>' +
      '<form id="fRecado" data-id="' + esc(r.id) + '"><label>Sua resposta<textarea name="resposta" rows="6" maxlength="4000" required placeholder="Escreva aqui a sua resposta ao diretor"></textarea></label></form></div>' +
      '<p class="acoes"><button type="button" class="btn" data-acao="recado-responder" data-id="' + esc(r.id) + '">Enviar resposta</button></p>';
    if (!d.open) d.showModal();
    d.scrollTop = 0;
    aberto = r.id;
    if (!r.lido_em) { r.lido_em = new Date().toISOString(); CRM.store().recadoLido(r.id).catch(() => {}); }
  }

  async function conferir() {
    const st = CRM.store(), eu = CRM.estado.eu;
    if (aberto || buscando || !st || !st.recados || !eu) return;
    const ap = document.getElementById('dlgApresentacao');
    if (ap && ap.open) return;   // a apresentação do diretor vem primeiro
    if (!lista || Date.now() - buscadoEm > INTERVALO) {
      buscando = true;
      try { lista = await st.recados(); buscadoEm = Date.now(); } catch (e) { buscando = false; return; }   // sem banco agora: tenta depois
      buscando = false;
    }
    const meu = st.modo === 'local' ? 'local' : eu.user_id;
    const p = pendentes(lista, meu);
    if (p.length) mostrar(p[0]);
  }

  Object.assign(CRM.acoes, {
    'recado-responder': async id => {
      const f = document.getElementById('fRecado'), txt = f ? String(f.resposta.value || '').trim() : '';
      if (txt.length < 5) { CRM.toast('Escreva a sua resposta antes de enviar.', true); if (f) f.resposta.focus(); return; }
      try { await CRM.store().recadoResponder(Number(id), txt); }
      catch (e) { CRM.falhou(e); return; }
      const r = (lista || []).find(x => String(x.id) === String(id));
      if (r) { r.resposta = txt; r.respondido_em = new Date().toISOString(); }
      const d = document.getElementById('dlgRecado'); if (d) d.close();
      aberto = null;
      CRM.toast('Resposta enviada ao diretor.');
      setTimeout(conferir, 300);   // se houver outro recado, abre em seguida
    }
  });

  // Configurações → Recados do diretor (só o administrador)
  function telaAjustes() {
    if (!CRM.ehAdmin()) return '<p class="dica">Só o administrador vê esta parte.</p>';
    if (todos === null && CRM.store().recados) {
      todos = [];
      CRM.store().recados().then(l => { todos = l || []; CRM.render(); }).catch(e => { todos = null; CRM.falhou(e); });
    }
    const nome = id => { const u = (CRM.estado.D.usuarios || []).find(x => x.user_id === id); return u ? u.nome : '—'; };
    const l = (todos || []).slice().sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em))).slice(0, 100);
    return '<section class="cartao"><h2>Recados do diretor</h2><p>O recado vai por e-mail e abre no CRM de quem recebe, ao entrar; a janela só fecha com a resposta, que chega por e-mail ao administrador. Para mandar, peça ao Claude ("monta uma cobrança da equipe…"): interno (a gestora cobra as internas) e externo (cada externa recebe o seu) vão separados.</p></section>' +
      '<section class="cartao sem-pad tabela-rolagem"><table class="tabela"><thead><tr><th>Para</th><th>Assunto</th><th>Enviado</th><th>E-mail</th><th>Leu</th><th>Resposta</th></tr></thead><tbody>' +
      (l.length ? l.map(r => '<tr><td>' + esc(nome(r.para)) + (r.grupo ? '<br><small>' + esc(r.grupo) + '</small>' : '') + '</td><td>' + esc(r.assunto) +
        (r.prazo ? '<br><small>prazo ' + esc(quando(r.prazo)) + '</small>' : '') + '</td><td>' + esc(quando(r.criado_em)) + '</td><td>' +
        (r.email_em ? esc(quando(r.email_em)) : r.email_erro ? CRM.selo('não saiu', 'vermelho') + '<br><small>' + esc(r.email_erro) + '</small>' : CRM.selo('na fila', 'cinza')) + '</td><td>' +
        (r.lido_em ? esc(quando(r.lido_em)) : CRM.selo('ainda não', 'cinza')) + '</td><td>' +
        (r.respondido_em ? '<small>' + esc(quando(r.respondido_em)) + (r.prazo && new Date(r.respondido_em) > new Date(r.prazo) ? ' (fora do prazo)' : '') + '</small><br>' + esc(r.resposta) : CRM.selo('sem resposta', 'ambar')) +
        '</td></tr>').join('') : '<tr><td colspan="6">Nenhum recado ainda.</td></tr>') +
      '</tbody></table></section>';
  }
  if (CRM.ajustes && CRM.ajustes.secao) CRM.ajustes.secao('recados', 'Recados do diretor', telaAjustes, null, 'importar');

  CRM.recados = { conferir };
})(typeof window !== 'undefined' ? window : globalThis);
