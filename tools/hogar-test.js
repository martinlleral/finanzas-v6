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
 * Contra la v7.8 original (879cb39) pasa 13 de 32 (con los casos actuales);
 * contra 4ada9d0, la tanda anterior, 30 de 32: fallan justo los casos que
 * prueban cada arreglo de su revisión. (El de «config guardada para
 * OTRA planilla, formato nuevo» pasa en las anteriores porque no conocen el
 * formato: protege el nuevo, no reproduce un bug viejo.)
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
  // Renombrado y después «Restaurar defaults» guardado con el esquema dañado:
  // los alias nuevos ya no reconocen el nombre del esquema legible anterior.
  renombradaYCorrupta: [
    cfg('2026-09-01', 'schema', b64(ESQUEMA_RENOMBRADO)),
    cfg('2026-09-01', 'aliases', b64({ 'Mar de Pan': 'La Panadería' })),
    cfg('2026-09-20', 'schema', '%%%no-es-base64%%%'),
    cfg('2026-09-20', 'aliases', b64({ 'MarDePan': 'Mar de Pan' })),
  ],
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

// Una planilla nueva y vacía abierta desde un navegador que usó otra: leyó,
// guardó, y lo que guardó es el esquema genérico.
const VER_PLANILLA_NUEVA = (e, x) => [
  [x.lecturas >= 1, 'la lectura de la planilla vacía tiene que haberse completado'],
  [e.negocio === false, 'la planilla nueva arranca sin negocio'],
  [x.esquemas >= 1, 'guardar tiene que subir el esquema (subió ' + x.esquemas + ')'],
  [x.ajenas === 0, 'no puede subir el esquema de la otra planilla (subió ' + x.ajenas + ')'],
];

// Lo que leería otro dispositivo: las filas nuevas de la planilla falsa.
const MOVIMIENTOS_EN_LA_PLANILLA = () => ({
  movimientos: window.__filas.filter(r => r.t !== '__CONFIG__' && /^tx_/.test(r.u || ''))
    .map(r => ({ type: r.t, category: r.c, subcategory: r.s, amount: r.a, uid: r.u, description: r.desc })),
});

