/**
 * Drifters: objects that float downstream on the simulated velocity field.
 *
 * This is the "follow a spot like a movie" and "put a dude on a raft" feature. A drifter
 * is a massless tracer: it has no momentum of its own and simply takes the velocity of
 * the water it is sitting in. That is the right model here, because what the user wants
 * to see is where the water goes, and a tracer answers exactly that question. Giving the
 * raft its own inertia would make it lag the flow and quietly tell a less true story.
 *
 * Integration is second order (midpoint / RK2) rather than Euler. With Euler, a drifter
 * going round a meander consistently cuts the corner and climbs out of the channel,
 * which looks like the raft beaching itself on a bend for no reason.
 *
 * Velocity is read back from the GPU for a small neighbourhood around each drifter, which
 * is a few hundred bytes per drifter per frame. Cheap enough to ignore, and far simpler
 * than advecting particles in a shader and reading those back instead.
 */

import { physics } from '../config.js';

/** How a drifter's life ended, if it has. */
export const DRIFTER_STATE = {
  floating: 'floating',
  stranded: 'stranded',
  leftDomain: 'left-domain',
  waiting: 'waiting',
};

let nextId = 1;

export class Drifter {
  /**
   * @param {object} params
   * @param {number} params.col starting grid column, fractional
   * @param {number} params.row starting grid row, fractional
   * @param {string} [params.label]
   * @param {'raft'|'buoy'|'debris'} [params.kind]
   */
  constructor({ col, row, label, kind = 'raft' }) {
    this.id = nextId;
    nextId += 1;

    this.kind = kind;
    this.label = label ?? `${kind === 'raft' ? 'Raft' : 'Marker'} ${this.id}`;

    this.col = col;
    this.row = row;
    this.startCol = col;
    this.startRow = row;

    /** Grid cells per second. Converted to m/s on read. */
    this.velocityCol = 0;
    this.velocityRow = 0;

    this.depth = 0;
    this.bedElevation = 0;
    this.speed = 0;

    /** Heading in radians, 0 pointing north, used to orient the raft. */
    this.heading = 0;

    /** Metres travelled along the actual drift path. */
    this.distanceTravelled = 0;

    /** Simulation time at which the drifter first started moving. */
    this.launchedAt = null;

    /** Simulation time at which it stopped, if it has. */
    this.endedAt = null;

    this.state = DRIFTER_STATE.waiting;

    /**
     * Breadcrumb trail in grid coordinates, used to draw the path travelled.
     * Capped: an hour of simulation at 60 fps is 216,000 points and nobody needs that
     * many to see where a raft went.
     */
    this.trail = [];
    this.maxTrailPoints = 2000;
    this.#trailAccumulator = 0;
  }

  #trailAccumulator = 0;

  /** True while the drifter is still moving and worth integrating. */
  get active() {
    return this.state === DRIFTER_STATE.waiting || this.state === DRIFTER_STATE.floating;
  }

