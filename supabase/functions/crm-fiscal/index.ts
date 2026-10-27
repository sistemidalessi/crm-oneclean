// Edge Function crm-fiscal — o CRM emite NF-e (Fase 4 da saída do FKN, 16/10/2026).
// O navegador chama esta função (com o login de quem clicou); ela confere o papel, junta do banco o pedido, o cliente,
// as regras fiscais e o emitente, reserva o número (crm_nfe_reservar) e manda ao SERVIÇO FISCAL na VPS
// (servico-fiscal/, que assina com o A1 e fala com a Sefaz-SP). A nota autorizada entra no CRM pelo mesmo caminho do
// vigia (crm-notas): estoque, títulos das parcelas, comissão, XML guardado.
// Secrets: FISCAL_URL (https://fiscal.oneclean.com.br) e FISCAL_TOKEN (gerado na VPS; ver servico-fiscal/INSTALAR.md).
// Notas de COMPRA (dfe_buscar, dfe_ciencia, dfe_manifestar): administrador e comprador, do começo ao fim (27/10/2026,
// pedido do Anderson): busca, ciência e a resposta definitiva (confirmação, desconhecimento, operação não realizada).
// Deploy: verify_jwt LIGADO.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { ibptUrl, ibptLinha, ibptPrecisa } from './ibpt.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const EMITE = ['admin', 'gestor', 'logistica'], CANCELA = ['admin', 'gestor', 'logistica'], DFE = ['admin', 'comprador'];
type Linha = Record<string, unknown>;

async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function servico(rota: string, corpo: unknown, metodo = 'POST') {
  const url = Deno.env.get('FISCAL_URL'), tok = Deno.env.get('FISCAL_TOKEN');
  if (!url || !tok) throw new Error('o serviço fiscal ainda não está ligado (faltam FISCAL_URL e FISCAL_TOKEN nos Secrets)');
  const r = await fetch(url.replace(/\/$/, '') + rota, { method: metodo, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: metodo === 'POST' ? JSON.stringify(corpo ?? {}) : undefined, signal: AbortSignal.timeout(90000) });
  const j = await r.json().catch(() => ({ erro: 'resposta inválida do serviço fiscal (HTTP ' + r.status + ')' }));
  if (!r.ok) throw new Error(j.erro || 'serviço fiscal: HTTP ' + r.status);
  return j;
}

// A nota autorizada (ou o cancelamento) entra no CRM pela crm-notas, com uma chave de integração própria, derivada do
// FISCAL_TOKEN (não é preciso gerar outra na tela). A integração é criada sozinha na primeira vez.
async function entregaAoCrm(db: ReturnType<typeof createClient>, nome: string, xml: string) {
  const chave = await sha256('crm-notas:' + Deno.env.get('FISCAL_TOKEN'));
  const hash = await sha256(chave);
  const { data: ja } = await db.from('crm_integracoes').select('id').eq('token_hash', hash).maybeSingle();
  if (!ja) await db.from('crm_integracoes').insert({ nome: 'Serviço fiscal (NF-e do CRM)', token_hash: hash, filtro: 'todas', ativo: true, uso: 'notas', criado_por: null });
  const r = await fetch(Deno.env.get('SUPABASE_URL') + '/functions/v1/crm-notas', { method: 'POST',
    headers: { 'x-crm-chave': chave, 'Content-Type': 'application/json' }, body: JSON.stringify({ arquivos: [{ nome, xml }] }) });
  return await r.json().catch(() => ({ erro: 'crm-notas: HTTP ' + r.status }));
}

// Tabela do IBPT pela API (De Olho no Imposto; token nos Secrets como IBPT_TOKEN). Consulta os NCM dos produtos com regra
// fiscal: todos (botão "Atualizar pelo IBPT agora") ou só os sem linha e os que vencem em até 7 dias (sozinha, na prévia).
// O resultado da última tentativa fica em crm_sistema.ibpt (a tela mostra).
async function ibptAtualizar(db: ReturnType<typeof createClient>, fiscal: Linha, todos: boolean) {
  const token = Deno.env.get('IBPT_TOKEN') ?? '';
  const emit = (fiscal.emitente || {}) as Linha, cnpj = String(emit.cnpj || '').replace(/\D/g, ''), uf = String(((emit.endereco || {}) as Linha).uf || 'SP');
  const grava = async (r: Linha) => { await db.from('crm_sistema').upsert({ chave: 'ibpt', valor: JSON.stringify(r), quem: null, quando: new Date().toISOString() }); return r; };
  if (!token) return { ok: false, erro: 'falta o token do IBPT (cadastro gratuito no De Olho no Imposto; colar nos Secrets do Supabase como IBPT_TOKEN)' };
  if (!cnpj) return { ok: false, erro: 'falta o CNPJ do emitente (aba Fiscal → Emissão)' };
  const { data: regs } = await db.from('crm_fiscal_produtos').select('ncm');
  const ncms = [...new Set(((regs || []) as Linha[]).map(r => String(r.ncm || '').replace(/\D/g, '')).filter(n => n.length === 8))];
  const { data: tem } = ncms.length ? await db.from('crm_ibpt').select('codigo, vig_fim').eq('ex', '').in('codigo', ncms) : { data: [] };
  const fila = todos ? ncms : ibptPrecisa(ncms, (tem || []) as Linha[], new Date(Date.now() - 3 * 36e5).toISOString(), 7);
  const linhas: Linha[] = [], falhas: string[] = [];
  let i = 0;
  const um = async () => {
    while (i < fila.length) {
      const n = fila[i++], ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
      try {
        const r = await fetch(ibptUrl(token, cnpj, n, uf), { signal: ctl.signal, headers: { Accept: 'application/json' } });
        const j = await r.json().catch(() => null);
        const l = r.ok ? ibptLinha(n, j) : null;
        if (l) linhas.push(l); else falhas.push(n + ': ' + (r.ok ? 'resposta sem alíquotas' : 'HTTP ' + r.status + (j && (j as Linha).Message ? ' ' + String((j as Linha).Message).slice(0, 80) : '')));
      } catch (e) { falhas.push(n + ': ' + ((e as Error).name === 'AbortError' ? 'sem resposta em 10 s' : (e as Error).message)); }
      finally { clearTimeout(t); }
    }
  };
  await Promise.all([um(), um(), um(), um()]);
  for (let k = 0; k < linhas.length; k += 200) {
    const { error } = await db.from('crm_ibpt').upsert(linhas.slice(k, k + 200), { onConflict: 'codigo,ex' });
    if (error) return grava({ ok: false, em: new Date().toISOString(), erro: 'gravar: ' + error.message });
  }
  const versao = linhas[0] ? linhas[0].versao : null, vigFim = linhas.map(l => String(l.vig_fim)).sort()[0] || null;
  return grava({ ok: falhas.length === 0, em: new Date().toISOString(), consultados: fila.length, gravados: linhas.length, falhas: falhas.length,
    exemplos_falha: falhas.slice(0, 5), versao, vig_fim: vigFim });
}

