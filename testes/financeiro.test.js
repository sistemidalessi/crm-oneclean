'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../regras.js');
const F = require('../financeiro.js');

// Mesmo formato da listagem "Contas a receber por cliente — em aberto" do FKN (SIFN016) em CSV.
const CSV = [
  'EMPRESA EXEMPLO LTDA;PAG.: 1 de 1;',
  ';DATA: 01/10/2026;',
  'SISTEMA DE GESTÃO EMPRESARIAL;14:19;',
  'CONTAS A RECEBER POR CLIENTE: EM ABERTO - VENCTO   EM:  00/00/0000 A 00/00/0000;FKN(016)-00;',
  '       DUPLIC.; EMISSÃO;         VALOR;  VCTO;  ATR;   ENVIO;PORTADOR;TIP;OBSERVAÇÕES;',
  '',
  'CLIENTE: 000000067 PADARIA EXEMPLO;TEL: 11-4000-0000   /;VEND: ANA;',
  'ENDEREÇO: RUA UM / 10 /                  /;CENTRO;  CID/UF:SANTO ANDRE / SP;    CEP :09000-000;',
  'CNPJ....: 11.222.333/0001-81      INSC.EST: ISENTO;',
  '      002531/01;28/09/26;        453,00;26/10/26;;TRANSFERENCI;;;',
  '      002205/01;25/08/26;      1.917,88;24/09/26;   7;BOLETO;;;',
  ';;TOTAL CLIENTE.:;      2.370,88;',
  ';RESUMO .......:;;VENCIDO:;     1.917,88;A VENCER:;       453,00;QTD:       2;;',
  '------------------------------------------------------------;',
  'CLIENTE: 000000098 MERCADO SEM CADASTRO;TEL: 11-4000-0001   /;VEND: BRUNO;',
  'ENDEREÇO: RUA DOIS / 20 /                  /;CENTRO;  CID/UF:SANTO ANDRE / SP;    CEP :09000-001;',
  'CNPJ....: 99.888.777/0001-00      INSC.EST: ISENTO;',
  '      002527/01;25/09/26;        100,00;23/10/26;;BOLETO;;;',
  '      002527/02;25/09/26;        100,00;30/10/26;;BOLETO;;;',
  ';;TOTAL CLIENTE.:;        200,00;',
  ';RESUMO .......:;;VENCIDO:;         0,00;A VENCER:;       200,00;QTD:       2;;',
  '',
  ';;TOTAL GERAL...:;      2.570,88;',
  ';RESUMO .......:;;VENCIDO:;     1.917,88;A VENCER:;       653,00;QTD:     4;;',
  '',
  ' (!) Duplicata de abono;'
].join('\r\n');

test('contas a receber: lê a listagem do FKN e confere com o total geral', () => {
  const l = F.lerContasReceber(CSV);
  assert.equal(l.posicao, '2026-10-01');
  assert.equal(l.hora, '14:19');
  assert.equal(l.titulos.length, 4);
  assert.equal(l.clientes, 2);
  assert.equal(l.soma, 2570.88);
  assert.equal(l.totalGeral, 2570.88);
  assert.equal(l.vencidoGeral, 1917.88);
  assert.ok(l.confere);
  const t = l.titulos[1];
  assert.deepEqual([t.duplicata, t.nota_numero, t.parcela, t.emitida_em, t.vencimento, t.valor, t.portador, t.cliente_doc, t.vendedor_nome, t.cliente_codigo],
    ['002205/01', 2205, 1, '2026-08-25', '2026-09-24', 1917.88, 'BOLETO', '11222333000181', 'ANA', '000000067']);
  assert.deepEqual(l.titulos.filter(x => x.nota_numero === 2527).map(x => x.duplicata), ['002527/01', '002527/02'], 'parcelas da mesma nota');
  assert.throws(() => F.lerContasReceber('CODIGO;NOME\r\n1;2'), /contas a receber/);
});

