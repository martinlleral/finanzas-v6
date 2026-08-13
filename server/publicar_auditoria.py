#!/usr/bin/env python3
"""
publicar_auditoria.py — deja en el spreadsheet una pestaña "Auditoría" con las
advertencias para leer estos datos y el estado del dato al día de hoy.

POR QUÉ EXISTE: cualquiera que abra este sheet —un contador, un asesor
financiero, Lau, vos dentro de seis meses— ve 590 filas de movimientos y no
tiene forma de saber que hay $5,9M contados dos veces, que los montos son
nominales en un país con inflación alta, o que Mar de Pan recién aparece en
febrero. Esas advertencias vivían en una conversación. Ahora viven al lado
del dato.

POR QUÉ NO LO HACE EL SKILL: /auditarfinanzas es READ-ONLY por contrato, y esa
promesa es lo que lo hace confiable sobre la base de datos de la familia. Así
que el skill lee y calcula; este script —que vive con los otros que escriben,
dedupe_movimientos.py e importar_pendientes.py— publica.

GARANTÍAS:
  - Escribe SOLO en la pestaña "Auditoría". Aborta si el nombre no coincide.
  - Nunca toca "Movimientos". Hay un assert explícito.
  - La pestaña se crea al final, así que no altera el orden que ve nadie.
  - La app no la lee: getSheet() busca "Movimientos" por nombre.
  - Es idempotente: cada corrida reescribe la pestaña entera.

Uso:
    ~/.venvs/facturador/bin/python server/publicar_auditoria.py            # dry-run
    ~/.venvs/facturador/bin/python server/publicar_auditoria.py --aplicar
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dedupe_movimientos import conectar, monto_exacto, _parse_fecha  # noqa

HOJA_DESTINO = "Auditoría"
HOJA_DATOS = "Movimientos"
SKILL_SALIDAS = Path.home() / ".claude" / "skills" / "auditarfinanzas" / "salidas"
LEDGER = Path.home() / ".claude" / "skills" / "auditarfinanzas" / "estado_fixes.json"


def _norm(s: str) -> str:
    return str(s).strip().lower().replace(" ", "")


def calcular(filas: list) -> dict:
    """Las advertencias se CALCULAN, no se escriben a mano.

    Si se hardcodearan, en tres meses el sheet diría un número y el dato otro,
    que es exactamente el problema que esta pestaña viene a resolver.
    """
    movs = [r for r in filas if r[1].strip() in ("Ingreso", "Egreso")]
    es_mdp = lambda r: _norm(r[2]) == "mardepan"

    # Pares espejo: la misma plata sale de MdP y entra al Hogar el mismo día.
    por_fecha_monto = defaultdict(list)
    for r in movs:
        f = _parse_fecha(r[0])
        if f:
            por_fecha_monto[(f, round(monto_exacto(r[4]), 2))].append(r)
    espejo_monto, espejo_n = 0.0, 0
    for (_, mo), rs in por_fecha_monto.items():
        egr = [x for x in rs if x[1].strip() == "Egreso" and es_mdp(x)]
        ing = [x for x in rs if x[1].strip() == "Ingreso" and _norm(x[2]) == "hogar"]
        if egr and ing:
            espejo_monto += mo
            espejo_n += 1

    ingresos = sum(monto_exacto(r[4]) for r in movs if r[1].strip() == "Ingreso")

    # ¿Desde cuándo hay registro real del negocio?
    meses_mdp = sorted({_parse_fecha(r[0]).isoformat()[:7] for r in movs
                        if es_mdp(r) and r[1].strip() == "Ingreso" and _parse_fecha(r[0])})

    fechas = [_parse_fecha(r[0]) for r in movs if _parse_fecha(r[0])]
    por_mes = defaultdict(int)
    for f in fechas:
        por_mes[f.isoformat()[:7]] += 1
    hoy = date.today()
    mes_actual = hoy.isoformat()[:7]
    completos = [v for k, v in sorted(por_mes.items()) if k != mes_actual]
    delta = None
    if len(completos) >= 6:
        a, b = sum(completos[-3:]), sum(completos[-6:-3])
        delta = round(100 * (a - b) / b, 1) if b else None

    return {
        "movimientos": len(movs),
        "filas": len(filas),
        "desde": min(fechas).isoformat() if fechas else "—",
        "hasta": max(fechas).isoformat() if fechas else "—",
        "espejo_n": espejo_n,
        "espejo_monto": espejo_monto,
        "espejo_pct": round(100 * espejo_monto / ingresos, 1) if ingresos else 0,
        "ingresos_brutos": ingresos,
        "ingresos_netos": ingresos - espejo_monto,
        "mdp_desde": meses_mdp[0] if meses_mdp else "—",
        "delta_3m": delta,
        "mes_actual": mes_actual,
        "movs_mes_actual": por_mes.get(mes_actual, 0),
        "dia_del_mes": hoy.day,
        "sin_uid": sum(1 for r in filas if not r[7].strip()),
        "sin_origen": sum(1 for r in filas if not r[8].strip()),
    }


def armar_filas(c: dict) -> list:
    hoy = date.today().isoformat()
    plata = lambda x: f"${x:,.0f}".replace(",", ".")
    F = []
    A = F.append

    A(["ADVERTENCIAS PARA LEER ESTOS DATOS", "", ""])
    A([f"Generado automáticamente el {hoy} · no editar a mano: se reescribe en cada corrida", "", ""])
    A(["", "", ""])
    A(["#", "Advertencia", "Detalle"])

    A(["1", "Hay plata contada dos veces",
       f"{c['espejo_n']} pares espejo por {plata(c['espejo_monto'])}. Cuando sale plata de Mar de Pan "
       f"al hogar, se registra como egreso del negocio Y como ingreso del hogar. Es correcto para el "
       f"flujo de caja, pero infla los ingresos totales un {c['espejo_pct']}%. "
       f"Ingresos brutos {plata(c['ingresos_brutos'])} → netos {plata(c['ingresos_netos'])}."])

    A(["2", "Los montos son NOMINALES y esto es Argentina",
       f"El período va de {c['desde']} a {c['hasta']}. Los pesos de una punta y de la otra no son la "
       f"misma plata. Sin deflactar por IPC (o convertir a USD/UVA), cualquier lectura de tendencia "
       f"es inflación disfrazada de crecimiento. Esto se resuelve ANTES de sacar conclusiones."])

    A(["3", "Mar de Pan no está completo desde el principio",
       f"Los ingresos del negocio aparecen recién desde {c['mdp_desde']}. Antes no es que no facturara: "
       f"no estaba en este sheet. Toda serie que arranque antes va a mostrar un despegue que es un "
       f"artefacto de registro, no del negocio."])

    A(["4", "El registro reciente puede estar incompleto",
       (f"La carga cayó {c['delta_3m']}% en los últimos 3 meses completos, así que probablemente "
        f"falten gastos chicos. La app ya se arregló (los desbordes de pantalla y los movimientos "
        f"que se perdían), pero el dato viejo no se recupera."
        if c["delta_3m"] is not None else "Sin datos suficientes para medir la tendencia.")])

    A(["5", "Negocio y hogar conviven en el mismo sheet",
       "Mar de Pan y las finanzas familiares comparten planilla. Antes de analizar hay que decidir "
       "de qué se está hablando: el hogar, el negocio, o el consolidado. Son preguntas distintas."])

    A(["", "", ""])
    A(["ESTADO DEL DATO", "", ""])
    A(["Métrica", "Valor", "Qué significa"])
    A(["Movimientos", c["movimientos"],
       f"filas de datos reales, de {c['desde']} a {c['hasta']}"])
    A(["Mes en curso", f"{c['movs_mes_actual']} al día {c['dia_del_mes']}",
       "parcial: no compararlo contra meses completos"])
    A(["Filas sin identificador", c["sin_uid"],
       "históricas y las que carga el cierre semanal. Las nuevas de la app sí lo traen"])
    A(["Filas sin origen", c["sin_origen"],
       "anteriores a que se registrara desde qué dispositivo se cargó"])

    if LEDGER.exists():
        try:
            libro = json.loads(LEDGER.read_text(encoding="utf-8"))
            cerrados = [(k, v) for k, v in libro.items()
                        if isinstance(v, dict) and v.get("estado") == "cerrado"]
            abiertos = [(k, v) for k, v in libro.items()
                        if isinstance(v, dict) and v.get("estado") == "abierto"]
            A(["", "", ""])
            A(["QUÉ SE ARREGLÓ", "", ""])
            A(["Estado", "Problema", "Verificado"])
            for k, v in cerrados:
                A(["cerrado", v.get("titulo", k), v.get("verificado_en") or ""])
            for k, v in abiertos:
                A(["abierto", v.get("titulo", k), ""])
        except Exception as e:  # pragma: no cover
            A(["", f"(no se pudo leer el libro de fixes: {e})", ""])

    A(["", "", ""])
    A(["Esta pestaña la genera server/publicar_auditoria.py del repo finanzas-v6.", "", ""])
    A(["La app no la lee: busca 'Movimientos' por nombre, así que agregar pestañas es seguro.", "", ""])
    return F


def main() -> int:
    ap = argparse.ArgumentParser(description="Publica la pestaña de auditoría")
    ap.add_argument("--aplicar", action="store_true", help="escribe (sin esto es dry-run)")
    args = ap.parse_args()

    sh, ws = conectar()
    if ws.title != HOJA_DATOS:
        sys.exit(f"ABORTADO: esperaba leer '{HOJA_DATOS}' y encontré '{ws.title}'.")
    filas = [list(r) + [""] * 9 for r in ws.get_all_values()]

    c = calcular(filas)
    out = armar_filas(c)

    print(f"→ {c['movimientos']} movimientos · {c['desde']} → {c['hasta']}\n")
    for f in out[:12]:
        print("  " + " | ".join(str(x)[:70] for x in f if str(x).strip()))
    print(f"  … ({len(out)} filas en total)\n")

    if not args.aplicar:
        print("  DRY-RUN. Nada se escribió. Agregá --aplicar para publicar.")
        return 0

    try:
        dest = sh.worksheet(HOJA_DESTINO)
    except Exception:
        dest = sh.add_worksheet(title=HOJA_DESTINO, rows=100, cols=3,
                                index=len(sh.worksheets()))
        print(f"  ✅ pestaña '{HOJA_DESTINO}' creada")

    # Cinturón: nunca escribir sobre los datos, pase lo que pase arriba.
    assert dest.title == HOJA_DESTINO, f"destino inesperado: {dest.title}"
    assert dest.id != ws.id, "el destino es la hoja de movimientos"

    dest.clear()
    dest.update(values=out, range_name="A1", value_input_option="RAW")

    # Y verificar que la hoja de datos siguió intacta.
    despues = ws.get_all_values()
    if len(despues) != len(filas):
        print(f"  ❌ '{HOJA_DATOS}' cambió de {len(filas)} a {len(despues)} filas. Revisar.")
        return 2
    print(f"  ✅ publicadas {len(out)} filas en '{HOJA_DESTINO}'")
    print(f"  ✅ '{HOJA_DATOS}' intacta ({len(despues)} filas)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
