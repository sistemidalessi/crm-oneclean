// Pagamento de fornecedores pela API Pagamentos em Lote do BB (04/11/2026): a parte pura (sem rede nem banco), testada em
// testes/pagar-bb.test.js. Monta o corpo de cada lote (boletos, guias com código de barras e Pix), lê a resposta do banco e
// traduz a situação de cada pagamento. Campos conforme a especificação oficial (api.externo.bb.com.br/docs/v1/openapi/pagamentos-lote/1).

// conta de teste do próprio BB na homologação (coleção oficial do portal): o dinheiro de lá não existe
export const CONTA_TESTE = { agencia: 1607, conta: 99738672, dv: 'X', contrato: 731030 };
export const LIMITE = { boleto: 100, guia: 100, pix: 320 };

// data do BB: inteiro ddmmaaaa sem o zero da frente (05/11/2026 → 5112026)
export function dataBB(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return Number(d + m + a);
}
export function isoDeBB(n) {
  const s = String(n ?? '').replace(/\D/g, '');
  if (s.length < 7 || s.length > 8 || Number(s) === 0) return null;
  const p = s.padStart(8, '0');
  return p.slice(4, 8) + '-' + p.slice(2, 4) + '-' + p.slice(0, 2);
}
// o número do pagamento tem 17 dígitos e às vezes vem como número no JSON (perde os últimos dígitos no JavaScript):
// vira texto antes de ler
export function lerJson(texto) {
  const t = String(texto || '').replace(/("(?:identificadorPagamento|codigoIdentificadorPagamento|codigoPagamento|id)"\s*:\s*)(\d{16,})/g, '$1"$2"');
  try { return JSON.parse(t); } catch (_) { return null; }
}
const dig = v => String(v ?? '').replace(/\D/g, '');
// texto que o banco aceita: sem acento e sem caractere estranho
export const txt = (v, n) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .,\/&-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// valor que está no código de barras (0 quando não tem: boleto "contra apresentação" ou guia com valor de referência)
export function valorDoCodigo(codigo) {
  const c = dig(codigo);
  if (c.length !== 44) return 0;
  if (c[0] === '8') return ['6', '8'].includes(c[2]) ? Number(c.slice(4, 15)) / 100 : 0;
  return Number(c.slice(9, 19)) / 100;
}

// situação de cada pagamento (o BB responde com número ou com texto, conforme a consulta)
const NUM = { 1: 'consistente', 2: 'inconsistente', 3: 'pendente', 4: 'agendado', 5: 'pago', 6: 'rejeitado', 7: 'devolvido', 8: 'cancelado', 9: 'debitado', 10: 'bloqueado', 11: 'aguardando' };
export const ROTULO = { enviado: 'enviado ao banco', consistente: 'conferido pelo banco', inconsistente: 'com erro', pendente: 'esperando a liberação', agendado: 'agendado',
  pago: 'pago', rejeitado: 'recusado', devolvido: 'devolvido', cancelado: 'cancelado', debitado: 'debitado', bloqueado: 'bloqueado', aguardando: 'esperando saldo' };
export function estadoDe(x) {
  let chave = null;
  if (x != null && /^\d+$/.test(String(x).trim())) chave = NUM[Number(x)] || null;
  else {
    const t = String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    chave = /aguard/.test(t) ? 'aguardando' : Object.keys(ROTULO).find(k => t.startsWith(k.slice(0, 6))) || null;
  }
  if (!chave) return null;
  return { chave, ativo: !['rejeitado', 'devolvido', 'cancelado', 'inconsistente'].includes(chave), pago: ['pago', 'debitado'].includes(chave), final: ['pago', 'rejeitado', 'devolvido', 'cancelado'].includes(chave) };
}

