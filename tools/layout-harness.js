/**
 * Harness de verificación de layout para finanzas-v6.
 *
 * Sonda A (horizontal): ¿algo se sale del viewport, y QUÉ exactamente?
 * Sonda B (vertical):   ¿la última fila del numpad queda alcanzable?
 *
 * Corre la app en modo demo (API_URL vacía) sobre file://, recorre las vistas
 * y modales en 7 viewports, con el peor caso de datos inyectado.
 *
 * Uso: node tools/layout-harness.js <ruta-index.html> [etiqueta] > resultado.json
 */
const { chromium } = require('/opt/homebrew/lib/node_modules/playwright');
const path = require('path');

const VIEWPORTS = [
  { w: 320, h: 568, label: 'iPhone SE1 / piso' },
  { w: 360, h: 640, label: 'Android chico' },
  { w: 375, h: 553, label: 'iPhone SE2/8 CON barra de URL' },  // el caso crítico
  { w: 390, h: 664, label: 'iPhone 13/14 con barra' },
  { w: 430, h: 720, label: 'iPhone Pro Max' },
  { w: 768, h: 1024, label: 'tablet' },
  { w: 1280, h: 800, label: 'desktop' },
];

const VISTAS = ['homeView', 'historyView', 'trendsView', 'marDePanView', 'hogarView',
                'configView', 'monthView', 'breakdownView', 'subView', 'confirmView'];
const MODALES = ['catModal', 'txActionsModal', 'uiDialogModal', 'qrModal'];

// ── Sonda A ──────────────────────────────────────────────────────────────────
const SONDA_A = () => {
  const de = document.documentElement, vw = de.clientWidth;
  const over = [], offenders = [];
  const chk = (label, el) => {
    const d = el.scrollWidth - el.clientWidth;
    if (d > 1) over.push({ label, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, over: d });
  };
  // Para html/body NO se asserta scrollWidth: con overflow:clip el navegador
  // sigue reportando el ancho de las 8 vistas inactivas en translateX(100%)
  // aunque estén clipeadas y sean inalcanzables. Lo que importa —y se testea
  // abajo— es si el documento SE PUEDE scrollear al costado.
  document.querySelectorAll('.app-view.active').forEach(v => chk('#' + v.id, v));
  document.querySelectorAll('.modal-overlay.open .modal-sheet, .modal-overlay[style*="flex"] .modal-sheet').forEach(m => chk('sheet#' + m.parentElement.id, m));

  const scope = document.querySelectorAll('.app-view.active *, .modal-overlay.open *, .modal-overlay[style*="flex"] *');
  scope.forEach(el => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    if (r.right > vw + 1 || r.left < -1) {
      const cls = (typeof el.className === 'string' && el.className.trim())
        ? '.' + el.className.trim().split(/\s+/).join('.') : '';
      offenders.push({
        sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls,
        left: Math.round(r.left), right: Math.round(r.right),
        text: (el.textContent || '').trim().slice(0, 24),
      });
    }
  });
  // anti-G: ¿se puede scrollear el documento hacia el costado?
  de.scrollTo(9999, 0);
  const scrollLeftTrasScroll = de.scrollLeft;
  de.scrollTo(0, 0);
  return { vw, docScrollW: de.scrollWidth, bodyScrollW: document.body.scrollWidth, scrollLeftTrasScroll, over, offenders: offenders.slice(0, 12) };
};

// ── Sonda B ──────────────────────────────────────────────────────────────────
const SONDA_B = () => {
  const keys = [...document.querySelectorAll('#homeView .numpad .num-key')];
  if (!keys.length) return { skip: true };
  const last = keys[keys.length - 1].getBoundingClientRect();
  const vh = window.visualViewport ? window.visualViewport.height : innerHeight;
  const hv = document.getElementById('homeView');
  return {
    lastKeyBottom: Math.round(last.bottom), vh: Math.round(vh),
    cutBy: Math.round(last.bottom - vh),
    homeScrollable: hv.scrollHeight > hv.clientHeight,
    ok: last.bottom <= vh + 1,
  };
};

