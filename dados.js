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
    'empresas', 'contatos', 'negocios', 'negocio_itens', 'propostas', 'atividades', 'notas', 'nota_itens'];
  const CHAVE = { usuarios: 'user_id' };
  const chave = t => CHAVE[t] || 'id';

  function vazio() { const d = {}; TABELAS.forEach(t => { d[t] = []; }); return d; }

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
    nota_itens: { quantidade: 0, valor_unitario: 0, valor_total: 0, ordem: 0 }
  };

  // Filhos apagados junto (no Supabase é o "on delete cascade"/"set null").
  const CASCATA = {
    empresas: [['contatos', 'empresa_id', 'apaga'], ['negocios', 'empresa_id', 'apaga'], ['atividades', 'empresa_id', 'apaga'], ['notas', 'empresa_id', 'solta']],
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
    return Promise.resolve(d);
  };

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
    return m;
  }

  async function tudo(sb, t) {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const ordem = t === 'config' ? 'id' : chave(t) === 'user_id' ? 'nome' : 'criado_em';
      const lote = unwrap(await sb.from(tab(t)).select('*').order(ordem).order(chave(t)).range(de, de + PAGINA - 1));
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
  // Estoque (CSV do FKM): lido e gravado só pela tela Gestão (administrador). Gravar = retrato
  // novo: atualiza por código e apaga o que saiu do relatório.
  Supa.prototype.clientesCompras = async function () {
    const out = [];
    for (let de = 0; ; de += PAGINA) {
      const l = unwrap(await this.sb.rpc('crm_clientes_compras').range(de, de + PAGINA - 1));
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

  Supa.prototype.integracoes = async function () {
    const [c, l] = await Promise.all([
      this.sb.from('crm_integracoes').select('id,nome,filtro,ativo,ultimo_uso,criado_em').order('criado_em'),
      this.sb.from('crm_integracao_log').select('*').order('quando', { ascending: false }).limit(40)
    ]);
    return { chaves: c.error ? [] : c.data, registro: unwrap(l) };
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

  // Mesma cascata aplicada na memória do app (depois de apagar no banco).
  function cascataMemoria(d, t, ids) {
    const k = chave(t);
    const s = new Set(ids);
    d[t] = d[t].filter(r => !s.has(r[k]));
    cascata(d, t, s);
  }

  raiz.CRMDados = { TABELAS, chave, Local, Supa, uuid, vazio, LOCAL_ADMIN, cascataMemoria };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.CRMDados;
})(typeof window !== 'undefined' ? window : globalThis);
