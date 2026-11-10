// Edge Function crm-enviar-email — o e-mail do CRM sai pela CAIXA DO PRÓPRIO DOMÍNIO da empresa (10/11/2026).
// Até 06/11/2026 o envio era pelo Brevo, que desligou a conta: aviso de atraso/cobrança não é permitido lá, nem da empresa
// para o próprio cliente (chamado 5666968, definitivo). Agora a nota (XML, DANFE, boleto), o XML ao contador, a cadência e a
// cobrança saem por SMTP da caixa da empresa, sem provedor de envio em massa e sem regra de terceiro.
// Quem chama são as outras funções do CRM (crm-fiscal, crm-cobranca, crm-contador, crm-email), com a chave de serviço do
// projeto; o corpo é o mesmo que elas mandavam ao Brevo:
//   POST { sender: { name, email }, replyTo?: { name, email }, to: [{ email, name? }], cc?, bcc?, subject,
//          htmlContent?, textContent?, attachment?: [{ name, content (base64) }], tags?: [..] }  → 201 { messageId }
//   POST { acao: 'situacao' }  → { ligado, host, usuario, por_hora, na_ultima_hora } (chave de serviço ou administrador)
//   POST { acao: 'teste' }     → manda um e-mail de teste ao próprio administrador que pediu
// O remetente é sempre a caixa (o servidor só aceita o próprio endereço); o nome é o de quem manda e a RESPOSTA do cliente
// vai para o(a) vendedor(a) (Reply-To). Cada envio fica em crm_email_saida; há um teto por hora (dados.email.por_hora,
// padrão 60) para a caixa nunca passar do limite do provedor: acima dele responde 429 e quem chamou tenta depois.
// Configuração: crm_config.dados.email = { host, porta, usuario, por_hora }. A SENHA da caixa fica SÓ nos Secrets
// (EMAIL_SENHA), nunca no banco, no repositório ou no chat.
// Deploy: verify_jwt DESLIGADO (a função confere a chave de serviço ou o login do administrador).
// Portas: a 465 (SSL). As 25 e 587 não saem das Edge Functions do Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const resposta = (s: number, c: unknown) => new Response(JSON.stringify(c), { status: s, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
type Linha = Record<string, unknown>;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const b64txt = (t: string) => b64(enc.encode(t));
const em76 = (s: string) => (s.match(/.{1,76}/g) || []).join('\r\n');
const limpo = (v: unknown) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
const ehEmail = (v: string) => /^[^\s@<>,;:"()\[\]\\]+@[^\s@<>,;:"()\[\]\\]+\.[^\s@<>,;:"()\[\]\\]+$/.test(v) && v.length <= 254;

// texto de cabeçalho com acento (RFC 2047), em pedaços de até 42 bytes para a linha não passar de 76
function palavra(t: string) {
  if (/^[\x20-\x7e]*$/.test(t)) return t;
  const out: string[] = []; let atual = '';
  for (const ch of t) { if (enc.encode(atual + ch).length > 42) { out.push(atual); atual = ''; } atual += ch; }
  if (atual) out.push(atual);
  return out.map(p => '=?UTF-8?B?' + b64txt(p) + '?=').join('\r\n ');
}
// "Nome" <endereco>: o nome sem acento vai entre aspas; com acento, codificado
function caixa(nome: string, email: string) {
  const n = limpo(nome).replace(/["\\<>]/g, '');
  if (!n) return '<' + email + '>';
  return (/^[\x20-\x7e]*$/.test(n) ? '"' + n + '"' : palavra(n)) + ' <' + email + '>';
}
const TIPOS: Record<string, string> = { pdf: 'application/pdf', xml: 'application/xml', zip: 'application/zip', txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
function nomeArquivo(v: unknown) {
  const n = limpo(v).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'anexo';
  const ascii = n.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7e]/g, '_');
  const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(n) || [])[1] || '';
  return { ascii, utf8: encodeURIComponent(n).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()), tipo: TIPOS[ext.toLowerCase()] || 'application/octet-stream' };
}

