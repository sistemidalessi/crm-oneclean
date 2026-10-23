// Edge Function crm-cobranca — aviso de atraso ao cliente (23/10/2026, pedido do Anderson: "chegou em 5 dias úteis de
// atraso, já enviar; ou eles entram em contato e negociam com a vendedora, ou eu envio o cartório").
// Um aviso por cliente, uma vez por título: pelo WhatsApp da empresa (modelo "cobranca_atraso", em nome do(a) vendedor(a)
// da carteira, botões "Falar com quem me atende" e "Já paguei") e por e-mail (Brevo, do e-mail do(a) vendedor(a)), já
// dizendo que, sem o pagamento até o prazo, o título segue para o cartório. O CRM NUNCA manda sozinho ao cartório: quando o
// prazo vence sem "Já paguei", cria a tarefa "decidir o cartório" para cada administrador.
//   POST { acao: 'situacao' }     → configuração, modelo na Meta, avisos recentes (admin)
//   POST { acao: 'previa' }       → quem recebe hoje, com o texto (admin; não manda nada)
//   POST { acao: 'rodar' }        → manda os avisos de hoje e cria os alertas (admin pela tela; ou o agendador)
//   POST { acao: 'criar_modelo' } → cria o modelo "cobranca_atraso" na Meta (admin)
// Agendador: pg_cron (crm_cobranca_tick, dias úteis 9h05) com "Authorization: Bearer <senha>" que nasce no banco
// (crm_interno.cobranca_cfg) e é conferida por crm_cobranca_senha_ok; só roda se dados.cobranca_aviso.ligado = true.
// Deploy: verify_jwt DESLIGADO (o agendador não tem login; a função confere a senha ou o login do administrador).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { quemRecebe, prazoUtil, parametros, textoFinal, textoEmail, CORPO, alertasCartorio, celularesDoCliente, emailsDoCliente, telWa, moeda, docsTexto } from './avisos.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const GRAPH = 'https://graph.facebook.com/v25.0';
const MODELO = 'cobranca_atraso';
const EMPRESA = Deno.env.get('CRM_EMPRESA_NOME') ?? 'OneClean';
const BOTAO_FALAR = 'Falar com quem me atende';
const BOTAO_PAGUEI = 'Já paguei';
type Linha = Record<string, unknown>;
const hojeSP = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
const primeiro = (n: unknown) => String(n || '').trim().split(/\s+/)[0] || '';
const telBR = (t: string) => { const d = t.replace(/^55/, ''); return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : d; };
const param = (t: string) => ({ type: 'text', text: String(t || '-').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 900) });

