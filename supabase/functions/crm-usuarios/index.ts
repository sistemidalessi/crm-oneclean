// Edge Function: administrador do CRM cria usuários e define senhas.
// Precisa da service_role (criar login no Auth), que NUNCA vai para o navegador:
// fica só aqui, no servidor do Supabase. Quem chama precisa estar logado E ser
// admin ativo em crm_usuarios — conferido aqui a cada chamada.
//
// Deploy: supabase functions deploy crm-usuarios   (verify_jwt ligado, o padrão)
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const PAPEIS = ['vendedor', 'gestor', 'admin', 'comprador'];

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('Authorization') ?? '';

  const comoUsuario = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: quem, error: errQuem } = await comoUsuario.auth.getUser();
  if (errQuem || !quem?.user) return resposta(401, { erro: 'faça login de novo' });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: eu } = await admin.from('crm_usuarios').select('papel, ativo').eq('user_id', quem.user.id).maybeSingle();
  if (!eu || !eu.ativo || eu.papel !== 'admin') return resposta(403, { erro: 'só o administrador do CRM mexe em usuários' });

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  const senha = String(corpo.senha ?? '');

  if (corpo.acao === 'criar') {
    const email = String(corpo.email ?? '').trim().toLowerCase();
    const nome = String(corpo.nome ?? '').trim();
    const papel = String(corpo.papel ?? 'vendedor');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resposta(400, { erro: 'e-mail inválido' });
    if (!nome) return resposta(400, { erro: 'informe o nome' });
    if (senha.length < 8) return resposta(400, { erro: 'senha com pelo menos 8 caracteres' });
    if (!PAPEIS.includes(papel)) return resposta(400, { erro: 'papel inválido' });

    const { data: criado, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } });
    if (error || !criado?.user) {
      const ja = /already|registered|exists/i.test(error?.message ?? '');
      return resposta(400, { erro: ja ? 'já existe um login com esse e-mail' : 'não foi possível criar o login: ' + (error?.message ?? '') });
    }
    const { error: e2 } = await admin.from('crm_usuarios').insert({
      user_id: criado.user.id, nome, email, papel,
      equipe: corpo.equipe ? String(corpo.equipe) : null,
      recebe_leads: papel !== 'comprador' && corpo.recebe_leads !== false, ativo: corpo.ativo !== false // comprador nunca entra no rodízio
    });
    if (e2) {
      await admin.auth.admin.deleteUser(criado.user.id); // não deixa login órfão
      return resposta(400, { erro: 'não foi possível liberar no CRM: ' + e2.message });
    }
    return resposta(200, { ok: true, user_id: criado.user.id });
  }

  if (corpo.acao === 'senha') {
    const alvo = String(corpo.user_id ?? '');
    if (senha.length < 8) return resposta(400, { erro: 'senha com pelo menos 8 caracteres' });
    const { data: u } = await admin.from('crm_usuarios').select('user_id').eq('user_id', alvo).maybeSingle();
    if (!u) return resposta(404, { erro: 'usuário não é do CRM' });
    const { error } = await admin.auth.admin.updateUserById(alvo, { password: senha });
    if (error) return resposta(400, { erro: error.message });
    return resposta(200, { ok: true });
  }

  return resposta(400, { erro: 'ação desconhecida' });
});
