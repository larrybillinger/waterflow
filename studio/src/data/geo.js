/**
 * Web Mercator geography and tile indexing.
 *
 * All functions here are pure and unit tested in tests/geo.test.js. They are the
 * foundation everything else stands on, so a mistake here is a mistake everywhere.
 *
 * Coordinate systems in play:
 *
 *   lon / lat        WGS84 degrees, what the user types.
 *   mercator x / y   EPSG:3857 metres. Note these are NOT true ground metres: at
 *                    latitude phi, one Mercator metre is cos(phi) true ground metres.
 *   pixel x / y      Tile pixels at a given zoom. Origin top-left of the world.
 *   tile x / y       Tile indices at a given zoom. Origin top-left.
 *   grid col / row   Simulation grid cells. Origin top-left, row 0 is the north edge.
 *
 * The Mercator scale factor is the one thing that is easy to get wrong. Waterflow
 * handles it by treating cos(latitude) as constant across the domain, evaluated at the
 * domain centre. Over a 24 km domain at mid-latitude the latitude span is about 0.22
 * degrees and the scale factor varies by under 0.3 percent, which is far below the
 * accuracy of the elevation data. This approximation is documented and deliberate.
 */

import { EARTH_RADIUS_M } from '../config.js';

/** Half the circumference, the Mercator extent in each direction. */
export const MERCATOR_EXTENT = Math.PI * EARTH_RADIUS_M;

/** Mercator metres per tile pixel at zoom 0 with 256 px tiles. */
export const BASE_RESOLUTION = (2 * MERCATOR_EXTENT) / 256;

/** Latitude beyond which Mercator y runs away to infinity. */
export const MAX_MERCATOR_LAT = 85.05112877980659;

const DEG = Math.PI / 180;

/**
 * Clamp a value into a range.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Longitude and latitude in degrees to Web Mercator metres.
 *
 * @param {number} lon degrees east
 * @param {number} lat degrees north
 * @returns {{x: number, y: number}} Mercator metres, y positive north
 */
export function lonLatToMercator(lon, lat) {
  const clampedLat = clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
  const x = EARTH_RADIUS_M * lon * DEG;
  const y = EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (clampedLat * DEG) / 2));
  return { x, y };
}

/**
 * Web Mercator metres back to longitude and latitude in degrees.
 *
 * @param {number} x Mercator metres east
 * @param {number} y Mercator metres north
 * @returns {{lon: number, lat: number}}
 */
export function mercatorToLonLat(x, y) {
  const lon = (x / EARTH_RADIUS_M) / DEG;
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) / DEG;
  return { lon, lat };
}

/**
 * Mercator metres per tile pixel at a zoom level. This is not ground resolution;
 * multiply by cos(latitude) for that.
 *
 * @param {number} zoom
 * @param {number} [tileSize=256]
 * @returns {number} Mercator metres per pixel
 */
export function mercatorResolution(zoom, tileSize = 256) {
  return (2 * MERCATOR_EXTENT) / (tileSize * Math.pow(2, zoom));
}

/**
 * True ground metres per tile pixel at a zoom level and latitude.
 *
 * @param {number} zoom
 * @param {number} lat degrees north
 * @param {number} [tileSize=256]
 * @returns {number} ground metres per pixel
 */
export function groundResolution(zoom, lat, tileSize = 256) {
  return mercatorResolution(zoom, tileSize) * Math.cos(clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT) * DEG);
}

/**
 * The Mercator scale factor at a latitude. One Mercator metre equals this many true
 * ground metres.
 *
 * @param {number} lat degrees north
 * @returns {number} dimensionless, always <= 1
 */
export function mercatorScaleFactor(lat) {
  return Math.cos(clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT) * DEG);
}

/**
 * Mercator metres to world pixel coordinates at a zoom level. Pixel origin is the
 * top-left of the world, y increasing south, which is the slippy map convention.
 *
 * @param {number} x Mercator metres east
 * @param {number} y Mercator metres north
 * @param {number} zoom
 * @param {number} [tileSize=256]
 * @returns {{px: number, py: number}}
 */
