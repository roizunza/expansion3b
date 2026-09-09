"""
techo_mercado.py
=================
Pregunta 1 del caso: ¿cuántas tiendas 3B puede sostener México?

Se corre desde la raíz del proyecto:
    python scripts/techo_mercado.py

Lee (rutas relativas a la raíz del proyecto, según tu árbol de archivos):
    datos/geoespacial/3b.geojson
    datos/geoespacial/competencia.geojson      (giros SCIAN 462111 y 462112)
    datos/geoespacial/tiendas.geojson          (giro SCIAN 461110 -- ESTE es el archivo
                                                 que tú llamas "demanda_tienditas":
                                                 682,918 puntos de abarrotes/misceláneas
                                                 independientes a nivel nacional)
    datos/geoespacial/estados.geojson
    datos/raw/POBLACION.xlsx                   (Censo 2020, hoja "04": población total
                                                 por entidad)
    datos/raw/ENIGH.xlsx                       (Cuadro 2.1: ingreso y Gini por entidad;
                                                 Cuadro 4.5: gasto en alimentos por hogar)

Escribe en salidas/:
    anexo_estados_techo.csv       -> tabla completa de las 32 entidades (Anexo del reporte)
    anexo_estados_techo.geojson   -> mismo anexo pero con geometría, para mapear en QGIS
    resumen_techo.json            -> las cifras nacionales que van directo al reporte

Cada bloque de código está comentado con el número de sección del reporte
("REPORTE 2.1", "REPORTE 2.2", etc.) al que alimenta, para que puedas ir del
texto de la metodología al cálculo exacto que lo sostiene.
"""

import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

from shapely.geometry import shape, Point
from shapely.strtree import STRtree
from openpyxl import load_workbook

# ---------------------------------------------------------------------------
# CONFIGURACIÓN — rutas y parámetros ajustables
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parents[1]
GEO_DIR = BASE_DIR / "datos" / "geoespacial"
RAW_DIR = BASE_DIR / "datos" / "raw"
OUT_DIR = BASE_DIR / "salidas"
OUT_DIR.mkdir(exist_ok=True)

# --- Supuestos declarados (Sección 4 del reporte). Cambialos aquí, no en el código. ---
PARTICIPACION_3B_MIN = 0.15   # participación objetivo de 3B del espacio libre organizado
PARTICIPACION_3B_MAX = 0.20   # (banda; ver REPORTE 2.1 -> "Participación objetivo")
UMBRAL_INGRESO = "mediana"    # "mediana" o "media" -- criterio para elegir el benchmark de saturación

# Estimador económico (REPORTE 2.2) -- variables de sensibilidad, NO datos de 3B:
CARTERA_CANAL_ESCENARIOS = {"conservador": 0.08, "medio": 0.11, "optimista": 0.14}
PARTICIPACION_3B_CANAL_ESCENARIOS = {"conservador": 0.15, "medio": 0.175, "optimista": 0.20}
# Venta anual por tienda construida de abajo hacia arriba (ticket x transacciones x 365).
# Sustituye estos dos parámetros por los reales de la compañía en cuanto los tengas.
TICKET_PROMEDIO_MXN = 90          # pesos por transacción -- PLACEHOLDER, ajustar
TRANSACCIONES_PROMEDIO_DIA = 350  # transacciones por tienda por día -- PLACEHOLDER, ajustar
VENTA_ANUAL_POR_TIENDA = TICKET_PROMEDIO_MXN * TRANSACCIONES_PROMEDIO_DIA * 365

# Marcas reconocidas dentro del giro 462112 (coincidencia de nombre comercial).
# Círculo K / Circle K incluida a pedido explícito.
MARCAS_RECONOCIDAS = {
    "OXXO": r"\bOXXO\b",
    "7-ELEVEN": r"7[\s-]?ELEVEN",
    "CIRCLE_CIRCULO_K": r"CIRC(LE|ULO)\s?K",
    "TRES_B": r"\bTRES\s?B\b|\b3\s?B\b",
    "WALDOS": r"\bWALDO",
    "NETO": r"\bNETO\b",
    "BA_EXPRESS": r"BA\s?EXPRESS|BODEGA\s?AU?R?RE?RA\s?EXPRESS",
}

