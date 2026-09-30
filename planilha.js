/* CRM Sistemi Dalessi — importação.
   Três entradas, um só planejador:
   - planilha (CSV/XLSX) com mapeamento de colunas (adivinhado pelos nomes);
   - arquivo bruto da API do Agendor (ferramentas/agendor-exportar.js);
   - tudo vira "registros normalizados" -> planeja() decide o que cria, o que
     atualiza e o que ignora, sem duplicar (externo_id, CNPJ, e-mail, telefone, nome).
   Puro: sem DOM e sem banco. Testado em crm/testes/. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  const uuid = () => (raiz.CRMDados ? raiz.CRMDados.uuid() : require('crypto').randomUUID());

  // ------------------------------------------------------------ campos por tipo
  // [campo, rótulo, sinônimos de cabeçalho (já normalizados)]
  const CAMPOS = {
    empresas: [
      ['nome', 'Nome / nome fantasia', ['nome', 'nome fantasia', 'fantasia', 'empresa', 'cliente', 'organizacao', 'nome da empresa']],
      ['razao_social', 'Razão social', ['razao social', 'razao']],
      ['cnpj', 'CNPJ / CPF', ['cnpj', 'cpf cnpj', 'cnpj cpf', 'documento', 'cpf']],
      ['situacao', 'Situação (lead/cliente...)', ['situacao', 'categoria', 'status', 'tipo', 'tipo de cliente']],
      ['segmento', 'Segmento', ['segmento', 'setor', 'ramo', 'ramo de atividade', 'atividade']],
      ['origem', 'Origem', ['origem', 'origem do lead', 'canal', 'fonte']],
      ['responsavel', 'Responsável (nome ou e-mail)', ['responsavel', 'vendedor', 'dono', 'proprietario', 'usuario responsavel', 'executivo']],
      ['telefone', 'Telefone', ['telefone', 'telefone comercial', 'fone', 'tel', 'telefone fixo', 'telefone 1']],
      ['whatsapp', 'WhatsApp / celular', ['whatsapp', 'celular', 'cel', 'telefone celular', 'telefone 2', 'movel']],
      ['email', 'E-mail', ['e mail', 'email', 'e mail comercial', 'email comercial']],
      ['site', 'Site', ['site', 'website', 'pagina', 'url']],
      ['cep', 'CEP', ['cep', 'codigo postal']],
      ['logradouro', 'Endereço (rua)', ['rua', 'endereco', 'logradouro', 'endereco rua']],
      ['numero', 'Número', ['numero', 'n', 'no', 'num']],
      ['complemento', 'Complemento', ['complemento']],
      ['bairro', 'Bairro', ['bairro', 'distrito']],
      ['cidade', 'Cidade', ['cidade', 'municipio']],
      ['uf', 'UF', ['estado', 'uf']],
      ['tags', 'Etiquetas (separadas por vírgula)', ['etiquetas', 'tags', 'etiqueta', 'marcadores']],
      ['qualificacao', 'Qualificação (0 a 5)', ['ranking', 'qualificacao', 'estrelas', 'classificacao']],
      ['observacoes', 'Observações', ['descricao', 'observacoes', 'observacao', 'obs', 'anotacoes', 'notas']],
      ['externo_id', 'Código no sistema antigo', ['codigo da empresa', 'id', 'codigo', 'cod', 'id empresa', 'codigo do cliente']],
      ['criado_em', 'Data de cadastro', ['data de cadastro', 'criado em', 'data de criacao', 'cadastrado em', 'data cadastro']]
    ],
    contatos: [
      ['nome', 'Nome da pessoa', ['nome', 'pessoa', 'contato', 'nome do contato', 'nome da pessoa']],
      ['empresa', 'Empresa', ['empresa', 'organizacao', 'nome da empresa', 'cliente']],
      ['empresa_cnpj', 'CNPJ da empresa', ['cnpj', 'cnpj da empresa']],
      ['cargo', 'Cargo', ['cargo', 'funcao', 'papel']],
      ['email', 'E-mail', ['e mail', 'email']],
      ['telefone', 'Telefone', ['telefone', 'telefone comercial', 'fone', 'tel']],
      ['celular', 'Celular', ['celular', 'cel', 'telefone celular', 'movel']],
      ['whatsapp', 'WhatsApp', ['whatsapp']],
      ['aniversario', 'Aniversário', ['aniversario', 'data de nascimento', 'nascimento']],
      ['responsavel', 'Responsável', ['responsavel', 'vendedor', 'dono']],
      ['origem', 'Origem', ['origem', 'origem do lead']],
      ['observacoes', 'Observações', ['descricao', 'observacoes', 'obs']],
      ['externo_id', 'Código no sistema antigo', ['id', 'codigo']]
    ],
    negocios: [
      ['titulo', 'Título do negócio', ['titulo', 'titulo do negocio', 'negocio', 'nome do negocio', 'oportunidade', 'nome']],
      ['empresa', 'Empresa', ['empresa', 'empresa relacionada', 'organizacao', 'cliente', 'nome da empresa']],
      ['empresa_externo', 'Código da empresa (sistema antigo)', ['codigo da empresa']],
      ['contato', 'Pessoa', ['pessoa', 'contato']],
      ['valor', 'Valor', ['valor', 'valor total', 'total', 'valor do negocio']],
      ['funil', 'Funil', ['funil', 'pipeline']],
      ['etapa', 'Etapa', ['etapa', 'fase', 'estagio', 'etapa do funil']],
      ['status', 'Status (em andamento/ganho/perdido)', ['status', 'situacao', 'resultado']],
      ['criado_em', 'Data de início', ['data de inicio', 'inicio', 'data de criacao', 'criado em', 'data de cadastro']],
      ['previsao_fechamento', 'Previsão de fechamento', ['previsao', 'data prevista', 'previsao de fechamento', 'data de previsao', 'fechamento previsto']],
      ['fechado_em', 'Data de fechamento', ['data de conclusao', 'data de fechamento', 'data de termino', 'fechado em', 'concluido em', 'data do fechamento']],
      ['motivo_perda', 'Motivo de perda', ['motivo de perda', 'motivo da perda', 'motivo']],
      ['responsavel', 'Responsável', ['responsavel', 'vendedor', 'dono']],
      ['origem', 'Origem', ['origem']],
      ['observacoes', 'Descrição', ['descricao', 'observacoes', 'obs']],
      ['externo_id', 'Código no sistema antigo', ['codigo do negocio', 'id', 'codigo']]
    ],
    atividades: [
      ['descricao', 'Descrição / texto', ['texto', 'descricao', 'assunto', 'tarefa', 'atividade', 'comentario', 'anotacao']],
      ['tipo', 'Tipo', ['tipo', 'tipo de tarefa', 'tipo de atividade']],
      ['data_hora', 'Data', ['data', 'data de agendamento', 'data da tarefa', 'data agendada', 'prazo', 'vencimento', 'data e hora', 'agendada para']],
      ['hora', 'Hora', ['hora', 'horario']],
      ['concluida', 'Concluída? (sim/não)', ['concluida', 'realizada', 'feita', 'finalizada', 'status']],
      ['concluida_em', 'Data de conclusão', ['data de conclusao', 'data de finalizacao', 'concluida em', 'finalizada em', 'realizada em']],
      ['responsavel', 'Responsável', ['responsavel', 'usuarios responsaveis', 'usuario', 'vendedor', 'atribuida a']],
      ['empresa', 'Empresa', ['empresa', 'empresa relacionada', 'organizacao', 'cliente']],
      ['empresa_externo', 'Código da empresa (sistema antigo)', ['codigo da empresa']],
      ['contato', 'Pessoa', ['pessoa', 'pessoa relacionada', 'contato']],
      ['negocio', 'Negócio', ['negocio', 'negocio relacionado', 'titulo do negocio']],
      ['negocio_externo', 'Código do negócio (sistema antigo)', ['codigo do negocio']],
      ['externo_id', 'Código no sistema antigo', ['codigo da atividade', 'id', 'codigo']]
    ],
    produtos: [
      ['nome', 'Nome do produto', ['nome', 'produto', 'descricao', 'nome do produto']],
      ['codigo', 'Código', ['codigo', 'cod', 'sku', 'referencia', 'ref']],
      ['unidade', 'Unidade', ['unidade', 'un', 'und', 'unid']],
      ['categoria', 'Categoria', ['categoria', 'grupo', 'linha']],
      ['preco', 'Preço', ['preco', 'valor', 'preco unitario', 'valor unitario', 'preco de venda']],
      ['externo_id', 'Código no sistema antigo', ['id']]
    ]
  };

  const OBRIGATORIO = { empresas: 'nome', contatos: 'nome', negocios: 'titulo', atividades: 'descricao', produtos: 'nome' };

  function normCab(s) { return R.normaliza(s).replace(/[^a-z0-9]+/g, ' ').trim(); }

  // cabecalhos -> { indiceColuna: campo }. Exato primeiro, depois "contém".
  function adivinhaMapeamento(tipo, cabecalhos) {
    const campos = CAMPOS[tipo];
    const usado = new Set();
    const mapa = {};
    const cabs = cabecalhos.map(normCab);
    // 1º: nome exato, na ordem de preferência dos sinônimos (com "Celular" e "WhatsApp" na mesma
    // planilha, a coluna WhatsApp fica com o WhatsApp).
    campos.forEach(([campo, , sin]) => {
      for (const s of sin) {
        const i = cabs.findIndex((c, j) => c === s && mapa[j] == null);
        if (i !== -1) { mapa[i] = campo; usado.add(campo); return; }
      }
    });
    cabs.forEach((c, i) => {
      if (mapa[i] || c.length < 4) return;
      for (const [campo, , sin] of campos) {
        if (!usado.has(campo) && sin.some(s => s.length >= 4 && c.indexOf(s) !== -1)) { mapa[i] = campo; usado.add(campo); return; }
      }
    });
    return mapa;
  }

  // Planilha exportada do Agendor ("Código da empresa", "Código do Negócio", "Código da
  // atividade"): os códigos viram os mesmos ids da importação pela API (agendor:org:123 etc.),
  // para reimportar sem duplicar o que já veio de lá.
  const PREFIXO_AGENDOR = { empresas: 'org', contatos: 'pessoa', negocios: 'negocio', atividades: 'tarefa' };
  function ehPlanilhaAgendor(cabecalhos) {
    const c = cabecalhos.map(normCab);
    return ['codigo da empresa', 'codigo do negocio', 'codigo da atividade', 'codigo da pessoa'].some(x => c.indexOf(x) !== -1);
  }
  function prefixaAgendor(tipo, registros) {
    const id = (p, v) => (v == null || v === '' ? v : /^agendor:/.test(String(v)) ? v : 'agendor:' + p + ':' + String(Math.round(Number(v)) || v).trim());
    return registros.map(r => Object.assign(r, {
      externo_id: id(PREFIXO_AGENDOR[tipo], r.externo_id), empresa_externo: id('org', r.empresa_externo), negocio_externo: id('negocio', r.negocio_externo)
    }));
  }

  function registrosDaPlanilha(linhas, mapa) {
    return linhas.map((l, n) => {
      const r = { _linha: n + 2 };
      Object.keys(mapa).forEach(i => {
        const v = l[i];
        if (v == null || String(v).trim() === '') return;
        r[mapa[i]] = typeof v === 'string' ? v.trim() : v;
      });
      return r;
    });
  }

  // ------------------------------------------------------------ traduções de valores
  function situacao(v) {
    const s = R.normaliza(v);
    if (!s) return null;
    // "Cliente em potencial" (Agendor da OneClean) é prospect, não cliente: testar antes.
    if (/(prospect|prospec|potencial|oportunidade|qualificad)/.test(s)) return 'prospect';
    if (/(inativo|ex cliente|ex-cliente|antigo)/.test(s)) return 'inativo';
    if (/^(cliente|client|customer|ativo)/.test(s) || /(primeira compra|recorrente|comprou)/.test(s)) return 'cliente';
    return 'lead';
  }

  function statusNegocio(v) {
    const s = R.normaliza(v);
    if (/^(ganh|vend|won|fechad[oa] ganh|conquist|2$)/.test(s)) return 'ganho';
    if (/^(perd|lost|3$|cancel)/.test(s)) return 'perdido';
    return 'aberto';
  }

  function tipoAtividade(v) {
    const s = R.normaliza(v);
    if (/liga|telefon|call|phone/.test(s)) return 'ligacao';
    if (/whats|wpp|zap/.test(s)) return 'whatsapp';
    if (/e[ -]?mail/.test(s)) return 'email';
    if (/reuni|meeting|video/.test(s)) return 'reuniao';
    if (/visita/.test(s)) return 'visita';
    if (/propost|orcament/.test(s)) return 'proposta';
    if (/nota|anota|coment|observ/.test(s)) return 'nota';
    if (/ocorr|reclam|problema|chamado/.test(s)) return 'ocorrencia';
    return 'tarefa';
  }

  function simNao(v) {
    if (typeof v === 'boolean') return v;
    const s = R.normaliza(v);
    return /^(s|sim|true|1|x|concluid|feit|realizad|finalizad|ok|done)/.test(s);
  }

  function tags(v) {
    if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
    return String(v || '').split(/[,;|]/).map(x => x.trim()).filter(Boolean);
  }

  function uf(v) {
    const s = String(v || '').trim();
    if (s.length === 2) return s.toUpperCase();
    const nomes = { acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF',
      'espirito santo': 'ES', goias: 'GO', maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG',
      para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
      'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO' };
    return nomes[R.normaliza(s)] || s || null;
  }

  const dia = v => { const d = R.dataPlanilha(v); return d ? R.diaLocal(d) : null; };
  const texto = v => (v == null || v === '' ? null : String(v).trim());

  // ------------------------------------------------------------ planejador
  // D: dados atuais; tipos: { empresas: [...], contatos: [...], ... } (registros normalizados)
  // op: { responsavelPadrao, sobrescrever, criarEmpresas (true), usuarioAtual,
  //       atualizarTabelas: ['negocios', 'atividades'] = nessas tabelas o que veio no arquivo
  //       vale mais que o que está no CRM (reextração do Agendor: etapa, ganho/perdido, tarefa
  //       concluída ou remarcada); nas outras, só completa o vazio }
  function planeja(D, tipos, op) {
    op = Object.assign({ criarEmpresas: true, sobrescrever: false }, op || {});
    const atualiza = new Set(op.atualizarTabelas || []);
    // Trabalha em cópias: o plano marca nos registros o que vai mudar, e a tela replaneja a cada
    // opção trocada — mexer nos originais faria a segunda conta não ver mais as mudanças.
    D = Object.assign({}, D);
    ['empresas', 'contatos', 'negocios', 'atividades', 'produtos'].forEach(t => { D[t] = (D[t] || []).map(x => Object.assign({}, x)); });
    const plano = {
      criar: { etapas: [], opcoes: [], produtos: [], empresas: [], contatos: [], negocios: [], negocio_itens: [], atividades: [] },
      atualizar: [], ignorados: [], semResponsavel: new Map(), contagem: {}
    };
    const conta = (t, k) => { plano.contagem[t] = plano.contagem[t] || { criados: 0, atualizados: 0, ignorados: 0 }; plano.contagem[t][k]++; };
    const ignora = (t, r, motivo) => { conta(t, 'ignorados'); plano.ignorados.push({ tipo: t, linha: r._linha, motivo, registro: r }); };

    // ---- usuários
    const usuPorEmail = new Map(), usuPorNome = new Map(), usuPorPrimeiro = new Map();
    D.usuarios.forEach(u => {
      if (u.email) usuPorEmail.set(R.normaliza(u.email), u.user_id);
      usuPorNome.set(R.normaliza(u.nome), u.user_id);
      const p = R.normaliza(R.primeiroNome(u.nome));
      usuPorPrimeiro.set(p, usuPorPrimeiro.has(p) ? null : u.user_id); // ambíguo = null
    });
    const mapaUsu = op.mapaResponsaveis || {};
    function responsavel(v) {
      const s = R.normaliza(v);
      if (!s) return op.responsavelPadrao || null;
      if (mapaUsu[s] !== undefined) return mapaUsu[s] || op.responsavelPadrao || null;
      const id = usuPorEmail.get(s) || usuPorNome.get(s) || usuPorPrimeiro.get(s) || usuPorPrimeiro.get(R.normaliza(R.primeiroNome(v)));
      if (id) return id;
      plano.semResponsavel.set(s, (plano.semResponsavel.get(s) || { nome: String(v).trim(), qtd: 0 }));
      plano.semResponsavel.get(s).qtd++;
      return op.responsavelPadrao || null;
    }

    // ---- listas (origem/segmento/motivo): cria as que faltam
    const opcoes = new Map(D.opcoes.map(o => [o.tipo + ':' + R.normaliza(o.nome), o.nome]));
    function opcao(tipo, v) {
      const t = texto(v);
      if (!t) return null;
      const k = tipo + ':' + R.normaliza(t);
      if (!opcoes.has(k)) {
        opcoes.set(k, t);
        plano.criar.opcoes.push({ id: uuid(), tipo, nome: t, ordem: 100 + plano.criar.opcoes.length });
      }
      return opcoes.get(k);
    }

    // ---- empresas: índices (existentes + planejadas)
    const emp = { ext: new Map(), doc: new Map(), nome: new Map(), contato: new Map() };
    const indexaEmpresa = e => {
      if (e.externo_id) emp.ext.set(e.externo_id, e);
      // Códigos de origem dos cadastros que foram mesclados neste: reimportar não os recria.
      (e.externos_mesclados || []).forEach(x => { if (!emp.ext.has(x)) emp.ext.set(x, e); });
      const d = R.digitos(e.cnpj); if (d.length >= 11) emp.doc.set(d, e);
      const n = R.chaveNome(e.nome); if (n && !emp.nome.has(n)) emp.nome.set(n, e);
      [R.chaveTelefone(e.telefone), R.chaveTelefone(e.whatsapp), R.chaveEmail(e.email)].forEach(k => { if (k && !emp.contato.has(k)) emp.contato.set(k, e); });
    };
    D.empresas.forEach(indexaEmpresa);
    const achaEmpresa = (ext, doc, nome) =>
      (ext && emp.ext.get(ext)) || (R.digitos(doc).length >= 11 && emp.doc.get(R.digitos(doc))) || (nome && emp.nome.get(R.chaveNome(nome))) || null;
    // Empresa nova com telefone ou e-mail de uma que já existe: o banco recusaria o cadastro
    // (trava de duplicado), e os negócios e tarefas dela se perderiam. Vai para a existente.
    const achaPorContato = d => [R.chaveEmail(d.email), R.chaveTelefone(d.telefone), R.chaveTelefone(d.whatsapp)].filter(Boolean).map(k => emp.contato.get(k)).find(Boolean) || null;
    const empPorId = new Map(D.empresas.map(e => [e.id, e]));

    // O banco devolve datas e números num formato diferente do planejado ("…+00:00" × "….000Z").
    function mesmoValor(a, b) {
      if (a === b) return true;
      const vazio = x => x == null || x === '';
      if (vazio(a) || vazio(b)) return vazio(a) && vazio(b);
      if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
      const ehData = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x);
      if (ehData(a) && ehData(b)) return Date.parse(a) === Date.parse(b);
      return String(a) === String(b);
    }

    const novos = new Set(); // ids criados neste plano (atualizar = mexer no objeto em "criar")
    function preenche(tabela, alvo, dados) {
      const patch = {};
      const sobre = op.sobrescrever || atualiza.has(tabela);
      Object.keys(dados).forEach(k => {
        const v = dados[k];
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) return;
        if (k === 'tags') {
          const t = [...new Set([].concat(alvo.tags || [], v))];
          if (t.length !== (alvo.tags || []).length) patch.tags = t;
        } else if (sobre ? !mesmoValor(alvo[k], v) : (alvo[k] == null || alvo[k] === '' || (k === 'qualificacao' && !alvo[k]))) patch[k] = v;
      });
      return aplica(tabela, alvo, patch);
    }
    function aplica(tabela, alvo, patch) {
      if (!Object.keys(patch).length) return false;
      if (novos.has(alvo.id)) Object.assign(alvo, patch);
      else {
        const ja = pendentes.get(tabela + ':' + alvo.id);
        if (ja) Object.assign(ja.patch, patch);
        else { const a = { tabela, id: alvo.id, patch }; plano.atualizar.push(a); pendentes.set(tabela + ':' + alvo.id, a); }
        Object.assign(alvo, patch);
      }
      return true;
    }
    const pendentes = new Map(); // tabela:id -> item de plano.atualizar

    function dadosEmpresa(r) {
      const q = r.qualificacao != null ? Math.max(0, Math.min(5, Math.round(R.numeroBR(r.qualificacao) || 0))) : null;
      return {
        nome: texto(r.nome) || texto(r.razao_social), razao_social: texto(r.razao_social),
        cnpj: r.cnpj ? R.formataCNPJ(r.cnpj) : null, situacao: r.situacao ? situacao(r.situacao) : null,
        segmento: opcao('segmento', r.segmento), origem: opcao('origem', r.origem),
        telefone: texto(r.telefone), whatsapp: texto(r.whatsapp), email: texto(r.email) && String(r.email).toLowerCase(),
        site: texto(r.site), cep: texto(r.cep), logradouro: texto(r.logradouro), numero: texto(r.numero),
        complemento: texto(r.complemento), bairro: texto(r.bairro), cidade: texto(r.cidade), uf: r.uf ? uf(r.uf) : null,
        tags: r.tags ? tags(r.tags) : null, qualificacao: q || null, observacoes: texto(r.observacoes),
        externo_id: texto(r.externo_id)
      };
    }

    function criaEmpresa(dados, resp, criadoEm) {
      const e = Object.assign({ id: uuid(), situacao: 'lead', qualificacao: 0, tags: [] }, limpa(dados));
      e.responsavel_id = resp;
      if (criadoEm) e.criado_em = criadoEm;
      plano.criar.empresas.push(e); novos.add(e.id); indexaEmpresa(e); conta('empresas', 'criados');
      return e;
    }

    // Empresa referenciada por contato/negócio/atividade: acha ou cria. Sem empresa informada,
    // o nome de reserva (título do negócio, nome da pessoa) também é procurado antes de criar —
    // senão cada negócio de um mesmo cliente sem empresa virava uma empresa nova.
    function empresaDe(r, resp) {
      const reserva = !texto(r.empresa) ? nomeDeReserva(r.empresa_nome_fallback) : null;
      const e = achaEmpresa(r.empresa_externo, r.empresa_cnpj, r.empresa) || (reserva && achaEmpresa(null, null, reserva));
      if (e) return e;
      if (!op.criarEmpresas || !(texto(r.empresa) || reserva)) return null;
      return criaEmpresa({ nome: texto(r.empresa) || reserva, cnpj: r.empresa_cnpj ? R.formataCNPJ(r.empresa_cnpj) : null,
        externo_id: texto(r.empresa_externo) }, resp, null);
    }

    (tipos.empresas || []).forEach(r => {
      const d = dadosEmpresa(r);
      if (!d.nome) return ignora('empresas', r, 'sem nome');
      let existente = achaEmpresa(d.externo_id, d.cnpj, d.nome);
      if (!existente && (existente = achaPorContato(d)) && d.externo_id) {
        if (!emp.ext.has(d.externo_id)) emp.ext.set(d.externo_id, existente); // negócios e tarefas dela acham a existente
        d.externo_id = null; // a existente fica com o código que já tem
      }
      const resp = responsavel(r.responsavel);
      if (existente) {
        // Grafia diferente do mesmo cadastro vira apelido (negócio/contato que citar esse nome acha a empresa).
        const apelido = R.chaveNome(d.nome); if (apelido && !emp.nome.has(apelido)) emp.nome.set(apelido, existente);
        const extra = Object.assign({}, d);
        delete extra.externo_id; delete extra.nome;
        if (!existente.responsavel_id && resp) extra.responsavel_id = resp;
        if (d.externo_id && !existente.externo_id) extra.externo_id = d.externo_id;
        if (preenche('empresas', existente, extra) && !novos.has(existente.id)) conta('empresas', 'atualizados');
        else if (!novos.has(existente.id)) conta('empresas', 'ignorados');
      } else {
        criaEmpresa(d, resp, R.dataPlanilha(r.criado_em));
      }
    });

    // ---- contatos
    const cont = { ext: new Map(), chave: new Map() };
    const chavesContato = c => {
      const l = [];
      if (c.email) l.push('e:' + c.empresa_id + ':' + R.normaliza(c.email));
      [c.telefone, c.celular, c.whatsapp].forEach(t => { const d = R.digitos(t).slice(-9); if (d.length >= 8) l.push('t:' + c.empresa_id + ':' + d); });
      l.push('n:' + c.empresa_id + ':' + R.normaliza(c.nome));
      return l;
    };
    const indexaContato = c => { if (c.externo_id) cont.ext.set(c.externo_id, c); chavesContato(c).forEach(k => { if (!cont.chave.has(k)) cont.chave.set(k, c); }); };
    D.contatos.forEach(indexaContato);

    (tipos.contatos || []).forEach(r => {
      const nome = texto(r.nome);
      if (!nome) return ignora('contatos', r, 'sem nome');
      const resp = responsavel(r.responsavel);
      const existenteExt = r.externo_id && cont.ext.get(texto(r.externo_id));
      const e = existenteExt ? { id: existenteExt.empresa_id } : empresaDe(Object.assign({ empresa_nome_fallback: nome }, r), resp);
      if (!e) return ignora('contatos', r, 'sem empresa');
      if (r.origem && novos.has(e.id) && !e.origem) e.origem = opcao('origem', r.origem);
      const d = {
        empresa_id: e.id, nome, cargo: texto(r.cargo), email: texto(r.email) && String(r.email).toLowerCase(),
        telefone: texto(r.telefone), celular: texto(r.celular), whatsapp: texto(r.whatsapp),
        aniversario: r.aniversario ? dia(r.aniversario) : null, observacoes: texto(r.observacoes), externo_id: texto(r.externo_id)
      };
      const existente = existenteExt || chavesContato(d).map(k => cont.chave.get(k)).find(Boolean);
      if (existente) {
        const extra = Object.assign({}, d); delete extra.empresa_id; delete extra.nome; delete extra.externo_id;
        if (d.externo_id && !existente.externo_id) extra.externo_id = d.externo_id;
        if (preenche('contatos', existente, extra) && !novos.has(existente.id)) conta('contatos', 'atualizados');
        else if (!novos.has(existente.id)) conta('contatos', 'ignorados');
        return;
      }
      const c = Object.assign({ id: uuid(), principal: false, tags: [] }, limpa(d));
      if (!D.contatos.some(x => x.empresa_id === e.id) && !plano.criar.contatos.some(x => x.empresa_id === e.id)) c.principal = true;
      plano.criar.contatos.push(c); novos.add(c.id); indexaContato(c); conta('contatos', 'criados');
    });

    // ---- etapas
    const etapas = new Map(D.etapas.map(e => [R.normaliza(e.funil || 'Vendas') + ':' + R.normaliza(e.nome), e]));
    const etapaExt = new Map(D.etapas.filter(e => e.externo_id).map(e => [e.externo_id, e]));
    (tipos.etapas || []).forEach(x => {
      const k = R.normaliza(x.funil || 'Vendas') + ':' + R.normaliza(x.nome);
      if (etapas.has(k) || (x.externo_id && etapaExt.has(x.externo_id))) return;
      const e = { id: uuid(), funil: x.funil || 'Vendas', nome: x.nome, ordem: x.ordem || (100 + plano.criar.etapas.length), probabilidade: x.probabilidade || 0, externo_id: x.externo_id || null };
      plano.criar.etapas.push(e); etapas.set(k, e); if (e.externo_id) etapaExt.set(e.externo_id, e); conta('etapas', 'criados');
    });
    const primeiraEtapa = () => [...etapas.values()].sort((a, b) => a.ordem - b.ordem)[0] || null;
    function etapaDe(r) {
      if (r.etapa_externo && etapaExt.get(r.etapa_externo)) return etapaExt.get(r.etapa_externo).id;
      const nome = texto(r.etapa);
      if (!nome) { const p = primeiraEtapa(); return p ? p.id : null; }
      const funil = texto(r.funil) || (D.etapas[0] && D.etapas[0].funil) || 'Vendas';
      const k = R.normaliza(funil) + ':' + R.normaliza(nome);
      if (!etapas.has(k)) {
        const irmas = [...etapas.values()].filter(e => R.normaliza(e.funil) === R.normaliza(funil));
        const e = { id: uuid(), funil, nome, ordem: r.etapa_ordem || (irmas.reduce((m, x) => Math.max(m, x.ordem), 0) + 1), probabilidade: 0 };
        plano.criar.etapas.push(e); etapas.set(k, e); conta('etapas', 'criados');
      }
      return etapas.get(k).id;
    }

    // ---- produtos
    const prod = { ext: new Map(), cod: new Map(), nome: new Map() };
    const indexaProd = p => { if (p.externo_id) prod.ext.set(p.externo_id, p); if (p.codigo) prod.cod.set(R.normaliza(p.codigo), p); prod.nome.set(R.normaliza(p.nome), p); };
    (D.produtos || []).forEach(indexaProd);
    (tipos.produtos || []).forEach(r => {
      const nome = texto(r.nome);
      if (!nome) return ignora('produtos', r, 'sem nome');
      const d = { nome, codigo: texto(r.codigo), unidade: texto(r.unidade), categoria: texto(r.categoria), preco: R.numeroBR(r.preco), externo_id: texto(r.externo_id) };
      const ex = (d.externo_id && prod.ext.get(d.externo_id)) || (d.codigo && prod.cod.get(R.normaliza(d.codigo))) || prod.nome.get(R.normaliza(nome));
      if (ex) {
        const extra = Object.assign({}, d); delete extra.nome;
        if (preenche('produtos', ex, extra) && !novos.has(ex.id)) conta('produtos', 'atualizados'); else if (!novos.has(ex.id)) conta('produtos', 'ignorados');
        return;
      }
      const p = Object.assign({ id: uuid(), ativo: true, preco: 0 }, limpa(d));
      plano.criar.produtos.push(p); novos.add(p.id); indexaProd(p); conta('produtos', 'criados');
    });

    // ---- negócios
    const neg = { ext: new Map(), chave: new Map() };
    const chaveNeg = n => n.empresa_id + ':' + R.normaliza(n.titulo) + ':' + (R.diaLocal(n.criado_em) || '');
    const indexaNeg = n => { if (n.externo_id) neg.ext.set(n.externo_id, n); neg.chave.set(chaveNeg(n), n); };
    D.negocios.forEach(indexaNeg);

    (tipos.negocios || []).forEach(r => {
      const titulo = texto(r.titulo);
      if (!titulo) return ignora('negocios', r, 'sem título');
      const resp = responsavel(r.responsavel);
      const exExt = r.externo_id && neg.ext.get(texto(r.externo_id));
      const e = exExt ? { id: exExt.empresa_id } : empresaDe(r, resp);
      if (!e) return ignora('negocios', r, 'sem empresa');
      const status = r.status ? statusNegocio(r.status) : (r.fechado_em && r.motivo_perda ? 'perdido' : 'aberto');
      const contato = (r.contato_externo && cont.ext.get(r.contato_externo)) ||
        (texto(r.contato) && cont.chave.get('n:' + e.id + ':' + R.normaliza(r.contato))) || null;
      const criado = R.dataPlanilha(r.criado_em);
      const d = {
        empresa_id: e.id, contato_id: contato ? contato.id : null, titulo, etapa_id: etapaDe(r), status,
        valor: R.numeroBR(r.valor) || 0, previsao_fechamento: r.previsao_fechamento ? dia(r.previsao_fechamento) : null,
        fechado_em: status !== 'aberto' ? (dia(r.fechado_em) || dia(r.criado_em) || R.hojeISO()) : null,
        motivo_perda: status === 'perdido' ? opcao('motivo_perda', r.motivo_perda) : null,
        responsavel_id: resp, origem: opcao('origem', r.origem), observacoes: texto(r.observacoes), externo_id: texto(r.externo_id)
      };
      const ex = exExt || (criado && neg.chave.get(chaveNeg({ empresa_id: e.id, titulo, criado_em: criado })));
      if (ex) {
        const extra = Object.assign({}, d); delete extra.empresa_id; delete extra.titulo;
        const antes = ex.status;
        let mudou = preenche('negocios', ex, extra);
        if (atualiza.has('negocios') && !novos.has(ex.id)) {
          // Reaberto no Agendor: tira a data de fechamento e o motivo de perda.
          if (status === 'aberto' && (ex.fechado_em || ex.motivo_perda)) mudou = aplica('negocios', ex, { fechado_em: null, motivo_perda: null }) || mudou;
          const empresa = empPorId.get(ex.empresa_id);
          if (status === 'ganho' && antes !== 'ganho' && empresa && empresa.situacao !== 'cliente') marcaCliente(empresa);
        }
        if (mudou && !novos.has(ex.id)) conta('negocios', 'atualizados'); else if (!novos.has(ex.id)) conta('negocios', 'ignorados');
        return;
      }
      const n = limpa(Object.assign({ id: uuid() }, d));
      if (!n.responsavel_id) n.responsavel_id = null;
      if (criado) { n.criado_em = criado; n.etapa_desde = criado; }
      if (status === 'ganho' && novos.has(e.id)) e.situacao = 'cliente';
      else if (status === 'ganho' && e.situacao !== 'cliente' && !novos.has(e.id)) marcaCliente(e);
      plano.criar.negocios.push(n); novos.add(n.id); indexaNeg(n); conta('negocios', 'criados');
      (r.itens || []).forEach((it, i) => {
        const p = (it.produto_externo && prod.ext.get(it.produto_externo)) || (it.descricao && prod.nome.get(R.normaliza(it.descricao)));
        plano.criar.negocio_itens.push({ id: uuid(), negocio_id: n.id, produto_id: p ? p.id : null, descricao: it.descricao || (p && p.nome) || 'Item',
          quantidade: R.numeroBR(it.quantidade) || 1, preco: R.numeroBR(it.preco) || 0, desconto: R.numeroBR(it.desconto) || 0, ordem: i });
      });
    });

    function marcaCliente(e) { return aplica('empresas', e, { situacao: 'cliente' }); }

    // ---- atividades
    const atvExt = new Map(D.atividades.filter(a => a.externo_id).map(a => [a.externo_id, a]));
    const negPorTitulo = new Map();
    [...neg.ext.values(), ...neg.chave.values()].forEach(n => negPorTitulo.set(n.empresa_id + ':' + R.normaliza(n.titulo), n));
    const agora = new Date().toISOString();

    (tipos.atividades || []).forEach(r => {
      const desc = texto(r.descricao);
      if (!desc) return ignora('atividades', r, 'sem descrição');
      const ext = texto(r.externo_id);
      if (ext && atvExt.has(ext)) {
        const ex = atvExt.get(ext);
        if (!atualiza.has('atividades') || novos.has(ex.id)) return ignora('atividades', r, 'já importada');
        // Reextração: concluída, remarcada ou reescrita no Agendor. Só o que o arquivo traz de
        // fato (sem data no arquivo não mexe na data; sem tipo não mexe no tipo).
        const concl = r.concluida != null ? simNao(r.concluida) : !!r.concluida_em || tipoAtividade(r.tipo) === 'nota';
        let quando = R.dataPlanilha(r.data_hora);
        if (quando && r.hora && /^\d{1,2}:\d{2}/.test(String(r.hora))) quando = R.momento(R.diaLocal(quando), String(r.hora).slice(0, 5));
        const dados = { descricao: desc, data_hora: quando, concluida: concl, responsavel_id: responsavel(r.responsavel) };
        if (texto(r.tipo)) dados.tipo = tipoAtividade(r.tipo);
        const antes = ex.concluida;
        let mudou = preenche('atividades', ex, dados);
        if (concl && !antes) mudou = aplica('atividades', ex, { concluida_em: R.dataPlanilha(r.concluida_em) || agora }) || mudou;
        else if (!concl && antes) mudou = aplica('atividades', ex, { concluida_em: null }) || mudou;
        if (mudou) conta('atividades', 'atualizados'); else ignora('atividades', r, 'já importada');
        return;
      }
      const resp = responsavel(r.responsavel);
      const negocio = r.negocio_externo && neg.ext.get(r.negocio_externo);
      const contato = r.contato_externo && cont.ext.get(r.contato_externo);
      let e = negocio ? { id: negocio.empresa_id } : contato ? { id: contato.empresa_id } : empresaDe(r, resp);
      if (!e) return ignora('atividades', r, 'sem empresa');
      const negocioTitulo = !negocio && texto(r.negocio) ? negPorTitulo.get(e.id + ':' + R.normaliza(r.negocio)) : null;
      let quando = R.dataPlanilha(r.data_hora);
      if (quando && r.hora && /^\d{1,2}:\d{2}/.test(String(r.hora))) quando = R.momento(R.diaLocal(quando), String(r.hora).slice(0, 5));
      // Nota (anotação) é histórico: entra concluída mesmo sem data de finalização.
      const concluida = r.concluida != null ? simNao(r.concluida) : !!r.concluida_em || tipoAtividade(r.tipo) === 'nota';
      const concluidaEm = concluida ? (R.dataPlanilha(r.concluida_em) || quando || agora) : null;
      quando = quando || concluidaEm || agora;
      const a = {
        id: uuid(), empresa_id: e.id, contato_id: contato ? contato.id : null, negocio_id: (negocio || negocioTitulo || {}).id || null,
        tipo: tipoAtividade(r.tipo || (concluida ? 'nota' : 'tarefa')), descricao: desc, data_hora: quando, concluida,
        concluida_em: concluidaEm, responsavel_id: resp, automatica: false, externo_id: ext
      };
      if (ext) atvExt.set(ext, a);
      novos.add(a.id);
      plano.criar.atividades.push(limpa(a, ['contato_id', 'negocio_id', 'responsavel_id', 'concluida_em', 'externo_id']));
      conta('atividades', 'criados');
    });

    plano.semResponsavel = [...plano.semResponsavel.values()];
    return plano;
  }

  // Tira nulos (deixa o banco pôr o padrão), exceto as chaves pedidas.
  // Título de negócio usado como nome de empresa: tira o nº do pedido do começo ("1096 - ") e o
  // nome do contato em maiúsculas do fim (" - MARIA"), como o pós-venda do Agendor da OneClean escreve.
  function nomeDeReserva(t) {
    const orig = t == null ? '' : String(t).trim();
    let s = orig.replace(/^\d*\s*-\s*/, '').trim();
    const m = s.match(/^(.+?)\s+-\s+([A-ZÀ-Ú]+(?:\s+[A-ZÀ-Ú]+){0,2})$/);
    if (m) s = m[1].trim();
    return s || orig || null;
  }

  function limpa(o, manter) {
    const m = new Set(manter || []);
    const r = {};
    Object.keys(o).forEach(k => { if ((o[k] != null && o[k] !== '') || m.has(k)) r[k] = o[k] == null || o[k] === '' ? null : o[k]; });
    return r;
  }

  // ------------------------------------------------------------ Agendor (API v3)
  // Aceita o arquivo gerado por ferramentas/agendor-exportar.js. Lê com
  // cuidado: campo que não existir fica vazio, nada quebra.
  function converteAgendor(bruto) {
    const g = (o, caminho) => caminho.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
    const pri = (o, ...caminhos) => { for (const c of caminhos) { const v = g(o, c); if (v != null && v !== '' && typeof v !== 'object') return v; } return null; };
    const nomeDe = v => (v == null ? null : typeof v === 'object' ? (v.name || v.nome || v.description || null) : v);
    const ext = (tipo, id) => (id == null ? null : 'agendor:' + tipo + ':' + id);
    const usu = u => (u ? (typeof u === 'object' ? (g(u, 'contact.email') || u.email || u.name) : u) : null);
    const cidade = a => nomeDe(g(a, 'city')) || null;
    const estado = a => { const s = g(a, 'state'); return s == null ? null : typeof s === 'object' ? (s.abbreviation || s.initials || s.name) : s; };

    const orgs = bruto.organizations || [];
    const people = bruto.people || [];
    const deals = bruto.deals || [];
    const tasks = bruto.tasks || [];
    const orgPorId = new Map(orgs.map(o => [o.id, o]));
    const pessoaPorId = new Map(people.map(p => [p.id, p]));
    const dealPorId = new Map(deals.map(d => [d.id, d]));

    // Pessoa sem empresa no Agendor vira empresa com o nome dela (pessoa física).
    const empresaDaPessoa = p => { const o = g(p, 'organization'); return o && o.id != null ? o : null; };

    const etapas = [];
    (bruto.funnels || []).forEach(f => (f.dealStages || f.stages || []).forEach(s => {
      etapas.push({ funil: f.name || 'Vendas', nome: s.name, ordem: s.sequence || s.position || 0, externo_id: ext('etapa', s.id) });
    }));
    deals.forEach(d => {
      const s = d.dealStage; if (!s || s.name == null) return;
      const id = ext('etapa', s.id);
      if (!etapas.some(e => e.externo_id === id)) etapas.push({ funil: nomeDe(s.funnel) || 'Vendas', nome: s.name, ordem: s.sequence || s.position || 0, externo_id: id });
    });

    const empresas = orgs.map(o => ({
      nome: o.name || o.nickname || o.legalName, razao_social: o.legalName || null, cnpj: o.cnpj || null,
      situacao: nomeDe(o.category), segmento: nomeDe(o.sector), origem: nomeDe(o.leadOrigin) || nomeDe(o.origin),
      responsavel: usu(o.ownerUser || o.owner), telefone: pri(o, 'contact.work', 'contact.phone', 'phone'),
      whatsapp: pri(o, 'contact.whatsapp', 'contact.mobile'), email: pri(o, 'contact.email', 'email'),
      site: o.website || null, cep: pri(o, 'address.postalCode'), logradouro: pri(o, 'address.streetName'),
      numero: pri(o, 'address.streetNumber'), complemento: pri(o, 'address.additionalInfo'), bairro: pri(o, 'address.district'),
      cidade: cidade(o.address), uf: estado(o.address), qualificacao: o.ranking, observacoes: o.description || null,
      tags: (o.products || o.productsInterest || []).map(nomeDe).filter(Boolean),
      externo_id: ext('org', o.id), criado_em: o.createdAt || null
    }));

    const contatos = people.map(p => {
      const o = empresaDaPessoa(p);
      const org = o && orgPorId.get(o.id);
      return {
        nome: p.name, empresa: org ? (org.name || org.nickname) : o ? o.name : null, empresa_externo: o ? ext('org', o.id) : null,
        empresa_nome_fallback: p.name, cargo: p.role || p.position || null,
        email: pri(p, 'contact.email', 'email'), telefone: pri(p, 'contact.work', 'contact.phone'), celular: pri(p, 'contact.mobile'),
        whatsapp: pri(p, 'contact.whatsapp'), aniversario: p.birthday || null, observacoes: p.description || null,
        responsavel: usu(p.ownerUser || p.owner), origem: nomeDe(p.leadOrigin), externo_id: ext('pessoa', p.id)
      };
    });

    const empresaDoNegocio = d => {
      if (g(d, 'organization.id') != null) return { externo: ext('org', d.organization.id), nome: d.organization.name };
      const p = g(d, 'person.id') != null && pessoaPorId.get(d.person.id);
      if (p) { const o = empresaDaPessoa(p); return o ? { externo: ext('org', o.id), nome: o.name } : { externo: null, nome: p.name }; }
      return { externo: null, nome: g(d, 'person.name') || null };
    };
    // Motivo da perda: o Agendor guarda o nome e, às vezes, um detalhe à parte.
    const detalhePerda = d => g(d, 'lossReason.description') || null;

    const negocios = deals.map(d => {
      const emp = empresaDoNegocio(d);
      const st = d.dealStatus;
      const statusTxt = st == null ? null : typeof st === 'object' ? (st.name || st.id) : st;
      return {
        // Negócio sem empresa nem pessoa no Agendor (~2% na OneClean): vira uma empresa
        // com o nome do próprio negócio, para não se perder na importação.
        empresa_nome_fallback: d.title,
        titulo: d.title, empresa: emp.nome, empresa_externo: emp.externo, contato_externo: g(d, 'person.id') != null ? ext('pessoa', d.person.id) : null,
        valor: d.value, funil: nomeDe(g(d, 'dealStage.funnel')), etapa: g(d, 'dealStage.name'), etapa_externo: g(d, 'dealStage.id') != null ? ext('etapa', d.dealStage.id) : null,
        status: statusTxt, criado_em: d.startTime || d.createdAt || null,
        previsao_fechamento: d.estimatedCloseDate || d.expectedCloseDate || null,
        fechado_em: d.wonAt || d.lostAt || d.endTime || d.closedAt || null, motivo_perda: nomeDe(d.lossReason) || nomeDe(d.reasonForLoss),
        responsavel: usu(d.owner || d.ownerUser), origem: nomeDe(d.leadOrigin),
        observacoes: [d.description, detalhePerda(d) ? 'Sobre a perda: ' + detalhePerda(d) : null].filter(Boolean).join('\n') || null,
        externo_id: ext('negocio', d.id),
        itens: (d.products || []).map(p => ({
          descricao: nomeDe(p) || nomeDe(p.product), quantidade: p.quantity || p.amount || 1,
          preco: p.unitValue != null ? p.unitValue : (p.price != null ? p.price : p.value), desconto: p.discount || 0,
          produto_externo: p.id != null ? ext('produto', p.productId || (p.product && p.product.id) || p.id) : null
        }))
      };
    });

    const atividades = tasks.map(t => {
      const deal = g(t, 'deal.id') != null ? dealPorId.get(t.deal.id) : null;
      const emp = deal ? empresaDoNegocio(deal)
        : g(t, 'organization.id') != null ? { externo: ext('org', t.organization.id), nome: t.organization.name }
        : g(t, 'person.id') != null && pessoaPorId.get(t.person.id) ? empresaDoNegocio({ person: t.person }) : { externo: null, nome: null };
      const tipo = t.type == null ? null : typeof t.type === 'object' ? (t.type.name || t.type.id) : t.type;
      const resp = (t.assignedUsers && t.assignedUsers[0]) || t.user || t.owner;
      // Sem tipo e sem prazo = "Nota" do Agendor (anotação): é histórico, não tarefa pendente.
      // (Na 1ª importação, de 29/09/2026, 54 notas entraram como tarefa atrasada.)
      const prazo = t.dueDate || t.due_date || null;
      const nota = !tipo && !prazo;
      return {
        descricao: t.text || t.description || '(sem texto)', tipo: tipo || (t.done || nota ? 'nota' : 'tarefa'),
        data_hora: prazo || t.createdAt || null, concluida: !!(t.done || t.finishedAt || nota),
        concluida_em: t.finishedAt || (t.done ? (t.updatedAt || t.dueDate) : nota ? t.createdAt || null : null), responsavel: usu(resp),
        empresa: emp.nome, empresa_externo: emp.externo, negocio_externo: t.deal && t.deal.id != null ? ext('negocio', t.deal.id) : null,
        contato_externo: g(t, 'person.id') != null ? ext('pessoa', t.person.id) : null, externo_id: ext('tarefa', t.id)
      };
    });

    const produtos = (bruto.products || []).map(p => ({
      nome: p.name, codigo: p.code || null, preco: p.price != null ? p.price : p.value, categoria: nomeDe(p.category), externo_id: ext('produto', p.id)
    }));

    const usuarios = (bruto.users || []).map(u => ({ nome: u.name, email: g(u, 'contact.email') || u.email || null }));

    return { empresas, contatos, etapas, produtos, negocios, atividades, usuarios };
  }

  const api = { CAMPOS, OBRIGATORIO, normCab, adivinhaMapeamento, registrosDaPlanilha, ehPlanilhaAgendor, prefixaAgendor, planeja, converteAgendor,
    situacao, statusNegocio, tipoAtividade, simNao };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.CRMPlanilha = api;
})(typeof window !== 'undefined' ? window : globalThis);
