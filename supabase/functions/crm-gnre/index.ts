// Edge Function crm-gnre — o robô da GNRE do DIFAL (06/11/2026, pedido do Anderson: "pode montar o robô da GNRE do DIFAL").
// Venda a consumidor final NÃO contribuinte de outra UF (quase sempre o RS) deve o ICMS DIFAL da UF de destino, por operação,
// antes da saída (EC 87/2015, LC 190/2022). Até hoje a crm-fiscal só lançava a conta no Caixa e alguém fazia a guia no Portal
// GNRE à mão. Agora, logo depois da NF-e autorizada, este robô:
//   1. monta a guia pela nota (UF, receita 100102, chave no documento de origem e no campo extra, valor do vICMSUFDest);
//   2. manda ao Portal GNRE pelo serviço fiscal na VPS (TLS mútuo com o A1; servico-fiscal/gnre.js, rota POST /gnre);
//   3. uns 35 s depois, busca o resultado: linha digitável, código de barras, Pix e o PDF da guia;
//   4. grava em crm_gnre, guarda o PDF (bucket crm-caixa-anexos, gnre/<chave>-<receita>.pdf) e põe o código de barras na conta do Caixa
//      ("Guia", pronta para o "Pagar no BB"). PAGAR É SEMPRE CLIQUE DO ANDERSON (regra: irreversível em sistema de terceiros).
// Quem chama: o agendador do banco (crm_gnre_tick, senha de crm_interno.bb_cfg no cabeçalho x-crm-agendador; só 'ciclo'),
// o administrador e a logística (gerar de novo, baixar o PDF), e só o administrador para a configuração da UF.
// Liga e desliga por crm_config.dados.gnre.ligado (só o agendador obedece; o "Gerar agora" da tela funciona sempre).
// Deploy: verify_jwt DESLIGADO (o banco chama sem login; a função confere a senha ou o login).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { montaGuias, situacaoDoResultado, textoObs } from './guia.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-crm-agendador',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
type Linha = Record<string, unknown>;
type Db = ReturnType<typeof createClient>;
const BUCKET = 'crm-caixa-anexos';
const hojeBr = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));

async function servico(corpo: Linha) {
  const url = Deno.env.get('FISCAL_URL'), tok = Deno.env.get('FISCAL_TOKEN');
  if (!url || !tok) throw new Error('o serviço fiscal ainda não está ligado (faltam FISCAL_URL e FISCAL_TOKEN nos Secrets)');
  const r = await fetch(url.replace(/\/$/, '') + '/gnre', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo), signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({ erro: 'resposta inválida do serviço fiscal (HTTP ' + r.status + ')' }));
  if (r.status === 404) throw new Error('o serviço fiscal na VPS ainda não tem a GNRE (falta o git pull + reiniciar, versão 2026-11-06a ou mais nova)');
  if (!r.ok) throw new Error(j.erro || 'serviço fiscal: HTTP ' + r.status);
  return j as Linha;
}
async function config(db: Db) {
  const { data } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
  const d = ((data && (data as Linha).dados) || {}) as Linha;
  return { gnre: (d.gnre || {}) as Linha, fiscal: (d.fiscal || {}) as Linha };
}

const FCP = '100129';
const prefixo = (receita: string) => (receita === FCP ? 'GNRE FCP ' : 'GNRE DIFAL ');
// a conta do Caixa da guia: a do DIFAL é a que a crm-fiscal criou na autorização (descrição com a chave); a do FCP (guia
// própria no RS) nasce aqui. Se não houver, cria igual.
async function contaDoCaixa(db: Db, nfe: Linha, valor: number, uf: string, receita: string) {
  const pre = prefixo(receita);
  const { data } = await db.from('crm_fin_lancamentos').select('id, anexos, observacoes, situacao, valor').eq('tipo', 'saida').like('descricao', pre + '%(' + nfe.chave + ')%').limit(1);
  if (data && data.length) return data[0] as Linha;
  const desc = pre + uf + ' - NF ' + nfe.serie + '-' + nfe.numero + ' (' + nfe.chave + ')';
  const { data: novo } = await db.from('crm_fin_lancamentos').insert({ tipo: 'saida', descricao: desc, fornecedor: 'Sefaz-' + uf + ' (GNRE)', categoria: 'Impostos', valor,
    vencimento: hojeBr(), situacao: 'aberto', origem: 'tela',
    observacoes: (receita === FCP ? 'FCP (fundo de combate à pobreza) da UF de destino, guia própria (receita 100129). ' : '') +
      'ICMS DIFAL de venda a consumidor final não contribuinte de outra UF (EC 87/2015, LC 190/2022): pagar a GNRE antes de a mercadoria sair; a guia acompanha a nota.' })
    .select('id, anexos, observacoes, situacao, valor').single();
  return novo as Linha;
}

