# Hydraulic model, uncertainties and upgrade path

This experimental model is inspired by the 2D local-inertial storage-cell formulation of Bates, Horritt and Fewtrell (2010). Each cell holds h (meters above land), an elevation z and volume h*dx*dy. East and south face unit discharges q (m²/s) respond to hydraulic surface differences with gravitational acceleration and an approximate Manning resistance. The implementation removes outgoing volume exceeding the cell's available water in the current step (positivity limiter); transfers across internal faces conserve mass. A user-prescribed source injects Q*dt into one cell for its specified duration. Boundary cells have a simplified lateral outflow that is separately reported as cumulative exported volume.

Adaptive dt uses local CFL based on sqrt(g*h) and dx. No rainfall, infiltration, evapotranspiration, antecedent stream, reservoirs, bathymetry or breach erosion. Manning roughness is uniform, originally set to 0.045. Model boundary is finite and outflow simplified. Numerically estimated surface heights are not observational measurements. Probe peak surface = DEM cell elevation + historical maximum modeled depth (since terrain edits reset the run).

Future credible dam study: choose upstream reservoir polygon and lake level, supply stage-area-volume relation, breach shape/formation and structural details, configure boundary hydrographs, import USGS 3DEP local LiDAR/bathymetry, incorporate bridges and culverts, compare against HEC-RAS and gauge observations, perform mass balance and mesh convergence benchmarking, quantify confidence. Add historical actual high-water gauge measurements only when separately sourced and labeled.

## Station sampling

Users choose a straight segment from source to downstream endpoint. Model cells nearest to requested meter increments are read for peak depth, modeled maximum water-surface elevation, and wetting time. This is a user-defined geographic transect, not a hydrologically extracted thalweg. Stations can cross ridges or flow discontinuities. Do not treat stations as surveyed high-water marks.


## Passive drifting marker (v0.2)

The movie-mode marker is a **passive surface tracer approximation**, not a separate raft dynamics model. The worker samples signed east and south face discharge (m²/s), converts neighboring averaged face values to approximate depth-averaged velocity (m/s), and uses bilinear interpolation at the marker. Travel uses substeps no larger than about 0.35 cell widths. The numerical safety cap is 20 m/s (not a physically validated flood-speed limit). Depths below 0.1 m strand the tracker, and an out-of-area position ends the route. The marker adds no water volume and cannot alter the hydraulic solver.

The illustrated person and raft are presentation assets only. Wind, buoyancy, paddling, turbulence, collisions, bridges, debris and safe passage are not modeled. Cinematic numerical stepping is paced near 8 simulated seconds per real second. The browser stores the latest 4,500 sampled positions for replay. Replay interpolates these saved coordinates while the water-depth layer remains at the latest simulated frame; it is not synchronized flood reconstruction.
