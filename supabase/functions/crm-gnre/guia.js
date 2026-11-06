// GNRE do DIFAL (06/11/2026): partes puras do robô (sem Deno), que a Edge Function crm-gnre importa e os testes do Node
// (testes/gnre.test.js) também. Da NF-e autorizada sai a guia no formato que o servico-fiscal/gnre.js monta em XML.
// Regras por UF: o que cada UF exige vem do GnreConfigUF do Portal GNRE (conferido nas bibliotecas sped-gnre, gnre-automacao
// e Unimake). Hoje só o RS tem venda a consumidor com DIFAL (4 notas em 2026). Outra UF só sai depois de conferida
// (crm_config.dados.gnre.uf.<UF>), para não mandar guia errada — vira "erro" com o aviso, e o fiscal dos agentes avisa.

// RS: receita 100102 (ICMS DIFAL consumidor final não contribuinte, EC 87/2015), documento de origem 22 (chave da NF-e),
// campo extra 74 (chave da NF-e), sem período de referência. O FCP do RS (AMPARA: 2% na perfumaria/aromatizante, NCM 3303–3307)
// sai numa GUIA PRÓPRIA, receita 100129, com o mesmo campo extra 74 (gnre-automacao uf_additional_fields.json; sped-gnre).
// fcp: 'separada' = uma guia a mais, receita_fcp; 'junto' = o FCP no mesmo item (valores tipo 12/22), se a UF pedir assim.
export const REGRAS_UF = {
  RS: { receita: '100102', receita_fcp: '100129', doc_tipo: '22', campo_extra: '74', referencia: false, fcp: 'separada' }
};

const dig = v => String(v == null ? '' : v).replace(/\D/g, '');
const r2 = v => Math.round(Number(v || 0) * 100) / 100;

// nfe: { id, ambiente, serie, numero, chave, totais: { vICMSUFDest, vFCPUFDest }, nota: { dest: { doc, nome, endereco: { uf, cMun } } } }
// cfg: { gnre: { ambiente?, uf?: { RS: {...} } }, fiscal: { emitente } }.
// Devolve { uf, ambiente, emitente, guias: [{ receita, valor, guia }] } (uma por receita) ou { uf, erro }.
export function montaGuias(nfe, cfg, hoje) {
  const t = (nfe && nfe.totais) || {}, dest = ((nfe && nfe.nota) || {}).dest || {}, end = dest.endereco || {};
  const uf = String(end.uf || '').toUpperCase(), difal = r2(t.vICMSUFDest), fcp = r2(t.vFCPUFDest);
  const ambiente = nfe && nfe.ambiente === 'producao' ? ((cfg.gnre || {}).ambiente === 'homologacao' ? 'homologacao' : 'producao') : 'homologacao';
  const base = { uf, ambiente, valor: r2(difal + fcp) };
  const erro = m => Object.assign(base, { erro: m });
  if (!/^[A-Z]{2}$/.test(uf) || uf === 'SP') return erro('a nota não é para outra UF (destinatário em ' + (uf || '?') + '): não há GNRE de DIFAL');
  if (!(difal + fcp > 0)) return erro('a nota não tem DIFAL (vICMSUFDest zero)');
  if (dig(nfe.chave).length !== 44) return erro('a nota não tem a chave de acesso');
  const regra = Object.assign({}, REGRAS_UF[uf] || {}, ((cfg.gnre || {}).uf || {})[uf] || {});
  if (!regra.receita) return erro('a GNRE para ' + uf + ' ainda não foi conferida (receita, documento de origem e campos extras da UF): me chamar para rodar a consulta da UF no Portal GNRE');
  const separada = fcp > 0 && regra.fcp === 'separada' && regra.receita_fcp, junto = fcp > 0 && regra.fcp === 'junto';
  if (fcp > 0 && !separada && !junto) return erro('a nota tem FCP para ' + uf + ' (R$ ' + fcp.toFixed(2) + ') e a regra do FCP dessa UF ainda não foi conferida: me chamar');
  const e = (cfg.fiscal || {}).emitente || {};
  if (dig(e.cnpj).length !== 14) return erro('falta o CNPJ do emitente (Fiscal → Emissão)');
  const doc = dig(dest.doc);
  const [ano, mes] = String(hoje).split('-');
  const umaGuia = (receita, valor, valorFcp) => ({ uf, receita, docTipo: regra.doc_tipo || '22', chave: dig(nfe.chave), valor, valorFcp, fcpJunto: valorFcp > 0,
    vencimento: hoje, pagamento: hoje, referencia: regra.referencia ? { mes: Number(mes), ano: Number(ano) } : null,
    destinatario: { cpf: doc.length === 11 ? doc : null, cnpj: doc.length === 14 ? doc : null, nome: dest.nome, cMun: end.cMun },
    camposExtras: regra.campo_extra ? [{ codigo: regra.campo_extra, valor: dig(nfe.chave) }] : [],
    identificador: String(nfe.numero || '').replace(/\D/g, '').slice(-10) || null });
  const guias = [];
  if (difal > 0 || junto) guias.push({ receita: regra.receita, valor: r2(difal + (junto ? fcp : 0)), guia: umaGuia(regra.receita, difal, junto ? fcp : 0) });
  if (separada) guias.push({ receita: regra.receita_fcp, valor: fcp, guia: umaGuia(regra.receita_fcp, fcp, 0) });
  return Object.assign(base, { emitente: { cnpj: dig(e.cnpj), razao: e.razao, endereco: Object.assign({}, e.endereco || {}) }, guias });
}

