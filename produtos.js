/* Produtos com foto e ficha técnica (19/10/2026, pedidos do Anderson: "estoque para o vendedor consultar o produto... seria
   muito bom se aparecesse foto do produto"; "quando a vendedora for incluir um item, aí ela pesquisa em toda totalidade, no
   entanto aparece pra ela somente as informações pertinentes a vendas e não o cadastro completo"; "a IA buscar foto e as
   fichas técnicas, que normalmente tem no site dos fabricantes... sempre deixando os cadastros da forma mais completa
   possível"). Layout aprovado na simulação (Produtos, Ficha, Buscar foto, Fotos em lote).
   - Vendas → Estoque (aba "produtos"): o catálogo para vender — foto, disponível, a caminho, preço da tabela, descrição,
     especificações e os PDFs da ficha técnica e da FISPQ. Sem custo de compra, conferência, notas nem fornecedor.
   - A mesma ficha abre no pedido ("Procurar no estoque com foto") e no Estoque do comprador.
   - Compras e estoque → Estoque → Fotos e fichas: a IA (crm-produto-buscar) procura na web; o comprador aprova antes de a
     equipe ver. Foto reduzida no navegador (900 px, JPEG) antes de guardar, para a tela carregar leve.
   Aqui: as regras puras (testes/produto-fotos.test.js) e as telas. */
