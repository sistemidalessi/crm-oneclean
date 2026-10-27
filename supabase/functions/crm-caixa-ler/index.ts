// Edge Function: LÊ o documento colado no Caixa (13/10/2026, pedido do Anderson): print do extrato,
// comprovante de Pix, boleto ou PDF. O CRM já enviou o arquivo ao bucket privado crm-caixa-anexos; aqui
// ele é baixado com a chave de serviço, lido pelo Claude e devolvido como MOVIMENTOS (tipo, valor, dia,
// quem, CNPJ/CPF). O CRM transforma cada movimento em frase e abre a mesma conferência das frases: nada
// é gravado aqui, e nada é lançado sem o administrador conferir.
//   POST { acao: 'situacao' }                          → { ligado } (a chave da IA está configurada?)
//   POST { caminho: 'caixa/AAAA-MM/…', nota?, hoje }  → { movimentos: [...], aviso }
//   POST { modo: 'boleto', caminho: 'boletos/AAAA-MM/…' } → { boletos: [...], aviso } (14/10/2026: 2ª via
//        atualizada do BB, no bucket crm-boletos — Caixa → Cobrança; o CRM acha o título e entrega ao(à) vendedor(a))
//   POST { modo: 'credito', caminho: 'credito/<id do cliente>/…' } → { consulta: {...}, aviso } (27/10/2026: o PDF da
//        consulta de crédito que o Anderson tira na Rekta, no bucket crm-credito; a IA só LÊ os fatos — a proposta de
//        limite e prazo sai da política da OneClean em credito.js, no app, e quem aprova é o administrador)
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
const BUCKET = 'crm-caixa-anexos', BUCKET_BOLETOS = 'crm-boletos', BUCKET_CREDITO = 'crm-credito';
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
  'A linha digitável tem 47 dígitos: copie todos, só os números, conferindo dígito a dígito. CNPJ/CPF do pagador sem pontuação (o CNPJ novo pode ter letras). ' +
  'Na 2ª via do Banco do Brasil é NORMAL a linha digitável e o código de barras manterem o valor e o vencimento originais, com o valor atualizado (juros, multa) só em "(=) Valor cobrado": ' +
  'nesse caso valor_documento = o original, valor_cobrado = o atualizado, vencimento = o que está no boleto, e não avise nada sobre isso. ' +
  'Não invente: campo ilegível fica vazio (ou 0) e você diz em "aviso" (curto, só o que ficou ilegível). Recibo do pagador e ficha de compensação do mesmo boleto são um boleto só.';

