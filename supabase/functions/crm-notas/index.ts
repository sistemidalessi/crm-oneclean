// Edge Function: recebe os XML de NF-e do vigia da pasta (ferramentas/vigia-notas.js) e importa
// com as MESMAS regras da importação manual (nfe.js): só as notas da equipe
// (vendedor escrito na nota; sem ele, a carteira do cliente), completa o cadastro do cliente e não
// duplica (a chave de 44 dígitos é única). Quem chama não faz login: manda a chave de integração
// gerada em Configurações → Integrações, que só serve para isto. Aqui guardamos só o hash dela.
//
// As regras não são copiadas para cá: a função baixa regras.js e nfe.js do GitHub numa versão
// FIXA (commit abaixo) e confere o SHA-256 de cada um antes de usar — é garantidamente o mesmo
// código do site. Depois de mexer em regras.js ou nfe.js: commit + push, depois
//   node ferramentas/fixa-motor-notas.js     (atualiza COMMIT e HASHES aqui)
// e publicar de novo esta função. O teste testes/motor.test.js avisa se esquecer.
// Deploy: verify_jwt DESLIGADO (a chave de integração é conferida aqui).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const COMMIT = '4526f052671bcf3d74d21d5f6c84d6cabbfd977b';
const HASHES: Record<string, string> = { 'regras.js': '75cc68047a16ea7f000bce702258430417d91eec83cd1f2c860453962963a3e6', 'nfe.js': '789bdfc637d82ec5dfaac7e8046c20892c9949da487d381e0c7e47e3ea3641a6' };
const FONTE = 'https://raw.githubusercontent.com/sistemidalessi/crm-oneclean/' + COMMIT + '/';

// deno-lint-ignore no-explicit-any
let N: any = null;
async function carregaMotor() {
  if (N) return N;
  const codigo: Record<string, string> = {};
  for (const arq of Object.keys(HASHES)) {
    const r = await fetch(FONTE + arq);
    if (!r.ok) throw new Error('não baixou ' + arq + ' (' + r.status + ')');
    codigo[arq] = await r.text();
    if (await sha256(codigo[arq]) !== HASHES[arq]) throw new Error(arq + ' não confere com a versão fixada');
  }
  // regras.js e nfe.js são scripts "clássicos" (window.CRMRegras / window.CRMNfe).
  // deno-lint-ignore no-explicit-any
  const g: any = {};
  new Function(codigo['regras.js']).call(g);
  // deno-lint-ignore no-explicit-any
  const gt = globalThis as any;
  gt.CRMRegras = g.CRMRegras;
  gt.CRMDados = { uuid: () => crypto.randomUUID() };
  new Function(codigo['nfe.js'])();
  N = gt.CRMNfe;
  return N;
}

