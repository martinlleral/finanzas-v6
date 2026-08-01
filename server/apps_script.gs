/**
 * Finanzas V6.2 — Google Apps Script backend (v3)
 *
 * EL TOKEN NO ESTÁ EN ESTE ARCHIVO, Y ES A PROPÓSITO.
 *
 * Vive en las Propiedades del script (Configuración del proyecto →
 * Propiedades del script → SECRET_TOKEN). Antes era una constante acá, con un
 * placeholder en el repo y el valor real solo en el editor: como el
 * procedimiento de despliegue es "seleccioná todo y reemplazá", pegar este
 * archivo pisaba el token real con el placeholder — y checkAuth_ tenía un modo
 * permisivo justo para ese placeholder, así que la autenticación se apagaba
 * EN SILENCIO y cualquiera con la URL quedaba con acceso de lectura y
 * escritura a la planilla familiar.
 *
 * Con el token afuera del código, pegar el archivo entero ya no puede
 * romperlo. Y si no está configurado, el script RECHAZA todo en vez de dejar
 * pasar: fallar cerrado se detecta en el primer uso, fallar abierto no se
 * detecta nunca.
 *
 * SETUP (una sola vez): ver setupToken_ y migrarTokenAPropiedades más abajo.
 * ROTACIÓN: cambiar el valor de la propiedad SECRET_TOKEN y actualizarlo en
 *   cada dispositivo desde ⚙️ de la app. No hace falta redesplegar.
 */

const VALID_TYPES = ['Ingreso', 'Egreso', '__CONFIG__'];
const MAX_BATCH = 50;
// Tiene que coincidir con lo que el cliente PUEDE tipear (9 dígitos en pressNum).
// Antes el cliente aceptaba hasta 999.999.999 y el servidor cortaba en 100.000.000:
// cualquier monto de 9 dígitos se rechazaba como error de validación y la
// transacción terminaba descartada. Si se cambia acá, cambiar también
// MAX_AMOUNT_CLIENTE en index.html.
const MAX_AMOUNT = 999999999;
const MAX_DESC_LEN = 500;

// Las filas __CONFIG__ guardan el SCHEMA de la app serializado en base64 dentro
// del campo descripción. Con el tope de 500 el schema quedaba CORTADO A LA MITAD
// (medía 517) y la sincronización de categorías entre dispositivos moría en
// silencio. El tope de 500 sigue vigente para transacciones reales: ahí es una
// defensa buena.
const MAX_CONFIG_LEN = 40000;

// Columna H = uid. Es la clave de idempotencia: si una fila con ese uid ya
// existe, el POST se saltea en vez de duplicar. Aditiva y retrocompatible —
// las filas viejas (y las que escribe cierre.py) tienen uid vacío y se tratan
// como "sin idempotencia, escribir siempre".
const UID_COL = 8;
const LOCK_MS = 25000;

/**
 * Instalación y estructura
 *
 * Instrucciones de instalación (se hace UNA sola vez):
 *   1) Abrir el spreadsheet "APP Familia" en Google Sheets
 *   2) Extensiones → Apps Script
 *   3) Seleccionar TODO el código existente y reemplazarlo por este archivo
 *   4) Guardar (disquete o Ctrl+S)
 *   5) Desplegar → Administrar implementaciones → editar (lápiz) la
 *      implementación existente → Versión: Nueva versión → Desplegar
 *   6) La URL (ya guardada en la app via ⚙️) NO cambia al redesplegar.
 *
 * Estructura del sheet (columnas A a H):
 *   A Fecha | B Tipo | C Categoría | D Subcategoría | E Monto | F Descripción | G Forma de Pago | H uid
 *
 * OJO: el sheet NO tiene fila de header. La fila 1 es un movimiento real (con
 * el texto "Forma de Pago" pegado en G1 por un bug viejo de ensurePaymentColumn_,
 * que ya no se llama). getRawData() la saltea, así que ese movimiento es
 * invisible para la app. No escribir nada en la fila 1.
 *
 * Endpoints GET:
 *   ?action=getRawData             → devuelve todas las transacciones como JSON
 *
 * Endpoints POST (body JSON):
 *   {action:'addTransaction', ...}           → agrega una fila
 *   {action:'addTransactions', txs:[...]}    → agrega múltiples (para extracciones duales)
 *   {action:'deleteTransaction', signature}  → elimina por firma (retrocompat Tier 3)
 *   {action:'updateTransaction', signature, changes}  → edita por firma (Tier 3)
 *
 * La firma es un objeto con {d, t, c, s, a, desc} que identifica unívocamente
 * la fila a tocar. El matching se hace por igualdad exacta de todos los campos.
 *
 * NOTA de seguridad: este script asume que sólo los usuarios con acceso al
 * spreadsheet lo invocan. No hay autenticación propia — confía en el link
 * de deploy siendo privado.
 */

