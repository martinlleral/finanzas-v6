# Deploy de la v3 — orden y verificaciones

La v3 arregla los duplicados (columna H = uid + LockService) y el P0 de la
sincronización de categorías. **El orden importa, y cada paso se verifica antes
de seguir al siguiente.**

Las dos direcciones son compatibles, así que se puede volver atrás de cualquiera
de los dos lados por separado:

| Momento | Servidor | Cliente | Qué pasa |
|---|---|---|---|
| hoy | v2 | v2 | duplica |
| tras el paso 1 | **v3** | v2 | seguro: sin `uid` el server appendea igual, pero ya con lock y batch atómico |
| tras el paso 2 | v3 | **v3** | idempotente end-to-end |
| *(rollback)* | v2 | v3 | seguro: el v2 ignora el `uid` y responde JSON legible → el cliente funciona degradado |

---

## Paso 1 — Servidor (primero)

> ⚠️ **ANTES DE PEGAR: copiá el `SECRET_TOKEN` que ya está desplegado.**
> En el repo, la línea 13 dice `const SECRET_TOKEN = 'CAMBIAR-POR-UN-TOKEN-RANDOM-DE-32-CHARS'`.
> Si pegás el archivo tal cual, **le pisás el token real con el placeholder** — y
> `checkAuth_` tiene un modo permisivo justo para ese placeholder, así que
> **la autenticación queda desactivada en silencio** y cualquiera con la URL
> puede leer y escribir la planilla familiar.
>
> Procedimiento: en el editor de Apps Script, **copiá primero** el valor actual
> de `SECRET_TOKEN`, pegá el código nuevo, y **volvé a poner ese valor** en la
> línea 13 antes de guardar.

1. Abrir el spreadsheet **APP Familia** → Extensiones → Apps Script.
2. **Copiar el `SECRET_TOKEN` actual** (ver el aviso de arriba).
3. Seleccionar TODO el código y reemplazarlo por `server/apps_script.gs`.
4. **Volver a poner el `SECRET_TOKEN`** en la línea 13.
5. Guardar (Ctrl+S).
6. Desplegar → Administrar implementaciones → ✏️ lápiz → Versión: **Nueva versión** → Desplegar.
   **La URL no cambia**, así que no hay que tocar nada en los dispositivos.

### Verificar antes de seguir (con el cliente viejo todavía en producción)

- [ ] Cargar un gasto de **$1** desde el celular → tiene que aparecer **una sola** fila, con la columna H vacía (el cliente viejo todavía no manda uid).
- [ ] Borrar ese gasto desde la app → tiene que borrarse **esa** fila y ninguna otra.
- [ ] En el editor de Apps Script: Ejecuciones → que no haya errores rojos.

Si algo falla: Administrar implementaciones → volver a la versión anterior.

---

## Paso 2 — Cliente

```bash
cd ~/Developer/products/finanzas-v6
git add -A && git commit -m "..." && git push
```

GitHub Actions publica solo. **No hay service worker**, así que alcanza con un
hard-refresh. En los iconos de "Agregar a inicio" de iOS conviene **cerrar y
reabrir la app**.

### Verificar

- [ ] Con DevTools abierto (o desde la desktop), cargar un gasto: el POST tiene que devolver **200 con un body legible** `{"ok":true,"written":1,"skipped":[]}`. Si el body es opaco, el `apiPost` no está tomando el camino CORS.
- [ ] **Prueba del bug**: modo avión → cargar 2 gastos → volver a tener señal → esperar → tienen que aparecer **exactamente 2 filas** en el sheet, cada una con su uid en la columna H.
- [ ] Editar una categoría desde el celular → abrirla en la desktop → tiene que aparecer, **con los acentos bien** ("Alimentación", no "Alimentaci�n"). Esto valida el fix del P0.
- [ ] En el celular: tipear un monto de 7 dígitos → tiene que verse **completo**, y la última fila del teclado (`.`, `0`, `←`) tiene que ser **tocable**.

---

## Paso 3 — Limpieza del histórico

**Recién acá**, con el sangrado ya cortado. Limpiar antes es trabajo perdido.

```bash
cd ~/Developer/products/finanzas-v6

# 1. Ver qué se borraría (no escribe nada)
~/.venvs/facturador/bin/python server/dedupe_movimientos.py

# 2. Decidir los ambiguos uno por uno, con contexto de ±2 filas
~/.venvs/facturador/bin/python server/dedupe_movimientos.py --revisar

# 3. Aplicar (hace backup, pide confirmación, y verifica el resultado)
~/.venvs/facturador/bin/python server/dedupe_movimientos.py --aplicar --incluir-ambiguos
```

⚠️ **Que nadie tenga la app abierta mientras corre el paso 3.** Un `fetchSync` en
curso puede reinyectar filas desde su caché local.

El script hace backup a `backups/` **y** crea una pestaña `BACKUP_<timestamp>` en
el spreadsheet. Desde la v3 el backend busca la hoja **por nombre**
(`getSheetByName('Movimientos')`), así que agregar pestañas ya no puede
desviarlo; el assert de que la hoja 0 sigue siendo `Movimientos` queda igual
como red por si algún día se renombra.

Antes de borrar, el script **relee el sheet**: si alguien cargó un gasto o corrió
`cierre.py` entre el dry-run y tu confirmación, aborta en vez de borrar filas
equivocadas (los números de fila ya no serían válidos).

Al terminar, verificar:

```bash
~/.venvs/facturador/bin/python ~/.claude/skills/auditarfinanzas/auditar.py --modo quick
```

`dup_contiguos_grupos` tiene que dar **0**.

---

## Rollback

- **Cliente**: `git revert` + push, o volver a la versión anterior en GitHub Pages.
- **Servidor**: Administrar implementaciones → elegir la versión anterior.
- **Datos**: restaurar desde la pestaña `BACKUP_<timestamp>` o desde el CSV en `backups/`.
