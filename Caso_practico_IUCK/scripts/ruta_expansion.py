"""
ruta_expansion.py
==================
Pregunta 2 del caso: dado el techo, ¿qué ritmo y qué orden de apertura por
región recomiendas para los próximos 3 años?

Se corre DESPUÉS de techo_mercado.py (usa su salida: salidas/anexo_estados_techo.csv,
en particular la columna "estrategia" -- densificar / alcanzar_nuevo_territorio /
sin_prioridad_clara).

    python scripts/ruta_expansion.py

Lee:
    salidas/anexo_estados_techo.csv        (salida de techo_mercado.py)
    datos/geoespacial/cedis.geojson        (23 CEDIS)
    datos/geoespacial/isocronas_cedis.geojson  (polígonos 30/60/90 min por CEDIS)
    datos/geoespacial/3b.geojson           (red actual, para el disparador de capacidad)
    datos/geoespacial/estados.geojson      (para el cruce de cobertura logística)
    datos/geoespacial/infravial.geojson    (OPCIONAL -- ver nota en cargar_infravial())

Escribe en salidas/:
    fases_expansion.csv        -> las ~1,800 tiendas repartidas en 3 fases, por estado
    disparador_cedis.csv       -> qué CEDIS ya están cerca del límite de 150 tiendas
    resumen_ruta.json          -> cifras nacionales de la ruta

NOTA IMPORTANTE sobre infravial.geojson: la muestra que compartiste solo cubre
el Estado de México (no es un archivo nacional). Esa sección del script está
escrita y comentada, pero yo no pude correrla ni validarla contra el archivo
completo -- avísame si el análisis nacional cambia, porque este script asume
que sí lo es. Si al correrlo el archivo real solo cubre el corredor central,
el bloque de infravial simplemente no aporta nada a los estados de la Fase 3
(lo dice el propio script al correr) y no rompe el resto del cálculo.
"""

import csv
import json
import math
from collections import defaultdict
from pathlib import Path

from shapely.geometry import shape, Point
from shapely.ops import unary_union
from shapely.strtree import STRtree

# ---------------------------------------------------------------------------
# CONFIGURACIÓN
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parents[1]
GEO_DIR = BASE_DIR / "datos" / "geoespacial"
OUT_DIR = BASE_DIR / "salidas"
OUT_DIR.mkdir(exist_ok=True)

# --- Supuestos declarados (Sección 4 del reporte) ---
TIENDAS_POR_CEDIS_PROMEDIO = 150       # dado por el esbozo de trabajo ya validado
DISPARADOR_NUEVO_CEDIS = 0.80          # se evalúa nuevo CEDIS al 80% de esa capacidad (=120 tiendas)
TIENDAS_TOTAL_3_ANIOS = 1800           # 50+/mes x 36 meses, consistente con el punto de partida del caso
REPARTO_FASES = {"año_1": 0.39, "año_2": 0.36, "año_3": 0.25}  # ver justificación en el reporte
INGRESO_PISO_ANIO3 = None  # se calcula como el ingreso promedio nacional dentro de main()

FIX_NOMBRES = {
    "Distrito Federal": "Ciudad de México",
    "M\ufffdxico": "México",
    "Michoac\ufffdn de Ocampo": "Michoacán de Ocampo",
    "Nuevo Le\ufffdn": "Nuevo León",
    "Quer\ufffdtaro": "Querétaro",
    "San Luis Potos\ufffd": "San Luis Potosí",
    "Yucat\ufffdn": "Yucatán",
}


# ---------------------------------------------------------------------------
# 1. DISPARADOR DE NUEVO CEDIS
#    (REPORTE, Sección 4 -- "margen antes de construir CEDIS nuevo")
#    Asigna cada tienda 3B a su CEDIS más cercano (distancia en línea recta,
#    declarado como supuesto: no tenemos un grafo vial nacional para calcular
#    tiempo de manejo real tienda-por-tienda) y ve qué tan cerca está cada
#    CEDIS de su límite de 150 tiendas.
# ---------------------------------------------------------------------------

