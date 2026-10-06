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
  assert.deepEqual(F.desfazer(baixada).atualizar, [{ id: 'c3', patch: { situacao: 'aberto', pago_em: null, baixa: null, baixado_em: null, valor: 380, vencimento: '2026-10-15', frase: null, frase_antes: null } }]);

  p = um('recebi 2.301 drogaria ontem', { titulos });
  g = F.gravacao(p, { titulos, agora });
  assert.equal(g.inserir.length, 1);
  assert.deepEqual([g.inserir[0].origem, g.inserir[0].titulo_duplicata, g.inserir[0].valor, g.inserir[0].pago_em], ['titulo', '100-1', 2301, '2026-10-05']);
  assert.deepEqual(F.desfazer(Object.assign({ id: 'n1' }, g.inserir[0])).remover, ['n1']);

  p = um('vai sair 12 mil de fornecedor dia 20');
  g = F.gravacao(p, { agora });
  assert.deepEqual([g.inserir[0].situacao, g.inserir[0].pago_em, g.inserir[0].vencimento, g.inserir[0].origem], ['aberto', null, '2026-10-20', 'tela']);
  p = um('almoço 85 pago hoje');
  g = F.gravacao(p, { agora });
  assert.deepEqual([g.inserir[0].situacao, g.inserir[0].pago_em, g.inserir[0].baixa], ['pago', HOJE, 'caixa']);
  assert.equal(F.desfazer({ id: 'x', situacao: 'pago' }), null, 'lançamento que não veio de frase');
  p.acao = 'ignorar';
  assert.deepEqual(F.gravacao(p, { agora }), { inserir: [], atualizar: [], titulos: [], recorrentes: [] });
});

test('receber pela frase um título com previsão ligada baixa a previsão (não cria outra entrada)', () => {
  const lancamentos = [{ id: 'm1', tipo: 'entrada', descricao: 'Material vendido à Agilité — Alfa', valor: 798.79, vencimento: '2026-10-20', situacao: 'aberto', titulo_duplicata: '00991/01', entre_empresas: true }];
  const titulos = [{ duplicata: '00991/01', cliente_nome: 'AGILITE FICTICIA', valor: 798.79, vencimento: '2026-10-20' }];
  const p = um('recebi 798,79 da agilite hoje', { lancamentos, titulos });
  assert.equal(p.acao, 'titulo:00991/01');
  const g = F.gravacao(p, { lancamentos, titulos, agora: 'x' });
  assert.deepEqual([g.inserir.length, g.atualizar.length, g.atualizar[0].id, g.atualizar[0].patch.situacao], [0, 1, 'm1', 'pago']);
  assert.deepEqual(F.desfazer(Object.assign({}, lancamentos[0], g.atualizar[0].patch)).atualizar[0].patch.situacao, 'aberto');
});

// Critério de aceite combinado com o caixa da Agilité (06/10/2026): a mesma frase dá o mesmo resultado
// nos dois sistemas. Mesmas frases do pedido, com nomes trocados por fictícios.
test('aceite com a Agilité: separação, valores, parcelas e direção', () => {
  let l = le('vt: 63 - vr: 152,67 - paseo');
  assert.deepEqual(l.map(x => [x.tipo, x.valor, x.data, x.rotulo]), [['saida', 63, HOJE, 'vt paseo'], ['saida', 152.67, HOJE, 'vr paseo']]);
  l = le('paguei Credor - I 1.764,46 parcela 05 de 48');
  assert.deepEqual(l.map(x => [x.tipo, x.valor, x.parcelas || null]), [['saida', 1764.46, null]], 'não é R$ 5 nem parcelamento');
  l = le('Cartão 12x de 350 notebook');
  assert.deepEqual(l.map(x => [x.tipo, x.valor, x.parcelas, x.categoria]), [['saida', 350, 12, 'Cartões']]);
  assert.equal(F.gravacao(l[0], { agora: 'x' }).inserir[0].parcelas, 12);
  l = le('Monitora 244,27 dia 15');
  assert.deepEqual(l.map(x => [x.tipo, x.valor, x.data, x.situacao]), [['saida', 244.27, '2026-10-15', 'previsto']]);
  l = le('VT 300, VR 500 Condominio Alfa pago hoje');
  assert.deepEqual(l.map(x => [x.tipo, x.valor, x.data, x.situacao, x.categoria, x.podeLembrar]), [['saida', 300, HOJE, 'realizado', 'Benefícios (VT, VR, cesta)', false], ['saida', 500, HOJE, 'realizado', 'Benefícios (VT, VR, cesta)', false]]);
  l = le('recebi 12.328,72 Cliente Fulano ontem');
  assert.deepEqual(l.map(x => [x.tipo, x.valor, x.data]), [['entrada', 12328.72, '2026-10-05']]);
  assert.equal(F.extrairValor('100,000,00').valor, 100000);
  assert.equal(F.extrairValor('1,570,77').valor, 1570.77);
  assert.equal(F.extrairValor('100,000').valor, 100000);
  l = le('entrada 5.000 reembolso Empresa Beta\nsaída 5.000 Monitora dia 15');
  assert.deepEqual(l.map(x => [x.tipo, x.valor, !!x.emprestimo]), [['entrada', 5000, false], ['saida', 5000, false]], 'nomes diferentes: dois lançamentos');
});