# Nombres de estados corruptos en el propio estados.geojson (el archivo fuente trae
# el carácter de reemplazo Unicode donde debería ir una vocal acentuada). Se corrige
# aquí una sola vez para que el resto del script no tenga que lidiar con esto.
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
# 1. CRUCE ESPACIAL — asignar cada punto (3B, competencia, tiendas de barrio)
#    a su entidad federativa mediante punto-en-polígono.
#    Esto sostiene TODO el Anexo del reporte (tabla de 32 entidades).
# ---------------------------------------------------------------------------

def cargar_estados():
    """Devuelve (lista_de_poligonos, lista_de_nombres_corregidos)."""
    with open(GEO_DIR / "estados.geojson", encoding="utf-8") as f:
        gj = json.load(f)
    polys, nombres = [], []
    for feat in gj["features"]:
        polys.append(shape(feat["geometry"]))
        nombre = feat["properties"]["nom_ent"]
        nombres.append(FIX_NOMBRES.get(nombre, nombre))
    return polys, nombres


def construir_asignador(polys):
    tree = STRtree(polys)

    def asignar(lon, lat):
        pt = Point(lon, lat)
        for idx in tree.query(pt):
            if polys[idx].contains(pt) or polys[idx].intersects(pt):
                return idx
        return None

    return asignar


def clasificar_marca(nom_estab):
    """Para un punto del giro 462112: ¿a qué cadena reconocida pertenece?
    Devuelve el nombre de la marca, o 'INDEPENDIENTE' si no hace match con
    ninguna cadena conocida (minisúper/misceláneo sin bandera, registrado
    bajo el mismo giro que las tiendas de conveniencia)."""
    nu = (nom_estab or "").upper()
    for marca, patron in MARCAS_RECONOCIDAS.items():
        if re.search(patron, nu):
            return marca
    return "INDEPENDIENTE"


def procesar_geoespacial():
    print("Cargando estados.geojson y construyendo índice espacial...")
    polys, nombres = cargar_estados()
    asignar = construir_asignador(polys)

    counts = defaultdict(lambda: defaultdict(int))

    # --- 3b.geojson: red propia actual ---------------------------------
    print("Procesando 3b.geojson (red propia)...")
    with open(GEO_DIR / "3b.geojson", encoding="utf-8") as f:
        d3b = json.load(f)
    sin_asignar = 0
    for feat in d3b["features"]:
        p = feat["properties"]
        idx = asignar(p["longitud"], p["latitud"])
        if idx is None:
            sin_asignar += 1
            continue
        counts[nombres[idx]]["n_3b"] += 1
    print(f"  {len(d3b['features'])} tiendas 3B procesadas, {sin_asignar} sin asignar")

    # --- competencia.geojson: giros 462111 (autoservicio) y 462112 (conveniencia) ---
    print("Procesando competencia.geojson (esto tarda un par de minutos)...")
    with open(GEO_DIR / "competencia.geojson", encoding="utf-8") as f:
        comp = json.load(f)
    sin_asignar = 0
    for feat in comp["features"]:
        p = feat["properties"]
        idx = asignar(p["longitud"], p["latitud"])
        if idx is None:
            sin_asignar += 1
            continue
        nombre = nombres[idx]
        if p["codigo_act"] == 462111:
            counts[nombre]["n_autoservicio"] += 1
        else:  # 462112
            marca = clasificar_marca(p.get("nom_estab"))
            counts[nombre]["n_conveniencia_total"] += 1
            if marca == "INDEPENDIENTE":
                counts[nombre]["n_conveniencia_sin_marca"] += 1
            elif marca == "TRES_B":
                counts[nombre]["n_3b_en_competencia"] += 1  # cruce de validación contra 3b.geojson
            else:
                counts[nombre]["n_cadena_organizada"] += 1
    print(f"  {len(comp['features'])} puntos de competencia procesados, {sin_asignar} sin asignar")

    # --- tiendas.geojson: giro 461110 -- ESTE es el "suelo fértil" nacional ---
    # (el archivo que tú llamas demanda_tienditas: 682,918 abarrotes/misceláneas
    # independientes, cobertura nacional confirmada). No se trata como
    # competencia: se trata como demanda ya validada por el mercado que la
    # organización todavía no capta (ver REPORTE, sección "Implementación").
    print("Procesando tiendas.geojson / demanda_tienditas -- 682,918 puntos, tarda varios minutos...")
    with open(GEO_DIR / "tiendas.geojson", encoding="utf-8") as f:
        tnd = json.load(f)
    sin_asignar = 0
    for feat in tnd["features"]:
        p = feat["properties"]
        idx = asignar(p["longitud"], p["latitud"])
        if idx is None:
            sin_asignar += 1
            continue
        counts[nombres[idx]]["n_suelo_fertil"] += 1
    print(f"  {len(tnd['features'])} tiendas de barrio procesadas, {sin_asignar} sin asignar")

    return counts, polys, nombres


