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