async function graph(token: string, caminho: string, init: RequestInit = {}) {
  const r = await fetch(GRAPH + caminho, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) } });
  let j: Linha = {};
  try { j = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) { const e = (j.error || {}) as Linha; throw new Error(String(e.error_user_msg || e.message || 'a Meta respondeu ' + r.status) + (e.code ? ' (código ' + e.code + ')' : '')); }
  return j;
}
async function modeloInfo(token: string, wabaId: string) {
  const lm = await graph(token, '/' + wabaId + '/message_templates?name=' + MODELO + '&fields=name,status,language,rejected_reason,category');
  return ((lm.data as Linha[]) || []).find(m => m.language === 'pt_BR' && m.name === MODELO) || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let c: Linha;
  try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

  // quem chama: o agendador (senha do banco) ou o administrador logado
  let agendador = false, eu: Linha | null = null;
  if (bearer.length >= 32 && /^[0-9a-f]+$/.test(bearer)) {
    const { data: ok } = await db.rpc('crm_cobranca_senha_ok', { p: bearer });
    agendador = ok === true;
  }
  if (!agendador) {
    const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
    const { data: quem } = await comoUsuario.auth.getUser();
    if (!quem?.user) return resposta(401, { erro: 'faça login de novo' });
    const { data: u } = await db.from('crm_usuarios').select('user_id, papel, ativo, nome').eq('user_id', quem.user.id).maybeSingle();
    if (!u || !u.ativo || u.papel !== 'admin') return resposta(403, { erro: 'só o administrador' });
    eu = u as Linha;
  }
  if (agendador && c.acao !== 'rodar') return resposta(403, { erro: 'o agendador só roda' });

  const token = Deno.env.get('WHATSAPP_TOKEN') ?? '', phoneId = Deno.env.get('WHATSAPP_PHONE_ID') ?? '', wabaId = Deno.env.get('WHATSAPP_WABA_ID') ?? '';
  const brevo = Deno.env.get('BREVO_API_KEY') ?? '';
  const { data: cfgRow } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
  const dados = ((cfgRow as Linha | null)?.dados || {}) as Linha;
  const cfg = (dados.cobranca_aviso || {}) as Linha;
  const diasAtraso = Number(cfg.dias) > 0 ? Number(cfg.dias) : 5;
  const prazoDias = Number(dados.cobranca_prazo_cartorio) > 0 ? Number(dados.cobranca_prazo_cartorio) : 5;
  const hoje = hojeSP();

  try {
    if (c.acao === 'criar_modelo') {
      if (!token || !wabaId) return resposta(503, { erro: 'o WhatsApp da Meta ainda não está ligado (faltam os segredos)' });
      const r = await graph(token, '/' + wabaId + '/message_templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          name: MODELO, language: 'pt_BR', category: 'UTILITY',
          components: [
            { type: 'BODY', text: CORPO(EMPRESA), example: { body_text: [['Maria', 'Renata', 'a NF 2428, vencida em 16/10/2026', 'R$ 1.703,98', 'sexta-feira, 30/10/2026']] } },
            { type: 'FOOTER', text: EMPRESA + ' · financeiro' },
            { type: 'BUTTONS', buttons: [
              // a Meta não aceita wa.me direto no botão: o crm-pdf (?a=<aviso>) redireciona para o WhatsApp do(a) vendedor(a)
              { type: 'URL', text: BOTAO_FALAR, url: url + '/functions/v1/crm-pdf?a={{1}}', example: [url + '/functions/v1/crm-pdf?a=00000000-0000-4000-8000-000000000000'] },
              { type: 'QUICK_REPLY', text: BOTAO_PAGUEI }] }]
        })
      });
      return resposta(200, { ok: true, modelo: r });
    }

    // títulos e o que já foi avisado
    const { data: tit } = await db.from('crm_titulos').select('id, duplicata, nota_numero, parcela, empresa_id, vencimento, valor, previsao, cartorio_em').lt('vencimento', hoje);
    const { data: avs } = await db.from('crm_cobranca_avisos').select('*').order('enviado_em', { ascending: false }).limit(2000);
    const avisos = (avs || []) as Linha[];
    const { data: pagosB } = await db.from('crm_boletos').select('empresa_id, duplicata').not('cli_pagou_em', 'is', null);
    const pagos = new Set(((pagosB || []) as Linha[]).map(b => b.empresa_id + '|' + b.duplicata));
    const semAviso = new Set(((cfg.sem_aviso as string[]) || []).map(String));
    const lista = quemRecebe({ titulos: tit || [], avisos, hoje, dias: diasAtraso, pagos, semAviso });

    // montagem de cada aviso: cliente, contato, vendedor(a), canais e texto
    const empIds = lista.map(x => x.empresa_id);
    const { data: emps } = empIds.length ? await db.from('crm_empresas').select('id, nome, responsavel_id, whatsapp, telefone, email').in('id', empIds) : { data: [] };
    const { data: cts } = empIds.length ? await db.from('crm_contatos').select('empresa_id, nome, whatsapp, celular, telefone, email').in('empresa_id', empIds) : { data: [] };
    const vIds = [...new Set(((emps || []) as Linha[]).map(e => e.responsavel_id).filter(Boolean))] as string[];
    const { data: vends } = vIds.length ? await db.from('crm_usuarios').select('user_id, nome, telefone, email, ativo').in('user_id', vIds) : { data: [] };
    const { data: adms } = await db.from('crm_usuarios').select('user_id, nome, telefone, email').eq('papel', 'admin').eq('ativo', true);
    const admin0 = ((adms || []) as Linha[])[0] || null;
    const prazo = prazoUtil(hoje, prazoDias);
    const corpo = CORPO(EMPRESA);
    const monta = lista.map(x => {
      const e = ((emps || []) as Linha[]).find(y => y.id === x.empresa_id) || {} as Linha;
      const contatos = ((cts || []) as Linha[]).filter(y => y.empresa_id === x.empresa_id);
      const v = ((vends || []) as Linha[]).find(y => y.user_id === e.responsavel_id && y.ativo) || admin0 || {} as Linha;
      const celulares = celularesDoCliente(e, contatos), emails = emailsDoCliente(e, contatos);
      const contato = contatos.find(y => celularesDoCliente(null, [y]).length) || contatos[0] || null;
      const p = parametros({ cliente: primeiro(contato && contato.nome) || String(e.nome || ''), vendedora: primeiro(v.nome) || 'o financeiro', titulos: x.titulos, valor: x.valor, prazo });
      const telV = telWa(v.telefone);
      return { ...x, empresa: e, vendedor: v, celular: celulares[0] || '', emails, p, texto: textoFinal(corpo, p), telV,
        email: textoEmail(corpo, p, telV ? telBR(telV) : '') };
    });

    if (c.acao === 'situacao') {
      let modelo: Linha | null = null, erroModelo = '';
      if (token && wabaId) { try { modelo = await modeloInfo(token, wabaId); } catch (e) { erroModelo = (e as Error).message; } }
      // quem chegou ao prazo e ainda não recebeu (sem canal hoje): com celular sai pelo WhatsApp quando a Meta aprovar
      const esperando = monta.map(m => ({ empresa_id: m.empresa_id, nome: m.empresa.nome, valor: m.valor, dias: m.dias, celular: !!m.celular, email: m.emails.length > 0 }));
      return resposta(200, { ligado: cfg.ligado === true, dias: diasAtraso, prazo: prazoDias, modelo, erro_modelo: erroModelo, whatsapp: !!(token && phoneId), email: !!brevo,
        hoje: lista.length, esperando, avisos: avisos.slice(0, 200) });
    }
    if (c.acao === 'previa') {
      return resposta(200, { ligado: cfg.ligado === true, prazo, lista: monta.map(m => ({ empresa_id: m.empresa_id, nome: m.empresa.nome, valor: m.valor, dias: m.dias,
        titulos: m.titulos.map((t: Linha) => t.duplicata), vendedor: m.vendedor.nome || '', celular: m.celular, emails: m.emails, texto: m.texto })) });
    }
    if (c.acao !== 'rodar') return resposta(400, { erro: 'ação desconhecida' });
    if (agendador && cfg.ligado !== true) return resposta(200, { ok: true, desligado: true });

    let modeloOk = false;
    if (token && phoneId && wabaId) { try { const m = await modeloInfo(token, wabaId); modeloOk = !!m && m.status === 'APPROVED'; } catch { modeloOk = false; } }
    const feitos: Linha[] = [];
    for (const m of monta) {
      // o registro só nasce se o aviso saiu por algum canal: sem canal (ou com falha nos dois), tenta de novo amanhã
      const id = crypto.randomUUID(), up: Linha = {};
      // WhatsApp da empresa (só com o modelo aprovado e celular no cadastro)
      if (modeloOk && m.celular) {
        try {
          const r = await graph(token, '/' + phoneId + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            messaging_product: 'whatsapp', to: m.celular, type: 'template',
            template: { name: MODELO, language: { code: 'pt_BR' }, components: [
              { type: 'body', parameters: m.p.map(param) },
              { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: id }] },
              { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'avisopagou:' + id }] }] }
          }) });
          up.whatsapp_para = m.celular; up.wa_msg = (((r.messages as Linha[]) || [])[0] || {}).id || null; up.wa_status = 'enviado';
        } catch (e) { up.whatsapp_para = m.celular; up.wa_status = 'falhou'; up.wa_erro = String((e as Error).message).slice(0, 300); }
      } else up.wa_erro = !m.celular ? 'sem celular no cadastro' : 'modelo da Meta ainda não aprovado';
      // e-mail, do(a) vendedor(a) da carteira (a resposta vai para ela)
      const rem = /@/.test(String(m.vendedor.email || '')) ? m.vendedor : admin0;
      if (brevo && m.emails.length && rem && /@/.test(String(rem.email || ''))) {
        try {
          const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:600px">' +
            m.email.split('\n\n').map((s: string) => '<p>' + s.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>').join('') + '<p style="color:#777;font-size:12px">' + EMPRESA + ' · financeiro</p></div>';
          const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': brevo, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sender: { name: String(rem.nome) + ' · ' + EMPRESA, email: rem.email }, replyTo: { name: String(rem.nome), email: rem.email },
              to: m.emails.map((x: string) => ({ email: x })), subject: EMPRESA + ' · título em aberto (' + docsTexto(m.titulos).replace(/^(a|as) /, '') + ')',
              htmlContent: html, textContent: m.email + '\n\n' + EMPRESA + ' · financeiro', tags: ['cobranca'] }) });
          up.email_para = m.emails; up.email_ok = r.ok;
          if (!r.ok) up.email_erro = 'o Brevo recusou (' + r.status + ')';
        } catch (e) { up.email_para = m.emails; up.email_ok = false; up.email_erro = String((e as Error).message).slice(0, 300); }
      } else if (!m.emails.length) up.email_erro = 'sem e-mail no cadastro';
      const canais = [up.wa_status === 'enviado' ? 'WhatsApp' : '', up.email_ok ? 'e-mail' : ''].filter(Boolean);
      const erro = [up.wa_erro, up.email_erro].filter(Boolean).join(' · ') || null;
      if (!canais.length) {
        // sem celular e sem e-mail: a vendedora pede o contato do financeiro do cliente (uma tarefa aberta por cliente)
        if (!m.celular && !m.emails.length && m.vendedor.user_id) {
          const marca = 'Aviso de atraso sem contato:';
          const { count } = await db.from('crm_atividades').select('id', { count: 'exact', head: true }).eq('empresa_id', m.empresa_id).eq('concluida', false).like('descricao', marca + '%');
          if (!count) await db.from('crm_atividades').insert({ empresa_id: m.empresa_id, responsavel_id: m.vendedor.user_id, tipo: 'tarefa', automatica: true, data_hora: new Date().toISOString(),
            descricao: marca + ' ' + String(m.empresa.nome || 'o cliente') + ' tem ' + docsTexto(m.titulos) + ' (' + moeda(m.valor) + ', ' + m.dias + ' dias) e não tem celular nem e-mail no cadastro. ' +
              'Peça o celular (WhatsApp) e o e-mail do financeiro e complete o cadastro: o aviso sai no dia útil seguinte.' });
        }
        feitos.push({ empresa: m.empresa.nome, enviado: false, erro }); continue;
      }
      const reg: Linha = { id, empresa_id: m.empresa_id, duplicatas: m.titulos.map((t: Linha) => t.duplicata), notas: docsTexto(m.titulos), valor: m.valor, dias: m.dias,
        prazo, vendedor_id: m.vendedor.user_id || null, texto: m.texto, enviado_por: eu ? eu.user_id : null, ...up };
      const { error: eIns } = await db.from('crm_cobranca_avisos').insert(reg);
      if (eIns) { feitos.push({ empresa: m.empresa.nome, enviado: true, erro: 'enviado, mas não gravou: ' + eIns.message }); continue; }
      await db.from('crm_atividades').insert({ empresa_id: m.empresa_id, tipo: canais[0] === 'WhatsApp' ? 'whatsapp' : 'email', concluida: true,
        concluida_em: new Date().toISOString(), automatica: true, responsavel_id: m.vendedor.user_id || null,
        descricao: 'Aviso de atraso enviado ao cliente (' + canais.join(' e ') + '): ' + docsTexto(m.titulos) + ', ' + moeda(m.valor) +
          '. Prazo antes do cartório: ' + prazo.split('-').reverse().join('/') + '. Se o cliente procurar, negocie e avise o financeiro.' });
      feitos.push({ empresa: m.empresa.nome, enviado: true, canais, erro });
    }

    // aviso que saiu só por e-mail enquanto o modelo esperava a Meta: com o modelo aprovado, vai também pelo WhatsApp (mesmo
    // aviso, mesmo prazo), se o prazo ainda não venceu e o cliente não disse que pagou
    if (modeloOk) {
      for (const a of avisos.filter(a => !a.whatsapp_para && !a.pagou_em && String(a.prazo) >= hoje && /modelo/.test(String(a.wa_erro || '')))) {
        const { data: e } = await db.from('crm_empresas').select('id, nome, whatsapp, telefone').eq('id', a.empresa_id).maybeSingle();
        const { data: cs } = await db.from('crm_contatos').select('nome, whatsapp, celular, telefone').eq('empresa_id', a.empresa_id);
        const cel = celularesDoCliente(e, cs || [])[0];
        if (!cel) continue;
        const contato = ((cs || []) as Linha[]).find(y => celularesDoCliente(null, [y]).length) || null;
        const { data: v } = a.vendedor_id ? await db.from('crm_usuarios').select('nome').eq('user_id', a.vendedor_id).maybeSingle() : { data: null };
        const ts = ((tit || []) as Linha[]).filter(t => t.empresa_id === a.empresa_id && ((a.duplicatas as string[]) || []).includes(String(t.duplicata)));
        if (!ts.length) continue;
        const p = parametros({ cliente: primeiro(contato && contato.nome) || String((e && e.nome) || ''), vendedora: primeiro(v && v.nome) || 'o financeiro', titulos: ts, valor: a.valor, prazo: a.prazo });
        const up: Linha = { whatsapp_para: cel };
        try {
          const r = await graph(token, '/' + phoneId + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            messaging_product: 'whatsapp', to: cel, type: 'template',
            template: { name: MODELO, language: { code: 'pt_BR' }, components: [
              { type: 'body', parameters: p.map(param) },
              { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(a.id) }] },
              { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'avisopagou:' + a.id }] }] }
          }) });
          up.wa_msg = (((r.messages as Linha[]) || [])[0] || {}).id || null; up.wa_status = 'enviado'; up.wa_erro = null;
        } catch (err) { up.wa_status = 'falhou'; up.wa_erro = String((err as Error).message).slice(0, 300); }
        await db.from('crm_cobranca_avisos').update(up).eq('id', a.id);
        feitos.push({ empresa: e ? e.nome : '', enviado: up.wa_status === 'enviado', canais: ['WhatsApp (complemento)'], erro: up.wa_erro || null });
      }
    }

    // prazo vencido: tarefa para o administrador decidir o cartório (uma vez por aviso)
    const alertas = alertasCartorio({ avisos, titulos: tit || [], hoje });
    const nomes = new Map(((emps || []) as Linha[]).map(e => [e.id, e.nome]));
    for (const a of alertas) {
      let nome = nomes.get(a.empresa_id);
      if (!nome) { const { data: e } = await db.from('crm_empresas').select('nome').eq('id', a.empresa_id).maybeSingle(); nome = e ? e.nome : 'cliente'; }
      const valor = a.abertos.reduce((s: number, t: Linha) => s + Number(t.valor || 0), 0);
      const txt = 'Cartório? ' + nome + ' recebeu o aviso de atraso em ' + String(a.enviado_em).slice(0, 10).split('-').reverse().join('/') + ' e o prazo venceu em ' +
        String(a.prazo).split('-').reverse().join('/') + ' sem pagamento: ' + docsTexto(a.abertos) + ', ' + moeda(valor) + '. Se não houve acordo com a vendedora, mande para o cartório (Caixa → Cobrança).';
      for (const ad of (adms || []) as Linha[]) await db.from('crm_atividades').insert({ empresa_id: a.empresa_id, responsavel_id: ad.user_id, tipo: 'tarefa', descricao: txt, data_hora: new Date().toISOString(), automatica: true });
      await db.from('crm_cobranca_avisos').update({ alerta_em: new Date().toISOString() }).eq('id', a.id);
    }
    return resposta(200, { ok: true, enviados: feitos, alertas: alertas.length, modelo_aprovado: modeloOk });
  } catch (e) {
    return resposta(422, { erro: e instanceof Error ? e.message : String(e) });
  }
});
