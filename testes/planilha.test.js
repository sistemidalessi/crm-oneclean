'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../regras.js');
const P = require('../planilha.js');

const base = () => ({ usuarios: [], etapas: [], opcoes: [], produtos: [], metas: [], empresas: [], contatos: [], negocios: [], negocio_itens: [], propostas: [], atividades: [] });

test('adivinha colunas pelos nomes (inclusive os do Agendor)', () => {
  const m = P.adivinhaMapeamento('empresas', ['Nome', 'Razão Social', 'CNPJ', 'Categoria', 'Setor', 'Responsável', 'Telefone comercial', 'Celular', 'E-mail', 'Cidade', 'Estado', 'Descrição', 'Coluna estranha']);
  assert.deepEqual(m, { 0: 'nome', 1: 'razao_social', 2: 'cnpj', 3: 'situacao', 4: 'segmento', 5: 'responsavel', 6: 'telefone', 7: 'whatsapp', 8: 'email', 9: 'cidade', 10: 'uf', 11: 'observacoes' });
  const n = P.adivinhaMapeamento('negocios', ['Título', 'Empresa', 'Valor total', 'Etapa', 'Status', 'Data de início', 'Data de conclusão', 'Motivo de perda']);
  assert.deepEqual(Object.values(n), ['titulo', 'empresa', 'valor', 'etapa', 'status', 'criado_em', 'fechado_em', 'motivo_perda']);
});

test('traduções de valores', () => {
  assert.equal(P.statusNegocio('Ganho'), 'ganho');
  assert.equal(P.statusNegocio('Perdido'), 'perdido');
  assert.equal(P.statusNegocio('Em andamento'), 'aberto');
  assert.equal(P.situacao('Cliente'), 'cliente');
  assert.equal(P.situacao('Prospect'), 'prospect');
  assert.equal(P.situacao('Ex-cliente'), 'inativo');
  assert.equal(P.tipoAtividade('LIGACAO'), 'ligacao');
  assert.equal(P.tipoAtividade('E-mail'), 'email');
  assert.equal(P.tipoAtividade('REUNIAO'), 'reuniao');
  assert.ok(P.simNao('Sim') && P.simNao('Concluída') && !P.simNao('Não') && !P.simNao(''));
});

