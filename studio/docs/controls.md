# Controls

## Navigating

| Action | Input |
| --- | --- |
| Pan | Left-drag |
| Orbit and tilt | Right-drag, Ctrl-drag, middle-drag, or Shift-drag |
| Zoom | Scroll wheel or trackpad |
| Move | `W` `A` `S` `D` or arrow keys |
| Rotate | `Q` `E` |
| Tilt | `R` `F` |

Two behaviours make this feel like a map rather than a turntable, and both are
deliberate:

**Panning grabs the ground.** The terrain point under the cursor when the drag starts
stays under the cursor as you move. Most orbit controls pan by a screen-space delta
scaled by distance, which feels approximately right at the centre of the screen and wrong
everywhere else.

**Zoom goes toward the cursor.** Scrolling moves the camera toward the point under the
pointer, not the screen centre. Put the cursor on the thing you want and scroll.

Everything is damped, so motion carries a little inertia and nothing snaps.

### Tablet

One finger pans. Two fingers pinch to zoom and twist to rotate, and dragging the pinch
centre up or down tilts.

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play or pause |
| `Shift` + `R` | Reset to the moment before failure |
| `Tab` | Hide or show the interface |
| `C` | Cinematic mode |
| `Esc` | Leave the current tool, then leave cinematic mode |

`R` on its own tilts the camera, which is why reset is `Shift` + `R`: a reset triggered by
a key you are holding to look around would be infuriating.

## Building a dam

1. **Dam tab** → *Draw the dam*.
2. Click one side of the valley, then the other.

The crest becomes real terrain with sloped faces, and the reservoir fills behind it.

The default crest is the **lower** of the two points you clicked. A dam higher than that
does not impound more water; the water goes around the low end. Raise it with the slider
if you want to build up the abutment too.

*Crest width* defaults to at least three cells. A dam thinner than that leaks through
numerical diffusion, which looks like a bug and is not.

*Fill to crest* fills the reservoir to just below the crest. If the reservoir reaches the
edge of the loaded area the app says so: the volume is then limited by the boundary rather
than by terrain, and you want a wider area.

## Failing it

Three controls, which are the three things that matter:

| Control | Meaning |
| --- | --- |
| Breach width | Percentage of the dam's length that opens, measured across the crest |
| Breach depth | Percentage of the dam's height that erodes away |
| Formation time | How long the breach takes to reach full size |

*Fill from published equations* sets all three from the reservoir volume and dam height
using Froehlich (2008), or one of the other two regressions. Expect formation times of
hours for a large dam; that is what the data says, and it means very little happens in the
first twenty minutes.

**Progression** is the shape of the opening over time:

- *Sinusoidal* starts and ends gently. Usually the most realistic erosional failure.
- *Linear* is the conservative default used in many studies.
- *Quadratic* starts slowly and accelerates, closer to a piping failure that collapses.
- *Instantaneous* is an upper bound, not a real failure.

**Failure mode** changes the side slopes and the mode coefficient in the equations:
overtopping gives a wider breach than piping.

## Hydraulics

**Manning's n** is roughness. Pick a surface type and the slider moves within the
published range for it. Rougher means the flood arrives later and spreads shallower. It is
one value for the whole area.

**Let water leave the area edges** on means water flows out of the domain. Turn it off to
make the edges solid walls, which is useful for checking mass conservation.

**Solver substeps per frame** trades frame rate for how fast simulation time advances. If
the clock is crawling, raise this before raising the speed multiplier.

## Editing the terrain

| Brush | What it does |
| --- | --- |
| Raise | Builds ground up |
| Excavate | Digs ground away |
| Smooth | Averages the surface |
| Level | Flattens to the elevation under the first click |
| Carve channel | Drag a line to cut a channel along it |
| Build levee | Drag a line to raise an embankment along it |

The first four act where you drag. The last two act along a dragged line.

Edits go into the terrain the solver reads, so you can cut a spillway or raise a levee and
run again to see what changes. Undo steps back; *Revert all edits* restores the ground as
loaded.

Editing invalidates the current run and clears the results. That is intentional.

## Movie mode

Drop a **raft** on the water and it drifts on the simulated velocity field. Where it goes
is where the water goes. Drop it on dry ground and it sits there until the flood arrives,
which is worth watching in itself.

| Camera | Shot |
| --- | --- |
| Free look | Normal map navigation |
| Chase | Behind and above, looking downstream. Opens out as the raft speeds up. |
| Onboard | Riding the raft |
| Orbit | Circles the raft while it drifts |
| Watch point | Holds still on a tagged spot while the water arrives |
| Valley flyover | Flies the downstream path from the dam, independent of the simulation |

**Tag a watch point** first if you want the watch camera. It is the shot for "what does
this look like from here".

**Cinematic presentation** (`C`) hides the interface, adds letterboxing and a timecode.

**Enlarge raft so it stays visible** is on by default and is labelled because it is not
true to scale: a 3 m raft is a fraction of one simulation cell and invisible from
altitude. Turn it off for a true-scale view close up.

If a raft is carried out of the loaded area the camera hands control back rather than
staring off the edge of the world.

## Reading the results

**Overlays** are drawn on the ground, so they show where water went even after it drained
away. Maximum depth, arrival time and peak velocity.

**Stations** are placed down the valley at your chosen increment, along the path the water
actually follows. Each reports ground elevation, peak water surface, peak depth, flood
width, peak velocity and arrival time. Click a row to fly there.

**Cross-section half-width** sets how far either side of the channel each station looks.
Too narrow and a wide flood is cut off; too wide and the section reaches into the next
valley.

Rows marked `*` are close enough to the breach that the simplified momentum equation is
least reliable. Treat them as indicative.

**Export CSV** writes the table with a header recording the location, grid, roughness, dam
geometry, breach settings and the limitations notice.

## Diagnostics

The chips along the top: location, cell size, relief, reservoir volume, peak outflow and
frame rate.

If the frame rate chip goes amber the renderer has reduced its resolution to keep up, and
it says so. Lower the grid size or the substeps per frame for a permanent fix.

On the hydrograph, the dashed **weir estimate** line is an independent analytic
cross-check: weir discharge through the fully formed breach at the starting reservoir
level. It is an upper bound, because in reality the reservoir draws down while the breach
is still opening. A simulated peak well below it is expected. A simulated peak *above* it
means something is wrong.
