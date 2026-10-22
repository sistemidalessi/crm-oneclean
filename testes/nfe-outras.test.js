'use strict';
// Fase 4b (22/10/2026): devoluções montadas a partir do XML da nota original (outras.js) e validadas no esquema oficial.
// As notas "originais" são fictícias, montadas pelo próprio nfe.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const N = require('../servico-fiscal/nfe.js');
const O = require('../servico-fiscal/outras.js');

const temXmllint = spawnSync('xmllint', ['--version']).status === 0;
const ESQ = path.join(__dirname, '..', 'servico-fiscal', 'esquemas');
const end = (cMun, uf) => ({ logradouro: 'RUA A', numero: '1', bairro: 'BAIRRO', cMun, municipio: 'CIDADE', uf, cep: '09700000' });
const nos = { cnpj: '11222333000181', ie: '111222333444', razao: 'NOSSA EMPRESA LTDA', crt: 3, endereco: end('3548708', 'SP') };
const forn = { cnpj: '33444555000106', ie: '333444555666', razao: 'FORNECEDOR INDUSTRIA LTDA', crt: 3, endereco: end('3550308', 'SP') };

// nota de compra: o fornecedor emite para nós (item 1 com ST destacado e IPI; item 2 comum com IPI)
function notaDeCompra() {
  const m = N.monta({ ambiente: 'producao', emitente: forn, serie: 1, numero: 777, emissao: '2026-10-10T09:00:00-03:00', cNF: '11112222',
    dest: { doc: nos.cnpj, nome: nos.razao, ie: nos.ie, indIEDest: 1, endereco: nos.endereco },
    itens: [{ codigo: 'F1', descricao: 'DESINFETANTE 5L', ncm: '38089419', cfop: '5401', unidade: 'CX', quantidade: 10, valorUnitario: 40, origem: 0,
      icms: { cst: '10', aliquota: 18, st: { pMVAST: 40, pICMSST: 18 } }, pis: { cst: '01', aliquota: 1.65 }, cofins: { cst: '01', aliquota: 7.6 } },
    { codigo: 'F2', descricao: 'SACO DE LIXO 100L', ncm: '39232190', cfop: '5101', unidade: 'PCT', quantidade: 4, valorUnitario: 25, origem: 0,
      icms: { cst: '00', aliquota: 18 }, pis: { cst: '01', aliquota: 1.65 }, cofins: { cst: '01', aliquota: 7.6 } }] });
  // IPI de 5% nos dois itens (o nfe.js não emite IPI; o fornecedor sim)
  let x = N.nfeCompleta(m.infNFe, '');
  let k = 0;
  x = x.replace(/<PIS>/g, () => { const v = k++ === 0 ? '20.00' : '5.00'; return '<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>0</vBC><pIPI>5</pIPI><vIPI>' + v + '</vIPI></IPITrib></IPI><PIS>'; });
  return { xml: '<nfeProc>' + x + '<protNFe><nProt>135260000000001</nProt></protNFe></nfeProc>', chave: m.chave };
}
// nota de venda nossa para um cliente
function notaDeVenda(contribuinte) {
  const m = N.monta({ ambiente: 'producao', emitente: nos, serie: 2, numero: 88, emissao: '2026-10-15T09:00:00-03:00', cNF: '33334444',
    dest: { doc: '22333444000172', nome: 'CONDOMINIO EXEMPLO', indIEDest: contribuinte ? 1 : 9, ie: contribuinte ? '222333444555' : null, endereco: end('3550308', 'SP') },
    itens: [{ codigo: '010043', descricao: 'DETERGENTE 5L', ncm: '34022000', cfop: '5102', unidade: 'GL', quantidade: 6, valorUnitario: 30, origem: 0,
      icms: { cst: '00', aliquota: 18 }, pis: { cst: '01', aliquota: 1.65 }, cofins: { cst: '01', aliquota: 7.6 } },
    { codigo: '300005', descricao: 'PAPEL HIGIENICO', ncm: '48181000', cfop: '5405', unidade: 'FD', quantidade: 3, valorUnitario: 50, origem: 0,
      icms: { cst: '60', stRet: { vBCSTRet: 180, pST: 18, vICMSSubstituto: 20, vICMSSTRet: 12.4 } }, pis: { cst: '06' }, cofins: { cst: '06' } }],
    cobranca: { duplicatas: [{ vencimento: '2026-11-14', valor: 330 }] } });
  return { xml: '<nfeProc>' + N.nfeCompleta(m.infNFe, '') + '</nfeProc>', chave: m.chave };
}
const comum = { emitente: nos, ambiente: 'homologacao', serie: 2, numero: 41, emissao: '2026-10-22T11:00:00-03:00' };

