# Risks

HIGH: Public DEM resolution/vertical datum/underwater data gaps lead to incorrect low-lying flood extents. Expose DEM spacing and data warnings.
HIGH: Point-source hydrograph is not a physical breach analysis. Do not label peak as real high-water mark.
HIGH: Simplified face flow, Manning coefficient and open-edge boundaries are uncalibrated; no bridge/culvert handling, no numerical benchmarking.
MEDIUM: Browser WebGL compatibility and third-party tile availability/rate limits; request failures cannot be silently concealed.
MEDIUM: Demo is not authenticated; exposing HTTP outside localhost creates shared-edit, abuse and privacy risks.
MEDIUM: Satellite imagery visual appearance may obscure water heatmap; use explicit depth legend and probe values.
MEDIUM: Numerical grid is limited to 256² at max 12 km domain; terrain details finer than cells are not represented.
MEDIUM: Straight-line samples may cross ridges or leave the active flow corridor; measurements are cell-model estimates at unsurveyed points.