test('planejador: cria, atualiza e não duplica', () => {
  const D = base();
  D.usuarios = [{ user_id: 'u1', nome: 'Ana Souza', email: 'ana@oneclean.com' }, { user_id: 'u2', nome: 'Bruno Lima' }];
  D.etapas = [{ id: 'e1', funil: 'Vendas', nome: 'Prospecção', ordem: 1 }];
  D.empresas = [{ id: 'X', nome: 'Condomínio Bela Vista', cnpj: '11.222.333/0001-81', responsavel_id: null, situacao: 'lead', tags: [] }];
  const plano = P.planeja(D, {
    empresas: [
      { _linha: 2, nome: 'Cond. Bela Vista', cnpj: '11222333000181', cidade: 'Campinas', responsavel: 'ana@oneclean.com', tags: 'condomínio, grande' },
      { _linha: 3, nome: 'Hotel Sol', responsavel: 'Bruno', segmento: 'Hotelaria', situacao: 'Cliente' },
      { _linha: 4, nome: 'hotel sol', telefone: '1932320000' },
      { _linha: 5, cidade: 'sem nome' },
      { _linha: 6, nome: 'Restaurante X', responsavel: 'Carlos Desconhecido' }
    ],
    contatos: [
      { _linha: 2, nome: 'Síndico João', empresa: 'Condominio Bela Vista', email: 'JOAO@x.com', cargo: 'Síndico' },
      { _linha: 3, nome: 'João', empresa: 'Condomínio Bela Vista', email: 'joao@x.com', celular: '19 99999-0000' },
      { _linha: 4, nome: 'Maria Avulsa' }
    ],
    negocios: [
      { _linha: 2, titulo: 'Contrato mensal', empresa: 'Hotel Sol', valor: 'R$ 2.500,00', etapa: 'Negociação', status: 'Em andamento', responsavel: 'Bruno' },
      { _linha: 3, titulo: 'Pedido 1', empresa: 'Empresa Nova', valor: '800', status: 'Ganho', fechado_em: '10/09/2026' },
      { _linha: 4, titulo: 'Pedido 2', empresa: 'Cond. Bela Vista', status: 'Perdido', motivo_perda: 'Preço alto', fechado_em: '2026-09-11' }
    ],
    atividades: [
      { _linha: 2, descricao: 'Liguei para o síndico', tipo: 'Ligação', data_hora: '15/09/2026', hora: '14:30', concluida: 'Sim', empresa: 'Condomínio Bela Vista' },
      { _linha: 3, descricao: 'Retornar', data_hora: '05/10/2026', empresa: 'Hotel Sol', negocio: 'Contrato mensal' }
    ]
  }, { responsavelPadrao: 'u1' });

  // empresas: X atualizada (cidade, responsável, tags), Hotel Sol criada 1x (a linha 4 atualiza o telefone), Restaurante criado, "Empresa Nova" criada pelo negócio
  const nomes = plano.criar.empresas.map(e => e.nome).sort();
  assert.deepEqual(nomes, ['Empresa Nova', 'Hotel Sol', 'Maria Avulsa', 'Restaurante X']);
  const hotel = plano.criar.empresas.find(e => e.nome === 'Hotel Sol');
  assert.equal(hotel.telefone, '1932320000');
  assert.equal(hotel.responsavel_id, 'u2', 'primeiro nome único resolve o responsável');
  assert.equal(hotel.situacao, 'cliente');
  const atX = plano.atualizar.find(a => a.id === 'X');
  assert.equal(atX.patch.cidade, 'Campinas');
  assert.equal(atX.patch.responsavel_id, 'u1');
  assert.deepEqual(atX.patch.tags, ['condomínio', 'grande']);
  assert.equal(plano.ignorados.filter(i => i.tipo === 'empresas').length, 1);
  assert.deepEqual(plano.semResponsavel.map(s => s.nome), ['Carlos Desconhecido']);
  assert.equal(plano.criar.empresas.find(e => e.nome === 'Restaurante X').responsavel_id, 'u1', 'desconhecido cai no padrão');
  // contatos: João duas vezes (mesmo e-mail) = 1 contato, com o celular da 2ª linha
  const joao = plano.criar.contatos.filter(c => c.empresa_id === 'X');
  assert.equal(joao.length, 1);
  assert.equal(joao[0].email, 'joao@x.com');
  assert.equal(joao[0].celular, '19 99999-0000');
  assert.equal(joao[0].principal, true);
  // negócios
  assert.equal(plano.criar.negocios.length, 3);
  const contrato = plano.criar.negocios.find(n => n.titulo === 'Contrato mensal');
  assert.equal(contrato.valor, 2500);
  const etapaNeg = plano.criar.etapas.find(e => e.nome === 'Negociação');
  assert.ok(etapaNeg && contrato.etapa_id === etapaNeg.id, 'etapa que não existia foi criada');
  const pedido1 = plano.criar.negocios.find(n => n.titulo === 'Pedido 1');
  assert.equal(pedido1.status, 'ganho');
  assert.equal(pedido1.fechado_em, '2026-09-10');
  assert.equal(plano.criar.empresas.find(e => e.nome === 'Empresa Nova').situacao, 'cliente', 'quem comprou vira cliente');
  const perdido = plano.criar.negocios.find(n => n.titulo === 'Pedido 2');
  assert.equal(perdido.motivo_perda, 'Preço alto');
  assert.ok(plano.criar.opcoes.some(o => o.tipo === 'motivo_perda' && o.nome === 'Preço alto'));
  // atividades
  const lig = plano.criar.atividades.find(a => a.tipo === 'ligacao');
  assert.equal(lig.empresa_id, 'X');
  assert.equal(lig.concluida, true);
  assert.equal(R.horaLocal(lig.data_hora), '14:30');
  const ret = plano.criar.atividades.find(a => a.descricao === 'Retornar');
  assert.equal(ret.concluida, false);
  assert.equal(ret.negocio_id, contrato.id, 'ligou a tarefa ao negócio pelo título');
});

