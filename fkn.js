/* CRM Sistemi Dalessi — leitores dos arquivos do FKN (SIFWin), puros (sem tela).
   Usados pela tela (Compras, Gestão) e pela Edge Function crm-notas, que os baixa do GitHub num
   commit fixo junto com regras.js e nfe.js (o vigia manda os CSV salvos pelo FKN).
   - Estoque: CSV simples (exp_estoque.csv) ou a Listagem cadastral de produtos (SIFN108).
   - Contas a receber por cliente, em aberto (SIFN016).
   Depois de mexer aqui: commit + push, node ferramentas/fixa-motor-notas.js e publicar a função. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  const digitos = v => String(v == null ? '' : v).replace(/\D/g, '');

  // ------------------------------------------------------------ estoque (CSV do FKN)
  // Cabeçalho reconhecido pelo nome (CODIGO; NOME DO PRODUTO; UNIDADE; LOCALIZAÇÃO; CUSTO; ESTOQUE).
  // Código "010503.0" do FKN = "010503" da nota. CUSTO é o custo total do saldo.
  function lerEstoque(texto) {
    const linhas = R.csvParse(texto).filter(l => l.some(c => String(c == null ? '' : c).trim()));
    if (linhas.length < 2) throw new Error('o arquivo está vazio');
    const cab = linhas[0].map(c => R.normaliza(c));
    const col = (...nomes) => { for (const n of nomes) { const i = cab.findIndex(c => c === n || c.startsWith(n + ' ')); if (i !== -1) return i; } return -1; };
    const iCod = col('codigo', 'cod'), iDesc = col('nome do produto', 'descricao', 'produto', 'nome'), iUn = col('unidade', 'un'),
      iLoc = col('localizacao', 'local'), iCusto = col('custo', 'custo total'), iQtd = col('estoque', 'saldo', 'quantidade', 'qtd');
    if (iCod < 0 || iQtd < 0) throw new Error('não achei as colunas CÓDIGO e ESTOQUE no cabeçalho do arquivo');
    const m = new Map();
    linhas.slice(1).forEach(l => {
      const codigo = codigoFKN(l[iCod]);
      if (!codigo) return;
      const txt = i => (i >= 0 && l[i] != null ? String(l[i]).trim() : '');
      m.set(codigo, { codigo, descricao: txt(iDesc) || codigo, unidade: txt(iUn) || null, localizacao: txt(iLoc) || null,
        quantidade: R.numeroBR(l[iQtd]) || 0, custo_total: iCusto >= 0 ? R.numeroBR(l[iCusto]) || 0 : 0 });
    });
    return [...m.values()];
  }
  const codigoFKN = v => String(v == null ? '' : v).trim().replace(/\.0+$/, '');

  // Listagem cadastral de produtos do FKN (SIFN108, salva em CSV): um bloco por produto, com
  // estoque mínimo/máximo, saldo, pendências, custos, fornecedor, linha e família. A variante 1
  // (caixa fechada do mesmo código) vira "000044.1", como no CSV de estoque. O saldo do FKN já
  // desconta o que está reservado para cliente (saldo = atual − pendente de cliente).
  const ehListagemProdutos = t => /LISTAGEM CADASTRAL DE PRODUTOS|ESTOQUE:;\s*m[ií]n:/i.test(String(t).slice(0, 5000));
  function lerListagemProdutos(texto) {
    const n = v => R.numeroBR(v) || 0;
    const data = v => { const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(String(v || '').trim()); return m && m[1] !== '00' ? m[3] + '-' + m[2] + '-' + m[1] : null; };
    const out = new Map();
    let p = null;
    String(texto).split(/\r?\n/).forEach(l => {
      let m = /^(\d{3,});(\d);([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);?\s*$/.exec(l);
      if (m) {
        p = { codigo: m[1] + (m[2] === '0' ? '' : '.' + m[2]), descricao: m[3].trim() || m[1], situacao: m[5].trim() || null, linha: m[6].trim() || null, familia: m[7].trim() || null };
        out.set(p.codigo, p);
        return;
      }
      if (!p) return;
      if ((m = /ESTOQUE:;\s*m[ií]n:\s*([-\d.,]+);\s*m[aá]x:\s*([-\d.,]+);\s*atual:\s*([-\d.,]+);\s*saldo:\s*([-\d.,]+);\s*PEND:\s*cli:\s*([-\d.,]+);\s*for:\s*([-\d.,]+)/i.exec(l)))
        Object.assign(p, { estoque_min: n(m[1]), estoque_max: n(m[2]), quantidade: n(m[4]), pend_cliente: n(m[5]), pend_fornecedor: n(m[6]) });
      else if ((m = /comp:\s*([-\d.,]+);\s*cus:\s*([-\d.,]+);\s*ven:\s*([-\d.,]+)/i.exec(l)))
        Object.assign(p, { custo_compra: n(m[1]), custo_unit: n(m[2]), preco_venda: n(m[3]) });
      else if ((m = /Fornecedor:\s*(\d+)\s*([^;]*)/i.exec(l)))
        Object.assign(p, { fornecedor_cod: /^0+$/.test(m[1]) ? null : m[1], fornecedor: /^0+$/.test(m[1]) ? null : m[2].trim() || null });
      else if ((m = /localiz:([^;]*)/i.exec(l))) p.localizacao = m[1].trim() || null;
      else if ((m = /[úu]lt\.entrada:\s*([\d/]+)\s+[úu]lt\.sa[íi]da:\s*([\d/]+)/i.exec(l))) Object.assign(p, { ult_entrada: data(m[1]), ult_saida: data(m[2]) });
    });
    const lista = [...out.values()].filter(x => x.quantidade != null);
    if (!lista.length) throw new Error('não achei produtos na listagem (é a "Listagem cadastral de produtos" do FKN salva em CSV?)');
    // Entra o que está ativo e o inativo que ainda tem saldo ou pedido em aberto.
    return lista.filter(x => x.situacao !== 'INATIVO' || x.quantidade || x.pend_fornecedor).map(x => Object.assign(x, {
      custo_total: x.quantidade > 0 ? Math.round(x.quantidade * (x.custo_unit || 0) * 100) / 100 : 0 }));
  }
  // Qualquer um dos dois arquivos do FKN: listagem cadastral (completa) ou o CSV simples de estoque.
  const lerArquivoEstoque = t => (ehListagemProdutos(t) ? lerListagemProdutos(t) : lerEstoque(t));


  // ------------------------------------------------------------ contas a receber (SIFN016)
  // "28/09/26" ou "28/09/2026" → "2026-09-28"; "00/00/0000" → null.
  function dataFKN(v) {
    const m = /^(\d\d)\/(\d\d)\/(\d\d|\d{4})$/.exec(String(v || '').trim());
    if (!m || m[1] === '00') return null;
    return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[2] + '-' + m[1];
  }

  const ehContasReceber = t => /CONTAS A RECEBER/i.test(String(t).slice(0, 3000));
  function lerContasReceber(texto) {
    if (!ehContasReceber(texto)) throw new Error('não parece a listagem de contas a receber do FKN (Contas a receber por cliente, salva em CSV)');
    let cli = null, posicao = null, hora = null, totalGeral = null, vencidoGeral = null;
    const porDup = new Map();
    String(texto).split(/\r?\n/).forEach(l => {
      let m;
      if (!posicao && (m = /^;DATA:\s*(\d\d\/\d\d\/\d{4})/.exec(l))) { posicao = dataFKN(m[1]); return; }
      if (!hora && (m = /;(\d\d:\d\d);\s*$/.exec(l))) hora = m[1];
      if ((m = /^CLIENTE:\s*(\d+)\s+([^;]*);(?:TEL:([^;]*);)?(?:VEND:\s*([^;]*);)?/.exec(l))) {
        cli = { codigo: m[1], nome: m[2].trim(), vendedor: (m[4] || '').trim(), doc: '' };
        return;
      }
      if (cli && (m = /^(?:CNPJ|CPF)\.*:\s*([\d./-]+)/.exec(l))) { cli.doc = digitos(m[1]); return; }
      if ((m = /^\s*(\d+)\/(\d+)([^;]*);\s*(\d\d\/\d\d\/\d\d(?:\d\d)?);\s*([-\d.,]+);\s*(\d\d\/\d\d\/\d\d(?:\d\d)?);\s*(\d*);([^;]*)/.exec(l))) {
        if (!cli) return;
        let dup = m[1] + '/' + m[2];
        if (porDup.has(dup)) dup += '-' + cli.codigo; // mesmo número em clientes diferentes (raro)
        porDup.set(dup, { duplicata: dup, nota_numero: +m[1], parcela: +m[2], abono: /!/.test(m[3]),
          cliente_codigo: cli.codigo, cliente_nome: cli.nome || null, cliente_doc: cli.doc || null, vendedor_nome: cli.vendedor || null,
          emitida_em: dataFKN(m[4]), vencimento: dataFKN(m[6]), valor: R.numeroBR(m[5]) || 0, portador: m[8].trim() || null });
        return;
      }
      if ((m = /TOTAL GERAL[.\s]*:;\s*([-\d.,]+)/.exec(l))) totalGeral = R.numeroBR(m[1]);
      else if (totalGeral != null && vencidoGeral == null && (m = /VENCIDO:;\s*([-\d.,]+)/.exec(l))) vencidoGeral = R.numeroBR(m[1]);
    });
    const titulos = [...porDup.values()].filter(t => t.vencimento);
    if (!titulos.length) throw new Error('não achei títulos na listagem (use "Em aberto" e salve em CSV)');
    const soma = Math.round(titulos.reduce((s, t) => s + t.valor, 0) * 100) / 100;
    return { posicao, hora, titulos, soma, totalGeral, vencidoGeral, confere: totalGeral == null || Math.abs(soma - totalGeral) < 0.02,
      clientes: new Set(titulos.map(t => t.cliente_codigo)).size };
  }

  // Cliente do CRM de cada título: a nota de mesmo número e mesmo CNPJ (a mais certa); senão o
  // cadastro com o CNPJ (havendo mais de um, o que tem notas). Sem nenhum, fica sem cliente.
  function ligaEmpresas(titulos, D, ix) {
    const notasNum = new Map();
    (D.notas || []).forEach(n => { if (n.numero != null && n.empresa_id) { const k = String(+n.numero); if (!notasNum.has(k)) notasNum.set(k, []); notasNum.get(k).push(n); } });
    const porDoc = new Map();
    (D.empresas || []).forEach(e => { const d = digitos(e.cnpj); if (d.length >= 11) { if (!porDoc.has(d)) porDoc.set(d, []); porDoc.get(d).push(e); } });
    const nNotas = e => ((ix && ix.porEmpresa && ix.porEmpresa.notas.get(e.id)) || []).length;
    let pelaNota = 0, peloDoc = 0, sem = 0;
    const out = titulos.map(t => {
      const doc = digitos(t.cliente_doc);
      const n = (notasNum.get(String(t.nota_numero)) || []).find(x => !doc || digitos(x.cliente_doc) === doc);
      let empresa_id = n ? n.empresa_id : null;
      if (empresa_id) pelaNota++;
      else {
        const l = porDoc.get(doc) || [];
        const e = l.slice().sort((a, b) => nNotas(b) - nNotas(a) || (a.grupo_id ? 1 : 0) - (b.grupo_id ? 1 : 0))[0];
        if (e) { empresa_id = e.id; peloDoc++; } else sem++;
      }
      return Object.assign({}, t, { empresa_id });
    });
    return { titulos: out, pelaNota, peloDoc, sem };
  }


  // ------------------------------------------------------------ conferência do relatório
  // O relatório é puxado à mão no FKN: opção esquecida = dado faltando. "recusa" = não troca o que
  // já está no CRM (diz o que marcar); "avisos" = entra, mas falta um detalhe. Mesmas regras na
  // tela e na Edge Function (o vigia).
  const conta = (t, re) => (String(t).match(re) || []).length;
  function conferirListagemProdutos(texto) {
    const t = String(texto), recusa = [], avisos = [];
    const blocos = conta(t, /^\d{3,};\d;/gm);
    if (!blocos) recusa.push('não achei produtos: é a "Listagem cadastral de produtos" salva em CSV?');
    else {
      const falta = (re, nome) => conta(t, re) < blocos * 0.9;
      if (falta(/ESTOQUE:;\s*m[ií]n:/gi)) recusa.push('marque "Estoque/pendências" em Listar dados');
      if (falta(/comp:\s*[-\d.,]+;\s*cus:/gi)) recusa.push('marque "Índices/preços" em Listar dados');
      if (falta(/Fornecedor:\s*\d+/gi)) recusa.push('marque "Fornecedor" em Listar dados');
      if (falta(/[úu]lt\.entrada:/gi)) avisos.push('"Movimentação (datas)" não veio marcado (última entrada e saída ficam em branco)');
      if (falta(/localiz:/gi)) avisos.push('"Localização" não veio marcado');
      if (!/;\s*INATIVO\s*;/i.test(t)) avisos.push('não veio nenhum produto inativo: confira se "Situação" está 0 (todos)');
    }
    return { recusa, avisos, produtos: blocos };
  }
  function conferirContasReceber(texto, lido) {
    const t = String(texto), recusa = [], avisos = [];
    const cab = (/^.*CONTAS A RECEBER[^\n]*/im.exec(t) || [''])[0];
    if (!/EM ABERTO/i.test(cab)) recusa.push('em "Listar títulos" escolha "Em aberto"');
    const per = /VENCTO\s*EM:\s*(\d\d\/\d\d\/\d{4})\s*A\s*(\d\d\/\d\d\/\d{4})/i.exec(cab);
    if (per && !(/^00\/00/.test(per[1]) && /^00\/00/.test(per[2]))) recusa.push('deixe o período de vencimento em branco (veio ' + per[1] + ' a ' + per[2] + ')');
    const l = (lido && lido.titulos) || [];
    if (l.length && l.filter(x => !x.cliente_doc).length > l.length / 2) recusa.push('marque "Listar os dados cadastrais dos clientes" (é o que traz o CNPJ)');
    if (lido && lido.totalGeral == null) recusa.push('o arquivo veio sem o TOTAL GERAL no fim: salve com "Tudo" (não só a página)');
    else if (lido && !lido.confere) recusa.push('a soma dos títulos não bate com o TOTAL GERAL: gere de novo');
    return { recusa, avisos };
  }

  const api = { lerEstoque, lerListagemProdutos, lerArquivoEstoque, ehListagemProdutos, codigoFKN, lerContasReceber, ehContasReceber, ligaEmpresas, dataFKN,
    conferirListagemProdutos, conferirContasReceber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.CRMFkn = api;
})(typeof window !== 'undefined' ? window : globalThis);
