# Decisions

2026-11-19: Full-viewport 3D first, with compact floating controls, not a conventional dashboard.
2026-11-19: MapLibre GL JS (WebGL) for Earth-like pan/rotate/tilt and DEM terrain without proprietary globe credentials.
2026-11-19: Mapzen public AWS Terrarium tiles provide first elevation data. Fail closed on missing DEM; no fake/synthetic landscape.
2026-11-19: Point-source release with adjustable m³/s and duration; it is NOT a computed dam-failure event.
2026-11-19: Worker-based reduced 2D local-inertial water solver; visible experimental label. No claim of engineering-grade accuracy.
2026-11-19: Edits are reflected in 3D DEM via scenario-local tile endpoint; memory-only storage. No auth, localhost deployment.
2026-11-19: Satellite imagery plus street-map toggle; provider attribution visible.
2026-11-19: Add optional globe projection, straight-line station sampling at set distances, and CSV of modeled high-water readings; never imply line traces actual river centerline.

2026-11-19: Sprint 002 movie mode uses a passive tracer inferred from shallow-water cell fluxes, NOT a physical raft/vessel.
2026-11-19: A stylized raft/rider and a bright water dot are visualization modes for the same flow tracer.
2026-11-19: Pace cinematic live model to approximately 8 simulated seconds per real second; preserve fast mode outside cinema.
2026-11-19: Recorded route replay is path-only, does not rewind flood raster, and is not an MP4 export.
2026-11-19: Keep latest 4,500 sampled points; treat depths under 0.1 m as stranded.

2026-11-19: Keep the two incompatible numerical engines as separate Classic and Advanced Studio workspaces on a single host. Do not suggest their depth outputs are interchangeable.
2026-11-19: Only URL latitude, longitude and limited study-area extent are transferred when switching. No dam, reservoir, terrain edit or water-grid transfer.
2026-11-19: Studio's stronger reservoir/breach GPU and water-rendering features become accessible without removing Classic's globe/point-release functionality.
2026-11-19: Studio's synthetic valley requires explicit ?demo=1 and visible warning; real-terrain failure must otherwise stop.
2026-11-19: Align Claude's declared MIT license metadata with the GPL-3.0 repository LICENSE.
2026-11-19: Build the Studio with Node inside Docker and expose a narrowly allowlisted FastAPI tile proxy at /api/tiles.
