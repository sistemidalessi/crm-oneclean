'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../caixa-calculo.js');

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

// Contas a pagar do FKN (Sifn083), no formato real (dados fictícios).
const K = require('../fkn.js');
const PAGAR = [
  'EMPRESA EXEMPLO LTDA;PAG.: 1 de 1;', ';DATA: 06/10/2026;', 'SISTEMA DE GESTAO EMPRESARIAL;12:01;',
  'CONTAS A PAGAR POR CONTA: EM ABERTO - VENCIDAS EM:  00/00/0000 A 00/00/0000;FKN(083)-00;',
  '   DOCUM.; EMISSAO;         VALOR;  VCTO; ENTRADA;PORTADOR;OBSERVACOES / SUBCONTA;', '',
  'CONTA:;00005 FORNECEDOR PLASTICO LTDA;TEL:;',
  '   000007022-2;23/09/2026;      1.864,50;13/10/2026;23/09/2026;BOLETO;PED.COMPRA 100596   /;',
  '   30468-2;01/09/2020;      1.429,87;07/10/2020;02/09/2020;CHEQUE BRADE;;',
  ';TOTAL DA CONTA:;      3.294,37; EM ABERTO:;      3.294,37;',
  'CONTA:;11001 SALARIO;TEL:;',
  '   SET/26;06/10/2026;     11.302,22;06/10/2026;06/10/2026;TRANSFERENCI;OPERACIONAL I;',
  ';TOTAL DA CONTA:;     11.302,22; EM ABERTO:;   11.302,22;',
  'CONTA:;16001 CAMINHAO KIA;TEL:;',
  '   OUT/26 - I;02/10/2026;      3.523,86;07/10/2026;02/10/2026;BOLETO;COMBUSTIVEL;',
  ';TOTAL DA CONTA:;      3.523,86; EM ABERTO:;    3.523,86;',
  ';TOTAL GERAL...:;     18.120,45; EM ABERTO:;   18.120,45;'
].join('\r\n');

test('contas a pagar do FKN: lê, confere com o total geral e recusa filtro', () => {
  const l = K.lerContasPagar(PAGAR);
  assert.equal(l.posicao, '2026-10-06'); assert.equal(l.hora, '12:01');
  assert.equal(l.contas.length, 4); assert.equal(l.soma, 18120.45); assert.ok(l.confere);
  assert.deepEqual(K.conferirContasPagar(PAGAR, l).recusa, []);
  assert.equal(l.contas[0].chave, '00005|000007022-2');
  const filtrado = PAGAR.replace('00/00/0000 A 00/00/0000', '01/10/2026 A 31/10/2026');
  assert.match(K.conferirContasPagar(filtrado, K.lerContasPagar(filtrado)).recusa.join(), /período em branco/);
  const cortado = PAGAR.replace(/\r\n;TOTAL GERAL.*$/, '');
  assert.match(K.conferirContasPagar(cortado, K.lerContasPagar(cortado)).recusa.join(), /TOTAL GERAL/);
  const comb = K.lancamentoDoFkn(l.contas[3]);
  assert.equal(comb.categoria, 'Frete e combustível'); assert.match(comb.descricao, /^COMBUSTIVEL \(CAMINHAO KIA\)/);
});

test('contas a pagar do FKN: novas, antigas pausadas, já lançadas ligadas e sumidas pagas', () => {
  const l = K.lerContasPagar(PAGAR);
  const exist = [
    { id: 'r1', tipo: 'saida', situacao: 'aberto', origem: 'recorrente', valor: 11302.22, vencimento: '2026-10-06', descricao: 'Reembolso salários' },
    { id: 'f1', tipo: 'saida', situacao: 'aberto', origem: 'fkn', chave_fkn: '00005|000007022-2', valor: 1800, vencimento: '2026-10-13' },
    { id: 'f2', tipo: 'saida', situacao: 'aberto', origem: 'fkn', chave_fkn: '00009|SUMIU-01', valor: 50, vencimento: '2026-10-01' }
  ];
  const p = K.planoContasPagar(l, exist, { hoje: '2026-10-06', agora: 'x' });
  assert.deepEqual(p.atualizar, [{ id: 'f1', patch: { valor: 1864.5 } }]);
  assert.deepEqual(p.ligar.map(x => [x.id, x.patch.chave_fkn]), [['r1', '11001|SET/26']]);
  assert.deepEqual(p.baixar.map(x => [x.id, x.patch.situacao, x.patch.pago_em, x.patch.baixa]), [['f2', 'pago', '2026-10-06', 'fora']]);
  assert.deepEqual(p.inserir.map(x => [x.chave_fkn, x.situacao]), [['00005|30468-2', 'pausado'], ['16001|OUT/26 - I', 'aberto']]);
  assert.match(p.inserir[0].observacoes, /pendência antiga/);
  assert.equal(p.antigas.qtd, 1);
});

