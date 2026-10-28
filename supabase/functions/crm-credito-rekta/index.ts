// Edge Function: CONSULTA DE CRÉDITO PELA API DA REKTA (28/10/2026, pedido do Anderson: "quanto mais a gente conseguir
// automatizar isso, melhor"). Antes o administrador abria o site da Rekta, baixava o PDF e soltava no CRM; agora o CRM
// pergunta direto: RLT Avançado (POST https://clientes.rektaempresarial.com.br/Api/api/FlexLote/Avancado, guia
// "Api Consultas RLT Avançado" da Rekta).
//   POST { acao: 'situacao' }                        → { ligado } (o hash da Rekta está nos segredos?)
//   POST { documento: '00111222000133', empresa_id } → { bruto, caminho, status } (a resposta da Rekta, inteira)
// A LEITURA dos fatos (score, protestos, pendências…) é do app (credito.js daRekta, testado); a proposta de limite e prazo
// sai da política da OneClean e quem aprova é o administrador. Aqui: só chamar, guardar a resposta no bucket crm-credito e
// registrar em crm_credito_rekta (quem, quando, documento, tempo, resposta).
// Cada consulta é COBRADA pela Rekta: o app pergunta antes. Só o administrador. O hash de integração fica SÓ nos segredos
// do Supabase (REKTA_HASH) — nunca no app, no repositório ou no chat. Deploy: verify_jwt ligado (o padrão).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const URL_REKTA = 'https://clientes.rektaempresarial.com.br/Api/api/FlexLote/Avancado';
const BUCKET = 'crm-credito';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: quem } = await comoUsuario.auth.getUser();
  if (!quem?.user) return resposta(401, { erro: 'faça login de novo' });
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: eu } = await db.from('crm_usuarios').select('papel, ativo').eq('user_id', quem.user.id).maybeSingle();
  if (!eu || !eu.ativo || eu.papel !== 'admin') return resposta(403, { erro: 'só o administrador consulta o crédito' });
  const hash = (Deno.env.get('REKTA_HASH') ?? '').trim();
  let c: { acao?: string; documento?: string; empresa_id?: string };
  try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  if (c.acao === 'situacao') return resposta(200, { ligado: !!hash });
  if (!hash) return resposta(503, { erro: 'a consulta pela API ainda não está ligada: falta o hash da Rekta nos segredos do Supabase (REKTA_HASH)' });

  // CPF (11) ou CNPJ (14, também o alfanumérico): só letras e números
  const doc = String(c.documento ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (doc.length !== 11 && doc.length !== 14) return resposta(400, { erro: 'documento inválido: CPF com 11 ou CNPJ com 14' });
  const empresa = /^[0-9a-f-]{36}$/.test(String(c.empresa_id ?? '')) ? String(c.empresa_id) : null;

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
    if (up.error) caminho = null;
  }
  const { error: eLog } = await db.from('crm_credito_rekta').insert({ por: quem.user.id, empresa_id: empresa, documento: doc, status, ms, caminho, erro, bruto: erro ? null : bruto });
  if (eLog) console.error('[crm-credito-rekta] registro: ' + eLog.message);
  if (erro) return resposta(502, { erro, status });
  return resposta(200, { bruto, caminho, status, ms });
});
