/**
 * Tests de los colores de las tortas.
 *
 * En una torta, dos porciones del mismo color se leen como una sola: el gráfico
 * dice algo que el dato no dice. Este test dibuja las cuatro tortas reales de la
 * app (costos del negocio, gastos del hogar, el mes por categoría y cada
 * categoría por subcategoría) con los tres esquemas que trae el código, y mira
 * los colores que quedaron en el gráfico, no los que devolvería una función.
 *
 * Verifica:
 *   1. Ninguna torta de hasta 16 porciones (el largo de la paleta) repite un color.
 *   2. Una categoría tiene el mismo color en dos meses con porciones distintas.
 *   3. Un nombre viejo que ya no está en el menú no choca con los del menú.
 *   4. Un hogar con 13 categorías no repite colores.
 *
 * Uso: node tools/torta-test.js index.html
 *
 * Contra el código anterior (color por hash del nombre, hasta 22e4bdd) falla el
 * caso 1 en los tres esquemas: Salud = Familia en el de un hogar nuevo,
 * Servicios = Salud = Indumentaria en el demo.
 */
const { chromium } = require('/opt/homebrew/lib/node_modules/playwright');
const path = require('path');

const archivo = path.resolve(process.argv[2] || 'index.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  await page.goto('file://' + archivo);
  await page.waitForTimeout(800);

  const r = await page.evaluate(() => {
    const out = [];
    const dupes = (labels, colors) => {
      const by = {};
      labels.forEach((l, i) => (by[colors[i]] = by[colors[i]] || []).push(l));
      return Object.values(by).filter(x => x.length > 1).map(x => x.join(' = '));
    };
    const leer = (ch) => ({ labels: ch.data.labels.slice(), colors: ch.data.datasets[0].backgroundColor.slice() });
    const subsDe = (v) => Array.isArray(v) ? v : Object.keys(v || {});

    // Una transacción por (tipo, categoría, subcategoría), con montos distintos
    // para que el orden de las porciones no coincida con el del menú.
    const armar = (S, mes, filtro) => {
      const txs = []; let n = 1;
      for (const type of ['Egreso', 'Ingreso']) {
        for (const cat of Object.keys(S[type] || {})) {
          if (filtro && !filtro(cat)) continue;
          for (const sub of subsDe(S[type][cat])) {
            txs.push({ d: mes + '-10', t: type, c: cat, s: sub, a: (n * 7919) % 1000 + 10, desc: '', p: '', u: 'x' + n });
            n++;
          }
        }
      }
      return txs;
    };

    const ESQUEMAS = { SCHEMA_HOGAR, SCHEMA_DEMO, SCHEMA_PERSONAL };
    for (const [nombre, S] of Object.entries(ESQUEMAS)) {
      SCHEMA = JSON.parse(JSON.stringify(S));
      ALIASES = {};
      TRANSACTIONS = armar(S, '2026-09');
      processHistory();
      const tortas = [];
      renderHogar('all'); tortas.push(['hogar', leer(hogarCostChart)]);
      if (Object.keys(S.Egreso).includes(BIZ_NAME)) { renderMarDePan('all'); tortas.push(['negocio', leer(mdpCostChart)]); }
      for (const type of ['Egreso', 'Ingreso']) {
        renderBreakdown('2026-09', type); tortas.push([type, leer(bChart)]);
        for (const cat of Object.keys(S[type])) {
          renderSubBreakdown('2026-09', type, cat); tortas.push([type + '/' + cat, leer(sChart)]);
        }
      }
      for (const [donde, t] of tortas) {
        if (t.labels.length > CHART_PALETTE.length) continue;
        out.push({ caso: 1, nombre: `${nombre} · ${donde} (${t.labels.length})`, dupes: dupes(t.labels, t.colors) });
      }

      // 2. Otro mes con la mitad de las categorías, y con otros montos.
      renderBreakdown('2026-09', 'Egreso');
      const antes = leer(bChart);
      const mitad = Object.keys(S.Egreso).filter((_, i) => i % 2 === 1);
      TRANSACTIONS = armar(S, '2026-09').concat(armar(S, '2026-10', c => mitad.includes(c)).map(t => ({ ...t, a: 100000 - t.a })));
      processHistory();
      renderBreakdown('2026-10', 'Egreso');
      const despues = leer(bChart);
      const cambian = despues.labels.filter((l, i) => antes.colors[antes.labels.indexOf(l)] !== despues.colors[i]);
      out.push({ caso: 2, nombre: `${nombre} · mismo color en otro mes`, dupes: cambian.map(l => l + ' cambió de color') });
    }

    // 3. Un nombre histórico fuera del menú, en la misma torta que los del menú.
    SCHEMA = JSON.parse(JSON.stringify(SCHEMA_HOGAR));
    TRANSACTIONS = armar(SCHEMA_HOGAR, '2026-09').concat([{ d: '2026-09-11', t: 'Egreso', c: 'HogarYVida', s: 'Familia', a: 99999, desc: '', p: '', u: 'h1' }]);
    processHistory();
    renderBreakdown('2026-09', 'Egreso');
    const t3 = leer(bChart);
    out.push({ caso: 3, nombre: 'nombre fuera del menú (HogarYVida) + menú de un hogar', dupes: dupes(t3.labels, t3.colors) });
    // 4. Un hogar con 13 categorías, todas con gasto en el mismo mes (el primer
    // hogar del piloto llegó así). Con 12 colores, la 13 repetía la primera.
    const TRECE = { Egreso: {}, Ingreso: { Ingresos: ['Sueldo'] } };
    for (let i = 1; i <= 13; i++) TRECE.Egreso['Categoría ' + i] = ['Sub'];
    SCHEMA = JSON.parse(JSON.stringify(TRECE));
    TRANSACTIONS = armar(TRECE, '2026-09');
    processHistory();
    renderBreakdown('2026-09', 'Egreso');
    const t4 = leer(bChart);
    out.push({ caso: 4, nombre: `13 categorías con gasto en el mismo mes (${t4.labels.length})`, dupes: dupes(t4.labels, t4.colors) });
    return out;
  });

  let ok = 0;
  for (const x of r) {
    const pasa = x.dupes.length === 0;
    if (pasa) ok++;
    console.log(`${pasa ? '✅' : '❌'} [${x.caso}] ${x.nombre}${pasa ? '' : ' → ' + x.dupes.join(' | ')}`);
  }
  if (errores.length) console.log('Errores de la página:\n  ' + errores.join('\n  '));
  console.log(`\n${ok}/${r.length} tortas sin colores repetidos`);
  await browser.close();
  process.exit(ok === r.length && !errores.length ? 0 : 1);
})();
