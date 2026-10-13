// Edge Function: LÊ o documento colado no Caixa (13/10/2026, pedido do Anderson): print do extrato,
// comprovante de Pix, boleto ou PDF. O CRM já enviou o arquivo ao bucket privado crm-caixa-anexos; aqui
// ele é baixado com a chave de serviço, lido pelo Claude e devolvido como MOVIMENTOS (tipo, valor, dia,
// quem, CNPJ/CPF). O CRM transforma cada movimento em frase e abre a mesma conferência das frases: nada
// é gravado aqui, e nada é lançado sem o administrador conferir.
//   POST { acao: 'situacao' }                          → { ligado } (a chave da IA está configurada?)
//   POST { caminho: 'caixa/AAAA-MM/…', nota?, hoje }  → { movimentos: [...], aviso }
// Só o administrador (o Caixa é só dele). A chave da Anthropic fica SÓ nos segredos do Supabase
// (ANTHROPIC_API_KEY) — nunca no app, no repositório ou no chat. Deploy: verify_jwt ligado (o padrão).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import Anthropic from 'npm:@anthropic-ai/sdk@0.129.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const BUCKET = 'crm-caixa-anexos';
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGENS: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

// o que o Claude devolve (saída estruturada: sempre um JSON neste formato)
const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['movimentos', 'aviso'],
  properties: {
    movimentos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'valor', 'data', 'situacao', 'quem', 'documento', 'descricao'],
        properties: {
          tipo: { type: 'string', enum: ['entrada', 'saida'] },
          valor: { type: 'number' },
          data: { type: 'string', description: 'AAAA-MM-DD' },
          situacao: { type: 'string', enum: ['realizado', 'previsto'] },
          quem: { type: 'string', description: 'quem pagou (entrada) ou a quem foi pago (saída), como está no documento; vazio se não aparece' },
          documento: { type: 'string', description: 'CNPJ ou CPF só com dígitos; vazio se não aparece' },
          descricao: { type: 'string', description: 'do que se trata, curto (ex.: Pix recebido, boleto de energia, tarifa)' }
        }
      }
    },
    aviso: { type: 'string', description: 'o que ficou ilegível ou em dúvida; vazio se nada' }
  }
};

const SISTEMA = 'Você lê documentos financeiros da OneClean (distribuidora de produtos de limpeza em São Bernardo do Campo) para o caixa da empresa: ' +
  'prints do extrato do Banco do Brasil, comprovantes de Pix e TED, boletos, notas e recibos. Devolva cada movimento de dinheiro que o documento mostra. ' +
  'Regras: crédito, "C", "Pix - Recebido", depósito = entrada; débito, "D", pagamento, Pix enviado, tarifa = saída. ' +
  'Valor em reais, número com ponto decimal (134.84). Data no formato AAAA-MM-DD; sem ano no documento, use o ano de hoje. ' +
  'Situação "realizado" para o que já aconteceu (extrato, comprovante); "previsto" para boleto ou conta ainda por pagar (use o vencimento). ' +
  'Em "quem", copie o nome como aparece (o banco às vezes corta o nome, não complete). Em "documento", o CNPJ ou CPF da outra parte, só dígitos. ' +
  'Não invente: se um valor ou data não estiver legível, deixe o movimento de fora e diga em "aviso". ' +
  'A anotação de quem colou vale como contexto (ex.: "entrou hoje" confirma que é entrada realizada), mas o documento manda nos números. ' +
  'Saldos, limites e totais do extrato não são movimentos.';

function base64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: quem } = await comoUsuario.auth.getUser();
  if (!quem?.user) return resposta(401, { erro: 'faça login de novo' });
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: eu } = await db.from('crm_usuarios').select('papel, ativo').eq('user_id', quem.user.id).maybeSingle();
  if (!eu || !eu.ativo || eu.papel !== 'admin') return resposta(403, { erro: 'só o administrador usa o Caixa' });
  const chave = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  let c: { acao?: string; caminho?: string; nota?: string; hoje?: string };
  try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  if (c.acao === 'situacao') return resposta(200, { ligado: !!chave });
  if (!chave) return resposta(503, { erro: 'a leitura de documentos ainda não está ligada: falta a chave da Anthropic nos segredos do Supabase (ANTHROPIC_API_KEY)' });

  const caminho = String(c.caminho ?? '');
  if (!/^caixa\/\d{4}-\d{2}\/[\w.-]{1,160}$/.test(caminho)) return resposta(400, { erro: 'arquivo inválido' });
  const { data: arquivo, error: e1 } = await db.storage.from(BUCKET).download(caminho);
  if (e1 || !arquivo) return resposta(404, { erro: 'arquivo não encontrado' });
  if (arquivo.size > MAX_BYTES) return resposta(413, { erro: 'arquivo maior que 10 MB' });
  const ext = (caminho.split('.').pop() ?? '').toLowerCase();
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const dados = base64(bytes);
  const bloco = ext === 'pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: dados } }
    : IMAGENS[ext] ? { type: 'image' as const, source: { type: 'base64' as const, media_type: IMAGENS[ext] as 'image/png', data: dados } } : null;
  if (!bloco) return resposta(400, { erro: 'só imagem (PNG, JPG, WEBP, GIF) ou PDF' });
  const hoje = /^\d{4}-\d{2}-\d{2}$/.test(String(c.hoje)) ? String(c.hoje)
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const nota = String(c.nota ?? '').slice(0, 500).trim();

  const ia = new Anthropic({ apiKey: chave });
  try {
    const r = await ia.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
      system: SISTEMA,
      messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Hoje é ' + hoje + '.' + (nota ? '\nAnotação de quem colou: ' + nota : '') }] }]
      // deno-lint-ignore no-explicit-any
    } as any);
    if (r.stop_reason === 'refusal') return resposta(422, { erro: 'a IA não leu este documento; lance pela frase' });
    if (r.stop_reason === 'max_tokens') return resposta(422, { erro: 'documento grande demais para ler de uma vez' });
    // deno-lint-ignore no-explicit-any
    const texto = (r.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('');
    const lido = JSON.parse(texto);
    // deno-lint-ignore no-explicit-any
    const movimentos = (Array.isArray(lido.movimentos) ? lido.movimentos : []).filter((m: any) =>
      (m.tipo === 'entrada' || m.tipo === 'saida') && Number(m.valor) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(m.data))).slice(0, 40)
      // deno-lint-ignore no-explicit-any
      .map((m: any) => ({ tipo: m.tipo, valor: Math.round(Number(m.valor) * 100) / 100, data: m.data, situacao: m.situacao === 'previsto' ? 'previsto' : 'realizado',
        quem: String(m.quem ?? '').slice(0, 120), documento: String(m.documento ?? '').replace(/\D/g, '').slice(0, 14), descricao: String(m.descricao ?? '').slice(0, 120) }));
    return resposta(200, { movimentos, aviso: String(lido.aviso ?? '').slice(0, 500) });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return resposta(503, { erro: 'a chave da Anthropic (ANTHROPIC_API_KEY) foi recusada: confira nos segredos do Supabase' });
    if (e instanceof Anthropic.RateLimitError) return resposta(429, { erro: 'a IA está ocupada; tente de novo em um minuto' });
    if (e instanceof Anthropic.APIError) { console.error('[crm-caixa-ler] API ' + e.status); return resposta(502, { erro: 'a IA não respondeu (' + e.status + ')' }); }
    console.error('[crm-caixa-ler] ' + ((e as Error).message || 'falha'));
    return resposta(500, { erro: 'não consegui ler o documento' });
  }
});