async function dadosDoPedido(db: ReturnType<typeof createClient>, pedidoId: string) {
  const { data: pedido } = await db.from('crm_pedidos').select('*').eq('id', pedidoId).maybeSingle();
  if (!pedido) throw new Error('pedido não encontrado');
  const p = pedido as Linha;
  if (['faturado', 'cancelado'].includes(String(p.situacao))) throw new Error('o pedido já está ' + p.situacao);
  const abertos = ((p.bloqueios as string[]) || []).filter(b => !((p.liberado as string[]) || []).includes(b));
  if (abertos.length) throw new Error('o pedido está bloqueado (' + abertos.join(', ') + '): a gestora precisa liberar');
  const { data: empresa } = await db.from('crm_empresas').select('*').eq('id', p.empresa_id).maybeSingle();
  const bases = [...new Set(((p.itens as Linha[]) || []).map(i => String(i.codigo || '').replace(/\.\d+$/, '')).filter(Boolean))];
  const { data: regs } = bases.length ? await db.from('crm_fiscal_produtos').select('*').in('codigo', bases) : { data: [] };
  const regras: Record<string, Linha> = {}; (regs || []).forEach((r: Linha) => { regras[String(r.codigo)] = r; });
  // tabela do IBPT (tributos aproximados, Lei 12.741) pelo NCM de cada produto
  const ncms = [...new Set((regs || []).map((r: Linha) => String(r.ncm || '').replace(/\D/g, '')).filter(Boolean))];
  const { data: tib } = ncms.length ? await db.from('crm_ibpt').select('codigo, nac_fed, imp_fed, estadual, municipal, vig_fim, chave, versao, fonte').eq('ex', '').in('codigo', ncms) : { data: [] };
  const ibpt: Record<string, Linha> = {}; (tib || []).forEach((t: Linha) => { ibpt[String(t.codigo)] = t; });
  const { data: cfgRow } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
  const fiscal = ((cfgRow as Linha | null)?.dados as Linha | undefined)?.fiscal as Linha | undefined || {};
  if (!fiscal.emitente) throw new Error('falta configurar o emitente (aba Fiscal → Emissão)');
  const { data: vend } = p.vendedor_id ? await db.from('crm_usuarios').select('nome, nomes_nota, papel').eq('user_id', p.vendedor_id).maybeSingle() : { data: null };
  const v = vend as Linha | null;
  const vendedorNome = v ? (((v.nomes_nota as string[]) || [])[0] || String(v.nome).split(' ')[0]) : '';
  return { pedido: p, empresa: empresa as Linha, regras, fiscal, vendedorNome, ibpt };
}

// Dados para a nota que não é venda: a devolução vai com o XML da nota original (compra: bucket crm-compras-xml; venda: a
// nota emitida pelo CRM ou o XML guardado em crm-notas-xml); bonificação e entrega futura vão como o pedido.
// Devolução não passa do que a nota original tem, somando as devoluções já autorizadas (ou sem resposta) da mesma
// nota neste ambiente. O serviço fiscal confere item a item só contra a nota original; aqui entra o que já voltou.
async function limiteDevolucao(db: ReturnType<typeof createClient>, o: Linha, xml: string, amb: string) {
  const orig: Record<number, { q: number, d: string }> = {};
  for (const m of xml.matchAll(/<det\b[^>]*nItem="(\d+)"[^>]*>([\s\S]*?)<\/det>/g)) {
    const q = /<qCom>([^<]*)<\/qCom>/.exec(m[2]), d = /<xProd>([^<]*)<\/xProd>/.exec(m[2]);
    orig[Number(m[1])] = { q: Number(q ? q[1] : 0), d: d ? d[1] : '' };
  }
  const { data: irmas } = await db.from('crm_nfe_outras').select('id, itens').eq('ref_chave', String(o.ref_chave)).eq('tipo', String(o.tipo)).neq('id', String(o.id));
  const ids = ((irmas || []) as Linha[]).map(x => String(x.id));
  const { data: valem } = ids.length ? await db.from('crm_nfe').select('outra_id').in('outra_id', ids).eq('ambiente', amb).in('situacao', ['autorizada', 'pendente']) : { data: [] };
  const ok = new Set(((valem || []) as Linha[]).map(x => String(x.outra_id)));
  const ja: Record<number, number> = {};
  ((irmas || []) as Linha[]).filter(x => ok.has(String(x.id))).forEach(x => ((x.itens || []) as Linha[]).forEach(i => {
    ja[Number(i.nItem)] = (ja[Number(i.nItem)] || 0) + Number(i.quantidade || 0);
  }));
  const erros: string[] = [];
  ((o.itens || []) as Linha[]).filter(i => Number(i.quantidade) > 0).forEach(i => {
    const n = Number(i.nItem), it = orig[n], antes = ja[n] || 0;
    if (it && antes > 0 && Number(i.quantidade) + antes > it.q + 1e-9)
      erros.push('item ' + n + ' (' + it.d + '): a nota tem ' + it.q + ', já foram devolvidos ' + antes + ', sobram ' + Math.max(0, Math.round((it.q - antes) * 1e4) / 1e4));
  });
  if (erros.length) throw new Error('devolução acima do que falta devolver — ' + erros.join('; '));
}

