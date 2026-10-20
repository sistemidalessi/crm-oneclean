/* CRM Sistemi Dalessi — Pedidos ao fornecedor: compras a caminho (20/10/2026, simulação aprovada pelo Anderson: "quando
   lançar uma compra, aparecer essa informação pra vendedora saber que já foi comprado, quanto foi e +- quando chegar").
   O comprador registra o pedido na sugestão de Compras (um por fornecedor; previsão = hoje + prazo do fornecedor, que
   ele pode mudar). O andamento sai do banco (crm_compra_andamento_int): a nota do fornecedor (Sefaz ou XML) fatura e a
   entrada dá a baixa, por produto e na ordem dos pedidos. Faturado: chega ~2 dias depois da nota. A vendedora lê por
   crm_a_caminho() (quantidade e datas, sem custo nem fornecedor) e vê em Produtos e no pedido de venda.
   Parte pura no começo (testes/compras-pedidos.test.js); a tela "Pedidos ao fornecedor" vem depois. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  const { num, somaDias, dataBR } = R;
  const DIAS_DEPOIS_DA_NOTA = 2;
  const dia = v => (v ? String(v).slice(0, 10) : null);
  // A nota vem com hora (UTC); o dia dela é o de São Paulo.
  const diaDaNota = v => (v ? (R.diaLocal ? R.diaLocal(v) : dia(v)) : null);
  const br = d => (d ? dataBR(d).slice(0, 5) : '');

  // Previsão que vale: com nota do fornecedor ainda não entrada, o dia da nota + 2; senão a do pedido.
  const previsaoDe = (previsao, faturado, faturadoEm) => (num(faturado) > 0 && faturadoEm ? somaDias(diaDaNota(faturadoEm), DIAS_DEPOIS_DA_NOTA) : dia(previsao));

  // Junta pedidos, itens e andamento e diz a situação de cada pedido:
  // cancelado | recebido (fechado à mão ou tudo entrou) | parcial (parte entrou) | faturado (veio nota) | pedido.
  function monta(pedidos, itens, andamento, hoje) {
    const an = new Map((andamento || []).map(a => [a.pedido_id + '|' + a.ordem, a]));
    const porPed = new Map();
    (itens || []).forEach(i => { if (!porPed.has(i.pedido_id)) porPed.set(i.pedido_id, []); porPed.get(i.pedido_id).push(i); });
    return (pedidos || []).map(p => {
      const its = (porPed.get(p.id) || []).slice().sort((a, b) => a.ordem - b.ordem).map(i => {
        const a = an.get(p.id + '|' + i.ordem) || {};
        const q = Math.max(num(i.quantidade) - num(i.cancelado), 0);
        const fat = p.situacao === 'recebido' ? q : num(a.faturado), rec = p.situacao === 'recebido' ? q : num(a.recebido);
        return Object.assign({}, i, { q, faturado: fat, recebido: rec, falta: Math.max(q - rec, 0), faturadoEm: a.faturado_em || null, notas: a.notas || '' });
      });
      const falta = its.reduce((s, i) => s + i.falta, 0), rec = its.reduce((s, i) => s + i.recebido, 0);
      const fatAberto = its.reduce((s, i) => s + Math.max(i.faturado - i.recebido, 0), 0);
      const ultNota = its.map(i => i.faturadoEm).filter(Boolean).sort().pop() || null;
      const sit = p.situacao === 'cancelado' ? 'cancelado' : p.situacao === 'recebido' || (its.length && falta <= 0) ? 'recebido'
        : rec > 0 ? 'parcial' : fatAberto > 0 ? 'faturado' : 'pedido';
      const previsao = previsaoDe(p.previsao, fatAberto, ultNota);
      const aberto = sit === 'pedido' || sit === 'faturado' || sit === 'parcial';
      return Object.assign({}, p, {
        itens: its, situacaoAtual: sit, aberto, previsaoEf: previsao, ultNota, notas: [...new Set(its.map(i => i.notas).filter(Boolean).join(', ').split(', ').filter(Boolean))].join(', '),
        atrasado: aberto && !!previsao && !!hoje && previsao < hoje, diasAtraso: aberto && previsao && hoje && previsao < hoje ? R.diasEntre(previsao, hoje) : 0,
        total: Math.round(its.reduce((s, i) => s + (i.custo_unit != null ? num(i.custo_unit) * num(i.quantidade) : 0), 0) * 100) / 100,
        unidades: its.reduce((s, i) => s + num(i.quantidade), 0)
      });
    }).sort((a, b) => (b.aberto - a.aberto) || (b.atrasado - a.atrasado) || String(b.criado_em).localeCompare(String(a.criado_em)));
  }

  // O que está a caminho de cada produto (crm_a_caminho) → Map(código → { falta, faturado, proxima, atrasado, linhas }).
  // Cada linha: { falta, faturado, pedidoEm, previsao, atrasado } — previsão já com a regra da nota.
  function porProduto(lista, hoje) {
    const m = new Map();
    (lista || []).forEach(x => {
      const cod = String(x.codigo || '').replace(/\.\d+$/, '');
      if (!cod || !(num(x.falta) > 0)) return;
      const prev = previsaoDe(x.previsao, x.faturado, x.faturado_em);
      const l = { falta: num(x.falta), faturado: Math.min(num(x.faturado), num(x.falta)), pedidoEm: diaDaNota(x.pedido_em), faturadoEm: diaDaNota(x.faturado_em), previsao: prev, atrasado: !!(prev && hoje && prev < hoje) };
      if (!m.has(cod)) m.set(cod, { falta: 0, faturado: 0, proxima: null, atrasado: false, linhas: [] });
      const c = m.get(cod);
      c.falta += l.falta; c.faturado += l.faturado; c.linhas.push(l);
      if (!c.proxima || (prev && prev < c.proxima)) c.proxima = prev;
      c.atrasado = c.linhas.some(z => z.atrasado);
    });
    m.forEach(c => c.linhas.sort((a, b) => String(a.previsao).localeCompare(String(b.previsao))));
    return m;
  }

  // Texto curto de uma linha do "a caminho": o que a vendedora lê (quantidade e datas, sem valor).
  function textoLinha(l, un) {
    const q = Number(l.falta).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + (un ? ' ' + un : '');
    if (l.atrasado) return q + ' a caminho · previsão era ' + br(l.previsao) + ' (atrasado)';
    if (l.faturado >= l.falta && l.faturadoEm) return q + ' faturados pelo fornecedor em ' + br(l.faturadoEm) + ' · chegam ~' + br(l.previsao);
    return q + ' comprados em ' + br(l.pedidoEm) + ' · chegam ~' + br(l.previsao);
  }
  const textoCaminho = (c, un) => (c && c.linhas.length ? c.linhas.map(l => textoLinha(l, un)).join(' · ') : '');

  // Itens do pedido a registrar, a partir de um fornecedor da sugestão (gestao.js pedidoPorFornecedor).
  const itensDaSugestao = f => ((f && f.itens) || []).filter(g => g.codigo && g.comprar > 0).map(g => ({
    codigo: String(g.codigo).replace(/\.\d+$/, ''), descricao: g.descricao, unidade: g.unidade || null, quantidade: g.comprar, custo_unit: g.custoUnit || null }));

  const API = { monta, porProduto, previsaoDe, textoLinha, textoCaminho, itensDaSugestao, DIAS_DEPOIS_DA_NOTA };
  raiz.CRMComprasPedidos = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);

(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, X = raiz.CRMComprasPedidos, R = raiz.CRMRegras;
  if (!CRM || !CRM.telas) return;
  const esc = CRM.esc;
  const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
  const qtd = v => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const pode = () => CRM.ehAdmin() || CRM.ehComprador();
  const st = () => CRM.store();
  const br = d => (d ? R.dataBR(String(d).slice(0, 10)) : '—');

  // ----------------------------------------------------------------- o "a caminho" para todos (Produtos, pedido de venda)
  let caminho = null, pedindo = null;
  function garanteCaminho() {
    if (caminho) return Promise.resolve(caminho);
    if (!pedindo) pedindo = (st() && st().aCaminho ? st().aCaminho() : Promise.resolve([]))
      .then(l => { caminho = X.porProduto(l, CRM.hoje()); return caminho; }).catch(() => { pedindo = null; return new Map(); });
    return pedindo;
  }
  CRM.aCaminho = {
    garante: garanteCaminho,
    de: cod => (caminho ? caminho.get(String(cod || '').replace(/\.\d+$/, '')) || null : null),
    texto: (cod, un) => X.textoCaminho(caminho && caminho.get(String(cod || '').replace(/\.\d+$/, '')), un),
    limpa: () => { caminho = null; pedindo = null; }
  };

  // ----------------------------------------------------------------- tela Pedidos ao fornecedor (admin e comprador)
  let dados = null, carregando = false, aberto = null;
  const f = { ver: 'abertos' };
  async function carrega() {
    if (carregando) return;
    carregando = true;
    try {
      const r = await st().compraPedidos();
      dados = Object.assign({}, r, { lista: X.monta(r.pedidos, r.itens, r.andamento, CRM.hoje()) });
    } catch (e) { dados = dados || { lista: [], fknSemPedido: 0 }; CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }
  const SIT = { pedido: ['pedido feito', 'etiqueta'], faturado: ['faturado pelo fornecedor', 'azul'], parcial: ['chegou em parte', 'ambar'], recebido: ['recebido', 'verde'], cancelado: ['cancelado', ''] };
  const VER = [['abertos', 'Em aberto'], ['atrasados', 'Atrasados'], ['recebidos', 'Recebidos'], ['todos', 'Todos']];
  function linhaPedido(p) {
    const s = SIT[p.situacaoAtual], abre = aberto === p.id;
    return '<tr class="pc-linha" data-acao="cp-abrir" data-id="' + p.id + '"><td>' + p.id + '</td>' +
      '<td><button type="button" class="link" data-acao="cp-abrir" data-id="' + p.id + '" aria-expanded="' + abre + '">' + esc(R.nomeDeItem(p.fornecedor_nome)) + '</button>' +
        '<small>' + p.itens.length + ' ' + (p.itens.length === 1 ? 'item' : 'itens') + ' · ' + qtd(p.unidades) + ' unidades' + (p.total ? ' · ' + esc(R.moeda(p.total)) : '') + '</small></td>' +
      '<td>' + esc(br(p.criado_em && R.diaLocal(p.criado_em))) + '</td>' +
      '<td>' + CRM.selo(s[0], s[1]) + (p.atrasado ? ' ' + CRM.selo('atrasado ' + p.diasAtraso + ' dia(s)', 'vermelho') : '') + (p.notas ? ' <small>NF ' + esc(p.notas) + '</small>' : '') + '</td>' +
      '<td class="num' + (p.atrasado ? ' neg' : '') + '">' + (p.aberto ? (p.atrasado ? 'era ' : '~') + esc(br(p.previsaoEf)) : p.situacaoAtual === 'recebido' ? 'chegou' : '—') + '</td></tr>' +
      (abre ? '<tr class="cp-detalhe"><td colspan="5">' + detalhe(p) + '</td></tr>' : '');
  }
  function detalhe(p) {
    const forn = (dados.fornecedores || []).find(x => p.fornecedor_cod && String(x.codigo) === String(p.fornecedor_cod));
    const tel = forn && forn.telefone ? R.linkWhatsApp(forn.telefone, 'Olá! Aqui é da ' + CRM.nomeInstalacao() + '. Sobre o nosso pedido de ' + br(R.diaLocal(p.criado_em)) +
      ': ainda faltam ' + p.itens.filter(i => i.falta > 0).map(i => qtd(i.falta) + ' ' + (i.unidade || '') + ' de ' + R.nomeDeItem(i.descricao || i.codigo)).join(', ') + '. Tem previsão de entrega?') : '';
    return '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th class="num">Pedido</th><th class="num">Faturado (nota)</th><th class="num">Entrou</th><th class="num">Falta chegar</th>' +
        '<th class="num">Custo un.</th></tr></thead><tbody>' +
      p.itens.map(i => '<tr><td>' + esc(R.nomeDeItem(i.descricao || i.codigo)) + ' <small>' + esc(i.codigo) + '</small></td><td class="num">' + qtd(i.quantidade) + ' ' + esc(i.unidade || '') +
        (num(i.cancelado) ? '<br><small>' + qtd(i.cancelado) + ' cancelado(s)</small>' : '') + '</td><td class="num">' + (i.faturado ? qtd(i.faturado) : '—') + '</td><td class="num">' + (i.recebido ? qtd(i.recebido) : '—') + '</td>' +
        '<td class="num"><strong' + (i.falta && p.atrasado ? ' class="neg"' : '') + '>' + qtd(i.falta) + '</strong></td><td class="num">' + (i.custo_unit != null ? esc(R.moeda(i.custo_unit)) : '—') + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<p class="dica">Registrado em ' + esc(br(R.diaLocal(p.criado_em))) + (p.criado_por ? ' por ' + esc(CRM.nomeUsuario(p.criado_por)) : '') + ' · previsão do pedido ' + esc(br(p.previsao)) +
        (p.ultNota ? ' · última nota do fornecedor em ' + esc(br(R.diaLocal(p.ultNota))) + ' (chega ~' + X.DIAS_DEPOIS_DA_NOTA + ' dias depois)' : '') + (p.obs ? ' · ' + esc(p.obs) : '') + '</p>' +
      (p.aberto ? '<p class="acoes"><button type="button" class="btn sec" data-acao="cp-previsao" data-id="' + p.id + '">Mudar a previsão</button> ' +
        (tel ? '<a class="btn sec" href="' + esc(tel) + '" target="_blank" rel="noopener noreferrer">📲 Cobrar o fornecedor pelo WhatsApp</a> ' : '') +
        '<button type="button" class="btn sec" data-acao="cp-chegou" data-id="' + p.id + '">Chegou tudo</button> ' +
        '<button type="button" class="btn sec" data-acao="cp-cancelar-resto" data-id="' + p.id + '">Cancelar o que falta</button> ' +
        (p.itens.every(i => !i.recebido) ? '<button type="button" class="mini" data-acao="cp-cancelar" data-id="' + p.id + '">cancelar o pedido</button>' : '') + '</p>' : '');
  }

  CRM.telas.pedcompra = {
    render() {
      if (!pode()) return '<div class="cartao"><p class="vazio">Esta tela é do administrador e do comprador.</p></div>';
      if (dados === null) { setTimeout(carrega, 0); return '<div class="cabecalho"><div><h1>Pedidos ao fornecedor</h1></div></div><div class="cartao"><p class="vazio">Carregando…</p></div>'; }
      const l = dados.lista, ab = l.filter(p => p.aberto), atr = ab.filter(p => p.atrasado), fat = ab.filter(p => p.situacaoAtual === 'faturado');
      const vis = l.filter(p => f.ver === 'todos' || (f.ver === 'abertos' ? p.aberto : f.ver === 'atrasados' ? p.atrasado : p.situacaoAtual === 'recebido'));
      const kpi = (t, v, s, cls) => '<div class="kpi ' + (cls || '') + '"><span>' + esc(t) + '</span><strong>' + v + '</strong>' + (s ? '<small>' + esc(s) + '</small>' : '') + '</div>';
      return '<div class="cabecalho"><div><h1>Pedidos ao fornecedor</h1><p class="sub">o que já foi comprado e ainda não entrou: a nota do fornecedor (Sefaz) e a entrada dão a baixa sozinhas</p></div>' +
        '<div class="acoes"><button type="button" class="btn sec" data-acao="cp-ir-compras">Registrar pela sugestão (Compras)</button> <button type="button" class="btn sec" data-acao="cp-recarregar"' + (carregando ? ' disabled' : '') + '>Atualizar</button></div></div>' +
        '<section class="kpis">' + kpi('Pedidos em aberto', String(ab.length), qtd(ab.reduce((s, p) => s + p.itens.reduce((t, i) => t + i.falta, 0), 0)) + ' unidades a chegar') +
          kpi('Atrasados', String(atr.length), 'a previsão passou', atr.length ? 'alerta' : '') + kpi('Faturados, chegando', String(fat.length), 'a nota do fornecedor já veio', 'verde') +
          kpi('Pendências só no FKN', String(dados.fknSemPedido || 0), 'produtos com pedido no FKN e sem pedido aqui (sem data)') + '</section>' +
        '<section class="cartao"><div class="chips">' + VER.map(v => '<button type="button" class="chip-filtro' + (f.ver === v[0] ? ' ativo' : '') + '" data-acao="cp-ver" data-id="' + v[0] + '" aria-pressed="' + (f.ver === v[0]) + '">' + esc(v[1]) +
            (v[0] === 'abertos' ? ' (' + ab.length + ')' : v[0] === 'atrasados' ? ' (' + atr.length + ')' : '') + '</button>').join('') + '</div>' +
          (vis.length ? '<div class="tabela-rolagem"><table class="tabela pc-tabela"><thead><tr><th>Nº</th><th>Fornecedor</th><th>Pedido em</th><th>Situação</th><th class="num">Chega</th></tr></thead><tbody>' +
            vis.map(linhaPedido).join('') + '</tbody></table></div>'
            : '<p class="vazio">' + (l.length ? 'Nenhum pedido aqui.' : 'Nenhum pedido registrado ainda. Em Compras → "Pedido por fornecedor", use "Registrar pedido" em cada fornecedor.') + '</p>') +
          '<p class="dica">Faturado = a nota do fornecedor chegou (pela Sefaz ou pelo XML); chega ~' + X.DIAS_DEPOIS_DA_NOTA + ' dias depois dela. Entrou = a entrada foi lançada (no CRM, ou no FKN depois da nota, pela listagem). ' +
            'As vendedoras veem a quantidade e a data, nunca o valor.</p></section>';
    }
  };

  // ----------------------------------------------------------------- registrar (chamado pela sugestão de Compras)
  function registrar(forn) {
    const itens = X.itensDaSugestao(forn);
    if (!itens.length) { CRM.toast('Nada para pedir deste fornecedor no prazo escolhido.', true); return; }
    const prazo = forn.prazo != null ? Number(forn.prazo) : 7, prev = R.somaDias(CRM.hoje(), prazo);
    CRM.abrirForm({
      titulo: 'Registrar pedido: ' + R.nomeDeItem(forn.nome), largura: 'extra', salvarTexto: 'Registrar pedido ao fornecedor',
      intro: 'Confira as quantidades (na unidade do estoque). As vendedoras passam a ver "a caminho" com a data. Quando a nota do fornecedor chegar, o pedido vira "faturado"; quando a entrada for lançada, sai sozinho.',
      htmlAntes: '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th class="num">Saldo</th><th class="num">Já pedido</th><th class="num">Comprar</th><th class="num">Custo un.</th></tr></thead><tbody>' +
        forn.itens.filter(g => g.codigo && g.comprar > 0).map((g, k) => '<tr><td>' + esc(R.nomeDeItem(g.descricao)) + ' <small>' + esc(g.codigo) + ' · ' + esc(g.unidade || '') + '</small></td>' +
          '<td class="num' + (g.saldo < 0 ? ' neg' : '') + '">' + qtd(g.saldo) + '</td><td class="num">' + (g.pedido ? qtd(g.pedido) : '—') + '</td>' +
          '<td class="num"><input type="number" min="0" step="any" class="cp-qtd" data-cp-qtd="' + k + '" value="' + esc(g.comprar) + '" aria-label="Quantidade de ' + esc(R.nomeDeItem(g.descricao)) + '"></td>' +
          '<td class="num">' + (g.custoUnit ? esc(R.moeda(g.custoUnit)) : '—') + '</td></tr>').join('') + '</tbody></table></div>',
      campos: [{ nome: 'previsao', rotulo: 'Chega em (previsão)', tipo: 'date', obrigatorio: true, ajuda: 'hoje + ' + prazo + ' dias do fornecedor' + (forn.prazoEstimado ? ' (estimado: sem cadastro)' : '') + '; mude se ele prometer outra data' },
        { nome: 'obs', rotulo: 'Observação', largo: true, dica: 'ex.: combinado por telefone com o representante' }],
      valores: { previsao: prev, obs: '' },
      aoSalvar: async v => {
        const form = document.querySelector('#dlgForm');
        const qs = form ? [...form.querySelectorAll('[data-cp-qtd]')].map(e => Number(e.value) || 0) : [];
        const its = itens.map((it, k) => Object.assign({}, it, { quantidade: qs.length ? qs[k] : it.quantidade })).filter(it => it.quantidade > 0);
        if (!its.length) throw new Error('ponha a quantidade de pelo menos um item');
        const r = await st().compraPedidoGravar({ fornecedor_cod: forn.cod || null, fornecedor_nome: forn.nome, previsao: v.previsao, obs: v.obs || null, itens: its });
        CRM.toast('Pedido nº ' + r.id + ' registrado (' + its.length + ' itens · chega ~' + R.dataBR(v.previsao) + '). As vendedoras já veem "a caminho".');
        dados = null; CRM.aCaminho.limpa();
        if (CRM.comprasRecarregar) CRM.comprasRecarregar();
      }
    });
  }
  CRM.comprasPedidos = { registrar, recarregar: () => { dados = null; } };

  async function acao(id, a, previsao) {
    await st().compraPedidoAcao(Number(id), a, previsao || null);
    dados = null; CRM.aCaminho.limpa(); if (CRM.comprasRecarregar) CRM.comprasRecarregar();
    CRM.render();
  }
  Object.assign(CRM.acoes, {
    'cp-abrir': id => { aberto = aberto === Number(id) ? null : Number(id); CRM.render(); },
    'cp-ver': id => { f.ver = id; CRM.render(); },
    'cp-recarregar': () => { dados = null; CRM.aCaminho.limpa(); carrega(); },
    'cp-ir-compras': () => { CRM.estado.aba = 'compras'; CRM.render(); setTimeout(() => CRM.acoes['compras-ir-pedido'] && CRM.acoes['compras-ir-pedido'](), 300); },
    'cp-previsao': id => {
      const p = dados && dados.lista.find(x => x.id === Number(id)); if (!p) return;
      CRM.abrirForm({ titulo: 'Nova previsão: pedido ' + id, campos: [{ nome: 'previsao', rotulo: 'Chega em', tipo: 'date', obrigatorio: true }], valores: { previsao: p.previsaoEf || p.previsao },
        aoSalvar: async v => { await acao(id, 'previsao', v.previsao); CRM.toast('Previsão trocada: as vendedoras já veem a data nova.'); } });
    },
    'cp-chegou': async id => { if (confirm('Marcar que tudo deste pedido chegou? Ele sai do "a caminho".')) { try { await acao(id, 'chegou'); CRM.toast('Pedido fechado.'); } catch (e) { CRM.falhou(e); } } },
    'cp-cancelar-resto': async id => { if (confirm('Cancelar o que ainda não chegou deste pedido? O que já entrou fica.')) { try { await acao(id, 'cancelar_resto'); CRM.toast('O que faltava foi cancelado.'); } catch (e) { CRM.falhou(e); } } },
    'cp-cancelar': async id => { if (confirm('Cancelar o pedido todo?')) { try { await acao(id, 'cancelar'); CRM.toast('Pedido cancelado.'); } catch (e) { CRM.falhou(e); } } }
  });
})(typeof window !== 'undefined' ? window : globalThis);
