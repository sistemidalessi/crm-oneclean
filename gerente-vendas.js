/* Gerente de Vendas (24/10/2026, CEO Grupo Dalessi): o diretor de vendas da turma. Um cartão no Início com a análise de
   vendas do dia (a da equipe para o administrador e a gestora; a da carteira para cada vendedor(a)), feita uma vez por
   dia pela IA (crm-assistente, acao 'analise_vendas', manual em supabase/functions/crm-assistente/vendas.ts) e
   guardada no banco (crm_ia_analises_vendas). As contas são do banco (crm_gv_*), com o login de quem abre: a vendedora
   só vê a carteira dela, sem custo. O primeiro da equipe que abre o CRM no dia (em cada carteira) dispara a análise em
   segundo plano; depois, todos leem a guardada. */
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM;
  if (!CRM || typeof document === 'undefined') return;
  const esc = s => CRM.esc(s);
  const ID = 'gerente-vendas';
  let analise = null, dia = '', gerando = false, carregando = false;

  const daVez = () => !!(CRM.store() && CRM.store().analiseVendas && ['admin', 'gestor', 'vendedor'].indexOf(CRM.papel()) !== -1);
  const chave = () => (CRM.ehGestor() ? 'equipe' : CRM.meuId());

  async function carregar() {
    if (carregando || !daVez() || dia === CRM.hoje()) return;
    carregando = true;
    const st = CRM.store();
    try { analise = await st.analiseVendasHoje(CRM.hoje(), chave()); dia = CRM.hoje(); } catch (e) { analise = null; }
    carregando = false;
    // ninguém fez ainda hoje (nesta carteira): prepara em segundo plano, uma vez por dia neste navegador
    let ja = ''; try { ja = localStorage.getItem('crm_analise_vendas_tentada') || ''; } catch (e) { /* ok */ }
    if (!analise && st.modo === 'supabase' && ja !== CRM.hoje() + ':' + chave()) {
      try { localStorage.setItem('crm_analise_vendas_tentada', CRM.hoje() + ':' + chave()); } catch (e) { /* ok */ }
      gerar(false);
    } else CRM.render();
  }

  async function gerar(refazer) {
    if (gerando || !daVez()) return;
    gerando = true; CRM.render();
    try { analise = await CRM.store().analiseVendas(refazer); dia = CRM.hoje(); }
    catch (e) {
      // leva perto de 1 minuto: o navegador pode desistir antes de o servidor gravar; procura a gravada antes de desistir
      for (let i = 0; i < 6 && !(analise && analise.texto); i++) {
        await new Promise(r => setTimeout(r, 20000));
        try { analise = await CRM.store().analiseVendasHoje(CRM.hoje(), chave()); } catch (e2) { /* tenta de novo */ }
      }
      if (!(analise && analise.texto) && refazer) CRM.falhou(e);
    }
    gerando = false; CRM.render();
  }

  // o cartão do Início
  function bloco() {
    if (!daVez()) return '';
    if (dia !== CRM.hoje()) setTimeout(carregar, 0);
    const T = CRM.turma, rosto = T && T.img ? T.img(ID, true) : '';
    const quem = CRM.ehGestor() ? 'da equipe' : 'da sua carteira';
    const em = analise && analise.em ? ' <small>feita às ' + esc(new Date(analise.em).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })) + '</small>' : '';
    return '<section class="cartao gerente-vendas"><h2>' + (rosto ? '<img class="gv-rosto" src="' + esc(rosto) + '" alt="" width="36" height="36"> ' : '') +
      'Gerente de Vendas · análise ' + esc(quem) + em + '</h2>' +
      (gerando ? '<p class="vazio">Preparando a análise de hoje (leva perto de 1 minuto)…</p>'
        : analise && analise.texto ? '<div class="analise-texto">' + (T && T.fmt ? T.fmt(analise.texto) : esc(analise.texto)) + '</div>' : '<p class="vazio">Ainda não feita hoje.</p>') +
      '<p class="acoes">' + (!gerando ? '<button type="button" class="btn' + (analise && analise.texto ? ' sec' : '') + '" data-acao="gv-gerar">' + (analise && analise.texto ? '↻ Refazer agora' : 'Fazer a análise de hoje') + '</button> ' : '') +
      (T && T.perguntar ? '<button type="button" class="btn sec" data-acao="gv-conversar">💬 Conversar com o Gerente de Vendas</button>' : '') + '</p></section>';
  }

  CRM.gerenteVendas = { bloco, gerar, carregar, analise: () => analise };
  Object.assign(CRM.acoes, {
    'gv-gerar': () => gerar(!!(analise && analise.texto)),
    'gv-conversar': () => CRM.turma && CRM.turma.perguntar && CRM.turma.perguntar(CRM.ehGestor()
      ? 'Como está o mês de vendas da equipe? Quem precisa de ajuda e quais clientes sumidos valem um contato hoje?'
      : 'Como está o meu mês? O que falta para a minha meta e quais clientes da minha carteira valem um contato hoje?', ID)
  });
})(typeof window !== 'undefined' ? window : globalThis);
