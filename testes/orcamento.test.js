'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../orcamento.js');

// Mesmo formato do orçamento do FKN salvo em CSV (dados fictícios).
const pad = (a, b) => a.padEnd(81) + b;
const CAB = [
  '', '',
  pad('', 'PROPOSTA:            12.345;'),
  pad('ESCOLA EXEMPLO LTDA', 'VERSÃO:                   2;'),
  pad('RUA DAS FLORES 100', 'PAG:                      1;'),
  pad('09000-000  CENTRO            SANTO ANDRE               SP', 'EMISSÃO:         02/10/2026;'),
  pad('CNPJ: 11.222.333/0001-81     I.E.: 123456789', 'COD.CLI:               1234;'),
  pad('A/C SR(A): MARIA', 'TEL:        (11) 4000-0000;'),
  pad('REF: REPOSIÇÃO MENSAL', 'VÁLIDO ATÉ:      09/10/2026;'),
  pad('EMAIL: compras@exemplo.com.br', 'SEU PEDIDO: 77;'),
  '-'.repeat(111) + ';',
  ' IT; CÓDIGO; NOME DO PRODUTO; UN;         QTDE;   PREÇO UNIT; %DESC;   PREÇO TOTAL;',
  '-'.repeat(111) + ';'
];
const ITENS = [
  '  1; 010049.0; DETERGENTE 5 LTS NEUTRO; GL;           50;      15,4700;;        773,50;',
  '  2; 370102.0; SACO P/ LIXO 60 LTS PRETO; PT;           40;      69,8800;;      2.795,20;',
  '  3; 220005.0; RODO PLASTICO 60 CM; UN;           10;      10,0000;  5,00;         95,00;'
];
const RODAPE = [
  '', '',
  '                       FRETE R$:;       12,30 0-Remetente (CIF)              VALOR TOTAL  R$:;      3.676,00;',
  '-'.repeat(111) + ';',
  'Cond. pagamento....: 28/35/42 DIAS                                               Cobrança:   BOLETO;',
  'Prazo entrega......: 3 DIAS UTEIS                                                Vendedor:   ANA;',
  'Transportadora.....: PROPRIO;',
  '-'.repeat(111) + ';',
  'Local de entrega...: ENDEREÇO DE ENTREGA;',
  'Endereço de entrega: RUA DAS FLORES , 100   Bairro: CENTRO - SANTO ANDRE SP Cep: 09000 000;'
];
const CSV = CAB.concat(ITENS, RODAPE).join('\r\n');

test('lê cabeçalho, cliente, itens e rodapé do orçamento do FKN', () => {
  const o = O.lerOrcamentoFKN(CSV);
  assert.equal(o.numero, '12345');
  assert.equal(o.versao, 2);
  assert.equal(o.emissao, '2026-10-02');
  assert.equal(o.validade, '2026-10-09');
  assert.deepEqual([o.cliente.nome, o.cliente.endereco, o.cliente.cep, o.cliente.bairro, o.cliente.cidade, o.cliente.uf],
    ['ESCOLA EXEMPLO LTDA', 'RUA DAS FLORES 100', '09000-000', 'CENTRO', 'SANTO ANDRE', 'SP']);
  assert.equal(o.cliente.doc, '11222333000181');
  assert.equal(o.cliente.ie, '123456789');
  assert.equal(o.cliente.codigo, '1234');
  assert.equal(o.cliente.telefone, '(11) 4000-0000');
  assert.equal(o.cliente.email, 'compras@exemplo.com.br');
  assert.equal(o.ac, 'MARIA');
  assert.equal(o.ref, 'REPOSIÇÃO MENSAL');
  assert.equal(o.seu_pedido, '77');
  assert.equal(o.itens.length, 3);
  assert.deepEqual(o.itens[0], { item: 1, codigo: '010049', descricao: 'DETERGENTE 5 LTS NEUTRO', unidade: 'GL', quantidade: 50, preco: 15.47, desconto: 0, total: 773.5 });
  assert.equal(o.itens[1].total, 2795.2);
  assert.equal(o.itens[2].desconto, 5);
  assert.equal(o.frete, 12.3);
  assert.equal(o.frete_tipo, '0-Remetente (CIF)');
  assert.equal(o.total, 3676);
  assert.equal(o.pagamento, '28/35/42 DIAS');
  assert.equal(o.cobranca, 'BOLETO');
  assert.equal(o.prazo_entrega, '3 DIAS UTEIS');
  assert.equal(o.vendedor, 'ANA');
  assert.equal(o.transportadora, 'PROPRIO');
  assert.match(o.endereco_entrega, /^RUA DAS FLORES , 100 Bairro: CENTRO - SANTO ANDRE SP/);
  assert.equal(o.soma, 3663.7);
  assert.equal(o.confere, true); // itens + frete = total
});

