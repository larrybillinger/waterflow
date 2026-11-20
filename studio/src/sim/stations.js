/**
 * Stations down the valley: where results are reported, and what is reported there.
 *
 * This module answers the central question in the brief: the high water marks and depths
 * at increments down the downstream valley. A station is a cross-section cut
 * perpendicular to the flow path at a measured distance downstream of the breach.
 *
 * Everything here reads the simulation's accumulated statistics. Nothing here decides
 * what the water did.
 */

import { sampleBilinear, at } from '../util/grid.js';
import { gridToLonLat } from '../data/geo.js';
import { physics } from '../config.js';

/**
 * @typedef {import('../util/grid.js').Grid} Grid
 */

/**
 * @typedef {object} Station
 * @property {number} index 1-based station number
 * @property {number} distance metres downstream along the flow path
 * @property {number} col grid column of the thalweg
 * @property {number} row grid row of the thalweg
 * @property {number} lon
 * @property {number} lat
 * @property {number} tangentX unit flow direction, grid x
 * @property {number} tangentY unit flow direction, grid y
 * @property {number} groundElevation thalweg bed elevation, m
 * @property {number} peakWaterSurface highest water surface elevation reached, m
 * @property {number} peakDepth greatest depth reached anywhere in the section, m
 * @property {number} thalwegDepth greatest depth reached at the thalweg, m
 * @property {number} floodWidth total wetted width across the section, m
 * @property {number} peakVelocity greatest speed reached in the section, m/s
 * @property {number} arrivalSeconds first arrival of water at the section, s
 * @property {boolean} nearField true when too close to the breach to trust
 * @property {Array<{offset: number, ground: number, waterSurface: number, depth: number}>} section
 */

/**
 * Local tangent direction of the path at a point, smoothed over a window.
 *
 * A single-cell D8 step is one of only eight directions, so the cross-section would
 * snap to 45 degree increments and the reported flood width would wobble. Averaging
 * over a window either side gives a smooth direction and a stable width.
 *
 * @param {Array<{col: number, row: number}>} path
 * @param {number} i index into path
 * @param {number} [window=6] cells either side
 * @returns {{x: number, y: number}} unit vector
 */
export function pathTangent(path, i, window = 6) {
  const a = path[Math.max(0, i - window)];
  const b = path[Math.min(path.length - 1, i + window)];

  let dx = b.col - a.col;
  let dy = b.row - a.row;
  const length = Math.hypot(dx, dy);

  if (length < 1e-6) {
    // Degenerate window, fall back to the immediate neighbours.
    const p = path[Math.max(0, i - 1)];
    const q = path[Math.min(path.length - 1, i + 1)];
    dx = q.col - p.col;
    dy = q.row - p.row;
    const fallback = Math.hypot(dx, dy);
    if (fallback < 1e-6) return { x: 1, y: 0 };
    return { x: dx / fallback, y: dy / fallback };
  }

  return { x: dx / length, y: dy / length };
}

/**
 * Cut a cross-section through the terrain and the flood statistics.
 *
 * Samples at half-cell spacing. Sampling finer than the grid would invent detail; coarser
 * would miss the channel.
 *
 * @param {object} params
 * @param {Grid} params.ground bed elevation
 * @param {Grid} params.maxDepth peak depth reached per cell
 * @param {Grid} params.maxSpeed peak speed reached per cell
 * @param {Grid} params.arrival arrival time per cell, seconds, Infinity where never wet
 * @param {number} params.col thalweg column
 * @param {number} params.row thalweg row
 * @param {{x: number, y: number}} params.tangent unit flow direction
 * @param {number} params.cellSize m
 * @param {number} params.halfWidth m
 * @returns {object} section samples and the aggregates derived from them
 */
