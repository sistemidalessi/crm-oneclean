#!/usr/bin/env node
/* Extrai TUDO do Agendor pela API v3 e grava um arquivo para importar no CRM
   (Configurações -> Importar -> "Do Agendor").

   Uso (Node 18 ou mais novo, nada para instalar):
     node agendor-exportar.js SEU_TOKEN
     node agendor-exportar.js SEU_TOKEN --completo
     node agendor-exportar.js --estrutura agendor-exportado-AAAA-MM-DD.json

   O token fica no Agendor em Menu -> Integrações. Ele dá acesso à conta toda:
   não mande por e-mail/WhatsApp, não salve em arquivo do repositório, e revogue
   no Agendor depois da migração.

   O que baixa: usuários, funis/etapas, produtos, empresas, pessoas, negócios
   (com produtos) e tarefas/histórico. Cada lista é paginada (100 por página)
   seguindo o "links.next" da API. Se a API mandar esperar (429), espera.

   Tarefas: a lista geral /tasks do Agendor exige filtro de data e NÃO volta mais
   de 31 dias ("The difference between createdDateGt and today must be less than or
   equal to 31 days" — visto na extração real da OneClean em 29/09/2026). Então:
     1) recentes/pendentes: /tasks com criadas, com prazo, concluídas e alteradas
        nos últimos 30 dias (juntas, sem repetir);
     2) histórico antigo: tarefas de cada empresa, de cada pessoa e de cada negócio
        (/organizations/ID/tasks etc.), 4 pedidos de cada vez. É a parte demorada.

   --completo: também busca os negócios empresa por empresa (se o total de
   negócios não bater com o Agendor).

   --estrutura ARQUIVO: não fala com o Agendor. Lê um arquivo já exportado e mostra
   só os NOMES dos campos e quantos registros têm cada um preenchido — nenhum dado
   de cliente — mais os valores de campos de lista (etapas, status, tipos de
   tarefa, categorias, origens, motivos). Serve para conferir a importação.

   Saída: agendor-exportado-AAAA-MM-DD.json na pasta atual (gravado também no meio
   do caminho, para não perder o que já veio). O arquivo tem dados pessoais de
   clientes: guarde com cuidado e apague quando a migração estiver conferida. */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = process.env.AGENDOR_BASE || 'https://api.agendor.com.br/v3'; // AGENDOR_BASE só para teste
const args = process.argv.slice(2);
const completo = args.includes('--completo');
const iEstrutura = args.indexOf('--estrutura');
const token = args.find((a, i) => !a.startsWith('--') && (iEstrutura === -1 || i !== iEstrutura + 1)) || process.env.AGENDOR_TOKEN;
const PARALELO = 4;

if (iEstrutura !== -1) { estrutura(args[iEstrutura + 1]); process.exit(0); }
if (!token) {
  console.error('Uso: node agendor-exportar.js SEU_TOKEN [--completo]\n     node agendor-exportar.js --estrutura ARQUIVO.json\n(o token fica no Agendor em Menu -> Integrações)');
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
    await espera(60); // gentileza com a API
  }
  if (rotulo) console.log(itens.length);
  return itens;
}

// Uma lista que falha não pode derrubar as outras: registra o erro, segue e
// grava o arquivo com o que veio (importar de novo depois não duplica).
const erros = [];
async function seguro(rotulo, fn) {
  try { return await fn(); } catch (e) {
    console.log('\n  AVISO: ' + rotulo + ' falhou: ' + e.message);
    erros.push(rotulo + ': ' + e.message);
    return [];
  }
}

function junta(destino, novos) {
  const ids = destino.__ids || (Object.defineProperty(destino, '__ids', { value: new Set(destino.map(x => x.id)) }), destino.__ids);
  let n = 0;
  for (const x of novos || []) if (x && x.id != null && !ids.has(x.id)) { destino.push(x); ids.add(x.id); n++; }
  return n;
}

