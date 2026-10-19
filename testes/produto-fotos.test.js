'use strict';
// Fotos e fichas técnicas dos produtos (19/10/2026): partes puras da crm-produto-buscar (ler a página do produto,
// medir a imagem, conferir o endereço, ler a resposta da IA).
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../supabase/functions/crm-produto-buscar/pagina.js');

test('urlSegura: só http(s) de site público', () => {
  assert.equal(P.urlSegura('https://www.ype.ind.br/produto/x'), 'https://www.ype.ind.br/produto/x');
  assert.equal(P.urlSegura('/img/a.jpg', 'https://loja.com.br/p/1'), 'https://loja.com.br/img/a.jpg');
  ['http://localhost/a', 'http://127.0.0.1/a', 'http://10.0.0.5/x', 'http://192.168.1.1/', 'http://169.254.169.254/latest', 'file:///etc/passwd',
    'https://user:senha@site.com/', 'http://servidor/x', 'https://site.com:8443/', 'http://[::1]/', 'javascript:alert(1)', 'http://meu.local/x']
    .forEach(u => assert.equal(P.urlSegura(u), null, u));
  assert.equal(P.urlSegura('https://8.8.8.8/x'), 'https://8.8.8.8/x');
});

test('imagensDaPagina: og:image, JSON-LD do produto e a foto principal da loja', () => {
  const html = '<html><head><meta property="og:image" content="https://fab.com.br/fotos/desinf-5l.jpg">' +
    '<meta name="twitter:image" content="https://fab.com.br/fotos/desinf-5l.jpg"><meta property="og:image" content="/logo.png">' +
    '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","logo":"https://fab.com.br/l.png"},' +
    '{"@type":"Product","name":"Desinfetante","image":["https://fab.com.br/fotos/desinf-5l-2.webp",{"url":"/fotos/3.jpg"}]}]}</script></head>' +
    '<body><img class="wp-post-image" src="https://fab.com.br/w/p.jpg" data-large_image="https://fab.com.br/w/p-grande.jpg"><img src="/icone.svg"></body></html>';
  assert.deepEqual(P.imagensDaPagina(html, 'https://fab.com.br/produto/desinfetante', 6), [
    'https://fab.com.br/fotos/desinf-5l.jpg', 'https://fab.com.br/fotos/desinf-5l-2.webp', 'https://fab.com.br/fotos/3.jpg', 'https://fab.com.br/w/p-grande.jpg']);
});

test('pdfsDaPagina: ficha técnica e FISPQ pelo texto do link ou pelo nome do arquivo', () => {
  const html = '<a href="/docs/FT-desinfetante.pdf">Ficha Técnica</a> <a href="https://fab.com.br/fispq/desinf.pdf"><span>FISPQ</span></a>' +
    ' <a href="/x/boleto.pdf">Catálogo 2026</a> <a href="/y/manual.pdf">Baixar</a> <a href="/z.html">página</a>';
  const l = P.pdfsDaPagina(html, 'https://fab.com.br/produto/1');
  assert.deepEqual(l.map(x => [x.url, x.tipo]), [['https://fab.com.br/docs/FT-desinfetante.pdf', 'ficha'], ['https://fab.com.br/fispq/desinf.pdf', 'fispq'],
    ['https://fab.com.br/x/boleto.pdf', 'ficha'], ['https://fab.com.br/y/manual.pdf', null]]);
  assert.equal(P.tipoDoPdf('Ficha de Informações de Segurança'), 'fispq');
  assert.equal(P.tipoDoPdf('FDS - detergente'), 'fispq');
});

test('medeImagem: PNG, JPEG e WebP pelos bytes', () => {
  const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); png.set([0, 0, 3, 32], 16); png.set([0, 0, 2, 88], 20);
  assert.deepEqual(P.medeImagem(png), { tipo: 'image/png', ext: 'png', largura: 800, altura: 600 });
  // JPEG: SOI, APP0 (tamanho 16), SOF0 com altura 480 e largura 640
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 1, 224, 2, 128, 3, 0, 0, 0, 0]);
  assert.deepEqual(P.medeImagem(jpg), { tipo: 'image/jpeg', ext: 'jpg', largura: 640, altura: 480 });
  const webp = new Uint8Array(40); webp.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88]); webp.set([0x1f, 0x03, 0, 0x57, 0x02, 0], 24);
  assert.deepEqual(P.medeImagem(webp), { tipo: 'image/webp', ext: 'webp', largura: 800, altura: 600 });
  assert.equal(P.medeImagem(new TextEncoder().encode('<html>')), null);
  assert.equal(P.ehPdf(new TextEncoder().encode('%PDF-1.7')), true);
  assert.equal(P.ehPdf(new TextEncoder().encode('<html>')), false);
});

