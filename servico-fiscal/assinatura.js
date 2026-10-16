'use strict';
/* Assinatura digital da NF-e (XMLDSig "enveloped", RSA-SHA1, C14N 1.0 inclusivo), como o Manual de Orientação do
   Contribuinte manda: a <Signature> fica dentro do <NFe>, depois do <infNFe>, e a referência é "#NFe<chave>".
   Lição trazida da NFS-e da Agilité (agilite-sistema-gestao/src/nfse/ginfes/signer.js, set/2026): imitar o C14N à mão
   dá "assinatura inválida" em produção (elemento vazio não se autofecha, namespace herdado entra no elemento de cima).
   Aqui a forma canônica vem do xmllint do sistema (libxml2, a mesma engine dos validadores), sem biblioteca npm.
   Certificado A1: lido do .pfx pelo OpenSSL do sistema (como a Agilité), com a senha num arquivo temporário (não
   aparece na lista de processos). O .pfx e a senha só existem na VPS; nunca no repositório, no CRM ou no chat. */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { NS } = require('./nfe');
const DSIG = 'http://www.w3.org/2000/09/xmldsig#';

function canonicalizar(xml) {
  const tmp = path.join(os.tmpdir(), 'c14n-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.xml');
  try {
    fs.writeFileSync(tmp, xml);
    const r = spawnSync('xmllint', ['--c14n', tmp], { maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0 || !r.stdout || !r.stdout.length) throw new Error('xmllint --c14n falhou: ' + String(r.stderr || '').slice(0, 300));
    return r.stdout.toString('utf8');
  } finally { try { fs.unlinkSync(tmp); } catch (e) { /* ok */ } }
}

function pfxParaPem(pfxPath, senha) {
  if (!fs.existsSync(pfxPath)) throw new Error('certificado não encontrado em ' + pfxPath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cert-')), passFile = path.join(dir, 'p.txt');
  fs.writeFileSync(passFile, senha || '', { mode: 0o600 });
  try {
    const run = args => execFileSync('openssl', ['pkcs12', '-in', pfxPath].concat(args, ['-passin', 'file:' + passFile]), { stdio: ['pipe', 'pipe', 'pipe'] }).toString('utf8');
    let cert, key;
    try { cert = run(['-clcerts', '-nokeys']); key = run(['-nocerts', '-nodes']); }
    catch (e) { cert = run(['-clcerts', '-nokeys', '-legacy']); key = run(['-nocerts', '-nodes', '-legacy']); } // .pfx antigo (RC2/3DES) no OpenSSL 3
    const bloco = (s, l) => { const m = s.match(new RegExp('-----BEGIN ' + l + '-----[\\s\\S]*?-----END ' + l + '-----')); if (!m) throw new Error('não achei ' + l + ' no .pfx (senha errada?)'); return m[0]; };
    return { certPem: bloco(cert, 'CERTIFICATE'), keyPem: bloco(key, 'PRIVATE KEY') };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const semCabecalhoPem = pem => pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');

// Validade e titular do certificado (para o aviso de vencimento e para conferir que é o da empresa).
function dadosCertificado(certPem) {
  const x = new crypto.X509Certificate(certPem);
  return { titular: x.subject, emissor: x.issuer, validoDe: new Date(x.validFrom).toISOString(), validoAte: new Date(x.validTo).toISOString(), serial: x.serialNumber };
}

// Assina um elemento com atributo Id (infNFe, infEvento, infInut). xmlElemento: o elemento SEM namespace declarado
// (ele herda o do documento); idAttr: o valor do Id. Devolve o bloco <Signature> para ir logo depois do elemento.
function assinaElemento(xmlElemento, idAttr, certPem, keyPem, ns) {
  const comNs = xmlElemento.replace(/^<([A-Za-z]+)/, '<$1 xmlns="' + (ns || NS) + '"');   // como o C14N vê o elemento dentro do documento
  const digest = crypto.createHash('sha1').update(canonicalizar(comNs), 'utf8').digest('base64');
  const signedInfo = '<SignedInfo xmlns="' + DSIG + '"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>' +
    '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI="#' + idAttr + '"><Transforms>' +
    '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>' +
    '</Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>' + digest + '</DigestValue></Reference></SignedInfo>';
  const assinador = crypto.createSign('RSA-SHA1');
  assinador.update(canonicalizar(signedInfo), 'utf8');
  const valor = assinador.sign(keyPem, 'base64');
  return '<Signature xmlns="' + DSIG + '">' + signedInfo + '<SignatureValue>' + valor + '</SignatureValue><KeyInfo><X509Data><X509Certificate>' +
    semCabecalhoPem(certPem) + '</X509Certificate></X509Data></KeyInfo></Signature>';
}

// Confere uma assinatura nossa (testes e diagnóstico): digest do elemento e a assinatura do SignedInfo com a chave pública.
function confere(xmlElemento, assinaturaXml, ns) {
  const comNs = xmlElemento.replace(/^<([A-Za-z]+)/, '<$1 xmlns="' + (ns || NS) + '"');
  const digest = crypto.createHash('sha1').update(canonicalizar(comNs), 'utf8').digest('base64');
  const dv = (/<DigestValue>([^<]+)<\/DigestValue>/.exec(assinaturaXml) || [])[1];
  const si = (/<SignedInfo[\s\S]*?<\/SignedInfo>/.exec(assinaturaXml) || [])[0];
  const sv = (/<SignatureValue>([^<]+)<\/SignatureValue>/.exec(assinaturaXml) || [])[1];
  const cert = (/<X509Certificate>([^<]+)<\/X509Certificate>/.exec(assinaturaXml) || [])[1];
  const pem = '-----BEGIN CERTIFICATE-----\n' + cert.match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
  const ok = crypto.createVerify('RSA-SHA1').update(canonicalizar(si.replace('<SignedInfo>', '<SignedInfo xmlns="' + DSIG + '">')), 'utf8').verify(pem, sv, 'base64');
  return { digest: digest === dv, assinatura: ok };
}

module.exports = { canonicalizar, pfxParaPem, dadosCertificado, assinaElemento, confere, DSIG };
