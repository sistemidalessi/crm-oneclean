/* CRM Sistemi Dalessi — fotos dos produtos (aparecem na proposta / orçamento).
   A foto é reduzida no navegador (até 600 px, JPEG) e vai para o Storage do Supabase, bucket
   público "crm-fotos" (só gestor/admin envia; ver schema.sql), em produtos/<código>.jpg; o endereço
   fica em crm_produtos.foto. No modo local fica a própria imagem (data: URL) no produto.
   Várias de uma vez: o nome do arquivo é o código do FKN ("010049.jpg", "010049 - detergente.png").
   Parte pura (CRMFotos.codigoDoArquivo) testada em testes/fotos.test.js. */
(function (raiz) {
  'use strict';
  // Código do produto no nome do arquivo: o primeiro número com 4 dígitos ou mais
  // ("010049.0.jpg" → "010049"; "Cod 370102 saco.png" → "370102"). Sem número: null.
  function codigoDoArquivo(nome) {
    const base = String(nome || '').replace(/\.[a-z0-9]{2,4}$/i, '');
    const m = /(\d{4,})(?:\.0+)?(?!\d)/.exec(base);
    return m ? m[1] : null;
  }
  const mesmoCodigo = (a, b) => a != null && b != null && String(a).replace(/\.0+$/, '').trim() === String(b).replace(/\.0+$/, '').trim();

  const F = { codigoDoArquivo, mesmoCodigo };
  raiz.CRMFotos = F;
  if (typeof module !== 'undefined') module.exports = F;

  // ------------------------------------------------------------ tela
  const CRM = raiz.CRM;
  if (!CRM || !CRM.acoes) return;
  const E = () => CRM.estado;
  const LADO = 600;

  // Reduz para no máximo 600 px no lado maior, fundo branco (PNG transparente não fica preto).
  async function reduz(arquivo) {
    if (!/^image\//.test(arquivo.type)) throw new Error('"' + arquivo.name + '" não é imagem (use JPG, PNG ou WEBP)');
    const url = URL.createObjectURL(arquivo);
    try {
      const img = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error('não consegui abrir "' + arquivo.name + '"')); i.src = url; });
      const k = Math.min(1, LADO / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
    } finally { URL.revokeObjectURL(url); }
  }
  const paraDataURL = blob => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
  const nomeArquivo = p => 'produtos/' + String(p.codigo || p.id).replace(/[^\w.-]/g, '_') + '.jpg';

  async function enviar(p, arquivo) {
    const blob = await reduz(arquivo);
    let foto;
    if (CRM.store().modo === 'supabase') {
      const sb = CRM.sb(), caminho = nomeArquivo(p);
      const r = await sb.storage.from('crm-fotos').upload(caminho, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
      if (r.error) throw new Error(r.error.message);
      foto = sb.storage.from('crm-fotos').getPublicUrl(caminho).data.publicUrl + '?v=' + Date.now();
    } else foto = await paraDataURL(blob);
    return CRM.atualizar('produtos', p.id, { foto });
  }
  async function tirar(p) {
    if (CRM.store().modo === 'supabase') await CRM.sb().storage.from('crm-fotos').remove([nomeArquivo(p)]);
    return CRM.atualizar('produtos', p.id, { foto: null });
  }

  function escolhe(multiplo, aoEscolher) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp'; inp.multiple = !!multiplo;
    inp.addEventListener('change', () => { const l = [...inp.files]; if (l.length) aoEscolher(l).catch(CRM.falhou); });
    inp.click();
  }

  // Produto do catálogo pelo código; sem cadastro, o gestor pode criar a partir da listagem do FKN
  // (crm_estoque), que só o admin/comprador lê — para os outros fica na lista "sem produto".
  async function produtosDosCodigos(codigos) {
    const prods = E().D.produtos;
    const achou = new Map(), faltam = [];
    codigos.forEach(c => { const p = prods.find(x => mesmoCodigo(x.codigo, c)); if (p) achou.set(c, p); else faltam.push(c); });
    if (faltam.length && CRM.store().modo === 'supabase') {
      const r = await CRM.sb().from('crm_estoque').select('codigo, descricao, unidade, preco_venda').in('codigo', faltam);
      for (const x of (r.data || [])) {
        if (achou.has(x.codigo)) continue;
        const novo = await CRM.inserir('produtos', { nome: x.descricao, codigo: x.codigo, unidade: x.unidade || null, preco: Math.max(0, Number(x.preco_venda) || 0), ativo: true });
        achou.set(x.codigo, novo);
      }
    }
    return achou;
  }

  async function enviarVarias(arquivos) {
    const porCodigo = new Map(), semCodigo = [];
    arquivos.forEach(a => { const c = codigoDoArquivo(a.name); if (c) porCodigo.set(c, a); else semCodigo.push(a.name); });
    const prods = await produtosDosCodigos([...porCodigo.keys()]);
    let ok = 0; const semProduto = [], erros = [];
    for (const [c, a] of porCodigo) {
      const p = prods.get(c);
      if (!p) { semProduto.push(a.name); continue; }
      try { await enviar(p, a); ok++; } catch (e) { erros.push(a.name + ': ' + e.message); }
      if ((ok + erros.length) % 10 === 0) CRM.toast('Fotos: ' + (ok + erros.length) + ' de ' + porCodigo.size + '…');
    }
    CRM.abrirForm({
      titulo: 'Fotos enviadas', campos: [], salvarTexto: 'Ok',
      intro: ok + ' foto(s) ligada(s) aos produtos.' +
        (semProduto.length ? '\nSem produto com esse código (' + semProduto.length + '): ' + semProduto.join(', ') : '') +
        (semCodigo.length ? '\nSem código no nome do arquivo (' + semCodigo.length + '): ' + semCodigo.join(', ') + ' — renomeie para o código do FKN, ex.: 010049.jpg' : '') +
        (erros.length ? '\nCom erro (' + erros.length + '): ' + erros.join(' · ') : ''),
      aoSalvar: () => {}
    });
  }

  // Foto de um item da proposta (pelo produto ligado ou pelo código do FKN).
  function doItem(it) {
    const prods = E().D.produtos;
    const p = (it.produto_id && E().ix.porId.produtos.get(it.produto_id)) || (it.codigo && prods.find(x => mesmoCodigo(x.codigo, it.codigo)));
    return (p && p.foto) || null;
  }

  CRM.fotos = { enviar, tirar, enviarVarias, doItem, escolhe };
  Object.assign(CRM.acoes, {
    'fotos-varias': () => escolhe(true, enviarVarias),
    'produto-foto': id => { const p = E().ix.porId.produtos.get(id); if (p) escolhe(false, async l => {
      const r = await enviar(p, l[0]);
      document.querySelectorAll('img.foto-produto[data-id="' + id + '"]').forEach(img => { img.src = r.foto; img.hidden = false; });
      CRM.toast('Foto de "' + p.nome + '" salva.');
    }); },
    'produto-foto-tirar': id => { const p = E().ix.porId.produtos.get(id); if (p && confirm('Tirar a foto de "' + p.nome + '"?')) tirar(p).catch(CRM.falhou); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
