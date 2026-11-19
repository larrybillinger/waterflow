# Architecture

Browser: MapLibre GL JS WebGL map, raster and 3D DEM terrain; image-source draped flood overlay and GeoJSON study rectangle. Standalone module-free JavaScript in web/app.js. Worker web/simulation-worker.js runs water routing away from the UI thread.

Server: FastAPI serves static web assets, bounds validated scenario requests, downloads public AWS/Mapzen Terrarium PNG tiles, samples DEM cell centers and hosts edited DEM raster tiles under a session ID. Only the fixed upstream hostname is contacted. Tile cache is bounded LRU. Scenario grids are transient and limited to 12 sessions/1 hour. There is no database or login. Each scenario is identified by a random 128-bit opaque ID; treat it as a capability and avoid publicly exposing the service without authentication.

Flow: load area -> server assembles fixed-size real elevation grid -> client initializes worker and 3D DEM source -> choose source/discharge -> worker steps model -> client updates flood overlay -> probe/peak readings. Terrain brush changes grid heights in browser; patch edited delta values to server to update DEM tiles; reset worker when terrain changes.

Data: elevations in meters relative to source DEM vertical datum (not guaranteed NAVD88); grid dimensions and coordinates from server; cell spacing approximated local WGS84 tangent plane in meters; simulation depths in meters; Q in m³/s and time in seconds. Geo coordinates are [longitude, latitude]. Pixel grid row zero is north, column zero west.

Rendering: public imagery + map labels, maplibre raster-dem 3D geometry, transparent interpolated flood depth color raster. Edited DEM tiles use original Terrarium encoding. The water color is draped, NOT an elevated 3D fluid mesh. Satellite imagery itself does not reflect terrain excavation.
