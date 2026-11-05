// Edge Function crm-fiscal — o CRM emite NF-e (Fase 4 da saída do FKN, 16/10/2026).
// O navegador chama esta função (com o login de quem clicou); ela confere o papel, junta do banco o pedido, o cliente,
// as regras fiscais e o emitente, reserva o número (crm_nfe_reservar) e manda ao SERVIÇO FISCAL na VPS
// (servico-fiscal/, que assina com o A1 e fala com a Sefaz-SP). A nota autorizada entra no CRM pelo mesmo caminho do
// vigia (crm-notas): estoque, títulos das parcelas, comissão, XML guardado.
// Secrets: FISCAL_URL (https://fiscal.oneclean.com.br) e FISCAL_TOKEN (gerado na VPS; ver servico-fiscal/INSTALAR.md).
// Notas de COMPRA (dfe_buscar, dfe_ciencia, dfe_manifestar): administrador e comprador, do começo ao fim (27/10/2026,
// pedido do Anderson): busca, ciência e a resposta definitiva (confirmação, desconhecimento, operação não realizada).
// Consulta cadastro (acao 'cadastro', 30/10/2026): a inscrição estadual do cliente pela Sefaz-SP, para o cadastro do cliente;
// todo usuário ativo que cadastra cliente (não o motorista). Só leitura; o serviço fiscal consulta sempre em produção.
// Deploy: verify_jwt LIGADO.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { ibptUrl, ibptLinha, ibptPrecisa } from './ibpt.js';
import { destinatarios, separaEmails, assunto, texto, html, arquivos, proporcaoPng } from './email-nota.js';
import { jsPDF } from 'npm:jspdf@2.5.2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const EMITE = ['admin', 'gestor', 'logistica'], CANCELA = ['admin', 'gestor', 'logistica'], DFE = ['admin', 'comprador'];
type Linha = Record<string, unknown>;
// A DANFE do e-mail ao cliente (04/11/2026) é desenhada aqui pelo MESMO danfe.js do site, baixado do GitHub na versão fixada
// (node ferramentas/fixa-motor-notas.js troca o commit e o SHA-256; depois, publicar esta função de novo).
const COMMIT = '2fe4fe942de1d176f7309e6e08a438464ce1b98e';
const HASHES: Record<string, string> = { 'danfe.js': '451328cf4a5bb951c178c535e124209369238a10ec5050dfc9e158c0c8472f3e', 'regras.js': 'b28565b3534d4dd4d1af2c487673dcc3e326c59066deba7bf545ca8c2418c7c3', 'cobranca.js': 'fec5e59ff21b7075c592133e54011e204c2cde65e9e29e3ef986cfb21f6df8dd', 'boleto.js': 'a4d5a17b2adffb76049727c715007b28dfb64d7ea3e70e9e24823c1b8efd5f92', 'vendor/qrcode.js': '18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780' };
// (05/11/2026) o boleto do e-mail é o MESMO desenho que a logística imprime: regras.js + cobranca.js (linha digitável) +
// boleto.js + vendor/qrcode.js (QR do Pix), na mesma versão fixada; os SHA-256 entram pelo ferramentas/fixa-motor-notas.js
const FONTE = 'https://raw.githubusercontent.com/sistemidalessi/crm-oneclean/' + COMMIT + '/';
const EMPRESA = Deno.env.get('CRM_EMPRESA_NOME') ?? 'OneClean';
const LOGO = Deno.env.get('CRM_LOGO') ?? 'assets/oneclean-logo.png';
// as cores do config.js do site (cores.principal e cores.destaque), as mesmas da DANFE que a logística imprime
const CORES = { principal: Deno.env.get('CRM_COR_PRINCIPAL') ?? '#175b6d', destaque: Deno.env.get('CRM_COR_DESTAQUE') ?? '#a9c451' };

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
  const fiscal = semAvisoNaNota(((cfgRow as Linha | null)?.dados as Linha | undefined)?.fiscal as Linha | undefined || {});
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
  return Object.assign(base, { pedido: d.pedido, empresa: cabeNoXml(d.empresa as Linha), regras: d.regras, vendedorNome: d.vendedorNome, cfg: d.fiscal, ibpt: d.ibpt, ref });
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

