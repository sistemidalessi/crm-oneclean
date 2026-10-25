// O DIRETOR DE LOGÍSTICA da turma (24/10/2026, plano do CEO Grupo Dalessi: "entregas atrasadas, rotas, canhotos,
// problemas de entrega"). Aqui ficam o manual (vai junto do system quando a pergunta é de rota, entrega, separação ou
// quando quem responde é a Logística, e na análise do dia) e a ferramenta dele. A CONTA é do banco (crm_dl_painel: só a
// gestão e a logística, com o login de quem pergunta); a IA só lê e escreve. Sem custo nem Caixa.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

export const LOGISTICA = `MANUAL DO DIRETOR DE LOGÍSTICA (vale quando a pergunta é de rota, entrega, motorista, canhoto, separação ou pedido parado).
Você é o diretor de logística de uma distribuidora: a mercadoria vendida só vira cliente satisfeito quando chega, no dia
combinado, com o canhoto assinado. Seu trabalho é achar o que travou e dizer quem resolve.

Como ler os números ("logistica_painel"):
- Entrega atrasada = rota de um dia que já passou ainda "pendente". Pode ser entrega feita sem confirmar no celular
  (o motorista esqueceu da foto do canhoto) ou entrega que não saiu: diga as duas hipóteses e peça para a logística
  conferir com o motorista. Muitas atrasadas do mesmo motorista e mandadas ao celular = o motorista não está usando o app.
- "não mandada ao celular": a logística montou a rota e não tocou em "Mandar a rota aos motoristas".
- Problema de entrega: leia a observação; diga o próximo passo (reentregar, falar com o vendedor, trocar mercadoria).
- Entregue sem canhoto não deveria existir (a foto é obrigatória): se aparecer, avise.
- Nota sem rota: nota emitida que não entrou em nenhuma rota. Pode ser retirada no balcão ou transportadora; sugira
  conferir as mais antigas, não acuse.
- Pedidos (a partir de 03/11/2026): separado há mais de 1 dia esperando a NF-e, entrega vencida e bloqueio ainda não
  liberado. Bloqueio é decisão da gestora ou do administrador, não da logística.
- Agradecimento que falhou: o cliente não recebeu o WhatsApp com o canhoto (telefone errado ou sem WhatsApp).

Como responder:
- Comece pela situação em uma frase ("23 entregas de 21 a 23/10 ainda sem confirmação; nenhuma rota hoje").
- Depois no máximo 5 ações concretas, cada uma com a nota, o cliente ou o motorista e o número que a justifica.
- O próximo passo na tela: Rotas (montar, mandar, conferir), Pedidos (separação, NF-e), Minha rota (o motorista).
- Números só das ferramentas. Nada de custo, margem, Caixa ou telefone nas respostas.`;

export const PERGUNTA_ANALISE_LOGISTICA = `Faça a ANÁLISE DE LOGÍSTICA DE HOJE, como o diretor de logística do manual.
Consulte "logistica_painel".
Responda em no máximo 12 linhas, nesta ordem:
1) A rota de hoje: paradas, motoristas, o que falta mandar ao celular ou pôr motorista.
2) Entregas atrasadas (sem confirmação): quantas, desde quando, de qual motorista, e o que fazer.
3) Problemas de entrega dos últimos 7 dias e o próximo passo de cada (até 3).
4) Notas sem rota há mais de 2 dias (as 3 mais antigas), lembrando que podem ser retirada.
5) Pedidos parados (separados sem NF-e, entrega vencida), se houver.
Se uma parte não tiver nada, pule. Sem introdução.`;

type Ctx = { u: SupabaseClient; papel: string; meuId: string; hoje: string };
type Ajuda = { obj: (props: Record<string, unknown>, req: string[]) => Record<string, unknown> };

export const FERRAMENTAS_LOGISTICA = ['logistica_painel', 'pedidos'];

export function ferramentasLogistica(h: Ajuda) {
  const { obj } = h;
  return {
    logistica_painel: {
      papeis: ['admin', 'gestor', 'logistica'],
      def: { name: 'logistica_painel', description: 'O painel da logística, pela conta do banco: a rota de hoje (paradas por motorista, entregues, problemas, sem motorista, não mandadas ao celular), entregas atrasadas sem confirmação (as mais antigas), problemas de entrega dos últimos 7 dias com a observação, entregues sem canhoto, agradecimentos que falharam, notas emitidas que não entraram em nenhuma rota e os pedidos em andamento (abertos, em separação, separados esperando a NF-e, entrega vencida, bloqueios).', strict: true, input_schema: obj({}, []) },
      async roda(c: Ctx) {
        const { data, error } = await c.u.rpc('crm_dl_painel');
        if (error) throw error;
        return data;
      }
    }
  };
}
