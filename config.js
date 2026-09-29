// Instalação do CRM (um arquivo destes por cliente).
// supabaseUrl/supabaseAnonKey vazios = MODO LOCAL: os dados ficam só neste
// navegador (bom para experimentar, não serve para a equipe).
// Preenchidos = modo Supabase, com login. A chave anon é pública por natureza;
// quem protege os dados é a RLS de crm/supabase/schema.sql.
window.CRM_CONFIG = {
  nomeEmpresa: 'OneClean', // aparece no login, no topo e nas propostas
  logo: '',               // caminho da imagem (vazio = logo da Sistemi Dalessi)
  supabaseUrl: '',
  supabaseAnonKey: ''
};
