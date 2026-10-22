'use strict';
/* Notas que não são venda (Fase 4b, 22/10/2026, virada para só o CRM): devolução a fornecedor, devolução de cliente
   (nota de entrada), bonificação e entrega futura. As devoluções partem do XML da nota original (a de compra ou a de venda):
   o item, o valor unitário e os impostos saem dela, na proporção da quantidade devolvida, e a nota original vai referenciada
   (NFref). Puro e testado (testes/nfe-outras.test.js); as regras de cada operação estão anotadas com a fonte em
   docs/fase4b-regras.md. */

const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const r4 = v => Math.round((Number(v) + Number.EPSILON) * 10000) / 10000;
const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
const dig = v => String(v == null ? '' : v).replace(/\D/g, '');

// ---------------------------------------------------------------- leitura do XML (nfeProc ou NFe)
const pega = (xml, t) => { const m = new RegExp('<(?:\\w+:)?' + t + '\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?' + t + '>').exec(xml || ''); return m ? m[1] : null; };
const todos = (xml, t) => { const re = new RegExp('<(?:\\w+:)?' + t + '\\b([^>]*)>([\\s\\S]*?)</(?:\\w+:)?' + t + '>', 'g'), out = []; let m; while ((m = re.exec(xml || ''))) out.push({ attrs: m[1], corpo: m[2] }); return out; };
const desc = v => (v == null ? null : String(v).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim());
const n = (x, t) => { const v = pega(x, t); return v == null ? null : Number(v); };

function pessoa(x, endTag) {
  if (!x) return null;
  const e = pega(x, endTag) || '';
  return { doc: dig(pega(x, 'CNPJ') || pega(x, 'CPF')) || String(pega(x, 'CNPJ') || '').toUpperCase(), nome: desc(pega(x, 'xNome')), ie: dig(pega(x, 'IE')) || null,
    indIEDest: pega(x, 'indIEDest'), email: desc(pega(x, 'email')),
    endereco: { logradouro: desc(pega(e, 'xLgr')), numero: desc(pega(e, 'nro')), complemento: desc(pega(e, 'xCpl')), bairro: desc(pega(e, 'xBairro')),
      cMun: pega(e, 'cMun'), municipio: desc(pega(e, 'xMun')), uf: pega(e, 'UF'), cep: pega(e, 'CEP'), fone: pega(e, 'fone') } };
}
function leNota(xml) {
  const inf = pega(xml, 'infNFe');
  if (!inf) throw new Error('não é o XML de uma NF-e');
  const idm = /<(?:\w+:)?infNFe\b[^>]*Id="NFe(\d{44})"/.exec(xml);
  const ide = pega(inf, 'ide') || '';
  const itens = todos(inf, 'det').map(d => {
    const nItem = Number((/nItem="(\d+)"/.exec(d.attrs) || [])[1]);
    const p = pega(d.corpo, 'prod') || '', imp = pega(d.corpo, 'imposto') || '', ic = pega(imp, 'ICMS') || '';
    const ipi = pega(imp, 'IPI') || '', pis = pega(imp, 'PIS') || '', cof = pega(imp, 'COFINS') || '';
    return { nItem, codigo: desc(pega(p, 'cProd')), gtin: pega(p, 'cEAN'), descricao: desc(pega(p, 'xProd')), ncm: pega(p, 'NCM'), cest: pega(p, 'CEST'), cfop: pega(p, 'CFOP'),
      unidade: desc(pega(p, 'uCom')), quantidade: n(p, 'qCom'), vUnCom: n(p, 'vUnCom'), vProd: n(p, 'vProd'), vDesc: num(n(p, 'vDesc')), vFrete: num(n(p, 'vFrete')),
      vOutro: num(n(p, 'vOutro')), xPed: desc(pega(p, 'xPed')),
      icms: { orig: pega(ic, 'orig'), cst: pega(ic, 'CST') || pega(ic, 'CSOSN'), vBC: num(n(ic, 'vBC')), pICMS: num(n(ic, 'pICMS')), vICMS: num(n(ic, 'vICMS')),
        modBCST: pega(ic, 'modBCST'), pMVAST: n(ic, 'pMVAST'), vBCST: num(n(ic, 'vBCST')), pICMSST: num(n(ic, 'pICMSST')), vICMSST: num(n(ic, 'vICMSST')),
        vBCSTRet: n(ic, 'vBCSTRet'), pST: n(ic, 'pST'), vICMSSubstituto: n(ic, 'vICMSSubstituto'), vICMSSTRet: n(ic, 'vICMSSTRet') },
      ipi: { cst: pega(ipi, 'CST'), vIPI: num(n(ipi, 'vIPI')) },
      pis: { cst: pega(pis, 'CST'), p: num(n(pis, 'pPIS')), v: num(n(pis, 'vPIS')) }, cofins: { cst: pega(cof, 'CST'), p: num(n(cof, 'pCOFINS')), v: num(n(cof, 'vCOFINS')) } };
  });
  const tot = pega(inf, 'ICMSTot') || '';
  return { chave: idm ? idm[1] : null, numero: Number(pega(ide, 'nNF')), serie: Number(pega(ide, 'serie')), emissao: pega(ide, 'dhEmi'), tpNF: pega(ide, 'tpNF'),
    finNFe: pega(ide, 'finNFe'), natOp: desc(pega(ide, 'natOp')), emit: pessoa(pega(inf, 'emit'), 'enderEmit'), dest: pessoa(pega(inf, 'dest'), 'enderDest'), itens,
    totais: { vProd: num(n(tot, 'vProd')), vNF: num(n(tot, 'vNF')), vST: num(n(tot, 'vST')), vIPI: num(n(tot, 'vIPI')), vFrete: num(n(tot, 'vFrete')) },
    protocolo: pega(xml, 'nProt') };
}

