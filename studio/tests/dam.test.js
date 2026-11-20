/**
 * Dam and breach geometry tests.
 *
 * The notch geometry is implemented twice on purpose: once on the CPU in src/sim/dam.js
 * for station analysis, and once in GLSL in src/sim/shaders/bed.glsl for the solver. The
 * two must agree. These tests pin the CPU version's behaviour, so a change to it that
 * drifts from the shader shows up as a failing test rather than as water mysteriously
 * refusing to leave a reservoir.
 */

import { describe, it, expect } from 'vitest';

import {
  describeDam,
  rasterizeDam,
  breachGeometry,
  effectiveBed,
  applyBreachToGrid,
  breachCentreCell,
  upstreamSide,
} from '../src/sim/dam.js';
import { breachOpeningAt } from '../src/sim/breach.js';
import { createGrid, cloneGrid } from '../src/util/grid.js';

/** A V-shaped valley running north to south, lowest along column 16. */
function valley(size = 32, cellSize = 25) {
  const grid = createGrid(size, size);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      grid.data[row * size + col] = 100 - row * 0.5 + Math.abs(col - 16) * 3;
    }
  }
  return { grid, cellSize };
}

describe('describeDam', () => {
  it('measures length along the axis in metres', () => {
    const { grid, cellSize } = valley();
    const dam = describeDam(grid, { col: 6, row: 16 }, { col: 26, row: 16 }, { cellSize });
    expect(dam.length).toBeCloseTo(20 * cellSize, 6);
  });

  it('finds the valley floor as the base elevation', () => {
    const { grid, cellSize } = valley();
    const dam = describeDam(grid, { col: 6, row: 16 }, { col: 26, row: 16 }, { cellSize });
    // The lowest ground along the axis is at column 16.
    expect(dam.baseElevation).toBeCloseTo(100 - 16 * 0.5, 4);
  });

  it('defaults the crest to the controlling abutment', () => {
    const { grid, cellSize } = valley();
    const dam = describeDam(grid, { col: 6, row: 16 }, { col: 26, row: 16 }, {
      cellSize,
      freeboard: 4,
    });

    const controlling = Math.min(grid.data[16 * 32 + 6], grid.data[16 * 32 + 26]);
    expect(dam.crestElevation).toBeCloseTo(controlling, 4);
    expect(dam.height).toBeCloseTo(dam.crestElevation - dam.baseElevation, 6);
  });

  it('records where the valley floor crosses the axis', () => {
    const { grid, cellSize } = valley();
    const dam = describeDam(grid, { col: 6, row: 16 }, { col: 26, row: 16 }, { cellSize });
    // The valley helper puts its lowest line at column 16.
    expect(dam.thalweg.col).toBe(16);
    expect(dam.thalweg.row).toBe(16);
  });

  it('accepts an explicit crest elevation', () => {
    const { grid, cellSize } = valley();
    const dam = describeDam(grid, { col: 6, row: 16 }, { col: 26, row: 16 }, {
      cellSize,
      crestElevation: 140,
    });
    expect(dam.crestElevation).toBe(140);
  });

  it('never gives a crest width thinner than a few cells', () => {
    const { grid } = valley();
    // A coarse grid: the default crest must widen to keep the dam watertight.
    const dam = describeDam(grid, { col: 6, row: 16 }, { col: 26, row: 16 }, {
      cellSize: 200,
    });
    expect(dam.crestWidth).toBeGreaterThanOrEqual(200 * 3);
  });
});

