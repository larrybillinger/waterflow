# Risks

HIGH: Public DEM resolution/vertical datum/underwater data gaps lead to incorrect low-lying flood extents. Expose DEM spacing and data warnings.
HIGH: Point-source hydrograph is not a physical breach analysis. Do not label peak as real high-water mark.
HIGH: Simplified face flow, Manning coefficient and open-edge boundaries are uncalibrated; no bridge/culvert handling, no numerical benchmarking.
MEDIUM: Browser WebGL compatibility and third-party tile availability/rate limits; request failures cannot be silently concealed.
MEDIUM: Demo is not authenticated; exposing HTTP outside localhost creates shared-edit, abuse and privacy risks.
MEDIUM: Satellite imagery visual appearance may obscure water heatmap; use explicit depth legend and probe values.
MEDIUM: Numerical grid is limited to 256² at max 12 km domain; terrain details finer than cells are not represented.
MEDIUM: Straight-line samples may cross ridges or leave the active flow corridor; measurements are cell-model estimates at unsurveyed points.

HIGH: Lifelike chase framing may make unvalidated hydraulic simulation feel authoritative. Explicitly label passive tracker and no vessel safety prediction.
MEDIUM: Coarse flux-derived velocities can misrepresent narrow channels, eddies and obstacles; capped speed is a stability measure, not survey data.
MEDIUM: Replay flood shading remains at last simulation frame; it is not a time-synchronized flood movie.
MEDIUM: Frequent camera movement and route line redraw may be slow on mobile GPUs.
MEDIUM: Route samples in memory are bounded and cleared on resets; no persisted video or scenario restoration.

HIGH: Two hydraulic models can disagree due to different boundary conditions, wet/dry treatments, resolution, bed input, reservoir setup and roughness; compare only after matched benchmarks.
HIGH: GPU Studio's synthetic fallback terrain is not a real geographic domain; a persistent disclaimer is mandatory.
HIGH: Dam-breach regressions apply to limited historical categories and cannot predict any specific failure without site-specific engineering data.
MEDIUM: GPU Studio requires WebGL2 with float render targets and may fail on older GPU/browser configurations.
MEDIUM: Studio fetches public terrain/imagery directly in combined deployment; provider failures, CORS and rate limits may occur. Standalone Node tile proxy is not integrated.
MEDIUM: Mode switch reloads the page, losing temporary in-memory state in the previous mode.
MEDIUM: Two tech stacks increase dependency-maintenance and Docker-build overhead. Test each independently on CI.
