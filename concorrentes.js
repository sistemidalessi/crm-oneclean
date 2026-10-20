/* CRM Sistemi Dalessi — Concorrentes: comparação mensal de preços (18/10/2026, pedido do Anderson: "acompanhar de
   perto" os maiores concorrentes). A CESTA são os produtos comparados todo mês, cada um com uma unidade de comparação
   ("metro", "folha", "litro"…) e quantas dessas há na nossa unidade (fator). O comprador lança, uma vez por mês, o preço
   que viu no site ou na cotação de cada concorrente e quanto vem na embalagem dele (na mesma unidade); o CRM compara
   por unidade com o nosso preço de tabela (e com o custo). Só administrador e comprador. A lista de concorrentes fica
   no banco (crm_concorrentes), não no código. Parte pura no começo (testes/concorrentes.test.js). */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  const { num } = R;
  const codigo = v => String(v == null ? '' : v).trim().replace(/\.0+$/, '');
  const mesDe = dia => String(dia).slice(0, 7) + '-01';
  const mesAntes = mes => { const [a, m] = mes.split('-').map(Number); return (m === 1 ? a - 1 + '-12' : a + '-' + String(m - 1).padStart(2, '0')) + '-01'; };

  // A comparação de um mês. cesta: crm_cesta (ativos); estoque: crm_estoque (preço de tabela e custo da NOSSA unidade);
  // precos: crm_precos_concorrente (este mês e o anterior); concorrentes: crm_concorrentes (ativos).
  // → { linhas: [{ codigo, descricao, unidade, unidade_comp, fator, nosso, custo, conc: { [id]: { preco, quantidade,
  //     porUnidade, dif, antes, variacao, link } }, maisBarato }], resumo: { [id]: { lancados, maisBaratos, difMedia } }, faltam }
  function comparar({ cesta, estoque, precos, concorrentes, mes }) {
    const est = new Map((estoque || []).map(x => [codigo(x.codigo), x]));
    const ant = mesAntes(mes);
    const chave = (m, c, cod) => m + '|' + c + '|' + codigo(cod);
    const pm = new Map((precos || []).map(p => [chave(String(p.mes).slice(0, 10), p.concorrente_id, p.codigo), p]));
    const conc = (concorrentes || []).filter(c => c.ativo !== false);
    const resumo = {};
    conc.forEach(c => { resumo[c.id] = { lancados: 0, maisBaratos: 0, difs: [] }; });
    let faltam = 0;
    const linhas = (cesta || []).filter(x => x.ativo !== false).sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || codigo(a.codigo).localeCompare(codigo(b.codigo)))
      .map(x => {
        const e = est.get(codigo(x.codigo)) || {};
        const fator = num(x.fator) > 0 ? num(x.fator) : 1;
        const custoUn = num(e.custo_compra) || num(e.custo_unit) || null;
        const nosso = num(e.preco_venda) > 0 ? num(e.preco_venda) / fator : null;
        const l = { codigo: codigo(x.codigo), descricao: e.descricao || x.codigo, unidade: e.unidade || '', unidade_comp: x.unidade_comp || 'unidade', fator,
          nosso, custo: custoUn ? custoUn / fator : null, conc: {}, maisBarato: null };
        let menor = null;
        conc.forEach(c => {
          const p = pm.get(chave(mes, c.id, x.codigo)), a = pm.get(chave(ant, c.id, x.codigo));
          if (!p) { faltam++; l.conc[c.id] = a ? { antes: num(a.preco) / num(a.quantidade || 1) } : null; return; }
          const porUnidade = num(p.preco) / (num(p.quantidade) > 0 ? num(p.quantidade) : 1);
          const antes = a ? num(a.preco) / (num(a.quantidade) > 0 ? num(a.quantidade) : 1) : null;
          const dif = nosso ? (porUnidade / nosso - 1) * 100 : null;   // positivo = o concorrente está mais caro que nós
          l.conc[c.id] = { preco: num(p.preco), quantidade: num(p.quantidade) || 1, porUnidade, dif, antes, variacao: antes ? (porUnidade / antes - 1) * 100 : null,
            link: p.link || null, descricao: p.descricao || null, obs: p.obs || null };
          resumo[c.id].lancados++;
          if (dif != null) { resumo[c.id].difs.push(dif); if (dif < 0) resumo[c.id].maisBaratos++; }
          if (!menor || porUnidade < menor.v) menor = { id: c.id, v: porUnidade };
        });
        if (menor && nosso && menor.v < nosso) l.maisBarato = menor.id;
        return l;
      });
    Object.values(resumo).forEach(r => { r.difMedia = r.difs.length ? r.difs.reduce((s, v) => s + v, 0) / r.difs.length : null; delete r.difs; });
    return { linhas, resumo, faltam, total: linhas.length * conc.length };
  }

  // Sugestão de cesta: os produtos da curva A que ainda têm estoque e preço de tabela, até "n".
  function sugerirCesta(produtos, n) {
    return (produtos || []).filter(g => g.classe === 'A' && g.codigo && g.saldo != null && !g.inativo && g.precoVenda).sort((a, b) => b.valor12 - a.valor12)
      .slice(0, n || 20).map((g, i) => ({ codigo: codigo(g.codigo), unidade_comp: g.unidade || 'unidade', fator: 1, ordem: i + 1 }));
  }

  const C = { comparar, sugerirCesta, mesDe, mesAntes };
  raiz.CRMConcorrentes = C;
  if (typeof module !== 'undefined') module.exports = C;

  // ------------------------------------------------------------ tela
  const CRM = raiz.CRM;
  if (!CRM || !CRM.telas) return;
  const { esc } = CRM;
  const E = () => CRM.estado;
  let dados = null, carregando = false, mes = null;
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const nomeMes = m => MESES[+m.slice(5, 7) - 1] + ' de ' + m.slice(0, 4);
  const pct = v => (v == null ? '' : (v > 0 ? '+' : '') + R.pct(v));
  const porUn = v => (v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }));

  async function carrega() {
    if (carregando) return;
    carregando = true;
    const st = CRM.store();
    try {
      const desde = mesAntes(mes);
      const [concorrentes, cesta, precos, estoque] = await Promise.all([st.concorrentes(), st.cesta(), st.precosConcorrente(desde), st.estoque ? st.estoque() : []]);
      dados = { concorrentes, cesta, precos, estoque };
    } catch (e) { dados = { concorrentes: [], cesta: [], precos: [], estoque: [] }; CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }

  // Lembrete do mês para o painel do comprador (Compras): quantos preços faltam lançar.
  CRM.concorrentesFaltam = () => {
    if (!dados || !mes) return null;
    const c = comparar(Object.assign({ mes }, dados));
    return c.total ? { faltam: c.faltam, total: c.total, mes: nomeMes(mes) } : null;
  };

  CRM.telas.concorrentes = {
    render() {
      if (!CRM.ehAdmin() && !CRM.ehComprador()) return '<div class="cartao"><p class="vazio">Esta tela é do administrador e do comprador.</p></div>';
      mes = mes || mesDe(CRM.hoje());
      if (!dados) { setTimeout(carrega, 0); return '<div class="cabecalho"><div><h1>Concorrentes</h1></div></div><div class="cartao"><p class="vazio">Carregando…</p></div>'; }
      const conc = dados.concorrentes.filter(c => c.ativo !== false).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      const c = comparar(Object.assign({ mes }, dados));
      const meses = [0, 1, 2, 3, 4, 5].map(i => { let m = mesDe(CRM.hoje()); for (let k = 0; k < i; k++) m = mesAntes(m); return [m, nomeMes(m)]; });
      const selo = d => (d == null ? '' : CRM.selo(Math.abs(d) < 1 ? 'igual' : d > 0 ? pct(d) + ' mais caro' : pct(-d).replace('+', '') + ' mais barato', Math.abs(d) < 1 ? 'cinza' : d > 0 ? 'verde' : 'vermelho'));
      return '<div class="cabecalho"><div><h1>Concorrentes</h1><p class="sub">comparação de preço por unidade, uma vez por mês · o selo diz se o concorrente está mais caro ou mais barato que a nossa tabela</p></div>' +
          '<span class="flex"></span><select id="ccMes" aria-label="Mês">' + CRM.opcoesHTML(meses, mes) + '</select>' +
          '<button type="button" class="btn sec" data-acao="cc-concorrente" data-id="">Concorrentes</button>' +
          '<button type="button" class="btn sec" data-acao="cc-cesta-add">+ Produto na cesta</button>' +
          (c.linhas.length ? '<button type="button" class="btn sec" data-acao="cc-exportar">Baixar planilha</button>' : '') + '</div>' +
        (c.total ? '<p class="dica">' + nomeMes(mes) + ': ' + (c.total - c.faltam) + ' de ' + c.total + ' preços lançados.' + (c.faltam ? ' Clique na célula vazia para lançar.' : ' Comparação do mês completa.') + '</p>' : '') +
        (conc.length ? '<section class="kpis">' + conc.map(k => { const r = c.resumo[k.id] || {};
          return '<div class="kpi"><span>' + esc(k.nome) + '</span><strong>' + (r.difMedia == null ? '—' : esc(pct(r.difMedia))) + '</strong><small>' +
            (r.lancados ? r.lancados + ' preço(s) · ' + (r.difMedia == null ? '' : r.difMedia > 0 ? 'em média mais caro que nós' : 'em média mais barato que nós') + (r.maisBaratos ? ' · mais barato em ' + r.maisBaratos : '') : 'nenhum preço neste mês') +
            '</small></div>'; }).join('') + '</section>' : '') +
        (!c.linhas.length ? '<section class="cartao"><h2>Monte a cesta</h2><p>A cesta são os produtos comparados todo mês (uns 20 bastam). O jeito mais rápido é começar pelos mais vendidos.</p>' +
            '<p><button type="button" class="btn" data-acao="cc-sugerir">Sugerir a cesta (20 mais vendidos da curva A)</button></p></section>'
          : '<section class="cartao"><div class="tabela-rolagem"><table class="tabela concorrentes"><thead><tr><th>Produto</th><th class="num">Nosso preço<br><small>por unidade de comparação</small></th>' +
            conc.map(k => '<th class="num">' + esc(k.nome) + (k.site ? ' <a href="' + esc(k.site) + '" target="_blank" rel="noopener" title="Abrir o site">↗</a>' : '') + '</th>').join('') + '</tr></thead><tbody>' +
            c.linhas.map(l => '<tr><td><strong>' + esc(R.nomeDeItem(l.descricao)) + '</strong><small>' + esc(l.codigo) + ' · por ' + esc(l.unidade_comp) +
                (l.fator !== 1 ? ' (1 ' + esc(l.unidade || 'un') + ' = ' + esc(String(+l.fator.toFixed(4)).replace('.', ',')) + ')' : '') +
                ' <button type="button" class="mini" data-acao="cc-cesta" data-id="' + esc(l.codigo) + '" title="Unidade de comparação, ordem, tirar da cesta">✎</button></small></td>' +
              '<td class="num"><strong>' + porUn(l.nosso) + '</strong>' + (l.custo ? '<br><small>custo ' + porUn(l.custo) + '</small>' : '') + '</td>' +
              conc.map(k => { const x = l.conc[k.id];
                if (!x || x.preco == null) return '<td class="num"><button type="button" class="mini" data-acao="cc-preco" data-id="' + esc(k.id + '|' + l.codigo) + '">lançar</button>' +
                  (x && x.antes ? '<br><small>mês passado ' + porUn(x.antes) + '</small>' : '') + '</td>';
                return '<td class="num' + (l.maisBarato === k.id ? ' cc-menor' : '') + '"><button type="button" class="link" data-acao="cc-preco" data-id="' + esc(k.id + '|' + l.codigo) + '" title="Corrigir">' + porUn(x.porUnidade) + '</button>' +
                  (x.link ? ' <a href="' + esc(x.link) + '" target="_blank" rel="noopener" title="Ver no site">↗</a>' : '') + '<br>' + selo(x.dif) +
                  (x.variacao != null && Math.abs(x.variacao) >= 1 ? '<br><small>' + esc(pct(x.variacao)) + ' sobre o mês passado</small>' : '') + '</td>'; }).join('') + '</tr>').join('') +
            '</tbody></table></div><p class="dica">Por unidade de comparação: o preço dividido pelo que vem na embalagem (ex.: fardo de 8 rolos de 300 m = 2.400 metros). ' +
            'O nosso preço é o de tabela do FKN dividido pelo fator. Verde = o concorrente está mais caro; vermelho = mais barato (vale olhar a margem desse item).</p></section>');
    },
    depois() {
      const s = document.getElementById('ccMes');
      if (s) s.addEventListener('change', () => { mes = s.value; dados = null; CRM.render(); });
    }
  };

  const recarrega = () => { dados = null; CRM.render(); };
  function formPreco(id) {
    const [cid, cod] = String(id).split('|');
    const k = dados.concorrentes.find(x => String(x.id) === cid), l = comparar(Object.assign({ mes }, dados)).linhas.find(x => x.codigo === cod);
    const p = dados.precos.find(x => String(x.mes).slice(0, 10) === mes && String(x.concorrente_id) === cid && codigo(x.codigo) === cod) || {};
    if (!k || !l) return;
    CRM.abrirForm({ titulo: k.nome + ' · ' + R.nomeDeItem(l.descricao), intro: nomeMes(mes) + '. Lance o preço da embalagem que o concorrente vende e quanto vem nela, em ' + l.unidade_comp + ' (a unidade de comparação deste produto).',
      campos: [{ nome: 'preco', rotulo: 'Preço da embalagem (R$)', tipo: 'numero', obrigatorio: true, min: 0.01 },
        { nome: 'quantidade', rotulo: 'Quanto vem na embalagem (' + l.unidade_comp + ')', tipo: 'numero', obrigatorio: true, min: 0.0001 },
        { nome: 'descricao', rotulo: 'Como ele chama o produto', largo: true }, { nome: 'link', rotulo: 'Link da página', largo: true },
        { nome: 'obs', rotulo: 'Observação', dica: 'ex.: frete grátis acima de R$ 60; preço no Pix', largo: true }],
      valores: Object.assign({ quantidade: l.fator }, p),
      aoSalvar: async v => {
        await CRM.store().salvarPrecoConcorrente({ mes, concorrente_id: +cid, codigo: cod, preco: v.preco, quantidade: v.quantidade, descricao: v.descricao || null, link: v.link || null, obs: v.obs || null });
        CRM.toast('Preço lançado.'); recarrega();
      } });
  }
  function formCesta(cod, novo) {
    const it = novo ? {} : (dados.cesta.find(x => codigo(x.codigo) === cod) || {});
    const est = new Map(dados.estoque.map(x => [codigo(x.codigo), x]));
    const opcoes = novo ? dados.estoque.filter(x => !/\.\d+$/.test(x.codigo) && x.situacao !== 'INATIVO' && !dados.cesta.some(c => c.ativo !== false && codigo(c.codigo) === codigo(x.codigo)))
      .sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR')).map(x => [codigo(x.codigo), x.descricao + ' (' + codigo(x.codigo) + ')']) : null;
    const e = est.get(cod) || {};
    CRM.abrirForm({ titulo: novo ? 'Produto na cesta' : 'Cesta · ' + R.nomeDeItem(e.descricao || cod),
      intro: 'A unidade de comparação deixa embalagens diferentes comparáveis: rolão por metro, interfolha por folha, químico por litro. O fator é quantas dessas há na NOSSA unidade' + (e.unidade ? ' (' + e.unidade + ')' : '') + '.',
      campos: (novo ? [{ nome: 'codigo', rotulo: 'Produto', tipo: 'select', obrigatorio: true, largo: true, alfa: true, opcoes: [['', '—']].concat(opcoes) }] : []).concat([
        { nome: 'unidade_comp', rotulo: 'Unidade de comparação', obrigatorio: true, dica: 'ex.: metro, folha, litro, unidade' },
        { nome: 'fator', rotulo: 'Quantas há na nossa unidade', tipo: 'numero', obrigatorio: true, min: 0.0001 },
        { nome: 'ordem', rotulo: 'Ordem na lista', tipo: 'numero', min: 0 }]).concat(novo ? [] : [{ nome: 'ativo', rotulo: 'Na cesta (desmarque para tirar)', tipo: 'checkbox' }]),
      valores: Object.assign({ unidade_comp: 'unidade', fator: 1, ordem: (dados.cesta.length || 0) + 1, ativo: true }, it),
      aoSalvar: async v => {
        await CRM.store().salvarCesta({ codigo: novo ? v.codigo : cod, unidade_comp: String(v.unidade_comp).trim(), fator: v.fator, ordem: Math.round(v.ordem || 0), ativo: novo ? true : !!v.ativo });
        CRM.toast(novo ? 'Produto na cesta.' : 'Cesta atualizada.'); recarrega();
      } });
  }
  function formConcorrente() {
    const l = dados.concorrentes.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    CRM.abrirForm({ titulo: 'Concorrentes acompanhados', intro: 'Para tirar um da comparação, desmarque "acompanhar". Um novo entra na última linha.',
      campos: l.flatMap(k => [{ nome: 'secao_' + k.id, tipo: 'secao', rotulo: k.nome },
        { nome: 'nome_' + k.id, rotulo: 'Nome', obrigatorio: true }, { nome: 'site_' + k.id, rotulo: 'Site' },
        { nome: 'obs_' + k.id, rotulo: 'Observação', largo: true }, { nome: 'ativo_' + k.id, rotulo: 'acompanhar', tipo: 'checkbox' }])
        .concat([{ nome: 'secao_novo', tipo: 'secao', rotulo: 'Novo concorrente' }, { nome: 'nome_novo', rotulo: 'Nome' }, { nome: 'site_novo', rotulo: 'Site' }]),
      valores: Object.assign({}, ...l.map(k => ({ ['nome_' + k.id]: k.nome, ['site_' + k.id]: k.site || '', ['obs_' + k.id]: k.obs || '', ['ativo_' + k.id]: k.ativo !== false }))),
      aoSalvar: async v => {
        const st = CRM.store();
        for (const k of l) await st.salvarConcorrente({ id: k.id, nome: String(v['nome_' + k.id]).trim(), site: v['site_' + k.id] || null, obs: v['obs_' + k.id] || null, ativo: !!v['ativo_' + k.id], ordem: k.ordem });
        if (String(v.nome_novo || '').trim()) await st.salvarConcorrente({ nome: String(v.nome_novo).trim(), site: v.site_novo || null, ordem: l.length + 1 });
        CRM.toast('Concorrentes salvos.'); recarrega();
      } });
  }

  Object.assign(CRM.acoes, {
    'cc-preco': id => formPreco(id),
    'cc-cesta': cod => formCesta(cod, false),
    'cc-cesta-add': () => formCesta(null, true),
    'cc-concorrente': () => formConcorrente(),
    'cc-sugerir': async () => {
      const G = raiz.CRMGestao;
      const c = G.compras(E().D, E().ix, E().cfg, CRM.hoje(), 30, dados.estoque);
      const l = sugerirCesta(c.produtos, 20);
      if (!l.length) { CRM.toast('Sem produtos da curva A com preço de tabela no estoque do FKN.', true); return; }
      if (!confirm('Colocar na cesta os ' + l.length + ' produtos mais vendidos da curva A? A unidade de comparação começa igual à nossa unidade; ajuste no ✎ os que tiverem embalagem diferente (rolão por metro, interfolha por folha).')) return;
      const st = CRM.store();
      for (const it of l) await st.salvarCesta(Object.assign({ ativo: true }, it));
      CRM.toast(l.length + ' produtos na cesta.'); recarrega();
    },
    'cc-exportar': () => {
      const conc = dados.concorrentes.filter(c => c.ativo !== false).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      const c = comparar(Object.assign({ mes }, dados));
      CRM.baixarCSV('concorrentes-' + mes.slice(0, 7), ['Código', 'Produto', 'Unidade de comparação', 'Nosso preço por unidade'].concat(...conc.map(k => [k.nome + ' por unidade', k.nome + ' diferença %'])),
        c.linhas.map(l => [l.codigo, l.descricao, l.unidade_comp, l.nosso == null ? '' : +l.nosso.toFixed(4)].concat(...conc.map(k => { const x = l.conc[k.id];
          return x && x.porUnidade != null ? [+x.porUnidade.toFixed(4), x.dif == null ? '' : Math.round(x.dif * 10) / 10] : ['', '']; }))));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
