# Handoff — finanzas-v6 · estado al 2026-08-16

> **Para retomar en sesión nueva.** Leer esto primero; el `CLAUDE.md` del repo
> tiene el detalle técnico y las convenciones que no hay que romper.

---

## 🔴 Lo único abierto: el teléfono de Lau tiene DOS apps, y una está rota

**Resuelto el 16/8.** El teléfono nunca "perdió" el token: tiene **dos
`localStorage` separados** — el del ícono de la pantalla de inicio y el de
Safari — y cada arreglo entraba en el que no era. Probado con v7.6: los ids de
almacenamiento son distintos (`#pimk3a` vs `#u2bp2y`).

Queda **un solo paso**: poner el token a mano dentro del ícono. Todo lo demás
(rescate de los $1.002.537 atrapados, confirmación de la causa) está hecho.

### Qué sabemos con certeza

1. **El token guardado en el contenedor del ícono era la URL del servidor**
   (114 caracteres, coincidencia exacta con la del Apps Script). Con eso, todo
   responde `Unauthorized`. v7.5 ya lo descartó solo (16/8, 14:30).
2. **El teléfono SÍ escribe cuando el token está bien.** El contenedor de
   Safari lee 614 filas, escribe, confirma por uid y saltea el reenvío.
3. **El síntoma era la RECURRENCIA**, y su causa es la de arriba: se arreglaba
   un contenedor y se seguía usando el otro.

### ~~La hipótesis del link~~ — DESCARTADA el 16/8

> El acceso directo guardaría la URL con los parámetros `?api=…&token=…`, y
> cada apertura desde el ícono volvería a aplicar lo que trajera ese link.

Se cayó con evidencia directa: el diagnóstico del ícono reporta **`link de
arranque: api=no · token=no`**. El acceso directo está limpio y nunca fue el
problema. Las capas v7.3/v7.4 que salieron de esta hipótesis igual sirven —
previenen un error real de tipeo — pero no eran la causa de este caso.

Se deja escrita porque costó tres versiones y para no volver a recorrerla.

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

### 16/8 · CONFIRMADO con v7.6: son dos almacenamientos

Los dos diagnósticos, mismo teléfono, mismo día:

| | ícono (pantalla de inicio) | Safari |
|---|---|---|
| **almacenamiento** | **`#pimk3a`** | **`#u2bp2y`** |
| token | NO (v7.5 descartó uno con forma de URL, 14:30) | sí (36 chars) |
| pendientes | 23 · del 3/8 al 15/8 · **$1.002.537** | 0 |
| lectura | ❌ | ✅ 614 filas |

Dos ids distintos: probado. Y `link de arranque: api=no · token=no` cierra la
hipótesis anterior desde el otro lado — el acceso directo está limpio, el link
nunca fue el problema.

**Rescate hecho** (16/8, `importar_pendientes.py`): de los 23, **18 ya estaban
en el sheet** por uid (rescates del 13 y 15/8) y entraron los **5 que faltaban,
$146.300**. Sheet 616 → 621, backup en
`backups/movimientos-20260816-145552-pre-import.csv`. Cero duplicados: la
idempotencia por uid funcionó exactamente como estaba diseñada.

**Falta el paso 3**: poner el token de 36 chars a mano dentro del ícono. El
token se saca del contenedor sano sin salir del teléfono — en Safari, ⚙️ →
Configurar API → Aceptar la URL → el segundo prompt trae el token escrito →
copiarlo → **Cancelar** (no guarda nada) → repetir en el ícono, pegando.

Al guardar, la app recarga y la cola drena sola: el servidor saltea los 23 por
uid porque ya están todos en el sheet.

**Suelto, para vigilar:** el 🩺 del ícono dio `TypeError: Load failed` a los
**40ms**, cuando una hora antes ese mismo contenedor daba `Unauthorized` a los
1239ms (o sea, llegaba al servidor). 40ms es "ni salió a la red" — el patrón de
una PWA de iOS recién despertada del background. **Si persiste con el token ya
puesto, no es la red**: hay que mirar la URL de ese contenedor, que el
diagnóstico hoy solo reporta como "configurado: sí".

### El detalle de cómo se llegó ahí

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

### El procedimiento, para la próxima vez que pase

1. ~~**Rescatar** antes de tocar nada~~ ✅ hecho el 16/8. ⚙️ → **📋 Copiar
   pendientes** (o el CSV, si baja) → `importar_pendientes.py`. Preserva el uid,
   así que reimportar y que la cola drene después no duplica.
2. ~~**Confirmar** con los dos 🩺~~ ✅ hecho: `#pimk3a` ≠ `#u2bp2y`.
3. **Arreglar el contenedor correcto** ← pendiente. Ver arriba.

Si alguna vez los dos `#id` salen **iguales**, esta hipótesis también sería
falsa y habría que mirar el `link de arranque:` del diagnóstico.

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
| Cliente | **v7.6** en GitHub Pages, verificado contra la URL real el 16/8 (la versión se ve en ⚙️) |
| Backend | v7.1 + `writtenUids`, desplegado |
| Sheet | 621 filas · duplicados 0 · salud 62,7/100 |
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
