'use strict';
// Notas fictícias (CNPJs e nomes inventados) no formato oficial da NF-e 4.00.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../regras.js');
const N = require('../nfe.js');

const EMIT = '11222333000181';
const base = () => ({ usuarios: [], etapas: [], opcoes: [], produtos: [], metas: [], empresas: [], contatos: [], negocios: [], negocio_itens: [], propostas: [], atividades: [], notas: [], nota_itens: [] });
const chave = n => ('3526091122233300018155001' + String(n).padStart(9, '0') + '1').padEnd(44, '0').slice(0, 44);

function xml({ n, dest, cnpjDest, itens, tpNF = '1', finNFe = '1', cStat = '100', emit = EMIT, data = '2026-09-15T10:30:00-03:00', prefixo = '' }) {
  const t = (tag, v) => '<' + prefixo + tag + '>' + v + '</' + prefixo + tag + '>';
  const det = itens.map((it, i) => '<' + prefixo + 'det nItem="' + (i + 1) + '">' + t('prod',
    t('cProd', it.cod) + t('cEAN', 'SEM GTIN') + t('xProd', it.desc) + t('NCM', '34022000') + t('CFOP', it.cfop || '5102') + t('uCom', it.un || 'UN') +
    t('qCom', it.q.toFixed(4)) + t('vUnCom', it.p.toFixed(10)) + t('vProd', (it.q * it.p).toFixed(2)) + (it.desc0 ? t('vDesc', it.desc0.toFixed(2)) : '')) +
    t('imposto', t('ICMS', '')) + '</' + prefixo + 'det>').join('');
  const vProd = itens.reduce((s, it) => s + it.q * it.p, 0);
  const nfe = '<' + prefixo + 'NFe xmlns="http://www.portalfiscal.inf.br/nfe"><' + prefixo + 'infNFe versao="4.00" Id="NFe' + chave(n) + '">' +
    t('ide', t('cUF', '35') + t('natOp', 'VENDA DE MERCADORIA') + t('mod', '55') + t('serie', '1') + t('nNF', n) + t('dhEmi', data) + t('tpNF', tpNF) + t('finNFe', finNFe)) +
    t('emit', t('CNPJ', emit) + t('xNome', 'DISTRIBUIDORA EXEMPLO LTDA') + t('enderEmit', t('xMun', 'São Bernardo do Campo') + t('UF', 'SP'))) +
    t('dest', (cnpjDest ? t('CNPJ', cnpjDest) : t('CPF', '12345678909')) + t('xNome', dest) + t('enderDest', t('xLgr', 'Rua Um') + t('nro', '10') + t('xBairro', 'Centro') + t('xMun', 'Santo André') + t('UF', 'SP') + t('CEP', '09000000') + t('fone', '1140000000')) + t('email', 'Compras@Exemplo.com.br')) +
    det + t('total', t('ICMSTot', t('vProd', vProd.toFixed(2)) + t('vNF', (vProd - itens.reduce((s, it) => s + (it.desc0 || 0), 0)).toFixed(2)))) +
    '</' + prefixo + 'infNFe></' + prefixo + 'NFe>';
  return '<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">' + nfe +
    '<protNFe versao="4.00"><infProt><chNFe>' + chave(n) + '</chNFe><cStat>' + cStat + '</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>';
}
const cancelamento = n => '<procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><evento versao="1.00"><infEvento Id="ID110111' + chave(n) + '01">' +
  '<chNFe>' + chave(n) + '</chNFe><tpEvento>110111</tpEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento></detEvento></infEvento></evento>' +
  '<retEvento versao="1.00"><infEvento><cStat>135</cStat><chNFe>' + chave(n) + '</chNFe></infEvento></retEvento></procEventoNFe>';

test('lê a NF-e: cabeçalho, cliente, itens com desconto, total e protocolo', () => {
  const d = N.lerXml(xml({ n: 1234, dest: 'ESCOLA MODELO &amp; CIA LTDA', cnpjDest: '44555666000199',
    itens: [{ cod: 'DET5', desc: 'Detergente 5L', q: 10, p: 12.5, desc0: 5 }, { cod: 'PAP', desc: 'Papel toalha', q: 2, p: 30, cfop: '5405' }] }));
  assert.equal(d.tipo, 'nota');
  assert.equal(d.chave, chave(1234));
  assert.equal(d.numero, 1234);
  assert.equal(d.emitente.doc, EMIT);
  assert.equal(d.cliente.nome, 'ESCOLA MODELO & CIA LTDA');
  assert.equal(d.cliente.doc, '44555666000199');
  assert.equal(d.cliente.cidade, 'Santo André');
  assert.equal(d.itens.length, 2);
  assert.deepEqual([d.itens[0].quantidade, d.itens[0].valor_unitario, d.itens[0].valor_total], [10, 12.5, 120]);
  assert.equal(d.itens[1].cfop, '5405');
  assert.equal(d.valor_total, 180);
  assert.equal(d.autorizada, true);
  assert.equal(d.saida, true);
});