// Aviso contra boleto falso (02/11/2026, Anderson: "muita poluição visual na nota… só no boleto"): o texto gravado em
// fiscal.aviso_golpe continua no boleto, nas mensagens e no e-mail de cobrança, mas NÃO vai mais para o XML da nota (o serviço
// fiscal o punha nas informações complementares). Para voltar a pôr na nota: fiscal.aviso_na_nota = true.
const semAvisoNaNota = (f: Linha): Linha => { const c = Object.assign({}, f); if (c.aviso_na_nota !== true) delete c.aviso_golpe; return c; };
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

// ------------------------------------------------------------------ e-mail da nota ao cliente (XML + DANFE)
// deno-lint-ignore no-explicit-any
let DAN: any = null, LOGO_DANFE: Linha | null | undefined;
async function carregaDanfe() {
  if (DAN) return DAN;
  const r = await fetch(FONTE + 'danfe.js');
  if (!r.ok) throw new Error('não baixou danfe.js (' + r.status + ')');
  const codigo = await r.text();
  if (await sha256(codigo) !== HASHES['danfe.js']) throw new Error('danfe.js não confere com a versão fixada');
  // deno-lint-ignore no-explicit-any
  const g: any = {};
  new Function('module', 'require', 'globalThis', 'window', codigo)(undefined, undefined, g, g);
  DAN = g.CRMDanfe;
  return DAN;
}
const base64 = (buf: ArrayBuffer | Uint8Array) => { const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
async function logoDanfe() {
  if (LOGO_DANFE !== undefined) return LOGO_DANFE;
  try {
    const r = await fetch(FONTE + LOGO);
    const u = new Uint8Array(await r.arrayBuffer());
    const prop = r.ok ? proporcaoPng(u) : 0;
    LOGO_DANFE = prop ? { data: 'data:image/png;base64,' + base64(u), formato: 'PNG', proporcao: prop } : null;
  } catch { LOGO_DANFE = null; }
  return LOGO_DANFE;
}
// carrega um arquivo do site na versão fixada (conferido pelo SHA-256) dentro do objeto g (o "window" do arquivo)
async function carregaJs(nome: string, g: Linha) {
  const r = await fetch(FONTE + nome);
  if (!r.ok) throw new Error('não baixou ' + nome + ' (' + r.status + ')');
  const codigo = await r.text();
  if (!HASHES[nome] || await sha256(codigo) !== HASHES[nome]) throw new Error(nome + ' não confere com a versão fixada');
  const m: Linha = { exports: {} };
  new Function('module', 'exports', 'require', 'define', 'globalThis', 'window', codigo)(m, m.exports, undefined, undefined, g, g);
  return m.exports;
}
// deno-lint-ignore no-explicit-any
let BOL: any = null, QR: any = null;
async function carregaBoleto() {
  if (BOL) return BOL;
  const g: Linha = {};
  g.CRMRegras = await carregaJs('regras.js', g);       // o cobranca.js pede ao "window" o CRMRegras
  g.CRMCobranca = await carregaJs('cobranca.js', g);   // e o boleto.js, o CRMCobranca (linha digitável)
  BOL = await carregaJs('boleto.js', g);
  try { QR = await carregaJs('vendor/qrcode.js', {}); } catch (e) { console.error('[crm-fiscal] qrcode: ' + (e as Error).message); QR = null; }
  return BOL;
}
// a duplicata das parcelas da nota: "002862/01" na série 1 (a numeração do FKN) e "2-000012/01" nas outras
const prefixoDup = (n: Linha) => (Number(n.serie) === 1 ? '' : String(n.serie || '') + '-') + String(n.numero).padStart(6, '0') + '/';
// boletos da nota: os já registrados no BB e quantos ainda vão ser (título a registrar, ou preparado e não registrado)
async function boletosDaNota(db: ReturnType<typeof createClient>, n: Linha) {
  const { data: cfgL } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
  const dados = ((cfgL as Linha | null)?.dados || {}) as Linha, b = (dados.boleto || {}) as Linha;
  if (!b.ligado || b.caminho !== 'api') return { registrados: [] as Linha[], pendentes: 0, dados };
  const pre = prefixoDup(n);
  const { data: rows } = await db.from('crm_boletos_bb').select('duplicata, nosso_numero, documento, valor, vencimento, emissao, situacao, retorno')
    .like('duplicata', pre + '%').in('situacao', ['preparado', 'registrado']).order('duplicata');
  const l = (rows || []) as Linha[];
  const { data: falta } = await db.rpc('crm_boleto_bb_a_registrar');
  const aReg = ((falta || []) as string[]).filter(d => String(d).startsWith(pre)).length;
  return { registrados: l.filter(x => x.situacao === 'registrado'), pendentes: aReg + l.filter(x => x.situacao === 'preparado').length, dados };
}
// o PDF dos boletos (uma página por parcela), com o pagador do destinatário da nota
async function pdfBoletosNota(regs: Linha[], xml: string, dados: Linha) {
  const B = await carregaBoleto(), Dn = await carregaDanfe();
  const d = Dn.ler(xml) || {};
  const dest = (d.destinatario || {}) as Linha;
  const pg = { nome: String(dest.nome || ''), doc: dest.doc, endereco: dest.endereco };
  const cfg = (dados.boleto || {}) as Linha, fis = (dados.fiscal || {}) as Linha, emit = (fis.emitente || {}) as Linha;
  const aviso = B.avisoGolpe(emit, fis.aviso_golpe, cfg.convenio ? '001 (Banco do Brasil)' : '');
  const hoje = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  regs.forEach((b, i) => {
    if (i) pdf.addPage('a4', 'portrait');
    const pix = B.pixDe(b);
    const dd = B.montar(cfg, emit, { valor: b.valor, vencimento: b.vencimento, nosso_numero: b.nosso_numero, documento: b.documento, emissao: b.emissao, pix }, pg, { hoje });
    B.desenha(pdf, dd, { aviso, qr: pix && QR ? B.qrDesenhador(QR, pix) : null });
  });
  return new Uint8Array(pdf.output('arraybuffer'));
}
async function pdfDanfe(xml: string) {
  const Dn = await carregaDanfe();
  const d = Dn.ler(xml);
  if (!d) throw new Error('não li o XML da nota para a DANFE');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  Dn.desenha(pdf, d, { logo: await logoDanfe(), cores: CORES });
  return new Uint8Array(pdf.output('arraybuffer'));
}
// Manda o XML e a DANFE da nota de PRODUÇÃO autorizada ao cliente: ao "E-mail para a nota fiscal" do cadastro (vazio: o e-mail
// da empresa). Sozinha uma vez só, logo depois da autorização (crm_nfe.email_em marca a tentativa, para nunca ir em dobro);
// pelo botão da tela (acao 'email_nota') vai de novo, para os e-mails que a pessoa escrever ou os do cadastro.
// Resposta e remetente: o(a) vendedor(a) do pedido (ou da carteira do cliente; sem e-mail, o administrador).
// 05/11/2026 (Anderson: "seria interessante ir junto o boleto"): o boleto do BB vai no mesmo e-mail. A automática ESPERA o
// registro no banco (o agendador crm-nfe-email tenta de novo a cada 15 minutos e o ciclo do BB registra a cada 10); depois
// de ESPERA_BOLETO minutos da autorização, vai sem o boleto que faltar (e o e-mail diz só os que foram).
const ESPERA_BOLETO = 90;
async function enviaEmailNota(db: ReturnType<typeof createClient>, nfeId: string, op: { para?: string; manual?: boolean } = {}) {
  const agora = new Date().toISOString();
  const { data: nRow } = await db.from('crm_nfe').select('id, ambiente, situacao, serie, numero, chave, valor, autorizada_em, proc_xml, pedido_id, empresa_id, email_em').eq('id', nfeId).maybeSingle();
  const nfe = nRow as Linha | null;
  if (!nfe || nfe.ambiente !== 'producao' || nfe.situacao !== 'autorizada' || !nfe.proc_xml) return { ok: false, erro: 'só nota de produção autorizada vai por e-mail' };
  let bol: { registrados: Linha[]; pendentes: number; dados: Linha } = { registrados: [], pendentes: 0, dados: {} };
  try { bol = await boletosDaNota(db, nfe); } catch (e) { console.error('[crm-fiscal] boletos da nota: ' + (e as Error).message); }
  const minutos = (Date.now() - Date.parse(String(nfe.autorizada_em || agora))) / 60000;
  if (!op.manual && bol.pendentes > 0 && minutos < ESPERA_BOLETO) return { ok: false, adiado: true, erro: 'esperando o registro do boleto no BB (' + bol.pendentes + ')' };
  if (!op.manual) {   // a automática: marca antes de mandar; se outra chamada já marcou, não manda de novo
    const { data: marcou } = await db.from('crm_nfe').update({ email_em: agora }).eq('id', nfeId).is('email_em', null).select('id');
    if (!marcou || !(marcou as Linha[]).length) return { ok: false, erro: 'já tentado' };
  }
  const fim = async (r: Linha) => { await db.from('crm_nfe').update({ email_em: agora, email_ok: r.ok === true, email_para: r.para || null, email_erro: r.ok ? null : String(r.erro || '').slice(0, 300) }).eq('id', nfeId); return r; };
  try {
    const { data: emp } = nfe.empresa_id ? await db.from('crm_empresas').select('nome, razao_social, email, email_nfe, responsavel_id').eq('id', nfe.empresa_id).maybeSingle() : { data: null };
    const e = (emp || {}) as Linha;
    const lista = op.para ? separaEmails(op.para).slice(0, 5) : destinatarios(e).emails;
    if (!lista.length) return await fim({ ok: false, erro: 'cliente sem e-mail no cadastro (preencha "E-mail para a nota fiscal" ou o e-mail da empresa)' });
    const brevo = Deno.env.get('BREVO_API_KEY') ?? '';
    if (!brevo) return await fim({ ok: false, erro: 'falta a chave do Brevo (BREVO_API_KEY)' });
    let vendId = e.responsavel_id as string | null;
    if (nfe.pedido_id) { const { data: p } = await db.from('crm_pedidos').select('vendedor_id').eq('id', nfe.pedido_id).maybeSingle(); if (p && (p as Linha).vendedor_id) vendId = String((p as Linha).vendedor_id); }
    const { data: v } = vendId ? await db.from('crm_usuarios').select('nome, email, ativo').eq('user_id', vendId).maybeSingle() : { data: null };
    const { data: adms } = await db.from('crm_usuarios').select('nome, email').eq('papel', 'admin').eq('ativo', true);
    const vend = v && (v as Linha).ativo && /@/.test(String((v as Linha).email || '')) ? v as Linha : null;
    const rem = vend || ((adms || []) as Linha[]).find(a => /@/.test(String(a.email || ''))) || null;
    if (!rem) return await fim({ ok: false, erro: 'nenhum remetente com e-mail (vendedor(a) ou administrador)' });
    const pdf = await pdfDanfe(String(nfe.proc_xml));
    const arq = arquivos(nfe, EMPRESA);
    // os boletos registrados: se o desenho falhar, o e-mail vai assim mesmo com a nota (e o erro fica anotado)
    let pdfBol: Uint8Array | null = null, erroBol = '';
    if (bol.registrados.length) { try { pdfBol = await pdfBoletosNota(bol.registrados, String(nfe.proc_xml), bol.dados); } catch (err) { erroBol = String((err as Error).message || err); console.error('[crm-fiscal] boleto do e-mail: ' + erroBol); } }
    const o = { empresa: EMPRESA, cliente: String(e.razao_social || e.nome || ''), vendedor: vend ? String(vend.nome) : '',
      boletos: pdfBol ? bol.registrados.map(b => ({ vencimento: b.vencimento, valor: b.valor })) : [] };
    const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': brevo, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: EMPRESA + ' · Nota fiscal', email: rem.email }, replyTo: { name: String(rem.nome), email: rem.email },
        to: lista.map(x => ({ email: x })), subject: assunto(nfe, EMPRESA), htmlContent: html(nfe, o), textContent: texto(nfe, o),
        attachment: [{ name: arq.xml, content: base64(new TextEncoder().encode(String(nfe.proc_xml))) }, { name: arq.pdf, content: base64(pdf) }]
          .concat(pdfBol ? [{ name: arq.boleto, content: base64(pdfBol) }] : []),
        tags: ['nfe'] }) });
    if (!r.ok) return await fim({ ok: false, para: lista.join(', '), erro: 'o Brevo recusou o e-mail (' + r.status + '): ' + (await r.text().catch(() => '')).slice(0, 200) });
    const obsBol = pdfBol ? ' · com ' + bol.registrados.length + ' boleto(s)' : erroBol ? ' · sem o boleto (erro: ' + erroBol.slice(0, 120) + ')' : bol.pendentes ? ' · sem o boleto (não registrado no BB a tempo)' : '';
    return await fim({ ok: true, para: lista.join(', ') + obsBol, boletos: pdfBol ? bol.registrados.length : 0 });
  } catch (err) { return await fim({ ok: false, erro: 'e-mail: ' + String((err as Error).message || err) }); }
}
const emSegundoPlano = (p: Promise<unknown>) => {
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt) rt.waitUntil(p.catch(() => null)); else p.catch(() => null);
};

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
    if (!nfe.email_em) emSegundoPlano(depoisDaNota(db, String(nfe.id)));
    return Object.assign({}, nfe, { nota_id: nota ? (nota as Linha).id : null, entrega: ent });
  }
  if (nfe && nfe.ambiente === 'producao' && nfe.situacao === 'autorizada' && nfe.proc_xml && !nfe.email_em) emSegundoPlano(depoisDaNota(db, String(nfe.id)));
  return nfe;
}
// a nota autorizada vai sozinha ao e-mail do cliente (XML + DANFE + boleto), sem segurar a resposta da emissão: depois que
// os títulos nasceram, pede ao BB o registro dos boletos (o mesmo ciclo do agendador) e manda; se o banco ainda não
// registrou, o agendador crm-nfe-email manda depois (enviaEmailNota espera até ESPERA_BOLETO minutos)
async function depoisDaNota(db: ReturnType<typeof createClient>, nfeId: string) {
  try {
    const u = Deno.env.get('SUPABASE_URL')!, k = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    await fetch(u + '/functions/v1/crm-bb', { method: 'POST', headers: { Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'ciclo' }), signal: AbortSignal.timeout(60000) });
  } catch (e) { console.error('[crm-fiscal] ciclo do BB antes do e-mail: ' + (e as Error).message); }
  return enviaEmailNota(db, nfeId);
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
// 03/11/2026: a Sefaz recusa (225, schema) nome ou endereço com mais de 60 letras; razão social longa (61) travou a NF 1-2870.
// Corta aqui, antes de ir ao serviço fiscal, para valer já (o serviço fiscal também corta desde a versão 2026-11-03c).
const CAMPOS_60 = ['razao_social', 'nome', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade'];
const cabeNoXml = (e: Linha | null) => {
  if (!e) return e;
  const o: Linha = Object.assign({}, e);
  for (const k of CAMPOS_60) if (typeof o[k] === 'string') { const t = String(o[k]).replace(/\s+/g, ' ').trim(); if (t.length > 60) o[k] = t.slice(0, 60).trim(); }
  return o;
};
const semXml = (n: Linha | null) => n && Object.assign({}, n, { nfe_xml: undefined, proc_xml: n.proc_xml ? true : false });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  // O agendador do banco (crm_nfe_email_tick, senha de crm_interno.bb_cfg no cabeçalho x-crm-agendador; 04/11/2026): só
  // manda por e-mail as notas de produção autorizadas que ainda não foram (a automática que falhou, ou as antigas pedidas).
  const senhaAg = req.headers.get('x-crm-agendador') || '';
  if (senhaAg) {
    const { data: ok } = await db.rpc('crm_bb_senha_ok', { p: senhaAg });
    if (ok !== true) return resposta(401, { erro: 'senha do agendador inválida' });
    let c: Linha = {};
    try { c = await req.json(); } catch { /* corpo vazio */ }
    if (c.acao !== 'email_pendentes') return resposta(400, { erro: 'o agendador só manda os e-mails pendentes' });
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(c.desde || '')) ? String(c.desde) + 'T00:00:00-03:00' : new Date(Date.now() - 2 * 864e5).toISOString();
    const { data: pend } = await db.from('crm_nfe').select('id, numero').eq('ambiente', 'producao').eq('situacao', 'autorizada').is('email_em', null)
      .gte('autorizada_em', desde).order('autorizada_em').limit(6);
    // no máximo 6 por chamada (05/11/2026: 14 notas com DANFE e boleto numa chamada passaram do limite da função, que foi
    // encerrada no meio); o resto vai na chamada seguinte do agendador, 15 minutos depois
    const res: Linha[] = [];
    for (const n of (pend || []) as Linha[]) res.push(Object.assign({ numero: n.numero }, await enviaEmailNota(db, String(n.id))));
    return resposta(200, { mandadas: res.filter(r => r.ok).length, total: res.length, notas: res });
  }
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: quem } = await comoUsuario.auth.getUser();
  if (!quem?.user) return resposta(401, { erro: 'faça login' });
  const { data: euRow } = await db.from('crm_usuarios').select('papel, ativo, nome').eq('user_id', quem.user.id).maybeSingle();
  const eu = euRow as Linha | null;
  let b: Linha;
  try { b = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  const ehDfe = /^dfe_/.test(String(b.acao || ''));
  if (!eu || !eu.ativo) return resposta(403, { erro: 'usuário inativo' });
  // Dados públicos da Receita pelo CNPJ (30/10/2026): do servidor, porque do navegador a BrasilAPI passava do tempo; se ela
  // falhar, a CNPJá (open.cnpja.com) — a resposta sai no formato da BrasilAPI, que a tela já lê (regras.js empresaDoCnpj).
  if (b.acao === 'receita') {
    if (eu.papel === 'motorista') return resposta(403, { erro: 'o motorista não cadastra cliente' });
    const doc = String(b.cnpj || '').replace(/\D/g, '');
    if (doc.length !== 14) return resposta(400, { erro: 'CNPJ inválido' });
    const pede = async (u: string) => { const r = await fetch(u, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }); return { st: r.status, j: await r.json().catch(() => null) }; };
    let naoAchou = false;
    try { const r = await pede('https://brasilapi.com.br/api/cnpj/v1/' + doc); if (r.st === 200 && r.j && r.j.cnpj) return resposta(200, { fonte: 'BrasilAPI', dados: r.j }); naoAchou = r.st === 404; } catch { /* tenta a outra */ }
    try {
      const r = await pede('https://open.cnpja.com/office/' + doc);
      const j = r.j as Linha | null;
      if (r.st === 200 && j && j.taxId) {
        const ad = (j.address || {}) as Linha, co = (j.company || {}) as Linha, fone = (((j.phones || []) as Linha[])[0] || {}) as Linha;
        return resposta(200, { fonte: 'CNPJá', dados: { cnpj: j.taxId, razao_social: co.name || '', nome_fantasia: j.alias || '', cep: ad.zip || '', descricao_tipo_de_logradouro: '',
          logradouro: ad.street || '', numero: ad.number || '', complemento: ad.details || '', bairro: ad.district || '', municipio: ad.city || '', uf: ad.state || '',
          codigo_municipio_ibge: ad.municipality || '', ddd_telefone_1: String(fone.area || '') + String(fone.number || ''), email: '',
          descricao_situacao_cadastral: String(((j.status || {}) as Linha).text || '').toUpperCase() } });
      }
      naoAchou = naoAchou || r.st === 404;
    } catch { /* sem resposta */ }
    return resposta(naoAchou ? 404 : 502, { erro: naoAchou ? 'CNPJ não encontrado na Receita' : 'a Receita não respondeu (BrasilAPI e CNPJá)' });
  }
  if (b.acao === 'cadastro') {
    if (eu.papel === 'motorista') return resposta(403, { erro: 'o motorista não cadastra cliente' });
    const doc = String(b.cnpj || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (doc.length !== 14 && doc.length !== 11) return resposta(400, { erro: 'CNPJ ou CPF inválido' });
    try { return resposta(200, await servico('/cadastro', doc.length === 14 ? { cnpj: doc } : { cpf: doc })); }
    catch (e) { return resposta(502, { erro: e instanceof Error ? e.message : String(e) }); }
  }
  if (ehDfe ? !DFE.includes(String(eu.papel)) : !EMITE.includes(String(eu.papel))) return resposta(403, { erro: ehDfe ? 'as notas de compra são do administrador e do comprador' : 'só a logística, a gestora e o administrador emitem nota' });
  try {
    const acao = String(b.acao || '');
    if (acao === 'saude') return resposta(200, await servico('/saude', null, 'GET'));
    const { data: cfgRow } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
    const fiscal = semAvisoNaNota(((cfgRow as Linha | null)?.dados as Linha | undefined)?.fiscal as Linha | undefined || {});
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
      const corpo = { pedido: d.pedido, empresa: cabeNoXml(d.empresa as Linha), regras: d.regras, emitente: d.fiscal.emitente, ambiente: amb, serie, vendedorNome: d.vendedorNome, cfg: d.fiscal, ibpt: d.ibpt };
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
    // "✉ Mandar por e-mail" na tela da NF-e: de novo, para os e-mails escritos (ou os do cadastro)
    if (acao === 'email_nota') {
      if (!nfe) throw new Error('nota não encontrada');
      return resposta(200, await enviaEmailNota(db, String(nfe.id), { para: b.para ? String(b.para) : '', manual: true }));
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
