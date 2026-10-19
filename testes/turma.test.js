'use strict';
// Turma (mascotes): quem fala em cada tela e o guia do dia por papel. Dados fictícios.
const test = require('node:test');
const assert = require('node:assert');
const T = require('../turma.js');

const cfg = {
  principal: 'robo',
  telas: { estoque: 'caixa-papelao', caixa: 'calculadora', 'caixa:cobranca': 'envelope' }
};

test('especialista da tela: sub-aba, tela e o principal', () => {
  assert.strictEqual(T.especialista(cfg, 'caixa', 'cobranca'), 'envelope');
  assert.strictEqual(T.especialista(cfg, 'caixa', 'dia'), 'calculadora');
  assert.strictEqual(T.especialista(cfg, 'fila', null), 'robo');
  assert.strictEqual(T.especialista(null, 'fila'), null);
});

test('saudação pelo horário', () => {
  assert.deepStrictEqual([3, 8, 13, 20].map(T.saudacao), ['Boa noite', 'Bom dia', 'Boa tarde', 'Boa noite']);
});

const al = { atrasadas: [1, 2], deHoje: [1], leadsSemAtendimento: [], recompra: [1, 2, 3], clientesSemContato: [], negociosParados: [1] };
const resumo = {
  pedidos: { bloqueados: 2, liberados: 1, separacao: 0, separado: 3 },
  nfe: { pendentes: 1, rejeitadas: 0 },
  estoque: { abaixo_minimo: 184, sem_explicacao: 0 },
  caixa: { vencidas: 1, vencidas_valor: 786.96, hoje: 2, hoje_valor: 2197.75 },
  receber: { vencidos: 30, valor: 38737 }
};

test('guia da vendedora: tarefas, boletos e recompra; nada de caixa, estoque nem pedidos dos outros', () => {
  const g = T.guia({ vendas: true, al, resumo: { nfe: { pendentes: 0 } }, boletos: 2 });
  assert.deepStrictEqual(g.map(x => x.id), ['boletos', 'atrasadas', 'hoje', 'recompra', 'parados']);
  assert.strictEqual(g[0].texto, '2 clientes com boleto atualizado para mandar');
  assert.strictEqual(g[0].mascote, 'cobranca');
  assert.strictEqual(T.contagem(g), 3);   // recompra e parados são só informação
});

test('guia do administrador: caixa com valor, NF-e pendente primeiro, estoque e pedidos', () => {
  const g = T.guia({ vendas: true, al: {}, resumo, gestor: true, admin: true, op: true, fkn: [{ arquivo: 'Listagem cadastral de produtos' }], vigiasParados: ['servidor'] });
  assert.deepStrictEqual(g.filter(x => x.nivel === 'urgente').map(x => x.id), ['nfe-pend', 'cx-venc', 'vigia-0']);
  const venc = g.find(x => x.id === 'cx-venc');
  assert.strictEqual(venc.texto, '1 conta vencida sem baixa (R$ 786,96)');
  assert.deepStrictEqual(g.find(x => x.id === 'receber'), { id: 'receber', nivel: 'info', texto: '30 títulos a receber em atraso (R$ 38.737,00)', aba: 'caixa', sub: 'cobranca', mascote: null });
  assert.ok(g.some(x => x.id === 'fkn-0' && x.texto === 'Puxar do FKN: Listagem cadastral de produtos'));
  assert.deepStrictEqual(g.filter(x => x.aba === 'pedidos').map(x => x.id).sort(), ['bloqueados', 'liberados', 'nfe-pend', 'separado']);
});

test('guia da logística e do comprador: só a parte de cada um', () => {
  const log = T.guia({ vendas: false, al, resumo, op: true });
  assert.deepStrictEqual(log.map(x => x.id).sort(), ['liberados', 'nfe-pend', 'separado']);
  const comp = T.guia({ vendas: false, al, resumo, comprador: true, recusas: [{ tipo: 'produtos' }] });
  assert.deepStrictEqual(comp.map(x => x.id), ['nfe-pend', 'fkn-recusa-0', 'estoque-min']);
});

test('falas da tela: a sub-aba aberta primeiro, no máximo 3', () => {
  const g = T.guia({ vendas: false, al: {}, resumo, gestor: true, admin: true, op: true });
  const f = T.falasDaTela(g, 'caixa', 'cobranca');
  assert.strictEqual(f[0].id, 'receber');
  assert.deepStrictEqual(T.falasDaTela(g, 'pedidos', null, 2).map(x => x.id), ['nfe-pend', 'bloqueados']);
  assert.deepStrictEqual(T.falasDaTela(g, 'agenda'), []);
});

test('turma: avisos das notas de compra da Sefaz para o comprador', () => {
  const T = require('../turma.js');
  const g = T.guia({ vendas: false, al: {}, resumo: { compras_sefaz: { desconhecidos: 2, prazo: 1 } }, comprador: true });
  assert.deepEqual(g.filter(x => /^dfe-/.test(x.id)).map(x => [x.id, x.nivel, x.aba, x.sub, x.mascote]),
    [['dfe-desc', 'urgente', 'estoque', 'compras', 'auditoria'], ['dfe-prazo', 'urgente', 'estoque', 'compras', 'auditoria']]);
  assert.equal(T.guia({ vendas: true, al: {}, resumo: { compras_sefaz: { desconhecidos: 2 } } }).filter(x => /^dfe-/.test(x.id)).length, 0, 'vendedor não vê');
});

test('marcas nos avisos: resolvido some até aparecer coisa nova; amanhã volta no dia seguinte', () => {
  const itens = [{ id: 'hoje', texto: '3 tarefas para hoje' }, { id: 'cx-venc', texto: '2 contas vencidas sem baixa (R$ 10,00)' },
    { id: 'fkn-0', texto: 'Puxar do FKN: listagem' }, { id: 'leads', texto: '1 lead sem atendimento' }];
  const marcas = [{ id: 'hoje', tipo: 'resolvido', texto: '4 tarefas para hoje' }, { id: 'cx-venc', tipo: 'resolvido', texto: '1 conta vencida sem baixa (R$ 5,00)' },
    { id: 'fkn-0', tipo: 'amanha', ate: '2026-10-20' }, { id: 'sumiu', tipo: 'resolvido', texto: 'x' }];
  const r = T.aplicaMarcas(itens, marcas, '2026-10-19', true);
  assert.deepEqual(r.visiveis.map(x => x.id), ['cx-venc', 'leads'], 'o número subiu (1 → 2): volta a aparecer');
  assert.deepEqual(r.marcados.map(x => x.id), ['hoje', 'fkn-0'], 'baixou de 4 para 3: continua resolvido; amanhã ainda não chegou');
  assert.deepEqual(r.vencidas.sort(), ['cx-venc', 'sumiu']);
  const amanha = T.aplicaMarcas(itens, marcas, '2026-10-20', false);
  assert.ok(amanha.visiveis.some(x => x.id === 'fkn-0'), 'no dia seguinte volta');
  assert.ok(!amanha.vencidas.includes('sumiu'), 'sem os dados carregados não apaga a marca do aviso que sumiu');
  const texto = T.aplicaMarcas([{ id: 'a', texto: 'Relatório recusado' }], [{ id: 'a', tipo: 'resolvido', texto: 'Relatório recusado' }], '2026-10-19', true);
  assert.equal(texto.visiveis.length, 0, 'sem número: some enquanto o texto for o mesmo');
});
