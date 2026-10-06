'use strict';
// Caixa por frases (frases.js). Nomes de cliente e fornecedor fictícios (repositório público).
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../frases.js');

const HOJE = '2026-10-06'; // terça
const vazio = { hoje: HOJE, lancamentos: [], titulos: [], clientes: [], fornecedores: [], regras: [] };
const le = (t, ctx, opts) => F.classificar(F.interpretar(t, HOJE, opts).itens, Object.assign({}, vazio, ctx || {}));
const um = (t, ctx, opts) => { const l = le(t, ctx, opts); assert.equal(l.length, 1, 'um item em "' + t + '"'); return l[0]; };

test('os exemplos do pedido', () => {
  let p = um('pedágio 350 pago hoje');
  assert.deepEqual([p.tipo, p.valor, p.data, p.situacao, p.descricao, p.categoria, p.acao], ['saida', 350, HOJE, 'realizado', 'Pedágio', 'Frete e combustível', 'novo']);
  p = um('paguei 1.570,77 cartão Inter');
  assert.deepEqual([p.tipo, p.valor, p.data, p.situacao, p.categoria], ['saida', 1570.77, HOJE, 'realizado', 'Cartões']);
  p = um('aluguel galpão 4.500 dia 10');
  assert.deepEqual([p.tipo, p.valor, p.data, p.situacao, p.categoria], ['saida', 4500, '2026-10-10', 'previsto', 'Aluguel']);
  p = um('recebi 2.300 da Drogaria Fictícia ontem');
  assert.deepEqual([p.tipo, p.valor, p.data, p.situacao], ['entrada', 2300, '2026-10-05', 'realizado']);
  p = um('entrou 5 mil da Agilité');
  assert.deepEqual([p.tipo, p.valor, p.situacao, p.categoria, p.entre_empresas], ['entrada', 5000, 'realizado', 'Material vendido à Agilité', true]);
  const dois = le('combustível 200, almoço 85 pago hoje');
  assert.deepEqual(dois.map(x => [x.tipo, x.valor, x.data, x.situacao]), [['saida', 200, HOJE, 'realizado'], ['saida', 85, HOJE, 'realizado']]);
  assert.equal(dois[0].categoria, 'Frete e combustível');
  p = um('vai sair 12 mil de fornecedor dia 20');
  assert.deepEqual([p.tipo, p.valor, p.data, p.situacao, p.categoria, p.acao], ['saida', 12000, '2026-10-20', 'previsto', 'Fornecedores', 'novo']);
});

test('linha sem valor vira aviso; o "+" da célula dá o dia e a seção', () => {
  const r = F.interpretar('pago hoje\nmaterial 300', HOJE, { dataPadrao: '2026-10-08', tipoPadrao: 'entrada' });
  assert.equal(r.avisos.length, 1);
  assert.deepEqual([r.itens[0].tipo, r.itens[0].data, r.itens[0].situacao], ['entrada', '2026-10-08', 'previsto']);
});