/* ---------- Helpers ---------- */

/**
 * La hoja de movimientos, POR NOMBRE.
 *
 * Antes era `getSheets()[0]`, que es frágil: cualquiera que agregue o reordene
 * una pestaña (por ejemplo el backup que crea dedupe_movimientos.py) hacía que
 * la app leyera una hoja vacía y pisara el caché local con []. Además cierre.py
 * ya usa `worksheet('Movimientos')`, así que ahora los dos apuntan a lo mismo.
 * Se mantiene el fallback al índice 0 por si algún día se renombra la pestaña.
 */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('Movimientos') || ss.getSheets()[0];
}

/**
 * Distinguir errores TRANSITORIOS de errores de VALIDACIÓN es crítico.
 *
 * El cliente descarta (a dead-letter) todo lo que el servidor marque como
 * error, porque reintentar un "Tipo inválido" 8 veces no lo arregla. Pero si
 * un lock ocupado o un timeout de Google llegaran con la misma forma, la
 * transacción se perdería por un problema que se resolvía solo reintentando.
 * Reintentar es seguro: el uid impide que se duplique.
 */
const PREFIJO_TRANSITORIO = 'TRANSITORIO: ';

function esTransitorio_(err) {
  const m = String(err && err.message ? err.message : err);
  return m.indexOf(PREFIJO_TRANSITORIO) !== -1
    || /timed? ?out|timeout|too many|rate|internal error|try again|service unavailable|temporarily/i.test(m);
}

/**
 * Asegura que la grilla tenga las 8 columnas que necesita appendRow.
 *
 * Las FILAS no hacen falta: appendRow expande la grilla solo. Las columnas sí,
 * porque si la pestaña quedara recortada a 7, appendRow con 8 valores falla.
 */
function ensureColumns_(sheet) {
  const faltan = UID_COL - sheet.getMaxColumns();
  if (faltan > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), faltan);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatDate_(value) {
  if (value == null || value === '') return '';
  // Caso 1: Date nativo
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  // Caso 2: string. Puede ser:
  //   - ISO "2025-11-05" o "2025-11-05T10:00:00Z"
  //   - Date.toString() "Wed Nov 05 2025 00:00:00 GMT-0300 (...)"
  //   - "YYYY/MM/DD" u otros
  const str = String(value);
  // Si ya arranca con YYYY-MM-DD es ISO, devolver los primeros 10 chars
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  // Intentar parsear como Date
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  // Fallback: truncar (no debería pasar)
  return str.slice(0, 10);
}

/**
 * OBSOLETA — no llamar. Escribía un header sobre la fila 1, que en este sheet
 * es una fila de DATOS (no hay header). Así fue como el texto "Forma de Pago"
 * terminó siendo la forma de pago del movimiento del 3/11/2025. La columna G ya
 * existe en todas las filas; queda acá solo como registro de por qué no está.
 */
function ensurePaymentColumn_(sheet) {
  return; // no-op deliberado
}

/**
 * Corre `fn` con el lock del script tomado y commitea ANTES de soltarlo.
 *
 * El flush() no es decorativo: sin él, dos POST seguidos con el mismo uid
 * pueden pasar los dos, porque el segundo lee un índice de uids que todavía no
 * tiene la escritura del primero.
 *
 * LIMITACIÓN CONOCIDA: LockService solo serializa ejecuciones de Apps Script.
 * cierre.py (skill /cierremdp) escribe con la Sheets API vía service account y
 * NO respeta este lock. Por eso addTransactionsAtomic_ escribe con appendRow y
 * no con setValues sobre getLastRow()+1: appendRow resuelve el punto de
 * inserción del lado del servidor, así que una escritura concurrente del cierre
 * no se puede pisar. En el peor caso quedan dos filas seguidas en otro orden.
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) {
    // TRANSITORIO, no un error de validación: pasa cuando dos dispositivos de
    // la familia guardan al mismo tiempo. El prefijo lo usa esTransitorio_()
    // para que el cliente REINTENTE en vez de descartar la transacción.
    throw new Error(PREFIJO_TRANSITORIO + 'Sheet ocupado, reintentá');
  }
  try {
    const r = fn();
    SpreadsheetApp.flush();
    return r;
  } finally {
    lock.releaseLock();
  }
}

/** Mapa uid → nº de fila. Barato: una sola columna. */
function readUidIndex_(sheet) {
  const last = sheet.getLastRow();
  const idx = {};
  if (last < 1) return idx;
  const vals = sheet.getRange(1, UID_COL, last, 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    const u = String(vals[i][0] || '').trim();
    if (u) idx[u] = i + 1;
  }
  return idx;
}

