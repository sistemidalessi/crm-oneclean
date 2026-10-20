// Edge Function: link curto do PDF completo do boleto (resumo, DANFE e boleto do banco) para a mensagem que o(a)
// vendedor(a) manda ao cliente pelo WhatsApp (20/10/2026, pedido do Anderson: "está indo só a mensagem, seria bom ir o PDF").
// O link do WhatsApp (wa.me) só leva texto; o arquivo de verdade só pelo Compartilhar. Então a mensagem leva este
// endereço, que abre o PDF: GET ?b=<id do boleto> → redireciona para um link assinado de 5 minutos do bucket privado.
// Sem login (o cliente abre no celular dele): o id é um UUID aleatório (122 bits) e o link vale 45 dias da criação do
// boleto; boleto sem PDF, apagado ou mais velho dá página simples de "não disponível".
// Deploy: verify_jwt DESLIGADO (o cliente não tem login).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const VALIDADE_DIAS = 45;
const pagina = (status: number, texto: string) => new Response(
  '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Boleto</title>' +
  '<body style="font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#1a2130"><h1 style="font-size:1.2rem">Boleto</h1><p>' + texto + '</p></body></html>',
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return pagina(405, 'Endereço só para abrir o PDF.');
  const id = new URL(req.url).searchParams.get('b') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return pagina(404, 'Link inválido.');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: b } = await db.from('crm_boletos').select('arquivo, criado_em, nota_numero, duplicata').eq('id', id).maybeSingle();
  if (!b || !b.arquivo) return pagina(404, 'Este boleto não está mais disponível. Peça um novo a quem te mandou.');
  if (Date.now() - Date.parse(b.criado_em) > VALIDADE_DIAS * 864e5) return pagina(410, 'Este link expirou. Peça o boleto atualizado a quem te mandou.');
  const nome = 'Boleto ' + (b.nota_numero ? 'NF ' + b.nota_numero : String(b.duplicata || '').replace(/\//g, '-')) + '.pdf';
  const { data: s, error } = await db.storage.from('crm-boletos').createSignedUrl(b.arquivo, 300, { download: nome });
  if (error || !s) return pagina(500, 'Não consegui abrir o PDF agora. Tente de novo em instantes.');
  return new Response(null, { status: 302, headers: { Location: s.signedUrl, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
});
