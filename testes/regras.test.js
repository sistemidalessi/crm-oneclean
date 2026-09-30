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

test('cadastro duplicado: CNPJ, telefone (com ou sem DDD e o 9) e e-mail; pessoa de contato só avisa', () => {
  const D = base();
  D.usuarios = [{ user_id: 'u1', nome: 'Renata' }];
  D.empresas = [{ id: 'e1', nome: 'Condomínio Solar', cnpj: '11.222.333/0001-81', telefone: '(11) 4178-9545', whatsapp: '(11) 98888-7777', email: 'Sindico@Solar.com.br', responsavel_id: 'u1' },
    { id: 'e2', nome: 'Outra', telefone: '(11) 3333-0000' }];
  D.contatos = [{ id: 'c1', empresa_id: 'e2', nome: 'Síndico', celular: '11 97777-6666', email: 'joao@gmail.com' }];
  const q = (o) => R.achaDuplicados(D, o);
  assert.deepEqual(q({ cnpj: '11222333000181' }).map(x => [x.nome, x.campo, x.de_empresa, x.responsavel]), [['Condomínio Solar', 'CNPJ/CPF', true, 'Renata']]);
  assert.equal(q({ telefones: ['98888-7777'] })[0].campo, 'telefone', 'sem DDD');
  assert.equal(q({ telefones: ['+55 11 8888-7777'] })[0].empresa_id, 'e1', 'sem o 9, com +55');
  assert.equal(q({ emails: [' sindico@solar.com.br '] })[0].campo, 'e-mail');
  const pessoa = q({ telefones: ['(11) 97777-6666'], emails: ['JOAO@gmail.com'] })[0];
  assert.deepEqual([pessoa.empresa_id, pessoa.de_empresa], ['e2', false]);
  assert.equal(R.achaDuplicados(D, { cnpj: '11222333000181' }, 'e1').length, 0, 'a própria empresa não conta');
  assert.equal(q({ telefones: ['1234567'] }).length, 0, 'menos de 8 dígitos não compara');
  // Tela de Duplicados junta também por telefone e e-mail.
  const g = R.duplicadosEmpresas([{ id: 'a', nome: 'Alfa', email: 'x@y.com' }, { id: 'b', nome: 'Beta', email: 'X@Y.com' },
    { id: 'c', nome: 'Gama', telefone: '(19) 99999-1111' }, { id: 'd', nome: 'Delta', whatsapp: '99999-1111' }, { id: 'e', nome: 'Épsilon' }]);
  assert.deepEqual(g.map(l => l.map(e => e.id).sort().join('')).sort(), ['ab', 'cd']);
});

test('duplicado "quase certo" exige nome compatível: síndica de vários condomínios e filiais não são o mesmo cliente', () => {
  const e = (id, nome, email, tel) => ({ id, nome, email, whatsapp: tel, responsavel_id: 'u1' });
  const mesmo = [e('a', '- Colégio Horizonte | Marta', 'marta@x.com', '+5511925463494'), e('b', '- HORIZONTE COLEGIO | Marta', 'marta@x.com', '(11) 2546-3494')];
  assert.equal(R.motivoDuplicado(mesmo).forca, 3);
  const condominios = [e('c', 'Condominio Edificio Aurora DEBORA', 'debora@adm.com', '11999990000'), e('d', 'Debora Condominio Edificio Solar', 'debora@adm.com', '11999990000')];
  assert.equal(R.motivoDuplicado(condominios).forca, 2);
  assert.equal(R.nomesCompativeis('Loja Exemplo - Diadema', 'Loja Exemplo Canindé'), false, 'filiais');
  assert.equal(R.nomesCompativeis('- ESCOLA X UNIDADE I | Ana', '- ESCOLA X UNIDADE III | Ana'), false, 'unidades');
  assert.equal(R.nomesCompativeis('Hotel Sol | João', 'Hotel Sol | Julia'), true, 'mesmo hotel, contatos diferentes');
  assert.equal(R.nomesCompativeis('Ana Colégio Novo Rumo', 'NOVO RUMO | Ana'), true);
});

