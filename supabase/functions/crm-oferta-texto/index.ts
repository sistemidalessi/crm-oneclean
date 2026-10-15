// Edge Function: ESCREVE os textos da oferta de queima de estoque (15/10/2026, pedido do Anderson: "um agente
// que monte as mensagens de marketing"). Recebe a oferta (título, validade e itens com preço de oferta e de
// tabela, nunca o custo) e devolve assunto e texto do e-mail e o texto do WhatsApp, com as variáveis do CRM
// ({saudacao}, {vendedor_primeiro_nome}, {itens}…) no lugar dos dados de cada cliente. Nada é enviado aqui:
// o texto volta para a tela, a líder ou o administrador confere e salva na oferta.
//   POST { acao: 'situacao' }                                  → { ligado }
//   POST { titulo, validade, itens: [{ descricao, unidade, preco, preco_tabela }], pedido? } → { assunto, corpo, whatsapp }
// Só administrador e gestora. A chave da Anthropic fica SÓ nos segredos do Supabase (ANTHROPIC_API_KEY).
// Deploy: verify_jwt ligado (o padrão).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import Anthropic from 'npm:@anthropic-ai/sdk@0.129.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assunto', 'corpo', 'whatsapp'],
  properties: {
    assunto: { type: 'string', description: 'assunto do e-mail, até 90 caracteres' },
    corpo: { type: 'string', description: 'texto do e-mail, com a linha {itens} sozinha onde entra a tabela de preços' },
    whatsapp: { type: 'string', description: 'mensagem curta de WhatsApp, com a linha {itens} sozinha onde entra a lista' }
  }
};

const SISTEMA = `Você escreve mensagens comerciais da OneClean, distribuidora de produtos de limpeza, descartáveis, EPIs e copa
em São Bernardo do Campo (atende Grande São Paulo, ABC e Baixada Santista). Os clientes são empresas: condomínios,
escolas, clínicas, restaurantes, indústrias. Quem assina é a vendedora da carteira do cliente.

A tarefa: o texto de uma oferta de QUEIMA DE ESTOQUE, com preço especial por tempo limitado. Escreva em português do
Brasil, tom cordial, direto e profissional (B2B), sem exagero nem promessa que a empresa não pode cumprir.

Regras:
- Use estas variáveis literalmente, com as chaves, que o CRM troca pelos dados de cada cliente: {saudacao} (abre a
  mensagem, já vem com "Olá, Nome!"), {vendedor_primeiro_nome}, {vendedor}, {minha_empresa}, {validade} (data limite).
- Ponha a linha {itens} SOZINHA, no corpo do e-mail e no WhatsApp, no lugar da lista de produtos e preços. Não
  escreva nenhum preço, produto ou porcentagem fora dela: os preços vêm do sistema.
- Não diga "preço de custo", "prejuízo", "encalhado", "parado" nem nada que desvalorize o produto. Diga queima de
  estoque, condição especial, oportunidade.
- Diga que vale até {validade} ou enquanto durar o estoque, e peça para responder com os itens e as quantidades.
- E-mail: 4 a 7 frases curtas em 2 ou 3 parágrafos antes de {itens}, um fechamento curto depois, e assine com
  "Um abraço," e {vendedor} na linha de baixo. Assunto com até 90 caracteres.
- WhatsApp: no máximo 4 linhas além de {itens}; pode usar 1 ou 2 emojis; sem assinatura.
- Se vier um pedido de quem está montando a oferta, siga o pedido dentro destas regras.`;

const temItens = (t: string) => /\{itens\}/.test(t);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: quem } = await comoUsuario.auth.getUser();
  if (!quem?.user) return resposta(401, { erro: 'faça login de novo' });
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: eu } = await db.from('crm_usuarios').select('papel, ativo').eq('user_id', quem.user.id).maybeSingle();
  if (!eu || !eu.ativo || !['admin', 'gestor'].includes(eu.papel)) return resposta(403, { erro: 'só o administrador e a líder montam ofertas' });
  const chave = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  let c: { acao?: string; titulo?: string; validade?: string; itens?: unknown[]; pedido?: string };
  try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  if (c.acao === 'situacao') return resposta(200, { ligado: !!chave });
  if (!chave) return resposta(503, { erro: 'a IA ainda não está ligada: falta a chave da Anthropic nos segredos do Supabase (ANTHROPIC_API_KEY)' });

  // deno-lint-ignore no-explicit-any
  const itens = (Array.isArray(c.itens) ? c.itens : []).slice(0, 40).map((x: any) => ({
    descricao: String(x?.descricao ?? '').slice(0, 120), unidade: String(x?.unidade ?? '').slice(0, 10),
    preco: Math.round(Number(x?.preco) * 100) / 100, preco_tabela: Number(x?.preco_tabela) > 0 ? Math.round(Number(x.preco_tabela) * 100) / 100 : null
  })).filter(x => x.descricao && x.preco > 0);
  if (!itens.length) return resposta(400, { erro: 'a oferta não tem itens' });
  const titulo = String(c.titulo ?? '').slice(0, 120);
  const validade = /^\d{4}-\d{2}-\d{2}$/.test(String(c.validade)) ? String(c.validade).split('-').reverse().join('/') : '';
  const pedido = String(c.pedido ?? '').slice(0, 600).trim();
  const lista = itens.map(x => '- ' + x.descricao + (x.unidade ? ' (' + x.unidade + ')' : '') + ': R$ ' + x.preco.toFixed(2).replace('.', ',') +
    (x.preco_tabela && x.preco_tabela > x.preco ? ' (tabela R$ ' + x.preco_tabela.toFixed(2).replace('.', ',') + ')' : '')).join('\n');

  const ia = new Anthropic({ apiKey: chave });
  try {
    const r = await ia.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
      system: SISTEMA,
      messages: [{ role: 'user', content: 'Oferta: ' + (titulo || 'queima de estoque') + (validade ? '\nVálida até ' + validade : '') +
        '\nProdutos (só para você entender o que é; NÃO repita na mensagem, use {itens}):\n' + lista + (pedido ? '\n\nPedido de quem está montando: ' + pedido : '') }]
      // deno-lint-ignore no-explicit-any
    } as any);
    if (r.stop_reason === 'refusal') return resposta(422, { erro: 'a IA não escreveu este texto; escreva à mão' });
    if (r.stop_reason === 'max_tokens') return resposta(422, { erro: 'a IA não terminou o texto; tente de novo' });
    // deno-lint-ignore no-explicit-any
    const lido = JSON.parse((r.content as any[]).filter(b => b.type === 'text').map(b => b.text).join(''));
    let corpo = String(lido.corpo ?? '').trim().slice(0, 6000), whatsapp = String(lido.whatsapp ?? '').trim().slice(0, 1500);
    if (!temItens(corpo)) corpo += '\n\n{itens}';
    if (!temItens(whatsapp)) whatsapp += '\n{itens}';
    return resposta(200, { assunto: String(lido.assunto ?? '').trim().slice(0, 120), corpo, whatsapp });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return resposta(503, { erro: 'a chave da Anthropic (ANTHROPIC_API_KEY) foi recusada: confira nos segredos do Supabase' });
    if (e instanceof Anthropic.RateLimitError) return resposta(429, { erro: 'a IA está ocupada; tente de novo em um minuto' });
    if (e instanceof Anthropic.APIError) { console.error('[crm-oferta-texto] API ' + e.status); return resposta(502, { erro: 'a IA não respondeu (' + e.status + ')' }); }
    console.error('[crm-oferta-texto] ' + ((e as Error).message || 'falha'));
    return resposta(500, { erro: 'não consegui escrever o texto' });
  }
});
