// Fechamento do mês para a contabilidade (05/11/2026, pedido do Anderson: "todos os XMLs de venda e a relação de notas
// fiscais que foram canceladas ou denegadas… virou o mês, esse relatório já vai automático para a contabilidade").
// Partes puras (sem Deno): a Edge Function crm-contador importa e os testes do Node (testes/contador.test.js) também.
//
// A fonte dos XML é o bucket crm-notas-xml (nfe/<chave>.xml): lá estão as notas do FKN (subidas pela pasta do UniNFe e pelo
// vigia) e as do CRM. O mês sai da própria chave (AAMM da emissão), então entram também as notas que a OneClean emitiu e que
// não são venda (devolução, remessa), que a lista de notas do CRM não mostra. A situação vem do CRM: crm_nfe (as notas do CRM,
// com o XML do cancelamento) e crm_notas.cancelada (as do FKN).

const dig = v => String(v == null ? '' : v).replace(/\D/g, '');
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;

// chave de 44 dígitos → partes
export function chaveInfo(chave) {
  const s = dig(chave);
  if (s.length !== 44) return null;
  return { uf: s.slice(0, 2), aamm: s.slice(2, 6), cnpj: s.slice(6, 20), modelo: s.slice(20, 22), serie: Number(s.slice(22, 25)), numero: Number(s.slice(25, 34)) };
}
// '2026-10' → '2610'
export const aammDe = mes => String(mes).slice(2, 4) + String(mes).slice(5, 7);
export function mesAnterior(hoje) {
  const [a, m] = String(hoje).slice(0, 7).split('-').map(Number);
  return m === 1 ? (a - 1) + '-12' : a + '-' + String(m - 1).padStart(2, '0');
}
export const mesExtenso = mes => ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(String(mes).slice(5, 7)) - 1] + '/' + String(mes).slice(0, 4);

// as chaves NF-e (modelo 55) do emitente no mês, em ordem de série e número
export function doMes(chaves, cnpj, mes) {
  const c = dig(cnpj), aamm = aammDe(mes);
  return [...new Set((chaves || []).map(dig))].filter(k => { const i = chaveInfo(k); return i && i.cnpj === c && i.aamm === aamm && i.modelo === '55'; })
    .sort((a, b) => { const x = chaveInfo(a), y = chaveInfo(b); return x.serie - y.serie || x.numero - y.numero; });
}

const tag = (xml, nome) => { const m = new RegExp('<' + nome + '>([^<]*)</' + nome + '>').exec(String(xml || '')); return m ? m[1].trim() : ''; };
const bloco = (xml, nome) => { const m = new RegExp('<' + nome + '[\\s>][\\s\\S]*?</' + nome + '>').exec(String(xml || '')); return m ? m[0] : ''; };
const desfaz = s => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
// o que a relação precisa do XML: data, natureza, entrada/saída, destinatário e valor
export function lerXml(xml) {
  const dest = bloco(xml, 'dest');
  return { emitida: tag(xml, 'dhEmi').slice(0, 10), natureza: desfaz(tag(xml, 'natOp')), tpNF: tag(xml, 'tpNF'), valor: r2(tag(bloco(xml, 'ICMSTot'), 'vNF')),
    dest: desfaz(tag(dest, 'xNome')), destDoc: tag(dest, 'CNPJ') || tag(dest, 'CPF'), protocolo: tag(bloco(xml, 'infProt'), 'nProt') };
}
const br = d => (d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : '');
const diaSP = iso => (iso ? new Date(new Date(iso).getTime() - 3 * 36e5).toISOString().slice(0, 10) : '');
const mesSP = iso => diaSP(iso).slice(0, 7);
// célula do CSV: texto que começa com = + - @ ganha apóstrofo (não vira fórmula no Excel do contador)
const cel = v => { let s = String(v == null ? '' : v); if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s) && !/^-?[\d.,]+$/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = linhas => '﻿' + linhas.map(l => l.map(cel).join(';')).join('\r\n') + '\r\n';
const moedaCsv = v => r2(v).toFixed(2).replace('.', ',');
export function moeda(v) {
  const [i, d] = Math.abs(Number(v) || 0).toFixed(2).split('.');
  return (v < 0 ? '-' : '') + 'R$ ' + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
}

