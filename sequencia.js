/* CRM Sistemi Dalessi — sequência de follow-up do lead novo.
   Lead cadastrado ganha o 1º passo (em vez de "Fazer o primeiro contato"); cada passo concluído
   agenda o próximo, contando os dias a partir de hoje. A sequência para sozinha quando o lead
   deixa de ser lead (virou prospect/cliente) ou ganha um negócio — é assim que a vendedora diz
   "respondeu". Passos com mensagem têm o botão que abre o WhatsApp/e-mail com o texto pronto e
   já conclui o passo. Os passos ficam em Configurações → Sequência do lead (cfg.sequencia_lead).
   Parte pura (CRMSequencia.*) testada em testes/sequencia.test.js. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);

  const PADRAO = [
    { dia: 0, tipo: 'whatsapp', titulo: 'Apresentação pelo WhatsApp',
      mensagem: '{saudacao} Aqui é {vendedor_primeiro_nome}, da {minha_empresa}. Vi o seu contato e queria me apresentar: posso te mandar nosso catálogo e uma cotação sem compromisso?' },
    { dia: 2, tipo: 'ligacao', titulo: 'Ligar para entender a necessidade', mensagem: '' },
    { dia: 5, tipo: 'email', titulo: 'Enviar o catálogo por e-mail', assunto: 'Catálogo {minha_empresa}',
      mensagem: '{saudacao}\n\nConforme conversamos, segue o nosso catálogo. Se quiser, monto uma cotação com os itens que vocês mais usam.\n\nFico à disposição,\n{vendedor}\n{minha_empresa}' },
    { dia: 10, tipo: 'whatsapp', titulo: 'Último toque',
      mensagem: '{saudacao} Passando para saber se posso ajudar com a cotação. Se agora não for o momento, sem problema: fico à disposição!' }
  ];

  const passos = cfg => {
    const l = Array.isArray(cfg && cfg.sequencia_lead) ? cfg.sequencia_lead : PADRAO;
    return l.filter(p => p && String(p.titulo || '').trim());
  };
  const ativa = cfg => !(cfg && cfg.sequencia_ativa === false) && passos(cfg).length > 0;

  // "[Sequência 2/4] Ligar para …" → { n: 2, total: 4 }
  const RE = /^\[Sequência (\d+)\/(\d+)\]\s*/;
  function passoDe(a) {
    const m = a && RE.exec(String(a.descricao || ''));
    return m ? { n: +m[1], total: +m[2] } : null;
  }
  const descricao = (n, total, p) => '[Sequência ' + n + '/' + total + '] ' + String(p.titulo).trim();

  // Dia do passo n (1…): hoje + diferença de dias entre ele e o anterior (o 1º: o dia dele).
  function diaDoPasso(cfg, n, hoje) {
    const l = passos(cfg), p = l[n - 1], ant = l[n - 2];
    if (!p) return null;
    return R.somaDias(hoje, Math.max(0, R.num(p.dia) - (ant ? R.num(ant.dia) : 0)));
  }

  // Continua? Só enquanto for lead sem negócio aberto nem ganho.
  function continua(empresa, negocios) {
    return !!empresa && empresa.situacao === 'lead' && !negocios.some(n => n.empresa_id === empresa.id && (n.status === 'aberto' || n.status === 'ganho'));
  }

  const S = { PADRAO, passos, ativa, passoDe, descricao, diaDoPasso, continua };
  raiz.CRMSequencia = S;
  if (typeof module !== 'undefined') module.exports = S;

  // ------------------------------------------------------------ no app
  const CRM = raiz.CRM;
  if (!CRM || !CRM.auto) return;
  const { esc, $ } = CRM;
  const E = () => CRM.estado;
  const A = CRM.auto;
  const horaDoPasso = (dia, hoje) => {
    if (dia !== hoje) return R.momento(dia, '09:00');
    const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
    if (d.getHours() >= 18 || d.getHours() < 8) return R.momento(R.somaDias(hoje, 1), '09:00');
    return d.toISOString();
  };

  async function agenda(empresa, n) {
    const cfg = E().cfg, l = passos(cfg), p = l[n - 1];
    if (!p) return null;
    const hoje = CRM.hoje();
    return A.tarefa({ empresa_id: empresa.id, tipo: p.tipo || 'tarefa', descricao: descricao(n, l.length, p),
      data_hora: horaDoPasso(diaDoPasso(cfg, n, hoje), hoje), responsavel_id: empresa.responsavel_id || CRM.meuId() });
  }

  const criarOriginal = A.aoCriarEmpresa.bind(A);
  A.aoCriarEmpresa = async e => {
    if (e && e.situacao === 'lead' && ativa(E().cfg)) { await agenda(e, 1); return; }
    return criarOriginal(e);
  };

  const concluirOriginal = A.aoConcluirTarefa.bind(A);
  A.aoConcluirTarefa = async a => {
    const s = passoDe(a);
    if (!s) return concluirOriginal(a);
    const e = CRM.empresa(a.empresa_id);
    if (!continua(e, E().D.negocios)) { CRM.toast('Sequência encerrada: o lead já respondeu (virou ' + (e ? R.rotulo(R.SITUACOES, e.situacao) || e.situacao : '—') + ' ou tem negócio).'); return concluirOriginal(a); }
    if (s.n >= passos(E().cfg).length) { CRM.toast('Último passo da sequência feito. Se o lead não respondeu, ele fica na base para prospecção.'); return; }
    const t = await agenda(e, s.n + 1);
    if (t) CRM.toast('Próximo passo da sequência agendado para ' + R.dataBR(t.data_hora) + '.');
  };

  // Botão "enviar" do passo: abre o WhatsApp/e-mail com o texto do passo, registra e conclui.
  CRM.sequencia = {
    passoDe,
    botao: a => {
      const s = passoDe(a); if (!s || a.concluida) return '';
      const p = passos(E().cfg)[s.n - 1];
      if (!p || !p.mensagem || (p.tipo !== 'whatsapp' && p.tipo !== 'email')) return '';
      return '<button type="button" class="mini wa" data-acao="sequencia-enviar" data-id="' + esc(a.id) + '" title="Abre com a mensagem do passo e conclui a tarefa">' + (p.tipo === 'email' ? 'Enviar e-mail do passo' : 'Enviar WhatsApp do passo') + '</button>';
    }
  };

  async function enviar(id) {
    const a = E().ix.porId.atividades.get(id); if (!a) return;
    const s = passoDe(a), p = s && passos(E().cfg)[s.n - 1];
    const e = CRM.empresa(a.empresa_id); if (!p || !e) return;
    const F = CRM.fichas;
    if (p.tipo === 'email') {
      // Tarefa de uma pessoa: só ela; senão, todos os e-mails do lead.
      const escolhido = a.contato_id ? CRM.contato(a.contato_id) : null;
      const c = escolhido || F.escolheContato(e, null, x => x.email);
      const para = F.emailsDe(e, escolhido);
      if (!para.length) { CRM.toast('Sem e-mail cadastrado para este lead.', true); return; }
      const v = F.variaveis(e, c), assunto = R.aplicaModelo(p.assunto || p.titulo, v), corpo = R.aplicaModelo(p.mensagem, v);
      location.href = F.linkEmail(para, assunto, corpo);
      await F.registraAuto(e, escolhido, 'email', 'E-mail da sequência para ' + para.join(', ') + ' — "' + assunto + '": ' + corpo);
    } else {
      const c = F.escolheContato(e, a.contato_id, x => R.linkWhatsApp(x.whatsapp || x.celular || x.telefone));
      const tel = F.telDe(e, c);
      if (!R.linkWhatsApp(tel)) { CRM.toast('Sem número de WhatsApp com DDD neste lead.', true); return; }
      const texto = R.aplicaModelo(p.mensagem, F.variaveis(e, c));
      window.open(R.linkWhatsApp(tel, texto), '_blank', 'noopener');
      await F.registraAuto(e, c, 'whatsapp', 'WhatsApp da sequência' + (c ? ' para ' + c.nome : '') + ': ' + texto);
    }
    await CRM.concluirTarefa(a.id, true);
  }

  Object.assign(CRM.acoes, { 'sequencia-enviar': id => enviar(id).catch(CRM.falhou) });

  // ------------------------------------------------------------ Configurações
  const TIPOS = [['whatsapp', 'WhatsApp'], ['ligacao', 'Ligação'], ['email', 'E-mail'], ['tarefa', 'Tarefa'], ['visita', 'Visita']];
  const linhas = () => { const l = passos(E().cfg).slice(); while (l.length < 6) l.push({ dia: '', tipo: 'whatsapp', titulo: '', mensagem: '' }); return l; };
  CRM.ajustes.secao('sequencia', 'Sequência do lead', () =>
    '<form id="formSeq" class="form-plano">' +
    '<p>Todo lead cadastrado ganha o 1º passo como tarefa. Cada passo concluído agenda o próximo. A sequência <strong>para sozinha</strong> quando o lead responde: mude a situação para Prospect/Cliente ou crie um negócio.</p>' +
    '<p class="dica">Variáveis: {saudacao} ("Olá, Maria!"), {primeiro_nome}, {empresa}, {vendedor}, {vendedor_primeiro_nome}, {minha_empresa}. Passo sem título fica de fora. "Dia" conta a partir do cadastro.</p>' +
    '<label class="campo check"><input type="checkbox" id="seqAtiva"' + (E().cfg.sequencia_ativa !== false ? ' checked' : '') + '> Usar a sequência para leads novos (desligada: o lead ganha só "Fazer o primeiro contato")</label>' +
    linhas().map((p, i) => '<fieldset class="seq-passo"><legend>Passo ' + (i + 1) + '</legend><div class="campos">' +
      '<label class="campo"><span>Dia</span><input type="number" min="0" step="1" id="seqDia' + i + '" value="' + esc(p.dia) + '"></label>' +
      '<label class="campo"><span>Canal</span><select id="seqTipo' + i + '">' + CRM.opcoesHTML(TIPOS, p.tipo || 'whatsapp') + '</select></label>' +
      '<label class="campo largo"><span>O que fazer</span><input type="text" id="seqTitulo' + i + '" value="' + esc(p.titulo || '') + '"></label>' +
      '<label class="campo largo"><span>Assunto (e-mail)</span><input type="text" id="seqAssunto' + i + '" value="' + esc(p.assunto || '') + '"></label>' +
      '<label class="campo largo"><span>Mensagem pronta (WhatsApp ou e-mail; vazio = sem mensagem)</span><textarea id="seqMsg' + i + '" rows="3">' + esc(p.mensagem || '') + '</textarea></label>' +
      '</div></fieldset>').join('') +
    '<p><button type="submit" class="btn">Salvar sequência</button> <button type="button" class="btn sec" data-acao="seq-padrao">Voltar ao padrão</button></p></form>',
  () => {
    const f = $('#formSeq'); if (!f) return;
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const l = [];
      for (let i = 0; i < 6; i++) {
        const titulo = ($('#seqTitulo' + i).value || '').trim();
        if (!titulo) continue;
        l.push({ dia: Math.max(0, parseInt($('#seqDia' + i).value, 10) || 0), tipo: $('#seqTipo' + i).value, titulo,
          assunto: ($('#seqAssunto' + i).value || '').trim(), mensagem: $('#seqMsg' + i).value || '' });
      }
      l.sort((a, b) => a.dia - b.dia);
      try { await CRM.salvarConfig({ sequencia_lead: l, sequencia_ativa: $('#seqAtiva').checked }); CRM.toast('Sequência salva (' + l.length + ' passo(s)).'); } catch (e) { CRM.falhou(e); }
    });
  }, 'modelos');
  Object.assign(CRM.acoes, { 'seq-padrao': async () => { try { await CRM.salvarConfig({ sequencia_lead: PADRAO }); CRM.toast('Sequência padrão restaurada.'); } catch (e) { CRM.falhou(e); } } });
})(typeof window !== 'undefined' ? window : globalThis);
