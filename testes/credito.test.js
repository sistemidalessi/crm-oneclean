'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../credito.js');

// consulta FICTÍCIA de uma empresa boa (score 780, sem restrições, 100% pontual, limite sugerido R$ 45.000, troca de sócio
// há 3 anos): compra de R$ 1.500 por mês → R$ 3.000 a prazo, 35 dias (era 28 até 04/11/2026). (Nunca dados reais de cliente: o repositório é público.)
const MBS = { razao_social: 'EMPRESA EXEMPLO LTDA', documento: '11222333000181', situacao_cadastral: 'Ativo', fundacao: '1990-01-15',
  score: 780, prob_inadimplencia: 3, recomendacao: 'Negociação Recomendada', pendencias_qtd: 0, pendencias_valor: 0, protestos_qtd: 0, protestos_valor: 0,
  cheques_qtd: 0, acoes_qtd: 0, falencia: false, fraude: false, pontualidade: 100, atraso_mais_60: false, limite_sugerido: 45000,
  faturamento_presumido: 'De R$ 800.001 até R$ 1.000.000', mudanca_societaria: 'sócio único desde 2023', mudanca_em: '2023-09-01', consultas_12m: 2, alertas: ['consulta de factoring no último ano'] };
const hoje = '2026-10-27';

test('MBS: 2 meses de compra, 35 dias, revisão em 6 meses', () => {
  const p = C.propor(MBS, { compra_mensal: 1500, hoje });
  assert.strictEqual(p.situacao, 'prazo');
  assert.strictEqual(p.limite, 3000);
  assert.strictEqual(p.prazo_max, 35);
  assert.strictEqual(p.revisar_em, '2027-04-27');
  assert.ok(p.atencao.some(a => /factoring/.test(a)));
});

test('restrição, protesto ou CNPJ inativo: só à vista', () => {
  assert.strictEqual(C.propor(Object.assign({}, MBS, { protestos_qtd: 1, protestos_valor: 800 }), { compra_mensal: 1500, hoje }).situacao, 'vista');
  assert.strictEqual(C.propor(Object.assign({}, MBS, { pendencias_qtd: 2 }), { hoje }).situacao, 'vista');
  assert.strictEqual(C.propor(Object.assign({}, MBS, { situacao_cadastral: 'Baixada' }), { hoje }).situacao, 'vista');
  assert.strictEqual(C.propor(Object.assign({}, MBS, { fraude: true }), { hoje }).situacao, 'vista');
});

test('score: abaixo de 400 à vista; 400-599 um mês e 21 dias; sem score em análise', () => {
  assert.strictEqual(C.propor(Object.assign({}, MBS, { score: 350 }), { compra_mensal: 1500, hoje }).situacao, 'vista');
  const m = C.propor(Object.assign({}, MBS, { score: 500 }), { compra_mensal: 1500, hoje });
  assert.deepStrictEqual([m.situacao, m.limite, m.prazo_max], ['prazo', 1500, 21]);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { score: 0 }), { hoje }).situacao, 'analise');
});

test('pontualidade baixa desce um degrau; empresa nova ou troca recente de sócio: um mês', () => {
  const a = C.propor(Object.assign({}, MBS, { pontualidade: 60 }), { compra_mensal: 1500, hoje });
  assert.deepStrictEqual([a.situacao, a.limite, a.prazo_max], ['prazo', 1500, 21]);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { score: 500, pontualidade: 60 }), { compra_mensal: 1500, hoje }).situacao, 'vista');
  assert.strictEqual(C.propor(Object.assign({}, MBS, { mudanca_em: '2026-03-01' }), { compra_mensal: 1500, hoje }).limite, 1500);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { fundacao: '2026-05-01' }), { compra_mensal: 1500, hoje }).limite, 1500);
});