// Peor caso de datos: los montos reales de la familia llegan a 7-8 dígitos
const STRESS = () => {
  document.querySelectorAll('.stat-val').forEach(e => e.textContent = '$123.456.789');
  document.querySelectorAll('.row-right').forEach(e => e.textContent = '-$123.456.789');
};

const MOSTRAR_VISTA = (id) => {
  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
  const v = document.getElementById(id);
  if (v) v.classList.add('active');
  return !!v;
};

const ABRIR_MODAL = (id) => {
  const m = document.getElementById(id);
  if (!m) return false;
  m.style.display = 'flex';
  m.classList.add('open');
  return true;
};

const CERRAR_MODALES = () => {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.style.display = 'none'; m.classList.remove('open');
  });
};

(async () => {
  const file = 'file://' + path.resolve(process.argv[2]);
  const etiqueta = process.argv[3] || 'sin-etiqueta';
  const browser = await chromium.launch();
  const resultados = [];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 2, isMobile: vp.w < 768, hasTouch: vp.w < 768,
      reducedMotion: 'reduce',   // la app respeta prefers-reduced-motion: mata la transicion de slide
    });
    const page = await ctx.newPage();
    await page.goto(file, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);

    // Los 9 dígitos, tipeados de verdad por la ruta real de pressNum
    await page.evaluate(() => {
      document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
      document.getElementById('homeView').classList.add('active');
    });
    for (const d of '123456789') {
      const btn = page.locator(`.num-key`, { hasText: new RegExp(`^${d}$`) }).first();
      if (await btn.count()) await btn.click({ timeout: 1500 }).catch(() => {});
    }

    const home = { viewport: vp, vista: 'homeView (9 dígitos tipeados)',
                   A: await page.evaluate(SONDA_A), B: await page.evaluate(SONDA_B),
                   amountLeft: await page.evaluate(() => {
                     const e = document.getElementById('displayAmount');
                     return e ? Math.round(e.getBoundingClientRect().left) : null;
                   }) };
    resultados.push(home);

    for (const vista of VISTAS) {
      await page.evaluate(CERRAR_MODALES);
      const existe = await page.evaluate(MOSTRAR_VISTA, vista);
      if (!existe) continue;
      await page.evaluate(STRESS);
      await page.waitForTimeout(120);
      resultados.push({ viewport: vp, vista, A: await page.evaluate(SONDA_A) });
    }

    await page.evaluate(MOSTRAR_VISTA, 'homeView');
    for (const modal of MODALES) {
      const ok = await page.evaluate(ABRIR_MODAL, modal);
      if (!ok) continue;
      await page.evaluate(STRESS);
      await page.waitForTimeout(120);
      resultados.push({ viewport: vp, vista: 'modal:' + modal, A: await page.evaluate(SONDA_A) });
      await page.evaluate(CERRAR_MODALES);
    }
    await ctx.close();
  }
  await browser.close();

  const fallas = resultados.filter(r =>
    (r.A.over && r.A.over.length) || (r.A.offenders && r.A.offenders.length) ||
    r.A.scrollLeftTrasScroll > 0 || (r.B && r.B.ok === false));
  console.log(JSON.stringify({
    etiqueta,
    total: resultados.length,
    fallas: fallas.length,
    resumen: fallas.map(f => ({
      vp: `${f.viewport.w}x${f.viewport.h}`, vista: f.vista,
      over: (f.A.over || []).map(o => `${o.label}+${o.over}px`),
      offenders: (f.A.offenders || []).map(o => `${o.sel}[${o.left}..${o.right}]`),
      scrollLateral: f.A.scrollLeftTrasScroll || 0,
      numpadCortado: f.B && f.B.ok === false ? f.B.cutBy + 'px' : null,
      amountLeft: f.amountLeft,
    })),
    detalle: resultados,
  }, null, 2));
})();