describe('rasterizeDam', () => {
  it('raises the valley floor to the crest', () => {
    const { grid, cellSize } = valley();
    const dam = describeDam(grid, { col: 6, row: 16 }, { col: 26, row: 16 }, {
      cellSize,
      crestElevation: 150,
    });

    const before = grid.data[16 * 32 + 16];
    rasterizeDam(grid, dam, cellSize);
    const after = grid.data[16 * 32 + 16];

    expect(before).toBeLessThan(150);
    expect(after).toBeCloseTo(150, 4);
  });

  it('only ever raises terrain, never lowers it', () => {
    const { grid, cellSize } = valley();
    const original = cloneGrid(grid);
    const dam = describeDam(grid, { col: 6, row: 16 }, { col: 26, row: 16 }, {
      cellSize,
      crestElevation: 140,
    });

    rasterizeDam(grid, dam, cellSize);

    for (let i = 0; i < grid.data.length; i += 1) {
      expect(grid.data[i]).toBeGreaterThanOrEqual(original.data[i] - 1e-6);
    }
  });

  it('leaves terrain far from the axis untouched', () => {
    const { grid, cellSize } = valley();
    const original = cloneGrid(grid);
    const dam = describeDam(grid, { col: 12, row: 16 }, { col: 20, row: 16 }, {
      cellSize,
      crestElevation: 130,
    });

    rasterizeDam(grid, dam, cellSize);

    // Row 2 is a long way upstream of the axis at row 16.
    for (let col = 0; col < 32; col += 1) {
      expect(grid.data[2 * 32 + col]).toBeCloseTo(original.data[2 * 32 + col], 6);
    }
  });

  it('slopes the embankment down to the ground rather than leaving a wall', () => {
    const { grid, cellSize } = valley();
    const dam = describeDam(grid, { col: 6, row: 16 }, { col: 26, row: 16 }, {
      cellSize,
      crestElevation: 150,
      crestWidth: 60,
    });

    rasterizeDam(grid, dam, cellSize);

    // Moving away from the axis along the valley floor, elevation should fall gradually.
    const atAxis = grid.data[16 * 32 + 16];
    const oneAway = grid.data[17 * 32 + 16];
    const twoAway = grid.data[18 * 32 + 16];
    const farAway = grid.data[24 * 32 + 16];

    expect(atAxis).toBeGreaterThan(twoAway);
    expect(oneAway).toBeGreaterThanOrEqual(twoAway);
    expect(twoAway).toBeGreaterThan(farAway);
  });

  it('does nothing for a zero-length dam', () => {
    const { grid, cellSize } = valley();
    const original = cloneGrid(grid);
    const dam = describeDam(grid, { col: 10, row: 10 }, { col: 10, row: 10 }, { cellSize });
    rasterizeDam(grid, dam, cellSize);
    expect(Array.from(grid.data)).toEqual(Array.from(original.data));
  });
});

describe('upstreamSide', () => {
  /**
   * A valley that falls toward increasing row, so south is downstream. A dam across it
   * must impound water to the NORTH, which is the higher side.
   */
  function fallingValley(size = 40, cellSize = 25) {
    const grid = createGrid(size, size);
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        grid.data[row * size + col] = 300 - row * 1.5 + Math.abs(col - 20) * 2.5;
      }
    }
    return { grid, cellSize, size };
  }

  it('picks the upstream side of a valley that falls to the south', () => {
    const { grid, cellSize } = fallingValley();
    const dam = describeDam(grid, { col: 8, row: 20 }, { col: 32, row: 20 }, { cellSize });

    const side = upstreamSide(grid, dam, cellSize);

    // The axis runs west to east, so its normal runs north to south. Upstream is north,
    // which is decreasing row, so normalY * sign must be negative.
    expect(side.normalY * side.sign).toBeLessThan(0);
    expect(side.confident).toBe(true);
  });

  it('picks the upstream side of a valley that falls to the north', () => {
    const size = 40;
    const cellSize = 25;
    const grid = createGrid(size, size);
    // Reversed: falls toward decreasing row.
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        grid.data[row * size + col] = 300 + row * 1.5 + Math.abs(col - 20) * 2.5;
      }
    }

    const dam = describeDam(grid, { col: 8, row: 20 }, { col: 32, row: 20 }, { cellSize });
    const side = upstreamSide(grid, dam, cellSize);

    expect(side.normalY * side.sign).toBeGreaterThan(0);
  });

  it('does not simply choose the lower side', () => {
    // This is the regression. In a valley that falls downstream, the downstream side is
    // genuinely lower, so an elevation test picks it and the "reservoir" floods the
    // valley below the dam.
    const { grid, cellSize, size } = fallingValley();
    const dam = describeDam(grid, { col: 8, row: 20 }, { col: 32, row: 20 }, { cellSize });
    const side = upstreamSide(grid, dam, cellSize);

    const offset = 8;
    const chosenRow = Math.round(20 + side.normalY * side.sign * offset);
    const otherRow = Math.round(20 - side.normalY * side.sign * offset);

    const chosenZ = grid.data[chosenRow * size + 20];
    const otherZ = grid.data[otherRow * size + 20];

    // The side it chose is the HIGHER one, which is the point.
    expect(chosenZ).toBeGreaterThan(otherZ);
  });

  it('returns a unit normal perpendicular to the dam axis', () => {
    const { grid, cellSize } = fallingValley();
    const dam = describeDam(grid, { col: 8, row: 14 }, { col: 30, row: 26 }, { cellSize });
    const side = upstreamSide(grid, dam, cellSize);

    expect(Math.hypot(side.normalX, side.normalY)).toBeCloseTo(1, 6);

    const axisX = dam.end.col - dam.start.col;
    const axisY = dam.end.row - dam.start.row;
    const dot = side.normalX * axisX + side.normalY * axisY;
    expect(Math.abs(dot)).toBeLessThan(1e-6);

    expect(Math.abs(side.sign)).toBe(1);
  });

  it('still answers when the descent runs along the axis', () => {
    // A dam laid ALONG the valley rather than across it. There is no correct reservoir
    // here, but the function must return a usable side rather than hang or return NaN.
    const { grid, cellSize } = fallingValley();
    const dam = describeDam(grid, { col: 20, row: 8 }, { col: 20, row: 32 }, { cellSize });
    const side = upstreamSide(grid, dam, cellSize);

    expect(Number.isFinite(side.normalX)).toBe(true);
    expect(Number.isFinite(side.normalY)).toBe(true);
    expect(Math.abs(side.sign)).toBe(1);
  });
});

