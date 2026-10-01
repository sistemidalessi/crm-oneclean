/* CRM Sistemi Dalessi — tipo de cliente pelas compras: novo, recorrente, reativado, inativo.
   Compras = notas fiscais de venda + negócios ganhos (compras a até 3 dias uma da outra contam
   como uma só). Novo: 1ª compra nos últimos dias_cliente_novo (90). Reativado: voltou a comprar,
   nos últimos dias_cliente_novo, depois de ficar mais que dias_inativo (Configurações → Geral)
   sem comprar. Inativo: sem compra há mais que dias_inativo. Senão, recorrente.
   Parte pura (CRMPerfil.tipoCliente) testada em testes/perfil.test.js. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);

  const TIPOS = [['novo', 'Novo'], ['recorrente', 'Recorrente'], ['reativado', 'Reativado'], ['inativo', 'Inativo'], ['sem_compra', 'Sem compra']];
  const COR = { novo: 'verde', recorrente: 'azul', reativado: 'roxo', inativo: 'vermelho', sem_compra: 'cinza' };

  function tipoCliente(datas, hoje, cfg) {
    cfg = cfg || {};
    const janela = R.num(cfg.dias_cliente_novo) || 90, inativo = R.num(cfg.dias_inativo) || 90;
    const d = [...new Set((datas || []).filter(Boolean).map(x => String(x).slice(0, 10)))].sort();
    const c = [];
    d.forEach(x => { if (!c.length || R.diasEntre(c[c.length - 1], x) > 3) c.push(x); });
    if (!c.length) return { tipo: 'sem_compra', compras: 0 };
    const base = { compras: c.length, primeira: c[0], ultima: c[c.length - 1] };
    if (R.diasEntre(base.ultima, hoje) > inativo) return Object.assign(base, { tipo: 'inativo', desde: base.ultima });
    if (R.diasEntre(base.primeira, hoje) <= janela) return Object.assign(base, { tipo: 'novo', desde: base.primeira });
    for (let i = c.length - 1; i > 0; i--) {
      if (R.diasEntre(c[i - 1], c[i]) > inativo) {
        if (R.diasEntre(c[i], hoje) <= janela) return Object.assign(base, { tipo: 'reativado', desde: c[i], parado: R.diasEntre(c[i - 1], c[i]) });
        break;
      }
    }
    return Object.assign(base, { tipo: 'recorrente' });
  }

  const P = { TIPOS, COR, tipoCliente };
  raiz.CRMPerfil = P;
  if (typeof module !== 'undefined') module.exports = P;

  // ------------------------------------------------------------ no app
  const CRM = raiz.CRM;
  if (!CRM) return;
  const { esc } = CRM;
  let cacheIx = null, cache = new Map();
  CRM.tipoCliente = e => {
    const E = CRM.estado;
    if (cacheIx !== E.ix) { cacheIx = E.ix; cache = new Map(); }
    if (!e) return { tipo: 'sem_compra', compras: 0 };
    if (!cache.has(e.id)) {
      const r = CRM.resumo(e.id) || {};
      const ganhos = CRM.doEmpresa('negocios', e.id).filter(n => n.status === 'ganho' && n.fechado_em).map(n => n.fechado_em);
      cache.set(e.id, tipoCliente((r.datasCompras || []).concat(ganhos), CRM.hoje(), E.cfg));
    }
    return cache.get(e.id);
  };
  CRM.seloTipoCliente = (e, comData) => {
    const t = CRM.tipoCliente(e);
    if (t.tipo === 'sem_compra') return '';
    const quando = t.tipo === 'novo' ? '1ª compra em ' + R.dataBR(t.desde) : t.tipo === 'reativado' ? 'voltou a comprar em ' + R.dataBR(t.desde) + ' (ficou ' + t.parado + ' dias sem comprar)'
      : t.tipo === 'inativo' ? 'última compra em ' + R.dataBR(t.ultima) : t.compras + ' compras desde ' + R.dataBR(t.primeira);
    return '<span class="selo-tipo" title="' + esc(quando) + '">' + CRM.selo(R.rotulo(TIPOS, t.tipo), COR[t.tipo]) + (comData ? ' <small>' + esc(quando) + '</small>' : '') + '</span>';
  };
})(typeof window !== 'undefined' ? window : globalThis);