test('leitura do caixa (Agilité "Geral" e gestora): bate com a grade, sem nome de pessoa', () => {
  const hoje = '2026-10-06';
  const lancamentos = [
    { id: 'p1', tipo: 'saida', descricao: 'Salário Fulana Exemplo', categoria: 'Salários', valor: 3500, vencimento: '2026-10-07', situacao: 'aberto' },
    { id: 'p2', tipo: 'saida', descricao: 'Salário Beltrana Teste', categoria: 'Salários', valor: 3200, vencimento: '2026-10-07', situacao: 'aberto' },
    { id: 'p3', tipo: 'saida', descricao: 'Comissão da Fulana', valor: 400, vencimento: '2026-10-07', situacao: 'aberto' },
    { id: 'a1', tipo: 'saida', descricao: 'Aluguel galpão', categoria: 'Aluguel', valor: 4500, vencimento: '2026-10-10', situacao: 'aberto' }, // sábado → 13 (12 é feriado)
    { id: 'r1', tipo: 'saida', descricao: 'Reembolso da folha à Agilité', categoria: 'Reembolso da folha à Agilité', valor: 11000, vencimento: '2026-10-08', situacao: 'aberto', entre_empresas: true },
    { id: 'f1', tipo: 'saida', descricao: 'Boleto ligar (11) 98765-4321 CPF 123.456.789-09', fornecedor: 'FORNECEDOR FICTICIO LTDA', valor: 100, vencimento: '2026-10-06', situacao: 'pago', pago_em: hoje, baixa: 'caixa', baixado_em: '2026-10-06T15:00:00Z' },
    { id: 'f2', tipo: 'saida', descricao: 'Pago fora', valor: 50, vencimento: '2026-10-06', situacao: 'pago', pago_em: hoje, baixa: 'fora' },
    { id: 'v1', tipo: 'saida', descricao: 'Energia', categoria: 'Energia', valor: 900, vencimento: '2026-09-20', situacao: 'aberto' },
    { id: 'z1', tipo: 'saida', descricao: 'PAPELARIA FICTICIA · 123-01', fornecedor: 'PAPELARIA FICTICIA', valor: 300, vencimento: '2026-05-01', situacao: 'pausado', origem: 'fkn' },
    { id: 'z2', tipo: 'saida', descricao: 'PAPELARIA FICTICIA · 124-01', fornecedor: 'PAPELARIA FICTICIA', valor: 200, vencimento: '2026-06-01', situacao: 'pausado', origem: 'fkn' }
  ];
  const saldos = [{ data: hoje, valor: 8052.79, criado_em: '2026-10-06T12:00:00Z' }];
  const titulos = [{ duplicata: '100-1', cliente: 'CLIENTE EXEMPLO LTDA', valor: 2000, vencimento: '2026-10-08' },
    { duplicata: '200-1', cliente: 'AGILITE FICTICIA', valor: 700, vencimento: '2026-10-09' },
    { duplicata: '300-1', cliente: 'ATRASADO SA', valor: 50, vencimento: '2026-09-01' }];
  const r = C.resumoLeitura({ lancamentos, saldos, titulos, recorrentes: [], pessoas: ['Fulana Exemplo', 'Beltrana Teste'] }, { hoje, dias: 10, d1: true, gerado_em: 'x' });
  // saldo e saldo de cada dia = os da grade da tela
  const s = C.saldoAtual(saldos, lancamentos);
  assert.equal(r.saldo.atual, s.saldo);
  assert.equal(r.saldo.atual, 7952.79);
  const dias = r.proximos_dias.map(x => x.data);
  const g = C.saldosGrade(dias, hoje, s, lancamentos, C.itensGrade(hoje, dias[dias.length - 1], hoje, lancamentos, titulos, { d1: true }));
  r.proximos_dias.forEach(x => assert.equal(x.saldo_fim_do_dia, g[x.data], x.data));
  const d06 = r.proximos_dias[0];
  assert.equal(d06.saidas, 100, 'o pago fora não entra na soma do dia');
  assert.ok(d06.itens.some(i => i.pago_fora && i.situacao === 'aconteceu'));
  assert.ok(d06.itens.some(i => i.descricao.indexOf('[telefone]') !== -1 && i.descricao.indexOf('[CPF]') !== -1));
  // folha e comissão somadas por dia e categoria, sem nome
  const d07 = r.proximos_dias.find(x => x.data === '2026-10-07');
  assert.deepEqual(d07.itens.map(i => [i.descricao, i.valor, i.lancamentos_somados || 1]), [['Salários', 6700, 2], ['Pessoal', 400, 1]]);
  assert.doesNotMatch(JSON.stringify(r), /Fulana|Beltrana/);
  // entre empresas e dia útil
  assert.ok(r.proximos_dias.find(x => x.data === '2026-10-08').itens.every(i => i.descricao !== 'Reembolso da folha à Agilité' || i.entre_empresas));
  assert.deepEqual(r.proximos_dias.find(x => x.data === '2026-10-12').sem_banco, 'feriado (Nossa Senhora Aparecida)');
  assert.ok(r.proximos_dias.find(x => x.data === '2026-10-13').itens.some(i => i.descricao === 'Aluguel galpão'));
  assert.ok(r.proximos_dias.find(x => x.data === '2026-10-13').itens.some(i => i.cliente_fornecedor === 'AGILITE FICTICIA' && i.entre_empresas), 'título 09/10 (sex) cai seg 12 → feriado → 13');
  // vencidas, pausadas, títulos
  assert.deepEqual([r.contas_vencidas.quantidade, r.contas_vencidas.total, r.contas_vencidas.itens[0].situacao], [1, 900, 'vencido']);
  assert.deepEqual(r.contas_pausadas.contas.map(c => [c.conta, c.parcelas, c.total]), [['PAPELARIA FICTICIA', 2, 500]]);
  assert.deepEqual([r.titulos_a_receber.quantidade, r.titulos_a_receber.vencidos, r.titulos_a_receber.total], [3, 1, 2750]);
  assert.equal(r.titulos_a_receber.titulos.find(t => t.duplicata === '100-1').cai_na_conta, '2026-10-09');
  assert.equal(r.menor_saldo.valor, Math.min(...r.proximos_dias.map(x => x.saldo_fim_do_dia)));
  assert.equal(r.totais_periodo.saldo_final, r.proximos_dias[9].saldo_fim_do_dia);
});

