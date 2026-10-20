// Edge Function: retorno do WhatsApp oficial da Meta (webhook) — 20/10/2026, pedido do Anderson junto com a mensagem
// do boleto ao cliente: o "Já paguei" do cliente, se a mensagem foi entregue e lida, e o que o cliente responder.
//   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  → a Meta confere o endereço (WHATSAPP_VERIFY_TOKEN)
//   POST (assinado pela Meta com o segredo do app: X-Hub-Signature-256, WHATSAPP_APP_SECRET)
//     · status das nossas mensagens → crm_boletos.cli_status (cliente) e wa_entrega (vendedor(a)): entregue, lido, falhou
//     · "Já paguei" (botão ou escrito) → cli_pagou_em, tarefa para o(a) vendedor(a) e para o administrador conferir no banco,
//       e uma resposta de agradecimento ao cliente
//     · outra resposta do cliente → tarefa para o(a) vendedor(a) com o texto, e o cliente fica sabendo que foi repassado
//       (uma vez a cada 12 h)
//   Tudo fica em crm_whatsapp_eventos (só o administrador lê). Sem os dois segredos, nada é aceito.
// Deploy: verify_jwt DESLIGADO (quem chama é a Meta; a assinatura é a senha).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { eventosDoCorpo, statusCRM, novoStatus, ehPagou, idDoPayload, variantesBR, textoPagou, textoRepasse } from './logica.js';

const GRAPH = 'https://graph.facebook.com/v25.0';
const texto = (status: number, t: string) => new Response(t, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
const moeda = (v: number) => { const [i, d] = Math.abs(Number(v) || 0).toFixed(2).split('.'); return 'R$ ' + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d; };
const nomeDoc = (b: { nota_numero?: number | null; duplicata?: string | null }) => (b.nota_numero ? 'NF ' + b.nota_numero : 'duplicata ' + b.duplicata);
const primeiro = (t: unknown) => String(t || '').trim().split(/\s+/)[0] || '';
const telWa = (v: unknown) => { let d = String(v || '').replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; return d.length >= 12 ? d : ''; };

function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
async function assinaturaOk(segredo: string, corpo: string, cabecalho: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(corpo)));
  const hex = 'sha256=' + [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  return iguais(hex, String(cabecalho || '').trim().toLowerCase());
}

type Boleto = { id: string; empresa_id: string; nota_numero: number | null; duplicata: string; valor: number; cli_msg: string | null; cli_status: string | null; cli_pagou_em: string | null; cli_tel: string | null };

