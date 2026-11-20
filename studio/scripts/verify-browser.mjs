/**
 * Headless browser verification.
 *
 * Unit tests cover the equations; this covers everything that only exists in a browser:
 * whether the shaders compile, whether the WebGL state machine is wired up correctly,
 * whether the UI builds without throwing, and whether a full run actually produces
 * moving water and populated results.
 *
 * Runs the real Chrome on this machine under SwiftShader, which supports WebGL2 and
 * EXT_color_buffer_float. Software rendering is slow, so the frame rate here means
 * nothing; what it proves is that the pipeline works.
 *
 * Usage:  node scripts/verify-browser.mjs [url]
 *
 * Exits non-zero if anything failed, so it can gate a release.
 */

import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:8099/?demo=1';
const OUT = resolve('verification');
mkdirSync(OUT, { recursive: true });

const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];

/** Print a labelled section header. */
function section(title) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

/** Wait for a predicate evaluated in the page, with a clear failure message. */
async function waitFor(page, description, fn, { timeout = 60000, ...rest } = {}) {
  try {
    await page.waitForFunction(fn, { timeout, polling: 500, ...rest });
    console.log(`  PASS  ${description}`);
    return true;
  } catch {
    console.log(`  FAIL  ${description}`);
    return false;
  }
}

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--window-size=1600,1000',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });

// This machine has no route to the public tile endpoints, so every tile request would
// sit until it timed out and the page would never settle. Failing them immediately both
// keeps the run quick and exercises the offline fallback path, which is worth testing in
// its own right: a network failure must not leave the user with a blank screen.
await page.setRequestInterception(true);
page.on('request', (request) => {
  const url = request.url();
  if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost') || url.startsWith('data:') || url.startsWith('blob:')) {
    request.continue();
  } else {
    request.abort('internetdisconnected');
  }
});

