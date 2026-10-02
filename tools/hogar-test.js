/**
 * Tests del modo hogar (fase A de los módulos).
 *
 * Una instancia NUEVA con su propia planilla tiene que nacer sin el módulo del
 * negocio: sin su vista, sin su filtro, sin sus avisos y con categorías
 * genéricas. La instancia familiar, cuyo esquema sincronizado trae la
 * categoría del negocio, tiene que seguir exactamente igual. Y un dispositivo
 * que arranca sin esquema y lo recibe de la planilla tiene que mostrar el
 * negocio sin recargar.
 *
 * Uso: node tools/hogar-test.js index.html
 *
 * Contra el cliente v7.7 pasa 1 de 8. El primer caso falla por lo que importa:
 * una instancia nueva veía el negocio y las categorías de la instancia familiar.
 */
const { chromium } = require('/opt/homebrew/lib/node_modules/playwright');
const path = require('path');

const API = 'https://script.google.com/macros/s/AKfycbxPRUEBA/exec';
const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');

const ESQUEMA_FAMILIAR = {
  Egreso: { 'HogarYVida': ['Familia'], 'Mar de Pan': ['Insumos', 'Sueldos', 'Extracción'] },
  Ingreso: { 'Mar de Pan': ['Mostrador'], 'Hogar': ['Sueldo', 'Extracción'] },
};
const ESQUEMA_SOLO_HOGAR = { Egreso: { 'Hogar': ['Luz'] }, Ingreso: { 'Sueldo': ['Sueldo'] } };

// Filas que devuelve el servidor falso, según el caso.
const FILAS = {
  vacia: [],
  familiar: [
    { d: '2026-09-01', t: '__CONFIG__', c: 'schema', s: '', a: 0, desc: b64(ESQUEMA_FAMILIAR), p: '', u: '' },
    { d: '2026-09-10', t: 'Egreso', c: 'Mar de Pan', s: 'Insumos', a: 1000, desc: 'harina', p: '', u: 'a1' },
    { d: '2026-09-11', t: 'Egreso', c: 'HogarYVida', s: 'Familia', a: 500, desc: 'x', p: '', u: 'a2' },
    { d: '2026-09-12', t: 'Ingreso', c: 'Mar de Pan', s: 'Mostrador', a: 5000, desc: 'ventas', p: '', u: 'a3' },
  ],
};

const ESTADO = () => {
  const vis = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
  return {
    // Defensivo: el mismo test tiene que poder correr contra la versión anterior
    // (sin negocioActivo) para demostrar que reproduce el problema.
    negocio: (typeof negocioActivo === 'function') ? negocioActivo() : null,
    navNegocio: vis('bizNavBtn'),
    filtroNegocio: vis('bizFilterBtn'),
    etiquetaBalance: (document.getElementById('globBalLabel') || {}).textContent,
    titulo: document.title,
    categorias: Object.keys(SCHEMA.Egreso).concat(Object.keys(SCHEMA.Ingreso)),
    vistaActiva: (document.querySelector('.app-view.active') || {}).id,
    extraccionHogar: isExtractionInc({ t: 'Ingreso', c: 'Hogar', s: 'Extracción', a: 1 }),
    avisos: (typeof computeInsights === 'function' ? computeInsights('home') : []).map(i => i.text).join(' | '),
  };
};

