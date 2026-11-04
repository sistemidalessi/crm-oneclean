// Edge Function: CONSULTA DE CRÉDITO PELA API DA REKTA (28/10/2026, pedido do Anderson: "quanto mais a gente conseguir
// automatizar isso, melhor"). Antes o administrador abria o site da Rekta, baixava o PDF e soltava no CRM; agora o CRM
// pergunta direto: RLT Avançado (POST https://clientes.rektaempresarial.com.br/Api/api/FlexLote/Avancado, guia
// "Api Consultas RLT Avançado" da Rekta).
//   POST { acao: 'situacao' }                        → { ligado } (o hash da Rekta está nos segredos?)
//   POST { documento: '00111222000133', empresa_id } → { bruto, caminho, status } (a resposta da Rekta, inteira)
// A LEITURA dos fatos (score, protestos, pendências…) é do app (credito.js daRekta, testado); a proposta de limite e prazo
// sai da política da OneClean e quem aprova é o administrador. Aqui: só chamar, guardar a resposta no bucket crm-credito e
// registrar em crm_credito_rekta (quem, quando, documento, tempo, resposta).
// Cada consulta é COBRADA pela Rekta: o app pergunta antes. O hash de integração fica SÓ nos segredos do Supabase
// (REKTA_HASH) — nunca no app, no repositório ou no chat. Deploy: verify_jwt ligado (o padrão).
// Quem: o administrador (consulta solta, como antes) e, na ação 'auto' (04/11/2026, pedido do Anderson: "eles mesmos podem
// apertar para consultar o CNPJ"), a vendedora (só cliente da carteira dela) e a gestora:
//   POST { acao: 'auto', empresa_id } → consulta (ou reaproveita a dos últimos 30 dias), a POLÍTICA do credito.js decide
//   (a mesma do administrador, baixada do GitHub na versão fixada) e a ficha nasce na hora até o teto automático
//   (crm_config.dados.credito.auto_teto, padrão R$ 5.000). Acima do teto ou "em análise": pedido de crédito ao Anderson.
//   A resposta à equipe não traz score nem relatório (só a situação, o limite, o prazo e o porquê em uma linha).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const URL_REKTA = 'https://clientes.rektaempresarial.com.br/Api/api/FlexLote/Avancado';
const BUCKET = 'crm-credito';
// a política e a leitura da resposta são as do site (credito.js, com regras.js), na versão fixada
// (node ferramentas/fixa-motor-notas.js troca o commit e o SHA-256; depois, publicar esta função de novo)
const COMMIT = '0ca5d5ca59160142c4d3728706880e763a72afea';
const HASHES: Record<string, string> = { 'regras.js': 'b28565b3534d4dd4d1af2c487673dcc3e326c59066deba7bf545ca8c2418c7c3', 'credito.js': '20a91c57b949bec1721377d3d1920b5ff1505ffb40a007383637856f389f660a' };
const FONTE = 'https://raw.githubusercontent.com/sistemidalessi/crm-oneclean/' + COMMIT + '/';
const TETO_PADRAO = 5000;
type Linha = Record<string, unknown>;
async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// deno-lint-ignore no-explicit-any
let CRED: any = null;
async function carregaPolitica() {
  if (CRED) return CRED;
  const cod: Record<string, string> = {};
  for (const f of Object.keys(HASHES)) {
    const r = await fetch(FONTE + f);
    if (!r.ok) throw new Error('não baixou ' + f + ' (' + r.status + ')');
    cod[f] = await r.text();
    if (await sha256(cod[f]) !== HASHES[f]) throw new Error(f + ' não confere com a versão fixada');
  }
  // deno-lint-ignore no-explicit-any
  const g: any = {};
  new Function(cod['regras.js']).call(g);                                    // regras.js: script clássico (this.CRMRegras)
  new Function('window', 'module', 'require', cod['credito.js'])(g, undefined, undefined);   // credito.js: window.CRMCredito
  if (!g.CRMCredito || !g.CRMCredito.propor) throw new Error('credito.js sem a política');
  CRED = g.CRMCredito;
  return CRED;
}
const moeda = (v: number) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A consulta à Rekta (a de sempre): guarda a resposta no bucket e registra em crm_credito_rekta
async function consultaRekta(db: ReturnType<typeof createClient>, hash: string, doc: string, empresa: string | null, por: string) {
  const t0 = Date.now();
  let status = 0, bruto: unknown = null, erro: string | null = null;
  try {
    const r = await fetch(URL_REKTA, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ documento: doc, pessoaJuridica: doc.length === 14, cdProduto: 0, uf: 'SP', politica: '', hashCode: hash }),
      signal: AbortSignal.timeout(90000)   // a Rekta pede pelo menos 60 s (bases externas)
    });
    status = r.status;
    const txt = await r.text();
    if (r.status === 204 || !txt.trim()) bruto = {};
    else { try { bruto = JSON.parse(txt); } catch { erro = 'a Rekta respondeu fora do formato (' + r.status + '): ' + txt.slice(0, 200); } }
    // a Rekta responde um TEXTO com o JSON dentro (1ª consulta real, 28/10/2026): desembrulha (até duas vezes)
    for (let i = 0; i < 2 && !erro && typeof bruto === 'string'; i++) { try { bruto = JSON.parse(bruto as string); } catch { break; } }
    if (!erro && r.status === 401) erro = 'a Rekta recusou o hash de integração (401): confira o REKTA_HASH nos segredos';
    else if (!erro && r.status === 400) erro = 'a Rekta recusou a consulta (400): ' + JSON.stringify(bruto).slice(0, 300);
    else if (!erro && r.status >= 500) erro = 'a Rekta está fora do ar agora (' + r.status + '); tente de novo em alguns minutos';
    else if (!erro && r.status !== 200 && r.status !== 204) erro = 'resposta inesperada da Rekta (' + r.status + ')';
  } catch (e) {
    erro = e instanceof Error && e.name === 'TimeoutError' ? 'a Rekta demorou mais de 90 segundos; tente de novo' : 'não consegui falar com a Rekta: ' + (e instanceof Error ? e.message : String(e));
  }
  const ms = Date.now() - t0;
  // a resposta inteira fica guardada (como o PDF da consulta), na pasta do cliente
  let caminho: string | null = null;
  if (!erro && empresa) {
    caminho = 'credito/' + empresa + '/' + new Date().toISOString().slice(0, 10) + '-rekta-' + crypto.randomUUID().slice(0, 8) + '.json';
    const up = await db.storage.from(BUCKET).upload(caminho, new Blob([JSON.stringify(bruto, null, 1)], { type: 'application/json' }), { contentType: 'application/json', upsert: false });
    if (up.error) { console.error('[crm-credito-rekta] guardar a resposta: ' + up.error.message); caminho = null; }
  }
  const { error: eLog } = await db.from('crm_credito_rekta').insert({ por, empresa_id: empresa, documento: doc, status, ms, caminho, erro, bruto: erro ? null : bruto });
  if (eLog) console.error('[crm-credito-rekta] registro: ' + eLog.message);
  return { bruto, caminho, status, ms, erro };
}