describe('crest defaults', () => {
  it('defaults to the lower abutment, not the highest ground on the axis', () => {
    const size = 40;
    const cellSize = 25;
    const grid = createGrid(size, size);

    // A valley with one very high wall and one low one.
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const fromCentre = col - 20;
        const wall = fromCentre < 0 ? Math.abs(fromCentre) * 8 : Math.abs(fromCentre) * 1.5;
        grid.data[row * size + col] = 200 - row + wall;
      }
    }

    const dam = describeDam(grid, { col: 4, row: 20 }, { col: 36, row: 20 }, { cellSize });

    const westAbutment = grid.data[20 * size + 4];
    const eastAbutment = grid.data[20 * size + 36];

    // A dam built above the lower abutment would simply be flanked by the water.
    expect(dam.crestElevation).toBeCloseTo(Math.min(westAbutment, eastAbutment), 4);
    expect(dam.crestElevation).toBeLessThan(Math.max(westAbutment, eastAbutment));
  });

  it('still gives a usable dam when both abutments are near the valley floor', () => {
    const size = 30;
    const cellSize = 25;
    const grid = createGrid(size, size, 100);

    const dam = describeDam(grid, { col: 5, row: 15 }, { col: 25, row: 15 }, {
      cellSize,
      freeboard: 6,
    });

    // Flat ground: the abutments are at the floor, so the freeboard floor applies and
    // the dam still has height rather than collapsing to nothing.
    expect(dam.height).toBeCloseTo(6, 4);
  });

  it('honours an explicit crest regardless of the abutments', () => {
    const size = 30;
    const cellSize = 25;
    const grid = createGrid(size, size, 100);
    const dam = describeDam(grid, { col: 5, row: 15 }, { col: 25, row: 15 }, {
      cellSize,
      crestElevation: 175,
    });
    expect(dam.crestElevation).toBe(175);
    expect(dam.height).toBeCloseTo(75, 4);
  });
});

