// Edge Function: WhatsApp oficial da Meta (Cloud API) — 15/10/2026, pedido do Anderson: no "Mandar às
// vendedoras" o CRM manda SOZINHO, a cada vendedora, o boleto atualizado com o PDF completo (resumo, DANFE e
// boleto do banco) anexo, pelo número da OneClean na Meta. Sem a API, o navegador só abria a conversa com link.
//   POST { acao: 'situacao' }                 → { ligado, numero, modelo } (o que a Meta diz do número e do modelo)
//   POST { acao: 'criar_modelo' }             → cria o modelo "boleto_vendedora" (categoria utilidade, PDF no cabeçalho)
//   POST { acao: 'teste' }                    → manda o modelo com um PDF de exemplo ao celular de quem chamou
//   POST { acao: 'enviar', boletos: [ids] }   → um envio por cliente (os boletos do cliente dividem o PDF completo)
// Só o administrador. A chave da Meta fica SÓ nos segredos do Supabase (WHATSAPP_TOKEN, token permanente de um
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
function pdfExemplo(): Uint8Array {
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

// texto do modelo (pt_BR, utilidade). {{1}} vendedora · {{2}} cliente · {{3}} nota e valor · {{4}} linha digitável
const CORPO = 'Olá, {{1}}! O financeiro atualizou o boleto de {{2}}: {{3}}. Linha digitável: {{4}}. ' +
  'O PDF completo (resumo, nota fiscal e boleto do banco) está anexo: encaminhe ao cliente. Quando ele responder, avise o financeiro.';

async function enviaModelo(token: string, phoneId: string, para: string, doc: { link?: string; id?: string; filename: string }, p: string[]) {
  const r = await graph(token, '/' + phoneId + '/messages', jsonPost({
    messaging_product: 'whatsapp', to: para, type: 'template',
    template: { name: MODELO, language: { code: 'pt_BR' }, components: [
      { type: 'header', parameters: [{ type: 'document', document: doc }] },
      { type: 'body', parameters: p.map(param) }] }
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
  if (!eu || !eu.ativo || eu.papel !== 'admin') return resposta(403, { erro: 'só o administrador manda pelo WhatsApp da empresa' });

  const token = Deno.env.get('WHATSAPP_TOKEN') ?? '';
  const phoneId = Deno.env.get('WHATSAPP_PHONE_ID') ?? '';
  const wabaId = Deno.env.get('WHATSAPP_WABA_ID') ?? '';
  const appId = Deno.env.get('WHATSAPP_APP_ID') ?? '';
  let c: { acao?: string; boletos?: string[] };
  try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  const faltam = [!token && 'WHATSAPP_TOKEN', !phoneId && 'WHATSAPP_PHONE_ID', !wabaId && 'WHATSAPP_WABA_ID'].filter(Boolean);

  try {
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
      const lm = await graph(token, '/' + wabaId + '/message_templates?name=' + MODELO + '&fields=name,status,language,rejected_reason');
      const modelo = ((lm.data as Record<string, unknown>[]) || []).find(m => m.language === 'pt_BR') || null;
      return resposta(200, { ligado: true, numero, modelo });
    }
    if (faltam.length) return resposta(503, { erro: 'o WhatsApp da Meta ainda não está ligado: falta ' + faltam.join(', ') + ' nos segredos do Supabase' });

    if (c.acao === 'criar_modelo') {
      if (!appId) return resposta(503, { erro: 'falta WHATSAPP_APP_ID (o ID do app CRM OneClean) nos segredos do Supabase' });
      // a Meta pede um PDF de exemplo, enviado pela "carga retomável" do app
      const pdf = pdfExemplo();
      const sessao = await graph(token, '/' + appId + '/uploads?file_name=exemplo.pdf&file_length=' + pdf.length + '&file_type=application/pdf', { method: 'POST' });
      const up = await fetch(GRAPH + '/' + sessao.id, { method: 'POST', headers: { Authorization: 'OAuth ' + token, file_offset: '0' }, body: pdf });
      const uj = await up.json();
      if (!up.ok || !uj.h) throw new Error('não consegui enviar o PDF de exemplo à Meta: ' + JSON.stringify(uj).slice(0, 200));
      const r = await graph(token, '/' + wabaId + '/message_templates', jsonPost({
        name: MODELO, language: 'pt_BR', category: 'UTILITY',
        components: [
          { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [uj.h] } },
          { type: 'BODY', text: CORPO, example: { body_text: [['Renata', 'Escola Exemplo Ltda', 'NF 2286, R$ 350,18 com juros (original R$ 332,50)', '00190.00009 02956.789008 12345.678176 9 15930000033250']] } },
          { type: 'FOOTER', text: 'OneClean · financeiro' }]
      }));
      return resposta(200, { ok: true, modelo: r });
    }

    if (c.acao === 'teste') {
      const para = telefoneWa(eu.telefone);
      if (!para) return resposta(400, { erro: 'cadastre o seu celular em Configurações → Equipe para receber o teste' });
      const pdf = pdfExemplo();
      const fd = new FormData();
      fd.append('messaging_product', 'whatsapp');
      fd.append('type', 'application/pdf');
      fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'exemplo.pdf');
      const media = await graph(token, '/' + phoneId + '/media', { method: 'POST', body: fd });
      const id = await enviaModelo(token, phoneId, para, { id: String(media.id), filename: 'Boleto atualizado - exemplo.pdf' },
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
          if (!u) throw new Error('cliente sem vendedora na carteira');
          const para = telefoneWa(u.telefone);
          if (!para) throw new Error('vendedora sem celular no cadastro');
          const arq = l!.find(b => b.arquivo)?.arquivo;
          if (!arq) throw new Error('boleto sem PDF');
          const nf = l!.map(b => (b.nota_numero ? 'NF ' + b.nota_numero : 'duplicata ' + b.duplicata) + ', ' + moeda(Number(b.valor)) +
            (Number(b.valor) > Number(b.valor_original) + 0.005 ? ' com juros (original ' + moeda(Number(b.valor_original)) + ')' : '')).join('; ');
          const linhas = l!.filter(b => b.linha_digitavel).map(b => formataLinha(b.linha_digitavel)).join(' / ') || 'use o código de barras do PDF';
          const { data: assinado, error: e2 } = await db.storage.from(BUCKET).createSignedUrl(arq, SETE_DIAS);
          if (e2 || !assinado) throw new Error('não consegui o link do PDF');
          const titulo = 'Boleto atualizado - ' + l!.map(b => (b.nota_numero ? 'NF ' + b.nota_numero : b.duplicata)).join(', ') + ' - ' + (e!.nome || '');
          const wamid = await enviaModelo(token, phoneId, para, { link: assinado.signedUrl, filename: nomeArq(titulo) },
            [String(u.nome || '').split(' ')[0], e!.razao_social || e!.nome, nf, linhas]);
          const agora = new Date().toISOString();
          await db.from('crm_boletos').update({ avisado_em: agora, wa_msg: wamid, wa_status: 'enviado', wa_em: agora, wa_erro: null }).in('id', l!.map(b => b.id));
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