export function extractCrossSection({
  ground,
  maxDepth,
  maxSpeed,
  arrival,
  col,
  row,
  tangent,
  cellSize,
  halfWidth,
}) {
  // Perpendicular to the flow direction, in grid space.
  const nx = -tangent.y;
  const ny = tangent.x;

  const step = cellSize / 2;
  const samples = Math.max(3, Math.floor((2 * halfWidth) / step) + 1);

  const section = [];
  let peakDepth = 0;
  let peakWaterSurface = -Infinity;
  let peakVelocity = 0;
  let wetSamples = 0;
  let arrivalSeconds = Infinity;

  for (let i = 0; i < samples; i += 1) {
    const offset = -halfWidth + i * step;
    const offsetCells = offset / cellSize;

    const sampleCol = col + nx * offsetCells;
    const sampleRow = row + ny * offsetCells;

    if (
      sampleCol < 0 ||
      sampleCol > ground.width - 1 ||
      sampleRow < 0 ||
      sampleRow > ground.height - 1
    ) {
      continue;
    }

    const bed = sampleBilinear(ground, sampleCol, sampleRow);
    const depth = Math.max(0, sampleBilinear(maxDepth, sampleCol, sampleRow));
    const speed = Math.max(0, sampleBilinear(maxSpeed, sampleCol, sampleRow));

    // Arrival time is sampled nearest-neighbour, not interpolated: averaging a wet
    // cell's arrival with a dry cell's Infinity is meaningless.
    const arrivalHere = at(arrival, Math.round(sampleCol), Math.round(sampleRow));

    const wet = depth > physics.dryDepth * 4;
    if (wet) {
      wetSamples += 1;
      if (depth > peakDepth) peakDepth = depth;
      if (bed + depth > peakWaterSurface) peakWaterSurface = bed + depth;
      if (speed > peakVelocity) peakVelocity = speed;
      if (Number.isFinite(arrivalHere) && arrivalHere < arrivalSeconds) {
        arrivalSeconds = arrivalHere;
      }
    }

    section.push({ offset, ground: bed, waterSurface: bed + depth, depth });
  }

  return {
    section,
    peakDepth,
    peakWaterSurface: Number.isFinite(peakWaterSurface) ? peakWaterSurface : NaN,
    peakVelocity,
    floodWidth: wetSamples * step,
    arrivalSeconds,
  };
}

/**
 * Place stations along a flow path and extract results at each.
 *
 * @param {object} params
 * @param {Array<{col: number, row: number, distance: number}>} params.path from routing.traceDownstream
 * @param {Grid} params.ground
 * @param {Grid} params.maxDepth
 * @param {Grid} params.maxSpeed
 * @param {Grid} params.arrival
 * @param {object} params.domain
 * @param {number} params.spacing metres between stations
 * @param {number} params.halfWidth cross-section half-width, metres
 * @returns {Station[]}
 */
export function buildStations({
  path,
  ground,
  maxDepth,
  maxSpeed,
  arrival,
  domain,
  spacing,
  halfWidth,
}) {
  if (!path || path.length < 2) return [];

  const { cellSize } = domain;
  const nearFieldDistance = physics.nearFieldCells * cellSize;
  const stations = [];

  let nextDistance = spacing;
  let stationIndex = 1;

  for (let i = 1; i < path.length; i += 1) {
    if (path[i].distance < nextDistance) continue;

    const point = path[i];
    const tangent = pathTangent(path, i);

    const result = extractCrossSection({
      ground,
      maxDepth,
      maxSpeed,
      arrival,
      col: point.col,
      row: point.row,
      tangent,
      cellSize,
      halfWidth,
    });

    const lonLat = gridToLonLat(domain, point.col, point.row);
    const bed = at(ground, point.col, point.row);
    const thalwegDepth = Math.max(0, at(maxDepth, point.col, point.row));

    stations.push({
      index: stationIndex,
      distance: point.distance,
      col: point.col,
      row: point.row,
      lon: lonLat.lon,
      lat: lonLat.lat,
      tangentX: tangent.x,
      tangentY: tangent.y,
      groundElevation: bed,
      peakWaterSurface: result.peakWaterSurface,
      peakDepth: result.peakDepth,
      thalwegDepth,
      floodWidth: result.floodWidth,
      peakVelocity: result.peakVelocity,
      arrivalSeconds: result.arrivalSeconds,
      nearField: point.distance < nearFieldDistance,
      section: result.section,
    });

    stationIndex += 1;
    nextDistance += spacing;
  }

  return stations;
}

