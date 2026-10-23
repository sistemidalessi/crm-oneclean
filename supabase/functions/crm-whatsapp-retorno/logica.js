// Partes puras do retorno da Meta (crm-whatsapp-retorno): ler o corpo do webhook, a ordem dos status e o "Já paguei".
// JavaScript puro, sem Deno: a função importa e os testes do Node (testes/whatsapp-retorno.test.js) também.

// o corpo da Meta vira uma lista simples de eventos: status (de uma mensagem nossa) e mensagens recebidas
export function eventosDoCorpo(corpo) {
  const saida = [];
  for (const en of (corpo && corpo.entry) || []) {
    for (const ch of en.changes || []) {
      const v = ch.value || {};
      const nomes = new Map((v.contacts || []).map(c => [String(c.wa_id || ''), (c.profile && c.profile.name) || '']));
      for (const s of v.statuses || []) {
        const e = (s.errors || [])[0];
        saida.push({ tipo: 'status', wamid: s.id || '', status: String(s.status || ''), para: String(s.recipient_id || ''),
          erro: e ? String(e.title || e.message || '') + (e.code ? ' (código ' + e.code + ')' : '') + (e.error_data && e.error_data.details ? ': ' + e.error_data.details : '') : '' });
      }
      for (const m of v.messages || []) {
        const t = m.type;
        let texto = '', payload = '';
        if (t === 'text') texto = (m.text && m.text.body) || '';
        else if (t === 'button') { texto = (m.button && m.button.text) || ''; payload = (m.button && m.button.payload) || ''; }
        else if (t === 'interactive') { const r = (m.interactive && (m.interactive.button_reply || m.interactive.list_reply)) || {}; texto = r.title || ''; payload = r.id || ''; }
        else if (t === 'image' || t === 'document' || t === 'video') texto = ((m[t] && m[t].caption) || '') + ' [' + ({ image: 'imagem', document: 'arquivo', video: 'vídeo' })[t] + ']';
        else if (t === 'audio') texto = '[áudio]';
        else if (t === 'reaction') texto = '[reação ' + ((m.reaction && m.reaction.emoji) || '') + ']';
        else texto = '[' + (t || 'mensagem') + ']';
        const de = String(m.from || '');
        saida.push({ tipo: 'mensagem', wamid: m.id || '', de, nome: nomes.get(de) || '', texto: texto.trim(), payload, contexto: (m.context && m.context.id) || '', tipoMsg: t || '' });
      }
    }
  }
  return saida;
}

const STATUS = { sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou' };
export const statusCRM = s => STATUS[s] || '';
const ORDEM = { enviado: 1, 'enviado com o PDF': 1, entregue: 2, lido: 3 };
// o status só sobe (a Meta pode mandar "entregue" depois de "lido"); "falhou" vale se ainda não foi entregue
export function novoStatus(atual, novo) {
  if (!novo || novo === atual) return null;
  if (novo === 'falhou') return (ORDEM[atual] || 0) >= 2 ? null : 'falhou';
  if (atual === 'falhou') return novo;
  return (ORDEM[novo] || 0) > (ORDEM[atual] || 0) ? novo : null;
}

const semAcento = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// o botão "Já paguei" (payload pagou:<id>) ou o cliente escrevendo que já pagou
export function ehPagou(m) {
  if (/^(pagou|avisopagou):/.test(String(m && m.payload || ''))) return true;
  // texto livre: só o que diz com clareza que pagou ("pago amanhã" e "não foi pago" não contam)
  const t = semAcento(m && m.texto);
  if (/\b(nao|vou|vamos|amanha|depois|semana)\b/.test(t)) return false;
  return t === 'paguei' || t === 'pago' || /\b(ja paguei|ja pagamos|ja foi pago|ja esta pago|ta pago|esta pago|foi pago|pagamento (foi )?(feito|realizado|efetuado))\b/.test(t);
}
// "Já paguei" do aviso de atraso (crm-cobranca, 23/10/2026): payload avisopagou:<id do aviso>
export const avisoDoPayload = p => { const m = /^avisopagou:([0-9a-f-]{36})$/.exec(String(p || '')); return m ? m[1] : ''; };
export const idDoPayload = p => { const m = /^(?:pagou|falar):([0-9a-f-]{36})$/.exec(String(p || '')); return m ? m[1] : ''; };

// celular do Brasil no WhatsApp: a Meta às vezes devolve o número sem o 9 (55 11 8765-4321); vale com e sem
export function variantesBR(n) {
  const d = String(n || '').replace(/\D/g, '');
  const l = [d];
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) l.push(d.slice(0, 4) + '9' + d.slice(4));
  if (/^55\d{2}9[6-9]\d{7}$/.test(d)) l.push(d.slice(0, 4) + d.slice(5));
  return l.filter(Boolean);
}

// as respostas automáticas (dentro das 24 h que a Meta abre quando o cliente escreve)
export function textoPagou(nomeCliente, vendedora) {
  return 'Obrigado pelo aviso' + (nomeCliente ? ', ' + nomeCliente : '') + '! O financeiro vai conferir o pagamento no banco' +
    (vendedora ? ' e, se precisar de algo, ' + vendedora + ' fala com você' : '') + '. Tenha um ótimo dia!';
}
export function textoRepasse(vendedora, telVendedora) {
  return 'Obrigado pela mensagem! Repassei para ' + (vendedora || 'quem te atende') + ', que vai te responder pelo WhatsApp.' +
    (telVendedora ? ' Se preferir, fale direto: https://wa.me/' + telVendedora : '');
}

// agradecimento da entrega (21/10/2026): o botão "Agendar próximo pedido" (payload proximo:<id da entrega>)
export const entregaDoPayload = p => { const m = /^proximo:([0-9a-f-]{36})$/.exec(String(p || '')); return m ? m[1] : ''; };
export function textoProximo(nomeCliente, vendedora) {
  return 'Que ótimo' + (nomeCliente ? ', ' + nomeCliente : '') + '! ' + (vendedora || 'Quem te atende') +
    ' vai falar com você para combinarmos o próximo pedido. Obrigado pela preferência!';
}
