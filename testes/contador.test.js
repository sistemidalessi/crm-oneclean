'use strict';
// Fechamento do mês para a contabilidade (crm-contador): quais XML entram, a relação e o texto do e-mail. Dados fictícios.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../supabase/functions/crm-contador/contador.js');

const CNPJ = '11222333000181';
const chave = (aamm, serie, num, cnpj = CNPJ, mod = '55') => '35' + aamm + cnpj + mod + String(serie).padStart(3, '0') + String(num).padStart(9, '0') + '1' + '00000001' + '0';
const xml = (num, { tp = '1', v = 100, dest = 'Cliente ' + num, nat = 'VENDA' } = {}) =>
  '<nfeProc><NFe><infNFe><ide><natOp>' + nat + '</natOp><nNF>' + num + '</nNF><dhEmi>2026-10-1' + (num % 9) + 'T10:00:00-03:00</dhEmi><tpNF>' + tp + '</tpNF></ide>' +
  '<dest><CNPJ>99888777000166</CNPJ><xNome>' + dest + '</xNome></dest><total><ICMSTot><vNF>' + v.toFixed(2) + '</vNF></ICMSTot></total></infNFe></NFe>' +
  '<protNFe><infProt><nProt>135260000000' + num + '</nProt></infProt></protNFe></nfeProc>';

test('as chaves do mês: só do emitente, modelo 55 e com o AAMM da emissão, em ordem', () => {
  assert.equal(C.aammDe('2026-10'), '2610');
  assert.equal(C.mesAnterior('2026-11-02'), '2026-10');
  assert.equal(C.mesAnterior('2027-01-02'), '2026-12');
  assert.equal(C.mesExtenso('2026-10'), 'outubro/2026');
  const l = [chave('2610', 1, 12), chave('2610', 1, 10), chave('2611', 1, 13), chave('2610', 1, 11, '99888777000166'), chave('2610', 1, 14, CNPJ, '65'), 'lixo'];
  assert.deepEqual(C.doMes(l, CNPJ, '2026-10').map(k => C.chaveInfo(k).numero), [10, 12]);
});

test('o fechamento: XML de todas, canceladas do FKN e do CRM, denegada, inutilização e os números pulados', () => {
  const ks = [10, 11, 12, 13, 15, 18].map(n => chave('2610', 1, n));
  const xmls = ks.map((k, i) => ({ chave: k, xml: xml([10, 11, 12, 13, 15, 18][i], { tp: i === 3 ? '0' : '1', v: 100 + i }) }));
  const nfes = [{ chave: ks[4], situacao: 'cancelada', eventos: [{ tipo: 'cancelar', protocolo: '1352', quando: '2026-10-20T15:00:00Z', texto: 'erro no pedido', xml: '<procEventoNFe/>' }] },
    { chave: ks[5], situacao: 'denegada', protocolo: '9', motivo: 'destinatário irregular' }];
  const notas = [{ chave: ks[1], cancelada: true }];
  const inuts = [{ ambiente: 'producao', cstat: 102, serie: 1, de: 16, ate: 16, criado_em: '2026-10-21T13:00:00Z', protocolo: '777', justificativa: 'pulou', xml: '<procInutNFe/>' },
    { ambiente: 'homologacao', cstat: 102, serie: 1, de: 17, ate: 17, criado_em: '2026-10-21T13:00:00Z' }];
  const r = C.montar({ mes: '2026-10', xmls, nfes, notas, inuts });
  assert.equal(r.notas, 6);
  assert.equal(r.canceladas, 2, 'a do FKN (crm_notas) e a do CRM (crm_nfe)');
  assert.equal(r.denegadas, 1);
  assert.equal(r.inutilizadas, 1, 'só a de produção do mês');
  assert.equal(r.entradas, 1);
  assert.deepEqual(r.sem_xml, [{ serie: 1, numero: 14 }, { serie: 1, numero: 17 }], '16 foi inutilizado; 14 e 17 não têm XML');
  assert.equal(r.valor, 100 + 102, 'autorizadas de saída: a 10 e a 12 (a 13 é entrada)');
  const nomes = r.arquivos.map(a => a.nome);
  assert.equal(nomes.filter(n => /-procNFe\.xml$/.test(n)).length, 6);
  assert.ok(nomes.includes('NFe' + ks[4] + '-procEventoCanc.xml'));
  assert.ok(nomes.some(n => /^Inut-serie1-16-procInutNFe\.xml$/.test(n)));
  const rel = r.arquivos.find(a => /^relacao-/.test(a.nome)).conteudo;
  assert.match(rel, /CANCELADA;1;11;.*cancelada no FKN/);
  assert.match(rel, /CANCELADA;1;15;.*;20\/10\/2026;1352;erro no pedido/);
  assert.match(rel, /DENEGADA;1;18;/);
  assert.match(rel, /INUTILIZADA;1;16;;21\/10\/2026;777;pulou/);
  assert.match(rel, /SEM XML NO CRM;1;14;/);
  const lista = r.arquivos.find(a => a.nome === 'notas-2026-10.csv').conteudo;
  assert.match(lista, /1;13;1\d\/10\/2026;entrada;VENDA;Cliente 13;99888777000166;103,00;autorizada/);
  const t = C.textoEmail(r, { mes: '2026-10', empresa: 'Empresa Exemplo', link: 'https://exemplo/zip' });
  assert.match(t, /emitidas pela Empresa Exemplo em outubro\/2026/);
  assert.match(t, /Canceladas: 2 — NF 1-11 \(Cliente 11, R\$ 101,00\); NF 1-15/);
  assert.match(t, /Números sem XML no nosso sistema .*: 1-14, 1-17\./);
  assert.match(t, /https:\/\/exemplo\/zip/);
});
