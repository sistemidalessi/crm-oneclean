/* CRM Sistemi Dalessi — arquivo de cobrança CNAB 240 do Banco do Brasil (26/10/2026, Fase 5: "enquanto isso, CNAB?",
   Anderson). Remessa (o CRM gera; alguém sobe no Gerenciador Financeiro → Troca de arquivos e APIs → Remessa/retorno) e
   leitura do retorno (o banco devolve no dia seguinte; o CRM dá a baixa dos pagos).
   Fonte: "Particularidades BB — Leiaute CNAB 240 — Agosto/2017" (manual do BB mandado pelo Anderson em 26/10/2026), que
   traz todas as posições de cada campo; o que ele remete à Febraban segue o Layout Padrão Febraban 240 posições.
   Convênio de 7 posições, carteira 17 (nosso número de 17 dígitos sem DV, alinhado à esquerda). Segmentos:
   - remessa: header de arquivo, header de lote, P (título), Q (pagador), R (multa, quando houver), trailers;
   - retorno: T (título e movimento) + U (valores e datas do crédito).
   Instruções depois da entrada (02 baixa, 06 vencimento, 09 protestar, 10 sustar protesto) vão só com o segmento P: a
   conferir no Validador de Leiautes do BB antes do primeiro uso. Na entrada o boleto vai SEM protesto automático (código 3):
   quem decide o cartório é o administrador, título por título, como hoje.
   Testes: testes/cnab240.test.js. */
