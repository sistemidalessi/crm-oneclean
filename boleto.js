/* CRM Sistemi Dalessi — boleto do Banco do Brasil emitido pelo CRM (22/10/2026, Fase 5 da saída do FKN, pedido do
   Anderson: "pode começar essa parte do boleto"). Preparação que vale tanto para a API de Cobrança do BB quanto para o
   arquivo de remessa (CNAB): nos dois caminhos quem desenha o boleto é o CRM (a API devolve só a linha digitável e o
   código de barras), e o nosso número sai da numeração do CRM.
   - Regras puras: fator de vencimento, nosso número do BB (convênio de 7 dígitos + 10 do CRM = 17), campo livre,
     código de barras (44), linha digitável (47, a mesma conferência do cobranca.js), barras ITF 2 de 5 e instruções.
   - desenha(pdf, d, op): recibo do pagador + ficha de compensação num jsPDF (mm, A4 retrato), em vetor como a DANFE.
   - Tela (só com o CRM carregado): cartão "Boleto pelo Banco do Brasil" em Configurações → Integrações (administrador):
     dados do convênio, situação e "Ver um boleto de exemplo" (sai marcado SIMULAÇÃO, não registra nada no banco).
   Enquanto boleto.ligado não é true, nada muda para a equipe: o banco recusa preparar boleto (crm_boleto_preparar).
   Testes: testes/boleto.test.js (com um boleto real do BB, de 19/10/2026). */
