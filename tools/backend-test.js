/**
 * Tests del backend Apps Script, con un Google Sheets simulado.
 *
 * El sync-test.js prueba el CLIENTE contra un servidor simulado. Esto es al
 * revés: prueba el SERVIDOR de verdad (el .gs que se va a pegar en producción)
 * contra una hoja simulada. Sin esto, la mitad del fix de duplicados —la que
 * realmente decide si se escribe una fila o no— nunca se ejecutaba fuera de
 * Google.
 *
 * Uso:  node tools/backend-test.js server/apps_script.gs
 */
const fs = require('fs');

function montarEntorno(filasIniciales, opts = {}) {
  const props = Object.assign({ SECRET_TOKEN: 'tok-de-prueba' }, opts.props || {});
  const hoja = {
    filas: filasIniciales.map(r => r.slice()),
    maxRows: opts.maxRows || 1000,
    maxCols: opts.maxCols || 26,
  };

  const rango = (fila, col, nFilas, nCols) => ({
    getValues() {
      const out = [];
      for (let i = 0; i < nFilas; i++) {
        const r = hoja.filas[fila - 1 + i] || [];
        out.push(Array.from({ length: nCols }, (_, j) => r[col - 1 + j] ?? ''));
      }
      return out;
    },
    setValues(vals) {
      vals.forEach((v, i) => {
        const idx = fila - 1 + i;
        if (idx >= hoja.maxRows) throw new Error('Se agotaron las filas de la grilla');
        hoja.filas[idx] = hoja.filas[idx] || [];
        v.forEach((x, j) => { hoja.filas[idx][col - 1 + j] = x; });
      });
    },
    setValue(v) { this.setValues([[v]]); },
  });

  const sheet = {
    getLastRow: () => hoja.filas.length,
    getMaxRows: () => hoja.maxRows,
    getMaxColumns: () => hoja.maxCols,
    insertColumnsAfter: (_, n) => { hoja.maxCols += n; },
    getRange: rango,
    getDataRange: () => rango(1, 1, Math.max(hoja.filas.length, 1), 9),
    appendRow(v) {
      // appendRow expande la grilla sola, igual que el de verdad
      if (hoja.filas.length + 1 > hoja.maxRows) hoja.maxRows = hoja.filas.length + 1;
      hoja.filas.push(v.slice());
    },
    deleteRow: (n) => { hoja.filas.splice(n - 1, 1); },
  };

  global.PropertiesService = { getScriptProperties: () => ({
    getProperty: k => (props[k] === undefined ? null : props[k]),
    setProperty: (k, v) => { props[k] = v; } }) };
  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({ getSheetByName: n => (n === 'Movimientos' ? sheet : null),
                                   getSheets: () => [sheet] }),
    flush: () => {} };
  global.LockService = { getScriptLock: () => ({
    tryLock: () => opts.lockOcupado !== true, releaseLock: () => {} }) };
  global.ContentService = { createTextOutput: t => ({ setMimeType: () => t }),
                            MimeType: { JSON: 'json' } };
  global.Utilities = { formatDate: () => '2026-08-01', getUuid: () => 'x'.repeat(36) };
  global.Session = { getScriptTimeZone: () => 'UTC' };
  global.Logger = { log: () => {} };
  return hoja;
}

const tx = (uid, desc, extra = {}) => Object.assign({
  action: 'addTransaction', token: 'tok-de-prueba', uid,
  date: '2026-08-01', type: 'Egreso', category: 'HogarYVida',
  subcategory: 'Familia', amount: 8000, description: desc, paymentMethod: '',
}, extra);

const post = (body) => JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } }));

