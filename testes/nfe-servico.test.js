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
      const comTrib = amb === 'producao';   // produção também com os tributos aproximados (IBPT) e o aviso ao fisco
      const m = N.monta(nota({ ambiente: amb, frete: { modFrete: 0, valor: 12.5, volumes: { qVol: 5, esp: 'CAIXAS' } },
        itens: nota().itens.map(it => Object.assign({}, it, comTrib ? { vTotTrib: 4.27 } : {},
          comTrib && it.icms.cst === '60' ? { icms: { cst: '60', stRet: { vBCSTRet: 13.95, pST: 18, vICMSSubstituto: 1.71, vICMSSTRet: 0.8 } } } : {})), infAdFisco: comTrib ? 'Operacao sujeita ao disposto na Lei Complementar no 224/2025;' : undefined,
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

test('mensagens da Sefaz (status, consulta, cancelamento, CC-e, inutilização) passam nos esquemas oficiais', { skip: !temFerramentas && 'sem xmllint/openssl' }, () => {
  const A = require('../servico-fiscal/assinatura.js'), S = require('../servico-fiscal/sefaz.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-teste-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=TESTE'], { stdio: 'pipe' });
    const keyPem = fs.readFileSync(path.join(dir, 'k.pem'), 'utf8'), certPem = fs.readFileSync(path.join(dir, 'c.pem'), 'utf8');
    const chave = N.monta(nota()).chave, quando = '2026-10-20T11:00:00-03:00';
    const canc = S.cancelamento({ ambiente: 'homologacao', cnpj: '11222333000181', chave, protocolo: '135260000000001', justificativa: 'Cliente desistiu da compra', quando });
    const cce = S.cartaCorrecao({ ambiente: 'homologacao', cnpj: '11222333000181', chave, seq: 2, correcao: 'Endereço de entrega: Rua das Flores, 10', quando });
    const inut = S.infInut({ ambiente: 'homologacao', cnpj: '11222333000181', ano: 2026, serie: 2, de: 7, ate: 9, justificativa: 'Numeração pulada por falha do sistema' });
    const ev = i => S.envEvento(1, S.montaEvento(i.infEvento, A.assinaElemento(i.infEvento, i.id, certPem, keyPem)));
    const casos = [[S.msgStatus('homologacao'), 'consStatServ_v4.00.xsd'], [S.msgConsulta('producao', chave), 'consSitNFe_v4.00.xsd'],
      [ev(canc), 'envEventoCancNFe_v1.00.xsd'], [ev(cce), 'envCCe_v1.00.xsd'], [S.inutNFe(inut.infInut, A.assinaElemento(inut.infInut, inut.id, certPem, keyPem)), 'inutNFe_v4.00.xsd']];
    for (const [xml, xsd] of casos) {
      const f = path.join(dir, 'm.xml'); fs.writeFileSync(f, xml);
      const r = spawnSync('xmllint', ['--noout', '--schema', path.join(ESQ, xsd), f]);
      assert.strictEqual(r.status, 0, xsd + ': ' + String(r.stderr));
    }
    assert.strictEqual(canc.id, 'ID110111' + chave + '01');
    assert.strictEqual(inut.id.length, 43);
    assert.throws(() => S.cancelamento({ chave, protocolo: '1', justificativa: 'curto', quando }), /15 letras/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('leitura das respostas da Sefaz: autorizada, rejeitada, denegada, evento', () => {
  const S = require('../servico-fiscal/sefaz.js');
  const env = x => '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">' + x + '</nfeResultMsg></soap:Body></soap:Envelope>';
  const prot = (c, m) => '<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>3526' + '1'.repeat(40) + '</chNFe><dhRecbto>2026-10-20T11:00:01-03:00</dhRecbto><nProt>135260000012345</nProt><cStat>' + c + '</cStat><xMotivo>' + m + '</xMotivo></infProt></protNFe>';
  const a = S.leRetorno(env('<retEnviNFe versao="4.00"><cStat>104</cStat><xMotivo>Lote processado</xMotivo>' + prot(100, 'Autorizado o uso da NF-e') + '</retEnviNFe>'));
  assert.deepStrictEqual([a.situacao, a.cStat, a.protocolo, a.cStatLote], ['autorizada', 100, '135260000012345', 104]);
  assert.ok(a.protNFe.indexOf('<protNFe') === 0);
  const r = S.leRetorno(env('<retEnviNFe versao="4.00"><cStat>104</cStat><xMotivo>Lote processado</xMotivo>' + prot(778, 'Rejeicao: Informado NCM inexistente') + '</retEnviNFe>'));
  assert.deepStrictEqual([r.situacao, r.cStat, r.xMotivo], ['rejeitada', 778, 'Rejeicao: Informado NCM inexistente']);
  assert.strictEqual(S.leRetorno(env('<retEnviNFe><cStat>225</cStat><xMotivo>Rejeicao: Falha no Schema XML</xMotivo></retEnviNFe>')).situacao, 'rejeitada');
  assert.strictEqual(S.situacao(302), 'denegada');
  const e = S.leRetorno(env('<retEnvEvento><cStat>128</cStat><retEvento versao="1.00"><infEvento><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><nProt>135260000099999</nProt></infEvento></retEvento></retEnvEvento>'));
  assert.deepStrictEqual([e.eventoStat, e.protocolo], [135, '135260000099999']);
});

test('servidor: recusa sem a chave, prévia calcula sem falar com a Sefaz, sem certificado não emite', async () => {
  const V = require('../servico-fiscal/servidor.js');
  process.env.FISCAL_TOKEN = 'x'.repeat(40); process.env.FISCAL_PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'fisc-'));
  V._cert(null);
  const srv = V.cria(); await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const porta = srv.address().port;
  const chama = async (met, rota, corpo, tok) => { const r = await fetch('http://127.0.0.1:' + porta + rota, { method: met, headers: tok ? { Authorization: 'Bearer ' + tok } : {}, body: corpo ? JSON.stringify(corpo) : undefined }); return [r.status, await r.json()]; };
  try {
    assert.strictEqual((await chama('GET', '/saude'))[0], 401);
    assert.strictEqual((await chama('GET', '/saude', null, 'y'.repeat(40)))[0], 401);
    const [s, saude] = await chama('GET', '/saude', null, 'x'.repeat(40));
    assert.deepStrictEqual([s, saude.ok, saude.certificado], [200, true, null]);
    const [sp, pv] = await chama('POST', '/previa', { nota: nota() }, 'x'.repeat(40));
    assert.deepStrictEqual([sp, pv.totais.vNF, pv.chave.length], [200, 145.28, 44]);
    const [se, em] = await chama('POST', '/emitir', { nota: nota() }, 'x'.repeat(40));
    assert.deepStrictEqual([se, /certificado/.test(em.erro)], [503, true]);
    assert.strictEqual((await chama('POST', '/nada', {}, 'x'.repeat(40)))[0], 404);
    process.env.FISCAL_TOKEN = 'curta';
    assert.strictEqual((await chama('GET', '/saude', null, 'curta'))[0], 401);   // chave fraca: não atende ninguém
  } finally { srv.close(); fs.rmSync(process.env.FISCAL_PASTA, { recursive: true, force: true }); }
});

const PD = require('../servico-fiscal/pedido.js');
test('pagamento do pedido: prazos e forma (boleto, pix, transferência, à vista sem forma)', () => {
  assert.deepStrictEqual([PD.lePagamento('28 DIAS BOLETO').dias, PD.lePagamento('28 DIAS BOLETO').forma], [[28], '15']);
  assert.deepStrictEqual(PD.lePagamento('30/60/90 DIAS BOLETO').dias, [30, 60, 90]);
  assert.deepStrictEqual([PD.lePagamento('A VISTA PIX').forma, PD.lePagamento('A VISTA PIX').aVista], ['17', true]);
  assert.strictEqual(PD.lePagamento('À vista transferência').forma, '18');
  assert.strictEqual(PD.lePagamento('A VISTA').forma, '99');
  assert.deepStrictEqual(PD.parcelas(100, [30, 60, 90], '2026-10-20'), [{ vencimento: '2026-11-19', valor: 33.33 }, { vencimento: '2026-12-19', valor: 33.33 }, { vencimento: '2027-01-18', valor: 33.34 }]);
});

const regraVenda = (cfop, cst, pis) => ({ ncm: '34022000', origem: '0', situacao: 'conferido', alertas: [],
  regra: { venda: { cfop, cst_icms: cst, aliq_icms: cst === '00' ? 18 : null, cst_pis: pis, aliq_pis: pis === '01' ? 1.65 : null, cst_cofins: pis, aliq_cofins: pis === '01' ? 7.6 : null } } });
const cliente = { cnpj: '22.333.444/0001-72', razao_social: 'CLIENTE DE TESTE LTDA', nome: 'Cliente', ie: '222333444555', ind_ie: '1', codigo_municipio: '3550308',
  logradouro: 'AV. EXEMPLO', numero: '50', bairro: 'JARDIM', cidade: 'SAO PAULO', uf: 'SP', cep: '01436-000', email: 'a@cliente.teste; b@cliente.teste' };
const pedido = { numero: 7, frete: 0, dados: { pagamento: '28 DIAS BOLETO', frete_conta: '0', volumes: 3, texto_nota: 'Recebimento das 7h às 12h', seu_pedido: 'PC-55' },
  itens: [{ codigo: '010043', descricao: 'DETERGENTE NEUTRO 5L', unidade: 'GL', quantidade: 2, preco: 67.84, desconto: 0 },
    { codigo: '250011.1', descricao: 'GUARDANAPO CX', unidade: 'CX', quantidade: 1, preco: 94.08, desconto: 10 }] };
const regras = { '010043': regraVenda('5102', '00', '01'), '250011': regraVenda('5405', '60', '06') };

test('pedido → nota: caixa vira o código do produto, desconto em R$, parcelas, vendedor no texto da nota', () => {
  const r = PD.notaDoPedido({ pedido, empresa: cliente, regras, emitente, ambiente: 'homologacao', serie: 2, numero: 31, emissao: '2026-10-20T10:00:00-03:00', vendedorNome: 'Renata' });
  assert.deepStrictEqual(r.avisos, { bloqueia: [], conferir: ['produto 250011: sem o ICMS-ST retido (CX) das notas do FKN; sai só com o CST 60 (aba Fiscal → "Aprender o ICMS-ST")',
    'tabela do IBPT não carregada (aba Fiscal): a nota sai sem os tributos aproximados'] });
  const n = r.nota;
  assert.deepStrictEqual(n.itens.map(i => [i.codigo, i.unidade, i.cfop, i.desconto]), [['010043', 'GL', '5102', 0], ['250011', 'CX', '5405', 9.41]]);
  assert.strictEqual(r.total, 220.35);
  assert.deepStrictEqual(n.cobranca.duplicatas, [{ vencimento: '2026-11-17', valor: 220.35 }]);
  assert.deepStrictEqual(n.pagamento, [{ tPag: '15', indPag: 1, valor: 220.35, descricao: null }]);
  assert.strictEqual(n.infCpl, 'PORTADOR: BOLETO PRAZO: 28 DIAS;VENDEDOR: RENATA;PEDIDO CRM: 7;SEU PEDIDO: PC-55;Recebimento das 7h às 12h;');   // como o FKN
  assert.strictEqual(n.infAdFisco, 'Operacao sujeita ao disposto na Lei Complementar no 224/2025;');                                            // item com PIS/COFINS 06
  const V = require('../nfe.js');   // o leitor do vigia acha o vendedor no texto novo
  assert.strictEqual(V.lerXml(N.nfeCompleta(N.monta(n).infNFe, '')).vendedor, 'RENATA');
  assert.strictEqual(n.dest.email, 'a@cliente.teste');
  const m = N.monta(n);   // monta sem erro (parcelas fecham com o total)
  assert.strictEqual(m.totais.vNF, 220.35);
});

test('pedido → nota: o que bloqueia a emissão', () => {
  const sem = PD.notaDoPedido({ pedido, empresa: Object.assign({}, cliente, { uf: 'RJ', codigo_municipio: '', ie: '' }), regras: { '010043': regras['010043'] }, emitente, ambiente: 'homologacao', serie: 2, numero: 1, emissao: '2026-10-20T10:00:00-03:00' });
  assert.ok(sem.avisos.bloqueia.some(x => /outro estado/.test(x)));
  assert.ok(sem.avisos.bloqueia.some(x => /código IBGE/.test(x)));
  assert.ok(sem.avisos.bloqueia.some(x => /sem a inscrição estadual/.test(x)));
  assert.ok(sem.avisos.bloqueia.some(x => /250011 .*sem regra fiscal/.test(x)));
  const prop = PD.notaDoPedido({ pedido, empresa: cliente, regras: { '010043': Object.assign({}, regras['010043'], { situacao: 'proposta' }), '250011': regras['250011'] }, emitente, ambiente: 'homologacao', serie: 2, numero: 1, emissao: '2026-10-20T10:00:00-03:00' });
  assert.deepStrictEqual(prop.avisos.bloqueia, []);
  assert.ok(prop.avisos.conferir.some(x => /proposta/.test(x)));
  // regra com o CFOP de outra operação (6108 para fora de SP, 5117 entrega futura) não vira venda dentro de SP
  ['6108', '5117'].forEach(cf => {
    const r6 = JSON.parse(JSON.stringify(regras['010043'])); r6.regra.venda.cfop = cf;
    const x = PD.notaDoPedido({ pedido, empresa: cliente, regras: { '010043': r6, '250011': regras['250011'] }, emitente, ambiente: 'homologacao', serie: 2, numero: 1, emissao: '2026-10-20T10:00:00-03:00' });
    assert.ok(x.avisos.bloqueia.some(t => new RegExp('010043 .*CFOP ' + cf + ', que não é de venda dentro de SP').test(t)), cf);
  });
});

test('intermediador: obrigatório na venda não presencial (9), ausente na presencial (1)', () => {
  const x9 = N.monta(nota()).infNFe, x1 = N.monta(nota({ indPres: 1 })).infNFe;
  assert.match(x9, /<indPres>9<\/indPres><indIntermed>0<\/indIntermed><procEmi>/);   // rejeição 434 sem ele (homologação, 16/10/2026)
  assert.doesNotMatch(x1, /indIntermed/);
});

test('tributos aproximados (Lei 12.741) pela tabela do IBPT: por item, no total e no texto ao fisco, como o FKN', () => {
  const ibpt = { '34022000': { nac_fed: 13.45, imp_fed: 15.45, estadual: 18, municipal: 0, vig_fim: '2026-09-30', chave: 'A906AF', fonte: 'IBPT/empresometro.com.br' } };
  const r = PD.notaDoPedido({ pedido, empresa: cliente, regras, emitente, ambiente: 'homologacao', serie: 2, numero: 31, emissao: '2026-10-20T10:00:00-03:00', vendedorNome: 'Renata', ibpt });
  // detergente: 2 × 67,84 = 135,68 × 31,45% = 42,67 (a mesma conta da NF 2708 do FKN); guardanapo: 84,67 × 31,45% = 26,63
  assert.deepStrictEqual(r.nota.itens.map(i => i.vTotTrib), [42.67, 26.63]);
  assert.strictEqual(r.nota.infAdFisco, 'Operacao sujeita ao disposto na Lei Complementar no 224/2025;Trib aprox R$: 29.64 Federal, 39.66 Estadual e 0.00 Municipal.; Fonte: IBPT/empresometro.com.br A906AF;');
  assert.ok(r.avisos.conferir.some(x => /venceu em 30\/09\/2026/.test(x)));
  const x = N.monta(r.nota).infNFe;
  assert.match(x, /<imposto><vTotTrib>42.67<\/vTotTrib><ICMS>/);
  assert.match(x, /<vNF>220.35<\/vNF><vTotTrib>69.30<\/vTotTrib><\/ICMSTot>/);
  const fora = PD.notaDoPedido({ pedido, empresa: cliente, regras, emitente, ambiente: 'homologacao', serie: 2, numero: 31, emissao: '2026-10-20T10:00:00-03:00', ibpt: { '48181000': ibpt['34022000'] } });
  assert.ok(fora.avisos.conferir.some(x => /010043.*fora da tabela do IBPT/.test(x)));
});

test('ICMS-ST retido (CST 60): o valor por unidade aprendido do FKN vezes a quantidade; sem ele, avisa', () => {
  const r60 = Object.assign({}, regras['250011'], { regra: Object.assign({}, regras['250011'].regra,
    { st_ret: { CX: { vBCSTRet: 46.48, pST: 18, vICMSSubstituto: 5.69, vICMSSTRet: 2.67 } } }) });
  const p2 = Object.assign({}, pedido, { itens: [pedido.itens[0], Object.assign({}, pedido.itens[1], { quantidade: 2 })] });
  const r = PD.notaDoPedido({ pedido: p2, empresa: cliente, regras: { '010043': regras['010043'], '250011': r60 }, emitente, ambiente: 'homologacao', serie: 2, numero: 31, emissao: '2026-10-20T10:00:00-03:00' });
  assert.deepStrictEqual(r.nota.itens[1].icms.stRet, { vBCSTRet: 92.96, pST: 18, vICMSSubstituto: 11.38, vICMSSTRet: 5.34 });
  assert.match(N.monta(r.nota).infNFe, /<ICMS60><orig>0<\/orig><CST>60<\/CST><vBCSTRet>92.96<\/vBCSTRet><pST>18.00<\/pST><vICMSSubstituto>11.38<\/vICMSSubstituto><vICMSSTRet>5.34<\/vICMSSTRet><\/ICMS60>/);
  const sem = PD.notaDoPedido({ pedido, empresa: cliente, regras, emitente, ambiente: 'homologacao', serie: 2, numero: 31, emissao: '2026-10-20T10:00:00-03:00' });
  assert.ok(sem.avisos.conferir.some(x => /250011: sem o ICMS-ST retido \(CX\)/.test(x)));
  assert.strictEqual(sem.nota.itens[1].icms.stRet, null);
});

// ---------------------------------------------------------------- Reforma: 2027 em diante (22/10/2026)
// Vale a data de EMISSÃO da nota. 2026 = como sempre; 2027 = CBS cobrada (alíquota da configuração), PIS/COFINS extintos,
// vNFTot com o IBS/CBS por fora e, só se ligado, IBS/CBS na base do ICMS (RC Sefaz-SP 32931/2026).
const EM27 = '2027-01-04T09:00:00-03:00';
const REF27 = { pCBS: 8.8 };   // alíquota de exemplo: a de verdade vem do Senado e do contador
const item27 = (extra) => Object.assign({ codigo: '010043', descricao: 'DETERGENTE NEUTRO 5L', ncm: '34022000', cfop: '5102', unidade: 'GL', quantidade: 1, valorUnitario: 135.68, origem: 0,
  icms: { cst: '00', aliquota: 18 }, pis: { cst: '06' }, cofins: { cst: '06' } }, extra || {});
const nota27 = (ref, extra) => nota(Object.assign({ emissao: EM27, reforma: ref, itens: [item27(), item27({ codigo: '300005', descricao: 'PAPEL HIGIENICO ROLAO', ncm: '48181000',
  cfop: '5405', quantidade: 3, valorUnitario: 3.2, icms: { cst: '60' } })], cobranca: null }, extra || {}));

test('2026: a configuração de 2027 não muda nada (mesmo XML, sem vNFTot, IBS/CBS de teste)', () => {
  const hoje = N.monta(nota()), comCfg = N.monta(nota({ reforma: { pCBS: 8.8, icmsComIbsCbs: true, cobrarPorFora: true } }));
  assert.strictEqual(comCfg.infNFe, hoje.infNFe);
  assert.ok(!/vNFTot/.test(hoje.infNFe));
  const fim = N.calcula(nota({ emissao: '2026-12-31T23:59:59-03:00' }));   // último dia de 2026 ainda é 2026
  assert.deepStrictEqual([fim.reforma.de2027, fim.itens[0].icms.vBC, fim.itens[0].icms.v, fim.itens[0].ibscbs.pCBS, fim.totais.vNFTot], [false, 135.68, 24.42, 0.9, undefined]);
});

test('2027 sem a regra configurada: a nota não sai; PIS/COFINS com alíquota também não', () => {
  assert.throws(() => N.calcula(nota27(undefined)), /2027: a alíquota da CBS/);
  assert.throws(() => N.calcula(nota27({ pIBSUF: 0.05 })), /2027: a alíquota da CBS/);
  assert.throws(() => N.calcula(nota({ emissao: EM27, reforma: REF27 })), /PIS com alíquota em nota de 2027/);
});

test('2027, IBS/CBS fora da base do ICMS (padrão): CBS da configuração, IBS 0,05 + 0,05, vNFTot por fora', () => {
  const c = N.calcula(nota27(REF27)), i = c.itens[0];
  assert.deepStrictEqual([i.icms.vBC, i.icms.v], [135.68, 24.42]);                       // ICMS como em 2026
  assert.deepStrictEqual([i.ibscbs.vBC, i.ibscbs.pIBSUF, i.ibscbs.pIBSMun, i.ibscbs.vIBS, i.ibscbs.pCBS, i.ibscbs.vCBS], [111.26, 0.05, 0.05, 0.12, 8.8, 9.79]);   // ICMS fora da base do IBS/CBS
  assert.strictEqual(c.totais.vNF, 145.28);                                              // vNF continua sem o IBS/CBS
  assert.strictEqual(c.totais.vNFTot, r2(145.28 + c.totais.ibscbs.vIBS + c.totais.ibscbs.vCBS));
  assert.strictEqual(c.totais.vCobrar, c.totais.vNF);                                    // cobrar por fora: desligado
  assert.ok(/<\/IBSCBSTot><vNFTot>/.test(N.monta(nota27(REF27)).infNFe));
});

test('2027, IBS/CBS na base do ICMS (ligado): conta circular resolvida, bate com a fórmula fechada', () => {
  const c = N.calcula(nota27(Object.assign({ icmsComIbsCbs: true }, REF27))), i = c.itens[0];
  // base ICMS = V + IBS + CBS; base IBS/CBS = V − ICMS → ICMS = a·V·(1+t)/(1+a·t) = 26,1766 com V 135,68, a 18%, t 8,9%
  assert.deepStrictEqual([i.icms.vBC, i.icms.v, i.ibscbs.vBC, i.ibscbs.vIBS, i.ibscbs.vCBS], [145.42, 26.18, 109.5, 0.1, 9.64]);
  assert.strictEqual(i.icms.vBC, r2(135.68 + i.ibscbs.vIBS + i.ibscbs.vCBS));
  assert.strictEqual(i.ibscbs.vBC, r2(135.68 - i.icms.v));
  assert.strictEqual(i.icms.v, r2(i.icms.vBC * 0.18));
  assert.deepStrictEqual(c.itens[1].icms, { cst: '60', vBC: 0, p: 0, v: 0, stRet: null }); // CST 60 continua sem destaque
  // com frete e desconto rateados
  const f = N.calcula(nota27(Object.assign({ icmsComIbsCbs: true }, REF27), { frete: { modFrete: 0, valor: 12.5 } }));
  f.itens.filter(x => x.icms.cst === '00').forEach(x => {
    const V = r2(x.vProd + x.vFrete - x.vDesc);
    assert.strictEqual(x.icms.vBC, r2(V + x.ibscbs.vIBS + x.ibscbs.vCBS));
    assert.strictEqual(x.ibscbs.vBC, r2(V - x.icms.v));
  });
});

test('2027 cobrando por fora: parcelas fecham com o vNFTot; pedido → nota bloqueia sem a regra e avisa o que conferir', () => {
  const ref = Object.assign({ icmsComIbsCbs: true, cobrarPorFora: true }, REF27);
  const c = N.calcula(nota27(ref));
  assert.throws(() => N.monta(nota27(ref, { cobranca: { duplicatas: [{ vencimento: '2027-02-03', valor: c.totais.vNF }] } })), /não fecham/);
  const m = N.monta(nota27(ref, { cobranca: { duplicatas: [{ vencimento: '2027-02-03', valor: c.totais.vNFTot }] } }));
  assert.match(m.infNFe, new RegExp('<vOrig>' + c.totais.vNFTot.toFixed(2) + '</vOrig>'));
  const regras27 = { '010043': regraVenda('5102', '00', '06'), '250011': regraVenda('5405', '60', '06') };
  const base = { pedido, empresa: cliente, emitente, ambiente: 'homologacao', serie: 2, numero: 31, emissao: EM27 };
  assert.ok(PD.notaDoPedido(Object.assign({ regras: regras27 }, base)).avisos.bloqueia.some(x => /falta configurar a alíquota da CBS/.test(x)));
  assert.ok(PD.notaDoPedido(Object.assign({ regras, cfg: { reforma2027: REF27 } }, base)).avisos.bloqueia.some(x => /PIS e a COFINS acabam em 2027/.test(x)));
  const r = PD.notaDoPedido(Object.assign({ regras: regras27, cfg: { reforma2027: ref } }, base));
  assert.deepStrictEqual(r.avisos.bloqueia, []);
  assert.ok(r.avisos.conferir.some(x => /32931\/2026\): confirmado com o contador/.test(x)));
  const mm = N.monta(r.nota);
  assert.strictEqual(r.cobrar, mm.totais.vNFTot);
  assert.strictEqual(r.nota.cobranca.duplicatas.reduce((s, d) => s + d.valor, 0).toFixed(2), mm.totais.vNFTot.toFixed(2));
  assert.strictEqual(r.nota.pagamento[0].valor, mm.totais.vNFTot);
  const desl = PD.notaDoPedido(Object.assign({ regras: regras27, cfg: { reforma2027: REF27 } }, base));
  assert.strictEqual(desl.cobrar, desl.total);
  assert.ok(desl.avisos.conferir.some(x => /fora da base do ICMS: a Sefaz-SP entende/.test(x)));
});

test('XML de 2027 (com e sem IBS/CBS na base do ICMS) passa no esquema oficial; a DANFE mostra o total com IBS/CBS', { skip: !temFerramentas && 'sem xmllint/openssl' }, () => {
  const A = require('../servico-fiscal/assinatura.js'), D = require('../danfe.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-teste-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=TESTE'], { stdio: 'pipe' });
    const keyPem = fs.readFileSync(path.join(dir, 'k.pem'), 'utf8'), certPem = fs.readFileSync(path.join(dir, 'c.pem'), 'utf8');
    for (const ref of [REF27, Object.assign({ icmsComIbsCbs: true, cobrarPorFora: true }, REF27)]) {
      const c = N.calcula(nota27(ref, { frete: { modFrete: 0, valor: 12.5 } }));
      const m = N.monta(nota27(ref, { ambiente: 'producao', frete: { modFrete: 0, valor: 12.5 }, cobranca: { duplicatas: [{ vencimento: '2027-02-03', valor: c.totais.vCobrar }] } }));
      const nfe = N.nfeCompleta(m.infNFe, A.assinaElemento(m.infNFe, m.id, certPem, keyPem));
      const f = path.join(dir, 'n.xml'); fs.writeFileSync(f, nfe);
      const r = spawnSync('xmllint', ['--noout', '--schema', path.join(ESQ, 'nfe_v4.00.xsd'), f]);
      assert.strictEqual(r.status, 0, String(r.stderr));
      const d = D.ler(nfe);
      assert.deepStrictEqual(d.reforma, { vIBS: m.totais.ibscbs.vIBS, vCBS: m.totais.ibscbs.vCBS, vNFTot: m.totais.vNFTot });
      assert.strictEqual(d.totais.vNF, m.totais.vNF);
      assert.strictEqual(d.totais.vBC, m.totais.vBC);
      const { jsPDF } = require('../vendor/jspdf.umd.min.js');
      assert.strictEqual(D.desenha(new jsPDF({ unit: 'mm', format: 'a4' }), d), 1);   // a linha do IBS/CBS cabe na folha
    }
    assert.strictEqual(D.ler(N.nfeCompleta(N.monta(nota()).infNFe, '')).reforma, null);   // 2026: sem a linha nova
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('DIFAL: venda a não contribuinte do RS (6108, 12%, ICMSUFDest) passa no esquema; contribuinte de fora e UF sem alíquota bloqueiam', { skip: !temFerramentas && 'sem xmllint/openssl' }, () => {
  assert.deepStrictEqual([PD.aliqInter('SP', 'RS', 0), PD.aliqInter('SP', 'BA', 0), PD.aliqInter('SP', 'ES', 0), PD.aliqInter('SP', 'MG', 1)], [12, 7, 7, 4]);
  const rs = Object.assign({}, cliente, { cnpj: '123.456.789-09', ie: '', ind_ie: '9', uf: 'RS', cidade: 'PORTO ALEGRE', codigo_municipio: '4314902', cep: '90010-000' });
  const ped = Object.assign({}, pedido, { itens: [pedido.itens[0]] });
  const cfg = { difal: { RS: { aliq: 17, fcp: 0, conferido: true } } };
  const r = PD.notaDoPedido({ pedido: ped, empresa: rs, regras, emitente, ambiente: 'homologacao', serie: 2, numero: 40, emissao: '2026-10-23T10:00:00-03:00', cfg });
  assert.deepStrictEqual(r.avisos.bloqueia, []);
  const it = r.nota.itens[0];
  assert.deepStrictEqual([it.cfop, it.icms.cst, it.icms.aliquota, r.nota.natOp], ['6108', '00', 12, 'VENDA FORA DO ESTADO']);
  // 2 × 67,84 = 135,68: ICMS 12% = 16,28; DIFAL = 135,68 × 17% (23,07) − 16,28 = 6,79
  assert.deepStrictEqual(r.difal, { uf: 'RS', valor: 6.79, icms: 6.79, fcp: 0, aliq: 17 });
  assert.ok(r.avisos.conferir.some(x => /DIFAL de R\$ 6,79 .*GNRE ao RS/.test(x)));
  const m = N.monta(r.nota);
  assert.ok(/<idDest>2<\/idDest>/.test(m.infNFe) && /<ICMSUFDest><vBCUFDest>135.68<\/vBCUFDest><pICMSUFDest>17.00<\/pICMSUFDest><pICMSInter>12.00<\/pICMSInter><pICMSInterPart>100.0000<\/pICMSInterPart><vICMSUFDest>6.79<\/vICMSUFDest><vICMSUFRemet>0.00<\/vICMSUFRemet><\/ICMSUFDest>/.test(m.infNFe), 'grupo do item');
  assert.ok(/<vICMSDeson>0.00<\/vICMSDeson><vFCPUFDest>0.00<\/vFCPUFDest><vICMSUFDest>6.79<\/vICMSUFDest><vICMSUFRemet>0.00<\/vICMSUFRemet>/.test(m.infNFe), 'totais');
  assert.ok(/ICMS DIFAL DEVIDO A UF DE DESTINO \(RS\): R\$ 6.79/.test(m.infNFe), 'texto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-difal-'));
  try {
    const f = path.join(dir, 'n.xml'); fs.writeFileSync(f, N.nfeCompleta(m.infNFe, '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI="#' + m.id + '"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>AAAA</DigestValue></Reference></SignedInfo><SignatureValue>AAAA</SignatureValue><KeyInfo><X509Data><X509Certificate>AAAA</X509Certificate></X509Data></KeyInfo></Signature>'));
    const v = spawnSync('xmllint', ['--noout', '--schema', path.join(ESQ, 'nfe_v4.00.xsd'), f]);
    assert.strictEqual(v.status, 0, String(v.stderr));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  // contribuinte de fora de SP, UF sem alíquota e produto com ST retida: bloqueia
  const contrib = PD.notaDoPedido({ pedido: ped, empresa: Object.assign({}, rs, { ind_ie: '1', ie: '1234567890' }), regras, emitente, ambiente: 'homologacao', serie: 2, numero: 41, emissao: '2026-10-23T10:00:00-03:00', cfg });
  assert.ok(contrib.avisos.bloqueia.some(x => /com inscrição estadual/.test(x)));
  const semAliq = PD.notaDoPedido({ pedido: ped, empresa: Object.assign({}, rs, { uf: 'PR' }), regras, emitente, ambiente: 'homologacao', serie: 2, numero: 42, emissao: '2026-10-23T10:00:00-03:00', cfg });
  assert.ok(semAliq.avisos.bloqueia.some(x => /falta a alíquota interna do PR/.test(x)));
  const comSt = PD.notaDoPedido({ pedido, empresa: rs, regras, emitente, ambiente: 'homologacao', serie: 2, numero: 43, emissao: '2026-10-23T10:00:00-03:00', cfg });
  assert.ok(comSt.avisos.bloqueia.some(x => /250011 .*ICMS-ST já retido em SP/.test(x)));
  // nota de outra UF sem o DIFAL não monta
  assert.throws(() => N.monta(Object.assign({}, r.nota, { itens: r.nota.itens.map(x => Object.assign({}, x, { difal: undefined })) })), /sem o DIFAL/);
});
