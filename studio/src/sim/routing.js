/**
 * Flow routing: depression filling, D8 flow directions, and the downstream path.
 *
 * Used to decide *where* to report results, never to decide what the water does. Per
 * decision D-007 the depression-filled surface exists only so the station chain follows
 * a hydrologically continuous path. The solver always sees the real terrain, because
 * real depressions catch real water.
 *
 * See docs/hydraulics.md section 5.
 */

/**
 * @typedef {import('../util/grid.js').Grid} Grid
 */

/**
 * A binary min-heap keyed by elevation.
 *
 * Priority flood is only as fast as its queue. A sorted array would make the fill
 * quadratic, which at 262,144 cells is the difference between imperceptible and a
 * visible freeze.
 */
class MinHeap {
  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.values = new Int32Array(capacity);
    this.size = 0;
  }

  #grow() {
    const keys = new Float64Array(this.keys.length * 2);
    const values = new Int32Array(this.values.length * 2);
    keys.set(this.keys);
    values.set(this.values);
    this.keys = keys;
    this.values = values;
  }

  push(key, value) {
    if (this.size === this.keys.length) this.#grow();

    let i = this.size;
    this.size += 1;
    this.keys[i] = key;
    this.values[i] = value;

    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.#swap(parent, i);
      i = parent;
    }
  }

  pop() {
    if (this.size === 0) return -1;

    const topValue = this.values[0];
    this.size -= 1;

    if (this.size > 0) {
      this.keys[0] = this.keys[this.size];
      this.values[0] = this.values[this.size];

      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.size && this.keys[left] < this.keys[smallest]) smallest = left;
        if (right < this.size && this.keys[right] < this.keys[smallest]) smallest = right;
        if (smallest === i) break;
        this.#swap(i, smallest);
        i = smallest;
      }
    }

    return topValue;
  }

  #swap(a, b) {
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
    const v = this.values[a];
    this.values[a] = this.values[b];
    this.values[b] = v;
  }
}

/** Neighbour offsets, cardinal first then diagonal. */
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Fill depressions using priority flood with an epsilon gradient.
 *
 * Wang, L., & Liu, H. (2006), refined as "priority-flood" by Barnes, R., Lehman, C., &
 * Mulla, D. (2014). The epsilon variant raises each filled cell a hair above its
 * predecessor so that flat regions acquire a drainage direction; without it, D8 tracing
 * stops dead the first time it meets a lake or a flood plain.
 *
 * @param {Grid} grid
 * @param {object} [options]
 * @param {number} [options.epsilon=1e-4] metres of artificial gradient per cell
 * @returns {Grid} a new, depression-free grid
 */
export function priorityFloodFill(grid, options = {}) {
  const { epsilon = 1e-4 } = options;
  const { width, height, data } = grid;

  const filled = new Float32Array(data);
  const closed = new Uint8Array(width * height);
  const heap = new MinHeap(Math.max(1024, 2 * (width + height)));

  // Seed with the domain edge. Water leaves through the boundary, so the boundary is the
  // base level that everything drains toward.
  for (let col = 0; col < width; col += 1) {
    const top = col;
    const bottom = (height - 1) * width + col;
    closed[top] = 1;
    heap.push(filled[top], top);
    closed[bottom] = 1;
    heap.push(filled[bottom], bottom);
  }
  for (let row = 1; row < height - 1; row += 1) {
    const left = row * width;
    const right = row * width + width - 1;
    closed[left] = 1;
    heap.push(filled[left], left);
    closed[right] = 1;
    heap.push(filled[right], right);
  }

  while (heap.size > 0) {
    const index = heap.pop();
    const col = index % width;
    const row = (index - col) / width;
    const z = filled[index];

    for (let k = 0; k < 8; k += 1) {
      const nc = col + NEIGHBOURS[k][0];
      const nr = row + NEIGHBOURS[k][1];
      if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;

      const n = nr * width + nc;
      if (closed[n]) continue;

      if (filled[n] <= z) filled[n] = z + epsilon;
      closed[n] = 1;
      heap.push(filled[n], n);
    }
  }

  return { data: filled, width, height };
}

