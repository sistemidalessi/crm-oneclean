// Apresentação dos diretores (apresentacao.js): quem recebe, a versão de líder e o que o texto precisa dizer sempre.
const test = require('node:test');
const assert = require('node:assert');
const A = require('../apresentacao.js');
const O = { empresa: 'Empresa Teste', grupo: 'Grupo Teste' };
const tudo = t => [t.saudacao, t.apresentacao].concat(t.paragrafos, t.importante, [t.convite]).join(' ');

test('cada papel recebe o diretor da área; administrador e motorista não recebem', () => {
  assert.strictEqual(A.texto('vendedor', 'Ana', O).diretor, 'gerente-vendas');
  assert.strictEqual(A.texto('gestor', 'Ana', O).diretor, 'gerente-vendas');
  assert.strictEqual(A.texto('comprador', 'Ana', O).diretor, 'compras-setor-interno');
  assert.strictEqual(A.texto('logistica', 'Ana', O).diretor, 'logistica');
  assert.strictEqual(A.texto('admin', 'Ana', O), null);
  assert.strictEqual(A.texto('motorista', 'Ana', O), null);
});

test('todo texto diz que é IA, o que não faz e que a diretoria reporta ao CEO do grupo', () => {
  for (const p of ['vendedor', 'gestor', 'comprador', 'logistica']) {
    const t = A.texto(p, 'Ana', O), s = tudo(t);
    assert.match(s, /inteligência artificial/, p);
    assert.match(s, /não envio mensagens a clientes/, p);
    assert.match(s, /relatórios .* ao CEO do Grupo Teste/, p);
    assert.match(s, /treinamentos/, p);
    assert.match(s, /^Olá, Ana\./, p);
    assert.ok(s.includes('Empresa Teste'), p);
    // postura de diretor (27/10/2026): cobra plano e prazo, sem tom de parceiro
    assert.match(s, /planos? de ação/, p);
    assert.doesNotMatch(s, /parceir|caminhar ao seu lado|Conte comigo/i, p);
    // a apresentação nunca fala das orientações em off
    assert.doesNotMatch(s, /orienta|diretriz/i, p);
  }
});

test('a gestora recebe a versão de líder', () => {
  const g = tudo(A.texto('gestor', 'Ana', O)), v = tudo(A.texto('vendedor', 'Ana', O));
  assert.match(g, /liderança/);
  assert.match(g, /pedidos de retorno sobre os resultados da equipe/);
  assert.doesNotMatch(v, /liderança/);
});

test('sem nome, a saudação fica só "Olá."', () => {
  assert.strictEqual(A.texto('vendedor', '', O).saudacao, 'Olá.');
});
