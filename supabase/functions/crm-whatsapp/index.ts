// Edge Function: WhatsApp oficial da Meta (Cloud API) — 15/10/2026, pedido do Anderson: no "Mandar às
// vendedores(as)" o CRM manda SOZINHO, a cada vendedor(a), o boleto atualizado com o PDF completo (resumo, DANFE e
// boleto do banco) anexo, pelo número da OneClean na Meta. Sem a API, o navegador só abria a conversa com link.
//   POST { acao: 'situacao' }                 → { ligado, numero, modelo } (o que a Meta diz do número e do modelo)
//   POST { acao: 'criar_modelo' }             → cria o modelo "boleto_vendedora" (categoria utilidade, PDF no cabeçalho)
//   POST { acao: 'registrar', pin }           → registra o número na Cloud API (PIN de 6 dígitos escolhido pelo admin)
//   POST { acao: 'teste' }                    → manda o modelo com um PDF de exemplo ao celular de quem chamou
//   POST { acao: 'enviar', boletos: [ids] }   → um envio por cliente (os boletos do cliente dividem o PDF completo); o PDF
//                                               sobe para a Meta antes (desde 20/10) e vai anexo; também serve para reenviar
//   POST { acao: 'criar_modelo_cliente' }     → cria o modelo "boleto_cliente" (PDF, botões "Falar comigo" e "Já paguei")
//   POST { acao: 'assinar_retorno' }          → liga a conta da Meta ao app, para o retorno (crm-whatsapp-retorno) chegar
//   POST { acao: 'pronto' }                   → { cliente } (qualquer pessoa da equipe: o envio ao cliente está liberado?)
//   POST { acao: 'cliente', boletos, telefone } → 20/10/2026, pedido do Anderson: o boleto vai ao CLIENTE pelo número da
//                                               OneClean, com o PDF anexo, em nome do(a) vendedor(a) da carteira, com o aviso
//                                               cordial do prazo do cartório. Vendedor(a) da carteira, gestor(a) ou admin.
// O resto, só o administrador. A chave da Meta fica SÓ nos segredos do Supabase (WHATSAPP_TOKEN, token permanente de um
// usuário do sistema do portfólio OneClean); os IDs do número, da conta e do app também ficam lá (não são segredo).
// Deploy: verify_jwt ligado (o padrão).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const GRAPH = 'https://graph.facebook.com/v25.0';
const MODELO = 'boleto_vendedora';
const MODELO_CLIENTE = 'boleto_cliente';
const EMPRESA = Deno.env.get('CRM_EMPRESA_NOME') ?? 'OneClean';
const PRAZO_PADRAO = 5; // dias úteis até o cartório, se a instalação não disser outro (crm_config.dados.cobranca_prazo_cartorio)
const BUCKET = 'crm-boletos';
const SETE_DIAS = 7 * 86400;

const moeda = (v: number) => { const [i, d] = Math.abs(Number(v) || 0).toFixed(2).split('.'); return (v < 0 ? '-' : '') + 'R$ ' + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d; };
const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
function telefoneWa(v: unknown): string {
  let d = digitos(v);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.length >= 12 && d.length <= 13 ? d : '';
}
// parâmetro do modelo: a Meta recusa quebra de linha, tabulação e mais de 4 espaços seguidos
const param = (t: string) => ({ type: 'text', text: String(t || '-').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 900) });
const formataLinha = (l: string) => {
  const d = digitos(l);
  return d.length !== 47 ? d : d.slice(0, 5) + '.' + d.slice(5, 10) + ' ' + d.slice(10, 15) + '.' + d.slice(15, 21) + ' ' + d.slice(21, 26) + '.' + d.slice(26, 32) + ' ' + d[32] + ' ' + d.slice(33);
};
const nomeArq = (t: string) => t.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110) + '.pdf';

