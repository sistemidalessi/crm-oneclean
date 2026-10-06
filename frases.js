/* CRM Sistemi Dalessi — Caixa por frases (06/10/2026): o administrador escreve o que aconteceu do
   jeito que fala, uma frase por linha, e o CRM monta os lançamentos para ele conferir antes de gravar.
     "pedágio 350 pago hoje"                    → saída paga hoje
     "combustível 200, almoço 85 pago hoje"     → duas saídas pagas hoje
     "aluguel galpão 4.500 dia 10"              → saída prevista dia 10
     "recebi 2.300 da Cliente X ontem"          → entrada de ontem (baixa o título, se bater)
     "entrou 5 mil da Agilité"                  → entrada entre empresas
     "vai sair 12 mil de fornecedor dia 20"     → saída prevista dia 20
   interpretar(): o leitor do caixa da Agilité (agilite-sistema-gestao, src/caixa/interpretar.js),
   igual na leitura. classificar(): o que é do CRM — cada item vira uma proposta, nesta ordem:
     1. conta em aberto que bate (valor ±8% ou R$ 60, vencimento ±20 dias, uma palavra em comum)
        → baixa nela (ou ajuste, se a frase fala do futuro), sem duplicar;
     2. entrada que bate com título do contas a receber (valor ±0,5%) → baixa o título, igual ao ✓;
     3. cliente ou fornecedor pelo nome; 4. regra aprendida ("lembrar"); 5. categoria pela palavra.
   "Agilité" marca entre empresas. Funções puras, testadas em testes/frases.test.js. */
