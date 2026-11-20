/**
 * Terrain editing: the SimCity-style part of the brief.
 *
 * The point of this is not landscaping for its own sake. It is so the user can ask
 * "what if there were a levee here", "what if this channel were deeper", "what if we cut
 * a spillway through that ridge", and get an answer by re-running. That makes the tool
 * useful for thinking with rather than only for looking at.
 *
 * Undo stores a rectangular patch of the previous elevations rather than a whole grid
 * copy. A 512 grid is 1 MB per snapshot, so twenty full copies would be 20 MB for
 * nothing; a brush stroke usually touches a few thousand cells.
 *
 * Every brush writes into the elevation grid, which the solver reads as its bed. There is
 * no separate "edited" layer to keep in step.
 */

import { at, smoothGrid, cloneGrid } from '../util/grid.js';

/**
 * @typedef {import('../util/grid.js').Grid} Grid
 */

/** Brush behaviours offered in the UI. */
export const BRUSHES = {
  raise: {
    id: 'raise',
    label: 'Raise',
    describe: 'Builds ground up. Hold and drag to pile more.',
    cursorColour: 0x7bf7a0,
  },
  lower: {
    id: 'lower',
    label: 'Excavate',
    describe: 'Digs ground away. Use it to cut a spillway or deepen a basin.',
    cursorColour: 0xff8f6b,
  },
  smooth: {
    id: 'smooth',
    label: 'Smooth',
    describe: 'Averages the surface. Softens an edit that came out too sharp.',
    cursorColour: 0x9fb6ff,
  },
  flatten: {
    id: 'flatten',
    label: 'Level',
    describe: 'Flattens to the elevation under the first click. A building pad or a road.',
    cursorColour: 0xffd34d,
  },
  channel: {
    id: 'channel',
    label: 'Carve channel',
    describe: 'Drag a line to cut a channel along it, deepest at the centreline.',
    cursorColour: 0x59d9ff,
  },
  levee: {
    id: 'levee',
    label: 'Build levee',
    describe: 'Drag a line to raise an embankment along it.',
    cursorColour: 0xd79bff,
  },
};

/** Brushes that act along a dragged line rather than at a point. */
export const STROKE_BRUSHES = new Set(['channel', 'levee']);

export class TerrainEditor {
  /**
   * @param {object} params
   * @param {Grid} params.grid the live elevation grid, edited in place
   * @param {number} params.cellSize metres
   * @param {number} [params.maxUndo=40]
   */
  constructor({ grid, cellSize, maxUndo = 40 }) {
    this.grid = grid;
    this.cellSize = cellSize;
    this.maxUndo = maxUndo;

    /** Untouched ground as loaded, so an edit can always be compared or reverted. */
    this.originalGrid = cloneGrid(grid);

    /** @type {Array<{col: number, row: number, width: number, height: number, data: Float32Array, label: string}>} */
    this.undoStack = [];

    /** Cells changed since the grid was loaded, for the UI's edit counter. */
    this.editedCells = new Set();

    this.settings = {
      brush: 'raise',
      /** Brush radius in metres. */
      radius: 300,
      /** Metres of change at the centre of one application. */
      strength: 4,
      /** Falloff exponent. 1 is linear, 2 is a soft dome. */
      falloff: 2,
      /** Channel depth and levee height in metres, for the stroke brushes. */
      strokeMagnitude: 8,
      /** Channel or levee width in metres. */
      strokeWidth: 240,
    };

    this.#pendingPatch = null;
    this.flattenTarget = null;
  }

  #pendingPatch = null;

  /** Brush radius in cells. */
  get radiusCells() {
    return Math.max(1, this.settings.radius / this.cellSize);
  }

  /**
   * Begin an edit operation. Everything until `end` is one undo step.
   *
   * @param {string} label shown in the UI
   */
  begin(label) {
    this.#pendingPatch = { minCol: Infinity, minRow: Infinity, maxCol: -Infinity, maxRow: -Infinity, label };
    this.#snapshot = null;
  }

  #snapshot = null;

  /**
   * Record the cells a brush is about to touch, before touching them.
   *
   * @param {number} minCol
   * @param {number} minRow
   * @param {number} maxCol
   * @param {number} maxRow
   */
  #expand(minCol, minRow, maxCol, maxRow) {
    const patch = this.#pendingPatch;
    if (!patch) return;

    const c0 = Math.max(0, Math.floor(minCol));
    const r0 = Math.max(0, Math.floor(minRow));
    const c1 = Math.min(this.grid.width - 1, Math.ceil(maxCol));
    const r1 = Math.min(this.grid.height - 1, Math.ceil(maxRow));

    // The first expansion of an operation takes the snapshot. Later expansions within the
    // same operation merge into the existing snapshot region, re-snapshotting the union
    // so that undo restores everything the operation touched.
    if (!this.#snapshot) {
      this.#snapshot = this.#captureRegion(c0, r0, c1, r1);
      patch.minCol = c0;
      patch.minRow = r0;
      patch.maxCol = c1;
      patch.maxRow = r1;
      return;
    }

