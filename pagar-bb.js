/* CRM Sistemi Dalessi — Caixa → Pagar no BB (04/11/2026). Pedido do Anderson: "deixar lançado e aí você vai pagando. Olha lá,
   hoje o saldo é esse, tem isso de título. Ok? Aí eu dou um ok pelo celular". As contas a pagar do dia (e as vencidas) com o
   saldo antes e depois; cada conta diz como paga (boleto ou guia pelo código de barras colado, Pix pela chave do favorecido);
   "Enviar ao BB" manda os lotes pela API Pagamentos em Lote (crm-bb-pagar), o banco confere e o lote espera a LIBERAÇÃO
   ("Liberar" aqui ou no app do BB); o agendador lê a situação a cada 10 minutos e o que o banco pagou é baixado no Caixa.
   Na HOMOLOGAÇÃO (crm_config.dados.pagamentos.ambiente = 'hm') tudo vai para a conta de teste do BB e nada é baixado.
   Só o administrador. Leitura do código: pagamentos.js; lote e situação: supabase/functions/crm-bb-pagar/lote.js. */
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, R = raiz.CRMRegras, P = raiz.CRMPagamentos;
  if (!CRM || !CRM.telas) return;
  const esc = CRM.esc;
  const r2 = v => Math.round(Number(v || 0) * 100) / 100;
  const dm = d => (d ? R.dataBR(String(d).slice(0, 10)).slice(0, 5) : '—');
  let D = null, carregando = false, lidoEm = 0, ctx = null, enviando = false;
  const marcados = new Set();
  const f = { ate: null, data: null };
  const ROT = { enviado: 'enviado ao banco', consistente: 'conferido, falta liberar', inconsistente: 'com erro', pendente: 'esperando a liberação', agendado: 'agendado',
    pago: 'pago', rejeitado: 'recusado', devolvido: 'devolvido', cancelado: 'cancelado', debitado: 'debitado', bloqueado: 'bloqueado', aguardando: 'esperando saldo' };
  const COR = { pago: 'verde', debitado: 'verde', agendado: 'azul', consistente: 'ambar', pendente: 'ambar', aguardando: 'ambar', enviado: 'cinza',
    inconsistente: 'vermelho', rejeitado: 'vermelho', devolvido: 'vermelho', cancelado: 'cinza', bloqueado: 'vermelho' };
  const selo = (t, cor) => '<span class="selo ' + (cor || '') + '">' + esc(t) + '</span>';
  const ambiente = () => ((((CRM.estado && CRM.estado.cfg) || {}).pagamentos) || {}).ambiente === 'prod' ? 'prod' : 'hm';
  const docOk = d => /^(\d{11}|\d{14})$/.test(String(d || ''));
  const docTxt = d => { const s = String(d || ''); return s.length === 14 ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : s.length === 11 ? s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : s; };

  async function carrega(forca) {
    if (carregando || (!forca && D && Date.now() - lidoEm < 60000)) return;
    carregando = true;
    try { D = CRM.store().pagLer ? await CRM.store().pagLer() : { lotes: [], itens: [], favorecidos: [] }; lidoEm = Date.now(); }
    catch (e) { D = D || { lotes: [], itens: [], favorecidos: [] }; CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }
  const fav = id => (D && D.favorecidos || []).find(x => x.id === id) || null;
  const favPorNome = nome => { const n = String(nome || '').trim().toLowerCase(); return n ? (D && D.favorecidos || []).find(x => x.ativo !== false && x.nome.trim().toLowerCase() === n) || null : null; };
  // o pagamento vivo da conta (o último envio que não foi recusado, devolvido nem cancelado)
  const vivoDa = (id, amb) => (D && D.itens || []).filter(x => x.lancamento_id === id && x.ativo && x.ambiente === amb).sort((a, b) => b.id - a.id)[0] || null;

  // o que falta para a conta ir ao banco (o mesmo critério da função: lote.js, pronto)
  function falta(l) {
    if (l.pag_forma === 'boleto' || l.pag_forma === 'guia') {
      if (!/^\d{44}$/.test(String(l.pag_codigo || ''))) return 'falta o código de barras';
      if (l.pag_forma === 'boleto' && !docOk(l.pag_doc)) return 'falta o CNPJ do beneficiário';
      return null;
    }
    if (l.pag_forma === 'pix') { const v = fav(l.pag_favorecido_id); return !v ? 'falta o favorecido do Pix' : !v.pix_tipo ? 'favorecido sem chave Pix' : null; }
    return 'falta dizer como pagar';
  }
  function comoPaga(l) {
    if (l.pag_forma === 'boleto') return 'Boleto' + (l.pag_codigo ? ' · ' + R.moeda(P.valorDoCodigo(l.pag_codigo) || l.valor) : '');
    if (l.pag_forma === 'guia') return 'Guia / conta de consumo';
    if (l.pag_forma === 'pix') { const v = fav(l.pag_favorecido_id); return 'Pix' + (v ? ' · ' + v.nome : ''); }
    return '';
  }

  function aba(c) {
    ctx = c;
    if (!CRM.ehAdmin()) return '<div class="cartao"><p class="vazio">Só o administrador.</p></div>';
    if (!D) { setTimeout(carrega, 0); return '<div class="cartao"><p class="vazio">Carregando os pagamentos…</p></div>'; }
    if (Date.now() - lidoEm > 60000) setTimeout(carrega, 0);
    const hoje = c.hoje, amb = ambiente();
    const ate = f.ate || hoje, data = f.data && f.data > hoje ? f.data : hoje;
    const contas = c.lancamentos.filter(l => l.tipo === 'saida' && l.situacao === 'aberto' && String(l.vencimento) <= ate)
      .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)) || String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
    [...marcados].forEach(id => { if (!contas.some(l => l.id === id)) marcados.delete(id); });
    const sel = contas.filter(l => marcados.has(l.id));
    const totSel = r2(sel.reduce((t, l) => t + Number(l.valor), 0)), totDia = r2(contas.reduce((t, l) => t + Number(l.valor), 0));
    const depois = c.saldo == null ? null : r2(c.saldo - totSel);
    const prontas = contas.filter(l => !falta(l) && !vivoDa(l.id, amb));
    const aviso = amb === 'hm'
      ? '<p class="alerta">🧪 <strong>Homologação do BB:</strong> o envio vai para a conta de teste do banco, nada é pago de verdade e nenhuma conta é baixada no Caixa. A produção liga quando sair o convênio PAG.</p>'
      : '';
    const linhas = contas.map(l => {
      const v = vivoDa(l.id, amb), ft = falta(l), venc = String(l.vencimento) < hoje;
      return '<tr' + (v ? ' class="apagado"' : '') + '><td><input type="checkbox" data-pag-marca="' + esc(l.id) + '"' + (marcados.has(l.id) ? ' checked' : '') + (v || ft ? ' disabled' : '') + ' aria-label="Marcar"></td>' +
        '<td class="num">' + esc(dm(l.vencimento)) + (venc ? ' ' + selo('vencida', 'vermelho') : '') + '</td>' +
        '<td><strong>' + esc(l.descricao) + '</strong>' + (l.fornecedor ? '<small>' + esc(l.fornecedor) + '</small>' : '') + '</td>' +
        '<td class="num">' + esc(R.moeda(l.valor)) + '</td>' +
        '<td>' + (ft ? selo(ft, 'ambar') : esc(comoPaga(l))) + '</td>' +
        '<td>' + (v ? selo(ROT[v.estado] || v.estado, COR[v.estado]) + (v.aceito === false && (v.erros || []).length ? '<small>' + esc(v.erros.join(', ')) + '</small>' : '') : '') + '</td>' +
        '<td class="acoes-linha"><button type="button" class="btn sec mini" data-acao="pag-dados" data-id="' + esc(l.id) + '">' + (ft ? 'Dados do pagamento' : 'Mudar') + '</button></td></tr>';
    }).join('');
    return '<section class="cartao">' + aviso +
      '<div class="pag-topo"><div><span>Saldo agora</span><strong class="' + (c.saldo < 0 ? 'cx-neg' : '') + '">' + (c.saldo == null ? '—' : esc(R.moeda(c.saldo))) + '</strong></div>' +
        '<div><span>Contas até ' + esc(dm(ate)) + '</span><strong>' + contas.length + ' · ' + esc(R.moeda(totDia)) + '</strong></div>' +
        '<div><span>Marcadas</span><strong>' + sel.length + ' · ' + esc(R.moeda(totSel)) + '</strong></div>' +
        '<div><span>Saldo depois</span><strong class="' + (depois != null && depois < 0 ? 'cx-neg' : '') + '">' + (depois == null ? '—' : esc(R.moeda(depois))) + '</strong></div></div>' +
      '<div class="filtros-compras"><label>Contas que vencem até <input type="date" id="pagAte" value="' + esc(ate) + '"></label>' +
        '<label>Pagar em <input type="date" id="pagData" value="' + esc(data) + '" min="' + esc(hoje) + '"></label>' +
        '<button type="button" class="btn sec" data-acao="pag-marcar-prontas">Marcar as prontas (' + prontas.length + ')</button>' +
        '<button type="button" class="btn" data-acao="pag-enviar"' + (sel.length && !enviando ? '' : ' disabled') + '>' + (enviando ? 'Enviando…' : 'Enviar ao BB (' + sel.length + ')') + '</button>' +
        '<button type="button" class="btn sec" data-acao="pag-ciclo">Atualizar situação</button>' +
        (amb === 'hm' ? '<button type="button" class="btn sec" data-acao="pag-teste">Testar com o BB</button>' : '') + '</div>' +
      '<small>O banco confere cada pagamento ao receber o lote; nada sai da conta até a liberação ("Liberar" abaixo, ou no app do BB). Saindo o pagamento, a conta é baixada no Caixa sozinha.</small>' +
      (contas.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th></th><th class="num">Vence</th><th>Conta</th><th class="num">Valor</th><th>Como pagar</th><th>No banco</th><th></th></tr></thead><tbody>' + linhas + '</tbody></table></div>'
        : '<p class="vazio">Nenhuma conta a pagar até ' + esc(R.dataBR(ate)) + '.</p>') + '</section>' + lotes(amb);
  }

  function lotes(amb) {
    const ls = (D.lotes || []).slice(0, 15);
    if (!ls.length) return '';
    return '<section class="cartao"><h3>Envios ao banco</h3><div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Lote</th><th>Forma</th><th>Pagar em</th><th class="num">Valor</th><th>Pagamentos</th><th></th></tr></thead><tbody>' +
      ls.map(lt => {
        const its = (D.itens || []).filter(x => x.lote_id === lt.id);
        const vivos = its.filter(x => x.ativo), podeLiberar = !lt.liberado_em && !lt.erro && vivos.length && vivos.some(x => ['consistente', 'pendente', 'enviado'].includes(x.estado));
        return '<tr><td>' + esc(String(lt.numero_requisicao)) + (lt.ambiente === 'hm' ? ' ' + selo('teste', 'cinza') : '') + '<small>' + esc(R.dataBR(String(lt.enviado_em).slice(0, 10))) + '</small></td>' +
          '<td>' + esc({ boleto: 'Boletos', guia: 'Guias', pix: 'Pix' }[lt.forma] || lt.forma) + '</td><td>' + esc(dm(lt.data_pagamento)) + '</td><td class="num">' + esc(R.moeda(lt.valor)) + '</td>' +
          '<td>' + (lt.erro ? selo(lt.erro, 'vermelho') : its.map(x => '<div>' + esc(x.descricao || x.favorecido || '') + ' · ' + esc(R.moeda(x.valor)) + ' ' + selo(ROT[x.estado] || x.estado, COR[x.estado]) +
            (x.ativo && !['pago', 'debitado'].includes(x.estado) && x.identificador_bb ? ' <button type="button" class="btn sec mini" data-acao="pag-cancelar" data-id="' + x.id + '">Cancelar</button>' : '') + '</div>').join('')) +
            (lt.liberado_em ? '<small>liberado ' + esc(dm(lt.liberado_em)) + ' ' + esc(String(lt.liberado_em).slice(11, 16)) + (lt.liberado_via === 'celular' ? ' pelo celular' : '') + '</small>' : '') + '</td>' +
          '<td class="acoes-linha">' + (podeLiberar ? '<button type="button" class="btn" data-acao="pag-liberar" data-id="' + lt.id + '">Liberar ' + esc(R.moeda(vivos.reduce((t, x) => t + Number(x.valor), 0))) + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  function depoisAba(el) {
    const a = el.querySelector('#pagAte'), d = el.querySelector('#pagData');
    if (a) a.addEventListener('change', () => { f.ate = a.value || null; CRM.render(); });
    if (d) d.addEventListener('change', () => { f.data = d.value || null; CRM.render(); });
    el.querySelectorAll('[data-pag-marca]').forEach(x => x.addEventListener('change', () => { if (x.checked) marcados.add(x.dataset.pagMarca); else marcados.delete(x.dataset.pagMarca); CRM.render(); }));
  }

  // dados do pagamento da conta: o código colado (boleto ou guia) e o CNPJ do beneficiário, ou o favorecido do Pix
  function formDados(id) {
    const l = ctx && ctx.lancamentos.find(x => x.id === id);
    if (!l) return;
    const sug = favPorNome(l.fornecedor);
    const favs = (D.favorecidos || []).filter(x => x.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    CRM.abrirForm({
      titulo: 'Como pagar: ' + l.descricao,
      intro: R.moeda(l.valor) + ' · vence ' + R.dataBR(l.vencimento) + (l.fornecedor ? ' · ' + l.fornecedor : '') +
        '\nBoleto ou conta de consumo: cole a linha digitável (ou o código de barras). O CRM confere os números.\nPix: escolha o favorecido (ou cadastre um novo).',
      largura: 'largo',
      campos: [
        { nome: 'pag_forma', rotulo: 'Forma', tipo: 'select', opcoes: [['', '—'], ['boleto', 'Boleto'], ['guia', 'Guia / conta de consumo (água, luz, imposto)'], ['pix', 'Pix']] },
        { nome: 'codigo', rotulo: 'Linha digitável ou código de barras', largo: true, dica: 'cole com ou sem pontos e espaços' },
        { nome: 'pag_doc', rotulo: 'CNPJ (ou CPF) do beneficiário do boleto', dica: 'o banco só paga se for o mesmo do boleto' },
        { nome: 'pag_favorecido_id', rotulo: 'Favorecido do Pix', tipo: 'select', opcoes: [['', '—']].concat(favs.map(x => [x.id, x.nome + (x.pix_tipo ? '' : ' (sem chave)')])).concat([['novo', '+ cadastrar um favorecido novo']]) }
      ],
      valores: { pag_forma: l.pag_forma || '', codigo: l.pag_codigo || '', pag_doc: docTxt(l.pag_doc || (sug && sug.doc) || ''), pag_favorecido_id: l.pag_favorecido_id || (sug ? sug.id : '') },
      salvarTexto: 'Salvar',
      aoSalvar: async v => {
        const patch = { pag_forma: v.pag_forma || null, pag_codigo: null, pag_doc: null, pag_favorecido_id: null };
        if (v.pag_forma === 'boleto' || v.pag_forma === 'guia' || (!v.pag_forma && v.codigo)) {
          const r = P.codigoDeLinha(v.codigo);
          if (!r.ok) throw new Error(r.erro);
          patch.pag_forma = r.tipo; patch.pag_codigo = r.codigo;
          if (r.tipo === 'boleto') {
            const d = String(v.pag_doc || '').replace(/\D/g, '');
            if (!docOk(d)) throw new Error('Informe o CNPJ (14 números) ou o CPF (11) do beneficiário do boleto.');
            patch.pag_doc = d;
          }
          if (r.valor && Math.abs(r.valor - Number(l.valor)) > 0.009) CRM.toast('Atenção: o boleto é de ' + R.moeda(r.valor) + ' e a conta é de ' + R.moeda(l.valor) + '. Vai o valor da conta (juros entram como mora; a menos, como desconto).');
        } else if (v.pag_forma === 'pix') {
          if (v.pag_favorecido_id === 'novo') { await ctx.grava(l.id, { pag_forma: 'pix' }); setTimeout(() => formFavorecido(null, l), 0); return; }
          if (!v.pag_favorecido_id) throw new Error('Escolha o favorecido do Pix.');
          patch.pag_favorecido_id = v.pag_favorecido_id;
        }
        await ctx.grava(l.id, patch);
        CRM.toast('Dados do pagamento salvos.');
      }
    });
  }
  function formFavorecido(fv, l) {
    CRM.abrirForm({
      titulo: fv ? 'Favorecido: ' + fv.nome : 'Favorecido novo (Pix)',
      intro: 'Pix pela chave (telefone, e-mail, CPF/CNPJ ou aleatória) ou pelos dados bancários. O banco não confere de quem é a chave: confira antes.',
      largura: 'largo',
      campos: [
        { nome: 'nome', rotulo: 'Nome', obrigatorio: true, largo: true },
        { nome: 'doc', rotulo: 'CNPJ ou CPF' },
        { nome: 'pix_tipo', rotulo: 'Pagar por', tipo: 'select', obrigatorio: true, opcoes: [['email', 'Chave Pix: e-mail'], ['telefone', 'Chave Pix: telefone'], ['documento', 'Chave Pix: o CNPJ/CPF acima'], ['aleatoria', 'Chave Pix: aleatória'], ['conta', 'Dados bancários']] },
        { nome: 'pix_chave', rotulo: 'Chave Pix', largo: true },
        { nome: 'compe', rotulo: 'Banco (número, ex.: 341)', tipo: 'numero', passo: '1', vazioNulo: true },
        { nome: 'agencia', rotulo: 'Agência (sem dígito)', tipo: 'numero', passo: '1', vazioNulo: true },
        { nome: 'conta', rotulo: 'Conta (sem dígito)' },
        { nome: 'conta_dv', rotulo: 'Dígito da conta' },
        { nome: 'tipo_conta', rotulo: 'Tipo de conta', tipo: 'select', opcoes: [['', '—'], ['1', 'Corrente'], ['2', 'Pagamento'], ['3', 'Poupança']] }
      ],
      valores: fv || { nome: (l && l.fornecedor) || '', pix_tipo: 'email' },
      aoSalvar: async v => {
        const d = { nome: String(v.nome).trim(), doc: String(v.doc || '').replace(/\D/g, '') || null, pix_tipo: v.pix_tipo, pix_chave: String(v.pix_chave || '').trim() || null,
          compe: v.compe || null, agencia: v.agencia || null, conta: String(v.conta || '').replace(/\D/g, '') || null, conta_dv: String(v.conta_dv || '').trim().toUpperCase() || null,
          tipo_conta: v.tipo_conta ? Number(v.tipo_conta) : null };
        if (d.doc && !docOk(d.doc)) throw new Error('CNPJ com 14 números ou CPF com 11.');
        if (d.pix_tipo === 'documento' && !d.doc) throw new Error('Informe o CNPJ ou CPF (é a chave).');
        if (['email', 'telefone', 'aleatoria'].includes(d.pix_tipo) && !d.pix_chave) throw new Error('Informe a chave Pix.');
        if (d.pix_tipo === 'telefone' && String(d.pix_chave).replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').length !== 11) throw new Error('Telefone com DDD e 9 dígitos.');
        if (d.pix_tipo === 'conta' && !(d.compe && d.agencia && d.conta && d.conta_dv && d.tipo_conta && d.doc)) throw new Error('Dados bancários: banco, agência, conta, dígito, tipo e o CNPJ/CPF.');
        const r = await CRM.store().favorecidoGravar(fv ? Object.assign({ id: fv.id }, d) : d);
        await carrega(true);
        if (l) await ctx.grava(l.id, { pag_forma: 'pix', pag_favorecido_id: r.id });
        CRM.toast('Favorecido salvo.');
      }
    });
  }

  async function chama(corpo, msg) {
    try { const r = await CRM.store().pagChamar(corpo); await carrega(true); return r; }
    catch (e) { CRM.falhou(e); return null; }
  }
  const resumoEnvio = r => {
    const ok = (r.lotes || []).filter(x => !x.erro), ruins = (r.lotes || []).filter(x => x.erro);
    const rec = [].concat(...ok.map(x => x.recusados || []));
    return [ok.length ? ok.length + ' lote(s) no banco (' + R.moeda(ok.reduce((t, x) => t + Number(x.valor || 0), 0)) + '): agora é só liberar' : '',
      rec.length ? rec.length + ' recusado(s) pelo banco: ' + rec.map(x => x.descricao + ' (' + x.erros.join(', ') + ')').join('; ') : '',
      ruins.length ? ruins.map(x => x.erro).join('; ') : '',
      (r.pulados || []).length ? (r.pulados.length + ' ficou(aram) de fora: ' + r.pulados.map(x => x.descricao + ' — ' + x.motivo).join('; ')) : ''].filter(Boolean).join('\n');
  };

  Object.assign(CRM.acoes, {
    'pag-dados': id => formDados(id),
    'pag-marcar-prontas': () => { const amb = ambiente(), hoje = ctx.hoje, ate = f.ate || hoje;
      ctx.lancamentos.filter(l => l.tipo === 'saida' && l.situacao === 'aberto' && String(l.vencimento) <= ate && !falta(l) && !vivoDa(l.id, amb)).forEach(l => marcados.add(l.id)); CRM.render(); },
    'pag-enviar': async () => {
      if (enviando || !marcados.size) return;
      const sel = ctx.lancamentos.filter(l => marcados.has(l.id)), tot = r2(sel.reduce((t, l) => t + Number(l.valor), 0));
      const data = f.data && f.data > ctx.hoje ? f.data : ctx.hoje;
      if (!confirm('Enviar ao Banco do Brasil ' + sel.length + ' pagamento(s), ' + R.moeda(tot) + ', para ' + R.dataBR(data) + '?\n\n' +
        (ambiente() === 'hm' ? 'HOMOLOGAÇÃO: vai para a conta de teste do banco.' : 'O banco confere e o lote espera a liberação: nada sai da conta antes dela.'))) return;
      enviando = true; CRM.render();
      const r = await chama({ acao: 'enviar', ids: sel.map(l => l.id), data });
      enviando = false;
      if (r) { marcados.clear(); alert(resumoEnvio(r) || 'Nada foi enviado.'); }
      CRM.render();
    },
    'pag-liberar': async id => {
      const lt = (D.lotes || []).find(x => x.id === Number(id));
      if (!lt || !confirm('Liberar o lote ' + lt.numero_requisicao + ' (' + R.moeda(lt.valor) + ', ' + R.dataBR(lt.data_pagamento) + ')?\n\nO banco paga no dia, se houver saldo até o horário-limite.')) return;
      const r = await chama({ acao: 'liberar', lote: lt.id });
      if (r) CRM.toast(r.mensagem || 'Lote liberado.');
    },
    'pag-cancelar': async id => {
      if (!confirm('Cancelar este pagamento no banco? (só dá antes de ele ser pago)')) return;
      const r = await chama({ acao: 'cancelar', item: Number(id) });
      if (r) CRM.toast('Pagamento cancelado.');
    },
    'pag-ciclo': async () => { const r = await chama({ acao: 'ciclo' }); if (r) CRM.toast(r.lidos + ' pagamento(s) lido(s) no banco' + (r.baixados ? ', ' + r.baixados + ' baixado(s) no Caixa' : '') + (r.erros && r.erros.length ? ' · ' + r.erros.length + ' com erro' : '') + '.'); },
    'pag-teste': async () => { const r = await chama({ acao: 'teste_hm' }); if (r) alert('Teste na homologação do BB:\n' + (resumoEnvio(r) || 'nada enviado')); }
  });
  CRM.pagarbb = { aba, depoisAba, contagem: () => 0, carrega };
})(typeof window !== 'undefined' ? window : globalThis);