const CASOS = [
  {
    nombre: 'Instancia nueva (planilla vacía) → nace sin negocio',
    api: true, filas: 'vacia',
    ver: (e) => [
      [e.negocio === false, 'negocioActivo() tiene que dar false'],
      [!e.navNegocio, 'el botón del negocio no puede verse'],
      [!e.filtroNegocio, 'el filtro del negocio en el histórico no puede verse'],
      [e.etiquetaBalance === 'Balance Total', 'la caja consolidada pasa a llamarse Balance Total (dio ' + e.etiquetaBalance + ')'],
      [e.titulo === 'Finanzas del Hogar', 'el título es Finanzas del Hogar (dio ' + e.titulo + ')'],
      [!e.categorias.includes('Mar de Pan'), 'las categorías no pueden traer el negocio de la instancia familiar'],
      [e.extraccionHogar === false, 'sin negocio no hay extracciones: un ingreso Hogar/Extracción es un ingreso común'],
      [!/MdP/.test(e.avisos), 'ningún aviso puede hablar del negocio'],
    ],
    porque: 'Es lo que ve una familia o una pareja con su propia planilla: medido antes del cambio, veía el negocio y las categorías de la instancia familiar.',
  },
  {
    nombre: 'Instancia nueva → abrir la vista del negocio no hace nada',
    api: true, filas: 'vacia',
    accion: async (page) => { await page.evaluate(() => openMarDePan()); await page.waitForTimeout(300); },
    ver: (e) => [[e.vistaActiva === 'homeView', 'tiene que seguir en la pantalla principal (quedó en ' + e.vistaActiva + ')']],
    porque: 'La vista existe en el HTML; sin la guarda, cualquier atajo la abre vacía.',
  },
  {
    nombre: 'Instancia familiar (esquema con negocio en la planilla) → todo igual que siempre',
    api: true, filas: 'familiar',
    ver: (e) => [
      [e.negocio === true, 'negocioActivo() tiene que dar true'],
      [e.navNegocio && e.filtroNegocio, 'botón y filtro del negocio visibles'],
      [e.etiquetaBalance === 'Caja Consolidada', 'la etiqueta sigue siendo Caja Consolidada'],
      [e.titulo === 'Finanzas Emprendimiento/Hogar', 'el título no cambia (dio ' + e.titulo + ')'],
      [e.extraccionHogar === true, 'las extracciones siguen reconociéndose'],
    ],
    porque: 'La instancia familiar no se migra: su esquema sincronizado ya trae la categoría del negocio.',
  },
  {
    nombre: 'Arranca sin negocio y la sincronización trae el esquema familiar → aparece sin recargar',
    api: true, filas: 'familiar', cacheEsquema: ESQUEMA_SOLO_HOGAR,
    antes: (e) => [[e.negocio === false && !e.navNegocio, 'antes de sincronizar tiene que estar en modo hogar']],
    ver: (e) => [
      [e.negocio === true, 'después de sincronizar, negocio activo'],
      [e.navNegocio, 'el botón del negocio aparece sin recargar'],
    ],
    porque: 'Un teléfono nuevo de la familia arranca con el esquema genérico y recibe el real segundos después.',
  },
  {
    nombre: 'Instancia familiar → la vista del negocio y su filtro siguen funcionando',
    api: true, filas: 'familiar',
    accion: async (page) => {
      await page.evaluate(() => openMarDePan());
      await page.waitForTimeout(300);
      await page.evaluate(() => { renderHistory('mdp'); });
    },
    ver: (e, x) => [
      [x.vistaNegocioAbierta === true, 'la vista del negocio tiene que abrirse'],
      [x.ingresosNegocio === 5000, 'los ingresos del negocio se calculan (dio ' + x.ingresosNegocio + ')'],
    ],
    extra: (page) => page.evaluate(() => ({
      vistaNegocioAbierta: (document.querySelector('.app-view.active') || {}).id === 'marDePanView'
        || navStack.some(v => v.id === 'marDePanView'),
      ingresosNegocio: TRANSACTIONS.filter(isMdpIncome).reduce((s, t) => s + Number(t.a), 0),
    })),
    porque: 'Regresión: apagar el módulo para otras no puede romperlo en casa.',
  },
  {
    nombre: 'Demo (sin servidor) → sigue mostrando la app completa',
    api: false, filas: 'vacia',
    ver: (e) => [
      [e.negocio === true, 'el demo conserva el negocio (Emprendimiento)'],
      [e.navNegocio, 'el botón del negocio se ve en el demo'],
    ],
    porque: 'El portafolio público muestra todas las funciones.',
  },
  {
    nombre: 'Restaurar defaults en instancia nueva → esquema de hogar, no el familiar',
    api: true, filas: 'vacia',
    accion: async (page) => {
      await page.evaluate(async () => { window.uiConfirm = async () => true; await restoreDefaults(); });
    },
    ver: (e) => [[!e.categorias.includes('Mar de Pan') && e.negocio === false, 'restaurar no puede traer el negocio de la instancia familiar']],
    porque: 'Antes, "defaults" era el esquema de la familia: restaurar en una instancia ajena lo copiaba y lo subía a su planilla.',
  },
  {
    nombre: 'Restaurar defaults en la instancia familiar → conserva el negocio',
    api: true, filas: 'familiar',
    accion: async (page) => {
      await page.evaluate(async () => { window.uiConfirm = async () => true; await restoreDefaults(); });
    },
    ver: (e) => [[e.categorias.includes('Mar de Pan') && e.negocio === true, 'restaurar en casa tiene que mantener el negocio']],
    porque: 'Si "defaults" fuera el esquema de hogar, restaurar en casa apagaría el negocio y lo sincronizaría.',
  },
];

(async () => {
  const file = 'file://' + path.resolve(process.argv[2] || 'index.html');
  const browser = await chromium.launch();
  let fallaron = 0;
  for (const caso of CASOS) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.addInitScript(({ api, filas, cache }) => {
      if (api) { localStorage.setItem('FINANZAS_API_URL', api); localStorage.setItem('FINANZAS_API_TOKEN', 'tok'); }
      if (cache) localStorage.setItem('FINANZAS_SCHEMA', JSON.stringify(cache));
      window.__filas = filas; window.__dejarSincronizar = !cache;   // con cache, la sync se libera a mano
      window.fetch = async (u, o) => {
        if (/script\.google\.com/.test(String(u))) {
          if (o && o.method === 'POST') {
            const b = JSON.parse(o.body);
            return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, written: 1, writtenUids: [b.uid], skipped: [] }) };
          }
          while (!window.__dejarSincronizar) await new Promise(r => setTimeout(r, 50));
          return { ok: true, status: 200, json: async () => window.__filas, text: async () => JSON.stringify(window.__filas) };
        }
        return new Response('', { status: 200 });
      };
    }, { api: caso.api ? API : null, filas: FILAS[caso.filas], cache: caso.cacheEsquema || null });
    await page.goto(file, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    let fallas = [];
    if (caso.antes) {
      const e0 = await page.evaluate(ESTADO);
      fallas = fallas.concat(caso.antes(e0).filter(([ok]) => !ok).map(([, m]) => m));
      await page.evaluate(() => { window.__dejarSincronizar = true; });
      await page.waitForTimeout(800);
    }
    if (caso.accion) await caso.accion(page);
    const e = await page.evaluate(ESTADO);
    const x = caso.extra ? await caso.extra(page) : {};
    fallas = fallas.concat(caso.ver(e, x).filter(([ok]) => !ok).map(([, m]) => m));
    console.log(`${fallas.length ? '❌' : '✅'} ${caso.nombre}`);
    console.log(`   ${caso.porque}`);
    if (fallas.length) { fallaron++; fallas.forEach(f => console.log('   ⚠️  ' + f)); }
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${CASOS.length - fallaron}/${CASOS.length} pasaron`);
  process.exit(fallaron ? 1 : 0);
})();
