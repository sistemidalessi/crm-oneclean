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
      '<td>' + CRM.selo(s[0], s[1]) + seloAprovacao(p) + (p.atrasado ? ' ' + CRM.selo('atrasado ' + p.diasAtraso + ' dia(s)', 'vermelho') : '') + (p.notas ? ' <small>NF ' + esc(p.notas) + '</small>' : '') + '</td>' +
      '<td class="num' + (p.atrasado ? ' neg' : '') + '">' + (p.aberto ? (p.atrasado ? 'era ' : '~') + esc(br(p.previsaoEf)) : p.situacaoAtual === 'recebido' ? 'chegou' : '—') + '</td></tr>' +
      (abre ? '<tr class="cp-detalhe"><td colspan="5">' + detalhe(p) + '</td></tr>' : '');
  }
  // aprovação do pedido ao fornecedor (25/10/2026, CEO Grupo; pronta e DESLIGADA até o Anderson ligar no banco:
  // crm_sistema 'compras_aprovacao'): o pedido a partir do valor nasce "aguardando" e só o administrador decide
  const seloAprovacao = p => p.aprovacao === 'aguardando' ? ' ' + CRM.selo('aguardando aprovação', 'ambar')
    : p.aprovacao === 'recusado' ? ' ' + CRM.selo('recusado', 'vermelho') : p.aprovacao === 'aprovado' ? ' ' + CRM.selo('aprovado', 'verde') : '';
  function blocoAprovacao(p) {
    if (!p.aprovacao) return '';
    if (p.aprovacao === 'aguardando') return '<p class="aviso-notas"><strong>Aguardando a aprovação do administrador</strong> (' + esc(R.moeda(p.aprovacao_total)) + '): ainda não mande ao fornecedor. ' +
      (CRM.ehAdmin() ? '</p><p class="acoes"><button type="button" class="btn" data-acao="cp-aprovar" data-id="' + p.id + '">Aprovar o pedido</button> <button type="button" class="btn sec" data-acao="cp-recusar" data-id="' + p.id + '">Recusar</button></p>'
        : 'O Anderson aprova pelo CRM ou pelo WhatsApp.</p>');
    return '<p class="dica">' + (p.aprovacao === 'aprovado' ? 'Aprovado' : 'Recusado') + (p.aprovado_por ? ' por ' + esc(p.aprovado_por) : '') + (p.aprovado_em ? ' em ' + esc(R.dataBR(R.diaLocal(p.aprovado_em))) : '') +
      (p.aprovacao_motivo ? ': ' + esc(p.aprovacao_motivo) : '') + '.</p>';
  }
  function detalhe(p) {
    const forn = (dados.fornecedores || []).find(x => p.fornecedor_cod && String(x.codigo) === String(p.fornecedor_cod));
    const tel = forn && forn.telefone ? R.linkWhatsApp(forn.telefone, 'Olá! Aqui é da ' + CRM.nomeInstalacao() + '. Sobre o nosso pedido de ' + br(R.diaLocal(p.criado_em)) +
      ': ainda faltam ' + p.itens.filter(i => i.falta > 0).map(i => qtd(i.falta) + ' ' + (i.unidade || '') + ' de ' + R.nomeDeItem(i.descricao || i.codigo)).join(', ') + '. Tem previsão de entrega?') : '';
    return blocoAprovacao(p) + '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th class="num">Pedido</th><th class="num">Faturado (nota)</th><th class="num">Entrou</th><th class="num">Falta chegar</th>' +
        '<th class="num">Custo un.</th></tr></thead><tbody>' +
      p.itens.map(i => '<tr' + (p.aberto ? ' class="clicavel" data-acao="cp-item" data-id="' + p.id + ':' + i.ordem + '" title="Mudar a quantidade ou o custo"' : '') + '><td>' + esc(R.nomeDeItem(i.descricao || i.codigo)) + ' <small>' + esc(i.codigo) + '</small>' + (p.aberto ? ' <span class="mini">✎</span>' : '') + '</td><td class="num">' + qtd(i.quantidade) + ' ' + esc(i.unidade || '') +
        (num(i.cancelado) ? '<br><small>' + qtd(i.cancelado) + ' cancelado(s)</small>' : '') + '</td><td class="num">' + (i.faturado ? qtd(i.faturado) : '—') + '</td><td class="num">' + (i.recebido ? qtd(i.recebido) : '—') + '</td>' +
        '<td class="num"><strong' + (i.falta && p.atrasado ? ' class="neg"' : '') + '>' + qtd(i.falta) + '</strong></td><td class="num">' + (i.custo_unit != null ? esc(R.moeda(i.custo_unit)) : '—') + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<p class="dica">Registrado em ' + esc(br(R.diaLocal(p.criado_em))) + (p.criado_por ? ' por ' + esc(CRM.nomeUsuario(p.criado_por)) : '') + ' · previsão do pedido ' + esc(br(p.previsao)) +
        (p.ultNota ? ' · última nota do fornecedor em ' + esc(br(R.diaLocal(p.ultNota))) + ' (chega ~' + X.DIAS_DEPOIS_DA_NOTA + ' dias depois)' : '') + (p.obs ? ' · ' + esc(p.obs) : '') + '</p>' +
      (p.aberto ? '<p class="acoes"><button type="button" class="btn" data-acao="cp-editar" data-id="' + p.id + '">✎ Editar o pedido</button> ' +
        '<button type="button" class="btn sec" data-acao="cp-previsao" data-id="' + p.id + '">Mudar a previsão</button> ' +
        (tel ? '<a class="btn sec" href="' + esc(tel) + '" target="_blank" rel="noopener noreferrer">📲 Cobrar o fornecedor pelo WhatsApp</a> ' : '') +
        '<button type="button" class="btn sec" data-acao="cp-chegou" data-id="' + p.id + '">Chegou tudo</button> ' +
        '<button type="button" class="btn sec" data-acao="cp-cancelar-resto" data-id="' + p.id + '">Cancelar o que falta</button> ' +
        (p.itens.every(i => !i.recebido) ? '<button type="button" class="mini" data-acao="cp-cancelar" data-id="' + p.id + '">cancelar o pedido</button>' : '') + '</p>' : '') +
      (p.situacaoAtual !== 'cancelado' ? '<p class="acoes"><button type="button" class="btn" data-acao="cp-pdf" data-id="' + p.id + '">📄 PDF da ordem de compra nº ' + p.id + ' (para o fornecedor)</button></p>' : '');
  }
  // o pedido de compra em PDF para mandar ao fornecedor (04/11/2026, pedido do Wellington: "baixe em PDF todos os dados da
  // empresa, como o endereço, a marca da OneClean, para encaminhar ao fornecedor"), no modelo do pedido de compra do FKN
  function htmlPedidoCompra(p) {
    const cfg = (CRM.estado && CRM.estado.cfg) || {}, em = (cfg.fiscal && cfg.fiscal.emitente) || {}, en = em.endereco || {};
    const forn = (dados.fornecedores || []).find(x => p.fornecedor_cod && String(x.codigo) === String(p.fornecedor_cod)) || {};
    const linha = (r, v) => v ? '<tr><th>' + esc(r) + '</th><td>' + esc(v) + '</td></tr>' : '';
    const its = p.itens.filter(i => Math.max(num(i.quantidade) - num(i.cancelado), 0) > 0);
    const total = its.reduce((t, i) => t + Math.max(num(i.quantidade) - num(i.cancelado), 0) * num(i.custo_unit), 0);
    const endEm = [[en.logradouro, en.numero].filter(Boolean).join(', '), en.bairro, [en.municipio, en.uf].filter(Boolean).join(' - '), en.cep ? 'CEP ' + R.mascaraCep(en.cep) : ''].filter(Boolean).join(' · ');
    return '<div class="pcdoc"><header><img src="' + esc(CRM.logo()) + '" alt=""><div><strong>' + esc(em.razao || CRM.nomeInstalacao()) + '</strong>' +
        '<span>' + esc(endEm) + '</span><span>' + [en.fone ? 'Tel.: ' + R.mascaraTel(en.fone) : '', em.cnpj ? 'CNPJ: ' + R.formataCNPJ(em.cnpj) : '', em.ie ? 'IE: ' + R.formataIE(em.ie) : ''].filter(Boolean).map(esc).join(' · ') + '</span></div></header>' +
      '<h1>Ordem de compra nº ' + p.id + '</h1>' +
      '<table class="pc-dados"><tbody>' + linha('Data', R.dataBR(R.diaLocal(p.criado_em))) +
        linha('Fornecedor', [p.fornecedor_cod, forn.nome || R.nomeDeItem(p.fornecedor_nome)].filter(Boolean).join(' — ')) +
        linha('CNPJ', forn.cnpj ? R.formataCNPJ(forn.cnpj) : '') + linha('Contato', [forn.contato, forn.telefone ? R.mascaraTel(forn.telefone) : '', forn.email].filter(Boolean).join(' · ')) +
        linha('Cond. de pagamento', forn.pagamento || '') + linha('Entrega prevista', p.previsao ? R.dataBR(p.previsao) : '') +
        linha('Comprador', p.criado_por ? CRM.nomeUsuario(p.criado_por) : '') + linha('Observação', p.obs || '') + '</tbody></table>' +
      '<table class="pc-itens"><thead><tr><th>It</th><th>Código</th><th>Produto</th><th>Un</th><th class="num">Qtde</th><th class="num">Preço unit.</th><th class="num">Total</th></tr></thead><tbody>' +
        its.map((i, k) => { const q = Math.max(num(i.quantidade) - num(i.cancelado), 0);
          return '<tr><td>' + String(k + 1).padStart(2, '0') + '</td><td>' + esc(i.codigo) + '</td><td>' + esc(R.nomeDeItem(i.descricao || i.codigo)) + '</td><td>' + esc(i.unidade || '') + '</td>' +
            '<td class="num">' + qtd(q) + '</td><td class="num">' + (i.custo_unit != null ? esc(R.moeda(i.custo_unit)) : '—') + '</td><td class="num">' + (i.custo_unit != null ? esc(R.moeda(q * num(i.custo_unit))) : '—') + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td colspan="6">Total dos produtos (' + its.length + ' ' + (its.length === 1 ? 'item' : 'itens') + ')</td><td class="num"><strong>' + esc(R.moeda(total)) + '</strong></td></tr></tfoot></table>' +
      '<p class="pc-nota">Por favor, confirme o pedido, os preços e a data de entrega. <strong>Informe a ordem de compra nº ' + p.id + ' na nota fiscal (campo do pedido do cliente) e no boleto.</strong></p>' +
      '<footer><div class="pc-ass">' + esc(em.razao || CRM.nomeInstalacao()) + '</div><small>Emitido em ' + esc(R.dataBR(CRM.hoje())) + (p.criado_por ? ' por ' + esc(CRM.nomeUsuario(p.criado_por)) : '') + '</small></footer></div>';
  }

  CRM.telas.pedcompra = {
    render() {
      if (!pode()) return '<div class="cartao"><p class="vazio">Esta tela é do administrador e do comprador.</p></div>';
      if (dados === null) { setTimeout(carrega, 0); return '<div class="cabecalho"><div><h1>Pedidos ao fornecedor</h1></div></div><div class="cartao"><p class="vazio">Carregando…</p></div>'; }
      const l = dados.lista, ab = l.filter(p => p.aberto), atr = ab.filter(p => p.atrasado), fat = ab.filter(p => p.situacaoAtual === 'faturado');
      // pesquisa e período (28/10/2026): nº, fornecedor, produto (código ou nome) e observação; período pela data do pedido
      const vis = CRM.Lista.filtra('cp-lista', l.filter(p => f.ver === 'todos' || (f.ver === 'abertos' ? p.aberto : f.ver === 'atrasados' ? p.atrasado : p.situacaoAtual === 'recebido')),
        { texto: p => [p.id, p.fornecedor_nome, p.obs, (p.itens || []).map(i => (i.codigo || '') + ' ' + (i.descricao || '')).join(' ')], data: p => p.criado_em || p.pedido_em });
      CRM.Lista.planilha('cp-lista', 'pedidos-ao-fornecedor', ['Nº', 'Fornecedor', 'Pedido em', 'Situação', 'Previsão', 'Itens', 'Unidades', 'Total', 'Observação'],
        () => vis.map(p => [p.id, p.fornecedor_nome, R.dataBR(R.diaLocal(p.criado_em || p.pedido_em)), (SIT[p.situacaoAtual] || [p.situacaoAtual])[0], p.previsao ? R.dataBR(p.previsao) : '', (p.itens || []).length, p.unidades, p.total || '', p.obs || '']));
      const kpi = (t, v, s, cls) => '<div class="kpi ' + (cls || '') + '"><span>' + esc(t) + '</span><strong>' + v + '</strong>' + (s ? '<small>' + esc(s) + '</small>' : '') + '</div>';
      return '<div class="cabecalho"><div><h1>Pedidos ao fornecedor</h1><p class="sub">o que já foi comprado e ainda não entrou: a nota do fornecedor (Sefaz) e a entrada dão a baixa sozinhas</p></div>' +
        '<div class="acoes"><button type="button" class="btn" data-acao="cp-novo">+ Novo pedido</button> <button type="button" class="btn sec" data-acao="cp-ir-compras">Registrar pela sugestão (Compras)</button> <button type="button" class="btn sec" data-acao="cp-recarregar"' + (carregando ? ' disabled' : '') + '>Atualizar</button></div></div>' +
        '<section class="kpis">' + kpi('Pedidos em aberto', String(ab.length), qtd(ab.reduce((s, p) => s + p.itens.reduce((t, i) => t + i.falta, 0), 0)) + ' unidades a chegar') +
          kpi('Atrasados', String(atr.length), 'a previsão passou', atr.length ? 'alerta' : '') + kpi('Faturados, chegando', String(fat.length), 'a nota do fornecedor já veio', 'verde') +
          kpi('Pendências só no FKN', String(dados.fknSemPedido || 0), 'produtos com pedido no FKN e sem pedido aqui (sem data)') + '</section>' +
        '<section class="cartao"><div class="chips">' + VER.map(v => '<button type="button" class="chip-filtro' + (f.ver === v[0] ? ' ativo' : '') + '" data-acao="cp-ver" data-id="' + v[0] + '" aria-pressed="' + (f.ver === v[0]) + '">' + esc(v[1]) +
            (v[0] === 'abertos' ? ' (' + ab.length + ')' : v[0] === 'atrasados' ? ' (' + atr.length + ')' : '') + '</button>').join('') + '</div>' +
          CRM.Lista.barra('cp-lista', { periodo: true, rotuloPeriodo: 'Pedido de', placeholder: 'Nº, fornecedor, produto ou observação' }) +
          (vis.length ? '<div class="tabela-rolagem"><table class="tabela pc-tabela"><thead><tr><th>Nº</th><th>Fornecedor</th><th>Pedido em</th><th>Situação</th><th class="num">Chega</th></tr></thead><tbody>' +
            vis.map(linhaPedido).join('') + '</tbody></table></div>'
            : '<p class="vazio">' + (l.length ? 'Nenhum pedido aqui.' : 'Nenhum pedido registrado ainda. Use "+ Novo pedido" (do zero) ou, em Compras → "Pedido por fornecedor", "Registrar pedido" em cada fornecedor.') + '</p>') +
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
        if (r.aprovacao === 'aguardando') CRM.toast('Pedido nº ' + r.id + ' registrado e AGUARDANDO APROVAÇÃO (' + R.moeda(r.aprovacao_total) + '): ainda não mande ao fornecedor.');
        else CRM.toast('Pedido nº ' + r.id + ' registrado (' + its.length + ' itens · chega ~' + R.dataBR(v.previsao) + '). As vendedoras já veem "a caminho".');
        dados = null; CRM.aCaminho.limpa();
        if (CRM.comprasRecarregar) CRM.comprasRecarregar();
      }
    });
  }
  // ----------------------------------------------------------------- pedido do zero (23/10/2026, pedido do Anderson: "quero começar
  // um do zero, não só em cima da sugestão"): fornecedor do cadastro ou das listagens, produtos pelo código ou pela descrição.
  async function novoPedido() {
    let est = [], forns = [];
    try { [est, forns] = await Promise.all([st().estoque ? st().estoque() : [], st().fornecedores ? st().fornecedores().catch(() => []) : []]); }
    catch (e) { CRM.falhou(e); return; }
    const prods = new Map();
    (est || []).forEach(e => { const c = String(e.codigo || '').replace(/\.\d+$/, ''); if (c && !prods.has(c) && e.situacao !== 'INATIVO') prods.set(c, e); });
    const fmap = new Map();   // nome → { cod, nome, prazo }
    (forns || []).filter(x => x.ativo !== false).forEach(x => fmap.set(String(x.nome).trim().toUpperCase(), { cod: x.codigo || null, nome: x.nome, prazo: x.prazo_dias }));
    (est || []).forEach(e => { const n = String(e.fornecedor || '').trim(); if (n && !fmap.has(n.toUpperCase())) fmap.set(n.toUpperCase(), { cod: e.fornecedor_cod || null, nome: n, prazo: null }); });
    const lf = [...fmap.values()].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    const lp = [...prods.values()].sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
    const linha = k => '<tr data-cp-linha="' + k + '"><td><input list="cpProdLista" class="cp-cod" style="width:100%;min-width:260px" data-cp-cod="' + k + '" placeholder="código ou descrição" aria-label="Produto ' + (k + 1) + '"><small data-cp-desc="' + k + '"></small></td>' +
      '<td class="num"><input type="number" min="0" step="any" class="cp-qtd" data-cp-q="' + k + '" aria-label="Quantidade ' + (k + 1) + '"></td>' +
      '<td class="num"><input type="number" min="0" step="any" class="cp-qtd" data-cp-c="' + k + '" aria-label="Custo ' + (k + 1) + '"></td></tr>';
    let n = 5;
    const acha = v => {
      const t = String(v || '').trim(); if (!t) return null;
      const c = t.split(' ')[0].replace(/\.\d+$/, '');
      if (prods.has(c)) return prods.get(c);
      // 04/11/2026 (Wellington): "10610" é o 010610 (o relatório do FKN mostra o código sem o zero da frente)
      if (/^\d{1,5}$/.test(c) && prods.has(c.padStart(6, '0'))) return prods.get(c.padStart(6, '0'));
      const u = t.toUpperCase(); return lp.find(e => String(e.descricao).toUpperCase() === u) || null;
    };
    CRM.abrirForm({
      titulo: 'Novo pedido ao fornecedor', largura: 'extra', salvarTexto: 'Registrar pedido ao fornecedor', semFoco: true,
      intro: 'Pedido começado do zero (sem a sugestão). Escolha o fornecedor e digite o código ou parte da descrição de cada produto; a quantidade é na unidade do estoque. As vendedoras passam a ver "a caminho" com a data.',
      htmlAntes: '<datalist id="cpFornLista">' + lf.map(x => '<option value="' + esc(x.nome) + '">').join('') + '</datalist>' +
        '<datalist id="cpProdLista">' + lp.map(e => '<option value="' + esc(String(e.codigo).replace(/\.\d+$/, '')) + '">' + esc(e.descricao) + '</option>').join('') + '</datalist>' +
        '<div class="campos"><label class="campo largo"><span>Fornecedor</span><input id="cpForn" list="cpFornLista" placeholder="nome do fornecedor" autocomplete="off"><small id="cpFornInfo"></small></label></div>' +
        '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th class="num">Quantidade</th><th class="num">Custo un. (opcional)</th></tr></thead><tbody id="cpLinhas">' +
        [0, 1, 2, 3, 4].map(linha).join('') + '</tbody></table></div><p><button type="button" class="btn sec" id="cpMais">+ mais linhas</button></p>',
      campos: [{ nome: 'previsao', rotulo: 'Chega em (previsão)', tipo: 'date', obrigatorio: true, ajuda: 'o prazo do fornecedor no cadastro, quando houver; mude se ele prometer outra data' },
        { nome: 'obs', rotulo: 'Observação', largo: true, dica: 'ex.: combinado por telefone com o representante' }],
      valores: { previsao: R.somaDias(CRM.hoje(), 7), obs: '' },
      extras: form => {
        const fi = form.querySelector('#cpForn'), info = form.querySelector('#cpFornInfo');
        fi.addEventListener('change', () => {
          const x = fmap.get(fi.value.trim().toUpperCase());
          if (x && x.prazo != null && form.elements.previsao) form.elements.previsao.value = R.somaDias(CRM.hoje(), Number(x.prazo));
          info.textContent = x ? (x.prazo != null ? 'prazo de ' + x.prazo + ' dias no cadastro' : 'sem prazo no cadastro (7 dias)') : (fi.value.trim() ? 'fornecedor novo: fica só com o nome' : '');
        });
        form.addEventListener('change', ev => {
          const k = ev.target.dataset && ev.target.dataset.cpCod; if (k == null) return;
          const e = acha(ev.target.value), d = form.querySelector('[data-cp-desc="' + k + '"]'), c = form.querySelector('[data-cp-c="' + k + '"]');
          if (e) { ev.target.value = String(e.codigo).replace(/\.\d+$/, ''); d.textContent = R.nomeDeItem(e.descricao) + ' · ' + (e.unidade || '') + (e.estoque_atual != null ? ' · saldo ' + qtd(e.estoque_atual) : '');
            // custo: o último preço de compra do produto (o do fornecedor, sem o índice); sem ele, o custo médio (04/11/2026, Wellington)
            const cu = Number(e.custo_compra) > 0 ? Number(e.custo_compra) : Number(e.custo_unit) > 0 ? Number(e.custo_unit) : 0;
            if (c && !c.value && cu > 0) c.value = Math.round(cu * 10000) / 10000;
            if (cu > 0) d.textContent += ' · último custo R$ ' + R.moeda(cu).replace(/^R\$\s*/, ''); }
          else d.textContent = ev.target.value.trim() ? 'produto não encontrado no cadastro' : '';
        });
        form.querySelector('#cpMais').addEventListener('click', () => { const tb = form.querySelector('#cpLinhas'); for (let i = 0; i < 5; i++) tb.insertAdjacentHTML('beforeend', linha(n++)); });
        setTimeout(() => fi.focus(), 0);
      },
      aoSalvar: async (v, form) => {
        const nome = form.querySelector('#cpForn').value.trim();
        if (!nome) throw new Error('diga o fornecedor');
        const x = fmap.get(nome.toUpperCase());
        const its = [], ruins = [];
        [...form.querySelectorAll('[data-cp-cod]')].forEach(el => {
          const k = el.dataset.cpCod, q = Number(form.querySelector('[data-cp-q="' + k + '"]').value) || 0, cu = form.querySelector('[data-cp-c="' + k + '"]').value;
          if (!el.value.trim() && !q) return;
          const e = acha(el.value);
          if (!e) { ruins.push(el.value.trim() || 'linha ' + (Number(k) + 1)); return; }
          if (q <= 0) { ruins.push(String(e.codigo) + ' sem quantidade'); return; }
          its.push({ codigo: String(e.codigo).replace(/\.\d+$/, ''), descricao: e.descricao, unidade: e.unidade || null, quantidade: q, custo_unit: cu === '' ? null : Number(cu) });
        });
        if (ruins.length) throw new Error('confira: ' + ruins.join(', '));
        if (!its.length) throw new Error('ponha pelo menos um produto com quantidade');
        const r = await st().compraPedidoGravar({ fornecedor_cod: x ? x.cod : null, fornecedor_nome: x ? x.nome : nome, previsao: v.previsao, obs: v.obs || null, itens: its });
        if (r.aprovacao === 'aguardando') CRM.toast('Pedido nº ' + r.id + ' registrado e AGUARDANDO APROVAÇÃO (' + R.moeda(r.aprovacao_total) + '): ainda não mande ao fornecedor.');
        else CRM.toast('Pedido nº ' + r.id + ' registrado (' + its.length + ' itens · chega ~' + R.dataBR(v.previsao) + '). As vendedoras já veem "a caminho".');
        dados = null; CRM.aCaminho.limpa();
        if (CRM.comprasRecarregar) CRM.comprasRecarregar();
        CRM.render();
      }
    });
  }
  // ----------------------------------------------------------------- editar o pedido lançado (06/11/2026, áudio do Wellington:
  // "quando eu lançar um pedido e precisar alterar, tenho que conseguir abrir ele e editar, sem que ele seja cancelado").
  // Tudo de uma vez: quantidade e custo de cada item (0 tira), produtos novos e a previsão; grava tudo ou nada
  // (crm_compra_pedido_editar) e a mudança fica anotada na observação do pedido.
  async function editarPedido(id) {
    const p = dados && dados.lista.find(x => x.id === Number(id)); if (!p) return;
    let est = [];
    try { est = st().estoque ? await st().estoque() : []; } catch (e) { CRM.falhou(e); return; }
    const prods = new Map();
    (est || []).forEach(e => { const c = String(e.codigo || '').replace(/\.\d+$/, ''); if (c && !prods.has(c) && e.situacao !== 'INATIVO') prods.set(c, e); });
    const lp = [...prods.values()].sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
    const acha = v => {
      const t = String(v || '').trim(); if (!t) return null;
      const c = t.split(' ')[0].replace(/\.\d+$/, '');
      if (prods.has(c)) return prods.get(c);
      if (/^\d{1,5}$/.test(c) && prods.has(c.padStart(6, '0'))) return prods.get(c.padStart(6, '0'));
      const u = t.toUpperCase(); return lp.find(e => String(e.descricao).toUpperCase() === u) || null;
    };
    const its = p.itens.filter(i => Math.max(num(i.quantidade) - num(i.cancelado), 0) > 0 || num(i.recebido) > 0);
    const linhaNova = k => '<tr><td><input list="cpEdLista" style="width:100%;min-width:240px" data-ce-cod="' + k + '" placeholder="código ou descrição" aria-label="Produto novo ' + (k + 1) + '"><small data-ce-desc="' + k + '"></small></td>' +
      '<td class="num"><input type="number" min="0" step="any" class="cp-qtd" data-ce-q="' + k + '" aria-label="Quantidade do produto novo ' + (k + 1) + '"></td><td class="num">—</td>' +
      '<td class="num"><input type="number" min="0" step="any" class="cp-qtd" data-ce-c="' + k + '" aria-label="Custo do produto novo ' + (k + 1) + '"></td></tr>';
    let n = 3;
    CRM.abrirForm({
      titulo: 'Editar o pedido nº ' + p.id + ': ' + R.nomeDeItem(p.fornecedor_nome), largura: 'extra', salvarTexto: 'Salvar as mudanças', semFoco: true,
      intro: 'Mude a quantidade ou o custo de cada produto, inclua produtos novos e troque a previsão. Quantidade 0 tira o produto do pedido; não dá para pôr menos do que já entrou. ' +
        'O pedido continua o mesmo (não é cancelado) e a mudança fica anotada nele.' + (p.aprovacao === 'aprovado' ? ' Se o total subir com produto novo, o pedido volta para a aprovação.' : ''),
      htmlAntes: '<datalist id="cpEdLista">' + lp.map(e => '<option value="' + esc(String(e.codigo).replace(/\.\d+$/, '')) + '">' + esc(e.descricao) + '</option>').join('') + '</datalist>' +
        '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th class="num">Quantidade</th><th class="num">Já entrou</th><th class="num">Custo un.</th></tr></thead><tbody id="cpEdLinhas">' +
        its.map(i => '<tr><td>' + esc(R.nomeDeItem(i.descricao || i.codigo)) + ' <small>' + esc(i.codigo) + ' · ' + esc(i.unidade || '') + '</small></td>' +
          '<td class="num"><input type="number" min="' + esc(num(i.recebido)) + '" step="any" class="cp-qtd" data-ce-ordem="' + i.ordem + '" value="' + esc(num(i.quantidade) - num(i.cancelado)) + '" aria-label="Quantidade de ' + esc(R.nomeDeItem(i.descricao || i.codigo)) + '"></td>' +
          '<td class="num">' + (i.recebido ? qtd(i.recebido) : '—') + '</td>' +
          '<td class="num"><input type="number" min="0" step="any" class="cp-qtd" data-ce-custo="' + i.ordem + '" value="' + (i.custo_unit != null ? esc(num(i.custo_unit)) : '') + '" aria-label="Custo de ' + esc(R.nomeDeItem(i.descricao || i.codigo)) + '"></td></tr>').join('') +
        [0, 1, 2].map(linhaNova).join('') + '</tbody></table></div><p><button type="button" class="btn sec" id="cpEdMais">+ incluir mais produtos</button></p>',
      campos: [{ nome: 'previsao', rotulo: 'Chega em (previsão)', tipo: 'date', obrigatorio: true },
        { nome: 'obs', rotulo: 'Motivo da mudança (opcional)', largo: true, dica: 'ex.: o fornecedor só tinha 6; incluí o detergente que faltou' }],
      valores: { previsao: p.previsao || p.previsaoEf, obs: '' },
      extras: form => {
        form.addEventListener('change', ev => {
          const k = ev.target.dataset && ev.target.dataset.ceCod; if (k == null) return;
          const e = acha(ev.target.value), d = form.querySelector('[data-ce-desc="' + k + '"]'), c = form.querySelector('[data-ce-c="' + k + '"]');
          if (e) { ev.target.value = String(e.codigo).replace(/\.\d+$/, ''); d.textContent = R.nomeDeItem(e.descricao) + ' · ' + (e.unidade || '') + (e.estoque_atual != null ? ' · saldo ' + qtd(e.estoque_atual) : '');
            const cu = Number(e.custo_compra) > 0 ? Number(e.custo_compra) : Number(e.custo_unit) > 0 ? Number(e.custo_unit) : 0;
            if (c && !c.value && cu > 0) c.value = Math.round(cu * 10000) / 10000; }
          else d.textContent = ev.target.value.trim() ? 'produto não encontrado no cadastro' : '';
        });
        // Enter num campo não grava o pedido pela metade (a lição da NF 23065): só pula para o próximo campo
        form.addEventListener('keydown', ev => {
          if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT') return;
          ev.preventDefault();
          const cs = [...form.querySelectorAll('input:not([type=hidden])')], k = cs.indexOf(ev.target);
          if (cs[k + 1]) cs[k + 1].focus();
        });
        form.querySelector('#cpEdMais').addEventListener('click', () => { const tb = form.querySelector('#cpEdLinhas'); for (let i = 0; i < 3; i++) tb.insertAdjacentHTML('beforeend', linhaNova(n++)); });
      },
      aoSalvar: async (v, form) => {
        const itens = [], ruins = [], tirados = [];
        its.forEach(i => {
          const q = form.querySelector('[data-ce-ordem="' + i.ordem + '"]').value, cu = form.querySelector('[data-ce-custo="' + i.ordem + '"]').value;
          const qn = q === '' ? 0 : Number(q);
          if (!(qn >= 0)) { ruins.push(i.codigo + ' com quantidade inválida'); return; }
          if (qn < num(i.recebido)) { ruins.push(i.codigo + ': já entraram ' + qtd(i.recebido)); return; }
          if (qn === 0) tirados.push(R.nomeDeItem(i.descricao || i.codigo));
          itens.push({ ordem: i.ordem, quantidade: qn + num(i.cancelado), custo_unit: cu === '' ? null : Number(cu) });
        });
        [...form.querySelectorAll('[data-ce-cod]')].forEach(el => {
          const k = el.dataset.ceCod, q = Number(form.querySelector('[data-ce-q="' + k + '"]').value) || 0, cu = form.querySelector('[data-ce-c="' + k + '"]').value;
          if (!el.value.trim() && !q) return;
          const e = acha(el.value);
          if (!e) { ruins.push(el.value.trim() || 'linha nova ' + (Number(k) + 1)); return; }
          if (q <= 0) { ruins.push(String(e.codigo) + ' sem quantidade'); return; }
          itens.push({ codigo: String(e.codigo).replace(/\.\d+$/, ''), descricao: e.descricao, unidade: e.unidade || null, quantidade: q, custo_unit: cu === '' ? null : Number(cu) });
        });
        if (ruins.length) throw new Error('confira: ' + ruins.join(', '));
        if (tirados.length && !confirm('Tirar do pedido: ' + tirados.join(', ') + '?')) return false;
        const r = await st().compraPedidoEditar(p.id, { previsao: v.previsao || null, obs_nova: v.obs || null, itens });
        dados = null; CRM.aCaminho.limpa(); if (CRM.comprasRecarregar) CRM.comprasRecarregar(); carrega();
        const nada = r && !r.novos && !r.mudados && (v.previsao || null) === (p.previsao || null) && !v.obs;
        CRM.toast(nada ? 'Nada mudou no pedido.' : r && r.aprovacao === 'aguardando' && p.aprovacao === 'aprovado' ? 'Pedido nº ' + p.id + ' atualizado e de volta à APROVAÇÃO (o total subiu): espere antes de mandar ao fornecedor.'
          : 'Pedido nº ' + p.id + ' atualizado: as vendedoras já veem as quantidades novas a caminho.');
      }
    });
  }
  CRM.comprasPedidos = { registrar, novoPedido, editarPedido, recarregar: () => { dados = null; } };

  async function aprovar(id, decisao, motivo) {
    const r = await st().compraPedidoAprovar(Number(id), decisao, motivo || null);
    if (r && r.ok === false) throw new Error(r.erro);
    dados = null; CRM.aCaminho.limpa(); carrega();
  }
  async function acao(id, a, previsao) {
    await st().compraPedidoAcao(Number(id), a, previsao || null);
    dados = null; CRM.aCaminho.limpa(); if (CRM.comprasRecarregar) CRM.comprasRecarregar();
    CRM.render();
  }
  Object.assign(CRM.acoes, {
    'cp-novo': () => novoPedido(),
    'cp-editar': id => editarPedido(id),
    // mudar a quantidade ou o custo de um item (04/11/2026, pedido do Wellington: sem cancelar o pedido)
    'cp-item': chave => {
      const [id, ordem] = String(chave).split(':').map(Number);
      const p = dados && dados.lista.find(x => x.id === id), i = p && p.itens.find(x => x.ordem === ordem);
      if (!i) return;
      CRM.abrirForm({ titulo: 'Item do pedido ' + id + ': ' + R.nomeDeItem(i.descricao || i.codigo),
        intro: 'Pedido ' + qtd(i.quantidade) + ' ' + (i.unidade || '') + (i.recebido ? ' · já entraram ' + qtd(i.recebido) + ' (não dá para pôr menos que isso)' : '') + '.\nQuantidade 0 tira o item do pedido. A mudança fica anotada no pedido.',
        campos: [{ nome: 'quantidade', rotulo: 'Quantidade (' + (i.unidade || 'unidade do estoque') + ')', tipo: 'numero', passo: '0.001', obrigatorio: true },
          { nome: 'custo', rotulo: 'Custo unitário (R$)', tipo: 'numero', passo: '0.0001', vazioNulo: true }],
        valores: { quantidade: num(i.quantidade), custo: i.custo_unit != null ? num(i.custo_unit) : null }, salvarTexto: 'Salvar',
        aoSalvar: async v => {
          if (Number(v.quantidade) === 0 && !confirm('Tirar ' + R.nomeDeItem(i.descricao || i.codigo) + ' do pedido?')) return false;
          await st().compraPedidoItem(id, ordem, v.quantidade, v.custo == null ? null : v.custo);
          dados = null; CRM.aCaminho.limpa(); if (CRM.comprasRecarregar) CRM.comprasRecarregar(); carrega();
          CRM.toast(Number(v.quantidade) === 0 ? 'Item tirado do pedido.' : 'Item do pedido atualizado: as vendedoras já veem a quantidade nova a caminho.');
        } });
    },
    'cp-pdf': async id => {
      const p = dados && dados.lista.find(x => x.id === Number(id)); if (!p) return;
      try { await CRM.fichas.baixarPdfHtml(htmlPedidoCompra(p), 'Ordem de compra ' + p.id + ' - ' + R.nomeDeItem(p.fornecedor_nome)); } catch (e) { CRM.falhou(e); }
    },
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
    'cp-aprovar': async id => { if (confirm('Aprovar o pedido ' + id + ' ao fornecedor?')) { try { await aprovar(id, 'aprovar'); CRM.toast('Pedido aprovado: o comprador já pode mandar ao fornecedor.'); } catch (e) { CRM.falhou(e); } } },
    'cp-recusar': id => CRM.abrirForm({ titulo: 'Recusar o pedido ' + id, campos: [{ nome: 'motivo', rotulo: 'Motivo (o comprador vê)', largo: true }], valores: { motivo: '' },
      salvarTexto: 'Recusar o pedido', aoSalvar: async v => { await aprovar(id, 'recusar', v.motivo); CRM.toast('Pedido recusado (cancelado).'); } }),
    'cp-cancelar': async id => { if (confirm('Cancelar o pedido todo?')) { try { await acao(id, 'cancelar'); CRM.toast('Pedido cancelado.'); } catch (e) { CRM.falhou(e); } } }
  });
})(typeof window !== 'undefined' ? window : globalThis);
