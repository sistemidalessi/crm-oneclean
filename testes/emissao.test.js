'use strict';
// Emissão de NF-e pelo CRM (Fase 4, telas): emitente lido do XML, conferências, fechamento do mês e o ZIP.
// Dados fictícios.
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../emissao.js');
const N = require('../servico-fiscal/nfe.js');

const emitente = { cnpj: '11222333000181', ie: '111222333444', razao: 'EMPRESA DE TESTE LTDA', fantasia: 'TESTE', crt: 3,
  endereco: { logradouro: 'RUA DOS TESTES', numero: '100', bairro: 'CENTRO', cMun: '3548708', municipio: 'SAO BERNARDO DO CAMPO', uf: 'SP', cep: '09700000', fone: '1140000000' } };
const nota = {
  ambiente: 'producao', emitente, serie: 1, numero: 2700, emissao: '2026-10-15T10:15:00-03:00', cNF: '12345678', natOp: 'VENDA DE MERCADORIA', indFinal: 1, indPres: 9,
  dest: { doc: '22333444000172', nome: 'CLIENTE & CIA', ie: '222333444555', indIEDest: 1, endereco: { logradouro: 'AV. EXEMPLO', numero: '50', bairro: 'JARDIM', cMun: '3550308', municipio: 'SAO PAULO', uf: 'SP', cep: '01436000' } },
  itens: [{ codigo: '010043', descricao: 'DETERGENTE 5L', ncm: '34022000', cfop: '5102', unidade: 'GL', quantidade: 1, valorUnitario: 10, origem: 0,
    icms: { cst: '00', aliquota: 18 }, pis: { cst: '01', aliquota: 1.65 }, cofins: { cst: '01', aliquota: 7.6 } }],
  frete: { modFrete: 0, valor: 0 }, pagamento: [{ tPag: '17', indPag: 0, valor: 10 }]
};

test('emitente e opções lidos do XML de uma nota do FKN', () => {
  const xml = '<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe1" versao="4.00">' + N.monta(nota).infNFe.replace(/^<infNFe[^>]*>/, '') + '</NFe></nfeProc>';
  const d = M.emitenteDoXml(xml);
  assert.deepStrictEqual(d.emitente, Object.assign({}, emitente, { endereco: Object.assign({ complemento: null }, emitente.endereco) }));
  assert.deepStrictEqual([d.natOp, d.indFinal, d.indPres, d.serie, d.numero, d.homologacao], ['VENDA DE MERCADORIA', 1, 9, 1, 2700, false]);
  assert.deepStrictEqual(M.faltasEmitente(d), []);
  assert.strictEqual(M.emitenteDoXml('<nada/>'), null);
});

test('o que falta no emitente', () => {
  assert.deepStrictEqual(M.faltasEmitente({}), ['CNPJ', 'inscrição estadual', 'razão social', 'endereço (rua, número e bairro)', 'código IBGE do município (7 números)', 'UF', 'CEP']);
  const e = JSON.parse(JSON.stringify(emitente)); e.endereco.cMun = '354870';
  assert.deepStrictEqual(M.faltasEmitente({ emitente: e }), ['código IBGE do município (7 números)']);
});

test('emitente com CNPJ alfanumérico (IN RFB 2.229/2024): as letras não somem', () => {
  const e = Object.assign({}, emitente, { cnpj: '12.ABC.345/01DE-35' });
  const xml = '<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe1" versao="4.00">' + N.monta(Object.assign({}, nota, { emitente: e })).infNFe.replace(/^<infNFe[^>]*>/, '') + '</NFe></nfeProc>';
  const d = M.emitenteDoXml(xml);
  assert.strictEqual(d.emitente.cnpj, '12ABC34501DE35');
  assert.deepStrictEqual(M.faltasEmitente(d), []);
  assert.strictEqual(M.doc('12.abc.345/01de-35'), '12ABC34501DE35');
  assert.deepStrictEqual(M.faltasEmitente({ emitente: Object.assign({}, emitente, { cnpj: '12ABC34501DEXX' }) }).slice(0, 1), ['CNPJ']);
});

test('justificativa e correção: de 15 a 255 / 1000 letras', () => {
  assert.match(M.confereTexto('curto', 'cancelar'), /15 letras/);
  assert.strictEqual(M.confereTexto('pedido cancelado pelo cliente', 'cancelar'), null);
  assert.match(M.confereTexto('x'.repeat(256), 'cancelar'), /255/);
  assert.strictEqual(M.confereTexto('x'.repeat(900), 'cce'), null);
  assert.match(M.confereTexto('pouco', 'cce'), /a correção/);
});

