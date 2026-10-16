'use strict';
/* Do pedido do CRM para a NF-e (Fase 4): o pedido (crm_pedidos), o cliente (crm_empresas, com os dados fiscais da Fase 1),
   a regra fiscal de cada produto (crm_fiscal_produtos.regra.venda, tirada das notas do FKN) e o emitente (configuração).
   Devolve a nota no formato de nfe.js e os AVISOS: o que bloqueia a emissão (produto sem regra, cliente sem IE ou sem
   endereço, outro estado) e o que só merece conferência. Puro e testado (testes/nfe-servico.test.js). */

const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
const dig = v => String(v == null ? '' : v).replace(/\D/g, '');
const base = c => String(c || '').replace(/\.\d+$/, '');

// "28 DIAS BOLETO", "30/60/90 DIAS BOLETO", "A VISTA PIX", "A VISTA TRANSFERENCIA" → prazos em dias e a forma (tPag).
function lePagamento(texto) {
  const t = String(texto || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const vista = /\bA ?VISTA\b|\bANTECIPAD/.test(t);
  const dias = vista ? [0] : (t.match(/\d+/g) || []).map(Number).filter(n => n > 0 && n <= 365);
  const forma = /PIX/.test(t) ? '17' : /TRANSFER|DEPOSIT|\bTED\b|\bDOC\b/.test(t) ? '18' : /DINHEIRO|ESPECIE/.test(t) ? '01' : /CREDITO|CARTAO/.test(t) && !/DEBITO/.test(t) ? '03' :
    /DEBITO/.test(t) ? '04' : /BOLETO|DUPLICATA|\bDIAS\b|\bDDL\b/.test(t) || (!vista && dias.length) ? '15' : '99';
  return { dias: dias.length ? dias : [0], forma, aVista: vista || (!dias.length), texto: t.trim() };
}
const somaDias = (iso, d) => { const x = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
// Parcelas iguais; a última fica com a sobra dos centavos.
function parcelas(total, dias, emissao) {
  const n = dias.length, cada = r2(Math.floor(total / n * 100) / 100);
  return dias.map((d, i) => ({ vencimento: somaDias(emissao, d), valor: i === n - 1 ? r2(total - cada * (n - 1)) : cada }));
}

// o: { pedido, empresa, regras (obj código → linha de crm_fiscal_produtos), emitente, ambiente, serie, numero, emissao,
//      vendedorNome, cfg (dados.fiscal: indFinal, indPres, natOp, respTec, ibscbs) }
function notaDoPedido(o) {
  const p = o.pedido || {}, e = o.empresa || {}, d = p.dados || {}, cfg = o.cfg || {};
  const bloqueia = [], conferir = [];
  const docCli = String(e.cnpj || d.cliente_doc || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!docCli) bloqueia.push('cliente sem CNPJ/CPF no cadastro');
  const uf = String(e.uf || '').toUpperCase();
  if (uf && uf !== String((o.emitente && o.emitente.endereco && o.emitente.endereco.uf) || 'SP').toUpperCase()) bloqueia.push('cliente de outro estado (' + uf + '): a venda para fora de SP ainda é pelo FKN');
  if (!e.logradouro || !e.cidade || !uf || !dig(e.cep)) bloqueia.push('endereço do cliente incompleto (rua, cidade, UF e CEP)');
  if (!dig(e.codigo_municipio)) bloqueia.push('cliente sem o código IBGE do município (aba Fiscal → clientes sem dado fiscal)');
  const ind = String(e.ind_ie || (e.ie && !/ISENT/i.test(e.ie) ? '1' : docCli.length === 11 ? '9' : ''));
  if (!ind) bloqueia.push('cliente sem a situação da inscrição estadual (contribuinte, isento ou não contribuinte)');
  if (ind === '1' && !dig(e.ie)) bloqueia.push('cliente contribuinte sem a inscrição estadual');
  const itens = (p.itens || []).map((it, i) => {
    const cod = base(it.codigo), r = (o.regras || {})[cod], v = r && r.regra && r.regra.venda;
    if (!cod) { bloqueia.push('item ' + (i + 1) + ' (' + it.descricao + ') sem código de produto'); return null; }
    if (!v || !v.cfop || !v.cst_icms) { bloqueia.push('produto ' + cod + ' (' + it.descricao + ') sem regra fiscal: conferir na aba Fiscal'); return null; }
    if (!r.ncm) { bloqueia.push('produto ' + cod + ' sem NCM'); return null; }
    if (r.situacao !== 'conferido') conferir.push('produto ' + cod + ': regra fiscal ainda é proposta (não conferida)');
    (r.alertas || []).forEach(a => conferir.push('produto ' + cod + ': ' + (a.texto || a)));
    const q = num(it.quantidade), pu = num(it.preco), unid = String(it.unidade || r.unidade || 'UN').toUpperCase();
    // ICMS-ST já recolhido (CST 60): o mesmo que o FKN informa, por unidade vendida, aprendido das notas dele
    // (crm_fiscal_produtos.regra.st_ret[unidade], botão na aba Fiscal) e multiplicado pela quantidade
    let stRet = null;
    if (['60', '500'].indexOf(String(v.cst_icms)) !== -1) {
      const u = ((r.regra && r.regra.st_ret) || {})[unid];
      if (u) stRet = { vBCSTRet: r2(num(u.vBCSTRet) * q), pST: num(u.pST), vICMSSubstituto: u.vICMSSubstituto == null ? null : r2(num(u.vICMSSubstituto) * q), vICMSSTRet: r2(num(u.vICMSSTRet) * q) };
      else conferir.push('produto ' + cod + ': sem o ICMS-ST retido (' + unid + ') das notas do FKN; sai só com o CST 60 (aba Fiscal → "Aprender o ICMS-ST")');
    }
    return { codigo: cod, descricao: it.descricao, ncm: r.ncm, cest: r.cest || null, gtin: r.gtin || null, origem: r.origem == null ? 0 : r.origem,
      cfop: v.cfop, unidade: unid, quantidade: q, valorUnitario: pu, desconto: r2(q * pu * num(it.desconto) / 100),
      icms: { cst: String(v.cst_icms), aliquota: num(v.aliq_icms), stRet }, pis: { cst: String(v.cst_pis || '01'), aliquota: num(v.aliq_pis) },
      cofins: { cst: String(v.cst_cofins || '01'), aliquota: num(v.aliq_cofins) }, pedidoCliente: d.seu_pedido || null };
  }).filter(Boolean);
  if (!itens.length && !bloqueia.length) bloqueia.push('o pedido não tem itens');
  const total = r2(itens.reduce((s, it) => s + r2(it.quantidade * it.valorUnitario) - it.desconto, 0) + num(p.frete));
  const pg = lePagamento(d.pagamento);
  if (pg.forma === '99') conferir.push('forma de pagamento não reconhecida ("' + (d.pagamento || '') + '"): sai como "outros"');
  const emissao = o.emissao;
  const aPrazo = pg.forma === '15';   // boleto: sempre com parcela (à vista vence no dia)
  const duplicatas = aPrazo ? parcelas(total, pg.dias, emissao) : [];
  const vendedor = String(o.vendedorNome || '').trim().toUpperCase();
  const entregaTxt = d.entrega && d.entrega.endereco && dig(d.entrega.cep) !== dig(e.cep) ? 'LOCAL DE ENTREGA: ' + [d.entrega.endereco, d.entrega.numero, d.entrega.compl, d.entrega.bairro, d.entrega.cidade, d.entrega.uf].filter(Boolean).join(', ') : '';
  // Do jeito do FKN (XML reais de 15/10/2026): "PORTADOR: BOLETO PRAZO: 28 DIAS;LOCAL DE ENTREGA: …;VENDEDOR: SILMARA;…",
  // separado por ";" (o vigia e a comissão leem o "VENDEDOR:" daqui).
  const PORTADOR = { '15': 'BOLETO', '17': 'PIX', '18': 'TRANSFERENCIA', '01': 'DINHEIRO', '03': 'CARTAO', '04': 'CARTAO' };
  const prazo = pg.aVista ? 'A VISTA' : pg.dias.join('/') + ' DIAS';
  const infCpl = [PORTADOR[pg.forma] ? 'PORTADOR: ' + PORTADOR[pg.forma] + ' PRAZO: ' + prazo : '', entregaTxt, vendedor ? 'VENDEDOR: ' + vendedor : '', 'PEDIDO CRM: ' + (p.numero || ''),
    d.seu_pedido ? 'SEU PEDIDO: ' + d.seu_pedido : '', d.texto_nota || ''].filter(Boolean).map(x => String(x).replace(/;/g, ',')).join(';') + ';';
  // LC 224/2025 (redução dos benefícios federais): item com PIS/COFINS de alíquota zero (06) ou isento (07) continua com o
  // mesmo CST, e a nota leva este aviso nas informações de interesse do fisco (Receita, Perguntas e Respostas 34.1; o FKN põe)
  // Tributos aproximados (Lei 12.741/2012), pela tabela do IBPT que o CRM guarda (aba Fiscal), como o FKN faz:
  // por item = valor × (federal + estadual + municipal) %, federal nacional ou importado pela origem; o total vai ao fisco.
  const ib = o.ibpt || {}, soma = { fed: 0, est: 0, mun: 0 };
  let tabIbpt = null;
  const semTabela = !Object.keys(ib).length;
  if (semTabela && itens.length) conferir.push('tabela do IBPT não carregada (aba Fiscal): a nota sai sem os tributos aproximados');
  itens.forEach(it => {
    const t = ib[dig(it.ncm)];
    if (!t) { if (!semTabela) conferir.push('produto ' + it.codigo + ': NCM ' + it.ncm + ' fora da tabela do IBPT (sai sem os tributos aproximados)'); return; }
    tabIbpt = tabIbpt || t;
    const v = r2(it.quantidade * it.valorUnitario - it.desconto), importado = [1, 2, 6, 7].indexOf(Number(it.origem)) !== -1;   // estrangeira (direta ou no mercado interno)
    const f = r2(v * num(importado ? t.imp_fed : t.nac_fed) / 100), e2 = r2(v * num(t.estadual) / 100), m = r2(v * num(t.municipal) / 100);
    it.vTotTrib = r2(f + e2 + m); soma.fed += f; soma.est += e2; soma.mun += m;
  });
  if (tabIbpt && tabIbpt.vig_fim && String(emissao || '').slice(0, 10) > String(tabIbpt.vig_fim).slice(0, 10))
    conferir.push('a tabela do IBPT venceu em ' + String(tabIbpt.vig_fim).slice(0, 10).split('-').reverse().join('/') + ': carregue a nova na aba Fiscal');
  const tribTxt = tabIbpt ? 'Trib aprox R$: ' + r2(soma.fed).toFixed(2) + ' Federal, ' + r2(soma.est).toFixed(2) + ' Estadual e ' + r2(soma.mun).toFixed(2) + ' Municipal.; Fonte: ' +
    (tabIbpt.fonte || 'IBPT') + ' ' + (tabIbpt.chave || '') + ';' : '';
  const lc224 = itens.some(it => ['06', '07'].indexOf(it.pis.cst) !== -1 || ['06', '07'].indexOf(it.cofins.cst) !== -1);
  const infAdFisco = ((lc224 ? 'Operacao sujeita ao disposto na Lei Complementar no 224/2025;' : '') + tribTxt) || null;
  const transp = String(d.transportadora || 'PROPRIO').trim();
  const nota = {
    ambiente: o.ambiente, emitente: o.emitente, serie: o.serie, numero: o.numero, emissao, natOp: cfg.natOp || 'VENDA NO ESTADO',
    indFinal: cfg.indFinal == null ? 1 : cfg.indFinal, indPres: cfg.indPres == null ? 9 : cfg.indPres,
    dest: { doc: docCli, nome: e.razao_social || e.nome || d.cliente_nome, ie: e.ie, indIEDest: ind || '9', email: (String(e.email || '').split(/[\s,;]+/)[0] || null),
      endereco: { logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairro: e.bairro, cMun: e.codigo_municipio, municipio: e.cidade, uf, cep: e.cep, fone: e.telefone } },
    itens, frete: { modFrete: Number(d.frete_conta == null || d.frete_conta === '' ? 0 : d.frete_conta), valor: num(p.frete),
      transportadora: /^PROPRI/i.test(transp) ? null : { nome: transp }, volumes: num(d.volumes) > 0 ? { qVol: num(d.volumes) } : null },
    cobranca: duplicatas.length ? { numero: String(o.numero), duplicatas } : null,
    pagamento: [{ tPag: aPrazo ? '15' : pg.forma, indPag: aPrazo ? 1 : 0, valor: total, descricao: pg.forma === '99' ? (d.pagamento || 'OUTROS') : null }],
    infCpl, infAdFisco, respTec: cfg.respTec || null, ibscbs: cfg.ibscbs == null ? undefined : cfg.ibscbs
  };
  return { nota, avisos: { bloqueia: [...new Set(bloqueia)], conferir: [...new Set(conferir)] }, total };
}

module.exports = { lePagamento, parcelas, notaDoPedido };
