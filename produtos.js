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
        fisico: num(d.fisico), disponivel: num(d.disponivel), reservado: num(d.reservado), a_caminho: num(d.a_caminho), preco: d.preco_venda == null ? null : num(d.preco_venda),
        localizacao: d.localizacao || '',
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
    // negativo = vendido sem estoque, esperando a compra chegar (20/10/2026: o número aparece, não só "em falta"). O que
    // está a caminho (com a data) a tela mostra à parte (compras-pedidos.js).
    if (d <= 0) return { cls: 'falta', texto: d < 0 ? 'Em falta: ' + n + ' (vendido sem estoque)' : 'Em falta' };
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

  // "Código de barras bate" só vale quando o cadastro tem o código de barras: sem ele, é a palavra da IA (20/10/2026: 135 das
  // 360 sugestões diziam bater sem EAN nenhum no cadastro).
  const bate = (c, eans) => !!(c && c.ean_bate && eans && eans.length);
  // A foto que já vem marcada para aprovar no lote: a de código de barras batendo ou "mesmo produto" de fabricante/fornecedor.
  const confiavel = (c, eans) => !!(c && (bate(c, eans) || (c.mesmo === 'sim' && c.tipo !== 'loja')));

  // "Mandar foto e preço pelo WhatsApp" (simulação aprovada): o texto que a vendedora manda ao cliente. O preço é o da
  // tabela A (a negociação é dela); foto e ficha técnica vão como link (o arquivo público do CRM).
  function textoWhats(x, fotoUrl, fichaUrl) {
    const nome = x.nome || x.descricao, br = v => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const inf = x.info || {};
    return ['*' + nome + '*' + (inf.marca && sem(nome).indexOf(sem(inf.marca)) === -1 ? ' (' + inf.marca + ')' : ''),
      inf.descricao || '',
      x.preco ? 'Preço: R$ ' + br(x.preco) + (x.unidade ? ' (' + String(x.unidade).toUpperCase() + ')' : '') + (x.caixa && x.caixa.preco ? ' · caixa' + (x.caixa.fator ? ' com ' + x.caixa.fator : '') + ': R$ ' + br(x.caixa.preco) : '') : '',
      fotoUrl ? 'Foto: ' + fotoUrl : '', fichaUrl ? 'Ficha técnica: ' + fichaUrl : ''].filter(Boolean).join('\n');
  }

  // ------------------------------------------------------------- tela Produtos (20/10/2026, simulação aprovada)
  // O cadastro como no FKN (Cadastro → Produto): pesquisa por código, descrição ou código de barras, em lista ou grade, e a
  // página do produto em abas. O que cada um vê (Anderson, 20/10): a vendedora vê Geral, Preços (sem custo nem margem),
  // Estoque, Vendas e Foto e ficha, sem editar; Fornecedor é do administrador e do comprador; Fiscal, do administrador.
  // O custo nem chega ao navegador da vendedora (crm_estoque_disponivel devolve o custo só para administrador, gestora e
  // comprador); quem pode ver recebe também a linha do cadastro (crm_estoque), o fornecedor e o fiscal.
  // `ex`: { estoque (linhas de crm_estoque), forn (crm_produto_fornecedor), fornecedores (crm_fornecedores), fiscal
  // (crm_fiscal_produtos), eans ([{codigo, ean}]) } — o que a pessoa não puder ler vem vazio.
  function cadastro(l, ex) {
    ex = ex || {};
    const em = new Map((ex.estoque || []).map(e => [e.codigo, e])), troca = new Map((ex.forn || []).map(x => [x.codigo, x.fornecedor]));
    const fm = new Map((ex.fornecedores || []).map(x => [String(x.codigo), x])), fis = new Map((ex.fiscal || []).map(x => [x.codigo, x]));
    const eans = new Map();
    (ex.eans || []).forEach(x => { const b = base(x.codigo); if (!eans.has(b)) eans.set(b, []); if (eans.get(b).indexOf(x.ean) === -1) eans.get(b).push(x.ean); });
    return (l || []).map(x => {
      const c = em.get(x.codigo) || null, f = fis.get(x.codigo) || null, tr = troca.get(x.codigo);
      const fcod = tr || (c && c.fornecedor_cod ? String(c.fornecedor_cod) : '');
      const fnome = fcod ? ((fm.get(fcod) || {}).nome || (!tr && c && c.fornecedor) || fcod) : '';
      const e = (eans.get(x.codigo) || []).slice();
      if (f && f.gtin && e.indexOf(f.gtin) === -1) e.unshift(f.gtin);
      return Object.assign({}, x, {
        cad: c ? { min: c.estoque_min == null ? null : num(c.estoque_min), max: c.estoque_max == null ? null : num(c.estoque_max), ult_entrada: c.ult_entrada || null,
          ult_saida: c.ult_saida || null, custo_compra: c.custo_compra == null ? null : num(c.custo_compra), localizacao: c.localizacao || '' } : null,
        forn: fcod ? { cod: fcod, nome: fnome, trocado: !!tr } : null, fiscal: ex.fiscal ? f : undefined, ncm: f ? f.ncm || '' : null, eans: e
      });
    });
  }
  const margemDe = (preco, custo) => (num(preco) > 0 && custo != null ? Math.round((num(preco) - num(custo)) / num(preco) * 1000) / 10 : null);
  const noMinimo = x => !!(x.cad && x.cad.min > 0 && x.disponivel <= x.cad.min);
  // Os atalhos da pesquisa (com quantos há em cada um). Os de cadastro só para quem cuida dele (`cuida`); o NCM, só
  // para quem tem o fiscal (`fiscal`).
  const ATALHOS = [
    ['todos', 'Todos', () => true],
    ['estoque', 'Com estoque', x => x.disponivel > 0],
    ['falta', 'Em falta', x => !(x.disponivel > 0)],
    ['vendidos', 'Mais vendidos', x => !!x.maisVendido],
    ['minimo', 'No mínimo', noMinimo, 'cuida'],
    ['semfoto', 'Sem foto', x => !x.foto, 'cuida'],
    ['semforn', 'Sem fornecedor', x => !x.forn, 'cuida'],
    ['semncm', 'Sem NCM', x => x.fiscal !== undefined && !x.ncm, 'fiscal'],
    ['inativos', 'Inativos', x => x.situacao === 'INATIVO', 'cuida']
  ];
  function atalhos(l, quem) {
    quem = quem || {};
    return ATALHOS.filter(a => !a[3] || quem[a[3]]).map(a => ({ id: a[0], nome: a[1], n: (l || []).filter(x => (a[0] === 'inativos' || x.situacao !== 'INATIVO') && a[2](x)).length }));
  }
  // Pesquisa da tela: todas as palavras em qualquer ordem (código, descrição, linha, família, marca, fabricante, código de
  // barras); um número de 8 a 14 dígitos também acha pelo código de barras inteiro. Inativo só no atalho "Inativos".
  function pesquisa(l, f) {
    f = f || {};
    const termos = sem(f.busca).split(/\s+/).filter(Boolean), at = ATALHOS.find(a => a[0] === (f.atalho || 'todos')) || ATALHOS[0];
    const out = (l || []).filter(x => {
      if (at[0] !== 'inativos' && x.situacao === 'INATIVO') return false;
      if (!at[2](x)) return false;
      if (f.linha && x.linha !== f.linha) return false;
      if (f.forn === '__sem' ? x.forn : f.forn && (!x.forn || x.forn.cod !== f.forn)) return false;
      if (!termos.length) return true;
      const t = sem([x.codigo, x.descricao, x.linha, x.familia, x.info && x.info.marca, x.info && x.info.fabricante].concat(x.eans || []).join(' '));
      return termos.every(p => t.indexOf(p) !== -1);
    });
    const nome = (a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR');
    const mg = x => { const m = margemDe(x.preco, x.custo); return m == null ? Infinity : m; };
    const ordem = f.ordem === 'codigo' ? (a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', { numeric: true })
      : f.ordem === 'vendidos' ? (a, b) => b.vendas - a.vendas || nome(a, b)
      : f.ordem === 'estoque' ? (a, b) => b.disponivel - a.disponivel || nome(a, b)
      : f.ordem === 'margem' ? (a, b) => mg(a) - mg(b) || nome(a, b) : nome;
    const q = String(f.busca || '').trim().toUpperCase();
    const exato = x => x.codigo === q || (x.eans || []).indexOf(q) !== -1;
    return out.sort((a, b) => exato(b) - exato(a) || ordem(a, b));
  }
  // Fornecedores para o filtro: os que aparecem nos produtos, em ordem alfabética.
  function fornecedoresDe(l) {
    const m = new Map();
    (l || []).forEach(x => { if (x.forn && !m.has(x.forn.cod)) m.set(x.forn.cod, x.forn.nome); });
    return [...m.entries()].map(([cod, nome]) => ({ cod, nome })).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  }
  // Os selos de situação da linha (lista e cartão).
  function selosDe(x, quem) {
    quem = quem || {};
    const l = [];
    if (x.situacao === 'INATIVO') l.push(['inativo', '']);
    if (!(x.disponivel > 0)) l.push(['em falta', 'vermelho']);
    else if (quem.cuida && noMinimo(x)) l.push(['no mínimo', 'ambar']);
    if (quem.cuida && !x.forn) l.push(['sem fornecedor', 'ambar']);
    if (quem.fiscal && x.fiscal !== undefined && !x.ncm) l.push(['sem NCM', 'vermelho']);
    if (quem.cuida && !x.foto) l.push(['sem foto', 'azul']);
    return l;
  }
  // Anterior e próximo da lista que está na tela (as setas da página do produto, como no FKN).
  function vizinhos(l, cod) {
    const i = (l || []).findIndex(x => x.codigo === cod);
    return { ant: i > 0 ? l[i - 1] : null, prox: i !== -1 && i < l.length - 1 ? l[i + 1] : null, pos: i + 1, total: (l || []).length };
  }
  // Embalagens do produto: a unidade, a caixa fechada (variante ".1" do FKN) e as outras unidades conhecidas (notas de compra).
  function embalagens(x, unidades) {
    const out = [{ unidade: x.unidade || 'UN', fator: 1, codigo: x.codigo, preco: x.preco }];
    if (x.caixa) out.push({ unidade: 'CX', fator: x.caixa.fator, codigo: x.caixa.codigo, preco: x.caixa.preco });
    (unidades || []).forEach(u => { if (!out.some(o => o.unidade === u.unidade)) out.push({ unidade: u.unidade, fator: num(u.fator) || null, codigo: null, preco: null, origem: u.origem }); });
    return out;
  }

  // 21/10/2026 (Anderson: "como eu sei que a ficha foi ou não?"): o que a IA achou além da foto, para os selos e o filtro
  // da conferência. qual: '' todas · 'completo' ficha e FISPQ · 'ficha' com ficha · 'fispq' com FISPQ · 'so-foto' sem as duas.
  const docsDe = inf => ({ ficha: !!(inf && inf.ficha), fispq: !!(inf && inf.fispq) });
  const filtraDocs = (l, qual) => (!qual ? l : l.filter(sg => {
    const d = docsDe(sg.info);
    return qual === 'completo' ? d.ficha && d.fispq : qual === 'ficha' ? d.ficha : qual === 'fispq' ? d.fispq : qual === 'so-foto' ? !d.ficha && !d.fispq : true;
  }));
  const API = { docsDe, filtraDocs, catalogo, estado, filtra, linhas, cadastro, atalhos, pesquisa, fornecedoresDe, selosDe, vizinhos, embalagens, margemDe, noMinimo, paraBuscar, custoEstimado, specsTexto, specsDe, bate, confiavel, textoWhats, CUSTO_PADRAO };
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
  // fotos e fichas (aprovar, completar): também a logística (22/10/2026); custo, fornecedor e a busca em lote ficam com podeFotos
  const cuidaFotos = () => podeFotos() || CRM.ehLogistica();
  const st = () => CRM.store();
  const nome = x => R.nomeDeItem(x.descricao || x.codigo);

  let lista = null, carregando = false, sugs = [], ia = null, lote = null, fornLista = [];
  let dono = null; // o cadastro é do CRM? (crm_sistema.produtos_dono; até a virada vem da listagem do FKN)
  const podeCad = () => CRM.ehAdmin() || CRM.ehComprador() || CRM.ehLogistica(); // cadastra produto (decisão do Anderson, 22/10/2026)
  const custoCad = () => CRM.ehAdmin() || CRM.ehComprador();
  let fotos = null; // Map(codigo → linha de crm_produto_fotos), carregado também sozinho (miniaturas no pedido e no estoque)
  const f = { busca: '', linha: '', soEstoque: true, ordem: 'vendidos', limite: 60 };
  const fl = { ver: 'aprovar', busca: '', quantos: '5', marcados: new Set(), escolha: {}, docs: '' };
  const MOSTRA = 120; // cartões por vez na conferência
  let naTela = new Set(); // códigos dos cartões que estão na tela: "Aprovar as marcadas" só aprova o que se viu

  async function carrega() {
    if (carregando) return;
    carregando = true;
    try {
      const s = st();
      const vazio = () => [], cuidaJa = podeFotos();
      const [disp, fs, infos, vendidos, eans, estoque, forn, fornecedores, fiscal] = await Promise.all([s.estoqueDisponivel(), s.produtoFotos().catch(vazio), s.produtoInfos().catch(vazio),
        s.produtosVendidos(90).catch(vazio), s.produtosEans ? s.produtosEans().catch(vazio) : [],
        cuidaJa ? s.estoque().catch(vazio) : [], cuidaJa ? s.produtoForn().catch(vazio) : [], cuidaJa ? s.fornecedores().catch(vazio) : [],
        CRM.ehAdmin() ? s.fiscalProdutos().catch(() => null) : null]);
      if (podeCad() && s.produtosDono) dono = await s.produtosDono().catch(() => false);
      const cm = CRM.aCaminho ? await CRM.aCaminho.garante() : null;
      fotos = new Map(fs.map(x => [x.codigo, x]));
      fornLista = fornecedores;
      lista = X.cadastro(X.catalogo({ disp, fotos: fs, infos, vendidos }), { eans, estoque, forn, fornecedores, fiscal });
      lista.forEach(x => { x.caminho = (cm && cm.get(x.codigo)) || null; });
      if (cuidaFotos()) {
        [sugs, ia] = await Promise.all([s.produtoSugestoes().catch(() => []), s.produtoBuscar({ acao: 'situacao' }).catch(() => null)]);
        sugs.filter(x => x.situacao === 'sugerida' && !fl.marcados.has(x.codigo) && X.confiavel((x.candidatos || [])[0], (x.info || {}).eans) && !(lista.find(p => p.codigo === x.codigo) || {}).foto).forEach(x => fl.marcados.add(x.codigo));
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

  // O que está a caminho, em texto: o pedido do CRM (quantidade e data) ou, sem ele, a pendência do FKN (sem data).
  const CP = raiz.CRMComprasPedidos;
  const caminhoTexto = x => (x.caminho && CP ? CP.textoCaminho(x.caminho, x.unidade) : num(x.a_caminho) > 0 ? qtd(x.a_caminho) + ' pedidos no FKN (sem data)' : '');
  const caminhoQtd = x => (x.caminho ? x.caminho.falta : num(x.a_caminho));

  // ----------------------------------------------------------------- cartão e catálogo
  function cartao(x, modo) {
    const e = X.estado(x), u = x.foto ? st().fotoUrl(x.foto.caminho) : '';
    return '<article class="pf-cartao">' +
      '<button type="button" class="pf-foto" data-acao="' + (modo === 'tela' ? 'pf-abrir' : 'pf-ficha') + '" data-id="' + esc(x.codigo) + '" aria-label="Ver a ficha de ' + esc(nome(x)) + '">' +
        (u ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : '<span class="pf-sem">sem foto ainda</span>') +
        (x.maisVendido ? '<span class="pf-selo">mais vendido</span>' : '') + '</button>' +
      '<div class="pf-corpo"><strong class="pf-nome">' + esc(nome(x)) + '</strong>' +
        '<small>' + esc(x.codigo) + (x.unidade ? ' · ' + esc(x.unidade) : '') + (x.caixa && x.caixa.fator ? ' · caixa com ' + qtd(x.caixa.fator) : '') + (x.info && x.info.marca ? ' · ' + esc(x.info.marca) : '') + '</small>' +
        '<span class="pf-disp ' + e.cls + '">' + esc(e.texto) + '</span>' +
        (caminhoTexto(x) ? '<small class="pf-caminho' + (x.caminho && x.caminho.atrasado ? ' atrasado' : '') + '">' + esc(caminhoTexto(x)) + '</small>' : '') +
        (x.preco ? '<span class="pf-preco"><small>Tabela A</small> <strong>R$ ' + preco(x.preco) + '</strong>' + (x.caixa && x.caixa.preco ? ' <small>· caixa R$ ' + preco(x.caixa.preco) + '</small>' : '') + '</span>' : '<span class="pf-preco"><small>sem preço de tabela</small></span>') +
        (modo === 'tela' && podeFotos() ? '<span class="chips">' + X.selosDe(x, quem()).map(z => CRM.selo(z[0], z[1])).join('') + '</span>' : '') +
        '<div class="pf-botoes"><button type="button" class="btn sec" data-acao="' + (modo === 'tela' ? 'pf-abrir' : 'pf-ficha') + '" data-id="' + esc(x.codigo) + '">' + (modo === 'tela' ? 'Abrir' : 'Ver ficha') + '</button>' +
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

  // (a tela Produtos fica mais abaixo, depois da ficha)

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
        (cuidaFotos() ? '<div class="pf-ficha-comprador"><small>Só quem cuida do cadastro vê: ' + (x.foto ? 'foto de ' + esc(quando(x.foto.atualizado_em)) + (x.foto.fonte ? ' · ' + esc(x.foto.fonte) : '') : 'sem foto') +
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
          '<div class="caminho"><span>A caminho</span><strong>' + qtd(caminhoQtd(x)) + '</strong><small>' + esc(caminhoTexto(x) || 'nada pedido ao fornecedor') + '</small></div></div>' +
        (CRM.foraDeVendas() ? '' : '<p class="acoes"><a class="btn sec" href="' + esc('https://wa.me/?text=' + encodeURIComponent(X.textoWhats(Object.assign({ nome: nome(x) }, x), u,
          inf.ficha_caminho ? st().fotoUrl(inf.ficha_caminho) : inf.ficha_url || ''))) + '" target="_blank" rel="noopener noreferrer">📲 Mandar foto e preço pelo WhatsApp</a></p>') +
        (inf.descricao ? '<p class="pf-descricao">' + esc(inf.descricao) + '</p>' : '') +
        (pdf(inf.ficha_caminho, inf.ficha_url, 'Ficha técnica') || pdf(inf.fispq_caminho, inf.fispq_url, 'FISPQ') ? '<p class="acoes">' + pdf(inf.ficha_caminho, inf.ficha_url, 'Ficha técnica') + ' ' + pdf(inf.fispq_caminho, inf.fispq_url, 'FISPQ (segurança)') + '</p>' : '') +
        ((inf.especificacoes || []).length ? '<h3>Especificações</h3><table class="tabela pf-specs"><tbody>' + inf.especificacoes.map(s => '<tr><th>' + esc(s.nome) + '</th><td>' + esc(s.valor) + '</td></tr>').join('') + '</tbody></table>' : '') +
        (faixas ? '<h3>Preço por faixa</h3><table class="tabela pf-faixas"><thead><tr><th>Faixa</th><th class="num">Preço</th>' + (x.custo != null ? '<th class="num">Margem</th>' : '') + '</tr></thead><tbody>' + faixas + '</tbody></table>' +
          (x.caixa && x.caixa.preco ? '<p class="dica">Caixa fechada (' + esc(x.caixa.codigo) + '): R$ ' + preco(x.caixa.preco) + ' na tabela A.</p>' : '') : '') +
        '<div class="pf-venda"><div class="pf-quadro"><h3>Venda</h3><p>Últimos 90 dias: <strong>' + (x.vendas ? qtd(x.vendido) + ' ' + esc(x.unidade || 'un') + '</strong> em ' + x.vendas + ' nota(s) · média ' +
          qtd(Math.round(x.vendido / 90 * 10) / 10) + ' por dia' : 'nenhuma venda</strong>') + '</p></div>' +
          '<div class="pf-quadro"><h3>' + (CRM.ehGestor() || podeFotos() ? 'Quem compra' : 'Na sua carteira, quem compra') + '</h3><div data-pf-clientes="' + esc(x.codigo) + '"><p class="dica">Carregando…</p></div></div></div>' +
      '</section></div>';
  }
  let aoEscolher = null; // o pedido aberto que pediu "procurar com foto"
  async function abrirFicha(cod) {
    if (lista === null) await carregaJa();
    const x = prod(cod);
    if (!x) { CRM.toast('Produto ' + cod + ' não está no estoque.', true); return; }
    const incluir = aoEscolher || (CRM.pedidos && CRM.pedidos.incluirItem && !CRM.foraDeVendas() ? c => CRM.pedidos.incluirItem(c) : null);
    CRM.abrirForm({
      titulo: nome(x), largura: 'extra', campos: [], htmlAntes: fichaHTML(x), semFoco: true, extras: form => clientes(form, x.codigo),
      salvarTexto: incluir ? '+ Adicionar ao pedido' : 'Fechar',
      aoSalvar: async () => { if (incluir) { const fn = incluir; aoEscolher = null; await fn(x.codigo); } }
    });
  }
  async function carregaJa() { if (lista === null) { await carrega(); } }
  // "Na sua carteira, quem compra": pelas notas que a pessoa enxerga (a RLS das notas faz a carteira), a última compra primeiro
  async function clientes(form, cod) {
    const el = form.querySelector('[data-pf-clientes]');
    if (!el || !st().produtoClientes) return;
    try {
      const l = await st().produtoClientes(cod, 8);
      el.innerHTML = l.length ? '<ul class="pf-clientes">' + l.map(c => '<li>' + (c.empresa_id ? '<button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(c.empresa_id) + '">' +
          esc((CRM.empresa(c.empresa_id) || {}).nome || c.nome || '—') + '</button>' : esc(c.nome || '—')) + '<small>última compra ' + esc(quando(c.ultima)) + ' · ' + qtd(c.quantidade) + ' em ' + c.notas + ' nota(s)</small></li>').join('') + '</ul>'
        : '<p class="dica">Ninguém ' + (CRM.ehGestor() || podeFotos() ? '' : 'da sua carteira ') + 'comprou ainda pelas notas do CRM.</p>';
    } catch (e) { el.innerHTML = '<p class="dica">Não consegui carregar agora.</p>'; }
  }

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
  async function subir(cod, camera, depois) {
    const arq = await escolheArquivo('image/*', camera);
    if (!arq) return;
    if (!/^image\//.test(arq.type)) { CRM.toast('Escolha uma imagem (foto).', true); return; }
    try { await guardaFoto(cod, arq, camera ? 'foto tirada pelo comprador' : 'enviada pelo comprador', null); CRM.toast('Foto guardada.'); (depois || reabreFicha)(cod); } catch (e) { CRM.falhou(e); }
  }
  const reabreFicha = cod => { const d = document.querySelector('#dlgForm'); if (d && d.open) abrirFicha(cod); else CRM.render(); };

  // ----------------------------------------------------------------- a IA busca; o comprador aprova
  async function buscarUm(cod, busca) {
    const r = await st().produtoBuscar({ acao: 'buscar', codigo: cod, busca: busca || undefined });
    sugs = [r].concat(sugs.filter(s => s.codigo !== cod));
    if (r.situacao === 'sugerida' && X.confiavel((r.candidatos || [])[0], (r.info || {}).eans)) fl.marcados.add(cod);
    return r;
  }
  async function aprovar(cod, o) {
    o = o || {};
    const s = st(), sg = sugs.find(x => x.codigo === cod);
    if (!sg) throw new Error('sem sugestão para ' + cod);
    const i = o.foto != null ? o.foto : (fl.escolha[cod] != null ? fl.escolha[cod] : 0), c = (sg.candidatos || [])[i];
    if (c && i >= 0) await guardaFoto(cod, await s.fotoBaixar(c.caminho), c.site || c.tipo || 'IA', c.pagina || c.url);
    const inf = Object.assign({}, sg.info || {}, o.info || {});
    // PDF que não copia não derruba a aprovação: fica o link do site (21/10/2026)
    const copia = async (arq, nomeArq) => {
      if (!arq || !arq.caminho) return null;
      try { return await s.fotoSubir('fichas', cod + '-' + nomeArq, await s.fotoBaixar(arq.caminho), 'pdf'); } catch (e) { console.warn('pdf', cod, e); return null; }
    };
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

  // 21/10/2026 (Anderson: "todos que você achou já suba para o cadastro e já apareça para os vendedores; não tem como olhar
  // um por um"): aprovar todas de uma vez (a 1ª foto, que já vem a melhor, e a ficha e a FISPQ que a IA achou) e, na busca em
  // lote, aprovar sozinho o que a IA achar. Trocar depois é pelo produto (Ficha → foto, PDFs).
  let aprovando = null;
  async function aprovarTodas(cods) {
    if (aprovando || !cods.length) return;
    aprovando = { total: cods.length, feitos: 0, erros: 0 };
    CRM.render();
    const fila = cods.slice();
    const trabalha = async () => {
      while (fila.length) {
        const c = fila.shift();
        try { await aprovar(c, (prod(c) || {}).foto ? { foto: -1 } : {}); } catch (e) { aprovando.erros++; console.error('aprovar', c, e); }
        aprovando.feitos++;
        if (aprovando.feitos % 10 === 0 || !fila.length) CRM.render();
      }
    };
    await Promise.all([1, 2, 3, 4].map(trabalha));
    const r = aprovando; aprovando = null;
    CRM.toast((r.feitos - r.erros) + ' aprovada(s): já estão no cadastro e as vendedoras veem.' + (r.erros ? ' ' + r.erros + ' deram erro e continuam em "Para aprovar" (é só clicar de novo).' : ''), !!r.erros);
    CRM.render();
  }

  async function rodaLote(codigos) {
    lote = { total: codigos.length, feitos: 0, achou: 0, erros: 0, custo: 0, parar: false, inicio: Date.now(), seguidos: 0 };
    // 20/10/2026: erros seguidos = a chave da IA bateu o limite (ou a API caiu); para em vez de marcar o resto como erro
    const errou = msg => { lote.erros++; if (++lote.seguidos >= 8 && !lote.parar) { lote.parar = true; CRM.toast('A IA parou de responder (' + (msg || 'erros seguidos') + '). Pode ser o limite da chave da Anthropic: confira o limite e o crédito no console e rode de novo; o que já foi achado fica guardado.', true); } };
    CRM.render();
    const fila = codigos.slice();
    const trabalha = async () => {
      while (fila.length && !lote.parar) {
        const cod = fila.shift();
        try {
          const r = await buscarUm(cod); lote.custo += num(r.custo_usd);
          if (r.situacao === 'erro') errou(r.erro); else { lote.seguidos = 0; if (r.situacao === 'sugerida') lote.achou++; }
          if (r.situacao === 'sugerida') { try { await aprovar(cod, (prod(cod) || {}).foto ? { foto: -1 } : {}); } catch (e) { console.error('aprovar', cod, e); } }
        } catch (e) { errou(e.message); if (/503|chave|ligada/i.test(e.message || '')) { lote.parar = true; CRM.toast(e.message, true); } }
        lote.feitos++;
        CRM.render();
      }
    };
    await Promise.all([1, 2, 3, 4, 5].map(trabalha)); // cinco de cada vez (o que der erro, como limite da API, volta no próximo lote)
    const r = lote; lote = null;
    ia = await st().produtoBuscar({ acao: 'situacao' }).catch(() => ia);
    CRM.toast('Busca terminada: ' + r.feitos + ' produto(s), ' + r.achou + ' achado(s) e já no cadastro, custo ' + usd(r.custo) + '.');
    CRM.render();
  }

  // Compras e estoque → Estoque → Fotos e fichas
  function telaFotos() {
    if (lista === null) { setTimeout(carrega, 0); return '<section class="cartao"><p class="vazio">Carregando os produtos…</p></section>'; }
    const ativos = lista.filter(x => x.situacao !== 'INATIVO' || x.disponivel > 0);
    const com = ativos.filter(x => x.foto).length, maisSem = ativos.filter(x => x.maisVendido && !x.foto).length, semFicha = ativos.filter(x => !x.info).length;
    const porSit = s => sugs.filter(x => x.situacao === s);
    const aprovar = porSit('sugerida').filter(x => prod(x.codigo));
    const base = fl.ver === 'aprovar' ? aprovar : fl.ver === 'sem' ? porSit('sem').concat(porSit('recusada')) : porSit(fl.ver);
    const filtrada = X.filtraDocs(base, fl.docs);
    naTela = new Set(fl.ver === 'aprovar' ? filtrada.slice(0, MOSTRA).map(x => x.codigo) : []);
    const opc = [['5', 'Teste: os 5 mais vendidos sem foto'], ['20', 'Os 20 mais vendidos sem foto'], ['50', 'Os 50 mais vendidos sem foto'], ['200', 'Os 200 mais vendidos sem foto'], ['todos', 'Todos sem foto']];
    const n = X.paraBuscar(lista, sugs, fl.quantos === 'todos' ? null : Number(fl.quantos)).length, est = X.custoEstimado(n, sugs);
    const kpi = (t, v, cls) => '<div class="kpi ' + (cls || '') + '"><span>' + esc(t) + '</span><strong>' + v + '</strong></div>';
    return '<div class="kpis">' + kpi('Com foto', com) + kpi('Sem foto', ativos.length - com) + kpi('Mais vendidos sem foto', maisSem, maisSem ? 'vermelho' : 'verde') +
        kpi('Sem ficha', semFicha) + kpi('Para aprovar', aprovar.length, aprovar.length ? 'ambar' : '') + '</div>' +
      (!podeFotos() ? '<section class="cartao pf-lote"><div><h2>Buscar a foto e a ficha de um produto</h2>' +
          '<p>Digite o código ou o nome. A IA procura no site do fabricante a foto, a descrição, as especificações, a ficha técnica e a FISPQ; ' +
          'confira em <strong>Para aprovar</strong> antes de a equipe ver. Pela ficha do produto dá também para subir ou tirar a foto e editar a ficha.</p></div>' +
          '<div class="pf-um"><input type="search" class="of-busca" data-pf-um value="' + esc(fl.busca) + '" placeholder="Um produto só: código ou nome" autocomplete="off" aria-label="Procurar um produto">' +
          '<div data-pf-um-lista>' + umLista() + '</div></div></section>' :
      '<section class="cartao pf-lote"><div><h2>Buscar fotos e fichas em lote</h2>' +
        '<p>A IA procura cada produto pelo nome, pela marca e pelo código de barras, de preferência no site do fabricante: a foto, a descrição, as especificações, a ficha técnica e a FISPQ. ' +
        '<strong>O que a IA achar já entra no cadastro e as vendedoras veem</strong>; para trocar uma foto ou ficha, abra o produto.</p>' +
        '<p class="dica">IA no mês: ' + (ia ? usd(ia.custo_mes) + ' (fotos e fichas: ' + usd(ia.custo_fotos_mes) + ')' : '—') + ' · o limite é o da chave no console da Anthropic · ' +
          (est.medido ? 'custo médio medido: ' + usd(est.medio) + ' por produto (' + est.medido + ' busca(s))' : 'custo por produto ainda não medido (estimativa ' + usd(est.medio) + '): comece pelo teste de 5') + '</p></div>' +
        (lote ? '<div class="pf-andamento" role="status"><strong>Buscando ' + lote.feitos + ' de ' + lote.total + '…</strong> ' + lote.achou + ' com sugestão · ' + usd(lote.custo) + ' até agora' +
            (lote.feitos >= 5 ? ' · faltam uns ' + Math.max(1, Math.round((Date.now() - lote.inicio) / lote.feitos * (lote.total - lote.feitos) / 60000)) + ' min' : '') +
            ' · deixe esta tela aberta e o computador sem dormir ' +
            '<button type="button" class="btn sec" data-acao="pf-lote-parar"' + (lote.parar ? ' disabled' : '') + '>' + (lote.parar ? 'Parando…' : 'Parar') + '</button></div>'
          : '<div class="pf-lote-acao"><label class="filtro-inline">Quais <select data-pf-quantos>' + CRM.opcoesHTML(opc, fl.quantos) + '</select></label>' +
            '<button type="button" class="btn" data-acao="pf-lote"' + (n && ia && ia.ligado ? '' : ' disabled') + '>Buscar ' + n + ' produto(s) · custo estimado ' + usd(est.total) + '</button>' +
            (ia && !ia.ligado ? '<small class="neg">a IA não está ligada (falta a chave nos segredos do Supabase)</small>' : '') + '</div>') +
        '<div class="pf-um"><input type="search" class="of-busca" data-pf-um value="' + esc(fl.busca) + '" placeholder="Um produto só: código ou nome" autocomplete="off" aria-label="Procurar um produto">' +
          '<div data-pf-um-lista>' + umLista() + '</div></div></section>') +
      '<section class="cartao"><div class="chips">' + [['aprovar', 'Para aprovar (' + aprovar.length + ')'], ['aprovada', 'Aprovadas (' + porSit('aprovada').length + ')'],
          ['sem', 'Sem foto achada (' + (porSit('sem').length + porSit('recusada').length) + ')'], ['erro', 'Com erro (' + porSit('erro').length + ')']]
          .map(c => '<button type="button" class="chip-filtro' + (fl.ver === c[0] ? ' ativo' : '') + '" data-acao="pf-ver" data-id="' + c[0] + '">' + esc(c[1]) + '</button>').join('') +
        (fl.ver === 'aprovar' && aprovar.length ? '<span class="flex"></span>' + (aprovando
          ? '<span class="pf-andamento" role="status"><strong>Aprovando ' + aprovando.feitos + ' de ' + aprovando.total + '…</strong> deixe esta tela aberta</span>'
          : (marcadasNaTela() ? '<button type="button" class="btn sec" data-acao="pf-aprovar-marcadas">Aprovar só as marcadas (' + marcadasNaTela() + ')</button> ' : '') +
            '<button type="button" class="btn verde" data-acao="pf-aprovar-todas">✓ Aprovar todas (' + aprovar.length + ')</button>') : '') + '</div>' +
        (base.length ? '<div class="chips pf-docs"><span class="dica">Ficha técnica e FISPQ:</span>' + [['', 'Todas', base.length], ['completo', '📄 Ficha e ⚠ FISPQ', X.filtraDocs(base, 'completo').length],
            ['ficha', 'Com ficha técnica', X.filtraDocs(base, 'ficha').length], ['fispq', 'Com FISPQ', X.filtraDocs(base, 'fispq').length], ['so-foto', 'Só a foto', X.filtraDocs(base, 'so-foto').length]]
          .map(c => '<button type="button" class="chip-filtro' + (fl.docs === c[0] ? ' ativo' : '') + '" data-acao="pf-docs" data-id="' + c[0] + '">' + esc(c[1]) + ' (' + c[2] + ')</button>').join('') + '</div>' : '') +
        listaSugestoes(filtrada) + '</section>';
  }
  const marcadasNaTela = () => [...fl.marcados].filter(c => naTela.has(c)).length;
  function umLista() {
    if (!fl.busca.trim()) return '';
    const l = X.filtra(lista, { busca: fl.busca, ordem: 'vendidos' }).slice(0, 8);
    return l.length ? '<ul class="pf-um-lista">' + l.map(x => '<li>' + miniatura(x.codigo) + '<span><strong>' + esc(nome(x)) + '</strong><small>' + esc(x.codigo) + (x.foto ? ' · tem foto' : '') + (x.info ? ' · tem ficha' : '') + '</small></span>' +
      '<button type="button" class="mini" data-acao="pf-ficha" data-id="' + esc(x.codigo) + '">ficha</button><button type="button" class="btn sec" data-acao="pf-buscar-um" data-id="' + esc(x.codigo) + '">Buscar foto e ficha</button></li>').join('') + '</ul>' : '<p class="vazio">Nada com esse nome.</p>';
  }
  function listaSugestoes(l) {
    if (!l.length) return '<p class="vazio">' + (fl.ver === 'aprovar' ? 'Nada para aprovar agora. Use a busca em lote ou a de um produto só.' : 'Nada aqui.') + '</p>';
    return '<div class="pf-grade pf-sug">' + l.slice(0, MOSTRA).map(sg => {
      const x = prod(sg.codigo) || { codigo: sg.codigo, descricao: sg.codigo }, cs = sg.candidatos || [], esc_ = fl.escolha[sg.codigo] != null ? fl.escolha[sg.codigo] : 0;
      const c = cs[esc_], inf = sg.info || {};
      const marca = fl.ver === 'aprovar' ? '<input type="checkbox" data-pf-marca="' + esc(sg.codigo) + '"' + (fl.marcados.has(sg.codigo) ? ' checked' : '') + ' aria-label="Marcar para aprovar">' : '';
      const ok = [inf.marca ? 'marca ' + inf.marca : '', (inf.especificacoes || []).length ? inf.especificacoes.length + ' especificação(ões)' : '', inf.descricao ? 'descrição' : ''].filter(Boolean);
      const d = X.docsDe(inf), link = a => (a && !a.caminho ? ' (link)' : '');
      const selos = '<div class="pf-selos">' + (d.ficha ? '<span class="selo verde">📄 Ficha técnica' + link(inf.ficha) + '</span>' : '<span class="selo">sem ficha técnica</span>') +
        (d.fispq ? '<span class="selo verde">⚠ FISPQ' + link(inf.fispq) + '</span>' : '<span class="selo">sem FISPQ</span>') + '</div>';
      return '<article class="pf-cartao pf-sug-cartao"><div class="pf-sug-topo">' + marca + '<div><strong>' + esc(nome(x)) + '</strong><small>' + esc(sg.codigo) +
          (c ? ' · ' + esc(X.bate(c, inf.eans) ? 'código de barras bate' : c.mesmo === 'sim' ? 'mesmo produto' : c.mesmo === 'parecido' ? 'parecido: confira' : 'confira o tamanho') : '') + '</small></div></div>' +
        (cs.length ? '<div class="pf-sug-fotos"><button type="button" class="pf-foto grande" data-acao="pf-revisar" data-id="' + esc(sg.codigo) + '"><img src="' + esc(st().fotoUrl(c ? c.caminho : cs[0].caminho)) + '" alt="" loading="lazy"></button>' +
          (cs.length > 1 ? '<div class="pf-sug-outras">' + cs.slice(0, 4).map((k, i) => '<button type="button" class="pf-foto' + (i === esc_ ? ' sel' : '') + '" data-acao="pf-cand" data-id="' + esc(sg.codigo + '|' + i) + '" aria-label="Usar a foto ' + (i + 1) + '"><img src="' + esc(st().fotoUrl(k.caminho)) + '" alt="" loading="lazy"></button>').join('') + '</div>' : '') + '</div>'
          : '<div class="pf-foto"><span class="pf-sem">' + (sg.situacao === 'erro' ? esc(sg.erro || 'erro') : 'nenhuma foto achada') + '</span></div>') +
        '<small>' + esc(c ? (c.site || c.tipo) + (c.largura ? ' · ' + c.largura + '×' + c.altura + ' px' : '') : '') + (ok.length ? (c ? ' · ' : '') + 'achou: ' + esc(ok.join(', ')) : '') + '</small>' +
        selos + (inf.obs ? '<small class="pf-obs">' + esc(inf.obs) + '</small>' : '') +
        '<div class="pf-botoes">' + (sg.situacao === 'sugerida' ? '<button type="button" class="btn sec" data-acao="pf-revisar" data-id="' + esc(sg.codigo) + '">Ver e corrigir</button><button type="button" class="btn sec" data-acao="pf-recusar" data-id="' + esc(sg.codigo) + '">Recusar</button>'
          : '<button type="button" class="btn sec" data-acao="pf-buscar-um" data-id="' + esc(sg.codigo) + '">Buscar de novo</button><button type="button" class="btn sec" data-acao="pf-ficha" data-id="' + esc(sg.codigo) + '">Ficha</button>') + '</div></article>';
    }).join('') + '</div>' + (l.length > MOSTRA ? '<p class="dica">Mostrando ' + MOSTRA + ' de ' + l.length + '. "Aprovar as marcadas" aprova só as que estão na tela; depois aparecem as próximas.</p>' : '');
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
      intro: 'Código ' + cod + (inf.eans && inf.eans.length ? ' · código de barras ' + inf.eans.join(', ') : ' · sem código de barras no cadastro') + (inf.marca ? ' · marca ' + inf.marca : '') +
        '. Escolha a foto que é o mesmo produto (mesma embalagem e tamanho) e corrija o que precisar. Ela fica guardada no CRM e aparece para as vendedoras.',
      htmlAntes: '<div class="pf-rebusca"><label class="campo"><span>A IA procurou por</span><input type="text" data-pf-rebusca value="' + esc(sg.busca || nome(x)) + '"></label>' +
          '<button type="button" class="btn sec" data-acao="pf-buscar-de-novo" data-id="' + esc(cod) + '">Buscar de novo</button></div>' +
        (cs.length ? '<div class="pf-escolha">' + cs.map((c, i) => '<label class="pf-opcao' + (X.bate(c, inf.eans) ? ' bate' : '') + '"><input type="radio" name="foto" value="' + i + '"' + (i === (fl.escolha[cod] || 0) ? ' checked' : '') + '>' +
          '<span class="pf-opcao-foto"><img src="' + esc(st().fotoUrl(c.caminho)) + '" alt="" loading="lazy">' + (X.bate(c, inf.eans) ? '<span class="pf-selo verde">código de barras bate</span>' : '') + '</span>' +
          '<strong>' + esc(c.tipo === 'fabricante' ? 'Site do fabricante' : c.tipo === 'fornecedor' ? 'Site do fornecedor' : 'Loja on-line') + '</strong><small>' + esc((c.site || '') + (c.largura ? ' · ' + c.largura + '×' + c.altura + ' px' : '')) + '</small>' +
          (c.pagina ? '<a href="' + esc(c.pagina) + '" target="_blank" rel="noopener noreferrer">ver a página</a>' : '') + '</label>').join('') +
          '<label class="pf-opcao"><input type="radio" name="foto" value="-1"' + (fl.escolha[cod] === -1 ? ' checked' : '') + '><span class="pf-sem">nenhuma serve (deixar sem foto)</span></label></div>' : '<p class="vazio">A IA não achou foto. Suba uma pelos botões abaixo ou busque de novo com outras palavras.</p>') +
        '<p class="acoes"><button type="button" class="btn sec" data-acao="pf-subir-revisar" data-id="' + esc(cod) + '">Subir foto do computador</button> ' +
          '<button type="button" class="btn sec" data-acao="pf-camera-revisar" data-id="' + esc(cod) + '">Tirar foto com o celular</button>' +
          (x.foto ? ' <small>já tem foto guardada: aprovar com "nenhuma serve" mantém a foto e guarda só a ficha</small>' : '') + '</p>' +
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
    'pf-recarregar': () => { lista = null; det.clear(); if (CRM.aCaminho) CRM.aCaminho.limpa(); carrega(); },
    'pf-mais': () => { f.limite += 60; const c = document.querySelector('#dlgForm[open] [data-pf-lista]'); if (c) c.innerHTML = grade('escolher'); else CRM.render(); },
    'pf-linha': id => { f.linha = f.linha === id ? '' : id; f.limite = 60; const c = document.querySelector('#dlgForm[open] [data-pf-lista]'); if (c) { c.innerHTML = grade('escolher'); c.parentNode.querySelectorAll('[data-acao="pf-linha"]').forEach(b => b.classList.toggle('ativo', b.dataset.id === f.linha)); } else CRM.render(); },
    'pf-ficha': id => abrirFicha(id),
    'pf-pedido': id => { if (CRM.pedidos && CRM.pedidos.incluirItem) CRM.pedidos.incluirItem(id); },
    'pf-escolhe': id => { const fn = aoEscolher; aoEscolher = null; const d = document.querySelector('#dlgForm'); if (d && d.open) d.close(); if (fn) fn(id); },
    'pf-ir-fotos': () => { if (CRM.estoqueVer) CRM.estoqueVer('fotos'); },
    'pf-subir': id => subir(id, false),
    // dentro da conferência da sugestão: a foto do comprador vale e a ficha da IA ainda pode ser aprovada
    'pf-subir-revisar': id => subir(id, false, c => { fl.escolha[c] = -1; revisar(c); }),
    'pf-camera-revisar': id => subir(id, true, c => { fl.escolha[c] = -1; revisar(c); }),
    'pf-buscar-de-novo': async id => {
      const i = document.querySelector('#dlgForm [data-pf-rebusca]'), busca = i ? i.value.trim() : '';
      const d = document.querySelector('#dlgForm'); if (d && d.open) d.close();
      CRM.toast('A IA está procurando de novo (de 30 segundos a 2 minutos)…');
      try {
        const r = await buscarUm(id, busca);
        ia = await st().produtoBuscar({ acao: 'situacao' }).catch(() => ia);
        fl.escolha[id] = 0; CRM.render();
        if (r.situacao === 'sugerida') revisar(id); else CRM.toast(r.situacao === 'erro' ? 'Não deu: ' + (r.erro || 'erro') : 'A IA não achou nada com essas palavras.', r.situacao === 'erro');
      } catch (e) { CRM.falhou(e); }
    },
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
        const custo = podeFotos() ? ' (custo ' + usd(r.custo_usd) + ')' : '';
        if (r.situacao === 'sugerida') { CRM.toast('Achou: confira e aprove' + custo + '.'); fl.ver = 'aprovar'; CRM.render(); revisar(id); }
        else { CRM.toast(r.situacao === 'erro' ? 'Não deu: ' + (r.erro || 'erro') : 'A IA não achou foto nem ficha deste produto' + custo + '.', r.situacao === 'erro'); CRM.render(); }
      } catch (e) { CRM.falhou(e); }
    },
    'pf-lote': () => {
      const cods = X.paraBuscar(lista, sugs, fl.quantos === 'todos' ? null : Number(fl.quantos)), est = X.custoEstimado(cods.length, sugs);
      if (!cods.length) return;
      if (!confirm('Mandar a IA procurar ' + cods.length + ' produto(s)?\nCusto estimado: ' + usd(est.total) + ' (já usado no mês: ' + usd(ia && ia.custo_mes) + '; confira se o limite da chave no console da Anthropic cobre).\nDeixe esta tela aberta até terminar.')) return;
      rodaLote(cods).catch(CRM.falhou);
    },
    'pf-lote-parar': () => { if (lote) { lote.parar = true; CRM.render(); } },
    'pf-ver': id => { fl.ver = id; CRM.render(); },
    'pf-docs': id => { fl.docs = id || ''; CRM.render(); },
    'pf-aprovar-todas': () => {
      const cods = sugs.filter(x => x.situacao === 'sugerida' && prod(x.codigo)).map(x => x.codigo);
      if (!cods.length || !confirm('Aprovar as ' + cods.length + ' sugestões de uma vez?\n\nA foto (a 1ª de cada uma), a descrição, a ficha técnica e a FISPQ que a IA achou vão para o cadastro e as vendedoras já veem. Dá para trocar depois, em cada produto.\n\nLeva alguns minutos: deixe esta tela aberta.')) return;
      aprovarTodas(cods);
    },
    'pf-cand': id => { const [cod, i] = id.split('|'); fl.escolha[cod] = Number(i); CRM.render(); },
    'pf-revisar': id => revisar(id),
    'pf-recusar': async id => { try { await st().sugestaoMarcar(id, 'recusada'); const s = sugs.find(x => x.codigo === id); if (s) s.situacao = 'recusada'; fl.marcados.delete(id); CRM.render(); } catch (e) { CRM.falhou(e); } },
    'pf-aprovar-marcadas': async () => {
      const cods = [...fl.marcados].filter(c => naTela.has(c) && sugs.some(s => s.codigo === c && s.situacao === 'sugerida'));
      if (!cods.length || !confirm('Aprovar ' + cods.length + ' produto(s) com a foto escolhida e a ficha que a IA achou?')) return;
      let ok = 0;
      for (const c of cods) { try { await aprovar(c); ok++; } catch (e) { CRM.toast(c + ': ' + (e.message || e), true); } }
      CRM.toast(ok + ' aprovado(s). As vendedoras já veem.');
      CRM.render();
    }
  });

  // ----------------------------------------------------------------- tela Produtos (20/10/2026, simulação aprovada)
  // Pesquisa em lista ou grade (cada pessoa escolhe; o CRM lembra) e a página do produto em abas. A vendedora começa na
  // grade; o administrador, a gestora e o comprador, na lista.
  const quem = () => ({ cuida: podeFotos(), fiscal: CRM.ehAdmin() });
  const veCusto = () => CRM.ehGestor() || CRM.ehComprador();
  const pc = { busca: '', linha: '', forn: '', atalho: 'todos', ordem: 'nome', limite: 100, aberto: null, aba: 'geral' };
  const det = new Map(); // código → o que só o administrador e o comprador veem (saldo, custo, compras, embalagens, movimentos)
  const chaveModo = () => 'crm_produtos_modo_' + (CRM.meuId ? CRM.meuId() : '');
  function modo() {
    let m = null;
    try { m = raiz.localStorage.getItem(chaveModo()); } catch (e) { /* sem armazenamento: o padrão */ }
    return m === 'lista' || m === 'grade' ? m : (CRM.papel() === 'vendedor' ? 'grade' : 'lista');
  }
  const visiveis = () => X.pesquisa(lista, pc);
  const dataBR = iso => (iso ? R.dataBR(String(iso).slice(0, 10)) : '—');
  const pct = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');
  const emb = x => (x.unidade || 'UN') + (x.caixa && x.caixa.fator ? ' · CX c/ ' + qtd(x.caixa.fator) : '');
  const selos = x => X.selosDe(x, quem()).map(z => CRM.selo(z[0], z[1])).join(' ');

  function atalhosHTML() {
    const base0 = lista.filter(x => (!pc.linha || x.linha === pc.linha) && (!pc.forn || (pc.forn === '__sem' ? !x.forn : x.forn && x.forn.cod === pc.forn)));
    const nb = X.pesquisa(base0, { busca: pc.busca, atalho: 'inativos' }).length;
    return X.atalhos(X.pesquisa(base0, { busca: pc.busca, atalho: 'todos' }).concat(nb ? X.pesquisa(base0, { busca: pc.busca, atalho: 'inativos' }) : []), quem())
      .map(a => '<button type="button" class="chip-filtro' + (pc.atalho === a.id ? ' ativo' : '') + '" data-acao="pc-atalho" data-id="' + a.id + '" aria-pressed="' + (pc.atalho === a.id) + '">' + esc(a.nome) + ' <small>' + a.n + '</small></button>').join('');
  }
  function barra() {
    const ls = X.linhas(lista), fs = X.fornecedoresDe(lista), m = modo();
    const ordens = [['nome', 'Descrição (A–Z)'], ['codigo', 'Código'], ['vendidos', 'Mais vendidos'], ['estoque', 'Mais estoque']].concat(veCusto() ? [['margem', 'Menor margem']] : []);
    return '<div class="pc-barra">' +
      '<label class="pc-pesquisa"><span class="sr">Pesquisar produto</span><input type="search" data-pc-busca value="' + esc(pc.busca) + '" placeholder="Código, descrição ou código de barras (pode bipar)" autocomplete="off" aria-label="Pesquisar produto"><small>Enter abre o 1º</small></label>' +
      '<label class="campo"><span>Linha</span><select data-pc-linha>' + CRM.opcoesHTML([['', 'Todas']].concat(R.ordemAlfa(ls, l => l.nome).map(l => [l.nome, R.nomeDeItem(l.nome)])), pc.linha) + '</select></label>' +
      (podeFotos() ? '<label class="campo"><span>Fornecedor</span><select data-pc-forn>' + CRM.opcoesHTML([['', 'Todos']].concat(fs.map(f => [f.cod, f.nome])).concat([['__sem', '(sem fornecedor)']]), pc.forn) + '</select></label>' : '') +
      '<label class="campo"><span>Ordem</span><select data-pc-ordem>' + CRM.opcoesHTML(ordens, pc.ordem) + '</select></label></div>' +
      '<div class="pc-barra2"><div class="chips" data-pc-atalhos>' + atalhosHTML() + '</div><span class="flex"></span><span class="dica" data-pc-conta></span>' +
      '<div class="pc-modo" role="group" aria-label="Como mostrar"><button type="button" class="mini' + (m === 'lista' ? ' ativo' : '') + '" data-acao="pc-modo" data-id="lista" aria-pressed="' + (m === 'lista') + '">☰ Lista</button>' +
        '<button type="button" class="mini' + (m === 'grade' ? ' ativo' : '') + '" data-acao="pc-modo" data-id="grade" aria-pressed="' + (m === 'grade') + '">▦ Grade</button></div></div>';
  }
  function tabelaLista(l) {
    const cuida = podeFotos(), vc = veCusto();
    return '<div class="cartao pc-lista"><div class="tabela-rolagem"><table class="tabela pc-tabela"><thead><tr><th><span class="sr">Foto</span></th><th>Código</th><th>Descrição</th><th>Linha</th>' +
      (cuida ? '<th>Fornecedor</th>' : '') + '<th>Embalagem</th><th class="num">Disponível</th><th class="num">Preço A</th>' + (vc ? '<th class="num">Margem</th>' : '') + '<th>Situação</th></tr></thead><tbody>' +
      l.map(x => {
        const mg = vc ? X.margemDe(x.preco, x.custo) : null, mmin = P ? P.margemMinima(CRM.estado.cfg) : 23;
        return '<tr class="pc-linha" data-acao="pf-abrir" data-id="' + esc(x.codigo) + '"><td>' + miniatura(x.codigo) + '</td><td class="num-cod">' + esc(x.codigo) + '</td>' +
          '<td><button type="button" class="link" data-acao="pf-abrir" data-id="' + esc(x.codigo) + '">' + esc(nome(x)) + '</button>' + (x.info && x.info.marca ? '<small>' + esc(x.info.marca) + '</small>' : '') + '</td>' +
          '<td>' + esc(x.linha ? R.nomeDeItem(x.linha) : '—') + '</td>' + (cuida ? '<td>' + esc(x.forn ? R.nomeDeItem(x.forn.nome) : '—') + '</td>' : '') + '<td>' + esc(emb(x)) + '</td>' +
          '<td class="num' + (x.disponivel > 0 ? '' : ' neg') + '">' + qtd(Math.floor(x.disponivel * 1000) / 1000) + '</td><td class="num"><strong>' + (x.preco ? preco(x.preco) : '—') + '</strong></td>' +
          (vc ? '<td class="num' + (mg != null && mg < mmin ? ' neg' : '') + '">' + pct(mg) + '</td>' : '') + '<td>' + selos(x) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  function resultado() {
    const l = visiveis(), lim = pc.limite;
    if (!l.length) return '<div class="cartao"><p class="vazio">Nenhum produto' + (pc.busca ? ' com "' + esc(pc.busca) + '"' : '') + ' aqui. Tente parte do nome (luva, copo, saco), o código ou o código de barras.</p></div>';
    return (modo() === 'grade' ? '<div class="pf-grade">' + l.slice(0, lim).map(x => cartao(x, 'tela')).join('') + '</div>' : tabelaLista(l.slice(0, lim))) +
      (l.length > lim ? '<p class="acoes"><button type="button" class="btn sec" data-acao="pc-mais">Mostrar mais (' + (l.length - lim) + ')</button></p>' : '');
  }
  const contagem = () => { const n = visiveis().length, t = lista.filter(x => x.situacao !== 'INATIVO').length; return n + ' de ' + t.toLocaleString('pt-BR') + ' produtos'; };

  // ----------------------------------------------------------------- página do produto
  const ABAS_PROD = () => [['geral', 'Geral'], ['precos', 'Preços'], ['estoque', 'Estoque'], ['vendas', 'Vendas']]
    .concat(CRM.ehAdmin() ? [['fiscal', 'Fiscal']] : []).concat(podeFotos() ? [['fornecedor', 'Fornecedor']] : []).concat([['foto', 'Foto e ficha']]);
  const dl = pares => '<dl class="dados pc-dados">' + pares.filter(Boolean).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + (v == null || v === '' ? '—' : esc(v)) + '</dd>').join('') + '</dl>';
  function pagina(x) {
    const viz = X.vizinhos(visiveis(), x.codigo), u = x.foto ? st().fotoUrl(x.foto.caminho) : '', inf = x.info || {}, d = det.get(x.codigo) || {};
    const abas = ABAS_PROD(); if (!abas.some(a => a[0] === pc.aba)) pc.aba = 'geral';
    const vc = veCusto() && x.custo != null, mg = vc ? X.margemDe(x.preco, x.custo) : null, sg = sugs.find(z => z.codigo === x.codigo && z.situacao === 'sugerida');
    const corpo = { geral: abaGeral, precos: abaPrecos, estoque: abaEstoque, vendas: abaVendas, fiscal: abaFiscal, fornecedor: abaFornecedor, foto: abaFoto }[pc.aba](x, d);
    return '<div class="pc-nav"><button type="button" class="link" data-acao="pc-voltar">‹ Voltar à pesquisa</button><span class="flex"></span>' +
        (viz.ant ? '<button type="button" class="link" data-acao="pf-abrir" data-id="' + esc(viz.ant.codigo) + '">‹ ' + esc(viz.ant.codigo) + ' ' + esc(nome(viz.ant)) + '</button>' : '') +
        (viz.pos ? '<small>' + viz.pos + ' de ' + viz.total + '</small>' : '') +
        (viz.prox ? '<button type="button" class="link" data-acao="pf-abrir" data-id="' + esc(viz.prox.codigo) + '">' + esc(viz.prox.codigo) + ' ' + esc(nome(viz.prox)) + ' ›</button>' : '') + '</div>' +
      '<section class="cartao pc-topo"><div class="pc-foto">' + (u ? '<img src="' + esc(u) + '" alt="' + esc(nome(x)) + '">' : '<span class="pf-sem">sem foto ainda</span>') + '</div>' +
        '<div class="pc-titulo"><div class="chips">' + CRM.selo(x.situacao === 'INATIVO' ? 'inativo' : 'ativo', x.situacao === 'INATIVO' ? '' : 'verde') + (x.maisVendido ? ' ' + CRM.selo('mais vendido', 'azul') : '') +
          (cuidaFotos() && sg ? ' ' + CRM.selo('foto da IA para aprovar', 'azul') : '') + ' ' + selos(x) + '</div>' +
          '<h1>' + esc(nome(x)) + '</h1><p class="sub">Código <strong>' + esc(x.codigo) + '</strong>' + ((x.eans || []).length ? ' · código de barras <strong>' + esc(x.eans[0]) + '</strong>' : '') +
          ' · ' + esc(emb(x)) + (x.linha ? ' · ' + esc(R.nomeDeItem(x.linha)) : '') + (inf.marca ? ' · marca ' + esc(inf.marca) : '') + '</p>' +
          '<p class="acoes">' + (!CRM.foraDeVendas() && CRM.pedidos && CRM.pedidos.incluirItem ? '<button type="button" class="btn" data-acao="pf-pedido" data-id="' + esc(x.codigo) + '">+ Pedido</button> ' : '') +
            (!CRM.foraDeVendas() ? '<a class="btn sec" href="' + esc('https://wa.me/?text=' + encodeURIComponent(X.textoWhats(Object.assign({ nome: nome(x) }, x), u, inf.ficha_caminho ? st().fotoUrl(inf.ficha_caminho) : inf.ficha_url || ''))) + '" target="_blank" rel="noopener noreferrer">📲 Mandar foto e preço pelo WhatsApp</a> ' : '') +
            (podeCad() && dono ? '<button type="button" class="btn sec" data-acao="pc-editar" data-id="' + esc(x.codigo) + '">Editar o cadastro</button> ' : '') +
            (cuidaFotos() ? '<button type="button" class="btn sec" data-acao="pf-info-editar" data-id="' + esc(x.codigo) + '">Editar a ficha</button>' : '') + '</p></div>' +
        '<div class="kpis pc-kpis"><div class="kpi' + (x.disponivel > 0 ? '' : ' alerta') + '"><span>Disponível</span><strong>' + qtd(Math.floor(x.disponivel * 1000) / 1000) + '</strong><small>' + esc(x.unidade || '') + '</small></div>' +
          (caminhoQtd(x) > 0 ? '<div class="kpi' + (x.caminho && x.caminho.atrasado ? ' alerta' : '') + '"><span>A caminho</span><strong>' + qtd(caminhoQtd(x)) + '</strong><small>' + esc(caminhoTexto(x)) + '</small></div>' : '') +
          '<div class="kpi verde"><span>Preço A</span><strong>' + (x.preco ? 'R$ ' + preco(x.preco) : '—') + '</strong><small>tabela Padrão</small></div>' +
          (vc ? '<div class="kpi"><span>Custo</span><strong>R$ ' + preco(x.custo) + '</strong><small>do cadastro</small></div><div class="kpi"><span>Margem na A</span><strong>' + pct(mg) + '</strong><small>mínima ' + pct(P ? P.margemMinima(CRM.estado.cfg) : 23) + '</small></div>' : '') +
        '</div></section>' +
      '<section class="cartao"><div class="pc-abas" role="group" aria-label="Abas do produto">' + abas.map(a => '<button type="button" class="' + (pc.aba === a[0] ? 'ativo' : '') + '" data-acao="pc-aba" data-id="' + a[0] + '" aria-pressed="' + (pc.aba === a[0]) + '">' + esc(a[1]) + '</button>').join('') + '</div>' +
        '<div class="pc-corpo">' + corpo + '</div></section>';
  }
  function abaGeral(x, d) {
    const inf = x.info || {}, cuida = podeFotos(), es = X.embalagens(x, d.unidades);
    return '<div class="pc-colunas"><div><h3>Identificação</h3>' + dl([['Código', x.codigo], ['Situação', x.situacao === 'INATIVO' ? 'Inativo' : 'Ativo'], ['Descrição (na nota)', x.descricao],
        ['Unidade', x.unidade], ['Linha', x.linha ? R.nomeDeItem(x.linha) : ''], ['Família', x.familia && !/^0+$/.test(x.familia) ? R.nomeDeItem(String(x.familia).replace(/^\d+\s*/, '')) : ''],
        ['Marca', inf.marca], ['Fabricante', inf.fabricante], ['Código de barras', (x.eans || []).join(', ')], cuida ? ['Localização no galpão', (x.cad && x.cad.localizacao) || x.localizacao] : null]) + '</div>' +
      '<div><h3>Embalagens</h3><div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Embalagem</th><th class="num">Contém</th><th>Código</th><th class="num">Preço A</th></tr></thead><tbody>' +
        es.map(e => '<tr><td>' + esc(e.unidade) + '</td><td class="num">' + (e.fator ? qtd(e.fator) + ' ' + esc(x.unidade || '') : '—') + '</td><td>' + esc(e.codigo || (e.origem === 'manual' ? 'acertada no CRM' : 'das notas de compra')) + '</td><td class="num">' + (e.preco ? 'R$ ' + preco(e.preco) : '—') + '</td></tr>').join('') +
        '</tbody></table></div>' + (cuida || podeCad() ? '<p class="acoes"><button type="button" class="mini" data-acao="pc-emb" data-id="' + esc(x.codigo) + '">+ Embalagem</button></p>' : '') +
        (x.caixa ? '<p class="dica">No FKN a caixa é outro código (' + esc(x.caixa.codigo) + '); aqui fica no mesmo produto, e o estoque é um só.</p>' : '') + '</div>' +
      '<div><h3>Para a vendedora</h3>' + (inf.descricao ? '<p class="pf-descricao">' + esc(inf.descricao) + '</p>' : '<p class="vazio">Sem descrição ainda' + (cuida ? ': vem da ficha aprovada em Fotos e fichas, ou em "Editar a ficha".' : '.') + '</p>') +
        ((inf.especificacoes || []).length ? '<table class="tabela pf-specs"><tbody>' + inf.especificacoes.map(z => '<tr><th>' + esc(z.nome) + '</th><td>' + esc(z.valor) + '</td></tr>').join('') + '</tbody></table>' : '') + '</div></div>' +
      (dono ? '<p class="dica">O cadastro é do CRM: descrição, unidade, preço, mínimo, NCM e fornecedor mudam em "Editar o cadastro" (cada alteração fica guardada com quem fez e quando).</p>'
        : '<p class="dica">Descrição, unidade, linha, preço e mínimo vêm da listagem do FKN e mudam lá enquanto ele for o cadastro principal.' + (cuida ? ' No CRM: a ficha (foto, descrição, especificações, PDFs), o fornecedor e as embalagens.' : '') + '</p>');
  }
  function abaPrecos(x, d) {
    const tab = P ? P.tabelaDe(CRM.estado.cfg) : null, vc = veCusto() && x.custo != null, mmin = P ? P.margemMinima(CRM.estado.cfg) : 23;
    if (!tab || !x.preco) return '<p class="vazio">Este produto não tem preço de tabela no FKN.</p>';
    const fx = P.FAIXAS.filter(f => tab[f] != null).sort((a, b) => tab[a] - tab[b]);
    const cx = x.caixa && x.caixa.preco ? x.caixa : null;
    let h = '<div class="pc-colunas"><div><h3>Tabelas de preço <small>tabela Padrão, como no FKN</small></h3><div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Tabela</th><th class="num">Acréscimo</th><th class="num">Preço</th>' +
      (cx ? '<th class="num">Caixa</th>' : '') + (vc ? '<th class="num">Margem</th>' : '') + '</tr></thead><tbody>' +
      fx.map(f => { const pr = P.precoDaFaixa(x.preco, f, tab), m = vc ? X.margemDe(pr, x.custo) : null;
        return '<tr><td><strong>' + esc(P.rotuloFaixa(f)) + '</strong></td><td class="num">' + (tab[f] ? (tab[f] > 0 ? '+' : '') + tab[f] + '%' : 'base') + '</td><td class="num"><strong>R$ ' + preco(pr) + '</strong></td>' +
          (cx ? '<td class="num">R$ ' + preco(P.precoDaFaixa(cx.preco, f, tab)) + '</td>' : '') + (vc ? '<td class="num' + (m != null && m < mmin ? ' neg' : '') + '">' + pct(m) + '</td>' : '') + '</tr>'; }).join('') +
      '</tbody></table></div><p class="dica">' + (vc ? 'Abaixo de ' + pct(mmin) + ' de margem o pedido fica bloqueado até a gestora ou a logística liberar.' : 'A comissão sai pela faixa do preço praticado. Abaixo da tabela A o pedido pode ficar bloqueado até a gestora ou a logística liberar.') + '</p></div>';
    if (vc) {
      const s0 = d.saldo, c = x.cad;
      h += '<div><h3>Custo</h3>' + dl([['Custo do cadastro', 'R$ ' + preco(x.custo)], s0 && s0.custo_medio != null ? ['Custo médio (livro do estoque)', 'R$ ' + preco(s0.custo_medio)] : null,
          c && c.custo_compra != null ? ['Último custo de compra (FKN)', 'R$ ' + preco(c.custo_compra)] : null]) +
        (podeFotos() ? '<h3>Histórico do custo</h3>' + (d.carregando ? '<p class="dica">Carregando…</p>' : (d.hist || []).length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Quando</th><th class="num">De</th><th class="num">Para</th></tr></thead><tbody>' +
          d.hist.map(z => '<tr><td>' + esc(dataBR(z.em)) + '</td><td class="num">R$ ' + preco(z.custo_de) + '</td><td class="num">R$ ' + preco(z.custo_para) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="vazio">O custo não mudou desde que o CRM começou a acompanhar.</p>') : '') + '</div>';
    }
    return h + '</div>';
  }
  function abaEstoque(x, d) {
    const e = X.estado(x), c = x.cad, cuida = podeFotos(), porDia = num(x.vendido) / 90;
    const k = (t, v, sub, cls) => '<div class="kpi ' + (cls || '') + '"><span>' + esc(t) + '</span><strong>' + v + '</strong>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
    return '<div class="kpis">' + k('Físico', qtd(x.fisico), x.unidade || '') + k('Reservado', qtd(x.reservado), 'em pedidos abertos') + k('Disponível', qtd(Math.floor(x.disponivel * 1000) / 1000), e.cls === 'falta' ? 'em falta' : e.dias ? 'pouco: dura ~' + e.dias + ' dia(s)' : 'para vender agora', e.cls === 'falta' ? 'alerta' : 'verde') +
        k('A caminho', qtd(caminhoQtd(x)), caminhoTexto(x) || 'nada pedido ao fornecedor', x.caminho && x.caminho.atrasado ? 'alerta' : '') + (cuida && c ? k('Mínimo / máximo', qtd(c.min) + ' / ' + (c.max ? qtd(c.max) : '—'), 'do FKN', X.noMinimo(x) ? 'alerta' : '') : '') +
        k('Venda por dia', porDia ? qtd(Math.round(porDia * 10) / 10) : '0', 'média dos últimos 90 dias') + '</div>' +
      (x.caminho && x.disponivel < 0 ? '<p class="dica">Depois que chegar: <strong>' + qtd(Math.max(x.disponivel + x.caminho.falta, 0)) + ' ' + esc(x.unidade || '') + ' livres para vender</strong> (' +
        qtd(x.caminho.falta) + ' a caminho − ' + qtd(-x.disponivel) + ' já vendidos).</p>' : '') +
      (x.caixa ? '<p class="dica">Caixa fechada (' + esc(x.caixa.codigo) + (x.caixa.fator ? ', ' + qtd(x.caixa.fator) + ' ' + esc(x.unidade || '') : '') + '): ' + qtd(Math.floor(num(x.caixa.disponivel) * 1000) / 1000) + ' disponível(is).</p>' : '') +
      (cuida ? (c ? dl([['Última entrada', dataBR(c.ult_entrada)], ['Última saída', dataBR(c.ult_saida)]]) : '') +
        '<h3>Últimos movimentos <small>do livro do estoque</small></h3>' + (d.carregando ? '<p class="dica">Carregando…</p>' : (d.movs || []).length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Quando</th><th>Tipo</th><th class="num">Qtd.</th><th>Detalhe</th></tr></thead><tbody>' +
          d.movs.map(m => '<tr><td>' + esc(dataBR(m.quando)) + '</td><td>' + esc(((raiz.CRMEstoque || {}).TIPOS || {})[m.tipo] || m.tipo) + '</td><td class="num">' + (m.quantidade > 0 ? '+' : '') + qtd(m.quantidade) + '</td><td>' + esc(m.motivo || '') + '</td></tr>').join('') +
          '</tbody></table></div><p class="acoes"><button type="button" class="mini" data-acao="es-movs" data-id="' + esc(x.codigo) + '">Ver todos os movimentos</button></p>' : '<p class="vazio">Nenhum movimento no livro do estoque.</p>') : '');
  }
  function abaVendas(x) {
    return '<div class="pc-colunas"><div><h3>Vendido</h3>' + dl([['Últimos 90 dias', x.vendas ? qtd(x.vendido) + ' ' + (x.unidade || 'un') + ' em ' + x.vendas + ' nota(s)' : 'nenhuma venda'],
        ['Média por dia', qtd(Math.round(num(x.vendido) / 90 * 10) / 10)], ['Curva', x.maisVendido ? 'entre os mais vendidos' : '—']]) + '</div>' +
      '<div><h3>' + (CRM.ehGestor() || podeFotos() ? 'Quem compra' : 'Na sua carteira, quem compra') + '</h3><div data-pf-clientes="' + esc(x.codigo) + '"><p class="dica">Carregando…</p></div></div></div>';
  }
  const ROT_REGRA = { cfop: 'CFOP', cst_icms: 'CST do ICMS', aliq_icms: 'Alíquota do ICMS (%)', red_bc_icms: 'Redução da base do ICMS (%)', cst_pis: 'CST do PIS', aliq_pis: 'Alíquota do PIS (%)',
    cst_cofins: 'CST da COFINS', aliq_cofins: 'Alíquota da COFINS (%)', mva: 'MVA (%)', cst_ipi: 'CST do IPI', aliq_ipi: 'Alíquota do IPI (%)' };
  function abaFiscal(x) {
    const f = x.fiscal;
    if (!f) return '<p class="vazio">Sem regra fiscal ainda: ela nasce da leitura das notas (aba Fiscal).</p><p class="acoes"><button type="button" class="btn sec" data-acao="pc-ir-fiscal">Abrir a aba Fiscal</button></p>';
    const ncm = String(f.ncm || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
    const regras = Object.entries(f.regra || {}).filter(([, v]) => v && typeof v === 'object');
    return '<div class="pc-colunas"><div>' + dl([['NCM', ncm], ['CEST', f.cest], ['Código de barras', f.gtin], ['Origem', f.origem === '0' ? '0 – Nacional' : f.origem],
        ['Situação', f.situacao === 'conferido' ? 'conferida' : f.situacao === 'proposta' ? 'proposta (falta o de acordo do contador)' : f.situacao], f.conferido_em ? ['Conferida em', dataBR(f.conferido_em)] : null]) +
        ((f.alertas || []).length ? '<ul class="pc-alertas">' + f.alertas.map(a => '<li>' + esc(typeof a === 'string' ? a : a.texto || a.msg || JSON.stringify(a)) + '</li>').join('') + '</ul>' : '') + '</div>' +
      regras.map(([k, v]) => '<div><h3>Regra: ' + esc(k.replace(/_/g, ' ')) + '</h3>' + dl(Object.entries(v).map(([kk, vv]) => [ROT_REGRA[kk] || kk.replace(/_/g, ' '), vv == null ? '' : String(vv).replace('.', ',')])) + '</div>').join('') + '</div>' +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="pc-ir-fiscal">Abrir a aba Fiscal</button></p>';
  }
  function abaFornecedor(x, d) {
    const fo = x.forn, cad = fo ? (fornLista || []).find(z => String(z.codigo) === String(fo.cod)) : null;
    const cu = i => { const q = num(i.quantidade) * (num(i.fator) || 1); return q > 0 ? (num(i.valor_total) + num(i.ipi) + num(i.st) + num(i.frete) + num(i.outras)) / q : null; };
    return '<div class="pc-colunas"><div><h3>Fornecedor</h3>' + (fo ? dl([['Fornecedor', R.nomeDeItem(fo.nome)], ['Código', fo.cod], ['De onde', fo.trocado ? 'definido no CRM' : 'do cadastro do FKN']]) : '<p class="vazio">Sem fornecedor: diga de quem se compra.</p>') +
        '<p class="acoes"><button type="button" class="btn sec" data-acao="pc-forn" data-id="' + esc(x.codigo) + '">' + (fo ? 'Trocar o fornecedor' : 'Definir o fornecedor') + '</button></p></div>' +
      '<div><h3>Cadastro do fornecedor</h3>' + (cad ? dl([['Prazo de entrega', cad.prazo_dias != null ? cad.prazo_dias + ' dia(s)' : ''], ['Pedido mínimo', cad.pedido_minimo != null ? R.moeda(cad.pedido_minimo) : ''],
          ['Frete', cad.frete === 'cif' ? 'CIF' : cad.frete === 'fob' ? 'FOB' : cad.frete === 'cif_acima' ? 'CIF acima de ' + R.moeda(cad.frete_cif_acima) : cad.frete], ['Dias de pedido', (cad.dias_pedido || []).map(n => ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][n]).join(', ')],
          ['Pagamento', cad.pagamento], ['Contato', [cad.contato, cad.telefone, cad.email].filter(Boolean).join(' · ')]]) : '<p class="vazio">Sem prazo, mínimo e frete cadastrados (Compras → Fornecedores).</p>') + '</div></div>' +
      '<h3>Últimas compras <small>pelas notas de compra</small></h3>' + (d.carregando ? '<p class="dica">Carregando…</p>' : (d.compras || []).length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Data</th><th>Nota</th><th>Fornecedor</th><th class="num">Quantidade</th><th class="num">Custo un.</th></tr></thead><tbody>' +
        d.compras.map(i => '<tr><td>' + esc(dataBR(i.emitida_em)) + '</td><td>' + esc(i.numero || '') + '</td><td>' + esc(R.nomeDeItem(i.fornecedor_nome || '')) + '</td><td class="num">' + qtd(num(i.quantidade) * (num(i.fator) || 1)) + ' ' + esc(x.unidade || '') + '</td><td class="num">' + (cu(i) != null ? 'R$ ' + preco(cu(i)) : '—') + '</td></tr>').join('') +
        '</tbody></table></div><p class="dica">Custo unitário com IPI, ST, frete e outras despesas da nota.</p>' : '<p class="vazio">Nenhuma nota de compra deste produto no CRM ainda.</p>');
  }
  function abaFoto(x) {
    const u = x.foto ? st().fotoUrl(x.foto.caminho) : '', inf = x.info || {}, sg = sugs.find(z => z.codigo === x.codigo && z.situacao === 'sugerida');
    const pdf = (cam, url, rot) => cam || url ? '<a class="btn sec" href="' + esc(cam ? st().fotoUrl(cam) : url) + '" target="_blank" rel="noopener noreferrer">📄 ' + rot + '</a>' : '';
    return '<div class="pc-colunas"><div class="pc-foto grande">' + (u ? '<img src="' + esc(u) + '" alt="' + esc(nome(x)) + '">' : '<span class="pf-sem">sem foto ainda</span>') + '</div><div>' +
      (cuidaFotos() && sg ? '<p class="aviso-notas">A IA achou uma sugestão para este produto. Confira antes de aprovar. <button type="button" class="btn" data-acao="pf-revisar" data-id="' + esc(x.codigo) + '">Conferir a sugestão</button></p>' : '') +
      (cuidaFotos() && x.foto ? '<p class="dica">Foto de ' + esc(quando(x.foto.atualizado_em)) + (x.foto.fonte ? ' · ' + esc(x.foto.fonte) : '') + '</p>' : '') +
      (pdf(inf.ficha_caminho, inf.ficha_url, 'Ficha técnica') || pdf(inf.fispq_caminho, inf.fispq_url, 'FISPQ') ? '<p class="acoes">' + pdf(inf.ficha_caminho, inf.ficha_url, 'Ficha técnica') + ' ' + pdf(inf.fispq_caminho, inf.fispq_url, 'FISPQ (segurança)') + '</p>' : '<p class="vazio">Sem ficha técnica nem FISPQ ainda.</p>') +
      (cuidaFotos() ? '<p class="acoes"><button type="button" class="btn sec" data-acao="pf-buscar-um" data-id="' + esc(x.codigo) + '">Buscar foto e ficha (IA)</button> <button type="button" class="btn sec" data-acao="pf-subir" data-id="' + esc(x.codigo) + '">Subir foto</button> ' +
        '<button type="button" class="btn sec" data-acao="pf-camera" data-id="' + esc(x.codigo) + '">Tirar foto</button> <button type="button" class="btn sec" data-acao="pf-info-editar" data-id="' + esc(x.codigo) + '">Editar a ficha</button>' +
        (x.foto ? ' <button type="button" class="mini" data-acao="pf-foto-tirar" data-id="' + esc(x.codigo) + '">tirar a foto</button>' : '') + '</p>' : '') + '</div></div>';
  }
  function carregaDetalhe(cod) {
    if (!podeFotos() || det.has(cod)) return;
    det.set(cod, { carregando: true });
    const s = st();
    Promise.all([s.produtoDetalhe ? s.produtoDetalhe(cod).catch(() => ({})) : {}, s.estoqueMovs(cod, 12).catch(() => [])])
      .then(([dd, movs]) => { det.set(cod, Object.assign({}, dd, { movs })); if (pc.aberto === cod) CRM.render(); });
  }

  CRM.telas.produtos = {
    turmaSub: () => (pc.aberto ? 'produto' : modo()),
    render() {
      if (lista === null) { setTimeout(carrega, 0); return '<div class="cabecalho"><div><h1>Produtos</h1></div></div><div class="cartao"><p class="vazio">Carregando…</p></div>'; }
      const x = pc.aberto ? prod(pc.aberto) : null;
      if (x) return pagina(x);
      const semFoto = cuidaFotos() ? lista.filter(z => !z.foto && z.disponivel > 0).length : 0;
      return '<div class="cabecalho"><div><h1>Produtos</h1><p class="sub">pesquise pelo código, pela descrição ou pelo código de barras; clique para ver tudo do produto</p></div>' +
        '<div class="acoes">' + (podeCad() && dono ? '<button type="button" class="btn" data-acao="pc-novo">+ Novo produto</button>' : '') +
          (CRM.ehAdmin() && dono === false ? '<button type="button" class="btn sec" data-acao="pc-dono">Passar o cadastro para o CRM</button>' : '') +
          (cuidaFotos() ? '<button type="button" class="btn sec" data-acao="pf-ir-fotos">Fotos e fichas' + (semFoto ? ' (' + semFoto + ' sem foto)' : '') + '</button>' : '') +
        '<button type="button" class="btn sec" data-acao="pf-recarregar"' + (carregando ? ' disabled' : '') + '>Atualizar</button></div></div>' +
        (podeCad() && dono === false ? '<p class="aviso-notas">Até a virada, o cadastro de produto (descrição, preço, mínimo) vem do FKN. Quando o FKN parar de emitir, ' +
          (CRM.ehAdmin() ? 'clique em <strong>Passar o cadastro para o CRM</strong>: daí em diante produto novo e preço se cadastram aqui.' : 'o administrador passa o cadastro para o CRM e ele se faz aqui.') + '</p>' : '') +
        '<section class="cartao pc-busca">' + barra() + '</section><div data-pc-lista>' + resultado() + '</div>';
    },
    depois(c) {
      if (pc.aberto) {
        carregaDetalhe(pc.aberto);
        if (pc.aba === 'vendas') clientes(c, pc.aberto);
        return;
      }
      const conta = c.querySelector('[data-pc-conta]'); if (conta) conta.textContent = contagem();
      const b = c.querySelector('[data-pc-busca]'), lst = c.querySelector('[data-pc-lista]'), ats = c.querySelector('[data-pc-atalhos]');
      if (b && lst) {
        b.addEventListener('input', () => { pc.busca = b.value; pc.limite = 100; lst.innerHTML = resultado(); if (ats) ats.innerHTML = atalhosHTML(); if (conta) conta.textContent = contagem(); });
        b.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); const p0 = visiveis()[0]; if (p0) CRM.acoes['pf-abrir'](p0.codigo); } });
      }
      [['[data-pc-linha]', 'linha'], ['[data-pc-forn]', 'forn'], ['[data-pc-ordem]', 'ordem']].forEach(([sel, k]) => {
        const e = c.querySelector(sel); if (e) e.addEventListener('change', () => { pc[k] = e.value; pc.limite = 100; CRM.render(); });
      });
    }
  };
  function formForn(cod) {
    const x = prod(cod); if (!x) return;
    const m = new Map();
    (fornLista || []).filter(z => z.ativo !== false || (x.forn && String(z.codigo) === x.forn.cod)).forEach(z => m.set(String(z.codigo), z.nome));
    X.fornecedoresDe(lista).forEach(z => { if (!m.has(z.cod)) m.set(z.cod, z.nome); });
    CRM.abrirForm({ titulo: 'Fornecedor do produto', intro: nome(x) + ' (' + cod + '). Vale só no CRM; no FKN o cadastro continua como está.',
      campos: [{ nome: 'fornecedor', rotulo: 'Fornecedor', tipo: 'select', largo: true, alfa: true, opcoes: [['', x.forn && x.forn.trocado ? '— voltar ao do FKN —' : '—']].concat([...m.entries()].map(([k, v]) => [k, R.nomeDeItem(v) + ' (' + k + ')'])) }],
      valores: { fornecedor: (x.forn && x.forn.trocado && x.forn.cod) || '' },
      aoSalvar: async v => { await st().trocarFornecedor(cod, v.fornecedor || null); CRM.toast(v.fornecedor ? 'Fornecedor definido.' : 'Volta a valer o fornecedor do FKN.'); lista = null; det.delete(cod); carrega(); } });
  }
  function formEmb(cod) {
    const x = prod(cod); if (!x) return;
    CRM.abrirForm({ titulo: 'Embalagem de ' + nome(x), intro: 'Quantas unidades (' + (x.unidade || 'UN') + ') vêm em cada embalagem. Vale para as notas de compra e para a conversão do estoque.',
      campos: [{ nome: 'unidade', rotulo: 'Embalagem (ex.: CX, FD, PCT)', obrigatorio: true }, { nome: 'fator', rotulo: 'Contém quantas ' + (x.unidade || 'unidades'), tipo: 'number', obrigatorio: true }],
      valores: { unidade: 'CX', fator: '' },
      aoSalvar: async v => { const u = String(v.unidade).trim().toUpperCase(), f = Number(v.fator); if (!u || !(f > 0)) throw new Error('diga a embalagem e quanto ela contém'); await st().produtoEmbalagem(cod, u, f); det.delete(cod); CRM.toast('Embalagem guardada.'); CRM.render(); } });
  }
  // Cadastro de produto (novo ou alterado) no CRM: o banco confere tudo (crm_produto_gravar) e guarda o histórico.
  const ORIGENS = [['0', '0 – Nacional'], ['1', '1 – Estrangeira (importação direta)'], ['2', '2 – Estrangeira (adquirida no mercado interno)'], ['3', '3 – Nacional, mais de 40% importado'],
    ['4', '4 – Nacional (processos básicos)'], ['5', '5 – Nacional, até 40% importado'], ['6', '6 – Estrangeira sem similar (CAMEX), importação direta'], ['7', '7 – Estrangeira sem similar (CAMEX), mercado interno'], ['8', '8 – Nacional, mais de 70% importado']];
  async function formCadastro(cod) {
    const novo = !cod, s = st();
    let v0;
    try { v0 = novo ? { codigo: await s.produtoProximoCodigo(), unidade: 'UN', situacao: 'ATIVO', origem: '0' } : await s.produtoLer(cod); } catch (e) { CRM.falhou(e); return; }
    if (!v0) { CRM.toast('Produto não encontrado.', true); return; }
    const linhas0 = R.ordemAlfa(X.linhas(lista || []).map(l => l.nome));
    const temForn = (fornLista || []).length > 0, comCusto = custoCad();
    const campos = [{ tipo: 'secao', rotulo: 'Produto' }]
      .concat(novo ? [{ nome: 'codigo', rotulo: 'Código', obrigatorio: true, dica: 'sugestão: o próximo número livre' }] : [])
      .concat([{ nome: 'descricao', rotulo: 'Descrição (sai na nota)', obrigatorio: true, largo: true },
        { nome: 'unidade', rotulo: 'Unidade de venda (UN, CX, FD, GL, PCT…)', obrigatorio: true },
        { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: [['ATIVO', 'Ativo'], ['INATIVO', 'Inativo (não aparece para vender)']] },
        { nome: 'linha', rotulo: 'Linha', sugestoes: linhas0 }, { nome: 'familia', rotulo: 'Família' },
        { nome: 'localizacao', rotulo: 'Localização no galpão' },
        { tipo: 'secao', rotulo: 'Preço e estoque' },
        { nome: 'preco_venda', rotulo: 'Preço de venda (tabela A), R$', tipo: 'numero', obrigatorio: true, vazioNulo: true },
        { nome: 'estoque_min', rotulo: 'Estoque mínimo', tipo: 'numero', passo: '1', vazioNulo: true },
        { nome: 'estoque_max', rotulo: 'Estoque máximo', tipo: 'numero', passo: '1', vazioNulo: true }])
      .concat(comCusto ? [{ nome: 'custo_unit', rotulo: 'Custo (reposição), R$', tipo: 'numero', vazioNulo: true }] : [])
      .concat(temForn ? [{ nome: 'fornecedor_cod', rotulo: 'Fornecedor', tipo: 'select', alfa: true, opcoes: [['', '—']].concat(fornLista.filter(z => z.ativo !== false || String(z.codigo) === String(v0.fornecedor_cod)).map(z => [String(z.codigo), R.nomeDeItem(z.nome)])) }] : [])
      .concat([{ tipo: 'secao', rotulo: 'Fiscal' },
        { nome: 'ncm', rotulo: 'NCM (8 números)', obrigatorio: true }, { nome: 'cest', rotulo: 'CEST (se tiver)' }, { nome: 'gtin', rotulo: 'Código de barras (EAN)' },
        { nome: 'origem', rotulo: 'Origem', tipo: 'select', opcoes: ORIGENS }])
      .concat(novo ? [{ nome: 'modelo', rotulo: 'Mesma tributação que o produto (código)', obrigatorio: true, largo: true, dica: 'um produto parecido já vendido: o CRM copia dele CFOP, CST e ICMS-ST' },
        { tipo: 'secao', rotulo: 'Embalagem de compra (se vier em caixa ou fardo)' },
        { nome: 'emb_unidade', rotulo: 'Embalagem (CX, FD, PCT)' }, { nome: 'emb_fator', rotulo: 'Quantas unidades vêm nela', tipo: 'numero', passo: '1', vazioNulo: true }] : []);
    const valores = Object.assign({}, v0, { ncm: v0.ncm ? String(v0.ncm).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3') : '', fornecedor_cod: v0.fornecedor_cod ? String(v0.fornecedor_cod) : '' });
    CRM.abrirForm({
      titulo: novo ? 'Novo produto' : 'Cadastro de ' + R.nomeDeItem(v0.descricao || cod),
      intro: novo ? 'O produto entra no estoque com saldo zero; a primeira entrada de nota de compra soma. Fica guardado quem cadastrou e quando.'
        : 'Cada alteração fica guardada com quem fez e quando.' + (comCusto ? '' : ' O custo, só o administrador e o comprador mudam.'),
      campos, valores,
      aoSalvar: async v => {
        const d = {};
        ['descricao', 'unidade', 'situacao', 'linha', 'familia', 'localizacao', 'preco_venda', 'estoque_min', 'estoque_max', 'ncm', 'cest', 'gtin', 'origem'].forEach(k => { d[k] = v[k] == null ? '' : v[k]; });
        if (comCusto) d.custo_unit = v.custo_unit == null ? '' : v.custo_unit;
        if (temForn) d.fornecedor_cod = v.fornecedor_cod || '';
        if (novo) { d.novo = true; d.modelo = String(v.modelo || '').trim(); }
        const codigo = novo ? String(v.codigo || '').trim().toUpperCase() : cod;
        await s.produtoGravar(codigo, d);
        if (novo && v.emb_unidade && v.emb_fator > 0) await s.produtoEmbalagem(codigo, String(v.emb_unidade).trim().toUpperCase(), v.emb_fator);
        CRM.toast(novo ? 'Produto ' + codigo + ' cadastrado.' : 'Cadastro salvo.');
        lista = null; det.delete(codigo); pc.aberto = codigo; carrega();
      }
    });
  }
  Object.assign(CRM.acoes, {
    'pc-novo': () => formCadastro(null),
    'pc-editar': id => formCadastro(id),
    'pc-dono': async () => {
      if (!confirm('Passar o cadastro de produtos para o CRM?\n\nDaí em diante a listagem de produtos do FKN não muda mais nada no CRM (nem preço, nem produto novo, nem a conferência do estoque) e o cadastro passa a ser feito só aqui, pelo comprador, pela logística e pelo administrador.\n\nFaça isso quando o FKN parar de emitir nota. Não tem volta pela tela.')) return;
      try { await st().produtosPassarAoCrm(); dono = true; CRM.toast('O cadastro de produtos agora é do CRM.'); CRM.render(); } catch (e) { CRM.falhou(e); }
    },
    'pf-abrir': id => { pc.aberto = base(id); CRM.estado.aba = 'produtos'; CRM.render(); raiz.scrollTo && raiz.scrollTo(0, 0); },
    'pc-voltar': () => { pc.aberto = null; CRM.render(); },
    'pc-aba': id => { pc.aba = id; CRM.render(); },
    'pc-modo': id => { try { raiz.localStorage.setItem(chaveModo(), id); } catch (e) { /* fica só nesta sessão */ } pc.limite = 100; CRM.render(); },
    'pc-atalho': id => { pc.atalho = id; pc.limite = 100; CRM.render(); },
    'pc-mais': () => { pc.limite += 100; CRM.render(); },
    'pc-forn': id => formForn(id),
    'pc-emb': id => formEmb(id),
    'pc-ir-fiscal': () => { CRM.estado.aba = 'fiscal'; CRM.render(); }
  });

  CRM.produtos = { miniatura, abrirFicha, escolher, telaFotos, depoisFotos, garanteFotos, recarregar: () => { lista = null; det.clear(); }, abrir: cod => CRM.acoes['pf-abrir'](cod) };
})(typeof window !== 'undefined' ? window : globalThis);
