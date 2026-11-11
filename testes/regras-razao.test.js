'use strict';
// Razão social na NF-e (04/11/2026): no máximo 60 letras. abreviaRazao (regras.js) e crm_abrevia_razao (banco, gerada por
// ferramentas/gera-abrevia-razao.js) têm de dar o MESMO resultado: os pares abaixo saíram do banco (crm_abrevia_razao)
// com nomes FICTÍCIOS no formato dos cadastros reais (o repositório é público: nada de cliente de verdade aqui).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const R = require('../regras.js');

const PARES = [
  ['IRMANDADE DA SANTA CASA DE MISERICORDIA DE VILA EXEMPLO DO CAMPO', 'IRMANDADE DA SANTA CASA DE MISERIC DE VILA EXEMPLO DO CAMPO'],
  ['CONGREGACAO FICTICIA MISSIONARIA DE ASSISTENCIA E EDUCACAO TESTE', 'CONGREGACAO FICTICIA MISSIONARIA DE ASSISTENCIA E EDUC TESTE'],
  ['ALFA BETA GAMA TECNOLOGIA EM TRATAMENTO TERMICO E REVESTIMENTOS SUPERFICIAIS LTDA', 'ALFA BETA GAMA TECNOLOGIA EM TRAT TERM E REVEST SUPERF LTDA'],
  ['X.Y.Z. PRESTACAO DE SERVICOS DE MEDICINA E SEGURANCA DO TRABALHO LIMITADA', 'X.Y.Z. PRESTACAO DE SERVICOS DE MEDICINA E SEG DO TRAB LTDA'],
  ['-  | IMPORTACAO E EXPORTACAO DE PRODUTOS HOSPITALARES LTDA 11', '- | IMPORTACAO E EXPORTACAO DE PRODUTOS HOSPITALARES LTDA 11'],
  ['- ABCD - Associação Exemplolândia de Assistência Social | Fulana', '- ABCD - Associação Exemplolândia de ASSIST Social | Fulana'],
  ['- APXX - Associação dos Exemplares do Estado de São Paulo | Cristiane', '- APXX - ASSOC dos Exemplares do Estado de São Paulo |'],
  ['- Corrimãos XPTO - Fábrica - São Paulo, Interior, ABC e Litoral | Beltrano', '- Corrimãos XPTO - Fábrica - São Paulo, Interior, ABC'],
  ['- ESCX - ESCOLA TÉCNICA PROFISSIONALIZANTE - UNIDADE EXEMPLO | Prezados', '- ESCX - ESCOLA TÉCNICA PROFISS - UNIDADE EXEMPLO | Prezados'],
  ['- PLAST.XX - Mix São Paulo Indústria e Comércio Ltda | Ciclana', '- PLAST.XX - Mix São Paulo Indústria e COM Ltda | Ciclana'],
  ['- PEDRA FICTA PEDREIRAS, PAVIMENTAÇÕES E CONSTRUÇÕES LTDA. | Rafael', '- PEDRA FICTA PEDREIRAS, PAVIMENTAÇÕES E CONSTR LTDA. |'],
  ['Faculdade Exemplo São Paulo - Campus Fulano Tal(SEDE) e Escola Exemplo Beltrano| Marcelo', 'Faculdade Exemplo São Paulo - Campus Fulano Tal(SEDE)'],
  ['Serviço Promocional Nossa Senhora da Exemplo - CJ Santo Antônio', 'Serviço PROM Nossa Senhora da Exemplo - CJ Santo Antônio'],
  ['CONDOMINIO CONJUNTO HABITACIONAL VILA EXEMPLO B-10 BLOCOS E,F,G,H', 'CONDOMINIO CONJUNTO HAB VILA EXEMPLO B-10 BLOCOS E,F,G,H'],
  ['XYZ SANTA MARIA EDUCACAO INFANTIL, ENSINO FUNDAMENTAL E MEDIO LTDA', 'XYZ SANTA MARIA EDUCACAO INFANTIL, ENSINO FUND E MEDIO LTDA'],
  ['- WXYZ CONSTRUÇÃO E CONSERVAÇÃO EIRELI | Fulana Beltrana dos Santos de Souza', '- WXYZ CONSTR E CONSERV EIRELI | Fulana Beltrana dos Santos']
];

test('abreviaRazao: igual ao banco (crm_abrevia_razao), sempre até 60 letras', () => {
  for (const [o, a] of PARES) {
    const r = R.abreviaRazao(o);
    assert.strictEqual(r, a, o);
    assert.ok(r.length <= 60, o);
  }
  assert.strictEqual(R.abreviaRazao('EMPRESA CURTA LTDA'), 'EMPRESA CURTA LTDA');
  assert.strictEqual(R.abreviaRazao('  ESPACO   DUPLO  '), 'ESPACO DUPLO');
  assert.strictEqual(R.abreviaRazao(null), '');
});

test('Receita: a razão social vem abreviada para o cadastro e a completa em razao_receita', () => {
  const x = R.empresaDoCnpj({ cnpj: '11222333000181', razao_social: PARES[0][0], municipio: 'SAO BERNARDO DO CAMPO', uf: 'SP' });
  assert.strictEqual(x.razao_social, PARES[0][1]);
  assert.strictEqual(x.razao_receita, PARES[0][0]);
});

test('a função do banco é gerada da mesma tabela (ferramentas/gera-abrevia-razao.js)', () => {
  const sql = execFileSync(process.execPath, [path.join(__dirname, '..', 'ferramentas', 'gera-abrevia-razao.js')]).toString();
  assert.match(sql, /create or replace function public\.crm_abrevia_razao/);
  for (const [k, v] of Object.entries(R.ABREV_RAZAO)) assert.ok(sql.includes('"' + k + '":"' + v + '"'), k);
  // o schema.sql tem de trazer exatamente a função gerada (senão o banco e a tela abreviam diferente)
  const lf = s => s.replace(/\r\n/g, '\n'); // o fim de linha do Windows (core.autocrlf) não conta
  const schema = lf(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8'));
  assert.ok(schema.includes(lf(sql).trim()), 'schema.sql com crm_abrevia_razao desatualizada: rode node ferramentas/gera-abrevia-razao.js e copie para lá');
});
