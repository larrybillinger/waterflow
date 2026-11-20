# Hydraulics

Every equation used in `src/sim/` is listed here with its source, the units of every
variable, and its known limits. The Hydraulics Rule in `AGENTS.md` requires that nothing
in the solver lacks an entry here.

Symbols follow the sources. SI throughout. `g = 9.80665 m/s^2`.

---

## 1. Governing equations: the local inertial approximation

**Source.** Bates, P. D., Horritt, M. S., & Fewtrell, T. J. (2010). "A simple inertial
formulation of the shallow water equations for efficient two-dimensional flood inundation
modelling." *Journal of Hydrology*, 387(1-2), 33-45. doi:10.1016/j.jhydrol.2010.03.027

This is the scheme used by LISFLOOD-FP and, in the same family, by SFINCS and Wflow. It
takes the Saint-Venant momentum equation and discards only the convective acceleration
term, keeping local acceleration, the pressure/bed slope term and the friction term. The
friction term is treated semi-implicitly, which is what makes the explicit scheme stable.

### 1.1 Momentum, per unit width

Implemented in `src/sim/shaders/flux.frag.glsl`.

For the face between cell `i` and its neighbour `i+1` in the x direction:

```text
hflow = max(h_i + z_i, h_i1 + z_i1) - max(z_i, z_i1)

S     = ((h_i1 + z_i1) - (h_i + z_i)) / dx

                q - g * dt * hflow * S
q_new  =  ---------------------------------------
           1 + g * dt * n^2 * |q| / hflow^(7/3)
```

| Symbol | Meaning | Units |
| --- | --- | --- |
| `q` | discharge per unit width across the face | m^2/s |
| `h` | water depth at a cell centre | m |
| `z` | bed elevation at a cell centre | m |
| `hflow` | depth available for flow across the face | m |
| `S` | water surface slope across the face | dimensionless |
| `n` | Manning's roughness coefficient | s/m^(1/3) |
| `dx` | cell size | m |
| `dt` | timestep | s |

**On the exponent 7/3.** The published form of the scheme is usually written for total
discharge `Q` as

```text
Q_new = (Q - g * A * dt * S) / (1 + g * dt * n^2 * |Q| / (R^(4/3) * A))
```

as given in the Wflow documentation of Bates et al. For flow per unit width across a
rectangular face, the area `A` becomes `hflow` and the hydraulic radius `R` is
approximated by `hflow`, which is standard for wide shallow flow. Substituting gives
`R^(4/3) * A = hflow^(4/3) * hflow = hflow^(7/3)`, which is the form above and the form
used in LISFLOOD-FP.

**The `hflow` definition matters.** Using the difference of water surface elevations over
the higher of the two bed elevations, rather than a simple average depth, is what lets the
scheme handle a wet cell next to a dry cell and flow over a rise without producing
spurious velocities. This is the standard wetting and drying treatment for this family of
models.

### 1.2 Continuity

Implemented in `src/sim/shaders/depth.frag.glsl`.

```text
h_new = h + (dt / dx) * (qx_west - qx_east + qy_south - qy_north)
```

Fluxes are per unit width and cells are square, so one division by `dx` converts flux
divergence to a depth rate. Depth is clamped at zero after the update.

### 1.3 Timestep: the CFL condition

Implemented in `src/sim/shaders/control.frag.glsl`.

**Source.** The adaptive timestep condition for this scheme, from Bates et al. (2010),
section 2.2:

```text
dt = alpha * dx / sqrt(g * h_max)
```

`h_max` is the greatest depth anywhere in the domain, found each frame by a GPU max
reduction. `alpha` is a stability coefficient; the paper recommends a value between 0.2
and 0.7, with 0.7 adequate for most cases. Waterflow defaults to `0.5` and exposes it in
`src/config.js` as `cflAlpha`.

The timestep is also clamped to `dtMin` and `dtMax` from `src/config.js` so that a very
deep reservoir cannot drive the timestep so small that the simulation appears frozen.

### 1.4 Froude limiter

**Source.** de Almeida, G. A. M., & Bates, P. (2013). "Applicability of the local inertial
approximation of the shallow water equations to flood modeling." *Water Resources
Research*, 49(8), 4833-4844.

This paper establishes that the local inertial approximation is reliable for Froude
numbers below about 0.5 and loses accuracy as the flow becomes supercritical. The jet
immediately downstream of a dam breach is strongly supercritical, which without a limiter
produces growing oscillations rather than a plausible result.

Waterflow caps the face velocity so the Froude number cannot exceed `froudeMax`,
default `1.2`, set in `src/config.js`:

```text
v     = q / hflow
Fr    = |v| / sqrt(g * hflow)
if Fr > froudeMax:  q = sign(q) * froudeMax * hflow * sqrt(g * hflow)
```

