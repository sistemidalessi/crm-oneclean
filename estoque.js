/* Estoque do CRM — Fase 2 da saída do FKN (16/10/2026, pedido do Anderson: "sim, pode começar a Fase 2").
   O CRM passa a ter o próprio estoque, em paralelo com o FKN: um livro de movimentos no banco (crm_estoque_mov:
   saldo inicial, saídas pelas notas de venda, estornos das canceladas, ajustes, inventário e, depois, as entradas de
   compra) e o saldo de cada produto (crm_estoque_saldo, mantido pelo gatilho do livro). A cada listagem do FKN que
   chega (vigia ou tela), o banco compara os dois saldos na hora em que a listagem foi gerada e guarda as diferenças
   com a explicação provável (crm_estoque_conferir). "Pronto quando: 15 dias seguidos sem diferença que não tenha
   explicação" (docs/plano-sair-do-fkn.md). Aqui: as regras puras (testes/estoque.test.js) e a aba Estoque. */
(function (raiz) {
  'use strict';
  const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
  const ehCaixa = cod => /\.\d+$/.test(String(cod || ''));
  // "atual" do FKN = físico (com o reservado para cliente); a listagem antiga só tinha o saldo (= atual − reservado)
  const atualFkn = e => (e.estoque_atual != null ? num(e.estoque_atual) : num(e.quantidade) + num(e.pend_cliente));
  const dia = iso => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : '');

  // Uma linha por produto: o saldo do CRM ao lado do "atual" do FKN (sem as caixas fechadas, que são o mesmo estoque).
  function junta(saldo, fkn) {
    const porCod = new Map();
    (saldo || []).forEach(s => porCod.set(s.codigo, { codigo: s.codigo, descricao: s.descricao, unidade: s.unidade, saldo: num(s.saldo), custo: s.custo_medio == null ? null : num(s.custo_medio),
      ultMov: s.ult_mov || null, fkn: null, minimo: null, fornecedor: null }));
    (fkn || []).filter(e => !ehCaixa(e.codigo)).forEach(e => {
      const l = porCod.get(e.codigo) || { codigo: e.codigo, descricao: e.descricao, unidade: e.unidade, saldo: null, custo: null, ultMov: null };
      Object.assign(l, { fkn: atualFkn(e), minimo: e.estoque_min == null ? null : num(e.estoque_min), fornecedor: e.fornecedor || null, descricao: l.descricao || e.descricao });
      porCod.set(e.codigo, l);
    });
    return [...porCod.values()].map(l => Object.assign(l, { dif: l.saldo == null || l.fkn == null ? null : Math.round((l.fkn - l.saldo) * 1000) / 1000 }));
  }

  // Valor do estoque do CRM a custo médio (saldo negativo não vale).
  const valor = linhas => Math.round((linhas || []).reduce((t, l) => t + Math.max(0, num(l.saldo)) * num(l.custo), 0) * 100) / 100;

  // Dias seguidos (do mais recente para trás) em que TODA listagem conferida fechou sem diferença sem explicação.
  // fotos: crm_estoque_fotos (com resumo). → { dias, desde, ultimoProblema }
  function sequencia(fotos) {
    const porDia = new Map();
    (fotos || []).filter(f => f.resumo).forEach(f => {
      const d = dia(f.gerado_em);
      porDia.set(d, (porDia.get(d) || 0) + num(f.resumo.sem_explicacao));
    });
    const dias = [...porDia.keys()].sort().reverse();
    let n = 0, desde = null;
    for (const d of dias) { if (porDia.get(d) > 0) return { dias: n, desde, ultimoProblema: d }; n++; desde = d; }
    return { dias: n, desde, ultimoProblema: null };
  }

  // Contagem colada (planilha ou bloco de notas): "código;quantidade", "código<TAB>quantidade" ou "código quantidade".
  // Quantidade aceita vírgula decimal ("12,5"). → { lote: [{codigo, contado}], erros: [linha] }
  function lerContagem(texto) {
    const lote = new Map(), erros = [];
    String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(l => {
      const m = /^([0-9A-Za-z.\-]+)\s*[;\t ,]\s*(-?[\d.]*\d(?:,\d+)?|-?\d+(?:\.\d+)?)\s*$/.exec(l);
      if (!m) { erros.push(l); return; }
      // "1.234,5" e "3.000" (milhar com ponto, como na planilha brasileira); "12.5" sem grupo de milhar = decimal
      const q = /,/.test(m[2]) || /^-?\d{1,3}(\.\d{3})+$/.test(m[2]) ? Number(m[2].replace(/\./g, '').replace(',', '.')) : Number(m[2]);
      if (!isFinite(q)) { erros.push(l); return; }
      lote.set(m[1], q);
    });
    return { lote: [...lote.entries()].map(([codigo, contado]) => ({ codigo, contado })), erros };
  }

  const TIPOS = { inicial: 'saldo inicial (FKN)', saida: 'saída (nota)', entrada: 'entrada (compra)', ajuste: 'ajuste', inventario: 'inventário', estorno: 'estorno' };
  const api = { junta, valor, sequencia, lerContagem, atualFkn, ehCaixa, TIPOS };
  raiz.CRMEstoque = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ------------------------------------------------------------ tela (aba Estoque: administrador e comprador)
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, S = raiz.CRMEstoque, R = raiz.CRMRegras;
  if (!CRM || !CRM.telas) return;
  const esc = CRM.esc;
  const qtd = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
  const quando = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

  let saldo = null, fkn = [], fotos = [], difs = [], fotoVista = null, carregando = false;
  const filtro = { ver: 'saldo', busca: '', soDif: false };

  async function carrega() {
    if (carregando) return;
    carregando = true;
    try {
      const st = CRM.store();
      [saldo, fkn, fotos] = await Promise.all([st.estoqueSaldo(), st.estoque(), st.estoqueFotos(60)]);
      const conferida = fotos.find(f => f.conferida_em);
      fotoVista = fotoVista || (conferida && conferida.id) || null;
      difs = fotoVista ? await st.estoqueDifs(fotoVista) : [];
    } catch (e) { saldo = saldo || []; CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }

  function cabecalho() {
    return '<div class="cabecalho"><div><h1>Estoque</h1><p class="sub">o estoque do CRM, em paralelo com o FKN: saldo, movimentos, contagem e a conferência com cada listagem do FKN · Fase 2 da saída do FKN</p></div>' +
      '<div class="acoes"><button type="button" class="btn sec" data-acao="es-recarregar"' + (carregando ? ' disabled' : '') + '>Atualizar</button></div></div>';
  }

  function naoComecado() {
    const ultima = fotos[0];
    return '<section class="cartao"><h2>Começar o estoque do CRM</h2>' +
      '<p>O saldo inicial de cada produto é o <strong>"atual" da listagem do FKN</strong> (o físico, com o reservado para cliente), na hora em que ela foi gerada. ' +
      'Daí em diante, cada nota de venda que chega ao CRM dá a saída sozinha, a nota cancelada devolve, e cada listagem nova do FKN (manhã e tarde) é conferida com o saldo do CRM.</p>' +
      (ultima ? '<p>Última listagem do FKN: gerada em <strong>' + esc(quando(ultima.gerado_em)) + '</strong> (' + (ultima.linhas || '?') + ' linhas).</p>'
        : '<p class="dica">Ainda não chegou nenhuma listagem com a hora. Puxe a listagem de produtos no FKN (a colinha está em Compras) e volte aqui.</p>') +
      (CRM.ehAdmin() && ultima ? '<p class="acoes"><button type="button" class="btn" data-acao="es-iniciar">Começar com a listagem de ' + esc(quando(ultima.gerado_em)) + '</button></p>'
        : !CRM.ehAdmin() ? '<p class="dica">Quem começa é o administrador.</p>' : '') + '</section>';
  }

  function quadros(linhas) {
    const seq = S.sequencia(fotos);
    const ult = fotos.find(f => f.conferida_em);
    const r = (ult && ult.resumo) || {};
    const kpi = (t, v, s, cls, ver) => '<button type="button" class="kpi clicavel ' + (cls || '') + (filtro.ver === ver ? ' ativo' : '') + '" data-acao="es-ver" data-id="' + ver + '"><span>' + esc(t) + '</span><strong>' + v + '</strong><small>' + esc(s) + '</small></button>';
    return '<div class="kpis">' +
      kpi('Produtos no estoque do CRM', (saldo || []).length, 'valor a custo médio: ' + R.moeda(S.valor(linhas)), '', 'saldo') +
      kpi('Última conferência com o FKN', ult ? (r.diferentes || 0) + ' diferença(s)' : '—', ult ? 'listagem de ' + quando(ult.gerado_em) + ' · ' + (r.sem_explicacao || 0) + ' sem explicação' : 'chega com a próxima listagem',
        ult && r.sem_explicacao ? 'vermelho' : ult ? 'verde' : '', 'conferencia') +
      kpi('Dias seguidos sem diferença sem explicação', seq.dias + ' de 15', seq.dias >= 15 ? 'pronto para a Fase 3 do plano' : 'a meta para confiar no estoque do CRM', seq.dias >= 15 ? 'verde' : '', 'conferencia') +
      kpi('Contagem e ajuste', '✎', 'inventário por contagem ou acerto de um produto', '', 'contagem') + '</div>';
  }

  function telaSaldo(linhas) {
    const q = R.normaliza(filtro.busca);
    const l = linhas.filter(x => (!q || R.normaliza(x.descricao + ' ' + x.codigo + ' ' + (x.fornecedor || '')).indexOf(q) !== -1) && (!filtro.soDif || (x.dif != null && Math.abs(x.dif) >= 0.0005)))
      .sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
    return '<section class="cartao"><h2>Saldo por produto <small>' + l.length + ' produto(s)</small></h2>' +
      '<p class="dica">"FKN agora" é o "atual" da última listagem; a diferença daqui pode ser só uma nota emitida depois dela. A conferência de verdade, na mesma hora, está em "Última conferência".</p>' +
      '<p class="acoes"><input type="search" placeholder="Procurar produto, código ou fornecedor" value="' + esc(filtro.busca) + '" data-es-busca class="of-busca"> ' +
      '<label class="filtro-inline"><input type="checkbox" data-es-sodif' + (filtro.soDif ? ' checked' : '') + '> só com diferença</label></p>' +
      (l.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th class="num">Saldo CRM</th><th class="num">FKN agora</th><th class="num">Diferença</th><th class="num">Custo médio</th><th>Último movimento</th><th></th></tr></thead><tbody>' +
        l.slice(0, 300).map(x => '<tr><td><strong>' + esc(R.nomeDeItem(x.descricao || x.codigo)) + '</strong><small>' + esc(x.codigo) + (x.unidade ? ' · ' + esc(x.unidade) : '') + (x.fornecedor ? ' · ' + esc(x.fornecedor) : '') + '</small></td>' +
          '<td class="num">' + qtd(x.saldo) + '</td><td class="num">' + qtd(x.fkn) + '</td>' +
          '<td class="num">' + (x.dif == null ? '—' : Math.abs(x.dif) < 0.0005 ? '✓' : '<strong>' + qtd(x.dif) + '</strong>') + '</td>' +
          '<td class="num">' + (x.custo == null ? '—' : R.moeda(x.custo)) + '</td><td>' + esc(quando(x.ultMov)) + '</td>' +
          '<td class="num">' + (x.saldo != null ? '<button type="button" class="mini" data-acao="es-movs" data-id="' + esc(x.codigo) + '" title="Movimentos">☰</button>' +
            '<button type="button" class="mini" data-acao="es-ajustar" data-id="' + esc(x.codigo) + '" title="Acertar o saldo">✎</button>' : '') + '</td></tr>').join('') +
        '</tbody></table></div>' + (l.length > 300 ? '<p class="dica">Mostrando 300 de ' + l.length + '; use a busca.</p>' : '') : '<p class="vazio">Nada aqui.</p>') + '</section>';
  }

  function telaConferencia() {
    const f = fotos.find(x => x.id === fotoVista);
    const grupos = new Map();
    difs.forEach(d => { const k = d.explicacao || 'sem explicação'; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(d); });
    const ordem = [...grupos.keys()].sort((a, b) => (a === 'sem explicação' ? -1 : b === 'sem explicação' ? 1 : grupos.get(b).length - grupos.get(a).length));
    const opcoes = fotos.filter(x => x.conferida_em).map(x => [x.id, quando(x.gerado_em) + ' · ' + ((x.resumo || {}).diferentes || 0) + ' diferença(s)']);
    return '<section class="cartao"><h2>Conferência CRM × FKN <small>' + (f ? 'listagem de ' + esc(quando(f.gerado_em)) : 'nenhuma ainda') + '</small></h2>' +
      '<p class="dica">Na hora em que o FKN gerou a listagem, o saldo do CRM (o livro até aquele minuto) × o "atual" do FKN. "Sem explicação" é o que conta para a meta dos 15 dias.</p>' +
      (opcoes.length > 1 ? '<p class="acoes"><label class="filtro-inline">Listagem <select data-es-foto>' + CRM.opcoesHTML(opcoes, fotoVista) + '</select></label></p>' : '') +
      (!f ? '<p class="vazio">A primeira conferência sai com a próxima listagem do FKN depois de começar o estoque.</p>'
        : !difs.length ? '<p class="vazio">Tudo igual nos dois. 👍</p>'
          : ordem.map(k => '<details data-chave="es-dif-' + esc(k) + '"' + (k === 'sem explicação' ? ' open' : '') + '><summary>' + (k === 'sem explicação' ? CRM.selo(k, 'vermelho') : esc(k)) + ' — ' + grupos.get(k).length + ' produto(s)</summary>' +
            '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th class="num">CRM</th><th class="num">FKN</th><th class="num">Diferença</th><th></th></tr></thead><tbody>' +
            grupos.get(k).slice(0, 200).map(d => '<tr><td><strong>' + esc(R.nomeDeItem(d.descricao || d.codigo)) + '</strong><small>' + esc(d.codigo) + '</small></td><td class="num">' + qtd(d.saldo_crm) + '</td><td class="num">' + qtd(d.saldo_fkn) + '</td>' +
              '<td class="num"><strong>' + qtd(d.diferenca) + '</strong></td><td class="num"><button type="button" class="mini" data-acao="es-movs" data-id="' + esc(d.codigo) + '" title="Movimentos">☰</button></td></tr>').join('') +
            '</tbody></table></div></details>').join('')) + '</section>';
  }

  function telaContagem() {
    return '<section class="cartao"><h2>Inventário por contagem</h2>' +
      '<p>Contou o estoque (todo ou uma parte)? Cole aqui uma linha por produto: <code>código;quantidade contada</code> (da planilha, com Tab, também serve). ' +
      'O CRM leva o saldo de cada produto ao contado e guarda a diferença no livro como "inventário", com o motivo.</p>' +
      '<p class="acoes"><button type="button" class="btn" data-acao="es-contagem">Lançar uma contagem</button></p>' +
      '<p class="dica">Para acertar um produto só, use o ✎ na lista de saldo. O livro não se apaga: todo acerto fica registrado com quem fez e por quê.</p></section>';
  }

  CRM.telas.estoque = {
    render() {
      if (!(CRM.ehAdmin() || CRM.ehComprador())) return '<div class="cartao"><p class="vazio">Esta tela é do administrador e do comprador.</p></div>';
      if (saldo === null) { setTimeout(carrega, 0); return cabecalho() + '<div class="cartao"><p class="vazio">Carregando…</p></div>'; }
      if (!saldo.length) return cabecalho() + naoComecado();
      const linhas = S.junta(saldo, fkn);
      return cabecalho() + quadros(linhas) +
        (filtro.ver === 'conferencia' ? telaConferencia() : filtro.ver === 'contagem' ? telaContagem() : telaSaldo(linhas));
    },
    depois(c) {
      const b = c.querySelector('[data-es-busca]');
      if (b) b.addEventListener('input', () => { filtro.busca = b.value; CRM.render(); });
      const d = c.querySelector('[data-es-sodif]');
      if (d) d.addEventListener('change', () => { filtro.soDif = d.checked; CRM.render(); });
      const f = c.querySelector('[data-es-foto]');
      if (f) f.addEventListener('change', async () => { fotoVista = Number(f.value); difs = await CRM.store().estoqueDifs(fotoVista).catch(() => []); CRM.render(); });
    }
  };

  Object.assign(CRM.acoes, {
    'es-ver': id => { filtro.ver = id; CRM.render(); },
    'es-recarregar': () => { saldo = null; fotoVista = null; carrega(); },
    'es-iniciar': async () => {
      const ultima = fotos[0];
      if (!ultima || !confirm('Começar o estoque do CRM com o "atual" da listagem do FKN de ' + quando(ultima.gerado_em) + '?\nAs notas emitidas depois dela já dão a saída. Isto se faz uma vez só.')) return;
      try {
        const r = await CRM.store().estoqueIniciar();
        CRM.toast('Estoque do CRM começado: ' + r.produtos + ' produtos, ' + r.itens_depois + ' item(ns) de nota depois da listagem.');
        saldo = null; fotoVista = null; carrega();
      } catch (e) { CRM.falhou(e); }
    },
    'es-movs': async cod => {
      try {
        const l = await CRM.store().estoqueMovs(cod, 200);
        const s = (saldo || []).find(x => x.codigo === cod) || {};
        CRM.abrirForm({
          titulo: 'Movimentos: ' + R.nomeDeItem(s.descricao || cod), largura: 'largo', campos: [], salvarTexto: 'Fechar', aoSalvar: async () => {},
          intro: 'Saldo no CRM: ' + qtd(s.saldo) + (s.unidade ? ' ' + s.unidade : '') + (s.custo_medio != null ? ' · custo médio ' + R.moeda(s.custo_medio) : '') + '. Os 200 mais recentes.',
          htmlDepois: l.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Quando</th><th>Tipo</th><th class="num">Qtd.</th><th>Detalhe</th></tr></thead><tbody>' +
            l.map(m => '<tr><td>' + esc(quando(m.quando)) + '</td><td>' + esc(S.TIPOS[m.tipo] || m.tipo) + (m.conferir ? ' ' + CRM.selo('unidade a conferir', 'ambar') : '') + '</td>' +
              '<td class="num">' + (m.quantidade > 0 ? '+' : '') + qtd(m.quantidade) + '</td><td>' + esc(m.motivo || '') +
              (m.fator && Number(m.fator) !== 1 ? '<small>' + qtd(m.qtd_doc) + ' ' + esc(m.unidade_doc || '') + ' × ' + qtd(m.fator) + '</small>' : '') + '</td></tr>').join('') +
            '</tbody></table></div>' : '<p class="vazio">Nenhum movimento.</p>'
        });
      } catch (e) { CRM.falhou(e); }
    },
    'es-ajustar': cod => {
      const s = (saldo || []).find(x => x.codigo === cod); if (!s) return;
      CRM.abrirForm({
        titulo: 'Acertar o saldo: ' + R.nomeDeItem(s.descricao || cod),
        intro: 'Saldo no CRM agora: ' + qtd(s.saldo) + (s.unidade ? ' ' + s.unidade : '') + '. Diga quanto tem de verdade e o motivo; a diferença vai para o livro como "ajuste".',
        campos: [{ nome: 'contado', rotulo: 'Quantidade certa', tipo: 'numero', min: -1e9, passo: '0.001', obrigatorio: true },
          { nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, dica: 'ex.: contado no galpão, avaria, troca' }],
        valores: { contado: s.saldo }, salvarTexto: 'Acertar',
        aoSalvar: async v => {
          const n = await CRM.store().estoqueContagem([{ codigo: cod, contado: v.contado }], 'ajuste', v.motivo);
          CRM.toast(n ? 'Saldo acertado.' : 'Já estava assim: nada mudou.');
          saldo = null; carrega();
        }
      });
    },
    'es-contagem': () => {
      CRM.abrirForm({
        titulo: 'Lançar uma contagem', largura: 'largo',
        intro: 'Uma linha por produto: código;quantidade contada (ex.: 300005;120). Produto que não está na lista não muda.',
        campos: [{ nome: 'texto', rotulo: 'Contagem', tipo: 'textarea', obrigatorio: true }, { nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, dica: 'ex.: inventário do galpão 16/10' }],
        valores: {}, salvarTexto: 'Conferir e lançar',
        aoSalvar: async v => {
          const r = S.lerContagem(v.texto);
          if (r.erros.length) throw new Error('não entendi ' + r.erros.length + ' linha(s): ' + r.erros.slice(0, 3).join(' | '));
          if (!r.lote.length) throw new Error('nenhuma linha com código e quantidade');
          const conhecidos = new Set((saldo || []).map(x => x.codigo));
          const fora = r.lote.filter(x => !conhecidos.has(x.codigo)).map(x => x.codigo);
          if (fora.length) throw new Error('código(s) que o estoque do CRM não tem: ' + fora.slice(0, 8).join(', '));
          if (!confirm('Levar ' + r.lote.length + ' produto(s) ao contado?')) return false;
          const n = await CRM.store().estoqueContagem(r.lote, 'inventario', v.motivo);
          CRM.toast('Contagem lançada: ' + n + ' produto(s) mudaram, ' + (r.lote.length - n) + ' já batiam.');
          saldo = null; carrega();
        }
      });
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
