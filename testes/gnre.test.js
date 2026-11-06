'use strict';
// GNRE do DIFAL (06/11/2026): o lote e as consultas passam nos esquemas oficiais do Portal GNRE (servico-fiscal/esquemas/gnre),
// e as respostas (recepção, resultado com a guia, recusa) são lidas. Dados fictícios.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const G = require('../servico-fiscal/gnre.js');

const temXmllint = spawnSync('xmllint', ['--version']).status === 0;
const ESQ = path.join(__dirname, '..', 'servico-fiscal', 'esquemas', 'gnre');
const CHAVE = '35261111222333000181550010000028621000000010';
const EMIT = { cnpj: '11.222.333/0001-81', razao: 'EMPRESA EXEMPLO DE LIMPEZA LTDA', endereco: { logradouro: 'Rua Exemplo', numero: '100', cMun: '3548708', uf: 'SP', cep: '09700-000', fone: '(11) 4000-0000' } };
const GUIA = { uf: 'RS', receita: '100102', docTipo: '22', chave: CHAVE, valor: 52.3, valorFcp: 0, vencimento: '2026-11-06', pagamento: '2026-11-06', referencia: { mes: 11, ano: 2026 },
  destinatario: { cpf: '123.456.789-09', nome: 'Fulano de Tal', cMun: '4314902' }, camposExtras: [{ codigo: '74', valor: CHAVE }], identificador: '2862' };

const valida = (xml, xsd) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnre-teste-')), f = path.join(dir, 'm.xml');
  fs.writeFileSync(f, xml);
  const r = spawnSync('xmllint', ['--noout', '--schema', path.join(ESQ, xsd), f]);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(r.status, 0, xsd + ': ' + String(r.stderr));
};

test('lote, consulta do resultado e configuração da UF passam nos esquemas oficiais', { skip: !temXmllint && 'sem xmllint' }, () => {
  valida(G.montaLote(EMIT, [GUIA]), 'lote_gnre_v2.00.xsd');
  valida(G.montaLote(EMIT, [Object.assign({}, GUIA, { fcpJunto: true, valorFcp: 5.23, destinatario: { cnpj: '11.222.333/0001-81', nome: 'Outra Empresa', cMun: '4314902' } })]), 'lote_gnre_v2.00.xsd');
  valida(G.montaLote(EMIT, [Object.assign({}, GUIA, { referencia: null, camposExtras: [], identificador: null })]), 'lote_gnre_v2.00.xsd');
  valida(G.msgResultado('producao', '2611060001'), 'lote_gnre_consulta_v1.00.xsd');
  valida(G.msgConfigUF('producao', 'RS', '100102'), 'consulta_config_uf_v1.00.xsd');
});

test('o lote leva só o CNPJ do emitente (sem a IE de SP), município com 5 dígitos e nada entre as tags', () => {
  const x = G.montaLote(EMIT, GUIA);
  assert.match(x, /^<TLote_GNRE xmlns="http:\/\/www\.gnre\.pe\.gov\.br" versao="2\.00"><guias><TDadosGNRE versao="2\.00"><ufFavorecida>RS<\/ufFavorecida><tipoGnre>0<\/tipoGnre>/);
  assert.match(x, /<contribuinteEmitente><identificacao><CNPJ>11222333000181<\/CNPJ><\/identificacao><razaoSocial>EMPRESA EXEMPLO DE LIMPEZA LTDA<\/razaoSocial><endereco>Rua Exemplo, 100<\/endereco><municipio>48708<\/municipio><uf>SP<\/uf><cep>09700000<\/cep><telefone>1140000000<\/telefone><\/contribuinteEmitente>/);
  assert.ok(!/<IE>/.test(x));
  assert.match(x, /<documentoOrigem tipo="22">35261111222333000181550010000028621000000010<\/documentoOrigem>/);
  assert.match(x, /<valor tipo="11">52\.30<\/valor><valor tipo="21">52\.30<\/valor>/);
  assert.match(x, /<contribuinteDestinatario><identificacao><CPF>12345678909<\/CPF><\/identificacao><razaoSocial>Fulano de Tal<\/razaoSocial><municipio>14902<\/municipio><\/contribuinteDestinatario>/);
  assert.match(x, /<campoExtra><codigo>74<\/codigo><valor>35261111222333000181550010000028621000000010<\/valor><\/campoExtra>/);
  assert.match(x, /<valorGNRE>52\.30<\/valorGNRE><dataPagamento>2026-11-06<\/dataPagamento><identificadorGuia>2862<\/identificadorGuia><\/TDadosGNRE><\/guias><\/TLote_GNRE>$/);
  assert.ok(!/>\s+</.test(x), 'sem espaço entre as tags');
  const f = G.montaLote(EMIT, Object.assign({}, GUIA, { fcpJunto: true, valorFcp: 5 }));
  assert.match(f, /<valor tipo="11">52\.30<\/valor><valor tipo="12">5\.00<\/valor><valor tipo="21">57\.30<\/valor><valor tipo="22">5\.00<\/valor>/);
  assert.match(f, /<valorGNRE>57\.30<\/valorGNRE>/);
  assert.throws(() => G.montaLote(EMIT, Object.assign({}, GUIA, { valor: 0 })), /valor/);
  assert.throws(() => G.montaLote({ cnpj: '' }, GUIA), /CNPJ/);
  assert.throws(() => G.montaLote(EMIT, Object.assign({}, GUIA, { pagamento: '06/11/2026' })), /datas/);
});

