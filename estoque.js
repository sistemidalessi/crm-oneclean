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
      out.set(+m[1], Object.assign({ frete: r2(tag(prod, 'vFrete')), outras: r2(num(tag(prod, 'vSeg')) + num(tag(prod, 'vOutro'))) }, stDoDet(m[2])));
    }
    return out;
  }
  // ICMS-ST que veio na nota de compra (19/10/2026): é o que a nossa nota de revenda com CST 60 informa como "retido
  // anteriormente" (base, alíquota, ICMS próprio do substituto e ICMS-ST), proporcional à quantidade vendida.
  // Fornecedor substituto (CST 10/30/70/90, CSOSN 201/202/203/900): vBCST, pICMSST, vICMS próprio e vICMSST.
  // Fornecedor que revendeu (CST 60, CSOSN 500, grupo ICMSST): os campos de "retido anteriormente".
  // Sem ST: só o CST (st_base etc. nulos). Valores do item inteiro (a conta por unidade é em fiscal.js).
  const ou = (x, t) => { const v = tag(x, t); return v === '' ? null : r2(v); };
  function stDoDet(det) {
    const icms = (/<ICMS>([\s\S]*?)<\/ICMS>/.exec(String(det || '')) || [])[1] || '';
    const g = /<(ICMS\w*)>([\s\S]*?)<\/\1>/.exec(icms);
    if (!g) return { st_cst: null, st_base: null, st_aliq: null, st_proprio: null, st_valor: null };
    const x = g[2], cst = tag(x, 'CST') || tag(x, 'CSOSN') || null;
    if (/^(10|30|70|90|201|202|203|900)$/.test(cst || '') && tag(x, 'vICMSST') !== '')
      return { st_cst: cst, st_base: ou(x, 'vBCST'), st_aliq: ou(x, 'pICMSST'), st_proprio: /^(30|201|202|203)$/.test(cst) ? null : ou(x, 'vICMS'), st_valor: ou(x, 'vICMSST') };
    if (/^(60|500)$/.test(cst || '') || g[1] === 'ICMSST')
      return { st_cst: cst || '60', st_base: ou(x, 'vBCSTRet'), st_aliq: ou(x, 'pST'), st_proprio: ou(x, 'vICMSSubstituto'), st_valor: ou(x, 'vICMSSTRet') };
    return { st_cst: cst, st_base: null, st_aliq: null, st_proprio: null, st_valor: null };
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
          quantidade: num(it.quantidade), valor_total: r2(it.valor_total), ipi: r2(f.v_ipi), st: r2(f.v_icms_st), frete: num(e.frete), outras: num(e.outras),
          st_cst: e.st_cst || null, st_base: e.st_base == null ? null : e.st_base, st_aliq: e.st_aliq == null ? null : e.st_aliq,
          st_proprio: e.st_proprio == null ? null : e.st_proprio, st_valor: e.st_valor == null ? null : e.st_valor };
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

  // ---- notas de compra da Sefaz (19/10/2026, pedido do Anderson antes de ligar a ciência automática)
  // Fornecedor que nunca vendeu para a empresa e o prazo da resposta definitiva (confirmação, desconhecimento, operação
  // não realizada). conhecidos: Set dos CNPJs já conhecidos (cadastro de fornecedores, notas de compra que deram entrada);
  // docs: crm_fornecedor_docs (o comprador disse "conheço" ou "não reconheço"); fknForn: [{ cod, nome }] da listagem do FKN
  // (para sugerir qual é); prazoDias: da emissão (padrão 90); avisoDias: quantos dias antes avisar; todas: lembrete de toda
  // nota sem resposta (senão só das de fornecedor "não reconheço").
  const GENERICAS = new Set(['LTDA', 'EIRELI', 'COMERCIO', 'COM', 'IND', 'INDUSTRIA', 'INDUSTRIAL', 'PRODUTOS', 'PROD', 'DISTRIBUIDORA', 'DIST', 'DISTRIBUICAO',
    'EPP', 'MATERIAIS', 'MAT', 'LIMPEZA', 'HIGIENE', 'EQUIP', 'EQUIPAMENTOS', 'EMBALAGENS', 'DESCARTAVEIS', 'BRASIL', 'IMPORTACAO', 'EXPORTACAO', 'COMERCIAL', 'GRUPO']);
  const palavrasForn = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')
    .filter(w => w.length > 2 && !GENERICAS.has(w));
  function sugereFornecedor(nome, fknForn) {
    const p = new Set(palavrasForn(nome));
    if (!p.size) return null;
    let melhor = null;
    (fknForn || []).forEach(f => { const q = palavrasForn(f.nome); if (!q.length) return;
      const comuns = q.filter(w => p.has(w)).length, nota = comuns / Math.min(p.size, q.length);
      if (comuns && nota >= 0.5 && (!melhor || nota > melhor.nota)) melhor = { cod: f.cod, nome: f.nome, nota }; });
    return melhor;
  }
  const diasAte = (de, ate) => Math.round((Date.parse(ate + 'T12:00:00Z') - Date.parse(de + 'T12:00:00Z')) / 864e5);
  const maisDias = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  function avisosDfe({ dfe, docs, conhecidos, fknForn, hoje, prazoDias, avisoDias, todas }) {
    const prazo = num(prazoDias) > 0 ? num(prazoDias) : 90, aviso = avisoDias == null ? 30 : num(avisoDias);
    const marc = new Map((docs || []).map(d => [d.doc, d]));
    const grupos = new Map();
    (dfe || []).filter(d => d.situacao === 'autorizada' && d.emitente_doc).forEach(d => {
      const g = grupos.get(d.emitente_doc) || { doc: d.emitente_doc, nome: d.emitente_nome || '', notas: [], valor: 0 };
      g.notas.push(d); g.valor += num(d.valor); if (!g.nome && d.emitente_nome) g.nome = d.emitente_nome;
      grupos.set(d.emitente_doc, g);
    });
    const desconhecidos = [], naoReconhecidos = [];
    grupos.forEach(g => {
      g.notas.sort((a, b) => String(a.emitida_em).localeCompare(String(b.emitida_em)));
      g.primeira = dia(g.notas[0].emitida_em); g.ultima = dia(g.notas[g.notas.length - 1].emitida_em);
      const m = marc.get(g.doc);
      if (m && m.situacao === 'desconhecido') naoReconhecidos.push(Object.assign(g, { semResposta: g.notas.filter(n => !n.conclusiva_tipo).length }));
      else if (!m && !(conhecidos && conhecidos.has(g.doc))) desconhecidos.push(Object.assign(g, { sugestao: sugereFornecedor(g.nome, fknForn) }));
    });
    const prazos = [];
    (dfe || []).forEach(d => {
      if (d.situacao !== 'autorizada' || d.conclusiva_tipo || !d.emitida_em) return;
      const m = marc.get(d.emitente_doc), ruim = !!(m && m.situacao === 'desconhecido');
      if (!todas && !ruim) return;
      const vence = maisDias(dia(d.emitida_em), prazo), resta = diasAte(hoje, vence);
      if (resta > aviso) return;
      prazos.push({ chave: d.chave, nome: d.emitente_nome || '', doc: d.emitente_doc, valor: num(d.valor), emitida: dia(d.emitida_em), vence, resta, desconhecido: ruim });
    });
    prazos.sort((a, b) => a.resta - b.resta);
    desconhecidos.sort((a, b) => b.valor - a.valor);
    return { desconhecidos, naoReconhecidos, prazos, prazoDias: prazo };
  }

  // ---- a mercadoria da nota de compra já chegou? (19/10/2026, pedido do Anderson: só dar entrada no que chegou)
  // Durante o paralelo, quem diz é o FKN: o comprador só dá entrada lá quando a mercadoria chega, e a listagem traz a
  // última entrada de cada produto. itensProd: [{ compra_id, codigo }] (item já ligado, ligação lembrada do fornecedor ou
  // código de barras — crm_compras_itens_produto); fkn: a listagem (codigo, fornecedor_cod, ult_entrada); fknForn: [{ cod,
  // nome }] para achar o fornecedor pelo nome quando nenhum item está ligado (aí é só "provável").
  // Devolve Map(compra.id → { estado: chegou | provavel | aguardando | sem_dado, em, ligados, comEntrada }).
  function chegadaCompras({ compras, itensProd, fkn, fknForn }) {
    const ult = new Map(), ultForn = new Map();
    (fkn || []).forEach(e => {
      const d = e.ult_entrada ? String(e.ult_entrada).slice(0, 10) : '';
      if (!d) return;
      const cod = String(e.codigo || '').replace(/\.\d+$/, '');
      if (!(ult.get(cod) >= d)) ult.set(cod, d);
      if (e.fornecedor_cod && !(ultForn.get(e.fornecedor_cod) >= d)) ultForn.set(e.fornecedor_cod, d);
    });
    const porCompra = new Map();
    (itensProd || []).forEach(i => { if (!i.codigo) return; if (!porCompra.has(i.compra_id)) porCompra.set(i.compra_id, new Set()); porCompra.get(i.compra_id).add(String(i.codigo).replace(/\.\d+$/, '')); });
    const out = new Map();
    (compras || []).forEach(c => {
      const emit = dia(c.emitida_em), cods = [...(porCompra.get(c.id) || [])];
      const datas = cods.map(k => ult.get(k)).filter(d => d && d >= emit);
      if (cods.length) {
        out.set(c.id, datas.length ? { estado: 'chegou', em: datas.slice().sort().pop(), ligados: cods.length, comEntrada: datas.length }
          : { estado: 'aguardando', em: null, ligados: cods.length, comEntrada: 0 });
        return;
      }
      const f = sugereFornecedor(c.fornecedor_nome, fknForn), d = f && ultForn.get(f.cod);
      out.set(c.id, !f ? { estado: 'sem_dado', em: null, ligados: 0, comEntrada: 0 }
        : d && d >= emit ? { estado: 'provavel', em: d, ligados: 0, comEntrada: 0, fornecedor: f.nome } : { estado: 'aguardando', em: null, ligados: 0, comEntrada: 0, fornecedor: f.nome });
    });
    return out;
  }

  // Nota de compra que não é mercadoria para revender (19/10/2026: o abastecimento do caminhão veio pela Sefaz como nota
  // de compra): combustível pelo NCM (2710 óleos/diesel/gasolina, 2711 gás, 2207 etanol) ou CFOP de combustível, de nota
  // emitida para cupom fiscal (5929/6929) ou de serviço. Devolve o motivo ou null.
  const CFOP_DESPESA = { 5929: 'nota de cupom fiscal (posto)', 6929: 'nota de cupom fiscal (posto)', 5655: 'combustível', 5656: 'combustível', 5667: 'combustível',
    6655: 'combustível', 6656: 'combustível', 6667: 'combustível', 5933: 'serviço', 6933: 'serviço' };
  function pareceDespesa(itens) {
    const l = (itens || []).filter(Boolean);
    if (!l.length) return null;
    const motivo = it => (/^(2710|2711|2207)/.test(String(it.ncm || '')) ? 'combustível' : CFOP_DESPESA[Number(it.cfop)] || null);
    const m = l.map(motivo);
    return m.every(Boolean) ? (m.includes('combustível') ? 'combustível' : m[0]) : null;
  }

  const TIPOS = { inicial: 'saldo inicial (FKN)', saida: 'saída (nota)', entrada: 'entrada (compra)', ajuste: 'ajuste', inventario: 'inventário', estorno: 'estorno' };
  const api = { junta, valor, sequencia, lerContagem, atualFkn, ehCaixa, TIPOS, extrasDoXml, stDoDet, compraDoXml, custoItem, sugere, avisosDfe, sugereFornecedor, chegadaCompras, pareceDespesa };
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
  const filtro = { ver: 'saldo', busca: '', soDif: false };
  let dfe = [], dfeEst = null, buscouDfe = false, buscandoDfe = '', fornDocs = [], fornCad = [], itensProd = [], itensPend = [];

  async function carrega() {
    if (carregando) return;
    carregando = true;
    try {
      const st = CRM.store();
      [saldo, fkn, fotos, compras, dfe, dfeEst] = await Promise.all([st.estoqueSaldo(), st.estoque(), st.estoqueFotos(60), st.compras ? st.compras(200).catch(() => []) : [],
        st.dfe ? st.dfe().catch(() => []) : [], st.dfeEstado ? st.dfeEstado().catch(() => null) : null]);
      [fornDocs, fornCad, itensProd] = await Promise.all([st.fornecedorDocs ? st.fornecedorDocs().catch(() => []) : [], st.fornecedores ? st.fornecedores().catch(() => []) : [],
        st.comprasItensProduto && compras.some(c => c.situacao === 'pendente') ? st.comprasItensProduto().catch(() => []) : []]);
      const idsPend = compras.filter(c => c.situacao === 'pendente').map(c => c.id);
      itensPend = idsPend.length && st.compraItensDe ? await st.compraItensDe(idsPend).catch(() => []) : [];
      if (st.modo === 'supabase' && podeSefaz() && !buscouDfe && (!dfeEst || !dfeEst.proxima_em || Date.parse(dfeEst.proxima_em) < Date.now())) { buscouDfe = true; setTimeout(() => buscaSefaz(true), 50); }
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
      kpi('Contagem e ajuste', '✎', 'inventário por contagem ou acerto de um produto', '', 'contagem') +
      (CRM.produtos ? kpi('Fotos e fichas', '📷', 'foto, ficha técnica e FISPQ de cada produto (a IA procura, você aprova)', '', 'fotos') : '') + '</div>';
  }

  function telaSaldo(linhas) {
    const q = R.normaliza(filtro.busca);
    const l = linhas.filter(x => (!q || R.normaliza(x.descricao + ' ' + x.codigo + ' ' + (x.fornecedor || '')).indexOf(q) !== -1) && (!filtro.soDif || (x.dif != null && Math.abs(x.dif) >= 0.0005)))
      .sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
    return '<section class="cartao"><h2>Saldo por produto <small>' + l.length + ' produto(s)</small></h2>' +
      '<p class="dica">"FKN agora" é o "atual" da última listagem; a diferença daqui pode ser só uma nota emitida depois dela. A conferência de verdade, na mesma hora, está em "Última conferência".</p>' +
      '<p class="acoes"><input type="search" placeholder="Procurar produto, código ou fornecedor" value="' + esc(filtro.busca) + '" data-es-busca class="of-busca"> ' +
      '<label class="filtro-inline"><input type="checkbox" data-es-sodif' + (filtro.soDif ? ' checked' : '') + '> só com diferença</label></p>' +
      (l.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th class="num">Saldo CRM</th><th class="num">FKN agora</th><th class="num">Diferença</th><th class="num">Custo médio</th><th>Último movimento</th><th></th></tr></thead><tbody>' +
        l.slice(0, 300).map(x => '<tr><td>' + (CRM.produtos ? '<button type="button" class="pd-info-foto" data-acao="pf-ficha" data-id="' + esc(x.codigo) + '" title="Ficha e foto">' + CRM.produtos.miniatura(x.codigo) + '</button>' : '') + '<strong>' + esc(R.nomeDeItem(x.descricao || x.codigo)) + '</strong><small>' + esc(x.codigo) + (x.unidade ? ' · ' + esc(x.unidade) : '') + (x.fornecedor ? ' · ' + esc(x.fornecedor) : '') + '</small></td>' +
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
  const dm = d => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '');
  function seloChegada(ch, listagem) {
    if (!ch) return '';
    const base = listagem ? ' pela listagem do FKN de ' + quando(listagem) : '';
    if (ch.estado === 'chegou') return CRM.selo('✓ chegou: entrou no FKN em ' + dm(ch.em) + (ch.comEntrada < ch.ligados ? ' (' + ch.comEntrada + ' de ' + ch.ligados + ' produtos)' : ''), 'verde', 'o FKN deu entrada nos produtos desta nota' + base);
    if (ch.estado === 'provavel') return CRM.selo('✓? provável: o FKN deu entrada de produto deste fornecedor em ' + dm(ch.em), 'azul', 'nenhum item ligado a produto nosso ainda; pelo nome do fornecedor (' + ch.fornecedor + ')' + base);
    if (ch.estado === 'aguardando') return CRM.selo('⏳ aguardando chegada', 'cinza', 'sem entrada no FKN depois da emissão' + base);
    return CRM.selo('? sem como saber', 'cinza', 'nenhum item ligado e fornecedor não achado na listagem do FKN: confira com o recebimento');
  }
  const ORDEM_CHEGADA = { chegou: 0, provavel: 1, aguardando: 2, sem_dado: 3 };
  const HISTORICO = 'antes do início do estoque do CRM';
  function telaCompras() {
    const ch = S.chegadaCompras({ compras: compras.filter(c => c.situacao === 'pendente'), itensProd, fkn, fknForn: fknFornecedores() });
    const listagem = (fkn || []).reduce((m, x) => (x.atualizado_em && x.atualizado_em > m ? x.atualizado_em : m), '');
    const despesa = new Map();
    compras.filter(c => c.situacao === 'pendente').forEach(c => { const m = S.pareceDespesa(itensPend.filter(i => i.compra_id === c.id)); if (m) despesa.set(c.id, m); });
    const ordem = c => (despesa.has(c.id) ? -1 : ch.has(c.id) ? ORDEM_CHEGADA[ch.get(c.id).estado] : 9);
    // as mais novas em cima (pedido do Anderson, 19/10); dentro do mesmo dia, as que chegaram primeiro
    const pend = compras.filter(c => c.situacao === 'pendente').sort((a, b) => String(b.emitida_em).slice(0, 10).localeCompare(String(a.emitida_em).slice(0, 10)) || ordem(a) - ordem(b)),
      lancadas = compras.filter(c => c.situacao === 'lancada').slice(0, 30),
      deixadas = compras.filter(c => c.situacao === 'ignorada' && !String(c.obs || '').startsWith(HISTORICO)).slice(0, 30),
      historico = compras.filter(c => c.situacao === 'ignorada' && String(c.obs || '').startsWith(HISTORICO)).length;
    const chegaram = pend.filter(c => !despesa.has(c.id) && ordem(c) >= 0 && ordem(c) <= 1).length;
    const linhaC = c => { const x = ch.get(c.id), desp = despesa.get(c.id), veio = !desp && x && (x.estado === 'chegou' || x.estado === 'provavel');
      return '<tr><td><strong>' + esc(c.fornecedor_nome || '?') + '</strong><small>NF ' + esc(c.numero) + ' · ' + esc(quando(c.emitida_em)) + '</small></td>' +
      '<td class="num">' + R.moeda(c.valor_total) + '</td><td>' + (c.situacao === 'pendente'
        ? (desp ? CRM.selo('💡 parece despesa (' + desp + '): não é mercadoria', 'azul', 'não entra no estoque; a despesa vai no Caixa') : CRM.selo('pendente', 'ambar') + ' ' + seloChegada(x, listagem))
        : c.situacao === 'lancada' ? CRM.selo('entrada ' + quando(c.lancada_em), 'verde') : CRM.selo('deixada de lado', 'cinza') + (c.obs ? ' <small>' + esc(c.obs) + '</small>' : '')) + '</td>' +
      '<td class="num">' + (c.situacao === 'pendente'
        ? (desp ? '<button type="button" class="btn" data-acao="es-compra-ignorar" data-id="' + esc(c.id) + '">Não é mercadoria</button> <button type="button" class="mini" data-acao="es-compra" data-id="' + esc(c.id) + '" title="Ver os itens e dar entrada assim mesmo">☰</button>'
          : '<button type="button" class="btn' + (veio ? '' : ' sec') + '" data-acao="es-compra" data-id="' + esc(c.id) + '">Conferir e dar entrada</button> <button type="button" class="btn sec" data-acao="es-compra-ignorar" data-id="' + esc(c.id) + '" title="Despesa, material de uso, nota repetida…: não entra no estoque">Não é mercadoria</button>')
        : '<button type="button" class="mini" data-acao="es-compra" data-id="' + esc(c.id) + '" title="Ver os itens">☰</button>') + '</td></tr>'; };
    const tabela = l => '<div class="tabela-rolagem"><table class="tabela"><tbody>' + l.map(linhaC).join('') + '</tbody></table></div>';
    return '<section class="cartao"><h2>Notas de compra para dar entrada <small>' + pend.length + (chegaram ? ' · ' + chegaram + (chegaram === 1 ? ' já chegou' : ' já chegaram') : '') + '</small></h2>' +
      (pend.length ? '<p class="dica">As mais novas em cima. Só dê entrada no que chegou: enquanto o FKN roda junto, o selo verde aparece quando a listagem do FKN mostra entrada dos produtos da nota' +
        (listagem ? ' (última listagem: ' + esc(quando(listagem)) + ')' : '') + '. <strong>Dar entrada</strong> soma no estoque do CRM e <strong>não</strong> lança nada no contas a pagar (o FKN já lança). ' +
        '<strong>Não é mercadoria</strong> (combustível, serviço, material de uso, nota repetida): sai da lista sem mexer no estoque; a despesa fica no Caixa.</p>' + tabela(pend)
        : '<p class="vazio">Nenhuma nota esperando entrada.</p>') +
      '<details data-chave="es-compras-como"><summary>Subir XML à mão e como a entrada funciona</summary>' +
        '<p>As notas chegam sozinhas pela Sefaz (abaixo). Se precisar, suba o <strong>XML</strong> (vários de uma vez, ou o .zip). Na entrada, ligue cada item a um produto nosso e diga o fator ' +
        '(ex.: a caixa com 25 pacotes = 25); o CRM lembra a ligação para a próxima nota do mesmo fornecedor. O custo do item é valor + IPI + ST + frete e refaz o custo médio.</p>' +
        (lendoCompras ? '<p class="cob-lendo">' + esc(lendoCompras) + '</p>' : '<label class="btn sec arquivo">Escolher XML ou ZIP<input type="file" id="esCompraArq" multiple accept=".xml,.zip,text/xml,application/xml,application/zip"></label>') +
      '</details>' +
      (lancadas.length ? '<details data-chave="es-compras-lancadas"><summary>Entradas dadas (' + lancadas.length + ')</summary>' + tabela(lancadas) + '</details>' : '') +
      (deixadas.length ? '<details data-chave="es-compras-deixadas"><summary>Deixadas de lado (' + deixadas.length + ')</summary>' + tabela(deixadas) + '</details>' : '') +
      (historico ? '<p class="dica">' + historico + ' nota(s) de antes do início do estoque do CRM ficam só como histórico de preço (já estão no saldo que veio do FKN).</p>' : '') +
      '</section>' + blocoSefaz();
  }

  // Grava cada XML de compra em crm_compras (pendente, para o comprador conferir). Nota de ANTES do início do estoque do
  // CRM já entrou no estoque pelo FKN: fica como "deixada de lado", só para o histórico de preço (comprador sênior).
  async function gravaTextos(textos, nosso) {
    const st = CRM.store(), N = raiz.CRMNfe;
    const inicio = (saldo || []).reduce((m, x) => (x.inicio && (!m || x.inicio < m) ? x.inicio : m), null);
    let novas = 0, ja = 0, historico = 0;
    const erros = [];
    for (const t of textos) {
      try {
        const d = N.lerXml(t.texto);
        if (!d || d.tipo !== 'nota') { erros.push(t.nome + ': não é NF-e'); continue; }
        const c = S.compraDoXml(d, t.texto, nosso);
        const g = await st.compraGravar(c.compra, c.itens);
        if (!g) { ja++; continue; }
        novas++;
        if (inicio && c.compra.emitida_em && c.compra.emitida_em < inicio) { await st.compraIgnorar(g.id, 'antes do início do estoque do CRM: já entrou pelo FKN; fica como histórico de preço'); historico++; }
        lendoCompras = 'Gravando: ' + (novas + ja) + ' de ' + textos.length + '…'; CRM.render();
      } catch (e) { erros.push(t.nome + ': ' + (e.message || e)); }
    }
    return { novas, ja, historico, erros };
  }

  // ---- notas de compra pela Sefaz
  const podeSefaz = () => CRM.ehAdmin() || CRM.ehComprador();   // os mesmos da crm-fiscal (DFE) e da RLS de crm_dfe
  async function buscaSefaz(sozinho) {
    const st = CRM.store();
    if (!st.dfeBuscar || buscandoDfe) return;
    buscandoDfe = 'Consultando a Sefaz…'; CRM.render();
    try {
      const r = await st.dfeBuscar();
      if (!sozinho || r.resumos || r.notas) CRM.toast(r.espera ? 'A Sefaz pede 1 hora entre as consultas: a próxima fica liberada às ' + quando(r.espera) + '.'
        : (r.resumos || 0) + ' nota(s) nova(s) da Sefaz' + (r.notas ? ', ' + r.notas + ' com o XML completo' : '') + (r.motivo ? ' · ' + r.motivo : '') + '.');
    } catch (e) { if (!sozinho) CRM.falhou(e); }
    buscandoDfe = '';
    [dfe, dfeEst] = await Promise.all([st.dfe().catch(() => dfe), st.dfeEstado().catch(() => dfeEst)]);
    await trazDfe(true);
    CRM.render();
  }
  // As notas da Sefaz que já têm o XML completo e ainda não estão no CRM viram compra (pendente ou histórico).
  async function trazDfe(sozinho) {
    const st = CRM.store(), tem = new Set(compras.map(c => c.chave));
    const faltam = dfe.filter(d => d.xml_em && d.situacao === 'autorizada' && !tem.has(d.chave));
    if (!faltam.length) { if (!sozinho) CRM.toast('Nenhuma nota completa da Sefaz fora do CRM.'); return; }
    lendoCompras = 'Trazendo ' + faltam.length + ' nota(s) da Sefaz…'; CRM.render();
    const textos = [];
    for (const d of faltam) { const x = await st.dfeXml(d.chave).catch(() => null); if (x) textos.push({ nome: 'NF de ' + (d.emitente_nome || d.chave), texto: x }); }
    const r = await gravaTextos(textos, nossoDoc() || String((CRM.estado.cfg.fiscal && CRM.estado.cfg.fiscal.emitente && CRM.estado.cfg.fiscal.emitente.cnpj) || '').replace(/\D/g, '') || null);
    lendoCompras = '';
    if (r.novas || !sozinho) CRM.toast(r.novas + ' nota(s) da Sefaz no CRM' + (r.historico ? ' (' + r.historico + ' de antes do estoque do CRM, só como histórico de preço)' : '') + (r.erros.length ? ' · ' + r.erros.length + ' com problema: ' + r.erros.slice(0, 2).join(' | ') : '') + '.', !!r.erros.length);
    compras = await st.compras(200).catch(() => compras);
  }
  // Fornecedor desconhecido e prazo da resposta definitiva (S.avisosDfe): os CNPJs conhecidos saem do cadastro de
  // fornecedores, das notas de compra que deram entrada e do que o comprador já marcou.
  const docDe = v => String(v || '').replace(/[^0-9A-Z]/gi, '').toUpperCase();
  function fknFornecedores() {
    const m = new Map();
    (fkn || []).forEach(x => { if (x.fornecedor_cod && x.fornecedor && !m.has(x.fornecedor_cod)) m.set(x.fornecedor_cod, x.fornecedor); });
    (fornCad || []).forEach(f => m.set(f.codigo, f.nome));
    return [...m.entries()].map(([cod, nome]) => ({ cod, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  function avisos() {
    const fiscal = (CRM.estado.cfg && CRM.estado.cfg.fiscal) || {};
    const conhecidos = new Set((fornCad || []).map(f => docDe(f.cnpj)).filter(Boolean).concat(compras.filter(c => c.situacao === 'lancada').map(c => docDe(c.fornecedor_doc))));
    return S.avisosDfe({ dfe, docs: fornDocs, conhecidos, fknForn: fknFornecedores(), hoje: CRM.hoje(), prazoDias: fiscal.dfe_prazo_dias, avisoDias: 30, todas: fiscal.dfe_lembrete_todas === true });
  }
  const NOME_RESP = { confirmacao: 'Confirmar a operação', desconhecimento: 'Desconhecimento', nao_realizada: 'Operação não realizada' };
  function blocoAvisosDfe() {
    const a = avisos(), adm = CRM.ehAdmin();
    let h = '';
    if (a.desconhecidos.length) h += '<section class="cartao aviso-dfe"><h2>⚠ Fornecedor que nunca vendeu para a empresa <small>' + a.desconhecidos.length + ' CNPJ(s) nas notas da Sefaz</small></h2>' +
      '<p>Confira se a compra aconteceu. Se não reconhecer, marque "Não reconheço": a nota entra no lembrete para responder <strong>Desconhecimento</strong> à Sefaz dentro do prazo.</p>' +
      '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Emitente</th><th class="num">Notas</th><th class="num">Valor</th><th>Período</th><th></th></tr></thead><tbody>' +
      a.desconhecidos.map(g => '<tr><td><strong>' + esc(g.nome || '?') + '</strong><small>CNPJ ' + esc(R.formataCNPJ ? R.formataCNPJ(g.doc) : g.doc) +
          (g.sugestao ? ' · parece o fornecedor <strong>' + esc(g.sugestao.nome) + '</strong> do FKN' : '') + '</small></td>' +
        '<td class="num">' + g.notas.length + '</td><td class="num">' + R.moeda(g.valor) + '</td><td><small>' + esc(R.dataBR(g.primeira) + (g.ultima !== g.primeira ? ' a ' + R.dataBR(g.ultima) : '')) + '</small></td>' +
        '<td class="num"><button type="button" class="btn sec" data-acao="es-dfe-conheco" data-id="' + esc(g.doc) + '">Conheço</button> ' +
          '<button type="button" class="mini" data-acao="es-dfe-naoreconheco" data-id="' + esc(g.doc) + '">Não reconheço</button></td></tr>').join('') +
      '</tbody></table></div></section>';
    if (a.prazos.length || a.naoReconhecidos.some(g => g.semResposta)) h += '<section class="cartao aviso-dfe"><h2>⏳ Resposta definitiva à Sefaz <small>prazo de ' + a.prazoDias + ' dias da emissão (conferir com o contador)</small></h2>' +
      (a.prazos.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Emitente</th><th class="num">Valor</th><th>Emitida</th><th>Prazo</th><th></th></tr></thead><tbody>' +
        a.prazos.map(p => '<tr><td><strong>' + esc(p.nome || '?') + '</strong>' + (p.desconhecido ? ' ' + CRM.selo('não reconhecido', 'vermelho') : '') + '<small>chave …' + esc(p.chave.slice(-12)) + '</small></td>' +
          '<td class="num">' + R.moeda(p.valor) + '</td><td>' + esc(R.dataBR(p.emitida)) + '</td><td>' + CRM.selo(p.resta < 0 ? 'venceu em ' + R.dataBR(p.vence) : p.resta === 0 ? 'vence hoje' : 'faltam ' + p.resta + ' dia(s) · ' + R.dataBR(p.vence), p.resta <= 10 ? 'vermelho' : 'ambar') + '</td>' +
          '<td class="num">' + (adm ? (p.desconhecido ? '<button type="button" class="btn" data-acao="es-dfe-resp" data-id="' + esc(p.chave + '|desconhecimento') + '">Responder Desconhecimento</button> ' : '') +
            '<button type="button" class="mini" data-acao="es-dfe-resp" data-id="' + esc(p.chave + '|confirmacao') + '">Confirmar</button> ' +
            '<button type="button" class="mini" data-acao="es-dfe-resp" data-id="' + esc(p.chave + '|nao_realizada') + '">Não realizada</button>' + (p.desconhecido ? '' : ' <button type="button" class="mini" data-acao="es-dfe-resp" data-id="' + esc(p.chave + '|desconhecimento') + '">Desconheço</button>')
            : '<small>quem responde é o administrador</small>') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<p class="vazio">Nenhuma nota perto do prazo.</p>') +
      (a.naoReconhecidos.length ? '<p class="dica">Não reconhecidos: ' + a.naoReconhecidos.map(g => esc(g.nome || g.doc) + ' (' + g.semResposta + ' sem resposta)').join(' · ') +
        '. As notas deles aparecem aqui quando faltarem 30 dias para o prazo; dá para responder antes pela lista "Só com o resumo".</p>' : '') + '</section>';
    return h;
  }

  function blocoSefaz() {
    const st = CRM.store();
    if (!st || !st.dfe || st.modo !== 'supabase' || !podeSefaz()) return '';
    const tem = new Set(compras.map(c => c.chave));
    const aut = dfe.filter(d => d.situacao === 'autorizada');
    const completas = aut.filter(d => d.xml_em && !tem.has(d.chave)), resumo = aut.filter(d => !d.xml_em);
    const semCiencia = resumo.filter(d => !d.manifestada_em), aguardando = resumo.filter(d => d.manifestada_em);
    // Ciência só do que já chegou (decisão do Anderson, 19/10): as de antes do início do estoque do CRM já estão no saldo
    // (entraram pelo FKN) e vão juntas num clique; as de depois, uma a uma, quando a mercadoria chegar.
    const ini = inicioEstoque(), antigas = ini ? semCiencia.filter(d => d.emitida_em && d.emitida_em < ini) : [];
    const e = dfeEst || {}, espera = e.proxima_em && Date.parse(e.proxima_em) > Date.now();
    return '<section class="cartao"><h2>Notas da Sefaz <small>emitidas contra o nosso CNPJ nos últimos 3 meses</small></h2>' +
      '<p>' + (e.ultima_em ? 'Última consulta: <strong>' + esc(quando(e.ultima_em)) + '</strong>' + (e.ultimo_motivo ? ' (' + esc(e.ultimo_motivo) + ')' : '') + '. ' : 'Ainda não consultou. ') +
        (espera ? 'A Sefaz pede 1 hora entre as consultas: a próxima fica liberada às ' + esc(quando(e.proxima_em)) + '.' : '') + '</p>' +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="es-sefaz"' + (espera || buscandoDfe ? ' disabled' : '') + '>' + esc(buscandoDfe || 'Buscar na Sefaz agora') + '</button> ' +
        (completas.length ? '<button type="button" class="btn" data-acao="es-sefaz-trazer">Trazer ' + completas.length + ' nota(s) para a conferência</button> ' : '') + '</p>' +
      '<p>' + aut.length + ' nota(s) vista(s) · ' + (aut.length - resumo.length) + ' com o XML completo · ' + resumo.length + ' só com o resumo' + (aguardando.length ? ' (' + aguardando.length + ' esperando a Sefaz liberar o XML)' : '') + '.</p>' +
      (semCiencia.length ? '<p class="dica">O XML completo (itens e preços) só vem depois da <strong>Ciência da Operação</strong>: o aviso à Sefaz de que a empresa sabe da nota. ' +
          'Não confirma nem recusa a compra. ' + (CRM.ehAdmin() ? '' : 'Quem dá a ciência é o administrador.') + '</p>' +
        (CRM.ehAdmin() && antigas.length ? '<p class="acoes"><button type="button" class="btn sec" data-acao="es-sefaz-ciencia-antigas">Dar ciência nas ' + antigas.length + ' nota(s) de antes de ' +
          esc(quando(ini).slice(0, 5)) + ' (a mercadoria já está no estoque)</button></p>' : '') +
        (CRM.ehAdmin() && semCiencia.length > antigas.length ? '<p class="dica">As mais novas: dê a ciência na nota (na lista abaixo) quando a mercadoria chegar; aí o XML vem e a nota fica pendente para a entrada.</p>' : '') : '') +
      (resumo.length ? '<details data-chave="es-sefaz-resumos"><summary>Só com o resumo (' + resumo.length + ')</summary><div class="tabela-rolagem"><table class="tabela"><tbody>' +
        resumo.slice(0, 100).map(d => '<tr><td><strong>' + esc(d.emitente_nome || '?') + '</strong><small>' + esc(quando(d.emitida_em)) + '</small></td><td class="num">' + R.moeda(d.valor) + '</td><td>' +
          (d.manifestada_em ? CRM.selo('ciência dada', 'azul') : d.manifesto_motivo ? CRM.selo(d.manifesto_motivo.slice(0, 60), 'vermelho') : CRM.selo('falta ciência', 'ambar')) +
          (!d.manifestada_em && CRM.ehAdmin() ? ' <button type="button" class="mini" data-acao="es-sefaz-ciencia-uma" data-id="' + esc(d.chave) + '" title="Dar a Ciência da Operação desta nota (quando a mercadoria chegar)">dar ciência</button>' : '') +
          (d.conclusiva_tipo ? ' ' + CRM.selo(NOME_RESP[d.conclusiva_tipo], 'verde') : CRM.ehAdmin() ? ' <button type="button" class="mini" data-acao="es-dfe-resp" data-id="' + esc(d.chave + '|desconhecimento') + '" title="Responder Desconhecimento à Sefaz">desconheço</button>' : '') + '</td></tr>').join('') +
        '</tbody></table></div></details>' : '') + '</section>' + blocoAvisosDfe();
  }

  const inicioEstoque = () => (saldo || []).reduce((m, x) => (x.inicio && (!m || x.inicio < m) ? x.inicio : m), null);
  // uma por vez (a crm-fiscal recebe uma chave e confere que ainda falta a ciência)
  async function ciencia(chaves) {
    let ok = 0, falha = 0;
    for (const ch of chaves) {
      try { const r = await CRM.store().dfeCiencia(ch); ok += r.ok || 0; falha += r.falha || 0; } catch (e) { falha++; }
    }
    CRM.toast('Ciência dada em ' + ok + ' nota(s)' + (falha ? ', ' + falha + ' com problema (veja na lista)' : '') + '. O XML completo chega na próxima consulta à Sefaz (até 1 hora).', !!falha);
    const st = CRM.store(); dfe = await st.dfe().catch(() => dfe); CRM.render();
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
      const r = await gravaTextos(textos, nosso);
      novas = r.novas; ja = r.ja; erros.push(...r.erros);
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
      if (!saldo.length) return cabecalho() + (filtro.ver === 'fotos' && CRM.produtos ? CRM.produtos.telaFotos() : naoComecado());
      const linhas = S.junta(saldo, fkn);
      return cabecalho() + quadros(linhas) +
        (filtro.ver === 'conferencia' ? telaConferencia() : filtro.ver === 'contagem' ? telaContagem() : filtro.ver === 'compras' ? telaCompras()
          : filtro.ver === 'fotos' && CRM.produtos ? CRM.produtos.telaFotos() : telaSaldo(linhas));
    },
    depois(c) {
      const b = c.querySelector('[data-es-busca]');
      if (b) b.addEventListener('input', () => { filtro.busca = b.value; CRM.render(); });
      const d = c.querySelector('[data-es-sodif]');
      if (d) d.addEventListener('change', () => { filtro.soDif = d.checked; CRM.render(); });
      const arq = c.querySelector('#esCompraArq');
      if (arq) arq.addEventListener('change', () => lerCompras(arq.files).catch(CRM.falhou));
      if (filtro.ver === 'fotos' && CRM.produtos) CRM.produtos.depoisFotos(c);
      const f = c.querySelector('[data-es-foto]');
      if (f) f.addEventListener('change', async () => { fotoVista = Number(f.value); difs = await CRM.store().estoqueDifs(fotoVista).catch(() => []); CRM.render(); });
    }
  };

  // a tela de fotos e fichas (produtos.js) abre daqui: Compras e estoque → Estoque → Fotos e fichas
  CRM.estoqueVer = ver => { CRM.estado.aba = 'estoque'; filtro.ver = ver; CRM.render(); };
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
    'es-sefaz': () => buscaSefaz(false),
    'es-dfe-conheco': doc => {
      const a = avisos(), g = a.desconhecidos.find(x => x.doc === doc);
      const forn = fknFornecedores();
      CRM.abrirForm({ titulo: 'Conheço este fornecedor', intro: (g ? g.nome + ' · ' : '') + 'CNPJ ' + doc + '. Diga de qual fornecedor do FKN é (se for um que já está lá).',
        campos: [{ nome: 'fornecedor_cod', rotulo: 'Fornecedor no FKN', tipo: 'select', largo: true, opcoes: [['', '— não está no FKN —']].concat(forn.map(f => [f.cod, f.nome + ' (' + f.cod + ')'])) },
          { nome: 'obs', rotulo: 'Observação', largo: true }],
        valores: { fornecedor_cod: g && g.sugestao ? g.sugestao.cod : '' },
        aoSalvar: async v => {
          await CRM.store().salvarFornecedorDoc({ doc, situacao: 'conhecido', fornecedor_cod: v.fornecedor_cod || null, nome: g ? g.nome : null, obs: v.obs || null });
          fornDocs = await CRM.store().fornecedorDocs().catch(() => fornDocs); CRM.toast('Fornecedor marcado como conhecido.'); CRM.render();
        } });
    },
    'es-dfe-naoreconheco': async doc => {
      const g = avisos().desconhecidos.find(x => x.doc === doc);
      if (!confirm('Marcar ' + ((g && g.nome) || doc) + ' como NÃO RECONHECIDO?\nAs notas dele entram no lembrete para responder Desconhecimento à Sefaz (o administrador responde; dá para fazer já pela lista "Só com o resumo").')) return;
      await CRM.store().salvarFornecedorDoc({ doc, situacao: 'desconhecido', nome: g ? g.nome : null });
      fornDocs = await CRM.store().fornecedorDocs().catch(() => fornDocs); CRM.toast('Marcado como não reconhecido.'); CRM.render();
    },
    'es-dfe-resp': async id => {
      const [chave, tipo] = String(id).split('|'), d = dfe.find(x => x.chave === chave);
      if (!d) return;
      const quem = (d.emitente_nome || '?') + ' · ' + R.moeda(d.valor) + ' · ' + R.dataBR(String(d.emitida_em).slice(0, 10));
      const manda = async just => {
        try { const r = await CRM.store().dfeManifestar(chave, tipo, just); CRM.toast(r && r.ok ? NOME_RESP[tipo] + ' registrado na Sefaz.' : 'A Sefaz recusou: ' + ((r && r.xMotivo) || 'sem motivo'), !(r && r.ok)); }
        catch (e) { CRM.falhou(e); }
        dfe = await CRM.store().dfe().catch(() => dfe); CRM.render();
      };
      if (tipo === 'nao_realizada') {
        CRM.abrirForm({ titulo: 'Operação não realizada', intro: quem + '. Use quando a compra foi combinada mas não aconteceu (mercadoria recusada, devolvida antes da entrada). Vai à Sefaz em nome da empresa e não tem volta.',
          campos: [{ nome: 'just', rotulo: 'Justificativa (15 a 255 letras)', tipo: 'textarea', obrigatorio: true, largo: true }],
          aoSalvar: async v => { if (String(v.just).trim().length < 15) throw new Error('a justificativa precisa de pelo menos 15 letras'); await manda(v.just); } });
        return;
      }
      const texto = tipo === 'confirmacao' ? 'CONFIRMAR à Sefaz que a compra aconteceu e a mercadoria chegou?' : 'Responder DESCONHECIMENTO à Sefaz (a empresa não reconhece esta nota)?';
      if (!confirm(texto + '\n\n' + quem + '\n\nVai à Sefaz em nome da empresa e não tem volta.')) return;
      await manda(null);
    },
    'es-sefaz-trazer': async () => { await trazDfe(false); CRM.render(); },
    'es-sefaz-ciencia-antigas': async () => {
      const ini = inicioEstoque(), l = ini ? dfe.filter(d => d.situacao === 'autorizada' && !d.xml_em && !d.manifestada_em && d.emitida_em && d.emitida_em < ini) : [];
      if (!l.length) return;
      if (!confirm('Dar a Ciência da Operação de ' + l.length + ' nota(s) emitidas antes de ' + quando(ini).slice(0, 5) + '?\n\n' +
        l.map(d => '· ' + (d.emitente_nome || '?') + ' (' + quando(d.emitida_em).slice(0, 5) + ', ' + R.moeda(d.valor) + ')').join('\n') +
        '\n\nÉ só o aviso à Sefaz de que a empresa sabe da nota (a mercadoria já está no estoque): não confirma nem recusa a compra.')) return;
      await ciencia(l.map(d => d.chave));
    },
    'es-sefaz-ciencia-uma': async chave => {
      const d = dfe.find(x => x.chave === chave); if (!d) return;
      if (!confirm('A mercadoria desta nota já chegou?\n\n' + (d.emitente_nome || '?') + ' · ' + quando(d.emitida_em).slice(0, 5) + ' · ' + R.moeda(d.valor) +
        '\n\nDar a Ciência da Operação (o aviso à Sefaz de que a empresa sabe da nota; não confirma nem recusa a compra). O XML vem na próxima consulta e a nota fica pendente para a entrada.')) return;
      await ciencia([chave]);
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
          intro: (pend ? 'Ligue cada item a um produto nosso e diga o fator (quantas unidades do nosso estoque vêm em 1 unidade da nota). "Não é estoque": frete, brinde, material de uso. Dar entrada soma no estoque do CRM; não lança nada no contas a pagar.'
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
      const desp = S.pareceDespesa(itensPend.filter(i => i.compra_id === id));
      CRM.abrirForm({
        titulo: 'Não é mercadoria: NF ' + c.numero + ' · ' + (c.fornecedor_nome || ''),
        intro: 'A nota sai da lista sem entrar no estoque e sem ir para o contas a pagar do CRM. Se for despesa (combustível, serviço), ela vai no Caixa: lance lá se ainda não lançou.' +
          (desp ? ' Pelos itens, parece ' + desp + '.' : ''),
        campos: [{ nome: 'motivo', rotulo: 'O que é', tipo: 'select', obrigatorio: true, opcoes: [['despesa', 'Despesa (combustível, serviço, manutenção)'], ['uso', 'Material de uso e consumo da empresa'],
          ['repetida', 'Nota repetida'], ['outro', 'Outro']] }, { nome: 'obs', rotulo: 'Observação', dica: 'ex.: abastecimento do caminhão (contrato com o posto)' }],
        valores: { motivo: desp ? 'despesa' : '', obs: desp === 'combustível' || desp === 'nota de cupom fiscal (posto)' ? 'abastecimento' : '' },
        salvarTexto: 'Tirar da lista',
        aoSalvar: async v => {
          const nome = { despesa: 'despesa', uso: 'material de uso', repetida: 'nota repetida', outro: 'outro' }[v.motivo] || v.motivo;
          await CRM.store().compraIgnorar(id, nome + (v.obs ? ': ' + v.obs : ''));
          compras = await CRM.store().compras(200); CRM.toast('Tirada da lista (' + nome + ').'); CRM.render();
        } });
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
