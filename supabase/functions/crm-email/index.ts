// Edge Function: envia os e-mails da CADÊNCIA (07/10/2026) pelo Brevo, em nome da vendedora da carteira
// do cliente (a resposta do cliente vai para ela). Chamada pelo CRM com o login de quem aprova a fila.
//   POST { acao: 'situacao' }                     → { ligado } (a chave do Brevo está configurada?)
//   POST { acao: 'enviar', empresa_id, tipo, campanha_id?, assunto, corpo, para?, sair_url, marca }
//   POST { acao: 'aberturas' }                    → lê no Brevo quem abriu/clicou nos últimos 30 dias
// Segurança: o cliente só é achado se quem chama enxerga a empresa (RLS, com o login dele); os
// destinatários vêm do BANCO (o app pode só tirar algum, nunca pôr outro); limite por dia; quem pediu
// para sair não recebe. A chave do Brevo fica SÓ nos segredos do Supabase (BREVO_API_KEY) — nunca no
// app, no repositório ou no chat. Deploy: verify_jwt ligado (o padrão).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const separa = (v: unknown) => String(v ?? '').split(/[;,\s/]+/).map(s => s.trim().replace(/^<|>$/g, '')).filter(s => EMAIL.test(s));
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function assina(texto: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto));
  return [...new Uint8Array(s)].slice(0, 16).map(x => x.toString(16).padStart(2, '0')).join('');
}

