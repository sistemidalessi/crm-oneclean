/* CRM Sistemi Dalessi — Fiscal: Fase 1 da saída do FKN (15/10/2026). A regra fiscal de cada produto (NCM,
   CEST, origem, CFOP, CST e alíquotas) nasce do que as notas autorizadas já usaram (crm_fiscal_itens, lido do
   XML) e passa por VERIFICAÇÕES: o que estiver errado no FKN não é copiado — a proposta já vem certa e o
   administrador confere (pedido do Anderson: "o que verificar de erro, a partir daqui já fazemos o certo").
   Parte pura no começo (testes/fiscal.test.js); a tela (aba Fiscal, só administrador) vem depois.
   Base legal das verificações (pesquisa de 15/10/2026; ver docs/plano-sair-do-fkn.md no sistemi-dalessi):
   - papel higiênico (NCM 4818.10.00): PIS/COFINS com alíquota zero na venda (Lei 10.925/2004, art. 1º, XXVIII,
     incluído pela Lei 12.839/2013) → CST 06;
   - Lucro Real: PIS/COFINS não cumulativos, 1,65% e 7,6%;
   - item com ICMS-ST (CFOP 5405): CST 60 (ou CSOSN 500) e CEST obrigatório; sem ST (5102), nunca CST 60;
   - produtos de limpeza FORA da ST em SP desde 01/08/2026: a Portaria SRE 20/2026 (DOE 05/05/2026) revogou o
     Anexo XIII da Portaria CAT 68/2019 (e a SRE 55/2025, base de cálculo). Venda interna volta a ser 5102, CST 00,
     18% (alíquota interna geral). Estoque de 31/07/2026: Portaria CAT 28/2020 (com o contador);
   - perfumaria e higiene pessoal (Anexo XI, com o papel higiênico) FORA da ST desde 01/04/2026 (Portaria SRE 94/2025) e
     papelaria e papel desde 01/07/2026 (Portaria SRE 9/2026): mesma correção (19/10/2026; ver FORA_ST_SP). */