// monta a mensagem (só ASCII: textos e anexos em base64) e devolve com o Message-ID
function mensagem(o: { de: string, deNome: string, responder: { nome: string, email: string } | null, para: string[], cc: string[], assunto: string, html: string, texto: string,
  anexos: { name: string, content: string }[], dominio: string, sair?: string }) {
  const id = '<' + crypto.randomUUID() + '@' + o.dominio + '>';
  const lim = () => 'crm-' + crypto.randomUUID().replace(/-/g, '');
  const cab: string[] = [
    'Date: ' + new Date().toUTCString().replace('GMT', '+0000'),
    'From: ' + caixa(o.deNome, o.de),
    'To: ' + o.para.map(x => '<' + x + '>').join(',\r\n '),
    ...(o.cc.length ? ['Cc: ' + o.cc.map(x => '<' + x + '>').join(',\r\n ')] : []),
    ...(o.responder ? ['Reply-To: ' + caixa(o.responder.nome, o.responder.email)] : []),
    'Subject: ' + palavra(limpo(o.assunto).slice(0, 250)),
    'Message-ID: ' + id,
    'MIME-Version: 1.0',
    ...(o.sair ? ['List-Unsubscribe: ' + o.sair] : []),
    'X-Mailer: CRM'];
  const parteTexto = (tipo: string, t: string) => 'Content-Type: ' + tipo + '; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + em76(b64txt(t)) + '\r\n';
  let corpo: string;   // a parte do texto (com o seu Content-Type)
  if (o.html && o.texto) {
    const la = lim();
    corpo = 'Content-Type: multipart/alternative; boundary="' + la + '"\r\n\r\n--' + la + '\r\n' + parteTexto('text/plain', o.texto) + '--' + la + '\r\n' + parteTexto('text/html', o.html) + '--' + la + '--\r\n';
  } else corpo = parteTexto(o.html ? 'text/html' : 'text/plain', o.html || o.texto || '');
  if (o.anexos.length) {
    const lm = lim();
    let m = 'Content-Type: multipart/mixed; boundary="' + lm + '"\r\n\r\n--' + lm + '\r\n' + corpo;
    for (const a of o.anexos) {
      const n = nomeArquivo(a.name);
      m += '--' + lm + '\r\nContent-Type: ' + n.tipo + '; name="' + n.ascii + '"\r\nContent-Transfer-Encoding: base64\r\n' +
        'Content-Disposition: attachment; filename="' + n.ascii + '"; filename*=UTF-8\'\'' + n.utf8 + '\r\n\r\n' + em76(String(a.content || '').replace(/[^A-Za-z0-9+/=]/g, '')) + '\r\n';
    }
    corpo = m + '--' + lm + '--\r\n';
  }
  // linha que começa com ponto é dobrada (SMTP); aqui só aconteceria em cabeçalho, mas a regra vale para tudo
  return { id, bruto: (cab.join('\r\n') + '\r\n' + corpo).replace(/\r\n\./g, '\r\n..') };
}

