// Edge Function: aviso do Banco do Brasil (webhook da Cobrança, "baixa operacional") — 13/11/2026, pedido do Anderson depois
// do e-mail do gerente ("a configuração e habilitação da URL de Callback é toda feita no Portal Developers").
//   POST (o BB manda a lista de boletos pagos)  → pede um ciclo da crm-bb já (o mesmo do agendador de 10 em 10 min)
// O conteúdo do aviso NÃO é usado: o ciclo lê no próprio BB o que foi pago, com as chaves de sempre. Por isso não há senha:
// quem chamar este endereço só adianta a conferência, e no máximo uma vez por minuto (crm_bb_aviso, no banco).
// Deploy: verify_jwt DESLIGADO (quem chama é o BB). Endereço a cadastrar no Portal Developers (aplicação "CRM OneClean"):
//   https://udhigavckigciqnicgyy.supabase.co/functions/v1/crm-bb-aviso
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method === 'GET' || req.method === 'HEAD') return resposta(200, { ok: true });   // o portal pode testar o endereço
  if (req.method !== 'POST') return resposta(405, { erro: 'método não aceito' });
  // só a contagem, para o registro (o corpo tem dados do pagador: não é guardado)
  let itens = 0;
  try { const j = JSON.parse((await req.text()).slice(0, 1_000_000)); itens = Array.isArray(j) ? j.length : 1; } catch { itens = 0; }
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data, error } = await db.rpc('crm_bb_aviso', { p_itens: itens });
    if (error) throw new Error(error.message);
    return resposta(200, { ok: true, ciclo: data === true });
  } catch (e) {
    console.error('[crm-bb-aviso] ' + (e as Error).message);
    // 200 mesmo assim: o agendador de 10 em 10 min cobre; erro aqui só faria o BB repetir o aviso
    return resposta(200, { ok: true, ciclo: false });
  }
});
