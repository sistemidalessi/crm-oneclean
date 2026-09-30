/* CRM Sistemi Dalessi — notas fiscais (NF-e / NFC-e) importadas do XML.
   - lerXml(texto): um XML (nfeProc, NFe ou evento de cancelamento) -> documento normalizado;
   - planeja(D, docs, op): mesmo formato de plano do importador (criar / atualizar / ignorados),
     ligando cada nota à empresa por CNPJ, razão social ou nome, completando o CNPJ que faltar,
     criando o cliente que ainda não existe e (opcional) o produto no catálogo.
   Sem duplicar: a chave de 44 dígitos da nota é única no banco.
   Puro: sem DOM e sem banco (o XML da NF-e é gerado por máquina e regular; regex basta).
   Testado em testes/nfe.test.js. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  const uuid = () => (raiz.CRMDados ? raiz.CRMDados.uuid() : require('crypto').randomUUID());

  // ------------------------------------------------------------ leitura do XML
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const desescapa = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] !== '#' ? (ENT[e] != null ? ENT[e] : m)
      : String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
  const PREF = '(?:[\\w-]+:)?'; // prefixo de namespace opcional (nfe:, ns0:)
  function blocos(xml, tag) {
    const re = new RegExp('<' + PREF + tag + '(\\s[^>]*)?>([\\s\\S]*?)</' + PREF + tag + '>', 'g');
    const out = [];
    let m;
    while ((m = re.exec(xml || ''))) out.push({ attrs: m[1] || '', corpo: m[2] });
    return out;
  }
  const bloco = (xml, tag) => { const b = blocos(xml, tag)[0]; return b ? b.corpo : ''; };
  function valor(xml, tag) {
    const m = new RegExp('<' + PREF + tag + '(?:\\s[^>]*)?>([^<]*)</' + PREF + tag + '>').exec(xml || '');
    return m ? desescapa(m[1]).trim() : '';
  }
  const atributo = (attrs, nome) => { const m = new RegExp('\\b' + nome + '="([^"]*)"').exec(attrs || ''); return m ? m[1] : ''; };
  const numero = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const arred = v => Math.round(v * 100) / 100;
  const tem = (xml, tag) => new RegExp('<' + PREF + tag + '[\\s>]').test(xml);

  function lerXml(texto) {
    const x = String(texto || '').replace(/^﻿/, '');
    // Evento de cancelamento: procEventoNFe / evento com tpEvento 110111.
    if (!tem(x, 'infNFe') && tem(x, 'infEvento')) {
      if (valor(x, 'tpEvento') !== '110111') return null;
      const ret = bloco(x, 'retEvento');
      const st = ret ? valor(bloco(ret, 'infEvento') || ret, 'cStat') : '';
      if (st && ['135', '136', '155'].indexOf(st) === -1) return null; // evento recusado pela SEFAZ
      const chave = valor(bloco(x, 'infEvento'), 'chNFe');
      return /^\d{44}$/.test(chave) ? { tipo: 'cancelamento', chave } : null;
    }
    const inf = blocos(x, 'infNFe')[0];
    if (!inf) return null;
    const c = inf.corpo;
    const prot = bloco(x, 'infProt');
    const chave = atributo(inf.attrs, 'Id').replace(/^NFe/, '') || valor(prot, 'chNFe');
    const ide = bloco(c, 'ide'), emit = bloco(c, 'emit'), dest = bloco(c, 'dest');
    const tot = bloco(bloco(c, 'total'), 'ICMSTot');
    const end = bloco(dest, 'enderDest');
    const st = prot ? valor(prot, 'cStat') : '';
    const dia = valor(ide, 'dEmi');
    const itens = blocos(c, 'det').map((d, i) => {
      const p = bloco(d.corpo, 'prod');
      return {
        ordem: Number(atributo(d.attrs, 'nItem')) || i + 1,
        codigo: valor(p, 'cProd') || null, descricao: valor(p, 'xProd') || 'Item', ncm: valor(p, 'NCM') || null,
        cfop: valor(p, 'CFOP') || null, unidade: valor(p, 'uCom') || null,
        quantidade: numero(valor(p, 'qCom')), valor_unitario: numero(valor(p, 'vUnCom')),
        valor_total: arred(numero(valor(p, 'vProd')) - numero(valor(p, 'vDesc')))
      };
    });
    return {
      tipo: 'nota', chave, modelo: valor(ide, 'mod'), numero: Number(valor(ide, 'nNF')) || null, serie: valor(ide, 'serie') || null,
      emitida_em: valor(ide, 'dhEmi') || (dia ? dia + 'T12:00:00-03:00' : null),
      natureza: valor(ide, 'natOp') || null, saida: valor(ide, 'tpNF') !== '0', finalidade: valor(ide, 'finNFe') || '1',
      autorizada: !prot || st === '100' || st === '150', situacao_sefaz: st,
      emitente: { doc: R.digitos(valor(emit, 'CNPJ') || valor(emit, 'CPF')), nome: valor(emit, 'xNome') },
      cliente: {
        doc: R.digitos(valor(dest, 'CNPJ') || valor(dest, 'CPF')), nome: valor(dest, 'xNome'), email: valor(dest, 'email'),
        telefone: valor(end, 'fone'), cep: valor(end, 'CEP'), logradouro: valor(end, 'xLgr'), numero: valor(end, 'nro'),
        complemento: valor(end, 'xCpl'), bairro: valor(end, 'xBairro'), cidade: valor(end, 'xMun'), uf: valor(end, 'UF')
      },
      valor_produtos: numero(valor(tot, 'vProd')), valor_total: numero(valor(tot, 'vNF')), itens
    };
  }

  // ------------------------------------------------------------ planejamento
  // op: { responsavelPadrao, cadastrarProdutos (padrão sim), cnpjEmpresa (padrão: o emitente mais frequente) }
  function planeja(D, docs, op) {
    op = op || {};
    const texto = v => (v == null || String(v).trim() === '' ? null : String(v).trim());
    const plano = { criar: { opcoes: [], produtos: [], empresas: [], notas: [], nota_itens: [] }, atualizar: [], contagem: {}, ignorados: [], semResponsavel: [] };
    const conta = (t, k) => { plano.contagem[t] = plano.contagem[t] || { criados: 0, atualizados: 0, ignorados: 0 }; plano.contagem[t][k]++; };
    const resumo = { lidas: 0, novas: 0, valor: 0, de: null, ate: null, jaImportadas: 0, canceladas: 0, deOutraEmpresa: 0, entradas: 0,
      devolucoes: 0, naoAutorizadas: 0, empresasLigadas: 0, empresasNovas: 0, cnpjsCompletados: 0, produtosNovos: 0, emitente: null };
    plano.resumoNotas = resumo;
    const ignora = (d, motivo) => {
      conta('notas', 'ignorados');
      plano.ignorados.push({ tipo: 'notas', linha: d.numero || '', motivo, registro: { chave: d.chave, numero: d.numero, emitida_em: d.emitida_em, cliente: d.cliente && d.cliente.nome } });
    };

    const notas = [], cancelar = new Set(), vistas = new Set();
    (docs || []).forEach(d => {
      if (!d) return;
      if (d.tipo === 'cancelamento') { cancelar.add(d.chave); return; }
      if (d.tipo !== 'nota' || !/^\d{44}$/.test(d.chave || '') || vistas.has(d.chave)) return;
      vistas.add(d.chave); notas.push(d);
    });
    resumo.lidas = notas.length;

    // Emitente = a própria empresa (o CNPJ que mais aparece como emitente nas notas de saída).
    const freq = new Map();
    notas.filter(d => d.saida && d.emitente.doc).forEach(d => freq.set(d.emitente.doc, (freq.get(d.emitente.doc) || 0) + 1));
    const principal = R.digitos(op.cnpjEmpresa) || [...freq.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || null;
    if (principal) { const d = notas.find(n => n.emitente.doc === principal); resumo.emitente = { doc: R.formataCNPJ(principal), nome: d ? d.emitente.nome : '' }; }

    // Notas já no banco: não duplica; cancelamento novo só marca.
    const existentes = new Map((D.notas || []).map(n => [n.chave, n]));
    cancelar.forEach(ch => {
      const ex = existentes.get(ch);
      if (ex && !ex.cancelada) { plano.atualizar.push({ tabela: 'notas', id: ex.id, patch: { cancelada: true } }); conta('notas', 'atualizados'); resumo.canceladas++; }
    });

    // ---- empresas: por CNPJ/CPF, razão social, nome e nome antes do " | " (o Agendor da OneClean usa "Empresa | Contato").
    const porDoc = new Map(), porNome = new Map();
    const guarda = (m, k, e) => { if (k && !m.has(k)) m.set(k, e); };
    const indexaEmpresa = e => {
      const d = R.digitos(e.cnpj); if (d.length === 11 || d.length === 14) guarda(porDoc, d, e);
      [e.razao_social, e.nome, e.nome && e.nome.indexOf('|') > 0 ? e.nome.split('|')[0] : null].forEach(n => guarda(porNome, R.chaveNome(n), e));
    };
    (D.empresas || []).forEach(indexaEmpresa);
    const novas = new Set(), ligadas = new Set(), patches = new Map();
    const completa = (e, campos) => {
      if (novas.has(e.id)) { Object.keys(campos).forEach(k => { if (e[k] == null || e[k] === '') e[k] = campos[k]; }); return; }
      const p = patches.get(e.id) || {};
      Object.keys(campos).forEach(k => { const v = campos[k]; if (v != null && v !== '' && (e[k] == null || e[k] === '') && p[k] == null) p[k] = v; });
      patches.set(e.id, p);
    };
    const segmentos = new Set((D.opcoes || []).filter(o => o.tipo === 'segmento').map(o => o.nome));
    function empresaDaNota(d) {
      const c = d.cliente, doc = c.doc;
      let e = ((doc.length === 11 || doc.length === 14) && porDoc.get(doc)) || porNome.get(R.chaveNome(c.nome)) || null;
      if (e) {
        if (novas.has(e.id)) { completa(e, { cnpj: doc ? R.formataCNPJ(doc) : null }); return e; }
        if (!ligadas.has(e.id)) { ligadas.add(e.id); resumo.empresasLigadas++; }
        const tinhaCnpj = !!(patches.get(e.id) || {}).cnpj;
        completa(e, { cnpj: doc ? R.formataCNPJ(doc) : null, razao_social: texto(c.nome) });
        if (!tinhaCnpj && (patches.get(e.id) || {}).cnpj) { resumo.cnpjsCompletados++; porDoc.set(doc, e); }
        if (e.situacao !== 'cliente') { const p = patches.get(e.id) || {}; p.situacao = 'cliente'; patches.set(e.id, p); }
        return e;
      }
      const segmento = R.sugereSegmento(c.nome);
      if (segmento && !segmentos.has(segmento)) {
        segmentos.add(segmento);
        plano.criar.opcoes.push({ id: uuid(), tipo: 'segmento', nome: segmento, ordem: R.NOMES_SEGMENTO.indexOf(segmento) + 1 });
        conta('opcoes', 'criados');
      }
      e = {
        id: uuid(), nome: texto(c.nome) || 'Cliente sem nome (NF ' + (d.numero || '') + ')', razao_social: texto(c.nome), cnpj: doc ? R.formataCNPJ(doc) : null,
        email: texto(c.email) && c.email.toLowerCase(), telefone: texto(c.telefone), cep: texto(c.cep), logradouro: texto(c.logradouro),
        numero: texto(c.numero), complemento: texto(c.complemento), bairro: texto(c.bairro), cidade: texto(c.cidade), uf: texto(c.uf) && c.uf.toUpperCase(),
        situacao: 'cliente', qualificacao: 0, tags: [], segmento, responsavel_id: op.responsavelPadrao || null,
        criado_em: d.emitida_em ? new Date(d.emitida_em).toISOString() : undefined
      };
      Object.keys(e).forEach(k => { if (e[k] == null || e[k] === undefined) delete e[k]; });
      plano.criar.empresas.push(e); novas.add(e.id); indexaEmpresa(e); conta('empresas', 'criados'); resumo.empresasNovas++;
      return e;
    }

    // ---- produtos do catálogo: por código e por nome
    const cadastrar = op.cadastrarProdutos !== false;
    const prodCod = new Map(), prodNome = new Map();
    const indexaProduto = p => { if (p.codigo) guarda(prodCod, R.normaliza(p.codigo), p); guarda(prodNome, R.normaliza(p.nome), p); };
    (D.produtos || []).forEach(indexaProduto);
    function produtoDo(it) {
      const p = (it.codigo && prodCod.get(R.normaliza(it.codigo))) || prodNome.get(R.normaliza(it.descricao));
      if (p || !cadastrar || !R.cfopDeVenda(it.cfop)) return p || null;
      const novo = { id: uuid(), nome: it.descricao, codigo: it.codigo || null, unidade: it.unidade || null, preco: Math.max(0, Math.round(it.valor_unitario * 100) / 100), ativo: true };
      Object.keys(novo).forEach(k => { if (novo[k] == null) delete novo[k]; });
      plano.criar.produtos.push(novo); indexaProduto(novo); conta('produtos', 'criados'); resumo.produtosNovos++;
      return novo;
    }

    notas.slice().sort((a, b) => String(a.emitida_em).localeCompare(String(b.emitida_em))).forEach(d => {
      if (existentes.has(d.chave)) { resumo.jaImportadas++; conta('notas', 'ignorados'); return; }
      if (!d.saida) { resumo.entradas++; return ignora(d, 'nota de entrada (compra)'); }
      if (principal && d.emitente.doc !== principal) { resumo.deOutraEmpresa++; return ignora(d, 'emitida por outra empresa (' + (d.emitente.nome || R.formataCNPJ(d.emitente.doc)) + ')'); }
      if (d.finalidade === '4') { resumo.devolucoes++; return ignora(d, 'nota de devolução'); }
      if (!d.autorizada) { resumo.naoAutorizadas++; return ignora(d, 'não autorizada pela SEFAZ (situação ' + d.situacao_sefaz + ')'); }
      if (!d.emitida_em || isNaN(new Date(d.emitida_em))) return ignora(d, 'sem data de emissão');
      const e = empresaDaNota(d);
      const cancelada = cancelar.has(d.chave);
      const n = {
        id: uuid(), chave: d.chave, numero: d.numero, serie: d.serie, emitida_em: new Date(d.emitida_em).toISOString(), empresa_id: e ? e.id : null,
        cliente_doc: d.cliente.doc ? R.formataCNPJ(d.cliente.doc) : null, cliente_nome: texto(d.cliente.nome), cidade: texto(d.cliente.cidade),
        uf: texto(d.cliente.uf), natureza: d.natureza, valor_produtos: d.valor_produtos, valor_total: d.valor_total, cancelada
      };
      Object.keys(n).forEach(k => { if (n[k] == null) delete n[k]; });
      plano.criar.notas.push(n); conta('notas', 'criados'); resumo.novas++;
      if (cancelada) resumo.canceladas++;
      else {
        resumo.valor += d.valor_total;
        const dia = R.diaLocal(n.emitida_em);
        if (!resumo.de || dia < resumo.de) resumo.de = dia;
        if (!resumo.ate || dia > resumo.ate) resumo.ate = dia;
      }
      d.itens.forEach(it => {
        const p = produtoDo(it);
        const item = Object.assign({ id: uuid(), nota_id: n.id, produto_id: p ? p.id : null }, it);
        Object.keys(item).forEach(k => { if (item[k] == null) delete item[k]; });
        plano.criar.nota_itens.push(item); conta('nota_itens', 'criados');
      });
    });

    patches.forEach((patch, id) => {
      if (!Object.keys(patch).length) return;
      plano.atualizar.push({ tabela: 'empresas', id, patch }); conta('empresas', 'atualizados');
    });
    resumo.valor = Math.round(resumo.valor * 100) / 100;
    return plano;
  }

  const api = { lerXml, planeja };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.CRMNfe = api;
})(typeof window !== 'undefined' ? window : globalThis);
