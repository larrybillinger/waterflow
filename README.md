# Waterflow

A full-screen, 3D, map-based terrain and flood experimentation lab. Fly across real-world terrain, excavate or raise land with a brush, release a hypothetical flow, and inspect animated depth, arrival time, and high-water levels.

**Status: v0.2.0 experimental prototype. NOT a flood forecast, evacuation tool, or engineering-grade dam-break model.**

## What works in v0.2

- Pitched, rotatable 3D earth-style map with satellite and street styles.
- Public Mapzen/AWS elevation tiles provide the bare-earth digital elevation model (DEM); never substitute invented elevation on retrieval failures.
- Choose a real-world area; inspect source elevation and terrain resolution.
- Excavate or raise terrain by brushing on the map. DEM tiles are updated for the interactive 3D display.
- Place a hypothetical release point; set constant discharge (m³/s) and release duration.
- Worker-thread, mass-limited 2D local-inertial shallow-water approximation; visualize current or maximum depth.
- Click to inspect ground elevation, current depth, maximum depth, modeled maximum water-surface elevation, and first wetting time.
- Draw a **straight-line sample transect** from the release point with stations every 100–1,000 m and download peak-depth/first-wetting measurements as CSV.
- Optional whole-earth globe navigation in addition to local 3D terrain.
- Download a scenario JSON snapshot. Simulations reset after terrain/source changes.
- Cinema mode: tag a wet simulated water point, choose a visual raft with rider or a glowing tracer dot, and follow the modeled downstream flow through a smooth 3D camera.
- Switch between chase, aerial and wide camera perspectives, or drag to return to free navigation.
- Replay/scrub the recorded route at selectable speed, or export the path as CSV. Movie mode is in-browser playback, not an MP4 exporter.

## Run locally

Requires Python 3.11+.

    python -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn server.app:app --host 127.0.0.1 --port 8086

On Windows use .venv\Scripts\activate instead. Open http://localhost:8086.

Alternatively:

    docker compose up --build -d
    docker compose logs -f

Open http://localhost:8086. Change host port in compose before deploying alongside other apps. The default binding is local-only (127.0.0.1); make an intentional decision before exposing publicly. Internet access is needed for map styles, imagery, JavaScript CDN, and public DEM tiles.

## Controls

1. Navigate and rotate/tilt the 3D map. Choose a study area with **Load terrain**.
2. Choose **Source** and click where water should enter the modeled domain.
3. Adjust discharge and release time; select **Run** to begin.
4. Select **Inspect** to measure modeled depths on the map. Switch between live depth and maximum depth.
5. Choose **Sample line**, click a downstream endpoint, and download station readings as CSV. The line does not automatically trace a river.
6. Select Enter movie mode (section 05). Run the simulation, click Tag water, then click inside a wet cell (at least 0.1 m deep) to drop the illustrated raft or water marker. The mode runs the physics at about 8 simulated seconds per real second for smoother viewing. Use Follow, camera presets or Replay path (after two or more samples).
7. Pause, reset, excavate, or raise ground to compare scenarios. Drag terrain brush on the map and release the pointer to apply the 3D terrain update.

The modeled rectangle is deliberately limited in size to keep real-time experimentation responsive. Zooming outside it still shows real-world terrain, but only the outlined area is simulated.

## Cinematic tracking limits

The tracked raft is **not** an independently modeled buoyant object or a route safe for watercraft. It is an illustrated marker following a passive surface-tracer approximation based on depth-averaged signed water flux between simulation cells. Real-world wind, eddies, paddling, collisions, obstacles, currents below grid resolution, and injury risk are not represented. The marker becomes stranded when water falls below 0.1 m and exits at the model boundary.

The browser stores at most the latest 4,500 route samples. **Replay moves only the tracked marker; the flood-depth overlay stays at its latest simulated frame** and does not rewind. Neither video recording nor exported MP4 is included in v0.2.

## Model assumptions & important limitations

This version **does not** compute a dam breach from reservoir storage, bathymetry, dam construction, breach geometry, or breach formation time. User-entered point release is a prescribed hydrograph, not a derived dam-failure discharge. Bare-earth DEMs do not faithfully depict underwater channels, bridge decks, culverts, levee interiors, or reservoirs. Initial conditions are dry; no observed streamflow or live weather is assimilated. Boundary cells use a simplified outflow approximation; spatially uniform roughness is assumed. The 3D water heatmap is draped on the terrain rather than a physically raised water surface. Peak depths are simulated estimates at grid-cell scale, **not actual surveyed high-water marks**.

For credible real-world flood maps, integrate local USGS 3DEP 1 m/3 m terrain and bathymetry, engineered hydraulic structures, reservoir storage-stage curves, HEC-RAS 2D breach hydrographs, calibration gauges and uncertainty bounds. Never use this prototype for emergency planning.

## Sources and licensing

- [AWS Terrain Tiles / Mapzen DEM](https://registry.opendata.aws/terrain-tiles/) — bare-earth elevation, source attribution applies.
- [USGS 3DEP](https://www.usgs.gov/3d-elevation-program/) — planned high-resolution US terrain.
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) — map renderer.
- [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) — imagery; attribution in map.
- [OpenFreeMap](https://openfreemap.org/) — street basemap.
- Bates, P. D., Horritt, M. S. and Fewtrell, T. J. (2010), "A simple inertial formulation of the shallow water equations for efficient two-dimensional flood inundation modelling", *Journal of Hydrology*. Implementation is original, simplified, and not validated against benchmark models.
- [USACE HEC-RAS dam-breach guidance](https://www.hec.usace.army.mil/confluence/rasdocs/ras1dtechref/latest/performing-a-dam-break-study-with-hec-ras/estimating-dam-breach-parameters/estimating-breach-parameters).

## Repository organization

- web/ — full-screen map UI, Web Worker solver, passive tracer, movie controller and illustrated raft asset.
- server/ — FastAPI static host and DEM tile/scenario endpoints.
- tests/ — DEM conversion, geometry and scenario API tests.
- docs/ — architecture, model notes, permissions and validation.
- planning/ — project decisions, risks and sprint acceptance criteria.
- notes/release-notes/ — version release history.

## Updating

    git pull
    docker compose up -d --build

## Known issues

Requires external providers and WebGL. Fine terrain features smaller than model cells cannot be resolved. Flood fronts and lateral flows are qualitative approximations; documented validation is required before promoting any numerical results as real-world predictions.