export function mercatorToPixel(x, y, zoom, tileSize = 256) {
  const res = mercatorResolution(zoom, tileSize);
  return {
    px: (x + MERCATOR_EXTENT) / res,
    py: (MERCATOR_EXTENT - y) / res,
  };
}

/**
 * World pixel coordinates back to Mercator metres.
 *
 * @param {number} px
 * @param {number} py
 * @param {number} zoom
 * @param {number} [tileSize=256]
 * @returns {{x: number, y: number}}
 */
export function pixelToMercator(px, py, zoom, tileSize = 256) {
  const res = mercatorResolution(zoom, tileSize);
  return {
    x: px * res - MERCATOR_EXTENT,
    y: MERCATOR_EXTENT - py * res,
  };
}

/**
 * Choose the tile zoom level for a target simulation cell size.
 *
 * The aim is to fetch tiles slightly finer than the simulation grid, so that
 * downsampling averages several source pixels per cell. That antialiases ridge lines
 * instead of point-sampling them, which matters because a point-sampled ridge can be
 * metres too high or too low and that changes where water goes.
 *
 * Fetching much finer than needed is waste: every extra zoom level quadruples the tile
 * count. The supersample target balances the two.
 *
 * @param {number} cellSizeMeters target simulation cell size in true ground metres
 * @param {number} lat domain centre latitude
 * @param {object} [options]
 * @param {number} [options.supersample=2] source pixels wanted per grid cell edge
 * @param {number} [options.minZoom=6]
 * @param {number} [options.maxZoom=15]
 * @param {number} [options.tileSize=256]
 * @returns {number} integer zoom level
 */
export function pickZoomForCellSize(cellSizeMeters, lat, options = {}) {
  const { supersample = 2, minZoom = 6, maxZoom = 15, tileSize = 256 } = options;
  const targetRes = cellSizeMeters / supersample;

  for (let z = minZoom; z <= maxZoom; z += 1) {
    if (groundResolution(z, lat, tileSize) <= targetRes) return z;
  }
  return maxZoom;
}

/**
 * Build the full description of a square simulation domain.
 *
 * The domain is square in true ground metres, centred on the given point. Because
 * Mercator stretches north-south by 1/cos(lat), a square ground area is a square
 * Mercator area of side domainMeters / cos(lat).
 *
 * @param {object} params
 * @param {number} params.lat centre latitude, degrees
 * @param {number} params.lon centre longitude, degrees
 * @param {number} params.domainMeters edge length in true ground metres
 * @param {number} params.gridSize simulation grid edge in cells
 * @param {number} [params.zoom] force a tile zoom; otherwise chosen automatically
 * @param {number} [params.tileSize=256]
 * @returns {object} domain description
 */
export function createDomain({ lat, lon, domainMeters, gridSize, zoom, tileSize = 256 }) {
  const scale = mercatorScaleFactor(lat);
  const cellSize = domainMeters / gridSize;

  const z = zoom ?? pickZoomForCellSize(cellSize, lat, { tileSize });

  const centre = lonLatToMercator(lon, lat);
  const halfMercator = domainMeters / 2 / scale;

  const mercatorBounds = {
    minX: centre.x - halfMercator,
    maxX: centre.x + halfMercator,
    minY: centre.y - halfMercator,
    maxY: centre.y + halfMercator,
  };

  // Pixel window at the chosen zoom. py is inverted, so maxY maps to the smaller py.
  const topLeft = mercatorToPixel(mercatorBounds.minX, mercatorBounds.maxY, z, tileSize);
  const bottomRight = mercatorToPixel(mercatorBounds.maxX, mercatorBounds.minY, z, tileSize);

  const tileRange = {
    minX: Math.floor(topLeft.px / tileSize),
    maxX: Math.floor((bottomRight.px - 1e-9) / tileSize),
    minY: Math.floor(topLeft.py / tileSize),
    maxY: Math.floor((bottomRight.py - 1e-9) / tileSize),
  };

  const tileCountX = tileRange.maxX - tileRange.minX + 1;
  const tileCountY = tileRange.maxY - tileRange.minY + 1;

  const sw = mercatorToLonLat(mercatorBounds.minX, mercatorBounds.minY);
  const ne = mercatorToLonLat(mercatorBounds.maxX, mercatorBounds.maxY);

  return {
    lat,
    lon,
    domainMeters,
    gridSize,
    cellSize,
    zoom: z,
    tileSize,
    mercatorScale: scale,
    mercatorBounds,
    /** Pixel window of the domain within the world pixel grid at this zoom. */
    pixelBounds: {
      minPx: topLeft.px,
      minPy: topLeft.py,
      maxPx: bottomRight.px,
      maxPy: bottomRight.py,
    },
    tileRange,
    tileCountX,
    tileCountY,
    tileCount: tileCountX * tileCountY,
    /** Ground resolution of the source tiles, for honest reporting in the UI. */
    sourceResolution: groundResolution(z, lat, tileSize),
    bboxLonLat: { west: sw.lon, south: sw.lat, east: ne.lon, north: ne.lat },
  };
}

