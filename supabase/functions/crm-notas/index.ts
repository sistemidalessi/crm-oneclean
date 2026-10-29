// Edge Function: recebe os XML de NF-e do vigia da pasta (ferramentas/vigia-notas.js) e importa
// com as MESMAS regras da importação manual (nfe.js): só as notas da equipe
// (vendedor escrito na nota; sem ele, a carteira do cliente), completa o cadastro do cliente e não
// duplica (a chave de 44 dígitos é única). Quem chama não faz login: manda a chave de integração
// gerada em Configurações → Integrações, que só serve para isto. Aqui guardamos só o hash dela.
//
// As regras não são copiadas para cá: a função baixa regras.js e nfe.js do GitHub numa versão
// FIXA (commit abaixo) e confere o SHA-256 de cada um antes de usar — é garantidamente o mesmo
// código do site. Depois de mexer em regras.js ou nfe.js: commit + push, depois
//   node ferramentas/fixa-motor-notas.js     (atualiza COMMIT e HASHES aqui)
// e publicar de novo esta função. O teste testes/motor.test.js avisa se esquecer.
// Também recebe do vigia os CSV salvos pelo FKN ({fkn: {nome, base64}}): a listagem de produtos
// (estoque de Compras), o contas a receber e o contas a pagar (Caixa) — lidos por fkn.js, o mesmo
// leitor da tela. Desde 15/10/2026 grava também a tributação de cada item (crm_fiscal_grava).
// Deploy: verify_jwt DESLIGADO (a chave de integração é conferida aqui).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const COMMIT = 'd3b1423b071e20ab1511d26592e217dd8cea24b2';
const HASHES: Record<string, string> = { 'regras.js': '62662d6ce1e7d5c0e86e9a0008ffd0c483ba3d54ea8123594c801b592a634bf4', 'nfe.js': '401af41e7228d67e1f0cf44044761e26c7c8467332901dcb905fc9bd2a70ea1f', 'fkn.js': 'a65a429b6b1522de7ebf637a7049ef56ee9954518e6d00e31417159a9c33051f' };
const FONTE = 'https://raw.githubusercontent.com/sistemidalessi/crm-oneclean/' + COMMIT + '/';

// deno-lint-ignore no-explicit-any
let N: any = null;
async function carregaMotor() {
  if (N) return N;
  const codigo: Record<string, string> = {};
  for (const arq of Object.keys(HASHES)) {
    const r = await fetch(FONTE + arq);
    if (!r.ok) throw new Error('não baixou ' + arq + ' (' + r.status + ')');
    codigo[arq] = await r.text();
    if (await sha256(codigo[arq]) !== HASHES[arq]) throw new Error(arq + ' não confere com a versão fixada');
  }
  // regras.js e nfe.js são scripts "clássicos" (window.CRMRegras / window.CRMNfe).
  // deno-lint-ignore no-explicit-any
  const g: any = {};
  new Function(codigo['regras.js']).call(g);
  // deno-lint-ignore no-explicit-any
  const gt = globalThis as any;
  gt.CRMRegras = g.CRMRegras;
  gt.CRMDados = { uuid: () => crypto.randomUUID() };
  new Function(codigo['nfe.js'])();
  new Function(codigo['fkn.js'])();
  N = gt.CRMNfe;
  K = gt.CRMFkn;
  return N;
}
// deno-lint-ignore no-explicit-any
let K: any = null;