(function (raiz) {
  'use strict';

  const NCM_PAPEL_HIGIENICO = '48181000';
  const PIS_LUCRO_REAL = 1.65, COFINS_LUCRO_REAL = 7.6;
  const CST_ST = ['60', '500'];
  // Antigo Anexo XIII da Portaria CAT 68/2019 (produtos de limpeza), revogado pela Portaria SRE 20/2026 a partir de
  // 01/08/2026. Reconhecido pelo CEST do segmento 11 (produtos de limpeza no Convênio ICMS 142/2018, o mesmo do anexo)
  // ou pelo NCM. A lista de NCM abaixo é a que deu para confirmar em 15/10/2026 sem o texto oficial (a rede da sessão
  // barra o site da Sefaz): itens 11.001 (2828.90.11/19, 3206.41.00, 3402.20.00 / 3402.50.00, 3808.94.19), 11.002 e
  // 11.003 (3401.20.90, 3808.94.19) e 11.007 (posição 3402 inteira). Conferir com o texto consolidado
  // (https://legislacao.fazenda.sp.gov.br/paginas/Portaria-CAT-68-de-2019.aspx) ou o contador e completar aqui.
  const LIMPEZA_FORA_ST_SP = {
    desde: '2026-08-01',
    cestSegmento: '11',
    ncmPrefixos: ['28289011', '28289019', '32064100', '34012090', '3402', '38089419']
  };
  // Grupos de produtos que saíram da ST em SP (anexos da Portaria CAT 68/2019 revogados), na ordem em que o NCM é
  // procurado (a limpeza primeiro: 3401.20.90 é sabão de limpeza, o resto da 3401 é sabonete). Datas e CEST tirados de
  // fontes secundárias em 15 e 19/10/2026 (o texto oficial não foi lido: a rede da sessão barra o site da Sefaz-SP) —
  // conferir com o contador. Ver docs/legislacao/registro.md.
  // - limpeza: o CEST do segmento 11 basta, como sempre foi (a lista de NCM é que está incompleta).
  // - higiene e papel: o produto entra pelo NCM. CEST do segmento com NCM fora da lista (ex.: mexedor de café
  //   3924.10.00 com CEST 20.062.00; gel clarificante 2827.32.00 com CEST 20.044.00 — o cadastro do FKN tem desses)
  //   NÃO corrige sozinho: vira o alerta "CEST incoerente com o NCM: conferir".
  // - papel higiênico (4818.10.00; CEST 20.042.00 folha simples e 20.043.00 folha dupla ou mais) estava no Anexo XI:
  //   01/04/2026. Toalha e interfolha de papel (4818.20.00, CEST 20.044.00): não se confirmou se estavam no Anexo XI
  //   (01/04) ou no de papel (01/07); fica 01/07, a data em que os dois anexos já estavam revogados, com o aviso.
  const FORA_ST_SP = [
    Object.assign({ id: 'limpeza', nome: 'Produto de limpeza', norma: 'Portaria SRE 20/2026', anexo: 'o Anexo XIII', cestSoBasta: true,
      cestSegmentos: [LIMPEZA_FORA_ST_SP.cestSegmento] }, LIMPEZA_FORA_ST_SP),
    { id: 'higiene', nome: 'Produto de higiene pessoal', desde: '2026-04-01', norma: 'Portaria SRE 94/2025', anexo: 'o Anexo XI (perfumaria e higiene pessoal)',
      cestSegmentos: ['20'], ncmPrefixos: ['48181000', '33', '3401', '4014100', '5601210', '82121', '960321', '9619'] },
    { id: 'papel', nome: 'Papel e papelaria', desde: '2026-07-01', norma: 'Portaria SRE 9/2026', anexo: 'o anexo de papelaria e papel',
      cestSegmentos: ['19'], ncmPrefixos: ['48', '3926100', '8214100', '8305', '9608', '9609', '9610', '9611'] }
  ];
  const ALIQ_ICMS_SP = 18;
  const segmentoCest = c => String(c || '').replace(/\D/g, '').slice(0, 2);
  const ncmNoGrupo = (g, ncm) => !!ncm && g.ncmPrefixos.some(p => String(ncm).indexOf(p) === 0);
  const cestNoGrupo = (g, cests) => (cests || []).some(c => g.cestSegmentos.indexOf(segmentoCest(c)) !== -1);
  const ehLimpezaForaST = (ncm, cests) => cestNoGrupo(FORA_ST_SP[0], cests) || ncmNoGrupo(FORA_ST_SP[0], ncm);
  // Em que grupo fora da ST o produto está. → { grupo, cestIncoerente } (grupo nulo: fora das listas). cestIncoerente:
  // o grupo que o CEST indica quando o NCM não confirma (não corrige; só alerta).
  function grupoForaST(ncms, cests) {
    const lista = (ncms || []).filter(Boolean);
    if (cestNoGrupo(FORA_ST_SP[0], cests) || lista.some(n => ncmNoGrupo(FORA_ST_SP[0], n))) return { grupo: FORA_ST_SP[0], cestIncoerente: null };
    const pelaNcm = FORA_ST_SP.find(g => lista.some(n => ncmNoGrupo(g, n)));
    if (pelaNcm) return { grupo: pelaNcm, cestIncoerente: null };
    const pelaCest = FORA_ST_SP.find(g => cestNoGrupo(g, cests));
    if (pelaCest && pelaCest.cestSoBasta) return { grupo: pelaCest, cestIncoerente: null };
    return { grupo: null, cestIncoerente: pelaCest || null };
  }
  const n2 = v => (v == null || v === '' ? null : Math.round(Number(v) * 10000) / 10000);
  // Venda comum dentro de SP: 5101 a 5106 (sem ST) e 5401 a 5405 (com ST). Fora: 5117/5922 (entrega futura), 5910
  // (bonificação), 6xxx (outro estado) — a regra do produto é a da venda interna, as outras operações saem dela.
  const ehVenda = cfop => /^5(10[1-6]|40[1-5])$/.test(String(cfop || ''));
  const ehST = cfop => /^54/.test(String(cfop || ''));
  // Só o próprio papel: a descrição começa por "PAPEL HIG…"/"PAP. HIG…"/"P.HIG…". Dispenser, suporte e papeleira
  // ("DISP.PAPEL HIG.", "SUP. PAPELEIRA … PAP.HIG") são de plástico/inox e têm outro NCM e PIS/COFINS normal.
  const ehPapelHigienico = d => /^\s*(PAPEL|PAP\.?|P\.)\s*HIG/i.test(String(d || ''));
  const ehToalha = d => /\bTOALHA/i.test(String(d || ''));
  const fmtNcm = v => (/^\d{8}$/.test(String(v || '')) ? v.slice(0, 4) + '.' + v.slice(4, 6) + '.' + v.slice(6) : String(v || '—'));
  const dataBR = v => (v ? String(v).slice(8, 10) + '/' + String(v).slice(5, 7) + '/' + String(v).slice(0, 4) : '');
  const fmtCest = v => { const d = String(v || '').replace(/\D/g, ''); return d.length === 7 ? d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5) : String(v || '—'); };
  const vespera = d => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };

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
    // Sem venda interna no histórico (só para fora de SP, entrega futura, bonificação…): a proposta vira a venda interna
    // equivalente, com o ICMS de SP; o PIS/COFINS vem de uma operação que tenha receita (49 não é venda).
    if (venda && !ehVenda(venda.cfop)) {
      const de = venda.cfop, st = CST_ST.indexOf(String(venda.cst_icms)) !== -1 || /^(54|64)/.test(String(de));
      Object.assign(venda, st ? { cfop: '5405', cst_icms: '60', aliq_icms: null, red_bc_icms: null } : { cfop: '5102', cst_icms: '00', aliq_icms: ALIQ_ICMS_SP, red_bc_icms: null });
      if (String(venda.cst_pis) === '49' || String(venda.cst_cofins) === '49') {
        const comReceita = maisRecente(combos.filter(c => String(c.cst_pis || '') !== '49' && String(c.cst_cofins || '') !== '49'));
        Object.assign(venda, comReceita ? { cst_pis: comReceita.cst_pis || null, aliq_pis: n2(comReceita.aliq_pis), cst_cofins: comReceita.cst_cofins || null, aliq_cofins: n2(comReceita.aliq_cofins) }
          : { cst_pis: '01', aliq_pis: 1.65, cst_cofins: '01', aliq_cofins: 7.6 });
      }
      alerta('erro', 'As notas deste produto não têm venda comum dentro de SP (a mais recente é CFOP ' + de + '). Proposta corrigida para a venda interna: CFOP ' +
        venda.cfop + ', CST ' + venda.cst_icms + (venda.aliq_icms != null ? ' e ICMS de ' + venda.aliq_icms + '%' : '') + '; conferir o PIS/COFINS.', true);
    }

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
    const comST = c => ehST(c.cfop) || CST_ST.indexOf(String(c.cst_icms)) !== -1;
    const { grupo, cestIncoerente } = grupoForaST([ncm].concat(ncms.map(x => x.ncm)), r.cests);
    let foraSTCorrigida = false;
    if (venda && grupo) {
      const desde = dataBR(grupo.desde);
      const stDepois = vendas.filter(c => comST(c) && String(c.ultima || '') >= grupo.desde)
        .sort((a, b) => String(b.ultima).localeCompare(String(a.ultima)))[0];
      const depois = stDepois ? ' O FKN ainda emitiu com ST depois de ' + desde + ' (última em ' + dataBR(stDepois.ultima) +
        '): as notas desde então merecem conferência com o contador. O estoque de ' + dataBR(vespera(grupo.desde)) + ' segue a Portaria CAT 28/2020.' : '';
      const toalha = grupo.id === 'papel' && (/^4818/.test(String(ncm || '')) || (r.cests || []).some(c => segmentoCest(c) === '20'))
        ? ' Toalha e interfolha de papel (CEST 20.044.00) podem ter saído da ST já em 01/04/2026, se estavam no Anexo XI: conferir com o contador.' : '';
      if (comST(venda)) {
        alerta('erro', grupo.nome + ' saiu da substituição tributária em SP a partir de ' + desde + ' (' + grupo.norma + ' revogou ' + grupo.anexo +
          ' da Portaria CAT 68/2019), e as notas usam CFOP ' + venda.cfop + ' e CST ' + (venda.cst_icms || 'vazio') +
          '. Proposta corrigida para CFOP 5102, CST 00 e ICMS de 18%; o CEST deixa de ser obrigatório.' + depois + toalha, true);
        Object.assign(venda, { cfop: '5102', cst_icms: '00', aliq_icms: ALIQ_ICMS_SP, red_bc_icms: null });
        foraSTCorrigida = true;
      } else if (stDepois) {
        alerta('atencao', grupo.nome + ' (fora da ST em SP desde ' + desde + ', ' + grupo.norma + ').' + depois + toalha);
      }
    } else if (venda && cestIncoerente && vendas.some(c => comST(c) && String(c.ultima || '') >= cestIncoerente.desde)) {
      const cest = (r.cests || []).find(c => cestIncoerente.cestSegmentos.indexOf(segmentoCest(c)) !== -1);
      alerta('atencao', 'CEST incoerente com o NCM: conferir. O CEST ' + fmtCest(cest) + ' é de ' + cestIncoerente.nome.toLowerCase() +
        ' (fora da ST em SP desde ' + dataBR(cestIncoerente.desde) + ', ' + cestIncoerente.norma + '), mas o NCM ' + fmtNcm(ncm) +
        ' não é desse grupo. A proposta segue as notas até o contador dizer se o produto ainda tem ST; corrigir o CEST ou o NCM no cadastro.');
    }
    if (venda && !foraSTCorrigida) {
      if (ehST(venda.cfop) && CST_ST.indexOf(String(venda.cst_icms)) === -1)
        alerta('erro', 'Venda com ST (CFOP ' + venda.cfop + ') e CST de ICMS ' + (venda.cst_icms || 'vazio') + ': com ICMS-ST já recolhido o CST é 60.');
      if (!ehST(venda.cfop) && CST_ST.indexOf(String(venda.cst_icms)) !== -1)
        alerta('erro', 'CST de ICMS ' + venda.cst_icms + ' (ST já recolhido) com CFOP ' + venda.cfop + ', que é de venda sem ST: o CFOP certo seria 5405.');
      if (ehST(venda.cfop) && !(r.cests || []).length) alerta('erro', 'Item com ST sem CEST: o CEST é obrigatório na NF-e.');
    }
    const mesmasVendas = vendas.filter(c => venda && c.cfop === venda.cfop);
    const tribs = new Set(mesmasVendas.map(c => [c.cst_icms, n2(c.aliq_icms), c.cst_pis, n2(c.aliq_pis), c.cst_cofins, n2(c.aliq_cofins)].join('|')));
    // informação, não pendência (23/10/2026, Anderson: a lista de avisos "atrapalhava tudo"): a proposta já usa a mais recente
    if (tribs.size > 1) alerta('info', 'A tributação deste produto mudou no histórico (' + tribs.size + ' combinações com o CFOP ' + venda.cfop + '); a proposta usa a mais recente.');
    if ((r.gtins || []).length > 1) alerta('info', 'Mais de um código de barras (GTIN) nas notas: ' + r.gtins.join(', ') + '.');
    if ((r.origens || []).length > 1) alerta('atencao', 'Origem da mercadoria diferente entre as notas: ' + r.origens.join(', ') + '.');

    // 3) PIS/COFINS
    if (venda) {
      if (ncm === NCM_PAPEL_HIGIENICO && (venda.cst_pis !== '06' || venda.cst_cofins !== '06')) {
        alerta('erro', 'Papel higiênico tem PIS/COFINS com alíquota zero (Lei 10.925/2004, art. 1º, XXVIII). As notas saíram com CST ' +
          (venda.cst_pis || '—') + (n2(venda.aliq_pis) ? ' e ' + String(venda.aliq_pis).replace('.', ',') + '% de PIS' : '') +
          '. Proposta corrigida para CST 06 (alíquota zero). Se foi pago PIS/COFINS sobre estas vendas, dá para recuperar (até 5 anos): falar com o contador.', true);
        Object.assign(venda, { cst_pis: '06', aliq_pis: 0, cst_cofins: '06', aliq_cofins: 0 });
      } else if (ncm === NCM_PAPEL_HIGIENICO) {
        // a regra atual está certa, mas vendas antigas podem ter saído com PIS/COFINS cobrado
        const cobradas = vendas.filter(c => c.cst_pis === '01' || c.cst_cofins === '01');
        if (cobradas.length) {
          const de = cobradas.map(c => c.primeira).sort()[0], ate = cobradas.map(c => c.ultima).sort().pop();
          alerta('info', 'Papel higiênico com PIS/COFINS cobrado (CST 01) em ' + cobradas.reduce((s, c) => s + (c.n || 0), 0) + ' venda(s), de ' +
            dataBR(de) + ' a ' + dataBR(ate) + '. A regra atual (CST 06, alíquota zero) está certa; se foi pago, dá para recuperar (até 5 anos): falar com o contador.');
        }
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
      const doc = String(e.cnpj || '').toUpperCase().replace(/[^0-9A-Z]/g, ''), ind = String(e.ind_ie || ''), ie = String(e.ie || '').replace(/\D/g, '');
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

  // ICMS-ST "retido anteriormente" pela nota de ENTRADA (19/10/2026, pedido do Anderson: "seguir o que é correto perante a
  // lei"). Na revenda com CST 60 a NF-e informa a base, a alíquota, o ICMS próprio do substituto e o ICMS-ST que vieram na
  // compra da mercadoria, proporcionais à quantidade vendida; usa-se a entrada MAIS RECENTE de cada produto (o mesmo
  // critério da Portaria CAT 42/2018 de SP para o ressarcimento; conferir com o contador). O que se aprendia das notas
  // do FKN fica só para o produto que ainda não tem nota de compra no CRM.
  // linhas: itens de crm_compra_itens com a compra (emitida_em, numero, fornecedor_doc, fornecedor_nome) e os campos st_*.
  // ctx: { vinculos: Map('doc|cod' → {codigo, fator}), porGtin: Map(gtin → {codigo, unidade}), unidadeBase: Map(codigo → un),
  //        caixas: Map(codigo → [{ unidade, fator }]) }.
  // → { produtos: { codigo: { situacao: 'com_st'|'sem_valor'|'sem_st', cst, nota, fornecedor, quando, st_ret: { UN: {...} } } },
  //     semLigacao: [{ fornecedor, cod_fornecedor, descricao }] }
  const unNorm = t => String(t || '').trim().toUpperCase().replace(/Ç/g, 'C');
  const r6 = v => Math.round(v * 1e6) / 1e6;
  function stDasCompras(linhas, ctx) {
    ctx = ctx || {};
    const ultimo = {}, semLigacao = [];
    (linhas || []).forEach(l => {
      if (!l || !l.st_cst) return;            // item gravado antes da leitura do ICMS-ST
      let codigo = l.codigo || null, fator = Number(l.fator) || 0;
      if (!codigo) {
        const v = ctx.vinculos && ctx.vinculos.get(l.fornecedor_doc + '|' + l.cod_fornecedor);
        if (v) { codigo = v.codigo; fator = Number(v.fator) || 0; }
      }
      if (!codigo && l.ean && ctx.porGtin) {   // mesmo código de barras e a mesma unidade: fator 1
        const p = ctx.porGtin.get(String(l.ean));
        if (p && unNorm(p.unidade) === unNorm(l.unidade)) { codigo = p.codigo; fator = 1; }
      }
      const q = (Number(l.quantidade) || 0) * fator;
      if (!codigo || !(q > 0)) { semLigacao.push({ fornecedor: l.fornecedor_nome || l.fornecedor_doc, cod_fornecedor: l.cod_fornecedor, descricao: l.descricao }); return; }
      const ja = ultimo[codigo], chave = String(l.emitida_em || '') + '|' + String(l.numero || '').padStart(12, '0');
      if (ja && ja._chave >= chave) return;
      ultimo[codigo] = Object.assign({}, l, { codigo, q, _chave: chave });
    });
    const produtos = {};
    Object.keys(ultimo).forEach(codigo => {
      const l = ultimo[codigo], base = { cst: l.st_cst, nota: l.numero == null ? null : String(l.numero), fornecedor: l.fornecedor_nome || l.fornecedor_doc || null, quando: l.emitida_em || null };
      const temST = l.st_valor != null || l.st_base != null;
      const ehST = /^(10|30|60|70|90|201|202|203|500|900)$/.test(String(l.st_cst));
      if (!ehST) { produtos[codigo] = Object.assign({ situacao: 'sem_st' }, base); return; }
      if (!temST) { produtos[codigo] = Object.assign({ situacao: 'sem_valor' }, base); return; }
      const por = (v, f) => (v == null ? null : r6(Number(v) / l.q * f));
      const unidade = (f) => ({ vBCSTRet: por(l.st_base, f) || 0, pST: Number(l.st_aliq) || 0, vICMSSubstituto: por(l.st_proprio, f), vICMSSTRet: por(l.st_valor, f) || 0,
        origem: 'compra', nota: base.nota, fornecedor: base.fornecedor, quando: base.quando });
      const st_ret = {};
      const ub = unNorm((ctx.unidadeBase && ctx.unidadeBase.get(codigo)) || l.unidade || 'UN');
      st_ret[ub] = unidade(1);
      ((ctx.caixas && ctx.caixas.get(codigo)) || []).forEach(c => { const u = unNorm(c.unidade); if (u && u !== ub && Number(c.fator) > 0) st_ret[u] = unidade(Number(c.fator)); });
      produtos[codigo] = Object.assign({ situacao: 'com_st', st_ret }, base);
    });
    return { produtos, semLigacao };
  }
  // Alerta da proposta pela última compra: vendemos com ST (5405/CST 60), mas a última compra veio SEM ST, ou com ST e sem
  // os valores. regra.st_entrada = { situacao, cst, nota, fornecedor, quando } (gravado por stDasCompras).
  function alertaEntrada(regra) {
    const e = regra && regra.st_entrada, v = regra && regra.venda;
    if (!e || !v || !(ehST(v.cfop) || CST_ST.indexOf(String(v.cst_icms)) !== -1)) return null;
    const de = ' (NF ' + (e.nota || '?') + (e.fornecedor ? ' de ' + e.fornecedor : '') + (e.quando ? ', ' + dataBR(String(e.quando).slice(0, 10)) : '') + ')';
    if (e.situacao === 'sem_st') return { nivel: 'erro', texto: 'Vendido com ICMS-ST (CFOP ' + v.cfop + ', CST ' + (v.cst_icms || '—') + '), mas a última compra' + de +
      ' veio sem ST (CST ' + (e.cst || '—') + '): não há ICMS-ST retido para repassar. O produto pode ter saído da ST ou a compra veio errada; conferir com o contador.' };
    if (e.situacao === 'sem_valor') return { nivel: 'atencao', texto: 'A última compra' + de + ' veio com ST (CST ' + e.cst + ') mas sem os valores do ICMS-ST retido: pedir ao fornecedor ou conferir com o contador.' };
    return null;
  }

  const api = { NCM_PAPEL_HIGIENICO, LIMPEZA_FORA_ST_SP, FORA_ST_SP, ehLimpezaForaST, grupoForaST, stDasCompras, alertaEntrada, analisa, clientes, fmtNcm, ehVenda, ehST };
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
  const NIVEL = { erro: ['erro', 'vermelho'], atencao: ['atenção', 'ambar'], info: ['informação', 'cinza'] };
  // Só conta o que pede ação: o que já foi corrigido na proposta e o informativo vão para o "histórico" do produto.
  const pendente = a => a && !a.corrigido && (a.nivel === 'erro' || a.nivel === 'atencao');
  const pct = v => (v == null ? '' : String(+Number(v).toFixed(2)).replace('.', ',') + '%');
  const nivelDe = p => { const l = (p.alertas || []).filter(pendente); return l.some(a => a.nivel === 'erro') ? 'erro' : l.length ? 'atencao' : 'ok'; };

  async function carrega() {
    if (carregando) return;
    carregando = true;
    try { [produtos, pendentes] = await Promise.all([CRM.store().fiscalProdutos(), CRM.store().notasSemFiscal()]); }
    catch (e) { produtos = []; pendentes = []; CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }
  const andamento = t => { rodando = t; const el = document.getElementById('fiAndamento'); if (el) el.textContent = t; else CRM.render(); };

  // ICMS-ST pela nota de compra mais recente (19/10/2026): grava regra.st_ret[unidade] (origem 'compra', passa por cima do
  // aprendido do FKN) e regra.st_entrada (o que a última compra trouxe), com o alerta de "vendido com ST e comprado sem".
  // Notas de compra gravadas antes da leitura do ICMS-ST: relê o XML guardado e completa os itens (só o vazio).
  async function completarStDasCompras(st) {
    const chaves = (await st.comprasSemSt()).slice(), lista = [];
    let semXml = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let c; (c = chaves.shift());) {
        let xml = null;
        try { xml = await st.dfeXml(c); } catch (e) { xml = null; }
        if (!xml) { semXml++; continue; }
        raiz.CRMEstoque.extrasDoXml(xml).forEach((x, ordem) => {
          if (x.st_cst) lista.push({ chave: c, ordem, st_cst: x.st_cst, st_base: x.st_base, st_aliq: x.st_aliq, st_proprio: x.st_proprio, st_valor: x.st_valor });
        });
      }
    }));
    let n = 0;
    for (let i = 0; i < lista.length; i += 500) n += (await st.compraItensSt(lista.slice(i, i + 500))) || 0;
    return { completados: n, semXml };
  }
  async function aprenderDasCompras() {
    const st = CRM.store();
    const comp = await completarStDasCompras(st);
    const [linhas, vinc, unid, est, prods] = await Promise.all([st.comprasSt(), st.compraVinculos().catch(() => []), st.estoqueUnidades().catch(() => []),
      st.estoque().catch(() => []), st.fiscalProdutos()]);
    const base = c => String(c || '').replace(/\.\d+$/, '');
    const ctx = { vinculos: new Map((vinc || []).map(v => [v.fornecedor_doc + '|' + v.cod_fornecedor, v])), porGtin: new Map(), unidadeBase: new Map(), caixas: new Map() };
    (prods || []).forEach(p => { if (p.gtin) ctx.porGtin.set(String(p.gtin), { codigo: p.codigo, unidade: p.unidade }); if (p.unidade) ctx.unidadeBase.set(p.codigo, p.unidade); });
    (est || []).forEach(e => { if (e.codigo === base(e.codigo) && e.unidade) ctx.unidadeBase.set(e.codigo, e.unidade); });
    (unid || []).forEach(u => { const l = ctx.caixas.get(u.codigo) || []; l.push(u); ctx.caixas.set(u.codigo, l); });
    const r = F.stDasCompras(linhas, ctx), porCod = new Map((prods || []).map(p => [p.codigo, p]));
    const DO_ENTRADA = /^(Vendido com ICMS-ST \(|A última compra )/;
    const salvar = [], cont = { com_st: 0, sem_st: 0, sem_valor: 0, semCadastro: 0 };
    Object.keys(r.produtos).forEach(cod => {
      const x = r.produtos[cod], p = porCod.get(cod);
      if (!p) { cont.semCadastro++; return; }
      cont[x.situacao]++;
      const regra = Object.assign({}, p.regra || {}, { st_entrada: { situacao: x.situacao, cst: x.cst, nota: x.nota, fornecedor: x.fornecedor, quando: x.quando } });
      if (x.st_ret) regra.st_ret = Object.assign({}, regra.st_ret || {}, x.st_ret);
      const ae = F.alertaEntrada(regra);
      const alertas = (p.alertas || []).filter(a => !DO_ENTRADA.test(a.texto || '')).concat(ae ? [ae] : []);
      salvar.push({ codigo: cod, regra, alertas });
    });
    for (let i = 0; i < salvar.length; i += 200) await st.fiscalProdutosSalvar(salvar.slice(i, i + 200));
    produtos = null;
    return Object.assign(cont, { itens: (linhas || []).length, semLigacao: r.semLigacao.length, completados: comp.completados, semXml: comp.semXml });
  }
  CRM.fiscalSt = { aprenderDasCompras };

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
      // o ICMS-ST aprendido (regra.st_ret das notas de compra ou do FKN, e regra.st_entrada da última compra; emissao.js)
      // não se perde ao refazer a proposta
      const guarda = {};
      ['st_ret', 'st_entrada'].forEach(k => { if (ja && ja.regra && ja.regra[k]) guarda[k] = ja.regra[k]; });
      const regra = Object.assign({}, a.regra, guarda);
      const ae = F.alertaEntrada(ja && ja.situacao === 'conferido' ? Object.assign({}, ja.regra, guarda) : regra);
      if (ae) base.alertas = base.alertas.concat([ae]);
      // regra revista à mão (regra.revista: data da revisão por NCM, docs/oneclean/fiscal) não volta ao que o FKN fazia
      if (ja && ja.situacao !== 'conferido' && ja.regra && ja.regra.revista) return Object.assign(base, { alertas: ja.alertas || [] });
      return ja && ja.situacao === 'conferido' ? base : Object.assign(base, { ncm: a.ncm, cest: a.cest, gtin: a.gtin, origem: a.origem, regra, situacao: 'proposta' });
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
    const item = a => '<li>' + CRM.selo((NIVEL[a.nivel] || NIVEL.info)[0], (NIVEL[a.nivel] || NIVEL.info)[1]) + ' ' + esc(a.texto) + (a.corrigido ? ' <strong>(corrigido na proposta)</strong>' : '') + '</li>';
    const ativos = (p.alertas || []).filter(pendente), hist = (p.alertas || []).filter(a => !pendente(a));
    return '<tr><td><strong>' + esc(R.nomeDeItem(p.descricao || p.codigo)) + '</strong><small>' + esc(p.codigo) + (p.unidade ? ' · ' + esc(p.unidade) : '') + '</small>' +
      (ativos.length ? '<ul class="fi-alertas">' + ativos.map(item).join('') + '</ul>' : '') +
      (hist.length ? '<details class="fi-hist"><summary>histórico (' + hist.length + ')</summary><ul class="fi-alertas">' + hist.map(item).join('') + '</ul></details>' : '') + '</td>' +
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
        (produtos.length ? '<div class="kpis">' + kpi('Com erro', cont.erro, 'precisa de ação (o já corrigido fica no histórico)', 'vermelho', 'erro') + kpi('Para olhar', cont.atencao, 'CEST, NCM que mudou, regra a conferir', '', 'atencao') +
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
          '</ul></details>' : '<p class="vazio">Todos completos. 👍</p>') + '</section>' + (CRM.nfe ? CRM.nfe.secaoFiscal() : '');
    },
    depois(c) {
      if (CRM.nfe) CRM.nfe.depois(c);
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
          { nome: 'aliq_icms', rotulo: 'Alíquota do ICMS (%)' }, { nome: 'red_bc_icms', rotulo: 'Redução da base do ICMS (%, só no CST 20)' },
          { nome: 'cbenef', rotulo: 'Código de benefício (cBenef, ex.: SP020030)' }, { nome: 'extipi', rotulo: 'Ex da TIPI (só se o NCM tiver exceção)' }, { nome: 'cst_pis', rotulo: 'CST do PIS' }, { nome: 'aliq_pis', rotulo: 'Alíquota do PIS (%)' },
          { nome: 'cst_cofins', rotulo: 'CST da COFINS' }, { nome: 'aliq_cofins', rotulo: 'Alíquota da COFINS (%)' }],
        valores: { ncm: p.ncm || '', cest: p.cest || '', gtin: p.gtin || '', origem: p.origem == null ? '' : p.origem, cfop: v.cfop || '', cst_icms: v.cst_icms || '',
          aliq_icms: v.aliq_icms == null ? '' : v.aliq_icms, red_bc_icms: v.red_bc_icms == null ? '' : v.red_bc_icms, cbenef: v.cbenef || '', extipi: v.extipi || '', cst_pis: v.cst_pis || '', aliq_pis: v.aliq_pis == null ? '' : v.aliq_pis, cst_cofins: v.cst_cofins || '', aliq_cofins: v.aliq_cofins == null ? '' : v.aliq_cofins },
        salvarTexto: 'Salvar e marcar conferido',
        aoSalvar: async x => {
          const ncm = String(x.ncm || '').replace(/\D/g, '');
          if (ncm && ncm.length !== 8) throw new Error('o NCM tem 8 números');
          const venda = { cfop: String(x.cfop || '').replace(/\D/g, '') || null, cst_icms: x.cst_icms || null, aliq_icms: num(x.aliq_icms), red_bc_icms: num(x.red_bc_icms),
            cst_pis: x.cst_pis || null, aliq_pis: num(x.aliq_pis), cst_cofins: x.cst_cofins || null, aliq_cofins: num(x.aliq_cofins) };
          const cbenef = String(x.cbenef || '').trim().toUpperCase(), extipi = String(x.extipi || '').replace(/\D/g, '');
          if (cbenef) { if (!/^[A-Z]{2}\d{6}$/.test(cbenef)) throw new Error('o cBenef tem 2 letras e 6 números (ex.: SP020030)'); venda.cbenef = cbenef; }
          if (extipi) { if (extipi.length < 2 || extipi.length > 3) throw new Error('o Ex da TIPI tem 2 ou 3 números'); venda.extipi = extipi; }
          if (venda.cst_icms === '20' && !(venda.red_bc_icms > 0 && venda.red_bc_icms < 100)) throw new Error('no CST 20 informe a redução da base (ex.: 61,11)');
          if (venda.cst_icms === '20' && !venda.cbenef) throw new Error('no CST 20 informe o cBenef (em SP é obrigatório)');
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
