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
// (28/10/2026) Lançar no caixa da OneClean pelo app do CEO (o Anderson, na rua; a frase é lida do lado da Agilité pelo
//   mesmo leitor do Caixa, frases.js interpretar):
//   {"acao":"caixa_conferir","itens":[{"tipo":"saida","valor":180,"data":"2026-10-28","texto":"combustível"}]} devolve,
//   por item, a categoria e o fornecedor sugeridos (regra aprendida em crm_fin_regras ou a palavra, como frases.js) e as
//   contas EM ABERTO parecidas (para não duplicar uma conta que já existe: essa se baixa pelo Caixa), e a lista de
//   categorias; {"acao":"caixa_lancar","itens":[{tipo,valor,data,situacao,descricao,categoria,fornecedor,frase}]} grava
//   como o lançamento "novo" do Caixa por frases (pelo_celular = true); {"acao":"caixa_desfazer","ids":[…]} apaga, até 10
//   minutos depois, só o que veio do app (cópia em crm_fin_excluidos). Nada entre empresas: frase ou categoria com a
//   Agilité ou "Transferência entre empresas" é recusada (a passagem se lança do lado da Agilité e vem pelo espelho).
//   Corpo até 20 kB. Sem pagar nada: só registra no caixa o que já aconteceu ou vai acontecer.
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
  // (28/10/2026) o que as pessoas responderam às diretrizes enviadas (últimos 30 dias); o outro lado não repete pelo ref
  // deno-lint-ignore no-explicit-any
  let respostas: any[] = [];
  if (ids.length) {
    const desde = new Date(Date.now() - 30 * 86400e3).toISOString();
    const { data: rs, error: e5 } = await db.from('crm_ia_diretrizes_respostas').select('id, diretriz_id, user_id, texto, em').in('diretriz_id', ids).gte('em', desde).order('em', { ascending: false }).limit(300);
    if (e5) throw new Error(e5.message);
    // deno-lint-ignore no-explicit-any
    respostas = (rs || []).map((x: any) => ({ ref: String(x.id), id: x.diretriz_id, pessoa: (x.user_id ? nomes.get(x.user_id) : null) || null, texto: x.texto, em: x.em }));
  }
  return resposta(200, { ok: true, ativas: ids.length, pessoas: (us || []).map((x: { user_id: string; nome: string; papel: string }) => ({ id: x.user_id, nome: x.nome, papel: x.papel })), uso, respostas });
}

// ------------------------------------------------------------ caixa pelo app do CEO (28/10/2026)
// A categoria pela palavra é a MESMA de frases.js (categoriaDe/PALAVRAS) e a regra aprendida a mesma de regraDe:
// mudou lá, mudar aqui (testes/ceo-caixa.test.js compara as duas listas).
const semAcento = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const baixo = (s: string) => semAcento(s).toLowerCase();
const AGILITE = /\ba[gj]il+i[tc]/;
const PALAVRAS: [RegExp, string][] = [
  [/\bdiaria/, 'Diárias de cobertura'], [/\buniforme/, 'Uniformes'], [/\bsekron/, 'Sekron (monitoramento)'], [/\bexame|\baso\b|\bmedtrab/, 'Medicina do trabalho'],
  [/\btarifa|\biof\b|taxa bancaria|cesta de servic|\bmanutencao de conta/, 'Tarifas bancárias'],
  [/\bpro.?labore/, 'Pró-labore'],
  [/\bretirada/, 'Retiradas dos sócios'],
  [/\bvt\b|\bvr\b|\bva\b|vale.?transporte|vale.?refei|vale.?alimenta|\bcesta|beneficio/, 'Benefícios (VT, VR, cesta)'],
  [/\bfgts|\binss|encargo|\bgps\b/, 'FGTS e encargos'],
  [/\bsalario|\bfolha\b|\bferias\b|rescis|adiantamento/, 'Salários'],
  [/\baluguel|\blocacao do galpao/, 'Aluguel'],
  [/\benergia|\bluz\b|\benel\b|eletropaulo/, 'Energia'],
  [/\bagua\b|sabesp/, 'Água'],
  [/telefone|internet|celular|\bvivo\b|\bclaro\b|\btim\b|\boi\b/, 'Telefone e internet'],
  [/contab|contador/, 'Contabilidade'],
  [/\bfkn\b/, 'Sistema (FKN)'],
  [/convenio|plano de saude|unimed|\bamil\b|odonto/, 'Convênio médico'],
  [/reparcel|parcelamento/, 'Reparcelamentos'],
  [/imposto|\bdas\b|simples nacional|\bicms|\biss\b|\bdarf|\bipva|\biptu/, 'Impostos'],
  [/cartao/, 'Cartões'],
  [/emprestimo|\bgiro\b|financiamento|pronampe/, 'Empréstimos e giro'],
  [/pedag|combust|gasolina|diesel|etanol|\bfrete|caminhao|\bposto\b|abasteci|\boleo\b/, 'Frete e combustível'],
  [/fornecedor|mercadoria|\bcompra/, 'Fornecedores']
];
const GENERICAS = new Set(('conta contas pagamento pagto boleto boletos nota notas fatura fornecedor fornecedores cliente clientes ' +
  'ltda eireli epp comercio comercial servicos servico industria cia sociedade empresa grupo brasil distribuidora dia mes valor ' +
  'parcela parcelas referente total geral mais outro outra outros outras ' +
  'compra compras mercadoria mercadorias produto produtos pedido pedidos material materiais venda vendas loja').split(' '));