// Roda "fn" para cada item, PARALELO de cada vez, com contagem na tela.
async function emLote(itens, rotulo, fn) {
  let i = 0, feitos = 0;
  const t0 = Date.now();
  const trabalhador = async () => {
    while (i < itens.length) {
      const it = itens[i++];
      await fn(it);
      feitos++;
      if (feitos % 100 === 0 || feitos === itens.length) {
        const min = (Date.now() - t0) / 60000;
        const falta = feitos ? Math.max(0, Math.round(min / feitos * (itens.length - feitos))) : 0;
        process.stdout.write('\r  ' + rotulo + ': ' + feitos + ' de ' + itens.length + (falta ? ' (faltam ~' + falta + ' min)   ' : '        '));
      }
    }
  };
  await Promise.all(Array.from({ length: PARALELO }, trabalhador));
  if (itens.length) process.stdout.write('\n');
}

const nomeArquivo = 'agendor-exportado-' + new Date().toISOString().slice(0, 10) + '.json';
const arquivo = path.resolve(process.cwd(), nomeArquivo);
function grava(saida) { saida.erros = erros; fs.writeFileSync(arquivo, JSON.stringify(saida)); }

(async () => {
  const inicio = Date.now();
  console.log('Exportando do Agendor' + (completo ? ' (modo completo)' : '') + '…\n');
  const saida = { origem: 'agendor-api-v3', extraido_em: new Date().toISOString(), modo: completo ? 'completo' : 'padrao' };

  saida.users = await seguro('usuários', () => tudo('/users', 'Usuários'));
  saida.funnels = await seguro('funis', () => tudo('/funnels', 'Funis'));
  saida.products = await seguro('produtos', () => tudo('/products', 'Produtos'));
  saida.organizations = await seguro('empresas', () => tudo('/organizations?withCustomFields=true', 'Empresas'));
  saida.people = await seguro('pessoas', () => tudo('/people?withCustomFields=true', 'Pessoas'));
  saida.deals = await seguro('negócios', () => tudo('/deals?withCustomFields=true', 'Negócios'));
  grava(saida);

  // ---- tarefas recentes e pendentes (limite de 31 dias da lista geral)
  saida.tasks = [];
  const ha30 = encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString());
  for (const [filtro, rotulo] of [['createdDateGt', 'criadas'], ['dueDateGt', 'com prazo'], ['finishedDateGt', 'concluídas'], ['updatedDateGt', 'alteradas']]) {
    junta(saida.tasks, await seguro('tarefas ' + rotulo + ' (30 dias)', () => tudo('/tasks?' + filtro + '=' + ha30, 'Tarefas ' + rotulo + ' nos últimos 30 dias')));
  }
  console.log('  → ' + saida.tasks.length + ' tarefas recentes/pendentes (sem repetir)');
  grava(saida);

  // ---- histórico antigo: por empresa, pessoa e negócio
  console.log('\nHistórico antigo (tarefas de cada empresa, pessoa e negócio). Pode levar alguns minutos…');
  let indisponivel = null;
  const antes = saida.tasks.length;
  async function tarefasDe(base) {
    if (indisponivel) return;
    try {
      junta(saida.tasks, await tudo(base + '/tasks'));
    } catch (e) {
      if (/at least one parameter|must be provided|31 days/i.test(e.message)) {
        indisponivel = e.message;
      } else erros.push('tarefas de ' + base + ': ' + e.message);
    }
  }
  const alvos = [].concat(
    saida.organizations.map(o => '/organizations/' + o.id),
    saida.people.map(p => '/people/' + p.id),
    saida.deals.map(d => '/deals/' + d.id)
  );
  let desdeGravar = 0;
  await emLote(alvos, 'histórico', async b => { await tarefasDe(b); if (++desdeGravar % 500 === 0) grava(saida); });
  if (indisponivel) {
    console.log('  AVISO: o Agendor não entrega o histórico antigo por empresa/negócio: ' + indisponivel.slice(0, 200));
    erros.push('histórico antigo indisponível pela API: ' + indisponivel.slice(0, 300));
  } else {
    console.log('  → +' + (saida.tasks.length - antes) + ' tarefas do histórico (total ' + saida.tasks.length + ')');
  }
  grava(saida);

  if (completo) {
    console.log('\nModo completo: negócios empresa por empresa…');
    let nd = 0;
    await emLote(saida.organizations, 'empresas', async o => {
      nd += junta(saida.deals, await seguro('negócios da empresa ' + o.id, () => tudo('/organizations/' + o.id + '/deals')));
    });
    console.log('  → +' + nd + ' negócio(s) que não vieram na lista geral');
  }

  grava(saida);
  const min = ((Date.now() - inicio) / 60000).toFixed(1);
  console.log('\nPronto em ' + min + ' min (' + requisicoes + ' requisições).');
  console.log('Arquivo: ' + arquivo + ' (' + (fs.statSync(arquivo).size / 1048576).toFixed(1) + ' MB)');
  console.log('\nConfira os totais com o que aparece no Agendor:');
  console.log('  empresas ' + saida.organizations.length + ' · pessoas ' + saida.people.length + ' · negócios ' + saida.deals.length + ' · tarefas ' + saida.tasks.length + ' · produtos ' + saida.products.length);
  console.log('\nAgora: CRM -> Configurações -> Importar -> "Do Agendor" -> escolha este arquivo.');
  console.log('Lembrete: o arquivo tem dados de clientes. Guarde com cuidado e apague depois de conferir.');
  if (erros.length) {
    console.log('\nATENÇÃO: ' + erros.length + ' aviso(s) (o resto foi gravado):');
    erros.slice(0, 10).forEach(e => console.log('  - ' + e.slice(0, 220)));
    console.log('Mande um print desta tela para o suporte (Sistemi Dalessi).');
    process.exitCode = 2;
  }
})().catch(e => { console.error('\nERRO: ' + e.message); process.exit(1); });

