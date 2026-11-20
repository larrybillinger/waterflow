# Sprint 003 blueprint

Vendor Claude source as studio/ Git subtree. Vite builds compiled studio/dist at Docker build time; FastAPI serves both / and /studio/. Classic entry contains a Studio launch link with bounded lat/lon/extent handoff, Studio has a return link. Studio DEM errors block by default; ?demo=1 allows persistently labeled synthetic terrain. Compile VITE_TILE_PROXY=/api/tiles and implement a strict HTTPS fixed-host/path cache proxy. Add Studio Node lint, tests and production build to GitHub CI, preserving original Python and Node tests.
