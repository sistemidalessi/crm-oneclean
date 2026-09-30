/* CRM Sistemi Dalessi — Gestão (só administrador): o resumo do negócio numa tela.
   Parte pura (CRMGestao.painel / CRMGestao.compras, testada em testes/gestao.test.js) e a tela.
   Tudo sai do que já está no CRM: notas fiscais (faturamento real), negócios, atividades e metas.
   O "braço de compras" usa o ritmo de cada cliente e o que ele costuma levar para prever a
   demanda dos próximos dias — o CRM não conhece o estoque (isso fica no FKM). */
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
  const donoDe = (ix, n) => { const e = n.empresa_id && ix.porId.empresas.get(n.empresa_id); return e ? e.responsavel_id || null : null; };

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

  // ------------------------------------------------------------ estoque (CSV do FKM)
  // Cabeçalho reconhecido pelo nome (CODIGO; NOME DO PRODUTO; UNIDADE; LOCALIZAÇÃO; CUSTO; ESTOQUE).
  // Código "010503.0" do FKM = "010503" da nota. CUSTO é o custo total do saldo.
  function lerEstoque(texto) {
    const linhas = R.csvParse(texto).filter(l => l.some(c => String(c == null ? '' : c).trim()));
    if (linhas.length < 2) throw new Error('o arquivo está vazio');
    const cab = linhas[0].map(c => R.normaliza(c));
    const col = (...nomes) => { for (const n of nomes) { const i = cab.findIndex(c => c === n || c.startsWith(n + ' ')); if (i !== -1) return i; } return -1; };
    const iCod = col('codigo', 'cod'), iDesc = col('nome do produto', 'descricao', 'produto', 'nome'), iUn = col('unidade', 'un'),
      iLoc = col('localizacao', 'local'), iCusto = col('custo', 'custo total'), iQtd = col('estoque', 'saldo', 'quantidade', 'qtd');
    if (iCod < 0 || iQtd < 0) throw new Error('não achei as colunas CÓDIGO e ESTOQUE no cabeçalho do arquivo');
    const m = new Map();
    linhas.slice(1).forEach(l => {
      const codigo = codigoFKM(l[iCod]);
      if (!codigo) return;
      const txt = i => (i >= 0 && l[i] != null ? String(l[i]).trim() : '');
      m.set(codigo, { codigo, descricao: txt(iDesc) || codigo, unidade: txt(iUn) || null, localizacao: txt(iLoc) || null,
        quantidade: R.numeroBR(l[iQtd]) || 0, custo_total: iCusto >= 0 ? R.numeroBR(l[iCusto]) || 0 : 0 });
    });
    return [...m.values()];
  }
  const codigoFKM = v => String(v == null ? '' : v).trim().replace(/\.0+$/, '');

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

    // Com o estoque do FKM: necessidade no período = o maior entre a previsão dos clientes e o
    // consumo médio dos últimos 90 dias; comprar = necessidade − saldo (saldo negativo conta zero).
    const est = new Map((estoque || []).map(x => [codigoFKM(x.codigo), x]));
    const estPorNome = new Map((estoque || []).map(x => [R.normaliza(x.descricao), x]));
    const usados = new Set();
    lista.forEach(g => {
      const e = (g.codigo && est.get(codigoFKM(g.codigo))) || estPorNome.get(R.normaliza(g.descricao));
      g.consumoDia = g.qtd90 / 90;
      g.necessidade = Math.max(g.prevista, g.consumoDia * dias);
      if (!e) { g.saldo = null; return; }
      usados.add(codigoFKM(e.codigo));
      g.codigo = g.codigo || e.codigo;
      g.saldo = num(e.quantidade);
      g.custoUnit = num(e.quantidade) > 0 ? num(e.custo_total) / num(e.quantidade) : null;
      g.cobertura = g.consumoDia > 0 ? Math.max(0, g.saldo) / g.consumoDia : null;
      g.comprar = Math.max(0, Math.ceil(g.necessidade - Math.max(0, g.saldo)));
    });
    const temEstoque = est.size > 0;
    const ordemClasse = { A: 0, B: 1, C: 2 };
    const sugestao = temEstoque ? lista.filter(g => g.saldo != null && g.comprar > 0)
      .sort((a, b) => ordemClasse[a.classe] - ordemClasse[b.classe] || b.valor12 - a.valor12) : [];
    const ruptura = temEstoque ? lista.filter(g => g.saldo != null && g.saldo <= 0 && g.qtd90 > 0).sort((a, b) => b.valor12 - a.valor12) : [];
    // Parado: tem saldo e custo, mas não vendeu nada em 90 dias.
    const vendeu90 = new Set(lista.filter(g => g.qtd90 > 0 && g.codigo).map(g => codigoFKM(g.codigo)));
    const parado = (estoque || []).filter(x => num(x.quantidade) > 0 && num(x.custo_total) > 0 && !vendeu90.has(codigoFKM(x.codigo)))
      .sort((a, b) => num(b.custo_total) - num(a.custo_total));
    const positivos = (estoque || []).filter(x => num(x.quantidade) > 0);
    const estoqueInfo = temEstoque ? {
      produtos: est.size, valor: positivos.reduce((s, x) => s + num(x.custo_total), 0),
      em: (estoque || []).reduce((m, x) => (x.atualizado_em && x.atualizado_em > m ? x.atualizado_em : m), ''),
      negativos: (estoque || []).filter(x => num(x.quantidade) < 0).length,
      valorSugestao: sugestao.reduce((s, g) => s + (g.custoUnit ? g.custoUnit * g.comprar : 0), 0),
      semCusto: sugestao.filter(g => !g.custoUnit).length,
      valorParado: parado.reduce((s, x) => s + num(x.custo_total), 0)
    } : null;
    // Todos os produtos para a tela Compras: os vendidos (com a conta acima) + os que só estão no estoque.
    const produtos = lista.slice();
    (estoque || []).forEach(x => {
      if (usados.has(codigoFKM(x.codigo))) return;
      produtos.push({ chave: 'e:' + codigoFKM(x.codigo), descricao: x.descricao, codigo: codigoFKM(x.codigo), unidade: x.unidade || '', valor12: 0, qtd90: 0, qtd90ant: 0,
        clientes12: 0, prevista: 0, clientesPrevistos: 0, classe: '—', consumoDia: 0, necessidade: 0, saldo: num(x.quantidade),
        custoUnit: num(x.quantidade) > 0 ? num(x.custo_total) / num(x.quantidade) : null, cobertura: null, comprar: 0, tendencia: null, soEstoque: true });
    });
    const paradoSet = new Set(parado.map(x => codigoFKM(x.codigo)));
    produtos.forEach(g => { g.parado = !!(g.codigo && paradoSet.has(codigoFKM(g.codigo))); g.emFalta = g.saldo != null && g.saldo <= 0 && g.qtd90 > 0; });
    return { dias, demanda, produtos, estoque: estoqueInfo, sugestao, ruptura, parado, clientesPrevistos: clientesPrevistos.sort((a, b) => (a.proxima < b.proxima ? -1 : 1)), abc,
      emAlta: comMovimento.filter(g => g.tendencia >= 25).sort((a, b) => b.tendencia - a.tendencia).slice(0, 8),
      emQueda: comMovimento.filter(g => g.tendencia <= -25).sort((a, b) => a.tendencia - b.tendencia).slice(0, 8) };
  }

  const G = { painel, compras, lerEstoque, codigoFKM };
  raiz.CRMGestao = G;
  if (typeof module !== 'undefined') module.exports = G;

  // ------------------------------------------------------------ tela
  const CRM = raiz.CRM;
  if (!CRM || !CRM.telas) return;
  const { esc } = CRM;
  const E = () => CRM.estado;
  let ultimo = null; // o que a tela mostrou (para exportar)
  let diasCompras = 30;
  let estoque = null;      // retrato do FKM (carregado sob demanda: só o administrador lê)
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
  const kpi = (t, v, s, cls) => '<div class="kpi ' + (cls || '') + '"><span>' + esc(t) + '</span><strong>' + esc(v) + '</strong><small>' + s + '</small></div>';
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
          kpi('Faturamento do mês', R.moeda(m.atual.valor), seta(m.variacao) + ' vs. mesmo ponto de ' + esc(R.mesCurto(R.somaMeses(m.de, -1))) + ' (' + esc(R.moeda(m.anteriorMesmoDia.valor)) + ')', 'azul') +
          kpi('Projeção do mês', R.moeda(m.projecao), 'no ritmo atual · mês passado fechou em ' + esc(R.moeda(m.anterior.valor))) +
          kpi('Faturamento no ano', R.moeda(p.ano.valor), p.ano.notas + ' notas · ' + p.ano.clientes + ' clientes') +
          kpi('Clientes que compraram', String(m.atual.clientes), m.novos + ' novo(s) no mês · ticket ' + esc(R.moeda(m.atual.ticket)), 'verde') +
          kpi('Negócios abertos', R.moeda(f.abertas.valor), f.abertas.qtd + ' negócios · ponderado pela chance ' + esc(R.moeda(f.abertas.ponderado)) + (p.funilVendas ? ' · ' + esc(p.funilVendas) : '')) +
          kpi('Conversão do mês', f.conversao == null ? '—' : R.pct(f.conversao), f.realizadas.qtd + ' ganhos · ' + f.perdidas.qtd + ' perdidos' + (p.funilVendas ? ' · ' + esc(p.funilVendas) : '')) +
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
            '<p class="dica">Estoque do FKM de ' + esc(R.dataBR(c.estoque.em) + ' ' + R.horaLocal(c.estoque.em)) + '.</p>'
            : '<p class="vazio">Sem estoque do FKM ainda: em Compras, use "Atualizar estoque (CSV do FKM)".</p>') + '</section>';
    },
    depois() {}
  };

  // ================================================================ Compras (admin e comprador)
  // Uma tabela de produtos com pesquisa e filtros: o que comprar, em falta, parado, vendidos ou
  // todo o estoque. Exporta exatamente o que está na tela.
  const fc = { busca: '', curva: '', mostrar: 'comprar', ordem: 'curva' };
  const MOSTRAR = [['comprar', 'Sugestão de pedido (precisa comprar)'], ['falta', 'Em falta (vendeu e está zerado)'], ['parado', 'Estoque parado (sem venda em 90 dias)'],
    ['vendidos', 'Vendidos nos últimos 12 meses'], ['todos', 'Todos os produtos']];
  const ORDEM = [['curva', 'Curva (A primeiro) e faturamento'], ['pedido', 'Maior custo do pedido'], ['dura', 'Acaba antes'], ['vendido', 'Mais vendido (R$ 12 meses)'],
    ['parado', 'Maior valor parado'], ['nome', 'Nome']];
  const OC = { A: 0, B: 1, C: 2, '—': 3 };
  function filtraProdutos(c) {
    const q = R.normaliza(fc.busca);
    let l = c.produtos.filter(g => {
      if (fc.curva && g.classe !== fc.curva) return false;
      if (q && R.normaliza(g.descricao).indexOf(q) === -1 && String(g.codigo || '').indexOf(fc.busca.trim()) === -1) return false;
      if (fc.mostrar === 'comprar') return g.comprar > 0;
      if (fc.mostrar === 'falta') return g.emFalta;
      if (fc.mostrar === 'parado') return g.parado;
      if (fc.mostrar === 'vendidos') return g.valor12 > 0;
      return true;
    });
    const custoPedido = g => (g.custoUnit ? g.custoUnit * (g.comprar || 0) : 0);
    const valorParado = g => (g.saldo > 0 && g.custoUnit ? g.saldo * g.custoUnit : 0);
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

  CRM.telas.compras = {
    render() {
      if (!CRM.ehAdmin() && !CRM.ehComprador()) return '<div class="cartao"><p class="vazio">Esta tela é do administrador e do comprador.</p></div>';
      const hoje = CRM.hoje(), cfg = E().cfg;
      if (estoque === null) setTimeout(carregaEstoque, 0);
      const c = G.compras(E().D, E().ix, cfg, hoje, diasCompras, estoque || []);
      const e = c.estoque;
      const l = filtraProdutos(c);
      ultimo = Object.assign({}, ultimo || {}, { c, filtrados: l });
      const botao = '<label class="btn sec arquivo">Atualizar estoque (CSV do FKM)<input type="file" id="gEstoque" accept=".csv,.txt,text/csv"></label>';
      const velho = e && e.em && R.diasEntre(R.diaLocal(e.em), hoje) > 3;
      const curva = g => (g.classe === '—' ? '<small>—</small>' : CRM.selo(g.classe, g.classe === 'A' ? 'verde' : g.classe === 'B' ? 'azul' : 'etiqueta'));
      const custo = g => (g.comprar && g.custoUnit ? R.moeda(g.custoUnit * g.comprar) : '—');
      return '<div class="cabecalho"><div><h1>Compras</h1><p class="sub">' +
          (e ? 'Estoque do FKM de <strong>' + esc(R.dataBR(e.em) + ' ' + R.horaLocal(e.em)) + '</strong>' + (velho ? ' ' + CRM.selo('desatualizado: exporte de novo no FKM', 'ambar') : '') + ' · ' + e.produtos + ' produtos'
            : 'Sem estoque do FKM ainda: exporte a posição de estoque em CSV no FKM e clique em "Atualizar estoque"') +
          '</p></div><span class="flex"></span>' + botao + '</div>' +
        (e ? '<section class="kpis">' +
          kpi('Estoque a custo', R.moeda(e.valor), (e.negativos ? e.negativos + ' com saldo negativo no FKM' : 'saldo positivo'), 'azul') +
          kpi('Sugestão de pedido', R.moeda(e.valorSugestao), c.sugestao.length + ' produtos para ' + c.dias + ' dias' + (e.semCusto ? ' · ' + e.semCusto + ' sem custo' : ''), 'verde') +
          kpi('Em falta', String(c.ruptura.length), 'vendeu em 90 dias e está zerado', c.ruptura.length ? 'vermelho' : '') +
          kpi('Estoque parado', R.moeda(e.valorParado), c.parado.length + ' produtos sem venda em 90 dias') +
          kpi('Curva A', String(c.abc.A.length), 'produtos que fazem 80% do faturamento') +
        '</section>' : '') +
        '<section class="cartao"><div class="filtros-compras">' +
          '<input type="search" id="cBusca" placeholder="Pesquisar produto ou código" value="' + esc(fc.busca) + '" aria-label="Pesquisar produto ou código">' +
          '<select id="cMostrar" aria-label="O que mostrar">' + CRM.opcoesHTML(MOSTRAR, fc.mostrar) + '</select>' +
          '<select id="cCurva" aria-label="Curva">' + CRM.opcoesHTML([['', 'Todas as curvas'], ['A', 'Curva A'], ['B', 'Curva B'], ['C', 'Curva C']], fc.curva) + '</select>' +
          '<select id="gDias" aria-label="Prazo">' + CRM.opcoesHTML([['15', 'Para 15 dias'], ['30', 'Para 30 dias'], ['45', 'Para 45 dias'], ['60', 'Para 60 dias'], ['90', 'Para 90 dias']], String(c.dias)) + '</select>' +
          '<select id="cOrdem" aria-label="Ordenar">' + CRM.opcoesHTML(ORDEM, fc.ordem) + '</select>' +
          '<button type="button" class="btn sec" data-acao="compras-exportar">Exportar (' + l.length + ')</button>' +
        '</div>' +
        '<p class="dica">Precisa = o maior entre o que os clientes devem pedir (pelo ritmo e pelos itens de sempre) e o consumo médio dos últimos 90 dias no prazo. Comprar = precisa − estoque. Confira mínimos e embalagem do fornecedor.</p>' +
        (l.length ? '<div class="tabela-rolagem"><table class="tabela compras"><thead><tr><th>Produto</th><th>Curva</th><th class="num">Estoque</th><th class="num">Consumo/mês</th><th class="num">Dura</th><th class="num">Clientes previstos</th><th class="num">Precisa</th><th class="num">Comprar</th><th class="num">Custo do pedido</th><th class="num">Vendido 12 meses</th><th class="num">Tendência</th></tr></thead><tbody>' +
          l.slice(0, 150).map(g => '<tr><td>' + esc(R.nomeDeItem(g.descricao)) + ' <small>' + esc(g.codigo || '') + '</small></td><td>' + curva(g) + '</td>' +
            '<td class="num">' + (g.saldo == null ? '—' : g.saldo < 0 ? CRM.selo(qtd(g.saldo), 'vermelho') : qtd(g.saldo)) + ' <small>' + esc(g.unidade) + '</small></td>' +
            '<td class="num">' + (g.consumoDia ? qtd(g.consumoDia * 30) : '—') + '</td>' +
            '<td class="num">' + (g.cobertura == null ? '—' : g.cobertura < 1 ? CRM.selo('acabou', 'vermelho') : Math.round(g.cobertura) + ' dias') + '</td>' +
            '<td class="num">' + (g.clientesPrevistos || '—') + '</td><td class="num">' + (g.necessidade ? qtd(g.necessidade) : '—') + '</td>' +
            '<td class="num">' + (g.comprar ? '<strong>' + g.comprar + '</strong>' : '—') + '</td><td class="num">' + esc(custo(g)) + '</td>' +
            '<td class="num">' + (g.valor12 ? esc(R.moeda(g.valor12)) : '—') + '</td><td class="num">' + (g.tendencia == null ? '—' : seta(g.tendencia)) + '</td></tr>').join('') +
          '</tbody></table></div>' + (l.length > 150 ? '<p class="mais">Mostrando 150 de ' + l.length + '; o arquivo exportado tem todos.</p>' : '')
          : '<p class="vazio">Nenhum produto com esses filtros.</p>') + '</section>' +
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
      liga('cBusca', 'busca'); liga('cMostrar', 'mostrar'); liga('cCurva', 'curva'); liga('cOrdem', 'ordem'); liga('gDias', null, true);
    }
  };

  async function importaEstoque(f) {
    const buf = await f.arrayBuffer();
    let txt = new TextDecoder('utf-8').decode(buf);
    if (txt.indexOf('�') !== -1) txt = new TextDecoder('windows-1252').decode(buf); // CSV do FKM é Windows-1252
    const lista = G.lerEstoque(txt);
    const neg = lista.filter(x => x.quantidade < 0).length;
    CRM.toast('Gravando o estoque: ' + lista.length + ' produtos…');
    const n = await CRM.store().salvarEstoque(lista, (i, tot) => CRM.toast('Gravando o estoque: ' + i + ' de ' + tot + '…'));
    CRM.toast('Estoque atualizado: ' + n + ' produtos' + (neg ? ' (' + neg + ' com saldo negativo no FKM)' : '') + '.');
    estoque = null; CRM.render();
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
    'compras-exportar': () => {
      const l = (ultimo && ultimo.filtrados) || [];
      CRM.baixarCSV('compras-' + fc.mostrar + '-' + diasCompras + 'dias', ['Código', 'Produto', 'Unidade', 'Curva', 'Estoque', 'Consumo por mês', 'Dura (dias)', 'Clientes previstos', 'Precisa', 'Comprar', 'Custo unitário', 'Custo do pedido', 'Vendido 12 meses (R$)', 'Tendência %'],
        l.map(g => [g.codigo || '', g.descricao, g.unidade, g.classe, g.saldo == null ? '' : g.saldo, g.consumoDia ? +(g.consumoDia * 30).toFixed(2) : '', g.cobertura == null ? '' : Math.round(g.cobertura),
          g.clientesPrevistos || 0, +(g.necessidade || 0).toFixed(2), g.comprar || 0, g.custoUnit ? +g.custoUnit.toFixed(2) : '', g.custoUnit && g.comprar ? +(g.custoUnit * g.comprar).toFixed(2) : '',
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
