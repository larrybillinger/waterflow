import { describe, it, expect } from 'vitest';

import {
  priorityFloodFill,
  d8FlowDirections,
  traceDownstream,
  flowAccumulation,
} from '../src/sim/routing.js';
import { createGrid } from '../src/util/grid.js';

/** A plane tilting down toward increasing row, which is south. */
function slope(size, cellSize, gradient, top = 100) {
  const grid = createGrid(size, size);
  for (let row = 0; row < size; row += 1) {
    const z = top - row * cellSize * gradient;
    for (let col = 0; col < size; col += 1) grid.data[row * size + col] = z;
  }
  return grid;
}

describe('priorityFloodFill', () => {
  it('fills an interior pit up to its lowest outlet', () => {
    const size = 11;
    const grid = createGrid(size, size, 10);
    grid.data[5 * size + 5] = 0;

    const filled = priorityFloodFill(grid);

    // The pit must come up to at least the surrounding level.
    expect(filled.data[5 * size + 5]).toBeGreaterThanOrEqual(10);
    // And nothing else should have moved much.
    expect(filled.data[0]).toBeCloseTo(10, 6);
  });

  it('leaves a depression-free surface with no interior minima', () => {
    const size = 24;
    const grid = createGrid(size, size);
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        // A noisy slope with several real pits in it.
        grid.data[row * size + col] =
          100 - row * 1.2 + Math.sin(col * 0.9) * 2.5 + Math.cos(row * 1.3) * 2.5;
      }
    }

    const filled = priorityFloodFill(grid);

    for (let row = 1; row < size - 1; row += 1) {
      for (let col = 1; col < size - 1; col += 1) {
        const z = filled.data[row * size + col];
        let hasLowerOrEqualNeighbour = false;
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]) {
          if (filled.data[(row + dr) * size + (col + dc)] < z) {
            hasLowerOrEqualNeighbour = true;
            break;
          }
        }
        // Every interior cell must have somewhere downhill to send water.
        expect(hasLowerOrEqualNeighbour).toBe(true);
      }
    }
  });

  it('never lowers terrain', () => {
    const size = 16;
    const grid = createGrid(size, size);
    for (let i = 0; i < grid.data.length; i += 1) grid.data[i] = Math.sin(i * 0.7) * 10 + 50;

    const filled = priorityFloodFill(grid);
    for (let i = 0; i < grid.data.length; i += 1) {
      expect(filled.data[i]).toBeGreaterThanOrEqual(grid.data[i] - 1e-6);
    }
  });

  it('leaves an already depression-free slope essentially unchanged', () => {
    const grid = slope(16, 20, 0.05);
    const filled = priorityFloodFill(grid);

    for (let i = 0; i < grid.data.length; i += 1) {
      expect(filled.data[i]).toBeCloseTo(grid.data[i], 3);
    }
  });
});

describe('d8FlowDirections', () => {
  it('sends every cell downslope on a tilted plane', () => {
    const size = 10;
    const cellSize = 20;
    const grid = slope(size, cellSize, 0.05);

    const directions = d8FlowDirections(grid, cellSize);

    for (let row = 0; row < size - 1; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const index = row * size + col;
        const downstream = directions[index];
        expect(downstream).toBeGreaterThanOrEqual(0);
        const downstreamRow = Math.floor(downstream / size);
        // Downhill is toward increasing row.
        expect(downstreamRow).toBe(row + 1);
      }
    }
  });

  it('weights diagonal distance so a diagonal is not unfairly preferred', () => {
    const size = 3;
    const cellSize = 10;
    const grid = createGrid(size, size, 10);

    // Centre cell at 10. The cell due east drops 2 m over 10 m, slope 0.2.
    // The diagonal south-east drops 2.5 m over 14.14 m, slope 0.177.
    // The steeper slope is east, so east must win despite the diagonal dropping further.
    grid.data[1 * size + 2] = 8;
    grid.data[2 * size + 2] = 7.5;

    const directions = d8FlowDirections(grid, cellSize);
    expect(directions[1 * size + 1]).toBe(1 * size + 2);
  });

  it('reports no downstream cell for a pit', () => {
    const size = 5;
    const grid = createGrid(size, size, 10);
    grid.data[2 * size + 2] = 0;

    const directions = d8FlowDirections(grid, 10);
    expect(directions[2 * size + 2]).toBe(-1);
  });
});

