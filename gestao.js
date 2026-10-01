/* CRM Sistemi Dalessi — Gestão (só administrador): o resumo do negócio numa tela.
   Parte pura (CRMGestao.painel / CRMGestao.compras, testada em testes/gestao.test.js) e a tela.
   Tudo sai do que já está no CRM: notas fiscais (faturamento real), negócios, atividades e metas.
   O "braço de compras" usa o ritmo de cada cliente e o que ele costuma levar para prever a
   demanda dos próximos dias — o CRM não conhece o estoque (isso fica no FKN). */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  const num = R.num;

  const somaValor = l => l.reduce((s, n) => s + num(n.valor_total), 0);
  const variacao = (a, b) => (b ? (a - b) / b * 100 : null);

  // Notas de venda (sem cancelada, com CFOP de venda) de um período, com o dono (carteira) do cliente.
  function vendas(D, ix, de, ate) {
    return (D.notas || []).filter(n => {
      const d = R.diaLocal(n.emitida_em);
      return d && d >= de && d <= ate && R.notaDeVenda(n, ix.porNota.get(n.id));
    });
  }
  // Quem vendeu: o vendedor escrito na nota; sem ele, a carteira do cliente.
  const donoDe = (ix, n) => { if (n.vendedor_id) return n.vendedor_id; if (n.vendedor_nome) return null; /* ex-vendedor */ const e = n.empresa_id && ix.porId.empresas.get(n.empresa_id); return e ? e.responsavel_id || null : null; };

  function resumoPeriodo(D, ix, de, ate) {
    const l = vendas(D, ix, de, ate);
    const clientes = new Set(l.map(n => n.empresa_id || n.cliente_doc || n.cliente_nome));
    const valor = somaValor(l);
    return { valor, notas: l.length, clientes: clientes.size, ticket: l.length ? valor / l.length : 0, lista: l };
  }

  // ------------------------------------------------------------ painel
  function painel(D, ix, cfg, hoje) {
    const mes = hoje.slice(0, 8) + '01';
    const fimMes = R.somaDias(R.somaMeses(mes, 1), -1);
    const mesPassado = R.somaMeses(mes, -1);
    const diaDoMes = +hoje.slice(8, 10), diasNoMes = +fimMes.slice(8, 10);
    // Mesmo ponto do mês passado (até o mesmo dia), para comparar sem esperar o mês fechar.
    const ateMesmoDia = R.somaDias(mesPassado, Math.min(diaDoMes, +R.somaDias(mes, -1).slice(8, 10)) - 1);
    const atual = resumoPeriodo(D, ix, mes, hoje);
    const anterior = resumoPeriodo(D, ix, mesPassado, R.somaDias(mes, -1));
    const anteriorMesmoDia = resumoPeriodo(D, ix, mesPassado, ateMesmoDia);
    const ano = resumoPeriodo(D, ix, hoje.slice(0, 4) + '-01-01', hoje);

    // Clientes novos no mês: primeira nota de venda do cliente cai neste mês.
    const primeira = new Map();
    vendas(D, ix, '0000-01-01', hoje).forEach(n => { const k = n.empresa_id || n.cliente_doc || n.cliente_nome, d = R.diaLocal(n.emitida_em); if (!primeira.has(k) || d < primeira.get(k)) primeira.set(k, d); });
    const novosMes = [...primeira.values()].filter(d => d >= mes).length;

    // Base de clientes: ativo = comprou nos últimos 90 dias.
    const limite90 = R.somaDias(hoje, -90);
    const compraram90 = new Set(vendas(D, ix, limite90, hoje).map(n => n.empresa_id).filter(Boolean));

    // Equipe: faturamento pela carteira do cliente, meta, contatos e atrasadas.
    const metas = (D.metas || []).filter(m => m.mes === mes);
    const equipe = (D.usuarios || []).filter(u => u.ativo !== false && u.papel !== 'admin').map(u => {
      const doMes = atual.lista.filter(n => donoDe(ix, n) === u.user_id);
      const doAno = ano.lista.filter(n => donoDe(ix, n) === u.user_id);
      const ativs = (D.atividades || []).filter(a => a.responsavel_id === u.user_id && a.tipo !== 'sistema');
      const contatos = ativs.filter(a => a.concluida && (R.diaLocal(a.concluida_em || a.data_hora) || '') >= mes).length;
      const contatosHoje = ativs.filter(a => a.concluida && R.diaLocal(a.concluida_em || a.data_hora) === hoje).length;
      const atrasadas = ativs.filter(a => !a.concluida && R.diaLocal(a.data_hora) < hoje).length;
      const meta = metas.filter(m => m.usuario_id === u.user_id).reduce((s, m) => s + num(m.valor), 0);
      const valorMes = somaValor(doMes);
      return { user_id: u.user_id, nome: u.nome, papel: u.papel, valorMes, notasMes: doMes.length, valorAno: somaValor(doAno), meta, pctMeta: meta ? valorMes / meta * 100 : null,
        contatos, contatosHoje, atrasadas, clientesAtivos: (D.empresas || []).filter(e => e.responsavel_id === u.user_id && compraram90.has(e.id)).length };
    }).sort((a, b) => b.valorMes - a.valorMes || b.valorAno - a.valorAno);

    // Funil do mês (negócios) e o que está aberto — só o funil de vendas: o de pós-venda
    // acompanha pedido já vendido e inflaria "abertos" e a conversão.
    const funis = [...new Set((D.etapas || []).map(e => e.funil || 'Vendas'))];
    const funilVendas = funis.find(f => !/p[óo]s[\s-]*vendas?/i.test(f)) || '';
    const funil = R.dashboard(D, ix, cfg, hoje, { periodo: R.periodo('mes', hoje), funil: funilVendas });

    // Clientes fiéis sumidos: têm ritmo, passaram de 2 ciclos sem comprar. "Em risco" = o que
    // costumavam comprar por mês.
    const sumidos = (D.empresas || []).map(e => {
      const r = ix.resumo.get(e.id);
      if (!r || !r.ritmo || !r.ultimaCompra) return null;
      const ciclo = R.cicloRecompra(e, r, cfg), dias = R.diasEntre(r.ultimaCompra, hoje);
      if (dias <= 2 * ciclo) return null;
      const meses = Math.max(1, R.diasEntre(r.primeiraCompra || r.ultimaCompra, r.ultimaCompra) / 30);
      return { empresa: e, dias, ciclo, porMes: r.totalComprado / meses, ultima: r.ultimaCompra };
    }).filter(Boolean).sort((a, b) => b.porMes - a.porMes);

    const fat = R.faturamento(D, ix, hoje, { periodo: R.periodo('ano', hoje) });
    const fat12 = R.faturamento(D, ix, hoje, { periodo: R.periodo('12meses', hoje) });
    return {
      mes: { de: mes, ate: fimMes, atual, anterior, anteriorMesmoDia, variacao: variacao(atual.valor, anteriorMesmoDia.valor),
        projecao: diaDoMes ? atual.valor / diaDoMes * diasNoMes : 0, novos: novosMes },
      ano, porMes: fat12.porMes, equipe, funil, funilVendas,
      base: { clientes: (D.empresas || []).filter(e => e.situacao === 'cliente').length, ativos: compraram90.size,
        leads: (D.empresas || []).filter(e => e.situacao === 'lead').length },
      topClientes: fat.topClientes.slice(0, 10), topProdutos: fat.topProdutosValor.slice(0, 10),
      sumidos, emRisco: sumidos.reduce((s, x) => s + x.porMes, 0)
    };
  }

  // ------------------------------------------------------------ estoque (leitores em fkn.js)
  const K = raiz.CRMFkn || (typeof require !== 'undefined' ? require('./fkn.js') : null);
  const { lerEstoque, lerListagemProdutos, lerArquivoEstoque, ehListagemProdutos, codigoFKN } = K;

  // Caixa fechada (variante 1) → quantas unidades: pela razão dos custos (caixa de 2 = 2× o custo)
  // ou, se não bater, pelo nome ("CX C/12", "CX.4X5").
  function fatorCaixa(u, c) {
    const cu = num(u.custo_compra) || num(u.custo_unit), cc = num(c.custo_compra) || num(c.custo_unit);
    const r = cu > 0 ? cc / cu : 0;
    if (r >= 1.5 && Math.abs(r - Math.round(r)) / r < 0.05) return Math.round(r);
    const m = /C\/\s*(\d+)/i.exec(c.descricao || '') || /CX\.?\s*(\d+)\s*X/i.exec(c.descricao || '');
    return m && +m[1] > 1 ? +m[1] : null;
  }
  // Junta a caixa fechada na unidade (estoque, pedido e mínimo em unidades) e devolve uma linha
  // por produto, sem mexer no que veio do banco.
  function juntaVariantes(estoque) {
    const porCod = new Map();
    (estoque || []).forEach(x => porCod.set(codigoFKN(x.codigo), Object.assign({}, x, { codigo: codigoFKN(x.codigo), quantidade: num(x.quantidade), custo_total: num(x.custo_total),
      pend_fornecedor: num(x.pend_fornecedor), estoque_min: num(x.estoque_min), estoque_max: num(x.estoque_max) })));
    porCod.forEach((c, cod) => {
      const m = /^(.+)\.(\d+)$/.exec(cod), u = m && porCod.get(m[1]);
      if (!u) return;
      const f = fatorCaixa(u, c);
      if (!f) return;
      // Pode ter mais de uma embalagem (caixa com 4, caixa com 2…): todas entram no saldo; a
      // sugestão de compra em caixas usa a maior.
      u.embalagens = (u.embalagens || []).concat({ codigo: cod, fator: f, saldo: c.quantidade });
      if (!u.caixa || f > u.caixa.fator) u.caixa = u.embalagens[u.embalagens.length - 1];
      u.quantidade += c.quantidade * f;
      u.custo_total += c.custo_total;
      u.pend_fornecedor += c.pend_fornecedor * f;
      u.estoque_min += c.estoque_min * f;
      u.estoque_max += c.estoque_max * f;
      porCod.delete(cod);
    });
    return [...porCod.values()];
  }

  // ------------------------------------------------------------ compras
  // Curva ABC (12 meses): A = produtos que somam os primeiros 80% do faturamento, B até 95%, C o resto.
  // Demanda prevista: cada cliente com ritmo e compra prevista até "dias" à frente (inclusive os que
  // já passaram da data, mas ainda não sumiram) soma a quantidade habitual de cada item.
  // Tendência: quantidade vendida nos últimos 90 dias × os 90 anteriores.
  function compras(D, ix, cfg, hoje, dias, estoque) {
    dias = dias || 30;
    const chaveItem = it => it.produto_id || (it.codigo ? 'c:' + R.normaliza(it.codigo) : 'd:' + R.normaliza(it.descricao));
    const prods = new Map();
    const pega = it => {
      const k = chaveItem(it);
      if (!prods.has(k)) prods.set(k, { chave: k, descricao: it.descricao, codigo: it.codigo || '', unidade: it.unidade || '', valor12: 0, qtd90: 0, qtd90ant: 0, clientes12: new Set(), prevista: 0, clientesPrevistos: 0 });
      return prods.get(k);
    };
    const d90 = R.somaDias(hoje, -90), d180 = R.somaDias(hoje, -180), d365 = R.somaDias(hoje, -365);
    vendas(D, ix, d365, hoje).forEach(n => {
      const d = R.diaLocal(n.emitida_em);
      (ix.porNota.get(n.id) || []).filter(it => R.cfopDeVenda(it.cfop)).forEach(it => {
        const g = pega(it);
        g.valor12 += num(it.valor_total);
        if (n.empresa_id) g.clientes12.add(n.empresa_id);
        if (d >= d90) g.qtd90 += num(it.quantidade);
        else if (d >= d180) g.qtd90ant += num(it.quantidade);
      });
    });

    const ate = R.somaDias(hoje, dias);
    const clientesPrevistos = [];
    (D.empresas || []).forEach(e => {
      const r = ix.resumo.get(e.id);
      if (!r || !r.ritmo || !r.ultimaCompra) return;
      const ciclo = R.cicloRecompra(e, r, cfg);
      const proxima = R.somaDias(r.ultimaCompra, ciclo);
      if (proxima > ate || R.diasEntre(r.ultimaCompra, hoje) > 2 * ciclo) return;
      const itens = R.itensHabituais(ix, e.id, 10);
      if (!itens.length) return;
      clientesPrevistos.push({ empresa: e, proxima, itens: itens.length });
      itens.forEach(it => {
        const k = it.produto_id || ('d:' + R.normaliza(it.descricao));
        const g = prods.get(k) || [...prods.values()].find(x => R.normaliza(x.descricao) === R.normaliza(it.descricao)) || pega({ descricao: it.descricao, unidade: it.unidade, produto_id: it.produto_id });
        g.prevista += num(it.quantidade); g.clientesPrevistos++;
      });
    });

    const lista = [...prods.values()].map(g => Object.assign(g, { clientes12: g.clientes12.size, mediaMensal: g.qtd90 / 3,
      tendencia: g.qtd90ant ? (g.qtd90 - g.qtd90ant) / g.qtd90ant * 100 : null }));
    const total12 = lista.reduce((s, g) => s + g.valor12, 0);
    let acum = 0;
    lista.slice().sort((a, b) => b.valor12 - a.valor12).forEach(g => {
      acum += g.valor12;
      const pct = total12 ? acum / total12 * 100 : 100;
      g.pctAcumulado = pct; g.classe = g.valor12 <= 0 ? 'C' : pct - (total12 ? g.valor12 / total12 * 100 : 0) < 80 ? 'A' : pct - (total12 ? g.valor12 / total12 * 100 : 0) < 95 ? 'B' : 'C';
    });
    const abc = { A: lista.filter(g => g.classe === 'A'), B: lista.filter(g => g.classe === 'B'), C: lista.filter(g => g.classe === 'C'), total: total12 };
    const demanda = lista.filter(g => g.prevista > 0).sort((a, b) => (a.classe < b.classe ? -1 : a.classe > b.classe ? 1 : 0) || b.clientesPrevistos - a.clientesPrevistos || b.prevista - a.prevista);
    const comMovimento = lista.filter(g => g.qtd90ant > 0 && g.qtd90 + g.qtd90ant >= 10 && g.tendencia != null);

    // Com o estoque do FKN: necessidade no período = o maior entre a previsão dos clientes e o
    // consumo médio dos últimos 90 dias. Comprar = necessidade (com piso no estoque mínimo do FKN)
    // − saldo − o que já foi pedido ao fornecedor (saldo negativo conta zero). A caixa fechada
    // entra no saldo da unidade (juntaVariantes).
    const itensEst = juntaVariantes(estoque);
    const est = new Map(itensEst.map(x => [x.codigo, x]));
    const estPorNome = new Map(itensEst.map(x => [R.normaliza(x.descricao), x]));
    const custoDe = x => (num(x.custo_unit) > 0 ? num(x.custo_unit) : x.quantidade > 0 && x.custo_total > 0 ? x.custo_total / x.quantidade : null);
    const usados = new Set();
    const aplica = (g, e) => {
      g.saldo = e.quantidade;
      g.custoUnit = custoDe(e);
      g.pedido = e.pend_fornecedor || 0;
      g.minimo = e.estoque_min || 0;
      g.maximo = e.estoque_max || 0;
      g.fornecedor = e.fornecedor || null; g.fornecedorCod = e.fornecedor_cod || null;
      g.linha = e.linha || null; g.familia = e.familia || null;
      g.inativo = e.situacao === 'INATIVO';
      g.caixa = e.caixa || null; g.embalagens = e.embalagens || null;
      g.precoVenda = num(e.preco_venda) || null;
      g.ultEntrada = e.ult_entrada || null;
      g.cobertura = g.consumoDia > 0 ? Math.max(0, g.saldo) / g.consumoDia : null;
      const alvo = Math.max(g.necessidade, g.minimo);
      g.comprar = g.inativo ? 0 : Math.max(0, Math.ceil(alvo - Math.max(0, g.saldo) - g.pedido - 1e-9));
      g.pelaMinimo = g.comprar > 0 && g.minimo > g.necessidade;
      g.caixas = g.caixa && g.comprar ? Math.ceil(g.comprar / g.caixa.fator) : null;
    };
    lista.forEach(g => {
      const e = (g.codigo && est.get(codigoFKN(g.codigo))) || estPorNome.get(R.normaliza(g.descricao));
      g.consumoDia = g.qtd90 / 90;
      g.necessidade = Math.max(g.prevista, g.consumoDia * dias);
      if (!e) { g.saldo = null; return; }
      usados.add(e.codigo);
      g.codigo = g.codigo || e.codigo;
      aplica(g, e);
    });
    const temEstoque = est.size > 0;
    const ordemClasse = { A: 0, B: 1, C: 2, '—': 3 };
    // Parado: tem saldo e custo, mas não vendeu nada em 90 dias.
    const vendeu90 = new Set(lista.filter(g => g.qtd90 > 0 && g.codigo).map(g => codigoFKN(g.codigo)));
    const parado = itensEst.filter(x => x.quantidade > 0 && x.custo_total > 0 && !vendeu90.has(x.codigo))
      .sort((a, b) => b.custo_total - a.custo_total);
    const positivos = itensEst.filter(x => x.quantidade > 0);
    // Todos os produtos para a tela Compras: os vendidos (com a conta acima) + os que só estão no estoque.
    const produtos = lista.slice();
    itensEst.forEach(x => {
      if (usados.has(x.codigo)) return;
      const g = { chave: 'e:' + x.codigo, descricao: x.descricao, codigo: x.codigo, unidade: x.unidade || '', valor12: 0, qtd90: 0, qtd90ant: 0,
        clientes12: 0, prevista: 0, clientesPrevistos: 0, classe: '—', consumoDia: 0, necessidade: 0, tendencia: null, soEstoque: true };
      aplica(g, x);
      produtos.push(g);
    });
    const paradoSet = new Set(parado.map(x => x.codigo));
    produtos.forEach(g => { g.parado = !!(g.codigo && paradoSet.has(codigoFKN(g.codigo))); g.emFalta = g.saldo != null && g.saldo <= 0 && g.qtd90 > 0; });
    const sugestao = temEstoque ? produtos.filter(g => g.saldo != null && g.comprar > 0)
      .sort((a, b) => ordemClasse[a.classe] - ordemClasse[b.classe] || b.valor12 - a.valor12) : [];
    const ruptura = temEstoque ? lista.filter(g => g.saldo != null && g.saldo <= 0 && g.qtd90 > 0).sort((a, b) => b.valor12 - a.valor12) : [];
    // Pedido por fornecedor: a sugestão agrupada (o que não tem fornecedor no FKN fica junto no fim).
    const porForn = new Map();
    sugestao.forEach(g => {
      const k = g.fornecedorCod || '';
      if (!porForn.has(k)) porForn.set(k, { cod: k, nome: g.fornecedor || 'Sem fornecedor no FKN', itens: [], custo: 0, semCusto: 0 });
      const f = porForn.get(k);
      f.itens.push(g); if (g.custoUnit) f.custo += g.custoUnit * g.comprar; else f.semCusto++;
    });
    const fornecedores = [...porForn.values()].sort((a, b) => (!a.cod) - (!b.cod) || b.custo - a.custo);
    const distintos = campo => [...new Set(produtos.map(g => g[campo]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const estoqueInfo = temEstoque ? {
      produtos: est.size, valor: positivos.reduce((s, x) => s + x.custo_total, 0),
      em: (estoque || []).reduce((m, x) => (x.atualizado_em && x.atualizado_em > m ? x.atualizado_em : m), ''),
      negativos: itensEst.filter(x => x.quantidade < 0).length,
      valorSugestao: sugestao.reduce((s, g) => s + (g.custoUnit ? g.custoUnit * g.comprar : 0), 0),
      semCusto: sugestao.filter(g => !g.custoUnit).length,
      valorParado: parado.reduce((s, x) => s + x.custo_total, 0),
      completo: itensEst.some(x => x.fornecedor_cod !== undefined || x.estoque_min > 0), // veio da listagem cadastral
      pedidos: itensEst.filter(x => x.pend_fornecedor > 0).length
    } : null;
    return { dias, demanda, produtos, estoque: estoqueInfo, sugestao, ruptura, parado, pedidoPorFornecedor: fornecedores,
      listas: { fornecedores: distintos('fornecedor'), linhas: distintos('linha'), familias: distintos('familia') }, clientesPrevistos: clientesPrevistos.sort((a, b) => (a.proxima < b.proxima ? -1 : 1)), abc,
      emAlta: comMovimento.filter(g => g.tendencia >= 25).sort((a, b) => b.tendencia - a.tendencia).slice(0, 8),
      emQueda: comMovimento.filter(g => g.tendencia <= -25).sort((a, b) => a.tendencia - b.tendencia).slice(0, 8) };
  }

  const G = { painel, compras, lerEstoque, lerListagemProdutos, lerArquivoEstoque, ehListagemProdutos, juntaVariantes, fatorCaixa, codigoFKN };
  raiz.CRMGestao = G;
  if (typeof module !== 'undefined') module.exports = G;

  // ------------------------------------------------------------ tela
  const CRM = raiz.CRM;
  if (!CRM || !CRM.telas) return;
  const { esc } = CRM;
  const E = () => CRM.estado;
  let ultimo = null; // o que a tela mostrou (para exportar)
  let diasCompras = 30;
  let estoque = null;      // retrato do FKN (carregado sob demanda: só o administrador lê)
  let lendoEstoque = false;
  async function carregaEstoque() {
    if (lendoEstoque) return;
    lendoEstoque = true;
    try { estoque = CRM.store().estoque ? await CRM.store().estoque() : []; } catch (e) { estoque = []; CRM.falhou(e); }
    lendoEstoque = false;
    CRM.render();
  }

  const pct = v => (v == null ? '—' : (v > 0 ? '+' : '') + R.pct(v));
  const qtd = v => String(+Number(v || 0).toFixed(1)).replace('.', ',');
  const abrevia = v => (v >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' mi' : v >= 1e3 ? Math.round(v / 1e3) + ' mil' : String(Math.round(v)));
  // Com "acao": o quadro vira botão (abre a lista do que conta ou aplica o filtro).
  const kpi = (t, v, s, cls, acao, id) => (acao ? '<button type="button" class="kpi clicavel ' + (cls || '') + '" data-acao="' + acao + '" data-id="' + id + '" title="Ver quais são">' : '<div class="kpi ' + (cls || '') + '">') +
    '<span>' + esc(t) + '</span><strong>' + esc(v) + '</strong><small>' + s + '</small>' + (acao ? '</button>' : '</div>');
  const seta = v => (v == null ? '' : v >= 0 ? '<span class="g-sobe">▲ ' + esc(pct(v)) + '</span>' : '<span class="g-desce">▼ ' + esc(pct(v)) + '</span>');

  CRM.telas.gestao = {
    render() {
      if (!CRM.ehAdmin()) return '<div class="cartao"><p class="vazio">Esta tela é só do administrador.</p></div>';
      const hoje = CRM.hoje(), cfg = E().cfg;
      const p = G.painel(E().D, E().ix, cfg, hoje);
      if (estoque === null) setTimeout(carregaEstoque, 0);
      const c = G.compras(E().D, E().ix, cfg, hoje, diasCompras, estoque || []);
      ultimo = { p, c };
      const m = p.mes, f = p.funil;
      const maxMes = Math.max(1, ...p.porMes.map(x => x.valor));
      const nomeMes = new Date(hoje + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const semNotas = !(E().D.notas || []).length;

      return '<div class="cabecalho"><div><h1>Gestão</h1><p class="sub">Resumo de ' + esc(nomeMes) + ' até hoje · faturamento pelas notas fiscais · só você vê esta tela</p></div></div>' +
        (semNotas ? '<div class="cartao"><p class="vazio">Sem notas fiscais importadas: o faturamento, os tops e as compras aparecem quando as notas entrarem.</p></div>' : '') +
        // ---- números do mês
        '<section class="kpis">' +
          kpi('Faturamento do mês', R.moeda(m.atual.valor), seta(m.variacao) + ' vs. mesmo ponto de ' + esc(R.mesCurto(R.somaMeses(m.de, -1))) + ' (' + esc(R.moeda(m.anteriorMesmoDia.valor)) + ')', 'azul', 'gestao-lista', 'mes') +
          kpi('Projeção do mês', R.moeda(m.projecao), 'no ritmo atual · mês passado fechou em ' + esc(R.moeda(m.anterior.valor))) +
          kpi('Faturamento no ano', R.moeda(p.ano.valor), p.ano.notas + ' notas · ' + p.ano.clientes + ' clientes', '', 'gestao-lista', 'ano') +
          kpi('Clientes que compraram', String(m.atual.clientes), m.novos + ' novo(s) no mês · ticket ' + esc(R.moeda(m.atual.ticket)), 'verde', 'gestao-lista', 'clientes') +
          kpi('Negócios abertos', R.moeda(f.abertas.valor), f.abertas.qtd + ' negócios · ponderado pela chance ' + esc(R.moeda(f.abertas.ponderado)) + (p.funilVendas ? ' · ' + esc(p.funilVendas) : ''), '', 'gestao-lista', 'abertos') +
          kpi('Conversão do mês', f.conversao == null ? '—' : R.pct(f.conversao), f.realizadas.qtd + ' ganhos · ' + f.perdidas.qtd + ' perdidos' + (p.funilVendas ? ' · ' + esc(p.funilVendas) : ''), '', 'gestao-lista', 'decididos') +
        '</section>' +
        // ---- 12 meses + base
        '<div class="g-duas">' +
          '<section class="cartao"><h2>Faturamento por mês <small>12 meses</small></h2><div class="grafico-colunas">' + p.porMes.map(x => '<div class="col" title="' + esc(R.mesCurto(x.mes) + ': ' + R.moeda(x.valor) + ' (' + x.qtd + ' notas)') + '">' +
            '<span class="col-valor">' + (x.valor ? esc(abrevia(x.valor)) : '') + '</span><span class="col-barra"><span data-altura="' + (x.valor / maxMes * 100).toFixed(1) + '"></span></span><span class="col-rot">' + esc(R.mesCurto(x.mes)) + '</span></div>').join('') + '</div></section>' +
          '<section class="cartao"><h2>Base de clientes</h2><dl class="g-base">' +
            '<div><dt>Clientes</dt><dd>' + p.base.clientes + '</dd></div><div><dt>Compraram nos últimos 90 dias</dt><dd>' + p.base.ativos + '</dd></div>' +
            '<div><dt>Leads na base</dt><dd>' + p.base.leads + '</dd></div><div><dt>Fiéis que sumiram</dt><dd>' + p.sumidos.length + ' <small>' + esc(R.moeda(p.emRisco)) + '/mês em risco</small></dd></div>' +
          '</dl></section>' +
        '</div>' +
        // ---- equipe
        '<section class="cartao"><h2>Equipe <small>faturamento pela carteira do cliente</small></h2><div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Vendedora</th><th class="num">Mês</th><th class="num">Meta</th><th class="num">Ano</th><th class="num">Clientes ativos</th><th class="num">Contatos no mês</th><th class="num">Hoje</th><th class="num">Atrasadas</th></tr></thead><tbody>' +
          p.equipe.map(u => '<tr><td><strong>' + esc(u.nome) + '</strong></td><td class="num">' + esc(R.moeda(u.valorMes)) + '</td><td class="num">' + (u.meta ? CRM.barra(u.valorMes, u.meta, R.pct(u.pctMeta)) : '—') + '</td>' +
            '<td class="num">' + esc(R.moeda(u.valorAno)) + '</td><td class="num">' + u.clientesAtivos + '</td><td class="num">' + u.contatos + '</td><td class="num">' + u.contatosHoje + '</td>' +
            '<td class="num">' + (u.atrasadas ? CRM.selo(String(u.atrasadas), u.atrasadas > 10 ? 'vermelho' : 'ambar') : '0') + '</td></tr>').join('') + '</tbody></table></div></section>' +
        // ---- tops
        '<div class="g-duas">' +
          '<section class="cartao"><h2>Top 10 clientes <small>no ano</small></h2>' + listaTop(p.topClientes.map(x => ({ nome: x.nome, valor: x.valor, info: x.notas + ' notas · última ' + R.dataBR(x.ultima), id: x.empresa_id })), p.ano.valor) + '</section>' +
          '<section class="cartao"><h2>Top 10 produtos <small>no ano</small></h2>' + listaTop(p.topProdutos.map(x => ({ nome: R.nomeDeItem(x.descricao), valor: x.valor, info: qtd(x.quantidade) + ' ' + (x.unidade || '') + ' · ' + x.clientes + ' clientes' })), p.ano.valor) + '</section>' +
        '</div>' +
        // ---- clientes em risco
        '<section class="cartao"><h2>Clientes fiéis que sumiram <small>passaram de 2 ciclos sem comprar · ordenados pelo que compravam por mês</small></h2>' +
          (p.sumidos.length ? '<ul class="lista">' + p.sumidos.slice(0, 10).map(s => '<li><button type="button" class="linha" data-acao="abrir-empresa" data-id="' + esc(s.empresa.id) + '"><strong>' + esc(s.empresa.nome) + '</strong><small>' +
            esc(R.moeda(s.porMes)) + '/mês · comprava a cada ~' + s.ciclo + ' dias · sem comprar há ' + s.dias + ' dias · ' + esc(CRM.nomeUsuario(s.empresa.responsavel_id)) + '</small></button>' + CRM.acoesRapidas(s.empresa.id) + '</li>').join('') + '</ul>' +
            (p.sumidos.length > 10 ? '<p class="mais">e mais ' + (p.sumidos.length - 10) + '…</p>' : '') : '<p class="vazio">Nenhum cliente fiel parado. 👍</p>') + '</section>' +
        // ---- compras (o detalhe fica na aba Compras)
        '<section class="cartao"><h2>Compras <small>resumo · o detalhe, com filtros e pesquisa, fica na aba Compras</small><span class="flex"></span><button type="button" class="btn sec" data-acao="aba" data-id="compras">Abrir Compras</button></h2>' +
          (c.estoque ? '<dl class="g-base g-base-4"><div><dt>Estoque a custo</dt><dd>' + esc(R.moeda(c.estoque.valor)) + '</dd></div><div><dt>Sugestão de pedido (' + c.dias + ' dias)</dt><dd>' + esc(R.moeda(c.estoque.valorSugestao)) + ' <small>' + c.sugestao.length + ' produtos</small></dd></div>' +
            '<div><dt>Em falta</dt><dd>' + c.ruptura.length + ' <small>vendeu em 90 dias e está zerado</small></dd></div><div><dt>Estoque parado</dt><dd>' + esc(R.moeda(c.estoque.valorParado)) + ' <small>sem venda em 90 dias</small></dd></div></dl>' +
            '<p class="dica">Estoque do FKN de ' + esc(R.dataBR(c.estoque.em) + ' ' + R.horaLocal(c.estoque.em)) + '.</p>'
            : '<p class="vazio">Sem estoque do FKN ainda: em Compras, use "Atualizar estoque (listagem do FKN)".</p>') + '</section>' +
        (CRM.cartaoReceber ? CRM.cartaoReceber() : '');
    },
    depois() { if (CRM.depoisReceber) CRM.depoisReceber(); }
  };

  // ================================================================ Compras (admin e comprador)
  // Uma tabela de produtos com pesquisa e filtros: o que comprar, em falta, parado, vendidos ou
  // todo o estoque. Exporta exatamente o que está na tela.
  const fc = { busca: '', curva: '', mostrar: 'comprar', ordem: 'curva', fornecedor: '', linha: '' };
  const MOSTRAR = [['comprar', 'Sugestão de pedido (precisa comprar)'], ['falta', 'Em falta (vendeu e está zerado)'], ['parado', 'Estoque parado (sem venda em 90 dias)'],
    ['minimo', 'Abaixo do mínimo do FKN'], ['pedidos', 'Já pedidos ao fornecedor (chegando)'], ['vendidos', 'Vendidos nos últimos 12 meses'], ['todos', 'Todos os produtos']];
  const ORDEM = [['curva', 'Curva (A primeiro) e faturamento'], ['pedido', 'Maior custo do pedido'], ['dura', 'Acaba antes'], ['vendido', 'Mais vendido (R$ 12 meses)'],
    ['parado', 'Maior valor parado'], ['nome', 'Nome']];
  const OC = { A: 0, B: 1, C: 2, '—': 3 };
  // [chave, título, número?, valor para ordenar]
  const COLUNAS = [
    ['produto', 'Produto', false, g => R.normaliza(R.nomeDeItem(g.descricao))],
    ['fornecedor', 'Fornecedor', false, g => (g.fornecedor ? R.normaliza(g.fornecedor) : null)],
    ['curva', 'Curva', false, g => (g.classe === '—' ? null : OC[g.classe])],
    ['estoque', 'Estoque', true, g => g.saldo],
    ['minimo', 'Mín. FKN', true, g => g.minimo || null],
    ['pedido', 'Já pedido', true, g => g.pedido || null],
    ['consumo', 'Consumo/mês', true, g => (g.consumoDia ? g.consumoDia * 30 : null)],
    ['dura', 'Dura', true, g => g.cobertura],
    ['clientes', 'Clientes previstos', true, g => g.clientesPrevistos || null],
    ['precisa', 'Precisa', true, g => g.necessidade || null],
    ['comprar', 'Comprar', true, g => g.comprar || null],
    ['custo', 'Custo do pedido', true, g => (g.comprar && g.custoUnit ? g.custoUnit * g.comprar : null)],
    ['vendido', 'Vendido 12 meses', true, g => g.valor12 || null],
    ['tendencia', 'Tendência', true, g => g.tendencia]
  ];
  const cabecalhoCompras = () => COLUNAS.map(c => {
    const ativo = fc.col === c[0], seta = ativo ? (fc.dir === 'desc' ? ' ▼' : ' ▲') : '';
    return '<th class="ordenavel' + (c[2] ? ' num' : '') + (ativo ? ' ativo' : '') + '" data-acao="compras-coluna" data-id="' + c[0] + '" title="Ordenar por ' + esc(c[1]) + ' (clique de novo para inverter)"' +
      (ativo ? ' aria-sort="' + (fc.dir === 'desc' ? 'descending' : 'ascending') + '"' : '') + '>' + esc(c[1]) + seta + '</th>';
  }).join('');
  function filtraProdutos(c) {
    const q = R.normaliza(fc.busca);
    let l = c.produtos.filter(g => {
      if (fc.curva && g.classe !== fc.curva) return false;
      if (fc.fornecedor && (fc.fornecedor === '-' ? g.fornecedor : g.fornecedor !== fc.fornecedor)) return false;
      if (fc.linha && g.linha !== fc.linha) return false;
      if (q && R.normaliza(g.descricao).indexOf(q) === -1 && String(g.codigo || '').indexOf(fc.busca.trim()) === -1) return false;
      if (fc.mostrar === 'comprar') return g.comprar > 0;
      if (fc.mostrar === 'falta') return g.emFalta;
      if (fc.mostrar === 'parado') return g.parado;
      if (fc.mostrar === 'minimo') return g.minimo > 0 && !g.inativo && (g.saldo || 0) + (g.pedido || 0) < g.minimo;
      if (fc.mostrar === 'pedidos') return g.pedido > 0;
      if (fc.mostrar === 'vendidos') return g.valor12 > 0;
      return true;
    });
    const custoPedido = g => (g.custoUnit ? g.custoUnit * (g.comprar || 0) : 0);
    const valorParado = g => (g.saldo > 0 && g.custoUnit ? g.saldo * g.custoUnit : 0);
    // Clique no cabeçalho: ordena por aquela coluna; clicar de novo inverte (como no Excel).
    if (fc.col) {
      const v = COLUNAS.find(x => x[0] === fc.col);
      if (v) {
        const f = v[3], dir = fc.dir === 'desc' ? -1 : 1;
        return l.sort((a, b) => {
          const x = f(a), y = f(b);
          if (x == null && y == null) return 0;
          if (x == null) return 1; if (y == null) return -1; // vazio sempre no fim
          return (typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y) * dir;
        });
      }
    }
    const ord = {
      curva: (a, b) => OC[a.classe] - OC[b.classe] || b.valor12 - a.valor12,
      pedido: (a, b) => custoPedido(b) - custoPedido(a),
      dura: (a, b) => (a.cobertura == null ? 1e9 : a.cobertura) - (b.cobertura == null ? 1e9 : b.cobertura),
      vendido: (a, b) => b.valor12 - a.valor12,
      parado: (a, b) => valorParado(b) - valorParado(a),
      nome: (a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR')
    }[fc.ordem] || ((a, b) => 0);
    return l.sort(ord);
  }

  const LIMITE_COMPRAS = 400;
  CRM.telas.compras = {
    render() {
      if (!CRM.ehAdmin() && !CRM.ehComprador()) return '<div class="cartao"><p class="vazio">Esta tela é do administrador e do comprador.</p></div>';
      const hoje = CRM.hoje(), cfg = E().cfg;
      if (estoque === null) setTimeout(carregaEstoque, 0);
      const c = G.compras(E().D, E().ix, cfg, hoje, diasCompras, estoque || []);
      const e = c.estoque;
      const l = filtraProdutos(c);
      ultimo = Object.assign({}, ultimo || {}, { c, filtrados: l });
      const botao = '<label class="btn sec arquivo" title="No FKN: Listagem cadastral de produtos (SIFN108), salvar em CSV. O CSV simples de estoque também serve.">Atualizar estoque (listagem do FKN)<input type="file" id="gEstoque" accept=".csv,.txt,text/csv"></label>';
      const velho = e && e.em && R.diasEntre(R.diaLocal(e.em), hoje) > 3;
      const curva = g => (g.classe === '—' ? '<small>—</small>' : CRM.selo(g.classe, g.classe === 'A' ? 'verde' : g.classe === 'B' ? 'azul' : 'etiqueta'));
      const custo = g => (g.comprar && g.custoUnit ? R.moeda(g.custoUnit * g.comprar) : '—');
      const lemb = CRM.lembreteFkn ? CRM.lembreteFkn() : [];
      const faixaFkn = lemb.length ? '<div class="faixa alerta lembrete-fkn"><strong>Hora de puxar ' + (lemb.length > 1 ? 'os relatórios' : 'o relatório') + ' do FKN (' + esc(lemb[0].turno) + '):</strong> ' +
        lemb.map(x => esc(x.arquivo) + ' <small>(último: ' + (x.ultimo ? esc(R.dataBR(R.diaLocal(x.ultimo)) + ' ' + R.horaLocal(x.ultimo)) : 'nunca') + ')</small>').join(' · ') +
        '. No FKN, gere e salve em CSV ' + (cfg.pasta_fkn ? 'na pasta <code>' + esc(cfg.pasta_fkn) + '</code>' : 'na pasta que o vigia olha') + ': o vigia manda sozinho e este aviso some.</div>' : '';
      return faixaFkn + '<div class="cabecalho"><div><h1>Compras</h1><p class="sub">' +
          (e ? 'Estoque do FKN de <strong>' + esc(R.dataBR(e.em) + ' ' + R.horaLocal(e.em)) + '</strong>' + (velho ? ' ' + CRM.selo('desatualizado: exporte de novo no FKN', 'ambar') : '') + ' · ' + e.produtos + ' produtos'
            : 'Sem estoque do FKN ainda: exporte a posição de estoque em CSV no FKN e clique em "Atualizar estoque"') +
          '</p></div><span class="flex"></span>' + botao + '</div>' +
        (e ? '<section class="kpis">' +
          kpi('Estoque a custo', R.moeda(e.valor), (e.negativos ? e.negativos + ' com saldo negativo no FKN' : 'saldo positivo'), 'azul') +
          kpi('Sugestão de pedido', R.moeda(e.valorSugestao), c.sugestao.length + ' produtos para ' + c.dias + ' dias' + (e.semCusto ? ' · ' + e.semCusto + ' sem custo' : ''), 'verde', 'compras-kpi', 'comprar') +
          kpi('Em falta', String(c.ruptura.length), 'vendeu em 90 dias e está zerado', c.ruptura.length ? 'vermelho' : '', 'compras-kpi', 'falta') +
          kpi('Estoque parado', R.moeda(e.valorParado), c.parado.length + ' produtos sem venda em 90 dias', '', 'compras-kpi', 'parado') +
          kpi('Curva A', String(c.abc.A.length), 'produtos que fazem 80% do faturamento', '', 'compras-kpi', 'A') +
        '</section>' : '') +
        '<section class="cartao"><div class="filtros-compras">' +
          '<input type="search" id="cBusca" placeholder="Pesquisar produto ou código" value="' + esc(fc.busca) + '" aria-label="Pesquisar produto ou código">' +
          '<select id="cMostrar" aria-label="O que mostrar">' + CRM.opcoesHTML(MOSTRAR, fc.mostrar) + '</select>' +
          '<select id="cCurva" aria-label="Curva">' + CRM.opcoesHTML([['', 'Todas as curvas'], ['A', 'Curva A'], ['B', 'Curva B'], ['C', 'Curva C']], fc.curva) + '</select>' +
          (c.listas.fornecedores.length ? '<select id="cFornecedor" aria-label="Fornecedor">' + CRM.opcoesHTML([['', 'Todos os fornecedores']].concat(c.listas.fornecedores.map(f => [f, f]), [['-', 'Sem fornecedor no FKN']]), fc.fornecedor) + '</select>' : '') +
          (c.listas.linhas.length ? '<select id="cLinha" aria-label="Linha">' + CRM.opcoesHTML([['', 'Todas as linhas']].concat(c.listas.linhas.map(f => [f, f])), fc.linha) + '</select>' : '') +
          '<select id="gDias" aria-label="Prazo">' + CRM.opcoesHTML([['15', 'Para 15 dias'], ['30', 'Para 30 dias'], ['45', 'Para 45 dias'], ['60', 'Para 60 dias'], ['90', 'Para 90 dias']], String(c.dias)) + '</select>' +
          '<select id="cOrdem" aria-label="Ordenar">' + CRM.opcoesHTML(ORDEM, fc.ordem) + '</select>' +
          '<button type="button" class="btn sec" data-acao="compras-exportar" title="Baixa uma planilha (abre no Excel) com os produtos que estão na tabela, com estes filtros">Baixar planilha (' + l.length + ' produtos)</button>' +
        '</div>' +
        '<p class="dica">Precisa = o maior entre o que os clientes devem pedir (pelo ritmo e pelos itens de sempre) e o consumo médio dos últimos 90 dias no prazo. ' +
          'Comprar = precisa (no mínimo o estoque mínimo do FKN) − estoque − o que já foi pedido ao fornecedor. O estoque do FKN já desconta o reservado para cliente, e a caixa fechada entra em unidades.' +
          (e && !e.completo ? ' <strong>Para ter fornecedor, mínimo e pedidos em aberto, use a Listagem cadastral de produtos do FKN (SIFN108) em CSV.</strong>' : '') + '</p>' +
        (l.length ? '<div class="tabela-rolagem tabela-fixa"><table class="tabela compras"><thead><tr>' + cabecalhoCompras() + '</tr></thead><tbody>' +
          l.slice(0, LIMITE_COMPRAS).map(g => '<tr><td>' + esc(R.nomeDeItem(g.descricao)) + ' <small>' + esc(g.codigo || '') + '</small>' + (g.inativo ? ' ' + CRM.selo('inativo no FKN', 'etiqueta') : '') + '</td>' +
            '<td class="forn" title="' + esc(g.fornecedor || '') + '"><small>' + esc(g.fornecedor || '—') + '</small></td><td>' + curva(g) + '</td>' +
            '<td class="num">' + (g.saldo == null ? '—' : g.saldo < 0 ? CRM.selo(qtd(g.saldo), 'vermelho') : qtd(g.saldo)) + ' <small>' + esc(g.unidade) + '</small>' +
              (g.embalagens && g.embalagens.some(x => x.saldo) ? '<br><small>' + g.embalagens.filter(x => x.saldo).map(x => qtd(x.saldo) + ' cx de ' + x.fator).join(' + ') + '</small>' : '') + '</td>' +
            '<td class="num">' + (g.minimo ? qtd(g.minimo) : '—') + '</td><td class="num">' + (g.pedido ? qtd(g.pedido) : '—') + '</td>' +
            '<td class="num">' + (g.consumoDia ? qtd(g.consumoDia * 30) : '—') + '</td>' +
            '<td class="num">' + (g.cobertura == null ? '—' : g.cobertura < 1 ? CRM.selo('acabou', 'vermelho') : Math.round(g.cobertura) + ' dias') + '</td>' +
            '<td class="num">' + (g.clientesPrevistos || '—') + '</td><td class="num">' + (g.necessidade ? qtd(g.necessidade) : '—') + '</td>' +
            '<td class="num">' + (g.comprar ? '<strong>' + g.comprar + '</strong>' + (g.caixas ? '<br><small>' + g.caixas + ' cx de ' + g.caixa.fator + '</small>' : '') + (g.pelaMinimo ? '<br><small>pelo mínimo</small>' : '') : '—') + '</td><td class="num">' + esc(custo(g)) + '</td>' +
            '<td class="num">' + (g.valor12 ? esc(R.moeda(g.valor12)) : '—') + '</td><td class="num">' + (g.tendencia == null ? '—' : seta(g.tendencia)) + '</td></tr>').join('') +
          '</tbody></table></div>' + (l.length > LIMITE_COMPRAS ? '<p class="mais">Mostrando ' + LIMITE_COMPRAS + ' de ' + l.length + '; o arquivo exportado tem todos.</p>' : '')
          : '<p class="vazio">Nenhum produto com esses filtros.</p>') + '</section>' +
        cartaoPorFornecedor(c) +
        '<div class="g-duas">' +
          '<section class="cartao"><h2>Clientes com compra prevista <small>' + c.clientesPrevistos.length + ' até ' + esc(R.dataBR(R.somaDias(hoje, c.dias))) + '</small></h2>' +
            (c.clientesPrevistos.length ? '<ul class="g-tend">' + c.clientesPrevistos.slice(0, 15).map(x => '<li><span>' + esc(x.empresa.nome) + '</span><strong>' + esc(R.dataBR(x.proxima)) + '</strong><small>' +
              (x.proxima < hoje ? 'já passou da data · ' : '') + x.itens + ' item(ns) de sempre</small></li>').join('') + '</ul>' + (c.clientesPrevistos.length > 15 ? '<p class="mais">e mais ' + (c.clientesPrevistos.length - 15) + '…</p>' : '')
              : '<p class="vazio">Nenhum cliente com ritmo de compra no prazo.</p>') + '</section>' +
          '<section class="cartao"><h2>Tendência <small>últimos 90 dias × 90 anteriores</small></h2>' +
            '<h3>Em alta</h3>' + listaTendencia(c.emAlta) + '<h3>Em queda</h3>' + listaTendencia(c.emQueda) + '</section>' +
        '</div>';
    },
    depois() {
      const arq = document.getElementById('gEstoque');
      if (arq) arq.addEventListener('change', () => { const f = arq.files[0]; if (f) importaEstoque(f).catch(CRM.falhou); });
      const liga = (id, campo, num) => { const el = document.getElementById(id); if (el) el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => { if (num) diasCompras = +el.value || 30; else fc[campo] = el.value;
        // Ordem que faz sentido para cada visão (dá para trocar depois).
        if (campo === 'mostrar') fc.ordem = { comprar: 'curva', falta: 'vendido', parado: 'parado', vendidos: 'vendido', todos: 'nome' }[el.value] || fc.ordem;
        CRM.render(); }); };
      liga('cBusca', 'busca'); liga('cMostrar', 'mostrar'); liga('cCurva', 'curva'); liga('cFornecedor', 'fornecedor'); liga('cLinha', 'linha'); liga('cOrdem', 'ordem'); liga('gDias', null, true);
      ['cOrdem', 'cMostrar'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', () => { fc.col = null; }, true); });
    }
  };

  async function importaEstoque(f) {
    const buf = await f.arrayBuffer();
    let txt = new TextDecoder('utf-8').decode(buf);
    if (txt.indexOf('�') !== -1) txt = new TextDecoder('windows-1252').decode(buf); // CSV do FKN é Windows-1252
    const lista = G.lerArquivoEstoque(txt);
    const neg = lista.filter(x => x.quantidade < 0).length;
    CRM.toast('Gravando o estoque: ' + lista.length + ' produtos…');
    const n = await CRM.store().salvarEstoque(lista, (i, tot) => CRM.toast('Gravando o estoque: ' + i + ' de ' + tot + '…'));
    CRM.toast('Estoque atualizado: ' + n + ' produtos' + (neg ? ' (' + neg + ' com saldo negativo no FKN)' : '') + '.');
    estoque = null; CRM.render();
    if (CRM.recarregarFkn) CRM.recarregarFkn();
  }

  // Pedido por fornecedor: a sugestão de compra separada por fornecedor, pronta para mandar.
  function cartaoPorFornecedor(c) {
    const l = c.pedidoPorFornecedor || [];
    if (!l.length || !c.estoque || !c.estoque.completo) return '';
    return '<section class="cartao"><h2>Pedido por fornecedor <small>' + l.length + ' fornecedor(es) · ' + esc(R.moeda(c.estoque.valorSugestao)) + ' para ' + c.dias + ' dias</small></h2>' +
      '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Fornecedor</th><th class="num">Produtos</th><th class="num">Custo estimado</th><th></th></tr></thead><tbody>' +
      l.map((f, i) => '<tr><td><button type="button" class="link" data-acao="compras-ver-fornecedor" data-id="' + i + '">' + esc(f.nome) + '</button>' + (f.cod ? ' <small>' + esc(f.cod) + '</small>' : '') + '</td>' +
        '<td class="num">' + f.itens.length + '</td><td class="num">' + esc(R.moeda(f.custo)) + (f.semCusto ? ' <small>' + f.semCusto + ' sem custo</small>' : '') + '</td>' +
        '<td class="num"><button type="button" class="mini" data-acao="compras-pedido-fornecedor" data-id="' + i + '">Exportar pedido</button></td></tr>').join('') +
      '</tbody></table></div></section>';
  }

  function listaTop(l, total) {
    if (!l.length) return '<p class="vazio">Sem notas no período.</p>';
    const max = Math.max(1, ...l.map(x => x.valor));
    return '<ol class="g-top">' + l.map(x => '<li>' + (x.id ? '<button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(x.id) + '">' + esc(x.nome) + '</button>' : '<span>' + esc(x.nome) + '</span>') +
      '<span class="num">' + esc(R.moeda(x.valor)) + ' <small>' + (total ? esc(R.pct(x.valor / total * 100)) : '') + '</small></span>' +
      CRM.barra(x.valor, max) + '<small>' + esc(x.info) + '</small></li>').join('') + '</ol>';
  }
  function listaTendencia(l) {
    if (!l.length) return '<p class="vazio">Nada fora do normal.</p>';
    return '<ul class="g-tend">' + l.map(g => '<li><span>' + esc(R.nomeDeItem(g.descricao)) + '</span>' + seta(g.tendencia) + '<small>' + qtd(g.qtd90) + ' ' + esc(g.unidade) + ' nos últimos 90 dias</small></li>').join('') + '</ul>';
  }

  Object.assign(CRM.acoes, {
    'compras-coluna': id => { if (fc.col === id) fc.dir = fc.dir === 'desc' ? 'asc' : 'desc'; else { fc.col = id; fc.dir = COLUNAS.find(c => c[0] === id)[2] ? 'desc' : 'asc'; } CRM.render(); },
    // Quadros de Compras: aplicam o filtro na tabela logo abaixo.
    'compras-kpi': id => {
      Object.assign(fc, id === 'A' ? { mostrar: 'vendidos', curva: 'A', ordem: 'vendido' } : { mostrar: id, curva: '', ordem: { comprar: 'curva', falta: 'vendido', parado: 'parado' }[id] },
        { busca: '', fornecedor: '', linha: '', col: null });
      CRM.render();
      const t = document.querySelector('.filtros-compras'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start' });
    },
    // Quadros da Gestão: a lista do que cada número conta.
    'gestao-lista': id => {
      if (!ultimo || !ultimo.p || !CRM.mostraLista) return;
      const p = ultimo.p, m = p.mes, L = p.funil.listas || {};
      const notas = (titulo, l) => ({ titulo, tipo: 'notas', itens: l, vendedor: n => CRM.nomeUsuario(donoDe(E().ix, n)) + (n.vendedor_nome && !n.vendedor_id ? ' (' + n.vendedor_nome + ', ex-vendedor)' : '') });
      const desde = R.dataBR(m.de);
      const f = {
        mes: () => Object.assign(notas('Notas do mês', m.atual.lista), { sub: desde + ' até hoje' }),
        ano: () => Object.assign(notas('Notas do ano', p.ano.lista), { sub: 'de 01/01 até hoje' }),
        clientes: () => ({ titulo: 'Clientes que compraram no mês', sub: desde + ' até hoje', tipo: 'empresas', itens: [...new Set(m.atual.lista.map(n => n.empresa_id).filter(Boolean))].map(id => CRM.empresa(id)).filter(Boolean) }),
        abertos: () => ({ titulo: 'Negócios abertos' + (p.funilVendas ? ' · ' + p.funilVendas : ''), tipo: 'negocios', itens: L.abertos || [], data: 'previsao_fechamento' }),
        decididos: () => ({ titulo: 'Ganhos e perdidos no mês' + (p.funilVendas ? ' · ' + p.funilVendas : ''), tipo: 'negocios', itens: L.decididos || [], data: 'fechado_em' })
      }[id];
      if (f) CRM.mostraLista(f());
    },
    'compras-ver-fornecedor': i => {
      const f = ultimo && ultimo.c && ultimo.c.pedidoPorFornecedor[+i];
      if (!f) return;
      Object.assign(fc, { fornecedor: f.cod ? f.nome : '-', mostrar: 'comprar', busca: '', curva: '', linha: '', col: null });
      CRM.render();
      const t = document.querySelector('.filtros-compras'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start' });
    },
    'compras-pedido-fornecedor': i => {
      const f = ultimo && ultimo.c && ultimo.c.pedidoPorFornecedor[+i];
      if (!f) return;
      CRM.baixarCSV('pedido-' + R.normaliza(f.nome).replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + diasCompras + 'dias', ['Código', 'Produto', 'Unidade', 'Comprar', 'Caixas', 'Custo unitário', 'Custo estimado', 'Estoque', 'Já pedido', 'Mínimo FKN'],
        f.itens.map(g => [g.codigo || '', g.descricao, g.unidade, g.comprar, g.caixas ? g.caixas + ' cx de ' + g.caixa.fator : '', g.custoUnit ? +g.custoUnit.toFixed(2) : '',
          g.custoUnit ? +(g.custoUnit * g.comprar).toFixed(2) : '', g.saldo, g.pedido || 0, g.minimo || 0]));
    },
    'compras-exportar': () => {
      const l = (ultimo && ultimo.filtrados) || [];
      CRM.baixarCSV('compras-' + fc.mostrar + '-' + diasCompras + 'dias', ['Código', 'Produto', 'Unidade', 'Fornecedor', 'Linha', 'Família', 'Curva', 'Estoque', 'Mínimo FKN', 'Já pedido', 'Consumo por mês', 'Dura (dias)', 'Clientes previstos', 'Precisa', 'Comprar', 'Caixas', 'Custo unitário', 'Custo do pedido', 'Vendido 12 meses (R$)', 'Tendência %'],
        l.map(g => [g.codigo || '', g.descricao, g.unidade, g.fornecedor || '', g.linha || '', g.familia || '', g.classe, g.saldo == null ? '' : g.saldo, g.minimo || '', g.pedido || '', g.consumoDia ? +(g.consumoDia * 30).toFixed(2) : '', g.cobertura == null ? '' : Math.round(g.cobertura),
          g.clientesPrevistos || 0, +(g.necessidade || 0).toFixed(2), g.comprar || 0, g.caixas ? g.caixas + ' cx de ' + g.caixa.fator : '', g.custoUnit ? +g.custoUnit.toFixed(2) : '', g.custoUnit && g.comprar ? +(g.custoUnit * g.comprar).toFixed(2) : '',
          +(g.valor12 || 0).toFixed(2), g.tendencia == null ? '' : Math.round(g.tendencia)]));
    },
    'gestao-exportar': t => {
      if (!ultimo) return;
      const c = ultimo.c;
      if (t === 'demanda') CRM.baixarCSV('compras-demanda-' + c.dias + 'dias', ['Produto', 'Código', 'Unidade', 'Curva', 'Quantidade prevista', 'Clientes', 'Média por mês (90 dias)', 'Tendência %'],
        c.demanda.map(g => [g.descricao, g.codigo, g.unidade, g.classe, +g.prevista.toFixed(2), g.clientesPrevistos, +g.mediaMensal.toFixed(2), g.tendencia == null ? '' : Math.round(g.tendencia)]));
      if (t === 'pedido') CRM.baixarCSV('compras-sugestao-pedido-' + c.dias + 'dias', ['Código', 'Produto', 'Unidade', 'Curva', 'Estoque', 'Consumo por mês', 'Dura (dias)', 'Precisa', 'Comprar', 'Custo unitário', 'Custo estimado'],
        c.sugestao.map(g => [g.codigo, g.descricao, g.unidade, g.classe, g.saldo, +(g.consumoDia * 30).toFixed(2), g.cobertura == null ? '' : Math.round(g.cobertura), +g.necessidade.toFixed(2), g.comprar,
          g.custoUnit ? +g.custoUnit.toFixed(2) : '', g.custoUnit ? +(g.custoUnit * g.comprar).toFixed(2) : '']));
      if (t === 'parado') CRM.baixarCSV('compras-estoque-parado', ['Código', 'Produto', 'Unidade', 'Estoque', 'Custo total'],
        c.parado.map(x => [x.codigo, x.descricao, x.unidade || '', x.quantidade, x.custo_total]));
      if (t === 'abc') CRM.baixarCSV('compras-curva-abc', ['Produto', 'Código', 'Unidade', 'Curva', 'Faturamento 12 meses', '% acumulado', 'Clientes', 'Quantidade 90 dias'],
        c.abc.A.concat(c.abc.B, c.abc.C).sort((a, b) => b.valor12 - a.valor12).map(g => [g.descricao, g.codigo, g.unidade, g.classe, +g.valor12.toFixed(2), +g.pctAcumulado.toFixed(1), g.clientes12, +g.qtd90.toFixed(2)]));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
