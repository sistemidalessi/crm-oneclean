/* CRM Sistemi Dalessi — Vendas → Entregas (04/11/2026, pedido do Anderson: "deixa visível para os vendedores, porque às vezes os
   clientes deles perguntam se está indo aquele dia"). Só leitura: as notas da vendedora (ou dos clientes da carteira dela) na rota
   do dia — com o motorista, a parada (nº X de Y), se a rota já saiu e se foi entregue — e as notas ainda sem rota.
   O banco filtra (crm_entregas_vendedor): a vendedora só vê as dela; gestão e logística veem todas. */
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, R = raiz.CRMRegras;
  if (!CRM || !CRM.telas) return;
  const esc = CRM.esc;
  const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const hora = iso => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '');
  let dados = null, carregando = false, lidoEm = 0;
  const f = { dia: null, busca: '' };

  async function carrega() {
    if (carregando) return;
    carregando = true;
    const dia = f.dia || (f.dia = hojeSP());
    try { dados = { dia, l: (CRM.store().entregasVendedor ? await CRM.store().entregasVendedor(dia, dia) : []) || [] }; lidoEm = Date.now(); }
    catch (e) { dados = dados || { dia, l: [] }; CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }
  function situacao(x) {
    if (x.situacao === 'entregue') return CRM.selo('entregue' + (x.entregue_em ? ' às ' + hora(x.entregue_em) : ''), 'verde');
    if (x.situacao === 'problema') return CRM.selo('teve problema', 'vermelho') + (x.obs ? '<small>' + esc(x.obs) + '</small>' : '');
    if (!x.motorista) return CRM.selo('na rota, ainda sem motorista', 'ambar');
    if (!x.saiu) return CRM.selo('na rota, ainda não saiu', 'ambar');
    return CRM.selo('saiu para entrega', 'azul');
  }
  const bate = (x, q) => !q || R.normaliza([x.numero, x.cliente, x.bairro, x.cidade, x.vendedor, x.motorista].join(' ')).includes(q);

  CRM.telas.entregas = {
    render() {
      if (!dados || dados.dia !== f.dia) { setTimeout(carrega, 0); return '<div class="cabecalho"><div><h1>Entregas</h1></div></div><div class="cartao"><p class="vazio">Carregando…</p></div>'; }
      if (Date.now() - lidoEm > 60000 && !carregando) setTimeout(carrega, 0); // o motorista vai confirmando: a tela se atualiza sozinha
      const hoje = hojeSP(), todos = CRM.ehGestor(), q = R.normaliza(f.busca);
      const rota = dados.l.filter(x => x.tipo === 'rota' && bate(x, q)), sem = dados.l.filter(x => x.tipo === 'sem_rota' && bate(x, q));
      const ent = rota.filter(x => x.situacao === 'entregue').length;
      const diaBtn = (d, t) => '<button type="button" class="' + (f.dia === d ? 'ativa' : '') + '" data-acao="ent-dia" data-id="' + d + '">' + esc(t) + '</button>';
      const cab = '<div class="cabecalho"><div><h1>Entregas</h1><p class="sub">' + (todos ? 'As entregas do dia de toda a equipe' : 'As entregas dos seus clientes') +
        ': para responder ao cliente se o pedido vai hoje. Atualiza sozinha a cada minuto.</p></div></div>';
      return cab + '<section class="cartao"><div class="filtros-compras"><nav class="cx-abas">' + diaBtn(R.somaDias(hoje, -1), 'Ontem') + diaBtn(hoje, 'Hoje') + diaBtn(R.somaDias(hoje, 1), 'Amanhã') + '</nav>' +
          '<label>Dia <input type="date" id="entDia" value="' + esc(f.dia) + '"></label>' +
          '<input type="search" id="entBusca" placeholder="NF, cliente, bairro, motorista" value="' + esc(f.busca) + '">' +
          '<button type="button" class="btn sec" data-acao="ent-atualizar">⟳ Atualizar</button></div>' +
        '<h3>Na rota de ' + esc(R.dataBR(f.dia)) + ' <small>' + rota.length + ' entrega(s)' + (rota.length ? ' · ' + ent + ' entregue(s)' : '') + '</small></h3>' +
        (rota.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th class="num">NF</th><th>Cliente</th><th>Bairro / cidade</th>' + (todos ? '<th>Vendedor(a)</th>' : '') +
            '<th>Motorista</th><th>Situação</th></tr></thead><tbody>' +
          rota.map(x => '<tr><td class="num">' + esc(String(x.numero)) + '</td><td><strong>' + esc(x.cliente || '') + '</strong></td><td>' + esc([x.bairro, x.cidade].filter(Boolean).join(' · ')) + '</td>' +
            (todos ? '<td>' + esc(x.vendedor || '') + '</td>' : '') +
            '<td>' + esc(x.motorista || '—') + (x.parada ? '<small>parada ' + x.parada + ' de ' + x.paradas + '</small>' : '') + '</td><td>' + situacao(x) + '</td></tr>').join('') +
          '</tbody></table></div>' : '<p class="vazio">Nenhuma entrega ' + (todos ? '' : 'sua ') + 'na rota deste dia' + (q ? ' com essa pesquisa' : '') + '.</p>') +
        '</section>' +
        '<section class="cartao"><h3>Notas ainda sem rota <small>emitidas nos últimos 10 dias que a logística ainda não pôs em rota nenhuma</small></h3>' +
        (sem.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th class="num">NF</th><th>Cliente</th><th>Bairro / cidade</th>' + (todos ? '<th>Vendedor(a)</th>' : '') + '<th>Emitida</th></tr></thead><tbody>' +
          sem.map(x => '<tr><td class="num">' + esc(String(x.numero)) + '</td><td><strong>' + esc(x.cliente || '') + '</strong></td><td>' + esc([x.bairro, x.cidade].filter(Boolean).join(' · ')) + '</td>' +
            (todos ? '<td>' + esc(x.vendedor || '') + '</td>' : '') + '<td>' + esc(R.dataBR(R.diaLocal(x.emitida_em))) + ' ' + esc(hora(x.emitida_em)) + '</td></tr>').join('') +
          '</tbody></table></div>' : '<p class="vazio">Nenhuma.</p>') +
        '<p class="dica">Entrega programada (ex.: Uniserv) e simples faturamento não entram em rota. Dúvida sobre o dia de uma nota: fale com a logística.</p></section>';
    },
    depois(el) {
      const d = el.querySelector('#entDia'), b = el.querySelector('#entBusca');
      if (d) d.addEventListener('change', () => { f.dia = d.value || hojeSP(); CRM.render(); });
      if (b) b.addEventListener('input', () => { f.busca = b.value; clearTimeout(b._t); b._t = setTimeout(() => { CRM.render(); const x = document.getElementById('entBusca'); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 250); });
    }
  };
  Object.assign(CRM.acoes, {
    'ent-dia': d => { f.dia = d; CRM.render(); },
    'ent-atualizar': () => { lidoEm = 0; dados = null; carrega(); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
