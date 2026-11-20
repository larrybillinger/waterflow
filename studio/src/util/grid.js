/**
 * Float32 raster grid helpers.
 *
 * A grid in Waterflow is the plain object `{ data: Float32Array, width, height }`.
 * Row-major, row 0 is the north edge, column 0 is the west edge. That matches both
 * texture upload order and the slippy-map tile convention, so no axis gets flipped
 * silently between the data layer and the GPU.
 *
 * All functions are pure unless the name says otherwise. Tested in tests/grid.test.js.
 */

/**
 * @typedef {{data: Float32Array, width: number, height: number}} Grid
 */

/**
 * Allocate a grid filled with a constant.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [fill=0]
 * @returns {Grid}
 */
export function createGrid(width, height, fill = 0) {
  const data = new Float32Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { data, width, height };
}

/**
 * Copy a grid.
 *
 * @param {Grid} grid
 * @returns {Grid}
 */
export function cloneGrid(grid) {
  return { data: grid.data.slice(), width: grid.width, height: grid.height };
}

/**
 * Read a cell with edge clamping, so neighbour lookups never need bounds checks.
 *
 * @param {Grid} grid
 * @param {number} col
 * @param {number} row
 * @returns {number}
 */
export function at(grid, col, row) {
  const c = col < 0 ? 0 : col >= grid.width ? grid.width - 1 : col;
  const r = row < 0 ? 0 : row >= grid.height ? grid.height - 1 : row;
  return grid.data[r * grid.width + c];
}

/**
 * Bilinear sample at fractional grid coordinates, with edge clamping.
 *
 * @param {Grid} grid
 * @param {number} col fractional column
 * @param {number} row fractional row
 * @returns {number}
 */
export function sampleBilinear(grid, col, row) {
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const fc = col - c0;
  const fr = row - r0;

  const v00 = at(grid, c0, r0);
  const v10 = at(grid, c0 + 1, r0);
  const v01 = at(grid, c0, r0 + 1);
  const v11 = at(grid, c0 + 1, r0 + 1);

  const top = v00 + (v10 - v00) * fc;
  const bottom = v01 + (v11 - v01) * fc;
  return top + (bottom - top) * fr;
}

/**
 * Minimum and maximum of a grid, ignoring NaN.
 *
 * @param {Grid} grid
 * @returns {{min: number, max: number}}
 */
export function gridExtent(grid) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < grid.data.length; i += 1) {
    const v = grid.data[i];
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return { min: 0, max: 0 };
  return { min, max };
}

/**
 * Resample a rectangular window of a source raster into a square destination grid.
 *
 * Two strategies, chosen by the scale ratio:
 *
 *   Downsampling by more than 1.5x uses an area box average. Point sampling a DEM while
 *   downsampling aliases ridge lines, and a ridge that lands a few metres wrong changes
 *   which valley the water goes down. Averaging is the honest answer at that resolution.
 *
 *   Otherwise bilinear, which is smooth and introduces no new extremes.
 *
 * @param {Grid} src source raster
 * @param {{x: number, y: number, w: number, h: number}} window sub-rect of src in pixels
 * @param {number} dstSize destination edge in cells
 * @returns {Grid} dstSize x dstSize grid
 */
export function resampleWindow(src, window, dstSize) {
  const dst = createGrid(dstSize, dstSize);
  const ratioX = window.w / dstSize;
  const ratioY = window.h / dstSize;
  const useBox = ratioX > 1.5 || ratioY > 1.5;

  for (let row = 0; row < dstSize; row += 1) {
    for (let col = 0; col < dstSize; col += 1) {
      let value;

      if (useBox) {
        const x0 = window.x + col * ratioX;
        const x1 = x0 + ratioX;
        const y0 = window.y + row * ratioY;
        const y1 = y0 + ratioY;

        const ix0 = Math.max(0, Math.floor(x0));
        const ix1 = Math.min(src.width - 1, Math.ceil(x1) - 1);
        const iy0 = Math.max(0, Math.floor(y0));
        const iy1 = Math.min(src.height - 1, Math.ceil(y1) - 1);

        let sum = 0;
        let n = 0;
        for (let sy = iy0; sy <= iy1; sy += 1) {
          for (let sx = ix0; sx <= ix1; sx += 1) {
            const v = src.data[sy * src.width + sx];
            if (Number.isNaN(v)) continue;
            sum += v;
            n += 1;
          }
        }
        value = n > 0 ? sum / n : sampleBilinear(src, (x0 + x1) / 2, (y0 + y1) / 2);
      } else {
        value = sampleBilinear(src, window.x + (col + 0.5) * ratioX, window.y + (row + 0.5) * ratioY);
      }

      dst.data[row * dstSize + col] = value;
    }
  }

  return dst;
}

/**
 * Pack a grid into an RGBA Float32Array for texture upload, elevation in the red channel.
 *
 * WebGL2 can upload single-channel R32F directly, which halves the memory, but RGBA32F
 * is more widely supported as a render target and the extra channels carry the editor's
 * original elevation so an edit can be compared against the untouched ground.
 *
 * @param {Grid} grid
 * @param {Grid} [original] optional second grid for the green channel
 * @returns {Float32Array} length 4 * width * height
 */
export function gridToRGBA(grid, original) {
  const n = grid.width * grid.height;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    out[i * 4] = grid.data[i];
    out[i * 4 + 1] = original ? original.data[i] : grid.data[i];
  }
  return out;
}

/**
 * Smooth a grid in place with a separable 3-tap blur, run `passes` times.
 *
 * Used by the terrain editor's smooth brush and by nothing in the solver. The solver
 * must see the terrain as it is.
 *
 * @param {Grid} grid modified in place
 * @param {number} [passes=1]
 * @returns {Grid} the same grid, for chaining
 */
export function smoothGrid(grid, passes = 1) {
  const { width, height } = grid;
  const temp = new Float32Array(grid.data.length);

  for (let pass = 0; pass < passes; pass += 1) {
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const i = row * width + col;
        temp[i] = (at(grid, col - 1, row) + 2 * grid.data[i] + at(grid, col + 1, row)) / 4;
      }
    }
    grid.data.set(temp);

    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const i = row * width + col;
        temp[i] = (at(grid, col, row - 1) + 2 * grid.data[i] + at(grid, col, row + 1)) / 4;
      }
    }
    grid.data.set(temp);
  }

  return grid;
}

/**
 * Slope magnitude at a cell, as a dimensionless rise over run.
 *
 * Uses the central difference over two cells, which is the standard Horn method used by
 * most GIS slope tools.
 *
 * @param {Grid} grid
 * @param {number} col
 * @param {number} row
 * @param {number} cellSize metres
 * @returns {number} slope, dimensionless
 */
export function slopeAt(grid, col, row, cellSize) {
  const dzdx = (at(grid, col + 1, row) - at(grid, col - 1, row)) / (2 * cellSize);
  const dzdy = (at(grid, col, row + 1) - at(grid, col, row - 1)) / (2 * cellSize);
  return Math.hypot(dzdx, dzdy);
}