(function (raiz) {
  'use strict';
  const C = raiz.CRMCobranca || (typeof require !== 'undefined' ? require('./cobranca.js') : null);
  const digitos = v => String(v == null ? '' : v).replace(/\D/g, '');
  const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
  const zeros = (v, n) => { const d = digitos(v); return !d || d.length > n ? null : d.padStart(n, '0'); };

  // ---- fator de vencimento (FEBRABAN): reiniciou em 22/02/2025 com 1000 (o 9999 foi 21/02/2025) e volta a 1000
  // depois do próximo 9999. Datas antes de 22/02/2025 não se usam mais em boleto novo.
  const BASE_FATOR = Date.UTC(2025, 1, 22);
  function fatorDe(dataISO) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dataISO || ''));
    if (!m) return null;
    const dias = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - BASE_FATOR) / 864e5);
    if (dias < 0) return null;
    return String(1000 + (dias % 9000)).padStart(4, '0');
  }

  // ---- Banco do Brasil, convênio de 7 dígitos, carteira 17 (a da instalação): nosso número = convênio (7) +
  // complemento (10) = 17, sem dígito; campo livre = 000000 + nosso número + carteira.
  function nossoNumero(convenio, seq) {
    const cv = digitos(convenio), s = zeros(seq, 10);
    if (cv.length !== 7) throw new Error('o convênio de cobrança do BB tem 7 dígitos');
    if (!s || Number(s) <= 0) throw new Error('número do boleto inválido (até 10 dígitos)');
    return cv + s;
  }
  function campoLivre(nosso, carteira) {
    const n = digitos(nosso), ct = zeros(carteira, 2);
    if (n.length !== 17) throw new Error('nosso número do BB tem 17 dígitos');
    if (!ct) throw new Error('carteira inválida');
    return '000000' + n + ct;
  }
  // código de barras (44): banco(3) moeda(1) DV(1) fator(4) valor(10) campo livre(25)
  function codigoBarras(banco, vencimento, valor, livre) {
    const f = fatorDe(vencimento), cent = Math.round(r2(valor) * 100);
    if (!f) throw new Error('vencimento inválido');
    if (!(cent > 0) || cent > 9999999999) throw new Error('valor do boleto inválido');
    const l = digitos(livre);
    if (l.length !== 25) throw new Error('campo livre com ' + l.length + ' dígitos (são 25)');
    const sem = zeros(banco, 3) + '9' + f + String(cent).padStart(10, '0') + l;
    return sem.slice(0, 4) + C.mod11(sem) + sem.slice(4);
  }

  // ---- barras ITF 2 de 5 (o código do boleto): larguras em módulos (estreita 1, larga 3), começando por barra.
  const ITF = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];
  function itf(cod) {
    const c = digitos(cod);
    if (!c.length || c.length % 2) throw new Error('o ITF precisa de um número par de dígitos');
    const w = x => (x === 'w' ? 3 : 1);
    const out = [1, 1, 1, 1]; // início: barra fina, espaço fino, barra fina, espaço fino
    for (let i = 0; i < c.length; i += 2) {
      const b = ITF[+c[i]], e = ITF[+c[i + 1]];
      for (let k = 0; k < 5; k++) out.push(w(b[k]), w(e[k]));
    }
    out.push(3, 1, 1); // fim: barra larga, espaço fino, barra fina
    return out;
  }

  // ---- textos
  const moeda = v => 'R$ ' + r2(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const pct = v => (Number(v) || 0).toFixed(2).replace('.', ',') + '%';
  const dataBR = d => (/^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '');
  function docFmt(v) {
    const d = String(v == null ? '' : v).toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (d.length === 11) return d.replace(/^(.{3})(.{3})(.{3})(.{2})$/, '$1.$2.$3-$4');
    if (d.length === 14) return d.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5');
    return d;
  }
  function enderecoTexto(e) {
    if (!e) return '';
    const l1 = [e.logradouro, e.numero].filter(Boolean).join(', ') + (e.complemento ? ' - ' + e.complemento : '');
    const l2 = [e.bairro, [e.municipio || e.cidade, e.uf].filter(Boolean).join('/'), e.cep ? 'CEP ' + digitos(e.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2') : ''].filter(Boolean).join(' - ');
    return [l1, l2].filter(Boolean).join(' - ');
  }
  // Instruções ao caixa, no texto que o boleto do BB da instalação usa (modelo de 22/10/2026): juros pela taxa mensal
  // depois do vencimento, multa a partir do dia seguinte, protesto e o texto livre.
  const diaSeguinte = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1)).toISOString().slice(0, 10) : ''; };
  function instrucoes(cfg, valor, vencimento) {
    cfg = cfg || {};
    const out = [];
    const multa = Number(cfg.multa_pct) || 0, juros = Number(cfg.juros_mes_pct) || 0, prot = Math.round(Number(cfg.protesto_dias) || 0);
    if (juros > 0) out.push('JUROS: TAXA MENSAL DE ' + pct(juros) + ' APÓS ' + dataBR(vencimento));
    if (multa > 0) out.push('MULTA DE ' + pct(multa) + ' A PARTIR DE ' + dataBR(diaSeguinte(vencimento)));
    if (prot > 0) out.push('SUJEITO A PROTESTO ' + prot + ' DIAS APÓS O VENCIMENTO');
    String(cfg.instrucao || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 2).forEach(s => out.push(s));
    return out.slice(0, 5);
  }
  // Dígito do nosso número que o BB mostra no boleto ("00038048801000001399-5"): módulo 11 com pesos de 9 a 2 da
  // direita para a esquerda, dígito = resto (10 vira X). Só aparece impresso; o código de barras não usa.
  function dvNossoNumero(n) {
    const d = digitos(n);
    let soma = 0;
    for (let i = d.length - 1, k = 0; i >= 0; i--, k++) soma += +d[i] * (9 - (k % 8));
    const r = soma % 11;
    return r === 10 ? 'X' : String(r);
  }
  const nossoImpresso = n => '000' + digitos(n) + '-' + dvNossoNumero('000' + digitos(n));
  // endereço em duas linhas, como no boleto do BB: "AVENIDA SAO MIGUEL 670" e "CEP: 03620-000, SAO PAULO - SP"
  function enderecoLinhas(e) {
    if (!e) return [];
    if (typeof e === 'string') return [e];
    const l1 = [e.logradouro, e.numero, e.complemento].filter(Boolean).join(' ');
    const cep = digitos(e.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2');
    const l2 = [cep ? 'CEP: ' + cep : '', [e.municipio || e.cidade, e.uf].filter(Boolean).join(' - ')].filter(Boolean).join(', ');
    return [l1, l2].filter(Boolean).map(x => x.toUpperCase());
  }
  // O que falta no convênio para emitir (a tela mostra; montar() recusa)
  function faltaNoConvenio(cfg, emitente) {
    cfg = cfg || {};
    const f = [];
    if (digitos(cfg.convenio).length !== 7) f.push('convênio (7 dígitos)');
    if (!zeros(cfg.carteira, 2)) f.push('carteira');
    if (!String(cfg.agencia || '').trim()) f.push('agência');
    if (!String(cfg.conta || '').trim()) f.push('conta');
    if (!(emitente && emitente.cnpj && (emitente.razao || emitente.nome))) f.push('emitente (aba Fiscal)');
    return f;
  }

  // Monta tudo o que o boleto mostra. t = { valor, vencimento, seq ou nosso_numero, documento (NF e parcela),
  // emissao }; pagador = { nome, doc, endereco }; emitente = o da aba Fiscal (razao, cnpj, endereco).
  function montar(cfg, emitente, t, pagador, op) {
    op = op || {};
    const falta = faltaNoConvenio(cfg, emitente);
    if (falta.length) throw new Error('falta no convênio do boleto: ' + falta.join(', '));
    const nosso = t.nosso_numero ? digitos(t.nosso_numero) : nossoNumero(cfg.convenio, t.seq);
    if (nosso.length !== 17 || nosso.slice(0, 7) !== digitos(cfg.convenio)) throw new Error('nosso número não é deste convênio');
    const codigo = codigoBarras('001', t.vencimento, t.valor, campoLivre(nosso, cfg.carteira));
    const linha = C.linhaDeCodigo(codigo);
    const conf = C.lerLinha(linha); // a mesma conferência dos boletos que chegam do banco
    if (!conf.ok || conf.vencimento !== t.vencimento || Math.abs(conf.valor - r2(t.valor)) > 0.004) throw new Error('a linha digitável montada não confere');
    const ct = zeros(cfg.carteira, 2), vr = digitos(cfg.variacao);
    // simulação: o desenho fica igual, mas o dígito geral sai trocado de propósito — app de banco e leitor de caixa
    // recusam a linha e o código (e o exemplo nunca é registrado no banco)
    const dvSim = +codigo[4] === 9 ? 2 : +codigo[4] + 1; // o DV geral vai de 1 a 9: qualquer outro de 1 a 9 não confere
    const cod = op.simulacao ? codigo.slice(0, 4) + dvSim + codigo.slice(5) : codigo;
    const lin = op.simulacao ? C.linhaDeCodigo(cod) : linha;
    return {
      banco: '001-9', linha: lin, linhaFmt: C.formataLinha(lin), codigo: cod, nossoNumero: nosso,
      vencimento: t.vencimento, valor: r2(t.valor), documento: String(t.documento || '').slice(0, 15),
      emissao: t.emissao || op.hoje, processamento: op.hoje || t.emissao,
      carteira: ct, variacao: vr ? vr.padStart(3, '0') : '', especie: 'DM', aceite: 'N', moeda: 'R$',
      nossoImpresso: nossoImpresso(nosso),
      localPagamento: cfg.local_pagamento || 'Pagar preferencialmente nos canais de autoatendimento do Banco do Brasil',
      beneficiario: { nome: String(emitente.razao || emitente.nome || '').toUpperCase(), doc: docFmt(emitente.cnpj), endereco: enderecoLinhas(emitente.endereco) },
      agenciaCodigo: String(cfg.agencia).trim() + '/' + String(cfg.conta).trim(),
      pagador: { nome: String((pagador && pagador.nome) || '').toUpperCase(), doc: docFmt(pagador && pagador.doc), endereco: enderecoLinhas(pagador && pagador.endereco) },
      pix: t.pix || null,
      instrucoes: instrucoes(cfg, t.valor, t.vencimento),
      simulacao: !!op.simulacao
    };
  }

  // ---- desenho no modelo do boleto do BB (22/10/2026, boleto real mandado pelo Anderson): faixa amarela com o nome do
  // banco, coluna da direita em cinza com vencimento, agência/código, nosso número e valores; recibo do pagador em cima,
  // ficha de compensação embaixo, código de barras ITF no pé. A4 retrato, mm, em vetor.
  function desenha(pdf, d, op) {
    op = op || {};
    const X = 10, W = 190, DIR = 45, ESQ = W - DIR, H = 8;
    const AMARELO = [252, 239, 0], AZUL = [0, 45, 114], CINZA = 232;
    const limpa = t => String(t == null ? '' : t).replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\xFF\u20AC]/g, '');
    const fonte = (tam, negrito) => { pdf.setFont('helvetica', negrito ? 'bold' : 'normal'); pdf.setFontSize(tam); };
    const largura = (t, tam) => pdf.getStringUnitWidth(t) * tam / pdf.internal.scaleFactor;
    function cabe(t, w, tam) { t = limpa(t); let s = tam; while (s > 5 && largura(t, s) > w) s -= 0.25; while (t.length > 1 && largura(t, s) > w) t = t.slice(0, -1); return { t, s }; }
    function escreve(t, x, y, w, tam, o) { o = o || {}; const f = cabe(t, w, tam); fonte(f.s, o.negrito); pdf.text(f.t, o.direita ? x + w : x, y, { align: o.direita ? 'right' : 'left' }); }
    const rot = (t, x, y) => { fonte(5.2, false); pdf.setTextColor(70); pdf.text(limpa(t), x, y + 2); pdf.setTextColor(0); };
    // célula: rótulo pequeno em cima, valor em negrito embaixo; linha fina embaixo (sem caixa fechada, como o BB)
    function cel(x, y, w, h, r, v, o) {
      o = o || {};
      if (o.cinza) { pdf.setFillColor(CINZA); pdf.rect(x, y, w, h, 'F'); }
      if (o.amarela) { pdf.setFillColor(...AMARELO); pdf.rect(x, y, 0.9, h, 'F'); }
      pdf.setDrawColor(150); pdf.setLineWidth(0.15); pdf.line(x, y + h, x + w, y + h);
      if (o.borda !== false) pdf.line(x, y, x, y + h);
      rot(r, x + 1.2, y);
      if (v != null && v !== '') escreve(v, x + 1.6, y + h - 1.6, w - 3, o.tam || 7.8, { negrito: true, direita: o.direita });
    }
    function topo(y) {
      pdf.setFillColor(...AMARELO); pdf.rect(X, y, 50, 9, 'F');
      fonte(12.5, true); pdf.setTextColor(...AZUL); pdf.text('BANCO DO BRASIL', X + 2.5, y + 6.4); pdf.setTextColor(0);
      fonte(13, true); pdf.text(d.banco, X + 52, y + 6.6);
      pdf.setDrawColor(0); pdf.setLineWidth(0.3); pdf.line(X + 66, y + 1, X + 66, y + 9);
      escreve(d.linhaFmt, X + 67.5, y + 6.6, W - 68, 10.4);
      pdf.setLineWidth(0.4); pdf.line(X, y + 9, X + W, y + 9);
      return y + 9;
    }
    // bloco com nome + endereço (até 3 linhas) e o CNPJ à direita
    function bloco(x, y, w, h, r, nome, doc, linhas) {
      cel(x, y, w, h, r, '', { borda: false });
      fonte(5.2, false); pdf.setTextColor(70); pdf.text('CNPJ', x + w - 2, y + 2, { align: 'right' }); pdf.setTextColor(0);
      escreve(nome, x + 1.6, y + 5.4, w - 40, 7.6, { negrito: true });
      escreve(doc, x + w - 38, y + 5.4, 36, 7.6, { negrito: true, direita: true });
      (linhas || []).slice(0, 2).forEach((l, i) => escreve(l, x + 1.6, y + 8.8 + i * 3.3, w - 4, 7, { negrito: true }));
    }
    const venc = dataBR(d.vencimento), valor = moeda(d.valor).replace('R$ ', '');
    // ---------------- QR Code Pix (só quando o banco devolve o Pix do boleto; desenhado por quem chamou)
    let y = 14;
    if (d.pix && op.qr) { op.qr(pdf, X, y, 30); fonte(13, true); pdf.setTextColor(60, 90, 220); pdf.text('Pague agora com o seu Pix', X + 36, y + 14); pdf.setTextColor(0);
      fonte(7, false); pdf.text('Para efetuar o pagamento via Pix, utilize a opção Pix de seu aplicativo', X + 36, y + 19); pdf.text('e aponte a câmera do seu aparelho para o QR code ao lado.', X + 36, y + 22.5); y += 36; }
    // ---------------- aviso contra boleto falso (op.aviso, regras.js avisoGolpe), grifado em amarelo com borda vermelha
    if (op.aviso) {
      fonte(7.6, true);
      const ls = pdf.splitTextToSize(limpa(op.aviso), W - 8), ha = 4 + ls.length * 3.3;
      pdf.setFillColor(255, 241, 118); pdf.setDrawColor(200, 30, 30); pdf.setLineWidth(0.6);
      pdf.rect(X, y, W, ha, 'FD');
      pdf.setTextColor(150, 0, 0); pdf.text(ls, X + 4, y + 4.6, { lineHeightFactor: 1.2 }); pdf.setTextColor(0);
      y += ha + 3;
    }
    // ---------------- recibo do pagador
    fonte(7, true); pdf.text('Recibo do Pagador', X + W, y + 3, { align: 'right' });
    y = topo(y + 5);
    bloco(X, y, ESQ, 15, 'Nome do Pagador / Endereço', d.pagador.nome, d.pagador.doc, d.pagador.endereco);
    cel(X + ESQ, y, DIR, 7.5, 'Data de Vencimento', venc, { cinza: true, direita: true });
    cel(X + ESQ, y + 7.5, DIR, 7.5, 'Agência / Código do Beneficiário', d.agenciaCodigo, { cinza: true, direita: true });
    y += 15;
    bloco(X, y, ESQ, 15, 'Nome do Beneficiário / Endereço', d.beneficiario.nome, d.beneficiario.doc, d.beneficiario.endereco);
    cel(X + ESQ, y, DIR, 7.5, 'Nosso Número', d.nossoImpresso, { cinza: true, direita: true });
    cel(X + ESQ, y + 7.5, DIR, 7.5, '(=) Valor do Documento', valor, { cinza: true, direita: true });
    y += 15;
    [[25, 'Uso do Banco', ''], [38, 'Nr. do Documento', d.documento], [17, 'Espécie Doc.', d.especie], [10, 'Aceite', d.aceite], [ESQ - 90, 'Data Processamento', dataBR(d.processamento)]]
      .reduce((x, c) => { cel(x, y, c[0], H, c[1], c[2], { amarela: x === X }); return x + c[0]; }, X);
    cel(X + ESQ, y, DIR, H, '(=) Valor Pago', '', { amarela: true });
    y += H;
    fonte(5.6, false); pdf.text('Autenticação Mecânica', X + ESQ + 2, y + 3, { align: 'center' });
    // corte
    y += 12;
    pdf.setDrawColor(0); pdf.setLineDashPattern([1, 0.8], 0); pdf.setLineWidth(0.2); pdf.line(X + 6, y, X + W, y); pdf.setLineDashPattern([], 0);
    fonte(9, false); pdf.text('X', X + 1, y + 1.2); // tesoura
    // ---------------- ficha de compensação
    y = topo(y + 6);
    cel(X, y, ESQ, H, 'Local do Pagamento', d.localPagamento, { amarela: true });
    cel(X + ESQ, y, DIR, H, 'Data de Vencimento', venc, { cinza: true, direita: true });
    y += H;
    cel(X, y, ESQ, H, 'Nome do Beneficiário', d.beneficiario.nome, { amarela: true });
    fonte(5.2, false); pdf.setTextColor(70); pdf.text('CNPJ', X + ESQ - 2, y + 2, { align: 'right' }); pdf.setTextColor(0);
    escreve(d.beneficiario.doc, X + ESQ - 40, y + H - 1.6, 38, 7.8, { negrito: true, direita: true });
    cel(X + ESQ, y, DIR, H, 'Agência / Código do Beneficiário', d.agenciaCodigo, { cinza: true, direita: true });
    y += H;
    [[25, 'Data Documento', dataBR(d.emissao)], [38, 'Nr. do Documento', d.documento], [17, 'Espécie Doc.', d.especie], [10, 'Aceite', d.aceite], [ESQ - 90, 'Data Processamento', dataBR(d.processamento)]]
      .reduce((x, c) => { cel(x, y, c[0], H, c[1], c[2], { amarela: x === X }); return x + c[0]; }, X);
    cel(X + ESQ, y, DIR, H, 'Nosso Número', d.nossoImpresso, { cinza: true, direita: true });
    y += H;
    [[25, 'Uso do Banco', ''], [15, 'Carteira', d.carteira], [23, 'Espécie', d.moeda], [42, 'Quantidade', ''], [ESQ - 105, '(x) Valor', '']]
      .reduce((x, c) => { cel(x, y, c[0], H, c[1], c[2], { amarela: x === X }); return x + c[0]; }, X);
    cel(X + ESQ, y, DIR, H, '(=) Valor do Documento', valor, { cinza: true, direita: true });
    y += H;
    const yIns = y;
    rot('Informações de responsabilidade do Beneficiário', X + 1.2, y);
    const ins = d.instrucoes.slice();
    // na ficha, a linha curta do aviso (o banco e o caixa veem esta parte)
    if (op.aviso && ins.length < 6) ins.push('ATENÇÃO: SÓ PAGUE SE O BENEFICIÁRIO FOR ' + limpa(d.beneficiario.nome).toUpperCase() + (d.beneficiario.doc ? ' - CNPJ ' + d.beneficiario.doc : ''));
    ins.forEach((t, i) => escreve(t, X + 3, y + 6.5 + i * 3.6, ESQ - 6, 7.4, { negrito: op.aviso && i === ins.length - 1 && /^ATENÇÃO: SÓ PAGUE/.test(t) }));
    [['(-) Abatimento', ''], ['(+) Juros / Multa', ''], ['(=) Valor Cobrado', '']].forEach((c, i) => cel(X + ESQ, yIns + i * H, DIR, H, c[0], c[1], { amarela: true, cinza: i === 2 }));
    y += 3 * H + 8;
    pdf.setDrawColor(0); pdf.setLineWidth(0.4); pdf.line(X, y, X + W, y);
    bloco(X, y, ESQ, 15, 'Nome do Pagador / Endereço', d.pagador.nome, d.pagador.doc, d.pagador.endereco);
    y += 15;
    rot('Beneficiário Final', X + 1.2, y); fonte(5.2, false); pdf.setTextColor(70); pdf.text('CPF / CNPJ', X + ESQ - 2, y + 2, { align: 'right' }); pdf.setTextColor(0);
    y += 6;
    pdf.setLineWidth(0.4); pdf.line(X, y, X + W, y);
    fonte(5.8, false); pdf.text('Autenticação Mecânica - Ficha de Compensação', X + W, y + 3, { align: 'right' });
    // código de barras ITF: estreita 0,254 mm (larga 3x) = 102,9 mm por 13 mm, com margem branca à esquerda
    const barras = itf(d.codigo), mod = 0.254;
    let xb = X + 1;
    pdf.setFillColor(0);
    barras.forEach((v, i) => { if (i % 2 === 0) pdf.rect(xb, y + 1.5, v * mod, 13, 'F'); xb += v * mod; });
    if (d.simulacao || op.simulacao) {
      // translúcida (os dados continuam legíveis); o código e a linha da simulação já saem com o dígito geral trocado (montar)
      const gs = pdf.GState ? pdf.GState.bind(pdf) : null;
      if (gs) pdf.setGState(new gs({ opacity: 0.4 }));
      fonte(34, true); pdf.setTextColor(215, 60, 60);
      pdf.text('SIMULAÇÃO - SEM VALOR', 105, 75, { align: 'center', angle: 10 });
      pdf.text('SIMULAÇÃO - SEM VALOR', 105, 185, { align: 'center', angle: 10 });
      pdf.setTextColor(0);
      if (gs) pdf.setGState(new gs({ opacity: 1 }));
    }
    return y + 16;
  }

  // Aviso contra boleto falso (27/10/2026, pedido do Anderson: estão clonando os boletos e mandando aos clientes).
  // Vai na nota (informações complementares), na DANFE, no boleto, na folha de resumo e nas mensagens, grifado.
  // texto = o que o administrador gravou em Configurações (fiscal.aviso_golpe): '' desliga, ausente usa o padrão abaixo.
  // banco = '001 (Banco do Brasil)' quando a empresa só cobra por um banco (os 3 primeiros números da linha digitável).
  function foneBR(v) {
    const d = digitos(v).replace(/^55(?=\d{10,11}$)/, '');
    return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : d.length === 10 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6) : '';
  }
  function avisoGolpe(emit, texto, banco) {
    if (texto === '') return '';
    if (texto != null && String(texto).trim()) return String(texto).replace(/\s+/g, ' ').trim();
    emit = emit || {};
    const nome = String(emit.razao || emit.nome || '').trim();
    if (!nome) return '';
    const cnpj = emit.cnpj ? docFmt(emit.cnpj) : '', tel = foneBR((emit.endereco || {}).fone || emit.fone);
    return 'ATENÇÃO, GOLPE DO BOLETO FALSO: antes de pagar, confira no app do seu banco se o beneficiário é ' + nome +
      (cnpj ? ', CNPJ ' + cnpj : '') + (banco ? ', e se a linha digitável começa com ' + banco : '') + '. ' +
      'Não mudamos dados bancários por e-mail ou WhatsApp e não pedimos pagamento em nome de outra pessoa ou empresa.' +
      (tel ? ' Na dúvida, ligue para ' + tel + ' antes de pagar.' : '') +
      ' Pagamento de boleto que não foi emitido por nós não quita esta cobrança.';
  }
  const B = { fatorDe, avisoGolpe, foneBR, nossoNumero, campoLivre, codigoBarras, itf, instrucoes, dvNossoNumero, nossoImpresso, faltaNoConvenio, montar, desenha, docFmt, enderecoTexto, enderecoLinhas };
  raiz.CRMBoleto = B;
  if (typeof module !== 'undefined') module.exports = B;

  // ================================================================ tela
  const CRM = raiz.CRM;
  if (!CRM || !CRM.acoes || typeof document === 'undefined') return;
  const esc = CRM.esc;
  const cfgB = () => (CRM.estado.cfg && CRM.estado.cfg.boleto) || {};
  const emitente = () => ((CRM.estado.cfg && CRM.estado.cfg.fiscal) || {}).emitente || null;

  // cartão em Configurações → Integrações (o ajustes.js chama; só o administrador)
  function cartao() {
    const c = cfgB(), falta = faltaNoConvenio(c, emitente());
    const situacao = c.ligado ? CRM.selo('ligado (' + (c.caminho === 'remessa' ? 'arquivo de remessa' : 'API do BB') + ')', 'verde')
      : CRM.selo('desligado: esperando a resposta do BB (API de Cobrança ou arquivo de remessa)', 'ambar');
    return '<section class="cartao"><h2>Boleto pelo Banco do Brasil</h2>' +
      '<p>A nota emitida pelo CRM vai ganhar o boleto registrado sozinho, junto da DANFE num PDF só. Enquanto estiver desligado, ' +
      'nada muda para a equipe: os boletos continuam no site do banco.</p>' +
      '<p>Situação: ' + situacao + '</p>' +
      '<p>Convênio: ' + (c.convenio ? '<strong>' + esc(c.convenio) + '</strong> · carteira ' + esc(c.carteira || '?') + (c.variacao ? '/' + esc(c.variacao) : '') +
        ' · agência/conta ' + esc((c.agencia || '?') + ' / ' + (c.conta || '?')) : CRM.selo('não preenchido', 'ambar')) +
        (falta.length ? ' · falta: ' + esc(falta.join(', ')) : '') + '</p>' +
      '<p>Multa ' + esc(pct(c.multa_pct)) + ' · juros ' + esc(pct(c.juros_mes_pct)) + ' ao mês' + (c.protesto_dias ? ' · protesto ' + esc(c.protesto_dias) + ' dias após o vencimento' : '') +
        ' · próximo número do CRM: <strong>' + esc(c.inicio_numeracao || '—') + '</strong></p>' +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="bol-convenio">Dados do convênio</button> ' +
        '<button type="button" class="btn" data-acao="bol-exemplo"' + (falta.length ? ' disabled title="preencha o convênio primeiro"' : '') + '>Ver um boleto de exemplo</button> ' +
        '<button type="button" class="btn sec" data-acao="bol-remessa-teste"' + (falta.length || !raiz.CRMCnab240 ? ' disabled title="preencha o convênio primeiro"' : '') + '>Baixar arquivo de teste (Validador do BB)</button> ' +
        (c.ligado ? '<button type="button" class="btn sec" data-acao="bol-desligar">Desligar</button>'
          : '<button type="button" class="btn sec" data-acao="bol-ligar-remessa"' + (falta.length || !raiz.CRMCnab240 ? ' disabled title="preencha o convênio primeiro"' : '') + '>Ligar pelo arquivo de remessa</button>') + '</p>' +
      '<p class="dica">O arquivo de teste é a remessa CNAB 240 com até 3 títulos em aberto, marcada como TESTE. Use só no <strong>Validador de Leiautes</strong> ' +
        'do Gerenciador Financeiro (Troca de arquivos e APIs → Leiautes → "CNAB240 - Cobrança Segmento P/Q/R/S" → Analisar). Não suba em Remessa/retorno: ' +
        'o envio de verdade só depois do teste combinado com o gerente.</p>' +
      '<p class="dica">O exemplo usa um título de verdade em aberto, sai marcado <strong>SIMULAÇÃO - SEM VALOR</strong> e não registra nada no banco. ' +
        'A numeração do CRM precisa começar numa faixa que o site do BB não use (o gerente confirma).</p></section>';
  }

  // Aviso contra boleto falso (27/10/2026): cartão em Configurações → Integrações. O texto gravado (fiscal.aviso_golpe) vai
  // na nota (serviço fiscal) e no e-mail de atraso; enquanto não gravar, boleto, DANFE e resumo usam o padrão de regras.js.
  function cartaoGolpe() {
    const f = (CRM.estado.cfg && CRM.estado.cfg.fiscal) || {}, t = CRM.avisoGolpe ? CRM.avisoGolpe() : '';
    const sit = f.aviso_golpe === '' ? CRM.selo('desligado', 'ambar') : f.aviso_golpe ? CRM.selo('ligado', 'verde')
      : CRM.selo('ligado no boleto, na DANFE e no resumo; falta gravar para ir na nota e no e-mail', 'ambar');
    return '<section class="cartao"><h2>Aviso contra boleto falso</h2>' +
      '<p>Sai grifado em amarelo no boleto, na DANFE, na folha de resumo que vai com o boleto, no texto da nota fiscal (só nas notas com parcelas), ' +
        'no fim da mensagem do WhatsApp com o boleto e no e-mail de atraso. Situação: ' + sit + '</p>' +
      (t ? '<p style="background:#fff176;border:2px solid #c81e1e;border-radius:8px;padding:8px 12px;color:#7a0000;font-weight:600">' + esc(t) + '</p>' : '') +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="bol-golpe">Editar o aviso</button></p></section>';
  }

  async function exemplo() {
    const c = cfgB(), em = emitente();
    const D = CRM.estado.D || {};
    const h = CRM.hoje();
    const t = ((D.titulos || []).filter(x => x.vencimento >= h && Number(x.valor) > 0).sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0]) ||
      { valor: 1234.56, vencimento: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), nota_numero: 1, parcela: 1, cliente_nome: 'CLIENTE DE EXEMPLO', cliente_doc: '' };
    const e = t.empresa_id ? CRM.empresa(t.empresa_id) : null;
    const d = montar(c, em, {
      valor: t.valor, vencimento: t.vencimento, seq: Number(digitos(c.inicio_numeracao)) || 1,
      documento: String(t.nota_numero || t.duplicata || '') + ((D.titulos || []).filter(x => x.nota_numero === t.nota_numero).length > 1 ? '/' + t.parcela : ''), emissao: t.emitida_em || h
    }, { nome: (e && (e.razao_social || e.nome)) || t.cliente_nome, doc: (e && e.cnpj) || t.cliente_doc, endereco: e ? { logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairro: e.bairro, cidade: e.cidade, uf: e.uf, cep: e.cep } : '' },
    { hoje: h, simulacao: true });
    if (!raiz.jspdf) await new Promise((ok, falha) => {
      const sc = document.createElement('script');
      sc.src = 'vendor/jspdf.umd.min.js'; sc.onload = ok; sc.onerror = () => falha(new Error('não consegui carregar o gerador de PDF (sem internet?)'));
      document.head.appendChild(sc);
    });
    const { jsPDF } = raiz.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    desenha(pdf, d, { simulacao: true, aviso: CRM.avisoGolpe ? CRM.avisoGolpe() : '' });
    pdf.save('Boleto de exemplo (simulação) - ' + (t.nota_numero ? 'NF ' + t.nota_numero : 'exemplo') + '.pdf');
  }

  // Remessa CNAB 240 de teste (26/10/2026): até 3 títulos de verdade em aberto, com o pagador completo (CPF/CNPJ e CEP),
  // nosso número a partir do primeiro número do CRM e "TS" no lote. Não grava nada: é só para o Validador de Leiautes do BB.
  function remessaTeste() {
    const K = raiz.CRMCnab240, c = cfgB(), em = emitente(), D = CRM.estado.D || {}, h = CRM.hoje();
    const f = K.falta(c, em);
    if (f.length) throw new Error('falta: ' + f.join(', '));
    let seq = Number(digitos(c.inicio_numeracao)) || 1;
    const tits = [];
    for (const t of (D.titulos || []).filter(x => x.vencimento >= h && Number(x.valor) > 0).sort((a, b) => a.vencimento.localeCompare(b.vencimento))) {
      const e = t.empresa_id ? CRM.empresa(t.empresa_id) : null;
      if (!e || digitos(e.cep).length !== 8 || ![11, 14].includes(digitos(e.cnpj).length)) continue;
      tits.push({ nosso_numero: nossoNumero(c.convenio, seq++), documento: t.duplicata, id_empresa: t.duplicata, vencimento: t.vencimento,
        emissao: t.emitida_em && t.emitida_em <= t.vencimento ? t.emitida_em : h, valor: t.valor,
        pagador: { doc: e.cnpj, nome: e.razao_social || e.nome, logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairro: e.bairro, cep: e.cep, cidade: e.cidade, uf: e.uf } });
      if (tits.length === 3) break;
    }
    if (!tits.length) throw new Error('nenhum título em aberto com o cadastro do cliente completo (CNPJ e CEP) para o teste');
    const agora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false }).replace(/\D/g, '').slice(0, 6);
    const txt = K.remessa(c, em, tits, { hoje: h, hora: agora, seq: 1, teste: true });
    CRM.baixar('remessa-teste-cnab240-' + h + '.txt', txt, 'text/plain');
    CRM.toast('Arquivo de teste com ' + tits.length + ' título(s). Suba no Validador de Leiautes do BB.');
  }

  // ================================================================ boleto pelo arquivo CNAB 240 (26/10/2026)
  // Bloco em Caixa → Cobrança (só o administrador e só com o boleto ligado no caminho "remessa"): preparar os boletos das
  // parcelas das notas do CRM, gerar o arquivo de remessa (sobe no Gerenciador Financeiro → Troca de arquivos e APIs →
  // Remessa/retorno), baixar de novo uma remessa, ler o arquivo de retorno (baixa e Caixa pelo banco, crm_boleto_bb_retorno),
  // PDF de cada boleto e "Mandar de novo" o que o banco rejeitou. O cartório (cobranca.js) manda a instrução de protesto.
  const R = raiz.CRMRegras;
  let bb = null, carregandoBB = false, lendoRetorno = false;
  const ligadoArquivo = () => { const c = cfgB(); return !!c.ligado && c.caminho === 'remessa'; };
  const VIVO = ['preparado', 'registrado', 'pago'];
  async function carregaBB() {
    const st = CRM.store();
    if (carregandoBB || !st || !st.boletosBB) return;
    carregandoBB = true;
    try { const [lista, remessas] = await Promise.all([st.boletosBB(), st.boletoRemessas()]); bb = { lista, remessas }; } finally { carregandoBB = false; }
    CRM.render();
  }
  // parcelas das notas do CRM (duplicata "2-000012/01") a pagar por boleto, a vencer e sem boleto vivo
  function aRegistrar() {
    const vivos = new Set(((bb && bb.lista) || []).filter(b => VIVO.includes(b.situacao)).map(b => b.duplicata)), h = CRM.hoje();
    return ((CRM.estado.D || {}).titulos || []).filter(t => /^\d+-/.test(t.duplicata || '') && (!t.portador || /BOLETO/i.test(t.portador)) &&
      t.vencimento >= h && Number(t.valor) > 0 && !t.cartorio_em && !t.abono && !vivos.has(t.duplicata)).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }
  const SITUACAO_BB = { preparado: ['preparado', 'cinza'], registrado: ['no banco', 'azul'], pago: ['pago', 'verde'], baixado: ['baixado', 'cinza'], cancelado: ['cancelado', 'cinza'], erro: ['rejeitado pelo banco', 'vermelho'] };
  function blocoArquivo() {
    if (!CRM.ehAdmin() || !ligadoArquivo() || !raiz.CRMCnab240) return '';
    if (!bb) return '<section class="cartao"><h2>Boleto do BB pelo arquivo</h2><p class="vazio">Carregando os boletos…</p></section>';
    const lista = bb.lista || [], novos = aRegistrar();
    const prontos = lista.filter(b => b.situacao === 'preparado' && !b.remessa_seq), instr = lista.filter(b => b.instrucao && !b.instrucao_remessa);
    const tot = l => R.moeda(l.reduce((s2, x) => s2 + Number(x.valor || 0), 0));
    const nomeDe = b => { const e = b.empresa_id && CRM.empresa(b.empresa_id); return (e && e.nome) || ''; };
    const linha = b => { const st = SITUACAO_BB[b.situacao] || [b.situacao, 'cinza'];
      return '<tr><td><strong>' + esc(b.documento || b.duplicata) + '</strong><small>' + esc(nomeDe(b)) + '</small></td><td class="num">' + esc(R.moeda(b.valor)) +
        '<small>vence ' + esc(R.dataBR(b.vencimento)) + '</small></td><td>' + CRM.selo(st[0] + (b.situacao === 'preparado' && b.remessa_seq ? ' · na remessa ' + b.remessa_seq : ''), st[1]) +
        (b.instrucao ? ' ' + CRM.selo({ '09': 'protestar', '10': 'sustar protesto', '02': 'baixar', '06': 'novo vencimento' }[b.instrucao] + (b.instrucao_remessa ? ' (remessa ' + b.instrucao_remessa + ')' : ' (próxima remessa)'), 'ambar') : '') +
        (b.pago_em ? '<small>crédito ' + esc(R.dataBR(b.pago_em)) + ' · ' + esc(R.moeda(b.valor_pago)) + '</small>' : '') + (b.motivo ? '<small>' + esc(b.motivo) + '</small>' : '') + '</td>' +
        '<td class="num acoes-linha">' + (b.situacao === 'erro' ? '<button type="button" class="mini" data-acao="bb-reenviar" data-id="' + esc(b.id) + '" title="depois de corrigir o cadastro do cliente">Mandar de novo</button> ' : '') +
        (['preparado', 'registrado'].includes(b.situacao) ? '<button type="button" class="mini" data-acao="bb-pdf" data-id="' + esc(b.id) + '">PDF</button>' : '') + '</td></tr>'; };
    return '<section class="cartao"><h2>Boleto do BB pelo arquivo <small>CNAB 240 · convênio ' + esc(cfgB().convenio || '') + '</small></h2>' +
      '<ol class="lista">' +
        '<li><strong>Preparar:</strong> ' + (novos.length ? novos.length + ' parcela(s) das notas do CRM sem boleto (' + esc(tot(novos)) + '). ' +
          '<button type="button" class="btn" data-acao="bb-preparar">Preparar ' + novos.length + ' boleto(s)</button>' : '<span class="dica">nenhuma parcela nova a pagar por boleto.</span>') + '</li>' +
        '<li><strong>Mandar ao banco:</strong> ' + (prontos.length || instr.length ? prontos.length + ' boleto(s)' + (instr.length ? ' e ' + instr.length + ' instrução(ões) (cartório, baixa)' : '') + ' esperando o arquivo. ' +
          '<button type="button" class="btn" data-acao="bb-remessa">Gerar o arquivo de remessa</button>' +
          '<small>Suba o arquivo no Gerenciador Financeiro do BB: Troca de arquivos e APIs → Remessa/retorno.</small>' : '<span class="dica">nada esperando.</span>') + '</li>' +
        '<li><strong>Retorno:</strong> no dia seguinte, baixe o arquivo de retorno no Gerenciador e suba aqui. O CRM confirma o registro, dá a baixa dos pagos e ' +
          'lança no Caixa no dia do crédito, com a tarifa. ' + (lendoRetorno ? '<span class="cob-lendo">Lendo o retorno…</span>'
          : '<label class="btn sec arquivo">Ler o arquivo de retorno<input type="file" id="bbRetorno" accept=".ret,.txt,.RET,.TXT,text/plain"></label>') + '</li></ol>' +
      ((bb.remessas || []).length ? '<details data-chave="bb-remessas"><summary>Remessas geradas (' + bb.remessas.length + ')</summary><ul class="lista">' +
        bb.remessas.map(r => '<li>Remessa ' + esc(r.seq) + ' · ' + esc(new Date(r.gerada_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })) +
          ' · ' + esc(r.boletos) + ' boleto(s), ' + esc(r.instrucoes) + ' instrução(ões) · ' + esc(R.moeda(r.valor)) +
          ' <button type="button" class="mini" data-acao="bb-remessa-de-novo" data-id="' + esc(r.seq) + '">Baixar de novo</button></li>').join('') + '</ul></details>' : '') +
      (lista.length ? '<details data-chave="bb-lista"' + (lista.some(b => b.situacao === 'erro') ? ' open' : '') + '><summary>Boletos dos últimos 120 dias (' + lista.length + ')</summary>' +
        '<div class="tabela-rolagem"><table class="tabela"><tbody>' + lista.slice().reverse().slice(0, 60).map(linha).join('') + '</tbody></table></div></details>' : '') +
      '</section>';
  }
  function depoisBloco(el) {
    if (!CRM.ehAdmin() || !ligadoArquivo()) return;
    if (!bb) carregaBB().catch(CRM.falhou);
    const arq = el.querySelector('#bbRetorno');
    if (arq) arq.addEventListener('change', () => { const f = arq.files && arq.files[0]; arq.value = ''; if (f) lerRetorno(f).catch(e => { lendoRetorno = false; CRM.render(); CRM.falhou(e); }); });
  }
  function baixaRemessa(d) {
    const itens = (d.boletos || []).concat(d.instrucoes || []);
    const agora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false }).replace(/\D/g, '').slice(0, 6);
    const txt = raiz.CRMCnab240.remessa(cfgB(), emitente(), itens, { hoje: CRM.hoje(), hora: agora, seq: d.seq, teste: !!d.teste });
    CRM.baixar('remessa-cnab240-' + String(d.seq).padStart(4, '0') + '.txt', txt, 'text/plain');
  }
  async function sha256(texto) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async function lerRetorno(arquivo) {
    const texto = await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result || '')); r.onerror = () => falha(new Error('não consegui ler o arquivo')); r.readAsText(arquivo, 'ISO-8859-1'); });
    const r = raiz.CRMCnab240.retorno(texto);
    if (!r.ok) throw new Error('arquivo de retorno com problema: ' + r.erros.slice(0, 3).join('; '));
    if (!r.itens.length) throw new Error('o arquivo de retorno não tem nenhum boleto');
    lendoRetorno = true; CRM.render();
    const res = await CRM.store().boletoBBRetorno(await sha256(texto), r.cabecalho, r.itens);
    lendoRetorno = false;
    const liq = res.liquidados || [], rej = res.rejeitados || [];
    const linhas = [res.registrados + ' boleto(s) registrado(s) no banco.', liq.length + ' pago(s): ' + R.moeda(liq.reduce((s2, x) => s2 + Number(x.pago || 0), 0)) + ' lançado(s) no Caixa no dia do crédito.']
      .concat(liq.map(x => '· ' + x.documento + ' ' + x.cliente + ': ' + R.moeda(x.pago) + ' em ' + R.dataBR(x.credito) + (x.caixa ? '' : ' (já estava recebido no Caixa)')))
      .concat(Object.keys(res.tarifas || {}).map(k => '· tarifa de cobrança de ' + R.moeda(res.tarifas[k]) + ' em ' + R.dataBR(k) + ' (Tarifas bancárias)'))
      .concat(rej.length ? ['', rej.length + ' rejeitado(s) pelo banco — confira o cadastro do cliente e use "Mandar de novo":'].concat(rej.map(x => '· ' + x.documento + ' (' + R.moeda(x.valor) + ')' + (x.motivos ? ' motivo ' + x.motivos : '') + (x.instrucao ? ' — era uma instrução' : ''))) : [])
      .concat(res.desconhecidos ? ['', res.desconhecidos + ' boleto(s) do arquivo não são do CRM (feitos no site do BB): ficaram como estavam.'] : []);
    CRM.abrirForm({ titulo: 'Retorno do banco lido', intro: linhas.join('\n'), campos: [], salvarTexto: 'Fechar', aoSalvar: async () => {} });
    await Promise.all([carregaBB(), CRM.recarregar(true)]);
  }
  async function pdfBoleto(id) {
    const b = ((bb && bb.lista) || []).find(x => x.id === id);
    if (!b) return;
    const e = b.empresa_id ? CRM.empresa(b.empresa_id) : null;
    const d = montar(cfgB(), emitente(), { valor: b.valor, vencimento: b.vencimento, nosso_numero: b.nosso_numero, documento: b.documento, emissao: b.emissao },
      { nome: (e && (e.razao_social || e.nome)) || '', doc: e && e.cnpj, endereco: e ? { logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairro: e.bairro, cidade: e.cidade, uf: e.uf, cep: e.cep } : '' },
      { hoje: CRM.hoje() });
    await carregaJsPdf();
    const pdf = new raiz.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    desenha(pdf, d, { aviso: CRM.avisoGolpe ? CRM.avisoGolpe() : '' });
    pdf.save('Boleto ' + (b.documento || b.duplicata).replace(/[\\/]/g, '-') + '.pdf');
  }
  async function carregaJsPdf() {
    if (raiz.jspdf) return;
    await new Promise((ok, falha) => { const sc = document.createElement('script'); sc.src = 'vendor/jspdf.umd.min.js'; sc.onload = ok; sc.onerror = () => falha(new Error('não consegui carregar o gerador de PDF (sem internet?)')); document.head.appendChild(sc); });
  }
  // páginas de boleto no PDF da nota (DANFE): as parcelas da nota com boleto preparado ou no banco
  async function paginasNota(pdf, n) {
    if (!n || !ligadoArquivo() || !CRM.store().boletosBBdaNota) return 0;
    const l = await CRM.store().boletosBBdaNota((n.serie || '') + '-' + String(n.numero).padStart(6, '0') + '/');
    for (const b of l) {
      const e = b.empresa_id ? CRM.empresa(b.empresa_id) : null;
      const d = montar(cfgB(), emitente(), { valor: b.valor, vencimento: b.vencimento, nosso_numero: b.nosso_numero, documento: b.documento, emissao: b.emissao },
        { nome: (e && (e.razao_social || e.nome)) || '', doc: e && e.cnpj, endereco: e ? { logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairro: e.bairro, cidade: e.cidade, uf: e.uf, cep: e.cep } : '' },
        { hoje: CRM.hoje() });
      pdf.addPage('a4', 'portrait');
      desenha(pdf, d, { aviso: CRM.avisoGolpe ? CRM.avisoGolpe() : '' });
    }
    return l.length;
  }
  // instrução ao banco (cobranca.js: cartório → '09' protestar; tirar do cartório → '10' sustar). Devolve quantas foram marcadas.
  async function instrucao(dups, mov) {
    if (!CRM.ehAdmin() || !ligadoArquivo()) return 0;
    let n = 0;
    for (const d of dups) { const r = await CRM.store().boletoBBInstrucao(d, mov); if (r && r.ok) n++; }
    if (n) carregaBB().catch(() => {});
    return n;
  }

  CRM.boletoBB = { cartao, cartaoGolpe, exemplo, remessaTeste, blocoArquivo, depoisBloco, paginasNota, instrucao };
  Object.assign(CRM.acoes, {
    'bol-convenio': () => {
      const c = cfgB();
      CRM.abrirForm({
        titulo: 'Convênio de cobrança do Banco do Brasil',
        intro: 'Os dados que aparecem em todo boleto da empresa (o gerente do BB confirma). Nada aqui é senha: as chaves da API, quando chegarem, vão só nos segredos do Supabase.',
        campos: [
          { nome: 'convenio', rotulo: 'Número do convênio (7 dígitos)', obrigatorio: true },
          { nome: 'carteira', rotulo: 'Carteira', obrigatorio: true },
          { nome: 'variacao', rotulo: 'Variação da carteira' },
          { nome: 'agencia', rotulo: 'Agência com o dígito, como no extrato (ex.: 3034-1)', obrigatorio: true },
          { nome: 'conta', rotulo: 'Conta com o dígito, como no extrato (ex.: 48730-9)', obrigatorio: true },
          { nome: 'multa_pct', rotulo: 'Multa depois do vencimento (%)', tipo: 'numero', vazioNulo: true },
          { nome: 'juros_mes_pct', rotulo: 'Juros ao mês (%)', tipo: 'numero', vazioNulo: true },
          { nome: 'protesto_dias', rotulo: 'Protesto: dias depois do vencimento (vazio = sem a frase)', tipo: 'numero', passo: '1', vazioNulo: true },
          { nome: 'inicio_numeracao', rotulo: 'Primeiro número do CRM (até 10 dígitos, faixa livre no convênio)' },
          { nome: 'instrucao', rotulo: 'Instrução a mais no boleto (até 2 linhas)', tipo: 'textarea', largo: true }],
        valores: c,
        aoSalvar: async v => {
          const conv = digitos(v.convenio);
          if (conv.length !== 7) throw new Error('o convênio tem 7 dígitos (são os 7 primeiros do "Nosso número" do boleto)');
          if (v.inicio_numeracao && !zeros(v.inicio_numeracao, 10)) throw new Error('o primeiro número tem até 10 dígitos');
          // o dígito vem depois do traço, como no extrato (26/10/2026: "487309" foi lido como conta 487309 sem dígito)
          if (!/^\s*\d+\s*-\s*[0-9xX]\s*$/.test(String(v.agencia || ''))) throw new Error('agência com o dígito depois do traço, como no extrato (ex.: 3034-1)');
          if (!/^\s*\d+\s*-\s*[0-9xX]\s*$/.test(String(v.conta || ''))) throw new Error('conta com o dígito depois do traço, como no extrato (ex.: 48730-9)');
          await CRM.salvarConfig({ boleto: Object.assign({}, c, v, { convenio: conv, carteira: digitos(v.carteira), variacao: digitos(v.variacao), inicio_numeracao: digitos(v.inicio_numeracao) }) });
          CRM.toast('Dados do convênio salvos.');
        }
      });
    },
    'bol-golpe': () => {
      const f = (CRM.estado.cfg && CRM.estado.cfg.fiscal) || {};
      CRM.abrirForm({
        titulo: 'Aviso contra boleto falso',
        intro: 'Deixe o texto em branco para usar o padrão (nome, CNPJ, banco e telefone da empresa). Sai do jeito que estiver aqui, grifado.',
        campos: [
          { nome: 'texto', rotulo: 'Texto do aviso', tipo: 'textarea', largo: true, linhas: 6 },
          { nome: 'desligar', rotulo: 'Não mostrar o aviso em lugar nenhum', tipo: 'checkbox', largo: true }],
        valores: { texto: f.aviso_golpe || (CRM.avisoGolpe ? CRM.avisoGolpe() : ''), desligar: f.aviso_golpe === '' },
        aoSalvar: async v => {
          let t = '';
          if (!v.desligar) {
            const e = (f.emitente || {}), b = (CRM.estado.cfg && CRM.estado.cfg.boleto) || {};
            t = String(v.texto || '').replace(/\s+/g, ' ').trim() || avisoGolpe(e, undefined, b.convenio ? '001 (Banco do Brasil)' : '');
            if (!t) throw new Error('preencha o emitente em Fiscal → Emissão (nome e CNPJ) ou escreva o texto');
            if (t.length > 1000) throw new Error('o aviso passa de 1.000 letras: encurte');
          }
          await CRM.salvarConfig({ fiscal: { aviso_golpe: t } });
          CRM.toast(t ? 'Aviso gravado: vai em todos os documentos de cobrança.' : 'Aviso desligado.');
        }
      });
    },
    'bol-exemplo': async () => { try { await exemplo(); } catch (e) { CRM.falhou(e); } },
    'bol-remessa-teste': () => { try { remessaTeste(); } catch (e) { CRM.falhou(e); } },
    // ligar e desligar (26/10/2026): ligado, o bloco "Boleto do BB pelo arquivo" aparece em Caixa → Cobrança e a DANFE leva o boleto
    'bol-ligar-remessa': async () => {
      try {
        const c = cfgB(), f = faltaNoConvenio(c, emitente()).concat(raiz.CRMCnab240 ? raiz.CRMCnab240.falta(c, emitente()) : ['leitor do CNAB']);
        if (f.length) throw new Error('falta: ' + Array.from(new Set(f)).join(', '));
        if (!confirm('Ligar o boleto pelo arquivo de remessa (CNAB 240)?\n\nSó ligue depois que o gerente do BB confirmar: cobrança por arquivo liberada em produção no convênio ' + c.convenio +
          ', a faixa do nosso número a partir de ' + (c.inicio_numeracao || '?') + ' e o 1º arquivo de teste. Ligado, as parcelas das notas do CRM aparecem em Caixa → Cobrança para preparar e mandar ao banco.')) return;
        await CRM.salvarConfig({ boleto: Object.assign({}, c, { ligado: true, caminho: 'remessa' }) });
        CRM.toast('Boleto ligado pelo arquivo de remessa. Veja em Caixa → Cobrança.');
      } catch (e) { CRM.falhou(e); }
    },
    'bol-desligar': async () => {
      try {
        if (!confirm('Desligar o boleto do BB? Os boletos já mandados ao banco continuam valendo lá; o CRM só para de preparar novos e de mostrar o bloco em Caixa → Cobrança.')) return;
        await CRM.salvarConfig({ boleto: Object.assign({}, cfgB(), { ligado: false }) });
        CRM.toast('Boleto do BB desligado.');
      } catch (e) { CRM.falhou(e); }
    },
    'bb-preparar': async () => {
      try {
        const l = aRegistrar();
        if (!l.length || !confirm('Preparar o boleto de ' + l.length + ' parcela(s)? Cada uma ganha o nosso número do CRM; o registro no banco é pelo arquivo de remessa.')) return;
        const r = await CRM.store().boletoBBPreparar(l.map(t => t.duplicata));
        await carregaBB();
        const pul = r.pulados || [];
        CRM.toast(r.preparados + ' boleto(s) preparado(s)' + (pul.length ? '; ' + pul.length + ' ficaram de fora: ' + pul.slice(0, 3).map(x => x.duplicata + ' (' + x.motivo + ')').join(', ') : '') + '.');
      } catch (e) { CRM.falhou(e); }
    },
    'bb-remessa': async () => {
      try {
        if (!confirm('Gerar o arquivo de remessa com os boletos preparados e as instruções pendentes? Depois de gerado, suba o arquivo no Gerenciador Financeiro do BB (Troca de arquivos e APIs → Remessa/retorno).')) return;
        const d = await CRM.store().boletoBBRemessa(false);
        baixaRemessa(d);
        await carregaBB();
        CRM.toast('Remessa ' + d.seq + ' gerada: ' + (d.boletos || []).length + ' boleto(s), ' + (d.instrucoes || []).length + ' instrução(ões). Suba no Gerenciador do BB.');
      } catch (e) { CRM.falhou(e); }
    },
    'bb-remessa-de-novo': async id => { try { baixaRemessa(await CRM.store().boletoBBRemessaDados(Number(id))); } catch (e) { CRM.falhou(e); } },
    'bb-pdf': id => { pdfBoleto(id).catch(CRM.falhou); },
    'bb-reenviar': async id => {
      try {
        if (!confirm('Mandar este boleto de novo na próxima remessa? Corrija antes o cadastro do cliente (CPF/CNPJ, endereço, CEP).')) return;
        await CRM.store().boletoBBReenviar(id); await carregaBB(); CRM.toast('Volta na próxima remessa.');
      } catch (e) { CRM.falhou(e); }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
