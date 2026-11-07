// Edge Function crm-fiscal-agentes — o fiscal dos agentes da OneClean (06/11/2026, pedido do Anderson: "nada pode
// simplesmente travar ou parar de funcionar, e ninguém aqui fica em cima disso"). Mesmo desenho do fiscal da Agilité.
//   GET  (sem login)                          → o PULSO público: { empresa, verificado_em, graves, atencao }, sem detalhe.
//        Com o cabeçalho "X-Fiscal: nuvem" é a batida de ponto da rotina "Fiscal dos agentes" da nuvem (grava a visita;
//        o fiscal avisa se ela sumir por mais de 4 dias). Um vigia o outro.
//   POST { acao: 'rodar' }  (o agendador, senha do banco) → confere tudo (crm_fiscal_conferir + serviço fiscal/certificado
//        A1 + pulso do fiscal da Agilité) e, se for a hora, avisa o Anderson no celular (aviso.js).
//   POST (administrador logado): 'situacao' (painel + chave pública do Web Push), 'inscrever' (este aparelho), 'sair',
//        'testar' (um aviso de teste aos aparelhos dele), 'conferir' (confere agora, sem avisar).
// Aviso: exceção nº 11 da regra de envio (CLAUDE.md): Web Push só aos aparelhos que o Anderson inscreveu, das 7h às 21h.
// Nunca manda nada a mais ninguém e não conserta sozinho. Deploy: verify_jwt DESLIGADO (o pulso e o agendador não têm login).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { planoDeAviso, montarAviso, pulso, problemasExternos, agoraBr } from './aviso.js';
import { novasChavesVapid, enviar } from './webpush.js';