/* ---------- Read ---------- */

function getRawData() {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const result = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[0]) continue;
    result.push({
      d: formatDate_(row[0]),
      t: String(row[1] || ''),
      c: String(row[2] || ''),
      s: String(row[3] || ''),
      a: Number(row[4] || 0),
      desc: String(row[5] || ''),
      p: String(row[6] || ''),
      u: String(row[7] || '')   // uid: '' en filas legacy y en las de cierre.py
    });
  }
  return result;
}

/* ---------- Write ---------- */

/** Valida y arma la fila. NO escribe: eso lo hace addTransactionsAtomic_. */
function rowFromBody_(body) {
  const type = String(body.type || '');
  if (VALID_TYPES.indexOf(type) === -1) throw new Error('Tipo inválido: ' + type);
  const amount = Number(body.amount);
  if (!isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) {
    throw new Error('Monto inválido: ' + body.amount);
  }
  // El tope de descripción es más alto para __CONFIG__: ahí no va una
  // descripción sino el SCHEMA serializado, que con 500 quedaba truncado.
  const topeDesc = (type === '__CONFIG__') ? MAX_CONFIG_LEN : MAX_DESC_LEN;
  return [
    formatDate_(body.date || new Date().toISOString()),
    type,
    String(body.category || '').slice(0, 100),
    String(body.subcategory || '').slice(0, 100),
    amount,
    String(body.description || '').slice(0, topeDesc),
    String(body.paymentMethod || body.p || '').slice(0, 50),
    String(body.uid || '').slice(0, 64)   // '' si el cliente es viejo → sin dedupe
  ];
}

/**
 * Escritura idempotente.
 *
 * 1) Valida TODAS las filas antes de escribir ninguna. El forEach(appendRow_)
 *    de v2 validaba sobre la marcha: si la 2ª tx de una extracción dual
 *    fallaba, la 1ª ya había quedado escrita (media transferencia en el sheet).
 * 2) Saltea las filas cuyo uid ya está en el sheet o repetido en el batch.
 *    Esto es lo que mata los duplicados: un reintento del cliente ya no
 *    escribe una segunda fila.
 * 3) Escribe con appendRow, UNA fila por vez.
 *
 * Sobre el punto 3: la tentación es hacer un solo `setValues` en
 * `getLastRow()+1`, que es más rápido y "más atómico". Es un error, y grave.
 * Ese patrón resuelve el punto de inserción en un RPC y escribe en otro, así
 * que si `cierre.py` (skill /cierremdp, service account, fuera del alcance del
 * LockService) appendea en el medio, el setValues le PISA las filas. Sin error,
 * sin duplicado, sin rastro: movimientos reales que desaparecen.
 * `appendRow` resuelve el punto de inserción del lado del servidor de forma
 * atómica — Google lo documenta para exactamente esta carrera — y además
 * expande la grilla sola cuando se acaban las filas.
 *
 * ¿Y la atomicidad del batch? La da el uid, no el setValues: si la 2ª fila
 * falla por un error de infraestructura, el reintento del cliente reenvía las
 * dos y el servidor saltea la que ya escribió. Idempotencia > atomicidad.
 */
function addTransactionsAtomic_(bodies) {
  return withLock_(function () {
    const sheet = getSheet();
    const seen = readUidIndex_(sheet);
    const rows = [];
    const skipped = [];
    bodies.forEach(function (b) {
      const row = rowFromBody_(b);
      const uid = row[UID_COL - 1];
      const dupEnBatch = uid && rows.some(function (r) { return r[UID_COL - 1] === uid; });
      if (uid && (seen[uid] || dupEnBatch)) { skipped.push(uid); return; }
      rows.push(row);
    });
    if (rows.length) {
      ensureColumns_(sheet);
      rows.forEach(function (r) { sheet.appendRow(r); });
    }
    return { ok: true, written: rows.length, skipped: skipped };
  });
}

/* ---------- Delete / Update (Tier 3) ---------- */

function matchSignature_(row, sig) {
  return formatDate_(row[0]) === String(sig.d || '')
    && String(row[1] || '') === String(sig.t || '')
    && String(row[2] || '') === String(sig.c || '')
    && String(row[3] || '') === String(sig.s || '')
    && Number(row[4] || 0) === Number(sig.a || 0)
    && String(row[5] || '') === String(sig.desc || '');
}