test('o envelope SOAP 1.2 leva o cabeçalho com a versão e o XML dentro do gnreDadosMsg', () => {
  const e = G.envelope('GnreLoteRecepcao', '<x/>', '2.00');
  assert.match(e, /^<soap:Envelope xmlns:soap="http:\/\/www\.w3\.org\/2003\/05\/soap-envelope" xmlns:gnr="http:\/\/www\.gnre\.pe\.gov\.br\/webservice\/GnreLoteRecepcao">/);
  assert.match(e, /<gnr:gnreCabecMsg xmlns="http:\/\/www\.gnre\.pe\.gov\.br\/webservice\/GnreLoteRecepcao"><versaoDados>2\.00<\/versaoDados><\/gnr:gnreCabecMsg>/);
  assert.match(e, /<gnr:gnreDadosMsg xmlns="http:\/\/www\.gnre\.pe\.gov\.br\/webservice\/GnreLoteRecepcao"><x\/><\/gnr:gnreDadosMsg>/);
});

test('lê a recepção, o resultado com a guia e a recusa', () => {
  const rec = G.leRecepcao('<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><ns1:processarResponse xmlns:ns1="http://www.gnre.pe.gov.br/webservice/GnreLoteRecepcao">' +
    '<ns1:TRetLote_GNRE xmlns="http://www.gnre.pe.gov.br"><ns1:ambiente>1</ns1:ambiente><ns1:situacaoRecepcao><ns1:codigo>100</ns1:codigo><ns1:descricao>Lote recebido com Sucesso</ns1:descricao></ns1:situacaoRecepcao>' +
    '<ns1:recibo><ns1:numero>2611060001</ns1:numero><ns1:dataHoraRecibo>2026-11-06 10:00:00</ns1:dataHoraRecibo><ns1:tempoEstimadoProc>5000</ns1:tempoEstimadoProc></ns1:recibo></ns1:TRetLote_GNRE></ns1:processarResponse></soap:Body></soap:Envelope>');
  assert.deepStrictEqual([rec.codigo, rec.recibo, rec.tempo], [100, '2611060001', 5000]);
  const ok = G.leResultado('<soap:Envelope><soap:Body><ns1:gnreRespostaMsg><TResultLote_GNRE xmlns="http://www.gnre.pe.gov.br"><ambiente>1</ambiente><numeroRecibo>2611060001</numeroRecibo>' +
    '<situacaoProcess><codigo>402</codigo><descricao>Lote processado com sucesso</descricao></situacaoProcess><resultado><guia versao="2.00"><situacaoGuia>0</situacaoGuia><ufFavorecida>RS</ufFavorecida>' +
    '<valorGNRE>52.30</valorGNRE><dataLimitePagamento>2026-11-06</dataLimitePagamento><identificadorGuia>2862</identificadorGuia><nossoNumero>1234567890123456</nossoNumero>' +
    '<linhaDigitavel>85800000000-1 52300301102-2 61106000000-3 00000000000-4</linhaDigitavel><codigoBarras>85800000000523003011026110600000000000000000</codigoBarras><qrcodePayload>00020101PIX</qrcodePayload></guia>' +
    '<pdfGuias>JVBERi0x\nLjQ=</pdfGuias></resultado></TResultLote_GNRE></ns1:gnreRespostaMsg></soap:Body></soap:Envelope>');
  assert.strictEqual(ok.codigo, 402);
  assert.strictEqual(ok.guias.length, 1);
  assert.deepStrictEqual([ok.guias[0].situacao, ok.guias[0].identificador, ok.guias[0].numeroControle, ok.guias[0].codigoBarras.length, ok.guias[0].linhaDigitavel.length, ok.guias[0].pix, ok.guias[0].valor],
    ['0', '2862', '1234567890123456', 44, 48, '00020101PIX', 52.3]);
  assert.strictEqual(ok.pdf, 'JVBERi0xLjQ=');
  assert.ok(!/JVBERi0x/.test(ok.bruto), 'o PDF não vai para o registro');
  const ruim = G.leResultado('<TResultLote_GNRE><situacaoProcess><codigo>403</codigo><descricao>Processado com pendência</descricao></situacaoProcess><resultado><guia versao="2.00"><situacaoGuia>1</situacaoGuia>' +
    '<identificadorGuia>2862</identificadorGuia><motivosRejeicao><motivo><codigo>226</codigo><descricao>Data de pagamento menor que a data atual</descricao><campo>dataPagamento</campo></motivo></motivosRejeicao></guia></resultado></TResultLote_GNRE>');
  assert.strictEqual(ruim.codigo, 403);
  assert.deepStrictEqual(ruim.guias[0].motivos, [{ codigo: '226', descricao: 'Data de pagamento menor que a data atual', campo: 'dataPagamento' }]);
  assert.strictEqual(ruim.pdf, null);
});

