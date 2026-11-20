import { describe, it, expect } from 'vitest';

import {
  decodeTerrariumPixel,
  encodeTerrariumPixel,
  decodeTerrariumBuffer,
  fillNodata,
  TERRARIUM_OFFSET,
} from '../src/data/terrarium.js';

describe('Terrarium decoding', () => {
  it('decodes the documented formula', () => {
    // (red * 256 + green + blue / 256) - 32768
    expect(decodeTerrariumPixel(128, 0, 0)).toBeCloseTo(128 * 256 - TERRARIUM_OFFSET, 6);
    expect(decodeTerrariumPixel(128, 10, 0)).toBeCloseTo(128 * 256 + 10 - TERRARIUM_OFFSET, 6);
    expect(decodeTerrariumPixel(128, 0, 128)).toBeCloseTo(128 * 256 + 0.5 - TERRARIUM_OFFSET, 6);
  });

  it('reads sea level as zero', () => {
    // 32768 / 256 = 128 exactly, so red 128 with the rest zero is sea level.
    expect(decodeTerrariumPixel(128, 0, 0)).toBe(0);
  });

  it('handles below sea level', () => {
    expect(decodeTerrariumPixel(127, 0, 0)).toBe(-256);
  });

  it('round trips through the encoder', () => {
    for (const elevation of [0, 1, 100.5, 1234.25, 8848, -400, -10994]) {
      const { r, g, b } = encodeTerrariumPixel(elevation);
      const back = decodeTerrariumPixel(r, g, b);
      // The encoding carries 1/256 m of fractional precision.
      expect(back).toBeCloseTo(elevation, 2);
    }
  });

  it('keeps every channel inside a byte', () => {
    for (const elevation of [-10994, 0, 8848]) {
      const { r, g, b } = encodeTerrariumPixel(elevation);
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('decodeTerrariumBuffer', () => {
  /** Build an RGBA buffer from a list of elevations. */
  const build = (elevations, alpha = 255) => {
    const buffer = new Uint8ClampedArray(elevations.length * 4);
    elevations.forEach((elevation, i) => {
      if (elevation === null) {
        buffer[i * 4 + 3] = 0;
        return;
      }
      const { r, g, b } = encodeTerrariumPixel(elevation);
      buffer[i * 4] = r;
      buffer[i * 4 + 1] = g;
      buffer[i * 4 + 2] = b;
      buffer[i * 4 + 3] = alpha;
    });
    return buffer;
  };

  it('decodes a small raster and reports its extent', () => {
    const elevations = [100, 200, 300, 400];
    const result = decodeTerrariumBuffer(build(elevations), 2, 2);

    expect(result.data.length).toBe(4);
    expect(result.data[0]).toBeCloseTo(100, 2);
    expect(result.data[3]).toBeCloseTo(400, 2);
    expect(result.min).toBeCloseTo(100, 2);
    expect(result.max).toBeCloseTo(400, 2);
    expect(result.nodataCount).toBe(0);
  });

  it('treats a fully transparent pixel as nodata rather than sea level', () => {
    const result = decodeTerrariumBuffer(build([100, null, 300, 400]), 2, 2);
    expect(Number.isNaN(result.data[1])).toBe(true);
    expect(result.nodataCount).toBe(1);
    // The hole must not drag the minimum down to zero.
    expect(result.min).toBeCloseTo(100, 2);
  });

  it('rejects an implausible elevation as nodata', () => {
    const buffer = new Uint8ClampedArray(4);
    // Red 255 gives 65280 - 32768 = 32512 m, which is not a real elevation.
    buffer[0] = 255;
    buffer[1] = 255;
    buffer[2] = 255;
    buffer[3] = 255;

    const result = decodeTerrariumBuffer(buffer, 1, 1);
    expect(Number.isNaN(result.data[0])).toBe(true);
    expect(result.nodataCount).toBe(1);
  });

  it('throws a specific error for a truncated buffer', () => {
    expect(() => decodeTerrariumBuffer(new Uint8ClampedArray(4), 4, 4)).toThrow(
      /expected at least 64 bytes/,
    );
  });
});

describe('fillNodata', () => {
  it('fills a single hole from its neighbours', () => {
    const data = new Float32Array([10, 10, 10, 10, NaN, 10, 10, 10, 10]);
    const filled = fillNodata(data, 3, 3);

    expect(filled).toBe(1);
    expect(data[4]).toBeCloseTo(10, 6);
    for (const value of data) expect(Number.isNaN(value)).toBe(false);
  });

  it('fills a large hole without leaving NaN behind', () => {
    const size = 12;
    const data = new Float32Array(size * size).fill(50);
    for (let row = 3; row < 9; row += 1) {
      for (let col = 3; col < 9; col += 1) data[row * size + col] = NaN;
    }

    fillNodata(data, size, size);

    for (const value of data) expect(Number.isNaN(value)).toBe(false);
  });

  it('uses the fallback when there is no valid data at all', () => {
    const data = new Float32Array(4).fill(NaN);
    fillNodata(data, 2, 2, 42);
    for (const value of data) expect(value).toBe(42);
  });

  it('does nothing when there are no holes', () => {
    const data = new Float32Array([1, 2, 3, 4]);
    expect(fillNodata(data, 2, 2)).toBe(0);
    expect(Array.from(data)).toEqual([1, 2, 3, 4]);
  });
});