(function (raiz) {
  'use strict';
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const baixo = s => semAcento(s).toLowerCase();
  const r2 = v => Math.round(Number(v || 0) * 100) / 100;

  // ------------------------------------------------------------ leitura (igual à da Agilité)
  const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
  const ENTRADA = /\b(entrou|entraram|entra|entrar|recebi|recebemos|recebido|recebida|receber|caiu|cairam|cai|credito|creditado|deposito|depositado|depositaram)\b/;
  const SAIDA = /\b(sai|sair|saiu|saida|pagar|pago|paga|paguei|pagamos|pagou|pagamento|devolver|devolvi|devolucao|debito|debitado|debitou|transferi|transferencia|pix)\b/;
  const REALIZADO = /\b(pago|paga|pagos|paguei|pagamos|pagou|saiu|entrou|entraram|recebi|recebemos|recebido|recebida|caiu|cairam|debitado|debitou|transferi|devolvi|depositado|depositaram|creditado)\b/;
  const PREVISTO = /\b(vai|vao|precisa|precisar|precisamos|vence|vencendo|vencimento|previsto|prevista|agendado|agendar|a pagar|a receber|tem que|temos que)\b/;

  const isoDe = d => d.toISOString().slice(0, 10);
  function addDias(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDe(d); }
  const diasNoMes = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
  const dataDe = (a, m, d) => a + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

  // Data no texto: { data, trecho } ou { data: null }. "dia 14" sem mês: no mês corrente; se já
  // passou e a frase fala do futuro, no mês que vem.
  function extrairData(txt, hoje, futuro) {
    const t = baixo(txt);
    const [ha, hm] = hoje.split('-').map(Number);
    let m;
    if ((m = t.match(/\bhoje\b/))) return { data: hoje, trecho: m[0] };
    if ((m = t.match(/\bontem\b/))) return { data: addDias(hoje, -1), trecho: m[0] };
    if ((m = t.match(/\bamanha\b/))) return { data: addDias(hoje, 1), trecho: m[0] };
    if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/))) {
      const d = +m[1], mes = +m[2]; let a = m[3] ? +m[3] : ha; if (a < 100) a += 2000;
      if (mes >= 1 && mes <= 12 && d >= 1 && d <= diasNoMes(a, mes)) return { data: dataDe(a, mes, d), trecho: m[0] };
    }
    if ((m = t.match(/\bdia\s+(\d{1,2})(?:\s+de\s+([a-z]{3})[a-z]*)?\b/))) {
      const d = +m[1]; let mes = m[2] && MESES[m[2]] ? MESES[m[2]] : hm, a = ha;
      if (!m[2]) {
        if (futuro && d < +hoje.slice(8, 10)) { mes++; if (mes > 12) { mes = 1; a++; } }
      } else if (mes < hm - 6) a++;
      if (d >= 1 && d <= diasNoMes(a, mes)) return { data: dataDe(a, mes, d), trecho: m[0] };
    }
    return { data: null, trecho: null };
  }

  // "12.898,29" "48 mil" "1,5 mil" "300" "R$ 1.200" "3k" → número. Ignora "05 de 48" (parcela).
  function extrairValor(txt) {
    const t = baixo(txt).replace(/\b\d+\s*de\s*\d+\b/g, ' ');
    const re = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?|\d+\.\d{1,2})(\s*(?:mil|k)\b)?/g;
    let m;
    while ((m = re.exec(t))) {
      let s = m[1];
      if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
      else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
      let v = parseFloat(s);
      if (m[2]) v *= 1000;
      if (v > 0) return { valor: r2(v), trecho: m[0] };
    }
    return { valor: null, trecho: null };
  }

  const temValor = txt => extrairValor(txt.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ').replace(/\bdia\s+\d{1,2}\b/gi, ' ')).valor != null;

  // Pedaços da frase: vírgula (fora de centavos), ";", " mas ", " depois ", " + " sempre separam;
  // " e " separa quando os dois lados têm valor ("VT 300 e VR 500").
  function pedacos(linha) {
    const out = [];
    String(linha).split(/;|,(?!\d)|(?<!\d),|\s+mas\s+|\s+depois\s+|\s+\+\s+/i).forEach(p => {
      const partes = p.split(/\s+e\s+/i);
      let atual = partes[0];
      for (let i = 1; i < partes.length; i++) {
        if (temValor(atual) && temValor(partes[i])) { out.push(atual); atual = partes[i]; } else atual += ' e ' + partes[i];
      }
      out.push(atual);
    });
    return out.map(s => s.trim()).filter(Boolean);
  }

  // palavras de controle; borda "de letra" com \p{L} (o \b do JS quebra em "almoço")
  const TIRA = new RegExp('(?<![\\p{L}\\d])(?:entrou|entraram|entra|entrar|recebi|recebemos|recebido|recebida|receber|caiu|cairam|credito|creditado|deposito|depositado|depositaram|sai|sair|saiu|pagar|pago|pagos|paga|paguei|pagamos|pagou|pix|transferi|transferencia|vai|vao|precisa|precisar|precisamos|tem que|temos que|vence|vencendo|previsto|prevista|agendado|agendar|hoje|ontem|amanha|ja|foi|foram|que|o|a|os|as|um|uma|do|da|dos|das|de|pro|pra|para|no|na|em|com|valor|reais|referente|ref)(?![\\p{L}\\d])', 'giu');
  const acentosComuns = s => s.replace(/amanhã/gi, 'amanha').replace(/débito/gi, 'debito').replace(/crédito/gi, 'credito').replace(/depósito/gi, 'deposito')
    .replace(/caíram/gi, 'cairam').replace(/saída/gi, 'saida').replace(/já/gi, 'ja');
  // O que sobra sem valor, data e palavras de controle: "do que se trata".
  function rotuloDe(txt, trechos) {
    let s = (' ' + txt + ' ').replace(/\b(\d+)\s+de\s+(\d+)\b/gi, '$1/$2'); // "11 de 13" (parcela) → "11/13"
    (trechos || []).filter(Boolean).forEach(tr => {
      const i = baixo(s).indexOf(baixo(tr));
      if (i >= 0) s = s.slice(0, i) + ' ' + s.slice(i + tr.length);
    });
    s = acentosComuns(s.replace(/r\$/gi, ' ')).replace(TIRA, ' ');
    return s.replace(/\s+/g, ' ').replace(/^[\s\-–—:.]+|[\s\-–—:.]+$/g, '').trim();
  }

  // texto → { itens: [{ linha, frase, trecho, valor, data, tipo, situacao: 'realizado'|'previsto',
  // rotulo, contexto, devolucaoPrevista }], avisos }. opts.dataPadrao / opts.tipoPadrao: digitado
  // pelo "+" de uma célula da grade (o dia e a seção valem quando a frase não diz).
  function interpretar(texto, hoje, opts) {
    opts = opts || {};
    const itens = [], avisos = [];
    String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach((linha, nLinha) => {
      const doLinha = [], contextos = [];
      pedacos(linha).forEach(p => {
        const b = baixo(p);
        const futuro = PREVISTO.test(b);
        const dt = extrairData(p, hoje, futuro || /\b(sai|entra|vence)\b/.test(b));
        const semData = dt.trecho ? (() => { const i = baixo(p).indexOf(dt.trecho); return p.slice(0, i) + ' ' + p.slice(i + dt.trecho.length); })() : p;
        const v = extrairValor(semData);
        const dir = ENTRADA.test(b) ? 'entrada' : SAIDA.test(b) ? 'saida' : null;
        const sit = REALIZADO.test(b) && !futuro ? 'realizado' : futuro ? 'previsto' : null;
        if (v.valor == null) { contextos.push({ data: dt.data, dir, sit, rotulo: rotuloDe(semData, []), apos: doLinha.length }); return; }
        doLinha.push({ linha: nLinha + 1, frase: linha, trecho: p, valor: v.valor, data: dt.data, tipo: dir, situacao: sit, rotulo: rotuloDe(semData, [v.trecho]) });
      });
      if (!doLinha.length) { avisos.push('Linha ' + (nLinha + 1) + ': não achei valor em "' + linha + '".'); return; }
      // contexto sem valor: "sai dia 14" logo depois de uma entrada = devolução prevista dela; o resto
      // (data, pago/previsto, nome) vale para os itens da frase que não têm o seu
      const nomeExtra = [];
      contextos.forEach(c => {
        const ant = doLinha[c.apos - 1];
        if (ant && ant.tipo === 'entrada' && c.dir === 'saida' && c.data) { ant.devolucaoPrevista = c.data; return; }
        doLinha.forEach(it => {
          if (!it.data && c.data) it.data = c.data;
          if (!it.situacao && c.sit) it.situacao = c.sit;
          if (!it.tipo && c.dir === 'entrada') it.tipo = 'entrada';
        });
        if (c.rotulo) nomeExtra.push(c.rotulo);
      });
      // situação: primeiro herda do item anterior ("vai sair 5 mil X e 2 mil Y"), depois da frase toda
      for (let k = 1; k < doLinha.length; k++) if (!doLinha[k].situacao && doLinha[k - 1].situacao) doLinha[k].situacao = doLinha[k - 1].situacao;
      const sits = [...new Set(doLinha.map(i => i.situacao).filter(Boolean))];
      let dirAnt = null;
      doLinha.forEach(it => {
        if (!it.situacao && sits.length === 1) it.situacao = sits[0];
        // data só passa entre itens de mesma situação ("entrou 30 mil, vai sair 5 mil amanhã")
        const datas = [...new Set(doLinha.filter(o => o.data && (!it.situacao || !o.situacao || o.situacao === it.situacao)).map(o => o.data))];
        if (!it.data && datas.length === 1) it.data = datas[0];
        if (!it.tipo) it.tipo = dirAnt || opts.tipoPadrao || 'saida';
        dirAnt = it.tipo;
        it.contexto = nomeExtra.join(' ').trim();
        if (!it.data) it.data = opts.dataPadrao || hoje;
        if (!it.situacao) it.situacao = it.data > hoje ? 'previsto' : 'realizado';
        if (it.situacao === 'realizado' && it.data > hoje) it.situacao = 'previsto';
        if (!it.rotulo && it.contexto) { it.rotulo = it.contexto; it.contexto = ''; }
        itens.push(it);
      });
    });
    return { itens, avisos };
  }

  // ------------------------------------------------------------ classificação (do CRM)
  // Palavras que não identificam nada: genéricas de conta e de razão social.
  const GENERICAS = new Set(('conta contas pagamento pagto boleto boletos nota notas fatura fornecedor fornecedores cliente clientes ' +
    'ltda eireli epp comercio comercial servicos servico industria cia sociedade empresa grupo brasil distribuidora dia mes valor ' +
    'parcela parcelas referente total geral mais outro outra outros outras').split(' '));
  function tokens(s) {
    return [...new Set(baixo(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 3 && !/^\d+$/.test(w) && !GENERICAS.has(w) && !/^(?:que|dos|das|com|pra|para|pro)$/.test(w)))];
  }
  // "combust" casa "combustivel"; "fornecedor" não casa nada (genérica)
  const casaPalavra = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0));
  const emComum = (as, bs) => as.filter(a => bs.some(b => casaPalavra(a, b))).length;
  const dias = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5);

  // Categoria pela palavra (a primeira que casar). Agilité primeiro: marca entre empresas.
  const AGILITE = /agilit/;
  const PALAVRAS = [
    [/\btarifa|\biof\b|taxa bancaria|cesta de servic|\bmanutencao de conta/, 'Tarifas bancárias'],
    [/\bpro.?labore/, 'Pró-labore'],
    [/\bretirada/, 'Retiradas dos sócios'],
    [/\bvt\b|\bvr\b|\bva\b|vale.?transporte|vale.?refei|vale.?alimenta|\bcesta|beneficio/, 'Benefícios (VT, VR, cesta)'],
    [/\bfgts|\binss|encargo|\bgps\b/, 'FGTS e encargos'],
    [/\bsalario|\bfolha\b|\bferias\b|rescis|adiantamento/, 'Salários'],
    [/\baluguel|\blocacao do galpao/, 'Aluguel'],
    [/\benergia|\bluz\b|\benel\b|eletropaulo/, 'Energia'],
    [/\bagua\b|sabesp/, 'Água'],
    [/telefone|internet|celular|\bvivo\b|\bclaro\b|\btim\b|\boi\b/, 'Telefone e internet'],
    [/contab|contador/, 'Contabilidade'],
    [/\bfkn\b/, 'Sistema (FKN)'],
    [/convenio|plano de saude|unimed|\bamil\b|odonto/, 'Convênio médico'],
    [/reparcel|parcelamento/, 'Reparcelamentos'],
    [/imposto|\bdas\b|simples nacional|\bicms|\biss\b|\bdarf|\bipva|\biptu/, 'Impostos'],
    [/cartao/, 'Cartões'],
    [/emprestimo|\bgiro\b|financiamento|pronampe/, 'Empréstimos e giro'],
    [/pedag|combust|gasolina|diesel|etanol|\bfrete|caminhao|\bposto\b|abasteci|\boleo\b/, 'Frete e combustível'],
    [/fornecedor|mercadoria|\bcompra/, 'Fornecedores']
  ];
  function categoriaDe(texto, tipo) {
    const t = baixo(texto);
    if (AGILITE.test(t)) return { categoria: tipo === 'entrada' ? 'Material vendido à Agilité' : 'Reembolso da folha à Agilité', entre_empresas: true };
    if (tipo === 'entrada') return { categoria: /duplicata|boleto|titulo/.test(t) ? 'Duplicatas recebidas' : 'Outras entradas', entre_empresas: false };
    const p = PALAVRAS.find(x => x[0].test(t));
    return { categoria: p ? p[1] : 'Outras saídas', entre_empresas: false };
  }

  // Chave da regra aprendida: as palavras do "do que se trata", em ordem.
  const chaveRegra = rotulo => tokens(rotulo).sort().join(' ');
  function regraDe(regras, tipo, toks) {
    let melhor = null;
    (regras || []).forEach(r => {
      if (r.tipo && r.tipo !== tipo) return;
      const k = String(r.chave || '').split(' ').filter(Boolean);
      if (!k.length || !k.every(w => toks.some(t => casaPalavra(t, w)))) return;
      if (!melhor || k.length > melhor.n) melhor = { r, n: k.length };
    });
    return melhor && melhor.r;
  }

  // Nome de cliente/fornecedor que aparece na frase: as palavras da frase cobrem o nome (metade das
  // palavras dele, duas, ou a primeira, se marcante) — "Sekron" acha "SEKRON COMERCIO LTDA"; "combustível" não acha "POSTO
  // COMBUSTÍVEL SOL" (1 de 3).
  function nomeDe(nomes, toks) {
    let melhor = null;
    (nomes || []).forEach(n => {
      const nt = tokens(n.nome);
      if (!nt.length) return;
      const c = emComum(nt, toks);
      // a primeira palavra do nome, se for marcante, basta ("polar" acha "POLAR IND COM PAPEIS")
      const primeira = nt[0].length >= 5 && toks.some(t => casaPalavra(t, nt[0]));
      if (!c || (c < 2 && c / nt.length < 0.5 && !primeira)) return;
      const nota = c * 10 + c / nt.length;
      if (!melhor || nota > melhor.nota) melhor = { n, nota };
    });
    return melhor && melhor.n;
  }

  // Combinação de títulos do mesmo cliente que soma o valor (até 12 títulos; ±0,5%).
  function somaQueBate(lista, valor, tol) {
    const l = lista.slice(0, 12);
    let achou = null;
    for (let m = 1; m < (1 << l.length) && !achou; m++) {
      let s = 0;
      for (let i = 0; i < l.length; i++) if (m & (1 << i)) s += Number(l[i].valor || 0);
      if (Math.abs(s - valor) <= tol) achou = l.filter((_, i) => m & (1 << i));
    }
    return achou;
  }

  const moeda = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dm = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
  const maiuscula = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  // itens de interpretar() → propostas. ctx: { hoje, lancamentos, titulos, recebidos (Set de
  // duplicatas já baixadas), creditoTitulo(t) → dia que cai, nomeTitulo(t), clientes [{id, nome}],
  // fornecedores [{nome}], regras }. Proposta: o item + { descricao, categoria, fornecedor,
  // entre_empresas, acao, opcoes: [{ acao, rotulo }], motivo, chave }. acao: 'novo' | 'ignorar' |
  // 'baixar:<id>' (conta em aberto paga/recebida) | 'ajustar:<id>' (conta prevista com valor ou dia
  // novo) | 'titulo:<dup>[,<dup>…]' (título(s) do contas a receber recebidos).
  function classificar(itens, ctx) {
    ctx = ctx || {};
    const usados = new Set();
    // recebido = entrada paga com o título; aberta com título = previsão ligada a ele (caixa-calculo.js)
    const recebidos = ctx.recebidos || new Set((ctx.lancamentos || []).filter(l => l.titulo_duplicata && l.situacao === 'pago').map(l => l.titulo_duplicata));
    const nomeTit = ctx.nomeTitulo || (t => t.cliente_nome || 'Cliente');
    const credito = ctx.creditoTitulo || (t => t.vencimento);
    return (itens || []).map(it => {
      const texto = [it.rotulo, it.contexto].filter(Boolean).join(' ');
      const toks = tokens(texto);
      const p = Object.assign({}, it, { opcoes: [], motivo: '', chave: chaveRegra(texto), fornecedor: '', lembrar: false });
      const realizado = it.situacao === 'realizado';
      // 1. conta em aberto do mesmo tipo
      const tol = Math.max(60, it.valor * 0.08);
      const contas = toks.length ? (ctx.lancamentos || []).filter(l => l.situacao === 'aberto' && !l.titulo_duplicata && l.tipo === it.tipo && !usados.has('l:' + l.id) &&
        Math.abs(Number(l.valor) - it.valor) <= tol && Math.abs(dias(l.vencimento, it.data)) <= 20)
        .map(l => ({ l, c: emComum(toks, tokens([l.descricao, l.fornecedor].join(' '))) })).filter(x => x.c > 0)
        .map(x => Object.assign(x, { nota: x.c * 10 - Math.abs(Number(x.l.valor) - it.valor) / tol * 3 - Math.abs(dias(x.l.vencimento, it.data)) / 20 * 2 }))
        .sort((a, b) => b.nota - a.nota) : [];
      const rotConta = l => (realizado ? (it.tipo === 'entrada' ? 'Receber' : 'Pagar') + ' a conta: ' : 'Ajustar a conta: ') + l.descricao + ' · ' + moeda(l.valor) + ' · vence ' + dm(l.vencimento);
      contas.slice(0, 4).forEach(x => p.opcoes.push({ acao: (realizado ? 'baixar:' : 'ajustar:') + x.l.id, rotulo: rotConta(x.l) }));
      // 2. entrada × título do contas a receber
      let tits = [];
      if (it.tipo === 'entrada') {
        const tolT = Math.max(0.01, it.valor * 0.005);
        const abertos = (ctx.titulos || []).filter(t => !recebidos.has(t.duplicata) && !usados.has('t:' + t.duplicata));
        const doNome = t => emComum(toks, tokens(nomeTit(t)));
        tits = abertos.filter(t => Math.abs(Number(t.valor) - it.valor) <= tolT)
          .sort((a, b) => doNome(b) - doNome(a) || Math.abs(dias(credito(a), it.data)) - Math.abs(dias(credito(b), it.data)))
          .map(t => [t]);
        // o cliente pagou vários títulos de uma vez
        const doCliente = toks.length ? abertos.filter(t => nomeDe([{ nome: nomeTit(t) }], toks)) : [];
        if (doCliente.length > 1) {
          const s = somaQueBate(doCliente.sort((a, b) => a.vencimento.localeCompare(b.vencimento)), it.valor, tolT);
          if (s && s.length > 1) tits.unshift(s);
        }
        const rotTit = g => 'Receber ' + (g.length > 1 ? g.length + ' títulos: ' : 'o título: ') + nomeTit(g[0]) + ' · ' + g.map(t => t.duplicata).join(', ') + ' · ' +
          moeda(g.reduce((s, t) => s + Number(t.valor || 0), 0)) + ' · vence ' + dm(g[0].vencimento);
        if (realizado) tits.slice(0, 4).forEach((g, i) => p.opcoes.splice(i, 0, { acao: 'titulo:' + g.map(t => t.duplicata).join(','), rotulo: rotTit(g) }));
      }
      p.opcoes.push({ acao: 'novo', rotulo: 'Lançar novo' }, { acao: 'ignorar', rotulo: 'Não lançar' });

      // 3-5. cliente/fornecedor, regra aprendida, categoria
      const quem = it.tipo === 'entrada' ? nomeDe(ctx.clientes, toks) || nomeDe(ctx.fornecedores, toks) : nomeDe(ctx.fornecedores, toks) || nomeDe(ctx.clientes, toks);
      if (quem) p.fornecedor = quem.nome;
      const cat = categoriaDe(texto + ' ' + (quem ? quem.nome : ''), it.tipo);
      p.categoria = cat.categoria;
      p.entre_empresas = cat.entre_empresas;
      if (it.tipo === 'entrada' && quem && ctx.clientes && ctx.clientes.indexOf(quem) !== -1 && !cat.entre_empresas) p.categoria = 'Duplicatas recebidas';
      if (it.tipo === 'saida' && quem && ctx.fornecedores && ctx.fornecedores.indexOf(quem) !== -1 && p.categoria === 'Outras saídas') p.categoria = 'Fornecedores';
      const regra = regraDe(ctx.regras, it.tipo, toks);
      if (regra) {
        if (regra.categoria) p.categoria = regra.categoria;
        if (regra.fornecedor) p.fornecedor = regra.fornecedor;
        p.entre_empresas = !!regra.entre_empresas || p.entre_empresas;
        p.regra = regra.id || true;
      }
      if (AGILITE.test(baixo(p.categoria + ' ' + p.fornecedor))) p.entre_empresas = true;
      p.descricao = maiuscula(it.rotulo || it.contexto || p.fornecedor || p.categoria);

      // ação proposta
      if (realizado && tits.length) {
        const g = tits[0];
        p.acao = 'titulo:' + g.map(t => t.duplicata).join(',');
        g.forEach(t => usados.add('t:' + t.duplicata));
        p.motivo = g.length > 1 ? 'a soma bate com ' + g.length + ' títulos de ' + nomeTit(g[0]) : 'bate com o título ' + g[0].duplicata + ' de ' + nomeTit(g[0]);
      } else if (contas.length) {
        const l = contas[0].l;
        usados.add('l:' + l.id);
        if (realizado) { p.acao = 'baixar:' + l.id; p.motivo = 'bate com a conta em aberto "' + l.descricao + '" (' + moeda(l.valor) + ', vence ' + dm(l.vencimento) + ')'; }
        else if (r2(l.valor) === it.valor && l.vencimento === it.data) { p.acao = 'ignorar'; p.motivo = 'já está no caixa: "' + l.descricao + '" (' + moeda(l.valor) + ', vence ' + dm(l.vencimento) + ')'; }
        else { p.acao = 'ajustar:' + l.id; p.motivo = 'já existe "' + l.descricao + '" (' + moeda(l.valor) + ', vence ' + dm(l.vencimento) + '): ajusta valor e dia, sem duplicar'; }
      } else if (it.tipo === 'entrada' && !realizado && (ctx.titulos || []).some(t => !recebidos.has(t.duplicata) && Math.abs(Number(t.valor) - it.valor) <= Math.max(0.01, it.valor * 0.005))) {
        p.acao = 'ignorar'; p.motivo = 'já está previsto por um título do contas a receber';
      } else {
        p.acao = 'novo';
        p.motivo = regra ? 'regra lembrada' : quem ? (it.tipo === 'entrada' ? 'de ' : 'para ') + quem.nome : '';
      }
      return p;
    });
  }

  // Proposta conferida → o que gravar. { inserir: [lanc], atualizar: [{ id, patch }], titulos: [dup] }.
  // O estado anterior vai em frase_antes, para o Desfazer voltar a baixa.
  function gravacao(p, ctx) {
    const agora = ctx.agora || new Date().toISOString();
    const pago = p.situacao === 'realizado';
    const [acao, alvo] = [p.acao.split(':')[0], p.acao.slice(p.acao.indexOf(':') + 1)];
    if (acao === 'ignorar') return { inserir: [], atualizar: [], titulos: [] };
    if (acao === 'baixar' || acao === 'ajustar') {
      const l = (ctx.lancamentos || []).find(x => x.id === alvo);
      if (!l) throw new Error('a conta "' + alvo + '" não está mais no caixa');
      const antes = { situacao: l.situacao, pago_em: l.pago_em || null, baixa: l.baixa || null, baixado_em: l.baixado_em || null, valor: l.valor, vencimento: l.vencimento };
      const patch = acao === 'baixar' ? { situacao: 'pago', pago_em: p.data, baixa: 'caixa', baixado_em: agora, valor: r2(p.valor) } : { valor: r2(p.valor), vencimento: p.data };
      return { inserir: [], atualizar: [{ id: l.id, patch: Object.assign(patch, { frase: p.frase, frase_antes: antes }) }], titulos: [] };
    }
    if (acao === 'titulo') {
      const dups = alvo.split(',');
      const tits = dups.map(d => (ctx.titulos || []).find(t => t.duplicata === d)).filter(Boolean);
      if (tits.length !== dups.length) throw new Error('título não encontrado no contas a receber');
      const nomeTit = ctx.nomeTitulo || (t => t.cliente_nome || 'Cliente');
      // previsão ligada ao título (ex.: material vendido à Agilité): ela vira o recebimento
      const ligada = t => (ctx.lancamentos || []).find(l => l.situacao === 'aberto' && l.titulo_duplicata === t.duplicata);
      const valorDe = t => r2(tits.length === 1 ? p.valor : t.valor);
      const atualizar = tits.filter(ligada).map(t => { const l = ligada(t); return { id: l.id, patch: { situacao: 'pago', pago_em: p.data, baixa: 'caixa', baixado_em: agora, valor: valorDe(t),
        frase: p.frase, frase_antes: { situacao: l.situacao, pago_em: l.pago_em || null, baixa: l.baixa || null, baixado_em: l.baixado_em || null, valor: l.valor, vencimento: l.vencimento } } }; });
      // um título só: grava o valor que entrou (juros ou desconto de centavos); vários: o de cada um
      return { atualizar, inserir: tits.filter(t => !ligada(t)).map(t => ({ tipo: 'entrada', descricao: 'Recebido: ' + nomeTit(t) + ' · ' + t.duplicata, categoria: 'Duplicatas recebidas',
        valor: valorDe(t), vencimento: t.vencimento, situacao: 'pago', pago_em: p.data, baixa: 'caixa', baixado_em: agora,
        origem: 'titulo', titulo_duplicata: t.duplicata, frase: p.frase, entre_empresas: AGILITE.test(baixo(nomeTit(t))) })), titulos: dups };
    }
    return { inserir: [{ tipo: p.tipo, descricao: p.descricao || p.categoria || 'Lançamento', fornecedor: p.fornecedor || null, categoria: p.categoria || null,
      valor: r2(p.valor), vencimento: p.data, situacao: pago ? 'pago' : 'aberto', pago_em: pago ? p.data : null, baixa: pago ? 'caixa' : null,
      baixado_em: pago ? agora : null, entre_empresas: !!p.entre_empresas, origem: 'tela', frase: p.frase }], atualizar: [], titulos: [] };
  }

  // Desfazer um lançamento feito por frase: volta a conta como estava (frase_antes) ou apaga o que a
  // frase criou (lançamento novo ou baixa de título). → { remover: id } | { id, patch } | null.
  function desfazer(l) {
    if (!l || !l.frase) return null;
    if (l.frase_antes) return { id: l.id, patch: Object.assign({}, l.frase_antes, { frase: null, frase_antes: null }) };
    return { remover: l.id };
  }

  const O = { interpretar, extrairData, extrairValor, pedacos, rotuloDe, baixo, semAcento, tokens, categoriaDe, chaveRegra, regraDe, nomeDe, classificar, gravacao, desfazer };
  raiz.CRMFrases = O;
  if (typeof module !== 'undefined') module.exports = O;
})(typeof window !== 'undefined' ? window : globalThis);