async function dadosDaOutra(db: ReturnType<typeof createClient>, o: Linha, fiscal: Linha, amb: string, serie: number) {
  if (!fiscal.emitente) throw new Error('falta configurar o emitente (aba Fiscal → Emissão)');
  const base = { tipo: o.tipo, emitente: fiscal.emitente, ambiente: amb, serie, motivo: o.motivo || null, respTec: fiscal.respTec || null, ibscbs: fiscal.ibscbs, reforma: fiscal.reforma2027 || undefined };
  if (String(o.tipo).startsWith('devolucao_')) {
    const ch = String(o.ref_chave || '');
    if (!/^\d{44}$/.test(ch)) throw new Error('falta a chave da nota original');
    let xml = '';
    if (o.tipo === 'devolucao_fornecedor') {
      const { data: f } = await db.storage.from('crm-compras-xml').download(ch + '.xml');
      xml = f ? await f.text() : '';
    } else {
      const { data: e } = await db.from('crm_nfe').select('proc_xml').eq('chave', ch).eq('ambiente', 'producao').maybeSingle();
      xml = e && (e as Linha).proc_xml ? String((e as Linha).proc_xml) : '';
      if (!xml) { const { data: f } = await db.storage.from('crm-notas-xml').download('nfe/' + ch + '.xml'); xml = f ? await f.text() : ''; }
    }
    if (!xml) throw new Error('não achei o XML da nota original (' + ch + ')');
    await limiteDevolucao(db, o, xml, amb);
    return Object.assign(base, { xml, itens: o.itens || [] });
  }
  if (!o.pedido_id) throw new Error('a ' + (o.tipo === 'bonificacao' ? 'bonificação' : 'entrega futura') + ' sai de um pedido');
  const d = await dadosDoPedido(db, String(o.pedido_id));
  let ref = null;
  if (o.tipo === 'remessa_futura') {
    const { data: fats } = await db.from('crm_nfe_outras').select('id').eq('pedido_id', o.pedido_id).eq('tipo', 'faturamento_futuro');
    const ids = ((fats || []) as Linha[]).map(x => String(x.id));
    const { data: fat } = ids.length ? await db.from('crm_nfe').select('chave, numero, autorizada_em').in('outra_id', ids).eq('ambiente', amb).eq('situacao', 'autorizada')
      .order('autorizada_em', { ascending: false }).limit(1).maybeSingle() : { data: null };
    if (fat) ref = { chave: (fat as Linha).chave, numero: (fat as Linha).numero, emissao: (fat as Linha).autorizada_em };
    // Faturamento feito no FKN antes da virada (03/11/2026): a remessa referencia a chave que a pessoa informou.
    // A chave tem de ser de uma nota da própria empresa; se a nota estiver no CRM, tem de ser do mesmo cliente.
    const ch = String(o.ref_chave || '');
    if (!ref && /^\d{44}$/.test(ch)) {
      const cnpjEmit = String((fiscal.emitente as Linha)?.cnpj || '').replace(/\D/g, '');
      if (ch.slice(6, 20) !== cnpjEmit) throw new Error('a chave informada não é de uma nota da empresa (CNPJ ' + ch.slice(6, 20) + ')');
      const { data: nf } = await db.from('crm_notas').select('numero, emitida_em, empresa_id, cancelada').eq('chave', ch).maybeSingle();
      const n = nf as Linha | null;
      if (n && n.cancelada) throw new Error('a nota de simples faturamento informada está cancelada');
      if (n && n.empresa_id && d.empresa && String(n.empresa_id) !== String((d.empresa as Linha).id)) throw new Error('a nota de simples faturamento informada é de outro cliente');
      ref = { chave: ch, numero: n ? n.numero : Number(ch.slice(25, 34)), emissao: n ? n.emitida_em : null };
    }
  }
  return Object.assign(base, { pedido: d.pedido, empresa: d.empresa, regras: d.regras, vendedorNome: d.vendedorNome, cfg: d.fiscal, ibpt: d.ibpt, ref });
}

