# Risks

---

## R-001 - Elevation resolution limits what can be resolved - HIGH

Terrarium tiles give roughly 10 m effective resolution in the United States and coarser
elsewhere. Narrow channels, individual levees, road embankments, culverts and bridge
openings are smaller than one cell.

**Effect.** Flood extent in tight valleys can be wrong in either direction. A channel
narrower than a cell is averaged away, so the model spreads water too wide and too
shallow. A levee narrower than a cell is also averaged away, so the model may flood land
that is actually protected.

**Mitigation.** Resolution and cell size are shown in the UI at all times. The terrain
editor exists partly so the user can put a missing levee or channel back in by hand.

**Not mitigated.** The underlying data limit. Needs a higher-resolution source. See Q-003.

---

## R-002 - Local inertial approximation degrades near the breach - MEDIUM

Dropping convective acceleration is a good approximation at Froude numbers below about
0.5 and becomes progressively worse above about 1.0. The jet immediately below a breach
is strongly supercritical.

**Effect.** Depths and velocities within roughly the first 10 to 20 cell widths of the
breach should be read as indicative only. Further downstream, where the wave has spread
and slowed, the approximation is sound.

**Mitigation.** The solver applies a Froude number limiter to keep the near-field stable
rather than letting it oscillate. Stations closer to the dam than a configurable distance
are flagged in the results table. The documentation says this plainly.

---

## R-003 - A public data source could change or disappear - MEDIUM

The app depends on tile endpoints it does not control. A bucket could be renamed, CORS
headers could be removed, or rate limits could appear.

**Effect.** Terrain or imagery stops loading.

**Mitigation.** Imagery has four interchangeable sources and a fully procedural fallback,
so the app still works with no imagery at all. Elevation failure is reported with the
exact failing tile URL and HTTP status rather than a generic message. The optional server
proxy caches tiles on disk, so a self-hosted instance keeps working from cache. All
endpoints are in one file, `src/data/sources.js`, so a URL change is a one-line fix.

---

## R-004 - Float texture support is not universal - LOW

The solver needs WebGL2 with `EXT_color_buffer_float`.

**Effect.** On a device without it, the simulation cannot run.

**Mitigation.** Detected at startup. The user gets a specific message naming the missing
extension and their renderer string, not a blank screen.

---

## R-005 - Someone could mistake the output for an engineering product - HIGH

This is the risk with real consequences. The output looks authoritative: a 3D map, depths
to a decimal, arrival times in minutes. Somebody could use it to decide whether a house
is safe.

**Effect.** Real harm from a result that is an estimate built on 10 m terrain, a
single roughness value, no structures, and an assumed breach.

**Mitigation.** A persistent, non-dismissable notice in the UI. The Accuracy Honesty Rule
in `AGENTS.md` forbids removing it. Results export carries the same notice in the file
header. The README states it. Reported depths are rounded to 0.1 m so the precision
matches the data.

**Residual.** Cannot be fully mitigated by software. Accepted with the above controls.

---

## R-006 - Large domains can exhaust browser memory - LOW

A 24 km domain at 1024 cells needs several float textures of 1,048,576 texels plus the
stitched source raster.

**Effect.** Tab crash on a low-memory device.

**Mitigation.** Grid size is capped at 1024. The tile count and estimated download size
are shown before loading. Textures are explicitly disposed when a new domain loads rather
than left to the garbage collector.

---

## R-007 - Mass conservation error can accumulate silently - MEDIUM

An explicit scheme with flux limiters can lose or gain water, especially at wet/dry
fronts, and the result would still look plausible.

**Effect.** A hydrograph and high water marks that are quietly wrong.

**Mitigation.** The app tracks total water volume in the domain every frame and displays
the mass balance error as a percentage of the initial reservoir volume. If a run finishes
with more than a small error the UI says so. This makes the failure visible instead of
silent. A unit test asserts conservation on a closed basin.
