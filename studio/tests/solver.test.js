/**
 * Solver tests.
 *
 * These are the tests that matter most, because a flood model that is quietly wrong still
 * produces a plausible-looking picture. Risk R-007 in planning/risks.md is exactly that:
 * mass conservation error accumulating silently. So it gets asserted here rather than
 * hoped for.
 *
 * The scheme under test is the CPU reference in tests/support/cpuSolver.js, which is a
 * direct transcription of the two shaders. It tests the equations, not the GPU.
 */

import { describe, it, expect } from 'vitest';

import { CpuFloodSolver, createBasin, createSlope } from './support/cpuSolver.js';
import { GRAVITY, physics } from '../src/config.js';

describe('local inertial solver: mass conservation', () => {
  it('conserves water in a closed basin', () => {
    const size = 32;
    const cellSize = 20;
    const bed = createBasin(size, 200);

    const solver = new CpuFloodSolver({ bed, size, cellSize, boundaryOpen: false });

    // A column of water in one corner of the basin, which will slosh outward and
    // eventually level off. Nothing can leave.
    const depth = new Float32Array(size * size);
    for (let row = 4; row < 12; row += 1) {
      for (let col = 4; col < 12; col += 1) {
        depth[row * size + col] = 8;
      }
    }
    solver.setDepth(depth);

    const initialVolume = solver.volume();
    expect(initialVolume).toBeGreaterThan(0);

    solver.run(600);

    const finalVolume = solver.volume();
    const errorPercent = ((finalVolume - initialVolume) / initialVolume) * 100;

    // Acceptance criterion AC-21 asks for under 2 percent. The scheme should do far
    // better than that on a closed basin, where the only losses are the positivity
    // clamp at drying fronts.
    expect(Math.abs(errorPercent)).toBeLessThan(0.5);
  });

  it('never produces a negative depth', () => {
    const size = 24;
    const bed = createSlope(size, 25, 0.02);
    const solver = new CpuFloodSolver({ bed, size, cellSize: 25, boundaryOpen: false });

    const depth = new Float32Array(size * size);
    // A thin sheet, which is the condition that provokes over-draining.
    for (let i = 0; i < depth.length; i += 1) depth[i] = 0.05;
    solver.setDepth(depth);

    solver.run(300);

    for (let i = 0; i < solver.depth.length; i += 1) {
      expect(solver.depth[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('loses water through an open boundary and only through it', () => {
    const size = 24;
    const cellSize = 25;
    const bed = createSlope(size, cellSize, 0.01);

    const closed = new CpuFloodSolver({ bed, size, cellSize, boundaryOpen: false });
    const open = new CpuFloodSolver({ bed, size, cellSize, boundaryOpen: true });

    const depth = new Float32Array(size * size);
    for (let i = 0; i < depth.length; i += 1) depth[i] = 2;

    closed.setDepth(depth);
    open.setDepth(depth);

    closed.run(400);
    open.run(400);

    expect(open.volume()).toBeLessThan(closed.volume());
    // The closed case must hold what it started with.
    expect(Math.abs(closed.volume() / (2 * size * size * cellSize * cellSize) - 1)).toBeLessThan(
      0.01,
    );
  });
});

describe('local inertial solver: physical behaviour', () => {
  it('moves water downhill, not uphill', () => {
    const size = 40;
    const cellSize = 25;
    // Slopes down toward increasing row.
    const bed = createSlope(size, cellSize, 0.03);

    const solver = new CpuFloodSolver({ bed, size, cellSize, boundaryOpen: false });

    const depth = new Float32Array(size * size);
    // Release at the top of the slope.
    for (let row = 2; row < 6; row += 1) {
      for (let col = 16; col < 24; col += 1) {
        depth[row * size + col] = 6;
      }
    }
    solver.setDepth(depth);

    solver.run(400);

    // Centre of mass should have moved to a higher row, which is downhill.
    let weightedRow = 0;
    let total = 0;
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const h = solver.depth[row * size + col];
        weightedRow += h * row;
        total += h;
      }
    }
    const centreRow = weightedRow / total;

    expect(centreRow).toBeGreaterThan(5);

    // And nothing should have climbed to the top rows against gravity.
    let topRowWater = 0;
    for (let col = 0; col < size; col += 1) topRowWater += solver.depth[col];
    expect(topRowWater).toBeLessThan(0.5);
  });

  it('settles to a level water surface in a closed basin', () => {
    const size = 24;
    const cellSize = 20;
    const bed = createBasin(size, 200);

    // Give the basin floor some relief so levelling is a real test rather than trivial.
    for (let row = 1; row < size - 1; row += 1) {
      for (let col = 1; col < size - 1; col += 1) {
        bed[row * size + col] = Math.sin(col * 0.4) * 1.5 + Math.cos(row * 0.3) * 1.5;
      }
    }

    const solver = new CpuFloodSolver({ bed, size, cellSize, boundaryOpen: false });

    const depth = new Float32Array(size * size);
    for (let row = 1; row < size - 1; row += 1) {
      for (let col = 1; col < size - 1; col += 1) {
        // Start well above the relief so every interior cell is wet.
        depth[row * size + col] = 20 - bed[row * size + col];
      }
    }
    solver.setDepth(depth);

    solver.run(1200);

    const surface = solver.waterSurface();
    let min = Infinity;
    let max = -Infinity;
    for (let row = 1; row < size - 1; row += 1) {
      for (let col = 1; col < size - 1; col += 1) {
        const value = surface[row * size + col];
        if (Number.isNaN(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }

    // A still pool is level. Allow a few centimetres of residual sloshing.
    expect(max - min).toBeLessThan(0.25);
  });

  it('does not exceed the Froude limit at any face', () => {
    const size = 32;
    const cellSize = 20;
    // A steep slope, which is what drives the near-field supercritical flow the limiter
    // exists to tame.
    const bed = createSlope(size, cellSize, 0.12);

    const solver = new CpuFloodSolver({ bed, size, cellSize, boundaryOpen: true });

    const depth = new Float32Array(size * size);
    for (let row = 1; row < 5; row += 1) {
      for (let col = 1; col < size - 1; col += 1) {
        depth[row * size + col] = 12;
      }
    }
    solver.setDepth(depth);

    solver.run(120);

    // Reconstruct the Froude number at each wet face and check the cap held.
    let worstFroude = 0;
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size - 1; col += 1) {
        const i = row * size + col;
        const j = i + 1;
        const hflow =
          Math.max(solver.bed[i] + solver.depth[i], solver.bed[j] + solver.depth[j]) -
          Math.max(solver.bed[i], solver.bed[j]);
        if (hflow <= physics.dryDepth) continue;
        const velocity = Math.abs(solver.qx[i]) / hflow;
        const froude = velocity / Math.sqrt(GRAVITY * hflow);
        if (froude > worstFroude) worstFroude = froude;
      }
    }

    // A small tolerance, because the limiter is applied before the positivity clamp and
    // the depth then changes within the same step.
    expect(worstFroude).toBeLessThan(physics.froudeMax + 0.05);
  });

  it('keeps water behind a barrier that is taller than the water surface', () => {
    const size = 32;
    const cellSize = 20;
    const bed = new Float32Array(size * size);

    // A wall across the middle, 10 m high, with a flat floor either side.
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        bed[row * size + col] = row >= 15 && row <= 17 ? 10 : 0;
      }
    }

    const solver = new CpuFloodSolver({ bed, size, cellSize, boundaryOpen: false });

    const depth = new Float32Array(size * size);
    // Pool to 6 m upstream of the wall, which is well below the crest.
    for (let row = 1; row < 15; row += 1) {
      for (let col = 0; col < size; col += 1) {
        depth[row * size + col] = 6;
      }
    }
    solver.setDepth(depth);

    solver.run(900);

    // Downstream of the wall should still be dry.
    let downstreamWater = 0;
    for (let row = 18; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        downstreamWater += solver.depth[row * size + col];
      }
    }

    expect(downstreamWater * cellSize * cellSize).toBeLessThan(1);
  });

  it('releases water downstream once the barrier is notched', () => {
    const size = 32;
    const cellSize = 20;

    const makeBed = (notch) => {
      const bed = new Float32Array(size * size);
      for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
          let z = row >= 15 && row <= 17 ? 10 : 0;
          // Cut the notch down to the floor over a few columns, which is what the
          // breach geometry does to the real terrain.
          if (notch && row >= 15 && row <= 17 && col >= 14 && col <= 18) z = 0;
          bed[row * size + col] = z;
        }
      }
      return bed;
    };

    const solver = new CpuFloodSolver({
      bed: makeBed(true),
      size,
      cellSize,
      boundaryOpen: false,
    });

    const depth = new Float32Array(size * size);
    for (let row = 1; row < 15; row += 1) {
      for (let col = 0; col < size; col += 1) {
        depth[row * size + col] = 6;
      }
    }
    solver.setDepth(depth);

    const initialVolume = solver.volume();
    solver.run(900);

    let downstreamVolume = 0;
    for (let row = 18; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        downstreamVolume += solver.depth[row * size + col];
      }
    }
    downstreamVolume *= cellSize * cellSize;

    // Water got through, and the total is still conserved.
    expect(downstreamVolume).toBeGreaterThan(initialVolume * 0.05);
    expect(Math.abs(solver.volume() - initialVolume) / initialVolume).toBeLessThan(0.02);
  });
});

