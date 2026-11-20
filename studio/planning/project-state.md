# Project State

Last updated: 2026-11-19

Integrated into the Waterflow v0.3.0 site at `/studio/`, alongside the Classic Terrain Lab. The advanced engine retains its own v0.1.0 internal implementation version. New cross-engine navigation carries approximate geographic centres, not hydraulic scenario state. Real DEM failures require explicit `?demo=1` fictional-terrain opt-in. This integration has its own CI and manual validation requirements.
Current version: v0.1.0
Active sprint: `planning/sprints/sprint-001`
Active branch: `claude/flood-simulator`

## Status

Sprint 001 complete. First working build of the simulator.

Waterflow currently does the following end to end, in the browser, with no API keys:

1. Fetches public Terrarium elevation tiles for a user-chosen location and domain size,
   stitches them, and resamples them into a square simulation grid.
2. Drapes public satellite or topographic imagery over the terrain, with a DEM-derived
   hillshade and hypsometric fallback when imagery is unavailable.
3. Renders the terrain and water in 3D with a Google-Earth-style camera.
4. Lets the user place a dam across a valley with two clicks, fill the reservoir to a
   chosen water surface elevation, and read off the impounded volume and surface area.
5. Computes breach geometry and formation time from the Froehlich (2008) regression
   equations, or accepts the user's own breach width, depth and duration.
6. Runs a 2D local-inertial shallow water solver on the GPU, draining the reservoir
   through the progressively-forming breach.
7. Accumulates maximum depth, peak velocity and flood arrival time for every cell.
8. Traces the downstream flow path by D8 routing and reports high water marks, peak
   depth, flood width, peak velocity and arrival time at user-set increments along it.
9. Lets the user carve channels, raise levees, flatten ground and otherwise reshape the
   terrain, then re-run to compare.
10. Drops a raft on the water that drifts on the simulated velocity field, leaves a trail
    showing the path it took, and can be followed with chase, onboard, orbit, watch-point
    and valley-flyover cameras, with a cinematic presentation mode.

## Verification status

- 218 unit tests pass, including a CPU reference implementation of the solver asserting
  mass conservation under 0.5 percent on a closed basin.
- 41 of 41 browser checks pass via `npm run verify`, which drives a real Chrome through a
  complete scenario.
- Lint clean. Build clean.

Three defects were found by the browser harness before release and fixed. None was caught
by the unit tests, and all three produced plausible-looking output. They are written up in
`notes/release-notes/v0.1.0.md`. The conclusion carried into sprint 002 is that the
browser harness earns its keep and should be extended rather than left alone.

## What is deliberately not built yet

See `planning/questions.md` and `TODO.md`. The significant ones:

- No high-resolution lidar or 3DEP elevation source. Terrarium only, so roughly 10 m
  effective resolution in the United States.
- No spatially-varying Manning's n from land cover. Single domain-wide value, user-set.
- No real dam inventory lookup. A small built-in catalog of example sites only.
- No infiltration, rainfall, baseflow or sediment transport.
- No multi-dam cascade failure.
- No save and reload of a scenario to a file.

## Immediate next steps

1. Larry reviews this branch against the ChatGPT branch.
2. Decide the merge target and whether the two branches combine or one is chosen.
3. Resolve the open questions in `planning/questions.md`, particularly Q-003 on whether a
   higher-resolution elevation source is worth the dependency cost.
