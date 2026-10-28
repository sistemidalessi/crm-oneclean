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

test('teto de 10% do limite da consulta e arredondamento de 500 em 500', () => {
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 20000 }), { compra_mensal: 1800, hoje }).limite, 2000);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 0 }), { compra_mensal: 1800, hoje }).limite, 4000);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 3000 }), { compra_mensal: 1500, hoje }).situacao, 'vista');
});

test('sem compra prevista vale o histórico; título vencido com a OneClean: em análise', () => {
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 0 }), { maior_mes: 2600, hoje }).limite, 5500);
  assert.strictEqual(C.propor(MBS, { maior_mes: 2600, hoje }).limite, 4500);
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