test('situação: inutilizada vence o resto; horas e mês no horário de SP', () => {
  assert.strictEqual(M.situacaoDe({ situacao: 'rejeitada', inutilizada_em: '2026-10-16' }), 'inutilizada');
  assert.strictEqual(M.situacaoDe({ situacao: 'pendente' }), 'pendente');
  assert.strictEqual(M.mesSP('2026-11-01T02:30:00Z'), '2026-10');   // 23:30 de 31/10 em SP
  assert.strictEqual(Math.round(M.horasDesde('2026-10-16T10:00:00Z', Date.parse('2026-10-17T12:00:00Z'))), 26);
});

const nfes = [
  { id: 'a', ambiente: 'producao', serie: 2, numero: 2, chave: 'C2', situacao: 'autorizada', autorizada_em: '2026-10-05T13:00:00Z', valor: 100, proc_xml: '<a/>', eventos: [
    { tipo: 'cce', seq: 1, protocolo: 'P1', quando: '2026-10-05T14:00:00Z', texto: 'correção do volume', xml: '<cce/>' }] },
  { id: 'b', ambiente: 'producao', serie: 2, numero: 1, chave: 'C1', situacao: 'cancelada', autorizada_em: '2026-10-04T13:00:00Z', valor: 50, proc_xml: '<b/>', eventos: [
    { tipo: 'cancelar', seq: 1, protocolo: 'P2', quando: '2026-10-04T15:00:00Z', texto: 'cliente desistiu; antes da entrega', xml: '<canc/>' }] },
  { id: 'c', ambiente: 'homologacao', serie: 2, numero: 9, chave: 'C9', situacao: 'autorizada', autorizada_em: '2026-10-05T13:00:00Z', valor: 70, proc_xml: '<h/>', eventos: [] },
  { id: 'd', ambiente: 'producao', serie: 2, numero: 3, chave: 'C3', situacao: 'rejeitada', autorizada_em: null, valor: 70, eventos: [] },
  { id: 'e', ambiente: 'producao', serie: 2, numero: 4, chave: 'C4', situacao: 'autorizada', autorizada_em: '2026-11-01T04:00:00Z', valor: 70, proc_xml: '<n/>', eventos: [] }
];
const inuts = [{ ambiente: 'producao', serie: 2, de: 3, ate: 3, cstat: 102, protocolo: 'P3', justificativa: 'número pulado sem nota', criado_em: '2026-10-20T12:00:00Z', xml: '<inut/>' },
  { ambiente: 'producao', serie: 2, de: 5, ate: 6, cstat: 241, criado_em: '2026-10-20T12:00:00Z' }];

test('fechamento do mês: só produção, autorizadas e canceladas com os eventos, inutilizações aceitas e a relação', () => {
  const r = M.fechamento(nfes, inuts, '2026-10');
  assert.deepStrictEqual([r.notas, r.autorizadas, r.canceladas, r.inutilizadas, r.valor], [2, 1, 1, 1, 100]);
  assert.deepStrictEqual(r.arquivos.map(a => a.nome), ['NFeC1-procNFe.xml', 'NFeC1-procEventoCanc.xml', 'NFeC2-procNFe.xml', 'NFeC2-procEventoCCe1.xml',
    'Inut-serie2-3-procInutNFe.xml', 'relacao-canceladas-inutilizadas-2026-10.csv']);
  assert.deepStrictEqual(r.linhas, [['CANCELADA', 2, 1, 'C1', '04/10/2026', 'P2', 'cliente desistiu; antes da entrega'], ['INUTILIZADA', 2, 3, '', '20/10/2026', 'P3', 'número pulado sem nota']]);
  assert.match(r.arquivos[5].conteudo, /"cliente desistiu; antes da entrega"/);   // ";" dentro do texto vai entre aspas
  assert.strictEqual(M.fechamento(nfes, inuts, '2026-11').notas, 1);               // 01h de 01/11 em SP
});

