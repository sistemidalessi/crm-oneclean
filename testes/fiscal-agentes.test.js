'use strict';
// Fiscal dos agentes (06/11/2026): Web Push (cifra e decifra como o navegador), JWT do VAPID e quando avisar o Anderson.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../supabase/functions/crm-fiscal-agentes/webpush.js');
const A = require('../supabase/functions/crm-fiscal-agentes/aviso.js');
const S = globalThis.crypto.subtle;
const enc = new TextEncoder();

// o lado do navegador: chave do aparelho (ECDH) e o segredo "auth"
async function aparelho() {
  const par = await S.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await S.exportKey('raw', par.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { par, inscricao: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: W.b64url(pub), auth: W.b64url(auth) } }, pub, auth };
}
async function hkdf(sal, ikm, info, n) {
  const k = await S.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sal, info }, k, n * 8));
}
// decifra como o navegador (RFC 8291): lê o cabeçalho, refaz o ECDH e as chaves, abre o AES-GCM
async function decifra(corpo, ap) {
  const sal = corpo.slice(0, 16), rs = new DataView(corpo.buffer, corpo.byteOffset + 16, 4).getUint32(0), idlen = corpo[20];
  const asPub = corpo.slice(21, 21 + idlen), cif = corpo.slice(21 + idlen);
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);
  const asKey = await S.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const comum = new Uint8Array(await S.deriveBits({ name: 'ECDH', public: asKey }, ap.par.privateKey, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...ap.pub, ...asPub]);
  const ikm = await hkdf(ap.auth, comum, info, 32);
  const cek = await hkdf(sal, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sal, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await S.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const claro = new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: nonce }, k, cif));
  assert.equal(claro[claro.length - 1], 2, 'termina com o delimitador do último registro');
  return new TextDecoder().decode(claro.slice(0, -1));
}

test('Web Push: o aparelho decifra exatamente o que o fiscal mandou (aes128gcm)', async () => {
  const ap = await aparelho();
  const texto = JSON.stringify({ titulo: 'Fiscal OneClean: NF-e travou', corpo: 'Ação já: ç ã é — teste', url: A.URL_FISCAL });
  const corpo = await W.cifrar(texto, ap.inscricao);
  assert.equal(await decifra(corpo, ap), texto);
  // cada envio usa chave e sal novos
  const outro = await W.cifrar(texto, ap.inscricao);
  assert.notDeepEqual(Array.from(outro.slice(0, 16)), Array.from(corpo.slice(0, 16)));
});

test('VAPID: o JWT ES256 confere com a chave pública e leva a origem do serviço de push', async () => {
  const v = await W.novasChavesVapid();
  assert.equal(W.deB64url(v.publica).length, 65);
  const jwt = await W.jwtVapid('https://web.push.apple.com/QGxyz', v.privada, 'https://exemplo.com/', Date.UTC(2026, 10, 6, 12));
  const [cab, corpo, ass] = jwt.split('.');
  const dados = JSON.parse(new TextDecoder().decode(W.deB64url(corpo)));
  assert.equal(dados.aud, 'https://web.push.apple.com');
  assert.equal(dados.sub, 'https://exemplo.com/');
  assert.equal(dados.exp, Date.UTC(2026, 10, 6, 12) / 1000 + 12 * 3600);
  assert.equal(JSON.parse(new TextDecoder().decode(W.deB64url(cab))).alg, 'ES256');
  const pub = await S.importKey('raw', W.deB64url(v.publica), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await S.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, W.deB64url(ass), enc.encode(cab + '.' + corpo)));
});

