// Web Push do fiscal dos agentes (06/11/2026): a notificação no celular do Anderson, sem serviço pago e sem pacote npm.
// Só WebCrypto (o mesmo no Deno da Edge Function e no Node dos testes), como o Web Push da Sala da Agilité
// (agilite-sistema-gestao src/ceo/avisos.js, feito com o crypto do Node):
//   - VAPID (RFC 8292): par de chaves ECDSA P-256 do CRM; o JWT ES256 assina cada envio;
//   - conteúdo cifrado (RFC 8291, aes128gcm): ECDH com uma chave de uso único, HKDF-SHA-256 e AES-128-GCM.
// A chave privada fica em crm_interno.fiscal_estado (schema que a API não expõe) e nunca sai do banco/da função.

const enc = new TextEncoder();
const sub = () => globalThis.crypto.subtle;

export function b64url(bytes) {
  let s = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function deB64url(s) {
  const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const junta = (...partes) => {
  const n = partes.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n);
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
};

// par de chaves VAPID novo: { publica (base64url, 65 bytes sem compressão), privada (JWK) }
export async function novasChavesVapid() {
  const par = await sub().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await sub().exportKey('raw', par.publicKey));
  return { publica: b64url(pub), privada: await sub().exportKey('jwk', par.privateKey) };
}

// JWT ES256 do VAPID: aud = origem do endereço do serviço de push (Google, Apple, Mozilla…), validade de 12 h
export async function jwtVapid(endpoint, privadaJwk, assunto, agora = Date.now()) {
  const aud = new URL(endpoint).origin;
  const cab = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpo = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(agora / 1000) + 12 * 3600, sub: assunto })));
  const chave = await sub().importKey('jwk', privadaJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const ass = new Uint8Array(await sub().sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, enc.encode(cab + '.' + corpo)));
  return cab + '.' + corpo + '.' + b64url(ass);
}

async function hkdf(sal, ikm, info, bytes) {
  const k = await sub().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await sub().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sal, info }, k, bytes * 8));
}

// cifra o texto para uma inscrição { keys: { p256dh, auth } } (RFC 8291). `teste` fixa a chave de uso único e o sal.
export async function cifrar(texto, inscricao, teste = null) {
  const uaPub = deB64url(inscricao.keys.p256dh), segredo = deB64url(inscricao.keys.auth);
  const par = teste && teste.par ? teste.par : await sub().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await sub().exportKey('raw', par.publicKey));
  const uaChave = await sub().importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const comum = new Uint8Array(await sub().deriveBits({ name: 'ECDH', public: uaChave }, par.privateKey, 256));
  const ikm = await hkdf(segredo, comum, junta(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const sal = teste && teste.sal ? teste.sal : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sal, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await sub().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const claro = junta(enc.encode(texto), new Uint8Array([2]));   // um registro só, delimitador 0x02
  const cifrado = new Uint8Array(await sub().encrypt({ name: 'AES-GCM', iv: nonce }, k, claro));
  const rs = new Uint8Array([0, 0, 16, 0]);                       // tamanho do registro: 4096
  return junta(sal, rs, new Uint8Array([asPub.length]), asPub, cifrado);
}

// manda uma notificação: { titulo, corpo, url, tag } → { ok, status, sumiu } (404/410 = o aparelho saiu: apagar a inscrição)
export async function enviar(inscricao, dados, vapid, assunto, buscar = fetch) {
  const corpo = await cifrar(JSON.stringify(dados), inscricao);
  const jwt = await jwtVapid(inscricao.endpoint, vapid.privada, assunto);
  const r = await buscar(inscricao.endpoint, {
    method: 'POST',
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high',
      Authorization: 'vapid t=' + jwt + ', k=' + vapid.publica },
    body: corpo
  });
  let erro = '';
  if (!r.ok) { try { erro = (await r.text()).slice(0, 200); } catch (_) { /* sem corpo */ } }
  return { ok: r.ok, status: r.status, sumiu: r.status === 404 || r.status === 410, erro };
}
