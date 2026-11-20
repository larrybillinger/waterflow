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

HIGH: Classic and Studio have different water-forcing and numerical assumptions; similar visualizations can misleadingly appear equivalent. No cross-engine claim of validated accuracy.
HIGH: 218 unit tests and 41 synthetic-browser checks reported by Claude do not establish accuracy against a measured flood event or real DEM correctness.
HIGH: Automatically substituting synthetic terrain for a failed real DEM risks invented geography; normal mode must fail and demo mode must label fictional terrain.
MEDIUM: Studio requires WebGL2 float texture support and its high-resolution GPU rendering may strain low-power devices.
MEDIUM: The two renderer coordinate systems and grids make a shared live scenario unsafe without a designed conversion.
MEDIUM: The fixed-host tile proxy needs request controls and upstream provider license checks before public exposure.
MEDIUM: Duplicated 3D engines raise repository and maintenance costs; revisit after real-world validation.
