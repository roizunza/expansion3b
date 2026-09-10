import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// Estadísticas extraídas directamente de anexo_estados_techo.csv
const DATA_STATS = {
  suelo: { min: 3510, max: 101736 },
  ingreso: { min: 41083, max: 117033 },
  ratio: { min: 1820, max: 5144 },
  gini: { min: 0.330, max: 0.418 }
};

export default function App() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [map1Filter, setMap1Filter] = useState('estrategia');
  const [hoveredState, setHoveredState] = useState(null); 
  const [isoFilter, setIsoFilter] = useState('all'); 
  
  const totalSlides = 8;
  const map1Ref = useRef(null);
  const map2Ref = useRef(null);
  
  const chartTechoRef = useRef(null);
  const chartFasesRef = useRef(null);
  const chartTechoInstance = useRef(null);
  const chartFasesInstance = useRef(null);
  
  const geojsonData = useRef({ estados: null, isocronas: null });
  
  const layersRef = useRef({
    estadosGroup: null,
    cedis: null,
    isocronas: null,
    tiendas: null,
    roads: null
  });

  const nextSlide = () => { if (currentSlide < totalSlides - 1) setCurrentSlide(prev => prev + 1); };
  const prevSlide = () => { if (currentSlide > 0) setCurrentSlide(prev => prev - 1); };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight') nextSlide();
      if (e.key === 'ArrowLeft') prevSlide();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentSlide]);

  useEffect(() => {
    if (!map1Ref.current) {
      map1Ref.current = L.map('map1', { zoomControl: true }).setView([23.5, -102.5], 5);
      L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map1Ref.current);
      
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri'
      }).addTo(map1Ref.current);
      layersRef.current.estadosGroup = L.layerGroup().addTo(map1Ref.current);
    }
    
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

  const renderMap1 = () => {
    if (!layersRef.current.estadosGroup || !geojsonData.current.estados) return;
    layersRef.current.estadosGroup.clearLayers();

    let geoJsonLayer = L.geoJSON(geojsonData.current.estados, {
      style: (f) => {
        const prop = f.properties;
        let color = '#CBD5E0';
        let opac = 0.6;
        
        if (map1Filter === 'estrategia') {
          const est = (prop.estrategia || '').toLowerCase();
          if (est.includes('densificar')) color = '#3182CE'; 
          else if (est.includes('extender')) color = '#38A169'; 
          else if (est.includes('frontera') || est.includes('alcanzar')) color = '#E2231A'; 
          opac = 0.75;
        } else {
          let val = 0, min = 0, max = 1;
          if (map1Filter === 'suelo_fertil') { val = prop.n_suelo_fertil; min = DATA_STATS.suelo.min; max = DATA_STATS.suelo.max; color = '#2B6CB0'; }
          if (map1Filter === 'ingreso') { val = prop.ingreso_trim_2024; min = DATA_STATS.ingreso.min; max = DATA_STATS.ingreso.max; color = '#2F855A'; }
          if (map1Filter === 'ratio') { val = prop.ratio_organizado; min = DATA_STATS.ratio.min; max = DATA_STATS.ratio.max; color = '#6B46C1'; }
          if (map1Filter === 'gini') { val = prop.gini_2024; min = DATA_STATS.gini.min; max = DATA_STATS.gini.max; color = '#C05621'; }
          
          if (val != null) {
            const normalized = (val - min) / (max - min || 1);
            opac = 0.2 + (0.7 * normalized); 
          } else {
            color = '#CBD5E0'; opac = 0.3; 
          }
        }
        return { fillColor: color, color: '#FFF', weight: 1, fillOpacity: opac };
      },
      onEachFeature: (f, layer) => {
        layer.on({
          mouseover: (e) => {
            const l = e.target;
            l.setStyle({ fillOpacity: 1, weight: 2, color: '#000' }); 
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

  useEffect(() => { renderMap1(); }, [map1Filter]);

  const renderIsocronas = () => {
    if (!layersRef.current.isocronas || !geojsonData.current.isocronas) return;
    layersRef.current.isocronas.clearLayers();

    L.geoJSON(geojsonData.current.isocronas, {
      filter: (f) => {
        if (isoFilter === 'all') return true;
        return f.properties.range?.toString() === isoFilter;
      },
      style: (f) => {
        const val = f.properties.range || 5400; 
        let color = val <= 1800 ? '#D53F8C' : val <= 3600 ? '#ED64A6' : '#FBB6CE';
        let opac = val <= 1800 ? 0.6 : val <= 3600 ? 0.4 : 0.2;
        return { fillColor: color, color: color, weight: 1, fillOpacity: opac };
      },
      pane: 'isocronasPane'
    }).addTo(layersRef.current.isocronas);
  };

  useEffect(() => { renderIsocronas(); }, [isoFilter]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const resEstados = await fetch('/salidas/anexo_estados_techo.geojson');
        if (resEstados.ok) {
          geojsonData.current.estados = await resEstados.json();
          renderMap1(); 
        }

        const [cedisRes, isocronasRes, tiendasRes] = await Promise.all([
          fetch('/datos/geoespacial/cedis.geojson'),
          fetch('/datos/geoespacial/isocronas_cedis.geojson'),
          fetch('/datos/geoespacial/3b.geojson')
        ]);
        
        if (cedisRes.ok) {
          const cedisData = await cedisRes.json();
          L.geoJSON(cedisData, {
            pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 7, fillColor: '#800020', color: '#800020', weight: 0, fillOpacity: 1, pane: 'cedisPane' })
          }).addTo(layersRef.current.cedis);
        }
        
        if (isocronasRes.ok) {
          geojsonData.current.isocronas = await isocronasRes.json();
          renderIsocronas();
        }

        if (tiendasRes.ok) {
            const tiendasData = await tiendasRes.json();
            L.geoJSON(tiendasData, {
              pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 2.5, fillColor: '#E2231A', color: 'transparent', fillOpacity: 0.9, pane: 'tiendasPane' })
            }).addTo(layersRef.current.tiendas);
        }
      } catch (error) {
        console.error("Error cargando datos:", error);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (currentSlide === 3 && chartTechoRef.current) {
      if (chartTechoInstance.current) chartTechoInstance.current.destroy();
      chartTechoInstance.current = new Chart(chartTechoRef.current, {
        type: 'bar',
        data: {
          labels: ['Saturación de Red'],
          datasets: [
            { label: 'Red Actual', data: [3000], backgroundColor: '#2D3748', barThickness: 60 },
            { label: 'Expansión 3 Años', data: [1800], backgroundColor: '#E2231A', barThickness: 60 },
            { label: 'Margen a Techo Min.', data: [732], backgroundColor: '#CBD5E0', barThickness: 60 },
            { label: 'Margen a Techo Max.', data: [1084], backgroundColor: '#E2E8F0', barThickness: 60 }
          ]
        },
        options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false } }, scales: { x: { stacked: true, max: 6700 }, y: { stacked: true, display: false } } }
      });
    }

    if (currentSlide === 6 && chartFasesRef.current) {
      if (chartFasesInstance.current) chartFasesInstance.current.destroy();
      chartFasesInstance.current = new Chart(chartFasesRef.current, {
        type: 'bar',
        data: {
          labels: ['Base', 'Año 1', 'Año 2', 'Año 3'],
          datasets: [
            { type: 'line', label: 'Red Acumulada', data: [3000, 3702, 4350, 4800], borderColor: '#2D3748', backgroundColor: '#2D3748', borderWidth: 3, tension: 0.2, fill: false, yAxisID: 'y' },
            { type: 'bar', label: 'Nuevas Aperturas', data: [null, 702, 648, 450], backgroundColor: '#E2231A', borderRadius: 4, yAxisID: 'y1' }
          ]
        },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { type: 'linear', display: true, position: 'left', min: 2500, title: { display: true, text: 'Red Total' } }, y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Aperturas' } } } }
      });
    }
  }, [currentSlide]);

  const handleToggleLayer = (layerName, e) => {
    const isChecked = e.target.checked;
    const layer = layersRef.current[layerName];
    if (!layer || !map2Ref.current) return;
    isChecked ? layer.addTo(map2Ref.current) : map2Ref.current.removeLayer(layer);
  };

  return (
    <>
      <style>{`
        body { margin: 0; padding: 0; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        
        /* Barra superior negra y letras blancas - SIN scrollbar */
        #top-nav { background: #000; display: flex; justify-content: space-around; align-items: center; padding: 0 10px; width: 100vw; box-sizing: border-box; }
        .nav-btn { color: #FFF; background: transparent; border: none; padding: 16px 10px; cursor: pointer; font-size: 13px; font-weight: bold; transition: 0.3s; flex: 1; text-align: center; }
        .nav-btn.active { border-bottom: 3px solid #D94345; }
        
        /* Flechas de navegación */
        .nav-arrows { position: absolute; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.1); color: #FFF; border: none; padding: 30px 20px; cursor: pointer; z-index: 1000; transition: 0.3s; font-size: 24px; }
        .nav-arrows:hover { background: rgba(0,0,0,0.4); }
        .nav-arrows.left { left: 0; border-radius: 0 8px 8px 0; }
        .nav-arrows.right { right: 0; border-radius: 8px 0 0 8px; }

        /* Contenedor principal de slides */
        #deck { display: flex; height: calc(100vh - 53px); transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
        .slide { width: 100vw; height: 100%; flex-shrink: 0; overflow-y: auto; display: flex; justify-content: center; background: #F8F9FA; }
        .slide-inner { width: 100%; max-width: 1300px; padding: 40px; }
        
        h2 { font-size: 32px; color: #1A202C; margin-top: 0; }
        .idx { font-family: monospace; color: #A0AEC0; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
        .lede { font-size: 20px; color: #4A5568; line-height: 1.6; max-width: 800px; }
        
        .grid-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; }
        .map-layout { display: grid; grid-template-columns: 350px 1fr; gap: 30px; height: 75vh; }
        .map-wrapper { background: #E2E8F0; border-radius: 8px; overflow: hidden; position: relative; border: 1px solid #CBD5E0; }
        #map1, #map2 { width: 100%; height: 100%; position: absolute; top: 0; left: 0; }
        
        /* Estilo iOS para Toggles */
        .ios-toggle { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; font-size: 14px; cursor: pointer; color: #4A5568; }
        .ios-toggle input { display: none; }
        .switch { position: relative; width: 44px; height: 24px; background-color: #CBD5E0; border-radius: 24px; transition: 0.3s; flex-shrink: 0; margin-left: 10px; }
        .switch::after { content: ''; position: absolute; width: 20px; height: 20px; border-radius: 50%; background-color: white; top: 2px; left: 2px; transition: 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
        .ios-toggle input:checked + .switch { background-color: #38A169; }
        .ios-toggle input:checked + .switch::after { transform: translateX(20px); }
        
        /* Formato botones mapa 1 */
        .btn-layer { background: #FFF; border: 1px solid #E2E8F0; border-radius: 4px; color: #4A5568; cursor: pointer; transition: 0.2s; font-weight: 500; }
        .btn-layer.active { background: #D94345; color: white; border-color: #D94345; }
        
        /* Simbologia M2 */
        .sym-dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
        .sym-line { display: inline-block; width: 16px; height: 3px; margin-right: 8px; vertical-align: middle; }
      `}</style>

      <nav id="top-nav">
        {['Portada', 'Contexto', 'Metodología', 'Capacidad', 'Geovisor Estatal', 'Geovisor Logístico', 'Ruta Fases', 'Conclusiones y Supuestos'].map((title, i) => (
          <button key={i} className={`nav-btn ${currentSlide === i ? 'active' : ''}`} onClick={() => setCurrentSlide(i)}>
            {title}
          </button>
        ))}
      </nav>

      <button className="nav-arrows left" onClick={prevSlide}>&#10094;</button>
      <button className="nav-arrows right" onClick={nextSlide}>&#10095;</button>

      <div id="deck" style={{ width: `calc(100vw * ${totalSlides})`, transform: `translateX(calc(-${currentSlide} * 100vw))` }}>
        
        {/* LÁMINA 1 - PORTADA MOCKUP REDISEÑADA */}
        <section className="slide" style={{ backgroundColor: '#D94345', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', fontSize: '65vw', fontWeight: '900', color: 'rgba(255, 255, 255, 0.08)', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 0, whiteSpace: 'nowrap', pointerEvents: 'none', lineHeight: '0.8' }}>BBB</div>
          
          <div className="slide-inner" style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', padding: '80px 40px 40px 40px' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
              <h1 style={{ color: '#000', fontSize: '3.8rem', fontWeight: '800', maxWidth: '1200px', lineHeight: '1.2', marginBottom: '30px' }}>
                ¿Cuántas tiendas 3B puede sostener México, y en qué orden se abren?
              </h1>
              <h3 style={{ color: '#000', fontSize: '24px', fontWeight: 'bold', margin: '0 0 10px 0' }}>Un marco de dos preguntas, capacidad y ruta.</h3>
              <h3 style={{ color: '#FFF', fontSize: '24px', fontWeight: 'bold', margin: '0' }}>Especialista proyectos de expansión</h3>
            </div>
            
            <div style={{ position: 'relative', width: '100%', marginTop: 'auto' }}>
              <div style={{ display: 'inline-block', background: '#F4C7C7', color: '#000', padding: '10px 20px', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold', position: 'relative', zIndex: 2 }}>
                Izunza Rocío. Urbanista con especialidad en Ciencia de Datos y Geomática.
              </div>
              <div style={{ position: 'absolute', bottom: '18px', left: '10px', right: '0', height: '2px', background: '#000', zIndex: 1 }}></div>
            </div>
          </div>
        </section>

        {/* LÁMINA 2 - CONTEXTO (CON TARJETAS DEL MOCKUP) */}
        <section className="slide">
          <div className="slide-inner">
            <div className="idx">Contexto y Definición del Reto</div>
            <div style={{ fontSize: '24px', maxWidth: '900px', marginBottom: '30px', fontWeight: 'bold' }}>
              3B abre más de 50 tiendas al mes sobre una red de ~3,000. La siguiente etapa de esa expansión — y este ejercicio — se resuelven con datos geoespaciales.
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginTop: '20px' }}>
              <div style={{ background: '#FFF', padding: '30px', borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
                <h3 style={{ fontSize: '24px', color: '#1A202C', marginTop: '0', marginBottom: '15px' }}>El techo del mercado</h3>
                <p style={{ color: '#4A5568', fontSize: '15px', fontWeight: 'bold', marginBottom: '15px' }}>¿Cuántas tiendas 3B puede sostener México de forma rentable?</p>
                <p style={{ color: '#718096', fontSize: '14px', lineHeight: '1.6', margin: '0' }}>El resultado es la banda donde coinciden dos restricciones. Cuánto territorio libre queda, y cuánto gasto hay para sostenerlo.</p>
              </div>
              <div style={{ background: '#FFF', padding: '30px', borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
                <h3 style={{ fontSize: '24px', color: '#1A202C', marginTop: '0', marginBottom: '15px' }}>La ruta de crecimiento</h3>
                <p style={{ color: '#4A5568', fontSize: '15px', fontWeight: 'bold', marginBottom: '15px' }}>Con relación a ese hecho, ¿en qué orden y a qué ritmo se abren?</p>
                <p style={{ color: '#718096', fontSize: '14px', lineHeight: '1.6', margin: '0' }}>La estrategia prioriza dónde ya se puede repartir mercancía actualmente, y en dónde existe la posibilidad de construir esa infraestructura para ampliar el mercado.</p>
              </div>
            </div>
          </div>
        </section>

        {/* LÁMINA 3 - METODOLOGÍA ACTUALIZADA */}
        <section className="slide">
          <div className="slide-inner" style={{ overflowY: 'auto', paddingRight: '15px' }}>
            <div className="idx">Arquitectura Analítica</div>
            <h2 style={{ marginBottom: '10px' }}>Metodología: techo de mercado y ruta de crecimiento</h2>
            <blockquote style={{ borderLeft: '4px solid #D94345', paddingLeft: '15px', fontSize: '16px', fontWeight: 'bold', color: '#1A202C', margin: '0 0 25px 0', background: '#FFF', padding: '15px', border: '1px solid #E2E8F0', borderRadius: '4px' }}>
              "El techo de 3B es el mínimo entre lo que el territorio permite y lo que el bolsillo sostiene."
            </blockquote>
            
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', fontSize: '13px' }}>
              <div style={{ padding: '10px 15px', border: '1px solid var(--line)', borderRadius: '6px', background: '#FFF' }}><b>Estimador A</b> <span style={{color:'#718096'}}>(Territorio)</span></div>
              <div style={{fontWeight: 'bold', color: '#A0AEC0'}}>+</div>
              <div style={{ padding: '10px 15px', border: '1px solid var(--line)', borderRadius: '6px', background: '#FFF' }}><b>Estimador B</b> <span style={{color:'#718096'}}>(Bolsillo)</span></div>
              <div style={{fontWeight: 'bold', color: '#A0AEC0'}}>=</div>
              <div style={{ padding: '10px 15px', background: '#1A202C', color: '#FFF', borderRadius: '6px' }}><b>Techo Teórico</b></div>
              <div style={{fontWeight: 'bold', color: '#A0AEC0'}}>+</div>
              <div style={{ padding: '10px 15px', border: '1px solid var(--line)', borderRadius: '6px', background: '#FFF' }}><b>Factor Logístico</b></div>
              <div style={{fontWeight: 'bold', color: '#A0AEC0'}}>=</div>
              <div style={{ padding: '10px 15px', background: '#3182CE', color: '#FFF', borderRadius: '6px' }}><b>Ruta Fases</b></div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
              <div>
                <h4 style={{ color: '#E2231A', margin: '0 0 10px 0', fontSize: '15px' }}>Estimador A: Físico Territorial</h4>
                <p style={{ fontSize: '13px', color: '#4A5568', lineHeight: '1.5', margin: '0 0 15px 0' }}>
                  El formato <i>hard discount</i> captura cuota del sector informal, por lo que el territorio suele apretar más que el ingreso. Este estimador se calcula como la <b>población urbana del estado dividida entre el total de tiendas de cadena organizada</b>. El límite se define con el estado más saturado (benchmark).
                </p>
                <h4 style={{ color: '#E2231A', margin: '0 0 10px 0', fontSize: '15px' }}>Estimador B: Económico</h4>
                <p style={{ fontSize: '13px', color: '#4A5568', lineHeight: '1.5', margin: '0' }}>
                  Representa el límite del bolsillo del consumidor. Se calcula proyectando el <b>gasto anual en alimentos</b> cruzado por la participación de cartera del canal y la participación objetivo de 3B, dividido entre la venta anual requerida por tienda.
                </p>
              </div>
              <div>
                <h4 style={{ color: '#3182CE', margin: '0 0 10px 0', fontSize: '15px' }}>Filtro: Factor Logístico</h4>
                <p style={{ fontSize: '13px', color: '#4A5568', lineHeight: '1.5', margin: '0 0 15px 0' }}>
                  El modelo exige bajo costo de abastecimiento (referencia &lt;5% de ventas). La tienda no opera rentablemente fuera de una <b>isócrona de 90 minutos</b> de un CEDIS. Crecer fuera de la red actual sin invertir en un nuevo nodo destruye el margen.
                </p>
                <h4 style={{ color: '#38A169', margin: '0 0 10px 0', fontSize: '15px' }}>Estrategia Resultante</h4>
                <p style={{ fontSize: '13px', color: '#4A5568', lineHeight: '1.5', margin: '0' }}>
                  Si el territorio permite más tiendas que el gasto, la palanca es <b>Densificar</b>. Si la restricción es el límite urbano, la palanca es <b>Alcanzar</b> nuevo territorio. Si ambas confluyen y la logística lo permite, es prioridad inmediata de ejecución.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* LÁMINA 4 - CAPACIDAD */}
        <section className="slide">
          <div className="slide-inner">
            <div className="idx">Dimensión del Mercado</div>
            <h2>Banda del Techo: ~5,500 a 6,600 tiendas</h2>
            <div className="grid-2col">
              <div>
                <div style={{ display: 'flex', gap: '40px', marginBottom: '20px' }}>
                  <div><h3 style={{ color: '#E2231A', fontSize: '42px', margin: '0' }}>5,532</h3><p style={{fontWeight: 'bold', textTransform: 'uppercase', fontSize: '13px', margin: '5px 0'}}>Mínimo Proyectado</p></div>
                  <div><h3 style={{ color: '#E2231A', fontSize: '42px', margin: '0' }}>6,616</h3><p style={{fontWeight: 'bold', textTransform: 'uppercase', fontSize: '13px', margin: '5px 0'}}>Máximo Proyectado</p></div>
                </div>
                <div style={{ background: '#FFF', borderLeft: '4px solid #3182CE', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', color: '#4A5568', lineHeight: '1.5' }}>
                  <p style={{marginTop: '0', marginBottom: '10px'}}>Si a la red actual de <b>3,000 tiendas</b> se le suma la expansión prospectada de <b>1,800 unidades</b>, la red operativa alcanzaría las <b>4,800 tiendas</b> para el tercer año.</p>
                  <p style={{margin: '0'}}>Esto representa una ocupación de capacidad entre el <b>72.6%</b> (tomando el techo máximo) y el <b>86.8%</b> (tomando el techo mínimo), validando la viabilidad del mercado.</p>
                </div>
              </div>
              <div style={{ height: '350px', background: '#FFF', padding: '20px', border: '1px solid #E2E8F0', borderRadius: '8px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                 <div style={{ height: '150px', width: '100%' }}>
                    <canvas ref={chartTechoRef}></canvas>
                 </div>
                 <p style={{fontSize: '12px', color: '#A0AEC0', textAlign: 'center', marginTop: '20px', fontStyle: 'italic'}}>Proyección de llenado del mercado vs. Techo máximo</p>
              </div>
            </div>
          </div>
        </section>

        {/* MAPA 1 - ESTADOS */}
        <section className="slide">
          <div className="slide-inner">
            <div className="idx">Anatomía Territorial</div>
            <div className="map-layout">
              <div style={{display: 'flex', flexDirection: 'column'}}>
                <h2 style={{marginBottom: '15px'}}>Geovisor por Estado</h2>
                
                <div className="controls" style={{ marginBottom: '15px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  <button className={`btn-layer ${map1Filter === 'estrategia' ? 'active' : ''}`} style={{flex: '1 1 30%', padding: '6px', fontSize: '11px'}} onClick={() => setMap1Filter('estrategia')}>Estrategia</button>
                  <button className={`btn-layer ${map1Filter === 'suelo_fertil' ? 'active' : ''}`} style={{flex: '1 1 30%', padding: '6px', fontSize: '11px'}} onClick={() => setMap1Filter('suelo_fertil')}>Suelo Fértil</button>
                  <button className={`btn-layer ${map1Filter === 'ingreso' ? 'active' : ''}`} style={{flex: '1 1 30%', padding: '6px', fontSize: '11px'}} onClick={() => setMap1Filter('ingreso')}>Ingreso Trim.</button>
                  <button className={`btn-layer ${map1Filter === 'ratio' ? 'active' : ''}`} style={{flex: '1 1 30%', padding: '6px', fontSize: '11px'}} onClick={() => setMap1Filter('ratio')}>Ratio Org.</button>
                  <button className={`btn-layer ${map1Filter === 'gini' ? 'active' : ''}`} style={{flex: '1 1 30%', padding: '6px', fontSize: '11px'}} onClick={() => setMap1Filter('gini')}>Índice Gini</button>
                </div>

                <div style={{ background: '#FFF', border: '1px solid #E2E8F0', padding: '15px', borderRadius: '6px', marginBottom: '15px', minHeight: '180px' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#1A202C' }}>Datos del Territorio</h4>
                  {hoveredState ? (
                    <table style={{width: '100%', fontSize: '12px', borderCollapse: 'collapse', color: '#1A202C'}}>
                      <tbody>
                        <tr style={{borderBottom: '1px solid #E2E8F0'}}><td style={{padding: '6px 0', color: '#718096'}}>Estado</td><td style={{textAlign: 'right', fontWeight: 'bold'}}>{hoveredState.estado}</td></tr>
                        <tr style={{borderBottom: '1px solid #E2E8F0'}}><td style={{padding: '6px 0', color: '#718096'}}>Estrategia</td><td style={{textAlign: 'right'}}>{hoveredState.estrategia || 'N/A'}</td></tr>
                        <tr style={{borderBottom: '1px solid #E2E8F0'}}><td style={{padding: '6px 0', color: '#718096'}}>Suelo Fértil</td><td style={{textAlign: 'right'}}>{hoveredState.n_suelo_fertil ? hoveredState.n_suelo_fertil.toLocaleString() : 'N/A'}</td></tr>
                        <tr style={{borderBottom: '1px solid #E2E8F0'}}><td style={{padding: '6px 0', color: '#718096'}}>Ingreso Trim.</td><td style={{textAlign: 'right'}}>{hoveredState.ingreso_trim_2024 ? `$${hoveredState.ingreso_trim_2024.toLocaleString()}` : 'N/A'}</td></tr>
                        <tr style={{borderBottom: '1px solid #E2E8F0'}}><td style={{padding: '6px 0', color: '#718096'}}>Ratio Org.</td><td style={{textAlign: 'right'}}>{hoveredState.ratio_organizado ? hoveredState.ratio_organizado.toLocaleString() : 'N/A'}</td></tr>
                        <tr><td style={{padding: '6px 0', color: '#718096'}}>Índice Gini</td><td style={{textAlign: 'right'}}>{hoveredState.gini_2024 ? hoveredState.gini_2024.toFixed(3) : 'N/A'}</td></tr>
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ fontSize: '13px', color: '#A0AEC0', fontStyle: 'italic', marginTop: '30px', textAlign: 'center' }}>Pasa el cursor sobre el mapa para explorar las métricas estatales.</p>
                  )}
                </div>

                {map1Filter === 'gini' && (
                  <div style={{ background: '#F8F9FA', borderLeft: '3px solid #C05621', padding: '10px', fontSize: '11px', color: '#718096', marginBottom: '15px' }}>
                    <b>Nota Técnica (Gini):</b> Mide la desigualdad de ingresos. Cero indica igualdad perfecta, 1 indica desigualdad máxima. Funciona como variable contextual para evaluar la sensibilidad al precio y nichos base pirámide.
                  </div>
                )}

                <div style={{ background: '#FFF', border: '1px solid #E2E8F0', padding: '15px', borderRadius: '6px' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#1A202C' }}>Simbología</h4>
                  {map1Filter === 'estrategia' ? (
                    <div style={{ fontSize: '13px', color: '#718096', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: '12px', height: '12px', background: '#3182CE', borderRadius: '2px' }}></div> Densificar</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: '12px', height: '12px', background: '#38A169', borderRadius: '2px' }}></div> Extender</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: '12px', height: '12px', background: '#E2231A', borderRadius: '2px' }}></div> Nuevas Fronteras</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: '12px', height: '12px', background: '#CBD5E0', borderRadius: '2px' }}></div> Sin Asignar</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '13px', color: '#718096' }}>
                        <div style={{ marginBottom: '8px' }}>Intensidad de la variable seleccionada</div>
                        <div style={{ display: 'flex', height: '12px', background: `linear-gradient(to right, rgba(255,255,255,0), ${map1Filter === 'suelo_fertil' ? '#2B6CB0' : map1Filter === 'ingreso' ? '#2F855A' : map1Filter === 'ratio' ? '#6B46C1' : '#C05621'})`, borderRadius: '2px', marginBottom: '5px', border: '1px solid #E2E8F0' }}></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}><span>Menor</span><span>Mayor</span></div>
                    </div>
                  )}
                </div>
              </div>
              <div className="map-wrapper"><div id="map1"></div></div>
            </div>
          </div>
        </section>

        {/* MAPA 2 - LOGÍSTICA CON TOGGLES IOS */}
        <section className="slide">
          <div className="slide-inner">
            <div className="idx">Restricción Logística</div>
            <div className="map-layout">
              <div style={{display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
                <h2>Geovisor de Suministro</h2>
                <p style={{fontSize: '14px', color: '#718096', marginBottom: '30px'}}>Capas ordenadas: las tiendas destacan sobre las isócronas y los CEDIS marcan los nodos centrales.</p>
                
                <div className="controls">
                  <label className="ios-toggle">
                    <div style={{display: 'flex', alignItems: 'center'}}><span className="sym-dot" style={{background: '#800020'}}></span> CEDIS Operativos</div>
                    <input type="checkbox" defaultChecked onChange={(e) => handleToggleLayer('cedis', e)} />
                    <div className="switch"></div>
                  </label>
                  
                  <label className="ios-toggle">
                    <div style={{display: 'flex', alignItems: 'center'}}><span className="sym-dot" style={{background: '#E2231A'}}></span> Puntos 3B</div>
                    <input type="checkbox" defaultChecked onChange={(e) => handleToggleLayer('tiendas', e)} />
                    <div className="switch"></div>
                  </label>

                  <label className="ios-toggle">
                    <div style={{display: 'flex', alignItems: 'center'}}><span className="sym-line" style={{background: '#A0AEC0'}}></span> Red Vial de Fondo</div>
                    <input type="checkbox" defaultChecked onChange={(e) => handleToggleLayer('roads', e)} />
                    <div className="switch"></div>
                  </label>

                  <div style={{ borderTop: '1px solid #E2E8F0', margin: '20px 0', padding: '20px 0 0 0' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '15px', color: '#1A202C' }}>Filtro de Isócronas</div>
                    
                    <label className="ios-toggle">
                      <div style={{display: 'flex', alignItems: 'center'}}><span className="sym-dot" style={{background: '#D53F8C', opacity: 0.8}}></span> Isócrona 30 min</div>
                      <input type="checkbox" checked={isoFilter === '1800' || isoFilter === 'all'} onChange={(e) => {
                        if(isoFilter === 'all' || !e.target.checked) setIsoFilter('all'); 
                        else setIsoFilter('1800');
                      }} />
                      <div className="switch" onClick={(e) => { e.preventDefault(); setIsoFilter(isoFilter === '1800' ? 'all' : '1800'); }}></div>
                    </label>

                    <label className="ios-toggle">
                      <div style={{display: 'flex', alignItems: 'center'}}><span className="sym-dot" style={{background: '#ED64A6', opacity: 0.6}}></span> Isócrona 60 min</div>
                      <input type="checkbox" checked={isoFilter === '3600' || isoFilter === 'all'} readOnly />
                      <div className="switch" onClick={(e) => { e.preventDefault(); setIsoFilter(isoFilter === '3600' ? 'all' : '3600'); }}></div>
                    </label>

                    <label className="ios-toggle">
                      <div style={{display: 'flex', alignItems: 'center'}}><span className="sym-dot" style={{background: '#FBB6CE', opacity: 0.4}}></span> Isócrona 90 min</div>
                      <input type="checkbox" checked={isoFilter === '5400' || isoFilter === 'all'} readOnly />
                      <div className="switch" onClick={(e) => { e.preventDefault(); setIsoFilter(isoFilter === '5400' ? 'all' : '5400'); }}></div>
                    </label>
                    
                    <button onClick={() => setIsoFilter('all')} style={{ width: '100%', padding: '8px', marginTop: '10px', background: '#F8F9FA', border: '1px solid #E2E8F0', borderRadius: '4px', color: '#4A5568', cursor: 'pointer', fontSize: '12px' }}>
                      Ver todas (Combinadas)
                    </button>
                  </div>
                </div>
              </div>
              <div className="map-wrapper"><div id="map2"></div></div>
            </div>
          </div>
        </section>

        <section className="slide">
          <div className="slide-inner">
            <div className="idx">Plan de Ejecución</div>
            <h2 style={{marginBottom: '20px'}}>Ruta Táctica (1,800 aperturas)</h2>
            <div className="grid-2col" style={{ gridTemplateColumns: '1fr 1.5fr', marginTop: '0', gap: '30px' }}>
               <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                 <div style={{ border: '1px solid #E2E8F0', padding: '20px', background: '#FFF', borderRadius: '8px' }}>
                   <div style={{color: '#3182CE', fontWeight: 'bold', fontFamily: 'monospace', marginBottom: '5px'}}>Año 1 — Densificar</div>
                   <h3 style={{fontSize: '28px', margin: '0 0 5px 0', color: '#1A202C'}}>702</h3>
                   <p style={{color: '#718096', fontSize: '13px', margin: '0'}}>Tlaxcala, EdoMex, Michoacán, Puebla, CDMX, Hidalgo.</p>
                 </div>
                 <div style={{ border: '1px solid #E2E8F0', padding: '20px', background: '#FFF', borderRadius: '8px' }}>
                   <div style={{color: '#38A169', fontWeight: 'bold', fontFamily: 'monospace', marginBottom: '5px'}}>Año 2 — Extender</div>
                   <h3 style={{fontSize: '28px', margin: '0 0 5px 0', color: '#1A202C'}}>648</h3>
                   <p style={{color: '#718096', fontSize: '13px', margin: '0'}}>Oaxaca, Guanajuato, Jalisco, Veracruz, Zacatecas.</p>
                 </div>
                 <div style={{ border: '1px solid #E2E8F0', padding: '20px', background: '#FFF', borderRadius: '8px' }}>
                   <div style={{color: '#E2231A', fontWeight: 'bold', fontFamily: 'monospace', marginBottom: '5px'}}>Año 3 — Nvas. Fronteras</div>
                   <h3 style={{fontSize: '28px', margin: '0 0 5px 0', color: '#1A202C'}}>450</h3>
                   <p style={{color: '#718096', fontSize: '13px', margin: '0'}}>Yucatán, Colima.</p>
                 </div>
               </div>
               
               <div style={{ height: '100%', minHeight: '350px', background: '#FFF', padding: '20px', border: '1px solid #E2E8F0', borderRadius: '8px', position: 'relative' }}>
                 <canvas ref={chartFasesRef}></canvas>
               </div>
            </div>
          </div>
        </section>

        {/* LÁMINA 8 - CONCLUSIONES Y SUPUESTOS */}
        <section className="slide">
          <div className="slide-inner">
            <div className="idx">Cierre y Transparencia del Modelo</div>
            <h2>Conclusiones y Supuestos</h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginTop: '20px', height: '65vh', overflow: 'hidden' }}>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <h3 style={{ color: '#1A202C', borderBottom: '2px solid #E2231A', paddingBottom: '10px', margin: '0' }}>Conclusiones Estratégicas</h3>
                
                <div style={{ background: '#FFF', borderLeft: '4px solid #E2231A', padding: '15px', borderRadius: '0 6px 6px 0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <h4 style={{margin: '0 0 5px 0', fontSize: '15px', color: '#1A202C'}}>Viabilidad de Expansión Validada</h4>
                  <p style={{fontSize: '13px', color: '#4A5568', margin: '0'}}>El techo teórico indica que el mercado mexicano puede sostener entre 5,500 y 6,600 tiendas. La meta de 1,800 nuevas unidades (alcanzando 4,800) es viable y deja un margen de seguridad operativo superior al 13%.</p>
                </div>

                <div style={{ background: '#FFF', borderLeft: '4px solid #3182CE', padding: '15px', borderRadius: '0 6px 6px 0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <h4 style={{margin: '0 0 5px 0', fontSize: '15px', color: '#1A202C'}}>Mitigación de Riesgo Logístico</h4>
                  <p style={{fontSize: '13px', color: '#4A5568', margin: '0'}}>Priorizar la "Densificación" (Año 1) en estados centrales maximiza la infraestructura de CEDIS actual. Abrir "Nuevas Fronteras" (Año 3) debe estar estrictamente condicionado a la inversión en nuevos nodos logísticos.</p>
                </div>

                <div style={{ background: '#FFF', borderLeft: '4px solid #38A169', padding: '15px', borderRadius: '0 6px 6px 0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <h4 style={{margin: '0 0 5px 0', fontSize: '15px', color: '#1A202C'}}>Saturación vs. Ingreso</h4>
                  <p style={{fontSize: '13px', color: '#4A5568', margin: '0'}}>El análisis espacial demuestra que las zonas con mayor densidad de "suelo fértil" correlacionan con estratos de ingreso medio/bajo, requiriendo estricto control de <i>pricing</i> por microrregión.</p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', paddingRight: '10px' }}>
                <h3 style={{ color: '#1A202C', borderBottom: '2px solid #E2E8F0', paddingBottom: '10px', margin: '0 0 5px 0' }}>Supuestos del Análisis</h3>
                {[
                  {t: 'Base Poblacional Restringida', d: 'Se utiliza exclusivamente la población urbana (localidades ≥2,500 habs). El formato requiere densidad que lo rural disperso no aporta.'},
                  {t: 'Benchmark de Saturación', d: 'Basado en Nuevo León: la entidad con ingresos por encima de la mediana nacional con el ratio de habitantes por tienda organizada más bajo (1,820 hab/tienda).'},
                  {t: 'Participación Objetivo', d: 'Se asume capturar entre el 15% y el 20% del mercado organizado libre, basado en participaciones de estados maduros.'},
                  {t: 'Venta Anual Constante', d: 'Construida bottom-up ($90 MXN x 350 trx x 365 días). Es el insumo más sensible del estimador económico.'},
                  {t: 'Vectores Logísticos (Distancia Lineal)', d: 'La distancia Tienda-CEDIS se calcula mediante Haversine. Funciona para macro, pero requiere ruteo real para site selection.'},
                  {t: 'Disparador de Nuevos CEDIS', d: 'Se asume capacidad teórica de 150 tiendas por CEDIS, evaluando la construcción de un nodo nuevo al 80% de saturación.'}
                ].map((sup, i) => (
                  <div key={i} style={{ background: '#F8F9FA', border: '1px solid #E2E8F0', padding: '10px', borderRadius: '6px' }}>
                    <h4 style={{margin: '0 0 3px 0', fontSize: '13px', color: '#1A202C'}}>{sup.t}</h4>
                    <p style={{fontSize: '12px', color: '#718096', margin: '0'}}>{sup.d}</p>
                  </div>
                ))}
              </div>

            </div>
          </div>
        </section>
        
      </div>
    </>
  );
}