test('jsonDaResposta e limpaInfo: a resposta da IA vira a sugestão, sem endereço perigoso nem texto enorme', () => {
  const t = 'Achei.\n```json\n{"achou": true, "marca": "Ypê", "descricao": "Detergente  neutro\\n para louças.", "especificacoes": [{"nome": "Conteúdo", "valor": "500 ml"}, {"nome": "", "valor": "x"}],' +
    '"paginas": [{"url": "https://www.ype.ind.br/detergente", "site": "Ypê", "tipo": "fabricante", "ean_bate": true, "mesmo_produto": "sim", "imagem": "/img/d.png"}, {"url": "http://127.0.0.1/x"}],' +
    '"ficha_tecnica": "https://www.ype.ind.br/ft.pdf", "fispq": "javascript:x", "fonte": "https://www.ype.ind.br/detergente", "observacao": ""}\n```';
  const o = P.limpaInfo(P.jsonDaResposta(t));
  assert.equal(o.marca, 'Ypê');
  assert.equal(o.descricao, 'Detergente neutro para louças.');
  assert.deepEqual(o.especificacoes, [{ nome: 'Conteúdo', valor: '500 ml' }]);
  assert.equal(o.paginas.length, 1);
  assert.equal(o.paginas[0].imagem, 'https://www.ype.ind.br/img/d.png');
  assert.equal(o.ficha, 'https://www.ype.ind.br/ft.pdf');
  assert.equal(o.fispq, null);
  assert.deepEqual(P.jsonDaResposta('sem json'), null);
  assert.equal(P.jsonDaResposta('{"achou": false} fim').achou, false);
});

test('ordenaCandidatos: código de barras e fabricante primeiro, depois a maior', () => {
  const l = P.ordenaCandidatos([
    { caminho: 'loja', tipo: 'loja', mesmo: 'sim', largura: 1200, altura: 1200 },
    { caminho: 'fab', tipo: 'fabricante', mesmo: 'sim', largura: 600, altura: 600 },
    { caminho: 'ean', tipo: 'loja', ean_bate: true, mesmo: 'sim', largura: 400, altura: 400 },
    { caminho: 'parecido', tipo: 'fabricante', mesmo: 'parecido', largura: 2000, altura: 2000 }]);
  assert.deepEqual(l.map(x => x.caminho), ['ean', 'fab', 'loja', 'parecido']);
});

// ---- catálogo da vendedora (produtos.js)
const X = require('../produtos.js');
const DISP = [
  { codigo: '010356', descricao: 'DESINFETANTE F. DO CAMPO 5 LTS BARBAREX', unidade: 'GL', linha: 'DOMISSANITARIOS', disponivel: 3, reservado: 1, a_caminho: 0, preco_venda: 18.5, custo: 12, situacao: '' },
  { codigo: '010356.1', base: '010356', descricao: 'DESINFETANTE CX', unidade: 'CX', disponivel: 0.75, preco_venda: 70, fator: 4 },
  { codigo: '010078', descricao: 'DETERGENTE 500 ML NEUTRO YPE', unidade: 'FR', linha: 'SUPER MERCADO', disponivel: 240, a_caminho: 0, preco_venda: 2.9, custo: 1.8 },
  { codigo: '280056', descricao: 'LUVA MAXI LATEX AMARELA TAMANHO P DANNY', unidade: 'UN', linha: 'LUVAS', disponivel: 0, a_caminho: 50, preco_venda: 6, custo: 3 },
  { codigo: '999999', descricao: 'PRODUTO VELHO', unidade: 'UN', linha: 'LUVAS', disponivel: 0, situacao: 'INATIVO' }
];
const VEND = [{ codigo: '010356', quantidade: 120, notas: 40 }, { codigo: '010078', quantidade: 900, notas: 12 }, { codigo: '280056', quantidade: 30, notas: 3 }];

test('catalogo: uma linha por produto, caixa junto, foto, ficha e o mais vendido pelo número de notas', () => {
  const l = X.catalogo({ disp: DISP, fotos: [{ codigo: '010078', caminho: 'fotos/010078-a.jpg' }], infos: [{ codigo: '010356', marca: 'Barbarex' }], vendidos: VEND });
  assert.deepEqual(l.map(x => x.codigo), ['010356', '010078', '280056', '999999']);
  const d = l[0];
  assert.deepEqual(d.caixa, { codigo: '010356.1', fator: 4, preco: 70, disponivel: 0.75 });
  assert.equal(d.info.marca, 'Barbarex');
  assert.equal(d.maisVendido, true);   // 40 notas: o primeiro dos 15%
  assert.equal(l[1].maisVendido, undefined);
  assert.equal(l[1].foto.caminho, 'fotos/010078-a.jpg');
});