test('ZIP: abre com outro programa, com o conteúdo e os nomes certos (UTF-8)', () => {
  assert.strictEqual(M.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const arqs = [{ nome: 'NFe1-procNFe.xml', conteudo: '<a>ação</a>' }, { nome: 'relação.csv', conteudo: '﻿Tipo;Série\r\n' }];
  const z = M.zip(arqs, new Date(2026, 9, 16, 10, 30, 0));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-')), f = path.join(dir, 't.zip');
  fs.writeFileSync(f, z);
  const py = spawnSync('python3', ['-I', '-c', 'import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps([[i.filename, z.read(i).decode("utf-8"), i.date_time[:5]] for i in z.infolist()]))', f], { encoding: 'utf8' });
  if (py.status !== 0 && /No such file|not found/i.test(py.stderr || '')) return;   // sem python, pula
  assert.strictEqual(py.status, 0, py.stderr);
  assert.deepStrictEqual(JSON.parse(py.stdout), [['NFe1-procNFe.xml', '<a>ação</a>', [2026, 10, 16, 10, 30]], ['relação.csv', '﻿Tipo;Série\r\n', [2026, 10, 16, 10, 30]]]);
});

test('tabela do IBPT: só NCM (tipo 0), datas e chave', () => {
  const csv = 'codigo;ex;tipo;descricao;nacionalfederal;importadosfederal;estadual;municipal;vigenciainicio;vigenciafim;chave;versao;fonte\r\n' +
    '48181000;;0;"Papel higienico";13.45;28.04;18.00;0.00;20/08/2026;30/09/2026;A906AF;26.2.A;IBPT/empresometro.com.br\r\n' +
    '40151900;01;0;"De seguranca; e protecao";13.45;16.98;18.00;0.00;20/08/2026;30/09/2026;A906AF;26.2.A;IBPT/empresometro.com.br\r\n' +
    '3901;;2;"Servicos";13.45;15.45;0.00;4.19;20/08/2026;30/09/2026;A906AF;26.2.A;IBPT/empresometro.com.br\r\n';
  const t = M.lerIbpt(csv);
  assert.deepStrictEqual([t.linhas.length, t.versao, t.chave, t.vig_ini, t.vig_fim], [2, '26.2.A', 'A906AF', '2026-08-20', '2026-09-30']);
  assert.deepStrictEqual(t.linhas[1], { codigo: '40151900', ex: '01', descricao: 'De seguranca; e protecao', nac_fed: 13.45, imp_fed: 16.98, estadual: 18, municipal: 0,
    vig_ini: '2026-08-20', vig_fim: '2026-09-30', chave: 'A906AF', versao: '26.2.A', fonte: 'IBPT/empresometro.com.br' });
  assert.throws(() => M.lerIbpt('outra coisa;x'), /não parece a tabela do IBPT/);
});

test('regra de 2027 (aba Fiscal → Emissão): o formulário grava o que o serviço fiscal lê, com os mesmos padrões', () => {
  assert.deepStrictEqual(M.REFORMA_PADRAO, { pIBSUF: N.REFORMA_2027.pIBSUF, pIBSMun: N.REFORMA_2027.pIBSMun });
  // vazio: CBS não definida, IBS no padrão, as duas opções desligadas
  const vazio = M.reformaDoForm({ pCBS: null, pIBSUF: null, pIBSMun: null });
  assert.deepStrictEqual(vazio, { pCBS: null, pIBSUF: 0.05, pIBSMun: 0.05, icmsComIbsCbs: false, cobrarPorFora: false });
  assert.throws(() => N.calcula({ emissao: '2027-01-04T09:00:00-03:00', reforma: vazio, itens: [{ quantidade: 1, valorUnitario: 10, icms: { cst: '60' }, pis: { cst: '06' }, cofins: { cst: '06' } }] }), /alíquota da CBS/);
  const cheio = M.reformaDoForm({ pCBS: '8,8', pIBSUF: 0.05, pIBSMun: 0.05, icmsComIbsCbs: true, cobrarPorFora: true });
  assert.deepStrictEqual(cheio, { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05, icmsComIbsCbs: true, cobrarPorFora: true });
  const c = N.calcula({ emissao: '2027-01-04T09:00:00-03:00', reforma: cheio, itens: [{ quantidade: 1, valorUnitario: 135.68, icms: { cst: '00', aliquota: 18 }, pis: { cst: '06' }, cofins: { cst: '06' } }] });
  assert.deepStrictEqual([c.itens[0].icms.v, c.totais.vCobrar], [26.18, c.totais.vNFTot]);   // o serviço entende o que a tela grava
  assert.throws(() => M.reformaDoForm({ pCBS: 0 }), /deixe vazio/);
  assert.throws(() => M.reformaDoForm({ pCBS: 45 }), /entre 0 e 30/);
  assert.throws(() => M.reformaDoForm({ pCBS: 8.8, pIBSUF: -1 }), /IBS estadual/);
  const r0 = M.resumoReforma(undefined), r1 = M.resumoReforma(cheio);
  assert.deepStrictEqual([r0.pronta, r1.pronta], [false, true]);
  assert.match(r0.linhas.join('|'), /não definida.*0,05% estadual \+ 0,05% municipal.*desligado até o contador.*sem o IBS e a CBS/);
  assert.match(r1.linhas.join('|'), /CBS: 8,8%.*sim \(Resposta à Consulta Sefaz-SP 32931\/2026\).*com o IBS e a CBS/);
});
