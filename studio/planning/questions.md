# Open Questions

Questions for the architect or the operator. Do not guess answers to these in code.

---

## Q-001 - OPEN - What is the merge target for this branch?

`claude/flood-simulator` was built independently, in parallel with a ChatGPT branch, for
comparison. Options: merge one, merge both and reconcile, or cherry-pick.

Needed before: any merge to `main`.

---

## Q-002 - OPEN - Should Manning's n vary across the domain by land cover?

Right now roughness is one value for the whole domain, chosen by the user from a table of
published values. Real studies vary it by land cover, which changes both flood extent and
arrival time.

Doing it properly means a land cover raster. The NLCD is public and available as tiles for
the United States, but it is another data source, another fetch path, and a lookup table
from NLCD class to Manning's n.

Worth a sprint, or is a single calibrated value good enough for the purpose of this tool?

---

## Q-003 - OPEN - Is a higher-resolution elevation source worth the dependency cost?

D-004 chose Terrarium for its simplicity. The USGS 3DEP ImageServer could give 10 m or in
places 1 m lidar, which would materially improve results in tight valleys.

The cost is a GeoTIFF or LERC decoder in the browser, United States only coverage, and a
slower, heavier fetch. There is also a question of whether 1 m data is even useful at a
512 cell grid, since it would be averaged away unless the domain is small.

Decide: leave at Terrarium, add 3DEP as an option, or add 3DEP only for small domains.

---

## Q-004 - OPEN - Should scenarios be saveable, and if so where?

A scenario is domain, terrain edits, dam geometry, breach settings and roughness. It would
be useful to save and reload one, and to share it.

Options: download a JSON file, store in browser local storage, or store server-side
against a user. Server-side needs the permissions model in `docs/permissions.md` to grow
real users, which is a much bigger change.

---

## Q-005 - OPEN - What is the intended audience?

The answer changes the UI. Possibilities:

- Personal curiosity and learning, in which case the game feel should lead.
- Public education and emergency preparedness briefings, in which case clarity and the
  limitations notice should lead.
- A rough first-pass screening tool before a real study, in which case the export format
  and the documentation of assumptions matter most.

Built for the first two. Confirm before any further UI work.

---

## Q-006 - OPEN - Should the tool ever show real populated places at risk?

Technically possible: overlay OpenStreetMap buildings and roads and report which are
inundated. That makes the tool far more useful and far more dangerous, because it turns an
estimate into an apparent statement about named people's homes.

Recommend not doing this without a decision recorded here first. Not built.

---

## Q-007 - OPEN - Can the Froehlich (2008) peak outflow equation be used in SI?

FEMA P-946 Table 9-2 gives Froehlich's peak outflow regression as

```text
Q_p = 3.1 * B_avg * H_w^1.5 * (gamma / (gamma + T_f * H_w))^3
```

The storage coefficient `gamma` appears in secondary sources as `23.4 * A_s / B_r` with
the reservoir surface area `A_s` in **acres** and widths in **feet**. This codebase is SI
throughout, and importing a regression constant without confirming its unit basis against
the original paper is exactly the kind of guess the Hydraulics Rule forbids.

So it is not implemented. The hydrograph's reference line is instead a trapezoidal weir
discharge, which derives from Bernoulli and whose coefficients are therefore transparent
in any unit system.

To close this: get Froehlich, D. C. (2008), *Journal of Hydraulic Engineering* 134(12),
confirm the definition and units of `gamma` and the coefficient 3.1, and either implement
it with the conversion written out in `docs/hydraulics.md` or record here that it is
English-units only and will not be used.

Worth doing. An empirical peak outflow from 74 real failures is a genuinely independent
check on the simulated peak, which the weir equation is not: the weir equation shares the
same geometry assumptions as the model it is checking.

---

## Resolved

## Q-000 - RESOLVED 2026-11-19 - Does the simulation need a server?

No. The solver runs in the browser on the GPU and all data sources are public and
keyless. The server is optional, for static hosting and tile caching only. See D-005.
