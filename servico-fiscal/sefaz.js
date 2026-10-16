'use strict';
/* Comunicação com a Sefaz-SP (NF-e 4.00): status do serviço, autorização SÍNCRONA (indSinc=1), consulta pela chave,
   eventos (cancelamento 110111 e carta de correção 110110) e inutilização. SOAP 1.2 por HTTPS com o certificado A1 na
   própria conexão (TLS mútuo), como a NFS-e da Agilité; o certificado do SERVIDOR é sempre conferido
   (rejectUnauthorized) — se a cadeia da Sefaz não estiver no Node, a instalação acrescenta o arquivo da cadeia
   (FISCAL_CA), nunca desliga a conferência.
   Regra de ouro (evita nota em duplicidade e buraco na numeração): se a autorização não responder (queda, tempo), NÃO
   reenvia com outro número — consulta pela chave; só reenvia o MESMO XML se a Sefaz disser que a chave não existe. */

const https = require('https');
const { URL } = require('url');
const { NS, txt } = require('./nfe');
const A = require('./assinatura');

const BASE = { producao: 'https://nfe.fazenda.sp.gov.br/ws/', homologacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/' };
const SERV = {
  status: ['nfestatusservico4.asmx', 'NFeStatusServico4', 'nfeStatusServicoNF'],
  autorizacao: ['nfeautorizacao4.asmx', 'NFeAutorizacao4', 'nfeAutorizacaoLote'],
  consulta: ['nfeconsultaprotocolo4.asmx', 'NFeConsultaProtocolo4', 'nfeConsultaNF'],
  evento: ['nferecepcaoevento4.asmx', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'],
  inutilizacao: ['nfeinutilizacao4.asmx', 'NFeInutilizacao4', 'nfeInutilizacaoNF']
};
const CUF_SP = '35';
const tpAmb = amb => (amb === 'producao' ? '1' : '2');
const COND_USO_CCE = 'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.';

// ---------------------------------------------------------------- mensagens (puras; validadas no XSD nos testes)
const msgStatus = amb => '<consStatServ xmlns="' + NS + '" versao="4.00"><tpAmb>' + tpAmb(amb) + '</tpAmb><cUF>' + CUF_SP + '</cUF><xServ>STATUS</xServ></consStatServ>';
const msgConsulta = (amb, chave) => '<consSitNFe xmlns="' + NS + '" versao="4.00"><tpAmb>' + tpAmb(amb) + '</tpAmb><xServ>CONSULTAR</xServ><chNFe>' + chave + '</chNFe></consSitNFe>';

// Evento (sem a assinatura): devolve { infEvento, id } para assinar e o envelope envEvento.
function infEvento({ ambiente, cnpj, chave, tpEvento, seq, quando, detalhe }) {
  const n = Number(seq || 1);
  const id = 'ID' + tpEvento + chave + String(n).padStart(2, '0');
  const inf = '<infEvento Id="' + id + '"><cOrgao>' + CUF_SP + '</cOrgao><tpAmb>' + tpAmb(ambiente) + '</tpAmb><CNPJ>' + String(cnpj).replace(/[^0-9A-Z]/gi, '').toUpperCase() + '</CNPJ>' +
    '<chNFe>' + chave + '</chNFe><dhEvento>' + quando + '</dhEvento><tpEvento>' + tpEvento + '</tpEvento><nSeqEvento>' + n + '</nSeqEvento><verEvento>1.00</verEvento>' +
    '<detEvento versao="1.00">' + detalhe + '</detEvento></infEvento>';
  return { id, infEvento: inf };
}
function cancelamento({ ambiente, cnpj, chave, protocolo, justificativa, quando }) {
  const j = String(justificativa || '').trim();
  if (j.length < 15) throw new Error('a justificativa do cancelamento precisa de pelo menos 15 letras');
  return infEvento({ ambiente, cnpj, chave, tpEvento: '110111', seq: 1, quando, detalhe: '<descEvento>Cancelamento</descEvento><nProt>' + protocolo + '</nProt><xJust>' + txt(j).slice(0, 255) + '</xJust>' });
}
function cartaCorrecao({ ambiente, cnpj, chave, seq, correcao, quando }) {
  const c = String(correcao || '').trim();
  if (c.length < 15) throw new Error('a correção precisa de pelo menos 15 letras');
  return infEvento({ ambiente, cnpj, chave, tpEvento: '110110', seq, quando, detalhe: '<descEvento>Carta de Correcao</descEvento><xCorrecao>' + txt(c).slice(0, 1000) + '</xCorrecao><xCondUso>' + COND_USO_CCE + '</xCondUso>' });
}
const envEvento = (idLote, eventoAssinadoXml) => '<envEvento xmlns="' + NS + '" versao="1.00"><idLote>' + String(idLote).padStart(15, '0').slice(-15) + '</idLote>' + eventoAssinadoXml + '</envEvento>';
const evento = (infEventoXml, assinatura) => '<evento versao="1.00">' + infEventoXml + assinatura + '</evento>';

function infInut({ ambiente, cnpj, ano, serie, de, ate, justificativa }) {
  const j = String(justificativa || '').trim();
  if (j.length < 15) throw new Error('a justificativa da inutilização precisa de pelo menos 15 letras');
  if (!(Number(de) > 0) || Number(ate) < Number(de)) throw new Error('faixa de números inválida');
  const doc = String(cnpj).replace(/[^0-9A-Z]/gi, '').toUpperCase(), aa = String(ano).slice(-2);
  const id = 'ID' + CUF_SP + aa + doc + '55' + String(serie).padStart(3, '0') + String(de).padStart(9, '0') + String(ate).padStart(9, '0');
  return { id, infInut: '<infInut Id="' + id + '"><tpAmb>' + tpAmb(ambiente) + '</tpAmb><xServ>INUTILIZAR</xServ><cUF>' + CUF_SP + '</cUF><ano>' + aa + '</ano><CNPJ>' + doc + '</CNPJ>' +
    '<mod>55</mod><serie>' + Number(serie) + '</serie><nNFIni>' + Number(de) + '</nNFIni><nNFFin>' + Number(ate) + '</nNFFin><xJust>' + txt(j).slice(0, 255) + '</xJust></infInut>' };
}
const inutNFe = (infInutXml, assinatura) => '<inutNFe xmlns="' + NS + '" versao="4.00">' + infInutXml + assinatura + '</inutNFe>';

// ---------------------------------------------------------------- respostas
const pega = (xml, t) => { const m = new RegExp('<(?:\\w+:)?' + t + '\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?' + t + '>').exec(xml || ''); return m ? m[1] : null; };
const bloco = (xml, t) => { const m = new RegExp('<(?:\\w+:)?' + t + '\\b[\\s\\S]*?</(?:\\w+:)?' + t + '>').exec(xml || ''); return m ? m[0] : null; };
// O que a Sefaz respondeu, num formato só. situacao: autorizada (100/150), denegada (110/301/302/303), cancelada
// (101/151/155, ou evento 135/155), rejeitada (o resto) ou em_processamento (103/105).
function situacao(cStat) {
  const c = Number(cStat);
  if (c === 100 || c === 150) return 'autorizada';
  if ([110, 301, 302, 303].indexOf(c) !== -1) return 'denegada';
  if ([101, 151, 155].indexOf(c) !== -1) return 'cancelada';
  if (c === 103 || c === 105) return 'em_processamento';
  return 'rejeitada';
}
function leRetorno(xmlResp) {
  const corpo = pega(xmlResp, 'nfeResultMsg') || xmlResp;
  const prot = bloco(corpo, 'protNFe');
  const infProt = prot ? pega(prot, 'infProt') : null;
  const cStatLote = pega(corpo, 'cStat'), xMotivoLote = pega(corpo, 'xMotivo');
  const cStat = infProt ? pega(infProt, 'cStat') : cStatLote, xMotivo = infProt ? pega(infProt, 'xMotivo') : xMotivoLote;
  const ev = bloco(corpo, 'retEvento');
  return { cStat: cStat && Number(cStat), xMotivo, situacao: cStat ? situacao(cStat) : 'sem_resposta', cStatLote: cStatLote && Number(cStatLote), xMotivoLote,
    protocolo: infProt ? pega(infProt, 'nProt') : (ev ? pega(ev, 'nProt') : pega(corpo, 'nProt')), recebido: infProt ? pega(infProt, 'dhRecbto') : pega(corpo, 'dhRecbto'),
    chave: infProt ? pega(infProt, 'chNFe') : pega(corpo, 'chNFe'), protNFe: prot, retEvento: ev, eventoStat: ev ? Number(pega(ev, 'cStat')) : null,
    eventoMotivo: ev ? pega(ev, 'xMotivo') : null, tMed: pega(corpo, 'tMed'), bruto: corpo };
}

// ---------------------------------------------------------------- transporte (SOAP 1.2 + TLS mútuo)
function envelope(servico, xml) {
  const ns = 'http://www.portalfiscal.inf.br/nfe/wsdl/' + SERV[servico][1];
  return '<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
    'xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="' + ns + '">' + xml + '</nfeDadosMsg></soap12:Body></soap12:Envelope>';
}
// cfg: { ambiente, certPem, keyPem, ca (cadeia extra, opcional), tempo (ms) }
function chama(servico, xml, cfg) {
  const s = SERV[servico], url = new URL(BASE[cfg.ambiente === 'producao' ? 'producao' : 'homologacao'] + s[0]);
  const corpo = envelope(servico, xml);
  return new Promise((ok, falha) => {
    const req = https.request({ hostname: url.hostname, path: url.pathname, method: 'POST', cert: cfg.certPem, key: cfg.keyPem, ca: cfg.ca || undefined,
      rejectUnauthorized: true, timeout: cfg.tempo || 30000, minVersion: 'TLSv1.2',
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/' + s[1] + '/' + s[2] + '"', 'Content-Length': Buffer.byteLength(corpo) } }, res => {
      const partes = [];
      res.on('data', d => partes.push(d));
      res.on('end', () => {
        const t = Buffer.concat(partes).toString('utf8');
        if (res.statusCode >= 500 && !/nfeResultMsg/.test(t)) return falha(Object.assign(new Error('Sefaz respondeu HTTP ' + res.statusCode), { semResposta: true }));
        ok(t);
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('a Sefaz não respondeu a tempo'), { semResposta: true })));
    req.on('error', e => falha(Object.assign(e, { semResposta: true })));
    req.end(corpo);
  });
}

// ---------------------------------------------------------------- operações
async function status(cfg) { return leRetorno(await chama('status', msgStatus(cfg.ambiente), cfg)); }
async function consulta(cfg, chave) { return leRetorno(await chama('consulta', msgConsulta(cfg.ambiente, chave), cfg)); }

// Autoriza uma NF-e já assinada (nfeXml = <NFe>…</NFe>). Sem resposta: consulta a chave e devolve o que a Sefaz sabe.
async function autoriza(cfg, nfeXml, chave, idLote) {
  const { loteEnvio } = require('./nfe');
  try {
    const r = leRetorno(await chama('autorizacao', loteEnvio(nfeXml, idLote || Date.now()), cfg));
    if (r.cStat === 204 || r.cStat === 539) {           // duplicidade: a nota já foi autorizada antes — busca o protocolo
      const c = await consulta(cfg, chave);
      return Object.assign(c, { duplicidade: true });
    }
    return r;
  } catch (e) {
    if (!e.semResposta) throw e;
    const c = await consulta(cfg, chave).catch(() => null);
    if (c && c.cStat) return Object.assign(c, { aposFalha: e.message });
    throw Object.assign(new Error('sem resposta da Sefaz (' + e.message + '); a nota fica pendente: consulte pela chave antes de tentar de novo'), { pendente: true });
  }
}
async function evento_(cfg, inf, idLote) {
  const sig = A.assinaElemento(inf.infEvento, inf.id, cfg.certPem, cfg.keyPem);
  const xmlEv = evento(inf.infEvento, sig);
  return Object.assign(leRetorno(await chama('evento', envEvento(idLote || Date.now(), xmlEv), cfg)), { eventoXml: xmlEv });
}
async function inutiliza(cfg, dados) {
  const inf = infInut(Object.assign({ ambiente: cfg.ambiente }, dados));
  const sig = A.assinaElemento(inf.infInut, inf.id, cfg.certPem, cfg.keyPem);
  const xml = inutNFe(inf.infInut, sig), r = leRetorno(await chama('inutilizacao', xml, cfg));
  // o arquivo que vale (pedido + resposta) vai ao contador no fechamento do mês
  const ret = bloco(r.bruto, 'retInutNFe');
  return Object.assign(r, { procInut: ret && Number(r.cStat) === 102 ? '<?xml version="1.0" encoding="UTF-8"?><ProcInutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">' +
    xml.replace(/^<\?xml[^>]*>/, '') + ret.replace(/<(\/?)\w+:/g, '<$1') + '</ProcInutNFe>' : null });
}

module.exports = { BASE, SERV, msgStatus, msgConsulta, infEvento, cancelamento, cartaCorrecao, envEvento, montaEvento: evento, infInut, inutNFe, envelope, leRetorno, situacao,
  status, consulta, autoriza, enviaEvento: evento_, inutiliza, COND_USO_CCE };
