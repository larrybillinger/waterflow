import { describe, it, expect } from 'vitest';

import {
  fillPool,
  storageCurve,
  snapToLocalMinimum,
  poolToDepthField,
  toAcreFeet,
  toAcres,
} from '../src/sim/reservoir.js';
import { createGrid } from '../src/util/grid.js';

/** A flat basin at elevation 0 ringed by walls, which is the simplest exact case. */
function flatBasin(size, wall = 50) {
  const grid = createGrid(size, size, 0);
  for (let i = 0; i < size; i += 1) {
    grid.data[i] = wall;
    grid.data[(size - 1) * size + i] = wall;
    grid.data[i * size] = wall;
    grid.data[i * size + size - 1] = wall;
  }
  return grid;
}

describe('fillPool', () => {
  it('computes volume and area exactly on a flat basin', () => {
    const size = 12;
    const cellSize = 10;
    const grid = flatBasin(size, 50);

    const pool = fillPool(grid, 6, 6, 5, cellSize);

    // The interior is 10 x 10 cells, each 10 x 10 m, flooded to 5 m.
    const interiorCells = (size - 2) * (size - 2);
    expect(pool.cellCount).toBe(interiorCells);
    expect(pool.area).toBeCloseTo(interiorCells * cellSize * cellSize, 6);
    expect(pool.volume).toBeCloseTo(interiorCells * cellSize * cellSize * 5, 6);
    expect(pool.maxDepth).toBeCloseTo(5, 6);
  });

  it('accounts for a sloping bed in the volume', () => {
    const size = 10;
    const cellSize = 10;
    const grid = createGrid(size, size, 0);
    // Bed rises by 1 m per row.
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) grid.data[row * size + col] = row;
    }

    const surface = 4.5;
    const pool = fillPool(grid, 0, 0, surface, cellSize);

    // Rows 0 to 4 are below 4.5, with depths 4.5, 3.5, 2.5, 1.5, 0.5.
    const expectedDepthSum = (4.5 + 3.5 + 2.5 + 1.5 + 0.5) * size;
    expect(pool.cellCount).toBe(5 * size);
    expect(pool.volume).toBeCloseTo(expectedDepthSum * cellSize * cellSize, 4);
  });

  it('does not leak over a ridge into an unconnected valley', () => {
    const size = 11;
    const cellSize = 10;
    const grid = createGrid(size, size, 0);

    // A ridge at 20 m down the middle column, with floors at 0 either side.
    for (let row = 0; row < size; row += 1) grid.data[row * size + 5] = 20;

    const pool = fillPool(grid, 2, 5, 10, cellSize);

    // Only the left half should fill: 5 columns by 11 rows.
    expect(pool.cellCount).toBe(5 * size);

    // And nothing on the far side of the ridge.
    for (let row = 0; row < size; row += 1) {
      for (let col = 6; col < size; col += 1) {
        expect(pool.mask[row * size + col]).toBe(0);
      }
    }
  });

  it('does not pass diagonally through a one-cell-thick barrier', () => {
    // Four-neighbour connectivity exists precisely to prevent this. A diagonal leak
    // through a thin dam is the classic bug in this kind of flood fill.
    const size = 7;
    const grid = createGrid(size, size, 0);

    // A diagonal wall from top-left to bottom-right.
    for (let i = 0; i < size; i += 1) grid.data[i * size + i] = 100;

    const pool = fillPool(grid, 1, 3, 10, 10);

    // Starting below the diagonal, the fill must not reach above it.
    expect(pool.mask[3 * size + 5]).toBe(0);
  });

  it('returns an empty pool when the seed is above the water surface', () => {
    const grid = createGrid(5, 5, 100);
    const pool = fillPool(grid, 2, 2, 50, 10);
    expect(pool.cellCount).toBe(0);
    expect(pool.volume).toBe(0);
  });

  it('returns an empty pool for a seed outside the grid', () => {
    const grid = createGrid(5, 5, 0);
    expect(fillPool(grid, -1, 2, 10, 10).cellCount).toBe(0);
    expect(fillPool(grid, 99, 2, 10, 10).cellCount).toBe(0);
  });

  it('reports when the pool reaches the domain edge', () => {
    const open = createGrid(8, 8, 0);
    expect(fillPool(open, 4, 4, 5, 10).touchesEdge).toBe(true);

    const walled = flatBasin(8, 50);
    expect(fillPool(walled, 4, 4, 5, 10).touchesEdge).toBe(false);
  });

  it('grows monotonically with the water surface elevation', () => {
    const grid = createGrid(16, 16, 0);
    for (let row = 0; row < 16; row += 1) {
      for (let col = 0; col < 16; col += 1) {
        grid.data[row * 16 + col] = Math.hypot(row - 8, col - 8);
      }
    }

    let previousVolume = -1;
    for (const surface of [1, 2, 4, 6, 8]) {
      const pool = fillPool(grid, 8, 8, surface, 10);
      expect(pool.volume).toBeGreaterThan(previousVolume);
      previousVolume = pool.volume;
    }
  });
});

