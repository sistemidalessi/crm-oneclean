/* CRM Sistemi Dalessi — leitor mínimo de .xlsx, sem biblioteca externa.
   Um .xlsx é um ZIP com XML dentro. Lê o diretório central do ZIP, descompacta
   com o DecompressionStream nativo do navegador ('deflate-raw') e interpreta
   sharedStrings + a primeira planilha com DOMParser. Datas vêm como número de
   série do Excel (o importador converte). Só leitura, só valores. */
(function () {
  'use strict';

  async function inflar(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function lerZip(buf) {
    const b = new Uint8Array(buf);
    const dv = new DataView(buf);
    let fim = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
    }
    if (fim < 0) throw new Error('arquivo não é um .xlsx válido');
    const total = dv.getUint16(fim + 10, true);
    let p = dv.getUint32(fim + 16, true);
    const arquivos = {};
    const dec = new TextDecoder();
    for (let n = 0; n < total; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP corrompido');
      const metodo = dv.getUint16(p + 10, true);
      const tam = dv.getUint32(p + 20, true);
      const lnome = dv.getUint16(p + 28, true), lextra = dv.getUint16(p + 30, true), lcom = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const nome = dec.decode(b.subarray(p + 46, p + 46 + lnome));
      arquivos[nome] = { metodo, tam, local };
      p += 46 + lnome + lextra + lcom;
    }
    return {
      nomes: Object.keys(arquivos),
      async texto(nome) {
        const a = arquivos[nome];
        if (!a) return null;
        const ini = a.local + 30 + dv.getUint16(a.local + 26, true) + dv.getUint16(a.local + 28, true);
        const dados = b.subarray(ini, ini + a.tam);
        const bytes = a.metodo === 0 ? dados : await inflar(dados);
        return dec.decode(bytes);
      }
    };
  }

  const xml = t => new DOMParser().parseFromString(t, 'application/xml');
  const porTag = (el, tag) => Array.from(el.getElementsByTagNameNS('*', tag));

  function colunaIndice(ref) {
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  }

  // Devolve { abas: [nomes], linhas: [[...]] } da aba pedida (padrão: a primeira).
  async function lerXlsx(arquivo, qualAba) {
    const zip = await lerZip(await arquivo.arrayBuffer());
    const wb = xml(await zip.texto('xl/workbook.xml'));
    const abas = porTag(wb, 'sheet').map(s => ({ nome: s.getAttribute('name'), rid: s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id') }));
    const rels = xml(await zip.texto('xl/_rels/workbook.xml.rels'));
    const alvo = {};
    porTag(rels, 'Relationship').forEach(r => { alvo[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const aba = abas[qualAba || 0] || abas[0];
    let caminho = alvo[aba.rid] || 'worksheets/sheet1.xml';
    caminho = caminho.replace(/^\/?xl\//, '').replace(/^\//, '');
    const compartilhadas = [];
    const ss = await zip.texto('xl/sharedStrings.xml');
    if (ss) porTag(xml(ss), 'si').forEach(si => compartilhadas.push(porTag(si, 't').map(t => t.textContent).join('')));
    const planilha = xml(await zip.texto('xl/' + caminho));
    const linhas = [];
    porTag(planilha, 'row').forEach(row => {
      const linha = [];
      porTag(row, 'c').forEach(c => {
        const i = colunaIndice(c.getAttribute('r'));
        const t = c.getAttribute('t');
        const v = porTag(c, 'v')[0];
        let val = '';
        if (t === 's') val = v ? compartilhadas[+v.textContent] || '' : '';
        else if (t === 'inlineStr') val = porTag(c, 't').map(x => x.textContent).join('');
        else if (t === 'b') val = v && v.textContent === '1' ? 'sim' : 'não';
        else if (v) { const n = Number(v.textContent); val = t === 'str' || t === 'e' || !isFinite(n) ? v.textContent : n; }
        linha[i >= 0 ? i : linha.length] = val;
      });
      for (let i = 0; i < linha.length; i++) if (linha[i] === undefined) linha[i] = '';
      if (linha.some(x => x !== '' && x != null)) linhas.push(linha);
    });
    return { abas: abas.map(a => a.nome), linhas };
  }

  window.CRMXlsx = { lerXlsx };
})();
