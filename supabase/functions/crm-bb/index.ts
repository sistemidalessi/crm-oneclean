// Edge Function: boleto e conciliação pela API do Banco do Brasil (02/11/2026, pedido do Anderson: "registro dos boletos e
// conciliação bancária"; aplicação "CRM OneClean" (ID 301956) aprovada por ele no Portal Developers BB, sem o gerente, com as
// APIs Cobranças v2 e Extratos v2). Cobranças funciona com as chaves (sem certificado); Extratos pede o certificado A1 (mTLS):
// fica para o serviço fiscal da VPS.
//   POST { acao: 'situacao' }        confere as chaves (token e uma leitura; sem dados de clientes na resposta)
//   POST { acao: 'maior_numero' }    o maior nosso número já usado no convênio (só o número), para começar a faixa do CRM
//   POST { acao: 'registrar', ids? } registra no banco os boletos preparados (caminho 'api')
//   POST { acao: 'pagos', dias? }    lê os boletos liquidados e dá a baixa (crm_boleto_bb_retorno: título, Caixa no dia do crédito)
//                                    e, desde 03/11/2026, também os feitos no site do BB (crm_bb_site_casar: título certo pelo seu
//                                    número ou por CNPJ + valor + vencimento; o resto fica em crm_bb_site para o administrador)
//   POST { acao: 'baixar_canceladas' } baixa no banco o boleto de nota cancelada (02/11/2026): o cliente não consegue mais pagar
//   POST { acao: 'vencidos' }        boletos em aberto já vencidos com linha digitável, juros e multa (cobrança automática, 04/11/2026)
//   POST { acao: 'extrato', de?, ate?, bruto? }  extrato da conta pela VPS (com o A1, mTLS), 04/11/2026: lê e devolve os lançamentos
//   POST { acao: 'extrato_conciliar', de?, ate? } lê o extrato, guarda em crm_fin_extrato e confere com o Caixa (05/11/2026;
//                                    agendador crm-bb-extrato, de 30 em 30 min das 7h às 21h)
//   POST { acao: 'ciclo' }           o do agendador (pg_cron crm-bb-ciclo, a cada 10 min das 7h às 20h50): prepara as parcelas
//                                    das notas do CRM, registra, baixa os das notas canceladas e lê os pagos
// Chaves só nos Secrets: BB_CLIENT_ID, BB_CLIENT_SECRET, BB_APP_KEY (developer_application_key).
// Quem chama: o administrador logado, ou o banco (crm_bb_chamar, senha que nasce em crm_interno.bb_cfg).
// Deploy: verify_jwt DESLIGADO (o banco chama sem login; a função confere a senha ou o login).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const resposta = (s: number, c: unknown) => new Response(JSON.stringify(c), { status: s, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const OAUTH = Deno.env.get('BB_OAUTH_URL') || 'https://oauth.bb.com.br/oauth/token';
const COBRANCA = Deno.env.get('BB_COBRANCA_URL') || 'https://api.bb.com.br/cobrancas/v2';
const APP = () => encodeURIComponent(Deno.env.get('BB_APP_KEY') ?? '');
// Extratos v2 (OpenAPI do BB, 04/11/2026): produção em extratos.mtls.api.bb.com.br/v2 (a v1 em api-extratos dá 403 para esta
// aplicação); página de 30 a 120 registros; período de no máximo 31 dias; datas DDMMAAAA sem o zero da frente.
const EXTRATOS = Deno.env.get('BB_EXTRATOS_URL') || 'https://extratos.mtls.api.bb.com.br/v2';

// Serviço fiscal da VPS (04/11/2026): a API Extratos exige o certificado A1 (mTLS), que só existe lá. A chamada sai daqui pronta
// (endereço + token); a VPS só acrescenta o certificado (rota /bb, servico-fiscal/bb.js). Mesmos Secrets da crm-fiscal.
async function viaVps(corpo: unknown) {
  const url = Deno.env.get('FISCAL_URL'), tok = Deno.env.get('FISCAL_TOKEN');
  if (!url || !tok) throw new Error('faltam FISCAL_URL e FISCAL_TOKEN nos Secrets');
  const r = await fetch(url.replace(/\/$/, '') + '/bb', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo), signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({ erro: 'resposta inválida do serviço fiscal (HTTP ' + r.status + ')' }));
  if (r.status === 404) throw new Error('o serviço fiscal da VPS ainda não tem a rota /bb: falta o git pull e reiniciar o serviço (versão 2026-11-04a)');
  if (!r.ok) throw new Error(j.erro || 'serviço fiscal: HTTP ' + r.status);
  return j as { status: number, json: any, texto?: string };
}
// token para API com certificado: primeiro do jeito de sempre; se o BB pedir o certificado também no token, pela VPS
async function tokenMtls(escopo: string) {
  try { return await token(escopo); } catch (e1) {
    const id = Deno.env.get('BB_CLIENT_ID') ?? '', seg = Deno.env.get('BB_CLIENT_SECRET') ?? '';
    const r = await viaVps({ url: OAUTH, metodo: 'POST', basic: id + ':' + seg, form: { grant_type: 'client_credentials', scope: escopo } });
    if (r.status !== 200 || !r.json?.access_token) throw new Error((e1 as Error).message + ' / pela VPS (' + r.status + '): ' + String(r.json?.error_description || r.json?.error || r.texto || '').slice(0, 200));
    return r.json.access_token as string;
  }
}
// data do extrato: o BB manda/recebe DDMMAAAA como número (o zero da frente some: 4112026 = 04/11/2026)
const dataExtrato = (isoD: string) => { const [a, m, d] = isoD.split('-'); return String(Number(d + m + a)); };
const isoExtrato = (v: unknown) => { const s = String(v ?? '').replace(/\D/g, '').padStart(8, '0'); return /^\d{8}$/.test(s) && s !== '00000000' ? s.slice(4) + '-' + s.slice(2, 4) + '-' + s.slice(0, 2) : null; };

