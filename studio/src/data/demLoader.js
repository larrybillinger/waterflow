/**
 * Elevation grid loading.
 *
 * Fetches the Terrarium tiles covering a domain, stitches them into one raster, decodes
 * them to metres, fills any nodata, and resamples to the simulation grid.
 *
 * Error handling follows the Logging Rule in AGENTS.md: a failure names the tile, the URL
 * and the HTTP status, because "could not load terrain" tells the operator nothing.
 */

import { ELEVATION, tileUrl } from './sources.js';
import { decodeTerrariumBuffer, fillNodata } from './terrarium.js';
import { createGrid, resampleWindow, gridExtent } from '../util/grid.js';
import { performance as perfConfig } from '../config.js';

/**
 * Load one image with CORS enabled so its pixels can be read back.
 *
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new Error(
          `Tile request failed: ${url}\n` +
            'The browser could not load this tile. Likely causes: the host is ' +
            'unreachable, the tile does not exist at this zoom, or the response is ' +
            'missing CORS headers. Setting VITE_TILE_PROXY routes tiles through the ' +
            'bundled server, which removes the CORS dependency.',
        ),
      );
    img.src = url;
  });
}

/**
 * Run tasks with a concurrency limit. Public tile endpoints deserve politeness, and a
 * browser will serialise beyond six connections per host anyway.
 *
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} limit
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<T[]>}
 */
