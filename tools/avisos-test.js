/**
 * Tests de los avisos del hogar: que hablen en impersonal.
 *
 * La barra de avisos de Historial y de Hogar decía «ya gastaste el 93 % del
 * promedio. Aflojá un toque», «Tu patrimonio…», «no cargás movimientos». En un
 * hogar de una persona anda. En uno de dos, el aviso le llega a quien tenga el
 * teléfono en la mano, por un gasto que pudo hacer la otra: un reto dirigido a
 * quien no lo hizo. Los avisos van en impersonal («se gastó», «el patrimonio
 * del hogar»), que sirve para los dos casos.
 *
 * Dos mitades:
 *  1. En el código: cada texto de `_computeInsightsInner`, salvo el bloque del
 *     negocio (view === 'mdp', le habla a quien lo lleva), contra el léxico.
 *     Cubre también los avisos que los escenarios no disparan.
 *  2. En la app: tres escenarios con fecha fija y una planilla simulada, que
 *     disparan los avisos con verbo. Se mira el texto que arma la app (con las
 *     partes que se interpolan, como «va en rojo») y el de la barra. Cada
 *     escenario verifica además QUÉ avisos aparecieron (por ícono y tono, que no
 *     cambian con el texto): si no aparece ninguno, el léxico pasaría solo.
 *
 * Uso: node tools/avisos-test.js index.html
 *
 * Contra el código anterior (22baddd) pasa 0 de 4: los cuatro casos encuentran
 * segunda persona. La cobertura (qué avisos aparecen) pasa en las dos versiones,
 * y con los avisos apagados (un mutante que devuelve la lista vacía) fallan los
 * tres escenarios por cobertura: es la mitad que hace que el léxico pueda fallar.
 */
