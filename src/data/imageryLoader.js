/**
 * Map imagery loading for the terrain drape.
 *
 * Imagery is cosmetic: it never affects a simulated number. So unlike elevation, a
 * failure here is not fatal. The loader walks a fallback chain of sources and, if every
 * one fails, returns null so the renderer falls back to hillshade and hypsometric
 * colouring. That is acceptance criterion AC-03.
 *
 * Imagery is fetched at a higher zoom than the elevation, because the eye resolves
 * texture detail far finer than the simulation grid. A 512 cell grid over 24 km has 47 m
 * cells, but imagery at 2 m per pixel still visibly improves the view.
 */

import { IMAGERY, IMAGERY_FALLBACK_ORDER, tileUrl } from './sources.js';
import { performance as perfConfig } from '../config.js';
import { mercatorToPixel } from './geo.js';

/** Maximum edge of the generated drape texture in pixels. */
const MAX_TEXTURE_EDGE = 4096;

/**
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Imagery tile request failed: ${url}`));
    img.src = url;
  });
}

/**
 * Choose the imagery zoom that gets closest to MAX_TEXTURE_EDGE without exceeding it.
 *
 * @param {object} domain
 * @param {object} source entry from IMAGERY
 * @returns {number} zoom level
 */
function pickImageryZoom(domain, source) {
  const maxZoom = Math.min(source.maxZoom ?? 17, 19);

  for (let z = maxZoom; z >= 1; z -= 1) {
    const topLeft = mercatorToPixel(
      domain.mercatorBounds.minX,
      domain.mercatorBounds.maxY,
      z,
      source.tileSize,
    );
    const bottomRight = mercatorToPixel(
      domain.mercatorBounds.maxX,
      domain.mercatorBounds.minY,
      z,
      source.tileSize,
    );
    const widthPx = bottomRight.px - topLeft.px;

    const tilesX = Math.floor((bottomRight.px - 1e-9) / source.tileSize) -
      Math.floor(topLeft.px / source.tileSize) + 1;
    const tilesY = Math.floor((bottomRight.py - 1e-9) / source.tileSize) -
      Math.floor(topLeft.py / source.tileSize) + 1;

    if (widthPx <= MAX_TEXTURE_EDGE && tilesX * tilesY <= perfConfig.maxTilesPerLoad) {
      return z;
    }
  }
  return 1;
}

/**
 * Fetch one imagery source and stitch it into a canvas cropped to the domain.
 *
 * @param {object} domain
 * @param {object} source entry from IMAGERY
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<{canvas: HTMLCanvasElement, zoom: number, failed: number, total: number}>}
 */
async function fetchImagerySource(domain, source, onProgress) {
  const zoom = pickImageryZoom(domain, source);
  const ts = source.tileSize;

  const topLeft = mercatorToPixel(domain.mercatorBounds.minX, domain.mercatorBounds.maxY, zoom, ts);
  const bottomRight = mercatorToPixel(
    domain.mercatorBounds.maxX,
    domain.mercatorBounds.minY,
    zoom,
    ts,
  );

  const tileMinX = Math.floor(topLeft.px / ts);
  const tileMaxX = Math.floor((bottomRight.px - 1e-9) / ts);
  const tileMinY = Math.floor(topLeft.py / ts);
  const tileMaxY = Math.floor((bottomRight.py - 1e-9) / ts);

  const mosaic = document.createElement('canvas');
  mosaic.width = (tileMaxX - tileMinX + 1) * ts;
  mosaic.height = (tileMaxY - tileMinY + 1) * ts;
  const mctx = mosaic.getContext('2d', { willReadFrequently: false });
  if (!mctx) throw new Error('Could not obtain a 2D canvas context to stitch imagery tiles.');

  // Mid grey so a missing tile reads as neutral rather than as a black hole.
  mctx.fillStyle = '#6b6f63';
  mctx.fillRect(0, 0, mosaic.width, mosaic.height);

  const jobs = [];
  for (let ty = tileMinY; ty <= tileMaxY; ty += 1) {
    for (let tx = tileMinX; tx <= tileMaxX; tx += 1) {
      jobs.push({ tx, ty, dx: (tx - tileMinX) * ts, dy: (ty - tileMinY) * ts });
    }
  }

  let failed = 0;
  let done = 0;
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= jobs.length) return;
      const job = jobs[index];
      try {
        const img = await loadImage(tileUrl(source.url, zoom, job.tx, job.ty));
        mctx.drawImage(img, job.dx, job.dy, ts, ts);
      } catch {
        failed += 1;
      }
      done += 1;
      if (onProgress) onProgress(done, jobs.length);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(perfConfig.tileConcurrency, jobs.length); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (failed === jobs.length) {
    throw new Error(
      `All ${jobs.length} imagery tiles failed for source "${source.id}" at zoom ${zoom}.`,
    );
  }

  // Crop the mosaic to exactly the domain, so the texture maps 1:1 onto the terrain with
  // no offset correction needed in the shader.
  const cropX = topLeft.px - tileMinX * ts;
  const cropY = topLeft.py - tileMinY * ts;
  const cropW = bottomRight.px - topLeft.px;
  const cropH = bottomRight.py - topLeft.py;

  const out = document.createElement('canvas');
  out.width = Math.max(2, Math.round(cropW));
  out.height = Math.max(2, Math.round(cropH));
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Could not obtain a 2D canvas context to crop imagery.');
  octx.drawImage(mosaic, cropX, cropY, cropW, cropH, 0, 0, out.width, out.height);

  mosaic.width = 1;
  mosaic.height = 1;

  return { canvas: out, zoom, failed, total: jobs.length };
}

/**
 * Load imagery for a domain, trying the preferred source and then the fallback chain.
 *
 * @param {object} domain
 * @param {object} [options]
 * @param {string} [options.preferred] key from IMAGERY to try first
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<{canvas: HTMLCanvasElement|null, sourceId: string, label: string,
 *   attribution: string, zoom: number, partial: boolean, tried: string[]}>}
 */
export async function loadImagery(domain, options = {}) {
  const { preferred, onProgress } = options;

  const order = [];
  if (preferred && IMAGERY[preferred]) order.push(preferred);
  for (const key of IMAGERY_FALLBACK_ORDER) {
    if (!order.includes(key)) order.push(key);
  }

  const tried = [];

  for (const key of order) {
    const source = IMAGERY[key];
    if (!source || !source.url) {
      // The "none" entry, or an entry with no URL. Nothing to fetch.
      return {
        canvas: null,
        sourceId: 'none',
        label: IMAGERY.none.label,
        attribution: IMAGERY.none.attribution,
        zoom: 0,
        partial: false,
        tried,
      };
    }

    tried.push(key);
    try {
      const result = await fetchImagerySource(domain, source, onProgress);
      return {
        canvas: result.canvas,
        sourceId: key,
        label: source.label,
        attribution: source.attribution,
        zoom: result.zoom,
        partial: result.failed > 0,
        tried,
      };
    } catch (err) {
      console.warn(`[waterflow] imagery source "${key}" unavailable:`, err.message);
    }
  }

  return {
    canvas: null,
    sourceId: 'none',
    label: IMAGERY.none.label,
    attribution: IMAGERY.none.attribution,
    zoom: 0,
    partial: false,
    tried,
  };
}
