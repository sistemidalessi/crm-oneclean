'use strict';
// Serviço fiscal (Fase 4): chave, cálculo, XML da NF-e validado contra o esquema oficial (PL_010 v1.30) e assinatura.
// Dados fictícios. Precisa do xmllint e do openssl (os mesmos da VPS); sem eles, os testes de XML são pulados.
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

const emitente = { cnpj: '11222333000181', ie: '111222333444', razao: 'EMPRESA DE TESTE LTDA', fantasia: 'TESTE', crt: 3,
  endereco: { logradouro: 'RUA DOS TESTES', numero: '100', bairro: 'CENTRO', cMun: '3548708', municipio: 'SAO BERNARDO DO CAMPO', uf: 'SP', cep: '09700000', fone: '1140000000' } };
const nota = (extra) => Object.assign({
  ambiente: 'homologacao', emitente, serie: 2, numero: 15, emissao: '2026-10-20T10:15:00-03:00', cNF: '12345678', natOp: 'VENDA NO ESTADO',
  dest: { doc: '22333444000172', nome: 'CLIENTE DE TESTE & CIA', ie: '222333444555', indIEDest: 1, email: 'compras@cliente.teste',
    endereco: { logradouro: 'AV. EXEMPLO', numero: '50', bairro: 'JARDIM', cMun: '3550308', municipio: 'SAO PAULO', uf: 'SP', cep: '01436000' } },
  itens: [
    { codigo: '010043', descricao: 'DETERGENTE NEUTRO 5L', ncm: '34022000', cfop: '5102', unidade: 'GL', quantidade: 2, valorUnitario: 67.84, origem: 0,
      icms: { cst: '00', aliquota: 18 }, pis: { cst: '01', aliquota: 1.65 }, cofins: { cst: '01', aliquota: 7.6 } },
    { codigo: '300005', descricao: 'PAPEL HIGIENICO ROLAO', ncm: '48181000', cest: '2004200', cfop: '5405', unidade: 'FD', quantidade: 3, valorUnitario: 3.2, origem: 0,
      icms: { cst: '60' }, pis: { cst: '06' }, cofins: { cst: '06' } }],
  frete: { modFrete: 0, valor: 0, volumes: { qVol: 5 } },
  cobranca: { duplicatas: [{ vencimento: '2026-11-19', valor: 145.28 }] },
  infCpl: 'VENDEDOR: RENATA', respTec: { cnpj: '11222333000181', contato: 'Fulano de Tal', email: 'ti@empresa.teste', fone: '11999990000' }
}, extra || {});

test('chave de acesso: 44 dígitos, DV módulo 11 e cNF diferente do número', () => {
  const c = N.chaveAcesso({ cUF: 35, emissao: '2026-10-20T10:15:00-03:00', cnpj: '11222333000181', serie: 2, numero: 15, cNF: '12345678' });
  assert.strictEqual(c.length, 44);
  assert.strictEqual(c.slice(0, 6), '352610');
  assert.strictEqual(c.slice(20, 22), '55');
  assert.strictEqual(c.slice(22, 25), '002');
  assert.strictEqual(c.slice(25, 34), '000000015');
  assert.strictEqual(Number(c[43]), N.dvChave(c.slice(0, 43)));
  assert.strictEqual(N.dvChave('0'.repeat(43)), 0);                 // resto 0 → DV 0
  let i = 0; const seq = ['00000015', '11111111', '87654321'];
  assert.strictEqual(N.codigoNumerico(15, () => seq[i++]), '87654321');  // pula o igual ao número e o repetido
});

test('cálculo como o FKN: ICMS 18% sobre produto + frete, PIS/COFINS sem o ICMS na base, CST 60 sem destaque', () => {
  const c = N.calcula(nota({ itens: [{ quantidade: 1, valorUnitario: 135.68, icms: { cst: '00', aliquota: 18 }, pis: { cst: '01', aliquota: 1.65 }, cofins: { cst: '01', aliquota: 7.6 } }] }));
  const it = c.itens[0];
  assert.deepStrictEqual([it.icms.vBC, it.icms.v, it.pis.vBC, it.pis.v, it.cofins.v], [135.68, 24.42, 111.26, 1.84, 8.46]);   // nota real de 10/2026
  // IBS/CBS 2026: base = 135,68 − 24,42 − 1,84 − 8,46 = 100,96; CBS 0,9% = 0,91; IBS 0,1% = 0,10
  assert.deepStrictEqual([it.ibscbs.vBC, it.ibscbs.vCBS, it.ibscbs.vIBSUF, it.ibscbs.vIBS], [100.96, 0.91, 0.1, 0.1]);
  const d = N.calcula(nota());
  assert.deepStrictEqual([d.totais.vProd, d.totais.vBC, d.totais.vICMS, d.totais.vNF], [145.28, 135.68, 24.42, 145.28]);
  assert.strictEqual(d.itens[1].icms.v, 0); assert.strictEqual(d.itens[1].pis.grupo, 'NT');
});

