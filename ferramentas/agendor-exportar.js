#!/usr/bin/env node
/* Extrai TUDO do Agendor pela API v3 e grava um arquivo para importar no CRM
   (Configurações -> Importar -> "Do Agendor").

   Uso (Node 18 ou mais novo, nada para instalar):
     node agendor-exportar.js SEU_TOKEN
     node agendor-exportar.js SEU_TOKEN --completo      (mais lento; ver abaixo)

   O token fica no Agendor em Menu -> Integrações. Ele dá acesso à conta toda:
   não mande por e-mail/WhatsApp, não salve em arquivo do repositório, e revogue
   no Agendor depois da migração.

   O que baixa: usuários, funis/etapas, produtos, empresas, pessoas, negócios
   (com produtos) e tarefas/histórico. Cada lista é paginada (100 por página)
   seguindo o "links.next" da API. Se a API mandar esperar (429), espera.

   --completo: além das listas gerais, busca negócios e tarefas empresa por
   empresa e pessoa por pessoa, e junta sem repetir. Use se o total de negócios
   ou tarefas não bater com o que aparece no Agendor.

   Saída: agendor-exportado-AAAA-MM-DD.json na pasta atual. É o arquivo "bruto":
   a conversão para o CRM acontece na tela de importação (dá para rodar de novo
   sem duplicar nada). O arquivo tem dados pessoais de clientes: guarde com
   cuidado e apague quando a migração estiver conferida. */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = process.env.AGENDOR_BASE || 'https://api.agendor.com.br/v3'; // AGENDOR_BASE só para teste
const args = process.argv.slice(2);
const token = args.find(a => !a.startsWith('--')) || process.env.AGENDOR_TOKEN;
const completo = args.includes('--completo');

if (!token) {
  console.error('Uso: node agendor-exportar.js SEU_TOKEN [--completo]\n(o token fica no Agendor em Menu -> Integrações)');
  process.exit(1);
}
if (typeof fetch !== 'function') {
  console.error('Precisa do Node 18 ou mais novo (node --version).');
  process.exit(1);
}

const espera = ms => new Promise(r => setTimeout(r, ms));
let requisicoes = 0;

async function pedir(url, tentativa = 1) {
  requisicoes++;
  let r;
  try {
    r = await fetch(url, { headers: { Authorization: 'Token ' + token, 'Content-Type': 'application/json', Accept: 'application/json' } });
  } catch (e) {
    if (tentativa <= 5) { await espera(2000 * tentativa); return pedir(url, tentativa + 1); }
    throw new Error('sem conexão com o Agendor: ' + e.message);
  }
  if (r.status === 401 || r.status === 403) throw new Error('o Agendor recusou o token (' + r.status + '). Confira em Menu -> Integrações.');
  if (r.status === 404) return null;
  if (r.status === 429 || r.status >= 500) {
    if (tentativa > 8) throw new Error('o Agendor continua respondendo ' + r.status + ' em ' + url);
    const s = Number(r.headers.get('retry-after')) || Math.min(60, 5 * tentativa);
    process.stdout.write(' [aguardando ' + s + 's]');
    await espera(s * 1000);
    return pedir(url, tentativa + 1);
  }
  if (!r.ok) throw new Error('erro ' + r.status + ' em ' + url + ': ' + (await r.text()).slice(0, 300));
  return r.json();
}

// Segue a paginação: aceita { data: [...], links: { next } } ou uma lista pura.
async function tudo(caminho, rotulo) {
  const sep = caminho.includes('?') ? '&' : '?';
  let url = BASE + caminho + sep + 'per_page=100&page=1';
  const itens = [];
  let paginas = 0;
  if (rotulo) process.stdout.write(rotulo + ': ');
  while (url) {
    const j = await pedir(url);
    if (j == null) { if (rotulo) console.log('(não disponível nesta conta)'); return itens; }
    const lista = Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : [];
    itens.push(...lista);
    paginas++;
    if (rotulo && paginas % 5 === 0) process.stdout.write(itens.length + '… ');
    if (!Array.isArray(j) && j.links) {
      const prox = j.links.next;
      url = prox ? (prox.startsWith('http') ? prox : BASE + prox) : null;
    } else {
      // Resposta sem "links": pede a próxima página pelo número enquanto vier cheia.
      url = lista.length === 100 ? BASE + caminho + sep + 'per_page=100&page=' + (paginas + 1) : null;
    }
    await espera(120); // gentileza com a API
  }
  if (rotulo) console.log(itens.length);
  return itens;
}