test('conta em aberto que bate: baixa nela, sem duplicar', () => {
  const lancamentos = [
    { id: 'c1', tipo: 'saida', descricao: 'Cartão Banco Fictício', valor: 1580, vencimento: '2026-10-05', situacao: 'aberto' },
    { id: 'c2', tipo: 'saida', descricao: 'Cartão Outro', valor: 1575, vencimento: '2026-10-05', situacao: 'aberto' },
    { id: 'c3', tipo: 'saida', descricao: 'Pedágio', valor: 380, vencimento: '2026-10-15', situacao: 'aberto' },
    { id: 'c4', tipo: 'saida', descricao: 'Pedágio', valor: 380, vencimento: '2026-12-15', situacao: 'aberto' }, // longe demais
    { id: 'c5', tipo: 'saida', descricao: 'Aluguel do galpão', valor: 4500, vencimento: '2026-10-10', situacao: 'aberto' },
    { id: 'c6', tipo: 'saida', descricao: 'Energia', valor: 900, vencimento: '2026-10-12', situacao: 'pago', pago_em: '2026-10-01' }
  ];
  let p = um('paguei 1.570,77 cartão fictício', { lancamentos });
  assert.equal(p.acao, 'baixar:c1', 'a palavra em comum decide entre os dois cartões');
  assert.ok(p.opcoes.some(o => o.acao === 'baixar:c2'), 'o outro cartão fica como opção');
  p = um('pedágio 350 pago hoje', { lancamentos });
  assert.equal(p.acao, 'baixar:c3');
  p = um('aluguel galpão 4.500 dia 10', { lancamentos });
  assert.equal(p.acao, 'ignorar', 'já está no caixa igualzinho');
  p = um('aluguel galpão 4.650 dia 11', { lancamentos });
  assert.equal(p.acao, 'ajustar:c5', 'futuro com valor novo: ajusta a conta');
  p = um('energia 900 paga hoje', { lancamentos });
  assert.equal(p.acao, 'novo', 'conta já paga não casa');
  p = um('pedágio 900 pago hoje', { lancamentos });
  assert.equal(p.acao, 'novo', 'valor longe demais (mais de 8% e de R$ 60)');
  // a mesma conta não serve para dois itens da mesma leitura
  const l = le('pedágio 350 pago hoje\npedágio 360 pago hoje', { lancamentos });
  assert.deepEqual(l.map(x => x.acao), ['baixar:c3', 'novo']);
});

test('entrada × contas a receber: um título, vários do mesmo cliente, ou previsto', () => {
  const titulos = [
    { duplicata: '100-1', cliente_nome: 'DROGARIA FICTICIA LTDA', valor: 2300, vencimento: '2026-10-02' },
    { duplicata: '200-1', cliente_nome: 'MERCADO EXEMPLO LTDA', valor: 2300, vencimento: '2026-10-02' },
    { duplicata: '300-1', cliente_nome: 'PADARIA MODELO', valor: 1000, vencimento: '2026-09-28' },
    { duplicata: '300-2', cliente_nome: 'PADARIA MODELO', valor: 1500.5, vencimento: '2026-10-05' },
    { duplicata: '300-3', cliente_nome: 'PADARIA MODELO', valor: 700, vencimento: '2026-11-05' },
    { duplicata: '400-1', cliente_nome: 'JA RECEBIDO SA', valor: 777, vencimento: '2026-10-01' }
  ];
  const lancamentos = [{ id: 'r1', tipo: 'entrada', descricao: 'Recebido', valor: 777, vencimento: '2026-10-01', situacao: 'pago', pago_em: '2026-10-02', titulo_duplicata: '400-1' }];
  const clientes = [{ id: 'e1', nome: 'DROGARIA FICTICIA LTDA' }, { id: 'e2', nome: 'PADARIA MODELO' }];
  let p = um('recebi 2.300 da Drogaria Fictícia ontem', { titulos, lancamentos, clientes });
  assert.equal(p.acao, 'titulo:100-1', 'o nome desempata os dois títulos de 2.300');
  assert.ok(p.opcoes.some(o => o.acao === 'titulo:200-1'));
  p = um('recebi 2.320 da drogaria ficticia', { titulos, lancamentos, clientes });
  assert.equal(p.acao, 'novo', 'mais de 0,5% de diferença não casa');
  assert.equal(p.fornecedor, 'DROGARIA FICTICIA LTDA');
  assert.equal(p.categoria, 'Duplicatas recebidas', 'cliente do CRM');
  p = um('caiu 2.500,50 padaria modelo', { titulos, lancamentos, clientes });
  assert.equal(p.acao, 'titulo:300-1,300-2', 'dois títulos do mesmo cliente somam o valor');
  p = um('recebi 777 hoje', { titulos, lancamentos, clientes });
  assert.equal(p.acao, 'novo', 'título já recebido não casa de novo');
  p = um('vai entrar 2.300 dia 15', { titulos, lancamentos, clientes });
  assert.equal(p.acao, 'ignorar', 'entrada futura que já é um título');
});

