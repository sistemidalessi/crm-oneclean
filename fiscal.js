/* CRM Sistemi Dalessi — Fiscal: Fase 1 da saída do FKN (15/10/2026). A regra fiscal de cada produto (NCM,
   CEST, origem, CFOP, CST e alíquotas) nasce do que as notas autorizadas já usaram (crm_fiscal_itens, lido do
   XML) e passa por VERIFICAÇÕES: o que estiver errado no FKN não é copiado — a proposta já vem certa e o
   administrador confere (pedido do Anderson: "o que verificar de erro, a partir daqui já fazemos o certo").
   Parte pura no começo (testes/fiscal.test.js); a tela (aba Fiscal, só administrador) vem depois.
   Base legal das verificações (pesquisa de 15/10/2026; ver docs/plano-sair-do-fkn.md no sistemi-dalessi):
   - papel higiênico (NCM 4818.10.00): PIS/COFINS com alíquota zero na venda (Lei 10.925/2004, art. 1º, XXVIII,
     incluído pela Lei 12.839/2013) → CST 06;
   - Lucro Real: PIS/COFINS não cumulativos, 1,65% e 7,6%;
   - item com ICMS-ST (CFOP 5405): CST 60 (ou CSOSN 500) e CEST obrigatório; sem ST (5102), nunca CST 60. */
