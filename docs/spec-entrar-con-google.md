# Spec · «Entrar con Google» (camino B)

> **Estado (27/11/2026): borrador para revisar. No hay código.** Lo que define
> este documento se construye recién si pasan las dos pruebas de la sección 2.
> Mientras tanto la app sigue funcionando con Apps Script, como hoy.
>
> **Para quién:** la sesión o la persona que lo construya, y quien mire el repo
> para entender por qué la app hace lo que hace. Los pasos concretos de la
> instancia familiar no van en este repo.

## 0. En una pantalla

- **Qué cambia.** La app deja de necesitar un script de Google pegado en cada
  planilla. Cada persona entra con su cuenta de Google y la app lee y escribe
  directo en la planilla de su hogar, con el permiso más chico que ofrece
  Google: `drive.file`, que da acceso solo a los archivos que se usan con esta app.
- **Qué se gana.** Instalar deja de ser «15 minutos en una computadora: pegar
  código, publicarlo, copiar un token» y pasa a ser «abrí el link y entrá con
  Google». Desaparecen el token, el QR y la configuración de la URL.
- **Qué no cambia.** Los datos siguen en una planilla de Google de cada hogar,
  con el mismo formato. La app sigue funcionando sin señal y sube lo pendiente
  después. Los scripts que hoy leen y escriben la planilla siguen andando.
- **El riesgo principal.** Hoy el script ordena las escrituras con un candado
  (`LockService`). Sin script no hay candado. La sección 4 dice qué protegía y
  con qué se reemplaza.
- **La condición.** Dos pruebas antes de construir (sección 2). Si la del iPhone
  falla, el plan vuelve a la opción A: una plantilla de planilla con el script
  ya incluido.

## 1. Qué es B y por qué ahora

| | Qué es | Cuándo |
|---|---|---|
| **A** | Una plantilla de planilla que ya trae el script. Sigue habiendo token y publicación, pero sin pegar código | Si B no pasa la prueba del iPhone |
| **B** | La app habla directo con Google Sheets, con «Entrar con Google» | Ahora, para hogares conocidos |
| **C** | Una base alojada (por ejemplo Supabase) | Cuando sea un producto que circula y está estable |

**Por qué B.** Saca el costo que crece con cada hogar (pegar y publicar el
script en cada cuenta) sin que quien publica la app pase a custodiar los datos
de otras familias. C se justifica recién con usuarios desconocidos, con cobro o
con datos que crucen hogares.

**Datos y responsabilidad.** Con B los datos van del navegador a la planilla del
hogar, sin pasar por otro lado. Quien publica la app no recibe ni guarda ningún
movimiento: el proyecto de Google Cloud de la app solo tiene la configuración
del permiso. El punto de confianza que queda es el código: quien publica la app
controla lo que corre en el navegador, igual que hoy. Se declara.

**Lo que este documento no reconstruye.** La comparación de alternativas que
llevó a elegir B no quedó escrita. Este documento parte de la decisión.

## 2. Las dos pruebas (sí / no)

### 2.1 Lo que tiene que existir antes (lo hace el mantenedor, en Google Cloud)

1. Un proyecto de Google Cloud con las APIs de Google Sheets, Google Drive y
   Google Picker habilitadas.
2. La pantalla de consentimiento, tipo *External*, en modo **Testing**, con las
   cuentas de prueba cargadas (hasta 100).
3. Un ID de cliente OAuth de tipo «Aplicación web», con el origen autorizado de
   la app. Para el flujo de página completa, también la dirección de retorno exacta.
4. Una clave de API restringida a la API de Google Picker y a los sitios de la
   app más `https://docs.google.com/*`: el selector se dibuja en un iframe de
   ese dominio.
5. El número del proyecto, que el selector usa como *App ID*. Tiene que ser el
   mismo proyecto que el ID de cliente.

El ID de cliente, la clave de API y el número de proyecto **no son secretos**:
en una app web viajan al navegador. Igual se restringen por origen. No se
escriben en este documento.

### 2.2 Prueba 1 · Google desde el ícono del iPhone

**Por qué un iPhone.** En iOS, la app abierta desde el ícono de la pantalla de
inicio guarda sus datos aparte de Safari. Un login que sale a Google desde el
ícono puede volver en Safari y perderse. Y el permiso de Google dura poco (lo
dice `expires_in`; en los ejemplos de Google, una hora) y en el navegador no
viene con un token de renovación.

Ya existe una página descartable que mide la mitad, fuera de este repo. **Nunca
se publicó ni se corrió.** Tiene que vivir en el mismo origen que la app, porque
ese es el origen que se autoriza. Antes de correrla hay que sumarle los pasos
que faltan:

| Paso | Qué mide | ¿Está en la página? |
|---|---|---|
| A, B, C | Entrar con Google desde el ícono por tres caminos: página completa, ventana propia, librería de Google | sí |
| D | Crear una planilla, escribir una fila y leerla | sí |
| E, F | Renovar sin preguntar pasada una hora, y al reabrir al día siguiente | sí |
| **G** | Abrir con el selector de Google una planilla que **no** creó la app. Es el caso de cualquier hogar ya instalado | **falta** |
| **H** | Una segunda cuenta entra a la misma planilla compartida. Es el caso de un hogar de dos | **falta** |
| **I** | El permiso sobre un archivo dado en un dispositivo ¿vale en otro? Elegir la planilla en la computadora y abrir la app en el ícono | **falta** |
| **J** | Qué dice la pantalla de permiso, palabra por palabra (captura) | **falta** |
| **K** | El nombre de la cuenta (`about.get`, campo `user.displayName`), para la columna «origen» | **falta** (opcional) |

**Por qué G, H e I.** Con `drive.file` la app solo ve lo que creó ella o lo que
la persona eligió con el selector. La documentación de Google no dice si el
selector anda en el navegador de un teléfono, ni si el permiso sobre un archivo
pasa a otro dispositivo de la misma cuenta. Hay que medirlo.

