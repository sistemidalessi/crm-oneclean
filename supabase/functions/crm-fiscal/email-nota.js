// E-mail da nota fiscal ao cliente (04/11/2026, pedido do Anderson: "quando emite, precisa ir o XML junto com a DANFE para o
// e-mail de cadastro", com um campo próprio no cadastro do cliente para o e-mail da nota). Partes puras, sem Deno: a função
// (crm-fiscal) importa e os testes do Node (testes/email-nota.test.js) também.
// - destinatarios(empresa): o "E-mail para a nota fiscal" do cadastro (email_nfe); vazio, o e-mail da empresa. Aceita mais de
//   um, separados por ; , ou espaço; no máximo 5, sem repetir;
// - assunto / texto / html: a mensagem (número, emissão, valor, chave), em nome da empresa, com a resposta para o(a) vendedor(a);
// - arquivos(nfe): os nomes do XML (o padrão da Sefaz, chave-procNFe.xml) e do PDF da DANFE;
// - proporcaoPng(bytes): largura ÷ altura de um PNG (o logo da DANFE), lida do cabeçalho IHDR.
const EMAIL = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;

export function separaEmails(texto) {
  const l = [];
  String(texto || '').split(/[;,\s]+/).forEach(x => { const e = x.trim().toLowerCase(); if (EMAIL.test(e) && l.indexOf(e) === -1) l.push(e); });
  return l;
}
export function destinatarios(empresa) {
  const e = empresa || {};
  const nfe = separaEmails(e.email_nfe);
  if (nfe.length) return { emails: nfe.slice(0, 5), de: 'email_nfe' };
  const cad = separaEmails(e.email);
  return { emails: cad.slice(0, 5), de: cad.length ? 'email' : null };
}
const moeda = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = iso => { const d = new Date(new Date(iso).getTime() - 3 * 36e5); return isNaN(d) ? '' : d.toISOString().slice(0, 10).split('-').reverse().join('/'); };
const milhar = n => String(n || '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const chaveFmt = c => String(c || '').replace(/(.{4})/g, '$1 ').trim();
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function assunto(nfe, empresa) {
  return empresa + ' · Nota fiscal nº ' + milhar(nfe.numero) + (nfe.serie ? ' (série ' + nfe.serie + ')' : '');
}
export function texto(nfe, o) {
  o = o || {};
  const linhas = [
    'Olá' + (o.cliente ? ', ' + o.cliente : '') + '!',
    'Segue a nota fiscal eletrônica nº ' + milhar(nfe.numero) + (nfe.serie ? ', série ' + nfe.serie : '') + ', emitida pela ' + o.empresa +
      (nfe.autorizada_em ? ' em ' + dataBR(nfe.autorizada_em) : '') + (nfe.valor != null ? ', no valor de ' + moeda(nfe.valor) : '') + '.',
    'Em anexo vão o XML (o arquivo que vale para a sua contabilidade) e a DANFE em PDF.',
    // 05/11/2026 (Anderson: "o boleto vai junto com a entrega, mas às vezes demora a chegar na mão da pessoa"): o boleto do BB,
    // já registrado, vai no mesmo e-mail
    ...textoBoletos(o.boletos),
    'Chave de acesso: ' + chaveFmt(nfe.chave) + '\nConsulta na Sefaz: https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx',
    'Qualquer dúvida, é só responder este e-mail' + (o.vendedor ? ' (vai para ' + o.vendedor + ')' : '') + '.',
    'Obrigado pela preferência!\n' + o.empresa
  ];
  return linhas.join('\n\n');
}
// o parágrafo dos boletos (o.boletos = [{ vencimento: 'aaaa-mm-dd', valor }]); sem boleto, nada
const dataIso = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');
export function textoBoletos(l) {
  const b = (l || []).filter(x => x && x.vencimento);
  if (!b.length) return [];
  const um = b.length === 1;
  return [(um ? 'Também vai o boleto do Banco do Brasil, já registrado no banco: vencimento ' + dataIso(b[0].vencimento) + ', ' + moeda(b[0].valor) + '.'
    : 'Também vão os ' + b.length + ' boletos do Banco do Brasil, já registrados no banco: ' + b.map(x => dataIso(x.vencimento) + ' (' + moeda(x.valor) + ')').join(', ') + '.') +
    ' Pode pagar pelo código de barras ou pelo Pix do QR Code impresso no boleto.' +
    '\nAtenção: confira sempre se o beneficiário é ' + 'a empresa que emitiu a nota antes de pagar; na dúvida, fale com a gente.'];
}
export function html(nfe, o) {
  return '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:600px">' +
    texto(nfe, o).split('\n\n').map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('') + '</div>';
}
// ---- várias notas do mesmo cliente num e-mail só (10/11/2026, Anderson: "quando emite a Uniserv, é de uma vez só quase 70
// notas"). O e-mail sai pela caixa da empresa, que tem limite por hora: as notas pendentes do mesmo cliente vão juntas, com o
// XML de cada uma; até `maxPdf` notas, vai também um PDF com as DANFEs e os boletos; acima disso só os XML (as DANFEs seguem
// com a mercadoria e o cliente pede o PDF respondendo o e-mail).
const faixa = notas => {
  const ns = notas.map(n => Number(n.numero)).sort((a, b) => a - b);
  const seguidas = ns.every((n, i) => i === 0 || n === ns[i - 1] + 1);
  return seguidas || ns.length > 6 ? milhar(ns[0]) + ' a ' + milhar(ns[ns.length - 1]) : ns.map(milhar).join(', ');
};
export function assuntoGrupo(notas, empresa) {
  return empresa + ' · ' + notas.length + ' notas fiscais (nº ' + faixa(notas) + ')';
}
export function textoGrupo(notas, o) {
  o = o || {};
  const total = notas.reduce((s, n) => s + Number(n.valor || 0), 0);
  const lista = notas.slice().sort((a, b) => Number(a.numero) - Number(b.numero))
    .map(n => '• NF ' + milhar(n.numero) + (n.autorizada_em ? ', de ' + dataBR(n.autorizada_em) : '') + (n.valor != null ? ': ' + moeda(n.valor) : '')).join('\n');
  const temBoleto = (o.boletos || []).length > 0;
  const linhas = [
    'Olá' + (o.cliente ? ', ' + o.cliente : '') + '!',
    'Seguem as ' + notas.length + ' notas fiscais eletrônicas emitidas pela ' + o.empresa + ', no total de ' + moeda(total) + ':\n' + lista,
    o.comPdf ? 'Em anexo vão o XML de cada nota (o arquivo que vale para a sua contabilidade) e um PDF com as DANFEs' + (temBoleto ? ' e os boletos' : '') + '.'
      : 'Em anexo vai o XML de cada nota (o arquivo que vale para a sua contabilidade). As DANFEs seguem com a mercadoria; se precisar delas em PDF, é só responder este e-mail.',
    ...textoBoletos(o.boletos),
    'Qualquer dúvida, é só responder este e-mail' + (o.vendedor ? ' (vai para ' + o.vendedor + ')' : '') + '.',
    'Obrigado pela preferência!\n' + o.empresa
  ];
  return linhas.join('\n\n');
}
export function htmlGrupo(notas, o) {
  return '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:600px">' +
    textoGrupo(notas, o).split('\n\n').map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('') + '</div>';
}
export function arquivoGrupo(notas, empresa, comBoleto) {
  const ns = notas.map(n => Number(n.numero)).sort((a, b) => a - b);
  return ((comBoleto ? 'DANFE e boleto ' : 'DANFE ') + empresa + ' NF ' + ns[0] + ' a ' + ns[ns.length - 1]).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + '.pdf';
}
// Quais e-mails saem nesta rodada do agendador. pend = notas de produção autorizadas ainda sem e-mail
// ({ id, numero, empresa_id, autorizada_em }); agora em ms. Regras:
// - as notas do mesmo cliente vão juntas; nota sem cliente vai sozinha;
// - o cliente só entra quando a nota mais nova dele tem pelo menos `quietoMin` minutos (o lote acabou de sair);
// - cada rodada desenha no máximo `orcamento` DANFEs (o limite de processamento da função): grupo de até `maxPdf` notas
//   leva o PDF e gasta uma por nota; grupo maior vai só com os XML e gasta uma;
// - primeiro o cliente que espera há mais tempo.
export function gruposDeEnvio(pend, agora, op) {
  const o = Object.assign({ quietoMin: 3, maxPdf: 6, orcamento: 6 }, op || {});
  const por = new Map();
  (pend || []).forEach(n => { const k = n.empresa_id ? String(n.empresa_id) : 'nota:' + n.id; if (!por.has(k)) por.set(k, []); por.get(k).push(n); });
  const t = n => Date.parse(String(n.autorizada_em || '')) || 0;
  const grupos = [...por.values()].map(notas => ({ notas: notas.slice().sort((a, b) => Number(a.numero) - Number(b.numero)),
    antiga: Math.min(...notas.map(t)), nova: Math.max(...notas.map(t)) }))
    .filter(g => agora - g.nova >= o.quietoMin * 60000)
    .sort((a, b) => a.antiga - b.antiga);
  const sai = [];
  let resta = o.orcamento;
  for (const g of grupos) {
    const comPdf = g.notas.length <= o.maxPdf, custo = comPdf ? g.notas.length : 1;
    if (custo > resta) { if (!sai.length && comPdf) { sai.push({ notas: g.notas, comPdf }); } break; }
    sai.push({ notas: g.notas, comPdf });
    resta -= custo;
    if (resta <= 0) break;
  }
  return sai;
}
export function arquivos(nfe, empresa) {
  const base = (empresa + ' NF ' + nfe.numero).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { xml: String(nfe.chave) + '-procNFe.xml', pdf: 'DANFE ' + base + '.pdf', boleto: 'Boleto ' + base + '.pdf' };
}
export function proporcaoPng(u8) {
  if (!u8 || u8.length < 24 || u8[1] !== 0x50 || u8[2] !== 0x4e || u8[3] !== 0x47) return 0;
  const n = i => ((u8[i] << 24) >>> 0) + (u8[i + 1] << 16) + (u8[i + 2] << 8) + u8[i + 3];
  const w = n(16), h = n(20);
  return w && h ? w / h : 0;
}