// PDF mínimo (exemplo para a Meta aprovar o modelo e para o teste)
function pdfExemplo(): Uint8Array<ArrayBuffer> {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const texto = 'BT /F1 18 Tf 60 780 Td (OneClean - boleto atualizado \\(exemplo\\)) Tj ET';
  objs[3] = '<< /Length ' + texto.length + ' >>\nstream\n' + texto + '\nendstream';
  let s = '%PDF-1.4\n';
  const pos: number[] = [];
  objs.forEach((o, i) => { pos.push(s.length); s += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = s.length;
  s += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + pos.map(p => String(p).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return new TextEncoder().encode(s);
}

async function graph(token: string, caminho: string, init: RequestInit = {}) {
  const r = await fetch(caminho.startsWith('http') ? caminho : GRAPH + caminho, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) } });
  let j: Record<string, unknown> = {};
  try { j = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) {
    const e = (j.error || {}) as Record<string, unknown>;
    throw new Error(String(e.error_user_msg || e.message || 'a Meta respondeu ' + r.status) + (e.code ? ' (código ' + e.code + ')' : ''));
  }
  return j;
}
const jsonPost = (corpo: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });

// texto do modelo (pt_BR, utilidade). {{1}} vendedor(a) · {{2}} cliente · {{3}} nota e valor · {{4}} linha digitável
const CORPO = 'Olá, {{1}}! O financeiro atualizou o boleto de {{2}}: {{3}}. Linha digitável: {{4}}. ' +
  'O PDF completo (resumo, nota fiscal e boleto do banco) está anexo: encaminhe ao cliente. Quando ele responder, avise o financeiro.';

// mensagem ao cliente (pt_BR, utilidade). {{1}} cliente · {{2}} vendedor(a) · {{3}} notas e vencimento · {{4}} valor ·
// {{5}} linha digitável · {{6}} prazo do cartório. Texto aprovado pelo Anderson na simulação de 20/10/2026.
const CORPO_CLIENTE = 'Olá, {{1}}! Aqui é {{2}}, da ' + EMPRESA + '.\n\n' +
  'Consta em aberto {{3}}. Segue o boleto atualizado em PDF, com a cópia da nota fiscal.\n\n' +
  'Valor para pagar: {{4}}\nLinha digitável: {{5}}\n\n' +
  'Para sua tranquilidade, pedimos a gentileza de regularizar até {{6}}. Depois dessa data, o título segue automaticamente para o cartório, e gostaríamos muito de evitar esse transtorno para você.\n\n' +
  'Se já tiver pago, por favor desconsidere e toque em "Já paguei". Qualquer dúvida, fale comigo pelo botão abaixo. Agradecemos a parceria!';
const BOTAO_FALAR = 'Falar comigo'; // serve a qualquer pessoa da equipe (casa com o "fale comigo pelo botão abaixo")
const BOTAO_PAGUEI = 'Já paguei';

async function sobePdf(token: string, phoneId: string, pdf: Uint8Array<ArrayBuffer> | ArrayBuffer, nome: string) {
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('type', 'application/pdf');
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), nome);
  const media = await graph(token, '/' + phoneId + '/media', { method: 'POST', body: fd });
  if (!media.id) throw new Error('a Meta não devolveu o id do PDF');
  return String(media.id);
}
async function exemploPdfHandle(token: string, appId: string) {
  // a Meta pede um PDF de exemplo para aprovar o modelo, enviado pela "carga retomável" do app
  const pdf = pdfExemplo();
  const sessao = await graph(token, '/' + appId + '/uploads?file_name=exemplo.pdf&file_length=' + pdf.length + '&file_type=application/pdf', { method: 'POST' });
  const up = await fetch(GRAPH + '/' + sessao.id, { method: 'POST', headers: { Authorization: 'OAuth ' + token, file_offset: '0' }, body: pdf });
  const uj = await up.json();
  if (!up.ok || !uj.h) throw new Error('não consegui enviar o PDF de exemplo à Meta: ' + JSON.stringify(uj).slice(0, 200));
  return String(uj.h);
}
async function modeloInfo(token: string, wabaId: string, nome: string) {
  const lm = await graph(token, '/' + wabaId + '/message_templates?name=' + nome + '&fields=name,status,language,rejected_reason,category');
  return ((lm.data as Record<string, unknown>[]) || []).find(m => m.language === 'pt_BR' && m.name === nome) || null;
}
// dia de hoje em São Paulo + n dias úteis (sábado e domingo não contam)
function prazoUtil(n: number): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  d.setHours(12, 0, 0, 0);
  let falta = Math.max(1, Math.round(n));
  while (falta > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) falta--; }
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const diaBR = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const diaLongo = (iso: string) => SEMANA[new Date(iso + 'T12:00:00').getDay()] + ', ' + diaBR(iso) + '/' + iso.slice(0, 4);
const nomeDoc = (b: { nota_numero?: number | null; duplicata?: string | null }) => (b.nota_numero ? 'NF ' + b.nota_numero : 'duplicata ' + b.duplicata);
const juntaE = (l: string[]) => (l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1]);

