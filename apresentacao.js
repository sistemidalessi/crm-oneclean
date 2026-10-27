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
    'Eu consulto o sistema e oriento; a execução é de vocês. Não altero cadastros, pedidos ou valores e não envio mensagens a clientes.',
    'Os números que apresento vêm do próprio sistema. Quando eu não tiver um dado, direi isso com clareza.',
    'A diretoria presta contas: eu e os demais diretores apresentamos relatórios sobre o andamento das áreas ao CEO do {grupo}.'
  ];
  // o que vale para todos: cobrança com plano e prazo, e treinamento quando os números pedirem
  const COBRA = 'Quando algo estiver atrasado ou fora do padrão, vou cobrar um plano de ação e um prazo de retorno, e vou acompanhar até ser resolvido. Também vou indicar treinamentos e temas de estudo sempre que os números mostrarem necessidade de desenvolvimento.';

  // texto(papel, primeiroNome, { empresa, grupo }) → { diretor, titulo, saudacao, paragrafos, importante, convite } ou null
  // 27/10/2026 (Anderson: "deixa o CRM firme também", depois de trocar o Agilitinho da Agilité pelo Diretor de RH e DP):
  // postura de diretor, sem tom de parceiro ou de mascote.
  function texto(papel, nome, o) {
    const diretor = DIRETOR_DO_PAPEL[papel];
    if (!diretor) return null;
    const empresa = (o && o.empresa) || 'empresa', grupo = (o && o.grupo) || 'grupo';
    const ia = area => 'Sou uma inteligência artificial e respondo pela ' + area + ' junto à gestão da empresa.';
    let titulo, p;
    if (papel === 'gestor') {
      titulo = 'Diretor de Vendas';
      p = [
        ia('área comercial') + ' Com você, meu papel é sustentar a liderança da equipe com números.',
        'Todos os dias trago a análise da equipe: o ritmo do mês por vendedor(a), quem precisa de apoio e em quê, os clientes que deixaram de comprar, o funil de negócios e os indicadores de ticket médio, conversão e clientes novos. Às segundas-feiras, preparo o acompanhamento da semana com os focos da equipe.',
        'Vou ajudar você a definir planos de ação, preparar as conversas com cada vendedor(a), indicar treinamentos para a equipe e acompanhar o que foi combinado até ser cumprido. Os Diretores de Compras e de Logística respondem pelas áreas deles.',
        'Pela sua posição de liderança, vou trazer a você pontos de atenção e pedidos de retorno sobre os resultados da equipe, com prazo.'
      ];
    } else if (papel === 'vendedor') {
      titulo = 'Diretor de Vendas';
      p = [
        ia('área comercial'),
        'Meu trabalho é garantir que a sua carteira renda o que pode render: o ritmo do mês, a meta, os clientes que deixaram de comprar e os negócios em andamento. Acompanho esses números todos os dias e aponto o que precisa ser feito, em que ordem e até quando. Às segundas-feiras, faremos o acompanhamento da semana, e vou pedir o seu retorno.',
        COBRA
      ];
    } else if (papel === 'comprador') {
      titulo = 'Diretor de Compras';
      p = [
        ia('área de compras'),
        'Meu trabalho é garantir que não falte o que vende e que não sobre o que não gira, comprando pelo preço certo: estoque, venda de cada produto, prazos e preços dos fornecedores e notas de compra. Acompanho isso todos os dias e aponto o que pedir, de quem, por qual preço negociar e até quando.',
        COBRA
      ];
    } else {
      titulo = 'Diretor de Logística';
      p = [
        ia('área de logística'),
        'Meu trabalho é garantir que o que foi vendido chegue ao cliente no dia combinado, com o canhoto assinado: rotas, entregas, canhotos, pedidos em separação e notas que ainda não entraram em rota. Acompanho isso todos os dias e aponto o que precisa ser resolvido primeiro e até quando.',
        COBRA
      ];
    }
    return {
      diretor, titulo, versao: VERSAO,
      saudacao: 'Olá' + (nome ? ', ' + nome : '') + '.',
      apresentacao: 'Sou o ' + titulo + ' da ' + empresa + '.',
      paragrafos: p,
      importante: COMUM.map(t => t.replace('{grupo}', grupo)),
      convite: 'Conto com o compromisso ' + (papel === 'gestor' ? 'da sua liderança' : 'de cada um') + '. Dúvidas, planos e os retornos que eu pedir passam por "Conversar com o ' + titulo + '".'
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