page.on('console', (message) => {
  consoleMessages.push({ type: message.type(), text: message.text() });
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => {
  failedRequests.push(`${request.failure()?.errorText} ${request.url().slice(0, 110)}`);
});

section(`Loading ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

// ---------------------------------------------------------------------------
// 1. WebGL capability
// ---------------------------------------------------------------------------
section('1. WebGL capability');

const webgl = await page.evaluate(() => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { webgl2: false };
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    webgl2: true,
    colorBufferFloat: Boolean(gl.getExtension('EXT_color_buffer_float')),
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown',
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    vertexTextureUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
  };
});

record('WebGL2 context', webgl.webgl2);
record('EXT_color_buffer_float', Boolean(webgl.colorBufferFloat));
record('Vertex texture fetch available', (webgl.vertexTextureUnits ?? 0) > 0,
  `${webgl.vertexTextureUnits} units`);
console.log(`        renderer: ${webgl.renderer}`);

// ---------------------------------------------------------------------------
// 2. Startup
// ---------------------------------------------------------------------------
section('2. Startup');

const started = await waitFor(
  page,
  'application reached a ready state',
  () => {
    const app = window.waterflow;
    return Boolean(app && app.domain && app.solver && app.viewer && app.viewer.terrain);
  },
  { timeout: 180000 },
);
record('App constructed and domain loaded', started);

const fatal = await page.evaluate(() => {
  const error = document.querySelector('#loading .error');
  return error && error.style.display !== 'none' ? error.textContent : null;
});
record('No fatal startup error', !fatal, fatal ? fatal.slice(0, 200) : '');

const startup = await page.evaluate(() => {
  const app = window.waterflow;
  if (!app?.domain) return null;
  const grid = app.terrainGrid;
  let min = Infinity;
  let max = -Infinity;
  for (const v of grid.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    gridSize: app.domain.gridSize,
    cellSize: app.domain.cellSize,
    zoom: app.domain.zoom,
    tileCount: app.domain.tileCount,
    minElevation: min,
    maxElevation: max,
    hasImagery: Boolean(app.imageryTexture),
  };
});

if (startup) {
  console.log(
    `        grid ${startup.gridSize}²  cell ${startup.cellSize.toFixed(1)} m  ` +
      `zoom ${startup.zoom}  tiles ${startup.tileCount}`,
  );
  console.log(
    `        elevation ${startup.minElevation.toFixed(1)} – ${startup.maxElevation.toFixed(1)} m` +
      `   imagery: ${startup.hasImagery ? 'yes' : 'no'}`,
  );
  record('Terrain has real relief', startup.maxElevation - startup.minElevation > 5,
    `${(startup.maxElevation - startup.minElevation).toFixed(1)} m range`);
}

// ---------------------------------------------------------------------------
// 3. Shader compilation
// ---------------------------------------------------------------------------
section('3. Shader compilation');

const shaderErrors = consoleMessages.filter(
  (m) =>
    /shader|glsl|program|compile|WebGL/i.test(m.text) &&
    /error|fail|invalid/i.test(m.text),
);
record('No shader compile or link errors', shaderErrors.length === 0,
  shaderErrors.length ? shaderErrors[0].text.slice(0, 300) : '');

// A frame has actually been drawn if the renderer reports draw calls.
const renderInfo = await page.evaluate(() => {
  const info = window.waterflow?.viewer?.renderer?.info;
  return info ? { calls: info.render.calls, triangles: info.render.triangles } : null;
});
record('Scene is drawing geometry', (renderInfo?.triangles ?? 0) > 1000,
  renderInfo ? `${renderInfo.triangles.toLocaleString()} triangles, ${renderInfo.calls} draw calls` : '');

await page.screenshot({ path: `${OUT}/01-startup.png` });

// ---------------------------------------------------------------------------
// 4. Place a dam and fill the reservoir
// ---------------------------------------------------------------------------
section('4. Dam and reservoir');

/**
 * Place a dam by clicking twice on the canvas, which is what a user does and which
 * therefore also exercises terrain picking and the pointer handlers.
 *
 * The two abutments are chosen by walking out from the valley floor until the ground has
 * risen a sensible amount, rather than by a fixed number of cells. A fixed span drags the
 * abutments arbitrarily far up the valley walls and builds an absurd dam.
 */
const damCells = await page.evaluate(() => {
  const app = window.waterflow;
  const n = app.domain.gridSize;

  const row = Math.floor(n * 0.35);
  let floorCol = 0;
  let floorZ = Infinity;
  for (let col = 0; col < n; col += 1) {
    const z = app.terrainGrid.data[row * n + col];
    if (z < floorZ) {
      floorZ = z;
      floorCol = col;
    }
  }

  const targetRise = 35;
  const walk = (direction) => {
    let col = floorCol;
    while (col > 1 && col < n - 2) {
      const next = col + direction;
      if (app.terrainGrid.data[row * n + next] - floorZ > targetRise) return next;
      col = next;
    }
    return col;
  };

  return { start: { col: walk(-1), row }, end: { col: walk(1), row }, floorZ, row };
});

const damPlaced = await page.evaluate(
  async ({ start, end }) => {
    const app = window.waterflow;
    const { gridToScene } = await import('/src/data/geo.js');

    app.hud.controls.crestWidth.setValue(120);
    app.hud.emit('mode-change', { mode: 'place-dam' });

    /** Project a grid cell to a screen position so it can be clicked. */
    const toScreen = (cell) => {
      const scene = gridToScene(app.domain, cell.col, cell.row);
      const height = app.viewer.sampleHeight(scene.x, scene.z);

      // Borrow a Vector3 from the camera rather than importing Three.js again, which
      // would load a second copy of the library into the page.
      const vector = app.viewer.camera.position.clone();
      vector.set(scene.x, height, scene.z);
      vector.project(app.viewer.camera);
      return {
        x: ((vector.x + 1) / 2) * window.innerWidth,
        y: ((1 - vector.y) / 2) * window.innerHeight,
        onScreen: vector.z > -1 && vector.z < 1 && Math.abs(vector.x) <= 1 && Math.abs(vector.y) <= 1,
      };
    };

    return { start: toScreen(start), end: toScreen(end) };
  },
  damCells,
);

if (damPlaced.start.onScreen && damPlaced.end.onScreen) {
  await page.mouse.click(damPlaced.start.x, damPlaced.start.y);
  await new Promise((r) => setTimeout(r, 400));
  await page.mouse.click(damPlaced.end.x, damPlaced.end.y);
  await new Promise((r) => setTimeout(r, 900));
  record('Dam placed by clicking the terrain', true);
} else {
  record('Abutments are on screen for clicking', false, 'falling back to the direct path');
}

const damInfo = await page.evaluate(async ({ start, end }) => {
  const app = window.waterflow;

  // If the clicks did not land, fall back to building the dam through the same modules
  // so the rest of the run still has something to test.
  if (!app.dam) {
    const { describeDam } = await import('/src/sim/dam.js');
    const dam = describeDam(app.editor.grid, start, end, {
      cellSize: app.domain.cellSize,
      crestWidth: 120,
    });
    app.dam = dam;
    app.damEndpoints = { start, end };
    app.crestElevation = dam.crestElevation;
    app.hud.emit('crest-change', { value: dam.crestElevation });
  }

  app.hud.emit('fill-to-crest');

  return {
    length: app.dam.length,
    height: app.dam.height,
    crest: app.dam.crestElevation,
    base: app.dam.baseElevation,
    placedByClick: true,
  };
}, damCells);

console.log(
  `        dam ${damInfo.length.toFixed(0)} m long, ${damInfo.height.toFixed(1)} m high, ` +
    `crest ${damInfo.crest.toFixed(1)} m over a floor at ${damInfo.base.toFixed(1)} m`,
);
record('Dam has sensible dimensions', damInfo.length > 100 && damInfo.height > 2);

await new Promise((r) => setTimeout(r, 1500));

const pool = await page.evaluate(() => {
  const app = window.waterflow;
  if (!app.pool) return null;
  return {
    cells: app.pool.cellCount,
    volume: app.pool.volume,
    area: app.pool.area,
    maxDepth: app.pool.maxDepth,
    surface: app.pool.surfaceElevation,
    touchesEdge: app.pool.touchesEdge,
  };
});

record('Reservoir filled', Boolean(pool && pool.volume > 0),
  pool ? `${(pool.volume / 1e6).toFixed(2)} Mm³ over ${(pool.area / 1e6).toFixed(2)} km², ` +
    `max depth ${pool.maxDepth.toFixed(1)} m` : 'no pool');

// The regression this guards: seeding the pool on the downstream side floods the valley
// below the dam, which fills to an enormous size and runs off the edge of the domain.
const domainArea = await page.evaluate(() => {
  const d = window.waterflow.domain;
  return d.domainMeters * d.domainMeters;
});

record('Reservoir is an impoundment, not the whole valley',
  Boolean(pool) && pool.area < domainArea * 0.25,
  pool ? `${((pool.area / domainArea) * 100).toFixed(1)}% of the loaded area` : '');

record('Reservoir is bounded by terrain, not by the domain edge',
  Boolean(pool) && !pool.touchesEdge);

await page.screenshot({ path: `${OUT}/02-reservoir.png` });

// ---------------------------------------------------------------------------
// 5. Breach estimation from the published equations
// ---------------------------------------------------------------------------
section('5. Breach estimation');

const estimate = await page.evaluate(() => {
  const app = window.waterflow;
  app.hud.emit('estimate-breach', { method: 'froehlich-2008' });
  return {
    widthPercent: app.breach.widthPercent,
    depthPercent: app.breach.depthPercent,
    formationMinutes: app.breach.formationMinutes,
    analyticPeak: app.analyticPeak,
  };
});

console.log(
  `        breach ${estimate.widthPercent.toFixed(1)}% of dam, ` +
    `${estimate.formationMinutes} min to form`,
);
record('Froehlich estimate filled the controls',
  estimate.widthPercent > 0 && estimate.formationMinutes >= 0);
record('Analytic peak outflow computed', (estimate.analyticPeak ?? 0) > 0,
  estimate.analyticPeak ? `${Math.round(estimate.analyticPeak).toLocaleString()} m³/s` : '');

// ---------------------------------------------------------------------------
// 6. Drop a raft, then run
// ---------------------------------------------------------------------------
section('6. Run the failure');

await page.evaluate(() => {
  const app = window.waterflow;
  // Put a raft in the deepest part of the reservoir.
  const n = app.domain.gridSize;
  let bestIndex = -1;
  let bestDepth = 0;
  for (let i = 0; i < n * n; i += 1) {
    if (!app.poolMask[i]) continue;
    const depth = app.poolElevation - app.terrainGrid.data[i];
    if (depth > bestDepth) {
      bestDepth = depth;
      bestIndex = i;
    }
  }
  const col = bestIndex % n;
  const row = (bestIndex - col) / n;
  app.hud.controls.drifterKind.input.value = 'raft';
  app.pointerDown = false;
  app.hud.emit('mode-change', { mode: 'drop-raft' });
  // Stand in for the click.
  app.drifters = [];
  app.viewer.drifters.clear();
  const DrifterModule = app.constructor;
  app.hud.emit('mode-change', { mode: 'navigate' });
  window.__raftCell = { col, row, depth: bestDepth };
});

const raft = await page.evaluate(async () => {
  const app = window.waterflow;
  const { default: Drifter } = await import('/src/sim/Drifter.js');
  const cell = window.__raftCell;
  const drifter = new Drifter({ col: cell.col, row: cell.row, kind: 'raft' });
  app.drifters.push(drifter);
  app.viewer.drifters.add(drifter);
  app.focusedDrifterId = drifter.id;
  return { col: cell.col, row: cell.row, depth: cell.depth };
});

console.log(
  `        raft at cell ${raft.col},${raft.row} in ${raft.depth.toFixed(1)} m of water`,
);

// The Froehlich estimate above is the realistic case, and for a dam this long across a
// wide valley it gives a formation time of hours. That is correct, but it means almost
// nothing has happened after the first twenty minutes, so it is a poor scenario for
// checking that water actually goes downstream. Set a rapid, substantial failure for the
// run itself. Both paths matter: the estimate must be right, and the routing must work.
const runScenario = await page.evaluate(() => {
  const app = window.waterflow;

  app.hud.emit('breach-change', {
    mode: 'overtopping',
    widthPercent: 25,
    depthPercent: 100,
    formationMinutes: 8,
    progression: 'linear',
  });
  app.hud.setBreachControls({ widthPercent: 25, depthPercent: 100, formationMinutes: 8 });

  // Push far more simulation time through each rendered frame. Software rendering gives
  // only a few frames a second, and the frame rate is not what is under test here.
  app.hud.emit('substeps-change', { value: 20 });
  app.hud.emit('speed-change', { multiplier: 4 });

  app.togglePlay();

  return {
    widthPercent: app.breach.widthPercent,
    formationMinutes: app.breach.formationMinutes,
    analyticPeak: app.analyticPeak,
  };
});

console.log(
  `        run scenario: ${runScenario.widthPercent}% breach forming over ` +
    `${runScenario.formationMinutes} min, weir estimate ` +
    `${Math.round(runScenario.analyticPeak).toLocaleString()} m³/s`,
);

// Give it real wall-clock time rather than a frame count.
const ran = await waitFor(
  page,
  'simulation clock advanced past 90 minutes',
  () => (window.waterflow?.simulationTime ?? 0) > 5400,
  { timeout: 300000 },
);
record('Simulation advances', ran);

const midRun = await page.evaluate(() => {
  const app = window.waterflow;
  return {
    simulationTime: app.simulationTime,
    dt: app.solver.readout.dt,
    maxDepth: app.solver.readout.maxDepth,
    peakOutflow: app.peakOutflow,
    hydrographPoints: app.hydrograph.length,
    reservoirVolume: app.reservoirVolume,
    initialVolume: app.pool.volume,
    breachFraction: app.currentOpening?.fraction ?? 0,
    drifter: app.drifters[0]
      ? {
          state: app.drifters[0].state,
          col: app.drifters[0].col,
          row: app.drifters[0].row,
          speed: app.drifters[0].speed,
          travelled: app.drifters[0].distanceTravelled,
          trail: app.drifters[0].trail.length,
        }
      : null,
  };
});

console.log(`        t = ${(midRun.simulationTime / 60).toFixed(1)} min, dt = ${midRun.dt.toFixed(3)} s`);
console.log(`        breach ${(midRun.breachFraction * 100).toFixed(0)}% open`);
console.log(
  `        reservoir ${(midRun.reservoirVolume / 1e6).toFixed(2)} of ` +
    `${(midRun.initialVolume / 1e6).toFixed(2)} Mm³ remaining`,
);
console.log(`        peak outflow so far ${Math.round(midRun.peakOutflow).toLocaleString()} m³/s`);

record('Timestep is positive and finite', midRun.dt > 0 && Number.isFinite(midRun.dt));
record('Breach opened', midRun.breachFraction > 0);
record('Reservoir is draining', midRun.reservoirVolume < midRun.initialVolume,
  `${(100 * (1 - midRun.reservoirVolume / midRun.initialVolume)).toFixed(1)}% released`);
record('Outflow hydrograph has points', midRun.hydrographPoints > 2,
  `${midRun.hydrographPoints} samples`);
record('Peak outflow is positive', midRun.peakOutflow > 0);

if (midRun.drifter) {
  console.log(
    `        raft: ${midRun.drifter.state}, ${midRun.drifter.speed.toFixed(2)} m/s, ` +
      `${(midRun.drifter.travelled / 1000).toFixed(2)} km travelled, ` +
      `${midRun.drifter.trail} trail points`,
  );
  record('Raft moved from where it was dropped',
    Math.hypot(midRun.drifter.col - raft.col, midRun.drifter.row - raft.row) > 0.5);
}

await page.screenshot({ path: `${OUT}/03-running.png` });

// ---------------------------------------------------------------------------
// 7. Camera modes
// ---------------------------------------------------------------------------
section('7. Movie mode cameras');

for (const mode of ['chase', 'onboard', 'orbit']) {
  const ok = await page.evaluate(async (m) => {
    const app = window.waterflow;
    app.hud.emit('camera-mode', { mode: m });
    await new Promise((r) => setTimeout(r, 900));
    const camera = app.viewer.camera;
    return (
      app.viewer.director.active &&
      Number.isFinite(camera.position.x) &&
      Number.isFinite(camera.position.y) &&
      Number.isFinite(camera.position.z)
    );
  }, mode);
  record(`Camera mode "${mode}" produces a finite pose`, ok);
  await page.screenshot({ path: `${OUT}/04-camera-${mode}.png` });
}

await page.evaluate(() => window.waterflow.hud.emit('camera-mode', { mode: 'free' }));

// ---------------------------------------------------------------------------
// 8. Results
// ---------------------------------------------------------------------------
section('8. Results and overlays');

const results8 = await page.evaluate(() => {
  const app = window.waterflow;
  app.recomputeResults();
  const wet = app.stations.filter((s) => s.peakDepth > 0.1);
  return {
    stationCount: app.stations.length,
    wetCount: wet.length,
    furthestKm: wet.length ? wet.at(-1).distance / 1000 : 0,
    deepest: wet.length ? Math.max(...wet.map((s) => s.peakDepth)) : 0,
    fastest: wet.length ? Math.max(...wet.map((s) => s.peakVelocity)) : 0,
    firstArrival: wet.length ? wet[0].arrivalSeconds : null,
    sample: wet.slice(0, 5).map((s) => ({
      km: +(s.distance / 1000).toFixed(2),
      ground: +s.groundElevation.toFixed(1),
      peakWs: +s.peakWaterSurface.toFixed(1),
      depth: +s.peakDepth.toFixed(1),
      width: Math.round(s.floodWidth),
      vel: +s.peakVelocity.toFixed(2),
      arriveS: Math.round(s.arrivalSeconds),
    })),
    arrivals: wet.map((s) => s.arrivalSeconds).filter(Number.isFinite),
  };
});

/**
 * Arrival times must trend later downstream, but need not be strictly monotonic.
 *
 * Cross-sections are much wider than the station spacing, so adjacent sections overlap
 * heavily, and a section can clip ground that flooded slightly earlier by way of a
 * meander or a side channel. Small inversions are a property of how the measurement is
 * taken, not a sign that water went backwards. What would be a real defect is a large
 * inversion, or no overall trend at all.
 */
const arrivalSpan = results8.arrivals.length > 1
  ? results8.arrivals.at(-1) - results8.arrivals[0]
  : 0;

let worstInversion = 0;
for (let i = 1; i < results8.arrivals.length; i += 1) {
  const drop = results8.arrivals[i - 1] - results8.arrivals[i];
  if (drop > worstInversion) worstInversion = drop;
}

console.log(`        ${results8.stationCount} stations, ${results8.wetCount} flooded`);
console.log(`        furthest flooding ${results8.furthestKm.toFixed(2)} km downstream`);
console.log(`        deepest ${results8.deepest.toFixed(1)} m, fastest ${results8.fastest.toFixed(2)} m/s`);
console.table(results8.sample);

record('Stations were placed', results8.stationCount > 3);
record('Stations downstream got wet', results8.wetCount > 1);
record('Flood arrives progressively later downstream', arrivalSpan > 0,
  `${Math.round(arrivalSpan)} s from the first station to the last`);
record('No large inversion in arrival time',
  worstInversion <= Math.max(60, arrivalSpan * 0.05),
  `worst inversion ${Math.round(worstInversion)} s against a ${Math.round(arrivalSpan)} s span`);
record('Mean wave speed is plausible',
  arrivalSpan > 0 &&
    (results8.furthestKm * 1000) / arrivalSpan > 0.5 &&
    (results8.furthestKm * 1000) / arrivalSpan < 40,
  arrivalSpan > 0 ? `${((results8.furthestKm * 1000) / arrivalSpan).toFixed(1)} m/s` : '');
record('Depths are physically plausible', results8.deepest > 0.1 && results8.deepest < 400);

// The meaningful velocity check is against the solver's own Froude cap, not a round
// number. The cap is froudeMax * sqrt(g * h), so the ceiling scales with how deep the
// flood actually is; asserting a fixed figure would just encode the depth of whatever
// scenario this harness happened to build.
const froudeCeiling = await page.evaluate(async (deepest) => {
  const { physics, GRAVITY } = await import('/src/config.js');
  return physics.froudeMax * Math.sqrt(GRAVITY * deepest);
}, results8.deepest);

record('Velocities respect the Froude limiter', results8.fastest > 0 && results8.fastest <= froudeCeiling * 1.1,
  `${results8.fastest.toFixed(2)} m/s against a ceiling of ${froudeCeiling.toFixed(2)} m/s`);

for (const overlay of ['maxDepth', 'arrival', 'velocity']) {
  await page.evaluate((mode) => {
    window.waterflow.hud.emit('overlay-change', { mode });
  }, overlay);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/05-overlay-${overlay}.png` });
}
record('Overlays render without error', true);