This is a stabilisation device, not physics. It is why `docs/validation.md` and the UI
both flag near-field stations as indicative. Recorded as risk R-002.

### 1.5 Flux limiter for mass positivity

A face is not allowed to remove more water from a cell in one step than that cell holds.
This is a standard safeguard for explicit shallow water schemes and prevents negative
depths at a drying front:

```text
q_max_drain = h_upstream * dx / (dt * 4)
```

The factor of 4 shares the cell's available water between its four faces. Without this,
a cell with four outflowing faces can over-drain and go negative.

---

## 2. Dam breach geometry and timing

### 2.1 Froehlich (2008)

**Source.** Froehlich, D. C. (2008). "Embankment dam breach parameters and their
uncertainties." *Journal of Hydraulic Engineering*, 134(12), 1708-1721.
doi:10.1061/(ASCE)0733-9429(2008)134:12(1708)

Fitted to 74 embankment dam failures: earthfill, zoned earthfill, earthfill with a core
wall, and rockfill.

Implemented in `src/sim/breach.js` as `froehlich2008`.

**Average breach width**

```text
B_avg = 0.27 * k_o * V_w^0.32 * h_b^0.04
```

**Breach formation time**

```text
t_f = 63.2 * sqrt(V_w / (g * h_b^2))
```

| Symbol | Meaning | Units |
| --- | --- | --- |
| `B_avg` | average breach width | m |
| `k_o` | failure mode factor: 1.3 overtopping, 1.0 piping | dimensionless |
| `V_w` | reservoir volume at time of failure | m^3 |
| `h_b` | height of the final breach | m |
| `t_f` | breach formation time | s |

Check the units on `t_f`: `m^3 / ((m/s^2) * m^2) = s^2`, so the square root is in seconds.
Waterflow converts to minutes for display only.

**Side slopes.** Froehlich recommends average breach side slopes of 1.0H:1V for
overtopping failures and 0.7H:1V for piping and seepage failures.

Because `B_avg` is the *average* width of a trapezoidal breach, the bottom width follows
from the side slope and the breach height:

```text
B_bottom = B_avg - z * h_b
```

where `z` is the side slope factor above. `B_bottom` is clamped at zero, which is the
degenerate triangular-breach case for a tall narrow breach.

### 2.2 Froehlich (1995), retained as an alternative

**Source.** Froehlich, D. C. (1995). "Embankment dam breach parameters revisited."
*Water Resources Engineering, Proceedings of the 1995 ASCE Conference on Water
Resources Engineering*, 887-891. Fitted to 63 failures.

As reproduced in FEMA P-946, *Federal Guidelines for Inundation Mapping of Flood Risks
Associated with Dam Incidents and Failures* (2013), Table 9-1:

```text
B_avg = 0.1803 * k_o * V_w^0.32 * h_b^0.19
t_f   = 0.00254 * V_w^0.53 * h_b^(-0.90)
```

Here `k_o` is 1.4 for overtopping and 1.0 otherwise, `V_w` is in m^3, `h_b` in m, and
`t_f` comes out in **hours**, not seconds. The unit difference from the 2008 equation is
a real trap and is handled explicitly in `src/sim/breach.js`.

### 2.3 Von Thun & Gillette (1990), retained as an alternative

**Source.** Von Thun, J. L., & Gillette, D. R. (1990). "Guidance on breach parameters."
Internal memorandum, U.S. Bureau of Reclamation. As reproduced in HEC-RAS documentation
and FEMA P-946.

```text
B_avg = 2.5 * h_w + C_b
```

`h_w` is the depth of water above the breach bottom in m, and `C_b` is a coefficient that
depends on reservoir storage. The storage-dependent table from the source is in
`src/sim/breach.js` as `VON_THUN_CB`.

### 2.4 Breach progression over time

**Source.** For the shape of the opening between initiation and full formation, the
linear and sinusoidal progression options follow the standard choices offered by HEC-RAS,
documented in U.S. Army Corps of Engineers, HEC-RAS *River Analysis System Hydraulic
Reference Manual*, chapter on dam breach analysis, and discussed in the context of
hydrograph sensitivity by Froehlich (2008).

Waterflow implements three progression curves, selectable in the UI:

```text
linear:      f(tau) = tau
sinusoidal:  f(tau) = 0.5 - 0.5 * cos(pi * tau)
quadratic:   f(tau) = tau^2
```

where `tau = (t - t_start) / t_f`, clamped to [0, 1]. `f` scales both the breach width and
the breach depth, so the opening grows in both dimensions together.

