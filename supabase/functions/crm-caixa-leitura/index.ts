// Edge Function: endereço de LEITURA do Caixa da OneClean (06/10/2026), para a aba "Geral" do sistema
// da Agilité (as duas empresas juntas, com o que passa entre elas anulado) e para a sessão gestora do
// grupo. Mesmo formato do GET /api/ceo/resumo da Agilité.
//   GET …/functions/v1/crm-caixa-leitura?dias=30        (dias de 1 a 90; padrão 30)
//   Authorization: Bearer <senha de leitura>
// A senha é gerada pelo administrador em Configurações → Integrações → "Leitura do Caixa" (aparece uma
// vez só; aqui fica só o SHA-256, em crm_integracoes com uso = 'caixa'). Sem senha ou com senha errada:
// 401 e nada mais. Só GET (o resto: 405). Não grava nada, nem registro de uso.
// As contas NÃO são copiadas para cá: a função baixa caixa-calculo.js (o mesmo arquivo da tela do
// Caixa) do GitHub num commit FIXO e confere o SHA-256 antes de usar. Depois de mexer nele: commit +
// push, `node ferramentas/fixa-motor-notas.js` (fixa as duas funções) e publicar esta de novo.
// A chave de serviço só existe aqui dentro (variável do Supabase); nunca vai para o app nem para
// quem chama. Deploy: verify_jwt DESLIGADO (a senha é conferida aqui).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const COMMIT = '6df099ab34dea5594811db3bf3a0a8a7011dd6ee';
const HASHES: Record<string, string> = { 'caixa-calculo.js': 'b499e2e046df9def39201c8ca6e94c80ccf5ee1bd44410ae1eda880f24eb2c79' };
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

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response(JSON.stringify({ erro: 'só GET' }), { status: 405, headers: Object.assign({ Allow: 'GET' }, cabecalhos) });
  const auth = req.headers.get('authorization') ?? '';
  const senha = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (senha.length < 32) return resposta(401, { erro: 'Senha de leitura inválida.' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: chaves, error: e1 } = await db.from('crm_integracoes').select('token_hash').eq('uso', 'caixa').eq('ativo', true);
  if (e1) return resposta(500, { erro: 'Falha ao conferir a senha.' });
  const h = await sha256(senha);
  let ok = false;
  for (const c of chaves ?? []) if (iguais(h, String(c.token_hash))) ok = true; // sem sair no meio: mesmo tempo para todas
  if (!ok) return resposta(401, { erro: 'Senha de leitura inválida.' });

  try {
    const url = new URL(req.url);
    const dias = Math.min(90, Math.max(1, parseInt(url.searchParams.get('dias') ?? '30', 10) || 30));
    const K = await carregaMotor();
    const [lancamentos, saldos, recorrentes, titulos, usuarios, cfg] = await Promise.all([
      tudo(db, 'crm_fin_lancamentos', 'id, tipo, descricao, fornecedor, categoria, valor, vencimento, situacao, pago_em, baixa, baixado_em, entre_empresas, origem, recorrente_id, titulo_duplicata, emprestimo, juros'),
      tudo(db, 'crm_fin_saldos', 'id, data, valor, criado_em'),
      tudo(db, 'crm_fin_recorrentes', 'id, descricao'),
      tudo(db, 'crm_titulos', 'duplicata, empresa_id, cliente_nome, valor, vencimento, previsao', 'duplicata'),
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
    // deno-lint-ignore no-explicit-any
    const tits = (titulos as any[]).map(t => Object.assign({}, t, { cliente: (t.empresa_id && nomes.get(t.empresa_id)) || t.cliente_nome || 'Cliente' }));
    // deno-lint-ignore no-explicit-any
    const dados = ((cfg as any).data && (cfg as any).data.dados) || {};
    const r = K.resumoLeitura({ lancamentos, saldos, recorrentes, titulos: tits, pessoas: (usuarios as { nome: string }[]).map(u => u.nome) },
      { hoje: hojeSP(), dias, d1: dados.caixa_credito_d1 !== false, gerado_em: new Date().toISOString() });
    return resposta(200, r);
  } catch (e) {
    console.error('[crm-caixa-leitura] ' + ((e as Error).message || 'falha')); // só a mensagem, sem dado
    return resposta(500, { erro: 'Falha ao montar o resumo.' });
  }
});
