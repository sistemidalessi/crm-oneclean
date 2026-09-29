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
