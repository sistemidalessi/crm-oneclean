// Carimba no index.html a versão de cada arquivo (crm.css?v=…, app.js?v=…) e a versão geral
// (<meta name="crm-versao">). Arquivo que mudou ganha endereço novo e o navegador baixa de novo,
// sem Ctrl+F5; o app aberto compara a versão geral com a publicada e se atualiza sozinho (app.js).
//   node ferramentas/carimba-versao.js        (rodar antes do commit; testes/versao.test.js cobra)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const raiz = path.join(__dirname, '..');
const INDEX = path.join(raiz, 'index.html');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

// src="x.js" / href="x.css" locais (não http, não data:), com ou sem ?v= anterior.
const RE = /(\s(?:src|href)=")((?!https?:|data:|#)[^"?]+\.(?:js|css|jpg|png|svg))(?:\?v=[0-9a-f]*)?(")/g;

function carimbo(html) {
  const comArquivos = html.replace(RE, (m, a, arq, z) => {
    const f = path.join(raiz, arq);
    if (!fs.existsSync(f)) throw new Error('index.html cita ' + arq + ', que não existe');
    return a + arq + '?v=' + sha(fs.readFileSync(f)).slice(0, 10) + z;
  });
  const META = /<meta name="crm-versao" content="[^"]*">/;
  if (!META.test(comArquivos)) throw new Error('falta <meta name="crm-versao" content=""> no index.html');
  const geral = sha(comArquivos.replace(META, '<meta name="crm-versao" content="">')).slice(0, 12);
  return comArquivos.replace(META, '<meta name="crm-versao" content="' + geral + '">');
}

if (require.main === module) {
  const atual = fs.readFileSync(INDEX, 'utf8');
  const novo = carimbo(atual);
  if (novo === atual) console.log('index.html já estava com as versões certas.');
  else { fs.writeFileSync(INDEX, novo); console.log('index.html carimbado: versão ' + /crm-versao" content="([^"]*)/.exec(novo)[1]); }
}
module.exports = { carimbo, INDEX };