function findRowIndexBySignature_(sheet, sig) {
  const values = sheet.getDataRange().getValues();
  // Busco de atrás hacia adelante: suele ser la tx más reciente
  for (let i = values.length - 1; i >= 1; i--) {
    if (matchSignature_(values[i], sig)) return i + 1; // 1-indexed row
  }
  return -1;
}

/**
 * Ubica la fila a tocar. Prefiere el uid (exacto, sin ambigüedad) y cae a la
 * firma para las filas legacy que no lo tienen.
 *
 * Por qué importa: findRowIndexBySignature_ recorre de atrás para adelante y
 * devuelve el primer match. Con filas duplicadas eso significa que borrar o
 * editar tocaba una fila arbitraria — no necesariamente la que el usuario vio.
 */
function findRow_(sheet, sig, uid) {
  if (uid) {
    const hit = readUidIndex_(sheet)[uid];
    if (hit) return hit;
  }
  return findRowIndexBySignature_(sheet, sig);
}

function deleteTransaction(sig, uid) {
  return withLock_(function () {
    const sheet = getSheet();
    const rowNum = findRow_(sheet, sig, uid);
    if (rowNum < 0) return 0;
    sheet.deleteRow(rowNum);
    return 1;
  });
}

function updateTransaction(sig, changes, uid) {
  return withLock_(function () {
    const sheet = getSheet();
    const rowNum = findRow_(sheet, sig, uid);
    if (rowNum < 0) return 0;
    if (changes.d !== undefined) sheet.getRange(rowNum, 1).setValue(formatDate_(changes.d));
    if (changes.t !== undefined) sheet.getRange(rowNum, 2).setValue(changes.t);
    if (changes.c !== undefined) sheet.getRange(rowNum, 3).setValue(changes.c);
    if (changes.s !== undefined) sheet.getRange(rowNum, 4).setValue(changes.s);
    if (changes.a !== undefined) sheet.getRange(rowNum, 5).setValue(Number(changes.a));
    if (changes.desc !== undefined) sheet.getRange(rowNum, 6).setValue(changes.desc);
    if (changes.p !== undefined) sheet.getRange(rowNum, 7).setValue(changes.p);
    return 1;
  });
}

/* ---------- Auth ---------- */

/** El token vigente, desde las Propiedades del script. Nunca desde el código. */
function getToken_() {
  return String(PropertiesService.getScriptProperties()
                  .getProperty('SECRET_TOKEN') || '').trim();
}

/**
 * Comparación en tiempo constante.
 *
 * Un `!==` sobre strings corta en el primer carácter distinto, así que el
 * tiempo de respuesta filtra cuántos caracteres del token acertaste. Con un
 * endpoint público eso es adivinable. El costo de hacerlo bien es nulo.
 */
