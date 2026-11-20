# Sprint 001 - Acceptance Criteria

Each criterion is observable. A reviewer can confirm or reject it without reading code.

## Data

- [ ] AC-01 Entering a latitude and longitude loads real terrain for that place, and the
      shape of the terrain matches what a map of that place shows.
- [ ] AC-02 The UI shows the elevation source, tile zoom, cell size in metres, and the
      minimum and maximum elevation in the loaded domain.
- [ ] AC-03 If imagery fails to load, the terrain still renders with hillshade and
      hypsometric colour, and the UI says imagery is unavailable.
- [ ] AC-04 If elevation fails to load, the error message names the failing tile URL and
      the HTTP status.

## Rendering and navigation

- [ ] AC-05 The canvas fills the viewport with no scrollbar and no letterboxing, and
      stays correct after a window resize.
- [ ] AC-06 Left-drag pans so that the terrain point grabbed stays under the cursor.
- [ ] AC-07 Right-drag or Ctrl-drag orbits and tilts around the focus point.
- [ ] AC-08 Scrolling zooms toward the point under the cursor, not the screen centre.
- [ ] AC-09 Camera motion is damped, with no snapping or jitter.
- [ ] AC-10 The scene holds at least 55 fps at a 512 grid on integrated graphics, or
      drops render resolution automatically and reports that it did.
- [ ] AC-11 Water reads as water: visible depth, specular sun glint, sky reflection that
      changes with view angle, surface ripples, and foam on fast shallow flow.

## Reservoir and dam

- [ ] AC-12 Two clicks across a valley place a dam. The crest appears in the terrain.
- [ ] AC-13 A water surface elevation slider fills the reservoir behind the dam, visibly,
      and reports volume in cubic metres and acre-feet plus surface area.
- [ ] AC-14 The reservoir fill respects terrain: it does not leak around the dam ends or
      flood over a ridge.

## Breach and simulation

- [ ] AC-15 Breach width is settable as a percentage of dam length, breach depth as a
      percentage of dam height, and formation time in minutes.
- [ ] AC-16 An "estimate from Froehlich (2008)" action fills those fields from the
      reservoir volume and dam height, and the numbers match a hand calculation.
- [ ] AC-17 Pressing play visibly cuts the breach open over the formation time and
      releases water downstream.
- [ ] AC-18 The timeline can be paused, scrubbed and reset, and the clock reads in
      simulation time rather than wall clock time.
- [ ] AC-19 Water follows the valley downhill. It does not flow uphill, and it does not
      spread as a uniform disc.
- [ ] AC-20 The outflow hydrograph is drawn against simulation time, with the Froehlich
      (2008) peak outflow estimate marked for comparison.
- [ ] AC-21 Mass balance error is displayed and stays under 2 percent of initial
      reservoir volume for a default run.

## Results

- [ ] AC-22 Maximum depth, peak velocity and arrival time are recorded for every cell and
      can each be shown as a map overlay.
- [ ] AC-23 Stations are placed down the valley at a user-set increment, and appear in
      the 3D view.
- [ ] AC-24 A results table lists, per station: distance downstream, ground elevation,
      peak water surface elevation, peak depth, flood width, peak velocity and arrival
      time.
- [ ] AC-25 A long profile chart shows ground elevation and peak water surface against
      distance downstream.
- [ ] AC-26 Stations within the near-field distance of the breach are flagged as
      indicative.
- [ ] AC-27 Results export as CSV, and the file header carries the limitations notice and
      the run settings.

## Terrain editing

- [ ] AC-28 Brushes raise, lower, smooth and flatten terrain, with a visible brush cursor
      and adjustable radius and strength.
- [ ] AC-29 A channel brush carves a channel and a levee brush raises a ridge, both along
      a dragged line.
- [ ] AC-30 Undo reverses the last edit. Multiple undo steps work.
- [ ] AC-31 Re-running after an edit produces a different result, and the previous run's
      high water marks can still be compared against.

## Honesty

- [ ] AC-32 A limitations notice is visible without scrolling or opening a menu, and
      cannot be permanently dismissed.
- [ ] AC-33 Depths are reported to 0.1 m, not to centimetres.
- [ ] AC-34 The UI never calls the output an official or regulatory inundation map.

## Project hygiene

- [ ] AC-35 `npm test` passes.
- [ ] AC-36 `npm run lint` passes with no errors.
- [ ] AC-37 `VERSION`, `CHANGELOG.md` and `notes/release-notes/v0.1.0.md` all agree.
- [ ] AC-38 `docker compose up -d --build` serves the app.
- [ ] AC-39 No console errors on load or during a default run.
- [ ] AC-40 Every coefficient in `src/sim/` is cited in `docs/hydraulics.md`.