// ---------------------------------------------------------------- CFOP de devolução
// Devolução a fornecedor (saída): a compra para revenda volta como 5202/6202; com ST (compra 5401/5403/5405, 6401/6403/6404)
// como 5411/6411. Devolução de cliente (entrada): a venda 5102/6102/5117 volta como 1202/2202; com ST (5405/5403/6404/6403)
// como 1411/2411. Fora do estado: 6xxx/2xxx. (Tabela CFOP, Ajuste SINIEF 07/2001, Convênio s/nº de 1970.)
function cfopDevolucao(cfopOrig, tipo) {
  const c = dig(cfopOrig), fora = c[0] === '6' || c[0] === '2';
  const st = /^[56]40[1-5]$/.test(c);
  if (tipo === 'devolucao_fornecedor') return (fora ? '6' : '5') + (st ? '411' : '202');
  return (fora ? '2' : '1') + (st ? '411' : '202');
}
const prop = (v, f) => r2(num(v) * f);

// Devolução (a fornecedor ou de cliente) a partir do XML da nota original.
// o: { tipo, xml, itens: [{ nItem, quantidade }], emitente, ambiente, serie, numero, emissao, motivo, codigos?: {nItem → código nosso} }
// O valor unitário, o desconto, o frete e os impostos de cada item saem da nota original na proporção da quantidade.
function notaDevolucao(o) {
  const tipo = o.tipo, orig = leNota(o.xml), bloqueia = [], conferir = [];
  if (tipo !== 'devolucao_fornecedor' && tipo !== 'devolucao_cliente') throw new Error('tipo de devolução desconhecido');
  if (!orig.chave) bloqueia.push('o XML da nota original não tem a chave de acesso');
  const doc = dig((o.emitente || {}).cnpj);
  // a nota de compra foi emitida PARA a empresa; a de venda, PELA empresa
  if (tipo === 'devolucao_fornecedor' && dig((orig.dest || {}).doc) !== doc) bloqueia.push('esta nota de compra não foi emitida para a empresa');
  if (tipo === 'devolucao_cliente' && dig((orig.emit || {}).doc) !== doc) bloqueia.push('esta nota de venda não foi emitida pela empresa');
  const outra = tipo === 'devolucao_fornecedor' ? orig.emit : orig.dest;   // quem recebe a devolução (fornecedor) ou quem devolve (cliente)
  let freteTot = 0;
  const itens = (o.itens || []).filter(x => num(x.quantidade) > 0).map(x => {
    const it = orig.itens.find(i => i.nItem === Number(x.nItem));
    if (!it) { bloqueia.push('item ' + x.nItem + ' não existe na nota original'); return null; }
    const q = num(x.quantidade);
    if (q > num(it.quantidade) + 1e-9) { bloqueia.push('item ' + x.nItem + ' (' + it.descricao + '): devolvendo ' + q + ', a nota tem ' + it.quantidade); return null; }
    const f = q / num(it.quantidade), ic = it.icms;
    const cst = String(ic.cst || '');
    let icms;
    if (num(ic.vICMSST) > 0) icms = { cst: '10', aliquota: ic.pICMS, vBC: prop(ic.vBC, f), st: { modBCST: ic.modBCST == null ? 4 : Number(ic.modBCST), pMVAST: ic.pMVAST, pICMSST: ic.pICMSST, vBCST: prop(ic.vBCST, f), vICMSST: prop(ic.vICMSST, f) } };
    else if (num(ic.vICMS) > 0) icms = { cst: '00', aliquota: ic.pICMS, vBC: prop(ic.vBC, f) };
    else if (cst === '60' || cst === '500') icms = { cst: '60', stRet: ic.vICMSSTRet != null ? { vBCSTRet: prop(ic.vBCSTRet, f), pST: ic.pST, vICMSSubstituto: ic.vICMSSubstituto == null ? null : prop(ic.vICMSSubstituto, f), vICMSSTRet: prop(ic.vICMSSTRet, f) } : null };
    else icms = { cst: '90' };
    if (icms.cst === '00' && Math.abs(prop(ic.vBC, f) - r2(q * num(it.vUnCom) - prop(it.vDesc, f) + prop(it.vFrete, f))) > 0.05) conferir.push('item ' + x.nItem + ': a base do ICMS da nota original não é o valor do item (redução ou outras despesas); vai a mesma proporção');
    freteTot += prop(it.vFrete, f);
    return { codigo: (o.codigos && o.codigos[x.nItem]) || it.codigo, descricao: it.descricao, ncm: it.ncm, cest: it.cest, gtin: it.gtin, origem: ic.orig == null ? 0 : Number(ic.orig),
      cfop: cfopDevolucao(it.cfop, tipo), unidade: it.unidade, quantidade: q, valorUnitario: r4(it.vUnCom), desconto: prop(it.vDesc, f), icms,
      ipiDevol: tipo === 'devolucao_fornecedor' ? prop(it.ipi.vIPI, f) : 0,
      pis: { cst: tipo === 'devolucao_fornecedor' ? '49' : '98' }, cofins: { cst: tipo === 'devolucao_fornecedor' ? '49' : '98' },
      infAdProd: 'Devolucao de ' + q + ' ' + (it.unidade || '') + ' do item ' + x.nItem + ' da NF ' + orig.numero };
  }).filter(Boolean);
  if (!itens.length && !bloqueia.length) bloqueia.push('nenhum item com quantidade para devolver');
  if (tipo === 'devolucao_cliente' && itens.some(i => i.ipiDevol)) conferir.push('IPI na devolução de cliente: conferir');
  const fora = String(((outra || {}).endereco || {}).uf || 'SP').toUpperCase() !== String((((o.emitente || {}).endereco) || {}).uf || 'SP').toUpperCase();
  if (fora) conferir.push('devolução para outro estado (' + ((outra || {}).endereco || {}).uf + '): CFOP 6xxx/2xxx; conferir o ICMS-ST interestadual');
  const ehForn = tipo === 'devolucao_fornecedor';
  const nota = {
    ambiente: o.ambiente, emitente: o.emitente, serie: o.serie, numero: o.numero, emissao: o.emissao,
    natOp: ehForn ? 'DEVOLUCAO DE COMPRA PARA COMERCIALIZACAO' : 'DEVOLUCAO DE VENDA', tpNF: ehForn ? 1 : 0, finNFe: 4, refs: orig.chave ? [orig.chave] : [],
    indFinal: ehForn ? 0 : (String((outra || {}).indIEDest) === '1' ? 0 : 1), indPres: 9,
    dest: outra ? { doc: outra.doc, nome: outra.nome, ie: outra.ie, indIEDest: ehForn ? (outra.ie ? 1 : 9) : (outra.indIEDest || (outra.ie ? 1 : 9)), email: outra.email, endereco: outra.endereco } : null,
    itens, frete: { modFrete: 9, valor: r2(freteTot) }, cobranca: null, pagamento: [{ tPag: '90', valor: 0 }],
    infCpl: ['DEVOLUCAO ' + (ehForn ? 'DE COMPRA' : 'DE VENDA') + ' REF. NF ' + orig.numero + ' SERIE ' + orig.serie + ' DE ' + String(orig.emissao || '').slice(0, 10).split('-').reverse().join('/') +
      ' CHAVE ' + (orig.chave || ''), o.motivo ? 'MOTIVO: ' + o.motivo : ''].filter(Boolean).join(';') + ';',
    respTec: o.respTec || null, ibscbs: o.ibscbs, reforma: o.reforma
  };
  if (!nota.dest) bloqueia.push('a nota original não tem o ' + (ehForn ? 'emitente' : 'destinatário'));
  return { nota, original: { chave: orig.chave, numero: orig.numero, serie: orig.serie, emissao: orig.emissao }, avisos: { bloqueia: [...new Set(bloqueia)], conferir: [...new Set(conferir)] } };
}

module.exports = { leNota, cfopDevolucao, notaDevolucao, pega, todos, r2, r4, num, dig };
