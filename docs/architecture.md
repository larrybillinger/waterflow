# Architecture

Browser: MapLibre GL JS WebGL map, raster and 3D DEM terrain; image-source draped flood overlay and GeoJSON study rectangle, source/inspection point, and optional straight-line stations. Standalone module-free JavaScript in web/app.js. Worker web/simulation-worker.js runs water routing away from the UI thread. The passive route tracker in web/flow-tracker.js derives marker velocity from signed face flux; web/movie.js handles the camera, map marker and path replay.

Server: FastAPI serves static web assets, bounds validated scenario requests, downloads public AWS/Mapzen Terrarium PNG tiles, samples DEM cell centers and hosts edited DEM raster tiles under a session ID. Only the fixed upstream hostname is contacted. Tile cache is bounded LRU. Scenario grids are transient and limited to 12 sessions/1 hour. There is no database or login. Each scenario is identified by a random 128-bit opaque ID; treat it as a capability and avoid publicly exposing the service without authentication.

Flow: load area -> server assembles fixed-size real elevation grid -> client initializes worker and 3D DEM source -> choose source/discharge -> worker steps model -> client updates flood overlay -> probe/peak readings. Terrain brush changes grid heights in browser; patch edited delta values to server to update DEM tiles; reset worker when terrain changes.

Data: elevations in meters relative to source DEM vertical datum (not guaranteed NAVD88); grid dimensions and coordinates from server; cell spacing approximated local WGS84 tangent plane in meters; simulation depths in meters; Q in m³/s and time in seconds. Geo coordinates are [longitude, latitude]. Pixel grid row zero is north, column zero west.

Rendering: public imagery + map labels, maplibre raster-dem 3D geometry, transparent interpolated flood depth color raster. Edited DEM tiles use original Terrarium encoding. The water color is draped, NOT an elevated 3D fluid mesh. Satellite imagery itself does not reflect terrain excavation.

## v0.3 dual engine integration

The existing FastAPI/MapLibre Classic frontend remains at / and /static. Claude's independent project has been imported into studio/ from the original claude/flood-simulator branch, commit 1445719f22388830c07f81d3044c9ffb0f52f345.

Docker first builds studio/ with Node 22 and Vite (relative asset base), then copies its dist/ into the existing Python image. FastAPI mounts the static bundle at /studio/. The browser executes the GPU Studio simulation entirely on WebGL2; the Python app does not run the GPU hydraulic solver. A direct-navigation link in each UI switches modes.

Classic retains Python-hosted public DEM tiles, server-side terrain edit sessions and a JavaScript worker that routes prescribed discharge. GPU Studio directly fetches and resamples terrain tiles, constructs dam terrain/reservoir storage, runs progressing breaches in floating point GPU textures, and renders 3D terrain and a distinct water mesh through Three.js. Each keeps its own boundary conditions, grids, outputs and scenarios. There is no shared state or data interchange in v0.3.

GPU Studio's standalone Express tile proxy exists in studio/server but is not active in the combined Python Docker container; the Vite build uses direct public URLs.

The top-level mode links transfer only validated latitude and longitude via URL parameters. They never transfer water state, dam geometry, scenario files or simulation output. Studio's initial URL location parser has dedicated tests and refuses invalid/out-of-range coordinates.