// a conversa SMTP pela porta com SSL: EHLO, AUTH LOGIN, MAIL FROM, RCPT TO, DATA
async function smtp(cfg: { host: string, porta: number, usuario: string, senha: string }, para: string[], bruto: string) {
  const c = await Promise.race([Deno.connectTls({ hostname: cfg.host, port: cfg.porta }),
    new Promise<never>((_, n) => setTimeout(() => n(new Error('o servidor de e-mail não respondeu (conexão)')), 15000))]);
  let resto = '';
  const le = async () => {   // uma resposta inteira: linhas "250-..." até a "250 ..."
    for (let volta = 0; volta < 200; volta++) {
      const linhas = resto.split('\r\n');
      for (let i = 0; i < linhas.length - 1; i++) if (/^\d{3} /.test(linhas[i]) || /^\d{3}$/.test(linhas[i])) { const r = linhas.slice(0, i + 1).join('\n'); resto = linhas.slice(i + 1).join('\r\n'); return r; }
      const b = new Uint8Array(4096);
      const n = await Promise.race([c.read(b), new Promise<null>(ok => setTimeout(() => ok(null), 30000))]);
      if (n === null) throw new Error('o servidor de e-mail parou de responder');
      resto += dec.decode(b.subarray(0, n));
    }
    throw new Error('resposta sem fim do servidor de e-mail');
  };
  const escreve = async (u: Uint8Array) => { let i = 0; while (i < u.length) i += await c.write(u.subarray(i, i + 65536)); };
  const manda = async (linha: string, aceita: number[], oque: string) => {
    if (linha) await escreve(enc.encode(linha + '\r\n'));
    const r = await le(), cod = Number(r.slice(0, 3));
    if (!aceita.includes(cod)) throw new Error(oque + ': ' + r.replace(/\n/g, ' ').slice(0, 220));
    return r;
  };
  try {
    await manda('', [220], 'saudação');
    await manda('EHLO ' + (cfg.usuario.split('@')[1] || 'crm'), [250], 'EHLO');
    await manda('AUTH LOGIN', [334], 'o servidor não aceitou o login');
    await manda(b64txt(cfg.usuario), [334], 'usuário recusado');
    await manda(b64txt(cfg.senha), [235], 'usuário ou senha recusados');
    await manda('MAIL FROM:<' + cfg.usuario + '>', [250], 'remetente recusado');
    for (const p of para) await manda('RCPT TO:<' + p + '>', [250, 251], 'destinatário recusado (' + p + ')');
    await manda('DATA', [354], 'o servidor não aceitou a mensagem');
    await escreve(enc.encode(bruto));
    const fim = await manda('\r\n.', [250], 'mensagem recusada');
    try { await escreve(enc.encode('QUIT\r\n')); } catch { /* já aceitou */ }
    return fim.replace(/\n/g, ' ').slice(0, 200);
  } finally { try { c.close(); } catch { /* já fechou */ } }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { message: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!, servico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(url, servico, { auth: { persistSession: false } });
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  let c: Linha; try { c = await req.json(); } catch { return resposta(400, { message: 'corpo inválido' }); }
  let interno = !!bearer && bearer === servico, admin: Linha | null = null;
  if (!interno) {
    const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: 'Bearer ' + bearer } }, auth: { persistSession: false } });
    const { data: u } = await comoUsuario.auth.getUser();
    if (u?.user) { const { data: eu } = await db.from('crm_usuarios').select('user_id, nome, email, papel, ativo').eq('user_id', u.user.id).maybeSingle(); if (eu && eu.ativo && eu.papel === 'admin') admin = eu as Linha; }
    if (!admin || !['situacao', 'teste'].includes(String(c.acao))) return resposta(401, { message: 'só as funções do CRM mandam e-mail por aqui' });
  }
  const { data: cfgL } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
  const e = ((((cfgL as Linha | null)?.dados || {}) as Linha).email || {}) as Linha;
  const cfg = { host: String(Deno.env.get('EMAIL_HOST') || e.host || ''), porta: Number(Deno.env.get('EMAIL_PORTA') || e.porta || 465),
    usuario: String(Deno.env.get('EMAIL_USUARIO') || e.usuario || '').trim().toLowerCase(), senha: Deno.env.get('EMAIL_SENHA') ?? '' };
  const porHora = Number(e.por_hora) > 0 ? Number(e.por_hora) : 60;
  const umaHora = new Date(Date.now() - 36e5).toISOString();
  const { count: naHora } = await db.from('crm_email_saida').select('id', { count: 'exact', head: true }).eq('ok', true).gte('criado_em', umaHora);

  if (c.acao === 'situacao') return resposta(200, { ligado: !!(cfg.senha && cfg.host && ehEmail(cfg.usuario)), host: cfg.host, porta: cfg.porta, usuario: cfg.usuario, senha: !!cfg.senha, por_hora: porHora, na_ultima_hora: naHora || 0 });
  if (c.acao === 'teste') {
    const para = String((admin && admin.email) || c.para || '').trim().toLowerCase();
    if (!ehEmail(para)) return resposta(400, { message: 'sem e-mail para o teste' });
    c = { sender: { name: 'CRM · teste de envio', email: cfg.usuario }, to: [{ email: para }], subject: 'Teste de envio do CRM pela caixa ' + cfg.usuario,
      textContent: 'Se este e-mail chegou, o envio do CRM pela caixa da empresa está funcionando.\n\nEnviado em ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + '.', tags: ['teste'] };
    interno = true;
  }
  if (!cfg.senha) return resposta(503, { message: 'o e-mail não está ligado: falta a senha da caixa nos Secrets (EMAIL_SENHA)' });
  if (!cfg.host || !ehEmail(cfg.usuario)) return resposta(503, { message: 'o e-mail não está configurado (dados.email: host e usuario)' });

  const lista = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(x => String((x as Linha)?.email || '').trim().toLowerCase()).filter(ehEmail))];
  const para = lista(c.to), cc = lista(c.cc).filter(x => !para.includes(x)), cco = lista(c.bcc).filter(x => !para.includes(x) && !cc.includes(x));
  const sender = (c.sender || {}) as Linha, rt = (c.replyTo || {}) as Linha;
  const assunto = limpo(c.subject);
  const etiqueta = Array.isArray(c.tags) && c.tags.length ? limpo(c.tags[0]).slice(0, 40) : null;
  const registra = async (ok: boolean, erro: string | null, id: string | null, bytes: number) => {
    await db.from('crm_email_saida').insert({ para: para.concat(cc, cco).join(', ').slice(0, 500), assunto: assunto.slice(0, 250), etiqueta, de_nome: limpo(sender.name).slice(0, 120) || null,
      responder: limpo(rt.email || sender.email).slice(0, 200) || null, ok, erro: erro ? erro.slice(0, 400) : null, message_id: id, bytes });
  };
  if (!para.length) return resposta(400, { message: 'sem destinatário válido' });
  if (!assunto) return resposta(400, { message: 'sem assunto' });
  if (para.length + cc.length + cco.length > 20) return resposta(400, { message: 'destinatários demais num e-mail só (máximo 20)' });
  // a cadência e as ofertas (e-mail de venda) usam no máximo metade do teto: a nota fiscal e a cobrança sempre têm lugar
  if ((etiqueta === 'cadencia' || etiqueta === 'oferta') && (naHora || 0) >= Math.floor(porHora / 2)) {
    return resposta(429, { message: 'muitos e-mails na última hora: a cadência espera para a nota fiscal e a cobrança terem lugar. Tente de novo mais tarde' });
  }
  if ((naHora || 0) >= porHora) { await registra(false, 'teto por hora (' + porHora + ')', null, 0); return resposta(429, { message: 'teto de ' + porHora + ' e-mails por hora atingido: tente de novo mais tarde' }); }

  // a resposta do cliente vai para quem atende (replyTo, ou o "sender" que as funções mandavam ao Brevo)
  const respEmail = String(rt.email || sender.email || '').trim().toLowerCase();
  const responder = ehEmail(respEmail) && respEmail !== cfg.usuario ? { nome: limpo(rt.name || ''), email: respEmail } : null;
  const anexos = (Array.isArray(c.attachment) ? c.attachment : []).filter(a => a && (a as Linha).content).map(a => ({ name: String((a as Linha).name || 'anexo'), content: String((a as Linha).content) }));
  const m = mensagem({ de: cfg.usuario, deNome: limpo(sender.name) || cfg.usuario, responder, para, cc, assunto, html: String(c.htmlContent || ''), texto: String(c.textContent || ''),
    anexos, dominio: cfg.usuario.split('@')[1],
    // só o cabeçalho de descadastro da cadência passa adiante (os outros cabeçalhos de quem chama são ignorados)
    sair: /^<https:\/\/[^\s<>]+>$/.test(String(((c.headers || {}) as Linha)['List-Unsubscribe'] || '')) ? String(((c.headers || {}) as Linha)['List-Unsubscribe']) : '' });
  const bytes = m.bruto.length;
  if (bytes > 30 * 1024 * 1024) { await registra(false, 'mensagem grande demais (' + Math.round(bytes / 1048576) + ' MB)', null, bytes); return resposta(413, { message: 'mensagem grande demais para a caixa (' + Math.round(bytes / 1048576) + ' MB)' }); }
  try {
    await smtp(cfg, para.concat(cc, cco), m.bruto);
    await registra(true, null, m.id, bytes);
    return resposta(201, { messageId: m.id });
  } catch (err) {
    const erro = String((err as Error).message || err).slice(0, 300);
    await registra(false, erro, null, bytes);
    // senha errada ou caixa recusando é erro de configuração (503); destinatário recusado é do pedido (400)
    return resposta(/destinatário recusado/.test(erro) ? 400 : 502, { message: erro });
  }
});