// xmls: [{ chave, xml }] · nfes: linhas de crm_nfe (chave, situacao, eventos, protocolo, motivo) · notas: linhas de crm_notas
// (chave, cancelada) · inuts: crm_nfe_inutilizacoes · faltando: chaves do mês sem XML no bucket (não acontece: a lista vem dele)
export function montar({ mes, xmls, nfes, notas, inuts }) {
  const porChave = new Map((nfes || []).map(n => [dig(n.chave), n]));
  const fkn = new Map((notas || []).map(n => [dig(n.chave), n]));
  const arquivos = [], lista = [['Série', 'Número', 'Emissão', 'Tipo', 'Natureza da operação', 'Destinatário', 'CNPJ/CPF', 'Valor', 'Situação', 'Chave']];
  const rel = [['Tipo', 'Série', 'Número', 'Chave', 'Data', 'Protocolo', 'Justificativa']];
  const r = { notas: 0, autorizadas: 0, canceladas: 0, denegadas: 0, inutilizadas: 0, valor: 0, entradas: 0, sem_xml: [], canceladas_lista: [], denegadas_lista: [] };
  const vistos = new Map();   // série → números
  const ordenados = (xmls || []).slice().sort((a, b) => { const x = chaveInfo(a.chave), y = chaveInfo(b.chave); return x.serie - y.serie || x.numero - y.numero; });
  for (const { chave, xml } of ordenados) {
    const k = dig(chave), i = chaveInfo(k), d = lerXml(xml), n = porChave.get(k), f = fkn.get(k);
    if (!vistos.has(i.serie)) vistos.set(i.serie, new Set());
    vistos.get(i.serie).add(i.numero);
    const sit = n ? (n.situacao === 'cancelada' ? 'cancelada' : n.situacao === 'denegada' ? 'denegada' : 'autorizada') : f && f.cancelada ? 'cancelada' : 'autorizada';
    arquivos.push({ nome: 'NFe' + k + '-procNFe.xml', conteudo: xml });
    if (n) (n.eventos || []).filter(e => e && e.xml && e.protocolo).forEach(e => arquivos.push({ nome: 'NFe' + k + (e.tipo === 'cancelar' ? '-procEventoCanc.xml' : '-procEventoCCe' + (e.seq || 1) + '.xml'), conteudo: e.xml }));
    r.notas++;
    if (d.tpNF === '0') r.entradas++;
    if (sit === 'autorizada') { r.autorizadas++; if (d.tpNF !== '0') r.valor = r2(r.valor + d.valor); }
    if (sit === 'cancelada') {
      r.canceladas++;
      const ev = n && (n.eventos || []).find(e => e && e.tipo === 'cancelar' && e.protocolo);
      rel.push(['CANCELADA', i.serie, i.numero, k, br(ev ? diaSP(ev.quando) : d.emitida), ev ? ev.protocolo : '', ev ? ev.texto || '' : (n ? '' : 'cancelada no FKN')]);
      r.canceladas_lista.push({ serie: i.serie, numero: i.numero, dest: d.dest, valor: d.valor });
    }
    if (sit === 'denegada') {
      r.denegadas++;
      rel.push(['DENEGADA', i.serie, i.numero, k, br(d.emitida), n.protocolo || d.protocolo || '', n.motivo || '']);
      r.denegadas_lista.push({ serie: i.serie, numero: i.numero, dest: d.dest, valor: d.valor });
    }
    lista.push([i.serie, i.numero, br(d.emitida), d.tpNF === '0' ? 'entrada' : 'saída', d.natureza, d.dest, d.destDoc, moedaCsv(d.valor), sit, k]);
  }
  const ins = (inuts || []).filter(x => x.ambiente === 'producao' && Number(x.cstat) === 102 && mesSP(x.criado_em) === mes);
  for (const x of ins) {
    if (x.xml) arquivos.push({ nome: 'Inut-serie' + x.serie + '-' + x.de + (x.ate !== x.de ? '-a-' + x.ate : '') + '-procInutNFe.xml', conteudo: x.xml });
    rel.push(['INUTILIZADA', x.serie, x.de === x.ate ? x.de : x.de + ' a ' + x.ate, '', br(diaSP(x.criado_em)), x.protocolo || '', x.justificativa || '']);
    for (let k = Number(x.de); k <= Number(x.ate); k++) { if (!vistos.has(Number(x.serie))) vistos.set(Number(x.serie), new Set()); vistos.get(Number(x.serie)).add(k); }
    r.inutilizadas++;
  }
  // números pulados entre a primeira e a última nota do mês (cada série): sem XML no CRM, nem inutilização
  for (const [s, nums] of vistos) {
    const l = [...nums].sort((a, b) => a - b);
    for (let k = l[0] + 1; k < l[l.length - 1]; k++) if (!nums.has(k)) {
      r.sem_xml.push({ serie: s, numero: k });
      rel.push(['SEM XML NO CRM', s, k, '', '', '', 'conferir no sistema emissor: nota sem o XML guardado ou número inutilizado']);
    }
  }
  arquivos.push({ nome: 'notas-' + mes + '.csv', conteudo: csv(lista) });
  arquivos.push({ nome: 'relacao-canceladas-denegadas-inutilizadas-' + mes + '.csv', conteudo: csv(rel) });
  return Object.assign(r, { arquivos });
}

// o texto do e-mail (e do resumo na tela)
export function textoEmail(r, { mes, empresa, link }) {
  const nl = l => l.map(x => 'NF ' + x.serie + '-' + x.numero + (x.dest ? ' (' + x.dest + ', ' + moeda(x.valor) + ')' : '')).join('; ');
  return ['Olá!', '',
    'Seguem os XML das notas fiscais eletrônicas emitidas pela ' + empresa + ' em ' + mesExtenso(mes) + ', no arquivo ZIP anexo.', '',
    '• ' + r.notas + ' nota(s) no mês: ' + r.autorizadas + ' autorizada(s) (' + moeda(r.valor) + ' em notas de saída)' + (r.entradas ? ', ' + r.entradas + ' de entrada (devolução)' : '') + '.',
    '• Canceladas: ' + (r.canceladas ? r.canceladas + ' — ' + nl(r.canceladas_lista) : 'nenhuma') + '.',
    '• Denegadas: ' + (r.denegadas ? r.denegadas + ' — ' + nl(r.denegadas_lista) : 'nenhuma') + '.',
    '• Inutilizações: ' + (r.inutilizadas || 'nenhuma') + '.',
    r.sem_xml.length ? '• Números sem XML no nosso sistema (vamos conferir e mandar em seguida): ' + r.sem_xml.map(x => x.serie + '-' + x.numero).join(', ') + '.' : '',
    '',
    'No ZIP também vão a lista de todas as notas do mês e a relação das canceladas, denegadas e inutilizadas (planilhas CSV).',
    link ? 'Se o anexo não abrir, o mesmo arquivo pode ser baixado por 30 dias em: ' + link : '',
    '', 'Qualquer dúvida, é só responder este e-mail.', '', empresa].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
}