function junta(destino, novos) {
  const ids = new Set(destino.map(x => x.id));
  let n = 0;
  for (const x of novos) if (x && x.id != null && !ids.has(x.id)) { destino.push(x); ids.add(x.id); n++; }
  return n;
}

(async () => {
  const inicio = Date.now();
  console.log('Exportando do Agendor' + (completo ? ' (modo completo)' : '') + '…\n');
  const saida = { origem: 'agendor-api-v3', extraido_em: new Date().toISOString(), modo: completo ? 'completo' : 'padrao' };

  saida.users = await tudo('/users', 'Usuários');
  saida.funnels = await tudo('/funnels', 'Funis');
  saida.products = await tudo('/products', 'Produtos');
  saida.organizations = await tudo('/organizations?withCustomFields=true', 'Empresas');
  saida.people = await tudo('/people?withCustomFields=true', 'Pessoas');
  saida.deals = await tudo('/deals?withCustomFields=true', 'Negócios');
  saida.tasks = await tudo('/tasks', 'Tarefas e histórico');

  if (completo) {
    console.log('\nModo completo: conferindo empresa por empresa (' + saida.organizations.length + ') e pessoa por pessoa (' + saida.people.length + ')…');
    let nd = 0, nt = 0, i = 0;
    for (const o of saida.organizations) {
      nd += junta(saida.deals, await tudo('/organizations/' + o.id + '/deals'));
      nt += junta(saida.tasks, await tudo('/organizations/' + o.id + '/tasks'));
      if (++i % 50 === 0) console.log('  ' + i + ' empresas… (+' + nd + ' negócios, +' + nt + ' tarefas achados)');
    }
    i = 0;
    for (const p of saida.people) {
      nd += junta(saida.deals, await tudo('/people/' + p.id + '/deals'));
      nt += junta(saida.tasks, await tudo('/people/' + p.id + '/tasks'));
      if (++i % 50 === 0) console.log('  ' + i + ' pessoas…');
    }
    for (const d of saida.deals) nt += junta(saida.tasks, (await tudo('/deals/' + d.id + '/tasks')));
    console.log('Modo completo acrescentou ' + nd + ' negócio(s) e ' + nt + ' tarefa(s).');
  }

  const nome = 'agendor-exportado-' + new Date().toISOString().slice(0, 10) + '.json';
  const arq = path.resolve(process.cwd(), nome);
  fs.writeFileSync(arq, JSON.stringify(saida));
  const min = ((Date.now() - inicio) / 60000).toFixed(1);
  console.log('\nPronto em ' + min + ' min (' + requisicoes + ' requisições).');
  console.log('Arquivo: ' + arq + ' (' + (fs.statSync(arq).size / 1048576).toFixed(1) + ' MB)');
  console.log('\nConfira os totais com o que aparece no Agendor:');
  console.log('  empresas ' + saida.organizations.length + ' · pessoas ' + saida.people.length + ' · negócios ' + saida.deals.length + ' · tarefas ' + saida.tasks.length + ' · produtos ' + saida.products.length);
  console.log('\nAgora: CRM -> Configurações -> Importar -> "Do Agendor" -> escolha este arquivo.');
  console.log('Lembrete: o arquivo tem dados de clientes. Guarde com cuidado e apague depois de conferir.');
})().catch(e => { console.error('\nERRO: ' + e.message); process.exit(1); });
