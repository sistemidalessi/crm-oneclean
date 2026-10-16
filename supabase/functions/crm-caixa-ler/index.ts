// Edge Function: LÊ o documento colado no Caixa (13/10/2026, pedido do Anderson): print do extrato,
// comprovante de Pix, boleto ou PDF. O CRM já enviou o arquivo ao bucket privado crm-caixa-anexos; aqui
// ele é baixado com a chave de serviço, lido pelo Claude e devolvido como MOVIMENTOS (tipo, valor, dia,
// quem, CNPJ/CPF). O CRM transforma cada movimento em frase e abre a mesma conferência das frases: nada
// é gravado aqui, e nada é lançado sem o administrador conferir.
//   POST { acao: 'situacao' }                          → { ligado } (a chave da IA está configurada?)
//   POST { caminho: 'caixa/AAAA-MM/…', nota?, hoje }  → { movimentos: [...], aviso }
//   POST { modo: 'boleto', caminho: 'boletos/AAAA-MM/…' } → { boletos: [...], aviso } (14/10/2026: 2ª via
//        atualizada do BB, no bucket crm-boletos — Caixa → Cobrança; o CRM acha o título e entrega à vendedora)
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
const BUCKET = 'crm-caixa-anexos', BUCKET_BOLETOS = 'crm-boletos';
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
          documento: { type: 'string', description: 'CNPJ ou CPF sem pontuação (só números; o CNPJ novo pode ter letras maiúsculas); vazio se não aparece' },
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
  'Em "quem", copie o nome como aparece (o banco às vezes corta o nome, não complete). Em "documento", o CNPJ ou CPF da outra parte, sem pontuação (o CNPJ novo pode ter letras). ' +
  'Não invente: se um valor ou data não estiver legível, deixe o movimento de fora e diga em "aviso". ' +
  'A anotação de quem colou vale como contexto (ex.: "entrou hoje" confirma que é entrada realizada), mas o documento manda nos números. ' +
  'Saldos, limites e totais do extrato não são movimentos.';

