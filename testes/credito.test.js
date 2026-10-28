'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../credito.js');

// consulta FICTÍCIA de uma empresa boa (score 780, sem restrições, 100% pontual, limite sugerido R$ 45.000, troca de sócio
// há 3 anos): compra de R$ 1.500 por mês → R$ 3.000 a prazo, 28 dias. (Nunca dados reais de cliente: o repositório é público.)
const MBS = { razao_social: 'EMPRESA EXEMPLO LTDA', documento: '11222333000181', situacao_cadastral: 'Ativo', fundacao: '1990-01-15',
  score: 780, prob_inadimplencia: 3, recomendacao: 'Negociação Recomendada', pendencias_qtd: 0, pendencias_valor: 0, protestos_qtd: 0, protestos_valor: 0,
  cheques_qtd: 0, acoes_qtd: 0, falencia: false, fraude: false, pontualidade: 100, atraso_mais_60: false, limite_sugerido: 45000,
  faturamento_presumido: 'De R$ 800.001 até R$ 1.000.000', mudanca_societaria: 'sócio único desde 2023', mudanca_em: '2023-09-01', consultas_12m: 2, alertas: ['consulta de factoring no último ano'] };
const hoje = '2026-10-27';

test('MBS: 2 meses de compra, 28 dias, revisão em 6 meses', () => {
  const p = C.propor(MBS, { compra_mensal: 1500, hoje });
  assert.strictEqual(p.situacao, 'prazo');
  assert.strictEqual(p.limite, 3000);
  assert.strictEqual(p.prazo_max, 28);
  assert.strictEqual(p.revisar_em, '2027-04-27');
  assert.ok(p.atencao.some(a => /factoring/.test(a)));
});

test('restrição, protesto ou CNPJ inativo: só à vista', () => {
  assert.strictEqual(C.propor(Object.assign({}, MBS, { protestos_qtd: 1, protestos_valor: 800 }), { compra_mensal: 1500, hoje }).situacao, 'vista');
  assert.strictEqual(C.propor(Object.assign({}, MBS, { pendencias_qtd: 2 }), { hoje }).situacao, 'vista');
  assert.strictEqual(C.propor(Object.assign({}, MBS, { situacao_cadastral: 'Baixada' }), { hoje }).situacao, 'vista');
  assert.strictEqual(C.propor(Object.assign({}, MBS, { fraude: true }), { hoje }).situacao, 'vista');
});

test('score: abaixo de 400 à vista; 400-599 um mês e 21 dias; sem score em análise', () => {
  assert.strictEqual(C.propor(Object.assign({}, MBS, { score: 350 }), { compra_mensal: 1500, hoje }).situacao, 'vista');
  const m = C.propor(Object.assign({}, MBS, { score: 500 }), { compra_mensal: 1500, hoje });
  assert.deepStrictEqual([m.situacao, m.limite, m.prazo_max], ['prazo', 1500, 21]);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { score: 0 }), { hoje }).situacao, 'analise');
});

test('pontualidade baixa desce um degrau; empresa nova ou troca recente de sócio: um mês', () => {
  const a = C.propor(Object.assign({}, MBS, { pontualidade: 60 }), { compra_mensal: 1500, hoje });
  assert.deepStrictEqual([a.situacao, a.limite, a.prazo_max], ['prazo', 1500, 21]);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { score: 500, pontualidade: 60 }), { compra_mensal: 1500, hoje }).situacao, 'vista');
  assert.strictEqual(C.propor(Object.assign({}, MBS, { mudanca_em: '2026-03-01' }), { compra_mensal: 1500, hoje }).limite, 1500);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { fundacao: '2026-05-01' }), { compra_mensal: 1500, hoje }).limite, 1500);
});