// ICMS-ST retido (CST 60) como o FKN informa: da nota mais recente de cada produto com CST 60, o valor POR UNIDADE
// vendida (vBCSTRet, pST, vICMSSubstituto, vICMSSTRet ÷ qCom), separado pela unidade (UN, CX…), em
// crm_fiscal_produtos.regra.st_ret. A nota do CRM multiplica pela quantidade (servico-fiscal/pedido.js).
async function aprenderSt(db: ReturnType<typeof createClient>) {
  const { data: am, error } = await db.rpc('crm_fiscal_st_amostras');
  if (error) throw new Error(error.message);
  const chaves = [...new Set(((am || []) as Linha[]).map(a => String(a.chave)))];
  const pega = (x: string, t: string) => ((new RegExp('<' + t + '>([^<]*)</' + t + '>').exec(x) || [])[1] ?? null);
  const achado: Record<string, Record<string, Linha & { quando: string }>> = {};
  let lidas = 0, semXml = 0;
  for (let i = 0; i < chaves.length; i += 6) {
    await Promise.all(chaves.slice(i, i + 6).map(async ch => {
      const r = await db.storage.from('crm-notas-xml').download('nfe/' + ch + '.xml');
      if (r.error) { semXml++; return; }
      const x = await r.data.text(); lidas++;
      const quando = pega(x, 'dhEmi') || '', numero = pega(x, 'nNF');
      for (const m of x.matchAll(/<det nItem="\d+">([\s\S]*?)<\/det>/g)) {
        const d = m[1], g = (/<ICMS60>([\s\S]*?)<\/ICMS60>/.exec(d) || /<ICMSSN500>([\s\S]*?)<\/ICMSSN500>/.exec(d) || [])[1];
        if (!g) continue;
        const cod = String(pega(d, 'cProd') || '').replace(/\.\d+$/, ''), un = String(pega(d, 'uCom') || 'UN').toUpperCase(), q = Number(pega(d, 'qCom')) || 0;
        if (!cod || !(q > 0) || pega(g, 'vBCSTRet') == null) continue;
        const ja = achado[cod]?.[un];
        if (ja && ja.quando >= quando) continue;
        const por = (t: string) => { const v = pega(g, t); return v == null ? null : Math.round(Number(v) / q * 1e6) / 1e6; };
        (achado[cod] = achado[cod] || {})[un] = { vBCSTRet: por('vBCSTRet'), pST: Number(pega(g, 'pST')) || 0, vICMSSubstituto: por('vICMSSubstituto'), vICMSSTRet: por('vICMSSTRet'),
          nota: numero, quando };
      }
    }));
  }
  const cods = Object.keys(achado);
  let gravados = 0;
  for (let i = 0; i < cods.length; i += 100) {
    const { data: ps } = await db.from('crm_fiscal_produtos').select('codigo, regra').in('codigo', cods.slice(i, i + 100));
    for (const p of (ps || []) as Linha[]) {
      const regra = Object.assign({}, (p.regra as Linha) || {}, { st_ret: Object.assign({}, ((p.regra as Linha) || {}).st_ret as Linha || {}, achado[String(p.codigo)]) });
      const { error: e2 } = await db.from('crm_fiscal_produtos').update({ regra }).eq('codigo', p.codigo);
      if (!e2) gravados++;
    }
  }
  return { notas: chaves.length, lidas, semXml, produtos: gravados };
}

const ambienteDe = (fiscal: Linha) => (fiscal.ambiente === 'producao' ? 'producao' : 'homologacao');