describe('breach notch geometry', () => {
  const cellSize = 25;
  const dam = {
    start: { col: 10, row: 20 },
    end: { col: 30, row: 20 },
    crestElevation: 200,
    crestWidth: 75,
    length: 20 * cellSize,
    baseElevation: 160,
    height: 40,
  };

  const fullOpening = breachOpeningAt(3600, {
    formationSeconds: 3600,
    finalBottomWidth: 100,
    finalDepth: 40,
    crestElevation: 200,
    sideSlope: 1,
    progression: 'linear',
  });

  const geometry = breachGeometry(dam, fullOpening, { cellSize, centreFraction: 0.5 });

  it('places the breach centre at the requested fraction along the axis', () => {
    const centre = breachCentreCell(geometry);
    expect(centre.col).toBeCloseTo(20, 6);
    expect(centre.row).toBeCloseTo(20, 6);
  });

  it('cuts the crest down to the invert at the breach centre', () => {
    const cut = effectiveBed(200, 20, 20, geometry);
    expect(cut).toBeCloseTo(160, 6);
  });

  it('leaves the crest intact well away from the breach', () => {
    // Column 11 is near the abutment, far outside a 100 m bottom width centred at col 20.
    expect(effectiveBed(200, 11, 20, geometry)).toBeCloseTo(200, 6);
  });

  it('ramps the cut back up through the trapezoid side slopes', () => {
    const atCentre = effectiveBed(200, 20, 20, geometry);
    const bottomEdge = geometry.bottomHalfWidthCells;
    const topEdge = geometry.topHalfWidthCells;
    const midSide = (bottomEdge + topEdge) / 2;

    const onSide = effectiveBed(200, 20 + midSide, 20, geometry);

    expect(onSide).toBeGreaterThan(atCentre);
    expect(onSide).toBeLessThan(200);
  });

  it('does not cut terrain upstream or downstream of the embankment', () => {
    // Twenty cells away from the axis is far beyond the embankment footprint.
    expect(effectiveBed(200, 20, 0, geometry)).toBeCloseTo(200, 6);
    expect(effectiveBed(200, 20, 31, geometry)).toBeCloseTo(200, 6);
  });

  it('never raises ground that was already below the invert', () => {
    // Ground at 150 is below the 160 m invert; the notch must leave it alone.
    expect(effectiveBed(150, 20, 20, geometry)).toBeCloseTo(150, 6);
  });

  it('is inert before the breach starts to form', () => {
    const closed = breachOpeningAt(0, {
      formationSeconds: 3600,
      finalBottomWidth: 100,
      finalDepth: 40,
      crestElevation: 200,
      sideSlope: 1,
      progression: 'linear',
    });
    const inert = breachGeometry(dam, closed, { cellSize });

    expect(inert.active).toBe(0);
    expect(effectiveBed(200, 20, 20, inert)).toBe(200);
  });

  it('deepens monotonically as the breach forms', () => {
    let previous = Infinity;
    for (const t of [600, 1200, 1800, 2400, 3000, 3600]) {
      const opening = breachOpeningAt(t, {
        formationSeconds: 3600,
        finalBottomWidth: 100,
        finalDepth: 40,
        crestElevation: 200,
        sideSlope: 1,
        progression: 'linear',
      });
      const partial = breachGeometry(dam, opening, { cellSize });
      const bed = effectiveBed(200, 20, 20, partial);
      expect(bed).toBeLessThanOrEqual(previous + 1e-6);
      previous = bed;
    }
    expect(previous).toBeCloseTo(160, 4);
  });

  it('honours an off-centre breach', () => {
    const offset = breachGeometry(dam, fullOpening, { cellSize, centreFraction: 0.25 });
    const centre = breachCentreCell(offset);
    expect(centre.col).toBeCloseTo(15, 6);

    expect(effectiveBed(200, 15, 20, offset)).toBeCloseTo(160, 6);
    // And the old centre is now intact.
    expect(effectiveBed(200, 25, 20, offset)).toBeCloseTo(200, 6);
  });
});

describe('applyBreachToGrid', () => {
  it('produces a new grid and leaves the original alone', () => {
    const { grid, cellSize } = valley();
    const dam = describeDam(grid, { col: 6, row: 16 }, { col: 26, row: 16 }, {
      cellSize,
      crestElevation: 150,
    });
    rasterizeDam(grid, dam, cellSize);

    const opening = breachOpeningAt(1, {
      formationSeconds: 1,
      finalBottomWidth: 150,
      finalDepth: dam.height,
      crestElevation: dam.crestElevation,
      sideSlope: 1,
      progression: 'linear',
    });
    const geometry = breachGeometry(dam, opening, { cellSize });

    const before = grid.data[16 * 32 + 16];
    const breached = applyBreachToGrid(grid, geometry);

    expect(grid.data[16 * 32 + 16]).toBe(before);
    expect(breached.data[16 * 32 + 16]).toBeLessThan(before);
  });

  it('opens a continuous gap right through the embankment', () => {
    const size = 32;
    const cellSize = 25;
    const { grid } = valley(size, cellSize);

    const dam = describeDam(grid, { col: 6, row: 16 }, { col: 26, row: 16 }, {
      cellSize,
      crestElevation: 150,
      crestWidth: 75,
    });
    rasterizeDam(grid, dam, cellSize);

    const opening = breachOpeningAt(1, {
      formationSeconds: 1,
      finalBottomWidth: 150,
      finalDepth: dam.height,
      crestElevation: dam.crestElevation,
      sideSlope: 1,
      progression: 'linear',
    });
    const breached = applyBreachToGrid(grid, breachGeometry(dam, opening, { cellSize }));

    // Walk across the dam through the breach column. No cell may still stand above the
    // upstream water level, or the reservoir could not drain.
    const upstreamFloor = grid.data[10 * size + 16];
    for (let row = 13; row <= 19; row += 1) {
      expect(breached.data[row * size + 16]).toBeLessThanOrEqual(upstreamFloor + 1);
    }
  });
});
