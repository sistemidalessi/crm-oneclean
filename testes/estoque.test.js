'use strict';
// Estoque do CRM (Fase 2 da saída do FKN, 16/10/2026): regras puras da aba Estoque (estoque.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../estoque.js');

test('saldo do CRM ao lado do "atual" do FKN, sem as caixas fechadas', () => {
  const saldo = [{ codigo: 'A', descricao: 'DETERGENTE', unidade: 'GL', saldo: '10', custo_medio: '5.5', ult_mov: '2026-10-16T12:00:00Z' },
    { codigo: 'B', descricao: 'LUVA', unidade: 'PC', saldo: '-2', custo_medio: '3' }];
  const fkn = [{ codigo: 'A', descricao: 'DETERGENTE', estoque_atual: 12, quantidade: 9, pend_cliente: 3, fornecedor: 'FORN' },
    { codigo: 'A.1', descricao: 'DETERGENTE CX C/4', quantidade: 2 },
    { codigo: 'B', descricao: 'LUVA', quantidade: 5, pend_cliente: 1 }, // listagem antiga, sem o "atual": saldo + reservado
    { codigo: 'C', descricao: 'NOVO', estoque_atual: 4 }];
  const l = S.junta(saldo, fkn);
  assert.deepEqual(l.map(x => [x.codigo, x.saldo, x.fkn, x.dif]), [['A', 10, 12, 2], ['B', -2, 6, 8], ['C', null, 4, null]]);
  assert.equal(S.valor(l), 55, 'saldo negativo não vale no valor a custo');
});

test('dias seguidos sem diferença sem explicação (todas as listagens do dia)', () => {
  const f = (iso, n) => ({ gerado_em: iso, resumo: { diferentes: n + 2, sem_explicacao: n } });
  assert.deepEqual(S.sequencia([f('2026-10-18T16:00:00Z', 0), f('2026-10-18T10:00:00Z', 0), f('2026-10-17T16:00:00Z', 0), f('2026-10-16T16:00:00Z', 1), f('2026-10-15T16:00:00Z', 0)]),
    { dias: 2, desde: '2026-10-17', ultimoProblema: '2026-10-16' });
  assert.equal(S.sequencia([f('2026-10-18T16:00:00Z', 0), f('2026-10-18T10:00:00Z', 3)]).dias, 0, 'uma listagem ruim no dia derruba o dia');
  assert.equal(S.sequencia([{ gerado_em: '2026-10-18T16:00:00Z', resumo: null }]).dias, 0, 'listagem não conferida não conta');
});

test('contagem colada: ponto e vírgula, Tab, espaço, vírgula decimal e milhar com ponto', () => {
  const r = S.lerContagem('300005;120\n290027\t3.000\n010001 12,5\n010002;1.234,5\nlixo\n\n300005;118');
  assert.deepEqual(r.lote, [{ codigo: '300005', contado: 118 }, { codigo: '290027', contado: 3000 }, { codigo: '010001', contado: 12.5 }, { codigo: '010002', contado: 1234.5 }]);
  assert.deepEqual(r.erros, ['lixo']);
  assert.equal(S.lerContagem('A;12.5').lote[0].contado, 12.5, 'ponto sem grupo de milhar é decimal');
});

test('nota de compra do XML: itens com IPI, ST, frete e outras; custo na unidade do estoque; sugestão de produto', () => {
  const N = require('../nfe.js');
  const chave = '35261099888777000166550010000045671000045678';
  const xml = '<nfeProc versao="4.00"><NFe><infNFe versao="4.00" Id="NFe' + chave + '"><ide><mod>55</mod><serie>1</serie><nNF>4567</nNF><dhEmi>2026-10-16T09:00:00-03:00</dhEmi><tpNF>1</tpNF><finNFe>1</finNFe><natOp>VENDA</natOp></ide>' +
    '<emit><CNPJ>99888777000166</CNPJ><xNome>FORNECEDOR EXEMPLO LTDA</xNome></emit><dest><CNPJ>12345678000199</CNPJ><xNome>EMPRESA EXEMPLO</xNome></dest>' +
    '<det nItem="1"><prod><cProd>F-10</cProd><cEAN>SEM GTIN</cEAN><xProd>COPO PLASTICO 180ML BRANCO CX C/25</xProd><NCM>39241000</NCM><CFOP>5405</CFOP><uCom>CX</uCom><qCom>4</qCom><vUnCom>100</vUnCom><vProd>400.00</vProd><vFrete>20.00</vFrete><vSeg>1.00</vSeg><vOutro>4.00</vOutro><vDesc>10.00</vDesc></prod>' +
    '<imposto><ICMS><ICMS10><orig>0</orig><CST>10</CST><vBCST>480</vBCST><vICMSST>15.00</vICMSST></ICMS10></ICMS><IPI><IPITrib><CST>50</CST><vIPI>11.00</vIPI></IPITrib></IPI></imposto></det>' +
    '<det nItem="2"><prod><cProd>F-20</cProd><cEAN>SEM GTIN</cEAN><xProd>DETERGENTE NEUTRO 5L</xProd><NCM>34022000</NCM><CFOP>5102</CFOP><uCom>GL</uCom><qCom>10</qCom><vUnCom>20</vUnCom><vProd>200.00</vProd></prod><imposto></imposto></det>' +
    '<total><ICMSTot><vProd>600.00</vProd><vNF>651.00</vNF></ICMSTot></total><cobr><dup><nDup>001</nDup><dVenc>2026-11-15</dVenc><vDup>651.00</vDup></dup></cobr></infNFe></NFe>' +
    '<protNFe><infProt><chNFe>' + chave + '</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>';
  const d = N.lerXml(xml);
  const { compra, itens } = S.compraDoXml(d, xml, '12345678000199');
  assert.deepEqual([compra.numero, compra.fornecedor_doc, compra.valor_total, compra.parcelas.length], [4567, '99888777000166', 651, 1]);
  assert.deepEqual([itens[0].valor_total, itens[0].ipi, itens[0].st, itens[0].frete, itens[0].outras], [390, 11, 15, 20, 5], 'vProd − vDesc, IPI, ST, frete, seguro + outras');
  // 4 caixas de 25 pacotes = 100 pacotes: (390 + 11 + 15 + 20 + 5) / 100
  assert.equal(S.custoItem(itens[0], 25), 4.41);
  assert.equal(S.custoItem(itens[1], 1), 20);
  assert.throws(() => S.compraDoXml(d, xml, '99888777000166'), /saída da própria empresa/);
  assert.throws(() => S.compraDoXml(d, xml, '11111111000111'), /não é para a nossa empresa/);
  const produtos = [{ codigo: '150034', descricao: 'COPO 180 ML BRANCO PLASTICO', unidade: 'PT' }, { codigo: '010001', descricao: 'DETERGENTE NEUTRO 5L', unidade: 'GL' }];
  const ctx = { vinculos: new Map([['99888777000166|F-10', { codigo: '150034', fator: 25 }]]), produtos, unidades: new Map() };
  assert.deepEqual(S.sugere(itens[0], '99888777000166', ctx), { codigo: '150034', fator: 25, como: 'ligado antes' });
  assert.deepEqual(S.sugere(itens[1], '99888777000166', ctx), { codigo: '010001', fator: 1, como: 'descrição parecida (confira)' });
  assert.deepEqual(S.sugere({ descricao: 'LUVA NITRILICA', unidade: 'CX' }, 'x', ctx).codigo, null, 'nada parecido: o comprador escolhe');
});