**Controles: la prueba tiene que poder fallar.** Quitarle el acceso a la app
desde la cuenta de Google y repetir E y F: tienen que fallar. Repetir G con una
cuenta a la que no se le compartió la planilla: tiene que fallar.

**También en Android.** El primer hogar de prueba usa Android. Ahí el ícono no
separa el almacenamiento como en iOS, pero el selector y la renovación pasan
igual por el navegador. Se repiten A, D, E, G y H en Chrome para Android.

**Quién y cuánto.** El mantenedor con un iPhone, y un teléfono Android (si se
puede, el de una persona de un hogar real). Dura dos días por E y F al día
siguiente.

### 2.3 Umbrales

| Resultado | Condición | Qué sigue |
|---|---|---|
| **Sí** | Desde el ícono: entrar (A, B o C) vuelve al ícono · D anda · renovar (E o F) no pide contraseña y pide a lo sumo un toque · G y H andan | Se construye B |
| **Sí, con fricción** | Todo lo anterior salvo una de estas dos: la renovación pide un toque en cada apertura pasada la hora; o el selector no anda en el ícono pero sí en Safari o en la computadora, **y** I muestra que el permiso llega al ícono | Se construye B, con la fricción escrita en la guía de instalación |
| **No** | La renovación pide contraseña o elegir cuenta en cada apertura · el login no vuelve al ícono · G o H no andan por ningún camino · el selector no anda en el ícono **y** I muestra que el permiso no llega | Vuelve la opción A. La fase 1 (sección 13) se hace igual |

### 2.4 Prueba 2 · Concurrencia sobre una planilla descartable

**Por qué.** La sección 4 se apoya en cómo se comporta la API de Sheets cuando
escriben varios a la vez. La documentación dice que un `batchUpdate` se aplica
entero o no se aplica, y en orden. De escritores simultáneos solo dice que los
cambios «pueden alterarse respecto de los de otros colaboradores». No se supone:
se mide.

Se corre sobre una planilla de prueba, **nunca la de un hogar**, con dos o tres
escritores a la vez (una cuenta de servicio alcanza: lo que se mide es la API).

| # | Escenario | Tiene que dar |
|---|---|---|
| P1 | Dos escritores mandan 50 `AppendCells` cada uno, al mismo tiempo | 100 filas y 100 uid distintos, ninguna pisada |
| P2 | Lo mismo, más un tercero que agrega con `values.append` como lo hace `cierre.py` (`append_rows` de gspread) | Todas las filas de los tres |
| P3 | Una fila vacía en el medio de la hoja | Anotar dónde cae `AppendCells` y dónde cae `values.append` |
| P4 | Se borra una fila de arriba entre la lectura y el borrado de otra | El procedimiento de 4.4 detecta el corrimiento y repara |
| P5 | La misma fila escrita por la API y por Apps Script | Iguales para `get_all_values()` de gspread (lo que leen los scripts) y para la app |
| P6 | Una descripción que empieza con `=` | Queda como texto |

**Control.** P1 repetida con el patrón que el `.gs` ya prohíbe (leer la última
fila y escribir en la siguiente con `values.update`) tiene que pisar filas. Si
no pisa, la prueba no está generando concurrencia suficiente y no prueba nada.

Si P1 o P2 pierden filas, no se escribe directo: vuelve la opción A.

> **Resultado (27/11/2026).** El control pisó 26 de 100. `AppendCells` perdió
> filas con HTTP 200 en las 5 corridas con dos escritores (8 de 500), y
> `cierre.py` perdió 3 de 120 escribiendo a la vez. Confirmar leyendo la columna
> H (4.3, paso 4) detectó las 3 pérdidas de la corrida que lo midió, pero no la
> fila que `cierre.py` pisó en A–G. Por esta regla corresponde la opción A;
> decisión pendiente.

## 3. El conector: la sincronización en un solo lugar

Hoy la conversación con el servidor está repartida en `index.html`:
`apiPost`, `_drainQueue`, `fetchSync`, `saveConfigToSheet`,
`deleteTxFromSheet`, `updateTxFromSheet` y `_probarConexion`. B la junta detrás
de una sola interfaz, el **conector**, con dos implementaciones. Pasar a C es
escribir una tercera, no reescribir la app.

```js
// Toda la app habla con el destino de los datos SOLO a través de esto.
const conector = {
  tipo,                         // 'appsscript' | 'sheets' | (C) 'supabase'
  clavePlanilla(),              // identidad estable de la planilla → clave del caché de config
  estado(),                     // { listo, necesitaGesto, cuenta, venceA, planilla: { titulo } }
  async conectar({ gesto }),    // pide o renueva el permiso; con gesto:false no abre ventanas
  async leer(),                 // → { movimientos: [...], configs: [...], leidoA }
  async agregar(txs),           // → { status, confirmados: [uid], error }
  async editar(ref, cambios),   // ref = { uid } o { firma } → { status, encontradas: 0 | 1 }
  async borrar(ref),            // → { status, encontradas: 0 | 1 }
  async guardarConfig(tipo, valor),  // 'schema' | 'aliases'
  async diagnostico(),          // líneas para el 🩺
};
```

**Reglas del contrato.** Son las de hoy y no se tocan:

- `status` sigue siendo `ok`, `fatal` o `transient`. `fatal` es solo para un
  dato que el destino rechazó por inválido. Todo lo de permisos, red, cuota o
  «no encuentro la planilla» es `transient`. Es lo aprendido con el token: un
  rechazo por configuración tratado como fatal tiró a la basura movimientos válidos.
- `agregar` confirma **por uid**: devuelve qué uid quedaron escritos o ya
  estaban. Un `ok` que no trae el uid propio no saca nada de la cola.
