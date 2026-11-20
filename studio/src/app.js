/**
 * Application orchestration.
 *
 * Owns the state, the render loop and the wiring between the data layer, the solver, the
 * renderer and the interface. Everything below it is independent: the solver does not
 * know a UI exists, the UI does not know how water moves.
 *
 * Three grids, which is the thing to understand before changing anything here:
 *
 *   pristineGrid  the elevation exactly as loaded. Never modified.
 *   editedGrid    pristine plus the user's terrain edits. Owned by TerrainEditor.
 *   terrainGrid   editedGrid plus the dam embankment. What the solver and renderer read.
 *
 * Keeping the dam out of editedGrid is what makes "remove the dam" and "undo my edit"
 * independent operations rather than tangled ones.
 */

import * as THREE from 'three';

import { defaults, performance as perfConfig, visual } from './config.js';
import { initialLocation } from './data/initialLocation.js';
import { createDomain, gridToScene, formatLatLon } from './data/geo.js';
import { loadElevationGrid, createSyntheticValley } from './data/demLoader.js';
import { loadImagery } from './data/imageryLoader.js';
import { ELEVATION } from './data/sources.js';
import { cloneGrid, gridExtent, sampleBilinear, at } from './util/grid.js';

import FloodSolver from './sim/FloodSolver.js';
import {
  describeDam,
  rasterizeDam,
  breachGeometry,
  applyBreachToGrid,
  breachCentreCell,
  upstreamSide,
} from './sim/dam.js';
import {
  BREACH_METHODS,
  breachOpeningAt,
  geometryFromPercentages,
  percentagesFromGeometry,
  analyticPeakOutflow,
} from './sim/breach.js';
import { fillPool, poolToDepthField, snapToLocalMinimum, toAcreFeet } from './sim/reservoir.js';
import { priorityFloodFill, traceDownstream } from './sim/routing.js';
import { buildStations, stationsToCsv, formatDuration } from './sim/stations.js';
import Drifter, { createSolverSampler, advanceDrifter, DRIFTER_STATE } from './sim/Drifter.js';

import Viewer from './render/Viewer.js';
import TerrainEditor, { STROKE_BRUSHES } from './edit/TerrainEditor.js';
import Hud from './ui/Hud.js';

/** Legend definitions for each overlay mode. */
const LEGENDS = {
  maxDepth: {
    title: 'Maximum depth reached',
    gradient:
      'linear-gradient(90deg, #fff0 0%, #fff09b 8%, #66ccbb 40%, #2575b8 70%, #3e2a7a 100%)',
  },
  arrival: {
    title: 'Flood arrival time',
    gradient: 'linear-gradient(90deg, #d63031 0%, #fdae61 33%, #abd9e9 66%, #3159a6 100%)',
  },
  velocity: {
    title: 'Peak velocity',
    gradient:
      'linear-gradient(90deg, #fff0 0%, #fff09b 8%, #66ccbb 40%, #2575b8 70%, #3e2a7a 100%)',
  },
};

export class WaterflowApp {
  /**
   * @param {object} params
   * @param {HTMLCanvasElement} params.canvas
   * @param {HTMLElement} params.loadingElement
   * @param {string} params.version
   */
  constructor({ canvas, loadingElement, version }) {
    this.canvas = canvas;
    this.loadingElement = loadingElement;
    this.version = version;

    this.loadingBar = loadingElement.querySelector('.bar-fill');
    this.loadingStep = loadingElement.querySelector('.step');
    this.loadingError = loadingElement.querySelector('.error');

    this.viewer = new Viewer(canvas);
    this.hud = new Hud({ emit: (name, payload) => this.#handle(name, payload), version });

    // --- Domain state ---
    this.domain = null;
    this.pristineGrid = null;
    this.terrainGrid = null;
    this.editor = null;
    this.solver = null;
    this.imageryTexture = null;
    this.imageryInfo = null;

    // --- Scenario state ---
    this.dam = null;
    this.damEndpoints = null;
    this.pool = null;
    this.poolBounds = null;
    this.poolMask = null;
    this.crestElevation = 0;
    this.poolElevation = 0;

    this.breach = {
      mode: defaults.breachMode,
      widthPercent: defaults.breachWidthPercent,
      depthPercent: defaults.breachDepthPercent,
      formationMinutes: defaults.breachFormationMinutes,
      progression: defaults.breachProgression,
      centreFraction: 0.5,
    };

    this.analyticPeak = null;

    // --- Run state ---
    this.playing = false;
    this.speedMultiplier = defaults.speedMultiplier;
    this.frameCount = 0;
    this.simulationTime = 0;
    this.previousSimulationTime = 0;
    this.hydrograph = [];
    this.reservoirVolume = 0;
    this.previousReservoirSample = null;
    this.peakOutflow = 0;
    this.regionBuffer = null;

    this.stations = [];
    this.stationSpacing = defaults.stationSpacing;
    this.sectionHalfWidth = defaults.crossSectionHalfWidth;
    this.overlayMode = 'none';
    this.overlayScales = { maxDepth: 1, maxTime: 3600, maxSpeed: 1 };
    this.lastState = null;

    // --- Interaction state ---
    this.mode = 'navigate';
    this.pendingDamStart = null;
    this.pointerDown = false;
    this.strokeStart = null;
    this.hoverCell = null;

    // --- Movie state ---
    this.drifters = [];
    this.focusedDrifterId = null;
    this.cameraMode = 'free';
    this.cinematic = false;
    this.watchPoint = null;

    // --- Timing ---
    this.fpsSamples = [];
    this.lastFrameTime = performance.now();

    this.#bindPointer();
    this.#bindKeyboard();
  }

  // ===============================================================================
  // Startup
  // ===============================================================================

  /** Load the opening view and start the render loop. */
  async start() {
    this.#progress(5, 'Starting the renderer');

    try {
      const incoming=initialLocation(window.location.search,defaults);
      this.hud.controls.lat.input.value=String(incoming.lat);
      this.hud.controls.lon.input.value=String(incoming.lon);
      await this.loadDomain({
        lat: incoming.lat,
        lon: incoming.lon,
        domainMeters: defaults.domainMeters,
        gridSize: defaults.gridSize,
        imagerySource: defaults.imagerySource,
      });
    } catch (error) {
      this.#fail(error);
      return;
    }

    this.loadingElement.classList.add('done');
    setTimeout(() => {
      this.loadingElement.style.display = 'none';
    }, 600);

    this.hud.toast('Drag to pan, right-drag to orbit, scroll to zoom. Start on the Dam tab.', 5200);
    this.#loop();
  }

  #progress(percent, message) {
    if (this.loadingBar) this.loadingBar.style.width = `${percent}%`;
    if (this.loadingStep) this.loadingStep.textContent = message;
  }

  #fail(error) {
    console.error('[waterflow]', error);
    if (this.loadingError) {
      this.loadingError.textContent = error?.message ?? String(error);
      this.loadingError.style.display = 'block';
    }
    this.#progress(100, 'Could not start');
  }

