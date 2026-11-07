// Fiscal dos agentes da OneClean (06/11/2026): quando e o que avisar no celular do Anderson. Partes puras (sem Deno): a Edge
// Function crm-fiscal-agentes importa e os testes do Node (testes/fiscal-agentes.test.js) também. Mesma regra do fiscal da
// Agilité (agilite-sistema-gestao src/fiscal/agentes.js, planoDeAviso/montarAviso), pedida pelo Anderson para as duas:
//   - só em dia útil (07/11/2026) e das 7h às 21h (Brasília); fora disso nada sai (o grave novo espera);
//   - problema GRAVE novo: na hora, uma vez por problema (e de novo se um "atenção" virar grave);
//   - segunda, quarta e sexta a partir das 8h: o resumo do que está aberto + os prazos até 2 dias (na sexta, até segunda);
//   - toda segunda, mesmo sem nada aberto: "tudo certo" (prova de que o fiscal está vivo);
//   - terça e quinta às 8h: só os prazos de hoje e amanhã, se houver.
// É a exceção nº 11 da regra de envio (CLAUDE.md): só para os aparelhos que o Anderson inscreveu; nunca a mais ninguém.

export const URL_CRM = 'https://sistemidalessi.github.io/crm-oneclean/';
export const URL_FISCAL = URL_CRM + '#agentes';

const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
const br = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');

// hora, dia da semana (0 = domingo) e data em Brasília
export function agoraBr(agora = Date.now()) {
  const d = new Date(agora - 3 * 3600e3);
  return { hora: d.getUTCHours(), dow: d.getUTCDay(), dia: d.toISOString().slice(0, 10) };
}
export const somaDia = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// o que avisar agora (sem enviar). `abertos`: problemas em aberto ({ chave, area, nivel, texto, fazer, avisado_em });
// `prazosDe(de, ate)`: os prazos do calendário ({ data, titulo }).
// `diaUtil`: false em sábado, domingo e feriado (crm_prospec_dia_util, calendário de São Bernardo). 07/11/2026, Anderson: os
// avisos da OneClean só em dia útil ("a OneClean não abre de feriado, nem sábado, nem domingo"); o grave do fim de semana
// fica guardado e sai no próximo dia útil (ainda sem avisado_em), junto do resumo.
export function planoDeAviso(abertos, { agora = Date.now(), ultimoResumo = null, ultimoPrazos = null, prazosDe = () => [], diaUtil = null } = {}) {
  const { hora, dow, dia } = agoraBr(agora);
  if (diaUtil === false || (diaUtil == null && (dow === 0 || dow === 6))) return { avisar: false, motivo: 'não é dia útil na OneClean' };
  if (hora < 7 || hora >= 21) return { avisar: false, motivo: 'fora da janela (7h às 21h)' };
  const graves = abertos.filter(p => p.nivel === 'grave' && !p.avisado_em);
  const diaDeResumo = [1, 3, 5].includes(dow) && hora >= 8 && ultimoResumo !== dia;
  if (diaDeResumo) {
    const pz = prazosDe(dia, somaDia(dia, dow === 5 ? 3 : 2));
    if (abertos.length || pz.length || dow === 1) return { avisar: true, tipo: 'resumo', dia, itens: abertos, prazos: pz, marcar: abertos.filter(p => !p.avisado_em).map(p => p.chave) };
    return { avisar: false, tipo: 'resumo-vazio', dia, motivo: 'nada aberto nem prazo' };
  }
  if (graves.length) return { avisar: true, tipo: 'grave', itens: graves, marcar: graves.map(p => p.chave) };
  if ([2, 4].includes(dow) && hora >= 8 && ultimoPrazos !== dia) {
    const pz = prazosDe(dia, somaDia(dia, 1));
    if (pz.length) return { avisar: true, tipo: 'prazos', dia, itens: [], prazos: pz, marcar: [] };
    return { avisar: false, tipo: 'prazos-vazio', dia, motivo: 'sem prazo hoje nem amanhã' };
  }
  return { avisar: false, motivo: 'nada novo pra avisar' };
}

const CONFERE = 'agendadores, NF-e, DF-e, boletos e extrato do BB, espelho com a Agilité, cobrança, leads, contador, pedidos travados, certificado A1, IBPT e prazos';

