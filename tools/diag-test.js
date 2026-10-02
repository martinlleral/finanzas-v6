/**
 * Tests del diagnóstico de conexión (🩺 en ⚙️).
 *
 * El diagnóstico es el instrumento con el que se arregla un teléfono que no
 * sincroniza, a distancia y por chat. Si miente, se persigue una falla que no
 * existe. Pasó: informó "IDEMPOTENCIA ❌ — puede duplicar" cuando el servidor
 * no había duplicado nada. Lo que había fallado era el SEGUNDO envío de la
 * prueba, y el diagnóstico no distinguía una cosa de la otra.
 *
 * Uso: node tools/diag-test.js index.html
 *
 * Contra el cliente v7.6 pasan 2 de 5.
 */
const { chromium } = require('/opt/homebrew/lib/node_modules/playwright');
const path = require('path');

const ID = 'AKfycbxSECRETOSECRETOSECRETOSECRETOSECRETO';
const URL_SANA = 'https://script.google.com/macros/s/' + ID + '/exec';

// Servidor falso. `guion` dice cómo contesta cada pedido, en orden:
//   get:  'datos' | '404' | 'unauthorized'
//   post: 'ok' | 'ok-duplica' | '404'
const PREPARAR = ({ gets, posts }) => {
  window.__gets = []; window.__posts = []; window.__filas = [];
  const json = (o) => ({ ok: true, status: 200, redirected: true,
    url: 'https://script.googleusercontent.com/macros/echo?user_content_key=XYZ',
    headers: { get: () => 'application/json; charset=utf-8' },
    text: async () => JSON.stringify(o), json: async () => o });
  const html404 = () => ({ ok: false, status: 404, redirected: true,
    url: 'https://script.googleusercontent.com/macros/echo?user_content_key=XYZ',
    headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => '<html><head><title>Error 404 (Not Found)</title></head><body>…</body></html>',
    json: async () => { throw new SyntaxError('no es JSON'); } });
  window.fetch = async (url, opt) => {
    if (!opt || opt.method !== 'POST') {
      window.__gets.push(String(url));
      const k = gets[window.__gets.length - 1] || gets[gets.length - 1];
      if (k === '404') return html404();
      if (k === 'unauthorized' || /action=ping/.test(String(url))) return json({ error: 'Unauthorized' });
      return json(window.__filas);
    }
    const body = JSON.parse(opt.body);
    window.__posts.push(body);
    const k = posts[window.__posts.length - 1] || posts[posts.length - 1];
    if (k === '404') return html404();
    const ya = window.__filas.some(r => r.u === body.uid);
    if (ya && k !== 'ok-duplica') return json({ ok: true, written: 0, writtenUids: [], skipped: [body.uid] });
    window.__filas.push({ d: body.date, t: body.type, c: body.category, u: body.uid });
    return json({ ok: true, written: 1, writtenUids: [body.uid], skipped: [] });
  };
  // El resultado se captura en vez de abrir el diálogo y tocar el portapapeles.
  window.__diag = [];
  window._copiarDiagnostico = (lineas) => { window.__diag.push(lineas.join('\n')); };
};

