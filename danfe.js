/* CRM Sistemi Dalessi — DANFE (Documento Auxiliar da NF-e) gerada do XML autorizado guardado no
   bucket crm-notas-xml (14/10/2026, pedido do Anderson: o cliente pediu a cópia da nota junto do boleto
   atualizado). Layout retrato do Manual de Especificações Técnicas do DANFE: canhoto, emitente, quadro
   DANFE, código de barras CODE-128C da chave, destinatário, fatura/duplicatas, cálculo do imposto,
   transportador, produtos (continua em quantas folhas precisar) e dados adicionais.
   - ler(xml): o XML (nfeProc) -> dados da DANFE (puro);
   - code128c(digitos): larguras das barras (puro);
   - desenha(pdf, dados, op): desenha num jsPDF (unidade mm, A4 retrato) a partir da folha atual.
   Desenho em vetor (texto e barras de verdade, não imagem): fica nítido e leve.
   Testes: testes/danfe.test.js. */
(function (raiz) {
  'use strict';

  // ------------------------------------------------------------ leitura do XML (mesma ideia do nfe.js)
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const desescapa = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] !== '#' ? (ENT[e] != null ? ENT[e] : m)
      : String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
  const PREF = '(?:[\\w-]+:)?';
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
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  // ICMS/IPI vêm dentro de um grupo com o nome da tributação (ICMS00, ICMSSN102…): pega o primeiro.
  const grupo = (xml, tag) => { const m = new RegExp('<' + PREF + tag + '[A-Z0-9]*(?:\\s[^>]*)?>([\\s\\S]*?)</' + PREF + tag + '[A-Z0-9]*>').exec(xml || ''); return m ? m[1] : ''; };
  function endereco(e) {
    return { logradouro: valor(e, 'xLgr'), numero: valor(e, 'nro'), complemento: valor(e, 'xCpl'), bairro: valor(e, 'xBairro'),
      municipio: valor(e, 'xMun'), uf: valor(e, 'UF'), cep: valor(e, 'CEP'), fone: valor(e, 'fone') };
  }

  function ler(texto) {
    const x = String(texto || '').replace(/^﻿/, '');
    const inf = blocos(x, 'infNFe')[0];
    if (!inf) return null;
    const c = inf.corpo;
    const prot = bloco(x, 'infProt');
    const ide = bloco(c, 'ide'), emit = bloco(c, 'emit'), dest = bloco(c, 'dest');
    const tot = bloco(bloco(c, 'total'), 'ICMSTot');
    const transp = bloco(c, 'transp'), transporta = bloco(transp, 'transporta'), veic = bloco(transp, 'veicTransp');
    const vols = blocos(transp, 'vol').map(v => v.corpo);
    const adic = bloco(c, 'infAdic');
    const somaVol = tag => vols.reduce((s, v) => s + num(valor(v, tag)), 0);
    const primeiroVol = tag => (vols.map(v => valor(v, tag)).find(Boolean) || '');
    const dhEmi = valor(ide, 'dhEmi') || (valor(ide, 'dEmi') ? valor(ide, 'dEmi') + 'T00:00:00' : '');
    const dhSai = valor(ide, 'dhSaiEnt') || (valor(ide, 'dSaiEnt') ? valor(ide, 'dSaiEnt') + 'T' + (valor(ide, 'hSaiEnt') || '00:00:00') : '');
    return {
      chave: atributo(inf.attrs, 'Id').replace(/^NFe/, '') || valor(prot, 'chNFe'),
      numero: valor(ide, 'nNF'), serie: valor(ide, 'serie'), natureza: valor(ide, 'natOp'),
      saida: valor(ide, 'tpNF') !== '0', homologacao: valor(ide, 'tpAmb') === '2',
      emissao: dhEmi, saidaEntrada: dhSai,
      protocolo: valor(prot, 'nProt'), autorizadaEm: valor(prot, 'dhRecbto'),
      autorizada: !!prot && ['100', '150'].indexOf(valor(prot, 'cStat')) !== -1,
      emitente: { nome: valor(emit, 'xNome'), fantasia: valor(emit, 'xFant'), doc: valor(emit, 'CNPJ') || valor(emit, 'CPF'),
        ie: valor(emit, 'IE'), iest: valor(emit, 'IEST'), endereco: endereco(bloco(emit, 'enderEmit')) },
      destinatario: { nome: valor(dest, 'xNome'), doc: valor(dest, 'CNPJ') || valor(dest, 'CPF') || valor(dest, 'idEstrangeiro'),
        ie: valor(dest, 'IE'), endereco: endereco(bloco(dest, 'enderDest')) },
      duplicatas: blocos(bloco(c, 'cobr'), 'dup').map(d => ({ numero: valor(d.corpo, 'nDup'), vencimento: valor(d.corpo, 'dVenc'), valor: num(valor(d.corpo, 'vDup')) })),
      pagamentos: blocos(bloco(c, 'pag'), 'detPag').map(p => ({ forma: valor(p.corpo, 'tPag'), valor: num(valor(p.corpo, 'vPag')) })),
      totais: ['vBC', 'vICMS', 'vBCST', 'vST', 'vII', 'vICMSUFRemet', 'vFCPUFDest', 'vPIS', 'vProd', 'vFrete', 'vSeg', 'vDesc', 'vOutro', 'vIPI', 'vICMSUFDest', 'vTotTrib', 'vCOFINS', 'vNF']
        .reduce((o, k) => { o[k] = num(valor(tot, k)); return o; }, {}),
      transporte: {
        modalidade: valor(transp, 'modFrete'), nome: valor(transporta, 'xNome'), doc: valor(transporta, 'CNPJ') || valor(transporta, 'CPF'),
        ie: valor(transporta, 'IE'), endereco: valor(transporta, 'xEnder'), municipio: valor(transporta, 'xMun'), uf: valor(transporta, 'UF'),
        antt: valor(veic, 'RNTC'), placa: valor(veic, 'placa'), ufPlaca: valor(veic, 'UF'),
        quantidade: somaVol('qVol'), especie: primeiroVol('esp'), marca: primeiroVol('marca'), numeracao: primeiroVol('nVol'),
        pesoBruto: somaVol('pesoB'), pesoLiquido: somaVol('pesoL')
      },
      itens: blocos(c, 'det').map((d, i) => {
        const p = bloco(d.corpo, 'prod'), imp = bloco(d.corpo, 'imposto');
        const icms = grupo(bloco(imp, 'ICMS'), 'ICMS'), ipi = bloco(bloco(imp, 'IPI'), 'IPITrib');
        const cst = valor(icms, 'CST') || valor(icms, 'CSOSN');
        return {
          n: Number(atributo(d.attrs, 'nItem')) || i + 1, codigo: valor(p, 'cProd'), descricao: valor(p, 'xProd'),
          adicional: valor(d.corpo, 'infAdProd'), ncm: valor(p, 'NCM'), cst: valor(icms, 'orig') + cst, cfop: valor(p, 'CFOP'),
          unidade: valor(p, 'uCom'), quantidade: num(valor(p, 'qCom')), unitario: num(valor(p, 'vUnCom')), total: num(valor(p, 'vProd')),
          bcIcms: num(valor(icms, 'vBC')), icms: num(valor(icms, 'vICMS')), aliqIcms: num(valor(icms, 'pICMS')),
          ipi: num(valor(ipi, 'vIPI')), aliqIpi: num(valor(ipi, 'pIPI'))
        };
      }),
      fisco: valor(adic, 'infAdFisco'), complementar: valor(adic, 'infCpl')
    };
  }

  // ------------------------------------------------------------ código de barras CODE-128 (conjunto C)
  // Cada símbolo: 6 larguras (barra, espaço, barra…) somando 11 módulos; a parada tem 7 (13 módulos).
  const PADROES = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
    '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 ' +
    '131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 ' +
    '311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 ' +
    '142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 ' +
    '111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232').split(' ');
  const PARADA = '2331112';
  function code128c(digitos) {
    const d = String(digitos || '').replace(/\D/g, '');
    if (!d || d.length % 2) throw new Error('CODE-128C precisa de número par de dígitos');
    const vals = [105];
    for (let i = 0; i < d.length; i += 2) vals.push(Number(d.slice(i, i + 2)));
    const soma = vals.reduce((s, v, i) => s + v * (i || 1), 0);
    vals.push(soma % 103);
    return (vals.map(v => PADROES[v]).join('') + PARADA).split('').map(Number);
  }

  // ------------------------------------------------------------ formatação
  const so = v => String(v == null ? '' : v).replace(/\D/g, '');
  function milhar(v, casas) {
    const s = Math.abs(v).toFixed(casas).split('.');
    return (v < 0 ? '-' : '') + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (casas ? ',' + s[1] : '');
  }
  const n2 = v => milhar(Number(v) || 0, 2);
  const n4 = v => milhar(Number(v) || 0, 4);
  function doc(v) {
    const d = so(v);
    if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return String(v || '');
  }
  const cep = v => { const d = so(v); return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : String(v || ''); };
  function fone(v) {
    const d = so(v).replace(/^55(?=\d{10,11}$)/, '');
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return String(v || '');
  }
  // "2026-10-07T09:12:33-03:00" -> "07/10/2026" e "09:12:33" (a hora como está no XML, sem converter fuso)
  const dia = v => (/^(\d{4})-(\d{2})-(\d{2})/.test(v || '') ? v.slice(8, 10) + '/' + v.slice(5, 7) + '/' + v.slice(0, 4) : '');
  const hora = v => (/T(\d{2}:\d{2}:\d{2})/.exec(v || '') || [])[1] || '';
  const chaveFmt = v => so(v).replace(/(\d{4})(?=\d)/g, '$1 ');
  const numeroNF = v => { const d = so(v).padStart(9, '0'); return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6); };
  const FRETE = { 0: '0-Por conta do Rem', 1: '1-Por conta do Dest', 2: '2-Por conta de Terceiros', 3: '3-Próprio por conta do Rem', 4: '4-Próprio por conta do Dest', 9: '9-Sem Transporte' };
  const FORMA = { '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de crédito', '04': 'Cartão de débito', '05': 'Crédito loja', '10': 'Vale alimentação', '11': 'Vale refeição',
    '12': 'Vale presente', '13': 'Vale combustível', '15': 'Boleto bancário', '16': 'Depósito bancário', '17': 'PIX', '18': 'Transferência', '19': 'Fidelidade', '90': 'Sem pagamento', '99': 'Outros' };
  // As fontes padrão do PDF só têm o Latin-1: troca o resto (travessão, aspas curvas…) por equivalentes.
  const TROCA = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '•': '-', ' ': ' ' };
  const limpa = s => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E¡-ÿ]/g, ch => (TROCA[ch] != null ? TROCA[ch] : ''));

  // ------------------------------------------------------------ desenho
  const X = 5, W = 200, ALTO = 297, BAIXO = 292; // margem de 5 mm
  const H_CEL = 6.8, H_TIT = 3.2;

  function desenha(pdf, d, op) {
    op = op || {};
    const fonte = (tam, negrito) => { pdf.setFont('helvetica', negrito ? 'bold' : 'normal'); pdf.setFontSize(tam); };
    const largura = (t, tam) => pdf.getStringUnitWidth(t) * tam / pdf.internal.scaleFactor;
    // texto numa linha, encolhendo até 5 pt e depois cortando, para caber em w
    function cabe(t, w, tam, min) {
      t = limpa(t);
      let s = tam;
      while (s > (min || 5) && largura(t, s) > w) s -= 0.25;
      if (largura(t, s) > w) { while (t.length > 1 && largura(t + '...', s) > w) t = t.slice(0, -1); t += '...'; }
      return { t, s };
    }
    const linha = (x1, y1, x2, y2) => pdf.line(x1, y1, x2, y2);
    function caixa(x, y, w, h) { pdf.setDrawColor(0); pdf.setLineWidth(0.2); pdf.rect(x, y, w, h); }
    // célula com rótulo pequeno em cima e o valor embaixo
    function cel(x, y, w, h, rotulo, v, o) {
      o = o || {};
      caixa(x, y, w, h);
      fonte(4.6, false);
      pdf.text(cabe(rotulo, w - 1.2, 4.6, 3.8).t, x + 0.7, y + 0.6, { baseline: 'top' });
      if (v == null || v === '') return;
      const f = cabe(String(v), w - 1.6, o.tam || 7.6);
      fonte(f.s, o.negrito);
      const al = o.alinha || 'left';
      const xt = al === 'right' ? x + w - 0.8 : al === 'center' ? x + w / 2 : x + 0.8;
      pdf.text(f.t, xt, y + h - 0.9, { baseline: 'bottom', align: al });
    }
    // linha de células: [[largura, rótulo, valor, opções], ...]
    function fila(y, cels, h) {
      let x = X;
      cels.forEach(c => { cel(x, y, c[0], h || H_CEL, c[1], c[2], c[3]); x += c[0]; });
      return y + (h || H_CEL);
    }
    function titulo(y, t) { fonte(5.6, true); pdf.text(limpa(t), X, y + H_TIT - 0.6, { baseline: 'bottom' }); return y + H_TIT; }
    function quebra(t, w, tam) { fonte(tam, false); return pdf.splitTextToSize(limpa(t), w); }
    const e = d.emitente, de = d.destinatario, end = de.endereco || {}, t = d.totais || {}, tr = d.transporte || {};

    // ---- produtos: mede a altura de cada um para dividir em folhas
    const COLS = [[16, 'CÓDIGO'], [56, 'DESCRIÇÃO DO PRODUTO / SERVIÇO'], [13, 'NCM/SH'], [9, 'O/CST'], [9, 'CFOP'], [8, 'UN'], [15, 'QUANT.'],
      [15, 'VALOR UNIT.'], [15, 'VALOR TOTAL'], [13, 'B.CÁLC. ICMS'], [11, 'VALOR ICMS'], [10, 'VALOR IPI'], [5.5, 'ALÍQ. ICMS'], [4.5, 'ALÍQ. IPI']];
    const TAM_IT = 6.2, LH = 2.45;
    const itens = (d.itens || []).map(it => {
      const desc = quebra(it.descricao + (it.adicional ? ' - ' + it.adicional : ''), COLS[1][0] - 1.4, TAM_IT);
      const cod = quebra(it.codigo, COLS[0][0] - 1.4, TAM_IT);
      return { it, desc, cod, h: Math.max(desc.length, cod.length) * LH + 0.9 };
    });
    // onde começam os itens: folha 1 (canhoto, cabeçalho e os quadros; a fatura muda de altura) e as demais
    const nd = (d.duplicatas || []).length, nm = Math.min(nd, 14);
    const hFatura = nd ? Math.ceil(nm / 7) * 8.4 + (nd > nm ? 2.6 : 0) : H_CEL;
    const Y_ITENS_1 = 25.6 + 33 + 2 * H_CEL + H_TIT + 3 * H_CEL + H_TIT + hFatura + H_TIT + 2 * H_CEL + H_TIT + 3 * H_CEL + H_TIT + 5.6;
    const Y_ADIC = BAIXO - 32 - H_TIT, Y_ITENS_N = 5 + 33 + 2 * H_CEL + H_TIT + 5.6;
    const folhas = [[]];
    let usado = 0, cap = Y_ADIC - 1 - Y_ITENS_1;
    itens.forEach(x => {
      if (usado + x.h > cap && folhas[folhas.length - 1].length) { folhas.push([]); usado = 0; cap = BAIXO - Y_ITENS_N; }
      folhas[folhas.length - 1].push(x);
      usado += x.h;
    });
    const total = folhas.length;

    function marcaDagua() {
      if (!d.homologacao && d.autorizada !== false) return;
      fonte(30, true); pdf.setTextColor(200);
      pdf.text(d.marca || (d.homologacao ? 'SEM VALOR FISCAL' : 'NOTA SEM AUTORIZAÇÃO'), 105, 200, { align: 'center', angle: 30 });
      pdf.setTextColor(0);
    }

    // ---- cabeçalho (emitente, quadro DANFE, chave) — em toda folha
    function cabecalho(y, folha) {
      const h = 33;
      // emitente
      caixa(X, y, 82, h);
      fonte(4.6, false); pdf.text('IDENTIFICAÇÃO DO EMITENTE', X + 0.7, y + 0.6, { baseline: 'top' });
      let yy = y + 3.2;
      if (op.logo && op.logo.data) {
        const lh = 10, lw = Math.min(50, lh * (op.logo.proporcao || 2));
        pdf.addImage(op.logo.data, op.logo.formato || 'PNG', X + 41 - lw / 2, yy, lw, lh);
        yy += lh + 1;
      }
      const nome = quebra(e.nome, 78, op.logo ? 7.4 : 9);
      fonte(op.logo ? 7.4 : 9, true);
      nome.slice(0, 2).forEach(l => { yy += op.logo ? 2.9 : 3.6; pdf.text(l, X + 41, yy, { align: 'center' }); });
      const en = e.endereco || {};
      const linhasEnd = [
        [en.logradouro, en.numero].filter(Boolean).join(', ') + (en.complemento ? ' - ' + en.complemento : ''),
        [en.bairro, en.cep ? 'CEP ' + cep(en.cep) : ''].filter(Boolean).join(' - '),
        [en.municipio, en.uf].filter(Boolean).join(' - ') + (en.fone ? '   Fone: ' + fone(en.fone) : '')
      ].filter(Boolean);
      fonte(6.6, false);
      yy += 1;
      linhasEnd.forEach(l => { yy += 2.8; if (yy < y + h - 0.5) pdf.text(cabe(l, 79, 6.6).t, X + 41, yy, { align: 'center' }); });
      // quadro DANFE
      const xd = X + 82, wd = 34;
      caixa(xd, y, wd, h);
      fonte(12, true); pdf.text('DANFE', xd + wd / 2, y + 5, { align: 'center' });
      fonte(5.6, false);
      pdf.text(['DOCUMENTO AUXILIAR DA', 'NOTA FISCAL ELETRÔNICA'], xd + wd / 2, y + 8, { align: 'center' });
      fonte(6.4, false);
      pdf.text('0 - ENTRADA', xd + 2.5, y + 14.4); pdf.text('1 - SAÍDA', xd + 2.5, y + 17.4);
      caixa(xd + 24, y + 12.4, 6, 5.6);
      fonte(10, true); pdf.text(d.saida ? '1' : '0', xd + 27, y + 16.6, { align: 'center' });
      fonte(8, true); pdf.text('Nº ' + numeroNF(d.numero), xd + wd / 2, y + 23, { align: 'center' });
      fonte(7.4, true); pdf.text('SÉRIE ' + String(d.serie || '').padStart(3, '0'), xd + wd / 2, y + 26.6, { align: 'center' });
      fonte(7, false); pdf.text('FOLHA ' + folha + '/' + total, xd + wd / 2, y + 30.4, { align: 'center' });
      // código de barras e chave
      const xc = xd + wd, wc = W - 82 - wd;
      caixa(xc, y, wc, 14);
      const barras = code128c(d.chave), mods = barras.reduce((s, v) => s + v, 0);
      const mod = Math.min(0.3, (wc - 6) / mods), wb = mod * mods;
      let xb = xc + (wc - wb) / 2;
      pdf.setFillColor(0);
      barras.forEach((v, i) => { if (i % 2 === 0) pdf.rect(xb, y + 1.6, v * mod, 10.8, 'F'); xb += v * mod; });
      cel(xc, y + 14, wc, 7.4, 'CHAVE DE ACESSO', chaveFmt(d.chave), { tam: 7.6, negrito: true, alinha: 'center' });
      caixa(xc, y + 21.4, wc, h - 21.4);
      fonte(6.8, false);
      pdf.text(['Consulta de autenticidade no portal nacional da NF-e', 'www.nfe.fazenda.gov.br/portal', 'ou no site da Sefaz Autorizadora'], xc + wc / 2, y + 25, { align: 'center' });
      y += h;
      y = fila(y, [[116, 'NATUREZA DA OPERAÇÃO', d.natureza], [84, 'PROTOCOLO DE AUTORIZAÇÃO DE USO', d.protocolo ? d.protocolo + ' - ' + dia(d.autorizadaEm) + ' ' + hora(d.autorizadaEm) : '', { alinha: 'center' }]]);
      return fila(y, [[66, 'INSCRIÇÃO ESTADUAL', e.ie], [67, 'INSCRIÇÃO ESTADUAL DO SUBST. TRIBUT.', e.iest], [67, 'CNPJ / CPF', doc(e.doc)]]);
    }

    function produtos(y, lista, ate) {
      y = titulo(y, 'DADOS DOS PRODUTOS / SERVIÇOS');
      const hc = 5.6;
      let x = X;
      COLS.forEach(c => {
        caixa(x, y, c[0], hc);
        fonte(4.4, false);
        const l = pdf.splitTextToSize(c[1], c[0] - 0.8);
        pdf.text(l.slice(0, 2), x + c[0] / 2, y + (l.length > 1 ? 1.4 : 2.6), { align: 'center', baseline: 'top' });
        x += c[0];
      });
      y += hc;
      caixa(X, y, W, ate - y);
      x = X;
      COLS.slice(0, -1).forEach(c => { x += c[0]; linha(x, y, x, ate); });
      let yy = y + 0.4;
      lista.forEach((r, k) => {
        if (k) { pdf.setDrawColor(215); linha(X, yy - 0.2, X + W, yy - 0.2); pdf.setDrawColor(0); }
        const it = r.it, base = yy + LH;
        fonte(TAM_IT, false);
        let xc = X;
        const col = (i, texto, al) => {
          const w = COLS[i][0];
          if (Array.isArray(texto)) pdf.text(texto, xc + 0.7, base, { lineHeightFactor: LH / (TAM_IT * 0.3528) });
          else if (texto !== '') {
            const f = cabe(texto, w - 1, TAM_IT, 4.2);
            fonte(f.s, false);
            pdf.text(f.t, al === 'right' ? xc + w - 0.6 : al === 'center' ? xc + w / 2 : xc + 0.6, base, { align: al || 'left' });
            fonte(TAM_IT, false);
          }
          xc += w;
        };
        col(0, r.cod); col(1, r.desc); col(2, it.ncm, 'center'); col(3, it.cst, 'center'); col(4, it.cfop, 'center'); col(5, it.unidade, 'center');
        col(6, n4(it.quantidade), 'right'); col(7, n4(it.unitario), 'right'); col(8, n2(it.total), 'right'); col(9, n2(it.bcIcms), 'right');
        col(10, n2(it.icms), 'right'); col(11, n2(it.ipi), 'right'); col(12, it.aliqIcms ? milhar(it.aliqIcms, 2) : '0', 'right'); col(13, it.aliqIpi ? milhar(it.aliqIpi, 2) : '0', 'right');
        yy += r.h;
      });
    }

    folhas.forEach((lista, i) => {
      if (i) pdf.addPage('a4', 'portrait');
      marcaDagua();
      let y = 5;
      if (i === 0) {
        // canhoto
        const wn = 38, txt = 'RECEBEMOS DE ' + e.nome + ' OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA ABAIXO. EMISSÃO: ' + dia(d.emissao) +
          ' VALOR TOTAL: R$ ' + n2(t.vNF) + ' DESTINATÁRIO: ' + de.nome + ' - ' + [end.logradouro, end.numero].filter(Boolean).join(', ') + ' ' + (end.bairro || '') + ' ' + (end.municipio || '') + '-' + (end.uf || '');
        caixa(X, y, W - wn, 9.4);
        const l = quebra(txt, W - wn - 1.6, 5.6);
        fonte(5.6, false); pdf.text(l.slice(0, 3), X + 0.8, y + 2.6);
        caixa(X, y + 9.4, 40, 8); fonte(4.6, false); pdf.text('DATA DE RECEBIMENTO', X + 0.7, y + 10, { baseline: 'top' });
        caixa(X + 40, y + 9.4, W - wn - 40, 8); pdf.text('IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR', X + 40.7, y + 10, { baseline: 'top' });
        caixa(X + W - wn, y, wn, 17.4);
        fonte(10, true); pdf.text('NF-e', X + W - wn / 2, y + 5.4, { align: 'center' });
        fonte(8, true); pdf.text('Nº ' + numeroNF(d.numero), X + W - wn / 2, y + 10.4, { align: 'center' });
        pdf.text('SÉRIE ' + String(d.serie || '').padStart(3, '0'), X + W - wn / 2, y + 14.4, { align: 'center' });
        y += 17.4 + 1.6;
        pdf.setLineDashPattern([1, 1], 0); linha(X, y, X + W, y); pdf.setLineDashPattern([], 0);
        y += 1.6;
      }
      y = cabecalho(y, i + 1);
      if (i === 0) {
        y = titulo(y, 'DESTINATÁRIO / REMETENTE');
        y = fila(y, [[120, 'NOME / RAZÃO SOCIAL', de.nome], [45, 'CNPJ / CPF', doc(de.doc), { alinha: 'center' }], [35, 'DATA DA EMISSÃO', dia(d.emissao), { alinha: 'center' }]]);
        y = fila(y, [[90, 'ENDEREÇO', [end.logradouro, end.numero].filter(Boolean).join(', ') + (end.complemento ? ' - ' + end.complemento : '')], [45, 'BAIRRO / DISTRITO', end.bairro],
          [30, 'CEP', cep(end.cep), { alinha: 'center' }], [35, 'DATA DA SAÍDA/ENTRADA', dia(d.saidaEntrada), { alinha: 'center' }]]);
        y = fila(y, [[70, 'MUNICÍPIO', end.municipio], [35, 'FONE / FAX', fone(end.fone)], [10, 'UF', end.uf, { alinha: 'center' }], [50, 'INSCRIÇÃO ESTADUAL', de.ie],
          [35, 'HORA DA SAÍDA/ENTRADA', hora(d.saidaEntrada), { alinha: 'center' }]]);
        // fatura / duplicatas
        y = titulo(y, 'FATURA / DUPLICATA');
        const dups = d.duplicatas || [];
        if (dups.length) {
          const porLinha = 7, w = W / porLinha, mostra = dups.slice(0, porLinha * 2);
          mostra.forEach((dp, k) => {
            const xx = X + (k % porLinha) * w, yy = y + Math.floor(k / porLinha) * 8.4;
            caixa(xx, yy, w, 8.4);
            fonte(5.8, false);
            pdf.text(['Núm.', 'Venc.', 'Valor'], xx + 0.8, yy + 2.4);
            fonte(5.8, true);
            pdf.text([limpa(dp.numero), dia(dp.vencimento), 'R$ ' + n2(dp.valor)], xx + w - 0.8, yy + 2.4, { align: 'right' });
          });
          y += Math.ceil(mostra.length / porLinha) * 8.4;
          if (dups.length > mostra.length) { fonte(5.6, false); pdf.text('... e mais ' + (dups.length - mostra.length) + ' parcela(s)', X + W, y + 2.2, { align: 'right' }); y += 2.6; }
        } else {
          const pg = (d.pagamentos || []).map(p => (FORMA[p.forma] || 'Outros') + (p.valor ? ' R$ ' + n2(p.valor) : '')).join(' · ');
          y = fila(y, [[W, 'PAGAMENTO', pg || 'À vista']]);
        }
        // cálculo do imposto
        y = titulo(y, 'CÁLCULO DO IMPOSTO');
        const w9 = W / 9, R = { alinha: 'right' };
        y = fila(y, [['BASE DE CÁLC. DO ICMS', 'vBC'], ['VALOR DO ICMS', 'vICMS'], ['BASE DE CÁLC. ICMS S.T.', 'vBCST'], ['VALOR DO ICMS SUBST.', 'vST'],
          ['V. IMP. IMPORTAÇÃO', 'vII'], ['V. ICMS UF REMET.', 'vICMSUFRemet'], ['V. FCP UF DEST.', 'vFCPUFDest'], ['VALOR DO PIS', 'vPIS'], ['V. TOTAL PRODUTOS', 'vProd']]
          .map(c => [w9, c[0], n2(t[c[1]]), R]));
        y = fila(y, [['VALOR DO FRETE', 'vFrete'], ['VALOR DO SEGURO', 'vSeg'], ['DESCONTO', 'vDesc'], ['OUTRAS DESPESAS', 'vOutro'], ['VALOR TOTAL IPI', 'vIPI'],
          ['V. ICMS UF DEST.', 'vICMSUFDest'], ['V. TOT. TRIB.', 'vTotTrib'], ['VALOR DA COFINS', 'vCOFINS'], ['V. TOTAL DA NOTA', 'vNF']]
          .map(c => [w9, c[0], n2(t[c[1]]), c[1] === 'vNF' ? { alinha: 'right', negrito: true } : R]));
        // transportador
        y = titulo(y, 'TRANSPORTADOR / VOLUMES TRANSPORTADOS');
        y = fila(y, [[60, 'NOME / RAZÃO SOCIAL', tr.nome], [34, 'FRETE POR CONTA', FRETE[tr.modalidade] || tr.modalidade], [22, 'CÓDIGO ANTT', tr.antt], [22, 'PLACA DO VEÍCULO', tr.placa],
          [10, 'UF', tr.ufPlaca, { alinha: 'center' }], [52, 'CNPJ / CPF', doc(tr.doc)]]);
        y = fila(y, [[90, 'ENDEREÇO', tr.endereco], [50, 'MUNICÍPIO', tr.municipio], [10, 'UF', tr.uf, { alinha: 'center' }], [50, 'INSCRIÇÃO ESTADUAL', tr.ie]]);
        y = fila(y, [[25, 'QUANTIDADE', tr.quantidade ? milhar(tr.quantidade, 0) : '', R], [35, 'ESPÉCIE', tr.especie], [35, 'MARCA', tr.marca], [35, 'NUMERAÇÃO', tr.numeracao],
          [35, 'PESO BRUTO', tr.pesoBruto ? milhar(tr.pesoBruto, 3) : '', R], [35, 'PESO LÍQUIDO', tr.pesoLiquido ? milhar(tr.pesoLiquido, 3) : '', R]]);
        produtos(y, lista, Y_ADIC - 1);
        // dados adicionais
        let ya = titulo(Y_ADIC, 'DADOS ADICIONAIS');
        const ha = BAIXO - ya;
        cel(X, ya, 130, ha, 'INFORMAÇÕES COMPLEMENTARES', '');
        cel(X + 130, ya, 70, ha, 'RESERVADO AO FISCO', '');
        const inf = [d.fisco, d.complementar].filter(Boolean).join(' ');
        let tam = 6.2, ls = quebra(inf, 128, tam);
        while (ls.length * tam * 0.3528 * 1.15 > ha - 3.4 && tam > 4.6) { tam -= 0.2; ls = quebra(inf, 128, tam); }
        fonte(tam, false);
        pdf.text(ls, X + 0.8, ya + 3.6 + tam * 0.3528, { lineHeightFactor: 1.15 });
      } else {
        produtos(y, lista, BAIXO);
      }
    });
    return total;
  }

  const D = { ler, code128c, desenha, chaveFmt, numeroNF };
  raiz.CRMDanfe = D;
  if (typeof module !== 'undefined') module.exports = D;
})(typeof window !== 'undefined' ? window : globalThis);
