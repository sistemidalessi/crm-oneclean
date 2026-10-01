'use strict';
// Notas fictícias (CNPJs e nomes inventados) no formato oficial da NF-e 4.00.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../regras.js');
const N = require('../nfe.js');

const EMIT = '11222333000181';
const base = () => ({ usuarios: [], etapas: [], opcoes: [], produtos: [], metas: [], empresas: [], contatos: [], negocios: [], negocio_itens: [], propostas: [], atividades: [], notas: [], nota_itens: [] });
const chave = n => ('3526091122233300018155001' + String(n).padStart(9, '0') + '1').padEnd(44, '0').slice(0, 44);

function xml({ n, dest, cnpjDest, itens, tpNF = '1', finNFe = '1', cStat = '100', emit = EMIT, data = '2026-09-15T10:30:00-03:00', prefixo = '', adic = '' }) {
  const t = (tag, v) => '<' + prefixo + tag + '>' + v + '</' + prefixo + tag + '>';
  const det = itens.map((it, i) => '<' + prefixo + 'det nItem="' + (i + 1) + '">' + t('prod',
    t('cProd', it.cod) + t('cEAN', 'SEM GTIN') + t('xProd', it.desc) + t('NCM', '34022000') + t('CFOP', it.cfop || '5102') + t('uCom', it.un || 'UN') +
    t('qCom', it.q.toFixed(4)) + t('vUnCom', it.p.toFixed(10)) + t('vProd', (it.q * it.p).toFixed(2)) + (it.desc0 ? t('vDesc', it.desc0.toFixed(2)) : '')) +
    t('imposto', t('ICMS', '')) + '</' + prefixo + 'det>').join('');
  const vProd = itens.reduce((s, it) => s + it.q * it.p, 0);
  const nfe = '<' + prefixo + 'NFe xmlns="http://www.portalfiscal.inf.br/nfe"><' + prefixo + 'infNFe versao="4.00" Id="NFe' + chave(n) + '">' +
    t('ide', t('cUF', '35') + t('natOp', 'VENDA DE MERCADORIA') + t('mod', '55') + t('serie', '1') + t('nNF', n) + t('dhEmi', data) + t('tpNF', tpNF) + t('finNFe', finNFe)) +
    t('emit', t('CNPJ', emit) + t('xNome', 'DISTRIBUIDORA EXEMPLO LTDA') + t('enderEmit', t('xMun', 'São Bernardo do Campo') + t('UF', 'SP'))) +
    t('dest', (cnpjDest ? t('CNPJ', cnpjDest) : t('CPF', '12345678909')) + t('xNome', dest) + t('enderDest', t('xLgr', 'Rua Um') + t('nro', '10') + t('xBairro', 'Centro') + t('xMun', 'Santo André') + t('UF', 'SP') + t('CEP', '09000000') + t('fone', '1140000000')) + t('email', 'Compras@' + (cnpjDest || 'cpf') + '.com.br')) +
    det + t('total', t('ICMSTot', t('vProd', vProd.toFixed(2)) + t('vNF', (vProd - itens.reduce((s, it) => s + (it.desc0 || 0), 0)).toFixed(2)))) +
    (adic ? t('infAdic', t('infCpl', adic)) : '') + '</' + prefixo + 'infNFe></' + prefixo + 'NFe>';
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
  assert.equal(cond.email, 'compras@12121212000112.com.br');
  // Cliente que já existia ganha o que faltava no cadastro (só o vazio).
  assert.deepEqual([pe1.email, pe1.telefone, pe1.cidade, pe1.uf, pe1.cep, pe1.logradouro, pe1.bairro],
    ['compras@44555666000199.com.br', '1140000000', 'Santo André', 'SP', '09000000', 'Rua Um', 'Centro']);
  assert.ok(r.camposCompletados >= 14);
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

test('filtro por vendedor escrito na nota e pela carteira da equipe', () => {
  const D = base();
  D.usuarios = [{ user_id: 'u1', nome: 'Isabela', ativo: true }, { user_id: 'u2', nome: 'Alysson Vinicius', ativo: true }];
  D.empresas = [{ id: 'e1', nome: 'ESCOLA MODELO | Joana', responsavel_id: 'u1' }, { id: 'e2', nome: 'Cliente Sem Dono' }];
  const item = [{ cod: 'A', desc: 'A', q: 1, p: 100 }];
  const docs = [
    xml({ n: 1, dest: 'ESCOLA MODELO', cnpjDest: '44555666000199', itens: item, adic: 'PEDIDO 10; VENDEDOR: 003 - ISABELA; PGTO 28 DD' }),
    xml({ n: 2, dest: 'Hotel Novo', cnpjDest: '11111111000111', itens: item, adic: 'Vendedor: ALYSSON - pedido 99' }),
    xml({ n: 3, dest: 'Condominio Externo', cnpjDest: '22222222000122', itens: item, adic: 'VENDEDOR: SILMARA' }),
    xml({ n: 4, dest: 'Cliente Sem Dono', cnpjDest: '33333333000133', itens: item, adic: 'VENDEDOR: VENDA DIRETA' }),
    xml({ n: 5, dest: 'Consumidor', cnpjDest: '55555555000155', itens: item })
  ].map(N.lerXml);
  assert.equal(docs[0].vendedor, 'ISABELA');
  assert.equal(docs[1].vendedor, 'ALYSSON');
  assert.equal(docs[4].vendedor, null);

  const pv = N.planeja(D, docs, { filtro: 'vendedores' });
  assert.deepEqual(pv.criar.notas.map(n => n.numero), [1, 2], 'só Isabela e Alysson (batem com a equipe pelo primeiro nome)');
  assert.equal(pv.resumoNotas.foraDoFiltro, 3);
  assert.equal(pv.resumoNotas.valorForaDoFiltro, 300);
  assert.equal(pv.criar.empresas.find(e => e.nome === 'Hotel Novo').responsavel_id, 'u2', 'cliente novo fica com o vendedor da nota');
  const silmara = pv.vendedoresNotas.find(v => v.nome === 'SILMARA');
  assert.equal(silmara.usuario_id, null);
  assert.deepEqual(pv.vendedoresIncluidos.sort(), ['alysson', 'isabela']);
  // marcar a Silmara também
  const pv2 = N.planeja(D, docs, { filtro: 'vendedores', vendedoresIncluidos: ['isabela', 'alysson', 'silmara'] });
  assert.deepEqual(pv2.criar.notas.map(n => n.numero), [1, 2, 3]);

  const pc = N.planeja(D, docs, { filtro: 'carteira' });
  assert.deepEqual(pc.criar.notas.map(n => n.numero), [1], 'só o cliente já cadastrado com vendedor da equipe');
  assert.equal(pc.criar.empresas.length, 0, 'carteira não cadastra cliente novo');

  const pt = N.planeja(D, docs, {});
  assert.equal(pt.criar.notas.length, 5);

  // auto: nota com vendedor vale pelo vendedor; sem vendedor (a 5ª, cliente fora da carteira) fica de fora.
  const pa = N.planeja(D, docs, { filtro: 'auto' });
  assert.deepEqual(pa.criar.notas.map(n => n.numero), [1, 2]);
});

test('completar cadastro pela nota: não usa telefone/e-mail que já é de outro cliente', () => {
  const D = base();
  D.empresas = [{ id: 'e1', nome: 'ESCOLA MODELO', telefone: null, email: null, cidade: 'São Paulo' },
    { id: 'e2', nome: 'Outra Empresa', telefone: '(11) 4000-0000', email: 'compras@44555666000199.com.br' }];
  const pl = N.planeja(D, [N.lerXml(xml({ n: 1, dest: 'ESCOLA MODELO', cnpjDest: '44555666000199', itens: [{ cod: 'A', desc: 'A', q: 1, p: 1 }] }))], {});
  const p = pl.atualizar.find(a => a.id === 'e1').patch;
  assert.equal(p.cnpj, '44.555.666/0001-99');
  assert.equal(p.email, undefined, 'e-mail é da Outra Empresa');
  assert.equal(p.telefone, undefined, 'telefone (últimos 8 dígitos) é da Outra Empresa');
  assert.equal(p.cidade, undefined, 'cidade já estava preenchida');
  assert.equal(pl.resumoNotas.dadosDeOutroCadastro, 2);
});

// 01/10/2026: o Agendor quase não tinha CNPJ e a 1ª nota de cliente antigo criava cadastro repetido.
test('nota acha cliente sem CNPJ da mesma vendedora (domínio do e-mail ou nome próprio); dois parecidos não arrisca', () => {
  const D = base();
  D.usuarios = [{ user_id: 'u1', nome: 'Ana', ativo: true }, { user_id: 'u2', nome: 'Bia', ativo: true }];
  D.empresas = [
    { id: 'e1', nome: 'Ferro Forte - Carla', razao_social: 'Ferro Forte', email: 'compras@ferroforte.com.br', responsavel_id: 'u1', situacao: 'prospect' },
    { id: 'e2', nome: 'Vidraçaria Cristal Centro', responsavel_id: 'u1', situacao: 'cliente' },
    { id: 'e3', nome: 'Vidraçaria Cristal Norte', responsavel_id: 'u1', situacao: 'cliente' },
    { id: 'e4', nome: 'Gráfica Aurora | Paulo', responsavel_id: 'u2', situacao: 'cliente' },
    { id: 'e5', nome: 'Polistampex', responsavel_id: 'u1', situacao: 'cliente' }
  ];
  const it = [{ cod: 'A', desc: 'Detergente', q: 1, p: 10 }];
  const docs = [
    xml({ n: 1, dest: 'FERRO FORTE INDUSTRIA DE PERFIS LTDA', cnpjDest: '44555666000199', itens: it, adic: 'VENDEDOR: ANA;' }),
    xml({ n: 2, dest: 'VIDRACARIA CRISTAL LTDA', cnpjDest: '55666777000188', itens: it, adic: 'VENDEDOR: ANA;' }),
    xml({ n: 3, dest: 'GRAFICA AURORA IMPRESSOS EIRELI', cnpjDest: '66777888000177', itens: it, adic: 'VENDEDOR: ANA;' }),
    xml({ n: 4, dest: 'POLISTAMPEX INDUSTRIA METALURGICA LTDA', cnpjDest: '77888999000166', itens: it, adic: 'VENDEDOR: ANA;' })
  ].map(N.lerXml);
  const pl = N.planeja(D, docs, { filtro: 'vendedores' });
  const notaDe = n => pl.criar.notas.find(x => x.numero === n);
  assert.equal(notaDe(1).empresa_id, 'e1', 'domínio ferroforte no nome da nota');
  const p1 = pl.atualizar.find(a => a.id === 'e1').patch;
  assert.equal(p1.cnpj, '44.555.666/0001-99');
  assert.equal(p1.razao_social, 'FERRO FORTE INDUSTRIA DE PERFIS LTDA', 'razão social da nota é a oficial');
  assert.equal(p1.situacao, 'cliente');
  assert.equal(notaDe(4).empresa_id, 'e5', 'cadastro de uma palavra própria só');
  assert.ok(!['e2', 'e3'].includes(notaDe(2).empresa_id), 'dois parecidos: cria outro (vai para Duplicados)');
  assert.notEqual(notaDe(3).empresa_id, 'e4', 'parecido de outra vendedora: não liga');
  assert.equal(pl.ligadasPorNome.length, 2);
  assert.equal(pl.resumoNotas.ligadasPorNome, 2);
});

test('matriz e filial: mesma raiz de CNPJ vira cadastro próprio ligado ao grupo; mesmo nome com outro CNPJ não mistura', () => {
  const D = base();
  D.usuarios = [{ user_id: 'u1', nome: 'Ana', ativo: true }];
  D.empresas = [
    { id: 'm1', nome: 'Padaria Sol | Rita', razao_social: 'PADARIA SOL LTDA', cnpj: '12.345.678/0001-90', responsavel_id: 'u1', segmento: 'Alimentação', situacao: 'cliente' },
    { id: 'm2', nome: 'Colégio Lua', razao_social: 'COLEGIO LUA LTDA', cnpj: '22.333.444/0001-55', responsavel_id: 'u1', situacao: 'cliente' }
  ];
  const it = [{ cod: 'A', desc: 'Detergente', q: 1, p: 10 }];
  const docs = [
    xml({ n: 1, dest: 'PADARIA SOL LTDA', cnpjDest: '12345678000270', itens: it }),
    xml({ n: 2, dest: 'PADARIA SOL LTDA', cnpjDest: '12345678000270', itens: it }),
    xml({ n: 3, dest: 'COLEGIO LUA LTDA', cnpjDest: '99888777000166', itens: it }),
    xml({ n: 4, dest: 'PADARIA SOL LTDA', cnpjDest: '12345678000190', itens: it })
  ].map(N.lerXml);
  const pl = N.planeja(D, docs, { filtro: 'carteira' });
  const notaDe = n => pl.criar.notas.find(x => x.numero === n);
  const filial = pl.criar.empresas.find(e => e.cnpj === '12.345.678/0002-70');
  assert.ok(filial, 'filial criada');
  assert.equal(filial.grupo_id, 'm1');
  assert.equal(filial.responsavel_id, 'u1', 'mesma carteira da matriz');
  assert.equal(filial.segmento, 'Alimentação');
  assert.equal(filial.nome, 'PADARIA SOL LTDA (Santo André)');
  assert.equal(notaDe(1).empresa_id, filial.id);
  assert.equal(notaDe(2).empresa_id, filial.id, 'a 2ª nota da filial vai para a mesma filial');
  assert.equal(notaDe(4).empresa_id, 'm1', 'a matriz continua com as notas dela');
  assert.ok(!notaDe(3), 'outro CNPJ de raiz diferente, fora da carteira: fica de fora (não cai no Colégio Lua)');
  assert.equal(pl.resumoNotas.filiaisNovas, 1);
  const pt = N.planeja(D, docs.slice(2, 3), {});
  assert.notEqual(pt.criar.notas[0].empresa_id, 'm2', 'mesmo nome com outro CNPJ: cadastro novo, não mistura');
  assert.ok(!pt.criar.empresas[0].grupo_id);
});

test('vendedor da nota: "nome na nota" (DIRETO) vira o usuário, a nota guarda quem vendeu, nota antiga é completada', () => {
  const D = base();
  D.usuarios = [{ user_id: 'dono', nome: 'Anderson', ativo: true, nomes_nota: ['DIRETO'] }, { user_id: 'u1', nome: 'Ana', ativo: true }, { user_id: 'u3', nome: 'Silmara Externa', ativo: true }];
  D.empresas = [{ id: 'c1', nome: 'Cliente da Ana', razao_social: 'CLIENTE DA ANA LTDA', cnpj: '44.555.666/0001-99', responsavel_id: 'u1', situacao: 'cliente' }];
  D.notas = [{ id: 'velha', chave: chave(9), emitida_em: '2026-09-01T10:00:00Z', empresa_id: 'c1', valor_total: 10 }];
  const it = [{ cod: 'A', desc: 'Detergente', q: 1, p: 100 }];
  const docs = [
    xml({ n: 1, dest: 'CLIENTE DA ANA LTDA', cnpjDest: '44555666000199', itens: it, adic: 'VENDEDOR: DIRETO;' }),
    xml({ n: 2, dest: 'CLIENTE DA ANA LTDA', cnpjDest: '44555666000199', itens: it, adic: 'VENDEDOR: SILMARA;' }),
    xml({ n: 3, dest: 'OUTRO CLIENTE LTDA', cnpjDest: '55666777000188', itens: it, adic: 'VENDEDOR: FULANO;' }),
    xml({ n: 9, dest: 'CLIENTE DA ANA LTDA', cnpjDest: '44555666000199', itens: it, adic: 'VENDEDOR: ANA;' })
  ].map(N.lerXml);
  const pl = N.planeja(D, docs, { filtro: 'auto' });
  const n1 = pl.criar.notas.find(x => x.numero === 1), n2 = pl.criar.notas.find(x => x.numero === 2);
  assert.equal(n1.vendedor_id, 'dono', 'DIRETO = o dono'); assert.equal(n1.vendedor_nome, 'DIRETO');
  assert.equal(n1.empresa_id, 'c1', 'a nota vai para o cliente, que continua na carteira da Ana');
  assert.equal(n2.vendedor_id, 'u3', 'SILMARA pelo primeiro nome');
  assert.ok(!pl.criar.notas.find(x => x.numero === 3), 'vendedor que não é da equipe continua de fora');
  const p9 = pl.atualizar.find(a => a.tabela === 'notas' && a.id === 'velha');
  assert.deepEqual(p9.patch, { vendedor_nome: 'ANA', vendedor_id: 'u1' }, 'nota antiga ganha o vendedor');
  assert.equal(pl.resumoNotas.vendedoresCompletados, 1);
  assert.ok(!pl.criar.empresas.length);
  // Faturamento: a venda DIRETO conta para o dono, não para a dona da carteira.
  D.notas = [Object.assign({}, n1, { id: 'x1' }), Object.assign({}, n2, { id: 'x2' }), { id: 'x3', chave: chave(7), emitida_em: '2026-09-20T10:00:00Z', empresa_id: 'c1', valor_total: 50 }];
  const ix = R.indexa(D);
  const fat = R.faturamento(D, ix, '2026-10-01', { periodo: R.periodo('ano', '2026-10-01') });
  const por = Object.fromEntries(fat.porVendedor.map(v => [v.nome, v.valor]));
  assert.equal(por['Anderson'], 100); assert.equal(por['Silmara Externa'], 100); assert.equal(por['Ana'], 50, 'nota sem vendedor: pela carteira');
});
