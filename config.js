// Instalação do CRM (um arquivo destes por cliente).
// supabaseUrl/supabaseAnonKey vazios = MODO LOCAL: os dados ficam só neste
// navegador (bom para experimentar, não serve para a equipe).
// Preenchidos = modo Supabase, com login. A chave anon é pública por natureza;
// quem protege os dados é a RLS de crm/supabase/schema.sql.
window.CRM_CONFIG = {
  nomeEmpresa: 'OneClean', // aparece no login, no topo e nas propostas
  logo: 'assets/oneclean-logo.png',        // logo completo: login e propostas (vazio = logo da Sistemi Dalessi)
  logoIcone: 'assets/oneclean-icone.png',  // versão quadrada: aba do navegador e menu encolhido
  logoNoMenu: 'completo',                  // logo completo no alto do menu, num cartão branco
  // Paleta do logo da OneClean: azul #2592ae e verde #a9c451. O principal é o mesmo azul bem
  // mais escuro (pedido do Anderson), o que também deixa o texto branco do menu bem legível.
  // Degradê turquesa → azul do Instagram e do site (tirado dos prints de 02/10): faixas da proposta.
  // Documento da proposta: turquesa e azul-petróleo do modelo aprovado em 02/10, mais o verde da borboleta.
  cores: { principal: '#175b6d', destaque: '#a9c451', gradiente: ['#03baca', '#0198cf'], documento: { destaque: '#009cb3', escuro: '#163e50', verde: '#a9c451' } },
  // A turma OneClean (mascotes, 17/10/2026; desenhos do Anderson, recortados em assets/turma): o Clean é o principal
  // (topo, de corpo inteiro, guia do dia e conversa); o especialista de cada tela aparece dentro do painel; o Andi
  // recebe no login. turma.js explica. Trocar um desenho: mesmo nome de arquivo e subir a `versao`.
  turma: {
    pasta: 'assets/turma/', versao: '4',
    principal: 'clean', anfitriao: 'andi',
    boasVindas: 'Olá! Eu sou o Andi, assistente virtual da OneClean. Entre com o seu e-mail e a sua senha para começar.',
    mascotes: {
      andi: { nome: 'Andi', papel: 'Assistente virtual' },
      clean: { nome: 'Clean', papel: 'Assistente do sistema' },
      gotti: { nome: 'Gotti', papel: 'Produtos e higiene' },
      capiclean: { nome: 'CapiClean', papel: 'Relacionamento e campanhas' },
      frasquinho: { nome: 'Frasquinho', papel: 'Produtos de limpeza' },
      vassourinha: { nome: 'Vassourinha', papel: 'Utensílios e acessórios' },
      saquinho: { nome: 'Saquinho', papel: 'Sacos para lixo' },
      rolinho: { nome: 'Rolinho', papel: 'Papéis e descartáveis' },
      esponjinha: { nome: 'Esponjinha', papel: 'Acessórios e superfícies' },
      borrifador: { nome: 'Borrifador', papel: 'Aromatizantes e aplicação' },
      baldinho: { nome: 'Baldinho', papel: 'Rotinas e utensílios' },
      dispenser: { nome: 'Dispenser', papel: 'Dispensers e refis' },
      'carrinho-de-limpeza': { nome: 'Carrinho', papel: 'Equipamentos' },
      'compras-cliente-sacola': { nome: 'Sacolinha', papel: 'Pedidos' },
      logistica: { nome: 'Logística', papel: 'Separação e entregas' },
      'compras-setor-interno': { nome: 'Compras', papel: 'Fornecedores e reposição' },
      estoque: { nome: 'Estoque', papel: 'Saldo, conferência e inventário' },
      financeiro: { nome: 'Financeiro', papel: 'Contas a pagar e a receber' },
      'proposta-comercial': { nome: 'Proposta', papel: 'Negócios e propostas' },
      cobranca: { nome: 'Cobrança', papel: 'Boletos e lembretes' },
      auditoria: { nome: 'Auditoria', papel: 'Conferência, divergências e correções' }
    },
    telas: {
      inicio: 'clean', fila: 'capiclean', funil: 'proposta-comercial', empresas: 'capiclean', pessoas: 'capiclean',
      negocios: 'proposta-comercial', pedidos: 'compras-cliente-sacola', 'pedidos:separacao': 'logistica', 'pedidos:nfe': 'logistica',
      'pedidos:estoque': 'estoque', 'pedidos:faltas': 'compras-setor-interno', agenda: 'capiclean', relatorios: 'clean', ajustes: 'clean',
      compras: 'compras-setor-interno', estoque: 'estoque', gestao: 'financeiro', caixa: 'financeiro', 'caixa:cobranca': 'cobranca',
      emails: 'capiclean', ofertas: 'gotti', fiscal: 'auditoria', 'estoque:conferencia': 'auditoria'
    },
    // fala de "tudo em dia" de cada tela (quando não há nada esperando ali)
    falas: {
      inicio: 'Tudo em dia por aqui. Clique em mim lá em cima para ver o guia do dia.',
      fila: 'Ninguém esperando contato agora. Bom momento para prospectar!',
      funil: 'Nenhum negócio parado. Siga movendo os cartões pelas etapas.',
      negocios: 'Nenhum negócio parado. As propostas estão andando.',
      pedidos: 'Nenhum pedido esperando você agora.',
      'pedidos:separacao': 'Nada para separar agora. Quando um pedido for liberado, ele aparece aqui.',
      agenda: 'Nenhuma atividade atrasada. Rotina em dia!',
      compras: 'Relatórios do FKN em dia.',
      estoque: 'Estoque conferido com o FKN, sem diferença sem explicação.',
      'estoque:conferencia': 'Conferi a última listagem do FKN: nenhuma diferença sem explicação.',
      fiscal: 'Estou de olho nas regras fiscais e nas notas. Pergunte se algo parecer estranho.',
      caixa: 'Nenhuma conta vencida sem baixa.',
      'caixa:cobranca': 'Nenhum boleto esperando por aqui.',
      emails: 'A cadência de e-mails está rodando.',
      ofertas: 'Monte uma oferta com o estoque parado para girar o galpão.'
    }
  },
  supabaseUrl: 'https://udhigavckigciqnicgyy.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkaGlnYXZja2lnY2lxbmljZ3l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3MDQzNjcsImV4cCI6MjEwNjI4MDM2N30.vQQcV9RIWI5ZBDUreKWoWPNEE9JcSM33XHUWUHYJqlY'
};
