# Validation

Automated: pytest -q (Terrarium encoding, bounds, parameter validation, upstream failures, scenario edits and image conversion). Manually confirm at multiple real locations that DEM values are consistent with public topo sources; rotate, pitch, zoom and check editing affects 3D geometry; inspect source/probe map positions; run constant releases with two grid sizes and check conservation and non-negative depth; compare against a simple sloping flume benchmark. Confirm source fetching errors are displayed rather than silently falling back to invented terrain.

Browser: test current Chrome/Edge/Firefox, desktop and mobile; test touch controls, keyboard focus, responsive panels, WebGL memory and tile provider availability. Docker: docker compose up -d --build and /api/health. No live provider integration, numerical calibration, performance benchmark or browser automation has yet been completed. Do not claim engineering validation.
