// Edge Function: AÇÕES do CEO Grupo Dalessi pelo celular (24/10/2026). O Anderson responde no WhatsApp da Agilité; o
// sistema da Agilité confere que é o celular dele, pede um código de confirmação e só então chama aqui.
//   POST …/functions/v1/crm-ceo-acao
//   corpo: {"aud":"crm-ceo-acao","acao":"bloqueados"|"ver"|"liberar","numero":123,"esperado":["ATRASO"],"ts":1761350000,"nonce":"<32 hex>"}
//   (revisão de segurança de 24/10/2026: "aud" diz o destino; "esperado" = os bloqueios que o Anderson viu, e o CRM
//   recusa se forem outros; número do pedido até 9 dígitos)
//   X-Ceo-Assinatura: assinatura Ed25519 (base64) do corpo CRU, feita com a chave PRIVADA que só existe no servidor
//   da Agilité (data/). Aqui só a chave PÚBLICA, em crm_ceo_chaves (não é segredo). Nenhuma senha nova.
// Recusa (401, sem detalhe): sem assinatura, assinatura que não confere, ts fora de ±5 min. O nonce de "liberar" é
// único no banco (crm_ceo_acoes): o mesmo corpo assinado não libera duas vezes. LISTA FECHADA: só ler os pedidos
// bloqueados e liberar um pedido em aberto; nunca dinheiro, nota, exclusão ou mensagem a cliente.
// Cadastro da chave (24/10/2026, Anderson: "cadastre a chave por mim"): {"acao":"registrar_chave","chave_publica":…}
// com Authorization: Bearer <senha de leitura do Caixa> (a mesma da crm-caixa-leitura, que o servidor da Agilité já
// tem) E assinado pela própria chave. Só vale enquanto NÃO há NENHUMA chave (nem desativada): depois da primeira, o
// cadastro por aqui fecha para sempre (409); trocar a chave só pelo banco (revisão de segurança de 24/10/2026).
// Deploy: verify_jwt DESLIGADO (a autenticação é a assinatura). A chave de serviço só existe aqui dentro.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const cabecalhos = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const resposta = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status, headers: cabecalhos });
const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// deno-lint-ignore no-explicit-any
async function assinaturaValida(db: any, corpo: string, assinatura: string, so: string | null = null) {
  if (!assinatura || assinatura.length > 200) return false;
  const { data, error } = so ? { data: [{ chave_publica: so }], error: null } : await db.from('crm_ceo_chaves').select('chave_publica').eq('ativa', true);
  if (error || !data) return false;
  let sig: Uint8Array;
  try { sig = b64(assinatura); } catch { return false; }
  const msg = new TextEncoder().encode(corpo);
  for (const k of data) {
    try {
      const chave = await crypto.subtle.importKey('raw', b64(k.chave_publica), { name: 'Ed25519' }, false, ['verify']);
      if (await crypto.subtle.verify({ name: 'Ed25519' }, chave, sig, msg)) return true;
    } catch { /* chave estragada: tenta a próxima */ }
  }
  return false;
}

async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// deno-lint-ignore no-explicit-any
async function registrar(db: any, req: Request, corpo: string, c: any) {
  const auth = req.headers.get('authorization') || '';
  const senha = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (senha.length < 32) return resposta(401, { erro: 'não autorizado' });
  const { data: hs, error: e1 } = await db.from('crm_integracoes').select('token_hash').eq('uso', 'caixa').eq('ativo', true);
  if (e1) return resposta(500, { erro: 'falhou no CRM' });
  const h = await sha256(senha);
  // deno-lint-ignore no-explicit-any
  if (!(hs || []).some((x: any) => x.token_hash === h)) return resposta(401, { erro: 'não autorizado' });
  const chave = String(c.chave_publica || '');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(chave)) return resposta(400, { erro: 'chave inválida' });
  if (!Number.isFinite(c.ts) || Math.abs(Date.now() / 1000 - c.ts) > 300) return resposta(401, { erro: 'não autorizado' });
  if (!(await assinaturaValida(db, corpo, req.headers.get('x-ceo-assinatura') || '', chave))) return resposta(401, { erro: 'não autorizado' });
  const { data: ja, error: e2 } = await db.from('crm_ceo_chaves').select('chave_publica, ativa');
  if (e2) return resposta(500, { erro: 'falhou no CRM' });
  // deno-lint-ignore no-explicit-any
  if ((ja || []).some((x: any) => x.chave_publica === chave && x.ativa)) return resposta(200, { ok: true, ja_estava: true });
  if ((ja || []).length) return resposta(409, { erro: 'já existe chave cadastrada; trocar só pelo banco' });
  const { error: e3 } = await db.from('crm_ceo_chaves').insert({ nome: 'Servidor da Agilité (cadastrada por ele mesmo)', chave_publica: chave });
  if (e3) return resposta(500, { erro: 'falhou no CRM' });
  return resposta(200, { ok: true, registrada: true });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const corpo = await req.text();
  if (corpo.length > 2000) return resposta(413, { erro: 'corpo grande demais' });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  // deno-lint-ignore no-explicit-any
  let pre: any = {};
  try { pre = JSON.parse(corpo); } catch { /* conferido abaixo */ }
  if (pre && pre.acao === 'registrar_chave') return await registrar(db, req, corpo, pre);
  if (!(await assinaturaValida(db, corpo, req.headers.get('x-ceo-assinatura') || ''))) return resposta(401, { erro: 'não autorizado' });
  // deno-lint-ignore no-explicit-any
  let c: any;
  try { c = JSON.parse(corpo); } catch { return resposta(400, { erro: 'JSON inválido' }); }
  if (!Number.isFinite(c.ts) || Math.abs(Date.now() / 1000 - c.ts) > 300) return resposta(401, { erro: 'não autorizado' });
  if (typeof c.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(c.nonce)) return resposta(400, { erro: 'nonce inválido' });
  if (c.aud !== 'crm-ceo-acao') return resposta(401, { erro: 'não autorizado' });
  const numero = Number(c.numero);
  try {
    if (c.acao === 'bloqueados') {
      const { data, error } = await db.rpc('crm_ceo_pedidos_bloqueados');
      if (error) throw new Error(error.message);
      return resposta(200, { ok: true, pedidos: data });
    }
    if (c.acao === 'ver' || c.acao === 'liberar') {
      if (!Number.isInteger(numero) || numero < 1 || numero > 999999999) return resposta(400, { erro: 'número do pedido inválido' });
      const esperado = Array.isArray(c.esperado) && c.esperado.length <= 10 && c.esperado.every((x: unknown) => typeof x === 'string' && x.length <= 30) ? c.esperado : null;
      if (c.acao === 'liberar' && !esperado) return resposta(400, { erro: 'faltam os bloqueios esperados' });
      const { data, error } = c.acao === 'ver'
        ? await db.rpc('crm_ceo_pedido_ver', { p_numero: numero })
        : await db.rpc('crm_ceo_pedido_liberar', { p_numero: numero, p_nonce: c.nonce, p_esperado: esperado });
      if (error) throw new Error(error.message);
      return resposta(200, c.acao === 'ver' ? { ok: true, pedido: data } : data);
    }
    return resposta(400, { erro: 'ação fora da lista' });
  } catch (e) {
    const m = (e as Error).message;
    if (/duplicate key|crm_ceo_acoes_nonce/.test(m)) return resposta(409, { erro: 'pedido repetido (mesmo nonce)' });
    console.error('[crm-ceo-acao]', m);
    return resposta(500, { erro: 'falhou no CRM' });
  }
});
