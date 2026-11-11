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
// 11/11/2026: o fim de linha não conta. No Windows com core.autocrlf=true os arquivos ficam com CRLF e o carimbo saía
// diferente do de um computador com LF, com o MESMO conteúdo no git: cada commit de uma máquina trocava todas as versões
// e a equipe inteira recarregava o CRM sem nada ter mudado. Texto (js, css, svg, o próprio index) é contado com LF;
// imagem (jpg, png) vai como está.
const TEXTO = /\.(?:js|css|svg|html)$/i;
const lf = s => s.replace(/\r\n/g, '\n');
const conteudo = f => (TEXTO.test(f) ? lf(fs.readFileSync(f, 'utf8')) : fs.readFileSync(f));

// src="x.js" / href="x.css" locais (não http, não data:), com ou sem ?v= anterior.
const RE = /(\s(?:src|href)=")((?!https?:|data:|#)[^"?]+\.(?:js|css|jpg|png|svg))(?:\?v=[0-9a-f]*)?(")/g;

function carimbo(html) {
  const comArquivos = html.replace(RE, (m, a, arq, z) => {
    const f = path.join(raiz, arq);
    if (!fs.existsSync(f)) throw new Error('index.html cita ' + arq + ', que não existe');
    return a + arq + '?v=' + sha(conteudo(f)).slice(0, 10) + z;
  });
  const META = /<meta name="crm-versao" content="[^"]*">/;
  if (!META.test(comArquivos)) throw new Error('falta <meta name="crm-versao" content=""> no index.html');
  const geral = sha(lf(comArquivos.replace(META, '<meta name="crm-versao" content="">'))).slice(0, 12);
  return comArquivos.replace(META, '<meta name="crm-versao" content="' + geral + '">');
}

if (require.main === module) {
  const atual = fs.readFileSync(INDEX, 'utf8');
  const novo = carimbo(atual);
  if (novo === atual) console.log('index.html já estava com as versões certas.');
  else { fs.writeFileSync(INDEX, novo); console.log('index.html carimbado: versão ' + /crm-versao" content="([^"]*)/.exec(novo)[1]); }
}
module.exports = { carimbo, INDEX, versaoDe: f => sha(conteudo(f)).slice(0, 10) };
