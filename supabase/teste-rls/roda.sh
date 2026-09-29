#!/bin/sh
# Ensaia schema.sql + ataque às permissões num Postgres local descartável.
# Uso: sh crm/supabase/teste-rls/roda.sh   (precisa do PostgreSQL instalado: initdb, pg_ctl, psql)
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
BIN=$(dirname "$(command -v initdb || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")
"$BIN/initdb" -D "$TMP/d" -A trust -U postgres >/dev/null
"$BIN/pg_ctl" -D "$TMP/d" -o "-p ${PORTA:-5498} -k $TMP" -l "$TMP/log" start >/dev/null
trap '"$BIN/pg_ctl" -D "$TMP/d" stop >/dev/null; rm -rf "$TMP"' EXIT
P="psql -h $TMP -p ${PORTA:-5498} -U postgres -X -q"
$P -c "create database crm"
$P -d crm -f "$DIR/simula-supabase.sql" >/dev/null
$P -d crm -v ON_ERROR_STOP=1 -f "$DIR/../schema.sql" >/dev/null 2>&1
$P -d crm -v ON_ERROR_STOP=1 -f "$DIR/../schema.sql" >/dev/null 2>&1   # 2ª vez: tem que ser idempotente
SAIDA=$($P -d crm -At -f "$DIR/ataque.sql" 2>&1)
echo "$SAIDA" | grep -v '^[a-e]0000000' | grep -v '^$'
if echo "$SAIDA" | grep -q 'NÃO devia'; then echo; echo 'PERMISSÃO FURADA'; exit 1; fi
echo; echo 'OK: nenhuma permissão furada'
