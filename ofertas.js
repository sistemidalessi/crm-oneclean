/* CRM Sistemi Dalessi — Ofertas: queima de estoque (15/10/2026, pedido do Anderson: "fazer girar" o
   estoque parado há mais de 90 dias com preço de custo + uma margem pequena, por e-mail e WhatsApp).
   O administrador monta a oferta em Compras (é quem lê o custo); a oferta guarda só o preço de oferta e o
   de tabela (crm_ofertas, a equipe toda lê). O público sai das notas: quem já comprou o item, quem compra
   a mesma família, ou (opcional) todo cliente que comprou nos últimos 12 meses. E-mail pela crm-email
   (tipo 'oferta', em nome do(a) vendedor(a), um por cliente e por oferta); WhatsApp pelo(a) vendedor(a), com o
   texto pronto. Parte pura no começo (testes/ofertas.test.js); a tela vem depois. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  const C = raiz.CRMCadencia || (typeof require !== 'undefined' ? require('./cadencia.js') : null);
  const { num, normaliza, diaLocal, diasEntre, somaDias, dataBR, moeda, primeiroNome, aplicaModelo, cfopDeVenda, nomeDeItem } = R;

  // mesmo código do FKN nas notas e no estoque ("010001.0" = "010001")
  const codigo = v => String(v == null ? '' : v).trim().replace(/\.0+$/, '');
  // família "000" no FKN = sem família
  const familiaValida = f => !!f && !/^0+(\s|$)/.test(String(f).trim());

  const PADRAO = {
    margem: 10,       // % sobre o custo
    dias: 15,         // validade
    assunto: '🔥 Queima de estoque da {minha_empresa}: preços especiais até {validade}',
    corpo: '{saudacao}\n\nAqui é {vendedor_primeiro_nome}, da {minha_empresa}. Separei uma condição especial de queima de estoque, ' +
      'válida até {validade} ou enquanto durar o estoque:\n\n{itens}\n\nQuer garantir? É só responder este e-mail com os itens e as quantidades ' +
      'que eu já preparo o seu pedido.\n\nUm abraço,\n{vendedor}\n{minha_empresa}',
    whatsapp: '{saudacao} Aqui é {vendedor_primeiro_nome}, da {minha_empresa}. 🔥 Queima de estoque até {validade}, enquanto durar:\n{itens}\n' +
      'Quer que eu separe? É só me responder aqui com as quantidades.'
  };

  // preço de oferta = custo + margem, arredondado para cima no centavo
  const precoOferta = (custo, margem) => Math.ceil(num(custo) * (1 + num(margem) / 100) * 100 - 1e-6) / 100;
  // o que sobra por unidade depois dos custos sobre a venda (impostos, comissão, frete), em %
  const sobra = (preco, custo, custosVendaPct) => Math.round((num(preco) - num(custo) - num(preco) * num(custosVendaPct) / 100) * 100) / 100;
  // menor preço que não dá prejuízo com os custos sobre a venda
  const precoMinimo = (custo, custosVendaPct) => (num(custosVendaPct) >= 100 ? null : Math.ceil(num(custo) / (1 - num(custosVendaPct) / 100) * 100 - 1e-6) / 100);
  const desconto = it => (num(it.preco_tabela) > num(it.preco) ? Math.round((1 - num(it.preco) / num(it.preco_tabela)) * 100) : 0);

  // Quem comprou cada código (todas as notas de venda) → Map(codigo → Map(empresa_id → último dia)).
  function compradores(D, ix) {
    const m = new Map();
    (D.notas || []).forEach(n => {
      if (n.cancelada || !n.empresa_id) return;
      const dia = diaLocal(n.emitida_em);
      (ix.porNota.get(n.id) || []).forEach(it => {
        if (!cfopDeVenda(it.cfop) || !it.codigo) return;
        const k = codigo(it.codigo);
        if (!m.has(k)) m.set(k, new Map());
        const e = m.get(k);
        if (!e.has(n.empresa_id) || e.get(n.empresa_id) < dia) e.set(n.empresa_id, dia);
      });
    });
    return m;
  }

  // Itens para a oferta a partir do estoque parado (CRMGestao.compras(...).parado, já com a caixa
  // junta na unidade). → [{ codigo, descricao, unidade, saldo, custo, preco, preco_tabela, familia,
  // familia_codigos, compradores }] — custo só para a tela do administrador; não vai para o banco.
  function candidatos(parado, estoqueTodo, D, ix, margem) {
    const porFamilia = new Map();
    (estoqueTodo || []).forEach(x => { if (familiaValida(x.familia)) { const l = porFamilia.get(x.familia) || []; l.push(codigo(x.codigo)); porFamilia.set(x.familia, l); } });
    const quem = compradores(D, ix);
    return (parado || []).map(x => {
      const custo = num(x.custo_unit) > 0 ? num(x.custo_unit) : num(x.quantidade) > 0 ? num(x.custo_total) / num(x.quantidade) : 0;
      const k = codigo(x.codigo);
      return { codigo: k, descricao: x.descricao, unidade: x.unidade || '', saldo: num(x.quantidade), custo: Math.round(custo * 10000) / 10000,
        preco: precoOferta(custo, margem), preco_tabela: num(x.preco_venda) || null, familia: familiaValida(x.familia) ? x.familia : null,
        familia_codigos: familiaValida(x.familia) ? (porFamilia.get(x.familia) || []).filter(c => c !== k).slice(0, 80) : [],
        compradores: quem.has(k) ? quem.get(k).size : 0, valor: num(x.custo_total) };
    }).filter(x => x.custo > 0 && x.saldo > 0);
  }
  // O que vai para o banco (sem o custo).
  const itemParaGravar = it => ({ codigo: it.codigo, descricao: it.descricao, unidade: it.unidade || '', saldo: num(it.saldo),
    preco: Math.round(num(it.preco) * 100) / 100, preco_tabela: it.preco_tabela ? Math.round(num(it.preco_tabela) * 100) / 100 : null,
    familia: it.familia || null, familia_codigos: it.familia_codigos || [] });

  // Público da oferta. opc: { todos (inclui quem comprou qualquer coisa em 12 meses), atraso: Set(empresa_id),
  // emailsDe(empresa) → [e-mails] } → [{ empresa_id, nivel: 'comprou'|'familia'|'ativo', motivo, destaques: [codigos],
  // para: [e-mails], enviado: envio|null, segura: motivo|null }], os que mais combinam primeiro.
  function publico(D, ix, oferta, hoje, opc) {
    opc = opc || {};
    const itens = oferta.itens || [];
    const doItem = new Map(itens.map(it => [codigo(it.codigo), it]));
    const daFamilia = new Map(); // código parecido → item da oferta
    itens.forEach(it => (it.familia_codigos || []).forEach(c => { if (!daFamilia.has(codigo(c))) daFamilia.set(codigo(c), it); }));
    const d365 = somaDias(hoje, -365);
    const porEmpresa = new Map();
    const pega = id => { if (!porEmpresa.has(id)) porEmpresa.set(id, { comprou: new Map(), familia: new Map(), ultima: '' }); return porEmpresa.get(id); };
    (D.notas || []).forEach(n => {
      if (n.cancelada || !n.empresa_id) return;
      const dia = diaLocal(n.emitida_em);
      const its = (ix.porNota.get(n.id) || []).filter(it => cfopDeVenda(it.cfop));
      if (!its.length) return;
      const p = pega(n.empresa_id);
      if (dia >= d365 && dia > p.ultima) p.ultima = dia;
      its.forEach(it => {
        const k = codigo(it.codigo);
        if (doItem.has(k)) p.comprou.set(k, dia > (p.comprou.get(k) || '') ? dia : p.comprou.get(k));
        else if (dia >= d365 && daFamilia.has(k)) p.familia.set(codigo(daFamilia.get(k).codigo), true);
      });
    });
    const envios = new Map();
    (D.email_envios || []).filter(x => x.oferta_id === oferta.id && x.situacao === 'enviado').forEach(x => envios.set(x.empresa_id, x));
    const out = [];
    (D.empresas || []).forEach(e => {
      const p = porEmpresa.get(e.id);
      if (!p) return;
      const nivel = p.comprou.size ? 'comprou' : p.familia.size ? 'familia' : opc.todos && p.ultima ? 'ativo' : null;
      if (!nivel) return;
      const destaques = [...p.comprou.keys()].concat([...p.familia.keys()].filter(k => !p.comprou.has(k)));
      const nome = k => nomeDeItem((doItem.get(k) || {}).descricao || k);
      const motivo = nivel === 'comprou' ? 'já comprou ' + destaques.filter(k => p.comprou.has(k)).slice(0, 2).map(nome).join(', ') +
        (p.comprou.size > 2 ? ' e mais ' + (p.comprou.size - 2) : '') + ' (última vez ' + dataBR([...p.comprou.values()].reduce((m, d) => (d > m ? d : m), '')) + ')'
        : nivel === 'familia' ? 'compra produtos parecidos (' + destaques.slice(0, 2).map(k => (doItem.get(k) || {}).familia || nome(k)).join(', ') + ')'
        : 'cliente ativo (última compra ' + dataBR(p.ultima) + ')';
      const para = opc.emailsDe ? opc.emailsDe(e) : C.emailsEmpresa(e, ix.porEmpresa.contatos.get(e.id));
      const segura = opc.atraso && opc.atraso.has(e.id) ? 'duplicata em atraso' : e.situacao === 'perdido' ? 'cliente perdido' : null;
      out.push({ empresa_id: e.id, responsavel_id: e.responsavel_id || null, nivel, motivo, destaques, para, sair: !!e.email_sair_em,
        enviado: envios.get(e.id) || null, segura, peso: (nivel === 'comprou' ? 3 : nivel === 'familia' ? 2 : 1) * 100 + Math.min(99, destaques.length) });
    });
    return out.sort((a, b) => b.peso - a.peso || String((ix.resumo.get(b.empresa_id) || {}).ultimaCompra || '').localeCompare(String((ix.resumo.get(a.empresa_id) || {}).ultimaCompra || '')));
  }

  // Lista de itens em texto (WhatsApp e a versão texto do e-mail): os destaques do cliente primeiro.
  function textoItens(oferta, destaques, max) {
    const ord = new Map((destaques || []).map((k, i) => [k, i]));
    const l = (oferta.itens || []).slice().sort((a, b) => (ord.has(codigo(a.codigo)) ? ord.get(codigo(a.codigo)) : 1e6) - (ord.has(codigo(b.codigo)) ? ord.get(codigo(b.codigo)) : 1e6));
    const lin = l.slice(0, max || 12).map(it => '• ' + nomeDeItem(it.descricao) + (it.unidade ? ' (' + it.unidade + ')' : '') + ': ' + moeda(it.preco) +
      (desconto(it) >= 3 ? ' (de ' + moeda(it.preco_tabela) + ', -' + desconto(it) + '%)' : ''));
    return lin.join('\n') + (l.length > lin.length ? '\n• e mais ' + (l.length - lin.length) + ' produto(s)' : '');
  }
  // Variáveis do texto: as da cadência mais {validade} e {itens} (no e-mail, {itens} fica para a função
  // montar a tabela com os preços do banco).
  function variaveis(oferta, e, ix, opc, destaques, canal) {
    const c = (ix.porEmpresa.contatos.get(e.id) || []).slice().sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0))[0] || null;
    const vend = (opc.nomeUsuario && opc.nomeUsuario(e.responsavel_id)) || opc.eu || '';
    return { saudacao: C.saudacaoDe(c && c.nome), contato: c ? c.nome : '', primeiro_nome: primeiroNome(c && c.nome), empresa: String(e.nome || '').split(' | ')[0].trim(),
      vendedor: vend, vendedor_primeiro_nome: primeiroNome(vend), minha_empresa: opc.minhaEmpresa || '', validade: dataBR(oferta.validade),
      itens: canal === 'email' ? '{itens}' : textoItens(oferta, destaques, 12) };
  }
  const texto = (modelo, v) => aplicaModelo(modelo, v);

  // Resultado: e-mails enviados/abertos e o que saiu dos itens da oferta (notas desde a criação).
  function resultado(D, ix, oferta, hoje) {
    const desde = diaLocal(oferta.criado_em || oferta.validade), ate = somaDias(oferta.validade, 7);
    const codigos = new Set((oferta.itens || []).map(it => codigo(it.codigo)));
    const env = (D.email_envios || []).filter(x => x.oferta_id === oferta.id && x.situacao === 'enviado');
    const avisados = new Set(env.map(x => x.empresa_id));
    let valor = 0, valorAvisados = 0;
    const clientes = new Set(), vendidos = new Map();
    (D.notas || []).forEach(n => {
      if (n.cancelada) return;
      const dia = diaLocal(n.emitida_em);
      if (dia < desde || dia > ate) return;
      (ix.porNota.get(n.id) || []).forEach(it => {
        const k = codigo(it.codigo);
        if (!cfopDeVenda(it.cfop) || !codigos.has(k)) return;
        valor += num(it.valor_total); if (n.empresa_id) clientes.add(n.empresa_id);
        if (avisados.has(n.empresa_id)) valorAvisados += num(it.valor_total);
        vendidos.set(k, (vendidos.get(k) || 0) + num(it.quantidade));
      });
    });
    const r2 = v => Math.round(v * 100) / 100;
    return { enviados: env.length, abertos: env.filter(x => x.aberto_em).length, clicados: env.filter(x => x.clicado_em).length,
      valor: r2(valor), valorAvisados: r2(valorAvisados), clientes: clientes.size, vendidos, vencida: !!hoje && diasEntre(oferta.validade, hoje) > 0 };
  }

  const api = { PADRAO, codigo, precoOferta, precoMinimo, sobra, desconto, compradores, candidatos, itemParaGravar, publico, textoItens, variaveis, texto, resultado };
  raiz.CRMOfertas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ------------------------------------------------------------ tela
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, O = raiz.CRMOfertas, R = raiz.CRMRegras, C = raiz.CRMCadencia;
  if (!CRM || !CRM.telas) return;
  const E = () => CRM.estado;
  const esc = CRM.esc;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const NIVEL = { comprou: ['já comprou', 'verde'], familia: ['compra parecido', 'azul'], ativo: ['cliente ativo', 'cinza'] };
  let aberta = null, todos = false, filtroVend = '', marcados = new Set(), enviando = false, iaLigada = null;

  const ofertas = () => (E().D.ofertas || []).slice().sort((a, b) => (b.ativa - a.ativa) || String(b.criado_em).localeCompare(String(a.criado_em)));
  const vencida = o => String(o.validade) < CRM.hoje();
  const situacao = o => (!o.ativa ? ['encerrada', 'cinza'] : vencida(o) ? ['vencida', 'ambar'] : ['no ar até ' + R.dataBR(o.validade), 'verde']);
  const marca = () => { const c = window.CRM_CONFIG || {}; return { nome: CRM.nomeInstalacao(), cor: (c.cores && c.cores.principal) || '', logo: c.logo ? new URL(c.logo, location.href).href : '' }; };
  const opcVars = () => ({ nomeUsuario: id => (CRM.usuario(id) || {}).nome || '', eu: (E().eu || {}).nome || '', minhaEmpresa: CRM.nomeInstalacao() });
  const atrasos = () => new Set((E().D.empresas || []).filter(e => { const f = CRM.financeiro && CRM.financeiro(e.id); return f && (f.vencido > 0 || f.cartorio > 0); }).map(e => e.id));
  const pct = v => String(Math.round(v)) + '%';

  // ---------------------------------------------------------- montar (administrador, em Compras)
  function montar(c) {
    if (!c || !c.parado || !c.parado.length) { CRM.toast('Sem estoque parado para montar a oferta.', true); return; }
    const cfg = E().cfg || {};
    const margem0 = Number(cfg.oferta_margem) || O.PADRAO.margem;
    const lista = O.candidatos(c.parado, c.produtos, E().D, E().ix, margem0).sort((a, b) => (b.compradores > 0) - (a.compradores > 0) || b.valor - a.valor);
    const marcadosIni = new Set(lista.filter(x => x.compradores > 0).slice(0, 25).map(x => x.codigo));
    const mes = new Date(CRM.hoje() + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const linha = (x, i) => '<tr data-i="' + i + '" data-busca="' + esc(R.normaliza(x.descricao + ' ' + x.codigo + ' ' + (x.familia || ''))) + '">' +
      '<td class="cx-marca"><input type="checkbox" data-of-item="' + i + '"' + (marcadosIni.has(x.codigo) ? ' checked' : '') + '></td>' +
      '<td><strong>' + esc(R.nomeDeItem(x.descricao)) + '</strong><small>' + esc(x.codigo) + (x.familia ? ' · ' + esc(x.familia) : '') + '</small></td>' +
      '<td class="num">' + esc(String(+x.saldo.toFixed(1)).replace('.', ',')) + ' <small>' + esc(x.unidade) + '</small></td>' +
      '<td class="num">' + esc(R.moeda(x.custo)) + '</td><td class="num">' + (x.preco_tabela ? esc(R.moeda(x.preco_tabela)) : '—') + '</td>' +
      '<td class="num"><input type="text" data-moeda class="of-preco" data-of-preco="' + i + '" value="' + x.preco.toFixed(2) + '"></td>' +
      '<td class="num" data-of-sobra="' + i + '"></td><td class="num">' + (x.compradores || '—') + '</td><td class="num">' + esc(R.moeda(x.valor)) + '</td></tr>';
    CRM.abrirForm({
      titulo: 'Oferta de queima de estoque', largura: 'extra',
      intro: 'Escolha os produtos parados (sem venda em 90 dias) e o preço. A oferta guarda só o preço de oferta e o de tabela: o custo fica com você. ' +
        'Já vêm marcados os 25 de maior valor que algum cliente já comprou.',
      campos: [{ nome: 'titulo', rotulo: 'Nome da oferta', obrigatorio: true, largo: true },
        { nome: 'validade', rotulo: 'Válida até', tipo: 'data', obrigatorio: true },
        { nome: 'margem', rotulo: 'Margem sobre o custo (%)', tipo: 'numero', passo: '0.5', min: 0 },
        { nome: 'custos', rotulo: 'Impostos + comissão + frete sobre a venda (%)', tipo: 'numero', passo: '0.5', min: 0, max: 90,
          ajuda: 'opcional: mostra o que sobra de cada item e avisa quando dá prejuízo' }],
      valores: { titulo: 'Queima de estoque — ' + mes, validade: R.somaDias(CRM.hoje(), O.PADRAO.dias), margem: margem0, custos: cfg.oferta_custos_venda || null },
      htmlDepois: '<div class="of-montar"><p class="cx-soma" data-of-resumo></p><p class="acoes"><input type="search" class="of-busca" placeholder="Procurar produto, código ou família" data-of-busca>' +
        '<button type="button" class="mini" data-of-todos="1">Marcar os da busca</button><button type="button" class="mini" data-of-todos="0">Desmarcar os da busca</button></p>' +
        '<div class="tabela-rolagem of-tabela"><table class="tabela"><thead><tr><th></th><th>Produto</th><th class="num">Estoque</th><th class="num">Custo</th><th class="num">Tabela</th>' +
        '<th class="num">Oferta</th><th class="num">Sobra</th><th class="num" title="clientes que já compraram este produto">Já compraram</th><th class="num">Parado</th></tr></thead><tbody>' +
        lista.map(linha).join('') + '</tbody></table></div></div>',
      salvarTexto: 'Criar a oferta',
      extras(form) {
        const editado = new Set();
        const custos = () => Number(form.elements.custos.value) || 0;
        const preco = i => Number(($('[data-of-preco="' + i + '"]', form) || {}).value) || 0;
        const atualiza = () => {
          let n = 0, valor = 0, venda = 0, prejuizo = 0, abaixo = 0;
          lista.forEach((x, i) => {
            const p = preco(i), s = O.sobra(p, x.custo, custos());
            const cel = $('[data-of-sobra="' + i + '"]', form);
            cel.innerHTML = custos() ? (s < 0 ? CRM.selo(R.moeda(s), 'vermelho') : esc(R.moeda(s))) : '<small>' + esc(R.moeda(p - x.custo)) + '</small>';
            if (!$('[data-of-item="' + i + '"]', form).checked) return;
            n++; valor += x.valor; venda += p * x.saldo;
            if (custos() && s < 0) prejuizo++;
            if (p < x.custo) abaixo++;
          });
          $('[data-of-resumo]', form).innerHTML = '<strong>' + n + ' produto(s)</strong> · ' + esc(R.moeda(valor)) + ' a custo · se vender tudo: <strong>' + esc(R.moeda(venda)) + '</strong>' +
            (abaixo ? ' · ' + CRM.selo(abaixo + ' abaixo do custo', 'vermelho') : '') + (prejuizo ? ' · ' + CRM.selo(prejuizo + ' com prejuízo', 'vermelho') +
              ' <button type="button" class="mini" data-of-minimo>Subir ao mínimo sem prejuízo</button>' : '');
          const b = $('[data-of-minimo]', form);
          if (b) b.addEventListener('click', () => { lista.forEach((x, i) => { const m = O.precoMinimo(x.custo, custos()); if (m && preco(i) < m) { $('[data-of-preco="' + i + '"]', form).value = m.toFixed(2); editado.add(i); } }); atualiza(); });
        };
        form.elements.margem.addEventListener('input', () => { const m = Number(form.elements.margem.value) || 0; lista.forEach((x, i) => { if (!editado.has(i)) $('[data-of-preco="' + i + '"]', form).value = O.precoOferta(x.custo, m).toFixed(2); }); atualiza(); });
        form.elements.custos.addEventListener('input', atualiza);
        $$('[data-of-preco]', form).forEach(el => el.addEventListener('input', () => { editado.add(+el.dataset.ofPreco); atualiza(); }));
        $$('[data-of-item]', form).forEach(el => el.addEventListener('change', atualiza));
        const busca = $('[data-of-busca]', form);
        busca.addEventListener('input', () => { const q = R.normaliza(busca.value); $$('tbody tr', form).forEach(tr => { tr.hidden = !!q && tr.dataset.busca.indexOf(q) === -1; }); });
        busca.addEventListener('keydown', ev => { if (ev.key === 'Enter') ev.preventDefault(); });
        $$('[data-of-todos]', form).forEach(b => b.addEventListener('click', () => { $$('tbody tr', form).filter(tr => !tr.hidden).forEach(tr => { $('[data-of-item]', tr).checked = b.dataset.ofTodos === '1'; }); atualiza(); }));
        atualiza();
      },
      aoSalvar: async (v, form) => {
        const itens = lista.map((x, i) => ({ x, i })).filter(({ i }) => $('[data-of-item="' + i + '"]', form).checked)
          .map(({ x, i }) => Object.assign({}, x, { preco: Number($('[data-of-preco="' + i + '"]', form).value) || 0 }));
        if (!itens.length) throw new Error('marque pelo menos um produto');
        if (itens.some(x => !(x.preco > 0))) throw new Error('tem produto marcado sem preço');
        const abaixo = itens.filter(x => x.preco < x.custo);
        if (abaixo.length && !confirm(abaixo.length + ' produto(s) ficam abaixo do custo. Criar assim mesmo?')) return false;
        if (v.validade < CRM.hoje()) throw new Error('a validade já passou');
        const o = await CRM.inserir('ofertas', { titulo: v.titulo, validade: v.validade, itens: itens.map(O.itemParaGravar), assunto: O.PADRAO.assunto, corpo: O.PADRAO.corpo, whatsapp: O.PADRAO.whatsapp, ativa: true });
        aberta = o.id; marcados = new Set();
        CRM.toast('Oferta criada com ' + itens.length + ' produto(s). Agora confira o texto e escolha quem recebe.');
        CRM.irPara('ofertas');
      }
    });
  }

  // ---------------------------------------------------------- textos (gestora e administrador)
  function formTextos(o) {
    CRM.abrirForm({
      titulo: 'Textos da oferta', largura: 'largo',
      intro: 'Variáveis: {saudacao} {primeiro_nome} {empresa} {vendedor} {vendedor_primeiro_nome} {minha_empresa} {validade} {itens}. ' +
        'No e-mail, a linha {itens} vira a tabela com os preços (os do cliente primeiro); no WhatsApp, a lista.',
      campos: [{ nome: 'assunto', rotulo: 'Assunto do e-mail', obrigatorio: true, largo: true },
        { nome: 'corpo', rotulo: 'Texto do e-mail', tipo: 'textarea', linhas: 12, obrigatorio: true, largo: true },
        { nome: 'whatsapp', rotulo: 'Texto do WhatsApp', tipo: 'textarea', linhas: 6, obrigatorio: true, largo: true },
        { nome: 'pedido', rotulo: 'Pedido para a IA (opcional)', largo: true, dica: 'ex.: mais curto; destacar que é para condomínios; tom mais animado' }],
      valores: { assunto: o.assunto || O.PADRAO.assunto, corpo: o.corpo || O.PADRAO.corpo, whatsapp: o.whatsapp || O.PADRAO.whatsapp },
      rodape: '<button type="button" class="btn sec" data-of-ia>✨ Escrever com IA</button>',
      extras(form) {
        const b = $('[data-of-ia]', form);
        b.addEventListener('click', async () => {
          b.disabled = true; const t = b.textContent; b.textContent = 'Escrevendo…';
          try {
            const r = await CRM.store().ofertaTexto({ titulo: o.titulo, validade: o.validade, itens: o.itens, pedido: form.elements.pedido.value });
            form.elements.assunto.value = r.assunto; form.elements.corpo.value = r.corpo; form.elements.whatsapp.value = r.whatsapp;
            CRM.toast('Texto escrito pela IA: confira antes de salvar.');
          } catch (e) { CRM.falhou(e); } finally { b.disabled = false; b.textContent = t; }
        });
      },
      aoSalvar: async v => {
        if (!/\{itens\}/.test(v.corpo) || !/\{itens\}/.test(v.whatsapp)) throw new Error('deixe a linha {itens} no e-mail e no WhatsApp (é onde entram os produtos e os preços)');
        await CRM.atualizar('ofertas', o.id, { assunto: v.assunto, corpo: v.corpo, whatsapp: v.whatsapp });
        CRM.toast('Textos salvos.');
      }
    });
  }

  // ---------------------------------------------------------- envio
  function textosDe(o, p) {
    const e = CRM.empresa(p.empresa_id) || {}, ix = E().ix, op = opcVars();
    const ve = O.variaveis(o, e, ix, op, p.destaques, 'email');
    return { assunto: O.texto(o.assunto || O.PADRAO.assunto, ve), corpo: O.texto(o.corpo || O.PADRAO.corpo, ve),
      whatsapp: O.texto(o.whatsapp || O.PADRAO.whatsapp, O.variaveis(o, e, ix, op, p.destaques, 'whatsapp')) };
  }
  const podeEmail = p => p.para.length && !p.sair && !p.enviado && !p.segura;
  async function enviaEmail(o, p) {
    const t = textosDe(o, p);
    return CRM.store().email({ acao: 'enviar', tipo: 'oferta', oferta_id: o.id, empresa_id: p.empresa_id, destaques: p.destaques, assunto: t.assunto, corpo: t.corpo,
      para: p.para, sair_url: new URL('sair.html', location.href).href, marca: marca() });
  }

  function publicoDe(o) {
    const l = O.publico(E().D, E().ix, o, CRM.hoje(), { todos, atraso: atrasos() });
    return filtroVend ? l.filter(p => p.responsavel_id === filtroVend) : l;
  }

  // ---------------------------------------------------------- tela Ofertas
  function cartaoOferta(o) {
    const s = situacao(o), r = O.resultado(E().D, E().ix, o, CRM.hoje());
    const gestor = CRM.ehGestor(), no = o.ativa && !vencida(o);
    const pub = publicoDe(o);
    const prontos = pub.filter(podeEmail);
    marcados.forEach(id => { if (!prontos.some(p => p.empresa_id === id)) marcados.delete(id); });
    const kpi = (t, v, sub) => '<div class="kpi"><span>' + esc(t) + '</span><strong>' + esc(v) + '</strong><small>' + esc(sub) + '</small></div>';
    const vend = (E().D.usuarios || []).filter(u => u.ativo && u.papel !== 'comprador');
    const exemplo = pub[0] ? textosDe(o, pub[0]) : null;
    const stEmail = p => p.enviado ? (p.enviado.aberto_em ? CRM.selo('abriu', 'verde') : CRM.selo('e-mail enviado', 'cinza'))
      : p.sair ? CRM.selo('pediu para não receber e-mail', 'cinza') : !p.para.length ? '<small>sem e-mail</small>' : p.segura ? CRM.selo(p.segura, 'ambar') : '';
    return '<section class="cartao"><header class="em-topo"><div><h2>' + esc(o.titulo) + ' ' + CRM.selo(s[0], s[1]) + '</h2>' +
        '<p class="sub">' + o.itens.length + ' produto(s) · válida até ' + esc(R.dataBR(o.validade)) + ' ou enquanto durar o estoque</p></div>' +
        (gestor ? '<p class="acoes"><button type="button" class="btn sec" data-acao="of-textos" data-id="' + esc(o.id) + '">Textos e IA</button>' +
          '<button type="button" class="btn sec" data-acao="of-ativa" data-id="' + esc(o.id) + '">' + (o.ativa ? 'Encerrar' : 'Reabrir') + '</button>' +
          (CRM.ehAdmin() ? '<button type="button" class="btn sec perigo" data-acao="of-excluir" data-id="' + esc(o.id) + '">Excluir</button>' : '') + '</p>' : '') + '</header>' +
      '<div class="kpis">' + kpi('E-mails enviados', String(r.enviados), r.enviados ? r.abertos + ' abriram' : 'ninguém ainda') +
        kpi('Vendido dos itens', R.moeda(r.valor), r.clientes + ' cliente(s) desde a criação') +
        kpi('De quem recebeu', R.moeda(r.valorAvisados), 'vendas para clientes avisados por e-mail') +
        kpi('Público', String(pub.length), prontos.length + ' para receber e-mail') + '</div>' +
      '<details data-chave="of-itens"><summary><h2>Produtos e preços</h2></summary><div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th class="num">Estoque na criação</th><th class="num">Tabela</th><th class="num">Oferta</th><th class="num">Desconto</th><th class="num">Vendido</th></tr></thead><tbody>' +
        o.itens.map(it => '<tr><td><strong>' + esc(R.nomeDeItem(it.descricao)) + '</strong><small>' + esc(it.codigo) + '</small></td><td class="num">' + esc(String(+Number(it.saldo || 0).toFixed(1)).replace('.', ',')) + ' <small>' + esc(it.unidade || '') + '</small></td>' +
          '<td class="num">' + (it.preco_tabela ? esc(R.moeda(it.preco_tabela)) : '—') + '</td><td class="num"><strong>' + esc(R.moeda(it.preco)) + '</strong></td><td class="num">' + (O.desconto(it) ? pct(O.desconto(it)) : '—') + '</td>' +
          '<td class="num">' + (r.vendidos.get(O.codigo(it.codigo)) ? esc(String(+r.vendidos.get(O.codigo(it.codigo)).toFixed(1)).replace('.', ',')) : '—') + '</td></tr>').join('') + '</tbody></table></div></details>' +
      (exemplo ? '<details data-chave="of-previa"><summary><h2>Como chega <small>exemplo: ' + esc(CRM.nomeEmpresa(pub[0].empresa_id)) + '</small></h2></summary><div class="g-duas">' +
        '<div><p><strong>E-mail:</strong> ' + esc(exemplo.assunto) + '</p><pre class="of-previa">' + esc(exemplo.corpo.replace('{itens}', '[tabela com os produtos e os preços]')) + '</pre></div>' +
        '<div><p><strong>WhatsApp:</strong></p><pre class="of-previa">' + esc(exemplo.whatsapp) + '</pre></div></div></details>' : '') +
      '<h2>Quem recebe</h2><div class="filtros-linha"><label class="check"><input type="checkbox" data-of-todos-clientes' + (todos ? ' checked' : '') + '> incluir todo cliente que comprou nos últimos 12 meses</label>' +
        (CRM.ehGestor() ? '<label class="filtro-inline">Vendedor(a) <select data-of-vend>' + CRM.opcoesHTML([['', 'Todas']].concat(vend.map(u => [u.user_id, u.nome])), filtroVend) + '</select></label>' : '') + '</div>' +
      (no && prontos.length ? '<p class="cx-soma">' + '<strong>' + marcados.size + '</strong> marcado(s) de ' + prontos.length + ' com e-mail · ' +
        '<button type="button" class="mini" data-acao="of-marca-todos" data-id="' + esc(o.id) + '">Marcar todos</button>' +
        '<button type="button" class="mini" data-acao="of-marca-nenhum">Limpar</button>' +
        '<button type="button" class="btn" data-acao="of-enviar" data-id="' + esc(o.id) + '"' + (!marcados.size || enviando ? ' disabled' : '') + '>' + (enviando ? 'Enviando…' : 'Enviar e-mail para os ' + marcados.size) + '</button></p>'
        : !no ? '<p class="dica">Oferta ' + esc(s[0]) + ': o envio está fechado.</p>' : '') +
      (pub.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th></th><th>Cliente</th><th>Por quê</th>' + (CRM.carteira() ? '' : '<th>Vendedor(a)</th>') + '<th>E-mail</th><th></th></tr></thead><tbody>' +
        pub.map(p => '<tr><td class="cx-marca">' + (no && podeEmail(p) ? '<input type="checkbox" data-of-cli="' + esc(p.empresa_id) + '"' + (marcados.has(p.empresa_id) ? ' checked' : '') + '>' : '') + '</td>' +
          '<td><button type="button" class="linha" data-acao="abrir-empresa" data-id="' + esc(p.empresa_id) + '"><strong>' + esc(CRM.nomeEmpresa(p.empresa_id)) + '</strong></button> ' + CRM.selo(NIVEL[p.nivel][0], NIVEL[p.nivel][1]) + '</td>' +
          '<td><small>' + esc(p.motivo) + '</small></td>' + (CRM.carteira() ? '' : '<td><small>' + esc(R.primeiroNome(CRM.nomeUsuario(p.responsavel_id)) || '—') + '</small></td>') +
          '<td>' + stEmail(p) + '</td><td class="num">' + (no ? '<button type="button" class="mini wa" data-acao="of-whats" data-id="' + esc(o.id + '|' + p.empresa_id) + '">WhatsApp</button>' : '') + '</td></tr>').join('') +
        '</tbody></table></div>' : '<p class="vazio">Nenhum cliente comprou estes produtos' + (todos ? '' : ' (marque "incluir todo cliente…" para ampliar)') + '.</p>') +
      '</section>';
  }

  CRM.telas.ofertas = {
    render() {
      if (CRM.ehComprador()) return '<div class="cartao"><p class="vazio">Esta tela é da equipe de vendas.</p></div>';
      const l = ofertas();
      if (!aberta || !l.some(o => o.id === aberta)) aberta = l.length ? l[0].id : null;
      const o = l.find(x => x.id === aberta);
      return '<div class="cabecalho"><div><h1>Ofertas</h1><p class="sub">queima de estoque: preço especial por tempo limitado, por e-mail (em nome do(a) vendedor(a)) e WhatsApp</p></div>' +
        (CRM.ehAdmin() ? '<span class="flex"></span><button type="button" class="btn" data-acao="of-nova">🔥 Nova oferta com o estoque parado</button>' : '') + '</div>' +
        (l.length > 1 ? '<div class="abas-mini">' + l.map(x => '<button type="button" class="mini' + (x.id === aberta ? ' ativo' : '') + '" data-acao="of-abrir" data-id="' + esc(x.id) + '">' + esc(x.titulo) + ' · ' + esc(situacao(x)[0]) + '</button>').join('') + '</div>' : '') +
        (o ? cartaoOferta(o) : '<div class="cartao"><p class="vazio">Nenhuma oferta ainda. ' + (CRM.ehAdmin() ? 'Clique em "Nova oferta" (ou em Compras → Estoque parado) para montar a primeira.' : 'O administrador monta as ofertas com o estoque parado.') + '</p></div>');
    },
    depois(c) {
      $$('[data-of-cli]', c).forEach(x => x.addEventListener('change', () => { if (x.checked) marcados.add(x.dataset.ofCli); else marcados.delete(x.dataset.ofCli); CRM.render(); }));
      const t = $('[data-of-todos-clientes]', c); if (t) t.addEventListener('change', () => { todos = t.checked; CRM.render(); });
      const v = $('[data-of-vend]', c); if (v) v.addEventListener('change', () => { filtroVend = v.value; marcados = new Set(); CRM.render(); });
    }
  };

  // Compras (administrador): cartão para montar a oferta com o parado.
  CRM.ofertas = { montar, botaoCompras: c => (CRM.ehAdmin() && c && c.parado && c.parado.length ? '<section class="cartao of-chamada"><p><strong>🔥 Queima de estoque:</strong> ' + c.parado.length +
    ' produtos sem venda em 90 dias. Monte uma oferta (custo + margem), mande por e-mail e WhatsApp para quem já comprou.</p><p class="acoes"><button type="button" class="btn" data-acao="of-nova">Montar oferta</button>' +
    ((E().D.ofertas || []).length ? '<button type="button" class="btn sec" data-acao="of-ver">Ver ofertas</button>' : '') + '</p></section>' : '') };

  const acha = id => (E().D.ofertas || []).find(o => o.id === id);
  Object.assign(CRM.acoes, {
    'of-nova': () => { const c = CRM.comprasAtual && CRM.comprasAtual(); if (c && c.estoque) montar(c); else { CRM.irPara('compras'); CRM.toast('Abrindo Compras para ler o estoque; clique em "Montar oferta" de novo.'); } },
    'of-ver': () => CRM.irPara('ofertas'),
    'of-abrir': id => { aberta = id; marcados = new Set(); CRM.render(); },
    'of-textos': id => { const o = acha(id); if (o) formTextos(o); },
    'of-ativa': async id => { const o = acha(id); if (!o) return; try { await CRM.atualizar('ofertas', id, { ativa: !o.ativa }); CRM.toast(o.ativa ? 'Oferta encerrada.' : 'Oferta reaberta.'); } catch (e) { CRM.falhou(e); } },
    'of-excluir': async id => { const o = acha(id); if (!o || !confirm('Excluir a oferta "' + o.titulo + '"? Os e-mails enviados ficam no histórico dos clientes.')) return; try { await CRM.remover('ofertas', id); aberta = null; CRM.toast('Oferta excluída.'); } catch (e) { CRM.falhou(e); } },
    'of-marca-todos': id => { const o = acha(id); if (!o) return; publicoDe(o).filter(podeEmail).forEach(p => marcados.add(p.empresa_id)); CRM.render(); },
    'of-marca-nenhum': () => { marcados = new Set(); CRM.render(); },
    'of-enviar': async id => {
      const o = acha(id); if (!o || enviando) return;
      const l = publicoDe(o).filter(p => podeEmail(p) && marcados.has(p.empresa_id));
      if (!l.length || !confirm('Enviar a oferta por e-mail para ' + l.length + ' cliente(s), cada um em nome do(a) vendedor(a) da carteira?')) return;
      enviando = true; CRM.render();
      let ok = 0; const falhas = [];
      for (const p of l) {
        try { await enviaEmail(o, p); ok++; marcados.delete(p.empresa_id); if (ok % 5 === 0) CRM.toast('Enviados ' + ok + ' de ' + l.length + '…'); }
        catch (e) { falhas.push(CRM.nomeEmpresa(p.empresa_id) + ': ' + e.message); if (/limite|não está ligado|encerrada|vencida/.test(e.message)) break; }
      }
      enviando = false;
      await CRM.recarregar();
      CRM.toast(ok + ' e-mail(s) enviado(s)' + (falhas.length ? '; não saíram: ' + falhas.slice(0, 5).join(' · ') + (falhas.length > 5 ? ' e mais ' + (falhas.length - 5) : '') : '.'), !!falhas.length);
    },
    'of-whats': (id, el) => {
      const [oid, eid] = String(id).split('|'), o = acha(oid), e = CRM.empresa(eid), F = CRM.fichas;
      if (!o || !e || !F) return;
      const p = publicoDe(o).find(x => x.empresa_id === eid) || { empresa_id: eid, destaques: [] };
      const c = F.escolheContato(e, el && el.dataset.contato, x => R.linkWhatsApp(x.whatsapp || x.celular || x.telefone));
      const tel = F.telDe(e, c), texto = textosDe(o, p).whatsapp;
      const fixo = /^(55)?\d{2}[2-5]\d{7}$/.test(String(tel || '').replace(/\D/g, ''));
      const link = !fixo && R.linkWhatsApp(tel, texto) || 'https://wa.me/?text=' + encodeURIComponent(texto);
      raiz.open(link, '_blank', 'noopener');
      if (link.indexOf('https://wa.me/?') === 0) CRM.toast('Cliente sem celular no CRM: escolha o contato no WhatsApp.');
      F.registraAuto(e, c, 'whatsapp', 'Oferta "' + o.titulo + '" pelo WhatsApp' + (c ? ' com ' + c.nome : '') + ': ' + texto).then(a => F.esperaVolta(e, c, a, 'whatsapp')).catch(CRM.falhou);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
