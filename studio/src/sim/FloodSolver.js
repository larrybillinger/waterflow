/**
 * GPU flood solver.
 *
 * Holds the simulation state in floating point render targets and advances it with
 * fragment shader passes, ping-ponging between read and write targets. See decision
 * D-002 for why this runs on the GPU and D-003 for why the breach is terrain rather
 * than an injected hydrograph.
 *
 * Per rendered frame:
 *
 *   1. Reduce the depth field to a single texel holding max depth and total volume.
 *   2. Control pass: derive the CFL timestep and advance the clock.
 *   3. For each substep: flux pass, then depth pass.
 *   4. Read the one control texel for the UI.
 *
 * The timestep lives in a texture rather than a uniform so that the substep loop never
 * has to wait on the CPU. A readback per substep would stall the pipeline and cost more
 * than the physics.
 *
 * This class uses Three.js render targets rather than raw WebGL so that its output
 * textures are ordinary THREE.Texture objects the terrain and water materials can sample
 * directly, and so renderer state never needs manual resetting.
 */

import * as THREE from 'three';

import { GRAVITY, physics, performance as perfConfig } from '../config.js';

import quadVert from './shaders/quad.vert.glsl?raw';
import bedInclude from './shaders/bed.glsl?raw';
import fluxFrag from './shaders/flux.frag.glsl?raw';
import depthFrag from './shaders/depth.frag.glsl?raw';
import reduceFrag from './shaders/reduce.frag.glsl?raw';
import controlFrag from './shaders/control.frag.glsl?raw';
import copyFrag from './shaders/copy.frag.glsl?raw';

/**
 * Resolve `#include "name.glsl"` directives.
 *
 * GLSL has no include mechanism, and the alternative is duplicating the breach geometry
 * function into two shaders where the copies would eventually diverge. Three.js has its
 * own chunk system but it is tangled up with the material library, so a four-line
 * resolver is cleaner than bending that to a GPGPU pass.
 *
 * @param {string} source
 * @param {Record<string, string>} chunks
 * @returns {string}
 */
function resolveIncludes(source, chunks) {
  return source.replace(/^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm, (_match, name) => {
    const chunk = chunks[name];
    if (chunk === undefined) {
      throw new Error(
        `Shader #include "${name}" could not be resolved. Known chunks: ` +
          `${Object.keys(chunks).join(', ')}.`,
      );
    }
    return chunk;
  });
}

const SHADER_CHUNKS = { 'bed.glsl': bedInclude };

/** Breach uniform names, shared by the flux and depth passes. */
function breachUniforms() {
  return {
    uBreachActive: { value: 0 },
    uBreachAxisOrigin: { value: new THREE.Vector2() },
    uBreachDir: { value: new THREE.Vector2(1, 0) },
    uBreachAxisLength: { value: 0 },
    uBreachCentreAlong: { value: 0 },
    uBreachHalfThickness: { value: 0 },
    uBreachBottomHalfWidth: { value: 0 },
    uBreachTopHalfWidth: { value: 0 },
    uBreachInvert: { value: 0 },
    uBreachCrest: { value: 0 },
  };
}

/**
 * Create a float render target suitable for solver state.
 *
 * Nearest filtering is required, not a preference: linear filtering between a wet cell
 * and a dry one would invent water that the mass balance never accounted for.
 *
 * @param {number} width
 * @param {number} height
 * @returns {THREE.WebGLRenderTarget}
 */