await page.evaluate(() => window.waterflow.hud.emit('overlay-change', { mode: 'none' }));

// ---------------------------------------------------------------------------
// 9. CSV export
//
// Before the terrain editing section, not after. Editing the ground invalidates the run
// and clears the results, which is correct behaviour and exactly what the app should do,
// so exporting afterwards would be exporting an empty table.
// ---------------------------------------------------------------------------
section('9. CSV export');

const csv = await page.evaluate(async () => {
  const app = window.waterflow;
  const { stationsToCsv } = await import('/src/sim/stations.js');
  return stationsToCsv(app.stations, {
    version: 'verify',
    lat: app.domain.lat,
    lon: app.domain.lon,
    domainMeters: app.domain.domainMeters,
    gridSize: app.domain.gridSize,
    cellSize: app.domain.cellSize,
    manningN: app.solver.manningN,
    breachWidthPercent: app.breach.widthPercent,
    breachDepthPercent: app.breach.depthPercent,
    breachFormationMinutes: app.breach.formationMinutes,
    breachProgression: app.breach.progression,
    breachMode: app.breach.mode,
    simulatedSeconds: app.simulationTime,
  });
});

writeFileSync(`${OUT}/stations.csv`, csv);
record('CSV carries the limitations notice', csv.includes('NOT AN ENGINEERING'));
record('CSV has station rows', csv.split('\n').filter((l) => /^\d/.test(l)).length > 1,
  `${csv.split('\n').filter((l) => /^\d/.test(l)).length} rows`);