test('estado: falta (com o que está a caminho), pouco pela venda de 90 dias, ok', () => {
  const l = X.catalogo({ disp: DISP, vendidos: VEND });
  assert.deepEqual(X.estado(l[2]), { cls: 'falta', texto: 'Em falta · a caminho 50' });
  const p = X.estado(l[0]);                // 3 disponíveis, 120 em 90 dias = 1,33 por dia → dura ~2 dias
  assert.equal(p.cls, 'pouco');
  assert.equal(p.dias, 2);
  assert.equal(X.estado(l[1]).cls, 'ok'); // 240 disponíveis, 10 por dia
});

test('filtra: todas as palavras em qualquer ordem, marca, só com estoque, inativo fora, código exato primeiro', () => {
  const l = X.catalogo({ disp: DISP, infos: [{ codigo: '010356', marca: 'Barbarex' }], vendidos: VEND });
  assert.deepEqual(X.filtra(l, { busca: 'ype neutro' }).map(x => x.codigo), ['010078']);
  assert.deepEqual(X.filtra(l, { busca: 'barbarex' }).map(x => x.codigo), ['010356']);
  assert.deepEqual(X.filtra(l, { soEstoque: true }).map(x => x.codigo), ['010356', '010078']);       // por número de vendas
  assert.deepEqual(X.filtra(l, { busca: 'luva' }).map(x => x.codigo), ['280056']);                   // com busca, aparece mesmo em falta; o inativo sem estoque não
  assert.deepEqual(X.filtra(l, { ordem: 'estoque' }).map(x => x.codigo), ['010078', '010356', '280056']);
  assert.deepEqual(X.filtra(l, { busca: '010078' }).map(x => x.codigo), ['010078']);
  assert.deepEqual(X.linhas(l).map(x => x.nome), ['LUVAS', 'DOMISSANITARIOS', 'SUPER MERCADO']);
});

test('paraBuscar e custoEstimado: o lote pega os mais vendidos sem foto e sem sugestão; o custo vem das buscas medidas', () => {
  const l = X.catalogo({ disp: DISP, fotos: [{ codigo: '010078', caminho: 'x' }], vendidos: VEND });
  assert.deepEqual(X.paraBuscar(l, [], 5), ['010356', '280056']);
  assert.deepEqual(X.paraBuscar(l, [{ codigo: '010356', situacao: 'recusada' }], 5), ['280056']);
  assert.deepEqual(X.paraBuscar(l, [{ codigo: '010356', situacao: 'erro' }], 1), ['010356']);   // erro: tenta de novo
  assert.deepEqual(X.custoEstimado(10, []), { medio: X.CUSTO_PADRAO, total: 0.5, medido: 0 });
  const doze = [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.3, 0.3].map(c => ({ custo_usd: c }));
  assert.equal(X.custoEstimado(1, doze).medio, 0.02); // só as 10 mais recentes
  assert.deepEqual(X.custoEstimado(100, [{ custo_usd: 0.05 }, { custo_usd: 0.07 }, { custo_usd: 0 }]), { medio: 0.06, total: 6, medido: 2 });
});

test('especificações em texto e a foto que já vem marcada', () => {
  const l = [{ nome: 'Conteúdo', valor: '5 litros' }, { nome: 'Diluição', valor: '1:100 (limpeza geral)' }];
  assert.equal(X.specsTexto(l), 'Conteúdo: 5 litros\nDiluição: 1:100 (limpeza geral)');
  assert.deepEqual(X.specsDe(X.specsTexto(l) + '\n\nlinha sem dois pontos'), l.concat([{ nome: 'Observação', valor: 'linha sem dois pontos' }]));
  assert.equal(X.confiavel({ ean_bate: true, tipo: 'loja' }), true);
  assert.equal(X.confiavel({ mesmo: 'sim', tipo: 'fabricante' }), true);
  assert.equal(X.confiavel({ mesmo: 'sim', tipo: 'loja' }), false);
  assert.equal(X.confiavel(null), false);
});

test('textoWhats: nome, marca, descrição, preço da tabela e da caixa, foto e ficha', () => {
  const x = { nome: 'Detergente 500ml neutro ype', unidade: 'FR', preco: 2.9, caixa: { fator: 24, preco: 66 }, info: { marca: 'Ypê', descricao: 'Para lavar louças.' } };
  assert.equal(X.textoWhats(x, 'https://f/foto.jpg', 'https://f/ft.pdf'),
    '*Detergente 500ml neutro ype*\nPara lavar louças.\nPreço: R$ 2,90 (FR) · caixa com 24: R$ 66,00\nFoto: https://f/foto.jpg\nFicha técnica: https://f/ft.pdf');
  assert.equal(X.textoWhats({ nome: 'Luva Sanro', preco: null, info: { marca: 'Sanro' } }, '', ''), '*Luva Sanro*');
});