// o resultado do lote (servico-fiscal/gnre.js leResultado) → { situacao: enviada | gerada | rejeitada | erro, motivo, guia }
//   400/401 em processamento; 402 processado; 403 processado com pendência; 404 erro no processamento.
//   por guia: 0 ok; 1 invalidada pelo portal; 2 invalidada pela UF; 3 erro de comunicação com a UF (tenta de novo).
export function situacaoDoResultado(r) {
  const cod = Number(r && r.codigo);
  if (cod === 400 || cod === 401) return { situacao: 'enviada' };
  const g = ((r && r.guias) || [])[0];
  const motivos = g && g.motivos && g.motivos.length ? g.motivos.map(m => m.codigo + ' ' + m.descricao + (m.campo ? ' (' + m.campo + ')' : '')).join('; ') : '';
  if ((cod === 402 || cod === 403) && g) {
    if (g.situacao === '0' && g.codigoBarras && g.codigoBarras.length === 44) return { situacao: 'gerada', guia: g };
    if (g.situacao === '1' || g.situacao === '2') return { situacao: 'rejeitada', motivo: (g.situacao === '1' ? 'Portal GNRE' : 'a UF') + ' recusou a guia: ' + (motivos || r.descricao || 'sem motivo') };
    return { situacao: 'erro', motivo: 'o portal não falou com a UF (' + (motivos || r.descricao || 'erro de comunicação') + '): tento de novo' };
  }
  return { situacao: 'erro', motivo: 'resultado do lote ' + (cod || '?') + ': ' + (r && r.descricao || 'sem descrição') + (motivos ? ' — ' + motivos : '') };
}

const br = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');
// a observação da conta do Caixa com a linha digitável (troca a de uma geração anterior)
export function textoObs(obs, g) {
  const limpo = String(obs || '').split('\n').filter(l => !/^GNRE gerada pelo robô/.test(l)).join('\n').trim();
  const linha = 'GNRE gerada pelo robô: linha digitável ' + g.linhaDigitavel + (g.numeroControle ? ' · nº de controle ' + g.numeroControle : '') +
    (g.dataLimite ? ' · pagar até ' + br(g.dataLimite) : '') + '. A guia (PDF) está no 📎; pagar antes de a mercadoria sair.';
  return (limpo ? limpo + '\n' : '') + linha;
}
