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
// Também recebe do vigia os CSV salvos pelo FKN ({fkn: {nome, base64}}): a listagem de produtos
// (estoque de Compras) e o contas a receber — lidos por fkn.js, o mesmo leitor da tela.
// Deploy: verify_jwt DESLIGADO (a chave de integração é conferida aqui).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const COMMIT = 'c4ba9f752be239bc895d5881b7b5b1250316854c';
const HASHES: Record<string, string> = { 'regras.js': '1cfa5b7cce51627d4986de104fe54145f2b9dee5155676db88cc318ae1d00756', 'nfe.js': 'fdb8004372545a211d336ae6fed1080c093e882b45404a67e58a26e4c643ab96', 'fkn.js': '05587429d00750ffbcfd95c10693068e61cbbd8508edde4ad4d8118abbdcf6ea' };
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
  new Function(codigo['fkn.js'])();
  N = gt.CRMNfe;
  K = gt.CRMFkn;
  return N;
}
// deno-lint-ignore no-explicit-any
let K: any = null;

// Arquivo do FKN que o vigia mandou: reconhece pelo conteúdo e troca o retrato (estoque ou
// títulos em aberto). Travas: produtos com menos da metade do que já existe, ou contas a receber
// cuja soma não bate com o total geral, são recusados (arquivo cortado não apaga o que existe).
// deno-lint-ignore no-explicit-any
async function arquivoFkn(db: any, integ: { id: string }, f: { nome?: string; base64?: string }) {
  await carregaMotor();
  const bytes = Uint8Array.from(atob(String(f.base64 || '')), c => c.charCodeAt(0));
  let txt: string;
  try { txt = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { txt = new TextDecoder('windows-1252').decode(bytes); }
  txt = txt.replace(/^\uFEFF/, '');
  const nome = String(f.nome || '').slice(0, 200);
  const agora = new Date().toISOString();
  const grava = async (tabela: string, linhas: Record<string, unknown>[], conflito: string) => {
    for (let i = 0; i < linhas.length; i += LOTE) {
      const { error } = await db.from(tabela).upsert(linhas.slice(i, i + LOTE).map(x => Object.assign({}, x, { atualizado_em: agora })), { onConflict: conflito, defaultToNull: false });
      if (error) throw new Error(tabela + ': ' + error.message);
    }
    const { error } = await db.from(tabela).delete().lt('atualizado_em', agora);
    if (error) throw new Error(tabela + ' (limpeza): ' + error.message);
  };
  const registra = async (texto: string, qtd: number, valor: number) => {
    await db.from('crm_integracao_log').insert({ integracao_id: integ.id, arquivos: 1, notas_novas: 0, valor, fora: 0, erros: 0, resumo: { fkn: texto, arquivo: nome, qtd } });
    const ag = new Date().toISOString();
    await db.from('crm_integracoes').update({ ultimo_uso: ag, ultimo_sinal: ag }).eq('id', integ.id); // entrega também é sinal de vida
  };

  // Recusa: não troca nada, registra o motivo (aparece em Integrações e no lembrete de Compras).
  const recusa = async (tipo: string, motivos: string[]) => {
    const texto = motivos.join('; ');
    await db.from('crm_integracao_log').insert({ integracao_id: integ.id, arquivos: 1, notas_novas: 0, valor: 0, fora: 0, erros: 1,
      resumo: { fkn: (tipo === 'produtos' ? 'Listagem de produtos' : 'Contas a receber') + ' do FKN recusada: ' + texto, fkn_recusa: texto, fkn_tipo: tipo, arquivo: nome } });
    return resposta(422, { erro: texto });
  };

  if (K.ehListagemProdutos(txt)) {
    const conf = K.conferirListagemProdutos(txt);
    if (conf.recusa.length) return recusa('produtos', conf.recusa);
    const lista = K.lerListagemProdutos(txt);
    const { count } = await db.from('crm_estoque').select('codigo', { count: 'exact', head: true });
    if (count && lista.length < count / 2) return recusa('produtos', ['veio com ' + lista.length + ' produtos (o CRM tem ' + count + '): confira se nenhuma linha, família ou fornecedor ficou filtrado e salve com "Tudo"']);
    await grava('crm_estoque', lista, 'codigo');
    const valor = lista.reduce((s: number, x: { custo_total: number }) => s + (x.custo_total || 0), 0);
    await registra('Listagem de produtos do FKN: ' + lista.length + ' linhas' + (conf.avisos.length ? ' (atenção: ' + conf.avisos.join('; ') + ')' : ''), lista.length, valor);
    return resposta(200, { ok: true, fkn: 'produtos', produtos: lista.length });
  }
  if (K.ehContasReceber(txt)) {
    let lido;
    try { lido = K.lerContasReceber(txt); } catch (e) { return recusa('receber', [e instanceof Error ? e.message : String(e)]); }
    const conf = K.conferirContasReceber(txt, lido);
    if (conf.recusa.length) return recusa('receber', conf.recusa);
    const { count } = await db.from('crm_titulos').select('duplicata', { count: 'exact', head: true });
    if (count && count >= 20 && lido.titulos.length < count * 0.4) return recusa('receber', ['veio com ' + lido.titulos.length + ' títulos (o CRM tem ' + count + '): confira Cliente 0, Portador 0, Situação GERAL e a filial']);
    const [empresas, notas] = await Promise.all([tudo(db, 'crm_empresas', 'id,cnpj,grupo_id'), tudo(db, 'crm_notas', 'id,numero,empresa_id,cliente_doc')]);
    const porEmp = new Map<string, unknown[]>();
    (notas as { empresa_id: string }[]).forEach(n => { if (n.empresa_id) { if (!porEmp.has(n.empresa_id)) porEmp.set(n.empresa_id, []); porEmp.get(n.empresa_id)!.push(n); } });
    const lig = K.ligaEmpresas(lido.titulos, { empresas, notas }, { porEmpresa: { notas: porEmp } });
    await grava('crm_titulos', lig.titulos, 'duplicata');
    await registra('Contas a receber do FKN: ' + lig.titulos.length + ' títulos de ' + lido.clientes + ' clientes' + (lig.sem ? ' (' + lig.sem + ' sem cliente no CRM)' : ''), lig.titulos.length, lido.soma);
    return resposta(200, { ok: true, fkn: 'receber', titulos: lig.titulos.length, semCliente: lig.sem });
  }
  return resposta(422, { erro: 'arquivo do FKN não reconhecido (só a listagem de produtos e o contas a receber, em CSV)' });
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

  let corpo: { arquivos?: { nome?: string; xml?: string }[]; sinal?: boolean; info?: Record<string, unknown>; fkn?: { nome?: string; base64?: string } };
  try { corpo = await req.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }

  // Sinal de vida do vigia (a cada 30 min, mesmo sem nota): guarda a hora e um resumo curto.
  if (corpo.sinal === true) {
    const i = corpo.info ?? {};
    const sinal = { versao: String(i.versao ?? '').slice(0, 20), maquina: String(i.maquina ?? '').slice(0, 60),
      pendentes: Math.max(0, Math.min(1e6, Number(i.pendentes) || 0)), ultima_falha: String(i.ultima_falha ?? '').slice(0, 300) };
    const { error } = await db.from('crm_integracoes').update({ ultimo_sinal: new Date().toISOString(), sinal }).eq('id', integ.id);
    if (error) return resposta(500, { erro: 'sinal não gravado: ' + error.message });
    return resposta(200, { ok: true, sinal: true });
  }
  if (corpo.fkn) {
    try { return await arquivoFkn(db, integ, corpo.fkn); } catch (e) { return resposta(500, { erro: 'falha no arquivo do FKN: ' + (e instanceof Error ? e.message : String(e)) }); }
  }
  const arquivos = Array.isArray(corpo.arquivos) ? corpo.arquivos : [];
  if (arquivos.length > MAX_ARQUIVOS) return resposta(413, { erro: 'no máximo ' + MAX_ARQUIVOS + ' arquivos por envio' });

  try {
    const N = await carregaMotor();
    const lidos = arquivos.map(a => ({ nome: String(a.nome ?? '').slice(0, 200), doc: N.lerXml(String(a.xml ?? '')) }));
    const docs = lidos.map(l => l.doc).filter(Boolean);
    const chaves = [...new Set(docs.map((d: { chave: string }) => d.chave))];

    // Só o que o planejador precisa (sem carregar o CRM inteiro).
    const [empresas, produtos, opcoes, usuarios, contatos, notas, cfg] = await Promise.all([
      tudo(db, 'crm_empresas', 'id,nome,razao_social,cnpj,telefone,whatsapp,email,cep,logradouro,numero,complemento,bairro,cidade,uf,situacao,responsavel_id,segmento,grupo_id'),
      tudo(db, 'crm_produtos', 'id,nome,codigo'),
      db.from('crm_opcoes').select('id,tipo,nome').eq('tipo', 'segmento').then((r: { data: unknown[] }) => r.data || []),
      db.from('crm_usuarios').select('user_id,nome,ativo,nomes_nota').then((r: { data: unknown[] }) => r.data || []),
      tudo(db, 'crm_contatos', 'id,empresa_id,email'),
      chaves.length ? db.from('crm_notas').select('id,chave,cancelada,vendedor_nome').in('chave', chaves).then((r: { data: unknown[] }) => r.data || []) : [],
      db.from('crm_config').select('dados').eq('id', 1).maybeSingle().then((r: { data: { dados?: Record<string, unknown> } | null }) => (r.data && r.data.dados) || {})
    ]);
    const exVendedores = String(cfg.vendedores_antigos || '').split(',');
    const plano = N.planeja({ empresas, produtos, opcoes, usuarios, contatos, notas }, docs, { filtro: integ.filtro, cadastrarProdutos: true, exVendedores });

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
    const agora = new Date().toISOString();
    await db.from('crm_integracoes').update({ ultimo_uso: agora, ultimo_sinal: agora }).eq('id', integ.id);
    return resposta(200, { ok: true, resumo: r, arquivos: situacao, erros });
  } catch (e) {
    return resposta(500, { erro: 'falha ao importar: ' + (e instanceof Error ? e.message : String(e)) });
  }
});
