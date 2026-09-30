/* CRM Sistemi Dalessi — Configurações (só gestor/admin): automações, funil,
   listas, produtos, equipe, metas, modelos de mensagem, importar/exportar,
   duplicados e histórico de alterações. */
(function () {
  'use strict';
  const R = window.CRMRegras, CRM = window.CRM, P = window.CRMPlanilha, DD = window.CRMDados, N = window.CRMNfe;
  const { $, $$, esc } = CRM;
  const E = () => CRM.estado;

  const SECOES = [
    ['geral', 'Geral e automações'], ['funil', 'Funil e etapas'], ['listas', 'Origens, segmentos, motivos'], ['produtos', 'Produtos'],
    ['equipe', 'Equipe e permissões'], ['metas', 'Metas'], ['modelos', 'Modelos de mensagem'], ['importar', 'Importar'],
    ['exportar', 'Exportar e backup'], ['duplicados', 'Duplicados'], ['historico', 'Histórico de alterações']
  ];
  let secao = CRM.pref('ajustes', 'geral');
  let imp = null; // estado da importação em andamento

  const ajustes = CRM.ajustes = {};

  ajustes.render = () => {
    if (!SECOES.some(s => s[0] === secao)) secao = 'geral';
    return '<div class="cabecalho"><h1>Configurações</h1></div><div class="ajustes"><nav class="ajustes-menu">' +
      SECOES.map(s => '<button type="button" class="' + (s[0] === secao ? 'ativa' : '') + '" data-acao="ajustes-secao" data-id="' + s[0] + '">' + esc(s[1]) + '</button>').join('') +
      '</nav><div class="ajustes-corpo">' + (TELAS[secao] || TELAS.geral)() + '</div></div>';
  };
  ajustes.depois = el => { const f = DEPOIS[secao]; if (f) f(el); };

  // ================================================================ Geral
  const CAMPOS_GERAL = [
    { tipo: 'secao', rotulo: 'Empresa' },
    { nome: 'nome_empresa', rotulo: 'Nome que aparece no CRM e nas propostas', largo: true },
    { tipo: 'secao', rotulo: 'Alertas' },
    { nome: 'dias_sem_contato', rotulo: 'Cliente sem contato há mais de (dias)', tipo: 'numero', passo: '1', min: 1 },
    { nome: 'dias_parado', rotulo: 'Negócio parado há mais de (dias)', tipo: 'numero', passo: '1', min: 1 },
    { nome: 'dias_inativo', rotulo: 'Cliente inativo sem comprar há (dias)', tipo: 'numero', passo: '1', min: 1 },
    { nome: 'ciclo_recompra_padrao', rotulo: 'Ciclo de recompra padrão (dias)', tipo: 'numero', passo: '1', min: 1, ajuda: 'cada empresa pode ter o seu' },
    { tipo: 'secao', rotulo: 'Automações' },
    { nome: 'rodizio', rotulo: 'Lead cadastrado pelo gestor sem responsável vai para o próximo vendedor (rodízio)', tipo: 'checkbox', largo: true },
    { nome: 'auto_tarefa_lead', rotulo: 'Lead novo ganha a tarefa "Fazer o primeiro contato"', tipo: 'checkbox', largo: true },
    { nome: 'auto_pos_venda', rotulo: 'Venda ganha cria tarefa de pós-venda', tipo: 'checkbox' },
    { nome: 'dias_pos_venda', rotulo: '… depois de (dias)', tipo: 'numero', passo: '1', min: 1 },
    { nome: 'auto_recompra', rotulo: 'Venda ganha cria lembrete de recompra (no ciclo da empresa)', tipo: 'checkbox', largo: true },
    { nome: 'auto_retomar_perda', rotulo: 'Negócio perdido cria tarefa para retomar o contato', tipo: 'checkbox' },
    { nome: 'dias_retomar_perda', rotulo: '… depois de (dias)', tipo: 'numero', passo: '1', min: 1 },
    { nome: 'etapa_ao_enviar_proposta', rotulo: 'Ao enviar proposta, mover o negócio para a etapa', tipo: 'select', largo: true },
    { tipo: 'secao', rotulo: 'Propostas' },
    { nome: 'proposta_validade_dias', rotulo: 'Validade padrão (dias)', tipo: 'numero', passo: '1', min: 1 },
    { nome: 'proposta_condicoes', rotulo: 'Condições padrão (pagamento, entrega, frete)', tipo: 'textarea', largo: true }
  ];

  function camposGeral() {
    return CAMPOS_GERAL.map(c => c.nome === 'etapa_ao_enviar_proposta'
      ? Object.assign({}, c, { opcoes: [['', '(não mover)']].concat(E().D.etapas.slice().sort((a, b) => a.ordem - b.ordem).map(e => [e.id, (CRM.funis().length > 1 ? e.funil + ' · ' : '') + e.nome])) }) : c);
  }

  const TELAS = {};
  const DEPOIS = {};

  TELAS.geral = () => '<form id="formGeral" class="form-plano"><div class="campos">' + camposGeral().map(c => CRM.campoHTML(c, E().cfg[c.nome])).join('') + '</div>' +
    '<p><button type="submit" class="btn">Salvar configurações</button></p></form>';
  DEPOIS.geral = () => {
    const f = $('#formGeral');
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      try { await CRM.salvarConfig(CRM.lerForm(f, camposGeral())); CRM.toast('Configurações salvas.'); } catch (e) { CRM.falhou(e); }
    });
  };

  // ================================================================ Funil
  TELAS.funil = () => {
    const funis = CRM.funis();
    return '<p class="dica">A chance (%) de cada etapa entra no valor ponderado e na previsão de vendas. Ganho e perdido não são etapas: são o resultado do negócio.</p>' +
      funis.map(f => {
        const et = CRM.etapas(f);
        return '<section class="cartao"><h2>' + esc(f) + ' <button type="button" class="mini" data-acao="renomear-funil" data-id="' + esc(f) + '">renomear</button></h2>' +
          '<table class="tabela"><thead><tr><th>Ordem</th><th>Etapa</th><th class="num">Chance</th><th class="num">Negócios abertos</th><th></th></tr></thead><tbody>' +
          et.map((e, i) => {
            const n = E().D.negocios.filter(x => x.etapa_id === e.id && x.status === 'aberto').length;
            return '<tr><td>' + (i + 1) + '</td><td>' + esc(e.nome) + '</td><td class="num">' + e.probabilidade + '%</td><td class="num">' + n + '</td><td class="acoes-linha">' +
              '<button type="button" class="mini" data-acao="etapa-mover" data-id="' + esc(e.id) + ':-1"' + (i === 0 ? ' disabled' : '') + ' title="Subir">↑</button>' +
              '<button type="button" class="mini" data-acao="etapa-mover" data-id="' + esc(e.id) + ':1"' + (i === et.length - 1 ? ' disabled' : '') + ' title="Descer">↓</button>' +
              '<button type="button" class="mini" data-acao="etapa-editar" data-id="' + esc(e.id) + '">editar</button></td></tr>';
          }).join('') + '</tbody></table><p><button type="button" class="btn sec" data-acao="etapa-nova" data-id="' + esc(f) + '">+ Etapa</button></p></section>';
      }).join('') + '<p><button type="button" class="btn sec" data-acao="funil-novo">+ Outro funil</button> <small>(ex.: um funil para contratos e outro para pedidos avulsos)</small></p>';
  };

  function formEtapa(e, funil) {
    const outras = E().D.etapas.filter(x => !e || x.id !== e.id);
    CRM.abrirForm({
      titulo: e ? 'Editar etapa' : 'Nova etapa · ' + funil,
      campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true, largo: true }, { nome: 'probabilidade', rotulo: 'Chance de fechar (%)', tipo: 'numero', passo: '1', max: 100 }],
      valores: e || { probabilidade: 50 },
      aoSalvar: async v => {
        if (e) await CRM.atualizar('etapas', e.id, v);
        else await CRM.inserir('etapas', Object.assign({ funil, ordem: CRM.etapas(funil).reduce((m, x) => Math.max(m, x.ordem), 0) + 1 }, v));
      },
      aoExcluir: e ? async () => {
        const negs = E().D.negocios.filter(x => x.etapa_id === e.id);
        if (negs.length) {
          const destino = outras.filter(x => x.funil === e.funil).sort((a, b) => a.ordem - b.ordem)[0];
          if (!destino) throw new Error('é a única etapa do funil e tem negócios');
          if (!confirm(negs.length + ' negócio(s) estão nessa etapa e vão para "' + destino.nome + '". Continuar?')) return;
          await CRM.atualizarVarios('negocios', negs.map(x => x.id), { etapa_id: destino.id });
        }
        await CRM.remover('etapas', e.id);
      } : null
    });
  }

  // ================================================================ Listas
  TELAS.listas = () => [['origem', 'Origens de lead'], ['segmento', 'Segmentos'], ['motivo_perda', 'Motivos de perda']].map(([tipo, titulo]) => {
    const l = E().D.opcoes.filter(o => o.tipo === tipo).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));
    return '<section class="cartao"><h2>' + esc(titulo) + ' <small>' + l.length + '</small></h2><div class="etiquetas">' +
      l.map(o => '<span class="etiqueta-edit">' + esc(o.nome) + '<button type="button" class="mini" data-acao="opcao-editar" data-id="' + esc(o.id) + '" title="Editar">✎</button></span>').join('') +
      '</div><p><button type="button" class="btn sec" data-acao="opcao-nova" data-id="' + tipo + '">+ Adicionar</button>' +
      (tipo === 'segmento' ? ' <button type="button" class="btn sec" data-acao="segmentos-sugerir">Preencher pelo nome das empresas</button>' : '') + '</p>' +
      (tipo === 'segmento' ? '<p class="dica">Sugere o segmento de quem está sem (escola, indústria, condomínio, saúde…) pelo nome e pela razão social. Mostra quantas de cada antes de gravar; quem já tem segmento não muda.</p>' : '') +
      '</section>';
  }).join('');

  async function sugerirSegmentos() {
    const sem = E().D.empresas.filter(e => !e.segmento);
    const grupos = new Map();
    sem.forEach(e => { const s = R.sugereSegmento(e.nome, e.razao_social); if (s) { if (!grupos.has(s)) grupos.set(s, []); grupos.get(s).push(e.id); } });
    if (!grupos.size) { CRM.toast('Nenhuma sugestão: ' + sem.length + ' empresa(s) sem segmento e sem pista no nome.'); return; }
    const linhas = [...grupos.entries()].sort((a, b) => b[1].length - a[1].length).map(([s, l]) => s + ': ' + l.length);
    const total = [...grupos.values()].reduce((n, l) => n + l.length, 0);
    if (!confirm('Preencher o segmento de ' + total + ' de ' + sem.length + ' empresa(s) sem segmento?\n\n' + linhas.join('\n') +
      '\n\nAs outras ' + (sem.length - total) + ' ficam sem (o nome não dá pista). Dá para corrigir depois na ficha ou em massa na lista de Empresas.')) return;
    const existentes = new Set(E().D.opcoes.filter(o => o.tipo === 'segmento').map(o => o.nome));
    for (const s of grupos.keys()) if (!existentes.has(s)) await CRM.inserir('opcoes', { tipo: 'segmento', nome: s, ordem: R.NOMES_SEGMENTO.indexOf(s) + 1 });
    for (const [s, ids] of grupos) await CRM.atualizarVarios('empresas', ids, { segmento: s });
    CRM.toast('Segmento preenchido em ' + total + ' empresa(s).');
  }

  function formOpcao(o, tipo) {
    CRM.abrirForm({
      titulo: o ? 'Editar' : 'Adicionar',
      campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true, largo: true }, { nome: 'ordem', rotulo: 'Ordem na lista', tipo: 'numero', passo: '1' }],
      valores: o || { ordem: 50 },
      aoSalvar: async v => {
        if (o) {
          await CRM.atualizar('opcoes', o.id, v);
          if (v.nome !== o.nome) {
            // Renomear na base também (empresas/negócios que usam o nome antigo).
            const campo = { origem: 'origem', segmento: 'segmento', motivo_perda: 'motivo_perda' }[o.tipo];
            const tabs = o.tipo === 'motivo_perda' ? ['negocios'] : o.tipo === 'origem' ? ['empresas', 'negocios'] : ['empresas'];
            for (const t of tabs) await CRM.atualizarVarios(t, E().D[t].filter(x => x[campo] === o.nome).map(x => x.id), { [campo]: v.nome });
          }
        } else await CRM.inserir('opcoes', Object.assign({ tipo }, v));
      },
      aoExcluir: o ? () => CRM.remover('opcoes', o.id) : null,
      textoExcluir: 'Tirar da lista? (quem já usa continua com o nome gravado)'
    });
  }

  // ================================================================ Produtos
  TELAS.produtos = () => {
    const l = E().D.produtos.slice().sort((a, b) => (a.ativo === false) - (b.ativo === false) || a.nome.localeCompare(b.nome, 'pt-BR'));
    return '<div class="barra-acoes"><button type="button" class="btn ouro" data-acao="produto-novo">+ Produto</button>' +
      '<button type="button" class="btn sec" data-acao="ajustes-secao" data-id="importar">Importar planilha de produtos</button></div>' +
      (l.length ? '<div class="cartao sem-pad tabela-rolagem"><table class="tabela clicavel"><thead><tr><th>Produto</th><th>Código</th><th>Unidade</th><th>Categoria</th><th class="num">Preço</th><th></th></tr></thead><tbody>' +
        l.map(p => '<tr data-acao="produto-editar" data-id="' + esc(p.id) + '" tabindex="0" class="' + (p.ativo === false ? 'inativo' : '') + '"><td><strong>' + esc(p.nome) + '</strong></td><td>' + esc(p.codigo || '') + '</td><td>' + esc(p.unidade || '') +
          '</td><td>' + esc(p.categoria || '') + '</td><td class="num">' + esc(R.moeda(p.preco)) + '</td><td>' + (p.ativo === false ? CRM.selo('inativo', 'cinza') : '') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<div class="cartao"><p class="vazio">Nenhum produto. Cadastre aqui ou importe uma planilha — eles aparecem para escolher nos itens do negócio e na proposta.</p></div>');
  };

  function formProduto(p) {
    CRM.abrirForm({
      titulo: p ? 'Editar produto' : 'Novo produto',
      campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true, largo: true }, { nome: 'codigo', rotulo: 'Código / SKU' }, { nome: 'unidade', rotulo: 'Unidade', dica: 'cx, un, galão 5L…' },
        { nome: 'categoria', rotulo: 'Categoria', sugestoes: [...new Set(E().D.produtos.map(x => x.categoria).filter(Boolean))] }, { nome: 'preco', rotulo: 'Preço (R$)', tipo: 'numero' },
        { nome: 'ativo', rotulo: 'Ativo (aparece para escolher)', tipo: 'checkbox', largo: true }],
      valores: p || { ativo: true },
      aoSalvar: v => CRM.salvar('produtos', p && p.id, v),
      aoExcluir: p ? () => CRM.remover('produtos', p.id) : null,
      textoExcluir: 'Excluir o produto? (os negócios que já têm o item continuam com a descrição). Se ele só saiu de linha, prefira desmarcar "Ativo".'
    });
  }

  // ================================================================ Equipe
  TELAS.equipe = () => {
    const admin = CRM.ehAdmin();
    const l = E().D.usuarios.slice().sort((a, b) => (a.ativo === false) - (b.ativo === false) || a.nome.localeCompare(b.nome, 'pt-BR'));
    const carteira = id => E().D.empresas.filter(e => e.responsavel_id === id).length;
    const abertos = id => E().D.negocios.filter(n => n.responsavel_id === id && n.status === 'aberto').length;
    return '<p class="dica"><strong>Vendedor</strong> vê e mexe só na própria carteira (empresas em que é responsável ou tem negócio). <strong>Gestor</strong> vê a equipe toda, redistribui carteira, vê relatórios e configura. ' +
      '<strong>Administrador</strong> faz tudo isso e ainda cuida dos usuários. Isso é garantido no banco, não só na tela.</p>' +
      (admin ? '<div class="barra-acoes"><button type="button" class="btn ouro" data-acao="usuario-novo">+ Usuário</button>' +
        '<button type="button" class="btn sec" data-acao="transferir-carteira">Transferir carteira</button></div>' : '<p class="dica">Só o administrador altera usuários.</p>') +
      '<div class="cartao sem-pad tabela-rolagem"><table class="tabela' + (admin ? ' clicavel' : '') + '"><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Equipe</th><th>Rodízio</th><th class="num">Carteira</th><th class="num">Negócios abertos</th><th></th></tr></thead><tbody>' +
      l.map(u => '<tr' + (admin ? ' data-acao="usuario-editar" data-id="' + esc(u.user_id) + '" tabindex="0"' : '') + ' class="' + (u.ativo === false ? 'inativo' : '') + '"><td>' + CRM.avatar(u) + ' <strong>' + esc(u.nome) + '</strong></td>' +
        '<td>' + esc(u.email || '') + '</td><td>' + esc(R.rotulo(R.PAPEIS, u.papel)) + '</td><td>' + esc(u.equipe || '') + '</td><td>' + (u.recebe_leads ? 'recebe' : '—') + '</td>' +
        '<td class="num">' + carteira(u.user_id) + '</td><td class="num">' + abertos(u.user_id) + '</td><td>' + (u.ativo === false ? CRM.selo('desativado', 'cinza') : '') + '</td></tr>').join('') +
      '</tbody></table></div>';
  };

  function senhaProvisoria() {
    const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a = new Uint32Array(10); crypto.getRandomValues(a);
    return Array.from(a, x => c[x % c.length]).join('');
  }

  function formUsuario(u) {
    const sup = CRM.store().modo === 'supabase';
    const campos = [
      { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
      { nome: 'email', rotulo: 'E-mail (login)', tipo: 'email', obrigatorio: !u && sup, desabilitado: !!u && sup },
      { nome: 'papel', rotulo: 'Papel', tipo: 'select', opcoes: R.PAPEIS, padrao: 'vendedor' },
      { nome: 'equipe', rotulo: 'Equipe', dica: 'ex.: Interno, Externo, Campinas' },
      { nome: 'recebe_leads', rotulo: 'Recebe leads do rodízio', tipo: 'checkbox', largo: true },
      { nome: 'ativo', rotulo: 'Ativo (desmarcar tira o acesso na hora)', tipo: 'checkbox', largo: true }
    ];
    if (!u && sup) campos.push({ nome: 'senha', rotulo: 'Senha provisória', largo: true, padrao: senhaProvisoria(), ajuda: 'passe para a pessoa; ela troca em "Alterar minha senha"' });
    CRM.abrirForm({
      titulo: u ? 'Editar usuário' : 'Novo usuário', campos, valores: u || { ativo: true, recebe_leads: true, papel: 'vendedor' },
      rodape: u && sup ? '<button type="button" class="btn sec" id="btnSenha">Definir senha nova</button>' : '',
      extras: form => {
        const b = $('#btnSenha', form.closest('dialog'));
        if (b) b.addEventListener('click', async () => {
          const s = prompt('Senha nova para ' + u.nome + ' (mínimo 8 caracteres):', senhaProvisoria());
          if (!s) return;
          try { await CRM.store().adminUsuarios({ acao: 'senha', user_id: u.user_id, senha: s }); CRM.toast('Senha definida. Passe para a pessoa: ' + s); } catch (e) { CRM.falhou(e); }
        });
      },
      aoSalvar: async v => {
        if (u) {
          if (u.user_id === CRM.meuId() && (v.papel !== 'admin' || !v.ativo)) throw new Error('você não pode tirar o seu próprio acesso de administrador');
          delete v.email;
          await CRM.atualizar('usuarios', u.user_id, v);
          return;
        }
        if (sup) {
          if (!v.senha || v.senha.length < 8) throw new Error('senha provisória com pelo menos 8 caracteres');
          await CRM.store().adminUsuarios({ acao: 'criar', nome: v.nome, email: v.email, senha: v.senha, papel: v.papel, equipe: v.equipe, recebe_leads: v.recebe_leads, ativo: v.ativo });
          await CRM.recarregar();
          alert('Usuário criado.\n\nLogin: ' + v.email + '\nSenha provisória: ' + v.senha + '\n\nPasse para a pessoa (ela pode trocar depois).');
        } else {
          delete v.senha;
          await CRM.inserir('usuarios', Object.assign({ user_id: DD.uuid() }, v));
        }
      }
    });
  }

  function formTransferir() {
    CRM.abrirForm({
      titulo: 'Transferir carteira',
      intro: 'Passa as empresas, os negócios abertos e as tarefas pendentes de um vendedor para outro (ex.: quando alguém sai da equipe). O histórico fica como está.',
      campos: [{ nome: 'de', rotulo: 'De', tipo: 'select', opcoes: E().D.usuarios.map(u => [u.user_id, u.nome + (u.ativo === false ? ' (desativado)' : '')]), largo: true },
        { nome: 'para', rotulo: 'Para', tipo: 'select', opcoes: CRM.opcoesUsuarios(), largo: true }],
      salvarTexto: 'Transferir',
      aoSalvar: async v => {
        if (v.de === v.para) throw new Error('escolha pessoas diferentes');
        const emp = E().D.empresas.filter(e => e.responsavel_id === v.de).map(e => e.id);
        const neg = E().D.negocios.filter(n => n.responsavel_id === v.de && n.status === 'aberto').map(n => n.id);
        const tar = E().D.atividades.filter(a => a.responsavel_id === v.de && !a.concluida).map(a => a.id);
        if (!confirm('Transferir ' + emp.length + ' empresa(s), ' + neg.length + ' negócio(s) e ' + tar.length + ' tarefa(s) para ' + CRM.nomeUsuario(v.para) + '?')) return false;
        await CRM.atualizarVarios('empresas', emp, { responsavel_id: v.para });
        await CRM.atualizarVarios('negocios', neg, { responsavel_id: v.para });
        await CRM.atualizarVarios('atividades', tar, { responsavel_id: v.para });
        CRM.toast('Carteira transferida.');
      }
    });
  }

  // ================================================================ Metas
  let mesMeta = null;
  TELAS.metas = () => {
    mesMeta = mesMeta || CRM.hoje().slice(0, 8) + '01';
    const vend = CRM.usuariosAtivos();
    const meses = [-1, 0, 1, 2, 3].map(i => R.somaMeses(CRM.hoje().slice(0, 8) + '01', i));
    const vendido = id => E().D.negocios.filter(n => n.status === 'ganho' && n.responsavel_id === id && n.fechado_em && n.fechado_em.slice(0, 7) === mesMeta.slice(0, 7)).reduce((s, n) => s + R.num(n.valor), 0);
    const meta = id => { const m = E().D.metas.find(x => x.usuario_id === id && x.mes === mesMeta); return m ? m.valor : ''; };
    return '<form id="formMetas" class="form-plano"><p>Mês: <select id="mesMeta">' + CRM.opcoesHTML(meses.map(m => [m, R.mesCurto(m)]), mesMeta) + '</select></p>' +
      '<table class="tabela"><thead><tr><th>Vendedor</th><th class="num">Meta de vendas (R$)</th><th class="num">Vendido no mês</th><th>Atingido</th></tr></thead><tbody>' +
      vend.map(u => { const mt = meta(u.user_id), vd = vendido(u.user_id); return '<tr><td>' + esc(u.nome) + '</td><td class="num"><input type="number" min="0" step="100" name="m_' + esc(u.user_id) + '" value="' + esc(mt) + '" class="curto"></td>' +
        '<td class="num">' + esc(R.moeda(vd)) + '</td><td>' + (mt ? CRM.barra(vd, mt, R.pct(vd / mt * 100)) : '—') + '</td></tr>'; }).join('') +
      '</tbody></table><p><button type="submit" class="btn">Salvar metas</button></p></form>';
  };
  DEPOIS.metas = () => {
    $('#mesMeta').addEventListener('change', ev => { mesMeta = ev.target.value; CRM.render(); });
    $('#formMetas').addEventListener('submit', async ev => {
      ev.preventDefault();
      try {
        for (const u of CRM.usuariosAtivos()) {
          const el = ev.target.elements['m_' + u.user_id];
          const v = el.value === '' ? null : Number(el.value);
          const ex = E().D.metas.find(x => x.usuario_id === u.user_id && x.mes === mesMeta);
          if (ex && v == null) await CRM.remover('metas', ex.id);
          else if (ex && R.num(ex.valor) !== v) await CRM.atualizar('metas', ex.id, { valor: v });
          else if (!ex && v != null) await CRM.inserir('metas', { usuario_id: u.user_id, mes: mesMeta, valor: v });
        }
        CRM.toast('Metas salvas.');
      } catch (e) { CRM.falhou(e); }
    });
  };

  // ================================================================ Modelos
  TELAS.modelos = () => {
    const l = E().D.modelos.slice().sort((a, b) => a.canal.localeCompare(b.canal) || a.nome.localeCompare(b.nome, 'pt-BR'));
    return '<p class="dica">Aparecem ao clicar em WhatsApp ou E-mail na ficha. Variáveis: <code>{primeiro_nome}</code> <code>{contato}</code> <code>{empresa}</code> <code>{vendedor}</code> <code>{vendedor_primeiro_nome}</code> <code>{minha_empresa}</code> <code>{data}</code>. ' +
      'A mensagem enviada fica registrada sozinha no histórico do cliente.</p><div class="barra-acoes"><button type="button" class="btn ouro" data-acao="modelo-novo">+ Modelo</button></div>' +
      (l.length ? '<div class="cartao sem-pad"><table class="tabela clicavel"><thead><tr><th>Nome</th><th>Canal</th><th>Texto</th></tr></thead><tbody>' +
        l.map(m => '<tr data-acao="modelo-editar" data-id="' + esc(m.id) + '" tabindex="0"><td><strong>' + esc(m.nome) + '</strong></td><td>' + (m.canal === 'email' ? 'E-mail' : 'WhatsApp') + '</td><td><small>' + esc((m.assunto ? m.assunto + ' — ' : '') + m.corpo.slice(0, 140)) + '</small></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="cartao"><p class="vazio">Nenhum modelo ainda.</p></div>');
  };

  function formModelo(m) {
    CRM.abrirForm({
      titulo: m ? 'Editar modelo' : 'Novo modelo', largura: 'largo',
      campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true, dica: 'ex.: Apresentação, Follow-up de orçamento' }, { nome: 'canal', rotulo: 'Canal', tipo: 'select', opcoes: [['whatsapp', 'WhatsApp'], ['email', 'E-mail']] },
        { nome: 'assunto', rotulo: 'Assunto (e-mail)', largo: true }, { nome: 'corpo', rotulo: 'Texto', tipo: 'textarea', linhas: 7, obrigatorio: true, largo: true,
          dica: 'Olá {primeiro_nome}, tudo bem? Aqui é {vendedor_primeiro_nome}, da {minha_empresa}…' }],
      valores: m || { canal: 'whatsapp' },
      aoSalvar: v => CRM.salvar('modelos', m && m.id, v),
      aoExcluir: m ? () => CRM.remover('modelos', m.id) : null
    });
  }

  // ================================================================ Importar
  const TIPOS_IMPORT = [['empresas', 'Empresas / clientes'], ['contatos', 'Pessoas (contatos)'], ['negocios', 'Negócios'], ['atividades', 'Tarefas e histórico'], ['produtos', 'Produtos']];

  TELAS.importar = () => {
    if (imp && imp.etapa === 'mapear') return telaMapear();
    if (imp && imp.etapa === 'conferir') return telaConferir();
    if (imp && imp.etapa === 'rodando') return '<section class="cartao"><h2>Importando…</h2><p id="progressoImport">' + esc(imp.progresso || 'começando') + '</p><p class="dica">Não feche esta aba.</p></section>';
    if (imp && imp.etapa === 'fim') return telaFim();
    return '<section class="cartao"><h2>1. Do Agendor (recomendado para a migração)</h2>' +
      '<p>Traz empresas, pessoas, negócios (com etapas, itens e motivo de perda), tarefas e o histórico, sem duplicar se rodar de novo.</p>' +
      '<ol class="passos"><li>No computador do escritório, rode <code>node crm/ferramentas/agendor-exportar.js SEU_TOKEN</code> (o token fica no Agendor em Menu → Integrações).</li>' +
      '<li>Ele gera o arquivo <code>agendor-exportado-AAAA-MM-DD.json</code>. Escolha esse arquivo aqui:</li></ol>' +
      '<input type="file" id="arqAgendor" accept=".json,application/json"></section>' +
      '<section class="cartao"><h2>2. Notas fiscais (XML da NF-e)</h2><p>Traz as vendas faturadas: quem comprou, quando, quanto e quais produtos. Alimenta o relatório de faturamento ' +
      '(top clientes, produtos mais vendidos, vendas por segmento) e as "compras anteriores" de cada cliente.</p>' +
      '<p>Escolha os <strong>XML</strong> (pode selecionar vários de uma vez) ou o <strong>.zip</strong> que o sistema de notas ou a contabilidade exporta. ' +
      'Os XML de cancelamento, se vierem juntos, marcam a nota como cancelada.</p>' +
      '<input type="file" id="arqNotas" multiple accept=".xml,.zip,text/xml,application/xml,application/zip">' +
      '<p class="dica">O cliente é reconhecido pelo CNPJ, pela razão social ou pelo nome; se ainda não estiver no CRM, é cadastrado como cliente. Notas de entrada, de outra empresa e devoluções ficam de fora. Rodar de novo não duplica.</p></section>' +
      '<section class="cartao"><h2>3. Planilha (Excel ou CSV)</h2><p>Serve para a exportação em Excel do Agendor ou qualquer outra planilha. As colunas são reconhecidas pelo nome e você confere antes de importar.</p>' +
      '<p>O que tem na planilha: <select id="tipoImport">' + CRM.opcoesHTML(TIPOS_IMPORT, 'empresas') + '</select></p>' +
      '<input type="file" id="arqPlanilha" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">' +
      '<p class="dica">Ordem recomendada: produtos → empresas → pessoas → negócios → tarefas. Negócio ou pessoa de empresa que ainda não existe cria a empresa.</p></section>' +
      '<section class="cartao"><h2>4. Backup deste CRM</h2><p>Arquivo gerado em "Exportar e backup".' + (CRM.store().modo === 'local' ? ' No modo local, restaurar SUBSTITUI tudo o que está neste navegador.' : ' No banco, registros com o mesmo código são atualizados e nada é apagado.') + '</p>' +
      '<input type="file" id="arqBackup" accept=".json,application/json"></section>';
  };

  DEPOIS.importar = () => {
    const liga = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('change', () => { const f = el.files[0]; if (f) fn(f).catch(CRM.falhou); }); };
    liga('arqAgendor', async f => {
      const bruto = JSON.parse(await f.text());
      if (!bruto || !(bruto.organizations || bruto.deals || bruto.people)) throw new Error('este arquivo não parece o do exportador do Agendor');
      const tipos = P.converteAgendor(bruto);
      imp = { origem: 'Agendor', tipos, usuariosAgendor: tipos.usuarios, op: { responsavelPadrao: null, sobrescrever: false, mapaResponsaveis: {} } };
      planejar();
    });
    const arqNotas = $('#arqNotas');
    if (arqNotas) arqNotas.addEventListener('change', () => lerNotas([...arqNotas.files]).catch(CRM.falhou));
    liga('arqPlanilha', async f => {
      const tipo = $('#tipoImport').value;
      let linhas;
      if (/\.xlsx$/i.test(f.name)) {
        if (typeof DecompressionStream === 'undefined') throw new Error('este navegador não lê .xlsx; salve a planilha como CSV');
        linhas = (await window.CRMXlsx.lerXlsx(f)).linhas;
      } else {
        const buf = await f.arrayBuffer();
        let txt = new TextDecoder('utf-8').decode(buf);
        if (txt.indexOf('�') !== -1) txt = new TextDecoder('windows-1252').decode(buf); // CSV salvo pelo Excel em ANSI
        linhas = R.csvParse(txt);
      }
      if (linhas.length < 2) throw new Error('a planilha está vazia (precisa do cabeçalho e pelo menos uma linha)');
      const cab = linhas[0].map(c => String(c == null ? '' : c));
      imp = { origem: f.name, tipo, cab, linhas: linhas.slice(1), mapa: P.adivinhaMapeamento(tipo, cab), etapa: 'mapear', op: { responsavelPadrao: null, sobrescrever: false, mapaResponsaveis: {} } };
      CRM.render();
    });
    liga('arqBackup', async f => {
      const d = JSON.parse(await f.text());
      if (!d || d.formato !== 'sd-crm') throw new Error('este arquivo não é um backup deste CRM');
      const n = (d.empresas || []).length;
      if (!confirm(CRM.store().modo === 'local' ? 'Restaurar o backup com ' + n + ' empresa(s)? Isto SUBSTITUI tudo o que está neste navegador.' : 'Importar o backup com ' + n + ' empresa(s) para o banco?')) return;
      await CRM.store().restaurar(d, (t, i, tot) => CRM.toast('Restaurando ' + t + ': ' + i + '/' + tot));
      await CRM.recarregar();
      CRM.toast('Backup importado.');
    });
    const b = $('#btnConferir');
    if (b) b.addEventListener('click', () => {
      $$('[data-mapa]').forEach(s => { if (s.value) imp.mapa[s.dataset.mapa] = s.value; else delete imp.mapa[s.dataset.mapa]; });
      const obrig = P.OBRIGATORIO[imp.tipo];
      if (!Object.values(imp.mapa).includes(obrig)) { CRM.toast('Diga qual coluna é "' + P.CAMPOS[imp.tipo].find(c => c[0] === obrig)[1] + '".', true); return; }
      imp.tipos = { [imp.tipo]: P.registrosDaPlanilha(imp.linhas, imp.mapa) };
      planejar();
    });
    const bi = $('#btnImportar');
    if (bi) bi.addEventListener('click', executar);
    $$('[data-resp]').forEach(s => s.addEventListener('change', () => { imp.op.mapaResponsaveis[s.dataset.resp] = s.value; planejar(); }));
    const rp = $('#respPadrao'); if (rp) rp.addEventListener('change', () => { imp.op.responsavelPadrao = rp.value || null; planejar(); });
    const so = $('#sobrescrever'); if (so) so.addEventListener('change', () => { imp.op.sobrescrever = so.checked; planejar(); });
    const cp = $('#cadastrarProdutos'); if (cp) cp.addEventListener('change', () => { imp.op.cadastrarProdutos = cp.checked; planejar(); });
  };

  function telaMapear() {
    const campos = P.CAMPOS[imp.tipo];
    const amostra = i => imp.linhas.slice(0, 3).map(l => l[i]).filter(v => v !== '' && v != null).map(v => String(v).slice(0, 40)).join(' | ');
    return '<section class="cartao"><h2>Conferir colunas · ' + esc(imp.origem) + ' <small>' + imp.linhas.length + ' linha(s) de ' + esc(R.rotulo(TIPOS_IMPORT, imp.tipo).toLowerCase()) + '</small></h2>' +
      '<p class="dica">Diga o que é cada coluna. As reconhecidas já vêm marcadas; deixe "ignorar" no que não interessa.</p>' +
      '<table class="tabela mapa"><thead><tr><th>Coluna da planilha</th><th>Exemplos</th><th>Vai para</th></tr></thead><tbody>' +
      imp.cab.map((c, i) => '<tr><td><strong>' + esc(c || '(sem nome)') + '</strong></td><td><small>' + esc(amostra(i)) + '</small></td><td><select data-mapa="' + i + '">' +
        CRM.opcoesHTML([['', '— ignorar —']].concat(campos.map(x => [x[0], x[1]])), imp.mapa[i] || '') + '</select></td></tr>').join('') +
      '</tbody></table><p><button type="button" class="btn" id="btnConferir">Conferir o que vai acontecer</button> <button type="button" class="btn sec" data-acao="import-cancelar">Cancelar</button></p></section>';
  }

  async function lerNotas(arquivos) {
    if (!arquivos.length) return;
    const docs = [];
    let lidos = 0, outros = 0;
    const le = t => { lidos++; const d = N.lerXml(t); if (d) docs.push(d); else outros++; };
    CRM.toast('Lendo ' + arquivos.length + ' arquivo(s)…');
    for (const f of arquivos) {
      if (/\.zip$/i.test(f.name)) {
        if (typeof DecompressionStream === 'undefined') throw new Error('este navegador não abre .zip; descompacte e escolha os XML');
        (await window.CRMXlsx.lerZipTextos(f, /\.xml$/i)).forEach(x => le(x.texto));
      } else le(await f.text());
    }
    if (!docs.length) throw new Error('nenhuma NF-e encontrada (' + lidos + ' arquivo(s) lido(s)). Confira se são os XML das notas.');
    imp = { origem: 'Notas fiscais', notas: docs, arquivosLidos: lidos, arquivosOutros: outros, op: { responsavelPadrao: null, cadastrarProdutos: true, mapaResponsaveis: {} } };
    planejar();
  }

  function planejar() {
    imp.plano = imp.notas ? N.planeja(E().D, imp.notas, imp.op) : P.planeja(E().D, imp.tipos, imp.op);
    imp.etapa = 'conferir';
    CRM.render();
  }

  const NOMES_IMPORT = { opcoes: 'itens de lista', etapas: 'etapas do funil', produtos: 'produtos', empresas: 'empresas', contatos: 'pessoas', negocios: 'negócios', negocio_itens: 'itens de negócio', atividades: 'tarefas/histórico', notas: 'notas fiscais', nota_itens: 'itens das notas' };

  function resumoNotas() {
    const r = imp.plano.resumoNotas;
    if (!r) return '';
    const fora = [[r.jaImportadas, 'já importada(s) antes'], [r.canceladas, 'cancelada(s) (entram marcadas, fora dos totais)'], [r.entradas, 'de entrada (compra)'],
      [r.deOutraEmpresa, 'emitida(s) por outra empresa'], [r.devolucoes, 'de devolução'], [r.naoAutorizadas, 'não autorizada(s) pela SEFAZ']].filter(x => x[0]);
    return '<div class="aviso-notas"><p><strong>' + r.novas + ' nota(s) nova(s)</strong>' + (r.valor ? ' · <strong>' + esc(R.moeda(r.valor)) + '</strong>' : '') +
      (r.de ? ' · de ' + esc(R.dataBR(r.de)) + ' a ' + esc(R.dataBR(r.ate)) : '') +
      (r.emitente ? '<br><small>Emitente: ' + esc(r.emitente.nome) + ' · ' + esc(r.emitente.doc) + ' · ' + imp.arquivosLidos + ' arquivo(s) lido(s)' +
        (imp.arquivosOutros ? ', ' + imp.arquivosOutros + ' sem NF-e' : '') + '</small>' : '') + '</p><ul>' +
      '<li>' + r.empresasLigadas + ' cliente(s) já cadastrado(s) reconhecido(s)' + (r.cnpjsCompletados ? ', ' + r.cnpjsCompletados + ' com o CNPJ completado agora' : '') + '</li>' +
      '<li>' + r.empresasNovas + ' cliente(s) novo(s) serão cadastrados como "cliente", com o segmento sugerido pelo nome</li>' +
      (r.produtosNovos ? '<li>' + r.produtosNovos + ' produto(s) novo(s) no catálogo (código, nome e último preço)</li>' : '') +
      fora.map(x => '<li>' + x[0] + ' ' + esc(x[1]) + '</li>').join('') + '</ul>' +
      '<label class="campo check"><input type="checkbox" id="cadastrarProdutos"' + (imp.op.cadastrarProdutos !== false ? ' checked' : '') + '> Cadastrar no catálogo de produtos os itens que ainda não estão lá</label></div>';
  }

  function telaConferir() {
    const pl = imp.plano;
    const nomes = NOMES_IMPORT;
    const linhas = Object.keys(nomes).map(t => {
      const c = pl.contagem[t] || { criados: pl.criar[t] ? pl.criar[t].length : 0, atualizados: 0, ignorados: 0 };
      const criar = pl.criar[t] ? pl.criar[t].length : 0;
      const atualiza = pl.atualizar.filter(a => a.tabela === t).length;
      if (!criar && !atualiza && !c.ignorados) return '';
      return '<tr><td>' + esc(nomes[t]) + '</td><td class="num">' + criar + '</td><td class="num">' + atualiza + '</td><td class="num">' + (c.ignorados || 0) + '</td></tr>';
    }).join('');
    const opts = CRM.opcoesUsuarios();
    return '<section class="cartao"><h2>O que vai acontecer · ' + esc(imp.origem) + '</h2>' + resumoNotas() +
      '<table class="tabela"><thead><tr><th></th><th class="num">Criar</th><th class="num">Completar existentes</th><th class="num">Ignorar</th></tr></thead><tbody>' + (linhas || '<tr><td colspan="4">Nada a fazer (tudo já existe).</td></tr>') + '</tbody></table>' +
      '<div class="campos"><label class="campo"><span>' + (imp.notas ? 'Clientes novos (que ainda não estão no CRM) ficam com' : 'Quem não tiver responsável (ou não for reconhecido) fica com') + '</span><select id="respPadrao">' + CRM.opcoesHTML([['', '(sem responsável — só gestores veem)']].concat(opts), imp.op.responsavelPadrao || '') + '</select></label>' +
      (imp.notas ? '' : '<label class="campo check"><input type="checkbox" id="sobrescrever"' + (imp.op.sobrescrever ? ' checked' : '') + '> Sobrescrever dados já preenchidos (padrão: só completa o que está vazio)</label>') + '</div>' +
      (pl.semResponsavel.length ? '<h3>Responsáveis que não reconheci</h3><p class="dica">Crie os usuários antes (Equipe e permissões) ou diga para quem vai a carteira de cada um:</p><table class="tabela"><tbody>' +
        pl.semResponsavel.map(s => '<tr><td>' + esc(s.nome) + ' <small>(' + s.qtd + ' registro(s))</small></td><td><select data-resp="' + esc(R.normaliza(s.nome)) + '">' +
          CRM.opcoesHTML([['', '(responsável padrão acima)']].concat(opts), imp.op.mapaResponsaveis[R.normaliza(s.nome)] || '') + '</select></td></tr>').join('') + '</tbody></table>' : '') +
      (pl.ignorados.length ? '<p class="dica">' + pl.ignorados.length + (imp.notas ? ' nota(s) ficam de fora (motivos acima).' : ' linha(s) serão ignoradas (sem nome, sem empresa ou já importadas).') + ' <button type="button" class="link" data-acao="import-ignorados">baixar a lista</button></p>' : '') +
      '<p><button type="button" class="btn ouro" id="btnImportar">Importar agora</button> <button type="button" class="btn sec" data-acao="import-cancelar">Cancelar</button></p></section>';
  }

  async function executar() {
    const pl = imp.plano;
    imp.etapa = 'rodando';
    CRM.render();
    const prog = t => { imp.progresso = t; const el = $('#progressoImport'); if (el) el.textContent = t; };
    const ordem = ['opcoes', 'etapas', 'produtos', 'empresas', 'contatos', 'negocios', 'negocio_itens', 'atividades', 'notas', 'nota_itens'];
    const inicio = Date.now();
    imp.resultado = { criados: {}, atualizados: 0, erros: [] };
    try {
      for (const t of ordem) {
        const l = pl.criar[t] || [];
        if (!l.length) continue;
        const gravados = await CRM.inserirVarios(t, l, (i, tot) => prog('Gravando ' + (NOMES_IMPORT[t] || t) + ': ' + i + ' de ' + tot),
          (o, e) => imp.resultado.erros.push((NOMES_IMPORT[t] || t) + ' "' + (o.nome || o.titulo || o.descricao || o.id || '') + '": ' + (e.message || e)));
        imp.resultado.criados[t] = gravados.length;
      }
      let i = 0;
      const fila = pl.atualizar.slice();
      const trabalhador = async () => {
        while (fila.length) {
          const a = fila.shift();
          try { await CRM.store().atualizar(a.tabela, a.id, a.patch); imp.resultado.atualizados++; } catch (e) { imp.resultado.erros.push(a.tabela + ' ' + a.id + ': ' + e.message); }
          if (++i % 25 === 0) prog('Completando cadastros existentes: ' + i + ' de ' + pl.atualizar.length);
        }
      };
      await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
      await CRM.recarregar();
    } catch (e) {
      imp.resultado.erros.push(e.message);
      await CRM.recarregar(true);
    }
    imp.resultado.segundos = Math.round((Date.now() - inicio) / 1000);
    imp.etapa = 'fim';
    CRM.render();
  }

  function telaFim() {
    const r = imp.resultado;
    return '<section class="cartao"><h2>' + (r.erros.length ? 'Importação terminou com problemas' : 'Importação concluída ✔') + '</h2><ul>' +
      Object.keys(r.criados).map(t => '<li>' + esc(NOMES_IMPORT[t] || t) + ': ' + r.criados[t] + ' gravados</li>').join('') + '<li>' + r.atualizados + ' cadastros completados</li>' +
      '<li>' + imp.plano.ignorados.length + ' linhas ignoradas</li><li>' + r.segundos + ' segundos</li></ul>' +
      (r.erros.length ? '<h3>Erros</h3><pre class="erros">' + esc(r.erros.slice(0, 50).join('\n')) + '</pre><p class="dica">Rodar a mesma importação de novo é seguro: o que já entrou não duplica.</p>' : '') +
      '<p><button type="button" class="btn" data-acao="import-cancelar">Fazer outra importação</button> <button type="button" class="btn sec" data-acao="aba" data-id="empresas">Ver empresas</button></p></section>';
  }

  // ================================================================ Exportar
  TELAS.exportar = () => '<section class="cartao"><h2>Backup completo</h2><p>Um arquivo JSON com tudo (empresas, pessoas, negócios, itens, propostas, histórico, configurações). Guarde uma cópia de vez em quando, principalmente antes de importações grandes.</p>' +
    '<p><button type="button" class="btn" data-acao="backup">Baixar backup completo</button></p></section>' +
    '<section class="cartao"><h2>Planilhas (Excel)</h2><p>Cada lista (Empresas, Pessoas, Negócios) tem o botão <strong>Exportar</strong>, que baixa exatamente o que está filtrado na tela. Aqui, tudo de uma vez:</p>' +
    '<p><button type="button" class="btn sec" data-acao="exportar-tudo" data-id="empresas">Empresas</button> <button type="button" class="btn sec" data-acao="exportar-tudo" data-id="pessoas">Pessoas</button> ' +
    '<button type="button" class="btn sec" data-acao="exportar-tudo" data-id="negocios">Negócios</button> <button type="button" class="btn sec" data-acao="exportar-tudo" data-id="atividades">Tarefas e histórico</button></p></section>';

  function backup() {
    const conteudo = Object.assign({ formato: 'sd-crm', versao: 2, exportado_em: new Date().toISOString(), instalacao: CRM.nomeInstalacao() }, E().D);
    CRM.baixar('crm-backup-' + CRM.hoje() + '.json', JSON.stringify(conteudo), 'application/json');
  }

  // ================================================================ Duplicados
  TELAS.duplicados = () => {
    const ge = R.duplicadosEmpresas(E().D.empresas);
    const gc = R.duplicadosContatos(E().D.contatos);
    const bloco = (g, tipo) => '<div class="grupo-dup" data-grupo>' + g.map((x, i) => '<label class="check"><input type="radio" name="dup_' + tipo + '_' + esc(g[0].id) + '" value="' + esc(x.id) + '"' + (i === 0 ? ' checked' : '') + '> ' +
      (tipo === 'e' ? '<strong>' + esc(x.nome) + '</strong> <small>' + esc([x.cnpj, x.cidade, CRM.nomeUsuario(x.responsavel_id), CRM.doEmpresa('negocios', x.id).length + ' negócio(s)', CRM.doEmpresa('atividades', x.id).length + ' atividade(s)'].filter(Boolean).join(' · ')) + '</small>'
        : '<strong>' + esc(x.nome) + '</strong> <small>' + esc([CRM.nomeEmpresa(x.empresa_id), x.email, x.whatsapp || x.celular || x.telefone].filter(Boolean).join(' · ')) + '</small>') + '</label>').join('') +
      '<button type="button" class="btn sec" data-acao="mesclar" data-id="' + tipo + ':' + g.map(x => x.id).join(',') + '">Mesclar no marcado</button></div>';
    return '<p class="dica">Encontrados pelo mesmo CNPJ, nome parecido (sem acento, sem "Ltda/ME"), e-mail ou telefone. Mesclar junta tudo no cadastro marcado (pessoas, negócios, histórico) e apaga os outros. Confira antes: não tem volta.</p>' +
      '<section class="cartao"><h2>Empresas <small>' + ge.length + ' grupo(s)</small></h2>' + (ge.length ? ge.slice(0, 60).map(g => bloco(g, 'e')).join('') : '<p class="vazio">Nenhuma empresa duplicada. 👍</p>') + '</section>' +
      '<section class="cartao"><h2>Pessoas <small>' + gc.length + ' grupo(s)</small></h2>' + (gc.length ? gc.slice(0, 60).map(g => bloco(g, 'c')).join('') : '<p class="vazio">Nenhuma pessoa duplicada. 👍</p>') + '</section>';
  };

  async function mesclar(id, el) {
    const [tipo, lista] = id.split(':');
    const ids = lista.split(',');
    const marcado = (el.closest('[data-grupo]').querySelector('input:checked') || {}).value || ids[0];
    const outros = ids.filter(x => x !== marcado);
    if (tipo === 'e') {
      const alvo = CRM.empresa(marcado);
      if (!confirm('Juntar ' + outros.length + ' cadastro(s) em "' + alvo.nome + '" e apagar os outros?')) return;
      const s = new Set(outros);
      const patch = R.mesclaCampos(alvo, outros.map(CRM.empresa), ['nome', 'responsavel_id', 'situacao']);
      if (Object.keys(patch).length) await CRM.atualizar('empresas', marcado, patch);
      for (const t of ['contatos', 'negocios', 'atividades', 'notas']) await CRM.atualizarVarios(t, E().D[t].filter(x => s.has(x.empresa_id)).map(x => x.id), { empresa_id: marcado });
      await CRM.removerVarios('empresas', outros);
      await CRM.auto.sistema(marcado, null, 'Cadastros mesclados neste: ' + outros.length);
    } else {
      const alvo = CRM.contato(marcado);
      if (!confirm('Juntar ' + outros.length + ' pessoa(s) em "' + alvo.nome + '"?')) return;
      const s = new Set(outros);
      const patch = R.mesclaCampos(alvo, outros.map(CRM.contato), ['nome', 'empresa_id', 'principal']);
      if (Object.keys(patch).length) await CRM.atualizar('contatos', marcado, patch);
      await CRM.atualizarVarios('negocios', E().D.negocios.filter(x => s.has(x.contato_id)).map(x => x.id), { contato_id: marcado });
      await CRM.atualizarVarios('atividades', E().D.atividades.filter(x => s.has(x.contato_id)).map(x => x.id), { contato_id: marcado });
      await CRM.removerVarios('contatos', outros);
    }
    CRM.toast('Mesclado.');
  }

  // ================================================================ Histórico
  let historico = null;
  TELAS.historico = () => {
    if (CRM.store().modo === 'local') return '<div class="cartao"><p class="vazio">O histórico de alterações é gravado pelo banco (Supabase). No modo local ele não existe.</p></div>';
    if (!historico) { setTimeout(carregaHistorico, 0); return '<div class="cartao"><p class="vazio">Carregando…</p></div>'; }
    return '<p class="dica">Toda criação, alteração e exclusão de empresa, pessoa, negócio, proposta, usuário, etapa e produto — quem fez e o que mudou. Os 300 mais recentes. <button type="button" class="link" data-acao="historico-atualizar">atualizar</button></p>' +
      '<div class="cartao">' + ajustes.htmlHistorico(historico) + '</div>';
  };
  async function carregaHistorico() { try { historico = await CRM.store().historico({ limite: 300 }); CRM.render(); } catch (e) { CRM.falhou(e); } }

  const NOMES_TAB = { crm_empresas: 'Empresa', crm_contatos: 'Pessoa', crm_negocios: 'Negócio', crm_propostas: 'Proposta', crm_usuarios: 'Usuário', crm_etapas: 'Etapa', crm_produtos: 'Produto' };
  ajustes.htmlHistorico = l => {
    if (!l || !l.length) return '<p class="vazio">Nenhuma alteração registrada.</p>';
    const fmt = v => (v == null ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 80);
    const nomeDe = h => { const t = h.tabela.replace('crm_', ''); const r = t === 'usuarios' ? CRM.usuario(h.registro_id) : E().ix.porId[t] && E().ix.porId[t].get(h.registro_id); return r ? (r.nome || r.titulo || (r.numero ? '#' + r.numero : '')) : (h.mudancas && (h.mudancas.nome || h.mudancas.titulo)) || ''; };
    return '<table class="tabela historico"><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Mudanças</th></tr></thead><tbody>' + l.map(h => '<tr><td>' + esc(R.dataHoraBR(h.quando)) + '</td><td>' + esc(CRM.nomeUsuario(h.usuario_id)) + '</td>' +
      '<td>' + esc((NOMES_TAB[h.tabela] || h.tabela) + ' ' + ({ insert: 'criada(o)', update: 'alterada(o)', delete: 'excluída(o)' }[h.acao] || h.acao)) + '<small>' + esc(nomeDe(h)) + '</small></td>' +
      '<td><small>' + (h.acao === 'update' && h.mudancas ? Object.keys(h.mudancas).map(k => esc(k) + ': ' + esc(fmt(h.mudancas[k][0])) + ' → ' + esc(fmt(h.mudancas[k][1]))).join('<br>') : h.acao === 'delete' ? 'registro apagado' : '') + '</small></td></tr>').join('') + '</tbody></table>';
  };

  // ================================================================ modo local: exemplos
  ajustes.apagarTudoLocal = async () => {
    if (!confirm('Apagar TODOS os dados do CRM deste navegador? Baixe um backup antes se precisar.')) return;
    await CRM.store().restaurar(DD.vazio());
    await CRM.recarregar();
  };

  ajustes.carregarExemplos = async () => {
    if (E().D.empresas.length && !confirm('Isto SUBSTITUI os dados deste navegador por dados de exemplo. Continuar?')) return;
    const h = CRM.hoje(), id = DD.uuid, D = DD.vazio();
    const iso = (d, hr) => R.momento(R.somaDias(h, d), hr || '10:00');
    const eu = DD.LOCAL_ADMIN;
    D.usuarios = [{ user_id: eu, nome: 'Administrador (modo local)', papel: 'admin', ativo: true, recebe_leads: false },
      { user_id: id(), nome: 'Ana Vendedora', email: 'ana@exemplo', papel: 'vendedor', ativo: true, recebe_leads: true },
      { user_id: id(), nome: 'Bruno Vendedor', email: 'bruno@exemplo', papel: 'vendedor', ativo: true, recebe_leads: true }];
    const [, ana, bruno] = D.usuarios.map(u => u.user_id);
    const etapas = R.ETAPAS_PADRAO.map((e, i) => ({ id: id(), funil: 'Vendas', nome: e[0], probabilidade: e[1], ordem: i + 1 }));
    D.etapas = etapas;
    Object.keys(R.OPCOES_PADRAO).forEach(t => R.OPCOES_PADRAO[t].forEach((n, i) => D.opcoes.push({ id: id(), tipo: t, nome: n, ordem: i })));
    ['Condomínio', 'Escritório', 'Restaurante', 'Indústria', 'Hotel', 'Clínica', 'Escola'].forEach((n, i) => D.opcoes.push({ id: id(), tipo: 'segmento', nome: n, ordem: i }));
    D.config = [{ id: 1, dados: { nome_empresa: 'Empresa Exemplo' } }];
    const prods = [['Detergente neutro 5L', 'DET5', 'galão', 28.9], ['Papel toalha interfolha (cx 2400 fl)', 'PTI', 'caixa', 64.5], ['Saco de lixo 100L (pct 100)', 'SL100', 'pacote', 39.9],
      ['Copo descartável 180ml (cx 2500)', 'CP180', 'caixa', 89], ['Álcool 70% 5L', 'ALC5', 'galão', 42]].map(p => ({ id: id(), nome: p[0], codigo: p[1], unidade: p[2], preco: p[3], ativo: true }));
    D.produtos = prods;
    D.modelos = [{ id: id(), nome: 'Apresentação', canal: 'whatsapp', corpo: 'Olá {primeiro_nome}, tudo bem? Aqui é {vendedor_primeiro_nome}, da {minha_empresa}. Trabalhamos com produtos de limpeza e descartáveis com entrega programada. Posso te mandar nosso catálogo?' },
      { id: id(), nome: 'Follow-up de orçamento', canal: 'whatsapp', corpo: 'Oi {primeiro_nome}! Conseguiu dar uma olhada no orçamento que enviei para a {empresa}? Fico à disposição para ajustar quantidades.' },
      { id: id(), nome: 'Envio de proposta', canal: 'email', assunto: 'Proposta {minha_empresa} para {empresa}', corpo: 'Olá {primeiro_nome},\n\nSegue a nossa proposta conforme conversamos.\n\nAbraço,\n{vendedor}' }];
    const emp = (nome, seg, cidade, sit, resp, origem, dias, extra) => { const e = Object.assign({ id: id(), nome, segmento: seg, cidade, uf: 'SP', situacao: sit, responsavel_id: resp, origem, qualificacao: 3, tags: [], criado_em: iso(dias) }, extra || {}); D.empresas.push(e); return e.id; };
    const ctt = (e, nome, cargo, tel) => D.contatos.push({ id: id(), empresa_id: e, nome, cargo, whatsapp: tel, principal: true, tags: [] });
    const neg = (e, titulo, et, valor, resp, status, extra) => { const n = Object.assign({ id: id(), empresa_id: e, titulo, etapa_id: etapas[et].id, valor, responsavel_id: resp, status, criado_em: iso(-30), etapa_desde: iso(-5) }, extra || {}); D.negocios.push(n); return n.id; };
    const atv = (e, tipo, desc, dias, feita, resp, extra) => D.atividades.push(Object.assign({ id: id(), empresa_id: e, tipo, descricao: desc, data_hora: iso(dias, '10:30'), concluida: feita, concluida_em: feita ? iso(dias, '10:40') : null, responsavel_id: resp }, extra || {}));

    const a = emp('Condomínio Parque das Flores (exemplo)', 'Condomínio', 'Campinas', 'cliente', ana, 'Indicação', -200, { ciclo_recompra_dias: 30, tags: ['contrato mensal'] });
    ctt(a, 'Sr. Carlos (exemplo)', 'Síndico', '(19) 90000-0001');
    const n1 = neg(a, 'Reposição mensal — agosto', 4, 1850, ana, 'ganho', { fechado_em: R.somaDias(h, -32) });
    D.negocio_itens.push({ id: id(), negocio_id: n1, produto_id: prods[1].id, descricao: prods[1].nome, quantidade: 20, preco: 64.5, desconto: 5, ordem: 0 }, { id: id(), negocio_id: n1, produto_id: prods[2].id, descricao: prods[2].nome, quantidade: 15, preco: 39.9, desconto: 0, ordem: 1 });
    neg(a, 'Reposição mensal — julho', 4, 1720, ana, 'ganho', { fechado_em: R.somaDias(h, -63) });
    atv(a, 'whatsapp', 'Confirmou recebimento, tudo certo.', -28, true, ana);

    const b = emp('Restaurante Sabor da Casa (exemplo)', 'Restaurante', 'Valinhos', 'prospect', bruno, 'Instagram', -20);
    ctt(b, 'Juliana (exemplo)', 'Gerente', '(19) 90000-0002');
    neg(b, 'Descartáveis para delivery', 3, 3200, bruno, 'aberto', { previsao_fechamento: R.somaDias(h, 7) });
    atv(b, 'visita', 'Visitei e levei amostras de copos e embalagens.', -6, true, bruno);
    atv(b, 'ligacao', 'Ligar para saber se aprovou o orçamento', 0, false, bruno);

    const c = emp('Clínica Bem Estar (exemplo)', 'Clínica', 'Campinas', 'lead', ana, 'Site', -2);
    ctt(c, 'Dra. Paula (exemplo)', 'Diretora', '(19) 90000-0003');
    atv(c, 'ligacao', 'Fazer o primeiro contato', -1, false, ana);

    const d = emp('Indústria Metal Forte (exemplo)', 'Indústria', 'Sumaré', 'prospect', bruno, 'Prospecção ativa', -60);
    neg(d, 'Kit limpeza fábrica', 2, 7800, bruno, 'aberto', { etapa_desde: iso(-25), criado_em: iso(-40) });
    atv(d, 'reuniao', 'Reunião com compras: querem cotação para 3 galpões.', -26, true, bruno);

    const e5 = emp('Escola Aprender (exemplo)', 'Escola', 'Indaiatuba', 'lead', null, 'Feira/Evento', 0);
    ctt(e5, 'Roberto (exemplo)', 'Coordenador', '(19) 90000-0005');
    const f = emp('Hotel Central (exemplo)', 'Hotel', 'Campinas', 'prospect', ana, 'Google', -50);
    neg(f, 'Amenities e limpeza', 3, 5400, ana, 'perdido', { motivo_perda: 'Preço', fechado_em: R.somaDias(h, -10) });
    D.metas = [{ id: id(), usuario_id: ana, mes: h.slice(0, 8) + '01', valor: 8000 }, { id: id(), usuario_id: bruno, mes: h.slice(0, 8) + '01', valor: 8000 }];

    await CRM.store().restaurar(D);
    await CRM.recarregar();
    CRM.toast('Dados de exemplo carregados.');
  };

  // ================================================================ ações
  Object.assign(CRM.acoes, {
    'ajustes-secao': id => { secao = id; CRM.gravaPref('ajustes', id); if (id === 'historico') historico = null; if (E().aba !== 'ajustes') CRM.irPara('ajustes'); else CRM.render(); },
    'etapa-nova': f => formEtapa(null, f),
    'etapa-editar': id => formEtapa(CRM.etapa(id)),
    'etapa-mover': async id => {
      const [eid, dir] = id.split(':');
      const e = CRM.etapa(eid);
      const l = CRM.etapas(e.funil);
      const i = l.findIndex(x => x.id === eid), j = i + Number(dir);
      if (j < 0 || j >= l.length) return;
      const troca = l.slice(); [troca[i], troca[j]] = [troca[j], troca[i]];
      try { for (let k = 0; k < troca.length; k++) if (troca[k].ordem !== k + 1) await CRM.store().atualizar('etapas', troca[k].id, { ordem: k + 1 }); await CRM.recarregar(); } catch (x) { CRM.falhou(x); }
    },
    'renomear-funil': f => CRM.abrirForm({ titulo: 'Renomear funil', campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true, largo: true }], valores: { nome: f },
      aoSalvar: v => CRM.atualizarVarios('etapas', CRM.etapas(f).map(e => e.id), { funil: v.nome }) }),
    'funil-novo': () => CRM.abrirForm({ titulo: 'Novo funil', intro: 'Cria o funil com uma primeira etapa; depois acrescente as outras.', campos: [{ nome: 'funil', rotulo: 'Nome do funil', obrigatorio: true, largo: true }, { nome: 'nome', rotulo: 'Primeira etapa', obrigatorio: true, largo: true }],
      aoSalvar: v => CRM.inserir('etapas', { funil: v.funil, nome: v.nome, ordem: 1, probabilidade: 10 }) }),
    'opcao-nova': t => formOpcao(null, t),
    'segmentos-sugerir': () => sugerirSegmentos().catch(CRM.falhou),
    'opcao-editar': id => formOpcao(E().D.opcoes.find(o => o.id === id)),
    'produto-novo': () => formProduto(null),
    'produto-editar': id => formProduto(CRM.produto(id)),
    'usuario-novo': () => formUsuario(null),
    'usuario-editar': id => formUsuario(CRM.usuario(id)),
    'transferir-carteira': formTransferir,
    'modelo-novo': () => formModelo(null),
    'modelo-editar': id => formModelo(E().D.modelos.find(m => m.id === id)),
    'import-cancelar': () => { imp = null; CRM.render(); },
    'import-ignorados': () => CRM.baixarCSV('importacao-ignorados', ['Tipo', 'Linha', 'Motivo', 'Dados'], imp.plano.ignorados.map(i => [i.tipo, i.linha || '', i.motivo, JSON.stringify(i.registro)])),
    backup,
    'exportar-tudo': t => {
      if (t === 'atividades') {
        CRM.baixarCSV('atividades', ['Empresa', 'Tipo', 'Descrição', 'Data', 'Concluída', 'Concluída em', 'Responsável', 'Negócio'],
          E().D.atividades.map(a => [CRM.nomeEmpresa(a.empresa_id), R.rotulo(R.TIPOS_ATIVIDADE, a.tipo), a.descricao, R.dataHoraBR(a.data_hora), a.concluida ? 'sim' : 'não', R.dataHoraBR(a.concluida_em), CRM.nomeUsuario(a.responsavel_id), (CRM.negocio(a.negocio_id) || {}).titulo]));
        return;
      }
      const f = E().filtros[t]; E().filtros[t] = { status: '' };
      CRM.acoes['exportar-lista'](t);
      E().filtros[t] = f;
    },
    mesclar: (id, el) => mesclar(id, el).catch(CRM.falhou),
    'historico-atualizar': () => { historico = null; CRM.render(); }
  });
})();