test('contas a receber: liga ao cliente pela nota (mesmo número e CNPJ) e pelo CNPJ', () => {
  const D = { empresas: [
      { id: 'P', nome: 'Padaria Exemplo', cnpj: '11.222.333/0001-81', responsavel_id: 'u1' },
      { id: 'P2', nome: 'Padaria Exemplo (cópia)', cnpj: '11222333000181', responsavel_id: 'u1' }],
    notas: [{ id: 'n1', numero: 2531, empresa_id: 'P2', cliente_doc: '11.222.333/0001-81' }] };
  const ix = { porEmpresa: { notas: new Map([['P', [{}, {}]], ['P2', [{}]]]) } };
  const r = F.ligaEmpresas(F.lerContasReceber(CSV).titulos, D, ix);
  assert.equal(r.titulos.find(t => t.duplicata === '002531/01').empresa_id, 'P2', 'a nota 2531 é do cadastro P2');
  assert.equal(r.titulos.find(t => t.duplicata === '002205/01').empresa_id, 'P', 'sem nota: o cadastro do CNPJ com mais notas');
  assert.equal(r.titulos.filter(t => !t.empresa_id).length, 2, 'cliente que não está no CRM fica sem cadastro');
  assert.deepEqual([r.pelaNota, r.peloDoc, r.sem], [1, 1, 2]);
});

test('contas a receber: resumo por cliente e painel', () => {
  const hoje = '2026-10-01';
  const D = { empresas: [{ id: 'P', nome: 'Padaria Exemplo', cnpj: '11222333000181', responsavel_id: 'u1' }], notas: [] };
  const lig = F.ligaEmpresas(F.lerContasReceber(CSV).titulos, D, null).titulos;
  const m = F.porEmpresa(lig, hoje);
  const p = m.get('P');
  assert.equal(p.aberto, 2370.88);
  assert.equal(p.vencido, 1917.88);
  assert.equal(p.qtdVencidos, 1);
  assert.equal(p.maiorAtraso, 7, 'venceu em 24/09');
  assert.equal(p.proximo, '2026-10-26');
  const g = F.painel(lig, D, hoje, id => (id === 'u1' ? 'Ana Exemplo' : ''));
  assert.equal(R.num(g.total.aberto).toFixed(2), '2570.88');
  assert.equal(g.vencidos.length, 1);
  assert.equal(g.vencidos[0].vendedor, 'Ana Exemplo', 'carteira do CRM vale mais que o vendedor do FKN');
  assert.equal(g.semCliente.length, 1);
  assert.equal(g.semCliente[0].vendedor, 'BRUNO');
  assert.equal(g.vence7, 0);
  assert.equal(F.dataFKN('00/00/0000'), null);
});

test('contas a receber: conferência do relatório puxado no FKN (o que faltou marcar)', () => {
  const K = require('../fkn.js');
  const ok = K.conferirContasReceber(CSV, F.lerContasReceber(CSV));
  assert.deepEqual(ok.recusa, [], 'o relatório completo passa');
  const semCnpj = CSV.split('\r\n').filter(l => !/^CNPJ/.test(l)).join('\r\n');
  assert.match(K.conferirContasReceber(semCnpj, F.lerContasReceber(semCnpj)).recusa.join(), /dados cadastrais/);
  const periodo = CSV.replace('00/00/0000 A 00/00/0000', '01/10/2026 A 31/10/2026');
  assert.match(K.conferirContasReceber(periodo, F.lerContasReceber(periodo)).recusa.join(), /período de vencimento em branco/);
  const liquidados = CSV.replace('EM ABERTO', 'LIQUIDADOS');
  assert.match(K.conferirContasReceber(liquidados, F.lerContasReceber(liquidados)).recusa.join(), /Em aberto/);
  const cortado = CSV.split(';;TOTAL GERAL')[0];
  assert.match(K.conferirContasReceber(cortado, F.lerContasReceber(cortado)).recusa.join(), /TOTAL GERAL/);
});