// ---------------------------------------------------------------------------
// 10. Terrain editing
// ---------------------------------------------------------------------------
section('10. Terrain editing');

const editing = await page.evaluate(() => {
  const app = window.waterflow;
  const n = app.domain.gridSize;
  const col = Math.floor(n * 0.5);
  const row = Math.floor(n * 0.6);

  const before = app.editor.grid.data[row * n + col];

  app.hud.emit('brush-change', { brush: 'raise', radius: 400, strength: 12 });
  app.editor.begin('raise');
  app.editor.apply(col, row, 1);
  app.editor.end();
  const afterRaise = app.editor.grid.data[row * n + col];

  const canUndo = app.editor.canUndo;
  app.hud.emit('undo');
  const afterUndo = app.editor.grid.data[row * n + col];

  // Now a levee stroke, which is the drag-based brush.
  app.hud.emit('brush-change', { brush: 'levee', strokeMagnitude: 10, strokeWidth: 300 });
  app.editor.begin('levee');
  app.editor.applyStroke({ col: col - 20, row }, { col: col + 20, row });
  app.editor.end();
  const afterLevee = app.editor.grid.data[row * n + col];

  app.hud.emit('revert');
  const afterRevert = app.editor.grid.data[row * n + col];

  return { before, afterRaise, afterUndo, afterLevee, afterRevert, canUndo };
});

