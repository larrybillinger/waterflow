import { describe, it, expect } from 'vitest';

import {
  createGrid,
  cloneGrid,
  at,
  sampleBilinear,
  gridExtent,
  resampleWindow,
  smoothGrid,
  slopeAt,
  gridToRGBA,
} from '../src/util/grid.js';

describe('grid basics', () => {
  it('creates a filled grid', () => {
    const grid = createGrid(3, 2, 7);
    expect(grid.width).toBe(3);
    expect(grid.height).toBe(2);
    expect(grid.data.length).toBe(6);
    for (const value of grid.data) expect(value).toBe(7);
  });

  it('clones without sharing the buffer', () => {
    const grid = createGrid(2, 2, 1);
    const copy = cloneGrid(grid);
    copy.data[0] = 99;
    expect(grid.data[0]).toBe(1);
  });

  it('clamps at the edges rather than wrapping or returning undefined', () => {
    const grid = { data: new Float32Array([1, 2, 3, 4]), width: 2, height: 2 };
    expect(at(grid, -5, 0)).toBe(1);
    expect(at(grid, 99, 0)).toBe(2);
    expect(at(grid, 0, 99)).toBe(3);
    expect(at(grid, 99, 99)).toBe(4);
  });
});

describe('sampleBilinear', () => {
  const grid = { data: new Float32Array([0, 10, 20, 30]), width: 2, height: 2 };

  it('returns the exact value at a cell centre', () => {
    expect(sampleBilinear(grid, 0, 0)).toBeCloseTo(0, 9);
    expect(sampleBilinear(grid, 1, 0)).toBeCloseTo(10, 9);
    expect(sampleBilinear(grid, 0, 1)).toBeCloseTo(20, 9);
    expect(sampleBilinear(grid, 1, 1)).toBeCloseTo(30, 9);
  });

  it('interpolates between cells', () => {
    expect(sampleBilinear(grid, 0.5, 0)).toBeCloseTo(5, 9);
    expect(sampleBilinear(grid, 0, 0.5)).toBeCloseTo(10, 9);
    expect(sampleBilinear(grid, 0.5, 0.5)).toBeCloseTo(15, 9);
  });

  it('never returns a value outside the local range', () => {
    for (let i = 0; i <= 20; i += 1) {
      const t = i / 20;
      const value = sampleBilinear(grid, t, t);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(30);
    }
  });
});

describe('gridExtent', () => {
  it('reports the minimum and maximum', () => {
    const grid = { data: new Float32Array([5, -2, 9, 0]), width: 2, height: 2 };
    expect(gridExtent(grid)).toEqual({ min: -2, max: 9 });
  });

  it('ignores NaN', () => {
    const grid = { data: new Float32Array([5, NaN, 9, 0]), width: 2, height: 2 };
    expect(gridExtent(grid)).toEqual({ min: 0, max: 9 });
  });

  it('returns zeroes for an all-NaN grid rather than infinities', () => {
    const grid = { data: new Float32Array([NaN, NaN]), width: 2, height: 1 };
    expect(gridExtent(grid)).toEqual({ min: 0, max: 0 });
  });
});