  /**
   * Advance the drifter.
   *
   * @param {object} params
   * @param {(col: number, row: number) => {depth: number, vx: number, vy: number, bed: number}}
   *   params.sample samples the simulation at fractional grid coordinates. vx and vy are
   *   in metres per second, x east and y south.
   * @param {number} params.dt simulation seconds to advance
   * @param {number} params.cellSize metres
   * @param {number} params.gridSize cells per edge
   * @param {number} params.simulationTime current simulation clock, for timestamps
   * @param {number} [params.minDepth] depth below which the drifter grounds out
   */
  step({ sample, dt, cellSize, gridSize, simulationTime, minDepth }) {
    if (!this.active || dt <= 0) return;

    const groundingDepth = minDepth ?? Math.max(0.25, physics.dryDepth * 50);

    const here = sample(this.col, this.row);
    this.depth = here.depth;
    this.bedElevation = here.bed;

    if (here.depth < groundingDepth) {
      if (this.state === DRIFTER_STATE.floating) {
        // It was moving and has now run out of water.
        this.state = DRIFTER_STATE.stranded;
        this.endedAt = simulationTime;
      }
      // Still waiting for the flood to reach it: hold position, keep the velocity at
      // zero so the raft sits still rather than jittering on a millimetre of water.
      this.velocityCol = 0;
      this.velocityRow = 0;
      this.speed = 0;
      return;
    }

    if (this.state === DRIFTER_STATE.waiting) {
      this.state = DRIFTER_STATE.floating;
      this.launchedAt = simulationTime;
      this.trail.push({ col: this.col, row: this.row, time: simulationTime });
    }

    // RK2 midpoint. Sample at the start, step half a timestep, re-sample, then take the
    // full step using the midpoint velocity.
    const vColStart = here.vx / cellSize;
    const vRowStart = here.vy / cellSize;

    const midCol = this.col + vColStart * dt * 0.5;
    const midRow = this.row + vRowStart * dt * 0.5;

    const mid = sample(midCol, midRow);
    let vCol = mid.depth > groundingDepth ? mid.vx / cellSize : vColStart;
    let vRow = mid.depth > groundingDepth ? mid.vy / cellSize : vRowStart;

    // A tracer cannot outrun its own cell in a single step without tunnelling straight
    // through a bank. Cap the step at a fraction of a cell and accept a little lag in
    // the rare frame where the flow is that fast.
    const stepCells = Math.hypot(vCol * dt, vRow * dt);
    const maxStepCells = 0.45;
    if (stepCells > maxStepCells) {
      const scale = maxStepCells / stepCells;
      vCol *= scale;
      vRow *= scale;
    }

    const prevCol = this.col;
    const prevRow = this.row;

    this.col += vCol * dt;
    this.row += vRow * dt;

    this.velocityCol = vCol;
    this.velocityRow = vRow;
    this.speed = Math.hypot(vCol, vRow) * cellSize;

    const movedCells = Math.hypot(this.col - prevCol, this.row - prevRow);
    this.distanceTravelled += movedCells * cellSize;

    // Heading: 0 is north, which is -row. Measured clockwise so it matches a compass.
    if (this.speed > 0.05) {
      this.heading = Math.atan2(vCol, -vRow);
    }

    // Trail point roughly every half cell of travel, which keeps the line smooth
    // without filling memory.
    this.#trailAccumulator += movedCells;
    if (this.#trailAccumulator >= 0.5) {
      this.#trailAccumulator = 0;
      this.trail.push({ col: this.col, row: this.row, time: simulationTime });
      if (this.trail.length > this.maxTrailPoints) this.trail.shift();
    }

    const margin = 1.5;
    if (
      this.col < margin ||
      this.row < margin ||
      this.col > gridSize - 1 - margin ||
      this.row > gridSize - 1 - margin
    ) {
      this.state = DRIFTER_STATE.leftDomain;
      this.endedAt = simulationTime;
    }
  }

  /** Put the drifter back where it started and clear its history. */
  reset() {
    this.col = this.startCol;
    this.row = this.startRow;
    this.velocityCol = 0;
    this.velocityRow = 0;
    this.speed = 0;
    this.depth = 0;
    this.distanceTravelled = 0;
    this.launchedAt = null;
    this.endedAt = null;
    this.state = DRIFTER_STATE.waiting;
    this.trail = [];
    this.#trailAccumulator = 0;
  }

  /**
   * Human-readable status, for the movie panel.
   *
   * @returns {string}
   */
  describeState() {
    switch (this.state) {
      case DRIFTER_STATE.waiting:
        return 'waiting for water';
      case DRIFTER_STATE.floating:
        return 'adrift';
      case DRIFTER_STATE.stranded:
        return 'grounded';
      case DRIFTER_STATE.leftDomain:
        return 'carried out of the area';
      default:
        return this.state;
    }
  }
}

/**
 * Build a sampler that reads the simulation around a point.
 *
 * Velocity is reconstructed from the solver's face fluxes exactly as the water shader
 * does it, so the raft moves with the water the user can see moving, not with a
 * separately-derived field that might differ.
 *
 * @param {import('./FloodSolver.js').FloodSolver} solver
 * @returns {(col: number, row: number) => {depth: number, vx: number, vy: number, bed: number}}
 */
