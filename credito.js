/* CRM Sistemi Dalessi — crédito do cliente (27/10/2026, pedido do Anderson: "está faltando esse módulo para fechar 100%").
   Cliente novo passa pela consulta de crédito: o botão "Consultar crédito" copia o CNPJ e abre o site de consulta (o endereço fica em
   crm_config.dados.credito.url, onde a empresa tem login; o CRM nunca guarda a senha nem entra no site), o PDF volta para o CRM, a IA lê os FATOS
   (crm-caixa-ler, modo credito) e a proposta sai da POLÍTICA abaixo, pura e testada; quem aprova é o administrador.
   O banco (crm_credito, crm_credito_ver, crm_credito_gravar, crm_credito_painel) trava o pedido a prazo com
   SEM ANÁLISE, PRAZO e LIMITE, que só o administrador libera. Tela: aba Crédito do Caixa e a ficha do cliente.
   Testes: testes/credito.test.js. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);

  // ---- política de crédito da OneClean (a proposta; o administrador pode mudar antes de aprovar)
  const POLITICA = {
    compraPadrao: 1500,      // sem compra prevista nem histórico
    scoreMinimo: 400,        // abaixo: só à vista
    scoreBom: 600,           // a partir daqui: 2 meses de compra e 28 dias
    pontualMinima: 80,       // pontualidade abaixo disso desce um degrau
    tetoDoBureau: 1,         // nunca mais que o limite sugerido pela consulta (era 10%, que cortava demais o limite da API da Rekta;
                             // 28/10/2026, decisão do Anderson depois da 2ª consulta real)
    arredonda: 500,
    revisarMeses: 6
  };
  const SITUACOES = { prazo: 'Liberado a prazo', vista: 'Só à vista', analise: 'Em análise' };
  const BLOQUEIOS = ['SEM ANÁLISE', 'PRAZO', 'LIMITE'];
  const meses = (de, ate) => {
    if (!de || !ate) return null;
    const a = new Date(de + 'T12:00:00Z'), b = new Date(ate + 'T12:00:00Z');
    return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
  };
  const somaMeses = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
  const teto = (v, passo) => Math.ceil(v / passo) * passo;
  const piso = (v, passo) => Math.floor(v / passo) * passo;

  // k: o que a IA leu da consulta (crm-caixa-ler); ctx: { compra_mensal, maior_mes, vencido, hoje }.
  // → { situacao, limite, prazo_max, revisar_em, motivos: [...], atencao: [...] }
  function propor(k, ctx) {
    k = k || {}; ctx = ctx || {};
    const P = POLITICA, hoje = ctx.hoje || new Date().toISOString().slice(0, 10);
    const motivos = [], atencao = [];
    const revisar_em = somaMeses(hoje, P.revisarMeses);
    const fim = (situacao, limite, prazo) => ({ situacao, limite: situacao === 'prazo' ? limite : 0, prazo_max: situacao === 'prazo' ? prazo : null, revisar_em, motivos, atencao });
    const base = Number(ctx.compra_mensal) > 0 ? Number(ctx.compra_mensal) : Number(ctx.maior_mes) > 0 ? Number(ctx.maior_mes) : P.compraPadrao;
    if (!(Number(ctx.compra_mensal) > 0)) motivos.push(Number(ctx.maior_mes) > 0 ? 'compra do mês pelo histórico: ' + R.moeda(base) : 'sem compra prevista: considerei ' + R.moeda(base) + ' por mês');
    (k.alertas || []).forEach(a => a && atencao.push(a));
    if (k.mudanca_societaria) atencao.push(k.mudanca_societaria);
    if (Number(ctx.vencido) > 0) { motivos.push('tem ' + R.moeda(ctx.vencido) + ' vencido com a OneClean'); return fim('analise'); }
    if (k.situacao_cadastral && !/ativ/i.test(k.situacao_cadastral)) { motivos.push('CNPJ ' + k.situacao_cadastral + ' na Receita'); return fim('vista'); }
    const neg = [];
    if (k.pendencias_qtd > 0) neg.push(k.pendencias_qtd + ' pendência(s) financeira(s)' + (k.pendencias_valor ? ' (' + R.moeda(k.pendencias_valor) + ')' : ''));
    if (k.protestos_qtd > 0) neg.push(k.protestos_qtd + ' protesto(s)' + (k.protestos_valor ? ' (' + R.moeda(k.protestos_valor) + ')' : ''));
    if (k.cheques_qtd > 0) neg.push(k.cheques_qtd + ' cheque(s) sem fundo/sustado(s)');
    if (k.acoes_qtd > 0) neg.push(k.acoes_qtd + ' ação(ões) judicial(is)');
    if (k.falencia) neg.push('falência ou recuperação judicial');
    if (k.fraude) neg.push('alerta de fraude');
    if (neg.length) { motivos.push('restrição na consulta: ' + neg.join(', ')); return fim('vista'); }
    const score = Number(k.score) || 0;
    if (!score) { motivos.push('a consulta não trouxe score'); return fim('analise'); }
    if (score < P.scoreMinimo) { motivos.push('score ' + score + ' (abaixo de ' + P.scoreMinimo + ')'); return fim('vista'); }
    let degrau = score >= P.scoreBom ? 2 : 1;
    motivos.push('score ' + score + (k.prob_inadimplencia >= 0 ? ' (' + String(k.prob_inadimplencia).replace('.', ',') + '% de chance de atrasar)' : ''));
    if (k.pontualidade >= 0 && k.pontualidade < P.pontualMinima) { degrau--; motivos.push('pontualidade ' + k.pontualidade + '% (abaixo de ' + P.pontualMinima + '%)'); }
    if (k.atraso_mais_60) { degrau--; motivos.push('atraso acima de 60 dias no último ano'); }
    if (degrau <= 0) return fim('vista');
    const idade = meses(k.fundacao, hoje), mudou = meses(k.mudanca_em, hoje);
    if (idade != null && idade < 12) { degrau = 1; motivos.push('empresa com menos de 1 ano'); }
    if (mudou != null && mudou < 12) { degrau = 1; motivos.push('mudança de sócio ou razão social há menos de 1 ano'); }
    let limite = teto(base * degrau, P.arredonda);
    motivos.push((degrau === 2 ? '2 meses' : '1 mês') + ' de compra: ' + R.moeda(limite));
    if (k.limite_sugerido > 0) {
      const t = piso(k.limite_sugerido * P.tetoDoBureau, P.arredonda);
      if (t < P.arredonda) { motivos.push('limite da consulta baixo demais (' + R.moeda(k.limite_sugerido) + ')'); return fim('vista'); }
      if (limite > t) { limite = t; motivos.push('limitado ao limite da consulta: ' + R.moeda(t)); }
    }
    return fim('prazo', limite, degrau === 2 ? 28 : 21);
  }

  // Fatos da consulta em linhas curtas (para a conferência e a ficha).
  function resumoFatos(k) {
    if (!k) return [];
    const l = [];
    if (k.score) l.push('Score ' + k.score + (k.prob_inadimplencia >= 0 ? ' · ' + String(k.prob_inadimplencia).replace('.', ',') + '% de chance de atrasar' : ''));
    if (k.recomendacao) l.push('Recomendação da consulta: ' + k.recomendacao);
    const neg = (k.pendencias_qtd || 0) + (k.protestos_qtd || 0) + (k.cheques_qtd || 0) + (k.acoes_qtd || 0) + (k.falencia ? 1 : 0) + (k.fraude ? 1 : 0);
    l.push(neg ? 'Restrições: ' + [k.pendencias_qtd ? k.pendencias_qtd + ' pendência(s)' : '', k.protestos_qtd ? k.protestos_qtd + ' protesto(s)' : '', k.cheques_qtd ? k.cheques_qtd + ' cheque(s)' : '',
      k.acoes_qtd ? k.acoes_qtd + ' ação(ões)' : '', k.falencia ? 'falência/recuperação' : '', k.fraude ? 'alerta de fraude' : ''].filter(Boolean).join(', ') : 'Sem restrições, protestos, cheques ou ações');
    if (k.pontualidade >= 0) l.push('Pagamento pontual: ' + k.pontualidade + '%' + (k.atraso_mais_60 ? ' · com atraso acima de 60 dias' : ''));
    if (k.limite_sugerido > 0) l.push('Limite sugerido pela consulta: ' + R.moeda(k.limite_sugerido));
    if (k.faturamento_presumido) l.push('Faturamento presumido: ' + k.faturamento_presumido);
    if (k.fundacao) l.push('Fundada em ' + R.dataBR(k.fundacao));
    if (k.consultas_12m) l.push(k.consultas_12m + ' consulta(s) ao CNPJ em 12 meses');
    return l;
  }

  // O que a equipe vê (crm_credito_ver sem score nem relatório).
  function textoEquipe(v) {
    if (!v || !v.ligado) return '';
    if (v.situacao === 'sem_ficha') return 'Sem análise de crédito: pedido a prazo fica bloqueado até o administrador analisar.';
    if (v.situacao === 'analise') return 'Crédito em análise: pedido a prazo fica bloqueado até o administrador liberar.';
    if (v.situacao === 'vista') return 'Só à vista (pix, transferência ou antecipado).';
    return 'Crédito disponível: ' + R.moeda(v.disponivel || 0) + (v.prazo_max ? ' · prazo até ' + v.prazo_max + ' dias' : '');
  }

  // ---- a resposta da API da Rekta (RLT Avançado, 28/10/2026) nos mesmos FATOS que a IA tira do PDF (crm-caixa-ler, modo
  // credito): o app lê aqui, sem IA. O guia da Rekta só traz exemplo de pessoa física; os nomes de campo de pessoa jurídica
  // que não estão nele são procurados por nome parecido (acha) e, o que não aparece, fica como "não aparece" (-1 ou vazio),
  // igual à leitura do PDF. A resposta inteira fica guardada (bucket crm-credito e crm_credito_rekta) para conferir.
  const numBR = v => { if (v == null || v === '') return 0; if (typeof v === 'number') return v; const t = String(v).replace(/[^\d,.-]/g, ''); const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const diaBR = v => { const m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return m[3] + '-' + m[2] + '-' + m[1]; const i = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return i ? i[0] : ''; };
  const lista = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []);
  // procura a 1ª chave cujo nome casa com re (até 4 níveis), com valor não vazio
  function acha(o, re, fundo) {
    if (!o || typeof o !== 'object' || (fundo || 0) > 4) return null;
    for (const k of Object.keys(o)) { const v = o[k]; if (re.test(k) && v != null && v !== '' && typeof v !== 'object') return v; }
    for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') { const r = acha(Array.isArray(v) ? v[0] : v, re, (fundo || 0) + 1); if (r != null) return r; } }
    return null;
  }
  // a 1ª resposta real (28/10/2026, pessoa jurídica) veio como TEXTO com o JSON dentro, e com nomes diferentes dos do guia
  // (que só tem pessoa física): score.score_pj, identificacao_completo, protestos, pendencias_restricoes, "decisao:decisao",
  // "pgtpont:pagamento_pontual", pagamento_atrasado, limite_credito, faturamento_presumido, consultas. Seções sem nada vêm null.
  const chave = (o, re) => { if (!o || typeof o !== 'object') return undefined; const k = Object.keys(o).find(x => re.test(x)); return k == null ? undefined : o[k]; };
  // quantas ocorrências e quanto somam, numa seção negativa (protestos, pendências, cheques, ações, falência). Formato real
  // (28/10/2026, consultas com restrição): o TOTAL vem no topo ("total_protestos", "total_pendencias", "total_acoes",
  // "quantidade_total") e o valor em "valor_total" (protestos, ações) ou "valor" (pendências); "ultimas_ocorrencias" traz só
  // as 5 últimas. Por isso vale o total do topo; sem ele, conta os itens das listas e soma o "valor" de cada um (nunca
  // valor_maior/valor_primeiro, que repetem um item). null = nada; com conteúdo que não deu para contar vale 1 (melhor parar
  // para conferir do que liberar no escuro).
  function ocorrencias(v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return { qtd: 0, valor: 0 };
    if (typeof v !== 'object') return /nada consta|n[aã]o consta|sem ocorr/i.test(String(v)) || String(v).trim() === '0' ? { qtd: 0, valor: 0 } : { qtd: 1, valor: 0 };
    const num = x => (x != null && x !== '' && typeof x !== 'object' && /\d/.test(String(x)) ? numBR(x) : null);
    if (!Array.isArray(v)) {
      const kt = Object.keys(v).find(k => /^(total_(?!credores)[a-z_]+|quantidade_total|quantidade|total|qtd)$/i.test(k) && /^\s*\d+\s*$/.test(String(v[k] == null ? '' : v[k])));
      const vt = num(v.valor_total) != null ? num(v.valor_total) : num(v.valor);
      if (kt) return { qtd: Number(v[kt]), valor: vt || 0 };
    }
    let qtd = 0, valor = 0, vazio = true;
    const anda = (o, f, item) => {
      if (o == null || f > 6) return;
      if (Array.isArray(o)) { o.forEach(x => { if (x && typeof x === 'object' && !Array.isArray(x)) { qtd++; vazio = false; anda(x, f + 1, true); } else anda(x, f + 1, false); }); return; }
      if (typeof o !== 'object') { if (o !== '' && o !== '-') vazio = false; return; }
      Object.keys(o).forEach(k => {
        const x = o[k];
        if (item && k === 'valor' && num(x) != null) valor += num(x);
        if (x && typeof x === 'object') anda(x, f + 1, false); else if (x != null && x !== '' && x !== '-') vazio = false;
      });
    };
    anda(v, 0, false);
    return { qtd: qtd || (vazio ? 0 : 1), valor };
  }
  const meses12 = o => { const l = ((((o || {}).lista_indicador_comportamento) || {}).item_indicador); return Array.isArray(l) ? l.filter(x => !/pontua/i.test(x.mes_ano || '')) : []; };
  function daRektaPJ(b, doc, hoje) {
    const id = b.identificacao_completo || b.identificacao || {};
    const spj = (b.score && (b.score.score_pj || b.score.score)) || {};
    const score = /^\d+$/.test(String(spj.score || '').trim()) ? Math.min(1000, Number(spj.score)) : 0;
    const p100 = /de cada 100[^,]*,[^\d]*(\d{1,3})/i.exec(spj.texto || '');
    const pr = String(spj.probabilidade || '').trim();
    const prob = p100 ? Number(p100[1]) : /^\d{4,}$/.test(pr) ? Number(pr) / 100 : /^\d{1,3}([.,]\d+)?$/.test(pr) ? Number(pr.replace(',', '.')) : -1;
    const dec = chave(b, /(^|:)decisao$/i) || {};
    const decTxt = String(chave(dec, /descricao|texto/i) || '');
    const prot = ocorrencias(b.protestos), pend = ocorrencias(b.pendencias_restricoes);
    const cheq = ['cheques_sem_fundo', 'cheques_sustados', 'cheques_devolvidos_informados_usuario'].reduce((a, k) => a + ocorrencias(b[k]).qtd, 0);
    const acoes = ocorrencias(b.acoes_civeis).qtd;
    const fal = ocorrencias(b.falencias_recuperacao_judicial).qtd > 0;
    const fraude = ocorrencias(b.alerta_fraudes).qtd > 0;
    // pontualidade: "pgtpont:pagamento_pontual" traz a % paga em dia (100 = tudo em dia); "-" = sem informação
    const pp = chave(b, /pagamento_pontual$/i) || {};
    const ppv = String(chave(pp, /pontuacao$/i) == null ? '' : chave(pp, /pontuacao$/i)).trim();
    const pont = /^\d+([.,]\d+)?$/.test(ppv) ? Math.min(100, Number(ppv.replace(',', '.'))) : -1;
    const atr = b.pagamento_atrasado || {};
    const temNum = o => meses12(o).some(x => numBR(x.pontuacao_mensal) > 0);
    const mais60 = temNum(atr.mais_de_60_dias);
    const lim = numBR((b.limite_credito || {}).score || (b.limite_credito || {}).valor);
    const alertas = [];
    if (/n[aã]o recomend|reprov|negad/i.test(decTxt)) alertas.push('a Rekta não recomenda: ' + decTxt);
    if (temNum(atr.periodo_31_a_60_dias)) alertas.push('pagamentos com 31 a 60 dias de atraso no último ano');
    if (fraude) alertas.push('a consulta trouxe alerta de fraude: confira no relatório');
    const mud = diaBR(id.data_alteracao_razao_social || '');
    return {
      razao_social: String(id.razao_social || id.razaoSocial || '').slice(0, 160),
      documento: String(doc || id.cnpj || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14),
      emitido_em: hoje || new Date().toISOString().slice(0, 10),
      fundacao: diaBR(id.data_fundacao || id.data_registro || ''),
      situacao_cadastral: String(id.situacao_cnpj || '').slice(0, 60),
      score, prob_inadimplencia: score ? prob : -1,
      recomendacao: decTxt.slice(0, 160),
      pendencias_qtd: pend.qtd, pendencias_valor: pend.valor,
      protestos_qtd: prot.qtd, protestos_valor: prot.valor,
      cheques_qtd: cheq, acoes_qtd: acoes, falencia: fal, fraude,
      pontualidade: pont, atraso_mais_60: mais60,
      limite_sugerido: lim,
      faturamento_presumido: String((b.faturamento_presumido || {}).faturamento_anual || '').slice(0, 120),
      mudanca_societaria: '', mudanca_em: mud && id.razao_social_anterior ? mud : '',
      consultas_12m: Number((b.consultas || {}).quantidade_total || 0) || 0,
      alertas
    };
  }

  function daRekta(b, doc, hoje) {
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b && typeof b === 'object' ? b : {};
    if (b.identificacao_completo || (b.score && b.score.score_pj)) return daRektaPJ(b, doc, hoje);
    const id = b.identificacao || {};
    const scores = lista(b.score_classificacao_varios_modelos);
    const sc = scores.find(x => /score|positivo|risco/i.test((x.descricaoNatureza || '') + ' ' + (x.nomeScore || '')) && !/renda|limite|faturamento/i.test(x.descricaoNatureza || '') && /^\d+$/.test(String(x.score || '').trim()));
    const prob = sc && /^\d+$/.test(String(sc.probabilidade || '')) && Number(sc.probabilidade) > 0 ? Math.round(Number(sc.probabilidade)) / 100
      : sc && /(\d{1,3})%\s*das/.exec(sc.texto || '') ? 100 - Number(/(\d{1,3})%\s*das/.exec(sc.texto)[1]) : -1;
    const fat = scores.find(x => /faturamento/i.test(x.descricaoNatureza || '') || /faturamento/i.test(x.nomeScore || ''));
    const lim = scores.find(x => /limite/i.test(x.descricaoNatureza || '') && /credito|crédito/i.test((x.descricaoNatureza || '') + ' ' + (x.nomeScore || '')));
    const rd = b.resumo_ocorrencias_de_debitos || {}, deb = lista(b.debitos);
    const rp = b.resumo_titulos_protestados || {}, prot = lista(b.titulos_protestados);
    const cheques = lista(b.relacao_devolucoes_informadas_pelo_ccf).length + lista(b.devolucoes_informadas_pelo_usuario).length + lista(b.cheques_sustados_pelo_motivo_21).length;
    const rc = b.resumo_devolucoes_informadas_pelo_ccf || {};
    const acoes = lista(b.relacao_de_acoes_civeis).length || Number((b.resumo_de_acoes_civeis || {}).total || (b.resumo_de_acoes_civeis || {}).quantidade || 0) || 0;
    const fal = lista(b.relacao_falencia_recuperacao_judicial).length > 0;
    // pontualidade: das operações parceladas com pagamento informado, quantas foram pagas em dia ou até 5 dias depois
    const itens = ((((b.painel_controle_positivo || {}).indicadores_positivos_comportamento_pagamento || {}).nota_pontualidade || {}).operacoes_parceladas || {}).item_painel_controle;
    let pont = -1, atraso31 = 0;
    if (Array.isArray(itens) && itens.length) {
      const v = re => itens.filter(x => re.test(x.descricao || '')).reduce((a, x) => a + numBR(x.valor), 0);
      const emDia = v(/antecipad|em dia|até 5 dias/i), depois = v(/^pagos (entre|após)/i);
      atraso31 = v(/^pagos após 31/i);
      if (emDia + depois > 0) pont = Math.round(emDia / (emDia + depois) * 1000) / 10;
    }
    const dec = b.decisao || {};
    const situ = String(id.situacaoCadastral || acha(b, /^situacao(Cadastral|Receita|Cnpj)$/i) || '');
    const alertas = [];
    if (String(dec.aprova || '').toUpperCase() === 'N') alertas.push('a Rekta não recomenda: ' + (dec.texto || 'negociação não recomendada'));
    if (atraso31 > 0 && pont >= 0) alertas.push(atraso31 + ' parcela(s) paga(s) depois de 31 dias (cadastro positivo)');
    const consultas = Number((b.resumo_consultas_anteriores || {}).totalDeConsultas || 0) || 0;
    return {
      razao_social: String(id.razaoSocial || id.nome || acha(b, /^(razaoSocial|nomeEmpresarial|razao_social)$/i) || '').slice(0, 160),
      documento: String(doc || id.documento || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14),
      emitido_em: hoje || new Date().toISOString().slice(0, 10),
      fundacao: diaBR(id.dataFundacao || id.dataAbertura || acha(b, /^data(Fundacao|Abertura|Constituicao)$/i) || ''),
      situacao_cadastral: /^\d+$/.test(situ) ? '' : situ.slice(0, 60),
      score: sc ? Math.min(1000, Number(sc.score)) : 0,
      prob_inadimplencia: prob,
      recomendacao: String(dec.texto || '').slice(0, 160),
      pendencias_qtd: Number(rd.totalDevedor) || deb.length, pendencias_valor: numBR(rd.valorAcomulado || rd.valorAcumulado) || deb.reduce((a, x) => a + numBR(x.valor), 0),
      protestos_qtd: Number(rp.total) || prot.length, protestos_valor: numBR(rp.valorAcumulado || rp.valorAcomulado) || prot.reduce((a, x) => a + numBR(x.valor), 0),
      cheques_qtd: cheques || Number(rc.total || rc.totalDevolucoes || 0) || 0,
      acoes_qtd: acoes, falencia: fal, fraude: false,
      pontualidade: pont, atraso_mais_60: false,
      limite_sugerido: lim ? numBR(lim.valor) || numBR((String(lim.texto || '').match(/R\$\s*([\d.,]+)/) || [])[1]) : 0,
      faturamento_presumido: fat ? String(fat.texto || '').slice(0, 120) : '',
      mudanca_societaria: '', mudanca_em: '',
      consultas_12m: consultas,
      alertas
    };
  }

  const C = { POLITICA, SITUACOES, BLOQUEIOS, propor, resumoFatos, textoEquipe, daRekta };
  raiz.CRMCredito = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  if (typeof document === 'undefined' || !raiz.CRM) return;

  // ================================================================== tela (só no navegador)
  const CRM = raiz.CRM, esc = s => CRM.esc(s);
  let painel = null, carregando = false, lidoEm = 0;
  const cacheVer = new Map();
  const cfg = () => (((CRM.estado && CRM.estado.cfg) || {}).credito) || {};
  // API da Rekta (28/10/2026, Anderson: "não é para a gente colocar, analisar… ele vai direto, pesquisa e traz a consulta já
  // fazendo toda a análise"): com a consulta pela API no CRM, o "Analisar" não abre mais o site: abre a análise e já
  // consulta a Rekta (depois de confirmar o preço). crm_config.dados.credito.api = false volta ao site + PDF.
  const viaApi = () => !!(CRM.store() && CRM.store().creditoRekta) && cfg().api !== false;
  const linkConsulta = () => (viaApi() ? '' : cfg().url || '');
  // preço da consulta RLT Avançado pela API (Rekta, 28/10/2026: R$ 12,80; extras que o CRM não pede: CNH e veículos R$ 4,50
  // cada, Judiciário R$ 5,12, Prospecção R$ 1,20). Muda em crm_config.dados.credito.preco_api.
  const precoApi = () => (Number(cfg().preco_api) > 0 ? Number(cfg().preco_api) : 12.8);

  async function carrega(forca) {
    if (carregando || (!forca && painel && Date.now() - lidoEm < 60000)) return;
    carregando = true;
    try { painel = await CRM.store().creditoPainel(); lidoEm = Date.now(); } catch (e) { CRM.falhou(e); painel = painel || { fichas: [], pendentes: [], sugestoes: [] }; }
    finally { carregando = false; }
    if (CRM.estado.aba === 'caixa') CRM.render();
  }

  function seloSit(s) { return CRM.selo(SITUACOES[s] || s, s === 'prazo' ? 'verde' : s === 'vista' ? 'ambar' : 'cinza'); }
  const docTxt = e => (e && e.cnpj) || '';

  function aba() {
    if (!painel) { setTimeout(() => carrega(), 0); return '<section class="cartao"><p class="vazio">Carregando o crédito…</p></section>'; }
    const c = cfg(), lig = !!c.ligado, h = CRM.hoje();
    const fichas = painel.fichas || [], pend = painel.pendentes || [], sug = painel.sugestoes || [];
    const vencidas = fichas.filter(f => f.revisar_em && f.revisar_em < h);
    const perto = fichas.filter(f => f.situacao === 'prazo' && f.limite > 0 && f.usado >= f.limite * 0.8);
    return '<section class="cartao cred-topo"><h2>Crédito dos clientes</h2>' +
      (viaApi() ? '<p>Cliente novo: <strong>1.</strong> "Analisar" consulta a Rekta direto (' + esc(R.moeda(precoApi())) + ' por consulta, o CRM pergunta antes) · ' +
        '<strong>2.</strong> o CRM lê o score, os protestos, as pendências e a pontualidade e monta a proposta pela política · <strong>3.</strong> confira e aprove.'
        : '<p>Cliente novo: <strong>1.</strong> "Analisar" abre o site de consulta com o CNPJ copiado (cole e consulte) · <strong>2.</strong> baixe o PDF e solte na janela que abriu no CRM · ' +
      '<strong>3.</strong> confira a proposta (score, restrições, pontualidade) e aprove.') + ' A trava vale no pedido a prazo: SEM ANÁLISE, PRAZO e LIMITE, que só você libera.</p>' +
      '<p class="cred-liga">' + (lig ? CRM.selo('trava ligada', 'verde') + ' <button type="button" class="btn sec" data-acao="cred-ligar">Desligar a trava</button>'
        : CRM.selo('trava desligada', 'cinza') + ' <button type="button" class="btn" data-acao="cred-ligar">Ligar a trava nos pedidos</button>' +
          ' <small>antes, aplique as sugestões dos clientes que já compram (abaixo), senão todo pedido a prazo deles para em SEM ANÁLISE</small>') +
      (viaApi() ? ' ' + CRM.selo('consulta pela API da Rekta', 'verde') : ' ' + linkConsultar('', 'Abrir o site de consulta', 'btn sec') + ' <button type="button" class="mini" data-acao="cred-endereco" title="trocar o endereço do site de consulta">✎ endereço</button>') +
      ' <button type="button" class="btn sec" data-acao="cred-atualiza" title="atualizar">⟳</button></p>' +
      '<p><label class="cred-busca">Analisar um cliente: <input type="search" id="credBusca" list="credEmpresas" placeholder="nome ou CNPJ"></label>' +
        '<datalist id="credEmpresas">' + ((CRM.estado.D.empresas) || []).filter(e => e.cnpj).slice(0, 4000).map(e => '<option value="' + esc(e.nome + ' · ' + e.cnpj) + '">').join('') + '</datalist>' +
        ' <button type="button" class="btn" data-acao="cred-buscar">Analisar</button></p></section>' +
      (pend.length ? '<section class="cartao"><h2>Para analisar <small>' + pend.length + '</small></h2>' +
        (viaApi() ? '<p class="cred-lote"><label><input type="checkbox" id="credMarcaTodos"> marcar todos</label> <button type="button" class="btn" data-acao="cred-lote">Analisar os marcados</button>' +
          ' <small>uma consulta à Rekta por cliente (' + esc(R.moeda(precoApi())) + ' cada; a já feita nos últimos 30 dias não paga de novo); depois é só dar OK em cada um</small></p>' : '') +
        '<div class="tabela-rolagem"><table class="tabela"><tbody>' +
        pend.map(p => '<tr>' + (viaApi() ? '<td class="cred-marca-td"><input type="checkbox" class="cred-marca" value="' + esc(p.empresa_id) + '" aria-label="marcar ' + esc(p.nome) + '"></td>' : '') + '<td><button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(p.empresa_id) + '">' + esc(p.nome) + '</button><small>' + esc(p.cnpj || '') + ' · cadastro ' + esc(R.dataBR(R.diaLocal(p.criado_em))) + '</small></td>' +
          '<td>' + ((p.pedidos || []).map(x => 'pedido ' + x.numero + ' · ' + R.moeda(x.valor) + ' · ' + (x.bloqueios || []).filter(b => BLOQUEIOS.indexOf(b) !== -1).join(', ')).map(esc).join('<br>') || '<small>cliente novo sem análise</small>') + '</td>' +
          '<td class="acoes-linha">' + linkConsultar(p.empresa_id, 'Analisar', 'mini', 'cred-analisar-site') + '</td></tr>').join('') +
        '</tbody></table></div></section>' : '') +
      (sug.length ? '<section class="cartao"><h2>Clientes que já compram <small>' + sug.length + ' sem ficha · sugestão pelo histórico</small></h2>' +
        '<p>Limite = 2 × a maior compra do mês nos últimos 12 meses (de 500 em 500), prazo = o maior que o cliente usa hoje (mínimo 28 dias). Quem tem título vencido fica "em análise". Revisão em 6 meses.</p>' +
        '<p><button type="button" class="btn" data-acao="cred-aplicar">Aplicar as ' + sug.length + ' sugestões</button> <small>Dá para mudar qualquer um depois, um a um.</small></p>' +
        '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Cliente</th><th class="num">Maior mês</th><th class="num">Em aberto</th><th>Sugestão</th><th></th></tr></thead><tbody>' +
        sug.slice(0, 60).map(s => '<tr><td><button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(s.empresa_id) + '">' + esc(s.nome) + '</button><small>' + s.meses + ' mês(es) com compra · última ' + esc(R.dataBR(R.diaLocal(s.ultima))) + '</small></td>' +
          '<td class="num">' + esc(R.moeda(s.maior_mes)) + '</td><td class="num">' + esc(R.moeda(s.aberto)) + (s.vencido > 0 ? '<small class="cx-neg">vencido ' + esc(R.moeda(s.vencido)) + '</small>' : '') + '</td>' +
          '<td>' + seloSit(s.situacao) + (s.situacao === 'prazo' ? ' ' + esc(R.moeda(s.limite)) + ' · ' + s.prazo_max + ' dias' : '') + '</td>' +
          '<td class="acoes-linha"><button type="button" class="mini" data-acao="cred-analisar" data-id="' + esc(s.empresa_id) + '">Ajustar</button></td></tr>').join('') +
        '</tbody></table></div>' + (sug.length > 60 ? '<p class="mais">mostrando os 60 que mais compram</p>' : '') + '</section>' : '') +
      '<section class="cartao"><h2>Fichas de crédito <small>' + fichas.length + (vencidas.length ? ' · ' + vencidas.length + ' com revisão vencida' : '') + (perto.length ? ' · ' + perto.length + ' perto do limite' : '') + '</small></h2>' +
      (fichas.length ? filtrosFichas(fichas) + '<p class="acoes"><button type="button" class="btn sec" data-acao="ls-csv" data-id="cred-fichas">Baixar planilha</button></p>' + '<div id="credFichas">' + tabelaFichas(fichas) + '</div>' : '<p class="vazio">Nenhuma ficha ainda.</p>') + '</section>';
  }

  // Fichas: busca por nome/CNPJ, filtro por situação e ordenação pela coluna (27/10/2026, pedido do Anderson:
  // "clicando em situação, vem todos os bloqueados para eu dar uma verificada rápida").
  const vf = { busca: '', filtro: '', ordem: 'nome', desc: false };
  const FILTROS = [['', 'Todas'], ['prazo', 'A prazo'], ['vista', 'Só à vista'], ['analise', 'Em análise'], ['vencido', 'Com título vencido'],
    ['perto', 'Perto do limite'], ['revisar', 'Revisão vencida'], ['historico', 'Pelo histórico'], ['consulta', 'Pela consulta']];
  const dispDe = f => Math.max(0, Number(f.limite) - Number(f.usado));
  function passa(f, h) {
    const k = vf.filtro;
    if (k === 'prazo' || k === 'vista' || k === 'analise') { if (f.situacao !== k) return false; }
    else if (k === 'vencido') { if (!(f.vencido > 0)) return false; }
    else if (k === 'perto') { if (!(f.situacao === 'prazo' && f.limite > 0 && f.usado >= f.limite * 0.8)) return false; }
    else if (k === 'revisar') { if (!(f.revisar_em && f.revisar_em < h)) return false; }
    else if (k === 'historico' || k === 'consulta') { if (f.origem !== k) return false; }
    const t = vf.busca.trim();
    if (!t) return true;
    const dig = t.replace(/[^0-9A-Za-z]/g, '').toUpperCase(), cnpj = String(f.cnpj || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    return R.normaliza(String(f.nome || '')).indexOf(R.normaliza(t)) !== -1 || (dig.length >= 3 && /\d/.test(dig) && cnpj.indexOf(dig) !== -1);
  }
  function filtrosFichas(fichas) {
    const h = CRM.hoje(), conta = k => { const a = vf.filtro; vf.filtro = k; const b = vf.busca; vf.busca = ''; const n = fichas.filter(f => passa(f, h)).length; vf.filtro = a; vf.busca = b; return n; };
    return '<div class="filtro-linha cred-filtros"><input type="search" id="credFiltroBusca" placeholder="procurar por nome ou CNPJ" value="' + esc(vf.busca) + '">' +
      FILTROS.map(([k, r]) => { const n = conta(k); return k && !n ? '' : '<button type="button" class="chip-filtro' + (vf.filtro === k ? ' ativo' : '') + '" data-acao="cred-filtro" data-id="' + k + '">' + esc(r) + ' (' + n + ')</button>'; }).join('') + '</div>';
  }
  function tabelaFichas(fichas) {
    const h = CRM.hoje();
    const chave = { nome: f => R.normaliza(String(f.nome || '')), situacao: f => ({ analise: 0, vista: 1, prazo: 2 }[f.situacao]) + R.normaliza(String(f.nome || '')),
      limite: f => Number(f.limite), usado: f => Number(f.usado), disp: f => (f.situacao === 'prazo' ? dispDe(f) : -1), prazo: f => Number(f.prazo_max || 0), revisar: f => f.revisar_em || '' }[vf.ordem];
    const l = fichas.filter(f => passa(f, h)).sort((a, b) => { const x = chave(a), y = chave(b); return (x < y ? -1 : x > y ? 1 : 0) * (vf.desc ? -1 : 1); });
    // planilha das fichas (28/10/2026): o que o filtro mostra, todas as linhas
    CRM.Lista.planilha('cred-fichas', 'fichas-de-credito', ['Cliente', 'CNPJ', 'Situação', 'Limite', 'Usado', 'Disponível', 'Prazo (dias)', 'Score', 'Analisado em', 'Revisar em', 'Vencido'],
      () => l.map(f => [f.nome, f.cnpj || '', SITUACOES[f.situacao] || f.situacao, f.situacao === 'prazo' ? Number(f.limite) : '', Number(f.usado || 0), f.situacao === 'prazo' ? dispDe(f) : '', f.prazo_max || '', f.score || '',
        f.analisado_em ? R.dataBR(f.analisado_em) : '', f.revisar_em ? R.dataBR(f.revisar_em) : '', Number(f.vencido || 0)]));
    const th = (k, rot, cls) => '<th' + (cls ? ' class="' + cls + '"' : '') + '><button type="button" class="ordena' + (vf.ordem === k ? ' ativo' : '') + '" data-acao="cred-ordem" data-id="' + k + '">' + esc(rot) + (vf.ordem === k ? (vf.desc ? ' ▼' : ' ▲') : '') + '</button></th>';
    if (!l.length) return '<p class="vazio">Nenhuma ficha com esse filtro.</p>';
    return '<div class="tabela-rolagem"><table class="tabela"><thead><tr>' + th('nome', 'Cliente') + th('situacao', 'Situação') + th('limite', 'Limite', 'num') + th('usado', 'Usado', 'num') +
      th('disp', 'Disponível', 'num') + th('prazo', 'Prazo') + th('revisar', 'Revisar') + '<th></th></tr></thead><tbody>' +
      l.slice(0, 500).map(f => {
        const disp = dispDe(f), venc = f.revisar_em && f.revisar_em < h;
        return '<tr><td><button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(f.empresa_id) + '">' + esc(f.nome) + '</button><small>' + esc(f.cnpj || '') + ' · ' + esc({ consulta: 'pela consulta', historico: 'pelo histórico', manual: 'à mão' }[f.origem] || '') + (f.score ? ' · score ' + f.score : '') + '</small></td>' +
          '<td>' + seloSit(f.situacao) + (f.vencido > 0 ? ' ' + CRM.selo('vencido ' + R.moeda(f.vencido), 'vermelho') : '') + '</td>' +
          '<td class="num">' + (f.situacao === 'prazo' ? esc(R.moeda(f.limite)) : '—') + '</td><td class="num">' + esc(R.moeda(f.usado)) + '</td>' +
          '<td class="num' + (f.situacao === 'prazo' && disp < Number(f.limite) * 0.2 ? ' cx-neg' : '') + '">' + (f.situacao === 'prazo' ? esc(R.moeda(disp)) : '—') + '</td>' +
          '<td>' + (f.prazo_max ? f.prazo_max + ' dias' : '—') + '</td><td>' + (venc ? CRM.selo(R.dataBR(f.revisar_em), 'ambar') : esc(R.dataBR(f.revisar_em || ''))) + '</td>' +
          '<td class="acoes-linha">' + (f.pdf ? '<button type="button" class="mini" data-acao="cred-pdf" data-id="' + esc(f.empresa_id) + '">Consulta</button> ' : '') +
            '<button type="button" class="mini" data-acao="cred-analisar" data-id="' + esc(f.empresa_id) + '">' + (venc ? 'Revisar' : 'Editar') + '</button></td></tr>';
      }).join('') + '</tbody></table></div>' + (l.length > 500 ? '<p class="mais">mostrando 500 de ' + l.length + ': use a busca</p>' : '<p class="mais">' + l.length + ' ficha(s)</p>');
  }
  function depoisAba(el) {
    carrega();
    const mt = el.querySelector('#credMarcaTodos');
    if (mt) mt.addEventListener('change', () => el.querySelectorAll('.cred-marca').forEach(x => { x.checked = mt.checked; }));
    const b = el.querySelector('#credBusca');
    if (b) b.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); CRM.acoes['cred-buscar'](); } });
    // a busca redesenha só a tabela (redesenhar a tela tiraria o cursor da caixa)
    const fb = el.querySelector('#credFiltroBusca'), alvo = el.querySelector('#credFichas');
    if (fb && alvo) fb.addEventListener('input', () => { vf.busca = fb.value; alvo.innerHTML = tabelaFichas((painel && painel.fichas) || []); });
  }

  // Botão "Consultar crédito": um link de verdade (<a target=_blank>), que o navegador abre sem bloquear; o clique só
  // copia o CNPJ. Sem endereço configurado, vira botão que pede o endereço.
  // acao 'cred-analisar-site' (27/10/2026, pedido do Anderson: "só deixar o Analisar"): o mesmo clique abre o site com o
  // CNPJ copiado e a janela da análise no CRM, onde se solta o PDF.
  function linkConsultar(id, rotulo, cls, acao) {
    const u = linkConsulta();
    if (!u) return '<button type="button" class="' + cls + '" data-acao="' + (acao ? (viaApi() ? 'cred-analisar-api' : 'cred-analisar') : 'cred-endereco') + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + '>' + esc(rotulo) + '</button>';
    return '<a class="' + cls + '" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" data-acao="' + (acao || 'cred-consultar') + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + '>' + esc(rotulo) + '</a>';
  }
  function consultar(id) {
    const e = id && CRM.empresa(id), doc = docTxt(e);
    if (doc && navigator.clipboard) navigator.clipboard.writeText(R.chaveDoc ? R.chaveDoc(doc) : doc.replace(/\D/g, '')).then(() => CRM.toast('CNPJ ' + doc + ' copiado: cole no site de consulta (Ctrl+V). Depois solte o PDF em "Analisar".')).catch(() => {});
    else if (doc) CRM.toast('CNPJ do cliente: ' + doc);
  }

  // Formulário da análise: consulta (PDF lido pela IA) → proposta pela política → aprovar.
  async function analisar(id, siteAberto, consultaJa) {
    const e = CRM.empresa(id);
    if (!e) { CRM.toast('Cliente não encontrado (fora da sua lista?).', true); return; }
    let atual = null;
    try { atual = await CRM.store().creditoVer(id); } catch (err) { /* sem ficha */ }
    const ficha = atual && atual.situacao !== 'sem_ficha' ? atual : null;
    const s = (painel && (painel.sugestoes || []).find(x => x.empresa_id === id)) || null;
    const ctx = { maior_mes: s ? s.maior_mes : 0, vencido: s ? s.vencido : (ficha ? 0 : 0), hoje: CRM.hoje() };
    let lida = ficha && ficha.resumo && ficha.resumo.consulta ? ficha.resumo.consulta : null, pdf = null;
    const fatos = () => '<div id="credFatos" class="cred-fatos">' + (lida ? '<ul>' + resumoFatos(lida).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p class="dica">Ainda sem consulta: solte o PDF acima ou preencha à mão.</p>') + '</div>';
    const prop = p => '<div id="credProposta" class="cred-proposta">' + (p ? '<p><strong>Proposta pela política:</strong> ' + seloSit(p.situacao) + (p.situacao === 'prazo' ? ' ' + esc(R.moeda(p.limite)) + ' · ' + p.prazo_max + ' dias' : '') + '</p>' +
      '<ul>' + p.motivos.map(m => '<li>' + esc(m) + '</li>').join('') + '</ul>' + (p.atencao.length ? '<p class="alerta"><strong>Atenção:</strong> ' + esc(p.atencao.join(' · ')) + '</p>' : '') : '') + '</div>';
    const v0 = ficha ? { situacao: ficha.situacao, limite: ficha.limite, prazo_max: ficha.prazo_max, revisar_em: ficha.revisar_em, obs: ficha.obs || '' }
      : s ? { situacao: s.situacao, limite: s.limite, prazo_max: s.prazo_max } : { situacao: 'analise' };
    CRM.abrirForm({
      titulo: 'Crédito: ' + e.nome, largura: 'largo',
      htmlAntes: '<div class="cred-form"><p>' + esc(e.cnpj || 'sem CNPJ') + (ficha ? ' · ficha de ' + esc(R.dataBR(ficha.analisado_em)) + ' · usado hoje ' + esc(R.moeda(ficha.usado || 0)) : s ? ' · em aberto ' + esc(R.moeda(s.aberto)) : '') + '</p>' +
        (siteAberto ? '<p class="dica"><strong>O site da consulta abriu numa aba nova, com o CNPJ copiado:</strong> cole no Documento (Ctrl+V), clique em Consulta, baixe o PDF e solte aqui.</p>' : '') +
        '<div class="cred-passos">' + (CRM.store().creditoRekta ? '<button type="button" class="btn" id="credApi" title="A Rekta responde direto ao CRM (cada consulta é cobrada pela Rekta: ' + R.moeda(precoApi()) + ')">Consultar na Rekta pela API (' + R.moeda(precoApi()) + ')</button>' : '') +
        (viaApi() ? '' : linkConsultar(id, siteAberto ? 'Abrir o site de novo' : 'Ou: abrir o site (copia o CNPJ)', 'btn sec')) +
        '<label class="btn sec arquivo">' + (viaApi() ? 'Ou: soltar um PDF da consulta' : 'e soltar o PDF da consulta') + '<input type="file" id="credArq" accept="application/pdf,image/png,image/jpeg,image/webp"></label>' +
        '<span id="credLendo"></span></div>' + fatos() + prop(lida ? propor(lida, ctx) : null) + '</div>',
      campos: [
        { nome: 'compra', rotulo: 'Compra prevista por mês (R$)', tipo: 'numero', terco: true, ajuda: 'o que o cliente deve comprar por mês; sem isso, vale o histórico ou R$ 1.500' },
        { nome: 'situacao', rotulo: 'Situação', tipo: 'select', obrigatorio: true, terco: true, opcoes: [['prazo', SITUACOES.prazo], ['vista', SITUACOES.vista], ['analise', SITUACOES.analise]] },
        { nome: 'limite', rotulo: 'Limite (R$)', tipo: 'numero', terco: true },
        { nome: 'prazo_max', rotulo: 'Prazo máximo (dias)', tipo: 'numero', passo: '1', max: 365, terco: true, vazioNulo: true },
        { nome: 'revisar_em', rotulo: 'Revisar em', tipo: 'data', terco: true },
        { nome: 'obs', rotulo: 'Observação', tipo: 'textarea', largo: true, linhas: 2 }
      ],
      valores: v0, salvarTexto: 'Aprovar',
      extras: form => {
        // o botão diz o que vai ser gravado (28/10/2026: "Aprovar" com a proposta "Só à vista" foi tomado por liberar)
        const rotulo = () => {
          const bt = form.querySelector('button[type=submit]');
          if (!bt) return;
          const sit = form.elements.situacao.value, lim = Number(String(form.elements.limite.value || '').replace(',', '.')) || 0;
          bt.textContent = sit === 'prazo' ? 'Aprovar: a prazo' + (lim > 0 ? ', ' + R.moeda(lim) : '') : sit === 'vista' ? 'Aprovar: só à vista' : 'Aprovar: em análise';
        };
        form.elements.situacao.addEventListener('change', rotulo);
        form.elements.limite.addEventListener('input', rotulo);
        rotulo();
        const aplica = () => {
          if (!lida) return;
          const comp = Number(String(form.elements.compra.value || '').replace(',', '.')) || 0;
          const p = propor(lida, Object.assign({}, ctx, { compra_mensal: comp }));
          form.querySelector('#credProposta').outerHTML = prop(p);
          form.elements.situacao.value = p.situacao; form.elements.limite.value = p.limite; form.elements.prazo_max.value = p.prazo_max == null ? '' : p.prazo_max;
          form.elements.revisar_em.value = p.revisar_em;
          rotulo();
        };
        form.elements.compra.addEventListener('change', aplica);
        const arq = form.querySelector('#credArq'), st = form.querySelector('#credLendo');
        const le = async f => {
          if (!f) return;
          st.textContent = 'Lendo a consulta…';
          try {
            pdf = await CRM.store().creditoEnviar(f, id);
            const r = await CRM.store().creditoLer(pdf);
            lida = r.consulta;
            form.querySelector('#credFatos').outerHTML = fatos();
            st.textContent = r.aviso ? '⚠ ' + r.aviso : (lida.razao_social ? 'Lido: ' + lida.razao_social : 'Lido.');
            const docLido = lida.documento, docCad = R.chaveDoc ? R.chaveDoc(e.cnpj || '') : String(e.cnpj || '').replace(/\D/g, '');
            if (docLido && docCad && docLido !== docCad) st.textContent = '⚠ O CNPJ da consulta (' + docLido + ') não é o do cadastro (' + docCad + '). Confira antes de aprovar.';
            aplica();
          } catch (err) { st.textContent = ''; CRM.falhou(err); }
        };
        arq.addEventListener('change', () => { const f = arq.files[0]; arq.value = ''; le(f); });
        // Consulta pela API da Rekta (28/10/2026): a resposta vem inteira e o app lê os fatos (daRekta), sem IA
        const api = form.querySelector('#credApi');
        if (api) api.addEventListener('click', async () => {
          const doc = R.chaveDoc ? R.chaveDoc(e.cnpj || '') : String(e.cnpj || '').replace(/\D/g, '');
          if (doc.length !== 14 && doc.length !== 11) { CRM.toast('O cadastro não tem CNPJ (ou CPF) completo: preencha antes de consultar.', true); return; }
          if (!confirm('Consultar ' + (e.cnpj || doc) + ' na Rekta agora?\n\nEsta consulta custa ' + R.moeda(precoApi()) + ' (cobrada pela Rekta).' + (ficha && ficha.analisado_em ? '\nA última análise deste cliente é de ' + R.dataBR(ficha.analisado_em) + '.' : ''))) return;
          api.disabled = true; st.textContent = 'Consultando a Rekta (pode levar até 1 minuto)…';
          try {
            const r = await CRM.store().creditoRekta(doc, id);
            lida = daRekta(r.bruto, doc, CRM.hoje());
            if (r.caminho) pdf = r.caminho;
            form.querySelector('#credFatos').outerHTML = fatos();
            st.textContent = 'Consulta da Rekta pela API' + (lida.razao_social ? ': ' + lida.razao_social : '') + (Object.keys(r.bruto || {}).length ? '' : ' (nada consta)') + '.';
            aplica();
          } catch (err) { st.textContent = ''; CRM.falhou(err); }
          api.disabled = false;
        });
        // "Analisar" de cliente sem ficha: a consulta começa sozinha (o confirm do preço continua). Se já houve consulta pela API
        // nos últimos 30 dias, usa a resposta guardada, sem cobrar de novo (o botão continua para uma consulta nova).
        if (api && consultaJa) setTimeout(async () => {
          let ult = null;
          try { ult = CRM.store().creditoRektaUltima ? await CRM.store().creditoRektaUltima(id) : null; } catch (err) { ult = null; }
          if (ult && ult.bruto && (Date.now() - new Date(ult.em).getTime()) < 30 * 864e5) {
            const doc = R.chaveDoc ? R.chaveDoc(e.cnpj || '') : String(e.cnpj || '').replace(/\D/g, '');
            lida = daRekta(ult.bruto, doc, R.diaLocal ? R.diaLocal(ult.em) : String(ult.em).slice(0, 10));
            if (ult.caminho) pdf = ult.caminho;
            form.querySelector('#credFatos').outerHTML = fatos();
            st.textContent = 'Consulta da Rekta de ' + R.dataBR(R.diaLocal ? R.diaLocal(ult.em) : String(ult.em).slice(0, 10)) + ' (já feita, sem nova cobrança)' + (lida.razao_social ? ': ' + lida.razao_social : '') + '.';
            aplica();
          } else api.click();
        }, 0);
        const zona = form.querySelector('.cred-passos');
        zona.addEventListener('dragover', ev => { if (ev.dataTransfer && [].slice.call(ev.dataTransfer.types || []).indexOf('Files') !== -1) { ev.preventDefault(); zona.classList.add('cx-solta'); } });
        zona.addEventListener('dragleave', () => zona.classList.remove('cx-solta'));
        zona.addEventListener('drop', ev => { const f = ev.dataTransfer && ev.dataTransfer.files[0]; if (!f) return; ev.preventDefault(); zona.classList.remove('cx-solta'); le(f); });
      },
      aoSalvar: async v => {
        if (v.situacao === 'prazo' && !(v.limite > 0)) throw new Error('para liberar a prazo, diga o limite');
        await CRM.store().creditoGravar([{ empresa_id: id, situacao: v.situacao, limite: v.situacao === 'prazo' ? v.limite : 0, prazo_max: v.situacao === 'prazo' ? v.prazo_max : null,
          revisar_em: v.revisar_em || null, score: lida && lida.score ? lida.score : null, origem: lida ? 'consulta' : 'manual',
          resumo: lida ? { consulta: lida, compra_mensal: v.compra || null } : null, pdf, obs: v.obs || '' }]);
        cacheVer.delete(id);
        CRM.toast('Crédito de ' + e.nome + ' aprovado: ' + (SITUACOES[v.situacao] || v.situacao) + (v.situacao === 'prazo' ? ' · ' + R.moeda(v.limite) : '') + '.');
        carrega(true);
      }
    });
  }

  // ANÁLISE EM LOTE (28/10/2026, Anderson: "marcar mais de um, e aí já faz uma análise só e depois eu só vou dando OK"):
  // marca na lista Para analisar → uma confirmação com o custo total → consulta a Rekta de cada um (a consulta guardada dos
  // últimos 30 dias é reaproveitada, sem pagar) → proposta pela política em cada linha, ajustável → OK grava a ficha.
  async function analisarLote(ids) {
    if (!ids.length) { CRM.toast('Marque os clientes na lista "Para analisar".', true); return; }
    const st = CRM.store(), hoje = CRM.hoje();
    const docDe = e => (R.chaveDoc ? R.chaveDoc((e && e.cnpj) || '') : String((e && e.cnpj) || '').replace(/\D/g, ''));
    const itens = [];
    for (const id of ids) {
      const e = CRM.empresa(id);
      if (!e) continue;
      const doc = docDe(e);
      let ult = null;
      try { ult = st.creditoRektaUltima ? await st.creditoRektaUltima(id) : null; } catch (err) { ult = null; }
      const s = (painel && (painel.sugestoes || []).find(x => x.empresa_id === id)) || null;
      itens.push({ id, e, doc, valido: doc.length === 11 || doc.length === 14, guardada: ult && ult.bruto && (Date.now() - new Date(ult.em).getTime()) < 30 * 864e5 ? ult : null,
        ctx: { maior_mes: s ? s.maior_mes : 0, vencido: s ? s.vencido : 0, hoje } });
    }
    const novas = itens.filter(i => i.valido && !i.guardada), guardadas = itens.filter(i => i.valido && i.guardada), invalidos = itens.filter(i => !i.valido);
    if (!novas.length && !guardadas.length) { CRM.toast('Nenhum dos marcados tem CNPJ (ou CPF) completo no cadastro.', true); return; }
    if (!confirm('Analisar ' + (novas.length + guardadas.length) + ' cliente(s) agora?\n\n' +
      (novas.length ? novas.length + ' consulta(s) nova(s) à Rekta × ' + R.moeda(precoApi()) + ' = ' + R.moeda(novas.length * precoApi()) + ' (cobrado pela Rekta).\n' : '') +
      (guardadas.length ? guardadas.length + ' já consultado(s) nos últimos 30 dias: sem nova cobrança.\n' : '') +
      (invalidos.length ? invalidos.length + ' sem CNPJ completo no cadastro: fica(m) de fora.\n' : ''))) return;
    const linha = i => '<tr data-lote="' + esc(i.id) + '"><td><strong>' + esc(i.e.nome) + '</strong><small>' + esc(i.e.cnpj || 'sem CNPJ') + '</small></td>' +
      '<td class="cl-fatos">' + (i.valido ? '<small>' + (i.guardada ? 'lendo a consulta guardada…' : 'na fila da Rekta…') + '</small>' : '<span class="alerta">CNPJ incompleto no cadastro: corrija e analise de novo</span>') + '</td>' +
      '<td class="cl-prop"></td><td class="cl-acao"></td></tr>';
    const form = CRM.abrirForm({
      titulo: 'Análise de crédito em lote', largura: 'largo', semFoco: true, campos: [], salvarTexto: 'OK em todos os que faltam',
      htmlAntes: '<p class="dica">Confira cada linha: dá para trocar a situação, o limite e o prazo antes do OK. Revisão em 6 meses.</p>' +
        '<div class="tabela-rolagem"><table class="tabela cred-lote-tab"><thead><tr><th>Cliente</th><th>Consulta</th><th>Proposta</th><th></th></tr></thead><tbody>' +
        itens.map(linha).join('') + '</tbody></table></div>',
      aoSalvar: async (v, f) => {
        const prontas = [].slice.call(f.querySelectorAll('tr[data-pronta="1"]:not([data-ok])'));
        if (!prontas.length) { if ([].slice.call(f.querySelectorAll('tr[data-lote]')).some(tr => !tr.dataset.ok && !tr.dataset.fim)) { CRM.toast('Ainda há consulta em andamento.', true); return false; } return; }
        for (const tr of prontas) await aprovaLinha(tr);
        carrega(true);
      }
    });
    const dados = new Map();
    const tr = id => form.querySelector('tr[data-lote="' + id + '"]');
    async function aprovaLinha(t) {
      const i = dados.get(t.dataset.lote);
      if (!i || t.dataset.ok) return;
      const situacao = t.querySelector('[name=sit]').value, limite = Number(String(t.querySelector('[name=lim]').value || '').replace(/\./g, '').replace(',', '.')) || 0;
      const prazo = Number(t.querySelector('[name=prz]').value) || null;
      if (situacao === 'prazo' && !(limite > 0)) { CRM.toast(i.e.nome + ': para liberar a prazo, diga o limite.', true); throw new Error('limite vazio'); }
      await st.creditoGravar([{ empresa_id: i.id, situacao, limite: situacao === 'prazo' ? limite : 0, prazo_max: situacao === 'prazo' ? prazo : null,
        revisar_em: i.prop.revisar_em, score: i.lida.score || null, origem: 'consulta', resumo: { consulta: i.lida, lote: true }, pdf: i.caminho || null, obs: '' }]);
      cacheVer.delete(i.id);
      t.dataset.ok = '1';
      t.querySelector('.cl-acao').innerHTML = CRM.selo('✓ aprovado', 'verde');
      t.querySelectorAll('select, input').forEach(x => { x.disabled = true; });
    }
    const mostra = (i, lida, caminho, aviso) => {
      const t = tr(i.id);
      if (!t) return;
      const p = propor(lida, i.ctx);
      dados.set(i.id, Object.assign({}, i, { lida, prop: p, caminho }));
      t.querySelector('.cl-fatos').innerHTML = (aviso ? '<small>' + esc(aviso) + '</small>' : '') + '<ul>' + resumoFatos(lida).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
      t.querySelector('.cl-prop').innerHTML = seloSit(p.situacao) + '<ul>' + p.motivos.map(m => '<li>' + esc(m) + '</li>').join('') + '</ul>' +
        (p.atencao.length ? '<p class="alerta">' + esc(p.atencao.join(' · ')) + '</p>' : '') +
        '<p><select name="sit">' + Object.keys(SITUACOES).map(k => '<option value="' + k + '"' + (k === p.situacao ? ' selected' : '') + '>' + esc(SITUACOES[k]) + '</option>').join('') + '</select> ' +
        '<label>limite <input name="lim" inputmode="decimal" size="7" value="' + (p.limite || '') + '"></label> <label>prazo <input name="prz" inputmode="numeric" size="3" value="' + (p.prazo_max || '') + '"> dias</label></p>';
      t.querySelector('.cl-acao').innerHTML = '<button type="button" class="btn" data-ok>OK</button>';
      // o OK diz o que grava (a proposta "Só à vista" não libera nada)
      const okRot = () => { const sit = t.querySelector('[name=sit]').value; t.querySelector('[data-ok]').textContent = sit === 'prazo' ? 'OK: a prazo' : sit === 'vista' ? 'OK: só à vista' : 'OK: em análise'; };
      t.querySelector('[name=sit]').addEventListener('change', okRot);
      okRot();
      t.dataset.pronta = '1';
      t.querySelector('[data-ok]').addEventListener('click', ev => { ev.target.disabled = true; aprovaLinha(t).catch(err => { ev.target.disabled = false; if (err.message !== 'limite vazio') CRM.falhou(err); }); });
    };
    invalidos.forEach(i => { const t = tr(i.id); if (t) t.dataset.fim = '1'; });
    guardadas.forEach(i => mostra(i, daRekta(i.guardada.bruto, i.doc, R.diaLocal ? R.diaLocal(i.guardada.em) : String(i.guardada.em).slice(0, 10)), i.guardada.caminho,
      'consulta de ' + R.dataBR(R.diaLocal ? R.diaLocal(i.guardada.em) : String(i.guardada.em).slice(0, 10)) + ', sem nova cobrança'));
    // as novas, três de cada vez (a Rekta pode levar até 1 minuto em cada)
    const fila = novas.slice();
    const trabalha = async () => {
      for (let i = fila.shift(); i; i = fila.shift()) {
        const t = tr(i.id);
        if (t) t.querySelector('.cl-fatos').innerHTML = '<small>consultando a Rekta…</small>';
        try { const r = await st.creditoRekta(i.doc, i.id); mostra(i, daRekta(r.bruto, i.doc, hoje), r.caminho, ''); }
        catch (err) { const t2 = tr(i.id); if (t2) { t2.dataset.fim = '1'; t2.querySelector('.cl-fatos').innerHTML = '<span class="alerta">' + esc(err.message || String(err)) + '</span>'; } }
      }
    };
    await Promise.all([trabalha(), trabalha(), trabalha()]);
    carrega(true);
  }

  // Bloco na ficha do cliente: preenchido depois de abrir (a leitura é por função do banco).
  function blocoFicha(id) { return '<section class="credito" data-credito="' + esc(id) + '"></section>'; }
  async function preencheFicha(raizEl, id) {
    const el = raizEl && raizEl.querySelector('[data-credito="' + id + '"]');
    if (!el || CRM.store().modo !== 'supabase') return;
    let v = cacheVer.get(id);
    try { if (!v || Date.now() - v.em > 60000) { v = { em: Date.now(), d: await CRM.store().creditoVer(id) }; cacheVer.set(id, v); } } catch (e) { return; }
    const d = v.d;
    if (!d) return;
    if (!CRM.ehGestor()) { const t = textoEquipe(d); el.innerHTML = t ? '<h3>Crédito</h3><p class="resumo-compras">' + esc(t) + '</p>' : ''; return; }
    const editar = !CRM.ehAdmin() ? '' : d.situacao === 'sem_ficha' ? ' ' + linkConsultar(id, 'Analisar', 'mini', 'cred-analisar-site')
      : ' <button type="button" class="mini" data-acao="cred-analisar" data-id="' + esc(id) + '">Editar</button>';
    el.innerHTML = '<h3>Crédito' + editar + '</h3><p class="resumo-compras">' + (d.situacao === 'sem_ficha' ? 'Sem análise de crédito' + (d.ligado ? ': pedido a prazo fica bloqueado.' : '.')
      : seloSit(d.situacao) + (d.situacao === 'prazo' ? ' limite <strong>' + esc(R.moeda(d.limite)) + '</strong> · usado ' + esc(R.moeda(d.usado)) + ' · disponível <strong>' + esc(R.moeda(d.disponivel)) + '</strong>' + (d.prazo_max ? ' · até ' + d.prazo_max + ' dias' : '') : '') +
        (d.score ? '<br>score ' + d.score : '') + (d.analisado_em ? ' · analisado em ' + esc(R.dataBR(d.analisado_em)) : '') + (d.revisao_vencida ? ' ' + CRM.selo('revisão vencida', 'ambar') : '') +
        (d.obs ? '<br><em>' + esc(d.obs) + '</em>' : '')) + (d.ligado ? '' : '<br><small>trava de crédito desligada (Caixa → Crédito)</small>') + '</p>';
  }

  CRM.credito = { aba, depoisAba, blocoFicha, preencheFicha, contagem: () => (painel ? (painel.pendentes || []).length : 0), consultar, analisar };

  Object.assign(CRM.acoes, {
    'cred-atualiza': () => carrega(true),
    'cred-filtro': id => { vf.filtro = id || ''; CRM.render(); },
    'cred-ordem': id => { if (vf.ordem === id) vf.desc = !vf.desc; else { vf.ordem = id; vf.desc = ['limite', 'usado', 'disp'].indexOf(id) !== -1; } CRM.render(); },
    'cred-endereco': async () => {
      const c = cfg(), u = prompt('Endereço do site de consulta de crédito (onde você faz a pesquisa):', c.url || '');
      if (u == null) return;
      if (u && !/^https:\/\//i.test(u.trim())) { CRM.toast('O endereço precisa começar com https://', true); return; }
      try { await CRM.salvarConfig({ credito: Object.assign({}, c, { url: u.trim() }) }); CRM.toast(u ? 'Endereço salvo.' : 'Endereço apagado.'); } catch (e) { CRM.falhou(e); }
    },
    'cred-consultar': id => consultar(id),
    'cred-analisar': id => { analisar(id).catch(CRM.falhou); },
    'cred-analisar-site': id => { consultar(id); analisar(id, true).catch(CRM.falhou); },
    'cred-analisar-api': id => { analisar(id, false, true).catch(CRM.falhou); },
    'cred-lote': () => { analisarLote([].slice.call(document.querySelectorAll('.cred-marca:checked')).map(x => x.value)).catch(CRM.falhou); },
    'cred-buscar': () => {
      const t = String((document.querySelector('#credBusca') || {}).value || '').trim();
      if (!t) return;
      const doc = (t.split('·').pop() || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase(), nome = t.split('·')[0].trim().toLowerCase();
      const l = (CRM.estado.D.empresas || []).filter(e => (doc.length >= 8 && String(e.cnpj || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase() === doc) || String(e.nome || '').toLowerCase() === nome);
      if (!l.length) { CRM.toast('Não achei esse cliente. Escolha da lista (nome · CNPJ).', true); return; }
      // cliente sem ficha: abre o site junto (ainda dentro do clique, senão o navegador bloqueia a aba)
      const semFicha = !((painel && painel.fichas) || []).some(f => f.empresa_id === l[0].id);
      if (semFicha && linkConsulta()) { raiz.open(linkConsulta(), '_blank', 'noopener'); consultar(l[0].id); }
      analisar(l[0].id, semFicha && !!linkConsulta(), semFicha && viaApi()).catch(CRM.falhou);
    },
    'cred-pdf': async id => {
      const f = ((painel && painel.fichas) || []).find(x => x.empresa_id === id);
      if (!f || !f.pdf) return;
      const w = raiz.open('', '_blank');
      try { const u = await CRM.store().creditoLink(f.pdf); if (w) w.location = u; else raiz.location.assign(u); } catch (e) { if (w) w.close(); CRM.falhou(e); }
    },
    'cred-aplicar': async () => {
      const sug = (painel && painel.sugestoes) || [];
      if (!sug.length) return;
      const pr = sug.filter(s => s.situacao === 'prazo').length;
      if (!confirm('Criar a ficha de crédito de ' + sug.length + ' cliente(s) pelo histórico? ' + pr + ' liberados a prazo, ' + (sug.length - pr) + ' em análise (têm título vencido). Revisão em 6 meses.')) return;
      const itens = sug.map(s => ({ empresa_id: s.empresa_id, situacao: s.situacao, limite: s.limite, prazo_max: s.situacao === 'prazo' ? s.prazo_max : null, origem: 'historico',
        obs: 'Pelo histórico: maior mês ' + R.moeda(s.maior_mes) + ' em ' + s.meses + ' mês(es) com compra' }));
      try {
        let n = 0;
        for (let i = 0; i < itens.length; i += 200) n += await CRM.store().creditoGravar(itens.slice(i, i + 200));
        cacheVer.clear();
        CRM.toast(n + ' ficha(s) de crédito criadas.');
        carrega(true);
      } catch (e) { CRM.falhou(e); }
    },
    'cred-ligar': async () => {
      const c = cfg(), liga = c.ligado !== true;
      const semFicha = ((painel && painel.sugestoes) || []).length;
      if (liga && !confirm('Ligar a trava de crédito? Pedido a prazo de cliente sem ficha, só à vista, com prazo maior que o permitido ou acima do limite fica BLOQUEADO até você liberar.' +
        (semFicha ? '\n\nAinda há ' + semFicha + ' cliente(s) que já compram sem ficha: os pedidos a prazo deles vão parar em SEM ANÁLISE.' : ''))) return;
      try { await CRM.salvarConfig({ credito: Object.assign({}, c, { ligado: liga }) }); await CRM.store().pedidosAtualizar(); cacheVer.clear(); CRM.toast(liga ? 'Trava de crédito ligada.' : 'Trava de crédito desligada.'); carrega(true); }
      catch (e) { CRM.falhou(e); }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
