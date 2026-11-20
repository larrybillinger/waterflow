# Architecture

## Shape of the thing

Data flows one way. The elevation grid is owned by the application; the editor mutates it,
the solver and the renderer read it. Nothing reaches backwards.

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
          elevation + state textures
                     |
       [ render/ ]  terrain, water, sky, camera, drifters
                     |
              [ ui/ ]  panels, charts, results
```

The solver does not know a UI exists. The UI does not know how water moves. `app.js` is
the only place that knows about both.

## The three grids

This is the thing to understand before changing anything in `app.js`.

| Grid | Contents | Owner |
| --- | --- | --- |
| `pristineGrid` | elevation exactly as loaded | app, never modified |
| `editedGrid` | pristine plus the user's terrain edits | `TerrainEditor` |
| `terrainGrid` | edited plus the dam embankment | app, uploaded to the solver |

Keeping the dam out of `editedGrid` is what makes "remove the dam" and "undo my edit"
independent operations rather than tangled ones. `#rebuildTerrain()` recomposes
`terrainGrid` from the other two and re-uploads it.

## Coordinate systems

Five, and mixing them up is the most likely source of a subtle bug.

| System | Definition |
| --- | --- |
| lon / lat | WGS84 degrees, what the user types |
| Mercator x / y | EPSG:3857 metres. **Not** true ground metres: one Mercator metre is cos(latitude) ground metres |
| pixel x / y | tile pixels at a zoom, origin top-left of the world |
| grid col / row | simulation cells, col 0 west, **row 0 north** |
| scene x / z | renderer metres, origin at the domain centre, **-z is north**, y is up |

Row 0 being north and -z being north is why every shader flips `v`. The conversions are
all in `src/data/geo.js` and are unit tested.

The Mercator scale factor is treated as constant across a domain, evaluated at its centre.
Over 24 km at mid-latitude that varies by under 0.3 percent, far below the accuracy of the
elevation data.

## The solver

State lives in floating point render targets, ping-ponged.

| Target | Channels |
| --- | --- |
| `state` | R depth, G maximum depth, B arrival time (-1 = never), A peak speed |
| `flux` | R unit discharge across the east face, G across the south face |
| `control` | 1x1: R timestep, G domain maximum depth, B simulation time, A total volume |

Per rendered frame:

1. Reduction chain over the depth field, 4x4 per pass, down to one texel, producing the
   maximum depth and the total volume together.
2. Control pass: derives the CFL timestep and advances the clock using the *previous*
   frame's timestep, which is still in the texture being read. That is what makes the
   clock exact rather than drifting.
3. For each substep: flux pass, then depth pass. The depth pass gets the substep index so
   simulation time is exact within the frame.
4. One four-float readback of the control texel for the interface.

The timestep lives in a texture rather than a uniform so the substep loop never waits on
the CPU. A readback per substep would stall the pipeline and cost more than the physics.

The bed elevation the shaders see is `min(groundElevation, breachNotch(x, y, t))`, so the
breach is analytic and needs no extra texture. That function is implemented twice, in
`src/sim/dam.js` and `src/sim/shaders/bed.glsl`, and the two must stay in step.

Breach geometry is held constant across a frame's substeps, computed from the clock as it
stood at the frame's start. Over a formation time of minutes and frames of a few simulated
seconds that is a fraction of a percent of the opening.

## Readback strategy

Readbacks stall the GPU pipeline, so they are rationed by how much they cost.

| What | Size | When |
| --- | --- | --- |
| Control texel | 4 floats | every frame |
| Drifter neighbourhood | 8x8 x 2 targets | every frame per drifter, cached for the frame |
| Reservoir storage | pool bounding box | every 4 frames |
| Full state | grid² x 4 floats | every 30 frames, and on demand |

The drifter cache is keyed on a generation counter the solver bumps each step, so a
drifter integrating several substeps with midpoint samples costs one read, not a dozen.

## Rendering

Terrain and water are separate meshes over the same grid, both displaced in the vertex
shader from textures. The plane's rotation into the ground plane is **baked into the
geometry**, which means `position.y` is the free component and `position.z` carries the
north-south coordinate. Displacing the wrong one collapses the world into a ribbon; this
happened, and is recorded in the v0.1.0 release notes.

Normals are reconstructed in the fragment shader from neighbouring texels rather than
interpolated from vertex normals, which at one vertex per cell would visibly facet every
hillside.

The sky is a procedural GLSL function. The water shader evaluates that same function along
the reflected view ray, so the reflection is correct without a cubemap. See decision D-008.

**Nearest versus interpolated sampling.** The solver state must use nearest filtering:
interpolating between a wet cell and a dry one would invent water the mass balance never
accounted for, and the readbacks that build the results tables would read interpolated
values rather than cell values. But nearest sampling in the *shaders* makes the shoreline
snap to cell boundaries and makes the water normal piecewise constant, which at a high
specular exponent becomes a bright lattice. So the render shaders interpolate manually, in
the fragment shader, after the physics has been computed and recorded. Nothing read that
way reaches a reported number.

**Depth precision.** The scene spans metres to tens of kilometres. The near plane adapts to
camera altitude each frame, and the water carries a polygon offset, because a fixed
vertical bias cannot hold against a depth resolution that grows with viewing distance.

**Procedural detail fades below a pixel.** Wave and foam frequencies are attenuated once
their wavelength drops under the screen-space footprint, measured with `fwidth`. Without
it they alias into a regular diamond lattice. This is mipmapping, applied to a procedural
texture.

## Error handling

Per the Logging Rule in `AGENTS.md`, a failure names what failed and where. An elevation
tile failure reports the tile, the URL and the cause. A missing WebGL extension reports
the extension and the renderer string. A single failed tile is filled from its neighbours
rather than aborting the load; a total failure blocks real-terrain simulation with an actionable error. Fictional terrain is available only when the user deliberately visits the explicit `?demo=1` mode. A generated landscape must never be presented as actual elevation data.

## Why there is no framework

The interface is a fixed set of panels built once, with values written into existing nodes
rather than re-rendered. For a UI this size a framework would be more machinery than the
thing it manages, and it would put a diffing layer between a slider and the number it
controls. `src/ui/dom.js` is the whole abstraction.
