/* CRM Sistemi Dalessi — cobrança (14/10/2026, pedido do Anderson): título em cartório e boleto
   atualizado (2ª via do BB, com juros) entregue ao(à) vendedor(a) com a mensagem pronta. Regras puras, sem
   tela (a tela do administrador é a aba Cobrança do Caixa, em caixa.js; a do(a) vendedor(a), a Fila do dia e
   a ficha). Fora do regras.js de propósito: o regras.js é o motor da crm-notas, fixado por hash.
   Testes: testes/cobranca.test.js. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  const digitos = v => String(v == null ? '' : v).replace(/\D/g, '');
  const doc = v => String(v == null ? '' : v).toUpperCase().replace(/[^0-9A-Z]/g, ''); // CPF/CNPJ (o CNPJ pode ter letras desde 07/2026)
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
    if (!l.ok) avisos.push('linha digitável: ' + l.motivo + ' — vai sem a linha (o(a) vendedor(a) manda o PDF)');
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
    const docDe = new Map((empresas || []).map(e => [e.id, doc(e.cnpj)]));
    const livres = (titulos || []).filter(t => !usados.has(t.duplicata) && !t.cartorio_em);
    const docB = doc(b.documento);
    const mesmoDoc = docB ? livres.filter(t => docDe.get(t.empresa_id) === docB || doc(t.cliente_doc) === docB) : [];
    const ndoc = digitos(b.numero_documento);
    const temNota = t => t.nota_numero && ndoc && ndoc.replace(/^0+/, '').indexOf(String(t.nota_numero)) === 0;
    const igualValor = t => b.valor_documento > 0 && Math.abs(Number(t.valor) - b.valor_documento) < 0.01;
    // desempate de parcelas iguais (16/10/2026): o vencimento original (a 2ª via do BB mantém o da linha
    // digitável) e a parcela escrita no "Nº do documento" ("002205/02", "2205-2")
    const mesmoVenc = t => !!b.vencimento && t.vencimento === b.vencimento;
    const parcB = (/[\/-]\s*0*(\d{1,3})\s*$/.exec(String(b.numero_documento || '')) || [])[1];
    const mesmaParcela = t => !!parcB && +String(t.duplicata).split('/')[1] === +parcB;
    const pega = (l, como) => (l.length === 1 ? { titulo: l[0], como } : null);
    return pega(mesmoDoc.filter(igualValor), 'CNPJ e valor') ||
      pega(mesmoDoc.filter(igualValor).filter(mesmoVenc), 'CNPJ, valor e vencimento') ||
      pega(mesmoDoc.filter(igualValor).filter(temNota).filter(mesmaParcela), 'CNPJ, valor e parcela') ||
      pega(mesmoDoc.filter(igualValor).filter(temNota), 'CNPJ, valor e nota') ||
      pega(mesmoDoc.filter(temNota), 'CNPJ e nota') ||
      pega(mesmoDoc, 'único vencido do CNPJ') ||
      pega(livres.filter(t => temNota(t) && igualValor(t)), 'nota e valor') ||
      { titulo: null, como: '', candidatos: mesmoDoc.length ? mesmoDoc : livres.filter(temNota) };
  }

  // ---- o que o(a) vendedor(a) tem para mandar
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
  // links: endereços do PDF completo (resumo, nota fiscal e boleto) para o cliente abrir — a mensagem do WhatsApp (wa.me)
  // só leva texto, então o PDF vai como link (20/10/2026, pedido do Anderson). Modelo próprio sem a frase do PDF: o link
  // vai numa linha no fim.
  function mensagemBoleto(modelo, lista, vars, links) {
    let t = R.aplicaModelo(modelo || MODELO_BOLETO, Object.assign({}, vars, { boletos: textoBoletos(lista), titulos_boleto: titulosBoleto(lista) }));
    // sem linha digitável (não deu para conferir): só o PDF
    if (!lista.some(b => b.linha_digitavel)) t = t.replace('É só copiar a linha digitável no app do banco. Também te mando o PDF aqui.', 'Te mando o PDF do boleto aqui.');
    const l = (links || []).filter(Boolean);
    if (!l.length) return t;
    const frase = (l.length === 1 ? 'O PDF com o boleto e a cópia da nota fiscal: ' : 'Os PDFs com os boletos e as cópias das notas fiscais: ') + l.join(' ');
    if (t.indexOf('Também te mando o PDF aqui.') !== -1) return t.replace('Também te mando o PDF aqui.', frase);
    if (t.indexOf('Te mando o PDF do boleto aqui.') !== -1) return t.replace('Te mando o PDF do boleto aqui.', frase);
    return t + '\n\n' + frase;
  }
  // um link por PDF (os boletos do mesmo cliente dividem o PDF completo); base = endereço do Supabase da instalação
  function linksPdf(lista, base) {
    if (!base) return [];
    const vistos = new Set();
    return lista.filter(b => b.arquivo && b.id && !vistos.has(b.arquivo) && vistos.add(b.arquivo)).map(b => String(base).replace(/\/+$/, '') + '/functions/v1/crm-pdf?b=' + b.id);
  }

  // números do cadastro do cliente que podem receber o boleto pelo WhatsApp da empresa (20/10/2026): celulares
  // primeiro, o contato principal antes, sem repetir; o servidor só aceita número que está no cadastro
  function telefonesCliente(e, contatos) {
    const wa = v => { let d = String(v || '').replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; return d.length >= 12 && d.length <= 13 ? d : ''; };
    const l = [], vistos = new Set();
    const poe = (v, rotulo, contatoId, principal) => {
      const d = wa(v);
      if (!d || vistos.has(d)) return;
      vistos.add(d);
      l.push({ tel: d, rotulo, contatoId: contatoId || '', celular: /^55\d{2}9\d{8}$/.test(d), principal: !!principal });
    };
    (contatos || []).forEach(c => ['whatsapp', 'celular', 'telefone'].forEach(k => poe(c[k], c.nome || 'contato', c.id, c.principal)));
    if (e) ['whatsapp', 'telefone'].forEach(k => poe(e[k], 'telefone da empresa'));
    return l.map((x, i) => [x, i]).sort((a, b) => (b[0].celular - a[0].celular) || (b[0].principal - a[0].principal) || a[1] - b[1]).map(x => x[0]);
  }

  const C = { telefonesCliente, lerLinha, linhaDeCodigo, formataLinha, dataDoFator, confereBoleto, casaBoleto, boletosPendentes, boletoAtual, mensagemBoleto, linksPdf, textoBoletos, MODELO_BOLETO };
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
  // Administrador: o contas a receber inteiro; gestora e vendedores(as): as duplicatas em atraso (crm_atrasos).
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

  // ---- vendedor(a): o boleto atualizado na ficha, na Fila do dia e no título
  function seloTitulo(t) {
    const b = boletoAtual(E().boletos, t.duplicata);
    if (!b) return '';
    if (b.cli_pagou_em) return ' ' + CRM.selo('cliente disse que pagou ' + dm(R.diaLocal(b.cli_pagou_em)) + ' — o financeiro confere', 'verde');
    if (b.cli_em) return ' ' + seloCliente(b);
    if (b.cobrado_em) return ' ' + CRM.selo('boleto atualizado enviado ' + dm(R.diaLocal(b.cobrado_em)) + (b.cobrado_por ? ' por ' + R.primeiroNome(CRM.nomeUsuario(b.cobrado_por)) : ''), 'verde');
    return ' ' + CRM.selo('boleto atualizado ' + R.moeda(b.valor) + ' · vence ' + dm(b.vencimento) + ' — enviar', 'ambar');
  }
  // mensagem ao cliente pelo número da empresa (modelo boleto_cliente aprovado na Meta): PDF anexo, em nome do(a)
  // vendedor(a), aviso cordial do cartório e os botões "Falar comigo" e "Já paguei" (o retorno vira tarefa)
  let cliOk = false, cliLido = 0;
  function cliSituacao() {
    if (!CRM.store().whatsapp || Date.now() - cliLido < 600000) return;
    cliLido = Date.now();
    CRM.store().whatsapp({ acao: 'pronto' }).then(r => { const antes = cliOk; cliOk = !!(r && r.cliente); if (antes !== cliOk) CRM.render(); }).catch(() => {});
  }
  const ST_CLI = { enviado: ['enviado', 'azul'], entregue: ['entregue', 'azul'], lido: ['lido', 'verde'], falhou: ['não chegou', 'vermelho'] };
  function seloCliente(b) {
    const st = ST_CLI[b.cli_status] || [b.cli_status || '', 'azul'];
    const venceu = b.cli_prazo && b.cli_prazo < hoje() && !b.cli_pagou_em;
    return CRM.selo('no WhatsApp do cliente ' + dm(R.diaLocal(b.cli_em)) + ' · ' + st[0], st[1]) +
      (b.cli_status === 'falhou' && b.cli_erro ? ' <small>' + esc(b.cli_erro) + '</small>' : '') +
      (b.cli_pagou_em ? ' ' + CRM.selo('cliente disse que pagou ' + dm(R.diaLocal(b.cli_pagou_em)), 'verde')
        : b.cli_prazo ? ' ' + CRM.selo((venceu ? 'prazo do cartório venceu ' : 'cartório em ') + dm(b.cli_prazo), venceu ? 'vermelho' : 'ambar') : '') +
      (b.cli_falou_em ? ' <small>tocou em "Falar comigo"</small>' : '');
  }
  const podeCliente = l => cliOk && l.some(b => b.arquivo);
  const botoesEnvio = (id, grande) => { cliSituacao(); const meta = podeCliente(pendentesDe(id)); return (meta ? '<button type="button" class="' + (grande ? 'btn ouro' : 'mini wa') + '" data-acao="cob-cliente" data-id="' + esc(id) + '" title="o cliente recebe do número da empresa, em seu nome, o PDF anexo, o valor, a linha digitável e os botões Falar comigo e Já paguei">📲 Mandar ao cliente pelo WhatsApp da ' + esc(CRM.nomeInstalacao()) + '</button> ' : '') +
    '<button type="button" class="' + (meta ? (grande ? 'btn sec' : 'mini') : grande ? 'btn ouro' : 'mini wa') + '" data-acao="cob-whats" data-id="' + esc(id) + '" title="abre a conversa do cliente com a mensagem e o link do PDF (boleto e nota fiscal)">' + (meta ? 'ou pelo meu WhatsApp, com o link' : 'WhatsApp com o boleto e o PDF') + '</button> ' +
    (podeCompartilhar() && pendentesDe(id).some(b => b.arquivo) ? '<button type="button" class="' + (grande ? 'btn sec' : 'mini') + '" data-acao="cob-compartilhar" data-id="' + esc(id) + '" title="manda o ARQUIVO PDF (resumo, nota fiscal e boleto) pelo WhatsApp ou outro app; você escolhe o contato">📎 Mandar o arquivo PDF</button> ' : '') +
    '<button type="button" class="' + (grande ? 'btn sec' : 'mini') + '" data-acao="cob-feito" data-id="' + esc(id) + '" title="mandou por outro caminho (e-mail, telefone): marca como enviado">Já mandei</button>'; };
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
  // ---- PDF completo (14/10/2026, pedido do Anderson: "cada boleto fosse mesmo em PDF, não o link", e o cliente
  // pediu a cópia da nota): página 1 = resumo com a cara da instalação (valores, linha digitável, como pagar);
  // depois a DANFE de cada nota, gerada do XML guardado (danfe.js); por fim o PDF do banco, como veio.
  // Montado no navegador do administrador ao mandar aos(às) vendedores(as); vira o "arquivo" do boleto (o do banco fica
  // em arquivo_banco), então o link, o Baixar PDF e o Compartilhar já levam o completo.
  const LARGURA = 794, ALTURA = 1123; // A4 a 96 dpi
  const BANCOS = { '001': 'Banco do Brasil', '104': 'Caixa', '237': 'Bradesco', '341': 'Itaú', '033': 'Santander', '077': 'Inter', '756': 'Sicoob', '748': 'Sicredi' };
  const doBanco = b => { const n = BANCOS[String(b.linha_digitavel || '').slice(0, 3)]; return n ? 'do ' + n : 'do banco'; };
  const diaB = b => R.diaLocal(b.criado_em || new Date().toISOString());
  const comJuros = b => Number(b.valor_original) > 0 && Number(b.valor) > Number(b.valor_original) + 0.005;
  const nomeArquivo = (e, l) => ('Boleto atualizado - ' + l.map(nomeNF).join(', ') + ' - ' + (e ? e.nome : '')).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + '.pdf';
  function resumoHtml(e, l, danfes, pagBoleto) {
    const cfg = E().cfg || {}, b0 = l[0], um = l.length === 1, h = diaB(b0);
    // mascote da cobrança da instalação (turma.js), no canto da chamada
    const mascote = CRM.turma && (raiz.CRM_CONFIG.turma.telas || {})['caixa:cobranca'] ? CRM.turma.img(raiz.CRM_CONFIG.turma.telas['caixa:cobranca']) : null;
    const venceu = l.some(b => b.vencimento < h);
    const doc = e && e.cnpj ? (R.ehCPF(R.chaveDoc(e.cnpj)) ? 'CPF ' : 'CNPJ ') + e.cnpj : '';
    const total = l.reduce((s, b) => s + Number(b.valor || 0), 0);
    const notas = [...new Set(l.map(b => b.nota_numero).filter(Boolean))];
    const sub = venceu ? 'pagando depois de ' + dm(h) + ', o banco soma os encargos do dia' : 'vence em ' + R.dataBR(b0.vencimento);
    const valores = um
      ? '<section class="valores"><div class="contas">' + (comJuros(b0)
          ? '<div><span>Valor original</span><b>' + esc(R.moeda(b0.valor_original)) + '</b></div><div class="juros"><span>Juros e multa até ' + esc(dm(h)) + '</span><b>+ ' + esc(R.moeda(b0.valor - b0.valor_original)) + '</b></div>'
          : '<div><span>Valor do boleto</span><b>' + esc(R.moeda(b0.valor)) + '</b></div>') +
        '<div><span>' + (venceu ? 'Vencimento original' : 'Vencimento') + '</span><b>' + esc(R.dataBR(b0.vencimento)) + '</b></div></div>' +
        '<div class="pagar"><span class="rot">Valor para pagar</span><strong>' + esc(R.moeda(b0.valor)) + '</strong><span class="sub">' + esc(sub) + '</span></div></section>'
      : '<section class="valores"><div class="contas">' + l.map(b => '<div><span>' + esc(nomeNF(b)) + ' · vencimento ' + esc(dm(b.vencimento)) + (comJuros(b) ? ' · com juros' : '') + '</span><b>' + esc(R.moeda(b.valor)) + '</b></div>').join('') + '</div>' +
        '<div class="pagar"><span class="rot">Total para pagar</span><strong>' + esc(R.moeda(total)) + '</strong><span class="sub">' + l.length + ' boletos · ' + esc(sub) + '</span></div></section>';
    const linhas = l.filter(b => b.linha_digitavel);
    const anexos = ['Este resumo'].concat(danfes.map(d => 'Cópia da nota fiscal (DANFE) ' + d.numero), [um ? 'Boleto atualizado ' + doBanco(b0) : 'Boletos atualizados ' + doBanco(b0)]);
    return '<div class="proposta-doc bol">' +
      '<div class="faixa-doc"></div>' +
      '<header><img src="' + esc(CRM.logo()) + '" alt="' + esc(CRM.nomeInstalacao()) + '"><div class="doc-id"><strong>' + (um ? 'Boleto atualizado' : 'Boletos atualizados') + '</strong>' +
        '<span>' + esc(um ? nomeNF(b0) + ' · duplicata ' + b0.duplicata : notas.length ? 'NF ' + notas.join(', ') : l.length + ' duplicatas') + '</span><span>Atualizado em ' + esc(R.dataBR(h)) + '</span></div></header>' +
      '<section class="chamada' + (mascote ? ' com-mascote' : '') + '"><div><h1>' + (um ? 'Seu boleto, já com tudo calculado' : 'Seus boletos, já com tudo calculado') + '</h1><p>Atualizamos ' + (um ? 'o boleto em aberto' : 'os boletos em aberto') + ' para facilitar o pagamento. ' +
        (danfes.length ? 'Junto vão a cópia da nota fiscal e o boleto do banco.' : 'Junto vai o boleto do banco.') + '</p></div>' + (mascote ? '<img class="mascote" src="' + esc(mascote) + '" alt="">' : '') + '</section>' +
      '<section class="preparado"><h2>Preparado para</h2><p class="nome">' + esc(String((e && (e.razao_social || e.nome)) || '').toUpperCase()) + '</p>' +
        '<p>' + [doc, notas.length ? (notas.length === 1 ? 'Nota fiscal ' : 'Notas fiscais ') + notas.join(', ') : '', um ? (venceu ? 'venceu em ' : 'vence em ') + R.dataBR(b0.vencimento) : ''].filter(Boolean).map(esc).join('&nbsp; | &nbsp;') + '</p></section>' +
      valores +
      (linhas.length ? '<section class="linha"><h2>Linha digitável</h2>' + linhas.map(b => (linhas.length > 1 ? '<small>' + esc(nomeNF(b)) + '</small>' : '') + '<code>' + esc(formataLinha(b.linha_digitavel)) + '</code>').join('') +
        '<small>Copie e cole no app do seu banco, em "Pagar boleto".</small></section>' : '') +
      '<section class="passos"><div><b><i>1</i>Pelo app do banco</b><span>' + (linhas.length ? 'Pagar boleto → cole a linha digitável acima.' : 'Pagar boleto → leia o código de barras do boleto.') + '</span></div>' +
        '<div><b><i>2</i>Pelo código de barras</b><span>Use o boleto ' + esc(doBanco(b0)) + ', na página ' + pagBoleto + '.</span></div>' +
        '<div><b><i>3</i>Já pagou?</b><span>Desconsidere este aviso e responda a mensagem em que o recebeu, com o comprovante.</span></div></section>' +
      '<section class="anexos"><h2>Neste arquivo</h2><div>' + anexos.map((a, i) => '<span><i>' + (i + 1) + '</i>' + esc(a) + '</span>').join('') + '</div></section>' +
      '<div class="rodape"><footer>' + esc(cfg.proposta_rodape || CRM.nomeInstalacao()) + '</footer>' +
        (cfg.sem_assinatura ? '' : '<p class="assinatura">Documento gerado pelo CRM <strong>Sistemi Dalessi</strong> · sistemas sob medida · ' + esc(CRM.ASSINATURA_EMAIL) + '</p>') + '</div></div>';
  }
  // logo da instalação em dataURL (para o quadro do emitente na DANFE); sem logo, a DANFE sai só com o texto
  let logoDanfe = null;
  const pegaLogo = () => logoDanfe || (logoDanfe = new Promise(ok => {
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        cv.getContext('2d').drawImage(img, 0, 0);
        ok({ data: cv.toDataURL('image/png'), formato: 'PNG', proporcao: img.naturalWidth / img.naturalHeight });
      } catch (e) { ok(null); }
    };
    img.onerror = () => ok(null);
    img.src = CRM.logo();
  }));
  // WEBP → PNG (o pdf-lib só embute PNG e JPG). Por data: URL, que a política de segurança da página aceita.
  async function paraPng(blob) {
    const u = await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => falha(r.error); r.readAsDataURL(blob); });
    const img = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error('imagem do boleto não abriu')); i.src = u; });
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    cv.getContext('2d').drawImage(img, 0, 0);
    return await new Promise(ok => cv.toBlob(ok, 'image/png'));
  }
  // l: boletos do mesmo cliente. Devolve { blob, nome, danfes, semNota }.
  async function montaPdf(e, l) {
    await Promise.all(['vendor/html2canvas.min.js', 'vendor/jspdf.umd.min.js', 'vendor/pdf-lib.min.js'].map(carrega));
    const st = CRM.store(), Dn = raiz.CRMDanfe;
    const pdf = new raiz.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    // DANFEs primeiro (da página 2 em diante), para o resumo saber em que página fica o boleto
    const danfes = [], semNota = [], logo = await pegaLogo();
    for (const n of [...new Set(l.map(b => b.nota_numero).filter(Boolean))]) {
      const nota = (E().D.notas || []).find(x => String(x.numero) === String(n) && x.chave && !x.cancelada);
      const xml = nota ? await st.notaXml(nota.chave).catch(() => null) : null;
      const d = xml && Dn && Dn.ler(xml);
      if (!d) { semNota.push(n); continue; }
      pdf.addPage('a4', 'portrait');
      Dn.desenha(pdf, d, { logo, cores: (raiz.CRM_CONFIG || {}).cores });
      danfes.push({ numero: n });
    }
    const pagBoleto = pdf.getNumberOfPages() + 1;
    // resumo na página 1
    const palco = document.createElement('div');
    palco.className = 'pdf-palco';
    palco.innerHTML = resumoHtml(e, l, danfes, pagBoleto);
    document.body.appendChild(palco);
    try {
      const doc = palco.firstElementChild;
      const imgs = [...doc.querySelectorAll('img')].filter(i => !i.complete);
      await Promise.race([Promise.all(imgs.map(i => new Promise(ok => { i.onload = i.onerror = ok; }))), new Promise(ok => setTimeout(ok, 4000))]);
      const canvas = await raiz.html2canvas(doc, { scale: 2, backgroundColor: '#ffffff', logging: false, width: LARGURA, height: ALTURA, windowWidth: LARGURA, windowHeight: ALTURA + 50, scrollX: 0, scrollY: 0 });
      pdf.setPage(1);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
    } finally { palco.remove(); }
    // boleto(s) do banco, como vieram
    const P = raiz.PDFLib, out = await P.PDFDocument.load(pdf.output('arraybuffer'));
    for (const b of l) {
      const cam = b.arquivo_banco || b.arquivo;
      if (!cam) continue;
      const blob = await st.boletoArquivo(cam);
      if (/\.pdf$/i.test(cam) || blob.type === 'application/pdf') {
        const src = await P.PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
        (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
      } else {
        const png = /\.png$/i.test(cam) ? blob : /\.jpe?g$/i.test(cam) ? null : await paraPng(blob);
        const img = png ? await out.embedPng(await png.arrayBuffer()) : await out.embedJpg(await blob.arrayBuffer());
        const pg = out.addPage([595.28, 841.89]), m = 28, s = Math.min((595.28 - 2 * m) / img.width, (841.89 - 2 * m) / img.height);
        pg.drawImage(img, { x: (595.28 - img.width * s) / 2, y: 841.89 - m - img.height * s, width: img.width * s, height: img.height * s });
      }
    }
    out.setTitle(nomeArquivo(e, l).replace(/\.pdf$/, ''));
    out.setProducer('CRM Sistemi Dalessi');
    return { blob: new Blob([await out.save()], { type: 'application/pdf' }), nome: nomeArquivo(e, l), danfes, semNota };
  }
  // Monta o PDF de cada cliente e troca o arquivo dos boletos por ele. Devolve quantos clientes ficaram sem.
  async function comporPdfs(lista) {
    const porEmp = new Map();
    lista.filter(b => b.empresa_id && (b.arquivo || b.arquivo_banco)).forEach(b => { if (!porEmp.has(b.empresa_id)) porEmp.set(b.empresa_id, []); porEmp.get(b.empresa_id).push(b); });
    let falhas = 0, semNota = 0, k = 0;
    for (const [id, l] of porEmp) {
      CRM.toast('Montando o PDF de cada cliente (resumo, nota fiscal e boleto): ' + (++k) + ' de ' + porEmp.size + '…');
      try {
        const r = await montaPdf(CRM.empresa(id), l);
        semNota += r.semNota.length;
        const caminho = await CRM.store().boletoEnviar(r.blob, hoje());
        for (const b of l) {
          const novo = await CRM.store().atualizar('boletos', b.id, { arquivo: caminho, arquivo_banco: b.arquivo_banco || b.arquivo });
          E().boletos = (E().boletos || []).map(x => (x.id === b.id ? Object.assign({}, x, novo) : x));
        }
      } catch (e) { falhas++; console.warn('PDF completo', e); }
    }
    return { falhas, semNota, clientes: porEmp.size };
  }

  // ---- Compartilhar: manda o arquivo de verdade (Windows e celular), em vez do link
  const cacheArq = {};
  const arquivoDe = (caminho, nome) => cacheArq[caminho] || (cacheArq[caminho] = CRM.store().boletoArquivo(caminho)
    .then(bl => new File([bl], nome, { type: bl.type || 'application/pdf' })).catch(e => { delete cacheArq[caminho]; throw e; }));
  const podeCompartilhar = () => {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })] })); } catch (e) { return false; }
  };
  // um arquivo por cliente (os boletos do mesmo cliente dividem o PDF completo)
  function arquivosDe(lista) {
    const vistos = new Map();
    lista.filter(b => b.arquivo).forEach(b => { if (!vistos.has(b.arquivo)) vistos.set(b.arquivo, []); vistos.get(b.arquivo).push(b); });
    return Promise.all([...vistos.entries()].map(([cam, l]) => arquivoDe(cam, b2nome(l))));
  }
  const b2nome = l => (l[0].arquivo_banco ? nomeArquivo(CRM.empresa(l[0].empresa_id), l) : 'Boleto ' + l.map(nomeNF).join(', ').replace(/\//g, '-') + '.pdf');
  // true = compartilhou; false = a pessoa cancelou; lança erro se não deu
  async function compartilha(files, texto) {
    if (!files.length) throw new Error('não há PDF para compartilhar');
    try { if (navigator.clipboard && texto) await navigator.clipboard.writeText(texto); } catch (e) { /* segue sem copiar */ }
    try { await navigator.share({ files, text: texto }); return true; } catch (e) {
      if (e && e.name === 'AbortError') return false;
      if (e && e.name === 'NotAllowedError') throw new Error('o PDF ficou pronto agora: clique de novo em Compartilhar');
      throw e;
    }
  }
  async function marcaCobrado(e, lista, c, texto, peloZap) {
    const ids = lista.map(b => b.id);
    await CRM.store().boletoCobrado(ids);
    const agora = new Date().toISOString(), eu = CRM.meuId();
    E().boletos = (E().boletos || []).map(b => (ids.indexOf(b.id) !== -1 && !b.cobrado_em ? Object.assign({}, b, { cobrado_em: agora, cobrado_por: eu }) : b));
    const F = CRM.fichas;
    const a = await F.registraAuto(e, c, peloZap ? 'whatsapp' : 'nota', 'Boleto atualizado enviado' + (peloZap ? ' pelo WhatsApp' + (c ? ' a ' + c.nome : '') : ' (por outro caminho)') + ': ' +
      lista.map(b => nomeNF(b) + ' ' + R.moeda(b.valor) + ', vence ' + R.dataBR(b.vencimento)).join('; ') + (texto ? '\n' + texto : ''));
    await concluiTarefas(e.id);
    if (peloZap && a) F.esperaVolta(e, c, a, 'whatsapp');
    CRM.render();
  }

  // ---- boleto ao cliente pelo WhatsApp da empresa (vendedor(a) da carteira, gestor(a) ou admin)
  function formCliente(e, lista) {
    const tels = telefonesCliente(e, CRM.doEmpresa('contatos', e.id));
    if (!tels.length) { CRM.toast('Cliente sem telefone no CRM: cadastre o celular do financeiro na ficha.', true); return; }
    const dias = Number((E().cfg || {}).cobranca_prazo_cartorio) || 5;
    const vend = CRM.nomeUsuario(e.responsavel_id);
    CRM.abrirForm({
      titulo: 'Mandar ao cliente pelo WhatsApp da ' + CRM.nomeInstalacao(),
      intro: 'O cliente recebe do número da empresa, em nome de ' + R.primeiroNome(vend) + ': o PDF completo anexo (resumo, nota fiscal e boleto), o valor atualizado, a linha digitável ' +
        'e um aviso cordial de que, se não for pago em ' + dias + ' dias úteis, o título segue para o cartório. Dois botões: "Falar comigo" abre o WhatsApp de ' + R.primeiroNome(vend) +
        ' com a mensagem pronta, e "Já paguei" avisa ' + R.primeiroNome(vend) + ' e o financeiro (vira tarefa). Se o cliente responder, também vira tarefa.',
      htmlAntes: '<ul class="cob-lista">' + lista.map(b => '<li>' + esc(nomeNF(b)) + ': <strong>' + esc(R.moeda(b.valor)) + '</strong>' +
        (Number(b.valor) > Number(b.valor_original) + 0.005 ? ' <small>(original ' + esc(R.moeda(b.valor_original)) + ')</small>' : '') + ', venceu ' + esc(R.dataBR(b.vencimento)) + '</li>').join('') + '</ul>',
      campos: [{ nome: 'tel', rotulo: 'Para qual número', tipo: 'select', largo: true, opcoes: tels.map(x => [x.tel, x.rotulo + ' · ' + telBR(x.tel) + (x.celular ? '' : ' (fixo: só se tiver WhatsApp)')]) }],
      valores: { tel: tels[0].tel },
      salvarTexto: 'Mandar',
      aoSalvar: async v => {
        const r = await mandaAoCliente(e, lista, tels.find(x => x.tel === v.tel) || { tel: v.tel });
        CRM.render();
        CRM.toast('Mandado a ' + telBR(r.para) + ' com o PDF anexo. Se o cliente tocar em "Já paguei" ou responder, vira tarefa.');
      }
    });
  }
  // manda os boletos de um cliente pelo número da empresa (modelo boleto_cliente) e tira da cobrança do(a) vendedor(a)
  async function mandaAoCliente(e, lista, sel) {
    const r = await CRM.store().whatsapp({ acao: 'cliente', boletos: lista.map(b => b.id), telefone: sel.tel });
    const agora = new Date().toISOString(), ids = new Set(lista.map(b => b.id));
    E().boletos = (E().boletos || []).map(b => (ids.has(b.id) ? Object.assign({}, b, { cli_msg: r.id, cli_status: 'enviado', cli_em: agora, cli_erro: null, cli_tel: r.para, cli_prazo: r.prazo,
      cobrado_em: b.cobrado_em || agora, cobrado_por: b.cobrado_por || CRM.meuId() }) : b));
    const c = sel.contatoId ? CRM.contato(sel.contatoId) : null;
    await CRM.fichas.registraAuto(e, c, 'whatsapp', 'Boleto atualizado enviado ao cliente pelo WhatsApp da ' + CRM.nomeInstalacao() + ' (' + telBR(r.para) + '), com o PDF anexo: ' +
      lista.map(b => nomeNF(b) + ' ' + R.moeda(b.valor)).join('; ') + '. Na mensagem, o cartório depois de ' + R.dataBR(r.prazo) + '.');
    await concluiTarefas(e.id);
    return r;
  }

  // ---- 21/10/2026 (Anderson: "gostaria de mandar direto para o cliente; mandar para a vendedora e para o cliente fica ruim,
  // o cliente vai receber duas vezes; para elas só tem que aparecer que está em atraso"): com o modelo do cliente aprovado na
  // Meta, a cobrança vai DIRETO ao cliente pelo número da empresa, sem tarefa nem mensagem para o(a) vendedor(a), que fica só
  // com o selo de título em atraso. Mandar às vendedoras continua como reserva (cliente sem celular no cadastro, por exemplo).
  // o que já foi mandado ao(à) vendedor(a) fica com ela (senão o cliente recebe duas vezes; Anderson, 21/10: "a partir do próximo")
  const paraClientes = () => pendentes().filter(b => b.arquivo && !b.cli_em && !b.avisado_em);
  function porCliente(lista) {
    const g = new Map();
    lista.forEach(b => { if (b.empresa_id) { if (!g.has(b.empresa_id)) g.set(b.empresa_id, []); g.get(b.empresa_id).push(b); } });
    return [...g.entries()].map(([id, l]) => {
      const e = CRM.empresa(id);
      return { e, l, tel: e ? telefonesCliente(e, CRM.doEmpresa('contatos', e.id)).find(x => x.celular) || null : null };
    }).filter(x => x.e).sort((a, b) => CRM.nomeEmpresa(a.e.id).localeCompare(CRM.nomeEmpresa(b.e.id)));
  }
  function formDiretoClientes(lista) {
    const grupos = porCliente(lista || paraClientes()), comTel = grupos.filter(x => x.tel), semTel = grupos.filter(x => !x.tel);
    if (!grupos.length) return;
    const dias = Number((E().cfg || {}).cobranca_prazo_cartorio) || 5;
    CRM.abrirForm({
      titulo: 'Enviar direto aos clientes', largura: 'largo',
      intro: 'Cada cliente recebe do WhatsApp da ' + CRM.nomeInstalacao() + ', em nome do(a) vendedor(a) da carteira: o PDF completo anexo (resumo, nota fiscal e boleto), o valor atualizado, ' +
        'a linha digitável e o aviso cordial de que, se não for pago em ' + dias + ' dias úteis, o título segue para o cartório. "Já paguei" e as respostas viram tarefa.\n' +
        'Os(as) vendedores(as) não recebem nada: veem só o selo de título em atraso (para não venderem de novo sem acertar).',
      htmlAntes: '<ul class="cob-lista">' + comTel.map(x => '<li><strong>' + esc(CRM.nomeEmpresa(x.e.id)) + '</strong> · ' + esc(x.l.map(b => nomeNF(b) + ' ' + R.moeda(b.valor)).join(', ')) +
          ' → ' + esc(x.tel.rotulo) + ' ' + esc(telBR(x.tel.tel)) + '</li>').join('') + '</ul>' +
        (semTel.length ? '<p class="neg">Sem celular no cadastro (não vão): ' + esc(semTel.map(x => CRM.nomeEmpresa(x.e.id)).join(', ')) + '. Cadastre o celular do financeiro na ficha, ou mande pelo(a) vendedor(a).</p>' : ''),
      campos: [], salvarTexto: 'Enviar direto aos clientes (' + comTel.length + ')',
      rodape: '<button type="button" class="btn sec" data-acao="cob-para-vendedoras">ou mandar às vendedoras</button>',
      aoSalvar: async () => {
        if (!comTel.length) throw new Error('Nenhum cliente com celular no cadastro.');
        const ok = [], falhas = [];
        for (const x of comTel) {
          try { await mandaAoCliente(x.e, x.l, x.tel); ok.push(x); } catch (e) { falhas.push(CRM.nomeEmpresa(x.e.id) + ' (' + (e.message || e) + ')'); }
        }
        CRM.render();
        CRM.toast(ok.length + ' cliente(s) receberam o boleto com o PDF pelo WhatsApp da ' + CRM.nomeInstalacao() + '.' + (falhas.length ? ' Falharam: ' + falhas.join('; ') + '.' : '') +
          (semTel.length ? ' ' + semTel.length + ' sem celular ficaram na Cobrança.' : ''), !!falhas.length);
      }
    });
  }

  // ---- administrador: cartório
  function formCartorio(dup) {
    const t0 = titulosAdmin().find(t => t.duplicata === dup);
    if (!t0 || !t0.empresa_id) return;
    const l = titulosAdmin().filter(t => t.empresa_id === t0.empresa_id && t.vencimento < hoje() && !t.cartorio_em).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const valores = { dia: hoje(), obs: '' };
    l.forEach((t, i) => { valores['t' + i] = true; });
    CRM.abrirForm({
      titulo: 'Mandar para cartório', intro: CRM.nomeEmpresa(t0.empresa_id) + '\nMarque os títulos que foram para o cartório. Eles saem da previsão do caixa e da cobrança: o(a) vendedor(a) vê o selo "em cartório" e não cobra. ' +
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
    if (!t || !confirm('Tirar ' + nomeNF(t) + ' (' + R.moeda(t.valor) + ') do cartório? Ele volta para "A receber vencido" e para a cobrança do(a) vendedor(a).')) return;
    trocaTitulo(await CRM.store().atualizar('titulos', t.id, { cartorio_em: null, cartorio_obs: null }));
    CRM.render();
    CRM.toast(nomeNF(t) + ' saiu do cartório.');
  }

  // ---- administrador: aba Cobrança do Caixa (boletos atualizados)
  let lendo = null; // { feitos, total }
  const TIPOS = /^(application\/pdf|image\/(png|jpeg|webp))$/;
  const vencidosACobrar = () => titulosAdmin().filter(t => t.vencimento < hoje() && !t.cartorio_em && t.empresa_id);
  // 21/10/2026: o nome que veio na nota aparece junto quando é diferente do cadastro (a NF 2428 da DFISIO estava ligada a
  // outro cadastro e não se achava pelo nome na lista)
  const rotuloTitulo = t => {
    const cad = CRM.nomeEmpresa(t.empresa_id), nf = String(t.cliente_nome || '').trim();
    return cad + (nf && R.normaliza(nf) !== R.normaliza(cad) ? ' [na nota: ' + nf + ']' : '') + ' · ' + nomeNF(t) + ' (' + t.duplicata + ') · ' + R.moeda(t.valor) + ' · venceu ' + dm(t.vencimento);
  };

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
    cliLido = 0; cliSituacao(); // confere de novo se o modelo do cliente está aprovado (decide para onde vai depois)
    const venc = vencidosACobrar(), empresas = E().D.empresas || [], usados = new Set();
    const itens = lidos.map(x => {
      const conf = confereBoleto(x.b, hoje());
      // boleto já mandado (mesma linha digitável): reenviar o lote não duplica
      const ja = conf.linha && (E().boletos || []).find(y => y.linha_digitavel === conf.linha);
      // o vencimento que vale para achar o título é o original (o da linha digitável)
      const casa = ja ? { titulo: null, como: '', candidatos: [] } : casaBoleto(Object.assign({}, x.b, { vencimento: conf.vencimento || x.b.vencimento }), venc, empresas, usados);
      if (casa.titulo) usados.add(casa.titulo.duplicata);
      return Object.assign({}, x, { conf, casa, ja });
    });
    const valores = {};
    const campos = itens.map((x, i) => {
      // sem título achado fica "escolha o título" (não deixa mandar sem escolher); já mandado vem "não mandar"
      valores['b' + i] = x.ja ? 'nao' : x.casa.titulo ? x.casa.titulo.duplicata : '';
      // primeiro os candidatos e os do mesmo CNPJ (do cadastro ou da nota; a raiz basta: matriz e filiais)
      const docB = doc(x.b.documento), raizB = docB.length === 14 ? docB.slice(0, 8) : docB;
      const doMesmo = t => { const ds = [doc((CRM.empresa(t.empresa_id) || {}).cnpj), doc(t.cliente_doc)]; return !!raizB && ds.some(d => d && (d === docB || (d.length === 14 && d.slice(0, 8) === raizB))); };
      const ordem = venc.slice().sort((a, b) => {
        const pa = (x.casa.candidatos || []).indexOf(a) !== -1 || doMesmo(a) ? 0 : 1;
        const pb = (x.casa.candidatos || []).indexOf(b) !== -1 || doMesmo(b) ? 0 : 1;
        return pa - pb || CRM.nomeEmpresa(a.empresa_id).localeCompare(CRM.nomeEmpresa(b.empresa_id));
      });
      return { nome: 'b' + i, tipo: 'select', largo: true,
        rotulo: (x.b.pagador || 'Pagador não lido') + ' — ' + R.moeda(x.conf.valor) + (x.conf.juros > 0 ? ' (original ' + R.moeda(x.conf.valorOriginal) + ' + ' + R.moeda(x.conf.juros) + ' de juros e multa)' : '') +
          (x.conf.vencimento ? (x.conf.vencido ? ', venceu ' : ', vence ') + R.dataBR(x.conf.vencimento) : '') + (x.varios ? ' (pág. ' + x.b.pagina + ' de ' + x.arquivo.name + ')' : ''),
        opcoes: [['', '— escolha o título deste boleto —'], ['nao', '— não mandar este boleto —']].concat(ordem.map(t => [t.duplicata, rotuloTitulo(t)])),
        ajuda: [x.ja ? 'já mandado em ' + dm(R.diaLocal(x.ja.criado_em)) + ' (' + CRM.nomeEmpresa(x.ja.empresa_id) + ')' : x.casa.titulo ? 'achado por ' + x.casa.como : '⚠ não achei o título sozinho: escolha na lista',
          x.conf.linhaOk ? 'linha digitável conferida ✓' : ''].concat(x.conf.avisos).filter(Boolean).join(' · ') };
    });
    CRM.abrirForm({
      titulo: 'Conferir os boletos', largura: 'largo',
      intro: itens.length + ' boleto(s) lido(s)' + (itens.some(x => !x.ja && !x.casa.titulo) ? ' — os marcados com ⚠ eu não achei sozinho: escolha o título na lista' : '') +
        (itens.some(x => x.ja) ? ' — os já mandados vêm em "não mandar"' : '') + '. Confira e clique em "Mandar aos(às) vendedores(as)": cada boleto vai para o(a) vendedor(a) da carteira do cliente ' +
        '(Fila do dia, sino e ficha), com a mensagem pronta para ele(a) mandar ao cliente. "Não mandar" só se o título estiver errado.' +
        (avisos.length ? '\nAtenção: ' + avisos.join(' · ') : ''),
      campos, valores, salvarTexto: 'Mandar aos(às) vendedores(as)',
      aoSalvar: async v => {
        const st = CRM.store(), escolhidos = new Set();
        let n = 0, semPdf = 0;
        const gravados = [];
        const falta = itens.filter((x, i) => !v['b' + i]).map(x => x.b.pagador || 'pagador não lido');
        if (falta.length) throw new Error('Escolha o título ' + (falta.length > 1 ? 'destes boletos' : 'deste boleto') + ' (ou marque "não mandar"): ' + falta.join('; ') + '.');
        for (let i = 0; i < itens.length; i++) {
          const dup = v['b' + i];
          if (!dup || dup === 'nao') continue;
          if (escolhidos.has(dup)) throw new Error('Dois boletos para o mesmo título (' + dup + '): deixe um em "não mandar".');
          escolhidos.add(dup);
        }
        for (let i = 0; i < itens.length; i++) {
          const x = itens[i], dup = v['b' + i];
          if (!dup || dup === 'nao') continue;
          const t = venc.find(y => y.duplicata === dup);
          if (!x.conf.vencimento || !(x.conf.valor > 0)) throw new Error('O boleto de ' + (x.b.pagador || '?') + ' veio sem valor ou vencimento: não dá para mandar.');
          // PDF com vários boletos: cada um vai em arquivo próprio (o(a) vendedor(a) não pode receber o de outro cliente)
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
          gravados.push(r);
          n++;
        }
        const direto = cliOk; // 21/10/2026: com o modelo do cliente aprovado, vai direto ao cliente (sem tarefa para a vendedora)
        if (!direto) await criaTarefas(gravados);
        const pc = await comporPdfs(gravados);
        CRM.render();
        const naoMandados = itens.length - n;
        CRM.toast(n + ' boleto(s) gravado(s)' + (direto ? '' : ', com a tarefa de cobrar para cada vendedor(a)') + (naoMandados ? ' · ' + naoMandados + ' não mandado(s), como marcado' : '') + (semPdf ? ' · ' + semPdf + ' sem o PDF (não consegui separar a página): vão só com a linha digitável' : '') +
          (pc.clientes ? ' · PDF completo (resumo, nota fiscal e boleto) de ' + (pc.clientes - pc.falhas) + ' cliente(s)' : '') +
          (pc.falhas ? ', ' + pc.falhas + ' ficaram só com o boleto do banco' : '') + (pc.semNota ? ' · ' + pc.semNota + ' nota(s) sem o XML guardado: vão sem a DANFE' : '') + '.', !!pc.falhas);
        setTimeout(() => (direto ? formDiretoClientes(gravados.map(b => boleto(b.id) || b)) : formAvisar()), 0); // agora: direto aos clientes (ou às vendedoras)
      }
    });
  }

  // ---- administrador: avisar cada vendedor(a) no WhatsApp dela (14/10/2026, Anderson: "gostaria que enviasse no
  // WhatsApp delas" — a Silmara, por exemplo, não usa o CRM). Sem a API da Meta (fase 3) o CRM não manda
  // sozinho: um clique por vendedor(a) abre o WhatsApp do administrador com a mensagem pronta para ela — cada
  // cliente com o valor, o link do PDF (vale 7 dias), o telefone que o CRM tem e a mensagem pronta para ela
  // copiar e mandar ao cliente. Cada boleto também vira uma tarefa "Cobrar boleto atualizado" do(a) vendedor(a).
  const vendedoraDe = b => { const e = b.empresa_id && CRM.empresa(b.empresa_id); return (e && e.responsavel_id) || ''; };
  const TAREFA = /^Cobrar boleto atualizado/;
  async function criaTarefas(lista) {
    const porEmp = new Map();
    lista.forEach(b => { if (b.empresa_id) { if (!porEmp.has(b.empresa_id)) porEmp.set(b.empresa_id, []); porEmp.get(b.empresa_id).push(b); } });
    for (const [id, l] of porEmp) {
      const e = CRM.empresa(id);
      if (!e || !e.responsavel_id) continue;
      const ja = (E().D.atividades || []).some(a => a.empresa_id === id && !a.concluida && TAREFA.test(a.descricao || ''));
      if (ja) continue;
      await CRM.auto.tarefa({ empresa_id: id, tipo: 'tarefa', responsavel_id: e.responsavel_id, data_hora: new Date().toISOString(),
        descricao: 'Cobrar boleto atualizado: ' + l.map(b => nomeNF(b) + ' ' + R.moeda(b.valor)).join(', ') + ' (o financeiro mandou o boleto e a mensagem pronta no seu WhatsApp)' });
    }
  }
  async function concluiTarefas(empresaId) {
    for (const a of (E().D.atividades || []).filter(x => x.empresa_id === empresaId && !x.concluida && TAREFA.test(x.descricao || ''))) {
      try { await CRM.atualizar('atividades', a.id, { concluida: true, concluida_em: new Date().toISOString() }); } catch (e) { /* segue */ }
    }
  }
  // boletos que ainda não foram para o WhatsApp do(a) vendedor(a) (e não foram cobrados), por vendedor(a)
  const paraAvisar = () => pendentes().filter(b => !b.avisado_em);
  function porVendedora(lista) {
    const g = new Map();
    lista.forEach(b => { const u = vendedoraDe(b); if (!g.has(u)) g.set(u, []); g.get(u).push(b); });
    return [...g.entries()].sort((a, b) => CRM.nomeUsuario(a[0]).localeCompare(CRM.nomeUsuario(b[0])));
  }
  const botaoAvisar = (u, l) => {
    const usr = CRM.usuario(u), tel = usr && R.linkWhatsApp(usr.telefone);
    const nome = u ? R.primeiroNome(CRM.nomeUsuario(u)) : 'Sem vendedor(a)';
    if (!u || !tel) return '<span class="cob-sem-tel">' + esc(nome) + ': ' + l.length + ' boleto(s) — ' + (u ? 'sem celular no cadastro (Configurações → Equipe)' : 'cliente sem vendedor(a) na carteira') + '</span>';
    const qt = ' (' + l.length + ' boleto' + (l.length > 1 ? 's' : '') + ')';
    // 16/10/2026 (Anderson: quer o ARQUIVO PDF na conversa, como sai pelo Compartilhar): o principal volta a mandar o PDF
    // de verdade (janela de compartilhar do Windows/celular: escolhe o WhatsApp e o(a) vendedor(a)); abrir a conversa direto com
    // a mensagem e o LINK do PDF (o wa.me não anexa arquivo) fica como segunda opção.
    const comPdf = podeCompartilhar() && l.some(b => b.arquivo);
    return '<span class="cob-vend">' + (comPdf
      ? '<button type="button" class="btn ouro" data-acao="cob-avisar-pdf" data-id="' + esc(u) + '">📎 Mandar o PDF a ' + esc(nome) + qt + '</button>' +
        '<button type="button" class="link" data-acao="cob-avisar" data-id="' + esc(u) + '">ou abrir o WhatsApp de ' + esc(nome) + ' com o link</button>'
      : '<button type="button" class="btn ouro" data-acao="cob-avisar" data-id="' + esc(u) + '">📲 WhatsApp de ' + esc(nome) + qt + '</button>') + '</span>';
  };
  const preCarrega = lista => { arquivosDe(lista).catch(() => {}); };
  // WhatsApp oficial da Meta (15/10/2026): pronto quando o número está conectado e o modelo aprovado
  let wa = null, waLido = 0;
  function waSituacao() {
    if (!CRM.ehAdmin() || !CRM.store().whatsapp || Date.now() - waLido < 600000) return;
    waLido = Date.now();
    CRM.store().whatsapp({ acao: 'situacao' }).then(r => { const antes = !!(wa && wa.pronto); wa = r; wa.pronto = !!(r.ligado && r.modelo && r.modelo.status === 'APPROVED' && r.numero && r.numero.status === 'CONNECTED'); if (wa.pronto !== antes) CRM.render(); }).catch(() => {});
  }
  const waPronto = () => !!(wa && wa.pronto);
  // mandados pela OneClean antes de 20/10 (PDF por link: chegaram sem o anexo) ou pelo link de reserva, ainda não cobrados
  const paraReenviar = () => pendentes().filter(b => b.wa_status === 'enviado');
  const botaoReenviar = () => { const n = paraReenviar().length; return waPronto() && n ? '<section class="cartao cob-aviso"><h2>Chegaram sem o PDF <small>' + n + ' boleto(s)</small></h2>' +
    '<p>Mandados pelo WhatsApp da OneClean com o PDF por link: a mensagem chegou ao(à) vendedor(a), mas o anexo não. Agora o PDF sobe junto.</p>' +
    '<p><button type="button" class="btn ouro" data-acao="cob-meta-reenviar">🔁 Reenviar às vendedoras com o PDF anexo</button></p></section>' : ''; };
  const botaoMeta = n => (waPronto() ? '<p><button type="button" class="btn ouro" data-acao="cob-meta">📤 Enviar a todas pelo WhatsApp da OneClean (' + n + ' boleto' + (n > 1 ? 's' : '') + ')</button> ' +
    '<small>cada vendedor(a) recebe sozinha o boleto com o PDF completo anexo</small></p>' : '');
  function formAvisar() {
    const g = porVendedora(paraAvisar());
    if (!g.length) return;
    waSituacao();
    preCarrega(paraAvisar());
    CRM.abrirForm({
      titulo: 'Mandar no WhatsApp dos(as) vendedores(as)',
      intro: (podeCompartilhar()
        ? '"Mandar o PDF" abre a janela de compartilhar: escolha o WhatsApp e o(a) vendedor(a), e o PDF completo (resumo, nota fiscal e boleto) chega como arquivo, um por cliente; a mensagem pronta fica copiada (Ctrl+V se não aparecer junto).\n' +
          'Prefere sem escolher nada? "ou abrir o WhatsApp … com o link" abre direto a conversa com ele(a), com a mensagem e o link do PDF (vale 7 dias).\n'
        : 'Um clique por vendedor(a): abre o seu WhatsApp direto na conversa com ele(a), com cada cliente, o valor atualizado, o link do PDF completo (resumo, nota fiscal e boleto; vale 7 dias) e a mensagem pronta para ele(a) mandar ao cliente. É só apertar enviar.\n') +
        'A tarefa "Cobrar boleto atualizado" já está na agenda de cada uma.',
      campos: [], salvarTexto: 'Fechar', aoSalvar: async () => {},
      rodape: botaoMeta(paraAvisar().length) + '<div class="cob-avisar">' + g.map(([u, l]) => botaoAvisar(u, l)).join('') + '</div>'
    });
  }
  const telBR = t => { const d = String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : d.length === 10 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6) : String(t || ''); };
  async function textoVendedora(u, lista, anexo) {
    const usr = CRM.usuario(u), F = CRM.fichas, nomeV = CRM.nomeUsuario(u);
    const porEmp = new Map();
    lista.forEach(b => { if (!porEmp.has(b.empresa_id)) porEmp.set(b.empresa_id, []); porEmp.get(b.empresa_id).push(b); });
    const blocos = [];
    let i = 0;
    for (const [id, l] of porEmp) {
      const e = CRM.empresa(id);
      const c = F.escolheContato(e, null, x => R.linkWhatsApp(x.whatsapp || x.celular || x.telefone)) || F.escolheContato(e, null, () => true);
      const vars = Object.assign(F.variaveis(e, c), { vendedor: nomeV, vendedor_primeiro_nome: R.primeiroNome(nomeV) });
      const links = [];
      if (!anexo) for (const b of l) if (b.arquivo) links.push((l.length > 1 ? nomeNF(b) + ': ' : '') + await CRM.store().boletoLink(b.arquivo, 'Boleto ' + nomeNF(b).replace(/\//g, '-') + '.pdf', 7 * 86400));
      const tel = F.telDe(e, c);
      blocos.push('*' + (++i) + '/' + porEmp.size + ' · ' + e.nome + '*\n' +
        l.map(b => nomeNF(b) + ': ' + R.moeda(b.valor) + (Number(b.valor) > Number(b.valor_original) + 0.005 ? ' (com juros; original ' + R.moeda(b.valor_original) + ')' : '')).join('\n') +
        (anexo ? (l.some(b => b.arquivo) ? '\nPDF: vai anexo nesta conversa' : '\n(sem PDF: mande a linha digitável)')
          : links.length ? '\n' + (l.some(b => b.arquivo_banco) ? 'PDF completo (resumo, nota fiscal e boleto)' : 'PDF do boleto') + ': ' + links.join('\n') +
            '\n(abra o link no celular e use o Compartilhar para mandar o PDF ao cliente)' : '\n(sem PDF: mande a linha digitável)') +
        (tel ? '\nTelefone no CRM: ' + telBR(tel) + (c && c.nome ? ' (' + c.nome + ')' : '') : '\nSem telefone no CRM') +
        '\n\nMensagem pronta para o cliente (copie e mande junto com o PDF):\n' + mensagemBoleto((E().cfg || {}).modelo_boleto, l, vars));
    }
    return 'Oi, ' + R.primeiroNome(nomeV) + '! Aqui é ' + R.primeiroNome((E().eu || {}).nome || '') + ', do financeiro da ' + CRM.nomeInstalacao() + '. ' +
      (porEmp.size === 1 ? 'Boleto atualizado para você cobrar:' : porEmp.size + ' clientes com boleto atualizado para você cobrar:') + '\n\n' + blocos.join('\n\n────────\n\n') +
      '\n\nQuando o cliente responder, me avise. Obrigado!';
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
      const det = '<small>' + esc(R.moeda(b.valor)) + (Number(b.valor) > Number(b.valor_original) + 0.005 ? ' com juros' : '') + '</small>';
      if (b.cobrado_em) return CRM.selo('cobrado ' + dm(R.diaLocal(b.cobrado_em)) + (b.cobrado_por ? ' · ' + R.primeiroNome(CRM.nomeUsuario(b.cobrado_por)) : ''), 'verde') + det;
      const refaz = b.arquivo && !b.arquivo_banco ? ' <button type="button" class="mini" data-acao="cob-pdf" data-id="' + esc(b.id) + '" title="junta o resumo e a cópia da nota fiscal (DANFE) ao boleto do banco">Montar PDF com a nota</button>' : '';
      const ver = b.arquivo ? ' <button type="button" class="mini" data-acao="cob-baixar" data-id="' + esc(b.id) + '">Ver PDF</button>' : '';
      const meta = b.wa_status === 'falhou' ? ' ' + CRM.selo('WhatsApp da OneClean falhou', 'vermelho') + (b.wa_erro ? ' <small>' + esc(b.wa_erro) + '</small>' : '')
        : b.wa_status === 'enviado' ? ' ' + CRM.selo('pelo WhatsApp da OneClean, sem o PDF anexo', 'ambar') + (b.wa_erro ? ' <small>' + esc(b.wa_erro) + '</small>' : '')
        : b.wa_status ? ' ' + CRM.selo('pelo WhatsApp da OneClean: ' + b.wa_status, 'verde') : '';
      const cli = b.cli_em ? ' ' + seloCliente(b) : podeCliente([b]) ? ' <button type="button" class="mini wa" data-acao="cob-cliente-boleto" data-id="' + esc(b.id) + '" title="o cliente recebe do número da empresa o PDF anexo, em nome do(a) vendedor(a) da carteira">📲 Ao cliente pelo WhatsApp da empresa</button>' : '';
      return (b.cli_em ? '' : b.avisado_em ? CRM.selo('no WhatsApp do(a) vendedor(a) ' + dm(R.diaLocal(b.avisado_em)), 'azul') : CRM.selo('falta mandar ao(à) vendedor(a)', 'ambar')) + (b.cli_em ? '' : meta) + cli + det +
        ' <button type="button" class="mini" data-acao="cob-ja-cobrou" data-id="' + esc(b.id) + '" title="o(a) vendedor(a) já mandou ao cliente: tira da Fila e conclui a tarefa">Já cobrou</button>' + ver + refaz;
    };
    const avisar = porVendedora(paraAvisar());
    return '<section class="cartao cob-soltar" id="cobSoltar"><h2>Boletos atualizados</h2>' +
      (lendo ? '<p class="cob-lendo">Lendo os boletos… ' + lendo.feitos + ' de ' + lendo.total + '</p>' :
        '<p>Gere no Banco do Brasil a 2ª via atualizada (com juros) dos vencidos e <strong>arraste os PDFs aqui</strong> — vários de uma vez, ou um PDF com vários boletos. ' +
        'O CRM lê cada um (valor, vencimento, linha digitável), acha o título e você confere antes de mandar aos(às) vendedores(as).</p>' +
        '<label class="btn sec arquivo">Escolher arquivos<input type="file" id="cobArq" multiple accept="application/pdf,image/png,image/jpeg,image/webp"></label>') + '</section>' +
      (cliOk && paraClientes().length ? '<section class="cartao cob-aviso"><h2>Enviar direto aos clientes <small>' + paraClientes().length + ' boleto(s)</small></h2>' +
        '<p>O cliente recebe do WhatsApp da ' + esc(CRM.nomeInstalacao()) + ', em nome do(a) vendedor(a), com o PDF completo anexo. Os(as) vendedores(as) veem só o selo de título em atraso.</p>' +
        '<p><button type="button" class="btn ouro" data-acao="cob-direto">📲 Enviar direto aos clientes (' + porCliente(paraClientes()).length + ' cliente(s))</button></p></section>' : '') +
      (avisar.length ? '<section class="cartao cob-aviso"><h2>' + (cliOk ? 'Ou mandar no WhatsApp dos(as) vendedores(as)' : 'Mandar no WhatsApp dos(as) vendedores(as)') + ' <small>' + avisar.reduce((t, x) => t + x[1].length, 0) + ' boleto(s) ainda não foram</small></h2>' +
        '<p>' + (podeCompartilhar() ? 'Um clique por vendedor(a): o PDF completo de cada cliente vai como arquivo (escolha o WhatsApp e o(a) vendedor(a) na janela de compartilhar), com a mensagem pronta copiada.'
          : 'Um clique por vendedor(a): abre o seu WhatsApp na conversa com ele(a), com tudo pronto (valor, PDF, telefone do cliente e a mensagem para ele(a) copiar).') + '</p>' +
        botaoMeta(avisar.reduce((t, x) => t + x[1].length, 0)) + '<div class="cob-avisar">' + avisar.map(([u, l]) => botaoAvisar(u, l)).join('') + '</div></section>' : '') +
      botaoReenviar() +
      '<section class="cartao"><h2>Vencidos para cobrar <small>' + venc.length + ' título(s) · ' + esc(R.moeda(tot(venc))) + '</small></h2>' +
      (venc.length ? [...porVend.entries()].sort((a, b) => CRM.nomeUsuario(a[0]).localeCompare(CRM.nomeUsuario(b[0]))).map(([u, l]) =>
        '<h3>' + esc(u ? CRM.nomeUsuario(u) : 'Sem vendedor(a)') + ' <small>' + l.length + ' · ' + esc(R.moeda(tot(l))) + '</small></h3>' +
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
    waSituacao();
    cliSituacao();
    if (paraAvisar().length && podeCompartilhar()) preCarrega(paraAvisar());
    const arq = el.querySelector('#cobArq');
    if (arq) arq.addEventListener('change', () => { const f = [].slice.call(arq.files); arq.value = ''; lerArquivos(f).catch(CRM.falhou); });
    const zona = el.querySelector('#cobSoltar');
    if (!zona) return;
    zona.addEventListener('dragover', ev => { if (ev.dataTransfer && [].slice.call(ev.dataTransfer.types || []).indexOf('Files') !== -1) { ev.preventDefault(); zona.classList.add('cx-solta'); } });
    zona.addEventListener('dragleave', () => zona.classList.remove('cx-solta'));
    zona.addEventListener('drop', ev => { if (!ev.dataTransfer || !ev.dataTransfer.files.length) return; ev.preventDefault(); zona.classList.remove('cx-solta'); lerArquivos(ev.dataTransfer.files).catch(CRM.falhou); });
  }

  CRM.cobranca = { montaPdf, resumoHtml, seloTitulo, blocoEmpresa, botoesEnvio, paraFila, formCartorio, formAvisar, aba, depoisAba, contagem: () => vencidosACobrar().length, pendentesDe };

  Object.assign(CRM.acoes, {
    'cob-whats': (id, el) => {
      const e = CRM.empresa(id), lista = pendentesDe(id), F = CRM.fichas;
      if (!e || !lista.length) return;
      const c = F.escolheContato(e, el && el.dataset.contato, x => R.linkWhatsApp(x.whatsapp || x.celular || x.telefone));
      const tel = F.telDe(e, c);
      const texto = mensagemBoleto((E().cfg || {}).modelo_boleto, lista, F.variaveis(e, c), linksPdf(lista, (raiz.CRM_CONFIG || {}).supabaseUrl));
      // sem celular no cadastro (ou só telefone fixo): abre o WhatsApp para o(a) vendedor(a) escolher o contato
      const fixo = /^(55)?\d{2}[2-5]\d{7}$/.test(String(tel || '').replace(/\D/g, ''));
      const link = !fixo && R.linkWhatsApp(tel, texto) || 'https://wa.me/?text=' + encodeURIComponent(texto);
      raiz.open(link, '_blank', 'noopener'); // antes de qualquer espera (senão o navegador bloqueia)
      if (link.indexOf('https://wa.me/?') === 0) CRM.toast('Cliente sem celular no CRM: escolha o contato no WhatsApp. Depois cadastre o celular do financeiro na ficha.');
      // 20/10/2026: o PDF vai como link na mensagem (o cliente abre no celular); não baixa mais o arquivo para anexar à mão
      (async () => { await marcaCobrado(e, lista, c, texto, true); })().catch(CRM.falhou);
    },
    'cob-direto': () => formDiretoClientes(),
    'cob-para-vendedoras': () => {
      const l = paraAvisar();
      fechaForm();
      (async () => { await criaTarefas(l); setTimeout(formAvisar, 0); })().catch(CRM.falhou);
    },
    'cob-cliente': id => {
      const e = CRM.empresa(id), lista = pendentesDe(id);
      if (e && lista.length) formCliente(e, lista);
    },
    'cob-cliente-boleto': id => {
      const b0 = boleto(id), e = b0 && CRM.empresa(b0.empresa_id);
      if (!e) return;
      // os boletos atuais do mesmo cliente, ainda não mandados a ele (vão juntos, um PDF só por boleto)
      const l = vencidosACobrar().filter(t => t.empresa_id === e.id).map(t => boletoAtual(E().boletos, t.duplicata)).filter(b => b && b.arquivo && !b.cli_em);
      fechaForm();
      setTimeout(() => formCliente(e, l.some(b => b.id === b0.id) ? l : [b0]), 0);
    },
    'cob-avisar': (u, el) => {
      const usr = CRM.usuario(u), lista = paraAvisar().filter(b => vendedoraDe(b) === u);
      if (!usr || !lista.length || !R.linkWhatsApp(usr.telefone)) return;
      const w = raiz.open('', '_blank'); // abre já (o link do PDF demora um instante), senão o navegador bloqueia
      (async () => {
        const url = R.linkWhatsApp(usr.telefone, await textoVendedora(u, lista));
        if (w) w.location = url; else raiz.open(url, '_blank', 'noopener');
        const agora = new Date().toISOString();
        for (const b of lista) {
          const r = await CRM.store().atualizar('boletos', b.id, { avisado_em: agora });
          E().boletos = (E().boletos || []).map(x => (x.id === b.id ? Object.assign({}, x, r) : x));
        }
        if (el) { el.disabled = true; el.textContent = '✓ ' + el.textContent.replace(/^📲\s*/, ''); }
        CRM.render();
        CRM.toast('WhatsApp de ' + R.primeiroNome(usr.nome) + ' aberto com ' + lista.length + ' boleto(s): é só apertar enviar.');
      })().catch(e => { if (w) w.close(); CRM.falhou(e); });
    },
    // administrador → vendedor(a): os PDFs de verdade pela janela de compartilhar (WhatsApp do Windows ou do celular)
    'cob-avisar-pdf': (u, el) => {
      const usr = CRM.usuario(u), lista = paraAvisar().filter(b => vendedoraDe(b) === u);
      if (!usr || !lista.length) return;
      (async () => {
        const [files, texto] = await Promise.all([arquivosDe(lista), textoVendedora(u, lista, true)]);
        if (!(await compartilha(files, texto))) return;
        const agora = new Date().toISOString();
        for (const b of lista) {
          const r = await CRM.store().atualizar('boletos', b.id, { avisado_em: agora });
          E().boletos = (E().boletos || []).map(x => (x.id === b.id ? Object.assign({}, x, r) : x));
        }
        if (el) { el.disabled = true; el.textContent = '✓ ' + el.textContent.replace(/^📎\s*/, ''); }
        CRM.render();
        CRM.toast(files.length + ' PDF(s) compartilhado(s) com ' + R.primeiroNome(usr.nome) + '. A mensagem também ficou copiada: se não apareceu junto, cole na conversa (Ctrl+V).');
      })().catch(CRM.falhou);
    },
    // vendedor(a) → cliente: o PDF completo de verdade, com a mensagem pronta
    'cob-compartilhar': (id, el) => {
      const e = CRM.empresa(id), lista = pendentesDe(id), F = CRM.fichas;
      if (!e || !lista.length) return;
      const c = F.escolheContato(e, el && el.dataset.contato, x => R.linkWhatsApp(x.whatsapp || x.celular || x.telefone));
      const texto = mensagemBoleto((E().cfg || {}).modelo_boleto, lista, F.variaveis(e, c)).replace('Também te mando o PDF aqui.', 'O PDF vai junto.');
      (async () => {
        if (!(await compartilha(await arquivosDe(lista), texto))) return;
        await marcaCobrado(e, lista, c, texto, true);
      })().catch(CRM.falhou);
    },
    // administrador: monta o PDF completo de um boleto mandado antes (só tinha o PDF do banco)
    'cob-pdf': id => {
      const b0 = boleto(id);
      if (!b0 || !b0.empresa_id) return;
      const l = (E().boletos || []).filter(b => b.empresa_id === b0.empresa_id && !b.cobrado_em && !b.arquivo_banco && b.arquivo &&
        boletoAtual(E().boletos, b.duplicata) === b);
      (async () => {
        const r = await comporPdfs(l.length ? l : [b0]);
        CRM.render();
        CRM.toast(r.falhas ? 'Não consegui montar o PDF (veja o console); o boleto do banco continua valendo.' : 'PDF completo pronto' + (r.semNota ? ' (sem a DANFE: a nota não tem o XML guardado)' : '') + '. Clique em "Ver PDF" para conferir.', !!r.falhas);
      })().catch(CRM.falhou);
    },
    // WhatsApp oficial da Meta: um clique, todas os(as) vendedores(as) recebem sozinhas (com o PDF completo anexo)
    'cob-meta-reenviar': (id, el) => CRM.acoes['cob-meta'](id, el, paraReenviar()),
    'cob-meta': (id, el, outra) => {
      // 21/10/2026: o clique passa o evento como 3º parâmetro (app.js); só uma lista de boletos conta (o "reenviar"). Antes o
      // evento era tomado pela lista, que parecia vazia, e o botão não fazia nada.
      const lista = Array.isArray(outra) ? outra : paraAvisar();
      if (!lista.length) return;
      if (el) el.disabled = true;
      (async () => {
        const r = await CRM.store().whatsapp({ acao: 'enviar', boletos: lista.map(b => b.id) });
        const res = (r && r.resultado) || [], agora = new Date().toISOString();
        const okIds = new Set([].concat(...res.filter(x => x.ok).map(x => x.boletos)));
        const erros = new Map();
        res.filter(x => !x.ok).forEach(x => x.boletos.forEach(i => erros.set(i, x.erro)));
        const pdfDe = new Map(); res.filter(x => x.ok).forEach(x => x.boletos.forEach(i => pdfDe.set(i, x.pdf)));
        E().boletos = (E().boletos || []).map(b => okIds.has(b.id) ? Object.assign({}, b, { avisado_em: agora, wa_status: pdfDe.get(b.id) === 'anexo' ? 'enviado com o PDF' : 'enviado', wa_erro: null })
          : erros.has(b.id) ? Object.assign({}, b, { wa_status: 'falhou', wa_erro: erros.get(b.id) }) : b);
        fechaForm();
        CRM.render();
        const falhas = res.filter(x => !x.ok);
        const anexo = res.filter(x => x.ok && x.pdf === 'anexo').length, porLink = res.filter(x => x.ok && x.pdf !== 'anexo').length;
        CRM.toast(res.filter(x => x.ok).length + ' cliente(s) enviados pelo WhatsApp da OneClean' + (anexo ? ', ' + anexo + ' com o PDF anexo' : '') + (porLink ? ', ' + porLink + ' só com o link do PDF (a subida falhou)' : '') + (falhas.length ? ' · ' + falhas.length + ' falharam: ' + falhas.map(x => x.empresa + ' (' + x.erro + ')').join('; ') + ' — use o botão do(a) vendedor(a) para esses' : '') + '.', !!falhas.length);
      })().catch(e => { if (el) el.disabled = false; CRM.falhou(e); });
    },
    'cob-ja-cobrou': id => {
      const b = boleto(id), e = b && CRM.empresa(b.empresa_id);
      if (!b || !confirm('O(a) vendedor(a) já mandou o boleto de ' + (e ? e.nome : nomeNF(b)) + ' ao cliente? Sai da Fila dele(a) e a tarefa é concluída.')) return;
      (async () => {
        await CRM.store().boletoCobrado([b.id]);
        const agora = new Date().toISOString();
        E().boletos = (E().boletos || []).map(x => (x.id === b.id ? Object.assign({}, x, { cobrado_em: agora, cobrado_por: vendedoraDe(b) || CRM.meuId() }) : x));
        if (b.empresa_id) await concluiTarefas(b.empresa_id);
        CRM.render();
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
