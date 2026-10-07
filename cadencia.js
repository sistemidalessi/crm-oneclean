/* CRM Sistemi Dalessi — cadência de e-mails (07/10/2026): regras puras, sem tela (emails.js é a tela).
   Fica fora do regras.js de propósito: o regras.js é o motor da Edge Function crm-notas, fixado por
   hash — mexer nele obrigaria a republicar a função sem motivo. Testes: testes/cadencia.test.js. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  const { primeiroNome, aplicaModelo, textoItens, itensHabituais, cicloRecompra, diaLocal, diasEntre, dataBR, num, normaliza, somaDias, notaDeVenda } = R;
  // Padrões (Configurações pode trocar): o e-mail de reposição; o de relacionamento é a campanha da líder.
  const PADRAO = {
    email_assunto_reposicao: 'Hora de repor os produtos de {empresa}',
    email_modelo_reposicao: '{saudacao}\n\nAqui é {vendedor_primeiro_nome}, da {minha_empresa}. Pelo ritmo das suas compras, já está chegando a hora de repor:\n{itens}\n\n' +
      'Quer que eu separe o de sempre? É só responder este e-mail que eu preparo o pedido para você.\n\nUm abraço,\n{vendedor}\n{minha_empresa}',
    email_limite_dia: 200 // e-mails da cadência por dia, somando todo mundo (o Brevo grátis dá 300); a função confere
  };
  // Clientes que só tratam por e-mail: a vendedora (ou a líder) marca a cadência na ficha (quinzenal ou
  // mensal). Todo dia o CRM monta a FILA: reposição quando chega o ritmo de compra do cliente (com o que
  // ele costuma levar) e, no intervalo da cadência, a campanha de relacionamento que a líder escreveu.
  // Segura quem pediu para sair, está sem e-mail, tem negócio em andamento, duplicata em atraso ou
  // comprou há menos de 7 dias. Nada sai sem aprovação (a fila é só a sugestão do dia).
  const INTERVALO_CADENCIA = { quinzenal: 14, mensal: 30 };
  const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const separaEmails = v => String(v == null ? '' : v).split(/[;,\s/]+/).map(x => x.trim().replace(/^<|>$/g, '')).filter(x => EMAIL_OK.test(x));
  // o da empresa e os de cada pessoa (principal primeiro), sem repetir
  function emailsEmpresa(e, contatos) {
    const l = separaEmails(e && e.email).concat(...(contatos || []).slice().sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0)).map(c => separaEmails(c.email)));
    const vistos = new Set();
    return l.filter(m => { const k = m.toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; });
  }
  // "Sr. Carlos Silva" → "Olá, Sr. Carlos!"; "Ana Paula" → "Olá, Ana!"; sem nome → "Olá!"
  function saudacaoDe(nome) {
    const trat = String(nome || '').trim().match(/^((?:sra?|srta|dra?|d)\.?)\s+(\S+)/i);
    const pn = primeiroNome(nome);
    return trat ? 'Olá, ' + trat[1] + ' ' + trat[2] + '!' : pn ? 'Olá, ' + pn + '!' : 'Olá!';
  }
  // "COLÉGIO X | JOSÉ" (nome com o contato depois da barra) → "COLÉGIO X"
  const nomeLimpo = n => String(n || '').split(' | ')[0].trim();
  function variaveisEmail(e, ix, opc) {
    const c = (ix.porEmpresa.contatos.get(e.id) || []).slice().sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0))[0] || null;
    const vend = (opc.nomeUsuario && opc.nomeUsuario(e.responsavel_id)) || opc.eu || '';
    return { saudacao: saudacaoDe(c && c.nome), contato: c ? c.nome : '', primeiro_nome: primeiroNome(c && c.nome), empresa: nomeLimpo(e.nome),
      vendedor: vend, vendedor_primeiro_nome: primeiroNome(vend), minha_empresa: opc.minhaEmpresa || '',
      itens: textoItens(itensHabituais(ix, e.id)) || 'os produtos de sempre' };
  }
  // → { prontos: [{ empresa_id, responsavel_id, tipo, campanha_id, para, assunto, corpo, motivo }], segurados: [{ empresa_id, motivo }], semCampanha }
  // opc: { atraso: Set(empresa_id com duplicata em atraso), nomeUsuario(id), eu, minhaEmpresa }
  function filaCadencia(D, ix, cfgCRM, hoje, opc) {
    opc = opc || {};
    const cfg = Object.assign({}, cfgCRM || {});
    Object.keys(PADRAO).forEach(k => { if (!cfg[k]) cfg[k] = PADRAO[k]; }); // campo apagado em Configurações = o padrão
    const envios = new Map();
    (D.email_envios || []).filter(x => x.situacao !== 'erro').forEach(x => { const l = envios.get(x.empresa_id) || []; l.push(x); envios.set(x.empresa_id, l); });
    envios.forEach(l => l.sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1)));
    const campanhas = (D.email_campanhas || []).filter(c => c.ativa !== false && String(c.desde || '').slice(0, 10) <= hoje)
      .sort((a, b) => (String(a.desde) < String(b.desde) ? 1 : -1));
    const prontos = [], segurados = [];
    let semCampanha = 0;
    const segura = (e, motivo) => segurados.push({ empresa_id: e.id, motivo });
    (D.empresas || []).filter(e => INTERVALO_CADENCIA[e.email_cadencia]).forEach(e => {
      if (e.email_sair_em) return segura(e, 'pediu para não receber em ' + dataBR(diaLocal(e.email_sair_em)));
      const para = emailsEmpresa(e, ix.porEmpresa.contatos.get(e.id));
      if (!para.length) return segura(e, 'sem e-mail cadastrado');
      const envs = envios.get(e.id) || [];
      const ultimo = envs.length ? diaLocal(envs[0].criado_em) : null;
      if (ultimo && diasEntre(ultimo, hoje) < 5) return; // recebeu (ou pulou) há poucos dias
      const r = ix.resumo.get(e.id) || {};
      // negócio aberto que andou nos últimos dias (os parados/esquecidos do Agendor não seguram)
      const andando = (ix.porEmpresa.negocios.get(e.id) || []).some(n => n.status === 'aberto' && diasEntre(diaLocal(n.etapa_desde || n.criado_em), hoje) <= (num(cfg.dias_parado) || 15));
      if (andando) return segura(e, 'negócio em andamento: a vendedora já está falando com ele');
      if (opc.atraso && opc.atraso.has(e.id)) return segura(e, 'duplicata em atraso');
      const v = variaveisEmail(e, ix, opc);
      const item = (tipo, campanha, assunto, corpo, motivo) => prontos.push({ empresa_id: e.id, responsavel_id: e.responsavel_id || null, tipo, campanha_id: campanha ? campanha.id : null,
        para, assunto: aplicaModelo(assunto, v), corpo: aplicaModelo(corpo, v), motivo });
      // 1) reposição: chegou o ritmo de compra (3 dias antes) e ainda não foi lembrado desde a última compra
      if (r.ultimaCompra) {
        const ciclo = cicloRecompra(e, r, cfg), dias = diasEntre(r.ultimaCompra, hoje);
        const lembrado = envs.some(x => x.tipo === 'reposicao' && diaLocal(x.criado_em) >= r.ultimaCompra);
        if (!lembrado && dias >= ciclo - 3 && dias <= Math.max(2 * ciclo, num(cfg.dias_inativo) || 90))
          return item('reposicao', null, cfg.email_assunto_reposicao, cfg.email_modelo_reposicao,
            (r.ritmo && !num(e.ciclo_recompra_dias) ? 'compra a cada ~' + ciclo + ' dias' : 'ciclo de ' + ciclo + ' dias') + '; última compra ' + dataBR(r.ultimaCompra));
      }
      // 2) relacionamento: passou o intervalo da cadência desde o último e-mail
      const intervalo = INTERVALO_CADENCIA[e.email_cadencia];
      if (ultimo && diasEntre(ultimo, hoje) < intervalo) return;
      if (r.ultimaCompra && diasEntre(r.ultimaCompra, hoje) < 7) return segura(e, 'comprou há ' + diasEntre(r.ultimaCompra, hoje) + ' dia(s)');
      const recebidas = new Set(envs.map(x => x.campanha_id).filter(Boolean));
      const seg = normaliza(e.segmento || '');
      const c = campanhas.find(x => !recebidas.has(x.id) && (!x.segmento || normaliza(x.segmento) === seg));
      if (!c) { semCampanha++; return segura(e, 'esperando campanha nova (já recebeu as que existem)'); }
      item('relacionamento', c, c.assunto, c.corpo, 'cadência ' + e.email_cadencia + (ultimo ? '; último e-mail ' + dataBR(ultimo) : '; primeiro e-mail'));
    });
    return { prontos, segurados, semCampanha };
  }
  // Quem pode entrar na cadência: cliente com e-mail, fora dela, sem ligação, WhatsApp, visita ou
  // reunião nos últimos 90 dias — os que mais compraram primeiro.
  function sugestoesCadencia(D, ix, hoje, max) {
    const VOZ = new Set(['ligacao', 'whatsapp', 'visita', 'reuniao']);
    return (D.empresas || []).filter(e => !e.email_cadencia && !e.email_sair_em && (e.situacao === 'cliente' || e.situacao === 'inativo'))
      .filter(e => emailsEmpresa(e, ix.porEmpresa.contatos.get(e.id)).length)
      .filter(e => !(ix.porEmpresa.atividades.get(e.id) || []).some(a => VOZ.has(a.tipo) && a.concluida && diasEntre(diaLocal(a.concluida_em || a.data_hora), hoje) <= 90))
      .map(e => ({ e, r: ix.resumo.get(e.id) || {} })).filter(x => x.r.ultimaCompra)
      .sort((a, b) => num(b.r.totalComprado) - num(a.r.totalComprado)).slice(0, max || 30).map(x => x.e);
  }
  // Resultado dos e-mails enviados nos últimos "dias": abertos, clicados e quem comprou até 15 dias depois.
  function resultadosCadencia(D, ix, hoje, dias) {
    const desde = somaDias(hoje, -(dias || 30));
    const env = (D.email_envios || []).filter(x => x.situacao === 'enviado' && diaLocal(x.criado_em) >= desde);
    const notasVistas = new Set();
    let compraram = 0, valor = 0;
    env.forEach(x => {
      const d = diaLocal(x.criado_em), ate = somaDias(d, 15);
      const ns = (ix.porEmpresa.notas.get(x.empresa_id) || []).filter(n => notaDeVenda(n, ix.porNota.get(n.id)) && diaLocal(n.emitida_em) > d && diaLocal(n.emitida_em) <= ate);
      if (ns.length) compraram++;
      ns.forEach(n => { if (!notasVistas.has(n.id)) { notasVistas.add(n.id); valor += num(n.valor_total); } });
    });
    return { enviados: env.length, abertos: env.filter(x => x.aberto_em).length, clicados: env.filter(x => x.clicado_em).length, compraram, valor: Math.round(valor * 100) / 100 };
  }

  const api = { PADRAO, INTERVALO_CADENCIA, emailsEmpresa, saudacaoDe, filaCadencia, sugestoesCadencia, resultadosCadencia };
  raiz.CRMCadencia = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