export function createSolverSampler(solver) {
  return (col, row) => {
    const block = solver.readNeighbourhood(col, row);
    if (!block) return { depth: 0, vx: 0, vy: 0, bed: 0 };

    const { state, flux, bed, originCol, originRow, size } = block;

    const fc = col - originCol;
    const fr = row - originRow;
    const c0 = Math.floor(fc);
    const r0 = Math.floor(fr);
    const tx = fc - c0;
    const ty = fr - r0;

    /** Index into the block, clamped. */
    const idx = (c, r) => {
      const cc = Math.min(size - 1, Math.max(0, c));
      const rr = Math.min(size - 1, Math.max(0, r));
      return rr * size + cc;
    };

    /** Cell-centred velocity in m/s from the face fluxes around a block cell. */
    const cellVelocity = (c, r) => {
      const h = state[idx(c, r) * 4];
      if (h <= 0.001) return { vx: 0, vy: 0 };

      const qEast = flux[idx(c, r) * 4];
      const qSouth = flux[idx(c, r) * 4 + 1];
      const qWest = flux[idx(c - 1, r) * 4];
      const qNorth = flux[idx(c, r - 1) * 4 + 1];

      return {
        vx: (0.5 * (qWest + qEast)) / h,
        vy: (0.5 * (qNorth + qSouth)) / h,
      };
    };

    const bilinear = (f) => {
      const v00 = f(c0, r0);
      const v10 = f(c0 + 1, r0);
      const v01 = f(c0, r0 + 1);
      const v11 = f(c0 + 1, r0 + 1);
      return (
        v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty
      );
    };

    return {
      depth: bilinear((c, r) => state[idx(c, r) * 4]),
      bed: bilinear((c, r) => bed[idx(c, r)]),
      vx: bilinear((c, r) => cellVelocity(c, r).vx),
      vy: bilinear((c, r) => cellVelocity(c, r).vy),
    };
  };
}

/**
 * Advance a drifter across one rendered frame's worth of simulation time.
 *
 * A frame can advance the clock by a long way: six substeps at a two second timestep is
 * twelve seconds of simulation. Taking that as one integration step would run straight
 * into the per-step movement cap and make a fast raft look sluggish, so the frame is
 * split into chunks small enough that each one moves well under a cell.
 *
 * The chunking is nearly free because the solver caches its neighbourhood readback for
 * the duration of a frame, so all the chunks and their midpoint samples share one read.
 *
 * @param {Drifter} drifter
 * @param {object} params
 * @param {(col: number, row: number) => {depth: number, vx: number, vy: number, bed: number}}
 *   params.sample
 * @param {number} params.totalDt simulation seconds elapsed this frame
 * @param {number} params.cellSize metres
 * @param {number} params.gridSize
 * @param {number} params.simulationTime clock at the start of the frame
 * @param {number} [params.maxChunks=64]
 */
export function advanceDrifter(
  drifter,
  { sample, totalDt, cellSize, gridSize, simulationTime, maxChunks = 64 },
) {
  if (!drifter.active || totalDt <= 0) return;

  // Size the chunks so each one moves well under the per-step movement cap, using the
  // speed the drifter had last frame as the predictor. Getting this wrong in the
  // conservative direction is not harmless: if a chunk would move further than the cap
  // allows, the cap bites and the raft travels slower than the water it is sitting in,
  // which is a silent error in the one number the feature exists to show.
  const speedCells = Math.max(Math.hypot(drifter.velocityCol, drifter.velocityRow), 1e-4);
  const targetCellsPerChunk = 0.3;
  const chunkTarget = targetCellsPerChunk / speedCells;

  const chunks = Math.max(1, Math.min(maxChunks, Math.ceil(totalDt / chunkTarget)));
  const chunkDt = totalDt / chunks;

  for (let i = 0; i < chunks; i += 1) {
    if (!drifter.active) break;
    drifter.step({
      sample,
      dt: chunkDt,
      cellSize,
      gridSize,
      simulationTime: simulationTime + chunkDt * (i + 1),
    });
  }
}

export default Drifter;
