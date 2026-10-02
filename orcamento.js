/* CRM Sistemi Dalessi — orçamento do FKN → proposta no layout da empresa.
   A vendedora gera o orçamento no FKN, salva em CSV (disquete → CSV) e importa aqui: o CRM lê
   cliente, itens e condições, acha o cliente pelo CNPJ (ou cadastra), cria ou atualiza o negócio
   na etapa de orçamento e monta a proposta, pronta para PDF, WhatsApp ou e-mail.
   Parte pura (CRMOrcamento.lerOrcamentoFKN, testada em testes/orcamento.test.js) e a tela. */
(function (raiz) {
  'use strict';
  const R = raiz.CRMRegras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  const digitos = v => String(v == null ? '' : v).replace(/\D/g, '');
  const dataBR = v => { const m = /(\d\d)\/(\d\d)\/(\d{4})/.exec(String(v || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : null; };
  // Número do FKN: "1.234,5678" (até 4 casas no preço unitário).
  const n = v => { const x = Number(String(v == null ? '' : v).trim().replace(/\./g, '').replace(',', '.')); return isFinite(x) ? x : 0; };

  // O CSV do FKN é a impressão do orçamento: cabeçalho em duas colunas (cliente à esquerda,
  // PROPOSTA/EMISSÃO/VÁLIDO ATÉ… à direita), itens "IT; CÓDIGO; NOME; UN; QTDE; PREÇO UNIT; %DESC;
  // PREÇO TOTAL;" e rodapé (frete, total, condição de pagamento, cobrança, vendedor, entrega).
  // Com mais de uma página o cabeçalho se repete: os itens são juntados pelo número do item.
  const ehOrcamentoFKN = t => /PROPOSTA:\s*[\d.]+/i.test(String(t).slice(0, 3000)) && /PRE[ÇC]O\s*UNIT/i.test(String(t));
  function lerOrcamentoFKN(texto) {
    const t = String(texto).replace(/^\uFEFF/, '');
    if (!ehOrcamentoFKN(t)) throw new Error('não parece um orçamento do FKN salvo em CSV (falta "PROPOSTA:" e a tabela de itens)');
    const linhas = t.split(/\r?\n/);
    const o = { numero: null, versao: null, emissao: null, validade: null, cliente: {}, itens: [], frete: 0, frete_tipo: null, total: 0, pagamento: null, cobranca: null,
      prazo_entrega: null, vendedor: null, transportadora: null, local_entrega: null, endereco_entrega: null, seu_pedido: null, ref: null, ac: null };
    const pega = (re, l) => { const m = re.exec(l); return m ? m[1].trim() : null; };
    // Parte esquerda da linha (o cliente), antes do rótulo da coluna direita ("EMISSÃO:", "VÁLIDO ATÉ:"…).
    const esquerda = l => l.split(/\s{3,}(?=[A-ZÀ-Ú][A-ZÀ-Ú.\/()]*(?: [A-ZÀ-Ú.\/()]+)?:)/)[0].replace(/;\s*$/, '').trim();
    let iCab = -1;
    linhas.forEach((l, i) => {
      let v;
      if ((v = pega(/PROPOSTA:\s*([\d.]+)/i, l))) { if (o.numero == null) iCab = i; o.numero = digitos(v); }
      if ((v = pega(/VERS[ÃA]O:\s*(\d+)/i, l))) o.versao = Number(v);
      if ((v = pega(/EMISS[ÃA]O:\s*(\d\d\/\d\d\/\d{4})/i, l))) o.emissao = dataBR(v);
      if ((v = pega(/V[ÁA]LIDO AT[ÉE]:\s*(\d\d\/\d\d\/\d{4})/i, l))) o.validade = dataBR(v);
      if ((v = pega(/COD\.CLI:\s*(\d+)/i, l))) o.cliente.codigo = v;
      if ((v = pega(/\bTEL:\s*([^;]+?)\s*;/i, l))) o.cliente.telefone = v;
      if ((v = pega(/SEU PEDIDO:\s*([^;]*)/i, l))) o.seu_pedido = v || null;
      if ((v = pega(/CNPJ:\s*([\d./-]+)/i, l)) || (v = pega(/CPF:\s*([\d.-]+)/i, l))) o.cliente.doc = digitos(v);
      if ((v = pega(/I\.E\.:\s*(\S+)/i, l))) o.cliente.ie = v;
      if (/^A\/C SR\(A\):/i.test(l)) o.ac = esquerda(l.replace(/^A\/C SR\(A\):/i, '')) || null;
      if (/^REF:/i.test(l)) o.ref = esquerda(l.replace(/^REF:/i, '')) || null;
      if ((v = pega(/^EMAIL:\s*(\S+)/i, l))) o.cliente.email = v.replace(/;$/, '');
      const it = /^\s*(\d+);\s*([\w.-]+);\s*(.*?);\s*(\S*);\s*([-\d.,]+);\s*([-\d.,]+);\s*([-\d.,]*);\s*([-\d.,]+);/.exec(l);
      if (it) {
        const item = { item: +it[1], codigo: it[2].replace(/\.0+$/, ''), descricao: it[3].trim(), unidade: it[4] || null, quantidade: n(it[5]), preco: n(it[6]), desconto: n(it[7]), total: n(it[8]) };
        const ja = o.itens.findIndex(x => x.item === item.item);
        if (ja >= 0) o.itens[ja] = item; else o.itens.push(item);
      }
      if ((v = pega(/FRETE R\$:;\s*([-\d.,]+)/i, l)) != null) { o.frete = n(v); o.frete_tipo = pega(/FRETE R\$:;\s*[-\d.,]+\s+(.*?)\s{2,}/i, l); }
      if ((v = pega(/VALOR TOTAL\s+R\$:;\s*([-\d.,]+)/i, l))) o.total = n(v);
      if (/Cond\. pagamento\.*:/i.test(l)) o.pagamento = pega(/Cond\. pagamento\.*:(.*?)(?:Cobran[çc]a:|;|$)/i, l) || null;
      if ((v = pega(/Cobran[çc]a:\s*([^;]*)/i, l))) o.cobranca = v || null;
      if (/Prazo entrega\.*:/i.test(l)) o.prazo_entrega = pega(/Prazo entrega\.*:(.*?)(?:Vendedor:|;|$)/i, l) || null;
      if ((v = pega(/Vendedor:\s*([^;]*)/i, l))) o.vendedor = v || null;
      if ((v = pega(/Transportadora\.*:\s*([^;]*)/i, l))) o.transportadora = v || null;
      if ((v = pega(/Local de entrega\.*:\s*([^;]*)/i, l))) o.local_entrega = v || null;
      if ((v = pega(/Endere[çc]o de entrega:\s*([^;]*)/i, l))) o.endereco_entrega = v.replace(/\s+/g, ' ') || null;
    });
    // Cliente: as três linhas depois de "PROPOSTA:" (nome, endereço, CEP/bairro/cidade/UF).
    if (iCab >= 0) {
      o.cliente.nome = esquerda(linhas[iCab + 1] || '') || null;
      o.cliente.endereco = esquerda(linhas[iCab + 2] || '') || null;
      const p = esquerda(linhas[iCab + 3] || '').split(/\s{2,}/);
      if (/^\d{5}-?\d{3}$/.test(p[0] || '')) { o.cliente.cep = p[0]; o.cliente.bairro = p[1] || null; o.cliente.cidade = p[2] || null; o.cliente.uf = p[3] || null; }
    }
    if (!o.itens.length) throw new Error('o orçamento não tem itens (salve com "Tudo" no FKN)');
    o.soma = Math.round(o.itens.reduce((s, x) => s + x.total, 0) * 100) / 100;
    o.confere = !o.total || Math.abs(o.soma - o.total) < 0.05 || Math.abs(o.soma + o.frete - o.total) < 0.05;
    return o;
  }

  // Condições em texto (vão para a proposta e para o PDF).
  function condicoesTexto(o) {
    return [o.pagamento && 'Pagamento: ' + o.pagamento + (o.cobranca ? ' (' + o.cobranca.toLowerCase() + ')' : ''), o.prazo_entrega && 'Prazo de entrega: ' + o.prazo_entrega,
      'Frete: ' + (o.frete ? R.moeda(o.frete) : 'grátis') + (o.frete_tipo ? ' — ' + o.frete_tipo.replace(/^\d+-/, '') : ''), o.transportadora && 'Transporte: ' + (o.transportadora === 'PROPRIO' ? 'próprio' : o.transportadora),
      o.endereco_entrega && 'Entrega: ' + o.endereco_entrega].filter(Boolean).join('\n');
  }

  const O = { lerOrcamentoFKN, ehOrcamentoFKN, condicoesTexto };
  raiz.CRMOrcamento = O;
  if (typeof module !== 'undefined') module.exports = O;

  // ------------------------------------------------------------ tela
  const CRM = raiz.CRM;
  if (!CRM || !CRM.acoes) return;
  const E = () => CRM.estado;
  const esc = CRM.esc;

  function escolheArquivo(aoEscolher) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.csv,.txt,text/csv';
    inp.addEventListener('change', () => { const f = inp.files[0]; if (f) aoEscolher(f).catch(CRM.falhou); });
    inp.click();
  }
  async function lerArquivo(f) {
    const buf = await f.arrayBuffer();
    let txt = new TextDecoder('utf-8').decode(buf);
    if (txt.indexOf('\uFFFD') !== -1) txt = new TextDecoder('windows-1252').decode(buf); // o FKN grava em Windows-1252
    return lerOrcamentoFKN(txt);
  }
  // Vendedor escrito no orçamento ("ALYSSON") → usuário do CRM (nome na nota, nome ou primeiro nome).
  function usuarioDo(nome) {
    if (!nome) return null;
    const k = R.normaliza(nome).trim(), us = (E().D.usuarios || []).filter(u => u.ativo !== false);
    return us.find(u => (u.nomes_nota || []).some(x => R.normaliza(x).trim() === k)) || us.find(u => R.normaliza(u.nome).trim() === k) ||
      (us.filter(u => R.primeiroNome(R.normaliza(u.nome)) === R.primeiroNome(k)).length === 1 ? us.find(u => R.primeiroNome(R.normaliza(u.nome)) === R.primeiroNome(k)) : null);
  }
  const funilVendas = () => { const fs = CRM.funis ? CRM.funis() : []; return fs.find(f => !/p[óo]s[\s-]*vendas?/i.test(f)) || fs[0] || 'Vendas'; };
  const etapaOrcamento = () => {
    const l = E().D.etapas.filter(e => (e.funil || 'Vendas') === funilVendas()).sort((a, b) => a.ordem - b.ordem);
    return l.find(e => /or[çc]amento|proposta/i.test(e.nome)) || l[0] || null;
  };

  // Importar: lê, mostra o resumo e pergunta em qual negócio entra (novo ou um aberto do cliente).
  CRM.importarOrcamento = negocioId => escolheArquivo(async f => {
    const o = await lerArquivo(f);
    const doc = o.cliente.doc;
    const emp = (doc && E().D.empresas.find(e => digitos(e.cnpj) === doc)) || (negocioId && CRM.empresa((CRM.negocio(negocioId) || {}).empresa_id)) || null;
    const vend = usuarioDo(o.vendedor);
    const etapa = etapaOrcamento();
    const prop = (E().D.propostas || []).find(p => p.numero_fkn === o.numero);
    const abertos = emp ? CRM.doEmpresa('negocios', emp.id).filter(x => x.status === 'aberto') : [];
    const padraoNeg = negocioId || (prop && prop.negocio_id) || (abertos.length === 1 ? abertos[0].id : 'novo');
    const contatos = emp ? CRM.doEmpresa('contatos', emp.id) : [];
    const ac = R.normaliza(o.ac || ''), mail = String(o.cliente.email || '').toLowerCase();
    const contato = contatos.find(c => (mail && String(c.email || '').toLowerCase() === mail) || (ac && R.normaliza(c.nome).indexOf(R.primeiroNome(ac)) === 0));
    const resumo = 'Orçamento nº ' + o.numero + (o.versao ? ' (versão ' + o.versao + ')' : '') + ' · ' + o.itens.length + ' itens · ' + R.moeda(o.total || o.soma) +
      (o.validade ? ' · válido até ' + R.dataBR(o.validade) : '') + '\nCliente: ' + (o.cliente.nome || '?') + (doc ? ' (' + R.formataCNPJ(doc) + ')' : '') +
      (emp ? ' — já está no CRM' + (emp.nome !== o.cliente.nome ? ' como "' + emp.nome + '"' : '') : ' — não está no CRM: vai ser cadastrado') + (o.vendedor ? '\nVendedor no FKN: ' + o.vendedor : '') +
      (prop ? '\nEste orçamento já foi importado (proposta #' + prop.numero + '): os itens e o valor vão ser atualizados.' : '') +
      (o.confere ? '' : '\nATENÇÃO: a soma dos itens (' + R.moeda(o.soma) + ') não bate com o total do FKN (' + R.moeda(o.total) + ').');
    CRM.abrirForm({
      titulo: 'Importar orçamento do FKN', intro: resumo, largura: 'largo',
      campos: [
        { nome: 'negocio', rotulo: 'Entra no negócio', tipo: 'select', largo: true, padrao: padraoNeg,
          opcoes: [['novo', 'Novo negócio: Orçamento ' + o.numero + (etapa ? ' (etapa ' + etapa.nome + ')' : '')]].concat(abertos.map(x => [x.id, x.titulo + ' · ' + ((CRM.etapa(x.etapa_id) || {}).nome || '') + ' · ' + R.moeda(x.valor)])) },
        { nome: 'responsavel_id', rotulo: 'Responsável', tipo: 'select', opcoes: CRM.opcoesUsuarios(), padrao: (vend && vend.user_id) || (emp && emp.responsavel_id) || CRM.meuId() },
        { nome: 'contato_id', rotulo: 'Aos cuidados de', tipo: 'select', opcoes: [['', o.ac ? o.ac + ' (só no documento)' : '—']].concat(contatos.map(c => [c.id, c.nome])), padrao: contato ? contato.id : '' }
      ],
      salvarTexto: 'Importar e montar a proposta',
      aoSalvar: async v => { const r = await grava(o, emp, v, prop); setTimeout(() => CRM.fichas.abrirNegocio(r.negocio.id), 50); }
    });
  });

  async function grava(o, emp, v, prop) {
    // 1) cliente
    if (!emp) {
      const c = o.cliente;
      emp = await CRM.inserir('empresas', { nome: c.nome || 'Cliente do orçamento ' + o.numero, razao_social: c.nome || null, cnpj: c.doc ? R.formataCNPJ(c.doc) : null, email: c.email || null,
        telefone: c.telefone || null, logradouro: c.endereco || null, cep: c.cep || null, bairro: c.bairro || null, cidade: c.cidade || null, uf: c.uf || null,
        situacao: 'lead', responsavel_id: v.responsavel_id || CRM.meuId(), origem: 'Orçamento FKN' });
    }
    // 2) negócio
    const etapa = etapaOrcamento();
    const total = o.total || o.soma;
    let neg;
    if (v.negocio && v.negocio !== 'novo') {
      neg = CRM.negocio(v.negocio);
      const patch = { valor: total, previsao_fechamento: o.validade || neg.previsao_fechamento || null, responsavel_id: v.responsavel_id || neg.responsavel_id, contato_id: v.contato_id || neg.contato_id || null };
      const atual = CRM.etapa(neg.etapa_id);
      if (etapa && (!atual || (atual.funil === etapa.funil && atual.ordem < etapa.ordem))) patch.etapa_id = etapa.id; // avança até "orçamento", nunca volta
      neg = await CRM.auto.mudarNegocio(neg, patch);
    } else {
      neg = await CRM.inserir('negocios', { empresa_id: emp.id, titulo: 'Orçamento ' + o.numero, etapa_id: etapa ? etapa.id : null, status: 'aberto', valor: total,
        previsao_fechamento: o.validade || null, responsavel_id: v.responsavel_id || CRM.meuId(), contato_id: v.contato_id || null, origem: 'Orçamento FKN' });
    }
    // 3) itens do negócio = os do orçamento (troca os que havia)
    const antigos = CRM.doNegocio('negocio_itens', neg.id);
    if (antigos.length) await CRM.removerVarios('negocio_itens', antigos.map(x => x.id));
    const prods = E().D.produtos || [];
    await CRM.inserirVarios('negocio_itens', o.itens.map((it, i) => {
      const p = prods.find(x => x.codigo && String(x.codigo).replace(/\.0+$/, '') === it.codigo);
      return { negocio_id: neg.id, produto_id: p ? p.id : null, descricao: it.descricao + (it.unidade ? ' (' + it.unidade + ')' : ''), quantidade: it.quantidade, preco: it.preco, desconto: it.desconto, ordem: i };
    }));
    // 4) proposta (no layout da empresa): itens com código e unidade, condições do FKN
    const itens = o.itens.map(it => ({ codigo: it.codigo, descricao: it.descricao, unidade: it.unidade, quantidade: it.quantidade, preco: it.preco, desconto: it.desconto, total: it.total }));
    const dados = { fkn: true, versao: o.versao, emissao: o.emissao, ac: o.ac, ref: o.ref, seu_pedido: o.seu_pedido, pagamento: o.pagamento, cobranca: o.cobranca, prazo_entrega: o.prazo_entrega,
      frete: o.frete, frete_tipo: o.frete_tipo, transportadora: o.transportadora, endereco_entrega: o.endereco_entrega, vendedor_fkn: o.vendedor, codigo_cliente: o.cliente.codigo };
    const campos = { negocio_id: neg.id, itens, valor_total: total, validade: o.validade || null, condicoes: condicoesTexto(o), numero_fkn: o.numero, dados };
    const p = prop ? await CRM.atualizar('propostas', prop.id, campos) : await CRM.inserir('propostas', Object.assign({ status: 'rascunho' }, campos));
    await CRM.auto.sistema(emp.id, neg.id, 'Orçamento ' + o.numero + ' do FKN importado' + (prop ? ' de novo (atualizado)' : '') + ': ' + o.itens.length + ' itens, ' + R.moeda(total));
    CRM.toast('Orçamento ' + o.numero + ' importado. Abra "Imprimir / PDF" para ver no layout da ' + CRM.nomeInstalacao() + '.');
    return { empresa: emp, negocio: neg, proposta: p };
  }

  Object.assign(CRM.acoes, {
    'importar-orcamento': id => CRM.importarOrcamento(id || null)
  });
})(typeof window !== 'undefined' ? window : globalThis);