describe('storageCurve', () => {
  it('rises monotonically in both area and volume', () => {
    const grid = createGrid(20, 20, 0);
    for (let row = 0; row < 20; row += 1) {
      for (let col = 0; col < 20; col += 1) {
        grid.data[row * 20 + col] = Math.hypot(row - 10, col - 10) * 0.8;
      }
    }

    const curve = storageCurve(grid, 10, 10, {
      cellSize: 15,
      minElevation: 0,
      maxElevation: 8,
      samples: 16,
    });

    expect(curve.length).toBe(17);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i].elevation).toBeGreaterThan(curve[i - 1].elevation);
      expect(curve[i].area).toBeGreaterThanOrEqual(curve[i - 1].area);
      expect(curve[i].volume).toBeGreaterThanOrEqual(curve[i - 1].volume);
    }
  });
});

describe('snapToLocalMinimum', () => {
  it('finds the lowest cell nearby', () => {
    const grid = createGrid(11, 11, 100);
    grid.data[6 * 11 + 7] = 3;

    const snapped = snapToLocalMinimum(grid, 5, 5, 4);
    expect(snapped.col).toBe(7);
    expect(snapped.row).toBe(6);
    expect(snapped.elevation).toBe(3);
  });

  it('stays inside the grid near an edge', () => {
    const grid = createGrid(6, 6, 10);
    const snapped = snapToLocalMinimum(grid, 0, 0, 5);
    expect(snapped.col).toBeGreaterThanOrEqual(0);
    expect(snapped.row).toBeGreaterThanOrEqual(0);
    expect(snapped.col).toBeLessThan(6);
  });
});

describe('poolToDepthField', () => {
  it('writes depths inside the pool and zero outside', () => {
    const size = 9;
    const grid = createGrid(size, size, 0);
    for (let row = 0; row < size; row += 1) grid.data[row * size + 4] = 50;

    const pool = fillPool(grid, 1, 4, 10, 10);
    const depth = poolToDepthField(grid, pool);

    expect(depth[4 * size + 1]).toBeCloseTo(10, 6);
    // Beyond the ridge.
    expect(depth[4 * size + 7]).toBe(0);
    // On the ridge itself.
    expect(depth[4 * size + 4]).toBe(0);
  });

  it('matches the pool volume when summed', () => {
    const grid = createGrid(12, 12, 0);
    for (let row = 0; row < 12; row += 1) {
      for (let col = 0; col < 12; col += 1) grid.data[row * 12 + col] = row * 0.5;
    }

    const cellSize = 20;
    const pool = fillPool(grid, 0, 0, 3, cellSize);
    const depth = poolToDepthField(grid, pool);

    let sum = 0;
    for (const value of depth) sum += value;
    expect(sum * cellSize * cellSize).toBeCloseTo(pool.volume, 3);
  });
});

describe('unit conversions', () => {
  it('converts cubic metres to acre-feet with the exact factor', () => {
    expect(toAcreFeet(1233.48183754752)).toBeCloseTo(1, 9);
    expect(toAcreFeet(1e6)).toBeCloseTo(810.713, 2);
  });

  it('converts square metres to acres with the exact factor', () => {
    expect(toAcres(4046.8564224)).toBeCloseTo(1, 9);
    expect(toAcres(1e6)).toBeCloseTo(247.105, 2);
  });
});