const { chromium } = require('/opt/homebrew/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const API = 'https://script.google.com/macros/s/AKfycbxPRUEBA/exec';
const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const HOY = '2026-11-18T12:00:00-03:00';   // mitad de mes: dispara los avisos de ritmo

/* ---------- El léxico: lo que delata una segunda persona ---------- */

const PRONOMBRES = new Set(['tu', 'tus', 'vos', 'te', 'ti', 'contigo']);
const JUNTOS = new Set(['juntos', 'juntas']);           // además, supone un género
// Palabras que terminan como un voseo y no lo son.
const NO_VOSEO = new Set(['más', 'además', 'jamás', 'atrás', 'detrás', 'demás', 'después',
  'través', 'inglés', 'interés', 'país', 'maíz', 'raíz', 'francés', 'cortés']);
const AGUDAS_OK = new Set(['está', 'estará', 'será', 'hará', 'podrá', 'habrá', 'tendrá', 'irá',
  'quedará', 'dará', 'sabrá', 'vendrá', 'saldrá', 'terminará', 'acá', 'allá', 'así', 'aquí',
  'mamá', 'papá', 'café', 'bebé', 'sofá', 'maní', 'ají', 'esquí']);
const NO_PRETERITO = new Set(['desgaste', 'contraste', 'traste', 'existe', 'consiste', 'insiste',
  'resiste', 'persiste', 'subsiste', 'desiste', 'triste', 'chiste', 'despiste', 'alpiste']);
const NO_ENCLITICO = new Set(['aparte', 'suerte', 'fuerte', 'muerte', 'inerte', 'descarte',
  'baluarte', 'estandarte', 'contraparte']);

function segundaPersona(texto) {
  const malas = [];
  for (const m of String(texto).matchAll(/\p{L}+/gu)) {
    const w = m[0].toLowerCase();
    const regla =
      PRONOMBRES.has(w) ? 'pronombre' :
      JUNTOS.has(w) ? 'juntos' :
      (/^\p{L}{2,}(ás|és|ís)$/u.test(w) && !NO_VOSEO.has(w)) ? 'voseo' :          // llevás, querés, seguís
      (/^\p{L}{3,}[áéí]$/u.test(w) && !AGUDAS_OK.has(w)) ? 'imperativo' :         // aflojá, revisá
      (/^\p{L}{2,}(aste|iste)$/u.test(w) && !NO_PRETERITO.has(w)) ? 'pretérito' : // gastaste, viste
      (/^\p{L}+abas$/u.test(w) || w === 'ibas') ? 'imperfecto' :                   // gastabas, ibas
      (/^\p{L}{2,}(ar|er|ir)te$/u.test(w) && !NO_ENCLITICO.has(w)) ? 'enclítico' : // ponerte
      null;
    if (regla) malas.push(`${m[0]} (${regla})`);
  }
  return malas;
}

/* ---------- Mitad 1: los textos en el código ---------- */

function textosDelCodigo(html) {
  const ini = html.indexOf('function _computeInsightsInner(view) {');
  const fin = html.indexOf('\n            return insights;\n        }', ini);
  const mdpIni = html.indexOf('// === MDP:', ini);
  const mdpFin = html.indexOf('// === HOGAR: alerta', ini);
  if (ini < 0 || fin < 0 || mdpIni < 0 || mdpFin < 0 || !(ini < mdpIni && mdpIni < mdpFin && mdpFin < fin)) {
    return { error: 'no se encontraron las marcas de _computeInsightsInner o del bloque del negocio' };
  }
  let region = html.slice(ini, mdpIni) + html.slice(mdpFin, fin);
  const textos = [];
  region = region.replace(/`([^`]*)`/g, (_, t) => { textos.push(t.replace(/\$\{[^}]*\}/g, ' ')); return '``'; });
  region.replace(/'([^'\n]*)'/g, (_, t) => { textos.push(t); return ''; });
  return { textos };
}

/* ---------- Mitad 2: escenarios en la app ---------- */

const ESQUEMA = { Egreso: { Casa: ['Luz', 'Café', 'Otros'] }, Ingreso: { Sueldo: ['Sueldo'] } };
let n = 0;
const mov = (d, t, a, desc) => ({ d, t, c: t === 'Egreso' ? 'Casa' : 'Sueldo',
  s: t === 'Egreso' ? (desc === 'café' ? 'Café' : 'Otros') : 'Sueldo', a, desc: desc || '', p: '', u: 'm' + (++n), o: '' });
const config = { d: '2026-08-01', t: '__CONFIG__', c: 'schema', s: '', a: 0, desc: b64(ESQUEMA), p: '', u: 'cfg' };
const meses = (lista, inc, exp, desc) => lista.flatMap(m => [mov(m + '-05', 'Ingreso', inc), mov(m + '-20', 'Egreso', exp, desc)]);

const ESCENARIOS = [
  {
    nombre: 'Un mes que viene mal',
    porque: 'Tres meses en rojo y uno en curso que gasta de más: disparan el ritmo («ya gastaste… Aflojá»), el rojo («gastaste… Revisá»), los tres meses («juntos»), el patrimonio («Tu») y las etiquetas («Llevás… ibas»).',
    filas: [config, ...meses(['2026-08', '2026-09', '2026-10'], 100000, 150000, 'café'),
      mov('2026-11-05', 'Ingreso', 20000), mov('2026-11-10', 'Egreso', 140000, 'café')],
    espera: { history: { '🫂|bad': 2, '⚠️|warn': 1, '📲|info': 1, '🏷️|info': 1 },
              hogar: { '⏳|warn': 1, '🏠|warn': 1, '🫂|bad': 1 } },
  },
  {
    nombre: 'Un mes que viene bien',
    porque: 'Patrimonio sólido, ahorro del año y menos gasto que el promedio: «Tu patrimonio», «llevás ahorrado», «Llevás un % menos», «Llevás $ en la etiqueta».',
    // La etiqueta aparece recién en el mes en curso: es el otro texto de las etiquetas.
    filas: [config, ...meses(['2026-08', '2026-09', '2026-10'], 300000, 100000),
      mov('2026-11-05', 'Ingreso', 300000), mov('2026-11-15', 'Egreso', 20000, 'café')],
    espera: { history: { '💪|good': 1, '💰|good': 1, '🏷️|info': 1, '💚|good': 1 },
              hogar: { '✨|good': 1 } },
  },
  {
    nombre: 'Un mes cerrado que gastó de más, y días sin cargar',
    porque: 'Sin nada cargado en el mes en curso: «gastaste X % más que tu promedio», «no cargás movimientos. ¿Querés…?» y el colchón corto («Tu patrimonio»).',
    filas: [config, mov('2026-08-05', 'Ingreso', 150000), mov('2026-08-20', 'Egreso', 100000),
      mov('2026-09-05', 'Ingreso', 150000), mov('2026-09-20', 'Egreso', 100000),
      mov('2026-10-05', 'Ingreso', 150000), mov('2026-10-31', 'Egreso', 200000)],
    espera: { history: { '📲|info': 1, '🔴|bad': 1 }, hogar: { '🏠|warn': 1 } },
  },
];

async function correrEscenario(browser, file, esc) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addInitScript(({ api, filas, hoy, tags }) => {
    const FIJA = new Date(hoy).getTime();
    const D = Date;
    class F extends D {
      constructor(...a) { if (a.length === 0) super(FIJA); else super(...a); }
      static now() { return FIJA; }
    }
    window.Date = F;
    localStorage.setItem('FINANZAS_API_URL', api);
    localStorage.setItem('FINANZAS_API_TOKEN', 'tok');
    localStorage.setItem('FINANZAS_PERSONAL_TAGS', JSON.stringify(tags));
    window.__lecturas = 0;
    window.fetch = async (u, o) => {
      if (/script\.google\.com/.test(String(u))) {
        if (o && o.method === 'POST') {
          return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, written: 1, writtenUids: [], skipped: [] }) };
        }
        window.__lecturas++;
        return { ok: true, status: 200, json: async () => filas, text: async () => JSON.stringify(filas) };
      }
      return new Response('', { status: 200 });
    };
  }, { api: API, filas: esc.filas, hoy: HOY, tags: [{ label: 'Café', patterns: ['café'] }] });
  await page.goto(file, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => {
    const vistas = {};
    ['home', 'history', 'hogar'].forEach(v => { vistas[v] = computeInsights(v); });
    renderHistory('total'); renderHogar('all');
    return {
      lecturas: window.__lecturas,
      vistas,
      barras: [document.getElementById('historyInsights').textContent,
               document.getElementById('hogarInsights').textContent],
    };
  });
  await ctx.close();
  return r;
}

(async () => {
  const arch = path.resolve(process.argv[2] || 'index.html');
  const file = 'file://' + arch;
  let fallaron = 0, total = 0;
  const reportar = (nombre, porque, fallas) => {
    total++;
    console.log(`${fallas.length ? '❌' : '✅'} ${nombre}`);
    console.log(`   ${porque}`);
    if (fallas.length) { fallaron++; fallas.forEach(f => console.log('   ⚠️  ' + f)); }
  };

  // Mitad 1
  const cod = textosDelCodigo(fs.readFileSync(arch, 'utf8'));
  const fallasCodigo = [];
  if (cod.error) fallasCodigo.push(cod.error);
  else {
    if (cod.textos.length < 20) fallasCodigo.push(`solo ${cod.textos.length} textos en la región: ¿se movieron las marcas?`);
    cod.textos.forEach(t => {
      const malas = segundaPersona(t);
      if (malas.length) fallasCodigo.push(`«${t.trim().slice(0, 70)}» → ${malas.join(', ')}`);
    });
  }
  reportar('Los textos de los avisos del hogar, en el código',
    'Cada texto de _computeInsightsInner fuera del bloque del negocio, aunque ningún escenario lo dispare.', fallasCodigo);

  // Mitad 2
  const browser = await chromium.launch();
  for (const esc of ESCENARIOS) {
    const r = await correrEscenario(browser, file, esc);
    const fallas = [];
    if (r.lecturas < 1) fallas.push('la planilla simulada no se leyó');
    for (const [vista, esperados] of Object.entries(esc.espera)) {
      const vistos = {};
      (r.vistas[vista] || []).forEach(i => { const k = `${i.icon}|${i.tone}`; vistos[k] = (vistos[k] || 0) + 1; });
      for (const [k, cant] of Object.entries(esperados)) {
        if ((vistos[k] || 0) < cant) fallas.push(`cobertura: en ${vista} esperaba ${cant} aviso(s) ${k}, hubo ${vistos[k] || 0}`);
      }
    }
    Object.entries(r.vistas).forEach(([vista, lista]) => lista.forEach(i => {
      const malas = segundaPersona(i.text);
      if (malas.length) fallas.push(`${vista}: «${i.text}» → ${malas.join(', ')}`);
    }));
    r.barras.forEach((b, k) => {
      const malas = segundaPersona(b);
      if (malas.length) fallas.push(`barra de ${k ? 'Hogar' : 'Historial'} → ${malas.join(', ')}`);
    });
    reportar(esc.nombre, esc.porque, fallas);
  }
  await browser.close();
  console.log(`\n${total - fallaron}/${total} pasaron`);
  process.exit(fallaron ? 1 : 0);
})();
