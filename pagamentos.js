/* CRM Sistemi Dalessi — pagamento de contas pelo BB (04/11/2026): a leitura do código do boleto ou da guia que se cola na
   conta a pagar. Aceita a linha digitável (47 dígitos do boleto, 48 da guia/conta de consumo) ou o código de barras (44) e
   devolve o código de barras de 44 dígitos, que é o que a API do banco aceita, conferindo os dígitos verificadores.
   Testes: testes/pagar-bb.test.js. */
(function (raiz) {
  'use strict';
  const dig = v => String(v == null ? '' : v).replace(/\D/g, '');
  function mod10(s) {
    let soma = 0, peso = 2;
    for (let i = s.length - 1; i >= 0; i--) { let p = Number(s[i]) * peso; if (p > 9) p = Math.floor(p / 10) + (p % 10); soma += p; peso = peso === 2 ? 1 : 2; }
    return (10 - (soma % 10)) % 10;
  }
  function mod11Boleto(s) {
    let soma = 0, peso = 2;
    for (let i = s.length - 1; i >= 0; i--) { soma += Number(s[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const dv = 11 - (soma % 11);
    return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
  }
  function mod11Guia(s) {
    let soma = 0, peso = 2;
    for (let i = s.length - 1; i >= 0; i--) { soma += Number(s[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const r = soma % 11;
    return r === 0 || r === 1 ? 0 : r === 10 ? 1 : 11 - r;
  }
  // guia: o 3º dígito diz o cálculo (6 e 7 módulo 10; 8 e 9 módulo 11)
  const dvGuia = (s, ref) => (ref === '6' || ref === '7' ? mod10(s) : mod11Guia(s));
  function valorDoCodigo(c) {
    if (c.length !== 44) return 0;
    if (c[0] === '8') return c[2] === '6' || c[2] === '8' ? Number(c.slice(4, 15)) / 100 : 0;
    return Number(c.slice(9, 19)) / 100;
  }
  function confereCodigo(c) {
    if (c[0] === '8') {
      if (!'6789'.includes(c[2])) return 'o 3º dígito da guia não é válido';
      if (dvGuia(c.slice(0, 3) + c.slice(4), c[2]) !== Number(c[3])) return 'o dígito verificador da guia não confere';
      return null;
    }
    if (mod11Boleto(c.slice(0, 4) + c.slice(5)) !== Number(c[4])) return 'o dígito verificador do boleto não confere';
    return null;
  }
  // texto colado → { ok, tipo: 'boleto'|'guia', codigo (44), valor, erro }
  function codigoDeLinha(texto) {
    const d = dig(texto);
    let c = null;
    if (d.length === 44) c = d;
    else if (d.length === 47) {
      const campos = [[d.slice(0, 9), d[9]], [d.slice(10, 20), d[20]], [d.slice(21, 31), d[31]]];
      const ruim = campos.findIndex(([s, dv]) => mod10(s) !== Number(dv));
      if (ruim >= 0) return { ok: false, erro: 'a linha digitável tem um número errado no ' + (ruim + 1) + 'º campo' };
      c = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
    } else if (d.length === 48 && d[0] === '8') {
      const blocos = [0, 1, 2, 3].map(i => d.slice(i * 12, i * 12 + 12));
      const ruim = blocos.findIndex(b => dvGuia(b.slice(0, 11), d[2]) !== Number(b[11]));
      if (ruim >= 0) return { ok: false, erro: 'a linha da guia tem um número errado no ' + (ruim + 1) + 'º bloco' };
      c = blocos.map(b => b.slice(0, 11)).join('');
    } else return { ok: false, erro: d.length ? 'o código tem ' + d.length + ' números (boleto: 47 ou 44; conta de consumo/guia: 48 ou 44)' : 'cole o código do boleto' };
    const e = confereCodigo(c);
    if (e) return { ok: false, erro: e };
    return { ok: true, tipo: c[0] === '8' ? 'guia' : 'boleto', codigo: c, valor: valorDoCodigo(c) };
  }
  const api = { codigoDeLinha, valorDoCodigo, mod10, mod11Boleto, mod11Guia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  raiz.CRMPagamentos = api;
})(typeof window !== 'undefined' ? window : globalThis);
