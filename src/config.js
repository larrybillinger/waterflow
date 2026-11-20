/**
 * Waterflow configuration and defaults.
 *
 * This file is organised by the Hydraulics Rule in AGENTS.md. Values are grouped by what
 * they actually are, so that nobody later mistakes a visual choice for physics:
 *
 *   physics      Values that change a reported number. Every one is cited in
 *                docs/hydraulics.md. Do not change these to make the picture look better.
 *   performance  Values that trade speed against fidelity. Safe to tune for the device.
 *   visual       Values that only change what the user sees. Never affects a result.
 *   defaults     Starting values for user-facing settings. The user overrides these.
 *
 * Anything a reasonable operator might want to change is exposed in the UI as well.
 * That is the Settings Rule: build the feature, expose the switch, let the operator
 * decide the policy.
 */

/** Standard gravity, m/s^2. ISO 80000-3. */
export const GRAVITY = 9.80665;

/** WGS84 semi-major axis in metres, the radius Web Mercator is defined against. */
export const EARTH_RADIUS_M = 6378137;

export const physics = {
  /**
   * CFL stability coefficient in dt = alpha * dx / sqrt(g * h_max).
   * Bates et al. (2010) recommend 0.2 to 0.7. Lower is more stable and slower.
   */
  cflAlpha: 0.5,

  /** Hard floor on the adaptive timestep, seconds. Stops a stall on a very deep pool. */
  dtMin: 0.004,

  /** Hard ceiling on the adaptive timestep, seconds. */
  dtMax: 8.0,

  /**
   * Froude number cap applied at each face. See docs/hydraulics.md section 1.4.
   * This is a stabilisation device for the supercritical near-field jet, not physics,
   * but it lives here because it does change reported velocities.
   */
  froudeMax: 1.2,

  /**
   * Depth below which a cell is treated as dry and no flux is computed, metres.
   * Standard practice in this model family. Too small and the timestep collapses on a
   * film of water; too large and the flood front advances in visible steps.
   */
  dryDepth: 0.002,

  /**
   * Distance downstream of the breach within which results are flagged as indicative,
   * expressed as a multiple of cell size. See risk R-002.
   */
  nearFieldCells: 15,
};

export const performance = {
  /** Solver substeps per rendered frame. Higher advances simulation time faster. */
  substepsPerFrame: 6,

  /** Frames between full-resolution state readbacks for the results tables. */
  readbackInterval: 30,

  /** Edge of the downsampled readback used for volume and hydrograph tracking. */
  monitorSize: 96,

  /** Maximum device pixel ratio. Above 2 the cost is real and the gain is not. */
  maxPixelRatio: 2,

  /** If a frame takes longer than this many ms, render resolution steps down. */
  frameBudgetMs: 22,

  /** Simultaneous tile fetches. Polite to the public endpoints, still fast. */
  tileConcurrency: 6,

  /** Hard cap on tiles fetched for one domain. Guards against a huge accidental request. */
  maxTilesPerLoad: 400,
};

export const visual = {
  /** Water thinner than this is not drawn at all, metres. */
  minDrawDepth: 0.02,

  /** Depth over which water fades from transparent to full opacity, metres. */
  shorelineFadeDepth: 0.35,

  /**
   * Beer-Lambert extinction coefficients per metre for R, G, B.
   * Red is absorbed fastest, which is why deep water reads blue-green.
   */
  extinction: [0.42, 0.11, 0.06],

  /** Deep water body colour before absorption. */
  waterTint: [0.08, 0.26, 0.32],

  /** Sediment colour mixed in as flow speeds up. Flood water is muddy, not blue. */
  sedimentTint: [0.38, 0.3, 0.19],

  /** Speed in m/s at which the sediment tint reaches full strength. */
  sedimentFullSpeed: 2.5,

  /** Froude number above which foam starts to appear. */
  foamFroude: 0.55,

  /** Ripple wave amplitude in metres, and base wavelength in metres. */
  rippleAmplitude: 0.05,
  rippleWavelength: 7.0,

  /** Sun position as elevation and azimuth in degrees. Azimuth is clockwise from north. */
  sunElevationDeg: 34,
  sunAzimuthDeg: 138,

  /** Exponential distance fog density. Sells the sense of scale. */
  fogDensity: 0.000042,

  /**
   * Terrain vertical exaggeration. Keep at 1.0. The UI labels the view clearly whenever
   * this is changed, because exaggerated relief makes a flood look deeper than it is.
   */
  verticalExaggeration: 1.0,
};

export const defaults = {
  /** Opening view. Tuttle Creek Lake, Kansas: a large Corps reservoir in a real valley. */
  lat: Number(import.meta.env?.VITE_DEFAULT_LAT ?? 39.2447),
  lon: Number(import.meta.env?.VITE_DEFAULT_LON ?? -96.5944),

  /** Domain edge length in metres. */
  domainMeters: Number(import.meta.env?.VITE_DEFAULT_DOMAIN_M ?? 24000),

  /** Simulation grid edge in cells. Power of two. */
  gridSize: Number(import.meta.env?.VITE_DEFAULT_GRID ?? 512),

  /** Manning's n for the whole domain. 0.045 is Chow's normal value for a flood plain
   *  with light brush and scattered trees, a reasonable generic valley floor. */
  manningN: 0.045,

  /** Station spacing down the valley, metres. */
  stationSpacing: 1000,

  /** Half-width of each cross-section, metres. */
  crossSectionHalfWidth: 1500,

  /** Breach defaults, matching the brief's "percentage of a dam failure" framing. */
  breachWidthPercent: 35,
  breachDepthPercent: 100,
  breachFormationMinutes: 60,
  breachMode: 'overtopping',
  breachProgression: 'sinusoidal',

  /** Simulation speed multiplier applied to substeps per frame. */
  speedMultiplier: 1,

  /** Imagery source key. See src/data/sources.js. */
  imagerySource: 'usgsImagery',
};

/**
 * Optional tile proxy base path. Empty means the browser fetches public tiles directly
 * from their origin. Set VITE_TILE_PROXY to "/api/tiles" to route through the bundled
 * Node server, which adds disk caching. See decision D-005.
 */
export const tileProxy = import.meta.env?.VITE_TILE_PROXY ?? '';

export default { GRAVITY, EARTH_RADIUS_M, physics, performance, visual, defaults, tileProxy };