const tokens = (s: string) => [...new Set(baixo(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 3 && !/^\d+$/.test(w) && !GENERICAS.has(w) && !/^(?:que|dos|das|com|pra|para|pro)$/.test(w)))];
const casaPalavra = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0));
function categoriaCx(texto: string, tipo: string) {
  const t = baixo(texto);
  if (tipo === 'entrada') return /duplicata|boleto|titulo/.test(t) ? 'Duplicatas recebidas' : 'Outras entradas';
  const p = PALAVRAS.find(x => x[0].test(t));
  return p ? p[1] : 'Outras saídas';
}
// deno-lint-ignore no-explicit-any
function regraCx(regras: any[], tipo: string, toks: string[]) {
  // deno-lint-ignore no-explicit-any
  let melhor: { r: any; n: number } | null = null;
  for (const r of regras) {
    if (r.tipo && r.tipo !== tipo) continue;
    const k = String(r.chave || '').split(' ').filter(Boolean);
    if (!k.length || !k.every((w: string) => toks.some(t => casaPalavra(t, w)))) continue;
    if (!melhor || k.length > melhor.n) melhor = { r, n: k.length };
  }
  return melhor && melhor.r;
}
const PROIBIDA = (cat: string) => /agilit|transfer[eê]ncia entre empresas/i.test(cat || '');
const ehData = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Math.abs(Date.parse(s + 'T12:00:00Z') - Date.now()) < 400 * 864e5;
const r2 = (v: number) => Math.round(v * 100) / 100;
const dmais = (iso: string, d: number) => new Date(Date.parse(iso + 'T12:00:00Z') + d * 864e5).toISOString().slice(0, 10);

