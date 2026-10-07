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
    'empresas', 'contatos', 'negocios', 'negocio_itens', 'propostas', 'atividades', 'notas', 'nota_itens', 'titulos', 'email_campanhas', 'email_envios'];
  // Financeiro (contas a pagar e caixa): só o administrador; carregado à parte, ao abrir o Caixa.
  const FIN = ['fin_recorrentes', 'fin_lancamentos', 'fin_saldos', 'fin_regras', 'fin_titulos_baixados'];
  const CHAVE = { usuarios: 'user_id' };
  const chave = t => CHAVE[t] || 'id';

  function vazio() { const d = {}; TABELAS.forEach(t => { d[t] = []; }); return d; }
  const finVazio = d => ({ recorrentes: (d && d.fin_recorrentes) || [], lancamentos: (d && d.fin_lancamentos) || [], saldos: (d && d.fin_saldos) || [], regras: (d && d.fin_regras) || [],
    baixados: (d && d.fin_titulos_baixados) || [] });

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
    email_campanhas: { ativa: true },
    email_envios: { situacao: 'pulado', para: [] }
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
    FIN.forEach(t => { base[t] = d && Array.isArray(d[t]) ? d[t] : []; });
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
    FIN.forEach(t => { delete d[t]; });
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
  const INTEIRAS = ['usuarios', 'config', 'etapas', 'opcoes', 'modelos', 'metas', 'filtros', 'titulos', 'email_campanhas', 'email_envios'];
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
    return finVazio({ fin_recorrentes: r[0], fin_lancamentos: r[1], fin_saldos: r[2], fin_regras: r[3], fin_titulos_baixados: r[4] });
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
  Local.prototype.estoque = async function () { try { return JSON.parse(localStorage.getItem('crm_estoque') || '[]'); } catch (e) { return this._estoque || []; } };
  Local.prototype.salvarEstoque = async function (lista) {
    const l = lista.map(x => Object.assign({}, x, { atualizado_em: new Date().toISOString() }));
    this._estoque = l;
    try { localStorage.setItem('crm_estoque', JSON.stringify(l)); } catch (e) { /* só na memória */ }
    return l.length;
  };

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
    return r.error ? [] : r.data.filter(x => x.uso !== 'caixa'); // a senha de leitura do Caixa não é vigia
  };

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

  // E-mails da cadência: a Edge Function crm-email envia pelo Brevo (a chave fica só no Supabase).
  Supa.prototype.email = async function (corpo) {
    const r = await this.sb.functions.invoke('crm-email', { body: corpo });
    if (r.error) {
      let msg = r.error.message;
      try { const j = await r.error.context.json(); if (j && j.erro) msg = j.erro; } catch (e) { /* sem corpo */ }
      throw new Error(msg);
    }
    return r.data;
  };
  // Modo local (demonstração e testes): "envia" sem sair do navegador — grava o envio e a atividade.
  Local.prototype.email = async function (corpo) {
    if (corpo.acao === 'situacao') return { ligado: true, local: true };
    if (corpo.acao === 'aberturas') return { ok: true, abertos: 0, clicados: 0, devolvidos: 0 };
    const d = this.ler(), e = d.empresas.find(x => x.id === corpo.empresa_id);
    if (!e) throw new Error('cliente não encontrado');
    if (e.email_sair_em) throw new Error('o cliente pediu para não receber estes e-mails');
    const env = this.novo(d, 'email_envios', { empresa_id: e.id, responsavel_id: e.responsavel_id || null, tipo: corpo.tipo, campanha_id: corpo.campanha_id || null,
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
  // Duplicatas EM ATRASO, com detalhe (gestora e vendedoras não leem o contas a receber — ver schema.sql).
  Supa.prototype.duplicatasAtraso = async function () {
    return unwrap(await comTentativas(() => this.sb.rpc('crm_duplicatas_atraso'))) || [];
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
  // Juntar cadastros: os títulos vão para o que fica.
  Supa.prototype.trocaEmpresaTitulos = async function (de, para) {
    if (!de.length) return 0;
    return unwrap(await this.sb.rpc('crm_titulos_troca_empresa', { de, para }));
  };
  Local.prototype.trocaEmpresaTitulos = async function (de, para) {
    const d = this.ler(), s = new Set(de);
    let n = 0;
    d.titulos.forEach(t => { if (s.has(t.empresa_id)) { t.empresa_id = para; n++; } });
    this.gravar(d);
    return n;
  };
  Local.prototype.fknAtualizado = async function () {
    const est = await this.estoque(), tit = this.ler().titulos || [];
    const max = l => l.reduce((m, x) => (x.atualizado_em && x.atualizado_em > m ? x.atualizado_em : m), '') || null;
    return { estoque: max(est), receber: max(tit), pagar: max((this.ler().fin_lancamentos || []).filter(x => x.chave_fkn)), recusas: [] };
  };

  raiz.CRMDados = { TABELAS, INTEIRAS, PARCIAIS, aplicaMudancas, marcaRecarga, chave, Local, Supa, uuid, vazio, LOCAL_ADMIN, cascataMemoria, situacaoVigia, PARADO_MIN, lembreteFkn };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.CRMDados;
})(typeof window !== 'undefined' ? window : globalThis);