test('reimportar o mesmo arquivo não duplica nada', () => {
  const D = base();
  const tipos = { empresas: [{ nome: 'A', externo_id: 'agendor:org:1' }], negocios: [{ titulo: 'N', empresa_externo: 'agendor:org:1', externo_id: 'agendor:negocio:9' }], atividades: [{ descricao: 't', empresa_externo: 'agendor:org:1', externo_id: 'agendor:tarefa:5' }] };
  const p1 = P.planeja(D, tipos, {});
  D.empresas.push(...p1.criar.empresas); D.negocios.push(...p1.criar.negocios); D.atividades.push(...p1.criar.atividades);
  const p2 = P.planeja(D, tipos, {});
  assert.equal(p2.criar.empresas.length + p2.criar.negocios.length + p2.criar.atividades.length, 0);
});

test('conversão do Agendor (API v3)', () => {
  const bruto = {
    users: [{ id: 70, name: 'Ana Souza', contact: { email: 'ana@oneclean.com' } }],
    funnels: [{ id: 1, name: 'Vendas', dealStages: [{ id: 11, name: 'Contato', sequence: 1 }, { id: 12, name: 'Proposta', sequence: 2 }] }],
    organizations: [{
      id: 8249304, name: 'Delícias de Cacau', legalName: 'Delícias de Cacau Ltda', cnpj: '11222333000181',
      category: { id: 1, name: 'Cliente' }, sector: { name: 'Alimentação' }, leadOrigin: { name: 'Indicação' },
      ownerUser: { id: 70, name: 'Ana Souza', contact: { email: 'ana@oneclean.com' } },
      contact: { email: 'contato@cacau.com', work: '(11) 3333-4444', mobile: '(11) 99999-8888' },
      address: { postalCode: '01000-000', streetName: 'Rua A', streetNumber: '10', district: 'Centro', city: { name: 'São Paulo' }, state: 'SP' },
      ranking: 4, description: 'Paga em dia', createdAt: '2024-05-01T10:00:00Z'
    }],
    people: [
      { id: 1, name: 'João', role: 'Comprador', organization: { id: 8249304, name: 'Delícias de Cacau' }, contact: { email: 'joao@cacau.com', mobile: '11988887777' } },
      { id: 2, name: 'Pessoa Sem Empresa', contact: { whatsapp: '11977776666' } }
    ],
    deals: [
      { id: 4735940, title: 'Venda #776', value: 123, dealStage: { id: 12, name: 'Proposta', funnel: { id: 1, name: 'Vendas' } }, dealStatus: { id: 2, name: 'Ganho' },
        organization: { id: 8249304, name: 'Delícias de Cacau' }, person: { id: 1, name: 'João' }, owner: { id: 70, name: 'Ana Souza' },
        startTime: '2026-08-01T10:00:00Z', endTime: '2026-08-20T10:00:00Z', products: [{ id: 5, name: 'Detergente', quantity: 10, unitValue: 12.3 }] },
      { id: 4735941, title: 'Venda perdida', value: 50, dealStatus: { id: 3, name: 'Perdido' }, lossReason: { name: 'Preço' }, person: { id: 2 } }
    ],
    tasks: [
      { id: 900, text: 'Ligar para o João', type: 'LIGACAO', dueDate: '2026-08-02T13:00:00Z', done: true, finishedAt: '2026-08-02T13:10:00Z', assignedUsers: [{ id: 70, name: 'Ana Souza' }], deal: { id: 4735940 } },
      { id: 901, text: 'Mandar catálogo', type: 'WHATSAPP', dueDate: '2026-10-02T13:00:00Z', done: false, person: { id: 2 } }
    ]
  };
  const t = P.converteAgendor(bruto);
  assert.equal(t.empresas[0].situacao, 'Cliente');
  assert.equal(t.empresas[0].cidade, 'São Paulo');
  assert.equal(t.etapas.length, 2);
  const D = base();
  D.usuarios = [{ user_id: 'u1', nome: 'Ana Souza', email: 'ana@oneclean.com' }];
  const plano = P.planeja(D, t, {});
  const cacau = plano.criar.empresas.find(e => e.externo_id === 'agendor:org:8249304');
  assert.equal(cacau.responsavel_id, 'u1');
  assert.equal(cacau.situacao, 'cliente');
  assert.equal(cacau.cnpj, '11.222.333/0001-81');
  assert.equal(cacau.qualificacao, 4);
  assert.equal(cacau.whatsapp, '(11) 99999-8888');
  const avulsa = plano.criar.empresas.find(e => e.nome === 'Pessoa Sem Empresa');
  assert.ok(avulsa, 'pessoa sem empresa vira empresa com o nome dela');
  assert.equal(plano.criar.contatos.length, 2);
  const venda = plano.criar.negocios.find(n => n.externo_id === 'agendor:negocio:4735940');
  assert.equal(venda.status, 'ganho');
  assert.equal(venda.fechado_em, '2026-08-20');
  assert.equal(venda.contato_id, plano.criar.contatos.find(c => c.nome === 'João').id);
  assert.equal(plano.criar.negocio_itens.length, 1);
  assert.equal(plano.criar.negocio_itens[0].preco, 12.3);
  const perdida = plano.criar.negocios.find(n => n.titulo === 'Venda perdida');
  assert.equal(perdida.status, 'perdido');
  assert.equal(perdida.empresa_id, avulsa.id);
  assert.equal(perdida.motivo_perda, 'Preço');
  const lig = plano.criar.atividades.find(a => a.externo_id === 'agendor:tarefa:900');
  assert.equal(lig.tipo, 'ligacao');
  assert.equal(lig.empresa_id, cacau.id);
  assert.equal(lig.negocio_id, venda.id);
  assert.equal(lig.concluida, true);
  const wpp = plano.criar.atividades.find(a => a.externo_id === 'agendor:tarefa:901');
  assert.equal(wpp.empresa_id, avulsa.id);
  assert.equal(wpp.concluida, false);
});

