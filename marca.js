/* CRM Sistemi Dalessi — a marca no pé de tudo o que sai do CRM (13/11/2026, pedido do Anderson: "todos os materiais que
   saem, PDF, nota fiscal, enfim, no rodapezinho, sair a marca"). Uma linha discreta, letra pequena e cinza.
   - ÚNICO lugar do texto. As Edge Functions (Deno) não leem este arquivo e guardam uma cópia (RODAPE_MARCA);
     testes/marca.test.js reprova se alguma cópia ficar diferente. Com o e-mail contato@ desde 13/11/2026.
   - DANFE: só no espaço livre do PDF (a margem de baixo, fora dos quadros); nunca nos campos da nota nem no XML.
   - Boleto: abaixo do código de barras, longe da ficha de compensação (desenhada pelo danfe.js e pelo boleto.js).
   Puro: roda no navegador, no Node (testes) e nas Edge Functions. */
(function (raiz) {
  'use strict';
  const RODAPE = 'Sistemi Dalessi · Sistemas sob Medida · sistemidalessi.com.br · contato@sistemidalessi.com.br';

  const M = { RODAPE };
  raiz.CRMMarca = M;
  if (typeof module !== 'undefined') module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