test('teto no limite da consulta e arredondamento de 500 em 500', () => {
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 20000 }), { compra_mensal: 1800, hoje }).limite, 4000);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 3200 }), { compra_mensal: 1800, hoje }).limite, 3000);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 0 }), { compra_mensal: 1800, hoje }).limite, 4000);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 400 }), { compra_mensal: 1500, hoje }).situacao, 'vista');
  // a consulta sugere pouco mais que 2 meses de compra: vale a compra (antes, 10% do limite dava R$ 500)
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 5300 }), { maior_mes: 1180, hoje }).limite, 2500);
});

test('sem compra prevista vale o histórico; título vencido com a OneClean: em análise', () => {
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 0 }), { maior_mes: 2600, hoje }).limite, 5500);
  assert.strictEqual(C.propor(MBS, { maior_mes: 2600, hoje }).limite, 5500);
  assert.strictEqual(C.propor(MBS, { hoje }).limite, 3000);
  assert.strictEqual(C.propor(MBS, { compra_mensal: 1500, vencido: 300, hoje }).situacao, 'analise');
});

test('o que a equipe vê', () => {
  assert.strictEqual(C.textoEquipe({ ligado: false, situacao: 'prazo' }), '');
  assert.match(C.textoEquipe({ ligado: true, situacao: 'sem_ficha' }), /Sem análise/);
  assert.match(C.textoEquipe({ ligado: true, situacao: 'prazo', disponivel: 1200, prazo_max: 28 }), /1\.200,00 · prazo até 28 dias/);
  assert.ok(C.resumoFatos(MBS).some(l => /Sem restrições/.test(l)));
});

// 28/10/2026: a resposta da API da Rekta (RLT Avançado) vira os mesmos fatos da leitura do PDF. Formato do guia da Rekta,
// dados inventados (repositório público).
test('daRekta: resposta da API nos fatos da consulta', () => {
  const C2 = require('../credito.js');
  const bruto = {
    identificacao: { documento: '11222333000181', razaoSocial: 'EMPRESA FICTICIA LTDA', dataFundacao: '10/03/2015', situacaoCadastral: 'ATIVA' },
    score_classificacao_varios_modelos: [
      { score: '720', probabilidade: '00450', descricaoNatureza: 'POSITIVO PJ', nomeScore: 'P5', texto: 'É provável que 95% das empresas paguem' },
      { score: '8', descricaoNatureza: 'FATURAMENTO PRESUMIDO', texto: 'De R$ 1 milhão a R$ 2 milhões' }
    ],
    titulos_protestados: [{ valor: '155,15', dataOcorrencia: '22/10/2020' }],
    resumo_titulos_protestados: { total: '1', valorAcumulado: '155,15' },
    debitos: [{ valor: '1.318,60' }, { valor: '2.024,90' }],
    resumo_ocorrencias_de_debitos: { totalDevedor: '2', valorAcomulado: '3.343,50' },
    resumo_consultas_anteriores: { totalDeConsultas: '00004' },
    decisao: { aprova: 'N', texto: 'NEGOCIAÇÃO NÃO RECOMENDADA' },
    painel_controle_positivo: { indicadores_positivos_comportamento_pagamento: { nota_pontualidade: { operacoes_parceladas: { item_painel_controle: [
      { descricao: 'Pagos antecipadamente ou em dia', valor: '80' }, { descricao: 'Pagos em até 5 dias após o vencimento', valor: '10' },
      { descricao: 'Pagos entre 6 a 30 dias após o vencimento', valor: '6' }, { descricao: 'Pagos após 31 dias do vencimento', valor: '4' },
      { descricao: 'Sem informação de pagamento após 31 dias do vencimento', valor: '50' }] } } } }
  };
  const k = C2.daRekta(bruto, '11.222.333/0001-81', '2026-10-28');
  assert.equal(k.razao_social, 'EMPRESA FICTICIA LTDA');
  assert.equal(k.documento, '11222333000181');
  assert.equal(k.fundacao, '2015-03-10');
  assert.equal(k.situacao_cadastral, 'ATIVA');
  assert.equal(k.score, 720);
  assert.equal(k.prob_inadimplencia, 4.5);
  assert.deepEqual([k.protestos_qtd, k.protestos_valor, k.pendencias_qtd, k.pendencias_valor], [1, 155.15, 2, 3343.5]);
  assert.equal(k.pontualidade, 90);
  assert.equal(k.consultas_12m, 4);
  assert.equal(k.faturamento_presumido, 'De R$ 1 milhão a R$ 2 milhões');
  assert.ok(k.alertas.some(a => /não recomenda/.test(a)));
  // com restrição, a política manda para "só à vista"
  assert.equal(C2.propor(k, { hoje: '2026-10-28' }).situacao, 'vista');
  // resposta vazia (204: nada consta) não quebra e não inventa
  const v = C2.daRekta({}, '11222333000181', '2026-10-28');
  assert.deepEqual([v.score, v.prob_inadimplencia, v.pontualidade, v.protestos_qtd, v.pendencias_qtd], [0, -1, -1, 0, 0]);
  assert.equal(C2.propor(v, { hoje: '2026-10-28' }).situacao, 'analise');
});

