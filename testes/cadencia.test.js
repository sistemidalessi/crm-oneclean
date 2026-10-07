'use strict';
// Cadência de e-mails (cadencia.js: filaCadencia, sugestoesCadencia, resultadosCadencia). Nomes fictícios.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../regras.js');
const C = require('../cadencia.js');

function base() {
  const D = { usuarios: [{ user_id: 'u1', nome: 'Ana Souza' }], etapas: [], opcoes: [], produtos: [], metas: [], empresas: [], contatos: [], negocios: [], negocio_itens: [], propostas: [],
    atividades: [], notas: [], nota_itens: [], email_envios: [], email_campanhas: [] };
  D.nota = (emp, id, dia, valor) => {
    D.notas.push({ id, empresa_id: emp, emitida_em: dia + 'T10:00:00-03:00', valor_total: valor || 100, cancelada: false });
    D.nota_itens.push({ id: id + 'i', nota_id: id, cfop: '5102', descricao: 'DETERGENTE NEUTRO 5LTS', unidade: 'GL', quantidade: 4 });
  };
  return D;
}
const opc = { nomeUsuario: id => (id === 'u1' ? 'Ana Souza' : ''), minhaEmpresa: 'Empresa Exemplo', atraso: new Set() };
const cfg = R.config({});

test('reposição pelo ritmo de compra, com o que o cliente costuma levar', () => {
  const D = base();
  D.empresas.push({ id: 'P', nome: 'PADARIA EXEMPLO | JOÃO', situacao: 'cliente', responsavel_id: 'u1', email: 'compras@padaria.exemplo', email_cadencia: 'mensal' });
  D.contatos.push({ id: 'c1', empresa_id: 'P', nome: 'João Pereira', email: 'joao@padaria.exemplo; compras@padaria.exemplo', principal: true });
  ['2026-08-01', '2026-08-22', '2026-09-12'].forEach((d, i) => D.nota('P', 'n' + i, d));
  let ix = R.indexa(D);
  // ritmo 21 dias: 12/09 + 21 = 03/10; entra 3 dias antes
  assert.equal(C.filaCadencia(D, ix, cfg, '2026-09-29', opc).prontos.length, 0);
  const f = C.filaCadencia(D, ix, cfg, '2026-09-30', opc);
  assert.equal(f.prontos.length, 1);
  const p = f.prontos[0];
  assert.deepEqual([p.tipo, p.responsavel_id, p.para], ['reposicao', 'u1', ['compras@padaria.exemplo', 'joao@padaria.exemplo']]);
  assert.equal(p.assunto, 'Hora de repor os produtos de PADARIA EXEMPLO');
  assert.ok(p.corpo.startsWith('Olá, João!\n\nAqui é Ana, da Empresa Exemplo.'), p.corpo);
  assert.ok(p.corpo.includes('• Detergente neutro 5L — 4 GL') && p.corpo.endsWith('Ana Souza\nEmpresa Exemplo'));
  assert.match(p.motivo, /compra a cada ~21 dias; última compra 12\/09\/2026/);
  // lembrado (enviado ou pulado) desde a última compra: não volta; comprou de novo: volta no próximo ritmo
  D.email_envios.push({ empresa_id: 'P', tipo: 'reposicao', situacao: 'pulado', criado_em: '2026-09-30T12:00:00Z' });
  assert.equal(C.filaCadencia(D, R.indexa(D), cfg, '2026-10-06', opc).prontos.filter(x => x.tipo === 'reposicao').length, 0);
});

