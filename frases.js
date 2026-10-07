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
  // caixa-calculo.js carrega depois deste arquivo no index.html: buscar na hora de usar
  const CX = () => raiz.CRMCaixa || (typeof require !== 'undefined' ? require('./caixa-calculo.js') : null);
  const novoId = () => (raiz.crypto && raiz.crypto.randomUUID ? raiz.crypto.randomUUID() : require('crypto').randomUUID());
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const baixo = s => semAcento(s).toLowerCase();
  const r2 = v => Math.round(Number(v || 0) * 100) / 100;

  // ------------------------------------------------------------ leitura (a MESMA da Agilité)
  // Cópia de src/caixa/interpretar.js do agilite-sistema-gestao (commit b837d37, 06/10/2026 — conferido
  // linha a linha): a mesma frase dá o mesmo resultado nos dois caixas. Regra combinada: mudou lá, copiar
  // para cá; mudou aqui, avisar a Agilité para levar (e rodar os testes dos dois lados).
  const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
  const ENTRADA = /\b(entrada|entradas|entrou|entraram|entra|entrar|recebi|recebemos|recebido|recebida|receber|caiu|cairam|cai|credito|creditado|deposito|depositado|depositaram)\b/;
  const SAIDA = /\b(sai|sair|saiu|saida|saidas|enviei|enviamos|mandei|mandamos|pagar|pago|paga|paguei|pagamos|pagou|pagamento|devolver|devolvi|devolvo|devolve|devolvido|devolvida|devolvidos|devolveremos|devolverei|devolucao|debito|debitado|debitou|transferi|transferencia|pix)\b/;
  const REALIZADO = /\b(enviei|enviamos|mandei|mandamos|pago|paga|pagos|paguei|pagamos|pagou|saiu|entrou|entraram|recebi|recebemos|recebido|recebida|caiu|cairam|debitado|debitou|transferi|devolvi|depositado|depositaram|creditado)\b/;
  const PREVISTO = /\b(vai|vao|sera|serao|vou|vamos|ira|irao|irei|precisa|precisar|precisamos|vence|vencendo|vencimento|previsto|prevista|agendado|agendar|a pagar|a receber|tem que|temos que|devolveremos|devolverei)\b/;
  // trecho que fala da devolucao de um emprestimo ("sera devolvido 60 mil dia 14")
  // (06/10/2026: "vai retornar no dia 14/10" - retornar/voltar tambem e' devolucao)
  const DEVOLUCAO = /\b(devolv\w*|devolucao|pagar de volta|retorn\w*|volta|voltar|voltara|volte)\b/;
  // " e vai retornar dia 14" depois do valor: e' outro pedaco (a volta), nao muda o "saiu ... hoje"
  const INICIO_DEVOLUCAO = /^(?:(?:vai|vao|sera|serao|ele|ela|eles|elas|que|depois|e)\s+)*(?:devolv|retorn|volt|pagar de volta)/;

  function isoDe(d) { return d.toISOString().slice(0, 10); }
  function addDias(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDe(d); }
  function diasNoMes(a, m) { return new Date(Date.UTC(a, m, 0)).getUTCDate(); }

  // Acha a data no texto. Devolve { data, resto } (resto = texto sem a data) ou { data: null }.
  // "dia 14" sem mes: no mes corrente; se ja' passou e a frase fala do futuro, no mes que vem.
  function extrairData(txt, hoje, futuro) {
    const t = baixo(txt);
    const [ha, hm] = hoje.split('-').map(Number);
    let m;
    if ((m = t.match(/\bhoje\b/))) return { data: hoje, trecho: m[0] };
    if ((m = t.match(/\bontem\b/))) return { data: addDias(hoje, -1), trecho: m[0] };
    if ((m = t.match(/\bamanha\b/))) return { data: addDias(hoje, 1), trecho: m[0] };
    if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/))) {
      const d = +m[1], mes = +m[2]; let a = m[3] ? +m[3] : ha; if (a < 100) a += 2000;
      if (mes >= 1 && mes <= 12 && d >= 1 && d <= diasNoMes(a, mes)) return { data: `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`, trecho: m[0] };
    }
    if ((m = t.match(/\bdia\s+(\d{1,2})(?:\s+de\s+([a-z]{3})[a-z]*)?\b/))) {
      const d = +m[1]; let mes = m[2] && MESES[m[2]] ? MESES[m[2]] : hm, a = ha;
      if (!m[2]) {
        const hd = +hoje.slice(8, 10);
        if (futuro && d < hd) { mes++; if (mes > 12) { mes = 1; a++; } }
      } else if (mes < hm - 6) a++;
      if (d >= 1 && d <= diasNoMes(a, mes)) return { data: `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`, trecho: m[0] };
    }
    return { data: null, trecho: null };
  }

  // "12.898,29" "48 mil" "1,5 mil" "300" "R$ 1.200" "3k" -> numero. Ignora "05 de 48" (parcela).
  function extrairValor(txt) {
    let t = baixo(txt).replace(/\b\d+\s*de\s*\d+\b/g, ' ');
    // "8 diárias … 624": numero logo antes de uma unidade e' quantidade, nao valor, quando sobra
    // outro numero na frase (regra criada no CRM-OneClean em 06/10/2026, trazida pra ca' igual)
    const semQtd = t.replace(QUANTIDADE, ' ');
    if (semQtd !== t && /\d/.test(semQtd)) t = semQtd;
    // "100,000,00" e "100,000" (virgula como milhar, 06/10/2026) vem antes de "100,00"
    const re = /(?:r\$\s*)?(\d{1,3}(?:,\d{3})+(?:[.,]\d{2})?(?!\d)|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?|\d+\.\d{1,2})(\s*(?:mil|k)\b)?/g;
    let m;
    while ((m = re.exec(t))) {
      let s = m[1];
      if (/^\d{1,3}(?:,\d{3})+(?:[.,]\d{2})?$/.test(s)) {
        const dec = s.match(/[.,](\d{2})$/);
        s = (dec ? s.slice(0, -3) : s).replace(/,/g, '') + (dec ? '.' + dec[1] : '');
      } else if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
      else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
      let v = parseFloat(s);
      if (m[2]) v *= 1000;
      if (v > 0) return { valor: Math.round(v * 100) / 100, trecho: m[0] };
    }
    return { valor: null, trecho: null };
  }

  const QUANTIDADE = /\b\d{1,3}\s+(?:diarias?|fts?|folguistas?|horas?|plantoes?|pessoas?|funcionari[oa]s?|unidades?|un|caixas?|cx|fardos?|pacotes?|galoes?|litros?|kits?|pecas?|rolos?)\b/g;
  // (quantidade - "8 diárias" - tambem nao e' valor pra partir a frase no " e ")
  const temValor = (txt) => extrairValor(baixo(txt).replace(QUANTIDADE, ' ').replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ').replace(/\bdia\s+\d{1,2}\b/gi, ' ')).valor != null;

  // Separa a frase em pedacos. Virgula, ";", " mas ", " depois " sempre separam;
  // " e " separa quando os dois lados tem valor ("VT 300 e VR 500").
  function pedacos(linha) {
    const out = [];
    // virgula entre dois digitos e' centavo ("244,27"), nao separa.
    // " - " e " / " com espaco dos dois lados tambem separam (06/10/2026: "vt: 63 - vr: 152,67 - paseo"
    // virava um item so' de 63); o pedaco sem valor ("paseo") vira contexto e vale pros outros.
    for (const p of String(linha).split(/;|,(?!\d)|(?<!\d),|\s+mas\s+|\s+depois\s+|\s+\+\s+|\s+[-–—]\s+|\s+\/\s+/i)) {
      const partes = p.split(/\s+e\s+/i);
      let atual = partes[0];
      for (let i = 1; i < partes.length; i++) {
        if ((temValor(atual) && temValor(partes[i])) || (temValor(atual) && INICIO_DEVOLUCAO.test(baixo(partes[i])))) { out.push(atual); atual = partes[i]; } else atual += ' e ' + partes[i];
      }
      out.push(atual);
    }
    return out.map((s) => s.trim()).filter(Boolean);
  }

  // palavras de controle; borda "de letra" com \p{L} (o \b do JS quebra em "almoço" e corta o "o")
  const TIRA = new RegExp('(?<![\\p{L}\\d])(?:entrada|entradas|saida|saidas|data|enviei|enviamos|mandei|mandamos|emprestimo|devolucao|sera|serao|entrou|entraram|entra|entrar|recebi|recebemos|recebido|recebida|receber|caiu|cairam|credito|creditado|deposito|depositado|depositaram|sai|sair|saiu|pagar|pago|pagos|paga|paguei|pagamos|pagou|pix|transferi|transferencia|vai|vao|precisa|precisar|precisamos|tem que|temos que|vence|vencendo|previsto|prevista|agendado|agendar|hoje|ontem|amanha|ja|foi|foram|que|o|a|os|as|um|uma|do|da|dos|das|de|pro|pra|para|no|na|em|com|valor|reais|referente|ref)(?![\\p{L}\\d])', 'giu');
  // Tira do texto valor, data e as palavras de controle; o que sobra e' o "do que se trata".
  function rotuloDe(txt, trechos) {
    let s = ` ${txt} `.replace(/\b(\d+)\s+de\s+(\d+)\b/gi, '$1/$2'); // "11 de 13" (parcela) fica "11/13"
    for (const tr of trechos.filter(Boolean)) {
      const i = baixo(s).indexOf(baixo(tr));
      if (i >= 0) s = s.slice(0, i) + ' ' + s.slice(i + tr.length);
    }
    s = s.replace(/r\$/gi, ' ');
    s = semAcentoPreservando(s).replace(TIRA, ' ');
    return s.replace(/\s+/g, ' ').replace(/^[\s\-–—:.]+|[\s\-–—:.]+$/g, '').trim();
  }
  // tira so' as palavras de controle; mantem acento do resto (regex roda sobre um espelho sem acento)
  function semAcentoPreservando(s) {
    // as palavras de controle nao tem acento depois de normalizar; trocamos as acentuadas comuns
    return s.replace(/amanhã/gi, 'amanha').replace(/débito/gi, 'debito').replace(/crédito/gi, 'credito').replace(/depósito/gi, 'deposito')
      .replace(/caíram/gi, 'cairam').replace(/saída/gi, 'saida').replace(/já/gi, 'ja')
      .replace(/empréstimo/gi, 'emprestimo').replace(/devolução/gi, 'devolucao').replace(/será/gi, 'sera').replace(/serão/gi, 'serao');
  }

  // texto -> [{ linha, tipo, valor, data, situacao, rotulo, devolucaoPrevista }] + avisos
  // opts.dataPadrao / opts.tipoPadrao: digitado numa celula da grade (o dia e a
  // secao - entradas/saidas - valem quando a frase nao diz)
  function interpretar(texto, hoje, opts = {}) {
    const itens = [], avisos = [];
    String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((linha, nLinha) => {
      const ps = pedacos(linha);
      const doLinha = [];
      const contextos = [];
      for (const p of ps) {
        const b = baixo(p);
        const futuro = PREVISTO.test(b);
        const dt = extrairData(p, hoje, futuro || /\b(sai|entra|vence)\b/.test(b));
        const semData = dt.trecho ? (() => { const i = baixo(p).indexOf(dt.trecho); return p.slice(0, i) + ' ' + p.slice(i + dt.trecho.length); })() : p;
        // "48 parcelas de R$ 3.292,29" / "12x de 500": o valor e' o da parcela, nao o 48
        // (o numero nao pode ser rabo de outro - "1.764,46 parcela" - e "parcela 05 de 48" nao conta)
        const mp = baixo(semData).match(/(?<![\d.,])(\d{1,3})\s*(?:x\b|vezes|parcelas?|prestac\w*)\s*(?:(?:iguais|mensais|fixas)\s*)*(?:de\s*(?:r\$\s*)?|r\$\s*)(\d[\d.,]*(?:\s*mil)?)/);
        const vp = mp ? extrairValor(mp[2]) : null;
        const v = vp && vp.valor != null ? { valor: vp.valor, trecho: semData.substr(baixo(semData).indexOf(mp[0]), mp[0].length) } : extrairValor(semData);
        const parcelas = vp && vp.valor != null ? +mp[1] : null;
        // "emprestimo de 100 mil" sem entrou/paguei = dinheiro que chegou
        const dir = ENTRADA.test(b) ? 'entrada' : SAIDA.test(b) ? 'saida' : /\bemprestimo\b/.test(b) && !/\bparcela/.test(b) ? 'entrada' : null;
        // data futura escrita no proprio trecho = previsto (nao herda o "entrou" de outro trecho)
        const sit = REALIZADO.test(b) && !futuro ? 'realizado' : futuro ? 'previsto' : dt.data && dt.data > hoje ? 'previsto' : null;
        if (v.valor == null) { contextos.push({ texto: p, data: dt.data, dir, sit, juros: /\bjuros\b/.test(b), rotulo: rotuloDe(semData, []) , apos: doLinha.length }); continue; }
        const item = { linha: nLinha + 1, frase: linha, trecho: p, valor: v.valor, data: dt.data, tipo: dir, situacao: sit, rotulo: rotuloDe(semData, [v.trecho]) };
        if (parcelas) item.parcelas = parcelas;
        item.dataPropria = !!dt.data; item.sitPropria = !!sit;
        if (/\bemprest/.test(baixo(linha))) item.emprestimo = true;
        doLinha.push(item);
      }
      if (!doLinha.length) { avisos.push(`Linha ${nLinha + 1}: não achei valor em "${linha}".`); return; }
      // devolucao com valor logo depois de uma entrada = o emprestimo e quanto/quando volta,
      // nao uma segunda entrada (06/10/2026: "entrou 57550 de RGB e sera devolvido 60000
      // no dia 14/10, a diferenca e' juros" -> 1 emprestimo de 57.550 que volta 60.000 em 14/10)
      for (let k = 1; k < doLinha.length; k++) {
        const it = doLinha[k], ant = doLinha[k - 1];
        if (DEVOLUCAO.test(baixo(it.trecho)) && !it.parcelas && ant.tipo === 'entrada' && ant.valorDevolver == null) {
          ant.devolucaoPrevista = it.data || null; ant.valorDevolver = it.valor;
          doLinha.splice(k, 1);
          for (const c of contextos) if (c.apos > k) c.apos--;
          k--;
        }
      }
      // contexto sem valor: "sai dia 14" logo depois de uma ENTRADA = devolucao prevista dela;
      // o resto (data, pago/previsto, nome) vale pros itens da frase que nao tem o seu
      let nomeExtra = [];
      for (const c of contextos) {
        const ant = doLinha[c.apos - 1];
        // "a diferenca e' juros": so' explica a devolucao maior; nao vira nome
        if (c.juros) { for (const it of doLinha) if (it.valorDevolver != null) it.jurosNaFrase = true; continue; }
        if (ant && (ant.tipo === 'entrada') && c.dir === 'saida' && c.data) { ant.devolucaoPrevista = c.data; continue; }
        // "transferi 1.600 pra OneClean, devolve dia 14": a data e' da volta, nao da saida (06/10/2026)
        if (ant && c.data && DEVOLUCAO.test(baixo(c.texto))) { ant.devolucaoPrevista = c.data; continue; }
        for (const it of doLinha) {
          if (!it.data && c.data) it.data = c.data;
          if (!it.situacao && c.sit) it.situacao = c.sit;
          if (!it.tipo && c.dir && !(c.dir === 'saida' && c.sit === 'realizado' && false)) it.tipo = c.dir === 'entrada' ? 'entrada' : it.tipo;
        }
        if (c.rotulo) nomeExtra.push({ r: c.rotulo, apos: c.apos });
      }
      // herda entre itens da mesma frase: data e situacao de quem tem; direcao de quem vem antes
      // situacao: primeiro herda do item anterior ("vai sair 5 mil X e 2 mil Y"), depois da frase toda
      for (let k = 1; k < doLinha.length; k++) if (!doLinha[k].situacao && doLinha[k - 1].situacao) doLinha[k].situacao = doLinha[k - 1].situacao;
      const sits = [...new Set(doLinha.map((i) => i.situacao).filter(Boolean))];
      for (const it of doLinha) if (!it.situacao && sits.length === 1) it.situacao = sits[0];
      let dirAnt = null;
      doLinha.forEach((it, k) => {
        // data so' passa entre itens de mesma situacao ("entrou 30 mil, vai sair 5 mil amanha":
        // a entrada e' de hoje, a saida e' amanha)
        const datas = [...new Set(doLinha.filter((o) => o.data && (!it.situacao || !o.situacao || o.situacao === it.situacao)).map((o) => o.data))];
        if (!it.data && datas.length === 1) it.data = datas[0];
        if (!it.situacao && sits.length === 1) it.situacao = sits[0];
        if (!it.tipo) it.tipo = dirAnt || opts.tipoPadrao || 'saida';
        dirAnt = it.tipo;
        it.contexto = nomeExtra.map((x) => x.r).join(' ').trim();
        // contexto escrito antes do item vai na frente, o de depois vai atras ("RGB - I" -> "RGB I"; "vt 63 - paseo" -> "vt paseo")
        const ctxAntes = nomeExtra.filter((x) => x.apos <= k).map((x) => x.r).join(' ');
        const ctxDepois = nomeExtra.filter((x) => x.apos > k).map((x) => x.r).join(' ');
        if (!it.data) it.data = opts.dataPadrao || hoje;
        if (!it.situacao) it.situacao = it.data > hoje ? 'previsto' : 'realizado';
        if (it.situacao === 'realizado' && it.data > hoje) it.situacao = 'previsto';
        if (!it.rotulo && it.contexto) { it.rotulo = it.contexto; it.contexto = ''; }
        // rotulo de 1-2 letras ("I" de "RGB - I 1.764,46") sozinho nao diz nada: junta o contexto
        else if (it.rotulo && it.rotulo.replace(/[^\p{L}\d]/gu, '').length < 3 && it.contexto) { it.rotulo = `${ctxAntes} ${it.rotulo} ${ctxDepois}`.replace(/\s+/g, ' ').trim(); it.contexto = ''; }
        itens.push(it);
      });
    });
    // entrada de alguem numa linha e saida pro MESMO nome, de valor igual ou um pouco maior,
    // numa data depois = emprestimo e a devolucao dele, nao duas contas (06/10/2026:
    // "entrada de 29.000 Sirlene - data de hoje" + "saida 29.000 Sirlene - dia 14/10")
    // devolucao em parcelas ("devolucao sera 48 parcelas de R$ 3.292,29, todo dia 18,
    // a primeira 18/10") = como o emprestimo volta: liga na entrada anterior (mesma linha
    // ou a de cima), nao vira uma conta (06/10/2026, emprestimo do Daniel Dalessi)
    for (let j = 0; j < itens.length; j++) {
      const it = itens[j];
      if (!it.parcelas || !(DEVOLUCAO.test(baixo(it.frase)) || it.emprestimo)) continue;
      let i = j - 1;
      while (i >= 0 && !(itens[i].tipo === 'entrada' && itens[i].valorDevolver == null && !itens[i].parcelas)) i--;
      if (i < 0 || itens[i].linha < it.linha - 2) continue;
      const md = baixo(it.frase).match(/\b(?:todo|todos os)\s+dia[s]?\s+(\d{1,2})\b/);
      itens[i].parcelas = { n: it.parcelas, valor: it.valor, primeira: it.data, dia: md ? +md[1] : +it.data.slice(8, 10) };
      itens[i].emprestimo = true;
      // na mesma linha a entrada herdou a data/previsto da 1a parcela: o dinheiro e' de hoje
      if (itens[i].linha === it.linha && !itens[i].dataPropria) itens[i].data = opts.dataPadrao || hoje;
      if (itens[i].linha === it.linha && !itens[i].sitPropria) itens[i].situacao = itens[i].data > hoje ? 'previsto' : 'realizado';
      itens.splice(j, 1); j--;
    }
    const nomeDe = (s) => baixo(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !/^\d+$/.test(t)).sort().join(' ');
    for (let i = 0; i < itens.length; i++) {
      const e = itens[i];
      if (e.tipo !== 'entrada' || e.valorDevolver != null || e.parcelas || !nomeDe(e.rotulo)) continue;
      const j = itens.findIndex((s, k) => k !== i && s.tipo === 'saida' && s.linha !== e.linha && s.data > e.data
        && nomeDe(s.rotulo) === nomeDe(e.rotulo) && s.valor >= e.valor - 0.01 && s.valor <= e.valor * 1.25);
      if (j < 0) continue;
      e.valorDevolver = itens[j].valor; e.devolucaoPrevista = itens[j].data;
      itens.splice(j, 1);
      if (j < i) i--;
    }
    return { itens, avisos };
  }

  // ------------------------------------------------------------ classificação (do CRM)
  // Palavras que não identificam nada: genéricas de conta e de razão social.
  const GENERICAS = new Set(('conta contas pagamento pagto boleto boletos nota notas fatura fornecedor fornecedores cliente clientes ' +
    'ltda eireli epp comercio comercial servicos servico industria cia sociedade empresa grupo brasil distribuidora dia mes valor ' +
    'parcela parcelas referente total geral mais outro outra outros outras ' +
    // (06/10: "saiu 502,05 compra de mercadoria" achou o cadastro "| A/C COMPRAS")
    'compra compras mercadoria mercadorias produto produtos pedido pedidos material materiais venda vendas loja').split(' '));
  function tokens(s) {
    return [...new Set(baixo(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 3 && !/^\d+$/.test(w) && !GENERICAS.has(w) && !/^(?:que|dos|das|com|pra|para|pro)$/.test(w)))];
  }
  // "combust" casa "combustivel"; "fornecedor" não casa nada (genérica)
  const casaPalavra = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0));
  const emComum = (as, bs) => as.filter(a => bs.some(b => casaPalavra(a, b))).length;
  const dias = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5);

  // Categoria pela palavra (a primeira que casar). Agilité primeiro: marca entre empresas.
  // o ditado escreve a Agilité de vários jeitos ("Agility", "ajilite", "agiliti")
  const AGILITE = /\ba[gj]il+i[tc]/;
  const PALAVRAS = [
    // palavras que não deixam dúvida da categoria (FORTES, abaixo): igual à Agilité
    [/\bdiaria/, 'Diárias de cobertura'], [/\buniforme/, 'Uniformes'], [/\bsekron/, 'Sekron (monitoramento)'], [/\bexame|\baso\b|\bmedtrab/, 'Medicina do trabalho'],
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
  // Categoria que a palavra não deixa dúvida: "diária" nunca paga sozinha a conta do Sekron (fica nas
  // opções, para escolher à mão). Igual à Agilité (06/10/2026).
  const FORTES = new Set(['Diárias de cobertura', 'Uniformes', 'Sekron (monitoramento)', 'Energia', 'Contabilidade', 'Medicina do trabalho']);
  // Folha e benefício: "lembrar" não aparece (uma regra "vt" com o fornecedor de hoje valeria para todo VT).
  const FOLHA = new Set(['Salários', 'Benefícios (VT, VR, cesta)', 'FGTS e encargos', 'Pró-labore', 'Reembolso da folha à Agilité', 'Retiradas dos sócios']);
  // Transferência entre as empresas do grupo (OneClean ↔ Agilité, 06/10/2026, espelho da Agilité): só
  // muda de empresa — não é receita, despesa nem empréstimo; na aba Geral da Agilité as duas pontas se
  // anulam. Vale quando a frase cita a Agilité, tem palavra de transferência e não fala de material,
  // produto, reembolso, folha, salário ou benefício (esses continuam "Material vendido"/"Reembolso da folha").
  const CAT_TRANSF = 'Transferência entre empresas';
  const TRANSF = /\b(transferi|transferimos|transferencia|transferido|enviei|enviamos|enviou|mandei|mandamos|mandou|emprestei|emprestamos|emprestou|emprestimo|adiantei|adiantamento|pix|devolucao|devolv\w*|retorn\w*|volta|voltar)\b/;
  const ehTransferencia = (it, texto) => { const t = baixo((it.frase || '') + ' ' + texto); return AGILITE.test(t) && TRANSF.test(t) && !/\b(material|produto|reembolso|folha|salario|beneficio)/.test(t); };
  const ehEmprestimo = (it, texto) => it.tipo === 'entrada' && (!!(it.parcelas && typeof it.parcelas === 'object') || !!it.emprestimo || it.valorDevolver != null || !!it.devolucaoPrevista || /\bemprest/.test(baixo(texto)));
  const TAXA_BANCO = /\b(?:taxa|tarifa)s? (?:d[oe] )?(?:pix|ted|doc|boleto|banco|bb)\b/;
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

  const dataBR = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '';
  function motivoEmprestimo(valor, e) {
    if (e.parcelas) {
      const pc = e.parcelas, total = r2(pc.n * pc.valor);
      return 'empréstimo recebido de ' + e.credor + ' (não é receita) — devolve em ' + pc.n + ' parcelas de ' + moeda(pc.valor) + ', todo dia ' + pc.dia + ', a 1ª em ' + dataBR(pc.primeira) +
        '; total ' + moeda(total) + (total > valor ? ', juros ' + moeda(r2(total - valor)) + ' (parcela a parcela, tabela Price)' : ', sem juros') + '. As parcelas viram uma conta recorrente.';
    }
    const juros = e.devolve != null ? r2(e.devolve - valor) : 0;
    return 'empréstimo recebido de ' + e.credor + ' (não é receita) — devolve ' + (e.devolve != null ? moeda(e.devolve) : 'o mesmo valor') + (e.em ? ' em ' + dataBR(e.em) : ' (falta a data: sem ela não entra a devolução no caixa)') +
      (juros > 0 ? '; juros de ' + moeda(juros) : '');
  }

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
      if (typeof it.parcelas === 'number') p.parcelas = it.parcelas; // "12x de 350": guarda o número de parcelas
      if (ehTransferencia(it, texto)) {
        const entrada = it.tipo === 'entrada';
        Object.assign(p, { categoria: CAT_TRANSF, fornecedor: 'Agilité', entre_empresas: true, podeLembrar: false, parcelas: null,
          descricao: entrada ? 'Transferência da Agilité' : 'Transferência para a Agilité' });
        // a volta já prevista (ex.: "devolvi 1.600 pra Agilité" no dia 14): dá baixa nela, não cria outra
        const prevista = (ctx.lancamentos || []).filter(l => l.situacao === 'aberto' && l.tipo === it.tipo && l.categoria === CAT_TRANSF && !usados.has('l:' + l.id) &&
          Math.abs(Number(l.valor) - it.valor) <= Math.max(1, it.valor * 0.01)).sort((a, b) => Math.abs(dias(a.vencimento, it.data)) - Math.abs(dias(b.vencimento, it.data)))[0];
        if (prevista && realizado) {
          usados.add('l:' + prevista.id);
          p.acao = 'baixar:' + prevista.id;
          p.opcoes = [{ acao: 'baixar:' + prevista.id, rotulo: (entrada ? 'Receber' : 'Pagar') + ' a volta prevista: ' + prevista.descricao + ' · ' + moeda(prevista.valor) + ' · ' + dm(prevista.vencimento) },
            { acao: 'novo', rotulo: 'Lançar nova transferência' }, { acao: 'ignorar', rotulo: 'Não lançar' }];
          p.motivo = 'transferência entre empresas: é a volta prevista "' + prevista.descricao + '" (' + moeda(prevista.valor) + ', ' + dm(prevista.vencimento) + ') — dá baixa nela, sem lançar outra';
          return p;
        }
        p.transferencia = { volta: it.devolucaoPrevista || null, valor: it.valorDevolver != null ? it.valorDevolver : it.valor };
        p.acao = 'novo';
        p.opcoes = [{ acao: 'novo', rotulo: 'Lançar a transferência' }, { acao: 'ignorar', rotulo: 'Não lançar' }];
        p.motivo = 'transferência ' + (entrada ? 'da Agilité (entre empresas: não é receita nem empréstimo)' : 'para a Agilité (entre empresas: não é despesa)') +
          (p.transferencia.volta ? ' — volta ' + moeda(p.transferencia.valor) + ' em ' + dataBR(p.transferencia.volta) + ' (fica prevista na grade)' : ' — se houver volta, preencha a data');
        return p;
      }
      // Empréstimo recebido (não é receita): devolve numa vez (valor/data) ou em parcelas (recorrente).
      if (ehEmprestimo(it, texto)) {
        const credor = maiuscula(it.rotulo || it.contexto || 'Empréstimo');
        const pc = it.parcelas && typeof it.parcelas === 'object' ? it.parcelas : null;
        p.emprestimo = { credor, devolve: pc ? null : (it.valorDevolver != null ? it.valorDevolver : it.valor), em: pc ? null : (it.devolucaoPrevista || null), parcelas: pc };
        p.parcelas = null;
        Object.assign(p, { acao: 'novo', categoria: 'Empréstimos recebidos', fornecedor: credor, descricao: 'Empréstimo — ' + credor, entre_empresas: AGILITE.test(baixo(texto)), podeLembrar: false });
        p.opcoes = [{ acao: 'novo', rotulo: 'Lançar o empréstimo' }, { acao: 'ignorar', rotulo: 'Não lançar' }];
        p.motivo = motivoEmprestimo(p.valor, p.emprestimo);
        return p;
      }
      // o nome do cliente (condomínio) não prova que é a mesma conta: "8 diárias … Espaço e Vida" não
      // paga "Sekron — Espaço e Vida" só pelo nome (06/10/2026, Agilité)
      const cliente = it.tipo === 'saida' ? nomeDe(ctx.clientes, toks) : null;
      const toksConta = cliente ? toks.filter(t => !tokens(cliente.nome).some(w => casaPalavra(t, w))) : toks;
      const catPalavra = it.tipo === 'saida' ? ((PALAVRAS.find(x => x[0].test(baixo(texto))) || [])[1] || null) : null;
      const conflita = l => FORTES.has(catPalavra) && !!l.categoria && l.categoria !== catPalavra;
      // 1. conta em aberto do mesmo tipo
      const tol = Math.max(60, it.valor * 0.08);
      const contas = (ctx.lancamentos || []).filter(l => l.situacao === 'aberto' && !l.titulo_duplicata && l.tipo === it.tipo && !usados.has('l:' + l.id) &&
        Math.abs(Number(l.valor) - it.valor) <= tol && Math.abs(dias(l.vencimento, it.data)) <= 20)
        .map(l => ({ l, c: emComum(toksConta, tokens([l.descricao, l.fornecedor].join(' '))) }))
        .map(x => Object.assign(x, { nota: x.c * 10 - Math.abs(Number(x.l.valor) - it.valor) / tol * 3 - Math.abs(dias(x.l.vencimento, it.data)) / 20 * 2 - (conflita(x.l) ? 100 : 0) }))
        .sort((a, b) => b.nota - a.nota);
      // escolhe sozinha só com palavra em comum e sem conflito de categoria; as outras ficam nas opções
      const conta = contas.length && contas[0].c > 0 && !conflita(contas[0].l) ? contas[0].l : null;
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
      // "taxa pix": o leitor tira "pix" do nome (é palavra de saída); a taxa do banco olha a frase inteira
      const taxaBanco = TAXA_BANCO.test(baixo(it.trecho || it.frase || '')) ? ' tarifa' : '';
      const cat = categoriaDe(texto + ' ' + (quem ? quem.nome : '') + taxaBanco, it.tipo);
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
      p.descricao = maiuscula([it.rotulo, it.rotulo && it.contexto ? '— ' + it.contexto : ''].filter(Boolean).join(' ') || it.contexto || p.fornecedor || p.categoria);

      // ação proposta
      if (realizado && tits.length) {
        const g = tits[0];
        p.acao = 'titulo:' + g.map(t => t.duplicata).join(',');
        g.forEach(t => usados.add('t:' + t.duplicata));
        p.motivo = g.length > 1 ? 'a soma bate com ' + g.length + ' títulos de ' + nomeTit(g[0]) : 'bate com o título ' + g[0].duplicata + ' de ' + nomeTit(g[0]);
      } else if (conta) {
        const l = conta;
        usados.add('l:' + l.id);
        if (realizado) { p.acao = 'baixar:' + l.id; p.motivo = 'bate com a conta em aberto "' + l.descricao + '" (' + moeda(l.valor) + ', vence ' + dm(l.vencimento) + ')'; }
        else if (r2(l.valor) === it.valor && l.vencimento === it.data) { p.acao = 'ignorar'; p.motivo = 'já está no caixa: "' + l.descricao + '" (' + moeda(l.valor) + ', vence ' + dm(l.vencimento) + ')'; }
        else { p.acao = 'ajustar:' + l.id; p.motivo = 'já existe "' + l.descricao + '" (' + moeda(l.valor) + ', vence ' + dm(l.vencimento) + '): ajusta valor e dia, sem duplicar'; }
      } else if (it.tipo === 'entrada' && !realizado && (ctx.titulos || []).some(t => !recebidos.has(t.duplicata) && Math.abs(Number(t.valor) - it.valor) <= Math.max(0.01, it.valor * 0.005))) {
        p.acao = 'ignorar'; p.motivo = 'já está previsto por um título do contas a receber';
      } else {
        p.acao = 'novo';
        p.motivo = regra ? 'regra lembrada' : quem ? (it.tipo === 'entrada' ? 'de ' : 'para ') + quem.nome : '';
        if (contas.length && contas[0].c > 0) p.motivo = (p.motivo ? p.motivo + ' · ' : '') + '"' + contas[0].l.descricao + '" é de outra categoria: ficou nas opções, se for ela';
      }
      if (p.parcelas) p.motivo = (p.motivo ? p.motivo + ' · ' : '') + p.parcelas + ' parcelas de ' + moeda(p.valor);
      // "lembrar" só onde faz diferença: conta nova fora de folha/benefício
      p.podeLembrar = p.acao === 'novo' && !FOLHA.has(p.categoria);
      return p;
    });
  }

  // Proposta conferida → o que gravar. { inserir: [lanc], atualizar: [{ id, patch }], titulos: [dup] }.
  // O estado anterior vai em frase_antes, para o Desfazer voltar a baixa.
  function gravacao(p, ctx) {
    const agora = ctx.agora || new Date().toISOString();
    const pago = p.situacao === 'realizado';
    const [acao, alvo] = [p.acao.split(':')[0], p.acao.slice(p.acao.indexOf(':') + 1)];
    if (acao === 'ignorar') return { inserir: [], atualizar: [], titulos: [], recorrentes: [] };
    if (p.emprestimo && p.tipo === 'entrada') return gravaEmprestimo(p, agora);
    if (p.transferencia && acao === 'novo') return gravaTransferencia(p, agora);
    if (acao === 'baixar' || acao === 'ajustar') {
      const l = (ctx.lancamentos || []).find(x => x.id === alvo);
      if (!l) throw new Error('a conta "' + alvo + '" não está mais no caixa');
      const antes = { situacao: l.situacao, pago_em: l.pago_em || null, baixa: l.baixa || null, baixado_em: l.baixado_em || null, valor: l.valor, vencimento: l.vencimento };
      const patch = acao === 'baixar' ? { situacao: 'pago', pago_em: p.data, baixa: 'caixa', baixado_em: agora, valor: r2(p.valor) } : { valor: r2(p.valor), vencimento: p.data };
      return { inserir: [], atualizar: [{ id: l.id, patch: Object.assign(patch, { frase: p.frase, frase_antes: antes }) }], titulos: [], recorrentes: [] };
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
        origem: 'titulo', titulo_duplicata: t.duplicata, frase: p.frase, entre_empresas: AGILITE.test(baixo(nomeTit(t))) })), titulos: dups, recorrentes: [] };
    }
    return { inserir: [Object.assign({ tipo: p.tipo, descricao: p.descricao || p.categoria || 'Lançamento', fornecedor: p.fornecedor || null, categoria: p.categoria || null,
      valor: r2(p.valor), vencimento: p.data, situacao: pago ? 'pago' : 'aberto', pago_em: pago ? p.data : null, baixa: pago ? 'caixa' : null,
      baixado_em: pago ? agora : null, entre_empresas: !!p.entre_empresas, origem: 'tela', frase: p.frase },
      p.parcelas ? { parcelas: p.parcelas, observacoes: p.parcelas + ' parcelas de ' + moeda(p.valor) } : {})], atualizar: [], titulos: [], recorrentes: [] };
  }

  // Transferência entre empresas: o lançamento de hoje e a volta prevista (a outra direção), os dois na
  // categoria "Transferência entre empresas" e entre empresas. Desfazer apaga os dois (frase_antes.criou).
  function gravaTransferencia(p, agora) {
    const pago = p.situacao === 'realizado', entrada = p.tipo === 'entrada';
    const base = { categoria: CAT_TRANSF, fornecedor: 'Agilité', entre_empresas: true, origem: 'tela' };
    const l = Object.assign({ id: novoId(), tipo: p.tipo, descricao: p.descricao || (entrada ? 'Transferência da Agilité' : 'Transferência para a Agilité'), valor: r2(p.valor), vencimento: p.data,
      situacao: pago ? 'pago' : 'aberto', pago_em: pago ? p.data : null, baixa: pago ? 'caixa' : null, baixado_em: pago ? agora : null, frase: p.frase,
      observacoes: 'Só muda de empresa dentro do grupo: não é ' + (entrada ? 'receita' : 'despesa') + '.' }, base);
    const inserir = [l];
    const t = p.transferencia || {};
    if (t.volta) inserir.push(Object.assign({ id: novoId(), tipo: entrada ? 'saida' : 'entrada', descricao: entrada ? 'Devolução da transferência à Agilité' : 'Agilité devolve a transferência',
      valor: r2(t.valor > 0 ? t.valor : p.valor), vencimento: t.volta, situacao: 'aberto', observacoes: 'Volta da transferência de ' + moeda(p.valor) + ' em ' + dataBR(p.data) + '.' }, base));
    l.frase_antes = { criou: { lancamentos: inserir.slice(1).map(x => x.id), recorrentes: [] } };
    return { inserir, atualizar: [], titulos: [], recorrentes: [] };
  }

  // Empréstimo recebido: a entrada (marcada como empréstimo, não é receita) e a devolução — numa vez
  // (saída prevista no dia, com os juros) ou em parcelas (conta recorrente "Empréstimo — <credor>" com o
  // valor contratado, juros pela tabela Price, e a 1ª parcela já em Contas a pagar). O que foi criado vai
  // em frase_antes.criou da entrada: o Desfazer apaga tudo (ou só desliga a recorrente, se já pagou parcela).
  function gravaEmprestimo(p, agora) {
    const e = p.emprestimo, credor = e.credor || p.fornecedor || 'Empréstimo', pago = p.situacao === 'realizado';
    const entrada = { id: novoId(), tipo: 'entrada', descricao: p.descricao || 'Empréstimo — ' + credor, fornecedor: credor, categoria: 'Empréstimos recebidos',
      valor: r2(p.valor), vencimento: p.data, situacao: pago ? 'pago' : 'aberto', pago_em: pago ? p.data : null, baixa: pago ? 'caixa' : null, baixado_em: pago ? agora : null,
      entre_empresas: !!p.entre_empresas, origem: 'tela', emprestimo: true, frase: p.frase, observacoes: motivoEmprestimo(p.valor, e) };
    const inserir = [entrada], recorrentes = [];
    if (e.parcelas && e.parcelas.n > 0 && e.parcelas.valor > 0 && e.parcelas.primeira) {
      const pc = e.parcelas, total = r2(pc.n * pc.valor);
      const rec = { id: novoId(), tipo: 'saida', descricao: ('Empréstimo — ' + credor).slice(0, 120), fornecedor: credor, categoria: 'Empréstimos e giro', valor: r2(pc.valor),
        dia: Math.min(31, Math.max(1, pc.dia || +pc.primeira.slice(8, 10))), parcelas: pc.n, parcela_inicio: 1, inicio: pc.primeira.slice(0, 8) + '01', ativo: true, entre_empresas: !!p.entre_empresas,
        valor_contratado: total > p.valor ? r2(p.valor) : null, taxa_mes_pct: total > p.valor ? null : 0,
        observacoes: 'Empréstimo de ' + moeda(p.valor) + ' recebido em ' + dataBR(p.data) + ' (frase: "' + p.frase + '"). ' + pc.n + ' parcelas de ' + moeda(pc.valor) + ', total ' + moeda(total) +
          (total > p.valor ? ', juros ' + moeda(r2(total - p.valor)) + ' (tabela Price).' : ', sem juros.') };
      recorrentes.push(rec);
      (CX() ? CX().gerarMes([rec], pc.primeira.slice(0, 7), []) : []).forEach(l => inserir.push(Object.assign({ id: novoId() }, l)));
    } else if (e.em) {
      const dev = r2(e.devolve != null ? e.devolve : p.valor), juros = r2(dev - p.valor);
      inserir.push({ id: novoId(), tipo: 'saida', descricao: 'Devolução do empréstimo — ' + credor, fornecedor: credor, categoria: 'Empréstimos e giro', valor: dev, vencimento: e.em,
        situacao: 'aberto', entre_empresas: !!p.entre_empresas, origem: 'tela', juros: juros > 0 ? juros : null,
        observacoes: 'Devolve o empréstimo de ' + moeda(p.valor) + ' recebido em ' + dataBR(p.data) + (juros > 0 ? ': ' + moeda(p.valor) + ' + juros ' + moeda(juros) : '') + '.' });
    }
    entrada.frase_antes = { criou: { lancamentos: inserir.slice(1).map(l => l.id), recorrentes: recorrentes.map(r => r.id) } };
    return { inserir, atualizar: [], titulos: [], recorrentes };
  }

  // Desfazer um lançamento feito por frase: volta a conta como estava (frase_antes) ou apaga o que a
  // frase criou (lançamento novo, baixa de título, empréstimo com a devolução e as parcelas em aberto —
  // a recorrente do empréstimo é apagada, ou só desligada se alguma parcela já foi paga).
  // → { remover: [ids], atualizar: [{ id, patch }], recorrentesRemover: [ids], recorrentesDesligar: [ids] } | null
  function desfazer(l, ctx) {
    if (!l || !l.frase) return null;
    const out = { remover: [], atualizar: [], recorrentesRemover: [], recorrentesDesligar: [] };
    const criou = l.frase_antes && l.frase_antes.criou;
    if (criou) {
      const lancs = (ctx && ctx.lancamentos) || [];
      out.remover.push(l.id);
      (criou.lancamentos || []).forEach(id => { const x = lancs.find(y => y.id === id); if (!x || x.situacao !== 'pago') out.remover.push(id); });
      (criou.recorrentes || []).forEach(rid => {
        const doRec = lancs.filter(y => y.recorrente_id === rid);
        doRec.filter(y => y.situacao !== 'pago').forEach(y => out.remover.push(y.id));
        (doRec.some(y => y.situacao === 'pago') ? out.recorrentesDesligar : out.recorrentesRemover).push(rid);
      });
      out.remover = [...new Set(out.remover)];
      return out;
    }
    if (l.frase_antes) { out.atualizar.push({ id: l.id, patch: Object.assign({}, l.frase_antes, { frase: null, frase_antes: null }) }); return out; }
    out.remover.push(l.id);
    return out;
  }

  const O = { CAT_TRANSF, interpretar, extrairData, extrairValor, pedacos, rotuloDe, baixo, semAcento, tokens, categoriaDe, chaveRegra, regraDe, nomeDe, classificar, gravacao, desfazer };
  raiz.CRMFrases = O;
  if (typeof module !== 'undefined') module.exports = O;
})(typeof window !== 'undefined' ? window : globalThis);
