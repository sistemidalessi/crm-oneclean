// Service worker (21/10/2026, pedido do Anderson: "uma versão para celular"): é o que deixa o CRM ser instalado como app na
// tela inicial do celular e do computador. O CRM NÃO fica em cache: tudo vem da rede, igual ao navegador, e a versão nova
// continua chegando sozinha (app.js).
// 04/11/2026 (rota do motorista sem internet): só a página da rota sem internet fica guardada (rota-offline.html e os 3
// arquivos dela). Abrir o app sem sinal mostra a rota que ficou guardada no celular (rota-offline-fila.js) em vez do aviso.
'use strict';
const CACHE = 'crm-rota-offline-v1';
const ARQS = ['rota-offline.html', 'rota-offline.js', 'rota-offline-fila.js', 'crm.css'];
// sempre a versão mais nova dos 4 arquivos (sem o cache do navegador)
const guarda = () => caches.open(CACHE).then(c => Promise.all(ARQS.map(a => fetch(a, { cache: 'no-store' }).then(r => (r.ok ? c.put(a, r) : null)).catch(() => null))));
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(guarda()); });
self.addEventListener('activate', e => e.waitUntil(Promise.all([self.clients.claim(),
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('crm-') && k !== CACHE).map(k => caches.delete(k))))])));
const SEM_REDE = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Sem internet</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#175b6d;color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px">' +
  '<div><h1 style="font-size:1.3rem">Sem internet</h1><p>O CRM precisa de internet para abrir.<br>Confira o Wi-Fi ou os dados móveis e tente de novo.</p>' +
  '<p><a href="./" style="color:#a9c451;font-weight:600">Tentar de novo</a></p></div></body></html>';
let renovadoEm = 0;
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // os arquivos da página sem internet, quando ela mesma pede (sem sinal): do que ficou guardado
  if (u.origin === self.location.origin && ARQS.some(a => u.pathname.endsWith('/' + a)) && e.request.method === 'GET') {
    e.respondWith(fetch(e.request).catch(() => caches.match(ARQS.find(a => u.pathname.endsWith('/' + a)))));
    return;
  }
  if (e.request.mode !== 'navigate') return; // dados, scripts e fotos: direto da rede, sem passar por aqui
  e.respondWith(fetch(e.request).then(r => {
    if (Date.now() - renovadoEm > 3600000) { renovadoEm = Date.now(); guarda(); } // de hora em hora, a cópia nova da página sem internet
    return r;
  }).catch(() => caches.match('rota-offline.html').then(r => r || new Response(SEM_REDE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))));
});