// Texto da fila (com quebras de linha) → HTML simples, que abre bem em qualquer leitor de e-mail.
function html(corpo: string, m: { nome: string; cor: string; logo: string }, rodape: string, sair: string) {
  const paragrafos = esc(corpo).split(/\n{2,}/).map(p => '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br>') + '</p>').join('');
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#f3f5f7"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f7"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1f2933">' +
    '<tr><td style="height:6px;background:' + m.cor + '"></td></tr>' +
    (m.logo ? '<tr><td style="padding:20px 28px 4px"><img src="' + esc(m.logo) + '" alt="' + esc(m.nome) + '" style="max-height:56px;max-width:220px;border:0"></td></tr>' : '') +
    '<tr><td style="padding:18px 28px 8px;font-size:15px;line-height:1.55">' + paragrafos + '</td></tr>' +
    '<tr><td style="padding:14px 28px 22px;border-top:1px solid #e5e9ee;font-size:12px;line-height:1.5;color:#6b7785">' + esc(rodape) +
    '<br>Não quer mais receber estes e-mails? <a href="' + esc(sair) + '" style="color:#6b7785">Clique aqui</a>.</td></tr>' +
    '</table></td></tr></table></body></html>';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: quem } = await comoUsuario.auth.getUser();
  if (!quem?.user) return resposta(401, { erro: 'faça login de novo' });
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: eu } = await db.from('crm_usuarios').select('user_id, nome, email, papel, ativo').eq('user_id', quem.user.id).maybeSingle();
  if (!eu || !eu.ativo || !['admin', 'gestor', 'vendedor'].includes(eu.papel)) return resposta(403, { erro: 'sem permissão para e-mails' });
  const chave = Deno.env.get('BREVO_API_KEY') ?? '';
  let c: Record<string, unknown>;
  try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }

  if (c.acao === 'situacao') return resposta(200, { ligado: !!chave });
  if (!chave) return resposta(503, { erro: 'o envio de e-mail ainda não está ligado: falta a chave do Brevo nos segredos do Supabase (BREVO_API_KEY)' });

  if (c.acao === 'aberturas') {
    const desde = new Date(Date.now() - 31 * 864e5).toISOString();
    const { data: envs } = await db.from('crm_email_envios').select('id, provedor_id, aberto_em, clicado_em').eq('situacao', 'enviado').gte('criado_em', desde).not('provedor_id', 'is', null);
    const porId = new Map((envs ?? []).map(e => [String(e.provedor_id), e]));
    let abertos = 0, clicados = 0, devolvidos = 0;
    for (const ev of ['opened', 'clicks', 'hardBounces']) {
      const r = await fetch('https://api.brevo.com/v3/smtp/statistics/events?limit=2500&days=30&event=' + ev, { headers: { 'api-key': chave, accept: 'application/json' } });
      if (!r.ok) return resposta(502, { erro: 'o Brevo não respondeu (' + r.status + ')' });
      const j = await r.json();
      for (const x of (j.events ?? [])) {
        const e = porId.get(String(x.messageId)); if (!e) continue;
        const patch: Record<string, unknown> = {};
        if (ev === 'opened' && !e.aberto_em) { patch.aberto_em = x.date; e.aberto_em = x.date; abertos++; }
        if (ev === 'clicks' && !e.clicado_em) { patch.clicado_em = x.date; e.clicado_em = x.date; clicados++; if (!e.aberto_em) { patch.aberto_em = x.date; e.aberto_em = x.date; } }
        if (ev === 'hardBounces') { patch.erro = 'devolvido: ' + String(x.email ?? '') + ' não existe ou não aceita e-mail'; devolvidos++; }
        if (Object.keys(patch).length) await db.from('crm_email_envios').update(patch).eq('id', e.id);
      }
    }
    return resposta(200, { ok: true, abertos, clicados, devolvidos });
  }

  if (c.acao !== 'enviar') return resposta(400, { erro: 'ação desconhecida' });
  const tipo = String(c.tipo ?? '');
  const assunto = String(c.assunto ?? '').trim().slice(0, 200);
  const corpo = String(c.corpo ?? '').trim().slice(0, 20000);
  if (!['reposicao', 'relacionamento'].includes(tipo)) return resposta(400, { erro: 'tipo inválido' });
  if (!assunto || !corpo) return resposta(400, { erro: 'assunto e texto são obrigatórios' });
  let sair: URL;
  try { sair = new URL(String(c.sair_url ?? '')); } catch { return resposta(400, { erro: 'endereço de descadastro inválido' }); }
  const origem = req.headers.get('origin');
  if (sair.protocol !== 'https:' && sair.hostname !== 'localhost') return resposta(400, { erro: 'endereço de descadastro inválido' });
  if (origem && sair.origin !== origem) return resposta(400, { erro: 'endereço de descadastro de outro site' });

  // a empresa, com o login de quem chama: se a RLS não deixa ver, não envia
  const { data: emp } = await comoUsuario.from('crm_empresas').select('id, nome, email, responsavel_id, email_sair_em').eq('id', String(c.empresa_id ?? '')).maybeSingle();
  if (!emp) return resposta(404, { erro: 'cliente não encontrado (ou fora da sua carteira)' });
  if (emp.email_sair_em) return resposta(409, { erro: 'o cliente pediu para não receber estes e-mails' });
  const { data: pessoas } = await db.from('crm_contatos').select('email, principal').eq('empresa_id', emp.id);
  const doBanco = [...separa(emp.email), ...(pessoas ?? []).sort((a, b) => Number(b.principal) - Number(a.principal)).flatMap(p => separa(p.email))];
  const unicos = [...new Map(doBanco.map(m => [m.toLowerCase(), m])).values()];
  const pedidos = Array.isArray(c.para) ? new Set((c.para as unknown[]).map(x => String(x).toLowerCase())) : null;
  const para = pedidos ? unicos.filter(m => pedidos.has(m.toLowerCase())) : unicos;
  if (!para.length) return resposta(400, { erro: unicos.length ? 'nenhum dos e-mails marcados é do cadastro do cliente' : 'o cliente não tem e-mail cadastrado' });

  const { data: cfg } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
  const limite = Number((cfg?.dados ?? {}).email_limite_dia) || 200;
  const inicioDia = new Date(hojeSP() + 'T00:00:00-03:00').toISOString();
  const { count } = await db.from('crm_email_envios').select('id', { count: 'exact', head: true }).eq('situacao', 'enviado').gte('criado_em', inicioDia);
  if ((count ?? 0) >= limite) return resposta(429, { erro: 'chegou ao limite de ' + limite + ' e-mails da cadência por dia; o resto fica para amanhã' });
  const { data: recente } = await db.from('crm_email_envios').select('criado_em').eq('empresa_id', emp.id).eq('situacao', 'enviado').gte('criado_em', new Date(Date.now() - 4 * 864e5).toISOString()).limit(1);
  if (recente && recente.length) return resposta(409, { erro: 'este cliente já recebeu um e-mail da cadência nos últimos dias' });
  let campanha: string | null = null;
  if (c.campanha_id) {
    const { data: k } = await db.from('crm_email_campanhas').select('id').eq('id', String(c.campanha_id)).maybeSingle();
    if (!k) return resposta(400, { erro: 'campanha não encontrada' });
    campanha = k.id;
  }

  // remetente: a vendedora da carteira (a resposta vai para ela); sem vendedora, quem aprovou
  let rem = eu;
  if (emp.responsavel_id && emp.responsavel_id !== eu.user_id) {
    const { data: v } = await db.from('crm_usuarios').select('user_id, nome, email, papel, ativo').eq('user_id', emp.responsavel_id).maybeSingle();
    if (v && v.ativo && EMAIL.test(String(v.email ?? ''))) rem = v;
  }
  if (!EMAIL.test(String(rem.email ?? ''))) return resposta(400, { erro: 'a vendedora não tem e-mail no cadastro do CRM' });
  const m = (c.marca ?? {}) as Record<string, unknown>;
  const marca = { nome: String(m.nome ?? '').slice(0, 60) || 'CRM', cor: /^#[0-9a-f]{6}$/i.test(String(m.cor ?? '')) ? String(m.cor) : '#334e68', logo: '' };
  try { const l = new URL(String(m.logo ?? '')); if (l.origin === sair.origin) marca.logo = l.href; } catch { /* sem logo */ }
  sair.search = '?t=' + emp.id + '.' + await assina('sair:' + emp.id);
  const rodape = 'Este e-mail foi enviado por ' + rem.nome + ' (' + rem.email + '), da ' + marca.nome + '. É só responder para falar com ' + String(rem.nome).split(' ')[0] + '.';

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': chave, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: rem.nome + ' · ' + marca.nome, email: rem.email }, replyTo: { name: rem.nome, email: rem.email },
      to: para.map(email => ({ email })), subject: assunto, htmlContent: html(corpo, marca, rodape, sair.href),
      textContent: corpo + '\n\n--\n' + rodape + '\nNão quer mais receber estes e-mails? ' + sair.href,
      headers: { 'List-Unsubscribe': '<' + sair.href + '>' }, tags: ['cadencia', tipo] })
  });
  const j = await r.json().catch(() => ({}));
  const base = { empresa_id: emp.id, responsavel_id: rem.user_id, tipo, campanha_id: campanha, para, assunto, corpo, enviado_por: eu.user_id };
  if (!r.ok) {
    const erro = 'o Brevo recusou (' + r.status + '): ' + String((j as Record<string, unknown>).message ?? '').slice(0, 300);
    await db.from('crm_email_envios').insert({ ...base, situacao: 'erro', erro });
    return resposta(502, { erro });
  }
  const { data: env } = await db.from('crm_email_envios').insert({ ...base, situacao: 'enviado', provedor_id: String((j as Record<string, unknown>).messageId ?? '') }).select().single();
  await db.from('crm_atividades').insert({ empresa_id: emp.id, tipo: 'email', concluida: true, concluida_em: new Date().toISOString(), automatica: true,
    responsavel_id: rem.user_id, criado_por: eu.user_id, descricao: 'E-mail da cadência (' + (tipo === 'reposicao' ? 'reposição' : 'relacionamento') + '): ' + assunto + ' — para ' + para.join(', ') });
  return resposta(200, { ok: true, envio: env });
});