- Un movimiento es `{d, t, c, s, a, desc, p, u, o}` (fecha, tipo, categoría,
  subcategoría, monto, descripción, forma de pago, uid, origen): lo mismo que
  devuelve hoy `getRawData()`.
- `leer` separa las filas `__CONFIG__` de los movimientos. Decidir qué config
  gana sigue fuera del conector (`extractConfig`), porque es una regla de la app
  y no del destino.

**Lo que queda fuera del conector, sin cambios.** La cola (`FINANZAS_PENDING`)
y sus reintentos, el buffer optimista, el dead-letter y «Bajar pendientes», el
candado entre pestañas (`navigator.locks`), el caché de movimientos y la UI.
**Un solo cambio en el drenado:** puede mandar varios ítems de la cola en una
llamada, por la cuota de Google (4.5).

**Las implementaciones.**

- `conectorAppsScript`: lo de hoy, movido sin cambiar la conducta. Sirve para la
  convivencia durante la migración y para volver atrás.
- `conectorSheets`: B.
- Para C, `conectorSupabase`. Ahí el uid pasa a ser una restricción única de la
  tabla y la idempotencia la garantiza la base, que es la versión más fuerte.
  Los scripts de `server/` se reescriben recién en C.

**Cuál está activo.** Lo dice una clave, `FINANZAS_CONECTOR` (`appsscript` o
`sheets`). Si no está y hay `FINANZAS_API_URL`, es `appsscript`: las
instalaciones de hoy no cambian solas. Si no hay ninguna de las dos, es la demo,
como hoy.

## 4. Idempotencia y concurrencia sin servidor

### 4.1 Qué hacía el candado del script

| Pieza del `.gs` | Contra qué protegía |
|---|---|
| `LockService` + `flush()` | Dos escrituras con el mismo uid que pasan las dos, porque la segunda leyó el índice antes de que la primera terminara |
| Índice de uid (columna H) antes de escribir | El reintento de un envío cuya respuesta se perdió |
| `appendRow`, y no `setValues` en la última fila + 1 | Que una escritura simultánea de `cierre.py`, que no respeta el candado, quede pisada |
| Validar todo el lote antes de escribir | Media extracción escrita (una fila de las dos) |
| Editar y borrar dentro del candado, buscando por uid | Tocar una fila distinta de la que se vio |

El candado nunca cubrió a los scripts de Python ni a una persona editando la
planilla. Ya hoy la garantía de fondo es el uid, no el candado: lo dice el
propio `.gs` («idempotencia > atomicidad»).

### 4.2 Las amenazas, una por una

Hay un dato que ordena todo: **el uid lo genera cada dispositivo** (`tx_` + la
hora + seis caracteres al azar). Dos teléfonos no mandan nunca el mismo uid. Un
uid repetido solo puede venir del mismo dispositivo.

| # | Amenaza | Qué pasa sin candado | Cómo se cubre en B |
|---|---|---|---|
| T1 | El teléfono reintenta un envío que sí se escribió (se perdió la respuesta, se cortó la señal) | Si el reintento mira la columna H antes de que la primera escritura aterrice, escribe de nuevo | Mirar antes de agregar, esperar entre intentos y confirmar leyendo (4.3); deduplicar al leer |
| T2 | Dos pestañas del mismo navegador drenan la cola | El mismo uid, dos veces | `navigator.locks`, como hoy |
| T3 | Dos teléfonos agregan a la vez | Son uid distintos: no hay duplicado. El riesgo es que una fila pise a la otra | `AppendCells` resuelve dónde escribir en el servidor de Google, en un pedido atómico. Se mide en la prueba 2 (P1, P2) |
| T4 | Editar o borrar después de que algo corrió las filas: otro borrado, alguien que ordena la planilla, un script de limpieza | La API direcciona por posición: se edita o se borra **otro** movimiento, sin error | Foto, verificación y reparación (4.4) |
| T5 | Escritores externos al mismo tiempo (`cierre.py`, los scripts de `server/`) | Como T3 y T4 | Como T3 y T4. Los scripts que tocan filas por posición siguen corriendo con los teléfonos quietos, como hoy |

### 4.3 Agregar

1. **Validar** todo el lote antes de escribir nada: tipo, monto hasta
   999.999.999, descripción hasta 500 caracteres (40.000 para una config). Un
   dato inválido es `fatal`, como hoy.
2. **Mirar antes:** leer la columna H (`Movimientos!H:H`, una sola columna) y
   sacar del lote los uid que ya están. Cuentan como confirmados.
3. **Escribir** lo que queda con **un** `batchUpdate` que lleva un
   `AppendCellsRequest` con todas las filas. Google lo describe así: agrega las
   celdas después de la última fila con datos e inserta filas si hace falta.
   Cada celda va con su tipo (sección 5).
4. **Confirmar leyendo:** volver a leer la columna H y confirmar cada uid. Lo
   que no aparece queda en la cola como `transient`.
5. **Esperar antes de reintentar.** Después de un corte por tiempo, el primer
   reintento espera al menos 15 s y vuelve a mirar la columna H antes de
   escribir. Cancelar un pedido del lado del navegador no cancela la escritura
   en Google: puede aterrizar después.

**Deduplicar al leer.** Si dos filas tienen el mismo uid, la app cuenta la
primera (la de más arriba) y no muestra la otra. Es la regla que ya usa
`dedupe_movimientos.py`: se conserva la primera ocurrencia. El 🩺 dice cuántos
uid repetidos hay.

**Limpiar.** La copia sobrante la borra solo el dispositivo que escribió ese
uid, con el procedimiento de 4.4. Lo sabe porque guarda los uid que confirmó en
los últimos 30 días. Ningún otro dispositivo la toca, así no hay dos limpiando
lo mismo. Si la prueba 2 y el piloto no muestran ningún uid repetido, la
limpieza automática se posterga y alcanza con el aviso del 🩺 (decisión D10).

