# Validation

Automated: pytest -q (Terrarium encoding, bounds, parameter validation, upstream failures, scenario edits and image conversion). Manually confirm at multiple real locations that DEM values are consistent with public topo sources; rotate, pitch, zoom and check editing affects 3D geometry; inspect source/probe map positions; run constant releases with two grid sizes and check conservation and non-negative depth; compare against a simple sloping flume benchmark. Confirm source fetching errors are displayed rather than silently falling back to invented terrain.

Browser: test current Chrome/Edge/Firefox, desktop and mobile; test touch controls, keyboard focus, responsive panels, WebGL memory and tile provider availability. Docker: docker compose up -d --build and /api/health. No live provider integration, numerical calibration, performance benchmark or browser automation has yet been completed. Do not claim engineering validation.

CI additionally executes Node worker tests that confirm finite/nonnegative depths, mass balance of input volume versus storage plus reported edge outflow, dry-run behavior and reset. A green CI run is **not** validation against observed floods, river physics, or browser rendering.


## Sprint 002 tests

Run node --check for web/app.js, web/simulation-worker.js, web/flow-tracker.js and web/movie.js. Run node tests/flow-tracker-test.cjs and node tests/worker-test.cjs, plus pytest -q. New tests cover flux-derived east movement, heading interpolation, dry-area stranding, bounding box exits, tracker acceptance/rejection and resets.

Browser verification outstanding: inspect live source/wet placement, replay, pause/resume, three camera perspectives and free navigation, mobile HUD, map style toggle, editing reset, route CSV and performance. Test with actual terrain sources and WebGL. Automated unit tests do not validate flood hydraulics or 3D map rendering.
