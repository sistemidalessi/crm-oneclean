'use strict';
/* Chamadas ao Banco do Brasil que exigem o certificado A1 (mTLS), 04/11/2026: a API Extratos (conciliação bancária) e,
   depois, a de Pagamentos. A cadeia do A1 (OneClean → AC Safeweb RFB → AC RFB → Raiz ICP-Brasil v5) foi enviada pelo
   Anderson ao Portal Developers BB na aplicação "CRM OneClean", ambiente Produção, em 04/11.
   As chaves do BB (client id/secret, app key) ficam só nos Secrets do Supabase: a Edge Function crm-bb pega o token e manda
   aqui só a chamada pronta (endereço + token). Este serviço só acrescenta o certificado e devolve o que o banco respondeu.
   Só aceita endereço https do próprio BB (*.bb.com.br); a rota é protegida pela FISCAL_TOKEN como as outras. */

const https = require('https');

const HOST_BB = /^([a-z0-9-]+\.)*bb\.com\.br$/i;

function alvo(endereco) {
  let u;
  try { u = new URL(String(endereco || '')); } catch (e) { throw Object.assign(new Error('endereço inválido'), { status: 400 }); }
  if (u.protocol !== 'https:' || !HOST_BB.test(u.hostname)) throw Object.assign(new Error('só endereços https do Banco do Brasil (*.bb.com.br)'), { status: 400 });
  return u;
}

// b: { url, metodo?: 'GET'|'POST'|'PUT', token?, form?: {..} (x-www-form-urlencoded), json?: {..}, basic?: 'id:segredo' }
function chama(cfg, b) {
  const u = alvo(b && b.url);
  const metodo = String(b.metodo || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH'].includes(metodo)) throw Object.assign(new Error('método não aceito'), { status: 400 });
  const headers = { Accept: 'application/json' };
  if (b.token) headers.Authorization = 'Bearer ' + b.token;
  else if (b.basic) headers.Authorization = 'Basic ' + Buffer.from(String(b.basic)).toString('base64');
  let corpo = null;
  if (b.form) { corpo = new URLSearchParams(b.form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  else if (b.json !== undefined) { corpo = JSON.stringify(b.json); headers['Content-Type'] = 'application/json'; }
  if (corpo != null) headers['Content-Length'] = Buffer.byteLength(corpo);
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: metodo, headers, cert: cfg.certPem, key: cfg.keyPem, timeout: cfg.tempo || 30000 }, res => {
      const partes = [];
      res.on('data', d => partes.push(d));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        let json = null; try { json = JSON.parse(texto); } catch (e) { /* texto */ }
        // { cru: true } (13/11/2026, Pagamentos em Lote): devolve também o texto inteiro. O número do pagamento tem 17 dígitos
        // e vem como número no JSON; o JSON.parse daqui arredonda, então quem chama relê o texto (lerJson da crm-bb-pagar).
        resolve({ status: res.statusCode, json, texto: json && !b.cru ? undefined : (b.cru ? texto.slice(0, 2000000) : texto.slice(0, 2000)) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('o Banco do Brasil não respondeu a tempo')));
    req.on('error', e => reject(Object.assign(new Error('chamada ao BB: ' + e.message), { status: 502 })));
    if (corpo != null) req.write(corpo);
    req.end();
  });
}

module.exports = { chama, alvo, HOST_BB };