### 4.4 Editar y borrar: foto, verificación y reparación

La API de Sheets no tiene «escribí acá solo si esta fila sigue siendo X». Por eso:

1. **Foto.** Leer la hoja entera (S0). Con unas 600 filas por año es un pedido
   chico: un año real midió 54 KB.
2. **Ubicar.** Por uid. Si la fila es vieja y no tiene uid, por firma
   `{d, t, c, s, a, desc}` de abajo hacia arriba, como hoy.
3. **Escribir.** Un `batchUpdate` con el cambio: borrar es `DeleteDimension` de
   esa fila; editar es `UpdateCells` sobre esa fila, solo de A a G.
4. **Verificar.** Volver a leer (S1). El borrado está bien si S1 es S0 sin esa
   fila. La edición está bien si la fila de ese uid tiene los cambios y todas
   las demás quedaron iguales.
5. **Reparar.** Si no, se tocó otra fila. Con S0 se repone lo que se tocó por
   error (se vuelve a agregar la fila borrada, con su uid, o se restauran las
   celdas pisadas) y se reintenta desde el paso 1. Queda registrado para el 🩺.

Cubre a una persona que ordena la planilla, a otro teléfono que borra y a los
scripts. No cubre dos reparaciones que se crucen exactamente al mismo tiempo: se
declara, y la prueba 2 (P4) mide si pasa.

Editar y borrar siguen sin funcionar sin conexión, como hoy (no se encolan). Con
el permiso vencido, piden reconectar antes.

### 4.5 La cuota de Google

La API de Sheets permite 60 lecturas y 60 escrituras por minuto por usuario, y
300 por minuto por proyecto (sumando a todos los usuarios de la app). Pasado el
límite contesta 429. Agregar cuesta tres pedidos: mirar, escribir y confirmar.
Una cola de 30 movimientos mandados de a uno serían 90 pedidos, y pasaría el
límite. Por eso el drenado manda la cola en lotes de hasta 50 filas (el mismo
tope que tiene el `.gs`). Un 429 es `transient`, con espera.

### 4.6 Lo que queda sin garantía (declarado)

- Un uid repetido puede quedar un rato en la planilla (T1, en el peor caso). La
  app no lo cuenta dos veces. Un script que lee la planilla cruda sí lo cuenta,
  hasta que se limpie.
- Dos reparaciones simultáneas sobre filas vecinas.
- Que Google cambie cómo resuelve `AppendCells`. La prueba 2 queda en el repo
  para volver a correrla.

## 5. El contrato con la planilla

Es el mismo de hoy, en las columnas A a I:

```
A Fecha | B Tipo | C Categoría | D Subcategoría | E Monto | F Descripción | G Forma de pago | H uid | I origen
```

La I (origen) ya la escribe el backend actual. El resumen de `CLAUDE.md` todavía
dice A–H: hay que corregirlo.

- **La pestaña se busca por nombre**, `Movimientos`, con la primera pestaña como
  respaldo, igual que `getSheet()`. La app nunca la renombra ni reordena
  pestañas. La pestaña `Auditoría` no se lee.
- **La fila 1 no se lee ni se escribe.** En una planilla que crea la app lleva
  los títulos. En una adoptada puede tener un movimiento viejo, que sigue
  invisible, como hoy.
- **Cada celda con su tipo** (con `AppendCells` y `UpdateCells`):

  | Columna | Se escribe como | Por qué |
  |---|---|---|
  | A | número de serie de fecha, con formato de fecha | Con `RAW` quedaría como texto, y las filas de Apps Script y de `cierre.py` son fechas |
  | B, C, D, F, G, H, I | texto (`stringValue`) | No se interpreta nunca: con `USER_ENTERED`, una descripción que empieza con `=` se volvería fórmula |
  | E | número (`numberValue`) | |

- **Normalizar al leer.** Se lee con valores sin formato y las fechas como
  número de serie, y la app las pasa a `yyyy-MM-dd`. Las fechas que hayan
  quedado como texto se tratan como hoy las trata `formatDate_`.
- **`__CONFIG__`**, igual que hoy: el esquema o los alias en base64 dentro de la
  descripción, hasta 40.000 caracteres (una celda de Sheets admite 50.000). Gana
  la última por fecha y, a igual fecha, la de más abajo.
- **Columna I.** Hoy lleva el nombre del dispositivo, que se cambia en ⚙️. Con B
  se le puede sumar el nombre corto de la cuenta, nunca el mail. `about.get`
  acepta `drive.file` y devuelve el nombre (se confirma en la prueba 1, paso K).
  Decisión D6.

## 6. El permiso de Google

### 6.1 Qué ve la persona

La primera vez:

1. En la app, el botón **«Entrar con Google»** y debajo una línea: *«La app solo
   ve la planilla que uses con ella. Tus datos quedan en tu Google Drive.»*
2. Google: elegir la cuenta.
3. La pantalla de permiso de Google. Muestra el nombre y el logo de la app (si
   tiene verificación de marca), el mail de soporte, los links a la política de
   privacidad y a las condiciones, y el permiso: *«See, edit, create, and delete
   only the specific Google Drive files you use with this app»*. La versión en
   castellano se copia de la pantalla real en la prueba 1 (paso J).
4. De vuelta en la app: **«Crear mi planilla»** o **«Ya tengo una planilla»**,
   que abre el selector de Google.

Después no hay nada que hacer mientras el permiso esté vigente.

### 6.2 El alcance: solo `drive.file`

- Google lo clasifica como **no sensible** y lo recomienda, porque da acceso
  archivo por archivo. Con él la app puede crear la planilla
  (`spreadsheets.create`) y leerla y escribirla con la API de Sheets.