async function runPooled(tasks, limit, onProgress) {
  const results = new Array(tasks.length);
  let next = 0;
  let done = 0;

  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
      done += 1;
      if (onProgress) onProgress(done, tasks.length);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/**
 * Fetch and stitch the tiles covering a domain into one RGBA raster.
 *
 * Tiles are drawn into a single canvas so that one `getImageData` call reads them all.
 * Reading per tile would be many more round trips through the canvas API for no gain.
 *
 * A tile that fails is left transparent rather than aborting the whole load, so a
 * single missing tile at the edge of coverage degrades to a hole that `fillNodata`
 * closes, instead of losing the entire domain. The count of failures is returned so the
 * caller can tell the user.
 *
 * @param {object} domain from geo.createDomain
 * @param {object} [options]
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<{rgba: Uint8ClampedArray, width: number, height: number, failed: string[]}>}
 */
export async function fetchTileMosaic(domain, options = {}) {
  const { onProgress } = options;
  const source = ELEVATION.terrarium;
  const { tileRange, tileCountX, tileCountY, zoom } = domain;
  const ts = source.tileSize;

  if (domain.tileCount > perfConfig.maxTilesPerLoad) {
    throw new Error(
      `This domain needs ${domain.tileCount} elevation tiles, which is over the safety ` +
        `limit of ${perfConfig.maxTilesPerLoad}. Reduce the domain size or the grid ` +
        'resolution. Grid resolution sets the tile zoom, so a coarser grid needs far ' +
        'fewer tiles.',
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = tileCountX * ts;
  canvas.height = tileCountY * ts;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not obtain a 2D canvas context to stitch elevation tiles.');

  // Transparent means nodata, which decodeTerrariumBuffer turns into NaN.
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const failed = [];
  const tasks = [];

  for (let ty = tileRange.minY; ty <= tileRange.maxY; ty += 1) {
    for (let tx = tileRange.minX; tx <= tileRange.maxX; tx += 1) {
      const url = tileUrl(source.url, zoom, tx, ty);
      const dx = (tx - tileRange.minX) * ts;
      const dy = (ty - tileRange.minY) * ts;

      tasks.push(async () => {
        try {
          const img = await loadImage(url);
          ctx.drawImage(img, dx, dy, ts, ts);
        } catch (err) {
          failed.push(`${zoom}/${tx}/${ty}`);
          console.warn(`[waterflow] elevation tile ${zoom}/${tx}/${ty} failed:`, err.message);
        }
      });
    }
  }

  await runPooled(tasks, perfConfig.tileConcurrency, onProgress);

  if (failed.length === tasks.length) {
    throw new Error(
      `All ${tasks.length} elevation tiles failed to load at zoom ${zoom}. ` +
        `Source: ${source.url}. Check network access to s3.amazonaws.com, or set ` +
        'VITE_TILE_PROXY to route tiles through the bundled server.',
    );
  }

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Release the backing store. A 16x16 tile mosaic is a 4096x4096 canvas, which is
  // 64 MB of RGBA that nothing needs once the pixels are copied out.
  canvas.width = 1;
  canvas.height = 1;

  return { rgba: image.data, width: image.width, height: image.height, failed };
}

/**
 * Load the elevation grid for a domain.
 *
 * @param {object} domain from geo.createDomain
 * @param {object} [options]
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<{grid: import('../util/grid.js').Grid, min: number, max: number,
 *   failedTiles: string[], nodataFilled: number, attribution: string}>}
 */
export async function loadElevationGrid(domain, options = {}) {
  const mosaic = await fetchTileMosaic(domain, options);

  const decoded = decodeTerrariumBuffer(mosaic.rgba, mosaic.width, mosaic.height);
  const source = { data: decoded.data, width: mosaic.width, height: mosaic.height };

  // Nodata is filled on the full-resolution raster, before resampling. Doing it after
  // would let a NaN contaminate every destination cell its box average touches.
  const seedLevel = Number.isFinite(decoded.min) ? decoded.min : 0;
  const nodataFilled = fillNodata(source.data, source.width, source.height, seedLevel);

  // The domain's pixel window inside the stitched mosaic. The mosaic starts at a whole
  // tile boundary, so the window is offset by the difference.
  const ts = domain.tileSize;
  const window = {
    x: domain.pixelBounds.minPx - domain.tileRange.minX * ts,
    y: domain.pixelBounds.minPy - domain.tileRange.minY * ts,
    w: domain.pixelBounds.maxPx - domain.pixelBounds.minPx,
    h: domain.pixelBounds.maxPy - domain.pixelBounds.minPy,
  };

  const grid = resampleWindow(source, window, domain.gridSize);
  const extent = gridExtent(grid);

  return {
    grid,
    min: extent.min,
    max: extent.max,
    failedTiles: mosaic.failed,
    nodataFilled,
    attribution: ELEVATION.terrarium.attribution,
  };
}

/**
 * Build a synthetic valley ONLY for the explicitly requested demo mode and tests.
 *
 * Real elevation failures stop simulations in the normal mode. This function may
 * only be selected via an explicit ?demo=1 user choice or by offline tests.
 * The shape is a V-shaped valley descending along +z with meanders and roughness, which
 * is enough to exercise routing, station placement and the solver.
 *
 * @param {number} size grid edge in cells
 * @param {number} cellSize metres
 * @returns {import('../util/grid.js').Grid}
 */
export function createSyntheticValley(size, cellSize) {
  const grid = createGrid(size, size);
  const lengthM = size * cellSize;

  for (let row = 0; row < size; row += 1) {
    const downstream = row / (size - 1);

    // Valley floor drops 0.6 percent, a typical plains river gradient.
    const floor = 420 - downstream * lengthM * 0.006;

    // Meandering centreline, widening downstream.
    const meander = Math.sin(downstream * Math.PI * 2.4) * size * 0.14;
    const centre = size / 2 + meander;
    const halfWidth = size * (0.045 + downstream * 0.12);

    for (let col = 0; col < size; col += 1) {
      const offset = Math.abs(col - centre) / halfWidth;

      // Flat floor inside the channel, then valley walls rising to a plateau.
      let z;
      if (offset <= 1) {
        z = floor + offset * offset * 2.5;
      } else {
        const wall = offset - 1;
        z = floor + 2.5 + Math.min(wall, 1.6) * 52 + Math.max(0, wall - 1.6) * 7;
      }

      // Two octaves of smooth roughness so hillshade and slope have something to show.
      z +=
        Math.sin(col * 0.11 + row * 0.07) * 3.2 +
        Math.sin(col * 0.031 - row * 0.043) * 7.5 +
        Math.cos(col * 0.21 + row * 0.19) * 1.1;

      grid.data[row * size + col] = z;
    }
  }

  return grid;
}
