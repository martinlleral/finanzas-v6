# Handoff — finanzas-v6, estado al 2026-08-15

## 🔴 Lo único abierto: el celular de Lau

**Causa encontrada y confirmada:** su token no es un token, **es la URL del
servidor**. El diagnóstico dijo `token configurado: sí (114 chars)` y la URL
del Apps Script mide exactamente 114 caracteres. Se pegó en el campo
equivocado — el prompt del token viene justo después del de la URL y el
portapapeles todavía la tenía.

Por eso todo responde `Unauthorized`: lectura y escritura. **12 días sin subir
nada, 22 movimientos en cola.**

### Cómo se arregla (5 minutos, con el teléfono en la mano)

**Opción A — la buena.** Desde el celular de Martín (que funciona):
⚙️ → **📱 Configurar otro dispositivo** → escanear el QR con el de Lau.
Eso escribe la URL y el token correctos de una, sin tipear nada.

**Opción B.** Sacar el token de Apps Script (Configuración del proyecto ⚙️ →
Propiedades del script → `SECRET_TOKEN`) y cargarlo en el de Lau por
⚙️ → Cambiar URL → cuando pida el token, pegar **ese** valor.

**Después:** ⚙️ → 🔄 Reintentar ahora. Los 22 deberían subir solos. Los que ya
se importaron a mano el 13/8 los saltea el servidor por uid — no se duplican.

**Verificar:** 🩺 Probar conexión → `LECTURA: ✅ ok`. Y en el sheet tienen que
aparecer filas nuevas con `origen = Lau`.

### Si NO suben

Los 22 están en `~/Downloads/pendientes_Lau_2026-08-15.csv`. Importarlos:

```bash
cd ~/Developer/products/finanzas-v6
~/.venvs/facturador/bin/python server/importar_pendientes.py \
    ~/Downloads/pendientes_Lau_2026-08-15.csv            # dry-run
~/.venvs/facturador/bin/python server/importar_pendientes.py \
    ~/Downloads/pendientes_Lau_2026-08-15.csv --aplicar
```

Conserva los uid originales, así que si después el teléfono reintenta, el
servidor los saltea. ⚠️ Ese CSV tiene los acentos rotos (`AlimentaciÃ³n`):
el archivo está bien, es Excel/preview mostrándolo mal. El importador lo lee
con `utf-8-sig` y sale correcto — pero **verificar el dry-run** antes de aplicar.

---

## Estado del sistema

| | |
|---|---|
| Cliente | **v7.3** en GitHub Pages (se ve en ⚙️) |
| Backend | v7.1 + writtenUids, desplegado |
| Sheet | 600 filas · duplicados 0 · salud 62,7/100 |
| Tests | sync 5/5 · auth 11/11 · backend 23/23 · layout 0 de 105 |

**Todo lo demás está cerrado:** duplicados (uid + LockService), sync de
categorías, layout móvil, token fuera del código, convoy de timeouts,
confirmación por uid. Detalle en el `CLAUDE.md` del repo.

---

## La lección que costó tres rondas

Perdí tres intentos proponiendo causas desde afuera, **y dos de esas
inferencias fueron erróneas**. Lo que las cerró no fue una hipótesis mejor:
fue poner un botón de diagnóstico en la app. `token configurado: sí (114
chars)` resolvió en una línea lo que doce días de síntomas no dejaban ver.

**Cuando un dispositivo remoto falla, lo primero no es adivinar la causa: es
construir la forma de verla.** El diagnóstico (🩺 Probar conexión) y la versión
visible del cliente son el instrumento; conviene usarlos antes que cualquier
teoría.

Corolario de diseño: la app decía *"no se pudo subir"*, que suena a problema de
señal y a esperar. Ahora dice *"🔑 El token de acceso no coincide. Por eso no
sube nada"*. **Nombrar la causa es la diferencia entre 10 segundos y 12 días.**

---

## Backlog (nada urgente)

- La fila 1 del sheet es invisible para la app (un Ingreso real de $49.000 de
  nov-2025 que `getRawData` saltea).
- Un duplicado viejo sin resolver: "Seguro $80.000" del 3/8 (filas 558/559).
- La config no hace merge entre dispositivos: el último que guarda pisa al otro.
- "Forma de pago" está muerta (93% vacía): darle un default o sacarla.
- El orden del menú no sigue el uso real (~44 toques/mes de ahorro).
- Las filas `__CONFIG__/diagnostico` que deja 🩺 Probar conexión se pueden
  limpiar cada tanto; son invisibles para la app y para el análisis.

---

## Auditoría financiera

Ya se hizo: `~/.claude/skills/auditarfinanzas/salidas/AUDITORIA-FINANCIERA-2026-08.md`.
El brief de entrada está al lado y tiene marcadas las dos cosas que resultaron
mal. La pestaña `Auditoría` del spreadsheet tiene las 5 advertencias para leer
los datos, y se refresca con:

```bash
~/.venvs/facturador/bin/python server/publicar_auditoria.py --aplicar
```

**Correrla de nuevo cuando suban los 22 de Lau**: son $856.237 de gastos del
hogar que hoy faltan en el análisis y van a mover las conclusiones.
