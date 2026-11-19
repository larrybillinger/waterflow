/* Deterministic mass and positivity checks for the experimental solver. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const frames = [];
const sandbox = {
  self: {postMessage: message => frames.push(message)},
  clearTimeout: () => {},
  setTimeout: () => 1,
  performance: {now: () => 0},
  Math, Float32Array, Float64Array, Number
};
const code = fs.readFileSync(path.join(__dirname, '../web/simulation-worker.js'), 'utf8');
vm.runInNewContext(code, sandbox, {filename: 'simulation-worker.js'});
const send = data => sandbox.self.onmessage({data});
const last = () => frames[frames.length - 1];

const width = 40, height = 40, size = width * height, dx = 20;
const ground = new Float32Array(size);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) ground[y * width + x] = 120 - x * 0.2;
}
send({type: 'init', width, height, cellSize: dx, elevation: ground.buffer});
assert.equal(last().time, 0, 'initial state starts at zero');
send({type: 'start'});
assert.equal(last().stored, 0, 'a dry simulation without a source remains dry');
send({type: 'pause'});

send({type: 'init', width, height, cellSize: dx, elevation: ground.buffer});
const center = 20 * width + 15;
send({type: 'config', index: center, discharge: 1200, duration: 120});
send({type: 'start'});
const frame = last();
const h = new Float32Array(frame.depth), peak = new Float32Array(frame.peak);
assert(frame.time > 0, 'simulation time advances');
assert(frame.added > 0, 'injected volume positive');
assert(frame.wetArea > 0, 'water inundates grid cells');
let sum = 0;
for (let i = 0; i < size; i++) {
  assert(Number.isFinite(h[i]), 'depth finite');
  assert(h[i] >= 0, 'depth nonnegative');
  assert(peak[i] >= h[i], 'peak covers live depth');
  sum += h[i] * dx * dx;
}
assert(Math.abs(sum - frame.stored) < 0.5, 'reported storage agrees with depths');
assert(Math.abs(frame.stored + frame.exported - frame.added) < 1,
  'injected volume equals stored plus exited volume');
send({type: 'pause'});
send({type: 'init', width, height, cellSize: dx, elevation: ground.buffer});
assert.equal(last().stored, 0, 'reset clears stored water');
assert.equal(last().time, 0, 'reset clears time');
console.log('Hydraulic worker positivity and mass-balance tests passed');