describe('traceDownstream', () => {
  it('follows a slope to the domain edge', () => {
    const size = 20;
    const cellSize = 20;
    const grid = slope(size, cellSize, 0.04);

    const result = traceDownstream(grid, cellSize, { col: 10, row: 2 });

    expect(result.path.length).toBeGreaterThan(10);
    expect(result.terminated).toBe('left-domain');

    // Monotonically increasing distance, and monotonically downhill.
    for (let i = 1; i < result.path.length; i += 1) {
      expect(result.path[i].distance).toBeGreaterThan(result.path[i - 1].distance);
      const previous = grid.data[result.path[i - 1].row * size + result.path[i - 1].col];
      const current = grid.data[result.path[i].row * size + result.path[i].col];
      expect(current).toBeLessThanOrEqual(previous + 1e-6);
    }
  });

  it('measures distance along the path, weighting diagonals correctly', () => {
    const size = 10;
    const cellSize = 10;
    const grid = slope(size, cellSize, 0.04);

    const result = traceDownstream(grid, cellSize, { col: 5, row: 0 });

    for (let i = 1; i < result.path.length; i += 1) {
      const step = result.path[i].distance - result.path[i - 1].distance;
      const diagonal =
        result.path[i].col !== result.path[i - 1].col &&
        result.path[i].row !== result.path[i - 1].row;
      expect(step).toBeCloseTo(diagonal ? cellSize * Math.SQRT2 : cellSize, 6);
    }
  });

  it('reaches the edge on a real depression-filled surface', () => {
    const size = 32;
    const cellSize = 25;
    const grid = createGrid(size, size);
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        grid.data[row * size + col] =
          200 - row * 2 + Math.sin(col * 0.6) * 6 + Math.cos(row * 0.8) * 4;
      }
    }

    const raw = traceDownstream(grid, cellSize, { col: 16, row: 1 });
    const filled = traceDownstream(priorityFloodFill(grid), cellSize, { col: 16, row: 1 });

    // Filling is what lets the trace get out of the pits, which is decision D-007.
    expect(filled.path.length).toBeGreaterThanOrEqual(raw.path.length);
    expect(filled.terminated).toBe('left-domain');
  });

  it('refuses a start outside the grid', () => {
    const grid = slope(8, 10, 0.05);
    const result = traceDownstream(grid, 10, { col: -5, row: 2 });
    expect(result.path.length).toBe(0);
    expect(result.terminated).toBe('start-outside-domain');
  });

  it('never revisits a cell', () => {
    const size = 24;
    const grid = createGrid(size, size);
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        grid.data[row * size + col] = 100 - row + Math.sin(col) * 0.5;
      }
    }

    const result = traceDownstream(priorityFloodFill(grid), 20, { col: 12, row: 1 });
    const seen = new Set();
    for (const point of result.path) {
      const key = `${point.col},${point.row}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('flowAccumulation', () => {
  it('starts every cell at one and totals correctly down a slope', () => {
    const size = 8;
    const cellSize = 10;
    const grid = slope(size, cellSize, 0.05);

    const accumulation = flowAccumulation(grid, cellSize);

    // On a uniform plane every cell drains due south, so each column accumulates one
    // cell per row above it.
    expect(accumulation[0]).toBe(1);
    expect(accumulation[1 * size + 0]).toBe(2);
    expect(accumulation[(size - 1) * size + 0]).toBe(size);
  });

  it('concentrates flow in a channel', () => {
    const size = 20;
    const cellSize = 20;
    const grid = createGrid(size, size);

    // A V-shaped valley draining south, with its lowest line at column 10.
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        grid.data[row * size + col] = 100 - row * 2 + Math.abs(col - 10) * 1.5;
      }
    }

    const accumulation = flowAccumulation(priorityFloodFill(grid), cellSize);

    const channel = accumulation[(size - 2) * size + 10];
    const hillside = accumulation[(size - 2) * size + 2];
    expect(channel).toBeGreaterThan(hillside * 3);
  });
});
