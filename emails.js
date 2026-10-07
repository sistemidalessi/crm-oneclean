/* CRM Sistemi Dalessi — E-mails: cadência de relacionamento e reposição (07/10/2026, ideia da líder de
   vendas). Clientes que só tratam por e-mail entram na cadência (quinzenal ou mensal, na ficha). Todo
   dia o CRM monta a FILA (cadencia.js, filaCadencia): o lembrete de reposição no ritmo de compra do
   cliente e, no intervalo da cadência, a campanha que a líder escreveu. A vendedora (ou a líder)
   confere, mexe no texto se quiser e aprova; quem envia é a Edge Function crm-email (Brevo), em nome
   da vendedora da carteira. Por enquanto nada sai sem aprovação. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras;
  const C = raiz.CRMCadencia;
  const CRM = raiz.CRM;
  if (!CRM || !CRM.telas) return;
  const E = () => CRM.estado;
  const esc = CRM.esc;
  const $ = (s, el) => (el || document).querySelector(s);
  const TIPO = { reposicao: ['Reposição', 'verde'], relacionamento: ['Relacionamento', 'azul'] };
  const VARIAVEIS = '{saudacao} {primeiro_nome} {contato} {empresa} {vendedor} {vendedor_primeiro_nome} {minha_empresa} {itens}';

  let situacao = null, lendoSituacao = false, enviando = false, filtroVend = '';
  const rascunho = new Map(); // chave da fila → { assunto, corpo, para }
  const chave = p => p.empresa_id + ':' + p.tipo + ':' + (p.campanha_id || '');

  function lerSituacao() {
    if (lendoSituacao || situacao) return;
    lendoSituacao = true;
    CRM.store().email({ acao: 'situacao' }).then(r => { situacao = r || { ligado: false }; }).catch(() => { situacao = { ligado: false, erro: true }; })
      .finally(() => { lendoSituacao = false; CRM.render(); });
  }

  function atrasos() {
    return new Set((E().D.empresas || []).filter(e => { const f = CRM.financeiro && CRM.financeiro(e.id); return f && f.vencido > 0; }).map(e => e.id));
  }
  function fila() {
    const D = E().D, cfg = E().cfg;
    const f = C.filaCadencia(D, E().ix, cfg, CRM.hoje(), { atraso: atrasos(), nomeUsuario: id => (CRM.usuario(id) || {}).nome || '', eu: (E().eu || {}).nome || '', minhaEmpresa: CRM.nomeInstalacao() });
    const meu = l => (filtroVend ? l.filter(x => (CRM.empresa(x.empresa_id) || {}).responsavel_id === filtroVend) : l);
    return { prontos: meu(f.prontos), segurados: meu(f.segurados), semCampanha: f.semCampanha };
  }
  // logo e cor da instalação, para o e-mail ficar com a cara da empresa
  function marca() {
    const c = window.CRM_CONFIG || {};
    return { nome: CRM.nomeInstalacao(), cor: (c.cores && c.cores.principal) || '', logo: c.logo ? new URL(c.logo, location.href).href : '' };
  }
  const sairUrl = () => new URL('sair.html', location.href).href;

  async function envia(p) {
    const r = rascunho.get(chave(p)) || {};
    const assunto = (r.assunto != null ? r.assunto : p.assunto).trim(), corpo = (r.corpo != null ? r.corpo : p.corpo).trim();
    const para = r.para || p.para;
    if (!para.length) throw new Error('marque pelo menos um e-mail');
    const res = await CRM.store().email({ acao: 'enviar', empresa_id: p.empresa_id, tipo: p.tipo, campanha_id: p.campanha_id, assunto, corpo, para, sair_url: sairUrl(), marca: marca() });
    rascunho.delete(chave(p));
    return res;
  }

  function cartao(p, i) {
    const e = CRM.empresa(p.empresa_id) || {}, r = rascunho.get(chave(p)) || {};
    const para = r.para || p.para;
    const t = TIPO[p.tipo];
    return '<article class="cartao em-item" data-i="' + i + '"><header class="em-topo"><button type="button" class="linha" data-acao="abrir-empresa" data-id="' + esc(e.id) + '"><strong>' + esc(e.nome) + '</strong>' +
      '<small>' + esc(p.motivo) + (CRM.carteira() ? '' : ' · ' + esc(R.primeiroNome(CRM.nomeUsuario(e.responsavel_id)))) + '</small></button>' + CRM.selo(t[0], t[1]) + '</header>' +
      '<div class="em-para">' + p.para.map(m => '<label class="check"><input type="checkbox" data-em-para="' + i + '" value="' + esc(m) + '"' + (para.indexOf(m) !== -1 ? ' checked' : '') + '> ' + esc(m) + '</label>').join('') + '</div>' +
      '<label class="campo largo"><span>Assunto</span><input type="text" data-em-assunto="' + i + '" value="' + esc(r.assunto != null ? r.assunto : p.assunto) + '"></label>' +
      '<label class="campo largo"><span>Texto</span><textarea rows="8" data-em-corpo="' + i + '">' + esc(r.corpo != null ? r.corpo : p.corpo) + '</textarea></label>' +
      '<p class="acoes"><button type="button" class="btn" data-acao="em-enviar" data-id="' + i + '"' + (enviando ? ' disabled' : '') + '>Enviar</button>' +
      '<button type="button" class="btn sec" data-acao="em-pular" data-id="' + i + '">Pular desta vez</button>' +
      '<button type="button" class="btn sec" data-acao="em-tirar" data-id="' + esc(e.id) + '">Tirar da cadência</button></p></article>';
  }

  function blocoCampanhas() {
    const D = E().D, l = (D.email_campanhas || []).slice().sort((a, b) => (String(a.desde) < String(b.desde) ? 1 : -1));
    const quantos = id => (D.email_envios || []).filter(x => x.campanha_id === id && x.situacao === 'enviado').length;
    return '<section class="cartao"><h2>Campanhas de relacionamento <small>o texto que a líder escreve; cada cliente recebe cada campanha uma vez, no intervalo da cadência dele</small></h2>' +
      (CRM.ehGestor() ? '<p class="acoes"><button type="button" class="btn" data-acao="em-campanha">+ Campanha</button></p>' : '') +
      (l.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Desde</th><th>Assunto</th><th>Para</th><th class="num">Enviados</th><th></th></tr></thead><tbody>' +
        l.map(c => '<tr' + (CRM.ehGestor() ? ' class="clicavel" data-acao="em-campanha" data-id="' + esc(c.id) + '" tabindex="0"' : '') + '><td>' + esc(R.dataBR(c.desde)) + '</td><td><strong>' + esc(c.assunto) + '</strong><small>' + esc(String(c.corpo).slice(0, 120)) + (String(c.corpo).length > 120 ? '…' : '') + '</small></td>' +
          '<td>' + esc(c.segmento || 'todos os segmentos') + '</td><td class="num">' + quantos(c.id) + '</td><td>' + (c.ativa === false ? CRM.selo('pausada', 'cinza') : CRM.selo('ativa', 'verde')) + '</td></tr>').join('') + '</tbody></table></div>'
        : '<p class="vazio">Nenhuma campanha ainda. ' + (CRM.ehGestor() ? 'Escreva a primeira: novidades, condições do mês, um produto em destaque.' : 'A líder escreve as campanhas.') + '</p>') + '</section>';
  }
  function formCampanha(c) {
    const segs = (E().D.opcoes || []).filter(o => o.tipo === 'segmento').map(o => [o.nome, o.nome]);
    CRM.abrirForm({
      titulo: c ? 'Campanha' : 'Nova campanha', largura: 'larga',
      intro: 'Vai para os clientes da cadência, em nome da vendedora de cada um. Variáveis: ' + VARIAVEIS + ' — {itens} é o que o cliente costuma levar.',
      campos: [{ nome: 'assunto', rotulo: 'Assunto', obrigatorio: true, largo: true, dica: 'Novidades da {minha_empresa} para {empresa}' },
        { nome: 'corpo', rotulo: 'Texto', tipo: 'textarea', linhas: 10, obrigatorio: true, largo: true,
          dica: '{saudacao}\n\nAqui é {vendedor_primeiro_nome}, da {minha_empresa}. Chegaram novidades…\n\nUm abraço,\n{vendedor}' },
        { nome: 'segmento', rotulo: 'Só para o segmento', tipo: 'select', opcoes: [['', 'Todos os segmentos']].concat(segs) },
        { nome: 'desde', rotulo: 'Começa em', tipo: 'data', obrigatorio: true },
        { nome: 'ativa', rotulo: 'Ativa', tipo: 'checkbox' }],
      valores: c ? { assunto: c.assunto, corpo: c.corpo, segmento: c.segmento || '', desde: String(c.desde).slice(0, 10), ativa: c.ativa !== false } : { desde: CRM.hoje(), ativa: true },
      aoSalvar: async v => {
        const dados = { assunto: v.assunto, corpo: v.corpo, segmento: v.segmento || null, desde: v.desde, ativa: !!v.ativa };
        if (c) await CRM.atualizar('email_campanhas', c.id, dados); else await CRM.inserir('email_campanhas', dados);
        CRM.toast('Campanha salva: entra na fila de quem está no intervalo da cadência.');
      },
      aoExcluir: c ? () => CRM.remover('email_campanhas', c.id) : null, textoExcluir: 'Excluir esta campanha? Os e-mails já enviados ficam no histórico.'
    });
  }

  function blocoCadencia() {
    const D = E().D, ix = E().ix, hoje = CRM.hoje();
    const na = (D.empresas || []).filter(e => e.email_cadencia && (!filtroVend || e.responsavel_id === filtroVend));
    const ultimo = id => (D.email_envios || []).filter(x => x.empresa_id === id && x.situacao === 'enviado').reduce((m, x) => (x.criado_em > m ? x.criado_em : m), '');
    const sug = C.sugestoesCadencia(D, ix, hoje, 30).filter(e => !filtroVend || e.responsavel_id === filtroVend);
    const b = (acao, id, rot) => '<button type="button" class="mini" data-acao="' + acao + '" data-id="' + esc(id) + '">' + esc(rot) + '</button>';
    return '<section class="cartao"><details data-chave="em-na-cadencia"><summary><h2>Na cadência: ' + na.length + ' cliente(s) <small>marque na ficha do cliente (E-mails da cadência) ou nas sugestões abaixo</small></h2></summary>' +
      (na.length ? '<ul class="lista">' + na.sort((a, b) => a.nome.localeCompare(b.nome)).map(e => '<li><button type="button" class="linha" data-acao="abrir-empresa" data-id="' + esc(e.id) + '"><strong>' + esc(e.nome) + '</strong>' +
        '<small>' + esc(e.email_cadencia) + ' · ' + (ultimo(e.id) ? 'último e-mail ' + esc(R.dataBR(R.diaLocal(ultimo(e.id)))) : 'ainda não recebeu') + (e.email_sair_em ? ' · ' + CRM.selo('pediu para sair', 'vermelho') : '') + '</small></button></li>').join('') + '</ul>' : '<p class="vazio">Ninguém ainda.</p>') +
      '</details></section>' +
      (sug.length ? '<section class="cartao"><details data-chave="em-sugestoes"><summary><h2>Quem pode entrar: ' + sug.length + ' <small>clientes com e-mail e sem ligação, WhatsApp ou visita há 90 dias — os que mais compraram primeiro</small></h2></summary>' +
        '<ul class="lista">' + sug.map(e => { const r = CRM.resumo(e.id); return '<li><button type="button" class="linha" data-acao="abrir-empresa" data-id="' + esc(e.id) + '"><strong>' + esc(e.nome) + '</strong>' +
          '<small>' + esc(R.moeda(r.totalComprado)) + ' comprados · última compra ' + esc(R.dataBR(r.ultimaCompra)) + (CRM.carteira() ? '' : ' · ' + esc(R.primeiroNome(CRM.nomeUsuario(e.responsavel_id)))) + '</small></button>' +
          '<span class="acoes-rapidas">' + b('em-por', e.id + ':mensal', 'Mensal') + b('em-por', e.id + ':quinzenal', 'Quinzenal') + '</span></li>'; }).join('') + '</ul></details></section>' : '');
  }

  function blocoResultados() {
    const D = E().D, r = C.resultadosCadencia(D, E().ix, CRM.hoje(), 30);
    const ult = (D.email_envios || []).filter(x => x.situacao !== 'pulado').slice().sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1)).slice(0, 15);
    const kpi = (t, v, s) => '<div class="kpi"><span>' + esc(t) + '</span><strong>' + esc(v) + '</strong><small>' + esc(s) + '</small></div>';
    return '<section class="cartao"><h2>Resultado dos últimos 30 dias</h2><div class="kpis">' +
      kpi('Enviados', String(r.enviados), 'e-mails da cadência') + kpi('Abertos', r.enviados ? Math.round(100 * r.abertos / r.enviados) + '%' : '—', r.abertos + ' de ' + r.enviados) +
      kpi('Clicaram', String(r.clicados), 'em algum link') + kpi('Compraram até 15 dias depois', String(r.compraram), R.moeda(r.valor) + ' em notas') + '</div>' +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="em-aberturas">Atualizar aberturas</button></p>' +
      (ult.length ? '<details data-chave="em-ultimos"><summary>Últimos enviados</summary><div class="tabela-rolagem"><table class="tabela"><tbody>' + ult.map(x => '<tr><td>' + esc(R.dataHoraBR(x.criado_em)) + '</td>' +
        '<td><button type="button" class="linha" data-acao="abrir-empresa" data-id="' + esc(x.empresa_id) + '"><strong>' + esc(CRM.nomeEmpresa(x.empresa_id)) + '</strong><small>' + esc(x.assunto || '') + '</small></button></td>' +
        '<td>' + CRM.selo(TIPO[x.tipo][0], TIPO[x.tipo][1]) + '</td><td>' + (x.situacao === 'erro' ? CRM.selo('não saiu', 'vermelho') + '<small>' + esc(x.erro || '') + '</small>' : x.erro ? CRM.selo('devolvido', 'ambar') : x.clicado_em ? CRM.selo('clicou', 'verde') : x.aberto_em ? CRM.selo('abriu', 'verde') : CRM.selo('enviado', 'cinza')) + '</td></tr>').join('') +
        '</tbody></table></div></details>' : '') + '</section>';
  }

  CRM.telas.emails = {
    render() {
      if (CRM.ehComprador()) return '<div class="cartao"><p class="vazio">Esta tela é da equipe de vendas.</p></div>';
      lerSituacao();
      const f = fila();
      const vends = (E().D.usuarios || []).filter(u => u.ativo && u.papel !== 'comprador');
      const aviso = !situacao ? '' : situacao.ligado ? '' :
        '<div class="cartao aviso"><p><strong>O envio ainda não está ligado.</strong> A fila já aparece, mas o botão Enviar só funciona depois que o administrador ligar o serviço de e-mail (Brevo) ' +
        (CRM.ehAdmin() ? '— veja o passo a passo no CLAUDE.md, seção "Cadência de e-mails".' : '. Avise o administrador.') + '</p></div>';
      const segPorMotivo = new Map();
      f.segurados.forEach(s => { const k = s.motivo.split(':')[0].replace(/ em \d\d\/\d\d\/\d{4}$/, '').replace(/há \d+ dia\(s\)/, 'há poucos dias'); segPorMotivo.set(k, (segPorMotivo.get(k) || []).concat([s])); });
      return '<div class="cabecalho"><div><h1>E-mails</h1><p class="sub">cadência de relacionamento e reposição para quem trata por e-mail · cada e-mail sai em nome da vendedora do cliente, depois da sua aprovação</p></div>' +
        (CRM.ehGestor() ? '<label class="filtro-inline">Vendedora <select data-em-vend>' + CRM.opcoesHTML([['', 'Todas']].concat(vends.map(u => [u.user_id, u.nome])), filtroVend) + '</select></label>' : '') + '</div>' + aviso +
        '<section class="cartao"><h2>Fila de hoje: ' + f.prontos.length + ' e-mail(s) <small>confira, ajuste o texto se quiser e envie; "Pular" deixa para o próximo ciclo</small></h2>' +
        (f.prontos.length > 1 ? '<p class="acoes"><button type="button" class="btn" data-acao="em-enviar-todos"' + (enviando ? ' disabled' : '') + '>Enviar os ' + f.prontos.length + '</button></p>' : '') +
        (f.prontos.length ? '' : '<p class="vazio">Nada para enviar hoje. 👍' + (f.semCampanha ? ' ' + f.semCampanha + ' cliente(s) esperando uma campanha nova.' : '') + '</p>') + '</section>' +
        f.prontos.map(cartao).join('') +
        (f.segurados.length ? '<section class="cartao"><details data-chave="em-segurados"><summary><h2>Segurados hoje: ' + f.segurados.length + ' <small>na cadência, mas fora da fila — e por quê</small></h2></summary>' +
          [...segPorMotivo.entries()].map(([m, l]) => '<h3>' + esc(m) + ' (' + l.length + ')</h3><p class="dica">' + l.map(s => '<button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(s.empresa_id) + '">' + esc(CRM.nomeEmpresa(s.empresa_id)) + '</button>').join(' · ') + '</p>').join('') +
          '</details></section>' : '') +
        blocoCampanhas() + blocoCadencia() + blocoResultados();
    },
    depois(c) {
      const it = i => fila().prontos[+i];
      const guarda = (i, k, v) => { const p = it(i); if (!p) return; const r = rascunho.get(chave(p)) || {}; r[k] = v; rascunho.set(chave(p), r); };
      c.querySelectorAll('[data-em-assunto]').forEach(x => x.addEventListener('input', () => guarda(x.dataset.emAssunto, 'assunto', x.value)));
      c.querySelectorAll('[data-em-corpo]').forEach(x => x.addEventListener('input', () => guarda(x.dataset.emCorpo, 'corpo', x.value)));
      c.querySelectorAll('[data-em-para]').forEach(x => x.addEventListener('change', () => {
        const i = x.dataset.emPara;
        guarda(i, 'para', [...c.querySelectorAll('[data-em-para="' + i + '"]')].filter(y => y.checked).map(y => y.value));
      }));
      const v = $('[data-em-vend]', c);
      if (v) v.addEventListener('change', () => { filtroVend = v.value; CRM.render(); });
    }
  };

  // Ficha do cliente: entrar ou sair da cadência.
  CRM.cadenciaEmail = e => {
    const r = e.email_sair_em ? CRM.selo('pediu para não receber (' + R.dataBR(R.diaLocal(e.email_sair_em)) + ')', 'vermelho') : e.email_cadencia ? esc(e.email_cadencia) : 'fora';
    return r + (CRM.podeEditarEmpresa(e) && !e.email_sair_em ? ' <button type="button" class="mini" data-acao="em-ficha" data-id="' + esc(e.id) + '">Mudar</button>' : '');
  };
  const poeNaCadencia = (id, valor) => CRM.atualizar('empresas', id, { email_cadencia: valor || null })
    .then(() => CRM.toast(valor ? 'Na cadência ' + valor + ': entra na fila de E-mails quando chegar a hora.' : 'Fora da cadência de e-mails.')).catch(CRM.falhou);

  Object.assign(CRM.acoes, {
    'em-enviar': async id => {
      const p = fila().prontos[+id];
      if (!p || enviando) return;
      enviando = true; CRM.render();
      try { await envia(p); CRM.toast('Enviado para ' + CRM.nomeEmpresa(p.empresa_id) + '.'); await CRM.recarregar(); } catch (e) { CRM.falhou(e); }
      finally { enviando = false; CRM.render(); }
    },
    'em-enviar-todos': async () => {
      const l = fila().prontos.slice();
      if (!l.length || enviando || !confirm('Enviar os ' + l.length + ' e-mails da fila, cada um em nome da vendedora do cliente?')) return;
      enviando = true; CRM.render();
      let ok = 0; const falhas = [];
      for (const p of l) { try { await envia(p); ok++; } catch (e) { falhas.push(CRM.nomeEmpresa(p.empresa_id) + ': ' + e.message); if (/limite|não está ligado/.test(e.message)) break; } }
      enviando = false;
      await CRM.recarregar();
      CRM.toast(ok + ' enviado(s)' + (falhas.length ? '; não saíram: ' + falhas.join(' · ') : '.'), !!falhas.length);
    },
    'em-pular': async id => {
      const p = fila().prontos[+id];
      if (!p) return;
      try {
        await CRM.inserir('email_envios', { empresa_id: p.empresa_id, responsavel_id: p.responsavel_id, tipo: p.tipo, campanha_id: p.campanha_id, situacao: 'pulado', para: p.para, assunto: p.assunto, enviado_por: CRM.meuId() });
        rascunho.delete(chave(p));
        CRM.toast('Pulado: volta no próximo ciclo.');
      } catch (e) { CRM.falhou(e); }
    },
    'em-tirar': id => { if (confirm('Tirar ' + CRM.nomeEmpresa(id) + ' da cadência de e-mails?')) poeNaCadencia(id, null); },
    'em-por': id => { const [e, v] = id.split(':'); poeNaCadencia(e, v); },
    'em-ficha': (id, el) => CRM.menuFlutuante(el, [['Mensal', () => poeNaCadencia(id, 'mensal'), 'um e-mail de relacionamento por mês'],
      ['Quinzenal', () => poeNaCadencia(id, 'quinzenal'), 'a cada 15 dias'], ['Fora da cadência', () => poeNaCadencia(id, null)]]),
    'em-campanha': id => formCampanha(id ? (E().D.email_campanhas || []).find(c => c.id === id) : null),
    'em-aberturas': async () => {
      try { const r = await CRM.store().email({ acao: 'aberturas' }); await CRM.recarregar(); CRM.toast('Atualizado: ' + r.abertos + ' abertura(s) e ' + r.clicados + ' clique(s) novos' + (r.devolvidos ? ', ' + r.devolvidos + ' devolvido(s)' : '') + '.'); }
      catch (e) { CRM.falhou(e); }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