// El par de una extracción: un egreso del negocio y un ingreso al hogar, por
// el mismo importe, con uid distintos y los dos marcados. Contar movimientos
// no alcanza: pasaba con el ingreso en $0.
const PAR_COMPLETO = (m) => {
  const eg = m.find(x => x.type === 'Egreso'), ing = m.find(x => x.type === 'Ingreso');
  return [
    [m.length === 2, 'tienen que salir dos movimientos (salieron ' + m.length + ')'],
    [!!eg && !!ing, 'uno tiene que ser egreso y el otro ingreso'],
    [!!ing && ing.category === 'Hogar' && ing.subcategory === 'Extracción', 'el ingreso va a Hogar / Extracción'],
    [!!eg && !!ing && Number(eg.amount) === 1000 && Number(ing.amount) === 1000, 'los dos por el importe cargado ($1000)'],
    [!!eg && !!ing && eg.uid && ing.uid && eg.uid !== ing.uid, 'uid propios y distintos'],
    [m.every(x => /Extracción→Hogar/.test(x.description || '')), 'los dos con la marca de la extracción'],
  ];
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
    ver: (e, x) => PAR_COMPLETO(x.movimientos),
    extra: (page) => page.evaluate(MOVIMIENTOS_EN_LA_PLANILLA),
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
    api: true, filas: 'familiar', lecturaFalla: true, cacheEsquema: ESQUEMA_FAMILIAR, cacheOrigen: 'misma', liberarSync: true,
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
    ver: (e, x) => PAR_COMPLETO(x.movimientos),
    extra: (page) => page.evaluate(MOVIMIENTOS_EN_LA_PLANILLA),
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
    nombre: 'Categorías guardadas de OTRA planilla y la primera lectura falla → guardar no envía nada',
    api: true, filas: 'familiar', lecturaFalla: true, cacheEsquema: ESQUEMA_SOLO_HOGAR,
    cacheOrigen: 'https://script.google.com/macros/s/AKfycbxOTRA/exec', liberarSync: true,
    accion: async (page) => {
      await page.evaluate(async () => { window.uiAlert = async () => {}; await saveConfig(); });
    },
    ver: (e, x) => [[x.envios === 0, 'no puede salir ningún envío de config (salieron ' + x.envios + ')']],
    extra: (page) => page.evaluate(() => ({ envios: window.__posts.filter(b => b.type === '__CONFIG__').length })),
    porque: 'El mismo navegador usado con dos planillas: las categorías de la de hogar no son de la familiar, y subirlas apagaba el negocio.',
  },
  {
    nombre: 'Teléfono de la familia con la copia de antes (sin planilla anotada) y la planilla con el esquema dañado → puede repararla',
    api: true, filas: 'soloCorrupta', cacheEsquema: ESQUEMA_FAMILIAR, liberarSync: true,
    accion: async (page) => {
      await page.evaluate(async () => { window.uiAlert = async () => {}; await saveConfig(); });
    },
    ver: (e, x) => [
      [x.lecturas >= 1, 'la lectura de la planilla (dañada) tiene que haberse completado'],
      [x.conNegocio >= 1, 'tiene que subir su copia, que trae el negocio (subió ' + x.conNegocio + ')'],
    ],
    extra: (page) => page.evaluate(() => ({
      lecturas: window.__lecturas || 0,
      conNegocio: window.__posts.filter(b => b.type === '__CONFIG__' && b.category === 'schema'
        && /Mar de Pan/.test(new TextDecoder().decode(Uint8Array.from(atob(b.description), c => c.charCodeAt(0))))).length,
    })),
    porque: 'La copia anterior se asigna a la planilla conectada hoy: si no, ningún dispositivo de la casa podría reparar una config dañada.',
  },
  {
    nombre: 'Navegador con la copia de OTRA planilla abre una planilla nueva (vacía) y guarda → no le sube las categorías ajenas',
    api: true, filas: 'vacia', cacheEsquema: ESQUEMA_FAMILIAR, cacheOrigen: 'https://script.google.com/macros/s/AKfycbxOTRA/exec', liberarSync: true,
    accion: async (page) => {
      await page.evaluate(async () => { window.uiAlert = async () => {}; await saveConfig(); });
    },
    ver: (e, x) => VER_PLANILLA_NUEVA(e, x),
    extra: (page) => page.evaluate(() => ({
      lecturas: window.__lecturas || 0,
      esquemas: window.__posts.filter(b => b.type === '__CONFIG__' && b.category === 'schema').length,
      ajenas: window.__posts.filter(b => b.type === '__CONFIG__' && b.category === 'schema'
        && /Mar de Pan/.test(new TextDecoder().decode(Uint8Array.from(atob(b.description), c => c.charCodeAt(0))))).length,
    })),
    porque: 'Configurar la planilla de otra casa en el teléfono propio le subía el árbol de categorías de la familia.',
  },
  {
    nombre: 'Primera apertura con esta versión desde el QR de OTRA casa, con la copia vieja de la familia → no se la asigna a la nueva',
    api: true, filas: 'vacia', cacheEsquema: ESQUEMA_FAMILIAR, qrDesde: 'https://script.google.com/macros/s/AKfycbxOTRA/exec', liberarSync: true,
    accion: async (page) => {
      await page.evaluate(async () => { window.uiAlert = async () => {}; await saveConfig(); });
    },
    ver: (e, x) => VER_PLANILLA_NUEVA(e, x).concat([[x.apiActual === x.apiQr, 'el QR tiene que haber cambiado la planilla']]),
    extra: (page) => page.evaluate((qr) => ({
      apiActual: API_URL, apiQr: qr,
      lecturas: window.__lecturas || 0,
      esquemas: window.__posts.filter(b => b.type === '__CONFIG__' && b.category === 'schema').length,
      ajenas: window.__posts.filter(b => b.type === '__CONFIG__' && b.category === 'schema'
        && /Mar de Pan/.test(new TextDecoder().decode(Uint8Array.from(atob(b.description), c => c.charCodeAt(0))))).length,
    }), API),
    porque: 'El QR cambia la planilla antes de que arranque la migración: sin anotar de dónde era la copia, la familia le regalaba su árbol de categorías a otra casa.',
  },
  {
    nombre: 'Extracción con una descripción de 600 caracteres → la marca sobrevive al corte del servidor',
    api: true, filas: 'familiar',
    accion: async (page) => {
      await page.evaluate(async () => {
        currentTx = { type: 'Egreso', category: 'Mar de Pan', subcategory: '', amount: 1000, desc: '', paymentMethod: '' };
        confirmTx('Extracción');
        document.getElementById('descInput').value = 'x'.repeat(600);
        submitFinal();
      });
      await page.waitForTimeout(1000);
    },
    ver: (e, x) => PAR_COMPLETO(x.movimientos),
    extra: (page) => page.evaluate(MOVIMIENTOS_EN_LA_PLANILLA),
    porque: 'El servidor corta en 500 y la marca iba al final: con un texto largo, la extracción quedaba sin marca y, con el módulo oculto, como ahorro.',
  },
  {
    nombre: 'Config ya guardada para OTRA planilla (formato nuevo) → una planilla vacía arranca con la genérica',
    api: true, filas: 'vacia', cfgPlanilla: { url: 'https://script.google.com/macros/s/AKfycbxOTRA/exec', schema: ESQUEMA_FAMILIAR },
    ver: (e) => [[e.negocio === false && !e.categorias.includes('Mar de Pan'), 'las categorías de otra planilla no pueden aparecer acá']],
    porque: 'Cada planilla tiene su propio juego de categorías en el navegador.',
  },
  {
    nombre: 'Se recupera el esquema renombrado y una SEGUNDA sincronización encuentra el dañado → el negocio sigue',
    api: true, filas: 'renombradaYCorrupta',
    accion: async (page) => {
      await page.evaluate(async () => {
        window.uiConfirm = async () => true;
        await fetchSync();
        window.__negocioTrasSegunda = negocioActivo();
        await restoreDefaults();
      });
    },
    ver: (e, x) => [
      [x.negocioTrasSegunda === true, 'después de la segunda sincronización el negocio tiene que seguir'],
      [e.negocio === true, '«Restaurar» tiene que conservar el negocio'],
    ],
    extra: (page) => page.evaluate(() => ({ negocioTrasSegunda: window.__negocioTrasSegunda })),
    porque: 'Rechazar el esquema remoto y aplicar sus alias armaba una config que nunca existió: el negocio desaparecía y Restaurar subía el de hogar.',
  },
  {
    nombre: 'Editar la subcategoría de una extracción y ocultar el negocio → sigue sin contarse como ahorro',
    api: true, filas: 'conExtraccion',
    accion: async (page) => {
      await page.evaluate(async (sinNegocio) => {
        await updateTxFromSheet(TRANSACTIONS.find(t => t.u === 'e2'), { s: 'Panadería' });
        await new Promise(r => setTimeout(r, 1500));
        window.__filas.push({ d: '2026-09-30', t: '__CONFIG__', c: 'schema', s: '', a: 0, desc: sinNegocio, p: '', u: '' });
        await fetchSync();
      }, b64(ESQUEMA_SOLO_HOGAR));
    },
    ver: (e, x) => [
      [x.sub === 'Panadería', 'la edición tiene que aplicarse (quedó: ' + x.sub + ')'],
      [x.ingresoEsExtraccion, 'el ingreso tiene que seguir siendo una transferencia'],
      [!/ahorrado/.test(x.avisos), 'no puede aparecer ahorro (avisos: ' + x.avisos + ')'],
    ],
    extra: (page) => page.evaluate(() => {
      const t = TRANSACTIONS.find(t => t.u === 'e2');
      return { sub: t.s, ingresoEsExtraccion: isExtractionInc(t), avisos: computeInsights('history').map(i => i.text).join(' | ') };
    }),
    porque: 'La marca dice de dónde vino la plata; la subcategoría se puede editar y no lo cambia.',
  },
  {
    nombre: 'Se recupera un esquema renombrado viejo → con los alias de su época, no los posteriores',
    api: true, filas: 'renombradaYCorrupta',
    ver: (e) => [
      [e.negocio === true, 'el negocio renombrado tiene que reconocerse con su alias'],
      [e.navNegocio, 'el botón del negocio tiene que verse'],
    ],
    porque: 'Esquema viejo con alias nuevos es una combinación que nunca existió: el negocio quedaba apagado y «Restaurar» elegía el esquema de hogar.',
  },
  {
    nombre: 'Borrar el negocio del borrador, llega una sincronización con el esquema dañado, Restaurar → vuelve el negocio',
    api: true, filas: 'familiar',
    accion: async (page) => {
      await page.evaluate(async () => {
        window.uiConfirm = async () => true;
        delete SCHEMA.Egreso['Mar de Pan'];
        delete SCHEMA.Ingreso['Mar de Pan'];
        window.__filas.push({ d: '2026-09-30', t: '__CONFIG__', c: 'schema', s: '', a: 0, desc: '%%%no-es-base64%%%', p: '', u: '' });
        await fetchSync();
        await restoreDefaults();
      });
    },
    ver: (e) => [[e.negocio === true && e.categorias.includes('Mar de Pan'), 'una lectura ilegible no puede convertir el borrador en lo confirmado']],
    porque: 'Lo confirmado sale de una config aceptada de la planilla, nunca del borrador de ⚙️.',
  },
  {
    nombre: 'Editar la descripción de una extracción y ocultar el negocio → sigue sin contarse como ahorro',
    api: true, filas: 'conExtraccion',
    accion: async (page) => {
      await page.evaluate(async (sinNegocio) => {
        await updateTxFromSheet(TRANSACTIONS.find(t => t.u === 'e2'), { desc: 'otra cosa' });
        await new Promise(r => setTimeout(r, 1500));   // el editor resincroniza a los 1,2 s
        window.__filas.push({ d: '2026-09-30', t: '__CONFIG__', c: 'schema', s: '', a: 0, desc: sinNegocio, p: '', u: '' });
        await fetchSync();
      }, b64(ESQUEMA_SOLO_HOGAR));
    },
    ver: (e, x) => [
      [/otra cosa/.test(x.desc), 'la edición del texto tiene que aplicarse (quedó: ' + x.desc + ')'],
      [x.ingresoEsExtraccion, 'el ingreso tiene que seguir siendo una transferencia'],
      [!/ahorrado/.test(x.avisos), 'no puede aparecer ahorro (avisos: ' + x.avisos + ')'],
    ],
    extra: (page) => page.evaluate(() => {
      const t = TRANSACTIONS.find(t => t.u === 'e2');
      return { desc: t.desc, ingresoEsExtraccion: isExtractionInc(t), avisos: computeInsights('history').map(i => i.text).join(' | ') };
    }),
    porque: 'La marca es lo que dice que esa plata vino del negocio: el editor de texto no puede borrarla de paso.',
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
    await page.addInitScript(({ api, filas, cache, origen, cfg, lecturaFalla, liberar, qrDesde }) => {
      if (cfg) localStorage.setItem('FINANZAS_CFG::' + cfg.url, JSON.stringify({ schema: cfg.schema, aliases: cfg.aliases || {} }));
      if (api) { localStorage.setItem('FINANZAS_API_URL', qrDesde || api); localStorage.setItem('FINANZAS_API_TOKEN', 'tok'); }
      if (cache) localStorage.setItem('FINANZAS_SCHEMA', JSON.stringify(cache));
      if (origen) localStorage.setItem('FINANZAS_SCHEMA_ORIGEN', origen);
      window.__filas = filas; window.__dejarSincronizar = !cache || liberar;   // con cache, la sync se libera a mano
      window.__posts = [];
      window.fetch = async (u, o) => {
        if (/script\.google\.com/.test(String(u))) {
          if (o && o.method === 'POST') {
            const b = JSON.parse(o.body);
            window.__posts.push(b);
            // Lo que se envía queda en la planilla falsa: sin esto, un esquema
            // subido por error no se vería en lo que leen los otros dispositivos.
            // Como el servidor real: la descripción de un movimiento se corta en
            // 500 (MAX_DESC_LEN); la de una fila de config, no.
            const corte = (x) => x.type === '__CONFIG__' ? x.description : String(x.description || '').slice(0, 500);
            if (b.action === 'addTransaction') window.__filas.push({ d: String(b.date).slice(0, 10), t: b.type,
              c: b.category, s: b.subcategory, a: b.amount, desc: corte(b), p: b.paymentMethod || '', u: b.uid });
            if (b.action === 'addTransactions') (b.txs || []).forEach(x => window.__filas.push({ d: String(x.date).slice(0, 10),
              t: x.type, c: x.category, s: x.subcategory, a: x.amount, desc: corte(x), p: x.paymentMethod || '', u: x.uid }));
            if (b.action === 'updateTransaction') {
              const f = window.__filas.find(r => r.u && r.u === b.uid);
              if (f) Object.assign(f, b.changes);
            }
            return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, written: 1, writtenUids: [b.uid], skipped: [] }) };
          }
          if (lecturaFalla) throw new TypeError('Failed to fetch');
          while (!window.__dejarSincronizar) await new Promise(r => setTimeout(r, 50));
          window.__lecturas = (window.__lecturas || 0) + 1;
          return { ok: true, status: 200, json: async () => window.__filas, text: async () => JSON.stringify(window.__filas) };
        }
        return new Response('', { status: 200 });
      };
    }, { api: caso.api ? API : null, filas: FILAS[caso.filas], cache: caso.cacheEsquema || null,
      origen: caso.cacheOrigen === 'misma' ? API : (caso.cacheOrigen || null),
      cfg: caso.cfgPlanilla ? Object.assign({}, caso.cfgPlanilla, { url: caso.cfgPlanilla.url === 'misma' ? API : caso.cfgPlanilla.url }) : null,
      lecturaFalla: !!caso.lecturaFalla, liberar: !!caso.liberarSync, qrDesde: caso.qrDesde || null });
    // Con qrDesde, el navegador estaba en otra planilla y se abre el link del
    // QR de la nueva: el que cambia de planilla es el arranque de la app.
    await page.goto(caso.qrDesde ? file + '?api=' + encodeURIComponent(API) + '&token=tok' : file, { waitUntil: 'load' });
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
