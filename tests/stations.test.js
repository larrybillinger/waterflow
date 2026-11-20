import { describe, it, expect } from 'vitest';

import {
  pathTangent,
  extractCrossSection,
  buildStations,
  formatDuration,
  stationsToCsv,
} from '../src/sim/stations.js';
import { normalDepth, ROUGHNESS_TABLE, getRoughness, groupedRoughness } from '../src/sim/manning.js';
import { createDomain } from '../src/data/geo.js';
import { createGrid } from '../src/util/grid.js';
import { physics } from '../src/config.js';

const domain = createDomain({
  lat: 39.2447,
  lon: -96.5944,
  domainMeters: 12800,
  gridSize: 256,
});

/**
 * A straight south-flowing valley with a flood in it.
 *
 * The water surface is level across each section and the depth follows from the bed, the
 * way a real flood behaves. Building the fixture the other way round, with depth
 * prescribed independently of the bed, produces water that slopes uphill toward the
 * valley walls and makes the high water mark assertion meaningless.
 */
function scenario() {
  const size = domain.gridSize;
  const ground = createGrid(size, size);
  const maxDepth = createGrid(size, size);
  const maxSpeed = createGrid(size, size);
  const arrival = createGrid(size, size, Infinity);

  /** Flood depth at the thalweg, metres. */
  const thalwegDepth = 6;
  /** Floodplain rise away from the centreline, metres per cell. */
  const bankSlope = 0.25;

  for (let row = 0; row < size; row += 1) {
    const centreBed = 200 - row * 0.4;
    // One level water surface per section.
    const waterSurface = centreBed + thalwegDepth;

    for (let col = 0; col < size; col += 1) {
      const index = row * size + col;
      const fromCentre = Math.abs(col - 128);

      const bed = centreBed + fromCentre * bankSlope;
      ground.data[index] = bed;

      const depth = waterSurface - bed;
      if (depth > 0) {
        maxDepth.data[index] = depth;
        maxSpeed.data[index] = 3 * (depth / thalwegDepth);
        arrival.data[index] = row * 30;
      }
    }
  }

  const path = [];
  for (let row = 0; row < size; row += 1) {
    path.push({ col: 128, row, distance: row * domain.cellSize });
  }

  return { ground, maxDepth, maxSpeed, arrival, path };
}

