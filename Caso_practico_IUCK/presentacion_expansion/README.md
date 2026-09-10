# Estrategia de Expansión 3B: Techo de Mercado y Ruta Logística

## 1. El propósito del análisis realizado
Este proyecto tiene como objetivo determinar el techo teórico del mercado para la cadena de tiendas 3B en México y establecer una ruta táctica de apertura para 1,800 nuevas unidades a tres años. El análisis cruza variables físicas (territorio y densidad poblacional) con limitantes económicas (ingreso y participación de cartera) para encontrar la capacidad máxima rentable. Posteriormente, aplica una restricción de infraestructura logística (isócronas de 90 minutos desde CEDIS operativos) para priorizar las zonas de densificación, extensión y apertura de nuevas fronteras.

## 2. La estructura del proyecto y organización de los archivos
El repositorio se divide en dos grandes bloques: el procesamiento backend de datos geoespaciales y el frontend del dashboard de presentación.

*   `datos/`: Contiene los insumos crudos.
    *   `geoespacial/`: Archivos base (tiendas 3B, competencia, demanda de abarrotes, CEDIS e isócronas).
    *   `raw/`: Matrices de origen (ENIGH y Censo INEGI).
*   `scripts/`: Algoritmos de procesamiento en Python.
    *   `techo_mercado.py`: Cruza las variables de población y gasto para estimar la capacidad.
    *   `ruta_expansion.py`: Filtra la capacidad a través de la restricción logística de los CEDIS.
*   `salidas/`: Archivos procesados (`.csv` y `.geojson`) que alimentan el visor.
*   `presentacion_expansion/`: Aplicación frontend en React y Vite que renderiza el dashboard interactivo, los mapas con Leaflet y las gráficas con Chart.js.

## 3. Ejemplos de gráficos e insights obtenidos
*   **Viabilidad de Expansión:** El análisis demuestra que el mercado nacional puede sostener un techo de entre 5,500 y 6,600 tiendas. Alcanzar las 4,800 unidades operativas en tres años solo representa un 72.6% a 86.8% de saturación.
*   **Filtro Logístico vs. Económico:** Se identificó que zonas con gran disponibilidad territorial (como Chiapas o Nayarit) están restringidas por el ingreso, mientras que la frontera norte presenta limitaciones por la alta saturación de cadenas organizadas actuales.
*   **Ruta Táctica:** El modelo dicta una apertura de 702 tiendas en el Año 1 enfocadas en densificar el centro del país para aprovechar la infraestructura actual, limitando las "Nuevas Fronteras" (Yucatán y Colima) al Año 3 para dar tiempo a la construcción de nuevos CEDIS.
*   **Visualización Espacial:** El dashboard incluye geovisores que permiten mapear la estrategia estado por estado y visualizar la huella logística de 90 minutos en relación con los puntos de venta actuales.

## 4. Instrucciones para ejecutar el proyecto

### Procesamiento de Datos (Python)
Para recalcular el modelo completo o actualizar las variables de sensibilidad (como el ticket promedio), ejecuta los scripts desde la raíz del proyecto en este orden estricto:

```bash
python scripts/techo_mercado.py
python scripts/ruta_expansion.py