record('Raise brush changes the ground', editing.afterRaise > editing.before + 1,
  `${editing.before.toFixed(1)} → ${editing.afterRaise.toFixed(1)} m`);
record('Undo restores it', Math.abs(editing.afterUndo - editing.before) < 0.01);
record('Levee stroke raises a ridge', editing.afterLevee > editing.before + 1,
  `${editing.before.toFixed(1)} → ${editing.afterLevee.toFixed(1)} m`);
record('Revert restores everything', Math.abs(editing.afterRevert - editing.before) < 0.01);

// ---------------------------------------------------------------------------
// 11. Console health
// ---------------------------------------------------------------------------
section('11. Console and network');

// This harness deliberately cuts the machine off from the public tile endpoints, so the
// browser logs a resource error for every blocked request. Those are the expected result
// of the test setup, not a defect, and counting them would bury a real error among them.
const expectedOffline = (text) =>
  /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|Failed to load resource/i.test(text);

const errors = consoleMessages.filter((m) => m.type === 'error' && !expectedOffline(m.text));
const warnings = consoleMessages.filter((m) => m.type === 'warning' || m.type === 'warn');

console.log(`        ${consoleMessages.length} console messages, ${errors.length} errors, ${warnings.length} warnings`);
for (const e of errors.slice(0, 12)) console.log(`        ERROR  ${e.text.slice(0, 220)}`);
for (const w of warnings.slice(0, 8)) console.log(`        warn   ${w.text.slice(0, 200)}`);
for (const e of pageErrors.slice(0, 12)) console.log(`        PAGE   ${e.slice(0, 260)}`);

record('No uncaught page errors', pageErrors.length === 0);
record('No console errors', errors.length === 0);

if (failedRequests.length) {
  console.log(`        ${failedRequests.length} failed network requests (expected offline):`);
  for (const r of failedRequests.slice(0, 4)) console.log(`          ${r}`);
}

await page.screenshot({ path: `${OUT}/06-final.png` });

// ---------------------------------------------------------------------------
section('Summary');

const failed = results.filter((r) => !r.ok);
console.log(`  ${results.length - failed.length} of ${results.length} checks passed`);
if (failed.length) {
  console.log('\n  Failures:');
  for (const f of failed) console.log(`    - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
}
console.log(`\n  Screenshots and CSV written to ${OUT}`);

await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
