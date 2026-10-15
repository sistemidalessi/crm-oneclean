'use strict';
// Ofertas de queima de estoque (ofertas.js: preço, candidatos, público, textos, resultado). Nomes fictícios.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../regras.js');
const O = require('../ofertas.js');

function base() {
  const D = { usuarios: [{ user_id: 'u1', nome: 'Ana Souza' }], etapas: [], opcoes: [], produtos: [], metas: [], empresas: [], contatos: [], negocios: [], negocio_itens: [], propostas: [],
    atividades: [], notas: [], nota_itens: [], email_envios: [], email_campanhas: [] };
  let seq = 0;
  D.nota = (emp, dia, codigo, descricao, qtd, valor, cfop) => {
    const id = 'n' + (++seq);
    D.notas.push({ id, empresa_id: emp, emitida_em: dia + 'T10:00:00-03:00', valor_total: valor || 100, cancelada: false });
    D.nota_itens.push({ id: id + 'i', nota_id: id, cfop: cfop || '5405', codigo, descricao, unidade: 'PT', quantidade: qtd || 1, valor_total: valor || 100 });
  };
  return D;
}
const HOJE = '2026-10-15';

test('preço: custo + margem, para cima no centavo; mínimo sem prejuízo e o que sobra', () => {
  assert.equal(O.precoOferta(38.23, 10), 42.06, '38,23 × 1,10 = 42,053 → 42,06');
  assert.equal(O.precoOferta(5.12, 10), 5.64, '5,632 → 5,64');
  assert.equal(O.precoOferta(10, 10), 11, 'conta exata não sobe um centavo');
  assert.equal(O.precoMinimo(100, 20), 125, 'com 20% de custos sobre a venda, o mínimo é 125');
  assert.equal(O.sobra(110, 100, 20), -12, '110 − 100 − 22 = prejuízo de 12');
  assert.equal(O.sobra(110, 100, 0), 10);
  assert.equal(O.desconto({ preco: 42.06, preco_tabela: 49.7 }), 15);
});

test('candidatos: do estoque parado, com família, compradores e sem custo de fora', () => {
  const D = base();
  D.empresas.push({ id: 'A', nome: 'ESCOLA EXEMPLO', situacao: 'cliente' });
  D.nota('A', '2026-03-01', '200067', 'VASSOURA PELO 40 CM', 2, 83.2, '5102');
  const ix = R.indexa(D);
  const parado = [{ codigo: '200067', descricao: 'VASSOURA PELO 40 CM', unidade: 'UN', quantidade: 46, custo_total: 1472, custo_unit: 32, preco_venda: 41.6, familia: '280 VASSOURA' },
    { codigo: '420006', descricao: 'ENCERADEIRA', unidade: 'UN', quantidade: 2, custo_total: 4840, custo_unit: 2420, preco_venda: 3146, familia: '000' },
    { codigo: '999', descricao: 'SEM CUSTO', quantidade: 3, custo_total: 0, custo_unit: 0 }];
  const todo = parado.concat([{ codigo: '200068', familia: '280 VASSOURA' }, { codigo: '200069', familia: '280 VASSOURA' }]);
  const c = O.candidatos(parado, todo, D, ix, 10);
  assert.equal(c.length, 2, 'sem custo fica de fora');
  assert.deepEqual([c[0].preco, c[0].compradores, c[0].familia, c[0].familia_codigos], [35.2, 1, '280 VASSOURA', ['200068', '200069']]);
  assert.deepEqual([c[1].familia, c[1].familia_codigos], [null, []], 'família 000 = sem família');
  const g = O.itemParaGravar(c[0]);
  assert.ok(!('custo' in g) && !('compradores' in g), 'o custo nunca vai para o banco (a equipe lê a oferta)');
  assert.deepEqual([g.preco, g.preco_tabela, g.saldo], [35.2, 41.6, 46]);
});

