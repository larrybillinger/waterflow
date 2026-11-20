# AGENTS.md

# Waterflow Project Rules

This is the first file an AI builder or human developer must read before making changes to this
project.

The project source is the source of truth. Chat history is not the source of truth.

This file inherits the house rules from `Website-Architecture-Rules` and
`Programming-Standards`, and adds the rules specific to Waterflow.

## What this project is

Waterflow is a browser-based dam-failure flood simulator. It pulls public elevation data,
runs a physically-based 2D flood model on the GPU, and renders the result as an
explorable 3D world. The user can edit the terrain, place a dam, choose how much of
it fails and how fast, then read the high water marks and arrival times at measured
increments down the valley.

## Operating Model

Use the Architect Builder Method.

### Architect role

The architect plans the work before code changes are made. The architect defines goals,
users, workflows, business rules, data rules, UI rules, risks, open questions, acceptance
criteria, sprint plans and handoff prompts.

The architect may be ChatGPT, Claude, or a human technical lead.

### Builder role

The builder writes or changes code only from approved plans.

The builder must not invent business rules, workflows, or acceptance criteria.

In this repository the builder must additionally not invent **physics**. See the
Hydraulics Rule below.

## Required Read Order

Before changing code, read these files in this order:

1. `AGENTS.md`
2. `README.md`
3. `VERSION`
4. `CHANGELOG.md`
5. `planning/project-state.md`
6. `planning/decisions.md`
7. `planning/risks.md`
8. `planning/questions.md`
9. `docs/architecture.md`
10. `docs/permissions.md`
11. `docs/validation.md`
12. `docs/hydraulics.md`
13. The active sprint folder under `planning/sprints/`

If any file is missing, note that as a project hygiene issue. Do not invent missing rules.

## Source of Truth Rule

If a rule matters, it must be saved in the project files.

Do not rely on prior chat history, memory of a past conversation, assumptions, guesses,
hidden behavior, or unwritten rules.

- Decision made -> add it to `planning/decisions.md`
- Risk found -> add it to `planning/risks.md`
- Question still open -> add it to `planning/questions.md`
- Status changed -> update `planning/project-state.md`

## Hydraulics Rule

This rule is specific to Waterflow and is not optional.

Every equation, coefficient, and exponent in `src/sim/` must be traceable to a published
source that is cited in `docs/hydraulics.md`. That means:

- No invented coefficients.
- No "tuned until it looked right" constants presented as physics.
- Every empirical equation names its author, year, the units of every variable, and the
  range of data it was fitted to.
- Numbers that genuinely are visual or performance choices (foam threshold, ripple
  amplitude, substep count) live in `src/config.js` and are labelled as such. They must
  not sit inside the solver pretending to be physics.

If a value cannot be sourced, stop and add it to `planning/questions.md`. Do not guess.

## Settings Rule

Do not hard-code a policy choice that the operator may reasonably want to change.

Build the feature, then expose the setting in the UI or in `src/config.js`. This applies to
Manning's n, breach weir coefficients, breach progression curve, CFL safety factor,
substeps per frame, grid resolution, domain size, and station spacing.

The user decides policy. The code provides the switch.

## Scope Control

Do not change unrelated behavior. Do not redesign the renderer, rewrite the solver, change
the data model, or remove features unless the active sprint explicitly says to.

When asked to fix a bug, fix that bug only.

## Accuracy Honesty Rule

This tool produces an estimate, not an engineering deliverable. The UI must never imply
otherwise.

- Keep the limitations notice in the UI. Do not remove it to clean up the layout.
- Do not add precision the input data cannot support. Depths are reported to 0.1 m
  because a 10 m DEM does not justify centimetres.
- When a result depends on an assumption the user did not set, say so on screen.
- Never label output as a regulatory dam breach inundation map.

## Version Rule

Every code change must update the project version. Use `MAJOR.MINOR.PATCH`.

- Patch for small fixes: `v0.1.1`
- Minor for new features: `v0.2.0`
- Major for breaking changes: `v1.0.0`

Update the `VERSION` file for every release.

## Changelog Rule

Every release must update `CHANGELOG.md` with version number, date, added features, fixed
bugs, changed behavior, and known issues.

## Release Notes Rule

Every release gets `notes/release-notes/vX.Y.Z.md` with Summary, Changes, Fixed Bugs,
Known Issues, Upgrade Steps, Rollback Notes.

## Git Rule

Use clear commits that say what changed and why. Do not work directly on `main` for
anything larger than a typo.

## Secrets Rule

Never hard-code secrets. Use `.env` for real values and `.env.example` for safe examples.
`.env` must stay in `.gitignore`.

Waterflow needs no API keys for its default data sources. If a future source requires a
key, it goes in `.env` and is read server-side only. Never ship a key to the browser.

## Required Project Files

```text
README.md
CHANGELOG.md
VERSION
.gitignore
.env.example
AGENTS.md
docs/
planning/
notes/release-notes/
docker-compose.yml
scripts/
```

## Development and Production Rule

Do not test changes on production.

```text
Dev:        8099
Production: 8098
```

## Testing Rule

Before release, run the checklist in `docs/validation.md`.

## Logging Rule

Errors must be specific enough to fix the problem.

Bad: `Error loading terrain`

Better: `Elevation tile 13/1685/3151 returned HTTP 403. Terrarium source may be
unreachable; falling back to flat terrain. Check network access to
s3.amazonaws.com/elevation-tiles-prod.`

## Documentation Rule

Durable technical documentation belongs in `docs/`. Planning and current status belong in
`planning/`. Release history belongs in `CHANGELOG.md` and `notes/release-notes/`.

## Final Rule

Do not ask an AI builder to guess. Give it requirements, blueprint, acceptance criteria,
risks, decisions, validation plan, and a handoff prompt. Then let it build.