/**
 * Grid cell centre to longitude and latitude.
 *
 * Column 0 is the west edge, row 0 is the north edge, matching texture and array order.
 *
 * @param {object} domain from createDomain
 * @param {number} col fractional column index
 * @param {number} row fractional row index
 * @returns {{lon: number, lat: number}}
 */
export function gridToLonLat(domain, col, row) {
  const { mercatorBounds, gridSize } = domain;
  const fx = (col + 0.5) / gridSize;
  const fy = (row + 0.5) / gridSize;
  const x = mercatorBounds.minX + fx * (mercatorBounds.maxX - mercatorBounds.minX);
  const y = mercatorBounds.maxY - fy * (mercatorBounds.maxY - mercatorBounds.minY);
  return mercatorToLonLat(x, y);
}

/**
 * Longitude and latitude to fractional grid coordinates. Values outside [0, gridSize)
 * mean the point is outside the domain, which the caller should check.
 *
 * @param {object} domain from createDomain
 * @param {number} lon
 * @param {number} lat
 * @returns {{col: number, row: number}}
 */
export function lonLatToGrid(domain, lon, lat) {
  const { mercatorBounds, gridSize } = domain;
  const m = lonLatToMercator(lon, lat);
  const fx = (m.x - mercatorBounds.minX) / (mercatorBounds.maxX - mercatorBounds.minX);
  const fy = (mercatorBounds.maxY - m.y) / (mercatorBounds.maxY - mercatorBounds.minY);
  return { col: fx * gridSize - 0.5, row: fy * gridSize - 0.5 };
}

/**
 * Local scene metres from a grid cell. The renderer places the domain centred on the
 * origin with x east and z south, which is Three.js's right-handed convention with y up.
 *
 * @param {object} domain
 * @param {number} col
 * @param {number} row
 * @returns {{x: number, z: number}} scene metres
 */
export function gridToScene(domain, col, row) {
  const { cellSize, gridSize } = domain;
  const half = (gridSize * cellSize) / 2;
  return {
    x: (col + 0.5) * cellSize - half,
    z: (row + 0.5) * cellSize - half,
  };
}

/**
 * Grid coordinates from local scene metres. Inverse of gridToScene.
 *
 * @param {object} domain
 * @param {number} x scene metres east
 * @param {number} z scene metres south
 * @returns {{col: number, row: number}} fractional grid coordinates
 */
export function sceneToGrid(domain, x, z) {
  const { cellSize, gridSize } = domain;
  const half = (gridSize * cellSize) / 2;
  return {
    col: (x + half) / cellSize - 0.5,
    row: (z + half) / cellSize - 0.5,
  };
}

/**
 * Format a latitude and longitude for display in degrees, minutes, seconds.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function formatLatLon(lat, lon) {
  const fmt = (value, posChar, negChar) => {
    const hemisphere = value >= 0 ? posChar : negChar;
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = (minFloat - min) * 60;
    return `${deg}°${String(min).padStart(2, '0')}'${sec.toFixed(1).padStart(4, '0')}"${hemisphere}`;
  };
  return `${fmt(lat, 'N', 'S')} ${fmt(lon, 'E', 'W')}`;
}