/**
 * Format a duration in seconds as hours, minutes and seconds.
 *
 * Arrival times span minutes to many hours, so a single unit is always wrong somewhere.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'never';
  if (seconds < 60) return `${seconds.toFixed(0)} s`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(secs).padStart(2, '0')}s`;
}

/**
 * Export stations as CSV.
 *
 * The header carries the limitations notice and the run settings. A results file that
 * leaves the building without its assumptions attached is how an estimate gets mistaken
 * for a finding, which is risk R-005.
 *
 * @param {Station[]} stations
 * @param {object} meta run settings to record in the header
 * @returns {string} CSV text
 */
export function stationsToCsv(stations, meta) {
  const lines = [];

  lines.push('# Waterflow dam failure simulation results');
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Waterflow version: ${meta.version ?? 'unknown'}`);
  lines.push('#');
  lines.push('# NOT AN ENGINEERING OR REGULATORY PRODUCT.');
  lines.push('# These values are a screening estimate from public elevation data and a');
  lines.push('# simplified 2D hydraulic model. They are not a dam breach inundation study');
  lines.push('# and must not be used to make decisions about life or property.');
  lines.push('#');
  lines.push('# Run settings');
  lines.push(`#   Location: ${meta.lat?.toFixed(5)}, ${meta.lon?.toFixed(5)}`);
  lines.push(`#   Domain: ${meta.domainMeters} m square, ${meta.gridSize} cells`);
  lines.push(`#   Cell size: ${meta.cellSize?.toFixed(1)} m`);
  lines.push(`#   Elevation source: ${meta.elevationSource ?? 'unknown'} at zoom ${meta.zoom}`);
  lines.push(`#   Source resolution: ${meta.sourceResolution?.toFixed(1)} m per pixel`);
  lines.push(`#   Manning's n: ${meta.manningN} (single value for the whole domain)`);
  lines.push(`#   Dam crest elevation: ${meta.crestElevation?.toFixed(1)} m`);
  lines.push(`#   Dam height: ${meta.damHeight?.toFixed(1)} m`);
  lines.push(`#   Reservoir volume at failure: ${meta.reservoirVolume?.toFixed(0)} m3`);
  lines.push(`#   Breach: ${meta.breachWidthPercent}% of dam length, ${meta.breachDepthPercent}% of height`);
  lines.push(`#   Breach formation time: ${meta.breachFormationMinutes} minutes`);
  lines.push(`#   Breach progression: ${meta.breachProgression}`);
  lines.push(`#   Failure mode: ${meta.breachMode}`);
  lines.push(`#   Simulated duration: ${meta.simulatedSeconds?.toFixed(0)} s`);
  lines.push(`#   Mass balance error: ${meta.massErrorPercent?.toFixed(2)}%`);
  lines.push('#');
  lines.push('# Stations flagged near_field are within ' +
    `${physics.nearFieldCells} cells of the breach, where the local inertial ` +
    'approximation is least reliable. Treat those rows as indicative only.');
  lines.push('#');

  lines.push(
    [
      'station',
      'distance_downstream_m',
      'latitude',
      'longitude',
      'ground_elevation_m',
      'peak_water_surface_m',
      'peak_depth_m',
      'thalweg_depth_m',
      'flood_width_m',
      'peak_velocity_mps',
      'arrival_time_s',
      'arrival_time_hm',
      'near_field',
    ].join(','),
  );

  for (const s of stations) {
    lines.push(
      [
        s.index,
        s.distance.toFixed(0),
        s.lat.toFixed(6),
        s.lon.toFixed(6),
        s.groundElevation.toFixed(1),
        Number.isFinite(s.peakWaterSurface) ? s.peakWaterSurface.toFixed(1) : '',
        s.peakDepth.toFixed(1),
        s.thalwegDepth.toFixed(1),
        s.floodWidth.toFixed(0),
        s.peakVelocity.toFixed(2),
        Number.isFinite(s.arrivalSeconds) ? s.arrivalSeconds.toFixed(0) : '',
        formatDuration(s.arrivalSeconds),
        s.nearField ? 'yes' : 'no',
      ].join(','),
    );
  }

  return lines.join('\n');
}
