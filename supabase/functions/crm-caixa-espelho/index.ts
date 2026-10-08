// Edge Function: espelho das transferências entre empresas (08/10/2026). O sistema da Agilité manda aqui o
// par (ida + volta) de cada "Transferência entre empresas" lançada, ajustada, paga ou desfeita lá, e o
// Caixa do CRM fica igual sem ninguém lançar duas vezes. O caminho de volta (CRM → Agilité) é do próprio
// banco: gatilho → fila → pg_cron + pg_net (crm_espelho_tick). Regras e formato em schema.sql
// ("espelho Agilité ↔ OneClean"); quem grava é crm_espelho_aplicar().
//   POST …/functions/v1/crm-caixa-espelho   Authorization: Bearer <senha de gravação>   (só POST: o resto 405)
//   200 { ok: true, … } · 401 senha errada · 400 { erro } formato inválido
// A senha é gerada no CRM (Configurações → Integrações → "Espelho com a Agilité", crm_espelho_nova_senha);
// o banco guarda só o SHA-256 (crm_fin_espelho_cfg.token_hash). Deploy: verify_jwt DESLIGADO (a senha é
// conferida aqui).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const cabecalhos = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const resposta = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status, headers: cabecalhos });
const LIMITE = 20000; // bytes: um par tem 2 movimentos

async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ erro: 'só POST' }), { status: 405, headers: Object.assign({ Allow: 'POST' }, cabecalhos) });
  const auth = req.headers.get('authorization') ?? '';
  const senha = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (senha.length < 32) return resposta(401, { erro: 'Senha de gravação inválida.' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: cfg, error: e1 } = await db.from('crm_fin_espelho_cfg').select('token_hash').eq('id', 1).maybeSingle();
  if (e1) return resposta(500, { erro: 'Falha ao conferir a senha.' });
  if (!cfg || !cfg.token_hash || !iguais(await sha256(senha), String(cfg.token_hash))) return resposta(401, { erro: 'Senha de gravação inválida.' });

  const texto = await req.text();
  if (texto.length > LIMITE) return resposta(400, { erro: 'Corpo grande demais.' });
  let corpo: unknown;
  try { corpo = JSON.parse(texto); } catch { return resposta(400, { erro: 'JSON inválido.' }); }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return resposta(400, { erro: 'Esperava um objeto.' });

  const { data, error } = await db.rpc('crm_espelho_aplicar', { p: corpo });
  if (error) {
    // erro de formato (raise da função) volta como 400 com a mensagem; o resto, 500 sem detalhe
    const formato = /inválid|invalid input|precisa|lista|versao|origem/i.test(error.message || '');
    console.error('[crm-caixa-espelho] ' + (error.message || 'falha'));
    await db.from('crm_fin_espelho_log').insert({ sentido: 'recebido', par: String((corpo as Record<string, unknown>).par ?? '').slice(0, 80), status: formato ? 400 : 500,
      detalhe: { erro: (error.message || '').slice(0, 300) } });
    return formato ? resposta(400, { erro: error.message }) : resposta(500, { erro: 'Falha ao gravar.' });
  }
  return resposta(200, data);
});
