/**
 * Drifter tests: the raft that follows the water.
 *
 * The samplers here are analytic velocity fields rather than the solver, so these tests
 * check the advection and the state machine, not the hydraulics. That separation is the
 * point: if the raft goes somewhere strange, these tests say whether the fault is in the
 * tracer or in the flow field it was given.
 */

import { describe, it, expect } from 'vitest';

import Drifter, { advanceDrifter, DRIFTER_STATE } from '../src/sim/Drifter.js';

const CELL = 25;
const GRID = 256;

/** A uniform flow of the given velocity, everywhere deep enough to float. */
function uniformFlow(vx, vy, depth = 5) {
  return () => ({ depth, vx, vy, bed: 100 });
}

/**
 * Flow that curves: velocity rotates with position, which is what distinguishes a
 * second-order integrator from a first-order one.
 */
function circularFlow(speed, centreCol, centreRow) {
  return (col, row) => {
    const dx = col - centreCol;
    const dy = row - centreRow;
    const radius = Math.hypot(dx, dy);
    if (radius < 1e-6) return { depth: 5, vx: 0, vy: 0, bed: 100 };
    // Tangential, anticlockwise in grid space.
    return {
      depth: 5,
      vx: (-dy / radius) * speed,
      vy: (dx / radius) * speed,
      bed: 100,
    };
  };
}