test('formato real do Agendor da OneClean (conferência de 29/09/2026)', () => {
  assert.equal(P.situacao('Primeira compra'), 'cliente');
  assert.equal(P.situacao('Cliente recorrente'), 'cliente');
  assert.equal(P.situacao('Cliente em potencial'), 'prospect');
  assert.equal(P.tipoAtividade('Ligação'), 'ligacao');
  assert.equal(P.tipoAtividade('Email'), 'email');
  assert.equal(P.tipoAtividade('WhatsApp'), 'whatsapp');
  const bruto = {
    users: [{ id: 1, name: 'Vendedora Um', contact: { email: 'um@oneclean.com.br', whatsapp: '11999990000' } }],
    funnels: [
      { id: 869737, name: 'Funil de Vendas', dealStages: [{ id: 3665823, name: 'LDR', sequence: 1 }, { id: 3665824, name: 'CONTATO FEITO', sequence: 2 }, { id: 3665826, name: 'ORÇAMENTO ENVIADO', sequence: 4 }] },
      { id: 869740, name: 'Funil de Pós-Vendas', dealStages: [{ id: 3665829, name: 'Contato', sequence: 1 }] }
    ],
    organizations: [
      { id: 10, name: 'Cliente A', legalName: 'Cliente A Ltda', email: 'a@x.com', contact: { email: 'a@x.com', whatsapp: '(11) 98888-7777', work: '(11) 3333-4444' },
        category: { id: 4054282, name: 'Primeira compra' }, ownerUser: { id: 1, name: 'Vendedora Um' }, ranking: 0, createdAt: '2024-02-01T12:00:00Z' },
      { id: 11, name: 'Cliente B', email: null, contact: {}, category: null, ownerUser: { id: 1, name: 'Vendedora Um' } }
    ],
    people: [{ id: 5, name: 'Comprador', email: 'c@x.com', contact: { email: 'c@x.com' }, organization: { id: 10, name: 'Cliente A' }, ownerUser: { id: 1, name: 'Vendedora Um' } }],
    deals: [
      { id: 100, title: 'Pedido ganho', value: 1500, dealStage: { id: 3665826, name: 'ORÇAMENTO ENVIADO', sequence: 4, funnel: { id: 869737, name: 'Funil de Vendas' } },
        dealStatus: { id: 2, name: 'Ganho' }, organization: { id: 11, name: 'Cliente B' }, owner: { id: 1, name: 'Vendedora Um' },
        startTime: '2026-08-01T10:00:00Z', endTime: '2026-08-20T10:00:00Z', wonAt: '2026-08-19T15:00:00Z' },
      { id: 101, title: 'Pedido perdido', value: 900, dealStage: { id: 3665824, name: 'CONTATO FEITO', funnel: { id: 869737, name: 'Funil de Vendas' } },
        dealStatus: { id: 3, name: 'Perdido' }, organization: { id: 10, name: 'Cliente A' }, owner: { id: 1, name: 'Vendedora Um' },
        lossReason: { id: 3272327, name: 'Preço acima da concorrência', description: 'pediu 10% a menos' }, lostAt: '2026-09-02T10:00:00Z', startTime: '2026-08-10T10:00:00Z' },
      { id: 102, title: 'Negócio avulso sem empresa', value: 50, dealStatus: { id: 1, name: 'Em andamento' },
        dealStage: { id: 3665829, name: 'Contato', funnel: { id: 869740, name: 'Funil de Pós-Vendas' } }, owner: { id: 1, name: 'Vendedora Um' }, startTime: '2026-09-01T10:00:00Z' }
    ],
    tasks: [
      { id: 900, text: 'Ligar', type: 'Ligação', dueDate: '2026-09-10T13:00:00Z', finishedAt: '2026-09-10T13:20:00Z', assignedUsers: [{ id: 1, name: 'Vendedora Um' }], user: { id: 1, name: 'Vendedora Um' }, deal: { id: 100, title: 'Pedido ganho' } },
      { id: 901, text: 'Mandar orçamento', type: null, dueDate: '2026-10-02T13:00:00Z', assignedUsers: [{ id: 1, name: 'Vendedora Um' }], organization: { id: 10, name: 'Cliente A' } }
    ]
  };
  const D = base();
  D.usuarios = [{ user_id: 'u1', nome: 'Vendedora Um', email: 'um@oneclean.com.br' }];
  const plano = P.planeja(D, P.converteAgendor(bruto), {});
  const a = plano.criar.empresas.find(e => e.nome === 'Cliente A');
  assert.equal(a.situacao, 'cliente', 'Primeira compra = cliente');
  assert.equal(a.razao_social, 'Cliente A Ltda');
  assert.equal(a.whatsapp, '(11) 98888-7777');
  assert.equal(a.telefone, '(11) 3333-4444');
  assert.equal(a.responsavel_id, 'u1');
  const b = plano.criar.empresas.find(e => e.nome === 'Cliente B');
  assert.equal(b.situacao, 'cliente', 'quem tem negócio ganho vira cliente');
  const avulso = plano.criar.empresas.find(e => e.nome === 'Negócio avulso sem empresa');
  assert.ok(avulso, 'negócio sem empresa cria empresa com o nome do negócio');
  assert.equal(plano.criar.negocios.length, 3);
  const ganho = plano.criar.negocios.find(n => n.titulo === 'Pedido ganho');
  assert.equal(ganho.status, 'ganho');
  assert.equal(ganho.fechado_em, R.diaLocal('2026-08-19T15:00:00Z'), 'usa wonAt');
  const perd = plano.criar.negocios.find(n => n.titulo === 'Pedido perdido');
  assert.equal(perd.status, 'perdido');
  assert.equal(perd.motivo_perda, 'Preço acima da concorrência');
  assert.match(perd.observacoes, /pediu 10% a menos/);
  const etapasPos = plano.criar.etapas.filter(e => e.funil === 'Funil de Pós-Vendas');
  assert.deepEqual(etapasPos.map(e => e.nome), ['Contato']);
  const etOrc = plano.criar.etapas.find(e => e.nome === 'ORÇAMENTO ENVIADO');
  assert.equal(ganho.etapa_id, etOrc.id);
  const t1 = plano.criar.atividades.find(t => t.externo_id === 'agendor:tarefa:900');
  assert.equal(t1.tipo, 'ligacao'); assert.equal(t1.concluida, true); assert.equal(t1.empresa_id, b.id); assert.equal(t1.negocio_id, ganho.id);
  const t3 = P.converteAgendor({ tasks: [{ id: 902, text: 'Cliente informou que ainda não recebeu a lista', type: null, dueDate: null, createdAt: '2026-09-23T17:56:12Z' }] }).atividades[0];
  assert.deepEqual([t3.tipo, t3.concluida, t3.concluida_em], ['nota', true, '2026-09-23T17:56:12Z'], 'nota do Agendor (sem tipo e sem prazo) é histórico');
  const t2 = plano.criar.atividades.find(t => t.externo_id === 'agendor:tarefa:901');
  assert.equal(t2.concluida, false); assert.equal(t2.tipo, 'tarefa'); assert.equal(t2.empresa_id, a.id); assert.equal(t2.responsavel_id, 'u1');
  assert.equal(plano.criar.contatos[0].empresa_id, a.id);
  assert.equal(plano.semResponsavel.length, 0);
});

