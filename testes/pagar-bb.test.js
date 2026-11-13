'use strict';
// Pagamento de contas pela API Pagamentos em Lote do BB (04/11/2026): leitura do código colado, corpo dos lotes e situação.
// Dados fictícios (os códigos de teste são os da homologação do próprio BB).
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../pagamentos.js');
const L = require('../supabase/functions/crm-bb-pagar/lote.js');

const BOLETO = '00199161300000678350000003804880100000146417';
const LINHA = '00190000090380488010600001464171916130000067835';
const GUIA = '83690000001057200052858120735518020735512003';

test('linha digitável do boleto (47) vira o código de barras (44) e confere os dígitos', () => {
  assert.deepStrictEqual(P.codigoDeLinha(LINHA), { ok: true, tipo: 'boleto', codigo: BOLETO, valor: 678.35 });
  assert.deepStrictEqual(P.codigoDeLinha('0019.00000 90380.488010 60000.146417 1 91613000006783 5'.replace(/ (\d)$/, '$1')), P.codigoDeLinha(LINHA));
  assert.strictEqual(P.codigoDeLinha(BOLETO).codigo, BOLETO);
  // um número trocado no 2º campo
  assert.match(P.codigoDeLinha(LINHA.slice(0, 12) + '9' + LINHA.slice(13)).erro, /2º campo/);
  // dígito geral errado no código de barras
  assert.match(P.codigoDeLinha(BOLETO.slice(0, 4) + '2' + BOLETO.slice(5)).erro, /não confere/);
  assert.match(P.codigoDeLinha('123').erro, /3 números/);
});

test('guia / conta de consumo (48 → 44), com o dígito de cada bloco', () => {
  const blocos = [0, 1, 2, 3].map(i => GUIA.slice(i * 11, i * 11 + 11));
  const linha = blocos.map(b => b + P.mod10(b)).join('');
  assert.deepStrictEqual(P.codigoDeLinha(linha), { ok: true, tipo: 'guia', codigo: GUIA, valor: 105.72 });
  assert.match(P.codigoDeLinha(linha.slice(0, 20) + '0' + linha.slice(21)).erro || '', /bloco|não confere/);
  assert.strictEqual(P.codigoDeLinha(GUIA).tipo, 'guia');
});

test('o valor do código é o mesmo no site e na função', () => {
  [BOLETO, GUIA].forEach(c => assert.strictEqual(L.valorDoCodigo(c), P.valorDoCodigo(c)));
});

test('data do BB e o número grande do pagamento', () => {
  assert.strictEqual(L.dataBB('2026-11-05'), 5112026);
  assert.strictEqual(L.dataBB('2026-12-15'), 15122026);
  assert.strictEqual(L.isoDeBB(5112026), '2026-11-05');
  assert.strictEqual(L.isoDeBB(0), null);
  assert.deepStrictEqual(L.lerJson('{"identificadorPagamento": 90411002731030001, "valor": 12.34}'), { identificadorPagamento: '90411002731030001', valor: 12.34 });
});

test('situação do pagamento: número ou texto', () => {
  assert.strictEqual(L.estadoDe(5).chave, 'pago');
  assert.strictEqual(L.estadoDe('REJEITADO').chave, 'rejeitado');
  assert.strictEqual(L.estadoDe('CONSISTENTE').chave, 'consistente');
  assert.strictEqual(L.estadoDe('Aguardando Débito').chave, 'aguardando');
  assert.strictEqual(L.estadoDe('PAGO').pago, true);
  assert.strictEqual(L.estadoDe('DEBITADO').pago, true);
  assert.strictEqual(L.estadoDe('DEVOLVIDO').ativo, false);
  assert.strictEqual(L.estadoDe('xyz'), null);
});

const conta = (o) => Object.assign({ id: '11111111-2222-3333-4444-555555555555', tipo: 'saida', situacao: 'aberto', valor: 678.35, descricao: 'Fornecedor Exemplo — NF 123', pag_forma: 'boleto', pag_codigo: BOLETO, pag_doc: '11222333000181' }, o || {});

test('o que falta para pagar a conta', () => {
  assert.deepStrictEqual(L.pronto(conta()), { forma: 'boleto' });
  assert.match(L.pronto(conta({ pag_doc: null })).erro, /CNPJ/);
  assert.match(L.pronto(conta({ pag_codigo: null })).erro, /código/);
  assert.match(L.pronto(conta({ pag_forma: 'guia' })).erro, /não é de guia/);
  assert.match(L.pronto(conta({ situacao: 'pago' })).erro, /em aberto/);
  assert.match(L.pronto(conta({ pag_forma: null })).erro, /como pagar/);
  assert.match(L.pronto(conta({ pag_forma: 'pix' }), null).erro, /favorecido/);
  assert.deepStrictEqual(L.pronto(conta({ pag_forma: 'pix' }), { pix_tipo: 'email', pix_chave: 'a@b.c' }), { forma: 'pix' });
  // limite do BB por pagamento (13/11/2026: R$ 50 mil): acima dele não vai ao banco
  assert.match(L.pronto(conta({ valor: 50000.01 })).erro, /limite/);
  assert.deepStrictEqual(L.pronto(conta({ valor: 50000 })), { forma: 'boleto' });
  assert.match(L.pronto(conta({ valor: 1200 }), null, 1000).erro, /limite/);
  assert.deepStrictEqual(L.pronto(conta({ valor: 80000 }), null, 0), { forma: 'boleto' });
});

