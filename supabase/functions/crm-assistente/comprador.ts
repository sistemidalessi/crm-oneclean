// O COMPRADOR SÊNIOR da conversa (19/10/2026, pedido do Anderson: "quero a inteligência artificial funcionando forte
// na página de compras… um comprador super mega profissional"). Aqui ficam o manual (vai junto do system quando a
// pergunta é de Compras, Estoque ou Concorrentes, e na análise do dia) e as ferramentas que só o comprador e o
// administrador recebem. Todas só leem, com o login de quem pergunta (a RLS de sempre).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

export const COMPRADOR = `MANUAL DO COMPRADOR SÊNIOR (vale quando a pergunta é de compra, reposição, estoque, fornecedor ou preço).
Você é o comprador sênior de uma distribuidora: o estoque é dinheiro parado; a falta é venda perdida e cliente
que vai para o concorrente. Seu trabalho é equilibrar as duas coisas com números.

Como decidir o que comprar:
- Use "pedido_sugerido": ele já faz a conta (venda média por dia dos últimos 90 dias × (dias de cobertura + prazo do
  fornecedor), com piso no mínimo do FKN, menos o saldo e o que já está pedido) e junta por fornecedor.
- Ordem de prioridade: 1) o que acaba antes de o pedido chegar (urgente), 2) curva A (os itens que fazem 80% da
  venda) abaixo do mínimo, 3) o resto. Curva C parada não se repõe por reflexo: confirme se ainda vende.
- Feche o pedido POR FORNECEDOR: some o custo, compare com o pedido mínimo e o frete. Faltou pouco para o mínimo ou
  para o CIF? Sugira completar com itens do mesmo fornecedor que vão precisar em breve (cobertura curta), nunca com
  item parado. Se o pedido não chega ao mínimo e nada é urgente, sugira esperar e juntar.
- Dia de pedido: se hoje é o dia do fornecedor, diga. Prazo sem cadastro é estimado (7 dias): avise.
- Caixa fechada: arredonde para caixas inteiras quando o fornecedor vende por caixa (o "caixas" da ferramenta).
- Já pedido ao fornecedor conta como estoque a caminho; não peça de novo.

Preço e margem:
- Custo que subiu ("precos_compra"): veja se o preço de venda acompanhou ("margens"). Item com margem abaixo da
  mínima: proponha o novo preço de venda (custo ÷ (1 − margem mínima)) ou negociar com o fornecedor.
- Mesmo produto de mais de um fornecedor: compare o último custo unitário (com IPI, ST e frete) e o prazo.
- Concorrentes ("concorrentes"): só o que o comprador lançou; nunca invente preço de concorrente. Nosso preço muito
  acima num item da curva A = risco de perder o cliente; muito abaixo = margem deixada na mesa.

Giro (24/10/2026): o "pedido_sugerido" já tira da sugestão o item SEM GIRO (vendeu em menos de 3 notas ou para menos
de 2 clientes em 90 dias), mesmo abaixo do mínimo do FKN; só fica o que já foi vendido sem estoque. Não sugira de volta
um item da lista "sem_giro_fora_da_sugestao": no máximo, diga que o mínimo do FKN dele deveria baixar.

Preço de compra ("preco_negociar"): para os itens do pedido, a conta já vem pronta do sistema: "comecar_em" (o menor
custo pago em 180 dias, com o fornecedor), a média, cada fornecedor e "negociar_ate" (o menor teto entre a margem
mínima sobre a tabela e o preço do concorrente). Diga "comece pedindo R$ X (o que a Y cobrou em DD/MM) e não passe de
R$ Z". Item com "ultimo_acima_do_teto": negociar ou trocar de fornecedor. Nunca invente preço: sem nota de compra,
diga que não há histórico.

Vencimento ("vencimento_sugerido"): para o total de cada pedido, o sistema diz a partir de que dia o pagamento cabe no
caixa. Você recebe SÓ a data (nunca saldo nem valor do caixa) e repassa só ela: "peça vencimento a partir de 15/11".
Se vier sem data, diga para negociar parcelado ou adiar.

Estoque parado ("estoque_parado"): sem venda há 90 dias e com dinheiro empatado. Sugira oferta (tela Ofertas),
devolução/troca com o fornecedor ou parar de repor. Diga o valor parado.

Notas de compra ("notas_de_compra"): o que chegou e falta dar entrada, o que está aguardando, a nota que parece
despesa (não é mercadoria) e fornecedor que nunca vendeu para a empresa (conferir antes de dar ciência).

Como responder:
- Comece pela decisão ("Peça hoje à X: R$ 2.340 em 6 itens"), depois os números que importam, um item por linha com
  o porquê curto (ex.: "cobertura 3 dias, prazo 7"). No fim, o próximo passo na tela (Compras → Pedido por
  fornecedor → Exportar pedido; Estoque → Notas de compra; Ofertas).
- Números só das ferramentas. Se a ferramenta não trouxer, diga que não tem o dado.`;