test('envio: cabeçalhos do Web Push e aparelho que saiu (410) é marcado para apagar', async () => {
  const ap = await aparelho();
  const v = await W.novasChavesVapid();
  let visto = null;
  const r = await W.enviar(ap.inscricao, { titulo: 't' }, v, 'https://exemplo.com/', async (u, o) => { visto = { u, o }; return { ok: false, status: 410, text: async () => 'gone' }; });
  assert.equal(visto.u, ap.inscricao.endpoint);
  assert.equal(visto.o.headers['Content-Encoding'], 'aes128gcm');
  assert.match(visto.o.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.deepEqual([r.ok, r.sumiu], [false, true]);
});

// --------------------------------------------------------------------- quando avisar
const em = (iso) => Date.parse(iso + '-03:00');           // hora de Brasília
const grave = (chave, extra = {}) => Object.assign({ chave, area: 'NF-e', nivel: 'grave', texto: 'A NF-e 1 está presa', fazer: 'Consultar.' }, extra);
const atencao = (chave) => ({ chave, area: 'Caixa', nivel: 'atencao', texto: '2 contas vencidas', fazer: 'Caixa.' });

test('fora das 7h às 21h nada sai, nem grave', () => {
  assert.equal(A.planoDeAviso([grave('a')], { agora: em('2026-11-06T06:59') }).avisar, false);
  assert.equal(A.planoDeAviso([grave('a')], { agora: em('2026-11-06T21:00') }).avisar, false);
});

test('grave novo sai na hora, uma vez; já avisado não repete', () => {
  const p = A.planoDeAviso([grave('a'), atencao('b')], { agora: em('2026-11-10T15:00'), ultimoPrazos: '2026-11-10' }); // terça
  assert.equal(p.tipo, 'grave');
  assert.deepEqual(p.marcar, ['a']);
  assert.equal(A.planoDeAviso([grave('a', { avisado_em: 'x' })], { agora: em('2026-11-10T15:00'), ultimoPrazos: '2026-11-10' }).avisar, false);
});

test('segunda 8h: resumo; sem nada aberto vira "tudo certo" (prova de vida)', () => {
  const p = A.planoDeAviso([], { agora: em('2026-11-09T08:05') });
  assert.equal(p.tipo, 'resumo');
  assert.equal(A.montarAviso(p).titulo, 'Fiscal OneClean: tudo certo');
  // quarta sem nada e sem prazo: não manda
  assert.equal(A.planoDeAviso([], { agora: em('2026-11-11T08:05') }).tipo, 'resumo-vazio');
  // já mandou o resumo hoje: não repete
  assert.equal(A.planoDeAviso([], { agora: em('2026-11-09T09:05'), ultimoResumo: '2026-11-09' }).avisar, false);
});

test('resumo de sexta leva os prazos até segunda; terça e quinta, só prazos de hoje e amanhã', () => {
  const pz = [{ data: '2026-11-13', titulo: 'ICMS' }, { data: '2026-11-16', titulo: 'DCTFWeb' }, { data: '2026-11-20', titulo: 'longe' }];
  const prazosDe = (de, ate) => pz.filter(x => x.data >= de && x.data <= ate);
  const sexta = A.planoDeAviso([atencao('b')], { agora: em('2026-11-13T08:30'), prazosDe });
  assert.deepEqual(sexta.prazos.map(x => x.titulo), ['ICMS', 'DCTFWeb']);
  const txt = A.montarAviso(sexta);
  assert.match(txt.titulo, /1 pendência aberta/);
  assert.match(txt.corpo, /13\/11 ICMS/);
  const quinta = A.planoDeAviso([], { agora: em('2026-11-12T08:10'), prazosDe });
  assert.equal(quinta.tipo, 'prazos');
  assert.deepEqual(quinta.prazos.map(x => x.titulo), ['ICMS']);
  assert.equal(A.planoDeAviso([], { agora: em('2026-11-10T08:10'), prazosDe }).tipo, 'prazos-vazio');
});

test('pulso público: só a hora e as contagens, nenhum texto', () => {
  const p = A.pulso([grave('a'), atencao('b'), atencao('c')], '2026-11-06T03:00:00Z');
  assert.deepEqual(p, { empresa: 'OneClean', verificado_em: '2026-11-06T03:00:00Z', graves: 1, atencao: 2 });
});

test('externos: certificado A1, serviço fiscal fora e o fiscal da Agilité parado', () => {
  const agora = Date.UTC(2026, 10, 6, 12);
  assert.deepEqual(A.problemasExternos({ saude: { ok: true, certificado: { validoAte: '2027-10-28T00:00:00Z' } }, agora }), []);
  const venc = A.problemasExternos({ saude: { ok: true, certificado: { validoAte: '2026-11-10T00:00:00Z' } }, agora });
  assert.deepEqual(venc.map(x => [x.chave, x.nivel]), [['externo:certificado', 'grave']]);
  assert.equal(A.problemasExternos({ saude: { ok: true, certificado: { validoAte: '2026-11-30T00:00:00Z' } }, agora })[0].nivel, 'atencao');
  assert.equal(A.problemasExternos({ saude: { erro: 'não respondeu' }, agora })[0].chave, 'externo:servico-fiscal');
  const ag = A.problemasExternos({ saude: { ok: true, certificado: { validoAte: '2027-10-28' } }, agilite: { verificado_em: new Date(agora - 5 * 3600e3).toISOString() }, agora });
  assert.deepEqual(ag.map(x => [x.chave, x.nivel]), [['externo:fiscal-agilite', 'grave']]);
});

test('Web Push: igual byte a byte ao exemplo do RFC 8291 (apêndice A)', async () => {
  const asPub = W.deB64url('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  const jwk = { kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', x: W.b64url(asPub.slice(1, 33)), y: W.b64url(asPub.slice(33, 65)), ext: true };
  const privateKey = await S.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = await S.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const ins = { keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } };
  const out = await W.cifrar('When I grow up, I want to be a watermelon', ins, { par: { publicKey, privateKey }, sal: W.deB64url('DGv6ra1nlYgDCS1FRnbzlw') });
  assert.equal(W.b64url(out), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});