// ------------------------------------------------------------------ notas de COMPRA pela Sefaz (servico-fiscal/dfe.js)
// Sempre no ambiente de PRODUÇÃO (são as notas de verdade dos fornecedores; consultar não emite nada). Continua do
// último NSU guardado e respeita a espera de 1 hora da Sefaz (crm_dfe_estado.proxima_em): até 5 consultas por vez,
// e quando acabou (137 ou ultNSU = maxNSU) só volta a consultar depois de 1 hora. O resumo vai para crm_dfe; o XML
// completo (depois da Ciência da Operação) para o bucket crm-compras-xml.
const HORA = 61 * 60000;
async function dfeBuscar(db: ReturnType<typeof createClient>, fiscal: Linha) {
  const cnpj = String(((fiscal.emitente as Linha) || {}).cnpj || '').replace(/\D/g, '');
  if (cnpj.length !== 14) throw new Error('falta configurar o emitente (aba Fiscal → Emissão): o CNPJ da empresa é o destinatário das notas de compra');
  const { data: est0 } = await db.from('crm_dfe_estado').select('*').eq('id', 1).maybeSingle();
  const est = (est0 as Linha | null) || { id: 1, ult_nsu: 0, max_nsu: 0 };
  if (est.proxima_em && Date.parse(String(est.proxima_em)) > Date.now()) return { espera: est.proxima_em, ult_nsu: est.ult_nsu, max_nsu: est.max_nsu, ultimo_motivo: est.ultimo_motivo };
  let ult = Number(est.ult_nsu || 0), max = Number(est.max_nsu || 0), cstat: number | null = null, motivo: string | null = null, proxima = new Date(Date.now() + 3 * 60000).toISOString();
  const cont = { resumos: 0, notas: 0, eventos: 0 };
  for (let i = 0; i < 5; i++) {
    const r = await servico('/dfe', { ambiente: 'producao', cnpj, ultNSU: ult });
    cstat = Number(r.cStat); motivo = r.xMotivo || null;
    if (cstat === 138) {
      for (const d of (r.docs || []) as Linha[]) await guardaDoc(db, d, cont);
      ult = Number(r.ultNSU || ult); max = Number(r.maxNSU || max);
      if (ult >= max) { proxima = new Date(Date.now() + HORA).toISOString(); break; }
      continue;
    }
    if (cstat === 137) { ult = Number(r.ultNSU || ult); max = Number(r.maxNSU || max); }
    proxima = new Date(Date.now() + HORA).toISOString();   // 137 (nada novo), 656 (consumo indevido) ou outro: 1 hora
    break;
  }
  await db.from('crm_dfe_estado').upsert({ id: 1, ult_nsu: ult, max_nsu: max, proxima_em: proxima, ultimo_cstat: cstat, ultimo_motivo: motivo, ultima_em: new Date().toISOString() });
  const ciencias = fiscal.dfe_ciencia === true ? await dfeCiencias(db, fiscal, null) : null;
  return Object.assign({ ult_nsu: ult, max_nsu: max, proxima_em: proxima, cstat, motivo, ciencias }, cont);
}
async function guardaDoc(db: ReturnType<typeof createClient>, d: Linha, cont: Record<string, number>) {
  const ch = String(d.chave || '');
  if (!/^\d{44}$/.test(ch)) return;
  const agora = new Date().toISOString();
  if (d.tipo === 'evento') {
    cont.eventos++;
    if (d.cancelada) await db.from('crm_dfe').update({ situacao: 'cancelada', atualizado_em: agora }).eq('chave', ch);
    return;
  }
  if (d.tipo !== 'resumo' && d.tipo !== 'nota') return;
  const linha: Linha = { chave: ch, nsu: d.nsu, emitente_doc: d.emitente_doc || null, emitente_nome: d.emitente_nome || null, emitida_em: d.emitida_em || null,
    valor: d.valor ?? null, tp_nf: d.tp_nf ?? null, protocolo: d.protocolo || null, atualizado_em: agora };
  if (d.tipo === 'resumo') { cont.resumos++; linha.situacao = d.situacao || 'autorizada'; }
  if (d.tipo === 'nota' && d.xml) {
    const up = await db.storage.from('crm-compras-xml').upload(ch + '.xml', new Blob([String(d.xml)], { type: 'text/xml' }), { upsert: true, contentType: 'text/xml' });
    if (!up.error) { linha.xml_em = agora; cont.notas++; }
  }
  await db.from('crm_dfe').upsert(linha, { onConflict: 'chave' });
}
// Ciência da Operação (o "fiquei sabendo" da nota; libera o XML completo na próxima consulta). Só das autorizadas, de
// entrada (tpNF 1 = saída do fornecedor), ainda sem XML e sem ciência; até 20 por vez (limite da Sefaz por hora).
async function dfeCiencias(db: ReturnType<typeof createClient>, fiscal: Linha, chaves: string[] | null) {
  const cnpj = String(((fiscal.emitente as Linha) || {}).cnpj || '').replace(/\D/g, '');
  let q = db.from('crm_dfe').select('chave').eq('situacao', 'autorizada').is('xml_em', null).is('manifestada_em', null).order('emitida_em', { ascending: false }).limit(20);
  if (chaves) q = q.in('chave', chaves);
  const { data } = await q;
  let ok = 0, falha = 0;
  for (const r of (data || []) as Linha[]) {
    try {
      const ev = await servico('/ciencia', { ambiente: 'producao', cnpj, chave: r.chave });
      await db.from('crm_dfe').update({ manifestada_em: ev.ok ? new Date().toISOString() : null, manifesto_cstat: ev.cStat, manifesto_motivo: ev.xMotivo, atualizado_em: new Date().toISOString() }).eq('chave', r.chave);
      if (ev.ok) ok++; else falha++;
    } catch (e) { falha++; await db.from('crm_dfe').update({ manifesto_motivo: e instanceof Error ? e.message : String(e) }).eq('chave', r.chave); }
  }
  return { ok, falha };
}

// Resposta definitiva a uma nota de compra (19/10/2026): confirmacao | desconhecimento | nao_realizada (com justificativa).
const CONCLUSIVAS = ['confirmacao', 'desconhecimento', 'nao_realizada'];
async function dfeManifestar(db: ReturnType<typeof createClient>, fiscal: Linha, chave: string, tipo: string, justificativa: string, eu: string) {
  if (!/^\d{44}$/.test(chave)) throw new Error('chave inválida');
  if (!CONCLUSIVAS.includes(tipo)) throw new Error('resposta desconhecida');
  const { data: n } = await db.from('crm_dfe').select('chave, situacao, conclusiva_tipo').eq('chave', chave).maybeSingle();
  if (!n) throw new Error('nota de compra não encontrada');
  if ((n as Linha).conclusiva_tipo) throw new Error('esta nota já tem resposta definitiva');
  const cnpj = String(((fiscal.emitente as Linha) || {}).cnpj || '').replace(/\D/g, '');
  const ev = await servico('/manifestar', { ambiente: 'producao', cnpj, chave, tipo, justificativa: justificativa || null });
  const agora = new Date().toISOString();
  await db.from('crm_dfe').update(ev.ok ? { conclusiva_tipo: tipo, conclusiva_em: agora, conclusiva_cstat: ev.cStat, conclusiva_motivo: ev.xMotivo, conclusiva_por: eu, atualizado_em: agora }
    : { conclusiva_cstat: ev.cStat, conclusiva_motivo: ev.xMotivo, atualizado_em: agora }).eq('chave', chave);
  return ev;
}

