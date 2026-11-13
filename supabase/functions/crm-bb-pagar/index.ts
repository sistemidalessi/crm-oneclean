// Pagamento de contas pelo BB (API Pagamentos em Lote, 04/11/2026). Pedido do Anderson: "deixar lançado e aí você vai
// pagando ... hoje o saldo é esse, tem isso de título. Ok? Aí eu dou um ok pelo celular".
//   POST { acao: 'enviar', ids: [uuid…], data? }  → manda ao banco as contas a pagar escolhidas (boleto, guia ou Pix), em lotes;
//        o banco confere cada uma e o lote fica ESPERANDO A LIBERAÇÃO (nada é pago ainda)
//   POST { acao: 'liberar', lote: id }            → libera o lote (o pagamento sai no dia, se houver saldo até o horário-limite)
//   POST { acao: 'cancelar', item: id }           → cancela um pagamento ainda não feito
//   POST { acao: 'ciclo' }                        → lê a situação dos pagamentos vivos; o que o banco pagou é baixado no Caixa
//   POST { acao: 'teste_hm' }                     → (só homologação) manda os códigos de teste do próprio BB, sem conta nenhuma
// Ambiente em crm_config.dados.pagamentos.ambiente: 'hm' (homologação do BB, conta de teste do banco; NADA é baixado no Caixa)
// ou 'prod' (a conta da empresa; precisa do convênio PAG, da aplicação de produção e de ligado = true; o A1 entra pela VPS, rota /bb, 13/11/2026).
// Quem chama: o administrador logado, ou o agendador do banco (crm_bb_pag_tick, senha de crm_interno.bb_cfg) só para o ciclo.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { CONTA_TESTE, LIMITE_PADRAO, pronto, grupos, corpoDe, CAMINHO, CONSULTA, itensDaResposta, consultaDoItem, estadoDoLote, lerJson, erroTexto, txt } from './lote.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const resposta = (s: number, c: unknown) => new Response(JSON.stringify(c), { status: s, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const AMB = {
  hm: { oauth: 'https://oauth.hm.bb.com.br/oauth/token', api: 'https://api.hm.bb.com.br/pagamentos-lote/v1' },
  prod: { oauth: 'https://oauth.bb.com.br/oauth/token', api: 'https://api-ip.bb.com.br/pagamentos-lote/v1' }
} as const;
const ESCOPOS = ['lotes-requisicao', 'lotes-info', 'cancelar-requisicao', 'pagamentos-info', 'boletos-requisicao', 'boletos-info', 'guias-codigo-barras-requisicao',
  'guias-codigo-barras-info', 'transferencias-pix-requisicao', 'transferencias-pix-info', 'pix-info'].map(s => 'pagamentos-lote.' + s).join(' ');
const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const E = (k: string) => Deno.env.get(k) ?? '';

