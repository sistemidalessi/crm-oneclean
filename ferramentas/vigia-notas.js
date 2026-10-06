#!/usr/bin/env node
// Vigia da pasta de XML das notas (UniNFe / FKN): a cada minuto procura XML novos e manda para o
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
// Sinal de vida: a cada 30 min (e ao ligar) avisa o CRM que está rodando, mesmo sem nota nova;
// se o sinal parar, o CRM avisa o administrador (servidor desligado, tarefa parada).
//
// Arquivos do FKN (opcional): com --pasta-fkn "C:\CRM\FKN" o vigia também olha essa pasta e manda (produtos, contas a receber e, desde 2026-10-06, contas a pagar)
// ao CRM, assim que alguém salvar, a "Listagem cadastral de produtos" (estoque de Compras) e o
// "Contas a receber por cliente — em aberto", em CSV. Reconhece pelo conteúdo (o nome não
// importa); de cada tipo manda só o mais novo. Pode pôr mais de uma pasta separando com ";".
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSAO = '2026-10-06';
const SINAL_MS = 30 * 60 * 1000;

const AQUI = __dirname;
const CONFIG = path.join(AQUI, 'vigia-notas.json');
const ESTADO = path.join(AQUI, 'vigia-notas-estado.json');
const LOG = path.join(AQUI, 'vigia-notas.log');
const POR_ENVIO = 50;
const BYTES_POR_ENVIO = 8 * 1024 * 1024;
const ESPERA_ARQUIVO_MS = 15000; // arquivo mexido há menos que isso pode estar sendo gravado

// Trava de segurança (05/10/2026): no domingo 04/10 o vigia ficou aberto mas parado (depois de uma
// queda de internet), sem erro no log — e a tarefa do Windows não religa o que ainda está "rodando".
// Se passar TRAVADO_MS sem completar uma volta (ou um lote), ele registra e sai com erro; a tarefa
// (RestartCount + gatilho a cada 10 min) liga de novo. Nada se perde: o estado fica gravado.
const TRAVADO_MS = 20 * 60 * 1000;
let ultimoProgresso = Date.now();
const vivo = () => { ultimoProgresso = Date.now(); };

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
    intervaloSegundos: Number(arg('intervalo') || atual.intervaloSegundos || 60),
    pastaFkn: arg('pasta-fkn') != null ? arg('pasta-fkn') : atual.pastaFkn || ''
  };
  if (!/^https?:\/\/.+/.test(cfg.url) || cfg.chave.length < 32 || !cfg.pasta) {
    console.error('Informe --url (https://...supabase.co), --chave (do CRM) e --pasta.');
    process.exit(1);
  }
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
  registra('configurado: pasta ' + cfg.pasta + ', meses a partir de ' + cfg.desde + (cfg.pastaFkn ? ' · arquivos do FKN em ' + cfg.pastaFkn : ''));
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
  return chama(cfg, { arquivos: lote.map(a => ({ nome: a.rel, xml: a.xml })) });
}

async function chama(cfg, dados) {
  const corpo = JSON.stringify(dados);
  const r = await fetch(cfg.url + '/functions/v1/crm-notas', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-crm-chave': cfg.chave }, body: corpo, signal: AbortSignal.timeout(150000)
  });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch (e) { /* resposta não é JSON */ }
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + ((j && j.erro) || txt.slice(0, 200)));
  return j;
}

// Sinal de vida (no máximo a cada 30 min, ou já, se forcar): o CRM guarda a hora e o resumo.
async function sinal(cfg, estado, pendentes, forcar) {
  if (!forcar && Date.now() - (estado.ultimoSinal || 0) < SINAL_MS) return;
  try {
    await chama(cfg, { sinal: true, info: { versao: VERSAO, maquina: os.hostname(), pendentes, ultima_falha: estado.ultimaFalha || '' } });
    estado.ultimoSinal = Date.now();
    fs.writeFileSync(ESTADO, JSON.stringify(estado));
  } catch (e) { registra('sinal de vida não chegou ao CRM (tento de novo na próxima volta): ' + e.message); }
}

