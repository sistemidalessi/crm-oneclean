// Instalação do CRM (um arquivo destes por cliente).
// supabaseUrl/supabaseAnonKey vazios = MODO LOCAL: os dados ficam só neste
// navegador (bom para experimentar, não serve para a equipe).
// Preenchidos = modo Supabase, com login. A chave anon é pública por natureza;
// quem protege os dados é a RLS de crm/supabase/schema.sql.
window.CRM_CONFIG = {
  nomeEmpresa: 'OneClean', // aparece no login, no topo e nas propostas
  logo: '',               // caminho da imagem (vazio = logo da Sistemi Dalessi)
  supabaseUrl: 'https://udhigavckigciqnicgyy.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkaGlnYXZja2lnY2lxbmljZ3l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3MDQzNjcsImV4cCI6MjEwNjI4MDM2N30.vQQcV9RIWI5ZBDUreKWoWPNEE9JcSM33XHUWUHYJqlY'
};