test('negócios sem empresa do mesmo cliente não viram empresas repetidas (formato do pós-venda da OneClean)', () => {
  const org = { id: 20, name: 'ESCOLA MODELO | JOAO', ownerUser: { id: 1, name: 'Vendedora Um' } };
  const semEmpresa = (id, title) => ({ id, title, dealStatus: { id: 1 }, owner: { id: 1, name: 'Vendedora Um' } });
  const bruto = {
    users: [{ id: 1, name: 'Vendedora Um' }],
    organizations: [org],
    deals: [
      semEmpresa(1, '1261 - ESCOLA MODELO | JOAO'), semEmpresa(2, '901 - ESCOLA MODELO | JOAO'),
      semEmpresa(3, '1096 - Indústria Química Exemplo - MARIA'), semEmpresa(4, '2024 - Indústria Química Exemplo - ANA'),
      semEmpresa(5, '989 - Atendimento - COLEGIO TESTE - BIA'), semEmpresa(6, '825 - Atendimento - COLEGIO TESTE | Carla'),
      semEmpresa(7, '- CENTRO EDUCACIONAL AURORA'), semEmpresa(8, 'Colégio Horizonte - Ensino Fundamental / Médio')
    ],
    people: [{ id: 9, name: 'ESCOLA MODELO | JOAO' }]
  };
  const D = base();
  D.usuarios = [{ user_id: 'u1', nome: 'Vendedora Um' }];
  const plano = P.planeja(D, P.converteAgendor(bruto), {});
  const nomes = plano.criar.empresas.map(e => e.nome).sort();
  assert.deepEqual(nomes, ['Atendimento - COLEGIO TESTE', 'Atendimento - COLEGIO TESTE | Carla', 'CENTRO EDUCACIONAL AURORA',
    'Colégio Horizonte - Ensino Fundamental / Médio', 'ESCOLA MODELO | JOAO', 'Indústria Química Exemplo'].sort());
  const escola = plano.criar.empresas.find(e => e.nome === org.name);
  assert.equal(plano.criar.negocios.filter(n => n.empresa_id === escola.id).length, 2, 'negócios vão para a empresa que já existe');
  assert.equal(plano.criar.contatos[0].empresa_id, escola.id, 'pessoa sem empresa acha a empresa de mesmo nome');
  // Reimportar não cria nada de novo.
  const D2 = base(); D2.usuarios = D.usuarios;
  Object.keys(plano.criar).forEach(t => { D2[t] = (D2[t] || []).concat(plano.criar[t]); });
  const plano2 = P.planeja(D2, P.converteAgendor(bruto), {});
  assert.equal(plano2.criar.empresas.length, 0);
  assert.equal(plano2.criar.negocios.length, 0);
});

