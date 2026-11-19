/* Experimental local-inertial 2D storage-cell model. No hydrograph calibration. */
'use strict';
const G = 9.81;
const MANNING = 0.045;
let width = 0, height = 0, n = 0, dx = 1;
let z, depth, peak, arrival, east, south, eastNext, southNext, limit;
let time = 0, totalAdded = 0, exported = 0, peakGlobal = 0;
let source = -1, discharge = 1500, duration = 1800;
let running = false, timer = null;
function initialize(message) {
  running = false;
  clearTimeout(timer);
  width = message.width; height = message.height; n = width * height; dx = message.cellSize;
  z = new Float32Array(message.elevation);
  depth = new Float32Array(n); peak = new Float32Array(n); arrival = new Float32Array(n);
  arrival.fill(-1);
  east = new Float64Array(n); south = new Float64Array(n);
  eastNext = new Float64Array(n); southNext = new Float64Array(n);
  limit = new Float64Array(n);
  time = 0; totalAdded = 0; exported = 0; peakGlobal = 0;
  source = -1;
  publish();
}
function setSource(message) {
  source = message.index;
  discharge = message.discharge;
  duration = message.duration;
}
function step() {
  let maxH = 0;
  for (let i = 0; i < n; i++) if (depth[i] > maxH) maxH = depth[i];
  const dt = Math.min(2, 0.35 * dx / Math.sqrt(G * Math.max(maxH, 0.05)));
  const area = dx * dx;
  // A square, distributed 3x3 inlet avoids a pathological single-cell jet.
  if (source >= 0 && source < n && time < duration) {
    const sx = source % width, sy = Math.floor(source / width);
    let count = 0;
    for (let ry = -1; ry <= 1; ry++) for (let rx = -1; rx <= 1; rx++)
      if (sx + rx >= 0 && sx + rx < width && sy + ry >= 0 && sy + ry < height) count++;
    const added = discharge * Math.min(dt, duration - time);
    for (let ry = -1; ry <= 1; ry++) for (let rx = -1; rx <= 1; rx++) {
      const x = sx + rx, y = sy + ry;
      if (x >= 0 && x < width && y >= 0 && y < height) depth[y * width + x] += added / count / area;
    }
    totalAdded += added;
  }

  eastNext.fill(0); southNext.fill(0); limit.fill(1);
  // Face velocities use pressure gradients and friction, following a reduced
  // Bates et al. (2010) local-inertial storage-cell update.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, surface = z[i] + depth[i];
    if (x < width - 1) {
      const j = i + 1;
      const hFace = Math.max(0, Math.max(surface, z[j] + depth[j]) - Math.max(z[i], z[j]));
      if (hFace > 0.002) {
        const gradient = (z[j] + depth[j] - surface) / dx;
        const resistance = 1 + G * MANNING * MANNING * dt * Math.abs(east[i]) / Math.pow(hFace, 7 / 3);
        eastNext[i] = (east[i] - G * hFace * dt * gradient) / resistance;
      }
    }
    if (y < height - 1) {
      const j = i + width;
      const hFace = Math.max(0, Math.max(surface, z[j] + depth[j]) - Math.max(z[i], z[j]));
      if (hFace > 0.002) {
        const gradient = (z[j] + depth[j] - surface) / dx;
        const resistance = 1 + G * MANNING * MANNING * dt * Math.abs(south[i]) / Math.pow(hFace, 7 / 3);
        southNext[i] = (south[i] - G * hFace * dt * gradient) / resistance;
      }
    }
  }
  // For each cell, cap its total outward flux at its available storage.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    let outward = 0;
    if (x < width - 1) outward += Math.max(0, eastNext[i]);
    if (x > 0) outward += Math.max(0, -eastNext[i - 1]);
    if (y < height - 1) outward += Math.max(0, southNext[i]);
    if (y > 0) outward += Math.max(0, -southNext[i - width]);
    if (outward > 0) limit[i] = Math.min(1, depth[i] * dx / (outward * dt));
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x < width - 1) {
      const j = i + 1;
      const q = eastNext[i] * (eastNext[i] >= 0 ? limit[i] : limit[j]);
      const dh = q * dt / dx;
      depth[i] -= dh; depth[j] += dh;
      eastNext[i] = q;
    }
    if (y < height - 1) {
      const j = i + width;
      const q = southNext[i] * (southNext[i] >= 0 ? limit[i] : limit[j]);
      const dh = q * dt / dx;
      depth[i] -= dh; depth[j] += dh;
      southNext[i] = q;
    }
  }
  // Simplified free-flow outflow at the four edges (not an engineering boundary).
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
    const i = y * width + x;
    const edgeCount = (x === 0 ? 1 : 0) + (x === width - 1 ? 1 : 0) +
      (y === 0 ? 1 : 0) + (y === height - 1 ? 1 : 0);
    const outDepth = Math.min(depth[i], edgeCount * 0.25 * Math.sqrt(G * Math.max(0, depth[i])) * depth[i] * dt / dx);
    depth[i] -= outDepth;
    exported += outDepth * area;
  }
  // Reuse face buffers; avoid allocating megabytes every simulation tick.
  const previousEast = east, previousSouth = south;
  east = eastNext; south = southNext;
  eastNext = previousEast; southNext = previousSouth;
  time += dt;
  for (let i = 0; i < n; i++) {
    if (depth[i] < 0) depth[i] = 0; // Guard against roundoff only; limiter avoids overdraw.
    if (depth[i] > peak[i]) {
      peak[i] = depth[i];
      if (depth[i] > peakGlobal) peakGlobal = depth[i];
    }
    if (arrival[i] < 0 && depth[i] >= 0.1) arrival[i] = time;
  }
}
function publish() {
  let wet = 0, stored = 0;
  for (let i = 0; i < n; i++) {
    stored += depth[i] * dx * dx;
    if (depth[i] >= 0.1) wet++;
  }
  const h = depth.slice(), p = peak.slice(), a = arrival.slice();
  self.postMessage({
    type: 'frame', time, wetArea: wet * dx * dx, maxDepth: peakGlobal,
    added: totalAdded, exported, stored, depth: h.buffer, peak: p.buffer, arrival: a.buffer
  }, [h.buffer, p.buffer, a.buffer]);
}
function tick() {
  if (!running) return;
  const started = performance.now();
  for (let k = 0; k < 9; k++) {
    step();
    if (time >= 21600 || performance.now() - started > 60) break;
  }
  publish();
  if (time >= 21600) {
    running = false;
    self.postMessage({type: 'stopped'});
  } else timer = setTimeout(tick, 60);
}
self.onmessage = event => {
  const m = event.data;
  if (m.type === 'init') initialize(m);
  else if (m.type === 'config') setSource(m);
  else if (m.type === 'start' && depth && !running) { running = true; tick(); }
  else if (m.type === 'pause') { running = false; clearTimeout(timer); }
};
