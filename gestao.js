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

    // Funil do mês (negócios) e o que está aberto.
    const funil = R.dashboard(D, ix, cfg, hoje, { periodo: R.periodo('mes', hoje) });

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
      ano, porMes: fat12.porMes, equipe, funil,
      base: { clientes: (D.empresas || []).filter(e => e.situacao === 'cliente').length, ativos: compraram90.size,
        leads: (D.empresas || []).filter(e => e.situacao === 'lead').length },
      topClientes: fat.topClientes.slice(0, 10), topProdutos: fat.topProdutosValor.slice(0, 10),
      sumidos, emRisco: sumidos.reduce((s, x) => s + x.porMes, 0)
    };
  }

  // ------------------------------------------------------------ compras
  // Curva ABC (12 meses): A = produtos que somam os primeiros 80% do faturamento, B até 95%, C o resto.
  // Demanda prevista: cada cliente com ritmo e compra prevista até "dias" à frente (inclusive os que
  // já passaram da data, mas ainda não sumiram) soma a quantidade habitual de cada item.
  // Tendência: quantidade vendida nos últimos 90 dias × os 90 anteriores.
  function compras(D, ix, cfg, hoje, dias) {
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
    return { dias, demanda, clientesPrevistos: clientesPrevistos.sort((a, b) => (a.proxima < b.proxima ? -1 : 1)), abc,
      emAlta: comMovimento.filter(g => g.tendencia >= 25).sort((a, b) => b.tendencia - a.tendencia).slice(0, 8),
      emQueda: comMovimento.filter(g => g.tendencia <= -25).sort((a, b) => a.tendencia - b.tendencia).slice(0, 8) };
  }

  const G = { painel, compras };
  raiz.CRMGestao = G;
  if (typeof module !== 'undefined') module.exports = G;

  // ------------------------------------------------------------ tela
  const CRM = raiz.CRM;
  if (!CRM || !CRM.telas) return;
  const { esc } = CRM;
  const E = () => CRM.estado;
  let ultimo = null; // o que a tela mostrou (para exportar)
  let diasCompras = 30;

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
      const c = G.compras(E().D, E().ix, cfg, hoje, diasCompras);
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
          kpi('Negócios abertos', R.moeda(f.abertas.valor), f.abertas.qtd + ' negócios · ponderado ' + esc(R.moeda(f.abertas.ponderado))) +
          kpi('Conversão do mês', f.conversao == null ? '—' : R.pct(f.conversao), f.realizadas.qtd + ' ganhos · ' + f.perdidas.qtd + ' perdidos') +
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
        // ---- compras
        '<h2 class="titulo-secao">Compras <small>o que os clientes devem pedir, pelo ritmo e pelos itens de sempre</small></h2>' +
        '<section class="cartao"><h2>Demanda prevista <small>' + c.clientesPrevistos.length + ' clientes com compra prevista até ' + esc(R.dataBR(R.somaDias(hoje, c.dias))) + '</small>' +
          '<span class="flex"></span><select id="gDias" aria-label="Horizonte da previsão">' + CRM.opcoesHTML([['15', 'próximos 15 dias'], ['30', 'próximos 30 dias'], ['45', 'próximos 45 dias'], ['60', 'próximos 60 dias']], String(c.dias)) + '</select>' +
          ' <button type="button" class="mini" data-acao="gestao-exportar" data-id="demanda">Exportar</button></h2>' +
          '<p class="dica">Soma a quantidade que cada cliente costuma levar, para os clientes cuja próxima compra cai no período (inclui os atrasados que ainda não sumiram). Confira com o estoque do FKM antes de pedir ao fornecedor.</p>' +
          (c.demanda.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th>Curva</th><th class="num">Previsto</th><th class="num">Clientes</th><th class="num">Média/mês</th><th class="num">Tendência</th></tr></thead><tbody>' +
            c.demanda.slice(0, 40).map(g => '<tr><td>' + esc(R.nomeDeItem(g.descricao)) + (g.codigo ? ' <small>' + esc(g.codigo) + '</small>' : '') + '</td><td>' + CRM.selo(g.classe, g.classe === 'A' ? 'verde' : g.classe === 'B' ? 'azul' : 'etiqueta') + '</td>' +
              '<td class="num"><strong>' + qtd(g.prevista) + '</strong> ' + esc(g.unidade) + '</td><td class="num">' + g.clientesPrevistos + '</td><td class="num">' + qtd(g.mediaMensal) + ' ' + esc(g.unidade) + '</td><td class="num">' + (g.tendencia == null ? '—' : seta(g.tendencia)) + '</td></tr>').join('') +
            '</tbody></table></div>' + (c.demanda.length > 40 ? '<p class="mais">Mostrando 40 de ' + c.demanda.length + ' produtos; o arquivo exportado tem todos.</p>' : '') : '<p class="vazio">Nenhum cliente com ritmo de compra previsto no período.</p>') + '</section>' +
        '<div class="g-duas">' +
          '<section class="cartao"><h2>Curva ABC <small>12 meses · ' + esc(R.moeda(c.abc.total)) + '</small> <span class="flex"></span><button type="button" class="mini" data-acao="gestao-exportar" data-id="abc">Exportar</button></h2>' +
            '<dl class="g-base"><div><dt>A · 80% do faturamento</dt><dd>' + c.abc.A.length + ' produtos</dd></div><div><dt>B · os próximos 15%</dt><dd>' + c.abc.B.length + '</dd></div><div><dt>C · os últimos 5%</dt><dd>' + c.abc.C.length + '</dd></div></dl>' +
            '<p class="dica">Os produtos A nunca podem faltar: ' + esc(c.abc.A.slice(0, 6).map(g => R.nomeDeItem(g.descricao)).join(', ')) + (c.abc.A.length > 6 ? '…' : '') + '</p></section>' +
          '<section class="cartao"><h2>Tendência <small>últimos 90 dias × 90 anteriores</small></h2>' +
            '<h3>Em alta</h3>' + listaTendencia(c.emAlta) + '<h3>Em queda</h3>' + listaTendencia(c.emQueda) + '</section>' +
        '</div>';
    },
    depois() {
      const s = document.getElementById('gDias');
      if (s) s.addEventListener('change', () => { diasCompras = +s.value || 30; CRM.render(); });
    }
  };

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
    'gestao-exportar': t => {
      if (!ultimo) return;
      const c = ultimo.c;
      if (t === 'demanda') CRM.baixarCSV('compras-demanda-' + c.dias + 'dias', ['Produto', 'Código', 'Unidade', 'Curva', 'Quantidade prevista', 'Clientes', 'Média por mês (90 dias)', 'Tendência %'],
        c.demanda.map(g => [g.descricao, g.codigo, g.unidade, g.classe, +g.prevista.toFixed(2), g.clientesPrevistos, +g.mediaMensal.toFixed(2), g.tendencia == null ? '' : Math.round(g.tendencia)]));
      if (t === 'abc') CRM.baixarCSV('compras-curva-abc', ['Produto', 'Código', 'Unidade', 'Curva', 'Faturamento 12 meses', '% acumulado', 'Clientes', 'Quantidade 90 dias'],
        c.abc.A.concat(c.abc.B, c.abc.C).sort((a, b) => b.valor12 - a.valor12).map(g => [g.descricao, g.codigo, g.unidade, g.classe, +g.valor12.toFixed(2), +g.pctAcumulado.toFixed(1), g.clientes12, +g.qtd90.toFixed(2)]));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