test('relacionamento no intervalo da cadência, uma campanha por vez, e o que segura', () => {
  const D = base();
  D.empresas.push({ id: 'A', nome: 'Escritório Alfa', situacao: 'cliente', responsavel_id: 'u1', email: 'alfa@exemplo.com', email_cadencia: 'quinzenal', segmento: 'Escritório' },
    { id: 'B', nome: 'Condomínio Beta', situacao: 'cliente', responsavel_id: 'u1', email: 'beta@exemplo.com', email_cadencia: 'mensal', segmento: 'Condomínio' },
    { id: 'S', nome: 'Saiu', situacao: 'cliente', email: 's@exemplo.com', email_cadencia: 'mensal', email_sair_em: '2026-10-01T12:00:00Z' },
    { id: 'V', nome: 'Sem e-mail', situacao: 'cliente', email: 'não tem', email_cadencia: 'mensal' },
    { id: 'N', nome: 'Negociando', situacao: 'cliente', email: 'n@exemplo.com', email_cadencia: 'mensal' },
    { id: 'T', nome: 'Em atraso', situacao: 'cliente', email: 't@exemplo.com', email_cadencia: 'mensal' },
    { id: 'F', nome: 'Fora da cadência', situacao: 'cliente', email: 'f@exemplo.com' });
  D.negocios.push({ id: 'g1', empresa_id: 'N', status: 'aberto', etapa_desde: '2026-10-05T10:00:00Z', criado_em: '2026-10-01T10:00:00Z' });
  D.email_campanhas.push({ id: 'k1', assunto: 'Novidades de outubro, {primeiro_nome}', corpo: '{saudacao} Chegou a linha nova. {vendedor}', desde: '2026-10-01', ativa: true },
    { id: 'k2', assunto: 'Só para condomínios', corpo: 'texto', desde: '2026-10-02', segmento: 'condominio', ativa: true });
  const o = Object.assign({}, opc, { atraso: new Set(['T']) });
  let f = C.filaCadencia(D, R.indexa(D), cfg, '2026-10-07', o);
  assert.deepEqual(f.prontos.map(x => [x.empresa_id, x.tipo, x.campanha_id]), [['A', 'relacionamento', 'k1'], ['B', 'relacionamento', 'k2']], 'a do segmento mais nova vence; sem segmento vale para todos');
  assert.equal(f.prontos[0].assunto, 'Novidades de outubro, ');
  assert.equal(f.prontos[0].corpo, 'Olá! Chegou a linha nova. Ana Souza');
  assert.deepEqual(Object.fromEntries(f.segurados.map(s => [s.empresa_id, s.motivo.split(':')[0]])),
    { S: 'pediu para não receber em 01/10/2026', V: 'sem e-mail cadastrado', N: 'negócio em andamento', T: 'duplicata em atraso' });
  // A recebeu a k1 hoje: quinzenal volta em 14 dias, mas só se houver campanha que ele não recebeu
  D.email_envios.push({ empresa_id: 'A', tipo: 'relacionamento', campanha_id: 'k1', situacao: 'enviado', criado_em: '2026-10-07T12:00:00Z' });
  assert.equal(C.filaCadencia(D, R.indexa(D), cfg, '2026-10-20', o).prontos.filter(x => x.empresa_id === 'A').length, 0, 'antes dos 14 dias');
  f = C.filaCadencia(D, R.indexa(D), cfg, '2026-10-21', o);
  assert.equal(f.semCampanha, 1, 'A espera campanha nova');
  D.email_campanhas.push({ id: 'k3', assunto: 'Condições de novembro', corpo: 'x', desde: '2026-10-20', ativa: true });
  assert.deepEqual(C.filaCadencia(D, R.indexa(D), cfg, '2026-10-21', o).prontos.filter(x => x.empresa_id === 'A').map(x => x.campanha_id), ['k3']);
  // erro de envio não conta como contato; comprou há menos de 7 dias segura o relacionamento
  D.email_envios.push({ empresa_id: 'B', tipo: 'relacionamento', campanha_id: 'k2', situacao: 'erro', criado_em: '2026-10-07T12:00:00Z' });
  D.nota('B', 'nb', '2026-10-03');
  f = C.filaCadencia(D, R.indexa(D), cfg, '2026-10-07', o);
  assert.match(f.segurados.find(s => s.empresa_id === 'B').motivo, /comprou há 4 dia/);
});

test('sugestões de quem pode entrar e resultado dos envios', () => {
  const D = base();
  D.empresas.push({ id: 'X', nome: 'Só e-mail', situacao: 'cliente', email: 'x@exemplo.com' },
    { id: 'Y', nome: 'Fala por WhatsApp', situacao: 'cliente', email: 'y@exemplo.com' },
    { id: 'Z', nome: 'Já na cadência', situacao: 'cliente', email: 'z@exemplo.com', email_cadencia: 'mensal' },
    { id: 'W', nome: 'Sem e-mail', situacao: 'cliente' });
  ['X', 'Y', 'Z', 'W'].forEach(e => D.nota(e, 'n' + e, '2026-09-01', 500));
  D.atividades.push({ id: 'a1', empresa_id: 'Y', tipo: 'whatsapp', concluida: true, concluida_em: '2026-09-20T10:00:00Z', data_hora: '2026-09-20T10:00:00Z' });
  assert.deepEqual(C.sugestoesCadencia(D, R.indexa(D), '2026-10-07').map(e => e.id), ['X']);
  D.email_envios.push({ empresa_id: 'Z', situacao: 'enviado', tipo: 'relacionamento', criado_em: '2026-09-20T12:00:00Z', aberto_em: '2026-09-20T13:00:00Z' },
    { empresa_id: 'X', situacao: 'enviado', tipo: 'reposicao', criado_em: '2026-09-25T12:00:00Z' },
    { empresa_id: 'X', situacao: 'pulado', tipo: 'reposicao', criado_em: '2026-09-26T12:00:00Z' });
  D.nota('Z', 'nz2', '2026-09-28', 321.5);
  assert.deepEqual(C.resultadosCadencia(D, R.indexa(D), '2026-10-07', 30), { enviados: 2, abertos: 1, clicados: 0, compraram: 1, valor: 321.5 });
});