describe('resampleWindow', () => {
  it('preserves a constant field', () => {
    const src = createGrid(16, 16, 42);
    const dst = resampleWindow(src, { x: 0, y: 0, w: 16, h: 16 }, 8);

    expect(dst.width).toBe(8);
    for (const value of dst.data) expect(value).toBeCloseTo(42, 5);
  });

  it('averages when downsampling rather than point sampling', () => {
    // A checkerboard: point sampling would return 0 or 100, averaging returns 50.
    const src = createGrid(8, 8);
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        src.data[row * 8 + col] = (row + col) % 2 === 0 ? 0 : 100;
      }
    }

    const dst = resampleWindow(src, { x: 0, y: 0, w: 8, h: 8 }, 2);
    for (const value of dst.data) expect(value).toBeCloseTo(50, 4);
  });

  it('preserves a linear ramp when upsampling', () => {
    const src = createGrid(4, 4);
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) src.data[row * 4 + col] = col * 10;
    }

    const dst = resampleWindow(src, { x: 0, y: 0, w: 4, h: 4 }, 8);

    // Monotonic increase left to right in every row.
    for (let row = 0; row < 8; row += 1) {
      for (let col = 1; col < 8; col += 1) {
        expect(dst.data[row * 8 + col]).toBeGreaterThanOrEqual(dst.data[row * 8 + col - 1] - 1e-5);
      }
    }
  });

  it('resamples a sub-window, not the whole source', () => {
    const src = createGrid(8, 8);
    for (let i = 0; i < src.data.length; i += 1) src.data[i] = 0;
    // Mark only the bottom right quadrant.
    for (let row = 4; row < 8; row += 1) {
      for (let col = 4; col < 8; col += 1) src.data[row * 8 + col] = 100;
    }

    const dst = resampleWindow(src, { x: 4, y: 4, w: 4, h: 4 }, 4);
    for (const value of dst.data) expect(value).toBeCloseTo(100, 4);
  });

  it('skips NaN when box averaging', () => {
    const src = createGrid(4, 4, 10);
    src.data[0] = NaN;
    const dst = resampleWindow(src, { x: 0, y: 0, w: 4, h: 4 }, 2);
    for (const value of dst.data) expect(Number.isNaN(value)).toBe(false);
  });
});

describe('smoothGrid', () => {
  it('reduces a spike without changing a constant field', () => {
    const flat = createGrid(8, 8, 5);
    smoothGrid(flat, 2);
    for (const value of flat.data) expect(value).toBeCloseTo(5, 4);

    const spiky = createGrid(8, 8, 0);
    spiky.data[4 * 8 + 4] = 100;
    const before = spiky.data[4 * 8 + 4];
    smoothGrid(spiky, 1);
    expect(spiky.data[4 * 8 + 4]).toBeLessThan(before);
  });

  it('conserves the total approximately', () => {
    const grid = createGrid(16, 16, 0);
    for (let i = 0; i < grid.data.length; i += 1) grid.data[i] = Math.sin(i) * 10;
    const sumBefore = grid.data.reduce((a, b) => a + b, 0);
    smoothGrid(grid, 3);
    const sumAfter = grid.data.reduce((a, b) => a + b, 0);
    // Edge clamping means it is not exact, but it should be close.
    expect(Math.abs(sumAfter - sumBefore)).toBeLessThan(Math.abs(sumBefore) * 0.5 + 5);
  });
});

describe('slopeAt', () => {
  it('returns zero on flat ground', () => {
    const grid = createGrid(5, 5, 100);
    expect(slopeAt(grid, 2, 2, 10)).toBeCloseTo(0, 9);
  });

  it('matches the gradient of a known ramp', () => {
    const grid = createGrid(5, 5);
    const cellSize = 10;
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        // 1 in 5 slope along x.
        grid.data[row * 5 + col] = col * cellSize * 0.2;
      }
    }
    expect(slopeAt(grid, 2, 2, cellSize)).toBeCloseTo(0.2, 6);
  });
});

describe('gridToRGBA', () => {
  it('puts elevation in red and the original in green', () => {
    const current = { data: new Float32Array([1, 2]), width: 2, height: 1 };
    const original = { data: new Float32Array([10, 20]), width: 2, height: 1 };

    const packed = gridToRGBA(current, original);
    expect(packed.length).toBe(8);
    expect(packed[0]).toBe(1);
    expect(packed[1]).toBe(10);
    expect(packed[4]).toBe(2);
    expect(packed[5]).toBe(20);
  });

  it('duplicates the current grid when no original is given', () => {
    const current = { data: new Float32Array([3]), width: 1, height: 1 };
    const packed = gridToRGBA(current);
    expect(packed[0]).toBe(3);
    expect(packed[1]).toBe(3);
  });
});