async function token(escopo: string) {
  const id = Deno.env.get('BB_CLIENT_ID') ?? '', seg = Deno.env.get('BB_CLIENT_SECRET') ?? '';
  if (!id || !seg || !Deno.env.get('BB_APP_KEY')) throw new Error('faltam as chaves do BB nos Secrets (BB_CLIENT_ID, BB_CLIENT_SECRET, BB_APP_KEY)');
  const r = await fetch(OAUTH, { method: 'POST', headers: { Authorization: 'Basic ' + btoa(id + ':' + seg), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: escopo }) });
  const t = await r.text();
  let j: any = null; try { j = JSON.parse(t); } catch { /* texto */ }
  if (!r.ok || !j?.access_token) throw new Error('o BB recusou as chaves (' + r.status + '): ' + String(j?.error_description || j?.error || t).slice(0, 200));
  return j.access_token as string;
}
// data do BB "dd.mm.aaaa" ⇄ ISO
const br = (iso: string) => { const [a, m, d] = String(iso).slice(0, 10).split('-'); return d + '.' + m + '.' + a; };
const iso = (s: string) => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : null; };
const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const maisDias = (isoD: string, n: number) => new Date(Date.parse(isoD + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
// texto do pagador: sem acento nem caractere estranho, no tamanho que o banco aceita
// "Seu número" do boleto (numeroTituloBeneficiario): o BB recusou "002862/01" (4678420, "preenchido com dados inválidos",
// 03/11/2026, 1º boleto da virada). Vai só com letras e números: "00286201" (nota 002862, parcela 01); a mensagem do boleto
// continua com "NF 002862/01".
const seuNumero = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
const txt = (v: unknown, n: number) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .,\/&-]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, n);
const msgBB = (j: any, t: string) => {
  const e = j?.erros || j?.errors || (j?.error ? [j.error] : null);
  if (Array.isArray(e) && e.length) return e.map((x: any) => [x.codigo || x.code, x.mensagem || x.message || x.textoMensagem].filter(Boolean).join(' ')).join('; ').slice(0, 300);
  return String(j?.message || j?.detail || t || '').slice(0, 300);
};