test('a rota recusa ação desconhecida e recibo inválido', async () => {
  assert.throws(() => G.rota({}, { acao: 'pagar' }), /desconhecida/);
  await assert.rejects(G.resultado({ ambiente: 'producao' }, '123'), /recibo/);
});

test('o robô monta as guias do RS pela nota (DIFAL e, com FCP, a guia própria 100129) e lê o resultado do lote', async () => {
  const R = await import('../supabase/functions/crm-gnre/guia.js');
  const nfe = { id: 'x', ambiente: 'producao', serie: 1, numero: 2862, chave: CHAVE, totais: { vICMSUFDest: 3.94, vFCPUFDest: 0 },
    nota: { dest: { doc: '24912562000170', nome: 'Cliente de Porto Alegre', endereco: { uf: 'RS', cMun: '4314902' } } } };
  const cfg = { gnre: {}, fiscal: { emitente: EMIT } };
  const m = R.montaGuias(nfe, cfg, '2026-11-06');
  assert.strictEqual(m.erro, undefined);
  assert.strictEqual(m.guias.length, 1);
  const g = m.guias[0].guia;
  assert.deepStrictEqual([m.uf, m.guias[0].valor, m.ambiente, g.receita, g.docTipo, g.identificador, g.destinatario.cnpj, g.referencia], ['RS', 3.94, 'producao', '100102', '22', '2862', '24912562000170', null]);
  assert.deepStrictEqual(g.camposExtras, [{ codigo: '74', valor: CHAVE }]);
  if (temXmllint) valida(G.montaLote(m.emitente, [g]), 'lote_gnre_v2.00.xsd');
  // aromatizante para o RS: 25% + FCP 2% (AMPARA) → duas guias, cada uma com o seu valor
  const f = R.montaGuias(Object.assign({}, nfe, { totais: { vICMSUFDest: 10.5, vFCPUFDest: 1.5 } }), cfg, '2026-11-06');
  assert.deepStrictEqual(f.guias.map(x => [x.receita, x.valor, x.guia.valor, x.guia.fcpJunto]), [['100102', 10.5, 10.5, false], ['100129', 1.5, 1.5, false]]);
  if (temXmllint) valida(G.montaLote(f.emitente, [f.guias[1].guia]), 'lote_gnre_v2.00.xsd');
  const j = R.montaGuias(Object.assign({}, nfe, { totais: { vICMSUFDest: 10.5, vFCPUFDest: 1.5 } }), { gnre: { uf: { RS: { fcp: 'junto' } } }, fiscal: cfg.fiscal }, '2026-11-06');
  assert.deepStrictEqual(j.guias.map(x => [x.receita, x.valor, x.guia.fcpJunto]), [['100102', 12, true]]);
  assert.match(R.montaGuias(Object.assign({}, nfe, { nota: { dest: { endereco: { uf: 'SP' } } } }), cfg, '2026-11-06').erro, /não é para outra UF/);
  assert.match(R.montaGuias(Object.assign({}, nfe, { nota: { dest: { endereco: { uf: 'MG' } } } }), cfg, '2026-11-06').erro, /ainda não foi conferida/);
  assert.match(R.montaGuias(Object.assign({}, nfe, { totais: { vICMSUFDest: 3, vFCPUFDest: 1 } }), { gnre: { uf: { RS: { fcp: null } } }, fiscal: cfg.fiscal }, '2026-11-06').erro, /FCP/);
  assert.strictEqual(R.montaGuias(Object.assign({}, nfe, { ambiente: 'homologacao' }), cfg, '2026-11-06').ambiente, 'homologacao');
  assert.strictEqual(R.situacaoDoResultado({ codigo: 401 }).situacao, 'enviada');
  const ok = R.situacaoDoResultado({ codigo: 402, guias: [{ situacao: '0', codigoBarras: '8'.repeat(44), linhaDigitavel: '8'.repeat(48) }] });
  assert.strictEqual(ok.situacao, 'gerada');
  assert.match(R.situacaoDoResultado({ codigo: 403, guias: [{ situacao: '2', motivos: [{ codigo: '202', descricao: 'IE de outra UF' }] }] }).motivo, /a UF recusou a guia: 202 IE de outra UF/);
  assert.strictEqual(R.situacaoDoResultado({ codigo: 403, guias: [{ situacao: '3', motivos: [] }] }).situacao, 'erro');
  assert.strictEqual(R.situacaoDoResultado({ codigo: 404, descricao: 'Erro no processamento' }).situacao, 'erro');
  const obs = R.textoObs('ICMS DIFAL…\nGNRE gerada pelo robô: antiga', { linhaDigitavel: '1'.repeat(48), numeroControle: '123', dataLimite: '2026-11-06' });
  assert.strictEqual(obs.split('\n').length, 2);
  assert.match(obs, /pagar até 06\/11\/2026/);
});