export const PERGUNTA_ANALISE = `Faça a ANÁLISE DE COMPRAS DE HOJE para o comprador, como o comprador sênior do manual.
Consulte "pedido_sugerido" (todos os fornecedores), "notas_de_compra", "precos_compra" (termo vazio) e "estoque_parado".
Para os 2 fornecedores mais urgentes, consulte também "preco_negociar" (os itens de maior valor do pedido) e
"vencimento_sugerido" (o total do pedido).
Responda em no máximo 14 linhas, nesta ordem:
1) Pedir hoje: cada fornecedor com urgência (nome, valor, quantos itens, se chega ao mínimo e o item mais crítico),
   com o vencimento sugerido e, para o item de maior valor, "comece em R$ X e não passe de R$ Z".
2) Sem giro: quantos itens ficaram fora da sugestão (e 2 exemplos), se houver.
3) Notas de compra: o que já chegou e falta dar entrada; despesa para tirar da lista.
4) Custo que subiu e margem a revisar (até 3 itens).
5) Estoque parado: o valor e os 2 maiores.
Se uma parte não tiver nada, pule. Sem introdução.`;

// deno-lint-ignore no-explicit-any
type Linha = Record<string, any>;
type Ctx = { u: SupabaseClient; papel: string; meuId: string; hoje: string };
type Ajuda = {
  tudo: <T>(q: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>, max?: number) => Promise<T[]>;
  obj: (props: Record<string, unknown>, req: string[]) => Record<string, unknown>;
  n2: (v: unknown) => number;
  normaliza: (s: unknown) => string;
  somaDias: (iso: string, d: number) => string;
};

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
// item com giro: saiu em pelo menos GIRO_NOTAS notas e para pelo menos GIRO_CLIENTES clientes nos últimos 90 dias
const GIRO_NOTAS = 3, GIRO_CLIENTES = 2;
const base = (cod: unknown) => String(cod || '').replace(/\.\d+$/, '');
const un = (u: unknown) => String(u || '').trim().toUpperCase();

// Igual a estoque.js pareceDespesa: combustível (NCM 2710/2711/2207), nota de cupom de posto (5929/6929), CFOP de
// combustível ou de serviço em todos os itens.
const CFOP_DESPESA: Record<number, string> = { 5929: 'nota de cupom fiscal (posto)', 6929: 'nota de cupom fiscal (posto)', 5655: 'combustível', 5656: 'combustível', 5667: 'combustível',
  6655: 'combustível', 6656: 'combustível', 6667: 'combustível', 5933: 'serviço', 6933: 'serviço' };
function pareceDespesa(itens: Linha[]) {
  if (!itens.length) return null;
  const m = itens.map(it => (/^(2710|2711|2207)/.test(String(it.ncm || '')) ? 'combustível' : CFOP_DESPESA[Number(it.cfop)] || null));
  return m.every(Boolean) ? (m.includes('combustível') ? 'combustível' : m[0]) : null;
}