- No se pide `spreadsheets` (permiso sensible: todas las planillas de la cuenta)
  ni `drive`.
- El selector se usa con `drive.file` y el *App ID* del mismo proyecto. Elegir
  un archivo con el selector es lo que le da a la app acceso a ese archivo.

### 6.3 Modo de prueba y producción

| | Testing | Producción |
|---|---|---|
| Quién puede entrar | Hasta 100 cuentas, cargadas a mano | Cualquiera |
| Vencimiento | La autorización vence a los 7 días del consentimiento | No vence por el modo |
| Aviso «Google no verificó esta app» | A medir en la prueba 1 (J) | Según Google, aparece con permisos sensibles o restringidos, no con uno no sensible |
| Trámite | Ninguno | Verificación de marca para mostrar nombre y logo: una página de inicio pública y una política de privacidad en el mismo dominio, enlazada en la pantalla. Revisión automática en minutos o manual en 2 a 3 días hábiles |

**Propuesta.** La prueba 1 y el piloto en Testing. Producción, con verificación
de marca, antes de pasarle la app a hogares que el mantenedor no conoce (D2).
**A medir en el piloto:** Google dice que en Testing vencen los tokens de
renovación; no aclara si con permisos de una hora el vencimiento de 7 días
obliga a pasar otra vez por la pantalla de permiso.

### 6.4 La renovación cada hora

El permiso es un token de acceso de vida corta. En el navegador no hay token de
renovación: para seguir hay que pedir otro, y Google indica pedirlo desde un
gesto de la persona (un toque). Así lo usa la app:

1. **Al abrir.** Si el permiso sigue vigente, se usa. Si no, la app muestra lo
   que tiene en caché y una pastilla **«Conectar con Google»** arriba. No se
   bloquea nada: se puede cargar igual.
2. **Cada toque que guarda un movimiento es un gesto.** Si al permiso le quedan
   menos de 5 minutos, se renueva en ese toque, sin pantalla cuando Google lo
   permite (`prompt: ''`).
3. **Si un pedido vuelve 401 a mitad de la cola:** es `transient`, la cola queda
   intacta y aparece la pastilla. **Nunca** va al dead-letter por un permiso vencido.
4. **Si la renovación pide elegir cuenta o contraseña,** es el resultado «No» de
   la prueba 1 (2.3).

Qué ve la persona cuando el permiso venció: la app funciona, el botón de
sincronizar muestra ⏳ con la cantidad pendiente y aparece la pastilla. Al
tocarla, sube todo.

### 6.5 Dónde vive el permiso

- **No en `localStorage`.** Todos los sitios de GitHub Pages de una misma cuenta
  comparten origen, así que cualquier página publicada bajo ese origen accede al
  mismo almacenamiento. El permiso vive en memoria. Si la prueba 1 muestra que
  así hace falta un toque en cada recarga, en `sessionStorage` (D3).
- **Ningún script de terceros sin versión fija y sin `integrity`,** o copiado al
  repo: todo lo que corre en la página puede leer el permiso.
- **Opcional:** un dominio propio para la app aísla el origen (D4).

### 6.6 Lo que Google no garantiza

La página de Google sobre el flujo implícito lo desaconseja para aplicaciones de
una sola página y recomienda el flujo con código y PKCE. Para un cliente web de
Google, ese flujo necesita un servidor que guarde un secreto: justo lo que B
quiere evitar. B usa el modelo de tokens de Google Identity Services, que es el
que Google documenta para pedir permisos desde el navegador. Si Google lo
restringe, B se cae. Por eso el conector aislado, y por eso existe el camino C.

## 7. Qué desaparece y qué lo reemplaza

| Hoy | Con B |
|---|---|
| Un script pegado en cada planilla, `instalar()` y la publicación como aplicación web | Nada: la app crea la planilla o adopta una que ya existe |
| El token: en las Propiedades del script y cargado a mano en cada dispositivo | La cuenta de Google de cada persona. El permiso es por archivo |
| El QR y el link con `?api=&token=` | Compartir la planilla desde Google y que la otra persona entre con Google (8.2) |
| ⚙️ «Cambiar URL» | ⚙️ «Planilla: *título* · Abrir en Google · Cambiar de planilla · Cerrar sesión» |
| `?action=ping`, para saber qué backend está publicado | No hace falta: no hay backend. `APP_VERSION` sigue |
| 🩺: lectura, escritura de una fila de prueba, idempotencia, control sin token, forma de la URL | 🩺: la sesión (cuenta en versión corta, hasta qué hora vale el permiso), la planilla (título, filas, si encontró `Movimientos`), los pendientes (igual que hoy), los uid repetidos y las reparaciones (nuevos). **No escribe filas de prueba en la planilla.** La idempotencia la prueban los tests, no el teléfono. Misma regla de hoy: no copia categorías ni descripciones |
| «Falla cerrado»: sin token configurado, el script rechaza todo | Lo da Google: sin permiso sobre el archivo, la API contesta 401, 403 o 404. Queda el principio: se trata como `transient` y se avisa, nunca se descarta un movimiento |
| `ONBOARDING.md`, parte 1: unos 15 minutos en una computadora | Se reescribe: abrir el link y entrar con Google |
| `server/apps_script.gs`, `server/DEPLOY.md`, `auth-test.js`, `backend-test.js` | Se quedan mientras algún dispositivo use Apps Script (para volver atrás). Se retiran después, en un commit propio (9.4) |
| `STORAGE_ID`, `DEVICE_NAME` (columna I), `APP_VERSION`, la cola, el dead-letter, «Bajar pendientes» | Siguen igual |

## 8. Instalación nueva y sumar a alguien de la casa

### 8.1 Un hogar nuevo

