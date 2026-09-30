#!/usr/bin/env node
// Vigia da pasta de XML das notas (UniNFe / FKM): a cada minuto procura XML novos e manda para o
// CRM (Edge Function crm-notas), que aplica as mesmas regras da importação manual — só as notas da
// equipe, completa o cadastro do cliente, não duplica. Roda no servidor onde fica a pasta.
// Precisa do Node 18 ou mais novo. Não usa nenhum pacote.
//
// 1ª vez (grava vigia-notas.json ao lado deste arquivo):
//   node vigia-notas.js --configurar --url https://SEU-PROJETO.supabase.co --chave CHAVE --pasta "D:\...\Enviados\Autorizados"
// Depois:
//   node vigia-notas.js            fica rodando (olha a pasta a cada minuto)
//   node vigia-notas.js --uma-vez  olha uma vez e sai (para o Agendador de Tarefas)
//
// A chave é gerada no CRM em Configurações → Integrações (só serve para entregar notas).
// O que já foi enviado fica em vigia-notas-estado.json; o que aconteceu, em vigia-notas.log.
'use strict';
const fs = require('fs');
const path = require('path');

const AQUI = __dirname;
const CONFIG = path.join(AQUI, 'vigia-notas.json');
const ESTADO = path.join(AQUI, 'vigia-notas-estado.json');
const LOG = path.join(AQUI, 'vigia-notas.log');
const POR_ENVIO = 50;
const BYTES_POR_ENVIO = 8 * 1024 * 1024;
const ESPERA_ARQUIVO_MS = 15000; // arquivo mexido há menos que isso pode estar sendo gravado

function registra(msg) {
  const linha = new Date().toLocaleString('pt-BR') + '  ' + msg;
  console.log(linha);
  try { fs.appendFileSync(LOG, linha + '\n'); } catch (e) { /* sem log em disco, segue */ }
}
const leJson = (f, padrao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return padrao; } };
const arg = (nome) => { const i = process.argv.indexOf('--' + nome); return i !== -1 ? process.argv[i + 1] : null; };

function configurar() {
  const atual = leJson(CONFIG, {});
  const cfg = {
    url: (arg('url') || atual.url || '').replace(/\/+$/, ''),
    chave: arg('chave') || atual.chave || '',
    pasta: arg('pasta') || atual.pasta || '',
    desde: arg('desde') || atual.desde || String(new Date().getFullYear()) + '01',
    intervaloSegundos: Number(arg('intervalo') || atual.intervaloSegundos || 60)
  };
  if (!/^https?:\/\/.+/.test(cfg.url) || cfg.chave.length < 32 || !cfg.pasta) {
    console.error('Informe --url (https://...supabase.co), --chave (do CRM) e --pasta.');
    process.exit(1);
  }
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
  registra('configurado: pasta ' + cfg.pasta + ', meses a partir de ' + cfg.desde);
}

// XML da pasta e das subpastas de mês (AAAAMM >= "desde"). Dos pares nota/nota com protocolo que o
// UniNFe grava (…-nfe.xml e …-procNFe.xml), manda só o com protocolo.
function listaXml(cfg) {
  const out = [];
  const visita = (dir, rel, nivel) => {
    let itens;
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { registra('não consegui abrir ' + dir + ': ' + e.message); return; }
    const nomes = new Set(itens.map(i => i.name.toLowerCase()));
    for (const i of itens) {
      const r = rel ? rel + '/' + i.name : i.name;
      if (i.isDirectory()) {
        if (nivel === 0 && /^\d{6}$/.test(i.name) && i.name < cfg.desde) continue;
        if (nivel < 2) visita(path.join(dir, i.name), r, nivel + 1);
      } else if (/\.xml$/i.test(i.name)) {
        if (/-nfe\.xml$/i.test(i.name) && nomes.has(i.name.toLowerCase().replace(/-nfe\.xml$/, '-procnfe.xml'))) continue;
        if (/-ped-|procInut|-inu\.xml$/i.test(i.name)) continue;
        out.push({ rel: r, caminho: path.join(dir, i.name) });
      }
    }
  };
  visita(cfg.pasta, '', 0);
  return out;
}

async function envia(cfg, lote) {
  const corpo = JSON.stringify({ arquivos: lote.map(a => ({ nome: a.rel, xml: a.xml })) });
  const r = await fetch(cfg.url + '/functions/v1/crm-notas', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-crm-chave': cfg.chave }, body: corpo, signal: AbortSignal.timeout(150000)
  });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch (e) { /* resposta não é JSON */ }
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + ((j && j.erro) || txt.slice(0, 200)));
  return j;
}

async function umaVolta() {
  const cfg = leJson(CONFIG, null);
  if (!cfg) { console.error('Configure antes: node vigia-notas.js --configurar --url ... --chave ... --pasta ...'); process.exit(1); }
  const estado = leJson(ESTADO, { enviados: {} });
  const agora = Date.now();
  const novos = [];
  for (const a of listaXml(cfg)) {
    let st;
    try { st = fs.statSync(a.caminho); } catch (e) { continue; }
    const marca = st.size + ':' + Math.round(st.mtimeMs);
    if (estado.enviados[a.rel] === marca || agora - st.mtimeMs < ESPERA_ARQUIVO_MS) continue;
    novos.push(Object.assign(a, { marca, tamanho: st.size }));
  }
  if (!novos.length) return 0;
  registra(novos.length + ' XML novo(s) para enviar');
  let enviados = 0, importadas = 0, fora = 0, erros = 0;
  for (let i = 0; i < novos.length;) {
    const lote = [];
    let bytes = 0;
    while (i < novos.length && lote.length < POR_ENVIO && (bytes + novos[i].tamanho < BYTES_POR_ENVIO || !lote.length)) {
      const a = novos[i++];
      try { a.xml = fs.readFileSync(a.caminho, 'utf8').replace(/^\uFEFF/, ''); } catch (e) { registra('não li ' + a.rel + ': ' + e.message); continue; }
      bytes += a.tamanho; lote.push(a);
    }
    if (!lote.length) continue;
    try {
      const r = await envia(cfg, lote);
      (r.arquivos || []).forEach((s, k) => {
        const a = lote[k]; if (!a) return;
        estado.enviados[a.rel] = a.marca;
        if (s.situacao === 'importada') importadas++;
        else if (/^fora/.test(s.situacao)) fora++;
        else if (s.situacao === 'erro') { erros++; registra('ERRO no CRM: ' + a.rel); }
      });
      (r.erros || []).forEach(e => registra('  CRM: ' + e));
      enviados += lote.length;
      fs.writeFileSync(ESTADO, JSON.stringify(estado));
    } catch (e) {
      registra('falha ao enviar (tento de novo na próxima volta): ' + e.message);
      break;
    }
  }
  registra('enviados ' + enviados + ' · importadas ' + importadas + ' · fora (venda direta/externos) ' + fora + (erros ? ' · com erro ' + erros : ''));
  return enviados;
}

async function principal() {
  if (process.argv.includes('--configurar')) return configurar();
  if (process.argv.includes('--uma-vez')) { await umaVolta(); return; }
  const cfg = leJson(CONFIG, {});
  registra('vigia ligado: ' + (cfg.pasta || '(sem pasta)'));
  for (;;) {
    try { await umaVolta(); } catch (e) { registra('erro: ' + e.message); }
    await new Promise(r => setTimeout(r, (cfg.intervaloSegundos || 60) * 1000));
  }
}

if (require.main === module) principal();
module.exports = { listaXml, umaVolta };