// o que falta para a conta ir ao banco (forma e erro); fav = favorecido do Pix
export function pronto(l, fav) {
  if (!l || l.situacao !== 'aberto' || l.tipo !== 'saida') return { erro: 'não é conta a pagar em aberto' };
  if (!(Number(l.valor) > 0)) return { erro: 'conta sem valor' };
  if (l.pag_forma === 'boleto' || l.pag_forma === 'guia') {
    if (!/^\d{44}$/.test(String(l.pag_codigo || ''))) return { forma: l.pag_forma, erro: 'falta o código de barras' };
    if ((l.pag_forma === 'guia') !== (l.pag_codigo[0] === '8')) return { forma: l.pag_forma, erro: 'o código não é de ' + (l.pag_forma === 'guia' ? 'guia' : 'boleto') };
    if (l.pag_forma === 'boleto' && !/^(\d{11}|\d{14})$/.test(String(l.pag_doc || ''))) return { forma: 'boleto', erro: 'falta o CNPJ (ou CPF) do beneficiário do boleto' };
    return { forma: l.pag_forma };
  }
  if (l.pag_forma === 'pix') {
    if (!fav || fav.ativo === false) return { forma: 'pix', erro: 'falta o favorecido do Pix' };
    if (!fav.pix_tipo) return { forma: 'pix', erro: 'o favorecido está sem a chave Pix ou a conta' };
    return { forma: 'pix' };
  }
  return { erro: 'falta dizer como pagar (boleto, guia ou Pix)' };
}

const debito = (conta, ch) => ({ [ch[0]]: conta.agencia, [ch[1]]: conta.conta, [ch[2]]: String(conta.dv) });
// itens: [{ conta (o lançamento), fav, data }] já conferidos com pronto()
export function corpoBoletos(numero, conta, itens) {
  return Object.assign({ numeroRequisicao: numero, codigoContrato: conta.contrato },
    debito(conta, ['numeroAgenciaDebito', 'numeroContaCorrenteDebito', 'digitoVerificadorContaCorrenteDebito']), {
      lancamentos: itens.map(({ conta: l, data }) => {
        const valor = Math.round(Number(l.valor) * 100) / 100, nominal = valorDoCodigo(l.pag_codigo) || valor;
        const dif = Math.round((valor - nominal) * 100) / 100;
        return { numeroCodigoBarras: l.pag_codigo, dataPagamento: dataBB(data), valorPagamento: valor, descricaoPagamento: txt(l.descricao, 40) || 'Pagamento',
          codigoSeuDocumento: String(l.id || '').replace(/-/g, '').slice(0, 20), valorNominal: nominal,
          valorDesconto: dif < 0 ? -dif : 0, valorMoraMulta: dif > 0 ? dif : 0,
          codigoTipoBeneficiario: String(l.pag_doc).length === 11 ? 1 : 2, documentoBeneficiario: Number(l.pag_doc) };
      })
    });
}
export function corpoGuias(numero, conta, itens) {
  return Object.assign({ numeroRequisicao: numero, codigoContrato: conta.contrato },
    debito(conta, ['numeroAgenciaDebito', 'numeroContaCorrenteDebito', 'digitoVerificadorContaCorrenteDebito']), {
      lancamentos: itens.map(({ conta: l, data }) => ({ codigoBarras: l.pag_codigo, dataPagamento: dataBB(data), valorPagamento: Math.round(Number(l.valor) * 100) / 100,
        codigoSeuDocumento: String(l.id || '').replace(/-/g, '').slice(0, 20), descricaoPagamento: txt(l.descricao, 40) || 'Pagamento' }))
    });
}
// o favorecido do Pix: chave (telefone, e-mail, CPF/CNPJ, aleatória) ou dados bancários
export function destinoPix(f) {
  const doc = dig(f.doc), docCampo = doc.length === 11 ? { cpf: Number(doc) } : doc.length === 14 ? { cnpj: Number(doc) } : {};
  if (f.pix_tipo === 'telefone') {
    const t = dig(f.pix_chave).replace(/^55(?=\d{10,11}$)/, '');
    if (t.length !== 11) throw new Error('telefone do Pix de ' + f.nome + ' precisa ter DDD e 9 dígitos');
    return Object.assign({ formaIdentificacao: 1, dddTelefone: Number(t.slice(0, 2)), telefone: Number(t.slice(2)) }, docCampo);
  }
  if (f.pix_tipo === 'email') return Object.assign({ formaIdentificacao: 2, email: String(f.pix_chave).trim() }, docCampo);
  if (f.pix_tipo === 'documento') return Object.assign({ formaIdentificacao: 3 }, docCampo);
  if (f.pix_tipo === 'aleatoria') return Object.assign({ formaIdentificacao: 4, identificacaoAleatoria: String(f.pix_chave).trim() }, docCampo);
  if (f.pix_tipo === 'conta') return Object.assign({ formaIdentificacao: 5, numeroCOMPE: Number(f.compe), tipoConta: Number(f.tipo_conta), agencia: Number(f.agencia),
    conta: Number(dig(f.conta)), digitoVerificadorConta: String(f.conta_dv).toUpperCase() }, docCampo);
  throw new Error('favorecido sem chave Pix');
}
export function corpoPix(numero, conta, itens) {
  return Object.assign({ numeroRequisicao: numero, numeroContrato: conta.contrato }, debito(conta, ['agenciaDebito', 'contaCorrenteDebito', 'digitoVerificadorContaCorrente']), {
    tipoPagamento: 126,
    listaTransferencias: itens.map(({ conta: l, fav, data }) => Object.assign({ data: dataBB(data), valor: Math.round(Number(l.valor) * 100) / 100,
      descricaoPagamento: txt(l.descricao, 40) || 'Pagamento', descricaoPagamentoInstantaneo: txt(l.descricao, 35) }, destinoPix(fav)))
  });
}
export const CAMINHO = { boleto: '/lotes-boletos', guia: '/lotes-guias-codigo-barras', pix: '/lotes-transferencias-pix' };
export const CONSULTA = { boleto: '/boletos/', guia: '/guias-codigo-barras/', pix: '/pix/' };
export const corpoDe = (forma, n, c, itens) => (forma === 'boleto' ? corpoBoletos : forma === 'guia' ? corpoGuias : corpoPix)(n, c, itens);