describe('timestep', () => {
  it('satisfies the CFL condition for the depth present', () => {
    const size = 16;
    const cellSize = 30;
    const bed = createBasin(size, 100);
    const solver = new CpuFloodSolver({ bed, size, cellSize, boundaryOpen: false });

    const depth = new Float32Array(size * size);
    for (let row = 1; row < size - 1; row += 1) {
      for (let col = 1; col < size - 1; col += 1) depth[row * size + col] = 9;
    }
    solver.setDepth(depth);

    const dt = solver.timestep();
    const limit = (physics.cflAlpha * cellSize) / Math.sqrt(GRAVITY * 9);

    expect(dt).toBeCloseTo(limit, 6);
    expect(dt).toBeGreaterThanOrEqual(physics.dtMin);
    expect(dt).toBeLessThanOrEqual(physics.dtMax);
  });

  it('shrinks as the water deepens', () => {
    const size = 8;
    const bed = createBasin(size, 500);
    const solver = new CpuFloodSolver({ bed, size, cellSize: 30, boundaryOpen: false });

    const shallow = new Float32Array(size * size).fill(1);
    solver.setDepth(shallow);
    const dtShallow = solver.timestep();

    const deep = new Float32Array(size * size).fill(50);
    solver.setDepth(deep);
    const dtDeep = solver.timestep();

    expect(dtDeep).toBeLessThan(dtShallow);
  });
});
