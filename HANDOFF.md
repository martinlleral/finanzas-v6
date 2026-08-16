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
| **Reparar** al arrancar | **v7.5** | Si el token guardado tiene forma de URL, se descarta y se avisa |

La v7.5 es la que faltaba: prevenir no arregla lo que **ya quedó guardado**.
Antes, un teléfono decía "token configurado: sí" y fallaba todo — mucho más
difícil de diagnosticar que uno que dice que le falta.

### Primeros pasos de la sesión nueva

1. En el celular de Lau: cerrar la app del todo, reabrir, y verificar en ⚙️
   que diga **v7.5**. Si dice otra cosa, el problema es de caché, no de lógica.
2. **🩺 Probar conexión** → pegar el resultado. Da versión, largo del token,
   lectura, escritura, confirmación por uid e idempotencia.
3. Mirar cómo está guardado el acceso directo: si la URL tiene `?api=` o
   `?token=`, **borrarlo y volver a agregarlo** desde
   `https://martinlleral.github.io/finanzas-v6` (limpia).
4. Si vuelve a fallar con v7.5 confirmada y acceso directo limpio, **la
   hipótesis del link es falsa** y hay que buscar en otro lado. Candidato
   siguiente: los WebView de iOS pueden tener contextos de almacenamiento
   distintos (icono vs Safari), o el QR que se escanea trae el token malo
   embebido — **revisar qué genera `shareConfig()` en el teléfono de Martín**.

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
| Cliente | **v7.5** en GitHub Pages (la versión se ve en ⚙️) |
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
