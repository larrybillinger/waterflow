# Waterflow

A dam-failure flood simulator that runs in a browser. This copy is integrated as **Advanced Studio** within Waterflow v0.3.

It pulls public elevation data for anywhere on Earth, lets you build a dam across a valley
and fill the reservoir behind it, then fails that dam however you like and solves the
resulting flood with a published 2D hydraulic model on the GPU. You get high water marks,
depths, flood widths, velocities and arrival times at measured increments down the valley,
and you can fly around the whole thing like a map.

You can also drop a raft on the water and ride it downstream.

**Real-terrain failures do not automatically invent geography.** To run the clearly labeled, fictional offline valley, explicitly add `?demo=1` to the Studio URL. Otherwise public DEM tile failures stop the load.

**This is an estimate, not an engineering product.** See [Accuracy](#accuracy).

---

## What it does

**Loads real terrain.** Enter a latitude and longitude, choose how wide an area you want,
and it fetches public elevation tiles, stitches them and builds a simulation grid.
Satellite or topographic imagery is draped over the top. No API key, no account.

**Lets you build the dam.** Click once on each side of a valley. The crest becomes real
terrain, so the reservoir fills behind it by itself and the impounded volume is computed
from the actual shape of the ground rather than from an assumed reservoir shape.

**Fails it how you choose.** Set what percentage of the dam length breaches, how deep it
cuts, and how long the breach takes to form. Or press one button and have those filled in
from the Froehlich (2008) regression on 74 historical embankment dam failures.

**Solves the flood properly.** The breach is cut out of the terrain over time and the
water leaves because the physics says it does. Reservoir drawdown, outflow and downstream
routing all fall out of one mass-conserving simulation rather than three models that can
disagree with each other.

**Reports what you came for.** Maximum depth, peak velocity and arrival time are recorded
for every cell. Stations are placed down the valley at whatever increment you set, and
each one reports ground elevation, peak water surface, depth, flood width, velocity and
when the water got there. Export it as CSV.

**Lets you change the ground.** Carve a channel, raise a levee, excavate a spillway,
flatten a pad. Then run it again and see what changed.

**Lets you watch it.** Drop a raft and follow it with a chase camera, ride it from on
board, orbit it, or tag a spot and hold the camera there while the water arrives.

---

## Quick start

In the integrated Waterflow site, open `/studio/` for this engine or `/` to return to the Classic Terrain Lab. They currently share the selected geographic centre when switching, not dam geometry or simulation state.


```bash
npm install
npm run dev
```

Then open the address it prints. It opens on Tuttle Creek Lake in Kansas.

To get going:

1. **Dam tab** → *Draw the dam* → click one side of the valley, then the other.
2. *Fill to crest*.
3. **Breach tab** → *Fill from published equations*, or set the sliders yourself.
4. Press play.
5. **Results tab** → pick an overlay, read the station table.

Build a static copy with `npm run build`; the output in `dist/` is a plain static site
that can be hosted anywhere.

---

## Controls

| Action | Input |
| --- | --- |
| Pan | Left-drag. The ground point you grabbed stays under the cursor. |
| Orbit and tilt | Right-drag, or Ctrl-drag, or middle-drag |
| Zoom | Scroll. Zooms toward the cursor, not the screen centre. |
| Move | W A S D, or the arrow keys |
| Rotate / tilt | Q E / R F |
| Play or pause | Space |
| Hide the interface | Tab |
| Cinematic mode | C |
| Leave a tool | Escape |
| Tablet | One finger pans, two fingers pinch to zoom and twist to rotate |

---

## Accuracy

Read this part.

Waterflow is useful for understanding how a flood behaves, for comparing one scenario
against another, and for seeing roughly where water would go and roughly when. It is not
a dam breach inundation study and must not be used to make decisions about life or
property.

What limits it:

- **Elevation resolution.** Roughly 10 m in the United States, coarser elsewhere. Channels,
  levees, road embankments and bridge openings narrower than one cell are averaged away.
  A levee that vanishes into the average will not hold water back here even though it
  would in reality, and a channel that vanishes makes the model spread water too wide and
  too shallow.
- **One roughness value** for the whole area, chosen by you from a published table. Real
  studies vary it by land cover.
- **No structures.** No buildings, bridges, culverts or flood walls.
- **The breach is assumed.** How a real dam fails is the single largest uncertainty in any
  dam breach analysis, which is why the tool makes you choose it and offers you a
  published regression rather than pretending there is one right answer.
- **Simplified momentum.** The solver drops the convective acceleration term, which is a
  good approximation except in the first few hundred metres below the breach. Stations in
  that zone are flagged in the results.
- **Nothing but water.** No rainfall, no infiltration, no sediment, no debris.

Depths are reported to 0.1 m because a 10 m elevation grid does not justify centimetres.

---

## How it works

```text
public tiles ──> data/ ──> elevation grid ──> sim/ (GPU solver) ──> render/ ──> ui/
                              ▲                      │
                              └──── edit/ ───────────┘
```

| Piece | What it is |
| --- | --- |
| Hydraulics | Local inertial approximation of the shallow water equations, Bates, Horritt & Fewtrell (2010). The scheme behind LISFLOOD-FP. |
| Breach | Froehlich (2008), Froehlich (1995) and Von Thun & Gillette (1990) regressions, with linear, sinusoidal, quadratic or instant progression. |
| Roughness | Chow (1959) Table 5-6. |
| Routing | Priority flood depression filling (Wang & Liu 2006; Barnes et al. 2014) and D8 flow directions (O'Callaghan & Mark 1984), used to place stations only. |
| Elevation | AWS Open Data Terrain Tiles, Terrarium encoding. |
| Imagery | USGS National Map, Esri World Imagery or OpenStreetMap, with a fallback to relief shading. |
| Solver | WebGL2 fragment shaders over floating point textures, ping-ponged, with an adaptive CFL timestep. |

Every equation and coefficient is cited in [`docs/hydraulics.md`](docs/hydraulics.md), with
units and the range of data it was fitted to. That is a project rule, not a nicety: see
the Hydraulics Rule in [`AGENTS.md`](AGENTS.md).

---

## Project layout

```text
waterflow/
  src/
    config.js        tunables, split into physics / performance / visual
    data/            geography, tile fetching, decoding, resampling
    sim/             breach, reservoir, routing, stations, GPU solver, drifters
    render/          viewer, camera, terrain, water, sky, markers
    edit/            terrain brushes and undo
    ui/              panels, charts, timeline
  server/            optional static server and tile cache
  docs/              durable technical documentation
  planning/          decisions, risks, open questions, sprints
  notes/             release notes
  scripts/           browser verification harness
  tests/             unit tests
```

---

## Running the checks

```bash
npm test            # 218 unit tests
npm run lint
npm run verify      # drives a real browser end to end, writes screenshots
```

`npm run verify` is the one worth knowing about. It launches Chrome, loads the app, places
a dam by clicking the terrain, fills the reservoir, estimates the breach, runs the failure,
exercises every camera mode, checks the results are physically sensible, edits the terrain,
exports a CSV, and fails if anything throws. It writes screenshots to `verification/`.

It needs Chrome at `/usr/bin/google-chrome`; pass a different URL as the first argument to
point it at a deployed build.

---

## Self-hosting

```bash
cp .env.example .env     # adjust APP_PORT
docker compose up -d --build
```

The bundled Node server is optional. It serves the built site and, if you set
`VITE_TILE_PROXY=/api/tiles` before building, proxies and disk-caches the map tiles so
repeat visits are fast and the app no longer depends on a third party's CORS headers.
Without it, the browser fetches tiles directly and the app works as a plain static site.

House convention: dev on 8099, production on 8098.

---

## Requirements

A browser with WebGL2 and the `EXT_color_buffer_float` extension, which is Chrome, Edge,
Firefox and Safari 15 or newer. If it is missing, the app says so by name rather than
showing a blank screen.

---

## Licence

GPL-3.0. See [LICENSE](LICENSE). The earlier MIT statement conflicted with the actual repository LICENSE and has been corrected.

Elevation and imagery come from public sources and carry their own attribution, shown in
the app and listed in [`docs/data-sources.md`](docs/data-sources.md).