// a resposta do envio: um por item, na mesma ordem
export function itensDaResposta(forma, j) {
  const l = (forma === 'pix' ? j?.listaTransferencias : j?.lancamentos) || [];
  return l.map(x => {
    const aceito = String(forma === 'pix' ? x.indicadorMovimentoAceito : x.indicadorAceite).toUpperCase() === 'S';
    const erros = (x.errorCodes || x.erros || x.errors || []).map(Number).filter(n => n > 0);
    return { aceito, identificador: String(x.codigoIdentificadorPagamento ?? x.identificadorPagamento ?? '') || null, erros };
  });
}
// a situação do lote (o lote de guias responde "codigoEstado"; os outros, "estadoRequisicao")
export const estadoDoLote = j => Number(j?.estadoRequisicao ?? j?.codigoEstado) || null;
// a consulta de um pagamento: situação, data efetiva, autenticação e o motivo da devolução
export function consultaDoItem(j) {
  if (!j) return null;
  const e = estadoDe(j.estadoPagamento);
  const dev = (j.listaDevolucao || []).map(x => Number(x.codigoMotivo)).filter(n => n > 0);
  return { estado: e, pago_em: isoDeBB(j.dataPagamento), autenticacao: String(j.codigoAutenticacaoPagamento || j.autenticacaoPagamento || '') || null, motivos: dev };
}

// separa por forma e data de pagamento, no tamanho máximo de cada lote
export function grupos(itens) {
  const m = new Map();
  for (const it of itens) {
    const k = it.forma + '|' + it.data;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  const out = [];
  for (const [k, l] of m) {
    const [forma, data] = k.split('|');
    for (let i = 0; i < l.length; i += LIMITE[forma]) out.push({ forma, data, itens: l.slice(i, i + LIMITE[forma]) });
  }
  return out;
}

// alguns códigos de erro do BB em português simples (o resto mostra o número)
export const ERROS = { 7: 'data do pagamento inválida', 9: 'valor zerado', 19: 'CNPJ inválido', 47: 'CNPJ do beneficiário inválido', 53: 'data do pagamento já passou',
  200: 'sem saldo na conta', 201: 'cancelado', 216: 'conta do favorecido inválida', 250: 'código de barras com dígito errado', 251: 'valor do boleto diferente',
  253: 'valor do documento inválido', 269: 'saldo insuficiente', 318: 'boleto não encontrado', 328: 'boleto bloqueado', 332: 'beneficiário diferente do boleto', 334: 'boleto já pago' };
export const erroTexto = n => ERROS[n] ? ERROS[n] + ' (' + n + ')' : 'erro ' + n;
