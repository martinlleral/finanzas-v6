#!/usr/bin/env python3
"""
dedupe_movimientos.py — limpieza de filas duplicadas del sheet "APP Familia".

CONTEXTO: la app escribía la misma transacción 2 a 5 veces cuando un POST llegaba
al servidor pero su respuesta no volvía (mode:'no-cors' + retry + cero dedupe).
Ese bug ya está cerrado en la v3 (columna H = uid + LockService). Este script
limpia lo que quedó en el histórico.

CORRERLO **DESPUÉS** de desplegar la v3, no antes: limpiar mientras sigue
goteando es trabajo perdido.

Tres baldes:
  AUTO      duplicados CONTIGUOS (≤2 filas de distancia) → huella de doble
            escritura. Se conserva la PRIMERA ocurrencia.
  REVISIÓN  duplicados LEJANOS → ambiguos. Pueden ser gastos reales repetidos
            ("Niñera $8000" dos veces el mismo día es plausible). Uno por uno,
            a mano.
  VACÍAS    filas completamente vacías → se borran, excluidas del criterio de
            duplicados para que no se agrupen entre sí.

SEGURIDAD:
  - dry-run por DEFAULT. Para escribir hay que pasar --aplicar explícitamente.
  - backup obligatorio antes de tocar nada: CSV local + pestaña espejo.
  - borrado en orden DESCENDENTE (ascendente corre los índices y borra filas
    equivocadas en silencio).
  - post-verificación: el conteo y el multiset de firmas sobrevivientes tienen
    que coincidir con lo calculado ANTES de escribir. Si no, se avisa fuerte.

Uso:
    ~/.venvs/facturador/bin/python dedupe_movimientos.py                # dry-run
    ~/.venvs/facturador/bin/python dedupe_movimientos.py --revisar      # decidir los ambiguos
    ~/.venvs/facturador/bin/python dedupe_movimientos.py --aplicar      # escribe (pide confirmación)
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKUP_DIR = REPO / "backups"
DECISIONES = REPO / "server" / ".dedupe_decisiones.json"   # ignorado por git

# El ID del spreadsheet NO va en el repo: es público (GitHub Pages) y el sheet
# está compartido "cualquiera con el link", así que publicar el ID equivale a
# publicar las finanzas de la familia. Se configura fuera del repo.
CONFIG = Path(__file__).resolve().parent / ".dedupe_config.json"   # gitignored
HOJA = "Movimientos"
SCOPE_RW = ["https://www.googleapis.com/auth/spreadsheets"]


def cargar_config() -> dict:
    """Lee el ID del sheet y la credencial. Del entorno o del archivo local."""
    sid = os.environ.get("FINANZAS_SHEET_ID")
    creds = os.environ.get("FINANZAS_SA_CREDS")
    if not sid and CONFIG.exists():
        c = json.loads(CONFIG.read_text(encoding="utf-8"))
        sid = sid or c.get("sheet_id")
        creds = creds or c.get("creds_path")
    if not sid:
        sys.exit(
            "Falta la configuración. Creá " + str(CONFIG) + " con:\n"
            '  {"sheet_id": "<ID del spreadsheet>",\n'
            '   "creds_path": "~/.config/google-sheets/<service-account>.json"}\n'
            "O exportá FINANZAS_SHEET_ID y FINANZAS_SA_CREDS.\n"
            "Ese archivo está en .gitignore a propósito: el repo es público.")
    return {"sheet_id": sid,
            "creds": Path(creds or "~/.config/google-sheets/sa.json").expanduser()}

GAP_CONTIGUO = 2   # filas de distancia para considerar "escritura doble"

# Parsers del ecosistema: los mismos que usa /cierremdp para su anti-duplicados.
# Reusarlos garantiza que este script agrupe igual que el resto del sistema.
sys.path.insert(0, str(Path.home() / ".claude" / "skills" / "cierremdp"))
try:
    from finanzas_app_familia import _parse_fecha, _normalizar_monto  # noqa
except Exception:  # pragma: no cover
    def _parse_fecha(s):
        s = str(s).strip().split(" ")[0]
        for f in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
            try:
                return datetime.strptime(s, f).date()
            except ValueError:
                continue
        return None

    def _normalizar_monto(s):
        try:
            return int(float(str(s).replace("$", "").replace(",", "").strip()))
        except ValueError:
            return 0


# ─────────────────────────────────────────────────────────────────────────────

def conectar():
    import gspread
    from google.oauth2.service_account import Credentials
    cfg = cargar_config()
    if not cfg["creds"].exists():
        sys.exit(f"No existe la credencial: {cfg['creds']}")
    creds = Credentials.from_service_account_file(str(cfg["creds"]), scopes=SCOPE_RW)
    sh = gspread.authorize(creds).open_by_key(cfg["sheet_id"])
    return sh, sh.worksheet(HOJA)


def monto_exacto(s: str) -> float:
    """Monto SIN perder decimales.

    A propósito no se usa `_normalizar_monto` de /cierremdp acá: esa devuelve
    int, o sea $8000,50 y $8000,99 colapsarían a la misma firma. Para agrupar
    y mostrar da igual, pero el balde AUTO **borra sin revisión humana**, así
    que un falso positivo ahí es un movimiento real perdido.
    """
    t = str(s).strip().replace("$", "").replace(" ", "")
    if "," in t and "." in t:
        t = (t.replace(".", "").replace(",", ".") if t.rindex(",") > t.rindex(".")
             else t.replace(",", ""))
    elif "," in t:
        partes = t.split(",")
        t = t.replace(",", ".") if (len(partes) == 2 and len(partes[1]) == 2) else t.replace(",", "")
    try:
        return round(float(t), 2)
    except ValueError:
        return 0.0


def firma(fila: list) -> tuple:
    """Identidad de un movimiento, normalizando fecha y monto.

    Sin normalizar, '12/6/2026' y '2026-06-12' se verían como movimientos
    distintos y la mitad de los duplicados quedarían invisibles.
    """
    r = list(fila) + [""] * (8 - len(fila))
    f = _parse_fecha(r[0])
    return (f.isoformat() if f else r[0].strip(),
            r[1].strip(), r[2].strip(), r[3].strip(),
            monto_exacto(r[4]), r[5].strip(), r[6].strip())


def es_vacia(fila: list) -> bool:
    return not any(str(c).strip() for c in (list(fila) + [""] * 7)[:7])


def clasificar(filas: list) -> dict:
    """Agrupa por firma y reparte en los 3 baldes."""
    vacias = [i + 1 for i, f in enumerate(filas) if es_vacia(f)]
    grupos = defaultdict(list)
    for i, f in enumerate(filas):
        if es_vacia(f) or (list(f) + [""])[1].strip() == "__CONFIG__":
            continue
        grupos[firma(f)].append(i + 1)

    auto, revision = [], []
    for sig, nums in grupos.items():
        if len(nums) < 2:
            continue
        nums = sorted(nums)
        # Cadenas de filas contiguas: 364,365,366 es UNA ráfaga de retry
        cadena, cadenas = [nums[0]], []
        for a, b in zip(nums, nums[1:]):
            if b - a <= GAP_CONTIGUO:
                cadena.append(b)
            else:
                cadenas.append(cadena)
                cadena = [b]
        cadenas.append(cadena)

        for c in cadenas:
            if len(c) > 1:
                # conservar la PRIMERA, borrar el resto
                auto.append({"firma": list(sig), "conservar": c[0], "borrar": c[1:]})
        representantes = [c[0] for c in cadenas]
        if len(representantes) > 1:
            revision.append({"firma": list(sig), "filas": representantes,
                             "distancia_max": max(b - a for a, b in
                                                  zip(representantes, representantes[1:]))})
    return {"auto": auto, "revision": revision, "vacias": vacias}


def fmt(sig) -> str:
    d, t, c, s, a, desc, p = sig
    return (f"{d} · {t} · {c}/{s} · ${a:,} · {desc[:40] or '(sin descripción)'}"
            + (f" · {p}" if p else ""))


def contexto(filas: list, n: int, radio: int = 2) -> list:
    out = []
    for i in range(max(1, n - radio), min(len(filas), n + radio) + 1):
        r = list(filas[i - 1]) + [""] * 7
        marca = "→" if i == n else " "
        out.append(f"   {marca} f{i:<4} {r[0][:10]:11} {r[1][:7]:7} {r[2][:14]:14} "
                   f"{r[3][:14]:14} {r[4][:10]:>10} {r[5][:30]}")
    return out


def cargar_decisiones() -> dict:
    if DECISIONES.exists():
        return json.loads(DECISIONES.read_text(encoding="utf-8"))
    return {}


def guardar_decisiones(d: dict) -> None:
    DECISIONES.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def revisar_interactivo(filas: list, revision: list) -> dict:
    """Los ambiguos, uno por uno, con contexto. Las decisiones se persisten."""
    dec = cargar_decisiones()
    print(f"\n{'='*78}\n  REVISIÓN DE AMBIGUOS — {len(revision)} grupos\n{'='*78}")
    print("  Estos son movimientos IDÉNTICOS pero separados en el sheet.")
    print("  Pueden ser un duplicado real o dos gastos iguales de verdad.\n")
    for i, g in enumerate(revision, 1):
        clave = "|".join(str(x) for x in g["firma"])
        if clave in dec:
            print(f"[{i}/{len(revision)}] ya decidido: {dec[clave]['accion']} — {fmt(g['firma'])}")
            continue
        print(f"\n[{i}/{len(revision)}] {fmt(g['firma'])}")
        print(f"   filas {g['filas']} · separadas por hasta {g['distancia_max']} filas")
        for n in g["filas"]:
            print(f"   ── contexto de la fila {n} ──")
            print("\n".join(contexto(filas, n)))
        r = ""
        while r not in ("b", "c", "s"):
            r = input("   [b]orrar los extras (conservar el primero) / "
                      "[c]onservar todas / [s]altear: ").strip().lower()
        dec[clave] = {"accion": {"b": "borrar", "c": "conservar", "s": "saltear"}[r],
                      "filas": g["filas"]}
        guardar_decisiones(dec)
    return dec


def hacer_backup(sh, ws, filas: list) -> Path:
    """CSV local + pestaña espejo. El CSV es el que importa: vive fuera de Google."""
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    BACKUP_DIR.mkdir(exist_ok=True)
    destino = BACKUP_DIR / f"movimientos-{ts}.csv"
    with destino.open("w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerows(filas)
    print(f"  ✅ backup local: {destino} ({len(filas)} filas)")

    hojas = sh.worksheets()
    sh.duplicate_sheet(ws.id, insert_sheet_index=len(hojas),
                       new_sheet_name=f"BACKUP_{ts}")
    # El backend hace getSheets()[0]: si el backup cayera en el índice 0, la app
    # entera empezaría a escribir en la copia. Este assert NO es decorativo.
    primera = sh.worksheets()[0].title
    if primera != HOJA:
        sys.exit(f"ABORTADO: la hoja 0 ahora es '{primera}' y no '{HOJA}'. "
                 f"El backend escribe en getSheets()[0]. Mové la pestaña a mano y reintentá.")
    print(f"  ✅ pestaña espejo: BACKUP_{ts} (hoja 0 sigue siendo '{HOJA}')")
    return destino


def main() -> int:
    ap = argparse.ArgumentParser(description="Limpieza de duplicados del sheet APP Familia")
    ap.add_argument("--aplicar", action="store_true",
                    help="ESCRIBE en el sheet (sin esto es dry-run)")
    ap.add_argument("--revisar", action="store_true",
                    help="decidir interactivamente los duplicados ambiguos")
    ap.add_argument("--incluir-ambiguos", action="store_true",
                    help="al aplicar, incluir también los ambiguos ya decididos como 'borrar'")
    args = ap.parse_args()

    print("→ Leyendo el sheet...")
    sh, ws = conectar()
    filas = ws.get_all_values()
    print(f"  {len(filas)} filas")

    cl = clasificar(filas)
    a_borrar_auto = sorted({n for g in cl["auto"] for n in g["borrar"]})
    print(f"\n{'='*78}")
    print(f"  BALDE AUTO      {len(cl['auto']):3} grupos contiguos → {len(a_borrar_auto)} filas a borrar")
    print(f"  BALDE REVISIÓN  {len(cl['revision']):3} grupos ambiguos → decisión humana")
    print(f"  BALDE VACÍAS    {len(cl['vacias']):3} filas completamente vacías")
    print(f"{'='*78}\n")

    print("── AUTO (contiguos: huella de doble escritura) ──")
    for g in cl["auto"]:
        print(f"  conservar f{g['conservar']} · borrar {g['borrar']}  |  {fmt(g['firma'])}")

    print("\n── REVISIÓN (ambiguos: requieren juicio) ──")
    for g in cl["revision"]:
        print(f"  filas {g['filas']} (dist. {g['distancia_max']})  |  {fmt(g['firma'])}")

    if cl["vacias"]:
        print(f"\n── VACÍAS ──\n  filas {cl['vacias']}")

    dec = cargar_decisiones()
    if args.revisar:
        dec = revisar_interactivo(filas, cl["revision"])

    a_borrar = set(a_borrar_auto) | set(cl["vacias"])
    if args.incluir_ambiguos:
        for g in cl["revision"]:
            clave = "|".join(str(x) for x in g["firma"])
            if dec.get(clave, {}).get("accion") == "borrar":
                a_borrar |= set(g["filas"][1:])   # conservar el primero

    a_borrar = sorted(a_borrar)
    print(f"\n{'='*78}")
    print(f"  TOTAL A BORRAR: {len(a_borrar)} filas → quedarían {len(filas) - len(a_borrar)}")
    print(f"  filas: {a_borrar}")
    print(f"{'='*78}")

    if not args.aplicar:
        print("\n  DRY-RUN. Nada se escribió.")
        print("  Para decidir los ambiguos:  --revisar")
        print("  Para aplicar:               --aplicar [--incluir-ambiguos]")
        return 0

    if not a_borrar:
        print("\n  Nada para borrar.")
        return 0

    print("\n  ⚠️  ANTES DE SEGUIR: que nadie tenga la app abierta.")
    print("      Un fetchSync en curso puede reinyectar filas desde su caché local.")
    if input("  Escribí 'SI' para aplicar: ").strip() != "SI":
        print("  Cancelado.")
        return 1

    # RELEER justo antes de escribir. Entre el dry-run y el "SI" pasaron
    # minutos: si alguien cargó un gasto o corrió cierre.py en el medio, los
    # números de fila calculados antes apuntan a OTRAS filas y borraríamos lo
    # que no es. Preferimos abortar y que se vuelva a correr.
    filas_ahora = ws.get_all_values()
    if filas_ahora != filas:
        print(f"\n  ⚠️  El sheet cambió mientras confirmabas "
              f"({len(filas)} → {len(filas_ahora)} filas).")
        print("      Los números de fila ya no son válidos. Volvé a correr el script.")
        return 1

    hacer_backup(sh, ws, filas)

    # Firmas esperadas DESPUÉS del borrado, calculadas ANTES de escribir.
    esperado = sorted(firma(f) for i, f in enumerate(filas) if (i + 1) not in a_borrar)

    # DESCENDENTE: en ascendente cada borrado corre los índices de los siguientes
    # y terminás borrando filas equivocadas sin que nada avise.
    reqs = [{"deleteDimension": {"range": {"sheetId": ws.id, "dimension": "ROWS",
                                           "startIndex": n - 1, "endIndex": n}}}
            for n in sorted(a_borrar, reverse=True)]
    sh.batch_update({"requests": reqs})
    print(f"  ✅ {len(a_borrar)} filas borradas")

    despues = ws.get_all_values()
    real = sorted(firma(f) for f in despues)
    if len(despues) != len(filas) - len(a_borrar):
        print(f"  ❌ CONTEO MAL: esperaba {len(filas)-len(a_borrar)}, hay {len(despues)}. "
              f"RESTAURAR desde el backup.")
        return 2
    if real != esperado:
        print("  ❌ LAS FIRMAS NO COINCIDEN con lo calculado. RESTAURAR desde el backup.")
        return 2
    print(f"  ✅ verificado: {len(despues)} filas, firmas idénticas a lo esperado")
    print("\n  Siguiente paso: correr /auditarfinanzas quick para confirmar "
          "que dup_contiguos_grupos quedó en 0.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