A sinusoidal progression starts and ends gently and is generally the most realistic of
the three for an erosional failure. Linear is the conservative default used in many
studies. Quadratic represents a slow start that accelerates, which is closer to a piping
failure that suddenly collapses.

### 2.5 Peak outflow cross-check

**Source.** Froehlich (2008), as tabulated in FEMA P-946 Table 9-2.

```text
Q_p = 3.1 * B_avg * H_w^1.5 * (gamma / (gamma + T_f * H_w))^3
```

Waterflow computes this and draws it on the hydrograph chart as a reference line against
the peak the simulation actually produced. It is a check, not an input. When the two
disagree by a large margin that is information for the user, and the UI says so.

---

## 3. Roughness

**Source.** Chow, V. T. (1959). *Open-Channel Hydraulics*. McGraw-Hill. Table 5-6, the
standard reference table for Manning's n. Values cross-checked against U.S. Geological
Survey Water-Supply Paper 2339, Arcement, G. J., & Schneider, V. R. (1989), *Guide for
Selecting Manning's Roughness Coefficients for Natural Channels and Flood Plains*.

The table in `src/sim/manning.js` carries minimum, normal and maximum values for each
surface type, because the spread is part of the information. The UI offers the normal
value and lets the user move within the published range.

Roughness is a single domain-wide value in v0.1.0. See open question Q-002.

---

## 4. Reservoir storage

Implemented in `src/sim/reservoir.js`.

The storage-elevation relationship is computed directly from the elevation grid rather
than from an assumed shape. For a candidate water surface elevation `W`, the pool is the
set of cells connected to a seed cell by a 4-neighbour flood fill through cells where
`z < W`. Then:

```text
A(W) = count(pool cells) * dx^2
V(W) = sum over pool cells of (W - z) * dx^2
```

This is the definition of volume, not an approximation of it, to within the resolution of
the grid. The flood fill connectivity constraint is what stops the pool from appearing in
an unconnected valley on the other side of a ridge at the same elevation.

Waterflow samples this at 64 elevations between the pool bottom and the dam crest to
build the storage curve shown in the UI.

---

## 5. Flow routing for station placement

### 5.1 Depression filling

**Source.** Wang, L., & Liu, H. (2006). "An efficient method for identifying and filling
surface depressions in digital elevation models for hydrologic analysis and modelling."
*International Journal of Geographical Information Science*, 20(2), 193-213.

Refined and popularised as "priority flood" by Barnes, R., Lehman, C., & Mulla, D. (2014).
"Priority-flood: An optimal depression-filling and watershed-labeling algorithm for
digital elevation models." *Computers & Geosciences*, 62, 117-127.

Implemented in `src/sim/routing.js` as `priorityFloodFill`. A priority queue is seeded
with the domain edge cells and repeatedly pops the lowest cell, raising each unvisited
neighbour to at least the popped cell's elevation. The result is a depression-free
surface.

Per decision D-007 the filled surface is used **only** to find the downstream path. The
simulation always uses the real, unfilled terrain, because real depressions catch real
water.

### 5.2 D8 flow direction

**Source.** O'Callaghan, J. F., & Mark, D. M. (1984). "The extraction of drainage networks
from digital elevation data." *Computer Vision, Graphics, and Image Processing*, 28(3),
323-344.

Each cell drains to whichever of its eight neighbours gives the steepest downward slope,
with the diagonal distance correctly weighted by `sqrt(2) * dx`.

### 5.3 Downstream path and stations

From the breach centre, the path follows D8 directions cell to cell on the filled surface
until it leaves the domain or revisits a cell. Stations are then placed at the user's
increment along the path by accumulated distance, measured along the path rather than
straight-line from the dam.

At each station a cross-section is cut perpendicular to the local path direction and
sampled at half-cell spacing. Flood width at a station is the total width of wetted
samples in that cross-section, which is the honest definition when a valley has more than
one wet channel.

---

## 6. What is a visual choice and not physics

Per the Hydraulics Rule, these live in `src/config.js` under `visual` and are explicitly
not hydraulics. They affect what the user sees and nothing that is reported as a number.

- Depth at which water starts to be drawn, and the alpha ramp at the shoreline.
- Beer-Lambert extinction coefficients used for water colour.
- Sediment tint and the speed at which it saturates.
- Foam thresholds and noise.
- Ripple amplitude, wavelength and scroll speed.
- Sun elevation and azimuth, sky tint, fog density.
- Vertical exaggeration of the terrain, which defaults to 1.0 and is clearly labelled when
  changed, because an exaggerated view makes a flood look deeper than it is.

Simulation parameters that are performance choices rather than physics, also in
`src/config.js`:

- Substeps per rendered frame.
- Frames between full state readbacks.
- Grid size and domain size defaults.
