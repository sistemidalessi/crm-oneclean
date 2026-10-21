// Edge Function: link curto do PDF completo do boleto (resumo, DANFE e boleto do banco) para a mensagem que o(a)
// vendedor(a) manda ao cliente pelo WhatsApp (20/10/2026, pedido do Anderson: "está indo só a mensagem, seria bom ir o PDF").
// O link do WhatsApp (wa.me) só leva texto; o arquivo de verdade só pelo Compartilhar. Então a mensagem leva este
// endereço, que abre o PDF: GET ?b=<id do boleto> → redireciona para um link assinado de 5 minutos do bucket privado.
// Sem login (o cliente abre no celular dele): o id é um UUID aleatório (122 bits) e o link vale 45 dias da criação do
// boleto; boleto sem PDF, apagado ou mais velho dá página simples de "não disponível".
// GET ?f=<id do boleto> (20/10/2026): botão "Falar comigo" da mensagem que o cliente recebe pelo número da empresa
// (modelo boleto_cliente) → abre o WhatsApp do(a) vendedor(a) da carteira com a mensagem pronta ("Olá, Renata! Recebi
// o boleto atualizado da NF 2428.") e anota o clique (cli_falou_em). Vale 90 dias.
// GET ?e=<id da entrega> (21/10/2026): botão "Falar com quem me atende" do agradecimento da entrega (modelo entrega_cliente)
// → abre o WhatsApp do(a) vendedor(a) da nota com "Olá, Silmara! Recebi a entrega da NF 2706." Vale 90 dias.
// Deploy: verify_jwt DESLIGADO (o cliente não tem login).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const VALIDADE_DIAS = 45;
const pagina = (status: number, texto: string) => new Response(
  '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Boleto</title>' +
  '<body style="font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#1a2130"><h1 style="font-size:1.2rem">Boleto</h1><p>' + texto + '</p></body></html>',
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return pagina(405, 'Endereço só para abrir o PDF.');
  const q = new URL(req.url).searchParams;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const ent = q.get('e') || '';
  if (ent) {
    if (!UUID.test(ent)) return pagina(404, 'Link inválido.');
    const { data: x } = await db.from('crm_entregas').select('id, nota_id, empresa_id, cli_msg, criado_em').eq('id', ent).maybeSingle();
    if (!x) return pagina(404, 'Não achei esta entrega. Responda a mensagem que recebeu e retornamos.');
    if (Date.now() - Date.parse(x.criado_em) > 90 * 864e5) return pagina(410, 'Este link expirou. Responda a mensagem que recebeu e retornamos.');
    const { data: n } = await db.from('crm_notas').select('numero, vendedor_id').eq('id', x.nota_id).maybeSingle();
    const { data: e } = x.empresa_id ? await db.from('crm_empresas').select('responsavel_id').eq('id', x.empresa_id).maybeSingle() : { data: null };
    const vid = (n && n.vendedor_id) || (e && e.responsavel_id);
    const { data: u } = vid ? await db.from('crm_usuarios').select('nome, telefone').eq('user_id', vid).maybeSingle() : { data: null };
    let tel = String((u && u.telefone) || '').replace(/\D/g, '');
    if (tel.length === 10 || tel.length === 11) tel = '55' + tel;
    if (tel.length < 12) return pagina(404, 'Não achei o contato de quem te atende. Responda a mensagem que recebeu e retornamos.');
    const texto = 'Olá, ' + String((u && u.nome) || '').trim().split(/\s+/)[0] + '! Recebi a entrega' + (n ? ' da NF ' + n.numero : '') + '.';
    if (req.method === 'GET') await db.from('crm_whatsapp_eventos').insert({ tipo: 'clique', wamid: x.cli_msg, payload: 'falar_entrega:' + x.id, texto: 'Falar com quem me atende' });
    return new Response(null, { status: 302, headers: { Location: 'https://wa.me/' + tel + '?text=' + encodeURIComponent(texto), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  }
  const f = q.get('f') || '';
  if (f) {
    if (!UUID.test(f)) return pagina(404, 'Link inválido.');
    const { data: b } = await db.from('crm_boletos').select('id, empresa_id, cli_msg, criado_em, nota_numero, duplicata').eq('id', f).maybeSingle();
    if (!b || !b.empresa_id) return pagina(404, 'Não achei este boleto. Responda a mensagem que recebeu e retornamos.');
    if (Date.now() - Date.parse(b.criado_em) > 90 * 864e5) return pagina(410, 'Este link expirou. Responda a mensagem que recebeu e retornamos.');
    const { data: e } = await db.from('crm_empresas').select('responsavel_id').eq('id', b.empresa_id).maybeSingle();
    const { data: u } = e && e.responsavel_id ? await db.from('crm_usuarios').select('nome, telefone').eq('user_id', e.responsavel_id).maybeSingle() : { data: null };
    let tel = String((u && u.telefone) || '').replace(/\D/g, '');
    if (tel.length === 10 || tel.length === 11) tel = '55' + tel;
    if (tel.length < 12) return pagina(404, 'Não achei o contato de quem te atende. Responda a mensagem que recebeu e retornamos.');
    const irmaos = b.cli_msg ? ((await db.from('crm_boletos').select('nota_numero, duplicata').eq('cli_msg', b.cli_msg)).data || [b]) : [b];
    const docs = [...new Set(irmaos.map(x => (x.nota_numero ? 'NF ' + x.nota_numero : 'duplicata ' + x.duplicata)))];
    const texto = 'Olá, ' + String((u && u.nome) || '').trim().split(/\s+/)[0] + '! Recebi o boleto atualizado ' + (docs.length > 1 ? 'das ' : 'da ') +
      (docs.length < 2 ? docs.join('') : docs.slice(0, -1).join(', ') + ' e ' + docs[docs.length - 1]) + '.';
    const agora = new Date().toISOString();
    if (req.method === 'GET') await db.from('crm_boletos').update({ cli_falou_em: agora }).eq(b.cli_msg ? 'cli_msg' : 'id', b.cli_msg || b.id).is('cli_falou_em', null);
    if (req.method === 'GET') await db.from('crm_whatsapp_eventos').insert({ tipo: 'clique', wamid: b.cli_msg, payload: 'falar:' + b.id, texto: 'Falar comigo' });
    return new Response(null, { status: 302, headers: { Location: 'https://wa.me/' + tel + '?text=' + encodeURIComponent(texto), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  }
  const id = q.get('b') || '';
  if (!UUID.test(id)) return pagina(404, 'Link inválido.');
  const { data: b } = await db.from('crm_boletos').select('arquivo, criado_em, nota_numero, duplicata').eq('id', id).maybeSingle();
  if (!b || !b.arquivo) return pagina(404, 'Este boleto não está mais disponível. Peça um novo a quem te mandou.');
  if (Date.now() - Date.parse(b.criado_em) > VALIDADE_DIAS * 864e5) return pagina(410, 'Este link expirou. Peça o boleto atualizado a quem te mandou.');
  const nome = 'Boleto ' + (b.nota_numero ? 'NF ' + b.nota_numero : String(b.duplicata || '').replace(/\//g, '-')) + '.pdf';
  const { data: s, error } = await db.storage.from('crm-boletos').createSignedUrl(b.arquivo, 300, { download: nome });
  if (error || !s) return pagina(500, 'Não consegui abrir o PDF agora. Tente de novo em instantes.');
  return new Response(null, { status: 302, headers: { Location: s.signedUrl, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
});
