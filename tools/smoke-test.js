/**
 * Smoke test funcional + calibración del coeficiente tipográfico.
 *
 * 1) Mide el ancho de avance real de un dígito tabular en Outfit 300 (el 0.62
 *    del clamp de .amount-display) — con la fuente YA cargada.
 * 2) Verifica que la app siga funcionando end-to-end en modo demo: tipear,
 *    elegir categoría, confirmar, guardar, y que no explote nada.
 * 3) Verifica el guard anti-doble-tap y las funciones nuevas de config.
 */
const { chromium } = require('/opt/homebrew/lib/node_modules/playwright');
const path = require('path');

(async () => {
  const file = 'file://' + path.resolve(process.argv[2]);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errores.push('console.error: ' + m.text()); });

  await page.goto(file, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  // ── 1. Calibración del coeficiente ──────────────────────────────────────
  const calib = await page.evaluate(async () => {
    await document.fonts.ready;
    const el = document.getElementById('displayAmount');
    const prev = el.textContent;
    el.textContent = '8888888888';           // 10 dígitos
    const fs = parseFloat(getComputedStyle(el).fontSize);
    const k = el.getBoundingClientRect().width / (10 * fs);
    el.textContent = prev;
    return { coefMedido: +k.toFixed(4), fontSizeUsado: fs };
  });

  // ── 2. Flujo real: tipear → Egreso → categoría → sub → confirmar → guardar
  const flujo = {};
  for (const d of '1234567') {
    await page.locator('.num-key', { hasText: new RegExp(`^${d}$`) }).first().click();
  }
  flujo.montoTipeado = await page.locator('#displayAmount').innerText();
  flujo.amtChars = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.amount-display')).getPropertyValue('--amt-chars').trim());
  flujo.montoEntraEnPantalla = await page.evaluate(() => {
    const r = document.getElementById('displayAmount').getBoundingClientRect();
    return r.left >= 0 && r.right <= document.documentElement.clientWidth;
  });

  await page.locator('.big-btn', { hasText: /EGRESO|GASTO|SALIDA/i }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  flujo.modalCategoriasAbierto = await page.locator('#catModal').evaluate(e =>
    getComputedStyle(e).display !== 'none' && getComputedStyle(e).opacity !== '0').catch(() => false);

  // Elegir la primera categoría y la primera subcategoría
  await page.locator('#catList .list-row').first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('#catList .list-row').first().click().catch(() => {});
  await page.waitForTimeout(500);
  flujo.llegoAConfirm = await page.locator('#confirmView').evaluate(e => e.classList.contains('active')).catch(() => false);

  if (flujo.llegoAConfirm) {
    const txsAntes = await page.evaluate(() => TRANSACTIONS.length);
    // Doble tap: el guard tiene que dejar pasar UNA sola
    await page.locator('#saveBtn').click();
    await page.locator('#saveBtn').click({ force: true }).catch(() => {});
    await page.waitForTimeout(600);
    const txsDespues = await page.evaluate(() => TRANSACTIONS.length);
    flujo.txsAgregadasConDobleTap = txsDespues - txsAntes;
    flujo.montoReseteado = await page.locator('#displayAmount').innerText();
    flujo.saveBtnRehabilitado = await page.evaluate(async () => {
      await new Promise(r => setTimeout(r, 900));
      return !document.getElementById('saveBtn').disabled;
    });
  }

  // ── 3. Funciones nuevas: round-trip UTF-8 y helpers ─────────────────────
  const unit = await page.evaluate(() => {
    const out = {};
    const obj = { 'Alimentación': ['Verdulería', 'Carnicería'], 'Ñandú 🥖': ['ok'] };
    try {
      const b64 = jsonToB64(obj);
      out.roundTripUTF8 = b64ToJson(b64) === JSON.stringify(obj);
      out.b64Largo = b64.length;
    } catch (e) { out.roundTripUTF8 = 'ERROR: ' + e.message; }
    // Retrocompat: una fila vieja escrita con btoa() latin-1 se tiene que poder leer
    try {
      const viejo = btoa(JSON.stringify({ 'Alimentacion': 'Alimentación' }));
      out.leeLatin1Viejo = JSON.parse(b64ToJson(viejo)) !== null;
    } catch (e) { out.leeLatin1Viejo = 'ERROR: ' + e.message; }
    out.tieneApiPost = typeof apiPost === 'function';
    out.tieneToWire = typeof _toWire === 'function';
    out.tieneDrainQueue = typeof _drainQueue === 'function';
    out.tieneSetAmount = typeof setAmountDisplay === 'function';
    out.uidViajaAlServidor = (() => {
      try { return '_uid' in _toWire({ _uid: 'x' }) === false && _toWire({ _uid: 'abc' }).uid === 'abc'; }
      catch (e) { return 'ERROR: ' + e.message; }
    })();
    return out;
  });

  await page.screenshot({ path: 'shot-375-home.png' });
  await browser.close();
  console.log(JSON.stringify({ calib, flujo, unit, errores }, null, 2));
})();