// manda as guias de uma nota ao Portal GNRE (uma por receita; não repete a que já saiu: gerada/paga/cancelada)
async function enviaNota(db: Db, nfe: Linha, cfg: { gnre: Linha; fiscal: Linha }, forcar = false) {
  const { data: jas } = await db.from('crm_gnre').select('*').eq('nfe_id', nfe.id);
  const ja = new Map<string, Linha>(((jas || []) as Linha[]).map(g => [String(g.receita), g] as [string, Linha]));
  const m = montaGuias(nfe, cfg, hojeBr()) as Linha;
  const comum = { nfe_id: nfe.id, ambiente: m.ambiente, nota: nfe.serie + '-' + nfe.numero, chave: nfe.chave, uf: m.uf, valor_fcp: 0, vencimento: hojeBr(), atualizado_em: new Date().toISOString() };
  if (m.erro) {
    const g0 = ja.get('100102');
    const { data } = await db.from('crm_gnre').upsert(Object.assign({}, comum, { receita: '100102', valor: Number(m.valor) || 0, situacao: 'erro', motivo: m.erro, tentativas: Number((g0 && g0.tentativas) || 0) + 1 }), { onConflict: 'nfe_id,receita' }).select('id').single();
    return [{ id: (data as Linha | null)?.id, situacao: 'erro', motivo: m.erro }];
  }
  const out: Linha[] = [];
  for (const x of (m.guias as Linha[])) {
    const g0 = ja.get(String(x.receita));
    if (g0 && ['gerada', 'paga', 'cancelada'].includes(String(g0.situacao))) { out.push({ id: g0.id, receita: x.receita, situacao: g0.situacao, ja: true }); continue; }
    if (g0 && !forcar && (g0.situacao === 'rejeitada' || (g0.situacao === 'enviada' && g0.recibo))) { out.push({ id: g0.id, receita: x.receita, situacao: g0.situacao, ja: true, motivo: g0.motivo }); continue; }
    const linha = Object.assign({}, comum, { receita: x.receita, valor: x.valor, valor_fcp: Number((x.guia as Linha).fcpJunto ? (x.guia as Linha).valorFcp : 0), tentativas: Number((g0 && g0.tentativas) || 0) + 1 });
    try {
      const r = await servico({ acao: 'enviar', ambiente: m.ambiente, emitente: m.emitente, guias: [x.guia] });
      const ok = Number(r.codigo) === 100 && !!r.recibo;
      const { data } = await db.from('crm_gnre').upsert(Object.assign(linha, {
        situacao: ok ? 'enviada' : 'rejeitada', recibo: r.recibo || null, enviado_em: new Date().toISOString(),
        motivo: ok ? null : 'Portal GNRE recusou o lote: ' + (r.codigo || '') + ' ' + (r.descricao || ''), retorno: { recepcao: { codigo: r.codigo, descricao: r.descricao, tempo: r.tempo } }
      }), { onConflict: 'nfe_id,receita' }).select('id').single();
      out.push({ id: (data as Linha | null)?.id, receita: x.receita, situacao: ok ? 'enviada' : 'rejeitada', recibo: r.recibo, codigo: r.codigo, descricao: r.descricao });
    } catch (e) {
      const msg = (e as Error).message;
      const { data } = await db.from('crm_gnre').upsert(Object.assign(linha, { situacao: 'erro', motivo: msg.slice(0, 500) }), { onConflict: 'nfe_id,receita' }).select('id').single();
      out.push({ id: (data as Linha | null)?.id, receita: x.receita, situacao: 'erro', motivo: msg });
    }
  }
  return out;
}

