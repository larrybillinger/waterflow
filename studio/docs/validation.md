# Validation

Two layers: automated checks that must pass before a release, and a manual checklist for
the things a machine cannot judge.

## Automated

```bash
npm test      # unit tests
npm run lint
npm run verify    # drives a real browser end to end
```

### Unit tests

218 tests across 10 files. The ones that matter most:

| File | What it pins down |
| --- | --- |
| `solver.test.js` | Mass conservation in a closed basin under 0.5 percent. No negative depths. Water moves downhill and settles level. The Froude limiter holds. A barrier retains water and a notched barrier releases it while conserving mass. |
| `breach.test.js` | Every published equation against a hand calculation worked from the citation, not against what the code happens to produce. Includes the hours-versus-seconds difference between Froehlich 1995 and 2008, which is a real trap. |
| `dam.test.js` | The notch cuts a continuous gap through the embankment. The reservoir forms on the upstream side, found by drainage rather than elevation. |
| `geo.test.js` | Mercator round trips, tile coverage, and that north is row 0 and -z. |
| `routing.test.js` | Priority flood leaves no interior minima and never lowers terrain. D8 weights diagonals correctly. |
| `drifter.test.js` | A raft travels at the speed of the water it is in, follows a curving streamline without spiralling, and is not throttled by a long frame. |

The solver tests run against `tests/support/cpuSolver.js`, a deliberate line-by-line
transcription of the two shaders. A fragment shader cannot be unit tested in Node, but the
equations can, and the equations are the part that would be wrong in a way nobody notices.

### Browser verification

`npm run verify` launches Chrome, loads the app and runs a full scenario, asserting 41
checks. It covers what only exists in a browser: shader compilation, the WebGL state
machine, the UI building without throwing, and a complete run producing moving water and
populated results.

It places the dam by actually clicking the canvas, so terrain picking and the pointer
handlers are exercised too. Screenshots go to `verification/`.

Three real defects were caught by this harness before the first release, all of which
produced plausible-looking output. It is worth running, not just worth having.

The test machine has no route to public tile endpoints; the harness blocks them deliberately and opens with `?demo=1`. This exercises clearly labeled, deliberately selected fictional terrain, not an invisible fallback. In normal mode the same tile failure must stop the simulation instead of inventing geography.

## Release checklist

Run through this before tagging.

```md
- [ ] npm test passes
- [ ] npm run lint passes with no errors
- [ ] npm run verify passes, 41 of 41
- [ ] Screenshots in verification/ look right, not just non-empty
- [ ] npm run build succeeds
- [ ] docker compose up -d --build serves the app
- [ ] VERSION, CHANGELOG.md and notes/release-notes/vX.Y.Z.md all agree
- [ ] planning/project-state.md reflects reality
- [ ] No console errors on load or during a default run
- [ ] Every new coefficient in src/sim/ is cited in docs/hydraulics.md
- [ ] The limitations notice is still visible and still cannot be dismissed
```

## Manual checks

A machine can confirm the water moved. It cannot confirm the water looks like water, or
that the controls feel right. Do these by hand.

### It looks correct

- [ ] Load a real place you know and check the terrain matches the map.
- [ ] Water has visible depth: shallow shows the bed, deep goes blue-green.
- [ ] Fast flow is visibly muddier than still water.
- [ ] Foam appears on fast shallow flow and at the advancing front, not everywhere.
- [ ] Sun glint moves correctly as the camera moves.
- [ ] The shoreline is a smooth contour, not a staircase of cells.
- [ ] No regular lattice, diamond pattern or shimmer anywhere on the water.
- [ ] Zooming right in and right out both look right; no banding, no z-fighting.

### It feels correct

- [ ] Left-drag keeps the grabbed ground point under the cursor.
- [ ] Scroll zooms toward the cursor, not the screen centre.
- [ ] Camera motion is damped, with no snapping or jitter.
- [ ] A raft dropped in the reservoir sets off when the water reaches it, follows the
      valley, and grounds out somewhere plausible.
- [ ] Chase and onboard cameras stay with the raft and do not clip through hillsides.

### It is honest

- [ ] The limitations notice is readable without scrolling or opening a menu.
- [ ] Depths are shown to 0.1 m, not to centimetres.
- [ ] Near-field stations are flagged.
- [ ] The exported CSV header carries the settings and the notice.
- [ ] Nothing in the interface calls the output an official or regulatory product.

## Sanity checks against known physics

Not formal validation against gauged dam failures, which this project has not done and
should not claim. These are checks that the model behaves the way the physics says it
should.

| Check | Expectation |
| --- | --- |
| Closed basin | Volume constant. Surface settles level. |
| Still reservoir, no breach | Nothing moves. Outflow zero. |
| Instant full breach | Peak outflow approaches the weir estimate drawn on the hydrograph. |
| Slow breach | Simulated peak well below the weir estimate, because the pool draws down while the breach forms. |
| Double the roughness | Flood arrives later and spreads shallower. |
| Raise a levee across the valley | Water is held back, and the flood goes somewhere else. |
| Wave speed | Order of sqrt(g·h). A 20 m deep flood front should travel at roughly 10 m/s, not 1 or 100. |

The last one is the quickest way to notice that something has gone badly wrong.