export function ferramentasComprador(h: Ajuda) {
  const { tudo, obj, n2, normaliza, somaDias } = h;
  // Base comum: listagem do FKN (sem as caixas), cadastro de fornecedores, troca de fornecedor feita no CRM, fator da
  // caixa e a venda dos últimos 90 dias (a caixa vendida com o código da unidade vira unidades pelo fator).
  async function dados(c: Ctx) {
    const desde = somaDias(c.hoje, -90);
    const [est, fornR, trocasR, unisR, cfgR, it] = await Promise.all([
      tudo<Linha>((a, b) => c.u.from('crm_estoque').select('codigo, descricao, unidade, linha, fornecedor, fornecedor_cod, quantidade, estoque_atual, estoque_min, estoque_max, pend_fornecedor, custo_compra, custo_unit, custo_total, preco_venda, ult_entrada, ult_saida, situacao').range(a, b), 8000),
      c.u.from('crm_fornecedores').select('codigo, nome, prazo_dias, pedido_minimo, frete, frete_cif_acima, dias_pedido, ativo'),
      c.u.from('crm_produto_fornecedor').select('codigo, fornecedor').not('fornecedor', 'is', null),
      c.u.from('crm_estoque_unidades').select('codigo, unidade, fator'),
      c.u.from('crm_config').select('dados').eq('id', 1).maybeSingle(),
      tudo<Linha>((a, b) => c.u.from('crm_nota_itens').select('codigo, unidade, quantidade, valor_total, nota_id, crm_notas!inner(emitida_em, cancelada, empresa_id, cliente_doc)').eq('crm_notas.cancelada', false).gte('crm_notas.emitida_em', desde).range(a, b), 40000)
    ]);
    const fator = new Map(((unisR.data || []) as Linha[]).map(x => [x.codigo + '|' + un(x.unidade), Number(x.fator) || 1]));
    // giro (24/10/2026, plano do CEO: "não sugerir compra de item sem giro"): em quantas notas e para quantos clientes saiu
    const venda = new Map<string, { q: number; v: number; notas: Set<string>; clientes: Set<string> }>();
    it.forEach(x => {
      const k = base(x.codigo), f = fator.get(k + '|' + un(x.unidade)) || 1, a = venda.get(k) || { q: 0, v: 0, notas: new Set<string>(), clientes: new Set<string>() };
      a.q += Number(x.quantidade || 0) * f; a.v += Number(x.valor_total || 0);
      if (x.nota_id) a.notas.add(String(x.nota_id));
      const cli = x.crm_notas && (x.crm_notas.empresa_id || x.crm_notas.cliente_doc); if (cli) a.clientes.add(String(cli));
      venda.set(k, a);
    });
    const caixa = new Map<string, number>();
    ((unisR.data || []) as Linha[]).forEach(x => { if (un(x.unidade) === 'CX' && Number(x.fator) > 1) caixa.set(x.codigo, Number(x.fator)); });
    const cfg = ((cfgR.data as Linha | null) || {}).dados || {};
    const margemMin = cfg.margem_minima != null && cfg.margem_minima !== '' ? Number(cfg.margem_minima) : 23;
    // curva ABC pela venda em R$ dos 90 dias
    const total = [...venda.values()].reduce((s, x) => s + x.v, 0);
    const abc = new Map<string, string>(); let acum = 0;
    [...venda.entries()].sort((a, b) => b[1].v - a[1].v).forEach(([k, x]) => { const antes = total ? acum / total : 1; acum += x.v; abc.set(k, x.v <= 0 ? 'C' : antes < 0.8 ? 'A' : antes < 0.95 ? 'B' : 'C'); });
    const fMap = new Map(((fornR.data || []) as Linha[]).map(f => [String(f.codigo), f]));
    const tMap = new Map(((trocasR.data || []) as Linha[]).map(t => [t.codigo, t.fornecedor]));
    const produtos = est.filter(e => !/\.\d+$/.test(e.codigo) && e.situacao !== 'INATIVO').map(e => {
      let cod = tMap.get(e.codigo) || e.fornecedor_cod || null, nome = e.fornecedor || null;
      if (tMap.get(e.codigo)) nome = (fMap.get(cod) || {}).nome || cod;
      const fc = cod ? fMap.get(String(cod)) : null;
      if (fc && fc.ativo === false && !tMap.get(e.codigo)) { cod = null; nome = null; }   // "não compramos" (cadastro)
      const vd = venda.get(e.codigo) || { q: 0, v: 0, notas: new Set<string>(), clientes: new Set<string>() };
      return Object.assign({}, e, { forn_cod: cod, forn_nome: nome, forn: cod ? fMap.get(String(cod)) || null : null, venda90: vd.q, valor90: vd.v, dia: vd.q / 90,
        vezes90: vd.notas.size, clientes90: vd.clientes.size,
        abc: abc.get(e.codigo) || 'C', custo: Number(e.custo_compra) > 0 ? Number(e.custo_compra) : Number(e.custo_unit) || 0, caixa: caixa.get(e.codigo) || null });
    });
    return { produtos, margemMin };
  }

  return {
    pedido_sugerido: {
      papeis: ['admin', 'comprador'],
      def: { name: 'pedido_sugerido', description: 'O pedido de compra sugerido, já juntado por fornecedor: para cada produto que precisa, a venda média por dia (90 dias), a cobertura atual em dias, curva ABC, saldo, mínimo, já pedido, quanto comprar (cobre os dias pedidos + o prazo do fornecedor, com piso no mínimo do FKN), caixas, custo e se é urgente (acaba antes de o pedido chegar ou está abaixo do mínimo). Para cada fornecedor: total, pedido mínimo e quanto falta, frete, prazo e se hoje é dia de pedido. Os fornecedores com urgência primeiro.', strict: true,
        input_schema: obj({ fornecedor: { type: 'string', description: 'parte do nome ou o código do fornecedor; vazio = todos' }, dias: { type: 'integer', description: 'dias de estoque que o pedido deve cobrir além do prazo de entrega (0 = 30)' } }, ['fornecedor', 'dias']) },
      async roda(c: Ctx, i: Linha) {
        const { produtos } = await dados(c);
        const dias = Number(i.dias) > 0 ? Math.min(120, Number(i.dias)) : 30, f = normaliza(i.fornecedor);
        const hojeDia = new Date(c.hoje + 'T12:00:00Z').getUTCDay();
        const grupos = new Map<string, Linha>(), semGiro: Linha[] = [];
        produtos.forEach(p => {
          if (f && !normaliza((p.forn_cod || '') + ' ' + (p.forn_nome || '')).includes(f)) return;
          // saldo negativo (vendido sem estoque) entra negativo: o que já foi vendido sai do que está pedido (20/10/2026)
          const saldo = Number(p.quantidade || 0), pend = Number(p.pend_fornecedor || 0), min = Number(p.estoque_min || 0);
          const prazo = p.forn && p.forn.prazo_dias != null ? Number(p.forn.prazo_dias) : 7;
          if (!(p.dia > 0) && !(min > 0 && saldo + pend < min) && !(saldo + pend < 0)) return;
          const alvo = Math.max(p.dia * (dias + prazo), min), comprar = Math.ceil(alvo - saldo - pend - 1e-9);
          if (comprar <= 0) return;
          // sem giro (vendeu em menos de GIRO_NOTAS notas ou para menos de GIRO_CLIENTES clientes em 90 dias): fora da
          // sugestão, mesmo abaixo do mínimo do FKN; só entra o que já foi vendido sem estoque (saldo negativo)
          if (saldo + pend >= 0 && (p.vezes90 < GIRO_NOTAS || p.clientes90 < GIRO_CLIENTES)) {
            semGiro.push({ codigo: p.codigo, descricao: p.descricao, fornecedor: p.forn_nome, saldo: n2(saldo), minimo: n2(min), notas_90d: p.vezes90, clientes_90d: p.clientes90 });
            return;
          }
          const urgente = (p.dia > 0 && saldo + pend <= p.dia * prazo) || (min > 0 && saldo < min) || saldo < 0;
          const k = p.forn_cod || '';
          if (!grupos.has(k)) grupos.set(k, { codigo: k || null, nome: p.forn_nome || 'Sem fornecedor (definir em Compras)', cad: p.forn, prazo, itens: [], total: 0, urgentes: 0, sem_custo: 0 });
          const g = grupos.get(k)!;
          const qtd = p.caixa ? Math.ceil(comprar / p.caixa) * p.caixa : comprar;
          g.itens.push({ codigo: p.codigo, descricao: p.descricao, unidade: p.unidade, abc: p.abc, saldo: n2(saldo), minimo: n2(min), ja_pedido: n2(pend), venda_dia: n2(p.dia),
            notas_90d: p.vezes90, clientes_90d: p.clientes90,
            cobertura_dias: p.dia > 0 ? Math.round(Math.max(0, saldo) / p.dia) : null, comprar: n2(qtd), caixas: p.caixa ? Math.ceil(comprar / p.caixa) : null, custo_unit: n2(p.custo), total: n2(qtd * p.custo), urgente });
          g.total += qtd * p.custo; if (!p.custo) g.sem_custo++; if (urgente) g.urgentes++;
        });
        const lista = [...grupos.values()].sort((a, b) => (!a.codigo ? 1 : 0) - (!b.codigo ? 1 : 0) || b.urgentes - a.urgentes || b.total - a.total);
        const ORD: Record<string, number> = { A: 0, B: 1, C: 2 };
        return { cobertura_pedida_dias: dias, fornecedores_com_pedido: lista.length, urgentes: lista.reduce((s, g) => s + g.urgentes, 0),
          sem_giro_fora_da_sugestao: { quantidade: semGiro.length, regra: 'vendeu em menos de ' + GIRO_NOTAS + ' notas ou para menos de ' + GIRO_CLIENTES + ' clientes nos últimos 90 dias', exemplos: semGiro.slice(0, 8) },
          fornecedores: lista.slice(0, f ? 3 : 8).map(g => {
            const cad = g.cad || {}, minimo = Number(cad.pedido_minimo) || 0;
            const cif = cad.frete === 'cif' || (cad.frete === 'cif_acima' && g.total >= Number(cad.frete_cif_acima || 0));
            return { codigo: g.codigo, nome: g.nome, prazo_dias: g.prazo, prazo_estimado: !g.cad, total: n2(g.total), itens: g.itens.length, urgentes: g.urgentes, itens_sem_custo: g.sem_custo,
              pedido_minimo: minimo || null, falta_para_o_minimo: minimo ? n2(Math.max(0, minimo - g.total)) : null,
              frete: cad.frete === 'cif_acima' ? 'CIF acima de R$ ' + n2(cad.frete_cif_acima) + (cif ? ' (atingido)' : ' (não atingido)') : cad.frete || null,
              hoje_e_dia_de_pedido: (cad.dias_pedido || []).map(Number).includes(hojeDia), dias_de_pedido: (cad.dias_pedido || []).map((d: number) => DIAS[d]),
              lista: g.itens.sort((a: Linha, b: Linha) => (b.urgente ? 1 : 0) - (a.urgente ? 1 : 0) || ORD[a.abc] - ORD[b.abc] || b.total - a.total).slice(0, f ? 40 : 12) };
          }) };
      }
    },
    estoque_parado: {
      papeis: ['admin', 'comprador'],
      def: { name: 'estoque_parado', description: 'Estoque parado: produtos com saldo e custo que não venderam nada nos últimos 90 dias, com o valor a custo, última entrada e última saída. Total parado e os 30 maiores.', strict: true,
        input_schema: obj({ filtro: { type: 'string', description: 'parte da linha, do fornecedor ou da descrição; vazio = todos' } }, ['filtro']) },
      async roda(c: Ctx, i: Linha) {
        const { produtos } = await dados(c);
        const f = normaliza(i.filtro);
        const l = produtos.filter(p => Number(p.quantidade) > 0 && !(p.venda90 > 0) && (!f || normaliza(p.linha + ' ' + p.forn_nome + ' ' + p.descricao).includes(f)))
          .map(p => ({ codigo: p.codigo, descricao: p.descricao, fornecedor: p.forn_nome, saldo: n2(p.quantidade), valor_a_custo: n2(Number(p.quantidade) * p.custo), ultima_entrada: p.ult_entrada, ultima_saida: p.ult_saida }))
          .sort((a, b) => b.valor_a_custo - a.valor_a_custo);
        return { produtos_parados: l.length, valor_parado: n2(l.reduce((s, x) => s + x.valor_a_custo, 0)), maiores: l.slice(0, 30) };
      }
    },
    margens: {
      papeis: ['admin', 'comprador'],
      def: { name: 'margens', description: 'Margem de cada produto pela listagem do FKN: (preço de tabela − último custo de compra) ÷ preço, contra a margem mínima configurada. Os abaixo da mínima primeiro (curva A antes), com o preço que daria a margem mínima. Até 30.', strict: true,
        input_schema: obj({ filtro: { type: 'string', description: 'código, parte da descrição, da linha ou do fornecedor; vazio = todos os abaixo da mínima' } }, ['filtro']) },
      async roda(c: Ctx, i: Linha) {
        const { produtos, margemMin } = await dados(c);
        const f = normaliza(i.filtro), ORD: Record<string, number> = { A: 0, B: 1, C: 2 };
        const l = produtos.filter(p => Number(p.preco_venda) > 0 && p.custo > 0 && (!f || normaliza(p.codigo + ' ' + p.linha + ' ' + p.forn_nome + ' ' + p.descricao).includes(f)))
          .map(p => { const mg = (Number(p.preco_venda) - p.custo) / Number(p.preco_venda) * 100;
            return { codigo: p.codigo, descricao: p.descricao, abc: p.abc, preco_tabela: n2(p.preco_venda), ultimo_custo: n2(p.custo), margem_pct: n2(mg), abaixo_da_minima: mg < margemMin,
              preco_para_a_minima: n2(p.custo / (1 - margemMin / 100)), venda_90d_rs: n2(p.valor90) }; })
          .filter(x => f || x.abaixo_da_minima)
          .sort((a, b) => (b.abaixo_da_minima ? 1 : 0) - (a.abaixo_da_minima ? 1 : 0) || ORD[a.abc] - ORD[b.abc] || b.venda_90d_rs - a.venda_90d_rs);
        return { margem_minima_pct: margemMin, abaixo_da_minima: l.filter(x => x.abaixo_da_minima).length, produtos: l.slice(0, 30) };
      }
    },
    preco_negociar: {
      papeis: ['admin', 'comprador'],
      def: { name: 'preco_negociar', description: 'Preço de compra para negociar, pela conta do sistema (crm_cs_preco_alvo): para cada código, o último custo pago e o menor dos últimos 180 dias pelas notas de compra (com IPI, ST e frete; fornecedor e dia), a média, o último custo de cada fornecedor, o preço de tabela, o teto pela margem mínima, o teto pelo menor preço de concorrente do mês e "negociar_ate" (o menor teto). Até 40 códigos.', strict: true,
        input_schema: obj({ codigos: { type: 'string', description: 'códigos dos produtos separados por vírgula' } }, ['codigos']) },
      async roda(c: Ctx, i: Linha) {
        const cods = String(i.codigos || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean).slice(0, 40);
        if (!cods.length) return { erro: 'informe os códigos' };
        const { data, error } = await c.u.rpc('crm_cs_preco_alvo', { p_codigos: cods });
        if (error) throw error;
        return { itens: data, observacao: 'as notas de compra entram pela Sefaz desde 17/10/2026: histórico curto ainda' };
      }
    },
    vencimento_sugerido: {
      papeis: ['admin', 'comprador'],
      def: { name: 'vencimento_sugerido', description: 'A partir de que dia o pagamento de um pedido ao fornecedor cabe no caixa (a mesma previsão da tela do Caixa). Devolve SÓ a data e uma frase, nunca saldo nem valor do caixa.', strict: true,
        input_schema: obj({ valor: { type: 'number', description: 'total do pedido em reais' }, prazo_minimo_dias: { type: 'integer', description: 'menor prazo aceitável, em dias a partir de hoje (0 = 7)' }, prazo_maximo_dias: { type: 'integer', description: 'maior prazo que o fornecedor costuma dar (0 = 45; até 75)' } }, ['valor', 'prazo_minimo_dias', 'prazo_maximo_dias']) },
      async roda(_c: Ctx, i: Linha) {
        const valor = Number(i.valor), de = Number(i.prazo_minimo_dias) > 0 ? Math.round(Number(i.prazo_minimo_dias)) : 7;
        const ate = Math.min(75, Number(i.prazo_maximo_dias) > 0 ? Math.round(Number(i.prazo_maximo_dias)) : 45);
        if (!(valor > 0)) return { erro: 'informe o valor do pedido' };
        // a crm-caixa-leitura faz a conta com o motor do Caixa e devolve só o sinal (data + frase)
        const r = await fetch(Deno.env.get('SUPABASE_URL') + '/functions/v1/crm-caixa-leitura?parte=sinal&valor=' + encodeURIComponent(String(Math.round(valor * 100) / 100)) + '&de=' + de + '&ate=' + Math.max(de, ate),
          { headers: { Authorization: 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') }, signal: AbortSignal.timeout(30000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return { erro: 'o caixa não respondeu agora' };
        return { vencer_a_partir_de: j.vencer_a_partir_de || null, sinal: String(j.sinal || '') };
      }
    },
    notas_de_compra: {
      papeis: ['admin', 'comprador'],
      def: { name: 'notas_de_compra', description: 'Notas de compra que chegaram pela Sefaz e esperam o comprador: as pendentes de entrada (fornecedor, valor, emissão, se a mercadoria já entrou no FKN depois da emissão, se parece despesa e não mercadoria) e as notas só com o resumo, sem ciência ainda. Também quantas são histórico.', strict: true,
        input_schema: obj({}, []) },
      async roda(c: Ctx) {
        const [{ data: pend }, { data: dfe }, { count: hist }] = await Promise.all([
          c.u.from('crm_compras').select('id, numero, fornecedor_nome, fornecedor_doc, emitida_em, valor_total').eq('situacao', 'pendente').order('emitida_em', { ascending: false }).limit(60),
          c.u.from('crm_dfe').select('emitente_nome, emitida_em, valor, manifestada_em').eq('situacao', 'autorizada').is('xml_em', null).order('emitida_em', { ascending: false }).limit(60),
          c.u.from('crm_compras').select('id', { count: 'exact', head: true }).eq('situacao', 'ignorada')
        ]);
        const ids = ((pend || []) as Linha[]).map(x => x.id);
        const [{ data: itens }, { data: prod }] = ids.length ? await Promise.all([
          c.u.from('crm_compra_itens').select('compra_id, ncm, cfop').in('compra_id', ids),
          c.u.rpc('crm_compras_itens_produto')
        ]) : [{ data: [] }, { data: [] }];
        const cods = [...new Set(((prod || []) as Linha[]).map(x => x.codigo))];
        const { data: est } = cods.length ? await c.u.from('crm_estoque').select('codigo, ult_entrada').in('codigo', cods) : { data: [] };
        const ult = new Map(((est || []) as Linha[]).map(e => [e.codigo, String(e.ult_entrada || '').slice(0, 10)]));
        const dia = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : '');
        return {
          pendentes: ((pend || []) as Linha[]).map(n => {
            const emit = dia(n.emitida_em), ps = ((prod || []) as Linha[]).filter(x => x.compra_id === n.id);
            const entrou = ps.map(x => ult.get(x.codigo)).filter(d => d && d >= emit).sort().pop() || null;
            return { nota: n.numero, fornecedor: n.fornecedor_nome, emissao: emit, valor: n2(n.valor_total), parece_despesa: pareceDespesa(((itens || []) as Linha[]).filter(x => x.compra_id === n.id)),
              produtos_reconhecidos: ps.length, entrou_no_fkn_em: entrou, situacao: entrou ? 'chegou (entrada no FKN)' : ps.length ? 'aguardando' : 'sem produto reconhecido (confirmar com o recebimento)' };
          }),
          so_resumo_sem_ciencia: ((dfe || []) as Linha[]).filter(d => !d.manifestada_em).map(d => ({ fornecedor: d.emitente_nome, emissao: dia(d.emitida_em), valor: n2(d.valor) })),
          historico_de_preco: hist || 0,
          regra: 'dar entrada só no que chegou; ciência da nota nova só quando a mercadoria chegar (Estoque → Notas de compra)'
        };
      }
    }
  };
}
