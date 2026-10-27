// Edge Function: AÇÕES do CEO Grupo Dalessi pelo celular (24/10/2026). O Anderson responde no WhatsApp da Agilité; o
// sistema da Agilité confere que é o celular dele, pede um código de confirmação e só então chama aqui.
//   POST …/functions/v1/crm-ceo-acao
//   corpo: {"aud":"crm-ceo-acao","acao":"bloqueados"|"ver"|"liberar","numero":123,"esperado":["ATRASO"],"ts":1761350000,"nonce":"<32 hex>"}
//   (revisão de segurança de 24/10/2026: "aud" diz o destino; "esperado" = os bloqueios que o Anderson viu, e o CRM
//   recusa se forem outros; número do pedido até 9 dígitos)
//   X-Ceo-Assinatura: assinatura Ed25519 (base64) do corpo CRU, feita com a chave PRIVADA que só existe no servidor
//   da Agilité (data/). Aqui só a chave PÚBLICA, em crm_ceo_chaves (não é segredo). Nenhuma senha nova.
// Recusa (401, sem detalhe): sem assinatura, assinatura que não confere, ts fora de ±5 min. O nonce de "liberar" é
// único no banco (crm_ceo_acoes): o mesmo corpo assinado não libera duas vezes. LISTA FECHADA: só ler os pedidos
// bloqueados e liberar um pedido em aberto; nunca dinheiro, nota, exclusão ou mensagem a cliente.
// (25/10/2026) E a aprovação de pedido ao fornecedor, pronta e DESLIGADA (crm_sistema 'compras_aprovacao'):
//   {"acao":"compras"} lista os que aguardam; {"acao":"aprovar_compra"|"recusar_compra","numero":12,"esperado":["8000.00"],
//   "motivo":"…"} decide, com o total que o Anderson viu (o CRM recusa se mudou) e o nonce único. Desligada, o CRM recusa.
// (26/10/2026) Diretrizes da empresa para a IA (tabela crm_ia_diretrizes, ver o schema.sql):
//   {"acao":"diretrizes","lista":[{"id":12,"area":"vendas","alvo":"<uuid>"|null,"tipo":"provocacao","texto":"…","valida_ate":"2026-11-02"|null}]}
//   a lista inteira substitui a anterior (o que não veio fica inativo). Volta a equipe que pode receber (nome e papel) e,
//   para cada diretriz, quantas vezes a IA a levou, a última vez e a quem. Corpo até 150 kB só para esta ação.
// (27/10/2026) Teto de gasto mensal da IA do grupo (tabela crm_ia_limite, ver o schema.sql):
//   {"acao":"ia_limite","limite_usd":50|null,"aviso_pct":80,"mes":"2026-10","gasto_agilite_usd":12.34} grava o teto e o
//   gasto da Agilité no mês; volta a situação do mês (crm_ia_teto), com o gasto do CRM, para a Agilité somar do lado dela.
// Cadastro da chave (24/10/2026, Anderson: "cadastre a chave por mim"): {"acao":"registrar_chave","chave_publica":…}
// com Authorization: Bearer <senha de leitura do Caixa> (a mesma da crm-caixa-leitura, que o servidor da Agilité já
// tem) E assinado pela própria chave. Só vale enquanto NÃO há NENHUMA chave (nem desativada): depois da primeira, o
// cadastro por aqui fecha para sempre (409); trocar a chave só pelo banco (revisão de segurança de 24/10/2026).
// Deploy: verify_jwt DESLIGADO (a autenticação é a assinatura). A chave de serviço só existe aqui dentro.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const cabecalhos = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const resposta = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status, headers: cabecalhos });
const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// deno-lint-ignore no-explicit-any
async function assinaturaValida(db: any, corpo: string, assinatura: string, so: string | null = null) {
  if (!assinatura || assinatura.length > 200) return false;
  const { data, error } = so ? { data: [{ chave_publica: so }], error: null } : await db.from('crm_ceo_chaves').select('chave_publica').eq('ativa', true);
  if (error || !data) return false;
  let sig: Uint8Array;
  try { sig = b64(assinatura); } catch { return false; }
  const msg = new TextEncoder().encode(corpo);
  for (const k of data) {
    try {
      const chave = await crypto.subtle.importKey('raw', b64(k.chave_publica), { name: 'Ed25519' }, false, ['verify']);
      if (await crypto.subtle.verify({ name: 'Ed25519' }, chave, sig, msg)) return true;
    } catch { /* chave estragada: tenta a próxima */ }
  }
  return false;
}