// Reextração do Agendor (30/09/2026): o que mudou lá desde a 1ª importação tem que chegar ao CRM.
test('reextração: atualiza negócios e tarefas que mudaram, sem desfazer o resto', () => {
  const D = base();
  D.etapas = [{ id: 'e1', funil: 'Vendas', nome: 'Contato', ordem: 1, externo_id: 'agendor:etapa:11' }, { id: 'e2', funil: 'Vendas', nome: 'Proposta', ordem: 2, externo_id: 'agendor:etapa:12' }];
  const v1 = {
    empresas: [{ nome: 'Padaria Exemplo', externo_id: 'agendor:org:1', telefone: '(11) 3333-0001', situacao: 'Lead' }],
    negocios: [{ titulo: 'Pedido 10', empresa_externo: 'agendor:org:1', externo_id: 'agendor:negocio:10', etapa_externo: 'agendor:etapa:11', status: 'Em andamento', valor: 100, criado_em: '2026-09-20T10:00:00Z' }],
    atividades: [{ descricao: 'Ligar amanhã', tipo: 'LIGACAO', empresa_externo: 'agendor:org:1', externo_id: 'agendor:tarefa:5', data_hora: '2026-09-30T13:00:00Z', concluida: false }]
  };
  const p1 = P.planeja(D, v1, {});
  // Como o banco devolve: datas com "+00:00" e números como texto.
  D.empresas.push(...p1.criar.empresas.map(e => Object.assign({}, e, { situacao: 'cliente', cnpj: '11.222.333/0001-81' }))); // completada depois pelas notas
  D.negocios.push(...p1.criar.negocios.map(n => Object.assign({}, n, { valor: '100.00', criado_em: '2026-09-20T10:00:00+00:00' })));
  D.atividades.push(...p1.criar.atividades.map(a => Object.assign({}, a, { data_hora: '2026-09-30T13:00:00+00:00' })));
  const op = { atualizarTabelas: ['negocios', 'atividades'] };

  const igual = P.planeja(D, v1, op);
  assert.equal(igual.atualizar.length, 0, 'nada mudou no Agendor: nada a atualizar (formato de data/número não conta)');

  const v2 = JSON.parse(JSON.stringify(v1));
  Object.assign(v2.negocios[0], { etapa_externo: 'agendor:etapa:12', status: 'Ganho', valor: 150, fechado_em: '2026-09-30T15:00:00Z' });
  Object.assign(v2.atividades[0], { concluida: true, concluida_em: '2026-09-30T13:20:00Z' });
  v2.empresas[0].situacao = 'Lead';
  const sem = P.planeja(D, v2, {});
  const mexido = sem.atualizar.flatMap(a => Object.keys(a.patch));
  assert.ok(!['status', 'etapa_id', 'valor', 'concluida'].some(k => mexido.includes(k)), 'sem a opção, só completa o vazio');

  const plano = P.planeja(D, v2, op);
  const neg = plano.atualizar.find(a => a.tabela === 'negocios');
  assert.deepEqual(neg.patch, { etapa_id: 'e2', status: 'ganho', valor: 150, fechado_em: '2026-09-30' });
  const atv = plano.atualizar.find(a => a.tabela === 'atividades');
  assert.equal(atv.patch.concluida, true);
  assert.equal(atv.patch.concluida_em, '2026-09-30T13:20:00.000Z');
  assert.ok(!('data_hora' in atv.patch), 'a data não mudou');
  const emp = plano.atualizar.filter(a => a.tabela === 'empresas');
  assert.equal(emp.length, 0, 'empresa já era cliente e o "Lead" do Agendor não desfaz isso');
  assert.equal(plano.criar.negocios.length + plano.criar.atividades.length + plano.criar.empresas.length, 0);
  assert.equal(D.negocios[0].status, 'aberto', 'o plano não mexe nos registros originais');
  assert.equal(P.planeja(D, v2, op).atualizar.length, plano.atualizar.length, 'replanejar dá a mesma conta');

  // Reaberto no Agendor: sai a data de fechamento.
  D.negocios[0] = Object.assign({}, D.negocios[0], { status: 'perdido', fechado_em: '2026-09-29', motivo_perda: 'Preço' });
  const reaberto = P.planeja(D, v1, op).atualizar.find(a => a.tabela === 'negocios');
  assert.deepEqual(reaberto.patch, { status: 'aberto', fechado_em: null, motivo_perda: null });
});