(function (raiz) {
  'use strict';
  const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
  const ehCaixa = cod => /\.\d+$/.test(String(cod || ''));
  const base = cod => String(cod || '').replace(/\.\d+$/, '');
  const sem = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // Uma linha por produto (a unidade), com a caixa fechada junto, a foto, a ficha e quanto saiu nos últimos 90 dias.
  // "mais vendido": os 15% que saíram em mais notas (a curva A pelo número de vendas, que não mistura galão com copo).
  function catalogo({ disp, fotos, infos, vendidos }) {
    const fm = new Map((fotos || []).map(f => [f.codigo, f])), im = new Map((infos || []).map(i => [i.codigo, i]));
    const vm = new Map((vendidos || []).map(v => [v.codigo, v]));
    const caixas = new Map();
    (disp || []).filter(d => ehCaixa(d.codigo)).forEach(d => { const b = d.base || base(d.codigo); if (!caixas.has(b)) caixas.set(b, d); });
    const l = (disp || []).filter(d => !ehCaixa(d.codigo)).map(d => {
      const cx = caixas.get(d.codigo), v = vm.get(d.codigo);
      return {
        codigo: d.codigo, descricao: d.descricao || d.codigo, unidade: d.unidade || '', linha: d.linha || '', familia: d.familia || '', situacao: d.situacao || '',
        disponivel: num(d.disponivel), reservado: num(d.reservado), a_caminho: num(d.a_caminho), preco: d.preco_venda == null ? null : num(d.preco_venda),
        custo: d.custo == null ? null : num(d.custo),
        caixa: cx ? { codigo: cx.codigo, fator: num(cx.fator) || null, preco: cx.preco_venda == null ? null : num(cx.preco_venda), disponivel: num(cx.disponivel) } : null,
        foto: fm.get(d.codigo) || null, info: im.get(d.codigo) || null, vendido: v ? num(v.quantidade) : 0, vendas: v ? num(v.notas) : 0
      };
    });
    const vend = l.filter(x => x.vendas > 0).sort((a, b) => b.vendas - a.vendas);
    vend.slice(0, Math.max(1, Math.ceil(vend.length * 0.15))).forEach(x => { x.maisVendido = true; });
    return l;
  }

  // Situação do disponível para o selo do cartão: falta, pouco (dura menos de ~15 dias pela venda de 90) ou ok.
  function estado(x) {
    const d = Math.floor(num(x.disponivel) * 1000) / 1000, porDia = num(x.vendido) / 90;
    const n = d.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
    if (d <= 0) return { cls: 'falta', texto: 'Em falta' + (num(x.a_caminho) > 0 ? ' · a caminho ' + num(x.a_caminho).toLocaleString('pt-BR') : '') };
    if (porDia > 0 && d < porDia * 15) return { cls: 'pouco', texto: 'Pouco: ' + n + ' disponíve' + (d === 1 ? 'l' : 'is'), dias: Math.max(1, Math.round(d / porDia)) };
    return { cls: 'ok', texto: n + ' disponíve' + (d === 1 ? 'l' : 'is') };
  }

  // Busca por partes (todas as palavras em qualquer ordem), linha, só com estoque e ordem.
  function filtra(l, f) {
    f = f || {};
    const termos = sem(f.busca).split(/\s+/).filter(Boolean);
    const out = (l || []).filter(x => {
      if (f.linha && x.linha !== f.linha) return false;
      if (f.soEstoque && !(x.disponivel > 0) && !termos.length) return false;
      if (x.situacao === 'INATIVO' && !(x.disponivel > 0)) return false;
      if (!termos.length) return true;
      const t = sem([x.codigo, x.descricao, x.linha, x.familia, x.info && x.info.marca, x.info && x.info.fabricante].join(' '));
      return termos.every(p => t.indexOf(p) !== -1);
    });
    const nome = (a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR');
    const ordem = f.ordem === 'nome' ? nome : f.ordem === 'estoque' ? (a, b) => b.disponivel - a.disponivel || nome(a, b)
      : (a, b) => b.vendas - a.vendas || (b.disponivel > 0) - (a.disponivel > 0) || nome(a, b);
    // com busca, o código exato vem primeiro
    const q = String(f.busca || '').trim().toUpperCase();
    return out.sort((a, b) => (b.codigo === q) - (a.codigo === q) || ordem(a, b));
  }

  // Linhas de produto para os botões de filtro (as que têm mais produtos primeiro).
  function linhas(l) {
    const m = new Map();
    (l || []).forEach(x => { if (x.linha) m.set(x.linha, (m.get(x.linha) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).map(([nome, n]) => ({ nome, n }));
  }

  // Quais produtos mandar para a IA no lote: sem foto aprovada e sem sugestão em aberto (nem recusada, nem "não achei"),
  // ativos ou com estoque, dos que mais vendem para os que menos vendem.
  function paraBuscar(l, sugestoes, quantos) {
    const s = new Map((sugestoes || []).map(x => [x.codigo, x]));
    return (l || []).filter(x => !x.foto && (x.situacao !== 'INATIVO' || x.disponivel > 0) && (!s.has(x.codigo) || s.get(x.codigo).situacao === 'erro'))
      .sort((a, b) => b.vendas - a.vendas || b.disponivel - a.disponivel || String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'))
      .slice(0, quantos == null ? Infinity : quantos).map(x => x.codigo);
  }

  // Custo médio por produto das 10 buscas mais recentes (a lista vem da mais nova para a mais velha; as antigas podem ser
  // de outro modelo) ou a estimativa antes de medir → total estimado do lote, em US$.
  const CUSTO_PADRAO = 0.05;
  function custoEstimado(n, sugestoes) {
    const l = (sugestoes || []).map(x => num(x.custo_usd)).filter(v => v > 0).slice(0, 10);
    const medio = l.length ? l.reduce((s, v) => s + v, 0) / l.length : CUSTO_PADRAO;
    return { medio: Math.round(medio * 1000) / 1000, total: Math.round(n * medio * 100) / 100, medido: l.length };
  }

  // Especificações em texto ("Nome: valor" por linha) ↔ lista, para o comprador corrigir no formulário.
  const specsTexto = l => (l || []).map(e => e.nome + ': ' + e.valor).join('\n');
  const specsDe = t => String(t || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).map(x => {
    const i = x.indexOf(':');
    return i > 0 ? { nome: x.slice(0, i).trim(), valor: x.slice(i + 1).trim() } : { nome: 'Observação', valor: x };
  }).filter(e => e.nome && e.valor).slice(0, 30);

  // A foto que já vem marcada para aprovar no lote: a de código de barras batendo ou "mesmo produto" de fabricante/fornecedor.
  const confiavel = c => !!(c && (c.ean_bate || (c.mesmo === 'sim' && c.tipo !== 'loja')));

  const API = { catalogo, estado, filtra, linhas, paraBuscar, custoEstimado, specsTexto, specsDe, confiavel, CUSTO_PADRAO };
  raiz.CRMProdutos = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);

(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, X = raiz.CRMProdutos, R = raiz.CRMRegras, P = raiz.CRMPedidos;
  if (!CRM || !CRM.telas) return;
  const esc = CRM.esc;
  const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
  const qtd = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
  const preco = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const usd = v => 'US$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const quando = iso => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
  const podeFotos = () => CRM.ehAdmin() || CRM.ehComprador();
  const st = () => CRM.store();
  const nome = x => R.nomeDeItem(x.descricao || x.codigo);

  let lista = null, carregando = false, sugs = [], ia = null, lote = null;
  let fotos = null; // Map(codigo → linha de crm_produto_fotos), carregado também sozinho (miniaturas no pedido e no estoque)
  const f = { busca: '', linha: '', soEstoque: true, ordem: 'vendidos', limite: 60 };
  const fl = { ver: 'aprovar', busca: '', quantos: '5', marcados: new Set(), escolha: {} };

  async function carrega() {
    if (carregando) return;
    carregando = true;
    try {
      const s = st();
      const [disp, fs, infos, vendidos] = await Promise.all([s.estoqueDisponivel(), s.produtoFotos().catch(() => []), s.produtoInfos().catch(() => []), s.produtosVendidos(90).catch(() => [])]);
      fotos = new Map(fs.map(x => [x.codigo, x]));
      lista = X.catalogo({ disp, fotos: fs, infos, vendidos });
      if (podeFotos()) {
        [sugs, ia] = await Promise.all([s.produtoSugestoes().catch(() => []), s.produtoBuscar({ acao: 'situacao' }).catch(() => null)]);
        sugs.filter(x => x.situacao === 'sugerida' && !fl.marcados.has(x.codigo) && X.confiavel((x.candidatos || [])[0]) && !(lista.find(p => p.codigo === x.codigo) || {}).foto).forEach(x => fl.marcados.add(x.codigo));
      }
    } catch (e) { lista = lista || []; CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }
  // só as fotos (para as miniaturas fora do catálogo), uma vez
  let pedindoFotos = false;
  function garanteFotos() {
    if (fotos || pedindoFotos || !CRM.store()) return;
    pedindoFotos = true;
    st().produtoFotos().then(fs => { fotos = new Map(fs.map(x => [x.codigo, x])); CRM.render(); }).catch(() => { fotos = new Map(); });
  }
  const urlFoto = cod => { const x = fotos && fotos.get(base(cod)); return x ? st().fotoUrl(x.caminho) : ''; };
  const base = cod => String(cod || '').replace(/\.\d+$/, '');
  function miniatura(cod, cls) {
    garanteFotos();
    const u = urlFoto(cod);
    return u ? '<img class="pf-mini ' + (cls || '') + '" src="' + esc(u) + '" alt="" loading="lazy">' : '<span class="pf-mini vazio ' + (cls || '') + '" aria-hidden="true"></span>';
  }
  const prod = cod => (lista || []).find(x => x.codigo === base(cod));

  // ----------------------------------------------------------------- cartão e catálogo
  function cartao(x, modo) {
    const e = X.estado(x), u = x.foto ? st().fotoUrl(x.foto.caminho) : '';
    return '<article class="pf-cartao">' +
      '<button type="button" class="pf-foto" data-acao="pf-ficha" data-id="' + esc(x.codigo) + '" aria-label="Ver a ficha de ' + esc(nome(x)) + '">' +
        (u ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : '<span class="pf-sem">sem foto ainda</span>') +
        (x.maisVendido ? '<span class="pf-selo">mais vendido</span>' : '') + '</button>' +
      '<div class="pf-corpo"><strong class="pf-nome">' + esc(nome(x)) + '</strong>' +
        '<small>' + esc(x.codigo) + (x.unidade ? ' · ' + esc(x.unidade) : '') + (x.caixa && x.caixa.fator ? ' · caixa com ' + qtd(x.caixa.fator) : '') + (x.info && x.info.marca ? ' · ' + esc(x.info.marca) : '') + '</small>' +
        '<span class="pf-disp ' + e.cls + '">' + esc(e.texto) + '</span>' +
        (x.preco ? '<span class="pf-preco"><small>Tabela A</small> <strong>R$ ' + preco(x.preco) + '</strong>' + (x.caixa && x.caixa.preco ? ' <small>· caixa R$ ' + preco(x.caixa.preco) + '</small>' : '') + '</span>' : '<span class="pf-preco"><small>sem preço de tabela</small></span>') +
        '<div class="pf-botoes"><button type="button" class="btn sec" data-acao="pf-ficha" data-id="' + esc(x.codigo) + '">Ver ficha</button>' +
          (modo === 'escolher' ? '<button type="button" class="btn" data-acao="pf-escolhe" data-id="' + esc(x.codigo) + '">Incluir</button>'
            : CRM.pedidos && CRM.pedidos.incluirItem && !CRM.foraDeVendas() ? '<button type="button" class="btn" data-acao="pf-pedido" data-id="' + esc(x.codigo) + '">+ Pedido</button>' : '') +
        '</div></div></article>';
  }

  function filtrosHTML(alvo) {
    const ls = X.linhas(lista).slice(0, 10);
    return '<div class="pf-filtros">' +
      '<input type="search" class="of-busca pf-busca" data-pf-busca="' + alvo + '" value="' + esc(f.busca) + '" placeholder="Buscar por nome, código ou marca…" aria-label="Buscar produto" autocomplete="off">' +
      '<div class="chips">' + [{ nome: '', n: 0 }].concat(ls).map(l => '<button type="button" class="chip-filtro' + (f.linha === l.nome ? ' ativo' : '') + '" data-acao="pf-linha" data-id="' + esc(l.nome) + '">' + esc(l.nome ? R.nomeDeItem(l.nome) : 'Todos') + '</button>').join('') + '</div>' +
      '<label class="filtro-inline"><input type="checkbox" data-pf-soestoque' + (f.soEstoque ? ' checked' : '') + '> Só com estoque</label>' +
      '<label class="filtro-inline">Ordenar <select data-pf-ordem>' + CRM.opcoesHTML([['vendidos', 'Mais vendidos'], ['nome', 'Nome'], ['estoque', 'Mais estoque']], f.ordem) + '</select></label></div>';
  }
  function grade(modo) {
    const l = X.filtra(lista, f);
    return (l.length ? '<div class="pf-grade">' + l.slice(0, f.limite).map(x => cartao(x, modo)).join('') + '</div>' +
      (l.length > f.limite ? '<p class="acoes"><button type="button" class="btn sec" data-acao="pf-mais">Mostrar mais (' + (l.length - f.limite) + ')</button></p>' : '')
      : '<p class="vazio">Nenhum produto ' + (f.busca ? 'com "' + esc(f.busca) + '"' : 'aqui') + (f.soEstoque && !f.busca ? ' com estoque' : '') + '.</p>');
  }

  CRM.telas.produtos = {
    render() {
      if (lista === null) { setTimeout(carrega, 0); return '<div class="cabecalho"><div><h1>Estoque</h1></div></div><div class="cartao"><p class="vazio">Carregando…</p></div>'; }
      const semFoto = lista.filter(x => !x.foto && x.disponivel > 0).length;
      return '<div class="cabecalho"><div><h1>Estoque</h1><p class="sub">o que temos para vender agora: foto, disponível, preço de tabela e a ficha técnica de cada produto</p></div>' +
        '<div class="acoes">' + (podeFotos() ? '<button type="button" class="btn sec" data-acao="pf-ir-fotos">Fotos e fichas' + (semFoto ? ' (' + semFoto + ' sem foto)' : '') + '</button>' : '') +
        '<button type="button" class="btn sec" data-acao="pf-recarregar"' + (carregando ? ' disabled' : '') + '>Atualizar</button></div></div>' +
        '<section class="cartao">' + filtrosHTML('tela') + '<div data-pf-lista>' + grade('tela') + '</div></section>';
    },
    depois(c) { ligaFiltros(c, 'tela', () => grade('tela')); }
  };
  // a busca redesenha só a grade (o campo não perde o foco nem o cursor)
  function ligaFiltros(c, alvo, desenha) {
    const b = c.querySelector('[data-pf-busca="' + alvo + '"]'), lst = c.querySelector('[data-pf-lista]');
    if (b && lst) b.addEventListener('input', () => { f.busca = b.value; f.limite = 60; lst.innerHTML = desenha(); });
    const so = c.querySelector('[data-pf-soestoque]');
    if (so) so.addEventListener('change', () => { f.soEstoque = so.checked; if (alvo === 'tela') CRM.render(); else lst.innerHTML = desenha(); });
    const o = c.querySelector('[data-pf-ordem]');
    if (o) o.addEventListener('change', () => { f.ordem = o.value; if (alvo === 'tela') CRM.render(); else lst.innerHTML = desenha(); });
  }

  // ----------------------------------------------------------------- ficha do produto
  function fichaHTML(x) {
    const e = X.estado(x), u = x.foto ? st().fotoUrl(x.foto.caminho) : '', inf = x.info || {};
    const tab = P ? P.tabelaDe(CRM.estado.cfg) : null;
    const faixas = P && x.preco ? ['A', 'B', 'C', 'D'].filter(fx => tab[fx] != null).map(fx => {
      const pr = P.precoDaFaixa(x.preco, fx, tab), m = x.custo != null ? P.margem(pr, x.custo) : null;
      return '<tr><td><strong>' + fx + '</strong></td><td class="num">R$ ' + preco(pr) + '</td>' + (m != null ? '<td class="num">' + preco(m) + '%</td>' : '') + '</tr>';
    }).join('') : '';
    const pdf = (cam, url, rot) => cam || url ? '<a class="btn sec" href="' + esc(cam ? st().fotoUrl(cam) : url) + '" target="_blank" rel="noopener noreferrer">📄 ' + rot + '</a>' : '';
    const sg = sugs.find(s => s.codigo === x.codigo);
    return '<div class="pf-ficha">' +
      '<section class="pf-ficha-foto">' + (u ? '<img src="' + esc(u) + '" alt="' + esc(nome(x)) + '">' : '<span class="pf-sem">sem foto ainda</span>') +
        (podeFotos() ? '<div class="pf-ficha-comprador"><small>Só o comprador vê: ' + (x.foto ? 'foto de ' + esc(quando(x.foto.atualizado_em)) + (x.foto.fonte ? ' · ' + esc(x.foto.fonte) : '') : 'sem foto') +
          (sg && sg.situacao === 'sugerida' ? ' · há sugestão da IA para aprovar' : '') + '</small>' +
          '<p class="acoes"><button type="button" class="btn sec" data-acao="pf-buscar-um" data-id="' + esc(x.codigo) + '">Buscar foto e ficha (IA)</button> ' +
          '<button type="button" class="btn sec" data-acao="pf-subir" data-id="' + esc(x.codigo) + '">Subir foto</button> ' +
          '<button type="button" class="btn sec" data-acao="pf-camera" data-id="' + esc(x.codigo) + '">Tirar foto</button> ' +
          '<button type="button" class="btn sec" data-acao="pf-info-editar" data-id="' + esc(x.codigo) + '">Editar a ficha</button>' +
          (x.foto ? ' <button type="button" class="mini" data-acao="pf-foto-tirar" data-id="' + esc(x.codigo) + '">tirar a foto</button>' : '') + '</p></div>' : '') +
      '</section><section class="pf-ficha-dados">' +
        '<div class="chips">' + (x.maisVendido ? CRM.selo('mais vendido', 'azul') : '') + (x.linha ? CRM.selo(R.nomeDeItem(x.linha) + (x.familia && !/^0+$/.test(x.familia) ? ' · ' + R.nomeDeItem(x.familia.replace(/^\d+\s*/, '')) : ''), '') : '') + '</div>' +
        '<p class="pf-sub">' + esc(x.codigo) + (x.unidade ? ' · ' + esc(x.unidade) : '') + (x.caixa && x.caixa.fator ? ' · caixa com ' + qtd(x.caixa.fator) : '') +
          (inf.marca ? ' · marca ' + esc(inf.marca) : '') + (inf.fabricante && inf.fabricante !== inf.marca ? ' · ' + esc(inf.fabricante) : '') + '</p>' +
        '<div class="pf-numeros"><div class="' + e.cls + '"><span>Disponível</span><strong>' + qtd(Math.floor(x.disponivel * 1000) / 1000) + '</strong><small>' + (e.dias ? 'pouco: dura ~' + e.dias + ' dia(s)' : e.cls === 'falta' ? 'em falta' : 'para vender agora') + '</small></div>' +
          '<div><span>Reservado</span><strong>' + qtd(x.reservado) + '</strong><small>em pedidos abertos</small></div>' +
          '<div class="caminho"><span>A caminho</span><strong>' + qtd(x.a_caminho) + '</strong><small>já pedido ao fornecedor</small></div></div>' +
        (inf.descricao ? '<p class="pf-descricao">' + esc(inf.descricao) + '</p>' : '') +
        (pdf(inf.ficha_caminho, inf.ficha_url, 'Ficha técnica') || pdf(inf.fispq_caminho, inf.fispq_url, 'FISPQ') ? '<p class="acoes">' + pdf(inf.ficha_caminho, inf.ficha_url, 'Ficha técnica') + ' ' + pdf(inf.fispq_caminho, inf.fispq_url, 'FISPQ (segurança)') + '</p>' : '') +
        ((inf.especificacoes || []).length ? '<h3>Especificações</h3><table class="tabela pf-specs"><tbody>' + inf.especificacoes.map(s => '<tr><th>' + esc(s.nome) + '</th><td>' + esc(s.valor) + '</td></tr>').join('') + '</tbody></table>' : '') +
        (faixas ? '<h3>Preço por faixa</h3><table class="tabela pf-faixas"><thead><tr><th>Faixa</th><th class="num">Preço</th>' + (x.custo != null ? '<th class="num">Margem</th>' : '') + '</tr></thead><tbody>' + faixas + '</tbody></table>' +
          (x.caixa && x.caixa.preco ? '<p class="dica">Caixa fechada (' + esc(x.caixa.codigo) + '): R$ ' + preco(x.caixa.preco) + ' na tabela A.</p>' : '') : '') +
        '<p class="dica">Últimos 90 dias: ' + (x.vendas ? qtd(x.vendido) + ' ' + esc(x.unidade || 'un') + ' em ' + x.vendas + ' nota(s)' : 'nenhuma venda') + '.</p>' +
      '</section></div>';
  }
  let aoEscolher = null; // o pedido aberto que pediu "procurar com foto"
  async function abrirFicha(cod) {
    if (lista === null) await carregaJa();
    const x = prod(cod);
    if (!x) { CRM.toast('Produto ' + cod + ' não está no estoque.', true); return; }
    const incluir = aoEscolher || (CRM.pedidos && CRM.pedidos.incluirItem && !CRM.foraDeVendas() ? c => CRM.pedidos.incluirItem(c) : null);
    CRM.abrirForm({
      titulo: nome(x), largura: 'extra', campos: [], htmlAntes: fichaHTML(x), semFoco: true,
      salvarTexto: incluir ? '+ Adicionar ao pedido' : 'Fechar',
      aoSalvar: async () => { if (incluir) { const fn = incluir; aoEscolher = null; await fn(x.codigo); } }
    });
  }
  async function carregaJa() { if (lista === null) { await carrega(); } }

  // ----------------------------------------------------------------- escolher o produto no pedido, com foto
  function escolher(fn) {
    aoEscolher = fn;
    const abre = () => CRM.abrirForm({
      titulo: 'Procurar no estoque', largura: 'extra', campos: [], semFoco: true, salvarTexto: 'Fechar', aoSalvar: async () => { aoEscolher = null; },
      htmlAntes: filtrosHTML('escolher') + '<div data-pf-lista>' + grade('escolher') + '</div>',
      extras: (form, dlg) => {
        ligaFiltros(form, 'escolher', () => grade('escolher'));
        const b = form.querySelector('[data-pf-busca]'); if (b) b.focus();
        dlg.addEventListener('close', () => { aoEscolher = null; }, { once: true }); // fechou sem escolher: o próximo "+ Pedido" não volta para cá
      }
    });
    if (lista === null) carrega().then(abre); else abre();
  }

  // ----------------------------------------------------------------- fotos: reduzir, guardar
  // Reduz a foto no navegador (lado maior 900 px, fundo branco, JPEG): a vendedora abre a tela com dezenas delas.
  async function reduz(blob, max) {
    max = max || 900;
    try {
      const img = await createImageBitmap(blob);
      const k = Math.min(1, max / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      const out = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.86));
      if (out) return { blob: out, ext: 'jpg' };
    } catch (e) { /* formato que o navegador não abre: guarda como veio */ }
    const ext = /png/.test(blob.type) ? 'png' : /webp/.test(blob.type) ? 'webp' : 'jpg';
    return { blob, ext };
  }
  async function guardaFoto(cod, blob, fonte, fonteUrl) {
    const s = st(), r = await reduz(blob), velha = fotos && fotos.get(cod);
    const caminho = await s.fotoSubir('fotos', cod, r.blob, r.ext);
    const linha = await s.produtoFotoGravar({ codigo: cod, caminho, fonte: fonte || null, fonte_url: fonteUrl || null });
    if (velha && velha.caminho !== caminho) s.fotoApagar([velha.caminho]).catch(() => {});
    if (!fotos) fotos = new Map();
    fotos.set(cod, linha || { codigo: cod, caminho, fonte });
    const p = prod(cod); if (p) p.foto = fotos.get(cod);
  }
  function escolheArquivo(aceita, camera) {
    return new Promise(ok => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = aceita; if (camera) i.setAttribute('capture', 'environment');
      i.addEventListener('change', () => ok(i.files && i.files[0] ? i.files[0] : null));
      i.click();
    });
  }
  async function subir(cod, camera) {
    const arq = await escolheArquivo('image/*', camera);
    if (!arq) return;
    if (!/^image\//.test(arq.type)) { CRM.toast('Escolha uma imagem (foto).', true); return; }
    try { await guardaFoto(cod, arq, camera ? 'foto tirada pelo comprador' : 'enviada pelo comprador', null); CRM.toast('Foto guardada.'); reabreFicha(cod); } catch (e) { CRM.falhou(e); }
  }
  const reabreFicha = cod => { const d = document.querySelector('#dlgForm'); if (d && d.open) abrirFicha(cod); else CRM.render(); };

  // ----------------------------------------------------------------- a IA busca; o comprador aprova
  async function buscarUm(cod, busca) {
    const r = await st().produtoBuscar({ acao: 'buscar', codigo: cod, busca: busca || undefined });
    sugs = [r].concat(sugs.filter(s => s.codigo !== cod));
    if (r.situacao === 'sugerida' && X.confiavel((r.candidatos || [])[0])) fl.marcados.add(cod);
    return r;
  }
  async function aprovar(cod, o) {
    o = o || {};
    const s = st(), sg = sugs.find(x => x.codigo === cod);
    if (!sg) throw new Error('sem sugestão para ' + cod);
    const i = o.foto != null ? o.foto : (fl.escolha[cod] != null ? fl.escolha[cod] : 0), c = (sg.candidatos || [])[i];
    if (c && i >= 0) await guardaFoto(cod, await s.fotoBaixar(c.caminho), c.site || c.tipo || 'IA', c.pagina || c.url);
    const inf = Object.assign({}, sg.info || {}, o.info || {});
    const copia = async (arq, nomeArq) => (arq && arq.caminho ? s.fotoSubir('fichas', cod + '-' + nomeArq, await s.fotoBaixar(arq.caminho), 'pdf') : null);
    const usaFicha = o.ficha !== false && inf.ficha, usaFispq = o.fispq !== false && inf.fispq;
    if (inf.descricao || (inf.especificacoes || []).length || inf.marca || usaFicha || usaFispq) {
      const atual = (prod(cod) || {}).info || {};
      const linha = { codigo: cod, marca: inf.marca || atual.marca || null, fabricante: inf.fabricante || atual.fabricante || null, descricao: inf.descricao || atual.descricao || null,
        especificacoes: (inf.especificacoes || []).length ? inf.especificacoes : (atual.especificacoes || []), fonte_url: inf.fonte || atual.fonte_url || null,
        ficha_url: usaFicha ? inf.ficha.url : atual.ficha_url || null, ficha_caminho: usaFicha ? await copia(inf.ficha, 'ficha') || null : atual.ficha_caminho || null,
        fispq_url: usaFispq ? inf.fispq.url : atual.fispq_url || null, fispq_caminho: usaFispq ? await copia(inf.fispq, 'fispq') || null : atual.fispq_caminho || null };
      const salvo = await s.produtoInfoGravar(linha);
      const p = prod(cod); if (p) p.info = salvo || linha;
    }
    await s.sugestaoMarcar(cod, 'aprovada');
    sg.situacao = 'aprovada'; fl.marcados.delete(cod);
  }

  async function rodaLote(codigos) {
    lote = { total: codigos.length, feitos: 0, achou: 0, erros: 0, custo: 0, parar: false };
    CRM.render();
    const fila = codigos.slice();
    const trabalha = async () => {
      while (fila.length && !lote.parar) {
        const cod = fila.shift();
        try { const r = await buscarUm(cod); lote.custo += num(r.custo_usd); if (r.situacao === 'sugerida') lote.achou++; else if (r.situacao === 'erro') lote.erros++; }
        catch (e) { lote.erros++; if (/503|chave|ligada/i.test(e.message || '')) { lote.parar = true; CRM.toast(e.message, true); } }
        lote.feitos++;
        CRM.render();
      }
    };
    await Promise.all([trabalha(), trabalha(), trabalha()]); // três de cada vez
    const r = lote; lote = null;
    ia = await st().produtoBuscar({ acao: 'situacao' }).catch(() => ia);
    CRM.toast('Busca terminada: ' + r.feitos + ' produto(s), ' + r.achou + ' com sugestão para aprovar, custo ' + usd(r.custo) + '.');
    CRM.render();
  }

  // Compras e estoque → Estoque → Fotos e fichas
  function telaFotos() {
    if (lista === null) { setTimeout(carrega, 0); return '<section class="cartao"><p class="vazio">Carregando os produtos…</p></section>'; }
    const ativos = lista.filter(x => x.situacao !== 'INATIVO' || x.disponivel > 0);
    const com = ativos.filter(x => x.foto).length, maisSem = ativos.filter(x => x.maisVendido && !x.foto).length, semFicha = ativos.filter(x => !x.info).length;
    const porSit = s => sugs.filter(x => x.situacao === s);
    const aprovar = porSit('sugerida').filter(x => prod(x.codigo));
    const opc = [['5', 'Teste: os 5 mais vendidos sem foto'], ['20', 'Os 20 mais vendidos sem foto'], ['50', 'Os 50 mais vendidos sem foto'], ['200', 'Os 200 mais vendidos sem foto'], ['todos', 'Todos sem foto']];
    const n = X.paraBuscar(lista, sugs, fl.quantos === 'todos' ? null : Number(fl.quantos)).length, est = X.custoEstimado(n, sugs);
    const kpi = (t, v, cls) => '<div class="kpi ' + (cls || '') + '"><span>' + esc(t) + '</span><strong>' + v + '</strong></div>';
    return '<div class="kpis">' + kpi('Com foto', com) + kpi('Sem foto', ativos.length - com) + kpi('Mais vendidos sem foto', maisSem, maisSem ? 'vermelho' : 'verde') +
        kpi('Sem ficha', semFicha) + kpi('Para aprovar', aprovar.length, aprovar.length ? 'ambar' : '') + '</div>' +
      '<section class="cartao pf-lote"><div><h2>Buscar fotos e fichas em lote</h2>' +
        '<p>A IA procura cada produto pelo nome, pela marca e pelo código de barras, de preferência no site do fabricante: a foto, a descrição, as especificações, a ficha técnica e a FISPQ. ' +
        '<strong>Nada aparece para as vendedoras antes de você aprovar.</strong></p>' +
        '<p class="dica">IA no mês: ' + (ia ? usd(ia.custo_mes) + ' (fotos e fichas: ' + usd(ia.custo_fotos_mes) + ')' : '—') + ' · limite da chave: US$ 10 por mês · ' +
          (est.medido ? 'custo médio medido: ' + usd(est.medio) + ' por produto (' + est.medido + ' busca(s))' : 'custo por produto ainda não medido (estimativa ' + usd(est.medio) + '): comece pelo teste de 5') + '</p></div>' +
        (lote ? '<div class="pf-andamento" role="status"><strong>Buscando ' + lote.feitos + ' de ' + lote.total + '…</strong> ' + lote.achou + ' com sugestão · ' + usd(lote.custo) + ' até agora ' +
            '<button type="button" class="btn sec" data-acao="pf-lote-parar"' + (lote.parar ? ' disabled' : '') + '>' + (lote.parar ? 'Parando…' : 'Parar') + '</button></div>'
          : '<div class="pf-lote-acao"><label class="filtro-inline">Quais <select data-pf-quantos>' + CRM.opcoesHTML(opc, fl.quantos) + '</select></label>' +
            '<button type="button" class="btn" data-acao="pf-lote"' + (n && ia && ia.ligado ? '' : ' disabled') + '>Buscar ' + n + ' produto(s) · custo estimado ' + usd(est.total) + '</button>' +
            (ia && !ia.ligado ? '<small class="neg">a IA não está ligada (falta a chave nos segredos do Supabase)</small>' : '') + '</div>') +
        '<div class="pf-um"><input type="search" class="of-busca" data-pf-um value="' + esc(fl.busca) + '" placeholder="Um produto só: código ou nome" autocomplete="off" aria-label="Procurar um produto">' +
          '<div data-pf-um-lista>' + umLista() + '</div></div></section>' +
      '<section class="cartao"><div class="chips">' + [['aprovar', 'Para aprovar (' + aprovar.length + ')'], ['aprovada', 'Aprovadas (' + porSit('aprovada').length + ')'],
          ['sem', 'Sem foto achada (' + (porSit('sem').length + porSit('recusada').length) + ')'], ['erro', 'Com erro (' + porSit('erro').length + ')']]
          .map(c => '<button type="button" class="chip-filtro' + (fl.ver === c[0] ? ' ativo' : '') + '" data-acao="pf-ver" data-id="' + c[0] + '">' + esc(c[1]) + '</button>').join('') +
        (fl.ver === 'aprovar' && aprovar.length ? '<span class="flex"></span><button type="button" class="btn verde" data-acao="pf-aprovar-marcadas"' + (fl.marcados.size ? '' : ' disabled') + '>Aprovar as marcadas (' + [...fl.marcados].filter(c => aprovar.some(a => a.codigo === c)).length + ')</button>' : '') + '</div>' +
        listaSugestoes(fl.ver === 'aprovar' ? aprovar : fl.ver === 'sem' ? porSit('sem').concat(porSit('recusada')) : porSit(fl.ver)) + '</section>';
  }
  function umLista() {
    if (!fl.busca.trim()) return '';
    const l = X.filtra(lista, { busca: fl.busca, ordem: 'vendidos' }).slice(0, 8);
    return l.length ? '<ul class="pf-um-lista">' + l.map(x => '<li>' + miniatura(x.codigo) + '<span><strong>' + esc(nome(x)) + '</strong><small>' + esc(x.codigo) + (x.foto ? ' · tem foto' : '') + (x.info ? ' · tem ficha' : '') + '</small></span>' +
      '<button type="button" class="mini" data-acao="pf-ficha" data-id="' + esc(x.codigo) + '">ficha</button><button type="button" class="btn sec" data-acao="pf-buscar-um" data-id="' + esc(x.codigo) + '">Buscar foto e ficha</button></li>').join('') + '</ul>' : '<p class="vazio">Nada com esse nome.</p>';
  }
  function listaSugestoes(l) {
    if (!l.length) return '<p class="vazio">' + (fl.ver === 'aprovar' ? 'Nada para aprovar agora. Use a busca em lote ou a de um produto só.' : 'Nada aqui.') + '</p>';
    return '<div class="pf-grade pf-sug">' + l.slice(0, 120).map(sg => {
      const x = prod(sg.codigo) || { codigo: sg.codigo, descricao: sg.codigo }, cs = sg.candidatos || [], esc_ = fl.escolha[sg.codigo] != null ? fl.escolha[sg.codigo] : 0;
      const c = cs[esc_], inf = sg.info || {};
      const marca = fl.ver === 'aprovar' ? '<input type="checkbox" data-pf-marca="' + esc(sg.codigo) + '"' + (fl.marcados.has(sg.codigo) ? ' checked' : '') + ' aria-label="Marcar para aprovar">' : '';
      const ok = [inf.marca ? 'marca ' + inf.marca : '', (inf.especificacoes || []).length ? inf.especificacoes.length + ' especificação(ões)' : '', inf.descricao ? 'descrição' : '',
        inf.ficha ? 'ficha técnica' + (inf.ficha.caminho ? '' : ' (link)') : '', inf.fispq ? 'FISPQ' + (inf.fispq.caminho ? '' : ' (link)') : ''].filter(Boolean);
      return '<article class="pf-cartao pf-sug-cartao"><div class="pf-sug-topo">' + marca + '<div><strong>' + esc(nome(x)) + '</strong><small>' + esc(sg.codigo) +
          (c ? ' · ' + esc(c.ean_bate ? 'código de barras bate' : c.mesmo === 'sim' ? 'mesmo produto' : c.mesmo === 'parecido' ? 'parecido: confira' : 'confira o tamanho') : '') + '</small></div></div>' +
        (cs.length ? '<div class="pf-sug-fotos"><button type="button" class="pf-foto grande" data-acao="pf-revisar" data-id="' + esc(sg.codigo) + '"><img src="' + esc(st().fotoUrl(c ? c.caminho : cs[0].caminho)) + '" alt="" loading="lazy"></button>' +
          (cs.length > 1 ? '<div class="pf-sug-outras">' + cs.slice(0, 4).map((k, i) => '<button type="button" class="pf-foto' + (i === esc_ ? ' sel' : '') + '" data-acao="pf-cand" data-id="' + esc(sg.codigo + '|' + i) + '" aria-label="Usar a foto ' + (i + 1) + '"><img src="' + esc(st().fotoUrl(k.caminho)) + '" alt="" loading="lazy"></button>').join('') + '</div>' : '') + '</div>'
          : '<div class="pf-foto"><span class="pf-sem">' + (sg.situacao === 'erro' ? esc(sg.erro || 'erro') : 'nenhuma foto achada') + '</span></div>') +
        '<small>' + esc(c ? (c.site || c.tipo) + (c.largura ? ' · ' + c.largura + '×' + c.altura + ' px' : '') : '') + (ok.length ? (c ? ' · ' : '') + 'achou: ' + esc(ok.join(', ')) : '') + '</small>' +
        (inf.obs ? '<small class="pf-obs">' + esc(inf.obs) + '</small>' : '') +
        '<div class="pf-botoes">' + (sg.situacao === 'sugerida' ? '<button type="button" class="btn sec" data-acao="pf-revisar" data-id="' + esc(sg.codigo) + '">Ver e corrigir</button><button type="button" class="btn sec" data-acao="pf-recusar" data-id="' + esc(sg.codigo) + '">Recusar</button>'
          : '<button type="button" class="btn sec" data-acao="pf-buscar-um" data-id="' + esc(sg.codigo) + '">Buscar de novo</button><button type="button" class="btn sec" data-acao="pf-ficha" data-id="' + esc(sg.codigo) + '">Ficha</button>') + '</div></article>';
    }).join('') + '</div>' + (l.length > 120 ? '<p class="dica">Mostrando 120 de ' + l.length + '.</p>' : '');
  }
  function depoisFotos(c) {
    const q = c.querySelector('[data-pf-quantos]');
    if (q) q.addEventListener('change', () => { fl.quantos = q.value; CRM.render(); });
    const u = c.querySelector('[data-pf-um]'), ul = c.querySelector('[data-pf-um-lista]');
    if (u && ul) u.addEventListener('input', () => { fl.busca = u.value; ul.innerHTML = umLista(); });
    c.querySelectorAll('[data-pf-marca]').forEach(cb => cb.addEventListener('change', () => { if (cb.checked) fl.marcados.add(cb.dataset.pfMarca); else fl.marcados.delete(cb.dataset.pfMarca); CRM.render(); }));
  }

  // Revisar uma sugestão: escolher a foto, corrigir marca/descrição/especificações, usar ou não a ficha e a FISPQ.
  function revisar(cod) {
    const sg = sugs.find(x => x.codigo === cod); if (!sg) return;
    const x = prod(cod) || { codigo: cod, descricao: cod }, inf = sg.info || {}, cs = sg.candidatos || [];
    const pdf = (a, rot) => a ? '<a href="' + esc(a.caminho ? st().fotoUrl(a.caminho) : a.url) + '" target="_blank" rel="noopener noreferrer">' + rot + (a.caminho ? '' : ' (só o link: não consegui baixar)') + '</a>' : '';
    CRM.abrirForm({
      titulo: 'Conferir: ' + nome(x), largura: 'extra', semFoco: true, salvarTexto: 'Aprovar',
      intro: 'Escolha a foto que é o mesmo produto (mesma embalagem e tamanho) e corrija o que precisar. Ela fica guardada no CRM e aparece para as vendedoras.' +
        (inf.eans && inf.eans.length ? ' Código de barras no cadastro: ' + inf.eans.join(', ') + '.' : '') + (sg.busca ? ' A IA procurou por: ' + sg.busca + '.' : ''),
      htmlAntes: (cs.length ? '<div class="pf-escolha">' + cs.map((c, i) => '<label class="pf-opcao"><input type="radio" name="foto" value="' + i + '"' + (i === (fl.escolha[cod] || 0) ? ' checked' : '') + '>' +
          '<img src="' + esc(st().fotoUrl(c.caminho)) + '" alt="" loading="lazy"><small>' + esc((c.site || c.tipo) + (c.largura ? ' · ' + c.largura + '×' + c.altura + ' px' : '')) +
          (c.ean_bate ? ' · código de barras bate' : '') + '</small>' + (c.pagina ? '<a href="' + esc(c.pagina) + '" target="_blank" rel="noopener noreferrer">ver a página</a>' : '') + '</label>').join('') +
          '<label class="pf-opcao"><input type="radio" name="foto" value="-1"><span class="pf-sem">nenhuma serve</span></label></div>' : '<p class="vazio">A IA não achou foto. Dá para subir uma depois, na ficha do produto.</p>') +
        (inf.ficha || inf.fispq ? '<p class="acoes">' + pdf(inf.ficha, '📄 Ficha técnica') + ' ' + pdf(inf.fispq, '📄 FISPQ') + '</p>' : '') +
        (inf.fonte ? '<p class="dica">Especificações tiradas de <a href="' + esc(inf.fonte) + '" target="_blank" rel="noopener noreferrer">' + esc(inf.fonte.replace(/^https?:\/\//, '').slice(0, 70)) + '</a>.</p>' : '') +
        (inf.obs ? '<p class="dica"><strong>A IA pede para conferir:</strong> ' + esc(inf.obs) + '</p>' : ''),
      campos: [{ nome: 'marca', rotulo: 'Marca' }, { nome: 'fabricante', rotulo: 'Fabricante' },
        { nome: 'descricao', rotulo: 'Descrição para a vendedora', tipo: 'textarea', largo: true },
        { nome: 'specs', rotulo: 'Especificações (uma por linha: Nome: valor)', tipo: 'textarea', largo: true },
        { nome: 'ficha', rotulo: 'Guardar a ficha técnica', tipo: 'checkbox' }, { nome: 'fispq', rotulo: 'Guardar a FISPQ', tipo: 'checkbox' }],
      valores: { marca: inf.marca || '', fabricante: inf.fabricante || '', descricao: inf.descricao || '', specs: X.specsTexto(inf.especificacoes), ficha: !!inf.ficha, fispq: !!inf.fispq },
      aoSalvar: async (v, form) => {
        const r = form.querySelector('input[name=foto]:checked');
        await aprovar(cod, { foto: r ? Number(r.value) : (cs.length ? 0 : -1), ficha: !!v.ficha, fispq: !!v.fispq,
          info: { marca: v.marca, fabricante: v.fabricante, descricao: v.descricao, especificacoes: X.specsDe(v.specs) } });
        CRM.toast('Aprovado: ' + nome(x) + '.');
        CRM.render();
      }
    });
  }

  // Editar a ficha à mão (sem a IA): marca, descrição, especificações e os PDFs.
  function editarInfo(cod) {
    const x = prod(cod); if (!x) return;
    const inf = x.info || {};
    CRM.abrirForm({
      titulo: 'Ficha: ' + nome(x), largura: 'largo',
      intro: 'O que a vendedora vê na ficha do produto. Os PDFs (ficha técnica e FISPQ) entram pelos botões abaixo.',
      htmlDepois: '<p class="acoes"><button type="button" class="btn sec" data-acao="pf-pdf" data-id="' + esc(cod + '|ficha') + '">Subir a ficha técnica (PDF)</button> ' +
        '<button type="button" class="btn sec" data-acao="pf-pdf" data-id="' + esc(cod + '|fispq') + '">Subir a FISPQ (PDF)</button></p>' +
        '<p class="dica">' + (inf.ficha_caminho || inf.ficha_url ? 'Tem ficha técnica. ' : 'Sem ficha técnica. ') + (inf.fispq_caminho || inf.fispq_url ? 'Tem FISPQ.' : 'Sem FISPQ.') + '</p>',
      campos: [{ nome: 'marca', rotulo: 'Marca' }, { nome: 'fabricante', rotulo: 'Fabricante' }, { nome: 'descricao', rotulo: 'Descrição para a vendedora', tipo: 'textarea', largo: true },
        { nome: 'specs', rotulo: 'Especificações (uma por linha: Nome: valor)', tipo: 'textarea', largo: true }],
      valores: { marca: inf.marca || '', fabricante: inf.fabricante || '', descricao: inf.descricao || '', specs: X.specsTexto(inf.especificacoes) },
      aoSalvar: async v => {
        const linha = Object.assign({}, inf, { codigo: cod, marca: v.marca || null, fabricante: v.fabricante || null, descricao: v.descricao || null, especificacoes: X.specsDe(v.specs) });
        delete linha.atualizado_em; delete linha.atualizado_por;
        x.info = await st().produtoInfoGravar(linha) || linha;
        CRM.toast('Ficha guardada.');
        CRM.render();
      }
    });
  }
  async function subirPdf(cod, tipo) {
    const arq = await escolheArquivo('application/pdf');
    if (!arq) return;
    if (arq.type !== 'application/pdf') { CRM.toast('Escolha um arquivo PDF.', true); return; }
    const x = prod(cod); if (!x) return;
    try {
      const caminho = await st().fotoSubir('fichas', cod + '-' + tipo, arq, 'pdf');
      const linha = Object.assign({ codigo: cod, especificacoes: [] }, x.info || {}, tipo === 'ficha' ? { ficha_caminho: caminho } : { fispq_caminho: caminho });
      delete linha.atualizado_em; delete linha.atualizado_por;
      x.info = await st().produtoInfoGravar(linha) || linha;
      CRM.toast((tipo === 'ficha' ? 'Ficha técnica' : 'FISPQ') + ' guardada.');
      editarInfo(cod);
    } catch (e) { CRM.falhou(e); }
  }

  Object.assign(CRM.acoes, {
    'pf-recarregar': () => { lista = null; carrega(); },
    'pf-mais': () => { f.limite += 60; const c = document.querySelector('#dlgForm[open] [data-pf-lista]'); if (c) c.innerHTML = grade('escolher'); else CRM.render(); },
    'pf-linha': id => { f.linha = f.linha === id ? '' : id; f.limite = 60; const c = document.querySelector('#dlgForm[open] [data-pf-lista]'); if (c) { c.innerHTML = grade('escolher'); c.parentNode.querySelectorAll('[data-acao="pf-linha"]').forEach(b => b.classList.toggle('ativo', b.dataset.id === f.linha)); } else CRM.render(); },
    'pf-ficha': id => abrirFicha(id),
    'pf-pedido': id => { if (CRM.pedidos && CRM.pedidos.incluirItem) CRM.pedidos.incluirItem(id); },
    'pf-escolhe': id => { const fn = aoEscolher; aoEscolher = null; const d = document.querySelector('#dlgForm'); if (d && d.open) d.close(); if (fn) fn(id); },
    'pf-ir-fotos': () => { if (CRM.estoqueVer) CRM.estoqueVer('fotos'); },
    'pf-subir': id => subir(id, false),
    'pf-camera': id => subir(id, true),
    'pf-foto-tirar': async id => {
      if (!confirm('Tirar a foto deste produto? As vendedoras deixam de ver.')) return;
      try { const v = fotos && fotos.get(id); await st().produtoFotoTirar(id); if (v) st().fotoApagar([v.caminho]).catch(() => {}); if (fotos) fotos.delete(id); const p = prod(id); if (p) p.foto = null; reabreFicha(id); } catch (e) { CRM.falhou(e); }
    },
    'pf-info-editar': id => editarInfo(id),
    'pf-pdf': id => { const [cod, tipo] = id.split('|'); subirPdf(cod, tipo); },
    'pf-buscar-um': async id => {
      const x = prod(id);
      const d = document.querySelector('#dlgForm'); if (d && d.open) d.close();
      CRM.toast('A IA está procurando "' + (x ? nome(x) : id) + '" (leva de 30 segundos a 2 minutos)…');
      try {
        const r = await buscarUm(id);
        ia = await st().produtoBuscar({ acao: 'situacao' }).catch(() => ia);
        if (r.situacao === 'sugerida') { CRM.toast('Achou: confira e aprove (custo ' + usd(r.custo_usd) + ').'); fl.ver = 'aprovar'; CRM.render(); revisar(id); }
        else { CRM.toast(r.situacao === 'erro' ? 'Não deu: ' + (r.erro || 'erro') : 'A IA não achou foto nem ficha deste produto (custo ' + usd(r.custo_usd) + ').', r.situacao === 'erro'); CRM.render(); }
      } catch (e) { CRM.falhou(e); }
    },
    'pf-lote': () => {
      const cods = X.paraBuscar(lista, sugs, fl.quantos === 'todos' ? null : Number(fl.quantos)), est = X.custoEstimado(cods.length, sugs);
      if (!cods.length) return;
      if (!confirm('Mandar a IA procurar ' + cods.length + ' produto(s)?\nCusto estimado: ' + usd(est.total) + ' (limite da chave: US$ 10 por mês; já usado no mês: ' + usd(ia && ia.custo_mes) + ').\nDeixe esta tela aberta até terminar.')) return;
      rodaLote(cods).catch(CRM.falhou);
    },
    'pf-lote-parar': () => { if (lote) { lote.parar = true; CRM.render(); } },
    'pf-ver': id => { fl.ver = id; CRM.render(); },
    'pf-cand': id => { const [cod, i] = id.split('|'); fl.escolha[cod] = Number(i); CRM.render(); },
    'pf-revisar': id => revisar(id),
    'pf-recusar': async id => { try { await st().sugestaoMarcar(id, 'recusada'); const s = sugs.find(x => x.codigo === id); if (s) s.situacao = 'recusada'; fl.marcados.delete(id); CRM.render(); } catch (e) { CRM.falhou(e); } },
    'pf-aprovar-marcadas': async () => {
      const cods = [...fl.marcados].filter(c => sugs.some(s => s.codigo === c && s.situacao === 'sugerida'));
      if (!cods.length || !confirm('Aprovar ' + cods.length + ' produto(s) com a foto escolhida e a ficha que a IA achou?')) return;
      let ok = 0;
      for (const c of cods) { try { await aprovar(c); ok++; } catch (e) { CRM.toast(c + ': ' + (e.message || e), true); } }
      CRM.toast(ok + ' aprovado(s). As vendedoras já veem.');
      CRM.render();
    }
  });

  CRM.produtos = { miniatura, abrirFicha, escolher, telaFotos, depoisFotos, garanteFotos, recarregar: () => { lista = null; } };
})(typeof window !== 'undefined' ? window : globalThis);