// deno-lint-ignore no-explicit-any
async function caixaConferir(db: any, itens: unknown) {
  if (!Array.isArray(itens) || !itens.length || itens.length > 10) return resposta(400, { erro: 'itens inválidos' });
  const [{ data: regras, error: e1 }, { data: usadas, error: e2 }] = await Promise.all([
    db.from('crm_fin_regras').select('tipo, chave, categoria, fornecedor, entre_empresas'),
    db.from('crm_fin_lancamentos').select('categoria').gte('criado_em', new Date(Date.now() - 365 * 864e5).toISOString()).not('categoria', 'is', null).limit(5000)
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  // as categorias que o caixa usa, das mais usadas para as menos (sem as de entre empresas)
  const conta = new Map<string, number>();
  for (const x of (usadas || []) as { categoria: string }[]) if (!PROIBIDA(x.categoria)) conta.set(x.categoria, (conta.get(x.categoria) || 0) + 1);
  const saida: unknown[] = [];
  // deno-lint-ignore no-explicit-any
  for (const it of itens as any[]) {
    const tipo = it && it.tipo === 'entrada' ? 'entrada' : 'saida', valor = Number(it && it.valor), data = String(it && it.data || ''), texto = String(it && it.texto || '').slice(0, 300);
    if (!(valor > 0 && valor <= 10000000) || !ehData(data)) return resposta(400, { erro: 'item inválido' });
    // deno-lint-ignore no-explicit-any
    const regra = regraCx(((regras || []) as any[]).filter(r => !r.entre_empresas && !PROIBIDA(r.categoria)), tipo, tokens(texto));
    const tol = Math.max(60, valor * 0.08);
    const { data: ab, error: e3 } = await db.from('crm_fin_lancamentos').select('descricao, fornecedor, valor, vencimento').eq('situacao', 'aberto').eq('tipo', tipo)
      .gte('vencimento', dmais(data, -20)).lte('vencimento', dmais(data, 20)).gte('valor', r2(valor - tol)).lte('valor', r2(valor + tol)).order('vencimento').limit(5);
    if (e3) throw new Error(e3.message);
    saida.push({ categoria: regra && regra.categoria ? regra.categoria : categoriaCx(texto, tipo), fornecedor: regra ? regra.fornecedor || null : null, regra: !!regra,
      parecidas: (ab || []).map((l: { descricao: string; fornecedor: string | null; valor: number; vencimento: string }) => ({ descricao: l.descricao, fornecedor: l.fornecedor, valor: Number(l.valor), vencimento: l.vencimento })) });
  }
  return resposta(200, { ok: true, itens: saida, categorias: [...conta.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, 60) });
}

// deno-lint-ignore no-explicit-any
async function caixaLancar(db: any, c: any) {
  const itens = c.itens;
  if (!Array.isArray(itens) || !itens.length || itens.length > 10) return resposta(400, { erro: 'itens inválidos' });
  const agora = new Date().toISOString();
  // deno-lint-ignore no-explicit-any
  const linhas = (itens as any[]).map(it => {
    const tipo = it && it.tipo === 'entrada' ? 'entrada' : 'saida', valor = r2(Number(it && it.valor)), data = String(it && it.data || '');
    const pago = it && it.situacao === 'realizado' && data <= agora.slice(0, 10);
    return { tipo, valor, vencimento: data, descricao: String(it && it.descricao || '').trim().slice(0, 160), categoria: String(it && it.categoria || '').trim().slice(0, 80) || null,
      fornecedor: String(it && it.fornecedor || '').trim().slice(0, 120) || null, frase: String(it && it.frase || '').slice(0, 300) || null,
      situacao: pago ? 'pago' : 'aberto', pago_em: pago ? data : null, baixa: pago ? 'caixa' : null, baixado_em: pago ? agora : null,
      entre_empresas: false, origem: 'tela', pelo_celular: true, criado_por: null, observacoes: 'Lançado pelo app do CEO (celular).' };
  });
  const ruim = linhas.find(l => !(l.valor > 0 && l.valor <= 10000000) || !ehData(l.vencimento) || !l.descricao || PROIBIDA(l.categoria || '') || AGILITE.test(baixo(l.descricao + ' ' + (l.frase || '') + ' ' + (l.fornecedor || ''))));
  if (ruim) return resposta(400, { erro: ruim.descricao && (PROIBIDA(ruim.categoria || '') || AGILITE.test(baixo(ruim.descricao + ' ' + (ruim.frase || '') + ' ' + (ruim.fornecedor || '')))) ? 'passagem entre as empresas: lance com a Agilité (o espelho traz para cá)' : 'lançamento inválido' });
  const { error: e0 } = await db.from('crm_ceo_acoes').insert({ nonce: c.nonce, acao: 'caixa_lancar', ok: true, detalhe: linhas.length + ' lançamento(s)' });
  if (e0) throw new Error(e0.message);
  const { data, error } = await db.from('crm_fin_lancamentos').insert(linhas).select('id');
  if (error) throw new Error(error.message);
  return resposta(200, { ok: true, ids: (data || []).map((x: { id: string }) => x.id) });
}

// deno-lint-ignore no-explicit-any
async function caixaDesfazer(db: any, c: any) {
  const ids = Array.isArray(c.ids) ? c.ids.filter((x: unknown) => typeof x === 'string' && UUID.test(x)).slice(0, 10) : [];
  if (!ids.length) return resposta(400, { erro: 'nada para desfazer' });
  const { data: ls, error } = await db.from('crm_fin_lancamentos').select('*').in('id', ids).eq('pelo_celular', true).gte('criado_em', new Date(Date.now() - 10 * 60e3).toISOString());
  if (error) throw new Error(error.message);
  // mexido no CRM depois de lançado (baixa, valor, dia): não se desfaz por aqui
  // deno-lint-ignore no-explicit-any
  const intactos = ((ls || []) as any[]).filter(l => Math.abs(Date.parse(l.atualizado_em) - Date.parse(l.criado_em)) < 5000);
  if (intactos.length !== ids.length) return resposta(409, { erro: 'passou dos 10 minutos (ou o lançamento já foi mudado no CRM): desfaça pelo Caixa do CRM' });
  const { error: e0 } = await db.from('crm_ceo_acoes').insert({ nonce: c.nonce, acao: 'caixa_desfazer', ok: true, detalhe: ids.length + ' lançamento(s)' });
  if (e0) throw new Error(e0.message);
  // deno-lint-ignore no-explicit-any
  const { error: e1 } = await db.from('crm_fin_excluidos').insert((ls as any[]).map(l => ({ lancamento_id: l.id, descricao: l.descricao, valor: l.valor, vencimento: l.vencimento, dados: l, excluido_por: null })));
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await db.from('crm_fin_lancamentos').delete().in('id', ids).eq('pelo_celular', true);
  if (e2) throw new Error(e2.message);
  return resposta(200, { ok: true, desfeitos: ids.length });
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
  if (corpo.length > (pre && /^caixa_/.test(String(pre.acao || '')) ? 20000 : 2000) && !(pre && pre.acao === 'diretrizes')) return resposta(413, { erro: 'corpo grande demais' });
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
    if (c.acao === 'caixa_conferir') return await caixaConferir(db, c.itens);
    if (c.acao === 'caixa_lancar') return await caixaLancar(db, c);
    if (c.acao === 'caixa_desfazer') return await caixaDesfazer(db, c);
    return resposta(400, { erro: 'ação fora da lista' });
  } catch (e) {
    const m = (e as Error).message;
    if (/duplicate key|crm_ceo_acoes_nonce/.test(m)) return resposta(409, { erro: 'pedido repetido (mesmo nonce)' });
    console.error('[crm-ceo-acao]', m);
    return resposta(500, { erro: 'falhou no CRM' });
  }
});