async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// deno-lint-ignore no-explicit-any
async function registrar(db: any, req: Request, corpo: string, c: any) {
  const auth = req.headers.get('authorization') || '';
  const senha = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (senha.length < 32) return resposta(401, { erro: 'não autorizado' });
  const { data: hs, error: e1 } = await db.from('crm_integracoes').select('token_hash').eq('uso', 'caixa').eq('ativo', true);
  if (e1) return resposta(500, { erro: 'falhou no CRM' });
  const h = await sha256(senha);
  // deno-lint-ignore no-explicit-any
  if (!(hs || []).some((x: any) => x.token_hash === h)) return resposta(401, { erro: 'não autorizado' });
  const chave = String(c.chave_publica || '');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(chave)) return resposta(400, { erro: 'chave inválida' });
  if (!Number.isFinite(c.ts) || Math.abs(Date.now() / 1000 - c.ts) > 300) return resposta(401, { erro: 'não autorizado' });
  if (!(await assinaturaValida(db, corpo, req.headers.get('x-ceo-assinatura') || '', chave))) return resposta(401, { erro: 'não autorizado' });
  const { data: ja, error: e2 } = await db.from('crm_ceo_chaves').select('chave_publica, ativa');
  if (e2) return resposta(500, { erro: 'falhou no CRM' });
  // deno-lint-ignore no-explicit-any
  if ((ja || []).some((x: any) => x.chave_publica === chave && x.ativa)) return resposta(200, { ok: true, ja_estava: true });
  if ((ja || []).length) return resposta(409, { erro: 'já existe chave cadastrada; trocar só pelo banco' });
  const { error: e3 } = await db.from('crm_ceo_chaves').insert({ nome: 'Servidor da Agilité (cadastrada por ele mesmo)', chave_publica: chave });
  if (e3) return resposta(500, { erro: 'falhou no CRM' });
  return resposta(200, { ok: true, registrada: true });
}

