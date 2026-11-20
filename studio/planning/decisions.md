# Decisions

Append-only record. Each decision gets an ID, a date, the decision, and why.

---

## D-001 - 2026-11-19 - Solve the local inertial form of the shallow water equations

**Decision.** The flood engine solves the local inertial approximation of the shallow
water equations on a staggered grid, following Bates, Horritt & Fewtrell (2010).

**Why.** Three candidates were considered.

| Option | Verdict |
| --- | --- |
| Full 2D shallow water equations with an HLLC Riemann solver | Most accurate for the near field of a dam break, but needs careful wet/dry front handling and is far harder to keep stable in a fragment shader. Too much for a first release. |
| Cellular automata / pipe model | Fast and easy, but the result is not a defensible depth. It looks like water rather than being water. Rejected because the whole point is reportable high water marks. |
| Local inertial approximation | Keeps the local acceleration term and the full friction term, drops only convective acceleration. Explicit, so every cell updates independently, which maps exactly onto a fragment shader. Published, widely used, and validated in the literature. Chosen. |

**Consequence.** The model is accurate for subcritical and mildly supercritical flow and
degrades where convective acceleration dominates, which is the first few hundred metres
below the breach. This is recorded as R-002 and surfaced in the UI.

---

## D-002 - 2026-11-19 - Run the solver on the GPU in fragment shaders

**Decision.** The solver state lives in floating point textures and is advanced by
fragment shader passes with ping-pong framebuffers. No WebGPU, no compute shaders.

**Why.** A 512 x 512 grid is 262,144 cells. At 8 substeps per frame and 60 frames per
second that is 126 million cell updates per second, which JavaScript cannot do. WebGL2
is available in every browser the operator is likely to use, including on a tablet.
WebGPU would be faster but is still inconsistent across browsers and would cut the
device list. Revisit when WebGPU is universal.

**Consequence.** Needs the `EXT_color_buffer_float` extension. The app detects this at
startup and reports a specific error if it is missing rather than failing silently.

---

## D-003 - 2026-11-19 - The breach is a change to the terrain, not an injected inflow

**Decision.** A dam is real terrain in the elevation grid. A breach is that terrain being
progressively cut away over the formation time. Water leaves the reservoir because the
solver routes it through the notch, not because a hydrograph is injected at a boundary.

**Why.** Injecting a hydrograph computed from a weir equation means two models that can
disagree with each other, and it does not conserve mass against the reservoir. Cutting
the dam down makes the reservoir drawdown, the outflow hydrograph and the downstream
routing all fall out of one mass-conserving simulation. It also means the dam-building
tool and the breach mechanism are the same code, which is less to maintain and makes
the "percentage of dam failure" control in the original brief physically meaningful.

**Consequence.** The reported outflow hydrograph is measured from the simulation rather
than prescribed. The Froehlich (2008) peak outflow equation is still computed and drawn
on the hydrograph chart as an independent cross-check, which is a feature rather than a
redundancy. If the two disagree badly, the user can see it.

---

## D-004 - 2026-11-19 - Terrarium elevation tiles are the only elevation source in v0.1.0

**Decision.** Elevation comes from the AWS Open Data Terrarium terrain tiles at
`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`.

**Why.** Global coverage, no API key, no authentication, plain PNG so the browser decodes
it natively with zero dependencies, and documented encoding. In the United States the
underlying data is largely 3DEP at 10 m, which is the same order of resolution that real
2D dam breach studies are run at.

Higher resolution sources were considered and deferred. The USGS 3DEP ImageServer can
return float32 GeoTIFF or LERC, both of which need a decoding library in the browser and
a lot more plumbing. That is a sprint of its own, not a side feature. See Q-003.

**Consequence.** Effective horizontal resolution is roughly 10 m in the United States and
coarser elsewhere. Narrow channels, individual levees and bridge openings are below the
resolution of the data. Recorded as R-001.

---

## D-005 - 2026-11-19 - No API keys, and the server proxy is optional

**Decision.** The browser fetches public tiles directly by default. The bundled Node
server is optional and does two things: serves the built static files, and if enabled,
proxies and disk-caches tiles.

**Why.** The app must work as a plain static site so it can be hosted anywhere and
reviewed easily. But a self-hosted Synology deployment benefits from a local tile cache,
both for speed on repeat visits and to stop depending on a third party's CORS headers.
Making the proxy optional gets both without forcing either.

**Consequence.** Two supported deployment modes, documented in the README. `VITE_TILE_PROXY`
switches between them.

---

## D-006 - 2026-11-19 - Plain JavaScript modules with JSDoc, not TypeScript

**Decision.** `src/` is ES modules in plain JavaScript, with JSDoc type annotations on
anything non-obvious.

**Why.** The house standards call for formatting and linting rather than a specific
language, and the operator's other work is PowerShell, Python and Django. Plain
JavaScript means the source that runs in the browser is the source in the repository,
which makes shader debugging and stepping through the solver much easier. JSDoc gives
editor type hints without a compile step to misconfigure.

**Consequence.** No compile-time type checking. Mitigated by unit tests on every pure
function in `src/sim/` and `src/data/geo.js`, which is where a type error would actually
cost something.

---

## D-007 - 2026-11-19 - Depression filling for flow routing only, never for the simulation

**Decision.** The downstream path tracer fills terrain depressions using the priority
flood algorithm (Wang & Liu 2006; Barnes, Lehman & Mulla 2014) before computing D8 flow
directions. The filled grid is used only to find the path. The simulation always uses the
unfilled terrain.

**Why.** D8 tracing walks into a pit and stops, which on real terrain happens within a few
kilometres and would truncate the station list. Filling fixes that. But filling also
removes the real depressions that catch and hold floodwater, so using a filled grid in
the solver would give wrong depths and wrong arrival times.

**Consequence.** The station chain follows a hydrologically continuous path even across
flat ground, while the depths reported at those stations come from the real terrain.

---

## D-008 - 2026-11-19 - Reflected sky is evaluated analytically, with no cubemap

**Decision.** The sky is a procedural function in GLSL. The water shader reflects by
evaluating that same function along the reflected view ray.

**Why.** It gives a mathematically correct horizon in the reflection, costs one function
call instead of a cubemap render target, needs no assets, and stays correct when the sun
angle changes. A cubemap would need re-rendering whenever the sun moved and would still
be lower resolution at the horizon, which is exactly where water reflections are most
visible.

**Consequence.** The water reflects the sky and the sun but not the terrain. At low
grazing angles against a near hillside this reads as slightly too bright. Accepted for
v0.1.0; planar reflection is a candidate for a later sprint.