// ============================================================ --estrutura
// Mostra a "forma" do arquivo sem nenhum dado de cliente.
function estrutura(arq) {
  if (!arq || !fs.existsSync(arq)) { console.error('Arquivo não encontrado: ' + arq); process.exit(1); }
  const d = JSON.parse(fs.readFileSync(arq, 'utf8'));
  // Campos de lista (não pessoais): mostra os valores distintos.
  const LISTAS = /(^|\.)(dealStatus|dealStage|funnel|category|sector|leadOrigin|origin|lossReason|reasonForLoss|type|ranking|status|state)(\.(id|name|sequence|abbreviation))?$/;
  const NUNCA = /(email|phone|mobile|work|whatsapp|fax|cpf|cnpj|name|legalName|nickname|description|text|street|postal|district|website|facebook|instagram|linkedin|twitter|skype|birthday|contact|address|customFields)/i;
  console.log('Estrutura de ' + path.basename(arq) + ' (extraído em ' + (d.extraido_em || '?') + ')\n');
  for (const chave of ['users', 'funnels', 'products', 'organizations', 'people', 'deals', 'tasks']) {
    const lista = Array.isArray(d[chave]) ? d[chave] : [];
    console.log('== ' + chave + ': ' + lista.length + ' registro(s)');
    if (!lista.length) { console.log(''); continue; }
    const cont = new Map(), valores = new Map();
    const anda = (o, pre, prof) => {
      if (o == null || typeof o !== 'object' || prof > 3) return;
      if (Array.isArray(o)) { const k = pre + '[]'; cont.set(k, (cont.get(k) || 0) + (o.length ? 1 : 0)); o.slice(0, 3).forEach(x => anda(x, k, prof + 1)); return; }
      for (const [k, v] of Object.entries(o)) {
        const p = pre ? pre + '.' + k : k;
        const cheio = v != null && v !== '' && !(Array.isArray(v) && !v.length);
        cont.set(p, (cont.get(p) || 0) + (cheio ? 1 : 0));
        if (v && typeof v === 'object') anda(v, p, prof + 1);
        else if (cheio && LISTAS.test(p) && !(NUNCA.test(p) && !/(dealStage|dealStatus|funnel|category|sector|leadOrigin|origin|lossReason|reasonForLoss|type|status)\.name$/.test(p))) {
          const s = valores.get(p) || new Map();
          const val = String(v).slice(0, 40);
          s.set(val, (s.get(val) || 0) + 1);
          valores.set(p, s);
        }
      }
    };
    lista.forEach(x => anda(x, '', 0));
    [...cont.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([k, n]) => {
      const pct = Math.round(n / lista.length * 100);
      let extra = '';
      const vs = valores.get(k);
      if (vs && chave !== 'users') extra = '  → ' + [...vs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([v, q]) => v + ' (' + q + ')').join(', ') + (vs.size > 12 ? ', …' : '');
      console.log('  ' + k + ': ' + pct + '%' + extra);
    });
    console.log('');
  }
  if (d.erros && d.erros.length) console.log('Avisos gravados na extração:\n  - ' + d.erros.join('\n  - '));
}
