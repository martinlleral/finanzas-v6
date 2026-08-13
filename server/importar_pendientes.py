#!/usr/bin/env python3
"""
importar_pendientes.py — mete al sheet los movimientos que quedaron atrapados
en un dispositivo, a partir del CSV que exporta ⚙️ → "Bajar pendientes".

POR QUÉ EXISTE: el 13/8/2026 el celular de Lau acumuló 18 movimientos que la
app nunca logró subir ($856.237, de 11 días). El CSV de rescate los tenía
completos; esto los devuelve al sheet sin depender de que la sincronización
funcione.

CLAVE — se importa el `uid` original, no uno nuevo. Así, si ese teléfono
alguna vez reintenta la cola, el servidor ve el uid, lo saltea, y no duplica.
La idempotencia funciona igual para una fila que puso este script.

dry-run por defecto. Con --aplicar hace backup y escribe.

Uso:
    ~/.venvs/facturador/bin/python server/importar_pendientes.py <archivo.csv>
    ~/.venvs/facturador/bin/python server/importar_pendientes.py <archivo.csv> --aplicar
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dedupe_movimientos import conectar, firma, BACKUP_DIR  # noqa

COLUMNAS = ["fecha", "tipo", "categoria", "subcategoria", "monto",
            "descripcion", "forma_pago", "uid", "origen"]


def leer_csv(ruta: Path) -> list:
    with ruta.open(encoding="utf-8-sig", newline="") as f:
        filas = list(csv.DictReader(f))
    faltan = [c for c in COLUMNAS if c not in (filas[0].keys() if filas else [])]
    if faltan:
        sys.exit(f"Al CSV le faltan columnas: {faltan}")
    return filas


def main() -> int:
    ap = argparse.ArgumentParser(description="Importa pendientes rescatados de un dispositivo")
    ap.add_argument("csv", type=Path)
    ap.add_argument("--aplicar", action="store_true", help="escribe (sin esto es dry-run)")
    args = ap.parse_args()

    pend = leer_csv(args.csv)
    print(f"→ CSV: {len(pend)} movimientos\n")

    sh, ws = conectar()
    filas = [list(r) + [""] * 9 for r in ws.get_all_values()]
    uids = {r[7].strip() for r in filas if r[7].strip()}
    firmas = {firma(r) for r in filas}

    nuevas, ya_por_uid, ya_por_firma = [], [], []
    for p in pend:
        fila = [p["fecha"], p["tipo"], p["categoria"], p["subcategoria"],
                int(float(p["monto"])), p["descripcion"], p["forma_pago"],
                p["uid"], p["origen"]]
        if p["uid"] and p["uid"] in uids:
            ya_por_uid.append(p)
        elif firma(fila) in firmas:
            # Sin uid en el sheet pero con los mismos datos: probablemente la
            # misma carga hecha a mano desde otro dispositivo. No la repetimos.
            ya_por_firma.append(p)
        else:
            nuevas.append((p, fila))
            firmas.add(firma(fila))   # evita duplicar dentro del propio CSV

    print(f"  ya en el sheet por uid:   {len(ya_por_uid)}")
    print(f"  ya en el sheet por datos: {len(ya_por_firma)}")
    for p in ya_por_firma:
        print(f"      ~ {p['fecha']} · {p['categoria']}/{p['subcategoria']} · ${p['monto']} · {p['descripcion'][:28]}")
    print(f"  A IMPORTAR:               {len(nuevas)}\n")

    total = 0
    for p, _ in nuevas:
        total += float(p["monto"])
        print(f"    {p['fecha']} · {p['tipo']:7} · {p['categoria']}/{p['subcategoria']}"
              f" · ${int(float(p['monto'])):>9,} · {p['descripcion'][:30]}")
    print(f"\n  total: ${total:,.0f}")

    if not args.aplicar:
        print("\n  DRY-RUN. Nada se escribió. Agregá --aplicar para importar.")
        return 0
    if not nuevas:
        print("\n  Nada para importar.")
        return 0

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    BACKUP_DIR.mkdir(exist_ok=True)
    destino = BACKUP_DIR / f"movimientos-{ts}-pre-import.csv"
    with destino.open("w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerows(filas)
    print(f"\n  ✅ backup: {destino}")

    antes = len(filas)
    ws.append_rows([fila for _, fila in nuevas], value_input_option="USER_ENTERED")

    despues = ws.get_all_values()
    escritas = {(list(r) + [""] * 9)[7].strip() for r in despues}
    faltantes = [p["uid"] for p, _ in nuevas if p["uid"] and p["uid"] not in escritas]
    print(f"  ✅ {len(despues) - antes} filas agregadas ({antes} → {len(despues)})")
    if faltantes:
        print(f"  ❌ NO quedaron estos uid: {faltantes} — revisar contra el backup")
        return 2
    print("  ✅ verificado: todos los uid del CSV están en el sheet")
    print("\n  El teléfono puede reintentar sin miedo: el servidor los saltea por uid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