test('teto no limite da consulta e arredondamento de 500 em 500', () => {
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 20000 }), { compra_mensal: 1800, hoje }).limite, 4000);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 3200 }), { compra_mensal: 1800, hoje }).limite, 3000);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 0 }), { compra_mensal: 1800, hoje }).limite, 4000);
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 400 }), { compra_mensal: 1500, hoje }).situacao, 'vista');
  // a consulta sugere pouco mais que 2 meses de compra: vale a compra (antes, 10% do limite dava R$ 500)
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 5300 }), { maior_mes: 1180, hoje }).limite, 2500);
});

test('sem compra prevista vale o histórico; título vencido com a OneClean: em análise', () => {
  assert.strictEqual(C.propor(Object.assign({}, MBS, { limite_sugerido: 0 }), { maior_mes: 2600, hoje }).limite, 5500);
  assert.strictEqual(C.propor(MBS, { maior_mes: 2600, hoje }).limite, 5500);
  assert.strictEqual(C.propor(MBS, { hoje }).limite, 3000);
  assert.strictEqual(C.propor(MBS, { compra_mensal: 1500, vencido: 300, hoje }).situacao, 'analise');
});

test('o que a equipe vê', () => {
  assert.strictEqual(C.textoEquipe({ ligado: false, situacao: 'prazo' }), '');
  assert.match(C.textoEquipe({ ligado: true, situacao: 'sem_ficha' }), /Sem análise/);
  assert.match(C.textoEquipe({ ligado: true, situacao: 'prazo', disponivel: 1200, prazo_max: 28 }), /1\.200,00 · prazo até 28 dias/);
  assert.ok(C.resumoFatos(MBS).some(l => /Sem restrições/.test(l)));
});

// 28/10/2026: a resposta da API da Rekta (RLT Avançado) vira os mesmos fatos da leitura do PDF. Formato do guia da Rekta,
// dados inventados (repositório público).
test('daRekta: resposta da API nos fatos da consulta', () => {
  const C2 = require('../credito.js');
  const bruto = {
    identificacao: { documento: '11222333000181', razaoSocial: 'EMPRESA FICTICIA LTDA', dataFundacao: '10/03/2015', situacaoCadastral: 'ATIVA' },
    score_classificacao_varios_modelos: [
      { score: '720', probabilidade: '00450', descricaoNatureza: 'POSITIVO PJ', nomeScore: 'P5', texto: 'É provável que 95% das empresas paguem' },
      { score: '8', descricaoNatureza: 'FATURAMENTO PRESUMIDO', texto: 'De R$ 1 milhão a R$ 2 milhões' }
    ],
    titulos_protestados: [{ valor: '155,15', dataOcorrencia: '22/10/2020' }],
    resumo_titulos_protestados: { total: '1', valorAcumulado: '155,15' },
    debitos: [{ valor: '1.318,60' }, { valor: '2.024,90' }],
    resumo_ocorrencias_de_debitos: { totalDevedor: '2', valorAcomulado: '3.343,50' },
    resumo_consultas_anteriores: { totalDeConsultas: '00004' },
    decisao: { aprova: 'N', texto: 'NEGOCIAÇÃO NÃO RECOMENDADA' },
    painel_controle_positivo: { indicadores_positivos_comportamento_pagamento: { nota_pontualidade: { operacoes_parceladas: { item_painel_controle: [
      { descricao: 'Pagos antecipadamente ou em dia', valor: '80' }, { descricao: 'Pagos em até 5 dias após o vencimento', valor: '10' },
      { descricao: 'Pagos entre 6 a 30 dias após o vencimento', valor: '6' }, { descricao: 'Pagos após 31 dias do vencimento', valor: '4' },
      { descricao: 'Sem informação de pagamento após 31 dias do vencimento', valor: '50' }] } } } }
  };
  const k = C2.daRekta(bruto, '11.222.333/0001-81', '2026-10-28');
  assert.equal(k.razao_social, 'EMPRESA FICTICIA LTDA');
  assert.equal(k.documento, '11222333000181');
  assert.equal(k.fundacao, '2015-03-10');
  assert.equal(k.situacao_cadastral, 'ATIVA');
  assert.equal(k.score, 720);
  assert.equal(k.prob_inadimplencia, 4.5);
  assert.deepEqual([k.protestos_qtd, k.protestos_valor, k.pendencias_qtd, k.pendencias_valor], [1, 155.15, 2, 3343.5]);
  assert.equal(k.pontualidade, 90);
  assert.equal(k.consultas_12m, 4);
  assert.equal(k.faturamento_presumido, 'De R$ 1 milhão a R$ 2 milhões');
  assert.ok(k.alertas.some(a => /não recomenda/.test(a)));
  // com restrição, a política manda para "só à vista"
  assert.equal(C2.propor(k, { hoje: '2026-10-28' }).situacao, 'vista');
  // resposta vazia (204: nada consta) não quebra e não inventa
  const v = C2.daRekta({}, '11222333000181', '2026-10-28');
  assert.deepEqual([v.score, v.prob_inadimplencia, v.pontualidade, v.protestos_qtd, v.pendencias_qtd], [0, -1, -1, 0, 0]);
  assert.equal(C2.propor(v, { hoje: '2026-10-28' }).situacao, 'analise');
});