// o texto da notificação (curto: o celular corta). { titulo, corpo, url, tag }
export function montarAviso(plano) {
  const linhasPrazo = (pz, max) => pz.slice(0, max).map(x => '• ' + br(x.data).slice(0, 5) + ' ' + x.titulo).join('\n') + (pz.length > max ? '\n… e mais ' + (pz.length - max) + ' prazo(s)' : '');
  if (plano.tipo === 'grave') {
    const p = plano.itens[0];
    return { titulo: plano.itens.length === 1 ? 'Fiscal OneClean: ' + p.area + ' travou' : 'Fiscal OneClean: ' + plano.itens.length + ' coisas travaram',
      corpo: plano.itens.length === 1 ? (p.texto + ' ' + (p.fazer || '')).trim() : plano.itens.slice(0, 5).map(x => '• ' + x.texto).join('\n') + (plano.itens.length > 5 ? '\n… e mais ' + (plano.itens.length - 5) : ''),
      url: URL_FISCAL, tag: 'oneclean-fiscal-grave' };
  }
  const pz = plano.prazos || [];
  if (plano.tipo === 'prazos') return { titulo: 'OneClean: prazos de hoje e amanhã (' + pz.length + ')', corpo: linhasPrazo(pz, 6), url: URL_FISCAL, tag: 'oneclean-fiscal-prazos' };
  if (!plano.itens.length) {
    return { titulo: pz.length ? 'Fiscal OneClean: nada travado · ' + plural(pz.length, 'prazo', 'prazos') + ' chegando' : 'Fiscal OneClean: tudo certo',
      corpo: (pz.length ? 'Prazos:\n' + linhasPrazo(pz, 6) + '\n' : '') + 'Conferi ' + CONFERE + ': nada travado.', url: URL_FISCAL, tag: 'oneclean-fiscal-resumo' };
  }
  const g = plano.itens.filter(p => p.nivel === 'grave').length;
  return { titulo: 'Fiscal OneClean: ' + plural(plano.itens.length, 'pendência aberta', 'pendências abertas') + (g ? ' (' + g + ' grave' + (g > 1 ? 's' : '') + ')' : ''),
    corpo: plano.itens.slice(0, 5).map(p => '• ' + p.texto).join('\n') + (plano.itens.length > 5 ? '\n… e mais ' + (plano.itens.length - 5) : '') + (pz.length ? '\nPrazos:\n' + linhasPrazo(pz, 4) : ''),
    url: URL_FISCAL, tag: 'oneclean-fiscal-resumo' };
}

// O que a rotina da nuvem lê (público, sem detalhe): a hora da última conferência e quantos problemas há.
export function pulso(abertos, verificadoEm) {
  return { empresa: 'OneClean', verificado_em: verificadoEm || null, graves: abertos.filter(p => p.nivel === 'grave').length, atencao: abertos.filter(p => p.nivel !== 'grave').length };
}

// Certificado A1 e serviço fiscal (vêm do /saude do serviço fiscal na VPS, que só a Edge Function alcança): viram problemas
// que a crm_fiscal_conferir grava junto com os do banco. `saude`: { ok, certificado: { validoAte } } ou { erro }.
export function problemasExternos({ saude = null, agilite = null, agora = Date.now() } = {}) {
  const out = [];
  if (!saude || saude.erro || !saude.ok) {
    out.push({ chave: 'externo:servico-fiscal', area: 'NF-e', nivel: 'grave', texto: 'O serviço fiscal na VPS não respondeu (' + String((saude && saude.erro) || 'sem resposta').slice(0, 100) + '): nenhuma NF-e sai.',
      fazer: 'Me chamar: conferir o serviço oneclean-fiscal e o Caddy na VPS da Agilité.', link: '#agentes' });
  } else {
    const ate = saude.certificado && (saude.certificado.validoAte || saude.certificado.valido_ate);
    if (!ate) out.push({ chave: 'externo:certificado-ilegivel', area: 'Fiscal', nivel: 'grave', texto: 'O serviço fiscal está no ar, mas sem o certificado A1 carregado: a NF-e não assina.', fazer: 'Me chamar: conferir o .pfx e a senha na VPS.', link: '#agentes' });
    else {
      const dias = Math.floor((Date.parse(ate) - agora) / 864e5);
      if (dias <= 30) out.push({ chave: 'externo:certificado', area: 'Fiscal', nivel: dias <= 7 ? 'grave' : 'atencao',
        texto: dias < 0 ? 'O certificado A1 da OneClean venceu em ' + br(ate) + ': NF-e, DF-e e extrato do BB param.' : 'O certificado A1 da OneClean vence em ' + dias + ' dias (' + br(ate) + ').',
        fazer: 'Renovar o e-CNPJ A1 e instalar na VPS (passo a passo em sistemi-dalessi docs/oneclean/certificado-a1-2027.md).', link: '#agentes' });
    }
  }
  // um vigia o outro: o fiscal da Agilité também confere de hora em hora; se o pulso dele envelhecer, avisa daqui
  if (agilite) {
    if (agilite.erro) out.push({ chave: 'externo:fiscal-agilite', area: 'Fiscal da Agilité', nivel: 'atencao', texto: 'Não consegui ler o pulso do fiscal da Agilité (' + String(agilite.erro).slice(0, 80) + ').', fazer: 'Se continuar, me chamar: o sistema da Agilité pode estar fora do ar.', link: '#agentes' });
    else if (agilite.verificado_em && agora - Date.parse(agilite.verificado_em) > 3 * 3600e3) {
      out.push({ chave: 'externo:fiscal-agilite', area: 'Fiscal da Agilité', nivel: 'grave', texto: 'O fiscal do sistema da Agilité não confere nada há ' + Math.round((agora - Date.parse(agilite.verificado_em)) / 3600e3) + ' h.', fazer: 'Me chamar: o robô "fiscal" do sistema da Agilité parou.', link: '#agentes' });
    }
  }
  return out;
}