test('aceite com a Agilité: empréstimos (devolução única, em outra linha e em parcelas)', () => {
  let l = le('entrada de 29.000 Fulana - data de hoje\nsaída 29.000 Fulana - dia 14/10');
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].tipo, l[0].valor, l[0].data, l[0].categoria, l[0].emprestimo.credor, l[0].emprestimo.devolve, l[0].emprestimo.em], ['entrada', 29000, HOJE, 'Empréstimos recebidos', 'Fulana', 29000, '2026-10-14']);
  l = le('entrou 57550 de Banco Exemplo e será devolvido 60000 no dia 14/10, a diferença é juros');
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].valor, l[0].data, l[0].emprestimo.devolve, l[0].emprestimo.em], [57550, HOJE, 60000, '2026-10-14']);
  let g = F.gravacao(l[0], { agora: 'x' });
  assert.deepEqual(g.inserir.map(x => [x.tipo, x.valor, x.vencimento, x.situacao, x.emprestimo || false, x.juros || null]),
    [['entrada', 57550, HOJE, 'pago', true, null], ['saida', 60000, '2026-10-14', 'aberto', false, 2450]]);
  l = le('entrou 48 mil do Fulano, sai dia 14');
  assert.deepEqual([l.length, l[0].valor, l[0].data, l[0].emprestimo.devolve, l[0].emprestimo.em], [1, 48000, HOJE, 48000, '2026-10-14']);
  for (const frase of ['empréstimo de R$ 100,000,00 - Credor Exemplo\ndevolução será 48 parcelas de R$ 3.292,29, todo dia 18 de cada mês, onde a primeira será 18/10.',
    'empréstimo de R$ 100.000,00 do Credor, devolve em 48x de 3.292,29 a partir de 18/10']) {
    l = le(frase);
    assert.equal(l.length, 1, frase);
    assert.deepEqual([l[0].tipo, l[0].valor, l[0].data, l[0].situacao], ['entrada', 100000, HOJE, 'realizado'], 'a entrada é de hoje e já aconteceu');
    assert.deepEqual(l[0].emprestimo.parcelas, { n: 48, valor: 3292.29, primeira: '2026-10-18', dia: 18 });
    g = F.gravacao(l[0], { agora: 'x' });
    assert.equal(g.recorrentes.length, 1);
    const rec = g.recorrentes[0];
    assert.deepEqual([rec.valor, rec.parcelas, rec.dia, rec.inicio, rec.valor_contratado, rec.categoria], [3292.29, 48, 18, '2026-10-01', 100000, 'Empréstimos e giro']);
    const p1 = g.inserir.find(x => x.recorrente_id === rec.id);
    assert.deepEqual([p1.vencimento, p1.valor, p1.parcela, p1.juros], ['2026-10-18', 3292.29, 1, 2048.27], 'parcela 01 com os juros da Price');
    assert.deepEqual(g.inserir[0].frase_antes.criou, { lancamentos: [p1.id], recorrentes: [rec.id] });
  }
});

test('desfazer o empréstimo em parcelas: apaga tudo, ou só desliga a recorrente se já pagou parcela', () => {
  const l = le('empréstimo de 100 mil do Credor, devolve em 48x de 3.292,29 a partir de 18/10');
  const g = F.gravacao(l[0], { agora: 'x' });
  const entrada = g.inserir[0], p1 = g.inserir[1], rid = g.recorrentes[0].id;
  const p2 = { id: 'p2', recorrente_id: rid, situacao: 'aberto' };
  let d = F.desfazer(entrada, { lancamentos: g.inserir.concat([p2]) });
  assert.deepEqual([d.remover.sort(), d.recorrentesRemover, d.recorrentesDesligar], [[entrada.id, p1.id, 'p2'].sort(), [rid], []]);
  d = F.desfazer(entrada, { lancamentos: [entrada, Object.assign({}, p1, { situacao: 'pago' }), p2] });
  assert.deepEqual([d.remover.sort(), d.recorrentesRemover, d.recorrentesDesligar], [[entrada.id, 'p2'].sort(), [], [rid]]);
});

