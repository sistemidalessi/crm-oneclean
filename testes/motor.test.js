'use strict';
// A Edge Function crm-notas baixa regras.js e nfe.js do GitHub num commit fixo e confere o SHA-256.
// Se as regras mudarem e ninguém fixar a versão nova, o vigia seguiria as regras antigas: este
// teste pega (rode node ferramentas/fixa-motor-notas.js depois do push e publique a função).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { hashesAtuais } = require('../ferramentas/fixa-motor-notas.js');

test('a Edge Function crm-notas está fixada nas regras atuais', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'crm-notas', 'index.ts'), 'utf8');
  const h = hashesAtuais();
  assert.match(s, /const COMMIT = '[0-9a-f]{40}';/, 'sem commit fixado');
  assert.ok(s.includes("'regras.js': '" + h['regras.js'] + "'"), 'regras.js mudou: rode node ferramentas/fixa-motor-notas.js e publique a função');
  assert.ok(s.includes("'nfe.js': '" + h['nfe.js'] + "'"), 'nfe.js mudou: rode node ferramentas/fixa-motor-notas.js e publique a função');
  assert.ok(s.includes("'fkn.js': '" + h['fkn.js'] + "'"), 'fkn.js mudou: rode node ferramentas/fixa-motor-notas.js e publique a função');
});

test('regras.js e nfe.js rodam do jeito que a Edge Function carrega (sem module, sem window)', () => {
  const regras = fs.readFileSync(path.join(__dirname, '..', 'regras.js'), 'utf8');
  const nfe = fs.readFileSync(path.join(__dirname, '..', 'nfe.js'), 'utf8');
  const g = {};
  // Mesmo truque da função: sem "module" nem "require" à vista.
  new Function('module', 'require', regras).call(g, undefined, undefined);
  const falso = { CRMRegras: g.CRMRegras, CRMDados: { uuid: () => require('crypto').randomUUID() } };
  new Function('module', 'require', 'globalThis', 'window', nfe.replace('typeof window !== \'undefined\' ? window : globalThis', 'window'))(undefined, undefined, falso, falso);
  const N = falso.CRMNfe;
  const xml = '<nfeProc><NFe><infNFe Id="NFe' + '3'.repeat(44) + '"><ide><mod>55</mod><nNF>9</nNF><dhEmi>2026-09-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>' +
    '<emit><CNPJ>11222333000181</CNPJ><xNome>Distribuidora</xNome></emit><dest><CNPJ>44555666000199</CNPJ><xNome>Cliente</xNome></dest>' +
    '<total><ICMSTot><vNF>10.00</vNF></ICMSTot></total><infAdic><infCpl>PORTADOR: BOLETO;VENDEDOR: ANA;COD. CLIENTE: 01;</infCpl></infAdic></infNFe></NFe></nfeProc>';
  const d = N.lerXml(xml);
  assert.equal(d.vendedor, 'ANA');
  const pl = N.planeja({ usuarios: [{ user_id: 'u1', nome: 'Ana Souza', ativo: true }], empresas: [], produtos: [], opcoes: [], notas: [] }, [d], { filtro: 'auto' });
  assert.equal(pl.criar.notas.length, 1);
  assert.equal(pl.criar.empresas[0].responsavel_id, 'u1');
});

test('fkn.js roda do jeito que a Edge Function carrega (sem module, sem require)', () => {
  const regras = fs.readFileSync(path.join(__dirname, '..', 'regras.js'), 'utf8');
  const fkn = fs.readFileSync(path.join(__dirname, '..', 'fkn.js'), 'utf8');
  const g = {};
  new Function('module', 'require', regras).call(g, undefined, undefined);
  const falso = { CRMRegras: g.CRMRegras };
  new Function('module', 'require', 'globalThis', 'window', fkn.replace("typeof window !== 'undefined' ? window : globalThis", 'window'))(undefined, undefined, falso, falso);
  const K = falso.CRMFkn;
  assert.ok(K && K.lerContasReceber && K.lerListagemProdutos && K.ligaEmpresas);
  assert.ok(K.ehContasReceber('X;\nCONTAS A RECEBER POR CLIENTE: EM ABERTO;'));
  assert.equal(K.codigoFKN('010503.0'), '010503');
});

test('a Edge Function crm-caixa-leitura está fixada no caixa-calculo.js atual e ele roda do jeito que ela carrega', () => {
  const { hashesDe, arquivoDa } = require('../ferramentas/fixa-motor-notas.js');
  const s = fs.readFileSync(arquivoDa('crm-caixa-leitura'), 'utf8');
  const h = hashesDe(['caixa-calculo.js']);
  assert.match(s, /const COMMIT = '[0-9a-f]{40}';/, 'sem commit fixado');
  assert.ok(s.includes("'caixa-calculo.js': '" + h['caixa-calculo.js'] + "'"), 'caixa-calculo.js mudou: rode node ferramentas/fixa-motor-notas.js e publique a crm-caixa-leitura');
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'caixa-calculo.js'), 'utf8');
  const g = {};
  new Function('module', 'require', 'globalThis', 'window', codigo)(undefined, undefined, g, g);
  const r = g.CRMCaixa.resumoLeitura({ lancamentos: [], saldos: [{ data: '2026-10-05', valor: 8052.79 }], titulos: [] }, { hoje: '2026-10-06', dias: 30 });
  assert.deepEqual([r.empresa, r.saldo.atual, r.proximos_dias.length, r.periodo.ate], ['oneclean', 8052.79, 30, '2026-11-04']);
});
