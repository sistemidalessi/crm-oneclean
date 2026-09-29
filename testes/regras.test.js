// Rodar da raiz do repositório: node --test crm/testes/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../regras.js');

const HOJE = '2026-09-29';
const base = () => ({ usuarios: [], etapas: [], opcoes: [], produtos: [], metas: [], empresas: [], contatos: [], negocios: [], negocio_itens: [], propostas: [], atividades: [] });
const iso = (dia, h) => R.momento(dia, h || '10:00');

test('datas e períodos', () => {
  assert.equal(R.somaDias('2026-09-29', 3), '2026-10-02');
  assert.equal(R.somaMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(R.diasEntre('2026-09-01', '2026-09-29'), 28);
  assert.equal(R.dataBR('2026-09-29'), '29/09/2026');
  assert.equal(R.inicioSemana('2026-09-27'), '2026-09-21'); // domingo -> segunda anterior
  assert.equal(R.inicioSemana('2026-09-29'), '2026-09-28');
  assert.deepEqual(R.periodo('mes', HOJE), { de: '2026-09-01', ate: '2026-09-30' });
  assert.deepEqual(R.periodo('mes_passado', HOJE), { de: '2026-08-01', ate: '2026-08-31' });
  assert.equal(R.diaLocal(R.momento('2026-09-29', '23:30')), '2026-09-29');
  assert.equal(R.horaLocal(R.momento('2026-09-29', '08:05')), '08:05');
  assert.equal(R.diaLocal(R.proximaRecorrencia(iso('2026-01-31'), 'mensal')).slice(0, 7), '2026-03'); // JS rola 31/02 -> março
  assert.equal(R.diaLocal(R.proximaRecorrencia(iso('2026-09-29'), 'semanal')), '2026-10-06');
});

test('telefone, documento, busca', () => {
  assert.equal(R.linkWhatsApp('(19) 91234-5678'), 'https://wa.me/5519912345678');
  assert.equal(R.linkWhatsApp('(19) 91234-5678', 'Olá, tudo bem?'), 'https://wa.me/5519912345678?text=Ol%C3%A1%2C%20tudo%20bem%3F');
  assert.equal(R.linkWhatsApp('91234-5678'), '');
  assert.equal(R.formataCNPJ('11222333000181'), '11.222.333/0001-81');
  assert.ok(R.cnpjValido('11.222.333/0001-81'));
  assert.ok(!R.cnpjValido('11.222.333/0001-82'));
  assert.equal(R.chaveNome('Limpeza Total Comércio de Produtos LTDA - ME'), R.chaveNome('limpeza total produtos'));
  assert.ok(R.casaBusca('clinica', ['Clínica Vida']));
  assert.ok(R.casaBusca('9123-45', ['(19) 91234-5678']), 'busca por telefone ignora máscara');
  assert.equal(R.iniciais('Ana Maria Souza'), 'AS');
  assert.equal(R.aplicaModelo('Oi {primeiro_nome}, aqui é {vendedor} da {x}', { primeiro_nome: 'Ana', vendedor: 'Bia' }), 'Oi Ana, aqui é Bia da {x}');
});

test('números de planilha', () => {
  assert.equal(R.numeroBR('R$ 1.234,56'), 1234.56);
  assert.equal(R.numeroBR('1234.56'), 1234.56);
  assert.equal(R.numeroBR('1.234'), 1234);
  assert.equal(R.numeroBR('12,5'), 12.5);
  assert.equal(R.numeroBR(''), null);
  assert.equal(R.diaLocal(R.dataPlanilha('31/12/2025')), '2025-12-31');
  assert.equal(R.horaLocal(R.dataPlanilha('31/12/2025 14:30')), '14:30');
  assert.equal(R.diaLocal(R.dataPlanilha(45292)), '2024-01-01'); // série do Excel
  assert.equal(R.dataPlanilha('lixo'), null);
});

test('CSV: aspas, separador e BOM', () => {
  const l = R.csvParse('﻿nome;valor\n"Silva; Cia";"1.234,56"\n"Aspas ""x""";2\n');
  assert.deepEqual(l, [['nome', 'valor'], ['Silva; Cia', '1.234,56'], ['Aspas "x"', '2']]);
  assert.deepEqual(R.csvParse('a,b\r\n1,2'), [['a', 'b'], ['1', '2']]);
  const g = R.csvGera(['a', 'b'], [['x;y', 'z"w'], [null, ['t1', 't2']]]);
  assert.equal(g, '﻿a;b\r\n"x;y";"z""w"\r\n;t1, t2');
});

test('itens do negócio', () => {
  assert.equal(R.totalItem({ quantidade: 10, preco: 5, desconto: 10 }), 45);
  assert.equal(R.totalItens([{ quantidade: 3, preco: 1.1 }, { quantidade: 1, preco: 10, desconto: 100 }]), 3.3);
});

function cenario() {
  const D = base();
  D.usuarios = [{ user_id: 'u1', nome: 'Ana', ativo: true }, { user_id: 'u2', nome: 'Bruno', ativo: true }];
  D.etapas = [{ id: 'e1', nome: 'Prospecção', ordem: 1, probabilidade: 10 }, { id: 'e2', nome: 'Proposta', ordem: 2, probabilidade: 60 }];
  D.empresas = [
    { id: 'A', nome: 'Lead novo', situacao: 'lead', responsavel_id: 'u1', criado_em: iso('2026-09-20'), origem: 'Site' },
    { id: 'B', nome: 'Cliente sumido', situacao: 'cliente', responsavel_id: 'u1', criado_em: iso('2025-01-10'), origem: 'Indicação' },
    { id: 'C', nome: 'Cliente em dia', situacao: 'cliente', responsavel_id: 'u2', criado_em: iso('2026-09-02'), origem: 'Site', ciclo_recompra_dias: 60 },
    { id: 'D', nome: 'Negócio parado', situacao: 'prospect', responsavel_id: 'u2', criado_em: iso('2026-08-01') }
  ];
  D.negocios = [
    { id: 'n1', empresa_id: 'B', titulo: 'Pedido antigo', status: 'ganho', valor: 1000, fechado_em: '2026-03-10', criado_em: iso('2026-03-01'), responsavel_id: 'u1' },
    { id: 'n2', empresa_id: 'C', titulo: 'Primeiro pedido', status: 'ganho', valor: 3000, fechado_em: '2026-09-10', criado_em: iso('2026-09-02'), responsavel_id: 'u2', origem: 'Site' },
    { id: 'n3', empresa_id: 'D', titulo: 'Cotação', status: 'aberto', valor: 5000, etapa_id: 'e2', etapa_desde: iso('2026-08-01'), criado_em: iso('2026-08-01'), responsavel_id: 'u2', previsao_fechamento: '2026-09-30' },
    { id: 'n4', empresa_id: 'A', titulo: 'Orçamento', status: 'perdido', valor: 2000, fechado_em: '2026-09-15', criado_em: iso('2026-09-05'), motivo_perda: 'Preço', responsavel_id: 'u1' },
    { id: 'n5', empresa_id: 'B', titulo: 'Recompra', status: 'ganho', valor: 1500, fechado_em: '2026-09-20', criado_em: iso('2026-09-18'), responsavel_id: 'u1' }
  ];
  D.negocio_itens = [{ id: 'i1', negocio_id: 'n2', descricao: 'Detergente 5L', quantidade: 100, preco: 30, desconto: 0 }];
  D.atividades = [
    { id: 'a1', empresa_id: 'C', tipo: 'whatsapp', descricao: 'ok', concluida: true, concluida_em: iso('2026-09-25'), data_hora: iso('2026-09-25'), responsavel_id: 'u2' },
    { id: 'a2', empresa_id: 'B', tipo: 'ligacao', descricao: 'ligar', concluida: false, data_hora: iso('2026-09-28'), responsavel_id: 'u1' },
    { id: 'a3', empresa_id: 'C', tipo: 'tarefa', descricao: 'hoje', concluida: false, data_hora: iso(HOJE, '15:00'), responsavel_id: 'u2' },
    { id: 'a4', empresa_id: 'A', tipo: 'sistema', descricao: 'mudou etapa', concluida: true, concluida_em: iso('2026-09-21'), data_hora: iso('2026-09-21'), responsavel_id: 'u1' }
  ];
  D.metas = [{ usuario_id: 'u2', mes: '2026-09-01', valor: 6000 }];
  return D;
}

test('índices e resumo por empresa', () => {
  const D = cenario();
  const ix = R.indexa(D);
  const b = ix.resumo.get('B');
  assert.equal(b.compras, 2);
  assert.equal(b.totalComprado, 2500);
  assert.equal(b.ultimaCompra, '2026-09-20');
  assert.equal(b.primeiraCompra, '2026-03-10');
  assert.equal(b.proxima.id, 'a2');
  assert.equal(ix.resumo.get('A').ultimoContato, null, 'movimentação do sistema não conta como contato');
});

test('alertas do Início', () => {
  const D = cenario();
  const ix = R.indexa(D);
  const cfg = R.config({});
  const a = R.alertas(D, ix, cfg, HOJE, null);
  assert.deepEqual(a.atrasadas.map(x => x.id), ['a2']);
  assert.deepEqual(a.deHoje.map(x => x.id), ['a3']);
  assert.deepEqual(a.leadsSemAtendimento.map(x => x.id), ['A']);
  assert.deepEqual(a.negociosParados.map(x => x.id), ['n3']);
  assert.deepEqual(a.clientesSemContato.map(x => x.id), [], 'B tem tarefa agendada; C teve contato recente');
  // carteira da Ana
  const ana = R.alertas(D, ix, cfg, HOJE, 'u1');
  assert.deepEqual(ana.negociosParados, []);
  assert.deepEqual(ana.deHoje, []);
  // sem a tarefa, B (sem contato desde a compra de 20/09) ainda não alerta; com 45 dias sim
  D.atividades = D.atividades.filter(x => x.id !== 'a2');
  const ix2 = R.indexa(D);
  assert.deepEqual(R.alertas(D, ix2, cfg, HOJE, null).clientesSemContato.map(x => x.id), []);
  assert.deepEqual(R.alertas(D, ix2, cfg, '2026-11-15', null).clientesSemContato.map(x => x.id).sort(), ['B']);
  // recompra: B com ciclo padrão 30 dias vence em 20/10 (alerta 3 dias antes)
  assert.deepEqual(R.alertas(D, ix2, cfg, '2026-10-17', null).recompra.map(x => x.id), ['B']);
  assert.deepEqual(R.alertas(D, ix2, cfg, '2026-10-10', null).recompra.map(x => x.id), []);
});

test('situação efetiva: cliente sem compra há 90+ dias aparece como inativo', () => {
  const D = cenario();
  const ix = R.indexa(D);
  const cfg = R.config({});
  assert.equal(R.situacaoEfetiva(D.empresas[1], ix.resumo.get('B'), cfg, '2026-12-25'), 'inativo');
  assert.equal(R.situacaoEfetiva(D.empresas[1], ix.resumo.get('B'), cfg, HOJE), 'cliente');
});

test('dashboard do mês', () => {
  const D = cenario();
  const ix = R.indexa(D);
  const d = R.dashboard(D, ix, R.config({}), HOJE, { periodo: R.periodo('mes', HOJE) });
  assert.equal(d.realizadas.qtd, 2);
  assert.equal(d.realizadas.valor, 4500);
  assert.equal(d.perdidas.qtd, 1);
  assert.equal(d.abertas.valor, 5000);
  assert.equal(d.abertas.ponderado, 3000);
  assert.equal(d.previstas.qtd, 1);
  assert.equal(d.ticket, 2250);
  assert.equal(Math.round(d.conversao), 67);
  assert.equal(d.ciclo, (8 + 2) / 2);
  assert.equal(d.clientesNovos, 1);
  assert.equal(d.clientesRecorrentes, 1);
  const bruno = d.porVendedor.find(v => v.usuario.user_id === 'u2');
  assert.equal(bruno.valor, 3000);
  assert.equal(bruno.meta, 6000);
  assert.equal(bruno.atingido, 50);
  assert.equal(d.motivosPerda[0].nome, 'Preço');
  assert.equal(d.porProduto[0].nome, 'Detergente 5L');
  assert.equal(d.porProduto[0].quantidade, 100);
  assert.equal(d.porMes[11].mes, '2026-09-01');
  assert.equal(d.porMes[11].valor, 4500);
  const site = d.porOrigem.find(o => o.nome === 'Site');
  assert.equal(site.leads, 2);
  assert.equal(site.clientes, 1);
  // só a Ana
  const ana = R.dashboard(D, ix, R.config({}), HOJE, { periodo: R.periodo('mes', HOJE), responsavel_id: 'u1' });
  assert.equal(ana.realizadas.valor, 1500);
  assert.equal(ana.porVendedor.length, 1);
});

test('painel por funil, como o do Agendor (ganhos, iniciados, perdidos, taxa em valor)', () => {
  const D = base();
  D.etapas = [{ id: 'v1', funil: 'Funil de Vendas', nome: 'LDR', ordem: 1, probabilidade: 10 },
    { id: 'p1', funil: 'Funil de Pós-Vendas', nome: 'Contato', ordem: 1, probabilidade: 50 }];
  D.empresas = [{ id: 'e1', nome: 'A' }];
  const neg = (id, et, status, valor, criado, fechado) => ({ id, empresa_id: 'e1', titulo: id, etapa_id: et, status, valor, criado_em: iso(criado), fechado_em: fechado || null });
  D.negocios = [neg('n1', 'v1', 'ganho', 300, '2026-09-02', '2026-09-05'), neg('n2', 'v1', 'perdido', 100, '2026-08-20', '2026-09-10'),
    neg('n3', 'v1', 'ganho', 200, '2026-09-03', '2026-09-12'), neg('n4', 'p1', 'ganho', 999, '2026-09-04', '2026-09-06'), neg('n5', 'v1', 'aberto', 50, '2026-09-20')];
  const ix = R.indexa(D);
  const d = R.dashboard(D, ix, R.config({}), HOJE, { periodo: R.periodo('mes', HOJE), funil: 'Funil de Vendas' });
  assert.equal(d.realizadas.qtd, 2);
  assert.equal(d.realizadas.valor, 500);
  assert.equal(d.iniciados.qtd, 3, 'n1, n3 e n5 começaram em setembro');
  assert.equal(d.iniciados.valor, 550);
  assert.equal(d.perdidas.qtd, 1);
  assert.equal(Math.round(d.conversao * 10) / 10, 66.7);
  assert.equal(Math.round(d.conversaoValor * 10) / 10, 83.3);
  assert.deepEqual(d.porEtapa.map(x => x.etapa.id), ['v1']);
  const todos = R.dashboard(D, ix, R.config({}), HOJE, { periodo: R.periodo('mes', HOJE) });
  assert.equal(todos.realizadas.qtd, 3);
});

test('duplicados e mescla', () => {
  const g = R.duplicadosEmpresas([
    { id: 1, nome: 'Limpa Tudo Ltda', cnpj: '11.222.333/0001-81' },
    { id: 2, nome: 'LIMPA TUDO', cnpj: '' },
    { id: 3, nome: 'Outra', cnpj: '11222333000181' },
    { id: 4, nome: 'Sozinha' }
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].map(e => e.id).sort(), [1, 2, 3]);
  const c = R.duplicadosContatos([
    { id: 1, empresa_id: 'x', nome: 'Ana', email: 'ANA@x.com' },
    { id: 2, empresa_id: 'y', nome: 'Ana P', email: 'ana@x.com' },
    { id: 3, empresa_id: 'x', nome: 'Beto', celular: '(19) 99999-1111' },
    { id: 4, empresa_id: 'z', nome: 'Beto', whatsapp: '5519999991111' }
  ]);
  assert.equal(c.length, 2);
  assert.deepEqual(R.mesclaCampos({ id: 1, nome: 'A', email: '', tags: ['x'] }, [{ id: 2, nome: 'B', email: 'a@a', tags: ['y'], telefone: '1' }]),
    { email: 'a@a', tags: ['x', 'y'], telefone: '1' });
});

test('busca global acha empresa, pessoa, negócio e proposta', () => {
  const D = cenario();
  D.contatos = [{ id: 'c1', empresa_id: 'C', nome: 'Márcia Lopes', telefone: '(19) 3232-1010' }];
  D.propostas = [{ id: 'p1', negocio_id: 'n3', numero: 42 }];
  const ix = R.indexa(D);
  assert.equal(R.buscaGlobal(D, ix, 'sumido')[0].id, 'B');
  assert.equal(R.buscaGlobal(D, ix, 'marcia')[0].tipo, 'contato');
  assert.equal(R.buscaGlobal(D, ix, '3232-1010')[0].id, 'c1');
  assert.ok(R.buscaGlobal(D, ix, 'cotação').some(r => r.id === 'n3'));
  assert.ok(R.buscaGlobal(D, ix, '#42').some(r => r.tipo === 'proposta'));
});