describe('Drifter advection', () => {
  it('starts waiting and only launches once there is water', () => {
    const drifter = new Drifter({ col: 50, row: 50 });
    expect(drifter.state).toBe(DRIFTER_STATE.waiting);

    const dry = () => ({ depth: 0.01, vx: 2, vy: 0, bed: 100 });
    advanceDrifter(drifter, {
      sample: dry,
      totalDt: 10,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 0,
    });

    expect(drifter.state).toBe(DRIFTER_STATE.waiting);
    expect(drifter.col).toBeCloseTo(50, 9);

    advanceDrifter(drifter, {
      sample: uniformFlow(2, 0),
      totalDt: 10,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 10,
    });

    expect(drifter.state).toBe(DRIFTER_STATE.floating);
    expect(drifter.col).toBeGreaterThan(50);
  });

  it('travels at the speed of the water it is in', () => {
    const drifter = new Drifter({ col: 50, row: 50 });
    const speed = 3;

    // Prime it so it is floating.
    advanceDrifter(drifter, {
      sample: uniformFlow(speed, 0),
      totalDt: 1,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 0,
    });

    const startCol = drifter.col;
    const seconds = 100;

    advanceDrifter(drifter, {
      sample: uniformFlow(speed, 0),
      totalDt: seconds,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 1,
    });

    const travelledMetres = (drifter.col - startCol) * CELL;
    expect(travelledMetres).toBeCloseTo(speed * seconds, 0);
    expect(drifter.speed).toBeCloseTo(speed, 3);
  });

  it('is not slowed down by a long frame, which the per-step cap would otherwise do', () => {
    // This is the bug advanceDrifter exists to prevent: one big step hits the
    // half-cell movement cap and the raft crawls.
    const speed = 8;

    const chunked = new Drifter({ col: 50, row: 50 });
    advanceDrifter(chunked, {
      sample: uniformFlow(speed, 0),
      totalDt: 1,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 0,
    });
    const chunkedStart = chunked.col;
    advanceDrifter(chunked, {
      sample: uniformFlow(speed, 0),
      totalDt: 60,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 1,
    });

    const single = new Drifter({ col: 50, row: 50 });
    single.step({
      sample: uniformFlow(speed, 0),
      dt: 1,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 0,
    });
    const singleStart = single.col;
    single.step({
      sample: uniformFlow(speed, 0),
      dt: 60,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 1,
    });

    const chunkedMetres = (chunked.col - chunkedStart) * CELL;
    const singleMetres = (single.col - singleStart) * CELL;

    expect(chunkedMetres).toBeCloseTo(speed * 60, -1);
    // The single big step is capped and falls well short.
    expect(singleMetres).toBeLessThan(chunkedMetres * 0.6);
  });

  it('follows a curving flow without cutting the corner badly', () => {
    // Second-order integration should keep a tracer close to its streamline. A circular
    // flow has a known streamline: a circle of constant radius.
    const centreCol = 128;
    const centreRow = 128;
    const startRadius = 30;

    const drifter = new Drifter({ col: centreCol + startRadius, row: centreRow });
    const sample = circularFlow(4, centreCol, centreRow);

    advanceDrifter(drifter, {
      sample,
      totalDt: 1,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 0,
    });

    for (let i = 0; i < 60; i += 1) {
      advanceDrifter(drifter, {
        sample,
        totalDt: 5,
        cellSize: CELL,
        gridSize: GRID,
        simulationTime: 1 + i * 5,
        maxChunks: 64,
      });
    }

    const radius = Math.hypot(drifter.col - centreCol, drifter.row - centreRow);
    // Some drift inward is inevitable with any explicit scheme; a first-order one would
    // spiral in far faster than this.
    expect(radius).toBeGreaterThan(startRadius * 0.85);
    expect(radius).toBeLessThan(startRadius * 1.15);
  });

  it('grounds out when the water runs out from under it', () => {
    const drifter = new Drifter({ col: 50, row: 50 });

    advanceDrifter(drifter, {
      sample: uniformFlow(2, 0),
      totalDt: 20,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 0,
    });
    expect(drifter.state).toBe(DRIFTER_STATE.floating);

    advanceDrifter(drifter, {
      sample: () => ({ depth: 0.01, vx: 2, vy: 0, bed: 100 }),
      totalDt: 20,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 20,
    });

    expect(drifter.state).toBe(DRIFTER_STATE.stranded);
    // The water went dry at the start of the second frame, so grounding is recorded
    // somewhere inside it, to the resolution of one integration chunk.
    expect(drifter.endedAt).toBeGreaterThanOrEqual(20);
    expect(drifter.endedAt).toBeLessThanOrEqual(40);
    expect(drifter.active).toBe(false);
  });

  it('stops being integrated once it has grounded', () => {
    const drifter = new Drifter({ col: 50, row: 50 });
    drifter.state = DRIFTER_STATE.stranded;
    const before = drifter.col;

    advanceDrifter(drifter, {
      sample: uniformFlow(5, 0),
      totalDt: 100,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 0,
    });

    expect(drifter.col).toBe(before);
  });

  it('reports leaving the domain', () => {
    const drifter = new Drifter({ col: GRID - 6, row: 50 });

    for (let i = 0; i < 40 && drifter.active; i += 1) {
      advanceDrifter(drifter, {
        sample: uniformFlow(6, 0),
        totalDt: 10,
        cellSize: CELL,
        gridSize: GRID,
        simulationTime: i * 10,
      });
    }

    expect(drifter.state).toBe(DRIFTER_STATE.leftDomain);
    expect(drifter.describeState()).toMatch(/out of the area/);
  });

  it('records heading as a compass bearing', () => {
    const cases = [
      // Flowing north means decreasing row, bearing 0.
      { vx: 0, vy: -3, expected: 0 },
      { vx: 3, vy: 0, expected: Math.PI / 2 },
      { vx: 0, vy: 3, expected: Math.PI },
      { vx: -3, vy: 0, expected: -Math.PI / 2 },
    ];

    for (const { vx, vy, expected } of cases) {
      const drifter = new Drifter({ col: 128, row: 128 });
      advanceDrifter(drifter, {
        sample: uniformFlow(vx, vy),
        totalDt: 5,
        cellSize: CELL,
        gridSize: GRID,
        simulationTime: 0,
      });
      expect(drifter.heading).toBeCloseTo(expected, 4);
    }
  });

  it('accumulates distance travelled along the path, not in a straight line', () => {
    const centreCol = 128;
    const centreRow = 128;
    const drifter = new Drifter({ col: centreCol + 30, row: centreRow });
    const sample = circularFlow(4, centreCol, centreRow);

    advanceDrifter(drifter, {
      sample,
      totalDt: 1,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 0,
    });

    for (let i = 0; i < 40; i += 1) {
      advanceDrifter(drifter, {
        sample,
        totalDt: 5,
        cellSize: CELL,
        gridSize: GRID,
        simulationTime: 1 + i * 5,
        maxChunks: 64,
      });
    }

    const straightLine =
      Math.hypot(drifter.col - (centreCol + 30), drifter.row - centreRow) * CELL;

    // Going round a circle, the path is much longer than the straight line back.
    expect(drifter.distanceTravelled).toBeGreaterThan(straightLine);
    // And roughly consistent with speed times time.
    expect(drifter.distanceTravelled).toBeGreaterThan(4 * 200 * 0.7);
  });

  it('leaves a trail that stays within its cap', () => {
    const drifter = new Drifter({ col: 10, row: 10 });
    drifter.maxTrailPoints = 20;

    for (let i = 0; i < 200; i += 1) {
      advanceDrifter(drifter, {
        sample: uniformFlow(3, 3),
        totalDt: 10,
        cellSize: CELL,
        gridSize: GRID,
        simulationTime: i * 10,
      });
      if (!drifter.active) break;
    }

    expect(drifter.trail.length).toBeGreaterThan(1);
    expect(drifter.trail.length).toBeLessThanOrEqual(20);
  });

  it('resets back to where it started', () => {
    const drifter = new Drifter({ col: 40, row: 60 });

    advanceDrifter(drifter, {
      sample: uniformFlow(4, 2),
      totalDt: 50,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 0,
    });

    expect(drifter.col).not.toBeCloseTo(40, 3);

    drifter.reset();

    expect(drifter.col).toBe(40);
    expect(drifter.row).toBe(60);
    expect(drifter.state).toBe(DRIFTER_STATE.waiting);
    expect(drifter.distanceTravelled).toBe(0);
    expect(drifter.trail.length).toBe(0);
    expect(drifter.launchedAt).toBeNull();
  });

  it('gives each drifter a distinct id and a readable label', () => {
    const a = new Drifter({ col: 1, row: 1, kind: 'raft' });
    const b = new Drifter({ col: 2, row: 2, kind: 'buoy' });

    expect(a.id).not.toBe(b.id);
    expect(a.label).toMatch(/Raft/);
    expect(b.label).toMatch(/Marker/);
  });

  it('does nothing for a non-positive timestep', () => {
    const drifter = new Drifter({ col: 30, row: 30 });
    advanceDrifter(drifter, {
      sample: uniformFlow(5, 0),
      totalDt: 0,
      cellSize: CELL,
      gridSize: GRID,
      simulationTime: 0,
    });
    expect(drifter.col).toBe(30);
  });

  it('describes each of its states in words', () => {
    const drifter = new Drifter({ col: 1, row: 1 });
    const seen = new Set();
    for (const state of Object.values(DRIFTER_STATE)) {
      drifter.state = state;
      const text = drifter.describeState();
      expect(text.length).toBeGreaterThan(0);
      seen.add(text);
    }
    // Every state has its own wording, so the UI never shows two states the same.
    expect(seen.size).toBe(Object.values(DRIFTER_STATE).length);
  });
});
