// Edge Function crm-cobranca — aviso de atraso ao cliente (23/10/2026, pedido do Anderson: "chegou em 5 dias úteis de
// atraso, já enviar; ou eles entram em contato e negociam com a vendedora, ou eu envio o cartório").
// Um aviso por cliente, uma vez por título: pelo WhatsApp da empresa (modelo "cobranca_atraso", em nome do(a) vendedor(a)
// da carteira, botões "Falar com quem me atende" e "Já paguei") e por e-mail (Brevo, do e-mail do(a) vendedor(a)), já
// dizendo que, sem o pagamento até o prazo, o título segue para o cartório. O CRM NUNCA manda sozinho ao cartório: quando o
// prazo vence sem "Já paguei", cria a tarefa "decidir o cartório" para cada administrador.
//   POST { acao: 'situacao' }     → configuração, modelo na Meta, avisos recentes (admin)
//   POST { acao: 'previa' }       → quem recebe hoje, com o texto (admin; não manda nada)
//   POST { acao: 'rodar' }        → manda os avisos de hoje e cria os alertas (admin pela tela; ou o agendador)
//   POST { acao: 'criar_modelo' } → cria o modelo "cobranca_atraso" na Meta (admin)
//   POST { acao: 'previa_boletos' } → os boletos vencidos atualizados de hoje, sem mandar nada, com o PDF do 1º (admin ou agendador)
// 04/11/2026 (pedido do Anderson): no 1º dia de atraso o cliente recebe o BOLETO ATUALIZADO (juros e multa até o dia, o mesmo
// código de barras) em PDF, pelo WhatsApp da empresa (modelo "boleto_vencido", sem falar de cartório) e por e-mail; o aviso do
// cartório passou para o 3º dia útil (dados.cobranca_aviso.dias). Ligado em dados.cobranca_boleto.ligado. Os vencidos vêm do
// banco (crm-bb, ação 'vencidos'); o desenho é o boleto.js do site, baixado num commit fixo e conferido pelo SHA-256 (depois
// de mexer no boleto.js: commit, push, node ferramentas/fixa-motor-notas.js e publicar esta função). Cada rodada deixa o
// resumo em crm_cobranca_rodadas (o CEO do grupo lê pela crm-caixa-leitura?parte=ceo e manda ao Anderson).
// Agendador: pg_cron (crm_cobranca_tick, dias úteis 9h05) com "Authorization: Bearer <senha>" que nasce no banco
// (crm_interno.cobranca_cfg) e é conferida por crm_cobranca_senha_ok; só roda se dados.cobranca_aviso.ligado = true.
// Deploy: verify_jwt DESLIGADO (o agendador não tem login; a função confere a senha ou o login do administrador).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { quemRecebe, prazoUtil, parametros, textoFinal, textoEmail, CORPO, alertasCartorio, celularesDoCliente, emailsDoCliente, telWa, moeda, docsTexto,
  porTransferencia, valorAtualizado, contaTexto, valorTransferencia, paragrafoTransferencia, textoEmailTransferencia } from './avisos.js';
import { casa, quemRecebeBoleto, pdfBoletos, parametrosBoleto, CORPO_BOLETO, textoEmailBoleto, resumoRodada, mod11 } from './atualizado.js';
import { jsPDF } from 'npm:jspdf@2.5.2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const GRAPH = 'https://graph.facebook.com/v25.0';
const MODELO = 'cobranca_atraso';
const MODELO_BOLETO = 'boleto_vencido';
const BOTAO_FALAR_B = 'Falar comigo';   // o mesmo do boleto_cliente: crm-pdf?f=<boleto> abre o WhatsApp do(a) vendedor(a)
const BUCKET = 'crm-boletos';
const COMMIT = '12f4fb60a3847dfa153eba7c49f508939899528d';
const HASHES: Record<string, string> = { 'boleto.js': 'a4d5a17b2adffb76049727c715007b28dfb64d7ea3e70e9e24823c1b8efd5f92' };
const FONTE = 'https://raw.githubusercontent.com/sistemidalessi/crm-oneclean/' + COMMIT + '/';
const EMPRESA = Deno.env.get('CRM_EMPRESA_NOME') ?? 'OneClean';
const BOTAO_FALAR = 'Falar com quem me atende';
const BOTAO_PAGUEI = 'Já paguei';
type Linha = Record<string, unknown>;
const hojeSP = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
const primeiro = (n: unknown) => String(n || '').trim().split(/\s+/)[0] || '';
const telBR = (t: string) => { const d = t.replace(/^55/, ''); return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : d; };
const param = (t: string) => ({ type: 'text', text: String(t || '-').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 900) });

