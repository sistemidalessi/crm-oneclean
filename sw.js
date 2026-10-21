// Service worker mínimo (21/10/2026, pedido do Anderson: "uma versão para celular"): é o que deixa o CRM ser instalado
// como app na tela inicial do celular e do computador. NÃO guarda nada em cache: tudo vem da rede, igual ao navegador,
// e a versão nova continua chegando sozinha (app.js). Sem internet, a abertura do app mostra um aviso em vez da tela do
// navegador.
'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
const SEM_REDE = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Sem internet</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#175b6d;color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px">' +
  '<div><h1 style="font-size:1.3rem">Sem internet</h1><p>O CRM precisa de internet para abrir.<br>Confira o Wi-Fi ou os dados móveis e tente de novo.</p>' +
  '<p><a href="./" style="color:#a9c451;font-weight:600">Tentar de novo</a></p></div></body></html>';
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return; // dados, scripts e fotos: direto da rede, sem passar por aqui
  e.respondWith(fetch(e.request).catch(() => new Response(SEM_REDE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