Deno.serve(async (req) => {
  const segredo = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';
  const verifica = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';
  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams;
    if (verifica && q.get('hub.mode') === 'subscribe' && iguais(String(q.get('hub.verify_token') || ''), verifica)) return texto(200, q.get('hub.challenge') || '');
    return texto(403, 'não conferiu');
  }
  if (req.method !== 'POST') return texto(405, 'use POST');
  if (!segredo || !verifica) return texto(503, 'retorno ainda não configurado');
  const bruto = await req.text();
  if (!(await assinaturaOk(segredo, bruto, req.headers.get('x-hub-signature-256') || ''))) return texto(401, 'assinatura inválida');
  let corpo: unknown;
  try { corpo = JSON.parse(bruto); } catch { return texto(400, 'corpo inválido'); }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const token = Deno.env.get('WHATSAPP_TOKEN') ?? '';
  const phoneId = Deno.env.get('WHATSAPP_PHONE_ID') ?? '';
  const responde = async (para: string, body: string) => {
    if (!token || !phoneId) return;
    try {
      const r = await fetch(GRAPH + '/' + phoneId + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body } }) });
      const j = await r.json().catch(() => ({}));
      await db.from('crm_whatsapp_eventos').insert({ tipo: 'resposta', de: para, texto: body, wamid: (j.messages && j.messages[0] && j.messages[0].id) || null, status: r.ok ? 'enviado' : 'falhou' });
    } catch (e) { console.error('resposta automática falhou', e); }
  };
  const tarefa = (empresa_id: string, responsavel_id: string | null, descricao: string) =>
    db.from('crm_atividades').insert({ empresa_id, responsavel_id, tipo: 'tarefa', descricao, data_hora: new Date().toISOString(), automatica: true });

  // a Meta reenvia o que não recebeu 200: depois de assinar, sempre 200 (o erro vai para o log)
  for (const ev of eventosDoCorpo(corpo)) {
    try {
      await db.from('crm_whatsapp_eventos').insert({ tipo: ev.tipo, wamid: ev.wamid || null, status: ev.status || null, de: ev.de || ev.para || null,
        texto: ev.tipo === 'status' ? (ev.erro || null) : ev.texto, payload: ev.payload || null, contexto: ev.contexto || null, bruto: ev });
      if (ev.tipo === 'status') {
        const novo = statusCRM(ev.status);
        if (!novo || !ev.wamid) continue;
        const { data: cli } = await db.from('crm_boletos').select('id, cli_status').eq('cli_msg', ev.wamid);
        for (const b of cli || []) {
          const s = novoStatus(b.cli_status, novo);
          if (s) await db.from('crm_boletos').update(Object.assign({ cli_status: s }, s === 'falhou' ? { cli_erro: ev.erro || 'a Meta não entregou' } : {})).eq('id', b.id);
        }
        const { data: ven } = await db.from('crm_boletos').select('id, wa_entrega').eq('wa_msg', ev.wamid);
        for (const b of ven || []) {
          const s = novoStatus(b.wa_entrega, novo);
          if (s) await db.from('crm_boletos').update(Object.assign({ wa_entrega: s }, s === 'falhou' ? { wa_erro: ev.erro || 'a Meta não entregou' } : {})).eq('id', b.id);
        }
        continue;
      }
      // mensagem recebida: de qual boleto? pela mensagem respondida, pelo id do botão ou pelo último boleto mandado a esse número
      const campos = 'id, empresa_id, nota_numero, duplicata, valor, cli_msg, cli_status, cli_pagou_em, cli_tel';
      let l: Boleto[] = [];
      if (ev.contexto) l = ((await db.from('crm_boletos').select(campos).eq('cli_msg', ev.contexto)).data || []) as Boleto[];
      const pid = idDoPayload(ev.payload);
      if (!l.length && pid) {
        const { data: b } = await db.from('crm_boletos').select(campos).eq('id', pid).maybeSingle();
        if (b) l = (b.cli_msg ? ((await db.from('crm_boletos').select(campos).eq('cli_msg', b.cli_msg)).data || [b]) : [b]) as Boleto[];
      }
      if (!l.length) {
        const desde = new Date(Date.now() - 30 * 864e5).toISOString();
        const { data: ult } = await db.from('crm_boletos').select(campos).in('cli_tel', variantesBR(ev.de)).gte('cli_em', desde).order('cli_em', { ascending: false }).limit(1);
        const b = (ult || [])[0];
        if (b && b.cli_msg) l = ((await db.from('crm_boletos').select(campos).eq('cli_msg', b.cli_msg)).data || [b]) as Boleto[];
      }
      if (!l.length) continue; // não é resposta de boleto: fica só no registro (o administrador vê em Integrações)
      const empId = l[0].empresa_id;
      const { data: e } = await db.from('crm_empresas').select('nome, responsavel_id').eq('id', empId).maybeSingle();
      const { data: u } = e && e.responsavel_id ? await db.from('crm_usuarios').select('nome, telefone').eq('user_id', e.responsavel_id).maybeSingle() : { data: null };
      const docs = l.map(b => nomeDoc(b) + ' ' + moeda(Number(b.valor))).join(', ');
      const vend = primeiro(u && u.nome);
      if (ehPagou(ev)) {
        const novos = l.filter(b => !b.cli_pagou_em);
        if (!novos.length) continue; // tocou de novo: já avisado
        await db.from('crm_boletos').update({ cli_pagou_em: new Date().toISOString() }).in('id', novos.map(b => b.id));
        await tarefa(empId, e ? e.responsavel_id : null, 'O cliente disse no WhatsApp que já pagou: ' + docs + '. O financeiro confere no banco; não precisa cobrar até lá.');
        const { data: adms } = await db.from('crm_usuarios').select('user_id').eq('papel', 'admin').eq('ativo', true);
        for (const a of adms || []) if (!e || a.user_id !== e.responsavel_id) await tarefa(empId, a.user_id, 'Conferir no banco: ' + ((e && e.nome) || 'cliente') + ' tocou em "Já paguei" (' + docs + '). Entrou? Dê o "Recebi" no Caixa.');
        await responde(String(ev.de), textoPagou(primeiro(ev.nome), vend));
        continue;
      }
      if (!ev.texto || /^\[reação/.test(ev.texto)) continue;
      await tarefa(empId, e ? e.responsavel_id : null, 'O cliente respondeu no WhatsApp da empresa (boleto ' + docs + '): "' + ev.texto.slice(0, 500) + '". Responda pelo seu WhatsApp.');
      const desde = new Date(Date.now() - 12 * 3600e3).toISOString();
      const { count } = await db.from('crm_whatsapp_eventos').select('id', { count: 'exact', head: true }).eq('tipo', 'resposta').in('de', variantesBR(ev.de)).gte('criado_em', desde);
      if (!count) await responde(String(ev.de), textoRepasse(vend, telWa(u && u.telefone)));
    } catch (err) {
      console.error('retorno da Meta', ev.tipo, ev.wamid, err);
    }
  }
  return texto(200, 'ok');
});