test('reextração: cadastro mesclado não volta e empresa repetida por telefone vai para a existente', () => {
  const D = base();
  D.empresas = [{ id: 'fica', nome: 'Condomínio Exemplo', externo_id: 'agendor:org:1', externos_mesclados: ['agendor:org:2'], telefone: '(11) 3333-0001', email: 'sindico@exemplo.com' }];
  const plano = P.planeja(D, {
    empresas: [{ nome: 'Cond. Exemplo Bloco A', externo_id: 'agendor:org:2' }, { nome: 'Exemplo Condomínio (novo)', externo_id: 'agendor:org:3', telefone: '11 3333-0001' }],
    negocios: [{ titulo: 'Pedido 20', empresa_externo: 'agendor:org:2', externo_id: 'agendor:negocio:20' }, { titulo: 'Pedido 30', empresa_externo: 'agendor:org:3', externo_id: 'agendor:negocio:30' }],
    atividades: [{ descricao: 'Visita', empresa_externo: 'agendor:org:3', externo_id: 'agendor:tarefa:7' }]
  }, {});
  assert.equal(plano.criar.empresas.length, 0);
  assert.deepEqual(plano.criar.negocios.map(n => n.empresa_id), ['fica', 'fica']);
  assert.equal(plano.criar.atividades[0].empresa_id, 'fica');
});
