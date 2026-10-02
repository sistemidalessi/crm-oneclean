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
  // Documento da proposta: turquesa e azul-petróleo do modelo aprovado em 02/10.
  cores: { principal: '#175b6d', destaque: '#a9c451', gradiente: ['#03baca', '#0198cf'], documento: { destaque: '#009cb3', escuro: '#163e50' } },
  supabaseUrl: 'https://udhigavckigciqnicgyy.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkaGlnYXZja2lnY2lxbmljZ3l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3MDQzNjcsImV4cCI6MjEwNjI4MDM2N30.vQQcV9RIWI5ZBDUreKWoWPNEE9JcSM33XHUWUHYJqlY'
};
