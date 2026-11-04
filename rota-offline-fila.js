/* CRM Sistemi Dalessi — a rota do motorista sem internet (04/11/2026, pedido do Anderson: "eles estão alegando que estão sem
   internet ... se eles baixaram a rota na empresa antes de sair, eles não ficariam com essa desculpa").
   * a rota do dia fica guardada no celular (localStorage 'crm_rota_offline') toda vez que carrega com internet;
   * a confirmação feita sem sinal (foto do canhoto + "tudo certo"/"teve problema") vai para uma fila no celular (IndexedDB)
     e o CRM manda sozinho quando a internet volta (rotas.js, enviaFila);
   * aberto já sem sinal, o app mostra a rota guardada (rota-offline.html, servida pelo sw.js).
   Usado pelo CRM (rotas.js) e pela página da rota sem internet. */
(function (raiz) {
  'use strict';
  const CHAVE = 'crm_rota_offline', BANCO = 'crm-offline', LOJA = 'fila';
  function abre() {
    return new Promise((ok, falha) => {
      if (!raiz.indexedDB) { falha(new Error('este celular não guarda arquivos offline')); return; }
      const r = raiz.indexedDB.open(BANCO, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(LOJA)) r.result.createObjectStore(LOJA, { keyPath: 'id' }); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => falha(r.error || new Error('não abriu a fila offline'));
    });
  }
  async function op(modo, f) {
    const db = await abre();
    return new Promise((ok, falha) => {
      const t = db.transaction(LOJA, modo), s = t.objectStore(LOJA);
      let res;
      const q = f(s);
      if (q) q.onsuccess = () => { res = q.result; };
      t.oncomplete = () => { db.close(); ok(res); };
      t.onerror = t.onabort = () => { db.close(); falha(t.error || new Error('fila offline')); };
    });
  }
  // rec: { id (da entrega), dia, como: 'entregue'|'problema', obs, foto (Blob), em (ISO), user }
  const guarda = rec => op('readwrite', s => s.put(rec));
  const lista = () => op('readonly', s => s.getAll()).then(l => (l || []).sort((a, b) => String(a.em).localeCompare(String(b.em))));
  const tira = id => op('readwrite', s => s.delete(id));
  function rotaGuardada() { try { return JSON.parse(raiz.localStorage.getItem(CHAVE) || 'null'); } catch (e) { return null; } }
  function guardaRota(r) { try { raiz.localStorage.setItem(CHAVE, JSON.stringify(r)); return true; } catch (e) { return false; } }
  // marca na rota guardada a parada confirmada sem internet (para a lista já mostrar como feita)
  function marcaFeita(id, como, em) {
    const r = rotaGuardada();
    if (!r || !Array.isArray(r.l)) return;
    r.l.forEach(x => { if (x.id === id) { x.situacao = como; x.entregue_em = em; x.na_fila = true; } });
    guardaRota(r);
  }
  // erro de rede (sem sinal), não de permissão ou de dado: só esse vai para a fila
  const semRede = e => (raiz.navigator && raiz.navigator.onLine === false) || /failed to fetch|networkerror|load failed|network request failed|fetch failed|internet|timeout|abort/i.test(String(e && (e.message || e)));
  raiz.CRMFilaRota = { guarda, lista, tira, rotaGuardada, guardaRota, marcaFeita, semRede, CHAVE };
})(typeof window !== 'undefined' ? window : globalThis);