test('frete rateado pelos itens (o último fica com a sobra) e entra na base do ICMS', () => {
  assert.deepStrictEqual(N.rateia(10, [1, 1, 1]), [3.33, 3.33, 3.34]);
  const c = N.calcula(nota({ frete: { modFrete: 0, valor: 10 } }));
  assert.strictEqual(c.totais.vFrete, 10);
  assert.strictEqual(c.itens[0].icms.vBC, r2(135.68 + c.itens[0].vFrete));
  assert.strictEqual(c.totais.vNF, 155.28);
});
const r2 = v => Math.round(v * 100) / 100;

test('erros claros: CST que o CRM não emite, parcelas que não fecham, emitente incompleto', () => {
  assert.throws(() => N.calcula(nota({ itens: [{ quantidade: 1, valorUnitario: 1, icms: { cst: '10' }, pis: { cst: '01', aliquota: 1 }, cofins: { cst: '01', aliquota: 1 } }] })), /CST 10/);
  assert.throws(() => N.monta(nota({ cobranca: { duplicatas: [{ vencimento: '2026-11-19', valor: 100 }] } })), /não fecham/);
  assert.throws(() => N.monta(nota({ emitente: { cnpj: '1' } })), /emitente incompleto/);
});

test('homologação: o nome do cliente é o texto exigido pela Sefaz', () => {
  const m = N.monta(nota());
  assert.ok(m.infNFe.indexOf('<xNome>' + N.HOMOLOGACAO_NOME + '</xNome>') !== -1);
  assert.ok(m.infNFe.indexOf('<tpAmb>2</tpAmb>') !== -1);
  const p = N.monta(nota({ ambiente: 'producao' }));
  assert.ok(p.infNFe.indexOf('<xNome>CLIENTE DE TESTE &amp; CIA</xNome>') !== -1);
  assert.ok(p.infNFe.indexOf('<infCpl>VENDEDOR: RENATA</infCpl>') !== -1);    // o vigia e a comissão leem o vendedor daqui
});

test('XML assinado passa no esquema oficial da NF-e (PL_010 v1.30, com IBS/CBS) e a assinatura confere', { skip: !temFerramentas && 'sem xmllint/openssl' }, () => {
  const A = require('../servico-fiscal/assinatura.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-teste-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=TESTE'], { stdio: 'pipe' });
    const keyPem = fs.readFileSync(path.join(dir, 'k.pem'), 'utf8'), certPem = fs.readFileSync(path.join(dir, 'c.pem'), 'utf8');
    for (const amb of ['homologacao', 'producao']) {
      const m = N.monta(nota({ ambiente: amb, frete: { modFrete: 0, valor: 12.5, volumes: { qVol: 5, esp: 'CAIXAS' } },
        cobranca: { duplicatas: [{ vencimento: '2026-11-19', valor: 78.89 }, { vencimento: '2026-12-19', valor: 78.89 }] } }));
      const sig = A.assinaElemento(m.infNFe, m.id, certPem, keyPem);
      const nfe = N.nfeCompleta(m.infNFe, sig);
      const conf = A.confere(m.infNFe, sig);
      assert.deepStrictEqual(conf, { digest: true, assinatura: true });
      for (const [xml, xsd] of [[nfe, 'nfe_v4.00.xsd'], [N.loteEnvio(nfe, 1), 'enviNFe_v4.00.xsd']]) {
        const f = path.join(dir, 'n.xml'); fs.writeFileSync(f, xml);
        const r = spawnSync('xmllint', ['--noout', '--schema', path.join(ESQ, xsd), f]);
        assert.strictEqual(r.status, 0, xsd + ': ' + String(r.stderr));
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
