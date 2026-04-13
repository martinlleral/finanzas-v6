/**
 * Finanzas V6.2 — Google Apps Script backend (v2.1)
 *
 * IMPORTANTE - SETEAR ANTES DE DESPLEGAR:
 *   Generá un token random en https://www.uuidgenerator.net/ y pegalo en
 *   SECRET_TOKEN. El frontend lo envía en cada request. Si el token no
 *   coincide, el script rechaza la operación. Esto cierra el agujero de
 *   "el link es la única llave".
 *
 * ROTACIÓN: si el link/QR leakea, generá un token nuevo, peguálo acá,
 *   redeplegá, y actualizá el token en cada dispositivo desde la app.
 */
const SECRET_TOKEN = 'CAMBIAR-POR-UN-TOKEN-RANDOM-DE-32-CHARS';

const VALID_TYPES = ['Ingreso', 'Egreso', '__CONFIG__'];
const MAX_BATCH = 50;
const MAX_AMOUNT = 100000000; // 100 millones, sanity check
const MAX_DESC_LEN = 500;

/**
 * Finanzas V6.2 — Google Apps Script backend (v2)
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
 * Estructura del sheet (columnas A a G):
 *   A Fecha | B Tipo | C Categoría | D Subcategoría | E Monto | F Descripción | G Forma de Pago
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

function getSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
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

function ensurePaymentColumn_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 7) {
    sheet.getRange(1, 7).setValue('Forma de Pago');
  } else {
    const header = sheet.getRange(1, 7).getValue();
    if (!header) sheet.getRange(1, 7).setValue('Forma de Pago');
  }
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
      p: String(row[6] || '')
    });
  }
  return result;
}

/* ---------- Write ---------- */

function appendRow_(sheet, body) {
  // Validaciones de seguridad
  const type = String(body.type || '');
  if (!VALID_TYPES.includes(type)) throw new Error('Tipo inválido: ' + type);
  const amount = Number(body.amount);
  if (!isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) {
    throw new Error('Monto inválido: ' + body.amount);
  }
  const desc = String(body.description || '').slice(0, MAX_DESC_LEN);
  const dateStr = formatDate_(body.date || new Date().toISOString());
  sheet.appendRow([
    dateStr,
    type,
    String(body.category || '').slice(0, 100),
    String(body.subcategory || '').slice(0, 100),
    amount,
    desc,
    String(body.paymentMethod || body.p || '').slice(0, 50)
  ]);
}

function addTransaction(body) {
  const sheet = getSheet();
  ensurePaymentColumn_(sheet);
  appendRow_(sheet, body);
}

function addTransactions(txs) {
  const sheet = getSheet();
  ensurePaymentColumn_(sheet);
  txs.forEach(function (tx) { appendRow_(sheet, tx); });
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

function deleteTransaction(sig) {
  const sheet = getSheet();
  const rowNum = findRowIndexBySignature_(sheet, sig);
  if (rowNum < 0) return 0;
  sheet.deleteRow(rowNum);
  return 1;
}

function updateTransaction(sig, changes) {
  const sheet = getSheet();
  const rowNum = findRowIndexBySignature_(sheet, sig);
  if (rowNum < 0) return 0;
  if (changes.d !== undefined) sheet.getRange(rowNum, 1).setValue(formatDate_(changes.d));
  if (changes.t !== undefined) sheet.getRange(rowNum, 2).setValue(changes.t);
  if (changes.c !== undefined) sheet.getRange(rowNum, 3).setValue(changes.c);
  if (changes.s !== undefined) sheet.getRange(rowNum, 4).setValue(changes.s);
  if (changes.a !== undefined) sheet.getRange(rowNum, 5).setValue(Number(changes.a));
  if (changes.desc !== undefined) sheet.getRange(rowNum, 6).setValue(changes.desc);
  if (changes.p !== undefined) sheet.getRange(rowNum, 7).setValue(changes.p);
  return 1;
}

/* ---------- Auth ---------- */

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
  if (!SECRET_TOKEN || SECRET_TOKEN === 'CAMBIAR-POR-UN-TOKEN-RANDOM-DE-32-CHARS') {
    // Token no configurado: permitir (modo migración)
    return true;
  }
  if (token !== SECRET_TOKEN) throw new Error('Unauthorized');
  return true;
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
    checkAuth_(e);
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    if (action === 'addTransaction') {
      addTransaction(body);
      return jsonResponse({ ok: true });
    }
    if (action === 'addTransactions' && Array.isArray(body.txs)) {
      if (body.txs.length > MAX_BATCH) {
        return jsonResponse({ error: 'Batch too large (max ' + MAX_BATCH + ')' });
      }
      addTransactions(body.txs);
      return jsonResponse({ ok: true, count: body.txs.length });
    }
    if (action === 'deleteTransaction') {
      Logger.log('DELETE request: ' + JSON.stringify(body.signature || {}));
      const n = deleteTransaction(body.signature || {});
      return jsonResponse({ ok: true, deleted: n });
    }
    if (action === 'updateTransaction') {
      Logger.log('UPDATE request: ' + JSON.stringify(body.signature || {}));
      const n = updateTransaction(body.signature || {}, body.changes || {});
      return jsonResponse({ ok: true, updated: n });
    }
    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
}