test('lê XML com prefixo de namespace e evento de cancelamento; ignora o que não é NF-e', () => {
  const d = N.lerXml(xml({ n: 7, dest: 'Cliente', cnpjDest: '44555666000199', itens: [{ cod: 'A', desc: 'A', q: 1, p: 1 }], prefixo: 'nfe:' }));
  assert.equal(d.numero, 7);
  assert.equal(d.itens.length, 1);
  assert.deepEqual(N.lerXml(cancelamento(7)), { tipo: 'cancelamento', chave: chave(7) });
  assert.equal(N.lerXml('<outro>nada</outro>'), null);
  assert.equal(N.lerXml(cancelamento(7).replace('<tpEvento>110111', '<tpEvento>110110')), null, 'carta de correção não cancela');
});

test('planeja: liga pela razão social ou pelo nome antes do "|", completa o CNPJ, cria cliente novo com segmento', () => {
  const D = base();
  D.usuarios = [{ user_id: 'u1', nome: 'Vendedora Um' }];
  D.empresas = [
    { id: 'e1', nome: 'ESCOLA MODELO | Joana', situacao: 'lead', responsavel_id: 'u1' },
    { id: 'e2', nome: 'Metal Forte', razao_social: 'METAL FORTE INDUSTRIA E COMERCIO LTDA', cnpj: null, situacao: 'cliente' }
  ];
  D.produtos = [{ id: 'p1', nome: 'Detergente 5L', codigo: 'DET5', preco: 12 }];
  const docs = [
    xml({ n: 1, dest: 'ESCOLA MODELO', cnpjDest: '44555666000199', itens: [{ cod: 'DET5', desc: 'Detergente 5L', q: 10, p: 12.5 }] }),
    xml({ n: 2, dest: 'METAL FORTE INDUSTRIA E COMERCIO LTDA', cnpjDest: '77888999000155', itens: [{ cod: 'LUVA', desc: 'Luva nitrílica', q: 100, p: 0.8 }] }),
    xml({ n: 3, dest: 'Condominio Residencial Aurora', cnpjDest: '12121212000112', itens: [{ cod: 'SACO', desc: 'Saco de lixo 100L', q: 5, p: 20 }], data: '2026-09-20T09:00:00-03:00' }),
    xml({ n: 4, dest: 'Condominio Residencial Aurora', cnpjDest: '12121212000112', itens: [{ cod: 'SACO', desc: 'Saco de lixo 100L', q: 3, p: 20 }, { cod: 'BRINDE', desc: 'Brinde', q: 1, p: 10, cfop: '5910' }] }),
    xml({ n: 5, dest: 'Fornecedor', cnpjDest: EMIT, itens: [{ cod: 'X', desc: 'X', q: 1, p: 1 }], emit: '99888777000166' }),
    xml({ n: 6, dest: 'Cliente devolveu', cnpjDest: '44555666000199', itens: [{ cod: 'X', desc: 'X', q: 1, p: 1 }], finNFe: '4' }),
    xml({ n: 8, dest: 'ESCOLA MODELO', cnpjDest: '44555666000199', itens: [{ cod: 'DET5', desc: 'Detergente 5L', q: 1, p: 12.5 }] }),
    cancelamento(8)
  ].map(N.lerXml);
  const pl = N.planeja(D, docs, { responsavelPadrao: 'u1' });
  const r = pl.resumoNotas;
  assert.equal(r.emitente.doc, R.formataCNPJ(EMIT));
  assert.equal(pl.criar.notas.length, 5, '1, 2, 3, 4 e a 8 (cancelada)');
  assert.equal(r.deOutraEmpresa, 1);
  assert.equal(r.devolucoes, 1);
  assert.equal(r.canceladas, 1);
  assert.equal(pl.criar.notas.find(n => n.numero === 8).cancelada, true);
  assert.equal(r.valor, 125 + 80 + 100 + 70);
  const n1 = pl.criar.notas.find(n => n.numero === 1);
  assert.equal(n1.empresa_id, 'e1', 'achou pelo nome antes do "|"');
  assert.equal(pl.criar.notas.find(n => n.numero === 2).empresa_id, 'e2', 'achou pela razão social');
  const pe1 = pl.atualizar.find(a => a.tabela === 'empresas' && a.id === 'e1').patch;
  assert.equal(pe1.cnpj, '44.555.666/0001-99');
  assert.equal(pe1.situacao, 'cliente', 'quem comprou vira cliente');
  assert.equal(pl.atualizar.find(a => a.id === 'e2').patch.cnpj, '77.888.999/0001-55');
  assert.equal(r.cnpjsCompletados, 2);
  assert.equal(pl.criar.empresas.length, 1, 'o condomínio de duas notas vira uma empresa só');
  const cond = pl.criar.empresas[0];
  assert.equal(cond.segmento, 'Condomínio');
  assert.equal(cond.situacao, 'cliente');
  assert.equal(cond.responsavel_id, 'u1');
  assert.equal(cond.email, 'compras@exemplo.com.br');
  assert.equal(R.diaLocal(cond.criado_em), '2026-09-15', 'cadastro na data da primeira compra');
  assert.deepEqual(pl.criar.opcoes.map(o => o.nome), ['Condomínio']);
  assert.equal(pl.criar.nota_itens.find(i => i.codigo === 'DET5').produto_id, 'p1', 'produto do catálogo pelo código');
  assert.deepEqual(pl.criar.produtos.map(p => p.nome).sort(), ['Luva nitrílica', 'Saco de lixo 100L'], 'brinde (CFOP 5910) não entra no catálogo');

  // Reimportar: nada novo; o cancelamento que chega depois marca a nota.
  const D2 = base();
  Object.keys(pl.criar).forEach(t => { D2[t] = (D[t] || []).concat(pl.criar[t]); });
  D2.notas.find(n => n.numero === 1).cancelada = false;
  const pl2 = N.planeja(D2, docs.concat([N.lerXml(cancelamento(1))]), {});
  assert.equal(pl2.criar.notas.length, 0);
  assert.equal(pl2.resumoNotas.jaImportadas, 5);
  assert.deepEqual(pl2.atualizar.filter(a => a.tabela === 'notas').map(a => a.patch), [{ cancelada: true }]);
});