test('lê o XML: chave, itens, ICMS com ST e IPI', () => {
  const c = notaDeCompra(), l = O.leNota(c.xml);
  assert.strictEqual(l.chave, c.chave);
  assert.deepStrictEqual([l.itens[0].icms.cst, l.itens[0].icms.vICMSST, l.itens[0].ipi.vIPI, l.itens[1].ipi.vIPI], ['10', 28.8, 20, 5]);
  assert.strictEqual(l.emit.doc, forn.cnpj);
});

test('devolução a fornecedor: 5411 com o ICMS próprio em CST 90 e o ST em outras despesas (RICMS/SP 274 § 3º), 5202 comum, IPI devolvido', () => {
  const c = notaDeCompra();
  const r = O.notaDevolucao(Object.assign({ tipo: 'devolucao_fornecedor', xml: c.xml, itens: [{ nItem: 1, quantidade: 5 }, { nItem: 2, quantidade: 4 }], motivo: 'AVARIA' }, comum));
  assert.deepStrictEqual(r.avisos.bloqueia, []);
  const [a, b] = r.nota.itens;
  assert.deepStrictEqual([a.cfop, a.icms.cst, a.icms.vBC, a.icms.st, a.outro, a.ipiDevol], ['5411', '90', 200, undefined, 14.4, 10]);
  assert.deepStrictEqual([a.pis.cst, b.cofins.cst], ['49', '49']);
  assert.ok(/ITEM 1: BC ICMS-ST R\$ 280.00 ICMS-ST R\$ 14.40/.test(r.nota.infAdFisco));
  assert.deepStrictEqual([b.cfop, b.icms.cst, b.icms.vBC, b.ipiDevol], ['5202', '00', 100, 5]);
  assert.deepStrictEqual(r.nota.refs, [c.chave]);
  assert.strictEqual(r.nota.dest.doc, forn.cnpj);
  const m = N.monta(r.nota);
  // 200 + 100 de produtos, 14,40 de ST (metade dos 28,80 da compra) em outras despesas, 15 de IPI devolvido
  assert.deepStrictEqual([m.totais.vICMS, m.totais.vST, m.totais.vOutro, m.totais.vIPIDevol, m.totais.vNF], [54, 0, 14.4, 15, 329.4]);
  assert.ok(m.infNFe.indexOf('<vOutro>14.40</vOutro><indTot>1</indTot>') !== -1);
  assert.ok(/DEVOLUCAO DE COMPRA REF\. NF 777/.test(r.nota.infCpl));
});

test('devolução de cliente não contribuinte: entrada 1202 e 1411, crédito do ICMS e do PIS/COFINS (50; 98 no de alíquota zero)', () => {
  const v = notaDeVenda();
  const r = O.notaDevolucao(Object.assign({ tipo: 'devolucao_cliente', xml: v.xml, itens: [{ nItem: 1, quantidade: 2 }, { nItem: 2, quantidade: 3 }] }, comum));
  assert.deepStrictEqual(r.avisos.bloqueia, []);
  const [a, b] = r.nota.itens;
  assert.deepStrictEqual([a.cfop, a.icms.cst, a.icms.vBC, b.cfop, b.icms.cst, b.icms.stRet.vICMSSTRet], ['1202', '00', 60, '1411', '60', 12.4]);
  assert.strictEqual(r.nota.tpNF, 0);
  assert.strictEqual(r.nota.dest.doc, '22333444000172');
  assert.deepStrictEqual([a.pis.cst, a.pis.aliquota, b.pis.cst], ['50', 1.65, '98']);
  // cliente contribuinte: a nota de devolução é dele
  const c = O.notaDevolucao(Object.assign({ tipo: 'devolucao_cliente', xml: notaDeVenda(true).xml, itens: [{ nItem: 1, quantidade: 1 }] }, comum));
  assert.ok(c.avisos.bloqueia.some(t => /contribuinte do ICMS/.test(t)));
});

test('recusas: quantidade maior que a da nota, nota que não é da empresa', () => {
  const c = notaDeCompra();
  const r = O.notaDevolucao(Object.assign({ tipo: 'devolucao_fornecedor', xml: c.xml, itens: [{ nItem: 1, quantidade: 11 }] }, comum));
  assert.ok(r.avisos.bloqueia.some(t => /a nota tem 10/.test(t)));
  const r2 = O.notaDevolucao(Object.assign({ tipo: 'devolucao_cliente', xml: c.xml, itens: [{ nItem: 1, quantidade: 1 }] }, comum));
  assert.ok(r2.avisos.bloqueia.some(t => /não foi emitida pela empresa/.test(t)));
});

