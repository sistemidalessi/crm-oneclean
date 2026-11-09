/* CRM Sistemi Dalessi — Contas a pagar de fornecedor para o comprador (03/11/2026, Anderson: "liberar para ele visualizar,
   mas somente título de fornecedor… e deixar a opção dele editar se tiver errado, com um campo de observação, por que está
   editando, e vai ficar tudo registrado"). Só a categoria Fornecedores do Caixa (o banco filtra: crm_fin_fornecedores_ler).
   Corrigir valor, vencimento, fornecedor e descrição de conta ainda não paga pede o motivo (crm_fin_fornecedor_editar): o
   registro fica em crm_fin_fornecedor_edicoes e o motivo nas observações da conta, que o administrador vê no Caixa.
   O comprador não dá baixa, não exclui e não vê as outras contas. */
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, R = raiz.CRMRegras;
  if (!CRM || !CRM.telas) return;
  const esc = CRM.esc;
  const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
  const pode = () => CRM.ehAdmin() || CRM.ehComprador();
  const br = d => (d ? R.dataBR(String(d).slice(0, 10)) : '—');
  let dados = null, carregando = false;
  const f = { ver: 'abertas' };
  async function carrega() {
    if (carregando) return;
    carregando = true;
    try { dados = await CRM.store().fornecedoresPagar(); } catch (e) { dados = dados || []; CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }
  const ORIGEM = { fkn: 'FKN', tela: 'lançada no Caixa', recorrente: 'recorrente', compra: 'nota de compra' };
  const origemDe = c => (c.compra_id ? 'nota de compra' : ORIGEM[c.origem] || c.origem || '');
  const VER = [['abertas', 'A pagar'], ['vencidas', 'Vencidas'], ['semana', 'Vencem em 7 dias'], ['pausadas', 'Pausadas'], ['pagas', 'Pagas (30 dias)'], ['todas', 'Todas']];
  function situacaoDe(c, hoje) {
    if (c.situacao === 'pago') return ['paga' + (c.pago_em ? ' ' + br(c.pago_em).slice(0, 5) : ''), 'verde'];
    if (c.situacao === 'pausado') return ['pausada', 'cinza'];
    if (String(c.vencimento) < hoje) return ['vencida', 'vermelho'];
    if (String(c.vencimento) <= R.somaDias(hoje, 7)) return ['vence em breve', 'ambar'];
    return ['a vencer', 'azul'];
  }
  function filtra(l, hoje) {
    const em7 = R.somaDias(hoje, 7);
    return l.filter(c => f.ver === 'todas' || (f.ver === 'abertas' ? c.situacao === 'aberto' : f.ver === 'vencidas' ? c.situacao === 'aberto' && String(c.vencimento) < hoje
      : f.ver === 'semana' ? c.situacao === 'aberto' && String(c.vencimento) >= hoje && String(c.vencimento) <= em7 : f.ver === 'pausadas' ? c.situacao === 'pausado' : c.situacao === 'pago'));
  }
  CRM.telas.pagarforn = {
    render() {
      if (!pode()) return '<div class="cartao"><p class="vazio">Esta tela é do comprador e do administrador.</p></div>';
      const cab = '<div class="cabecalho"><div><h1>Contas a pagar · fornecedores</h1><p class="sub">para conferir se as contas dos fornecedores foram lançadas certo: valor, vencimento e parcela. ' +
        'Errado? Corrija pelo ✎ e diga o motivo (fica registrado).</p></div><div class="acoes"><button type="button" class="btn sec" data-acao="pf-recarregar">Atualizar</button></div></div>';
      if (dados === null) { setTimeout(carrega, 0); return cab + '<div class="cartao"><p class="vazio">Carregando…</p></div>'; }
      const hoje = CRM.hoje(), ab = dados.filter(c => c.situacao === 'aberto');
      const venc = ab.filter(c => String(c.vencimento) < hoje), sem = ab.filter(c => String(c.vencimento) >= hoje && String(c.vencimento) <= R.somaDias(hoje, 7));
      const soma = arr => arr.reduce((s, c) => s + num(c.valor), 0);
      const kpi = (t, arr, cls, ver) => '<button type="button" class="kpi clicavel ' + (cls || '') + (f.ver === ver ? ' ativo' : '') + '" data-acao="pf-ver" data-id="' + ver + '"><span>' + esc(t) + '</span><strong>' + R.moeda(soma(arr)) + '</strong><small>' + arr.length + ' conta(s)</small></button>';
      const base = filtra(dados, hoje);
      const l = CRM.Lista.filtra('pf-lista', base, { texto: c => [c.fornecedor, R.fornecedorTexto({ codigo: c.forn_codigo, nome: c.fornecedor, fantasia: c.forn_fantasia, cnpj: c.forn_cnpj }), c.descricao, c.titulo_duplicata, c.observacoes, origemDe(c)], data: c => c.vencimento });
      CRM.Lista.planilha('pf-lista', 'contas-a-pagar-fornecedores', ['Vencimento', 'Cód. fornecedor', 'Fornecedor', 'Nome fantasia', 'CNPJ', 'Descrição', 'Parcela', 'Valor', 'Situação', 'Origem', 'Observações'],
        () => l.map(c => [br(c.vencimento), c.forn_codigo || '', c.fornecedor || '', c.forn_fantasia || '', c.forn_cnpj ? R.formataCNPJ(c.forn_cnpj) : '', c.descricao || '', c.parcela ? c.parcela + '/' + (c.parcelas || '?') : '', num(c.valor), situacaoDe(c, hoje)[0], origemDe(c), c.observacoes || '']));
      return cab +
        '<div class="kpis">' + kpi('Vencidas', venc, venc.length ? 'vermelho' : '', 'vencidas') + kpi('Vencem em 7 dias', sem, 'ambar', 'semana') + kpi('A pagar (todas)', ab, '', 'abertas') + '</div>' +
        '<section class="cartao"><div class="filtro-linha">' + VER.map(v => '<button type="button" class="chip-filtro' + (f.ver === v[0] ? ' ativo' : '') + '" data-acao="pf-ver" data-id="' + v[0] + '">' + v[1] + '</button>').join('') + '</div>' +
        CRM.Lista.barra('pf-lista', { periodo: true, rotuloPeriodo: 'Vencimento de', placeholder: 'Fornecedor (código, nome, fantasia ou CNPJ), nota, parcela ou observação', total: base.length, achados: l.length }) +
        (l.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Vencimento</th><th>Fornecedor</th><th>Descrição</th><th>Parcela</th><th class="num">Valor</th><th>Situação</th><th>Origem</th><th></th></tr></thead><tbody>' +
          CRM.Lista.corta('pf-lista', l, 150).map(c => {
            const s = situacaoDe(c, hoje), ed = (c.edicoes || []).length, abre = c.situacao === 'aberto' || c.situacao === 'pausado';
            return '<tr><td>' + esc(br(c.vencimento)) + '</td><td>' + esc(c.fornecedor || '—') +
              // 09/11/2026 (Wellington): código e nome fantasia do cadastro embaixo do nome, para achar como no FKN
              ((c.forn_codigo || c.forn_fantasia) ? '<small>' + esc([c.forn_codigo ? 'cód. ' + c.forn_codigo : '', c.forn_fantasia || ''].filter(Boolean).join(' · ')) + '</small>' : '') + '</td><td>' + esc(c.descricao || '') +
              (ed ? ' <small title="' + esc((c.edicoes || []).map(x => br(x.em) + ' ' + (x.por || '') + ': ' + x.motivo).join('\n')) + '">✎ corrigida ' + ed + 'x</small>' : '') + '</td>' +
              '<td>' + esc(c.parcela ? c.parcela + '/' + (c.parcelas || '?') : '') + '</td><td class="num">' + R.moeda(c.valor) + '</td><td>' + CRM.selo(s[0], s[1]) + '</td><td><small>' + esc(origemDe(c)) + '</small></td>' +
              '<td class="num">' + (abre ? '<button type="button" class="mini" data-acao="pf-editar" data-id="' + esc(c.id) + '" title="Corrigir (pede o motivo)">✎ Corrigir</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' + CRM.Lista.mais('pf-lista', l, 150) + '<p class="dica">Total à vista: <strong>' + R.moeda(soma(l)) + '</strong> em ' + l.length + ' conta(s).</p>'
          : '<p class="vazio">Nenhuma conta aqui.</p>') + '</section>' +
        '<p class="dica">Só as contas de fornecedor do Caixa. Pagar (dar baixa) continua com o administrador.</p>';
    }
  };
  function formEditar(c) {
    const hist = (c.edicoes || []).length ? '<div class="aviso-notas"><strong>Correções anteriores</strong><ul>' + c.edicoes.map(x => '<li>' + esc(br(x.em)) + ' · ' + esc(x.por || '') + ': ' + esc(x.motivo) +
      ' <small>(' + esc(['valor', 'vencimento', 'fornecedor', 'descricao'].filter(k => String(x.antes[k]) !== String(x.depois[k])).map(k => k + ': ' + (k === 'valor' ? R.moeda(x.antes[k]) + ' → ' + R.moeda(x.depois[k])
        : k === 'vencimento' ? br(x.antes[k]) + ' → ' + br(x.depois[k]) : (x.antes[k] || '—') + ' → ' + (x.depois[k] || '—'))).join('; ')) + ')</small></li>').join('') + '</ul></div>' : '';
    CRM.abrirForm({
      titulo: '✎ Corrigir conta · ' + (c.fornecedor || c.descricao || ''),
      intro: 'Corrija o que estiver diferente da nota ou do boleto do fornecedor. O motivo é obrigatório e fica registrado junto com quem corrigiu e o que mudou.',
      htmlAntes: hist,
      campos: [{ nome: 'valor', rotulo: 'Valor (R$)', tipo: 'moeda', obrigatorio: true }, { nome: 'vencimento', rotulo: 'Vencimento', tipo: 'data', obrigatorio: true },
        { nome: 'fornecedor', rotulo: 'Fornecedor', largo: true }, { nome: 'descricao', rotulo: 'Descrição (nota, parcela)', largo: true },
        { nome: 'motivo', rotulo: 'Por que está corrigindo?', tipo: 'textarea', largo: true, obrigatorio: true, dica: 'ex.: boleto do fornecedor vence dia 15, não dia 12; valor da parcela 2 é 1.250,00' }],
      valores: { valor: c.valor, vencimento: String(c.vencimento || '').slice(0, 10), fornecedor: c.fornecedor || '', descricao: c.descricao || '' },
      salvarTexto: 'Gravar a correção',
      aoSalvar: async v => {
        if (String(v.motivo || '').trim().length < 5) throw new Error('diga o motivo da correção');
        const mud = {};
        if (num(v.valor) !== num(c.valor)) mud.valor = num(v.valor);
        if (String(v.vencimento || '') !== String(c.vencimento || '').slice(0, 10)) mud.vencimento = v.vencimento;
        if (String(v.fornecedor || '').trim() !== String(c.fornecedor || '').trim()) mud.fornecedor = v.fornecedor || '';
        if (String(v.descricao || '').trim() !== String(c.descricao || '').trim()) mud.descricao = v.descricao || '';
        if (!Object.keys(mud).length) { CRM.toast('Nada mudou.'); return; }
        await CRM.store().fornecedorPagarEditar(c.id, mud, String(v.motivo).trim());
        CRM.toast('Conta corrigida e registrada.');
        dados = null; CRM.render();
      }
    });
  }
  Object.assign(CRM.acoes, {
    'pf-ver': id => { f.ver = id; CRM.render(); },
    'pf-recarregar': () => { dados = null; CRM.render(); },
    'pf-editar': id => { const c = (dados || []).find(x => x.id === id); if (c) formEditar(c); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
