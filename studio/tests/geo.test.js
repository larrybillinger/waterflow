import { describe, it, expect } from 'vitest';

import {
  lonLatToMercator,
  mercatorToLonLat,
  mercatorResolution,
  groundResolution,
  mercatorScaleFactor,
  mercatorToPixel,
  pixelToMercator,
  pickZoomForCellSize,
  createDomain,
  gridToLonLat,
  lonLatToGrid,
  gridToScene,
  sceneToGrid,
  formatLatLon,
  MERCATOR_EXTENT,
} from '../src/data/geo.js';

describe('Web Mercator', () => {
  it('puts the origin at zero', () => {
    const m = lonLatToMercator(0, 0);
    expect(m.x).toBeCloseTo(0, 6);
    expect(m.y).toBeCloseTo(0, 6);
  });

  it('puts 180 degrees east at the extent', () => {
    const m = lonLatToMercator(180, 0);
    expect(m.x).toBeCloseTo(MERCATOR_EXTENT, 3);
  });

  it('round trips longitude and latitude', () => {
    const cases = [
      [0, 0],
      [-96.5944, 39.2447],
      [12.4924, 41.8902],
      [151.2093, -33.8688],
      [-157.8583, 21.3069],
    ];

    for (const [lon, lat] of cases) {
      const m = lonLatToMercator(lon, lat);
      const back = mercatorToLonLat(m.x, m.y);
      expect(back.lon).toBeCloseTo(lon, 9);
      expect(back.lat).toBeCloseTo(lat, 9);
    }
  });

  it('clamps beyond the Mercator latitude limit rather than returning infinity', () => {
    const m = lonLatToMercator(0, 89.9);
    expect(Number.isFinite(m.y)).toBe(true);
  });
});

describe('resolution', () => {
  it('gives the documented resolution at zoom 0', () => {
    // The well-known figure for 256 px tiles is 156543.03 m per pixel at the equator.
    expect(mercatorResolution(0, 256)).toBeCloseTo(156543.033928041, 6);
  });

  it('halves with each zoom level', () => {
    for (let z = 0; z < 18; z += 1) {
      expect(mercatorResolution(z + 1)).toBeCloseTo(mercatorResolution(z) / 2, 9);
    }
  });

  it('shrinks ground resolution by the cosine of latitude', () => {
    const atEquator = groundResolution(12, 0);
    const atSixty = groundResolution(12, 60);
    expect(atSixty / atEquator).toBeCloseTo(Math.cos((60 * Math.PI) / 180), 6);
  });

  it('reports a scale factor of one at the equator', () => {
    expect(mercatorScaleFactor(0)).toBeCloseTo(1, 9);
  });
});

describe('pixel conversion', () => {
  it('round trips through pixel space', () => {
    const m = lonLatToMercator(-96.5944, 39.2447);
    for (const zoom of [8, 12, 15]) {
      const p = mercatorToPixel(m.x, m.y, zoom);
      const back = pixelToMercator(p.px, p.py, zoom);
      expect(back.x).toBeCloseTo(m.x, 3);
      expect(back.y).toBeCloseTo(m.y, 3);
    }
  });

  it('places the north west corner of the world at pixel zero', () => {
    const topLeft = lonLatToMercator(-180, 85.05112877980659);
    const p = mercatorToPixel(topLeft.x, topLeft.y, 0);
    expect(p.px).toBeCloseTo(0, 3);
    expect(p.py).toBeCloseTo(0, 3);
  });
});

describe('zoom selection', () => {
  it('picks a zoom whose resolution is finer than the cell size', () => {
    const lat = 39;
    for (const cellSize of [10, 25, 47, 100, 250]) {
      const zoom = pickZoomForCellSize(cellSize, lat);
      expect(groundResolution(zoom, lat)).toBeLessThanOrEqual(cellSize);
    }
  });

  it('asks for a finer zoom when the cells are smaller', () => {
    const coarse = pickZoomForCellSize(200, 39);
    const fine = pickZoomForCellSize(12, 39);
    expect(fine).toBeGreaterThan(coarse);
  });

  it('respects the maximum zoom', () => {
    expect(pickZoomForCellSize(0.01, 39, { maxZoom: 15 })).toBe(15);
  });
});

