/* CRM Sistemi Dalessi — Caixa: as contas (parte pura, sem tela). Separado de caixa.js em 06/10/2026
   para a Edge Function crm-caixa-leitura usar exatamente o mesmo cálculo da tela (ela baixa este
   arquivo do GitHub num commit fixo e confere o SHA-256, como a crm-notas faz com nfe.js).
   - Saldo = último saldo informado do banco ("Conferir com o banco") + o que foi baixado no caixa
     (✓) depois dele. Pago "fora" (sumiu do FKN, "já estava paga") aparece, mas não mexe no saldo.
   - Dia útil bancário de São Bernardo do Campo: o que vence em sábado, domingo ou feriado é pago (ou
     entra) no próximo dia útil; o vencimento gravado não muda.
   - Título do contas a receber entra no dia em que o dinheiro cai: pago no vencimento (ou no próximo
     dia útil) e creditado no dia útil seguinte.
   Testado em testes/caixa.test.js. Não usa regras.js (roda sozinho na Edge Function). */
(function (raiz) {
  'use strict';
  const r2 = v => Math.round(Number(v || 0) * 100) / 100;
  const dt = s => new Date(s + 'T12:00:00Z');
  const iso = d => d.toISOString().slice(0, 10);
  const soma = (s, n) => { const d = dt(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const semana = s => dt(s).getUTCDay();
  const dm = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  // ------------------------------------------------------------ feriados e dia útil (bancário, SBC)
  function pascoa(ano) { // Meeus/Butcher
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
  }
  const cacheFeriados = new Map();
  // Nacionais, o do Estado de SP (9 de julho), Carnaval (banco fechado) e os de São Bernardo do
  // Campo (aniversário da cidade, 20/08, e Corpus Christi), onde fica a OneClean.
  function feriados(ano) {
    if (cacheFeriados.has(ano)) return cacheFeriados.get(ano);
    const f = {};
    const add = (mmdd, nome) => { f[ano + '-' + mmdd] = { nome }; };
    add('01-01', 'Confraternização Universal'); add('04-21', 'Tiradentes'); add('05-01', 'Dia do Trabalho');
    add('09-07', 'Independência'); add('10-12', 'Nossa Senhora Aparecida'); add('11-02', 'Finados');
    add('11-15', 'Proclamação da República'); add('11-20', 'Consciência Negra'); add('12-25', 'Natal');
    add('07-09', 'Revolução Constitucionalista (SP)'); add('08-20', 'Aniversário de São Bernardo do Campo');
    const p = pascoa(ano);
    f[soma(p, -48)] = { nome: 'Carnaval' }; f[soma(p, -47)] = { nome: 'Carnaval' };
    f[soma(p, -2)] = { nome: 'Sexta-feira Santa' }; f[soma(p, 60)] = { nome: 'Corpus Christi' };
    cacheFeriados.set(ano, f);
    return f;
  }
  const feriado = s => feriados(Number(String(s).slice(0, 4)))[s] || null;
  const util = s => { const w = semana(s); return w !== 0 && w !== 6 && !feriado(s); };
  const posterga = s => { let x = s; while (!util(x)) x = soma(x, 1); return x; };
  const utilDepois = s => posterga(soma(s, 1));
  const porqueNaoUtil = s => { const f = feriado(s); return f ? 'feriado (' + f.nome + ')' : DIAS[semana(s)]; };
  // Dia em que o título cai na conta: pago no vencimento (ou próximo dia útil) e creditado no dia útil
  // seguinte. d1 = false: cai no mesmo dia do pagamento.
  const creditoTitulo = (venc, d1) => { const pg = posterga(venc); return d1 === false ? pg : utilDepois(pg); };

  // ------------------------------------------------------------ recorrentes
  // Empréstimo devolvido em parcelas fixas (tabela Price, igual à Agilité — recorrentes.js de lá):
  // com o valor contratado (PV) acha a taxa mensal por Newton; com a taxa, acha o PV. Parcela k:
  // juros = saldo antes × taxa, principal = parcela − juros (a última zera o saldo).
  function taxaPorNewton(pmt, n, pv) {
    if (!(pmt > 0 && n > 0 && pv > 0) || pmt * n <= pv) return 0; // sem juros (ou dado inconsistente)
    let i = 0.02;
    for (let it = 0; it < 100; it++) {
      const f = pmt * (1 - Math.pow(1 + i, -n)) / i - pv;
      const df = pmt * (n * Math.pow(1 + i, -n - 1) * i - (1 - Math.pow(1 + i, -n))) / (i * i);
      const ni = i - f / df;
      if (!isFinite(ni) || ni <= 0) { i = i / 2; continue; }
      if (Math.abs(ni - i) < 1e-12) { i = ni; break; }
      i = ni;
    }
    return i;
  }
  function cronogramaPrice(r) {
    const pmt = Number(r.valor) || 0, n = Number(r.parcelas) || 0;
    if (!(pmt > 0 && n > 0)) return null;
    let i, pv;
    if (Number(r.valor_contratado) > 0) { pv = Number(r.valor_contratado); i = taxaPorNewton(pmt, n, pv); }
    else if (Number(r.taxa_mes_pct) > 0) { i = Number(r.taxa_mes_pct) / 100; pv = pmt * (1 - Math.pow(1 + i, -n)) / i; }
    else return null;
    if (!(i > 0)) return null;
    const parcelas = [];
    let saldo = pv;
    for (let k = 1; k <= n; k++) {
      const juros = r2(saldo * i);
      let principal = r2(pmt - juros);
      if (k === n) principal = r2(saldo);
      parcelas.push({ k, juros, principal });
      saldo = Math.max(0, saldo - principal);
    }
    return { taxaPct: i * 100, pv, totalJuros: r2(parcelas.reduce((t, x) => t + x.juros, 0)), parcelas };
  }

  // "AAAA-MM" + dia → data, sem estourar o fim do mês (dia 31 em fevereiro → 28/29).
  function diaDoMes(compet, dia) {
    const [a, m] = compet.split('-').map(Number);
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    return compet + '-' + String(Math.min(dia, ultimo)).padStart(2, '0');
  }
  const mesesEntre = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  // Contas do mês "AAAA-MM" geradas pelas recorrentes ativas que ainda não têm a conta desse mês
  // (idempotente: o banco também barra duas contas da mesma recorrente no mesmo mês).
  function gerarMes(recorrentes, compet, existentes) {
    const ja = new Set((existentes || []).filter(l => l.recorrente_id).map(l => l.recorrente_id + '|' + String(l.competencia || '').slice(0, 7)));
    const out = [];
    (recorrentes || []).forEach(r => {
      if (r.ativo === false) return;
      const ini = String(r.inicio || '').slice(0, 7) || compet;
      if (compet < ini) return;
      let parcela = null;
      if (r.parcelas) { parcela = (r.parcela_inicio || 1) + mesesEntre(ini, compet); if (parcela > r.parcelas) return; }
      if (ja.has(r.id + '|' + compet)) return;
      // empréstimo com juros (valor contratado ou taxa): a parcela leva a parte de juros
      const pr = parcela ? cronogramaPrice(r) : null, pk = pr && pr.parcelas[parcela - 1];
      out.push(Object.assign({ tipo: r.tipo || 'saida', descricao: r.descricao + (parcela ? ' (' + String(parcela).padStart(2, '0') + ' de ' + r.parcelas + ')' : ''),
        fornecedor: r.fornecedor || null, categoria: r.categoria || null, valor: r2(r.valor), vencimento: diaDoMes(compet, r.dia),
        entre_empresas: !!r.entre_empresas, origem: 'recorrente', recorrente_id: r.id, competencia: compet + '-01', parcela, parcelas: r.parcelas || null },
        pk ? { juros: pk.juros, observacoes: 'Parcela ' + parcela + ' de ' + r.parcelas + ': juros R$ ' + pk.juros.toFixed(2).replace('.', ',') + ' + principal R$ ' + pk.principal.toFixed(2).replace('.', ',') +
          ' (Price, ' + pr.taxaPct.toFixed(2).replace('.', ',') + '% a.m.)' } : {}));
    });
    return out;
  }

  // ------------------------------------------------------------ saldo
  const tempo = v => { const t = Date.parse(v || ''); return isNaN(t) ? 0 : t; };
  function ancora(saldos) {
    return (saldos || []).slice().sort((a, b) => String(b.data).localeCompare(String(a.data)) || tempo(b.criado_em) - tempo(a.criado_em))[0] || null;
  }
  // Baixado no caixa depois do saldo informado (mesmo dia: baixado depois de informar).
  const contaNoSaldo = (l, a) => l.situacao === 'pago' && l.baixa === 'caixa' && l.pago_em &&
    (l.pago_em > a.data || (l.pago_em === a.data && tempo(l.baixado_em) > tempo(a.criado_em)));
  const sinal = l => (l.tipo === 'entrada' ? 1 : -1) * Number(l.valor || 0);
  function saldoAtual(saldos, lancs) {
    const a = ancora(saldos);
    if (!a) return { ancora: null, saldo: null, entradas: 0, saidas: 0, n: 0 };
    let e = 0, s = 0, n = 0;
    (lancs || []).forEach(l => { if (contaNoSaldo(l, a)) { n++; if (l.tipo === 'entrada') e += Number(l.valor || 0); else s += Number(l.valor || 0); } });
    return { ancora: a, saldo: r2(Number(a.valor) + e - s), entradas: r2(e), saidas: r2(s), n };
  }

  // ------------------------------------------------------------ grade
  // ------------------------------------------------------------ previsão ligada a título
  // A mesma venda por dois caminhos (06/10/2026): o recorrente "Material vendido à Agilité — <cond.>"
  // (previsão, da planilha) e a duplicata que o FKN emitiu contra a Agilité. O título é a fonte de
  // verdade: a previsão em aberto que tem o MESMO valor (±1 centavo), vencimento a até 5 dias e é
  // entre empresas fica ligada a um título de sacado Agilité (titulo_duplicata na previsão) e some da
  // grade — o título aparece uma vez, no dia do crédito. Receber o título baixa a previsão ligada (não
  // cria outra entrada). Ligada = aberto com titulo_duplicata; recebido = pago com titulo_duplicata.
  const ehEntreEmpresas = l => !!l.entre_empresas || ENTRE_EMPRESAS.test((l.categoria || '') + ' ' + (l.descricao || ''));
  const recebidosDe = lancs => new Set((lancs || []).filter(l => l.titulo_duplicata && l.situacao === 'pago').map(l => l.titulo_duplicata));
  const ligadaPersistida = l => l.situacao === 'aberto' && !!l.titulo_duplicata;
  // → [{ id (previsão), duplicata }] das ligações que ainda não estão gravadas.
  function ligacoesTitulos(lancs, titulos, nome) {
    const nomeT = nome || (t => t.cliente || t.cliente_nome || '');
    const usados = new Set((lancs || []).filter(l => l.titulo_duplicata).map(l => l.titulo_duplicata));
    const prev = (lancs || []).filter(l => l.tipo === 'entrada' && l.situacao === 'aberto' && !l.titulo_duplicata && ehEntreEmpresas(l));
    const tits = (titulos || []).filter(t => !usados.has(t.duplicata) && ENTRE_EMPRESAS.test(nomeT(t)));
    const pares = [];
    prev.forEach(l => tits.forEach(t => {
      const dd = Math.abs(Math.round((dt(l.vencimento) - dt(t.vencimento)) / 864e5));
      if (Math.abs(Number(l.valor) - Number(t.valor)) <= 0.01 && dd <= 5) pares.push({ l, t, dd });
    }));
    pares.sort((a, b) => a.dd - b.dd || String(a.t.duplicata).localeCompare(String(b.t.duplicata)));
    const ja = new Set(), out = [];
    pares.forEach(p => { if (ja.has('l' + p.l.id) || ja.has('t' + p.t.duplicata)) return; ja.add('l' + p.l.id); ja.add('t' + p.t.duplicata); out.push({ id: p.l.id, duplicata: p.t.duplicata }); });
    return out;
  }
  // previsão ligada (gravada ou não) de cada título: duplicata → lançamento
  function ligadasPorTitulo(lancs, titulos, nome) {
    const m = new Map();
    (lancs || []).forEach(l => { if (ligadaPersistida(l)) m.set(l.titulo_duplicata, l); });
    const porId = new Map((lancs || []).map(l => [l.id, l]));
    ligacoesTitulos(lancs, titulos, nome).forEach(x => m.set(x.duplicata, porId.get(x.id)));
    return m;
  }

  // Item: { chave, tipo: 'lanc'|'titulo', secao: 'entrada'|'saida', data, titulo, valor, estado:
  // 'feito'|'fora'|'previsto', obs, ref }. Vencidos (conta ou título que já devia ter acontecido)
  // ficam fora da grade e do saldo previsto: vão para os blocos próprios.
  function itensGrade(de, ate, hoje, lancs, titulos, opc) {
    opc = opc || {};
    const it = [];
    const add = o => { if (o.data >= de && o.data <= ate) it.push(o); };
    const recebidos = recebidosDe(lancs);
    const ligadas = ligadasPorTitulo(lancs, titulos, opc.nome);
    const escondidas = new Set([...ligadas.values()].map(l => l.id));
    (lancs || []).forEach(l => {
      const secao = l.tipo === 'entrada' ? 'entrada' : 'saida';
      const base = { chave: 'lanc:' + l.id, tipo: 'lanc', secao, titulo: l.descricao, valor: r2(l.valor), ref: l };
      if (l.situacao === 'pausado') return;
      if (l.situacao === 'aberto' && (l.titulo_duplicata || escondidas.has(l.id))) return; // o título representa
      if (l.situacao === 'pago') { add(Object.assign(base, { data: l.pago_em, estado: l.baixa === 'caixa' ? 'feito' : 'fora', obs: l.baixa === 'caixa' ? '' : 'pago fora do caixa do dia' })); return; }
      const pg = posterga(l.vencimento);
      if (pg < hoje) return;
      add(Object.assign(base, { data: pg, estado: 'previsto', obs: pg !== l.vencimento ? 'vence ' + dm(l.vencimento) + ', ' + porqueNaoUtil(l.vencimento) + ' → ' + (secao === 'entrada' ? 'entra' : 'paga') + ' no próximo dia útil' : '' }));
    });
    (titulos || []).forEach(t => {
      if (recebidos.has(t.duplicata)) return;
      const cr = creditoTitulo(t.vencimento, opc.d1);
      if (cr < hoje) return;
      const lig = ligadas.get(t.duplicata);
      add({ chave: 'tit:' + t.duplicata, tipo: 'titulo', secao: 'entrada', data: cr, titulo: (opc.nome ? opc.nome(t) : t.cliente_nome || 'Cliente') + ' · ' + t.duplicata + (lig ? ' · ' + lig.descricao : ''),
        valor: r2(t.valor), estado: 'previsto', obs: 'título vence ' + dm(t.vencimento) + ', cai na conta ' + dm(cr), ref: t, ligada: lig || null });
    });
    return it;
  }
  // Saldo no fim de cada dia. De hoje em diante: saldo atual + previstos até o dia (os de antes do
  // começo da grade também — "previstos" vem de hoje até o fim). Para trás: saldo atual − o que foi
  // baixado no caixa depois do dia (antes do saldo informado: sem saldo).
  function saldosGrade(dias, hoje, s, lancs, previstos) {
    const out = {};
    if (s.saldo == null) return out;
    dias.forEach(d => {
      if (d < hoje) {
        if (d < s.ancora.data) { out[d] = null; return; }
        let v = s.saldo;
        (lancs || []).forEach(l => { if (contaNoSaldo(l, s.ancora) && l.pago_em > d) v -= sinal(l); });
        out[d] = r2(v); return;
      }
      let v = s.saldo;
      (previstos || []).forEach(x => { if (x.estado === 'previsto' && x.data >= hoje && x.data <= d) v += (x.secao === 'entrada' ? 1 : -1) * x.valor; });
      out[d] = r2(v);
    });
    return out;
  }
  // titulos/nome: para não contar como vencida a previsão que um título representa (o título atrasado
  // vai para "A receber vencido").
  function vencidas(lancs, hoje, titulos, nome) {
    const lig = new Set([...ligadasPorTitulo(lancs, titulos, nome).values()].map(l => l.id));
    return (lancs || []).filter(l => l.situacao === 'aberto' && !l.titulo_duplicata && !lig.has(l.id) && posterga(l.vencimento) < hoje)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || b.valor - a.valor);
  }
  function receberVencido(titulos, lancs, hoje, d1) {
    const recebidos = recebidosDe(lancs);
    return (titulos || []).filter(t => !recebidos.has(t.duplicata) && creditoTitulo(t.vencimento, d1) < hoje)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }

  const CATEGORIAS_SAIDA = ['Fornecedores', 'Salários', 'Benefícios (VT, VR, cesta)', 'FGTS e encargos', 'Pró-labore', 'Retiradas dos sócios',
    'Reembolso da folha à Agilité', 'Aluguel', 'Energia', 'Água', 'Telefone e internet', 'Contabilidade', 'Sistema (FKN)', 'Convênio médico',
    'Impostos', 'Reparcelamentos', 'Cartões', 'Empréstimos e giro', 'Frete e combustível', 'Tarifas bancárias', 'Outras saídas'];
  const CATEGORIAS_ENTRADA = ['Duplicatas recebidas', 'Material vendido à Agilité', 'Empréstimos recebidos', 'Outras entradas'];
  // Passagem entre OneClean e Agilité: no "Geral" das duas empresas esses valores se anulam.
  const ENTRE_EMPRESAS = /agilit/i;

  // ------------------------------------------------------------ leitura (Agilité "Geral" e a gestora do grupo)
  // Mesmo formato do GET /api/ceo/resumo da Agilité (src/routes/caixa_leitura.js do
  // agilite-sistema-gestao), para somar as duas empresas. Os números saem das funções acima — as
  // mesmas da tela. Sem nome de pessoa: salário, benefícios, encargos, pró-labore, retiradas,
  // comissões e reembolso da folha saem somados por dia e categoria (descrição = categoria); CPF e
  // telefone em descrição saem mascarados.
  // d: { lancamentos, saldos, recorrentes, titulos (com .cliente = nome a mostrar), pessoas: [nomes
  // da equipe] }; o: { hoje, dias (1 a 90), d1, gerado_em }.
  const limpar = s => String(s || '').replace(/\*?\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, '[CPF]').replace(/\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g, '[telefone]').replace(/\s+/g, ' ').trim();
  const AGREGAR = new Set(['Salários', 'Benefícios (VT, VR, cesta)', 'FGTS e encargos', 'Pró-labore', 'Retiradas dos sócios', 'Reembolso da folha à Agilité', 'Comissões']);
  const PESSOAL = /comiss|salari|pro.?labore|retirada|ferias|rescis|adiantamento|vale.?(transporte|refei|alimenta)/;
  const semAc = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Reembolso da folha à Agilité que só diz o componente ("Reembolso folha 09/2026 — FGTS + consignado"):
  // sai com a descrição, para a aba Geral da Agilité casar componente com componente. É o total dos
  // funcionários, sem nome; qualquer palavra fora desta lista (um nome, por exemplo) volta a somar.
  const COMPONENTES = new Set(['salario', 'salarios', 'liquido', 'liquidos', 'beneficio', 'beneficios', 'vr', 'va', 'vt', 'mobilidade', 'cesta', 'basica', 'ii',
    'fgts', 'consignado', 'inss', 'encargos', 'ferias', '13o', '13', 'decimo', 'terceiro', 'rescisao', 'rescisoes', 'adiantamento', 'premio', 'assiduidade', 'e']);
  function reembolsoComponente(l) {
    if (l.categoria !== 'Reembolso da folha à Agilité') return false;
    const m = /^reembolso (?:da )?(?:folha|beneficios)(?: a agilite)?(?: \d{2}\/\d{4})? — (.+)$/.exec(semAc(l.descricao).replace(/\s+/g, ' ').trim());
    return !!m && m[1].split(/[^a-z0-9]+/).filter(Boolean).every(w => COMPONENTES.has(w));
  }
  function resumoLeitura(d, o) {
    const hoje = o.hoje;
    const n = Math.min(90, Math.max(1, Math.round(Number(o.dias) || 30)));
    const dias = Array.from({ length: n }, (_, i) => soma(hoje, i));
    const ate = dias[n - 1];
    const lancs = d.lancamentos || [];
    // cadastro vindo do Agendor como "Empresa | Contato": na leitura vai só a empresa (o contato é pessoa)
    const nomeT = t => String(t.cliente || t.cliente_nome || 'Cliente').split(/\s+\|\s+/)[0].trim() || 'Cliente';
    const opc = { d1: o.d1, nome: nomeT };
    // nomes da equipe (palavras de 4+ letras): descrição ou fornecedor com um deles sai somado
    const nomes = [...new Set((d.pessoas || []).map(semAc).join(' ').split(/[^a-z]+/).filter(w => w.length >= 4))];
    const temPessoa = txt => { const t = ' ' + semAc(txt).replace(/[^a-z]+/g, ' ') + ' '; return nomes.some(w => t.indexOf(' ' + w + ' ') !== -1); };
    const agregar = l => !reembolsoComponente(l) && (AGREGAR.has(l.categoria) || PESSOAL.test(semAc(l.descricao)) || temPessoa(l.descricao) || temPessoa(l.fornecedor));
    const entre = l => !!l.entre_empresas || ENTRE_EMPRESAS.test((l.categoria || '') + ' ' + (l.fornecedor || ''));
    const doLanc = (l, valor, situacao, extra) => {
      const ag = agregar(l);
      return Object.assign({ tipo: l.tipo === 'entrada' ? 'entrada' : 'saida', descricao: ag ? (l.categoria || 'Pessoal') : limpar(l.descricao), valor: r2(valor), situacao,
        categoria: l.categoria || (ag ? 'Pessoal' : null), cliente_fornecedor: ag ? null : (limpar(l.fornecedor) || null), entre_empresas: entre(l) },
        l.emprestimo ? { emprestimo: true } : {}, Number(l.juros) > 0 ? { juros: r2(l.juros) } : {}, extra || {}, { _ag: ag });
    };
    const somar = (itens, chave) => {
      const out = [], idx = new Map();
      itens.forEach(i => {
        if (!i._ag) { out.push(i); return; }
        const k = chave(i);
        const j = idx.get(k);
        if (j) { j.valor = r2(j.valor + i.valor); j._n++; } else { i._n = 1; idx.set(k, i); out.push(i); }
      });
      return out.map(i => { const x = Object.assign({}, i); delete x._ag; delete x._n; if (i._n > 1) x.lancamentos_somados = i._n; return x; });
    };

    const s = saldoAtual(d.saldos, lancs);
    const brutos = itensGrade(hoje, ate, hoje, lancs, d.titulos, opc);
    const saldos = saldosGrade(dias, hoje, s, lancs, brutos);
    const proximos_dias = dias.map(dia => {
      const doDia = brutos.filter(x => x.data === dia).sort((a, b) => (a.secao === b.secao ? 0 : a.secao === 'entrada' ? -1 : 1) || b.valor - a.valor);
      const conta = sec => r2(doDia.filter(x => x.secao === sec && x.estado !== 'fora').reduce((t, x) => t + x.valor, 0));
      const itens = doDia.map(x => {
        if (x.tipo === 'titulo') {
          const t = x.ref, nome = limpar(nomeT(t)), lig = x.ligada;
          return { tipo: 'entrada', descricao: 'Título ' + t.duplicata + ' — ' + nome + (lig ? ' · ' + limpar(lig.descricao) : ''), valor: r2(x.valor), situacao: 'previsto',
            categoria: lig && lig.categoria ? lig.categoria : 'Duplicatas recebidas', cliente_fornecedor: nome, entre_empresas: ENTRE_EMPRESAS.test(nome) || !!(lig && ehEntreEmpresas(lig)), _ag: false };
        }
        return doLanc(x.ref, x.valor, x.estado === 'previsto' ? 'previsto' : 'aconteceu', x.estado === 'fora' ? { pago_fora: true } : null);
      });
      return { data: dia, dia_util: util(dia), sem_banco: util(dia) ? null : porqueNaoUtil(dia), entradas: conta('entrada'), saidas: conta('saida'),
        saldo_fim_do_dia: saldos[dia] == null ? null : r2(saldos[dia]),
        itens: somar(itens, i => [i.tipo, i.situacao, i.categoria, i.entre_empresas, !!i.pago_fora].join('|')) };
    });
    const comSaldo = proximos_dias.filter(x => x.saldo_fim_do_dia != null);
    const menor = comSaldo.reduce((m, x) => (m == null || x.saldo_fim_do_dia < m.saldo_fim_do_dia ? x : m), null);

    const venc = vencidas(lancs, hoje, d.titulos, nomeT);
    const itensVenc = somar(venc.map(l => Object.assign(doLanc(l, l.valor, 'vencido'), { data: l.vencimento, paga_em: posterga(l.vencimento) })),
      i => [i.data, i.tipo, i.categoria, i.entre_empresas].join('|'));

    // pausadas agrupadas pela conta: recorrente, fornecedor (as do FKN) ou descrição sem a parcela
    const recs = new Map((d.recorrentes || []).map(r => [r.id, r]));
    const grupos = new Map();
    lancs.filter(l => l.situacao === 'pausado').sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento))).forEach(l => {
      const ag = agregar(l);
      const conta = ag ? (l.categoria || 'Pessoal') : limpar((l.recorrente_id && recs.get(l.recorrente_id) && recs.get(l.recorrente_id).descricao) ||
        (l.origem === 'fkn' && l.fornecedor) || String(l.descricao).replace(/\s*\(\d+\s*de\s*\d+\)\s*$/i, '').replace(/\s*·\s*[^·]*$/, ''));
      const k = conta + '|' + l.tipo;
      const g = grupos.get(k) || { conta, tipo: l.tipo === 'entrada' ? 'entrada' : 'saida', categoria: l.categoria || null, parcelas: 0, total: 0, vencimentos: [],
        motivo: l.origem === 'fkn' ? 'pendência antiga do FKN (vencida há mais de 60 dias ou emitida há mais de 1 ano), para conferir' : 'pausada no Caixa', entre_empresas: entre(l) };
      g.parcelas++; g.total = r2(g.total + Number(l.valor || 0)); g.vencimentos.push(l.vencimento);
      grupos.set(k, g);
    });
    const pausadas = [...grupos.values()].sort((a, b) => b.total - a.total);

    const recebidos = recebidosDe(lancs);
    const ligT = ligadasPorTitulo(lancs, d.titulos, nomeT);
    const tits = (d.titulos || []).filter(t => !recebidos.has(t.duplicata)).map(t => {
      const cai = creditoTitulo(t.vencimento, o.d1), nome = limpar(nomeT(t));
      const lig = ligT.get(t.duplicata);
      return Object.assign({ cliente: nome, duplicata: t.duplicata, valor: r2(t.valor), vencimento: t.vencimento, cai_na_conta: cai, atrasado: cai < hoje,
        entre_empresas: ENTRE_EMPRESAS.test(nome) || !!(lig && ehEntreEmpresas(lig)) }, lig ? { referente: limpar(lig.descricao) } : {});
    }).sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.duplicata.localeCompare(b.duplicata));
    const atrasados = tits.filter(t => t.atrasado);

    return {
      empresa: 'oneclean', nome: 'OneClean', contas: ['Banco do Brasil'], gerado_em: o.gerado_em || new Date().toISOString(), hoje, moeda: 'BRL',
      regras: 'Saldo = último saldo informado do Banco do Brasil + o que foi baixado no caixa do dia depois dele. O que vence em sábado, domingo ou feriado ' +
        '(nacional, de SP e de São Bernardo do Campo) entra no próximo dia útil. Título a receber é pago no vencimento (ou no próximo dia útil) e cai na conta ' +
        (o.d1 === false ? 'no mesmo dia' : 'no dia útil seguinte (D+1)') + '. Contas vencidas sem baixa e títulos atrasados ficam fora do saldo previsto. ' +
        'Itens "aconteceu" com pago_fora: true foram pagos fora do caixa do dia: já estão no saldo informado e não entram nas entradas/saídas do dia. ' +
        'Salários, benefícios, encargos, pró-labore, retiradas, comissões e o reembolso da folha à Agilité vêm somados por dia e categoria, sem nome. ' +
        'entre_empresas: true = passa entre OneClean e Agilité (reembolso da folha, material vendido à Agilité); no Geral se anula.',
      saldo: { informado: s.ancora ? r2(s.ancora.valor) : null, informado_em: s.ancora ? s.ancora.data : null, atual: s.saldo == null ? null : r2(s.saldo), lancamentos_depois: s.n || 0 },
      periodo: { de: hoje, ate, dias: n },
      totais_periodo: { entradas: r2(proximos_dias.reduce((t, x) => t + x.entradas, 0)), saidas: r2(proximos_dias.reduce((t, x) => t + x.saidas, 0)),
        saldo_final: comSaldo.length ? comSaldo[comSaldo.length - 1].saldo_fim_do_dia : null },
      menor_saldo: menor ? { data: menor.data, valor: menor.saldo_fim_do_dia } : null,
      proximos_dias,
      contas_vencidas: { quantidade: venc.length, total: r2(venc.reduce((t, l) => t + (l.tipo === 'entrada' ? 0 : Number(l.valor || 0)), 0)),
        entradas_vencidas: r2(venc.reduce((t, l) => t + (l.tipo === 'entrada' ? Number(l.valor || 0) : 0), 0)), itens: itensVenc },
      contas_pausadas: { quantidade_parcelas: pausadas.reduce((t, g) => t + g.parcelas, 0), total: r2(pausadas.reduce((t, g) => t + (g.tipo === 'entrada' ? 0 : g.total), 0)), contas: pausadas },
      titulos_a_receber: { quantidade: tits.length, total: r2(tits.reduce((t, x) => t + x.valor, 0)), vencidos: atrasados.length,
        total_vencido: r2(atrasados.reduce((t, x) => t + x.valor, 0)), titulos: tits }
    };
  }

  const O = { cronogramaPrice, taxaPorNewton, resumoLeitura, limpar, ligacoesTitulos, ligadasPorTitulo, recebidosDe, feriados, feriado, util, posterga, utilDepois, porqueNaoUtil, creditoTitulo, pascoa, diaDoMes, gerarMes, ancora, saldoAtual,
    itensGrade, saldosGrade, vencidas, receberVencido, CATEGORIAS_SAIDA, CATEGORIAS_ENTRADA, ENTRE_EMPRESAS, soma };
  raiz.CRMCaixa = O;
  if (typeof module !== 'undefined') module.exports = O;

})(typeof window !== 'undefined' ? window : globalThis);
