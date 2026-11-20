# Sprint 001 — Handoff

## Message to ChatGPT

**From: Claude — 2026-11-19**

ChatGPT, here is what I built on branch `claude/flood-simulator` so we can compare against
yours. We were given the same brief. Please do the following:

1. **Review my branch against yours.** Specifically check these, because they are where I
   think a flood simulator most easily goes quietly wrong:
   - Does the reservoir fill on the **upstream** side of the dam in your build? Mine
     originally seeded the pool on whichever side was lower, which in a river valley is
     downstream. It flooded the valley below the dam, grew to 70 percent of the loaded
     area, and every arrival time came back as zero. The fix was to find the upstream side
     by following steepest descent from where the valley floor crosses the dam axis.
     Elevation is the wrong criterion; drainage is the right one.
   - Does your downstream path trace start **below** the dam? Starting it at the breach
     centre put my first station inside the reservoir, reporting pool depth and an arrival
     time of zero while every station after it was correct.
   - Is your mass balance asserted anywhere, or just assumed? Mine is tested on a closed
     basin at under 0.5 percent.
   - Are your breach coefficients checked against a hand calculation from the source, or
     against whatever the code produces?

2. **Check my physics.** Every equation is cited in `docs/hydraulics.md` with units and
   the fitted range. I would particularly like a second pair of eyes on:
   - The exponent 7/3 in the friction denominator. I derived it from the published total
     discharge form by substituting `A = hflow` and `R ≈ hflow` for wide shallow flow.
   - The Froude limiter at 1.2. It is a stabilisation device, not physics, and I have said
     so in the docs and flagged near-field stations in the UI. Tell me if you think that
     is honest enough or if it is doing more work than it should.
   - My decision **not** to implement Froehlich's 2008 peak outflow regression. Its storage
     coefficient is published in acre-feet and feet, and I could not confirm the SI
     conversion against the original paper, so I used a trapezoidal weir discharge that
     derives from Bernoulli instead and logged the other as open question Q-007. If you
     have the original paper and can confirm the constant and its units, that is a real
     contribution.

3. **Tell me what you did differently and why.** I am more interested in where we diverged
   than in where we agree. If you solved the full shallow water equations rather than the
   local inertial approximation, say what it cost you in stability and performance.

4. **Do not merge anything yet.** Q-001 in `planning/questions.md` is open: Larry has not
   decided whether one branch becomes the base, both combine, or we cherry-pick. That is
   his call, not ours.

Read `AGENTS.md` first. The Hydraulics Rule is the one that matters most: every
coefficient in `src/sim/` must be traceable to a cited publication, and anything that
cannot be sourced goes in `planning/questions.md` rather than being guessed.

---

## Builder start summary

Required by the Builder Start Rule in `AGENTS.md`. Reproduced from `blueprint.md`.

```text
What I understand we are building:
  A browser dam-failure flood simulator. Public elevation and imagery data, a published
  2D hydraulic model on the GPU, a 3D Google-Earth-style view, SimCity-style terrain
  editing, and a results table of high water marks and arrival times at increments down
  the valley. Plus movie mode: a raft that drifts on the velocity field with cameras that
  follow it.

What is in scope:
  F-01 to F-12 and N-01 to N-07 in requirements.md.

What is out of scope:
  Rainfall, infiltration, sediment, cascading dams, buildings, dam inventory lookup,
  spatially varying roughness, scenario save/load, accounts, mobile portrait.

Files I expect to modify:
  Everything. This is the first build.

Risks or unclear items:
  R-001 elevation resolution, R-002 local inertial validity near the breach,
  R-005 someone mistaking the output for engineering. Q-002 roughness, Q-003 elevation
  source, Q-005 audience. None block this sprint.

Test plan:
  Unit tests on every pure function, with a CPU reference implementation of the solver
  for mass conservation. Then a headless browser harness driving a full scenario.
```

## Outcome

Delivered. 218 unit tests and 41 browser checks pass.

Three defects were found by the browser harness and fixed before release, all of which
produced plausible-looking output: the reservoir filling downstream, the terrain
collapsing into a ribbon because both vertex shaders displaced the wrong axis, and a
bright diamond lattice across the water from nearest-sampled normals. They are written up
in `notes/release-notes/v0.1.0.md`.

The lesson worth carrying into sprint 002: **unit tests did not catch any of the three.**
All three needed something to actually run the thing and look at the result. The browser
harness earned its keep on the first run and should be extended rather than left alone.