  // ===============================================================================
  // Domain loading
  // ===============================================================================

  /**
   * Load elevation and imagery for an area and rebuild everything that depends on it.
   *
   * @param {object} params
   */
  async loadDomain({ lat, lon, domainMeters, gridSize, imagerySource }) {
    this.hud.setBusy('busy');
    this.playing = false;
    this.hud.setPlaying(false);

    const domain = createDomain({ lat, lon, domainMeters, gridSize });

    this.#progress(12, `Fetching ${domain.tileCount} elevation tiles at zoom ${domain.zoom}`);

    let elevation;
    let usedSynthetic = false;

    try {
      elevation = await loadElevationGrid(domain, {
        onProgress: (done, total) => {
          this.#progress(12 + (done / total) * 40, `Elevation tile ${done} of ${total}`);
        },
      });
    } catch (error) {
      // A network failure must not leave a blank screen. Fall back to a synthetic valley
      // so the physics and the interface can still be used and understood, and say so
      // plainly rather than passing it off as real terrain.
      console.warn('[waterflow] elevation unavailable, using synthetic terrain:', error);
      usedSynthetic = true;
      const grid = createSyntheticValley(gridSize, domain.cellSize);
      const extent = gridExtent(grid);
      elevation = {
        grid,
        min: extent.min,
        max: extent.max,
        failedTiles: [],
        nodataFilled: 0,
        attribution: 'Synthetic terrain, generated locally. Not real elevation data.',
        synthetic: true,
        error,
      };
    }

    this.#progress(56, 'Fetching map imagery');

    let imagery = { canvas: null, label: 'None', sourceId: 'none', attribution: '', partial: false };
    if (!usedSynthetic) {
      imagery = await loadImagery(domain, {
        preferred: imagerySource,
        onProgress: (done, total) => {
          this.#progress(56 + (done / total) * 24, `Imagery tile ${done} of ${total}`);
        },
      });
    }

    this.#progress(84, 'Building the simulation grid');

    // Release the previous domain's GPU resources before allocating the next, so two
    // full sets of float textures never exist at once.
    if (this.solver) {
      this.solver.dispose();
      this.solver = null;
    }
    if (this.imageryTexture) {
      this.imageryTexture.dispose();
      this.imageryTexture = null;
    }
    this.viewer.disposeDomain();

    this.domain = domain;
    const switchLink = this.hud.root.querySelector('.mode-switch');
    if(switchLink){
      const target=new URL('/',window.location.origin);
      target.searchParams.set('lat',lat.toFixed(5));
      target.searchParams.set('lon',lon.toFixed(5));
      switchLink.href=target.pathname+target.search;
    }
    this.pristineGrid = elevation.grid;
    this.terrainGrid = cloneGrid(elevation.grid);

    this.editor = new TerrainEditor({
      grid: cloneGrid(elevation.grid),
      cellSize: domain.cellSize,
    });

    this.solver = new FloodSolver(this.viewer.renderer, {
      gridSize: domain.gridSize,
      cellSize: domain.cellSize,
    });
    this.solver.setBed(this.terrainGrid, this.pristineGrid);
    this.solver.setManning(defaults.manningN);
    this.solver.setSubsteps(perfConfig.substepsPerFrame);

    this.viewer.setDomain({
      domain,
      elevationGrid: this.terrainGrid,
      bedTexture: this.solver.bedDataTexture,
      stateTexture: this.solver.stateTexture,
      fluxTexture: this.solver.flux[0].texture,
    });

    const extent = gridExtent(this.terrainGrid);
    this.viewer.terrain.setElevationRange(extent.min, extent.max);

    if (imagery.canvas) {
      this.imageryTexture = new THREE.CanvasTexture(imagery.canvas);
      this.imageryTexture.colorSpace = THREE.SRGBColorSpace;
      this.imageryTexture.wrapS = THREE.ClampToEdgeWrapping;
      this.imageryTexture.wrapT = THREE.ClampToEdgeWrapping;
      this.imageryTexture.minFilter = THREE.LinearMipmapLinearFilter;
      this.imageryTexture.magFilter = THREE.LinearFilter;
      this.imageryTexture.generateMipmaps = true;
      this.imageryTexture.anisotropy = Math.min(
        8,
        this.viewer.renderer.capabilities.getMaxAnisotropy(),
      );
      this.imageryTexture.needsUpdate = true;
    }
    this.viewer.setImagery(this.imageryTexture);
    this.imageryInfo = imagery;

    // Reset scenario state: a dam placed in one valley means nothing in another.
    this.dam = null;
    this.damEndpoints = null;
    this.pool = null;
    this.poolMask = null;
    this.poolBounds = null;
    this.stations = [];
    this.hydrograph = [];
    this.peakOutflow = 0;
    this.analyticPeak = null;
    this.lastState = null;
    this.drifters = [];
    this.previousReservoirSample = null;
    this.simulationTime = 0;
    this.previousSimulationTime = 0;
    this.#setMode('navigate');

    this.hud.setReservoirInfo(null, null);
    this.hud.setBreachEstimate(null);
    this.hud.setStations([]);
    this.hud.setHydrograph([], { peakReference: null });
    this.hud.setDrifters([]);
    this.hud.setSummary({});
    this.hud.setLegend(null);
    this.hud.controls.overlay.input.value = 'none';
    this.overlayMode = 'none';
    this.viewer.terrain.setOverlay('none');

    this.hud.setDataInfo({
      elevationSource: elevation.synthetic ? 'Synthetic (offline)' : ELEVATION.terrarium.label,
      zoom: domain.zoom,
      sourceResolution: domain.sourceResolution,
      tileCount: elevation.synthetic ? 0 : domain.tileCount,
      failedTiles: elevation.failedTiles.length,
      minElevation: extent.min,
      maxElevation: extent.max,
      imageryLabel: imagery.label,
    });

    this.hud.setChip('location', formatLatLon(lat, lon));
    this.hud.setChip('cell', `${domain.cellSize.toFixed(1)} m`);
    this.hud.setChip('relief', `${(extent.max - extent.min).toFixed(0)} m`);
    this.hud.setChip('reservoir', '—');
    this.hud.setChip('peak', '—');

    this.hud.setBusy('ready');
    document.documentElement.classList.toggle('synthetic-elevation', !!elevation.synthetic);
    this.#progress(100, 'Ready');

    if (elevation.synthetic) {
      this.hud.toast(
        'Elevation data could not be reached, so this is synthetic terrain. The physics ' +
          'is real; the landscape is not.',
        8000,
      );
    } else if (elevation.failedTiles.length > 0) {
      this.hud.toast(
        `${elevation.failedTiles.length} elevation tiles failed and were filled in from ` +
          'their neighbours.',
        5000,
      );
    }

    if (imagery.canvas === null && !elevation.synthetic) {
      this.hud.toast('Map imagery was unavailable. Showing relief shading instead.', 5000);
    }

    this.hud.setTab('dam');
  }

