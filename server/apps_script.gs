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
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value || '').slice(0, 10);
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
  const dateStr = formatDate_(body.date || new Date().toISOString());
  sheet.appendRow([
    dateStr,
    body.type || '',
    body.category || '',
    body.subcategory || '',
    Number(body.amount) || 0,
    body.description || '',
    body.paymentMethod || body.p || ''
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

/* ---------- Entrypoints ---------- */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'getRawData') {
    return jsonResponse(getRawData());
  }
  return jsonResponse({ error: 'Unknown action' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    if (action === 'addTransaction') {
      addTransaction(body);
      return jsonResponse({ ok: true });
    }
    if (action === 'addTransactions' && Array.isArray(body.txs)) {
      addTransactions(body.txs);
      return jsonResponse({ ok: true, count: body.txs.length });
    }
    if (action === 'deleteTransaction') {
      const n = deleteTransaction(body.signature || {});
      return jsonResponse({ ok: true, deleted: n });
    }
    if (action === 'updateTransaction') {
      const n = updateTransaction(body.signature || {}, body.changes || {});
      return jsonResponse({ ok: true, updated: n });
    }
    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
}
