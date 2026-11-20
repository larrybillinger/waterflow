# Sprint 001 - Blueprint

## Builder start summary

Required by the Builder Start Rule in `AGENTS.md`.

```text
What I understand we are building:
  A browser dam-failure flood simulator. Public elevation and imagery data, a published
  2D hydraulic model on the GPU, a 3D Google-Earth-style view, SimCity-style terrain
  editing, and a results table of high water marks and arrival times at increments down
  the valley.

What is in scope:
  F-01 to F-12 and N-01 to N-07 in requirements.md.

What is out of scope:
  Rainfall, infiltration, sediment, cascading dams, buildings, dam inventory lookup,
  spatially varying roughness, scenario save/load, accounts, mobile portrait.

Files I expect to modify:
  Everything. This is the first build. New tree under src/, server/, docs/, planning/,
  notes/, tests/, scripts/. README.md replaced.

Risks or unclear items:
  R-001 elevation resolution, R-002 local inertial validity near the breach,
  R-005 someone mistaking the output for engineering. Open questions Q-002 roughness,
  Q-003 elevation source, Q-005 audience. None block this sprint.

Test plan:
  Vitest unit tests on geo maths, Terrarium decoding, grid resampling, breach equations,
  Manning, priority flood and D8 routing, and a closed-basin mass conservation test on a
  CPU reference implementation of the solver. Then the manual checklist in
  docs/validation.md in a real browser.
```

## Architecture at a glance

```text
            public tile endpoints
                     |
        [ data/ ]  fetch, stitch, decode, resample
                     |
              Float32 heightfield
                     |
    +----------------+------------------+
    |                                   |
[ edit/ ]  brushes, undo          [ sim/ ]  breach + GPU solver
    |                                   |
    +----------------+------------------+
                     |
          elevation + depth textures
                     |
       [ render/ ]  terrain, water, sky, camera
                     |
              [ ui/ ]  panels, charts, results
```

Data flows one way. The elevation grid is owned by `AppState`. The editor mutates it and
raises an event. The solver and the renderer both read it. Nothing reaches backwards.

## Module responsibilities

| Module | Owns |
| --- | --- |
| `data/geo.js` | Web Mercator maths, tile indexing, metres per pixel, domain bounds. Pure functions. |
| `data/terrarium.js` | Terrarium RGB to metres. Pure. |
| `data/demLoader.js` | Tile fetch with concurrency limit, canvas stitch, area-average resample. |
| `data/imageryLoader.js` | Same for imagery, with source fallback chain. |
| `data/sources.js` | Every external URL in one place. |
| `sim/breach.js` | Froehlich and Von Thun & Gillette regressions, breach progression over time, notch depth as a function of position and time. Pure. |
| `sim/reservoir.js` | Pool flood fill, storage-elevation curve, volume and area. Pure. |
| `sim/FloodSolver.js` | GPU state, passes, ping-pong, adaptive timestep, readback. |
| `sim/routing.js` | Priority flood fill, D8 directions, downstream path trace. Pure. |
| `sim/stations.js` | Station placement, cross-section extraction, result assembly. Pure. |
| `sim/manning.js` | Published roughness table. Pure data. |
| `edit/TerrainEditor.js` | Brush application, undo stack. |
| `render/Viewer.js` | Renderer, scene, resize, adaptive pixel ratio. |
| `render/EarthControls.js` | Camera. Self-contained, no Three.js OrbitControls. |
| `render/TerrainMesh.js` | Terrain geometry and material. |
| `render/WaterMesh.js` | Water geometry and material. |
| `ui/*` | Panels and charts. Reads state, emits intents. Never touches WebGL. |

## Solver design

State in two RGBA32F textures, ping-ponged.

- `state` texture: `R` = depth h, `G` = max depth, `B` = arrival time, `A` = max speed.
- `flux` texture: `R` = unit discharge east, `G` = unit discharge north.

Plus a 1 x 1 RGBA32F control texture holding `R` = dt, `G` = domain max depth,
`B` = simulation time. Shaders sample dt from this texture, so the timestep adapts
without a CPU round trip inside the substep loop.

Per rendered frame:

1. Max-depth reduction chain, 4 x 4 per pass, down to 1 x 1.
2. Control pass. Computes the adaptive timestep from the CFL condition and advances
   simulation time.
3. For each substep: flux pass, then depth pass.
4. One `readPixels` of the 1 x 1 control texture for the clock readout.
5. Every N frames, a readback of a downsampled state texture for the volume and
   hydrograph series.

Effective bed elevation inside the shaders is `min(zBase, breachNotch(x, y, t))`, so the
breach is analytic and needs no extra texture.

## Render design

Terrain and water are separate meshes over the same grid, both displaced in the vertex
shader from the elevation texture. Normals are reconstructed in the fragment shader from
neighbouring texels, which gives smoother shading than per-vertex normals at this
resolution.

The sky is a procedural GLSL function. The water shader calls that same function along
the reflected view ray, so the reflection is analytically correct without a cubemap.

Water colour is Beer-Lambert absorption through the depth, over the terrain colour, with
separate extinction coefficients per channel and a sediment tint that rises with speed.
Foam comes from Froude number, shoreline proximity and velocity convergence.

## Sequencing

1. Scaffold, configs, governance docs.
2. `data/` with tests.
3. `sim/` pure modules with tests.
4. `render/` and a visible terrain.
5. `FloodSolver` and visible water.
6. `edit/` and `ui/`.
7. Validation pass in a browser.
