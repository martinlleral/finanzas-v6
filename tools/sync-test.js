/**
 * Tests del motor de sincronización.
 *
 * Estos son los caminos donde un bug NO se ve: la transacción desaparece en
 * silencio o se escribe dos veces, y nadie se entera hasta revisar el sheet.
 * Se mockea `fetch` para simular al servidor y se verifica el estado real de
 * la cola, del buffer optimista y de los POST que salieron.
 *
 * Uso: node tools/sync-test.js index.html
 *
 * Para comprobar que los tests SIRVEN (o sea, que fallan cuando el bug está):
 *
 *     git show <commit-anterior-a-la-v3>:index.html > /tmp/viejo.html
 *     node tools/sync-test.js /tmp/viejo.html
 *
 * Contra el código previo a la v3 pasan 1 de 5. El primero falla con
 * `filasEnSheet: esperaba 1, hubo 2` y `uidsEnviados: ["", ""]`: el cliente
 * viejo mandaba el uid vacío y una sola transacción terminaba escrita dos
 * veces. Ese es, exactamente, el bug que se veía en el sheet.
 */
const { chromium } = require('/opt/homebrew/lib/node_modules/playwright');
const path = require('path');

// Prepara la página: API configurada + fetch mockeado
const PREPARAR = (guion) => {
  window.__posts = [];
  window.__guion = guion;         // respuestas por índice de POST
  window.__sheet = [];            // filas "escritas" en el sheet falso
  const realFetch = window.fetch;
  window.fetch = async (url, opt) => {
    if (!opt || opt.method !== 'POST') {
      // GET getRawData → devolver el sheet falso
      return { ok: true, status: 200, json: async () => window.__sheet,
               text: async () => JSON.stringify(window.__sheet) };
    }
    const body = JSON.parse(opt.body);
    window.__posts.push(body);
    const i = window.__posts.length - 1;
    const resp = window.__guion[i] || window.__guion[window.__guion.length - 1] || { kind: 'ok' };

    // El servidor idempotente: escribe solo los uid que no estén
    const txs = body.txs || [body];
    if (resp.kind === 'ok' || resp.kind === 'ok-pero-sin-respuesta') {
      txs.forEach(t => {
        if (t.uid && window.__sheet.some(r => r.u === t.uid)) return;  // dedupe por uid
        window.__sheet.push({ d: t.date, t: t.type, c: t.category, s: t.subcategory,
                              a: t.amount, desc: t.description, p: t.paymentMethod || '',
                              u: t.uid || '' });
      });
    }
    if (resp.kind === 'ok') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, written: txs.length, skipped: [] }) };
    }
    if (resp.kind === 'ok-pero-sin-respuesta') {
      // ESTE es el caso que generaba los duplicados: el servidor escribió,
      // pero la respuesta no vuelve (corte de red a mitad del 302).
      throw new TypeError('Failed to fetch');
    }
    if (resp.kind === 'transitorio') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ error: 'Sheet ocupado, reintentá', retriable: true }) };
    }
    if (resp.kind === 'fatal') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ error: 'Tipo inválido: X' }) };
    }
    return realFetch(url, opt);
  };
};

const CARGAR_TX = ({ desc, monto }) => {
  const tx = { _uid: _makeTxUid(), d: '2026-07-31', t: 'Egreso', c: 'HogarYVida',
               s: 'Familia', a: monto, desc: desc, p: '' };
  OPTIMISTIC_TXS.push(tx);
  saveOptimisticTxs();
  TRANSACTIONS.push(tx);
  enqueueSync([tx]);
  return tx._uid;
};

// Defensivo a propósito: este mismo test tiene que poder correr contra la
// versión VIEJA del cliente (que no tiene _loadQueue ni dead-letter) para
// demostrar que efectivamente REPRODUCE el bug. Un test que pasa en las dos
// versiones no prueba nada.
const ESTADO = () => ({
  posts: window.__posts.length,
  filasEnSheet: window.__sheet.length,
  cola: (typeof _loadQueue === 'function'
          ? _loadQueue().length
          : JSON.parse(localStorage.getItem('FINANZAS_PENDING') || '[]').length),
  optimistas: OPTIMISTIC_TXS.length,
  deadLetter: (typeof _deadLetterCount === 'function' ? _deadLetterCount() : 0),
  uidsEnviados: window.__posts.map(p => p.uid || (p.txs || []).map(t => t.uid).join(',')),
});