async function gravaResultado(db: ReturnType<typeof createClient>, nfeId: string, r: Linha, eu: string) {
  const patch: Linha = { situacao: r.situacao === 'pendente' ? 'pendente' : r.situacao === 'bloqueada' ? 'bloqueada' : r.situacao, atualizado_em: new Date().toISOString() };
  for (const [k, c] of [['chave', 'chave'], ['cStat', 'cstat'], ['motivo', 'motivo'], ['protocolo', 'protocolo'], ['nfeXml', 'nfe_xml'], ['procXml', 'proc_xml'], ['totais', 'totais'], ['avisos', 'avisos'], ['nota', 'nota']] as const)
    if (r[k] !== undefined && r[k] !== null) patch[c] = r[k];
  if (r.situacao === 'autorizada') { patch.autorizada_em = r.recebido || new Date().toISOString(); }
  if (r.totais) patch.valor = (r.totais as Linha).vNF;
  const { data } = await db.from('crm_nfe').update(patch).eq('id', nfeId).select().single();
  const nfe = data as Linha;
  await lancaGnre(db, nfe).catch(() => null);
  // Homologação (teste, sem valor fiscal) NUNCA entra no CRM: nem estoque, nem título, nem comissão; o pedido não muda.
  if (nfe && nfe.ambiente === 'producao' && nfe.situacao === 'autorizada' && nfe.proc_xml && !nfe.nota_id) {
    const ent = await entregaAoCrm(db, 'NFe' + nfe.chave + '-procNFe.xml', String(nfe.proc_xml));
    const { data: nota } = await db.from('crm_notas').select('id').eq('chave', nfe.chave).maybeSingle();
    if (nota) {
      await db.from('crm_nfe').update({ nota_id: (nota as Linha).id }).eq('id', nfeId);
      if (nfe.pedido_id) await db.from('crm_pedidos').update({ situacao: 'faturado', nota_id: (nota as Linha).id, faturado_em: new Date().toISOString(), atualizado_por: eu, atualizado_em: new Date().toISOString() }).eq('id', nfe.pedido_id);
    }
    return Object.assign({}, nfe, { nota_id: nota ? (nota as Linha).id : null, entrega: ent });
  }
  return nfe;
}
// DIFAL (23/10/2026): nota de produção autorizada para consumidor de outra UF vira a conta da guia GNRE no Caixa (paga
// antes de a mercadoria sair; a guia acompanha a nota). Uma por nota: a chave fica na descrição.
async function lancaGnre(db: ReturnType<typeof createClient>, nfe: Linha | null) {
  const t = (nfe && nfe.totais) as Linha | undefined;
  if (!nfe || nfe.ambiente !== 'producao' || nfe.situacao !== 'autorizada' || !t) return;
  const valor = Math.round((Number(t.vICMSUFDest || 0) + Number(t.vFCPUFDest || 0)) * 100) / 100;
  if (!(valor > 0)) return;
  const dest = (((nfe.nota || {}) as Linha).dest || {}) as Linha, uf = String(((dest.endereco || {}) as Linha).uf || 'UF de destino').toUpperCase();
  const desc = 'GNRE DIFAL ' + uf + ' - NF ' + nfe.serie + '-' + nfe.numero + ' (' + nfe.chave + ')';
  const { data: ja } = await db.from('crm_fin_lancamentos').select('id').eq('descricao', desc).maybeSingle();
  if (ja) return;
  await db.from('crm_fin_lancamentos').insert({ tipo: 'saida', descricao: desc, fornecedor: 'Sefaz-' + uf + ' (GNRE)', categoria: 'Impostos', valor,
    vencimento: new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10), situacao: 'aberto', origem: 'tela',
    observacoes: 'ICMS DIFAL de venda a consumidor final não contribuinte de outra UF (EC 87/2015, LC 190/2022): pagar a GNRE antes de a mercadoria sair; a guia acompanha a nota.' });
}
const semXml = (n: Linha | null) => n && Object.assign({}, n, { nfe_xml: undefined, proc_xml: n.proc_xml ? true : false });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: quem } = await comoUsuario.auth.getUser();
  if (!quem?.user) return resposta(401, { erro: 'faça login' });
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: euRow } = await db.from('crm_usuarios').select('papel, ativo, nome').eq('user_id', quem.user.id).maybeSingle();
  const eu = euRow as Linha | null;
  let b: Linha;
  try { b = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  const ehDfe = /^dfe_/.test(String(b.acao || ''));
  if (!eu || !eu.ativo) return resposta(403, { erro: 'usuário inativo' });
  if (ehDfe ? !DFE.includes(String(eu.papel)) : !EMITE.includes(String(eu.papel))) return resposta(403, { erro: ehDfe ? 'as notas de compra são do administrador e do comprador' : 'só a logística, a gestora e o administrador emitem nota' });
  try {
    const acao = String(b.acao || '');
    if (acao === 'saude') return resposta(200, await servico('/saude', null, 'GET'));
    const { data: cfgRow } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
    const fiscal = ((cfgRow as Linha | null)?.dados as Linha | undefined)?.fiscal as Linha | undefined || {};
    const amb = ambienteDe(fiscal), serie = Number(fiscal.serie ?? 2);
    // status: o da emissão atual, ou o da produção antes da virada (só consulta; nada é emitido)
    if (acao === 'status') {
      const a = b.ambiente === 'producao' || b.ambiente === 'homologacao' ? String(b.ambiente) : amb;
      return resposta(200, Object.assign(await servico('/status', { ambiente: a }), { ambiente: a }));
    }
    if (acao === 'dfe_buscar') return resposta(200, await dfeBuscar(db, fiscal));
    if (acao === 'dfe_ciencia') {
      // 27/10/2026 (pedido do Anderson): o comprador também dá a ciência
      if (!DFE.includes(String(eu.papel))) throw new Error('só o administrador ou o comprador dá a ciência das notas de compra');
      return resposta(200, await dfeCiencias(db, fiscal, b.chave ? [String(b.chave)] : null));
    }
    if (acao === 'dfe_manifestar') {
      // 27/10/2026 (pedido do Anderson): o comprador cuida das notas de compra do começo ao fim, inclusive a resposta definitiva
      if (!DFE.includes(String(eu.papel))) throw new Error('só o administrador ou o comprador responde à Sefaz pelas notas de compra');
      return resposta(200, await dfeManifestar(db, fiscal, String(b.chave || ''), String(b.tipo || ''), String(b.justificativa || ''), quem.user.id));
    }
    if (acao === 'aprender_st') {
      if (eu.papel !== 'admin') throw new Error('só o administrador');
      return resposta(200, await aprenderSt(db));
    }

    if (acao === 'ibpt_atualizar') {
      if (eu.papel !== 'admin') return resposta(403, { erro: 'só o administrador atualiza a tabela do IBPT' });
      return resposta(200, await ibptAtualizar(db, fiscal, true));
    }
    if (acao === 'previa' || acao === 'emitir') {
      const d = await dadosDoPedido(db, String(b.pedido_id));
      // tabela do IBPT vencida ou sem algum NCM do pedido: atualiza sozinha (uma tentativa por dia), sem segurar a nota
      if (Deno.env.get('IBPT_TOKEN')) {
        const hoje = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
        const faltam = Object.values(d.regras || {}).map(r => String((r as Linha).ncm || '').replace(/\D/g, '')).filter(n => n.length === 8 && (!d.ibpt[n] || String(d.ibpt[n].vig_fim || '') < hoje));
        if (faltam.length) {
          const { data: ult } = await db.from('crm_sistema').select('quando').eq('chave', 'ibpt').maybeSingle();
          const tentou = ult ? new Date(new Date(String((ult as Linha).quando)).getTime() - 3 * 36e5).toISOString().slice(0, 10) : '';
          if (tentou !== hoje) {
            await db.from('crm_sistema').upsert({ chave: 'ibpt', valor: JSON.stringify({ ok: false, em: new Date().toISOString(), erro: 'atualizando…' }), quem: null, quando: new Date().toISOString() });
            const tarefa = ibptAtualizar(db, fiscal, false).catch(() => null);
            const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
            if (rt) rt.waitUntil(tarefa); else await tarefa;
          }
        }
      }
      const corpo = { pedido: d.pedido, empresa: d.empresa, regras: d.regras, emitente: d.fiscal.emitente, ambiente: amb, serie, vendedorNome: d.vendedorNome, cfg: d.fiscal, ibpt: d.ibpt };
      if (acao === 'previa') return resposta(200, Object.assign(await servico('/previa-pedido', corpo), { ambiente: amb, serie }));
      const { data: res, error } = await db.rpc('crm_nfe_reservar', { p_ambiente: amb, p_serie: serie, p_pedido: d.pedido.id, p_empresa: d.pedido.empresa_id });
      if (error) throw new Error(error.message);
      const nfe = res as Linha;
      await db.from('crm_nfe').update({ criado_por: quem.user.id }).eq('id', nfe.id).is('criado_por', null);
      let r: Linha;
      try { r = await servico('/emitir-pedido', Object.assign(corpo, { numero: nfe.numero })); }
      catch (e) { await db.from('crm_nfe').update({ situacao: 'pendente', motivo: 'sem resposta do serviço fiscal: ' + (e as Error).message }).eq('id', nfe.id); throw e; }
      return resposta(200, { nfe: semXml(await gravaResultado(db, String(nfe.id), r, quem.user.id)) });
    }

    // Notas que não são venda (Fase 4b, 22/10/2026): o rascunho em crm_nfe_outras diz o tipo, a nota de origem e os itens.
    if (acao === 'outra_previa' || acao === 'outra_emitir') {
      const { data: oRow } = await db.from('crm_nfe_outras').select('*').eq('id', String(b.outra_id || '')).maybeSingle();
      const o = oRow as Linha | null;
      if (!o) throw new Error('rascunho da nota não encontrado');
      if (o.situacao !== 'rascunho' && acao === 'outra_emitir') throw new Error('esta nota já foi ' + o.situacao);
      const corpo = await dadosDaOutra(db, o, fiscal, amb, serie);
      if (acao === 'outra_previa') return resposta(200, Object.assign(await servico('/previa-outra', corpo), { ambiente: amb, serie }));
      const { data: res, error } = await db.rpc('crm_nfe_reservar_outra', { p_ambiente: amb, p_serie: serie, p_outra: o.id });
      if (error) throw new Error(error.message);
      const nfe = res as Linha;
      await db.from('crm_nfe').update({ criado_por: quem.user.id }).eq('id', nfe.id).is('criado_por', null);
      let r: Linha;
      try { r = await servico('/emitir-outra', Object.assign(corpo, { numero: nfe.numero })); }
      catch (e) { await db.from('crm_nfe').update({ situacao: 'pendente', motivo: 'sem resposta do serviço fiscal: ' + (e as Error).message }).eq('id', nfe.id); throw e; }
      const g = await gravaResultado(db, String(nfe.id), r, quem.user.id);
      if (g && g.situacao === 'autorizada') await db.from('crm_nfe_outras').update({ situacao: 'emitida', nfe_id: g.id }).eq('id', o.id);
      // estoque e financeiro das devoluções (só produção; uma vez só)
      if (g && g.situacao === 'autorizada' && g.ambiente === 'producao') await db.rpc('crm_nfe_outra_efeitos', { p_nfe: g.id });
      return resposta(200, { nfe: semXml(g) });
    }

    const { data: nfeRow } = b.nfe_id ? await db.from('crm_nfe').select('*').eq('id', b.nfe_id).maybeSingle() : { data: null };
    const nfe = nfeRow as Linha | null;
    const emitente = fiscal.emitente as Linha | undefined;
    if (acao === 'consultar') {
      if (!nfe || !nfe.chave) throw new Error('nota sem chave para consultar');
      const r = await servico('/consultar', { ambiente: nfe.ambiente, chave: nfe.chave, nfeXml: nfe.nfe_xml });
      if (r.situacao === 'rejeitada' && Number(r.cStat) === 217 && nfe.situacao === 'pendente' && nfe.nfe_xml) {   // a Sefaz não tem a nota: reenvia o MESMO XML
        return resposta(200, { nfe: semXml(await gravaResultado(db, String(nfe.id), await servico('/reenviar', { ambiente: nfe.ambiente, chave: nfe.chave, nfeXml: nfe.nfe_xml }), quem.user.id)) });
      }
      return resposta(200, { nfe: semXml(await gravaResultado(db, String(nfe.id), Object.assign(r, { nfeXml: undefined }), quem.user.id)) });
    }
    if (acao === 'xml') {
      if (!nfe) throw new Error('nota não encontrada');
      return resposta(200, { proc_xml: nfe.proc_xml, nfe_xml: nfe.situacao === 'autorizada' ? null : nfe.nfe_xml });
    }
    if (acao === 'cancelar' || acao === 'cce') {
      if (!nfe || nfe.situacao !== 'autorizada') throw new Error('só nota autorizada');
      if (acao === 'cancelar' && !CANCELA.includes(String(eu.papel))) throw new Error('só a logística, a gestora ou o administrador cancela nota');
      const evs = (nfe.eventos as Linha[]) || [];
      const seq = acao === 'cce' ? evs.filter(e => e.tipo === 'cce').length + 1 : 1;
      const r = acao === 'cancelar'
        ? await servico('/cancelar', { ambiente: nfe.ambiente, cnpj: emitente?.cnpj, chave: nfe.chave, protocolo: nfe.protocolo, justificativa: b.texto })
        : await servico('/cce', { ambiente: nfe.ambiente, cnpj: emitente?.cnpj, chave: nfe.chave, seq, correcao: b.texto });
      const ok = [135, 136, 155].includes(Number(r.eventoStat));
      // o XML do evento (procEventoNFe) fica guardado: vai ao contador no fechamento do mês
      const procEv = ok && r.eventoXml && r.retEvento ? '<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">' + r.eventoXml + r.retEvento + '</procEventoNFe>' : null;
      const ev = { tipo: acao, seq, quando: new Date().toISOString(), cstat: r.eventoStat ?? r.cStat, motivo: r.eventoMotivo ?? r.xMotivo, protocolo: ok ? r.protocolo : null, texto: b.texto, por: quem.user.id, xml: procEv };
      const patch: Linha = { eventos: evs.concat([ev]), atualizado_em: new Date().toISOString() };
      if (ok && acao === 'cancelar') patch.situacao = 'cancelada';
      await db.from('crm_nfe').update(patch).eq('id', nfe.id);
      if (ok && acao === 'cancelar' && nfe.ambiente === 'producao') {
        await entregaAoCrm(db, 'NFe' + nfe.chave + '-canc.xml', String(procEv));
        if (nfe.pedido_id) await db.from('crm_pedidos').update({ situacao: 'separado', nota_id: null, faturado_em: null, atualizado_em: new Date().toISOString() }).eq('id', nfe.pedido_id);
      }
      return resposta(200, { ok, evento: Object.assign({}, ev, { xml: undefined }) });
    }
    if (acao === 'inutilizar') {
      if (!CANCELA.includes(String(eu.papel))) throw new Error('só a logística, a gestora ou o administrador inutiliza numeração');  // 21/10/2026: logística também (pedido do Anderson)
      const s = Number(b.serie ?? serie), de = Number(b.de), ate = Number(b.ate);
      if (!(de > 0) || !(ate >= de) || ate - de > 9999) throw new Error('faixa de números inválida');
      if (String(b.texto || '').trim().length < 15) throw new Error('a justificativa precisa de pelo menos 15 letras');
      // número usado de verdade (autorizada, cancelada, denegada ou sem resposta) não se inutiliza
      const { data: usados } = await db.from('crm_nfe').select('numero, situacao').eq('ambiente', amb).eq('serie', s).gte('numero', de).lte('numero', ate)
        .in('situacao', ['autorizada', 'cancelada', 'denegada', 'pendente']).is('inutilizada_em', null);
      if ((usados || []).length) throw new Error('a faixa tem nota usada: ' + (usados as Linha[]).map(u => 'NF ' + u.numero + ' (' + u.situacao + ')').join(', '));
      const r = await servico('/inutilizar', { ambiente: amb, cnpj: emitente?.cnpj, ano: new Date().getFullYear(), serie: s, de, ate, justificativa: b.texto });
      const ok = Number(r.cStat) === 102;
      await db.from('crm_nfe_inutilizacoes').insert({ ambiente: amb, serie: s, de, ate, justificativa: b.texto, cstat: r.cStat, motivo: r.xMotivo, protocolo: r.protocolo, xml: r.procInut || null, criado_por: quem.user.id });
      if (ok) {
        const agora = new Date().toISOString();
        await db.from('crm_nfe').update({ inutilizada_em: agora, atualizado_em: agora }).eq('ambiente', amb).eq('serie', s).gte('numero', de).lte('numero', ate).is('inutilizada_em', null);
        // a numeração pula a faixa (inutilizar números à frente do próximo)
        const { data: nr } = await db.from('crm_nfe_numeracao').select('proximo').eq('ambiente', amb).eq('serie', s).maybeSingle();
        if (!nr) await db.from('crm_nfe_numeracao').insert({ ambiente: amb, serie: s, proximo: ate + 1 });
        else if (Number((nr as Linha).proximo) <= ate) await db.from('crm_nfe_numeracao').update({ proximo: ate + 1 }).eq('ambiente', amb).eq('serie', s);
      }
      return resposta(200, { ok, cStat: r.cStat, motivo: r.xMotivo });
    }
    return resposta(400, { erro: 'ação desconhecida' });
  } catch (e) {
    return resposta(422, { erro: e instanceof Error ? e.message : String(e) });
  }
});
