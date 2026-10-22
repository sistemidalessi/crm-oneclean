'use strict';
// Tabela do IBPT pela API (crm-fiscal/ibpt.js): endereço da consulta, leitura da resposta e o que precisa atualizar.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../supabase/functions/crm-fiscal/ibpt.js');

test('ibpt: endereço da consulta com todos os parâmetros', () => {
  const u = new URL(I.ibptUrl('TOK', '12.345.678/0001-99', '3402.50.00', 'sp'));
  assert.equal(u.origin + u.pathname, 'https://apidoni.ibpt.org.br/api/v1/produtos');
  assert.equal(u.searchParams.get('cnpj'), '12345678000199'); assert.equal(u.searchParams.get('codigo'), '34025000');
  assert.equal(u.searchParams.get('uf'), 'SP'); assert.equal(u.searchParams.get('ex'), '0'); assert.equal(u.searchParams.get('token'), 'TOK');
});

test('ibpt: resposta da API vira a linha de crm_ibpt; resposta incompleta não grava', () => {
  const l = I.ibptLinha('34025000', { Codigo: '34025000', UF: 'SP', EX: 0, Descricao: 'Preparações para lavagem', Nacional: 13.45, Estadual: 18, Importado: 15.1, Municipal: 0,
    VigenciaInicio: '20/10/2026', VigenciaFim: '31/12/2026', Chave: 'A1B2C3', Versao: '26.2.B', Fonte: 'IBPT/empresometro.com.br' });
  assert.deepEqual([l.codigo, l.ex, l.nac_fed, l.estadual, l.imp_fed, l.municipal, l.vig_ini, l.vig_fim, l.versao], ['34025000', '', 13.45, 18, 15.1, 0, '2026-10-20', '2026-12-31', '26.2.B']);
  assert.equal(I.ibptLinha('34025000', { nacional: '4,2', estadual: '12', vigenciafim: '2026-12-31T00:00:00' }).nac_fed, 4.2);
  assert.equal(I.ibptLinha('1', { Message: 'Token inválido' }), null);
  assert.equal(I.ibptLinha('1', null), null);
});

test('ibpt: atualiza o NCM sem linha e o que vence em até 7 dias', () => {
  const linhas = [{ codigo: 'A', vig_fim: '2026-12-31' }, { codigo: 'B', vig_fim: '2026-10-25' }, { codigo: 'C', vig_fim: null }];
  assert.deepEqual(I.ibptPrecisa(['A', 'B', 'C', 'D'], linhas, '2026-10-22', 7), ['B', 'C', 'D']);
  assert.deepEqual(I.ibptPrecisa(['A'], linhas, '2026-12-28', 7), ['A']);
});