const CASOS = [
  {
    nombre: 'Servidor escribe pero la respuesta no vuelve → el retry NO debe duplicar',
    guion: [{ kind: 'ok-pero-sin-respuesta' }, { kind: 'ok' }],
    esperado: { filasEnSheet: 1, cola: 0, deadLetter: 0 },
    porque: 'Es el bug original. El uid hace que el segundo POST sea un no-op en el servidor.',
  },
  {
    nombre: 'Error transitorio (lock ocupado) → reintenta, NO descarta',
    guion: [{ kind: 'transitorio' }, { kind: 'ok' }],
    esperado: { filasEnSheet: 1, cola: 0, deadLetter: 0 },
    porque: 'Dos dispositivos guardando a la vez es normal en una familia. Descartarla perdería el gasto.',
  },
  {
    nombre: 'Error fatal (validación) → dead-letter, NO reintenta al infinito',
    guion: [{ kind: 'fatal' }],
    esperado: { filasEnSheet: 0, cola: 0, deadLetter: 1, posts: 1 },
    porque: 'Reintentar un "Tipo inválido" 8 veces no lo arregla.',
  },
  {
    nombre: 'Tras un fatal, la tx queda BORRABLE (no fantasma imborrable)',
    guion: [{ kind: 'fatal' }],
    esperadoExtra: async (page) => ({
      borrable: await page.evaluate(() => {
        const tx = OPTIMISTIC_TXS[OPTIMISTIC_TXS.length - 1];
        return tx ? !_txIsPendingSync(tx) : null;
      }),
    }),
    esperado: { deadLetter: 1 },
    esperadoExtraValores: { borrable: true },
    porque: 'Si _txIsPendingSync la sigue bloqueando, queda visible y sin poder borrarse nunca.',
  },
  {
    nombre: 'Dos gastos IDÉNTICOS legítimos → se guardan los DOS',
    dos: true,
    guion: [{ kind: 'ok' }, { kind: 'ok' }],
    esperado: { filasEnSheet: 2, cola: 0, deadLetter: 0 },
    porque: '"Niñera $8000" dos veces el mismo día pasa de verdad. Purgar por firma perdería uno EN SILENCIO.',
  },
];

(async () => {
  const file = 'file://' + path.resolve(process.argv[2] || 'index.html');
  const browser = await chromium.launch();
  const resultados = [];

  for (const caso of CASOS) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    // API_URL se lee de localStorage al cargar: setearla ANTES del goto
    await page.addInitScript(() => {
      localStorage.setItem('FINANZAS_API_URL', 'https://fake.example/exec');
      localStorage.setItem('FINANZAS_API_TOKEN', 'test');
    });
    await page.goto(file, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.evaluate(PREPARAR, caso.guion);
    await page.evaluate(() => { localStorage.removeItem('FINANZAS_FAILED');
                                localStorage.removeItem('FINANZAS_PENDING');
                                OPTIMISTIC_TXS.length = 0; saveOptimisticTxs(); });

    await page.evaluate(CARGAR_TX, { desc: 'Niñera', monto: 8000 });
    if (caso.dos) await page.evaluate(CARGAR_TX, { desc: 'Niñera', monto: 8000 });

    // Dejar que corran los retries con backoff
    await page.waitForTimeout(1200);
    await page.evaluate(() => processPendingQueue());
    await page.waitForTimeout(1500);

    const estado = await page.evaluate(ESTADO);
    const extra = caso.esperadoExtra ? await caso.esperadoExtra(page) : {};
    const esperado = { ...caso.esperado, ...(caso.esperadoExtraValores || {}) };
    const real = { ...estado, ...extra };
    const fallas = Object.entries(esperado)
      .filter(([k, v]) => real[k] !== v)
      .map(([k, v]) => `${k}: esperaba ${v}, hubo ${real[k]}`);
    resultados.push({ caso: caso.nombre, ok: fallas.length === 0, fallas, real, porque: caso.porque });
    await ctx.close();
  }
  await browser.close();

  let fallaron = 0;
  for (const r of resultados) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.caso}`);
    console.log(`   ${r.porque}`);
    if (!r.ok) { fallaron++; r.fallas.forEach(f => console.log(`   ⚠️  ${f}`)); console.log('   estado:', JSON.stringify(r.real)); }
  }
  console.log(`\n${resultados.length - fallaron}/${resultados.length} pasaron`);
  process.exit(fallaron ? 1 : 0);
})();