async function enviaModelo(token: string, phoneId: string, para: string, doc: { link?: string; id?: string; filename: string }, p: string[],
  nome = MODELO, extras: Record<string, unknown>[] = []) {
  const r = await graph(token, '/' + phoneId + '/messages', jsonPost({
    messaging_product: 'whatsapp', to: para, type: 'template',
    template: { name: nome, language: { code: 'pt_BR' }, components: [
      { type: 'header', parameters: [{ type: 'document', document: doc }] },
      { type: 'body', parameters: p.map(param) }, ...extras] }
  }));
  const m = (r.messages as { id: string }[] | undefined) || [];
  return m[0] ? m[0].id : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: quem } = await comoUsuario.auth.getUser();
  if (!quem?.user) return resposta(401, { erro: 'faça login de novo' });
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: eu } = await db.from('crm_usuarios').select('papel, ativo, nome, telefone').eq('user_id', quem.user.id).maybeSingle();
  if (!eu || !eu.ativo) return resposta(403, { erro: 'usuário sem acesso' });

  const token = Deno.env.get('WHATSAPP_TOKEN') ?? '';
  const phoneId = Deno.env.get('WHATSAPP_PHONE_ID') ?? '';
  const wabaId = Deno.env.get('WHATSAPP_WABA_ID') ?? '';
  const appId = Deno.env.get('WHATSAPP_APP_ID') ?? '';
  let c: { acao?: string; boletos?: string[]; pin?: string; telefone?: string };
  try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  const faltam = [!token && 'WHATSAPP_TOKEN', !phoneId && 'WHATSAPP_PHONE_ID', !wabaId && 'WHATSAPP_WABA_ID'].filter(Boolean);

  try {
    // ---- qualquer pessoa da equipe: o envio ao cliente está liberado? (modelo aprovado)
    if (c.acao === 'pronto') {
      if (faltam.length) return resposta(200, { cliente: false });
      const m = await modeloInfo(token, wabaId, MODELO_CLIENTE);
      return resposta(200, { cliente: !!(m && m.status === 'APPROVED') });
    }
    // ---- vendedor(a) da carteira, gestor(a) ou admin: o boleto ao cliente pelo número da empresa
    if (c.acao === 'cliente') {
      if (faltam.length) return resposta(503, { erro: 'o WhatsApp da Meta ainda não está ligado' });
      const ids = (Array.isArray(c.boletos) ? c.boletos : []).filter(x => /^[0-9a-f-]{36}$/.test(String(x))).slice(0, 20);
      if (!ids.length) return resposta(400, { erro: 'nenhum boleto' });
      const { data: bs, error } = await db.from('crm_boletos').select('id, duplicata, empresa_id, nota_numero, valor, valor_original, vencimento, linha_digitavel, arquivo, cobrado_em').in('id', ids);
      if (error) throw new Error(error.message);
      const l = bs || [];
      const empIds = [...new Set(l.map(b => b.empresa_id))];
      if (!l.length || empIds.length !== 1 || !empIds[0]) return resposta(400, { erro: 'mande os boletos de um cliente por vez' });
      const { data: e } = await db.from('crm_empresas').select('id, nome, razao_social, responsavel_id, telefone, whatsapp').eq('id', empIds[0]).maybeSingle();
      if (!e) return resposta(404, { erro: 'cliente não encontrado' });
      if (eu.papel !== 'admin' && eu.papel !== 'gestor' && e.responsavel_id !== quem.user.id) return resposta(403, { erro: 'este cliente não é da sua carteira' });
      // o número precisa ser um dos que estão no cadastro do cliente (não manda para qualquer número)
      const para = telefoneWa(c.telefone);
      const { data: cts } = await db.from('crm_contatos').select('nome, telefone, celular, whatsapp').eq('empresa_id', e.id);
      const contato = (cts || []).find(x => [x.whatsapp, x.celular, x.telefone].some(t => telefoneWa(t) === para));
      if (!para || (!contato && ![e.whatsapp, e.telefone].some(t => telefoneWa(t) === para))) return resposta(400, { erro: 'esse número não está no cadastro do cliente' });
      const { data: vend } = await db.from('crm_usuarios').select('nome, telefone').eq('user_id', e.responsavel_id || '00000000-0000-0000-0000-000000000000').maybeSingle();
      if (!vend) return resposta(400, { erro: 'cliente sem vendedor(a) na carteira' });
      if (!telefoneWa(vend.telefone)) return resposta(400, { erro: 'o(a) vendedor(a) da carteira está sem celular no cadastro (Configurações → Equipe): o botão "Falar comigo" precisa dele' });
      const arq = l.find(b => b.arquivo)?.arquivo;
      if (!arq) return resposta(400, { erro: 'boleto sem PDF' });
      const { data: cfg } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
      const dias = Number(((cfg && cfg.dados) || {}).cobranca_prazo_cartorio) || PRAZO_PADRAO;
      const prazo = prazoUtil(dias);
      l.sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
      const total = l.reduce((t, b) => t + Number(b.valor || 0), 0), totalOrig = l.reduce((t, b) => t + Number(b.valor_original || b.valor || 0), 0);
      const p3 = (l.length === 1 ? 'a ' + nomeDoc(l[0]) + ', que venceu em ' + diaBR(String(l[0].vencimento))
        : 'as ' + juntaE(l.map(b => nomeDoc(b) + ' (venceu em ' + diaBR(String(b.vencimento)) + ')')));
      const p4 = moeda(total) + (total > totalOrig + 0.005 ? ' (original ' + moeda(totalOrig) + ', com juros e multa até hoje)' : '');
      const p5 = l.filter(b => b.linha_digitavel).map(b => formataLinha(b.linha_digitavel)).join(' / ') || 'está no PDF, junto do código de barras';
      const primeiro = (t: unknown) => String(t || '').trim().split(/\s+/)[0] || '';
      const p1 = primeiro(contato && contato.nome) || e.nome || e.razao_social || 'tudo bem';
      const titulo = 'Boleto atualizado - ' + l.map(b => (b.nota_numero ? 'NF ' + b.nota_numero : b.duplicata)).join(', ') + ' - ' + (e.nome || '');
      const { data: arqPdf, error: e1 } = await db.storage.from(BUCKET).download(arq);
      if (e1 || !arqPdf) throw new Error('não consegui ler o PDF guardado');
      const mediaId = await sobePdf(token, phoneId, await arqPdf.arrayBuffer(), nomeArq(titulo));
      // botão "Falar comigo": crm-pdf?f=<id> abre o WhatsApp do(a) vendedor(a) com a mensagem pronta (e anota o clique);
      // botão "Já paguei": a resposta volta pelo crm-whatsapp-retorno com este payload
      let wamid = '';
      try {
        wamid = await enviaModelo(token, phoneId, para, { id: mediaId, filename: nomeArq(titulo) },
          [p1, primeiro(vend.nome), p3, p4, p5, diaLongo(prazo)], MODELO_CLIENTE, [
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: l[0].id }] },
            { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'pagou:' + l[0].id }] }]);
      } catch (err) {
        await db.from('crm_boletos').update({ cli_status: 'falhou', cli_erro: String((err as Error).message).slice(0, 300), cli_em: new Date().toISOString(), cli_tel: para }).in('id', l.map(b => b.id));
        throw err;
      }
      const agora = new Date().toISOString();
      await db.from('crm_boletos').update({ cli_msg: wamid, cli_status: 'enviado', cli_em: agora, cli_erro: null, cli_tel: para, cli_por: quem.user.id, cli_prazo: prazo }).in('id', l.map(b => b.id));
      await db.from('crm_boletos').update({ cobrado_em: agora, cobrado_por: quem.user.id }).in('id', l.map(b => b.id)).is('cobrado_em', null);
      return resposta(200, { ok: true, id: wamid, para, prazo, contato: contato ? contato.nome : null });
    }

    if (eu.papel !== 'admin') return resposta(403, { erro: 'só o administrador mexe no WhatsApp da empresa' });
    if (c.acao === 'situacao') {
      if (faltam.length) return resposta(200, { ligado: false, faltam });
      let numero: Record<string, unknown>;
      try {
        numero = await graph(token, '/' + phoneId + '?fields=display_phone_number,verified_name,name_status,status,quality_rating,code_verification_status');
      } catch (e1) {
        // diagnóstico (nunca devolve o token): permissões e contas que o token enxerga, e os números de cada conta
        const diag: Record<string, unknown> = { erro: String((e1 as Error).message) };
        try {
          const dt = await graph(token, '/debug_token?input_token=' + encodeURIComponent(token));
          const d = (dt.data || {}) as Record<string, unknown>;
          diag.valido = d.is_valid; diag.app = d.app_id; diag.tipo = d.type; diag.expira = d.expires_at;
          diag.permissoes = d.scopes;
          diag.alvos = ((d.granular_scopes as { scope: string; target_ids?: string[] }[]) || []).map(g => g.scope + ': ' + (g.target_ids || ['todos']).join(','));
        } catch (e2) { diag.debug = String((e2 as Error).message); }
        try {
          const nums = await graph(token, '/' + wabaId + '/phone_numbers?fields=id,display_phone_number,verified_name,status');
          diag.numeros_da_conta = nums.data;
        } catch (e3) { diag.conta = String((e3 as Error).message); }
        return resposta(200, { ligado: false, erro: diag.erro, diagnostico: diag });
      }
      const [modelo, modelo_cliente] = await Promise.all([modeloInfo(token, wabaId, MODELO), modeloInfo(token, wabaId, MODELO_CLIENTE)]);
      // retorno (webhook): o app está ligado à conta? e o que chegou por último
      let assinado: boolean | null = null;
      try { const sa = await graph(token, '/' + wabaId + '/subscribed_apps'); assinado = ((sa.data as Record<string, unknown>[]) || []).length > 0; } catch { /* sem permissão: fica null */ }
      const { data: ult } = await db.from('crm_whatsapp_eventos').select('tipo, status, de, texto, payload, criado_em').order('criado_em', { ascending: false }).limit(10);
      const retorno = {
        assinado, segredos: !!Deno.env.get('WHATSAPP_APP_SECRET') && !!Deno.env.get('WHATSAPP_VERIFY_TOKEN'),
        endereco: url + '/functions/v1/crm-whatsapp-retorno', ultimos: ult || []
      };
      return resposta(200, { ligado: true, numero, modelo, modelo_cliente, retorno });
    }
    if (faltam.length) return resposta(503, { erro: 'o WhatsApp da Meta ainda não está ligado: falta ' + faltam.join(', ') + ' nos segredos do Supabase' });

    if (c.acao === 'criar_modelo') {
      if (!appId) return resposta(503, { erro: 'falta WHATSAPP_APP_ID (o ID do app CRM OneClean) nos segredos do Supabase' });
      const h = await exemploPdfHandle(token, appId);
      const r = await graph(token, '/' + wabaId + '/message_templates', jsonPost({
        name: MODELO, language: 'pt_BR', category: 'UTILITY',
        components: [
          { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [h] } },
          { type: 'BODY', text: CORPO, example: { body_text: [['Renata', 'Escola Exemplo Ltda', 'NF 2286, R$ 350,18 com juros (original R$ 332,50)', '00190.00009 02956.789008 12345.678176 9 15930000033250']] } },
          { type: 'FOOTER', text: EMPRESA + ' · financeiro' }]
      }));
      return resposta(200, { ok: true, modelo: r });
    }

    if (c.acao === 'criar_modelo_cliente') {
      if (!appId) return resposta(503, { erro: 'falta WHATSAPP_APP_ID (o ID do app CRM OneClean) nos segredos do Supabase' });
      const h = await exemploPdfHandle(token, appId);
      const r = await graph(token, '/' + wabaId + '/message_templates', jsonPost({
        name: MODELO_CLIENTE, language: 'pt_BR', category: 'UTILITY',
        components: [
          { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [h] } },
          { type: 'BODY', text: CORPO_CLIENTE, example: { body_text: [['Maria', 'Renata', 'a NF 2428, que venceu em 19/10',
            'R$ 1.790,30 (original R$ 1.703,98, com juros e multa até hoje)', '00190.00009 03804.880106 00001.399179 1 16040000170398', 'segunda-feira, 27/10/2026']] } },
          { type: 'FOOTER', text: EMPRESA + ' · financeiro' },
          { type: 'BUTTONS', buttons: [
            { type: 'URL', text: BOTAO_FALAR, url: url + '/functions/v1/crm-pdf?f={{1}}', example: [url + '/functions/v1/crm-pdf?f=00000000-0000-4000-8000-000000000000'] },
            { type: 'QUICK_REPLY', text: BOTAO_PAGUEI }] }]
      }));
      return resposta(200, { ok: true, modelo: r });
    }

    if (c.acao === 'assinar_retorno') {
      // liga a conta do WhatsApp ao app: sem isso a Meta não manda o retorno (entregue, lido, "Já paguei") ao crm-whatsapp-retorno
      await graph(token, '/' + wabaId + '/subscribed_apps', { method: 'POST' });
      return resposta(200, { ok: true });
    }

    if (c.acao === 'registrar') {
      // registra o número na Cloud API com o PIN de 6 dígitos (verificação em duas etapas) que o administrador escolhe
      const pin = digitos(c.pin);
      if (pin.length !== 6) return resposta(400, { erro: 'o PIN precisa ter 6 números' });
      await graph(token, '/' + phoneId + '/register', jsonPost({ messaging_product: 'whatsapp', pin }));
      return resposta(200, { ok: true });
    }

    if (c.acao === 'teste') {
      const para = telefoneWa(eu.telefone);
      if (!para) return resposta(400, { erro: 'cadastre o seu celular em Configurações → Equipe para receber o teste' });
      const media = await sobePdf(token, phoneId, pdfExemplo(), 'exemplo.pdf');
      const id = await enviaModelo(token, phoneId, para, { id: media, filename: 'Boleto atualizado - exemplo.pdf' },
        [String(eu.nome || 'teste').split(' ')[0], 'Cliente de teste', 'NF 0000, R$ 10,00', '(teste, sem linha digitável)']);
      return resposta(200, { ok: true, id, para });
    }

    if (c.acao === 'enviar') {
      const ids = (Array.isArray(c.boletos) ? c.boletos : []).filter(x => /^[0-9a-f-]{36}$/.test(String(x))).slice(0, 60);
      if (!ids.length) return resposta(400, { erro: 'nenhum boleto' });
      const { data: bs, error } = await db.from('crm_boletos').select('id, duplicata, empresa_id, nota_numero, valor, valor_original, vencimento, linha_digitavel, arquivo, arquivo_banco, cobrado_em').in('id', ids);
      if (error) throw new Error(error.message);
      const empIds = [...new Set((bs || []).map(b => b.empresa_id).filter(Boolean))];
      const { data: emps } = await db.from('crm_empresas').select('id, nome, razao_social, responsavel_id').in('id', empIds.length ? empIds : ['00000000-0000-0000-0000-000000000000']);
      const empresa = new Map((emps || []).map(e => [e.id, e]));
      const uids = [...new Set((emps || []).map(e => e.responsavel_id).filter(Boolean))];
      const { data: us } = await db.from('crm_usuarios').select('user_id, nome, telefone').in('user_id', uids.length ? uids : ['00000000-0000-0000-0000-000000000000']);
      const usuario = new Map((us || []).map(u => [u.user_id, u]));
      // um envio por cliente (o PDF completo é um só para os boletos do mesmo cliente)
      const grupos = new Map<string, typeof bs>();
      (bs || []).filter(b => !b.cobrado_em && b.empresa_id).forEach(b => { if (!grupos.has(b.empresa_id)) grupos.set(b.empresa_id, []); grupos.get(b.empresa_id)!.push(b); });
      const resultado: Record<string, unknown>[] = [];
      for (const [empId, l] of grupos) {
        const e = empresa.get(empId), u = e && usuario.get(e.responsavel_id);
        const r: Record<string, unknown> = { empresa: e ? e.nome : empId, vendedora: u ? u.nome : null, boletos: l!.map(b => b.id) };
        try {
          if (!u) throw new Error('cliente sem vendedor(a) na carteira');
          const para = telefoneWa(u.telefone);
          if (!para) throw new Error('vendedor(a) sem celular no cadastro');
          const arq = l!.find(b => b.arquivo)?.arquivo;
          if (!arq) throw new Error('boleto sem PDF');
          const nf = l!.map(b => (b.nota_numero ? 'NF ' + b.nota_numero : 'duplicata ' + b.duplicata) + ', ' + moeda(Number(b.valor)) +
            (Number(b.valor) > Number(b.valor_original) + 0.005 ? ' com juros (original ' + moeda(Number(b.valor_original)) + ')' : '')).join('; ');
          const linhas = l!.filter(b => b.linha_digitavel).map(b => formataLinha(b.linha_digitavel)).join(' / ') || 'use o código de barras do PDF';
          const titulo = 'Boleto atualizado - ' + l!.map(b => (b.nota_numero ? 'NF ' + b.nota_numero : b.duplicata)).join(', ') + ' - ' + (e!.nome || '');
          // 20/10/2026: o PDF ia por LINK e a Meta baixava depois; os(as) vendedores(as) receberam a mensagem SEM o anexo.
          // Agora o PDF sobe para a Meta antes (como no teste, que chegava com o arquivo) e a mensagem vai com o id dele;
          // o link assinado fica só de reserva, se a subida falhar.
          let doc: { id?: string; link?: string; filename: string }, aviso: string | null = null;
          try {
            const { data: arqPdf, error: e1 } = await db.storage.from(BUCKET).download(arq);
            if (e1 || !arqPdf) throw new Error('não consegui ler o PDF guardado');
            doc = { id: await sobePdf(token, phoneId, await arqPdf.arrayBuffer(), nomeArq(titulo)), filename: nomeArq(titulo) };
          } catch (eUp) {
            const { data: assinado, error: e2 } = await db.storage.from(BUCKET).createSignedUrl(arq, SETE_DIAS);
            if (e2 || !assinado) throw new Error('não consegui subir nem o link do PDF');
            doc = { link: assinado.signedUrl, filename: nomeArq(titulo) };
            aviso = 'PDF por link (a subida para a Meta falhou: ' + String((eUp as Error).message || eUp).slice(0, 120) + ')';
          }
          const wamid = await enviaModelo(token, phoneId, para, doc,
            [String(u.nome || '').split(' ')[0], e!.razao_social || e!.nome, nf, linhas]);
          const agora = new Date().toISOString();
          await db.from('crm_boletos').update({ avisado_em: agora, wa_msg: wamid, wa_status: doc.id ? 'enviado com o PDF' : 'enviado', wa_em: agora, wa_erro: aviso }).in('id', l!.map(b => b.id));
          r.pdf = doc.id ? 'anexo' : 'link';
          r.ok = true; r.id = wamid;
        } catch (err) {
          r.ok = false; r.erro = String((err as Error).message || err);
          await db.from('crm_boletos').update({ wa_status: 'falhou', wa_erro: String(r.erro).slice(0, 300), wa_em: new Date().toISOString() }).in('id', l!.map(b => b.id));
        }
        resultado.push(r);
      }
      return resposta(200, { ok: true, resultado });
    }
    return resposta(400, { erro: 'ação desconhecida' });
  } catch (err) {
    return resposta(502, { erro: String((err as Error).message || err) });
  }
});
