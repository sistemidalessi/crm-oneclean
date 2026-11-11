'use strict';
// Carga completa com páginas em paralelo (dados.js tudo, 11/11/2026). Prova com um PostgREST de mentira: todas as linhas,
// uma vez, na ordem do banco; no máximo SIMULTANEAS pedidos ao mesmo tempo; tabela que cresceu depois da contagem;
// linha repetida por gravação no meio da carga; tabela de uma página.
const test = require('node:test');
const assert = require('node:assert/strict');
const DD = require('../dados.js');

const compara = (a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

function bancoFalso(linhas, { aoPedir } = {}) {
  const estado = { pedidos: 0, abertos: 0, maxAbertos: 0, contagens: 0 };
  const sb = {
    from() {
      const q = { contar: false, de: 0, ate: 999 };
      const b = {
        select(_c, opc) { q.contar = !!(opc && opc.count === 'exact'); return b; },
        order() { return b; },
        range(de, ate) { q.de = de; q.ate = ate; return b; },
        then(ok, erro) {
          estado.pedidos++; estado.abertos++; estado.maxAbertos = Math.max(estado.maxAbertos, estado.abertos);
          if (q.contar) estado.contagens++;
          const total = linhas.length;
          return new Promise(r => setTimeout(r, 2)).then(() => {
            if (aoPedir) aoPedir(q, estado);
            const l = linhas.slice().sort(compara).slice(q.de, q.ate + 1);
            estado.abertos--;
            return { data: l, error: null, count: q.contar ? total : null };
          }).then(ok, erro);
        }
      };
      return b;
    }
  };
  return { sb, estado };
}

function geraLinhas(n, desde = 0) {
  const l = [];
  // datas sempre crescentes (como no banco: linha nova tem a criação mais recente); de 3 em 3 com a mesma data (empates)
  for (let i = 0; i < n; i++) l.push({ id: id(desde + i), criado_em: new Date(Date.UTC(2026, 9, 1) + Math.floor((desde + i) / 3) * 1000).toISOString() });
  return l;
}

test('carga em paralelo: todas as linhas, uma vez, na ordem do banco, com no máximo 6 pedidos simultâneos', async () => {
  const linhas = geraLinhas(39303);
  const { sb, estado } = bancoFalso(linhas);
  const r = await DD._tudo(sb, 'nota_itens');
  assert.equal(r.length, 39303);
  assert.deepEqual(r.map(x => x.id), linhas.slice().sort(compara).map(x => x.id));
  assert.equal(estado.contagens, 1, 'conta só na 1ª página');
  assert.equal(estado.pedidos, 40);
  assert.ok(estado.maxAbertos <= 6, 'no máximo 6 ao mesmo tempo (foi ' + estado.maxAbertos + ')');
});

test('tabela que cresceu depois da contagem: continua até a última página incompleta', async () => {
  const linhas = geraLinhas(3000);
  let cresceu = false;
  const { sb } = bancoFalso(linhas, { aoPedir: (q) => { if (!cresceu && q.de === 1000) { cresceu = true; linhas.push(...geraLinhas(1500, 3000)); } } });
  const r = await DD._tudo(sb, 'atividades');
  assert.equal(r.length, 4500);
  assert.equal(new Set(r.map(x => x.id)).size, 4500);
});

test('linha que mudou de página durante a carga não aparece duas vezes', async () => {
  const linhas = geraLinhas(2500);
  let inseriu = false;
  // uma linha nova com data antiga entra no começo: empurra as outras uma posição e repete a da virada da página
  const { sb } = bancoFalso(linhas, { aoPedir: (q) => { if (!inseriu && q.de === 2000) { inseriu = true; linhas.push({ id: id(99999), criado_em: '2026-09-01T00:00:00+00:00' }); } } });
  const r = await DD._tudo(sb, 'empresas');
  assert.equal(new Set(r.map(x => x.id)).size, r.length, 'nenhuma repetida');
});

test('tabela de uma página só: um pedido', async () => {
  const { sb, estado } = bancoFalso(geraLinhas(12));
  const r = await DD._tudo(sb, 'etapas');
  assert.equal(r.length, 12);
  assert.equal(estado.pedidos, 1);
});

test('exatamente 1.000 linhas: confere a página seguinte e para', async () => {
  const { sb, estado } = bancoFalso(geraLinhas(1000));
  const r = await DD._tudo(sb, 'contatos');
  assert.equal(r.length, 1000);
  assert.equal(estado.pedidos, 2);
});
