/* Waterflow immersive terrain lab. The Web Worker owns all hydraulic state. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const TOOLS = new Set(['inspect', 'source', 'dig', 'raise', 'transect', 'tag']);
  const SITES = {
    canyon: {lat: 36.9369, lon: -111.4838},
    tuttle: {lat: 39.2643, lon: -96.5903},
    salina: {lat: 38.8403, lon: -97.6114}
  };
  const imageryStyle = {
    version: 8,
    sources: {imagery: {type: 'raster', tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    ], tileSize: 256, attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'}},
    layers: [{id: 'satellite-base', type: 'raster', source: 'imagery'}]
  };
  const streetStyle = 'https://tiles.openfreemap.org/styles/liberty';
  let map, worker, movie = null, scenario = null, base = null, deltas = null;
  let depth = null, peak = null, arrival = null, sourceIndex = -1, probeIndex = -1;
  let selectedTool = 'inspect', depthMode = 'live', styleMode = 'satellite';
  let stations = [], sampleEnd = -1, globeView = false;
  let terrain3d = true, running = false, loading = false, isPainting = false;
  let strokeCells = new Set(), changedCells = new Map(), revision = 0;
  let suppressSculptClickUntil = 0, lastTerrainErrorTime = 0;
  let elapsed = 0, renderTimer = 0, lastFrame = null, toastTimer = null;
  const overlay = document.createElement('canvas');
  const context = overlay.getContext('2d', {willReadFrequently: true});
  let lastFrameTime = 0;

  function notify(message, error = false) {
    const node = $('toast');
    node.textContent = message;
    node.className = 'toast show' + (error ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.className = 'toast'; }, 5200);
  }
  function status(message) { $('status').textContent = message; }
  function fail(error) { notify(error.message || String(error), true); status('Attention required'); }
  function busy(active) {
    loading = active;
    $('loading').classList.toggle('hidden', !active);
    $('load-terrain').disabled = active;
    $('run').disabled = active;
  }
  function fmtTime(t) {
    if (!Number.isFinite(t) || t < 0) return '—';
    const s = Math.floor(t);
    return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(v => String(v).padStart(2, '0')).join(':');
  }
  function selectTool(tool) {
    if (!TOOLS.has(tool)) return;
    selectedTool = tool;
    document.querySelectorAll('[data-tool]').forEach(el => el.classList.toggle('active', el.dataset.tool === tool));
    const editing = tool === 'dig' || tool === 'raise';
    $('sculpt-cursor').style.display = 'none';
    map.getCanvas().style.cursor = editing ? 'crosshair' : ['source','transect','tag'].includes(tool) ? 'copy' : 'crosshair';
    status(editing ? 'Drag to sculpt terrain' : tool === 'source' ? 'Click map to place release' : tool === 'transect' ? 'Click downstream endpoint for sample stations' : tool === 'tag' ? 'Click a wet cell to place a floating tracker' : 'Click map to inspect');
  }
  function toCell(lngLat) {
    if (!scenario) return -1;
    const [west, south, east, north] = scenario.bounds;
    if (lngLat.lng < west || lngLat.lng >= east || lngLat.lat < south || lngLat.lat >= north) return -1;
    const x = Math.floor((lngLat.lng - west) / (east - west) * scenario.width);
    const y = Math.floor((north - lngLat.lat) / (north - south) * scenario.height);
    return y * scenario.width + x;
  }
  function cellLatLon(i) {
    const x = i % scenario.width, y = Math.floor(i / scenario.width);
    const [west, south, east, north] = scenario.bounds;
    return [west + (x + 0.5) / scenario.width * (east - west),
      north - (y + 0.5) / scenario.height * (north - south)];
  }
  function pointGeoJSON(i) {
    return {type: 'FeatureCollection', features: i < 0 ? [] :
      [{type: 'Feature', geometry: {type: 'Point', coordinates: cellLatLon(i)}, properties: {}}]};
  }
  function extentPolygon() {
    const [w,s,e,n] = scenario.bounds;
    return {type:'FeatureCollection',features:[{type:'Feature',geometry:{
      type:'Polygon',coordinates:[[[w,n],[e,n],[e,s],[w,s],[w,n]]]},properties:{}}]};
  }
  function setupScenarioLayers() {
    if (!scenario || !map.isStyleLoaded()) return;
    // DEM refresh: remove the former terrain source before adding its new revision.
    if (map.getTerrain()) map.setTerrain(null);
    ['movie-trail','station-labels','station-markers','sample-line-layer','probe-marker','source-marker','study-outline','flood-layer'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    ['movie-trail-data','station-data','sample-line-data','probe-data','source-data','study-area','flood-image','scenario-dem'].forEach(id => {
      if (map.getSource(id)) map.removeSource(id);
    });
    map.addSource('scenario-dem', {
      type: 'raster-dem', tiles: ['/api/scenarios/' + scenario.id +
        '/dem/{z}/{x}/{y}.png?v=' + revision], tileSize: 256,
      minzoom: 0, maxzoom: 14, encoding: 'terrarium',
      attribution: 'DEM: Mapzen / AWS Terrain Tiles'
    });
    if (terrain3d) map.setTerrain({source: 'scenario-dem', exaggeration: 1.25});
    map.addSource('study-area',{type:'geojson',data:extentPolygon()});
    map.addLayer({id:'study-outline',type:'line',source:'study-area',
      paint:{'line-color':'#8ce7e7','line-width':2,'line-opacity':0.8,'line-dasharray':[4,3]}});
    overlay.width = scenario.width; overlay.height = scenario.height;
    const img = emptyImage();
    const [w,s,e,n] = scenario.bounds;
    map.addSource('flood-image',{type:'image',url:img,coordinates:[[w,n],[e,n],[e,s],[w,s]]});
    map.addLayer({id:'flood-layer',type:'raster',source:'flood-image',
      paint:{'raster-opacity':0.92,'raster-fade-duration':0}});
    map.addSource('source-data',{type:'geojson',data:pointGeoJSON(sourceIndex)});
    map.addLayer({id:'source-marker',type:'circle',source:'source-data',
      paint:{'circle-radius':9,'circle-color':'#8ef5f2','circle-stroke-width':4,'circle-stroke-color':'#061a2c'}});
    map.addSource('probe-data',{type:'geojson',data:pointGeoJSON(probeIndex)});
    map.addLayer({id:'probe-marker',type:'circle',source:'probe-data',
      paint:{'circle-radius':5,'circle-color':'#fff','circle-stroke-width':2,'circle-stroke-color':'#1c5762'}});
    const line = stationLineGeoJSON();
    map.addSource('sample-line-data',{type:'geojson',data:line});
    map.addLayer({id:'sample-line-layer',type:'line',source:'sample-line-data',
      paint:{'line-color':'#b8f9f9','line-width':2,'line-dasharray':[2,2]}});
    map.addSource('station-data',{type:'geojson',data:stationGeoJSON()});
    map.addLayer({id:'station-markers',type:'circle',source:'station-data',
      paint:{'circle-radius':4,'circle-color':'#061822','circle-stroke-width':2,'circle-stroke-color':'#b3ffff'}});
    map.addLayer({id:'station-labels',type:'symbol',source:'station-data',
      layout:{'text-field':['get','distance'],'text-size':11,'text-offset':[0,1.5],'text-allow-overlap':false},
      paint:{'text-color':'#edffff','text-halo-color':'#071a24','text-halo-width':2}});
    if (movie) movie.setupLayers();
    if (lastFrame) updateOverlay();
  }
  function stationLineGeoJSON() {
    return {type:'FeatureCollection',features:sampleEnd>=0 && sourceIndex>=0 ? [{
      type:'Feature',properties:{},geometry:{type:'LineString',
        coordinates:[cellLatLon(sourceIndex),cellLatLon(sampleEnd)]}}] : []};
  }
  function stationGeoJSON() {
    return {type:'FeatureCollection',features:stations.map(s=>({
      type:'Feature',geometry:{type:'Point',coordinates:cellLatLon(s.index)},
      properties:{distance:Math.round(s.distance)+'m'}}))};
  }
  function createTransect(index) {
    if(sourceIndex<0) {notify('Place a water source before drawing a sample line.',true);selectTool('source');return;}
    if(index<0) {notify('Choose a point inside the outlined study area.',true);return;}
    sampleEnd=index;
    const origin=cellLatLon(sourceIndex), end=cellLatLon(index);
    const x=(end[0]-origin[0])*111320*Math.cos((origin[1]+end[1])/2*Math.PI/180);
    const y=(end[1]-origin[1])*111320;
    const length=Math.hypot(x,y);
    if(length<100){notify('Choose an endpoint at least 100 meters from the source.',true);return;}
    const spacing=Number($('station-spacing').value);
    stations=[];const used=new Set();
    for(let d=0;d<=length;d+=spacing){
      const t=d/length;
      const i=toCell({lng:origin[0]+(end[0]-origin[0])*t,
        lat:origin[1]+(end[1]-origin[1])*t});
      if(i>=0&&!used.has(i)){stations.push({index:i,distance:d});used.add(i);}
    }
    if(!used.has(index))stations.push({index,distance:length});
    if(map.getSource('sample-line-data'))map.getSource('sample-line-data').setData(stationLineGeoJSON());
    if(map.getSource('station-data'))map.getSource('station-data').setData(stationGeoJSON());
    updateStations();
    selectTool('inspect');
    notify(stations.length+' modeled depth stations placed at ~'+spacing+' m increments.');
  }
  function updateStations() {
    const node=$('stations');node.replaceChildren();
    if(!scenario||stations.length===0){
      const empty=document.createElement('span');empty.className='stations-empty';
      empty.textContent='No sample line placed';node.appendChild(empty);return;
    }
    const title=document.createElement('div');title.className='station-head';
    title.textContent='DISTANCE     PEAK DEPTH     WATER LEVEL';node.appendChild(title);
    for(const s of stations){
      const row=document.createElement('div');row.className='station-row';
      const z=base[s.index]+deltas[s.index],h=peak?peak[s.index]:0;
      for(const text of [Math.round(s.distance)+' m',h.toFixed(2)+' m',(z+h).toFixed(1)+' m']){
        const cell=document.createElement('span');cell.textContent=text;row.appendChild(cell);
      }
      node.appendChild(row);
    }
  }
  function exportStations() {
    if(!scenario||stations.length===0){notify('Draw a sample line before exporting readings.',true);return;}
    const lines=['distance_m,latitude,longitude,ground_m,peak_depth_m,peak_water_surface_m,first_wet_s'];
    for(const s of stations){
      const [lng,lat]=cellLatLon(s.index),z=base[s.index]+deltas[s.index],h=peak?peak[s.index]:0;
      const t=arrival?arrival[s.index]:-1;
      lines.push([s.distance.toFixed(1),lat.toFixed(6),lng.toFixed(6),z.toFixed(2),
        h.toFixed(3),(z+h).toFixed(3),t>=0?t.toFixed(1):''].join(','));
    }
    const url=URL.createObjectURL(new Blob([lines.join('\n')+'\n'],{type:'text/csv'}));
    const a=document.createElement('a');a.href=url;a.download='waterflow-stations.csv';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function emptyImage() {
    context.clearRect(0,0,overlay.width,overlay.height);
    return overlay.toDataURL('image/png');
  }
  function updateOverlay() {
    if (!scenario || !map.getSource('flood-image') || !lastFrame) return;
    const src = depthMode === 'live' ? depth : peak;
    if (!src) return;
    const image = context.createImageData(scenario.width,scenario.height);
    for (let i = 0; i < src.length; i++) {
      const d = src[i], k = i * 4;
      if (d < 0.07) continue;
      const t = Math.min(1, Math.log1p(d * 1.3) / Math.log1p(6.5 * 1.3));
      image.data[k] = Math.round(55 - t * 47);
      image.data[k+1] = Math.round(205 - t * 147);
      image.data[k+2] = Math.round(242 - t * 93);
      image.data[k+3] = Math.round(95 + t * 155);
    }
    context.putImageData(image, 0, 0);
    map.getSource('flood-image').updateImage({url:overlay.toDataURL('image/png')});
  }
  function setSource(index) {
    if (index < 0) { notify('Click inside the outlined study area.', true); return; }
    sourceIndex = index;
    $('source-position').textContent = cellLatLon(index).slice().reverse().map(n => n.toFixed(4)).join(', ');
    const data = map.getSource('source-data');
    if (data) data.setData(pointGeoJSON(index));
    sampleEnd=-1;stations=[];
    if(map.getSource('sample-line-data'))map.getSource('sample-line-data').setData(stationLineGeoJSON());
    if(map.getSource('station-data'))map.getSource('station-data').setData(stationGeoJSON());
    updateStations();
    resetSimulation();
    selectTool('inspect');
    notify('Release location placed. Set discharge and run the model.');
  }
  function inspect(index) {
    if (index < 0) { notify('Click inside the outlined study area.'); return; }
    probeIndex = index;
    if (map.getSource('probe-data')) map.getSource('probe-data').setData(pointGeoJSON(index));
    updateProbe();
  }
  function updateProbe() {
    if (!scenario || probeIndex < 0) return;
    const terrain = base[probeIndex] + deltas[probeIndex];
    const h = depth ? depth[probeIndex] : 0;
    const p = peak ? peak[probeIndex] : 0;
    $('depth-number').textContent = h.toFixed(2);
    $('ground-number').textContent = terrain.toFixed(1) + ' m';
    $('peak-number').textContent = p.toFixed(2) + ' m';
    $('water-level-number').textContent = (terrain + p).toFixed(1) + ' m';
    $('arrival-number').textContent = arrival && arrival[probeIndex] >= 0 ? fmtTime(arrival[probeIndex]) : '—';
    $('inspect-hint').textContent = cellLatLon(probeIndex).slice().reverse().map(n => n.toFixed(5)).join(', ');
  }
  function refreshStats(frame) {
    elapsed = frame.time;
    $('clock').textContent = fmtTime(frame.time);
    $('area-number').textContent = (frame.wetArea/1e6).toFixed(3) + ' km²';
    $('global-peak').textContent = frame.maxDepth.toFixed(2) + ' m';
    const duration = Number($('duration').value) * 60;
    $('timeline-fill').style.width = Math.min(100, frame.time / Math.max(duration,1) * 100) + '%';
    updateProbe();
  }
  function stop() {
    running = false; worker.postMessage({type:'pause'});
    if(movie)movie.setRunning(false);
    $('run-label').textContent = 'Resume simulation'; $('run-icon').textContent = '▶';
  }
  function resetSimulation() {
    if (!scenario || !worker) return;
    running = false;
    if(movie){movie.setRunning(false);movie.reset();}
    $('run-label').textContent = 'Run simulation'; $('run-icon').textContent = '▶';
    worker.postMessage({type:'init',width:scenario.width,height:scenario.height,cellSize:scenario.cellSize,
      elevation:Float32Array.from(base, (v,i) => v + deltas[i]).buffer});
    $('depth-number').textContent = '0.00';
  }
  function startOrPause() {
    if (!scenario || loading) { notify('Load a study area first.', true); return; }
    if (running) { stop(); status('Simulation paused'); return; }
    if (sourceIndex < 0) { selectTool('source'); notify('Click inside the study area to place the water source.'); return; }
    const discharge = Number($('discharge').value), duration = Number($('duration').value);
    if (!Number.isFinite(discharge) || discharge < 1 || discharge > 50000) {
      notify('Discharge must be between 1 and 50,000 m³/s.', true); return;
    }
    running = true;
    if(movie)movie.setRunning(true);
    worker.postMessage({type:'config',index:sourceIndex,discharge,duration:duration*60});
    worker.postMessage({type:'start'});
    $('run-label').textContent = 'Pause simulation'; $('run-icon').textContent = 'Ⅱ';
    status('Routing experimental flood flow');
  }
  async function loadArea() {
    if (loading || !map) return;
    const lat = Number($('latitude').value), lon = Number($('longitude').value);
    const extent = Number($('extent').value), resolution = Number($('resolution').value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>80 || Math.abs(lon)>180) {
      notify('Enter a valid latitude (-80–80) and longitude (-180–180).', true);return;
    }
    busy(true);
    status('Requesting real elevation tiles');
    try {
      if (worker) worker.postMessage({type:'pause'});
      const response = await fetch('/api/scenarios',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({lat,lon,extent,resolution})});
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Terrain service failed');
      if(movie){movie.exit();movie.reset();movie.setRunning(false);}
      scenario = payload;
      scenario.cellSize = payload.cellSize;
      base = Float32Array.from(payload.elevation);
      deltas = new Float32Array(base.length);
      sourceIndex = -1; probeIndex = -1; sampleEnd=-1;stations=[];lastFrame = null; revision = 0; depth = peak = arrival = null;
      $('source-position').textContent = 'Not placed';
      $('dem-detail').textContent = 'Mapzen DEM · ' + payload.cellSize.toFixed(1) + ' m cells';
      $('elev-detail').textContent = Math.round(payload.min) + '–' + Math.round(payload.max) + ' m';
      worker.postMessage({type:'init',width:scenario.width,height:scenario.height,cellSize:scenario.cellSize,
        elevation:base.slice().buffer});
      map.flyTo({center:[lon,lat],zoom:extent >= 10000 ? 12.5 : extent >= 8000 ? 13 : 14,
        pitch:64,bearing:-28,duration:1200,essential:true});
      if (map.isStyleLoaded()) setupScenarioLayers();
      updateStations();
      selectTool('inspect');
      status('Real terrain loaded · experimental model');
    } catch (error) { fail(error); }
    finally { busy(false); }
  }
  function showBrush(lngLat) {
    const cursor = $('sculpt-cursor');
    if (selectedTool !== 'dig' && selectedTool !== 'raise') { cursor.style.display='none';return; }
    const pos = map.project(lngLat);
    const offset = map.project({lng:lngLat.lng + (Number($('brush-radius').value)/
      (111320 * Math.cos(lngLat.lat * Math.PI/180))),lat:lngLat.lat});
    const radiusPixels = Math.min(350,Math.abs(offset.x - pos.x));
    cursor.style.display='block';
    cursor.style.left = pos.x + 'px'; cursor.style.top = pos.y + 'px';
    cursor.style.width = radiusPixels*2 + 'px'; cursor.style.height = radiusPixels*2 + 'px';
  }
  function paint(lngLat) {
    const index = toCell(lngLat);
    if (index < 0 || !scenario) return;
    const cx = index % scenario.width, cy = Math.floor(index / scenario.width);
    const radiusCells = Number($('brush-radius').value) / scenario.cellSize;
    const strength = Number($('brush-strength').value);
    const direction = selectedTool === 'dig' ? -1 : 1;
    for (let y = Math.max(0,Math.floor(cy-radiusCells)); y <= Math.min(scenario.height-1,Math.ceil(cy+radiusCells)); y++)
      for (let x = Math.max(0,Math.floor(cx-radiusCells)); x <= Math.min(scenario.width-1,Math.ceil(cx+radiusCells)); x++) {
        const d = Math.hypot(x-cx,y-cy);
        if (d > radiusCells) continue;
        const i = y*scenario.width+x;
        if (strokeCells.has(i)) continue;
        strokeCells.add(i);
        const weight = Math.pow(1 - d/(radiusCells+0.01), 1.3);
        deltas[i] = Math.max(-60,Math.min(60,deltas[i]+direction*strength*weight));
        changedCells.set(i,Math.round(deltas[i]*1000)/1000);
      }
  }
  async function finishStroke() {
    if (!isPainting) return;
    isPainting = false;
    suppressSculptClickUntil = performance.now() + 300;
    map.dragPan.enable();
    if (!changedCells.size) return;
    const changes = [...changedCells].map(([index,delta])=>({index,delta}));
    changedCells.clear();
    strokeCells.clear();
    busy(true);
    status('Updating sculpted 3D terrain');
    try {
      for (let start=0;start<changes.length;start+=7000) {
        const response = await fetch('/api/scenarios/'+scenario.id+'/edit',
          {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cells:changes.slice(start,start+7000)})});
        const result=await response.json();
        if (!response.ok) throw new Error(result.error || 'Terrain edit failed');
        revision=result.revision;
      }
      resetSimulation();
      updateStations();
      if (map.isStyleLoaded()) setupScenarioLayers();
      notify(changes.length.toLocaleString()+' terrain cells reshaped. Simulation reset.');
      status('Terrain edited · experimental model');
    } catch (error) { fail(error); notify('Reload terrain to restore server/client consistency.',true); }
    finally {busy(false);}
  }
  function saveScenario() {
    if (!scenario) {notify('Load terrain before exporting.',true);return;}
    const edited = [];
    deltas.forEach((d,i)=>{if(Math.abs(d)>0.001)edited.push([i,Math.round(d*1000)/1000]);});
    const payload = {
      format:'waterflow-scenario-0.1',created:new Date().toISOString(),experimental:true,
      source:'Mapzen AWS DEM',lat:scenario.bounds[3]-(scenario.bounds[3]-scenario.bounds[1])/2,
      lon:(scenario.bounds[0]+scenario.bounds[2])/2,extent:scenario.extent,resolution:scenario.width,
      sourceCoordinates:sourceIndex < 0 ? null : cellLatLon(sourceIndex),
      transectEnd:sampleEnd < 0 ? null : cellLatLon(sampleEnd),sampleIntervalM:Number($('station-spacing').value),
      dischargeM3s:Number($('discharge').value),releaseMinutes:Number($('duration').value),terrainEdits:edited,
      warning:'This is not a calibrated dam breach or engineering flood forecast.'
    };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='waterflow-scenario-'+Date.now()+'.json';a.click();
    URL.revokeObjectURL(url);
  }
  function initializeWorker() {
    worker=new Worker('/static/simulation-worker.js');
    worker.onerror=event=>{fail(new Error('Simulation worker crashed: '+event.message));stop();};
    worker.onmessage=event=>{
      const frame=event.data;
      if(frame.type==='trackRejected'){if(movie)movie.rejected(frame);return;}
      if(frame.type==='trackPlaced'){if(movie)movie.placed();return;}
      if(frame.type==='stopped'){running=false;if(movie)movie.setRunning(false);$('run-label').textContent='Run simulation';$('run-icon').textContent='▶';status('6-hour simulation limit reached');return;}
      if(frame.type!=='frame')return;
      depth=new Float32Array(frame.depth);
      peak=new Float32Array(frame.peak);
      arrival=new Float32Array(frame.arrival);
      lastFrame=frame;
      if(movie)movie.onFrame(frame);
      refreshStats(frame);
      if(performance.now()-lastFrameTime>115){
        updateOverlay();updateStations();lastFrameTime=performance.now();
      }
    };
  }
  function wire() {
    $('load-terrain').addEventListener('click',loadArea);
    document.querySelectorAll('[data-site]').forEach(button=>button.addEventListener('click',()=>{
      const place=SITES[button.dataset.site];
      $('latitude').value=place.lat;$('longitude').value=place.lon;
      loadArea();
    }));
    document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>selectTool(button.dataset.tool)));
    $('run').addEventListener('click',startOrPause);
    $('reset').addEventListener('click',()=>{resetSimulation();status('Simulation reset');});
    $('export').addEventListener('click',saveScenario);
    $('export-csv').addEventListener('click',exportStations);
    $('station-spacing').addEventListener('input',()=>{$('station-spacing-value').textContent=$('station-spacing').value+' m';});
    $('brush-radius').addEventListener('input',()=>{$('brush-radius-value').textContent=$('brush-radius').value+' m';});
    $('brush-strength').addEventListener('input',()=>{$('brush-strength-value').textContent=$('brush-strength').value+' m';});
    $('duration').addEventListener('input',()=>{$('duration-value').textContent=$('duration').value+' min';if(scenario)resetSimulation();});
    $('discharge').addEventListener('change',()=>{if(scenario)resetSimulation();});
    $('live-depth').addEventListener('click',()=>setDepthMode('live'));
    $('max-depth').addEventListener('click',()=>setDepthMode('max'));
    $('hide-ui').addEventListener('click',()=>{document.body.classList.toggle('ui-hidden');map.resize();});
    $('satellite').addEventListener('click',()=>setMapStyle('satellite'));
    $('streets').addEventListener('click',()=>setMapStyle('streets'));
    $('globe-toggle').addEventListener('click',()=>{
      globeView=!globeView;
      $('globe-toggle').classList.toggle('selected',globeView);
      map.setProjection({type:globeView?'globe':'mercator'});
      if(globeView)map.easeTo({zoom:Math.min(map.getZoom(),5),pitch:20,duration:900});
      else if(scenario)map.easeTo({center:[scenario.lon,scenario.lat],zoom:13.5,pitch:64,duration:900});
    });
    $('terrain-toggle').addEventListener('click',()=>{
      terrain3d=!terrain3d;
      $('terrain-toggle').classList.toggle('selected',terrain3d);
      if(map.getSource('scenario-dem'))map.setTerrain(terrain3d?{source:'scenario-dem',exaggeration:1.25}:null);
    });
    document.addEventListener('keydown',event=>{
      if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;
      if(event.code==='Space'){event.preventDefault();startOrPause();}
      else if(event.code==='Escape')selectTool('inspect');
    });
  }
  function setDepthMode(mode) {
    depthMode=mode;
    $('live-depth').classList.toggle('selected',mode==='live');
    $('max-depth').classList.toggle('selected',mode==='max');
    updateOverlay();
  }
  function setMapStyle(style) {
    if(style===styleMode)return;
    styleMode=style;
    $('satellite').classList.toggle('selected',style==='satellite');
    $('streets').classList.toggle('selected',style==='streets');
    map.setStyle(style==='satellite'?imageryStyle:streetStyle);
  }
  function initMap() {
    // Preserve geographic context when returning from the advanced simulator.
    const launch=$('advanced-launch');
    if(launch)launch.addEventListener('click',event=>{
      event.preventDefault();
      const url=new URL('/studio/',window.location.origin);
      for(const [query,id] of [['lat','latitude'],['lon','longitude'],['extent','extent']]){
        const value=Number($(id).value);
        if(Number.isFinite(value))url.searchParams.set(query,String(value));
      }
      window.location.assign(url.pathname+url.search);
    });
    const incoming=new URLSearchParams(window.location.search);
    const lat=Number(incoming.get('lat')),lon=Number(incoming.get('lon'));
    if(incoming.has('lat') && incoming.has('lon') &&
      Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=80&&Math.abs(lon)<=180){
      $('latitude').value=lat;$('longitude').value=lon;
    }
    if(!window.maplibregl){fail(new Error('Map renderer unavailable. Check internet access or CDN.'));return;}
    initializeWorker();wire();
    map=new maplibregl.Map({
      container:'map',style:imageryStyle,center:[Number($('longitude').value),Number($('latitude').value)],
      zoom:13.4,pitch:67,bearing:-28,antialias:true,maxPitch:85,
      attributionControl:true
    });
    map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
    movie = new window.WaterflowMovie.MovieMode({
      map,worker,getScenario:()=>scenario,
      notify,pause:()=>{if(running)stop();},toggleRun:startOrPause,selectTool
    });
    map.on('style.load',()=>{if(scenario)setupScenarioLayers();});
    map.once('load',loadArea);
    map.on('error',event=>{
      if(!event.error)return;
      const message=event.error.message||String(event.error);
      console.warn('Waterflow map:',message);
      if(message.includes('/api/scenarios/') && performance.now()-lastTerrainErrorTime>10000){
        lastTerrainErrorTime=performance.now();
        notify('Real elevation tiles failed to render. The 3D terrain view may be incomplete.',true);
      }
    });
    map.on('click',event=>{
      if(loading || isPainting || !scenario)return;
      const index=toCell(event.lngLat);
      if(selectedTool==='source')setSource(index);
      else if(selectedTool==='inspect')inspect(index);
      else if(selectedTool==='transect')createTransect(index);
      else if(selectedTool==='tag'){
        if(index<0 || !depth || depth[index]<0.1)
          notify('Tag a currently wet modeled water cell (at least 0.1 m deep).',true);
        else if(movie)movie.place(index);
      }
      else if((selectedTool==='dig' || selectedTool==='raise') && performance.now() >= suppressSculptClickUntil){
        // Touch tap has no desktop mousedown; desktop strokes already applied.
        changedCells.clear();strokeCells.clear();paint(event.lngLat);
        isPainting=true;finishStroke();
      }
    });
    map.on('mousedown',event=>{
      if(!scenario || loading || (selectedTool!=='dig' && selectedTool!=='raise'))return;
      if(event.originalEvent.button!==0)return;
      isPainting=true;changedCells.clear();strokeCells.clear();
      map.dragPan.disable();
      paint(event.lngLat);
    });
    map.on('mousemove',event=>{
      showBrush(event.lngLat);
      if(isPainting && !loading)paint(event.lngLat);
    });
    map.on('mouseout',()=>{$('sculpt-cursor').style.display='none';});
    map.on('mouseup',finishStroke);
    window.addEventListener('mouseup',finishStroke);
    map.on('touchstart',()=>{$('sculpt-cursor').style.display='none';});
    selectTool('inspect');
  }
  initMap();
})();