// 28/10/2026: a 1ª resposta real (pessoa jurídica) veio como TEXTO com o JSON dentro e com os nomes abaixo (dados inventados)
test('daRekta: resposta de pessoa jurídica (texto com JSON dentro)', () => {
  const C2 = require('../credito.js');
  const meses = v => ({ lista_indicador_comportamento: { item_indicador: [{ mes_ano: 'Pontuação', pontuacao_mensal: v }, { mes_ano: 'set/2026', pontuacao_mensal: v }] } });
  const pj = {
    'decisao:decisao': { 'decisao:flag': '0005', 'decisao:descricao': 'Negociação Recomendada' },
    limite_credito: { score: '42000', texto: 'Valor de Limite de Crédito Disponível' },
    identificacao_completo: { cnpj: '11222333000181', razao_social: 'ESCOLA FICTICIA LTDA', situacao_cnpj: 'Ativo', data_fundacao: '10/03/2012',
      razao_social_anterior: 'ESCOLA FICTICIA LTDA EPP', data_alteracao_razao_social: '05/02/2019' },
    score: { score_pj: { score: '812', probabilidade: '2', texto: 'De cada 100 empresas classificadas nesta classe de score, é provável que 2 apresentem débitos no mercado nos próximos 12 meses.' } },
    faturamento_presumido: { faturamento_anual: 'De R$ 500.001 até R$ 900.000' },
    consultas: { quantidade_total: '4' },
    protestos: null, acoes_civeis: null, alerta_fraudes: null, cheques_sustados: null, cheques_sem_fundo: null,
    pendencias_restricoes: null, falencias_recuperacao_judicial: null, cheques_devolvidos_informados_usuario: null,
    'pgtpont:pagamento_pontual': { 'pgtpont:pontuacao': '100' },
    pagamento_atrasado: { mais_de_60_dias: meses('-'), periodo_31_a_60_dias: meses('-') }
  };
  const k = C2.daRekta(JSON.stringify(JSON.stringify(pj, null, 2)).slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n'), '11.222.333/0001-81', '2026-10-28');
  assert.equal(k.razao_social, 'ESCOLA FICTICIA LTDA');
  assert.equal(k.situacao_cadastral, 'Ativo');
  assert.equal(k.fundacao, '2012-03-10');
  assert.deepEqual([k.score, k.prob_inadimplencia, k.pontualidade, k.atraso_mais_60, k.limite_sugerido, k.consultas_12m], [812, 2, 100, false, 42000, 4]);
  assert.deepEqual([k.protestos_qtd, k.pendencias_qtd, k.cheques_qtd, k.acoes_qtd, k.falencia, k.fraude], [0, 0, 0, 0, false, false]);
  assert.equal(k.recomendacao, 'Negociação Recomendada');
  assert.equal(k.mudanca_em, '2019-02-05');
  assert.deepEqual(k.alertas, []);
  const p = C2.propor(k, { hoje: '2026-10-28' });
  assert.deepEqual([p.situacao, p.limite, p.prazo_max], ['prazo', 3000, 28]);
  // o texto também pode vir duas vezes embrulhado; e restrição em formato novo conta (melhor parar para conferir)
  assert.equal(C2.daRekta(JSON.stringify(JSON.stringify(pj)), '11222333000181').score, 812);
  const ruim = Object.assign({}, pj, { protestos: { lista: [{ valor: '1.200,00', cartorio: 'X' }, { valor: '300,00', cartorio: 'Y' }] }, pendencias_restricoes: { quantidade_total: '3', valor_total: '4.500,00' },
    'decisao:decisao': { 'decisao:descricao': 'Negociação Não Recomendada' }, pagamento_atrasado: { mais_de_60_dias: meses('12') } });
  const r = C2.daRekta(ruim, '11222333000181', '2026-10-28');
  assert.deepEqual([r.protestos_qtd, r.protestos_valor, r.pendencias_qtd, r.pendencias_valor, r.atraso_mais_60], [2, 1500, 3, 4500, true]);
  assert.ok(r.alertas.some(a => /não recomenda/.test(a)));
  assert.equal(C2.propor(r, { hoje: '2026-10-28' }).situacao, 'vista');
  // formato real das seções com restrição (28/10/2026): o total vem no topo e "ultimas_ocorrencias" traz só as 5 últimas
  const cinco = (tipo, v) => ({ [tipo]: [1, 2, 3, 4, 5].map(i => ({ valor: v, data: '0' + i + '/07/2026' })) });
  const real = Object.assign({}, pj, {
    protestos: { valor: null, quantidade: null, valor_maior: '900.00', valor_primeiro: '120.00', valor_total: '15320.50', total_protestos: '37', ultimas_ocorrencias: cinco('protesto', '100.00') },
    pendencias_restricoes: { valor: '2840.10', quantidade: null, valor_maior: '1500.00', total_credores: '3', total_pendencias: '9', ultimas_ocorrencias: cinco('pendencia_restricao', '50.00') },
    acoes_civeis: { mensagem: null, total_acoes: '12', valor_maior: '7000.00', valor_total: '21000.00', ultimas_ocorrencias: cinco('acao_civel', '0.00') },
    falencias_recuperacao_judicial: { valor: null, quantidade: null, quantidade_total: '2', ultimas_ocorrencias: { falencia_recuperacao_judicial: [{}, {}] } }
  });
  const q = C2.daRekta(real, '11222333000181', '2026-10-28');
  assert.deepEqual([q.protestos_qtd, q.protestos_valor, q.pendencias_qtd, q.pendencias_valor, q.acoes_qtd, q.falencia], [37, 15320.5, 9, 2840.1, 12, true]);
  const pouco = C2.daRekta(Object.assign({}, pj, { protestos: { valor: null, valor_maior: '300.00', valor_primeiro: '300.00', valor_total: '512.40', total_protestos: '2',
    ultimas_ocorrencias: { protesto: [{ valor: '300.00' }, { valor: '212.40' }] } } }), '11222333000181', '2026-10-28');
  assert.deepEqual([pouco.protestos_qtd, pouco.protestos_valor], [2, 512.4]);
  // sem total no topo: conta os itens e soma só o valor de cada um
  const semTotal = C2.daRekta(Object.assign({}, pj, { protestos: { valor_maior: '300.00', ultimas_ocorrencias: { protesto: [{ valor: '300.00' }, { valor: '212.40' }] } } }), '11222333000181');
  assert.deepEqual([semTotal.protestos_qtd, semTotal.protestos_valor], [2, 512.4]);
});
