# TODO

Tracked work. Decisions belong in `planning/decisions.md`, risks in `planning/risks.md`,
open questions in `planning/questions.md`.

## Blocking a merge

- [ ] Resolve Q-001: decide the merge target. This branch was built in parallel with a
      ChatGPT branch for comparison and it has not been decided which becomes the base,
      or whether they combine.

## Bugs

Nothing known and unfixed. Three defects were found and fixed before v0.1.0; they are
recorded in `notes/release-notes/v0.1.0.md` because all three produced plausible-looking
output and are worth remembering.

## Features

### Worth doing next

- [ ] **Save and reload a scenario.** Domain, terrain edits, dam, breach settings and
      roughness as a JSON file. The single most useful missing feature: at present a run
      cannot be handed to anyone else or returned to tomorrow. See Q-004.
- [ ] **Spatially varying roughness** from a land cover raster. Changes both flood extent
      and arrival time. Needs an NLCD fetch path and a class-to-n lookup. See Q-002.
- [ ] **Higher resolution elevation** from USGS 3DEP. Would materially improve tight
      valleys. Costs a GeoTIFF or LERC decoder and is United States only. See Q-003.
- [ ] **Compare two runs side by side.** Edit the terrain, re-run, and show the difference
      in depth and arrival time. The terrain editor exists to answer "what if", and at
      present the comparison has to be held in the user's head.

### Later

- [ ] Planar reflection on the water, so it mirrors the terrain and not just the sky.
      See D-008.
- [ ] Record a movie-mode clip to a file rather than screenshots.
- [ ] Multi-dam cascade failure.
- [ ] Rainfall and infiltration.
- [ ] Levee and embankment overtopping failure during a run, rather than only at the dam.
- [ ] Mobile portrait layout.

### Deliberately not doing

- **Overlaying buildings and roads and reporting which are inundated.** Technically
  straightforward. It would turn an estimate into an apparent statement about named
  people's homes. See Q-006; needs a recorded decision before anyone builds it.

## Engineering

- [ ] Frame-time budget for the drifter readbacks. Each drifter costs two small GPU
      readbacks per frame; a dozen rafts would be noticeable. Move particle advection onto
      the GPU if that becomes a real use.
- [ ] Replace `THREE.Clock` usage if any creeps back in; it is deprecated in favour of
      `THREE.Timer`.
- [ ] Consider a logarithmic depth buffer instead of the adaptive near plane. Cleaner, but
      needs the log-depth code adding by hand to every custom shader.
- [ ] The breach notch geometry is implemented twice, in `src/sim/dam.js` and
      `src/sim/shaders/bed.glsl`. Tested, documented and deliberate, but a single source
      would be better if a sensible one appears.

## Documentation

- [ ] A worked example in `docs/`: one real site, start to finish, with the numbers, so a
      reader can reproduce it and check the tool against their own expectations.
- [ ] Short screen recording for the README.
