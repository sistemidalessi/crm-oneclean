'use strict';
/* Diagnóstico na VPS (uso: sudo -u oneclean-fiscal env $(cat /etc/oneclean-fiscal.env | xargs) node diagnostico.js status homologacao).
   Lê o certificado, mostra titular e validade e pergunta à Sefaz-SP se o serviço está no ar. Não emite nada. */
const fs = require('fs');
const A = require('./assinatura');
const S = require('./sefaz');
(async () => {
  const amb = process.argv[3] === 'producao' ? 'producao' : 'homologacao';
  const senha = process.env.FISCAL_PFX_SENHA_ARQUIVO ? fs.readFileSync(process.env.FISCAL_PFX_SENHA_ARQUIVO, 'utf8').replace(/\r?\n$/, '') : '';
  const c = A.pfxParaPem(process.env.FISCAL_PFX, senha);
  const d = A.dadosCertificado(c.certPem);
  console.log('Certificado: ' + d.titular.replace(/\n/g, ' · '));
  console.log('Válido até: ' + d.validoAte);
  const r = await S.status({ ambiente: amb, certPem: c.certPem, keyPem: c.keyPem, ca: process.env.FISCAL_CA && fs.existsSync(process.env.FISCAL_CA) ? fs.readFileSync(process.env.FISCAL_CA, 'utf8') : undefined });
  console.log('Sefaz-SP (' + amb + '): ' + r.cStat + ' — ' + r.xMotivo + (r.tMed ? ' (tempo médio ' + r.tMed + ' s)' : ''));
})().catch(e => { console.error('Falhou: ' + e.message + (e.code ? ' [' + e.code + ']' : '')); process.exit(1); });