// Boletos (2ª via atualizada): um item por boleto do arquivo (um PDF pode ter vários, um por página).
const ESQUEMA_BOLETO = {
  type: 'object',
  additionalProperties: false,
  required: ['boletos', 'aviso'],
  properties: {
    boletos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pagina', 'pagador', 'documento', 'numero_documento', 'nosso_numero', 'valor_documento', 'valor_cobrado', 'vencimento', 'linha_digitavel'],
        properties: {
          pagina: { type: 'integer', description: 'página do PDF onde está o boleto (1 = primeira); imagem: 1' },
          pagador: { type: 'string', description: 'nome do pagador (sacado), como está' },
          documento: { type: 'string', description: 'CNPJ ou CPF do pagador, sem pontuação (o CNPJ novo pode ter letras maiúsculas); vazio se não aparece' },
          numero_documento: { type: 'string', description: 'campo "Nº do documento" (costuma ser o número da nota ou da duplicata), como está' },
          nosso_numero: { type: 'string', description: 'campo "Nosso número", como está' },
          valor_documento: { type: 'number', description: 'valor original do título ("Valor do documento"); 0 se não aparece' },
          valor_cobrado: { type: 'number', description: 'o total a pagar neste boleto, com juros e multa ("Valor cobrado" ou o valor atualizado da 2ª via); 0 se não aparece' },
          vencimento: { type: 'string', description: 'vencimento deste boleto, AAAA-MM-DD' },
          linha_digitavel: { type: 'string', description: 'linha digitável completa, só os 47 dígitos' }
        }
      }
    },
    aviso: { type: 'string', description: 'o que ficou ilegível ou em dúvida; vazio se nada' }
  }
};
const SISTEMA_BOLETO = 'Você lê boletos bancários (2ª via atualizada, com juros e multa) que a OneClean emite pelo Banco do Brasil contra os clientes dela. ' +
  'Devolva cada boleto do documento, um item por boleto, com a página em que ele está. Valor em reais com ponto decimal (950.12). Datas AAAA-MM-DD. ' +
  'A linha digitável tem 47 dígitos: copie todos, só os números, conferindo dígito a dígito. CNPJ/CPF do pagador só com dígitos. ' +
  'Na 2ª via do Banco do Brasil é NORMAL a linha digitável e o código de barras manterem o valor e o vencimento originais, com o valor atualizado (juros, multa) só em "(=) Valor cobrado": ' +
  'nesse caso valor_documento = o original, valor_cobrado = o atualizado, vencimento = o que está no boleto, e não avise nada sobre isso. ' +
  'Não invente: campo ilegível fica vazio (ou 0) e você diz em "aviso" (curto, só o que ficou ilegível). Recibo do pagador e ficha de compensação do mesmo boleto são um boleto só.';

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
  let c: { acao?: string; modo?: string; caminho?: string; nota?: string; hoje?: string };
  try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  if (c.acao === 'situacao') return resposta(200, { ligado: !!chave });
  if (!chave) return resposta(503, { erro: 'a leitura de documentos ainda não está ligada: falta a chave da Anthropic nos segredos do Supabase (ANTHROPIC_API_KEY)' });

  const boleto = c.modo === 'boleto';
  const caminho = String(c.caminho ?? '');
  if (!(boleto ? /^boletos\/\d{4}-\d{2}\/[\w.-]{1,160}$/ : /^caixa\/\d{4}-\d{2}\/[\w.-]{1,160}$/).test(caminho)) return resposta(400, { erro: 'arquivo inválido' });
  const { data: arquivo, error: e1 } = await db.storage.from(boleto ? BUCKET_BOLETOS : BUCKET).download(caminho);
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
      output_config: { effort: boleto ? 'medium' : 'low', format: { type: 'json_schema', schema: boleto ? ESQUEMA_BOLETO : ESQUEMA } },
      system: boleto ? SISTEMA_BOLETO : SISTEMA,
      messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Hoje é ' + hoje + '.' + (nota ? '\nAnotação de quem colou: ' + nota : '') }] }]
      // deno-lint-ignore no-explicit-any
    } as any);
    if (r.stop_reason === 'refusal') return resposta(422, { erro: 'a IA não leu este documento; lance pela frase' });
    if (r.stop_reason === 'max_tokens') return resposta(422, { erro: 'documento grande demais para ler de uma vez' });
    // deno-lint-ignore no-explicit-any
    const texto = (r.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('');
    const lido = JSON.parse(texto);
    if (boleto) {
      const d2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
      // deno-lint-ignore no-explicit-any
      const boletos = (Array.isArray(lido.boletos) ? lido.boletos : []).filter((b: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(b.vencimento)) && (Number(b.valor_cobrado) > 0 || Number(b.valor_documento) > 0)).slice(0, 60)
        // deno-lint-ignore no-explicit-any
        .map((b: any) => ({ pagina: Math.max(1, Math.min(500, Math.round(Number(b.pagina) || 1))), pagador: String(b.pagador ?? '').slice(0, 120), documento: String(b.documento ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14),
          numero_documento: String(b.numero_documento ?? '').slice(0, 40), nosso_numero: String(b.nosso_numero ?? '').slice(0, 40), valor_documento: d2(b.valor_documento), valor_cobrado: d2(b.valor_cobrado),
          vencimento: b.vencimento, linha_digitavel: String(b.linha_digitavel ?? '').replace(/\D/g, '').slice(0, 48) }));
      return resposta(200, { boletos, aviso: String(lido.aviso ?? '').slice(0, 500) });
    }
    // deno-lint-ignore no-explicit-any
    const movimentos = (Array.isArray(lido.movimentos) ? lido.movimentos : []).filter((m: any) =>
      (m.tipo === 'entrada' || m.tipo === 'saida') && Number(m.valor) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(m.data))).slice(0, 40)
      // deno-lint-ignore no-explicit-any
      .map((m: any) => ({ tipo: m.tipo, valor: Math.round(Number(m.valor) * 100) / 100, data: m.data, situacao: m.situacao === 'previsto' ? 'previsto' : 'realizado',
        quem: String(m.quem ?? '').slice(0, 120), documento: String(m.documento ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14), descricao: String(m.descricao ?? '').slice(0, 120) }));
    return resposta(200, { movimentos, aviso: String(lido.aviso ?? '').slice(0, 500) });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return resposta(503, { erro: 'a chave da Anthropic (ANTHROPIC_API_KEY) foi recusada: confira nos segredos do Supabase' });
    if (e instanceof Anthropic.RateLimitError) return resposta(429, { erro: 'a IA está ocupada; tente de novo em um minuto' });
    if (e instanceof Anthropic.APIError) { console.error('[crm-caixa-ler] API ' + e.status); return resposta(502, { erro: 'a IA não respondeu (' + e.status + ')' }); }
    console.error('[crm-caixa-ler] ' + ((e as Error).message || 'falha'));
    return resposta(500, { erro: 'não consegui ler o documento' });
  }
});
