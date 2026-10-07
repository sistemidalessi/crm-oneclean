// Edge Function: "Não quero mais receber" dos e-mails da cadência (LGPD). O link do e-mail abre a
// página sair.html do CRM (as funções do Supabase não servem HTML), que chama esta com o token.
//   POST { t: '<empresa_id>.<assinatura>' } → marca crm_empresas.email_sair_em (ninguém do CRM desfaz).
// O token é a assinatura HMAC do id da empresa com a chave de serviço (feita pela crm-email): não dá
// para descadastrar outro cliente trocando o id. Deploy: verify_jwt DESLIGADO (quem clica não tem login).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function assina(texto: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto));
  return [...new Uint8Array(s)].slice(0, 16).map(x => x.toString(16).padStart(2, '0')).join('');
}
function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  let t = '';
  try { t = String((await req.json()).t ?? ''); } catch { /* vazio */ }
  const [id, sig] = t.split('.');
  if (!/^[0-9a-f-]{36}$/.test(id ?? '') || !sig || !iguais(sig, await assina('sair:' + id))) return resposta(400, { erro: 'link inválido' });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data } = await db.from('crm_empresas').update({ email_sair_em: new Date().toISOString() }).eq('id', id).is('email_sair_em', null).select('id, responsavel_id');
  if (data && data.length) {
    await db.from('crm_atividades').insert({ empresa_id: id, tipo: 'sistema', concluida: true, concluida_em: new Date().toISOString(), automatica: true,
      responsavel_id: data[0].responsavel_id, descricao: 'O cliente pediu, pelo link do e-mail, para não receber mais os e-mails da cadência.' });
  }
  return resposta(200, { ok: true });
});