// deno-lint-ignore no-explicit-any
type Linha = Record<string, any>;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-fiscal',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const ASSUNTO = 'https://sistemidalessi.github.io/crm-oneclean/';
const PULSO_AGILITE = 'https://sistema.agiliteservice.com.br/api/fiscal/pulso';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const estado = async (nome: string) => { const { data } = await db.rpc('crm_fiscal_estado', { p_nome: nome }); return (data as string | null) ?? null; };
  const grava = async (nome: string, valor: string | null) => { await db.rpc('crm_fiscal_estado', { p_nome: nome, p_valor: valor, p_gravar: true }); };

  // ------------------------------------------------------------------ pulso (público)
  if (req.method === 'GET') {
    const quem = (req.headers.get('X-Fiscal') || '').trim().toLowerCase();
    if (quem === 'nuvem') await grava('visita:nuvem', new Date().toISOString());
    const [{ data: ab }, ver] = await Promise.all([db.rpc('crm_fiscal_abertos'), estado('verificado_em')]);
    return resposta(200, pulso((ab || []) as Linha[], ver));
  }
  if (req.method !== 'POST') return resposta(405, { erro: 'use GET (pulso) ou POST' });

  let c: Linha;
  try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  let agendador = false, eu: Linha | null = null;
  if (bearer.length >= 32 && /^[0-9a-f]+$/.test(bearer)) {
    const { data: ok } = await db.rpc('crm_cobranca_senha_ok', { p: bearer });
    agendador = ok === true;
  }
  if (!agendador) {
    const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
    const { data: q } = await comoUsuario.auth.getUser();
    if (!q?.user) return resposta(401, { erro: 'faça login de novo' });
    const { data: u } = await db.from('crm_usuarios').select('user_id, papel, ativo, nome').eq('user_id', q.user.id).maybeSingle();
    if (!u || !u.ativo || u.papel !== 'admin') return resposta(403, { erro: 'só o administrador' });
    eu = u as Linha;
  }
  if (agendador && c.acao !== 'rodar') return resposta(403, { erro: 'o agendador só roda' });

  // chaves VAPID do CRM: criadas na 1ª vez e guardadas em crm_interno.fiscal_estado (a API não expõe)
  async function vapid() {
    const v = await estado('vapid');
    if (v) return JSON.parse(v);
    const novo = await novasChavesVapid();
    await grava('vapid', JSON.stringify(novo));
    return novo;
  }

  // manda a todos os aparelhos inscritos (só os do Anderson: só o administrador se inscreve)
  async function avisar(dados: Linha) {
    const { data: lista } = await db.rpc('crm_fiscal_push', { p_acao: 'listar' });
    const ins = (lista || []) as Linha[];
    if (!ins.length) return { enviadas: 0, motivo: 'nenhum aparelho inscrito' };
    const chaves = await vapid();
    let n = 0;
    for (const i of ins) {
      try {
        const r = await enviar({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, dados, chaves, ASSUNTO);
        if (r.ok) n++;
        if (r.sumiu) await db.rpc('crm_fiscal_push', { p_acao: 'apagar', p_dados: { endpoint: i.endpoint } });
        else await db.rpc('crm_fiscal_push', { p_acao: 'resultado', p_dados: { endpoint: i.endpoint, ok: r.ok, erro: r.ok ? null : r.status + ' ' + r.erro } });
      } catch (e) {
        await db.rpc('crm_fiscal_push', { p_acao: 'resultado', p_dados: { endpoint: i.endpoint, ok: false, erro: String((e as Error).message || e) } });
      }
    }
    if (n) await grava('ultimo_aviso', new Date().toISOString() + ' ' + String(dados.titulo || '').slice(0, 120));
    return { enviadas: n, aparelhos: ins.length };
  }

  // o serviço fiscal na VPS (certificado A1) e o pulso do fiscal da Agilité
  async function externos() {
    let saude: Linha | null = null;
    const fu = Deno.env.get('FISCAL_URL'), tok = Deno.env.get('FISCAL_TOKEN');
    if (!fu || !tok) saude = { erro: 'serviço fiscal não configurado' };
    else {
      try {
        const r = await fetch(fu.replace(/\/+$/, '') + '/saude', { headers: { Authorization: 'Bearer ' + tok }, signal: AbortSignal.timeout(10000) });
        const j = await r.json().catch(() => ({}));
        saude = r.ok ? j : { erro: 'respondeu ' + r.status };
      } catch (_e) { saude = { erro: 'não respondeu em 10 s' }; }
    }
    let agilite: Linha | null = null;
    try {
      const r = await fetch(PULSO_AGILITE, { headers: { 'X-Fiscal': 'oneclean' }, signal: AbortSignal.timeout(10000) });
      agilite = r.ok ? await r.json() : { erro: 'respondeu ' + r.status };
    } catch (_e) { agilite = { erro: 'não respondeu' }; }
    // o serviço fiscal só vira problema na 2ª falha seguida (uma queda de segundos não acorda ninguém)
    const falhou = !saude || saude.erro || !saude.ok;
    const seguidas = falhou ? Number(await estado('saude_falhas') || 0) + 1 : 0;
    await grava('saude_falhas', String(seguidas));
    if (falhou && seguidas < 2) return null;   // mantém os problemas "externo:" como estão
    return problemasExternos({ saude, agilite });
  }

  async function conferir() {
    const ext = await externos();
    const { data, error } = await db.rpc('crm_fiscal_conferir', { p_externos: ext });
    if (error) throw new Error('conferência: ' + error.message);
    return data as Linha;
  }

  // prazos do calendário (crm_fiscal_prazos: obrigações do mês, contas do dia); sem a função, nenhum
  async function prazosEntre(de: string, ate: string) {
    const { data, error } = await db.rpc('crm_fiscal_prazos', { p_de: de, p_ate: ate });
    if (error) return [];
    return (data || []) as Linha[];
  }

  try {
    if (c.acao === 'rodar') {
      const r = await conferir();
      const { data: ab } = await db.rpc('crm_fiscal_abertos');
      const abertos = (ab || []) as Linha[];
      const { dia } = agoraBr();
      // os prazos já buscados (síncronos para o plano)
      const pz2 = await prazosEntre(dia, new Date(Date.parse(dia + 'T12:00:00Z') + 3 * 864e5).toISOString().slice(0, 10));
      const prazosDe = (de: string, ate: string) => pz2.filter(x => String(x.data) >= de && String(x.data) <= ate);
      // dia útil da OneClean (07/11/2026): sábado, domingo e feriado não avisam (o calendário é o do banco)
      let diaUtil: boolean | null = null;
      try { const { data: du, error: eDu } = await db.rpc('crm_prospec_dia_util', { d: dia }); if (!eDu && typeof du === 'boolean') diaUtil = du; } catch (_) { /* sem resposta: decide pelo dia da semana */ }
      const plano = planoDeAviso(abertos, { ultimoResumo: await estado('resumo_dia'), ultimoPrazos: await estado('prazos_dia'), prazosDe, diaUtil });
      let envio: Linha | null = null;
      if (plano.avisar) {
        envio = await avisar(montarAviso(plano));
        if (envio.enviadas) {
          if ((plano.marcar || []).length) await db.rpc('crm_fiscal_marcar', { p_chaves: plano.marcar });
          if (plano.tipo === 'resumo') await grava('resumo_dia', plano.dia);
          if (plano.tipo === 'prazos') await grava('prazos_dia', plano.dia);
        }
      } else if (plano.tipo === 'resumo-vazio') await grava('resumo_dia', plano.dia);
      else if (plano.tipo === 'prazos-vazio') await grava('prazos_dia', plano.dia);
      return resposta(200, { ok: true, conferencia: r, plano: { avisar: plano.avisar, tipo: plano.tipo || null, motivo: plano.motivo || null }, envio });
    }
    if (c.acao === 'situacao') {
      const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
      const { data, error } = await comoUsuario.rpc('crm_fiscal_painel');
      if (error) throw new Error(error.message);
      const { dia } = agoraBr();
      const dd = (n: number) => new Date(Date.parse(dia + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
      const prazos = await prazosEntre(dd(-10), dd(30));   // os 10 dias que passaram (vencido sem prova) e os 30 que vêm
      return resposta(200, Object.assign({}, data, { chave_publica: (await vapid()).publica, prazos, pulso: url + '/functions/v1/crm-fiscal-agentes' }));
    }
    if (c.acao === 'inscrever') {
      const s = (c.inscricao || {}) as Linha;
      if (!/^https:\/\//.test(String(s.endpoint || '')) || !s.keys || !s.keys.p256dh || !s.keys.auth) return resposta(400, { erro: 'inscrição do navegador incompleta' });
      await db.rpc('crm_fiscal_push', { p_acao: 'gravar', p_dados: { user_id: eu!.user_id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, aparelho: String(c.aparelho || '').slice(0, 120) } });
      return resposta(200, { ok: true });
    }
    if (c.acao === 'sair') {
      await db.rpc('crm_fiscal_push', { p_acao: 'apagar', p_dados: { endpoint: c.endpoint || null, id: c.id || null } });
      return resposta(200, { ok: true });
    }
    if (c.acao === 'testar') {
      return resposta(200, await avisar({ titulo: 'Fiscal OneClean: aviso de teste', corpo: 'Se você está lendo isto no celular, os avisos do fiscal dos agentes chegam aqui.', url: ASSUNTO + '#agentes', tag: 'oneclean-fiscal-teste' }));
    }
    if (c.acao === 'conferir') return resposta(200, await conferir());
    return resposta(400, { erro: 'ação desconhecida' });
  } catch (e) {
    return resposta(500, { erro: String((e as Error).message || e) });
  }
});
