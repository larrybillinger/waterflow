/**
 * CPU reference implementation of the local inertial solver.
 *
 * This exists so the scheme in the shaders can be tested. A fragment shader cannot be
 * unit tested in Node, but the equations can, and the equations are the part that would
 * be wrong in a way nobody notices. The shaders and this file implement the same maths
 * from the same source, so a bug in the equations shows up here.
 *
 * Deliberately a direct, slow transcription of src/sim/shaders/flux.frag.glsl and
 * depth.frag.glsl. Readability against the shader matters more than speed: if the two
 * stop looking alike, the test stops being worth anything.
 *
 * Conventions match the shaders exactly:
 *   index  = row * size + col
 *   qx[i]  = unit discharge across cell i's EAST face, positive east
 *   qy[i]  = unit discharge across cell i's SOUTH face, positive south
 */

import { GRAVITY, physics } from '../../src/config.js';

export class CpuFloodSolver {
  /**
   * @param {object} params
   * @param {Float32Array} params.bed elevation per cell
   * @param {number} params.size grid edge in cells
   * @param {number} params.cellSize metres
   * @param {number} [params.manningN]
   * @param {boolean} [params.boundaryOpen]
   */
  constructor({ bed, size, cellSize, manningN = 0.045, boundaryOpen = false }) {
    this.bed = bed;
    this.size = size;
    this.cellSize = cellSize;
    this.manningN = manningN;
    this.boundaryOpen = boundaryOpen;

    const n = size * size;
    this.depth = new Float32Array(n);
    this.qx = new Float32Array(n);
    this.qy = new Float32Array(n);

    this.time = 0;
  }

  /** @param {Float32Array} depthField */
  setDepth(depthField) {
    this.depth.set(depthField);
  }

  /** Total water volume in the domain, m^3. */
  volume() {
    let sum = 0;
    for (let i = 0; i < this.depth.length; i += 1) sum += this.depth[i];
    return sum * this.cellSize * this.cellSize;
  }

  /** Greatest depth anywhere, m. */
  maxDepth() {
    let max = 0;
    for (let i = 0; i < this.depth.length; i += 1) {
      if (this.depth[i] > max) max = this.depth[i];
    }
    return max;
  }

  /** The adaptive timestep, from the CFL condition in control.frag.glsl. */
  timestep() {
    const cflDepth = Math.max(this.maxDepth(), 0.01);
    const dt = (physics.cflAlpha * this.cellSize) / Math.sqrt(GRAVITY * cflDepth);
    return Math.min(Math.max(dt, physics.dtMin), physics.dtMax);
  }

  /**
   * One face. A direct transcription of faceFlux in flux.frag.glsl.
   *
   * @param {number} qOld
   * @param {number} hA
   * @param {number} zA
   * @param {number} hB
   * @param {number} zB
   * @param {number} dt
   * @returns {number}
   */
  faceFlux(qOld, hA, zA, hB, zB, dt) {
    const wseA = zA + hA;
    const wseB = zB + hB;

    const hflow = Math.max(wseA, wseB) - Math.max(zA, zB);
    if (hflow <= physics.dryDepth) return 0;

    const slope = (wseB - wseA) / this.cellSize;

    const numerator = qOld - GRAVITY * dt * hflow * slope;
    const denominator =
      1 +
      (GRAVITY * dt * this.manningN * this.manningN * Math.abs(qOld)) /
        Math.pow(hflow, 7 / 3);
    let q = numerator / denominator;

    const froude = Math.abs(q) / hflow / Math.sqrt(GRAVITY * hflow);
    if (froude > physics.froudeMax) {
      q = Math.sign(q) * physics.froudeMax * hflow * Math.sqrt(GRAVITY * hflow);
    }

    const limit = dt > 0 ? this.cellSize / (dt * 4) : 0;
    if (q > 0) q = Math.min(q, hA * limit);
    else q = Math.max(q, -hB * limit);

    return q;
  }

