// Partes puras do aviso de atraso ao cliente (crm-cobranca, 23/10/2026, pedido do Anderson: "chegou em 5 dias úteis de
// atraso, já enviar" — um aviso só, cordial, já dizendo que depois do prazo o título segue para o cartório; ou o cliente
// procura a vendedora e negocia, ou o administrador manda para o cartório). JavaScript puro, sem Deno: a função importa e
// os testes do Node (testes/cobranca-avisos.test.js) também.

const dia = iso => new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
const iso = d => d.toISOString().slice(0, 10);
const util = d => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

// dias úteis (segunda a sexta) depois do vencimento até hoje: venceu sexta, hoje segunda = 1
export function diasUteisAtraso(vencimento, hoje) {
  const d = dia(vencimento), fim = dia(hoje);
  let n = 0;
  while (d < fim) { d.setUTCDate(d.getUTCDate() + 1); if (util(d)) n++; }
  return n;
}
// hoje + n dias úteis
export function prazoUtil(hoje, n) {
  const d = dia(hoje);
  let falta = Math.max(1, Math.round(Number(n) || 0));
  while (falta > 0) { d.setUTCDate(d.getUTCDate() + 1); if (util(d)) falta--; }
  return iso(d);
}

const chave = (empresa, duplicata) => String(empresa || '') + '|' + String(duplicata || '');
// Quem recebe o aviso hoje: títulos vencidos há `dias` dias úteis ou mais, de cliente cadastrado, fora do cartório, sem
// data combinada para receber (previsão de hoje em diante) e que ainda não entraram num aviso. Um aviso por cliente,
// com todos os títulos dele que chegaram ao prazo. avisos: [{ empresa_id, duplicatas: [] }]; pagos: Set(chave) dos que o
// cliente disse que pagou; semAviso: Set(empresa_id) que não recebem (venda direta, combinado…).
export function quemRecebe({ titulos, avisos, hoje, dias, pagos, semAviso }) {
  const ja = new Set();
  for (const a of avisos || []) for (const d of a.duplicatas || []) ja.add(chave(a.empresa_id, d));
  const porCliente = new Map();
  for (const t of titulos || []) {
    if (!t.empresa_id || t.cartorio_em || !t.vencimento || String(t.vencimento) >= hoje) continue;
    if (t.previsao && String(t.previsao) >= hoje) continue;
    if (semAviso && semAviso.has(t.empresa_id)) continue;
    const k = chave(t.empresa_id, t.duplicata);
    if (ja.has(k) || (pagos && pagos.has(k))) continue;
    const du = diasUteisAtraso(t.vencimento, hoje);
    if (du < (Number(dias) || 5)) continue;
    if (!porCliente.has(t.empresa_id)) porCliente.set(t.empresa_id, []);
    porCliente.get(t.empresa_id).push(Object.assign({}, t, { dias_uteis: du, dias_corridos: Math.round((dia(hoje) - dia(t.vencimento)) / 864e5) }));
  }
  return [...porCliente.entries()].map(([empresa_id, l]) => {
    l.sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)) || String(a.duplicata).localeCompare(String(b.duplicata)));
    return { empresa_id, titulos: l, valor: Math.round(l.reduce((s, t) => s + (Number(t.valor) || 0), 0) * 100) / 100,
      dias: Math.max(...l.map(t => t.dias_corridos)) };
  }).sort((a, b) => b.dias - a.dias);
}

const dm = v => String(v).slice(8, 10) + '/' + String(v).slice(5, 7) + '/' + String(v).slice(0, 4);
const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const diaLongo = v => SEMANA[dia(v).getUTCDay()] + ', ' + dm(v);
export function moeda(v) {
  const [i, d] = Math.abs(Number(v) || 0).toFixed(2).split('.');
  return (v < 0 ? '-' : '') + 'R$ ' + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
}
const juntaE = l => (l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1]);
const docDe = t => (t.nota_numero ? String(t.nota_numero) : 'duplicata ' + t.duplicata);
// "a NF 2428, vencida em 10/10/2026" · "as NF 2428 e 2433, vencidas em 10/10/2026 e 15/10/2026" (a nota com várias parcelas
// aparece uma vez, com as datas)
export function docsTexto(titulos) {
  const l = titulos || [];
  const notas = [...new Set(l.map(docDe))], datas = [...new Set(l.map(t => dm(t.vencimento)))];
  const comNF = l.every(t => t.nota_numero);
  if (notas.length === 1 && l.length === 1) return (comNF ? 'a NF ' : 'a ') + notas[0] + ', vencida em ' + datas[0];
  if (notas.length === 1) return (comNF ? 'a NF ' : 'a ') + notas[0] + ', com parcelas vencidas em ' + juntaE(datas);
  return (comNF ? 'as NF ' : 'as notas ') + juntaE(notas) + ', vencidas em ' + juntaE(datas);
}

