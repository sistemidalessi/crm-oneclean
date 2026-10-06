'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../caixa.js');

test('feriados de São Bernardo do Campo e dia útil bancário', () => {
  assert.equal(C.pascoa(2026), '2026-04-05');
  assert.ok(C.feriado('2026-10-12'), 'Aparecida');
  assert.ok(C.feriado('2026-07-09'), '9 de julho (SP)');
  assert.ok(C.feriado('2026-08-20'), 'aniversário de SBC');
  assert.ok(C.feriado('2026-02-16') && C.feriado('2026-02-17'), 'Carnaval');
  assert.ok(C.feriado('2026-06-04'), 'Corpus Christi');
  assert.ok(C.feriado('2026-11-20'), 'Consciência Negra');
  assert.equal(C.feriado('2026-01-25'), null, 'aniversário da capital não vale em SBC');
  assert.equal(C.util('2026-10-10'), false); // sábado
  assert.equal(C.util('2026-10-13'), true);
  assert.equal(C.posterga('2026-10-10'), '2026-10-13'); // sáb → (dom, seg feriado 12/10) → ter
});

test('título cai na conta no dia útil seguinte ao pagamento', () => {
  // vence domingo 11/10 → pago terça 13 (segunda é feriado) → cai quarta 14
  assert.equal(C.creditoTitulo('2026-10-11'), '2026-10-14');
  assert.equal(C.creditoTitulo('2026-10-14'), '2026-10-15');
  assert.equal(C.creditoTitulo('2026-10-16'), '2026-10-19'); // sexta → segunda
  assert.equal(C.creditoTitulo('2026-10-11', false), '2026-10-13'); // banco que credita no mesmo dia
});

test('gerar o mês: dia fixo, parcela n de N, fim do parcelamento e idempotência', () => {
  const recs = [
    { id: 'a', descricao: 'Aluguel', valor: 5000, dia: 10, inicio: '2026-10-01', ativo: true },
    { id: 'b', descricao: 'Reparcelamento', valor: 812.5, dia: 31, inicio: '2026-10-01', parcelas: 36, parcela_inicio: 5, ativo: true },
    { id: 'c', descricao: 'Giro', valor: 3741.33, dia: 27, inicio: '2026-09-01', parcelas: 27, parcela_inicio: 26, ativo: true },
    { id: 'd', descricao: 'Parada', valor: 1, dia: 1, inicio: '2026-01-01', ativo: false },
    { id: 'e', descricao: 'Começa depois', valor: 1, dia: 1, inicio: '2026-12-01', ativo: true }
  ];
  const out = C.gerarMes(recs, '2026-11', []);
  assert.deepEqual(out.map(x => [x.recorrente_id, x.descricao, x.vencimento, x.parcela]), [
    ['a', 'Aluguel', '2026-11-10', null],
    ['b', 'Reparcelamento (06 de 36)', '2026-11-30', 6] // 31 → 30 em novembro
  ]); // Giro acabou na 27ª (outubro); "parada" e "começa depois" ficam de fora
  assert.equal(out[0].competencia, '2026-11-01');
  assert.equal(C.gerarMes(recs, '2026-10', []).find(x => x.recorrente_id === 'c').descricao, 'Giro (27 de 27)');
  // de novo: nada
  assert.equal(C.gerarMes(recs, '2026-11', out.map(x => Object.assign({ id: 'x' }, x))).length, 0);
  assert.equal(C.diaDoMes('2028-02', 31), '2028-02-29');
});

