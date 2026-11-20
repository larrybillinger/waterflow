# Sprint 001 - Requirements

## Source brief

From the operator, 2026-11-19:

> Can you create project that will use publically available information to determine how
> much waterflow would go downstream and the high water marks and depts at certain
> incriments on the downstream valleys or waterflows. Use publically available maps and
> elivation maps and some publically available algorithm to determine and simulate the
> water flowing out of a water body. Allow yourself to simcity like dig out terain in
> order to test simulations.
>
> very important that the visual aspect is beautiful and accurate to real life, and the
> website can be game like simcity, full screen edge to edge performance on screen
>
> if you can move the map around google earth like 3d that would be even more awesome!

From `README.md` on `main`:

> shows waterflows over a timeline if a dam fails. Allows you to choose how quickly or a
> percentage of a dam failure.

## Functional requirements

| ID | Requirement |
| --- | --- |
| F-01 | Load elevation data for a user-chosen location from a public, keyless source. |
| F-02 | Drape public map imagery over the terrain. Degrade gracefully if imagery fails. |
| F-03 | Render terrain and water in 3D, full screen, edge to edge, with no page scroll. |
| F-04 | Navigate the 3D scene like Google Earth: pan, orbit, tilt, zoom toward cursor. |
| F-05 | Define a water body: place a dam across a valley and fill a reservoir to a chosen water surface elevation. Report impounded volume and surface area. |
| F-06 | Choose what fraction of the dam fails, how deep the breach cuts, and how long formation takes. Offer published regression equations as a default. |
| F-07 | Simulate the outflow and downstream routing with a published algorithm over a timeline the user can play, pause and scrub. |
| F-08 | Record and display high water marks, peak depth, peak velocity and arrival time for every cell. |
| F-09 | Report those values at user-set increments along the downstream valley, as a table and a long profile. |
| F-10 | Let the user reshape the terrain with brushes, then re-run and compare against the previous run. |
| F-11 | Export results. |
| F-12 | State the accuracy limits of the result plainly and permanently in the UI. |

## Non-functional requirements

| ID | Requirement |
| --- | --- |
| N-01 | No API keys. No account. No paid service. |
| N-02 | Runs as a static site. The server is optional. |
| N-03 | 60 fps target at a 512 cell grid on integrated graphics. Degrade resolution rather than drop frames. |
| N-04 | Every equation in the solver traceable to a cited publication. |
| N-05 | Visually beautiful and physically plausible. Water must read as water, not as a blue overlay. |
| N-06 | Works on a tablet in landscape. |
| N-07 | Follows the house standards: VERSION, CHANGELOG, release notes, planning docs, lint, format, tests. |

## Out of scope for this sprint

Rainfall and infiltration. Sediment transport. Multi-dam cascades. Structures and
buildings. Real dam inventory lookup. Spatially varying roughness. Scenario save and
reload. User accounts. Mobile portrait layout.
