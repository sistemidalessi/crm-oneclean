// Cobrança (14/10/2026): linha digitável, boleto lido pela IA × título em atraso, mensagem do(a) vendedor(a).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../cobranca.js');

// código de barras de teste montado à mão (banco 001, moeda 9, vence 20/10/2026, R$ 950,12)
function codigoTeste(venc, valor, livre) {
  const fator = String(1000 + Math.round((Date.parse(venc + 'T00:00:00Z') - Date.UTC(2025, 1, 22)) / 864e5)).padStart(4, '0');
  const sem = '0019' + fator + String(Math.round(valor * 100)).padStart(10, '0') + livre;
  let soma = 0, peso = 2;
  for (let i = sem.length - 1; i >= 0; i--) { soma += Number(sem[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  let dv = 11 - (soma % 11); if (dv === 0 || dv === 10 || dv === 11) dv = 1;
  return sem.slice(0, 4) + dv + sem.slice(4);
}

test('linha digitável: confere os dígitos e tira valor e vencimento', () => {
  const linha = C.linhaDeCodigo(codigoTeste('2026-10-20', 950.12, '0000002956789001234567817'));
  assert.equal(linha.length, 47);
  const l = C.lerLinha(linha);
  assert.equal(l.ok, true);
  assert.equal(l.valor, 950.12);
  assert.equal(l.vencimento, '2026-10-20');
  assert.equal(C.lerLinha(C.formataLinha(linha)).ok, true, 'com pontos e espaços também');
  const trocado = linha.slice(0, 12) + ((+linha[12] + 1) % 10) + linha.slice(13);
  assert.equal(C.lerLinha(trocado).ok, false, 'um dígito lido errado não passa');
  const geral = linha.slice(0, 40) + ((+linha[40] + 1) % 10) + linha.slice(41);
  assert.match(C.lerLinha(geral).motivo, /dígito geral/);
  assert.match(C.lerLinha('123').motivo, /47/);
  assert.equal(C.dataDoFator('1000'), '2025-02-22');
});

test('boleto lido (2ª via do BB): vencimento e original da linha, valor cobrado do PDF; vencido não é erro', () => {
  const linha = C.linhaDeCodigo(codigoTeste('2026-10-07', 3099.36, '0000002956789001234567817'));
  // a 2ª via do BB: linha com o valor e o vencimento originais; "(=) Valor cobrado" com juros e multa
  const bb = C.confereBoleto({ linha_digitavel: linha, valor_documento: 3099.36, valor_cobrado: 3268.76, vencimento: '2026-10-07' }, '2026-10-14');
  assert.deepEqual([bb.valor, bb.valorOriginal, bb.juros, bb.vencimento, bb.vencido, bb.linhaOk], [3268.76, 3099.36, 169.4, '2026-10-07', true, true]);
  assert.deepEqual(bb.avisos, []);
  // sem o valor cobrado: vale o da linha; vencido sem juros só avisa
  const sem = C.confereBoleto({ linha_digitavel: linha, valor_documento: 3099.36, valor_cobrado: 0, vencimento: '2026-10-07' }, '2026-10-14');
  assert.equal(sem.valor, 3099.36); assert.match(sem.avisos[0], /banco calcula os encargos/);
  // vencimento lido diferente: vale o da linha; linha ruim: vai sem ela
  assert.match(C.confereBoleto({ linha_digitavel: linha, valor_cobrado: 3268.76, vencimento: '2026-10-08' }, '2026-10-14').avisos[0], /vale o da linha/);
  const ruim = C.confereBoleto({ linha_digitavel: linha.slice(1), valor_cobrado: 950.12, vencimento: '2026-10-20' }, '2026-10-14');
  assert.equal(ruim.linha, ''); assert.equal(ruim.valor, 950.12); assert.match(ruim.avisos[0], /sem a linha/);
});

test('boleto acha o título: CNPJ e valor, nota, único do CNPJ; cartório e já usado ficam de fora', () => {
  const empresas = [{ id: 'e1', cnpj: '11.222.333/0001-81' }, { id: 'e2', cnpj: '44.555.666/0001-99' }];
  const tits = [
    { duplicata: '002205/01', nota_numero: 2205, empresa_id: 'e1', valor: 917.88, vencimento: '2026-09-24' },
    { duplicata: '002205/02', nota_numero: 2205, empresa_id: 'e1', valor: 917.88, vencimento: '2026-10-08' },
    { duplicata: '002300/01', nota_numero: 2300, empresa_id: 'e1', valor: 500, vencimento: '2026-10-01' },
    { duplicata: '002400/01', nota_numero: 2400, empresa_id: 'e2', valor: 300, vencimento: '2026-10-01', cartorio_em: '2026-10-10' }
  ];
  assert.equal(C.casaBoleto({ documento: '11222333000181', valor_documento: 500 }, tits, empresas).titulo.duplicata, '002300/01');
  // duas parcelas iguais: sem mais nada, não escolhe sozinho
  const dois = C.casaBoleto({ documento: '11222333000181', valor_documento: 917.88 }, tits, empresas);
  assert.equal(dois.titulo, null); assert.equal(dois.candidatos.length, 3);
  // desempate (16/10/2026): o vencimento original do boleto ou a parcela no "Nº do documento"
  assert.equal(C.casaBoleto({ documento: '11222333000181', valor_documento: 917.88, vencimento: '2026-10-08' }, tits, empresas).titulo.duplicata, '002205/02');
  assert.equal(C.casaBoleto({ documento: '11222333000181', valor_documento: 917.88, numero_documento: '002205/01' }, tits, empresas).titulo.duplicata, '002205/01');
  assert.equal(C.casaBoleto({ documento: '11222333000181', valor_documento: 917.88, numero_documento: '2205-2' }, tits, empresas).titulo.duplicata, '002205/02');
  // a primeira já foi casada neste lote: a outra parcela é a que sobra
  assert.equal(C.casaBoleto({ documento: '11222333000181', valor_documento: 917.88 }, tits, empresas, new Set(['002205/01'])).titulo.duplicata, '002205/02');
  // título em cartório não recebe boleto
  assert.equal(C.casaBoleto({ documento: '44555666000199', valor_documento: 300 }, tits, empresas).titulo, null);
  // sem CNPJ: nota no "Nº do documento" + valor original
  assert.equal(C.casaBoleto({ numero_documento: '0002300', valor_documento: 500 }, tits, empresas).titulo.duplicata, '002300/01');
});

test('pendentes do(a) vendedor(a) e a mensagem pronta', () => {
  const atrasos = [{ duplicata: '002300/01', nota_numero: 2300, vencimento: '2026-10-01', valor: 500 }, { duplicata: '002400/01', vencimento: '2026-10-01', valor: 300, cartorio_em: '2026-10-10' }];
  const boletos = [
    { id: 'b0', duplicata: '002300/01', nota_numero: 2300, valor: 505, vencimento: '2026-10-15', criado_em: '2026-10-10T10:00:00Z' },
    { id: 'b1', duplicata: '002300/01', nota_numero: 2300, valor: 510.4, vencimento: '2026-10-20', linha_digitavel: '0'.repeat(47), criado_em: '2026-10-14T10:00:00Z' },
    { id: 'b2', duplicata: '002400/01', valor: 310, vencimento: '2026-10-20', criado_em: '2026-10-14T10:00:00Z' },
    { id: 'b3', duplicata: '009999/01', valor: 10, vencimento: '2026-10-20', criado_em: '2026-10-14T10:00:00Z' }
  ];
  const p = C.boletosPendentes(boletos, atrasos);
  assert.deepEqual(p.map(b => b.id), ['b1'], 'o mais novo; cartório e título já pago ficam de fora');
  const msg = C.mensagemBoleto(null, p, { saudacao: 'Olá, Maria!', vendedor_primeiro_nome: 'Ana', minha_empresa: 'Empresa Teste' });
  assert.match(msg, /^Olá, Maria! .*Ana, da Empresa Teste/);
  assert.match(msg, /a NF 2300 \(vencida em 01\/10\)/);
  assert.match(msg, /NF 2300: R\$\s?510,40, vence em 20\/10\/2026\n {2}Linha digitável: 00000\.00000/);
  // 2ª via de boleto vencido: valor atualizado, o original e o aviso dos encargos
  const venc = C.mensagemBoleto(null, [{ duplicata: '002286/01', nota_numero: 2286, valor: 3268.76, valor_original: 3099.36, vencimento: '2026-10-07', criado_em: '2026-10-14T13:00:00Z', titulo: { vencimento: '2026-10-07' } }], { saudacao: 'Olá!', vendedor_primeiro_nome: 'Ana', minha_empresa: 'Empresa Teste' });
  assert.match(venc, /a NF 2286 \(vencida em 07\/10\)/);
  assert.match(venc, /NF 2286: R\$\s?3\.268,76 \(atualizado com juros e multa; valor original R\$\s?3\.099,36\)/);
  assert.match(venc, /banco calcula os encargos até o dia do pagamento/);
  assert.doesNotMatch(venc, /copiar a linha digitável/, 'sem linha: só o PDF');
  assert.equal(C.boletosPendentes([Object.assign({}, boletos[1], { cobrado_em: 'x' })], atrasos).length, 0);
});

test('mensagemBoleto com o link do PDF (20/10/2026: o WhatsApp da vendedora só leva texto)', () => {
  const b = { id: '11111111-2222-4333-8444-555555555555', arquivo: 'boletos/x.pdf', duplicata: '002430/01', nota_numero: 2430, valor: 449.38, valor_original: 427.72, vencimento: '2026-10-19', linha_digitavel: '00190000090380488010600001401173616040000042772', criado_em: '2026-10-20T12:00:00Z' };
  const links = C.linksPdf([b, Object.assign({}, b, { id: 'outro', duplicata: '002430/02' })], 'https://abc.supabase.co/');
  assert.deepEqual(links, ['https://abc.supabase.co/functions/v1/crm-pdf?b=11111111-2222-4333-8444-555555555555']); // mesmo PDF: um link só
  const vars = { saudacao: 'Olá, Maria!', vendedor_primeiro_nome: 'Ana', minha_empresa: 'Empresa Teste' };
  const m = C.mensagemBoleto(null, [b], vars, links);
  assert.ok(m.indexOf('O PDF com o boleto e a cópia da nota fiscal: ' + links[0]) !== -1);
  assert.ok(m.indexOf('Também te mando o PDF aqui.') === -1);
  const proprio = C.mensagemBoleto('{saudacao} Segue o boleto: {boletos}', [b], vars, links);
  assert.ok(proprio.endsWith('\n\nO PDF com o boleto e a cópia da nota fiscal: ' + links[0]));
  assert.equal(C.mensagemBoleto(null, [b], vars), C.mensagemBoleto(null, [b], vars, [])); // sem link: como antes
  assert.deepEqual(C.linksPdf([b], ''), []);
});

test('números do cliente para o boleto pela empresa: celular primeiro, principal antes, sem repetir', () => {
  const l = C.telefonesCliente({ telefone: '(11) 4123-4567', whatsapp: '' }, [
    { id: 'a', nome: 'Compras', telefone: '1141234567' },
    { id: 'b', nome: 'Maria', celular: '11 98765-4321', principal: true },
    { id: 'c', nome: 'José', whatsapp: '5511912345678', celular: '11987654321' }]);
  assert.deepStrictEqual(l.map(x => [x.tel, x.rotulo, x.celular]), [
    ['5511987654321', 'Maria', true], ['5511912345678', 'José', true], ['551141234567', 'Compras', false]]);
  assert.deepStrictEqual(C.telefonesCliente(null, []), []);
});
