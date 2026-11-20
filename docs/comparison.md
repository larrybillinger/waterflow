# Waterflow implementation comparison — 2026-11-19

This comparison uses Waterflow Classic at main commit 2af37b39c8668778625bc8921c611cfa49d64674 and Claude's independent branch claude/flood-simulator at commit 1445719f22388830c07f81d3044c9ffb0f52f345.

| Feature | Classic (ChatGPT) | Advanced Studio (Claude) | Integration |
| --- | --- | --- | --- |
| World navigation | MapLibre 3D satellite/street map and whole-earth globe | Three.js local 3D terrain with Earth-like orbit and zoom | Retain Classic for geographic exploration |
| Input | Prescribed point discharge and release duration | Place a dam and fill a DEM-based reservoir; evolve a breach | Use Studio for hypothetical dam failures |
| Water solver | 2D local-inertial approximation on CPU Web Worker | 2D local-inertial equations on WebGL2/GPU with adaptive CFL, Froude limiter and volume readout | Keep independent, do not mix state |
| Water display | Depth-colored terrain raster, not a physical water mesh | Elevated water geometry, Beer–Lambert transparency, lighting, foam, sediment and flow-driven ripples | Studio is stronger visually |
| Editing | Excavate/raise terrain brush | More terrain brushes plus patch-based undo | Studio is more capable |
| Measurements | Manual straight-line transect, peak depth and arrival CSV | D8 valley routing and cross sections, peak water elevation, width, speed, arrival and hydrographs | Studio offers richer downstream analysis |
| Movie mode | Illustrated raft or dot, three perspectives and path CSV/replay | Three-dimensional raft, chase, onboard, orbit, watch-point and flyover camera | Keep both; use Studio for advanced cinematics |
| Validation | Python API tests; Node worker conservation, tracer and UI-contract tests | Source branch reports 218 unit tests and 41 headless-browser checks, including offline GPU rendering | Run both in shared CI; real-world validation still missing |
| Deployment | FastAPI and Docker | Vite + Three.js, optional Node tile proxy | Build Studio assets into existing FastAPI container |

## Decision

Import Studio as an advanced route at /studio/, keep the original map at /. Both form one navigable web site, not a single hydraulic engine. The classic point-release workflow must remain intact. Geographic lat/lon and study extent are passed during navigation, but no terrain-edit, breach, reservoir or flow state is shared.

This isolates incompatible GPU textures, coordinate conventions and breach/source assumptions. It also preserves MapLibre's globe view without giving up Studio's superior dam and raised-water pipeline.

## Features ported as deployable capabilities

- GPU terrain/water renderer with a visibly raised flood surface.
- Reservoir, dam placement and progressive breach parameters, rather than only arbitrary injection.
- D8 routing, cross-sectional station results, velocities, arrival times, flood widths and hydrographs.
- Undoable terrain work, richer cinematic raft cameras and higher-resolution domain controls.
- Studio's detailed hydraulic documentation, numerical tests and browser verification harness.
- Restricted same-origin tile proxy adapted from Claude's optional caching approach.

## Problems corrected for integration

- Synthetic fallback: Studio's original automatic synthetic valley is **disabled by default**. Only explicit ?demo=1 permits a fictional DEM, and a permanent warning is displayed. No invented relief should silently appear as a real geographic location.
- License: Claude's README/package said MIT, while LICENSE in the same repository is GPL-3.0. Package metadata and documentation were aligned with the actual LICENSE.
- GPU browser requirements: Studio requires WebGL2 with floating-point render targets. Classic remains available for devices that cannot run the GPU simulator.

## Accuracy

Neither implementation has been compared with surveyed flood levels or a validated site-specific HEC-RAS model. Unit tests and synthetic-browser scenarios validate implementation behavior, not real-life predictions. The map can resolve only features in the source DEM and model grid, and both engines simplify structures, bathymetry and real hydrologic conditions. Results cannot support emergency or engineering decisions.

## Future unification

After browser checks, benchmarking and real-world comparison: consider a shared scenario JSON with an explicit source-type discriminator, stored terrain edits, and a provenance/vertical-datum contract; scenario interchange is out of scope in v0.3.
