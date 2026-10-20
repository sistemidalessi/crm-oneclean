/* CRM Sistemi Dalessi — camada de dados.
   Duas implementações com a mesma interface:
   - Local: localStorage deste navegador (experimentar/demonstração; um
     usuário "administrador local"; os dados NÃO saem deste computador).
   - Supabase: o modo de verdade. Quem protege os dados é a RLS
     (crm/supabase/schema.sql), não o app.
   Todas as operações devolvem Promise. */
(function (raiz) {
  'use strict';

  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);

  // Ordem importa: pais antes de filhos (importação/upsert respeita as FKs).
  const TABELAS = ['usuarios', 'config', 'etapas', 'opcoes', 'produtos', 'modelos', 'metas', 'filtros',
    'empresas', 'contatos', 'negocios', 'negocio_itens', 'propostas', 'atividades', 'notas', 'nota_itens', 'titulos', 'email_campanhas', 'email_envios', 'ofertas'];
  // Financeiro (contas a pagar e caixa): só o administrador; carregado à parte, ao abrir o Caixa.
  const FIN = ['fin_recorrentes', 'fin_lancamentos', 'fin_saldos', 'fin_regras', 'fin_titulos_baixados', 'fin_excluidos'];
  // Boletos atualizados da cobrança (14/10/2026): carregados à parte (poucos, e o comprador não lê).
  const A_PARTE = ['boletos'];
  const CHAVE = { usuarios: 'user_id' };
  const chave = t => CHAVE[t] || 'id';

  function vazio() { const d = {}; TABELAS.forEach(t => { d[t] = []; }); return d; }
  const finVazio = d => ({ recorrentes: (d && d.fin_recorrentes) || [], lancamentos: (d && d.fin_lancamentos) || [], saldos: (d && d.fin_saldos) || [], regras: (d && d.fin_regras) || [],
    baixados: (d && d.fin_titulos_baixados) || [], excluidos: (d && d.fin_excluidos) || [] });

  function uuid() {
    if (raiz.crypto && raiz.crypto.randomUUID) return raiz.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // Valores padrão das colunas (espelho do schema.sql) para o modo local.
  const PADROES = {
    empresas: { situacao: 'lead', qualificacao: 0, tags: [] },
    contatos: { principal: false, tags: [] },
    negocios: { status: 'aberto', valor: 0 },
    negocio_itens: { quantidade: 1, preco: 0, desconto: 0, ordem: 0 },
    propostas: { status: 'rascunho', itens: [], valor_total: 0 },
    atividades: { tipo: 'tarefa', concluida: false, automatica: false },
    usuarios: { papel: 'vendedor', ativo: true, recebe_leads: true },
    produtos: { preco: 0, ativo: true },
    etapas: { funil: 'Vendas', ordem: 0, probabilidade: 0 },
    opcoes: { ordem: 0 },
    modelos: { canal: 'whatsapp', corpo: '' },
    metas: { valor: 0 },
    notas: { cancelada: false, valor_total: 0, valor_produtos: 0 },
    nota_itens: { quantidade: 0, valor_unitario: 0, valor_total: 0, ordem: 0 },
    titulos: { valor: 0, abono: false, origem: 'fkn' },
    fin_recorrentes: { tipo: 'saida', valor: 0, entre_empresas: false, ativo: true },
    fin_lancamentos: { tipo: 'saida', valor: 0, situacao: 'aberto', entre_empresas: false, origem: 'tela', emprestimo: false },
    fin_saldos: {},
    fin_regras: { tipo: 'saida', entre_empresas: false },
    fin_titulos_baixados: { valor: 0 },
    fin_excluidos: { dados: {} },
    email_campanhas: { ativa: true },
    email_envios: { situacao: 'pulado', para: [] },
    ofertas: { itens: [], assunto: '', corpo: '', whatsapp: '', ativa: true }
  };

  // Filhos apagados junto (no Supabase é o "on delete cascade"/"set null").
  const CASCATA = {
    empresas: [['contatos', 'empresa_id', 'apaga'], ['negocios', 'empresa_id', 'apaga'], ['atividades', 'empresa_id', 'apaga'], ['notas', 'empresa_id', 'solta'], ['titulos', 'empresa_id', 'solta'], ['email_envios', 'empresa_id', 'apaga']],
    notas: [['nota_itens', 'nota_id', 'apaga']],
    negocios: [['negocio_itens', 'negocio_id', 'apaga'], ['propostas', 'negocio_id', 'apaga'], ['atividades', 'negocio_id', 'solta']],
    contatos: [['negocios', 'contato_id', 'solta'], ['atividades', 'contato_id', 'solta']],
    usuarios: [['metas', 'usuario_id', 'apaga'], ['filtros', 'usuario_id', 'apaga'], ['empresas', 'responsavel_id', 'solta'],
      ['negocios', 'responsavel_id', 'solta'], ['atividades', 'responsavel_id', 'solta']],
    etapas: [['negocios', 'etapa_id', 'solta']],
    produtos: [['negocio_itens', 'produto_id', 'solta'], ['nota_itens', 'produto_id', 'solta']]
  };

  // ================================================================ Local
  const CHAVE_LS = 'sd-crm-v2';
  const LOCAL_ADMIN = '00000000-0000-4000-8000-000000000001';

  function Local() { this.modo = 'local'; this.proximaProposta = null; }

  Local.prototype.ler = function () {
    let d = null;
    try { d = JSON.parse(raiz.localStorage.getItem(CHAVE_LS) || 'null'); } catch (e) { d = null; }
    const base = vazio();
    if (d) TABELAS.forEach(t => { if (Array.isArray(d[t])) base[t] = d[t]; });
    // financeiro: mesma chave do navegador, fora do estado do CRM (só a tela Caixa lê)
    FIN.concat(A_PARTE).forEach(t => { base[t] = d && Array.isArray(d[t]) ? d[t] : []; });
    return base;
  };

  Local.prototype.gravar = function (d) { raiz.localStorage.setItem(CHAVE_LS, JSON.stringify(d)); };

  // Primeira abertura: administrador local, etapas e listas padrão.
  Local.prototype.semeia = function (d) {
    const agora = new Date().toISOString();
    let mudou = false;
    if (!d.usuarios.length) {
      d.usuarios.push({ user_id: LOCAL_ADMIN, nome: 'Administrador (modo local)', papel: 'admin', ativo: true, recebe_leads: true, criado_em: agora });
      mudou = true;
    }
    if (!d.etapas.length) {
      R.ETAPAS_PADRAO.forEach((e, i) => d.etapas.push({ id: uuid(), funil: 'Vendas', nome: e[0], probabilidade: e[1], ordem: i + 1, criado_em: agora }));
      mudou = true;
    }
    if (!d.opcoes.length) {
      Object.keys(R.OPCOES_PADRAO).forEach(tipo => R.OPCOES_PADRAO[tipo].forEach((nome, i) => d.opcoes.push({ id: uuid(), tipo, nome, ordem: i + 1 })));
      mudou = true;
    }
    if (!d.config.length) { d.config.push({ id: 1, dados: {} }); mudou = true; }
    return mudou;
  };

  Local.prototype.carregar = function () {
    const d = this.ler();
    if (this.semeia(d)) this.gravar(d);
    FIN.concat(A_PARTE).forEach(t => { delete d[t]; });
    return Promise.resolve(d);
  };
  Local.prototype.carregarFin = function () { return Promise.resolve(finVazio(this.ler())); };

  Local.prototype.usuarioAtual = function () { return Promise.resolve(this.ler().usuarios.find(u => u.user_id === LOCAL_ADMIN) || this.ler().usuarios[0]); };

  Local.prototype.novo = function (d, t, obj) {
    const agora = new Date().toISOString();
    const k = chave(t);
    const r = Object.assign({ criado_em: agora, atualizado_em: agora }, JSON.parse(JSON.stringify(PADROES[t] || {})), obj);
    if (r[k] == null) r[k] = uuid();
    if (t === 'propostas' && r.numero == null) r.numero = d.propostas.reduce((m, p) => Math.max(m, p.numero || 0), 0) + 1;
    if (t === 'negocios' && !r.etapa_desde) r.etapa_desde = agora;
    if (!('criado_por' in r) && t !== 'usuarios' && t !== 'config') r.criado_por = LOCAL_ADMIN;
    return r;
  };

  Local.prototype.inserir = function (t, obj) {
    const d = this.ler();
    const r = this.novo(d, t, obj);
    d[t].push(r);
    this.gravar(d);
    return Promise.resolve(r);
  };

  Local.prototype.inserirVarios = function (t, lista) {
    const d = this.ler();
    const out = lista.map(o => { const r = this.novo(d, t, o); d[t].push(r); return r; });
    this.gravar(d);
    return Promise.resolve(out);
  };

  function aplica(r, patch, t) {
    const n = Object.assign({}, r, patch, { atualizado_em: new Date().toISOString() });
    if (t === 'negocios' && ((patch.etapa_id !== undefined && patch.etapa_id !== r.etapa_id) || (patch.status !== undefined && patch.status !== r.status))) {
      n.etapa_desde = n.atualizado_em;
    }
    return n;
  }

  Local.prototype.atualizar = function (t, id, patch) {
    const d = this.ler();
    const k = chave(t);
    let achado = null;
    d[t] = d[t].map(r => (r[k] === id ? (achado = aplica(r, patch, t)) : r));
    if (!achado) return Promise.reject(new Error('Registro não encontrado (pode ter sido apagado em outro computador).'));
    this.gravar(d);
    return Promise.resolve(achado);
  };

  Local.prototype.atualizarVarios = function (t, ids, patch) {
    const d = this.ler();
    const k = chave(t);
    const s = new Set(ids);
    d[t] = d[t].map(r => (s.has(r[k]) ? aplica(r, patch, t) : r));
    this.gravar(d);
    return Promise.resolve();
  };

  function cascata(d, t, ids) {
    (CASCATA[t] || []).forEach(([filha, col, modo]) => {
      if (modo === 'apaga') {
        const apagados = d[filha].filter(r => ids.has(r[col])).map(r => r[chave(filha)]);
        d[filha] = d[filha].filter(r => !ids.has(r[col]));
        if (apagados.length) cascata(d, filha, new Set(apagados));
      } else {
        d[filha].forEach(r => { if (ids.has(r[col])) r[col] = null; });
      }
    });
  }

  Local.prototype.removerVarios = function (t, ids) {
    const d = this.ler();
    const k = chave(t);
    const s = new Set(ids);
    d[t] = d[t].filter(r => !s.has(r[k]));
    cascata(d, t, s);
    this.gravar(d);
    return Promise.resolve();
  };

  Local.prototype.remover = function (t, id) { return this.removerVarios(t, [id]); };

  // No modo local, importar um backup SUBSTITUI tudo.
  Local.prototype.restaurar = function (dados) {
    const d = vazio();
    TABELAS.forEach(t => { if (Array.isArray(dados[t])) d[t] = dados[t]; });
    this.semeia(d);
    this.gravar(d);
    return Promise.resolve();
  };

  Local.prototype.proximoVendedor = function () {
    const d = this.ler();
    const limite = new Date(Date.now() - 30 * 86400000).toISOString();
    const cand = d.usuarios.filter(u => u.ativo && u.recebe_leads);
    if (!cand.length) return Promise.resolve(null);
    const conta = u => d.empresas.filter(e => e.responsavel_id === u.user_id && e.criado_em > limite).length;
    cand.sort((a, b) => conta(a) - conta(b) || a.nome.localeCompare(b.nome, 'pt-BR'));
    return Promise.resolve(cand[0].user_id);
  };

  Local.prototype.historico = function () { return Promise.resolve([]); };

  // ================================================================ Supabase
  const PAGINA = 1000; // limite padrão do PostgREST no Supabase
  // Lista inteira em páginas de 1.000 (20/10/2026: as sugestões de fotos passaram de 1.000 e a tela via só as primeiras —
  // "Todos sem foto" mostrava 716 já buscados). consulta(de, ate) monta a busca com uma ordem estável (chave única no fim).
  async function paginado(consulta) {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await comTentativas(() => consulta(de, de + PAGINA - 1))) || [];
      out.push(...l);
      if (l.length < PAGINA) return out;
    }
  }
  const LOTE = 500;

  function Supa(cliente) { this.modo = 'supabase'; this.sb = cliente; }
  const tab = t => 'crm_' + t;

  function unwrap(r) {
    if (r.error) {
      const e = new Error(traduzErro(r.error));
      e.original = r.error;
      throw e;
    }
    return r.data;
  }

  function traduzErro(e) {
    const m = e.message || String(e);
    if (/row-level security/i.test(m)) return 'Sem permissão para isso (a empresa ou o negócio é de outro vendedor).';
    if (/permission denied/i.test(m)) return 'Sem permissão para isso.';
    if (/violates foreign key/i.test(m)) return 'Registro ligado a outro que não existe mais. Recarregue a página.';
    if (/duplicate key/i.test(m)) return 'Já existe um registro igual.';
    if (/JWT expired|invalid JWT/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
    if (/statement timeout|canceling statement/i.test(m)) return 'O servidor demorou para responder. Tente de novo em instantes.';
    if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    return m;
  }

  // Leitura que falha por demora ou rede (servidor ocupado, Wi-Fi caindo) tenta de novo antes de
  // desistir; permissão e sessão expirada não adiantam repetir. Em 01/10/2026 o banco cancelou
  // leituras por tempo e o CRM abriu vazio para a equipe (a causa, nas políticas, está corrigida
  // e testada em supabase/teste-rls/volume.sql; isto é a segunda proteção).
  const ESPERAS = [1500, 4000, 8000];
  const repete = r => r.error && !/row-level security|permission denied|JWT|não está liberado/i.test(r.error.message || '');
  async function comTentativas(fazer) {
    let r;
    for (let i = 0; ; i++) {
      try { r = await fazer(); } catch (e) { r = { error: e }; }
      if (!repete(r) || i >= ESPERAS.length) return r;
      await new Promise(ok => setTimeout(ok, ESPERAS[i]));
    }
  }

  async function tudo(sb, t) {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const ordem = t === 'config' ? 'id' : chave(t) === 'user_id' ? 'nome' : 'criado_em';
      const lote = unwrap(await comTentativas(() => sb.from(tab(t)).select('*').order(ordem).order(chave(t)).range(de, de + PAGINA - 1)));
      out.push(...lote);
      if (lote.length < PAGINA) return out;
    }
  }

  Supa.prototype.carregar = async function () {
    const res = await Promise.all(TABELAS.map(t => tudo(this.sb, t)));
    const d = vazio();
    TABELAS.forEach((t, i) => { d[t] = res[i]; });
    return d;
  };

  // Recarga leve (07/10/2026): o projeto passou do limite de tráfego do plano grátis do Supabase —
  // cada computador baixava TUDO (~24 MB, 14 MB só de itens de nota) a cada 5 minutos: ~870 cargas
  // completas por dia. Agora a recarga automática traz só as linhas com atualizado_em depois de
  // "desde"; as tabelas pequenas (ou sem atualizado_em confiável, como os títulos, cuja data é a da
  // listagem do FKN) vêm inteiras. O que outro computador APAGOU sai pela conferência de ids (só a
  // chave de cada linha), de hora em hora. Carga completa: ao entrar e em "Recarregar dados".
  const INTEIRAS = ['usuarios', 'config', 'etapas', 'opcoes', 'modelos', 'metas', 'filtros', 'titulos', 'email_campanhas', 'email_envios', 'ofertas'];
  const PARCIAIS = TABELAS.filter(t => INTEIRAS.indexOf(t) === -1);
  async function mudadas(sb, t, desde) {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const lote = unwrap(await comTentativas(() => sb.from(tab(t)).select('*').gt('atualizado_em', desde).order('atualizado_em').order(chave(t)).range(de, de + PAGINA - 1)));
      out.push(...lote);
      if (lote.length < PAGINA) return out;
    }
  }
  async function chaves(sb, t) {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const lote = unwrap(await comTentativas(() => sb.from(tab(t)).select(chave(t)).order(chave(t)).range(de, de + PAGINA - 1)));
      out.push(...lote.map(x => x[chave(t)]));
      if (lote.length < PAGINA) return out;
    }
  }
  // → { inteiras: { t: linhas }, mudadas: { t: linhas }, existentes: { t: [chaves] } | null }
  Supa.prototype.carregarMudancas = async function (desde, conferirApagados) {
    const [a, b, c] = await Promise.all([
      Promise.all(INTEIRAS.map(t => tudo(this.sb, t))),
      Promise.all(PARCIAIS.map(t => mudadas(this.sb, t, desde))),
      conferirApagados ? Promise.all(PARCIAIS.map(t => chaves(this.sb, t))) : null
    ]);
    const r = { inteiras: {}, mudadas: {}, existentes: conferirApagados ? {} : null };
    INTEIRAS.forEach((t, i) => { r.inteiras[t] = a[i]; });
    PARCIAIS.forEach((t, i) => { r.mudadas[t] = b[i]; if (c) r.existentes[t] = c[i]; });
    return r;
  };
  // Junta a recarga leve nos dados da tela (mesmo resultado de uma carga completa, se nada foi apagado
  // sem a conferência). Devolve quantas linhas mudaram.
  function aplicaMudancas(D, r) {
    let n = 0;
    Object.keys(r.inteiras).forEach(t => { D[t] = r.inteiras[t]; });
    Object.keys(r.mudadas).forEach(t => {
      const k = chave(t), pos = new Map((D[t] || []).map((x, i) => [x[k], i]));
      r.mudadas[t].forEach(x => { const i = pos.get(x[k]); if (i == null) { pos.set(x[k], D[t].length); D[t].push(x); } else D[t][i] = x; n++; });
    });
    if (r.existentes) Object.keys(r.existentes).forEach(t => {
      const k = chave(t), vivos = new Set(r.existentes[t]), antes = D[t].length;
      D[t] = D[t].filter(x => vivos.has(x[k]));
      n += antes - D[t].length;
    });
    return n;
  }
  // Marca para a próxima recarga leve: o atualizado_em mais novo visto (relógio do banco, não do
  // computador), menos 2 minutos de folga (transação que gravou antes e confirmou depois).
  function marcaRecarga(D) {
    let m = '';
    PARCIAIS.forEach(t => (D[t] || []).forEach(x => { if (x.atualizado_em && x.atualizado_em > m) m = x.atualizado_em; }));
    return m ? new Date(Date.parse(m) - 120000).toISOString() : null;
  }

  Supa.prototype.carregarFin = async function () {
    const r = await Promise.all(FIN.map(t => tudo(this.sb, t)));
    return finVazio({ fin_recorrentes: r[0], fin_lancamentos: r[1], fin_saldos: r[2], fin_regras: r[3], fin_titulos_baixados: r[4], fin_excluidos: r[5] });
  };

  Supa.prototype.usuarioAtual = async function (userId) {
    const l = unwrap(await this.sb.from('crm_usuarios').select('*').eq('user_id', userId).eq('ativo', true));
    return l && l[0] || null;
  };

  Supa.prototype.inserir = async function (t, obj) {
    return unwrap(await this.sb.from(tab(t)).insert(obj, { defaultToNull: false }).select().single());
  };

  // aoErro(registro, erro): se vier, um lote recusado é regravado um a um e só os registros com
  // problema ficam de fora (a importação não para por causa de uma linha ruim).
  Supa.prototype.inserirVarios = async function (t, lista, aoProgresso, aoErro) {
    const out = [];
    const grava = l => this.sb.from(tab(t)).insert(l, { defaultToNull: false }).select();
    for (let i = 0; i < lista.length; i += LOTE) {
      const lote = lista.slice(i, i + LOTE);
      // defaultToNull: false → campo ausente num registro do lote usa o valor padrão da coluna
      // (sem isso o PostgREST grava null quando outro registro do mesmo lote tem o campo).
      const r = await grava(lote);
      if (!r.error) out.push(...r.data);
      else if (!aoErro) unwrap(r);
      else {
        for (const o of lote) {
          const u = await grava([o]);
          if (u.error) aoErro(o, u.error); else out.push(...u.data);
        }
      }
      if (aoProgresso) aoProgresso(Math.min(i + LOTE, lista.length), lista.length);
    }
    return out;
  };

  Supa.prototype.atualizar = async function (t, id, patch) {
    const l = unwrap(await this.sb.from(tab(t)).update(patch).eq(chave(t), id).select());
    if (!l.length) throw new Error('Não foi possível salvar: registro não encontrado ou sem permissão.');
    return l[0];
  };

  Supa.prototype.atualizarVarios = async function (t, ids, patch) {
    for (let i = 0; i < ids.length; i += 200) {
      unwrap(await this.sb.from(tab(t)).update(patch).in(chave(t), ids.slice(i, i + 200)));
    }
  };

  Supa.prototype.remover = async function (t, id) {
    unwrap(await this.sb.from(tab(t)).delete().eq(chave(t), id));
  };

  Supa.prototype.removerVarios = async function (t, ids) {
    for (let i = 0; i < ids.length; i += 200) unwrap(await this.sb.from(tab(t)).delete().in(chave(t), ids.slice(i, i + 200)));
  };

  // Backup no Supabase: upsert por chave (não apaga nada que já está lá).
  Supa.prototype.restaurar = async function (dados, aoProgresso) {
    for (const t of TABELAS) {
      if (t === 'usuarios' || t === 'filtros') continue; // usuários vêm do Auth; filtros são pessoais
      const linhas = (dados[t] || []).map(r => { const c = Object.assign({}, r); delete c.criado_por; return c; });
      for (let i = 0; i < linhas.length; i += LOTE) {
        unwrap(await this.sb.from(tab(t)).upsert(linhas.slice(i, i + LOTE)));
        if (aoProgresso) aoProgresso(t, Math.min(i + LOTE, linhas.length), linhas.length);
      }
    }
  };

  // Cadastro repetido em qualquer carteira (o vendedor não enxerga a dos outros): só nome e responsável.
  Supa.prototype.duplicados = async function (q, ignorarId) {
    return unwrap(await this.sb.rpc('crm_duplicado_empresa', { p_doc: q.cnpj || null, p_tels: (q.telefones || []).filter(Boolean),
      p_mails: (q.emails || []).filter(Boolean), p_ignorar: ignorarId || null })) || [];
  };

  Supa.prototype.proximoVendedor = async function () {
    return unwrap(await this.sb.rpc('crm_proximo_vendedor'));
  };

  // Integrações (vigia de notas): chaves (só admin vê, pela RLS) e registro das entregas.
  // Estoque (CSV do FKN): lido e gravado só pela tela Gestão (administrador). Gravar = retrato
  // novo: atualiza por código e apaga o que saiu do relatório.
  Supa.prototype.clientesCompras = async function () {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await comTentativas(() => this.sb.rpc('crm_clientes_compras').range(de, de + PAGINA - 1)));
      out.push(...l);
      if (l.length < PAGINA) return out;
    }
  };
  Supa.prototype.estoque = async function () {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await this.sb.from('crm_estoque').select('*').order('codigo').range(de, de + PAGINA - 1));
      out.push(...l);
      if (l.length < PAGINA) return out;
    }
  };
  Supa.prototype.salvarEstoque = async function (lista, aoProgresso) {
    const agora = new Date().toISOString();
    const linhas = lista.map(x => Object.assign({}, x, { atualizado_em: agora }));
    for (let i = 0; i < linhas.length; i += LOTE) {
      unwrap(await this.sb.from('crm_estoque').upsert(linhas.slice(i, i + LOTE), { onConflict: 'codigo', defaultToNull: false }));
      if (aoProgresso) aoProgresso(Math.min(i + LOTE, linhas.length), linhas.length);
    }
    unwrap(await this.sb.from('crm_estoque').delete().lt('atualizado_em', agora));
    return linhas.length;
  };
  // Comprador sênior (18/10/2026): cadastro dos fornecedores, troca de fornecedor de um produto e histórico do custo.
  Supa.prototype.fornecedores = async function () { return unwrap(await this.sb.from('crm_fornecedores').select('*').order('nome')); };
  Supa.prototype.produtoForn = async function () { return unwrap(await this.sb.from('crm_produto_fornecedor').select('codigo, fornecedor').not('fornecedor', 'is', null)); };
  Supa.prototype.custoHist = async function (dias) {
    const desde = new Date(Date.now() - (dias || 90) * 864e5).toISOString();
    return paginado((de, ate) => this.sb.from('crm_custo_historico').select('*').gte('em', desde).order('em', { ascending: false }).order('id').range(de, ate));
  };
  Supa.prototype.salvarFornecedor = async function (f) {
    return unwrap(await this.sb.from('crm_fornecedores').upsert(Object.assign({}, f, { atualizado_em: new Date().toISOString() }), { onConflict: 'codigo' }).select().single());
  };
  // fornecedor null = volta ao do FKN
  Supa.prototype.trocarFornecedor = async function (codigo, fornecedor) {
    return unwrap(await this.sb.from('crm_produto_fornecedor').upsert({ codigo, fornecedor: fornecedor || null, atualizado_em: new Date().toISOString() }, { onConflict: 'codigo' }));
  };
  // Comparação mensal com os concorrentes (18/10/2026): lista, cesta e preços lançados pelo comprador.
  Supa.prototype.concorrentes = async function () { return unwrap(await this.sb.from('crm_concorrentes').select('*').order('ordem')); };
  Supa.prototype.cesta = async function () { return unwrap(await this.sb.from('crm_cesta').select('*').order('ordem')); };
  Supa.prototype.precosConcorrente = async function (desde) { return paginado((de, ate) => this.sb.from('crm_precos_concorrente').select('*').gte('mes', desde).order('id').range(de, ate)); };
  Supa.prototype.salvarConcorrente = async function (k) {
    if (k.id) return unwrap(await this.sb.from('crm_concorrentes').update({ nome: k.nome, site: k.site, obs: k.obs, ativo: k.ativo, ordem: k.ordem }).eq('id', k.id).select().single());
    return unwrap(await this.sb.from('crm_concorrentes').insert({ nome: k.nome, site: k.site || null, ordem: k.ordem || 0 }).select().single());
  };
  Supa.prototype.salvarCesta = async function (it) { return unwrap(await this.sb.from('crm_cesta').upsert(Object.assign({}, it, { atualizado_em: new Date().toISOString() }), { onConflict: 'codigo' })); };
  Supa.prototype.salvarPrecoConcorrente = async function (p) {
    return unwrap(await this.sb.from('crm_precos_concorrente').upsert(Object.assign({}, p, { em: new Date().toISOString() }), { onConflict: 'mes,concorrente_id,codigo' }));
  };
  const lsLe = (k, pad) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || pad; } catch (e) { return pad; } };
  const lsGrava = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* só na memória */ } };
  Local.prototype.concorrentes = async function () { return lsLe('crm_concorrentes', []); };
  Local.prototype.cesta = async function () { return lsLe('crm_cesta', []); };
  Local.prototype.precosConcorrente = async function (desde) { return lsLe('crm_precos_concorrente', []).filter(p => p.mes >= desde); };
  Local.prototype.salvarConcorrente = async function (k) {
    const l = lsLe('crm_concorrentes', []), id = k.id || (l.reduce((m, x) => Math.max(m, x.id), 0) + 1);
    lsGrava('crm_concorrentes', l.filter(x => x.id !== id).concat(Object.assign({ ativo: true }, l.find(x => x.id === id) || {}, k, { id }))); return k;
  };
  Local.prototype.salvarCesta = async function (it) { lsGrava('crm_cesta', lsLe('crm_cesta', []).filter(x => x.codigo !== it.codigo).concat(it)); };
  Local.prototype.salvarPrecoConcorrente = async function (p) {
    lsGrava('crm_precos_concorrente', lsLe('crm_precos_concorrente', []).filter(x => !(x.mes === p.mes && x.concorrente_id === p.concorrente_id && x.codigo === p.codigo)).concat(p));
  };
  Local.prototype.fornecedores = async function () { return lsLe('crm_fornecedores', []); };
  Local.prototype.produtoForn = async function () { return lsLe('crm_produto_fornecedor', []).filter(x => x.fornecedor); };
  Local.prototype.custoHist = async function () { return []; };
  Local.prototype.salvarFornecedor = async function (f) {
    const l = lsLe('crm_fornecedores', []).filter(x => x.codigo !== f.codigo).concat(Object.assign({ prazo_dias: 7, dias_pedido: [] }, f));
    lsGrava('crm_fornecedores', l); return f;
  };
  Local.prototype.trocarFornecedor = async function (codigo, fornecedor) {
    lsGrava('crm_produto_fornecedor', lsLe('crm_produto_fornecedor', []).filter(x => x.codigo !== codigo).concat({ codigo, fornecedor: fornecedor || null }));
  };
  Local.prototype.estoque = async function () { try { return JSON.parse(localStorage.getItem('crm_estoque') || '[]'); } catch (e) { return this._estoque || []; } };
  Local.prototype.salvarEstoque = async function (lista) {
    const l = lista.map(x => Object.assign({}, x, { atualizado_em: new Date().toISOString() }));
    this._estoque = l;
    try { localStorage.setItem('crm_estoque', JSON.stringify(l)); } catch (e) { /* só na memória */ }
    return l.length;
  };

  // Estoque do CRM (Fase 2, 16/10/2026): livro de movimentos e saldo, só administrador e comprador. Tudo que grava
  // passa por funções do banco (o livro não se edita): foto da listagem do FKN, começar, contagem/ajuste.
  Supa.prototype.estoqueFoto = async function (gerado, linhas) { return unwrap(await this.sb.rpc('crm_estoque_foto', { p_gerado: gerado || null, p_linhas: linhas || null })); };
  Supa.prototype.estoqueIniciar = async function () { return unwrap(await this.sb.rpc('crm_estoque_iniciar')); };
  Supa.prototype.estoqueContagem = async function (lote, tipo, motivo) { return unwrap(await this.sb.rpc('crm_estoque_contagem', { lote, p_tipo: tipo, p_motivo: motivo })); };
  Supa.prototype.estoqueSaldo = async function () {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await this.sb.from('crm_estoque_saldo').select('*').order('codigo').range(de, de + PAGINA - 1));
      out.push(...l);
      if (l.length < PAGINA) return out;
    }
  };
  Supa.prototype.estoqueMovs = async function (codigo, limite) {
    return unwrap(await this.sb.from('crm_estoque_mov').select('*').eq('codigo', codigo).order('quando', { ascending: false }).limit(limite || 200));
  };
  Supa.prototype.estoqueFotos = async function (limite) { return unwrap(await this.sb.from('crm_estoque_fotos').select('*').order('gerado_em', { ascending: false }).limit(limite || 60)); };
  Supa.prototype.estoqueDifs = async function (fotoId) { return paginado((de, ate) => this.sb.from('crm_estoque_difs').select('*').eq('foto_id', fotoId).order('codigo').range(de, ate)); };
  Supa.prototype.estoqueUnidades = async function () { return paginado((de, ate) => this.sb.from('crm_estoque_unidades').select('*').order('codigo').order('unidade').range(de, ate)); };
  Supa.prototype.estoqueUnidadeSalvar = async function (codigo, unidade, fator) {
    return unwrap(await this.sb.from('crm_estoque_unidades').upsert({ codigo, unidade, fator, origem: 'manual', atualizado_em: new Date().toISOString() }, { onConflict: 'codigo,unidade' }).select().single());
  };
  // Notas de compra (entrada pelo XML): grava pendente (a mesma chave não entra duas vezes), lista, dá entrada, deixa de lado.
  Supa.prototype.compras = async function (limite) { return unwrap(await this.sb.from('crm_compras').select('*').order('emitida_em', { ascending: false }).limit(limite || 200)); };
  Supa.prototype.compraItens = async function (id) { return unwrap(await this.sb.from('crm_compra_itens').select('*').eq('compra_id', id).order('ordem')); };
  Supa.prototype.compraVinculos = async function () { return paginado((de, ate) => this.sb.from('crm_compra_vinculos').select('*').order('fornecedor_doc').order('cod_fornecedor').range(de, ate)); };
  // Itens de compra com o ICMS-ST lido do XML (19/10/2026), junto com a nota: para o ICMS-ST "retido anteriormente" (fiscal.js).
  Supa.prototype.comprasSt = async function () {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await this.sb.from('crm_compra_itens').select('id, codigo, fator, cod_fornecedor, descricao, ean, unidade, quantidade, ordem, st_cst, st_base, st_aliq, st_proprio, st_valor, crm_compras(numero, emitida_em, fornecedor_doc, fornecedor_nome)')
        .not('st_cst', 'is', null).order('id').range(de, de + PAGINA - 1));
      out.push(...l.map(i => Object.assign({}, i, i.crm_compras || {}, { crm_compras: undefined })));
      if (l.length < PAGINA) return out;
    }
  };
  // Notas de compra com item ainda sem o ICMS-ST (gravadas antes de 19/10/2026) e o preenchimento pelo XML guardado.
  Supa.prototype.comprasSemSt = async function () {
    const l = await paginado((de, ate) => this.sb.from('crm_compra_itens').select('id, crm_compras(chave)').is('st_cst', null).order('id').range(de, ate));
    return [...new Set(l.map(i => (i.crm_compras || {}).chave).filter(Boolean))];
  };
  // produto nosso de cada item das notas pendentes (item ligado, ligação lembrada ou código de barras): para o selo "chegou"
  Supa.prototype.compraItensDe = async function (ids) { return unwrap(await this.sb.from('crm_compra_itens').select('compra_id, ordem, ncm, cfop, descricao').in('compra_id', ids)); };
  Supa.prototype.comprasItensProduto = async function () { return unwrap(await this.sb.rpc('crm_compras_itens_produto')); };
  Supa.prototype.compraItensSt = async function (lista) { return unwrap(await this.sb.rpc('crm_compra_itens_st', { p: lista })); };
  Supa.prototype.compraGravar = async function (compra, itens) {
    const r = unwrap(await this.sb.from('crm_compras').upsert(compra, { onConflict: 'chave', ignoreDuplicates: true }).select());
    if (!r || !r.length) return null; // já estava no CRM
    unwrap(await this.sb.from('crm_compra_itens').insert(itens.map(i => Object.assign({}, i, { compra_id: r[0].id }))));
    return r[0];
  };
  // Notas de compra pela Sefaz (crm-fiscal → serviço fiscal → Distribuição de DF-e): resumo, NSU e o XML completo.
  Supa.prototype.dfe = async function () { return unwrap(await this.sb.from('crm_dfe').select('*').order('emitida_em', { ascending: false }).limit(1000)); };
  Supa.prototype.dfeEstado = async function () { return unwrap(await this.sb.from('crm_dfe_estado').select('*').eq('id', 1).maybeSingle()); };
  Supa.prototype.dfeBuscar = async function () { return this.fiscal({ acao: 'dfe_buscar' }); };
  Supa.prototype.dfeCiencia = async function (chave) { return this.fiscal({ acao: 'dfe_ciencia', chave: chave || null }); };
  // resposta definitiva (19/10/2026): confirmacao | desconhecimento | nao_realizada (com justificativa); só o administrador
  Supa.prototype.dfeManifestar = async function (chave, tipo, justificativa) { return this.fiscal({ acao: 'dfe_manifestar', chave, tipo, justificativa: justificativa || null }); };
  // CNPJ emitente que o comprador conhece (e de qual fornecedor do FKN é) ou não reconhece
  Supa.prototype.fornecedorDocs = async function () { return unwrap(await this.sb.from('crm_fornecedor_docs').select('*')); };
  Supa.prototype.salvarFornecedorDoc = async function (d) { return unwrap(await this.sb.from('crm_fornecedor_docs').upsert(Object.assign({}, d, { em: new Date().toISOString() }), { onConflict: 'doc' })); };
  Supa.prototype.dfeXml = async function (chave) {
    const r = await this.sb.storage.from('crm-compras-xml').download(chave + '.xml');
    if (r.error) return null;
    return await r.data.text();
  };
  Supa.prototype.compraLancar = async function (id, itens) { return unwrap(await this.sb.rpc('crm_compra_lancar', { p_compra: id, p_itens: itens })); };
  Supa.prototype.compraIgnorar = async function (id, obs) {
    return unwrap(await this.sb.from('crm_compras').update({ situacao: 'ignorada', obs: obs || null, atualizado_em: new Date().toISOString() }).eq('id', id).eq('situacao', 'pendente').select().single());
  };
  Local.prototype.compras = async function () { return this._compras || []; };
  Local.prototype.compraItens = async function (id) { return (this._compraItens || []).filter(i => i.compra_id === id); };
  Local.prototype.compraVinculos = async function () { return []; };
  Local.prototype.comprasSt = async function () {
    const cs = new Map((this._compras || []).map(c => [c.id, c]));
    return (this._compraItens || []).filter(i => i.st_cst).map(i => { const c = cs.get(i.compra_id) || {};
      return Object.assign({}, i, { numero: c.numero, emitida_em: c.emitida_em, fornecedor_doc: c.fornecedor_doc, fornecedor_nome: c.fornecedor_nome }); });
  };
  Local.prototype.comprasSemSt = async function () { return []; };
  Local.prototype.compraItensSt = async function () { return 0; };
  Local.prototype.compraItensDe = async function (ids) { return (this._compraItens || []).filter(i => ids.indexOf(i.compra_id) !== -1); };
  Local.prototype.comprasItensProduto = async function () {
    const pend = new Set((this._compras || []).filter(c => c.situacao === 'pendente').map(c => c.id));
    return (this._compraItens || []).filter(i => pend.has(i.compra_id) && i.codigo).map(i => ({ compra_id: i.compra_id, ordem: i.ordem, codigo: i.codigo, como: 'item' }));
  };
  Local.prototype.compraGravar = async function (compra, itens) {
    this._compras = this._compras || []; this._compraItens = this._compraItens || [];
    if (this._compras.some(c => c.chave === compra.chave)) return null;
    const c = Object.assign({ id: uuid(), situacao: 'pendente', criado_em: new Date().toISOString() }, compra);
    this._compras.push(c); itens.forEach(i => this._compraItens.push(Object.assign({ id: uuid(), compra_id: c.id }, i)));
    return c;
  };
  Local.prototype.dfe = async function () { return []; };
  Local.prototype.dfeEstado = async function () { return null; };
  Local.prototype.dfeBuscar = async function () { throw new Error('a busca na Sefaz só funciona ligada ao banco'); };
  Local.prototype.dfeCiencia = Local.prototype.dfeBuscar;
  Local.prototype.dfeManifestar = Local.prototype.dfeBuscar;
  Local.prototype.fornecedorDocs = async function () { return []; };
  Local.prototype.salvarFornecedorDoc = async function () { return null; };
  Local.prototype.dfeXml = async function () { return null; };
  Local.prototype.compraLancar = async function () { throw new Error('a entrada no estoque só funciona ligada ao banco'); };
  Local.prototype.compraIgnorar = async function (id, obs) { const c = (this._compras || []).find(x => x.id === id); if (c) Object.assign(c, { situacao: 'ignorada', obs }); return c; };

  // modo local (teste/demonstração): o livro fica na memória
  Local.prototype.estoqueFoto = async function () { return { foto: null, conferencia: null }; };
  Local.prototype.estoqueIniciar = async function () { throw new Error('o estoque do CRM só funciona ligado ao banco'); };
  Local.prototype.estoqueContagem = async function () { throw new Error('o estoque do CRM só funciona ligado ao banco'); };
  Local.prototype.estoqueSaldo = async function () { return []; };
  Local.prototype.estoqueMovs = async function () { return []; };
  Local.prototype.estoqueFotos = async function () { return []; };
  Local.prototype.estoqueDifs = async function () { return []; };
  Local.prototype.estoqueUnidades = async function () { return []; };
  Local.prototype.estoqueUnidadeSalvar = async function () { throw new Error('o estoque do CRM só funciona ligado ao banco'); };

  // Contas a receber (listagem do FKN): retrato novo a cada importação — grava por duplicata,
  // apaga o que não veio (foi pago) e devolve a lista como ficou.
  // geradoEm: hora em que o FKN gerou o relatório — título criado pela nota depois disso fica.
  Supa.prototype.salvarTitulos = async function (lista, geradoEm) {
    const agora = new Date().toISOString();
    const linhas = lista.map(x => { const o = Object.assign({}, x, { atualizado_em: agora, origem: 'fkn' }); delete o.id; return o; });
    for (let i = 0; i < linhas.length; i += LOTE)
      unwrap(await this.sb.from('crm_titulos').upsert(linhas.slice(i, i + LOTE), { onConflict: 'duplicata', defaultToNull: false }));
    unwrap(await this.sb.from('crm_titulos').delete().lt('atualizado_em', agora).or('origem.neq.nota,criado_em.lt.' + (geradoEm || agora)));
    return tudo(this.sb, 'titulos');
  };
  Local.prototype.salvarTitulos = async function (lista, geradoEm) {
    const d = this.ler(), agora = new Date().toISOString();
    const ficam = (d.titulos || []).filter(t => t.origem === 'nota' && t.criado_em >= (geradoEm || agora) && !lista.some(x => x.duplicata === t.duplicata));
    d.titulos = ficam.concat(lista.map(x => Object.assign({ id: uuid(), criado_em: agora }, x, { atualizado_em: agora, origem: 'fkn' })));
    this.gravar(d);
    return d.titulos;
  };

  Supa.prototype.integracoes = async function () {
    const [c, l] = await Promise.all([
      this.sb.from('crm_integracoes').select('id,nome,filtro,ativo,ultimo_uso,ultimo_sinal,sinal,criado_em,uso').order('criado_em'),
      this.sb.from('crm_integracao_log').select('*').order('quando', { ascending: false }).limit(40)
    ]);
    return { chaves: c.error ? [] : c.data, registro: unwrap(l) };
  };

  // Para o aviso do administrador: só o sinal de vida de cada vigia (RLS: só admin lê).
  Supa.prototype.vigias = async function () {
    const r = await this.sb.from('crm_integracoes').select('id,nome,ativo,ultimo_uso,ultimo_sinal,sinal,uso');
    return r.error ? [] : r.data.filter(x => x.uso === 'notas' || !x.uso); // as senhas do Caixa (leitura e espelho) não são vigia
  };
  // Espelho das transferências com a Agilité (08/10/2026): situação da fila e endereço/senha de lá (a senha
  // vai para o banco e nunca volta para o app).
  Supa.prototype.espelhoSituacao = async function () { return unwrap(await this.sb.rpc('crm_espelho_situacao')); };
  Supa.prototype.espelhoNovaSenha = async function () { return unwrap(await this.sb.rpc('crm_espelho_nova_senha')); };
  Supa.prototype.espelhoConfigura = async function (url, senha) { return unwrap(await this.sb.rpc('crm_espelho_configura', { p_url: url || null, p_senha: senha || null })); };

  Supa.prototype.historico = async function (filtro) {
    let q = this.sb.from('crm_historico').select('*').order('quando', { ascending: false }).limit(filtro.limite || 200);
    if (filtro.empresa_id) q = q.eq('empresa_id', filtro.empresa_id);
    if (filtro.registro_id) q = q.eq('registro_id', filtro.registro_id);
    return unwrap(await q);
  };

  // Usuários novos: Edge Function (precisa da service_role, que nunca vai para o navegador).
  Supa.prototype.adminUsuarios = async function (corpo) {
    const r = await this.sb.functions.invoke('crm-usuarios', { body: corpo });
    if (r.error) {
      let msg = r.error.message;
      try { const j = await r.error.context.json(); if (j && j.erro) msg = j.erro; } catch (e) { /* sem corpo */ }
      throw new Error(msg);
    }
    return r.data;
  };

  // Anexos do Caixa (13/10/2026): o arquivo vai para o bucket privado crm-caixa-anexos (só o administrador
  // lê e envia); a Edge Function crm-caixa-ler lê com a IA e devolve os movimentos; o link para abrir é
  // assinado e vale 1 minuto.
  const ANEXOS = 'crm-caixa-anexos';
  const erroDaFuncao = async r => {
    let msg = r.error.message;
    try { const j = await r.error.context.json(); if (j && j.erro) msg = j.erro; } catch (e) { /* sem corpo */ }
    return new Error(msg);
  };
  Supa.prototype.anexoEnviar = async function (arquivo, hoje) {
    const ext = (String(arquivo.name || '').split('.').pop() || '').toLowerCase().replace(/[^a-z]/g, '') ||
      ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' }[arquivo.type] || 'bin');
    const caminho = 'caixa/' + hoje.slice(0, 7) + '/' + uuid() + '.' + ext;
    const r = await this.sb.storage.from(ANEXOS).upload(caminho, arquivo, { contentType: arquivo.type || undefined, upsert: false });
    if (r.error) throw new Error('não consegui guardar o arquivo: ' + r.error.message);
    return caminho;
  };
  Supa.prototype.anexoLer = async function (caminho, nota, hoje) {
    const r = await this.sb.functions.invoke('crm-caixa-ler', { body: { caminho, nota, hoje } });
    if (r.error) throw await erroDaFuncao(r);
    return r.data;
  };
  Supa.prototype.anexoLink = async function (caminho) {
    const r = await this.sb.storage.from(ANEXOS).createSignedUrl(caminho, 60);
    if (r.error) throw new Error('não consegui abrir o comprovante: ' + r.error.message);
    return r.data.signedUrl;
  };
  // XML autorizado das notas (bucket privado crm-notas-xml, 14/10/2026): a importação manual guarda os que o
  // vigia ainda não guardou (para a cópia da DANFE da cobrança). Só sobe o que falta; aoAndar(feitos, total).
  Supa.prototype.notasXmlGuardar = async function (lista, aoAndar) {
    const ja = new Set();
    for (let de = 0; ; de += 1000) {
      const r = await this.sb.storage.from('crm-notas-xml').list('nfe', { limit: 1000, offset: de });
      if (r.error) throw new Error('não consegui ver os XML guardados: ' + r.error.message);
      r.data.forEach(o => ja.add(o.name));
      if (r.data.length < 1000) break;
    }
    const falta = lista.filter(x => !ja.has(x.chave + '.xml'));
    let feitos = 0, erros = 0;
    const fila = falta.slice();
    const um = async () => {
      for (let x; (x = fila.shift());) {
        const r = await this.sb.storage.from('crm-notas-xml').upload('nfe/' + x.chave + '.xml', new Blob([x.xml], { type: 'text/xml' }), { upsert: false, contentType: 'text/xml' });
        if (r.error && !/exist/i.test(r.error.message)) erros++;
        feitos++;
        if (aoAndar && feitos % 25 === 0) aoAndar(feitos, falta.length);
      }
    };
    await Promise.all([um(), um(), um(), um(), um(), um()]);
    return { guardados: feitos - erros, jaTinha: lista.length - falta.length, erros };
  };
  Supa.prototype.notaXml = async function (chave) {
    const r = await this.sb.storage.from('crm-notas-xml').download('nfe/' + chave + '.xml');
    if (r.error) return null;
    return await r.data.text();
  };
  Local.prototype.notasXmlGuardar = async function () { return { guardados: 0, jaTinha: 0, erros: 0 }; };

  // Fiscal (Fase 1 da saída do FKN, 15/10/2026): tributação lida do XML e a regra de cada produto. Só o
  // administrador; nada disto é carregado ao abrir o CRM (tráfego).
  Supa.prototype.fiscalGrava = async function (lote) { return unwrap(await this.sb.rpc('crm_fiscal_grava', { lote })); };
  Supa.prototype.fiscalResumo = async function () {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await this.sb.rpc('crm_fiscal_resumo').order('codigo').range(de, de + PAGINA - 1));
      out.push(...l);
      if (l.length < PAGINA) return out;
    }
  };
  Supa.prototype.notasSemFiscal = async function () {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await this.sb.from('crm_notas').select('chave').is('fiscal_lido_em', null).eq('cancelada', false).order('chave').range(de, de + PAGINA - 1));
      out.push(...l.map(x => x.chave));
      if (l.length < PAGINA) return out;
    }
  };
  Supa.prototype.fiscalProdutos = async function () {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await this.sb.from('crm_fiscal_produtos').select('*').order('codigo').range(de, de + PAGINA - 1));
      out.push(...l);
      if (l.length < PAGINA) return out;
    }
  };
  Supa.prototype.fiscalProdutosSalvar = async function (linhas) {
    for (let i = 0; i < linhas.length; i += LOTE) unwrap(await this.sb.from('crm_fiscal_produtos').upsert(linhas.slice(i, i + LOTE), { onConflict: 'codigo', defaultToNull: false }));
    return linhas.length;
  };
  // Modo local (demonstração e testes): guarda tudo na memória do navegador.
  Local.prototype.fiscalGrava = async function (lote) {
    const d = this.ler(); this._fiscal = this._fiscal || [];
    (lote || []).forEach(n => {
      const nota = d.notas.find(x => x.chave === n.chave); if (!nota) return;
      nota.fiscal_lido_em = new Date().toISOString();
      n.itens.forEach(it => {
        const ni = d.nota_itens.find(x => x.nota_id === nota.id && x.ordem === it.ordem) || {};
        this._fiscal = this._fiscal.filter(f => !(f.chave === n.chave && f.ordem === it.ordem));
        this._fiscal.push(Object.assign({ chave: n.chave, emitida_em: nota.emitida_em, cancelada: nota.cancelada, descricao: ni.descricao, unidade: ni.unidade }, it));
      });
    });
    this.gravar(d);
    return (lote || []).length;
  };
  Local.prototype.fiscalResumo = async function () {
    const g = new Map();
    (this._fiscal || []).filter(f => !f.cancelada && f.codigo).forEach(f => {
      const r = g.get(f.codigo) || { codigo: f.codigo, descricao: f.descricao || f.codigo, unidade: f.unidade || null, notas: 0, ultima: '', ncms: {}, cests: [], gtins: [], origens: [], combos: [] };
      const dia = String(f.emitida_em).slice(0, 10);
      r.notas++; if (dia > r.ultima) r.ultima = dia;
      if (f.ncm) { const x = r.ncms[f.ncm] || (r.ncms[f.ncm] = { n: 0, ultima: '', primeira: '9999' }); x.n++; if (dia > x.ultima) x.ultima = dia; if (dia < x.primeira) x.primeira = dia; }
      [['cest', 'cests'], ['gtin', 'gtins'], ['origem', 'origens']].forEach(([k, l]) => { if (f[k] && r[l].indexOf(f[k]) === -1) r[l].push(f[k]); });
      const ch = ['cfop', 'cst_icms', 'aliq_icms', 'red_bc_icms', 'cst_pis', 'aliq_pis', 'cst_cofins', 'aliq_cofins'].map(k => f[k]).join('|');
      let c = r.combos.find(x => x._k === ch);
      if (!c) { c = { _k: ch, cfop: f.cfop, cst_icms: f.cst_icms, aliq_icms: f.aliq_icms, red_bc_icms: f.red_bc_icms, cst_pis: f.cst_pis, aliq_pis: f.aliq_pis, cst_cofins: f.cst_cofins, aliq_cofins: f.aliq_cofins, n: 0, ultima: '', primeira: '9999' }; r.combos.push(c); }
      c.n++; if (dia > c.ultima) c.ultima = dia; if (dia < c.primeira) c.primeira = dia;
      g.set(f.codigo, r);
    });
    return [...g.values()];
  };
  Local.prototype.notasSemFiscal = async function () { return this.ler().notas.filter(n => !n.fiscal_lido_em && !n.cancelada && n.chave).map(n => n.chave); };
  Local.prototype.fiscalProdutos = async function () { return (this._fiscalProdutos || []).slice(); };
  Local.prototype.fiscalProdutosSalvar = async function (linhas) {
    const m = new Map((this._fiscalProdutos || []).map(p => [p.codigo, p]));
    linhas.forEach(l => m.set(l.codigo, Object.assign({}, m.get(l.codigo) || {}, l)));
    this._fiscalProdutos = [...m.values()];
    return linhas.length;
  };
  Local.prototype.notaXml = async function () { return null; };

  // PDFs dos boletos atualizados (bucket privado crm-boletos): o administrador envia; quem vê o boleto baixa.
  Supa.prototype.boletoEnviar = async function (arquivo, hoje) {
    const ext = arquivo.type === 'application/pdf' ? 'pdf' : ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[arquivo.type] || 'pdf');
    const caminho = 'boletos/' + hoje.slice(0, 7) + '/' + uuid() + '.' + ext;
    const r = await this.sb.storage.from('crm-boletos').upload(caminho, arquivo, { contentType: arquivo.type || 'application/pdf', upsert: false });
    if (r.error) throw new Error('não consegui guardar o boleto: ' + r.error.message);
    return caminho;
  };
  Supa.prototype.boletoLer = async function (caminho, hoje) {
    const r = await this.sb.functions.invoke('crm-caixa-ler', { body: { modo: 'boleto', caminho, hoje } });
    if (r.error) throw await erroDaFuncao(r);
    return r.data;
  };
  // segundos: 5 min para baixar na hora; o link que vai no WhatsApp do(a) vendedor(a) vale 7 dias
  Supa.prototype.boletoLink = async function (caminho, nome, segundos) {
    const r = await this.sb.storage.from('crm-boletos').createSignedUrl(caminho, segundos || 300, nome ? { download: nome } : undefined);
    if (r.error) throw new Error('não consegui abrir o boleto: ' + r.error.message);
    return r.data.signedUrl;
  };
  const SO_SUPABASE = () => Promise.reject(new Error('anexar documento só funciona com o Supabase ligado (o modo local não guarda arquivos)'));
  Local.prototype.anexoEnviar = SO_SUPABASE;
  Local.prototype.anexoLer = SO_SUPABASE;
  Local.prototype.anexoLink = SO_SUPABASE;
  // o arquivo em si (para montar o PDF completo e para o Compartilhar mandar o arquivo de verdade)
  Supa.prototype.boletoArquivo = async function (caminho) {
    const r = await this.sb.storage.from('crm-boletos').download(caminho);
    if (r.error) throw new Error('não consegui baixar o boleto: ' + r.error.message);
    return r.data;
  };
  Local.prototype.boletoArquivo = SO_SUPABASE;
  Local.prototype.boletoEnviar = SO_SUPABASE;
  Local.prototype.boletoLer = SO_SUPABASE;
  Local.prototype.boletoLink = SO_SUPABASE;

  // E-mails da cadência: a Edge Function crm-email envia pelo Brevo (a chave fica só no Supabase).
  // WhatsApp oficial da Meta (15/10/2026): Edge Function crm-whatsapp (só admin; a chave da Meta fica no Supabase)
  Supa.prototype.whatsapp = async function (corpo) {
    const r = await this.sb.functions.invoke('crm-whatsapp', { body: corpo });
    if (r.error) throw await erroDaFuncao(r);
    return r.data;
  };
  Local.prototype.whatsapp = async function (corpo) { return corpo && corpo.acao === 'situacao' ? { ligado: false, faltam: ['modo local'] } : Promise.reject(new Error('o WhatsApp da Meta só funciona com o Supabase ligado')); };
  Supa.prototype.email = async function (corpo) {
    const r = await this.sb.functions.invoke('crm-email', { body: corpo });
    if (r.error) {
      let msg = r.error.message;
      try { const j = await r.error.context.json(); if (j && j.erro) msg = j.erro; } catch (e) { /* sem corpo */ }
      throw new Error(msg);
    }
    return r.data;
  };
  // Textos da oferta de queima de estoque escritos pela IA (crm-oferta-texto).
  Supa.prototype.ofertaTexto = async function (corpo) {
    const r = await this.sb.functions.invoke('crm-oferta-texto', { body: corpo });
    if (r.error) throw await erroDaFuncao(r);
    return r.data;
  };
  Local.prototype.ofertaTexto = async function () { throw new Error('a IA só escreve com o Supabase ligado'); };
  // Modo local (demonstração e testes): "envia" sem sair do navegador — grava o envio e a atividade.
  Local.prototype.email = async function (corpo) {
    if (corpo.acao === 'situacao') return { ligado: true, local: true };
    if (corpo.acao === 'aberturas') return { ok: true, abertos: 0, clicados: 0, devolvidos: 0 };
    const d = this.ler(), e = d.empresas.find(x => x.id === corpo.empresa_id);
    if (!e) throw new Error('cliente não encontrado');
    if (e.email_sair_em) throw new Error('o cliente pediu para não receber estes e-mails');
    const env = this.novo(d, 'email_envios', { empresa_id: e.id, responsavel_id: e.responsavel_id || null, tipo: corpo.tipo, campanha_id: corpo.campanha_id || null, oferta_id: corpo.oferta_id || null,
      situacao: 'enviado', para: corpo.para || [], assunto: corpo.assunto, corpo: corpo.corpo, provedor_id: 'local' });
    d.email_envios.push(env);
    d.atividades.push(this.novo(d, 'atividades', { empresa_id: e.id, tipo: 'email', concluida: true, concluida_em: new Date().toISOString(), automatica: true,
      responsavel_id: e.responsavel_id || null, descricao: 'E-mail da cadência: ' + corpo.assunto }));
    this.gravar(d);
    return { ok: true, envio: env };
  };

  // Mesma cascata aplicada na memória do app (depois de apagar no banco).
  function cascataMemoria(d, t, ids) {
    const k = chave(t);
    const s = new Set(ids);
    d[t] = d[t].filter(r => !s.has(r[k]));
    cascata(d, t, s);
  }

  // Sinal de vida do vigia: 'ok' (sinal há menos de 75 min; ele manda a cada 30), 'parado' ou
  // 'nunca' (vigia antigo, sem sinal de vida: atualizar o vigia-notas.js no servidor).
  const PARADO_MIN = 75;
  function situacaoVigia(c, agora) {
    if (!c || !c.ativo) return { estado: 'desligada' };
    if (!c.ultimo_sinal) return { estado: 'nunca' };
    const min = Math.floor(((agora || Date.now()) - new Date(c.ultimo_sinal).getTime()) / 60000);
    return { estado: min > PARADO_MIN ? 'parado' : 'ok', minutos: Math.max(0, min) };
  }

  // Lembrete de puxar os relatórios do FKN (listagem de produtos e contas a receber): um de manhã
  // (a partir das 7h) e um à tarde (a partir das 13h), de segunda a sexta. Pendente = a última
  // entrega é de antes do começo do turno. Devolve { turno, desde } ou null.
  const TURNOS_FKN = [[7, 'manhã'], [13, 'tarde']];
  function lembreteFkn(ultimo, agora) {
    agora = agora ? new Date(agora) : new Date();
    const dia = agora.getDay();
    if (dia === 0 || dia === 6) return null;
    const t = TURNOS_FKN.slice().reverse().find(x => agora.getHours() >= x[0]);
    if (!t) return null;
    const desde = new Date(agora); desde.setHours(t[0], 0, 0, 0);
    return !ultimo || new Date(ultimo) < desde ? { turno: t[1], desde } : null;
  }
  // Última atualização de cada arquivo do FKN e a última recusa (arquivo puxado com opção
  // faltando), pela função do banco: o comprador não lê os títulos nem o registro de entregas.
  Supa.prototype.fknAtualizado = async function () {
    const r = unwrap(await comTentativas(() => this.sb.rpc('crm_fkn_situacao')));
    return Object.assign({ estoque: null, receber: null, pagar: null, recusas: [] }, r || {});
  };
  // Duplicatas EM ATRASO, com detalhe e o cartório (gestora e vendedores(as) não leem o contas a receber — ver
  // schema.sql; crm_atrasos substituiu crm_duplicatas_atraso em 14/10/2026).
  Supa.prototype.duplicatasAtraso = async function () {
    return unwrap(await comTentativas(() => this.sb.rpc('crm_atrasos'))) || [];
  };
  // Boletos atualizados dos últimos 90 dias (o(a) vendedor(a) recebe só os da carteira — RLS).
  Supa.prototype.boletos = async function () {
    const desde = new Date(Date.now() - 90 * 864e5).toISOString();
    return paginado((de, ate) => this.sb.from('crm_boletos').select('*').gte('criado_em', desde).order('criado_em').order('id').range(de, ate));
  };
  Local.prototype.boletos = async function () { return this.ler().boletos || []; };
  // O(a) vendedor(a) mandou o boleto ao cliente (só pela função: ela não altera a tabela).
  Supa.prototype.boletoCobrado = async function (ids) {
    return unwrap(await this.sb.rpc('crm_boleto_cobrado', { ids }));
  };
  Local.prototype.boletoCobrado = async function (ids) {
    const d = this.ler(), s = new Set(ids), agora = new Date().toISOString();
    let n = 0;
    d.boletos = (d.boletos || []).map(b => (s.has(b.id) && !b.cobrado_em ? (n++, Object.assign({}, b, { cobrado_em: agora, cobrado_por: LOCAL_ADMIN })) : b));
    this.gravar(d);
    return n;
  };
  Local.prototype.duplicatasAtraso = async function () {
    const hoje = R.hojeISO();
    return (this.ler().titulos || []).filter(t => t.empresa_id && t.vencimento < hoje);
  };
  // Títulos das parcelas de nota importada à mão e os da nota cancelada (a gestora grava sem ler a tabela).
  Supa.prototype.titulosDaNota = async function (novos, cancelados) {
    return unwrap(await this.sb.rpc('crm_titulos_da_nota', { novos: novos || [], cancelados: cancelados || [] }));
  };
  Local.prototype.titulosDaNota = async function (novos, cancelados) {
    const d = this.ler(), ja = new Set(d.titulos.map(t => t.duplicata)), pre = new Set(cancelados || []);
    const antes = d.titulos.length;
    d.titulos = d.titulos.filter(t => !(t.origem === 'nota' && pre.has(String(t.duplicata).split('/')[0])));
    const removidos = antes - d.titulos.length;
    const l = (novos || []).filter(t => !ja.has(t.duplicata)).map(t => this.novo(d, 'titulos', Object.assign({}, t, { origem: 'nota' })));
    d.titulos.push(...l);
    this.gravar(d);
    return { criados: l.length, removidos };
  };
  // Juntar cadastros: os títulos e os e-mails da cadência vão para o que fica.
  Supa.prototype.trocaEmpresaTitulos = async function (de, para) {
    if (!de.length) return 0;
    return unwrap(await this.sb.rpc('crm_titulos_troca_empresa', { de, para }));
  };
  Local.prototype.trocaEmpresaTitulos = async function (de, para) {
    const d = this.ler(), s = new Set(de);
    let n = 0;
    d.titulos.forEach(t => { if (s.has(t.empresa_id)) { t.empresa_id = para; n++; } });
    (d.email_envios || []).forEach(x => { if (s.has(x.empresa_id)) x.empresa_id = para; });
    this.gravar(d);
    return n;
  };
  Local.prototype.fknAtualizado = async function () {
    const est = await this.estoque(), tit = this.ler().titulos || [];
    const max = l => l.reduce((m, x) => (x.atualizado_em && x.atualizado_em > m ? x.atualizado_em : m), '') || null;
    return { estoque: max(est), receber: max(tit), pagar: max((this.ler().fin_lancamentos || []).filter(x => x.chave_fkn)), recusas: [] };
  };

  // Pedido de venda (Fase 3, 16/10/2026): carregado à parte (a tela Pedidos e a ficha). Os em aberto, em separação
  // ou separados, e os faturados/cancelados dos últimos 60 dias. Tudo que grava é função do banco. Lidos pela função
  // crm_pedidos_ler (20/10/2026): para a vendedora, os itens vêm sem o custo.
  Supa.prototype.pedidos = async function () {
    const desde = new Date(Date.now() - 60 * 864e5).toISOString(), out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await comTentativas(() => this.sb.rpc('crm_pedidos_ler', { p_desde: desde }).range(de, de + PAGINA - 1)));
      out.push(...l);
      if (l.length < PAGINA) return out;
    }
  };
  Supa.prototype.estoqueDisponivel = async function () {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await comTentativas(() => this.sb.rpc('crm_estoque_disponivel').range(de, de + PAGINA - 1)));
      out.push(...l);
      if (l.length < PAGINA) return out;
    }
  };
  Supa.prototype.pedidosAtualizar = async function () { return unwrap(await this.sb.rpc('crm_pedidos_atualizar')); };
  Supa.prototype.pedidosFaltas = async function () { return unwrap(await this.sb.rpc('crm_pedidos_faltas')); };
  Supa.prototype.boloes = async function () { return unwrap(await this.sb.from('crm_boloes').select('*').order('id', { ascending: false }).limit(60)); };
  Supa.prototype.pedidoGravar = async function (p) { return unwrap(await this.sb.rpc('crm_pedido_gravar', { p })); };
  Supa.prototype.pedidoSituacao = async function (id, para, motivo) { return unwrap(await this.sb.rpc('crm_pedido_situacao', { p_id: id, p_para: para, p_motivo: motivo || null })); };
  Supa.prototype.pedidoLiberar = async function (id, liberar, entrada) {
    return unwrap(await this.sb.rpc('crm_pedido_liberar', { p_id: id, p_liberar: liberar == null ? null : !!liberar, p_entrada: entrada == null ? null : !!entrada }));
  };
  Supa.prototype.pedidoComentar = async function (id, texto) { return unwrap(await this.sb.rpc('crm_pedido_comentar', { p_id: id, p_texto: texto })); };
  Supa.prototype.bolaoMontar = async function (ids, obs) { return unwrap(await this.sb.rpc('crm_bolao_montar', { p_pedidos: ids, p_obs: obs || null })); };
  Supa.prototype.pedidoSepararItem = async function (id, idx, ok) { return unwrap(await this.sb.rpc('crm_pedido_separar_item', { p_id: id, p_idx: idx, p_ok: !!ok })); };
  Supa.prototype.pedidoNotasCandidatas = async function (id) { return unwrap(await this.sb.rpc('crm_pedido_notas_candidatas', { p_id: id })); };
  Supa.prototype.pedidoFaturar = async function (id, nota) { return unwrap(await this.sb.rpc('crm_pedido_faturar', { p_id: id, p_nota: nota })); };
  Supa.prototype.pedidosTrocaEmpresa = async function (de, para) { return de.length ? unwrap(await this.sb.rpc('crm_pedidos_troca_empresa', { p_de: de, p_para: para })) : 0; };

  // Modo local (teste/demonstração): os pedidos ficam na memória e no navegador; o disponível vem do estoque local
  // (o CSV do FKN), com a mesma conta do banco (falta por ordem de chegada, bloqueios ESTOQUE / SEM ENTRADA / PREÇO).
  Local.prototype._peds = function () {
    if (!this._pedidos) { try { this._pedidos = JSON.parse(raiz.localStorage.getItem('crm_pedidos') || '[]'); } catch (e) { this._pedidos = []; } }
    return this._pedidos;
  };
  Local.prototype._pedsGrava = function () { try { raiz.localStorage.setItem('crm_pedidos', JSON.stringify(this._pedidos)); } catch (e) { /* só na memória */ } };
  const ABERTOS = ['aberto', 'separacao', 'separado'];
  const FATOR_LOCAL = 12; // caixa fechada no modo local (no banco vem de crm_estoque_unidades)
  Local.prototype._fisico = async function () {
    const m = new Map();
    (await this.estoque()).forEach(e => { if (!/\.\d+$/.test(e.codigo)) m.set(e.codigo, e.estoque_atual != null ? Number(e.estoque_atual) : Number(e.quantidade || 0) + Number(e.pend_cliente || 0)); });
    return m;
  };
  Local.prototype._faltas = async function () {
    const fis = await this._fisico(), usado = new Map(), out = [];
    this._peds().filter(p => ABERTOS.indexOf(p.situacao) !== -1).sort((a, b) => (a.situacao === 'aberto') - (b.situacao === 'aberto') || String(a.criado_em).localeCompare(String(b.criado_em)))
      .forEach(p => (p.itens || []).forEach((it, idx) => {
        if (!it.base || !fis.has(it.base)) return;
        const depois = (usado.get(it.base) || 0) + Number(it.qtd_est);
        usado.set(it.base, depois);
        const f = Math.min(Number(it.qtd_est), depois - fis.get(it.base));
        if (f > 0.0005) out.push({ pedido_id: p.id, idx, base: it.base, falta: Math.round(f / Number(it.fator || 1) * 1000) / 1000 });
      }));
    return out;
  };
  Local.prototype.pedidos = async function () { return this._peds().slice(); };
  Local.prototype.estoqueDisponivel = async function () {
    const est = await this.estoque(), fis = await this._fisico(), res = new Map();
    this._peds().filter(p => ABERTOS.indexOf(p.situacao) !== -1).forEach(p => (p.itens || []).forEach(it => { if (it.base) res.set(it.base, (res.get(it.base) || 0) + Number(it.qtd_est)); }));
    return est.map(e => {
      const base = e.codigo.replace(/\.\d+$/, ''), f = /\.\d+$/.test(e.codigo) ? FATOR_LOCAL : 1, fi = fis.get(base) || 0, r = res.get(base) || 0;
      return { codigo: e.codigo, descricao: e.descricao, unidade: e.unidade || (f > 1 ? 'CX' : null), localizacao: e.localizacao, linha: e.linha, familia: e.familia, situacao: e.situacao,
        fisico: fi / f, reservado: r / f, disponivel: (fi - r) / f, a_caminho: f > 1 ? null : e.pend_fornecedor, preco_venda: e.preco_venda, custo: e.custo_unit, fator: f, base };
    });
  };
  Local.prototype.pedidosAtualizar = async function () {
    const falt = new Set((await this._faltas()).map(f => f.pedido_id));
    this._peds().filter(p => p.situacao === 'aberto').forEach(p => {
      p.bloqueios = [falt.has(p.id) && 'ESTOQUE', !p.entrada_ok && /(vista|antecipad|pix|transfer|dep[oó]sito)/i.test((p.dados || {}).pagamento || '') && 'SEM ENTRADA',
        (p.itens || []).some(i => { const pl = Number(i.preco) * (1 - Number(i.desconto || 0) / 100), c = Number(i.custo) || 0;
          return c > 0 ? pl <= 0 || (pl - c) / pl * 100 < 23 - 0.005 : Number(i.preco_tab) > 0 && pl < Number(i.preco_tab) * 0.9 - 0.00005; }) && 'PREÇO'].filter(Boolean);
    });
    this._pedsGrava();
    return 0;
  };
  Local.prototype.pedidosFaltas = async function () { return this._faltas(); };
  Local.prototype.boloes = async function () { return (this._boloes || []).slice().reverse(); };
  Local.prototype.pedidoGravar = async function (p) {
    const est = new Map((await this.estoque()).map(e => [e.codigo, e]));
    const itens = (p.itens || []).map(x => {
      const cod = x.codigo ? String(x.codigo).toUpperCase().trim().replace(/\.0+$/, '') : null, e = (cod && est.get(cod)) || {};
      const base = cod && est.has(cod.replace(/\.\d+$/, '')) ? cod.replace(/\.\d+$/, '') : null, f = cod && /\.\d+$/.test(cod) ? FATOR_LOCAL : 1;
      if (!(Number(x.quantidade) > 0)) throw new Error('quantidade precisa ser maior que zero');
      return { codigo: cod, descricao: x.descricao || e.descricao || cod, unidade: x.unidade || e.unidade || null, quantidade: Number(x.quantidade), preco: Number(x.preco) || 0, desconto: Number(x.desconto) || 0,
        total: Math.round(Number(x.quantidade) * Number(x.preco || 0) * (1 - Number(x.desconto || 0) / 100) * 100) / 100, obs: x.obs || null,
        base, fator: f, qtd_est: Number(x.quantidade) * f, preco_tab: e.preco_venda == null ? null : e.preco_venda, custo: e.custo_unit == null ? null : e.custo_unit, separado: false };
    });
    if (!itens.length) throw new Error('o pedido não tem itens');
    const vp = Math.round(itens.reduce((s, i) => s + i.total, 0) * 100) / 100, fr = Number(p.frete) || 0, agora = new Date().toISOString();
    let r = p.id && this._peds().find(x => x.id === p.id);
    if (r && r.situacao !== 'aberto') throw new Error('o pedido ' + r.numero + ' já está ' + r.situacao);
    if (!r) {
      r = { id: uuid(), numero: this._peds().reduce((m, x) => Math.max(m, x.numero), 0) + 1, situacao: 'aberto', comentarios: [], bloqueios: [], liberado: [], entrada_ok: false, criado_em: agora, criado_por: LOCAL_ADMIN };
      this._peds().push(r);
    }
    Object.assign(r, { empresa_id: p.empresa_id, negocio_id: p.negocio_id || r.negocio_id || null, proposta_id: r.proposta_id || p.proposta_id || null, vendedor_id: p.vendedor_id || r.vendedor_id || LOCAL_ADMIN,
      tipo: p.tipo || 'normal', entrega: p.entrega || null, itens, valor_produtos: vp, frete: fr, valor_total: vp + fr, dados: p.dados || {}, liberado: [], atualizado_em: agora });
    await this.pedidosAtualizar();
    return Object.assign({}, r);
  };
  Local.prototype._ped = function (id) { const r = this._peds().find(x => x.id === id); if (!r) throw new Error('pedido não encontrado'); return r; };
  Local.prototype.pedidoSituacao = async function (id, para, motivo) {
    const r = this._ped(id);
    if (para === 'cancelado') { if (!motivo) throw new Error('diga o motivo do cancelamento'); Object.assign(r, { situacao: 'cancelado', cancelado_motivo: motivo }); }
    else if (para === 'separado') { if (r.situacao !== 'separacao') throw new Error('o pedido não está em separação'); r.situacao = 'separado'; }
    else if (para === 'aberto') { r.situacao = 'aberto'; r.bolao_id = null; r.itens.forEach(i => { i.separado = false; }); }
    else if (para === 'desfaturar') Object.assign(r, { situacao: 'separado', nota_id: null, faturado_em: null });
    await this.pedidosAtualizar();
    return Object.assign({}, r);
  };
  Local.prototype.pedidoLiberar = async function (id, liberar, entrada) {
    const r = this._ped(id);
    if (entrada != null) r.entrada_ok = !!entrada;
    await this.pedidosAtualizar();
    if (liberar != null) Object.assign(r, { liberado: liberar ? r.bloqueios.slice() : [], liberado_em: liberar ? new Date().toISOString() : null, liberado_por: liberar ? LOCAL_ADMIN : null });
    this._pedsGrava();
    return Object.assign({}, r);
  };
  Local.prototype.pedidoComentar = async function (id, texto) {
    const r = this._ped(id);
    r.comentarios = (r.comentarios || []).concat([{ quando: new Date().toISOString(), por: LOCAL_ADMIN, nome: 'Administrador (modo local)', texto }]);
    this._pedsGrava();
    return Object.assign({}, r);
  };
  Local.prototype.bolaoMontar = async function (ids) {
    await this.pedidosAtualizar();
    ids.forEach(id => {
      const r = this._ped(id);
      if (r.situacao !== 'aberto') throw new Error('o pedido ' + r.numero + ' não está em aberto');
      if (r.bloqueios.some(b => r.liberado.indexOf(b) === -1)) throw new Error('o pedido ' + r.numero + ' está bloqueado: a gestora precisa liberar');
    });
    this._boloes = this._boloes || [];
    const b = { id: this._boloes.length + 1, dia: new Date().toISOString().slice(0, 10), criado_em: new Date().toISOString() };
    this._boloes.push(b);
    ids.forEach(id => Object.assign(this._ped(id), { situacao: 'separacao', bolao_id: b.id }));
    this._pedsGrava();
    return b.id;
  };
  Local.prototype.pedidoSepararItem = async function (id, idx, ok) { const r = this._ped(id); r.itens[idx].separado = !!ok; this._pedsGrava(); return Object.assign({}, r); };
  Local.prototype.pedidoNotasCandidatas = async function (id) {
    const r = this._ped(id), usadas = new Set(this._peds().map(p => p.nota_id).filter(Boolean));
    return (this.ler().notas || []).filter(n => n.empresa_id === r.empresa_id && !n.cancelada && !usadas.has(n.id)).slice(0, 20);
  };
  Local.prototype.pedidoFaturar = async function (id, nota) {
    const r = this._ped(id), n = (this.ler().notas || []).find(x => x.id === nota);
    Object.assign(r, { situacao: 'faturado', nota_id: nota, faturado_em: n ? n.emitida_em : new Date().toISOString() });
    this._pedsGrava();
    return Object.assign({}, r);
  };
  Local.prototype.pedidosTrocaEmpresa = async function (de, para) {
    const s = new Set(de); let n = 0;
    this._peds().forEach(p => { if (s.has(p.empresa_id)) { p.empresa_id = para; n++; } });
    this._pedsGrava();
    return n;
  };

  // Comissão do mês fechado (Fase 3b): o administrador lê todas; cada um, a própria (RLS). Fechar e reabrir: funções do banco.
  Supa.prototype.comissoes = async function (mes) { return unwrap(await this.sb.from('crm_comissoes').select('*').eq('mes', mes)); };
  Supa.prototype.comissaoFechar = async function (mes, linhas) { return unwrap(await this.sb.rpc('crm_comissao_fechar', { p_mes: mes, p_linhas: linhas })); };
  Supa.prototype.comissaoReabrir = async function (mes) { return unwrap(await this.sb.rpc('crm_comissao_reabrir', { p_mes: mes })); };
  Local.prototype.comissoes = async function (mes) { return (this._comissoes || []).filter(c => c.mes === mes); };
  Local.prototype.comissaoFechar = async function (mes, linhas) {
    this._comissoes = this._comissoes || [];
    if (this._comissoes.some(c => c.mes === mes && c.fechado_em)) throw new Error('o mês já está fechado: reabra antes');
    this._comissoes = this._comissoes.filter(c => c.mes !== mes).concat(linhas.map(l => Object.assign({ mes, fechado_em: new Date().toISOString(), fechado_por: LOCAL_ADMIN }, l,
      { total: Math.round((Number(l.comissao) + (l.ajustes || []).reduce((t, a) => t + Number(a.valor), 0)) * 100) / 100 })));
    return linhas.length;
  };
  Local.prototype.comissaoReabrir = async function (mes) { let n = 0; (this._comissoes || []).forEach(c => { if (c.mes === mes && c.fechado_em) { c.fechado_em = null; c.reaberto_em = new Date().toISOString(); n++; } }); return n; };

  // NF-e emitida pelo CRM (Fase 4): a Edge Function crm-fiscal faz tudo que fala com a Sefaz (pelo serviço fiscal da VPS);
  // a leitura é direta (administrador, gestora e logística, pela RLS). Os XML vêm só quando pedidos (DANFE, fechamento).
  const NFE_COLUNAS = 'id,ambiente,serie,numero,pedido_id,empresa_id,chave,situacao,cstat,motivo,protocolo,autorizada_em,valor,totais,avisos,nota_id,eventos,tentativas,inutilizada_em,criado_por,criado_em,atualizado_em';
  Supa.prototype.fiscal = async function (corpo) {
    const r = await this.sb.functions.invoke('crm-fiscal', { body: corpo });
    if (r.error) throw await erroDaFuncao(r);
    return r.data;
  };
  Supa.prototype.nfes = async function () {
    const desde = new Date(Date.now() - 90 * 864e5).toISOString();
    return unwrap(await comTentativas(() => this.sb.from('crm_nfe').select(NFE_COLUNAS).or('criado_em.gte.' + desde + ',situacao.eq.pendente').order('criado_em', { ascending: false }).limit(1000)));
  };
  Supa.prototype.nfeXml = async function (id) { return unwrap(await this.sb.from('crm_nfe').select('chave, proc_xml, nfe_xml').eq('id', id).single()); };
  Supa.prototype.nfesDoMes = async function (mes) {
    const [a, m] = mes.split('-').map(Number), fim = (m === 12 ? (a + 1) + '-01' : a + '-' + String(m + 1).padStart(2, '0')) + '-01T00:00:00-03:00', out = [];
    for (let de = 0; ; de += 200) {
      const l = unwrap(await comTentativas(() => this.sb.from('crm_nfe').select(NFE_COLUNAS + ',proc_xml').eq('ambiente', 'producao').gte('autorizada_em', mes + '-01T00:00:00-03:00')
        .lt('autorizada_em', fim).order('numero').range(de, de + 199)));
      out.push(...l);
      if (l.length < 200) return out;
    }
  };
  Supa.prototype.nfeInutilizacoes = async function () { return unwrap(await this.sb.from('crm_nfe_inutilizacoes').select('*').order('criado_em', { ascending: false }).limit(200)); };

  // Tabela do IBPT (tributos aproximados): o administrador carrega o CSV; a crm-fiscal lê pelo NCM.
  Supa.prototype.ibptInfo = async function () {
    const um = unwrap(await this.sb.from('crm_ibpt').select('versao, chave, vig_ini, vig_fim, fonte').order('vig_fim', { ascending: false }).limit(1));
    const r = await this.sb.from('crm_ibpt').select('codigo', { count: 'exact', head: true });
    return Object.assign({}, um[0] || {}, { n: r.count || 0 });
  };
  Supa.prototype.ibptCarregar = async function (linhas) { return unwrap(await this.sb.rpc('crm_ibpt_carregar', { p_linhas: linhas })); };
  // Turma (turma.js): números do guia do dia, contados pela RLS de quem pergunta.
  Supa.prototype.turmaResumo = async function () { return unwrap(await this.sb.rpc('crm_turma_resumo')); };
  // Avisos do guia marcados por quem está logado (resolvido / amanhã): crm_turma_marcas, RLS só o dono.
  Supa.prototype.turmaMarcas = async function () { return unwrap(await this.sb.from('crm_turma_marcas').select('id, tipo, texto, n, ate')); };
  Supa.prototype.turmaMarcar = async function (m) { return unwrap(await this.sb.from('crm_turma_marcas').upsert(Object.assign({}, m, { em: new Date().toISOString() }), { onConflict: 'user_id,id' })); };
  Supa.prototype.turmaDesmarcar = async function (ids) { return unwrap(await this.sb.from('crm_turma_marcas').delete().in('id', ids)); };
  // Conversa com a IA da turma (crm-assistente): só consulta, com o login de quem pergunta.
  Supa.prototype.assistente = async function (corpo) {
    const r = await this.sb.functions.invoke('crm-assistente', { body: corpo });
    if (r.error) throw await erroDaFuncao(r);
    return r.data;
  };
  // Análise de compras do dia (comprador sênior, 19/10/2026): feita uma vez por dia pela crm-assistente.
  Supa.prototype.analiseCompras = async function (refazer) { return this.assistente({ acao: 'analise_compras', refazer: !!refazer }); };
  // Pendências do comprador no Painel (19/10/2026): notas de compra esperando entrada e as da Sefaz sem ciência.
  Supa.prototype.comprasPendentes = async function () { return unwrap(await this.sb.from('crm_compras').select('id, numero, fornecedor_nome, emitida_em, valor_total').eq('situacao', 'pendente').order('emitida_em', { ascending: false }).limit(100)); };
  Supa.prototype.dfeSemCiencia = async function () { const r = await this.sb.from('crm_dfe').select('chave', { count: 'exact', head: true }).eq('situacao', 'autorizada').is('xml_em', null).is('manifestada_em', null); if (r.error) throw r.error; return r.count || 0; };
  Local.prototype.comprasPendentes = async function () { return (this._compras || []).filter(c => c.situacao === 'pendente'); };
  Local.prototype.dfeSemCiencia = async function () { return 0; };
  Supa.prototype.analiseHoje = async function (dia) { return unwrap(await this.sb.from('crm_ia_analises').select('dia, texto, em').eq('dia', dia).eq('tipo', 'compras').maybeSingle()); };
  Local.prototype.analiseCompras = async function () { const a = { dia: R.hojeISO(), texto: '(modo local: sem IA) Aqui aparece a análise de compras do dia: **o que pedir hoje e de quem**, as notas que chegaram, o custo que subiu e o estoque parado.', em: new Date().toISOString(), nova: true }; this._analise = a; return a; };
  Local.prototype.analiseHoje = async function (dia) { return this._analise && this._analise.dia === dia ? this._analise : null; };
  // modo local: sem IA (serve para ver a tela); responde só com o eco da pergunta
  Local.prototype.assistente = async function (corpo) {
    if (corpo.acao === 'situacao') return { ligado: true, hoje: 0, limite: 40, custo_mes: null };
    return { conversa_id: corpo.conversa_id || 'local', resposta: '(modo local: sem IA) Você perguntou: **' + corpo.pergunta + '**\n- No sistema ligado ao banco eu consulto os dados e respondo aqui.', ferramentas: [] };
  };
  Local.prototype.turmaMarcas = async function () { return lsLe('crm_turma_marcas', []); };
  Local.prototype.turmaMarcar = async function (m) { lsGrava('crm_turma_marcas', lsLe('crm_turma_marcas', []).filter(x => x.id !== m.id).concat(m)); return m; };
  Local.prototype.turmaDesmarcar = async function (ids) { lsGrava('crm_turma_marcas', lsLe('crm_turma_marcas', []).filter(x => ids.indexOf(x.id) === -1)); };
  Local.prototype.turmaResumo = async function () {
    const peds = (() => { try { return JSON.parse(raiz.localStorage.getItem('crm_pedidos') || '[]'); } catch (e) { return []; } })();
    const conta = f => peds.filter(f).length, aberto = p => p.situacao === 'aberto', bloq = p => (p.bloqueios || []).some(b => (p.liberado || []).indexOf(b) === -1);
    return { pedidos: { bloqueados: conta(p => aberto(p) && bloq(p)), liberados: conta(p => aberto(p) && !bloq(p)), separacao: conta(p => p.situacao === 'separacao'), separado: conta(p => p.situacao === 'separado') } };
  };
  Local.prototype.ibptInfo = async function () { const l = this._ibpt || []; return Object.assign({}, l[0] || {}, { n: l.length }); };
  Local.prototype.ibptCarregar = async function (linhas) { const m = new Map((this._ibpt || []).map(x => [x.codigo + '|' + x.ex, x])); linhas.forEach(x => m.set(x.codigo + '|' + x.ex, x)); this._ibpt = [...m.values()]; return linhas.length; };

  // Modo local: SIMULAÇÃO (nada vai à Sefaz; serve para treinar e testar a tela).
  Local.prototype._nfeL = function () {
    if (!this._nfes) { try { this._nfes = JSON.parse(raiz.localStorage.getItem('crm_nfe_local') || '[]'); } catch (e) { this._nfes = []; } }
    return this._nfes;
  };
  Local.prototype._nfeGrava = function () { try { raiz.localStorage.setItem('crm_nfe_local', JSON.stringify(this._nfes)); } catch (e) { /* só na memória */ } };
  Local.prototype.fiscal = async function (b) {
    const l = this._nfeL(), fc = ((((this.ler().config || [])[0]) || {}).dados || {}).fiscal || {}, agora = new Date().toISOString();
    const amb = fc.ambiente === 'producao' ? 'producao' : 'homologacao', serie = Number(fc.serie == null ? 2 : fc.serie), r2 = v => Math.round(v * 100) / 100;
    if (b.acao === 'saude') return { ok: true, versao: 'modo local (simulação)', certificado: { titular: 'ONECLEAN (simulação)', validoAte: new Date(Date.now() + 13 * 864e5).toISOString() } };
    if (b.acao === 'status') return { cStat: 107, xMotivo: 'Servico em Operacao (simulação do modo local)' };
    if (b.acao === 'aprender_st') return { notas: 0, lidas: 0, semXml: 0, produtos: 0 };
    if (b.acao === 'previa' || b.acao === 'emitir') {
      if (!fc.emitente) throw new Error('falta configurar o emitente (aba Fiscal → Emissão)');
      const p = this._ped(b.pedido_id), e = (this.ler().empresas || []).find(x => x.id === p.empresa_id) || {};
      if (['faturado', 'cancelado'].indexOf(p.situacao) !== -1) throw new Error('o pedido já está ' + p.situacao);
      const bloqueia = e.cnpj ? [] : ['cliente sem CNPJ/CPF no cadastro'], vt = Number(p.valor_total) || 0;
      const totais = { vProd: Number(p.valor_produtos) || 0, vFrete: Number(p.frete) || 0, vDesc: 0, vBC: vt, vICMS: r2(vt * 0.18), vPIS: r2(vt * 0.82 * 0.0165), vCOFINS: r2(vt * 0.82 * 0.076), vNF: vt };
      const nota = { itens: (p.itens || []).map(i => ({ codigo: i.codigo, descricao: i.descricao, ncm: '—', cfop: '5102', icms: { cst: '00' }, pis: { cst: '01' }, unidade: i.unidade || 'UN',
        quantidade: i.quantidade, valorUnitario: i.preco, desconto: i.quantidade * i.preco * (i.desconto || 0) / 100 })), infCpl: 'PEDIDO CRM ' + p.numero };
      if (b.acao === 'previa') return { ambiente: amb, serie, bloqueado: bloqueia.length > 0, avisos: { bloqueia, conferir: ['modo local: é uma simulação, nada vai à Sefaz'] }, totais, nota };
      if (bloqueia.length) throw new Error(bloqueia.join('; '));
      let n = l.find(x => x.pedido_id === p.id && x.ambiente === amb && ['reservada', 'rejeitada', 'bloqueada'].indexOf(x.situacao) !== -1 && !x.inutilizada_em);
      if (!n) {
        const numero = l.filter(x => x.ambiente === amb && x.serie === serie).reduce((m, x) => Math.max(m, x.numero), 0) + 1;
        n = { id: uuid(), ambiente: amb, serie, numero, pedido_id: p.id, empresa_id: p.empresa_id, eventos: [], tentativas: 0, criado_em: agora };
        l.push(n);
      }
      Object.assign(n, { chave: '3526' + String(Date.now()).padStart(40, '0').slice(-40), situacao: 'autorizada', cstat: 100, motivo: 'Autorizado o uso da NF-e (simulação)', protocolo: '1352' + String(Date.now()).slice(-11),
        autorizada_em: agora, atualizado_em: agora, valor: vt, totais, tentativas: (n.tentativas || 0) + 1 });
      if (amb === 'producao') Object.assign(p, { situacao: 'faturado', faturado_em: agora });
      this._nfeGrava(); this._pedsGrava();
      return { nfe: Object.assign({}, n) };
    }
    const n = l.find(x => x.id === b.nfe_id);
    if (b.acao === 'consultar') { if (!n) throw new Error('nota não encontrada'); return { nfe: Object.assign({}, n) }; }
    if (b.acao === 'cancelar' || b.acao === 'cce') {
      if (!n || n.situacao !== 'autorizada') throw new Error('só nota autorizada');
      const ev = { tipo: b.acao, seq: b.acao === 'cce' ? n.eventos.filter(x => x.tipo === 'cce').length + 1 : 1, quando: agora, cstat: 135, motivo: 'Evento registrado (simulação)', protocolo: '1352' + String(Date.now()).slice(-11), texto: b.texto };
      n.eventos.push(ev);
      if (b.acao === 'cancelar') {
        n.situacao = 'cancelada';
        const p = n.pedido_id && this._peds().find(x => x.id === n.pedido_id);
        if (p && n.ambiente === 'producao') Object.assign(p, { situacao: 'separado', faturado_em: null, nota_id: null });
        this._pedsGrava();
      }
      this._nfeGrava();
      return { ok: true, evento: ev };
    }
    if (b.acao === 'inutilizar') {
      this._inuts = this._inuts || [];
      this._inuts.unshift({ id: this._inuts.length + 1, ambiente: amb, serie: Number(b.serie), de: Number(b.de), ate: Number(b.ate), justificativa: b.texto, cstat: 102, motivo: 'Inutilizacao de numero homologado (simulação)', criado_em: agora });
      l.filter(x => x.ambiente === amb && x.serie === Number(b.serie) && x.numero >= b.de && x.numero <= b.ate).forEach(x => { x.inutilizada_em = agora; });
      this._nfeGrava();
      return { ok: true, cStat: 102, motivo: 'Inutilizacao de numero homologado (simulação)' };
    }
    throw new Error('ação desconhecida');
  };
  Local.prototype.nfes = async function () { return this._nfeL().slice().sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em))).map(n => Object.assign({}, n)); };
  Local.prototype.nfeXml = async function (id) { const n = this._nfeL().find(x => x.id === id); return { chave: n && n.chave, proc_xml: null, nfe_xml: null }; };
  Local.prototype.nfesDoMes = async function () { return []; };
  Local.prototype.nfeInutilizacoes = async function () { return (this._inuts || []).slice(); };

  // ---------------------------------------------------------------- fotos e fichas técnicas dos produtos (19/10/2026)
  // Bucket público crm-produtos-fotos (fotos/, fichas/, sugestoes/); crm_produto_fotos e crm_produto_info a equipe toda lê,
  // só administrador e comprador gravam (RLS). A busca pela IA é a Edge Function crm-produto-buscar.
  const FOTOS = 'crm-produtos-fotos';
  Supa.prototype.fotoUrl = function (caminho) { return caminho ? this.sb.storage.from(FOTOS).getPublicUrl(caminho).data.publicUrl : ''; };
  Supa.prototype.produtoFotos = async function () {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await comTentativas(() => this.sb.from('crm_produto_fotos').select('codigo, caminho, fonte, fonte_url, atualizado_em').order('codigo').range(de, de + PAGINA - 1)));
      out.push(...l);
      if (l.length < PAGINA) return out;
    }
  };
  Supa.prototype.produtoInfos = async function () {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await comTentativas(() => this.sb.from('crm_produto_info').select('*').order('codigo').range(de, de + PAGINA - 1)));
      out.push(...l);
      if (l.length < PAGINA) return out;
    }
  };
  Supa.prototype.produtoSugestoes = async function () { return paginado((de, ate) => this.sb.from('crm_produto_fotos_sugestoes').select('*').order('em', { ascending: false }).order('codigo').range(de, ate)); };
  Supa.prototype.produtosVendidos = async function (dias) {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await comTentativas(() => this.sb.rpc('crm_produtos_vendidos', { p_dias: dias || 90 }).range(de, de + PAGINA - 1)));
      out.push(...l);
      if (l.length < PAGINA) return out;
    }
  };
  Supa.prototype.produtoBuscar = async function (corpo) {
    const r = await this.sb.functions.invoke('crm-produto-buscar', { body: corpo });
    if (r.error) throw await erroDaFuncao(r);
    return r.data;
  };
  // Arquivo do bucket como Blob (a foto sugerida, para reduzir antes de guardar; a ficha em PDF, para copiar): pela API
  // (política "crm fotos le", só administrador e comprador), que não depende do CORS do endereço público.
  Supa.prototype.fotoBaixar = async function (caminho) {
    const r = await this.sb.storage.from(FOTOS).download(caminho);
    if (r.error) throw new Error('não consegui baixar o arquivo (' + (r.error.message || r.error) + ')');
    return r.data;
  };
  // Guarda um arquivo novo (nome único: o navegador pode guardar por um ano) e devolve o caminho.
  Supa.prototype.fotoSubir = async function (pasta, codigo, blob, ext) {
    const caminho = pasta + '/' + String(codigo).replace(/[^0-9A-Za-z.\-]/g, '_') + '-' + Date.now().toString(36) + '.' + ext;
    unwrap(await this.sb.storage.from(FOTOS).upload(caminho, blob, { contentType: blob.type || undefined, upsert: false, cacheControl: '31536000' }));
    return caminho;
  };
  Supa.prototype.fotoApagar = async function (caminhos) { const l = (caminhos || []).filter(Boolean); if (l.length) await this.sb.storage.from(FOTOS).remove(l); };
  Supa.prototype.produtoFotoGravar = async function (linha) { return unwrap(await this.sb.from('crm_produto_fotos').upsert(Object.assign({}, linha, { atualizado_em: new Date().toISOString() })).select().single()); };
  Supa.prototype.produtoFotoTirar = async function (codigo) { return unwrap(await this.sb.from('crm_produto_fotos').delete().eq('codigo', codigo)); };
  Supa.prototype.produtoInfoGravar = async function (linha) { return unwrap(await this.sb.from('crm_produto_info').upsert(Object.assign({}, linha, { atualizado_em: new Date().toISOString() })).select().single()); };
  // Quem compra o produto, pelas notas que a pessoa enxerga (RLS: a vendedora vê a carteira dela), a compra mais recente primeiro.
  Supa.prototype.produtoClientes = async function (codigo, limite) { return unwrap(await this.sb.rpc('crm_produto_clientes', { p_codigo: codigo, p_limite: limite || 8 })); };
  // Tela Produtos (20/10/2026): os códigos de barras para a pesquisa (todos) e o que só o administrador e o comprador veem
  // de um produto (saldo e custo médio do livro, histórico do custo, últimas notas de compra, embalagens). Cada parte
  // que a RLS não deixar ver volta vazia.
  // NCM de cada produto para o orçamento do cliente (20/10/2026): só o NCM, para qualquer pessoa ativa.
  Supa.prototype.produtosNcm = async function () { return paginado((de, ate) => this.sb.rpc('crm_produtos_ncm').range(de, ate)); };
  Supa.prototype.produtosEans = async function () { return paginado((de, ate) => this.sb.rpc('crm_produtos_eans').range(de, ate)); };
  Supa.prototype.produtoDetalhe = async function (codigo) {
    const ok = async (q, vazio) => { try { return unwrap(await q) || vazio; } catch (e) { return vazio; } };
    const [saldo, hist, compras, unidades] = await Promise.all([
      ok(this.sb.from('crm_estoque_saldo').select('*').eq('codigo', codigo).maybeSingle(), null),
      ok(this.sb.from('crm_custo_historico').select('*').eq('codigo', codigo).order('em', { ascending: false }).limit(12), []),
      ok(this.sb.from('crm_compra_itens').select('quantidade, unidade, valor_total, ipi, st, frete, outras, fator, cod_fornecedor, crm_compras!inner(numero, emitida_em, fornecedor_nome)').eq('codigo', codigo).limit(60), []),
      ok(this.sb.from('crm_estoque_unidades').select('*').eq('codigo', codigo).order('unidade'), [])
    ]);
    const comp = (compras || []).map(i => Object.assign({}, i, i.crm_compras || {}, { crm_compras: undefined }))
      .sort((a, b) => String(b.emitida_em || '').localeCompare(String(a.emitida_em || ''))).slice(0, 10);
    return { saldo, hist, compras: comp, unidades };
  };
  Supa.prototype.sugestaoMarcar = async function (codigo, situacao) { return unwrap(await this.sb.from('crm_produto_fotos_sugestoes').update({ situacao }).eq('codigo', codigo)); };

  // Modo local: as fotos ficam no navegador como data: (serve para ver as telas); sem IA (a busca devolve "sem").
  const lsObj = k => lsLe(k, {});
  Local.prototype.fotoUrl = function (caminho) { return caminho && /^data:/.test(caminho) ? caminho : (lsObj('crm_fotos_arquivos')[caminho] || ''); };
  Local.prototype.produtoFotos = async function () { return Object.values(lsObj('crm_produto_fotos')); };
  Local.prototype.produtoInfos = async function () { return Object.values(lsObj('crm_produto_info')); };
  Local.prototype.produtoSugestoes = async function () { return Object.values(lsObj('crm_produto_sugestoes')); };
  Local.prototype.produtosVendidos = async function () {
    const m = new Map();
    (this.ler().notas || []).forEach(n => (n.itens || []).forEach(i => { if (!i.codigo) return; const k = String(i.codigo).replace(/\.\d+$/, ''); m.set(k, (m.get(k) || 0) + Number(i.quantidade || 0)); }));
    return [...m.entries()].map(([codigo, quantidade]) => ({ codigo, quantidade, notas: 1 }));
  };
  Local.prototype.produtoBuscar = async function (corpo) {
    if (corpo.acao === 'situacao') return { ligado: false, custo_mes: 0, custo_fotos_mes: 0 };
    const l = { codigo: corpo.codigo, candidatos: [], info: null, busca: corpo.busca || '', erro: 'modo local: sem IA', situacao: 'erro', em: new Date().toISOString(), custo_usd: 0 };
    const s = lsObj('crm_produto_sugestoes'); s[corpo.codigo] = l; lsGrava('crm_produto_sugestoes', s);
    return l;
  };
  Local.prototype.fotoBaixar = async function (caminho) {
    const u = this.fotoUrl(caminho), m = /^data:([^;,]+);base64,(.*)$/.exec(u || '');
    if (!m) throw new Error('arquivo não encontrado');
    const bin = atob(m[2]), b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return new Blob([b], { type: m[1] });
  };
  Local.prototype.fotoSubir = async function (pasta, codigo, blob, ext) {
    const dataUrl = await new Promise((ok, erro) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = erro; f.readAsDataURL(blob); });
    const caminho = pasta + '/' + codigo + '-' + Date.now().toString(36) + '.' + ext, a = lsObj('crm_fotos_arquivos');
    a[caminho] = dataUrl; lsGrava('crm_fotos_arquivos', a);
    return caminho;
  };
  Local.prototype.fotoApagar = async function (caminhos) { const a = lsObj('crm_fotos_arquivos'); (caminhos || []).forEach(c => delete a[c]); lsGrava('crm_fotos_arquivos', a); };
  Local.prototype.produtoFotoGravar = async function (linha) { const s = lsObj('crm_produto_fotos'); s[linha.codigo] = Object.assign({}, linha, { atualizado_em: new Date().toISOString() }); lsGrava('crm_produto_fotos', s); return s[linha.codigo]; };
  Local.prototype.produtoFotoTirar = async function (codigo) { const s = lsObj('crm_produto_fotos'); delete s[codigo]; lsGrava('crm_produto_fotos', s); };
  Local.prototype.produtoInfoGravar = async function (linha) { const s = lsObj('crm_produto_info'); s[linha.codigo] = Object.assign({}, s[linha.codigo], linha, { atualizado_em: new Date().toISOString() }); lsGrava('crm_produto_info', s); return s[linha.codigo]; };
  Local.prototype.produtosEans = async function () { return []; };
  Local.prototype.produtosNcm = async function () { return lsLe('crm_produtos_ncm', []); };
  Local.prototype.produtoDetalhe = async function () { return { saldo: null, hist: [], compras: [], unidades: [] }; };
  Local.prototype.produtoClientes = async function (codigo, limite) {
    const base = c => String(c || '').replace(/\.\d+$/, ''), m = new Map();
    (this.ler().notas || []).filter(n => !n.cancelada).forEach(n => (n.itens || []).filter(i => base(i.codigo) === base(codigo)).forEach(i => {
      const k = n.empresa_id || n.cliente_nome, c = m.get(k) || { empresa_id: n.empresa_id || null, nome: n.cliente_nome || '', ultima: n.emitida_em, quantidade: 0, notas: new Set() };
      c.quantidade += Number(i.quantidade || 0); c.notas.add(n.id); if (String(n.emitida_em) > String(c.ultima)) c.ultima = n.emitida_em; m.set(k, c);
    }));
    return [...m.values()].map(c => Object.assign(c, { notas: c.notas.size })).sort((a, b) => String(b.ultima).localeCompare(String(a.ultima))).slice(0, limite || 8);
  };
  Local.prototype.sugestaoMarcar = async function (codigo, situacao) { const s = lsObj('crm_produto_sugestoes'); if (s[codigo]) s[codigo].situacao = situacao; lsGrava('crm_produto_sugestoes', s); };

  raiz.CRMDados = { TABELAS, INTEIRAS, PARCIAIS, aplicaMudancas, marcaRecarga, chave, Local, Supa, uuid, vazio, LOCAL_ADMIN, cascataMemoria, situacaoVigia, PARADO_MIN, lembreteFkn };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.CRMDados;
})(typeof window !== 'undefined' ? window : globalThis);
