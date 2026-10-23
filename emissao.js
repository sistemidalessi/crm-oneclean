/* CRM Sistemi Dalessi — Emissão de NF-e pelo CRM (Fase 4 da saída do FKN, 16/10/2026).
   O CRM não fala com a Sefaz: o botão chama a Edge Function crm-fiscal, que junta o pedido, o cliente e as regras
   fiscais, reserva o número e manda ao serviço fiscal na VPS (servico-fiscal/, que assina com o A1). Aqui ficam:
   - a configuração do emitente (aba Fiscal → 4. Emissão; proposta lida do XML de uma nota do FKN);
   - "Emitir NF-e" no pedido (prévia com os avisos → emitir → resultado);
   - Pedidos → NF-e: a lista das notas do CRM com DANFE, XML, consultar, cancelar, carta de correção, inutilizar e o
     fechamento do mês para o contador (ZIP com os XML de saída + relação de canceladas e inutilizadas).
   Parte pura no começo (testes/emissao.test.js); a tela vem depois. */
(function (raiz) {
  'use strict';

  const SITUACAO = {
    reservada: ['número reservado', 'cinza'], pendente: ['sem resposta: consultar', 'ambar'], autorizada: ['autorizada', 'verde'],
    rejeitada: ['rejeitada', 'vermelho'], denegada: ['denegada', 'vermelho'], cancelada: ['cancelada', 'cinza'], bloqueada: ['não enviada (avisos)', 'ambar'],
    inutilizada: ['número inutilizado', 'cinza']
  };
  const situacaoDe = n => (n && n.inutilizada_em ? 'inutilizada' : (n && n.situacao) || 'reservada');
  const dig = v => String(v == null ? '' : v).replace(/\D/g, '');
  const doc = v => String(v == null ? '' : v).toUpperCase().replace(/[^0-9A-Z]/g, ''); // CNPJ pode ter letras (07/2026)
  const ehCNPJ = d => /^[0-9A-Z]{12}\d{2}$/.test(d);
  // primeiro conteúdo da tag (com ou sem prefixo), dentro de um trecho
  function pega(xml, tag) {
    const m = new RegExp('<(?:\\w+:)?' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?' + tag + '>').exec(xml || '');
    return m ? m[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'") : '';
  }

  // Do XML de uma nota já emitida (pelo FKN): o emitente e as opções da nota (natureza, consumidor final, presença).
  function emitenteDoXml(xml) {
    const inf = pega(xml, 'infNFe');
    if (!inf) return null;
    const ide = pega(inf, 'ide'), emit = pega(inf, 'emit'), en = pega(emit, 'enderEmit');
    if (!emit) return null;
    const n = v => (v === '' ? null : Number(v));
    return {
      emitente: { cnpj: doc(pega(emit, 'CNPJ')), ie: dig(pega(emit, 'IE')), razao: pega(emit, 'xNome'), fantasia: pega(emit, 'xFant') || null, crt: n(pega(emit, 'CRT')) || 3,
        endereco: { logradouro: pega(en, 'xLgr'), numero: pega(en, 'nro'), complemento: pega(en, 'xCpl') || null, bairro: pega(en, 'xBairro'), cMun: dig(pega(en, 'cMun')),
          municipio: pega(en, 'xMun'), uf: pega(en, 'UF'), cep: dig(pega(en, 'CEP')), fone: dig(pega(en, 'fone')) || null } },
      natOp: pega(ide, 'natOp') || null, indFinal: n(pega(ide, 'indFinal')), indPres: n(pega(ide, 'indPres')), serie: n(pega(ide, 'serie')), numero: n(pega(ide, 'nNF')),
      homologacao: pega(ide, 'tpAmb') === '2'
    };
  }

  // O que falta no emitente para a nota sair (o serviço fiscal recusa sem isso).
  function faltasEmitente(f) {
    const em = (f && f.emitente) || {}, e = em.endereco || {}, out = [];
    if (!ehCNPJ(doc(em.cnpj))) out.push('CNPJ');
    if (!dig(em.ie)) out.push('inscrição estadual');
    if (!String(em.razao || '').trim()) out.push('razão social');
    if (!e.logradouro || !e.numero || !e.bairro) out.push('endereço (rua, número e bairro)');
    if (dig(e.cMun).length !== 7) out.push('código IBGE do município (7 números)');
    if (!/^[A-Z]{2}$/.test(String(e.uf || ''))) out.push('UF');
    if (dig(e.cep).length !== 8) out.push('CEP');
    return out;
  }

  // Textos dos eventos: a Sefaz pede de 15 a 255 letras na justificativa (cancelamento e inutilização) e de 15 a 1000 na
  // correção. Devolve o erro ou null.
  function confereTexto(t, tipo) {
    const s = String(t || '').trim().replace(/\s+/g, ' '), max = tipo === 'cce' ? 1000 : 255;
    if (s.length < 15) return (tipo === 'cce' ? 'a correção' : 'a justificativa') + ' precisa de pelo menos 15 letras';
    if (s.length > max) return 'no máximo ' + max + ' letras (tem ' + s.length + ')';
    return null;
  }

  // Horas desde a autorização (cancelamento normal em SP: até 24 h; depois é "extemporâneo", com multa, e o contador
  // precisa saber).
  const horasDesde = (iso, agora) => (iso ? ((agora || Date.now()) - new Date(iso).getTime()) / 36e5 : null);

  // Mês (AAAA-MM) no horário de São Paulo (UTC−3, sem horário de verão desde 2019).
  const mesSP = iso => (iso ? new Date(new Date(iso).getTime() - 3 * 36e5).toISOString().slice(0, 7) : '');
  const diaSP = iso => (iso ? new Date(new Date(iso).getTime() - 3 * 36e5).toISOString().slice(0, 10) : '');
  const br = d => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '');

  // Fechamento do mês para o contador: só PRODUÇÃO. Entram as notas autorizadas no mês (as que depois foram canceladas
  // também, com o XML do cancelamento), as cartas de correção e as inutilizações. Devolve os arquivos do ZIP e a relação.
  function fechamento(nfes, inuts, mes) {
    const doMes = (nfes || []).filter(n => n.ambiente === 'producao' && n.autorizada_em && mesSP(n.autorizada_em) === mes && n.proc_xml &&
      (n.situacao === 'autorizada' || n.situacao === 'cancelada' || n.situacao === 'denegada')).sort((a, b) => a.serie - b.serie || a.numero - b.numero);
    const arquivos = [], linhas = [];
    doMes.forEach(n => {
      arquivos.push({ nome: 'NFe' + n.chave + '-procNFe.xml', conteudo: n.proc_xml });
      (n.eventos || []).filter(e => e.xml && e.protocolo).forEach(e => arquivos.push({ nome: 'NFe' + n.chave + (e.tipo === 'cancelar' ? '-procEventoCanc.xml' : '-procEventoCCe' + (e.seq || 1) + '.xml'), conteudo: e.xml }));
      const canc = (n.eventos || []).find(e => e.tipo === 'cancelar' && e.protocolo);
      if (n.situacao === 'cancelada' && canc) linhas.push(['CANCELADA', n.serie, n.numero, n.chave, br(diaSP(canc.quando)), canc.protocolo, canc.texto || '']);
      if (n.situacao === 'denegada') linhas.push(['DENEGADA', n.serie, n.numero, n.chave, br(diaSP(n.autorizada_em)), n.protocolo || '', n.motivo || '']);
    });
    const ins = (inuts || []).filter(i => i.ambiente === 'producao' && Number(i.cstat) === 102 && mesSP(i.criado_em) === mes);
    ins.forEach(i => {
      if (i.xml) arquivos.push({ nome: 'Inut-serie' + i.serie + '-' + i.de + (i.ate !== i.de ? '-a-' + i.ate : '') + '-procInutNFe.xml', conteudo: i.xml });
      linhas.push(['INUTILIZADA', i.serie, i.de === i.ate ? i.de : i.de + ' a ' + i.ate, '', br(diaSP(i.criado_em)), i.protocolo || '', i.justificativa || '']);
    });
    // texto que começa com = + - @ ganha apóstrofo (não vira fórmula no Excel do contador), como o R.csvGera
    const cel = v => { let s = String(v == null ? '' : v); if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s) && !/^-?[\d.,]+$/.test(s)) s = "'" + s;
      return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = '﻿' + [['Tipo', 'Série', 'Número', 'Chave', 'Data', 'Protocolo', 'Justificativa']].concat(linhas).map(l => l.map(cel).join(';')).join('\r\n') + '\r\n';
    arquivos.push({ nome: 'relacao-canceladas-inutilizadas-' + mes + '.csv', conteudo: csv });
    const valor = doMes.filter(n => n.situacao === 'autorizada').reduce((s, n) => s + Number(n.valor || 0), 0);
    return { notas: doMes.length, autorizadas: doMes.filter(n => n.situacao === 'autorizada').length, canceladas: doMes.filter(n => n.situacao === 'cancelada').length,
      inutilizadas: ins.length, valor: Math.round(valor * 100) / 100, arquivos, linhas };
  }

  // ZIP sem compressão ("stored"), com nomes em UTF-8: XML pequeno, abre em qualquer Windows. → Uint8Array
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(arquivos, quando) {
    const enc = new TextEncoder(), d = quando || new Date(), partes = [], central = [];
    const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let pos = 0;
    arquivos.forEach(a => {
      const nome = enc.encode(a.nome), dados = typeof a.conteudo === 'string' ? enc.encode(a.conteudo) : a.conteudo, crc = crc32(dados);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, hora, true); h.setUint16(12, dia, true);
      h.setUint32(14, crc, true); h.setUint32(18, dados.length, true); h.setUint32(22, dados.length, true); h.setUint16(26, nome.length, true); h.setUint16(28, 0, true);
      partes.push(new Uint8Array(h.buffer), nome, dados);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, hora, true);
      c.setUint16(14, dia, true); c.setUint32(16, crc, true); c.setUint32(20, dados.length, true); c.setUint32(24, dados.length, true); c.setUint16(28, nome.length, true); c.setUint32(42, pos, true);
      central.push(new Uint8Array(c.buffer), nome);
      pos += 30 + nome.length + dados.length;
    });
    const tamC = central.reduce((s, x) => s + x.length, 0), fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true); fim.setUint32(12, tamC, true); fim.setUint32(16, pos, true);
    const todas = partes.concat(central, [new Uint8Array(fim.buffer)]), out = new Uint8Array(todas.reduce((s, x) => s + x.length, 0));
    let i = 0; todas.forEach(x => { out.set(x, i); i += x.length; });
    return out;
  }

  // Tabela do IBPT (CSV "codigo;ex;tipo;descricao;nacionalfederal;importadosfederal;estadual;municipal;vigenciainicio;
  // vigenciafim;chave;versao;fonte"), só o tipo 0 (NCM). → { linhas, versao, chave, vig_ini, vig_fim, fonte }
  function lerIbpt(texto) {
    const campos = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ';' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
    const dataISO = v => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || '').trim()); return m ? m[3] + '-' + m[2] + '-' + m[1] : null; };
    const ls = String(texto || '').replace(/^\ufeff/, '').split(/\r?\n|\r|\u0085/).filter(l => l.trim());
    if (!ls.length || !/^codigo;ex;tipo;/i.test(ls[0])) throw new Error('não parece a tabela do IBPT (a 1ª linha tem de começar com "codigo;ex;tipo;")');
    const n = v => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
    const linhas = ls.slice(1).map(campos).filter(c => c[2] === '0' && /^\d{8}$/.test(c[0])).map(c => ({ codigo: c[0], ex: c[1] || '', descricao: (c[3] || '').slice(0, 120),
      nac_fed: n(c[4]), imp_fed: n(c[5]), estadual: n(c[6]), municipal: n(c[7]), vig_ini: dataISO(c[8]), vig_fim: dataISO(c[9]), chave: c[10] || null, versao: c[11] || null, fonte: c[12] || null }));
    if (!linhas.length) throw new Error('nenhum NCM na tabela');
    const a = linhas[0];
    return { linhas, versao: a.versao, chave: a.chave, vig_ini: a.vig_ini, vig_fim: a.vig_fim, fonte: a.fonte };
  }

  // Reforma a partir de 2027 (22/10/2026): a configuração dados.fiscal.reforma2027 que o serviço fiscal lê
  // (servico-fiscal/nfe.js regraReforma). Os padrões do IBS repetem o REFORMA_2027 de lá (o teste confere que batem).
  const REFORMA_PADRAO = { pIBSUF: 0.05, pIBSMun: 0.05 };
  const pctOk = (v, nome) => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    if (!isFinite(n) || n < 0 || n > 30) throw new Error(nome + ': informe um percentual entre 0 e 30');
    return Math.round(n * 10000) / 10000;
  };
  // Do formulário para o que se grava. CBS vazia = ainda não definida (nota de 2027 fica bloqueada).
  function reformaDoForm(v) {
    v = v || {};
    const pCBS = pctOk(v.pCBS, 'CBS');
    if (pCBS === 0) throw new Error('CBS: em 2027 a CBS é cobrada; deixe vazio enquanto a alíquota não estiver definida');
    const pIBSUF = pctOk(v.pIBSUF, 'IBS estadual'), pIBSMun = pctOk(v.pIBSMun, 'IBS municipal');
    return { pCBS, pIBSUF: pIBSUF == null ? REFORMA_PADRAO.pIBSUF : pIBSUF, pIBSMun: pIBSMun == null ? REFORMA_PADRAO.pIBSMun : pIBSMun,
      icmsComIbsCbs: v.icmsComIbsCbs === true, cobrarPorFora: v.cobrarPorFora === true };
  }
  const pctTxt = n => String(n).replace('.', ',') + '%';
  // O que a tela mostra: situação e uma linha por regra.
  function resumoReforma(ref) {
    const r = ref || {}, pronta = Number(r.pCBS) > 0;
    const uf = r.pIBSUF == null ? REFORMA_PADRAO.pIBSUF : r.pIBSUF, mun = r.pIBSMun == null ? REFORMA_PADRAO.pIBSMun : r.pIBSMun;
    return { pronta, linhas: [
      'CBS: ' + (pronta ? pctTxt(r.pCBS) : 'não definida — nota com emissão em 2027 não sai'),
      'IBS: ' + pctTxt(uf) + ' estadual + ' + pctTxt(mun) + ' municipal',
      'IBS e CBS na base do ICMS: ' + (r.icmsComIbsCbs === true ? 'sim (Resposta à Consulta Sefaz-SP 32931/2026)' : 'não (desligado até o contador confirmar)'),
      'O cliente paga: ' + (r.cobrarPorFora === true ? 'o total com o IBS e a CBS' : 'o total sem o IBS e a CBS (como hoje)')] };
  }

  const api = { REFORMA_PADRAO, reformaDoForm, resumoReforma, lerIbpt, SITUACAO, situacaoDe, doc, emitenteDoXml, faltasEmitente, confereTexto, horasDesde, mesSP, fechamento, zip, crc32 };
  raiz.CRMEmissao = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ------------------------------------------------------------ telas
