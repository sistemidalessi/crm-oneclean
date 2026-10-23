'use strict';
// Função nova no esquema public nasce sem acesso para quem não fez login (alertas do Supabase, 23/10/2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

test('padrão das funções: sem EXECUTE para anon e PUBLIC', () => {
  assert.ok(sql.includes('alter default privileges for role postgres in schema public revoke execute on functions from anon;'));
  assert.ok(sql.includes('alter default privileges for role postgres revoke execute on functions from public;'));
});