1. Abre el link y ve la demo, como hoy.
2. Toca «Empezar con mi planilla» y entra con Google (6.1).
3. Toca «Crear mi planilla». La app crea en su Drive una planilla «Finanzas»
   con la pestaña `Movimientos`, los títulos en la fila 1 (inmovilizada) y los
   formatos de A y E. Arranca con el esquema genérico del hogar (`SCHEMA_HOGAR`)
   y guarda su primera config.
4. La primera pantalla es el panel vacío. Tiene que entenderse con 0 movimientos.
5. *(Si entra, decisión D5)* «Pegá tu lista», para cargar las categorías propias
   de una vez.
6. Agregar a la pantalla de inicio y ponerle nombre al dispositivo (columna I).

### 8.2 Sumar a alguien de la casa

1. Quien creó la planilla la comparte desde Google con la otra cuenta, como
   editora. ⚙️ tiene un botón que abre la planilla.
2. La otra persona abre el link, entra con Google y toca «Ya tengo una
   planilla». El selector muestra lo compartido con ella.
3. Si la prueba 1 muestra que el selector no anda en el ícono, ese paso se hace
   una vez en la computadora o en Safari, y el permiso queda para la cuenta
   (si lo confirma el paso I).

### 8.3 Qué cambia en seguridad

Hoy la llave es el token, y el QR la lleva entera. Con B la llave es la cuenta
de Google de cada persona, más la lista de con quién está compartida la
planilla. Si alguien publica la planilla con «cualquier persona con el enlace
puede editar», eso abre la planilla, no la app. El 🩺 puede avisarlo (D9).

## 9. Migración

### 9.1 Convivencia

Durante la migración la app trae los dos conectores. Cada dispositivo cambia
cuando su persona toca «Pasar a Entrar con Google» en ⚙️. Nada cambia solo.

### 9.2 Un hogar que ya usa Apps Script

En cada dispositivo:

1. **Drenar.** Si hay pendientes, la app intenta subirlos primero por Apps
   Script. Si no puede (sin señal, error de lectura), siguen en la cola y suben
   después por B. Tienen uid: no se duplican.
2. **Entrar con Google y elegir la planilla** con el selector.
3. **Verificar que es la misma planilla.** La huella: los uid del caché local
   de movimientos tienen que estar en la planilla elegida. Si el caché está
   vacío, se compara contra una lectura por Apps Script. Si tampoco se puede, se
   muestran el título y la cantidad de filas, y se pide confirmación. Si la
   huella no coincide, no se migra y se dice por qué. Es la misma familia de
   error que cerró la v7.8: la config de una planilla subida a otra.
4. **Mover la config**, solo con la huella verificada:
   `FINANZAS_CFG::<url del script>` pasa a `FINANZAS_CFG::sheets:<id de la planilla>`.
5. **Activar:** `FINANZAS_CONECTOR = 'sheets'`. La URL y el token viejos quedan
   guardados e inactivos mientras dure la convivencia, para poder volver.
6. **El link viejo del ícono.** En iOS, el acceso directo guarda la dirección
   con `?api=&token=` y la vuelve a aplicar en cada apertura (está anotado en
   `handleApiFromUrl`). Con el conector en `sheets`, la app ignora esos
   parámetros: no pueden devolver el dispositivo a Apps Script.

El script del hogar sigue publicado durante la convivencia. No hay que tocarlo.

### 9.3 Volver atrás

En ⚙️, «Volver a Apps Script» en ese dispositivo: el conector vuelve a
`appsscript` con la URL y el token guardados. La cola es la misma.

### 9.4 Retirar Apps Script

Cuando todos los dispositivos de un hogar pasaron y anduvieron un tiempo
(propuesta: 4 semanas, D8), quien es dueño de la planilla archiva la
implementación del script, y una versión de la app borra la URL y el token
viejos. `apps_script.gs`, `auth-test.js` y `backend-test.js` se retiran del
repo cuando ya no los use ningún hogar, en un commit propio.

### 9.5 La instancia familiar

Pasa por los mismos pasos, con dos cosas más: la planilla tiene otros
escritores (sección 10), y primero migra un solo teléfono durante una semana.
Los pasos concretos no van en este repo.

## 10. Lo que sigue andando sin cambios

| Quién | Qué hace con la planilla | Con B |
|---|---|---|
| `cierre.py --cargar-finanzas` (skill `/cierremdp`) | Agrega filas de 7 columnas con `append_rows` (`USER_ENTERED`), con una cuenta de servicio | Igual: no depende de Apps Script |
| `/auditarfinanzas` (`auditar.py`) | Lee `Movimientos` con `get_all_values()`. Solo lectura | Igual, siempre que B escriba las fechas como fechas (P5) |
| `server/publicar_auditoria.py` | Escribe solo en la pestaña `Auditoría` | Igual: la app no la lee |
| `server/importar_pendientes.py` | Agrega con el uid original | Igual |
| `server/dedupe_movimientos.py`, `server/aplicar_schema.py` | Borran o editan filas **por posición** | Igual y con la misma regla: con los teléfonos quietos y con respaldo. Si un teléfono edita mientras corren, la reparación de 4.4 lo detecta |

**Condiciones para que siga así:** la planilla sigue compartida con la cuenta de
servicio; la pestaña se sigue llamando `Movimientos`; nadie escribe en la fila
1; B escribe con los mismos tipos (P5); la app nunca borra columnas ni inserta
columnas antes de la I (una columna futura va a la derecha). Estos scripts son
de la instancia familiar: un hogar nuevo no los tiene.

## 11. Criterios de aceptación

Cada criterio tiene un control: una versión que se sabe mala y que el criterio
tiene que hacer fallar. Si no la hace fallar, el criterio no prueba nada.