test('faturamento: total, top clientes e produtos, segmento, clientes novos; cancelada e remessa fora', () => {
  const D = base();
  D.usuarios = [{ user_id: 'u1', nome: 'Vendedora Um' }];
  D.empresas = [{ id: 'e1', nome: 'Escola A', segmento: 'Escola', responsavel_id: 'u1' }, { id: 'e2', nome: 'Indústria B', segmento: 'Indústria' }];
  const nota = (id, emp, dia, valor, extra) => Object.assign({ id, chave: id, empresa_id: emp, emitida_em: R.momento(dia, '10:00'), valor_total: valor, cancelada: false }, extra || {});
  D.notas = [nota('n1', 'e1', '2026-09-02', 500), nota('n2', 'e1', '2026-09-10', 300), nota('n3', 'e2', '2026-09-12', 1000),
    nota('n4', 'e2', '2026-08-05', 700), nota('n5', 'e1', '2026-09-15', 999, { cancelada: true }), nota('n6', null, '2026-09-20', 50, { cliente_nome: 'Avulso' }),
    nota('n7', 'e2', '2026-09-21', 40)];
  D.nota_itens = [
    { nota_id: 'n1', descricao: 'Detergente', codigo: 'DET', quantidade: 20, valor_total: 500, cfop: '5102' },
    { nota_id: 'n2', descricao: 'Detergente', codigo: 'DET', quantidade: 12, valor_total: 300, cfop: '5102' },
    { nota_id: 'n3', descricao: 'Luva', codigo: 'LUV', quantidade: 1000, valor_total: 1000, cfop: '5405' },
    { nota_id: 'n7', descricao: 'Amostra', codigo: 'AMO', quantidade: 1, valor_total: 40, cfop: '5910' }
  ];
  const ix = R.indexa(D);
  const f = R.faturamento(D, ix, '2026-09-29', { periodo: R.periodo('mes', '2026-09-29') });
  assert.equal(f.total, 1850, 'n1+n2+n3+n6 (n5 cancelada, n7 só remessa)');
  assert.equal(f.notas, 4);
  assert.equal(f.clientes, 3);
  assert.equal(f.clientesNovos, 2, 'Escola A e o avulso compraram pela 1ª vez em setembro; a Indústria B já comprava');
  assert.deepEqual(f.topClientes.map(c => [c.nome, c.valor]), [['Indústria B', 1000], ['Escola A', 800], ['Avulso', 50]]);
  assert.deepEqual(f.porSegmento.map(s => [s.nome, s.valor]), [['Indústria', 1000], ['Escola', 800], ['(sem segmento)', 50]]);
  assert.deepEqual(f.topProdutosValor.map(p => [p.descricao, p.valor, p.quantidade]), [['Luva', 1000, 1000], ['Detergente', 800, 32]]);
  assert.equal(f.porMes[11].valor, 1850);
  assert.equal(f.porMes[10].valor, 700);
  const ana = R.faturamento(D, ix, '2026-09-29', { periodo: R.periodo('mes', '2026-09-29'), responsavel_id: 'u1' });
  assert.equal(ana.total, 800);
  // "Compras anteriores" do cliente passam a vir das notas.
  const r1 = ix.resumo.get('e1');
  assert.deepEqual([r1.fonteCompras, r1.compras, r1.totalComprado, r1.ultimaCompra], ['notas', 2, 800, '2026-09-10']);
});

test('segmento sugerido pelo nome', () => {
  assert.equal(R.sugereSegmento('Colégio Horizonte Ensino Fundamental'), 'Escola');
  assert.equal(R.sugereSegmento('Indústria de Produtos Alimentícios Exemplo'), 'Indústria');
  assert.equal(R.sugereSegmento('Casa de Repouso Vida Longa'), 'Saúde');
  assert.equal(R.sugereSegmento('Condomínio Edifício Solar'), 'Condomínio');
  assert.equal(R.sugereSegmento('Restaurante Sabor da Casa'), 'Alimentação');
  assert.equal(R.sugereSegmento('Empresa Genérica'), null);
});
