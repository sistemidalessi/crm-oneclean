'use strict';
/* Serviço fiscal da OneClean — montagem da NF-e 4.00 (modelo 55), Fase 4 da saída do FKN (16/10/2026).
   Parte pura (sem rede, sem certificado): chave de acesso, cálculo dos impostos e o XML do <infNFe>, na ordem exata do
   esquema oficial (esquemas/, pacote PL_010 v1.30 da Reforma Tributária, com o grupo IBS/CBS). Testado em
   testes/nfe-servico.test.js, que valida o XML assinado contra o XSD com o xmllint.
   O cálculo copia o que o FKN faz nas notas da OneClean (conferido nos XML de 2026): ICMS CST 00 a 18% sobre produto +
   frete − desconto; CST 60 (ST já retida) sem destaque; PIS/COFINS CST 01 (1,65% + 7,6%) com o ICMS FORA da base
   ("tese do século": R$ 135,68 − 24,42 de ICMS = base 111,26) ou CST 06 (alíquota zero). IBS/CBS em 2026 (ano de teste,
   LC 214/2025): CBS 0,9% e IBS estadual 0,1%, municipal 0%, sobre a operação sem ICMS, PIS e COFINS.
   Nada de chave, senha ou certificado aqui. */

const NS = 'http://www.portalfiscal.inf.br/nfe';
const HOMOLOGACAO_NOME = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
const dig = v => String(v == null ? '' : v).replace(/\D/g, '');
const docLimpo = v => String(v == null ? '' : v).toUpperCase().replace(/[^0-9A-Z]/g, '');   // CNPJ pode ter letras (07/2026)
// Texto do XML: sem quebra de linha nem espaço repetido, com os 5 escapes do XML (a Sefaz rejeita espaço nas pontas).
const txt = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const d2 = v => r2(v).toFixed(2);
const d4 = v => (Math.round(num(v) * 10000) / 10000).toFixed(4);
const pct = v => num(v).toFixed(4).replace(/0{1,2}$/, '');   // "18.00", "1.65", "7.60", "0.90"
const tag = (n, v) => (v == null || v === '' ? '' : '<' + n + '>' + v + '</' + n + '>');