| # | Criterio | Cómo se mide | Control que tiene que fallar |
|---|---|---|---|
| CA1 | Ningún movimiento se pierde | `concurrencia-test`: cola de N movimientos contra el simulador con cortes, 401, 429 y respuestas perdidas → la planilla termina con los N uid | 401 tratado como `fatal`: termina con movimientos en el dead-letter |
| CA2 | Ningún uid queda dos veces | El mismo test, con «se escribió pero se perdió la respuesta» | Sin el paso 2 de 4.3 (mirar antes): aparece el duplicado |
| CA3 | Editar o borrar toca la fila correcta aunque otra fila se haya corrido en el medio | `concurrencia-test` con un borrado inyectado entre la foto y la escritura | Edición por posición sin verificar: toca otra fila |
| CA4 | La reparación devuelve la planilla a lo que tenía que quedar | El mismo caso: después de reparar, S1 es S0 más el cambio pedido | Sin el paso 5 de 4.4: queda una fila perdida |
| CA5 | Un permiso vencido no bloquea la carga ni pierde nada | `sesion-test`: vence a mitad de la cola → la cola sigue, aparece la pastilla, al reconectar sube todo | Igual que CA1 |
| CA6 | Lo que escribe B es igual a lo que escribe Apps Script para los scripts y para la app | Prueba 2, P5 y P6, sobre una planilla real descartable | Escribir con `RAW`: la fecha queda como texto. Con `USER_ENTERED`: `=1+2` se vuelve fórmula |
| CA7 | La fila 1 no se lee ni se escribe | `sheets-test` con un movimiento en la fila 1 | Leer desde A1: aparece |
| CA8 | La migración no se hace sobre la planilla equivocada | `migracion-test`: elegir otra planilla → se niega y no mueve la config | Migración sin huella: la acepta |
| CA9 | El link viejo del ícono no devuelve el dispositivo a Apps Script | `migracion-test`: abrir con `?api=&token=` con el conector en `sheets` | El `handleApiFromUrl` de hoy: lo reescribe |
| CA10 | Dos planillas en el mismo navegador no mezclan categorías | `hogar-test`, con las claves por id de planilla | Caché único de config (la v7.7): se mezclan |
| CA11 | La app pide solo `drive.file` | Un test que busca los alcances en el código, más la captura de J | Agregar `spreadsheets`: el test falla |
| CA12 | Sin conexión y sin sesión se puede cargar, y al volver sube | `sesion-test` | — (es la conducta de hoy: tiene que seguir) |
| CA13 | Mientras haya Apps Script, nada de lo de hoy se rompe | Las 8 suites de hoy, verdes, con el conector `appsscript` | — (es la línea de base: la v7.8 de hoy las pasa) |
| CA14 | Las pantallas nuevas no rompen el layout | `layout-harness` con login, selector, pastilla y ⚙️ nuevo: 0 fallas | Un monto de 9 dígitos con la pastilla visible (el caso de estrés de hoy) |
| CA15 | El 🩺 de B no escribe en la planilla | `diag-test` del conector `sheets`: 0 pedidos de escritura | El 🩺 de hoy: escribe una fila |

## 12. Tests

**Las 8 suites de hoy:**

| Suite | Con B |
|---|---|
| `sync-test.js` | Se queda para el conector `appsscript`. Sus casos se pasan al contrato del conector y se corren contra los dos |
| `auth-test.js`, `backend-test.js` | Sin cambios mientras viva el `.gs`. Se retiran con él |
| `diag-test.js` | El modo Apps Script queda igual. Se suman los casos del 🩺 de B |
| `hogar-test.js` | Las claves de config pasan a ser por id de planilla. Se suman los casos de migración de config |
| `layout-harness.js` | Se suman las pantallas nuevas a la matriz de 7 viewports |
| `smoke-test.js` | Se suma el recorrido de B con Google y Sheets simulados |
| `torta-test.js` | Sin cambios: no toca la sincronización |

**Nuevas:**

- `tools/sheets-sim.js`: una API de Sheets simulada (lectura de rangos,
  `batchUpdate` con `AppendCells`, `UpdateCells` y `DeleteDimension`, creación
  de planilla) que puede inyectar 401, 429, demoras, respuestas perdidas y
  escritores externos. Es el equivalente de la hoja simulada de `backend-test.js`.
- `tools/sheets-test.js`: el conector `sheets` contra el simulador: mirar antes,
  confirmar leyendo, tipos de celda, fila 1, largo de la config, editar y borrar
  por uid y por firma.
- `tools/concurrencia-test.js`: intercalados de dos clientes y un escritor
  externo, respuestas perdidas, filas corridas en medio de una edición. Mide los
  invariantes: no se pierde nada, no se duplica nada, se toca la fila correcta.
- `tools/sesion-test.js`: permiso vencido, 401 a mitad de la cola, renovación
  que pide gesto, sin conexión.
- `tools/migracion-test.js`: huella, movimiento de la config, cola que pasa de un
  conector al otro sin duplicar, link viejo ignorado, vuelta atrás.

**El simulador se calibra con la prueba 2, no al revés.** Lo que P1 a P6 midan
sobre la planilla real es lo que el simulador tiene que reproducir. Si Google se
comporta distinto de lo que supone el simulador, gana lo medido y se corrige el
simulador.

Como hoy: correr todas antes de tocar el conector, la sesión, la migración o el
CSS de layout. Cada suite nueva documenta cuántos casos pasa contra su control.

## 13. Fases y estimado

