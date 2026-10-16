'use strict';
/* Serviço fiscal da OneClean — servidor HTTP (Node puro, sem npm). Roda na VPS da Agilité, ao lado do sistema dela,
   como serviço do Linux (oneclean-fiscal.service), atrás do Caddy (HTTPS). Só o CRM fala com ele, pela Edge Function
   crm-fiscal do Supabase, com a chave FISCAL_TOKEN (cabeçalho Authorization: Bearer). O navegador nunca chega aqui.
   Configuração (arquivo /etc/oneclean-fiscal.env, só root lê; nada disso vai para o repositório nem para o chat):
     FISCAL_TOKEN               chave combinada com a Edge Function (gerada na instalação)
     FISCAL_PFX                 caminho do certificado A1 da OneClean (.pfx)
     FISCAL_PFX_SENHA_ARQUIVO   arquivo com a senha do .pfx (uma linha)
     FISCAL_CA                  (opcional) cadeia extra de certificados do servidor da Sefaz, se o Node não reconhecer
     FISCAL_PASTA               pasta onde guarda uma cópia de cada XML enviado/autorizado (padrão /var/lib/oneclean-fiscal)
     FISCAL_PORTA               porta local (padrão 8787; o Caddy encaminha para 127.0.0.1)
   Rotas (POST com JSON): /status, /previa, /emitir, /consultar, /reenviar, /cancelar, /cce, /inutilizar; GET /saude.
   Certificado novo (renovação do A1): trocar o arquivo e mandar "systemctl reload oneclean-fiscal" (SIGHUP relê). */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const N = require('./nfe');
const A = require('./assinatura');
const S = require('./sefaz');
const PD = require('./pedido');

const VERSAO = '2026-10-16';
const env = process.env;
let cert = null;   // { certPem, keyPem, dados }

function carregaCertificado() {
  if (!env.FISCAL_PFX) { cert = null; return; }
  const senha = env.FISCAL_PFX_SENHA_ARQUIVO ? fs.readFileSync(env.FISCAL_PFX_SENHA_ARQUIVO, 'utf8').replace(/\r?\n$/, '') : '';
  const p = A.pfxParaPem(env.FISCAL_PFX, senha);
  cert = Object.assign(p, { dados: A.dadosCertificado(p.certPem) });
  console.log('certificado carregado: válido até ' + cert.dados.validoAte);
}
const ca = () => (env.FISCAL_CA && fs.existsSync(env.FISCAL_CA) ? fs.readFileSync(env.FISCAL_CA, 'utf8') : undefined);
const cfgSefaz = amb => {
  if (!cert) throw Object.assign(new Error('o certificado A1 não está configurado no serviço fiscal'), { status: 503 });
  return { ambiente: amb === 'producao' ? 'producao' : 'homologacao', certPem: cert.certPem, keyPem: cert.keyPem, ca: ca(), tempo: 30000 };
};
const agoraSP = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 19) + '-03:00';   // SP sem horário de verão desde 2019

function guarda(nome, conteudo) {
  try {
    const dir = path.join(env.FISCAL_PASTA || '/var/lib/oneclean-fiscal', new Date().toISOString().slice(0, 7));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, nome), conteudo, { mode: 0o600 });
  } catch (e) { console.error('não guardei ' + nome + ': ' + e.message); }
}

// Monta, assina e envia. Devolve o que a Sefaz disse e os XML (o assinado, para reenviar sem mudar nada, e o
// nfeProc quando autorizada).
async function emitir(nota) {
  const cfg = cfgSefaz(nota.ambiente);
  const m = N.monta(nota);
  const sig = A.assinaElemento(m.infNFe, m.id, cfg.certPem, cfg.keyPem);
  const nfeXml = N.nfeCompleta(m.infNFe, sig);
  guarda(m.chave + '-nfe.xml', nfeXml);
  let r;
  try { r = await S.autoriza(cfg, nfeXml, m.chave); } catch (e) { if (e.pendente) return { situacao: 'pendente', chave: m.chave, nfeXml, motivo: e.message, totais: m.totais }; throw e; }
  return finaliza(r, m.chave, nfeXml, m.totais);
}
function finaliza(r, chave, nfeXml, totais) {
  const out = { situacao: r.situacao, cStat: r.cStat, motivo: r.xMotivo, protocolo: r.protocolo, recebido: r.recebido, chave, nfeXml, totais, duplicidade: !!r.duplicidade };
  if ((r.situacao === 'autorizada' || r.situacao === 'denegada') && r.protNFe) {
    out.procXml = N.nfeProc(nfeXml, r.protNFe);
    guarda(chave + '-procNFe.xml', out.procXml);
  }
  return out;
}

