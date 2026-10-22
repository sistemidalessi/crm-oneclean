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
  // Instruções ao caixa: multa e juros calculados em reais (o pagador entende melhor), protesto e o texto livre.
  function instrucoes(cfg, valor, vencimento) {
    cfg = cfg || {};
    const out = [], v = r2(valor);
    const multa = Number(cfg.multa_pct) || 0, juros = Number(cfg.juros_mes_pct) || 0, prot = Math.round(Number(cfg.protesto_dias) || 0);
    if (multa > 0) out.push('Após ' + dataBR(vencimento) + ', cobrar multa de ' + pct(multa) + ' (' + moeda(v * multa / 100) + ').');
    if (juros > 0) out.push('Juros de mora de ' + moeda(Math.max(0.01, v * juros / 100 / 30)) + ' ao dia (' + pct(juros) + ' ao mês).');
    if (prot > 0) out.push('Sujeito a protesto ' + prot + ' dias após o vencimento.');
    String(cfg.instrucao || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 2).forEach(s => out.push(s));
    return out.slice(0, 5);
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
      carteira: ct + (vr ? '/' + vr.padStart(3, '0') : ''), especie: 'DM', aceite: 'N', moeda: 'R$',
      localPagamento: cfg.local_pagamento || 'Pagável em qualquer banco até o vencimento. Após, somente no Banco do Brasil.',
      beneficiario: { nome: String(emitente.razao || emitente.nome || '').toUpperCase(), doc: docFmt(emitente.cnpj), endereco: enderecoTexto(emitente.endereco) },
      agenciaCodigo: String(cfg.agencia).trim() + ' / ' + String(cfg.conta).trim(),
      pagador: { nome: String((pagador && pagador.nome) || '').toUpperCase(), doc: docFmt(pagador && pagador.doc), endereco: typeof (pagador && pagador.endereco) === 'string' ? pagador.endereco : enderecoTexto(pagador && pagador.endereco) },
      instrucoes: instrucoes(cfg, t.valor, t.vencimento),
      simulacao: !!op.simulacao
    };
  }

  // ---- desenho: recibo do pagador (em cima) + ficha de compensação (embaixo), A4 retrato, mm
  function desenha(pdf, d, op) {
    op = op || {};
    const X = 10, W = 190, H = 7.6;
    const limpa = t => String(t == null ? '' : t).replace(/[–—]/g, '-').replace(/[^\x20-\xFF€]/g, '');
    const fonte = (tam, negrito) => { pdf.setFont('helvetica', negrito ? 'bold' : 'normal'); pdf.setFontSize(tam); };
    const largura = (t, tam) => pdf.getStringUnitWidth(t) * tam / pdf.internal.scaleFactor;
    function cabe(t, w, tam) { t = limpa(t); let s = tam; while (s > 5 && largura(t, s) > w) s -= 0.25; while (t.length > 1 && largura(t, s) > w) t = t.slice(0, -1); return { t, s }; }
    function cel(x, y, w, h, rot, v, o) {
      o = o || {};
      pdf.setDrawColor(0); pdf.setLineWidth(0.2); pdf.rect(x, y, w, h);
      if (o.fundo) { pdf.setFillColor(235); pdf.rect(x + 0.1, y + 0.1, w - 0.2, h - 0.2, 'F'); }
      fonte(5, false); pdf.setTextColor(60); pdf.text(limpa(rot), x + 0.8, y + 0.6, { baseline: 'top' }); pdf.setTextColor(0);
      if (v == null || v === '') return;
      const f = cabe(String(v), w - 1.6, o.tam || 8.2);
      fonte(f.s, o.negrito);
      const al = o.alinha || 'left', xt = al === 'right' ? x + w - 0.8 : x + 0.8;
      pdf.text(f.t, xt, y + h - 1, { baseline: 'bottom', align: al });
    }
    function topo(y, titulo) {
      fonte(12, true); pdf.text('Banco do Brasil', X, y + 6.2);
      pdf.setLineWidth(0.5); pdf.line(X + 37, y + 1, X + 37, y + 8); pdf.line(X + 55, y + 1, X + 55, y + 8);
      fonte(13, true); pdf.text(d.banco, X + 46, y + 6.4, { align: 'center' });
      const f = cabe(titulo, W - 57, 10.6); fonte(f.s, true); pdf.text(f.t, X + W, y + 6.2, { align: 'right' });
      pdf.setLineWidth(0.5); pdf.line(X, y + 8, X + W, y + 8);
      return y + 8;
    }
    const DIR = 46, ESQ = W - DIR;
    // ---------------- recibo do pagador
    let y = 12;
    fonte(7, true); pdf.text('RECIBO DO PAGADOR', X + W, y - 2, { align: 'right' });
    y = topo(y, d.linhaFmt);
    cel(X, y, 92, H, 'Beneficiário', d.beneficiario.nome);
    cel(X + 92, y, 52, H, 'Agência / Código do beneficiário', d.agenciaCodigo);
    cel(X + 144, y, DIR, H, 'Nosso número', d.nossoNumero, { alinha: 'right' }); y += H;
    cel(X, y, 46, H, 'Número do documento', d.documento);
    cel(X + 46, y, 46, H, 'CPF/CNPJ do beneficiário', d.beneficiario.doc);
    cel(X + 92, y, 52, H, 'Vencimento', dataBR(d.vencimento), { negrito: true });
    cel(X + 144, y, DIR, H, 'Valor do documento', moeda(d.valor), { alinha: 'right', negrito: true }); y += H;
    cel(X, y, W, H, 'Pagador', [d.pagador.nome, d.pagador.doc].filter(Boolean).join(' - ')); y += H;
    fonte(6.5, false); pdf.text('Autenticação mecânica', X + W, y + 3.5, { align: 'right' });
    // corte
    y += 14;
    pdf.setLineDashPattern([1.2, 1], 0); pdf.setLineWidth(0.2); pdf.line(X, y, X + W, y); pdf.setLineDashPattern([], 0);
    fonte(5.5, false); pdf.text('Corte na linha pontilhada', X + W, y - 1, { align: 'right' });
    // ---------------- ficha de compensação
    y += 6;
    y = topo(y, d.linhaFmt);
    cel(X, y, ESQ, H, 'Local de pagamento', d.localPagamento, { tam: 7.4 });
    cel(X + ESQ, y, DIR, H, 'Vencimento', dataBR(d.vencimento), { alinha: 'right', negrito: true, fundo: true }); y += H;
    cel(X, y, ESQ, H + 3, 'Beneficiário', '');
    fonte(7.6, false); pdf.text(cabe(d.beneficiario.nome + ' - CNPJ ' + d.beneficiario.doc, ESQ - 1.6, 7.6).t, X + 0.8, y + 4.6);
    fonte(6.2, false); pdf.text(cabe(d.beneficiario.endereco, ESQ - 1.6, 6.2).t, X + 0.8, y + 8.6);
    cel(X + ESQ, y, DIR, H + 3, 'Agência / Código do beneficiário', d.agenciaCodigo, { alinha: 'right' }); y += H + 3;
    const w6 = [24, 30, 18, 12, 28, ESQ - 112];
    [['Data do documento', dataBR(d.emissao)], ['Número do documento', d.documento], ['Espécie doc.', d.especie], ['Aceite', d.aceite], ['Data do processamento', dataBR(d.processamento)]]
      .reduce((x, c, i) => { cel(x, y, w6[i], H, c[0], c[1]); return x + w6[i]; }, X);
    cel(X + 112, y, w6[5], H, '', '');
    cel(X + ESQ, y, DIR, H, 'Nosso número', d.nossoNumero, { alinha: 'right' }); y += H;
    [['Uso do banco', ''], ['Carteira', d.carteira], ['Espécie', d.moeda], ['Quantidade', ''], ['(x) Valor', '']]
      .reduce((x, c, i) => { cel(x, y, w6[i], H, c[0], c[1]); return x + w6[i]; }, X);
    cel(X + 112, y, w6[5], H, '', '');
    cel(X + ESQ, y, DIR, H, '(=) Valor do documento', moeda(d.valor), { alinha: 'right', negrito: true, fundo: true }); y += H;
    const yIns = y, hIns = 5 * H;
    cel(X, y, ESQ, hIns, 'Instruções (texto de responsabilidade do beneficiário)', '');
    fonte(7.2, false);
    d.instrucoes.forEach((t, i) => pdf.text(cabe(t, ESQ - 2, 7.2).t, X + 1, yIns + 5.2 + i * 3.7));
    ['(-) Desconto / Abatimento', '(-) Outras deduções', '(+) Mora / Multa', '(+) Outros acréscimos', '(=) Valor cobrado']
      .forEach((r, i) => cel(X + ESQ, yIns + i * H, DIR, H, r, ''));
    y += hIns;
    cel(X, y, W, 14, 'Pagador', '');
    fonte(7.8, true); pdf.text(cabe([d.pagador.nome, d.pagador.doc ? (d.pagador.doc.length > 14 ? 'CNPJ ' : 'CPF ') + d.pagador.doc : ''].filter(Boolean).join(' - '), W - 2, 7.8).t, X + 1, y + 5);
    fonte(6.8, false); pdf.text(cabe(d.pagador.endereco, W - 2, 6.8).t, X + 1, y + 9);
    fonte(5, false); pdf.setTextColor(60); pdf.text('Sacador / Avalista', X + 1, y + 12.6); pdf.setTextColor(0);
    y += 14;
    fonte(6.5, false); pdf.text('Autenticação mecânica - FICHA DE COMPENSAÇÃO', X + W, y + 3.5, { align: 'right' });
    // código de barras ITF: estreita 0,254 mm (larga 3x) = 102,9 mm por 13 mm, preto no branco, com margem branca
    const barras = itf(d.codigo), mod = 0.254;
    let xb = X + 1;
    pdf.setFillColor(0);
    barras.forEach((v, i) => { if (i % 2 === 0) pdf.rect(xb, y + 5.5, v * mod, 13, 'F'); xb += v * mod; });
    // simulação: marca bem visível nas duas partes (não serve para pagar)
    if (d.simulacao || op.simulacao) {
      // translúcida (os dados continuam legíveis); o código e a linha da simulação já saem com o dígito geral trocado (montar)
      const gs = pdf.GState ? pdf.GState.bind(pdf) : null;
      if (gs) pdf.setGState(new gs({ opacity: 0.4 }));
      fonte(34, true); pdf.setTextColor(215, 60, 60);
      pdf.text('SIMULAÇÃO - SEM VALOR', 105, 62, { align: 'center', angle: 10 });
      pdf.text('SIMULAÇÃO - SEM VALOR', 105, 160, { align: 'center', angle: 10 });
      pdf.setTextColor(0);
      if (gs) pdf.setGState(new gs({ opacity: 1 }));

    }
    return y + 20;
  }

  const B = { fatorDe, nossoNumero, campoLivre, codigoBarras, itf, instrucoes, faltaNoConvenio, montar, desenha, docFmt, enderecoTexto };
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
        '<button type="button" class="btn" data-acao="bol-exemplo"' + (falta.length ? ' disabled title="preencha o convênio primeiro"' : '') + '>Ver um boleto de exemplo</button></p>' +
      '<p class="dica">O exemplo usa um título de verdade em aberto, sai marcado <strong>SIMULAÇÃO - SEM VALOR</strong> e não registra nada no banco. ' +
        'A numeração do CRM precisa começar numa faixa que o site do BB não use (o gerente confirma).</p></section>';
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
      documento: (t.nota_numero ? 'NF ' + t.nota_numero : t.duplicata || '') + (t.parcela ? '/' + t.parcela : ''), emissao: t.emitida_em || h
    }, { nome: (e && (e.razao_social || e.nome)) || t.cliente_nome, doc: (e && e.cnpj) || t.cliente_doc, endereco: e ? { logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairro: e.bairro, cidade: e.cidade, uf: e.uf, cep: e.cep } : '' },
    { hoje: h, simulacao: true });
    if (!raiz.jspdf) await new Promise((ok, falha) => {
      const sc = document.createElement('script');
      sc.src = 'vendor/jspdf.umd.min.js'; sc.onload = ok; sc.onerror = () => falha(new Error('não consegui carregar o gerador de PDF (sem internet?)'));
      document.head.appendChild(sc);
    });
    const { jsPDF } = raiz.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    desenha(pdf, d, { simulacao: true });
    pdf.save('Boleto de exemplo (simulação) - ' + (t.nota_numero ? 'NF ' + t.nota_numero : 'exemplo') + '.pdf');
  }

  CRM.boletoBB = { cartao, exemplo };
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
          { nome: 'agencia', rotulo: 'Agência (com o dígito)', obrigatorio: true },
          { nome: 'conta', rotulo: 'Conta (com o dígito)', obrigatorio: true },
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
          await CRM.salvarConfig({ boleto: Object.assign({}, c, v, { convenio: conv, carteira: digitos(v.carteira), variacao: digitos(v.variacao), inicio_numeracao: digitos(v.inicio_numeracao) }) });
          CRM.toast('Dados do convênio salvos.');
        }
      });
    },
    'bol-exemplo': async () => { try { await exemplo(); } catch (e) { CRM.falhou(e); } }
  });
})(typeof window !== 'undefined' ? window : globalThis);