// Arquivo do FKN que o vigia mandou: reconhece pelo conteúdo e troca o retrato (estoque ou
// títulos em aberto). Travas: produtos com menos da metade do que já existe, ou contas a receber
// cuja soma não bate com o total geral, são recusados (arquivo cortado não apaga o que existe).
// deno-lint-ignore no-explicit-any
async function arquivoFkn(db: any, integ: { id: string }, f: { nome?: string; base64?: string }) {
  await carregaMotor();
  const bytes = Uint8Array.from(atob(String(f.base64 || '')), c => c.charCodeAt(0));
  let txt: string;
  try { txt = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { txt = new TextDecoder('windows-1252').decode(bytes); }
  txt = txt.replace(/^\uFEFF/, '');
  const nome = String(f.nome || '').slice(0, 200);
  const agora = new Date().toISOString();
  // naoApagarDesde: título criado pela nota DEPOIS da hora em que o relatório foi gerado não está
  // nele e não foi pago — fica (só o de antes, que o FKN não listou, sai).
  const grava = async (tabela: string, linhas: Record<string, unknown>[], conflito: string, naoApagarDesde?: string) => {
    for (let i = 0; i < linhas.length; i += LOTE) {
      const { error } = await db.from(tabela).upsert(linhas.slice(i, i + LOTE).map(x => Object.assign({}, x, { atualizado_em: agora })), { onConflict: conflito, defaultToNull: false });
      if (error) throw new Error(tabela + ': ' + error.message);
    }
    let q = db.from(tabela).delete().lt('atualizado_em', agora);
    if (naoApagarDesde) q = q.or('origem.neq.nota,criado_em.lt.' + naoApagarDesde);
    const { error } = await q;
    if (error) throw new Error(tabela + ' (limpeza): ' + error.message);
  };
  const registra = async (texto: string, qtd: number, valor: number) => {
    await db.from('crm_integracao_log').insert({ integracao_id: integ.id, arquivos: 1, notas_novas: 0, valor, fora: 0, erros: 0, resumo: { fkn: texto, arquivo: nome, qtd } });
    const ag = new Date().toISOString();
    await db.from('crm_integracoes').update({ ultimo_uso: ag, ultimo_sinal: ag }).eq('id', integ.id); // entrega também é sinal de vida
  };

  // Recusa: não troca nada, registra o motivo (aparece em Integrações e no lembrete de Compras).
  const recusa = async (tipo: string, motivos: string[]) => {
    const texto = motivos.join('; ');
    await db.from('crm_integracao_log').insert({ integracao_id: integ.id, arquivos: 1, notas_novas: 0, valor: 0, fora: 0, erros: 1,
      resumo: { fkn: (tipo === 'produtos' ? 'Listagem de produtos' : tipo === 'pagar' ? 'Contas a pagar' : 'Contas a receber') + ' do FKN recusada: ' + texto, fkn_recusa: texto, fkn_tipo: tipo, arquivo: nome } });
    return resposta(422, { erro: texto });
  };

  // Virada (22/10/2026): com o CRM dono do cadastro (crm_sistema.produtos_dono), o FKN não manda mais em nada — nem no
  // estoque, nem nos títulos (a listagem tiraria os que nasceram das notas do CRM), nem no contas a pagar. Fica registrado.
  const { data: doCrm } = await db.rpc('crm_produtos_do_crm');
  if (doCrm === true) {
    await registra('Relatório do FKN ignorado: desde a virada quem manda é o CRM', 0, 0);
    return resposta(200, { ok: true, ignorado: 'desde a virada quem manda é o CRM' });
  }

  if (K.ehListagemProdutos(txt)) {
    const conf = K.conferirListagemProdutos(txt);
    if (conf.recusa.length) return recusa('produtos', conf.recusa);
    const lista = K.lerListagemProdutos(txt);
    const { count } = await db.from('crm_estoque').select('codigo', { count: 'exact', head: true });
    if (count && lista.length < count / 2) return recusa('produtos', ['veio com ' + lista.length + ' produtos (o CRM tem ' + count + '): confira se nenhuma linha, família ou fornecedor ficou filtrado e salve com "Tudo"']);
    await grava('crm_estoque', lista, 'codigo');
    const valor = lista.reduce((s: number, x: { custo_total: number }) => s + (x.custo_total || 0), 0);
    // Estoque do CRM (Fase 2, 16/10/2026): guarda a hora em que a listagem foi gerada e, com o livro começado,
    // o banco compara os dois saldos nessa hora (crm_estoque_foto → crm_estoque_conferir).
    const foto = await db.rpc('crm_estoque_foto', { p_gerado: K.posicaoListagem ? K.posicaoListagem(txt) : null, p_linhas: lista.length });
    const conf2 = foto.data && foto.data.conferencia;
    await registra('Listagem de produtos do FKN: ' + lista.length + ' linhas' + (conf.avisos.length ? ' (atenção: ' + conf.avisos.join('; ') + ')' : '') +
      (foto.error ? ' (conferência do estoque falhou: ' + foto.error.message + ')' : conf2 ? ' · estoque CRM × FKN: ' + conf2.diferentes + ' diferença(s), ' + conf2.sem_explicacao + ' sem explicação' : ''), lista.length, valor);
    return resposta(200, { ok: true, fkn: 'produtos', produtos: lista.length, conferencia: conf2 || null });
  }
  if (K.ehContasReceber(txt)) {
    let lido;
    try { lido = K.lerContasReceber(txt); } catch (e) { return recusa('receber', [e instanceof Error ? e.message : String(e)]); }
    const conf = K.conferirContasReceber(txt, lido);
    if (conf.recusa.length) return recusa('receber', conf.recusa);
    const { count } = await db.from('crm_titulos').select('duplicata', { count: 'exact', head: true });
    if (count && count >= 20 && lido.titulos.length < count * 0.4) return recusa('receber', ['veio com ' + lido.titulos.length + ' títulos (o CRM tem ' + count + '): confira Cliente 0, Portador 0, Situação GERAL e a filial']);
    const [empresas, notas] = await Promise.all([tudo(db, 'crm_empresas', 'id,cnpj,grupo_id'), tudo(db, 'crm_notas', 'id,numero,empresa_id,cliente_doc')]);
    const porEmp = new Map<string, unknown[]>();
    (notas as { empresa_id: string }[]).forEach(n => { if (n.empresa_id) { if (!porEmp.has(n.empresa_id)) porEmp.set(n.empresa_id, []); porEmp.get(n.empresa_id)!.push(n); } });
    const lig = K.ligaEmpresas(lido.titulos, { empresas, notas }, { porEmpresa: { notas: porEmp } });
    // Hora em que o relatório foi gerado no FKN (cabeçalho DATA + hora; horário de Brasília).
    const geradoEm = lido.posicao ? new Date(lido.posicao + 'T' + (lido.hora || '00:00') + ':00-03:00').toISOString() : agora;
    await grava('crm_titulos', lig.titulos.map((t: Record<string, unknown>) => Object.assign({}, t, { origem: 'fkn' })), 'duplicata', geradoEm);
    await registra('Contas a receber do FKN: ' + lig.titulos.length + ' títulos de ' + lido.clientes + ' clientes' + (lig.sem ? ' (' + lig.sem + ' sem cliente no CRM)' : ''), lig.titulos.length, lido.soma);
    return resposta(200, { ok: true, fkn: 'receber', titulos: lig.titulos.length, semCliente: lig.sem });
  }
  if (K.ehContasPagar(txt)) {
    // Contas a pagar (Caixa, só do administrador): retrato — conta nova entra, a que sumiu é dada como
    // paga fora do caixa; a que já estava lançada (recorrente/planilha/à mão) só é ligada (fkn.js).
    let lido;
    try { lido = K.lerContasPagar(txt); } catch (e) { return recusa('pagar', [e instanceof Error ? e.message : String(e)]); }
    const conf = K.conferirContasPagar(txt, lido);
    if (conf.recusa.length) return recusa('pagar', conf.recusa);
    const existentes = await tudo(db, 'crm_fin_lancamentos', 'id,chave_fkn,situacao,tipo,valor,vencimento,origem,descricao,baixa,observacoes') as { chave_fkn: string; situacao: string }[];
    const doFkn = existentes.filter(x => x.chave_fkn && x.situacao !== 'pago').length;
    if (doFkn >= 20 && lido.contas.length < doFkn * 0.4) return recusa('pagar', ['veio com ' + lido.contas.length + ' contas (o CRM tem ' + doFkn + ' do FKN em aberto): confira Conta 0 a 0, Situação GERAL e a filial']);
    // excluídas pelo administrador no Caixa (13/10/2026): não voltam a cada listagem
    const excluidos = (await tudo(db, 'crm_fin_excluidos', 'chave_fkn') as { chave_fkn: string | null }[]).map(x => x.chave_fkn).filter(Boolean);
    const p = K.planoContasPagar(lido, existentes, { hoje: lido.posicao, agora, excluidos });
    for (let i = 0; i < p.inserir.length; i += LOTE) {
      const { error } = await db.from('crm_fin_lancamentos').insert(p.inserir.slice(i, i + LOTE));
      if (error) throw new Error('crm_fin_lancamentos: ' + error.message);
    }
    for (const a of [...p.atualizar, ...p.ligar, ...p.baixar]) {
      const { error } = await db.from('crm_fin_lancamentos').update(a.patch).eq('id', a.id);
      if (error) throw new Error('crm_fin_lancamentos: ' + error.message);
    }
    await registra('Contas a pagar do FKN: ' + lido.contas.length + ' contas (' + p.inserir.length + ' novas' + (p.antigas.qtd ? ', ' + p.antigas.qtd + ' antigas pausadas' : '') +
      (p.ligar.length ? ', ' + p.ligar.length + ' já lançadas' : '') + (p.baixar.length ? ', ' + p.baixar.length + ' pagas' : '') +
      (p.reabrir ? ', ' + p.reabrir + ' reabertas' : '') +
      (p.baixaSuspensa ? '; atenção: ' + p.baixaSuspensa + ' contas do CRM não vieram (listagem incompleta?), nenhuma dada como paga' : '') + ')', lido.contas.length, lido.soma);
    return resposta(200, { ok: true, fkn: 'pagar', contas: lido.contas.length, novas: p.inserir.length, pagas: p.baixar.length });
  }
  return resposta(422, { erro: 'arquivo do FKN não reconhecido (só a listagem de produtos, o contas a receber e o contas a pagar, em CSV)' });
}

const MAX_ARQUIVOS = 60;
const MAX_BYTES = 20 * 1024 * 1024;
const LOTE = 500;

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// deno-lint-ignore no-explicit-any
async function tudo(db: any, tabela: string, colunas: string) {
  const out: unknown[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.from(tabela).select(colunas).order('id').range(de, de + 999);
    if (error) throw new Error(tabela + ': ' + error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// Devolução de venda emitida pela PRÓPRIA empresa (27/10/2026, NF 2555 da TEA Clínica: o FKN desfez duas vendas de setembro
// com uma nota de entrada). O motor (nfe.js) ignora toda nota de entrada; aqui a que tem o nosso CNPJ de emitente e finalidade
// 4, ou todos os itens em CFOP de devolução de venda (1/2 201, 202, 410, 411), vira crm_compras com devolucao = true e a
// venda que ela desfaz em ref_chave, como a devolução emitida pelo cliente: crm_devolucoes_venda desconta do faturamento e
// da comissão no mês da devolução. Antes do início do estoque do CRM entra já lançada (o FKN acertou estoque e títulos);
// depois, fica pendente para o comprador dar a entrada no estoque. A devolução emitida pelo próprio CRM (crm_nfe) já é
// contada por lá e não entra aqui.
const CFOP_DEVOLUCAO = /^[12](201|202|410|411)$/;
// deno-lint-ignore no-explicit-any
type Doc = Record<string, any>;
function ehDevolucaoPropria(d: Doc | null, nosso: string) {
  if (!d || d.tipo !== 'nota' || d.saida !== false || !d.autorizada || !nosso || (d.emitente || {}).doc !== nosso) return false;
  const itens = (d.itens || []) as Doc[];
  return String(d.finalidade) === '4' || (itens.length > 0 && itens.every(it => CFOP_DEVOLUCAO.test(String(it.cfop || ''))));
}
const r2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
// deno-lint-ignore no-explicit-any
async function devolucoesProprias(db: any, lidos: { doc: Doc | null; xml: string }[], nosso: string) {
  const feitas = new Map<string, string>(), erros: string[] = [];
  const cand = lidos.filter(l => ehDevolucaoPropria(l.doc, nosso));
  if (!cand.length) return { feitas, erros };
  const chaves = cand.map(l => String((l.doc as Doc).chave));
  const [{ data: jaCompra }, { data: jaCrm }, { data: ini }] = await Promise.all([
    db.from('crm_compras').select('chave').in('chave', chaves),
    db.from('crm_nfe').select('chave').in('chave', chaves),
    db.from('crm_estoque_saldo').select('inicio').order('inicio', { ascending: true }).limit(1).maybeSingle()]);
  const pular = new Set([...((jaCompra || []) as Doc[]), ...((jaCrm || []) as Doc[])].map(x => String(x.chave)));
  const inicio = ini && ini.inicio ? Date.parse(ini.inicio) : null;
  for (const l of cand) {
    const d = l.doc as Doc;
    if (pular.has(d.chave)) { feitas.set(d.chave, 'devolução de venda (já no CRM)'); continue; }
    const refs: string[] = [], re = /<(?:refNFe|chaveAcesso)>(\d{44})<\/(?:refNFe|chaveAcesso)>/g;
    let m; while ((m = re.exec(l.xml))) if (!refs.includes(m[1])) refs.push(m[1]);
    const ref = refs.find(c => c.slice(6, 20) === nosso) || refs[0] || null;
    const antes = inicio != null && d.emitida_em && Date.parse(d.emitida_em) < inicio;
    const agora = new Date().toISOString(), cli = (d.cliente || {}) as Doc;
    const compra = { chave: d.chave, numero: d.numero, serie: d.serie, emitida_em: d.emitida_em, fornecedor_doc: cli.doc || null, fornecedor_nome: cli.nome || null,
      valor_produtos: r2(d.valor_produtos), valor_total: r2(d.valor_total), parcelas: [], devolucao: true, ref_chave: ref,
      situacao: antes ? 'lancada' : 'pendente', lancada_em: antes ? agora : null,
      obs: 'Devolução de venda emitida pela própria empresa (FKN)' + (refs.length > 1 ? '; desfaz ' + refs.length + ' notas: ' + refs.map(c => Number(c.slice(25, 34))).join(', ') : '') +
        (antes ? '; antes do início do estoque do CRM: o FKN já acertou o estoque e os títulos' : '') };
    const { data: c, error } = await db.from('crm_compras').insert(compra).select('id').single();
    if (error) { erros.push('devolução NF ' + d.numero + ': ' + error.message); continue; }
    const itens = ((d.itens || []) as Doc[]).map(it => ({ compra_id: c.id, ordem: it.ordem, cod_fornecedor: it.codigo, codigo: it.codigo, fator: 1, descricao: it.descricao,
      ncm: it.ncm, cfop: it.cfop, unidade: it.unidade, quantidade: Number(it.quantidade) || 0, valor_total: r2(it.valor_total) }));
    const { error: e2 } = itens.length ? await db.from('crm_compra_itens').insert(itens) : { error: null };
    if (e2) erros.push('itens da devolução NF ' + d.numero + ': ' + e2.message);
    feitas.set(d.chave, 'devolução de venda');
  }
  return { feitas, erros };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const chave = req.headers.get('x-crm-chave') ?? '';
  if (chave.length < 32) return resposta(401, { erro: 'chave de integração ausente' });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return resposta(413, { erro: 'lote grande demais' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: integ } = await db.from('crm_integracoes').select('id, nome, filtro, ativo, uso').eq('token_hash', await sha256(chave)).maybeSingle();
  // a senha de leitura do Caixa (uso = 'caixa') não entrega notas
  if (!integ || !integ.ativo || integ.uso === 'caixa') return resposta(401, { erro: 'chave inválida ou desativada' });

  let corpo: { arquivos?: { nome?: string; xml?: string }[]; sinal?: boolean; info?: Record<string, unknown>; fkn?: { nome?: string; base64?: string } };
  try { corpo = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }

  // Sinal de vida do vigia (a cada 30 min, mesmo sem nota): guarda a hora e um resumo curto.
  if (corpo.sinal === true) {
    const i = corpo.info ?? {};
    const sinal = { versao: String(i.versao ?? '').slice(0, 20), maquina: String(i.maquina ?? '').slice(0, 60),
      pendentes: Math.max(0, Math.min(1e6, Number(i.pendentes) || 0)), ultima_falha: String(i.ultima_falha ?? '').slice(0, 300) };
    const { error } = await db.from('crm_integracoes').update({ ultimo_sinal: new Date().toISOString(), sinal }).eq('id', integ.id);
    if (error) return resposta(500, { erro: 'sinal não gravado: ' + error.message });
    return resposta(200, { ok: true, sinal: true });
  }
  if (corpo.fkn) {
    // a chave derivada do FISCAL_TOKEN (crm-fiscal entrega as notas que o CRM emite) só manda XML de nota: nunca os CSV do
    // FKN, que regravam o contas a receber, o contas a pagar e o estoque (segurança, 22/10/2026, item 10)
    const ft = Deno.env.get('FISCAL_TOKEN');
    if (ft && await sha256(await sha256('crm-notas:' + ft)) === await sha256(chave)) return resposta(403, { erro: 'esta chave só entrega notas' });
    try { return await arquivoFkn(db, integ, corpo.fkn); } catch (e) { return resposta(500, { erro: 'falha no arquivo do FKN: ' + (e instanceof Error ? e.message : String(e)) }); }
  }
  // Reler do bucket as notas da própria empresa já guardadas (27/10/2026): até 50 chaves; só a devolução de venda é tratada.
  if (Array.isArray((corpo as Doc).reler)) {
    const lista = ((corpo as Doc).reler as unknown[]).map(String).filter(c => /^\d{44}$/.test(c)).slice(0, 50);
    try {
      const N = await carregaMotor();
      const { data: cf } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
      const nosso = String((((cf && cf.dados) || {}).fiscal || {}).emitente?.cnpj || '').replace(/\D/g, '');
      const lidos: { doc: Doc | null; xml: string }[] = [];
      for (const c of lista) {
        const { data: f } = await db.storage.from('crm-notas-xml').download('nfe/' + c + '.xml');
        const xml = f ? await f.text() : '';
        lidos.push({ doc: xml ? N.lerXml(xml) : null, xml });
      }
      const dv = await devolucoesProprias(db, lidos, nosso);
      // também devolve as chaves referenciadas e o texto da nota (ex.: a nota de faturamento que cada remessa 5117 baixa)
      const refsDe = (x: string) => [...new Set([...x.matchAll(/<(?:refNFe|chaveAcesso)>(\d{44})<\/(?:refNFe|chaveAcesso)>/g)].map(m => m[1]))];
      const cpl = (x: string) => ((/<infCpl>([^<]*)<\/infCpl>/.exec(x) || [])[1] || '').slice(0, 400);
      return resposta(200, { ok: true, arquivos: lidos.map((l, i) => ({ chave: lista[i], refs: refsDe(l.xml), infCpl: cpl(l.xml), numero: l.doc ? l.doc.numero : null,
        itens: l.doc ? ((l.doc.itens || []) as Doc[]).map(it => [it.codigo, it.quantidade, it.unidade, it.valor_total, it.cfop]) : [], situacao: !l.doc ? 'sem XML' : dv.feitas.get(lista[i]) ||
        ('não é devolução de venda (' + (l.doc.saida ? 'saída' : 'entrada') + ', finalidade ' + l.doc.finalidade + ', CFOP ' + [...new Set(((l.doc.itens || []) as Doc[]).map(it => it.cfop))].join('/') + ', ' + (l.doc.natureza || '') + ')') })),
        erros: dv.erros });
    } catch (e) { return resposta(500, { erro: 'falha ao reler: ' + (e instanceof Error ? e.message : String(e)) }); }
  }
  const arquivos = Array.isArray(corpo.arquivos) ? corpo.arquivos : [];
  if (arquivos.length > MAX_ARQUIVOS) return resposta(413, { erro: 'no máximo ' + MAX_ARQUIVOS + ' arquivos por envio' });

  try {
    const N = await carregaMotor();
    const lidos = arquivos.map(a => ({ nome: String(a.nome ?? '').slice(0, 200), doc: N.lerXml(String(a.xml ?? '')), xml: String(a.xml ?? '') }));
    const docs = lidos.map(l => l.doc).filter(Boolean);
    // XML autorizado guardado (14/10/2026): o CRM monta dele a cópia da DANFE que vai com o boleto
    // atualizado. Já guardado: o Storage recusa (sem sobrescrever) e segue.
    // a chave vira o nome do arquivo: só 44 caracteres válidos (segurança, 22/10/2026)
    await Promise.all(lidos.filter(l => l.doc && (l.doc as { tipo: string }).tipo === 'nota' && /^[0-9A-Z]{44}$/.test((l.doc as { chave: string }).chave) && /<protNFe[\s>]/.test(l.xml)).map(l =>
      db.storage.from('crm-notas-xml').upload('nfe/' + (l.doc as { chave: string }).chave + '.xml', new Blob([l.xml], { type: 'text/xml' }), { upsert: false, contentType: 'text/xml' })
        .then(() => null, () => null)));
    const chaves = [...new Set(docs.map((d: { chave: string }) => d.chave))];

    // Só o que o planejador precisa (sem carregar o CRM inteiro).
    const [empresas, produtos, opcoes, usuarios, contatos, notas, cfg] = await Promise.all([
      tudo(db, 'crm_empresas', 'id,nome,razao_social,cnpj,telefone,whatsapp,email,cep,logradouro,numero,complemento,bairro,cidade,uf,situacao,responsavel_id,segmento,grupo_id'),
      tudo(db, 'crm_produtos', 'id,nome,codigo'),
      db.from('crm_opcoes').select('id,tipo,nome').eq('tipo', 'segmento').then((r: { data: unknown[] }) => r.data || []),
      db.from('crm_usuarios').select('user_id,nome,ativo,nomes_nota').then((r: { data: unknown[] }) => r.data || []),
      tudo(db, 'crm_contatos', 'id,empresa_id,email'),
      chaves.length ? db.from('crm_notas').select('id,chave,cancelada,vendedor_nome').in('chave', chaves).then((r: { data: unknown[] }) => r.data || []) : [],
      db.from('crm_config').select('dados').eq('id', 1).maybeSingle().then((r: { data: { dados?: Record<string, unknown> } | null }) => (r.data && r.data.dados) || {})
    ]);
    const exVendedores = String(cfg.vendedores_antigos || '').split(',');
    const plano = N.planeja({ empresas, produtos, opcoes, usuarios, contatos, notas }, docs, { filtro: integ.filtro, cadastrarProdutos: true, exVendedores });

    // Grava na mesma ordem da importação manual; lote recusado é regravado um a um.
    const erros: string[] = [];
    const falhou = new Set<string>();
    for (const t of ['opcoes', 'produtos', 'empresas', 'notas', 'nota_itens']) {
      const lista = plano.criar[t] || [];
      for (let i = 0; i < lista.length; i += LOTE) {
        const lote = lista.slice(i, i + LOTE);
        const { error } = await db.from('crm_' + t).insert(lote, { defaultToNull: false });
        if (!error) continue;
        for (const o of lote) {
          const { error: e1 } = await db.from('crm_' + t).insert([o], { defaultToNull: false });
          if (e1) { erros.push(t + ' ' + (o.nome || o.numero || o.descricao || o.id) + ': ' + e1.message); falhou.add(o.id); }
        }
      }
    }
    for (const a of plano.atualizar) {
      const { error } = await db.from('crm_' + a.tabela).update(a.patch).eq('id', a.id);
      if (error) erros.push(a.tabela + ' ' + a.id + ': ' + error.message);
    }
    // Títulos das parcelas (contas a receber já na emissão): o que o FKN já listou não é mexido.
    const titulos = (plano.criar.titulos || []).filter((t: { nota_numero: number }) => !plano.criar.notas.some((n: { numero: number; id: string }) => n.numero === t.nota_numero && falhou.has(n.id)));
    for (let i = 0; i < titulos.length; i += LOTE) {
      const { error } = await db.from('crm_titulos').upsert(titulos.slice(i, i + LOTE), { onConflict: 'duplicata', ignoreDuplicates: true });
      if (error) erros.push('títulos: ' + error.message);
    }
    // Nota cancelada: tira os títulos que vieram dela (os do FKN saem na próxima listagem).
    for (const pre of plano.titulosCancelados || []) {
      const { error } = await db.from('crm_titulos').delete().eq('origem', 'nota').like('duplicata', pre + '/%');
      if (error) erros.push('títulos da nota cancelada ' + pre + ': ' + error.message);
    }

    // Tributação de cada item (Fase 1 fiscal, 15/10/2026): crm_fiscal_itens, pela função do banco (acha o item
    // pela chave e pela ordem; nota que não entrou é pulada).
    if (N.loteFiscal) {
      const lote = N.loteFiscal(docs);
      for (let i = 0; i < lote.length; i += 40) {
        const { error } = await db.rpc('crm_fiscal_grava', { lote: lote.slice(i, i + 40) });
        if (error) erros.push('tributação das notas: ' + error.message);
      }
    }

    // devolução de venda emitida pela própria empresa (o motor ignora as notas de entrada)
    const nosso = String(((cfg.fiscal || {}) as Doc).emitente?.cnpj || '').replace(/\D/g, '');
    const dv = await devolucoesProprias(db, lidos, nosso);
    erros.push(...dv.erros);

    // Situação de cada arquivo, para o vigia registrar.
    const criadas = new Map(plano.criar.notas.map((n: { chave: string; id: string }) => [n.chave, n.id]));
    const foraPor = new Map(plano.ignorados.map((x: { registro: { chave: string }; motivo: string }) => [x.registro.chave, x.motivo]));
    const jaTinha = new Set((notas as { chave: string }[]).map(n => n.chave));
    const situacao = lidos.map(l => {
      const d = l.doc as { tipo: string; chave: string } | null;
      if (!d) return { nome: l.nome, situacao: 'não é NF-e (ignorado)' };
      if (d.tipo === 'cancelamento') return { nome: l.nome, situacao: 'cancelamento', chave: d.chave };
      if (dv.feitas.has(d.chave)) return { nome: l.nome, situacao: dv.feitas.get(d.chave), chave: d.chave };
      if (criadas.has(d.chave)) return { nome: l.nome, situacao: falhou.has(criadas.get(d.chave) as string) ? 'erro' : 'importada', chave: d.chave };
      if (jaTinha.has(d.chave)) return { nome: l.nome, situacao: 'já importada', chave: d.chave };
      if (foraPor.has(d.chave)) return { nome: l.nome, situacao: 'fora: ' + foraPor.get(d.chave), chave: d.chave };
      return { nome: l.nome, situacao: 'repetida no envio', chave: d.chave };
    });
    const r = plano.resumoNotas;
    await db.from('crm_integracao_log').insert({
      integracao_id: integ.id, arquivos: arquivos.length, notas_novas: r.novas, valor: r.valor, fora: r.foraDoFiltro, erros: erros.length,
      resumo: { resumo: r, vendedores: plano.vendedoresNotas, erros: erros.slice(0, 50) }
    });
    const agora = new Date().toISOString();
    await db.from('crm_integracoes').update({ ultimo_uso: agora, ultimo_sinal: agora }).eq('id', integ.id);
    return resposta(200, { ok: true, resumo: r, arquivos: situacao, erros });
  } catch (e) {
    return resposta(500, { erro: 'falha ao importar: ' + (e instanceof Error ? e.message : String(e)) });
  }
});
