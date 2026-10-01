/* CRM Sistemi Dalessi — "o que tem dentro" de cada quadro.
   CRM.mostraLista abre uma janela com os negócios, empresas, tarefas ou notas que um número
   conta (ex.: Relatórios → "Negócios iniciados 3" → quais são). Cada linha abre a ficha; a lista
   exporta em CSV. Quem chama monta a lista com as mesmas contas do quadro (R.dashboard.listas,
   R.faturamento.lista), então o número e a lista sempre batem. */
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, R = raiz.CRMRegras;
  if (!CRM || !CRM.acoes) return;
  const { esc } = CRM;
  const E = () => CRM.estado;
  const LIMITE = 500;
  let atual = null;

  const nomeEmp = id => (id ? CRM.nomeEmpresa(id) : '—');
  const etapaDe = n => { const e = E().ix.porId.etapas.get(n.etapa_id); return e ? e.nome : ''; };
  const situacaoNeg = n => (n.status === 'aberto' ? etapaDe(n) || 'Aberto' : R.rotulo(R.STATUS_NEGOCIO, n.status)) + (n.motivo_perda ? ' · ' + n.motivo_perda : '');
  const dataNeg = (n, campo) => R.diaLocal(n[campo] || '') || n[campo] || '';

  // Cada tipo: colunas, célula de cada linha, linha do CSV, o que abre e a ordem.
  const TIPOS = {
    negocios: {
      cab: o => ['Negócio', 'Empresa', 'Responsável', 'Situação', ROTULO_DATA[o.data || 'criado_em'], ['Valor', 1]],
      linha: (n, o) => [esc(n.titulo), esc(nomeEmp(n.empresa_id)), esc(CRM.nomeUsuario(n.responsavel_id)),
        n.status === 'aberto' ? esc(situacaoNeg(n)) : CRM.seloStatus(n.status) + (n.motivo_perda ? ' <small>' + esc(n.motivo_perda) + '</small>' : ''),
        esc(R.dataBR(dataNeg(n, o.data || 'criado_em'))), esc(R.moeda(n.valor))],
      csv: (n, o) => [n.titulo, nomeEmp(n.empresa_id), CRM.nomeUsuario(n.responsavel_id), situacaoNeg(n), R.dataBR(dataNeg(n, o.data || 'criado_em')), R.num(n.valor)],
      abrir: n => ['abrir-negocio', n.id],
      ordem: (a, b) => R.num(b.valor) - R.num(a.valor),
      total: l => R.moeda(l.reduce((s, n) => s + R.num(n.valor), 0))
    },
    empresas: {
      cab: () => ['Empresa', 'Responsável', 'Situação', 'Cidade', 'Cadastro'],
      linha: (e, o) => [esc(e.nome) + (o.marca ? ' <small>' + esc(o.marca(e)) + '</small>' : ''), esc(CRM.nomeUsuario(e.responsavel_id)), CRM.seloSituacao(CRM.situacao(e)),
        esc([e.cidade, e.uf].filter(Boolean).join('/')), esc(R.dataBR(e.criado_em))],
      csv: (e, o) => [e.nome, CRM.nomeUsuario(e.responsavel_id), R.rotulo(R.SITUACOES, CRM.situacao(e)), [e.cidade, e.uf].filter(Boolean).join('/'), R.dataBR(e.criado_em)].concat(o.marca ? [o.marca(e)] : []),
      abrir: e => ['abrir-empresa', e.id],
      ordem: (a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || ''))
    },
    atividades: {
      cab: () => ['Quando', 'Tipo', 'O que', 'Empresa', 'Responsável'],
      linha: a => [esc(R.dataBR(a.concluida_em || a.data_hora) + ' ' + R.horaLocal(a.concluida_em || a.data_hora)), CRM.iconeTipo(a.tipo) + ' ' + esc(R.rotulo(R.TIPOS_ATIVIDADE, a.tipo)),
        esc(String(a.descricao || '').slice(0, 140)), esc(nomeEmp(a.empresa_id)), esc(CRM.nomeUsuario(a.responsavel_id))],
      csv: a => [R.dataBR(a.concluida_em || a.data_hora), R.rotulo(R.TIPOS_ATIVIDADE, a.tipo), a.descricao, nomeEmp(a.empresa_id), CRM.nomeUsuario(a.responsavel_id)],
      abrir: a => (a.empresa_id ? ['abrir-empresa', a.empresa_id] : a.negocio_id ? ['abrir-negocio', a.negocio_id] : null),
      ordem: (a, b) => String(b.concluida_em || b.data_hora || '').localeCompare(String(a.concluida_em || a.data_hora || ''))
    },
    notas: {
      cab: () => ['Data', 'NF', 'Cliente', 'Vendedor', ['Valor', 1]],
      linha: (n, o) => [esc(R.dataBR(R.diaLocal(n.emitida_em))), esc(n.numero || ''), esc(o.cliente ? o.cliente(n) : nomeEmp(n.empresa_id)), esc(o.vendedor ? o.vendedor(n) : n.vendedor_nome || ''), esc(R.moeda(n.valor_total))],
      csv: (n, o) => [R.dataBR(R.diaLocal(n.emitida_em)), n.numero || '', o.cliente ? o.cliente(n) : nomeEmp(n.empresa_id), o.vendedor ? o.vendedor(n) : n.vendedor_nome || '', R.num(n.valor_total)],
      abrir: n => (n.empresa_id ? ['abrir-empresa', n.empresa_id] : null),
      ordem: (a, b) => String(b.emitida_em || '').localeCompare(String(a.emitida_em || '')),
      total: l => R.moeda(l.reduce((s, n) => s + R.num(n.valor_total), 0))
    }
  };
  const ROTULO_DATA = { criado_em: 'Criado em', fechado_em: 'Fechado em', previsao_fechamento: 'Previsão' };

  // o: { titulo, sub, tipo, itens, data (negócios), marca(e) (empresas), cliente/vendedor (notas), outras: [{ rotulo, abre: () => o }] }
  function mostraLista(o) {
    const t = TIPOS[o.tipo];
    const itens = (o.itens || []).filter(Boolean).slice().sort(o.ordem || t.ordem);
    atual = Object.assign({}, o, { itens });
    const dlg = document.getElementById('dlgLista');
    const cab = t.cab(o);
    dlg.innerHTML = '<div class="lista-detalhe"><header><div><h2>' + esc(o.titulo) + ' <small>' + itens.length + (t.total ? ' · ' + esc(t.total(itens)) : '') + '</small></h2>' +
        (o.sub ? '<p class="sub">' + esc(o.sub) + '</p>' : '') + '</div><span class="flex"></span>' +
        (itens.length ? '<button type="button" class="btn sec" data-acao="lista-exportar">Exportar</button>' : '') +
        '<button type="button" class="x" data-acao="lista-fechar" aria-label="Fechar">×</button></header>' +
      ((o.outras || []).length ? '<p class="lista-outras">' + o.outras.map((x, i) => '<button type="button" class="chip-filtro" data-acao="lista-outra" data-id="' + i + '">' + esc(x.rotulo) + '</button>').join('') + '</p>' : '') +
      (itens.length ? '<div class="tabela-rolagem tabela-fixa"><table class="tabela"><thead><tr>' + cab.map(c => (Array.isArray(c) ? '<th class="num">' + esc(c[0]) : '<th>' + esc(c)) + '</th>').join('') + '</tr></thead><tbody>' +
        itens.slice(0, LIMITE).map((x, i) => {
          const ab = t.abrir(x);
          return '<tr' + (ab ? ' class="clicavel" tabindex="0" data-acao="lista-abrir" data-id="' + i + '" title="Abrir"' : '') + '>' +
            t.linha(x, o).map((c, j) => '<td' + (Array.isArray(cab[j]) ? ' class="num"' : '') + '>' + c + '</td>').join('') + '</tr>';
        }).join('') + '</tbody></table></div>' + (itens.length > LIMITE ? '<p class="mais">Mostrando ' + LIMITE + ' de ' + itens.length + '; o arquivo exportado tem todos.</p>' : '')
        : '<p class="vazio">Nada aqui no período escolhido.</p>') + '</div>';
    if (!dlg.open) dlg.showModal();
  }
  CRM.mostraLista = mostraLista;

  Object.assign(CRM.acoes, {
    'lista-fechar': () => { const d = document.getElementById('dlgLista'); if (d.open) d.close(); },
    'lista-abrir': i => { const x = atual && atual.itens[+i], ab = x && TIPOS[atual.tipo].abrir(x); if (ab) CRM.acoes[ab[0]](ab[1]); },
    'lista-outra': i => { const x = atual && atual.outras && atual.outras[+i]; if (x) mostraLista(Object.assign({ outras: atual.outras }, x.abre())); },
    'lista-exportar': () => {
      if (!atual) return;
      const t = TIPOS[atual.tipo];
      const cab = t.cab(atual).map(c => (Array.isArray(c) ? c[0] : c)).concat(atual.tipo === 'empresas' && atual.marca ? ['Observação'] : []);
      CRM.baixarCSV(R.normaliza(atual.titulo).replace(/[^a-z0-9]+/g, '-').slice(0, 50), cab, atual.itens.map(x => t.csv(x, atual)));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