async function graph(token: string, caminho: string, init: RequestInit = {}) {
  const r = await fetch(GRAPH + caminho, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) } });
  let j: Linha = {};
  try { j = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) { const e = (j.error || {}) as Linha; throw new Error(String(e.error_user_msg || e.message || 'a Meta respondeu ' + r.status) + (e.code ? ' (código ' + e.code + ')' : '')); }
  return j;
}
async function modeloInfo(token: string, wabaId: string, nome = MODELO) {
  const lm = await graph(token, '/' + wabaId + '/message_templates?name=' + nome + '&fields=name,status,language,rejected_reason,category');
  return ((lm.data as Linha[]) || []).find(m => m.language === 'pt_BR' && m.name === nome) || null;
}
async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// deno-lint-ignore no-explicit-any
let BOL: any = null;
async function carregaBoleto() {
  if (BOL) return BOL;
  const r = await fetch(FONTE + 'boleto.js');
  if (!r.ok) throw new Error('não baixou boleto.js (' + r.status + ')');
  const codigo = await r.text();
  if (await sha256(codigo) !== HASHES['boleto.js']) throw new Error('boleto.js não confere com a versão fixada');
  // deno-lint-ignore no-explicit-any
  const g: any = { CRMCobranca: { mod11 } };   // o código de barras só usa o módulo 11 do cobranca.js
  new Function('module', 'require', 'globalThis', 'window', codigo)(undefined, undefined, g, g);
  BOL = g.CRMBoleto;
  return BOL;
}
const base64 = (buf: ArrayBuffer) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const nomeArq = (t: string) => t.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110) + '.pdf';
async function sobePdf(token: string, phoneId: string, pdf: ArrayBuffer, nome: string) {
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp'); fd.append('type', 'application/pdf');
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), nome);
  const media = await graph(token, '/' + phoneId + '/media', { method: 'POST', body: fd });
  if (!media.id) throw new Error('a Meta não devolveu o id do PDF');
  return String(media.id);
}
// o modelo "boleto_vencido" (PDF no cabeçalho) nasce sozinho na 1ª rodada: a Meta pede um PDF de exemplo pela carga do app
async function criaModeloBoleto(token: string, wabaId: string, appId: string, url: string) {
  const ex = new jsPDF({ unit: 'mm', format: 'a4' });
  ex.setFontSize(16); ex.text('Boleto atualizado (exemplo)', 20, 30);
  const pdf = new Uint8Array(ex.output('arraybuffer'));
  const sessao = await graph(token, '/' + appId + '/uploads?file_name=exemplo.pdf&file_length=' + pdf.length + '&file_type=application/pdf', { method: 'POST' });
  const up = await fetch(GRAPH + '/' + sessao.id, { method: 'POST', headers: { Authorization: 'OAuth ' + token, file_offset: '0' }, body: pdf });
  const uj = await up.json();
  if (!up.ok || !uj.h) throw new Error('não consegui enviar o PDF de exemplo à Meta: ' + JSON.stringify(uj).slice(0, 200));
  return await graph(token, '/' + wabaId + '/message_templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    name: MODELO_BOLETO, language: 'pt_BR', category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [String(uj.h)] } },
      { type: 'BODY', text: CORPO_BOLETO(EMPRESA), example: { body_text: [['Maria', 'Renata', 'da NF 2428, que venceu em 28/10/2026',
        'R$ 715,44 (original R$ 678,35, com juros e multa até 04/11/2026)', '00190.00009 03804.880106 00001.464171 9 16130000067835']] } },
      { type: 'FOOTER', text: EMPRESA + ' · financeiro' },
      { type: 'BUTTONS', buttons: [
        { type: 'URL', text: BOTAO_FALAR_B, url: url + '/functions/v1/crm-pdf?f={{1}}', example: [url + '/functions/v1/crm-pdf?f=00000000-0000-4000-8000-000000000000'] },
        { type: 'QUICK_REPLY', text: BOTAO_PAGUEI }] }]
  }) });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let c: Linha;
  try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

  // quem chama: o agendador (senha do banco) ou o administrador logado
  let agendador = false, eu: Linha | null = null;
  if (bearer.length >= 32 && /^[0-9a-f]+$/.test(bearer)) {
    const { data: ok } = await db.rpc('crm_cobranca_senha_ok', { p: bearer });
    agendador = ok === true;
  }
  if (!agendador) {
    const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
    const { data: quem } = await comoUsuario.auth.getUser();
    if (!quem?.user) return resposta(401, { erro: 'faça login de novo' });
    const { data: u } = await db.from('crm_usuarios').select('user_id, papel, ativo, nome').eq('user_id', quem.user.id).maybeSingle();
    if (!u || !u.ativo || u.papel !== 'admin') return resposta(403, { erro: 'só o administrador' });
    eu = u as Linha;
  }
  if (agendador && c.acao !== 'rodar' && c.acao !== 'previa_boletos') return resposta(403, { erro: 'o agendador só roda' });

  const token = Deno.env.get('WHATSAPP_TOKEN') ?? '', phoneId = Deno.env.get('WHATSAPP_PHONE_ID') ?? '', wabaId = Deno.env.get('WHATSAPP_WABA_ID') ?? '';
  const brevo = Deno.env.get('BREVO_API_KEY') ?? '';
  const { data: cfgRow } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
  const dados = ((cfgRow as Linha | null)?.dados || {}) as Linha;
  const cfg = (dados.cobranca_aviso || {}) as Linha;
  // aviso contra boleto falso (27/10/2026): o texto gravado em Configurações (fiscal.aviso_golpe), grifado no e-mail
  const golpe = String(((dados.fiscal || {}) as Linha).aviso_golpe || '').replace(/\s+/g, ' ').trim();
  const diasAtraso = Number(cfg.dias) > 0 ? Number(cfg.dias) : 3;   // 3º dia útil desde 04/11/2026 (era o 5º)
  const cfgBol = (dados.cobranca_boleto || {}) as Linha;
  const appId = Deno.env.get('WHATSAPP_APP_ID') ?? '';
  const prazoDias = Number(dados.cobranca_prazo_cartorio) > 0 ? Number(dados.cobranca_prazo_cartorio) : 5;
  const hoje = hojeSP();

  try {
    if (c.acao === 'criar_modelo') {
      if (!token || !wabaId) return resposta(503, { erro: 'o WhatsApp da Meta ainda não está ligado (faltam os segredos)' });
      const r = await graph(token, '/' + wabaId + '/message_templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          name: MODELO, language: 'pt_BR', category: 'UTILITY',
          components: [
            { type: 'BODY', text: CORPO(EMPRESA), example: { body_text: [['Maria', 'Renata', 'a NF 2428, vencida em 16/10/2026', 'R$ 1.703,98', 'sexta-feira, 30/10/2026']] } },
            { type: 'FOOTER', text: EMPRESA + ' · financeiro' },
            { type: 'BUTTONS', buttons: [
              // a Meta não aceita wa.me direto no botão: o crm-pdf (?a=<aviso>) redireciona para o WhatsApp do(a) vendedor(a)
              { type: 'URL', text: BOTAO_FALAR, url: url + '/functions/v1/crm-pdf?a={{1}}', example: [url + '/functions/v1/crm-pdf?a=00000000-0000-4000-8000-000000000000'] },
              { type: 'QUICK_REPLY', text: BOTAO_PAGUEI }] }]
        })
      });
      return resposta(200, { ok: true, modelo: r });
    }

    // títulos e o que já foi avisado
    const { data: tit } = await db.from('crm_titulos').select('id, duplicata, nota_numero, parcela, empresa_id, vencimento, valor, previsao, cartorio_em, portador').lt('vencimento', hoje);
    const { data: avs } = await db.from('crm_cobranca_avisos').select('*').order('enviado_em', { ascending: false }).limit(2000);
    const avisos = (avs || []) as Linha[];
    const { data: pagosB } = await db.from('crm_boletos').select('empresa_id, duplicata').not('cli_pagou_em', 'is', null);
    const pagos = new Set(((pagosB || []) as Linha[]).map(b => b.empresa_id + '|' + b.duplicata));
    const semAviso = new Set(((cfg.sem_aviso as string[]) || []).map(String));
    // título que já tem entrada paga no Caixa e ficou com sobra (pago em parte): não cobra, vai para conferência (04/11/2026,
    // LPTA: o FKN dividiu a nota em 626,31 + 600 e o BB em 613,16 + 613,15; a sobra de 13,15 virou um aviso de cartório)
    const dupsVenc = ((tit || []) as Linha[]).map(t => String(t.duplicata));
    const { data: pagosParc } = dupsVenc.length ? await db.from('crm_fin_lancamentos').select('titulo_duplicata').eq('tipo', 'entrada').eq('situacao', 'pago').in('titulo_duplicata', dupsVenc) : { data: [] };
    const parciais = new Set(((pagosParc || []) as Linha[]).map(x => String(x.titulo_duplicata)));
    const titCob = ((tit || []) as Linha[]).filter(t => !parciais.has(String(t.duplicata)));
    const foraParcial = ((tit || []) as Linha[]).filter(t => parciais.has(String(t.duplicata)))
      .map(t => ({ empresa_id: t.empresa_id, duplicata: t.duplicata, nota_numero: t.nota_numero, valor: t.valor, motivo: 'pago em parte: conferir a sobra antes de cobrar' }));
    const lista = quemRecebe({ titulos: titCob, avisos, hoje, dias: diasAtraso, pagos, semAviso });

    // montagem de cada aviso: cliente, contato, vendedor(a), canais e texto
    const empIds = lista.map(x => x.empresa_id);
    const { data: emps } = empIds.length ? await db.from('crm_empresas').select('id, nome, responsavel_id, whatsapp, telefone, email').in('id', empIds) : { data: [] };
    const { data: cts } = empIds.length ? await db.from('crm_contatos').select('empresa_id, nome, whatsapp, celular, telefone, email').in('empresa_id', empIds) : { data: [] };
    const vIds = [...new Set(((emps || []) as Linha[]).map(e => e.responsavel_id).filter(Boolean))] as string[];
    const { data: vends } = vIds.length ? await db.from('crm_usuarios').select('user_id, nome, telefone, email, ativo').in('user_id', vIds) : { data: [] };
    const { data: adms } = await db.from('crm_usuarios').select('user_id, nome, telefone, email').eq('papel', 'admin').eq('ativo', true);
    const admin0 = ((adms || []) as Linha[])[0] || null;
    const prazo = prazoUtil(hoje, prazoDias);
    const corpo = CORPO(EMPRESA);
    // quem paga por transferência (05/11/2026): o aviso leva o valor com multa e juros e a conta, nunca boleto
    const bolCfg = (dados.boleto || {}) as Linha, emitCfg = (((dados.fiscal || {}) as Linha).emitente || {}) as Linha;
    const conta = contaTexto({ agencia: bolCfg.agencia, conta: bolCfg.conta, razao: emitCfg.razao, cnpj: emitCfg.cnpj });
    const monta = lista.map(x => {
      const e = ((emps || []) as Linha[]).find(y => y.id === x.empresa_id) || {} as Linha;
      const contatos = ((cts || []) as Linha[]).filter(y => y.empresa_id === x.empresa_id);
      const v = ((vends || []) as Linha[]).find(y => y.user_id === e.responsavel_id && y.ativo) || admin0 || {} as Linha;
      const celulares = celularesDoCliente(e, contatos), emails = emailsDoCliente(e, contatos);
      const contato = contatos.find(y => celularesDoCliente(null, [y]).length) || contatos[0] || null;
      const p = parametros({ cliente: primeiro(contato && contato.nome) || String(e.nome || ''), vendedora: primeiro(v.nome) || 'o financeiro', titulos: x.titulos, valor: x.valor, prazo });
      const telV = telWa(v.telefone);
      const transf = (x.titulos as Linha[]).some(porTransferencia) ? valorAtualizado(x.titulos, hoje, bolCfg) : null;
      if (transf) p[3] = valorTransferencia(transf);
      return { ...x, empresa: e, vendedor: v, celular: celulares[0] || '', emails, p, texto: textoFinal(corpo, p), telV, transf,
        email: transf ? textoEmailTransferencia(corpo, p, telV ? telBR(telV) : '', paragrafoTransferencia(transf, conta)) : textoEmail(corpo, p, telV ? telBR(telV) : '') };
    });

    // ------------------------------------------------------------ boleto vencido atualizado (1º dia de atraso)
    const servico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    async function boletosDeHoje(enviar: boolean) {
      const rb = await fetch(url + '/functions/v1/crm-bb', { method: 'POST', headers: { Authorization: 'Bearer ' + servico, 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'vencidos', dias: 60 }) });
      const jb = await rb.json().catch(() => ({}));
      if (!rb.ok) throw new Error('leitura dos vencidos no BB: ' + String((jb as Linha).erro || rb.status));
      // quem paga por transferência nunca recebe boleto atualizado, mesmo que o BB ainda tenha um boleto do título (05/11/2026)
      const titulos = titCob.filter(t => !porTransferencia(t));
      const foraTransf = titCob.filter(t => porTransferencia(t) && !t.cartorio_em)
        .map(t => ({ empresa_id: t.empresa_id, duplicata: t.duplicata, nota_numero: t.nota_numero, valor: t.valor, motivo: 'paga por transferência: o aviso leva o valor com multa e juros e a conta, sem boleto' }));
      const ids = [...new Set(titulos.map(t => t.empresa_id).filter(Boolean))] as string[];
      const docs = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from('crm_empresas').select('id, cnpj').in('id', ids.slice(i, i + 200));
        for (const e of (data || []) as Linha[]) docs.set(String(e.id), String(e.cnpj || ''));
      }
      const { casados, sem } = casa((jb as Linha).boletos as Linha[] || [], titulos, docs);
      // feriados: o vencimento que cai em feriado vale no dia útil seguinte (calendário de São Bernardo, crm_prospec_dia_util)
      const datas = [...new Set(casados.flatMap(x => { const v = String(x.titulo.vencimento); const l = [v]; const d = new Date(v + 'T12:00:00Z'); for (let i = 1; i < 6; i++) { d.setUTCDate(d.getUTCDate() + 1); l.push(d.toISOString().slice(0, 10)); } return l; }))];
      const uteis = new Map<string, boolean>();
      for (const d of datas) { const { data } = await db.rpc('crm_prospec_dia_util', { d }); uteis.set(d, data !== false); }
      const util = (d: string) => uteis.has(d) ? !!uteis.get(d) : ![0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay());
      const { data: jaB } = await db.from('crm_boletos').select('empresa_id, duplicata').eq('origem', 'auto');
      const ja = new Set(((jaB || []) as Linha[]).map(b => b.empresa_id + '|' + b.duplicata));
      const { lista: envios, fora } = quemRecebeBoleto({ casados, hoje, util, ja, pagos, semAviso });
      const B = await carregaBoleto();
      const cfgBB = (dados.boleto || {}) as Linha, emit = ((dados.fiscal || {}) as Linha).emitente as Linha || {};
      const aviso = B.avisoGolpe(emit, ((dados.fiscal || {}) as Linha).aviso_golpe, '001 (Banco do Brasil)');
      const nomes = new Map<string, string>();
      const feitos: Linha[] = [];
      let modeloOk = false;
      if (enviar && token && phoneId && wabaId) {
        try {
          const m = await modeloInfo(token, wabaId, MODELO_BOLETO);
          if (!m && appId) await criaModeloBoleto(token, wabaId, appId, url);
          modeloOk = !!m && m.status === 'APPROVED';
        } catch (e) { console.error('[crm-cobranca] modelo boleto_vencido: ' + (e as Error).message); }
      }
      let pdf1: string | null = null;
      for (const env of envios) {
        const { data: e } = await db.from('crm_empresas').select('id, nome, responsavel_id, whatsapp, telefone, email').eq('id', env.empresa_id).maybeSingle();
        const { data: cs } = await db.from('crm_contatos').select('empresa_id, nome, whatsapp, celular, telefone, email').eq('empresa_id', env.empresa_id);
        const emp = (e || {}) as Linha, contatos = (cs || []) as Linha[];
        nomes.set(env.empresa_id, String(emp.nome || ''));
        let vend = ((vends || []) as Linha[]).find(y => y.user_id === emp.responsavel_id && y.ativo) as Linha | undefined;
        if (!vend && emp.responsavel_id) { const { data } = await db.from('crm_usuarios').select('user_id, nome, telefone, email, ativo').eq('user_id', emp.responsavel_id).maybeSingle(); if (data && data.ativo) vend = data as Linha; }
        if (!vend) vend = (admin0 || {}) as Linha;
        const celulares = celularesDoCliente(emp, contatos), emails = emailsDoCliente(emp, contatos);
        const contato = contatos.find(y => celularesDoCliente(null, [y]).length) || contatos[0] || null;
        const p = parametrosBoleto({ cliente: primeiro(contato && contato.nome) || String(emp.nome || ''), vendedora: primeiro(vend.nome) || 'o financeiro', envio: env, hoje });
        const docs = env.itens.map((x: Linha) => ((x.titulo as Linha).nota_numero ? 'NF ' + (x.titulo as Linha).nota_numero : String((x.titulo as Linha).duplicata))).join(', ');
        let buf: ArrayBuffer;
        try { buf = pdfBoletos(jsPDF, B, env, { cfg: cfgBB, emit, hoje, aviso }); }
        catch (err) { feitos.push({ empresa: emp.nome, docs, total: env.total, enviado: false, erro: 'PDF: ' + (err as Error).message }); continue; }
        if (!pdf1) pdf1 = base64(buf);
        if (!enviar) { feitos.push({ empresa: emp.nome, docs, total: env.total, original: env.original, celular: celulares[0] || '', emails, vendedor: vend.nome || '', texto: textoFinal(CORPO_BOLETO(EMPRESA), p) }); continue; }
        if (!celulares[0] && !emails.length) { feitos.push({ empresa: emp.nome, docs, total: env.total, enviado: false, erro: 'sem celular e sem e-mail no cadastro' }); continue; }
        // o PDF guardado e um crm_boletos por título (a ficha, a Fila e o "Já paguei" usam o mesmo registro do boleto)
        const arquivo = 'boletos/' + hoje.slice(0, 7) + '/' + crypto.randomUUID() + '.pdf';
        const { error: eUp } = await db.storage.from(BUCKET).upload(arquivo, new Blob([buf], { type: 'application/pdf' }), { contentType: 'application/pdf' });
        if (eUp) { feitos.push({ empresa: emp.nome, docs, total: env.total, enviado: false, erro: 'não guardou o PDF: ' + eUp.message }); continue; }
        const agora = new Date().toISOString();
        const { data: regs, error: eIns } = await db.from('crm_boletos').insert(env.itens.map((x: Linha) => {
          const t = x.titulo as Linha, b = x.boleto as Linha;
          return { duplicata: t.duplicata, empresa_id: t.empresa_id, nota_numero: t.nota_numero, valor_original: b.valor, valor: x.total, vencimento: t.vencimento,
            linha_digitavel: String(b.linha || ''), arquivo, origem: 'auto', encargos: { multa: x.multa, juros: x.juros, dias: x.dias, ate: hoje, nosso_numero: b.nosso_numero },
            avisado_em: agora, cobrado_em: agora };
        })).select('id');
        if (eIns || !regs || !regs.length) { feitos.push({ empresa: emp.nome, docs, total: env.total, enviado: false, erro: 'não gravou o boleto: ' + (eIns ? eIns.message : '') }); continue; }
        const bid = String((regs as Linha[])[0].id), bids = (regs as Linha[]).map(r => String(r.id));
        const titulo = 'Boleto atualizado - ' + docs + ' - ' + String(emp.nome || '');
        const up: Linha = {};
        if (modeloOk && celulares[0]) {
          try {
            const media = await sobePdf(token, phoneId, buf, nomeArq(titulo));
            const r = await graph(token, '/' + phoneId + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
              messaging_product: 'whatsapp', to: celulares[0], type: 'template',
              template: { name: MODELO_BOLETO, language: { code: 'pt_BR' }, components: [
                { type: 'header', parameters: [{ type: 'document', document: { id: media, filename: nomeArq(titulo) } }] },
                { type: 'body', parameters: p.map(param) },
                { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: bid }] },
                { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'pagou:' + bid }] }] }
            }) });
            Object.assign(up, { cli_msg: (((r.messages as Linha[]) || [])[0] || {}).id || null, cli_status: 'enviado', cli_em: agora, cli_tel: celulares[0], cli_erro: null });
          } catch (err) { Object.assign(up, { cli_status: 'falhou', cli_erro: String((err as Error).message).slice(0, 300), cli_tel: celulares[0], cli_em: agora }); }
        } else if (celulares[0]) Object.assign(up, { cli_erro: 'modelo boleto_vencido ainda não aprovado pela Meta' });
        let emailOk = false;
        const rem = /@/.test(String(vend.email || '')) ? vend : admin0;
        if (brevo && emails.length && rem && /@/.test(String(rem.email || ''))) {
          const telV = telWa(vend.telefone);
          const corpoTxt = textoEmailBoleto(CORPO_BOLETO(EMPRESA), p, telV ? telBR(telV) : '');
          const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:600px">' +
            corpoTxt.split('\n\n').map((x: string) => '<p>' + x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</p>').join('') +
            (golpe ? '<p style="background:#fff176;border:2px solid #c81e1e;border-radius:8px;padding:10px 14px;color:#7a0000;font-weight:bold">⚠️ ' + golpe.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>' : '') +
            '<p style="color:#777;font-size:12px">' + EMPRESA + ' · financeiro</p></div>';
          try {
            const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': brevo, 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ sender: { name: String(rem.nome) + ' · ' + EMPRESA, email: rem.email }, replyTo: { name: String(rem.nome), email: rem.email },
                to: emails.map((x: string) => ({ email: x })), subject: EMPRESA + ' · boleto atualizado (' + docs + ')',
                htmlContent: html, textContent: corpoTxt + (golpe ? '\n\n' + golpe : '') + '\n\n' + EMPRESA + ' · financeiro',
                attachment: [{ name: nomeArq(titulo), content: base64(buf) }], tags: ['cobranca', 'boleto-atualizado'] }) });
            emailOk = r.ok;
            if (!r.ok) up.cli_erro = [up.cli_erro, 'o Brevo recusou o e-mail (' + r.status + ')'].filter(Boolean).join(' · ');
          } catch (err) { up.cli_erro = [up.cli_erro, 'e-mail: ' + String((err as Error).message).slice(0, 200)].filter(Boolean).join(' · '); }
        }
        if (emailOk && !up.cli_status) Object.assign(up, { cli_status: 'email', cli_em: agora });
        if (Object.keys(up).length) await db.from('crm_boletos').update(up).in('id', bids);
        const canais = [up.cli_status === 'enviado' ? 'WhatsApp' : '', emailOk ? 'e-mail' : ''].filter(Boolean);
        if (!canais.length) {
          // não saiu por nenhum canal: o registro sai (amanhã tenta de novo) e o PDF fica
          await db.from('crm_boletos').delete().in('id', bids);
          feitos.push({ empresa: emp.nome, docs, total: env.total, enviado: false, erro: String(up.cli_erro || 'sem canal') });
          continue;
        }
        await db.from('crm_atividades').insert({ empresa_id: env.empresa_id, tipo: canais[0] === 'WhatsApp' ? 'whatsapp' : 'email', concluida: true, concluida_em: agora, automatica: true,
          responsavel_id: vend.user_id || null, descricao: 'Boleto atualizado enviado ao cliente (' + canais.join(' e ') + '): ' + docs + ', ' + moeda(env.total) + ' com juros e multa até ' +
            hoje.split('-').reverse().join('/') + ' (original ' + moeda(env.original) + '). Se o cliente procurar, negocie e avise o financeiro.' });
        feitos.push({ empresa: emp.nome, docs, total: env.total, enviado: true, canais });
      }
      const foraN = [];
      for (const f of (fora as Linha[]).concat(foraParcial as Linha[], foraTransf as Linha[])) {
        let nome = nomes.get(String(f.empresa_id));
        if (!nome) { const { data } = await db.from('crm_empresas').select('nome').eq('id', f.empresa_id).maybeSingle(); nome = data ? String(data.nome) : ''; }
        foraN.push({ ...f, nome });
      }
      return { feitos, fora: foraN, sem: sem.map((x: Linha) => ({ nosso_numero: (x.boleto as Linha).nosso_numero, valor: (x.boleto as Linha).valor, vencimento: (x.boleto as Linha).vencimento, candidatos: x.candidatos })), pdf1, lidos: ((jb as Linha).boletos as Linha[] || []).length };
    }
    if (c.acao === 'previa_boletos') {
      const r = await boletosDeHoje(false);
      return resposta(200, { ligado: cfgBol.ligado === true, hoje, ...r });
    }

    if (c.acao === 'situacao') {
      let modelo: Linha | null = null, erroModelo = '';
      if (token && wabaId) { try { modelo = await modeloInfo(token, wabaId); } catch (e) { erroModelo = (e as Error).message; } }
      // quem chegou ao prazo e ainda não recebeu (sem canal hoje): com celular sai pelo WhatsApp quando a Meta aprovar
      const esperando = monta.map(m => ({ empresa_id: m.empresa_id, nome: m.empresa.nome, valor: m.valor, dias: m.dias, celular: !!m.celular, email: m.emails.length > 0 }));
      return resposta(200, { ligado: cfg.ligado === true, dias: diasAtraso, prazo: prazoDias, modelo, erro_modelo: erroModelo, whatsapp: !!(token && phoneId), email: !!brevo,
        hoje: lista.length, esperando, avisos: avisos.slice(0, 200) });
    }
    if (c.acao === 'previa') {
      return resposta(200, { ligado: cfg.ligado === true, prazo, lista: monta.map(m => ({ empresa_id: m.empresa_id, nome: m.empresa.nome, valor: m.valor, dias: m.dias,
        titulos: m.titulos.map((t: Linha) => t.duplicata), vendedor: m.vendedor.nome || '', celular: m.celular, emails: m.emails, texto: m.texto })) });
    }
    if (c.acao !== 'rodar') return resposta(400, { erro: 'ação desconhecida' });
    // 1º o boleto atualizado (1º dia de atraso); depois o aviso do cartório (3º dia útil)
    // deno-lint-ignore no-explicit-any
    let bol: any = null;
    if (cfgBol.ligado === true) { try { bol = await boletosDeHoje(true); } catch (e) { bol = { erro: (e as Error).message, feitos: [], fora: [], sem: [] }; console.error('[crm-cobranca] boletos: ' + (e as Error).message); } }
    const guardaRodada = async (avisosFeitos: Linha[], nAlertas: number) => {
      const resumo = resumoRodada({ hoje, boletos: bol ? bol.feitos : [], avisos: avisosFeitos, fora: bol ? bol.fora : [], sem: bol ? bol.sem : [], alertas: nAlertas }) +
        (bol && bol.erro ? '\nAtenção: a leitura dos boletos no banco falhou (' + bol.erro + ').' : '');
      const { data: ant } = await db.from('crm_cobranca_rodadas').select('dados').eq('dia', hoje).maybeSingle();
      const juntos = { boletos: [...(((ant && ant.dados) || {}).boletos || []), ...(bol ? bol.feitos : [])], avisos: [...(((ant && ant.dados) || {}).avisos || []), ...avisosFeitos],
        fora: bol ? bol.fora : (((ant && ant.dados) || {}).fora || []), sem: bol ? bol.sem : (((ant && ant.dados) || {}).sem || []), alertas: nAlertas, erro: bol && bol.erro ? bol.erro : null };
      await db.from('crm_cobranca_rodadas').upsert({ dia: hoje, resumo: resumoRodada({ hoje, boletos: juntos.boletos, avisos: juntos.avisos, fora: juntos.fora, sem: juntos.sem, alertas: nAlertas }) +
        (juntos.erro ? '\nAtenção: a leitura dos boletos no banco falhou (' + juntos.erro + ').' : ''), dados: juntos, atualizado_em: new Date().toISOString() });
      return resumo;
    };
    if (agendador && cfg.ligado !== true) { await guardaRodada([], 0); return resposta(200, { ok: true, desligado: true, boletos: bol }); }

    let modeloOk = false;
    if (token && phoneId && wabaId) { try { const m = await modeloInfo(token, wabaId); modeloOk = !!m && m.status === 'APPROVED'; } catch { modeloOk = false; } }
    const feitos: Linha[] = [];
    for (const m of monta) {
      // o registro só nasce se o aviso saiu por algum canal: sem canal (ou com falha nos dois), tenta de novo amanhã
      const id = crypto.randomUUID(), up: Linha = {};
      // WhatsApp da empresa (só com o modelo aprovado e celular no cadastro)
      if (modeloOk && m.celular) {
        try {
          const r = await graph(token, '/' + phoneId + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            messaging_product: 'whatsapp', to: m.celular, type: 'template',
            template: { name: MODELO, language: { code: 'pt_BR' }, components: [
              { type: 'body', parameters: m.p.map(param) },
              { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: id }] },
              { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'avisopagou:' + id }] }] }
          }) });
          up.whatsapp_para = m.celular; up.wa_msg = (((r.messages as Linha[]) || [])[0] || {}).id || null; up.wa_status = 'enviado';
        } catch (e) { up.whatsapp_para = m.celular; up.wa_status = 'falhou'; up.wa_erro = String((e as Error).message).slice(0, 300); }
      } else up.wa_erro = !m.celular ? 'sem celular no cadastro' : 'modelo da Meta ainda não aprovado';
      // e-mail, do(a) vendedor(a) da carteira (a resposta vai para ela)
      const rem = /@/.test(String(m.vendedor.email || '')) ? m.vendedor : admin0;
      if (brevo && m.emails.length && rem && /@/.test(String(rem.email || ''))) {
        try {
          const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:600px">' +
            m.email.split('\n\n').map((s: string) => '<p>' + s.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>').join('') +
            (golpe ? '<p style="background:#fff176;border:2px solid #c81e1e;border-radius:8px;padding:10px 14px;color:#7a0000;font-weight:bold">⚠️ ' + golpe.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>' : '') +
            '<p style="color:#777;font-size:12px">' + EMPRESA + ' · financeiro</p></div>';
          const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': brevo, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sender: { name: String(rem.nome) + ' · ' + EMPRESA, email: rem.email }, replyTo: { name: String(rem.nome), email: rem.email },
              to: m.emails.map((x: string) => ({ email: x })), subject: EMPRESA + ' · título em aberto (' + docsTexto(m.titulos).replace(/^(a|as) /, '') + ')',
              htmlContent: html, textContent: m.email + (golpe ? '\n\n' + golpe : '') + '\n\n' + EMPRESA + ' · financeiro', tags: ['cobranca'] }) });
          up.email_para = m.emails; up.email_ok = r.ok;
          if (!r.ok) up.email_erro = 'o Brevo recusou (' + r.status + ')';
        } catch (e) { up.email_para = m.emails; up.email_ok = false; up.email_erro = String((e as Error).message).slice(0, 300); }
      } else if (!m.emails.length) up.email_erro = 'sem e-mail no cadastro';
      const canais = [up.wa_status === 'enviado' ? 'WhatsApp' : '', up.email_ok ? 'e-mail' : ''].filter(Boolean);
      const erro = [up.wa_erro, up.email_erro].filter(Boolean).join(' · ') || null;
      if (!canais.length) {
        // sem celular e sem e-mail: a vendedora pede o contato do financeiro do cliente (uma tarefa aberta por cliente)
        if (!m.celular && !m.emails.length && m.vendedor.user_id) {
          const marca = 'Aviso de atraso sem contato:';
          const { count } = await db.from('crm_atividades').select('id', { count: 'exact', head: true }).eq('empresa_id', m.empresa_id).eq('concluida', false).like('descricao', marca + '%');
          if (!count) await db.from('crm_atividades').insert({ empresa_id: m.empresa_id, responsavel_id: m.vendedor.user_id, tipo: 'tarefa', automatica: true, data_hora: new Date().toISOString(),
            descricao: marca + ' ' + String(m.empresa.nome || 'o cliente') + ' tem ' + docsTexto(m.titulos) + ' (' + moeda(m.valor) + ', ' + m.dias + ' dias) e não tem celular nem e-mail no cadastro. ' +
              'Peça o celular (WhatsApp) e o e-mail do financeiro e complete o cadastro: o aviso sai no dia útil seguinte.' });
        }
        feitos.push({ empresa: m.empresa.nome, enviado: false, erro }); continue;
      }
      const reg: Linha = { id, empresa_id: m.empresa_id, duplicatas: m.titulos.map((t: Linha) => t.duplicata), notas: docsTexto(m.titulos), valor: m.valor, dias: m.dias,
        prazo, vendedor_id: m.vendedor.user_id || null, texto: m.texto, enviado_por: eu ? eu.user_id : null, ...up };
      const { error: eIns } = await db.from('crm_cobranca_avisos').insert(reg);
      if (eIns) { feitos.push({ empresa: m.empresa.nome, enviado: true, erro: 'enviado, mas não gravou: ' + eIns.message }); continue; }
      await db.from('crm_atividades').insert({ empresa_id: m.empresa_id, tipo: canais[0] === 'WhatsApp' ? 'whatsapp' : 'email', concluida: true,
        concluida_em: new Date().toISOString(), automatica: true, responsavel_id: m.vendedor.user_id || null,
        descricao: 'Aviso de atraso enviado ao cliente (' + canais.join(' e ') + '): ' + docsTexto(m.titulos) + ', ' + moeda(m.valor) +
          (m.transf ? ' (por transferência: ' + moeda(m.transf.total) + ' com multa e juros, sem boleto)' : '') +
          '. Prazo antes do cartório: ' + prazo.split('-').reverse().join('/') + '. Se o cliente procurar, negocie e avise o financeiro.' });
      feitos.push({ empresa: m.empresa.nome, enviado: true, canais, erro });
    }

    // aviso que saiu só por e-mail enquanto o modelo esperava a Meta: com o modelo aprovado, vai também pelo WhatsApp (mesmo
    // aviso, mesmo prazo), se o prazo ainda não venceu e o cliente não disse que pagou
    if (modeloOk) {
      for (const a of avisos.filter(a => !a.whatsapp_para && !a.pagou_em && String(a.prazo) >= hoje && /modelo/.test(String(a.wa_erro || '')))) {
        const { data: e } = await db.from('crm_empresas').select('id, nome, whatsapp, telefone').eq('id', a.empresa_id).maybeSingle();
        const { data: cs } = await db.from('crm_contatos').select('nome, whatsapp, celular, telefone').eq('empresa_id', a.empresa_id);
        const cel = celularesDoCliente(e, cs || [])[0];
        if (!cel) continue;
        const contato = ((cs || []) as Linha[]).find(y => celularesDoCliente(null, [y]).length) || null;
        const { data: v } = a.vendedor_id ? await db.from('crm_usuarios').select('nome').eq('user_id', a.vendedor_id).maybeSingle() : { data: null };
        const ts = ((tit || []) as Linha[]).filter(t => t.empresa_id === a.empresa_id && ((a.duplicatas as string[]) || []).includes(String(t.duplicata)));
        if (!ts.length) continue;
        const p = parametros({ cliente: primeiro(contato && contato.nome) || String((e && e.nome) || ''), vendedora: primeiro(v && v.nome) || 'o financeiro', titulos: ts, valor: a.valor, prazo: a.prazo });
        const up: Linha = { whatsapp_para: cel };
        try {
          const r = await graph(token, '/' + phoneId + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            messaging_product: 'whatsapp', to: cel, type: 'template',
            template: { name: MODELO, language: { code: 'pt_BR' }, components: [
              { type: 'body', parameters: p.map(param) },
              { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(a.id) }] },
              { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'avisopagou:' + a.id }] }] }
          }) });
          up.wa_msg = (((r.messages as Linha[]) || [])[0] || {}).id || null; up.wa_status = 'enviado'; up.wa_erro = null;
        } catch (err) { up.wa_status = 'falhou'; up.wa_erro = String((err as Error).message).slice(0, 300); }
        await db.from('crm_cobranca_avisos').update(up).eq('id', a.id);
        feitos.push({ empresa: e ? e.nome : '', enviado: up.wa_status === 'enviado', canais: ['WhatsApp (complemento)'], erro: up.wa_erro || null });
      }
    }

    // prazo vencido: tarefa para o administrador decidir o cartório (uma vez por aviso)
    const alertas = alertasCartorio({ avisos, titulos: tit || [], hoje });
    const nomes = new Map(((emps || []) as Linha[]).map(e => [e.id, e.nome]));
    for (const a of alertas) {
      let nome = nomes.get(a.empresa_id);
      if (!nome) { const { data: e } = await db.from('crm_empresas').select('nome').eq('id', a.empresa_id).maybeSingle(); nome = e ? e.nome : 'cliente'; }
      const valor = a.abertos.reduce((s: number, t: Linha) => s + Number(t.valor || 0), 0);
      const txt = 'Cartório? ' + nome + ' recebeu o aviso de atraso em ' + String(a.enviado_em).slice(0, 10).split('-').reverse().join('/') + ' e o prazo venceu em ' +
        String(a.prazo).split('-').reverse().join('/') + ' sem pagamento: ' + docsTexto(a.abertos) + ', ' + moeda(valor) + '. Se não houve acordo com a vendedora, mande para o cartório (Caixa → Cobrança).';
      for (const ad of (adms || []) as Linha[]) await db.from('crm_atividades').insert({ empresa_id: a.empresa_id, responsavel_id: ad.user_id, tipo: 'tarefa', descricao: txt, data_hora: new Date().toISOString(), automatica: true });
      await db.from('crm_cobranca_avisos').update({ alerta_em: new Date().toISOString() }).eq('id', a.id);
    }
    const resumo = await guardaRodada(feitos, alertas.length);
    return resposta(200, { ok: true, enviados: feitos, alertas: alertas.length, modelo_aprovado: modeloOk, boletos: bol ? { ...bol, pdf1: undefined } : null, resumo });
  } catch (e) {
    return resposta(422, { erro: e instanceof Error ? e.message : String(e) });
  }
});