// lista os boletos do convênio (situação A = em ser, B = baixados/liquidados), todas as páginas
async function lista(tk: string, b: any, situacao: 'A' | 'B', de: string, ate: string, extra = '') {
  const ag = dig(b.agencia).slice(0, -1), cc = dig(b.conta).slice(0, -1);
  const out: any[] = [];
  let indice = 0;
  for (let volta = 0; volta < 40; volta++) {
    const u = COBRANCA + '/boletos?indicadorSituacao=' + situacao + '&agenciaBeneficiario=' + ag + '&contaBeneficiario=' + cc +
      '&dataInicioMovimento=' + br(de) + '&dataFimMovimento=' + br(ate) + extra + (indice ? '&indice=' + indice : '') + '&gw-dev-app-key=' + APP();
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + tk } });
    const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* texto */ }
    if (r.status === 404) break;   // sem boletos no período
    if (!r.ok) throw new Error('lista de boletos (' + r.status + '): ' + msgBB(j, t));
    out.push(...(j?.boletos || []));
    if (j?.indicadorContinuidade !== 'S' || !j?.proximoIndice) break;
    indice = j.proximoIndice;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  let ok = false, papel: string | null = null;
  // a crm-cobranca (04/11/2026) chama a leitura dos vencidos com a chave de serviço do próprio projeto
  const servico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (servico && bearer === servico) ok = true;
  else if (bearer.length >= 32 && bearer.split('.').length !== 3) {
    const { data } = await db.rpc('crm_bb_senha_ok', { p: bearer });
    ok = data === true;
  } else {
    const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: 'Bearer ' + bearer } }, auth: { persistSession: false } });
    const { data: u } = await comoUsuario.auth.getUser();
    if (u?.user) { const { data: eu } = await db.from('crm_usuarios').select('papel, ativo').eq('user_id', u.user.id).maybeSingle(); papel = eu?.ativo ? eu.papel : null; ok = papel === 'admin'; }
  }
  let c: any; try { c = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  // o ciclo (registrar o que falta e ler os pagos) também por quem gera a DANFE: gestora e logística
  if (!ok && c?.acao === 'ciclo' && ['gestor', 'logistica'].includes(String(papel))) ok = true;
  if (!ok) return resposta(401, { erro: 'só o administrador' });
  const { data: cfgL } = await db.from('crm_config').select('dados').eq('id', 1).maybeSingle();
  const b = cfgL?.dados?.boleto || {}, emit = cfgL?.dados?.fiscal?.emitente || {};

  try {
    if (c.acao === 'situacao') {
      const tk = await token('cobrancas.boletos-info');
      const l = await lista(tk, b, 'B', maisDias(hojeSP(), -5), hojeSP());
      return resposta(200, { cobranca: 'ok', baixados_5_dias: l.length, ligado: !!b.ligado, caminho: b.caminho || null });
    }

    if (c.acao === 'maior_numero') {
      // o maior nosso número (10 últimos dígitos) usado no convênio nos últimos 'dias' (em ser e baixados)
      const tk = await token('cobrancas.boletos-info');
      const dias = Math.min(365, Math.max(1, Number(c.dias) || 120)), de = maisDias(hojeSP(), -dias), ate = hojeSP();
      let maior = 0, n = 0;
      for (const s of ['A', 'B'] as const) for (const x of await lista(tk, b, s, de, ate)) {
        n++; const num = dig(x.numeroBoletoBB);
        if (num.slice(3, 10) === String(b.convenio)) maior = Math.max(maior, Number(num.slice(10)));
      }
      return resposta(200, { boletos_lidos: n, maior_seq: maior });
    }

    // ------------------------------------------------------------ registrar
    async function registrar(ids?: string[]) {
      if (!b.ligado || b.caminho !== 'api') return { pulado: 'boleto pela API desligado' };
      let q = db.from('crm_boletos_bb').select('*').eq('situacao', 'preparado').eq('caminho', 'api').order('vencimento').limit(50);
      if (ids && ids.length) q = q.in('id', ids);
      const { data: prep } = await q;
      if (!prep || !prep.length) return { registrados: 0, erros: 0 };
      const tk = await token('cobrancas.boletos-requisicao cobrancas.boletos-info');
      let feitos = 0, erros = 0; const detalhes: string[] = [];
      for (const bo of prep) {
        const { data: e } = await db.from('crm_empresas').select('nome, razao_social, cnpj, logradouro, numero, complemento, bairro, cidade, uf, cep, telefone').eq('id', bo.empresa_id).maybeSingle();
        const doc = dig(e?.cnpj);
        const juros = Number(b.juros_mes_pct) || 0, multa = Number(b.multa_pct) || 0;
        const corpo: any = {
          numeroConvenio: Number(b.convenio), numeroCarteira: Number(b.carteira || 17), numeroVariacaoCarteira: Number(b.variacao || 19),
          codigoModalidade: 1, dataEmissao: br(bo.emissao), dataVencimento: br(bo.vencimento), valorOriginal: Number(bo.valor),
          valorAbatimento: 0, quantidadeDiasProtesto: 0, quantidadeDiasNegativacao: 0, indicadorAceiteTituloVencido: 'S', numeroDiasLimiteRecebimento: 0,
          codigoAceite: 'N', codigoTipoTitulo: 2, descricaoTipoTitulo: 'DM', indicadorPermissaoRecebimentoParcial: 'N',
          numeroTituloBeneficiario: seuNumero(bo.documento || bo.duplicata), numeroTituloCliente: '000' + bo.nosso_numero,
          mensagemBloquetoOcorrencia: txt(b.instrucao || ('NF ' + (bo.duplicata || '')), 165),
          jurosMora: juros > 0 ? { tipo: 2, porcentagem: juros } : { tipo: 3 },
          multa: multa > 0 ? { tipo: 2, data: br(maisDias(bo.vencimento, 1)), porcentagem: multa } : { tipo: 0 },
          pagador: {
            tipoInscricao: doc.length === 11 ? 1 : 2, numeroInscricao: Number(doc), nome: txt(e?.razao_social || e?.nome, 60),
            endereco: txt([e?.logradouro, e?.numero, e?.complemento].filter(Boolean).join(' '), 60), cep: Number(dig(e?.cep)),
            cidade: txt(e?.cidade, 30), bairro: txt(e?.bairro, 30), uf: txt(e?.uf, 2), telefone: dig(e?.telefone).slice(0, 11)
          },
          indicadorPix: b.pix === false ? 'N' : 'S'
        };
        const manda = async () => {
          const r = await fetch(COBRANCA + '/boletos?gw-dev-app-key=' + APP(), { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
          const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* texto */ }
          return { r, t, j };
        };
        let { r, t, j } = await manda();
        // sem chave Pix ligada ao convênio, o banco recusa o boleto com Pix: manda sem
        if (!r.ok && corpo.indicadorPix === 'S' && /pix/i.test(msgBB(j, t))) { corpo.indicadorPix = 'N'; ({ r, t, j } = await manda()); }
        if (r.ok && j?.linhaDigitavel) {
          await db.from('crm_boletos_bb').update({
            situacao: 'registrado', registrado_em: new Date().toISOString(), linha_digitavel: dig(j.linhaDigitavel), codigo_barras: dig(j.codigoBarraNumerico), motivo: null,
            retorno: (bo.retorno || []).concat([{ api: 'registro', em: new Date().toISOString(), numero: j.numero, pix: j.qrCode?.emv || null, pix_url: j.qrCode?.url || null, txid: j.qrCode?.txId || null }]),
            atualizado_em: new Date().toISOString()
          }).eq('id', bo.id);
          feitos++;
        } else {
          const m = 'rejeitado pelo banco: ' + msgBB(j, t);
          await db.from('crm_boletos_bb').update({ situacao: 'erro', motivo: m.slice(0, 300), atualizado_em: new Date().toISOString() }).eq('id', bo.id);
          erros++; detalhes.push((bo.documento || bo.duplicata) + ': ' + m);
          console.error('[crm-bb] ' + (bo.documento || bo.duplicata) + ' ' + r.status + ' ' + m);
        }
      }
      return { registrados: feitos, erros, detalhes };
    }

    // ------------------------------------------------------------ pagos (baixa)
    async function pagos(dias: number) {
      if (!b.ligado || b.caminho !== 'api') return { pulado: 'boleto pela API desligado' };
      const tk = await token('cobrancas.boletos-info');
      // 6 = liquidado; 12 = liquidado/pago em cartório (04/11/2026: a ODM pagou no cartório e o CRM não via o pagamento)
      const l = [...await lista(tk, b, 'B', maisDias(hojeSP(), -dias), hojeSP(), '&codigoEstadoTituloCobranca=6'),
        ...await lista(tk, b, 'B', maisDias(hojeSP(), -dias), hojeSP(), '&codigoEstadoTituloCobranca=12')];
      const nossos = l.map(x => dig(x.numeroBoletoBB).slice(3)).filter(n => n.length === 17);
      if (!nossos.length) return { liquidados: 0 };
      // boletos feitos no SITE do BB (notas antigas do FKN; 03/11/2026): o que não é do CRM vai à crm_bb_site_casar com o
      // pagador e o "seu número" do detalhe do boleto; ela só baixa quando acha UM título certo (o resto fica para o administrador)
      let site: any = null;
      try { site = await doSite(tk, l, nossos); } catch (e) { site = { erro: String((e as Error).message || e).slice(0, 200) }; console.error('[crm-bb] site', e); }
      const { data: meus } = await db.from('crm_boletos_bb').select('nosso_numero').in('nosso_numero', nossos).neq('situacao', 'pago');
      const set = new Set((meus || []).map((m: any) => m.nosso_numero));
      const itens = l.filter(x => set.has(dig(x.numeroBoletoBB).slice(3))).map(x => ({
        // no Caixa vale o dia do CRÉDITO que o BB informa (um dia útil depois do pagamento), para bater com o saldo do banco
        // (03/11/2026: o Anderson testou o dia do pagamento e voltou atrás no mesmo dia, depois de conferir com o extrato)
        nosso_numero: dig(x.numeroBoletoBB).slice(3), movimento: '06', credito: iso(x.dataCredito) || iso(x.dataMovimento), ocorrencia: iso(x.dataMovimento),
        pago: x.valorPago ?? x.valorAtual ?? null, tarifa: null, origem: 'api'
      }));
      if (!itens.length) return { liquidados: 0, site };
      const ass = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('api|' + JSON.stringify(itens))))].map(x => x.toString(16).padStart(2, '0')).join('');
      const { data, error } = await db.rpc('crm_boleto_bb_retorno', { p_assinatura: ass, p_cab: { convenio: String(b.convenio), origem: 'api' }, p_itens: itens });
      if (error) throw new Error('baixa: ' + error.message);
      return { liquidados: (data?.liquidados || []).length, resumo: data, site };
    }
    async function doSite(tk: string, l: any[], nossos: string[]) {
      const { data: doCrm } = await db.from('crm_boletos_bb').select('nosso_numero').in('nosso_numero', nossos);
      const crm = new Set((doCrm || []).map((m: any) => m.nosso_numero));
      const { data: vistos } = await db.from('crm_bb_site').select('nosso_numero, situacao, visto_em').in('nosso_numero', nossos);
      // já resolvidos ficam de fora; dúvida e sem título voltam a ser conferidos a cada 6 horas (o título pode ter entrado)
      const pula = new Set((vistos || []).filter((v: any) => ['baixado', 'ja_recebido'].includes(v.situacao) || Date.now() - Date.parse(v.visto_em) < 6 * 3600e3).map((v: any) => v.nosso_numero));
      const alvo = l.filter(x => { const n = dig(x.numeroBoletoBB).slice(3); return n.length === 17 && !crm.has(n) && !pula.has(n); }).slice(0, 30);
      if (!alvo.length) return { vistos: 0 };
      const itens: any[] = [];
      for (const x of alvo) {
        let d: any = {};
        try {
          const r = await fetch(COBRANCA + '/boletos/' + dig(x.numeroBoletoBB) + '?numeroConvenio=' + encodeURIComponent(String(b.convenio)) + '&gw-dev-app-key=' + APP(), { headers: { Authorization: 'Bearer ' + tk } });
          const t = await r.text(); try { d = JSON.parse(t) || {}; } catch { d = {}; }
          if (!r.ok) d = { erro: r.status + ' ' + msgBB(d, t) };
        } catch (e) { d = { erro: String((e as Error).message || e).slice(0, 120) }; }
        const pg = d.pagador || {};
        itens.push({
          nosso_numero: dig(x.numeroBoletoBB).slice(3),
          doc: dig(d.numeroInscricaoSacadoCobranca ?? pg.numeroInscricao ?? pg.numeroInscricaoPagador ?? d.numeroInscricaoPagador ?? ''),
          seu: String(d.numeroTituloCedenteCobranca ?? d.numeroTituloBeneficiario ?? x.numeroTituloBeneficiario ?? '').trim(),
          nome: String(d.nomeSacadoCobranca ?? pg.nome ?? '').trim(),
          valor: d.valorOriginalTituloCobranca ?? x.valorOriginal ?? null,
          vencimento: iso(d.dataVencimentoTituloCobranca) || iso(x.dataVencimento),
          credito: iso(x.dataCredito) || iso(d.dataCreditoLiquidacao) || iso(x.dataMovimento), ocorrencia: iso(x.dataMovimento),
          pago: x.valorPago ?? d.valorPagoSacado ?? x.valorAtual ?? null,
          // o que o banco mandou (sem o texto livre), para conferir o casamento
          dados: { erro: d.erro || null, vencimento: x.dataVencimento || null, valor: x.valorOriginal ?? null, pago: x.valorPago ?? null,
            movimento: x.dataMovimento || null, credito: x.dataCredito || null, recebimento: d.dataRecebimentoTitulo || null, credito_liq: d.dataCreditoLiquidacao || null }
        });
      }
      const { data, error } = await db.rpc('crm_bb_site_casar', { p_itens: itens });
      if (error) throw new Error('site: ' + error.message);
      return { vistos: itens.length, baixados: data?.baixados || 0, itens: (data?.itens || []).map((i: any) => i.situacao) };
    }

    // ------------------------------------------------------------ nota cancelada → boleto baixado no banco
    // O boleto da nota cancelada não pode continuar valendo (o cliente pagaria uma nota que não existe). Registrado: pede a
    // baixa ao BB (POST /boletos/{id}/baixar); preparado ou com erro (nunca foi ao banco): só marca "cancelado" aqui.
    async function baixarCanceladas() {
      if (!b.ligado || b.caminho !== 'api') return { pulado: 'boleto pela API desligado' };
      const { data: vivos } = await db.from('crm_boletos_bb').select('id, nosso_numero, duplicata, documento, nota_numero, situacao, retorno')
        .in('situacao', ['preparado', 'registrado', 'erro']).eq('caminho', 'api').limit(500);
      if (!vivos || !vivos.length) return { baixados: 0 };
      // a série vem da duplicata: "002862/01" é a série 1; "2-000012/01", a série 2
      const serieDe = (d: string) => { const m = /^(\d+)-/.exec(String(d || '')); return m ? Number(m[1]) : 1; };
      const nums = [...new Set(vivos.map((v: any) => Number(v.nota_numero)).filter(Boolean))];
      const { data: canc } = nums.length ? await db.from('crm_nfe').select('serie, numero').eq('ambiente', 'producao').eq('situacao', 'cancelada').in('numero', nums) : { data: [] };
      const cancSet = new Set((canc || []).map((n: any) => Number(n.serie) + '-' + Number(n.numero)));
      const alvo = vivos.filter((v: any) => cancSet.has(serieDe(v.duplicata) + '-' + Number(v.nota_numero)));
      if (!alvo.length) return { baixados: 0 };
      let tk = '', baixados = 0, cancelados = 0, erros = 0; const detalhes: string[] = [];
      const agora = () => new Date().toISOString();
      for (const bo of alvo) {
        if (bo.situacao !== 'registrado') {
          await db.from('crm_boletos_bb').update({ situacao: 'cancelado', motivo: 'nota cancelada (o boleto não chegou ao banco)', atualizado_em: agora() }).eq('id', bo.id);
          cancelados++; continue;
        }
        if (!tk) tk = await token('cobrancas.boletos-requisicao cobrancas.boletos-info');
        const r = await fetch(COBRANCA + '/boletos/000' + bo.nosso_numero + '/baixar?gw-dev-app-key=' + APP(), { method: 'POST',
          headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify({ numeroConvenio: Number(b.convenio) }) });
        const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* texto */ }
        const m = msgBB(j, t);
        // já baixado ou liquidado no banco: não insiste (o "pagos" cuida do liquidado)
        if (r.ok || /baixad/i.test(m)) {
          await db.from('crm_boletos_bb').update({ situacao: 'baixado', motivo: 'nota cancelada: boleto baixado no banco', atualizado_em: agora(),
            retorno: (bo.retorno || []).concat([{ api: 'baixa', em: agora(), motivo: 'nota cancelada', resposta: r.ok ? (j?.dataBaixa || 'ok') : m }]) }).eq('id', bo.id);
          baixados++;
        } else {
          erros++; detalhes.push((bo.documento || bo.duplicata) + ': ' + m);
          await db.from('crm_boletos_bb').update({ motivo: ('nota cancelada, o banco recusou a baixa: ' + m).slice(0, 300), atualizado_em: agora() }).eq('id', bo.id);
          console.error('[crm-bb] baixa ' + (bo.documento || bo.duplicata) + ' ' + r.status + ' ' + m);
        }
      }
      return { baixados, cancelados, erros, detalhes };
    }

    // as datas de cada liquidado (pagamento × crédito), sem dados do cliente: para conferir em que dia o dinheiro entra
    if (c.acao === 'datas') {
      const tk = await token('cobrancas.boletos-info');
      // { todos: true }: todos os baixados do período, com o estado (04/11/2026: o pago em cartório não vinha como 6 = liquidado)
      const l = await lista(tk, b, 'B', maisDias(hojeSP(), -Math.min(30, Math.max(1, Number(c.dias) || 3))), hojeSP(), c.todos ? '' : '&codigoEstadoTituloCobranca=6');
      return resposta(200, l.map(x => ({ n: dig(x.numeroBoletoBB).slice(3), estado: x.codigoEstadoTituloCobranca ?? null, estado_txt: x.estadoTituloCobranca || null, movimento: x.dataMovimento || null, credito: x.dataCredito || null, vencimento: x.dataVencimento || null, valor: x.valorOriginal ?? null, pago: x.valorPago ?? null })));
    }
    // boletos em aberto já vencidos (04/11/2026, cobrança automática: o boleto atualizado sai ao cliente no 1º dia de atraso).
    // Devolve, de cada um, o que o boleto atualizado precisa (linha digitável, valores, juros e multa do próprio boleto);
    // com { bruto: true }, o detalhe inteiro dos 2 primeiros (para conferir os nomes dos campos do BB).
    if (c.acao === 'vencidos') {
      const tk = await token('cobrancas.boletos-info');
      const ag = dig(b.agencia).slice(0, -1), cc = dig(b.conta).slice(0, -1);
      const l: any[] = [];
      let indice = 0;
      for (let volta = 0; volta < 20; volta++) {
        const u = COBRANCA + '/boletos?indicadorSituacao=A&boletoVencido=S&agenciaBeneficiario=' + ag + '&contaBeneficiario=' + cc +
          '&dataInicioVencimento=' + br(maisDias(hojeSP(), -Math.min(180, Math.max(1, Number(c.dias) || 60)))) + '&dataFimVencimento=' + br(maisDias(hojeSP(), -1)) +
          (indice ? '&indice=' + indice : '') + '&gw-dev-app-key=' + APP();
        const r = await fetch(u, { headers: { Authorization: 'Bearer ' + tk } });
        const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* texto */ }
        if (r.status === 404) break;
        if (!r.ok) throw new Error('lista de vencidos (' + r.status + '): ' + msgBB(j, t));
        l.push(...(j?.boletos || []));
        if (j?.indicadorContinuidade !== 'S' || !j?.proximoIndice) break;
        indice = j.proximoIndice;
      }
      const out: any[] = [], bruto: any[] = [];
      for (const x of l.slice(0, 80)) {
        let d: any = {};
        try {
          const r = await fetch(COBRANCA + '/boletos/' + dig(x.numeroBoletoBB) + '?numeroConvenio=' + encodeURIComponent(String(b.convenio)) + '&gw-dev-app-key=' + APP(), { headers: { Authorization: 'Bearer ' + tk } });
          const t = await r.text(); try { d = JSON.parse(t) || {}; } catch { d = {}; }
          if (!r.ok) d = { erro: r.status + ' ' + msgBB(d, t) };
        } catch (e) { d = { erro: String((e as Error).message || e).slice(0, 120) }; }
        if (c.bruto && bruto.length < 2) bruto.push({ lista: x, detalhe: d });
        out.push({ nosso_numero: dig(x.numeroBoletoBB).slice(3), vencimento: iso(x.dataVencimento) || iso(d.dataVencimentoTituloCobranca), valor: x.valorOriginal ?? d.valorOriginalTituloCobranca ?? null,
          valor_atual: x.valorAtual ?? d.valorAtualTituloCobranca ?? null, linha: dig(d.codigoLinhaDigitavel), seu: String(d.numeroTituloCedenteCobranca ?? x.numeroTituloBeneficiario ?? '').trim(),
          doc: dig(d.numeroInscricaoSacadoCobranca ?? ''), erro: d.erro || null,
          juros: { tipo: d.codigoTipoJuroMora ?? null, pct: d.percentualJuroMoraTitulo ?? null, valor: d.valorJuroMoraTitulo ?? null },
          multa: { tipo: d.codigoTipoMulta ?? null, pct: d.percentualMultaTitulo ?? null, valor: d.valorMultaTituloCobranca ?? null, data: iso(d.dataMultaTitulo) },
          codigo: dig(d.textoCodigoBarrasTituloCobranca), estado: d.codigoEstadoTituloCobranca ?? x.codigoEstadoTituloCobranca ?? null, limite: iso(d.dataLimiteRecebimentoTitulo), emissao: iso(d.dataEmissaoTituloCobranca),
          pagador: { nome: String(d.nomeSacadoCobranca || '').trim(), endereco: String(d.textoEnderecoSacadoCobranca || '').trim(), bairro: String(d.nomeBairroSacadoCobranca || '').trim(),
            cidade: String(d.nomeMunicipioSacadoCobranca || '').trim(), uf: String(d.siglaUnidadeFederacaoSacadoCobranca || '').trim(), cep: dig(d.numeroCepSacadoCobranca).padStart(8, '0') } });
      }
      return resposta(200, { n: l.length, boletos: out, ...(c.bruto ? { bruto } : {}) });
    }
    // extrato da conta corrente (04/11/2026, conciliação bancária): { de?, ate?, bruto? } só lê e devolve
    async function lerExtrato(deP: unknown, ateP: unknown, op: any = {}) {
      const ag = dig(b.agencia).slice(0, -1), cc = dig(b.conta).slice(0, -1);
      if (!ag || !cc) throw new Error('faltam agência e conta em Configurações → Integrações → Dados do convênio');
      const ate = /^\d{4}-\d{2}-\d{2}$/.test(String(ateP)) ? String(ateP) : hojeSP();
      let de = /^\d{4}-\d{2}-\d{2}$/.test(String(deP)) ? String(deP) : maisDias(ate, -2);
      if (de < maisDias(ate, -30)) de = maisDias(ate, -30);   // o BB aceita no máximo 31 dias por consulta
      // diagnóstico (04/11/2026, 1ª leitura deu 403 sem texto): { token_vps: true } pega o token pela VPS (com o certificado) e
      // { base: 'https://...bb.com.br/...' } troca o endereço da API
      const escopo = String(op.escopo || 'extrato-info');
      let tk = '';
      if (op.token_vps) {
        const id = Deno.env.get('BB_CLIENT_ID') ?? '', seg = Deno.env.get('BB_CLIENT_SECRET') ?? '';
        const t = await viaVps({ url: OAUTH, metodo: 'POST', basic: id + ':' + seg, form: { grant_type: 'client_credentials', scope: escopo } });
        if (t.status !== 200 || !t.json?.access_token) return { ok: false, etapa: 'token pela VPS', status: t.status, erro: String(t.json?.error_description || t.json?.error || t.texto || '').slice(0, 300) };
        tk = t.json.access_token;
      } else tk = await tokenMtls(escopo);
      const base = /^https:\/\/([a-z0-9-]+\.)*bb\.com\.br\//i.test(String(op.base || '')) ? String(op.base).replace(/\/$/, '') : EXTRATOS;
      const lanc: any[] = []; let pagina = 1, ultimo: any = null;
      for (let volta = 0; volta < 30; volta++) {
        const u = base + '/conta-corrente/agencia/' + ag + '/conta/' + cc + '?numeroPaginaSolicitacao=' + pagina + '&quantidadeRegistroPaginaSolicitacao=120' +
          '&dataInicioSolicitacao=' + dataExtrato(de) + '&dataFimSolicitacao=' + dataExtrato(ate) + '&gw-dev-app-key=' + APP();
        const r = await viaVps({ url: u, token: tk });
        ultimo = r;
        if (r.status === 404) break;   // sem lançamentos no período
        if (r.status !== 200) return { ok: false, status: r.status, erro: msgBB(r.json, r.texto || ''), corpo: r.json || r.texto || null, base, escopo, de, ate };
        lanc.push(...(r.json?.listaLancamento || []));
        const prox = Number(r.json?.numeroPaginaProximo) || 0;
        if (!prox || prox <= pagina) break;
        pagina = prox;
      }
      const l = lanc.map((x: any) => ({ data: isoExtrato(x.dataLancamento), movimento: isoExtrato(x.dataMovimento), valor: Number(x.valorLancamento) || 0,
        sinal: x.indicadorSinalLancamento ?? null, tipo: x.indicadorTipoLancamento ?? null,
        historico: String(x.textoDescricaoSubHistorico ?? x.textoDescricaoHistorico ?? '').trim(), complemento: String(x.textoInformacaoComplementar ?? '').trim(),
        documento: x.numeroDocumento ?? null, codigo: x.codigoHistorico ?? null, lote: x.numeroLote ?? null,
        contrapartida: dig(x.numeroCadastroPessoaFisicaCadastroNacPessoasJuridicasContrapartida ?? x.numeroCpfCnpjContrapartida) || null,
        id_transacao: String(x.textoIdentificadorUnicoTransacao ?? '').trim() || null }));
      return { ok: true, de, ate, n: l.length, lancamentos: l, ...(op.bruto ? { bruto: lanc.slice(0, 5), pagina: ultimo?.json ? Object.keys(ultimo.json) : null } : {}) };
    }
    if (c.acao === 'extrato') return resposta(200, await lerExtrato(c.de, c.ate, c));
    // conciliação (05/11/2026): lê o extrato (de ontem até hoje, ou { de, ate }), guarda cada linha com uma chave que não muda
    // entre leituras (crm_fin_extrato_gravar: a "Cobrança" e os saldos do dia crescem e são atualizados), guarda o saldo do BB
    // (conta + aplicação automática = "Saldo Disponivel") e confere com o Caixa (crm_fin_extrato_conciliar). O agendador
    // crm-bb-extrato chama de 30 em 30 minutos; o botão "Ler o extrato agora" do Caixa também.
    // Só entram as linhas a partir do início da conciliação (crm_config.dados.extrato.desde; padrão 05/11/2026: até 04/11 o
    // Caixa foi conferido à mão com o PDF e bateu).
    if (c.acao === 'extrato_conciliar') {
      const desde = String(cfgL?.dados?.extrato?.desde || '2026-11-05');
      const ate = /^\d{4}-\d{2}-\d{2}$/.test(String(c.ate)) ? String(c.ate) : hojeSP();
      let de = /^\d{4}-\d{2}-\d{2}$/.test(String(c.de)) ? String(c.de) : maisDias(ate, -1);
      if (de < desde) de = desde;
      if (de > ate) return resposta(200, { ok: true, pulado: 'a conciliação começa em ' + desde });
      const r: any = await lerExtrato(de, ate);
      if (!r.ok) return resposta(200, r);
      const vistos = new Map<string, number>(), linhas: any[] = [];
      for (const x of r.lancamentos) {
        if (!x.data || x.data < desde) continue;
        const base = x.id_transacao ? 'id:' + x.id_transacao
          : [x.data, x.sinal, x.documento, x.lote, x.codigo, x.historico, x.complemento].map(v => String(v ?? '')).join('|');
        const n = (vistos.get(base) || 0) + 1; vistos.set(base, n);
        linhas.push({ ...x, documento: x.documento == null ? null : String(x.documento), chave: base + '|' + n });
      }
      // saldo do BB: a linha "Saldo Disponivel" (tipo SD) do dia mais recente; conta = "S A L D O"; aplicação = resgate automático (RA)
      const ult = r.lancamentos.filter((x: any) => x.tipo === 'SD').sort((a: any, z: any) => String(z.data).localeCompare(String(a.data)))[0];
      const doDia = (pred: (x: any) => boolean) => { const y = r.lancamentos.find((x: any) => ult && x.data === ult.data && pred(x)); return y ? (y.sinal === 'D' ? -y.valor : y.valor) : null; };
      const saldo = ult ? { data: ult.data, saldo: ult.sinal === 'D' ? -ult.valor : ult.valor, conta: doDia(x => /^s a l d o$/i.test(x.historico)), investimento: doDia(x => x.tipo === 'RA') } : null;
      const { data: gravadas, error: e1 } = await db.rpc('crm_fin_extrato_gravar', { p_linhas: linhas, p_saldo: saldo });
      if (e1) throw new Error('gravar o extrato: ' + e1.message);
      const { data: conc, error: e2 } = await db.rpc('crm_fin_extrato_conciliar', { p_desde: desde });
      if (e2) throw new Error('conciliar: ' + e2.message);
      return resposta(200, { ok: true, de, ate, lidas: r.n, gravadas, saldo, conciliacao: conc });
    }
    if (c.acao === 'baixar_canceladas') return resposta(200, await baixarCanceladas());
    if (c.acao === 'registrar') return resposta(200, await registrar(Array.isArray(c.ids) ? c.ids : undefined));
    if (c.acao === 'pagos') return resposta(200, await pagos(Math.min(30, Math.max(1, Number(c.dias) || 5))));
    if (c.acao === 'ciclo') {
      if (!b.ligado || b.caminho !== 'api') return resposta(200, { pulado: 'boleto pela API desligado' });
      const { data: dups } = await db.rpc('crm_boleto_bb_a_registrar');
      let prep: any = null;
      if (dups && dups.length) { const { data, error } = await db.rpc('crm_boleto_bb_preparar', { p_duplicatas: dups }); if (error) throw new Error('preparar: ' + error.message); prep = data; }
      const bx = await baixarCanceladas();
      const reg = await registrar();
      const pg = await pagos(5);
      return resposta(200, { preparados: prep?.preparados || 0, pulados: prep?.pulados || [], baixas: bx, registro: reg, pagos: pg });
    }
    return resposta(400, { erro: 'ação desconhecida' });
  } catch (e) {
    console.error('[crm-bb] ' + (e as Error).message);
    return resposta(500, { erro: (e as Error).message });
  }
});