/**
 * D8 flow directions.
 *
 * O'Callaghan, J. F., & Mark, D. M. (1984). Each cell drains to whichever of its eight
 * neighbours gives the steepest descent, with diagonal distances correctly weighted by
 * sqrt(2) so a diagonal step is not unfairly favoured.
 *
 * The returned array holds the linear index of the downstream cell, or -1 where the cell
 * drains out of the domain or has no lower neighbour.
 *
 * @param {Grid} grid should normally be a depression-filled grid
 * @param {number} cellSize m
 * @returns {Int32Array} downstream index per cell
 */
export function d8FlowDirections(grid, cellSize) {
  const { width, height, data } = grid;
  const direction = new Int32Array(width * height).fill(-1);
  const diagonal = cellSize * Math.SQRT2;

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      const z = data[index];

      let bestSlope = 0;
      let bestIndex = -1;

      for (let k = 0; k < 8; k += 1) {
        const nc = col + NEIGHBOURS[k][0];
        const nr = row + NEIGHBOURS[k][1];
        if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;

        const n = nr * width + nc;
        const distance = k < 4 ? cellSize : diagonal;
        const slope = (z - data[n]) / distance;

        if (slope > bestSlope) {
          bestSlope = slope;
          bestIndex = n;
        }
      }

      direction[index] = bestIndex;
    }
  }

  return direction;
}

/**
 * Trace the downstream path from a starting cell.
 *
 * Stops when the path leaves the domain, finds no downstream neighbour, revisits a cell,
 * or exceeds a step limit. Each of those is a legitimate end and is reported in
 * `terminated` so the caller can tell the user why the profile stops where it does,
 * rather than leaving them to wonder.
 *
 * @param {Grid} filled depression-filled grid
 * @param {number} cellSize m
 * @param {{col: number, row: number}} start
 * @param {object} [options]
 * @param {number} [options.maxSteps] defaults to 8x the grid edge
 * @returns {{path: Array<{col: number, row: number, distance: number}>, terminated: string}}
 */
export function traceDownstream(filled, cellSize, start, options = {}) {
  const { width, height } = filled;
  const maxSteps = options.maxSteps ?? Math.max(width, height) * 8;

  const directions = d8FlowDirections(filled, cellSize);
  const visited = new Uint8Array(width * height);
  const diagonal = cellSize * Math.SQRT2;

  let col = Math.round(start.col);
  let row = Math.round(start.row);

  if (col < 0 || col >= width || row < 0 || row >= height) {
    return { path: [], terminated: 'start-outside-domain' };
  }

  const path = [{ col, row, distance: 0 }];
  visited[row * width + col] = 1;

  let distance = 0;
  let terminated = 'step-limit';

  for (let step = 0; step < maxSteps; step += 1) {
    const index = row * width + col;
    const next = directions[index];

    if (next < 0) {
      terminated = 'no-downstream-cell';
      break;
    }

    const nextCol = next % width;
    const nextRow = (next - nextCol) / width;

    if (visited[next]) {
      terminated = 'loop-detected';
      break;
    }

    const isDiagonal = nextCol !== col && nextRow !== row;
    distance += isDiagonal ? diagonal : cellSize;

    col = nextCol;
    row = nextRow;
    visited[next] = 1;
    path.push({ col, row, distance });

    if (col === 0 || row === 0 || col === width - 1 || row === height - 1) {
      terminated = 'left-domain';
      break;
    }
  }

  return { path, terminated };
}

/**
 * Flow accumulation: how many cells drain through each cell.
 *
 * Not used for station placement, but it is the cheapest way to find the real channel in
 * a valley, which the UI uses to draw the stream network and to snap a dam's abutments
 * sensibly. Computed by processing cells from highest to lowest, which guarantees every
 * upstream contribution has already been added.
 *
 * @param {Grid} filled
 * @param {number} cellSize m
 * @returns {Float32Array} contributing cell count per cell
 */
export function flowAccumulation(filled, cellSize) {
  const { width, height, data } = filled;
  const count = width * height;

  const directions = d8FlowDirections(filled, cellSize);
  const accumulation = new Float32Array(count).fill(1);

  const order = new Int32Array(count);
  for (let i = 0; i < count; i += 1) order[i] = i;
  // Descending elevation. Int32Array.prototype.sort takes a comparator.
  order.sort((a, b) => data[b] - data[a]);

  for (let i = 0; i < count; i += 1) {
    const index = order[i];
    const downstream = directions[index];
    if (downstream >= 0) accumulation[downstream] += accumulation[index];
  }

  return accumulation;
}
