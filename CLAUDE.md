# Finanzas V6.2 — App de Finanzas Personales

## Qué es
Aplicación web de finanzas personales para registrar ingresos y egresos, con sincronización opcional a Google Sheets e interfaz neumórfica.

## Stack
- HTML5 + CSS3 + JavaScript vanilla
- Chart.js (gráficos)
- canvas-confetti (animaciones)
- Google Apps Script (sync con Google Sheets, opcional)
- localStorage (persistencia offline)

## Estructura
- **Archivo único**: `index.html` (~4200 líneas). **Line endings CRLF** — respetarlos: un script que los pase a LF genera un diff de 8000 líneas irrevisable.
- `server/apps_script.gs` (backend, **LF**) — se despliega a mano copiando y pegando en el editor de Apps Script.
- `server/dedupe_movimientos.py` — limpieza de duplicados históricos del sheet (dry-run por default).
- Vistas: home, historial, tendencias, Mar de Pan, hogar, config, mes, breakdown, sub, confirm
- Modales: categorías, acciones de tx, diálogo, QR
- Sin package.json — todo vanilla, sin build step

## Deploy
- Cliente: GitHub Pages via GitHub Actions → https://martinlleral.github.io/finanzas-v6
- Backend: manual. Desplegar **el servidor primero**; ambas direcciones son compatibles (servidor v3 + cliente v2 funciona; cliente v3 + servidor v2 funciona degradado sin dedupe).

## Configuración
- `API_URL`: vacía por defecto (modo demo/offline, anonimizado para el portafolio público)
- `SCHEMA`: configurable con categorías y subcategorías
- ⚠️ **`SCHEMA_DEMO` es la versión anonimizada del portafolio público. Nunca copiar categorías reales ahí.**

## Contrato con el sheet
Esquema **posicional, SIN fila de header**. La fila 1 es un movimiento real que tiene el texto "Forma de Pago" pegado en la col G (un header que se escribió sobre datos); `getRawData()` la saltea, así que **ese movimiento es invisible para la app**. No escribir nada en la fila 1.

```
A Fecha | B Tipo | C Categoría | D Subcategoría | E Monto | F Descripción | G Forma de Pago | H uid
```

- **Columna H = uid**: clave de idempotencia. Filas legacy y las que escribe `cierre.py` la tienen vacía → el servidor las trata como "sin idempotencia, escribir siempre".
- Las filas `__CONFIG__` **no son movimientos**: son el SCHEMA/ALIASES serializados en base64 dentro del campo descripción.
- El sheet lo escribe **también** `cierre.py --cargar-finanzas` del skill `/cierremdp` (gspread + service account, filas de 7 columnas). No romper ese contrato.

## Convenciones aprendidas (no romper)
- **El documento nunca scrollea.** Todo el scroll vive dentro de cada `.app-view`. Las 8 vistas inactivas están en `translateX(100%)`: la contención depende de `html{overflow:clip}` + `body{position:relative;overflow:clip}`. Tocar eso destapa 8 anchos de pantalla de scroll lateral.
- Variables de layout en `:root`: `--pad-x` (padding lateral de las vistas) y `--sa-*` (safe-area del notch; valen 0px sin `viewport-fit=cover`).
- `--amt-chars` la escribe `setAmountDisplay()` y la consume el `clamp()` de `.amount-display`. **Ese es el único lugar que puede escribir el monto en pantalla.**
- El coeficiente `0.62` del clamp es el ancho de avance de un dígito en Outfit 300. **Si se cambia la tipografía, re-medirlo con Playwright**, no adivinarlo (medido 31/7/2026: 0.59).
- Todo POST pasa por `apiPost()`, que usa `Content-Type: text/plain;charset=utf-8` **a propósito**: `application/json` no es CORS-safelisted y dispara un preflight que Apps Script no responde. Volver a `no-cors` reintroduce los duplicados.
- El `uid` **tiene que viajar al servidor** en cada POST. Es lo único que evita que un reintento escriba la fila dos veces.
- La config se serializa con `jsonToB64`/`b64ToJson` (TextEncoder). **No usar `btoa` directo**: escribe latin-1, rompe los acentos y explota con un emoji.
- Offline-first: funciona sin API configurada
- Formatos argentinos (ARS, dd/MM/yyyy)

## Auditoría del dato
El skill `/auditarfinanzas` (en `~/.claude/skills/auditarfinanzas/`) audita el sheet read-only y traduce cada hallazgo a un fix con archivo:línea. Correrlo después de cada tanda de fixes (`quick`) o una vez por mes (`deep`). Guarda un libro mayor que mide si los fixes anteriores funcionaron.

## Tests (requieren `npm i -g playwright`)

```bash
node tools/sync-test.js index.html          # motor de sincronización — 5/5
node tools/auth-test.js server/apps_script.gs     # autenticación — 11/11
node tools/backend-test.js server/apps_script.gs  # backend contra hoja simulada — 16/16
node tools/layout-harness.js index.html     # layout — 0 fallas de 105 mediciones
node tools/smoke-test.js index.html         # flujo end-to-end + calibración tipográfica
```

- **`sync-test.js`** cubre los caminos donde un bug **no se ve**: la transacción se escribe dos veces o desaparece en silencio. Mockea el servidor y verifica el estado real de la cola, el buffer optimista y los POST. Contra el código previo a la v3 pasa **1 de 5** (el primero falla con `filasEnSheet: esperaba 1, hubo 2`, que es el bug reproducido).
- **`auth-test.js`** mockea `PropertiesService` para correr `checkAuth_` fuera de Google. Contra la versión previa pasa **2 de 11**.
- **`backend-test.js`** corre el `.gs` real contra un Google Sheets simulado: idempotencia por uid, validar-todo-antes-de-escribir, truncado de config vs descripción, lock ocupado, expansión de grilla, delete por uid. Es la otra mitad de `sync-test.js` (que prueba el cliente contra un servidor simulado). Contra el backend previo a la v7 pasa **0 de 16**.
- **`layout-harness.js`**: 7 viewports × 10 vistas × 4 modales, con montos de 9 dígitos tipeados por la ruta real y stress de `$123.456.789`. **Assertion: 0 fallas.** Baseline del 31/7/2026 antes de los fixes: 105.

**Correr los cinco antes de tocar el motor de sync, la auth o el CSS de layout.**

## Seguridad: el token

**No está en el código, y es a propósito.** Vive en las Propiedades del script (Apps Script → Configuración del proyecto → Propiedades → `SECRET_TOKEN`). Antes era una constante con un placeholder en el repo; como el despliegue es "seleccioná todo y reemplazá", pegar el archivo pisaba el token real con el placeholder — y `checkAuth_` tenía un modo permisivo justo para ese valor, así que **la autenticación se apagaba en silencio**.

- `verificarToken_()` desde el editor dice si está configurado, sin revelarlo.
- `setupToken_()` genera y guarda uno nuevo (después hay que cargarlo en cada dispositivo desde ⚙️).
- **Falla cerrado**: sin token configurado el script rechaza todo. Es deliberado — un servidor cerrado se nota en el primer uso, uno abierto no se nota nunca. Nada se pierde: el cliente encola y reintenta.
- Chequeo externo: `curl "<API_URL>?action=getRawData&token=BASURA"` tiene que devolver `{"error":"Unauthorized"}`.
