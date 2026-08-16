#!/usr/bin/env python3
"""
aplicar_schema.py — publica un árbol de categorías nuevo y reclasifica el
histórico que se desagrega.

CONTEXTO (14/8/2026): la auditoría encontró que el menú de abril sacó
`Almacén` y `Comidas`, y que el gasto de alimentación registrado cayó 52% —
no se reasignó a otra categoría, dejó de registrarse. Este script restituye
esas categorías, saca las 11 que nunca se usaron y abre `Trama` por cliente.

CÓMO GANA UNA CONFIG (index.html:2254): las filas `__CONFIG__` se ordenan por
fecha ASCENDENTE y **gana la última**. Con fecha de hoy y appendeada al final,
la nueva le gana a todas. No hace falta borrar las viejas — de hecho conviene
dejarlas: son el historial de qué menú estuvo vigente cuando.

dry-run por DEFECTO. Con --aplicar hace backup y escribe.

Uso:
    ~/.venvs/facturador/bin/python server/aplicar_schema.py <schema.b64> <aliases.b64>
    ~/.venvs/facturador/bin/python server/aplicar_schema.py <schema.b64> <aliases.b64> --aplicar
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dedupe_movimientos import conectar, BACKUP_DIR  # noqa

# Reclasificación del histórico: `Hogar/Freelance` era un cajón único con
# cuatro clientes adentro, distinguibles solo por la descripción. El orden
# importa: "Sencia mensual ... REDES" es de Sencia, no de Redes — el cliente
# gana sobre el tipo de trabajo.
RECLASIFICAR = {
    ("Hogar", "Freelance"): [
        ("cmg", ("Trama", "CMG")),
        ("sab", ("Trama", "SAB")),
        ("sencia", ("Trama", "Sencia")),
        ("redes", ("Trama", "Redes")),
        (None, ("Trama", "Otros")),      # fallback
    ],
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("schema_b64", type=Path)
    ap.add_argument("aliases_b64", type=Path)
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--sin-reclasificar", action="store_true",
                    help="publica el menú pero no toca ninguna fila histórica")
    args = ap.parse_args()

    schema_b64 = args.schema_b64.read_text().strip()
    aliases_b64 = args.aliases_b64.read_text().strip()

    # Preflight: que el base64 sea JSON válido en UTF-8. El bug histórico de
    # esta app fue exactamente de encoding (btoa escribía latin-1), así que se
    # verifica ANTES de escribir y no después.
    for nombre, b in (("schema", schema_b64), ("aliases", aliases_b64)):
        try:
            json.loads(base64.b64decode(b).decode("utf-8"))
        except Exception as e:
            sys.exit(f"ABORTADO: el {nombre} no decodifica como JSON UTF-8 ({e})")
    schema = json.loads(base64.b64decode(schema_b64).decode("utf-8"))
    print(f"→ schema: {sum(len(v) for t in schema.values() for v in t.values())} "
          f"subcategorías · {len(schema_b64)} chars de base64")

    sh, ws = conectar()
    filas = [list(r) + [""] * 9 for r in ws.get_all_values()]
    print(f"  sheet: {len(filas)} filas")

    # ── Qué filas hay que reclasificar ───────────────────────────────────
    cambios = []
    if not args.sin_reclasificar:
        for i, r in enumerate(filas, start=1):
            clave = (r[2].strip(), r[3].strip())
            if clave not in RECLASIFICAR:
                continue
            d = norm(r[5])
            destino = next((dest for pista, dest in RECLASIFICAR[clave]
                            if pista is None or pista in d), None)
            cambios.append((i, r, destino))

    print(f"\n=== RECLASIFICACIÓN: {len(cambios)} filas ===")
    for i, r, (rub, sub) in cambios:
        print(f"  f{i:<4} {r[0]} ${int(float(r[4] or 0)):>9,} "
              f"{r[2]}/{r[3]} → {rub}/{sub}   ({r[5][:34]})")

    # La fecha NO puede ser simplemente "hoy": los celulares fechan con SU reloj
    # y pueden ir un día adelante de esta máquina (husos, o pasada la medianoche).
    # Una config con fecha anterior a la última existente pierde y el cambio no
    # se aplica nunca. Se toma el máximo entre hoy y la config más nueva: con el
    # empate, gana la nuestra por estar más abajo (el sort de JS es estable).
    hoy = datetime.now().strftime("%Y-%m-%d")
    ultima_cfg = max((r[0].strip() for r in filas
                      if r[1].strip() == "__CONFIG__" and r[2].strip() in ("schema", "aliases")),
                     default="")
    if ultima_cfg > hoy:
        print(f"  ⚠️  hay una config con fecha {ultima_cfg}, posterior a hoy ({hoy}). "
              f"Se usa esa fecha para no perder el empate.")
        hoy = ultima_cfg
    stamp = datetime.now().strftime("%y%m%d%H%M%S")
    nuevas = [
        [hoy, "__CONFIG__", "schema", "", "0", schema_b64, "", f"cfg_schema_{stamp}", ""],
        [hoy, "__CONFIG__", "aliases", "", "0", aliases_b64, "", f"cfg_aliases_{stamp}", ""],
    ]
    print(f"\n=== CONFIG NUEVA: 2 filas con fecha {hoy} (gana la última) ===")

    if not args.aplicar:
        print("\n  DRY-RUN. Nada se escribió. Agregá --aplicar.")
        return 0

    print("\n  ⚠️  Que nadie tenga la app abierta: un fetchSync en curso puede "
          "guardar su config local encima.")

    # Releer justo antes de escribir: entre el dry-run y el aplicar pueden
    # haber entrado movimientos, y los números de fila del update se corren.
    ahora = [list(r) + [""] * 9 for r in ws.get_all_values()]
    if len(ahora) != len(filas):
        print(f"  ⚠️  El sheet cambió ({len(filas)} → {len(ahora)} filas). "
              f"Volvé a correr el script.")
        return 1

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    BACKUP_DIR.mkdir(exist_ok=True)
    destino = BACKUP_DIR / f"movimientos-{ts}-pre-schema.csv"
    with destino.open("w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerows(filas)
    print(f"  ✅ backup: {destino}")

    if cambios:
        ws.batch_update([{"range": f"C{i}:D{i}", "values": [[rub, sub]]}
                         for i, _, (rub, sub) in cambios])
        print(f"  ✅ {len(cambios)} filas reclasificadas")

    ws.append_rows(nuevas, value_input_option="USER_ENTERED")
    print("  ✅ config publicada")

    # ── Verificación ─────────────────────────────────────────────────────
    despues = [list(r) + [""] * 9 for r in ws.get_all_values()]
    ok = True
    for i, _, (rub, sub) in cambios:
        if (despues[i - 1][2].strip(), despues[i - 1][3].strip()) != (rub, sub):
            print(f"  ❌ f{i} quedó en {despues[i-1][2]}/{despues[i-1][3]}")
            ok = False
    # El control que faltaba: no alcanza con que la fila esté escrita, tiene que
    # GANAR. Se replica la lógica exacta de index.html:2254 — ordenar por fecha
    # ascendente y quedarse con la última de cada tipo. Sin esto, una config que
    # otro dispositivo guardó después pisa el cambio y nadie se entera.
    cfg_rows = [r for r in despues if r[1].strip() == "__CONFIG__"
                and r[2].strip() in ("schema", "aliases")]
    cfg_rows.sort(key=lambda r: r[0].strip())          # estable, como en JS
    gana = {}
    for r in cfg_rows:
        gana[r[2].strip()] = r
    for kind, esperado in (("schema", schema_b64), ("aliases", aliases_b64)):
        actual = gana.get(kind)
        if actual is None or actual[5].strip() != esperado:
            print(f"  ❌ la config de {kind} que GANA no es la nueva "
                  f"(gana la de {actual[0] if actual else '?'}, "
                  f"uid {actual[7] if actual else '?'})")
            ok = False
        else:
            print(f"  ✅ {kind}: gana la nueva (fecha {actual[0]}, uid {actual[7]})")
    if not ok:
        print(f"  ❌ RESTAURAR desde {destino}")
        return 2
    print(f"  ✅ verificado: {len(cambios)} reclasificadas y config vigente "
          f"({len(filas)} → {len(despues)} filas)")
    print("\n  Que cada celular abra la app y sincronice para bajar el menú nuevo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