| Fase | Qué | Quién | Horas |
|---|---|---|---|
| 0a | Google Cloud (2.1) | mantenedor, con guía | 0,5–1 |
| 0b | Prueba 1: sumarle G a K a la página, publicarla y correrla dos días | sesión + mantenedor + un hogar con iPhone | 2–3, más ~1 h de teléfono |
| 0c | Prueba 2: el script de concurrencia sobre una planilla descartable | sesión | 1,5–2 |
| — | **Decisión: sí, sí con fricción, o no** | dueño | — |
| 1 | Sacar el conector con Apps Script adentro, sin cambiar la conducta; las 8 suites verdes | sesión | 4–6 |
| 2 | `conectorSheets`, el simulador, `sheets-test` y `concurrencia-test` | sesión | 6–9 |
| 3 | La sesión de Google: entrar, renovar, la pastilla, el 401, el selector; `sesion-test` | sesión | 4–6 |
| 4 | Instalación nueva, ⚙️ y 🩺 nuevos, página de privacidad, `ONBOARDING.md` | sesión | 4–6 |
| 5 | Migración, `migracion-test` y un teléfono de la familia durante una semana | sesión + dueño | 3–5 |
| 6 | Recorrido con una cuenta nueva y un iPhone real | dueño + sesión | 1,5 |

- **Construcción (fases 1 a 6): 22,5 a 33,5 h.** Coincide con el estimado
  anterior de 22 a 32 h, que no tenía desglose.
- **Pruebas previas (fase 0): 4 a 6 h**, que el estimado anterior no contaba.
- **«Pegá tu lista», si entra: 2 a 3 h más.**
- **La fase 1 sirve aunque B no pase:** la opción A y el camino C arrancan del
  mismo conector.

## 14. Riesgos, lo que no entra y decisiones abiertas

### Riesgos

| Riesgo | Señal temprana | Qué se hace |
|---|---|---|
| En el ícono, la renovación pide contraseña o el login no vuelve | Prueba 1, E/F y A/B/C | Opción A |
| El selector no anda en el ícono | Prueba 1, G | Elegir una vez en la computadora, si I confirma que el permiso viaja. Si no, opción A para adoptar planillas existentes |
| Escribir a la vez pierde filas | Prueba 2, P1 y P2 | Opción A |
| Google restringe el modelo de tokens en el navegador | Avisos en la documentación de Google Identity | El conector aislado: C |
| En Testing hay que volver a dar permiso cada 7 días | Piloto | Pasar a producción con verificación de marca |
| Otro sitio del mismo origen o un script de terceros lee el permiso | Revisión del código | Permiso en memoria, `integrity` y versión fija, dominio propio (6.5) |
| Alguien ordena la planilla | Reparaciones en el 🩺 | 4.4; una nota en la fila 1 de las planillas nuevas |
| La migración elige la planilla de otro hogar | `migracion-test` | La huella (9.2) |
| La cuota del proyecto (300 por minuto, sumando todos los hogares) | 429 en el 🩺 | Lotes (4.5); si crece, pedir más cuota a Google |
| Dos conectores conviviendo suman complejidad | Bugs del conector viejo | Convivencia con fecha de retiro (9.4) |

### Lo que no entra en B

- **La fase B de módulos:** elegir módulos al empezar, nombre del negocio configurable.
- **El modelo contable:** provisiones, separar fecha de operación y fecha de
  pago, cuotas de la tarjeta. Recién con C, mientras la base sea Sheets.
- **La columna «ámbito»** (hogar o negocio por movimiento). Si se suma, va a la
  derecha de la I y es una decisión aparte.
- **«Quién pagó y cuánto se deben»** entre las personas de un hogar.
- **Abrir la app sin señal** (service worker). Lo que funciona sin señal sigue
  siendo la cola.
- **Formas de pago configurables.**
- **Encolar ediciones y borrados sin conexión.**
- **Retirar Apps Script:** va después, en su propio commit (9.4).

### Decisiones abiertas

| # | Decisión | Cuándo |
|---|---|---|
| D1 | Qué cuenta de Google es dueña del proyecto de Cloud y qué mail de soporte ve la gente en la pantalla de permiso | Antes de la fase 0a |
| D2 | Cuándo pasar de Testing a producción con verificación de marca | Antes de hogares que el mantenedor no conoce |
| D3 | Dónde vive el permiso: memoria o `sessionStorage` | Después de la prueba 1 |
| D4 | ¿Dominio propio para la app? | Antes de producción |
| D5 | ¿«Pegá tu lista» entra en B? | Antes de la fase 4 |
| D6 | Columna I: nombre del dispositivo (hoy) o nombre corto de la cuenta | Antes de la fase 3 |
| D7 | Al editar una fila vieja sin uid, ¿se le asigna uno? Así la próxima edición es exacta | Antes de la fase 2 |
| D8 | Cuántas semanas de convivencia antes de retirar Apps Script (propuesta: 4) | Antes de la fase 5 |
| D9 | ¿El 🩺 avisa si la planilla está compartida por enlace? | Antes de la fase 4 |
| D10 | Limpieza automática de uid repetidos o solo aviso | Después de la prueba 2 y del piloto |

## Fuentes (documentación de Google, consultada el 27/11/2026)

- Alcances de Drive y `drive.file`: <https://developers.google.com/workspace/drive/api/guides/api-specific-auth>
- Alcances de la API de Sheets: <https://developers.google.com/workspace/sheets/api/scopes>
- `AppendCellsRequest`, `DeleteDimensionRequest`: <https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request>
- `batchUpdate` (atómico, en orden, cambios de otros colaboradores): <https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate>
- `values.append`, `RAW` y `USER_ENTERED`: <https://developers.google.com/workspace/sheets/api/guides/values>
- Límites de uso de Sheets: <https://developers.google.com/workspace/sheets/api/limits>
- Selector de Google en apps web: <https://developers.google.com/workspace/drive/picker/guides/web-picker>
- `about.get`: <https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get>
- Modelo de tokens de Google Identity Services: <https://developers.google.com/identity/oauth2/web/guides/use-token-model>
- Flujo implícito: <https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow>
- Audiencia, modo Testing y 7 días: <https://support.google.com/cloud/answer/15549945>
- Apps no verificadas: <https://support.google.com/cloud/answer/7454865>
- Verificación de marca: <https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification>