(function (raiz) {
  'use strict';
  const CRM = raiz.CRM, M = raiz.CRMEmissao, R = raiz.CRMRegras;
  if (!CRM || !CRM.telas) return;
  const esc = CRM.esc, E = () => CRM.estado;
  const moeda = v => R.moeda(Number(v || 0));
  const quando = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const fiscalCfg = () => (E().cfg && E().cfg.fiscal) || {};
  const ambiente = () => (fiscalCfg().ambiente === 'producao' ? 'producao' : 'homologacao');
  const serie = () => Number(fiscalCfg().serie == null ? 2 : fiscalCfg().serie);
  const ehOp = () => CRM.papel() === 'logistica' || CRM.ehGestor();
  const seloAmb = a => (a === 'producao' ? CRM.selo('PRODUÇÃO', 'verde') : CRM.selo('HOMOLOGAÇÃO (teste, sem valor fiscal)', 'ambar'));
  const seloNfe = n => { const s = M.SITUACAO[M.situacaoDe(n)] || [n.situacao, 'cinza']; return CRM.selo(s[0], s[1]); };

  // estado da tela
  let nfes = null, inuts = [], carregando = false, saude = null, sefaz = null, testando = '';
  const f = { mes: M.mesSP(new Date().toISOString()), amb: null };

  async function carrega() {
    if (carregando) return;
    carregando = true;
    try { [nfes, inuts] = await Promise.all([CRM.store().nfes(), ehOp() ? CRM.store().nfeInutilizacoes() : Promise.resolve([])]); }
    catch (e) { nfes = nfes || []; CRM.falhou(e); }
    carregando = false;
    CRM.render();
  }
  const recarrega = () => { carregando = false; return carrega(); };
  const nfe = id => (nfes || []).find(n => n.id === id);
  const pedidoNum = n => { const p = n.pedido_id && CRM.pedidos && CRM.pedidos.pedido ? CRM.pedidos.pedido(n.pedido_id) : null; return p ? p.numero : null; };
  const chama = async corpo => CRM.store().fiscal(corpo);

  const carregados = {};
  const carregaJs = src => carregados[src] || (carregados[src] = new Promise((ok, falha) => {
    const sc = document.createElement('script');
    sc.src = src; sc.onload = ok; sc.onerror = () => { delete carregados[src]; falha(new Error('não consegui carregar ' + src + ' (sem internet?)')); };
    document.head.appendChild(sc);
  }));
  let logo = null;
  const pegaLogo = () => logo || (logo = new Promise(ok => {
    const img = new Image();
    img.onload = () => { try { const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; cv.getContext('2d').drawImage(img, 0, 0);
      ok({ data: cv.toDataURL('image/png'), formato: 'PNG', proporcao: img.naturalWidth / img.naturalHeight }); } catch (e) { ok(null); } };
    img.onerror = () => ok(null);
    img.src = CRM.logo();
  }));

  // ------------------------------------------------ aba Fiscal → 4. Emissão (só administrador)
  function certificadoTexto() {
    if (!saude) return '';
    const c = saude.certificado;
    if (!c) return '<p class="alerta">O serviço respondeu (versão ' + esc(saude.versao) + '), mas <strong>sem o certificado A1</strong>: falta pôr o .pfx e a senha na VPS (passo 3 do INSTALAR.md).</p>';
    const dias = Math.floor((new Date(c.validoAte).getTime() - Date.now()) / 864e5);
    return '<p class="' + (dias < 30 ? 'alerta' : 'dica') + '">Serviço fiscal ' + esc(saude.versao) + ' no ar · certificado de <strong>' + esc((/CN=([^,\n]+?)(?:\s+E:|,|\n|$)/.exec(c.titular || '') || [])[1] || c.titular || c.cnpj || '') + '</strong> válido até <strong>' +
      esc(new Date(c.validoAte).toLocaleDateString('pt-BR')) + '</strong> (' + (dias < 0 ? 'VENCIDO' : dias + ' dia(s)') + ')' + (dias < 30 ? ' — <strong>renovar o A1</strong> e trocar o arquivo na VPS.' : '.') + '</p>';
  }
  function secaoFiscal() {
    const fc = fiscalCfg(), em = fc.emitente, falta = M.faltasEmitente(fc), amb = ambiente();
    const homAut = (nfes || []).filter(n => n.ambiente === 'homologacao' && (n.situacao === 'autorizada' || n.situacao === 'cancelada')).length;
    if (nfes === null) setTimeout(carrega, 0);
    const e = (em && em.endereco) || {};
    return '<section class="cartao"><h2>4. Emissão de NF-e pelo CRM <small>Fase 4 · série ' + serie() + ' (o FKN segue na série 1)</small></h2>' +
      '<p>' + seloAmb(amb) + (amb === 'homologacao' ? ' A nota de teste vai à Sefaz de homologação, sai com "SEM VALOR FISCAL" e <strong>não entra no CRM</strong> (nem estoque, nem título, nem comissão).' : ' A nota autorizada entra no CRM como as do vigia: estoque, títulos, comissão e o pedido faturado.') + '</p>' +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="nf-saude"' + (testando ? ' disabled' : '') + '>Conferir o serviço fiscal</button>' +
        '<button type="button" class="btn sec" data-acao="nf-sefaz"' + (testando ? ' disabled' : '') + '>Status da Sefaz</button>' +
        '<button type="button" class="btn sec" data-acao="ir-nfe">Ver as notas emitidas (Pedidos → NF-e)</button></p>' +
      (testando ? '<p class="dica">' + esc(testando) + '</p>' : '') + certificadoTexto() +
      (sefaz ? '<p class="' + (Number(sefaz.cStat) === 107 ? 'dica' : 'alerta') + '">Sefaz-SP (' + esc(sefaz.ambiente === 'producao' ? 'produção' : 'homologação') + '): <strong>' + esc(sefaz.cStat) + ' — ' + esc(sefaz.xMotivo || '') + '</strong></p>' : '') +
      '<h3>Emitente</h3>' +
      (em ? '<dl class="dados grade"><dt>Razão social</dt><dd>' + esc(em.razao || '—') + '</dd><dt>CNPJ</dt><dd>' + esc(em.cnpj) + '</dd><dt>IE</dt><dd>' + esc(em.ie || '—') +
        '</dd><dt>Regime (CRT)</dt><dd>' + esc(em.crt === 1 ? '1 — Simples Nacional' : em.crt === 2 ? '2 — Simples (excesso)' : '3 — Regime normal') + '</dd><dt>Endereço</dt><dd>' +
        esc([e.logradouro, e.numero, e.complemento, e.bairro, e.municipio, e.uf, e.cep].filter(Boolean).join(', ')) + ' · IBGE ' + esc(e.cMun || '—') + '</dd>' +
        '<dt>Natureza</dt><dd>' + esc(fc.natOp || 'VENDA NO ESTADO') + '</dd><dt>Consumidor final</dt><dd>' + esc(fc.indFinal === 0 ? '0 — não (revenda/industrialização)' : '1 — sim') + '</dd>' +
        '<dt>Presença</dt><dd>' + esc(({ 0: '0 — não se aplica', 1: '1 — presencial', 2: '2 — internet', 3: '3 — telefone', 4: '4 — entrega a domicílio (NFC-e)', 9: '9 — outros (vendedor/WhatsApp)' })[fc.indPres == null ? 9 : fc.indPres] || fc.indPres) + '</dd>' +
        '<dt>Responsável técnico</dt><dd>' + esc(fc.respTec && fc.respTec.cnpj ? [fc.respTec.contato, fc.respTec.cnpj, fc.respTec.email].filter(Boolean).join(' · ') : '— (não preenchido)') + '</dd></dl>'
        : '<p class="vazio">Ainda não configurado. Comece por "Preencher pelo XML de uma nota do FKN": o CRM copia o emitente e as opções que o FKN usa.</p>') +
      (falta.length && em ? '<p class="alerta">Falta: ' + esc(falta.join(', ')) + '.</p>' : '') +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="nf-do-xml">Preencher pelo XML de uma nota do FKN</button>' +
        '<button type="button" class="btn sec" data-acao="nf-emitente">Editar emitente e opções</button>' +
        (amb === 'homologacao' ? '<button type="button" class="btn" data-acao="nf-producao"' + (falta.length ? ' disabled title="complete o emitente antes"' : '') + '>Passar para produção…</button>'
          : '<button type="button" class="btn sec" data-acao="nf-homologacao">Voltar para homologação</button>') + '</p>' +
      (amb === 'homologacao' ? '<p class="dica">Para passar para produção: serviço fiscal e certificado conferidos, Sefaz 107, e pelo menos uma nota de teste autorizada em homologação' +
        (nfes ? ' (até agora: ' + homAut + ')' : '') + '. O contador confere a tabela fiscal antes.</p>' : '') +
      reformaHtml(fc) + difalHtml(fc) +
      '<h3>Tabela do IBPT (tributos aproximados na nota, Lei 12.741)</h3>' + ibptHtml() +
      '<h3>ICMS-ST já recolhido (produtos com CST 60)</h3><p class="dica">Na revenda com substituição tributária a nota informa o ICMS-ST que veio na ' +
        '<strong>compra mais recente</strong> do produto (base, alíquota, ICMS próprio do fornecedor e ICMS-ST), proporcional à quantidade vendida. ' +
        'O CRM tira esses valores das notas de compra (Estoque → Notas de compra, pelo XML); o produto que ainda não tem nota de compra no CRM fica com o ' +
        'que o FKN informa nas notas dele. Rodar de novo depois de dar entrada em compras.</p>' +
      (stUltimo ? '<p class="dica">' + esc(stUltimo) + '</p>' : '') +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="nf-aprender-st"' + (testando ? ' disabled' : '') + '>Aprender o ICMS-ST (notas de compra e do FKN)</button></p></section>';
  }

  let ibpt = null, ibptCarregando = false, stUltimo = '';
  function ibptHtml() {
    if (ibpt === null && !ibptCarregando) { ibptCarregando = true; CRM.store().ibptInfo().then(r => { ibpt = r || {}; ibptCarregando = false; CRM.render(); }).catch(() => { ibpt = {}; ibptCarregando = false; }); }
    const i = ibpt || {}, br = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
    const vencida = i.vig_fim && String(i.vig_fim).slice(0, 10) < new Date().toISOString().slice(0, 10);
    return (i.n ? '<p class="' + (vencida ? 'alerta' : 'dica') + '">' + i.n + ' NCMs · versão ' + esc(i.versao || '') + ' (chave ' + esc(i.chave || '') + ') · vale de ' + br(i.vig_ini) + ' a ' + br(i.vig_fim) +
        (vencida ? ' — <strong>vencida</strong>: "Atualizar pelo IBPT agora" (com o token) ou carregar o CSV novo do site do IBPT.' : '.') + '</p>'
      : '<p class="alerta">Ainda não carregada: sem ela a nota sai sem os tributos aproximados.</p>') +
      apiHtml(i.api, br) +
      '<p class="acoes"><button class="btn sec" type="button" data-nf-ibpt-api>Atualizar pelo IBPT agora</button> ' +
      '<label class="btn sec">Carregar a tabela (TIBPT-SP.csv)<input type="file" accept=".csv,text/csv" data-nf-ibpt hidden></label></p>';
  }
  // A atualização sozinha (API do IBPT, token nos Secrets como IBPT_TOKEN): a crm-fiscal consulta os NCM dos produtos na 1ª
  // prévia depois que a tabela vence, uma vez por dia; o botão consulta todos na hora.
  function apiHtml(a, br) {
    if (!a) return '<p class="dica">Atualização automática pela API do IBPT: ainda não usada (precisa do token do cadastro gratuito no De Olho no Imposto, colado nos Secrets do Supabase como IBPT_TOKEN).</p>';
    if (a.erro) return '<p class="alerta">Última tentativa pela API do IBPT' + (a.em ? ' (' + br(String(a.em).slice(0, 10)) + ')' : '') + ': ' + esc(a.erro) + '</p>';
    return '<p class="' + (a.falhas ? 'alerta' : 'dica') + '">Pela API do IBPT em ' + br(String(a.em || '').slice(0, 10)) + ': ' + (a.gravados || 0) + ' de ' + (a.consultados || 0) + ' NCMs' +
      (a.versao ? ', versão ' + esc(a.versao) : '') + (a.vig_fim ? ', vale até ' + br(a.vig_fim) : '') +
      (a.falhas ? ' · ' + a.falhas + ' sem resposta (' + esc((a.exemplos_falha || []).join('; ')) + ')' : '') + '.</p>';
  }
  async function ibptPelaApi(b) {
    b.disabled = true; CRM.toast('Consultando a API do IBPT pelos NCM dos produtos… (pode levar um minuto)');
    try {
      const r = await CRM.store().fiscal({ acao: 'ibpt_atualizar' });
      ibpt = await CRM.store().ibptInfo();
      CRM.toast(r && r.ok ? 'Tabela do IBPT atualizada: ' + r.gravados + ' NCMs.' : 'IBPT: ' + ((r && (r.erro || (r.falhas + ' NCMs sem resposta'))) || 'sem resposta'));
      CRM.render();
    } catch (e) { CRM.falhou(e); } finally { b.disabled = false; }
  }
  async function carregaIbpt(arquivo) {
    try {
      const texto = new TextDecoder('windows-1252').decode(await arquivo.arrayBuffer());
      const t = M.lerIbpt(texto);
      CRM.toast('Carregando ' + t.linhas.length + ' NCMs da tabela do IBPT…');
      for (let i = 0; i < t.linhas.length; i += 2000) await CRM.store().ibptCarregar(t.linhas.slice(i, i + 2000));
      ibpt = await CRM.store().ibptInfo();
      CRM.toast('Tabela do IBPT ' + (t.versao || '') + ' carregada: ' + t.linhas.length + ' NCMs.'); CRM.render();
    } catch (e) { CRM.falhou(e); }
  }

  // ------------------------------------------------ Pedidos → NF-e
  function linhaNfe(n) {
    const s = M.situacaoDe(n), pn = pedidoNum(n), b = [];
    if (n.chave && (s === 'autorizada' || s === 'cancelada' || s === 'denegada')) b.push('<button type="button" class="mini" data-acao="nf-danfe" data-id="' + esc(n.id) + '">DANFE</button>', '<button type="button" class="mini" data-acao="nf-xml" data-id="' + esc(n.id) + '">XML</button>');
    if (n.chave && (s === 'pendente' || s === 'reservada' || s === 'rejeitada' || s === 'autorizada')) b.push('<button type="button" class="mini" data-acao="nf-consultar" data-id="' + esc(n.id) + '">Consultar</button>');
    if (s === 'autorizada') {
      b.push('<button type="button" class="mini" data-acao="nf-cce" data-id="' + esc(n.id) + '">Carta de correção</button>');
      if (ehOp()) b.push('<button type="button" class="mini perigo" data-acao="nf-cancelar" data-id="' + esc(n.id) + '">Cancelar</button>');
    }
    if ((s === 'rejeitada' || s === 'bloqueada') && n.outra_id) b.push('<button type="button" class="mini" data-acao="nf-outra-emitir" data-id="' + esc(n.outra_id) + '">Emitir de novo</button>');
    else if ((s === 'rejeitada' || s === 'bloqueada') && n.pedido_id) b.push('<button type="button" class="mini" data-acao="nf-emitir" data-id="' + esc(n.pedido_id) + '">Emitir de novo</button>');
    const evs = (n.eventos || []).filter(e => e.protocolo).map(e => (e.tipo === 'cancelar' ? 'cancelada ' : 'CC-e ' + e.seq + ' ') + quando(e.quando)).join(' · ');
    const avisos = (n.avisos && n.avisos.bloqueia) || [];
    return '<tr><td><strong>' + esc(n.serie + '-' + n.numero) + '</strong>' + (n.ambiente === 'homologacao' ? '<small>homologação</small>' : '') +
      (n.tipo && n.tipo !== 'venda' ? '<small>' + esc(TIPOS[n.tipo] || n.tipo) + '</small>' : '') + '</td>' +
      '<td>' + esc(CRM.nomeEmpresa(n.empresa_id)) + (pn ? ' <button type="button" class="mini" data-acao="nf-pedido" data-id="' + esc(n.pedido_id) + '">pedido ' + esc(pn) + '</button>' : '') + '</td>' +
      '<td class="num">' + (n.valor != null ? moeda(n.valor) : '—') + '</td><td>' + seloNfe(n) +
      (['rejeitada', 'denegada', 'pendente', 'bloqueada'].indexOf(s) !== -1 && n.motivo ? '<small>' + esc((n.cstat ? n.cstat + ' — ' : '') + n.motivo) + '</small>' : '') + (avisos.length ? '<small>' + esc(avisos.join(' · ')) + '</small>' : '') +
      (evs ? '<small>' + esc(evs) + '</small>' : '') + '</td><td>' + esc(quando(n.autorizada_em || n.atualizado_em || n.criado_em)) + '</td><td class="num">' + b.join(' ') + '</td></tr>';
  }
  function tela() {
    if (nfes === null) { setTimeout(carrega, 0); return '<div class="cartao"><p class="vazio">Carregando as notas…</p></div>'; }
    const amb = ambiente();
    // em produção a lista abre só nas notas que valem (as de teste da homologação ficam no filtro "Homologação")
    if (f.amb == null) f.amb = amb === 'producao' ? 'producao' : '';
    const l = nfes.filter(n => !f.amb || n.ambiente === f.amb);
    const pend = nfes.filter(n => n.situacao === 'pendente' && !n.inutilizada_em);
    const chip = (v, t) => '<button type="button" class="chip-filtro' + (f.amb === v ? ' ativo' : '') + '" data-acao="nf-amb" data-id="' + v + '">' + esc(t) + '</button>';
    return '<section class="cartao"><h2>NF-e emitidas pelo CRM <small>série ' + serie() + ' · últimos 90 dias</small></h2>' +
      '<p>' + seloAmb(amb) + ' ' + (fiscalCfg().emitente ? '' : '<strong>O emitente ainda não foi configurado</strong> (aba Fiscal, só o administrador).') + '</p>' +
      (pend.length ? '<p class="alerta"><strong>' + pend.length + ' nota(s) sem resposta da Sefaz.</strong> Clique em "Consultar": se a Sefaz não recebeu, o CRM reenvia o MESMO XML (nunca emita outra para o mesmo pedido antes disso).</p>' : '') +
      '<div class="chips">' + chip('', 'Todas') + chip('producao', 'Produção') + chip('homologacao', 'Homologação') + '</div>' +
      (l.length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>NF</th><th>Cliente</th><th class="num">Valor</th><th>Situação</th><th>Quando</th><th></th></tr></thead><tbody>' +
        l.map(linhaNfe).join('') + '</tbody></table></div>' : '<p class="vazio">Nenhuma nota emitida pelo CRM ainda. A nota sai do pedido: abra o pedido separado e clique em "Emitir NF-e".</p>') + '</section>' +
      (CRM.ehAdmin() ? '<section class="cartao"><h2>Fechamento do mês para o contador</h2>' +
        '<p>ZIP com os XML de saída emitidos pelo CRM (produção), os eventos de cancelamento e de correção, as inutilizações e a relação de canceladas e inutilizadas.' + (CRM.fknDesligado && CRM.fknDesligado() ? '' : ' As notas da série 1 o FKN continua mandando como sempre.') + '</p>' +
        '<p class="acoes"><input type="month" value="' + esc(f.mes) + '" data-nf-mes> <button type="button" class="btn" data-acao="nf-fechamento">Baixar o ZIP do mês</button></p></section>' : '') +
      (ehOp() ? '<section class="cartao"><h2>Outras notas</h2>' +
        '<p>Devoluções saem da nota original (os valores e os impostos vêm dela, na proporção do que volta). Bonificação e entrega futura saem do pedido: botão "Outra operação…" no pedido.</p>' +
        '<p class="acoes"><button type="button" class="btn sec" data-acao="nf-devolucao" data-id="devolucao_fornecedor">Devolução a fornecedor…</button> ' +
        '<button type="button" class="btn sec" data-acao="nf-devolucao" data-id="devolucao_cliente">Devolução de cliente…</button></p>' +
        '<p class="dica">Cliente com inscrição estadual (contribuinte) devolve com a nota dele: o CRM só emite a nota de entrada para quem não é contribuinte (condomínio, escola, pessoa física).</p></section>' : '') +
      (ehOp() ? '<section class="cartao"><h2>Inutilizar numeração</h2><p class="dica">Para números que pularam e não vão ser usados (uma nota rejeitada de pedido que não sai, um salto na numeração). Nota autorizada não se inutiliza: cancela-se.</p>' +
        (inuts.length ? '<ul class="lista">' + inuts.slice(0, 20).map(i => '<li>' + esc('Série ' + i.serie + ', ' + (i.de === i.ate ? 'nº ' + i.de : 'nº ' + i.de + ' a ' + i.ate) + ' · ' + (i.ambiente === 'producao' ? 'produção' : 'homologação') + ' · ' + quando(i.criado_em) + ' · ' + (i.cstat || '') + ' ' + (i.motivo || '')) + '</li>').join('') + '</ul>' : '') +
        '<p class="acoes"><button type="button" class="btn sec" data-acao="nf-inutilizar">Inutilizar números…</button></p></section>' : '');
  }

  // Botão e notas do pedido (tela do pedido em pedidos.js).
  const podeEmitir = p => ehOp() && !!fiscalCfg().emitente && (p.situacao === 'separado' || p.situacao === 'separacao' ||
    (p.situacao === 'aberto' && !(p.bloqueios || []).some(b => (p.liberado || []).indexOf(b) === -1)));
  function doPedido(p) {
    if (!ehOp()) return '';
    if (nfes === null) { setTimeout(carrega, 0); return ''; }
    const l = nfes.filter(n => n.pedido_id === p.id);
    return l.length ? '<div class="tabela-rolagem"><table class="tabela"><tbody>' + l.map(linhaNfe).join('') + '</tbody></table></div>' : '';
  }

  // ------------------------------------------------ emitir
  const lista = (t, l, cls) => (l && l.length ? '<p class="' + cls + '"><strong>' + esc(t) + '</strong></p><ul class="fi-alertas">' + l.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '');
  function previaHtml(r) {
    const t = r.totais || {}, nota = r.nota || {}, av = r.avisos || {};
    const ib = t.ibscbs;
    const tot = r.bloqueado ? '' : '<dl class="dados grade"><dt>Produtos</dt><dd>' + moeda(t.vProd) + '</dd><dt>Frete</dt><dd>' + moeda(t.vFrete) + '</dd><dt>Desconto</dt><dd>' + moeda(t.vDesc) + '</dd>' +
      '<dt>ICMS</dt><dd>' + moeda(t.vICMS) + ' (base ' + moeda(t.vBC) + ')</dd>' +
      (t.vOutro ? '<dt>Outras despesas</dt><dd>' + moeda(t.vOutro) + ' (ICMS-ST da nota de origem)</dd>' : '') +
      (t.vIPIDevol ? '<dt>IPI devolvido</dt><dd>' + moeda(t.vIPIDevol) + '</dd>' : '') + '<dt>PIS / COFINS</dt><dd>' + moeda(t.vPIS) + ' / ' + moeda(t.vCOFINS) + '</dd>' +
      // 2026: IBS/CBS só informativo; 2027 em diante (vNFTot): cobrado por fora, com o total que o inclui
      (ib ? '<dt>CBS / IBS' + (t.vNFTot == null ? ' (informativo em 2026)' : '') + '</dt><dd>' + moeda(ib.vCBS) + ' / ' + moeda(ib.vIBS) + '</dd>' : '') +
      '<dt>Total da nota' + (t.vNFTot == null ? '' : ' (sem IBS/CBS)') + '</dt><dd><strong>' + moeda(t.vNF) + '</strong></dd>' +
      (t.vNFTot == null ? '' : '<dt>Total com IBS/CBS</dt><dd><strong>' + moeda(t.vNFTot) + '</strong></dd>') + '</dl>';
    const its = (nota.itens || []).length ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Código</th><th>Produto</th><th>NCM</th><th>CFOP</th><th>CST</th><th class="num">Qtde</th><th class="num">Total</th></tr></thead><tbody>' +
      nota.itens.map(i => '<tr><td>' + esc(i.codigo) + '</td><td>' + esc(i.descricao) + '</td><td>' + esc(i.ncm) + '</td><td>' + esc(i.cfop) + '</td><td>' + esc(i.icms.cst) + ' · ' + esc(i.pis.cst) + '</td><td class="num">' +
        esc(Number(i.quantidade).toLocaleString('pt-BR')) + ' ' + esc(i.unidade) + '</td><td class="num">' + moeda(i.quantidade * i.valorUnitario - (i.desconto || 0)) + '</td></tr>').join('') + '</tbody></table></div>' : '';
    const dups = nota.cobranca && nota.cobranca.duplicatas || [];
    const pg = (nota.pagamento || [])[0];
    const cob = dups.length ? '<p>Parcelas: ' + esc(dups.map(d => d.vencimento.split('-').reverse().join('/') + ' ' + moeda(d.valor)).join(' · ')) + '</p>' : pg ? '<p>Pagamento: ' + esc(({ '17': 'PIX', '18': 'transferência', '01': 'dinheiro', '03': 'cartão de crédito', '04': 'cartão de débito', '99': 'outros' })[pg.tPag] || pg.tPag) + ' à vista</p>' : '';
    return '<div class="nf-previa">' + lista('Isto impede a emissão:', av.bloqueia, 'alerta') + lista('Para conferir:', av.conferir, 'dica') + tot + cob + its +
      (nota.infAdFisco ? '<p class="dica">Informações ao fisco: ' + esc(nota.infAdFisco) + '</p>' : '') +
      (nota.infCpl ? '<p class="dica">Informações complementares: ' + esc(nota.infCpl) + '</p>' : '') + '</div>';
  }
  async function emitir(pedidoId) {
    const p = CRM.pedidos && CRM.pedidos.pedido ? CRM.pedidos.pedido(pedidoId) : null;
    if (p && p.situacao === 'separacao' && (p.itens || []).some(i => !i.separado) && !confirm('O pedido ' + p.numero + ' ainda tem itens sem a caixinha de separado. Emitir a nota assim mesmo?')) return;
    CRM.toast('Montando a prévia da nota…');
    let r;
    try { r = await chama({ acao: 'previa', pedido_id: pedidoId }); } catch (e) { CRM.falhou(e); return; }
    const amb = r.ambiente || ambiente();
    CRM.abrirForm({
      titulo: 'NF-e do pedido ' + (p ? p.numero : '') + ' · ' + (p ? CRM.nomeEmpresa(p.empresa_id) : ''), largura: 'largo',
      intro: r.bloqueado ? 'A nota não pode sair ainda: corrija o que está abaixo (cadastro do cliente ou regra fiscal do produto) e tente de novo.'
        : (amb === 'producao' ? 'PRODUÇÃO: a nota vale de verdade. Confira os valores e clique em "Emitir".' : 'HOMOLOGAÇÃO: nota de teste, sem valor fiscal; o pedido não muda.') + ' Série ' + (r.serie || serie()) + '.',
      campos: [], htmlDepois: previaHtml(r), salvarTexto: r.bloqueado ? 'Fechar' : 'Emitir a NF-e',
      aoSalvar: async () => {
        if (r.bloqueado) return;
        const res = await chama({ acao: 'emitir', pedido_id: pedidoId });
        const n = res.nfe || {};
        await recarrega();
        if (CRM.pedidos && CRM.pedidos.recarregar) await CRM.pedidos.recarregar();
        if (n.situacao === 'autorizada') {
          CRM.toast('NF ' + n.serie + '-' + n.numero + ' autorizada' + (n.ambiente === 'homologacao' ? ' (homologação, sem valor fiscal)' : '') + '. Protocolo ' + (n.protocolo || '') + '.');
          setTimeout(() => { if (confirm('NF ' + n.numero + ' autorizada. Baixar a DANFE agora?')) danfe(n.id); }, 200);
          return;
        }
        if (n.situacao === 'pendente') throw new Error('a Sefaz não respondeu a tempo. A nota ficou "sem resposta": vá em Pedidos → NF-e e clique em "Consultar" (não emita outra).');
        if (n.situacao === 'bloqueada') throw new Error('a nota não saiu: ' + ((n.avisos && n.avisos.bloqueia) || []).join('; '));
        throw new Error('a Sefaz ' + (n.situacao === 'denegada' ? 'DENEGOU' : 'rejeitou') + ' a nota: ' + (n.cstat || '') + ' — ' + (n.motivo || '') +
          (n.situacao === 'rejeitada' ? '. Corrija e emita de novo: o mesmo número é reaproveitado.' : ''));
      }
    });
  }

  // Emissão em lote (a logística marca os separados e emite de uma vez): um de cada vez, na ordem; o que tem aviso que
  // bloqueia fica de fora; se a Sefaz parar de responder, para tudo (não adianta seguir e nunca se emite de novo sem consultar).
  const marcados = new Set();
  async function lote() {
    const ids = [...marcados].filter(id => { const p = CRM.pedidos.pedido(id); return p && podeEmitir(p); });
    if (!ids.length) { CRM.toast('Marque os pedidos.', true); return; }
    const amb = ambiente();
    if (!confirm('Emitir ' + ids.length + ' NF-e' + (amb === 'producao' ? ' em PRODUÇÃO (valem de verdade)' : ' em HOMOLOGAÇÃO (teste)') + '?\nOs que tiverem pendência (cadastro, regra fiscal) ficam de fora e aparecem no fim.')) return;
    const res = [];
    for (let i = 0; i < ids.length; i++) {
      const p = CRM.pedidos.pedido(ids[i]), rot = 'pedido ' + (p ? p.numero : '') + ' · ' + (p ? CRM.nomeEmpresa(p.empresa_id) : '');
      CRM.toast('Emitindo ' + (i + 1) + ' de ' + ids.length + ': ' + rot + '…');
      try {
        const pv = await chama({ acao: 'previa', pedido_id: ids[i] });
        if (pv.bloqueado) { res.push({ rot, sit: 'bloqueada', txt: (pv.avisos.bloqueia || []).join('; ') }); continue; }
        const n = (await chama({ acao: 'emitir', pedido_id: ids[i] })).nfe || {};
        res.push({ rot, sit: n.situacao, nfe: n, txt: n.situacao === 'autorizada' ? 'NF ' + n.serie + '-' + n.numero : (n.cstat || '') + ' — ' + (n.motivo || '') });
        marcados.delete(ids[i]);
        if (n.situacao === 'pendente') { res.push({ rot: '', sit: 'parado', txt: 'a Sefaz não respondeu: parei aqui. Consulte a nota pendente antes de seguir.' }); break; }
      } catch (e) { res.push({ rot, sit: 'erro', txt: e.message }); }
    }
    await recarrega();
    if (CRM.pedidos.recarregar) await CRM.pedidos.recarregar();
    const aut = res.filter(r => r.sit === 'autorizada');
    const cor = { autorizada: 'verde', bloqueada: 'ambar', rejeitada: 'vermelho', denegada: 'vermelho', pendente: 'ambar', parado: 'vermelho', erro: 'vermelho' };
    CRM.abrirForm({ titulo: 'Emissão em lote: ' + aut.length + ' de ' + ids.length + ' autorizada(s)', largura: 'largo', campos: [],
      intro: aut.length ? 'Baixe as DANFEs das autorizadas num PDF só, para imprimir e mandar com a entrega.' : 'Nenhuma nota autorizada.',
      htmlDepois: '<ul class="lista">' + res.map(r => '<li>' + CRM.selo((M.SITUACAO[r.sit] || [r.sit])[0], cor[r.sit] || 'cinza') + ' <strong>' + esc(r.rot) + '</strong> ' + esc(r.txt) + '</li>').join('') + '</ul>',
      salvarTexto: aut.length ? 'Baixar as ' + aut.length + ' DANFE(s)' : 'Fechar',
      aoSalvar: async () => { if (aut.length) await danfes(aut.map(r => r.nfe.id)); } });
  }
  async function danfes(ids) {
    await carregaJs('vendor/jspdf.umd.min.js');
    const Dn = raiz.CRMDanfe, pdf = new raiz.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true }), lg = await pegaLogo();
    let n = 0;
    for (const id of ids) {
      const x = await CRM.store().nfeXml(id), xml = x && (x.proc_xml || x.nfe_xml), d = xml && Dn.ler(xml);
      if (!d) continue;
      if (n++) pdf.addPage('a4', 'portrait');
      Dn.desenha(pdf, d, { logo: lg, cores: (raiz.CRM_CONFIG || {}).cores });
    }
    if (n) pdf.save('DANFEs-' + new Date().toISOString().slice(0, 10) + '.pdf');
  }

  async function xmlDe(id) {
    const x = await CRM.store().nfeXml(id);
    const xml = x && (x.proc_xml || x.nfe_xml);
    if (!xml) throw new Error('esta nota não tem XML guardado');
    return xml;
  }
  async function danfe(id) {
    try {
      const n = nfe(id), xml = await xmlDe(id);
      await carregaJs('vendor/jspdf.umd.min.js');
      const Dn = raiz.CRMDanfe, d = Dn.ler(xml);
      if (!d) throw new Error('não consegui ler o XML da nota');
      if (n && n.situacao === 'cancelada') Object.assign(d, { autorizada: false, marca: 'NF-e CANCELADA' });
      const pdf = new raiz.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
      Dn.desenha(pdf, d, { logo: await pegaLogo(), cores: (raiz.CRM_CONFIG || {}).cores });
      pdf.save('DANFE-NF' + (n ? n.serie + '-' + n.numero : d.numero) + '.pdf');
    } catch (e) { CRM.falhou(e); }
  }

  // Reforma de 2027: só vale para nota com data de emissão em 2027 ou depois; em 2026 a nota não muda.
  function reformaHtml(fc) {
    const r = M.resumoReforma(fc.reforma2027), ano = Number(R.hojeISO().slice(0, 4));
    return '<h3>Reforma tributária: notas emitidas a partir de 01/01/2027</h3>' +
      '<p class="dica">Vale pela data de emissão da nota; as notas de ' + (ano <= 2026 ? 'agora (2026)' : '2026') + ' não mudam. ' +
        'Em 2027 a CBS passa a ser cobrada e o PIS/COFINS acabam. Combine cada item com o contador antes de virar o ano.</p>' +
      '<ul class="lista">' + r.linhas.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>' +
      (r.pronta ? '' : '<p class="' + (ano >= 2027 ? 'alerta' : 'dica') + '">Sem a alíquota da CBS, pedido com nota em 2027 fica bloqueado na emissão.</p>') +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="nf-reforma">Configurar a regra de 2027</button></p>';
  }
  function formReforma() {
    const r = fiscalCfg().reforma2027 || {};
    CRM.abrirForm({
      titulo: 'Reforma tributária: notas a partir de 01/01/2027',
      intro: 'Só vale para nota emitida em 2027 ou depois. Preencha com o que o contador passar: a alíquota da CBS de 2027 ainda ' +
        'depende do Senado (referência menos 0,1 ponto, pela LC 214/2025). O ICMS continua fora da base do IBS e da CBS até 2032.',
      campos: [
        { nome: 'pCBS', rotulo: 'CBS (%)', tipo: 'numero', passo: '0.01', min: 0, max: 30, vazioNulo: true, ajuda: 'Vazio = ainda não definida: nota de 2027 não sai.' },
        { nome: 'pIBSUF', rotulo: 'IBS estadual (%)', tipo: 'numero', passo: '0.01', min: 0, max: 30, vazioNulo: true, ajuda: '2027 e 2028: 0,05% (LC 214/2025). Vazio = 0,05.' },
        { nome: 'pIBSMun', rotulo: 'IBS municipal (%)', tipo: 'numero', passo: '0.01', min: 0, max: 30, vazioNulo: true, ajuda: '2027 e 2028: 0,05% (LC 214/2025). Vazio = 0,05.' },
        { tipo: 'info', rotulo: 'A Sefaz-SP entende que o IBS e a CBS entram na base do ICMS a partir de 2027 (Resposta à Consulta 32931/2026); ' +
          'há decisão de primeira instância contra. Ligue só depois do "de acordo" do contador.' },
        { nome: 'icmsComIbsCbs', rotulo: 'IBS e CBS entram na base do ICMS', tipo: 'checkbox', largo: true },
        { tipo: 'info', rotulo: 'O IBS e a CBS são cobrados "por fora": a nota mostra o total com eles. Marque se o cliente paga esse total ' +
          '(as parcelas e o pagamento fecham com ele); senão, as parcelas continuam com o total de hoje.' },
        { nome: 'cobrarPorFora', rotulo: 'O cliente paga o total com o IBS e a CBS', tipo: 'checkbox', largo: true }],
      valores: { pCBS: r.pCBS == null ? '' : r.pCBS, pIBSUF: r.pIBSUF == null ? M.REFORMA_PADRAO.pIBSUF : r.pIBSUF,
        pIBSMun: r.pIBSMun == null ? M.REFORMA_PADRAO.pIBSMun : r.pIBSMun, icmsComIbsCbs: r.icmsComIbsCbs === true, cobrarPorFora: r.cobrarPorFora === true },
      salvarTexto: 'Salvar',
      aoSalvar: async v => {
        const novo = M.reformaDoForm(v);
        if (novo.icmsComIbsCbs && r.icmsComIbsCbs !== true &&
          !confirm('Colocar o IBS e a CBS na base do ICMS das notas de 2027 em diante?\n\nO ICMS dessas notas fica maior. Faça isso só com o "de acordo" do contador.')) return false;
        await salvaFiscal({ reforma2027: novo });
        CRM.toast('Regra de 2027 salva.'); CRM.render();
      }
    });
  }

  // DIFAL (23/10/2026): venda a consumidor final não contribuinte de outro estado. A alíquota interna de cada UF de destino
  // (e o FCP, se houver) fica em dados.fiscal.difal[UF]; sem ela a nota para aquela UF não sai. A guia GNRE vira conta no Caixa.
  const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'TO'];
  function difalHtml(fc) {
    const d = fc.difal || {}, ufs = Object.keys(d).sort();
    return '<h3>Venda para consumidor de outro estado (DIFAL)</h3>' +
      '<p class="dica">Só para cliente sem inscrição estadual. A nota sai com CFOP 6108, ICMS interestadual (12% para Sul/Sudeste, 7% para os outros, ' +
        '4% em importado) e o DIFAL do estado do cliente (alíquota interna de lá − interestadual). A guia GNRE é paga antes de a mercadoria sair e ' +
        'entra sozinha no Caixa quando a nota é autorizada. Contribuinte de outro estado ainda não sai pelo CRM.</p>' +
      (ufs.length ? '<table class="tabela"><thead><tr><th>Estado</th><th>Alíquota interna</th><th>FCP</th><th>Conferida</th><th></th></tr></thead><tbody>' +
        ufs.map(u => '<tr><td>' + esc(u) + '</td><td>' + esc(String(d[u].aliq)) + '%</td><td>' + esc(String(d[u].fcp || 0)) + '%</td><td>' + (d[u].conferido ? '✓' : '<span class="selo">a conferir</span>') +
          '</td><td><button type="button" class="btn sec mini" data-acao="nf-difal" data-id="' + esc(u) + '">Alterar</button></td></tr>').join('') + '</tbody></table>'
        : '<p class="alerta">Nenhum estado configurado: venda para fora de SP fica bloqueada.</p>') +
      '<p class="acoes"><button type="button" class="btn sec" data-acao="nf-difal">Incluir estado</button></p>';
  }
  function formDifal(uf) {
    const d = (fiscalCfg().difal || {}), x = uf ? d[uf] || {} : {};
    CRM.abrirForm({
      titulo: uf ? 'DIFAL: ' + uf : 'DIFAL: incluir estado',
      intro: 'Alíquota interna geral do estado do cliente (a do RICMS de lá) e o adicional do FCP, se o estado cobrar sobre estes produtos. ' +
        'Confira na legislação do estado ou com o contador e marque como conferida.',
      campos: [
        { nome: 'uf', rotulo: 'Estado', tipo: 'select', obrigatorio: true, opcoes: UFS.map(u => [u, u]) },
        { nome: 'aliq', rotulo: 'Alíquota interna (%)', tipo: 'numero', passo: '0.01', min: 0, max: 40, obrigatorio: true },
        { nome: 'fcp', rotulo: 'FCP (%)', tipo: 'numero', passo: '0.01', min: 0, max: 4, ajuda: 'Vazio = sem FCP.' },
        { nome: 'conferido', rotulo: 'Conferida na legislação do estado', tipo: 'checkbox', largo: true },
        { nome: 'remover', rotulo: 'Tirar este estado (a venda para ele volta a ser bloqueada)', tipo: 'checkbox', largo: true }],
      valores: { uf: uf || 'RS', aliq: x.aliq == null ? '' : x.aliq, fcp: x.fcp == null ? '' : x.fcp, conferido: x.conferido === true, remover: false },
      salvarTexto: 'Salvar',
      aoSalvar: async v => {
        const novo = Object.assign({}, d), u = String(v.uf || '').toUpperCase();
        if (uf && uf !== u) delete novo[uf];
        if (v.remover) delete novo[u];
        else {
          const aliq = Number(String(v.aliq).replace(',', '.')), fcp = Number(String(v.fcp || 0).replace(',', '.'));
          if (!(aliq > 0)) { CRM.toast('Informe a alíquota interna do estado.'); return false; }
          novo[u] = { aliq, fcp: fcp > 0 ? fcp : 0, conferido: !!v.conferido };
        }
        await salvaFiscal({ difal: novo });
        CRM.toast('DIFAL ' + u + (v.remover ? ' retirado.' : ' salvo.')); CRM.render();
      }
    });
  }

  // só os campos que mudaram: o banco junta sobre o fiscal atual (crm_config_mesclar), sem desfazer o que outra tela salvou
  const salvaFiscal = async patch => { await CRM.salvarConfig({ fiscal: CRM.store().configMesclar ? patch : Object.assign({}, fiscalCfg(), patch) }); };
  function formEmitente(base) {
    const fc = Object.assign({}, fiscalCfg(), base || {}), em = fc.emitente || {}, e = em.endereco || {}, rt = fc.respTec || {};
    CRM.abrirForm({
      titulo: 'Emitente da NF-e', largura: 'largo',
      intro: base ? 'Lido do XML da nota ' + (base._nota || '') + ' do FKN. Confira e salve.' : 'Os dados da empresa que vão em toda nota. O CNPJ e a IE precisam ser os do certificado A1.',
      campos: [{ tipo: 'secao', rotulo: 'Empresa' }, { nome: 'razao', rotulo: 'Razão social', obrigatorio: true, largo: true }, { nome: 'fantasia', rotulo: 'Nome fantasia' },
        { nome: 'cnpj', rotulo: 'CNPJ', obrigatorio: true }, { nome: 'ie', rotulo: 'Inscrição estadual', obrigatorio: true },
        { nome: 'crt', rotulo: 'Regime tributário (CRT)', tipo: 'select', opcoes: [['3', '3 — Regime normal (Lucro Real/Presumido)'], ['1', '1 — Simples Nacional'], ['2', '2 — Simples, excesso de sublimite']] },
        { tipo: 'secao', rotulo: 'Endereço' }, { nome: 'logradouro', rotulo: 'Rua', obrigatorio: true, largo: true }, { nome: 'numero', rotulo: 'Número', obrigatorio: true }, { nome: 'complemento', rotulo: 'Complemento' },
        { nome: 'bairro', rotulo: 'Bairro', obrigatorio: true }, { nome: 'municipio', rotulo: 'Município', obrigatorio: true }, { nome: 'cMun', rotulo: 'Código IBGE do município', obrigatorio: true, ajuda: '7 números (São Bernardo do Campo: 3548708)' },
        { nome: 'uf', rotulo: 'UF', obrigatorio: true }, { nome: 'cep', rotulo: 'CEP', obrigatorio: true }, { nome: 'fone', rotulo: 'Telefone' },
        { tipo: 'secao', rotulo: 'Opções da nota' }, { nome: 'natOp', rotulo: 'Natureza da operação', largo: true },
        { nome: 'indFinal', rotulo: 'Consumidor final', tipo: 'select', opcoes: [['1', '1 — sim (cliente usa/consome)'], ['0', '0 — não (revenda ou industrialização)']] },
        { nome: 'indPres', rotulo: 'Presença do comprador', tipo: 'select', opcoes: [['9', '9 — outros (vendedor, WhatsApp, e-mail)'], ['1', '1 — presencial'], ['2', '2 — internet'], ['3', '3 — telefone'], ['0', '0 — não se aplica']] },
        { nome: 'serie', rotulo: 'Série das notas do CRM', tipo: 'numero', passo: '1', min: 0, max: 889, ajuda: 'O FKN usa a 1; no paralelo o CRM usa a 2, para os números nunca se chocarem.' },
        { tipo: 'secao', rotulo: 'Responsável técnico pelo sistema (exigido pela Sefaz-SP)' }, { nome: 'rt_cnpj', rotulo: 'CNPJ' }, { nome: 'rt_contato', rotulo: 'Nome do contato' },
        { nome: 'rt_email', rotulo: 'E-mail', tipo: 'email' }, { nome: 'rt_fone', rotulo: 'Telefone' }],
      valores: { razao: em.razao || '', fantasia: em.fantasia || '', cnpj: em.cnpj || '', ie: em.ie || '', crt: String(em.crt || 3), logradouro: e.logradouro || '', numero: e.numero || '',
        complemento: e.complemento || '', bairro: e.bairro || '', municipio: e.municipio || '', cMun: e.cMun || '', uf: e.uf || 'SP', cep: e.cep || '', fone: e.fone || '',
        natOp: fc.natOp || 'VENDA NO ESTADO', indFinal: String(fc.indFinal == null ? 1 : fc.indFinal), indPres: String(fc.indPres == null ? 9 : fc.indPres), serie: fc.serie == null ? 2 : fc.serie,
        rt_cnpj: rt.cnpj || '', rt_contato: rt.contato || '', rt_email: rt.email || '', rt_fone: rt.fone || '' },
      salvarTexto: 'Salvar',
      aoSalvar: async v => {
        const d = x => String(x || '').replace(/\D/g, '');
        const novo = { emitente: { cnpj: M.doc(v.cnpj), ie: d(v.ie), razao: String(v.razao).trim().toUpperCase(), fantasia: String(v.fantasia || '').trim().toUpperCase() || null, crt: Number(v.crt) || 3,
          endereco: { logradouro: String(v.logradouro).trim().toUpperCase(), numero: String(v.numero).trim(), complemento: String(v.complemento || '').trim().toUpperCase() || null, bairro: String(v.bairro).trim().toUpperCase(),
            cMun: d(v.cMun), municipio: String(v.municipio).trim().toUpperCase(), uf: String(v.uf).trim().toUpperCase(), cep: d(v.cep), fone: d(v.fone) || null } },
          natOp: String(v.natOp || '').trim().toUpperCase() || 'VENDA NO ESTADO', indFinal: Number(v.indFinal), indPres: Number(v.indPres), serie: v.serie == null ? 2 : Number(v.serie),
          respTec: M.doc(v.rt_cnpj) ? { cnpj: M.doc(v.rt_cnpj), contato: String(v.rt_contato || '').trim(), email: String(v.rt_email || '').trim(), fone: d(v.rt_fone) } : null };
        const falta = M.faltasEmitente(novo);
        if (falta.length) throw new Error('falta ' + falta.join(', '));
        if (novo.serie === 1 && !confirm('A série 1 é a do FKN. Usar a mesma série no paralelo faz os números se chocarem. Usar assim mesmo?')) return false;
        await salvaFiscal(novo);
        CRM.toast('Emitente salvo.'); CRM.render();
      }
    });
  }

  // ------------------------------------------------ outras notas (Fase 4b)
  const TIPOS = { devolucao_fornecedor: 'devolução a fornecedor', devolucao_cliente: 'devolução de cliente', bonificacao: 'bonificação',
    faturamento_futuro: 'entrega futura: faturamento', remessa_futura: 'entrega futura: remessa' };
  async function outraEmitir(outraId, titulo) {
    CRM.toast('Montando a prévia da nota…');
    let r;
    try { r = await chama({ acao: 'outra_previa', outra_id: outraId }); } catch (e) { CRM.falhou(e); return; }
    const amb = r.ambiente || ambiente();
    CRM.abrirForm({
      titulo, largura: 'largo',
      intro: r.bloqueado ? 'A nota não pode sair: veja abaixo.' : (amb === 'producao' ? 'PRODUÇÃO: a nota vale de verdade. Confira e clique em "Emitir".' : 'HOMOLOGAÇÃO: nota de teste, sem valor fiscal; estoque e financeiro não mudam.') + ' Série ' + (r.serie || serie()) + '.',
      campos: [], htmlDepois: previaHtml(r), salvarTexto: r.bloqueado ? 'Fechar' : 'Emitir a NF-e',
      aoSalvar: async () => {
        if (r.bloqueado) return;
        const n = (await chama({ acao: 'outra_emitir', outra_id: outraId })).nfe || {};
        await recarrega();
        if (CRM.pedidos && CRM.pedidos.recarregar) await CRM.pedidos.recarregar();
        if (n.situacao === 'autorizada') { CRM.toast('NF ' + n.serie + '-' + n.numero + ' autorizada' + (n.ambiente === 'homologacao' ? ' (homologação)' : '') + '.'); setTimeout(() => { if (confirm('Baixar a DANFE agora?')) danfe(n.id); }, 200); return; }
        if (n.situacao === 'pendente') throw new Error('a Sefaz não respondeu a tempo: em Pedidos → NF-e, clique em "Consultar" (não emita outra).');
        if (n.situacao === 'bloqueada') throw new Error('a nota não saiu: ' + ((n.avisos && n.avisos.bloqueia) || []).join('; '));
        throw new Error('a Sefaz rejeitou: ' + (n.cstat || '') + ' — ' + (n.motivo || '') + '. Corrija e emita de novo (mesmo número).');
      }
    });
  }
  // Devolução: o número da nota original → os itens (só quantidades) → quanto volta de cada um e o motivo.
  function devolucao(tipo) {
    const forn = tipo === 'devolucao_fornecedor';
    CRM.abrirForm({ titulo: forn ? 'Devolução a fornecedor' : 'Devolução de cliente', campos: [{ nome: 'numero', rotulo: forn ? 'Número da nota de compra' : 'Número da nossa nota de venda', tipo: 'numero', passo: '1', obrigatorio: true }],
      salvarTexto: 'Buscar a nota', aoSalvar: async v => {
        const l = await CRM.store().outraOrigem(tipo, Math.round(v.numero));
        if (!l.length) throw new Error('não achei a nota ' + v.numero + (forn ? ' entre as notas de compra' : ' entre as notas de venda'));
        if (l.length === 1) { setTimeout(() => devolucaoItens(tipo, l[0]), 0); return; }
        setTimeout(() => CRM.abrirForm({ titulo: 'Qual nota ' + v.numero + '?', campos: [{ nome: 'i', rotulo: 'Nota', tipo: 'select', obrigatorio: true,
          opcoes: l.map((x, i) => [String(i), (x.nome || '') + ' · ' + String(x.emitida_em || '').slice(0, 10).split('-').reverse().join('/')]) }],
          salvarTexto: 'Continuar', aoSalvar: w => { setTimeout(() => devolucaoItens(tipo, l[Number(w.i)]), 0); } }), 0);
      } });
  }
  function devolucaoItens(tipo, o) {
    const forn = tipo === 'devolucao_fornecedor', q = x => Number(x || 0);
    if (!forn && o.contribuinte) { alert('O cliente é contribuinte do ICMS: a nota de devolução é dele. Peça a nota e dê a entrada por ela.'); return; }
    if (!forn && o.cancelada) { alert('Esta nota foi cancelada.'); return; }
    const itens = (o.itens || []).map(i => Object.assign({}, i, { resta: Math.max(0, q(i.quantidade) - q(i.devolvido)) }));
    CRM.abrirForm({ titulo: 'Devolução · NF ' + o.numero + ' · ' + (o.nome || ''), largura: 'largo',
      intro: 'Diga quanto volta de cada item (na unidade da nota). Os valores e os impostos saem da nota original, na proporção.' + (forn && o.situacao !== 'lancada' ? ' Atenção: esta compra ainda não teve entrada no estoque; a devolução não mexe no estoque.' : ''),
      campos: itens.map(i => ({ nome: 'q_' + i.nItem, rotulo: i.nItem + '. ' + (i.descricao || i.codigo) + ' — ' + Number(i.quantidade).toLocaleString('pt-BR') + ' ' + (i.unidade || '') +
        (q(i.devolvido) ? ' (já devolvido ' + Number(i.devolvido).toLocaleString('pt-BR') + ')' : ''), tipo: 'numero', passo: 'any', max: i.resta, desabilitado: !i.resta }))
        .concat([{ nome: 'motivo', rotulo: 'Motivo (vai na nota)', tipo: 'textarea', obrigatorio: true, dica: 'ex.: avaria no transporte; produto errado; fora da validade' }]),
      salvarTexto: 'Ver a prévia', aoSalvar: async v => {
        const sel = itens.filter(i => q(v['q_' + i.nItem]) > 0).map(i => ({ nItem: i.nItem, quantidade: q(v['q_' + i.nItem]) }));
        if (!sel.length) throw new Error('diga a quantidade de pelo menos um item');
        const r = await CRM.store().outraCriar({ tipo, ref_chave: o.chave, compra_id: o.compra_id || null, nota_id: o.nota_id || null, empresa_id: o.empresa_id || null,
          itens: sel, motivo: String(v.motivo || '').trim().slice(0, 300) });
        setTimeout(() => outraEmitir(r.id, (forn ? 'Devolução a fornecedor' : 'Devolução de cliente') + ' · NF ' + o.numero), 0);
      } });
  }
  // Do pedido: bonificação, faturamento ou remessa da entrega futura.
  function outraDoPedido(pedidoId) {
    const p = CRM.pedidos && CRM.pedidos.pedido ? CRM.pedidos.pedido(pedidoId) : null;
    if (!p) return;
    const temFat = (nfes || []).some(n => n.tipo === 'faturamento_futuro' && n.situacao === 'autorizada' && n.empresa_id === p.empresa_id);
    CRM.abrirForm({ titulo: 'Outra operação · pedido ' + p.numero, campos: [{ nome: 'tipo', rotulo: 'Nota', tipo: 'select', obrigatorio: true, opcoes: [
        ['bonificacao', 'Bonificação (5910): sem cobrança, ICMS como na venda'],
        ['faturamento_futuro', 'Entrega futura — faturamento (5922): cobra agora, sem ICMS, não mexe no estoque'],
        ['remessa_futura', 'Entrega futura — remessa (5117): na entrega, com ICMS, baixa o estoque' + (temFat ? '' : ' (emita antes o faturamento)')]] }],
      salvarTexto: 'Ver a prévia', aoSalvar: async v => {
        const r = await CRM.store().outraCriar({ tipo: v.tipo, pedido_id: p.id, empresa_id: p.empresa_id, itens: [] });
        setTimeout(() => outraEmitir(r.id, TIPOS[v.tipo].replace(/^./, c => c.toUpperCase()) + ' · pedido ' + p.numero), 0);
      } });
  }

  Object.assign(CRM.acoes, {
    'nf-devolucao': id => devolucao(id),
    'nf-outra-emitir': id => outraEmitir(id, 'Emitir de novo'),
    'nf-outra-pedido': id => outraDoPedido(id),
    'ir-nfe': () => { if (CRM.pedidos && CRM.pedidos.verNfe) CRM.pedidos.verNfe(); },
    'nf-amb': id => { f.amb = id; CRM.render(); },
    'nf-pedido': id => { if (CRM.pedidos && CRM.pedidos.abrir) CRM.pedidos.abrir(id); },
    'nf-saude': async () => {
      testando = 'Conferindo o serviço fiscal…'; CRM.render();
      try { saude = await chama({ acao: 'saude' }); } catch (e) { saude = null; CRM.falhou(e); }
      testando = ''; CRM.render();
    },
    'nf-sefaz': async () => {
      testando = 'Perguntando à Sefaz…'; CRM.render();
      try { sefaz = Object.assign(await chama({ acao: 'status' }), { ambiente: ambiente() }); } catch (e) { sefaz = null; CRM.falhou(e); }
      testando = ''; CRM.render();
    },
    'nf-aprender-st': async () => {
      testando = 'Lendo as notas do FKN e as de compra com ICMS-ST (pode levar um minuto)…'; CRM.render();
      try {
        // primeiro o FKN; depois as notas de compra, que valem mais (passam por cima no mesmo produto e unidade)
        const r = await chama({ acao: 'aprender_st' });
        const c = CRM.fiscalSt ? await CRM.fiscalSt.aprenderDasCompras() : null;
        stUltimo = 'Última leitura: ' + r.produtos + ' produto(s) pelas notas do FKN' + (c ? '; pelas notas de compra, ' + c.com_st + ' com ICMS-ST, ' +
          c.sem_st + ' comprado(s) sem ST, ' + c.sem_valor + ' com ST sem os valores' + (c.semLigacao ? ' e ' + c.semLigacao + ' item(ns) de compra sem ligação a um produto (ligar em Estoque → Notas de compra)' : '') +
          (c.completados ? ' (' + c.completados + ' item(ns) de compra completados pelo XML guardado)' : '') : '') +
          '. Depois, "Atualizar as propostas" na regra de cada produto.';
        CRM.toast(stUltimo);
      } catch (e) { CRM.falhou(e); }
      testando = ''; CRM.render();
    },
    'nf-do-xml': async () => {
      const notas = (E().D.notas || []).filter(n => n.chave && !n.cancelada && Number(n.serie || 1) !== serie()).sort((a, b) => String(b.emitida_em).localeCompare(String(a.emitida_em)));
      for (const n of notas.slice(0, 5)) {
        let xml = null;
        try { xml = await CRM.store().notaXml(n.chave); } catch (e) { xml = null; }
        const d = xml && M.emitenteDoXml(xml);
        if (d && !d.homologacao) return formEmitente({ emitente: d.emitente, natOp: d.natOp, indFinal: d.indFinal == null ? 1 : d.indFinal, indPres: d.indPres == null ? 9 : d.indPres, _nota: d.numero });
      }
      CRM.toast('Não achei o XML de uma nota recente do FKN guardado no CRM. Preencha à mão em "Editar emitente".', true);
    },
    'nf-emitente': () => formEmitente(),
    'nf-reforma': () => formReforma(),
    'nf-difal': id => formDifal(id || null),
    'nf-producao': async () => {
      const homAut = (nfes || []).filter(n => n.ambiente === 'homologacao' && (n.situacao === 'autorizada' || n.situacao === 'cancelada')).length;
      if (!homAut) { CRM.toast('Antes de passar para produção, emita pelo menos uma nota de teste em homologação e confira a DANFE.', true); return; }
      const t = prompt('PRODUÇÃO: a partir de agora a nota emitida pelo CRM vale de verdade (vai ao contador, entra no estoque e nos títulos).\n\nPara confirmar, escreva PRODUÇÃO:');
      if (!t || R.normaliza(t) !== 'producao') return;
      try { await salvaFiscal({ ambiente: 'producao' }); CRM.toast('Emissão em PRODUÇÃO.'); CRM.render(); } catch (e) { CRM.falhou(e); }
    },
    'nf-homologacao': async () => {
      if (!confirm('Voltar a emitir em homologação (teste, sem valor fiscal)?')) return;
      try { await salvaFiscal({ ambiente: 'homologacao' }); CRM.render(); } catch (e) { CRM.falhou(e); }
    },
    'nf-emitir': id => emitir(id),
    'nf-lote': () => lote(),
    'nf-marcar-todos': () => { (CRM.pedidos.separados ? CRM.pedidos.separados() : []).filter(podeEmitir).forEach(p => marcados.add(p.id)); CRM.render(); },
    'nf-danfe': id => danfe(id),
    'nf-xml': async id => {
      try { const n = nfe(id), xml = await xmlDe(id); CRM.baixar('NFe' + (n ? n.chave : id) + '-procNFe.xml', xml, 'application/xml'); } catch (e) { CRM.falhou(e); }
    },
    'nf-consultar': async id => {
      try {
        const r = await chama({ acao: 'consultar', nfe_id: id }), n = r.nfe || {};
        await recarrega();
        if (CRM.pedidos && CRM.pedidos.recarregar) await CRM.pedidos.recarregar();
        CRM.toast('NF ' + n.numero + ': ' + ((M.SITUACAO[M.situacaoDe(n)] || [n.situacao])[0]) + (n.motivo ? ' (' + (n.cstat || '') + ' — ' + n.motivo + ')' : '') + '.', n.situacao !== 'autorizada');
      } catch (e) { CRM.falhou(e); }
    },
    'nf-cancelar': id => {
      const n = nfe(id); if (!n) return;
      const h = M.horasDesde(n.autorizada_em);
      CRM.abrirForm({ titulo: 'Cancelar a NF ' + n.serie + '-' + n.numero + ' · ' + CRM.nomeEmpresa(n.empresa_id),
        intro: (h != null && h > 24 ? 'ATENÇÃO: a nota foi autorizada há ' + Math.floor(h) + ' horas. Em SP o cancelamento normal é até 24 h; depois disso é extemporâneo (pode ter multa): fale com o contador antes. ' : '') +
          'Cancelar só se a mercadoria NÃO saiu. ' + (n.ambiente === 'producao' ? 'O CRM estorna o estoque, tira os títulos da nota e o pedido volta a "a emitir NF".' : 'Homologação: só o teste.'),
        campos: [{ nome: 'texto', rotulo: 'Justificativa (15 a 255 letras)', tipo: 'textarea', obrigatorio: true, largo: true, dica: 'Ex.: pedido cancelado pelo cliente antes da entrega' }],
        valores: {}, salvarTexto: 'Cancelar a nota',
        aoSalvar: async v => {
          const erro = M.confereTexto(v.texto, 'cancelar'); if (erro) throw new Error(erro);
          const r = await chama({ acao: 'cancelar', nfe_id: id, texto: String(v.texto).trim().replace(/\s+/g, ' ') });
          await recarrega();
          if (CRM.pedidos && CRM.pedidos.recarregar) await CRM.pedidos.recarregar();
          if (!r.ok) throw new Error('a Sefaz não aceitou o cancelamento: ' + ((r.evento && (r.evento.cstat + ' — ' + r.evento.motivo)) || ''));
          CRM.toast('NF ' + n.numero + ' cancelada. Protocolo ' + (r.evento && r.evento.protocolo || '') + '.');
        } });
    },
    'nf-cce': id => {
      const n = nfe(id); if (!n) return;
      const ant = (n.eventos || []).filter(e => e.tipo === 'cce' && e.protocolo);
      CRM.abrirForm({ titulo: 'Carta de correção da NF ' + n.serie + '-' + n.numero,
        intro: 'A carta de correção NÃO pode mudar: valores, impostos, quantidade, preço, o cliente (CNPJ, razão social, endereço que mude o destinatário), a data de emissão ou de saída. ' +
          'Cada carta nova substitui a anterior: escreva TODAS as correções juntas.' + (ant.length ? ' Já há ' + ant.length + ' carta(s); a última dizia: "' + ant[ant.length - 1].texto + '".' : ''),
        campos: [{ nome: 'texto', rotulo: 'Correção (15 a 1000 letras)', tipo: 'textarea', linhas: 5, obrigatorio: true, largo: true }],
        valores: { texto: ant.length ? ant[ant.length - 1].texto : '' }, salvarTexto: 'Enviar a carta de correção',
        aoSalvar: async v => {
          const erro = M.confereTexto(v.texto, 'cce'); if (erro) throw new Error(erro);
          const r = await chama({ acao: 'cce', nfe_id: id, texto: String(v.texto).trim().replace(/\s+/g, ' ') });
          await recarrega();
          if (!r.ok) throw new Error('a Sefaz não aceitou a carta: ' + ((r.evento && (r.evento.cstat + ' — ' + r.evento.motivo)) || ''));
          CRM.toast('Carta de correção registrada. Protocolo ' + (r.evento && r.evento.protocolo || '') + '.');
        } });
    },
    'nf-inutilizar': () => CRM.abrirForm({ titulo: 'Inutilizar números de NF-e',
      intro: 'Ambiente atual: ' + (ambiente() === 'producao' ? 'PRODUÇÃO' : 'homologação') + '. Só números que não foram usados (nota autorizada se cancela, não se inutiliza). Não dá para desfazer.',
      campos: [{ nome: 'serie', rotulo: 'Série', tipo: 'numero', passo: '1', obrigatorio: true }, { nome: 'de', rotulo: 'Do número', tipo: 'numero', passo: '1', min: 1, obrigatorio: true },
        { nome: 'ate', rotulo: 'Até o número', tipo: 'numero', passo: '1', min: 1, obrigatorio: true }, { nome: 'texto', rotulo: 'Justificativa (15 a 255 letras)', tipo: 'textarea', obrigatorio: true, largo: true, dica: 'Ex.: número pulado por falha no envio, sem nota emitida' }],
      valores: { serie: serie() }, salvarTexto: 'Inutilizar',
      aoSalvar: async v => {
        const erro = M.confereTexto(v.texto, 'inutilizar'); if (erro) throw new Error(erro);
        if (!(v.ate >= v.de)) throw new Error('o "até" precisa ser maior ou igual ao "do"');
        const usados = (nfes || []).filter(n => n.ambiente === ambiente() && n.serie === v.serie && n.numero >= v.de && n.numero <= v.ate && !n.inutilizada_em && ['autorizada', 'cancelada', 'denegada', 'pendente'].indexOf(n.situacao) !== -1);
        if (usados.length) throw new Error('a faixa tem nota usada: ' + usados.map(n => 'NF ' + n.numero + ' (' + n.situacao + ')').join(', '));
        if (!confirm('Inutilizar a série ' + v.serie + ', do número ' + v.de + ' ao ' + v.ate + '? Não dá para desfazer.')) return false;
        const r = await chama({ acao: 'inutilizar', serie: v.serie, de: v.de, ate: v.ate, texto: String(v.texto).trim().replace(/\s+/g, ' ') });
        await recarrega();
        if (!r.ok) throw new Error('a Sefaz recusou: ' + r.cStat + ' — ' + r.motivo);
        CRM.toast('Números inutilizados (' + r.cStat + ').');
      } }),
    'nf-fechamento': async () => {
      try {
        const [l, ins] = await Promise.all([CRM.store().nfesDoMes(f.mes), CRM.store().nfeInutilizacoes()]);
        const r = M.fechamento(l, ins, f.mes);
        if (!r.notas && !r.inutilizadas) { CRM.toast('Nenhuma nota de produção emitida pelo CRM em ' + f.mes.split('-').reverse().join('/') + '.', true); return; }
        CRM.baixar('xml-saida-crm-' + f.mes + '.zip', new Blob([M.zip(r.arquivos)], { type: 'application/zip' }));
        CRM.toast(r.notas + ' nota(s) (' + r.autorizadas + ' autorizadas, ' + moeda(r.valor) + '; ' + r.canceladas + ' canceladas), ' + r.inutilizadas + ' inutilização(ões). Mande o ZIP ao contador.');
      } catch (e) { CRM.falhou(e); }
    }
  });

  CRM.nfe = { tela, secaoFiscal, doPedido, podeEmitir, emitir, outraDoPedido, carrega: recarrega, marcado: id => marcados.has(id),
    depois(c) {
      const m = c.querySelector('[data-nf-mes]'); if (m) m.addEventListener('change', () => { f.mes = m.value; });
      c.querySelectorAll('[data-nf-marca]').forEach(el => el.addEventListener('change', () => { if (el.checked) marcados.add(el.dataset.nfMarca); else marcados.delete(el.dataset.nfMarca); CRM.render(); }));
      const ib = c.querySelector('[data-nf-ibpt]'); if (ib) ib.addEventListener('change', () => { if (ib.files[0]) carregaIbpt(ib.files[0]); });
      const iba = c.querySelector('[data-nf-ibpt-api]'); if (iba) iba.addEventListener('click', () => ibptPelaApi(iba));
    } };
})(typeof window !== 'undefined' ? window : globalThis);
