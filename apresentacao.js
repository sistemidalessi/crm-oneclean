/* Apresentação dos diretores (27/10/2026, pedido do Anderson: "o diretor de cada área fala com os funcionários daquela
   área, se apresentando, que ele é uma inteligência artificial, que está ali para ajudar, para fazer planos, sugerir
   treinamentos… e que toda a diretoria traz relatórios ao CEO do grupo"). Tom formal; a gestora recebe a versão de
   líder. Na primeira vez que a pessoa entra, o diretor da área dela se apresenta numa janela; "Entendi" grava em
   crm_ia_apresentacoes (vale em qualquer computador). O administrador vê os textos e quem já leu em Configurações.
   Texto fixo, não escrito pela IA na hora: todos recebem a mesma mensagem, revisada. Mudou o texto? Subir VERSAO
   (mostra de novo para todos). A parte de cima (textos) é pura e tem teste (testes/apresentacao.test.js). */
(function (raiz) {
  'use strict';
  const VERSAO = 1;

  // Quem apresenta para cada papel (id do mascote em config.js turma.mascotes). O administrador e o motorista não recebem.
  const DIRETOR_DO_PAPEL = { vendedor: 'gerente-vendas', gestor: 'gerente-vendas', comprador: 'compras-setor-interno', logistica: 'logistica' };

  const COMUM = [
    'Eu apenas consulto o sistema: não altero cadastros, pedidos ou valores e não envio mensagens a clientes.',
    'Os números que apresento vêm do próprio sistema. Quando eu não tiver um dado, direi isso com clareza.',
    'Como em qualquer empresa, a diretoria presta contas: eu e os demais diretores apresentamos relatórios sobre o andamento das áreas ao CEO do {grupo}.'
  ];

  // texto(papel, primeiroNome, { empresa, grupo }) → { diretor, titulo, saudacao, paragrafos, importante, convite } ou null
  function texto(papel, nome, o) {
    const diretor = DIRETOR_DO_PAPEL[papel];
    if (!diretor) return null;
    const empresa = (o && o.empresa) || 'empresa', grupo = (o && o.grupo) || 'grupo';
    const ia = 'Antes de começarmos, quero me apresentar com transparência: sou uma inteligência artificial, criada pela ' + empresa + ' para apoiar ';
    let titulo, p;
    if (papel === 'gestor') {
      titulo = 'Diretor de Vendas';
      p = [
        ia + 'você na liderança da equipe comercial.',
        'Todos os dias trago a análise da equipe: o ritmo do mês por vendedor(a), quem precisa de apoio e em quê, os clientes que deixaram de comprar, o funil de negócios e os indicadores de ticket médio, conversão e clientes novos. Às segundas-feiras, preparo o acompanhamento da semana com os focos da equipe.',
        'Posso ajudar você a montar planos de ação, preparar as conversas com cada vendedor(a), sugerir treinamentos para a equipe e acompanhar o que foi combinado. Os Diretores de Compras e de Logística também estão à disposição nas áreas deles.',
        'Pela sua posição de liderança, também trarei a você pontos de atenção e pedidos de retorno sobre os resultados da equipe.'
      ];
    } else if (papel === 'vendedor') {
      titulo = 'Diretor de Vendas';
      p = [
        ia + 'a área comercial.',
        'Meu papel é caminhar ao seu lado. Todos os dias acompanho os números da sua carteira (o ritmo do mês, a meta, os clientes que deixaram de comprar e os negócios em andamento) e trago uma análise com as prioridades do dia. Às segundas-feiras, faremos juntos o acompanhamento da semana.',
        'Também estou aqui para ajudar a montar planos de ação, sugerir treinamentos e temas de estudo quando os números mostrarem uma oportunidade de desenvolvimento, e responder às suas dúvidas a qualquer hora.'
      ];
    } else if (papel === 'comprador') {
      titulo = 'Diretor de Compras';
      p = [
        ia + 'a área de compras.',
        'Todos os dias acompanho o estoque, a venda de cada produto, os prazos e preços dos fornecedores e as notas de compra, e trago uma análise com o que pedir, de quem e por qual preço negociar, além do estoque parado que merece atenção.',
        'Também estou aqui para ajudar a montar planos de compra, preparar negociações com fornecedores, sugerir treinamentos e temas de estudo quando os números mostrarem uma oportunidade de desenvolvimento, e responder às suas dúvidas a qualquer hora.'
      ];
    } else {
      titulo = 'Diretor de Logística';
      p = [
        ia + 'a área de logística.',
        'Todos os dias acompanho as rotas, as entregas, os canhotos, os pedidos em separação e as notas que ainda não entraram em rota, e trago uma análise com o que precisa de atenção primeiro.',
        'Também estou aqui para ajudar a organizar a rotina, montar planos de ação para os problemas de entrega, sugerir treinamentos e temas de estudo quando os números mostrarem uma oportunidade de desenvolvimento, e responder às suas dúvidas a qualquer hora.'
      ];
    }
    return {
      diretor, titulo, versao: VERSAO,
      saudacao: 'Olá' + (nome ? ', ' + nome : '') + '.',
      apresentacao: 'Sou o ' + titulo + ' da ' + empresa + '.',
      paragrafos: p,
      importante: COMUM.map(t => t.replace('{grupo}', grupo)),
      convite: 'Conte comigo. Quando quiser, é só clicar em "Conversar com o ' + titulo + '" e fazer a sua primeira pergunta.'
    };
  }

  const API = { VERSAO, DIRETOR_DO_PAPEL, texto };
  raiz.CRMApresentacao = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  // ------------------------------------------------------------------ tela (só no navegador)
  const CRM = raiz.CRM;
  if (!CRM || typeof document === 'undefined') return;
  const esc = s => CRM.esc(s);
  const cfgA = () => ({ empresa: (raiz.CRM_CONFIG && raiz.CRM_CONFIG.nomeEmpresa) || 'empresa', grupo: (raiz.CRM_CONFIG && raiz.CRM_CONFIG.grupo) || 'Grupo Dalessi' });
  let vistos = null, carregando = false, aberta = false, todos = null;

  function html(t, fechar) {
    const T = CRM.turma, rosto = T && T.img ? T.img(t.diretor) : '';
    return '<div class="apres-cab">' + (rosto ? '<img src="' + esc(rosto) + '" alt="">' : '') + '<div><small>Apresentação</small><h2>' + esc(t.titulo) + '</h2></div></div>' +
      '<div class="apres-corpo"><p><strong>' + esc(t.saudacao) + '</strong></p><p>' + esc(t.apresentacao) + ' ' + esc(t.paragrafos[0]) + '</p>' +
      t.paragrafos.slice(1).map(x => '<p>' + esc(x) + '</p>').join('') +
      '<p><strong>É importante que você saiba:</strong></p><ul>' + t.importante.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
      '<p>' + esc(t.convite) + '</p><p class="apres-assina">' + esc(t.titulo) + '<br><small>' + esc(cfgA().empresa) + '</small></p></div>' +
      '<p class="acoes">' + fechar + '</p>';
  }

  function dialogo() {
    let d = document.getElementById('dlgApresentacao');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'dlgApresentacao'; d.className = 'dlg apresentacao';
      d.addEventListener('cancel', ev => { if (d.dataset.obrigatorio === '1') ev.preventDefault(); });
      document.body.appendChild(d);
    }
    return d;
  }

  function mostrar(t, previa) {
    const d = dialogo();
    d.dataset.obrigatorio = previa ? '' : '1';
    d.innerHTML = html(t, previa ? '<button type="button" class="btn sec" data-acao="apres-fechar">Fechar a prévia</button>'
      : '<button type="button" class="btn" data-acao="apres-entendi" data-id="' + esc(t.diretor) + '">Entendi, vamos começar</button>');
    if (!d.open) d.showModal();
    d.scrollTop = 0;
  }

  async function conferir() {
    const st = CRM.store(), eu = CRM.estado.eu;
    if (aberta || carregando || !st || !st.apresentacoes || !eu) return;
    const t = texto(eu.papel, String(eu.nome || '').split(' ')[0], cfgA());
    if (!t) return;
    if (!vistos) {
      carregando = true;
      try { vistos = await st.apresentacoes(); } catch (e) { carregando = false; return; }   // sem banco agora: tenta depois
      carregando = false;
    }
    const meu = st.modo === 'local' ? 'local' : eu.user_id;
    if (vistos.some(v => v.user_id === meu && v.diretor === t.diretor && Number(v.versao) >= VERSAO)) return;
    aberta = true;
    mostrar(t, false);
  }

  Object.assign(CRM.acoes, {
    'apres-entendi': async diretor => {
      const d = document.getElementById('dlgApresentacao'); if (d) d.close();
      const st = CRM.store(), eu = CRM.estado.eu;
      (vistos = vistos || []).push({ user_id: st.modo === 'local' ? 'local' : eu && eu.user_id, diretor, versao: VERSAO, visto_em: new Date().toISOString() });
      try { await st.apresentacaoVista(diretor, VERSAO); } catch (e) { CRM.falhou(e); }
    },
    'apres-fechar': () => { const d = document.getElementById('dlgApresentacao'); if (d) d.close(); },
    'apres-previa': papel => { const t = texto(papel, 'Fulana', cfgA()); if (t) mostrar(t, true); }
  });

  // Configurações → Apresentação dos diretores (só o administrador): prévia de cada texto e quem já leu
  const ROTULO = { vendedor: 'Vendedor(a)', gestor: 'Gestora (versão de líder)', comprador: 'Comprador(a)', logistica: 'Logística' };
  function telaAjustes() {
    if (!CRM.ehAdmin()) return '<p class="dica">Só o administrador vê esta parte.</p>';
    if (todos === null && CRM.store().apresentacoes) {
      todos = [];
      CRM.store().apresentacoes().then(l => { todos = l || []; CRM.render(); }).catch(e => { todos = null; CRM.falhou(e); });
    }
    const us = (CRM.estado.D.usuarios || []).filter(u => u.ativo !== false && DIRETOR_DO_PAPEL[u.papel]).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const leu = u => (todos || []).find(v => v.user_id === u.user_id && v.diretor === DIRETOR_DO_PAPEL[u.papel] && Number(v.versao) >= VERSAO);
    return '<section class="cartao"><h2>Apresentação dos diretores</h2><p>Na primeira vez que cada pessoa entra, o diretor da área dela se apresenta: diz que é uma inteligência artificial, o que faz, o que não faz e que a diretoria apresenta relatórios ao CEO do ' + esc(cfgA().grupo) + '. Texto fixo, igual para todos (versão ' + VERSAO + ').</p>' +
      '<p class="acoes">' + Object.keys(ROTULO).map(p => '<button type="button" class="btn sec" data-acao="apres-previa" data-id="' + p + '">Ver: ' + esc(ROTULO[p]) + '</button>').join(' ') + '</p></section>' +
      '<section class="cartao sem-pad tabela-rolagem"><table class="tabela"><thead><tr><th>Pessoa</th><th>Papel</th><th>Diretor</th><th>Leu em</th></tr></thead><tbody>' +
      us.map(u => { const v = leu(u), t = texto(u.papel, '', cfgA());
        return '<tr><td>' + esc(u.nome) + '</td><td>' + esc(ROTULO[u.papel] || u.papel) + '</td><td>' + esc(t ? t.titulo : '') + '</td><td>' +
          (v ? esc(new Date(v.visto_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) : CRM.selo('ainda não', 'cinza')) + '</td></tr>'; }).join('') +
      '</tbody></table></section>';
  }
  if (CRM.ajustes && CRM.ajustes.secao) CRM.ajustes.secao('apresentacao', 'Apresentação dos diretores', telaAjustes, null, 'importar');

  CRM.apresentacao = { conferir, previa: p => CRM.acoes['apres-previa'](p) };
})(typeof window !== 'undefined' ? window : globalThis);
