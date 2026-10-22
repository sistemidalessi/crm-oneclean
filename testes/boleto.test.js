// Boleto do BB emitido pelo CRM (22/10/2026): nosso número, código de barras, linha digitável, ITF e desenho.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../boleto.js');
const C = require('../cobranca.js');
const { jsPDF } = require('../vendor/jspdf.umd.min.js');

// Boleto real do BB (convênio da instalação), vencimento 19/10/2026, R$ 1.703,98
const REAL = '00190.00009 03804.880106 00001.399179 1 16040000170398';
const CFG = { convenio: '3804880', carteira: '17', variacao: '19', agencia: '1234-5', conta: '12345-6', multa_pct: 2, juros_mes_pct: 1, protesto_dias: 10 };
const EMIT = { razao: 'Empresa de Teste Ltda', cnpj: '12345678000199', endereco: { logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio: 'São Bernardo do Campo', uf: 'SP', cep: '09700000' } };

test('fator de vencimento: base nova de 22/02/2025', () => {
  assert.equal(B.fatorDe('2025-02-22'), '1000');
  assert.equal(B.fatorDe('2026-10-19'), '1604');
  assert.equal(C.dataDoFator(B.fatorDe('2027-03-15')), '2027-03-15');
  assert.equal(B.fatorDe('2025-02-21'), null);
  assert.equal(B.fatorDe('19/10/2026'), null);
});

test('monta a mesma linha digitável do boleto real do BB', () => {
  const nosso = B.nossoNumero('3804880', 1000001399);
  assert.equal(nosso, '38048801000001399');
  const cod = B.codigoBarras('001', '2026-10-19', 1703.98, B.campoLivre(nosso, '17'));
  assert.equal(cod.length, 44);
  assert.equal(C.linhaDeCodigo(cod), REAL.replace(/\D/g, ''));
  const l = C.lerLinha(C.linhaDeCodigo(cod));
  assert.equal(l.ok, true);
  assert.equal(l.vencimento, '2026-10-19');
  assert.equal(l.valor, 1703.98);
});

test('montar: dados do boleto, conferidos pela linha', () => {
  const d = B.montar(CFG, EMIT, { valor: 1703.98, vencimento: '2026-10-19', seq: 1000001399, documento: 'NF 2428/1', emissao: '2026-09-19' },
    { nome: 'Cliente Exemplo', doc: '98765432000155', endereco: { logradouro: 'Av B', numero: '2', cidade: 'Santo André', uf: 'SP', cep: '09000000' } }, { hoje: '2026-09-19' });
  assert.equal(d.linhaFmt, REAL);
  assert.equal(d.nossoNumero, '38048801000001399');
  assert.equal(d.carteira, '17');
  assert.equal(d.variacao, '019');
  assert.equal(d.nossoImpresso, '00038048801000001399-5'); // como no boleto real do BB
  assert.equal(d.agenciaCodigo, '1234-5/12345-6');
  assert.equal(d.beneficiario.doc, '12.345.678/0001-99');
  assert.equal(d.pagador.nome, 'CLIENTE EXEMPLO');
  assert.deepEqual(d.pagador.endereco, ['AV B 2', 'CEP: 09000-000, SANTO ANDRÉ - SP']);
  assert.deepEqual(d.instrucoes, ['JUROS: TAXA MENSAL DE 1,00% APÓS 19/10/2026', 'MULTA DE 2,00% A PARTIR DE 20/10/2026', 'SUJEITO A PROTESTO 10 DIAS APÓS O VENCIMENTO']);
  // virada de mês e de ano na data da multa
  assert.deepEqual(B.instrucoes({ multa_pct: 5 }, 10, '2026-12-31'), ['MULTA DE 5,00% A PARTIR DE 01/01/2027']);
  assert.equal(B.dvNossoNumero('00038048801000001399'), '5');
});

test('montar recusa convênio incompleto, valor e número errados', () => {
  assert.throws(() => B.montar({ convenio: '123' }, EMIT, { valor: 10, vencimento: '2026-11-01', seq: 1 }, {}), /convênio/);
  assert.throws(() => B.montar(CFG, null, { valor: 10, vencimento: '2026-11-01', seq: 1 }, {}), /emitente/);
  assert.throws(() => B.montar(CFG, EMIT, { valor: 0, vencimento: '2026-11-01', seq: 1 }, {}), /valor/);
  assert.throws(() => B.montar(CFG, EMIT, { valor: 10, vencimento: '2026-11-01', seq: 12345678901 }, {}), /número/);
  assert.throws(() => B.montar(CFG, EMIT, { valor: 10, vencimento: '2026-11-01', nosso_numero: '11111110000000001' }, {}), /convênio/);
  assert.deepEqual(B.faltaNoConvenio({}, null), ['convênio (7 dígitos)', 'carteira', 'agência', 'conta', 'emitente (aba Fiscal)']);
});

test('ITF 2 de 5: início, fim e 405 módulos para os 44 dígitos', () => {
  const cod = B.codigoBarras('001', '2026-10-19', 1703.98, B.campoLivre('38048801000001399', '17'));
  const w = B.itf(cod);
  assert.deepEqual(w.slice(0, 4), [1, 1, 1, 1]);
  assert.deepEqual(w.slice(-3), [3, 1, 1]);
  assert.equal(w.length, 4 + 44 * 5 + 3);
  assert.equal(w.reduce((s, v) => s + v, 0), 405);
  // cada dígito tem duas larguras largas em cinco
  for (let i = 4; i < w.length - 3; i += 10) {
    assert.equal([0, 2, 4, 6, 8].filter(k => w[i + k] === 3).length, 2);
    assert.equal([1, 3, 5, 7, 9].filter(k => w[i + k] === 3).length, 2);
  }
  // lê de volta as barras (posições pares) do primeiro par: 0 e 0
  const pad = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];
  const lido = [];
  for (let i = 4; i < w.length - 3; i += 10) {
    const b = [0, 2, 4, 6, 8].map(k => (w[i + k] === 3 ? 'w' : 'n')).join(''), e = [1, 3, 5, 7, 9].map(k => (w[i + k] === 3 ? 'w' : 'n')).join('');
    lido.push(pad.indexOf(b), pad.indexOf(e));
  }
  assert.equal(lido.join(''), cod);
  assert.throws(() => B.itf('123'), /par/);
});

test('desenha o boleto num jsPDF (uma folha, com a simulação)', () => {
  const d = B.montar(CFG, EMIT, { valor: 99.9, vencimento: '2026-11-30', seq: 2000000001, documento: 'NF 3001/2', emissao: '2026-10-22' },
    { nome: 'Cliente com um nome bem comprido para ver se cabe na linha do pagador sem estourar a caixa', doc: '12345678901', endereco: 'Rua Tal, 1 - Centro - São Paulo/SP' }, { hoje: '2026-10-22', simulacao: true });
  // a simulação sai com o dígito geral trocado: a linha e o código não passam na conferência
  assert.equal(C.lerLinha(d.linha).ok, false);
  assert.equal(d.codigo.length, 44);
  const real = B.montar(CFG, EMIT, { valor: 99.9, vencimento: '2026-11-30', seq: 2000000001 }, {}, { hoje: '2026-10-22' });
  assert.equal(C.lerLinha(real.linha).ok, true);
  assert.notEqual(real.codigo, d.codigo);
  assert.equal(real.codigo.slice(5), d.codigo.slice(5));
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const fim = B.desenha(pdf, d, {});
  assert.ok(fim < 297, 'cabe na folha');
  assert.equal(pdf.getNumberOfPages(), 1);
  const saida = pdf.output();
  assert.ok(saida.length > 5000);
});
