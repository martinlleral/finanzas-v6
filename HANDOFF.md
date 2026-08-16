# Handoff — finanzas-v6 · estado al 2026-08-16

> **Para retomar en sesión nueva.** Leer esto primero; el `CLAUDE.md` del repo
> tiene el detalle técnico y las convenciones que no hay que romper.

---

## 🔴 Lo único abierto: el celular de Lau vuelve a perder el token

### Qué sabemos con certeza

1. **La causa raíz está identificada y confirmada:** el token guardado en ese
   teléfono era **la URL del servidor** (114 caracteres, coincidencia exacta
   con la URL del Apps Script). Con eso, todo responde `Unauthorized`.
2. **El teléfono SÍ escribe cuando el token está bien.** Al 16/8 hay 7 filas
   con `origen = Lau` en el sheet, incluida una carga real
   (`Trama/Redes $100.000`) y dos pruebas de 🩺 Probar conexión.
3. **El síntoma es la RECURRENCIA**, no la falla: se arregla, funciona, y en
   algún momento vuelve a romperse.

### La hipótesis vigente (parcialmente verificada)

El acceso directo de la pantalla de inicio guarda la URL **con los parámetros
`?api=…&token=…`**. `history.replaceState` limpia la barra de direcciones de la
sesión, pero **no toca el acceso directo**: cada apertura desde el ícono vuelve
a ejecutar el onboarding con lo que traiga ese link.

Verificado que el código hace `replaceState`; **no verificado** que el ícono de
Lau efectivamente conserve los parámetros. **Ese es el primer chequeo de la
sesión nueva.**

### Qué se hizo (tres capas, porque una sola no alcanza)

| Capa | Versión | Qué hace |
|---|---|---|
| **Prevenir** en el onboarding | v7.4 | El link no puede aplicar un token con forma de URL |
| **Prevenir** al configurar a mano | v7.3 | `configureApi()` rechaza pegar la URL en el campo del token |
| **Reparar** al arrancar | v7.5 | Si el token guardado tiene forma de URL, se descarta y se avisa |
| **Ver cuál de los dos** | **v7.6** | `almacenamiento: #id` + contexto ícono/Safari + edad de la cola + rescate por portapapeles |

La v7.5 es la que faltaba: prevenir no arregla lo que **ya quedó guardado**.
Antes, un teléfono decía "token configurado: sí" y fallaba todo — mucho más
difícil de diagnosticar que uno que dice que le falta.

### 16/8 · La hipótesis del link quedó descartada. Son DOS almacenamientos

Dos diagnósticos del mismo teléfono, con diez minutos de diferencia:

| | 15:06 (recién sincronizado por QR) | 15:16 (al reabrir) |
|---|---|---|
| token | sí (36 chars) | **NO** |
| servidor | sí | sí |
| **pendientes** | **0** | **23** (22 en cola, 1 con error) |

**Una cola de pendientes solo crece cuando alguien carga un movimiento.** Nadie
cargó 23 en diez minutos, y en el primero estaba vacía. Una cola no puede pasar
de 0 a 23 sola: **no es la misma cola**.

En iOS, la app abierta desde el **ícono de la pantalla de inicio** y la misma
app abierta en **Safari** tienen `localStorage` separados. El QR se escanea con
la cámara → abre **Safari** → ahí quedó el token bueno y una cola limpia. Al
"abrirla de vuelta" se toca el **ícono** → otro contenedor, con la config vieja
y todas las cargas acumuladas sin subir.

Encaja el resto: en el ícono el servidor sigue configurado (nunca se perdió) y
el token dice `NO` porque **v7.5 hizo su trabajo** — encontró ahí el token con
forma de URL y lo descartó. Sin v7.5 ese teléfono diría "token: sí (114 chars)"
y fallaría igual, que es el caso difícil de ver.

Explica la recurrencia entera: cada arreglo entraba en el contenedor que no era.

### 🔴 NO borrar el ícono para "volver a agregarlo limpio"

Era el paso 3 de este handoff y **destruye los 23 movimientos**: en iOS,
eliminar la web app de la pantalla de inicio borra sus datos. Primero rescatar,
después arreglar. El orden importa y no es reversible.

### Primeros pasos de la sesión nueva

1. **Rescatar** desde el ícono: ⚙️ → **📋 Copiar pendientes** → pegar el texto
   en cualquier chat. (El CSV con `<a download>` no baja nada en una PWA de
   iOS; el portapapeles sí funciona ahí.) Después:
   `~/.venvs/facturador/bin/python server/importar_pendientes.py <archivo>.csv`
   — preserva el uid, así que si la cola drena sola más tarde no duplica.
