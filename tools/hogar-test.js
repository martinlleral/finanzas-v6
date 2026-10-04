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
 * Contra la v7.8 original (879cb39) pasa 11 de 21; contra la de la primera
 * tanda de arreglos (ef13cc9), 14 de 21: fallan justo los casos que prueban
 * cada arreglo de su revisión.
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
const ESQUEMA_RENOMBRADO = {
  Egreso: { 'HogarYVida': ['Familia'], 'La Panadería': ['Insumos', 'Sueldos', 'Extracción'] },
  Ingreso: { 'La Panadería': ['Mostrador'], 'Hogar': ['Sueldo', 'Extracción'] },
};
const ANIO = new Date().getFullYear();
const cfg = (d, c, desc) => ({ d, t: '__CONFIG__', c, s: '', a: 0, desc, p: '', u: '' });

// Filas que devuelve el servidor falso, según el caso.
const FILAS = {
  vacia: [],
  familiar: [
    { d: '2026-09-01', t: '__CONFIG__', c: 'schema', s: '', a: 0, desc: b64(ESQUEMA_FAMILIAR), p: '', u: '' },
    { d: '2026-09-10', t: 'Egreso', c: 'Mar de Pan', s: 'Insumos', a: 1000, desc: 'harina', p: '', u: 'a1' },
    { d: '2026-09-11', t: 'Egreso', c: 'HogarYVida', s: 'Familia', a: 500, desc: 'x', p: '', u: 'a2' },
    { d: '2026-09-12', t: 'Ingreso', c: 'Mar de Pan', s: 'Mostrador', a: 5000, desc: 'ventas', p: '', u: 'a3' },
  ],
  // La fila de esquema más nueva está dañada; la anterior es la buena.
  corrupta: [
    cfg('2026-09-01', 'schema', b64(ESQUEMA_FAMILIAR)),
    cfg('2026-09-20', 'schema', '%%%no-es-base64%%%'),
  ],
  soloCorrupta: [cfg('2026-09-20', 'schema', '%%%no-es-base64%%%')],
  // El negocio ya renombrado en otro dispositivo: esquema y alias llegan juntos.
  renombrada: [
    cfg('2026-09-01', 'schema', b64(ESQUEMA_RENOMBRADO)),
    cfg('2026-09-01', 'aliases', b64({ 'Mar de Pan': 'La Panadería' })),
  ],
  // Un par de extracción ya registrado y un gasto del hogar, en el año en curso.
  conExtraccion: [
    cfg('2026-09-01', 'schema', b64(ESQUEMA_FAMILIAR)),
    { d: ANIO + '-01-10', t: 'Egreso', c: 'Mar de Pan', s: 'Extracción', a: 150000, desc: 'retiro · Extracción→Hogar', p: '', u: 'e1' },
    { d: ANIO + '-01-10', t: 'Ingreso', c: 'Hogar', s: 'Extracción', a: 150000, desc: 'retiro · Extracción→Hogar', p: '', u: 'e2' },
    { d: ANIO + '-01-11', t: 'Egreso', c: 'HogarYVida', s: 'Familia', a: 50000, desc: 'x', p: '', u: 'e3' },
  ],
};