    if (c0 >= patch.minCol && r0 >= patch.minRow && c1 <= patch.maxCol && r1 <= patch.maxRow) {
      return;
    }

    // Grow the snapshot. The existing snapshot data is older than the grid, so it must be
    // preserved where it overlaps the new region.
    const newMinCol = Math.min(patch.minCol, c0);
    const newMinRow = Math.min(patch.minRow, r0);
    const newMaxCol = Math.max(patch.maxCol, c1);
    const newMaxRow = Math.max(patch.maxRow, r1);

    const grown = this.#captureRegion(newMinCol, newMinRow, newMaxCol, newMaxRow);

    // Overlay the older values from the previous snapshot.
    const oldWidth = patch.maxCol - patch.minCol + 1;
    const newWidth = newMaxCol - newMinCol + 1;
    for (let r = patch.minRow; r <= patch.maxRow; r += 1) {
      for (let c = patch.minCol; c <= patch.maxCol; c += 1) {
        const oldIndex = (r - patch.minRow) * oldWidth + (c - patch.minCol);
        const newIndex = (r - newMinRow) * newWidth + (c - newMinCol);
        grown.data[newIndex] = this.#snapshot.data[oldIndex];
      }
    }

    this.#snapshot = grown;
    patch.minCol = newMinCol;
    patch.minRow = newMinRow;
    patch.maxCol = newMaxCol;
    patch.maxRow = newMaxRow;
  }

  #captureRegion(c0, r0, c1, r1) {
    const width = c1 - c0 + 1;
    const height = r1 - r0 + 1;
    const data = new Float32Array(width * height);

    for (let r = 0; r < height; r += 1) {
      for (let c = 0; c < width; c += 1) {
        data[r * width + c] = this.grid.data[(r0 + r) * this.grid.width + (c0 + c)];
      }
    }

    return { col: c0, row: r0, width, height, data };
  }

  /** Finish the current operation and push it onto the undo stack. */
  end() {
    if (!this.#pendingPatch || !this.#snapshot) {
      this.#pendingPatch = null;
      return;
    }

    this.undoStack.push({ ...this.#snapshot, label: this.#pendingPatch.label });
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();

    this.#pendingPatch = null;
    this.#snapshot = null;
  }

  /**
   * Apply the current brush at a point.
   *
   * @param {number} col
   * @param {number} row
   * @param {number} [intensity=1] scales the strength, for a soft start on a drag
   */
  apply(col, row, intensity = 1) {
    const { brush } = this.settings;
    if (STROKE_BRUSHES.has(brush)) return;

    const radius = this.radiusCells;
    this.#expand(col - radius - 1, row - radius - 1, col + radius + 1, row + radius + 1);

    if (brush === 'smooth') {
      this.#applySmooth(col, row, radius, intensity);
      return;
    }

    if (brush === 'flatten') {
      if (this.flattenTarget === null) {
        this.flattenTarget = at(this.grid, Math.round(col), Math.round(row));
      }
      this.#applyFlatten(col, row, radius, intensity, this.flattenTarget);
      return;
    }

    const sign = brush === 'lower' ? -1 : 1;
    this.#applyOffset(col, row, radius, sign * this.settings.strength * intensity);
  }

  #applyOffset(col, row, radius, amount) {
    const { data, width, height } = this.grid;
    const c0 = Math.max(0, Math.floor(col - radius));
    const c1 = Math.min(width - 1, Math.ceil(col + radius));
    const r0 = Math.max(0, Math.floor(row - radius));
    const r1 = Math.min(height - 1, Math.ceil(row + radius));

    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const distance = Math.hypot(c - col, r - row);
        if (distance > radius) continue;

        const falloff = Math.pow(1 - distance / radius, this.settings.falloff);
        const index = r * width + c;
        data[index] += amount * falloff;
        this.editedCells.add(index);
      }
    }
  }

  #applyFlatten(col, row, radius, intensity, target) {
    const { data, width, height } = this.grid;
    const c0 = Math.max(0, Math.floor(col - radius));
    const c1 = Math.min(width - 1, Math.ceil(col + radius));
    const r0 = Math.max(0, Math.floor(row - radius));
    const r1 = Math.min(height - 1, Math.ceil(row + radius));

    // Blend toward the target rather than snapping, so repeated passes converge and a
    // single pass leaves a soft edge instead of a cliff.
    const rate = Math.min(1, 0.35 * intensity);

    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const distance = Math.hypot(c - col, r - row);
        if (distance > radius) continue;

        const falloff = Math.pow(1 - distance / radius, this.settings.falloff);
        const index = r * width + c;
        data[index] += (target - data[index]) * rate * falloff;
        this.editedCells.add(index);
      }
    }
  }

  #applySmooth(col, row, radius, intensity) {
    const { data, width, height } = this.grid;
    const c0 = Math.max(0, Math.floor(col - radius));
    const c1 = Math.min(width - 1, Math.ceil(col + radius));
    const r0 = Math.max(0, Math.floor(row - radius));
    const r1 = Math.min(height - 1, Math.ceil(row + radius));

    // Smooth a copy of the region so the pass is not biased by its own output, which
    // would smear the result in the scan direction.
    const region = this.#captureRegion(c0, r0, c1, r1);
    const working = { data: region.data.slice(), width: region.width, height: region.height };
    smoothGrid(working, 2);

    const rate = Math.min(1, 0.6 * intensity);

    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const distance = Math.hypot(c - col, r - row);
        if (distance > radius) continue;

        const falloff = Math.pow(1 - distance / radius, this.settings.falloff);
        const localIndex = (r - r0) * region.width + (c - c0);
        const index = r * width + c;
        data[index] += (working.data[localIndex] - data[index]) * rate * falloff;
        this.editedCells.add(index);
      }
    }
  }

  /**
   * Apply a stroke brush along a line: carve a channel or raise a levee.
   *
   * The cross-section is a smooth profile rather than a rectangle, because a
   * rectangular trench one cell wide is below the resolution of the simulation and a
   * rectangular levee has vertical walls the solver handles badly.
   *
   * @param {{col: number, row: number}} start
   * @param {{col: number, row: number}} end
   */
  applyStroke(start, end) {
    const { brush, strokeMagnitude, strokeWidth } = this.settings;
    if (!STROKE_BRUSHES.has(brush)) return;

    const halfWidthCells = Math.max(1, strokeWidth / 2 / this.cellSize);
    const sign = brush === 'channel' ? -1 : 1;

    const minCol = Math.min(start.col, end.col) - halfWidthCells - 2;
    const maxCol = Math.max(start.col, end.col) + halfWidthCells + 2;
    const minRow = Math.min(start.row, end.row) - halfWidthCells - 2;
    const maxRow = Math.max(start.row, end.row) + halfWidthCells + 2;

    this.#expand(minCol, minRow, maxCol, maxRow);

    const { data, width, height } = this.grid;

    const c0 = Math.max(0, Math.floor(minCol));
    const c1 = Math.min(width - 1, Math.ceil(maxCol));
    const r0 = Math.max(0, Math.floor(minRow));
    const r1 = Math.min(height - 1, Math.ceil(maxRow));

    const dCol = end.col - start.col;
    const dRow = end.row - start.row;
    const lengthSq = dCol * dCol + dRow * dRow;

    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        // Perpendicular distance to the segment.
        let t = 0;
        if (lengthSq > 0) {
          t = ((c - start.col) * dCol + (r - start.row) * dRow) / lengthSq;
          t = Math.max(0, Math.min(1, t));
        }
        const projCol = start.col + dCol * t;
        const projRow = start.row + dRow * t;
        const distance = Math.hypot(c - projCol, r - projRow);

        if (distance > halfWidthCells) continue;

        // Cosine profile: flat-ish in the middle, tapering to nothing at the edges.
        const normalised = distance / halfWidthCells;
        const profile = 0.5 + 0.5 * Math.cos(normalised * Math.PI);

        const index = r * width + c;
        data[index] += sign * strokeMagnitude * profile;
        this.editedCells.add(index);
      }
    }
  }

  /**
   * Undo the most recent operation.
   *
   * @returns {string|null} the label of what was undone, or null if nothing to undo
   */
  undo() {
    const patch = this.undoStack.pop();
    if (!patch) return null;

    for (let r = 0; r < patch.height; r += 1) {
      for (let c = 0; c < patch.width; c += 1) {
        const index = (patch.row + r) * this.grid.width + (patch.col + c);
        this.grid.data[index] = patch.data[r * patch.width + c];
      }
    }

    return patch.label;
  }

  /** Discard every edit and restore the ground as loaded. */
  revertAll() {
    this.grid.data.set(this.originalGrid.data);
    this.undoStack.length = 0;
    this.editedCells.clear();
    this.flattenTarget = null;
  }

  /** @returns {boolean} */
  get canUndo() {
    return this.undoStack.length > 0;
  }

  /** @returns {number} cells differing from the ground as loaded */
  get editedCellCount() {
    let count = 0;
    for (let i = 0; i < this.grid.data.length; i += 1) {
      if (Math.abs(this.grid.data[i] - this.originalGrid.data[i]) > 0.01) count += 1;
    }
    return count;
  }

  /**
   * Net volume of material moved, in cubic metres. Positive means ground added.
   *
   * @returns {{added: number, removed: number}}
   */
  get earthworkVolume() {
    const cellArea = this.cellSize * this.cellSize;
    let added = 0;
    let removed = 0;

    for (let i = 0; i < this.grid.data.length; i += 1) {
      const delta = this.grid.data[i] - this.originalGrid.data[i];
      if (delta > 0) added += delta * cellArea;
      else removed += -delta * cellArea;
    }

    return { added, removed };
  }
}

export default TerrainEditor;
