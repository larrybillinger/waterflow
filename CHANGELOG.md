# Changelog

## v0.2.0 — 2026-11-19

### Added
- Immersive cinematic camera following a tagged wet model cell.
- Stylized raft/rider and high-visibility water tracer modes.
- Flux-derived passive marker tracking with dry-ground stranding and domain exit.
- Chase, aerial, wide and free camera controls.
- Reduced simulation pacing while filming, recorded route replay and scrub.
- Export of modeled route position, water depth, speed, distance and state as CSV.
- Automated tracer advection, boundary and path interpolation tests.

### Limitations
- Raft visual is not a physical flotation or collision model.
- Replay does not rewind the depth shading; no downloadable video recording.
- Browser performance and hydraulic validation remain unverified.

## v0.1.0 — 2026-11-19

### Added
- 3D fullscreen geographic map with satellite/street layers, orbit/tilt and terrain.
- Terrain loading from public Mapzen/AWS Terrarium elevation tiles.
- In-memory study scenarios with terrain sculpting reflected in 3D terrain tiles.
- Experimental 2D finite-volume local-inertial water routing in a Web Worker.
- Point discharge, time controls, depth/peak overlays, inspection readouts and JSON scenario export.
- Whole-earth globe toggle and downstream straight-line depth station sampling with CSV export.
- Numerical mass-balance/positivity tests and face-buffer reuse to reduce memory churn.
- FastAPI/Docker app, project planning, model limitations and basic tests.

### Known issues
- Uncalibrated physical model; simplistic point source and boundary condition, no true reservoir storage or evolving breach.
- Upstream terrain / imagery providers and hosted MapLibre scripts require internet access.