const MAX_ARQUIVOS = 60;
const MAX_BYTES = 20 * 1024 * 1024;
const LOTE = 500;

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// deno-lint-ignore no-explicit-any
async function tudo(db: any, tabela: string, colunas: string) {
  const out: unknown[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.from(tabela).select(colunas).order('id').range(de, de + 999);
    if (error) throw new Error(tabela + ': ' + error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  const chave = req.headers.get('x-crm-chave') ?? '';
  if (chave.length < 32) return resposta(401, { erro: 'chave de integração ausente' });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return resposta(413, { erro: 'lote grande demais' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: integ } = await db.from('crm_integracoes').select('id, nome, filtro, ativo').eq('token_hash', await sha256(chave)).maybeSingle();
  if (!integ || !integ.ativo) return resposta(401, { erro: 'chave inválida ou desativada' });

  let corpo: { arquivos?: { nome?: string; xml?: string }[] };
  try { corpo = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  const arquivos = Array.isArray(corpo.arquivos) ? corpo.arquivos : [];
  if (arquivos.length > MAX_ARQUIVOS) return resposta(413, { erro: 'no máximo ' + MAX_ARQUIVOS + ' arquivos por envio' });

  try {
    const N = await carregaMotor();
    const lidos = arquivos.map(a => ({ nome: String(a.nome ?? '').slice(0, 200), doc: N.lerXml(String(a.xml ?? '')) }));
    const docs = lidos.map(l => l.doc).filter(Boolean);
    const chaves = [...new Set(docs.map((d: { chave: string }) => d.chave))];

    // Só o que o planejador precisa (sem carregar o CRM inteiro).
    const [empresas, produtos, opcoes, usuarios, notas] = await Promise.all([
      tudo(db, 'crm_empresas', 'id,nome,razao_social,cnpj,telefone,whatsapp,email,cep,logradouro,numero,complemento,bairro,cidade,uf,situacao,responsavel_id,segmento'),
      tudo(db, 'crm_produtos', 'id,nome,codigo'),
      db.from('crm_opcoes').select('id,tipo,nome').eq('tipo', 'segmento').then((r: { data: unknown[] }) => r.data || []),
      db.from('crm_usuarios').select('user_id,nome,ativo').then((r: { data: unknown[] }) => r.data || []),
      chaves.length ? db.from('crm_notas').select('id,chave,cancelada').in('chave', chaves).then((r: { data: unknown[] }) => r.data || []) : []
    ]);
    const plano = N.planeja({ empresas, produtos, opcoes, usuarios, notas }, docs, { filtro: integ.filtro, cadastrarProdutos: true });

    // Grava na mesma ordem da importação manual; lote recusado é regravado um a um.
    const erros: string[] = [];
    const falhou = new Set<string>();
    for (const t of ['opcoes', 'produtos', 'empresas', 'notas', 'nota_itens']) {
      const lista = plano.criar[t] || [];
      for (let i = 0; i < lista.length; i += LOTE) {
        const lote = lista.slice(i, i + LOTE);
        const { error } = await db.from('crm_' + t).insert(lote, { defaultToNull: false });
        if (!error) continue;
        for (const o of lote) {
          const { error: e1 } = await db.from('crm_' + t).insert([o], { defaultToNull: false });
          if (e1) { erros.push(t + ' ' + (o.nome || o.numero || o.descricao || o.id) + ': ' + e1.message); falhou.add(o.id); }
        }
      }
    }
    for (const a of plano.atualizar) {
      const { error } = await db.from('crm_' + a.tabela).update(a.patch).eq('id', a.id);
      if (error) erros.push(a.tabela + ' ' + a.id + ': ' + error.message);
    }

    // Situação de cada arquivo, para o vigia registrar.
    const criadas = new Map(plano.criar.notas.map((n: { chave: string; id: string }) => [n.chave, n.id]));
    const foraPor = new Map(plano.ignorados.map((x: { registro: { chave: string }; motivo: string }) => [x.registro.chave, x.motivo]));
    const jaTinha = new Set((notas as { chave: string }[]).map(n => n.chave));
    const situacao = lidos.map(l => {
      const d = l.doc as { tipo: string; chave: string } | null;
      if (!d) return { nome: l.nome, situacao: 'não é NF-e (ignorado)' };
      if (d.tipo === 'cancelamento') return { nome: l.nome, situacao: 'cancelamento', chave: d.chave };
      if (criadas.has(d.chave)) return { nome: l.nome, situacao: falhou.has(criadas.get(d.chave) as string) ? 'erro' : 'importada', chave: d.chave };
      if (jaTinha.has(d.chave)) return { nome: l.nome, situacao: 'já importada', chave: d.chave };
      if (foraPor.has(d.chave)) return { nome: l.nome, situacao: 'fora: ' + foraPor.get(d.chave), chave: d.chave };
      return { nome: l.nome, situacao: 'repetida no envio', chave: d.chave };
    });
    const r = plano.resumoNotas;
    await db.from('crm_integracao_log').insert({
      integracao_id: integ.id, arquivos: arquivos.length, notas_novas: r.novas, valor: r.valor, fora: r.foraDoFiltro, erros: erros.length,
      resumo: { resumo: r, vendedores: plano.vendedoresNotas, erros: erros.slice(0, 50) }
    });
    await db.from('crm_integracoes').update({ ultimo_uso: new Date().toISOString() }).eq('id', integ.id);
    return resposta(200, { ok: true, resumo: r, arquivos: situacao, erros });
  } catch (e) {
    return resposta(500, { erro: 'falha ao importar: ' + (e instanceof Error ? e.message : String(e)) });
  }
});