// 28/10/2026: a 1ª resposta real (pessoa jurídica) veio como TEXTO com o JSON dentro e com os nomes abaixo (dados inventados)
test('daRekta: resposta de pessoa jurídica (texto com JSON dentro)', () => {
  const C2 = require('../credito.js');
  const meses = v => ({ lista_indicador_comportamento: { item_indicador: [{ mes_ano: 'Pontuação', pontuacao_mensal: v }, { mes_ano: 'set/2026', pontuacao_mensal: v }] } });
  const pj = {
    'decisao:decisao': { 'decisao:flag': '0005', 'decisao:descricao': 'Negociação Recomendada' },
    limite_credito: { score: '42000', texto: 'Valor de Limite de Crédito Disponível' },
    identificacao_completo: { cnpj: '11222333000181', razao_social: 'ESCOLA FICTICIA LTDA', situacao_cnpj: 'Ativo', data_fundacao: '10/03/2012',
      razao_social_anterior: 'ESCOLA FICTICIA LTDA EPP', data_alteracao_razao_social: '05/02/2019' },
    score: { score_pj: { score: '812', probabilidade: '2', texto: 'De cada 100 empresas classificadas nesta classe de score, é provável que 2 apresentem débitos no mercado nos próximos 12 meses.' } },
    faturamento_presumido: { faturamento_anual: 'De R$ 500.001 até R$ 900.000' },
    consultas: { quantidade_total: '4' },
    protestos: null, acoes_civeis: null, alerta_fraudes: null, cheques_sustados: null, cheques_sem_fundo: null,
    pendencias_restricoes: null, falencias_recuperacao_judicial: null, cheques_devolvidos_informados_usuario: null,
    'pgtpont:pagamento_pontual': { 'pgtpont:pontuacao': '100' },
    pagamento_atrasado: { mais_de_60_dias: meses('-'), periodo_31_a_60_dias: meses('-') }
  };
  const k = C2.daRekta(JSON.stringify(JSON.stringify(pj, null, 2)).slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n'), '11.222.333/0001-81', '2026-10-28');
  assert.equal(k.razao_social, 'ESCOLA FICTICIA LTDA');
  assert.equal(k.situacao_cadastral, 'Ativo');
  assert.equal(k.fundacao, '2012-03-10');
  assert.deepEqual([k.score, k.prob_inadimplencia, k.pontualidade, k.atraso_mais_60, k.limite_sugerido, k.consultas_12m], [812, 2, 100, false, 42000, 4]);
  assert.deepEqual([k.protestos_qtd, k.pendencias_qtd, k.cheques_qtd, k.acoes_qtd, k.falencia, k.fraude], [0, 0, 0, 0, false, false]);
  assert.equal(k.recomendacao, 'Negociação Recomendada');
  assert.equal(k.mudanca_em, '2019-02-05');
  assert.deepEqual(k.alertas, []);
  const p = C2.propor(k, { hoje: '2026-10-28' });
  assert.deepEqual([p.situacao, p.limite, p.prazo_max], ['prazo', 3000, 35]);
  // o texto também pode vir duas vezes embrulhado; e restrição em formato novo conta (melhor parar para conferir)
  assert.equal(C2.daRekta(JSON.stringify(JSON.stringify(pj)), '11222333000181').score, 812);
  const ruim = Object.assign({}, pj, { protestos: { lista: [{ valor: '1.200,00', cartorio: 'X' }, { valor: '300,00', cartorio: 'Y' }] }, pendencias_restricoes: { quantidade_total: '3', valor_total: '4.500,00' },
    'decisao:decisao': { 'decisao:descricao': 'Negociação Não Recomendada' }, pagamento_atrasado: { mais_de_60_dias: meses('12') } });
  const r = C2.daRekta(ruim, '11222333000181', '2026-10-28');
  assert.deepEqual([r.protestos_qtd, r.protestos_valor, r.pendencias_qtd, r.pendencias_valor, r.atraso_mais_60], [2, 1500, 3, 4500, true]);
  assert.ok(r.alertas.some(a => /não recomenda/.test(a)));
  assert.equal(C2.propor(r, { hoje: '2026-10-28' }).situacao, 'vista');
  // formato real das seções com restrição (28/10/2026): o total vem no topo e "ultimas_ocorrencias" traz só as 5 últimas
  const cinco = (tipo, v) => ({ [tipo]: [1, 2, 3, 4, 5].map(i => ({ valor: v, data: '0' + i + '/07/2026' })) });
  const real = Object.assign({}, pj, {
    protestos: { valor: null, quantidade: null, valor_maior: '900.00', valor_primeiro: '120.00', valor_total: '15320.50', total_protestos: '37', ultimas_ocorrencias: cinco('protesto', '100.00') },
    pendencias_restricoes: { valor: '2840.10', quantidade: null, valor_maior: '1500.00', total_credores: '3', total_pendencias: '9', ultimas_ocorrencias: cinco('pendencia_restricao', '50.00') },
    acoes_civeis: { mensagem: null, total_acoes: '12', valor_maior: '7000.00', valor_total: '21000.00', ultimas_ocorrencias: cinco('acao_civel', '0.00') },
    falencias_recuperacao_judicial: { valor: null, quantidade: null, quantidade_total: '2', ultimas_ocorrencias: { falencia_recuperacao_judicial: [{}, {}] } }
  });
  const q = C2.daRekta(real, '11222333000181', '2026-10-28');
  assert.deepEqual([q.protestos_qtd, q.protestos_valor, q.pendencias_qtd, q.pendencias_valor, q.acoes_qtd, q.falencia], [37, 15320.5, 9, 2840.1, 12, true]);
  const pouco = C2.daRekta(Object.assign({}, pj, { protestos: { valor: null, valor_maior: '300.00', valor_primeiro: '300.00', valor_total: '512.40', total_protestos: '2',
    ultimas_ocorrencias: { protesto: [{ valor: '300.00' }, { valor: '212.40' }] } } }), '11222333000181', '2026-10-28');
  assert.deepEqual([pouco.protestos_qtd, pouco.protestos_valor], [2, 512.4]);
  // sem total no topo: conta os itens e soma só o valor de cada um
  const semTotal = C2.daRekta(Object.assign({}, pj, { protestos: { valor_maior: '300.00', ultimas_ocorrencias: { protesto: [{ valor: '300.00' }, { valor: '212.40' }] } } }), '11222333000181');
  assert.deepEqual([semTotal.protestos_qtd, semTotal.protestos_valor], [2, 512.4]);
});

// 10/11/2026 (Anderson: "não veio a ficha da restrição… tem que consultar de novo, gastar de novo?"): a consulta guardada vira
// relatório e parecer, sem nova consulta. Resposta FICTÍCIA no formato real de pessoa jurídica com restrição.
const PJ_RESTRICAO = {
  score: { score_pj: { score: '689', probabilidade: '8', classificacao_alfabetica: 'B', texto: 'De cada 100 empresas classificadas nesta classe de score, é provável que 8 apresentem débitos no mercado nos próximos 12 meses.' } },
  identificacao_completo: { cnpj: '11222333000181', razao_social: 'INDUSTRIA FICTICIA DE PLASTICOS LTDA', situacao_cnpj: 'Ativo', data_fundacao: '18/02/1977', capital_atual: '20000.0',
    natureza_juridica: 'SOCIEDADE EMPRESARIA LIMITADA', situacao_sintegra: 'HABILITADO', quantidade_filiais: '1', razao_social_anterior: 'FICTICIA PLASTICOS LTDA', data_alteracao_razao_social: '16/12/2022',
    ramo_atividade_primario: { cnae: '2229-3/03', atividade: 'FAB ARTEF MATL PLAST' } },
  localizacao_completo: { matriz: { endereco_matriz: 'RUA DE EXEMPLO, 100', bairro_matriz: 'CENTRO', cidade_matriz: 'CIDADE EXEMPLO', uf_matriz: 'SP', telefone_matriz: { telefone: ['(11) 4000-0000', '(11) 4000-0001'] } } },
  'decisao:decisao': { 'decisao:flag': '0004', 'decisao:descricao': 'Recomendação de análise cautelosa' },
  limite_credito: { score: '397500', texto: 'Valor de Limite de Crédito Disponível' },
  faturamento_presumido: { faturamento_anual: 'Acima de R$ 9.100.000' },
  protestos: { valor: null, quantidade: null, data_maior: '20/01/2025', valor_maior: '1461274.81', valor_total: '22788370.51', data_primeiro: '21/12/2021', total_protestos: '240',
    ultimas_ocorrencias: { protesto: [{ data: '13/10/2026', valor: '32212.0', cidade: 'CIDADE EXEMPLO', estado: 'SP', cartorio: '1', vencimento: '30/09/2026' },
      { data: '25/09/2026', valor: '33874.39', cidade: 'CIDADE EXEMPLO', estado: 'SP', cartorio: '2', vencimento: '31/07/2026' }, { data: '02/03/2026', valor: '1000.00', cidade: 'CIDADE EXEMPLO', estado: 'SP', cartorio: '2', vencimento: '31/01/2026' }] } },
  acoes_civeis: { total_acoes: '30', valor_maior: '2226676.85', valor_total: '5237393.42', data_primeiro: '24/03/2022',
    ultimas_ocorrencias: { acao_civel: [{ uf: 'SP', acao: 'ACAO EXECUTIVA FEDERAL', foro: 'CIDADE EXEMPLO', autor: 'UNIAO FEDERAL FAZENDA NACIONAL', valor: '53229.85', distribuicao: '14/09/2026' },
      { uf: 'SP', acao: 'ACAO DE COBRANCA', foro: 'CIDADE EXEMPLO', autor: 'FORNECEDOR FICTICIO SA', valor: '63889.9', distribuicao: '28/04/2026' }] } },
  pendencias_restricoes: null, alerta_fraudes: null, cheques_sem_fundo: null, cheques_sustados: null, falencias_recuperacao_judicial: null, cheques_devolvidos_informados_usuario: null,
  'pgtpont:pagamento_pontual': { 'pgtpont:pontuacao': '100', lista_indicador_comportamento: { item_indicador: [{ mes_ano: 'set/2026', pontuacao_mensal: '100' }, { mes_ano: 'out/2026', pontuacao_mensal: '-' }] } },
  pagamento_atrasado: { mais_de_60_dias: { lista_indicador_comportamento: { item_indicador: [{ mes_ano: 'Pontuação', pontuacao_mensal: '-' }, { mes_ano: 'out/2026', pontuacao_mensal: '-' }] } } },
  consultas: { quantidade_total: '17', consultas_mes: [{ mes_ano: '112026', quantidade: '2' }, { mes_ano: '102026', quantidade: '0' }], ultimas_consultas: { consulta: [{ data: '10/11/2026', razao_social: 'CONSULTORA FICTICIA LTDA' }] } },
  socios: [{ cpf_cnpj: '00012345678901', tipo_documento: '1', nome_empresa: 'MARIA EXEMPLO DA SILVA', participacao: '100,00', data_entrada: '04/09/2008', indicador_debito: 'Sim', indicador_fraude: 'Não',
    restricoes_documento: { protestos: { valor: '46264.87', ultima: '18/08/2025', quantidade: '22' }, acoes_judiciais: { valor: '99159.7', ultima: '14/09/2026', quantidade: '2' }, cheques_sem_fundo: { valor: '0.0', quantidade: '0' } } }],
  administradores: { administrador: [{ cpf: '00098765432100', nome: 'JOAO EXEMPLO', cargo: 'ADMINISTRADOR', entrada: '19/06/2026', indicador_debito: 'Não', indicador_fraude: 'Não', restricoes_documento: null }] },
  participacoes_socios_adm_outras_empresas: { socio: [
    { cpf: '00012345678901', nome_socio: 'MARIA EXEMPLO DA SILVA', socios_participantes: [{ cnpj: '44555666000199', razao_social: 'COMERCIAL FICTICIA LTDA', participacao: '100,00', situacao_cnpj: 'Ativo', indicador_debito: 'Sim',
      restricoes_documento: { protestos: { valor: '9035533.04', ultima: '12/06/2026', quantidade: '147' } } }] },
    { cpf: '00098765432100', nome_socio: 'JOAO EXEMPLO', socios_participantes: [{ cnpj: '44555666000199', razao_social: 'COMERCIAL FICTICIA LTDA', participacao: '000,00', situacao_cnpj: 'Ativo', indicador_debito: 'Sim', restricoes_documento: null },
      { cnpj: '77888999000155', razao_social: 'OUTRA FICTICIA LTDA', participacao: '050,00', situacao_cnpj: 'Ativo', indicador_debito: 'Não', restricoes_documento: null }] }] }
};

test('relatorio: a consulta guardada vira as seções do relatório', () => {
  const r = C.relatorio(JSON.stringify(PJ_RESTRICAO));
  assert.equal(r.empresa.razao, 'INDUSTRIA FICTICIA DE PLASTICOS LTDA');
  assert.equal(r.empresa.cnpj, '11.222.333/0001-81');
  assert.equal(r.empresa.fundacao, '1977-02-18');
  assert.deepEqual(r.empresa.telefones, ['(11) 4000-0000', '(11) 4000-0001']);
  assert.deepEqual([r.score.valor, r.score.classe, r.decisao, r.limite_sugerido, r.faturamento], [689, 'B', 'Recomendação de análise cautelosa', 397500, 'Acima de R$ 9.100.000']);
  assert.deepEqual([r.protestos.qtd, r.protestos.valor, r.protestos.maior, r.protestos.maior_em, r.protestos.ultimas.length], [240, 22788370.51, 1461274.81, '2025-01-20', 3]);
  assert.deepEqual(r.protestos.ultimas[0], { data: '2026-10-13', valor: 32212, vencimento: '2026-09-30', cartorio: '1', cidade: 'CIDADE EXEMPLO', uf: 'SP' });
  assert.deepEqual([r.acoes.qtd, r.acoes.valor, r.acoes.ultimas[0].autor, r.acoes.ultimas[0].data], [30, 5237393.42, 'UNIAO FEDERAL FAZENDA NACIONAL', '2026-09-14']);
  assert.deepEqual([r.pendencias.qtd, r.cheques.qtd, r.falencia.qtd, r.fraude.qtd], [0, 0, 0, 0]);
  assert.equal(r.pontualidade.pct, 100);
  assert.deepEqual(r.atrasos, []);
  assert.deepEqual([r.consultas.total, r.consultas.ultimas[0].quem, r.consultas.meses[0].mes], [17, 'CONSULTORA FICTICIA LTDA', '11/2026']);
  // CPF de sócio nunca sai inteiro (o relatório vira PDF)
  assert.equal(r.socios[0].doc, '***.456.789-**');
  assert.deepEqual(r.socios[0].restricoes.map(x => [x.rotulo, x.qtd, x.valor, x.ultima]), [['protesto(s)', 22, 46264.87, '2025-08-18'], ['ação(ões) judicial(is)', 2, 99159.7, '2026-09-14']]);
  assert.equal(r.administradores[0].cargo, 'ADMINISTRADOR');
  // a mesma empresa aparece uma vez só, com os dois sócios
  assert.deepEqual(r.outras.map(o => [o.razao, o.cnpj, o.socios.length, o.restricoes.length]), [['COMERCIAL FICTICIA LTDA', '44.555.666/0001-99', 2, 1], ['OUTRA FICTICIA LTDA', '77.888.999/0001-55', 1, 0]]);
  // consulta que não é de pessoa jurídica (ou vazia) não tem relatório: a tela mostra só os fatos
  assert.equal(C.relatorio({}), null);
  assert.equal(C.relatorio(null), null);
  assert.equal(C.relatorio('texto solto'), null);
});

test('parecer: o que pesa contra e a favor, o risco e os caminhos (não decide)', () => {
  const k = C.daRekta(PJ_RESTRICAO, '11222333000181', '2026-11-10'), rel = C.relatorio(PJ_RESTRICAO);
  const p = C.parecer(k, rel, { hoje: '2026-11-10', pedido_valor: 1184.84, pedido_prazo: 28 });
  assert.equal(p.risco, 'alto');
  assert.match(p.jogo, /1\.184,84 em 28 dias/);
  assert.ok(p.contra.some(x => /^240 protesto\(s\) somando R\$ 22,8 milhões; o mais recente em 13\/10\/2026 \(há 28 dia\(s\)\)/.test(x)), p.contra.join(' | '));
  assert.ok(p.contra.some(x => /2 dos 3 últimos protestos são dos últimos 90 dias/.test(x)));
  assert.ok(p.contra.some(x => /30 ação\(ões\) judicial\(is\) somando R\$ 5,2 milhões; 1 das 2 últimas são cobrança de imposto/.test(x)));
  assert.ok(p.contra.some(x => /sócio\(a\) MARIA EXEMPLO DA SILVA: 22 protesto\(s\)/.test(x)));
  assert.ok(p.contra.some(x => /outra empresa dos sócios \(COMERCIAL FICTICIA LTDA\): 147 protesto\(s\) \(R\$ 9 milhões\)/.test(x)));
  assert.ok(p.contra.some(x => /17 consultas ao CNPJ/.test(x)));
  assert.ok(p.contra.some(x => /a Rekta diz: "Recomendação de análise cautelosa"/.test(x)));
  assert.ok(p.favor.some(x => /empresa com 49 anos/.test(x)));
  assert.ok(p.favor.some(x => /score 689/.test(x)));
  assert.ok(p.favor.some(x => /paga 100% em dia/.test(x)));
  assert.ok(p.favor.some(x => /menos de 1% do limite que a consulta sugere/.test(x)));
  assert.ok(p.favor.some(x => /sem pendência financeira/.test(x)));
  assert.match(p.caminhos[0], /só à vista/);
  // empresa boa, sem nada contra: risco baixo
  // o alerta que a consulta trouxe (factoring) entra no "contra": risco médio
  const bom = C.parecer(MBS, null, { hoje });
  assert.deepEqual([bom.risco, bom.contra], ['medio', ['consulta de factoring no último ano']]);
  assert.equal(C.parecer(Object.assign({}, MBS, { alertas: [] }), null, { hoje }).risco, 'baixo');
  // título vencido com a empresa pesa mais que tudo; protesto antigo (mais de 1 ano) é risco médio
  assert.equal(C.parecer(MBS, null, { hoje, vencido: 500 }).risco, 'alto');
  const antigo = Object.assign({}, PJ_RESTRICAO, { acoes_civeis: null, socios: [], participacoes_socios_adm_outras_empresas: null,
    protestos: { valor_total: '900.00', total_protestos: '1', ultimas_ocorrencias: { protesto: [{ data: '10/03/2024', valor: '900.00' }] } } });
  assert.equal(C.parecer(C.daRekta(antigo, '11222333000181', '2026-11-10'), C.relatorio(antigo), { hoje: '2026-11-10' }).risco, 'medio');
});
