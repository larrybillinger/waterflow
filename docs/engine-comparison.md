# Waterflow engine comparison — 2026-11-19

## Source and scope

Compared the repository default branch (Classic v0.2.0, commit 2af37b39c8668778625bc8921c611cfa49d64674) with Claude's independently developed claude/flood-simulator (commit 1445719f22388830c07f81d3044c9ffb0f52f345). Both descend from the same initial commit and are distinct systems. This is a source-code and documentation review, not independent validation of hydraulic performance or real-world flood accuracy.

## Feature matrix

| Capability | Classic v0.2 | Claude GPU project | v0.3 result |
| --- | --- | --- | --- |
| 3D visualization | MapLibre raster DEM, satellite/street, globe, image-based flood shading | Three.js terrain, water mesh with GLSL lighting and depth dynamics | Both modes; switch from common header |
| Public DEM | FastAPI fetch of AWS Terrarium tiles, missing tile aborts | Browser fetch, stitch/resample, neighbor-fill, synthetic demo fallback on total outage | Both modes with distinct provenance notices |
| Dam building | No impoundment geometry | Two-click dam with height/crest width | GPU Studio |
| Reservoir | Prescribed source Q; no volume-storage curve | Terrain-constrained pool mask and storage/area | GPU Studio |
| Breach | Fixed point discharge and release duration | Published breach parameter regressions, breach width/depth/formation time progression | GPU Studio |
| Hydraulic solver | CPU JavaScript Web Worker, reduced local inertial approximation with point source | WebGL2 floating point fragment shaders, local inertial PDE model, adaptive control timestep | Separate algorithms; neither certified |
| Wetting stats | Current/maximum depth, arrival; station line probes | Maximum depth, peak velocity, arrival, flood width, surface elevation and hydrograph | GPU Studio has richer outputs |
| Valley stations | Straight user-drawn transect | Priority-flood/D8 routed path and measured cross-sections | GPU Studio |
| Terrain manipulation | Raise/excavate brush, server-side edited raster DEM | Raise/excavate/smooth/level/channel/levee with undo | GPU Studio |
| Movie mode | Wet-only passive tracer, illustrated raft, chase/aerial/wide, path scrub/CSV | Drifter, chase/onboard/orbit/watch/flyover, animated 3D viewpoint | Both, with complementary controls |
| Unit tests | Python API, Node physics and tracer tests | Source repo has hydraulic/breach/reservoir/station/geo tests and browser harness | Both run independently in CI |
| Hosting | FastAPI + Docker port 8086 | Vite static site + optional Node cache, default port 8099 dev | Same Python origin at / and /studio/ after build |

## Integration rationale

The GPU solver stores flux and depth in floating point WebGL render-target textures, which are also directly sampled by Three.js terrain/water shaders and the drifter. Classic's JS worker holds Float32 typed arrays and publishes frame image layers to MapLibre. Transplanting individual shader source into the Classic worker without porting the entire memory model, timestep, domain, breach and rendering code would be a misleading or broken hybrid.

Accordingly, v0.3 preserves the full Claude engine as an advanced subproject and exposes it under the same domain. It is substantially more useful than merely linking to a different Git branch: the same Docker service builds, tests and serves both modes. A subsequent sprint can determine if the GPU engine should become the primary experience and how to carry Classic scenario features across.

## Scientific accuracy cautions

Claude documents published local-inertial shallow-water, Froehlich regressions, Manning roughness and D8 routing. This is stronger physical modeling than Classic's prescribed point Q, but equations alone do not validate an inundation prediction. Its source contains synthetic terrain fallback, single uniform roughness, no bridges, no culverts, no spatial landcover, no 3DEP local LiDAR importer and no observed flood calibration in this repository.

Classic currently has a conservative policy of rejecting absent real DEM entirely; Studio permits a distinctly labeled synthetic demonstration. A permanent synthetic indicator was added to Studio for v0.3. Estimated depths, arrival times, widths and velocities MUST NOT be described as measured ground-truth values.

### Integration acceptance evidence

- Original Claude project claims 218 unit tests and 41 real-browser checks in its project-state document. These were claims in the reviewed source, not independent reproduction of its original verification session.
- In integrated GitHub Actions, lint, Vitest unit tests and Vite build are executed, alongside Classic's Python/Node tests.
- This integration has no measured field benchmarks, no synchronized scenario interchange and no production external tile/WebGL end-to-end evidence at the time of authorship.

## Next sprint candidates

1. Compare and calibrate both engines against one identical terrain DEM, surveyed geometry and known inflow hydrograph. Record uncertainty and numerical mass balance.
2. Make a common scenario interchange format with units, coordinate reference system, vertical datum, grid and hydraulic provenance.
3. Evaluate whether Studio should replace the Classic homepage. Retain Classic's globe and simple release workflow if doing so.
4. Bring synchronized movie frame capture and video exports after browser codec and imagery licensing checks.
5. Introduce high-resolution lidar DEM import and physically relevant infrastructure representation.