describe('createDomain', () => {
  const domain = createDomain({
    lat: 39.2447,
    lon: -96.5944,
    domainMeters: 24000,
    gridSize: 512,
  });

  it('derives the cell size from the domain and grid', () => {
    expect(domain.cellSize).toBeCloseTo(24000 / 512, 9);
  });

  it('covers a square in true ground metres, not in Mercator metres', () => {
    // The Mercator span must be larger than the ground span by 1/cos(lat).
    const mercatorSpan = domain.mercatorBounds.maxX - domain.mercatorBounds.minX;
    const expected = 24000 / Math.cos((39.2447 * Math.PI) / 180);
    expect(mercatorSpan).toBeCloseTo(expected, 3);
  });

  it('is centred on the requested point', () => {
    const centre = gridToLonLat(domain, domain.gridSize / 2 - 0.5, domain.gridSize / 2 - 0.5);
    expect(centre.lon).toBeCloseTo(-96.5944, 5);
    expect(centre.lat).toBeCloseTo(39.2447, 4);
  });

  it('computes a tile range that covers the pixel window', () => {
    const { tileRange, pixelBounds, tileSize } = domain;
    expect(tileRange.minX * tileSize).toBeLessThanOrEqual(pixelBounds.minPx);
    expect((tileRange.maxX + 1) * tileSize).toBeGreaterThanOrEqual(pixelBounds.maxPx);
    expect(tileRange.minY * tileSize).toBeLessThanOrEqual(pixelBounds.minPy);
    expect((tileRange.maxY + 1) * tileSize).toBeGreaterThanOrEqual(pixelBounds.maxPy);
  });

  it('reports a tile count matching the range', () => {
    expect(domain.tileCount).toBe(domain.tileCountX * domain.tileCountY);
    expect(domain.tileCountX).toBe(domain.tileRange.maxX - domain.tileRange.minX + 1);
  });

  it('orders its lon/lat bounding box correctly', () => {
    expect(domain.bboxLonLat.west).toBeLessThan(domain.bboxLonLat.east);
    expect(domain.bboxLonLat.south).toBeLessThan(domain.bboxLonLat.north);
  });

  it('keeps the tile count reasonable for a typical request', () => {
    // Guards against a regression where the zoom choice over-fetches. A 24 km domain at
    // 512 cells should not need hundreds of tiles.
    expect(domain.tileCount).toBeLessThan(80);
  });
});

describe('grid coordinates', () => {
  const domain = createDomain({
    lat: 39.2447,
    lon: -96.5944,
    domainMeters: 24000,
    gridSize: 512,
  });

  it('round trips grid to lon/lat and back', () => {
    for (const [col, row] of [
      [0, 0],
      [100, 300],
      [511, 511],
      [255.5, 255.5],
    ]) {
      const lonLat = gridToLonLat(domain, col, row);
      const back = lonLatToGrid(domain, lonLat.lon, lonLat.lat);
      expect(back.col).toBeCloseTo(col, 4);
      expect(back.row).toBeCloseTo(row, 4);
    }
  });

  it('puts row zero at the north edge', () => {
    const north = gridToLonLat(domain, 256, 0);
    const south = gridToLonLat(domain, 256, 511);
    expect(north.lat).toBeGreaterThan(south.lat);
  });

  it('puts column zero at the west edge', () => {
    const west = gridToLonLat(domain, 0, 256);
    const east = gridToLonLat(domain, 511, 256);
    expect(west.lon).toBeLessThan(east.lon);
  });

  it('round trips grid to scene and back', () => {
    for (const [col, row] of [
      [0, 0],
      [37, 412],
      [511, 511],
    ]) {
      const scene = gridToScene(domain, col, row);
      const back = sceneToGrid(domain, scene.x, scene.z);
      expect(back.col).toBeCloseTo(col, 6);
      expect(back.row).toBeCloseTo(row, 6);
    }
  });

  it('centres the scene on the origin', () => {
    const centre = gridToScene(domain, 255.5, 255.5);
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.z).toBeCloseTo(0, 6);
  });

  it('maps north to negative z, matching the renderer', () => {
    const north = gridToScene(domain, 256, 0);
    const south = gridToScene(domain, 256, 511);
    expect(north.z).toBeLessThan(south.z);
  });
});

describe('formatLatLon', () => {
  it('uses the right hemisphere letters', () => {
    const text = formatLatLon(39.2447, -96.5944);
    expect(text).toContain('N');
    expect(text).toContain('W');
  });

  it('handles the southern and eastern hemispheres', () => {
    const text = formatLatLon(-33.8688, 151.2093);
    expect(text).toContain('S');
    expect(text).toContain('E');
  });
});
