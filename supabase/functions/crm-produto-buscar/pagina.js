// Partes puras da busca de foto e ficha técnica (crm-produto-buscar): ler a página do produto (foto e PDFs),
// medir a imagem, conferir o endereço e ler a resposta da IA. JavaScript puro, sem Deno: a função importa e os
// testes do Node (testes/produto-fotos.test.js) também.

// IP que o servidor não pode baixar (rede interna, reservado, documentação, multicast). Vale para o IP escrito no
// endereço e para os IPs que o nome resolve (a função confere o DNS antes de baixar). Inválido também conta como privado.
export function ipPrivado(ip) {
  const s = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(s)) {
    const p = s.split('.').map(Number);
    if (p.length !== 4 || p.some(n => !(Number.isInteger(n) && n >= 0 && n <= 255))) return true;
    const [a, b, c] = p;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  if (s.indexOf(':') === -1) return true;
  const v4 = /^(?:0*:)*(?:::)?(?:ffff:|64:ff9b::)?(\d+\.\d+\.\d+\.\d+)$/.exec(s) || /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) return ipPrivado(v4[1]);
  if (s === '::' || s === '::1' || /^0*(:0*)*:0*1?$/.test(s)) return true;
  const g = parseInt(s.split(':')[0] || '0', 16);
  return isNaN(g) || (g & 0xfe00) === 0xfc00 || (g & 0xffc0) === 0xfe80 || (g & 0xff00) === 0xff00 || s.startsWith('2001:db8:') || g === 0;
}

// Endereço que o servidor pode baixar: http(s), sem usuário/senha, sem IP de rede interna e sem nome local.
export function urlSegura(u, base) {
  let x;
  try { x = new URL(String(u || '').trim(), base || undefined); } catch (e) { return null; }
  if (x.protocol !== 'https:' && x.protocol !== 'http:') return null;
  if (x.username || x.password) return null;
  const h = x.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || /\.(local|internal|lan|home|localdomain)$/.test(h) || !/\./.test(h)) return null;
  if (/^[\d.]+$/.test(h) && ipPrivado(h)) return null;
  if (h.indexOf(':') !== -1) return null; // IPv6 literal: não precisa para site de fabricante
  if (x.port && x.port !== '80' && x.port !== '443') return null;
  x.hash = '';
  return x.toString();
}

const ent = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x2F;/gi, '/').trim();
const attr = (tag, nome) => { const m = new RegExp('\\s' + nome + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag); return m ? ent(m[2] ?? m[3] ?? m[4]) : ''; };

// Imagens do produto que a página anuncia: og:image, twitter:image, image_src, o JSON-LD do produto e a foto principal
// das lojas mais comuns (WooCommerce, VTEX, Magento). Na ordem de confiança, sem repetir, até `limite`.
export function imagensDaPagina(html, base, limite) {
  const h = String(html || ''), out = [], viu = new Set();
  const poe = u => { const s = urlSegura(u, base); if (s && !viu.has(s) && !/\.(svg|gif|ico)(\?|$)/i.test(s) && !/logo|sprite|icon|placeholder|banner/i.test(s)) { viu.add(s); out.push(s); } };
  const metas = h.match(/<meta\b[^>]*>/gi) || [];
  ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'].forEach(p => metas.forEach(m => {
    if ((attr(m, 'property') || attr(m, 'name')).toLowerCase() === p) poe(attr(m, 'content'));
  }));
  (h.match(/<link\b[^>]*>/gi) || []).forEach(l => { if (attr(l, 'rel').toLowerCase() === 'image_src') poe(attr(l, 'href')); });
  const blocos = h.match(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const daLd = v => { if (!v) return; if (typeof v === 'string') return poe(v); if (Array.isArray(v)) return v.forEach(daLd); if (typeof v === 'object') daLd(v.url || v.contentUrl); };
  const anda = o => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(anda);
    const t = [].concat(o['@type'] || []).join(' ');
    if (/Product/i.test(t)) daLd(o.image);
    if (o['@graph']) anda(o['@graph']);
  };
  blocos.forEach(b => { try { anda(JSON.parse(b.replace(/^<script[^>]*>|<\/script>$/gi, ''))); } catch (e) { /* JSON-LD quebrado: ignora */ } });
  (h.match(/<img\b[^>]*>/gi) || []).forEach(t => {
    if (/wp-post-image|product-image|produto-imagem|zoom|gallery__image|main-image/i.test(attr(t, 'class') + ' ' + attr(t, 'id')) || attr(t, 'data-large_image') || attr(t, 'data-zoom-image'))
      poe(attr(t, 'data-large_image') || attr(t, 'data-zoom-image') || attr(t, 'data-src') || attr(t, 'src'));
  });
  return out.slice(0, limite || 6);
}

// PDFs ligados na página: ficha técnica e FISPQ (FDS), pelo texto do link ou pelo nome do arquivo.
export function tipoDoPdf(texto) {
  const t = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/fispq|\bfds\b|msds|\bsds\b|seguranca/.test(t)) return 'fispq';
  if (/ficha|tecnic|boletim|data ?sheet|especifica|catalogo/.test(t)) return 'ficha';
  return null;
}
export function pdfsDaPagina(html, base) {
  const out = [], viu = new Set(), re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const href = attr('<a ' + m[1] + '>', 'href');
    if (!/\.pdf(\?|#|$)/i.test(href)) continue;
    const u = urlSegura(href, base);
    if (!u || viu.has(u)) continue;
    viu.add(u);
    const texto = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ url: u, texto: texto.slice(0, 120), tipo: tipoDoPdf(texto + ' ' + decodeURIComponent(u.split('/').pop() || '')) });
  }
  return out;
}

