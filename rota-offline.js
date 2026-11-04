/* A rota do motorista aberta sem internet (04/11/2026): a lista guardada no celular, Waze/Maps/Ligar, e a confirmação com a
   foto do canhoto guardada na fila (rota-offline-fila.js). Quando a internet voltar, "Abrir o CRM" manda tudo sozinho. */
(function () {
  'use strict';
  const FR = window.CRMFilaRota, el = document.getElementById('ro');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hora = iso => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
  const hoje = () => new Date().toLocaleDateString('en-CA');
  const st = { aberta: null, foto: null, url: '', como: 'entregue', obs: '' };
  let fila = [];
  const r = () => FR.rotaGuardada();
  async function desenha() {
    try { fila = await FR.lista(); } catch (e) { fila = []; }
    const g = r();
    if (!g || !Array.isArray(g.l)) {
      el.innerHTML = '<header class="mt-topo"><div><strong>Sem internet</strong></div></header><section class="cartao"><p>O CRM precisa de internet para abrir.</p>' +
        '<p class="dica">Motorista: abra o CRM na empresa (com Wi-Fi) antes de sair; a rota fica guardada no celular e funciona sem sinal.</p>' +
        '<p><a class="btn" href="./">Tentar de novo</a></p></section>';
      return;
    }
    const naFila = new Set(fila.map(x => x.id));
    const l = g.l.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    const x = st.aberta && l.find(y => y.id === st.aberta);
    if (x) return desenhaConfirmar(x);
    const feita = y => y.situacao !== 'pendente' || naFila.has(y.id);
    const prox = l.find(y => !feita(y));
    el.innerHTML = '<header class="mt-topo"><div><strong>Rota ' + (g.dia === hoje() ? 'de hoje' : 'de ' + esc(g.dia.split('-').reverse().join('/'))) + '</strong><span>' + esc(g.nome || '') + '</span></div>' +
        '<small>' + l.filter(feita).length + ' de ' + l.length + ' entrega(s) feita(s)</small></header>' +
      '<p class="alerta">📴 <strong>Sem internet.</strong> Rota guardada no celular às ' + esc(hora(g.em)) + '. Siga normalmente: o Waze e o Maps funcionam sem sinal. ' +
        'As confirmações ficam guardadas' + (fila.length ? ' (' + fila.length + ' esperando)' : '') + ' e vão quando a internet voltar.</p>' +
      (g.dia !== hoje() ? '<p class="aviso-notas">Atenção: esta rota guardada é de ' + esc(g.dia.split('-').reverse().join('/')) + ', não de hoje.</p>' : '') +
      l.map((y, i) => {
        const tel = String(y.telefone || '').replace(/\D/g, '');
        if (feita(y)) return '<article class="cartao mt-parada feita"><div class="mt-linha"><strong>' + (i + 1) + '. ' + esc(y.cliente) + '</strong><span class="selo ' + (naFila.has(y.id) ? 'ambar">esperando a internet' : 'verde">feita') + '</span></div><small>' + esc(y.endereco || '') + '</small></article>';
        const ehProx = prox && prox.id === y.id;
        return '<article class="cartao mt-parada' + (ehProx ? ' proxima' : '') + '">' + (ehProx ? '<span class="mt-rotulo">Próxima entrega</span>' : '') +
          '<div class="mt-linha"><strong>' + (i + 1) + '. ' + esc(y.cliente) + '</strong></div><p class="mt-end">' + esc(y.endereco || 'sem endereço: ligue para o cliente') + '</p>' +
          '<small>NF ' + esc(y.numero) + (y.contato ? ' · receber com ' + esc(y.contato) : '') + (tel ? ' · ' + esc(y.telefone) : '') + '</small>' +
          '<div class="mt-botoes">' + (y.waze ? '<a class="btn sec" href="' + esc(y.waze) + '" target="_blank" rel="noopener">Waze</a>' : '') + (y.google ? '<a class="btn sec" href="' + esc(y.google) + '" target="_blank" rel="noopener">Google Maps</a>' : '') +
            (tel ? '<a class="btn sec" href="tel:' + esc(tel) + '">Ligar</a>' : '') + '</div>' +
          '<button type="button" class="btn largo' + (ehProx ? '' : ' sec') + '" data-abre="' + esc(y.id) + '">Cheguei: confirmar a entrega</button></article>';
      }).join('') + '<p class="acoes"><a class="btn sec" href="./">Abrir o CRM (quando tiver internet)</a></p>';
    el.querySelectorAll('[data-abre]').forEach(b => b.addEventListener('click', () => { st.aberta = b.dataset.abre; st.foto = null; st.url = ''; st.obs = ''; st.como = 'entregue'; desenha(); window.scrollTo(0, 0); }));
  }
  function desenhaConfirmar(x) {
    const ok = st.como === 'entregue';
    el.innerHTML = '<header class="mt-topo"><button type="button" class="mt-voltar" id="roVoltar" aria-label="Voltar">‹</button><div><strong>' + esc(x.cliente) + '</strong><span>NF ' + esc(x.numero) + '</span></div></header>' +
      '<section class="cartao mt-passo"><h2>1. Foto do canhoto <span class="neg">(obrigatória)</span></h2>' + (st.url ? '<img class="mt-foto" src="' + esc(st.url) + '" alt="Foto do canhoto">' : '') +
        '<label class="btn ' + (st.url ? 'sec' : 'mt-camera') + ' arquivo">' + (st.url ? 'Tirar outra foto' : 'Abrir a câmera e fotografar o canhoto') + '<input type="file" accept="image/*" capture="environment" id="roFoto"></label></section>' +
      '<section class="cartao mt-passo"><h2>2. Como foi a entrega?</h2><div class="mt-como"><button type="button" class="btn ' + (ok ? 'verde' : 'sec') + '" data-como="entregue">Tudo certo</button>' +
        '<button type="button" class="btn ' + (!ok ? 'vermelho' : 'sec') + '" data-como="problema">Teve problema</button></div>' +
        '<label class="campo"><span>Observação ' + (ok ? '(se quiser)' : '(obrigatória: o que aconteceu?)') + '</span><textarea rows="3" id="roObs">' + esc(st.obs) + '</textarea></label></section>' +
      '<button type="button" class="btn largo" id="roOk">Guardar a confirmação</button><p class="dica">Sem internet: fica guardada no celular e vai ao escritório quando o sinal voltar (abra o CRM).</p>';
    document.getElementById('roVoltar').addEventListener('click', () => { st.aberta = null; desenha(); });
    document.getElementById('roObs').addEventListener('input', e => { st.obs = e.target.value; });
    el.querySelectorAll('[data-como]').forEach(b => b.addEventListener('click', () => { st.como = b.dataset.como; desenhaConfirmar(x); }));
    document.getElementById('roFoto').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (!f) return; if (st.url) URL.revokeObjectURL(st.url); st.foto = f; st.url = URL.createObjectURL(f); desenhaConfirmar(x); });
    document.getElementById('roOk').addEventListener('click', async () => {
      if (!st.foto) { alert('Falta a foto do canhoto: sem ela não dá para confirmar.'); return; }
      if (st.como === 'problema' && !st.obs.trim()) { alert('Conte na observação o que aconteceu.'); return; }
      const g = r(), em = new Date().toISOString();
      try {
        await FR.guarda({ id: x.id, dia: g.dia, como: st.como, obs: st.obs, foto: await reduz(st.foto), em, user: g.user });
        FR.marcaFeita(x.id, st.como, em);
        st.aberta = null; st.foto = null; if (st.url) URL.revokeObjectURL(st.url); st.url = '';
        desenha();
      } catch (e) { alert('Não consegui guardar no celular: ' + (e.message || e)); }
    });
  }
  async function reduz(file) {
    try {
      const img = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h);
      return (await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.8))) || file;
    } catch (e) { return file; }
  }
  // voltou a internet: abre o CRM, que manda a fila
  window.addEventListener('online', () => { if (!st.aberta) location.href = './'; });
  desenha();
})();
