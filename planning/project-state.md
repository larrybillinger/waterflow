# Project state — 2026-11-19

Current version: v0.3.0 experimental integration.
Active sprint: sprint-003.
Branch: feature/integrate-gpu-hydraulic-studio-v0.3.
GPU source: claude/flood-simulator commit 1445719f22388830c07f81d3044c9ffb0f52f345.

Classic (MapLibre + Python DEM + JS worker) remains the default at /. GPU Studio (Three.js + browser WebGL2 hydraulics + its own renderer and UI) is built from studio/ and mounted at /studio/ by FastAPI. Both have independent run state, terrain edits and output formats. No scenario migration or shared numeric engine is implied.

GPU Studio preserves Claude's reservoir, progressive breach, hydraulic roughness, GPU water routing, realistic 3D water visualization, levee/channel brushes, flow-path stations and cinematic camera tools.

Automated CI builds both modes and runs their tests. Live browser, external imagery/DEM, Docker end-to-end and matched-model hydraulic calibration remain outstanding. Never use the outputs as validated dam-failure predictions or emergency guidance.

Next steps: compare both engines on common DEMs, establish a scenario interchange format, choose a default UI after practical user testing, add real-world calibration and optionally synchronize video replay.
Mode-switch links carry validated geographic center coordinates; they do not carry scenario state.