// ── Casos ────────────────────────────────────────────────────────────────────
const CASOS = [
  ['un alta escribe UNA fila, con su uid en la columna H', () => {
    const h = montarEntorno([]);
    const r = post(tx('u1', 'Niñera'));
    return r.ok && r.written === 1 && h.filas.length === 1 && h.filas[0][7] === 'u1';
  }],

  ['reenviar el MISMO uid no duplica (el fix de raíz)', () => {
    const h = montarEntorno([]);
    post(tx('u1', 'Niñera'));
    const r = post(tx('u1', 'Niñera'));
    return h.filas.length === 1 && r.written === 0 && r.skipped[0] === 'u1';
  }],

  ['dos gastos IDÉNTICOS con uid distinto se guardan los DOS', () => {
    const h = montarEntorno([]);
    post(tx('u1', 'Niñera'));
    post(tx('u2', 'Niñera'));
    return h.filas.length === 2;
  }],

  ['uid repetido DENTRO del mismo batch se saltea', () => {
    const h = montarEntorno([]);
    const r = post({ action: 'addTransactions', token: 'tok-de-prueba',
                     txs: [tx('u1', 'a'), tx('u1', 'a'), tx('u2', 'b')] });
    return h.filas.length === 2 && r.written === 2 && r.skipped.length === 1;
  }],

  ['una fila legacy (uid vacío) NO bloquea una nueva igual', () => {
    const h = montarEntorno([['2026-08-01', 'Egreso', 'HogarYVida', 'Familia', 8000, 'Niñera', '', '']]);
    post(tx('u1', 'Niñera'));
    return h.filas.length === 2;
  }],

  ['batch inválido no escribe NADA (se valida todo antes)', () => {
    const h = montarEntorno([]);
    const r = post({ action: 'addTransactions', token: 'tok-de-prueba',
                     txs: [tx('u1', 'ok'), tx('u2', 'malo', { type: 'TipoInexistente' })] });
    return h.filas.length === 0 && !!r.error && r.retriable === false;
  }],

  ['monto de 9 dígitos ENTRA (antes lo rechazaba como fatal)', () => {
    const h = montarEntorno([]);
    const r = post(tx('u1', 'grande', { amount: 999999999 }));
    return r.ok && h.filas.length === 1;
  }],

  ['la config larga NO se trunca a 500 (el P0)', () => {
    const h = montarEntorno([]);
    const largo = 'B'.repeat(3000);
    post(tx('cfg1', largo, { type: '__CONFIG__', category: 'schema', amount: 0 }));
    return h.filas[0][5].length === 3000;
  }],

  ['una descripción normal SÍ se sigue truncando a 500', () => {
    const h = montarEntorno([]);
    post(tx('u1', 'C'.repeat(3000)));
    return h.filas[0][5].length === 500;
  }],

  ['lock ocupado → error TRANSITORIO (no descarta la transacción)', () => {
    montarEntorno([], { lockOcupado: true });
    const r = post(tx('u1', 'Niñera'));
    return !!r.error && r.retriable === true;
  }],

  ['sin token configurado → rechaza, y como transitorio', () => {
    montarEntorno([], { props: { SECRET_TOKEN: '' } });
    const r = post(tx('u1', 'Niñera'));
    return r.error === 'Unauthorized' && r.retriable === true;
  }],

  ['token incorrecto → rechaza', () => {
    const h = montarEntorno([]);
    const r = post(Object.assign(tx('u1', 'Niñera'), { token: 'otro' }));
    return r.error === 'Unauthorized' && h.filas.length === 0;
  }],

  ['appendRow expande la grilla al llegar al tope', () => {
    const previas = Array.from({ length: 5 }, (_, i) =>
      ['2026-08-01', 'Egreso', 'X', 'Y', 100, 'f' + i, '', '']);
    const h = montarEntorno(previas, { maxRows: 5 });   // grilla llena
    const r = post(tx('u1', 'Niñera'));
    return r.ok && h.filas.length === 6;
  }],

  ['getRawData devuelve el uid en el campo u', () => {
    montarEntorno([]);
    post(tx('u1', 'Niñera'));
    post(tx('u2', 'Otro'));
    const filas = getRawData();          // saltea la fila 1, que es de datos
    return filas.length === 1 && filas[0].u === 'u2';
  }],

  ['delete por uid borra ESA fila y no otra igual', () => {
    const h = montarEntorno([]);
    post(tx('u1', 'Niñera'));
    post(tx('u2', 'Niñera'));            // idéntica salvo el uid
    post(tx('u3', 'Otra'));
    const r = post({ action: 'deleteTransaction', token: 'tok-de-prueba', uid: 'u2',
                     signature: { d: '2026-08-01', t: 'Egreso', c: 'HogarYVida',
                                  s: 'Familia', a: 8000, desc: 'Niñera' } });
    return r.deleted === 1 && h.filas.length === 2
        && h.filas.map(f => f[7]).join(',') === 'u1,u3';
  }],

  ['el origen se escribe en la columna I', () => {
    const h = montarEntorno([]);
    post(Object.assign(tx('u1', 'Niñera'), { origen: 'iPhone de Lau' }));
    return h.filas[0][8] === 'iPhone de Lau';
  }],

  ['un cliente viejo sin origen no rompe nada', () => {
    const h = montarEntorno([]);
    const b = tx('u1', 'Niñera'); delete b.origen;
    const r = post(b);
    return r.ok && h.filas[0][8] === '' && h.filas[0][7] === 'u1';
  }],

  ['getRawData devuelve el origen en el campo o', () => {
    montarEntorno([]);
    post(Object.assign(tx('u1', 'a'), { origen: 'Mac' }));
    post(Object.assign(tx('u2', 'b'), { origen: 'iPhone de Lau' }));
    return getRawData()[0].o === 'iPhone de Lau';
  }],

  ['INVARIANTE: el lock del servidor expira MUY antes del timeout del cliente', () => {
    // El bug que dejó 19 movimientos colgados: lock 25s vs cliente 15s. El
    // cliente abortaba antes, pero abortar no cancela la ejecución de Apps
    // Script, así que cada reintento encolaba otra ejecución detrás.
    const gs = fs.readFileSync('server/apps_script.gs', 'utf8');
    const cli = fs.readFileSync('index.html', 'utf8');
    const lock = +(/const LOCK_MS = (\d+)/.exec(gs) || [])[1];
    const post_ = +(/const POST_TIMEOUT_MS = (\d+)/.exec(cli) || [])[1];
    return lock > 0 && post_ > 0 && post_ >= lock * 3;
  }],

  ['una fila borrada libera su uid para un alta nueva', () => {
    const h = montarEntorno([]);
    post(tx('u1', 'Niñera'));
    post({ action: 'deleteTransaction', token: 'tok-de-prueba', uid: 'u1', signature: {} });
    post(tx('u1', 'Niñera'));
    return h.filas.length === 1;
  }],
];

// ── Corrida ──────────────────────────────────────────────────────────────────
const src = fs.readFileSync(process.argv[2] || 'server/apps_script.gs', 'utf8');
let malos = 0;
for (const [nombre, fn] of CASOS) {
  let r;
  try { eval(src); r = fn(); } catch (e) { r = 'ERROR: ' + e.message; }
  if (r !== true) { malos++; console.log('❌ ' + nombre + '  → ' + r); }
  else console.log('✅ ' + nombre);
}
console.log(`\n${CASOS.length - malos}/${CASOS.length} pasaron`);
process.exit(malos ? 1 : 0);