test('público: comprou o item, compra a família, ativo (opcional); segura atraso; quem já recebeu', () => {
  const D = base();
  ['A', 'B', 'C', 'X'].forEach(id => D.empresas.push({ id, nome: 'CLIENTE ' + id, situacao: 'cliente', responsavel_id: 'u1', email: id.toLowerCase() + '@cliente.exemplo' }));
  D.nota('A', '2026-02-10', '200067', 'VASSOURA PELO 40 CM');
  D.nota('A', '2026-05-10', '200067.0', 'VASSOURA PELO 40 CM');
  D.nota('B', '2026-08-01', '200068', 'VASSOURA NYLON');            // mesma família
  D.nota('C', '2026-09-01', '555', 'COPO 200 ML');                  // cliente ativo, nada a ver
  D.nota('X', '2026-04-01', '200067', 'VASSOURA PELO 40 CM');
  D.nota('X', '2026-04-02', '200068', 'VASSOURA NYLON', 1, 50, '5949'); // remessa não é venda
  const oferta = { id: 'of1', validade: '2026-10-30', criado_em: '2026-10-15T12:00:00Z',
    itens: [{ codigo: '200067', descricao: 'VASSOURA PELO 40 CM', unidade: 'UN', preco: 35.2, preco_tabela: 41.6, familia: '280 VASSOURA', familia_codigos: ['200068'] }] };
  D.email_envios.push({ empresa_id: 'X', oferta_id: 'of1', tipo: 'oferta', situacao: 'enviado', criado_em: '2026-10-15T13:00:00Z' });
  const ix = R.indexa(D);
  let p = O.publico(D, ix, oferta, HOJE, { atraso: new Set(['A']) });
  assert.deepEqual(p.map(x => [x.empresa_id, x.nivel]), [['A', 'comprou'], ['X', 'comprou'], ['B', 'familia']], 'o C só entra com "todos"');
  assert.match(p[0].motivo, /^já comprou Vassoura pelo 40cm \(última vez 10\/05\/2026\)$/);
  assert.equal(p[0].segura, 'duplicata em atraso');
  assert.ok(p[1].enviado, 'o X já recebeu esta oferta');
  assert.deepEqual(p[2].destaques, ['200067'], 'a família aponta o item da oferta');
  assert.deepEqual(p[0].para, ['a@cliente.exemplo']);
  p = O.publico(D, ix, oferta, HOJE, { todos: true });
  assert.deepEqual(p.map(x => x.empresa_id), ['A', 'X', 'B', 'C']);
  assert.match(p[3].motivo, /cliente ativo \(última compra 01\/09\/2026\)/);
});

test('textos: WhatsApp com os itens (destaques primeiro) e e-mail com {itens} para a tabela da função', () => {
  const D = base();
  D.empresas.push({ id: 'A', nome: 'PADARIA EXEMPLO | JOÃO', situacao: 'cliente', responsavel_id: 'u1' });
  D.contatos.push({ id: 'c1', empresa_id: 'A', nome: 'João Pereira', principal: true });
  const ix = R.indexa(D);
  const oferta = { id: 'of1', validade: '2026-10-30', itens: [
    { codigo: '1', descricao: 'COPO 180 ML BRANCO PCT C/ 100', unidade: 'PT', preco: 5.64, preco_tabela: 6.66 },
    { codigo: '2', descricao: 'SACO P/ LIXO 100 LTS', unidade: 'PT', preco: 42.06, preco_tabela: 42.5 }] };
  const opc = { nomeUsuario: () => 'Ana Souza', minhaEmpresa: 'Empresa Exemplo' };
  const e = D.empresas[0];
  const w = O.texto(O.PADRAO.whatsapp, O.variaveis(oferta, e, ix, opc, ['2'], 'whatsapp'));
  assert.ok(w.startsWith('Olá, João! Aqui é Ana, da Empresa Exemplo. 🔥 Queima de estoque até 30/10/2026'), w);
  const linhas = w.split('\n').filter(l => l.startsWith('•'));
  assert.equal(linhas.length, 2);
  assert.match(linhas[0], /^• Saco p\/ lixo 100L \(PT\): R\$\s42,06$/,'destaque primeiro; desconto de 1% não aparece');
  assert.match(linhas[1], /: R\$\s5,64 \(de R\$\s6,66, -15%\)$/);
  const corpo = O.texto(O.PADRAO.corpo, O.variaveis(oferta, e, ix, opc, [], 'email'));
  assert.ok(corpo.includes('\n\n{itens}\n\n'), 'a função troca {itens} pela tabela com os preços do banco');
  assert.ok(O.texto(O.PADRAO.assunto, O.variaveis(oferta, e, ix, opc, [], 'email')).endsWith('até 30/10/2026'));
});

test('resultado: e-mails, abertos e o que saiu dos itens da oferta (com quem foi avisado)', () => {
  const D = base();
  ['A', 'B'].forEach(id => D.empresas.push({ id, nome: id, situacao: 'cliente' }));
  const oferta = { id: 'of1', validade: '2026-10-30', criado_em: '2026-10-15T12:00:00Z', itens: [{ codigo: '200067', preco: 35.2 }] };
  D.email_envios.push({ empresa_id: 'A', oferta_id: 'of1', situacao: 'enviado', aberto_em: '2026-10-15T14:00:00Z' }, { empresa_id: 'B', oferta_id: 'of1', situacao: 'erro' });
  D.nota('A', '2026-10-16', '200067', 'VASSOURA', 10, 352);
  D.nota('B', '2026-10-17', '200067', 'VASSOURA', 5, 176);
  D.nota('B', '2026-10-10', '200067', 'VASSOURA', 5, 176); // antes da oferta
  const r = O.resultado(D, R.indexa(D), oferta, '2026-10-20');
  assert.deepEqual([r.enviados, r.abertos, r.valor, r.valorAvisados, r.clientes, r.vendidos.get('200067'), r.vencida], [1, 1, 528, 352, 2, 15, false]);
  assert.equal(O.resultado(D, R.indexa(D), oferta, '2026-10-31').vencida, true);
});
