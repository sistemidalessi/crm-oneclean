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
