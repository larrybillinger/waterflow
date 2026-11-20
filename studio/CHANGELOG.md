# Changelog

All notable changes to Waterflow are recorded here. Versions follow `MAJOR.MINOR.PATCH`.

## v0.1.0 — 2026-11-19

First working build. Branch `claude/flood-simulator`.

### Added

- **Elevation loading** from AWS Open Data Terrain Tiles, keyless, with Web Mercator tile
  indexing, Terrarium decoding, nodata filling and area-averaged resampling into the
  simulation grid. Falls back to a synthetic valley with a clear notice if the source is
  unreachable, so a network failure never produces a blank screen.
- **Map imagery** from USGS National Map, Esri World Imagery or OpenStreetMap, with a
  fallback chain and a final fallback to hillshade and hypsometric colouring.
- **GPU flood solver** implementing the local inertial approximation of the shallow water
  equations (Bates, Horritt & Fewtrell 2010) in WebGL2 fragment shaders, with an adaptive
  CFL timestep held in a texture, a Froude limiter, a positivity-preserving flux limiter,
  and per-cell accumulation of maximum depth, peak velocity and flood arrival time.
- **Dam building**: two clicks lay a dam across a valley. The crest becomes real terrain
  with sloped batters, and the reservoir fills behind it.
- **Reservoir** defined by connected flood fill, so volume and surface area come from the
  real shape of the ground, with a storage-elevation curve.
- **Breach modelling** with user control over the percentage of dam length that fails, the
  depth it cuts and the formation time, plus linear, sinusoidal, quadratic and instant
  progression curves. The breach is cut out of the terrain over time rather than injected
  as a hydrograph, so mass is conserved end to end.
- **Published breach estimates** from Froehlich (2008), Froehlich (1995) and Von Thun &
  Gillette (1990), each with its own units and caveats surfaced in the interface.
- **Analytic peak outflow cross-check** from trapezoidal weir discharge, drawn on the
  hydrograph as a reference line against the simulated peak.
- **Results** at user-set increments down the valley: ground elevation, peak water surface,
  peak depth, flood width, peak velocity and arrival time, with a long profile chart, a
  sortable table, map overlays for depth, arrival and velocity, and CSV export whose
  header carries the run settings and the limitations notice.
- **Downstream path tracing** by priority flood depression filling and D8 flow directions,
  used to place stations without altering the terrain the solver sees.
- **Terrain editing**: raise, excavate, smooth, level, carve channel and build levee, with
  a patch-based undo stack and an earthworks volume readout.
- **3D renderer** with vertex-displaced terrain, draped imagery, DEM-derived relief
  shading, and a water surface with Beer-Lambert depth absorption, Fresnel reflection of
  an analytically evaluated sky, flow-driven ripples, sediment tinting that rises with
  speed, and Froude-based foam.
- **Google-Earth-style camera**: grab-and-drag panning that keeps the grabbed point under
  the cursor, zoom toward the cursor, damped orbit and tilt, keyboard navigation and
  touch support.
- **Movie mode**: drifting rafts advected on the simulated velocity field with a
  second-order integrator, a procedural raft and rider, a trail showing the path
  travelled, tagged watch points, and chase, onboard, orbit, watch and valley flyover
  cameras with a cinematic presentation mode.
- **Browser verification harness** (`npm run verify`) that drives a real Chrome through a
  full scenario and asserts 41 behavioural and physical checks.
- 218 unit tests, including a CPU reference implementation of the solver used to assert
  mass conservation, wetting and drying, and the Froude limiter.

### Known issues

- Elevation is limited to roughly 10 m resolution in the United States and coarser
  elsewhere. Features narrower than one cell are averaged away. See risk R-001.
- Manning's n is a single value for the whole domain. See open question Q-002.
- Results within roughly 15 cells of the breach are flagged as indicative, because the
  local inertial approximation is least reliable in the supercritical near field. See
  risk R-002.
- Arrival times can invert slightly between adjacent stations where their cross-sections
  overlap and clip a meander. Observed inversions are a fraction of a percent of the
  total travel time.
- Scenarios cannot yet be saved and reloaded. See open question Q-004.
- The water reflects the sky but not the terrain, so a hillside at a grazing angle reads
  slightly too bright. See decision D-008.