// Texto do aviso (WhatsApp e e-mail). {{1}} cliente · {{2}} vendedor(a) · {{3}} notas e vencimentos · {{4}} valor ·
// {{5}} prazo. Cordial: o aviso é um só, então já diz do cartório, mas abre a porta para negociar com a vendedora.
export const CORPO = (empresa) => 'Olá, {{1}}! Aqui é {{2}}, da ' + empresa + '.\n\n' +
  'Consta em aberto {{3}}, no valor de {{4}}. Sabemos que imprevistos acontecem e queremos muito ajudar.\n\n' +
  'Pedimos, por gentileza, a regularização até {{5}}. Infelizmente, sem o pagamento até essa data, o título seguirá automaticamente para o cartório, e gostaríamos muito de evitar esse transtorno para você.\n\n' +
  'Se precisar do boleto atualizado ou quiser combinar o pagamento, fale comigo pelo botão abaixo. Se já tiver pago, por favor desconsidere e toque em "Já paguei". Agradecemos a parceria!';
export function parametros({ cliente, vendedora, titulos, valor, prazo }) {
  return [cliente || 'tudo bem', vendedora || 'o financeiro', docsTexto(titulos), moeda(valor), diaLongo(prazo)];
}
export function textoFinal(corpo, p) { return corpo.replace(/\{\{(\d)\}\}/g, (_, n) => p[Number(n) - 1] || ''); }
// no e-mail não há botão: o fim do texto troca para responder o e-mail
export function textoEmail(corpo, p, tel) {
  return textoFinal(corpo, p)
    .replace('fale comigo pelo botão abaixo', 'é só responder este e-mail' + (tel ? ' ou me chamar no WhatsApp ' + tel : ''))
    .replace(' e toque em "Já paguei"', '');
}

// Avisos com o prazo vencido sem resposta: hora de o administrador decidir o cartório. Só os que ainda têm título aberto
// fora do cartório (o que foi pago some da lista; o que já foi ao cartório não precisa de alerta).
export function alertasCartorio({ avisos, titulos, hoje }) {
  const abertos = new Map();
  for (const t of titulos || []) if (!t.cartorio_em) abertos.set(chave(t.empresa_id, t.duplicata), t);
  return (avisos || []).filter(a => a.prazo && String(a.prazo) < hoje && !a.alerta_em && !a.pagou_em)
    .map(a => Object.assign({}, a, { abertos: (a.duplicatas || []).map(d => abertos.get(chave(a.empresa_id, d))).filter(Boolean) }))
    .filter(a => a.abertos.length);
}

export const telWa = v => {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.length >= 12 && d.length <= 13 ? d : '';
};
// celulares do cliente para o WhatsApp: WhatsApp e celular dos contatos e da empresa, sem repetir (fixo não recebe)
export function celularesDoCliente(empresa, contatos) {
  const l = [];
  const poe = v => { const t = telWa(v); if (/^55\d{2}9\d{8}$/.test(t) && l.indexOf(t) === -1) l.push(t); };
  for (const c of contatos || []) { poe(c.whatsapp); poe(c.celular); poe(c.telefone); }
  if (empresa) { poe(empresa.whatsapp); poe(empresa.telefone); }
  return l;
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function emailsDoCliente(empresa, contatos) {
  const l = [];
  const poe = v => String(v || '').split(/[;,\s]+/).forEach(x => { const e = x.trim().toLowerCase(); if (EMAIL.test(e) && l.indexOf(e) === -1) l.push(e); });
  if (empresa) poe(empresa.email);
  for (const c of contatos || []) poe(c.email);
  return l.slice(0, 5);
}