test('corpo do lote de boletos: juros entram como mora, desconto quando paga menos', () => {
  const c = L.corpoBoletos(100001, L.CONTA_TESTE, [{ conta: conta({ valor: 700 }), data: '2026-11-05' }]);
  assert.strictEqual(c.numeroRequisicao, 100001);
  assert.strictEqual(c.digitoVerificadorContaCorrenteDebito, 'X');
  const x = c.lancamentos[0];
  assert.strictEqual(x.numeroCodigoBarras, BOLETO);
  assert.strictEqual(x.dataPagamento, 5112026);
  assert.strictEqual(x.valorNominal, 678.35);
  assert.strictEqual(x.valorMoraMulta, 21.65);
  assert.strictEqual(x.valorDesconto, 0);
  assert.strictEqual(x.codigoTipoBeneficiario, 2);
  assert.strictEqual(x.documentoBeneficiario, 11222333000181);
  assert.strictEqual(x.descricaoPagamento, 'Fornecedor Exemplo NF 123');
  assert.ok(x.codigoSeuDocumento.length <= 20);
  assert.strictEqual(L.corpoBoletos(1, L.CONTA_TESTE, [{ conta: conta({ valor: 670 }), data: '2026-11-05' }]).lancamentos[0].valorDesconto, 8.35);
});

test('corpo do Pix: chave ou dados bancários', () => {
  const pix = (f) => L.corpoPix(100002, L.CONTA_TESTE, [{ conta: conta({ pag_forma: 'pix', valor: 12.34 }), fav: Object.assign({ nome: 'Exemplo' }, f), data: '2026-11-05' }]).listaTransferencias[0];
  assert.deepStrictEqual(pix({ pix_tipo: 'email', pix_chave: ' x@exemplo.com ' }), { data: 5112026, valor: 12.34, descricaoPagamento: 'Fornecedor Exemplo NF 123', descricaoPagamentoInstantaneo: 'Fornecedor Exemplo NF 123', formaIdentificacao: 2, email: 'x@exemplo.com' });
  assert.deepStrictEqual([pix({ pix_tipo: 'telefone', pix_chave: '+55 (11) 98888-7777' }).dddTelefone, pix({ pix_tipo: 'telefone', pix_chave: '11988887777' }).telefone], [11, 988887777]);
  assert.strictEqual(pix({ pix_tipo: 'documento', doc: '11222333000181' }).cnpj, 11222333000181);
  const c = pix({ pix_tipo: 'conta', compe: 341, agencia: 1234, conta: '56789', conta_dv: '0', tipo_conta: 1, doc: '12345678909' });
  assert.deepStrictEqual([c.formaIdentificacao, c.numeroCOMPE, c.agencia, c.conta, c.digitoVerificadorConta, c.cpf], [5, 341, 1234, 56789, '0', 12345678909]);
  assert.throws(() => pix({ pix_tipo: 'telefone', pix_chave: '9888' }), /DDD/);
  assert.strictEqual(L.corpoPix(1, L.CONTA_TESTE, []).tipoPagamento, 126);
});

test('resposta do envio e da consulta (formato real da homologação do BB)', () => {
  const r = L.itensDaResposta('boleto', L.lerJson('{"lancamentos":[{"codigoIdentificadorPagamento":"90411001731030001","indicadorAceite":"S","errorCodes":[0,0,0]}]}'));
  assert.deepStrictEqual(r, [{ aceito: true, identificador: '90411001731030001', erros: [] }]);
  const p = L.itensDaResposta('pix', L.lerJson('{"listaTransferencias":[{"identificadorPagamento":90411002731030001,"indicadorMovimentoAceito":"N","erros":[19]}]}'));
  assert.deepStrictEqual(p, [{ aceito: false, identificador: '90411002731030001', erros: [19] }]);
  const q = L.consultaDoItem(L.lerJson('{"id":90411001731030001,"estadoPagamento":"REJEITADO","dataPagamento":4112026,"codigoAutenticacaoPagamento":"","listaDevolucao":[{"codigoMotivo":253},{"codigoMotivo":250}]}'));
  assert.deepStrictEqual([q.estado.chave, q.pago_em, q.autenticacao, q.motivos], ['rejeitado', '2026-11-04', null, [253, 250]]);
  // o lote de guias responde com outros nomes (homologação, 04/11/2026)
  const g = L.lerJson('{"codigoEstado":1,"lancamentos":[{"codigoIdentificadorPagamento":"90267835731030001","indicadorAceite":"S","errors":[0,0]}]}');
  assert.deepStrictEqual(L.itensDaResposta('guia', g), [{ aceito: true, identificador: '90267835731030001', erros: [] }]);
  assert.strictEqual(L.estadoDoLote(g), 1);
  assert.strictEqual(L.estadoDoLote({ estadoRequisicao: 4 }), 4);
  assert.strictEqual(L.erroTexto(250), 'código de barras com dígito errado (250)');
  assert.strictEqual(L.erroTexto(999), 'erro 999');
});

test('separa os lotes por forma e data, no tamanho máximo', () => {
  const it = (forma, data) => ({ forma, data });
  const g = L.grupos([...Array(130)].map(() => it('boleto', '2026-11-05')).concat([it('pix', '2026-11-05'), it('boleto', '2026-11-06')]));
  assert.deepStrictEqual(g.map(x => [x.forma, x.data, x.itens.length]), [['boleto', '2026-11-05', 100], ['boleto', '2026-11-05', 30], ['pix', '2026-11-05', 1], ['boleto', '2026-11-06', 1]]);
});