test('material vendido à Agilité: previsão e título do FKN de mesmo valor contam uma vez só', () => {
  const hoje = '2026-10-06';
  const valores = [2500.05, 1000.45, 829.89, 798.79, 494.31, 91.91];
  const conds = ['Cond. Alfa', 'Beta', 'Gama', 'Delta', 'Cond. Épsilon', 'Zeta'];
  const lancamentos = valores.map((v, i) => ({ id: 'm' + i, tipo: 'entrada', descricao: 'Material vendido à Agilité — ' + conds[i], categoria: 'Material vendido à Agilité',
    valor: v, vencimento: '2026-10-20', situacao: 'aberto', origem: 'recorrente', entre_empresas: true }));
  lancamentos.push({ id: 'x', tipo: 'entrada', descricao: 'Material vendido à Agilité — Eta', categoria: 'Material vendido à Agilité', valor: 300, vencimento: '2026-10-20', situacao: 'aberto', entre_empresas: true });
  const titulos = valores.map((v, i) => ({ duplicata: '0099' + i + '/01', cliente: 'AGILITE FICTICIA SERVICOS', valor: v, vencimento: '2026-10-20' }));
  titulos.push({ duplicata: '00500/01', cliente: 'OUTRO CLIENTE', valor: 300, vencimento: '2026-10-20' }); // mesmo valor, mas não é da Agilité
  const lig = C.ligacoesTitulos(lancamentos, titulos, t => t.cliente);
  assert.equal(lig.length, 6);
  assert.deepEqual(lig.map(x => x.id).sort(), ['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
  const g = C.itensGrade('2026-10-06', '2026-10-31', hoje, lancamentos, titulos, { nome: t => t.cliente });
  const soma = d => g.filter(x => x.data === d && x.secao === 'entrada').reduce((t, x) => t + x.valor, 0);
  assert.equal(Math.round(soma('2026-10-20') * 100) / 100, 300, 'em 20/10 só a previsão sem título igual');
  assert.equal(Math.round(soma('2026-10-21') * 100) / 100, 5715.4 + 300, 'em 21/10 os seis títulos (uma vez) e o outro cliente');
  assert.ok(g.find(x => x.chave === 'tit:00990/01').titulo.indexOf('Cond. Alfa') !== -1);
  // passado o dia sem receber: o título vai para "A receber vencido" e a previsão não vira conta vencida
  assert.deepEqual(C.vencidas(lancamentos, '2026-10-26', titulos, t => t.cliente).map(l => l.id), ['x']);
  // leitura: entre empresas e o condomínio
  const r = C.resumoLeitura({ lancamentos, saldos: [{ data: hoje, valor: 1000 }], titulos }, { hoje, dias: 30 });
  const d21 = r.proximos_dias.find(x => x.data === '2026-10-21');
  assert.equal(d21.entradas, 6015.4);
  assert.ok(d21.itens.filter(i => i.cliente_fornecedor === 'AGILITE FICTICIA SERVICOS').every(i => i.entre_empresas && /Material vendido/.test(i.descricao)));
  assert.equal(r.proximos_dias.find(x => x.data === '2026-10-20').entradas, 300);
  assert.equal(r.titulos_a_receber.titulos.find(t => t.duplicata === '00990/01').referente, 'Material vendido à Agilité — Cond. Alfa');
  // ligação gravada: igual; recebida (paga com o título) não aparece de novo nem deixa o título previsto
  const gravadas = lancamentos.map(l => { const x = lig.find(y => y.id === l.id); return x ? Object.assign({}, l, { titulo_duplicata: x.duplicata }) : l; });
  assert.equal(C.ligacoesTitulos(gravadas, titulos, t => t.cliente).length, 0);
  const g2 = C.itensGrade('2026-10-06', '2026-10-31', hoje, gravadas, titulos, { nome: t => t.cliente });
  assert.equal(g2.length, g.length);
  gravadas[0] = Object.assign({}, gravadas[0], { situacao: 'pago', pago_em: '2026-10-21', baixa: 'caixa', baixado_em: '2026-10-21T15:00:00Z' });
  const g3 = C.itensGrade('2026-10-06', '2026-10-31', '2026-10-21', gravadas, titulos, { nome: t => t.cliente });
  assert.equal(g3.filter(x => x.data === '2026-10-21' && x.secao === 'entrada').reduce((t, x) => t + x.valor, 0).toFixed(2), (5715.4 + 300).toFixed(2), 'recebida aparece feita, sem o título repetido');
  assert.ok(g3.some(x => x.chave === 'lanc:m0' && x.estado === 'feito') && !g3.some(x => x.chave === 'tit:00990/01'));
});

test('reembolso da folha à Agilité: sai com o componente; com nome de pessoa, volta a somar sem o nome', () => {
  const L = (d, v) => ({ tipo: 'saida', categoria: 'Reembolso da folha à Agilité', descricao: d, valor: v, vencimento: '2026-10-14', situacao: 'aberto', entre_empresas: true });
  const lancamentos = [L('Reembolso folha 09/2026 — Cesta II', 392.33), L('Reembolso folha 09/2026 — FGTS + consignado', 1167.9),
    L('Reembolso benefícios 10/2026 — VR/VA, VT e cesta', 5404.4), L('Reembolso folha 09/2026 — VT Fulano', 50), L('Reembolso Beltrano', 25)];
  const r = C.resumoLeitura({ lancamentos, saldos: [{ data: '2026-10-06', valor: 1 }], titulos: [] }, { hoje: '2026-10-06', dias: 10 });
  const it = r.proximos_dias.find(x => x.data === '2026-10-14').itens;
  assert.deepEqual(it.map(i => [i.descricao, i.valor, i.entre_empresas]), [['Reembolso benefícios 10/2026 — VR/VA, VT e cesta', 5404.4, true],
    ['Reembolso folha 09/2026 — FGTS + consignado', 1167.9, true], ['Reembolso folha 09/2026 — Cesta II', 392.33, true], ['Reembolso da folha à Agilité', 75, true]]);
  assert.doesNotMatch(JSON.stringify(r), /Fulano|Beltrano/);
});

test('leitura: cliente cadastrado como "Empresa | Contato" sai só com a empresa', () => {
  const titulos = [{ duplicata: '001/01', cliente: 'GRAFICA EXEMPLO LTDA | Fulano', valor: 100, vencimento: '2026-10-08' }];
  const r = C.resumoLeitura({ lancamentos: [], saldos: [{ data: '2026-10-06', valor: 1 }], titulos }, { hoje: '2026-10-06', dias: 10 });
  assert.equal(r.titulos_a_receber.titulos[0].cliente, 'GRAFICA EXEMPLO LTDA');
  assert.doesNotMatch(JSON.stringify(r), /Fulano/);
});