2. **Confirmar** con v7.6: 🩺 desde el **ícono** y 🩺 desde **Safari**. Si los
   `almacenamiento: #xxxxxx` son distintos, está probado. La línea
   `la más vieja:` de los pendientes lo confirma por otro lado: una cola con
   fechas de semanas atrás no se generó hoy.
3. **Arreglar el contenedor correcto**: dentro del ícono, ⚙️ → Cambiar URL →
   pegar el token de 36 chars a mano. Sin borrar nada. El QR no sirve acá: la
   cámara siempre abre Safari, que es el otro contenedor.
4. Si los dos `#id` resultan **iguales**, esta hipótesis también es falsa y hay
   que mirar el `link de arranque:` que ahora reporta el diagnóstico.

### Herramientas ya disponibles para diagnosticar

- **🩺 Probar conexión** (⚙️): 5 preguntas por separado, resultado al
  portapapeles. Fue lo que resolvió el caso en una línea.
- **💾 Bajar pendientes (CSV)**: rescata lo que no subió, con `estado`, `error`
  y `version_cliente`.
- **`server/importar_pendientes.py`**: mete ese CSV al sheet conservando los
  uid, así un reintento posterior no duplica.

---

## Estado del sistema

| | |
|---|---|
| Cliente | **v7.6** — escrita y testeada, **sin pushear** (hasta que no llegue a Pages, el teléfono sigue en v7.5) |
| Backend | v7.1 + `writtenUids`, desplegado |
| Sheet | 614 filas · duplicados 0 · salud 62,7/100 |
| Tests | sync 5/5 · auth 11/11 · backend 23/23 · layout 0 de 105 |

**Cerrado:** duplicados (uid + LockService + appendRow), sync de categorías,
layout móvil, token fuera del código, convoy de timeouts (lock 10s vs cliente
45s), confirmación por uid, columna origen, pestaña `Auditoría`.

---

## La lección de método

Perdí varias rondas proponiendo causas desde afuera, **y dos de esas
inferencias fueron erróneas**. Lo que cerró el caso no fue una hipótesis mejor:
fue poner un botón de diagnóstico en la app.

**Cuando un dispositivo remoto falla, lo primero no es adivinar la causa: es
construir la forma de verla.** Usar 🩺 antes que cualquier teoría.

Corolario: los tres bugs de esta tanda no eran fallas de lógica sino **de
superficie**. La app hacía lo correcto y no había forma de ver qué pasaba. Cada
fix real fue agregar visibilidad, no cambiar el algoritmo.

Y el que se repite: **prevenir ≠ reparar.** Hicieron falta las dos.

**16/8 — el agregado:** lo que resolvió esta vuelta no fue una línea que dijera
la causa, sino **una que no cerraba**: pendientes 0 → 23 en diez minutos. Un
número imposible vale más que cinco correctos, porque solo admite una
explicación. Por eso el diagnóstico tiene que reportar cosas que puedan
contradecirse entre sí, no solo estados sanos.

Corolario para este caso: **hay que identificar el contenedor, no el aparato.**
Cuatro versiones se fueron en arreglar "el teléfono de Lau" cuando el teléfono
tenía dos, y cada arreglo entraba en el que no era.

---

## Backlog (nada urgente)

- La fila 1 del sheet es invisible para la app (Ingreso real de $49.000, nov-2025).
- Un duplicado viejo: "Seguro $80.000" del 3/8 (filas 558/559).
- La config no hace merge entre dispositivos: el último que guarda pisa al otro.
- "Forma de pago" está muerta (93% vacía): default o sacarla.
- El orden del menú no sigue el uso real (~44 toques/mes).
- Limpiar cada tanto las filas `__CONFIG__/diagnostico` que deja 🩺 (son
  invisibles para la app y para el análisis financiero, pero se acumulan).

---

## Auditoría financiera

Hecha: `~/.claude/skills/auditarfinanzas/salidas/AUDITORIA-FINANCIERA-2026-08.md`.
El brief de entrada está al lado, con marcadas las dos cosas que resultaron mal.

**Pendiente:** cuando el teléfono de Lau esté estable, correr

```bash
~/.venvs/facturador/bin/python server/publicar_auditoria.py --aplicar
```

Los movimientos que subieron después del análisis (y los ~$856.237 de gastos
del hogar que estaban en su cola) **van a mover las conclusiones**.
