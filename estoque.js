/* Estoque do CRM — Fase 2 da saída do FKN (16/10/2026, pedido do Anderson: "sim, pode começar a Fase 2").
   O CRM passa a ter o próprio estoque, em paralelo com o FKN: um livro de movimentos no banco (crm_estoque_mov:
   saldo inicial, saídas pelas notas de venda, estornos das canceladas, ajustes, inventário e, depois, as entradas de
   compra) e o saldo de cada produto (crm_estoque_saldo, mantido pelo gatilho do livro). A cada listagem do FKN que
   chega (vigia ou tela), o banco compara os dois saldos na hora em que a listagem foi gerada e guarda as diferenças
   com a explicação provável (crm_estoque_conferir). "Pronto quando: 15 dias seguidos sem diferença que não tenha
   explicação" (docs/plano-sair-do-fkn.md). Aqui: as regras puras (testes/estoque.test.js) e a aba Estoque. */
(function (raiz) {
  'use strict';
  const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
  const ehCaixa = cod => /\.\d+$/.test(String(cod || ''));
  // "atual" do FKN = físico (com o reservado para cliente); a listagem antiga só tinha o saldo (= atual − reservado)
  const atualFkn = e => (e.estoque_atual != null ? num(e.estoque_atual) : num(e.quantidade) + num(e.pend_cliente));
  const dia = iso => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : '');

  // Uma linha por produto: o saldo do CRM ao lado do "atual" do FKN (sem as caixas fechadas, que são o mesmo estoque).
  function junta(saldo, fkn) {
    const porCod = new Map();
    (saldo || []).forEach(s => porCod.set(s.codigo, { codigo: s.codigo, descricao: s.descricao, unidade: s.unidade, saldo: num(s.saldo), custo: s.custo_medio == null ? null : num(s.custo_medio),
      ultMov: s.ult_mov || null, fkn: null, minimo: null, fornecedor: null }));
    (fkn || []).filter(e => !ehCaixa(e.codigo)).forEach(e => {
      const l = porCod.get(e.codigo) || { codigo: e.codigo, descricao: e.descricao, unidade: e.unidade, saldo: null, custo: null, ultMov: null };
      Object.assign(l, { fkn: atualFkn(e), minimo: e.estoque_min == null ? null : num(e.estoque_min), fornecedor: e.fornecedor || null, descricao: l.descricao || e.descricao, linha: e.linha || null });
      porCod.set(e.codigo, l);
    });
    return [...porCod.values()].map(l => Object.assign(l, { dif: l.saldo == null || l.fkn == null ? null : Math.round((l.fkn - l.saldo) * 1000) / 1000 }));
  }

  // Valor do estoque do CRM a custo médio (saldo negativo não vale).
  const valor = linhas => Math.round((linhas || []).reduce((t, l) => t + Math.max(0, num(l.saldo)) * num(l.custo), 0) * 100) / 100;

  // Dias seguidos (do mais recente para trás) em que TODA listagem conferida fechou sem diferença sem explicação.
  // fotos: crm_estoque_fotos (com resumo). → { dias, desde, ultimoProblema }
  function sequencia(fotos) {
    const porDia = new Map();
    (fotos || []).filter(f => f.resumo).forEach(f => {
      const d = dia(f.gerado_em);
      porDia.set(d, (porDia.get(d) || 0) + num(f.resumo.sem_explicacao));
    });
    const dias = [...porDia.keys()].sort().reverse();
    let n = 0, desde = null;
    for (const d of dias) { if (porDia.get(d) > 0) return { dias: n, desde, ultimoProblema: d }; n++; desde = d; }
    return { dias: n, desde, ultimoProblema: null };
  }

  // Contagem colada (planilha ou bloco de notas): "código;quantidade", "código<TAB>quantidade" ou "código quantidade".
  // Quantidade aceita vírgula decimal ("12,5"). → { lote: [{codigo, contado}], erros: [linha] }
  function lerContagem(texto) {
    const lote = new Map(), erros = [];
    String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(l => {
      const m = /^([0-9A-Za-z.\-]+)\s*[;\t ,]\s*(-?[\d.]*\d(?:,\d+)?|-?\d+(?:\.\d+)?)\s*$/.exec(l);
      if (!m) { erros.push(l); return; }
      // "1.234,5" e "3.000" (milhar com ponto, como na planilha brasileira); "12.5" sem grupo de milhar = decimal
      const q = /,/.test(m[2]) || /^-?\d{1,3}(\.\d{3})+$/.test(m[2]) ? Number(m[2].replace(/\./g, '').replace(',', '.')) : Number(m[2]);
      if (!isFinite(q)) { erros.push(l); return; }
      lote.set(m[1], q);
    });
    return { lote: [...lote.entries()].map(([codigo, contado]) => ({ codigo, contado })), erros };
  }

  // ---------------------------------------------------------- entrada de compra pelo XML
  const r2 = v => Math.round(num(v) * 100) / 100;
  const tag = (x, t) => { const m = new RegExp('<' + t + '>([^<]*)</' + t + '>').exec(x || ''); return m ? m[1] : ''; };
  // Frete, seguro e outras despesas de cada item (<det nItem="n"><prod>…<vFrete>…): o leitor de notas não traz.
  function extrasDoXml(xml) {
    const out = new Map(), re = /<det\b[^>]*nItem="(\d+)"[^>]*>([\s\S]*?)<\/det>/g;
    let m;
    while ((m = re.exec(String(xml || '')))) {
      const prod = (/<prod>([\s\S]*?)<\/prod>/.exec(m[2]) || [])[1] || '';
      out.set(+m[1], { frete: r2(tag(prod, 'vFrete')), outras: r2(num(tag(prod, 'vSeg')) + num(tag(prod, 'vOutro'))) });
    }
    return out;
  }
  // Nota do fornecedor (lerXml de nfe.js + o XML) → { compra, itens } para gravar em crm_compras/crm_compra_itens.
  // nossoDoc: CNPJ da OneClean (a nota tem de ser PARA ela, e não emitida por ela).
  function compraDoXml(d, xml, nossoDoc) {
    if (!d || d.tipo !== 'nota') throw new Error('não é uma NF-e');
    const dest = String((d.cliente || {}).doc || ''), emit = String((d.emitente || {}).doc || '');
    if (nossoDoc && emit === nossoDoc) throw new Error('é nota de saída da própria empresa, não de compra (NF ' + d.numero + ')');
    if (nossoDoc && dest && dest !== nossoDoc) throw new Error('a NF ' + d.numero + ' não é para a nossa empresa (destinatário ' + dest + ')');
    const ex = extrasDoXml(xml);
    return {
      compra: { chave: d.chave, numero: d.numero, serie: d.serie, emitida_em: d.emitida_em, fornecedor_doc: emit || null, fornecedor_nome: (d.emitente || {}).nome || null,
        valor_produtos: r2(d.valor_produtos), valor_total: r2(d.valor_total), parcelas: d.parcelas || [] },
      itens: (d.itens || []).map(it => {
        const f = it.fiscal || {}, e = ex.get(it.ordem) || {};
        return { ordem: it.ordem, cod_fornecedor: it.codigo, descricao: it.descricao, ean: f.gtin || null, ncm: it.ncm, cfop: it.cfop, unidade: it.unidade,
          quantidade: num(it.quantidade), valor_total: r2(it.valor_total), ipi: r2(f.v_ipi), st: r2(f.v_icms_st), frete: num(e.frete), outras: num(e.outras) };
      })
    };
  }
  // Custo de cada unidade do estoque: o que se pagou pelo item ÷ a quantidade já no fator (sem tirar créditos).
  const custoItem = (it, fator) => { const q = num(it.quantidade) * num(fator); return q > 0 ? Math.round((num(it.valor_total) + num(it.ipi) + num(it.st) + num(it.frete) + num(it.outras)) / q * 10000) / 10000 : null; };
  const palavras = t => [...new Set(String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(' ').filter(x => x.length >= 2))];
  const un = t => String(t || '').trim().toUpperCase().replace(/Ç/g, 'C');
  // Produto nosso para um item do fornecedor. ctx: { vinculos: Map('doc|cod' → {codigo, fator}), produtos: [crm_estoque sem as caixas],
  // unidades: Map('codigo|UN' → fator) }. Ordem: ligação já feita antes; descrição parecida (sugestão para conferir).
  // Fator: o da ligação; mesma unidade = 1; a unidade da caixa (crm_estoque_unidades); senão em branco (o comprador diz).
  function sugere(it, fornecedorDoc, ctx) {
    const v = ctx.vinculos && ctx.vinculos.get(fornecedorDoc + '|' + it.cod_fornecedor);
    if (v) return { codigo: v.codigo, fator: num(v.fator), como: 'ligado antes' };
    const pi = palavras(it.descricao);
    let melhor = null, nota = 0;
    (ctx.produtos || []).forEach(p => {
      const pp = palavras(p.descricao), comuns = pp.filter(x => pi.indexOf(x) !== -1).length;
      const s = comuns / Math.max(pi.length, pp.length, 1);
      if (s > nota) { nota = s; melhor = p; }
    });
    if (!melhor || nota < 0.5) return { codigo: null, fator: null, como: '' };
    const fator = un(melhor.unidade) && un(melhor.unidade) === un(it.unidade) ? 1 : (ctx.unidades && ctx.unidades.get(melhor.codigo + '|' + un(it.unidade))) || null;
    return { codigo: melhor.codigo, fator, como: 'descrição parecida (confira)' };
  }

  const TIPOS = { inicial: 'saldo inicial (FKN)', saida: 'saída (nota)', entrada: 'entrada (compra)', ajuste: 'ajuste', inventario: 'inventário', estorno: 'estorno' };
  const api = { junta, valor, sequencia, lerContagem, atualFkn, ehCaixa, TIPOS, extrasDoXml, compraDoXml, custoItem, sugere };
  raiz.CRMEstoque = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ------------------------------------------------------------ tela (aba Estoque: administrador e comprador)
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, S = raiz.CRMEstoque, R = raiz.CRMRegras;
  if (!CRM || !CRM.telas) return;
  const esc = CRM.esc;
  const qtd = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
  const quando = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

  let saldo = null, fkn = [], fotos = [], difs = [], fotoVista = null, carregando = false, compras = [], lendoCompras = '';
  const filtro = { ver: 'saldo', busca: '', soDif: false, linhaM: null };

  async function carrega() {
    if (carregando) return;
    carregando = true;
    try {
      const st = CRM.store();
      [saldo, fkn, fotos, compras] = await Promise.all([st.estoqueSaldo(), st.estoque(), st.estoqueFotos(60), st.compras ? st.compras(200).catch(() => []) : []]);
      const conferida = fotos.find(f => f.conferida_em);
      fotoVista = fotoVista || (conferida && conferida.id) || null;
      difs = fotoVista ? await st.estoqueDifs(fotoVista) : [];
    } catch (e) { saldo = saldo || []; CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }

  function cabecalho() {
    return '<div class="cabecalho"><div><h1>Estoque</h1><p class="sub">o estoque do CRM, em paralelo com o FKN: saldo, movimentos, contagem e a conferência com cada listagem do FKN · Fase 2 da saída do FKN</p></div>' +
      '<div class="acoes"><button type="button" class="btn sec" data-acao="es-recarregar"' + (carregando ? ' disabled' : '') + '>Atualizar</button></div></div>';
  }

  function naoComecado() {
    const ultima = fotos[0];
    return '<section class="cartao"><h2>Começar o estoque do CRM</h2>' +
      '<p>O saldo inicial de cada produto é o <strong>"atual" da listagem do FKN</strong> (o físico, com o reservado para cliente), na hora em que ela foi gerada. ' +
      'Daí em diante, cada nota de venda que chega ao CRM dá a saída sozinha, a nota cancelada devolve, e cada listagem nova do FKN (manhã e tarde) é conferida com o saldo do CRM.</p>' +
      (ultima ? '<p>Última listagem do FKN: gerada em <strong>' + esc(quando(ultima.gerado_em)) + '</strong> (' + (ultima.linhas || '?') + ' linhas).</p>'
        : '<p class="dica">Ainda não chegou nenhuma listagem com a hora. Puxe a listagem de produtos no FKN (a colinha está em Compras) e volte aqui.</p>') +
      (CRM.ehAdmin() && ultima ? '<p class="acoes"><button type="button" class="btn" data-acao="es-iniciar">Começar com a listagem de ' + esc(quando(ultima.gerado_em)) + '</button></p>'
        : !CRM.ehAdmin() ? '<p class="dica">Quem começa é o administrador.</p>' : '') + '</section>';
  }

  function quadros(linhas) {
    const seq = S.sequencia(fotos);
    const ult = fotos.find(f => f.conferida_em);
    const r = (ult && ult.resumo) || {};
    const kpi = (t, v, s, cls, ver) => '<button type="button" class="kpi clicavel ' + (cls || '') + (filtro.ver === ver ? ' ativo' : '') + '" data-acao="es-ver" data-id="' + ver + '"><span>' + esc(t) + '</span><strong>' + v + '</strong><small>' + esc(s) + '</small></button>';
    return '<div class="kpis">' +
      kpi('Produtos no estoque do CRM', (saldo || []).length, 'valor a custo médio: ' + R.moeda(S.valor(linhas)), '', 'saldo') +
      kpi('Última conferência com o FKN', ult ? (r.diferentes || 0) + ' diferença(s)' : '—', ult ? 'listagem de ' + quando(ult.gerado_em) + ' · ' + (r.sem_explicacao || 0) + ' sem explicação' : 'chega com a próxima listagem',
        ult && r.sem_explicacao ? 'vermelho' : ult ? 'verde' : '', 'conferencia') +
      kpi('Dias seguidos sem diferença sem explicação', seq.dias + ' de 15', seq.dias >= 15 ? 'pronto para a Fase 3 do plano' : 'a meta para confiar no estoque do CRM', seq.dias >= 15 ? 'verde' : '', 'conferencia') +
      kpi('Notas de compra', compras.filter(c => c.situacao === 'pendente').length + ' pendente(s)', 'subir o XML e dar entrada no estoque', compras.some(c => c.situacao === 'pendente') ? 'ambar' : '', 'compras') +
      kpi('Contagem e ajuste', '✎', 'inventário por contagem ou acerto de um produto', '', 'contagem') + '</div>';
  }

  // Mascotes das linhas de produto (turma.js, quando a instalação tem): um botão por mascote, que filtra a lista.
  function chipsLinhas(linhas) {
    const T = CRM.turma;
    if (!T || !T.daLinha) return '';
    const qt = new Map();
    linhas.forEach(x => { const m = T.daLinha(x.linha, x.descricao); if (m) qt.set(m, (qt.get(m) || 0) + 1); });
    if (!qt.size) return '';
    return '<div class="turma-chips">' + [...qt.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => {
      const d = T.dados(m);
      return '<button type="button" class="turma-chip' + (filtro.linhaM === m ? ' ativa' : '') + '" data-acao="es-linha" data-id="' + esc(m) + '" title="' + esc(d.papel) + '"><img src="' + esc(T.img(m, true)) + '" alt="">' + esc(d.nome) + ' <small>' + n + '</small></button>';
    }).join('') + '</div>';
  }

  function telaSaldo(linhas) {
    const q = R.normaliza(filtro.busca), T = CRM.turma;
    const l = linhas.filter(x => (!q || R.normaliza(x.descricao + ' ' + x.codigo + ' ' + (x.fornecedor || '')).indexOf(q) !== -1) && (!filtro.soDif || (x.dif != null && Math.abs(x.dif) >= 0.0005)) &&
      (!filtro.linhaM || !T || T.daLinha(x.linha, x.descricao) === filtro.linhaM))
      .sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
    return '<section class="cartao"><h2>Saldo por produto <small>' + l.length + ' produto(s)</small></h2>' + chipsLinhas(linhas) +
      '<p class="dica">"FKN agora" é o "atual" da última listagem; a diferença daqui pode ser só uma nota emitida depois dela. A conferência de verdade, na mesma hora, está em "Última conferência".</p>' +
      '<p class="acoes"><input type="search" placeholder="Procurar produto, código ou fornecedor" value="' + esc(filtro.busca) + '" data-es-busca class="of-busca"> ' +
      '<label class="filtro-inline"><input type="checkbox" data-es-sodif' + (filtro.soDif ? ' checked' : '') + '> só com diferença</label></p>' +
      (l.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th class="num">Saldo CRM</th><th class="num">FKN agora</th><th class="num">Diferença</th><th class="num">Custo médio</th><th>Último movimento</th><th></th></tr></thead><tbody>' +
        l.slice(0, 300).map(x => '<tr><td>' + (T ? T.iconeLinha(x.linha, x.descricao) : '') + '<strong>' + esc(R.nomeDeItem(x.descricao || x.codigo)) + '</strong><small>' + esc(x.codigo) + (x.unidade ? ' · ' + esc(x.unidade) : '') + (x.fornecedor ? ' · ' + esc(x.fornecedor) : '') + '</small></td>' +
          '<td class="num">' + qtd(x.saldo) + '</td><td class="num">' + qtd(x.fkn) + '</td>' +
          '<td class="num">' + (x.dif == null ? '—' : Math.abs(x.dif) < 0.0005 ? '✓' : '<strong>' + qtd(x.dif) + '</strong>') + '</td>' +
          '<td class="num">' + (x.custo == null ? '—' : R.moeda(x.custo)) + '</td><td>' + esc(quando(x.ultMov)) + '</td>' +
          '<td class="num">' + (x.saldo != null ? '<button type="button" class="mini" data-acao="es-movs" data-id="' + esc(x.codigo) + '" title="Movimentos">☰</button>' +
            '<button type="button" class="mini" data-acao="es-ajustar" data-id="' + esc(x.codigo) + '" title="Acertar o saldo">✎</button>' : '') + '</td></tr>').join('') +
        '</tbody></table></div>' + (l.length > 300 ? '<p class="dica">Mostrando 300 de ' + l.length + '; use a busca.</p>' : '') : '<p class="vazio">Nada aqui.</p>') + '</section>';
  }

  function telaConferencia() {
    const f = fotos.find(x => x.id === fotoVista);
    const grupos = new Map();
    difs.forEach(d => { const k = d.explicacao || 'sem explicação'; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(d); });
    const ordem = [...grupos.keys()].sort((a, b) => (a === 'sem explicação' ? -1 : b === 'sem explicação' ? 1 : grupos.get(b).length - grupos.get(a).length));
    const opcoes = fotos.filter(x => x.conferida_em).map(x => [x.id, quando(x.gerado_em) + ' · ' + ((x.resumo || {}).diferentes || 0) + ' diferença(s)']);
    return '<section class="cartao"><h2>Conferência CRM × FKN <small>' + (f ? 'listagem de ' + esc(quando(f.gerado_em)) : 'nenhuma ainda') + '</small></h2>' +
      '<p class="dica">Na hora em que o FKN gerou a listagem, o saldo do CRM (o livro até aquele minuto) × o "atual" do FKN. "Sem explicação" é o que conta para a meta dos 15 dias.</p>' +
      (opcoes.length > 1 ? '<p class="acoes"><label class="filtro-inline">Listagem <select data-es-foto>' + CRM.opcoesHTML(opcoes, fotoVista) + '</select></label></p>' : '') +
      (!f ? '<p class="vazio">A primeira conferência sai com a próxima listagem do FKN depois de começar o estoque.</p>'
        : !difs.length ? '<p class="vazio">Tudo igual nos dois. 👍</p>'
          : ordem.map(k => '<details data-chave="es-dif-' + esc(k) + '"' + (k === 'sem explicação' ? ' open' : '') + '><summary>' + (k === 'sem explicação' ? CRM.selo(k, 'vermelho') : esc(k)) + ' — ' + grupos.get(k).length + ' produto(s)</summary>' +
            '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th class="num">CRM</th><th class="num">FKN</th><th class="num">Diferença</th><th></th></tr></thead><tbody>' +
            grupos.get(k).slice(0, 200).map(d => '<tr><td><strong>' + esc(R.nomeDeItem(d.descricao || d.codigo)) + '</strong><small>' + esc(d.codigo) + '</small></td><td class="num">' + qtd(d.saldo_crm) + '</td><td class="num">' + qtd(d.saldo_fkn) + '</td>' +
              '<td class="num"><strong>' + qtd(d.diferenca) + '</strong></td><td class="num"><button type="button" class="mini" data-acao="es-movs" data-id="' + esc(d.codigo) + '" title="Movimentos">☰</button></td></tr>').join('') +
            '</tbody></table></div></details>').join('')) + '</section>';
  }

  // CNPJ da própria empresa: está na chave de qualquer nota de venda (posições 7 a 20)
  const nossoDoc = () => { const n = (CRM.estado.D.notas || []).find(x => x.chave && x.chave.length === 44); return n ? n.chave.slice(6, 20) : null; };
  function telaCompras() {
    const pend = compras.filter(c => c.situacao === 'pendente'), feitas = compras.filter(c => c.situacao !== 'pendente').slice(0, 30);
    const linhaC = c => '<tr><td><strong>' + esc(c.fornecedor_nome || '?') + '</strong><small>NF ' + esc(c.numero) + ' · ' + esc(quando(c.emitida_em)) + '</small></td>' +
      '<td class="num">' + R.moeda(c.valor_total) + '</td><td>' + (c.situacao === 'pendente' ? CRM.selo('pendente', 'ambar') : c.situacao === 'lancada' ? CRM.selo('entrada ' + quando(c.lancada_em), 'verde') : CRM.selo('deixada de lado', 'cinza') + (c.obs ? ' <small>' + esc(c.obs) + '</small>' : '')) + '</td>' +
      '<td class="num">' + (c.situacao === 'pendente' ? '<button type="button" class="btn" data-acao="es-compra" data-id="' + esc(c.id) + '">Conferir e dar entrada</button> <button type="button" class="mini" data-acao="es-compra-ignorar" data-id="' + esc(c.id) + '" title="Deixar de lado (não é mercadoria para o estoque)">✕</button>'
        : '<button type="button" class="mini" data-acao="es-compra" data-id="' + esc(c.id) + '" title="Ver os itens">☰</button>') + '</td></tr>';
    return '<section class="cartao"><h2>Notas de compra</h2>' +
      '<p>Suba o <strong>XML</strong> das notas dos fornecedores (vários de uma vez, ou o .zip). Cada uma fica pendente até você conferir: ligue cada item a um produto nosso e diga o fator ' +
      '(ex.: a caixa com 25 pacotes = 25). O CRM lembra a ligação para a próxima nota do mesmo fornecedor. A entrada soma no estoque com o custo do item (valor + IPI + ST + frete) e refaz o custo médio.</p>' +
      '<p class="dica">Enquanto o FKN roda junto, a nota de compra continua entrando no FKN também, e as parcelas <strong>não</strong> vão para o contas a pagar do CRM (o FKN já manda; ia duplicar no Caixa).</p>' +
      (lendoCompras ? '<p class="cob-lendo">' + esc(lendoCompras) + '</p>' : '<label class="btn sec arquivo">Escolher XML ou ZIP<input type="file" id="esCompraArq" multiple accept=".xml,.zip,text/xml,application/xml,application/zip"></label>') +
      '<h3>Pendentes <small>' + pend.length + '</small></h3>' +
      (pend.length ? '<div class="tabela-rolagem"><table class="tabela"><tbody>' + pend.map(linhaC).join('') + '</tbody></table></div>' : '<p class="vazio">Nenhuma nota esperando entrada.</p>') +
      (feitas.length ? '<details data-chave="es-compras-feitas"><summary>Últimas lançadas ou deixadas de lado (' + feitas.length + ')</summary><div class="tabela-rolagem"><table class="tabela"><tbody>' + feitas.map(linhaC).join('') + '</tbody></table></div></details>' : '') +
      '</section>';
  }

  async function lerCompras(files) {
    const st = CRM.store(), N = raiz.CRMNfe, nosso = nossoDoc();
    let novas = 0, ja = 0;
    const erros = [];
    lendoCompras = 'Lendo os XML…'; CRM.render();
    try {
      const textos = [];
      for (const f of [].slice.call(files || [])) {
        if (/\.zip$/i.test(f.name)) {
          if (!raiz.CRMXlsx || typeof DecompressionStream === 'undefined') { erros.push(f.name + ': este navegador não abre .zip'); continue; }
          (await raiz.CRMXlsx.lerZipTextos(f, /\.xml$/i)).forEach(x => textos.push({ nome: x.nome || f.name, texto: x.texto }));
        } else textos.push({ nome: f.name, texto: await f.text() });
      }
      for (const t of textos) {
        try {
          const d = N.lerXml(t.texto);
          if (!d || d.tipo !== 'nota') { erros.push(t.nome + ': não é NF-e'); continue; }
          const c = S.compraDoXml(d, t.texto, nosso);
          if (await st.compraGravar(c.compra, c.itens)) novas++; else ja++;
          lendoCompras = 'Gravando: ' + (novas + ja) + ' de ' + textos.length + '…'; CRM.render();
        } catch (e) { erros.push(t.nome + ': ' + (e.message || e)); }
      }
    } finally { lendoCompras = ''; }
    CRM.toast(novas + ' nota(s) de compra nova(s)' + (ja ? ', ' + ja + ' já estavam' : '') + (erros.length ? ' · ' + erros.length + ' com problema: ' + erros.slice(0, 3).join(' | ') : '') + '.', !!erros.length);
    compras = await st.compras(200).catch(() => compras); CRM.render();
  }

  function telaContagem() {
    return '<section class="cartao"><h2>Inventário por contagem</h2>' +
      '<p>Contou o estoque (todo ou uma parte)? Cole aqui uma linha por produto: <code>código;quantidade contada</code> (da planilha, com Tab, também serve). ' +
      'O CRM leva o saldo de cada produto ao contado e guarda a diferença no livro como "inventário", com o motivo.</p>' +
      '<p class="acoes"><button type="button" class="btn" data-acao="es-contagem">Lançar uma contagem</button></p>' +
      '<p class="dica">Para acertar um produto só, use o ✎ na lista de saldo. O livro não se apaga: todo acerto fica registrado com quem fez e por quê.</p></section>';
  }

  CRM.telas.estoque = {
    turmaSub: () => filtro.ver,
    render() {
      if (!(CRM.ehAdmin() || CRM.ehComprador())) return '<div class="cartao"><p class="vazio">Esta tela é do administrador e do comprador.</p></div>';
      if (saldo === null) { setTimeout(carrega, 0); return cabecalho() + '<div class="cartao"><p class="vazio">Carregando…</p></div>'; }
      if (!saldo.length) return cabecalho() + naoComecado();
      const linhas = S.junta(saldo, fkn);
      return cabecalho() + quadros(linhas) +
        (filtro.ver === 'conferencia' ? telaConferencia() : filtro.ver === 'contagem' ? telaContagem() : filtro.ver === 'compras' ? telaCompras() : telaSaldo(linhas));
    },
    depois(c) {
      const b = c.querySelector('[data-es-busca]');
      if (b) b.addEventListener('input', () => { filtro.busca = b.value; CRM.render(); });
      const d = c.querySelector('[data-es-sodif]');
      if (d) d.addEventListener('change', () => { filtro.soDif = d.checked; CRM.render(); });
      const arq = c.querySelector('#esCompraArq');
      if (arq) arq.addEventListener('change', () => lerCompras(arq.files).catch(CRM.falhou));
      const f = c.querySelector('[data-es-foto]');
      if (f) f.addEventListener('change', async () => { fotoVista = Number(f.value); difs = await CRM.store().estoqueDifs(fotoVista).catch(() => []); CRM.render(); });
    }
  };

  Object.assign(CRM.acoes, {
    'es-ver': id => { filtro.ver = id; CRM.render(); },
    'es-recarregar': () => { saldo = null; fotoVista = null; carrega(); },
    'es-iniciar': async () => {
      const ultima = fotos[0];
      if (!ultima || !confirm('Começar o estoque do CRM com o "atual" da listagem do FKN de ' + quando(ultima.gerado_em) + '?\nAs notas emitidas depois dela já dão a saída. Isto se faz uma vez só.')) return;
      try {
        const r = await CRM.store().estoqueIniciar();
        CRM.toast('Estoque do CRM começado: ' + r.produtos + ' produtos, ' + r.itens_depois + ' item(ns) de nota depois da listagem.');
        saldo = null; fotoVista = null; carrega();
      } catch (e) { CRM.falhou(e); }
    },
    'es-linha': m => { filtro.linhaM = filtro.linhaM === m ? null : m; CRM.render(); },
    'es-movs': async cod => {
      try {
        const l = await CRM.store().estoqueMovs(cod, 200);
        const s = (saldo || []).find(x => x.codigo === cod) || {};
        CRM.abrirForm({
          titulo: 'Movimentos: ' + R.nomeDeItem(s.descricao || cod), largura: 'largo', campos: [], salvarTexto: 'Fechar', aoSalvar: async () => {},
          intro: 'Saldo no CRM: ' + qtd(s.saldo) + (s.unidade ? ' ' + s.unidade : '') + (s.custo_medio != null ? ' · custo médio ' + R.moeda(s.custo_medio) : '') + '. Os 200 mais recentes.',
          htmlDepois: l.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Quando</th><th>Tipo</th><th class="num">Qtd.</th><th>Detalhe</th></tr></thead><tbody>' +
            l.map(m => '<tr><td>' + esc(quando(m.quando)) + '</td><td>' + esc(S.TIPOS[m.tipo] || m.tipo) + (m.conferir ? ' ' + CRM.selo('unidade a conferir', 'ambar') : '') + '</td>' +
              '<td class="num">' + (m.quantidade > 0 ? '+' : '') + qtd(m.quantidade) + '</td><td>' + esc(m.motivo || '') +
              (m.fator && Number(m.fator) !== 1 ? '<small>' + qtd(m.qtd_doc) + ' ' + esc(m.unidade_doc || '') + ' × ' + qtd(m.fator) + '</small>' : '') + '</td></tr>').join('') +
            '</tbody></table></div>' : '<p class="vazio">Nenhum movimento.</p>'
        });
      } catch (e) { CRM.falhou(e); }
    },
    'es-ajustar': cod => {
      const s = (saldo || []).find(x => x.codigo === cod); if (!s) return;
      CRM.abrirForm({
        titulo: 'Acertar o saldo: ' + R.nomeDeItem(s.descricao || cod),
        intro: 'Saldo no CRM agora: ' + qtd(s.saldo) + (s.unidade ? ' ' + s.unidade : '') + '. Diga quanto tem de verdade e o motivo; a diferença vai para o livro como "ajuste".',
        campos: [{ nome: 'contado', rotulo: 'Quantidade certa', tipo: 'numero', min: -1e9, passo: '0.001', obrigatorio: true },
          { nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, dica: 'ex.: contado no galpão, avaria, troca' }],
        valores: { contado: s.saldo }, salvarTexto: 'Acertar',
        aoSalvar: async v => {
          const n = await CRM.store().estoqueContagem([{ codigo: cod, contado: v.contado }], 'ajuste', v.motivo);
          CRM.toast(n ? 'Saldo acertado.' : 'Já estava assim: nada mudou.');
          saldo = null; carrega();
        }
      });
    },
    'es-compra': async id => {
      const c = compras.find(x => x.id === id); if (!c) return;
      try {
        const st = CRM.store();
        const [itens, vinc, unis] = await Promise.all([st.compraItens(id), st.compraVinculos().catch(() => []), st.estoqueUnidades().catch(() => [])]);
        const base = (fkn || []).filter(e => !S.ehCaixa(e.codigo));
        const nomeDe = new Map(base.map(e => [e.codigo, e.descricao])), unDe = new Map(base.map(e => [e.codigo, e.unidade]));
        (saldo || []).forEach(x => { if (!nomeDe.has(x.codigo)) { nomeDe.set(x.codigo, x.descricao); unDe.set(x.codigo, x.unidade); } });
        const ctx = { vinculos: new Map(vinc.map(v => [v.fornecedor_doc + '|' + v.cod_fornecedor, v])), produtos: base, unidades: new Map(unis.map(u => [u.codigo + '|' + u.unidade, Number(u.fator)])) };
        const pend = c.situacao === 'pendente';
        const sug = new Map(itens.map(it => [it.id, pend ? S.sugere(it, c.fornecedor_doc, ctx) : { codigo: it.codigo, fator: it.fator, como: '' }]));
        const linhaI = it => {
          const g = sug.get(it.id) || {};
          return '<tr><td><strong>' + esc(it.descricao) + '</strong><small>' + esc(it.cod_fornecedor || '') + ' · ' + qtd(it.quantidade) + ' ' + esc(it.unidade || '') + ' · ' + R.moeda(Number(it.valor_total) + Number(it.ipi) + Number(it.st) + Number(it.frete) + Number(it.outras)) +
            (g.como ? ' · ' + esc(g.como) : '') + '</small></td>' +
            '<td><input name="c_' + esc(it.id) + '" list="esProdutos" value="' + esc(g.codigo || '') + '" placeholder="código do produto"' + (pend ? '' : ' disabled') + ' class="es-cod"><small data-nome="' + esc(it.id) + '">' + esc(nomeDe.get(g.codigo) || '') + '</small></td>' +
            '<td><input name="f_' + esc(it.id) + '" type="number" step="any" min="0" value="' + esc(g.fator == null ? '' : g.fator) + '"' + (pend ? '' : ' disabled') + ' class="es-fator"><small data-q="' + esc(it.id) + '"></small></td>' +
            '<td>' + (pend ? '<label class="filtro-inline"><input type="checkbox" name="i_' + esc(it.id) + '"> não é estoque</label>' : '') + '</td></tr>';
        };
        CRM.abrirForm({
          titulo: 'NF ' + c.numero + ' · ' + (c.fornecedor_nome || ''), largura: 'extra', campos: [], valores: {},
          intro: (pend ? 'Ligue cada item a um produto nosso e diga o fator (quantas unidades do nosso estoque vêm em 1 unidade da nota). "Não é estoque": frete, brinde, material de uso.'
            : 'Entrada dada em ' + quando(c.lancada_em) + '.') + (c.parcelas && c.parcelas.length ? ' Parcelas da nota: ' + c.parcelas.map(p => R.dataBR(p.vencimento) + ' ' + R.moeda(p.valor)).join(', ') + ' (não vão para o contas a pagar enquanto o FKN roda junto).' : ''),
          htmlDepois: '<datalist id="esProdutos">' + [...nomeDe.entries()].map(([k, v]) => '<option value="' + esc(k) + '">' + esc(v || '') + '</option>').join('') + '</datalist>' +
            '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Item da nota</th><th>Produto nosso</th><th>Fator</th><th></th></tr></thead><tbody>' + itens.map(linhaI).join('') + '</tbody></table></div>',
          salvarTexto: pend ? 'Dar entrada no estoque' : 'Fechar',
          extras: form => {
            const atualiza = it => {
              const cod = form.elements['c_' + it.id].value.trim(), fat = Number(form.elements['f_' + it.id].value) || 0;
              const nome = form.querySelector('[data-nome="' + it.id + '"]'), q = form.querySelector('[data-q="' + it.id + '"]');
              if (nome) nome.textContent = nomeDe.get(cod) || (cod ? 'código que o estoque não tem' : '');
              if (q) q.textContent = fat ? '= ' + qtd(Number(it.quantidade) * fat) + ' ' + (unDe.get(cod) || '') + ' · ' + R.moeda(S.custoItem(it, fat)) + ' cada' : '';
            };
            itens.forEach(it => { atualiza(it); ['c_', 'f_'].forEach(p => form.elements[p + it.id].addEventListener('input', () => atualiza(it))); });
          },
          aoSalvar: async (v, form) => {
            if (!pend) return;
            const lista = itens.map(it => ({ id: it.id, codigo: form.elements['c_' + it.id].value.trim(), fator: form.elements['f_' + it.id].value, ignorar: form.elements['i_' + it.id].checked }));
            const falta = lista.filter(x => !x.ignorar && (!x.codigo || !(Number(x.fator) > 0)));
            if (falta.length) throw new Error(falta.length + ' item(ns) sem produto ou sem fator (ou marque "não é estoque")');
            const fora = lista.filter(x => !x.ignorar && !nomeDe.has(x.codigo));
            if (fora.length && !confirm(fora.length + ' código(s) que o estoque não tem (' + fora.map(x => x.codigo).join(', ') + '). Criar no estoque do CRM assim mesmo?')) return false;
            const r = await st.compraLancar(id, lista);
            CRM.toast('Entrada dada: ' + r.itens + ' item(ns) no estoque' + (r.ignorados ? ', ' + r.ignorados + ' fora do estoque' : '') + '.');
            saldo = null; carrega();
          }
        });
      } catch (e) { CRM.falhou(e); }
    },
    'es-compra-ignorar': async id => {
      const c = compras.find(x => x.id === id); if (!c) return;
      const obs = prompt('Deixar de lado a NF ' + c.numero + ' de ' + (c.fornecedor_nome || '') + '? Diga o motivo (ex.: material de uso, serviço, nota repetida):');
      if (obs == null) return;
      try { await CRM.store().compraIgnorar(id, obs); compras = await CRM.store().compras(200); CRM.render(); } catch (e) { CRM.falhou(e); }
    },
    'es-contagem': () => {
      CRM.abrirForm({
        titulo: 'Lançar uma contagem', largura: 'largo',
        intro: 'Uma linha por produto: código;quantidade contada (ex.: 300005;120). Produto que não está na lista não muda.',
        campos: [{ nome: 'texto', rotulo: 'Contagem', tipo: 'textarea', obrigatorio: true }, { nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, dica: 'ex.: inventário do galpão 16/10' }],
        valores: {}, salvarTexto: 'Conferir e lançar',
        aoSalvar: async v => {
          const r = S.lerContagem(v.texto);
          if (r.erros.length) throw new Error('não entendi ' + r.erros.length + ' linha(s): ' + r.erros.slice(0, 3).join(' | '));
          if (!r.lote.length) throw new Error('nenhuma linha com código e quantidade');
          const conhecidos = new Set((saldo || []).map(x => x.codigo));
          const fora = r.lote.filter(x => !conhecidos.has(x.codigo)).map(x => x.codigo);
          if (fora.length) throw new Error('código(s) que o estoque do CRM não tem: ' + fora.slice(0, 8).join(', '));
          if (!confirm('Levar ' + r.lote.length + ' produto(s) ao contado?')) return false;
          const n = await CRM.store().estoqueContagem(r.lote, 'inventario', v.motivo);
          CRM.toast('Contagem lançada: ' + n + ' produto(s) mudaram, ' + (r.lote.length - n) + ' já batiam.');
          saldo = null; carrega();
        }
      });
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