# ---------------------------------------------------------------------------
# 2. POBLACIÓN E INGRESO POR ENTIDAD
#    Sostiene: REPORTE 2.1 (denominador de todos los ratios) y REPORTE 2.2
#    (deciles de ingreso / Gini).
# ---------------------------------------------------------------------------

def cargar_poblacion():
    wb = load_workbook(RAW_DIR / "POBLACION.xlsx", read_only=True, data_only=True)
    ws = wb["04"]  # tabla "Población total por entidad federativa"
    pob = {}
    for row in ws.iter_rows(values_only=True):
        if not row or not row[0] or not isinstance(row[0], str):
            continue
        etiqueta = row[0].strip()
        if etiqueta.startswith("Estados Unidos"):
            continue
        # el formato es "01 Aguascalientes" ... separamos el código del nombre
        partes = etiqueta.split(" ", 1)
        if len(partes) != 2 or not partes[0].isdigit():
            continue
        nombre = partes[1].strip()
        poblacion = row[1]
        if isinstance(poblacion, (int, float)):
            pob[FIX_NOMBRES.get(nombre, nombre)] = int(poblacion)
    return pob


def cargar_poblacion_urbana():
    """Población urbana (localidades >= 2,500 habitantes) POR ESTADO, calculada
    sumando las bandas de tamaño de localidad de la tabla '01' de POBLACION.xlsx.
    Esto reemplaza el supuesto plano de "80% urbano a nivel nacional" del reporte
    anterior por un dato real y desagregado por entidad -- exactamente lo que
    sostiene el "Se usa población urbana... porque el formato depende de una
    densidad de tránsito de corto radio" de la metodología (REPORTE 2.1)."""
    wb = load_workbook(RAW_DIR / "POBLACION.xlsx", read_only=True, data_only=True)
    ws = wb["01"]
    urbana = {}
    for row in ws.iter_rows(values_only=True):
        if not row or not isinstance(row[0], str) or row[1] != "Población":
            continue
        etiqueta = row[0].strip()
        if etiqueta.startswith("Estados Unidos"):
            continue
        partes = etiqueta.split(" ", 1)
        if len(partes) != 2 or not partes[0].isdigit():
            continue
        nombre = FIX_NOMBRES.get(partes[1].strip(), partes[1].strip())
        # columnas 7 a 16 = bandas de 2,500 habitantes en adelante (ver cabecera
        # real del archivo: '2 500-4 999' ... '1 000 000 y más')
        bandas_urbanas = row[7:17]
        urbana[nombre] = sum(v for v in bandas_urbanas if isinstance(v, (int, float)))
    return urbana


