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

test('notas da Sefaz: fornecedor que nunca vendeu e o prazo da resposta definitiva', () => {
  const S = require('../estoque.js');
  const dfe = [
    { chave: 'a', situacao: 'autorizada', emitente_doc: '111', emitente_nome: 'CONHECIDO LTDA', emitida_em: '2026-08-01T10:00:00-03:00', valor: 10 },
    { chave: 'b', situacao: 'autorizada', emitente_doc: '222', emitente_nome: 'AUDAX QUIMICA LTDA', emitida_em: '2026-10-10T10:00:00-03:00', valor: 50 },
    { chave: 'c', situacao: 'autorizada', emitente_doc: '333', emitente_nome: 'NOTA ESTRANHA LTDA', emitida_em: '2026-08-01T10:00:00-03:00', valor: 900 },
    { chave: 'd', situacao: 'autorizada', emitente_doc: '333', emitente_nome: 'NOTA ESTRANHA LTDA', emitida_em: '2026-07-01T10:00:00-03:00', valor: 5, conclusiva_tipo: 'desconhecimento' },
    { chave: 'e', situacao: 'cancelada', emitente_doc: '444', emitente_nome: 'CANCELADA SA', emitida_em: '2026-10-01T10:00:00-03:00', valor: 1 },
    { chave: 'f', situacao: 'autorizada', emitente_doc: '555', emitente_nome: 'MARCADO CONHECIDO', emitida_em: '2026-07-25T10:00:00-03:00', valor: 3 }];
  const base = { dfe, hoje: '2026-10-19', prazoDias: 90, avisoDias: 30, conhecidos: new Set(['111']),
    docs: [{ doc: '333', situacao: 'desconhecido' }, { doc: '555', situacao: 'conhecido' }],
    fknForn: [{ cod: '00059', nome: 'SALES EQUIP E PROD HIG PROF LTDA' }, { cod: '00207', nome: 'AUDAX QUIMICA INDUSTRIA E COMERCIO DE PR' }] };
  const r = S.avisosDfe(base);
  assert.deepEqual(r.desconhecidos.map(g => [g.doc, g.sugestao && g.sugestao.cod]), [['222', '00207']], 'só o CNPJ nunca visto; a cancelada não conta');
  assert.deepEqual(r.naoReconhecidos.map(g => [g.doc, g.notas.length, g.semResposta]), [['333', 2, 1]]);
  // 01/08 + 90 dias = 30/10: faltam 11 dias; a já respondida (d) sai; sem "todas", só a do não reconhecido
  assert.deepEqual(r.prazos.map(p => [p.chave, p.vence, p.resta, p.desconhecido]), [['c', '2026-10-30', 11, true]]);
  const t = S.avisosDfe(Object.assign({}, base, { todas: true }));
  assert.deepEqual(t.prazos.map(p => p.chave), ['f', 'a', 'c'], 'com "todas": também as de fornecedor conhecido, a mais apertada primeiro');
  assert.equal(S.sugereFornecedor('LTDA COMERCIO', base.fknForn), null, 'só palavras genéricas não sugerem');
});

test('ICMS-ST de cada item da nota de compra (stDoDet): substituto, quem revendeu e sem ST', () => {
  const S = require('../estoque.js');
  const det = icms => '<prod><cProd>1</cProd></prod><imposto><ICMS>' + icms + '</ICMS></imposto>';
  assert.deepEqual(S.stDoDet(det('<ICMS10><orig>0</orig><CST>10</CST><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS><vBCST>140.00</vBCST><pICMSST>18.00</pICMSST><vICMSST>7.20</vICMSST></ICMS10>')),
    { st_cst: '10', st_base: 140, st_aliq: 18, st_proprio: 18, st_valor: 7.2 });
  assert.deepEqual(S.stDoDet(det('<ICMS60><orig>0</orig><CST>60</CST><vBCSTRet>84.80</vBCSTRet><pST>18.00</pST><vICMSSubstituto>8.50</vICMSSubstituto><vICMSSTRet>6.70</vICMSSTRet></ICMS60>')),
    { st_cst: '60', st_base: 84.8, st_aliq: 18, st_proprio: 8.5, st_valor: 6.7 });
  assert.deepEqual(S.stDoDet(det('<ICMS60><orig>0</orig><CST>60</CST></ICMS60>')), { st_cst: '60', st_base: null, st_aliq: null, st_proprio: null, st_valor: null });
  assert.deepEqual(S.stDoDet(det('<ICMSSN202><orig>0</orig><CSOSN>202</CSOSN><vBCST>50.00</vBCST><pICMSST>18.00</pICMSST><vICMSST>2.00</vICMSST></ICMSSN202>')),
    { st_cst: '202', st_base: 50, st_aliq: 18, st_proprio: null, st_valor: 2 });
  assert.deepEqual(S.stDoDet(det('<ICMS00><orig>0</orig><CST>00</CST><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS00>')),
    { st_cst: '00', st_base: null, st_aliq: null, st_proprio: null, st_valor: null });
});

test('chegou? nota de compra pendente × última entrada no FKN', () => {
  const compras = [
    { id: 'a', emitida_em: '2026-10-20T13:00:00Z', fornecedor_nome: 'LEALPLASTIC INDUSTRIA PLASTICA LTDA' },
    { id: 'b', emitida_em: '2026-10-20T13:00:00Z', fornecedor_nome: 'LEALPLASTIC INDUSTRIA PLASTICA LTDA' },
    { id: 'c', emitida_em: '2026-10-20T13:00:00Z', fornecedor_nome: 'POLAR IND COM PAPEIS DESCART LTDA' },
    { id: 'd', emitida_em: '2026-10-20T13:00:00Z', fornecedor_nome: 'NINGUEM CONHECIDO SA' },
    { id: 'e', emitida_em: '2026-10-22T13:00:00Z', fornecedor_nome: 'POLAR IND COM PAPEIS DESCART LTDA' }];
  const fkn = [{ codigo: '100', fornecedor_cod: '00005', ult_entrada: '2026-10-21' }, { codigo: '100.1', fornecedor_cod: '00005', ult_entrada: '2026-10-21' },
    { codigo: '101', fornecedor_cod: '00005', ult_entrada: '2026-10-01' }, { codigo: '200', fornecedor_cod: '00010', ult_entrada: '2026-10-20' }];
  const itensProd = [{ compra_id: 'a', codigo: '100.1' }, { compra_id: 'a', codigo: '101' }, { compra_id: 'b', codigo: '101' }];
  const fknForn = [{ cod: '00005', nome: 'LEALPLASTIC INDUSTRIA PLASTICA LTDA EPP' }, { cod: '00010', nome: 'POLAR IND COM PAPEIS DESCART LTDA' }];
  const r = S.chegadaCompras({ compras, itensProd, fkn, fknForn });
  assert.deepEqual(r.get('a'), { estado: 'chegou', em: '2026-10-21', ligados: 2, comEntrada: 1 }, 'a caixa (.1) conta como o produto');
  assert.equal(r.get('b').estado, 'aguardando', 'entrada do produto antes da emissão não é desta nota');
  assert.equal(r.get('c').estado, 'provavel'); assert.equal(r.get('c').em, '2026-10-20');
  assert.equal(r.get('d').estado, 'sem_dado');
  assert.equal(r.get('e').estado, 'aguardando', 'fornecedor achado, mas sem entrada depois da emissão');
});