(function (raiz) {
  'use strict';

  const NCM_PAPEL_HIGIENICO = '48181000';
  const PIS_LUCRO_REAL = 1.65, COFINS_LUCRO_REAL = 7.6;
  const CST_ST = ['60', '500'];
  const n2 = v => (v == null || v === '' ? null : Math.round(Number(v) * 10000) / 10000);
  const ehVenda = cfop => /^5(1|4)/.test(String(cfop || ''));
  const ehST = cfop => /^54/.test(String(cfop || ''));
  const ehPapelHigienico = d => /\b(PAPEL|PAP\.?|P\.)\s*HIG/i.test(String(d || ''));
  const ehToalha = d => /\bTOALHA/i.test(String(d || ''));
  const fmtNcm = v => (/^\d{8}$/.test(String(v || '')) ? v.slice(0, 4) + '.' + v.slice(4, 6) + '.' + v.slice(6) : String(v || '—'));
  const dataBR = v => (v ? String(v).slice(8, 10) + '/' + String(v).slice(5, 7) + '/' + String(v).slice(0, 4) : '');

  // A combinação usada mais recentemente (empate: a mais frequente).
  const maisRecente = l => l.slice().sort((a, b) => String(b.ultima).localeCompare(String(a.ultima)) || (b.n || 0) - (a.n || 0))[0] || null;

  // Proposta de regra + alertas de um produto do resumo (public.crm_fiscal_resumo).
  // → { codigo, descricao, unidade, ncm, cest, gtin, origem, regra: { venda }, alertas: [{ nivel, texto, corrigido? }] }
  function analisa(r) {
    const alertas = [];
    const alerta = (nivel, texto, corrigido) => alertas.push(Object.assign({ nivel, texto }, corrigido ? { corrigido: true } : {}));
    const ncms = Object.keys(r.ncms || {}).map(k => Object.assign({ ncm: k }, r.ncms[k]));
    const combos = (r.combos || []).filter(c => c && c.cfop);
    const vendas = combos.filter(c => ehVenda(c.cfop));
    const atual = maisRecente(vendas) || maisRecente(combos);
    let ncm = (maisRecente(ncms) || {}).ncm || null;
    const venda = atual ? { cfop: atual.cfop, cst_icms: atual.cst_icms || null, aliq_icms: n2(atual.aliq_icms), red_bc_icms: n2(atual.red_bc_icms),
      cst_pis: atual.cst_pis || null, aliq_pis: n2(atual.aliq_pis), cst_cofins: atual.cst_cofins || null, aliq_cofins: n2(atual.aliq_cofins) } : null;

    // 1) NCM
    if (!ncm) alerta('erro', 'Sem NCM nas notas: preencher antes de emitir.');
    if (ncms.length > 1) {
      const hist = ncms.slice().sort((a, b) => String(a.primeira).localeCompare(String(b.primeira)))
        .map(x => fmtNcm(x.ncm) + ' (' + dataBR(x.primeira) + ' a ' + dataBR(x.ultima) + ', ' + x.n + ' vez(es))').join(' → ');
      alerta('atencao', 'O NCM mudou no histórico: ' + hist + '.');
    }
    if (ehPapelHigienico(r.descricao) && ncm !== NCM_PAPEL_HIGIENICO) {
      alerta('erro', 'Papel higiênico é NCM 4818.10.00, e as notas recentes usam ' + fmtNcm(ncm) + '. Proposta corrigida para 4818.10.00.', true);
      ncm = NCM_PAPEL_HIGIENICO;
    } else if (ehToalha(r.descricao) && ncm === NCM_PAPEL_HIGIENICO) {
      alerta('erro', 'Toalha com o NCM do papel higiênico (4818.10.00): costuma ser 4818.20 ou 4818.90. Conferir a classificação com o fornecedor.');
    }

    // 2) ICMS e ST
    if (venda) {
      if (ehST(venda.cfop) && CST_ST.indexOf(String(venda.cst_icms)) === -1)
        alerta('erro', 'Venda com ST (CFOP ' + venda.cfop + ') e CST de ICMS ' + (venda.cst_icms || 'vazio') + ': com ICMS-ST já recolhido o CST é 60.');
      if (!ehST(venda.cfop) && CST_ST.indexOf(String(venda.cst_icms)) !== -1)
        alerta('erro', 'CST de ICMS ' + venda.cst_icms + ' (ST já recolhido) com CFOP ' + venda.cfop + ', que é de venda sem ST: o CFOP certo seria 5405.');
      if (ehST(venda.cfop) && !(r.cests || []).length) alerta('erro', 'Item com ST sem CEST: o CEST é obrigatório na NF-e.');
    }
    const mesmasVendas = vendas.filter(c => venda && c.cfop === venda.cfop);
    const tribs = new Set(mesmasVendas.map(c => [c.cst_icms, n2(c.aliq_icms), c.cst_pis, n2(c.aliq_pis), c.cst_cofins, n2(c.aliq_cofins)].join('|')));
    if (tribs.size > 1) alerta('atencao', 'A tributação deste produto mudou no histórico (' + tribs.size + ' combinações com o CFOP ' + venda.cfop + '); a proposta usa a mais recente.');
    if ((r.gtins || []).length > 1) alerta('atencao', 'Mais de um código de barras (GTIN) nas notas: ' + r.gtins.join(', ') + '.');
    if ((r.origens || []).length > 1) alerta('atencao', 'Origem da mercadoria diferente entre as notas: ' + r.origens.join(', ') + '.');

    // 3) PIS/COFINS
    if (venda) {
      if (ncm === NCM_PAPEL_HIGIENICO && (venda.cst_pis !== '06' || venda.cst_cofins !== '06')) {
        alerta('erro', 'Papel higiênico tem PIS/COFINS com alíquota zero (Lei 10.925/2004, art. 1º, XXVIII). As notas saíram com CST ' +
          (venda.cst_pis || '—') + (n2(venda.aliq_pis) ? ' e ' + String(venda.aliq_pis).replace('.', ',') + '% de PIS' : '') +
          '. Proposta corrigida para CST 06 (alíquota zero). Se foi pago PIS/COFINS sobre estas vendas, dá para recuperar (até 5 anos): falar com o contador.', true);
        Object.assign(venda, { cst_pis: '06', aliq_pis: 0, cst_cofins: '06', aliq_cofins: 0 });
      } else if (venda.cst_pis === '01' && (n2(venda.aliq_pis) !== PIS_LUCRO_REAL || n2(venda.aliq_cofins) !== COFINS_LUCRO_REAL)) {
        alerta('erro', 'PIS/COFINS com ' + String(venda.aliq_pis).replace('.', ',') + '% e ' + String(venda.aliq_cofins).replace('.', ',') +
          '%: no Lucro Real (não cumulativo) é 1,65% e 7,6%. Proposta corrigida.', true);
        Object.assign(venda, { aliq_pis: PIS_LUCRO_REAL, aliq_cofins: COFINS_LUCRO_REAL });
      }
    }
    return { codigo: r.codigo, descricao: r.descricao || null, unidade: r.unidade || null, ncm, cest: (r.cests || []).length === 1 ? r.cests[0] : ((r.cests || [])[0] || null),
      gtin: (r.gtins || []).length === 1 ? r.gtins[0] : null, origem: (r.origens || []).length === 1 ? r.origens[0] : ((r.origens || [])[0] || null),
      regra: venda ? { venda } : {}, alertas, notas: r.notas || 0, ultima: r.ultima || null };
  }

  // Dados fiscais dos clientes que já compraram (para a NF-e): o que falta e o que está incoerente.
  // empresas: as da base; comNota: Set(empresa_id) com nota. → { total, completos, faltando: [{ empresa, falta: [...] }] }
  function clientes(empresas, comNota) {
    const out = { total: 0, completos: 0, faltando: [] };
    (empresas || []).filter(e => comNota.has(e.id)).forEach(e => {
      out.total++;
      const doc = String(e.cnpj || '').replace(/\D/g, ''), ind = String(e.ind_ie || ''), ie = String(e.ie || '').replace(/\D/g, '');
      const falta = [];
      if (doc.length !== 14 && doc.length !== 11) falta.push('CNPJ/CPF');
      if (!ind) falta.push('indicador da IE');
      if (ind === '1' && !ie) falta.push('IE (é contribuinte)');
      if (ind === '9' && ie) falta.push('tem IE mas está como não contribuinte');
      if (doc.length === 11 && ind === '1') falta.push('CPF marcado como contribuinte');
      if (!e.codigo_municipio) falta.push('código do município');
      if (!e.logradouro || !e.numero || !e.cep) falta.push('endereço');
      if (falta.length) out.faltando.push({ empresa: e, falta }); else out.completos++;
    });
    return out;
  }

  const api = { NCM_PAPEL_HIGIENICO, analisa, clientes, fmtNcm, ehVenda, ehST };
  raiz.CRMFiscal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ------------------------------------------------------------ tela (aba Fiscal, só administrador)
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, F = raiz.CRMFiscal, N = raiz.CRMNfe, R = raiz.CRMRegras;
  if (!CRM || !CRM.telas) return;
  const E = () => CRM.estado;
  const esc = CRM.esc;
  let produtos = null, pendentes = null, carregando = false, rodando = '', filtro = { busca: '', mostrar: 'erro' };
  const NIVEL = { erro: ['erro', 'vermelho'], atencao: ['atenção', 'ambar'] };
  const pct = v => (v == null ? '' : String(+Number(v).toFixed(2)).replace('.', ',') + '%');
  const nivelDe = p => (p.alertas || []).some(a => a.nivel === 'erro') ? 'erro' : (p.alertas || []).length ? 'atencao' : 'ok';

  async function carrega() {
    if (carregando) return;
    carregando = true;
    try { [produtos, pendentes] = await Promise.all([CRM.store().fiscalProdutos(), CRM.store().notasSemFiscal()]); }
    catch (e) { produtos = []; pendentes = []; CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }
  const andamento = t => { rodando = t; const el = document.getElementById('fiAndamento'); if (el) el.textContent = t; else CRM.render(); };

  // Lê do XML guardado a tributação das notas que ainda não foram lidas (6 downloads de cada vez).
  async function lerNotas() {
    const chaves = (await CRM.store().notasSemFiscal()).slice();
    const total = chaves.length;
    let feitas = 0, semXml = 0, gravadas = 0;
    andamento('Lendo 0 de ' + total + ' notas…');
    while (chaves.length) {
      const lote = chaves.splice(0, 30), docs = [];
      await Promise.all(Array.from({ length: 6 }, async () => {
        for (let c; (c = lote.shift());) {
          let xml = null;
          try { xml = await CRM.store().notaXml(c); } catch (e) { xml = null; }
          const d = xml ? N.lerXml(xml) : null;
          if (d && d.tipo === 'nota') docs.push(d); else semXml++;
          feitas++;
        }
      }));
      if (docs.length) gravadas += await CRM.store().fiscalGrava(N.loteFiscal(docs));
      andamento('Lendo ' + feitas + ' de ' + total + ' notas…');
    }
    return { total, gravadas, semXml };
  }

  // Proposta de cada produto pelo resumo das notas; o que já foi conferido mantém a regra (só os alertas mudam).
  async function montar() {
    andamento('Montando a regra de cada produto…');
    const resumo = await CRM.store().fiscalResumo();
    const atuais = new Map((produtos || []).map(p => [p.codigo, p]));
    const linhas = resumo.map(F.analisa).map(a => {
      const ja = atuais.get(a.codigo);
      const base = { codigo: a.codigo, descricao: a.descricao, unidade: a.unidade, alertas: a.alertas };
      return ja && ja.situacao === 'conferido' ? base : Object.assign(base, { ncm: a.ncm, cest: a.cest, gtin: a.gtin, origem: a.origem, regra: a.regra, situacao: 'proposta' });
    });
    await CRM.store().fiscalProdutosSalvar(linhas);
    produtos = await CRM.store().fiscalProdutos();
    return linhas.length;
  }

  function filtrados() {
    const q = R.normaliza(filtro.busca);
    return (produtos || []).filter(p => {
      if (q && R.normaliza(p.descricao + ' ' + p.codigo + ' ' + (p.ncm || '')).indexOf(q) === -1) return false;
      if (filtro.mostrar === 'conferido') return p.situacao === 'conferido';
      if (filtro.mostrar === 'todos') return true;
      return p.situacao !== 'conferido' && nivelDe(p) === filtro.mostrar;
    }).sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
  }

  function linha(p) {
    const v = (p.regra || {}).venda || {};
    const alertas = (p.alertas || []).map(a => '<li>' + CRM.selo(NIVEL[a.nivel][0], NIVEL[a.nivel][1]) + ' ' + esc(a.texto) + (a.corrigido ? ' <strong>(corrigido na proposta)</strong>' : '') + '</li>').join('');
    return '<tr><td><strong>' + esc(R.nomeDeItem(p.descricao || p.codigo)) + '</strong><small>' + esc(p.codigo) + (p.unidade ? ' · ' + esc(p.unidade) : '') + '</small>' +
      (alertas ? '<ul class="fi-alertas">' + alertas + '</ul>' : '') + '</td>' +
      '<td>' + esc(F.fmtNcm(p.ncm)) + (p.cest ? '<small>CEST ' + esc(p.cest) + '</small>' : '') + '</td><td>' + esc(p.origem == null ? '—' : p.origem) + '</td>' +
      '<td>' + esc(v.cfop || '—') + '</td><td>' + esc(v.cst_icms || '—') + (v.aliq_icms ? '<small>' + pct(v.aliq_icms) + '</small>' : '') + '</td>' +
      '<td>' + esc(v.cst_pis || '—') + '/' + esc(v.cst_cofins || '—') + (v.aliq_pis || v.aliq_cofins ? '<small>' + pct(v.aliq_pis) + ' + ' + pct(v.aliq_cofins) + '</small>' : '') + '</td>' +
      '<td>' + (p.situacao === 'conferido' ? CRM.selo('conferido', 'verde') : CRM.selo('proposta', 'cinza')) + '</td>' +
      '<td class="num"><button type="button" class="mini" data-acao="fi-editar" data-id="' + esc(p.codigo) + '" title="Ajustar a regra">✎</button>' +
      (p.situacao !== 'conferido' ? '<button type="button" class="mini" data-acao="fi-conferir" data-id="' + esc(p.codigo) + '">Conferido</button>' : '') + '</td></tr>';
  }

  CRM.telas.fiscal = {
    render() {
      if (!CRM.ehAdmin()) return '<div class="cartao"><p class="vazio">Esta tela é só do administrador.</p></div>';
      if (produtos === null) { setTimeout(carrega, 0); return '<div class="cartao"><p class="vazio">Carregando…</p></div>'; }
      const D = E().D;
      const notasValidas = (D.notas || []).filter(n => !n.cancelada).length;
      const cont = { erro: 0, atencao: 0, ok: 0, conferido: 0 };
      produtos.forEach(p => { if (p.situacao === 'conferido') cont.conferido++; else cont[nivelDe(p)]++; });
      const comNota = new Set((D.notas || []).filter(n => n.empresa_id && !n.cancelada).map(n => n.empresa_id));
      const cli = F.clientes(D.empresas, comNota);
      const l = filtrados();
      const kpi = (t, v, s, cls, mostrar) => '<button type="button" class="kpi clicavel ' + (cls || '') + (filtro.mostrar === mostrar ? ' ativo' : '') + '" data-acao="fi-mostrar" data-id="' + mostrar + '"><span>' + esc(t) + '</span><strong>' + v + '</strong><small>' + esc(s) + '</small></button>';
      return '<div class="cabecalho"><div><h1>Fiscal</h1><p class="sub">a regra fiscal de cada produto, tirada das notas que já saíram e conferida, e os dados fiscais dos clientes · Fase 1 da saída do FKN</p></div></div>' +
        (rodando ? '<div class="faixa alerta"><p id="fiAndamento">' + esc(rodando) + '</p></div>' : '') +
        '<section class="cartao"><h2>1. Tributação das notas <small>' + (notasValidas - pendentes.length) + ' de ' + notasValidas + ' notas lidas do XML</small></h2>' +
        (pendentes.length ? '<p>Faltam <strong>' + pendentes.length + '</strong> notas. A leitura usa os XML guardados no CRM e leva alguns minutos; pode continuar usando o CRM em outra aba.</p>' +
          '<p class="acoes"><button type="button" class="btn" data-acao="fi-ler"' + (rodando ? ' disabled' : '') + '>Ler a tributação das ' + pendentes.length + ' notas</button></p>'
          : '<p class="dica">Todas lidas. As notas novas (vigia e importação) já chegam com a tributação.</p>') + '</section>' +
        '<section class="cartao"><h2>2. Regra fiscal dos produtos <small>' + produtos.length + ' produtos</small></h2>' +
        '<p class="acoes"><button type="button" class="btn sec" data-acao="fi-montar"' + (rodando ? ' disabled' : '') + '>' + (produtos.length ? 'Atualizar as propostas' : 'Montar as propostas') + '</button>' +
          (cont.ok ? '<button type="button" class="btn sec" data-acao="fi-conferir-ok">Marcar os ' + cont.ok + ' sem alerta como conferidos</button>' : '') +
          (produtos.length ? '<button type="button" class="btn sec" data-acao="fi-csv">Exportar a tabela (para o contador)</button>' : '') + '</p>' +
        (produtos.length ? '<div class="kpis">' + kpi('Com erro', cont.erro, 'a proposta já vem corrigida quando dá', 'vermelho', 'erro') + kpi('Para olhar', cont.atencao, 'mudou no histórico ou diverge', '', 'atencao') +
          kpi('Sem alerta', cont.ok, 'prontos para conferir', '', 'ok') + kpi('Conferidos', cont.conferido, 'valem para emitir', 'verde', 'conferido') + kpi('Todos', produtos.length, 'produtos', '', 'todos') + '</div>' +
          '<p class="acoes"><input type="search" placeholder="Procurar produto, código ou NCM" value="' + esc(filtro.busca) + '" data-fi-busca class="of-busca"></p>' +
          (l.length ? '<div class="tabela-rolagem"><table class="tabela fi-tabela"><thead><tr><th>Produto</th><th>NCM</th><th>Origem</th><th>CFOP</th><th>ICMS</th><th>PIS/COFINS</th><th>Situação</th><th></th></tr></thead><tbody>' +
            l.slice(0, 300).map(linha).join('') + '</tbody></table></div>' + (l.length > 300 ? '<p class="dica">Mostrando 300 de ' + l.length + '; use a busca.</p>' : '')
            : '<p class="vazio">Nada aqui. 👍</p>')
          : '<p class="vazio">Depois de ler as notas, clique em "Montar as propostas".</p>') + '</section>' +
        '<section class="cartao"><h2>3. Clientes para a nota fiscal <small>' + cli.completos + ' de ' + cli.total + ' clientes com nota estão completos</small></h2>' +
        '<p class="dica">IE, indicador da IE e código do município vêm das notas já emitidas (só completam campo vazio). O que faltar: completar na ficha do cliente.</p>' +
        (cli.faltando.length ? '<details data-chave="fi-clientes"><summary>' + cli.faltando.length + ' cliente(s) com dado faltando</summary><ul class="lista">' +
          cli.faltando.slice(0, 150).map(x => '<li><button type="button" class="linha" data-acao="abrir-empresa" data-id="' + esc(x.empresa.id) + '"><strong>' + esc(x.empresa.nome) + '</strong><small>' + esc(x.falta.join(' · ')) + '</small></button></li>').join('') +
          '</ul></details>' : '<p class="vazio">Todos completos. 👍</p>') + '</section>';
    },
    depois(c) {
      const b = c.querySelector('[data-fi-busca]');
      if (b) b.addEventListener('input', () => { filtro.busca = b.value; CRM.render(); });
    }
  };

  const acha = cod => (produtos || []).find(p => p.codigo === cod);
  const quem = () => ({ conferido_por: CRM.meuId(), conferido_em: new Date().toISOString(), situacao: 'conferido' });
  Object.assign(CRM.acoes, {
    'fi-mostrar': id => { filtro.mostrar = id; CRM.render(); },
    'fi-ler': async () => {
      if (rodando) return;
      try {
        const r = await lerNotas();
        const n = await montar();
        pendentes = await CRM.store().notasSemFiscal();
        CRM.toast(r.gravadas + ' nota(s) lidas' + (r.semXml ? ', ' + r.semXml + ' sem XML guardado' : '') + '; ' + n + ' produtos com proposta.');
      } catch (e) { CRM.falhou(e); }
      rodando = ''; CRM.render();
    },
    'fi-montar': async () => {
      if (rodando) return;
      try { const n = await montar(); CRM.toast(n + ' produtos com proposta atualizada.'); } catch (e) { CRM.falhou(e); }
      rodando = ''; CRM.render();
    },
    'fi-conferir': async id => {
      const p = acha(id); if (!p) return;
      try { await CRM.store().fiscalProdutosSalvar([Object.assign({ codigo: id }, quem())]); Object.assign(p, quem()); CRM.render(); } catch (e) { CRM.falhou(e); }
    },
    'fi-conferir-ok': async () => {
      const l = (produtos || []).filter(p => p.situacao !== 'conferido' && nivelDe(p) === 'ok');
      if (!l.length || !confirm('Marcar ' + l.length + ' produtos sem alerta como conferidos? A regra deles passa a valer para emitir.')) return;
      try { await CRM.store().fiscalProdutosSalvar(l.map(p => Object.assign({ codigo: p.codigo }, quem()))); l.forEach(p => Object.assign(p, quem())); CRM.toast(l.length + ' produtos conferidos.'); CRM.render(); }
      catch (e) { CRM.falhou(e); }
    },
    'fi-editar': id => {
      const p = acha(id); if (!p) return;
      const v = (p.regra || {}).venda || {};
      const num = x => (x == null || x === '' ? null : Number(String(x).replace(',', '.')));
      CRM.abrirForm({
        titulo: 'Regra fiscal: ' + R.nomeDeItem(p.descricao || p.codigo), largura: 'largo',
        intro: (p.alertas || []).map(a => '• ' + a.texto).join(' ') || 'Sem alerta.',
        campos: [{ nome: 'ncm', rotulo: 'NCM (8 números)' }, { nome: 'cest', rotulo: 'CEST' }, { nome: 'gtin', rotulo: 'GTIN (código de barras)' },
          { nome: 'origem', rotulo: 'Origem (0 = nacional)' }, { nome: 'cfop', rotulo: 'CFOP de venda' }, { nome: 'cst_icms', rotulo: 'CST do ICMS' },
          { nome: 'aliq_icms', rotulo: 'Alíquota do ICMS (%)' }, { nome: 'cst_pis', rotulo: 'CST do PIS' }, { nome: 'aliq_pis', rotulo: 'Alíquota do PIS (%)' },
          { nome: 'cst_cofins', rotulo: 'CST da COFINS' }, { nome: 'aliq_cofins', rotulo: 'Alíquota da COFINS (%)' }],
        valores: { ncm: p.ncm || '', cest: p.cest || '', gtin: p.gtin || '', origem: p.origem == null ? '' : p.origem, cfop: v.cfop || '', cst_icms: v.cst_icms || '',
          aliq_icms: v.aliq_icms == null ? '' : v.aliq_icms, cst_pis: v.cst_pis || '', aliq_pis: v.aliq_pis == null ? '' : v.aliq_pis, cst_cofins: v.cst_cofins || '', aliq_cofins: v.aliq_cofins == null ? '' : v.aliq_cofins },
        salvarTexto: 'Salvar e marcar conferido',
        aoSalvar: async x => {
          const ncm = String(x.ncm || '').replace(/\D/g, '');
          if (ncm && ncm.length !== 8) throw new Error('o NCM tem 8 números');
          const venda = { cfop: String(x.cfop || '').replace(/\D/g, '') || null, cst_icms: x.cst_icms || null, aliq_icms: num(x.aliq_icms), red_bc_icms: v.red_bc_icms == null ? null : v.red_bc_icms,
            cst_pis: x.cst_pis || null, aliq_pis: num(x.aliq_pis), cst_cofins: x.cst_cofins || null, aliq_cofins: num(x.aliq_cofins) };
          const novo = Object.assign({ codigo: p.codigo, ncm: ncm || null, cest: String(x.cest || '').replace(/\D/g, '') || null, gtin: String(x.gtin || '').replace(/\D/g, '') || null,
            origem: x.origem === '' ? null : String(x.origem), regra: Object.assign({}, p.regra || {}, { venda }) }, quem());
          await CRM.store().fiscalProdutosSalvar([novo]);
          Object.assign(p, novo); CRM.toast('Regra salva e conferida.'); CRM.render();
        }
      });
    },
    'fi-csv': () => {
      const l = (produtos || []).slice().sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
      CRM.baixarCSV('regra-fiscal-produtos', ['Código', 'Produto', 'Unidade', 'NCM', 'CEST', 'Origem', 'CFOP venda', 'CST ICMS', 'Alíq. ICMS', 'CST PIS', 'Alíq. PIS', 'CST COFINS', 'Alíq. COFINS', 'Situação', 'Alertas'],
        l.map(p => { const v = (p.regra || {}).venda || {}; return [p.codigo, p.descricao, p.unidade || '', p.ncm || '', p.cest || '', p.origem == null ? '' : p.origem, v.cfop || '', v.cst_icms || '',
          v.aliq_icms == null ? '' : v.aliq_icms, v.cst_pis || '', v.aliq_pis == null ? '' : v.aliq_pis, v.cst_cofins || '', v.aliq_cofins == null ? '' : v.aliq_cofins, p.situacao,
          (p.alertas || []).map(a => a.texto).join(' | ')]; }));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