// ---------------------------------------------------------------- chave de acesso
// cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9) tpEmis(1) cNF(8) + DV (módulo 11, pesos 2..9 da direita; resto 0 ou 1 → 0).
// CNPJ com letras: cada caractere vale (código ASCII − 48), como no DV do próprio CNPJ.
function dvChave(c43) {
  let soma = 0, peso = 2;
  for (let i = c43.length - 1; i >= 0; i--) { soma += (c43.charCodeAt(i) - 48) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
function chaveAcesso({ cUF, emissao, cnpj, mod, serie, numero, tpEmis, cNF }) {
  const aamm = String(emissao).slice(2, 4) + String(emissao).slice(5, 7);
  const base = String(cUF).padStart(2, '0') + aamm + docLimpo(cnpj).padStart(14, '0') + String(mod || 55).padStart(2, '0') +
    String(serie).padStart(3, '0') + String(numero).padStart(9, '0') + String(tpEmis || 1) + String(cNF).padStart(8, '0');
  if (base.length !== 43) throw new Error('chave de acesso com tamanho errado: ' + base.length);
  return base + dvChave(base);
}
// Código numérico (cNF): 8 dígitos ao acaso, diferente do número da nota (regra da Sefaz).
function codigoNumerico(numero, sorteio) {
  const s = sorteio || (() => Math.floor(Math.random() * 1e8));
  let c;
  do { c = String(s()).padStart(8, '0').slice(-8); } while (c === String(numero).padStart(8, '0').slice(-8) || /^(\d)\1{7}$/.test(c));
  return c;
}

// ---------------------------------------------------------------- cálculo
// Rateio do frete (e do desconto do total, se houver) pelos itens, proporcional ao valor; o último fica com a sobra.
function rateia(total, pesos) {
  const t = r2(total), soma = pesos.reduce((s, p) => s + p, 0);
  if (!t || !soma) return pesos.map(() => 0);
  const out = pesos.map(p => r2(t * p / soma));
  out[out.length - 1] = r2(out[out.length - 1] + t - out.reduce((s, x) => s + x, 0));
  return out;
}
const PIS_ALIQ = ['01', '02'], PIS_NT = ['04', '05', '06', '07', '08', '09'];
const CST_ICMS = ['00', '10', '40', '41', '50', '60', '90'];
// finalidade (finNFe): 1 normal, 2 complementar, 3 ajuste, 4 devolução; tpNF: 0 entrada, 1 saída
const IBSCBS_2026 = { cst: '000', cClassTrib: '000001', pIBSUF: 0.1, pIBSMun: 0, pCBS: 0.9 };
// Reforma a partir de 2027 (22/10/2026). Vale a DATA DE EMISSÃO da nota, nunca a de hoje.
// - CBS cobrada de verdade: a alíquota é a de referência fixada pelo Senado − 0,1 ponto (LC 214/2025); ainda não publicada,
//   então NÃO tem padrão: sem `reforma.pCBS` na configuração, nota de 2027 não sai. IBS de 2027/2028: 0,05% estadual e 0,05%
//   municipal (LC 214/2025, transição), padrão abaixo, trocável pela configuração.
// - PIS e COFINS acabam em 2027 (EC 132/2023): item com alíquota de PIS/COFINS em nota de 2027 é recusado.
// - ICMS sai da base do IBS/CBS de 2026 a 2032 (LC 214/2025, art. 12, § 2º, V) — isso continua.
// - IBS/CBS na base do ICMS: a Sefaz-SP diz que entram a partir de 2027 (Resposta à Consulta 32931/2026; art. 13 da LC 87/1996);
//   há liminar contra (Santos) e o contador ainda não deu o "de acordo": fica DESLIGADO até `reforma.icmsComIbsCbs = true`.
//   Ligado, a conta é circular (base do ICMS = operação + IBS + CBS; base do IBS/CBS = operação − ICMS) e se resolve por
//   repetição com os valores já arredondados, até parar de mudar (a ICMS × IBS/CBS ≈ 0,02: para em 2–3 voltas).
// - IBS/CBS "por fora": o total com eles vai em <vNFTot> (campo do PL_010); <vNF> continua sem eles. Quanto se cobra do cliente
//   (vNF ou vNFTot) é decisão comercial + contador: `reforma.cobrarPorFora` (padrão desligado) faz as parcelas fecharem com o vNFTot.
const REFORMA_2027 = { pIBSUF: 0.05, pIBSMun: 0.05, icmsComIbsCbs: false, cobrarPorFora: false };
const anoDe = emissao => Number(String(emissao || '').slice(0, 4)) || 0;
// Regra de IBS/CBS da nota pela data de emissão. nota.reforma = a configuração de 2027 (dados.fiscal.reforma2027).
function regraReforma(nota) {
  const ano = anoDe(nota.emissao);
  if (!ano) throw new Error('nota sem data de emissão');
  if (ano <= 2026) return { ano, de2027: false, aliq: IBSCBS_2026, icmsComIbsCbs: false, cobrarPorFora: false };
  const cfg = Object.assign({}, REFORMA_2027, nota.reforma || {});
  if (!nota.reforma || nota.reforma.pCBS == null || nota.reforma.pCBS === '' || !(num(nota.reforma.pCBS) > 0))
    throw new Error('nota de ' + ano + ': a alíquota da CBS e a regra da Reforma ainda não foram configuradas (falar com o contador)');
  return { ano, de2027: true, aliq: { cst: IBSCBS_2026.cst, cClassTrib: IBSCBS_2026.cClassTrib, pIBSUF: num(cfg.pIBSUF), pIBSMun: num(cfg.pIBSMun), pCBS: num(cfg.pCBS) },
    icmsComIbsCbs: cfg.icmsComIbsCbs === true, cobrarPorFora: cfg.cobrarPorFora === true };
}

// nota.itens: [{ codigo, descricao, ncm, cest, cfop, unidade, quantidade, valorUnitario, desconto (R$), gtin, origem,
//   icms: { cst: '00'|'10'|'40'|'41'|'50'|'60'|'90', aliquota, vBC?, stRet?: { vBCSTRet, pST, vICMSSubstituto, vICMSSTRet },
//           st?: { modBCST, pMVAST, pICMSST, vBCST, vICMSST } },
//   ipiDevol?: R$ do IPI devolvido (devolução de compra: impostoDevol), pis: { cst, aliquota }, cofins: { cst, aliquota },
//   ibscbs?: { cst, cClassTrib, pIBSUF, pIBSMun, pCBS } | false }]
// Fase 4b (22/10/2026, devoluções, bonificação, entrega futura): além de 00 e 60, ICMS 10 (com o ST destacado: valores do
// item quando vêm prontos — devolução copia a proporção da nota de compra — ou MVA + alíquota interna), 40/41/50 (sem
// ICMS) e 90 (outros, com ou sem base). O ST e o IPI devolvido somam no total da nota (vNF), como manda o leiaute.
function calcula(nota) {
  const itens = nota.itens || [];
  if (!itens.length) throw new Error('a nota não tem itens');
  const reg = regraReforma(nota);
  const brutos = itens.map(it => r2(num(it.quantidade) * num(it.valorUnitario)));
  const fretes = rateia(num(nota.frete && nota.frete.valor), brutos);
  const out = itens.map((it, i) => {
    const vProd = brutos[i], vDesc = r2(num(it.desconto)), vFrete = fretes[i], vOutro = r2(num(it.outro));   // outro: outras despesas (o ST da devolução ao substituto)
    if (!(num(it.quantidade) > 0)) throw new Error('item ' + (i + 1) + ': quantidade zerada');
    if (vDesc > vProd) throw new Error('item ' + (i + 1) + ': desconto maior que o valor');
    const icms = it.icms || {}, cstI = String(icms.cst || '');
    if (CST_ICMS.indexOf(cstI) === -1) throw new Error('item ' + (i + 1) + ': ICMS CST ' + (cstI || '?') + ' ainda não é emitido pelo CRM (' + CST_ICMS.join(', ') + ')');
    const V = r2(vProd + vFrete - vDesc);
    const fed = (g, nome, baseFed) => {
      const cst = String((g || {}).cst || '');
      if (PIS_ALIQ.indexOf(cst) !== -1) {
        if (reg.de2027 && num(g.aliquota) > 0) throw new Error('item ' + (i + 1) + ': ' + nome + ' com alíquota em nota de ' + reg.ano + ' (o PIS e a COFINS acabam em 2027)');
        return { cst, grupo: 'Aliq', vBC: baseFed, p: num(g.aliquota), v: r2(baseFed * num(g.aliquota) / 100) };
      }
      if (PIS_NT.indexOf(cst) !== -1) return { cst, grupo: 'NT', vBC: 0, p: 0, v: 0 };
      // 49 (outras saídas), 50–56 (entrada com crédito: devolução de venda), 70–75, 98, 99: grupo "Outr", com base se houver alíquota
      if (/^(49|5[0-6]|6[0-7]|7[0-5]|98|99)$/.test(cst)) {
        if (reg.de2027 && num((g || {}).aliquota) > 0) throw new Error('item ' + (i + 1) + ': ' + nome + ' com alíquota em nota de ' + reg.ano + ' (o PIS e a COFINS acabam em 2027)');
        const p = num((g || {}).aliquota);
        return p > 0 ? { cst, grupo: 'Outr', vBC: baseFed, p, v: r2(baseFed * p / 100) } : { cst, grupo: 'Outr', vBC: 0, p: 0, v: 0 };
      }
      throw new Error('item ' + (i + 1) + ': ' + nome + ' CST ' + (cst || '?') + ' não conhecido');
    };
    const temIbs = it.ibscbs !== false && nota.ibscbs !== false;
    const g = temIbs ? Object.assign({}, reg.aliq, reg.de2027 ? {} : (nota.ibscbs || {}), it.ibscbs || {}) : null;
    // Uma volta da conta: dado o ICMS, o PIS/COFINS e o IBS/CBS (o ICMS fica fora das duas bases, como o FKN e a LC 214/2025).
    const volta = vICMS => {
      const baseFed = r2(V - vICMS);
      const pis = fed(it.pis, 'PIS', baseFed), cofins = fed(it.cofins, 'COFINS', baseFed);
      let ib = null;
      if (g) {
        const vBCIBS = r2(V - vICMS - pis.v - cofins.v);
        const vIBSUF = r2(vBCIBS * num(g.pIBSUF) / 100), vIBSMun = r2(vBCIBS * num(g.pIBSMun) / 100), vCBS = r2(vBCIBS * num(g.pCBS) / 100);
        ib = { cst: g.cst, cClassTrib: g.cClassTrib, vBC: vBCIBS, pIBSUF: num(g.pIBSUF), vIBSUF, pIBSMun: num(g.pIBSMun), vIBSMun, vIBS: r2(vIBSUF + vIBSMun), pCBS: num(g.pCBS), vCBS };
      }
      return { pis, cofins, ibscbs: ib };
    };
    let vBC = 0, vICMS = 0, x = volta(0);
    const comBase = cstI === '00' || cstI === '10' || (cstI === '90' && num(icms.aliquota) > 0);
    if (comBase) {
      const p = num(icms.aliquota);
      vBC = icms.vBC != null && cstI !== '00' ? r2(icms.vBC) : V; vICMS = r2(vBC * p / 100); x = volta(vICMS);
      if (reg.icmsComIbsCbs && x.ibscbs) {
        for (let k = 0; k < 20; k++) {
          const nBC = r2(V + x.ibscbs.vIBS + x.ibscbs.vCBS), nICMS = r2(nBC * p / 100);
          if (nBC === vBC && nICMS === vICMS) break;
          vBC = nBC; vICMS = nICMS; x = volta(vICMS);
        }
      }
    }
    const { pis, cofins, ibscbs } = x;
    // ICMS-ST destacado (CST 10 e, se vier, 90): valores prontos ou MVA sobre (operação + IPI) e alíquota interna − ICMS próprio
    let st = null;
    if ((cstI === '10' || cstI === '90') && icms.st) {
      const q = icms.st, vIPIDev = r2(num(it.ipiDevol));
      const vBCST = q.vBCST != null ? r2(q.vBCST) : r2((V + vIPIDev) * (1 + num(q.pMVAST) / 100));
      const vICMSST = q.vICMSST != null ? r2(q.vICMSST) : Math.max(0, r2(vBCST * num(q.pICMSST) / 100 - vICMS));
      st = { modBCST: q.modBCST == null ? (q.pMVAST != null ? 4 : 0) : q.modBCST, pMVAST: q.pMVAST, pICMSST: num(q.pICMSST), vBCST, vICMSST };
    } else if (cstI === '10') throw new Error('item ' + (i + 1) + ': ICMS CST 10 sem os dados do ST');
    return { vProd, vDesc, vFrete, vOutro, icms: Object.assign({ cst: cstI, vBC, p: num(icms.aliquota), v: vICMS, stRet: icms.stRet || null }, st ? { st } : {}), ipiDevol: r2(num(it.ipiDevol)), pis, cofins, ibscbs };
  });
  const soma = k => r2(out.reduce((s, x) => s + k(x), 0));
  const t = { vBC: soma(x => x.icms.vBC), vICMS: soma(x => x.icms.v), vProd: soma(x => x.vProd), vFrete: soma(x => x.vFrete), vDesc: soma(x => x.vDesc),
    vPIS: soma(x => x.pis.v), vCOFINS: soma(x => x.cofins.v), vBCST: soma(x => (x.icms.st ? x.icms.st.vBCST : 0)), vST: soma(x => (x.icms.st ? x.icms.st.vICMSST : 0)),
    vIPIDevol: soma(x => x.ipiDevol), vOutro: soma(x => x.vOutro) };
  t.vNF = r2(t.vProd + t.vFrete - t.vDesc + t.vST + t.vIPIDevol + t.vOutro);   // o IBS/CBS (por fora) nunca soma no vNF
  const comIbs = out.filter(x => x.ibscbs);
  t.ibscbs = comIbs.length ? { vBC: soma(x => (x.ibscbs ? x.ibscbs.vBC : 0)), vIBSUF: soma(x => (x.ibscbs ? x.ibscbs.vIBSUF : 0)),
    vIBSMun: soma(x => (x.ibscbs ? x.ibscbs.vIBSMun : 0)), vCBS: soma(x => (x.ibscbs ? x.ibscbs.vCBS : 0)) } : null;
  if (t.ibscbs) t.ibscbs.vIBS = r2(t.ibscbs.vIBSUF + t.ibscbs.vIBSMun);
  // 2027 em diante: total com os impostos por fora (<vNFTot>) e o que se cobra do cliente. Em 2026 nada disso existe.
  if (reg.de2027) t.vNFTot = r2(t.vNF + (t.ibscbs ? t.ibscbs.vIBS + t.ibscbs.vCBS : 0));
  t.vCobrar = reg.de2027 && reg.cobrarPorFora ? t.vNFTot : t.vNF;
  return { itens: out, totais: t, reforma: { ano: reg.ano, de2027: reg.de2027, icmsComIbsCbs: reg.icmsComIbsCbs, cobrarPorFora: reg.cobrarPorFora } };
}

// ---------------------------------------------------------------- XML
const enderecoXml = (nome, e, emitente) => '<' + nome + '>' + tag('xLgr', txt(e.logradouro)) + tag('nro', txt(e.numero || 'S/N')) + tag('xCpl', txt(e.complemento)) +
  tag('xBairro', txt(e.bairro)) + tag('cMun', dig(e.cMun)) + tag('xMun', txt(e.municipio)) + tag('UF', txt(e.uf)) + tag('CEP', dig(e.cep)) +
  tag('cPais', '1058') + tag('xPais', 'BRASIL') + tag('fone', dig(e.fone)) + '</' + nome + '>' + (emitente ? '' : '');
const docXml = d => { const x = docLimpo(d); return x.length === 11 ? tag('CPF', x) : tag('CNPJ', x); };

const grupoSt = st => (st ? tag('modBCST', String(st.modBCST)) + (st.pMVAST != null ? tag('pMVAST', pct(st.pMVAST)) : '') + tag('vBCST', d2(st.vBCST)) +
  tag('pICMSST', pct(st.pICMSST)) + tag('vICMSST', d2(st.vICMSST)) : '');
function grupoIcms(c, it) {
  const o = txt(it.origem == null ? '0' : it.origem), k = c.icms.cst;
  if (k === '10') return '<ICMS><ICMS10>' + tag('orig', o) + '<CST>10</CST><modBC>3</modBC>' + tag('vBC', d2(c.icms.vBC)) + tag('pICMS', pct(c.icms.p)) + tag('vICMS', d2(c.icms.v)) +
    grupoSt(c.icms.st) + '</ICMS10></ICMS>';
  if (k === '40' || k === '41' || k === '50') return '<ICMS><ICMS40>' + tag('orig', o) + tag('CST', k) + '</ICMS40></ICMS>';
  if (k === '90') return '<ICMS><ICMS90>' + tag('orig', o) + '<CST>90</CST>' +
    (c.icms.vBC > 0 ? '<modBC>3</modBC>' + tag('vBC', d2(c.icms.vBC)) + tag('pICMS', pct(c.icms.p)) + tag('vICMS', d2(c.icms.v)) : '') + grupoSt(c.icms.st) + '</ICMS90></ICMS>';
  if (c.icms.cst === '00') return '<ICMS><ICMS00>' + tag('orig', o) + '<CST>00</CST><modBC>3</modBC>' + tag('vBC', d2(c.icms.vBC)) + tag('pICMS', pct(c.icms.p)) + tag('vICMS', d2(c.icms.v)) + '</ICMS00></ICMS>';
  const s = c.icms.stRet;
  return '<ICMS><ICMS60>' + tag('orig', o) + '<CST>60</CST>' + (s && s.vBCSTRet != null ? tag('vBCSTRet', d2(s.vBCSTRet)) + tag('pST', pct(s.pST)) +
    (s.vICMSSubstituto != null ? tag('vICMSSubstituto', d2(s.vICMSSubstituto)) : '') + tag('vICMSSTRet', d2(s.vICMSSTRet)) : '') + '</ICMS60></ICMS>';
}
function grupoFed(nome, g) {
  if (g.grupo === 'Aliq') return '<' + nome + '><' + nome + 'Aliq>' + tag('CST', g.cst) + tag('vBC', d2(g.vBC)) + tag('p' + nome, pct(g.p)) + tag('v' + nome, d2(g.v)) + '</' + nome + 'Aliq></' + nome + '>';
  if (g.grupo === 'NT') return '<' + nome + '><' + nome + 'NT>' + tag('CST', g.cst) + '</' + nome + 'NT></' + nome + '>';
  return '<' + nome + '><' + nome + 'Outr>' + tag('CST', g.cst) + tag('vBC', d2(g.vBC)) + tag('p' + nome, pct(g.p)) + tag('v' + nome, d2(g.v)) + '</' + nome + 'Outr></' + nome + '>';
}
function grupoIbsCbs(g) {
  if (!g) return '';
  return '<IBSCBS>' + tag('CST', g.cst) + tag('cClassTrib', g.cClassTrib) + '<gIBSCBS>' + tag('vBC', d2(g.vBC)) +
    '<gIBSUF>' + tag('pIBSUF', pct(g.pIBSUF)) + tag('vIBSUF', d2(g.vIBSUF)) + '</gIBSUF>' +
    '<gIBSMun>' + tag('pIBSMun', pct(g.pIBSMun)) + tag('vIBSMun', d2(g.vIBSMun)) + '</gIBSMun>' + tag('vIBS', d2(g.vIBS)) +
    '<gCBS>' + tag('pCBS', pct(g.pCBS)) + tag('vCBS', d2(g.vCBS)) + '</gCBS></gIBSCBS></IBSCBS>';
}

// nota: { ambiente: 'homologacao'|'producao', emitente: { cnpj, ie, razao, fantasia, crt, endereco: {…, cMun, municipio, uf} },
//   serie, numero, emissao (ISO com fuso, "2026-10-20T10:15:00-03:00"), cNF?, natOp, indFinal, indPres, dest: { doc, nome, ie,
//   indIEDest (1|2|9), email, endereco }, itens, frete: { modFrete, valor, transportadora?: {doc, nome, ie, endereco, municipio, uf},
//   volumes?: { qVol, esp } }, cobranca?: { numero, duplicatas: [{ vencimento, valor }] }, pagamento: [{ tPag, indPag, valor }],
//   infCpl, respTec: { cnpj, contato, email, fone } }
function monta(nota, opc) {
  opc = opc || {};
  const em = nota.emitente || {}, de = nota.dest || {}, homolog = nota.ambiente !== 'producao';
  const e = em.endereco || {}, cUF = String(em.cUF || 35);
  if (!em.cnpj || !em.ie || !e.cMun) throw new Error('emitente incompleto (CNPJ, IE e código do município)');
  if (!de.doc) throw new Error('cliente sem CNPJ/CPF');
  if (!(num(nota.numero) > 0) || !(num(nota.serie) >= 0)) throw new Error('número ou série da nota inválidos');
  const c = calcula(nota);
  const cNF = nota.cNF || codigoNumerico(nota.numero, opc.sorteio);
  const chave = chaveAcesso({ cUF, emissao: nota.emissao, cnpj: em.cnpj, mod: 55, serie: nota.serie, numero: nota.numero, tpEmis: 1, cNF });
  const ufDest = String((de.endereco || {}).uf || '').toUpperCase();
  const idDest = ufDest && ufDest !== String(e.uf || 'SP').toUpperCase() ? '2' : '1';
  const indPres = nota.indPres == null ? 9 : nota.indPres;
  const tpNF = String(nota.tpNF == null ? 1 : nota.tpNF), fin = String(nota.finNFe == null ? 1 : nota.finNFe);
  if (['0', '1'].indexOf(tpNF) === -1 || ['1', '2', '3', '4'].indexOf(fin) === -1) throw new Error('tipo ou finalidade da nota inválidos');
  const refs = (nota.refs || []).map(dig).filter(Boolean);
  if (refs.some(k => k.length !== 44)) throw new Error('chave da nota referenciada com tamanho errado (são 44 dígitos)');
  if (fin === '4' && !refs.length) throw new Error('nota de devolução precisa da chave da nota devolvida');
  const ide = '<ide>' + tag('cUF', cUF) + tag('cNF', cNF) + tag('natOp', txt(nota.natOp || 'VENDA NO ESTADO')) + '<mod>55</mod>' + tag('serie', String(Number(nota.serie))) +
    tag('nNF', String(Number(nota.numero))) + tag('dhEmi', nota.emissao) + (nota.saida ? tag('dhSaiEnt', nota.saida) : '') + tag('tpNF', tpNF) + tag('idDest', idDest) +
    tag('cMunFG', dig(e.cMun)) + '<tpImp>1</tpImp><tpEmis>1</tpEmis>' + tag('cDV', chave.slice(-1)) + tag('tpAmb', homolog ? '2' : '1') + tag('finNFe', fin) +
    tag('indFinal', String(nota.indFinal == null ? 1 : nota.indFinal)) + tag('indPres', String(indPres)) +
    // intermediador (NT 2020.006): obrigatório quando a venda não é presencial (2, 3, 4 e 9; rejeição 434) e proibido
    // nos outros (435). 0 = sem intermediador (venda direta, sem marketplace)
    ([2, 3, 4, 9].indexOf(Number(indPres)) !== -1 ? tag('indIntermed', String(nota.indIntermed == null ? 0 : nota.indIntermed)) : '') +
    '<procEmi>0</procEmi>' + tag('verProc', txt(nota.verProc || 'CRM Sistemi 1.0')) + refs.map(k => '<NFref>' + tag('refNFe', k) + '</NFref>').join('') + '</ide>';
  const emit = '<emit>' + docXml(em.cnpj) + tag('xNome', txt(em.razao)) + tag('xFant', txt(em.fantasia)) +
    enderecoXml('enderEmit', { logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairro: e.bairro, cMun: e.cMun, municipio: e.municipio, uf: e.uf, cep: e.cep, fone: e.fone }, true) +
    tag('IE', dig(em.ie)) + tag('CRT', String(em.crt || 3)) + '</emit>';
  const de2 = de.endereco || {};
  const ind = String(de.indIEDest || (de.ie && !/ISENT/i.test(de.ie) ? 1 : 9));
  const dest = '<dest>' + docXml(de.doc) + tag('xNome', txt(homolog ? HOMOLOGACAO_NOME : de.nome)) +
    (de2.logradouro ? enderecoXml('enderDest', de2) : '') + tag('indIEDest', ind) + (ind === '1' ? tag('IE', dig(de.ie)) : '') + tag('email', txt(de.email)) + '</dest>';
  const det = (nota.itens || []).map((it, i) => {
    const ci = c.itens[i], gtin = dig(it.gtin);
    const ean = gtin && [8, 12, 13, 14].indexOf(gtin.length) !== -1 ? gtin : 'SEM GTIN';
    const prod = '<prod>' + tag('cProd', txt(it.codigo || String(i + 1))) + tag('cEAN', ean) + tag('xProd', txt(it.descricao)) + tag('NCM', dig(it.ncm)) +
      (it.cest ? tag('CEST', dig(it.cest)) : '') + tag('CFOP', dig(it.cfop)) + tag('uCom', txt(it.unidade || 'UN')) + tag('qCom', d4(it.quantidade)) +
      tag('vUnCom', d4(it.valorUnitario)) + tag('vProd', d2(ci.vProd)) + tag('cEANTrib', ean) + tag('uTrib', txt(it.unidade || 'UN')) + tag('qTrib', d4(it.quantidade)) +
      tag('vUnTrib', d4(it.valorUnitario)) + (ci.vFrete ? tag('vFrete', d2(ci.vFrete)) : '') + (ci.vDesc ? tag('vDesc', d2(ci.vDesc)) : '') + (ci.vOutro ? tag('vOutro', d2(ci.vOutro)) : '') + '<indTot>1</indTot>' +
      (it.pedidoCliente ? tag('xPed', txt(it.pedidoCliente)) : '') + '</prod>';
    const imp = '<imposto>' + (it.vTotTrib != null ? tag('vTotTrib', d2(it.vTotTrib)) : '') + grupoIcms(ci, it) + grupoFed('PIS', ci.pis) + grupoFed('COFINS', ci.cofins) + grupoIbsCbs(ci.ibscbs) + '</imposto>';
    const devol = ci.ipiDevol > 0 ? '<impostoDevol><pDevol>100.00</pDevol><IPI>' + tag('vIPIDevol', d2(ci.ipiDevol)) + '</IPI></impostoDevol>' : '';
    // devolução: cada item aponta o item da nota original (DFeReferenciado, leiaute PL_010; sem ele a Sefaz rejeita com 321)
    const ref = it.ref && it.ref.chave ? '<DFeReferenciado>' + tag('chaveAcesso', dig(it.ref.chave)) + (it.ref.nItem ? tag('nItem', String(Number(it.ref.nItem))) : '') + '</DFeReferenciado>' : '';
    return '<det nItem="' + (i + 1) + '">' + prod + imp + devol + (it.infAdProd ? tag('infAdProd', txt(it.infAdProd)) : '') + ref + '</det>';
  }).join('');
  const t = c.totais;
  // tributos aproximados (Lei 12.741/2012, tabela do IBPT): por item e o total
  const comTrib = (nota.itens || []).filter(it => it.vTotTrib != null);
  const totTrib = comTrib.length ? r2(comTrib.reduce((s, it) => s + num(it.vTotTrib), 0)) : null;
  const icmsTot = '<ICMSTot>' + tag('vBC', d2(t.vBC)) + tag('vICMS', d2(t.vICMS)) + '<vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP>' + tag('vBCST', d2(t.vBCST)) + tag('vST', d2(t.vST)) + '<vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>' +
    tag('vProd', d2(t.vProd)) + tag('vFrete', d2(t.vFrete)) + '<vSeg>0.00</vSeg>' + tag('vDesc', d2(t.vDesc)) + '<vII>0.00</vII><vIPI>0.00</vIPI>' + tag('vIPIDevol', d2(t.vIPIDevol)) +
    tag('vPIS', d2(t.vPIS)) + tag('vCOFINS', d2(t.vCOFINS)) + tag('vOutro', d2(t.vOutro)) + tag('vNF', d2(t.vNF)) +
    (totTrib != null ? tag('vTotTrib', d2(totTrib)) : '') + '</ICMSTot>';
  const ib = t.ibscbs;
  const ibsTot = ib ? '<IBSCBSTot>' + tag('vBCIBSCBS', d2(ib.vBC)) + '<gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib>' + tag('vIBSUF', d2(ib.vIBSUF)) + '</gIBSUF>' +
    '<gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib>' + tag('vIBSMun', d2(ib.vIBSMun)) + '</gIBSMun>' + tag('vIBS', d2(ib.vIBS)) + '<vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gIBS>' +
    '<gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib>' + tag('vCBS', d2(ib.vCBS)) + '<vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS></IBSCBSTot>' : '';
  const fr = nota.frete || {}, tr = fr.transportadora, vol = fr.volumes;
  const transp = '<transp>' + tag('modFrete', String(fr.modFrete == null ? 0 : fr.modFrete)) +
    (tr && tr.nome ? '<transporta>' + (tr.doc ? docXml(tr.doc) : '') + tag('xNome', txt(tr.nome)) + (tr.ie ? tag('IE', dig(tr.ie)) : '') + tag('xEnder', txt(tr.endereco)) +
      tag('xMun', txt(tr.municipio)) + tag('UF', txt(tr.uf)) + '</transporta>' : '') +
    (vol && num(vol.qVol) > 0 ? '<vol>' + tag('qVol', String(Math.round(num(vol.qVol)))) + tag('esp', txt(vol.esp || 'VOLUMES')) + '</vol>' : '') + '</transp>';
  const cb = nota.cobranca, dups = (cb && cb.duplicatas) || [];
  const somaDup = r2(dups.reduce((s, d) => s + num(d.valor), 0));
  if (dups.length && Math.abs(somaDup - t.vCobrar) > 0.009) throw new Error('as parcelas (' + d2(somaDup) + ') não fecham com o total da nota (' + d2(t.vCobrar) + ')');
  const cobr = dups.length ? '<cobr><fat>' + tag('nFat', txt(cb.numero || String(nota.numero))) + tag('vOrig', d2(t.vCobrar)) + '<vDesc>0.00</vDesc>' + tag('vLiq', d2(t.vCobrar)) + '</fat>' +
    dups.map((d, i) => '<dup>' + tag('nDup', String(i + 1).padStart(3, '0')) + tag('dVenc', d.vencimento) + tag('vDup', d2(d.valor)) + '</dup>').join('') + '</cobr>' : '';
  const pags = (nota.pagamento && nota.pagamento.length) ? nota.pagamento : [{ tPag: dups.length ? '15' : '90', indPag: dups.length ? 1 : null, valor: dups.length ? t.vCobrar : 0 }];
  const pag = '<pag>' + pags.map(p => '<detPag>' + (p.indPag != null ? tag('indPag', String(p.indPag)) : '') + tag('tPag', String(p.tPag).padStart(2, '0')) +
    (String(p.tPag) === '99' ? tag('xPag', txt(p.descricao || 'OUTROS')) : '') + tag('vPag', d2(p.valor)) + '</detPag>').join('') + '</pag>';
  const infAdic = nota.infCpl || nota.infAdFisco ? '<infAdic>' + tag('infAdFisco', txt(nota.infAdFisco)) + tag('infCpl', txt(nota.infCpl)) + '</infAdic>' : '';
  const rt = nota.respTec;
  const resp = rt && rt.cnpj ? '<infRespTec>' + tag('CNPJ', docLimpo(rt.cnpj)) + tag('xContato', txt(rt.contato)) + tag('email', txt(rt.email)) + tag('fone', dig(rt.fone)) + '</infRespTec>' : '';
  const id = 'NFe' + chave;
  const infNFe = '<infNFe Id="' + id + '" versao="4.00">' + ide + emit + dest + det + '<total>' + icmsTot + ibsTot + (t.vNFTot != null ? tag('vNFTot', d2(t.vNFTot)) : '') + '</total>' + transp + cobr + pag + infAdic + resp + '</infNFe>';
  return { chave, id, cNF, infNFe, calculo: c, totais: t };
}

// Documento completo (com a assinatura) e o lote de envio síncrono.
const nfeCompleta = (infNFe, assinatura) => '<NFe xmlns="' + NS + '">' + infNFe + assinatura + '</NFe>';
const loteEnvio = (nfeXml, idLote) => '<enviNFe xmlns="' + NS + '" versao="4.00">' + tag('idLote', String(idLote).padStart(15, '0').slice(-15)) + '<indSinc>1</indSinc>' + nfeXml + '</enviNFe>';
// O <nfeProc> (nota + protocolo) é o arquivo que vale: vai para o cliente, para a contabilidade e para o CRM.
const nfeProc = (nfeXml, protNFeXml) => '<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="' + NS + '" versao="4.00">' + nfeXml + protNFeXml + '</nfeProc>';

module.exports = { NS, HOMOLOGACAO_NOME, dvChave, chaveAcesso, codigoNumerico, rateia, calcula, monta, nfeCompleta, loteEnvio, nfeProc, txt, IBSCBS_2026, REFORMA_2027, regraReforma };