function createTarget(width, height) {
  return new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

export class FloodSolver {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} options
   * @param {number} options.gridSize cells per edge
   * @param {number} options.cellSize metres
   */
  constructor(renderer, { gridSize, cellSize }) {
    this.renderer = renderer;
    this.gridSize = gridSize;
    this.cellSize = cellSize;

    this.#assertFloatSupport();

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.state = [createTarget(gridSize, gridSize), createTarget(gridSize, gridSize)];
    this.flux = [createTarget(gridSize, gridSize), createTarget(gridSize, gridSize)];
    this.control = [createTarget(1, 1), createTarget(1, 1)];

    this.reduction = [];
    let size = gridSize;
    while (size > 1) {
      size = Math.ceil(size / 4);
      this.reduction.push(createTarget(size, size));
    }

    this.bedTexture = this.#createBedTexture();
    this.seedTexture = this.#createSeedTexture();

    this.#createMaterials();

    /** Simulation clock and diagnostics, refreshed each frame from one texel. */
    this.readout = {
      dt: 0,
      maxDepth: 0,
      simulationTime: 0,
      volume: 0,
      initialVolume: 0,
      massErrorPercent: 0,
      outflowRate: 0,
    };

    this.controlBuffer = new Float32Array(4);
    this.running = false;
    this.substeps = perfConfig.substepsPerFrame;
    this.boundaryOpen = true;
    this.manningN = 0.045;

    this.#resetTargets();
  }

  /** @returns {THREE.Texture} the live state texture: r depth, g max depth, b arrival, a max speed */
  get stateTexture() {
    return this.state[0].texture;
  }

  /** @returns {THREE.Texture} bed elevation: r current, g original */
  get bedDataTexture() {
    return this.bedTexture;
  }

  #assertFloatSupport() {
    const gl = this.renderer.getContext();
    const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

    if (!isWebGL2) {
      throw new Error(
        'Waterflow needs WebGL2 and this browser provided a WebGL1 context. The ' +
          'simulation cannot run. Chrome, Edge, Firefox and Safari 15 or newer all ' +
          'support WebGL2.',
      );
    }

    if (!gl.getExtension('EXT_color_buffer_float')) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const rendererName = debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : 'unknown renderer';
      throw new Error(
        'Waterflow needs the WebGL2 extension EXT_color_buffer_float to hold water ' +
          `depths in floating point, and this device does not provide it. Renderer ` +
          `reported: ${rendererName}. See risk R-004.`,
      );
    }
  }

  #createBedTexture() {
    const texture = new THREE.DataTexture(
      new Float32Array(this.gridSize * this.gridSize * 4),
      this.gridSize,
      this.gridSize,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  #createSeedTexture() {
    const texture = new THREE.DataTexture(
      new Float32Array(this.gridSize * this.gridSize * 4),
      this.gridSize,
      this.gridSize,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  #createMaterials() {
    const texel = new THREE.Vector2(1 / this.gridSize, 1 / this.gridSize);
    const common = {
      glslVersion: THREE.GLSL3,
      vertexShader: quadVert,
      depthTest: false,
      depthWrite: false,
    };

    this.fluxMaterial = new THREE.ShaderMaterial({
      ...common,
      fragmentShader: resolveIncludes(fluxFrag, SHADER_CHUNKS),
      uniforms: {
        uState: { value: null },
        uFlux: { value: null },
        uBed: { value: this.bedTexture },
        uControl: { value: null },
        uTexel: { value: texel },
        uGrid: { value: this.gridSize },
        uCellSize: { value: this.cellSize },
        uManningN: { value: 0.045 },
        uGravity: { value: GRAVITY },
        uFroudeMax: { value: physics.froudeMax },
        uDryDepth: { value: physics.dryDepth },
        ...breachUniforms(),
      },
    });

    this.depthMaterial = new THREE.ShaderMaterial({
      ...common,
      fragmentShader: resolveIncludes(depthFrag, SHADER_CHUNKS),
      uniforms: {
        uState: { value: null },
        uFlux: { value: null },
        uBed: { value: this.bedTexture },
        uControl: { value: null },
        uTexel: { value: texel },
        uGrid: { value: this.gridSize },
        uCellSize: { value: this.cellSize },
        uGravity: { value: GRAVITY },
        uDryDepth: { value: physics.dryDepth },
        uBoundaryOpen: { value: 1 },
        uSubstep: { value: 0 },
        uArrivalDepth: { value: Math.max(0.05, physics.dryDepth * 10) },
        ...breachUniforms(),
      },
    });

    this.reduceMaterial = new THREE.ShaderMaterial({
      ...common,
      fragmentShader: reduceFrag,
      uniforms: {
        uSource: { value: null },
        uSourceSize: { value: this.gridSize },
        uTargetSize: { value: 1 },
        uFirstPass: { value: 1 },
      },
    });

    this.controlMaterial = new THREE.ShaderMaterial({
      ...common,
      fragmentShader: controlFrag,
      uniforms: {
        uPrevControl: { value: null },
        uReduced: { value: null },
        uCellSize: { value: this.cellSize },
        uCellArea: { value: this.cellSize * this.cellSize },
        uGravity: { value: GRAVITY },
        uCflAlpha: { value: physics.cflAlpha },
        uDtMin: { value: physics.dtMin },
        uDtMax: { value: physics.dtMax },
        uSubsteps: { value: perfConfig.substepsPerFrame },
        uReset: { value: 0 },
      },
    });

    this.copyMaterial = new THREE.ShaderMaterial({
      ...common,
      fragmentShader: copyFrag,
      uniforms: { uSource: { value: null } },
    });
  }

  /**
   * Render one pass into a target.
   *
   * @param {THREE.ShaderMaterial} material
   * @param {THREE.WebGLRenderTarget} target
   */
  #pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  #resetTargets() {
    const previousClear = new THREE.Color();
    this.renderer.getClearColor(previousClear);
    const previousAlpha = this.renderer.getClearAlpha();

    // Arrival time is -1 for "never arrived", so the state targets cannot simply be
    // cleared to zero: zero would mean every dry cell was flooded at t = 0.
    this.renderer.setClearColor(0x000000, 0);
    for (const target of [...this.flux, ...this.control, ...this.reduction]) {
      this.renderer.setRenderTarget(target);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(previousClear, previousAlpha);

    this.#seedState(new Float32Array(this.gridSize * this.gridSize));
  }

  /**
   * Upload the bed elevation grid.
   *
   * @param {import('../util/grid.js').Grid} grid current ground, after any edits
   * @param {import('../util/grid.js').Grid} [original] untouched ground, for comparison
   */
  setBed(grid, original) {
    const data = this.bedTexture.image.data;
    for (let i = 0; i < grid.data.length; i += 1) {
      data[i * 4] = grid.data[i];
      data[i * 4 + 1] = original ? original.data[i] : grid.data[i];
    }
    this.bedTexture.needsUpdate = true;
  }

  /**
   * Seed the state from an initial depth field and zero the statistics.
   *
   * @param {Float32Array} depthField one value per cell, metres
   */
  #seedState(depthField) {
    const data = this.seedTexture.image.data;
    const arrivalDepth = this.depthMaterial.uniforms.uArrivalDepth.value;

    let volume = 0;
    const cellArea = this.cellSize * this.cellSize;

    for (let i = 0; i < depthField.length; i += 1) {
      const h = depthField[i] > 0 ? depthField[i] : 0;
      data[i * 4] = h;
      data[i * 4 + 1] = h;
      data[i * 4 + 2] = h > arrivalDepth ? 0 : -1;
      data[i * 4 + 3] = 0;
      volume += h;
    }
    this.seedTexture.needsUpdate = true;

    this.copyMaterial.uniforms.uSource.value = this.seedTexture;
    this.#pass(this.copyMaterial, this.state[0]);
    this.#pass(this.copyMaterial, this.state[1]);

    this.readout.initialVolume = volume * cellArea;
    this.readout.volume = this.readout.initialVolume;
    this.readout.simulationTime = 0;
    this.readout.massErrorPercent = 0;
    this.readout.outflowRate = 0;
    this.#previousVolume = this.readout.initialVolume;
    this.#previousTime = 0;
  }

  #previousVolume = 0;
  #previousTime = 0;

  /**
   * Start a run from an initial depth field.
   *
   * @param {Float32Array} depthField metres per cell
   */
  reset(depthField) {
    // Fluxes must be cleared too. Leftover momentum from a previous run would appear as
    // water moving before the breach has opened.
    this.renderer.setClearColor(0x000000, 0);
    for (const target of this.flux) {
      this.renderer.setRenderTarget(target);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setRenderTarget(null);

    this.#seedState(depthField);

    // Clock reset happens on the next control pass.
    this.controlMaterial.uniforms.uReset.value = 1;
    this.#runControlPass();
    this.controlMaterial.uniforms.uReset.value = 0;
  }

  /**
   * Update the breach geometry uniforms on both passes.
   *
   * @param {import('./dam.js').BreachGeometry} geometry
   */
  setBreach(geometry) {
    for (const material of [this.fluxMaterial, this.depthMaterial]) {
      const u = material.uniforms;
      u.uBreachActive.value = geometry.active;
      u.uBreachAxisOrigin.value.set(geometry.axisX, geometry.axisY);
      u.uBreachDir.value.set(geometry.dirX, geometry.dirY);
      u.uBreachAxisLength.value = geometry.axisLengthCells;
      u.uBreachCentreAlong.value = geometry.centreAlongCells;
      u.uBreachHalfThickness.value = geometry.halfThicknessCells;
      u.uBreachBottomHalfWidth.value = geometry.bottomHalfWidthCells;
      u.uBreachTopHalfWidth.value = geometry.topHalfWidthCells;
      u.uBreachInvert.value = geometry.invertElevation;
      u.uBreachCrest.value = geometry.crestElevation;
    }
  }

  /**
   * @param {number} n Manning's roughness coefficient
   */
  setManning(n) {
    this.manningN = n;
    this.fluxMaterial.uniforms.uManningN.value = n;
  }

  /**
   * @param {boolean} open true lets water leave the domain edges
   */
  setBoundaryOpen(open) {
    this.boundaryOpen = open;
    this.depthMaterial.uniforms.uBoundaryOpen.value = open ? 1 : 0;
  }

  /**
   * @param {number} count substeps per rendered frame
   */
  setSubsteps(count) {
    this.substeps = Math.max(1, Math.round(count));
    this.controlMaterial.uniforms.uSubsteps.value = this.substeps;
  }

  /** Reduce the depth field and update the control texel. */
  #runControlPass() {
    let source = this.state[0].texture;
    let sourceSize = this.gridSize;
    let first = true;

    for (const target of this.reduction) {
      this.reduceMaterial.uniforms.uSource.value = source;
      this.reduceMaterial.uniforms.uSourceSize.value = sourceSize;
      this.reduceMaterial.uniforms.uTargetSize.value = target.width;
      this.reduceMaterial.uniforms.uFirstPass.value = first ? 1 : 0;
      this.#pass(this.reduceMaterial, target);

      source = target.texture;
      sourceSize = target.width;
      first = false;
    }

    const reduced = this.reduction.at(-1);
    this.controlMaterial.uniforms.uPrevControl.value = this.control[0].texture;
    this.controlMaterial.uniforms.uReduced.value = reduced ? reduced.texture : null;
    this.#pass(this.controlMaterial, this.control[1]);
    this.control.reverse();
  }

  /**
   * Advance the simulation by one rendered frame.
   *
   * @returns {object} the current readout
   */
  step() {
    // Invalidates the cached neighbourhood block, since the state is about to change.
    this.#generation += 1;

    this.#runControlPass();

    const controlTexture = this.control[0].texture;

    for (let substep = 0; substep < this.substeps; substep += 1) {
      this.fluxMaterial.uniforms.uState.value = this.state[0].texture;
      this.fluxMaterial.uniforms.uFlux.value = this.flux[0].texture;
      this.fluxMaterial.uniforms.uControl.value = controlTexture;
      this.#pass(this.fluxMaterial, this.flux[1]);
      this.flux.reverse();

      this.depthMaterial.uniforms.uState.value = this.state[0].texture;
      this.depthMaterial.uniforms.uFlux.value = this.flux[0].texture;
      this.depthMaterial.uniforms.uControl.value = controlTexture;
      this.depthMaterial.uniforms.uSubstep.value = substep;
      this.#pass(this.depthMaterial, this.state[1]);
      this.state.reverse();
    }

    return this.readControl();
  }

  /**
   * Read the single control texel.
   *
   * One four-float readback per frame. That is a GPU-to-CPU synchronisation, which is
   * why it happens once per frame and not once per substep.
   *
   * @returns {object} the readout
   */
  readControl() {
    this.renderer.readRenderTargetPixels(this.control[0], 0, 0, 1, 1, this.controlBuffer);

    const [dt, maxDepth, time, volume] = this.controlBuffer;

    // The volume in the control texel was measured before this frame's substeps, so it
    // pairs with the time at the start of the frame.
    const elapsed = time - this.#previousTime;
    if (elapsed > 0) {
      // Outflow across the domain boundary, from the rate of volume loss. With closed
      // boundaries this should sit at zero, which is a useful check in itself.
      this.readout.outflowRate = (this.#previousVolume - volume) / elapsed;
      this.#previousVolume = volume;
      this.#previousTime = time;
    }

    this.readout.dt = dt;
    this.readout.maxDepth = maxDepth;
    this.readout.simulationTime = time + dt * this.substeps;
    this.readout.volume = volume;

    if (this.readout.initialVolume > 0 && this.boundaryOpen === false) {
      this.readout.massErrorPercent =
        ((volume - this.readout.initialVolume) / this.readout.initialVolume) * 100;
    } else if (this.readout.initialVolume > 0) {
      // With an open boundary, water legitimately leaves, so a raw volume comparison is
      // not a conservation test. Report the fraction still in the domain instead and let
      // the closed-boundary test in the unit suite police conservation.
      this.readout.massErrorPercent = 0;
      this.readout.retainedFraction = volume / this.readout.initialVolume;
    }

    return this.readout;
  }

  /**
   * Read a small block of the simulation around a point.
   *
   * Used by the drifters, which need depth and velocity at one fractional position each
   * frame. A 4x4 block is 256 bytes from each of two targets, which is negligible, and
   * it covers the bilinear stencil plus the face fluxes on either side of it.
   *
   * Bed elevation is taken straight from the CPU-side data texture rather than read back
   * from the GPU, because that array is already the source of truth for it.
   *
   * @param {number} col fractional grid column
   * @param {number} row fractional grid row
   * @returns {{state: Float32Array, flux: Float32Array, bed: Float32Array,
   *   originCol: number, originRow: number, size: number}|null}
   */
  readNeighbourhood(col, row) {
    const size = 8;
    const half = 3;

    // The block must include the cell to the west and north for the face fluxes, hence
    // the offset, and must stay inside the grid.
    const originCol = Math.min(
      this.gridSize - size,
      Math.max(0, Math.floor(col) - half),
    );
    const originRow = Math.min(
      this.gridSize - size,
      Math.max(0, Math.floor(row) - half),
    );

    if (this.gridSize < size) return null;

    // Reuse the cached block when the requested point is well inside it and the solver
    // has not advanced since. A drifter integrating several substeps per frame, each
    // with a midpoint sample, would otherwise cost a dozen GPU readbacks per frame for
    // data that has not changed.
    const cache = this.#blockCache;
    if (
      cache &&
      cache.generation === this.#generation &&
      col >= cache.originCol + 1 &&
      row >= cache.originRow + 1 &&
      col <= cache.originCol + size - 2 &&
      row <= cache.originRow + size - 2
    ) {
      return cache.block;
    }

    if (!this.#blockState) {
      this.#blockState = new Float32Array(size * size * 4);
      this.#blockFlux = new Float32Array(size * size * 4);
      this.#blockBed = new Float32Array(size * size);
    }

    this.renderer.readRenderTargetPixels(
      this.state[0],
      originCol,
      originRow,
      size,
      size,
      this.#blockState,
    );
    this.renderer.readRenderTargetPixels(
      this.flux[0],
      originCol,
      originRow,
      size,
      size,
      this.#blockFlux,
    );

    const bedData = this.bedTexture.image.data;
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        const source = ((originRow + r) * this.gridSize + (originCol + c)) * 4;
        this.#blockBed[r * size + c] = bedData[source];
      }
    }

    const block = {
      state: this.#blockState,
      flux: this.#blockFlux,
      bed: this.#blockBed,
      originCol,
      originRow,
      size,
    };

    this.#blockCache = { generation: this.#generation, originCol, originRow, block };
    return block;
  }

  /**
   * Read a rectangular region of the state texture.
   *
   * Used to track reservoir storage, which is a sum over the pool cells only. Reading
   * the pool's bounding box is far cheaper than a whole-grid readback, and the hydrograph
   * needs updating often enough that the difference matters.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {Float32Array} [into] reused buffer, must be at least width*height*4
   * @returns {Float32Array}
   */
  readRegion(x, y, width, height, into) {
    const buffer =
      into && into.length >= width * height * 4 ? into : new Float32Array(width * height * 4);
    this.renderer.readRenderTargetPixels(this.state[0], x, y, width, height, buffer);
    return buffer;
  }

  #blockState = null;
  #blockFlux = null;
  #blockBed = null;
  #blockCache = null;
  #generation = 0;

  /**
   * Read the full state back to the CPU.
   *
   * Four megabytes at a 512 grid, so this runs on demand and on a long interval, never
   * every frame. Arrival's -1 sentinel is converted to Infinity here so that consumers
   * can use ordinary numeric comparisons.
   *
   * @returns {{depth: import('../util/grid.js').Grid, maxDepth: import('../util/grid.js').Grid,
   *   arrival: import('../util/grid.js').Grid, maxSpeed: import('../util/grid.js').Grid}}
   */
  readState() {
    const n = this.gridSize * this.gridSize;
    const buffer = new Float32Array(n * 4);
    this.renderer.readRenderTargetPixels(
      this.state[0],
      0,
      0,
      this.gridSize,
      this.gridSize,
      buffer,
    );

    const depth = new Float32Array(n);
    const maxDepth = new Float32Array(n);
    const arrival = new Float32Array(n);
    const maxSpeed = new Float32Array(n);

    for (let i = 0; i < n; i += 1) {
      depth[i] = buffer[i * 4];
      maxDepth[i] = buffer[i * 4 + 1];
      const a = buffer[i * 4 + 2];
      arrival[i] = a < 0 ? Infinity : a;
      maxSpeed[i] = buffer[i * 4 + 3];
    }

    const shape = { width: this.gridSize, height: this.gridSize };
    return {
      depth: { data: depth, ...shape },
      maxDepth: { data: maxDepth, ...shape },
      arrival: { data: arrival, ...shape },
      maxSpeed: { data: maxSpeed, ...shape },
    };
  }

  /** Release every GPU resource this solver owns. */
  dispose() {
    for (const target of [...this.state, ...this.flux, ...this.control, ...this.reduction]) {
      target.dispose();
    }
    this.bedTexture.dispose();
    this.seedTexture.dispose();
    this.fluxMaterial.dispose();
    this.depthMaterial.dispose();
    this.reduceMaterial.dispose();
    this.controlMaterial.dispose();
    this.copyMaterial.dispose();
    this.quad.geometry.dispose();
  }
}

export default FloodSolver;