test('casar com conta já lançada: o nome do cliente não basta e a palavra forte não paga outra categoria', () => {
  const lancamentos = [{ id: 's1', tipo: 'saida', descricao: 'Monitoramento Sekron — Espaço Exemplo', categoria: 'Sekron (monitoramento)', valor: 624, vencimento: '2026-10-15', situacao: 'aberto' }];
  const clientes = [{ id: 'c1', nome: 'CONDOMINIO ESPACO EXEMPLO' }];
  assert.equal(le('8 diárias julia Espaço e Vida 624').length, 1, '"Espaço e Vida" não parte a frase em dois itens');
  let p = um('8 diárias julia Espaço Exemplo 624', { lancamentos, clientes });
  assert.equal(p.valor, 624, '"8 diárias" é quantidade');
  assert.equal(p.acao, 'novo');
  assert.equal(p.categoria, 'Diárias de cobertura');
  assert.ok(p.opcoes.some(o => o.acao === 'baixar:s1'), 'a conta continua nas opções');
  p = um('8 diárias julia Espaço Exemplo 624', { lancamentos });
  assert.equal(p.acao, 'novo', 'mesmo sem o cadastro do cliente, a palavra "diária" não paga o Sekron');
  p = um('sekron espaço exemplo 624 dia 15', { lancamentos, clientes });
  assert.equal(p.acao, 'ignorar', 'Sekron previsto igual à conta dele: "já está no caixa", não duplica');
  assert.match(p.motivo, /já está no caixa/);
  p = um('paguei sekron espaço exemplo 624', { lancamentos, clientes });
  assert.equal(p.acao, 'baixar:s1');
});

test('palavra genérica (compra, mercadoria) não acha cadastro de cliente', () => {
  const p = um('saiu 502,05 compra de mercadoria', { clientes: [{ id: 'c', nome: '| A/C COMPRAS' }], fornecedores: [{ nome: 'MERCADORIAS EXEMPLO LTDA' }] });
  assert.deepEqual([p.valor, p.situacao, p.categoria, p.fornecedor], [502.05, 'realizado', 'Fornecedores', '']);
});

test('transferência entre empresas (espelho da Agilité): entrada hoje, volta prevista, baixa sem duplicar', () => {
  let l = le('recebi 1.600 da Agilité pra pagar as contas de hoje, devolvo dia 14');
  assert.equal(l.length, 1);
  const p = l[0];
  assert.deepEqual([p.tipo, p.valor, p.data, p.situacao, p.categoria, p.entre_empresas, p.podeLembrar, !!p.emprestimo],
    ['entrada', 1600, HOJE, 'realizado', 'Transferência entre empresas', true, false, false]);
  assert.deepEqual(p.transferencia, { volta: '2026-10-14', valor: 1600 });
  const g = F.gravacao(p, { agora: 'x' });
  assert.deepEqual(g.inserir.map(x => [x.tipo, x.valor, x.vencimento, x.situacao, x.categoria, x.entre_empresas]),
    [['entrada', 1600, HOJE, 'pago', 'Transferência entre empresas', true], ['saida', 1600, '2026-10-14', 'aberto', 'Transferência entre empresas', true]]);
  assert.deepEqual(F.desfazer(Object.assign({}, g.inserir[0]), { lancamentos: g.inserir }).remover.sort(), g.inserir.map(x => x.id).sort());
  // no dia 14: "devolvi 1.600 pra Agilité" dá baixa na volta prevista
  const volta = Object.assign({}, g.inserir[1]);
  const d = F.classificar(F.interpretar('devolvi 1.600 pra Agilité', '2026-10-14').itens, Object.assign({}, vazio, { hoje: '2026-10-14', lancamentos: [volta] }))[0];
  assert.equal(d.acao, 'baixar:' + volta.id);
  // material, reembolso e "entrou … da Agilité" sem palavra de transferência continuam como eram
  assert.equal(um('entrou 5 mil da Agilité').categoria, 'Material vendido à Agilité');
  assert.equal(um('paguei 3.000 reembolso folha agilité').categoria, 'Reembolso da folha à Agilité');
  assert.equal(um('transferi 500 pra Agilité, devolve dia 20').transferencia.volta, '2026-10-20');
});

test('transferência ditada (Agilité b837d37): "vai retornar dia 14" é a volta e "Agility" é a Agilité', () => {
  const casos = [
    'entrou r$ 1.600 da Agility hoje e vai retornar no dia 14/10',
    'recebi 1.600 da agiliti pra pagar as contas de hoje e vai voltar dia 14',
    'caiu 1.600 da agilite hoje, retorna dia 14'
  ];
  casos.forEach(t => {
    const p = um(t);
    assert.deepEqual([p.tipo, p.valor, p.data, p.situacao, p.categoria, p.entre_empresas], ['entrada', 1600, HOJE, 'realizado', 'Transferência entre empresas', true], t);
    assert.deepEqual(p.transferencia, { volta: '2026-10-14', valor: 1600 }, t);
  });
  // o leitor (igual ao da Agilité): " e vai retornar…" é outro pedaço e não deixa a saída de hoje prevista
  const it = F.interpretar('saiu r$ 1.600 para o fornecedor hoje e vai retornar no dia 14/10', HOJE).itens;
  assert.equal(it.length, 1);
  assert.deepEqual([it[0].tipo, it[0].valor, it[0].data, it[0].situacao, it[0].devolucaoPrevista], ['saida', 1600, HOJE, 'realizado', '2026-10-14']);
  // "agilidade" não é a Agilité
  assert.notEqual(um('paguei 300 consultoria de agilidade').categoria, 'Transferência entre empresas');
});