// ¿Algún esquema enviado a la planilla viene SIN el negocio? Es lo que apaga la casa.
const ESQUEMAS_SIN_NEGOCIO = () => window.__posts
  .filter(b => b.type === '__CONFIG__' && b.category === 'schema')
  .map(b => new TextDecoder().decode(Uint8Array.from(atob(b.description), c => c.charCodeAt(0))))
  .filter(j => !/Mar de Pan|La Panadería/.test(j)).length;

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
    nombre: 'Sin esquema guardado y la primera lectura falla → guardar NO sube el esquema genérico',
    api: true, filas: 'familiar', lecturaFalla: true,
    accion: async (page) => {
      await page.evaluate(async () => { window.uiAlert = async () => {}; await saveConfig(); });
    },
    ver: (e, x) => [
      [x.enviosDeConfig === 0, 'no puede salir ningún envío de config (salieron ' + x.enviosDeConfig + ')'],
      [x.negocioEnLaPlanilla === true, 'la planilla tiene que conservar el esquema con el negocio'],
    ],
    extra: (page) => page.evaluate(() => ({
      enviosDeConfig: window.__posts.filter(b => b.type === '__CONFIG__').length,
      negocioEnLaPlanilla: (() => {
        const cfg = window.__filas.filter(r => r.t === '__CONFIG__' && r.c === 'schema').pop();
        return !!cfg && /Mar de Pan/.test(new TextDecoder().decode(Uint8Array.from(atob(cfg.desc), c => c.charCodeAt(0))));
      })(),
    })),
    porque: 'Un teléfono nuevo de la familia sin señal en la primera lectura tiene el esquema genérico: si lo guarda, apaga el negocio en toda la casa.',
  },
  {
    nombre: 'Instancia nueva: leyó la planilla vacía → guardar sí sube el esquema',
    api: true, filas: 'vacia',
    accion: async (page) => {
      await page.evaluate(async () => { window.uiAlert = async () => {}; await saveConfig(); });
    },
    ver: (e, x) => [[x.esquemasEnLaPlanilla === 1, 'la planilla tiene que recibir el esquema (tiene ' + x.esquemasEnLaPlanilla + ')']],
    extra: (page) => page.evaluate(() => ({
      esquemasEnLaPlanilla: window.__filas.filter(r => r.t === '__CONFIG__' && r.c === 'schema').length,
    })),
    porque: 'Control del anterior: la guarda espera una lectura, no una planilla con datos. Una instancia nueva tiene que poder guardar.',
  },
  {
    nombre: 'Extracción elegida y el esquema cambia antes de confirmar → igual se guardan los dos movimientos',
    api: true, filas: 'familiar',
    accion: async (page) => {
      await page.evaluate(async (sinNegocio) => {
        currentTx = { type: 'Egreso', category: 'Mar de Pan', subcategory: '', amount: 1000, desc: '', paymentMethod: '' };
        confirmTx('Extracción');      // la confirmación queda abierta
        // Otro dispositivo guardó un esquema sin el negocio mientras la confirmación estaba abierta.
        window.__filas.push({ d: '2026-09-30', t: '__CONFIG__', c: 'schema', s: '', a: 0, desc: sinNegocio, p: '', u: '' });
        await fetchSync();
        submitFinal();
      }, b64(ESQUEMA_SOLO_HOGAR));
      await page.waitForTimeout(1000);
    },
    ver: (e, x) => [
      [x.movimientos.length === 2, 'tienen que salir dos movimientos, el egreso y su ingreso al hogar (salieron ' + x.movimientos.length + ')'],
      [x.movimientos.some(m => m.type === 'Ingreso' && m.category === 'Hogar' && m.subcategory === 'Extracción'), 'falta el ingreso al hogar del par'],
    ],
    extra: (page) => page.evaluate(() => ({
      movimientos: window.__posts.filter(b => b.type !== '__CONFIG__')
        .flatMap(b => b.action === 'addTransactions' ? b.txs : [b]),
    })),
    porque: 'Una extracción guardada como egreso simple saca plata del negocio que nunca entra a la casa: el balance del hogar queda mal sin que nadie lo vea.',
  },
  {
    nombre: 'Instancia familiar: renombrar la categoría del negocio → el módulo sigue',
    api: true, filas: 'familiar',
    accion: async (page) => {
      await page.evaluate(async () => {
        window.uiPrompt = async () => 'La Panadería';
        await renameCategory('Egreso', 'Mar de Pan');
        await renameCategory('Ingreso', 'Mar de Pan');
      });
    },
    ver: (e) => [
      [e.categorias.includes('La Panadería'), 'el renombre tiene que haberse aplicado'],
      [e.negocio === true, 'negocioActivo() tiene que seguir dando true'],
      [e.navNegocio, 'el botón del negocio sigue visible'],
    ],
    porque: 'Renombrar es editar, no apagar: el alias viejo→nuevo dice que sigue siendo el negocio.',
  },
  {
    nombre: 'Renombrada la categoría del negocio, «Restaurar defaults» lo conserva',
    api: true, filas: 'familiar',
    accion: async (page) => {
      await page.evaluate(async () => {
        window.uiPrompt = async () => 'La Panadería';
        window.uiConfirm = async () => true;
        await renameCategory('Egreso', 'Mar de Pan');
        await renameCategory('Ingreso', 'Mar de Pan');
        await restoreDefaults();
      });
    },
    ver: (e) => [[e.negocio === true && e.categorias.includes('Mar de Pan'), 'restaurar tiene que volver al esquema con el negocio']],
    porque: 'Si el renombre apagaba el módulo, restaurar elegía el esquema de hogar y, al guardar, lo subía a la planilla de la casa.',
  },
  {
    nombre: 'Histórico filtrado por negocio y la sincronización trae solo un esquema sin negocio → se redibuja',
    api: true, filas: 'familiar',
    accion: async (page) => {
      await page.evaluate(async (sinNegocio) => {
        await openHistory();
        renderHistory('mdp');
        computeInsights('history');   // deja los avisos del estado con negocio en la caché
        window.__filas.push({ d: '2026-09-30', t: '__CONFIG__', c: 'schema', s: '', a: 0, desc: sinNegocio, p: '', u: '' });
        await fetchSync();            // mismos movimientos: solo cambió el esquema
      }, b64(ESQUEMA_SOLO_HOGAR));
      await page.waitForTimeout(300);
    },
    ver: (e, x) => [
      [e.negocio === false, 'el negocio tiene que haberse apagado'],
      [x.balance === x.balanceTotal, 'el balance en pantalla tiene que ser el total (' + x.balanceTotal + '), no el del negocio (muestra ' + x.balance + ')'],
      [x.avisosCacheados === x.avisosFrescos, 'los avisos no pueden salir de la caché del estado anterior'],
    ],
    extra: (page) => page.evaluate(() => {
      const total = TRANSACTIONS.reduce((s, t) => s + (t.t === 'Ingreso' ? 1 : t.t === 'Egreso' ? -1 : 0) * Number(t.a), 0);
      return {
        balance: document.getElementById('globBal').innerText,
        balanceTotal: fmtMoney(total),
        avisosCacheados: computeInsights('history').map(i => i.text).join(' | '),
        avisosFrescos: _computeInsightsInner('history').map(i => i.text).join(' | '),
      };
    }),
    porque: 'Con el filtro del negocio puesto y el negocio apagado, la pantalla mostraba importes de un filtro que ya no existe.',
  },
  {
    nombre: 'Sin esquema guardado y la fila de esquema más nueva está dañada → se usa la anterior y no se sube uno sin negocio',
    api: true, filas: 'corrupta',
    accion: async (page) => {
      await page.evaluate(async () => { window.uiAlert = async () => {}; await saveConfig(); });
    },
    ver: (e, x) => [
      [e.negocio === true, 'tiene que recuperar el último esquema legible, que trae el negocio'],
      [x.sinNegocio === 0, 'no puede subir un esquema sin el negocio (subió ' + x.sinNegocio + ')'],
    ],
    extra: (page) => page.evaluate(ESQUEMAS_SIN_NEGOCIO).then(n => ({ sinNegocio: n })),
    porque: 'Una lectura que trae la config ilegible no es una lectura: el esquema genérico seguía siendo provisional y guardarlo apagaba el negocio.',
  },
  {
    nombre: 'Sin esquema guardado y ningún esquema de la planilla se puede leer → guardar no envía nada',
    api: true, filas: 'soloCorrupta',
    accion: async (page) => {
      await page.evaluate(async () => { window.uiAlert = async () => {}; await saveConfig(); });
    },
    ver: (e, x) => [[x.envios === 0, 'no puede salir ningún envío de config (salieron ' + x.envios + ')']],
    extra: (page) => page.evaluate(() => ({ envios: window.__posts.filter(b => b.type === '__CONFIG__').length })),
    porque: 'Sin una config legible, este dispositivo no sabe qué hay en la planilla: no puede ser él quien la reemplace.',
  },
  {
    nombre: 'Dispositivo nuevo recibe el negocio ya renombrado (esquema + alias) → el módulo aparece',
    api: true, filas: 'renombrada',
    ver: (e) => [
      [e.negocio === true, 'negocioActivo() tiene que dar true'],
      [e.navNegocio, 'el botón del negocio tiene que verse sin otra sincronización'],
      [e.titulo === 'Finanzas Emprendimiento/Hogar', 'el título tiene que ser el del negocio (dio ' + e.titulo + ')'],
    ],
    porque: 'Los módulos se decidían con el esquema nuevo y los alias viejos: el negocio quedaba escondido hasta la sincronización siguiente.',
  },
  {
    nombre: 'Con esquema guardado y la primera lectura falla → guardar sube la edición, no la pierde',
    api: true, filas: 'familiar', lecturaFalla: true, cacheEsquema: ESQUEMA_FAMILIAR, liberarSync: true,
    accion: async (page) => {
      await page.evaluate(async () => {
        window.uiAlert = async () => {};
        SCHEMA.Egreso['Categoría nueva'] = [];
        await saveConfig();
      });
    },
    ver: (e, x) => [[x.subioLaEdicion, 'el esquema enviado tiene que traer la categoría recién agregada']],
    extra: (page) => page.evaluate(() => ({
      subioLaEdicion: window.__posts.some(b => b.type === '__CONFIG__' && b.category === 'schema'
        && /Categoría nueva/.test(new TextDecoder().decode(Uint8Array.from(atob(b.description), c => c.charCodeAt(0))))),
    })),
    porque: 'Un teléfono que ya tenía las categorías de la casa no corre el riesgo del esquema genérico: bloquearlo lo mandaba a sincronizar, y eso borraba lo que acababa de editar.',
  },
  {
    nombre: 'Borrar el negocio del borrador sin guardar y tocar «Restaurar defaults» → vuelve el negocio',
    api: true, filas: 'familiar',
    accion: async (page) => {
      await page.evaluate(async () => {
        window.uiConfirm = async () => true;
        delete SCHEMA.Egreso['Mar de Pan'];
        delete SCHEMA.Ingreso['Mar de Pan'];
        await restoreDefaults();
      });
    },
    ver: (e) => [[e.negocio === true && e.categorias.includes('Mar de Pan'), 'restaurar tiene que decidir por lo que la casa tiene en la planilla, no por el borrador']],
    porque: 'Restaurar desde el borrador elegía el esquema de hogar, y guardar después lo subía a la planilla de la casa.',
  },
  {
    nombre: 'Extracción en la categoría renombrada y los alias cambian antes de confirmar → igual van los dos movimientos',
    api: true, filas: 'renombrada',
    accion: async (page) => {
      await page.evaluate(async ({ personal, aliasDefault }) => {
        currentTx = { type: 'Egreso', category: 'La Panadería', subcategory: '', amount: 1000, desc: '', paymentMethod: '' };
        confirmTx('Extracción');
        // Otro dispositivo restauró los defaults y guardó: el alias que hacía de «La Panadería» el negocio ya no está.
        window.__filas.push({ d: '2026-09-30', t: '__CONFIG__', c: 'schema', s: '', a: 0, desc: personal, p: '', u: '' });
        window.__filas.push({ d: '2026-09-30', t: '__CONFIG__', c: 'aliases', s: '', a: 0, desc: aliasDefault, p: '', u: '' });
        await fetchSync();
        submitFinal();
      }, { personal: b64(ESQUEMA_FAMILIAR), aliasDefault: b64({ 'MarDePan': 'Mar de Pan' }) });
      await page.waitForTimeout(1000);
    },
    ver: (e, x) => [[x.movimientos.length === 2, 'tienen que salir dos movimientos (salieron ' + x.movimientos.length + ')']],
    extra: (page) => page.evaluate(() => ({
      movimientos: window.__posts.filter(b => b.type !== '__CONFIG__')
        .flatMap(b => b.action === 'addTransactions' ? b.txs : [b]),
    })),
    porque: 'Lo que el usuario eligió al abrir la confirmación no puede cambiar de significado por una sincronización.',
  },
  {
    nombre: 'Se oculta el negocio → una extracción ya registrada sigue sin contarse como ahorro',
    api: true, filas: 'conExtraccion',
    accion: async (page) => {
      await page.evaluate(async (sinNegocio) => {
        window.__filas.push({ d: '2026-09-30', t: '__CONFIG__', c: 'schema', s: '', a: 0, desc: sinNegocio, p: '', u: '' });
        await fetchSync();
      }, b64(ESQUEMA_SOLO_HOGAR));
    },
    ver: (e, x) => [
      [e.negocio === false, 'el negocio tiene que haberse ocultado'],
      [x.ingresoEsExtraccion, 'el ingreso marcado «Extracción→Hogar» sigue siendo una transferencia'],
      [!/ahorrado/.test(x.avisos), 'el hogar gastó $50.000 y no ganó nada: no puede aparecer ahorro (avisos: ' + x.avisos + ')'],
    ],
    extra: (page) => page.evaluate(() => ({
      ingresoEsExtraccion: isExtractionInc(TRANSACTIONS.find(t => t.u === 'e2')),
      avisos: computeInsights('history').map(i => i.text).join(' | '),
    })),
    porque: 'Ocultar el módulo es de pantalla; la plata que pasó del negocio a la casa ya está registrada como transferencia y tiene que seguir siéndolo.',
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
    await page.addInitScript(({ api, filas, cache, lecturaFalla, liberar }) => {
      if (api) { localStorage.setItem('FINANZAS_API_URL', api); localStorage.setItem('FINANZAS_API_TOKEN', 'tok'); }
      if (cache) localStorage.setItem('FINANZAS_SCHEMA', JSON.stringify(cache));
      window.__filas = filas; window.__dejarSincronizar = !cache || liberar;   // con cache, la sync se libera a mano
      window.__posts = [];
      window.fetch = async (u, o) => {
        if (/script\.google\.com/.test(String(u))) {
          if (o && o.method === 'POST') {
            const b = JSON.parse(o.body);
            window.__posts.push(b);
            // Lo que se envía queda en la planilla falsa: sin esto, un esquema
            // subido por error no se vería en lo que leen los otros dispositivos.
            if (b.action === 'addTransaction') window.__filas.push({ d: String(b.date).slice(0, 10), t: b.type,
              c: b.category, s: b.subcategory, a: b.amount, desc: b.description, p: b.paymentMethod || '', u: b.uid });
            return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, written: 1, writtenUids: [b.uid], skipped: [] }) };
          }
          if (lecturaFalla) throw new TypeError('Failed to fetch');
          while (!window.__dejarSincronizar) await new Promise(r => setTimeout(r, 50));
          return { ok: true, status: 200, json: async () => window.__filas, text: async () => JSON.stringify(window.__filas) };
        }
        return new Response('', { status: 200 });
      };
    }, { api: caso.api ? API : null, filas: FILAS[caso.filas], cache: caso.cacheEsquema || null, lecturaFalla: !!caso.lecturaFalla, liberar: !!caso.liberarSync });
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
