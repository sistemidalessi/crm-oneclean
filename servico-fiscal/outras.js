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

module.exports = { leNota, pega, todos, r2, r4, num, dig };
