import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

export default function App() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [map1Filter, setMap1Filter] = useState('estrategia');
  const [hoveredState, setHoveredState] = useState(null); // Nuevo estado para el panel del mapa 1
  
  const totalSlides = 8;
  const map1Ref = useRef(null);
  const map2Ref = useRef(null);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  
  const geojsonData = useRef({ estados: null });
  
  const layersRef = useRef({
    estadosGroup: null,
    cedis: null,
    isocronas: null,
    tiendas: null,
    roads: null
  });

  // 1. Navegación por teclado
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight' && currentSlide < totalSlides - 1) setCurrentSlide(prev => prev + 1);
      if (e.key === 'ArrowLeft' && currentSlide > 0) setCurrentSlide(prev => prev - 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentSlide]);

  // 2. Inicialización de Mapas y Capas
  useEffect(() => {
    // Mapa 1
    if (!map1Ref.current) {
      map1Ref.current = L.map('map1', { zoomControl: false }).setView([23.5, -102.5], 5);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri'
      }).addTo(map1Ref.current);
      
      layersRef.current.estadosGroup = L.layerGroup().addTo(map1Ref.current);
    }
    
    // Mapa 2
    if (!map2Ref.current) {
      map2Ref.current = L.map('map2', { zoomControl: false }).setView([19.5, -99.0], 6);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri'
      }).addTo(map2Ref.current);
      
      map2Ref.current.createPane('isocronasPane');
      map2Ref.current.getPane('isocronasPane').style.zIndex = 400; 
      
      map2Ref.current.createPane('tiendasPane');
      map2Ref.current.getPane('tiendasPane').style.zIndex = 410; 
      
      map2Ref.current.createPane('cedisPane');
      map2Ref.current.getPane('cedisPane').style.zIndex = 420; 

      layersRef.current.roads = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { opacity: 0.35 });
      layersRef.current.roads.addTo(map2Ref.current);
      
      layersRef.current.isocronas = L.layerGroup().addTo(map2Ref.current);
      layersRef.current.tiendas = L.layerGroup().addTo(map2Ref.current); 
      layersRef.current.cedis = L.layerGroup().addTo(map2Ref.current);
    }
    
    if (currentSlide === 4) setTimeout(() => map1Ref.current?.invalidateSize(), 300);
    if (currentSlide === 5) setTimeout(() => map2Ref.current?.invalidateSize(), 300);
  }, [currentSlide]);

  // Renderizado interactivo del Mapa 1
  const renderMap1 = (filter) => {
    if (!layersRef.current.estadosGroup || !geojsonData.current.estados) return;
    layersRef.current.estadosGroup.clearLayers();

    let geoJsonLayer;
    geoJsonLayer = L.geoJSON(geojsonData.current.estados, {
      style: (f) => {
        const prop = f.properties;
        if (filter === 'estrategia') {
          const est = (prop.estrategia || '').toLowerCase();
          let color = '#CBD5E0'; 
          if (est.includes('densificar')) color = '#3182CE'; 
          else if (est.includes('extender')) color = '#38A169'; 
          else if (est.includes('frontera') || est.includes('alcanzar')) color = '#E2231A'; 
          return { fillColor: color, color: '#FFF', weight: 1, fillOpacity: 0.75 };
        } else {
          const val = prop.n_suelo_fertil || prop.ratio_organizado || 0;
          let opac = val > 15000 ? 0.8 : val > 5000 ? 0.5 : 0.2;
          return { fillColor: '#3182CE', color: '#FFF', weight: 1, fillOpacity: opac };
        }
      },
      onEachFeature: (f, layer) => {
        layer.on({
          mouseover: (e) => {
            const l = e.target;
            l.setStyle({ weight: 3, color: '#2D3748', fillOpacity: 0.9 });
            setHoveredState(f.properties);
          },
          mouseout: (e) => {
            if (geoJsonLayer) geoJsonLayer.resetStyle(e.target);
            setHoveredState(null);
          }
        });
      }
    });
    
    layersRef.current.estadosGroup.addLayer(geoJsonLayer);
  };

  useEffect(() => {
    renderMap1(map1Filter);
  }, [map1Filter]);

  // 3. Carga de Datos GeoJSON
  useEffect(() => {
    const loadData = async () => {
      try {
        const resEstados = await fetch('/salidas/anexo_estados_techo.geojson');
        if (resEstados.ok) {
          geojsonData.current.estados = await resEstados.json();
          renderMap1(map1Filter); 
        }

        const [cedisRes, isocronasRes, tiendasRes] = await Promise.all([
          fetch('/datos/geoespacial/cedis.geojson'),
          fetch('/datos/geoespacial/isocronas_cedis.geojson'),
          fetch('/datos/geoespacial/3b.geojson')
        ]);
        
        if (cedisRes.ok) {
          const cedisData = await cedisRes.json();
          L.geoJSON(cedisData, {
            // Diseño CEDIS: Guinda oscuro, borde blanco, hasta arriba
            pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 7, fillColor: '#800020', color: '#FFF', weight: 2, fillOpacity: 1, pane: 'cedisPane' })
          }).addTo(layersRef.current.cedis);
        }
        
        if (isocronasRes.ok) {
          const isoData = await isocronasRes.json();
          L.geoJSON(isoData, { 
            style: (f) => {
              const val = f.properties.value || f.properties.time || f.properties.contour || 90;
              let opac = val <= 30 ? 0.5 : val <= 60 ? 0.3 : 0.15;
              return { fillColor: '#3182CE', color: '#2B6CB0', weight: 1, fillOpacity: opac };
            },
            pane: 'isocronasPane' 
          }).addTo(layersRef.current.isocronas);
        }

        if (tiendasRes.ok) {
            const tiendasData = await tiendasRes.json();
            L.geoJSON(tiendasData, {
              // Diseño Tiendas: Rojo 3B, más pequeñas, en medio
              pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 2.5, fillColor: '#E2231A', color: 'transparent', fillOpacity: 0.9, pane: 'tiendasPane' })
            }).addTo(layersRef.current.tiendas);
        }
      } catch (error) {
        console.error("Error cargando datos espaciales:", error);
      }
    };
    loadData();
  }, []);

  // 4. Gráficas
  useEffect(() => {
    if (currentSlide === 3 && chartRef.current) {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
      chartInstance.current = new Chart(chartRef.current, {
        type: 'bar',
        data: {
          labels: ['Escenario Mínimo', 'Escenario Máximo'],
          datasets: [{
            data: [5532, 6616],
            backgroundColor: ['#E2E8F0', '#3182CE'],
            borderRadius: 4
          }]
        },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
    }
  }, [currentSlide]);

  const handleToggleLayer = (layerName, isChecked) => {
    const layer = layersRef.current[layerName];
    if (!layer || !map2Ref.current) return;
    isChecked ? layer.addTo(map2Ref.current) : map2Ref.current.removeLayer(layer);
  };

  return (
    <>
      <nav id="top-nav">
        {['Presentación', 'Contexto', 'Metodología', 'Capacidad', 'Geovisor Edo.', 'Geovisor Log.', 'Ruta Fases', 'Supuestos'].map((title, i) => (
          <button key={i} className={`nav-btn ${currentSlide === i ? 'active' : ''}`} onClick={() => setCurrentSlide(i)}>
            {title}
          </button>
        ))}
      </nav>

      <div id="deck" style={{ width: `calc(100vw * ${totalSlides})`, transform: `translateX(calc(-${currentSlide} * 100vw))` }}>
        
        <section className="slide" style={{ background: '#F8F9FA' }}>
          <div className="slide-inner" style={{ textAlign: 'center' }}>
            <h1 style={{ color: 'var(--red-3b)' }}>¿Cuántas tiendas 3B puede sostener México, y en qué orden se abren?</h1>
            <div style={{ fontSize: '22px', color: 'var(--text-ink)', marginBottom: '40px' }}>Un marco de dos preguntas, capacidad y ruta.</div>
            <div style={{ width: '100px', height: '4px', background: 'var(--red-3b)', margin: '0 auto 40px' }}></div>
            <div style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>Especialista proyectos de expansión</div>
          </div>
        </section>

        <section className="slide">
          <div className="slide-inner">
            <div className="idx">Contexto y Definición del Reto</div>
            <div style={{ fontSize: '28px', maxWidth: '900px', marginBottom: '40px', fontWeight: 'bold' }}>
              3B abre más de 50 tiendas al mes sobre una red de ~3,000. La siguiente etapa de esa expansión — y este ejercicio — se resuelven con datos geoespaciales.
            </div>
            <p className="lede">El reto pide dos respuestas, y ambas comparten el mismo insumo: dónde está la demanda que la red todavía no sirve, y qué tan lejos está esa demanda de la cadena de suministro que ya existe.</p>
          </div>
        </section>

        <section className="slide">
          <div className="slide-inner">
            <div className="idx">Arquitectura Analítica</div>
            <h2>La lógica detrás de las cifras</h2>
            
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center', margin: '30px 0', flexWrap: 'wrap' }}>
              <div style={{ padding: '15px', border: '1px solid var(--line)', borderRadius: '6px', background: '#FFF' }}>
                <h4 style={{margin: '0 0 5px 0'}}>Estimador A</h4><p style={{fontSize: '13px'}}>Físico Territorial</p>
              </div>
              <div style={{fontSize: '24px', fontWeight: 'bold', color: 'var(--text-muted)'}}>+</div>
              <div style={{ padding: '15px', border: '1px solid var(--line)', borderRadius: '6px', background: '#FFF' }}>
                <h4 style={{margin: '0 0 5px 0'}}>Estimador B</h4><p style={{fontSize: '13px'}}>Económico</p>
              </div>
              <div style={{fontSize: '24px', fontWeight: 'bold', color: 'var(--text-muted)'}}>=</div>
              <div style={{ padding: '15px', background: 'var(--text-ink)', color: '#FFF', borderRadius: '6px' }}>
                <h4 style={{margin: '0 0 5px 0', color: '#FFF'}}>Techo Teórico</h4><p style={{fontSize: '13px', color: '#FFF'}}>Mercado Potencial</p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ padding: '15px', background: 'var(--text-ink)', color: '#FFF', borderRadius: '6px' }}>
                 <h4 style={{margin: '0 0 5px 0', color: '#FFF'}}>Techo Teórico</h4>
              </div>
              <div style={{fontSize: '24px', fontWeight: 'bold', color: 'var(--text-muted)'}}>+</div>
              <div style={{ padding: '15px', border: '1px solid var(--line)', borderRadius: '6px', background: '#FFF' }}>
                <h4 style={{margin: '0 0 5px 0'}}>Factor Logístico</h4><p style={{fontSize: '13px'}}>Distancia CEDIS</p>
              </div>
              <div style={{fontSize: '24px', fontWeight: 'bold', color: 'var(--text-muted)'}}>=</div>
              <div style={{ padding: '15px', background: 'var(--accent-blue)', color: '#FFF', borderRadius: '6px' }}>
                <h4 style={{margin: '0 0 5px 0', color: '#FFF'}}>Ruta Fases</h4><p style={{fontSize: '13px', color: '#FFF'}}>Cronograma de apertura</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '40px', borderTop: '1px solid var(--line)', paddingTop: '20px' }}>
              {['DENUE SCIAN 461110', 'DENUE SCIAN 462112', 'ENIGH 2024', 'Censo INEGI 2020', 'Red Geoespacial 3B'].map(src => (
                <span key={src} style={{ fontFamily: 'monospace', fontSize: '12px', background: '#FFF', border: '1px solid var(--line)', padding: '6px 12px', borderRadius: '20px' }}>{src}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="slide">
          <div className="slide-inner">
            <div className="idx">Dimensión del Mercado</div>
            <h2>Banda del Techo: ~5,500 a 6,600 tiendas</h2>
            <div className="grid-2col">
              <div>
                <div style={{ display: 'flex', gap: '40px', marginBottom: '20px' }}>
                  <div><h3 style={{ color: 'var(--red-3b)', fontSize: '42px' }}>5,532</h3><p style={{fontWeight: 'bold', textTransform: 'uppercase', fontSize: '13px'}}>Mínimo Proyectado</p></div>
                  <div><h3 style={{ color: 'var(--red-3b)', fontSize: '42px' }}>6,616</h3><p style={{fontWeight: 'bold', textTransform: 'uppercase', fontSize: '13px'}}>Máximo Proyectado</p></div>
                </div>
                <div style={{ background: '#FFF', borderLeft: '4px solid var(--accent-blue)', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                  <p style={{marginBottom: '10px'}}>Si a la red actual de <b>3,000 tiendas</b> se le suma la expansión prospectada de <b>1,800 unidades</b>, la red operativa alcanzaría las <b>4,800 tiendas</b> para el tercer año.</p>
                  <p>Esto representa una ocupación de capacidad entre el <b>72.6%</b> (tomando el techo máximo) y el <b>86.8%</b> (tomando el techo mínimo), validando la viabilidad del mercado.</p>
                </div>
              </div>
              <div style={{ height: '350px', background: '#FFF', padding: '20px', border: '1px solid var(--line)', borderRadius: '8px', position: 'relative' }}>
                 <canvas ref={chartRef}></canvas>
              </div>
            </div>
          </div>
        </section>

        {/* MAPA 1 */}
        <section className="slide">
          <div className="slide-inner">
            <div className="idx">Anatomía Territorial</div>
            <div className="map-layout">
              <div style={{display: 'flex', flexDirection: 'column'}}>
                <h2 style={{marginBottom: '15px'}}>Geovisor por Estado</h2>
                
                {/* Botones de Filtro */}
                <div className="controls" style={{ marginBottom: '15px', display: 'flex', flexDirection: 'row', gap: '5px' }}>
                  <button className={`btn-layer ${map1Filter === 'estrategia' ? 'active' : ''}`} style={{flex: 1, padding: '8px', fontSize: '12px'}} onClick={() => setMap1Filter('estrategia')}>Estrategia</button>
                  <button className={`btn-layer ${map1Filter === 'densidad' ? 'active' : ''}`} style={{flex: 1, padding: '8px', fontSize: '12px'}} onClick={() => setMap1Filter('densidad')}>Densidad</button>
                </div>

                {/* Panel de Información (Visualización de Campos) */}
                <div style={{ background: '#FFF', border: '1px solid var(--line)', padding: '15px', borderRadius: '6px', marginBottom: '15px', minHeight: '140px' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: 'var(--text-ink)' }}>Datos del Territorio</h4>
                  {hoveredState ? (
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>Estado:</b> <span>{hoveredState.estado}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>Estrategia:</b> <span>{hoveredState.estrategia || 'N/A'}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>Suelo Fértil:</b> <span>{hoveredState.n_suelo_fertil ? hoveredState.n_suelo_fertil.toLocaleString() : 'N/A'}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>Ingreso:</b> <span>{hoveredState.ingreso_trim_2024 ? `$${hoveredState.ingreso_trim_2024.toLocaleString()}` : 'N/A'}</span></div>
                    </div>
                  ) : (
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '20px' }}>Pasa el cursor sobre el mapa para explorar las métricas estatales.</p>
                  )}
                </div>

                {/* Simbología Dinámica */}
                <div style={{ background: '#FFF', border: '1px solid var(--line)', padding: '15px', borderRadius: '6px' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: 'var(--text-ink)' }}>Simbología</h4>
                  {map1Filter === 'estrategia' ? (
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: '12px', height: '12px', background: '#3182CE', borderRadius: '2px' }}></div> Densificar</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: '12px', height: '12px', background: '#38A169', borderRadius: '2px' }}></div> Extender</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: '12px', height: '12px', background: '#E2231A', borderRadius: '2px' }}></div> Nuevas Fronteras</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: '12px', height: '12px', background: '#CBD5E0', borderRadius: '2px' }}></div> Sin Asignar</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                        <div style={{ marginBottom: '8px' }}>Volumen numérico</div>
                        <div style={{ display: 'flex', height: '12px', background: 'linear-gradient(to right, rgba(49, 130, 206, 0.2), rgba(49, 130, 206, 0.8))', borderRadius: '2px', marginBottom: '5px' }}></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}><span>Menor</span><span>Mayor</span></div>
                    </div>
                  )}
                </div>
              </div>
              <div className="map-wrapper"><div id="map1"></div></div>
            </div>
          </div>
        </section>

        {/* MAPA 2 */}
        <section className="slide">
          <div className="slide-inner">
            <div className="idx">Restricción Logística</div>
            <div className="map-layout">
              <div style={{display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
                <h2>Geovisor de Suministro</h2>
                <p style={{fontSize: '14px', color: 'var(--text-muted)', marginBottom: '20px'}}>Capas ordenadas: las tiendas en rojo destacan sobre las isócronas y los CEDIS marcan los nodos centrales.</p>
                
                <div className="controls">
                  <label className="chk-layer"><input type="checkbox" defaultChecked onChange={(e) => handleToggleLayer('cedis', e.target.checked)} /> CEDIS Operativos (Guinda)</label>
                  <label className="chk-layer"><input type="checkbox" defaultChecked onChange={(e) => handleToggleLayer('isocronas', e.target.checked)} /> Isócronas (Transparencia por Tiempo)</label>
                  <label className="chk-layer"><input type="checkbox" defaultChecked onChange={(e) => handleToggleLayer('tiendas', e.target.checked)} /> Puntos 3B (Rojo)</label>
                  <label className="chk-layer"><input type="checkbox" defaultChecked onChange={(e) => handleToggleLayer('roads', e.target.checked)} /> Red Vial de Fondo</label>
                </div>
              </div>
              <div className="map-wrapper"><div id="map2"></div></div>
            </div>
          </div>
        </section>

        <section className="slide">
          <div className="slide-inner">
            <div className="idx">Plan de Ejecución</div>
            <h2>Ruta Táctica (1,800 aperturas)</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginTop: '30px' }}>
               <div style={{ border: '1px solid var(--line)', padding: '24px', background: '#FFF', borderRadius: '8px' }}>
                 <div style={{color: 'var(--accent-blue)', fontWeight: 'bold', fontFamily: 'monospace', marginBottom: '10px'}}>Año 1 — Densificar</div>
                 <h3 style={{fontSize: '36px', margin: '0 0 10px 0'}}>702</h3>
                 <ul style={{paddingLeft: '18px', color: 'var(--text-muted)', fontSize: '14px'}}>
                   <li>Tlaxcala, México, Michoacán</li>
                   <li>Puebla, CDMX, Hidalgo</li>
                 </ul>
               </div>
               <div style={{ border: '1px solid var(--line)', padding: '24px', background: '#FFF', borderRadius: '8px' }}>
                 <div style={{color: 'var(--accent-sage)', fontWeight: 'bold', fontFamily: 'monospace', marginBottom: '10px'}}>Año 2 — Extender</div>
                 <h3 style={{fontSize: '36px', margin: '0 0 10px 0'}}>648</h3>
                 <ul style={{paddingLeft: '18px', color: 'var(--text-muted)', fontSize: '14px'}}>
                   <li>Oaxaca, Guanajuato, Jalisco</li>
                   <li>Veracruz, Zacatecas</li>
                 </ul>
               </div>
               <div style={{ border: '1px solid var(--line)', padding: '24px', background: '#FFF', borderRadius: '8px' }}>
                 <div style={{color: 'var(--red-3b)', fontWeight: 'bold', fontFamily: 'monospace', marginBottom: '10px'}}>Año 3 — Nvas. Fronteras</div>
                 <h3 style={{fontSize: '36px', margin: '0 0 10px 0'}}>450</h3>
                 <ul style={{paddingLeft: '18px', color: 'var(--text-muted)', fontSize: '14px'}}>
                   <li>Yucatán</li>
                   <li>Colima</li>
                 </ul>
               </div>
            </div>
          </div>
        </section>

        <section className="slide">
          <div className="slide-inner">
            <div className="idx">Transparencia del Modelo</div>
            <h2>Supuestos Declarados del Análisis</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px', overflowY: 'auto', maxHeight: '60vh', paddingRight: '10px' }}>
              {[
                {t: 'Base Poblacional Restringida', d: 'Se utiliza exclusivamente la población urbana (localidades ≥2,500 habs). El formato requiere densidad que lo rural disperso no aporta.'},
                {t: 'Benchmark de Saturación', d: 'Basado en Nuevo León: la entidad con ingresos por encima de la mediana nacional con el ratio de habitantes por tienda organizada más bajo (1,820 hab/tienda).'},
                {t: 'Participación Objetivo', d: 'Se asume capturar entre el 15% y el 20% del mercado organizado libre, basado en participaciones de estados maduros (15.4%).'},
                {t: 'Participación de Cartera', d: 'Se estima que el canal de proximidad captura entre el 8% y el 14% del gasto total trimestral en alimentos reportado por ENIGH.'},
                {t: 'Venta Anual Constante', d: 'Construida bottom-up ($90 MXN x 350 trx x 365 días). Es el insumo más sensible del estimador económico; requiere sustitución por data primaria financiera.'},
                {t: 'Vectores Logísticos (Distancia Lineal)', d: 'La distancia Tienda-CEDIS se calcula mediante Haversine. Funciona para macro, pero requiere ruteo real para site selection.'},
                {t: 'Disparador de Nuevos CEDIS', d: 'Se asume capacidad teórica de 150 tiendas por CEDIS, evaluando la construcción de un nodo nuevo al 80% de saturación.'},
                {t: 'Curva de Proyección', d: 'Apertura acelerada de 1,800 tiendas distribuidas en: 39% (Año 1), 36% (Año 2) y 25% (Año 3).'}
              ].map((sup, i) => (
                <div key={i} style={{ background: '#FFF', border: '1px solid var(--line)', padding: '15px', borderRadius: '6px' }}>
                  <h4 style={{margin: '0 0 5px 0', fontSize: '15px'}}>{sup.t}</h4>
                  <p style={{fontSize: '13px', color: 'var(--text-muted)'}}>{sup.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        
      </div>
    </>
  );
}