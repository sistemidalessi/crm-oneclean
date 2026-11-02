#!/usr/bin/env node
/* CRM — Leads sugeridos (01/11/2026): separa da base aberta de CNPJ da Receita Federal só as empresas que interessam
   à prospecção e manda para o banco (tabela crm_prospec_base, pela Edge Function crm-prospeccao, ação "carga").

   A base é pública e gratuita (https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9, uma pasta por mês):
   Estabelecimentos0..9.zip, Empresas0..9.zip, Simples.zip e Cnaes.zip. Baixe os zips do mês numa pasta e rode:

     node ferramentas/prospeccao-receita.js separar <pasta> <saida.jsonl>
     CRM_CARGA_SENHA=... node ferramentas/prospeccao-receita.js enviar <saida.jsonl> <url da crm-prospeccao> <AAAA-MM>

   "separar" fica com: empresas ATIVAS de SP, das cidades de CIDADES, cuja atividade principal está em ATIVIDADES (os
   cinco segmentos) — sem MEI. Precisa do programa "unzip" (lê o zip sem descompactar no disco).
   "enviar" manda em lotes de 1.000; a senha de carga é de uso único (o hash fica em crm_interno.prospeccao_cfg) e nunca
   vai para o repositório. No fim, as linhas de cargas antigas são apagadas (empresa que fechou some da base). */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

// Códigos de município da RECEITA (não são os do IBGE): Municipios.zip
const CIDADES = {
  7075: 'SAO BERNARDO DO CAMPO', 7057: 'SANTO ANDRE', 7077: 'SAO CAETANO DO SUL', 6377: 'DIADEMA', 6689: 'MAUA',
  6967: 'RIBEIRAO PIRES', 6983: 'RIO GRANDE DA SERRA', 7107: 'SAO PAULO', 6477: 'GUARULHOS', 6789: 'OSASCO', 6415: 'FERRAZ DE VASCONCELOS'
};
// Atividade principal (CNAE, 7 dígitos) que entra na base: limpeza e facilities, condomínio, escola, saúde e indústria
// (a lista fina da indústria sai das atividades dos clientes, no banco).
const ATIVIDADE = /^(8121400|8111700|8129000|8112500|8511200|8512100|8513900|8520100|8610|8630|8640|8650|8711|1\d|2\d|3[0-3])/;

// Uma linha do CSV da Receita: separado por ";", todos os campos entre aspas, latin1.
function campos(linha) {
  const out = [];
  let i = 0;
  while (i < linha.length) {
    if (linha[i] === '"') {
      let j = i + 1, v = '';
      for (;;) {
        const k = linha.indexOf('"', j);
        if (k < 0) { v += linha.slice(j); i = linha.length; break; }
        if (linha[k + 1] === '"') { v += linha.slice(j, k + 1); j = k + 2; continue; }
        v += linha.slice(j, k); i = k + 1; break;
      }
      out.push(v);
      if (linha[i] === ';') i++;
    } else {
      const k = linha.indexOf(';', i);
      if (k < 0) { out.push(linha.slice(i)); break; }
      out.push(linha.slice(i, k)); i = k + 1;
      if (i === linha.length) out.push('');
    }
  }
  return out;
}

function linhasDoZip(arquivo, aCada) {
  return new Promise((ok, falha) => {
    const p = spawn('unzip', ['-p', arquivo]);
    p.stdout.setEncoding('latin1');
    const rl = readline.createInterface({ input: p.stdout, crlfDelay: Infinity });
    rl.on('line', l => { if (l) aCada(campos(l)); });
    rl.on('close', () => ok());
    p.on('error', falha);
    p.stderr.on('data', d => process.stderr.write(d));
  });
}

const data = s => (/^\d{8}$/.test(s) && s !== '00000000' ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : null);
const tel = (ddd, n) => { const d = String(ddd || '').replace(/\D/g, ''), t = String(n || '').replace(/\D/g, ''); return t.length >= 8 ? (d ? d.slice(-2) : '') + t : null; };
const limpa = s => { const v = String(s || '').replace(/\s+/g, ' ').trim(); return v || null; };

