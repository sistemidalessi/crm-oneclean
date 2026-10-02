/* CRM Sistemi Dalessi — Contas a receber (títulos em aberto do FKN).
   Parte pura (CRMFinanceiro, testada em testes/financeiro.test.js): lê a listagem "Contas a
   receber por cliente — em aberto" (SIFN016, salva em CSV), liga cada título ao cliente do CRM
   (pela nota com o mesmo número e CNPJ; senão pelo CNPJ) e resume por cliente.
   Parte de tela: o que a ficha, a Recompra, a Fila do dia e a Gestão mostram. Cada importação
   é um retrato novo: o que foi pago some no próximo arquivo. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  const num = R.num;
  const digitos = v => String(v == null ? '' : v).replace(/\D/g, '');

  // Leitores (contas a receber do FKN) em fkn.js.
  const K = raiz.CRMFkn || (typeof require !== 'undefined' ? require('./fkn.js') : null);
  const { lerContasReceber, ehContasReceber, ligaEmpresas, dataFKN } = K;

  // Resumo de uma lista de títulos no dia "hoje": em aberto, vencido, a vencer e o maior atraso.
  function resume(lista, hoje) {
    const r = { aberto: 0, vencido: 0, aVencer: 0, qtd: lista.length, qtdVencidos: 0, maiorAtraso: 0, proximo: null, titulos: lista };
    lista.forEach(t => {
      const v = num(t.valor);
      r.aberto += v;
      if (t.vencimento < hoje) { r.vencido += v; r.qtdVencidos++; r.maiorAtraso = Math.max(r.maiorAtraso, R.diasEntre(t.vencimento, hoje)); }
      else { r.aVencer += v; if (!r.proximo || t.vencimento < r.proximo) r.proximo = t.vencimento; }
    });
    return r;
  }
  function porEmpresa(titulos, hoje) {
    const g = new Map();
    (titulos || []).forEach(t => { if (!t.empresa_id) return; if (!g.has(t.empresa_id)) g.set(t.empresa_id, []); g.get(t.empresa_id).push(t); });
    const m = new Map();
    g.forEach((l, id) => m.set(id, resume(l.sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1)), hoje)));
    return m;
  }
  // Painel da Gestão: totais, vencidos por cliente, por vendedor e o que vence nos próximos dias.
  function painel(titulos, D, hoje, nomeUsuario) {
    const l = titulos || [];
    const total = resume(l, hoje);
    const emp = new Map((D.empresas || []).map(e => [e.id, e]));
    const grupos = new Map();
    l.forEach(t => { const k = t.empresa_id || 'c:' + t.cliente_codigo; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(t); });
    const clientes = [...grupos.entries()].map(([k, ts]) => {
      const e = emp.get(ts[0].empresa_id) || null;
      return Object.assign(resume(ts, hoje), { empresa: e, nome: e ? e.nome : ts[0].cliente_nome, vendedor: e ? (nomeUsuario ? nomeUsuario(e.responsavel_id) : '') : ts[0].vendedor_nome || '' });
    });
    const vencidos = clientes.filter(c => c.vencido > 0).sort((a, b) => b.vencido - a.vencido);
    const porVend = new Map();
    clientes.forEach(c => { const k = c.vendedor || '—'; const v = porVend.get(k) || { vendedor: k, aberto: 0, vencido: 0, clientes: 0, clientesVencidos: 0 };
      v.aberto += c.aberto; v.vencido += c.vencido; v.clientes++; if (c.vencido > 0) v.clientesVencidos++; porVend.set(k, v); });
    const em7 = R.somaDias(hoje, 7);
    return { total, clientes: clientes.length, vencidos, porVendedor: [...porVend.values()].sort((a, b) => b.vencido - a.vencido || b.aberto - a.aberto),
      semCliente: clientes.filter(c => !c.empresa), vence7: l.filter(t => t.vencimento >= hoje && t.vencimento <= em7).reduce((s, t) => s + num(t.valor), 0),
      posicao: l.reduce((m, t) => (t.atualizado_em && t.atualizado_em > m ? t.atualizado_em : m), '') };
  }

  const F = { lerContasReceber, ehContasReceber, ligaEmpresas, resume, porEmpresa, painel, dataFKN };
  raiz.CRMFinanceiro = F;
  if (typeof module !== 'undefined') module.exports = F;

  // ------------------------------------------------------------ tela
  const CRM = raiz.CRM;
  if (!CRM || !CRM.acoes) return;
  const { esc } = CRM;
  const E = () => CRM.estado;

  let cache = { ref: null, hoje: '', mapa: new Map() };
  const mapa = () => {
    const l = (E().D && E().D.titulos) || [], hoje = CRM.hoje();
    if (cache.ref !== l || cache.hoje !== hoje) cache = { ref: l, hoje, mapa: porEmpresa(l, hoje) };
    return cache.mapa;
  };
  // Resumo financeiro de um cliente (null se não deve nada ou se quem vê não tem acesso).
  CRM.financeiro = id => mapa().get(id) || null;
  const atraso = d => (d === 1 ? '1 dia' : d + ' dias');
  // Selo vermelho para quem tem título vencido (curto: lista; completo: ficha).
  CRM.seloFinanceiro = (id, completo) => {
    const f = CRM.financeiro(id);
    if (!f || f.vencido <= 0) return '';
    return CRM.selo((completo ? 'Título vencido: ' : 'vencido ') + R.moeda(f.vencido) + ' · ' + atraso(f.maiorAtraso), 'vermelho');
  };
  // Linha de aviso (Fila do dia, WhatsApp de recompra).
  CRM.avisoFinanceiro = id => {
    const f = CRM.financeiro(id);
    if (!f || f.vencido <= 0) return '';
    return 'Tem ' + f.qtdVencidos + ' título(s) vencido(s) no FKN: ' + R.moeda(f.vencido) + ', o mais antigo há ' + atraso(f.maiorAtraso) + '. Combine o pagamento antes de oferecer pedido novo.';
  };
  const posicaoTxt = () => {
    const l = (E().D && E().D.titulos) || [];
    const p = l.reduce((m, t) => (t.atualizado_em && t.atualizado_em > m ? t.atualizado_em : m), '');
    return p ? 'atualizado do FKN em ' + R.dataBR(p) + ' ' + R.horaLocal(p) : '';
  };
  // Seção da ficha do cliente.
  CRM.fichaFinanceiro = id => {
    const f = CRM.financeiro(id);
    if (!f) return '';
    const hoje = CRM.hoje();
    return '<section class="financeiro"><h3>Contas a receber <small>' + esc(posicaoTxt()) + '</small></h3>' +
      '<p class="resumo-compras' + (f.vencido > 0 ? ' devendo' : '') + '"><strong>' + esc(R.moeda(f.aberto)) + '</strong> em aberto em ' + f.qtd + ' título(s)' +
        (f.vencido > 0 ? '<br>' + CRM.selo('vencido ' + R.moeda(f.vencido), 'vermelho') + ' ' + f.qtdVencidos + ' título(s), o mais antigo há ' + esc(atraso(f.maiorAtraso)) : '<br>nada vencido') +
        (f.proximo ? '<br>próximo vencimento ' + esc(R.dataBR(f.proximo)) : '') + '</p>' +
      '<ul class="lista titulos">' + f.titulos.map(t => {
        const venc = t.vencimento < hoje;
        return '<li><span>' + esc(t.duplicata) + (t.abono ? ' <small>(abono)</small>' : '') + ' · NF ' + esc(t.nota_numero || '') +
          (t.origem === 'nota' ? ' <small title="Criado pela parcela da nota fiscal; a próxima listagem do FKN confirma">(da nota)</small>' : '') + '</span>' +
          '<small>vence ' + esc(R.dataBR(t.vencimento)) + (venc ? ' ' + CRM.selo(atraso(R.diasEntre(t.vencimento, hoje)) + ' em atraso', 'vermelho') : '') + (t.portador ? ' · ' + esc(t.portador) : '') + '</small>' +
          '<strong>' + esc(R.moeda(t.valor)) + '</strong></li>';
      }).join('') + '</ul></section>';
  };

  // Cartão da Gestão (administrador): importar e acompanhar.
  CRM.cartaoReceber = () => {
    if (!CRM.ehAdmin()) return '';
    const hoje = CRM.hoje(), l = E().D.titulos || [];
    const botao = '<label class="btn sec arquivo" title="No FKN: Contas a receber por cliente, Em aberto, salvar em CSV">Atualizar (listagem do FKN)<input type="file" id="fReceber" accept=".csv,.txt,text/csv"></label>';
    if (!l.length) return '<section class="cartao" id="g-receber"><h2>Contas a receber <span class="flex"></span>' + botao + '</h2>' +
      '<p class="vazio">Sem títulos do FKN ainda. No FKN: Contas a receber por cliente → Em aberto → salvar em CSV, e clique em "Atualizar".</p></section>';
    const p = painel(l, E().D, hoje, CRM.nomeUsuario);
    const pos = posicaoTxt(), velho = p.posicao && R.diasEntre(R.diaLocal(p.posicao), hoje) > 3;
    const kpi = (t, v, s, cls) => '<div class="kpi ' + (cls || '') + '"><span>' + esc(t) + '</span><strong>' + esc(v) + '</strong><small>' + s + '</small></div>';
    return '<section class="cartao" id="g-receber"><h2>Contas a receber <small>' + esc(pos) + '</small>' + (velho ? ' ' + CRM.selo('desatualizado: exporte de novo no FKN', 'ambar') : '') + '<span class="flex"></span>' +
        '<button type="button" class="btn sec" data-acao="receber-exportar">Exportar vencidos</button>' + botao + '</h2>' +
      '<section class="kpis">' +
        kpi('Em aberto', R.moeda(p.total.aberto), p.total.qtd + ' títulos · ' + p.clientes + ' clientes', 'azul') +
        kpi('Vencido', R.moeda(p.total.vencido), p.total.qtdVencidos + ' títulos · ' + p.vencidos.length + ' clientes', p.total.vencido > 0 ? 'vermelho' : '') +
        kpi('Vence em 7 dias', R.moeda(p.vence7), 'a cobrar logo') +
        kpi('A vencer', R.moeda(p.total.aVencer), 'no prazo', 'verde') +
      '</section>' +
      '<div class="g-duas">' +
        '<section><h3>Vencidos por cliente</h3>' + (p.vencidos.length ? '<ul class="lista">' + p.vencidos.slice(0, 15).map(c => '<li>' +
          (c.empresa ? '<button type="button" class="linha" data-acao="abrir-empresa" data-id="' + esc(c.empresa.id) + '">' : '<div class="linha">') +
          '<strong>' + esc(c.nome) + '</strong><small>' + CRM.selo(R.moeda(c.vencido), 'vermelho') + ' há ' + esc(atraso(c.maiorAtraso)) + ' · ' + c.qtdVencidos + ' título(s)' +
          (c.vendedor ? ' · ' + esc(c.vendedor) : '') + (c.empresa ? '' : ' · sem cadastro no CRM') + '</small>' + (c.empresa ? '</button>' : '</div>') + '</li>').join('') + '</ul>' +
          (p.vencidos.length > 15 ? '<p class="mais">e mais ' + (p.vencidos.length - 15) + '… (o arquivo exportado tem todos)</p>' : '') : '<p class="vazio">Nada vencido. 👍</p>') + '</section>' +
        '<section><h3>Por vendedora</h3><div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Carteira</th><th class="num">Em aberto</th><th class="num">Vencido</th><th class="num">Clientes</th></tr></thead><tbody>' +
          p.porVendedor.map(v => '<tr><td>' + esc(v.vendedor) + '</td><td class="num">' + esc(R.moeda(v.aberto)) + '</td><td class="num">' + (v.vencido > 0 ? CRM.selo(R.moeda(v.vencido), 'vermelho') : '—') + '</td>' +
            '<td class="num">' + v.clientes + (v.clientesVencidos ? ' <small>' + v.clientesVencidos + ' com vencido</small>' : '') + '</td></tr>').join('') + '</tbody></table></div>' +
          (p.semCliente.length ? '<p class="dica">' + p.semCliente.length + ' cliente(s) do FKN sem cadastro no CRM (CNPJ não encontrado): ' + esc(p.semCliente.slice(0, 5).map(c => c.nome).join(', ')) + (p.semCliente.length > 5 ? '…' : '') + '.</p>' : '') +
        '</section>' +
      '</div></section>';
  };
  CRM.depoisReceber = () => {
    const arq = document.getElementById('fReceber');
    if (arq) arq.addEventListener('change', () => { const f = arq.files[0]; if (f) importa(f).catch(CRM.falhou); });
  };

  async function importa(f) {
    const buf = await f.arrayBuffer();
    let txt = new TextDecoder('utf-8').decode(buf);
    if (txt.indexOf('\uFFFD') !== -1) txt = new TextDecoder('windows-1252').decode(buf); // CSV do FKN é Windows-1252
    const lido = lerContasReceber(txt);
    const conf = K.conferirContasReceber(txt, lido);
    if (conf.recusa.length) throw new Error('Arquivo recusado, nada foi trocado: ' + conf.recusa.join('; ') + '. Veja a colinha no fim de Compras.');
    const lig = ligaEmpresas(lido.titulos, E().D, E().ix);
    CRM.toast('Gravando ' + lig.titulos.length + ' títulos…');
    const gerado = lido.posicao ? new Date(lido.posicao + 'T' + (lido.hora || '00:00') + ':00-03:00').toISOString() : null; // horário de Brasília
    const l = await CRM.store().salvarTitulos(lig.titulos, gerado);
    E().D.titulos = l;
    if (CRM.recarregarFkn) CRM.recarregarFkn();
    CRM.toast('Contas a receber atualizado: ' + lig.titulos.length + ' títulos de ' + lido.clientes + ' clientes (' + R.moeda(lido.soma) + ')' +
      (lig.sem ? ' · ' + lig.sem + ' sem cliente no CRM' : '') + (lido.confere ? '' : ' · ATENÇÃO: a soma não bate com o total geral do FKN (' + R.moeda(lido.totalGeral) + ')') + '.');
    CRM.render();
  }

  Object.assign(CRM.acoes, {
    'receber-exportar': () => {
      const p = painel(E().D.titulos || [], E().D, CRM.hoje(), CRM.nomeUsuario);
      CRM.baixarCSV('contas-a-receber-vencidos', ['Cliente', 'Carteira', 'Duplicata', 'Nota', 'Emissão', 'Vencimento', 'Dias em atraso', 'Valor', 'Portador'],
        [].concat(...p.vencidos.map(c => c.titulos.filter(t => t.vencimento < CRM.hoje()).map(t => [c.nome, c.vendedor, t.duplicata, t.nota_numero || '', R.dataBR(t.emitida_em), R.dataBR(t.vencimento),
          R.diasEntre(t.vencimento, CRM.hoje()), num(t.valor), t.portador || '']))));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