def normalizar(nombre):
    """Quita acentos y mayúsculas para poder cruzar nombres de estado que vienen
    escritos distinto en cada archivo fuente (ENIGH viene TODO EN MAYÚSCULAS,
    POBLACION viene con formato "Título", estados.geojson trae algunos nombres
    corruptos que ya arreglamos arriba)."""
    s = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode("ascii")
    return s.upper().strip()


def cargar_enigh():
    """Devuelve dict: NOMBRE_EN_MAYUSCULAS_SIN_ACENTOS -> {ingreso_trim_2024, gini_2024}.
    Se cruza contra el nombre canónico de POBLACION.xlsx en main() usando normalizar()."""
    wb = load_workbook(RAW_DIR / "ENIGH.xlsx", read_only=True, data_only=True)
    ws = wb["Cuadro 2.1"]
    decile_labels = {"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"}
    resultado, current_state, current = {}, None, {}

    def ultimo_numero(fields):
        for v in reversed(fields):
            v = (v or "").strip() if isinstance(v, str) else v
            if v not in (None, ""):
                try:
                    return float(v)
                except (TypeError, ValueError):
                    return None
        return None

    for row in ws.iter_rows(values_only=True):
        if not row or all(v is None for v in row):
            continue
        if not isinstance(row[0], str):
            continue
        etiqueta = row[0].strip()
        if etiqueta.startswith("INEGI") or etiqueta.startswith("ENTIDAD FEDERATIVA"):
            continue
        if etiqueta in decile_labels:
            continue  # no usamos los deciles individuales en este script
        if "GINI" in etiqueta.upper():
            current["gini_2024"] = ultimo_numero(row[1:])
            if current_state:
                resultado[normalizar(current_state)] = current
            current_state, current = None, {}
            continue
        # nueva fila de estado (o "NACIONAL")
        current_state = etiqueta
        current = {"ingreso_trim_2024": ultimo_numero(row[1:])}
    return resultado


def cargar_gasto_alimentos_nacional():
    """REPORTE 2.2 -- gasto monetario NACIONAL trimestral en alimentos/bebidas/tabaco.

    OJO con la forma real del Cuadro 4.5: NO es una tabla ancha con columnas por
    año (a diferencia del Cuadro 2.1). Es un bloque por entidad: una fila "TOTAL"
    (=nombre de la entidad, o "NACIONAL") seguida de 9 filas, una por cada gran
    rubro del gasto (alimentos, vestido, vivienda, etc.). La columna 2 (tercer
    valor de la fila, después del nombre y una celda vacía) trae el monto total
    trimestral en MILES de pesos; la columna 4 trae el promedio por hogar.
    Aquí tomamos el bloque de "NACIONAL" (las primeras filas del cuadro, antes
    de que empiece "AGUASCALIENTES") y dentro de ese bloque la fila
    "ALIMENTOS, BEBIDAS Y TABACO"."""
    wb = load_workbook(RAW_DIR / "ENIGH.xlsx", read_only=True, data_only=True)
    ws = wb["Cuadro 4.5"]
    vimos_nacional = False
    for row in ws.iter_rows(values_only=True):
        if not row or not isinstance(row[0], str):
            continue
        etiqueta = row[0].strip().upper()
        if etiqueta == "NACIONAL":
            vimos_nacional = True
            continue
        # La fila de "ALIMENTOS, BEBIDAS Y TABACO" que sigue inmediatamente
        # después de "NACIONAL" es la que necesitamos; las demás entidades
        # (Aguascalientes, Baja California, ...) también tienen una fila con
        # esa misma etiqueta más abajo en el archivo, por eso el guardado de
        # `vimos_nacional` importa: solo tomamos la PRIMERA que aparece.
        if vimos_nacional and etiqueta.startswith("ALIMENTOS, BEBIDAS Y TABACO"):
            monto_miles_pesos = row[2]
            return monto_miles_pesos * 1000  # miles de pesos -> pesos
    raise RuntimeError(
        "No se encontró 'ALIMENTOS, BEBIDAS Y TABACO' dentro del bloque NACIONAL "
        "de Cuadro 4.5 en ENIGH.xlsx -- revisa si INEGI cambió el formato del cuadro."
    )


