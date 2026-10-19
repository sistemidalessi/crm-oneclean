'use strict';
/* Notas de COMPRA pela Sefaz (17/10/2026, pedido do Anderson: o histórico do comprador sênior "buscar na Sefaz").
   Distribuição de DF-e do Ambiente Nacional (NT 2014.002): devolve, pela ordem do NSU, tudo o que foi emitido CONTRA o
   CNPJ da empresa nos últimos 3 meses — primeiro o RESUMO de cada nota (resNFe: fornecedor, valor, data) e os eventos
   (cancelamento do fornecedor). O XML COMPLETO (itens e preços) só vem depois da "Ciência da Operação" (evento 210210,
   no Ambiente Nacional, cOrgao 91), que é só o "fiquei sabendo"; não confirma nem recusa a compra.
   Regras de uso da Sefaz (senão cStat 656 e o CNPJ fica bloqueado 1 hora):
     - sempre continuar do ultNSU que a Sefaz devolveu;
     - quando vier 137 (nada novo) ou ultNSU = maxNSU, esperar 1 hora antes da próxima consulta;
     - no máximo 20 consultas por hora.
   Quem controla a espera é a Edge Function crm-fiscal (guarda o NSU e a hora da próxima consulta no banco). */

const zlib = require('zlib');
const { NS } = require('./nfe');
const S = require('./sefaz');
const A = require('./assinatura');

const AN = {
  producao: { dist: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx', evento: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx' },
  homologacao: { dist: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx', evento: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx' }
};
const WSDL_DIST = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
const WSDL_EV = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
const C_ORGAO_AN = '91';
const doc = v => String(v || '').replace(/[^0-9A-Z]/gi, '').toUpperCase();
// texto lido do XML: tira as entidades (&amp; → &) e os espaços repetidos
const le = v => String(v == null ? '' : v).replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const nsu = v => String(Math.max(0, Math.floor(Number(v) || 0))).padStart(15, '0');

// ---------------------------------------------------------------- mensagens (puras; validadas no XSD nos testes)
// por NSU (o normal) ou por chave (uma nota só)
function msgDist({ ambiente, cnpj, ultNSU, chave }) {
  const corpo = chave ? '<consChNFe><chNFe>' + String(chave).replace(/\D/g, '') + '</chNFe></consChNFe>' : '<distNSU><ultNSU>' + nsu(ultNSU) + '</ultNSU></distNSU>';
  return '<distDFeInt xmlns="' + NS + '" versao="1.01"><tpAmb>' + S.tpAmb(ambiente) + '</tpAmb><cUFAutor>' + S.CUF_SP + '</cUFAutor><CNPJ>' + doc(cnpj) + '</CNPJ>' + corpo + '</distDFeInt>';
}
const envelopeDist = xml => '<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
  'xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDistDFeInteresse xmlns="' + WSDL_DIST + '"><nfeDadosMsg>' + xml + '</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>';
const envelopeEv = xml => '<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
  'xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="' + WSDL_EV + '">' + xml + '</nfeDadosMsg></soap12:Body></soap12:Envelope>';

// Manifestação do destinatário (sem a assinatura): { id, infEvento }. A ciência é provisória ("fiquei sabendo"); as outras
// três são a resposta definitiva (19/10/2026): confirmação, desconhecimento e operação não realizada (esta com justificativa
// de 15 a 255 caracteres). As descrições são as do leiauteConfRecebto (sem acento, exatamente assim).
const EVENTOS = {
  ciencia: ['210210', 'Ciencia da Operacao'], confirmacao: ['210200', 'Confirmacao da Operacao'],
  desconhecimento: ['210220', 'Desconhecimento da Operacao'], nao_realizada: ['210240', 'Operacao nao Realizada']
};
const xml = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function manifestacao({ ambiente, cnpj, chave, quando, tipo, justificativa }) {
  const e = EVENTOS[tipo];
  if (!e) throw new Error('manifestação desconhecida: ' + tipo);
  let detalhe = '<descEvento>' + e[1] + '</descEvento>';
  if (tipo === 'nao_realizada') {
    const j = String(justificativa || '').replace(/\s+/g, ' ').trim();
    if (j.length < 15) throw new Error('a justificativa da operação não realizada precisa de pelo menos 15 letras');
    detalhe += '<xJust>' + xml(j.slice(0, 255)) + '</xJust>';
  }
  return S.infEvento({ ambiente, cnpj, chave, tpEvento: e[0], seq: 1, quando, cOrgao: C_ORGAO_AN, detalhe });
}
const ciencia = args => manifestacao(Object.assign({}, args, { tipo: 'ciencia' }));

