// Edge Function crm-contador — o fechamento do mês para a contabilidade (05/11/2026, pedido do Anderson: os XML de todas
// as notas emitidas no mês + a relação das canceladas, denegadas e inutilizadas; "virou o mês, já vai automático").
//   POST { acao: 'situacao' }            → configuração (e-mails, ligado) e os últimos envios (admin)
//   POST { acao: 'config', emails, ligado } → grava crm_config.dados.contador (admin)
//   POST { acao: 'zip', mes }            → o ZIP do mês em base64 e o resumo (admin; não manda nada)
//   POST { acao: 'enviar', mes, para? }  → manda o ZIP por e-mail à contabilidade (admin)
//   POST { acao: 'rodar' }               → o agendador: no dia 2, o mês anterior, uma vez só (dados.contador.ligado)
// Os XML vêm do bucket crm-notas-xml (FKN e CRM, pela chave: o mês é o AAMM da emissão); a situação, do crm_nfe e do
// crm_notas (contador.js). O ZIP fica em crm-notas-xml/contador/AAAA-MM.zip e o e-mail leva o anexo e um link de 30 dias.
// Agendador: pg_cron crm-contador (dia 2, 9h05 em SP) → crm_contador_tick() com a mesma senha do agendador da cobrança
// (crm_interno.cobranca_cfg, conferida por crm_cobranca_senha_ok). Deploy: verify_jwt DESLIGADO (o agendador não tem login).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { zipSync, strToU8 } from 'npm:fflate@0.8.2';
import { doMes, montar, mesAnterior, mesExtenso, textoEmail } from './contador.js';
// 10/11/2026: o e-mail sai pela caixa do próprio domínio (função crm-enviar-email), não mais pelo Brevo, que bloqueou a conta
// por causa dos avisos de cobrança. O corpo é o mesmo; muda o endereço e quem autoriza (a chave de serviço do projeto).
const EMAIL_URL = () => Deno.env.get('SUPABASE_URL')! + '/functions/v1/crm-enviar-email';
const EMAIL_AUTH = () => 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// deno-lint-ignore no-explicit-any
type Linha = Record<string, any>;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const EMPRESA = Deno.env.get('CRM_EMPRESA_NOME') ?? 'OneClean';
const BUCKET = 'crm-notas-xml';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hojeSP = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const MAX_ANEXO = 7 * 1024 * 1024;   // acima disso, só o link

