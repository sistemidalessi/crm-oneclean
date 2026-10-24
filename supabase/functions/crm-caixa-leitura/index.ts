// Edge Function: endereço de LEITURA do Caixa da OneClean (06/10/2026), para a aba "Geral" do sistema
// da Agilité (as duas empresas juntas, com o que passa entre elas anulado) e para a sessão gestora do
// grupo. Mesmo formato do GET /api/ceo/resumo da Agilité.
//   GET …/functions/v1/crm-caixa-leitura?dias=30        (dias de 1 a 90; padrão 30)
//   Authorization: Bearer <senha de leitura>
//   GET …/crm-caixa-leitura?parte=ceo                   (24/10/2026: o resumo da OneClean para o painel "CEO Grupo
//        Dalessi" do sistema da Agilité — vendas, funil, receber, pedidos, NF-e, estoque, compras, entregas;
//        crm_ceo_resumo(), que só o service_role executa. Mesma senha.)
// A senha é gerada pelo administrador em Configurações → Integrações → "Leitura do Caixa" (aparece uma
// vez só; aqui fica só o SHA-256, em crm_integracoes com uso = 'caixa'). Sem senha ou com senha errada:
// 401 e nada mais. Só GET (o resto: 405). Não grava nada, nem registro de uso.
//   GET …/crm-caixa-leitura?parte=sinal&valor=V&de=7&ate=45   (24/10/2026, Comprador Sênior do CEO Grupo): SÓ para a
//        crm-assistente (Authorization: Bearer <a chave de serviço do próprio projeto>): a partir de que dia um
//        pagamento de V cabe no caixa (o saldo do fim de cada dia, dali até o fim da previsão, fica >= o colchão de
//        Configurações, `caixa_colchao_compras`, padrão R$ 0). Devolve SÓ a data e uma frase, nunca saldo ou valor: o
//        comprador recebe só o sinal ("melhor vencer a partir de 15/11"). Com a chave de serviço, nenhuma outra parte.
// As contas NÃO são copiadas para cá: a função baixa caixa-calculo.js (o mesmo arquivo da tela do
// Caixa) do GitHub num commit FIXO e confere o SHA-256 antes de usar. Depois de mexer nele: commit +
// push, `node ferramentas/fixa-motor-notas.js` (fixa as duas funções) e publicar esta de novo.
// A chave de serviço só existe aqui dentro (variável do Supabase); nunca vai para o app nem para
// quem chama. Deploy: verify_jwt DESLIGADO (a senha é conferida aqui).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const COMMIT = 'e7c39870b1f5a6583c8da3530c08c2585ede53e7';
const HASHES: Record<string, string> = { 'caixa-calculo.js': '9a8446d31fcb4187f68d5579eed77a5502e74349403a92afd71d63993238a11b' };
const FONTE = 'https://raw.githubusercontent.com/sistemidalessi/crm-oneclean/' + COMMIT + '/';
const PAGINA = 1000;

const cabecalhos = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const resposta = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status, headers: cabecalhos });

async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// comparação em tempo constante (mesmo tamanho: são dois SHA-256 em hexadecimal)
function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// deno-lint-ignore no-explicit-any
let C: any = null;
async function carregaMotor() {
  if (C) return C;
  const r = await fetch(FONTE + 'caixa-calculo.js');
  if (!r.ok) throw new Error('não baixou caixa-calculo.js (' + r.status + ')');
  const codigo = await r.text();
  if (await sha256(codigo) !== HASHES['caixa-calculo.js']) throw new Error('caixa-calculo.js não confere com a versão fixada');
  // deno-lint-ignore no-explicit-any
  const g: any = {};
  new Function('module', 'require', 'globalThis', 'window', codigo)(undefined, undefined, g, g);
  C = g.CRMCaixa;
  return C;
}

// deno-lint-ignore no-explicit-any
async function tudo(db: any, tabela: string, colunas: string, ordem = 'id') {
  const out: unknown[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await db.from(tabela).select(colunas).order(ordem).range(de, de + PAGINA - 1);
    if (error) throw new Error(tabela + ': ' + error.message);
    out.push(...data);
    if (data.length < PAGINA) return out;
  }
}

