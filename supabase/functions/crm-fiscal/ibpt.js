// Tabela do IBPT (tributos aproximados na nota, Lei 12.741/2012) pela API "De Olho no Imposto": partes puras, sem Deno.
// A função (index.ts) chama a API por NCM e grava em crm_ibpt; os testes do Node (testes/ibpt.test.js) importam daqui.
// O token sai do cadastro gratuito da empresa no site do IBPT e fica só nos Secrets do Supabase (IBPT_TOKEN).

export const IBPT_API = 'https://apidoni.ibpt.org.br/api/v1/produtos';

// Endereço da consulta de um NCM (ex 0 = sem exceção da TIPI). A API pede todos os parâmetros, mesmo vazios.
export function ibptUrl(token, cnpj, ncm, uf) {
  const q = new URLSearchParams({ token: String(token || ''), cnpj: String(cnpj || '').replace(/\D/g, ''), codigo: String(ncm || '').replace(/\D/g, ''),
    uf: String(uf || 'SP').toUpperCase(), ex: '0', codigoInterno: '', descricao: '', unidadeMedida: 'UN', valor: '0', gtin: 'SEM GTIN' });
  return IBPT_API + '?' + q.toString();
}

// "31/12/2026" ou "2026-12-31T00:00:00" → "2026-12-31"
const data = v => {
  const s = String(v || '').trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s); if (m) return m[3] + '-' + m[2] + '-' + m[1];
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
};
const num = v => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? Math.round(n * 100) / 100 : null; };

// Resposta da API → linha de crm_ibpt (as chaves vêm com maiúscula: Nacional, Estadual…; aceita minúsculas também).
// Sem as alíquotas ou sem a vigência → null (não grava resposta pela metade).
export function ibptLinha(ncm, j) {
  if (!j || typeof j !== 'object') return null;
  const g = k => { const c = Object.keys(j).find(x => x.toLowerCase() === k.toLowerCase()); return c ? j[c] : undefined; };
  const nac = num(g('Nacional')), est = num(g('Estadual')), ini = data(g('VigenciaInicio')), fim = data(g('VigenciaFim'));
  if (nac == null || est == null || !fim) return null;
  return { codigo: String(ncm).replace(/\D/g, ''), ex: '', descricao: String(g('Descricao') || '').slice(0, 300) || null,
    nac_fed: nac, imp_fed: num(g('Importado')), estadual: est, municipal: num(g('Municipal')) ?? 0,
    vig_ini: ini, vig_fim: fim, chave: g('Chave') ? String(g('Chave')) : null, versao: g('Versao') ? String(g('Versao')) : null,
    fonte: g('Fonte') ? String(g('Fonte')) : 'IBPT', carregado_em: new Date().toISOString() };
}

// Precisa atualizar? Sem linha para algum NCM em uso, ou vigência acabando (até `dias` dias).
export function ibptPrecisa(ncms, linhas, hoje, dias) {
  const por = new Map((linhas || []).map(l => [String(l.codigo), l]));
  const lim = new Date(String(hoje).slice(0, 10) + 'T12:00:00Z'); lim.setUTCDate(lim.getUTCDate() + (dias == null ? 7 : dias));
  const ate = lim.toISOString().slice(0, 10);
  return (ncms || []).filter(n => { const l = por.get(String(n)); return !l || !l.vig_fim || String(l.vig_fim).slice(0, 10) < ate; });
}