def haversine_km(lon1, lat1, lon2, lat2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def disparador_cedis():
    with open(GEO_DIR / "cedis.geojson", encoding="utf-8") as f:
        cedis = json.load(f)["features"]
    with open(GEO_DIR / "3b.geojson", encoding="utf-8") as f:
        tiendas = json.load(f)["features"]

    conteo = defaultdict(int)
    for t in tiendas:
        p = t["properties"]
        lon, lat = p["longitud"], p["latitud"]
        mejor, mejor_dist = None, float("inf")
        for c in cedis:
            cp = c["properties"]
            d = haversine_km(lon, lat, cp["Longitud"], cp["Latitud"])
            if d < mejor_dist:
                mejor, mejor_dist = cp["Nombre"], d
        conteo[mejor] += 1

    filas = []
    limite = TIENDAS_POR_CEDIS_PROMEDIO * DISPARADOR_NUEVO_CEDIS
    for c in cedis:
        nombre = c["properties"]["Nombre"]
        n = conteo.get(nombre, 0)
        filas.append({
            "cedis": nombre,
            "tiendas_asignadas": n,
            "pct_de_capacidad": round(n / TIENDAS_POR_CEDIS_PROMEDIO * 100, 1),
            "dispara_nuevo_cedis": n >= limite,
        })
    filas.sort(key=lambda r: r["tiendas_asignadas"], reverse=True)
    return filas


# ---------------------------------------------------------------------------
# 2. COBERTURA LOGÍSTICA ACTUAL
#    ¿Qué entidades ya están, aunque sea parcialmente, dentro de la isócrona
#    de 90 minutos de algún CEDIS existente? Esto separa "Año 2: extender la
#    red actual" de "Año 3: frontera nueva, requiere CEDIS nuevo".
# ---------------------------------------------------------------------------

def cobertura_logistica_por_estado():
    with open(GEO_DIR / "isocronas_cedis.geojson", encoding="utf-8") as f:
        iso = json.load(f)["features"]
    poligonos_90min = [shape(f["geometry"]) for f in iso if f["properties"]["range"] == 5400]
    if not poligonos_90min:
        raise RuntimeError("No se encontraron isócronas de 90 min (range=5400) en isocronas_cedis.geojson")
    cobertura = unary_union(poligonos_90min)

    with open(GEO_DIR / "estados.geojson", encoding="utf-8") as f:
        estados = json.load(f)["features"]

    resultado = {}
    for feat in estados:
        nombre = feat["properties"]["nom_ent"]
        nombre = FIX_NOMBRES.get(nombre, nombre)
        poly = shape(feat["geometry"])
        interseca = poly.intersects(cobertura)
        resultado[nombre] = interseca
    return resultado


# ---------------------------------------------------------------------------
# 3. RED VIAL (infravial.geojson) -- OPCIONAL, ver advertencia al inicio del archivo
# ---------------------------------------------------------------------------

def cargar_infravial():
    """Si datos/geoespacial/infravial.geojson existe, calcula km de carretera
    pavimentada por estado (proxy de infraestructura vial consolidada). Si no
    existe, o si (como en la muestra que compartiste) solo cubre una región,
    esta función lo dice claramente en vez de fallar en silencio."""
    ruta = GEO_DIR / "infravial.geojson"
    if not ruta.exists():
        print("[infravial] Archivo no encontrado en datos/geoespacial/infravial.geojson -- se omite este análisis.")
        return {}

    print("[infravial] Cargando red vial (puede tardar si el archivo es grande)...")
    with open(ruta, encoding="utf-8") as f:
        gj = json.load(f)

    with open(GEO_DIR / "estados.geojson", encoding="utf-8") as f:
        estados = json.load(f)["features"]
    polys = [shape(f["geometry"]) for f in estados]
    nombres = [FIX_NOMBRES.get(f["properties"]["nom_ent"], f["properties"]["nom_ent"]) for f in estados]
    tree = STRtree(polys)

    km_por_estado = defaultdict(float)
    lons_vistos, lats_vistos = [], []
    for feat in gj["features"]:
        geom = shape(feat["geometry"])
        centroide = geom.centroid
        lons_vistos.append(centroide.x)
        lats_vistos.append(centroide.y)
        for idx in tree.query(centroide):
            if polys[idx].contains(centroide):
                # longitud en grados -> km, aproximación esférica simple
                km_por_estado[nombres[idx]] += geom.length * 111.0
                break

    if lons_vistos:
        cobertura_lon = (min(lons_vistos), max(lons_vistos))
        cobertura_lat = (min(lats_vistos), max(lats_vistos))
        print(f"[infravial] Cobertura geográfica del archivo: lon {cobertura_lon}, lat {cobertura_lat}")
        print("[infravial] Si ese rango no cubre el país completo, este dato solo sirve para "
              "evaluar el corredor donde sí hay cobertura -- no lo uses para descartar estados "
              "de la Fase 3 que caigan fuera de ese rango.")
    return dict(km_por_estado)


# ---------------------------------------------------------------------------
# 4. LEER LA SALIDA DE techo_mercado.py Y ARMAR LAS 3 FASES
# ---------------------------------------------------------------------------

def cargar_anexo_techo():
    ruta = OUT_DIR / "anexo_estados_techo.csv"
    if not ruta.exists():
        raise RuntimeError(
            f"No se encontró {ruta}. Corre primero: python scripts/techo_mercado.py"
        )
    with open(ruta, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def armar_fases(tabla, cobertura, km_vial):
    ingresos = [float(r["ingreso_trim_2024"]) for r in tabla if r["ingreso_trim_2024"]]
    ingreso_promedio_nacional = sum(ingresos) / len(ingresos)

    fase1 = [r for r in tabla if r["estrategia"] == "densificar"]
    en_alcance = [r for r in tabla if r["estrategia"] == "alcanzar_nuevo_territorio"
                  and cobertura.get(r["estado"], False)]
    fuera_de_alcance = [r for r in tabla if r["estrategia"] == "alcanzar_nuevo_territorio"
                         and not cobertura.get(r["estado"], False)]

    # Fase 3 -- filtro explícito de "territorio Y bolsillo": solo entran los
    # estados fuera de alcance logístico actual CUYO ingreso ya supera el
    # promedio nacional (si el bolsillo no alcanza, no entra a la ruta de 3 años,
    # aunque el territorio esté libre -- ver Chiapas/Oaxaca en el reporte).
    fase3_candidatos = sorted(
        [r for r in fuera_de_alcance if float(r["ingreso_trim_2024"] or 0) >= ingreso_promedio_nacional],
        key=lambda r: int(r["n_suelo_fertil"]), reverse=True,
    )
    fase3_excluidos_por_bolsillo = sorted(
        [r for r in fuera_de_alcance if float(r["ingreso_trim_2024"] or 0) < ingreso_promedio_nacional],
        key=lambda r: int(r["n_suelo_fertil"]), reverse=True,
    )

    tiendas_fase1 = round(TIENDAS_TOTAL_3_ANIOS * REPARTO_FASES["año_1"])
    tiendas_fase2 = round(TIENDAS_TOTAL_3_ANIOS * REPARTO_FASES["año_2"])
    tiendas_fase3 = TIENDAS_TOTAL_3_ANIOS - tiendas_fase1 - tiendas_fase2

    filas = []
    for r in fase1:
        filas.append({"fase": "Año 1 - Densificar", "estado": r["estado"],
                       "n_3b_actual": r["n_3b"], "n_suelo_fertil": r["n_suelo_fertil"],
                       "ingreso_trim_2024": r["ingreso_trim_2024"], "dentro_isocrona_90min": True})
    for r in en_alcance:
        filas.append({"fase": "Año 2 - Extender dentro de alcance", "estado": r["estado"],
                       "n_3b_actual": r["n_3b"], "n_suelo_fertil": r["n_suelo_fertil"],
                       "ingreso_trim_2024": r["ingreso_trim_2024"], "dentro_isocrona_90min": True})
    for r in fase3_candidatos:
        filas.append({"fase": "Año 3 - Nuevas fronteras", "estado": r["estado"],
                       "n_3b_actual": r["n_3b"], "n_suelo_fertil": r["n_suelo_fertil"],
                       "ingreso_trim_2024": r["ingreso_trim_2024"], "dentro_isocrona_90min": False})
    for r in fase3_excluidos_por_bolsillo:
        filas.append({"fase": "Fuera del plan de 3 años (bolsillo insuficiente)", "estado": r["estado"],
                       "n_3b_actual": r["n_3b"], "n_suelo_fertil": r["n_suelo_fertil"],
                       "ingreso_trim_2024": r["ingreso_trim_2024"], "dentro_isocrona_90min": False})

    resumen = {
        "ingreso_promedio_nacional_referencia": ingreso_promedio_nacional,
        "estados_fase1_densificar": [r["estado"] for r in fase1],
        "estados_fase2_extender": [r["estado"] for r in en_alcance],
        "estados_fase3_nuevas_fronteras": [r["estado"] for r in fase3_candidatos],
        "estados_excluidos_por_bolsillo": [r["estado"] for r in fase3_excluidos_por_bolsillo],
        "tiendas_planeadas_anio1": tiendas_fase1,
        "tiendas_planeadas_anio2": tiendas_fase2,
        "tiendas_planeadas_anio3": tiendas_fase3,
        "tiendas_total_3_anios": TIENDAS_TOTAL_3_ANIOS,
    }
    return filas, resumen


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    print("=== Disparador de nuevo CEDIS ===")
    filas_cedis = disparador_cedis()
    for f in filas_cedis[:8]:
        print(f"  {f['cedis']:30s} {f['tiendas_asignadas']:4d} tiendas "
              f"({f['pct_de_capacidad']:5.1f}% de 150) "
              f"{'<-- evaluar CEDIS nuevo' if f['dispara_nuevo_cedis'] else ''}")
    with open(OUT_DIR / "disparador_cedis.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["cedis", "tiendas_asignadas", "pct_de_capacidad", "dispara_nuevo_cedis"])
        w.writeheader()
        w.writerows(filas_cedis)
    print(f"Escrito: {OUT_DIR / 'disparador_cedis.csv'}")

    print("\n=== Cobertura logística actual (isócrona 90 min) por estado ===")
    cobertura = cobertura_logistica_por_estado()
    for estado, cubierto in cobertura.items():
        marca = "SI" if cubierto else "no"
        print(f"  {estado:30s} {marca}")

    print("\n=== Red vial (infravial.geojson) ===")
    km_vial = cargar_infravial()

    print("\n=== Armando las 3 fases (usa la salida de techo_mercado.py) ===")
    tabla = cargar_anexo_techo()
    filas_fases, resumen = armar_fases(tabla, cobertura, km_vial)
    print(json.dumps(resumen, indent=2, ensure_ascii=False))

    with open(OUT_DIR / "fases_expansion.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["fase", "estado", "n_3b_actual", "n_suelo_fertil",
                                           "ingreso_trim_2024", "dentro_isocrona_90min"])
        w.writeheader()
        w.writerows(filas_fases)
    print(f"Escrito: {OUT_DIR / 'fases_expansion.csv'}")

    with open(OUT_DIR / "resumen_ruta.json", "w", encoding="utf-8") as f:
        json.dump(resumen, f, indent=2, ensure_ascii=False)
    print(f"Escrito: {OUT_DIR / 'resumen_ruta.json'}")


if __name__ == "__main__":
    main()
