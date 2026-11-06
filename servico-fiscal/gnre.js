'use strict';
/* GNRE pelo webservice do Portal GNRE (06/11/2026, pedido do Anderson: "pode montar o robô da GNRE do DIFAL"). Venda a
   consumidor final não contribuinte de outra UF (hoje quase sempre o RS) deve o ICMS DIFAL da UF de destino por operação,
   pago antes da saída (EC 87/2015, LC 190/2022). O robô (Edge Function crm-gnre) manda aqui os dados da guia logo depois
   da NF-e autorizada; este módulo monta o lote, envia com o certificado A1 (TLS mútuo, o XML não é assinado) e devolve o
   recibo; depois consulta o resultado (linha digitável, código de barras, Pix e o PDF da guia). Pagar é sempre clique.
   Fontes: Manual de Integração do Contribuinte GNRE v2.01 e XSDs 2.00 (lote_gnre_v2.00, dados_gnre_v2.00,
   lote_gnre_result_v2.00), conferidos com as bibliotecas sped-gnre (nfephp), Unimake/DFe, ACBr e gnre-automacao.
   Pegadinhas do leiaute: sem prefixo de namespace e sem espaço/quebra entre as tags; município com 5 dígitos (sem a UF);
   a IE do emitente é a da UF favorecida (a OneClean não tem no RS: vai só o CNPJ com o endereço); dataPagamento >= hoje.
   O CNPJ do certificado precisa estar HABILITADO no Portal GNRE (Automação → Solicitar uso do WebService), senão 102. */

const S = require('./sefaz');

const BASE = { producao: 'https://www.gnre.pe.gov.br/gnreWS/services/', homologacao: 'https://www.testegnre.pe.gov.br/gnreWS/services/' };
const NS = 'http://www.gnre.pe.gov.br';
const WS = 'http://www.gnre.pe.gov.br/webservice/';
const RESPOSTA = /gnreRespostaMsg|processarResponse|consultarResponse/;

const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const limpa = (v, max) => String(v == null ? '' : v).normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max || 60).trim();
const dig = v => String(v == null ? '' : v).replace(/\D/g, '');
const tag = (t, v) => (v === undefined || v === null || v === '' ? '' : '<' + t + '>' + esc(v) + '</' + t + '>');
const valor2 = v => (Math.round(Number(v) * 100) / 100).toFixed(2);

function envelope(servico, xml, versaoDados) {
  const ns = WS + servico;
  return '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:gnr="' + ns + '"><soap:Header><gnr:gnreCabecMsg xmlns="' + ns + '">' +
    '<versaoDados>' + versaoDados + '</versaoDados></gnr:gnreCabecMsg></soap:Header><soap:Body><gnr:gnreDadosMsg xmlns="' + ns + '">' + xml +
    '</gnr:gnreDadosMsg></soap:Body></soap:Envelope>';
}
const amb = cfg => (cfg.ambiente === 'producao' ? 'producao' : 'homologacao');
// o Portal GNRE às vezes passa de 30 s (06/11/2026: duas consultas caíram no limite do serviço fiscal); espera até 55 s
const chama = (cfg, servico, xml, versao) => S.posta(BASE[amb(cfg)] + servico, WS + servico, envelope(servico, xml, versao), Object.assign({}, cfg, { tempo: 55000 }), RESPOSTA);

// ---------------------------------------------------------------- o lote
// emitente: { cnpj, razao, endereco: { logradouro, numero, cMun, uf, cep, fone } }
// guia: { uf, docTipo, chave, vencimento (AAAA-MM-DD), pagamento, referencia: { mes, ano } | null, destinatario: { cpf | cnpj, nome, cMun },
//         camposExtras: [{ codigo, valor }], identificador, convenio?, total? (manda também os valores "total" 21/22),
//         itens: [{ receita, valor, valorFcp? }] }   (sem "itens": um item só com receita, valor, valorFcp e fcpJunto da guia)
// 06/11/2026, depois do GnreConfigUF do RS: valorExigido "P" = só o valor PRINCIPAL (tipo 11; 12 para o FCP junto); os totais
// (21/22) só com "total"; o FCP do RS vai como 2º ITEM da mesma guia (receita 100129), um código de barras só.
const itensDa = g => (Array.isArray(g.itens) && g.itens.length ? g.itens
  : [{ receita: g.receita, valor: g.valor, valorFcp: g.fcpJunto ? g.valorFcp : 0 }]);
