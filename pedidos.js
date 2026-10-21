/* Pedido de venda — Fase 3 da saída do FKN (16/10/2026, pedido do Anderson: "sim, pode começar a Fase 3").
   Orçamento e pedido feitos no CRM, do jeito das telas do FKN (SIFN138 orçamento, SIFN006 pedido, Sifn050
   pendência/liberação): cabeçalho (cliente, tabela, pagamento, transportadora, frete, entrega), grade de produtos
   (item, código, nome, un, qtde, não atendido, preço, desconto, margem, total, comissão, desconto sobre a tabela) e,
   a mais do que o FKN, o DISPONÍVEL de cada produto (físico − reservado pelos pedidos do CRM). O pedido reserva o
   estoque; os bloqueios (ESTOQUE, ATRASO, SEM ENTRADA, PREÇO) seguram até a gestora liberar; a logística junta os
   liberados numa lista de separação (o "bolão"), separa e marca separado; a nota que chega fatura o pedido sozinha.
   Aqui: as regras puras (testes/pedidos.test.js). A tela fica no fim do arquivo. */
(function (raiz) {
  'use strict';
  const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
  const r2 = v => Math.round(v * 100) / 100;
  const r4 = v => Math.round(v * 10000) / 10000;
  const sem = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // Tabela de preços "PADRAO" do FKN (Sifn064): sobre o preço de venda do produto ("ven" da listagem).
  const TABELA_PADRAO = { NEG: -10, A: 0, B: 5, C: 10, D: 15, E: 20, F: 25 };
  const FAIXAS = ['F', 'E', 'D', 'C', 'B', 'A', 'NEG'];
  const tabelaDe = cfg => Object.assign({}, TABELA_PADRAO, (cfg && cfg.tabela_precos) || {});
  // Planos de comissão (% por faixa), confirmados pelo Anderson em 16/10: INTERNO = vendedores(as) do escritório (o papel:
  // fixo + comissão; abaixo da tabela A conta 2%); EXTERNO = vendedor(a) externo(a), hoje só a Silmara (a tabela do FKN).
  // Quem é externo: cfg.comissao_usuarios = { user_id: 'externo' }. A comissão é por item, pelo plano de quem vendeu.
  const PLANOS_PADRAO = [
    { id: 'interno', nome: 'Interno (escritório)', faixas: { ABAIXO: 2, NEG: 2, A: 3.5, B: 5, C: 5.5, D: 6, E: 6, F: 6 } },
    { id: 'externo', nome: 'Externo', faixas: { ABAIXO: 0, NEG: 5, A: 5, B: 6, C: 7, D: 8, E: 9, F: 10 } }
  ];
  // Margem mínima (a da tabela A: 23%). A vendedora vê a margem para saber se tem espaço quando o cliente negocia;
  // abaixo dela o pedido fica bloqueado (PREÇO) até a gestora liberar.
  const MARGEM_MINIMA = 23;
  const margemMinima = cfg => (cfg && cfg.margem_minima != null && cfg.margem_minima !== '' ? Number(cfg.margem_minima) : MARGEM_MINIMA);
  const planosDe = cfg => ((cfg && Array.isArray(cfg.comissao_planos) && cfg.comissao_planos.length) ? cfg.comissao_planos : PLANOS_PADRAO);
  // Plano de quem vendeu: o configurado; 'nenhum' = sem comissão; o administrador sem plano configurado não ganha
  // comissão (o "DIRETO" das notas é dele); os demais, o primeiro plano (interno).
  function planoDoUsuario(cfg, userId, papel) {
    const ps = planosDe(cfg), id = cfg && cfg.comissao_usuarios && cfg.comissao_usuarios[userId];
    if (id === 'nenhum' || (!id && papel === 'admin')) return null;
    return ps.find(p => p.id === id) || ps[0];
  }

  const precoLiq = it => r4(num(it.preco) * (1 - num(it.desconto) / 100));
  const totalItem = it => r2(num(it.quantidade) * num(it.preco) * (1 - num(it.desconto) / 100));
  const precoDaFaixa = (tab, faixa, tabela) => r4(num(tab) * (1 + num((tabela || TABELA_PADRAO)[faixa]) / 100));
  // A faixa é o maior degrau que o preço alcança; abaixo da faixa negativa = "ABAIXO". Sem preço de tabela: null.
  function faixaDoPreco(preco, tab, tabela) {
    tabela = tabela || TABELA_PADRAO;
    if (!(num(tab) > 0)) return null;
    for (const f of FAIXAS) if (tabela[f] != null && num(preco) >= precoDaFaixa(tab, f, tabela) - 0.00005) return f;
    return 'ABAIXO';
  }
  const rotuloFaixa = f => (f === 'NEG' ? 'neg.' : f === 'ABAIXO' ? 'abaixo' : f || '—');
  // Margem sobre o preço (como no FKN): (preço líquido − custo) ÷ preço líquido.
  const margem = (pl, custo) => (num(pl) > 0 && custo != null && custo !== '' ? r2((num(pl) - num(custo)) / num(pl) * 100) : null);
  // "Desc s/tab": quanto o preço está acima (+) ou abaixo (−) da tabela A.
  const sobreTabela = (pl, tab) => (num(tab) > 0 ? r2((num(pl) / num(tab) - 1) * 100) : null);

  // Linha da grade, com tudo que o FKN mostra (e o disponível).
  function linha(it, ctx) {
    ctx = ctx || {};
    const pl = precoLiq(it), tab = it.preco_tab != null ? num(it.preco_tab) : null;
    const fx = faixaDoPreco(pl, tab, ctx.tabela);
    const plano = ctx.plano || PLANOS_PADRAO[0];
    const com = fx && plano.faixas[fx] != null ? num(plano.faixas[fx]) : null;
    const total = totalItem(it);
    const mg = margem(pl, it.custo), min = ctx.margemMinima == null ? MARGEM_MINIMA : ctx.margemMinima;
    return { precoLiq: pl, total, faixa: fx, margem: mg, abaixoMinimo: num(it.custo) > 0 && (pl <= 0 || (mg != null && mg < min - 0.005)), sobreTab: sobreTabela(pl, tab),
      comissao: com, valorComissao: com == null ? 0 : r2(total * com / 100) };
  }

  // Totais do rodapé: produtos, frete, geral, margem ponderada (só itens com custo) e comissão.
  function totais(itens, frete, ctx) {
    let prod = 0, comCusto = 0, custo = 0, com = 0, pesoCom = 0;
    (itens || []).forEach(it => {
      const l = linha(it, ctx);
      prod += l.total;
      if (it.custo != null && it.custo !== '') { comCusto += l.total; custo += num(it.custo) * num(it.quantidade); }
      com += l.valorComissao; if (l.comissao != null) pesoCom += l.total;
    });
    prod = r2(prod);
    return { produtos: prod, frete: r2(num(frete)), geral: r2(prod + num(frete)), margem: comCusto > 0 ? r2((comCusto - custo) / comCusto * 100) : null,
      comissao: r2(com), comissaoPct: pesoCom > 0 ? r2(com / pesoCom * 100) : null };
  }

  // Bloqueios que ainda seguram (os liberados à mão não contam; um novo volta a segurar).
  const bloqueiosAbertos = p => (p.bloqueios || []).filter(b => (p.liberado || []).indexOf(b) === -1);
  const ROTULO_BLOQUEIO = { ESTOQUE: 'estoque', ATRASO: 'duplicata em atraso', 'SEM ENTRADA': 'sem entrada (pagamento antecipado)', 'PREÇO': 'margem abaixo do mínimo' };
  // Situação como no Sifn050: BLOQUEADO / LIBERADO / EM SEPARAÇÃO (SP n) / A EMITIR NF / FATURADO / CANCELADO.
  function situacao(p, notaNumero) {
    if (p.situacao === 'cancelado') return { rotulo: 'CANCELADO', cor: 'cinza', chave: 'cancelado' };
    if (p.situacao === 'faturado') return { rotulo: 'FATURADO' + (notaNumero ? ' NF ' + notaNumero : ''), cor: 'azul', chave: 'faturado' };
    if (p.situacao === 'separado') return { rotulo: 'A EMITIR NF', cor: 'verde', chave: 'separado' };
    if (p.situacao === 'separacao') return { rotulo: 'EM SEPARAÇÃO' + (p.bolao_id ? ' · SP ' + p.bolao_id : ''), cor: 'ambar', chave: 'separacao' };
    const b = bloqueiosAbertos(p);
    return b.length ? { rotulo: 'BLOQUEADO', cor: 'vermelho', chave: 'bloqueado', bloqueios: b } : { rotulo: 'LIBERADO', cor: 'verde', chave: 'liberado' };
  }

  // Lista do bolão: os itens dos pedidos somados por produto, ordenados pela localização no galpão (depois linha,
  // família e nome), com de quais pedidos vêm. info: Map código → {localizacao, linha, familia}.
  function bolao(pedidos, info) {
    const m = new Map();
    (pedidos || []).forEach(p => (p.itens || []).forEach(it => {
      const k = (it.codigo || '') + '|' + (it.unidade || '') + (it.codigo ? '' : '|' + sem(it.descricao));
      if (!m.has(k)) {
        const e = (info && it.codigo && (info.get(it.codigo) || info.get(String(it.codigo).replace(/\.\d+$/, '')))) || {};
        m.set(k, { codigo: it.codigo || '', descricao: it.descricao, unidade: it.unidade || '', quantidade: 0, localizacao: e.localizacao || '', linha: e.linha || '', familia: e.familia || '', pedidos: [] });
      }
      const x = m.get(k);
      x.quantidade = Math.round((x.quantidade + num(it.quantidade)) * 1000) / 1000;
      x.pedidos.push({ numero: p.numero, quantidade: num(it.quantidade) });
    }));
    const vazioPorUltimo = (a, b) => (a && !b ? -1 : !a && b ? 1 : String(a).localeCompare(String(b), 'pt-BR', { numeric: true }));
    return [...m.values()].sort((a, b) => vazioPorUltimo(a.localizacao, b.localizacao) || vazioPorUltimo(a.linha, b.linha) || vazioPorUltimo(a.familia, b.familia) ||
      String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
  }

  // "Últimas compras (F3)" e "Importar últimas compras": o que o cliente comprou nas notas, do mais recente.
  // notas: [{id, emitida_em, numero, cancelada}]; itensPorNota: Map nota_id → itens [{codigo, descricao, unidade, quantidade, valor_unitario}].
  function ultimasCompras(notas, itensPorNota) {
    const vivas = (notas || []).filter(n => !n.cancelada).sort((a, b) => String(b.emitida_em).localeCompare(String(a.emitida_em)));
    const m = new Map();
    vivas.forEach(n => (itensPorNota.get(n.id) || []).forEach(it => {
      const k = it.codigo || sem(it.descricao);
      const x = m.get(k);
      if (!x) m.set(k, { codigo: it.codigo || '', descricao: it.descricao, unidade: it.unidade || '', quantidade: num(it.quantidade), preco: num(it.valor_unitario), ultima: n.emitida_em, nota: n.numero, vezes: 1 });
      else x.vezes++;
    }));
    return { produtos: [...m.values()], ultimaNota: vivas[0] ? (itensPorNota.get(vivas[0].id) || []).map(it => ({ codigo: it.codigo || '', descricao: it.descricao, unidade: it.unidade || '', quantidade: num(it.quantidade), preco: num(it.valor_unitario) })) : [] };
  }

  // Procurar produto pelo código (começo) ou por palavras do nome, como na lupa do FKN.
  function procura(lista, termo, limite) {
    const t = sem(termo).trim();
    if (!t) return [];
    const pal = t.split(/\s+/);
    const cod = t.replace(/\s+/g, '');
    const ok = (lista || []).filter(e => String(e.codigo || '').toLowerCase().indexOf(cod) === 0 || pal.every(w => sem(e.descricao).indexOf(w) !== -1));
    return ok.sort((a, b) => (String(a.codigo).toLowerCase() === cod ? -1 : String(b.codigo).toLowerCase() === cod ? 1 : 0) || num(b.disponivel > 0) - num(a.disponivel > 0) ||
      String(a.descricao).localeCompare(String(b.descricao), 'pt-BR')).slice(0, limite || 30);
  }

  // Itens da proposta (orçamento importado do FKN ou feito no CRM) → itens do pedido.
  const itensDaProposta = p => (p.itens || []).map(it => ({ codigo: it.codigo || null, descricao: it.descricao, unidade: it.unidade || null, quantidade: num(it.quantidade) || 1, preco: num(it.preco), desconto: num(it.desconto) }));

  // Endereço de entrega do cadastro do cliente (o "Local entrega 0 — ENDEREÇO DE ENTREGA" do FKN).
  const entregaDoCliente = e => (e ? { endereco: e.logradouro || '', numero: e.numero || '', compl: e.complemento || '', bairro: e.bairro || '', cidade: e.cidade || '', uf: e.uf || '', cep: e.cep || '' } : {});
  const entregaTexto = d => (d ? [[d.endereco, d.numero].filter(Boolean).join(', '), d.compl, d.bairro, [d.cidade, d.uf].filter(Boolean).join('/'), d.cep ? 'CEP ' + d.cep : ''].filter(Boolean).join(' · ') : '');

  // Apuração da comissão do mês (Fase 3b): nasce na nota emitida, item a item, pela faixa do preço praticado na tabela e
  // pelo plano de quem vendeu (o vendedor escrito na nota). Só itens de venda (CFOP x1xx e x4xx: 5102, 5405, 5117…; fora
  // remessa, bonificação, simples faturamento). Preço de tabela: o do pedido do CRM que virou a nota (foto do dia) ou o de
  // hoje da listagem; caixa vendida como "CX" usa o preço da caixa. Sem preço de tabela, conta como faixa A e avisa.
  //   o: { notas, itensPorNota (Map), mes 'AAAA-MM', dia(nota) → 'AAAA-MM-DD', precos (Map código → preço "ven"),
  //        precoCaixa (Map código → preço da caixa), pedidoDaNota (Map nota_id → pedido), cfg, usuarios [{user_id, nome, papel}] }
  const ehVendaCfop = c => !c || /^[56][14]/.test(String(c));
  function apuraComissao(o) {
    const tabela = tabelaDe(o.cfg), dia = o.dia || (n => String(n.emitida_em).slice(0, 10));
    const us = new Map((o.usuarios || []).map(u => [u.user_id, u])), por = new Map();
    (o.notas || []).forEach(n => {
      if (n.cancelada || !n.vendedor_id || dia(n).slice(0, 7) !== o.mes) return;
      const u = us.get(n.vendedor_id) || { user_id: n.vendedor_id, nome: n.vendedor_nome || '?' };
      const plano = planoDoUsuario(o.cfg, u.user_id, u.papel);
      if (!plano) return;
      if (!por.has(u.user_id)) por.set(u.user_id, { user_id: u.user_id, nome: u.nome, plano: plano.id, planoNome: plano.nome, base: 0, comissao: 0, porFaixa: {}, notas: [], semTabela: 0, itens: 0 });
      const g = por.get(u.user_id), ped = o.pedidoDaNota && o.pedidoDaNota.get(n.id);
      const doPedido = new Map(((ped && ped.itens) || []).filter(i => i.codigo && i.preco_tab != null).map(i => [String(i.codigo).replace(/\.\d+$/, '') + '|' + (i.unidade || ''), num(i.preco_tab)]));
      let bn = 0, cn = 0;
      (o.itensPorNota.get(n.id) || []).forEach(it => {
        if (!ehVendaCfop(it.cfop)) return;
        const cod = String(it.codigo || ''), un = String(it.unidade || '').toUpperCase();
        let tab = doPedido.get(cod.replace(/\.\d+$/, '') + '|' + un);
        if (tab == null) tab = un === 'CX' && o.precoCaixa && o.precoCaixa.has(cod) ? o.precoCaixa.get(cod) : o.precos && o.precos.get(cod);
        let fx = faixaDoPreco(num(it.valor_unitario), tab, tabela);
        if (!fx) { fx = 'A'; g.semTabela++; }
        const pctc = num(plano.faixas[fx]), v = num(it.valor_total), c = r2(v * pctc / 100);
        const pf = g.porFaixa[fx] = g.porFaixa[fx] || { base: 0, comissao: 0, pct: pctc };
        pf.base = r2(pf.base + v); pf.comissao = r2(pf.comissao + c);
        bn += v; cn += c; g.itens++;
      });
      g.base = r2(g.base + bn); g.comissao = r2(g.comissao + cn);
      g.notas.push({ id: n.id, numero: n.numero, data: dia(n), cliente: n.cliente_nome || '', base: r2(bn), comissao: r2(cn) });
    });
    return [...por.values()].sort((a, b) => b.base - a.base);
  }
  const totalComAjustes = (comissao, ajustes) => r2(num(comissao) + (ajustes || []).reduce((s, a) => s + num(a.valor), 0));

  // "Repetir pedido" (restaurar): os itens de um pedido do CRM ou de uma nota do cliente, com os preços dela.
  const itensParaRepetir = (pedido, itensNota) => (pedido ? (pedido.itens || []).map(i => ({ codigo: i.codigo || null, descricao: i.descricao, unidade: i.unidade || null, quantidade: num(i.quantidade), preco: num(i.preco), desconto: num(i.desconto) }))
    : (itensNota || []).filter(i => ehVendaCfop(i.cfop)).map(i => ({ codigo: i.codigo || null, descricao: i.descricao, unidade: i.unidade || null, quantidade: num(i.quantidade), preco: num(i.valor_unitario), desconto: 0 })));

  // Para quem não vê a margem (a vendedora): o preço abaixo da tabela A é o sinal de que o pedido pode travar (a margem
  // mínima de 23% é a da tabela A).
  const abaixoDaTabela = l => !!(l && (l.faixa === 'NEG' || l.faixa === 'ABAIXO'));

  const FRETE_CONTA = [['0', '0-Remetente (CIF)'], ['1', '1-Destinatário (FOB)'], ['2', '2-Terceiros'], ['9', '9-Sem frete']];

  const P = { TABELA_PADRAO, PLANOS_PADRAO, MARGEM_MINIMA, margemMinima, apuraComissao, totalComAjustes, itensParaRepetir, ehVendaCfop, FAIXAS, FRETE_CONTA, ROTULO_BLOQUEIO, tabelaDe, planosDe, planoDoUsuario, precoLiq, totalItem, precoDaFaixa, faixaDoPreco, rotuloFaixa,
    margem, sobreTabela, abaixoDaTabela, linha, totais, bloqueiosAbertos, situacao, bolao, ultimasCompras, procura, itensDaProposta, entregaDoCliente, entregaTexto };
  raiz.CRMPedidos = P;
  if (typeof module !== 'undefined') module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);

// ------------------------------------------------------------ tela (aba Pedidos)
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, P = raiz.CRMPedidos, R = raiz.CRMRegras;
  if (!CRM || !CRM.telas) return;
  // papel novo da Fase 3 (fica aqui, e não em regras.js, para não mexer no motor da crm-notas)
  if (R.PAPEIS && !R.PAPEIS.some(x => x[0] === 'logistica')) R.PAPEIS.push(['logistica', 'Logística (separação, estoque sem custo, NF-e e rotas)']);
  const esc = CRM.esc, E = () => CRM.estado;
  const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
  const qtd = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
  const preco = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
  const pct = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
  const quando = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const ehLog = () => CRM.papel() === 'logistica';
  const ehOp = () => ehLog() || CRM.ehGestor();                       // logística ou gestora/administrador
  const ehVenda = () => ['admin', 'gestor', 'vendedor'].indexOf(CRM.papel()) !== -1;
  // custo e margem: administrador, gestora e comprador (20/10/2026, Anderson: "preços de custo as vendedoras não
  // enxergam"; antes a equipe de vendas via, como no FKN). O banco já não manda o custo para a vendedora nem para a logística.
  const veCusto = () => CRM.ehGestor() || CRM.ehComprador();
  const veMargem = () => CRM.ehGestor();

  let peds = null, disp = [], faltas = [], boloes = [], carregando = false;
  let porCod = new Map();
  const f = { ver: null, sit: 'abertos', vend: '', busca: '', est: '', bolao: null, marcados: new Set() };
  let ed = null, aberto = null, abaPed = 'produtos', listaProdutosHTML = '';

  async function carrega(silencio) {
    if (carregando) return;
    carregando = true;
    try {
      const st = CRM.store();
      await st.pedidosAtualizar().catch(() => null);
      [peds, disp, faltas, boloes] = await Promise.all([st.pedidos(), st.estoqueDisponivel().catch(() => []), st.pedidosFaltas().catch(() => []), st.boloes().catch(() => [])]);
      porCod = new Map(disp.map(d => [d.codigo, d]));
      if (CRM.aCaminho) { CRM.aCaminho.limpa(); await CRM.aCaminho.garante(); } // compras a caminho, com a data (compras-pedidos.js)
      listaProdutosHTML = '<datalist id="pdProdutos">' + R.ordemAlfa(disp.filter(d => d.situacao !== 'INATIVO'), d => d.descricao).map(d => '<option value="' + esc(d.codigo + ' — ' + d.descricao) + '">' +
        esc('disp. ' + qtd(d.disponivel) + ' ' + (d.unidade || '') + (d.preco_venda ? ' · R$ ' + preco(d.preco_venda) : '')) + '</option>').join('') + '</datalist>';
    } catch (e) { peds = peds || []; if (!silencio) CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }
  const recarrega = () => { carregando = false; return carrega(true); };
  const ped = id => (peds || []).find(p => p.id === id);
  const nomeCliente = p => (CRM.empresa(p.empresa_id) || {}).nome || (p.dados || {}).cliente_nome || '—';
  const notaNumero = p => { if (!p.nota_id) return null; const n = (E().D.notas || []).find(x => x.id === p.nota_id); return n ? n.numero : null; };
  const faltasDe = id => faltas.filter(x => x.pedido_id === id);
  const ctxDe = vendedorId => ({ tabela: P.tabelaDe(E().cfg), plano: P.planoDoUsuario(E().cfg, vendedorId), margemMinima: P.margemMinima(E().cfg) });
  const podeEditar = p => p.situacao === 'aberto' && ehVenda() && (CRM.ehGestor() || p.vendedor_id === CRM.meuId() || !!CRM.empresa(p.empresa_id));

  function imprimir(html, titulo) {
    const el = document.getElementById('impressao');
    el.innerHTML = html;
    document.body.classList.add('imprimindo');
    const antes = document.title; document.title = titulo;
    const limpa = () => { document.body.classList.remove('imprimindo'); document.title = antes; window.removeEventListener('afterprint', limpa); };
    window.addEventListener('afterprint', limpa);
    setTimeout(() => window.print(), 50);
  }

  // ------------------------------------------------ cabeçalho e abas
  function vistas() {
    const l = [];
    if (ehVenda() || ehLog()) l.push(['lista', 'Pedidos']);
    if (ehVenda()) l.push(['orcamentos', 'Orçamentos']);
    l.push(['estoque', 'Consultar estoque']);
    if (ehOp()) l.push(['separacao', 'Separação']);
    l.push(['faltas', 'Faltas']);
    if (ehVenda()) l.push(['comissoes', CRM.ehAdmin() ? 'Comissões' : 'Minha comissão']);
    if (ehOp() && CRM.nfe) l.push(['nfe', 'NF-e']);
    return l;
  }
  function cabecalho() {
    const vs = vistas();
    if (!f.ver || !vs.some(v => v[0] === f.ver)) f.ver = ehLog() ? 'separacao' : CRM.ehComprador() ? 'faltas' : 'lista';
    return '<div class="cabecalho"><div><h1>Pedidos</h1><p class="sub">orçamento → pedido (reserva o estoque) → liberação → lista de separação → nota · do jeito do FKN, com o disponível de cada produto</p></div>' +
      '<div class="acoes">' + (ehVenda() ? '<button type="button" class="btn" data-acao="pd-novo">+ Novo orçamento / pedido</button>' : '') +
      '<button type="button" class="btn sec" data-acao="pd-recarregar"' + (carregando ? ' disabled' : '') + '>Atualizar</button></div></div>' +
      '<div class="chips pd-vistas">' + vs.map(v => '<button type="button" class="chip-filtro' + (f.ver === v[0] ? ' ativo' : '') + '" data-acao="pd-ver" data-id="' + v[0] + '">' + esc(v[1]) +
        (v[0] === 'faltas' && faltas.length ? ' <span class="bolinha vermelha">' + new Set(faltas.map(x => x.base)).size + '</span>' : '') + '</button>').join('') + '</div>';
  }

  // ------------------------------------------------ lista (Sifn050)
  const SITS = [['abertos', 'Em andamento'], ['bloqueado', 'Bloqueados'], ['liberado', 'Liberados'], ['separacao', 'Em separação'], ['separado', 'A emitir NF'], ['faturado', 'Faturados'], ['cancelado', 'Cancelados'], ['todos', 'Todos']];
  function filtrados() {
    const q = R.normaliza(f.busca);
    return (peds || []).filter(p => {
      const s = P.situacao(p).chave;
      if (f.sit === 'abertos' && ['faturado', 'cancelado'].indexOf(s) !== -1) return false;
      if (f.sit !== 'abertos' && f.sit !== 'todos' && s !== f.sit) return false;
      if (f.vend && p.vendedor_id !== f.vend) return false;
      return !q || R.normaliza(p.numero + ' ' + nomeCliente(p)).indexOf(q) !== -1;
    });
  }
  function telaLista() {
    const l = filtrados();
    const soma = arr => arr.reduce((s, p) => s + num(p.valor_total), 0);
    const marg = arr => { const its = [].concat(...arr.map(p => p.itens || [])); return P.totais(its, 0).margem; };
    const bloq = l.filter(p => P.situacao(p).chave === 'bloqueado'), lib = l.filter(p => P.situacao(p).chave === 'liberado');
    const tot = (rot, arr, cls) => '<div class="kpi ' + (cls || '') + '"><span>' + rot + '</span><strong>' + R.moeda(soma(arr)) + '</strong><small>' + arr.length + ' pedido(s)' + (veMargem() ? ' · margem ' + pct(marg(arr)) : '') + '</small></div>';
    return '<section class="cartao"><div class="filtro-linha">' + SITS.map(s => '<button type="button" class="chip-filtro' + (f.sit === s[0] ? ' ativo' : '') + '" data-acao="pd-sit" data-id="' + s[0] + '">' + s[1] + '</button>').join('') + '</div>' +
      '<p class="acoes"><input type="search" placeholder="Pedido ou cliente" value="' + esc(f.busca) + '" data-pd-busca class="of-busca">' +
      (CRM.ehGestor() || ehLog() ? ' <label class="filtro-inline">Vendedor(a) <select data-pd-vend>' + CRM.opcoesHTML([['', 'Todos']].concat(CRM.usuariosAtivos().map(u => [u.user_id, u.nome])), f.vend) + '</select></label>' : '') + '</p>' +
      '<div class="kpis">' + tot('Geral', l) + tot('Bloqueado', bloq, bloq.length ? 'vermelho' : '') + tot('Liberado', lib, 'verde') + '</div>' +
      (l.length ? '<div class="tabela-rolagem"><table class="tabela pd-lista"><thead><tr><th>Pedido</th><th>Data</th><th>Situação</th><th>Cliente</th><th class="num">Valor total</th>' + (veMargem() ? '<th class="num">Margem</th>' : '') +
        '<th>Vendedor(a)</th><th>Entrega</th></tr></thead><tbody>' + l.map(p => {
          const s = P.situacao(p, notaNumero(p)), d = p.dados || {}, ent = d.entrega || {};
          return '<tr class="clicavel pd-' + s.chave + '" data-acao="pd-abrir" data-id="' + esc(p.id) + '" tabindex="0"><td><strong>' + esc(p.numero) + '</strong>' + (p.tipo === 'programado' ? '<small>programado</small>' : '') + '</td>' +
            '<td>' + esc(R.dataBR(R.diaLocal(p.criado_em))) + '</td><td>' + CRM.selo(s.rotulo, s.cor) + (s.bloqueios ? '<small>' + esc(s.bloqueios.map(b => P.ROTULO_BLOQUEIO[b] || b).join(' · ')) + '</small>' : '') + '</td>' +
            '<td>' + esc(nomeCliente(p)) + '</td><td class="num">' + R.moeda(p.valor_total) + '</td>' + (veMargem() ? '<td class="num">' + pct(P.totais(p.itens, 0).margem) + '</td>' : '') +
            '<td>' + esc(R.primeiroNome(CRM.nomeUsuario(p.vendedor_id))) + '</td><td>' + esc([p.entrega ? R.dataBR(p.entrega) : '', ent.cidade].filter(Boolean).join(' · ') || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="vazio">Nenhum pedido aqui.' + (ehVenda() ? ' "+ Novo orçamento / pedido" começa um; um orçamento já feito vira pedido pela aba Orçamentos ou pela ficha do negócio.' : '') + '</p>') + '</section>';
  }

  // ------------------------------------------------ orçamentos abertos (propostas)
  function telaOrcamentos() {
    const comPedido = new Set((peds || []).filter(p => p.proposta_id && p.situacao !== 'cancelado').map(p => p.proposta_id));
    const desde = R.somaDias(CRM.hoje(), -60);
    const l = (E().D.propostas || []).filter(p => (p.status === 'rascunho' || p.status === 'enviada' || p.status === 'aprovada') && !comPedido.has(p.id) && String(p.criado_em).slice(0, 10) >= desde)
      .map(p => ({ p, n: CRM.negocio(p.negocio_id) })).filter(x => x.n && (CRM.ehGestor() || x.n.responsavel_id === CRM.meuId() || CRM.empresa(x.n.empresa_id)))
      .sort((a, b) => String(b.p.criado_em).localeCompare(String(a.p.criado_em)));
    return '<section class="cartao"><h2>Orçamentos sem pedido <small>' + l.length + ' · últimos 60 dias</small></h2>' +
      '<p class="dica">O cliente aprovou? "Virar pedido" traz os itens e as condições, mostra o disponível de cada produto e reserva o estoque.</p>' +
      (l.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Orçamento</th><th>Data</th><th>Cliente</th><th class="num">Valor</th><th>Situação</th><th>Vendedor(a)</th><th></th></tr></thead><tbody>' +
        l.map(({ p, n }) => '<tr><td><strong>' + esc(p.numero_fkn || p.numero) + '</strong><small>' + (p.numero_fkn ? 'do FKN' : 'do CRM') + '</small></td><td>' + esc(R.dataBR(R.diaLocal(p.criado_em))) + '</td>' +
          '<td>' + esc(CRM.nomeEmpresa(n.empresa_id)) + '</td><td class="num">' + R.moeda(p.valor_total) + '</td><td>' + CRM.seloProposta(p.status) + '</td><td>' + esc(R.primeiroNome(CRM.nomeUsuario(n.responsavel_id))) + '</td>' +
          '<td class="num"><button type="button" class="btn" data-acao="pd-de-proposta" data-id="' + esc(p.id) + '">Virar pedido</button> <button type="button" class="mini" data-acao="abrir-negocio" data-id="' + esc(n.id) + '">negócio</button></td></tr>').join('') +
        '</tbody></table></div>' : '<p class="vazio">Nenhum orçamento esperando.</p>') + '</section>';
  }

  // ------------------------------------------------ consulta de estoque
  function telaEstoque() {
    const l = f.est ? P.procura(disp, f.est, 150) : [];
    return '<section class="cartao"><h2>Consultar estoque</h2>' +
      '<p class="dica"><strong>Disponível</strong> = físico − reservado pelos pedidos do CRM. "A caminho" é o que já foi pedido ao fornecedor. A caixa fechada (código ".1") aparece em caixas.</p>' +
      '<p class="acoes"><input type="search" placeholder="Código ou nome do produto" value="' + esc(f.est) + '" data-pd-est class="of-busca" autofocus></p>' +
      (!f.est ? '<p class="vazio">Digite o código ou parte do nome.</p>' : l.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th>Un</th><th class="num">Disponível</th><th class="num">Físico</th><th class="num">Reservado</th><th class="num">A caminho</th><th class="num">Preço tabela</th>' +
        (veCusto() ? '<th class="num">Custo</th>' : '') + '</tr></thead><tbody>' + l.map(d => '<tr><td>' + (CRM.produtos ? '<button type="button" class="pd-info-foto" data-acao="pf-ficha" data-id="' + esc(d.codigo) + '" title="Ver a ficha">' + CRM.produtos.miniatura(d.codigo) + '</button>' : '') + '<strong>' + esc(R.nomeDeItem(d.descricao)) + '</strong><small>' + esc(d.codigo) + (d.localizacao ? ' · ' + esc(d.localizacao) : '') + '</small></td><td>' + esc(d.unidade || '') + '</td>' +
          '<td class="num"><strong class="' + (num(d.disponivel) <= 0 ? 'neg' : '') + '">' + qtd(Math.floor(num(d.disponivel) * 1000) / 1000) + '</strong></td><td class="num">' + qtd(d.fisico) + '</td><td class="num">' + qtd(d.reservado) + '</td><td class="num">' + qtd(d.a_caminho) + '</td>' +
          '<td class="num">' + preco(d.preco_venda) + '</td>' + (veCusto() ? '<td class="num">' + preco(d.custo) + '</td>' : '') + '</tr>').join('') + '</tbody></table></div>' : '<p class="vazio">Nada com esse nome ou código.</p>') + '</section>';
  }

  // ------------------------------------------------ faltas
  function telaFaltas() {
    const m = new Map();
    faltas.forEach(x => {
      const p = ped(x.pedido_id); if (!p) return;
      const it = (p.itens || [])[x.idx] || {};
      if (!m.has(x.base)) m.set(x.base, { base: x.base, falta: 0, pedidos: [] });
      const g = m.get(x.base);
      g.falta += num(x.falta) * num(it.fator || 1);
      g.pedidos.push(p.numero + ' (' + qtd(x.falta) + ' ' + (it.unidade || '') + ', ' + nomeCliente(p) + ')');
    });
    const l = [...m.values()].sort((a, b) => b.pedidos.length - a.pedidos.length);
    return '<section class="cartao"><h2>Faltas dos pedidos <small>' + l.length + ' produto(s)</small></h2>' +
      '<p class="dica">O físico atende os pedidos por ordem de chegada (o que já está em separação primeiro); o que passar dele é falta. Entra na sugestão de compra do comprador. ' +
      (ehVenda() ? 'O cliente precisa saber: combine a entrega do que falta ou troque o produto.' : '') + '</p>' +
      (l.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th class="num">Falta</th><th class="num">Disponível</th><th class="num">A caminho</th><th>Pedidos</th></tr></thead><tbody>' +
        l.map(g => { const d = porCod.get(g.base) || {}; return '<tr><td><strong>' + esc(R.nomeDeItem(d.descricao || g.base)) + '</strong><small>' + esc(g.base) + '</small></td><td class="num"><strong class="neg">' + qtd(g.falta) + ' ' + esc(d.unidade || '') + '</strong></td>' +
          '<td class="num">' + qtd(d.disponivel) + '</td><td class="num">' + qtd(d.a_caminho) + '</td><td><small>' + esc(g.pedidos.join(' · ')) + '</small></td></tr>'; }).join('') + '</tbody></table></div>'
        : '<p class="vazio">Nenhum pedido com falta. 👍</p>') + '</section>';
  }

  // ------------------------------------------------ separação (logística)
  function telaSeparacao() {
    if (f.bolao) return telaBolao(f.bolao);
    const lib = (peds || []).filter(p => P.situacao(p).chave === 'liberado').sort((a, b) => String(a.entrega || '9').localeCompare(String(b.entrega || '9')) || a.numero - b.numero);
    const emSep = (peds || []).filter(p => p.situacao === 'separacao'), sep = (peds || []).filter(p => p.situacao === 'separado');
    const listas = [...new Set(emSep.map(p => p.bolao_id))].sort((a, b) => b - a);
    const linhaP = (p, check) => '<tr>' + (check ? '<td><input type="checkbox" data-pd-marca="' + esc(p.id) + '"' + (f.marcados.has(p.id) ? ' checked' : '') + '></td>' : '') +
      '<td><button type="button" class="link" data-acao="pd-abrir" data-id="' + esc(p.id) + '"><strong>' + esc(p.numero) + '</strong></button></td><td>' + esc(nomeCliente(p)) + '</td>' +
      '<td>' + esc((p.dados && p.dados.entrega && p.dados.entrega.cidade) || '') + '</td><td>' + esc(p.entrega ? R.dataBR(p.entrega) : '—') + '</td><td class="num">' + (p.itens || []).length + '</td><td class="num">' + R.moeda(p.valor_total) + '</td>';
    return '<section class="cartao"><h2>Liberados para separar <small>' + lib.length + '</small></h2>' +
      '<p class="dica">Marque os pedidos que vão sair (as entregas do dia) e monte a <strong>lista de separação</strong>: uma lista só, somada por produto e na ordem do galpão, para descer o material de uma vez; depois confere pedido a pedido.</p>' +
      (lib.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th></th><th>Pedido</th><th>Cliente</th><th>Cidade</th><th>Entrega</th><th class="num">Itens</th><th class="num">Valor</th></tr></thead><tbody>' +
        lib.map(p => linhaP(p, true) + '</tr>').join('') + '</tbody></table></div>' +
        '<p class="acoes"><button type="button" class="btn" data-acao="pd-bolao-montar">Montar lista de separação com os marcados (' + f.marcados.size + ')</button> <button type="button" class="mini" data-acao="pd-marcar-todos">marcar todos</button></p>'
        : '<p class="vazio">Nenhum pedido liberado esperando. Os bloqueados aparecem na aba Pedidos; quem libera é a gestora.</p>') + '</section>' +
      '<section class="cartao"><h2>Listas de separação abertas <small>' + listas.length + '</small></h2>' +
      (listas.length ? '<ul class="lista">' + listas.map(b => { const ps = emSep.filter(p => p.bolao_id === b), bo = boloes.find(x => x.id === b) || {};
        return '<li><div><strong>SP ' + esc(b) + '</strong> ' + ps.length + ' pedido(s): ' + esc(ps.map(p => p.numero).join(', ')) + '<small>' + esc(bo.criado_em ? quando(bo.criado_em) : '') + (bo.observacao ? ' · ' + bo.observacao : '') + '</small></div>' +
          '<span class="acoes-rapidas"><button type="button" class="btn" data-acao="pd-bolao" data-id="' + esc(b) + '">Abrir</button></span></li>'; }).join('') + '</ul>' : '<p class="vazio">Nenhuma lista aberta.</p>') + '</section>' +
      '<section class="cartao"><h2>Separados — a emitir NF <small>' + sep.length + '</small></h2>' +
      '<p class="dica">A nota emitida no FKN chega ao CRM pelo vigia e fatura o pedido sozinha (mesmo cliente, os mesmos produtos). Se não casar, use "Faturar…".</p>' +
      (sep.length ? '<div class="tabela-rolagem"><table class="tabela"><tbody>' + sep.map(p => '<tr><td>' + (CRM.nfe && CRM.nfe.podeEmitir(p) ? '<input type="checkbox" data-nf-marca="' + esc(p.id) + '"' + (CRM.nfe.marcado(p.id) ? ' checked' : '') + '>' : '') + '</td>' +
        linhaP(p, false).slice(4) + '<td class="num">' + (CRM.nfe && CRM.nfe.podeEmitir(p) ? '<button type="button" class="mini" data-acao="nf-emitir" data-id="' + esc(p.id) + '">Emitir NF-e</button> ' : '') +
        '<button type="button" class="mini" data-acao="pd-faturar" data-id="' + esc(p.id) + '" title="ligar a nota que o FKN emitiu">Faturar (FKN)…</button></td></tr>').join('') + '</tbody></table></div>' +
        (CRM.nfe && sep.some(p => CRM.nfe.podeEmitir(p)) ? '<p class="acoes"><button type="button" class="btn verde" data-acao="nf-lote">Emitir NF-e dos marcados (' + sep.filter(p => CRM.nfe.marcado(p.id)).length + ')</button> ' +
          '<button type="button" class="mini" data-acao="nf-marcar-todos">marcar todos</button></p>' : '')
        : '<p class="vazio">Nada esperando nota.</p>') + '</section>';
  }

  function telaBolao(b) {
    const ps = (peds || []).filter(p => p.bolao_id === b && (p.situacao === 'separacao' || p.situacao === 'separado'));
    const info = new Map(disp.map(d => [d.codigo, d]));
    const l = P.bolao(ps, info);
    return '<section class="cartao"><h2>Lista de separação SP ' + esc(b) + ' <small>' + ps.length + ' pedido(s) · ' + l.length + ' produto(s)</small></h2>' +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="pd-bolao-voltar">← Voltar</button> <button type="button" class="btn" data-acao="pd-bolao-imprimir" data-id="' + esc(b) + '">Imprimir a lista e os pedidos</button></p>' +
      '<h3>1. Descer o material (somado)</h3><div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Local</th><th>Código</th><th>Produto</th><th class="num">Qtde</th><th>Un</th><th>Pedidos</th></tr></thead><tbody>' +
      l.map(x => '<tr><td>' + esc(x.localizacao || '—') + '</td><td>' + esc(x.codigo) + '</td><td>' + esc(x.descricao) + '</td><td class="num"><strong>' + qtd(x.quantidade) + '</strong></td><td>' + esc(x.unidade) + '</td>' +
        '<td><small>' + esc(x.pedidos.map(y => y.numero + ': ' + qtd(y.quantidade)).join(' · ')) + '</small></td></tr>').join('') + '</tbody></table></div>' +
      '<h3>2. Separar pedido a pedido</h3>' + ps.map(p => {
        const todos = (p.itens || []).every(i => i.separado);
        return '<div class="pd-sep"><h4>Pedido ' + esc(p.numero) + ' · ' + esc(nomeCliente(p)) + ' ' + CRM.selo(P.situacao(p).rotulo, P.situacao(p).cor) + '</h4>' +
          '<table class="tabela"><tbody>' + (p.itens || []).map((it, i) => '<tr><td><label class="filtro-inline"><input type="checkbox" data-pd-sep="' + esc(p.id) + ':' + i + '"' + (it.separado ? ' checked' : '') + (p.situacao !== 'separacao' ? ' disabled' : '') + '> ' +
            esc(it.descricao) + '</label><small>' + esc(it.codigo || '') + '</small></td><td class="num"><strong>' + qtd(it.quantidade) + '</strong> ' + esc(it.unidade || '') + '</td></tr>').join('') + '</tbody></table>' +
          '<p class="acoes">' + (p.situacao === 'separacao' ? '<button type="button" class="btn' + (todos ? ' verde' : ' sec') + '" data-acao="pd-separado" data-id="' + esc(p.id) + '">Separado ✓</button> ' : '') +
          '<button type="button" class="mini" data-acao="pd-voltar-aberto" data-id="' + esc(p.id) + '">tirar da lista (volta ao aberto)</button></p></div>';
      }).join('') + '</section>';
  }

  function htmlBolaoImpresso(b) {
    const ps = (peds || []).filter(p => p.bolao_id === b);
    const l = P.bolao(ps, new Map(disp.map(d => [d.codigo, d])));
    return '<div class="sp-doc"><h1>Lista de separação SP ' + esc(b) + '</h1><p>' + esc(new Date().toLocaleString('pt-BR')) + ' · ' + ps.length + ' pedido(s): ' + esc(ps.map(p => p.numero).join(', ')) + '</p>' +
      '<table><thead><tr><th>✓</th><th>Local</th><th>Código</th><th>Produto</th><th>Qtde</th><th>Un</th><th>Pedidos</th></tr></thead><tbody>' +
      l.map(x => '<tr><td class="cx"></td><td>' + esc(x.localizacao) + '</td><td>' + esc(x.codigo) + '</td><td>' + esc(x.descricao) + '</td><td class="n">' + qtd(x.quantidade) + '</td><td>' + esc(x.unidade) + '</td><td>' +
        esc(x.pedidos.map(y => y.numero + ': ' + qtd(y.quantidade)).join(' · ')) + '</td></tr>').join('') + '</tbody></table>' +
      ps.map(p => htmlPedidoImpresso(p, true)).join('') + '</div>';
  }
  function htmlPedidoImpresso(p, quebra) {
    const d = p.dados || {};
    return '<section class="sp-ped' + (quebra ? ' quebra' : '') + '"><h2>Pedido ' + esc(p.numero) + ' · ' + esc(nomeCliente(p)) + '</h2>' +
      '<p>' + esc([P.entregaTexto(d.entrega), d.telefone, p.entrega ? 'Entrega ' + R.dataBR(p.entrega) : '', d.transportadora ? 'Transporte: ' + d.transportadora : '', d.volumes ? d.volumes + ' volume(s)' : ''].filter(Boolean).join(' · ')) + '</p>' +
      (d.texto_nota ? '<p><strong>Texto da nota:</strong> ' + esc(d.texto_nota) + '</p>' : '') + (d.observacoes ? '<p><strong>Obs.:</strong> ' + esc(d.observacoes) + '</p>' : '') +
      '<table><thead><tr><th>✓</th><th>Item</th><th>Código</th><th>Produto</th><th>Qtde</th><th>Un</th></tr></thead><tbody>' +
      (p.itens || []).map((it, i) => '<tr><td class="cx"></td><td>' + (i + 1) + '</td><td>' + esc(it.codigo || '') + '</td><td>' + esc(it.descricao) + '</td><td class="n">' + qtd(it.quantidade) + '</td><td>' + esc(it.unidade || '') + '</td></tr>').join('') +
      '</tbody></table><p class="ass">Separado por: ____________________ &nbsp; Conferido por: ____________________</p></section>';
  }

  // ------------------------------------------------ pedido aberto (Dados / Produtos / Comentários)
  function telaPedido(p) {
    const s = P.situacao(p, notaNumero(p)), d = p.dados || {}, ctx = ctxDe(p.vendedor_id), t = P.totais(p.itens, p.frete, ctx);
    const fs = faltasDe(p.id), gest = CRM.ehGestor();
    const bAbertos = P.bloqueiosAbertos(p);
    const botoes = [];
    if (podeEditar(p)) botoes.push('<button type="button" class="btn sec" data-acao="pd-editar" data-id="' + esc(p.id) + '">Editar</button>');
    if (gest && p.situacao === 'aberto' && (p.bloqueios || []).length) botoes.push(bAbertos.length ? '<button type="button" class="btn verde" data-acao="pd-liberar" data-id="' + esc(p.id) + '">Liberar</button>'
      : '<button type="button" class="btn sec" data-acao="pd-desliberar" data-id="' + esc(p.id) + '">Desfazer liberação</button>');
    if (gest && p.situacao === 'aberto' && ((p.bloqueios || []).indexOf('SEM ENTRADA') !== -1 || p.entrada_ok)) botoes.push('<button type="button" class="btn sec" data-acao="pd-entrada" data-id="' + esc(p.id) + '">' + (p.entrada_ok ? 'Desfazer "entrada recebida"' : 'Entrada recebida') + '</button>');
    if (ehOp() && p.situacao === 'aberto' && !bAbertos.length) botoes.push('<button type="button" class="btn" data-acao="pd-bolao-um" data-id="' + esc(p.id) + '">Mandar para separação</button>');
    if (ehOp() && p.situacao === 'separacao') botoes.push('<button type="button" class="btn verde" data-acao="pd-separado" data-id="' + esc(p.id) + '">Separado ✓</button>');
    if (ehOp() && (p.situacao === 'separacao' || p.situacao === 'separado')) botoes.push('<button type="button" class="btn sec" data-acao="pd-voltar-aberto" data-id="' + esc(p.id) + '">Voltar ao aberto</button>');
    if (CRM.nfe && CRM.nfe.podeEmitir(p)) botoes.push('<button type="button" class="btn' + (p.situacao === 'separado' ? ' verde' : '') + '" data-acao="nf-emitir" data-id="' + esc(p.id) + '">Emitir NF-e</button>');
    if (ehOp() && ['aberto', 'separacao', 'separado'].indexOf(p.situacao) !== -1) botoes.push('<button type="button" class="btn sec" data-acao="pd-faturar" data-id="' + esc(p.id) + '" title="ligar a nota que o FKN emitiu">Faturar (nota do FKN)…</button>');
    if (gest && p.situacao === 'faturado') botoes.push('<button type="button" class="btn sec" data-acao="pd-desfaturar" data-id="' + esc(p.id) + '">Desfazer faturado</button>');
    if ((p.situacao === 'aberto' && ehVenda()) || (ehOp() && ['separacao', 'separado'].indexOf(p.situacao) !== -1)) botoes.push('<button type="button" class="btn perigo" data-acao="pd-cancelar" data-id="' + esc(p.id) + '">Cancelar pedido</button>');
    botoes.push('<button type="button" class="btn sec" data-acao="pd-imprimir" data-id="' + esc(p.id) + '">Imprimir</button>');
    if (ehVenda() && p.negocio_id && CRM.negocio(p.negocio_id)) botoes.push('<button type="button" class="mini" data-acao="abrir-negocio" data-id="' + esc(p.negocio_id) + '">negócio</button>');
    const campo = (rot, v) => '<dt>' + esc(rot) + '</dt><dd>' + esc(v == null || v === '' ? '—' : v) + '</dd>';
    const abas = [['dados', 'Dados cadastrais'], ['produtos', 'Produtos'], ['comentarios', 'Comentários' + ((p.comentarios || []).length ? ' (' + p.comentarios.length + ')' : '')]];
    let corpo;
    if (abaPed === 'dados') {
      corpo = '<dl class="dados grade pd-dados">' + campo('Cliente', nomeCliente(p)) + campo('Vendedor(a)', CRM.nomeUsuario(p.vendedor_id)) + campo('Data do pedido', quando(p.criado_em)) +
        campo('Tipo de pedido', p.tipo === 'programado' ? 'Programado' : 'Normal') + campo('Faturar em / entrega', p.entrega ? R.dataBR(p.entrega) : '') + campo('Tabela', 'PADRAO') +
        campo('Natureza', d.nat_oper || '5102 — venda no estado') + campo('Forma de pagamento', d.pagamento) + campo('Transportadora', d.transportadora) +
        campo('Frete por conta', (P.FRETE_CONTA.find(x => x[0] === String(d.frete_conta)) || [, ''])[1]) + campo('Valor do frete', R.moeda(p.frete)) + campo('Volumes', d.volumes) +
        campo('Seu pedido', d.seu_pedido) + campo('A/C', d.ac) + campo('Referente', d.referente) + campo('Orçamento', d.numero_orcamento) +
        campo('Entrega', P.entregaTexto(d.entrega)) + campo('Observações', d.observacoes) + campo('Texto da nota', d.texto_nota) +
        (p.liberado_em ? campo('Liberado', quando(p.liberado_em) + ' por ' + CRM.nomeUsuario(p.liberado_por) + ' (' + (p.liberado || []).join(', ') + ')') : '') +
        (p.cancelado_motivo ? campo('Motivo do cancelamento', p.cancelado_motivo) : '') + '</dl>';
    } else if (abaPed === 'comentarios') {
      corpo = ((p.comentarios || []).length ? '<ol class="linha-tempo">' + p.comentarios.map(c => '<li><strong>' + esc(c.nome || '') + '</strong> <small>' + esc(quando(c.quando)) + '</small><p>' + esc(c.texto) + '</p></li>').join('') + '</ol>' : '<p class="vazio">Nenhum comentário.</p>') +
        '<label class="campo largo"><span>Inserir comentário</span><textarea rows="3" data-pd-coment></textarea></label><p class="acoes"><button type="button" class="btn" data-acao="pd-comentar" data-id="' + esc(p.id) + '">Inserir comentário</button></p>';
    } else {
      corpo = gradeProdutos(p.itens || [], { ctx, faltas: fs, ler: true }) + rodapeTotais(t);
    }
    return '<section class="cartao pd-janela"><header class="pd-topo"><button type="button" class="btn sec" data-acao="pd-fechar">← Voltar</button><h2>Pedido ' + esc(p.numero) + ' · ' + esc(nomeCliente(p)) + '</h2>' + CRM.selo(s.rotulo, s.cor) + '</header>' +
      (bAbertos.length ? '<p class="alerta">Bloqueado por: <strong>' + esc(bAbertos.map(b => P.ROTULO_BLOQUEIO[b] || b).join(', ')) + '</strong>.' + (gest ? ' Confira e clique em "Liberar".' : ' Quem libera é a gestora.') + '</p>' : '') +
      '<p class="acoes">' + botoes.join(' ') + '</p>' + (CRM.nfe ? CRM.nfe.doPedido(p) : '') +
      '<div class="chips">' + abas.map(a => '<button type="button" class="chip-filtro' + (abaPed === a[0] ? ' ativo' : '') + '" data-acao="pd-aba-ped" data-id="' + a[0] + '">' + esc(a[1]) + '</button>').join('') + '</div>' + corpo + '</section>';
  }

  function gradeProdutos(itens, o) {
    const gest = veMargem();
    const falta = i => { const x = (o.faltas || []).find(y => y.idx === i); return x ? num(x.falta) : (o.estimaFalta ? o.estimaFalta(i) : 0); };
    return '<div class="tabela-rolagem"><table class="tabela pd-grade"><thead><tr><th>Item</th><th>Código</th><th>Nome do produto</th><th>Un</th><th class="num">Qtde</th><th class="num">Ñ atend.</th><th class="num">Preço un</th><th class="num">Desc</th>' +
      (gest ? '<th class="num">Margem</th>' : '') + '<th class="num">Preço total</th><th>Faixa</th><th class="num">Comis%</th><th class="num">Desc s/tab</th>' + (o.ler ? '' : '<th class="num">Disp.</th><th></th>') + '</tr></thead><tbody>' +
      (itens.length ? itens.map((it, i) => {
        const l = P.linha(it, o.ctx), fa = falta(i), d = porCod.get(it.codigo);
        return '<tr' + (o.sel === i ? ' class="sel"' : '') + '><td>' + String(i + 1).padStart(3, '0') + '</td><td>' + esc(it.codigo || '') + '</td><td>' + (it.codigo && CRM.produtos ? CRM.produtos.miniatura(it.codigo, 'pequena') : '') + esc(it.descricao) + (it.obs ? '<small>' + esc(it.obs) + '</small>' : '') + '</td><td>' + esc(it.unidade || '') + '</td>' +
          '<td class="num">' + qtd(it.quantidade) + '</td><td class="num">' + (fa > 0 ? '<strong class="neg">' + qtd(fa) + '</strong>' : '0') + '</td><td class="num">' + preco(it.preco) + '</td><td class="num">' + preco(it.desconto) + '</td>' +
          (gest ? '<td class="num">' + (l.margem == null ? '—' : l.abaixoMinimo ? '<strong class="neg" title="abaixo da margem mínima: precisa da liberação da gestora">' + pct(l.margem) + '</strong>' : pct(l.margem)) + '</td>' : '') + '<td class="num">' + preco(l.total) + '</td><td>' + esc(P.rotuloFaixa(l.faixa)) + '</td><td class="num">' + (l.comissao == null ? '—' : preco(l.comissao)) + '</td>' +
          '<td class="num">' + (l.sobreTab == null ? '—' : preco(l.sobreTab)) + '</td>' +
          (o.ler ? '' : '<td class="num">' + (d ? qtd(Math.floor(num(d.disponivel) * 1000) / 1000) : '—') + '</td><td class="num"><button type="button" class="mini" data-acao="pd-item-editar" data-id="' + i + '" title="Alterar o item">✎</button>' +
            '<button type="button" class="mini" data-acao="pd-item-excluir" data-id="' + i + '" title="Excluir o item">×</button></td>') + '</tr>';
      }).join('') : '<tr><td colspan="15" class="vazio">Nenhum item.</td></tr>') + '</tbody></table></div>';
  }
  function rodapeTotais(t) {
    return '<div class="pd-totais"><span>Total dos produtos <strong>' + R.moeda(t.produtos) + '</strong></span><span>Frete <strong>' + R.moeda(t.frete) + '</strong></span>' +
      (veMargem() ? '<span>Margem <strong>' + pct(t.margem) + '</strong></span>' : '') + '<span>Comissão <strong>' + R.moeda(t.comissao) + (t.comissaoPct != null ? ' (' + pct(t.comissaoPct) + ')' : '') + '</strong></span>' +
      '<span class="geral">Total geral <strong>' + R.moeda(t.geral) + '</strong></span></div>';
  }

  // ------------------------------------------------ editor (orçamento / pedido)
  const PAGAMENTOS = ['28 DIAS BOLETO', '30 DIAS BOLETO', '30/60 DIAS BOLETO', '30/60/90 DIAS BOLETO', 'A VISTA BOLETO', 'A VISTA PIX', 'A VISTA TRANSFERENCIA', 'CARTAO DE CREDITO'];
  function novoEd(o) {
    o = o || {};
    const e = o.empresa_id ? CRM.empresa(o.empresa_id) : null;
    return Object.assign({ id: null, numero: null, empresa_id: null, negocio_id: null, proposta_id: null, vendedor_id: (e && e.responsavel_id) || CRM.meuId(), tipo: 'normal', entrega: null, frete: 0,
      dados: { pagamento: '', transportadora: 'PROPRIO', frete_conta: '0', volumes: '', seu_pedido: '', ac: '', referente: '', validade_dias: 7, prazo_entrega: '', observacoes: '', texto_nota: '', entrega: P.entregaDoCliente(e) },
      itens: [], aba: 'dados', sel: null, seq: 1, linha: { codigo: '', descricao: '', unidade: '', quantidade: '', preco: '', desconto: 0 } }, o);
  }
  function edDePedido(p) {
    return novoEd({ id: p.id, numero: p.numero, empresa_id: p.empresa_id, negocio_id: p.negocio_id, proposta_id: p.proposta_id, vendedor_id: p.vendedor_id, tipo: p.tipo, entrega: p.entrega, frete: num(p.frete),
      dados: Object.assign(novoEd().dados, p.dados || {}), itens: (p.itens || []).map(it => Object.assign({}, it)), aba: 'produtos' });
  }
  function edDeProposta(pr) {
    const n = CRM.negocio(pr.negocio_id), d = pr.dados || {}, e = n && CRM.empresa(n.empresa_id);
    const x = novoEd({ empresa_id: n ? n.empresa_id : null, negocio_id: pr.negocio_id, proposta_id: pr.id, vendedor_id: (n && n.responsavel_id) || CRM.meuId(), frete: num(d.frete), aba: 'produtos' });
    Object.assign(x.dados, { pagamento: [d.pagamento, d.cobranca].filter(Boolean).join(' ') || x.dados.pagamento, transportadora: d.transportadora || x.dados.transportadora, ac: d.ac || '', referente: d.ref || d.referente || '',
      seu_pedido: d.seu_pedido || '', prazo_entrega: d.prazo_entrega || '', numero_orcamento: pr.numero_fkn || pr.numero, entrega: d.entrega || P.entregaDoCliente(e) });
    if (d.frete_conta != null) x.dados.frete_conta = String(d.frete_conta);
    x.itens = P.itensDaProposta(pr).map(it => completa(it));
    return x;
  }
  // Item com o que o disponível sabe do produto (preço de tabela, custo para quem vê, unidade).
  // A caixa vendida com o código da unidade e "CX" (como sai na nota) vira o código da caixa (".1"): preço, custo e fator dela.
  function completa(it) {
    let cod = it.codigo ? String(it.codigo).replace(/\.0+$/, '') : null;
    if (cod && String(it.unidade || '').toUpperCase() === 'CX' && !/\.\d+$/.test(cod)) {
      const b = porCod.get(cod), v = b && String(b.unidade || '').toUpperCase() !== 'CX' && disp.find(x => x.base === cod && /\.\d+$/.test(x.codigo));
      if (v) cod = v.codigo;
    }
    const d = cod ? porCod.get(cod) : null;
    return Object.assign({}, it, { codigo: cod, unidade: it.unidade || (d && d.unidade) || '', preco_tab: d ? d.preco_venda : it.preco_tab, custo: d && d.custo != null ? d.custo : it.custo });
  }
  // Ñ atend. estimado no editor: o disponível de agora (com a reserva deste pedido devolvida, se já gravado).
  function estimador() {
    const meu = ed.id && ped(ed.id), devolve = new Map();
    if (meu && meu.situacao === 'aberto') (meu.itens || []).forEach(it => { if (it.base) devolve.set(it.base, (devolve.get(it.base) || 0) + num(it.qtd_est)); });
    const usado = new Map(), est = [];
    ed.itens.forEach((it, i) => {
      const d = porCod.get(it.codigo); if (!d) { est[i] = 0; return; }
      const fat = num(d.fator) || 1, base = d.base || it.codigo;
      const livre = num(d.disponivel) * fat + (devolve.get(base) || 0) - (usado.get(base) || 0);
      const q = num(it.quantidade) * fat;
      usado.set(base, (usado.get(base) || 0) + q);
      est[i] = q > livre + 0.0005 ? Math.round((q - Math.max(livre, 0)) / fat * 1000) / 1000 : 0;
    });
    return i => est[i] || 0;
  }

  function telaEditor() {
    const x = ed, e = x.empresa_id ? CRM.empresa(x.empresa_id) : null, d = x.dados, ctx = ctxDe(x.vendedor_id), t = P.totais(x.itens, x.frete, ctx);
    const abas = [['dados', 'Dados cadastrais'], ['produtos', 'Produtos (' + x.itens.length + ')']];
    const inp = (rot, chave, v, extra) => '<label class="campo"><span>' + esc(rot) + '</span><input data-ed="' + chave + '" value="' + esc(v == null ? '' : v) + '"' + (extra || '') + ' autocomplete="off"></label>';
    const pags = [...new Set(PAGAMENTOS.concat((E().D.propostas || []).map(p => p.dados && p.dados.pagamento).filter(Boolean)))].slice(0, 60);
    let corpo;
    if (x.aba === 'dados') {
      const emps = R.ordemAlfa(E().D.empresas || [], c => c.nome);   // em ordem alfabética (pedido do Anderson)
      corpo = '<div class="campos pd-campos">' +
        '<label class="campo largo"><span>Cliente *</span><input data-ed-cliente list="pdClientes" value="' + esc(e ? e.nome + (e.cnpj ? ' · ' + e.cnpj : '') : '') + '" placeholder="Nome, CNPJ ou cidade" autocomplete="off"></label>' +
        '<datalist id="pdClientes">' + emps.slice(0, 5000).map(c => '<option value="' + esc(c.nome + (c.cnpj ? ' · ' + c.cnpj : '')) + '">' + esc([c.cidade, CRM.nomeUsuario(c.responsavel_id)].filter(Boolean).join(' · ')) + '</option>').join('') + '</datalist>' +
        (CRM.ehGestor() ? '<label class="campo"><span>Vendedor(a)</span><select data-ed="vendedor_id">' + CRM.opcoesHTML(CRM.opcoesUsuarios(), x.vendedor_id) + '</select></label>'
          : '<label class="campo"><span>Vendedor(a)</span><input value="' + esc(CRM.nomeUsuario(x.vendedor_id)) + '" disabled></label>') +
        '<label class="campo"><span>Tabela</span><input value="PADRAO" disabled></label>' +
        '<label class="campo"><span>Tipo de pedido</span><select data-ed="tipo">' + CRM.opcoesHTML([['normal', 'Normal'], ['programado', 'Programado']], x.tipo) + '</select></label>' +
        '<label class="campo"><span>Faturar em / entrega</span><input type="date" data-ed="entrega" value="' + esc(x.entrega || '') + '"></label>' +
        '<label class="campo"><span>Forma de pagamento</span><input data-ed="dados.pagamento" list="pdPags" value="' + esc(d.pagamento) + '" autocomplete="off"></label><datalist id="pdPags">' + R.ordemAlfa(pags).map(s => '<option value="' + esc(s) + '">').join('') + '</datalist>' +
        inp('Transportadora', 'dados.transportadora', d.transportadora) +
        '<label class="campo"><span>Frete por conta</span><select data-ed="dados.frete_conta">' + CRM.opcoesHTML(P.FRETE_CONTA, d.frete_conta) + '</select></label>' +
        inp('Valor do frete (R$)', 'frete', x.frete || '', ' type="number" step="0.01" min="0" inputmode="decimal"') + inp('Qtde de volumes', 'dados.volumes', d.volumes, ' type="number" min="0"') +
        inp('Seu pedido', 'dados.seu_pedido', d.seu_pedido) + inp('A/C Sr(a)', 'dados.ac', d.ac) + inp('Referente', 'dados.referente', d.referente) +
        inp('Validade do orçamento (dias)', 'dados.validade_dias', d.validade_dias, ' type="number" min="1"') + inp('Prazo de entrega', 'dados.prazo_entrega', d.prazo_entrega) +
        '<h3 class="largo">Local de entrega</h3>' + inp('Endereço', 'dados.entrega.endereco', d.entrega.endereco) + inp('Nº', 'dados.entrega.numero', d.entrega.numero) + inp('Compl.', 'dados.entrega.compl', d.entrega.compl) +
        inp('Bairro', 'dados.entrega.bairro', d.entrega.bairro) + inp('Cidade', 'dados.entrega.cidade', d.entrega.cidade) + inp('UF', 'dados.entrega.uf', d.entrega.uf) + inp('CEP', 'dados.entrega.cep', d.entrega.cep) +
        '<label class="campo largo"><span>Observações</span><textarea data-ed="dados.observacoes" rows="2">' + esc(d.observacoes) + '</textarea></label>' +
        '<label class="campo largo"><span>Texto da nota</span><textarea data-ed="dados.texto_nota" rows="2" placeholder="ex.: horário de recebimento, A/C">' + esc(d.texto_nota) + '</textarea></label></div>';
    } else {
      const l = x.linha, dd = l.codigo ? porCod.get(l.codigo) : null, lin = P.linha(Object.assign({}, l, { preco_tab: dd ? dd.preco_venda : null, custo: dd ? dd.custo : null }), ctx);
      const tab = P.tabelaDe(E().cfg);
      corpo = listaProdutosHTML + '<div class="pd-entrada">' +
        '<label class="campo largo"><span>Produto (código ou nome) — item ' + (x.sel != null ? x.sel + 1 : x.itens.length + 1) + '</span><input id="pdProd" list="pdProdutos" value="' + esc(l.codigo ? l.codigo + ' — ' + l.descricao : l.descricao) + '" placeholder="digite o código ou parte do nome" autocomplete="off"></label>' +
        '<label class="campo"><span>Qtde' + (l.unidade ? ' (' + esc(l.unidade) + ')' : '') + '</span><input id="pdQtd" data-seq="' + x.seq + '" type="number" step="any" min="0" value="' + esc(l.quantidade) + '" inputmode="decimal"></label>' +
        '<label class="campo"><span>Preço un</span><input id="pdPreco" data-seq="' + x.seq + '" type="number" step="any" min="0" value="' + esc(l.preco) + '" inputmode="decimal"></label>' +
        '<label class="campo"><span>Desc %</span><input id="pdDesc" data-seq="' + x.seq + '" type="number" step="any" min="0" max="100" value="' + esc(l.desconto) + '" inputmode="decimal"></label>' +
        (CRM.produtos ? '<button type="button" class="btn sec pd-procurar" data-acao="pd-procurar-foto" title="Procurar no estoque com foto, disponível e preço">🔍 Procurar com foto</button>' : '') +
        '<div class="pd-info" id="pdInfo">' + (dd && CRM.produtos ? '<button type="button" class="pd-info-foto" data-acao="pf-ficha" data-id="' + esc(dd.codigo) + '" title="Ver a ficha do produto">' + CRM.produtos.miniatura(dd.codigo) + '</button>' : '') + (dd ? 'Disponível <strong class="' + (num(dd.disponivel) < num(l.quantidade) ? 'neg' : '') + '">' + qtd(Math.floor(num(dd.disponivel) * 1000) / 1000) + ' ' + esc(dd.unidade || '') + '</strong>' +
          (CRM.aCaminho && CRM.aCaminho.texto(dd.codigo, dd.unidade) ? ' · <strong>' + esc(CRM.aCaminho.texto(dd.codigo, dd.unidade)) + '</strong>' : dd.a_caminho ? ' · a caminho ' + qtd(dd.a_caminho) + ' (FKN, sem data)' : '') + ' · preço tabela R$ ' + preco(dd.preco_venda) + ' · líquido R$ ' + preco(lin.precoLiq) + ' · total R$ ' + preco(lin.total) +
          ' · faixa ' + esc(P.rotuloFaixa(lin.faixa)) + (lin.comissao != null ? ' · comissão ' + preco(lin.comissao) + '%' : '') + (veCusto() && dd.custo != null ? ' · custo R$ ' + preco(dd.custo) : '') + (veMargem() && lin.margem != null ? ' · margem <strong class="' + (lin.abaixoMinimo ? 'neg' : '') + '">' + pct(lin.margem) + '</strong>' +
            (lin.abaixoMinimo ? ' <strong class="neg">abaixo da margem mínima de ' + pct(P.margemMinima(E().cfg)) + ': o pedido fica bloqueado até a gestora liberar</strong>' : '') : '') +
          (!veMargem() && P.abaixoDaTabela(lin) ? ' <strong class="neg">abaixo da tabela A: o pedido pode ficar bloqueado até a gestora liberar</strong>' : '') : 'Escolha o produto: o CRM mostra o disponível e o preço da tabela.') + '</div>' +
        (dd && num(dd.preco_venda) > 0 ? '<div class="pd-faixas">Tabela: ' + P.FAIXAS.slice().reverse().map(fx => '<button type="button" class="mini" data-acao="pd-faixa" data-id="' + fx + '" title="' + (tab[fx] >= 0 ? '+' : '') + tab[fx] + '%">' + P.rotuloFaixa(fx) + ' ' + preco(P.precoDaFaixa(dd.preco_venda, fx, tab)) + '</button>').join('') + '</div>' : '') +
        '<p class="acoes"><button type="button" class="btn" data-acao="pd-item-salvar">' + (x.sel != null ? 'Salvar item' : 'Inserir item') + '</button> ' + (x.sel != null || l.codigo ? '<button type="button" class="btn sec" data-acao="pd-item-cancelar">Cancelar item</button> ' : '') +
        (x.empresa_id ? '<button type="button" class="btn sec" data-acao="pd-ultimas">Últimas compras</button> <button type="button" class="btn sec" data-acao="pd-importar-ultimas">Importar últimas compras</button> <button type="button" class="btn sec" data-acao="pd-repetir" title="Repetir um pedido ou uma nota anterior do cliente, com os preços dela">Repetir pedido</button> ' : '') +
        (x.itens.length > 1 ? '<button type="button" class="mini" data-acao="pd-organizar">Organizar por nome</button>' : '') + '</p></div>' +
        gradeProdutos(x.itens, { ctx, sel: x.sel, estimaFalta: estimador() }) + rodapeTotais(t);
    }
    const titulo = x.id ? 'Pedido ' + x.numero : x.proposta_id ? 'Orçamento ' + (x.dados.numero_orcamento || '') + ' → pedido' : 'Novo orçamento / pedido';
    return '<section class="cartao pd-janela"><header class="pd-topo"><button type="button" class="btn sec" data-acao="pd-ed-sair">← Sair sem gravar</button><h2>' + esc(titulo) + (e ? ' · ' + esc(e.nome) : '') + '</h2></header>' +
      '<div class="chips">' + abas.map(a => '<button type="button" class="chip-filtro' + (x.aba === a[0] ? ' ativo' : '') + '" data-acao="pd-aba-ed" data-id="' + a[0] + '">' + esc(a[1]) + '</button>').join('') + '</div>' +
      corpo + '<p class="acoes pd-gravar">' + (!x.id ? '<button type="button" class="btn sec" data-acao="pd-salvar-orcamento">Salvar orçamento e gerar o PDF</button> ' : '') +
      '<button type="button" class="btn verde" data-acao="pd-gravar">' + (x.id ? 'Gravar as alterações do pedido' : 'Gravar pedido (reserva o estoque)') + '</button></p>' +
      '<p class="dica">Orçamento: vai para o negócio do cliente e sai no PDF da empresa (WhatsApp/e-mail na ficha). Pedido: reserva o estoque; se faltar produto, o cliente tiver duplicata em atraso, o pagamento for antecipado ou o preço ficar abaixo da tabela, ele fica <strong>bloqueado</strong> até a gestora liberar.</p></section>';
  }

  // valor do campo "data-ed" (ex.: dados.entrega.cidade) para o editor
  function poe(chave, v) {
    const k = chave.split('.'); let o = ed;
    while (k.length > 1) { const a = k.shift(); o[a] = o[a] || {}; o = o[a]; }
    o[k[0]] = chave === 'frete' ? num(v) : v;
  }
  function escolheProduto(texto) {
    const cod = String(texto || '').split(' — ')[0].trim();
    let d = porCod.get(cod) || porCod.get(cod.replace(/\.0+$/, ''));
    if (!d && String(texto || '').trim()) {
      const l = P.procura(disp, texto, 30), unid = l.filter(x => !/\.\d+$/.test(x.codigo));
      if (l.length === 1) d = l[0]; else if (unid.length === 1) d = unid[0];
      else if (l.length > 1) CRM.toast(l.length + ' produtos com esse nome: escolha na lista que aparece ao digitar (ou digite o código).', true);
    }
    const l = ed.linha;
    if (d) Object.assign(l, { codigo: d.codigo, descricao: d.descricao, unidade: d.unidade || '', preco: l.preco || (d.preco_venda ? Number(d.preco_venda) : '') });
    else Object.assign(l, { codigo: '', descricao: String(texto || '').trim(), unidade: '' });
  }
  // Lê a linha de digitação. Cada linha tem um número (seq): o Enter grava o item e o navegador ainda dispara o
  // "change" do campo antigo, que não pode escrever a quantidade e o preço dele na linha nova.
  function leLinha(c) {
    const l = ed.linha, g = id => c.querySelector('#' + id);
    if (g('pdQtd') && Number(g('pdQtd').dataset.seq) === ed.seq) { l.quantidade = g('pdQtd').value; l.preco = g('pdPreco').value; l.desconto = g('pdDesc').value; }
  }
  const linhaNova = () => { ed.seq = (ed.seq || 0) + 1; ed.sel = null; ed.linha = { codigo: '', descricao: '', unidade: '', quantidade: '', preco: '', desconto: 0 }; };
  function salvaItem() {
    const l = ed.linha;
    if (!l.codigo && !l.descricao) throw new Error('escolha o produto');
    if (!(num(l.quantidade) > 0)) throw new Error('diga a quantidade');
    const it = completa({ codigo: l.codigo || null, descricao: l.descricao, unidade: l.unidade || null, quantidade: num(l.quantidade), preco: num(l.preco), desconto: num(l.desconto) });
    if (ed.sel != null) ed.itens[ed.sel] = it; else ed.itens.push(it);
    linhaNova();
  }

  function paraGravar() {
    const x = ed, e = CRM.empresa(x.empresa_id);
    if (!e) throw new Error('escolha o cliente (aba Dados cadastrais)');
    if (!x.itens.length) throw new Error('o pedido não tem itens (aba Produtos)');
    const contato = (CRM.doEmpresa('contatos', e.id).find(c => c.principal) || CRM.doEmpresa('contatos', e.id)[0] || {});
    return { id: x.id, empresa_id: x.empresa_id, negocio_id: x.negocio_id, proposta_id: x.proposta_id, vendedor_id: x.vendedor_id, tipo: x.tipo, entrega: x.entrega || null, frete: num(x.frete),
      dados: Object.assign({}, x.dados, { cliente_nome: e.nome, cliente_doc: e.cnpj || null, telefone: contato.telefone || e.telefone || null }),
      itens: x.itens.map(it => ({ codigo: it.codigo, descricao: it.descricao, unidade: it.unidade, quantidade: num(it.quantidade), preco: num(it.preco), desconto: num(it.desconto), obs: it.obs || null })) };
  }

  async function gravarPedido() {
    const st = CRM.store(), dados = paraGravar(), eraNovo = !ed.id;
    const r = await st.pedidoGravar(dados);
    const pr = ed.proposta_id && (E().D.propostas || []).find(p => p.id === ed.proposta_id);
    const n = ed.negocio_id && CRM.negocio(ed.negocio_id);
    if (n) await CRM.auto.sistema(n.empresa_id, n.id, 'Pedido ' + r.numero + (eraNovo ? ' gravado' : ' alterado') + ': ' + (r.itens || []).length + ' itens, ' + R.moeda(r.valor_total));
    if (pr && eraNovo && pr.status !== 'aprovada') await CRM.atualizar('propostas', pr.id, { status: 'aprovada', respondida_em: CRM.hoje() }).catch(() => null);
    ed = null; aberto = r.id; abaPed = 'produtos';
    await recarrega();
    const b = P.bloqueiosAbertos(r);
    CRM.toast('Pedido ' + r.numero + ' gravado' + (b.length ? ' — BLOQUEADO por ' + b.map(x => P.ROTULO_BLOQUEIO[x] || x).join(', ') + ' (a gestora libera)' : ' e liberado para a separação') + '.', !!b.length);
    const neg = n && CRM.negocio(n.id);
    if (eraNovo && neg && neg.status === 'aberto' && CRM.podeEditarNegocio(neg) && confirm('Pedido gravado. Marcar o negócio "' + neg.titulo + '" como GANHO agora?')) CRM.fichas.formGanho(Object.assign({}, neg, { valor: r.valor_total }));
  }

  const funilVendas = () => { const fs = CRM.funis ? CRM.funis() : []; return fs.find(x => !/p[óo]s[\s-]*vendas?/i.test(x)) || fs[0] || 'Vendas'; };
  const etapaOrcamento = () => {
    const l = E().D.etapas.filter(x => (x.funil || 'Vendas') === funilVendas()).sort((a, b) => a.ordem - b.ordem);
    return l.find(x => /or[çc]amento|proposta/i.test(x.nome)) || l[0] || null;
  };
  async function salvarOrcamento() {
    const dados = paraGravar(), e = CRM.empresa(dados.empresa_id), x = ed;
    const alvo = CRM.fichas.pedeArquivoPdf ? await CRM.fichas.pedeArquivoPdf('Orcamento - ' + e.nome) : undefined;
    const itens = x.itens.map(it => ({ codigo: it.codigo, descricao: it.descricao, unidade: it.unidade, quantidade: num(it.quantidade), preco: num(it.preco), desconto: num(it.desconto), total: P.totalItem(it) }));
    const t = P.totais(x.itens, x.frete);
    let neg = x.negocio_id && CRM.negocio(x.negocio_id);
    const etapa = etapaOrcamento();
    if (!neg || neg.status !== 'aberto') {
      neg = await CRM.inserir('negocios', { empresa_id: e.id, titulo: 'Orçamento ' + e.nome, etapa_id: etapa ? etapa.id : null, status: 'aberto', valor: t.geral, responsavel_id: x.vendedor_id || CRM.meuId(), origem: 'Orçamento CRM' });
    } else neg = await CRM.auto.mudarNegocio(neg, { valor: t.geral });
    const antigos = CRM.doNegocio('negocio_itens', neg.id);
    if (antigos.length) await CRM.removerVarios('negocio_itens', antigos.map(y => y.id));
    await CRM.inserirVarios('negocio_itens', itens.map((it, i) => ({ negocio_id: neg.id, descricao: it.descricao + (it.unidade ? ' (' + it.unidade + ')' : ''), quantidade: it.quantidade, preco: it.preco, desconto: it.desconto, ordem: i })));
    const d = x.dados;
    const pd = { orcamento: true, pagamento: d.pagamento || null, prazo_entrega: d.prazo_entrega || null, frete: num(x.frete), frete_conta: d.frete_conta, transportadora: d.transportadora || null,
      endereco_entrega: P.entregaTexto(d.entrega) || null, entrega: d.entrega, ac: d.ac || null, ref: d.referente || null, seu_pedido: d.seu_pedido || null, volumes: d.volumes || null };
    const campos = { negocio_id: neg.id, itens, valor_total: t.geral, validade: R.somaDias(CRM.hoje(), num(d.validade_dias) || 7), condicoes: null, observacoes: d.observacoes || null, dados: pd };
    const pr = x.proposta_id && (E().D.propostas || []).find(p => p.id === x.proposta_id);
    const p = pr ? await CRM.atualizar('propostas', pr.id, campos) : await CRM.inserir('propostas', Object.assign({ status: 'rascunho' }, campos));
    await CRM.auto.sistema(e.id, neg.id, 'Orçamento ' + p.numero + ' feito no CRM: ' + itens.length + ' itens, ' + R.moeda(t.geral));
    ed.negocio_id = neg.id; ed.proposta_id = p.id; ed.dados.numero_orcamento = p.numero;
    CRM.toast('Orçamento ' + p.numero + ' salvo no negócio. Quando o cliente aprovar, clique em "Gravar pedido".');
    CRM.render();
    if (CRM.fichas.baixarPdfProposta) CRM.fichas.baixarPdfProposta(p, alvo).catch(CRM.falhou);
  }

  // Abrir o editor de fora (ficha do negócio, aba Orçamentos)

  // ------------------------------------------------ comissões (Fase 3b)
  const com = { mes: null, fechadas: null, mesCarregado: null, carregando: false, abertos: new Set() };
  const mesAtual = () => CRM.hoje().slice(0, 7);
  const mesAnterior = m => { const [a, b] = m.split('-').map(Number); return b === 1 ? (a - 1) + '-12' : a + '-' + String(b - 1).padStart(2, '0'); };
  const nomeMes = m => { const [a, b] = m.split('-').map(Number); return ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][b - 1] + ' de ' + a; };
  // Ajustes do mês (devolução, venda fora das condições) ficam no navegador do administrador até fechar o mês.
  const chaveAj = m => 'crm_comissao_ajustes_' + m;
  const ajustesDe = (m, uid) => { try { return (JSON.parse(localStorage.getItem(chaveAj(m)) || '{}')[uid]) || []; } catch (e) { return []; } };
  const poeAjustes = (m, uid, l) => { try { const o = JSON.parse(localStorage.getItem(chaveAj(m)) || '{}'); o[uid] = l; localStorage.setItem(chaveAj(m), JSON.stringify(o)); } catch (e) { /* sem navegador */ } };
  async function carregaComissoes() {
    if (com.carregando) return;
    com.carregando = true;
    try { com.fechadas = await CRM.store().comissoes(com.mes + '-01'); } catch (e) { com.fechadas = []; CRM.falhou(e); }
    com.mesCarregado = com.mes; com.carregando = false; CRM.render();
  }
  function previa(m) {
    const precos = new Map(), caixa = new Map();
    disp.forEach(d => { if (/\.\d+$/.test(d.codigo)) { if (!caixa.has(d.base) && d.preco_venda) caixa.set(d.base, num(d.preco_venda)); } else if (d.preco_venda) precos.set(d.codigo, num(d.preco_venda)); });
    const pedidoDaNota = new Map((peds || []).filter(p => p.nota_id).map(p => [p.nota_id, p]));
    const r = P.apuraComissao({ notas: E().D.notas || [], itensPorNota: E().ix.porNota, mes: m, dia: n => R.diaLocal(n.emitida_em), precos, precoCaixa: caixa, pedidoDaNota, cfg: E().cfg, usuarios: E().D.usuarios || [] });
    return CRM.ehAdmin() ? r : r.filter(g => g.user_id === CRM.meuId());
  }
  const linhaFx = pf => Object.keys(pf || {}).sort((a, b) => P.FAIXAS.concat(['ABAIXO']).indexOf(a) - P.FAIXAS.concat(['ABAIXO']).indexOf(b))
    .map(k => P.rotuloFaixa(k) + ' ' + R.moeda(pf[k].base) + ' × ' + preco(pf[k].pct) + '%').join(' · ');
  function telaComissoes() {
    const adm = CRM.ehAdmin();
    if (!com.mes) com.mes = adm ? mesAnterior(mesAtual()) : mesAtual();
    if (com.mesCarregado !== com.mes) { setTimeout(carregaComissoes, 0); return '<section class="cartao"><p class="vazio">Carregando…</p></section>'; }
    const meses = []; let m = mesAtual(); for (let i = 0; i < 13; i++) { meses.push([m, nomeMes(m)]); m = mesAnterior(m); }
    const fech = (com.fechadas || []).filter(c => c.fechado_em), fechado = fech.length > 0, reaberto = (com.fechadas || []).some(c => c.reaberto_em && !c.fechado_em);
    let corpo;
    if (fechado) {
      const rows = adm ? fech : fech.filter(c => c.user_id === CRM.meuId());
      corpo = '<p class="dica">Mês <strong>fechado</strong> em ' + esc(quando(fech[0].fechado_em)) + ' por ' + esc(CRM.nomeUsuario(fech[0].fechado_por)) + '. Estes valores não mudam mais' + (adm ? ' (para mexer, reabra).' : '.') + '</p>' +
        (rows.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Vendedor(a)</th><th>Plano</th><th class="num">Faturado</th><th class="num">Comissão</th><th>Ajustes</th><th class="num">A pagar</th></tr></thead><tbody>' +
          rows.map(c => '<tr><td><strong>' + esc(CRM.nomeUsuario(c.user_id)) + '</strong><small>' + esc(linhaFx((c.detalhe || {}).porFaixa)) + '</small></td><td>' + esc(c.plano || '') + '</td><td class="num">' + R.moeda(c.base) + '</td><td class="num">' + R.moeda(c.comissao) + '</td>' +
            '<td><small>' + esc((c.ajustes || []).map(a => R.moeda(a.valor) + ' ' + a.motivo).join(' · ') || '—') + '</small></td><td class="num"><strong>' + R.moeda(c.total) + '</strong></td></tr>').join('') + '</tbody></table></div>'
          : '<p class="vazio">Nenhuma comissão sua neste mês.</p>') +
        (adm ? '<p class="acoes"><button type="button" class="btn sec" data-acao="pd-com-reabrir">Reabrir o mês</button></p>' : '');
    } else {
      const l = previa(com.mes);
      const tot = l.reduce((s2, g) => s2 + P.totalComAjustes(g.comissao, ajustesDe(com.mes, g.user_id)), 0);
      corpo = '<p class="dica">' + (com.mes === mesAtual() ? 'Mês em andamento: é uma <strong>prévia</strong>, muda a cada nota que chega.' : 'Prévia do mês' + (reaberto ? ' (reaberto)' : '') + (adm ? ': confira, lance os ajustes (devolução, venda fora das condições) e feche.' : '; o administrador fecha o mês.')) +
        ' A comissão nasce na nota emitida, item a item, pela faixa do preço na tabela PADRAO e pelo plano de quem vendeu (o vendedor escrito na nota).</p>' +
        (l.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Vendedor(a)</th><th>Plano</th><th class="num">Notas</th><th class="num">Faturado</th><th class="num">Comissão</th>' + (adm ? '<th>Ajustes</th><th class="num">A pagar</th>' : '') + '</tr></thead><tbody>' +
          l.map(g => { const aj = ajustesDe(com.mes, g.user_id), ab = com.abertos.has(g.user_id);
            return '<tr><td><button type="button" class="link" data-acao="pd-com-abrir" data-id="' + esc(g.user_id) + '"><strong>' + (ab ? '▾ ' : '▸ ') + esc(g.nome) + '</strong></button><small>' + esc(linhaFx(g.porFaixa)) +
              (g.semTabela ? ' · ' + g.semTabela + ' item(ns) sem preço de tabela (contados como A)' : '') + '</small></td>' +
              '<td>' + esc(g.planoNome) + '</td><td class="num">' + g.notas.length + '</td><td class="num">' + R.moeda(g.base) + '</td><td class="num">' + R.moeda(g.comissao) + '</td>' +
              (adm ? '<td><small>' + esc(aj.map(a => R.moeda(a.valor) + ' ' + a.motivo).join(' · ')) + '</small> <button type="button" class="mini" data-acao="pd-com-ajuste" data-id="' + esc(g.user_id) + '">+ ajuste</button>' +
                (aj.length ? '<button type="button" class="mini" data-acao="pd-com-ajuste-limpa" data-id="' + esc(g.user_id) + '" title="Tirar os ajustes">×</button>' : '') + '</td><td class="num"><strong>' + R.moeda(P.totalComAjustes(g.comissao, aj)) + '</strong></td>' : '') + '</tr>' +
              (ab ? '<tr><td colspan="' + (adm ? 7 : 5) + '"><table class="tabela"><thead><tr><th>NF</th><th>Data</th><th>Cliente</th><th class="num">Faturado</th><th class="num">Comissão</th></tr></thead><tbody>' +
                g.notas.map(n => '<tr><td>' + esc(n.numero) + '</td><td>' + esc(R.dataBR(n.data)) + '</td><td>' + esc(n.cliente) + '</td><td class="num">' + R.moeda(n.base) + '</td><td class="num">' + R.moeda(n.comissao) + '</td></tr>').join('') + '</tbody></table></td></tr>' : '');
          }).join('') + '</tbody>' + (adm ? '<tfoot><tr><td colspan="6">Total</td><td class="num"><strong>' + R.moeda(tot) + '</strong></td></tr></tfoot>' : '') + '</table></div>'
          : '<p class="vazio">Nenhuma nota com vendedor(a) neste mês.</p>') +
        (adm && com.mes < mesAtual() && l.length ? '<p class="acoes"><button type="button" class="btn verde" data-acao="pd-com-fechar">Fechar ' + esc(nomeMes(com.mes)) + '</button></p>' : '');
    }
    return '<section class="cartao"><h2>' + (adm ? 'Comissões' : 'Minha comissão') + '</h2>' +
      '<p class="acoes"><label class="filtro-inline">Mês <select data-pd-com-mes>' + CRM.opcoesHTML(meses, com.mes) + '</select></label>' +
      (adm ? ' <button type="button" class="btn sec" data-acao="pd-com-config">Tabela de preços e planos de comissão</button>' : '') + '</p>' + corpo + '</section>';
  }
  function formConfigComissao() {
    const cfg = E().cfg, tab = P.tabelaDe(cfg), planos = P.planosDe(cfg).map(p => ({ id: p.id, nome: p.nome, faixas: Object.assign({}, p.faixas) }));
    const FX = ['ABAIXO', 'NEG', 'A', 'B', 'C', 'D', 'E', 'F'], TB = ['NEG', 'A', 'B', 'C', 'D', 'E', 'F'];
    const users = (E().D.usuarios || []).filter(u => u.ativo !== false && ['admin', 'gestor', 'vendedor'].indexOf(u.papel) !== -1);
    const atual = u => (cfg.comissao_usuarios || {})[u.user_id] || (u.papel === 'admin' ? 'nenhum' : planos[0].id);
    const inp = (nome, v) => '<input name="' + nome + '" type="number" step="any" value="' + esc(v == null ? '' : v) + '" class="pd-num">';
    CRM.abrirForm({
      titulo: 'Tabela de preços e planos de comissão', largura: 'extra', campos: [], valores: {},
      intro: 'A tabela PADRAO soma um percentual sobre o preço de venda do produto (o "ven" da listagem do FKN). A margem mínima trava o pedido (a gestora libera). Cada plano diz a comissão (%) de cada faixa; quem está "sem comissão" não entra na apuração.',
      htmlDepois: '<h3>Tabela de preços (%)</h3><div class="tabela-rolagem"><table class="tabela"><thead><tr>' + TB.map(k => '<th>' + P.rotuloFaixa(k) + '</th>').join('') + '</tr></thead><tbody><tr>' +
        TB.map(k => '<td>' + inp('tab_' + k, tab[k]) + '</td>').join('') + '</tr></tbody></table></div>' +
        '<p class="acoes"><label class="filtro-inline">Margem mínima (%) ' + inp('margem_minima', P.margemMinima(cfg)) + '</label> <label class="filtro-inline"><input type="checkbox" name="trava"' + (cfg.pedido_trava_preco === false ? '' : ' checked') + '> bloquear o pedido abaixo dela</label></p>' +
        '<h3>Planos de comissão (% por faixa)</h3><div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Plano</th>' + FX.map(k => '<th>' + (k === 'ABAIXO' ? 'abaixo neg.' : P.rotuloFaixa(k)) + '</th>').join('') + '</tr></thead><tbody>' +
        planos.concat([{ id: '', nome: '', faixas: {} }]).map((p, i) => '<tr><td><input name="pln_' + i + '" value="' + esc(p.nome) + '"' + (p.id ? '' : ' placeholder="novo plano (opcional)"') + '><input type="hidden" name="pli_' + i + '" value="' + esc(p.id) + '"></td>' +
          FX.map(k => '<td>' + inp('pl_' + i + '_' + k, p.faixas[k]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' +
        '<h3>Quem está em cada plano</h3><div class="campos">' + users.map(u => '<label class="campo"><span>' + esc(u.nome) + '</span><select name="us_' + esc(u.user_id) + '">' +
          CRM.opcoesHTML(planos.map(p => [p.id, p.nome]).concat([['nenhum', 'sem comissão']]), atual(u)) + '</select></label>').join('') + '</div>',
      salvarTexto: 'Salvar',
      aoSalvar: async (v, form) => {
        const g = n => (form.elements[n] ? form.elements[n].value : ''), nr = n => (String(g(n)).trim() === '' ? null : Number(String(g(n)).replace(',', '.')));
        const tabela = {};
        TB.forEach(k => { const x = nr('tab_' + k); if (x == null || !isFinite(x)) throw new Error('preencha a faixa ' + P.rotuloFaixa(k) + ' da tabela'); tabela[k] = x; });
        const novos = [];
        planos.concat([{ id: '' }]).forEach((p, i) => {
          const nome = String(g('pln_' + i)).trim(); if (!nome) return;
          const faixas = {}; FX.forEach(k => { const x = nr('pl_' + i + '_' + k); faixas[k] = x == null || !isFinite(x) ? 0 : x; });
          novos.push({ id: g('pli_' + i) || R.normaliza(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plano' + i, nome, faixas });
        });
        if (!novos.length) throw new Error('é preciso pelo menos um plano');
        const usuarios = {}; users.forEach(u => { usuarios[u.user_id] = g('us_' + u.user_id); });
        const mm = nr('margem_minima');
        await CRM.salvarConfig({ tabela_precos: tabela, comissao_planos: novos, comissao_usuarios: usuarios, margem_minima: mm == null ? 23 : mm, pedido_trava_preco: form.elements.trava.checked });
        CRM.toast('Tabela e planos salvos.');
        recarrega();
      }
    });
  }

  const fechaFichas = () => ['#dlgNegocio', '#dlgEmpresa', '#dlgLista'].forEach(s => { const d = document.querySelector(s); if (d && d.open) d.close(); });
  CRM.pedidos = {
    deProposta: async pid => {
      const pr = (E().D.propostas || []).find(p => p.id === pid); if (!pr) return;
      fechaFichas(); E().aba = 'pedidos'; aberto = null;
      if (peds === null) await carrega(true);
      const ja = (peds || []).find(p => p.proposta_id === pid && p.situacao !== 'cancelado');
      if (ja) { aberto = ja.id; CRM.toast('Este orçamento já virou o pedido ' + ja.numero + '.'); CRM.render(); return; }
      ed = edDeProposta(pr); CRM.render();
    },
    novo: async o => { fechaFichas(); E().aba = 'pedidos'; aberto = null; if (peds === null) await carrega(true); ed = novoEd(o || {}); CRM.render(); },
    abrir: async id => { fechaFichas(); E().aba = 'pedidos'; if (peds === null) await carrega(true); ed = null; aberto = id; CRM.render(); },
    doNegocio: id => (peds || []).filter(p => p.negocio_id === id),
    carregados: () => peds !== null,
    // para a emissão de NF-e (emissao.js)
    pedido: id => ped(id),
    recarregar: () => recarrega(),
    separados: () => (peds || []).filter(p => p.situacao === 'separado'),
    verNfe: async () => { fechaFichas(); E().aba = 'pedidos'; ed = null; aberto = null; f.ver = 'nfe'; if (peds === null) await carrega(true); CRM.render(); },
    // "+ Pedido" do catálogo com foto (produtos.js): põe o produto na linha de digitação do pedido aberto (ou de um novo)
    incluirItem: async cod => {
      fechaFichas(); E().aba = 'pedidos'; aberto = null;
      if (peds === null) await carrega(true);
      if (!ed) ed = novoEd({});
      ed.aba = 'produtos'; linhaNova(); escolheProduto(cod);
      CRM.render();
      setTimeout(() => { const q = document.querySelector('#pdQtd'); if (q) q.focus(); }, 80);
    }
  };

  CRM.telas.pedidos = {
    turmaSub: () => (ed ? 'editor' : aberto ? 'pedido' : f.ver),
    render() {
      if (peds === null) { setTimeout(() => carrega(), 0); return cabecalho() + '<div class="cartao"><p class="vazio">Carregando…</p></div>'; }
      if (ed) return cabecalho() + telaEditor();
      const p = aberto && ped(aberto);
      if (p) return cabecalho() + telaPedido(p);
      return cabecalho() + (f.ver === 'orcamentos' ? telaOrcamentos() : f.ver === 'estoque' ? telaEstoque() : f.ver === 'separacao' ? telaSeparacao() : f.ver === 'faltas' ? telaFaltas() : f.ver === 'comissoes' ? telaComissoes() : f.ver === 'nfe' && CRM.nfe ? CRM.nfe.tela() : telaLista());
    },
    depois(c) {
      const on = (sel, ev, fn) => c.querySelectorAll(sel).forEach(el => el.addEventListener(ev, () => fn(el)));
      if (CRM.nfe) CRM.nfe.depois(c);
      on('[data-pd-busca]', 'input', el => { f.busca = el.value; CRM.render(); });
      on('[data-pd-vend]', 'change', el => { f.vend = el.value; CRM.render(); });
      on('[data-pd-est]', 'input', el => { f.est = el.value; CRM.render(); });
      on('[data-pd-com-mes]', 'change', el => { com.mes = el.value; com.mesCarregado = null; CRM.render(); });
      on('[data-pd-marca]', 'change', el => { if (el.checked) f.marcados.add(el.dataset.pdMarca); else f.marcados.delete(el.dataset.pdMarca); CRM.render(); });
      on('[data-pd-sep]', 'change', async el => {
        const [id, i] = el.dataset.pdSep.split(':');
        try { const r = await CRM.store().pedidoSepararItem(id, Number(i), el.checked); peds = peds.map(p => (p.id === id ? r : p)); CRM.render(); } catch (e) { el.checked = !el.checked; CRM.falhou(e); }
      });
      if (!ed) return;
      on('[data-ed]', 'change', el => { poe(el.dataset.ed, el.value); if (el.dataset.ed === 'vendedor_id' || el.dataset.ed === 'frete') CRM.render(); });
      on('[data-ed-cliente]', 'change', el => {
        const v = el.value.trim(), emps = E().D.empresas || [];
        const e = emps.find(x => (x.nome + (x.cnpj ? ' · ' + x.cnpj : '')) === v) || (emps.filter(x => R.normaliza(x.nome) === R.normaliza(v)).length === 1 ? emps.find(x => R.normaliza(x.nome) === R.normaliza(v)) : null);
        if (!e) { CRM.toast('Escolha o cliente na lista (digite parte do nome ou o CNPJ).', true); return; }
        ed.empresa_id = e.id; ed.dados.entrega = P.entregaDoCliente(e);
        if (!CRM.ehGestor() || !ed.vendedor_id) ed.vendedor_id = CRM.ehGestor() ? e.responsavel_id || CRM.meuId() : CRM.meuId();
        const abertoNeg = CRM.doEmpresa('negocios', e.id).filter(n => n.status === 'aberto' && ((CRM.etapa(n.etapa_id) || {}).funil || 'Vendas') === funilVendas());
        if (!ed.negocio_id && abertoNeg.length === 1) ed.negocio_id = abertoNeg[0].id;
        CRM.render();
      });
      const prod = c.querySelector('#pdProd');
      if (prod) {
        prod.addEventListener('change', () => { leLinha(c); escolheProduto(prod.value); CRM.render(); setTimeout(() => { const q = document.querySelector('#pdQtd'); if (q) q.focus(); }, 30); });
        ['#pdQtd', '#pdPreco', '#pdDesc'].forEach(s => { const el = c.querySelector(s); if (!el) return;
          el.addEventListener('change', () => { leLinha(c); CRM.render(); });
          el.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); leLinha(c); try { salvaItem(); CRM.render(); setTimeout(() => { const p = document.querySelector('#pdProd'); if (p) p.focus(); }, 30); } catch (e) { CRM.toast(e.message, true); } } }); });
      }
    }
  };

  const vivo = fn => async id => { try { await fn(id); } catch (e) { CRM.falhou(e); } };
  const troca = r => { peds = (peds || []).map(p => (p.id === r.id ? r : p)); };
  Object.assign(CRM.acoes, {
    'pd-ver': id => { f.ver = id; f.bolao = null; aberto = null; CRM.render(); },
    'pd-sit': id => { f.sit = id; CRM.render(); },
    'pd-recarregar': () => recarrega(),
    'pd-abrir': id => { aberto = id; abaPed = 'produtos'; CRM.render(); },
    'pd-fechar': () => { aberto = null; CRM.render(); },
    'pd-aba-ped': id => { abaPed = id; CRM.render(); },
    'pd-novo': () => { aberto = null; ed = novoEd(); CRM.render(); },
    'pd-de-proposta': id => CRM.pedidos.deProposta(id),
    'pd-novo-negocio': id => { const n = CRM.negocio(id); if (n) CRM.pedidos.novo({ empresa_id: n.empresa_id, negocio_id: n.id, vendedor_id: n.responsavel_id || CRM.meuId() }); },
    'pd-editar': id => { const p = ped(id); if (p) { ed = edDePedido(p); aberto = null; CRM.render(); } },
    'pd-ed-sair': () => {
      const msg = ed && ed.proposta_id && !ed.id ? 'Sair? O orçamento ' + (ed.dados.numero_orcamento || '') + ' está salvo no negócio; o pedido não foi gravado (dá para virar pedido depois, na aba Orçamentos).'
        : 'Sair sem gravar? O que foi digitado se perde.';
      if (ed && ed.itens.length && !confirm(msg)) return; ed = null; CRM.render();
    },
    'pd-aba-ed': id => { const c = document.querySelector('.pd-janela'); if (c) leLinha(c); ed.aba = id; CRM.render(); },
    'pd-faixa': fx => { const c = document.querySelector('.pd-janela'); leLinha(c); const d = porCod.get(ed.linha.codigo); if (d) { ed.linha.preco = P.precoDaFaixa(d.preco_venda, fx, P.tabelaDe(E().cfg)); ed.linha.desconto = 0; } CRM.render(); },
    'pd-item-salvar': () => { const c = document.querySelector('.pd-janela'); leLinha(c); try { salvaItem(); CRM.render(); } catch (e) { CRM.toast(e.message, true); } },
    'pd-item-cancelar': () => { linhaNova(); CRM.render(); },
    'pd-procurar-foto': () => {
      const c = document.querySelector('.pd-janela'); if (c) leLinha(c);
      CRM.produtos.escolher(cod => { if (!ed) return; linhaNova(); escolheProduto(cod); CRM.render(); setTimeout(() => { const q = document.querySelector('#pdQtd'); if (q) q.focus(); }, 80); });
    },
    'pd-item-editar': i => { const it = ed.itens[Number(i)]; linhaNova(); ed.sel = Number(i); ed.linha = { codigo: it.codigo || '', descricao: it.descricao, unidade: it.unidade || '', quantidade: it.quantidade, preco: it.preco, desconto: it.desconto }; CRM.render(); },
    'pd-item-excluir': i => { ed.itens.splice(Number(i), 1); ed.sel = null; CRM.render(); },
    'pd-organizar': () => { ed.itens.sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR')); CRM.render(); },
    'pd-ultimas': () => {
      const u = P.ultimasCompras(CRM.doEmpresa('notas', ed.empresa_id), E().ix.porNota);
      CRM.abrirForm({ titulo: 'Últimas compras · ' + CRM.nomeEmpresa(ed.empresa_id), largura: 'largo', campos: [], salvarTexto: 'Fechar', aoSalvar: async () => {},
        intro: u.produtos.length ? 'O que o cliente comprou (pelas notas), da compra mais recente. Clique em "+" para pôr no pedido com a última quantidade e o último preço.' : 'Nenhuma nota deste cliente no CRM.',
        htmlDepois: u.produtos.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th class="num">Última qtde</th><th class="num">Último preço</th><th>Última compra</th><th class="num">Vezes</th><th class="num">Disp.</th><th></th></tr></thead><tbody>' +
          u.produtos.slice(0, 150).map((x, i) => { const d = porCod.get(x.codigo); return '<tr><td><strong>' + esc(x.descricao) + '</strong><small>' + esc(x.codigo) + '</small></td><td class="num">' + qtd(x.quantidade) + ' ' + esc(x.unidade) + '</td><td class="num">' + preco(x.preco) + '</td>' +
            '<td>' + esc(R.dataBR(R.diaLocal(x.ultima))) + ' · NF ' + esc(x.nota) + '</td><td class="num">' + x.vezes + '</td><td class="num">' + (d ? qtd(Math.floor(num(d.disponivel))) : '—') + '</td><td><button type="button" class="mini" data-acao="pd-ultima-add" data-id="' + i + '">+</button></td></tr>'; }).join('') + '</tbody></table></div>' : '' });
      CRM.pedidos._ultimas = u.produtos;
    },
    'pd-ultima-add': i => { const x = (CRM.pedidos._ultimas || [])[Number(i)]; if (!x) return; ed.itens.push(completa({ codigo: x.codigo || null, descricao: x.descricao, unidade: x.unidade, quantidade: x.quantidade, preco: x.preco, desconto: 0 })); CRM.toast(x.descricao + ' no pedido.'); CRM.render(); },
    'pd-importar-ultimas': () => {
      const u = P.ultimasCompras(CRM.doEmpresa('notas', ed.empresa_id), E().ix.porNota);
      if (!u.ultimaNota.length) { CRM.toast('Nenhuma nota deste cliente no CRM.', true); return; }
      u.ultimaNota.forEach(x => ed.itens.push(completa({ codigo: x.codigo || null, descricao: x.descricao, unidade: x.unidade, quantidade: x.quantidade, preco: x.preco, desconto: 0 })));
      CRM.toast(u.ultimaNota.length + ' item(ns) da última compra (preços dela; confira com a tabela).'); CRM.render();
    },
    'pd-gravar': vivo(gravarPedido),
    'pd-salvar-orcamento': vivo(salvarOrcamento),
    'pd-liberar': vivo(async id => { const p = ped(id); if (!confirm('Liberar o pedido ' + p.numero + ' (' + P.bloqueiosAbertos(p).map(b => P.ROTULO_BLOQUEIO[b] || b).join(', ') + ')?')) return; troca(await CRM.store().pedidoLiberar(id, true, null)); CRM.toast('Pedido liberado para a separação.'); CRM.render(); }),
    'pd-desliberar': vivo(async id => { troca(await CRM.store().pedidoLiberar(id, false, null)); CRM.render(); }),
    'pd-entrada': vivo(async id => { const p = ped(id); troca(await CRM.store().pedidoLiberar(id, null, !p.entrada_ok)); CRM.render(); }),
    'pd-cancelar': vivo(async id => { const p = ped(id); const m = prompt('Cancelar o pedido ' + p.numero + '? A reserva do estoque sai. Diga o motivo:'); if (!m) return; troca(await CRM.store().pedidoSituacao(id, 'cancelado', m)); await recarrega(); }),
    'pd-separado': vivo(async id => { const p = ped(id); if ((p.itens || []).some(i => !i.separado) && !confirm('Há itens sem a caixinha de conferido. Marcar o pedido ' + p.numero + ' como separado assim mesmo?')) return; troca(await CRM.store().pedidoSituacao(id, 'separado')); CRM.render(); }),
    'pd-voltar-aberto': vivo(async id => { if (!confirm('Tirar o pedido da separação (volta ao aberto)?')) return; troca(await CRM.store().pedidoSituacao(id, 'aberto')); await recarrega(); }),
    'pd-desfaturar': vivo(async id => { if (!confirm('Desfazer o faturado? O pedido volta a "a emitir NF" e reserva o estoque de novo.')) return; troca(await CRM.store().pedidoSituacao(id, 'desfaturar')); await recarrega(); }),
    'pd-faturar': vivo(async id => {
      const l = await CRM.store().pedidoNotasCandidatas(id);
      if (!l.length) { CRM.toast('Nenhuma nota deste cliente sem pedido desde a data do pedido. A nota chega pelo vigia; tente de novo depois.', true); return; }
      CRM.abrirForm({ titulo: 'Faturar o pedido ' + ped(id).numero, intro: 'Escolha a nota emitida para este pedido.',
        campos: [{ nome: 'nota', rotulo: 'Nota', tipo: 'select', obrigatorio: true, opcoes: l.map(n => [n.id, 'NF ' + n.numero + ' · ' + quando(n.emitida_em) + ' · ' + R.moeda(n.valor_total)]) }],
        valores: { nota: l[0].id }, salvarTexto: 'Faturar', aoSalvar: async v => { troca(await CRM.store().pedidoFaturar(id, v.nota)); await recarrega(); } });
    }),
    'pd-comentar': vivo(async id => { const t = document.querySelector('[data-pd-coment]'); if (!t || !t.value.trim()) return; troca(await CRM.store().pedidoComentar(id, t.value.trim())); CRM.render(); }),
    'pd-imprimir': id => { const p = ped(id); if (p) imprimir('<div class="sp-doc">' + htmlPedidoImpresso(p, false) + '</div>', 'Pedido ' + p.numero); },
    'pd-marcar-todos': () => { (peds || []).filter(p => P.situacao(p).chave === 'liberado').forEach(p => f.marcados.add(p.id)); CRM.render(); },
    'pd-bolao-montar': vivo(async () => {
      const ids = [...f.marcados].filter(id => ped(id) && P.situacao(ped(id)).chave === 'liberado');
      if (!ids.length) { CRM.toast('Marque os pedidos que vão sair.', true); return; }
      const b = await CRM.store().bolaoMontar(ids, null);
      f.marcados.clear(); f.bolao = b; await recarrega(); CRM.toast('Lista de separação SP ' + b + ' montada com ' + ids.length + ' pedido(s).');
    }),
    'pd-bolao-um': vivo(async id => { const b = await CRM.store().bolaoMontar([id], null); aberto = null; f.ver = 'separacao'; f.bolao = b; await recarrega(); }),
    'pd-bolao': id => { f.bolao = Number(id); CRM.render(); },
    'pd-bolao-voltar': () => { f.bolao = null; CRM.render(); },
    'pd-com-abrir': id => { if (com.abertos.has(id)) com.abertos.delete(id); else com.abertos.add(id); CRM.render(); },
    'pd-com-config': () => formConfigComissao(),
    'pd-com-ajuste': uid => CRM.abrirForm({ titulo: 'Ajuste na comissão · ' + CRM.nomeUsuario(uid) + ' · ' + nomeMes(com.mes),
      intro: 'Negativo desconta (ex.: −35,20 da devolução da NF 2701); positivo soma. Vai junto do fechamento do mês.',
      campos: [{ nome: 'valor', rotulo: 'Valor (R$)', tipo: 'numero', min: -1e9, obrigatorio: true }, { nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, largo: true }], valores: {},
      aoSalvar: async v => { poeAjustes(com.mes, uid, ajustesDe(com.mes, uid).concat([{ valor: v.valor, motivo: v.motivo }])); CRM.render(); } }),
    'pd-com-ajuste-limpa': uid => { if (confirm('Tirar os ajustes de ' + CRM.nomeUsuario(uid) + '?')) { poeAjustes(com.mes, uid, []); CRM.render(); } },
    'pd-com-fechar': vivo(async () => {
      const l = previa(com.mes);
      const tot = l.reduce((s2, g) => s2 + P.totalComAjustes(g.comissao, ajustesDe(com.mes, g.user_id)), 0);
      if (!confirm('Fechar as comissões de ' + nomeMes(com.mes) + '? ' + l.length + ' vendedor(es)(as), total a pagar ' + R.moeda(tot) + '.\nDepois de fechado, os valores não mudam (só reabrindo).')) return;
      const n = await CRM.store().comissaoFechar(com.mes + '-01', l.map(g => ({ user_id: g.user_id, plano: g.plano, base: g.base, comissao: g.comissao, ajustes: ajustesDe(com.mes, g.user_id),
        detalhe: { porFaixa: g.porFaixa, semTabela: g.semTabela, itens: g.itens, notas: g.notas.map(x => ({ numero: x.numero, data: x.data, cliente: x.cliente, base: x.base, comissao: x.comissao })) } })));
      CRM.toast(nomeMes(com.mes) + ' fechado: ' + n + ' vendedor(es)(as).'); com.mesCarregado = null; CRM.render();
    }),
    'pd-com-reabrir': vivo(async () => {
      if (!confirm('Reabrir as comissões de ' + nomeMes(com.mes) + '? Fica registrado quem reabriu e quando.')) return;
      await CRM.store().comissaoReabrir(com.mes + '-01'); com.mesCarregado = null; CRM.render();
    }),
    'pd-repetir': () => {
      const ps = (peds || []).filter(p => p.empresa_id === ed.empresa_id && p.id !== ed.id && p.situacao !== 'cancelado').slice(0, 10);
      const ns = CRM.doEmpresa('notas', ed.empresa_id).filter(n => !n.cancelada).slice().sort((a, b) => String(b.emitida_em).localeCompare(String(a.emitida_em))).slice(0, 10);
      const linha = (id, rot, data, valor, n) => '<tr><td><strong>' + esc(rot) + '</strong></td><td>' + esc(data) + '</td><td class="num">' + n + '</td><td class="num">' + R.moeda(valor) + '</td><td><button type="button" class="mini" data-acao="pd-repetir-usar" data-id="' + esc(id) + '">usar</button></td></tr>';
      CRM.abrirForm({ titulo: 'Repetir pedido · ' + CRM.nomeEmpresa(ed.empresa_id), largura: 'largo', campos: [], salvarTexto: 'Fechar', aoSalvar: async () => {},
        intro: 'Escolha um pedido do CRM ou uma nota do cliente: os itens entram com as quantidades e os preços dela (confira com a tabela de hoje).',
        htmlDepois: (ps.length || ns.length) ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Pedido / nota</th><th>Data</th><th class="num">Itens</th><th class="num">Valor</th><th></th></tr></thead><tbody>' +
          ps.map(p => linha('p:' + p.id, 'Pedido ' + p.numero, R.dataBR(R.diaLocal(p.criado_em)), p.valor_total, (p.itens || []).length)).join('') +
          ns.map(n => linha('n:' + n.id, 'NF ' + n.numero, R.dataBR(R.diaLocal(n.emitida_em)), n.valor_total, (E().ix.porNota.get(n.id) || []).length)).join('') + '</tbody></table></div>'
          : '<p class="vazio">Nenhum pedido nem nota deste cliente no CRM.</p>' });
    },
    'pd-repetir-usar': id => {
      const [t, x] = id.split(':');
      const its = t === 'p' ? P.itensParaRepetir(ped(x)) : P.itensParaRepetir(null, E().ix.porNota.get(x) || []);
      if (!its.length) { CRM.toast('Nada para repetir.', true); return; }
      if (ed.itens.length && confirm('O pedido já tem ' + ed.itens.length + ' item(ns). OK = trocar pelos do escolhido; Cancelar = juntar.')) ed.itens = [];
      its.forEach(i => ed.itens.push(completa(i)));
      const d = document.getElementById('dlgForm'); if (d && d.open) d.close();
      CRM.toast(its.length + ' item(ns) no pedido, com os preços de antes.'); CRM.render();
    },
    'pd-bolao-imprimir': id => imprimir(htmlBolaoImpresso(Number(id)), 'Lista de separacao SP ' + id)
  });
})(typeof window !== 'undefined' ? window : globalThis);