type Amb = keyof typeof AMB;
function contaDe(cfg: any, amb: Amb) {
  if (amb === 'hm') return CONTA_TESTE;
  const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
  const ag = Number(dig(cfg.agencia).slice(0, -1) || dig(cfg.agencia)), cc = String(cfg.conta || '').replace(/[^\dXx]/g, '');
  if (!cfg.ligado) throw new Error('o pagamento pelo BB ainda não está ligado na produção');
  if (!cfg.contrato || !ag || cc.length < 2) throw new Error('faltam o contrato (convênio PAG), a agência ou a conta em Configurações');
  return { agencia: ag, conta: Number(cc.slice(0, -1)), dv: cc.slice(-1).toUpperCase(), contrato: Number(cfg.contrato) };
}
// produção: o BB exige o certificado A1 (mTLS), que só existe na VPS (regra do CLAUDE.md). 13/11/2026: a chamada sai daqui pronta
// (endereço + token) e a rota /bb do serviço fiscal só acrescenta o certificado — o mesmo caminho do extrato (crm-bb). Com
// { cru: true } a VPS devolve o texto do banco, relido aqui com lerJson (o número do pagamento tem 17 dígitos).
async function viaVps(corpo: Record<string, unknown>) {
  const url = E('FISCAL_URL'), tok = E('FISCAL_TOKEN');
  if (!url || !tok) throw new Error('faltam FISCAL_URL e FISCAL_TOKEN nos Secrets');
  const r = await fetch(url.replace(/\/$/, '') + '/bb', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...corpo, cru: true }), signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({ erro: 'resposta inválida do serviço fiscal (HTTP ' + r.status + ')' }));
  if (r.status === 404) throw new Error('o serviço fiscal da VPS ainda não tem a rota /bb');
  if (!r.ok) throw new Error(j.erro || 'serviço fiscal: HTTP ' + r.status);
  const texto = typeof j.texto === 'string' ? j.texto : JSON.stringify(j.json ?? null);
  return { ok: j.status >= 200 && j.status < 300, status: Number(j.status) || 0, j: lerJson(texto) ?? j.json ?? null, t: texto };
}
async function token(amb: Amb) {
  const id = E('BB_PAG_CLIENT_ID'), seg = E('BB_PAG_CLIENT_SECRET');
  if (!id || !seg || !E('BB_PAG_APP_KEY')) throw new Error('faltam as chaves da aplicação de pagamentos nos Secrets (BB_PAG_CLIENT_ID, BB_PAG_CLIENT_SECRET, BB_PAG_APP_KEY)');
  const r = await fetch(AMB[amb].oauth, { method: 'POST', headers: { Authorization: 'Basic ' + btoa(id + ':' + seg), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: ESCOPOS }) });
  const t = await r.text(); const j: any = lerJson(t);
  if (r.ok && j?.access_token) return j.access_token as string;
  // produção: se o BB pedir o certificado também no token, pela VPS (como o tokenMtls da crm-bb)
  if (amb === 'prod') {
    const v = await viaVps({ url: AMB[amb].oauth, metodo: 'POST', basic: id + ':' + seg, form: { grant_type: 'client_credentials', scope: ESCOPOS } });
    if (v.ok && v.j?.access_token) return v.j.access_token as string;
    throw new Error('o BB recusou as chaves de pagamento (' + r.status + ' / pela VPS ' + v.status + '): ' + String(v.j?.error_description || v.j?.error || v.t || t).slice(0, 200));
  }
  throw new Error('o BB recusou as chaves de pagamento (' + r.status + '): ' + String(j?.error_description || j?.error || t).slice(0, 200));
}
const msgBB = (j: any, t: string) => {
  const e = j?.erros || j?.errors || (j?.error ? [j.error] : null);
  if (Array.isArray(e) && e.length) return e.map((x: any) => [x.codigo || x.code, x.mensagem || x.message || x.textoMensagem].filter(Boolean).join(' ')).join('; ').slice(0, 300);
  return String(j?.message || j?.mensagem || t || '').slice(0, 300);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = E('SUPABASE_URL');
  const db = createClient(url, E('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  let admin = false, agendador = false, quem: string | null = null;
  if (bearer.length >= 32 && bearer.split('.').length !== 3) {
    const { data } = await db.rpc('crm_bb_senha_ok', { p: bearer });
    agendador = data === true;
  } else if (bearer) {
    const comoUsuario = createClient(url, E('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: 'Bearer ' + bearer } }, auth: { persistSession: false } });
    const { data: u } = await comoUsuario.auth.getUser();
    if (u?.user) { const { data: eu } = await db.from('crm_usuarios').select('papel, ativo').eq('user_id', u.user.id).maybeSingle(); admin = !!eu?.ativo && eu.papel === 'admin'; quem = u.user.id; }
  }
  let c: any; try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  const { data: cfgL } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
  const cfg = cfgL?.dados?.pagamentos || {};
  const amb: Amb = cfg.ambiente === 'prod' ? 'prod' : 'hm';
  // o agendador só lê a situação (e, na homologação, pode rodar o teste com os códigos do próprio BB)
  if (!admin && !(agendador && (c?.acao === 'ciclo' || (c?.acao === 'teste_hm' && amb === 'hm')))) return resposta(401, { erro: 'só o administrador' });

  try {
    // um token por ambiente (o ciclo pode ler itens da homologação e da produção na mesma chamada)
    const tks: Partial<Record<Amb, string>> = {};
    const bb = async (met: string, cam: string, corpo?: unknown, ambX: Amb = amb) => {
      if (!tks[ambX]) tks[ambX] = await token(ambX);
      const tk = tks[ambX]!;
      const u = AMB[ambX].api + cam + (cam.includes('?') ? '&' : '?') + 'gw-dev-app-key=' + encodeURIComponent(E('BB_PAG_APP_KEY'));
      if (ambX === 'prod') return await viaVps({ url: u, metodo: met, token: tk, ...(corpo ? { json: corpo } : {}) });
      const r = await fetch(u, { method: met, headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(40000) });
      const t = await r.text();
      return { ok: r.ok, status: r.status, j: lerJson(t), t };
    };

    // ---------------------------------------------------------------- enviar
    if (c.acao === 'enviar' || c.acao === 'teste_hm') {
      const conta = contaDe(cfg, amb);
      const hoje = hojeSP();
      const data = c.data && String(c.data) > hoje ? String(c.data).slice(0, 10) : hoje;
      let itens: any[] = [], pulados: any[] = [];
      if (c.acao === 'teste_hm') {
        if (amb !== 'hm') return resposta(400, { erro: 'o teste só roda na homologação' });
        itens = [
          { forma: 'guia', data, conta: { id: null, descricao: 'Teste do BB (guia)', valor: 105.72, pag_codigo: '83690000001057200052858120735518020735512003' } },
          { forma: 'pix', data, conta: { id: null, descricao: 'Teste do BB (Pix)', valor: 12.34 }, fav: { nome: 'Teste BB', pix_tipo: 'email', pix_chave: 'hmtestes2@bb.com.br' } }];
      } else {
        const ids = (Array.isArray(c.ids) ? c.ids : []).filter((x: unknown) => typeof x === 'string').slice(0, 300);
        if (!ids.length) return resposta(400, { erro: 'escolha as contas' });
        const { data: ls, error } = await db.from('crm_fin_lancamentos').select('id, tipo, situacao, descricao, fornecedor, valor, vencimento, pag_forma, pag_codigo, pag_doc, pag_favorecido_id').in('id', ids);
        if (error) throw new Error(error.message);
        const favIds = [...new Set((ls || []).map((l: any) => l.pag_favorecido_id).filter(Boolean))];
        const favs = new Map<string, any>();
        if (favIds.length) { const { data: fs } = await db.from('crm_fin_favorecidos').select('*').in('id', favIds); (fs || []).forEach((f: any) => favs.set(f.id, f)); }
        const vivos = new Set<string>();
        if (amb === 'prod') { const { data: vs } = await db.from('crm_fin_pag_itens').select('lancamento_id').in('lancamento_id', ids).eq('ativo', true).eq('ambiente', 'prod'); (vs || []).forEach((v: any) => vivos.add(v.lancamento_id)); }
        for (const l of ls || []) {
          const fav = l.pag_favorecido_id ? favs.get(l.pag_favorecido_id) : null;
          const p = pronto(l, fav, cfg.limite == null || cfg.limite === '' ? LIMITE_PADRAO : Number(cfg.limite));
          if (p.erro) { pulados.push({ id: l.id, descricao: l.descricao, motivo: p.erro }); continue; }
          if (vivos.has(l.id)) { pulados.push({ id: l.id, descricao: l.descricao, motivo: 'já está num envio ao banco' }); continue; }
          itens.push({ forma: p.forma, data, conta: l, fav });
        }
      }
      const lotes: any[] = [];
      const numero = async () => {
        if (amb === 'hm') return 100000 + Math.floor(Math.random() * 900000);
        const { data: x, error: en } = await db.rpc('crm_fin_pag_numero');
        if (en || !x) throw new Error('não consegui o número do lote: ' + (en?.message || ''));
        return Number(x);
      };
      for (const g of grupos(itens)) {
        let n = await numero();
        const total = Math.round(g.itens.reduce((s: number, x: any) => s + Number(x.conta.valor), 0) * 100) / 100;
        const { data: lote, error: el } = await db.from('crm_fin_pag_lotes').insert({ numero_requisicao: n, ambiente: amb, forma: g.forma, data_pagamento: g.data,
          quantidade: g.itens.length, valor: total, enviado_por: quem }).select('id').single();
        if (el) throw new Error(el.message);
        // o item nasce antes do envio: o índice único impede a mesma conta em dois envios ao mesmo tempo
        const { data: its, error: ei } = await db.from('crm_fin_pag_itens').insert(g.itens.map((x: any) => ({ lote_id: lote.id, lancamento_id: x.conta.id, ambiente: amb, forma: g.forma,
          descricao: txt(x.conta.descricao, 80), favorecido: x.fav?.nome || x.conta.fornecedor || null, valor: x.conta.valor, data_pagamento: g.data }))).select('id');
        if (ei) { await db.from('crm_fin_pag_lotes').update({ erro: 'não gravou: ' + ei.message }).eq('id', lote.id); pulados = pulados.concat(g.itens.map((x: any) => ({ id: x.conta.id, descricao: x.conta.descricao, motivo: /duplicate|unique/i.test(ei.message) ? 'já está num envio ao banco' : ei.message }))); continue; }
        let r;
        // o número da requisição é único no convênio (na homologação, a conta de teste é de todo mundo): "1028 já foi utilizado" → outro número
        for (let tent = 0; ; tent++) {
          try { r = await bb('POST', CAMINHO[g.forma as 'boleto'], corpoDe(g.forma, n, conta, g.itens)); }
          catch (e) { r = { ok: false, status: 0, j: null, t: String((e as Error).message || e) }; }
          if (r.ok || tent >= 4 || !/\b1028\b/.test(msgBB(r.j, r.t))) break;
          n = await numero();
          const { error: eu } = await db.from('crm_fin_pag_lotes').update({ numero_requisicao: n }).eq('id', lote.id);
          if (eu) break;
        }
        if (!r.ok) {
          const erro = 'o banco recusou o lote (' + r.status + '): ' + msgBB(r.j, r.t);
          await db.from('crm_fin_pag_lotes').update({ erro, resposta: r.j }).eq('id', lote.id);
          await db.from('crm_fin_pag_itens').update({ ativo: false, estado: 'rejeitado' }).eq('lote_id', lote.id);
          lotes.push({ id: lote.id, numero: n, forma: g.forma, erro });
          continue;
        }
        const resp = itensDaResposta(g.forma, r.j);
        for (let i = 0; i < (its || []).length; i++) {
          const x = resp[i] || { aceito: false, identificador: null, erros: [] };
          await db.from('crm_fin_pag_itens').update({ identificador_bb: x.identificador, aceito: x.aceito, erros: x.erros, estado: x.aceito ? 'consistente' : 'inconsistente', ativo: x.aceito }).eq('id', its![i].id);
        }
        await db.from('crm_fin_pag_lotes').update({ estado: estadoDoLote(r.j), resposta: r.j }).eq('id', lote.id);
        lotes.push({ id: lote.id, numero: n, forma: g.forma, quantidade: g.itens.length, valor: total, estado: estadoDoLote(r.j),
          recusados: resp.map((x, i) => x.aceito ? null : { descricao: g.itens[i].conta.descricao, erros: x.erros.map(erroTexto) }).filter(Boolean) });
      }
      return resposta(200, { ambiente: amb, data, lotes, pulados });
    }

    // ---------------------------------------------------------------- liberar
    if (c.acao === 'liberar') {
      const { data: lote } = await db.from('crm_fin_pag_lotes').select('*').eq('id', Number(c.lote)).maybeSingle();
      if (!lote) return resposta(404, { erro: 'lote não encontrado' });
      if (lote.liberado_em) return resposta(200, { ok: true, ja: true });
      const r = await bb('POST', '/liberar-pagamentos', { numeroRequisicao: lote.numero_requisicao, indicadorFloat: 'N' }, lote.ambiente);
      if (!r.ok) return resposta(502, { erro: 'o banco não liberou (' + r.status + '): ' + msgBB(r.j, r.t) });
      await db.from('crm_fin_pag_lotes').update({ liberado_em: new Date().toISOString(), liberado_por: quem, liberado_via: c.via === 'celular' ? 'celular' : 'crm' }).eq('id', lote.id);
      return resposta(200, { ok: true, mensagem: r.j?.mensagemRetorno || 'liberado' });
    }

    // ---------------------------------------------------------------- cancelar
    if (c.acao === 'cancelar') {
      const { data: it } = await db.from('crm_fin_pag_itens').select('*, lote:crm_fin_pag_lotes(numero_requisicao, ambiente)').eq('id', Number(c.item)).maybeSingle();
      if (!it?.identificador_bb) return resposta(404, { erro: 'pagamento não encontrado' });
      const ambI: Amb = it.ambiente === 'prod' ? 'prod' : 'hm';
      const ct = contaDe(cfg, ambI);
      const r = await bb('POST', '/cancelar-pagamentos', { agenciaDebito: ct.agencia, contaCorrenteDebito: ct.conta, digitoVerificadorContaCorrente: ct.dv, numeroContratoPagamento: ct.contrato,
        listaPagamentos: [{ codigoPagamento: it.identificador_bb }] }, ambI);
      const ok = r.ok && String(r.j?.pagamentos?.[0]?.indicadorCancelamento || '').toUpperCase() === 'S';
      if (!ok) return resposta(502, { erro: 'o banco não cancelou (' + r.status + '): ' + (msgBB(r.j, r.t) || r.j?.pagamentos?.[0]?.estadoCancelamento || '') });
      await db.from('crm_fin_pag_itens').update({ estado: 'cancelado', ativo: false }).eq('id', it.id);
      return resposta(200, { ok: true });
    }

    // ---------------------------------------------------------------- ciclo
    if (c.acao === 'ciclo') {
      const { data: vivos } = await db.from('crm_fin_pag_itens').select('*').eq('ativo', true).eq('baixado', false).not('identificador_bb', 'is', null)
        .gte('data_pagamento', new Date(Date.parse(hojeSP() + 'T12:00:00Z') - 15 * 86400000).toISOString().slice(0, 10)).limit(300);
      const out = { lidos: 0, pagos: 0, baixados: 0, falharam: 0, erros: [] as string[] };
      const porAmb: Record<string, any[]> = {};
      (vivos || []).filter((x: any) => !(x.estado === 'pago' || x.estado === 'debitado') || (x.ambiente === 'prod' && !x.baixado)).forEach((x: any) => (porAmb[x.ambiente] = porAmb[x.ambiente] || []).push(x));
      for (const [a, lista] of Object.entries(porAmb)) {
        const ambI = a as Amb;
        const ct = contaDe(cfg, ambI);
        for (const it of lista) {
          const r = await bb('GET', CONSULTA[it.forma as 'boleto'] + it.identificador_bb + '?agencia=' + ct.agencia + '&contaCorrente=' + ct.conta + '&digitoVerificador=' + ct.dv, undefined, ambI);
          if (!r.ok) { out.erros.push(it.id + ': ' + r.status + ' ' + msgBB(r.j, r.t)); continue; }
          out.lidos++;
          const q = consultaDoItem(r.j);
          if (!q?.estado) continue;
          const upd: any = { estado: q.estado.chave, ativo: q.estado.ativo, ultimo: r.j, autenticacao: q.autenticacao };
          if (q.estado.pago) {
            out.pagos++;
            upd.pago_em = q.pago_em || it.data_pagamento;
            // só a produção baixa a conta no Caixa (homologação é dinheiro de teste)
            if (ambI === 'prod' && it.lancamento_id) {
              const { data: b } = await db.from('crm_fin_lancamentos').update({ situacao: 'pago', pago_em: upd.pago_em, baixa: 'caixa', baixado_em: new Date().toISOString() }).eq('id', it.lancamento_id).eq('situacao', 'aberto').select('id');
              upd.baixado = true; if ((b || []).length) out.baixados++;
            }
          }
          if (!q.estado.ativo) out.falharam++;
          await db.from('crm_fin_pag_itens').update(upd).eq('id', it.id);
        }
      }
      return resposta(200, out);
    }
    return resposta(400, { erro: 'ação desconhecida' });
  } catch (e) {
    return resposta(500, { erro: String((e as Error).message || e).slice(0, 400) });
  }
});
