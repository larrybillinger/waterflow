/**
 * Manning's roughness coefficients.
 *
 * Source: Chow, V. T. (1959). Open-Channel Hydraulics. McGraw-Hill, Table 5-6.
 * Cross-checked against Arcement, G. J., & Schneider, V. R. (1989). Guide for Selecting
 * Manning's Roughness Coefficients for Natural Channels and Flood Plains.
 * U.S. Geological Survey Water-Supply Paper 2339.
 *
 * Each entry carries minimum, normal and maximum, because the spread is part of the
 * information. A flood plain with heavy timber can reasonably be anything from 0.08 to
 * 0.20, and a tool that offers only one number hides how much that choice matters.
 *
 * Units are s/m^(1/3). Manning's n is dimensionally awkward and the SI form of the
 * Manning equation carries no unit conversion factor, which is why this app is SI
 * throughout.
 *
 * Roughness is a single domain-wide value in v0.1.0. See open question Q-002 on whether
 * to derive it per cell from a land cover raster.
 */

/**
 * @typedef {object} RoughnessEntry
 * @property {string} id
 * @property {string} label
 * @property {number} min
 * @property {number} normal
 * @property {number} max
 * @property {string} group
 */

/** @type {RoughnessEntry[]} */
export const ROUGHNESS_TABLE = [
  // --- Natural stream channels ---
  {
    id: 'channel-clean-straight',
    label: 'Stream, clean and straight',
    min: 0.025,
    normal: 0.03,
    max: 0.033,
    group: 'Channel',
  },
  {
    id: 'channel-winding-pools',
    label: 'Stream, winding with pools and shoals',
    min: 0.033,
    normal: 0.04,
    max: 0.045,
    group: 'Channel',
  },
  {
    id: 'channel-weedy-stony',
    label: 'Stream, weedy with deep pools or stony bed',
    min: 0.045,
    normal: 0.05,
    max: 0.06,
    group: 'Channel',
  },
  {
    id: 'channel-mountain-cobbles',
    label: 'Mountain stream, cobbles and boulders',
    min: 0.04,
    normal: 0.05,
    max: 0.07,
    group: 'Channel',
  },

  // --- Flood plains ---
  {
    id: 'plain-short-grass',
    label: 'Flood plain, pasture with short grass',
    min: 0.025,
    normal: 0.03,
    max: 0.035,
    group: 'Flood plain',
  },
  {
    id: 'plain-high-grass',
    label: 'Flood plain, pasture with high grass',
    min: 0.03,
    normal: 0.035,
    max: 0.05,
    group: 'Flood plain',
  },
  {
    id: 'plain-cultivated',
    label: 'Flood plain, cultivated with mature crops',
    min: 0.03,
    normal: 0.04,
    max: 0.05,
    group: 'Flood plain',
  },
  {
    id: 'plain-scattered-brush',
    label: 'Flood plain, scattered brush and heavy weeds',
    min: 0.035,
    normal: 0.05,
    max: 0.07,
    group: 'Flood plain',
  },
  {
    id: 'plain-light-brush-trees',
    label: 'Flood plain, light brush and trees',
    min: 0.04,
    normal: 0.06,
    max: 0.08,
    group: 'Flood plain',
  },
  {
    id: 'plain-heavy-timber',
    label: 'Flood plain, heavy stand of timber',
    min: 0.08,
    normal: 0.1,
    max: 0.12,
    group: 'Flood plain',
  },
  {
    id: 'plain-dense-willows',
    label: 'Flood plain, dense willows',
    min: 0.11,
    normal: 0.15,
    max: 0.2,
    group: 'Flood plain',
  },

  // --- Constructed and bare surfaces ---
  {
    id: 'surface-concrete',
    label: 'Concrete, smooth finish',
    min: 0.011,
    normal: 0.013,
    max: 0.015,
    group: 'Surface',
  },
  {
    id: 'surface-asphalt',
    label: 'Asphalt',
    min: 0.013,
    normal: 0.015,
    max: 0.017,
    group: 'Surface',
  },
  {
    id: 'surface-earth-clean',
    label: 'Earth channel, clean',
    min: 0.018,
    normal: 0.022,
    max: 0.025,
    group: 'Surface',
  },
  {
    id: 'surface-gravel',
    label: 'Gravel bed',
    min: 0.022,
    normal: 0.025,
    max: 0.03,
    group: 'Surface',
  },
];

/** Default used when nothing is chosen: a generic vegetated valley floor. */
export const DEFAULT_ROUGHNESS_ID = 'plain-scattered-brush';

/**
 * Look up a roughness entry by id.
 *
 * @param {string} id
 * @returns {RoughnessEntry|undefined}
 */
export function getRoughness(id) {
  return ROUGHNESS_TABLE.find((entry) => entry.id === id);
}

/**
 * Group the table for a grouped select element.
 *
 * @returns {Map<string, RoughnessEntry[]>}
 */
export function groupedRoughness() {
  const groups = new Map();
  for (const entry of ROUGHNESS_TABLE) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  return groups;
}

/**
 * Steady uniform flow depth for a given unit discharge, from the Manning equation.
 *
 * For wide shallow flow the hydraulic radius is approximated by the depth, so
 *
 *   q = (1 / n) * h^(5/3) * S^(1/2)
 *
 * inverted to
 *
 *   h = (q * n / sqrt(S))^(3/5)
 *
 * This is used only for the UI's normal-depth readout, as a sanity reference against the
 * simulated depth at a station. It is not part of the solver.
 *
 * @param {number} unitDischarge m^2/s
 * @param {number} manningN s/m^(1/3)
 * @param {number} slope dimensionless, must be positive
 * @returns {number} normal depth in metres, or NaN for a non-positive slope
 */
export function normalDepth(unitDischarge, manningN, slope) {
  if (!(slope > 0) || !(unitDischarge > 0)) return NaN;
  return Math.pow((unitDischarge * manningN) / Math.sqrt(slope), 0.6);
}
