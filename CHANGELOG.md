# Changelog

## v0.3.1 — 2026-11-19

- Added a containerized CI smoke test that serves both integrated apps and fetches a real generated Studio JS bundle.
- Checks API health, navigation links, asset routing and rejection of an unapproved tile proxy host.
- Added Docker build exclusions for node_modules, credentials, logs and generated outputs.
- Improved integration validation documentation. No hydraulic equations or frontend simulation behavior changed.

## v0.3.0 — 2026-11-19

- Added Claude-derived Advanced Dam Studio under /studio/, preserving Classic MapLibre Terrain Lab at /.
- Advanced Studio offers reservoir creation, evolving dam-breach model, WebGL2 GPU flood routing, raised water with shaders, richer terrain edits, D8 stations, hydrographs and five cinematic views.
- Added two-way geographic location handoff, same-origin Docker build and combined CI.
- Added strictly allowlisted HTTPS terrain/imagery tile proxy.
- Replaced Studio's automatic fictional terrain fallback with explicit ?demo=1; permanently label synthetic/partial data.
- Corrected Studio package license metadata to GPL-3.0 to agree with actual LICENSE.
- Documented distinct hydraulic solvers and unresolved real-world calibration.

## v0.2.0 — 2026-11-19

- Added passive water-flow tracking, illustrated raft movie mode, recording and route CSV.

## v0.1.0 — 2026-11-19

- First MapLibre 3D terrain app with public DEM, digging/raising, Worker solver and downstream depth estimates.
