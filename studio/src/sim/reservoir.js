/**
 * Reservoir pool definition and storage-elevation relationships.
 *
 * The storage curve is computed from the elevation grid rather than assumed from a
 * shape. For a water surface elevation W, the pool is the set of cells reachable from a
 * seed by 4-neighbour steps through cells whose ground is below W. Then
 *
 *   area   = cellCount * cellSize^2
 *   volume = sum over pool cells of (W - z) * cellSize^2
 *
 * That is the definition of volume to within the resolution of the grid, not an
 * approximation of it. See docs/hydraulics.md section 4.
 *
 * The connectivity constraint is what matters. Without it, a simple "every cell below W"
 * test would fill an unconnected valley on the far side of a ridge, and report a
 * reservoir several times too large.
 */

/**
 * @typedef {import('../util/grid.js').Grid} Grid
 */

/**
 * @typedef {object} Pool
 * @property {Uint8Array} mask 1 where the cell is in the pool
 * @property {number} cellCount
 * @property {number} area m^2
 * @property {number} volume m^3
 * @property {number} maxDepth m
 * @property {number} surfaceElevation m
 * @property {number} bedMin lowest ground elevation in the pool, m
 * @property {boolean} touchesEdge true if the pool reaches the domain boundary
 */

/**
 * Flood fill a connected pool below a water surface elevation.
 *
 * Uses an explicit stack rather than recursion: a pool can easily be a hundred thousand
 * cells and that would blow the call stack.
 *
 * @param {Grid} grid ground elevation
 * @param {number} seedCol
 * @param {number} seedRow
 * @param {number} surfaceElevation m
 * @param {number} cellSize m
 * @returns {Pool}
 */
export function fillPool(grid, seedCol, seedRow, surfaceElevation, cellSize) {
  const { data, width, height } = grid;
  const mask = new Uint8Array(width * height);

  const col = Math.round(seedCol);
  const row = Math.round(seedRow);

  const empty = {
    mask,
    cellCount: 0,
    area: 0,
    volume: 0,
    maxDepth: 0,
    surfaceElevation,
    bedMin: Number.NaN,
    touchesEdge: false,
  };

  if (col < 0 || col >= width || row < 0 || row >= height) return empty;

  const seedIndex = row * width + col;
  if (!(data[seedIndex] < surfaceElevation)) return empty;

  const cellArea = cellSize * cellSize;
  const stack = [seedIndex];
  mask[seedIndex] = 1;

  let cellCount = 0;
  let volume = 0;
  let maxDepth = 0;
  let bedMin = Infinity;
  let touchesEdge = false;

  while (stack.length > 0) {
    const index = stack.pop();
    const c = index % width;
    const r = (index - c) / width;

    const z = data[index];
    const depth = surfaceElevation - z;

    cellCount += 1;
    volume += depth * cellArea;
    if (depth > maxDepth) maxDepth = depth;
    if (z < bedMin) bedMin = z;
    if (c === 0 || r === 0 || c === width - 1 || r === height - 1) touchesEdge = true;

    // Four-neighbour connectivity. Eight would let water pass diagonally through a
    // one-cell-thick dam, which is exactly the leak this is here to prevent.
    if (c > 0) {
      const n = index - 1;
      if (!mask[n] && data[n] < surfaceElevation) { mask[n] = 1; stack.push(n); }
    }
    if (c < width - 1) {
      const n = index + 1;
      if (!mask[n] && data[n] < surfaceElevation) { mask[n] = 1; stack.push(n); }
    }
    if (r > 0) {
      const n = index - width;
      if (!mask[n] && data[n] < surfaceElevation) { mask[n] = 1; stack.push(n); }
    }
    if (r < height - 1) {
      const n = index + width;
      if (!mask[n] && data[n] < surfaceElevation) { mask[n] = 1; stack.push(n); }
    }
  }

  return {
    mask,
    cellCount,
    area: cellCount * cellArea,
    volume,
    maxDepth,
    surfaceElevation,
    bedMin: bedMin === Infinity ? Number.NaN : bedMin,
    touchesEdge,
  };
}

/**
 * Build a storage-elevation curve by filling the pool at a series of elevations.
 *
 * @param {Grid} grid
 * @param {number} seedCol
 * @param {number} seedRow
 * @param {object} options
 * @param {number} options.cellSize m
 * @param {number} options.minElevation m
 * @param {number} options.maxElevation m
 * @param {number} [options.samples=48]
 * @returns {Array<{elevation: number, area: number, volume: number}>}
 */
export function storageCurve(grid, seedCol, seedRow, options) {
  const { cellSize, minElevation, maxElevation, samples = 48 } = options;
  const curve = [];

  for (let i = 0; i <= samples; i += 1) {
    const elevation = minElevation + ((maxElevation - minElevation) * i) / samples;
    const pool = fillPool(grid, seedCol, seedRow, elevation, cellSize);
    curve.push({ elevation, area: pool.area, volume: pool.volume });
  }

  return curve;
}

/**
 * Find the lowest ground elevation near a point, which is a good seed for the pool fill.
 *
 * The user clicks roughly in the reservoir, not precisely on the deepest cell. Snapping
 * to the local minimum means a click on the bank still seeds the pool correctly.
 *
 * @param {Grid} grid
 * @param {number} col
 * @param {number} row
 * @param {number} [searchRadius=6] cells
 * @returns {{col: number, row: number, elevation: number}}
 */
export function snapToLocalMinimum(grid, col, row, searchRadius = 6) {
  const { data, width, height } = grid;
  const c0 = Math.max(0, Math.round(col) - searchRadius);
  const c1 = Math.min(width - 1, Math.round(col) + searchRadius);
  const r0 = Math.max(0, Math.round(row) - searchRadius);
  const r1 = Math.min(height - 1, Math.round(row) + searchRadius);

  let best = { col: Math.round(col), row: Math.round(row), elevation: Infinity };

  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      const z = data[r * width + c];
      if (z < best.elevation) best = { col: c, row: r, elevation: z };
    }
  }

  if (best.elevation === Infinity) {
    const index = Math.round(row) * width + Math.round(col);
    return { col: Math.round(col), row: Math.round(row), elevation: data[index] ?? 0 };
  }

  return best;
}

/**
 * Write a pool's depths into a depth grid, as the solver's initial condition.
 *
 * @param {Grid} ground
 * @param {Pool} pool
 * @returns {Float32Array} depth per cell, m
 */
export function poolToDepthField(ground, pool) {
  const depth = new Float32Array(ground.data.length);
  for (let i = 0; i < depth.length; i += 1) {
    if (pool.mask[i]) {
      const d = pool.surfaceElevation - ground.data[i];
      depth[i] = d > 0 ? d : 0;
    }
  }
  return depth;
}

/**
 * Convert cubic metres to acre-feet, for operators who think in those units.
 * 1 acre-foot = 1233.48183754752 m^3 exactly, from the international foot and the acre.
 *
 * @param {number} cubicMetres
 * @returns {number} acre-feet
 */
export function toAcreFeet(cubicMetres) {
  return cubicMetres / 1233.48183754752;
}

/**
 * Convert square metres to acres. 1 acre = 4046.8564224 m^2 exactly.
 *
 * @param {number} squareMetres
 * @returns {number} acres
 */
export function toAcres(squareMetres) {
  return squareMetres / 4046.8564224;
}