// A consulta da equipe: política + ficha até o teto; o resto vira pedido de crédito ao Anderson
async function auto(db: ReturnType<typeof createClient>, hash: string, eu: Linha, uid: string, empresaId: string) {
  const { data: e } = await db.from('crm_empresas').select('id, nome, cnpj, responsavel_id').eq('id', empresaId).maybeSingle();
  if (!e) return resposta(404, { erro: 'cliente não encontrado' });
  if (eu.papel === 'vendedor' && (e as Linha).responsavel_id !== uid) return resposta(403, { erro: 'só para clientes da sua carteira' });
  const hoje = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
  const { data: f } = await db.from('crm_credito').select('situacao, revisar_em').eq('empresa_id', empresaId).maybeSingle();
  if (f && !((f as Linha).revisar_em && String((f as Linha).revisar_em) < hoje))
    return resposta(409, { erro: 'este cliente já tem análise de crédito; para outro limite ou prazo, use "Pedir outro limite ou prazo"' });
  const doc = String((e as Linha).cnpj ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (doc.length !== 11 && doc.length !== 14) return resposta(400, { erro: 'o cadastro não tem CNPJ (ou CPF) completo: preencha antes de consultar' });
  const C = await carregaPolitica();
  // a consulta dos últimos 30 dias é reaproveitada, sem nova cobrança
  const { data: ult } = await db.from('crm_credito_rekta').select('em, bruto, caminho').eq('empresa_id', empresaId).not('bruto', 'is', null)
    .gte('em', new Date(Date.now() - 30 * 864e5).toISOString()).order('em', { ascending: false }).limit(1).maybeSingle();
  let bruto: unknown, caminho: string | null, nova = false;
  if (ult) { bruto = (ult as Linha).bruto; caminho = (ult as Linha).caminho as string | null; }
  else {
    if (!hash) return resposta(503, { erro: 'a consulta pela API ainda não está ligada (falta o REKTA_HASH nos segredos)' });
    const r = await consultaRekta(db, hash, doc, empresaId, uid);
    if (r.erro) return resposta(502, { erro: r.erro });
    bruto = r.bruto; caminho = r.caminho; nova = true;
  }
  const fatos = C.daRekta(bruto, doc, hoje);
  const { data: ctxRow } = await db.rpc('crm_credito_contexto', { p_empresa: empresaId });
  const ctx = (ctxRow || {}) as Linha;
  const p = C.propor(fatos, { maior_mes: Number(ctx.maior_mes) || 0, vencido: Number(ctx.vencido) || 0, hoje });
  const { data: cfgRow } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
  const cc = ((((cfgRow as Linha | null)?.dados as Linha | undefined)?.credito) || {}) as Linha;
  const teto = Number(cc.auto_teto) > 0 ? Number(cc.auto_teto) : TETO_PADRAO;
  const acima = p.situacao === 'prazo' && Number(p.limite) > teto;
  const limite = p.situacao === 'prazo' ? Math.min(Number(p.limite), teto) : 0;
  const { data: quem } = await db.from('crm_usuarios').select('nome').eq('user_id', uid).maybeSingle();
  const nome = String((quem as Linha | null)?.nome || 'equipe');
  const { error: eg } = await db.rpc('crm_credito_auto_gravar', { p_empresa: empresaId, p_situacao: p.situacao, p_limite: limite, p_prazo: p.prazo_max, p_score: fatos.score || null,
    p_resumo: { consulta: fatos, politica: p, auto: { por: uid, nome, teto, em: new Date().toISOString() } }, p_pdf: caminho,
    p_obs: 'Pela política, na consulta de ' + nome + (acima ? ' (a política daria ' + moeda(p.limite) + '; automático até ' + moeda(teto) + ')' : '') });
  if (eg) return resposta(500, { erro: eg.message });
  let pedido = false;
  if (acima || p.situacao === 'analise') {
    const motivo = acima ? 'A política propôs ' + moeda(p.limite) + ' em ' + p.prazo_max + ' dias; o automático vai até ' + moeda(teto) + ' (liberado ' + moeda(limite) + ')'
      : 'A consulta pediu análise: ' + (p.motivos || []).join('; ');
    const { error: ep } = await db.rpc('crm_credito_pedido_da_consulta', { p_empresa: empresaId, p_por: uid, p_limite: acima ? p.limite : null, p_prazo: acima ? p.prazo_max : null, p_motivo: motivo.slice(0, 400) });
    pedido = !ep;
  }
  const venc = Number(ctx.vencido) > 0;
  const texto = p.situacao === 'prazo' ? 'Liberado a prazo: limite de ' + moeda(limite) + ', em até ' + p.prazo_max + ' dias.' +
      (acima ? ' A política daria ' + moeda(p.limite) + ': o pedido do valor maior foi para o Anderson aprovar.' : '')
    : p.situacao === 'vista' ? 'Só à vista (Pix, transferência ou antecipado): a consulta mostrou restrição ou risco. Se o cliente precisar faturar, use "Pedir outro limite ou prazo" e conte o caso ao Anderson.'
    : 'Precisa do Anderson: ' + (venc ? 'o cliente tem título vencido com a empresa.' : 'a consulta não trouxe a nota de crédito.') + ' O pedido de análise já foi para ele.';
  const r: Linha = { situacao: p.situacao, limite, prazo_max: p.prazo_max, acima, pedido, nova, texto };
  if (eu.papel === 'admin') Object.assign(r, { proposta: p, fatos });
  return resposta(200, r);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: quem } = await comoUsuario.auth.getUser();
  if (!quem?.user) return resposta(401, { erro: 'faça login de novo' });
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: eu } = await db.from('crm_usuarios').select('papel, ativo').eq('user_id', quem.user.id).maybeSingle();
  const hash = (Deno.env.get('REKTA_HASH') ?? '').trim();
  let c: { acao?: string; documento?: string; empresa_id?: string };
  try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  if (c.acao === 'auto') {
    if (!eu || !eu.ativo || !['admin', 'gestor', 'vendedor'].includes(String(eu.papel))) return resposta(403, { erro: 'a consulta de crédito é da equipe de vendas' });
    if (!/^[0-9a-f-]{36}$/.test(String(c.empresa_id ?? ''))) return resposta(400, { erro: 'cliente inválido' });
    try { return await auto(db, hash, eu as Linha, quem.user.id, String(c.empresa_id)); }
    catch (e) { return resposta(500, { erro: e instanceof Error ? e.message : String(e) }); }
  }
  if (!eu || !eu.ativo || eu.papel !== 'admin') return resposta(403, { erro: 'só o administrador consulta o crédito' });
  if (c.acao === 'situacao') return resposta(200, { ligado: !!hash });
  if (!hash) return resposta(503, { erro: 'a consulta pela API ainda não está ligada: falta o hash da Rekta nos segredos do Supabase (REKTA_HASH)' });

  // CPF (11) ou CNPJ (14, também o alfanumérico): só letras e números
  const doc = String(c.documento ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (doc.length !== 11 && doc.length !== 14) return resposta(400, { erro: 'documento inválido: CPF com 11 ou CNPJ com 14' });
  const empresa = /^[0-9a-f-]{36}$/.test(String(c.empresa_id ?? '')) ? String(c.empresa_id) : null;

  const { bruto, caminho, status, ms, erro } = await consultaRekta(db, hash, doc, empresa, quem.user.id);
  if (erro) return resposta(502, { erro, status });
  return resposta(200, { bruto, caminho, status, ms });
});