const AREAS = ['vendas', 'compras', 'logistica'], TIPOS = ['regra', 'provocacao', 'pergunta'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// deno-lint-ignore no-explicit-any
async function diretrizes(db: any, lista: unknown) {
  if (!Array.isArray(lista) || lista.length > 100) return resposta(400, { erro: 'lista inválida' });
  const agora = new Date().toISOString();
  // deno-lint-ignore no-explicit-any
  const linhas = (lista as any[]).map(d => ({
    id: Number(d && d.id), area: String(d && d.area), alvo: d && d.alvo ? String(d.alvo) : null, tipo: String(d && d.tipo),
    texto: String((d && d.texto) || '').slice(0, 1500), valida_ate: d && d.valida_ate ? String(d.valida_ate) : null, ativa: true, atualizado_em: agora
  }));
  const ruim = linhas.find(d => !Number.isInteger(d.id) || d.id < 1 || !AREAS.includes(d.area) || !TIPOS.includes(d.tipo) || d.texto.length < 2 ||
    (d.alvo && !UUID.test(d.alvo)) || (d.valida_ate && !/^\d{4}-\d{2}-\d{2}$/.test(d.valida_ate)));
  if (ruim) return resposta(400, { erro: 'diretriz inválida (' + ruim.id + ')' });
  if (linhas.length) { const { error } = await db.from('crm_ia_diretrizes').upsert(linhas, { onConflict: 'id' }); if (error) throw new Error(error.message); }
  // o que não veio na lista deixa de valer
  const ids = linhas.map(d => d.id);
  let q = db.from('crm_ia_diretrizes').update({ ativa: false, atualizado_em: agora }).eq('ativa', true);
  if (ids.length) q = q.not('id', 'in', '(' + ids.join(',') + ')');
  const { error: e2 } = await q;
  if (e2) throw new Error(e2.message);
  const { data: us, error: e3 } = await db.from('crm_usuarios').select('user_id, nome, papel').eq('ativo', true).in('papel', ['vendedor', 'gestor', 'comprador', 'logistica']);
  if (e3) throw new Error(e3.message);
  const nomes = new Map((us || []).map((u: { user_id: string; nome: string }) => [u.user_id, u.nome]));
  // o retorno: quantas vezes cada diretriz (as enviadas agora) foi levada, a última vez e a quem
  const uso: { id: number; vezes: number; ultima: string | null; pessoas: string[] }[] = [];
  if (ids.length) {
    const { data: u, error: e4 } = await db.from('crm_ia_diretrizes_uso').select('diretriz_id, user_id, onde, em').in('diretriz_id', ids).order('em', { ascending: false }).limit(5000);
    if (e4) throw new Error(e4.message);
    for (const id of ids) {
      // deno-lint-ignore no-explicit-any
      const l = (u || []).filter((x: any) => x.diretriz_id === id);
      // deno-lint-ignore no-explicit-any
      const pessoas = [...new Set(l.map((x: any) => (x.user_id ? nomes.get(x.user_id) : null) || (x.onde === 'analise' ? 'análise do dia' : null)).filter(Boolean))] as string[];
      uso.push({ id, vezes: l.length, ultima: l[0] ? l[0].em : null, pessoas: pessoas.slice(0, 10) });
    }
  }
  return resposta(200, { ok: true, ativas: ids.length, pessoas: (us || []).map((x: { user_id: string; nome: string; papel: string }) => ({ id: x.user_id, nome: x.nome, papel: x.papel })), uso });
}

// deno-lint-ignore no-explicit-any
async function iaLimite(db: any, c: any) {
  const lim = c.limite_usd == null || c.limite_usd === '' ? null : Number(c.limite_usd);
  const av = Number(c.aviso_pct), g = Number(c.gasto_agilite_usd), mes = String(c.mes || '');
  if ((lim !== null && (!Number.isFinite(lim) || lim < 0 || lim > 100000)) || !Number.isInteger(av) || av < 1 || av > 100 ||
    !Number.isFinite(g) || g < 0 || g > 1000000 || !/^\d{4}-\d{2}$/.test(mes)) return resposta(400, { erro: 'teto inválido' });
  const { error } = await db.from('crm_ia_limite').upsert({ id: 1, limite_usd: lim, aviso_pct: av, mes, gasto_agilite_usd: Math.round(g * 10000) / 10000,
    atualizado_em: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  const { data, error: e2 } = await db.rpc('crm_ia_teto');
  if (e2) throw new Error(e2.message);
  return resposta(200, Object.assign({ ok: true }, data));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const corpo = await req.text();
  if (corpo.length > 150000) return resposta(413, { erro: 'corpo grande demais' });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  // deno-lint-ignore no-explicit-any
  let pre: any = {};
  try { pre = JSON.parse(corpo); } catch { /* conferido abaixo */ }
  if (corpo.length > 2000 && !(pre && pre.acao === 'diretrizes')) return resposta(413, { erro: 'corpo grande demais' });
  if (pre && pre.acao === 'registrar_chave') return await registrar(db, req, corpo, pre);
  if (!(await assinaturaValida(db, corpo, req.headers.get('x-ceo-assinatura') || ''))) return resposta(401, { erro: 'não autorizado' });
  // deno-lint-ignore no-explicit-any
  let c: any;
  try { c = JSON.parse(corpo); } catch { return resposta(400, { erro: 'JSON inválido' }); }
  if (!Number.isFinite(c.ts) || Math.abs(Date.now() / 1000 - c.ts) > 300) return resposta(401, { erro: 'não autorizado' });
  if (typeof c.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(c.nonce)) return resposta(400, { erro: 'nonce inválido' });
  if (c.aud !== 'crm-ceo-acao') return resposta(401, { erro: 'não autorizado' });
  const numero = Number(c.numero);
  try {
    if (c.acao === 'bloqueados') {
      const { data, error } = await db.rpc('crm_ceo_pedidos_bloqueados');
      if (error) throw new Error(error.message);
      return resposta(200, { ok: true, pedidos: data });
    }
    if (c.acao === 'ver' || c.acao === 'liberar') {
      if (!Number.isInteger(numero) || numero < 1 || numero > 999999999) return resposta(400, { erro: 'número do pedido inválido' });
      const esperado = Array.isArray(c.esperado) && c.esperado.length <= 10 && c.esperado.every((x: unknown) => typeof x === 'string' && x.length <= 30) ? c.esperado : null;
      if (c.acao === 'liberar' && !esperado) return resposta(400, { erro: 'faltam os bloqueios esperados' });
      const { data, error } = c.acao === 'ver'
        ? await db.rpc('crm_ceo_pedido_ver', { p_numero: numero })
        : await db.rpc('crm_ceo_pedido_liberar', { p_numero: numero, p_nonce: c.nonce, p_esperado: esperado });
      if (error) throw new Error(error.message);
      return resposta(200, c.acao === 'ver' ? { ok: true, pedido: data } : data);
    }
    if (c.acao === 'compras') {
      const { data, error } = await db.rpc('crm_ceo_compras_aguardando');
      if (error) throw new Error(error.message);
      return resposta(200, Object.assign({ ok: true }, data));
    }
    if (c.acao === 'aprovar_compra' || c.acao === 'recusar_compra') {
      if (!Number.isInteger(numero) || numero < 1 || numero > 999999999) return resposta(400, { erro: 'número do pedido inválido' });
      const total = Array.isArray(c.esperado) && c.esperado.length === 1 ? Number(c.esperado[0]) : NaN;
      if (!Number.isFinite(total) || total < 0) return resposta(400, { erro: 'falta o total visto' });
      const motivo = typeof c.motivo === 'string' ? c.motivo.slice(0, 200) : null;
      const { data, error } = await db.rpc('crm_ceo_compra_decidir', { p_id: numero, p_nonce: c.nonce, p_decisao: c.acao === 'aprovar_compra' ? 'aprovar' : 'recusar', p_total: total, p_motivo: motivo });
      if (error) throw new Error(error.message);
      return resposta(200, data);
    }
    if (c.acao === 'diretrizes') return await diretrizes(db, c.lista);
    if (c.acao === 'ia_limite') return await iaLimite(db, c);
    return resposta(400, { erro: 'ação fora da lista' });
  } catch (e) {
    const m = (e as Error).message;
    if (/duplicate key|crm_ceo_acoes_nonce/.test(m)) return resposta(409, { erro: 'pedido repetido (mesmo nonce)' });
    console.error('[crm-ceo-acao]', m);
    return resposta(500, { erro: 'falhou no CRM' });
  }
});