// Tipo e tamanho da imagem pelos bytes (sem biblioteca): JPEG, PNG e WebP. → { tipo, ext, largura, altura } ou null.
export function medeImagem(b) {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b || []);
  const be16 = i => (u[i] << 8) | u[i + 1], le16 = i => u[i] | (u[i + 1] << 8), be32 = i => ((u[i] << 24) >>> 0) + (u[i + 1] << 16) + (u[i + 2] << 8) + u[i + 3];
  if (u.length > 24 && u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return { tipo: 'image/png', ext: 'png', largura: be32(16), altura: be32(20) };
  if (u.length > 4 && u[0] === 0xff && u[1] === 0xd8) {
    let i = 2;
    while (i + 9 < u.length) {
      if (u[i] !== 0xff) { i++; continue; }
      const mk = u[i + 1];
      if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { tipo: 'image/jpeg', ext: 'jpg', largura: be16(i + 7), altura: be16(i + 5) };
      i += 2 + be16(i + 2);
    }
    return { tipo: 'image/jpeg', ext: 'jpg', largura: 0, altura: 0 };
  }
  if (u.length > 30 && String.fromCharCode(u[0], u[1], u[2], u[3]) === 'RIFF' && String.fromCharCode(u[8], u[9], u[10], u[11]) === 'WEBP') {
    const f = String.fromCharCode(u[12], u[13], u[14], u[15]);
    if (f === 'VP8 ') return { tipo: 'image/webp', ext: 'webp', largura: le16(26) & 0x3fff, altura: le16(28) & 0x3fff };
    if (f === 'VP8L') { const v = u[21] | (u[22] << 8) | (u[23] << 16) | (u[24] << 24); return { tipo: 'image/webp', ext: 'webp', largura: (v & 0x3fff) + 1, altura: ((v >> 14) & 0x3fff) + 1 }; }
    if (f === 'VP8X') return { tipo: 'image/webp', ext: 'webp', largura: 1 + (u[24] | (u[25] << 8) | (u[26] << 16)), altura: 1 + (u[27] | (u[28] << 8) | (u[29] << 16)) };
    return { tipo: 'image/webp', ext: 'webp', largura: 0, altura: 0 };
  }
  return null;
}
export const ehPdf = b => { const u = b instanceof Uint8Array ? b : new Uint8Array(b || []); return u.length > 4 && u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46; };

// A resposta final da IA: o último objeto JSON do texto (com ou sem ```json). → objeto ou null.
export function jsonDaResposta(texto) {
  const t = String(texto || '');
  const bloco = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  const tenta = s => { try { const o = JSON.parse(s); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (e) { return null; } };
  if (bloco) { const o = tenta(bloco[1].trim()); if (o) return o; }
  const ini = t.indexOf('{'), fim = t.lastIndexOf('}');
  return ini !== -1 && fim > ini ? tenta(t.slice(ini, fim + 1)) : null;
}

// O que a IA disse sobre o produto, limpo e com limite de tamanho (vai para a tela do comprador e, aprovado, à equipe).
const txt = (v, n) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
export function limpaInfo(o) {
  o = o || {};
  const specs = (Array.isArray(o.especificacoes) ? o.especificacoes : []).map(e => ({ nome: txt(e && e.nome, 60), valor: txt(e && e.valor, 300) }))
    .filter(e => e.nome && e.valor).slice(0, 30);
  const paginas = (Array.isArray(o.paginas) ? o.paginas : []).map(p => ({
    url: urlSegura(p && p.url), site: txt(p && p.site, 80), tipo: ['fabricante', 'fornecedor', 'loja'].indexOf(p && p.tipo) !== -1 ? p.tipo : 'loja',
    ean_bate: p && p.ean_bate === true, mesmo: ['sim', 'provavel', 'parecido'].indexOf(p && p.mesmo_produto) !== -1 ? p.mesmo_produto : 'provavel',
    imagem: urlSegura(p && p.imagem, p && p.url)
  })).filter(p => p.url).slice(0, 6);
  return {
    achou: o.achou !== false, produto: txt(o.produto, 160), marca: txt(o.marca, 60), fabricante: txt(o.fabricante, 120), descricao: txt(o.descricao, 700),
    especificacoes: specs, paginas, ficha: urlSegura(o.ficha_tecnica), fispq: urlSegura(o.fispq), fonte: urlSegura(o.fonte), obs: txt(o.observacao, 400)
  };
}

// Ordem das fotos para o comprador: fabricante e código de barras batendo primeiro, depois a maior.
const PESO_TIPO = { fabricante: 0, fornecedor: 1, loja: 2 }, PESO_MESMO = { sim: 0, provavel: 1, parecido: 2 };
export function ordenaCandidatos(l) {
  return (l || []).slice().sort((a, b) => (b.ean_bate ? 1 : 0) - (a.ean_bate ? 1 : 0) || (PESO_MESMO[a.mesmo] ?? 1) - (PESO_MESMO[b.mesmo] ?? 1) ||
    (PESO_TIPO[a.tipo] ?? 2) - (PESO_TIPO[b.tipo] ?? 2) || Math.min(b.largura || 0, b.altura || 0) - Math.min(a.largura || 0, a.altura || 0));
}
