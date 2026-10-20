/* CRM Sistemi Dalessi — Caixa: contas a pagar, contas recorrentes e caixa do dia (06/10/2026).
   Troca a planilha "Fluxo de Caixa" do Excel. SÓ o administrador: tem salário, pró-labore e retirada
   (a RLS das tabelas crm_fin_* barra todo o resto — ver schema.sql).
   As contas (saldo, grade, dia útil, crédito dos títulos) ficam em caixa-calculo.js (CRMCaixa), que
   a Edge Function crm-caixa-leitura também usa; aqui fica a tela.
   - Grade de 15 dias como a planilha: uma coluna por dia, entradas em cima, saídas embaixo, total de
     cada parte e saldo no fim do dia. Verde = aconteceu; branco = previsto; borda vermelha = venceu. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras;
  const C = raiz.CRMCaixa;
  const { feriado, posterga, porqueNaoUtil, creditoTitulo, gerarMes, saldoAtual, itensGrade, saldosGrade, vencidas, receberVencido, baixadosPendentes, ancora, ligacoesTitulos, ligadasPorTitulo,
    CATEGORIAS_SAIDA, CATEGORIAS_ENTRADA, ENTRE_EMPRESAS } = C;
  const r2 = v => Math.round(Number(v || 0) * 100) / 100;
  const semana = s => new Date(s + 'T12:00:00Z').getUTCDay();
  const dm = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  // ------------------------------------------------------------ tela
  const CRM = raiz.CRM;
  if (!CRM || !CRM.telas) return;
  const E = () => CRM.estado;
  const esc = CRM.esc;
  const $ = (s, el) => (el || document).querySelector(s);

  let F = null, lidoEm = 0, lendo = false, vista = 'dia', inicio = null;
  const filtro = { situacao: 'abertas', tipo: '', busca: '' };
  const hoje = () => CRM.hoje();
  const agora = () => new Date().toISOString();
  const d1 = () => (E().cfg || {}).caixa_credito_d1 !== false;
  const nomeTitulo = t => { const e = t.empresa_id && CRM.empresa(t.empresa_id); return (e && e.nome) || t.cliente_nome || 'Cliente'; };
  const titulos = () => E().D.titulos || [];
  // Título em cartório (14/10/2026) sai da previsão: não se sabe quando o cliente paga. Continua em
  // titulos() (o "Recebi" e a frase acham ele) e no bloco "Em cartório".
  const titulosCaixa = () => titulos().filter(t => !t.cartorio_em);

  async function carrega() {
    if (lendo) return;
    lendo = true;
    lidoEm = Date.now();
    try { F = await CRM.store().carregarFin(); } catch (e) { if (!F) F = { recorrentes: [], lancamentos: [], saldos: [], regras: [], baixados: [], excluidos: [] }; CRM.falhou(e); }
    // previsão (ex.: material vendido à Agilité) que tem título igual do FKN: grava a ligação, para o
    // ✓ do título baixar a previsão em vez de criar outra entrada (caixa-calculo.js, ligacoesTitulos)
    try {
      const lig = titulos().length ? ligacoesTitulos(F.lancamentos, titulos(), nomeTitulo) : [];
      for (const x of lig) troca(F.lancamentos, await CRM.store().atualizar('fin_lancamentos', x.id, { titulo_duplicata: x.duplicata }));
      if (lig.length) CRM.toast(lig.length + ' previsão(ões) ligada(s) ao título do FKN de mesmo valor: aparecem uma vez, no dia do título.');
    } catch (e) { CRM.falhou(e); }
    lendo = false;
    CRM.render();
  }
  const troca = (lista, r) => { const i = lista.findIndex(x => x.id === r.id); if (i >= 0) lista[i] = r; else lista.push(r); };
  async function grava(id, patch) { const r = await CRM.store().atualizar('fin_lancamentos', id, patch); troca(F.lancamentos, r); CRM.render(); return r; }
  async function insere(obj) { const r = await CRM.store().inserir('fin_lancamentos', obj); troca(F.lancamentos, r); CRM.render(); return r; }
  async function remove(id) { await CRM.store().remover('fin_lancamentos', id); F.lancamentos = F.lancamentos.filter(x => x.id !== id); CRM.render(); }
  const fecha = () => { const d = $('#dlgForm'); if (d && d.open) d.close(); };
  // Excluir de vez (13/10/2026, Anderson: conta do FKN lançada por engano — "não é nem pausar, seria
  // excluir"). O lançamento fica guardado inteiro em crm_fin_excluidos (cópia de segurança); o que veio
  // do FKN entra na lista que a próxima listagem do contas a pagar respeita (tela e vigia): não volta.
  const textoExcluir = l => (l.chave_fkn ? 'Excluir esta conta do FKN? Ela sai do caixa e não volta nas próximas listagens do FKN.' : 'Excluir este lançamento? Ele sai do caixa.') +
    (l.espelho_par || l.espelho_ref ? '\nO espelho no Caixa da Agilité também é desfeito.' : '') + '\n(Fica guardada uma cópia.)';
  async function excluirLanc(l) {
    const ja = l.chave_fkn && (F.excluidos || []).some(x => x.chave_fkn === l.chave_fkn);
    const r = await CRM.store().inserir('fin_excluidos', { lancamento_id: l.id, chave_fkn: ja ? null : l.chave_fkn || null, descricao: l.descricao, valor: l.valor,
      vencimento: l.vencimento || null, dados: Object.assign({}, l) });
    (F.excluidos = F.excluidos || []).push(r);
    await remove(l.id);
  }
  const chavesExcluidas = () => (F.excluidos || []).map(x => x.chave_fkn).filter(Boolean);
  const lanc = id => F && F.lancamentos.find(x => x.id === id);

  // ---- ações sobre um lançamento
  const pagar = (l, dia) => grava(l.id, { situacao: 'pago', pago_em: dia, baixa: 'caixa', baixado_em: agora() });
  // valor: o que entrou de fato (o cliente em atraso pagou com juros, ou só uma parte); sem ele, o do título
  async function receberTitulo(dup, dia, valor) {
    const t = titulos().find(x => x.duplicata === dup);
    if (!t) return;
    const v = valor > 0 ? r2(valor) : r2(t.valor);
    // previsão ligada a este título: ela vira o recebimento (não cria outra entrada)
    const lig = ligadasPorTitulo(F.lancamentos, titulos(), nomeTitulo).get(dup);
    if (lig) {
      await grava(lig.id, { situacao: 'pago', pago_em: dia, baixa: 'caixa', baixado_em: agora(), valor: v, titulo_duplicata: dup });
      CRM.toast('Recebido em ' + dm(dia) + ': ' + R.moeda(v) + ' (' + lig.descricao + ')');
      return;
    }
    await insere({ tipo: 'entrada', descricao: 'Recebido: ' + nomeTitulo(t) + ' · ' + t.duplicata, categoria: 'Duplicatas recebidas', valor: v,
      vencimento: t.vencimento, situacao: 'pago', pago_em: dia, baixa: 'caixa', baixado_em: agora(), origem: 'titulo', titulo_duplicata: t.duplicata,
      entre_empresas: ENTRE_EMPRESAS.test(nomeTitulo(t)), observacoes: v !== r2(t.valor) ? 'Título de ' + R.moeda(t.valor) + '; entrou ' + R.moeda(v) + '.' : null });
    CRM.toast('Recebido em ' + dm(dia) + ': ' + R.moeda(v));
  }
  // Título baixado no FKN (sumiu da listagem do contas a receber) sem "Recebi" aqui: o administrador diz
  // se o dinheiro entrou (dia e valor) ou não (abatimento, devolução, cancelamento). crm_fin_titulos_baixados.
  const baixados = () => baixadosPendentes(F.baixados, F.lancamentos, titulos(), hoje(), d1());
  const baixado = id => (F.baixados || []).find(x => x.id === id);
  const ligadaAberta = dup => F.lancamentos.find(l => l.situacao === 'aberto' && l.titulo_duplicata === dup);
  async function resolveBaixado(b, patch) {
    const r = await CRM.store().atualizar('fin_titulos_baixados', b.id, Object.assign({ resolvido_em: patch.resolvido ? agora() : null }, patch));
    F.baixados = F.baixados || [];
    troca(F.baixados, r);
    CRM.render();
    return r;
  }
  async function entrouBaixado(b, dia, valor) {
    const v = valor > 0 ? r2(valor) : r2(b.valor);
    const nome = nomeTitulo(b);
    const lig = ligadaAberta(b.duplicata); // previsão ligada ao título (ex.: material à Agilité): ela vira o recebimento
    const l = lig ? await grava(lig.id, { situacao: 'pago', pago_em: dia, baixa: 'caixa', baixado_em: agora(), valor: v })
      : await insere({ tipo: 'entrada', descricao: 'Recebido: ' + nome + ' · ' + b.duplicata, categoria: 'Duplicatas recebidas', valor: v,
        vencimento: b.vencimento || dia, situacao: 'pago', pago_em: dia, baixa: 'caixa', baixado_em: agora(), origem: 'titulo', titulo_duplicata: b.duplicata,
        entre_empresas: ENTRE_EMPRESAS.test(nome), observacoes: (v !== r2(b.valor) ? 'Título de ' + R.moeda(b.valor) + '; entrou ' + R.moeda(v) + '. ' : '') + 'Baixado no FKN.' });
    await resolveBaixado(b, { resolvido: 'entrou', lancamento_id: l.id });
    const a = ancora(F.saldos);
    CRM.toast('Entrou em ' + dm(dia) + ': ' + R.moeda(v) + (a && dia < a.data ? ' — já estava no saldo do BB informado em ' + dm(a.data) + ' (não muda o saldo).' : ' — no saldo do caixa.'));
  }
  async function naoEntrouBaixado(b) {
    const lig = ligadaAberta(b.duplicata);
    if (lig) await grava(lig.id, { titulo_duplicata: null }); // a previsão ligada volta para a grade, para decidir à parte
    await resolveBaixado(b, { resolvido: 'nao_entrou' });
    CRM.toast(b.duplicata + ': não entrou no banco — saiu da lista, sem mexer no saldo.');
  }
  function formBaixado(b) {
    CRM.abrirForm({
      titulo: 'Baixado no FKN', intro: nomeTitulo(b) + ' · duplicata ' + b.duplicata + ' · ' + R.moeda(b.valor) + (b.vencimento ? '\nVenceu ' + R.dataBR(b.vencimento) : '') +
        '.\nSaiu do contas a receber do FKN em ' + R.dataBR(String(b.sumiu_em || '').slice(0, 10)) + ' sem "Recebi" aqui. Diga quando e quanto entrou no Banco do Brasil.',
      campos: [{ nome: 'dia', rotulo: 'Entrou em', tipo: 'data' }, { nome: 'valor', rotulo: 'Valor que entrou (R$)', tipo: 'numero', ajuda: 'com juros ou só uma parte? ponha o que caiu na conta' }],
      valores: { dia: b.dia, valor: r2(b.valor) },
      salvarTexto: 'Entrou', aoSalvar: async v => { await entrouBaixado(b, diaDaBaixa(v.dia || b.dia), v.valor); }
    });
  }
  // Título em atraso: o dia em que se espera receber (crm_titulos.previsao). null tira a remarcação.
  async function remarcarTitulo(dup, dia) {
    const t = titulos().find(x => x.duplicata === dup);
    if (!t) return;
    if (dia && dia < hoje()) throw new Error('escolha hoje ou um dia depois.');
    const r = await CRM.store().atualizar('titulos', t.id, { previsao: dia || null });
    const l = titulos(), i = l.indexOf(t);
    if (i >= 0) l[i] = Object.assign({}, t, r);
    CRM.render();
    const antes = dia && posterga(dia) < creditoTitulo(t.vencimento, d1());
    CRM.toast(dia ? t.duplicata + ' remarcado para ' + dm(dia) + (antes ? ' (em verde: o cliente adiantou).' : ' (em vermelho: em atraso).') : 'Remarcação tirada: o título volta para o vencimento.');
  }
  // Dia da baixa: o da coluna, se já passou; senão hoje (não se paga no futuro).
  const diaDaBaixa = d => (d && d <= hoje() ? d : hoje());

  // ---- formulários
  function formLanc(l, pre) {
    pre = pre || {};
    const tipo = (l && l.tipo) || pre.tipo || 'saida';
    const pago = l && l.situacao === 'pago';
    CRM.abrirForm({
      titulo: l ? 'Editar ' + (tipo === 'entrada' ? 'entrada' : 'conta a pagar') : tipo === 'entrada' ? 'Nova entrada' : 'Nova conta a pagar',
      intro: l && l.origem === 'fkn' ? 'Conta que veio do FKN: se ela sumir da próxima listagem, é dada como paga.' : l && l.recorrente_id ? 'Conta gerada por uma recorrente: mudar aqui vale só para este mês.' : '',
      largura: 'largo',
      campos: [
        { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: [['saida', 'Saída (conta a pagar)'], ['entrada', 'Entrada']] },
        { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, largo: true, dica: tipo === 'entrada' ? 'ex.: Material vendido à Agilité — Gran Village' : 'ex.: Aluguel do galpão' },
        { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'numero', obrigatorio: true },
        { nome: 'vencimento', rotulo: tipo === 'entrada' ? 'Data prevista' : 'Vencimento', tipo: 'data', obrigatorio: true },
        { nome: 'categoria', rotulo: 'Categoria', sugestoes: CATEGORIAS_SAIDA.concat(CATEGORIAS_ENTRADA) },
        { nome: 'fornecedor', rotulo: tipo === 'entrada' ? 'De quem' : 'Fornecedor' },
        { nome: 'parcela', rotulo: 'Parcela nº', tipo: 'numero', passo: '1', vazioNulo: true },
        { nome: 'parcelas', rotulo: 'de (total de parcelas)', tipo: 'numero', passo: '1', vazioNulo: true },
        { nome: 'entre_empresas', rotulo: 'Entre empresas (OneClean ↔ Agilité)', tipo: 'checkbox', ajuda: 'reembolso da folha, material vendido à Agilité' },
        pago ? { nome: 'pago_em', rotulo: 'Pago em', tipo: 'data' } : null,
        { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', largo: true, linhas: 2 }
      ].filter(Boolean),
      valores: l || { tipo, vencimento: pre.data || hoje(), entre_empresas: false },
      aoSalvar: async v => {
        if (ENTRE_EMPRESAS.test(v.categoria || '')) v.entre_empresas = true;
        v.valor = r2(v.valor);
        if (!(v.valor > 0)) throw new Error('Informe o valor.');
        if (l) await grava(l.id, v);
        else await insere(Object.assign({ origem: 'tela' }, v));
      },
      aoExcluir: l ? async () => { await excluirLanc(l); CRM.toast('Lançamento excluído.'); } : null,
      textoExcluir: l ? textoExcluir(l) : ''
    });
  }

  // Menu do cartão da grade: ajustar valor e dia, e o que dá para fazer com ele.
  function menuItem(chave, diaColuna) {
    const [tp, id] = [chave.slice(0, chave.indexOf(':')), chave.slice(chave.indexOf(':') + 1)];
    const dia = diaDaBaixa(diaColuna);
    const rotDia = dia === hoje() ? 'hoje' : 'em ' + dm(dia);
    if (tp === 'tit') {
      const t = titulos().find(x => x.duplicata === id);
      if (!t) return;
      const atrasado = posterga(t.vencimento) < hoje();
      CRM.abrirForm({
        titulo: 'Título a receber', intro: nomeTitulo(t) + ' · duplicata ' + t.duplicata + ' · ' + R.moeda(t.valor) +
          ((lig => lig ? '\nÉ a previsão "' + lig.descricao + '" (mesmo valor): receber o título dá baixa nela.' : '')(ligadasPorTitulo(F.lancamentos, titulos(), nomeTitulo).get(t.duplicata))) + '\nVence ' + R.dataBR(t.vencimento) +
          (t.previsao && t.previsao >= hoje() && posterga(t.previsao) < creditoTitulo(t.vencimento, d1()) ? ' · o cliente adiantou: remarcado para ' + R.dataBR(t.previsao)
            : t.previsao ? ' · em atraso, remarcado para ' + R.dataBR(t.previsao) : atrasado ? ' · em atraso' : ', cai na conta ' + R.dataBR(creditoTitulo(t.vencimento, d1()))) +
          '.\nO título sai do contas a receber quando a listagem do FKN mostrar que foi pago.' +
          (t.cartorio_em ? '\nEM CARTÓRIO desde ' + R.dataBR(t.cartorio_em) + (t.cartorio_obs ? ' — ' + t.cartorio_obs : '') + ': fora da previsão até o cliente pagar.' : ''),
        campos: [{ nome: 'dia', rotulo: 'Recebido em', tipo: 'data' }, { nome: 'valor', rotulo: 'Valor que entrou (R$)', tipo: 'numero', ajuda: 'com juros ou só uma parte? ponha o que caiu na conta' },
          { nome: 'nova', rotulo: 'Ou remarcar para', tipo: 'data', ajuda: 'o dia em que espera receber (depois do vencimento: vermelho; antes, o cliente adiantou: verde); também dá para arrastar o título' }],
        valores: { dia, valor: r2(t.valor), nova: t.previsao || '' },
        rodape: (t.cartorio_em ? '' : '<button type="button" class="btn sec" data-acao="cx-tit-remarcar" data-id="' + esc(t.duplicata) + '">Remarcar</button>') +
          (t.previsao && !t.cartorio_em ? '<button type="button" class="btn sec" data-acao="cx-tit-desremarcar" data-id="' + esc(t.duplicata) + '">Tirar a remarcação</button>' : '') +
          (t.cartorio_em ? '<button type="button" class="btn sec" data-acao="cob-tirar-cartorio" data-id="' + esc(t.duplicata) + '">Tirar do cartório</button>'
            : atrasado && t.empresa_id ? '<button type="button" class="btn perigo" data-acao="cob-cartorio" data-id="' + esc(t.duplicata) + '">Mandar para cartório</button>' : ''),
        salvarTexto: 'Recebi', aoSalvar: async v => { await receberTitulo(t.duplicata, diaDaBaixa(v.dia || dia), v.valor); }
      });
      return;
    }
    const l = lanc(id);
    if (!l) return;
    const rod = (acao, rot, cls) => '<button type="button" class="btn ' + (cls || 'sec') + '" data-acao="' + acao + '" data-id="' + esc(l.id) + '" data-dia="' + esc(dia) + '">' + esc(rot) + '</button>';
    const aberto = l.situacao === 'aberto';
    CRM.abrirForm({
      titulo: l.descricao,
      intro: [l.tipo === 'entrada' ? 'Entrada' : 'Saída', R.moeda(l.valor), (aberto ? 'vence ' : 'pago em ') + R.dataBR(aberto ? l.vencimento : l.pago_em),
        l.categoria, l.entre_empresas ? 'entre empresas' : '', l.situacao === 'pago' && l.baixa === 'fora' ? 'pago fora do caixa do dia' : ''].filter(Boolean).join(' · ') +
        (l.frase ? '\nLançado pela frase: "' + l.frase + '"' : ''),
      campos: aberto ? [{ nome: 'valor', rotulo: 'Valor (R$)', tipo: 'numero', ajuda: 'a fatura chegou com outro valor?' }, { nome: 'vencimento', rotulo: 'Novo dia', tipo: 'data' }] : [],
      valores: { valor: l.valor, vencimento: l.vencimento },
      salvarTexto: aberto ? 'Ajustar' : 'Fechar',
      rodape: (l.anexos && l.anexos.length ? rod('cx-anexo-abrir', '📎 Comprovante' + (l.anexos.length > 1 ? 's (' + l.anexos.length + ')' : '')) : '') +
        (l.frase ? rod('cx-desfrase', 'Desfazer a frase', 'perigo') : '') +
        (aberto ? rod('cx-pagar', (l.tipo === 'entrada' ? 'Recebi ' : 'Paguei ') + rotDia, 'verde') + rod('cx-pausar', 'Pausar') : l.frase ? '' : rod('cx-desfazer', 'Desfazer a baixa')) +
        (l.frase ? '' : rod('cx-excluir', 'Excluir', 'perigo')) + rod('cx-editar', 'Editar tudo'),
      aoSalvar: async v => { if (aberto) await grava(l.id, { valor: r2(v.valor), vencimento: v.vencimento || l.vencimento }); }
    });
  }

  function formConferir() {
    const s = saldoAtual(F.saldos, F.lancamentos);
    CRM.abrirForm({
      titulo: 'Conferir com o banco',
      intro: s.ancora ? 'Pelo CRM, o saldo agora é ' + R.moeda(s.saldo) + ' (informado ' + R.moeda(s.ancora.valor) + ' em ' + R.dataBR(s.ancora.data) +
        (s.n ? ', mais ' + R.moeda(s.entradas) + ' de entradas e menos ' + R.moeda(s.saidas) + ' de saídas baixadas aqui' : '') + ').\nDigite o saldo que o Banco do Brasil mostra: o CRM passa a contar dele.' :
        'Digite o saldo que o Banco do Brasil mostra hoje: o caixa passa a contar dele.',
      campos: [{ nome: 'valor', rotulo: 'Saldo no banco (R$)', tipo: 'numero', obrigatorio: true, min: -1e9 }, { nome: 'data', rotulo: 'Saldo do dia', tipo: 'data', obrigatorio: true },
        { nome: 'observacao', rotulo: 'Observação', largo: true }],
      valores: { data: hoje() },
      // a diferença aparece enquanto digita (15/10: o Anderson esperava ver a diferença antes de salvar)
      htmlDepois: s.saldo == null ? '' : '<p class="cx-dif-conf" id="cxDifConf" hidden></p>',
      salvarTexto: 'Usar este saldo',
      aoSalvar: async v => {
        const r = await CRM.store().inserir('fin_saldos', { data: v.data, valor: r2(v.valor), observacao: v.observacao || null });
        F.saldos.push(r);
        const dif = s.saldo == null ? null : r2(v.valor - s.saldo);
        // saldo de um dia passado com baixas depois dele: a comparação com o "agora" do CRM não vale
        const baixouDepois = F.lancamentos.some(l => l.situacao === 'pago' && l.baixa === 'caixa' && l.pago_em > v.data);
        CRM.render();
        if (dif && !baixouDepois) setTimeout(() => formDiferenca(dif, v.data, s.saldo, r2(v.valor)), 0);
        else CRM.toast(dif == null || !dif ? 'Saldo do banco gravado.' : 'Saldo do banco gravado. Diferença para o CRM: ' + (dif > 0 ? '+' : '') + R.moeda(dif) + '.');
      }
    });
    const dlg = typeof document !== 'undefined' && document.getElementById('dlgForm');
    const linha = dlg && dlg.querySelector('#cxDifConf');
    if (!linha) return;
    const campoV = dlg.querySelector('[name="valor"]'), campoD = dlg.querySelector('[name="data"]'), botao = dlg.querySelector('button[type=submit]');
    const mostra = () => {
      const t = String(campoV.value || '').trim();
      const v = t ? Number(t.replace(/\./g, '').replace(',', '.')) : NaN;
      const valido = t && isFinite(Number(t)) ? Number(t) : v;
      if (!isFinite(valido) || !t) { linha.hidden = true; botao.textContent = 'Usar este saldo'; return; }
      const dif = r2(valido - s.saldo);
      const passado = campoD.value && campoD.value < hoje();
      linha.hidden = false;
      if (!dif) { linha.className = 'cx-dif-conf ok'; linha.textContent = '✓ Igual ao CRM: nada a acertar.'; botao.textContent = 'Usar este saldo'; return; }
      linha.className = 'cx-dif-conf ' + (dif < 0 ? 'menos' : 'mais');
      linha.textContent = 'Diferença: ' + R.moeda(Math.abs(dif)) + (dif < 0 ? ' a menos no banco (saiu e não está no CRM)' : ' a mais no banco (entrou e não está no CRM)') +
        (passado ? ' — saldo de dia passado: confira as baixas feitas depois dele.' : '. Ao salvar, você escolhe o que foi (tarifas, juros, conta esquecida…) para lançar.');
      botao.textContent = passado ? 'Usar este saldo' : 'Usar este saldo e lançar a diferença';
    };
    campoV.addEventListener('input', mostra); campoD.addEventListener('change', mostra);
    mostra();
  }
  // Diferença entre o banco e o CRM na conferência (15/10/2026, Anderson: "senão essa diferença vai ficar perdida; foram
  // tarifas bancárias"): oferece lançar a diferença, já paga FORA do caixa (o saldo do banco informado já a desconta, então
  // não mexe no saldo), na categoria certa. Conta em aberto do mesmo valor vira opção ("era esta conta").
  function formDiferenca(dif, dia, saldoCrm, saldoBanco) {
    const saida = dif < 0, valor = Math.abs(dif);
    const iguais = F.lancamentos.filter(l => l.situacao === 'aberto' && (l.tipo === 'entrada') === !saida && Math.abs(Number(l.valor) - valor) < 0.005 && l.vencimento <= R.somaDias(dia, 7))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento)).slice(0, 3);
    const opcoes = iguais.map(l => ['conta:' + l.id, 'Era a conta "' + l.descricao + '" (' + R.dataBR(l.vencimento) + ') — dar como paga']).concat(saida
      ? [['tarifa', 'Tarifas bancárias (boleto, Pix, manutenção da conta)'], ['juros', 'Juros ou IOF do banco'], ['outra', 'Outra saída que não foi lançada'], ['nada', 'Não lançar (só acertar o saldo)']]
      : [['rendimento', 'Rendimento da conta'], ['estorno', 'Estorno ou devolução de tarifa'], ['outra', 'Outra entrada que não foi lançada'], ['nada', 'Não lançar (só acertar o saldo)']]);
    const grande = valor >= 300;
    CRM.abrirForm({
      titulo: 'Diferença de ' + R.moeda(valor) + (saida ? ' a menos no banco' : ' a mais no banco'),
      intro: 'Saldo do banco gravado: ' + R.moeda(saldoBanco) + ' em ' + R.dataBR(dia) + '. Pelo CRM era ' + R.moeda(saldoCrm) + '.\n' +
        (saida ? 'Saiu do banco ' : 'Entrou no banco ') + R.moeda(valor) + ' que não estava no CRM. Lance aqui para não perder: fica como ' + (saida ? 'paga' : 'recebida') +
        ' em ' + R.dataBR(dia) + ' e não mexe no saldo (o banco já conta).' +
        (grande ? '\nValor alto para ser só tarifa: confira antes se não falta dar baixa em alguma conta ou título do dia.' : ''),
      campos: [{ nome: 'como', rotulo: 'O que foi', tipo: 'select', opcoes, largo: true },
        { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'numero', dica: 'pode ser só uma parte da diferença' },
        { nome: 'categoria', rotulo: 'Categoria (para "Outra")', sugestoes: saida ? CATEGORIAS_SAIDA : CATEGORIAS_ENTRADA },
        { nome: 'descricao', rotulo: 'Descrição (opcional)', largo: true, dica: saida ? 'ex.: tarifas de boleto de outubro' : 'ex.: rendimento da aplicação' }],
      valores: { como: iguais.length ? opcoes[0][0] : (saida ? 'tarifa' : 'rendimento'), valor },
      salvarTexto: 'Lançar',
      aoSalvar: async v => {
        if (v.como === 'nada') { CRM.toast('Saldo do banco gravado; a diferença de ' + R.moeda(valor) + ' não foi lançada.'); return; }
        const val = r2(v.valor);
        if (!(val > 0)) throw new Error('Informe o valor.');
        const baixa = { situacao: 'pago', pago_em: dia, baixa: 'fora', baixado_em: agora() };
        if (String(v.como).indexOf('conta:') === 0) {
          const l = lanc(v.como.slice(6));
          if (!l) throw new Error('Conta não encontrada.');
          await grava(l.id, Object.assign({ valor: val }, baixa));
          CRM.toast('"' + l.descricao + '" dada como paga em ' + R.dataBR(dia) + '.');
          return;
        }
        const PADRAO = { tarifa: ['Tarifas bancárias', 'Tarifas bancárias'], juros: ['Tarifas bancárias', 'Juros e IOF do banco'],
          rendimento: ['Outras entradas', 'Rendimento da conta'], estorno: ['Outras entradas', 'Estorno de tarifa do banco'] }[v.como];
        const categoria = PADRAO ? PADRAO[0] : String(v.categoria || '').trim() || (saida ? 'Outras saídas' : 'Outras entradas');
        const descricao = String(v.descricao || '').trim() || (PADRAO ? PADRAO[1] : saida ? 'Saída não lançada' : 'Entrada não lançada') + ' (conferência de ' + R.dataBR(dia).slice(0, 5) + ')';
        await insere(Object.assign({ tipo: saida ? 'saida' : 'entrada', descricao, categoria, valor: val, vencimento: dia, origem: 'tela',
          observacoes: 'Diferença na conferência com o banco em ' + R.dataBR(dia) + ': CRM ' + R.moeda(saldoCrm) + ', banco ' + R.moeda(saldoBanco) + '.' }, baixa));
        CRM.toast(R.moeda(val) + ' lançado em ' + categoria + ' (' + (saida ? 'pago' : 'recebido') + ' em ' + R.dataBR(dia) + ', sem mexer no saldo).' +
          (val < valor - 0.005 ? ' Faltam ' + R.moeda(valor - val) + ' da diferença.' : ''));
      }
    });
  }

  function formRecorrente(r) {
    CRM.abrirForm({
      titulo: r ? 'Editar conta recorrente' : 'Nova conta recorrente',
      intro: 'Modelo de conta que se repete todo mês no mesmo dia (aluguel, salário, parcela). "Gerar o mês" cria a conta de cada uma.',
      largura: 'largo',
      campos: [
        { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: [['saida', 'Saída'], ['entrada', 'Entrada']] },
        { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, largo: true, dica: 'ex.: Aluguel do galpão' },
        { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'numero', obrigatorio: true },
        { nome: 'dia', rotulo: 'Dia do mês', tipo: 'numero', passo: '1', min: 1, max: 31, obrigatorio: true },
        { nome: 'categoria', rotulo: 'Categoria', sugestoes: CATEGORIAS_SAIDA.concat(CATEGORIAS_ENTRADA) },
        { nome: 'fornecedor', rotulo: 'Fornecedor / de quem' },
        { nome: 'parcela_inicio', rotulo: 'Parcela no mês de início', tipo: 'numero', passo: '1', vazioNulo: true, ajuda: 'só para parcelamento' },
        { nome: 'parcelas', rotulo: 'Total de parcelas', tipo: 'numero', passo: '1', vazioNulo: true, ajuda: 'vazio = sem fim' },
        { nome: 'inicio', rotulo: 'A partir do mês', tipo: 'data', ajuda: 'qualquer dia do mês de início' },
        { nome: 'entre_empresas', rotulo: 'Entre empresas (OneClean ↔ Agilité)', tipo: 'checkbox' },
        { nome: 'ativo', rotulo: 'Ativa', tipo: 'checkbox' },
        { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', largo: true, linhas: 2 }
      ],
      valores: r || { tipo: 'saida', ativo: true, inicio: hoje().slice(0, 8) + '01' },
      aoSalvar: async v => {
        if (ENTRE_EMPRESAS.test(v.categoria || '')) v.entre_empresas = true;
        v.valor = r2(v.valor); v.dia = Math.round(v.dia);
        v.inicio = (v.inicio || hoje()).slice(0, 8) + '01';
        if (!(v.dia >= 1 && v.dia <= 31)) throw new Error('Dia do mês entre 1 e 31.');
        if (v.parcelas && !v.parcela_inicio) v.parcela_inicio = 1;
        const x = r ? await CRM.store().atualizar('fin_recorrentes', r.id, v) : await CRM.store().inserir('fin_recorrentes', v);
        troca(F.recorrentes, x); CRM.render();
      },
      aoExcluir: r ? async () => { await CRM.store().remover('fin_recorrentes', r.id); F.recorrentes = F.recorrentes.filter(x => x.id !== r.id); CRM.render(); } : null,
      textoExcluir: 'Excluir esta recorrente? As contas já geradas continuam.'
    });
  }

  // Contas a pagar do FKN pela tela (o vigia faz o mesmo sozinho, pela função crm-notas): lê, confere,
  // mostra o que vai mudar e aplica o plano de fkn.js (novas, já lançadas, antigas pausadas, pagas).
  // ---- frases ("pedágio 350 pago hoje"): frases.js lê e propõe; aqui o administrador confere e grava
  let rascunho = '';
  // documento colado, arrastado ou escolhido no 📎 (13/10/2026): { arquivo, nome, caminho (depois de enviado) }
  let anexo = null;
  const TIPOS_ANEXO = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;
  function poeAnexo(f) {
    if (!f) return;
    if (!TIPOS_ANEXO.test(f.type)) { CRM.toast('Só imagem (PNG, JPG) ou PDF.', true); return; }
    if (f.size > 10 * 1024 * 1024) { CRM.toast('Arquivo maior que 10 MB.', true); return; }
    anexo = { arquivo: f, nome: f.name || (f.type === 'application/pdf' ? 'documento.pdf' : 'imagem colada') };
    CRM.render();
  }
  // movimento lido do documento → a frase que o leitor entende. O CNPJ/CPF acha o nome do cliente no CRM
  // (o banco corta o nome: "SLIP QUIMIC"); números saem do nome e da descrição para o leitor não tomar por valor.
  function fraseDoMovimento(m) {
    const doc = R.chaveDoc(m.documento);
    const emp = doc && (E().D.empresas || []).find(e => R.chaveDoc(e.cnpj) === doc);
    const limpa = t => String(t || '').replace(/\d+/g, ' ').replace(/[^\p{L}\s&.'-]/gu, ' ').replace(/\s+/g, ' ').trim();
    const quem = limpa(emp ? emp.nome : m.quem);
    // "Pix recebido": "pix" é palavra de saída para o leitor; numa entrada não ajuda em nada
    const oQue = m.tipo === 'entrada' ? limpa(String(m.descricao || '').replace(/\bpix\b/gi, ' ')) : limpa(m.descricao);
    const valor = R.moeda(m.valor).replace(/^R\$\s*/, '');
    const dia = 'dia ' + m.data.slice(8, 10) + '/' + m.data.slice(5, 7);
    if (m.tipo === 'entrada') return (m.situacao === 'previsto' ? 'vai entrar ' : 'recebi ') + valor + (quem ? ' de ' + quem : oQue ? ' ' + oQue : '') + ' ' + dia;
    return (m.situacao === 'previsto' ? 'vai sair ' : 'paguei ') + valor + ' ' + [oQue, quem].filter(Boolean).join(' ') + ' ' + dia;
  }
  async function lerAnexo(nota) {
    const st = CRM.store();
    const botao = $('[data-acao="cx-frases"]');
    if (botao) botao.disabled = true;
    CRM.toast('Lendo o documento… (alguns segundos)');
    try {
      if (!anexo.caminho) anexo.caminho = await st.anexoEnviar(anexo.arquivo, hoje());
      const r = await st.anexoLer(anexo.caminho, nota, hoje());
      if (!r.movimentos || !r.movimentos.length) throw new Error('não achei nenhum movimento no documento' + (r.aviso ? ': ' + r.aviso : '.'));
      conferirFrases(r.movimentos.map(fraseDoMovimento).join('\n'), { anexo: anexo.caminho, nomeAnexo: anexo.nome, avisoAnexo: r.aviso });
    } finally { if (botao) botao.disabled = false; }
  }
  function contextoFrases() {
    const forn = new Map();
    F.lancamentos.concat(F.recorrentes).forEach(x => { const n = String(x.fornecedor || '').trim(); if (n && !forn.has(n.toLowerCase())) forn.set(n.toLowerCase(), { nome: n }); });
    return { hoje: hoje(), agora: agora(), lancamentos: F.lancamentos, titulos: titulos(), regras: F.regras || [], fornecedores: [...forn.values()],
      clientes: (E().D.empresas || []).map(e => ({ id: e.id, nome: e.nome })), nomeTitulo, creditoTitulo: t => creditoTitulo(t.vencimento, d1()) };
  }
  // O "+" da célula: a mesma caixa de frases, com o dia e a seção da célula.
  function formFrase(pre) {
    CRM.abrirForm({
      titulo: (pre.tipo === 'entrada' ? 'Entrada' : 'Saída') + ' em ' + R.dataBR(pre.data),
      intro: 'Escreva do jeito que fala, uma frase por linha. Sem dia na frase, vale ' + dm(pre.data) + '; sem "recebi" ou "paguei", vale ' + (pre.tipo === 'entrada' ? 'entrada' : 'saída') + '.',
      campos: [{ nome: 'texto', rotulo: 'O que aconteceu', tipo: 'textarea', largo: true, linhas: 3, obrigatorio: true, dica: pre.tipo === 'entrada' ? 'recebi 2.300 da Drogaria' : 'pedágio 350 pago, almoço 85' }],
      valores: {}, salvarTexto: 'Conferir',
      rodape: '<button type="button" class="btn sec" data-acao="cx-falar" data-id="form" title="Ditado (Chrome ou Edge)">🎤 Falar</button>' +
        '<button type="button" class="btn sec" data-acao="cx-add-form" data-id="' + esc(pre.tipo) + '" data-dia="' + esc(pre.data) + '">Formulário completo</button>',
      aoSalvar: async v => { conferirFrases(v.texto, { dataPadrao: pre.data, tipoPadrao: pre.tipo }); }
    });
  }
  function conferirFrases(texto, opts) {
    const P = raiz.CRMFrases;
    const r = P.interpretar(texto, hoje(), opts);
    if (!r.itens.length) throw new Error(r.avisos.join(' ') || 'escreva pelo menos uma frase com valor.');
    const ctx = contextoFrases();
    const ps = P.classificar(r.itens, ctx);
    const op = (lista, val) => lista.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
    const campo = (rot, html, cls) => '<label class="campo' + (cls ? ' ' + cls : '') + '"><span>' + esc(rot) + '</span>' + html + '</label>';
    const linha = (p, i) => '<fieldset class="cx-conf" data-i="' + i + '"><legend>' + esc(p.trecho) + (ps.length > 1 ? ' <small>linha ' + p.linha + '</small>' : '') + '</legend>' +
      (p.motivo ? '<p class="cx-conf-motivo">' + esc(p.motivo) + '</p>' : '') +
      '<div class="campos">' +
      campo('O que fazer', '<select name="a' + i + '">' + op(p.opcoes.map(o => [o.acao, o.rotulo]), p.acao) + '</select>', 'largo') +
      campo('Tipo', '<select name="t' + i + '">' + op([['saida', 'Saída'], ['entrada', 'Entrada']], p.tipo) + '</select>', 'cx-n') +
      campo('Valor (R$)', '<input type="number" name="v' + i + '" step="0.01" min="0.01" inputmode="decimal" value="' + esc(p.valor) + '">', 'cx-vd') +
      campo('Dia', '<input type="date" name="d' + i + '" value="' + esc(p.data) + '">', 'cx-vd') +
      campo('Situação', '<select name="s' + i + '">' + op([['realizado', p.tipo === 'entrada' ? 'Aconteceu (recebido)' : 'Aconteceu (pago)'], ['previsto', 'Previsto']], p.situacao) + '</select>', 'cx-n') +
      campo('Descrição', '<input type="text" name="x' + i + '" value="' + esc(p.descricao) + '" autocomplete="off">', 'largo cx-n') +
      campo('Categoria', '<input type="text" name="c' + i + '" value="' + esc(p.categoria) + '" list="cxCats" autocomplete="off">', 'cx-n') +
      campo(p.tipo === 'entrada' ? 'De quem' : 'Fornecedor', '<input type="text" name="f' + i + '" value="' + esc(p.fornecedor) + '" list="cxForn" autocomplete="off">', 'cx-n') +
      '<label class="campo check cx-n"><input type="checkbox" name="e' + i + '"' + (p.entre_empresas ? ' checked' : '') + '> Entre empresas (OneClean ↔ Agilité)</label>' +
      (p.transferencia ? campo(p.tipo === 'entrada' ? 'Devolve à Agilité em' : 'A Agilité devolve em', '<input type="date" name="tv' + i + '" value="' + esc(p.transferencia.volta || '') + '">', 'cx-n') +
        campo('o valor de (R$)', '<input type="number" name="tw' + i + '" step="0.01" min="0" inputmode="decimal" value="' + esc(p.transferencia.valor || '') + '" placeholder="o mesmo">', 'cx-n')
        : p.tipo === 'entrada' ? emprestimoHTML(p, i) : '') +
      (p.chave && p.podeLembrar ? '<label class="campo check largo cx-n" title="Grava uma regra: da próxima vez que aparecer &quot;' + esc(p.rotulo || p.chave) + '&quot;, o CRM já classifica igual a esta linha — categoria, fornecedor e entre empresas.">' +
        '<input type="checkbox" name="l' + i + '"> da próxima vez, classificar "' + esc(p.rotulo || p.chave) + '" igual</label>' : '') +
      '</div></fieldset>';
    // toda entrada: "se for empréstimo, devolve em … o valor de … — ou em n parcelas de …, a 1ª em …"
    function emprestimoHTML(p, i) {
      const e = p.emprestimo || {}, pc = e.parcelas || {};
      return '<label class="campo check largo cx-n"><input type="checkbox" name="m' + i + '"' + (p.emprestimo ? ' checked' : '') + '> É empréstimo recebido (não é receita)</label>' +
        campo('Se for empréstimo, devolve em', '<input type="date" name="md' + i + '" value="' + esc(e.em || '') + '">', 'cx-n cx-emp') +
        campo('o valor de (R$)', '<input type="number" name="mv' + i + '" step="0.01" min="0" inputmode="decimal" value="' + esc(e.devolve != null ? e.devolve : '') + '" placeholder="o mesmo">', 'cx-n cx-emp') +
        campo('— ou em quantas parcelas', '<input type="number" name="mn' + i + '" step="1" min="0" value="' + esc(pc.n || '') + '">', 'cx-n cx-emp') +
        campo('de (R$)', '<input type="number" name="mp' + i + '" step="0.01" min="0" inputmode="decimal" value="' + esc(pc.valor || '') + '">', 'cx-n cx-emp') +
        campo('a 1ª em', '<input type="date" name="m1' + i + '" value="' + esc(pc.primeira || '') + '">', 'cx-n cx-emp') +
        campo('todo dia', '<input type="number" name="mdia' + i + '" step="1" min="1" max="31" value="' + esc(pc.dia || '') + '">', 'cx-n cx-emp');
    }
    const listas = '<datalist id="cxCats">' + R.ordemAlfa(CATEGORIAS_SAIDA.concat(CATEGORIAS_ENTRADA).concat((F.regras || []).map(g => g.categoria)).filter((x, i, a) => x && a.indexOf(x) === i)).map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
      '<datalist id="cxForn">' + R.ordemAlfa(ctx.fornecedores, f => f.nome).slice(0, 500).map(f => '<option value="' + esc(f.nome) + '">').join('') + '</datalist>';
    CRM.abrirForm({
      titulo: 'Conferir antes de gravar',
      intro: (opts && opts.anexo ? 'Lido do documento "' + opts.nomeAnexo + '" (fica guardado no lançamento, 📎).' + (opts.avisoAnexo ? '\nAtenção: ' + opts.avisoAnexo : '') + '\n' : '') +
        ps.length + ' lançamento(s). Confira cada um: nada foi gravado ainda.' + (r.avisos.length ? '\n' + r.avisos.join('\n') : ''),
      largura: 'largo', campos: [], htmlDepois: ps.map(linha).join('') + listas, salvarTexto: 'Gravar',
      extras: form => {
        // baixa de conta ou título: os campos de lançamento novo não valem (só o dia e o valor)
        const mostra = fs => {
          const a = fs.querySelector('select[name^="a"]').value;
          fs.classList.toggle('cx-conf-baixa', /^(baixar|ajustar|titulo):/.test(a));
          fs.classList.toggle('cx-conf-ignora', a === 'ignorar');
          const m = fs.querySelector('input[name^="m"][type="checkbox"]'), t = fs.querySelector('select[name^="t"]');
          fs.classList.toggle('cx-sem-emp', !m || !m.checked || t.value !== 'entrada');
        };
        form.querySelectorAll('.cx-conf').forEach(fs => {
          mostra(fs);
          fs.querySelectorAll('select[name^="a"], select[name^="t"], input[name^="m"][type="checkbox"]').forEach(x => x.addEventListener('change', () => mostra(fs)));
        });
      },
      aoSalvar: async (v, form) => {
        const el = n => form.elements[n];
        const num = n => { const x = el(n); const v = x ? Number(String(x.value).replace(',', '.')) : NaN; return isFinite(v) && v > 0 ? r2(v) : null; };
        const lidas = ps.map((p, i) => {
          const q = Object.assign({}, p, {
            acao: el('a' + i).value, tipo: el('t' + i).value, valor: r2(String(el('v' + i).value).replace(',', '.')), data: el('d' + i).value || p.data,
            situacao: el('s' + i).value, descricao: el('x' + i).value.trim() || p.descricao, categoria: el('c' + i).value.trim(), fornecedor: el('f' + i).value.trim(),
            entre_empresas: el('e' + i).checked || ENTRE_EMPRESAS.test(el('c' + i).value), lembrar: !!(el('l' + i) && el('l' + i).checked)
          });
          // transferência entre empresas: a volta que está na tela (vazia = sem volta prevista)
          q.transferencia = p.transferencia && q.categoria === p.categoria ? { volta: (el('tv' + i) && el('tv' + i).value) || null, valor: num('tw' + i) || q.valor } : null;
          // empréstimo: o que está na tela vale (a pessoa pode corrigir valor, data e parcelas)
          q.emprestimo = null;
          if (q.tipo === 'entrada' && el('m' + i) && el('m' + i).checked) {
            const n = num('mn' + i), pv = num('mp' + i), primeira = el('m1' + i).value;
            if (n && !pv) throw new Error('"' + p.trecho + '": informe o valor da parcela do empréstimo.');
            if (n && pv && !primeira) throw new Error('"' + p.trecho + '": informe o dia da 1ª parcela do empréstimo.');
            q.emprestimo = { credor: q.fornecedor || q.descricao, devolve: num('mv' + i), em: el('md' + i).value || null,
              parcelas: n && pv ? { n: Math.round(n), valor: pv, primeira, dia: Math.round(num('mdia' + i) || +primeira.slice(8, 10)) } : null };
            q.acao = 'novo';
            if (!q.categoria || q.categoria === p.categoria) q.categoria = 'Empréstimos recebidos';
          }
          return q;
        });
        lidas.forEach(p => {
          if (p.acao === 'ignorar') return;
          if (!(p.valor > 0)) throw new Error('"' + p.trecho + '": informe o valor.');
          if (p.situacao === 'realizado' && p.data > hoje()) throw new Error('"' + p.trecho + '": o que já aconteceu não pode ter dia no futuro.');
          if (/^(baixar|titulo):/.test(p.acao) && p.situacao !== 'realizado') throw new Error('"' + p.trecho + '": baixa é do que já aconteceu — troque a situação ou escolha "Lançar novo".');
        });
        const planos = lidas.map(p => P.gravacao(p, ctx));
        // o documento lido fica no que foi lançado ou baixado
        if (opts && opts.anexo) planos.forEach(g => {
          g.inserir.forEach(x => { x.anexos = [opts.anexo]; });
          g.atualizar.forEach(a => { const l = lanc(a.id); a.patch.anexos = [...new Set(((l && l.anexos) || []).concat(opts.anexo))]; });
        });
        let n = 0;
        for (let i = 0; i < lidas.length; i++) {
          const g = planos[i];
          for (const r of g.recorrentes || []) troca(F.recorrentes, await CRM.store().inserir('fin_recorrentes', r));
          for (const a of g.atualizar) { troca(F.lancamentos, await CRM.store().atualizar('fin_lancamentos', a.id, a.patch)); n++; }
          if (g.inserir.length) { (await CRM.store().inserirVarios('fin_lancamentos', g.inserir)).forEach(x => troca(F.lancamentos, x)); n += g.inserir.length; }
          const p = lidas[i];
          if (p.lembrar && p.chave && p.acao === 'novo') {
            const dados = { tipo: p.tipo, chave: p.chave, categoria: p.categoria || null, fornecedor: p.fornecedor || null, entre_empresas: !!p.entre_empresas };
            const ja = (F.regras || []).find(g => g.tipo === p.tipo && g.chave === p.chave);
            F.regras = F.regras || [];
            troca(F.regras, ja ? await CRM.store().atualizar('fin_regras', ja.id, dados) : await CRM.store().inserir('fin_regras', dados));
          }
        }
        if (!opts || !opts.dataPadrao) rascunho = '';
        if (opts && opts.anexo) anexo = null;
        CRM.render();
        CRM.toast(n ? n + ' lançamento(s) gravado(s). Errou? Clique no item → "Desfazer a frase".' : 'Nada gravado.');
      }
    });
  }

  async function importarPagar(f) {
    const K = raiz.CRMFkn;
    const buf = await f.arrayBuffer();
    let t;
    try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { t = new TextDecoder('windows-1252').decode(buf); }
    const lido = K.lerContasPagar(t);
    const conf = K.conferirContasPagar(t, lido);
    if (conf.recusa.length) throw new Error('relatório recusado (nada foi trocado): ' + conf.recusa.join('; '));
    const doFkn = F.lancamentos.filter(x => x.chave_fkn && x.situacao !== 'pago').length;
    if (doFkn >= 20 && lido.contas.length < doFkn * 0.4) throw new Error('veio com ' + lido.contas.length + ' contas e o CRM tem ' + doFkn + ' do FKN em aberto: confira Conta 0 a 0, Situação GERAL e a filial');
    const p = K.planoContasPagar(lido, F.lancamentos, { hoje: lido.posicao || hoje(), agora: agora(), excluidos: chavesExcluidas() });
    CRM.abrirForm({
      titulo: 'Contas a pagar do FKN',
      intro: 'Relatório de ' + R.dataBR(lido.posicao) + (lido.hora ? ' ' + lido.hora : '') + ': ' + lido.contas.length + ' contas, ' + R.moeda(lido.soma) + ' (bate com o total geral).\n' +
        '• ' + p.novas.qtd + ' novas no caixa: ' + R.moeda(p.novas.valor) + '\n' +
        (p.antigas.qtd ? '• ' + p.antigas.qtd + ' pendências antigas (vencidas há mais de 60 dias ou emitidas há mais de 1 ano): ' + R.moeda(p.antigas.valor) + ' → entram em "Contas pausadas" para conferir\n' : '') +
        (p.ligar.length ? '• ' + p.ligar.length + ' já estavam lançadas (recorrente/planilha): só ligadas ao FKN — ' + p.ligar.map(x => x.descricao).join(', ') + '\n' : '') +
        (p.atualizar.length ? '• ' + p.atualizar.length + ' com valor ou vencimento novo\n' : '') +
        (p.baixar.length ? '• ' + p.baixar.length + ' sumiram do FKN: dadas como pagas (fora do caixa)\n' : '') +
        (p.excluidas ? '• ' + p.excluidas + ' excluída(s) por você no Caixa: ficam de fora\n' : ''),
      campos: [], salvarTexto: 'Aplicar',
      aoSalvar: async () => {
        if (p.inserir.length) await CRM.store().inserirVarios('fin_lancamentos', p.inserir);
        for (const a of [...p.atualizar, ...p.ligar, ...p.baixar]) await CRM.store().atualizar('fin_lancamentos', a.id, a.patch);
        lidoEm = 0; await carrega();
        CRM.toast('Contas a pagar do FKN aplicado: ' + p.inserir.length + ' novas, ' + p.baixar.length + ' pagas.');
      }
    });
  }

  async function gerar(compet) {
    const novas = gerarMes(F.recorrentes, compet, F.lancamentos);
    if (!novas.length) { CRM.toast('Nada a gerar em ' + R.mesCurto(compet + '-01') + ': as contas desse mês já existem.'); return; }
    const r = await CRM.store().inserirVarios('fin_lancamentos', novas);
    r.forEach(x => troca(F.lancamentos, x));
    CRM.toast(r.length + ' conta(s) de ' + R.mesCurto(compet + '-01') + ' gerada(s).');
    CRM.render();
  }

  // ---- telas
  const selo = (t, c) => CRM.selo(t, c);
  function seloSituacao(l, h) {
    if (l.situacao === 'pausado') return selo('pausada', 'cinza');
    if (l.situacao === 'pago') return selo(l.tipo === 'entrada' ? 'recebida' : 'paga', 'verde');
    if (l.titulo_duplicata) return selo('no título ' + l.titulo_duplicata, 'azul');
    return posterga(l.vencimento) < h ? selo('vencida', 'vermelho') : selo('em aberto', 'azul');
  }
  function cartao(x, dia) {
    const ok = x.estado === 'previsto' ? '<button type="button" class="cx-ok" data-acao="cx-ok" data-id="' + esc(x.chave) + '" data-dia="' + esc(dia) + '" title="' +
      (x.secao === 'entrada' ? 'Recebi' : 'Paguei') + ' ' + (dia <= hoje() ? (dia === hoje() ? 'hoje' : 'em ' + dm(dia)) : 'hoje') + '">✓</button>' : '';
    // conta prevista e título (arrastar o título = remarcar: o cliente vai pagar em outro dia)
    const arrasta = x.estado === 'previsto' ? ' draggable="true" data-mover="' + esc(x.tipo === 'lanc' ? x.ref.id : 'tit:' + x.ref.duplicata) + '"' : '';
    const k = x.chave + '|' + dia;
    return '<div class="cx-it ' + (x.secao === 'entrada' ? 'cx-ent' : 'cx-sai') + ' ' + x.estado + (naGrade.has(k) ? ' cx-sel' : '') + (x.atrasado ? ' atrasado' : '') + (x.adiantado ? ' adiantado' : '') + (x.emprestimo ? ' emprestimo' : '') + (ok ? ' comok' : '') + '"' + arrasta + '>' + ok +
      '<button type="button" class="cx-corpo" data-acao="cx-item" data-id="' + esc(x.chave) + '" data-dia="' + esc(dia) + '" data-k="' + esc(k) + '" data-valor="' + Number(x.valor || 0) + '" data-secao="' + esc(x.secao) + '" title="' + esc(x.titulo + (x.obs ? ' — ' + x.obs : '') + ' (Ctrl+clique soma)') + '">' +
      '<span class="t">' + (x.adiantado ? '<span class="cx-adi">⏩ adiantado</span> ' : '') + (x.emprestimo ? '<span class="cx-etq-emp">🔁 ' + (x.ref && x.ref.categoria === 'Transferência entre empresas' ? 'entre empresas' : x.secao === 'entrada' ? 'empréstimo' : 'devolução') + '</span> ' : '') + (x.ref && x.ref.anexos && x.ref.anexos.length ? '📎 ' : '') + esc(x.titulo) + '</span>' + (x.obs ? '<span class="o">' + esc(x.obs) + '</span>' : '') + '<span class="v">' + esc(R.moeda(x.valor)) + '</span></button></div>';
  }
  function grade(s) {
    const h = hoje();
    const de = inicio || R.somaDias(h, -1);
    const dias = Array.from({ length: 15 }, (_, i) => R.somaDias(de, i));
    const ate = dias[dias.length - 1];
    const opc = { d1: d1(), nome: nomeTitulo };
    const itens = itensGrade(de, ate, h, F.lancamentos, titulosCaixa(), opc);
    const previstos = ate >= h ? itensGrade(h, ate, h, F.lancamentos, titulosCaixa(), opc) : [];
    const saldos = saldosGrade(dias, h, s, F.lancamentos, previstos);
    const naoUtil = d => { const f = feriado(d), w = semana(d); return f ? { cls: 'fer', rot: 'Feriado', nome: f.nome } : w === 6 ? { cls: 'fds', rot: 'Sábado' } : w === 0 ? { cls: 'fds', rot: 'Domingo' } : null; };
    const th = dias.map(d => { const n = naoUtil(d); return '<th class="' + (d === h ? 'hoje' : '') + (n ? ' ' + n.cls : '') + '">' + DIAS[semana(d)].slice(0, 3) + ' <strong>' + dm(d) + '</strong>' +
      (d === h ? ' <span class="cx-hoje">hoje</span>' : '') + (n ? '<span class="cx-naoutil">' + n.rot + '</span>' : '') + (n && n.nome ? '<span class="cx-feriado">' + esc(n.nome) + '</span>' : '') + '</th>'; }).join('');
    const MAX = 5;
    const celulas = secao => dias.map(d => {
      const doDia = itens.filter(x => x.data === d && x.secao === secao).sort((a, b) => (a.estado === 'previsto' ? 1 : 0) - (b.estado === 'previsto' ? 1 : 0) || b.valor - a.valor);
      const n = naoUtil(d);
      const cards = doDia.length > MAX
        ? doDia.slice(0, MAX - 1).map(x => cartao(x, d)).join('') + '<details class="cx-mais" data-chave="mais-' + secao + '-' + d + '"><summary>+ ' + (doDia.length - MAX + 1) + ' ' + (secao === 'entrada' ? 'entradas' : 'saídas') + ' · ' +
          esc(R.moeda(doDia.slice(MAX - 1).reduce((t, x) => t + x.valor, 0))) + '</summary>' + doDia.slice(MAX - 1).map(x => cartao(x, d)).join('') + '</details>'
        : doDia.map(x => cartao(x, d)).join('');
      return '<td data-dia="' + d + '" class="' + (d === h ? 'hoje' : '') + (n ? ' ' + n.cls : '') + '">' + cards +
        '<button type="button" class="cx-add" data-acao="cx-add" data-id="' + secao + '" data-dia="' + d + '" title="Lançar ' + (secao === 'entrada' ? 'entrada' : 'saída') + ' em ' + dm(d) + '">+</button></td>';
    }).join('');
    const total = secao => dias.map(d => { const v = itens.filter(x => x.data === d && x.secao === secao && x.estado !== 'fora').reduce((t, x) => t + x.valor, 0); return '<td class="num">' + (v ? esc(R.moeda(v)) : '') + '</td>'; }).join('');
    const saldoRow = dias.map(d => '<td class="num' + (saldos[d] != null && saldos[d] < 0 ? ' cx-neg' : '') + '"><strong>' + (saldos[d] == null ? '—' : esc(R.moeda(saldos[d]))) + '</strong></td>').join('');
    return '<section class="cartao cx-grade-cartao"><h2>Fluxo de caixa <small>' + esc(R.dataBR(de)) + ' a ' + esc(R.dataBR(ate)) + '</small><span class="flex"></span>' +
      '<button type="button" class="mini" data-acao="cx-nav" data-id="-15">◀ 15 dias</button><button type="button" class="mini" data-acao="cx-nav" data-id="0">Hoje</button>' +
      '<button type="button" class="mini" data-acao="cx-nav" data-id="15">15 dias ▶</button>' +
      '<button type="button" class="mini' + (modoSoma ? ' ativo' : '') + '" data-acao="cx-modo-soma" title="liga/desliga: clicar nos itens soma (também dá com Ctrl+clique)">🧮 Somar</button></h2>' +
      barraGrade() +
      '<p class="cx-legenda"><span class="cx-it cx-ent feito"><span class="cx-corpo">aconteceu</span></span><span class="cx-it cx-sai previsto"><span class="cx-corpo">previsto</span></span>' +
      '<span class="cx-it cx-sai fora"><span class="cx-corpo">pago fora do caixa</span></span>' +
      '<span class="cx-it cx-ent previsto atrasado"><span class="cx-corpo">em atraso, remarcado</span></span>' +
      '<span class="cx-it cx-ent previsto adiantado"><span class="cx-corpo">⏩ o cliente adiantou</span></span>' +
      '<span class="cx-it cx-ent previsto emprestimo"><span class="cx-corpo">🔁 empréstimo (entra e volta)</span></span>' +
      '<span class="cx-it cx-ent feito emprestimo"><span class="cx-corpo">🔁 empréstimo já pago</span></span>' +
      '<small>✓ paga ou recebe no dia da coluna · clique no item para ajustar valor e dia, pausar ou desfazer · arraste uma conta ou um título para outro dia · + lança no dia · Ctrl+clique (ou 🧮 Somar) soma os itens</small></p>' +
      '<div class="cx-grade-rolagem"><table class="cx-grade"><thead><tr><th class="lab"></th>' + th + '</tr></thead><tbody>' +
        '<tr class="sec"><th class="lab ent">Entradas</th>' + celulas('entrada') + '</tr>' +
        '<tr class="tot"><th class="lab">Total entradas</th>' + total('entrada') + '</tr>' +
        '<tr class="sec"><th class="lab sai">Saídas</th>' + celulas('saida') + '</tr>' +
        '<tr class="tot"><th class="lab">Total saídas</th>' + total('saida') + '</tr>' +
        '<tr class="saldo"><th class="lab">Saldo no fim do dia</th>' + saldoRow + '</tr>' +
      '</tbody></table></div></section>';
  }
  function caixaFrases() {
    return '<section class="cartao cx-frases"><label for="cxFrases"><strong>Escreva o que aconteceu</strong> <small>uma frase por linha — o CRM acha a conta ou o título que bate, a categoria e o fornecedor; nada é gravado antes de você conferir</small></label>' +
      '<div class="cx-frases-linha"><textarea id="cxFrases" rows="2" placeholder="pedágio 350 pago hoje · recebi 2.300 da Drogaria ontem · aluguel galpão 4.500 dia 10">' + esc(rascunho) + '</textarea>' +
      '<span class="cx-frases-botoes"><button type="button" class="btn sec" data-acao="cx-falar" data-id="caixa" title="Ditado (Chrome ou Edge): fale e confira o texto antes de Conferir">🎤 Falar</button>' +
      '<button type="button" class="btn sec" data-acao="cx-anexar" title="Print do banco, comprovante, boleto ou PDF — ou cole (Ctrl+V) / arraste aqui">📎 Anexar</button>' +
      '<input type="file" id="cxAnexoArq" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" hidden>' +
      '<button type="button" class="btn" data-acao="cx-frases">Conferir</button></span></div>' +
      (anexo ? '<p class="cx-anexo">📎 <strong>' + esc(anexo.nome) + '</strong> <small>— o CRM lê o documento ao Conferir; o que você escrever acima vale como explicação (ex.: "entrou hoje")</small> ' +
        '<button type="button" class="mini" data-acao="cx-anexo-tirar">tirar</button></p>'
        : '<p class="cx-anexo-dica"><small>Também dá para colar (Ctrl+V) ou arrastar aqui o print do banco, o comprovante ou o PDF.</small></p>') + '</section>';
  }
  function blocosVencidos() {
    const h = hoje();
    const v = vencidas(F.lancamentos, h, titulos(), nomeTitulo);
    // corte do Anderson (06/10/2026: "deixe somente os que venceram hoje, pra seguirmos certo daqui pra
    // frente"): título vencido antes da data fica fora do bloco — continua no contas a receber e na cobrança
    const desde = (E().cfg || {}).caixa_receber_desde || '';
    const rvTodos = receberVencido(titulosCaixa(), F.lancamentos, h, d1());
    const rv = desde ? rvTodos.filter(t => t.vencimento >= desde) : rvTodos;
    const antigos = rvTodos.length - rv.length;
    const tot = l => l.reduce((t, x) => t + Number(x.valor || 0), 0);
    const b = (acao, id, rot, cls, dica) => '<button type="button" class="mini' + (cls ? ' ' + cls : '') + '" data-acao="' + acao + '" data-id="' + esc(id) + '"' + (dica ? ' title="' + esc(dica) + '"' : '') + '>' + esc(rot) + '</button>';
    const bx = baixados();
    const recebidosJa = new Set(F.lancamentos.filter(l => l.titulo_duplicata && l.situacao === 'pago').map(l => l.titulo_duplicata));
    const cart = titulos().filter(t => t.cartorio_em && !recebidosJa.has(t.duplicata)).sort((a, b) => a.cartorio_em.localeCompare(b.cartorio_em));
    return (bx.length ? '<details class="cartao cx-venc cx-baixados" data-chave="baixados-fkn" open><summary><strong>Baixados no FKN, sem entrada no caixa: ' + bx.length + ' (' + esc(R.moeda(tot(bx))) + ')</strong> <small>saíram do contas a receber do FKN sem "Recebi" aqui — fora do saldo até você dizer. Entrou no banco? "Entrou". Abatimento, devolução ou cancelamento? "Não entrou".</small></summary>' +
      '<div class="tabela-rolagem"><table class="tabela"><tbody>' + bx.map(x => '<tr><td>' + esc(nomeTitulo(x)) + '<small>duplicata ' + esc(x.duplicata) + (x.vencimento ? ' · venceu ' + esc(R.dataBR(x.vencimento)) : '') + '</small></td><td>baixado no FKN ' + esc(dm(String(x.sumiu_em || '').slice(0, 10))) + '</td>' +
        '<td class="num">' + esc(R.moeda(x.valor)) + '</td><td class="acoes-linha">' + b('cx-bx-entrou', x.id, 'Entrou…') + b('cx-bx-nao', x.id, 'Não entrou') + '</td></tr>').join('') + '</tbody></table></div></details>' : '') +
      (v.length ? '<details class="cartao cx-venc"><summary><strong>Contas vencidas sem baixa: ' + v.length + ' (' + esc(R.moeda(tot(v))) + ')</strong> <small>fora do saldo da grade. Pagou no vencimento e não deu baixa? "Paguei em …" (desconta do saldo). Já descontada no saldo do banco que você informou? "Já estava paga" (não mexe no saldo). Vai negociar? "Pausar".</small></summary>' +
      '<div class="tabela-rolagem"><table class="tabela"><tbody>' + v.map(l => '<tr><td>' + esc(l.descricao) + (l.categoria ? '<small>' + esc(l.categoria) + '</small>' : '') + '</td><td>' + esc(R.dataBR(l.vencimento)) + '</td>' +
        '<td class="num">' + esc(R.moeda(l.valor)) + '</td><td class="acoes-linha">' + b('cx-pagar', l.id, (l.tipo === 'entrada' ? 'Recebi' : 'Paguei') + ' hoje', '', 'baixa com a data de hoje e ' + (l.tipo === 'entrada' ? 'soma no' : 'desconta do') + ' saldo') +
          b('cx-nodia', l.id, (l.tipo === 'entrada' ? 'Recebi' : 'Paguei') + ' em ' + dm(l.vencimento), '', 'aconteceu no vencimento, só faltou a baixa: entra no caixa de ' + dm(l.vencimento) + ' e ' + (l.tipo === 'entrada' ? 'soma no' : 'desconta do') + ' saldo') +
          b('cx-japaga', l.id, 'Já estava paga', '', 'o saldo do banco que você informou já desconta: fica paga sem mexer no saldo') + b('cx-pausar', l.id, 'Pausar') + '</td></tr>').join('') +
      '</tbody></table></div></details>' : '') +
      (rv.length ? '<details class="cartao cx-venc"><summary><strong>A receber vencido: ' + rv.length + ' título(s) (' + esc(R.moeda(tot(rv))) + ')</strong> <small>já deviam ter caído na conta; fora da previsão até entrarem. Caiu? "Recebi hoje".</small></summary>' +
      '<div class="tabela-rolagem"><table class="tabela"><tbody>' + rv.map(t => '<tr><td>' + esc(nomeTitulo(t)) + '<small>duplicata ' + esc(t.duplicata) + '</small></td><td>vence ' + esc(R.dataBR(t.vencimento)) + '</td>' +
        '<td class="num">' + esc(R.moeda(t.valor)) + '</td><td class="acoes-linha">' + b('cx-ok', 'tit:' + t.duplicata, 'Recebi hoje') + b('cx-item', 'tit:' + t.duplicata, 'Remarcar ou valor') +
          (t.empresa_id ? b('cob-cartorio', t.duplicata, 'Cartório', '', 'mandar este título (e outros vencidos do cliente) para o cartório: sai da previsão') : '') + '</td></tr>').join('') + '</tbody></table></div></details>' : '') +
      (cart.length ? '<details class="cartao cx-venc cx-cartorio" data-chave="cartorio"><summary><strong>Em cartório: ' + cart.length + ' título(s) (' + esc(R.moeda(tot(cart))) + ')</strong> <small>fora da previsão até o cliente pagar. Pagou? "Recebi…" com o valor que entrou (com as custas). Voltou a negociar? "Tirar do cartório".</small></summary>' +
      '<div class="tabela-rolagem"><table class="tabela"><tbody>' + cart.map(t => '<tr><td>' + esc(nomeTitulo(t)) + '<small>duplicata ' + esc(t.duplicata) + ' · venceu ' + esc(R.dataBR(t.vencimento)) + (t.cartorio_obs ? ' · ' + esc(t.cartorio_obs) : '') + '</small></td>' +
        '<td>cartório desde ' + esc(R.dataBR(t.cartorio_em)) + '</td><td class="num">' + esc(R.moeda(t.valor)) + '</td><td class="acoes-linha">' + b('cx-item', 'tit:' + t.duplicata, 'Recebi…') + b('cob-tirar-cartorio', t.duplicata, 'Tirar do cartório') + '</td></tr>').join('') +
      '</tbody></table></div></details>' : '') +
      (antigos ? '<p class="cx-antigos">' + antigos + ' título(s) vencido(s) antes de ' + esc(R.dataBR(desde)) + ' (' + esc(R.moeda(tot(rvTodos.filter(t => t.vencimento < desde)))) +
        ') ficam fora do Caixa — continuam no contas a receber e na cobrança. Configurações → Geral.</p>' : '');
  }
  // Somar as contas marcadas, como selecionar células no Excel (14/10/2026, pedido do Anderson: os salários
  // são pagos pela conta da Agilité e ele precisa do total para transferir). Shift+clique marca um intervalo.
  const marcados = new Set();
  let ultimoMarcado = null, ordemLista = [];
  const somaMarcadas = () => resumoSoma(F.lancamentos.filter(x => marcados.has(x.id)));
  const resumoSoma = l => {
    const saidas = l.filter(x => x.tipo !== 'entrada').reduce((t, x) => t + Number(x.valor || 0), 0);
    const entradas = l.filter(x => x.tipo === 'entrada').reduce((t, x) => t + Number(x.valor || 0), 0);
    return { n: l.length, saidas, entradas, total: entradas - saidas, so: !entradas ? Math.abs(saidas) : !saidas ? entradas : null };
  };
  // qual: 'lista' (Contas a pagar) ou 'grade' (fluxo de caixa)
  function barraDe(m, qual, vazio, extra) {
    const id = qual === 'grade' ? 'cxSomaGrade' : 'cxSoma';
    if (!m.n) return vazio ? '<div class="cx-soma vazio" id="' + id + '">' + vazio + (extra || '') + '</div>' : '<div id="' + id + '" hidden></div>';
    const valor = m.so != null ? m.so : m.total;
    return '<div class="cx-soma" id="' + id + '"><span><strong>' + m.n + '</strong> marcado(s)</span>' +
      (m.saidas && m.entradas ? '<span>saídas −' + esc(R.moeda(m.saidas)) + '</span><span>entradas +' + esc(R.moeda(m.entradas)) + '</span>' : '') +
      '<span class="cx-soma-total">' + (m.so != null ? (m.entradas ? 'Total a receber' : 'Total a pagar') : 'Saldo') + ' <strong>' + esc(R.moeda(valor)) + '</strong></span>' +
      '<button type="button" class="mini" data-acao="cx-soma-copiar" data-id="' + Number(valor).toFixed(2) + '">Copiar valor</button>' +
      '<button type="button" class="mini" data-acao="cx-soma-limpar" data-id="' + qual + '">Limpar</button>' + (extra || '') + '</div>';
  }
  const barraSoma = () => barraDe(somaMarcadas(), 'lista', 'Marque as contas na caixinha à esquerda para somar (Shift+clique marca várias de uma vez).');
  // Fluxo de caixa (14/10, Anderson: "no fluxo de caixa eu conseguiria?"): Ctrl+clique num item marca para somar;
  // o botão "🧮 Somar" liga o modo em que o clique simples marca (em vez de abrir o item).
  const naGrade = new Map(); // chave|dia → { valor, tipo }
  let modoSoma = false;
  const barraGrade = () => barraDe(resumoSoma([...naGrade.values()]), 'grade', modoSoma ? 'Modo somar ligado: clique nos itens da grade para somar.' : '',
    modoSoma ? '<button type="button" class="mini" data-acao="cx-modo-soma">Sair do modo somar</button>' : '');
  function atualizaSomaGrade() {
    if (typeof document === 'undefined') return;
    const b = document.getElementById('cxSomaGrade');
    if (b) b.outerHTML = barraGrade();
    document.querySelectorAll('.cx-grade [data-k]').forEach(c => { const it = c.closest('.cx-it'); if (it) it.classList.toggle('cx-sel', naGrade.has(c.dataset.k)); });
  }
  function atualizaSoma() {
    const b = typeof document !== 'undefined' && document.getElementById('cxSoma');
    if (b) b.outerHTML = barraSoma();
    if (typeof document !== 'undefined') document.querySelectorAll('[data-acao="cx-marca"]').forEach(c => { c.checked = marcados.has(c.dataset.id); const tr = c.closest('tr'); if (tr) tr.classList.toggle('cx-marcada', c.checked); });
  }
  function listaContas() {
    const h = hoje();
    const busca = R.normaliza(filtro.busca || '');
    let l = F.lancamentos.filter(x => x.origem !== 'titulo');
    if (filtro.tipo) l = l.filter(x => x.tipo === filtro.tipo);
    if (filtro.situacao === 'abertas') l = l.filter(x => x.situacao === 'aberto');
    else if (filtro.situacao === 'vencidas') l = l.filter(x => x.situacao === 'aberto' && posterga(x.vencimento) < h);
    else if (filtro.situacao === 'pagas') l = l.filter(x => x.situacao === 'pago');
    else if (filtro.situacao === 'pausadas') l = l.filter(x => x.situacao === 'pausado');
    if (busca) l = l.filter(x => R.normaliza([x.descricao, x.fornecedor, x.categoria].join(' ')).indexOf(busca) !== -1);
    l.sort((a, b) => (filtro.situacao === 'pagas' ? String(b.pago_em).localeCompare(String(a.pago_em)) : a.vencimento.localeCompare(b.vencimento)) || b.valor - a.valor);
    const tot = l.reduce((t, x) => t + (x.tipo === 'entrada' ? 1 : -1) * Number(x.valor || 0), 0);
    ordemLista = l.map(x => x.id);
    const todos = l.length && l.every(x => marcados.has(x.id));
    const sel = (nome, ops, val) => '<select data-cx-filtro="' + nome + '">' + ops.map(o => '<option value="' + o[0] + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    return '<section class="cartao"><div class="filtros-compras">' +
      '<input type="search" data-cx-filtro="busca" placeholder="Buscar descrição, fornecedor, categoria" value="' + esc(filtro.busca) + '">' +
      sel('situacao', [['abertas', 'Em aberto'], ['vencidas', 'Vencidas'], ['pagas', 'Pagas'], ['pausadas', 'Pausadas'], ['todas', 'Todas']], filtro.situacao) +
      sel('tipo', [['', 'Saídas e entradas'], ['saida', 'Só saídas'], ['entrada', 'Só entradas']], filtro.tipo) +
      '<button type="button" class="btn" data-acao="cx-nova" data-id="saida">+ Conta a pagar</button><button type="button" class="btn sec" data-acao="cx-nova" data-id="entrada">+ Entrada</button>' +
      '<label class="btn sec arquivo" title="No FKN: Contas à Pagar por Conta/Fornecedor (Sifn083), Em aberto, salvar em CSV. O vigia também manda sozinho.">Atualizar do FKN<input type="file" id="cxPagarFkn" accept=".csv,.txt,text/csv"></label></div>' +
      (l.length ? barraSoma() + '<div class="tabela-rolagem"><table class="tabela cx-contas"><thead><tr><th class="cx-marca" data-acao="cx-marca-todas-celula"><input type="checkbox" data-acao="cx-marca-todas" title="marcar todas as da lista"' + (todos ? ' checked' : '') + '></th><th>' + (filtro.situacao === 'pagas' ? 'Pago em' : 'Vencimento') + '</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>' +
        l.map(x => '<tr class="clicavel' + (marcados.has(x.id) ? ' cx-marcada' : '') + '" data-acao="cx-editar" data-id="' + esc(x.id) + '" tabindex="0"><td class="cx-marca" data-acao="cx-marca-celula" data-id="' + esc(x.id) + '" title="marcar para somar"><input type="checkbox" data-acao="cx-marca" data-id="' + esc(x.id) + '"' + (marcados.has(x.id) ? ' checked' : '') + ' aria-label="marcar para somar"></td><td>' + esc(R.dataBR(filtro.situacao === 'pagas' ? x.pago_em : x.vencimento)) + '</td>' +
          '<td><strong>' + esc(x.descricao) + '</strong>' + (x.fornecedor || x.entre_empresas || x.origem !== 'tela' ? '<small>' + esc([x.fornecedor, x.entre_empresas ? 'entre empresas' : '', x.origem === 'recorrente' ? 'recorrente' : x.origem === 'fkn' ? 'do FKN' : x.origem === 'planilha' ? 'da planilha' : '', x.titulo_duplicata ? (x.situacao === 'pago' ? 'recebida pelo título ' : 'ligada ao título ') + x.titulo_duplicata : '', x.emprestimo ? 'empréstimo recebido (não é receita)' : '', x.espelho_ref ? 'veio do Caixa da Agilité' : x.espelho_par ? 'espelhado no Caixa da Agilité' : '',
            Number(x.juros) > 0 ? 'juros ' + R.moeda(x.juros) : ''].filter(Boolean).join(' · ')) + '</small>' : '') + '</td>' +
          '<td>' + esc(x.categoria || '') + '</td><td class="num ' + (x.tipo === 'entrada' ? 'cx-pos' : 'cx-neg') + '">' + (x.tipo === 'entrada' ? '+' : '−') + esc(R.moeda(x.valor)) + '</td><td>' + seloSituacao(x, h) + '</td>' +
          '<td class="acoes-linha">' + (x.situacao === 'aberto' ? '<button type="button" class="mini" data-acao="cx-pagar" data-id="' + esc(x.id) + '">' + (x.tipo === 'entrada' ? 'Recebi' : 'Paguei') + ' hoje</button>' : x.situacao === 'pausado' ? '<button type="button" class="mini" data-acao="cx-voltar" data-id="' + esc(x.id) + '">Voltar para o caixa</button>' +
            '<button type="button" class="mini perigo" data-acao="cx-excluir" data-id="' + esc(x.id) + '">Excluir</button>' : '') + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="4">' + l.length + ' lançamento(s)</td><td class="num"><strong>' + esc(R.moeda(tot)) + '</strong></td><td colspan="2"></td></tr></tfoot></table></div>'
        : '<p class="vazio">Nada aqui.</p>') + '</section>';
  }
  function listaRecorrentes() {
    const h = hoje(), compet = h.slice(0, 7), prox = R.somaMeses(compet + '-01', 1).slice(0, 7);
    const l = F.recorrentes.slice().sort((a, b) => (b.ativo !== false) - (a.ativo !== false) || a.dia - b.dia || a.descricao.localeCompare(b.descricao, 'pt-BR'));
    const faltam = c => gerarMes(F.recorrentes, c, F.lancamentos).length;
    const totMes = l.filter(r => r.ativo !== false).reduce((t, r) => t + (r.tipo === 'entrada' ? 1 : -1) * Number(r.valor || 0), 0);
    const parcelaDe = r => r.parcelas ? ((r.parcela_inicio || 1) + (+compet.slice(0, 4) - +String(r.inicio).slice(0, 4)) * 12 + (+compet.slice(5, 7) - +String(r.inicio).slice(5, 7))) + ' de ' + r.parcelas : '';
    return '<section class="cartao"><div class="filtros-compras"><button type="button" class="btn" data-acao="cx-rec-nova">+ Conta recorrente</button>' +
      '<button type="button" class="btn sec" data-acao="cx-gerar" data-id="' + compet + '">Gerar ' + esc(R.mesCurto(compet + '-01')) + (faltam(compet) ? ' (' + faltam(compet) + ')' : ' ✓') + '</button>' +
      '<button type="button" class="btn sec" data-acao="cx-gerar" data-id="' + prox + '">Gerar ' + esc(R.mesCurto(prox + '-01')) + (faltam(prox) ? ' (' + faltam(prox) + ')' : ' ✓') + '</button>' +
      '<small>Gerar o mês cria a conta de cada recorrente ativa que ainda não tem a do mês (pode clicar de novo sem duplicar).</small></div>' +
      (l.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th class="num">Dia</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th><th>Parcela neste mês</th><th></th></tr></thead><tbody>' +
        l.map(r => '<tr class="clicavel' + (r.ativo === false ? ' apagado' : '') + '" data-acao="cx-rec-editar" data-id="' + esc(r.id) + '" tabindex="0"><td class="num">' + r.dia + '</td>' +
          '<td><strong>' + esc(r.descricao) + '</strong>' + (r.fornecedor || r.entre_empresas ? '<small>' + esc([r.fornecedor, r.entre_empresas ? 'entre empresas' : ''].filter(Boolean).join(' · ')) + '</small>' : '') + '</td>' +
          '<td>' + esc(r.categoria || '') + '</td><td class="num ' + (r.tipo === 'entrada' ? 'cx-pos' : 'cx-neg') + '">' + esc(R.moeda(r.valor)) + '</td><td>' + esc(parcelaDe(r)) + '</td>' +
          '<td>' + (r.ativo === false ? selo('parada', 'cinza') : '') + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="3">' + l.length + ' recorrente(s) · saldo das ativas no mês</td><td class="num"><strong>' + esc(R.moeda(totMes)) + '</strong></td><td colspan="2"></td></tr></tfoot></table></div>'
        : '<p class="vazio">Nenhuma conta recorrente ainda. Cadastre aluguel, salários, pró-labore, contas de consumo, parcelamentos…</p>') + '</section>';
  }

  CRM.telas.caixa = {
    turmaSub: () => vista,
    render() {
      if (!CRM.ehAdmin()) return '<div class="cartao"><p class="vazio">Esta tela é só do administrador.</p></div>';
      if (!F) { setTimeout(carrega, 0); return '<div class="cabecalho"><div><h1>Caixa</h1></div></div><div class="cartao"><p class="vazio">Carregando o caixa…</p></div>'; }
      const escrevendo = typeof document !== 'undefined' && document.activeElement && document.activeElement.id === 'cxFrases';
      if (Date.now() - lidoEm > 60000 && !escrevendo) setTimeout(carrega, 0); // o que mudou em outro computador
      const s = saldoAtual(F.saldos, F.lancamentos);
      const pausadas = F.lancamentos.filter(x => x.situacao === 'pausado').length;
      const aba = (id, rot) => '<button type="button" class="' + (vista === id ? 'ativa' : '') + '" data-acao="cx-vista" data-id="' + id + '">' + esc(rot) + '</button>';
      if (vista === 'pausadas') filtro.situacao = 'pausadas';
      return '<div class="cabecalho cx-cab"><div><h1>Caixa</h1><p class="sub">Banco do Brasil · contas a pagar, recorrentes e o dia a dia · só você vê esta tela</p></div>' +
        '<div class="cx-saldo"><span>Saldo agora</span><strong class="' + (s.saldo < 0 ? 'cx-neg' : '') + '">' + (s.saldo == null ? '—' : esc(R.moeda(s.saldo))) + '</strong>' +
        '<small>' + (s.ancora ? 'banco ' + esc(R.moeda(s.ancora.valor)) + ' em ' + esc(R.dataBR(s.ancora.data)) + (s.n ? ' · +' + esc(R.moeda(s.entradas)) + ' −' + esc(R.moeda(s.saidas)) + ' baixados aqui' : '') : 'informe o saldo do banco') + '</small>' +
        '<button type="button" class="btn sec" data-acao="cx-conferir">Conferir com o banco</button></div></div>' +
        '<nav class="cx-abas">' + aba('dia', 'Dia a dia') + aba('contas', 'Contas a pagar') + aba('recorrentes', 'Recorrentes') + aba('pausadas', 'Contas pausadas' + (pausadas ? ' (' + pausadas + ')' : '')) +
          (CRM.cobranca ? aba('cobranca', 'Cobrança' + (CRM.cobranca.contagem() ? ' (' + CRM.cobranca.contagem() + ')' : '')) : '') + '</nav>' +
        (vista === 'dia' ? caixaFrases() + grade(s) + blocosVencidos() : vista === 'recorrentes' ? listaRecorrentes() : vista === 'cobranca' && CRM.cobranca ? CRM.cobranca.aba() : listaContas());
    },
    depois(el) {
      if (vista === 'cobranca' && CRM.cobranca) CRM.cobranca.depoisAba(el);
      const fr = el.querySelector('#cxFrases');
      if (fr) {
        fr.addEventListener('input', () => { rascunho = fr.value; });
        fr.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); CRM.acoes['cx-frases'](); } });
        // colar o print (Ctrl+V) ou arrastar o arquivo para a caixa de frases
        fr.addEventListener('paste', ev => {
          const f = [].slice.call((ev.clipboardData && ev.clipboardData.files) || []).find(x => TIPOS_ANEXO.test(x.type));
          if (f) { ev.preventDefault(); rascunho = fr.value; poeAnexo(f); }
        });
        const caixa = fr.closest('.cx-frases');
        caixa.addEventListener('dragover', ev => { if (ev.dataTransfer && [].slice.call(ev.dataTransfer.types || []).indexOf('Files') !== -1) { ev.preventDefault(); caixa.classList.add('cx-solta'); } });
        caixa.addEventListener('dragleave', () => caixa.classList.remove('cx-solta'));
        caixa.addEventListener('drop', ev => {
          const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
          if (!f) return;
          ev.preventDefault(); caixa.classList.remove('cx-solta'); rascunho = fr.value; poeAnexo(f);
        });
        const arqAnexo = el.querySelector('#cxAnexoArq');
        if (arqAnexo) arqAnexo.addEventListener('change', () => { const f = arqAnexo.files[0]; arqAnexo.value = ''; rascunho = fr.value; poeAnexo(f); });
      }
      const arq = el.querySelector('#cxPagarFkn');
      if (arq) arq.addEventListener('change', () => { const f = arq.files[0]; arq.value = ''; if (f) importarPagar(f).catch(CRM.falhou); });
      // filtros da lista
      el.querySelectorAll('[data-cx-filtro]').forEach(i => i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', () => {
        filtro[i.dataset.cxFiltro] = i.value;
        if (i.dataset.cxFiltro === 'situacao' && vista === 'pausadas' && i.value !== 'pausadas') vista = 'contas';
        CRM.render();
      }));
      // arrastar uma conta para outro dia
      let arrastando = null;
      el.querySelectorAll('[data-mover]').forEach(c => {
        c.addEventListener('dragstart', ev => { arrastando = c.dataset.mover; ev.dataTransfer.setData('text/plain', arrastando); c.classList.add('arrastando'); });
        c.addEventListener('dragend', () => c.classList.remove('arrastando'));
      });
      el.querySelectorAll('.cx-grade td[data-dia]').forEach(td => {
        td.addEventListener('dragover', ev => { if (arrastando) { ev.preventDefault(); td.classList.add('alvo'); } });
        td.addEventListener('dragleave', () => td.classList.remove('alvo'));
        td.addEventListener('drop', ev => {
          ev.preventDefault(); td.classList.remove('alvo');
          const id = arrastando || ev.dataTransfer.getData('text/plain'); arrastando = null;
          if (id.indexOf('tit:') === 0) { remarcarTitulo(id.slice(4), td.dataset.dia).catch(e => CRM.toast(e.message, true)); return; }
          const l = lanc(id);
          if (l && l.vencimento !== td.dataset.dia) grava(l.id, { vencimento: td.dataset.dia }).then(() => CRM.toast('Movida para ' + dm(td.dataset.dia) + '.')).catch(CRM.falhou);
        });
      });
    }
  };

  const comDia = el => (el && el.dataset.dia) || hoje();
  Object.assign(CRM.acoes, {
    'cx-marca': (id, el, ev) => {
      if (ev) ev.stopPropagation();
      const liga = el.checked;
      const a = ordemLista.indexOf(ultimoMarcado), b = ordemLista.indexOf(id);
      if (ev && ev.shiftKey && a !== -1 && b !== -1) ordemLista.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => (liga ? marcados.add(x) : marcados.delete(x)));
      else if (liga) marcados.add(id); else marcados.delete(id);
      ultimoMarcado = id;
      atualizaSoma();
    },
    // clique na célula, ao lado da caixinha (14/10: o clique um pouco fora da caixinha abria a conta para editar)
    'cx-marca-celula': (id, el, ev) => {
      const c = el.querySelector('input[type=checkbox]');
      if (!c) return;
      c.checked = !c.checked;
      CRM.acoes['cx-marca'](id, c, ev);
    },
    'cx-marca-todas-celula': (id, el) => { const c = el.querySelector('input[type=checkbox]'); if (c) { c.checked = !c.checked; CRM.acoes['cx-marca-todas'](id, c); } },
    'cx-marca-todas': (id, el) => { ordemLista.forEach(x => (el.checked ? marcados.add(x) : marcados.delete(x))); atualizaSoma(); },
    'cx-soma-limpar': qual => {
      if (qual === 'grade') { naGrade.clear(); atualizaSomaGrade(); return; }
      marcados.clear(); ultimoMarcado = null; atualizaSoma(); const t = document.querySelector('[data-acao="cx-marca-todas"]'); if (t) t.checked = false; },
    'cx-soma-copiar': v => {
      const txt = Number(v).toFixed(2).replace('.', ',');
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject(new Error('sem área de transferência')))
        .then(() => CRM.toast('Copiado: ' + txt)).catch(() => prompt('Copie o valor:', txt));
    },
    'cx-vista': id => { vista = id; if (id === 'contas' && filtro.situacao === 'pausadas') filtro.situacao = 'abertas'; CRM.render(); },
    'cx-nav': id => { inicio = +id === 0 ? null : R.somaDias(inicio || R.somaDias(hoje(), -1), +id); CRM.render(); },
    'cx-conferir': () => formConferir(),
    'cx-nova': id => formLanc(null, { tipo: id }),
    'cx-add': (id, el) => formFrase({ tipo: id, data: comDia(el) }),
    'cx-add-form': (id, el) => { fecha(); const data = comDia(el); setTimeout(() => formLanc(null, { tipo: id, data }), 0); },
    'cx-frases': () => {
      const t = $('#cxFrases'); if (t) rascunho = t.value;
      if (anexo) { lerAnexo(rascunho).catch(e => CRM.toast(e.message, true)); return; }
      try { conferirFrases(rascunho, {}); } catch (e) { CRM.toast(e.message, true); }
    },
    'cx-anexar': () => { const i = $('#cxAnexoArq'); if (i) i.click(); },
    'cx-anexo-tirar': () => { anexo = null; CRM.render(); },
    'cx-anexo-abrir': async id => {
      const l = lanc(id);
      if (!l || !l.anexos) return;
      for (const caminho of l.anexos) {
        const w = raiz.open('', '_blank'); // abre já (antes de esperar o link), senão o navegador bloqueia
        try { const u = await CRM.store().anexoLink(caminho); if (w) w.location = u; else raiz.open(u, '_blank'); } catch (e) { if (w) w.close(); CRM.falhou(e); }
      }
    },
    'cx-desfrase': async id => {
      fecha();
      const d = raiz.CRMFrases.desfazer(lanc(id), { lancamentos: F.lancamentos });
      if (!d) return;
      try {
        const st = CRM.store();
        for (const a of d.atualizar) troca(F.lancamentos, await st.atualizar('fin_lancamentos', a.id, a.patch));
        for (const x of d.remover) await st.remover('fin_lancamentos', x);
        F.lancamentos = F.lancamentos.filter(x => d.remover.indexOf(x.id) === -1);
        for (const r of d.recorrentesRemover) await st.remover('fin_recorrentes', r);
        F.recorrentes = F.recorrentes.filter(x => d.recorrentesRemover.indexOf(x.id) === -1);
        for (const r of d.recorrentesDesligar) troca(F.recorrentes, await st.atualizar('fin_recorrentes', r, { ativo: false }));
        CRM.render();
        CRM.toast(d.atualizar.length ? 'Frase desfeita: a conta voltou a ser como era.' : 'Frase desfeita: ' + d.remover.length + ' lançamento(s) saíram do caixa' +
          (d.recorrentesRemover.length ? ' e a conta recorrente do empréstimo foi apagada' : d.recorrentesDesligar.length ? '; a recorrente do empréstimo foi desligada (já tinha parcela paga)' : '') + '.');
      } catch (e) { CRM.falhou(e); }
    },
    // ditado do navegador (Chrome/Edge): escreve no campo; a pessoa confere antes de "Conferir"
    'cx-tit-remarcar': id => {
      const n = $('#dlgForm [name="nova"]');
      const dia = n && n.value;
      if (!dia) { CRM.toast('Escolha a data em "Ou remarcar para".', true); return; }
      remarcarTitulo(id, dia).then(fecha).catch(e => CRM.toast(e.message, true));
    },
    'cx-tit-desremarcar': id => { remarcarTitulo(id, null).then(fecha).catch(CRM.falhou); },
    'cx-falar': (id, el) => {
      const SR = raiz.SpeechRecognition || raiz.webkitSpeechRecognition;
      if (!SR) { CRM.toast('O ditado só funciona no Chrome ou no Edge.', true); return; }
      const alvo = id === 'form' ? $('#dlgForm textarea[name="texto"]') : $('#cxFrases');
      if (!alvo) return;
      const r = new SR();
      r.lang = 'pt-BR'; r.interimResults = false; r.continuous = false;
      r.onresult = ev => {
        const t = [].slice.call(ev.results).map(x => x[0].transcript).join(' ').trim();
        alvo.value = (alvo.value.trim() ? alvo.value.replace(/\s*$/, '\n') : '') + t;
        if (alvo.id === 'cxFrases') rascunho = alvo.value;
        alvo.focus();
      };
      r.onerror = ev => CRM.toast('Ditado: ' + (ev.error === 'not-allowed' ? 'o navegador não deixou usar o microfone' : ev.error), true);
      r.onend = () => el && el.classList.remove('gravando');
      if (el) el.classList.add('gravando');
      r.start();
    },
    'cx-editar': id => { fecha(); const l = lanc(id); if (l) setTimeout(() => formLanc(l), 0); },
    'cx-item': (id, el, ev) => {
      if (el && el.dataset.k && (modoSoma || (ev && (ev.ctrlKey || ev.metaKey)))) {
        if (ev) ev.preventDefault();
        const k = el.dataset.k;
        if (naGrade.has(k)) naGrade.delete(k); else naGrade.set(k, { valor: Number(el.dataset.valor) || 0, tipo: el.dataset.secao === 'entrada' ? 'entrada' : 'saida' });
        atualizaSomaGrade();
        return;
      }
      menuItem(id, comDia(el));
    },
    'cx-modo-soma': () => { modoSoma = !modoSoma; CRM.render(); },
    'cx-ok': (id, el) => {
      const dia = diaDaBaixa(el && el.dataset.dia);
      if (id.indexOf('tit:') === 0) return receberTitulo(id.slice(4), dia).catch(CRM.falhou);
      const l = lanc(id.slice(id.indexOf(':') + 1));
      if (l) pagar(l, dia).then(() => CRM.toast((l.tipo === 'entrada' ? 'Recebido' : 'Pago') + ' em ' + dm(dia) + ': ' + R.moeda(l.valor))).catch(CRM.falhou);
    },
    'cx-pagar': (id, el) => { fecha(); const l = lanc(id); if (l) pagar(l, diaDaBaixa(el && el.dataset.dia)).catch(CRM.falhou); },
    'cx-bx-entrou': id => { const x = baixados().find(y => y.id === id); if (x) formBaixado(x); },
    'cx-bx-nao': id => { const x = baixado(id); if (x) naoEntrouBaixado(x).catch(CRM.falhou); },
    // Pagou no vencimento e não deu baixa (08/10/2026, Anderson: "paguei ontem, só não dei baixa"): baixa
    // no caixa com a data do vencimento — conta no saldo se for depois do último saldo do BB informado.
    'cx-nodia': id => { const l = lanc(id); if (l) pagar(l, diaDaBaixa(l.vencimento)).then(() => CRM.toast((l.tipo === 'entrada' ? 'Recebido' : 'Pago') + ' em ' + dm(diaDaBaixa(l.vencimento)) + ': ' + R.moeda(l.valor) + ' (entrou no saldo).')).catch(CRM.falhou); },
    'cx-japaga': id => { const l = lanc(id); if (l) grava(l.id, { situacao: 'pago', pago_em: l.vencimento, baixa: 'fora', baixado_em: agora() }).catch(CRM.falhou); },
    'cx-excluir': id => {
      const l = lanc(id);
      if (!l || !confirm(textoExcluir(l))) return;
      fecha();
      excluirLanc(l).then(() => CRM.toast('Excluído: ' + l.descricao + ' (' + R.moeda(l.valor) + ').')).catch(CRM.falhou);
    },
    'cx-pausar': id => { fecha(); const l = lanc(id); if (l) grava(l.id, { situacao: 'pausado' }).then(() => CRM.toast('Conta pausada: saiu do caixa (aba Contas pausadas).')).catch(CRM.falhou); },
    'cx-voltar': id => { const l = lanc(id); if (l) grava(l.id, { situacao: 'aberto' }).catch(CRM.falhou); },
    'cx-desfazer': id => {
      fecha();
      const l = lanc(id);
      if (!l) return;
      // recebimento de título baixado no FKN: desfeito, ele volta para "Baixados no FKN"
      const bx = (F.baixados || []).find(x => x.lancamento_id === l.id);
      (l.origem === 'titulo' ? remove(l.id) : grava(l.id, { situacao: 'aberto', pago_em: null, baixa: null, baixado_em: null }))
        .then(() => bx && resolveBaixado(bx, { resolvido: null, lancamento_id: null })).catch(CRM.falhou);
    },
    'cx-rec-nova': () => formRecorrente(null),
    'cx-rec-editar': id => { const r = F && F.recorrentes.find(x => x.id === id); if (r) formRecorrente(r); },
    'cx-gerar': id => gerar(id).catch(CRM.falhou)
  });
})(typeof window !== 'undefined' ? window : globalThis);