const CASOS = [
  {
    nombre: 'Servidor sano → las tres en ✅',
    guion: { gets: ['datos'], posts: ['ok', 'ok'] },
    ver: (t) => [
      [/LECTURA: ✅/.test(t), 'la lectura tiene que dar ✅'],
      [/ESCRITURA: ok/.test(t), 'la escritura tiene que dar ok'],
      [/IDEMPOTENCIA: ✅/.test(t), 'el reenvío salteado tiene que dar ✅'],
    ],
    porque: 'El caso base: si esto no da tres ✅, el diagnóstico no sirve de referencia.',
  },
  {
    nombre: 'El segundo envío FALLA → "sin comprobar", NO "puede duplicar"',
    guion: { gets: ['404', 'unauthorized'], posts: ['ok', '404'] },
    ver: (t, e) => [
      [e.filas === 1, 'el servidor escribió una sola fila (hubo ' + e.filas + ')'],
      [/IDEMPOTENCIA: ⚠️/.test(t), 'tiene que decir que no se pudo comprobar'],
      [!/IDEMPOTENCIA: ❌/.test(t), 'NO puede acusar al servidor de duplicar'],
    ],
    porque: 'Es el caso real: una fila en la planilla, y el diagnóstico decía que duplicaba.',
  },
  {
    nombre: 'El servidor de verdad escribe dos veces → ❌ y lo dice',
    guion: { gets: ['datos'], posts: ['ok', 'ok-duplica'] },
    ver: (t, e) => [
      [e.filas === 2, 'el servidor falso tiene que haber escrito dos (hubo ' + e.filas + ')'],
      [/IDEMPOTENCIA: ❌/.test(t), 'un duplicado real tiene que dar ❌'],
    ],
    porque: 'El arreglo del caso anterior no puede volver ciego al diagnóstico.',
  },
  {
    nombre: 'Lectura ilegible → dice dónde terminó, qué página era y corre el control',
    guion: { gets: ['404', 'unauthorized'], posts: ['ok', 'ok'] },
    ver: (t, e) => [
      [/LECTURA: ❌/.test(t), 'la lectura tiene que dar ❌'],
      [/script\.googleusercontent\.com/.test(t), 'tiene que nombrar el host donde terminó'],
      [/Error 404/.test(t), 'tiene que copiar el título de la página de error'],
      [/control/i.test(t) && e.gets === 2, 'tiene que hacer la lectura de control (GETs: ' + e.gets + ')'],
      [t.indexOf('SECRETO') === -1 && t.indexOf('XYZ') === -1, 'no puede filtrar el id de la URL ni la clave de la redirección'],
    ],
    porque: '"Respuesta ilegible (404)" no alcanza para saber si lo roto es la URL, la publicación o los datos.',
  },
  {
    nombre: 'Dos toques seguidos al botón → una sola corrida',
    guion: { gets: ['datos'], posts: ['ok', 'ok'] },
    dobleToque: true,
    ver: (t, e) => [
      [e.posts === 2, 'una corrida son 2 envíos (hubo ' + e.posts + ')'],
      [e.filas === 1, 'una corrida deja 1 fila de prueba (hubo ' + e.filas + ')'],
    ],
    porque: 'Sin aviso de que está corriendo, se toca de nuevo: cada toque deja otra fila de prueba en la planilla.',
  },
];

(async () => {
  const file = 'file://' + path.resolve(process.argv[2] || 'index.html');
  const browser = await chromium.launch();
  let fallaron = 0;
  for (const caso of CASOS) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.addInitScript((u) => {
      localStorage.setItem('FINANZAS_API_URL', u);
      localStorage.setItem('FINANZAS_API_TOKEN', 'test');
    }, URL_SANA);
    await page.goto(file, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.evaluate(PREPARAR, caso.guion);
    await page.evaluate(async (doble) => {
      const a = probarConexion();
      const b = doble ? probarConexion() : null;
      await a; if (b) await b;
    }, !!caso.dobleToque);
    const e = await page.evaluate(() => ({ texto: window.__diag.join('\n'), gets: window.__gets.length,
                                           posts: window.__posts.length, filas: window.__filas.length }));
    const fallas = caso.ver(e.texto, e).filter(([ok]) => !ok).map(([, msg]) => msg);
    console.log(`${fallas.length ? '❌' : '✅'} ${caso.nombre}`);
    console.log(`   ${caso.porque}`);
    if (fallas.length) { fallaron++; fallas.forEach(f => console.log('   ⚠️  ' + f)); }
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${CASOS.length - fallaron}/${CASOS.length} pasaron`);
  process.exit(fallaron ? 1 : 0);
})();