(function (raiz) {
  'use strict';
  const digitos = v => String(v == null ? '' : v).replace(/\D/g, '');
  // texto do arquivo: maiúsculas, sem acento, só ASCII visível
  const limpa = v => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ').toUpperCase();
  const A = (v, n) => limpa(v).slice(0, n).padEnd(n, ' ');
  function N(v, n, rotulo) {
    const d = digitos(v);
    if (d.length > n) throw new Error((rotulo || 'campo') + ' com mais de ' + n + ' dígitos');
    return d.padStart(n, '0');
  }
  const V = (v, n) => N(String(Math.round((Number(v) || 0) * 100)), n, 'valor');
  const DT = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + m[2] + m[1] : '00000000'; };
  const ISO = d => (/^\d{8}$/.test(d) && d !== '00000000' ? d.slice(4, 8) + '-' + d.slice(2, 4) + '-' + d.slice(0, 2) : null);
  const diaSeguinte = iso => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  // "1234-5" → { num: '1234', dv: '5' }; o dígito X vai maiúsculo
  function separaDv(v, rotulo) {
    const m = /^\s*(\d+)\s*-?\s*([0-9xX])?\s*$/.exec(String(v == null ? '' : v));
    if (!m) throw new Error(rotulo + ' inválida (use o número com o dígito, ex.: 1234-5)');
    return { num: m[1], dv: (m[2] || '').toUpperCase() };
  }
  function linha(partes) {
    const s = partes.join('');
    if (s.length !== 240) throw new Error('registro CNAB com ' + s.length + ' posições (o 240 tem 240): ' + s.slice(0, 14));
    return s;
  }

  // Códigos de movimento do retorno tratados pelo BB (segmento T, posições 16-17)
  const MOVIMENTO_RETORNO = {
    '02': 'Entrada confirmada', '03': 'Entrada rejeitada', '04': 'Transferência de carteira/entrada', '05': 'Transferência de carteira/baixa',
    '06': 'Liquidação', '09': 'Baixa', '11': 'Título em carteira (em ser)', '12': 'Abatimento confirmado', '13': 'Cancelamento de abatimento confirmado',
    '14': 'Alteração de vencimento confirmada', '15': 'Franco de pagamento', '17': 'Liquidação após baixa', '19': 'Instrução de protesto confirmada',
    '20': 'Sustação de protesto confirmada', '23': 'Remessa a cartório', '24': 'Retirada de cartório', '25': 'Protestado e baixado',
    '26': 'Instrução rejeitada', '27': 'Alteração de outros dados confirmada', '28': 'Débito de tarifas/custas', '29': 'Ocorrência do pagador',
    '30': 'Alteração de dados rejeitada', '44': 'Pago com cheque devolvido', '50': 'Pago com cheque pendente de compensação'
  };
  const LIQUIDACAO = ['06', '17'];
  // Movimentos de remessa que o CRM usa (P, posições 16-17)
  const MOVIMENTO_REMESSA = { entrada: '01', baixa: '02', vencimento: '06', protestar: '09', sustar: '10' };

  // O que falta para gerar a remessa (a tela mostra; remessa() recusa)
  function falta(cfg, emitente) {
    cfg = cfg || {};
    const f = [];
    if (digitos(cfg.convenio).length !== 7) f.push('convênio (7 dígitos)');
    if (!digitos(cfg.carteira)) f.push('carteira');
    if (!digitos(cfg.variacao)) f.push('variação da carteira');
    if (!String(cfg.agencia || '').trim()) f.push('agência');
    if (!String(cfg.conta || '').trim()) f.push('conta');
    if (!(emitente && digitos(emitente.cnpj).length === 14 && (emitente.razao || emitente.nome))) f.push('emitente (aba Fiscal)');
    return f;
  }

  // Remessa. cfg = o convênio de Configurações → Integrações (convenio, carteira, variacao, agencia, conta, multa_pct,
  // juros_mes_pct, emissao: '1' banco emite | '2' a empresa emite — o CRM emite); emitente = { cnpj, razao };
  // titulos = [{ movimento ('entrada' padrão), nosso_numero (17), documento (até 15, o que vai impresso no boleto),
  //   id_empresa (até 25, volta no retorno), vencimento, emissao, valor, pagador: { doc, nome, logradouro, numero,
  //   complemento, bairro, cep, cidade, uf } }]; op = { hoje (AAAA-MM-DD), hora (HHMMSS), seq (número da remessa),
  //   teste: true → "TS" no lote, para o teste com retorno pelo Gerenciador Financeiro }.
  function remessa(cfg, emitente, titulos, op) {
    op = op || {};
    const f = falta(cfg, emitente);
    if (f.length) throw new Error('falta para o arquivo de remessa: ' + f.join(', '));
    if (!titulos || !titulos.length) throw new Error('nenhum título para a remessa');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(op.hoje || ''))) throw new Error('data de geração inválida');
    const conv = N(cfg.convenio, 9, 'convênio'), cart = N(cfg.carteira, 2, 'carteira'), vari = N(cfg.variacao, 3, 'variação');
    const ag = separaDv(cfg.agencia, 'agência'), ct = separaDv(cfg.conta, 'conta');
    const AG = N(ag.num, 5, 'agência') + A(ag.dv, 1), CT = N(ct.num, 12, 'conta') + A(ct.dv, 1);
    const cnpj = digitos(emitente.cnpj), nome = emitente.razao || emitente.nome;
    const seq = Number(op.seq) || 1, hora = /^\d{6}$/.test(String(op.hora || '')) ? op.hora : '000000';
    const emissaoBoleto = ['1', '2'].includes(String(cfg.emissao)) ? String(cfg.emissao) : '2';
    const multa = Number(cfg.multa_pct) || 0, juros = Number(cfg.juros_mes_pct) || 0;
    const L = [];
    // header de arquivo (campo 07.0: convênio 9 + 0014 cobrança cedente + carteira 2 + variação 3 + 2 brancos)
    L.push(linha(['001', '0000', '0', A('', 9), '2', N(cnpj, 14), conv + '0014' + cart + vari + '  ', AG, CT, ' ',
      A(nome, 30), A('BANCO DO BRASIL S.A.', 30), A('', 10), '1', DT(op.hoje), hora, N(seq, 6), '083', '00000', A('', 20), A('', 20), A('', 29)]));
    // header de lote (11.1: o mesmo convênio; posições 52-53 "TS" = arquivo de teste)
    L.push(linha(['001', '0001', '1', 'R', '01', '  ', '042', ' ', '2', N(cnpj, 15), conv + '0014' + cart + vari + (op.teste ? 'TS' : '  '), AG, CT, ' ',
      A(nome, 30), A('', 40), A('', 40), N(seq, 8), DT(op.hoje), '00000000', A('', 33)]));
    let n = 0;
    for (const t of titulos) {
      const mov = MOVIMENTO_REMESSA[t.movimento || 'entrada'];
      if (!mov) throw new Error('movimento desconhecido: ' + t.movimento);
      const nosso = digitos(t.nosso_numero);
      if (nosso.length !== 17 || nosso.slice(0, 7) !== digitos(cfg.convenio)) throw new Error('nosso número não é deste convênio: ' + t.nosso_numero);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.vencimento || ''))) throw new Error('vencimento inválido no título ' + (t.documento || nosso));
      if (!(Number(t.valor) > 0)) throw new Error('valor inválido no título ' + (t.documento || nosso));
      const entrada = mov === '01';
      const emissao = t.emissao || op.hoje;
      if (entrada && emissao > t.vencimento) throw new Error('emissão depois do vencimento no título ' + (t.documento || nosso));
      // segmento P: o título
      L.push(linha(['001', '0001', '3', N(++n, 5), 'P', ' ', mov, AG, CT, ' ', A(nosso, 20),
        '7', '1', '1', emissaoBoleto, '2', A(t.documento, 15), DT(t.vencimento), V(t.valor, 15), '00000', ' ', '02', 'N', DT(emissao),
        juros > 0 ? '2' : '3', juros > 0 ? DT(diaSeguinte(t.vencimento)) : '00000000', V(juros > 0 ? juros : 0, 15),
        '0', '00000000', V(0, 15), V(0, 15), V(0, 15), A(t.id_empresa || t.documento, 25),
        mov === '09' ? '2' : '3', mov === '09' ? '03' : '00', '0', '000', '09', N(0, 10), '1']));
      if (!entrada) continue;
      // segmento Q: o pagador
      const p = t.pagador || {}, doc = digitos(p.doc), cep = digitos(p.cep);
      if (!(doc.length === 11 || doc.length === 14)) throw new Error('CPF/CNPJ do pagador inválido no título ' + (t.documento || nosso));
      if (cep.length !== 8) throw new Error('CEP do pagador inválido no título ' + (t.documento || nosso) + ' (o banco recusa)');
      const endereco = [p.logradouro, p.numero, p.complemento].filter(Boolean).join(' ') || p.endereco || '';
      L.push(linha(['001', '0001', '3', N(++n, 5), 'Q', ' ', mov, doc.length === 11 ? '1' : '2', N(doc, 15), A(p.nome, 40), A(endereco, 40),
        A(p.bairro, 15), cep.slice(0, 5), cep.slice(5), A(p.cidade || p.municipio, 15), A(p.uf, 2), '0', N(0, 15), A('', 40), '000', A('', 20), A('', 8)]));
      // segmento R: a multa (percentual, uma vez só, a partir do dia seguinte ao vencimento)
      if (multa > 0) L.push(linha(['001', '0001', '3', N(++n, 5), 'R', ' ', mov, '0', '00000000', V(0, 15), '0', '00000000', V(0, 15),
        '2', DT(diaSeguinte(t.vencimento)), V(multa, 15), A('', 10), A('', 40), A('', 40), A('', 20), N(0, 8), '000', '00000', ' ', N(0, 12), ' ', ' ', '0', A('', 9)]));
    }
    // trailer de lote: header + detalhes + trailer; totais da cobrança em zeros (o BB pede zeros e brancos)
    L.push(linha(['001', '0001', '5', A('', 9), N(n + 2, 6), '0'.repeat(92), A('', 125)]));
    L.push(linha(['001', '9999', '9', A('', 9), N(1, 6), N(L.length + 1, 6), '000000', A('', 205)]));
    return L.join('\r\n') + '\r\n';
  }

  // Retorno: { ok, erros, cabecalho: { convenio, gerado_em, seq }, itens: [...] }. Cada item junta o T e o U do título.
  function retorno(texto) {
    const linhas = String(texto || '').split(/\r?\n/).map(l => l.replace(/\r$/, '')).filter(l => l.trim());
    const erros = [], itens = [];
    if (!linhas.length) return { ok: false, erros: ['arquivo vazio'], itens };
    const h = linhas[0];
    if (h.length !== 240 || h.slice(0, 3) !== '001' || h[7] !== '0') return { ok: false, erros: ['não é um arquivo CNAB 240 do Banco do Brasil'], itens };
    if (h[142] !== '2') return { ok: false, erros: ['este é um arquivo de remessa, não de retorno'], itens };
    const num = (l, de, ate) => Number(l.slice(de - 1, ate)) || 0;
    const val = (l, de, ate) => Math.round(num(l, de, ate)) / 100;
    const txt = (l, de, ate) => l.slice(de - 1, ate).trim();
    let atual = null;
    linhas.forEach((l, i) => {
      if (l.length !== 240) { erros.push('linha ' + (i + 1) + ': ' + l.length + ' posições (o CNAB 240 tem 240)'); return; }
      if (l[7] !== '3') return;
      const seg = l[13];
      if (seg === 'T') {
        const mov = l.slice(15, 17), motivo = txt(l, 214, 223);
        atual = {
          movimento: mov, descricao: MOVIMENTO_RETORNO[mov] || 'movimento ' + mov, liquidado: LIQUIDACAO.includes(mov),
          nosso_numero: digitos(l.slice(37, 57)), carteira: l[57], documento: txt(l, 59, 73), vencimento: ISO(l.slice(73, 81)),
          valor: val(l, 82, 96), id_empresa: txt(l, 106, 130), tarifa: val(l, 199, 213),
          motivos: (motivo.match(/.{1,2}/g) || []).filter(c => c.trim() && c !== '00'), linha: i + 1
        };
        itens.push(atual);
      } else if (seg === 'U') {
        if (!atual || atual.linha !== i) { erros.push('linha ' + (i + 1) + ': segmento U sem o T antes'); return; }
        Object.assign(atual, {
          juros: val(l, 18, 32), desconto: val(l, 33, 47), abatimento: val(l, 48, 62), iof: val(l, 63, 77),
          pago: val(l, 78, 92), liquido: val(l, 93, 107), ocorrencia: ISO(l.slice(137, 145)), credito: ISO(l.slice(145, 153))
        });
        atual = null;
      }
    });
    return { ok: !erros.length, erros, cabecalho: { convenio: digitos(h.slice(32, 41)).replace(/^0+/, ''), gerado_em: ISO(h.slice(143, 151)), seq: num(h, 158, 163) },
      itens: itens.map(({ linha: _, ...x }) => x) };
  }

  const api = { remessa, retorno, falta, MOVIMENTO_RETORNO, MOVIMENTO_REMESSA };
  raiz.CRMCnab240 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