test('fornecedor pelo nome, regra aprendida e Agilité', () => {
  const fornecedores = [{ nome: 'SEKRONIX COMERCIO LTDA' }, { nome: 'POSTO COMBUSTIVEL SOL' }];
  let p = um('sekronix 244,27 dia 15', { fornecedores });
  assert.equal(p.fornecedor, 'SEKRONIX COMERCIO LTDA');
  p = um('combustível 200 pago hoje', { fornecedores });
  assert.equal(p.fornecedor, '', 'uma palavra de três do nome não basta');
  const regras = [{ id: 'g1', tipo: 'saida', chave: 'almoco', categoria: 'Alimentação' }, { id: 'g2', tipo: 'saida', chave: 'perua', categoria: 'Perua escolar', fornecedor: 'Tio Fictício' }];
  p = um('almoço 85 pago hoje', { regras });
  assert.deepEqual([p.categoria, p.regra], ['Alimentação', 'g1']);
  p = um('perua escolar 650 dia 10', { regras });
  assert.deepEqual([p.categoria, p.fornecedor], ['Perua escolar', 'Tio Fictício']);
  assert.equal(F.chaveRegra('Perua escolar'), 'escolar perua');
  p = um('paguei 3.000 reembolso folha agilité');
  assert.deepEqual([p.categoria, p.entre_empresas], ['Reembolso da folha à Agilité', true]);
});

test('gravação e desfazer', () => {
  const agora = '2026-10-06T12:00:00.000Z';
  const lancamentos = [{ id: 'c3', tipo: 'saida', descricao: 'Pedágio', valor: 380, vencimento: '2026-10-15', situacao: 'aberto' }];
  const titulos = [{ duplicata: '100-1', cliente_nome: 'DROGARIA FICTICIA LTDA', valor: 2300, vencimento: '2026-10-02' }];
  let p = um('pedágio 350 pago hoje', { lancamentos });
  let g = F.gravacao(p, { lancamentos, agora });
  assert.deepEqual(g.atualizar[0].patch, { situacao: 'pago', pago_em: HOJE, baixa: 'caixa', baixado_em: agora, valor: 350, frase: 'pedágio 350 pago hoje',
    frase_antes: { situacao: 'aberto', pago_em: null, baixa: null, baixado_em: null, valor: 380, vencimento: '2026-10-15' } });
  const baixada = Object.assign({}, lancamentos[0], g.atualizar[0].patch);
  assert.deepEqual(F.desfazer(baixada), { id: 'c3', patch: { situacao: 'aberto', pago_em: null, baixa: null, baixado_em: null, valor: 380, vencimento: '2026-10-15', frase: null, frase_antes: null } });

  p = um('recebi 2.301 drogaria ontem', { titulos });
  g = F.gravacao(p, { titulos, agora });
  assert.equal(g.inserir.length, 1);
  assert.deepEqual([g.inserir[0].origem, g.inserir[0].titulo_duplicata, g.inserir[0].valor, g.inserir[0].pago_em], ['titulo', '100-1', 2301, '2026-10-05']);
  assert.deepEqual(F.desfazer(Object.assign({ id: 'n1' }, g.inserir[0])), { remover: 'n1' });

  p = um('vai sair 12 mil de fornecedor dia 20');
  g = F.gravacao(p, { agora });
  assert.deepEqual([g.inserir[0].situacao, g.inserir[0].pago_em, g.inserir[0].vencimento, g.inserir[0].origem], ['aberto', null, '2026-10-20', 'tela']);
  p = um('almoço 85 pago hoje');
  g = F.gravacao(p, { agora });
  assert.deepEqual([g.inserir[0].situacao, g.inserir[0].pago_em, g.inserir[0].baixa], ['pago', HOJE, 'caixa']);
  assert.equal(F.desfazer({ id: 'x', situacao: 'pago' }), null, 'lançamento que não veio de frase');
  p.acao = 'ignorar';
  assert.deepEqual(F.gravacao(p, { agora }), { inserir: [], atualizar: [], titulos: [] });
});
