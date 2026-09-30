-- Imita o essencial do Supabase num Postgres comum: papéis anon/authenticated,
-- auth.users, auth.uid() e os privilégios padrão generosos que o Supabase dá.
-- Usado só por teste-rls/roda.sh (nunca rodar no Supabase de verdade).
-- Imita o essencial do Supabase: papéis, auth.users, auth.uid() e os privilégios padrão generosos.
create role anon nologin; create role authenticated nologin;
grant usage on schema public to anon, authenticated;
create schema auth; grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
grant select on auth.users to authenticated; -- (para as FKs funcionarem)
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
insert into auth.users values ('a0000000-0000-0000-0000-000000000001','admin@x'),('b0000000-0000-0000-0000-000000000002','gestor@x'),('c0000000-0000-0000-0000-000000000003','vendA@x'),('d0000000-0000-0000-0000-000000000004','vendB@x'),('e0000000-0000-0000-0000-000000000005','fora@x'),('f0000000-0000-0000-0000-000000000006','compras@x');
