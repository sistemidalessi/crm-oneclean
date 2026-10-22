'use strict';
// Serviço fiscal, Fase 4b (22/10/2026): notas que não são venda — devolução a fornecedor (finalidade 4, nota referenciada,
// ICMS-ST destacado e IPI devolvido), bonificação, simples faturamento da entrega futura e devolução de cliente (entrada).
// Só a montagem e o esquema oficial; as regras fiscais de cada uma ficam em fiscal-regra / docs. Dados fictícios.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const N = require('../servico-fiscal/nfe.js');

const tem = cmd => spawnSync(cmd, ['--version']).status === 0 || spawnSync(cmd, ['version']).status === 0;
const temFerramentas = tem('xmllint') && tem('openssl');
const ESQ = path.join(__dirname, '..', 'servico-fiscal', 'esquemas');
const CHAVE = '35261011222333000181550010000012341000012345';

const emitente = { cnpj: '11222333000181', ie: '111222333444', razao: 'EMPRESA DE TESTE LTDA', crt: 3,
  endereco: { logradouro: 'RUA DOS TESTES', numero: '100', bairro: 'CENTRO', cMun: '3548708', municipio: 'SAO BERNARDO DO CAMPO', uf: 'SP', cep: '09700000' } };
const base = extra => Object.assign({ ambiente: 'homologacao', emitente, serie: 2, numero: 40, emissao: '2026-10-22T10:00:00-03:00', cNF: '23456789',
  dest: { doc: '22333444000172', nome: 'FORNECEDOR DE TESTE', ie: '222333444555', indIEDest: 1,
    endereco: { logradouro: 'AV. EXEMPLO', numero: '50', bairro: 'JARDIM', cMun: '3550308', municipio: 'SAO PAULO', uf: 'SP', cep: '01436000' } },
  frete: { modFrete: 9 } }, extra);
const item = extra => Object.assign({ codigo: '010043', descricao: 'DETERGENTE NEUTRO 5L', ncm: '34022000', unidade: 'GL', quantidade: 2, valorUnitario: 50, origem: 0,
  pis: { cst: '49' }, cofins: { cst: '49' } }, extra);

const devolFornecedor = () => base({ natOp: 'DEVOLUCAO DE COMPRA', finNFe: 4, refs: [CHAVE],
  itens: [item({ cfop: '5411', icms: { cst: '10', aliquota: 18, st: { vBCST: 140, pICMSST: 18, vICMSST: 7.2 } }, ipiDevol: 5 })] });
const bonificacao = () => base({ natOp: 'BONIFICACAO', itens: [item({ cfop: '5910', icms: { cst: '60' } })] });
const simplesFat = () => base({ natOp: 'SIMPLES FATURAMENTO ENTREGA FUTURA', itens: [item({ cfop: '5922', icms: { cst: '90' }, pis: { cst: '01', aliquota: 1.65 }, cofins: { cst: '01', aliquota: 7.6 } })],
  cobranca: { duplicatas: [{ vencimento: '2026-11-21', valor: 100 }] } });
const devolCliente = () => base({ natOp: 'DEVOLUCAO DE VENDA', tpNF: 0, finNFe: 4, refs: [CHAVE],
  itens: [item({ cfop: '1202', icms: { cst: '00', aliquota: 18 }, pis: { cst: '98' }, cofins: { cst: '98' } })] });

test('devolução a fornecedor: finalidade 4, nota referenciada, ST destacado e IPI devolvido somam no total', () => {
  const m = N.monta(devolFornecedor());
  assert.ok(m.infNFe.indexOf('<finNFe>4</finNFe>') !== -1);
  assert.ok(m.infNFe.indexOf('<NFref><refNFe>' + CHAVE + '</refNFe></NFref></ide>') !== -1);
  assert.ok(/<ICMS10><orig>0<\/orig><CST>10<\/CST><modBC>3<\/modBC><vBC>100.00<\/vBC><pICMS>18.00<\/pICMS><vICMS>18.00<\/vICMS><modBCST>0<\/modBCST><vBCST>140.00<\/vBCST>/.test(m.infNFe));
  assert.ok(m.infNFe.indexOf('<impostoDevol><pDevol>100.00</pDevol><IPI><vIPIDevol>5.00</vIPIDevol></IPI></impostoDevol>') !== -1);
  assert.deepStrictEqual([m.totais.vST, m.totais.vIPIDevol, m.totais.vNF], [7.2, 5, 112.2]);
  assert.ok(m.infNFe.indexOf('<vBCST>140.00</vBCST><vST>7.20</vST>') !== -1);
});

test('ST pela MVA quando não vem pronto; devolução sem a nota referenciada é recusada', () => {
  const c = N.calcula(base({ itens: [item({ cfop: '5401', icms: { cst: '10', aliquota: 18, st: { pMVAST: 40, pICMSST: 18 } } })] }));
  assert.deepStrictEqual([c.itens[0].icms.st.vBCST, c.itens[0].icms.st.vICMSST, c.itens[0].icms.st.modBCST], [140, 7.2, 4]);
  assert.throws(() => N.monta(base({ finNFe: 4, itens: [item({ cfop: '5202', icms: { cst: '00', aliquota: 18 } })] })), /chave da nota devolvida/);
  assert.throws(() => N.monta(base({ finNFe: 4, refs: ['123'], itens: [item({ cfop: '5202', icms: { cst: '00', aliquota: 18 } })] })), /44 dígitos/);
});

test('bonificação, simples faturamento e devolução de cliente (entrada)', () => {
  const b = N.monta(bonificacao());
  assert.ok(b.infNFe.indexOf('<CFOP>5910</CFOP>') !== -1 && b.infNFe.indexOf('<PISOutr><CST>49</CST><vBC>0.00</vBC>') !== -1);
  const s = N.monta(simplesFat());
  assert.ok(s.infNFe.indexOf('<ICMS90><orig>0</orig><CST>90</CST></ICMS90>') !== -1);
  assert.strictEqual(s.totais.vICMS, 0);
  const d = N.monta(devolCliente());
  assert.ok(d.infNFe.indexOf('<tpNF>0</tpNF>') !== -1 && d.infNFe.indexOf('<vICMS>18.00</vICMS>') !== -1);
});

test('as quatro notas passam no esquema oficial, assinadas', { skip: !temFerramentas && 'sem xmllint/openssl' }, () => {
  const A = require('../servico-fiscal/assinatura.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-4b-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=TESTE'], { stdio: 'pipe' });
    const keyPem = fs.readFileSync(path.join(dir, 'k.pem'), 'utf8'), certPem = fs.readFileSync(path.join(dir, 'c.pem'), 'utf8');
    for (const [nome, n] of [['devolução a fornecedor', devolFornecedor()], ['bonificação', bonificacao()], ['simples faturamento', simplesFat()], ['devolução de cliente', devolCliente()]]) {
      const m = N.monta(n);
      const nfe = N.nfeCompleta(m.infNFe, A.assinaElemento(m.infNFe, m.id, certPem, keyPem));
      const f = path.join(dir, 'n.xml'); fs.writeFileSync(f, nfe);
      const r = spawnSync('xmllint', ['--noout', '--schema', path.join(ESQ, 'nfe_v4.00.xsd'), f]);
      assert.strictEqual(r.status, 0, nome + ': ' + String(r.stderr));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