test('avisos sem a base antiga: leads a partir de uma data e negócios esquecidos fora do sino', () => {
  const D = cenario();
  const ix = R.indexa(D);
  // Lead A chegou em 20/09: conta sem data de corte e com corte anterior; sai com corte depois.
  assert.deepEqual(R.alertas(D, ix, R.config({ leads_desde: '2026-09-01' }), HOJE, null).leadsSemAtendimento.map(x => x.id), ['A']);
  assert.deepEqual(R.alertas(D, ix, R.config({ leads_desde: '2026-10-01' }), HOJE, null).leadsSemAtendimento, []);
  // n3 parado desde 01/08: parado até 60 dias; depois disso é "esquecido" (sai do aviso).
  const cfg = R.config({});
  const depois = R.alertas(D, ix, cfg, '2026-10-05', null);
  assert.deepEqual(depois.negociosParados, []);
  assert.deepEqual(depois.negociosEsquecidos.map(x => x.id), ['n3']);
  assert.equal(R.ultimoMovimento(D.negocios[2], ix), '2026-08-01');
  // dias_esquecido = 0 desliga: continua parado para sempre.
  assert.deepEqual(R.alertas(D, ix, R.config({ dias_esquecido: 0 }), '2026-10-05', null).negociosParados.map(x => x.id), ['n3']);
  // Contato com a empresa conta como movimento.
  D.atividades.push({ id: 'a9', empresa_id: 'D', tipo: 'ligacao', descricao: 'liguei', concluida: true, concluida_em: iso('2026-09-10'), data_hora: iso('2026-09-10'), responsavel_id: 'u2' });
  const ix2 = R.indexa(D);
  assert.equal(R.ultimoMovimento(D.negocios[2], ix2), '2026-09-10');
  assert.deepEqual(R.alertas(D, ix2, cfg, '2026-10-05', null).negociosEsquecidos, []);
});

test('recompra inteligente: ritmo, itens habituais e mensagem', () => {
  // Ritmo = mediana dos intervalos; compras a até 3 dias contam como uma; precisa de 3 compras.
  assert.equal(R.ritmoCompra(['2026-07-01', '2026-07-22', '2026-08-12', '2026-09-02']), 21);
  assert.equal(R.ritmoCompra(['2026-07-01', '2026-07-02', '2026-07-22', '2026-08-12']), 21, 'entrega dividida conta como uma compra');
  assert.equal(R.ritmoCompra(['2026-07-01', '2026-08-01']), null, 'duas compras não bastam');
  assert.equal(R.ritmoCompra(['2026-01-01', '2026-01-05', '2026-01-09']), 7, 'no mínimo 7 dias');

  const D = base();
  D.empresas = [{ id: 'P', nome: 'Padaria Exemplo', situacao: 'cliente', responsavel_id: 'u1' }];
  const nota = (id, dia, itens) => {
    D.notas.push({ id, empresa_id: 'P', emitida_em: dia + 'T10:00:00-03:00', valor_total: 100, cancelada: false });
    itens.forEach((it, i) => D.nota_itens.push(Object.assign({ id: id + i, nota_id: id, cfop: '5102' }, it)));
  };
  D.notas = []; D.nota_itens = [];
  nota('n1', '2026-08-01', [{ descricao: 'DETERGENTE NEUTRO 5LTS', unidade: 'GL', quantidade: 4 }, { descricao: 'PAPEL TOALHA 1000FLS', unidade: 'FD', quantidade: 10 }]);
  nota('n2', '2026-08-22', [{ descricao: 'DETERGENTE NEUTRO 5LTS', unidade: 'GL', quantidade: 4 }, { descricao: 'LUVA LATEX M', unidade: 'PR', quantidade: 2 }]);
  nota('n3', '2026-09-12', [{ descricao: 'DETERGENTE NEUTRO 5LTS', unidade: 'GL', quantidade: 6 }, { descricao: 'PAPEL TOALHA 1000FLS', unidade: 'FD', quantidade: 10 },
    { descricao: 'BRINDE', unidade: 'UN', quantidade: 1, cfop: '5910' }]);
  const ix = R.indexa(D);
  assert.equal(ix.resumo.get('P').ritmo, 21);
  const itens = R.itensHabituais(ix, 'P');
  assert.deepEqual(itens.map(i => [i.descricao, i.quantidade, i.vezes]), [['DETERGENTE NEUTRO 5LTS', 4, 3], ['PAPEL TOALHA 1000FLS', 10, 2]], 'luva (1 de 3) e brinde (não é venda) ficam de fora');
  assert.equal(R.textoItens(itens), '• Detergente neutro 5L — 4 GL\n• Papel toalha 1000fls — 10 FD');

  // Aviso: vence 3 dias antes do ritmo (12/09 + 21 = 03/10); com ciclo no cadastro, vale o cadastro.
  const cfg = R.config({});
  assert.deepEqual(R.alertas(D, ix, cfg, '2026-09-29', null).recompra, []);
  assert.deepEqual(R.alertas(D, ix, cfg, '2026-09-30', null).recompra.map(e => e.id), ['P']);
  assert.equal(R.cicloRecompra(Object.assign({}, D.empresas[0], { ciclo_recompra_dias: 45 }), ix.resumo.get('P'), cfg), 45);
  // Sumido há muito tempo (mais de 2 ciclos e do prazo de inativo) não é mais recompra.
  assert.deepEqual(R.alertas(D, ix, cfg, '2026-12-31', null).recompra, []);

  const msg = R.aplicaModelo(cfg.modelo_recompra, { saudacao: 'Olá, Maria!', vendedor_primeiro_nome: 'Ana', minha_empresa: 'Empresa Exemplo', itens: R.textoItens(itens) });
  assert.ok(msg.startsWith('Olá, Maria! Aqui é Ana, da Empresa Exemplo.'));
  assert.ok(msg.includes('• Detergente neutro 5L — 4 GL'));
});