// "hoje" de São Bernardo do Campo (a tela usa o dia do computador do Anderson)
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// a previsão do Caixa, com as mesmas contas da tela (caixa-calculo.js no commit fixado)
// deno-lint-ignore no-explicit-any
async function montar(db: any, dias: number) {
    const K = await carregaMotor();
    const [lancamentos, saldos, recorrentes, titulos, usuarios, cfg] = await Promise.all([
      tudo(db, 'crm_fin_lancamentos', 'id, tipo, descricao, fornecedor, categoria, valor, vencimento, situacao, pago_em, baixa, baixado_em, entre_empresas, origem, recorrente_id, titulo_duplicata, emprestimo, juros'),
      tudo(db, 'crm_fin_saldos', 'id, data, valor, criado_em'),
      tudo(db, 'crm_fin_recorrentes', 'id, descricao'),
      tudo(db, 'crm_titulos', 'duplicata, empresa_id, cliente_nome, valor, vencimento, previsao, cartorio_em', 'duplicata'),
      tudo(db, 'crm_usuarios', 'user_id, nome', 'user_id'),
      db.from('crm_config').select('dados').eq('id', 1).maybeSingle()
    ]);
    // nome do cliente como na tela: o do cadastro no CRM; sem cadastro, o do FKN
    // deno-lint-ignore no-explicit-any
    const ids = [...new Set((titulos as any[]).map(t => t.empresa_id).filter(Boolean))];
    const nomes = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from('crm_empresas').select('id, nome').in('id', ids.slice(i, i + 200));
      if (error) throw new Error('crm_empresas: ' + error.message);
      for (const e of data ?? []) nomes.set(e.id, e.nome);
    }
    // título em cartório (14/10/2026) fica fora da previsão, como na tela do Caixa
    // deno-lint-ignore no-explicit-any
    const tits = (titulos as any[]).filter(t => !t.cartorio_em).map(t => Object.assign({}, t, { cliente: (t.empresa_id && nomes.get(t.empresa_id)) || t.cliente_nome || 'Cliente' }));
    // deno-lint-ignore no-explicit-any
    const dados = ((cfg as any).data && (cfg as any).data.dados) || {};
    const r = K.resumoLeitura({ lancamentos, saldos, recorrentes, titulos: tits, pessoas: (usuarios as { nome: string }[]).map(u => u.nome) },
      { hoje: hojeSP(), dias, d1: dados.caixa_credito_d1 !== false, gerado_em: new Date().toISOString() });
    return { r, dados };
}

// o sinal do vencimento (só data e frase): o primeiro dia útil entre de e ate dias a partir do qual o saldo do fim de
// cada dia, até o fim da previsão, menos o valor, fica >= o colchão
// deno-lint-ignore no-explicit-any
async function sinal(db: any, valor: number, de: number, ate: number) {
  const { r, dados } = await montar(db, 75);
  const ddmm = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  if (!r.saldo || r.saldo.atual == null) return { vencer_a_partir_de: null, sinal: 'o Caixa está sem saldo informado: não dá para sugerir a data' };
  const colchao = Number(dados.caixa_colchao_compras) || 0;
  // deno-lint-ignore no-explicit-any
  const dias = (r.proximos_dias as any[]).filter(x => x.saldo_fim_do_dia != null);
  const hoje = r.hoje as string, soma = (n: number) => new Date(Date.parse(hoje + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const ini = soma(de), fim = soma(ate), horizonte = dias.length ? dias[dias.length - 1].data : hoje;
  for (const d of dias.filter(x => x.dia_util && x.data >= ini && x.data <= fim)) {
    if (dias.filter(x => x.data >= d.data).every(x => x.saldo_fim_do_dia - valor >= colchao)) {
      return { vencer_a_partir_de: d.data, sinal: 'melhor vencer a partir de ' + ddmm(d.data), previsao_ate: horizonte };
    }
  }
  return { vencer_a_partir_de: null, sinal: 'o caixa não comporta esse valor de uma vez até ' + ddmm(fim) + ': melhor parcelar ou adiar', previsao_ate: horizonte };
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response(JSON.stringify({ erro: 'só GET' }), { status: 405, headers: Object.assign({ Allow: 'GET' }, cabecalhos) });
  const auth = req.headers.get('authorization') ?? '';
  const senha = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (senha.length < 32) return resposta(401, { erro: 'Senha de leitura inválida.' });

  const servico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(Deno.env.get('SUPABASE_URL')!, servico, { auth: { persistSession: false } });
  // a crm-assistente (com a chave de serviço) só pode pedir o sinal do vencimento
  if (iguais(await sha256(senha), await sha256(servico))) {
    const u0 = new URL(req.url);
    if (u0.searchParams.get('parte') !== 'sinal') return resposta(401, { erro: 'Senha de leitura inválida.' });
    const valor = Number(u0.searchParams.get('valor')), de = Number(u0.searchParams.get('de') ?? 7), ate = Number(u0.searchParams.get('ate') ?? 45);
    if (!(valor > 0) || !(de >= 0) || !(ate >= de) || ate > 75) return resposta(400, { erro: 'valor, de ou ate inválidos' });
    try { return resposta(200, await sinal(db, valor, Math.round(de), Math.round(ate))); }
    catch (e) { console.error('[crm-caixa-leitura] sinal: ' + ((e as Error).message || 'falha')); return resposta(500, { erro: 'Falha ao montar o sinal.' }); }
  }
  const { data: chaves, error: e1 } = await db.from('crm_integracoes').select('token_hash').eq('uso', 'caixa').eq('ativo', true);
  if (e1) return resposta(500, { erro: 'Falha ao conferir a senha.' });
  const h = await sha256(senha);
  let ok = false;
  for (const c of chaves ?? []) if (iguais(h, String(c.token_hash))) ok = true; // sem sair no meio: mesmo tempo para todas
  if (!ok) return resposta(401, { erro: 'Senha de leitura inválida.' });

  try {
    const url = new URL(req.url);
    if (url.searchParams.get('parte') === 'ceo') {
      const { data, error } = await db.rpc('crm_ceo_resumo');
      if (error) throw new Error('crm_ceo_resumo: ' + error.message);
      return resposta(200, data);
    }
    const dias = Math.min(90, Math.max(1, parseInt(url.searchParams.get('dias') ?? '30', 10) || 30));
    const { r } = await montar(db, dias);
    return resposta(200, r);
  } catch (e) {
    console.error('[crm-caixa-leitura] ' + ((e as Error).message || 'falha')); // só a mensagem, sem dado
    return resposta(500, { erro: 'Falha ao montar o resumo.' });
  }
});
