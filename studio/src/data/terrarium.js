/**
 * Terrarium elevation decoding.
 *
 * From the Tilezen terrain tile specification:
 *
 *   Terrarium format PNG tiles contain raw elevation data in metres, in Web Mercator
 *   projection (EPSG:3857). All values are positive with a 32768 offset, split into the
 *   red, green and blue channels, with 16 bits of integer and 8 bits of fraction.
 *
 *   To decode:  (red * 256 + green + blue / 256) - 32768
 *
 * In other words red carries the 256s place, green the 1s place, and blue the fraction
 * in steps of 1/256 metre. The 32768 offset is what allows below-sea-level values.
 *
 * Cited in docs/hydraulics.md and docs/data-sources.md.
 */

/** The offset applied by the encoding, in metres. */
export const TERRARIUM_OFFSET = 32768;

/**
 * Lowest plausible real elevation on Earth, metres. Challenger Deep is about -10,935 m.
 * Anything below this is a decode error or a nodata pixel, not terrain.
 */
export const MIN_VALID_ELEVATION = -11500;

/** Highest plausible real elevation, metres. Everest is 8,849 m. */
export const MAX_VALID_ELEVATION = 9200;

/**
 * Decode one Terrarium pixel to metres above the ellipsoid reference.
 *
 * @param {number} r red channel, 0-255
 * @param {number} g green channel, 0-255
 * @param {number} b blue channel, 0-255
 * @returns {number} elevation in metres
 */
export function decodeTerrariumPixel(r, g, b) {
  return r * 256 + g + b / 256 - TERRARIUM_OFFSET;
}

/**
 * Encode metres back to a Terrarium pixel. Only used by tests and by the synthetic
 * terrain generator in scripts/, but it belongs next to the decoder so the two cannot
 * drift apart.
 *
 * @param {number} elevation metres
 * @returns {{r: number, g: number, b: number}} channel values 0-255
 */
export function encodeTerrariumPixel(elevation) {
  const v = elevation + TERRARIUM_OFFSET;
  const r = Math.floor(v / 256);
  const g = Math.floor(v % 256);
  const b = Math.floor((v - Math.floor(v)) * 256);
  return { r, g, b };
}

/**
 * Decode an entire RGBA pixel buffer into a Float32Array of elevations.
 *
 * Fully transparent pixels are treated as nodata and written as NaN, so that callers can
 * distinguish "no data here" from "sea level here". The caller is responsible for filling
 * them; silently writing zero would put a flat plain at sea level in the middle of a
 * mountain range.
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba interleaved RGBA, length 4 * width * height
 * @param {number} width
 * @param {number} height
 * @returns {{data: Float32Array, min: number, max: number, nodataCount: number}}
 */
export function decodeTerrariumBuffer(rgba, width, height) {
  const count = width * height;
  if (rgba.length < count * 4) {
    throw new Error(
      `Terrarium decode failed: expected at least ${count * 4} bytes for a ${width}x${height} ` +
        `image but received ${rgba.length}. The tile may be truncated or not RGBA.`,
    );
  }

  const data = new Float32Array(count);
  let min = Infinity;
  let max = -Infinity;
  let nodataCount = 0;

  for (let i = 0; i < count; i += 1) {
    const o = i * 4;

    if (rgba[o + 3] === 0) {
      data[i] = NaN;
      nodataCount += 1;
      continue;
    }

    const elevation = decodeTerrariumPixel(rgba[o], rgba[o + 1], rgba[o + 2]);

    if (elevation < MIN_VALID_ELEVATION || elevation > MAX_VALID_ELEVATION) {
      data[i] = NaN;
      nodataCount += 1;
      continue;
    }

    data[i] = elevation;
    if (elevation < min) min = elevation;
    if (elevation > max) max = elevation;
  }

  if (nodataCount === count) {
    return { data, min: 0, max: 0, nodataCount };
  }

  return { data, min, max, nodataCount };
}

/**
 * Replace NaN nodata values by nearest-neighbour growth from valid data.
 *
 * Several passes of a 4-neighbour average over known cells fills small holes without
 * inventing structure. If a tile is entirely nodata the whole grid is set to the given
 * fallback, and the caller is expected to warn the user rather than pretend.
 *
 * @param {Float32Array} data modified in place
 * @param {number} width
 * @param {number} height
 * @param {number} [fallback=0] value used when there is no valid data at all
 * @returns {number} count of cells that were filled
 */
export function fillNodata(data, width, height, fallback = 0) {
  let remaining = 0;
  for (let i = 0; i < data.length; i += 1) {
    if (Number.isNaN(data[i])) remaining += 1;
  }
  if (remaining === 0) return 0;
  if (remaining === data.length) {
    data.fill(fallback);
    return remaining;
  }

  const filledTotal = remaining;
  // A hole can be no wider than the grid, and each pass grows the known region by one
  // cell, so this bound always terminates with every hole filled.
  const maxPasses = Math.max(width, height);

  for (let pass = 0; pass < maxPasses && remaining > 0; pass += 1) {
    const snapshot = data.slice();

    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const i = row * width + col;
        if (!Number.isNaN(snapshot[i])) continue;

        let sum = 0;
        let n = 0;
        if (col > 0 && !Number.isNaN(snapshot[i - 1])) { sum += snapshot[i - 1]; n += 1; }
        if (col < width - 1 && !Number.isNaN(snapshot[i + 1])) { sum += snapshot[i + 1]; n += 1; }
        if (row > 0 && !Number.isNaN(snapshot[i - width])) { sum += snapshot[i - width]; n += 1; }
        if (row < height - 1 && !Number.isNaN(snapshot[i + width])) { sum += snapshot[i + width]; n += 1; }

        if (n > 0) {
          data[i] = sum / n;
          remaining -= 1;
        }
      }
    }
  }

  return filledTotal;
}