// ------------------------------------------------------------ arquivos do FKN
// Tipo pelo começo do arquivo (o FKN grava em Windows-1252; "latin1" basta para reconhecer).
function tipoFkn(buf) {
  const ini = buf.subarray(0, 4000).toString('latin1');
  if (/LISTAGEM CADASTRAL DE PRODUTOS/i.test(ini)) return 'produtos';
  if (/CONTAS A RECEBER/i.test(ini)) return 'receber';
  if (/CONTAS A PAGAR/i.test(ini)) return 'pagar';
  return null;
}
const NOME_FKN = { produtos: 'listagem de produtos', receber: 'contas a receber', pagar: 'contas a pagar' };
async function arquivosFkn(cfg, estado) {
  if (!cfg.pastaFkn) return;
  // Versão nova pode conhecer um relatório que a anterior pulou (ex.: contas a pagar, 06/10/2026):
  // ao trocar de versão, olha a pasta de novo uma vez (reenviar o mesmo retrato não muda nada).
  if (!estado.fkn || estado.fknVersao !== VERSAO) { estado.fkn = {}; estado.fknVersao = VERSAO; }
  const agora = Date.now(), maisNovo = {};
  for (const dir of String(cfg.pastaFkn).split(';').map(x => x.trim()).filter(Boolean)) {
    let itens;
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { registra('não consegui abrir a pasta do FKN ' + dir + ': ' + e.message); continue; }
    for (const i of itens) {
      if (!i.isFile() || !/\.(csv|txt)$/i.test(i.name)) continue;
      const caminho = path.join(dir, i.name);
      let st; try { st = fs.statSync(caminho); } catch (e) { continue; }
      const marca = st.size + ':' + Math.round(st.mtimeMs);
      if (estado.fkn[caminho] === marca || agora - st.mtimeMs < ESPERA_ARQUIVO_MS) continue;
      let buf; try { buf = fs.readFileSync(caminho); } catch (e) { registra('não li ' + caminho + ': ' + e.message); continue; }
      const tipo = tipoFkn(buf);
      if (!tipo) { estado.fkn[caminho] = marca; continue; } // outro CSV qualquer: não olha de novo
      if (!maisNovo[tipo] || st.mtimeMs > maisNovo[tipo].mtime) {
        if (maisNovo[tipo]) estado.fkn[maisNovo[tipo].caminho] = maisNovo[tipo].marca; // mais velho: pula
        maisNovo[tipo] = { caminho, marca, mtime: st.mtimeMs, buf, nome: i.name };
      } else estado.fkn[caminho] = marca;
    }
  }
  for (const tipo of Object.keys(maisNovo)) {
    const a = maisNovo[tipo];
    try {
      const r = await chama(cfg, { fkn: { nome: a.nome, base64: a.buf.toString('base64') } });
      estado.fkn[a.caminho] = a.marca;
      vivo();
      estado.ultimaFalha = '';
      estado.ultimoSinal = Date.now();
      registra('FKN: ' + NOME_FKN[tipo] + ' (' + a.nome + ') enviada ao CRM' + (r.produtos ? ': ' + r.produtos + ' linhas' : r.titulos != null ? ': ' + r.titulos + ' títulos' + (r.semCliente ? ', ' + r.semCliente + ' sem cliente no CRM' : '') : r.contas != null ? ': ' + r.contas + ' contas (' + r.novas + ' novas, ' + r.pagas + ' pagas)' : ''));
    } catch (e) {
      // Recusado pelo CRM (arquivo cortado, soma que não bate): não insiste até o arquivo mudar.
      if (/HTTP 422/.test(e.message)) estado.fkn[a.caminho] = a.marca;
      registra('FKN: ' + NOME_FKN[tipo] + ' não foi: ' + e.message);
      estado.ultimaFalha = new Date().toLocaleString('pt-BR') + ': FKN ' + NOME_FKN[tipo] + ': ' + e.message;
    }
  }
  fs.writeFileSync(ESTADO, JSON.stringify(estado));
}

async function umaVolta(forcarSinal) {
  const cfg = leJson(CONFIG, null);
  if (!cfg) { console.error('Configure antes: node vigia-notas.js --configurar --url ... --chave ... --pasta ...'); process.exit(1); }
  const estado = leJson(ESTADO, { enviados: {} });
  if (!estado.enviados) estado.enviados = {};
  try { await arquivosFkn(cfg, estado); } catch (e) { registra('FKN: erro: ' + e.message); }
  const agora = Date.now();
  const novos = [];
  for (const a of listaXml(cfg)) {
    let st;
    try { st = fs.statSync(a.caminho); } catch (e) { continue; }
    const marca = st.size + ':' + Math.round(st.mtimeMs);
    if (estado.enviados[a.rel] === marca || agora - st.mtimeMs < ESPERA_ARQUIVO_MS) continue;
    novos.push(Object.assign(a, { marca, tamanho: st.size }));
  }
  if (!novos.length) { await sinal(cfg, estado, 0, forcarSinal); return 0; }
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
      vivo();
      estado.ultimaFalha = '';
      estado.ultimoSinal = Date.now(); // entrega também é sinal de vida
      fs.writeFileSync(ESTADO, JSON.stringify(estado));
    } catch (e) {
      registra('falha ao enviar (tento de novo na próxima volta): ' + e.message);
      estado.ultimaFalha = new Date().toLocaleString('pt-BR') + ': ' + e.message;
      break;
    }
  }
  registra('enviados ' + enviados + ' · importadas ' + importadas + ' · fora (venda direta/externos) ' + fora + (erros ? ' · com erro ' + erros : ''));
  await sinal(cfg, estado, novos.length - enviados, forcarSinal);
  return enviados;
}

async function principal() {
  if (process.argv.includes('--configurar')) return configurar();
  if (process.argv.includes('--uma-vez')) { await umaVolta(); return; }
  const cfg = leJson(CONFIG, {});
  registra('vigia ligado (versão ' + VERSAO + '): ' + (cfg.pasta || '(sem pasta)') + (cfg.pastaFkn ? ' · FKN: ' + cfg.pastaFkn : ''));
  let primeira = true;
  setInterval(() => {
    const parado = Date.now() - ultimoProgresso;
    if (parado > TRAVADO_MS) {
      registra('vigia travado há ' + Math.round(parado / 60000) + ' min sem completar uma volta: saindo para a tarefa do Windows ligar de novo');
      process.exit(1);
    }
  }, 60 * 1000);
  for (;;) {
    try { await umaVolta(primeira); } catch (e) { registra('erro: ' + e.message); }
    vivo();
    primeira = false;
    await new Promise(r => setTimeout(r, (cfg.intervaloSegundos || 60) * 1000));
  }
}

if (require.main === module) principal();
module.exports = { listaXml, umaVolta, tipoFkn };