const ROTAS = {
  'GET /saude': async () => ({ ok: true, versao: VERSAO, certificado: cert ? cert.dados : null }),
  'POST /status': async b => S.status(cfgSefaz(b.ambiente)),
  'POST /previa': async b => { const m = N.monta(b.nota); return { chave: m.chave, calculo: m.calculo, totais: m.totais }; },
  'POST /emitir': async b => emitir(b.nota),
  // Do pedido do CRM (a Edge Function crm-fiscal manda o pedido, o cliente, as regras fiscais e o emitente; o número
  // vem reservado no banco). Com aviso que bloqueia, não monta nem envia: devolve os avisos.
  'POST /previa-pedido': async b => {
    const r = PD.notaDoPedido(Object.assign({}, b, { emissao: agoraSP(), numero: b.numero || 1 }));
    if (r.avisos.bloqueia.length) return { avisos: r.avisos, bloqueado: true, total: r.total };
    const m = N.monta(r.nota);
    return { avisos: r.avisos, bloqueado: false, totais: m.totais, calculo: m.calculo, nota: r.nota };
  },
  'POST /emitir-pedido': async b => {
    const r = PD.notaDoPedido(Object.assign({}, b, { emissao: agoraSP() }));
    if (r.avisos.bloqueia.length) return { situacao: 'bloqueada', avisos: r.avisos };
    return Object.assign(await emitir(r.nota), { avisos: r.avisos, nota: r.nota });
  },
  'POST /consultar': async b => { const r = await S.consulta(cfgSefaz(b.ambiente), b.chave); return b.nfeXml ? finaliza(r, b.chave, b.nfeXml) : r; },
  'POST /reenviar': async b => finaliza(await S.autoriza(cfgSefaz(b.ambiente), b.nfeXml, b.chave), b.chave, b.nfeXml),
  'POST /cancelar': async b => {
    const cfg = cfgSefaz(b.ambiente);
    const r = await S.enviaEvento(cfg, S.cancelamento({ ambiente: cfg.ambiente, cnpj: b.cnpj, chave: b.chave, protocolo: b.protocolo, justificativa: b.justificativa, quando: agoraSP() }));
    if (r.retEvento) guarda(b.chave + '-canc.xml', '<procEventoNFe xmlns="' + N.NS + '" versao="1.00">' + r.eventoXml + r.retEvento + '</procEventoNFe>');
    return r;
  },
  'POST /cce': async b => {
    const cfg = cfgSefaz(b.ambiente);
    const r = await S.enviaEvento(cfg, S.cartaCorrecao({ ambiente: cfg.ambiente, cnpj: b.cnpj, chave: b.chave, seq: b.seq, correcao: b.correcao, quando: agoraSP() }));
    if (r.retEvento) guarda(b.chave + '-cce' + (b.seq || 1) + '.xml', '<procEventoNFe xmlns="' + N.NS + '" versao="1.00">' + r.eventoXml + r.retEvento + '</procEventoNFe>');
    return r;
  },
  'POST /inutilizar': async b => S.inutiliza(cfgSefaz(b.ambiente), b)
};

function autorizado(req) {
  const t = env.FISCAL_TOKEN || '', h = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (t.length < 32) return false;   // sem chave forte configurada, não atende ninguém
  const a = Buffer.from(h), b = Buffer.from(t);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cria() {
  return http.createServer((req, res) => {
    const responde = (st, obj) => { res.writeHead(st, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
    const rota = ROTAS[req.method + ' ' + req.url.split('?')[0]];
    if (!rota) return responde(404, { erro: 'rota desconhecida' });
    if (!autorizado(req)) return responde(401, { erro: 'sem autorização' });
    const partes = []; let tam = 0;
    req.on('data', d => { tam += d.length; if (tam > 5e6) req.destroy(); else partes.push(d); });
    req.on('end', async () => {
      let corpo = {};
      try { if (partes.length) corpo = JSON.parse(Buffer.concat(partes).toString('utf8')); } catch (e) { return responde(400, { erro: 'JSON inválido' }); }
      try { responde(200, await rota(corpo)); }
      catch (e) { console.error(req.url + ': ' + e.message); responde(e.status || 422, { erro: e.message }); }
    });
  });
}

if (require.main === module) {
  try { carregaCertificado(); } catch (e) { console.error('certificado: ' + e.message); }
  process.on('SIGHUP', () => { try { carregaCertificado(); } catch (e) { console.error('certificado: ' + e.message); } });
  const porta = Number(env.FISCAL_PORTA || 8787);
  cria().listen(porta, '127.0.0.1', () => console.log('serviço fiscal ' + VERSAO + ' em 127.0.0.1:' + porta));
}

module.exports = { cria, ROTAS, emitir, finaliza, agoraSP, carregaCertificado, _cert: v => { cert = v; } };
