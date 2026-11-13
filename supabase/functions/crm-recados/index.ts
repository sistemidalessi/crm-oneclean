// Edge Function crm-recados — os recados do Diretor de Vendas para a equipe (13/11/2026, pedido do Anderson: "quero um
// negócio automático; quando eu for cobrar através do diretor, é porque eu vou estar na rua").
// O recado nasce numa linha de crm_recados (gravada pelo administrador, ou pelo Claude a pedido dele); o gatilho do banco
// chama esta função (crm_interno.recados_tick, com a senha do agendador da cobrança) e ela:
//   1. manda o recado por e-mail a quem ele é dirigido (caixa da empresa, crm-enviar-email; resposta do e-mail vai ao
//      administrador). Dentro do CRM a mesma mensagem abre numa janela ao entrar e só fecha com a resposta (recados.js);
//   2. quando a pessoa responde no CRM, manda a resposta por e-mail ao administrador.
//   POST { acao: 'rodar' }  (o agendador, senha do banco) → faz os dois passos para o que estiver pendente.
// Exceção à regra de envio (CLAUDE.md): é o próprio Anderson quem manda cada recado; a função só entrega e avisa a resposta.
// Deploy: verify_jwt DESLIGADO (o agendador não tem login).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

// deno-lint-ignore no-explicit-any
type Linha = Record<string, any>;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const EMAIL_URL = () => Deno.env.get('SUPABASE_URL')! + '/functions/v1/crm-enviar-email';
const EMAIL_AUTH = () => 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EMPRESA = Deno.env.get('CRM_EMPRESA_NOME') ?? 'OneClean';
const SITE = 'https://sistemidalessi.github.io/crm-oneclean/';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const quando = (v: string) => new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const html = (texto: string) => '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:640px">' +
  texto.split('\n').map(l => l.trim() ? '<p style="margin:0 0 10px">' + esc(l) + '</p>' : '').join('') + '</div>';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let c: Linha;
  try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  let ok = false;
  if (bearer.length >= 32 && /^[0-9a-f]+$/.test(bearer)) { const { data } = await db.rpc('crm_cobranca_senha_ok', { p: bearer }); ok = data === true; }
  if (!ok) return resposta(401, { erro: 'só o agendador' });
  if (c.acao !== 'rodar') return resposta(400, { erro: 'ação desconhecida' });
  if (!Deno.env.get('EMAIL_SENHA')) return resposta(200, { ok: false, erro: 'o e-mail não está ligado (EMAIL_SENHA)' });

  const { data: us } = await db.from('crm_usuarios').select('user_id, nome, email, papel, ativo');
  const porId = new Map(((us || []) as Linha[]).map(u => [u.user_id, u]));
  const adms = ((us || []) as Linha[]).filter(u => u.papel === 'admin' && u.ativo && EMAIL.test(String(u.email || '')));
  const chefe = adms[0];
  const caixa = adms[0];   // o remetente é sempre a caixa da empresa (crm-enviar-email troca o endereço); o nome é o do diretor

  async function manda(para: string, assunto: string, texto: string, deNome: string) {
    const corpo = { sender: { name: deNome + ' · ' + EMPRESA, email: caixa ? caixa.email : para }, replyTo: chefe ? { name: chefe.nome, email: chefe.email } : undefined,
      to: [{ email: para }], subject: assunto, htmlContent: html(texto), textContent: texto, tags: ['recado'] };
    const r = await fetch(EMAIL_URL(), { method: 'POST', headers: { Authorization: EMAIL_AUTH(), 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(corpo) });
    if (!r.ok) throw new Error('o e-mail não saiu (' + r.status + '): ' + (await r.text().catch(() => '')).slice(0, 200));
  }

  const feitos = { enviados: 0, avisos: 0, erros: [] as string[] };
  // 1. recados novos → e-mail a quem é dirigido
  const { data: novos } = await db.from('crm_recados').select('*').is('email_em', null).is('email_erro', null).order('id').limit(30);
  for (const r of (novos || []) as Linha[]) {
    // pega o recado antes de mandar (o gatilho pode chamar a função várias vezes ao mesmo tempo: só uma manda)
    const { data: meu } = await db.from('crm_recados').update({ email_em: new Date().toISOString() }).eq('id', r.id).is('email_em', null).select('id');
    if (!meu || !meu.length) continue;
    const u = porId.get(r.para);
    try {
      if (!u || !EMAIL.test(String(u.email || ''))) throw new Error('sem e-mail no cadastro');
      const prazo = r.prazo ? '\nPrazo para responder: ' + quando(r.prazo) + '.' : '';
      // 13/11/2026: sem o endereço do CRM no corpo (a caixa recusou os 5 primeiros com "554 5.7.1 Rejected for policy reason";
      // o teste sem link, para o mesmo domínio, saiu)
      const texto = r.texto + '\n' + prazo + '\nResponda pelo CRM: ao entrar, a mensagem abre na tela com o espaço para a sua resposta.' +
        '\n\n' + r.de + '\n' + EMPRESA;
      await manda(u.email, r.de + ' · ' + r.assunto, texto, r.de);
      feitos.enviados++;
    } catch (e) {
      const m = String((e as Error).message || e).slice(0, 300);
      await db.from('crm_recados').update({ email_em: null, email_erro: m }).eq('id', r.id);
      feitos.erros.push('#' + r.id + ': ' + m);
    }
  }
  // 2. respostas novas → e-mail ao administrador
  const { data: resp } = await db.from('crm_recados').select('*').not('respondido_em', 'is', null).is('aviso_em', null).is('aviso_erro', null).order('id').limit(30);
  for (const r of (resp || []) as Linha[]) {
    const { data: meu } = await db.from('crm_recados').update({ aviso_em: new Date().toISOString() }).eq('id', r.id).is('aviso_em', null).select('id');
    if (!meu || !meu.length) continue;
    const u = porId.get(r.para);
    try {
      if (!chefe) throw new Error('nenhum administrador com e-mail');
      const nome = u ? String(u.nome) : 'alguém da equipe';
      const texto = nome + ' respondeu ao recado "' + r.assunto + '" em ' + quando(r.respondido_em) +
        (r.prazo ? (new Date(r.respondido_em) > new Date(r.prazo) ? ' (DEPOIS do prazo de ' + quando(r.prazo) + ')' : ' (dentro do prazo)') : '') + '.\n\n' +
        'RESPOSTA:\n' + r.resposta + '\n\n— Recado enviado —\n' + r.texto;
      await manda(chefe.email, 'Resposta de ' + nome.split(' ')[0] + ' · ' + r.assunto, texto, r.de);
      feitos.avisos++;
    } catch (e) {
      const m = String((e as Error).message || e).slice(0, 300);
      await db.from('crm_recados').update({ aviso_em: null, aviso_erro: m }).eq('id', r.id);
      feitos.erros.push('#' + r.id + ': ' + m);
    }
  }
  return resposta(200, { ok: true, ...feitos });
});