  /** Outflow across a domain edge, from edgeOutflow in depth.frag.glsl. */
  edgeOutflow(h, outwardSign) {
    if (!this.boundaryOpen) return 0;
    if (h <= physics.dryDepth) return 0;
    return outwardSign * h * Math.sqrt(GRAVITY * h);
  }

  /**
   * Advance one timestep.
   *
   * @param {number} [dtOverride]
   * @returns {number} the timestep used
   */
  step(dtOverride) {
    const dt = dtOverride ?? this.timestep();
    const { size } = this;

    // --- Momentum pass -------------------------------------------------------------
    const nextQx = new Float32Array(this.qx.length);
    const nextQy = new Float32Array(this.qy.length);

    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const i = row * size + col;

        if (col < size - 1) {
          const j = i + 1;
          nextQx[i] = this.faceFlux(
            this.qx[i],
            this.depth[i],
            this.bed[i],
            this.depth[j],
            this.bed[j],
            dt,
          );
        }

        if (row < size - 1) {
          const j = i + size;
          nextQy[i] = this.faceFlux(
            this.qy[i],
            this.depth[i],
            this.bed[i],
            this.depth[j],
            this.bed[j],
            dt,
          );
        }
      }
    }

    this.qx = nextQx;
    this.qy = nextQy;

    // --- Continuity pass -----------------------------------------------------------
    const nextDepth = new Float32Array(this.depth.length);

    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const i = row * size + col;
        const h = this.depth[i];

        const qEast = col > size - 2 ? this.edgeOutflow(h, 1) : this.qx[i];
        const qSouth = row > size - 2 ? this.edgeOutflow(h, 1) : this.qy[i];
        const qWest = col < 1 ? this.edgeOutflow(h, -1) : this.qx[i - 1];
        const qNorth = row < 1 ? this.edgeOutflow(h, -1) : this.qy[i - size];

        const dh = (dt / this.cellSize) * (qWest - qEast + qNorth - qSouth);
        nextDepth[i] = Math.max(0, h + dh);
      }
    }

    this.depth = nextDepth;
    this.time += dt;
    return dt;
  }

  /**
   * Run until the simulation clock passes a target, with a step cap so a bug cannot
   * hang the test suite.
   *
   * @param {number} seconds
   * @param {number} [maxSteps=200000]
   * @returns {number} steps taken
   */
  run(seconds, maxSteps = 200000) {
    const target = this.time + seconds;
    let steps = 0;
    while (this.time < target && steps < maxSteps) {
      this.step();
      steps += 1;
    }
    return steps;
  }

  /** Water surface elevation per cell, for assertions about equilibrium. */
  waterSurface() {
    const wse = new Float32Array(this.depth.length);
    for (let i = 0; i < wse.length; i += 1) {
      wse[i] = this.depth[i] > physics.dryDepth ? this.bed[i] + this.depth[i] : NaN;
    }
    return wse;
  }
}

/**
 * A flat-bottomed square basin surrounded by high walls.
 *
 * @param {number} size
 * @param {number} wallHeight
 * @returns {Float32Array}
 */
export function createBasin(size, wallHeight = 100) {
  const bed = new Float32Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const onEdge = col === 0 || row === 0 || col === size - 1 || row === size - 1;
      bed[row * size + col] = onEdge ? wallHeight : 0;
    }
  }
  return bed;
}

/**
 * A plane tilted downward toward increasing row, which is south.
 *
 * @param {number} size
 * @param {number} cellSize
 * @param {number} slope rise over run
 * @param {number} [top=100] elevation at row 0
 * @returns {Float32Array}
 */
export function createSlope(size, cellSize, slope, top = 100) {
  const bed = new Float32Array(size * size);
  for (let row = 0; row < size; row += 1) {
    const z = top - row * cellSize * slope;
    for (let col = 0; col < size; col += 1) {
      bed[row * size + col] = z;
    }
  }
  return bed;
}
