/* Os diretores da turma (CEO Grupo Dalessi): um cartão com a análise do dia feita pela IA (crm-assistente), uma vez por
   dia, e guardada no banco. O primeiro que abre a tela no dia (em cada chave) dispara a análise em segundo plano; depois,
   todos leem a guardada. As contas são do banco, com o login de quem abre.
   - Gerente de Vendas (24/10/2026): no Início; a análise da equipe para o administrador e a gestora, a da carteira para
     cada vendedor(a) (acao 'analise_vendas', manual em supabase/functions/crm-assistente/vendas.ts, crm_ia_analises_vendas).
   - Diretor de Logística (24/10/2026): no alto de Rotas, para a logística e a gestão (acao 'analise_logistica', manual em
     logistica.ts, conta em crm_dl_painel, guardada em crm_ia_analises_areas). O personagem é o da Logística da turma. */
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM;
  if (!CRM || typeof document === 'undefined') return;
  const esc = s => CRM.esc(s);

  // cfg: { id (mascote e prefixo das ações), titulo, papeis, chave(), quem(), gerar(refazer), hoje(dia, chave), pergunta() }
  function cartao(cfg) {
    let analise = null, dia = '', gerando = false, carregando = false;
    const marca = 'crm_analise_' + cfg.id + '_tentada';
    const daVez = () => !!(CRM.store() && cfg.papeis.indexOf(CRM.papel()) !== -1 && cfg.temStore(CRM.store()));

    async function carregar() {
      if (carregando || !daVez() || dia === CRM.hoje()) return;
      carregando = true;
      const st = CRM.store();
      try { analise = await cfg.hoje(st, CRM.hoje(), cfg.chave()); dia = CRM.hoje(); } catch (e) { analise = null; }
      carregando = false;
      // ninguém fez ainda hoje (nesta chave): prepara em segundo plano, uma vez por dia neste navegador
      let ja = ''; try { ja = localStorage.getItem(marca) || ''; } catch (e) { /* ok */ }
      if (!analise && st.modo === 'supabase' && ja !== CRM.hoje() + ':' + cfg.chave()) {
        try { localStorage.setItem(marca, CRM.hoje() + ':' + cfg.chave()); } catch (e) { /* ok */ }
        gerar(false);
      } else CRM.render();
    }

    async function gerar(refazer) {
      if (gerando || !daVez()) return;
      gerando = true; CRM.render();
      try { analise = await cfg.gerar(CRM.store(), refazer); dia = CRM.hoje(); }
      catch (e) {
        // leva perto de 1 minuto: o navegador pode desistir antes de o servidor gravar; procura a gravada antes de desistir
        for (let i = 0; i < 6 && !(analise && analise.texto); i++) {
          await new Promise(r => setTimeout(r, 20000));
          try { analise = await cfg.hoje(CRM.store(), CRM.hoje(), cfg.chave()); } catch (e2) { /* tenta de novo */ }
        }
        if (!(analise && analise.texto) && refazer) CRM.falhou(e);
      }
      gerando = false; CRM.render();
    }

    function bloco() {
      if (!daVez()) return '';
      if (dia !== CRM.hoje()) setTimeout(carregar, 0);
      const T = CRM.turma, rosto = T && T.img ? T.img(cfg.id, true) : '';
      const em = analise && analise.em ? ' <small>feita às ' + esc(new Date(analise.em).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })) + '</small>' : '';
      return '<section class="cartao diretor ' + esc(cfg.id) + '"><h2>' + (rosto ? '<img class="gv-rosto" src="' + esc(rosto) + '" alt="" width="36" height="36"> ' : '') +
        esc(cfg.titulo) + ' · análise ' + esc(cfg.quem()) + em + '</h2>' +
        (gerando ? '<p class="vazio">Preparando a análise de hoje (leva perto de 1 minuto)…</p>'
          : analise && analise.texto ? '<div class="analise-texto">' + (T && T.fmt ? T.fmt(analise.texto) : esc(analise.texto)) + '</div>' : '<p class="vazio">Ainda não feita hoje.</p>') +
        '<p class="acoes">' + (!gerando ? '<button type="button" class="btn' + (analise && analise.texto ? ' sec' : '') + '" data-acao="' + esc(cfg.id) + '-gerar">' + (analise && analise.texto ? '↻ Refazer agora' : 'Fazer a análise de hoje') + '</button> ' : '') +
        (T && T.perguntar ? '<button type="button" class="btn sec" data-acao="' + esc(cfg.id) + '-conversar">💬 Conversar com o ' + esc(cfg.titulo) + '</button>' : '') + '</p></section>';
    }

    CRM.acoes[cfg.id + '-gerar'] = () => gerar(!!(analise && analise.texto));
    CRM.acoes[cfg.id + '-conversar'] = () => CRM.turma && CRM.turma.perguntar && CRM.turma.perguntar(cfg.pergunta(), cfg.id);
    return { bloco, gerar, carregar, analise: () => analise };
  }

  CRM.gerenteVendas = cartao({
    id: 'gerente-vendas', titulo: 'Gerente de Vendas', papeis: ['admin', 'gestor', 'vendedor'],
    temStore: st => !!st.analiseVendas,
    chave: () => (CRM.ehGestor() ? 'equipe' : CRM.meuId()),
    quem: () => (CRM.ehGestor() ? 'da equipe' : 'da sua carteira'),
    gerar: (st, refazer) => st.analiseVendas(refazer),
    hoje: (st, d, k) => st.analiseVendasHoje(d, k),
    pergunta: () => (CRM.ehGestor()
      ? 'Como está o mês de vendas da equipe? Quem precisa de ajuda e quais clientes sumidos valem um contato hoje?'
      : 'Como está o meu mês? O que falta para a minha meta e quais clientes da minha carteira valem um contato hoje?')
  });

  CRM.diretorLogistica = cartao({
    id: 'logistica', titulo: 'Diretor de Logística', papeis: ['admin', 'gestor', 'logistica'],
    temStore: st => !!st.analiseLogistica,
    chave: () => 'logistica',
    quem: () => 'das entregas',
    gerar: (st, refazer) => st.analiseLogistica(refazer),
    hoje: (st, d) => st.analiseLogisticaHoje(d),
    pergunta: () => 'Como estão as entregas? O que está atrasado ou com problema, e o que eu resolvo primeiro hoje?'
  });
})(typeof window !== 'undefined' ? window : globalThis);