// Consulta de crédito (Serasa, Boa Vista, Quod ou revenda como a Rekta): só os fatos do relatório, sem opinião.
const N = { type: 'number' }, I = { type: 'integer' }, T = { type: 'string' };
const ESQUEMA_CREDITO = {
  type: 'object',
  additionalProperties: false,
  required: ['consulta', 'aviso'],
  properties: {
    consulta: {
      type: 'object',
      additionalProperties: false,
      required: ['razao_social', 'documento', 'emitido_em', 'fundacao', 'situacao_cadastral', 'score', 'prob_inadimplencia', 'recomendacao',
        'pendencias_qtd', 'pendencias_valor', 'protestos_qtd', 'protestos_valor', 'cheques_qtd', 'acoes_qtd', 'falencia', 'fraude',
        'pontualidade', 'atraso_mais_60', 'limite_sugerido', 'faturamento_presumido', 'mudanca_societaria', 'mudanca_em', 'consultas_12m', 'alertas'],
      properties: {
        razao_social: T, documento: { type: 'string', description: 'CNPJ ou CPF consultado, sem pontuação' },
        emitido_em: { type: 'string', description: 'data do relatório, AAAA-MM-DD; vazio se não aparece' },
        fundacao: { type: 'string', description: 'data de fundação ou registro, AAAA-MM-DD; vazio se não aparece' },
        situacao_cadastral: { type: 'string', description: 'situação do CNPJ na Receita (Ativo, Baixado, Inapto…), como está' },
        score: { type: 'integer', description: 'score de crédito (0 a 1000); 0 se não aparece' },
        prob_inadimplencia: { type: 'number', description: 'probabilidade de inadimplência em %, número (3 para 3%); -1 se não aparece' },
        recomendacao: { type: 'string', description: 'a recomendação/decisão do relatório, como está (ex.: Negociação Recomendada)' },
        pendencias_qtd: I, pendencias_valor: N, protestos_qtd: I, protestos_valor: N, cheques_qtd: { type: 'integer', description: 'cheques sem fundo + sustados + devolvidos' },
        acoes_qtd: { type: 'integer', description: 'ações cíveis/judiciais' }, falencia: { type: 'boolean', description: 'falência ou recuperação judicial' },
        fraude: { type: 'boolean', description: 'há alerta de fraude' },
        pontualidade: { type: 'number', description: 'pagamento pontual mais recente, de 0 a 100 (100 = sempre em dia); -1 se não aparece' },
        atraso_mais_60: { type: 'boolean', description: 'há registro de atraso acima de 60 dias nos últimos 12 meses' },
        limite_sugerido: { type: 'number', description: 'limite de crédito sugerido pelo relatório, em reais; 0 se não aparece' },
        faturamento_presumido: { type: 'string', description: 'faixa de faturamento presumido, como está; vazio se não aparece' },
        mudanca_societaria: { type: 'string', description: 'troca de sócio, de razão social ou redução de capital, com a data, em uma frase; vazio se não há' },
        mudanca_em: { type: 'string', description: 'data da mudança societária mais recente, AAAA-MM-DD; vazio se não há' },
        consultas_12m: { type: 'integer', description: 'quantas consultas ao CNPJ nos últimos 12 meses' },
        alertas: { type: 'array', items: T, description: 'outros pontos de atenção em frases curtas (ex.: consulta de factoring, sem telefone, capital baixo)' }
      }
    },
    aviso: { type: 'string', description: 'o que ficou ilegível, ou se o documento não é uma consulta de crédito; vazio se nada' }
  }
};
const SISTEMA_CREDITO = 'Você lê relatórios de consulta de crédito de empresas (Serasa Experian, Boa Vista, Quod e revendas como a Rekta) para a OneClean, ' +
  'distribuidora de produtos de limpeza que vende a prazo por boleto. Copie os FATOS do relatório no formato pedido; não dê opinião nem decida o crédito. ' +
  'Valores em reais com ponto decimal. Datas AAAA-MM-DD. Quantidade zero quando o relatório diz "Não constam ocorrências" ou "-". ' +
  'Não invente: campo que não aparece fica com o valor de "não aparece" indicado. Se o documento não for uma consulta de crédito, diga em "aviso".';

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

  const boleto = c.modo === 'boleto', credito = c.modo === 'credito';
  const caminho = String(c.caminho ?? '');
  const forma = boleto ? /^boletos\/\d{4}-\d{2}\/[\w.-]{1,160}$/ : credito ? /^credito\/[0-9a-f-]{36}\/[\w.-]{1,160}$/ : /^caixa\/\d{4}-\d{2}\/[\w.-]{1,160}$/;
  if (!forma.test(caminho)) return resposta(400, { erro: 'arquivo inválido' });
  const { data: arquivo, error: e1 } = await db.storage.from(boleto ? BUCKET_BOLETOS : credito ? BUCKET_CREDITO : BUCKET).download(caminho);
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
      output_config: { effort: boleto || credito ? 'medium' : 'low', format: { type: 'json_schema', schema: boleto ? ESQUEMA_BOLETO : credito ? ESQUEMA_CREDITO : ESQUEMA } },
      system: boleto ? SISTEMA_BOLETO : credito ? SISTEMA_CREDITO : SISTEMA,
      messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Hoje é ' + hoje + '.' + (nota ? '\nAnotação de quem colou: ' + nota : '') }] }]
      // deno-lint-ignore no-explicit-any
    } as any);
    if (r.stop_reason === 'refusal') return resposta(422, { erro: credito ? 'a IA não leu esta consulta; preencha à mão' : 'a IA não leu este documento; lance pela frase' });
    if (r.stop_reason === 'max_tokens') return resposta(422, { erro: 'documento grande demais para ler de uma vez' });
    // deno-lint-ignore no-explicit-any
    const texto = (r.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('');
    const lido = JSON.parse(texto);
    if (credito) {
      const k = lido.consulta || {}, d2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100, n = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
      const dia = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : '');
      const txt = (v: unknown, m: number) => String(v ?? '').slice(0, m);
      const consulta = {
        razao_social: txt(k.razao_social, 160), documento: String(k.documento ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14),
        emitido_em: dia(k.emitido_em), fundacao: dia(k.fundacao), situacao_cadastral: txt(k.situacao_cadastral, 60),
        score: Math.min(1000, n(k.score)), prob_inadimplencia: Number(k.prob_inadimplencia) >= 0 ? d2(k.prob_inadimplencia) : -1, recomendacao: txt(k.recomendacao, 160),
        pendencias_qtd: n(k.pendencias_qtd), pendencias_valor: d2(k.pendencias_valor), protestos_qtd: n(k.protestos_qtd), protestos_valor: d2(k.protestos_valor),
        cheques_qtd: n(k.cheques_qtd), acoes_qtd: n(k.acoes_qtd), falencia: !!k.falencia, fraude: !!k.fraude,
        pontualidade: Number(k.pontualidade) >= 0 ? Math.min(100, d2(k.pontualidade)) : -1, atraso_mais_60: !!k.atraso_mais_60,
        limite_sugerido: d2(k.limite_sugerido), faturamento_presumido: txt(k.faturamento_presumido, 120),
        mudanca_societaria: txt(k.mudanca_societaria, 240), mudanca_em: dia(k.mudanca_em), consultas_12m: n(k.consultas_12m),
        alertas: (Array.isArray(k.alertas) ? k.alertas : []).slice(0, 8).map((a: unknown) => txt(a, 200))
      };
      return resposta(200, { consulta, aviso: String(lido.aviso ?? '').slice(0, 500) });
    }
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