test('as devoluções passam no esquema oficial', { skip: !temXmllint && 'sem xmllint' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-dev-'));
  try {
    for (const [tipo, orig, itens] of [['devolucao_fornecedor', notaDeCompra(), [{ nItem: 1, quantidade: 3 }, { nItem: 2, quantidade: 1 }]], ['devolucao_cliente', notaDeVenda(), [{ nItem: 1, quantidade: 1 }, { nItem: 2, quantidade: 1 }]]]) {
      const r = O.notaDevolucao(Object.assign({ tipo, xml: orig.xml, itens }, comum));
      const m = N.monta(r.nota);
      // assinatura vazia de propósito: o esquema pede a Signature; validamos o infNFe dentro de um NFe com uma assinatura de mentira
      const sig = '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI="#' + m.id + '"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>AAAA</DigestValue></Reference></SignedInfo><SignatureValue>AAAA</SignatureValue><KeyInfo><X509Data><X509Certificate>AAAA</X509Certificate></X509Data></KeyInfo></Signature>';
      const f = path.join(dir, 'n.xml'); fs.writeFileSync(f, N.nfeCompleta(m.infNFe, sig));
      const x = spawnSync('xmllint', ['--noout', '--schema', path.join(ESQ, 'nfe_v4.00.xsd'), f]);
      assert.strictEqual(x.status, 0, tipo + ': ' + String(x.stderr));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- do pedido: bonificação e entrega futura
const PD = require('../servico-fiscal/pedido.js');
const regraVenda = (cfop, cst, pis) => ({ ncm: '34022000', origem: '0', situacao: 'conferido', alertas: [],
  regra: { venda: { cfop, cst_icms: cst, aliq_icms: cst === '00' ? 18 : null, cst_pis: pis, aliq_pis: pis === '01' ? 1.65 : null, cst_cofins: pis, aliq_cofins: pis === '01' ? 7.6 : null } } });
const cliente = { cnpj: '22333444000172', razao_social: 'CLIENTE DE TESTE LTDA', ie: '222333444555', ind_ie: '1', codigo_municipio: '3550308',
  logradouro: 'AV. EXEMPLO', numero: '50', bairro: 'JARDIM', cidade: 'SAO PAULO', uf: 'SP', cep: '01436-000' };
const pedido = { numero: 9, frete: 0, dados: { pagamento: '28 DIAS BOLETO' },
  itens: [{ codigo: '010043', descricao: 'DETERGENTE 5L', unidade: 'GL', quantidade: 2, preco: 50, desconto: 0 }, { codigo: '250011', descricao: 'GUARDANAPO', unidade: 'CX', quantidade: 1, preco: 40, desconto: 0 }] };
const regras = { '010043': regraVenda('5102', '00', '01'), '250011': regraVenda('5405', '60', '06') };
const doPedido = (operacao, extra) => PD.notaDoPedido(Object.assign({ pedido, empresa: cliente, regras, emitente: nos, ambiente: 'homologacao', serie: 2, numero: 50,
  emissao: '2026-10-22T11:00:00-03:00', operacao }, extra));

test('bonificação: 5910, ICMS como na venda, sem cobrança', () => {
  const r = doPedido('bonificacao'), n = r.nota;
  assert.deepStrictEqual(n.itens.map(i => [i.cfop, i.icms.cst]), [['5910', '00'], ['5910', '60']]);
  assert.strictEqual(n.cobranca, null);
  assert.deepStrictEqual(n.pagamento, [{ tPag: '90', valor: 0 }]);
  assert.strictEqual(N.monta(n).totais.vICMS, 18);
});

test('entrega futura: faturamento 5922 sem ICMS e com as parcelas; remessa 5117 com ICMS, PIS 49 e a nota de faturamento referenciada', () => {
  const f = doPedido('faturamento_futuro').nota;
  assert.deepStrictEqual(f.itens.map(i => [i.cfop, i.icms.cst, i.pis.cst]), [['5922', '90', '01'], ['5922', '90', '06']]);
  assert.strictEqual(f.cobranca.duplicatas.length, 1);
  assert.strictEqual(N.monta(f).totais.vICMS, 0);
  const sem = doPedido('remessa_futura');
  assert.ok(sem.avisos.bloqueia.some(t => /simples faturamento/.test(t)));
  const ch = '35261011222333000181550020000000501234567891';
  const r = doPedido('remessa_futura', { ref: { chave: ch, numero: 50, emissao: '2026-10-22T11:00:00-03:00' } }).nota;
  assert.deepStrictEqual(r.itens.map(i => [i.cfop, i.icms.cst, i.pis.cst]), [['5117', '00', '49'], ['5117', '60', '49']]);
  assert.deepStrictEqual(r.refs, [ch]);
  assert.strictEqual(r.cobranca, null);
  assert.ok(/^REMESSA REF\. NF DE SIMPLES FATURAMENTO 50 DE 22\/10\/2026;/.test(r.infCpl));
  assert.strictEqual(N.monta(r).totais.vICMS, 18);
});