// ---------------------------------------------------------------- respostas
// retDistDFeInt → { cStat, xMotivo, ultNSU, maxNSU, docs: [{ nsu, schema, xml }] } (docZip = base64 de gzip)
function leDist(xmlResp) {
  const r = S.bloco(xmlResp, 'retDistDFeInt') || xmlResp || '';
  const docs = [], re = /<(?:\w+:)?docZip\b([^>]*)>([^<]*)<\/(?:\w+:)?docZip>/g;
  let m;
  while ((m = re.exec(r))) {
    const at = m[1], n = (/NSU="(\d+)"/.exec(at) || [])[1], sch = (/schema="([^"]+)"/.exec(at) || [])[1] || '';
    let xml = null;
    try { xml = zlib.gunzipSync(Buffer.from(m[2].trim(), 'base64')).toString('utf8'); } catch (e) { xml = null; }
    docs.push({ nsu: n ? Number(n) : null, schema: sch, xml });
  }
  const c = S.pega(r, 'cStat');
  return { cStat: c ? Number(c) : null, xMotivo: S.pega(r, 'xMotivo'), ultNSU: Number(S.pega(r, 'ultNSU') || 0), maxNSU: Number(S.pega(r, 'maxNSU') || 0), docs };
}

// Um documento da distribuição → o que interessa ao CRM.
//   nota (procNFe: XML completo) | resumo (resNFe) | evento (resEvento/procEventoNFe: 110111 = cancelada pelo fornecedor)
const SIT = { 1: 'autorizada', 2: 'denegada', 3: 'cancelada' };
function resumoDoc(d) {
  const x = (d && d.xml) || '', p = t => S.pega(x, t);
  const tipo = /^procNFe/.test(d.schema) || /<nfeProc\b/.test(x) ? 'nota' : /^resNFe/.test(d.schema) ? 'resumo' : /^(resEvento|procEventoNFe)/.test(d.schema) ? 'evento' : 'outro';
  const base = { nsu: d.nsu, schema: d.schema, tipo };
  if (tipo === 'resumo') {
    return Object.assign(base, { chave: p('chNFe'), emitente_doc: doc(p('CNPJ') || p('CPF')), emitente_nome: le(p('xNome')), emitida_em: p('dhEmi'),
      valor: Number(p('vNF') || 0), tp_nf: Number(p('tpNF') || 1), situacao: SIT[Number(p('cSitNFe'))] || 'autorizada', protocolo: p('nProt') });
  }
  if (tipo === 'nota') {
    const emit = S.bloco(x, 'emit') || '', tot = S.bloco(x, 'ICMSTot') || '', ide = S.bloco(x, 'ide') || '';
    const ch = (/Id="NFe(\d{44})"/.exec(x) || [])[1] || p('chNFe');
    return Object.assign(base, { chave: ch, emitente_doc: doc(S.pega(emit, 'CNPJ') || S.pega(emit, 'CPF')), emitente_nome: le(S.pega(emit, 'xNome')),
      emitida_em: S.pega(ide, 'dhEmi'), valor: Number(S.pega(tot, 'vNF') || 0), tp_nf: Number(S.pega(ide, 'tpNF') || 1), situacao: 'autorizada', protocolo: p('nProt'), xml: x });
  }
  if (tipo === 'evento') {
    const tp = p('tpEvento');
    return Object.assign(base, { chave: p('chNFe'), tp_evento: tp, cancelada: tp === '110111', emitente_doc: doc(p('CNPJ')), quando: p('dhEvento') });
  }
  return base;
}

// ---------------------------------------------------------------- operações
async function busca(cfg, { cnpj, ultNSU, chave }) {
  const corpo = envelopeDist(msgDist({ ambiente: cfg.ambiente, cnpj, ultNSU, chave }));
  const r = leDist(await S.posta(AN[cfg.ambiente === 'producao' ? 'producao' : 'homologacao'].dist, WSDL_DIST + '/nfeDistDFeInteresse', corpo, cfg, /retDistDFeInt/));
  return Object.assign(r, { docs: r.docs.map(resumoDoc) });
}
async function manifesta(cfg, { cnpj, chave, quando, tipo, justificativa }) {
  const inf = manifestacao({ ambiente: cfg.ambiente, cnpj, chave, quando, tipo, justificativa });
  const sig = A.assinaElemento(inf.infEvento, inf.id, cfg.certPem, cfg.keyPem);
  const xmlEv = S.montaEvento(inf.infEvento, sig);
  const r = S.leRetorno(await S.posta(AN[cfg.ambiente === 'producao' ? 'producao' : 'homologacao'].evento, WSDL_EV + '/nfeRecepcaoEvento',
    envelopeEv(S.envEvento(Date.now(), xmlEv)), cfg));
  // 135 = registrado; 573 = já havia esse evento para esta nota (duplicidade): os dois valem
  return { cStat: r.eventoStat, xMotivo: r.eventoMotivo || r.xMotivo, ok: r.eventoStat === 135 || r.eventoStat === 573, protocolo: r.protocolo };
}
const daCiencia = (cfg, a) => manifesta(cfg, Object.assign({}, a, { tipo: 'ciencia' }));

module.exports = { AN, EVENTOS, msgDist, ciencia, manifestacao, envelopeDist, envelopeEv, leDist, resumoDoc, busca, daCiencia, manifesta };