function base64(b: Uint8Array) {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let c: Linha;
  try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

  // quem chama: o agendador (a senha do banco) ou o administrador logado
  let agendador = false, eu: Linha | null = null;
  if (bearer.length >= 32 && /^[0-9a-f]+$/.test(bearer)) {
    const { data: ok } = await db.rpc('crm_cobranca_senha_ok', { p: bearer });
    agendador = ok === true;
  }
  if (!agendador) {
    const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
    const { data: quem } = await comoUsuario.auth.getUser();
    if (!quem?.user) return resposta(401, { erro: 'faça login de novo' });
    const { data: u } = await db.from('crm_usuarios').select('user_id, papel, ativo, nome, email').eq('user_id', quem.user.id).maybeSingle();
    if (!u || !u.ativo || u.papel !== 'admin') return resposta(403, { erro: 'só o administrador' });
    eu = u as Linha;
  }
  if (agendador && c.acao !== 'rodar') return resposta(403, { erro: 'o agendador só roda' });

  const { data: cfgRow } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
  const dados = ((cfgRow as Linha | null)?.dados || {}) as Linha;
  const cfg = (dados.contador || {}) as Linha;
  const emit = (((dados.fiscal || {}) as Linha).emitente || {}) as Linha;
  const cnpj = String(emit.cnpj || '').replace(/\D/g, '');
  const empresa = String(emit.razao || EMPRESA);
  const listaEmails = (v: unknown) => [...new Set(String(Array.isArray(v) ? v.join(';') : v || '').split(/[;,\s]+/).map(x => x.trim().toLowerCase()).filter(x => EMAIL.test(x)))].slice(0, 10);

  // ------------------------------------------------------------ o ZIP do mês
  async function fechamento(mes: string) {
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('mês inválido (use AAAA-MM)');
    if (cnpj.length !== 14) throw new Error('falta o CNPJ do emitente em Fiscal → Emitente');
    const { data: nomes, error: eL } = await db.rpc('crm_contador_chaves', { p_mes: mes, p_cnpj: cnpj });
    if (eL) throw new Error('lista dos XML: ' + eL.message);
    const chaves = doMes(((nomes || []) as Linha[]).map(x => String(x.chave)), cnpj, mes);
    const xmls: Linha[] = [], faltou: string[] = [];
    for (let i = 0; i < chaves.length; i += 10) {
      const lote = await Promise.all(chaves.slice(i, i + 10).map(async k => {
        const r = await db.storage.from(BUCKET).download('nfe/' + k + '.xml');
        if (r.error || !r.data) { faltou.push(k); return null; }
        return { chave: k, xml: await r.data.text() };
      }));
      for (const x of lote) if (x) xmls.push(x);
    }
    const nfes: Linha[] = [], notas: Linha[] = [];
    for (let i = 0; i < chaves.length; i += 100) {
      const parte = chaves.slice(i, i + 100);
      const [a, b] = await Promise.all([
        db.from('crm_nfe').select('chave, situacao, eventos, protocolo, motivo').eq('ambiente', 'producao').in('chave', parte),
        db.from('crm_notas').select('chave, cancelada').in('chave', parte)]);
      nfes.push(...((a.data || []) as Linha[])); notas.push(...((b.data || []) as Linha[]));
    }
    const [a, m] = mes.split('-').map(Number);
    const ini = mes + '-01T03:00:00Z', fim = (m === 12 ? (a + 1) + '-01' : a + '-' + String(m + 1).padStart(2, '0')) + '-01T03:00:00Z';
    const { data: inuts } = await db.from('crm_nfe_inutilizacoes').select('*').eq('ambiente', 'producao').gte('criado_em', ini).lt('criado_em', fim);
    const r = montar({ mes, xmls, nfes, notas, inuts: (inuts || []) as Linha[] });
    const pasta: Record<string, Uint8Array> = {};
    for (const f of r.arquivos as Linha[]) pasta[String(f.nome)] = typeof f.conteudo === 'string' ? strToU8(f.conteudo) : f.conteudo;
    const zip = zipSync(pasta, { level: 6 });
    return { r, zip, nome: 'XML-NFe-' + EMPRESA.replace(/\W+/g, '') + '-' + mes + '.zip', faltou };
  }
  const resumoDe = (r: Linha) => ({ notas: r.notas, autorizadas: r.autorizadas, canceladas: r.canceladas, denegadas: r.denegadas, inutilizadas: r.inutilizadas,
    entradas: r.entradas, valor: r.valor, sem_xml: r.sem_xml, canceladas_lista: r.canceladas_lista, denegadas_lista: r.denegadas_lista });

  async function enviar(mes: string, para: string[], origem: string) {
    const brevo = (Deno.env.get('EMAIL_SENHA') ? 'ligado' : '');
    if (!brevo) throw new Error('o e-mail não está ligado (falta a senha da caixa nos Secrets, EMAIL_SENHA)');
    if (!para.length) throw new Error('falta o e-mail da contabilidade');
    const { r, zip, nome } = await fechamento(mes);
    if (!r.notas && !r.inutilizadas) throw new Error('nenhuma nota emitida em ' + mesExtenso(mes));
    const caminho = 'contador/' + mes + '.zip';
    const up = await db.storage.from(BUCKET).upload(caminho, new Blob([zip], { type: 'application/zip' }), { contentType: 'application/zip', upsert: true });
    let link = '';
    if (!up.error) { const s = await db.storage.from(BUCKET).createSignedUrl(caminho, 30 * 86400, { download: nome }); link = s.data?.signedUrl || ''; }
    const { data: adms } = await db.from('crm_usuarios').select('nome, email').eq('papel', 'admin').eq('ativo', true);
    const rem = (eu && EMAIL.test(String(eu.email || '')) ? eu : ((adms || []) as Linha[]).find(x => EMAIL.test(String(x.email || '')))) as Linha | undefined;
    if (!rem) throw new Error('nenhum administrador com e-mail para mandar');
    const texto = textoEmail(r, { mes, empresa, link });
    const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:640px">' +
      texto.split('\n').map(l => l ? '<div>' + l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/(https:\/\/\S+)/, '<a href="$1">baixar o ZIP</a>') + '</div>' : '<br>').join('') + '</div>';
    const corpo: Linha = { sender: { name: String(rem.nome) + ' · ' + EMPRESA, email: rem.email }, replyTo: { name: String(rem.nome), email: rem.email },
      to: para.map(x => ({ email: x })), subject: EMPRESA + ' · XML das notas fiscais de ' + mesExtenso(mes), htmlContent: html, textContent: texto, tags: ['contador'] };
    if (zip.length <= MAX_ANEXO) corpo.attachment = [{ name: nome, content: base64(zip) }];
    const rb = await fetch(EMAIL_URL(), { method: 'POST', headers: { Authorization: EMAIL_AUTH(), 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(corpo) });
    const ok = rb.ok, erro = ok ? null : 'o e-mail não saiu (' + rb.status + '): ' + (await rb.text().catch(() => '')).slice(0, 200);
    await db.from('crm_contador_envios').insert({ mes, para, ok, erro, notas: r.notas, valor: r.valor, canceladas: r.canceladas, arquivo: up.error ? null : caminho,
      tamanho: zip.length, origem, enviado_por: eu ? eu.user_id : null, resumo: resumoDe(r) });
    if (!ok) throw new Error(String(erro));
    return { ok: true, para, resumo: resumoDe(r), anexo: zip.length <= MAX_ANEXO, tamanho: zip.length };
  }

  try {
    if (c.acao === 'situacao') {
      const { data: env } = await db.from('crm_contador_envios').select('mes, para, ok, erro, notas, valor, canceladas, origem, enviado_em').order('enviado_em', { ascending: false }).limit(12);
      return resposta(200, { emails: listaEmails(cfg.emails), ligado: cfg.ligado === true, envios: env || [], mes_anterior: mesAnterior(hojeSP()) });
    }
    if (c.acao === 'config') {
      const emails = listaEmails(c.emails);
      const novo = Object.assign({}, dados, { contador: Object.assign({}, cfg, { emails, ligado: c.ligado === true && emails.length > 0 }) });
      const { error } = await db.from('crm_config').update({ dados: novo }).eq('id', 1);
      if (error) throw new Error(error.message);
      return resposta(200, { ok: true, emails, ligado: novo.contador.ligado });
    }
    if (c.acao === 'zip') {
      const mes = String(c.mes || '');
      const { r, zip, nome, faltou } = await fechamento(mes);
      return resposta(200, { nome, base64: base64(zip), tamanho: zip.length, resumo: resumoDe(r), faltou, texto: textoEmail(r, { mes, empresa, link: '' }) });
    }
    if (c.acao === 'enviar') {
      const para = c.para ? listaEmails(c.para) : listaEmails(cfg.emails);
      return resposta(200, await enviar(String(c.mes || ''), para, 'tela'));
    }
    if (c.acao === 'rodar') {
      const hoje = hojeSP(), mes = mesAnterior(hoje);
      if (cfg.ligado !== true) return resposta(200, { ok: true, desligado: true });
      const { data: ja } = await db.from('crm_contador_envios').select('id').eq('mes', mes).eq('ok', true).limit(1);
      if (ja && ja.length) return resposta(200, { ok: true, ja_enviado: mes });
      return resposta(200, await enviar(mes, listaEmails(cfg.emails), 'agendador'));
    }
    return resposta(400, { erro: 'ação desconhecida' });
  } catch (e) {
    console.error('[crm-contador] ' + (e as Error).message);
    return resposta(500, { erro: (e as Error).message });
  }
});