// busca o resultado de uma guia enviada; gerada → PDF guardado e código de barras na conta do Caixa
async function buscaResultado(db: Db, g: Linha) {
  let r: Linha;
  try { r = await servico({ acao: 'resultado', ambiente: g.ambiente, recibo: g.recibo }); }
  catch (e) {
    await db.from('crm_gnre').update({ motivo: 'resultado: ' + (e as Error).message.slice(0, 300), atualizado_em: new Date().toISOString() }).eq('id', g.id);
    return { id: g.id, situacao: 'enviada', erro: (e as Error).message };
  }
  const s = situacaoDoResultado(r);
  const ret = Object.assign({}, (g.retorno || {}) as Linha, { resultado: { codigo: r.codigo, descricao: r.descricao, guias: ((r.guias || []) as Linha[]).map(x => Object.assign({}, x, { pix: x.pix ? true : null })) } });
  if (s.situacao === 'enviada') {
    await db.from('crm_gnre').update({ retorno: ret, atualizado_em: new Date().toISOString() }).eq('id', g.id);
    return { id: g.id, situacao: 'enviada', processando: true };
  }
  if (s.situacao !== 'gerada') {
    await db.from('crm_gnre').update({ situacao: s.situacao, motivo: s.motivo, retorno: ret, atualizado_em: new Date().toISOString() }).eq('id', g.id);
    return { id: g.id, situacao: s.situacao, motivo: s.motivo };
  }
  const guia = s.guia as Linha;
  let pdf: string | null = null;
  if (r.pdf) {
    try {
      const bytes = Uint8Array.from(atob(String(r.pdf)), c => c.charCodeAt(0));
      pdf = 'gnre/' + g.chave + '-' + (g.receita || '100102') + '.pdf';
      const { error } = await db.storage.from(BUCKET).upload(pdf, new Blob([bytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' });
      if (error) { console.error('[crm-gnre] PDF: ' + error.message); pdf = null; }
    } catch (e) { console.error('[crm-gnre] PDF: ' + (e as Error).message); pdf = null; }
  }
  const conta = await contaDoCaixa(db, (await db.from('crm_nfe').select('id, chave, serie, numero').eq('id', g.nfe_id).single()).data as Linha, Number(g.valor) + Number(g.valor_fcp || 0), String(g.uf), String(g.receita || '100102'));
  if (conta && conta.id) {
    const anexos = [...new Set((((conta.anexos || []) as string[])).concat(pdf ? [pdf] : []))];
    const obs = textoObs(String(conta.observacoes || ''), guia);
    // pag_doc fica como está (o banco só aceita CPF/CNPJ ali; o nº de controle da guia vai na observação)
    const patch: Linha = { pag_forma: 'guia', pag_codigo: guia.codigoBarras, anexos, observacoes: obs, atualizado_em: new Date().toISOString() };
    if (guia.valor && conta.situacao === 'aberto') patch.valor = guia.valor;
    await db.from('crm_fin_lancamentos').update(patch).eq('id', conta.id);
  }
  await db.from('crm_gnre').update({ situacao: 'gerada', motivo: null, retorno: ret, codigo_barras: guia.codigoBarras, linha_digitavel: guia.linhaDigitavel,
    numero_controle: guia.numeroControle, pdf_caminho: pdf, lancamento_id: conta ? conta.id : null, gerada_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
    vencimento: guia.dataLimite || g.vencimento }).eq('id', g.id);
  return { id: g.id, situacao: 'gerada', linha: guia.linhaDigitavel, pdf: !!pdf };
}

// o ciclo do agendador (e do "Gerar agora"): manda o que falta, espera o processamento e busca os resultados
async function ciclo(db: Db, opts: { nfeId?: string; forcar?: boolean } = {}) {
  const cfg = await config(db);
  const out: Linha[] = [];
  let q = db.from('crm_nfe').select('id, ambiente, serie, numero, chave, situacao, totais, nota, autorizada_em').eq('situacao', 'autorizada');
  q = opts.nfeId ? q.eq('id', opts.nfeId) : q.eq('ambiente', 'producao').gte('autorizada_em', new Date(Date.now() - 20 * 864e5).toISOString());
  const { data: notas } = await q.order('autorizada_em').limit(opts.nfeId ? 1 : 200);
  const comDifal = ((notas || []) as Linha[]).filter(n => {
    const t = (n.totais || {}) as Linha;
    return Number(t.vICMSUFDest || 0) + Number(t.vFCPUFDest || 0) > 0;
  });
  const { data: guias } = await db.from('crm_gnre').select('nfe_id, receita, situacao, tentativas, atualizado_em').in('nfe_id', comDifal.map(n => n.id).concat(['00000000-0000-0000-0000-000000000000']));
  const porNota = new Map<string, Linha[]>();
  for (const g of (guias || []) as Linha[]) porNota.set(String(g.nfe_id), (porNota.get(String(g.nfe_id)) || []).concat([g]));
  // a guia "parada" não chama o portal de novo: gerada/paga/cancelada; rejeitada (espera alguém); enviada (espera o resultado);
  // erro tenta de novo até 6 vezes, de meia em meia hora
  const parada = (g: Linha) => ['gerada', 'paga', 'cancelada', 'rejeitada', 'enviada'].includes(String(g.situacao)) ||
    (g.situacao === 'erro' && (Number(g.tentativas) >= 6 || Date.now() - Date.parse(String(g.atualizado_em)) < 30 * 6e4));
  let enviadas = 0;
  for (const n of comDifal) {
    const t = (n.totais || {}) as Linha, precisa = (Number(t.vICMSUFDest || 0) > 0 ? 1 : 0) + (Number(t.vFCPUFDest || 0) > 0 ? 1 : 0);
    const gs = porNota.get(String(n.id)) || [];
    if (!opts.nfeId && gs.filter(parada).length >= precisa) continue;
    if (enviadas >= 5) break;
    for (const r of await enviaNota(db, n, cfg, !!opts.forcar)) out.push(Object.assign({ nota: n.serie + '-' + n.numero }, r));
    enviadas++;
  }
  // o portal pede pelo menos 30 s entre o envio e a consulta do resultado
  if (out.some(x => x.situacao === 'enviada' && !x.ja)) await espera(35000);
  let qg = db.from('crm_gnre').select('*').eq('situacao', 'enviada').not('recibo', 'is', null);
  if (opts.nfeId) qg = qg.eq('nfe_id', opts.nfeId);
  const { data: pend } = await qg.limit(10);
  const res: Linha[] = [];
  for (const g of (pend || []) as Linha[]) {
    if (Date.now() - Date.parse(String(g.enviado_em || g.atualizado_em)) < 30000) continue;
    res.push(Object.assign({ nota: g.nota }, await buscaResultado(db, g)));
  }
  return { enviadas: out, resultados: res };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let b: Linha = {};
  try { b = await req.json(); } catch { /* corpo vazio */ }
  const senhaAg = req.headers.get('x-crm-agendador') || '';
  if (senhaAg) {
    const { data: ok } = await db.rpc('crm_bb_senha_ok', { p: senhaAg });
    if (ok !== true) return resposta(401, { erro: 'senha do agendador inválida' });
    if (b.acao !== 'ciclo') return resposta(400, { erro: 'o agendador só roda o ciclo' });
    const { gnre } = await config(db);
    if (gnre.ligado !== true) return resposta(200, { desligado: true });
    try { return resposta(200, await ciclo(db)); } catch (e) { return resposta(500, { erro: (e as Error).message }); }
  }
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: quem } = await comoUsuario.auth.getUser();
  if (!quem?.user) return resposta(401, { erro: 'faça login' });
  const { data: euRow } = await db.from('crm_usuarios').select('papel, ativo').eq('user_id', quem.user.id).maybeSingle();
  const eu = euRow as Linha | null;
  if (!eu || !eu.ativo || !['admin', 'logistica'].includes(String(eu.papel))) return resposta(403, { erro: 'só o administrador e a logística' });
  try {
    if (b.acao === 'gerar') {
      if (!/^[0-9a-f-]{36}$/.test(String(b.nfe_id || ''))) return resposta(400, { erro: 'nota inválida' });
      return resposta(200, await ciclo(db, { nfeId: String(b.nfe_id), forcar: true }));
    }
    if (b.acao === 'ciclo') return resposta(200, await ciclo(db));
    if (b.acao === 'pdf') {
      const { data: g } = await db.from('crm_gnre').select('pdf_caminho').eq('id', String(b.id || '')).maybeSingle();
      const cam = g && (g as Linha).pdf_caminho;
      if (!cam) return resposta(404, { erro: 'a guia ainda não tem PDF' });
      const { data: s, error } = await db.storage.from(BUCKET).createSignedUrl(String(cam), 600);
      if (error || !s) return resposta(500, { erro: 'não consegui o link do PDF' });
      return resposta(200, { url: s.signedUrl });
    }
    if (b.acao === 'configuf') {
      if (eu.papel !== 'admin') return resposta(403, { erro: 'só o administrador' });
      const uf = String(b.uf || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(uf)) return resposta(400, { erro: 'UF inválida' });
      const { gnre } = await config(db);
      const r = await servico({ acao: 'configuf', ambiente: gnre.ambiente === 'homologacao' ? 'homologacao' : 'producao', uf, receita: String(b.receita || '100102') });
      await db.rpc('crm_gnre_config_uf', { p_uf: uf, p_receita: String(b.receita || '100102'), p_retorno: r });
      return resposta(200, r);
    }
    return resposta(400, { erro: 'ação desconhecida' });
  } catch (e) {
    return resposta(500, { erro: (e as Error).message });
  }
});