describe('pathTangent', () => {
  it('points along a straight southward path', () => {
    const path = [];
    for (let row = 0; row < 40; row += 1) path.push({ col: 10, row });

    const tangent = pathTangent(path, 20);
    expect(tangent.x).toBeCloseTo(0, 6);
    expect(tangent.y).toBeCloseTo(1, 6);
  });

  it('is a unit vector on a diagonal path', () => {
    const path = [];
    for (let i = 0; i < 40; i += 1) path.push({ col: i, row: i });

    const tangent = pathTangent(path, 20);
    expect(Math.hypot(tangent.x, tangent.y)).toBeCloseTo(1, 6);
    expect(tangent.x).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('smooths over the window rather than snapping to the last D8 step', () => {
    // A path that zigzags but trends south. A one-step tangent would flip about; the
    // smoothed one should stay near due south.
    const path = [];
    for (let row = 0; row < 40; row += 1) {
      path.push({ col: 10 + (row % 2), row });
    }

    const tangent = pathTangent(path, 20, 6);
    expect(Math.abs(tangent.x)).toBeLessThan(0.3);
    expect(tangent.y).toBeGreaterThan(0.9);
  });

  it('handles the ends of the path without going degenerate', () => {
    const path = [];
    for (let row = 0; row < 10; row += 1) path.push({ col: 5, row });

    for (const i of [0, 1, 8, 9]) {
      const tangent = pathTangent(path, i);
      expect(Math.hypot(tangent.x, tangent.y)).toBeCloseTo(1, 6);
    }
  });

  it('returns a valid vector for a single-point path', () => {
    const tangent = pathTangent([{ col: 1, row: 1 }], 0);
    expect(Math.hypot(tangent.x, tangent.y)).toBeCloseTo(1, 6);
  });
});

describe('extractCrossSection', () => {
  const { ground, maxDepth, maxSpeed, arrival } = scenario();

  const result = extractCrossSection({
    ground,
    maxDepth,
    maxSpeed,
    arrival,
    col: 128,
    row: 100,
    tangent: { x: 0, y: 1 },
    cellSize: domain.cellSize,
    halfWidth: 2000,
  });

  it('finds the peak depth at the thalweg', () => {
    expect(result.peakDepth).toBeCloseTo(6, 1);
  });

  it('measures a flood width close to the wetted channel', () => {
    // A 6 m depth over a 0.25 m per cell bank slope reaches 24 cells either side, so the
    // wetted width is about 49 cells.
    const expected = 49 * domain.cellSize;
    expect(result.floodWidth).toBeGreaterThan(expected * 0.8);
    expect(result.floodWidth).toBeLessThan(expected * 1.25);
  });

  it('reports the high water mark as the highest water surface in the section', () => {
    const bedAtCentre = ground.data[100 * domain.gridSize + 128];
    expect(result.peakWaterSurface).toBeCloseTo(bedAtCentre + 6, 1);
  });

  it('reports the earliest arrival in the section', () => {
    expect(result.arrivalSeconds).toBeCloseTo(100 * 30, 0);
  });

  it('samples the section at half-cell spacing', () => {
    const step = domain.cellSize / 2;
    const expectedSamples = Math.floor((2 * 2000) / step) + 1;
    expect(result.section.length).toBe(expectedSamples);
  });

  it('cuts perpendicular to the flow, so a sideways tangent gives a different section', () => {
    const along = extractCrossSection({
      ground,
      maxDepth,
      maxSpeed,
      arrival,
      col: 128,
      row: 100,
      tangent: { x: 1, y: 0 },
      cellSize: domain.cellSize,
      halfWidth: 2000,
    });

    // A section cut along the channel instead of across it is wet for its whole length.
    expect(along.floodWidth).toBeGreaterThan(result.floodWidth);
  });

  it('reports a dry section honestly', () => {
    const dry = createGrid(domain.gridSize, domain.gridSize, 0);
    const never = createGrid(domain.gridSize, domain.gridSize, Infinity);

    const outcome = extractCrossSection({
      ground,
      maxDepth: dry,
      maxSpeed: dry,
      arrival: never,
      col: 128,
      row: 100,
      tangent: { x: 0, y: 1 },
      cellSize: domain.cellSize,
      halfWidth: 1000,
    });

    expect(outcome.peakDepth).toBe(0);
    expect(outcome.floodWidth).toBe(0);
    expect(Number.isNaN(outcome.peakWaterSurface)).toBe(true);
    expect(outcome.arrivalSeconds).toBe(Infinity);
  });
});

describe('buildStations', () => {
  const { ground, maxDepth, maxSpeed, arrival, path } = scenario();

  const stations = buildStations({
    path,
    ground,
    maxDepth,
    maxSpeed,
    arrival,
    domain,
    spacing: 1000,
    halfWidth: 1500,
  });

  it('places stations at roughly the requested spacing', () => {
    expect(stations.length).toBeGreaterThan(5);
    for (let i = 1; i < stations.length; i += 1) {
      const gap = stations[i].distance - stations[i - 1].distance;
      // A station lands on the first path cell past each multiple of the spacing, so the
      // gap is the spacing to within one cell.
      expect(gap).toBeGreaterThan(1000 - domain.cellSize - 1);
      expect(gap).toBeLessThan(1000 + domain.cellSize + 1);
    }
  });

  it('numbers stations from one and increases distance monotonically', () => {
    expect(stations[0].index).toBe(1);
    for (let i = 1; i < stations.length; i += 1) {
      expect(stations[i].index).toBe(stations[i - 1].index + 1);
      expect(stations[i].distance).toBeGreaterThan(stations[i - 1].distance);
    }
  });

  it('attaches a real longitude and latitude to each station', () => {
    for (const station of stations) {
      expect(station.lat).toBeGreaterThan(domain.bboxLonLat.south - 0.01);
      expect(station.lat).toBeLessThan(domain.bboxLonLat.north + 0.01);
      expect(station.lon).toBeGreaterThan(domain.bboxLonLat.west - 0.01);
      expect(station.lon).toBeLessThan(domain.bboxLonLat.east + 0.01);
    }
  });

  it('flags only the stations within the near-field distance', () => {
    const nearFieldDistance = physics.nearFieldCells * domain.cellSize;
    for (const station of stations) {
      expect(station.nearField).toBe(station.distance < nearFieldDistance);
    }
  });

  it('reports arrival times that increase downstream', () => {
    for (let i = 1; i < stations.length; i += 1) {
      expect(stations[i].arrivalSeconds).toBeGreaterThan(stations[i - 1].arrivalSeconds);
    }
  });

  it('returns nothing for a path too short to measure', () => {
    expect(buildStations({ path: [], ground, maxDepth, maxSpeed, arrival, domain, spacing: 1000, halfWidth: 500 })).toEqual([]);
    expect(
      buildStations({
        path: [{ col: 1, row: 1, distance: 0 }],
        ground,
        maxDepth,
        maxSpeed,
        arrival,
        domain,
        spacing: 1000,
        halfWidth: 500,
      }),
    ).toEqual([]);
  });

  it('gives fewer stations at a wider spacing', () => {
    const sparse = buildStations({
      path,
      ground,
      maxDepth,
      maxSpeed,
      arrival,
      domain,
      spacing: 3000,
      halfWidth: 1500,
    });
    expect(sparse.length).toBeLessThan(stations.length);
  });
});

describe('formatDuration', () => {
  it('uses seconds below a minute', () => {
    expect(formatDuration(45)).toBe('45 s');
  });

  it('uses minutes and seconds below an hour', () => {
    expect(formatDuration(125)).toBe('2m 05s');
  });

  it('uses hours and minutes above an hour', () => {
    expect(formatDuration(3660)).toBe('1h 01m');
    expect(formatDuration(36000)).toBe('10h 00m');
  });

  it('says never for water that did not arrive', () => {
    expect(formatDuration(Infinity)).toBe('never');
    expect(formatDuration(NaN)).toBe('never');
  });
});

describe('stationsToCsv', () => {
  const { ground, maxDepth, maxSpeed, arrival, path } = scenario();
  const stations = buildStations({
    path,
    ground,
    maxDepth,
    maxSpeed,
    arrival,
    domain,
    spacing: 2000,
    halfWidth: 1500,
  });

  const csv = stationsToCsv(stations, {
    version: 'v0.1.0',
    lat: domain.lat,
    lon: domain.lon,
    domainMeters: domain.domainMeters,
    gridSize: domain.gridSize,
    cellSize: domain.cellSize,
    elevationSource: 'Test',
    zoom: domain.zoom,
    sourceResolution: domain.sourceResolution,
    manningN: 0.045,
    crestElevation: 200,
    damHeight: 40,
    reservoirVolume: 1e8,
    breachWidthPercent: 35,
    breachDepthPercent: 100,
    breachFormationMinutes: 60,
    breachProgression: 'sinusoidal',
    breachMode: 'overtopping',
    simulatedSeconds: 7200,
    massErrorPercent: 0.2,
  });

  it('carries the limitations notice in the header', () => {
    // Risk R-005: a results file must not leave the building without its caveats.
    expect(csv).toMatch(/NOT AN ENGINEERING OR REGULATORY PRODUCT/);
    expect(csv).toMatch(/must not be used to make decisions/);
  });

  it('records the run settings', () => {
    expect(csv).toMatch(/Manning's n: 0.045/);
    expect(csv).toMatch(/35% of dam length/);
    expect(csv).toMatch(/60 minutes/);
    expect(csv).toMatch(/sinusoidal/);
  });

  it('has a header row and one row per station', () => {
    const lines = csv.split('\n').filter((line) => !line.startsWith('#'));
    expect(lines[0]).toMatch(/^station,distance_downstream_m/);
    expect(lines.length).toBe(stations.length + 1);
  });

  it('rounds depth to one decimal, matching the data resolution', () => {
    const dataLines = csv.split('\n').filter((line) => /^\d/.test(line));
    for (const line of dataLines) {
      const depth = line.split(',')[6];
      expect(depth).toMatch(/^\d+\.\d$/);
    }
  });
});

describe("Manning's roughness table", () => {
  it('has a plausible minimum, normal and maximum for every entry', () => {
    for (const entry of ROUGHNESS_TABLE) {
      expect(entry.min).toBeLessThanOrEqual(entry.normal);
      expect(entry.normal).toBeLessThanOrEqual(entry.max);
      expect(entry.min).toBeGreaterThan(0);
      expect(entry.max).toBeLessThan(0.3);
    }
  });

  it('has unique identifiers', () => {
    const ids = new Set(ROUGHNESS_TABLE.map((entry) => entry.id));
    expect(ids.size).toBe(ROUGHNESS_TABLE.length);
  });

  it('looks up by id', () => {
    expect(getRoughness('surface-concrete').normal).toBe(0.013);
    expect(getRoughness('nope')).toBeUndefined();
  });

  it('groups without losing an entry', () => {
    const groups = groupedRoughness();
    let total = 0;
    for (const entries of groups.values()) total += entries.length;
    expect(total).toBe(ROUGHNESS_TABLE.length);
  });

  it('orders concrete as smoother than dense willows', () => {
    expect(getRoughness('surface-concrete').normal).toBeLessThan(
      getRoughness('plain-dense-willows').normal,
    );
  });
});

describe('normalDepth', () => {
  it('inverts the Manning equation', () => {
    const n = 0.035;
    const slope = 0.001;
    const depth = 2.5;

    // Forward: q = (1/n) h^(5/3) S^(1/2)
    const q = (1 / n) * Math.pow(depth, 5 / 3) * Math.sqrt(slope);
    expect(normalDepth(q, n, slope)).toBeCloseTo(depth, 6);
  });

  it('is deeper for rougher ground at the same discharge', () => {
    const smooth = normalDepth(10, 0.02, 0.002);
    const rough = normalDepth(10, 0.1, 0.002);
    expect(rough).toBeGreaterThan(smooth);
  });

  it('returns NaN rather than a wrong number for a flat or dry case', () => {
    expect(Number.isNaN(normalDepth(10, 0.04, 0))).toBe(true);
    expect(Number.isNaN(normalDepth(10, 0.04, -0.01))).toBe(true);
    expect(Number.isNaN(normalDepth(0, 0.04, 0.01))).toBe(true);
  });
});