test('saldo = último saldo do banco + baixas no caixa depois dele', () => {
  const saldos = [{ data: '2026-10-05', valor: 8052.79, criado_em: '2026-10-06T10:00:00Z' }, { data: '2026-10-01', valor: 1, criado_em: '2026-10-07T00:00:00Z' }];
  const lancs = [
    { tipo: 'saida', valor: 1000, situacao: 'pago', baixa: 'caixa', pago_em: '2026-10-06', baixado_em: '2026-10-06T12:00:00Z' },
    { tipo: 'entrada', valor: 500, situacao: 'pago', baixa: 'caixa', pago_em: '2026-10-07', baixado_em: '2026-10-07T12:00:00Z' },
    { tipo: 'saida', valor: 300, situacao: 'pago', baixa: 'fora', pago_em: '2026-10-07' },               // fora: não mexe no saldo
    { tipo: 'saida', valor: 200, situacao: 'pago', baixa: 'caixa', pago_em: '2026-10-05', baixado_em: '2026-10-06T09:00:00Z' }, // antes do saldo informado
    { tipo: 'saida', valor: 50, situacao: 'pago', baixa: 'caixa', pago_em: '2026-10-05', baixado_em: '2026-10-06T11:00:00Z' },  // mesmo dia, depois de informar
    { tipo: 'saida', valor: 999, situacao: 'aberto', vencimento: '2026-10-06' }
  ];
  const s = C.saldoAtual(saldos, lancs);
  assert.equal(s.ancora.data, '2026-10-05');
  assert.equal(s.saldo, 8052.79 - 1000 + 500 - 50);
  assert.equal(s.n, 3);
  assert.equal(C.saldoAtual([], lancs).saldo, null);
});

test('grade: previsto no próximo dia útil, vencidos fora, títulos no dia do crédito, saldo por dia', () => {
  const hoje = '2026-10-09'; // sexta
  const lancs = [
    { id: '1', tipo: 'saida', descricao: 'Energia', valor: 400, vencimento: '2026-10-10', situacao: 'aberto' }, // sábado → terça 13
    { id: '2', tipo: 'saida', descricao: 'Vencida', valor: 100, vencimento: '2026-10-05', situacao: 'aberto' },
    { id: '3', tipo: 'saida', descricao: 'Pausada', valor: 100, vencimento: '2026-10-14', situacao: 'pausado' },
    { id: '4', tipo: 'entrada', descricao: 'Material vendido à Agilité', valor: 1000, vencimento: '2026-10-09', situacao: 'pago', pago_em: '2026-10-09', baixa: 'caixa', baixado_em: '2026-10-09T15:00:00Z' },
    { id: '5', tipo: 'entrada', descricao: 'Recebido: X', valor: 70, vencimento: '2026-10-08', situacao: 'pago', pago_em: '2026-10-09', baixa: 'caixa', baixado_em: '2026-10-09T15:00:00Z', titulo_duplicata: '000070/01' }
  ];
  const tits = [
    { duplicata: '000060/01', cliente_nome: 'Escola', vencimento: '2026-10-11', valor: 250 },  // cai 14
    { duplicata: '000050/01', cliente_nome: 'Atrasado', vencimento: '2026-10-01', valor: 90 }, // vencido
    { duplicata: '000070/01', cliente_nome: 'X', vencimento: '2026-10-08', valor: 70 }         // já recebido no caixa
  ];
  const it = C.itensGrade('2026-10-08', '2026-10-22', hoje, lancs, tits, {});
  const por = Object.fromEntries(it.map(x => [x.chave, x]));
  assert.equal(por['lanc:1'].data, '2026-10-13');
  assert.match(por['lanc:1'].obs, /vence 10\/10, sábado → paga no próximo dia útil/);
  assert.ok(!por['lanc:2'] && !por['lanc:3']);
  assert.equal(por['lanc:4'].estado, 'feito');
  assert.equal(por['tit:000060/01'].data, '2026-10-14');
  assert.ok(!por['tit:000050/01'] && !por['tit:000070/01']);
  assert.deepEqual(C.vencidas(lancs, hoje).map(x => x.id), ['2']);
  assert.deepEqual(C.receberVencido(tits, lancs, hoje).map(x => x.duplicata), ['000050/01']);

  const s = C.saldoAtual([{ data: '2026-10-08', valor: 5000, criado_em: '2026-10-08T08:00:00Z' }], lancs);
  assert.equal(s.saldo, 6070);
  const dias = ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-13', '2026-10-14'];
  const sd = C.saldosGrade(dias, hoje, s, lancs, C.itensGrade(hoje, '2026-10-22', hoje, lancs, tits, {}));
  assert.deepEqual(sd, { '2026-10-07': null, '2026-10-08': 5000, '2026-10-09': 6070, '2026-10-13': 5670, '2026-10-14': 5920 });
});