function item(g, it) {
  const d = g.destinatario || {};
  const docDest = dig(d.cnpj).length === 14 ? tag('CNPJ', dig(d.cnpj)) : dig(d.cpf).length === 11 ? tag('CPF', dig(d.cpf)) : '';
  const fcp = Number(it.valorFcp || 0);
  const valores = '<valor tipo="11">' + valor2(it.valor) + '</valor>' + (fcp > 0 ? '<valor tipo="12">' + valor2(fcp) + '</valor>' : '') +
    (g.total ? '<valor tipo="21">' + valor2(it.valor) + '</valor>' + (fcp > 0 ? '<valor tipo="22">' + valor2(fcp) + '</valor>' : '') : '');
  return '<item>' + tag('receita', it.receita) +
    (it.detalhamento ? tag('detalhamentoReceita', it.detalhamento) : '') +
    (g.docTipo ? '<documentoOrigem tipo="' + esc(g.docTipo) + '">' + esc(g.docTipo === '22' || g.docTipo === '24' ? dig(g.chave) : g.documento || dig(g.chave)) + '</documentoOrigem>' : '') +
    (it.produto ? tag('produto', it.produto) : '') +
    (g.referencia ? '<referencia><periodo>0</periodo>' + tag('mes', String(g.referencia.mes).padStart(2, '0')) + tag('ano', g.referencia.ano) + '</referencia>' : '') +
    tag('dataVencimento', g.vencimento) + valores + (g.convenio ? tag('convenio', limpa(g.convenio, 30)) : '') +
    (docDest || d.nome ? '<contribuinteDestinatario>' + (docDest ? '<identificacao>' + docDest + '</identificacao>' : '') + tag('razaoSocial', limpa(d.nome, 60)) +
      (dig(d.cMun).length === 7 ? tag('municipio', dig(d.cMun).slice(2)) : '') + '</contribuinteDestinatario>' : '') +
    ((g.camposExtras || []).length ? '<camposExtras>' + g.camposExtras.slice(0, 3).map(c => '<campoExtra>' + tag('codigo', c.codigo) + tag('valor', limpa(c.valor, 100)) + '</campoExtra>').join('') + '</camposExtras>' : '') +
    '</item>';
}
function dadosGnre(emitente, g) {
  const e = emitente || {}, en = e.endereco || {};
  if (dig(e.cnpj).length !== 14) throw Object.assign(new Error('falta o CNPJ do emitente'), { status: 400 });
  if (!g || !/^[A-Z]{2}$/.test(String(g.uf || ''))) throw Object.assign(new Error('falta a UF favorecida'), { status: 400 });
  const itens = itensDa(g);
  if (!itens.length || itens.length > 100 || itens.some(it => !/^\d{6}$/.test(String(it.receita || '')) || !(Number(it.valor) > 0))) throw Object.assign(new Error('valor da guia inválido'), { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(g.vencimento || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(g.pagamento || ''))) throw Object.assign(new Error('datas da guia inválidas'), { status: 400 });
  const total = itens.reduce((s, it) => s + Number(it.valor) + Number(it.valorFcp || 0), 0);
  // a IE do emitente é a da UF favorecida: a OneClean não tem inscrição lá, então vai o CNPJ com o endereço completo
  const emit = '<contribuinteEmitente><identificacao>' + (g.ieNaUf ? tag('IE', dig(g.ieNaUf)) : tag('CNPJ', dig(e.cnpj))) + '</identificacao>' +
    (g.ieNaUf ? '' : tag('razaoSocial', limpa(e.razao, 60)) + tag('endereco', limpa([en.logradouro, en.numero].filter(Boolean).join(', '), 60)) +
      (dig(en.cMun).length === 7 ? tag('municipio', dig(en.cMun).slice(2)) : '') + tag('uf', en.uf) + tag('cep', dig(en.cep)) + tag('telefone', dig(en.fone).slice(0, 11))) +
    '</contribuinteEmitente>';
  return '<TDadosGNRE versao="2.00">' + tag('ufFavorecida', g.uf) + '<tipoGnre>0</tipoGnre>' + emit + '<itensGNRE>' + itens.map(it => item(g, it)).join('') + '</itensGNRE>' +
    tag('valorGNRE', valor2(total)) + tag('dataPagamento', g.pagamento) + (g.identificador ? tag('identificadorGuia', g.identificador) : '') + '</TDadosGNRE>';
}
// o lote: uma ou mais guias (o robô manda uma por lote, para um erro não recusar as outras)
function montaLote(emitente, guias) {
  const l = Array.isArray(guias) ? guias : [guias];
  if (!l.length || l.length > 50) throw Object.assign(new Error('o lote leva de 1 a 50 guias'), { status: 400 });
  return '<TLote_GNRE xmlns="' + NS + '" versao="2.00"><guias>' + l.map(g => dadosGnre(emitente, g)).join('') + '</guias></TLote_GNRE>';
}

// ---------------------------------------------------------------- leitura das respostas
const todos = (xml, t) => (String(xml || '').match(new RegExp('<(?:\\w+:)?' + t + '\\b[\\s\\S]*?</(?:\\w+:)?' + t + '>', 'g')) || []);
const pega = S.pega;
function leRecepcao(xml) {
  const sit = S.bloco(xml, 'situacaoRecepcao') || '';
  const rec = S.bloco(xml, 'recibo') || '';
  return { codigo: Number(pega(sit, 'codigo')) || null, descricao: pega(sit, 'descricao') || null, recibo: pega(rec, 'numero') || null,
    tempo: Number(pega(rec, 'tempoEstimadoProc')) || null, bruto: String(xml || '').slice(0, 4000) };
}
function leResultado(xml) {
  const sit = S.bloco(xml, 'situacaoProcess') || S.bloco(xml, 'situacaoProcesso') || '';
  const guias = todos(xml, 'guia').filter(g => /situacaoGuia/.test(g)).map(g => ({
    situacao: pega(g, 'situacaoGuia'), identificador: pega(g, 'identificadorGuia'), uf: pega(g, 'ufFavorecida'),
    linhaDigitavel: dig(pega(g, 'linhaDigitavel')) || null, codigoBarras: dig(pega(g, 'codigoBarras')) || null,
    numeroControle: pega(g, 'numeroControle') || pega(g, 'nossoNumero') || null, dataLimite: pega(g, 'dataLimitePagamento') || null,
    pix: pega(g, 'qrcodePayload') || null, valor: Number(pega(g, 'valorGNRE')) || null,
    motivos: todos(g, 'motivo').map(m => ({ codigo: pega(m, 'codigo'), descricao: pega(m, 'descricao'), campo: pega(m, 'campo') }))
  }));
  const pdf = (pega(xml, 'pdfGuias') || '').replace(/\s/g, '') || null;
  return { codigo: Number(pega(sit, 'codigo')) || null, descricao: pega(sit, 'descricao') || null, guias, pdf, bruto: String(xml || '').replace(/<pdfGuias>[\s\S]*?<\/pdfGuias>/, '<pdfGuias/>').slice(0, 6000) };
}
function leConfigUF(xml) {
  const r = S.bloco(xml, 'TConfigUf') || xml;
  const sim = t => (pega(r, t) || '').trim();
  return { codigo: Number(pega(S.bloco(r, 'situacaoConsulta') || '', 'codigo')) || null, descricao: pega(S.bloco(r, 'situacaoConsulta') || '', 'descricao') || null,
    uf: sim('uf'), exigeUfFavorecida: sim('exigeUfFavorecida'), exigeReceita: sim('exigeReceita'),
    receitas: todos(r, 'receita').filter(x => /codigo=/.test(x) || /<codigo>/.test(x)).map(x => x.replace(/<pdfGuias>[\s\S]*$/, '').slice(0, 1500)),
    bruto: String(xml || '').slice(0, 8000) };
}

// ---------------------------------------------------------------- consultas
const msgResultado = (ambiente, recibo, pdf = true) => '<TConsLote_GNRE xmlns="' + NS + '"><ambiente>' + (ambiente === 'producao' ? 1 : 2) + '</ambiente><numeroRecibo>' + dig(recibo) + '</numeroRecibo>' +
  '<incluirPDFGuias>' + (pdf ? 'S' : 'N') + '</incluirPDFGuias><incluirArquivoPagamento>N</incluirArquivoPagamento></TConsLote_GNRE>';
const msgConfigUF = (ambiente, uf, receita) => '<TConsultaConfigUf xmlns="' + NS + '"><ambiente>' + (ambiente === 'producao' ? 1 : 2) + '</ambiente><uf>' + uf + '</uf>' +
  (receita ? '<receita courier="N">' + dig(receita) + '</receita>' : '') + '</TConsultaConfigUf>';

// ---------------------------------------------------------------- serviços
async function enviar(cfg, emitente, guias) {
  const lote = montaLote(emitente, guias);
  const r = leRecepcao(await chama(cfg, 'GnreLoteRecepcao', lote, '2.00'));
  return Object.assign(r, { lote });
}
async function resultado(cfg, recibo, pdf = true) {
  if (!/^\d{10}(\d{4})?(\d{6})?$/.test(String(recibo || ''))) throw Object.assign(new Error('número do recibo inválido'), { status: 400 });
  return leResultado(await chama(cfg, 'GnreResultadoLote', msgResultado(amb(cfg), recibo, pdf), '2.00'));
}
async function configUF(cfg, uf, receita) {
  if (!/^[A-Z]{2}$/.test(String(uf || ''))) throw Object.assign(new Error('UF inválida'), { status: 400 });
  return leConfigUF(await chama(cfg, 'GnreConfigUF', msgConfigUF(amb(cfg), uf, receita), '1.00'));
}

// a rota POST /gnre do servidor: { acao: 'enviar', emitente, guias } | { acao: 'resultado', recibo } | { acao: 'configuf', uf, receita }
function rota(cfg, b) {
  const a = String((b && b.acao) || '');
  if (a === 'enviar') return enviar(cfg, b.emitente, b.guias);
  if (a === 'resultado') return resultado(cfg, b.recibo, b.pdf !== false);
  if (a === 'configuf') return configUF(cfg, b.uf, b.receita);
  throw Object.assign(new Error('ação da GNRE desconhecida'), { status: 400 });
}

module.exports = { BASE, rota, envelope, msgResultado, msgConfigUF, montaLote, dadosGnre, leRecepcao, leResultado, leConfigUF, enviar, resultado, configUF };