  // ===============================================================================
  // Terrain and dam
  // ===============================================================================

  /** Rebuild terrainGrid from the edited ground plus the dam, and re-upload it. */
  #rebuildTerrain() {
    this.terrainGrid.data.set(this.editor.grid.data);

    if (this.dam) {
      rasterizeDam(this.terrainGrid, this.dam, this.domain.cellSize);
    }

    this.solver.setBed(this.terrainGrid, this.pristineGrid);

    const extent = gridExtent(this.terrainGrid);
    this.viewer.terrain.setElevationRange(extent.min, extent.max);

    this.hud.setEarthworkInfo({
      cells: this.editor.editedCellCount,
      added: this.editor.earthworkVolume.added,
      removed: this.editor.earthworkVolume.removed,
      canUndo: this.editor.canUndo,
    });
  }

  /**
   * Create the dam from two grid points.
   *
   * @param {{col: number, row: number}} start
   * @param {{col: number, row: number}} end
   */
  #createDam(start, end) {
    const spanCells = Math.hypot(end.col - start.col, end.row - start.row);
    if (spanCells < 3) {
      this.hud.toast('That dam is too short. Click further apart, across the valley.');
      return;
    }

    this.damEndpoints = { start, end };

    // Describe against the edited ground, not the grid that may already hold a dam.
    const described = describeDam(this.editor.grid, start, end, {
      cellSize: this.domain.cellSize,
      crestWidth: Number(this.hud.controls.crestWidth.input.value),
    });

    this.dam = described;
    this.crestElevation = described.crestElevation;

    this.#rebuildTerrain();

    // Crest slider range: from the valley floor to a generous height above the natural
    // ridge, so the user can build higher than the terrain if they want to.
    this.hud.setCrestRange({
      min: Math.ceil(described.baseElevation + 1),
      max: Math.floor(described.crestElevation + 120),
      value: described.crestElevation,
    });

    // Default the pool to just below the crest, which is the interesting case.
    const poolDefault = described.crestElevation - Math.max(1, described.height * 0.08);
    this.#setPoolElevation(poolDefault, { updateSlider: true });

    this.#setMode('navigate');
    this.viewer.terrain.setGuideLine(start, end);

    this.hud.toast(
      `Dam placed: ${described.length.toFixed(0)} m long, ${described.height.toFixed(1)} m high.`,
    );
    this.hud.setTab('dam');
  }

  /**
   * Set the reservoir water surface elevation and refill the pool.
   *
   * @param {number} elevation
   * @param {object} [options]
   * @param {boolean} [options.updateSlider]
   */
  #setPoolElevation(elevation, { updateSlider = false } = {}) {
    if (!this.dam) return;

    this.poolElevation = elevation;

    // Seed the fill from the lowest ground just upstream of the dam's midpoint. Which
    // side is upstream is decided by comparing mean elevation either side of the axis:
    // water is impounded on the lower side.
    const seed = this.#findPoolSeed();
    if (!seed) {
      this.pool = null;
      this.poolMask = null;
      this.hud.setReservoirInfo(this.dam, null);
      return;
    }

    const pool = fillPool(
      this.terrainGrid,
      seed.col,
      seed.row,
      elevation,
      this.domain.cellSize,
    );

    this.pool = pool;
    this.poolMask = pool.mask;
    this.poolBounds = this.#maskBounds(pool.mask);

    if (updateSlider) {
      this.hud.setPoolRange({
        min: Math.ceil(this.dam.baseElevation),
        max: Math.floor(this.crestElevation),
        value: elevation,
      });
    }

    this.hud.setReservoirInfo(this.dam, {
      ...pool,
      acreFeet: toAcreFeet(pool.volume),
    });

    this.hud.setChip(
      'reservoir',
      pool.volume > 0 ? `${(pool.volume / 1e6).toFixed(1)} Mm³` : '—',
      pool.touchesEdge ? 'warn' : '',
    );

    this.#updateAnalyticPeak();
    this.resetRun();
  }

  /**
   * Find a seed cell inside the impoundment.
   *
   * Which side of the dam the reservoir forms on is decided by drainage, not by
   * elevation. See the comment on upstreamSide in src/sim/dam.js for why the obvious
   * "whichever side is lower" rule is wrong and what it does when you use it.
   *
   * The direction is found on the terrain WITHOUT the dam, because the embankment itself
   * would otherwise dominate the local slope.
   *
   * @returns {{col: number, row: number}|null}
   */
  #findPoolSeed() {
    const side = upstreamSide(this.editor.grid, this.dam, this.domain.cellSize);
    this.upstreamConfident = side.confident;

    const thalweg = this.dam.thalweg ?? {
      col: (this.dam.start.col + this.dam.end.col) / 2,
      row: (this.dam.start.row + this.dam.end.row) / 2,
    };

    // Step back from the axis far enough to clear the embankment and its batters.
    const offsetCells = Math.max(
      3,
      (this.dam.crestWidth / 2 + this.dam.height * 2.2) / this.domain.cellSize + 2,
    );

    const col = Math.round(thalweg.col + side.normalX * side.sign * offsetCells);
    const row = Math.round(thalweg.row + side.normalY * side.sign * offsetCells);

    if (col < 0 || row < 0 || col >= this.domain.gridSize || row >= this.domain.gridSize) {
      return null;
    }

    return snapToLocalMinimum(this.terrainGrid, col, row, 5);
  }

  /**
   * Bounding box of a mask, used to read reservoir storage back cheaply.
   *
   * @param {Uint8Array} mask
   * @returns {{x: number, y: number, w: number, h: number}|null}
   */
  #maskBounds(mask) {
    const n = this.domain.gridSize;
    let minCol = n;
    let minRow = n;
    let maxCol = -1;
    let maxRow = -1;

    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        if (!mask[row * n + col]) continue;
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
      }
    }

    if (maxCol < 0) return null;
    return { x: minCol, y: minRow, w: maxCol - minCol + 1, h: maxRow - minRow + 1 };
  }

  // ===============================================================================
  // Breach
  // ===============================================================================

  /** Breach geometry at the current simulation time. */
  #currentBreach() {
    if (!this.dam) return null;

    const geometry = geometryFromPercentages({
      damLength: this.dam.length,
      damHeight: this.dam.height,
      widthPercent: this.breach.widthPercent,
      depthPercent: this.breach.depthPercent,
      mode: this.breach.mode,
    });

    const opening = breachOpeningAt(this.simulationTime, {
      formationSeconds: this.breach.formationMinutes * 60,
      finalBottomWidth: geometry.bottomWidth,
      finalDepth: geometry.depth,
      crestElevation: this.crestElevation,
      sideSlope: geometry.sideSlope,
      progression: this.breach.progression,
    });

    return { geometry, opening };
  }

  /** Push the current breach geometry to the solver. */
  #updateSolverBreach() {
    if (!this.dam || !this.solver) return;

    const current = this.#currentBreach();
    if (!current) return;

    const geometry = breachGeometry(this.dam, current.opening, {
      cellSize: this.domain.cellSize,
      centreFraction: this.breach.centreFraction,
    });

    this.solver.setBreach(geometry);
    this.currentBreachGeometry = geometry;
    this.currentOpening = current.opening;
  }

  /** Recompute the analytic peak outflow cross-check. */
  #updateAnalyticPeak() {
    if (!this.dam || !this.pool || this.pool.volume <= 0) {
      this.analyticPeak = null;
      return;
    }

    const geometry = geometryFromPercentages({
      damLength: this.dam.length,
      damHeight: this.dam.height,
      widthPercent: this.breach.widthPercent,
      depthPercent: this.breach.depthPercent,
      mode: this.breach.mode,
    });

    const invert = this.crestElevation - geometry.depth;
    const head = Math.max(0, this.poolElevation - invert);

    const result = analyticPeakOutflow({
      bottomWidth: geometry.bottomWidth,
      sideSlope: geometry.sideSlope,
      initialHead: head,
    });

    this.analyticPeak = result.peakDischarge;
  }

  /** Fill the breach controls from a published regression. */
  #estimateBreach(methodId) {
    if (!this.dam || !this.pool || this.pool.volume <= 0) {
      this.hud.toast('Place a dam and fill the reservoir first.');
      return;
    }

    const method = BREACH_METHODS[methodId];
    if (!method) return;

    const breachHeight = this.dam.height;

    const estimate = method.fn({
      reservoirVolume: this.pool.volume,
      breachHeight,
      waterDepthAboveBreach: Math.max(0, this.poolElevation - this.dam.baseElevation),
      mode: this.breach.mode,
    });

    const percentages = percentagesFromGeometry({
      damLength: this.dam.length,
      damHeight: breachHeight,
      bottomWidth: estimate.bottomWidth,
      depth: breachHeight,
      sideSlope: estimate.sideSlope,
    });

    this.breach.widthPercent = Math.max(1, Math.min(100, percentages.widthPercent));
    this.breach.depthPercent = 100;
    this.breach.formationMinutes = Math.max(0, Math.round(estimate.formationSeconds / 60));

    this.hud.setBreachControls({
      widthPercent: this.breach.widthPercent,
      depthPercent: this.breach.depthPercent,
      formationMinutes: this.breach.formationMinutes,
    });

    const notes = [...estimate.notes];
    if (percentages.widthPercent > 100) {
      notes.push(
        'The predicted breach is wider than the dam you drew, so it has been capped at ' +
          'the full dam length.',
      );
    }

    this.hud.setBreachEstimate({ ...estimate, notes });
    this.#updateAnalyticPeak();
    this.resetRun();

    this.hud.toast(`${estimate.method}: breach set from the reservoir volume and dam height.`);
  }

  // ===============================================================================
  // Run control
  // ===============================================================================

  /** Return to the moment before failure. */
  resetRun() {
    if (!this.solver || !this.dam || !this.pool) return;

    this.simulationTime = 0;
    this.previousSimulationTime = 0;
    this.hydrograph = [];
    this.peakOutflow = 0;
    this.previousReservoirSample = null;
    this.lastState = null;
    this.stations = [];

    const depthField = poolToDepthField(this.terrainGrid, this.pool);
    this.solver.reset(depthField);
    this.reservoirVolume = this.pool.volume;

    this.#updateSolverBreach();

    for (const drifter of this.drifters) drifter.reset();

    this.hud.setStations([]);
    this.hud.setHydrograph([], { peakReference: this.analyticPeak, peakReferenceLabel: 'Weir estimate' });
    this.hud.setClock(0, 0);
    this.hud.setSummary({
      simulatedSeconds: 0,
      analyticPeak: this.analyticPeak,
      remaining: this.pool.volume,
      released: 0,
    });
    this.hud.setChip('peak', '—');

    // The water mesh samples whichever target the solver last wrote, so after a reset
    // the renderer has to be pointed at the current pair.
    this.viewer.water?.setSolverTextures(this.solver.stateTexture, this.solver.flux[0].texture);
    this.viewer.setDepthGrid(null);
  }

  /** Start or stop the clock. */
  togglePlay() {
    if (!this.dam || !this.pool || this.pool.volume <= 0) {
      this.hud.toast('Place a dam and fill the reservoir before running.');
      return;
    }

    this.playing = !this.playing;
    this.hud.setPlaying(this.playing);
  }

  // ===============================================================================
  // Results
  // ===============================================================================

  /** Read the solver state back and rebuild the station results. */
  recomputeResults() {
    if (!this.solver || !this.dam) return;

    const state = this.solver.readState();
    this.lastState = state;
    this.viewer.setDepthGrid(state.depth);

    // Overlay scales, so the colour ramps span the data actually present rather than an
    // arbitrary fixed range.
    const depthExtent = gridExtent(state.maxDepth);
    const speedExtent = gridExtent(state.maxSpeed);

    let maxArrival = 0;
    for (const value of state.arrival.data) {
      if (Number.isFinite(value) && value > maxArrival) maxArrival = value;
    }

    this.overlayScales = {
      maxDepth: Math.max(depthExtent.max, 0.5),
      maxSpeed: Math.max(speedExtent.max, 0.5),
      maxTime: Math.max(maxArrival, 60),
    };

    this.viewer.terrain.setOverlay(this.overlayMode, this.overlayScales);
    this.#updateLegend();

    // Downstream path on the breached terrain. Using the intact dam would make the
    // tracer stop dead at the crest.
    const breached = this.currentBreachGeometry
      ? applyBreachToGrid(this.terrainGrid, this.currentBreachGeometry)
      : this.terrainGrid;

    const filled = priorityFloodFill(breached);
    const traced = traceDownstream(filled, this.domain.cellSize, this.#traceStartCell());

    this.stations = buildStations({
      path: traced.path,
      ground: this.terrainGrid,
      maxDepth: state.maxDepth,
      maxSpeed: state.maxSpeed,
      arrival: state.arrival,
      domain: this.domain,
      spacing: this.stationSpacing,
      halfWidth: this.sectionHalfWidth,
    });

    this.hud.setStations(this.stations);

    this.viewer.stations?.setStations(this.stations, (col, row) =>
      gridToScene(this.domain, col, row),
    );

    // Flyover path for the cinematic camera.
    this.viewer.director.setFlyoverPath(
      traced.path
        .filter((_, i) => i % 4 === 0)
        .map((point) => {
          const scene = gridToScene(this.domain, point.col, point.row);
          return { x: scene.x, z: scene.z, distance: point.distance };
        }),
    );

    const wetStations = this.stations.filter((s) => s.peakDepth > 0.1);
    const furthest = wetStations.at(-1);

    this.hud.setSummary({
      simulatedSeconds: this.simulationTime,
      peakOutflow: this.peakOutflow,
      analyticPeak: this.analyticPeak,
      released: Math.max(0, this.pool.volume - this.reservoirVolume),
      remaining: this.reservoirVolume,
      furthestKm: furthest ? furthest.distance / 1000 : 0,
      stationCount: this.stations.length,
    });

    if (traced.terminated === 'left-domain' && this.stations.length > 0) {
      // Normal and worth saying: the profile stops because the area ran out.
      this.hud.tableNotice.textContent =
        'The flow path reaches the edge of the loaded area, so the profile ends there. ' +
        'Load a wider area to follow it further. Rows marked * are close to the breach, ' +
        'where the simplified momentum equation is least reliable.';
    }
  }

  /**
   * Where to start tracing the downstream path.
   *
   * Not the breach centre. Once the breach is cut, the cell at the centre of it sits at
   * the invert, which is the valley floor, and its upstream and downstream neighbours are
   * at much the same elevation. The depression-filled surface then has no strong reason
   * to prefer one, and the trace can set off upstream into the reservoir. The symptom is
   * subtle and easy to miss: the first station or two report reservoir depths and an
   * arrival time of zero, and everything past them is correct.
   *
   * So the trace starts a short way downstream of the dam, clear of the embankment
   * footprint, with the downstream direction taken from drainage rather than guessed.
   *
   * @returns {{col: number, row: number}}
   */
  #traceStartCell() {
    const centre = this.domain.gridSize / 2;

    if (!this.dam || !this.currentBreachGeometry) {
      return { col: centre, row: centre };
    }

    const breachCentre = breachCentreCell(this.currentBreachGeometry);
    const side = upstreamSide(this.editor.grid, this.dam, this.domain.cellSize);

    // Downstream is the opposite of upstream.
    const offsetCells =
      (this.dam.crestWidth / 2 + this.dam.height * 2.2) / this.domain.cellSize + 3;

    const col = breachCentre.col - side.normalX * side.sign * offsetCells;
    const row = breachCentre.row - side.normalY * side.sign * offsetCells;

    const clamp = (v) => Math.max(1, Math.min(this.domain.gridSize - 2, Math.round(v)));
    return { col: clamp(col), row: clamp(row) };
  }

  #updateLegend() {
    if (this.overlayMode === 'none') {
      this.hud.setLegend(null);
      return;
    }

    const legend = LEGENDS[this.overlayMode];
    if (!legend) {
      this.hud.setLegend(null);
      return;
    }

    let labels;
    if (this.overlayMode === 'maxDepth') {
      const max = this.overlayScales.maxDepth;
      labels = ['0 m', `${(max / 2).toFixed(1)} m`, `${max.toFixed(1)} m`];
    } else if (this.overlayMode === 'velocity') {
      const max = this.overlayScales.maxSpeed;
      labels = ['0 m/s', `${(max / 2).toFixed(1)} m/s`, `${max.toFixed(1)} m/s`];
    } else {
      const max = this.overlayScales.maxTime;
      labels = ['immediate', formatDuration(max / 2), formatDuration(max)];
    }

    this.hud.setLegend({ ...legend, labels });
  }

  /** Sample reservoir storage and append a hydrograph point. */
  #sampleOutflow() {
    if (!this.poolBounds || !this.poolMask || !this.solver) return;

    const { x, y, w, h } = this.poolBounds;
    this.regionBuffer = this.solver.readRegion(x, y, w, h, this.regionBuffer);

    const n = this.domain.gridSize;
    let depthSum = 0;

    for (let row = 0; row < h; row += 1) {
      for (let col = 0; col < w; col += 1) {
        if (!this.poolMask[(y + row) * n + (x + col)]) continue;
        depthSum += this.regionBuffer[(row * w + col) * 4];
      }
    }

    const cellArea = this.domain.cellSize * this.domain.cellSize;
    const volume = depthSum * cellArea;

    if (this.previousReservoirSample) {
      const dt = this.simulationTime - this.previousReservoirSample.time;
      if (dt > 0) {
        const discharge = Math.max(0, (this.previousReservoirSample.volume - volume) / dt);
        this.hydrograph.push({ t: this.simulationTime, q: discharge });
        if (discharge > this.peakOutflow) this.peakOutflow = discharge;

        // Keep the series to a readable length by thinning the oldest half when it grows
        // too long, which preserves the shape and the peak.
        if (this.hydrograph.length > 1400) {
          const head = this.hydrograph.slice(0, 700).filter((_, i) => i % 2 === 0);
          this.hydrograph = [...head, ...this.hydrograph.slice(700)];
        }
      }
    }

    this.previousReservoirSample = { time: this.simulationTime, volume };
    this.reservoirVolume = volume;
  }

  // ===============================================================================
  // Drifters
  // ===============================================================================

  /**
   * @param {{col: number, row: number}} cell
   * @param {string} kind
   */
  #addDrifter(cell, kind) {
    const drifter = new Drifter({ col: cell.col, row: cell.row, kind });
    this.drifters.push(drifter);
    this.viewer.drifters?.add(drifter);
    this.hud.setDrifters(this.drifters);

    if (this.focusedDrifterId === null) this.focusedDrifterId = drifter.id;

    const depth = this.lastState
      ? sampleBilinear(this.lastState.depth, cell.col, cell.row)
      : this.pool && this.poolMask?.[Math.round(cell.row) * this.domain.gridSize + Math.round(cell.col)]
        ? this.poolElevation - at(this.terrainGrid, Math.round(cell.col), Math.round(cell.row))
        : 0;

    if (depth < 0.3) {
      this.hud.toast(
        'Dropped on dry ground. It will sit there until the flood reaches it, which is ' +
          'a useful thing to watch in itself.',
        4500,
      );
    } else {
      this.hud.toast(`${drifter.label} is on the water.`);
    }
  }

  #advanceDrifters(simDelta) {
    if (simDelta <= 0 || this.drifters.length === 0) return;

    const sample = createSolverSampler(this.solver);

    for (const drifter of this.drifters) {
      if (!drifter.active) continue;
      advanceDrifter(drifter, {
        sample,
        totalDt: simDelta,
        cellSize: this.domain.cellSize,
        gridSize: this.domain.gridSize,
        simulationTime: this.previousSimulationTime,
      });
    }
  }

  /** @returns {Drifter|null} */
  #focusedDrifter() {
    if (this.focusedDrifterId === null) return null;
    return this.drifters.find((d) => d.id === this.focusedDrifterId) ?? null;
  }

  // ===============================================================================
  // Camera
  // ===============================================================================

  /**
   * @param {string} mode
   */
  #setCameraMode(mode) {
    this.cameraMode = mode;
    this.hud.setCameraMode(mode);

    if (mode === 'free') {
      if (this.viewer.director.active) {
        // Hand the pose over so the view does not cut.
        this.viewer.controls?.setPose(this.viewer.director.getPose());
        this.viewer.director.end();
      }
      return;
    }

    if ((mode === 'chase' || mode === 'onboard' || mode === 'orbit') && !this.#focusedDrifter()) {
      this.hud.toast('Drop a raft first, then this camera has something to follow.');
      this.#setCameraMode('free');
      return;
    }

    if (mode === 'watch' && !this.watchPoint) {
      this.hud.toast('Tag a watch point first.');
      this.#setCameraMode('free');
      return;
    }

    this.viewer.director.begin(mode);
  }

  #updateCamera(deltaSeconds) {
    if (!this.viewer.director.active) return;

    const drifter = this.#focusedDrifter();

    // A raft that has been carried out of the loaded area stops at the boundary, and a
    // camera riding it ends up staring off the edge of the world at empty sky. Hand
    // control back rather than leaving the user looking at nothing and wondering what
    // broke.
    const following =
      this.cameraMode === 'chase' ||
      this.cameraMode === 'onboard' ||
      this.cameraMode === 'orbit';

    if (following && drifter && drifter.state === DRIFTER_STATE.leftDomain) {
      this.#setCameraMode('free');
      this.hud.toast(
        `${drifter.label} was carried out of the loaded area. Camera released. ` +
          'Load a wider area to follow it further.',
        5000,
      );
      return;
    }

    let subject = null;
    if (drifter) {
      const scene = gridToScene(this.domain, drifter.col, drifter.row);
      const surface =
        drifter.depth > 0.01
          ? (drifter.bedElevation + drifter.depth) * visual.verticalExaggeration
          : this.viewer.sampleSurface(drifter.col, drifter.row);
      subject = new THREE.Vector3(scene.x, surface, scene.z);
    }

    let watchPoint = null;
    let watchEye = null;
    if (this.watchPoint) {
      const scene = gridToScene(this.domain, this.watchPoint.col, this.watchPoint.row);
      const surface = this.viewer.sampleSurface(this.watchPoint.col, this.watchPoint.row);
      watchPoint = new THREE.Vector3(scene.x, surface, scene.z);
      watchEye = this.watchPointEye;
    }

    this.viewer.director.update({
      deltaSeconds,
      subject,
      heading: drifter?.heading ?? 0,
      speed: drifter?.speed ?? 0,
      watchPoint,
      watchEye,
    });
  }

  // ===============================================================================
  // Interaction
  // ===============================================================================

  /**
   * @param {string} mode
   */
  #setMode(mode) {
    this.mode = mode;
    this.pendingDamStart = null;
    this.strokeStart = null;

    if (this.viewer.controls) {
      this.viewer.controls.enabled = mode === 'navigate' && !this.viewer.director.active;
    }

    this.canvas.classList.toggle('is-painting', mode !== 'navigate');

    if (mode !== 'edit') this.viewer.terrain?.setBrushCursor(null);
    if (mode !== 'place-dam' && this.damEndpoints) {
      this.viewer.terrain?.setGuideLine(this.damEndpoints.start, this.damEndpoints.end);
    }

    const prompts = {
      'place-dam': 'Click one abutment, then the other, to run a dam across the valley.',
      edit: 'Drag on the ground to shape it. Press Escape when you are finished.',
      'drop-raft': 'Click where you want the raft.',
      'set-watch': 'Click the spot you want the camera to watch.',
    };
    if (prompts[mode]) this.hud.toast(prompts[mode], 4200);
  }

  #bindPointer() {
    this.canvas.addEventListener('pointerdown', (event) => {
      if (this.mode === 'navigate') return;
      event.preventDefault();

      const hit = this.viewer.pickTerrain(event.clientX, event.clientY);
      if (!hit) return;

      this.pointerDown = true;

      if (this.mode === 'place-dam') {
        if (!this.pendingDamStart) {
          this.pendingDamStart = { col: hit.col, row: hit.row };
          this.hud.toast('Now click the other abutment.');
        } else {
          this.#createDam(this.pendingDamStart, { col: hit.col, row: hit.row });
        }
        return;
      }

      if (this.mode === 'drop-raft') {
        this.#addDrifter(
          { col: hit.col, row: hit.row },
          this.hud.controls.drifterKind.input.value,
        );
        this.#setMode('navigate');
        return;
      }

      if (this.mode === 'set-watch') {
        this.watchPoint = { col: hit.col, row: hit.row };
        const scene = gridToScene(this.domain, hit.col, hit.row);
        this.viewer.watchPoint.setPosition(scene, hit.elevation);

        // Park the watch camera a short way back and above, looking at the spot.
        const back = Math.max(this.domain.cellSize * 14, 320);
        this.watchPointEye = new THREE.Vector3(
          scene.x + back * 0.7,
          hit.elevation + back * 0.45,
          scene.z + back * 0.7,
        );

        this.#setMode('navigate');
        this.hud.toast('Watch point tagged. Choose the Watch point camera to sit on it.');
        return;
      }

      if (this.mode === 'edit') {
        const brush = this.editor.settings.brush;
        this.editor.begin(brush);
        this.editor.flattenTarget = null;

        if (STROKE_BRUSHES.has(brush)) {
          this.strokeStart = { col: hit.col, row: hit.row };
        } else {
          this.editor.apply(hit.col, hit.row, 1);
          this.#rebuildTerrain();
        }
      }
    });

    this.canvas.addEventListener('pointermove', (event) => {
      if (this.mode === 'navigate') return;

      const hit = this.viewer.pickTerrain(event.clientX, event.clientY);
      if (!hit) return;
      this.hoverCell = { col: hit.col, row: hit.row };

      if (this.mode === 'edit') {
        this.viewer.terrain?.setBrushCursor(
          hit,
          this.editor.radiusCells,
          this.#brushColour(),
        );

        if (this.pointerDown && !STROKE_BRUSHES.has(this.editor.settings.brush)) {
          // Scale by frame time so dragging slowly does not pile up more material than
          // dragging fast over the same ground.
          this.editor.apply(hit.col, hit.row, 0.35);
          this.#rebuildTerrain();
        }
      }

      if (this.mode === 'place-dam' && this.pendingDamStart) {
        this.viewer.terrain?.setGuideLine(this.pendingDamStart, hit);
      }

      if (this.mode === 'edit' && this.pointerDown && this.strokeStart) {
        this.viewer.terrain?.setGuideLine(this.strokeStart, hit);
      }
    });

    window.addEventListener('pointerup', (event) => {
      if (!this.pointerDown) return;
      this.pointerDown = false;

      if (this.mode === 'edit') {
        if (this.strokeStart) {
          const hit = this.viewer.pickTerrain(event.clientX, event.clientY);
          if (hit) {
            this.editor.applyStroke(this.strokeStart, { col: hit.col, row: hit.row });
            this.#rebuildTerrain();
          }
          this.strokeStart = null;
          this.viewer.terrain?.setGuideLine(
            this.damEndpoints?.start ?? null,
            this.damEndpoints?.end ?? null,
          );
        }

        this.editor.end();

        // The ground moved, so the pool and anything derived from it is stale.
        if (this.dam) this.#setPoolElevation(this.poolElevation);
      }
    });
  }

  #brushColour() {
    const brush = this.editor.settings.brush;
    const table = {
      raise: 0x7bf7a0,
      lower: 0xff8f6b,
      smooth: 0x9fb6ff,
      flatten: 0xffd34d,
      channel: 0x59d9ff,
      levee: 0xd79bff,
    };
    return table[brush] ?? 0x59d9ff;
  }

  #bindKeyboard() {
    window.addEventListener('keydown', (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (event.code) {
        case 'Space':
          event.preventDefault();
          this.togglePlay();
          break;
        case 'KeyR':
          // R also tilts the camera when held; only the tap resets, and only when the
          // camera is not being driven.
          if (!event.repeat && event.shiftKey) this.resetRun();
          break;
        case 'Tab':
          event.preventDefault();
          this.hud.toggleUi();
          break;
        case 'KeyC':
          this.#setCinematic(!this.cinematic);
          break;
        case 'Escape':
          if (this.mode !== 'navigate') this.#setMode('navigate');
          else if (this.cinematic) this.#setCinematic(false);
          break;
        default:
          break;
      }
    });
  }

  /**
   * @param {boolean} on
   */
  #setCinematic(on) {
    this.cinematic = on;
    const label =
      this.cameraMode === 'free'
        ? ''
        : (this.hud.cameraButtons[this.cameraMode]?.textContent ?? '');
    this.hud.setCinematic(on, label);
  }

  // ===============================================================================
  // Event handling from the HUD
  // ===============================================================================

  /**
   * @param {string} name
   * @param {object} [payload]
   */
  #handle(name, payload = {}) {
    switch (name) {
      case 'load-domain':
        this.loadDomain(payload).catch((error) => {
          console.error('[waterflow]', error);
          this.hud.setBusy('ready');
          this.hud.toast(`Could not load that area: ${error.message}`, 8000);
        });
        break;

      case 'mode-change':
        this.#setMode(payload.mode);
        break;

      case 'crest-change':
        if (!this.dam) break;
        this.crestElevation = payload.value;
        this.dam.crestElevation = payload.value;
        this.dam.height = Math.max(0, payload.value - this.dam.baseElevation);
        this.#rebuildTerrain();
        this.#setPoolElevation(Math.min(this.poolElevation, payload.value), { updateSlider: true });
        break;

      case 'crest-width-change':
        if (!this.dam) break;
        this.dam.crestWidth = payload.value;
        this.#rebuildTerrain();
        this.#setPoolElevation(this.poolElevation);
        break;

      case 'pool-change':
        this.#setPoolElevation(payload.value);
        break;

      case 'fill-to-crest':
        if (!this.dam) break;
        this.#setPoolElevation(this.crestElevation - 0.5, { updateSlider: true });
        break;

      case 'clear-dam':
        this.dam = null;
        this.damEndpoints = null;
        this.pool = null;
        this.poolMask = null;
        this.poolBounds = null;
        this.playing = false;
        this.hud.setPlaying(false);
        this.viewer.terrain?.setGuideLine(null, null);
        this.#rebuildTerrain();
        this.hud.setReservoirInfo(null, null);
        this.hud.setChip('reservoir', '—');
        this.hud.toast('Dam removed.');
        break;

      case 'breach-change':
        Object.assign(this.breach, {
          mode: payload.mode,
          widthPercent: payload.widthPercent,
          depthPercent: payload.depthPercent,
          formationMinutes: payload.formationMinutes,
          progression: payload.progression,
        });
        this.#updateAnalyticPeak();
        this.resetRun();
        break;

      case 'estimate-breach':
        this.#estimateBreach(payload.method);
        break;

      case 'manning-change':
        this.solver?.setManning(payload.n);
        break;

      case 'boundary-change':
        this.solver?.setBoundaryOpen(payload.open);
        break;

      case 'substeps-change':
        this.solver?.setSubsteps(payload.value * this.speedMultiplier);
        this.baseSubsteps = payload.value;
        break;

      case 'speed-change':
        this.speedMultiplier = payload.multiplier;
        this.solver?.setSubsteps((this.baseSubsteps ?? perfConfig.substepsPerFrame) * payload.multiplier);
        break;

      case 'toggle-play':
        this.togglePlay();
        break;

      case 'reset':
        this.resetRun();
        break;

      case 'step':
        this.#advanceSimulation();
        break;

      case 'brush-change':
        if (!this.editor) break;
        Object.assign(this.editor.settings, payload);
        if (payload.brush) this.hud.setActiveBrush(payload.brush);
        break;

      case 'undo': {
        if (!this.editor) break;
        const label = this.editor.undo();
        if (label) {
          this.#rebuildTerrain();
          if (this.dam) this.#setPoolElevation(this.poolElevation);
          this.hud.toast(`Undid: ${label}`);
        } else {
          this.hud.toast('Nothing to undo.');
        }
        break;
      }

      case 'revert':
        if (!this.editor) break;
        this.editor.revertAll();
        this.#rebuildTerrain();
        if (this.dam) this.#setPoolElevation(this.poolElevation);
        this.hud.toast('All terrain edits reverted.');
        break;

      case 'overlay-change':
        this.overlayMode = payload.mode;
        this.viewer.terrain?.setOverlay(payload.mode, this.overlayScales);
        this.#updateLegend();
        break;

      case 'stations-change':
        this.stationSpacing = payload.spacing;
        this.sectionHalfWidth = payload.halfWidth;
        if (this.lastState) this.recomputeResults();
        break;

      case 'recompute':
        this.recomputeResults();
        this.hud.toast('Results recomputed from the current state.');
        break;

      case 'export-csv':
        this.#exportCsv();
        break;

      case 'camera-mode':
        this.#setCameraMode(payload.mode);
        break;

      case 'cinematic':
        this.#setCinematic(payload.on);
        break;

      case 'drifter-clear':
        this.drifters = [];
        this.viewer.drifters?.clear();
        this.focusedDrifterId = null;
        this.hud.setDrifters([]);
        if (this.cameraMode !== 'free' && this.cameraMode !== 'watch') {
          this.#setCameraMode('free');
        }
        break;

      case 'drifter-remove': {
        this.drifters = this.drifters.filter((d) => d.id !== payload.id);
        this.viewer.drifters?.remove(payload.id);
        if (this.focusedDrifterId === payload.id) {
          this.focusedDrifterId = this.drifters[0]?.id ?? null;
        }
        this.hud.setDrifters(this.drifters);
        break;
      }

      case 'drifter-focus':
        this.focusedDrifterId = payload.id;
        if (this.cameraMode === 'free') this.#setCameraMode('chase');
        break;

      case 'raft-scale':
        if (this.viewer.drifters) this.viewer.drifters.exaggerateScale = payload.on;
        break;

      case 'fly-to-station': {
        const station = this.stations.find((s) => s.index === payload.index);
        if (!station) break;
        if (this.viewer.director.active) this.#setCameraMode('free');
        const scene = gridToScene(this.domain, station.col, station.row);
        this.viewer.controls?.flyTo(scene.x, scene.z, Math.max(this.sectionHalfWidth * 1.4, 600));
        break;
      }

      case 'sun-change':
        this.viewer.setSun(payload.elevation, payload.azimuth);
        break;

      case 'exaggeration-change':
        this.viewer.setVerticalExaggeration(payload.value);
        if (payload.value > 1.01) {
          this.hud.setChip('relief', `${payload.value.toFixed(1)}× exaggerated`, 'warn');
        } else if (this.terrainGrid) {
          const extent = gridExtent(this.terrainGrid);
          this.hud.setChip('relief', `${(extent.max - extent.min).toFixed(0)} m`);
        }
        break;

      default:
        break;
    }
  }

  #exportCsv() {
    if (this.stations.length === 0) {
      this.hud.toast('Run the simulation first, then export.');
      return;
    }

    const csv = stationsToCsv(this.stations, {
      version: this.version,
      lat: this.domain.lat,
      lon: this.domain.lon,
      domainMeters: this.domain.domainMeters,
      gridSize: this.domain.gridSize,
      cellSize: this.domain.cellSize,
      elevationSource: ELEVATION.terrarium.label,
      zoom: this.domain.zoom,
      sourceResolution: this.domain.sourceResolution,
      manningN: this.solver.manningN,
      crestElevation: this.crestElevation,
      damHeight: this.dam?.height,
      reservoirVolume: this.pool?.volume,
      breachWidthPercent: this.breach.widthPercent,
      breachDepthPercent: this.breach.depthPercent,
      breachFormationMinutes: this.breach.formationMinutes,
      breachProgression: this.breach.progression,
      breachMode: this.breach.mode,
      simulatedSeconds: this.simulationTime,
      massErrorPercent: this.solver.readout.massErrorPercent ?? 0,
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `waterflow-stations-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    this.hud.toast('Exported. The file header records the settings and the limitations.');
  }

  // ===============================================================================
  // Render loop
  // ===============================================================================

  /** Advance the solver by one frame and everything that follows from it. */
  #advanceSimulation() {
    if (!this.solver || !this.dam || !this.pool) return;

    this.previousSimulationTime = this.simulationTime;

    // The breach geometry is held constant across a frame's substeps, using the clock as
    // it stood at the start of the frame. Over a formation time of minutes and frames of
    // a few simulated seconds, that is a fraction of a percent of the opening.
    this.#updateSolverBreach();

    const readout = this.solver.step();
    this.simulationTime = readout.simulationTime;

    // Point the water mesh at the targets the solver just wrote.
    this.viewer.water?.setSolverTextures(
      this.solver.stateTexture,
      this.solver.flux[0].texture,
    );

    const simDelta = this.simulationTime - this.previousSimulationTime;
    this.#advanceDrifters(simDelta);

    this.frameCount += 1;

    // Reservoir storage every few frames gives a hydrograph with enough points to show
    // the rising limb without a readback every frame.
    if (this.frameCount % 4 === 0) this.#sampleOutflow();

    if (this.frameCount % perfConfig.readbackInterval === 0) {
      this.recomputeResults();
    }
  }

  #loop() {
    const tick = () => {
      const now = performance.now();
      const deltaSeconds = Math.min((now - this.lastFrameTime) / 1000, 0.1);
      this.lastFrameTime = now;

      if (this.playing) this.#advanceSimulation();

      this.#updateCamera(deltaSeconds);

      const frame = this.viewer.render({
        deltaSeconds,
        elapsedSeconds: now / 1000,
      });

      this.#updateReadouts(frame, deltaSeconds);

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  #updateReadouts(frame, deltaSeconds) {
    // Frame rate, averaged so the number is readable.
    this.fpsSamples.push(1 / Math.max(deltaSeconds, 0.001));
    if (this.fpsSamples.length >= 30) {
      const mean = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
      this.fpsSamples.length = 0;
      const tone = mean >= 50 ? 'good' : mean >= 30 ? '' : 'warn';
      this.hud.setChip('fps', mean.toFixed(0), tone);
    }

    if (frame.resolutionChanged) {
      this.hud.toast(
        `Render resolution adjusted to ${(this.viewer.currentPixelRatio * 100).toFixed(0)}% ` +
          'to hold the frame rate.',
        3000,
      );
    }

    if (this.dam) {
      const fraction = this.currentOpening?.fraction ?? 0;
      this.hud.setClock(this.simulationTime, fraction);
    }

    if (this.peakOutflow > 0) {
      this.hud.setChip('peak', `${Math.round(this.peakOutflow).toLocaleString()} m³/s`);
    }

    if (this.playing && this.frameCount % 10 === 0) {
      this.hud.setHydrograph(this.hydrograph, {
        peakReference: this.analyticPeak,
        peakReferenceLabel: 'Weir estimate',
      });
      this.hud.setDrifters(this.drifters);

      this.hud.setSummary({
        simulatedSeconds: this.simulationTime,
        peakOutflow: this.peakOutflow,
        analyticPeak: this.analyticPeak,
        released: Math.max(0, (this.pool?.volume ?? 0) - this.reservoirVolume),
        remaining: this.reservoirVolume,
        furthestKm:
          this.stations.filter((s) => s.peakDepth > 0.1).at(-1)?.distance / 1000 ?? 0,
        stationCount: this.stations.length,
      });
    }

    if (this.cinematic) {
      const drifter = this.#focusedDrifter();
      if (drifter && drifter.state === DRIFTER_STATE.floating) {
        this.hud.cinemaShot.textContent =
          `${this.hud.cameraButtons[this.cameraMode]?.textContent ?? ''}  ·  ` +
          `${drifter.speed.toFixed(1)} m/s  ·  ${(drifter.distanceTravelled / 1000).toFixed(2)} km`;
      }
    }
  }
}

export default WaterflowApp;