test('prazo de entrega vazio não pega o "Vendedor:" e o preço de 4 casas não vira milhar', () => {
  const t = CSV.replace('3 DIAS UTEIS', '            ').replace('15,4700', '15,4700');
  const o = O.lerOrcamentoFKN(t);
  assert.equal(o.prazo_entrega, null);
  assert.equal(o.vendedor, 'ANA');
  assert.equal(o.itens[0].preco, 15.47);
});

test('orçamento de duas páginas: cabeçalho repetido não duplica itens', () => {
  const o = O.lerOrcamentoFKN(CAB.concat(ITENS.slice(0, 2), CAB, ITENS.slice(1), RODAPE).join('\n'));
  assert.equal(o.itens.length, 3);
  assert.deepEqual(o.itens.map(x => x.item), [1, 2, 3]);
});

test('soma que não bate com o total é avisada', () => {
  const o = O.lerOrcamentoFKN(CSV.replace('3.676,00', '9.999,00'));
  assert.equal(o.confere, false);
});

test('recusa arquivo que não é orçamento ou sem itens', () => {
  assert.throws(() => O.lerOrcamentoFKN('CLIENTE;VALOR\nX;1'), /não parece um orçamento/);
  assert.throws(() => O.lerOrcamentoFKN(CAB.concat(RODAPE).join('\n')), /não tem itens/);
  assert.equal(O.ehOrcamentoFKN(CSV), true);
});

test('condições em texto para a proposta', () => {
  const t = O.condicoesTexto(O.lerOrcamentoFKN(CSV));
  assert.match(t, /^Pagamento: 28\/35\/42 DIAS \(boleto\)/);
  assert.match(t, /Prazo de entrega: 3 DIAS UTEIS/);
  assert.match(t, /Frete: R\$\s?12,30 — Remetente \(CIF\)/);
  assert.match(t, /Transporte: próprio/);
});

test('atualização do orçamento continua no mesmo negócio', () => {
  const ab = [{ id: 'a', titulo: 'Antigo do Agendor' }, { id: 'b', titulo: 'Orçamento 100' }, { id: 'c', titulo: 'Outro' }];
  const props = [{ negocio_id: 'b', numero_fkn: '100', numero: 1, criado_em: '2026-10-05T10:00' }, { negocio_id: 'z', numero_fkn: '90', numero: 0, criado_em: '2026-10-06' }];
  // mesmo número reimportado → negócio da proposta, e ele vem primeiro na lista
  let r = O.negocioDoOrcamento(null, props[0], ab, props);
  assert.equal(r.padrao, 'b'); assert.equal(r.abertos[0].id, 'b');
  // número novo do FKN, mesmo cliente → negócio aberto que já tem orçamento do FKN
  r = O.negocioDoOrcamento(null, null, ab, props);
  assert.equal(r.padrao, 'b');
  // importado de dentro da ficha → manda o negócio da ficha
  assert.equal(O.negocioDoOrcamento('c', props[0], ab, props).padrao, 'c');
  // proposta antiga em negócio já fechado e vários abertos sem FKN → negócio novo
  assert.equal(O.negocioDoOrcamento(null, props[1], [ab[0], ab[2]], props).padrao, 'novo');
  // um só aberto → ele
  assert.equal(O.negocioDoOrcamento(null, null, [ab[0]], []).padrao, 'a');
});
