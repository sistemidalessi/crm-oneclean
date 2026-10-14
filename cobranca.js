/* CRM Sistemi Dalessi — cobrança (14/10/2026, pedido do Anderson): título em cartório e boleto
   atualizado (2ª via do BB, com juros) entregue à vendedora com a mensagem pronta. Regras puras, sem
   tela (a tela do administrador é a aba Cobrança do Caixa, em caixa.js; a da vendedora, a Fila do dia e
   a ficha). Fora do regras.js de propósito: o regras.js é o motor da crm-notas, fixado por hash.
   Testes: testes/cobranca.test.js. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  const digitos = v => String(v == null ? '' : v).replace(/\D/g, '');
  const r2 = v => Math.round((Number(v) || 0) * 100) / 100;

  // ---- linha digitável do boleto bancário (47 dígitos; FEBRABAN)
  // campo 1: banco(3) moeda(1) livre 1-5 + DV  · campo 2: livre 6-15 + DV · campo 3: livre 16-25 + DV
  // · DV geral (do código de barras, módulo 11) · fator de vencimento(4) + valor(10).
  function mod10(s) {
    let soma = 0, peso = 2;
    for (let i = s.length - 1; i >= 0; i--) { let p = Number(s[i]) * peso; if (p > 9) p = Math.floor(p / 10) + (p % 10); soma += p; peso = peso === 2 ? 1 : 2; }
    return (10 - (soma % 10)) % 10;
  }
  function mod11(s) {
    let soma = 0, peso = 2;
    for (let i = s.length - 1; i >= 0; i--) { soma += Number(s[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const dv = 11 - (soma % 11);
    return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
  }
  // Código de barras (44) → linha digitável (47).
  function linhaDeCodigo(cod) {
    const c = digitos(cod);
    if (c.length !== 44) return '';
    const livre = c.slice(19);
    const c1 = c.slice(0, 4) + livre.slice(0, 5), c2 = livre.slice(5, 15), c3 = livre.slice(15, 25);
    return c1 + mod10(c1) + c2 + mod10(c2) + c3 + mod10(c3) + c[4] + c.slice(5, 19);
  }
  // Fator de vencimento → data. Reiniciou em 22/02/2025 (fator 1000), depois do 9999 de 21/02/2025.
  function dataDoFator(f) {
    f = Number(f);
    if (!f) return null;
    const base = f >= 1000 ? Date.UTC(2025, 1, 22) + (f - 1000) * 864e5 : null;
    return base == null ? null : new Date(base).toISOString().slice(0, 10);
  }
  // Confere os quatro dígitos verificadores; devolve { ok, valor, vencimento, motivo }.
  function lerLinha(linha) {
    const l = digitos(linha);
    if (l.length !== 47) return { ok: false, motivo: l ? 'a linha tem ' + l.length + ' dígitos (são 47)' : 'sem linha digitável' };
    const c1 = l.slice(0, 9), c2 = l.slice(10, 20), c3 = l.slice(21, 31);
    if (mod10(c1) !== +l[9] || mod10(c2) !== +l[20] || mod10(c3) !== +l[31]) return { ok: false, motivo: 'um dígito da linha não confere (leitura errada?)' };
    const codigo = l.slice(0, 4) + l[32] + l.slice(33, 47) + c1.slice(4) + c2 + c3;
    if (mod11(codigo.slice(0, 4) + codigo.slice(5)) !== +l[32]) return { ok: false, motivo: 'o dígito geral da linha não confere (leitura errada?)' };
    return { ok: true, valor: Number(l.slice(37, 47)) / 100, vencimento: dataDoFator(l.slice(33, 37)), banco: l.slice(0, 3), codigo };
  }
  // "00190.00009 01234.567890 12345.678901 2 12340000095012"
  function formataLinha(linha) {
    const l = digitos(linha);
    if (l.length !== 47) return l;
    return l.slice(0, 5) + '.' + l.slice(5, 10) + ' ' + l.slice(10, 15) + '.' + l.slice(15, 21) + ' ' + l.slice(21, 26) + '.' + l.slice(26, 32) + ' ' + l[32] + ' ' + l.slice(33);
  }

  // ---- o boleto lido pela IA: confere com a linha e acha o título em atraso
  // Banco do Brasil (14/10/2026, 1º uso real): na 2ª via, a linha digitável continua com o valor e o
  // vencimento ORIGINAIS; o valor com juros e multa vem só no campo "(=) Valor cobrado", e o banco calcula os
  // encargos na hora do pagamento. Então a linha confere os dígitos e dá o vencimento e o valor originais, e
  // o valor a cobrar é o "Valor cobrado" lido no PDF (sem ele, o da linha).
  function confereBoleto(b, hoje) {
    const l = lerLinha(b.linha_digitavel);
    const avisos = [];
    const cobrado = r2(b.valor_cobrado), doDoc = r2(b.valor_documento);
    const original = l.ok && l.valor > 0 ? l.valor : doDoc || cobrado;
    let vencimento = b.vencimento || null;
    if (l.ok && l.vencimento) {
      if (vencimento && vencimento !== l.vencimento) avisos.push('vencimento lido ' + R.dataBR(vencimento) + ', o da linha é ' + R.dataBR(l.vencimento) + ': vale o da linha');
      vencimento = l.vencimento;
    }
    if (!l.ok) avisos.push('linha digitável: ' + l.motivo + ' — vai sem a linha (a vendedora manda o PDF)');
    const valor = cobrado > 0 ? cobrado : original;
    if (cobrado > 0 && cobrado < original - 0.005) avisos.push('valor cobrado (' + R.moeda(cobrado) + ') menor que o original (' + R.moeda(original) + '): desconto ou abatimento?');
    const juros = r2(Math.max(0, valor - original));
    const vencido = !!(hoje && vencimento && vencimento < hoje);
    if (vencido && !(juros > 0)) avisos.push('venceu em ' + R.dataBR(vencimento) + ' e o boleto não mostra juros: o banco calcula os encargos na hora do pagamento');
    return { valor, valorOriginal: original, juros, vencimento, linha: l.ok ? digitos(b.linha_digitavel) : '', linhaOk: l.ok, avisos, vencido };
  }
  // titulos: em atraso e fora do cartório, com .empresa_id; empresas: para o CNPJ. Ordem de certeza:
  // mesmo CNPJ e mesmo valor original; mesmo CNPJ e o número da nota no "Nº do documento"; o único
  // título vencido daquele CNPJ; sem CNPJ, o número da nota/duplicata no documento e o valor original.
  function casaBoleto(b, titulos, empresas, usados) {
    usados = usados || new Set();
    const docDe = new Map((empresas || []).map(e => [e.id, digitos(e.cnpj)]));
    const livres = (titulos || []).filter(t => !usados.has(t.duplicata) && !t.cartorio_em);
    const doc = digitos(b.documento);
    const mesmoDoc = doc ? livres.filter(t => docDe.get(t.empresa_id) === doc || digitos(t.cliente_doc) === doc) : [];
    const ndoc = digitos(b.numero_documento);
    const temNota = t => t.nota_numero && ndoc && ndoc.replace(/^0+/, '').indexOf(String(t.nota_numero)) === 0;
    const igualValor = t => b.valor_documento > 0 && Math.abs(Number(t.valor) - b.valor_documento) < 0.01;
    const pega = (l, como) => (l.length === 1 ? { titulo: l[0], como } : null);
    return pega(mesmoDoc.filter(igualValor), 'CNPJ e valor') ||
      pega(mesmoDoc.filter(igualValor).filter(temNota), 'CNPJ, valor e nota') ||
      pega(mesmoDoc.filter(temNota), 'CNPJ e nota') ||
      pega(mesmoDoc, 'único vencido do CNPJ') ||
      pega(livres.filter(t => temNota(t) && igualValor(t)), 'nota e valor') ||
      { titulo: null, como: '', candidatos: mesmoDoc.length ? mesmoDoc : livres.filter(temNota) };
  }

  // ---- o que a vendedora tem para mandar
  // Boleto pendente: não cobrado, o título ainda em atraso e fora do cartório. Por duplicata vale o
  // mais novo (a 2ª via de hoje substitui a de semana passada).
  function boletosPendentes(boletos, atrasos) {
    const abertos = new Map((atrasos || []).filter(t => !t.cartorio_em).map(t => [t.duplicata, t]));
    const ultimo = new Map();
    (boletos || []).forEach(b => { const j = ultimo.get(b.duplicata); if (!j || String(b.criado_em) > String(j.criado_em)) ultimo.set(b.duplicata, b); });
    return [...ultimo.values()].filter(b => !b.cobrado_em && abertos.has(b.duplicata)).map(b => Object.assign({ titulo: abertos.get(b.duplicata) }, b));
  }
  // O mais novo de cada duplicata, cobrado ou não (para a ficha mostrar "boleto atualizado").
  function boletoAtual(boletos, duplicata) {
    return (boletos || []).filter(b => b.duplicata === duplicata).sort((a, b) => (String(a.criado_em) < String(b.criado_em) ? 1 : -1))[0] || null;
  }

  const MODELO_BOLETO = '{saudacao} Tudo bem? Aqui é {vendedor_primeiro_nome}, da {minha_empresa}.\n' +
    'Consta em aberto {titulos_boleto}. Para facilitar, segue o boleto atualizado:\n\n{boletos}\n\n' +
    'É só copiar a linha digitável no app do banco. Também te mando o PDF aqui. Se já tiver pago, por favor desconsidere e me avise. Agradeço!';
  // Bloco {boletos}: uma linha por boleto, com valor, vencimento e a linha digitável.
  // Boleto vencido (2ª via do BB): mostra o valor atualizado e o original, e avisa que o banco calcula os
  // encargos do dia; boleto com data nova: o valor e o vencimento dele.
  const venceuAntes = b => !!b.vencimento && b.vencimento < String(b.criado_em || '9999').slice(0, 10);
  function textoBoletos(lista) {
    const linhas = lista.map(b => {
      const comJuros = Number(b.valor_original) > 0 && Number(b.valor) > Number(b.valor_original) + 0.005;
      return '• ' + (b.nota_numero ? 'NF ' + b.nota_numero : 'Duplicata ' + b.duplicata) + ': ' + R.moeda(b.valor) +
        (comJuros ? ' (atualizado com juros e multa; valor original ' + R.moeda(b.valor_original) + ')'
          : venceuAntes(b) ? ' (venceu em ' + R.dataBR(b.vencimento).slice(0, 5) + ')' : ', vence em ' + R.dataBR(b.vencimento)) +
        (b.linha_digitavel ? '\n  Linha digitável: ' + formataLinha(b.linha_digitavel) : '');
    });
    if (lista.some(venceuAntes)) linhas.push('Pagando pela linha digitável ou pelo PDF, o banco calcula os encargos até o dia do pagamento.');
    return linhas.join('\n');
  }
  function titulosBoleto(lista) {
    const um = b => (b.nota_numero ? 'a NF ' + b.nota_numero : 'a duplicata ' + b.duplicata) + (b.titulo ? ' (vencida em ' + R.dataBR(b.titulo.vencimento).slice(0, 5) + ')' : '');
    return lista.length === 1 ? um(lista[0]) : lista.slice(0, -1).map(um).join(', ') + ' e ' + um(lista[lista.length - 1]);
  }
  function mensagemBoleto(modelo, lista, vars) {
    return R.aplicaModelo(modelo || MODELO_BOLETO, Object.assign({}, vars, { boletos: textoBoletos(lista), titulos_boleto: titulosBoleto(lista) }));
  }

  const C = { lerLinha, linhaDeCodigo, formataLinha, dataDoFator, confereBoleto, casaBoleto, boletosPendentes, boletoAtual, mensagemBoleto, textoBoletos, MODELO_BOLETO };
  raiz.CRMCobranca = C;
  if (typeof module !== 'undefined') module.exports = C;

  // ================================================================ tela
  const CRM = raiz.CRM;
  if (!CRM || !CRM.acoes || typeof document === 'undefined') return;
  const E = () => CRM.estado;
  const esc = CRM.esc;
  const hoje = () => CRM.hoje();
  const dm = d => R.dataBR(d).slice(0, 5);
  const nomeNF = b => (b.nota_numero ? 'NF ' + b.nota_numero : 'duplicata ' + b.duplicata);
  // Administrador: o contas a receber inteiro; gestora e vendedoras: as duplicatas em atraso (crm_atrasos).
  const titulosAdmin = () => (E().D && E().D.titulos) || [];
  const atrasosVis = () => (CRM.ehAdmin() ? titulosAdmin().filter(t => t.vencimento < hoje()) : E().atrasos || []);
  const pendentes = () => boletosPendentes(E().boletos || [], atrasosVis());
  const pendentesDe = id => pendentes().filter(b => b.empresa_id === id);
  const boleto = id => (E().boletos || []).find(b => b.id === id) || null;
  const carregados = {};
  const carrega = src => carregados[src] || (carregados[src] = new Promise((ok, falha) => {
    const sc = document.createElement('script');
    sc.src = src; sc.onload = ok; sc.onerror = () => { delete carregados[src]; falha(new Error('não consegui carregar ' + src + ' (sem internet?)')); };
    document.head.appendChild(sc);
  }));
  // lista nova (não no lugar): o resumo financeiro da ficha guarda cache pela referência da lista
  const trocaTitulo = r => { if (E().D && E().D.titulos) E().D.titulos = E().D.titulos.map(t => (t.id === r.id ? Object.assign({}, t, r) : t)); };
  const fechaForm = () => { const d = document.getElementById('dlgForm'); if (d && d.open) d.close(); };

  // ---- vendedora: o boleto atualizado na ficha, na Fila do dia e no título
  function seloTitulo(t) {
    const b = boletoAtual(E().boletos, t.duplicata);
    if (!b) return '';
    if (b.cobrado_em) return ' ' + CRM.selo('boleto atualizado enviado ' + dm(R.diaLocal(b.cobrado_em)) + (b.cobrado_por ? ' por ' + R.primeiroNome(CRM.nomeUsuario(b.cobrado_por)) : ''), 'verde');
    return ' ' + CRM.selo('boleto atualizado ' + R.moeda(b.valor) + ' · vence ' + dm(b.vencimento) + ' — enviar', 'ambar');
  }
  const botoesEnvio = (id, grande) => '<button type="button" class="' + (grande ? 'btn ouro' : 'mini wa') + '" data-acao="cob-whats" data-id="' + esc(id) + '">WhatsApp com o boleto</button> ' +
    '<button type="button" class="' + (grande ? 'btn sec' : 'mini') + '" data-acao="cob-feito" data-id="' + esc(id) + '" title="mandou por outro caminho (e-mail, telefone): marca como enviado">Já mandei</button>';
  function blocoEmpresa(id, semBotoes) {
    const l = pendentesDe(id);
    if (!l.length) return '';
    return '<div class="cob-bloco"><p>📄 <strong>' + (l.length === 1 ? 'Boleto atualizado para enviar' : l.length + ' boletos atualizados para enviar') + '</strong> — o financeiro já atualizou com os juros. Mande ao cliente:</p><ul>' +
      l.map(b => '<li>' + esc(nomeNF(b)) + ': <strong>' + esc(R.moeda(b.valor)) + '</strong>, vence ' + esc(R.dataBR(b.vencimento)) +
        (b.linha_digitavel ? ' <button type="button" class="mini" data-acao="cob-copiar" data-id="' + esc(b.id) + '">Copiar linha digitável</button>' : ' <small>(sem linha digitável: mande o PDF)</small>') +
        (b.arquivo ? ' <button type="button" class="mini" data-acao="cob-baixar" data-id="' + esc(b.id) + '">Baixar PDF</button>' : '') + '</li>').join('') + '</ul>' +
      (semBotoes ? '' : '<p>' + botoesEnvio(id) + '</p>') + '</div>';
  }
  // Itens da Fila do dia: um por cliente com boleto para mandar (na carteira que a gestora escolheu).
  function paraFila() {
    const cart = CRM.ehGestor() ? CRM.carteira() : null;
    const g = new Map();
    pendentes().forEach(b => {
      const e = b.empresa_id && CRM.empresa(b.empresa_id);
      if (!e || (cart && e.responsavel_id !== cart)) return;
      if (!g.has(e.id)) g.set(e.id, []);
      g.get(e.id).push(b);
    });
    return [...g.entries()].map(([empresaId, l]) => ({ empresaId, motivo: 'Boleto atualizado para enviar: ' + l.map(b => nomeNF(b) + ' ' + R.moeda(b.valor) + ' (vence ' + dm(b.vencimento) + ')').join(', ') }));
  }
  async function baixa(b) {
    const nome = 'Boleto ' + nomeNF(b).replace(/\//g, '-') + '.' + (String(b.arquivo).split('.').pop() || 'pdf');
    const u = await CRM.store().boletoLink(b.arquivo, nome);
    const a = document.createElement('a');
    a.href = u; a.download = nome; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function marcaCobrado(e, lista, c, texto, peloZap) {
    const ids = lista.map(b => b.id);
    await CRM.store().boletoCobrado(ids);
    const agora = new Date().toISOString(), eu = CRM.meuId();
    E().boletos = (E().boletos || []).map(b => (ids.indexOf(b.id) !== -1 && !b.cobrado_em ? Object.assign({}, b, { cobrado_em: agora, cobrado_por: eu }) : b));
    const F = CRM.fichas;
    const a = await F.registraAuto(e, c, peloZap ? 'whatsapp' : 'nota', 'Boleto atualizado enviado' + (peloZap ? ' pelo WhatsApp' + (c ? ' a ' + c.nome : '') : ' (por outro caminho)') + ': ' +
      lista.map(b => nomeNF(b) + ' ' + R.moeda(b.valor) + ', vence ' + R.dataBR(b.vencimento)).join('; ') + (texto ? '\n' + texto : ''));
    if (peloZap && a) F.esperaVolta(e, c, a, 'whatsapp');
    CRM.render();
  }

  // ---- administrador: cartório
  function formCartorio(dup) {
    const t0 = titulosAdmin().find(t => t.duplicata === dup);
    if (!t0 || !t0.empresa_id) return;
    const l = titulosAdmin().filter(t => t.empresa_id === t0.empresa_id && t.vencimento < hoje() && !t.cartorio_em).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const valores = { dia: hoje(), obs: '' };
    l.forEach((t, i) => { valores['t' + i] = true; });
    CRM.abrirForm({
      titulo: 'Mandar para cartório', intro: CRM.nomeEmpresa(t0.empresa_id) + '\nMarque os títulos que foram para o cartório. Eles saem da previsão do caixa e da cobrança: a vendedora vê o selo "em cartório" e não cobra. ' +
        'Ficam no bloco "Em cartório" do Caixa até o cliente pagar ("Recebi…") ou você tirar.',
      campos: l.map((t, i) => ({ nome: 't' + i, rotulo: nomeNF(t) + ' (' + t.duplicata + ') · ' + R.moeda(t.valor) + ' · venceu ' + R.dataBR(t.vencimento), tipo: 'checkbox', largo: true }))
        .concat([{ nome: 'dia', rotulo: 'Enviado ao cartório em', tipo: 'data' }, { nome: 'obs', rotulo: 'Observação (só você vê)', tipo: 'textarea', largo: true, linhas: 2, dica: 'ex.: protesto pelo BB; cliente avisado em 10/10' }]),
      valores, salvarTexto: 'Mandar para cartório',
      aoSalvar: async v => {
        const sel = l.filter((t, i) => v['t' + i]);
        if (!sel.length) throw new Error('Marque pelo menos um título.');
        for (const t of sel) trocaTitulo(await CRM.store().atualizar('titulos', t.id, { cartorio_em: v.dia || hoje(), cartorio_obs: (v.obs || '').trim() || null, previsao: null }));
        CRM.render();
        CRM.toast(sel.length + ' título(s) em cartório (' + R.moeda(sel.reduce((s2, t) => s2 + Number(t.valor), 0)) + '): fora da previsão até o cliente pagar.');
      }
    });
  }
  async function tirarCartorio(dup) {
    const t = titulosAdmin().find(x => x.duplicata === dup);
    if (!t || !confirm('Tirar ' + nomeNF(t) + ' (' + R.moeda(t.valor) + ') do cartório? Ele volta para "A receber vencido" e para a cobrança da vendedora.')) return;
    trocaTitulo(await CRM.store().atualizar('titulos', t.id, { cartorio_em: null, cartorio_obs: null }));
    CRM.render();
    CRM.toast(nomeNF(t) + ' saiu do cartório.');
  }

  // ---- administrador: aba Cobrança do Caixa (boletos atualizados)
  let lendo = null; // { feitos, total }
  const TIPOS = /^(application\/pdf|image\/(png|jpeg|webp))$/;
  const vencidosACobrar = () => titulosAdmin().filter(t => t.vencimento < hoje() && !t.cartorio_em && t.empresa_id);
  const rotuloTitulo = t => CRM.nomeEmpresa(t.empresa_id) + ' · ' + nomeNF(t) + ' (' + t.duplicata + ') · ' + R.moeda(t.valor) + ' · venceu ' + dm(t.vencimento);

  async function lerArquivos(files) {
    const lista = [].slice.call(files || []).filter(f => TIPOS.test(f.type));
    if (!lista.length) { CRM.toast('Só PDF ou imagem (PNG, JPG) do boleto.', true); return; }
    if (lendo) return;
    const st = CRM.store(), h = hoje(), lidos = [], avisos = [];
    lendo = { feitos: 0, total: lista.length }; CRM.render();
    try {
      for (const f of lista) {
        try {
          const caminho = await st.boletoEnviar(f, h);
          const r = await st.boletoLer(caminho, h);
          const bs = (r && r.boletos) || [];
          if (!bs.length) avisos.push(f.name + ': nenhum boleto encontrado' + (r && r.aviso ? ' (' + r.aviso + ')' : ''));
          else if (r.aviso) avisos.push(f.name + ': ' + r.aviso);
          bs.forEach(b => lidos.push({ arquivo: f, caminho, b, varios: bs.length > 1 }));
        } catch (e) { avisos.push(f.name + ': ' + (e.message || e)); }
        lendo.feitos++; CRM.render();
      }
    } finally { lendo = null; CRM.render(); }
    if (!lidos.length) { CRM.toast('Nenhum boleto lido. ' + avisos.join(' · '), true); return; }
    conferir(lidos, avisos);
  }
  function conferir(lidos, avisos) {
    const venc = vencidosACobrar(), empresas = E().D.empresas || [], usados = new Set();
    const itens = lidos.map(x => {
      const conf = confereBoleto(x.b, hoje());
      const casa = casaBoleto(x.b, venc, empresas, usados);
      if (casa.titulo) usados.add(casa.titulo.duplicata);
      return Object.assign({}, x, { conf, casa });
    });
    const doc = d => String(d || '').replace(/\D/g, '');
    const valores = {};
    const campos = itens.map((x, i) => {
      // vencido não vai marcado: só se o administrador escolher o título de propósito
      valores['b' + i] = x.casa.titulo ? x.casa.titulo.duplicata : '';
      const docB = doc(x.b.documento);
      const ordem = venc.slice().sort((a, b) => {
        const pa = (x.casa.candidatos || []).indexOf(a) !== -1 || doc((CRM.empresa(a.empresa_id) || {}).cnpj) === docB ? 0 : 1;
        const pb = (x.casa.candidatos || []).indexOf(b) !== -1 || doc((CRM.empresa(b.empresa_id) || {}).cnpj) === docB ? 0 : 1;
        return pa - pb || CRM.nomeEmpresa(a.empresa_id).localeCompare(CRM.nomeEmpresa(b.empresa_id));
      });
      return { nome: 'b' + i, tipo: 'select', largo: true,
        rotulo: (x.b.pagador || 'Pagador não lido') + ' — ' + R.moeda(x.conf.valor) + (x.conf.juros > 0 ? ' (original ' + R.moeda(x.conf.valorOriginal) + ' + ' + R.moeda(x.conf.juros) + ' de juros e multa)' : '') +
          (x.conf.vencimento ? (x.conf.vencido ? ', venceu ' : ', vence ') + R.dataBR(x.conf.vencimento) : '') + (x.varios ? ' (pág. ' + x.b.pagina + ' de ' + x.arquivo.name + ')' : ''),
        opcoes: [['', '— não mandar este boleto —']].concat(ordem.map(t => [t.duplicata, rotuloTitulo(t)])),
        ajuda: [x.casa.titulo ? 'achado por ' + x.casa.como : 'escolha o título deste boleto', x.conf.linhaOk ? 'linha digitável conferida ✓' : ''].concat(x.conf.avisos).filter(Boolean).join(' · ') };
    });
    CRM.abrirForm({
      titulo: 'Conferir os boletos', largura: 'largo',
      intro: itens.length + ' boleto(s) lido(s). Cada um já vem com o título achado; confira e clique em "Mandar às vendedoras": cada boleto vai para a vendedora da carteira do cliente ' +
        '(Fila do dia, sino e ficha), com a mensagem pronta para ela mandar ao cliente. "Não mandar" só se o título estiver errado.' +
        (avisos.length ? '\nAtenção: ' + avisos.join(' · ') : ''),
      campos, valores, salvarTexto: 'Mandar às vendedoras',
      aoSalvar: async v => {
        const st = CRM.store(), escolhidos = new Set();
        let n = 0, semPdf = 0;
        for (let i = 0; i < itens.length; i++) {
          const dup = v['b' + i];
          if (!dup) continue;
          if (escolhidos.has(dup)) throw new Error('Dois boletos para o mesmo título (' + dup + '): deixe um em "não mandar".');
          escolhidos.add(dup);
        }
        for (let i = 0; i < itens.length; i++) {
          const x = itens[i], dup = v['b' + i];
          if (!dup) continue;
          const t = venc.find(y => y.duplicata === dup);
          if (!x.conf.vencimento || !(x.conf.valor > 0)) throw new Error('O boleto de ' + (x.b.pagador || '?') + ' veio sem valor ou vencimento: não dá para mandar.');
          // PDF com vários boletos: cada um vai em arquivo próprio (a vendedora não pode receber o de outro cliente)
          let arquivo = x.caminho;
          if (x.varios) {
            arquivo = null;
            if (x.arquivo.type === 'application/pdf') {
              try {
                await carrega('vendor/pdf-lib.min.js');
                const src = await raiz.PDFLib.PDFDocument.load(await x.arquivo.arrayBuffer());
                if (x.b.pagina >= 1 && x.b.pagina <= src.getPageCount()) {
                  const novo = await raiz.PDFLib.PDFDocument.create();
                  const [pg] = await novo.copyPages(src, [x.b.pagina - 1]);
                  novo.addPage(pg);
                  arquivo = await st.boletoEnviar(new Blob([await novo.save()], { type: 'application/pdf' }), hoje());
                }
              } catch (e) { arquivo = null; }
            }
            if (!arquivo) semPdf++;
          }
          const r = await st.inserir('boletos', { duplicata: t.duplicata, empresa_id: t.empresa_id, nota_numero: t.nota_numero || null, valor_original: Number(t.valor),
            valor: x.conf.valor, vencimento: x.conf.vencimento, linha_digitavel: x.conf.linha || null, arquivo });
          E().boletos = (E().boletos || []).concat([r]);
          n++;
        }
        CRM.render();
        CRM.toast(n + ' boleto(s) mandado(s) às vendedoras' + (semPdf ? ' · ' + semPdf + ' sem o PDF (não consegui separar a página): vão só com a linha digitável' : '') + '.');
      }
    });
  }
  function aba() {
    const venc = vencidosACobrar().sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const cart = titulosAdmin().filter(t => t.cartorio_em);
    const tot = l => l.reduce((s2, t) => s2 + Number(t.valor || 0), 0);
    const porVend = new Map();
    venc.forEach(t => { const e = CRM.empresa(t.empresa_id); const k = (e && e.responsavel_id) || ''; if (!porVend.has(k)) porVend.set(k, []); porVend.get(k).push(t); });
    const situacao = t => {
      const b = boletoAtual(E().boletos, t.duplicata);
      if (!b) return '<small>sem boleto atualizado</small>';
      return b.cobrado_em ? CRM.selo('enviado ' + dm(R.diaLocal(b.cobrado_em)) + (b.cobrado_por ? ' · ' + R.primeiroNome(CRM.nomeUsuario(b.cobrado_por)) : ''), 'verde') + '<small>' + esc(R.moeda(b.valor)) + ' · vence ' + esc(dm(b.vencimento)) + '</small>'
        : CRM.selo('com a vendedora', 'ambar') + '<small>' + esc(R.moeda(b.valor)) + ' · vence ' + esc(dm(b.vencimento)) + '</small>';
    };
    return '<section class="cartao cob-soltar" id="cobSoltar"><h2>Boletos atualizados</h2>' +
      (lendo ? '<p class="cob-lendo">Lendo os boletos… ' + lendo.feitos + ' de ' + lendo.total + '</p>' :
        '<p>Gere no Banco do Brasil a 2ª via atualizada (com juros) dos vencidos e <strong>arraste os PDFs aqui</strong> — vários de uma vez, ou um PDF com vários boletos. ' +
        'O CRM lê cada um (valor, vencimento, linha digitável), acha o título e você confere antes de mandar às vendedoras.</p>' +
        '<label class="btn sec arquivo">Escolher arquivos<input type="file" id="cobArq" multiple accept="application/pdf,image/png,image/jpeg,image/webp"></label>') + '</section>' +
      '<section class="cartao"><h2>Vencidos para cobrar <small>' + venc.length + ' título(s) · ' + esc(R.moeda(tot(venc))) + '</small></h2>' +
      (venc.length ? [...porVend.entries()].sort((a, b) => CRM.nomeUsuario(a[0]).localeCompare(CRM.nomeUsuario(b[0]))).map(([u, l]) =>
        '<h3>' + esc(u ? CRM.nomeUsuario(u) : 'Sem vendedora') + ' <small>' + l.length + ' · ' + esc(R.moeda(tot(l))) + '</small></h3>' +
        '<div class="tabela-rolagem"><table class="tabela"><tbody>' + l.map(t => '<tr><td><button type="button" class="link" data-acao="abrir-empresa" data-id="' + esc(t.empresa_id) + '">' + esc(CRM.nomeEmpresa(t.empresa_id)) + '</button>' +
          '<small>' + esc(nomeNF(t)) + ' · ' + esc(t.duplicata) + '</small></td><td>venceu ' + esc(R.dataBR(t.vencimento)) + '<small>' + R.diasEntre(t.vencimento, hoje()) + ' dias</small></td>' +
          '<td class="num">' + esc(R.moeda(t.valor)) + '</td><td>' + situacao(t) + '</td>' +
          '<td class="acoes-linha"><button type="button" class="mini perigo" data-acao="cob-cartorio" data-id="' + esc(t.duplicata) + '">Cartório</button></td></tr>').join('') + '</tbody></table></div>').join('')
        : '<p class="vazio">Nada vencido para cobrar. 👍</p>') + '</section>' +
      (cart.length ? '<section class="cartao"><h2>Em cartório <small>' + cart.length + ' · ' + esc(R.moeda(tot(cart))) + '</small></h2><div class="tabela-rolagem"><table class="tabela"><tbody>' +
        cart.map(t => '<tr><td>' + esc(CRM.nomeEmpresa(t.empresa_id) || t.cliente_nome || '') + '<small>' + esc(nomeNF(t)) + ' · ' + esc(t.duplicata) + (t.cartorio_obs ? ' · ' + esc(t.cartorio_obs) : '') + '</small></td>' +
          '<td>desde ' + esc(R.dataBR(t.cartorio_em)) + '</td><td class="num">' + esc(R.moeda(t.valor)) + '</td><td class="acoes-linha"><button type="button" class="mini" data-acao="cob-tirar-cartorio" data-id="' + esc(t.duplicata) + '">Tirar do cartório</button></td></tr>').join('') +
        '</tbody></table></div><p class="dica">Pagou? Dê "Recebi…" no bloco "Em cartório" do Dia a dia, com o valor que entrou.</p></section>' : '');
  }
  function depoisAba(el) {
    const arq = el.querySelector('#cobArq');
    if (arq) arq.addEventListener('change', () => { const f = [].slice.call(arq.files); arq.value = ''; lerArquivos(f).catch(CRM.falhou); });
    const zona = el.querySelector('#cobSoltar');
    if (!zona) return;
    zona.addEventListener('dragover', ev => { if (ev.dataTransfer && [].slice.call(ev.dataTransfer.types || []).indexOf('Files') !== -1) { ev.preventDefault(); zona.classList.add('cx-solta'); } });
    zona.addEventListener('dragleave', () => zona.classList.remove('cx-solta'));
    zona.addEventListener('drop', ev => { if (!ev.dataTransfer || !ev.dataTransfer.files.length) return; ev.preventDefault(); zona.classList.remove('cx-solta'); lerArquivos(ev.dataTransfer.files).catch(CRM.falhou); });
  }

  CRM.cobranca = { seloTitulo, blocoEmpresa, botoesEnvio, paraFila, formCartorio, aba, depoisAba, contagem: () => vencidosACobrar().length, pendentesDe };

  Object.assign(CRM.acoes, {
    'cob-whats': (id, el) => {
      const e = CRM.empresa(id), lista = pendentesDe(id), F = CRM.fichas;
      if (!e || !lista.length) return;
      const c = F.escolheContato(e, el && el.dataset.contato, x => R.linkWhatsApp(x.whatsapp || x.celular || x.telefone));
      const tel = F.telDe(e, c);
      const texto = mensagemBoleto((E().cfg || {}).modelo_boleto, lista, F.variaveis(e, c));
      // sem celular no cadastro (ou só telefone fixo): abre o WhatsApp para a vendedora escolher o contato
      const fixo = /^(55)?\d{2}[2-5]\d{7}$/.test(String(tel || '').replace(/\D/g, ''));
      const link = !fixo && R.linkWhatsApp(tel, texto) || 'https://wa.me/?text=' + encodeURIComponent(texto);
      raiz.open(link, '_blank', 'noopener'); // antes de qualquer espera (senão o navegador bloqueia)
      if (link.indexOf('https://wa.me/?') === 0) CRM.toast('Cliente sem celular no CRM: escolha o contato no WhatsApp. Depois cadastre o celular do financeiro na ficha.');
      (async () => {
        let baixou = 0;
        for (const b of lista) if (b.arquivo) { try { await baixa(b); baixou++; } catch (x) { CRM.falhou(x); } }
        await marcaCobrado(e, lista, c, texto, true);
        if (baixou) CRM.toast('O PDF do boleto foi baixado: anexe na conversa do WhatsApp (clipe → Documento).');
      })().catch(CRM.falhou);
    },
    'cob-feito': id => {
      const e = CRM.empresa(id), lista = pendentesDe(id);
      if (!e || !lista.length || !confirm('Marcar ' + (lista.length === 1 ? 'o boleto' : 'os ' + lista.length + ' boletos') + ' como enviado ao cliente (por e-mail, telefone…)?')) return;
      marcaCobrado(e, lista, null, '', false).catch(CRM.falhou);
    },
    'cob-copiar': id => {
      const b = boleto(id);
      if (!b || !b.linha_digitavel) return;
      const l = formataLinha(b.linha_digitavel);
      (navigator.clipboard ? navigator.clipboard.writeText(l) : Promise.reject(new Error('sem área de transferência')))
        .then(() => CRM.toast('Linha digitável copiada: ' + l)).catch(() => prompt('Copie a linha digitável:', l));
    },
    'cob-baixar': id => { const b = boleto(id); if (b && b.arquivo) baixa(b).catch(CRM.falhou); },
    'cob-cartorio': id => { fechaForm(); setTimeout(() => formCartorio(id), 0); },
    'cob-tirar-cartorio': id => { fechaForm(); tirarCartorio(id).catch(CRM.falhou); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