async function separar(pasta, saida) {
  const zips = p => fs.readdirSync(pasta).filter(f => p.test(f)).sort().map(f => path.join(pasta, f));
  const base = new Map();   // cnpj -> linha
  const porBasico = new Map();
  for (const z of zips(/^Estabelecimentos\d\.zip$/i)) {
    let lidas = 0;
    await linhasDoZip(z, c => {
      lidas++;
      if (c[19] !== 'SP' || c[5] !== '02' || !CIDADES[+c[20]] || !ATIVIDADE.test(c[11] || '')) return;
      const cnpj = (c[0] + c[1] + c[2]).toUpperCase();
      const end = [limpa([c[13], c[14]].join(' ')), limpa(c[15]), limpa(c[16])].filter(Boolean).join(', ');
      const l = { cnpj, basico: c[0].toUpperCase(), matriz: c[3] === '1', fantasia: limpa(c[4]), abertura: data(c[10]), cnae: c[11],
        cnaes_sec: c[12] ? c[12].split(',').map(s => s.trim()).filter(Boolean) : [], endereco: end || null, bairro: limpa(c[17]),
        cep: (c[18] || '').replace(/\D/g, '') || null, cidade: CIDADES[+c[20]], uf: 'SP', tel1: tel(c[21], c[22]), tel2: tel(c[23], c[24]),
        email: limpa(c[27]) ? limpa(c[27]).toLowerCase() : null };
      base.set(cnpj, l);
      if (!porBasico.has(l.basico)) porBasico.set(l.basico, []);
      porBasico.get(l.basico).push(l);
    });
    console.error(path.basename(z) + ': ' + lidas + ' linhas, ' + base.size + ' na base até aqui');
  }
  let mei = 0;
  for (const z of zips(/^Simples\.zip$/i)) {
    await linhasDoZip(z, c => { const l = porBasico.get((c[0] || '').toUpperCase()); if (l && c[4] === 'S') { l.forEach(x => { x.mei = true; }); mei++; } });
  }
  console.error('MEI: ' + mei);
  for (const z of zips(/^Empresas\d\.zip$/i)) {
    await linhasDoZip(z, c => {
      const l = porBasico.get((c[0] || '').toUpperCase());
      if (!l) return;
      const capital = Number(String(c[4] || '0').replace(/\./g, '').replace(',', '.')) || 0;
      l.forEach(x => { x.razao = limpa(c[1]); x.natureza = c[2] || null; x.capital = capital; x.porte = { '01': 'ME', '03': 'EPP', '05': 'Demais' }[c[5]] || null; });
    });
    console.error(path.basename(z) + ' lido');
  }
  const out = fs.createWriteStream(saida);
  let n = 0;
  for (const l of base.values()) {
    if (l.mei) continue;              // MEI fica de fora (compra muito pouco)
    out.write(JSON.stringify(l) + '\n'); n++;
  }
  out.end();
  // descrição das atividades
  const cnaes = {};
  for (const z of zips(/^Cnaes\.zip$/i)) await linhasDoZip(z, c => { cnaes[c[0]] = limpa(c[1]); });
  fs.writeFileSync(saida.replace(/\.jsonl$/, '') + '-cnaes.json', JSON.stringify(cnaes));
  console.error('gravadas: ' + n + ' empresas em ' + saida);
}

async function enviar(arq, url, carga) {
  const senha = process.env.CRM_CARGA_SENHA;
  if (!senha) throw new Error('falta CRM_CARGA_SENHA');
  const post = async corpo => {
    for (let t = 1; ; t++) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + senha }, body: JSON.stringify(corpo) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(r.status + ' ' + JSON.stringify(j));
        return j;
      } catch (e) { if (t >= 4) throw e; await new Promise(ok => setTimeout(ok, 2000 * t)); }
    }
  };
  const cnaesArq = arq.replace(/\.jsonl$/, '') + '-cnaes.json';
  if (fs.existsSync(cnaesArq)) {
    const c = JSON.parse(fs.readFileSync(cnaesArq, 'utf8'));
    console.error('atividades: ' + JSON.stringify(await post({ acao: 'carga_cnaes', linhas: Object.entries(c).map(([codigo, descricao]) => ({ codigo, descricao })) })));
  }
  const rl = readline.createInterface({ input: fs.createReadStream(arq), crlfDelay: Infinity });
  let lote = [], total = 0;
  for await (const l of rl) {
    if (!l) continue;
    lote.push(JSON.parse(l));
    if (lote.length === 1000) { await post({ acao: 'carga', carga, linhas: lote }); total += lote.length; lote = []; if (total % 20000 === 0) console.error('enviadas ' + total); }
  }
  if (lote.length) { await post({ acao: 'carga', carga, linhas: lote }); total += lote.length; }
  console.error('enviadas ' + total + '; fechando a carga ' + carga);
  console.error(JSON.stringify(await post({ acao: 'carga_fim', carga })));
}

if (require.main === module) {
  const [cmd, a, b, c] = process.argv.slice(2);
  (cmd === 'separar' ? separar(a, b) : cmd === 'enviar' ? enviar(a, b, c) : Promise.reject(new Error('use: separar <pasta> <saida.jsonl> | enviar <arquivo.jsonl> <url> <AAAA-MM>')))
    .catch(e => { console.error(e.message || e); process.exit(1); });
}
module.exports = { campos };