# ---------------------------------------------------------------------------
# 3. ESTIMADOR A -- TERRITORIAL (REPORTE 2.1)
# ---------------------------------------------------------------------------

def estimador_territorial(tabla):
    """tabla: lista de dicts por estado con población, n_3b, n_organizado, etc.
    Devuelve (tabla_enriquecida, resumen_nacional)."""

    ingresos = [r["ingreso_trim_2024"] for r in tabla if r.get("ingreso_trim_2024")]
    ratios = [r["ratio_organizado"] for r in tabla if r.get("ratio_organizado")]

    # REPORTE 2.1 -- "se imprime en el reporte: mín/máx/promedio de ingreso y de ratio"
    resumen_descriptivo = {
        "ingreso_min": min(ingresos), "ingreso_max": max(ingresos),
        "ingreso_promedio": sum(ingresos) / len(ingresos),
        "ratio_min": min(ratios), "ratio_max": max(ratios),
        "ratio_promedio": sum(ratios) / len(ratios),
    }

    # Benchmark de saturación, elegido por regla reproducible (no a dedo):
    # de las entidades con ingreso >= mediana/media nacional, la de MENOR ratio
    # (mercado más denso y ya organizado) se toma como referencia de saturación.
    corte = (sorted(ingresos)[len(ingresos) // 2] if UMBRAL_INGRESO == "mediana"
             else sum(ingresos) / len(ingresos))
    candidatas = [r for r in tabla if r.get("ingreso_trim_2024", 0) >= corte and r.get("ratio_organizado")]
    benchmark = min(candidatas, key=lambda r: r["ratio_organizado"])

    # Se usa población URBANA nacional (suma de las 32 entidades), no población
    # total, por la misma razón declarada en el reporte: el formato de
    # proximidad depende de densidad de tránsito de corto radio.
    poblacion_urbana_nacional = sum(r["poblacion_urbana"] for r in tabla if r.get("poblacion_urbana"))
    poblacion_total_nacional = sum(r["poblacion"] for r in tabla if r.get("poblacion"))
    organizado_nacional = sum(r["n_organizado"] for r in tabla)
    total_teorico = poblacion_urbana_nacional / benchmark["ratio_organizado"]
    espacio_libre = total_teorico - organizado_nacional

    # Participación objetivo de 3B: promedio de su participación real en los
    # mercados donde YA es fuerte (más de 50 tiendas), no un número inventado.
    mercados_maduros = [r for r in tabla if r["n_3b"] >= 50 and r["n_organizado"] > 0]
    participaciones_reales = [r["n_3b"] / r["n_organizado"] for r in mercados_maduros]
    participacion_observada = sum(participaciones_reales) / len(participaciones_reales)

    incremental_min = espacio_libre * PARTICIPACION_3B_MIN
    incremental_max = espacio_libre * PARTICIPACION_3B_MAX
    red_actual = sum(r["n_3b"] for r in tabla)

    resumen_territorial = {
        "benchmark_estado": benchmark["estado"],
        "benchmark_ratio": benchmark["ratio_organizado"],
        "poblacion_total_nacional": poblacion_total_nacional,
        "poblacion_urbana_nacional": poblacion_urbana_nacional,
        "tasa_urbanizacion_calculada": poblacion_urbana_nacional / poblacion_total_nacional,
        "organizado_nacional_actual": organizado_nacional,
        "total_teorico_saturacion": total_teorico,
        "espacio_libre_nacional": espacio_libre,
        "participacion_3b_observada_mercados_maduros": participacion_observada,
        "participacion_3b_usada_min": PARTICIPACION_3B_MIN,
        "participacion_3b_usada_max": PARTICIPACION_3B_MAX,
        "red_actual": red_actual,
        "techo_territorial_min": red_actual + incremental_min,
        "techo_territorial_max": red_actual + incremental_max,
    }
    return resumen_descriptivo, resumen_territorial


# ---------------------------------------------------------------------------
# 4. ESTIMADOR B -- ECONÓMICO (REPORTE 2.2)
# ---------------------------------------------------------------------------

def estimador_economico(gasto_alimentos_nacional_anual):
    filas = []
    for escenario in ("conservador", "medio", "optimista"):
        cartera = CARTERA_CANAL_ESCENARIOS[escenario]
        participacion = PARTICIPACION_3B_CANAL_ESCENARIOS[escenario]
        gasto_direccionable = gasto_alimentos_nacional_anual * cartera * participacion
        tiendas_sostenidas = gasto_direccionable / VENTA_ANUAL_POR_TIENDA
        filas.append({
            "escenario": escenario,
            "cartera_canal": cartera,
            "participacion_3b": participacion,
            "gasto_direccionable_3b_anual": gasto_direccionable,
            "venta_anual_por_tienda_supuesta": VENTA_ANUAL_POR_TIENDA,
            "tiendas_sostenidas": tiendas_sostenidas,
        })
    return filas


# ---------------------------------------------------------------------------
# 5. CLASIFICACIÓN POR ESTADO: ¿DENSIFICAR O ALCANZAR NUEVO TERRITORIO?
#    (REPORTE 2.3 -- "Lectura regional")
# ---------------------------------------------------------------------------

def clasificar_estrategia(tabla):
    poblacion_nacional = sum(r["poblacion"] for r in tabla)
    red_nacional = sum(r["n_3b"] for r in tabla)
    densidad_3b_nacional = red_nacional / poblacion_nacional  # tiendas 3B por habitante, promedio país

    ratios = sorted(r["ratio_organizado"] for r in tabla if r.get("ratio_organizado"))
    mediana_ratio = ratios[len(ratios) // 2]

    for r in tabla:
        densidad_3b_estado = r["n_3b"] / r["poblacion"] if r["poblacion"] else 0
        presencia_relevante = densidad_3b_estado >= densidad_3b_nacional
        espacio_disponible = (r.get("ratio_organizado") or 0) >= mediana_ratio
        if presencia_relevante:
            r["estrategia"] = "densificar"
        elif espacio_disponible:
            r["estrategia"] = "alcanzar_nuevo_territorio"
        else:
            r["estrategia"] = "sin_prioridad_clara"  # ni presencia fuerte ni espacio de sobra
    conteo = defaultdict(int)
    for r in tabla:
        conteo[r["estrategia"]] += 1
    return dict(conteo)


# ---------------------------------------------------------------------------
# 6. EXPORTAR ANEXOS (CSV + GeoJSON) -- Sección "Anexo" del reporte
# ---------------------------------------------------------------------------

def exportar(tabla, polys, nombres):
    campos = [
        "estado", "poblacion", "poblacion_urbana", "n_3b", "n_autoservicio", "n_conveniencia_total",
        "n_cadena_organizada", "n_conveniencia_sin_marca", "n_organizado",
        "n_suelo_fertil", "ratio_organizado", "ingreso_trim_2024", "gini_2024",
        "estrategia",
    ]
    import csv
    with open(OUT_DIR / "anexo_estados_techo.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        for r in sorted(tabla, key=lambda x: x.get("ratio_organizado") or 0, reverse=True):
            w.writerow({k: r.get(k, "") for k in campos})
    print(f"Escrito: {OUT_DIR / 'anexo_estados_techo.csv'}")

    # GeoJSON para mapear en QGIS: geometría del estado + los mismos atributos
    nombre_a_datos = {r["estado"]: r for r in tabla}
    features = []
    for poly, nombre in zip(polys, nombres):
        datos = nombre_a_datos.get(nombre, {})
        features.append({
            "type": "Feature",
            "geometry": json.loads(json.dumps(shape(poly).__geo_interface__)),
            "properties": {k: datos.get(k) for k in campos},
        })
    with open(OUT_DIR / "anexo_estados_techo.geojson", "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False)
    print(f"Escrito: {OUT_DIR / 'anexo_estados_techo.geojson'}")


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    counts, polys, nombres = procesar_geoespacial()
    poblacion = cargar_poblacion()
    poblacion_urbana = cargar_poblacion_urbana()
    enigh = cargar_enigh()
    # ENIGH viene en MAYÚSCULAS SIN ACENTOS; lo cruzamos por nombre normalizado
    # contra el nombre canónico que usa POBLACION.xlsx (y por tanto todo el resto
    # de la tabla).
    enigh_por_normalizado = enigh  # ya viene indexado por normalizar(nombre)

    tabla = []
    for nombre in set(nombres):
        c = counts.get(nombre, {})
        n_conv = c.get("n_conveniencia_total", 0)
        n_indep = c.get("n_conveniencia_sin_marca", 0)
        n_organizado = n_conv - n_indep  # cadenas reconocidas + 3B; excluye informal
        pob = poblacion.get(nombre)
        pob_urbana = poblacion_urbana.get(nombre)
        ing = enigh_por_normalizado.get(normalizar(nombre), {})
        fila = {
            "estado": nombre,
            "poblacion": pob,
            "poblacion_urbana": pob_urbana,
            "n_3b": c.get("n_3b", 0),
            "n_autoservicio": c.get("n_autoservicio", 0),
            "n_conveniencia_total": n_conv,
            "n_cadena_organizada": c.get("n_cadena_organizada", 0),
            "n_conveniencia_sin_marca": n_indep,
            "n_organizado": n_organizado,
            "n_suelo_fertil": c.get("n_suelo_fertil", 0),  # <- de tiendas.geojson (461110)
            # ratio_organizado usa POBLACIÓN URBANA como denominador (ver
            # cargar_poblacion_urbana): el formato de proximidad no compite por
            # población rural dispersa.
            "ratio_organizado": (pob_urbana / n_organizado) if pob_urbana and n_organizado else None,
            "ingreso_trim_2024": ing.get("ingreso_trim_2024"),
            "gini_2024": ing.get("gini_2024"),
        }
        tabla.append(fila)

    print("\n=== REPORTE 2.1 -- Estimador territorial ===")
    descriptivo, territorial = estimador_territorial(tabla)
    print(json.dumps(descriptivo, indent=2, ensure_ascii=False))
    print(json.dumps(territorial, indent=2, ensure_ascii=False))

    print("\n=== REPORTE 2.2 -- Estimador económico ===")
    gasto_nacional_anual = cargar_gasto_alimentos_nacional() * 4  # trimestral -> anual
    print(f"Gasto nacional anual en alimentos/bebidas/tabaco: ${gasto_nacional_anual:,.0f} MXN")
    economico = estimador_economico(gasto_nacional_anual)
    for fila in economico:
        print(json.dumps(fila, indent=2, ensure_ascii=False))

    print("\n=== REPORTE 2.3 -- Densificar vs. alcanzar nuevo territorio ===")
    conteo_estrategia = clasificar_estrategia(tabla)
    print(json.dumps(conteo_estrategia, indent=2, ensure_ascii=False))

    exportar(tabla, polys, nombres)

    resumen = {
        "descriptivo_nacional": descriptivo,
        "estimador_territorial": territorial,
        "estimador_economico": economico,
        "gasto_alimentos_nacional_anual": gasto_nacional_anual,
        "conteo_estrategia_por_estado": conteo_estrategia,
    }
    with open(OUT_DIR / "resumen_techo.json", "w", encoding="utf-8") as f:
        json.dump(resumen, f, indent=2, ensure_ascii=False)
    print(f"\nEscrito: {OUT_DIR / 'resumen_techo.json'}")


if __name__ == "__main__":
    main()
