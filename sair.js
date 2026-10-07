/* Página sair.html: confirma o "não quero mais receber" dos e-mails da cadência (Edge Function
   crm-email-sair). Pede um clique (os antivírus de e-mail abrem os links sozinhos; sem o clique, um
   deles descadastraria o cliente sem ele querer). */
(function () {
  'use strict';
  const cfg = window.CRM_CONFIG || {};
  const t = new URLSearchParams(location.search).get('t') || '';
  const texto = document.getElementById('sairTexto'), botao = document.getElementById('sairBotao'), logo = document.getElementById('sairLogo');
  if (cfg.logo) { logo.src = cfg.logo; logo.alt = cfg.nomeEmpresa || ''; logo.hidden = false; }
  if (cfg.nomeEmpresa) document.title = 'Não receber mais e-mails · ' + cfg.nomeEmpresa;
  if (!t || !cfg.supabaseUrl) { texto.textContent = 'Este link não está completo. Responda o e-mail pedindo para sair da lista, que a gente tira.'; botao.hidden = true; return; }
  botao.addEventListener('click', async () => {
    botao.disabled = true;
    try {
      const r = await fetch(cfg.supabaseUrl + '/functions/v1/crm-email-sair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t }) });
      if (!r.ok) throw new Error(r.status);
      texto.textContent = 'Pronto: você não vai mais receber estes e-mails' + (cfg.nomeEmpresa ? ' da ' + cfg.nomeEmpresa : '') + '. Se mudar de ideia, é só responder qualquer e-mail nosso.';
      botao.hidden = true;
    } catch (e) {
      texto.textContent = 'Não consegui registrar agora. Tente de novo em alguns minutos ou responda o e-mail pedindo para sair da lista.';
      botao.disabled = false;
    }
  });
})();
