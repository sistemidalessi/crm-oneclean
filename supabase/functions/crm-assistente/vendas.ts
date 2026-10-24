// O GERENTE DE VENDAS da turma (24/10/2026, plano do CEO Grupo Dalessi; Anderson: "Gerente de Vendas… conversa também
// com a Isabela e com os(as) vendedores(as), cada um vendo só o que o papel permite"). Aqui ficam o manual (vai junto do
// system quando a pergunta é de vendas ou quando quem responde é ele, e na análise do dia) e as ferramentas dele.
// As CONTAS são do banco (crm_gv_ritmo, crm_gv_sumidos, crm_gv_funil: SECURITY INVOKER, rodam com o login de quem
// pergunta, e a RLS de sempre decide o que entra); a IA só lê e escreve. Sem custo nem margem em nada daqui.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

export const GERENTE = `MANUAL DO GERENTE DE VENDAS (vale quando a pergunta é de vendas, metas, clientes, funil ou propostas).
Você é o gerente de vendas de uma distribuidora: acompanha o ritmo do mês, cobra a meta com respeito e aponta onde está
o dinheiro mais fácil (cliente fiel que sumiu, proposta esquecida, negócio parado). Fala com o dono, com a gestora e com
cada vendedor(a), e cada um só vê o que o perfil permite: as ferramentas já trazem só isso.

Como ler os números:
- Ritmo ("ritmo_vendas"): compare o mês até hoje com o MESMO PERÍODO do mês passado (não com o mês inteiro). A projeção
  é linear (vendido ÷ dias corridos × dias do mês): diga que é estimativa. Sem meta lançada, diga isso e sugira lançar em
  Configurações → Metas (só a gestora e o administrador lançam).
- Clientes sumidos ("clientes_sumidos"): compravam com ritmo e passaram de 2 ciclos sem comprar. Comece pelos de maior
  compra por mês. O próximo passo é um contato (ligar, WhatsApp, visita) registrado no CRM, com uma oferta do que ele
  costumava levar ("cliente" mostra o que ele mais compra).
- Funil ("funil_parado"): proposta enviada há mais de 7 dias sem resposta = ligar hoje; negócio parado há mais de 15
  dias = mover de etapa, marcar tarefa ou dar como perdido (com o motivo). Muitos negócios antigos parados de importação
  pedem uma limpeza do funil, não 1.000 ligações: diga isso.

Como responder:
- Comece pela situação em uma frase ("Outubro está 4% acima do mesmo período de setembro, sem meta lançada").
- Depois no máximo 5 ações concretas, cada uma com o cliente ou o negócio e o número que a justifica.
- Para a vendedora: fale da carteira dela, em tom de parceiro; nunca compare com colegas pelo nome.
- Para a gestora e o administrador: a equipe por vendedor(a), quem precisa de ajuda e onde.
- Números só das ferramentas. Nada de custo, margem, Caixa ou dado de contato (telefone, e-mail) nas respostas.`;

export function perguntaAnalise(papel: string) {
  const equipe = papel === 'admin' || papel === 'gestor';
  return `Faça a ANÁLISE DE VENDAS DE HOJE ${equipe ? 'da EQUIPE, para a gestão' : 'da SUA CARTEIRA, para você (vendedor(a))'}, como o gerente de vendas do manual.
Consulte "ritmo_vendas", "clientes_sumidos" e "funil_parado".
Responda em no máximo 12 linhas, nesta ordem:
1) O mês: vendido até hoje × o mesmo período do mês passado, a meta (se houver) e a projeção.
${equipe ? '2) Por vendedor(a): quem está acima e quem precisa de ajuda (com o número).' : '2) O que falta para a sua meta (se houver), em reais por dia útil restante.'}
3) Os 3 clientes sumidos que mais valem um contato hoje (nome, quanto comprava por mês, há quantos dias não compra).
4) As propostas sem resposta e os negócios parados que mais valem (até 3).
Se uma parte não tiver nada, pule. Sem introdução.`;
}

type Ctx = { u: SupabaseClient; papel: string; meuId: string; hoje: string };
type Ajuda = { obj: (props: Record<string, unknown>, req: string[]) => Record<string, unknown> };

export const FERRAMENTAS_GERENTE = ['ritmo_vendas', 'clientes_sumidos', 'funil_parado', 'cliente', 'buscar_clientes'];

export function ferramentasGerente(h: Ajuda) {
  const { obj } = h;
  const VENDAS = ['admin', 'gestor', 'vendedor'];
  const rpc = async (c: Ctx, nome: string, args?: Record<string, unknown>) => {
    const { data, error } = await c.u.rpc(nome, args);
    if (error) throw error;
    return data;
  };
  return {
    ritmo_vendas: {
      papeis: VENDAS,
      def: { name: 'ritmo_vendas', description: 'O mês de vendas até hoje: total e por vendedor(a) (a vendedora vê só a carteira dela), contra o mesmo período do mês passado e o mês passado inteiro, a meta lançada, a % da meta e a projeção linear do mês. Notas de venda sem as canceladas.', strict: true, input_schema: obj({}, []) },
      roda: (c: Ctx) => rpc(c, 'crm_gv_ritmo')
    },
    clientes_sumidos: {
      papeis: VENDAS,
      def: { name: 'clientes_sumidos', description: 'Clientes fiéis que sumiram: compraram em pelo menos 3 dias no último ano e já passaram de 2 ciclos de recompra (e de 45 dias) sem comprar. Quantidade, quanto compravam por mês somados e a lista dos maiores (cliente, carteira, última compra, dias sem comprar, ciclo, compra média por mês).', strict: true,
        input_schema: obj({ limite: { type: 'integer', description: 'quantos da lista, de 1 a 30' } }, ['limite']) },
      roda: (c: Ctx, i: Record<string, unknown>) => rpc(c, 'crm_gv_sumidos', { p_limite: Math.max(1, Math.min(30, Number(i.limite) || 10)) })
    },
    funil_parado: {
      papeis: VENDAS,
      def: { name: 'funil_parado', description: 'Negócios abertos parados na mesma etapa há mais de 15 dias e propostas enviadas há mais de 7 dias sem resposta: quantidades, valores e os 10 maiores de cada (com cliente, etapa, dias parado e responsável).', strict: true, input_schema: obj({}, []) },
      roda: (c: Ctx) => rpc(c, 'crm_gv_funil')
    }
  };
}