function tokensIguales_(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

function checkAuth_(e) {
  // El token puede venir por query (GET) o en el body JSON (POST)
  let token = '';
  if (e && e.parameter && e.parameter.token) token = e.parameter.token;
  if (e && e.postData && e.postData.contents) {
    try {
      const body = JSON.parse(e.postData.contents);
      if (body && body.token) token = body.token;
    } catch (err) {}
  }
  const esperado = getToken_();
  if (!esperado) {
    // FALLA CERRADO. La versión anterior hacía lo contrario —"token no
    // configurado: permitir (modo migración)"— y ese modo permisivo es
    // justamente lo que convertía un despliegue mal hecho en un sheet
    // familiar abierto a cualquiera con la URL, sin ninguna señal.
    // Cerrado se nota en el primer uso; abierto no se nota nunca.
    throw new Error('SECRET_TOKEN no configurado en las Propiedades del script. '
                  + 'Correr setupToken_() desde el editor.');
  }
  if (!tokensIguales_(String(token), esperado)) throw new Error('Unauthorized');
  return true;
}

/* ---------- Setup del token (correr a mano, UNA vez) ---------- */

/**
 * PASO 1 DE LA MIGRACIÓN — correr esto ANTES de pegar el código nuevo.
 *
 * Pegá esta función sola al final del código que YA está desplegado (el que
 * todavía tiene `const SECRET_TOKEN = '...'`) y ejecutala una vez. Copia el
 * token vigente a las Propiedades del script sin que tengas que verlo ni
 * copiarlo a mano.
 *
 *   function migrarTokenAPropiedades() {
 *     PropertiesService.getScriptProperties()
 *       .setProperty('SECRET_TOKEN', SECRET_TOKEN);
 *     Logger.log('Token migrado. Largo: ' + SECRET_TOKEN.length);
 *   }
 *
 * Después de correrla, ya podés pegar este archivo entero sin riesgo.
 */

/** Genera y guarda un token nuevo. Para el setup inicial o para rotar. */
function setupToken_() {
  const nuevo = Utilities.getUuid().replace(/-/g, '')
              + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  PropertiesService.getScriptProperties().setProperty('SECRET_TOKEN', nuevo);
  Logger.log('Token nuevo guardado en las Propiedades del script:\n\n' + nuevo
           + '\n\nCargalo en cada dispositivo desde ⚙️ de la app. '
           + 'Hasta que lo hagas, esos dispositivos no van a poder sincronizar.');
  return nuevo;
}

/** Verifica el estado sin revelar el token. Correr desde el editor. */
function verificarToken_() {
  const t = getToken_();
  Logger.log(t
    ? 'OK: hay un SECRET_TOKEN configurado (' + t.length + ' caracteres). '
      + 'La autenticación está activa.'
    : '⚠️ NO hay SECRET_TOKEN configurado. El script está rechazando TODO. '
      + 'Correr migrarTokenAPropiedades() (si venís de la versión vieja) '
      + 'o setupToken_() (si arrancás de cero).');
  return !!t;
}

/* ---------- Mantenimiento (correr a mano desde el editor) ---------- */

/**
 * Limpia la columna G (Forma de Pago) donde contenga timestamps de JavaScript
 * tipo "Wed Nov 05 2025 00:00:00 GMT-0300". Deja el header y los valores
 * legítimos (Efectivo/Banco/MP) intactos.
 *
 * Para ejecutar: en el editor de Apps Script, seleccionar esta función
 * en el desplegable superior y tocar ▶ Ejecutar.
 */
function cleanPaymentColumnTimestamps() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const range = sheet.getRange(2, 7, lastRow - 1, 1);
  const values = range.getValues();
  let cleaned = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i][0];
    // Un timestamp legacy contiene "GMT" o es un Date object completo
    if (v instanceof Date || /GMT|\d{4} \d{2}:\d{2}/.test(String(v))) {
      values[i][0] = '';
      cleaned++;
    }
  }
  range.setValues(values);
  Logger.log('Filas limpiadas: ' + cleaned);
}

/**
 * Normaliza las fechas de la columna A: si hay strings con formato
 * "Wed Nov 05 2025..." las convierte a Date reales. Útil si el Apps Script
 * viejo escribió fechas como texto.
 *
 * Para ejecutar: seleccionar del desplegable y tocar ▶ Ejecutar.
 */
function normalizeDateColumn() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const range = sheet.getRange(2, 1, lastRow - 1, 1);
  const values = range.getValues();
  let fixed = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i][0];
    if (v instanceof Date) continue;
    if (!v) continue;
    const parsed = new Date(String(v));
    if (!isNaN(parsed.getTime())) {
      values[i][0] = parsed;
      fixed++;
    }
  }
  range.setValues(values);
  Logger.log('Fechas normalizadas: ' + fixed);
}

/* ---------- Entrypoints ---------- */

function doGet(e) {
  try {
    checkAuth_(e);
  } catch (err) {
    return jsonResponse({ error: 'Unauthorized' });
  }
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'getRawData') {
    return jsonResponse(getRawData());
  }
  return jsonResponse({ error: 'Unknown action' });
}

function doPost(e) {
  try {
    try {
      checkAuth_(e);
    } catch (authErr) {
      // Un token mal configurado NO es culpa de la transacción: marcarlo
      // transitorio evita que el cliente tire a la basura todo lo que tenía
      // en la cola mientras el token estaba mal.
      return jsonResponse({ error: 'Unauthorized', retriable: true });
    }
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    if (action === 'addTransaction') {
      return jsonResponse(addTransactionsAtomic_([body]));
    }
    if (action === 'addTransactions' && Array.isArray(body.txs)) {
      if (body.txs.length > MAX_BATCH) {
        return jsonResponse({ error: 'Batch too large (max ' + MAX_BATCH + ')' });
      }
      return jsonResponse(addTransactionsAtomic_(body.txs));
    }
    if (action === 'deleteTransaction') {
      Logger.log('DELETE request: ' + JSON.stringify(body.signature || {}));
      const n = deleteTransaction(body.signature || {}, body.uid || '');
      return jsonResponse({ ok: true, deleted: n });
    }
    if (action === 'updateTransaction') {
      Logger.log('UPDATE request: ' + JSON.stringify(body.signature || {}));
      const n = updateTransaction(body.signature || {}, body.changes || {}, body.uid || '');
      return jsonResponse({ ok: true, updated: n });
    }
    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    Logger.log('doPost error: ' + err);
    return jsonResponse({ error: String(err), retriable: esTransitorio_(err) });
  }
}
