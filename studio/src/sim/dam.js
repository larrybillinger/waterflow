/**
 * Dam geometry: placing a dam into the terrain, and cutting a breach out of it.
 *
 * A dam in Waterflow is real terrain, not an object the solver knows about. Placing one
 * raises the elevation grid along a line. Breaching one lowers it again, progressively.
 * That is decision D-003, and it is what makes the dam-building tool and the breach
 * mechanism the same piece of physics.
 *
 * The breach notch is evaluated analytically from a handful of parameters, both on the
 * CPU here for station analysis and in GLSL in the solver shaders. The two must agree,
 * so the maths is written once in this comment and implemented twice deliberately:
 *
 *   s  = signed distance along the dam axis from the breach centre, m
 *   p  = perpendicular distance from the dam axis, m
 *
 *   The notch applies only where |p| <= halfThickness, so it cuts the dam and not the
 *   valley upstream or downstream of it.
 *
 *   Within the opening, the invert sits at crest - depth. The trapezoid side slopes mean
 *   the cut shallows out over a horizontal run of sideSlope * depth either side:
 *
 *     |s| <= bottomWidth/2                  ->  cut to invert
 *     bottomWidth/2 < |s| <= topWidth/2     ->  cut ramps linearly back up to the crest
 *     |s| > topWidth/2                      ->  no cut
 *
 *   The effective bed is then min(groundElevation, notchElevation), so the notch only
 *   ever removes material. It cannot raise terrain, and it cannot cut below ground that
 *   was already lower than the invert.
 */

/**
 * @typedef {import('../util/grid.js').Grid} Grid
 */

/**
 * @typedef {object} DamDefinition
 * @property {{col: number, row: number}} start grid coordinates of one abutment
 * @property {{col: number, row: number}} end grid coordinates of the other abutment
 * @property {number} crestElevation m
 * @property {number} crestWidth m, the thickness of the raised crest
 * @property {number} length m, along the axis
 * @property {number} baseElevation m, lowest ground under the axis
 * @property {number} height m, crest above baseElevation
 */

/**
 * Describe a dam from two grid points and a crest elevation.
 *
 * If no crest elevation is given, it defaults to the highest ground along the axis plus
 * a small freeboard, which is the natural "close off this valley" interpretation of
 * dragging a line across it.
 *
 * @param {Grid} ground
 * @param {{col: number, row: number}} start
 * @param {{col: number, row: number}} end
 * @param {object} options
 * @param {number} options.cellSize m
 * @param {number} [options.crestElevation] m
 * @param {number} [options.crestWidth] m
 * @param {number} [options.freeboard=4] m added above the highest abutment by default
 * @returns {DamDefinition}
 */
export function describeDam(ground, start, end, options) {
  const { cellSize, crestElevation, crestWidth, freeboard = 4 } = options;

  const dCol = end.col - start.col;
  const dRow = end.row - start.row;
  const lengthCells = Math.hypot(dCol, dRow);
  const length = lengthCells * cellSize;

  // Sample the ground along the axis to find the valley floor and where the thalweg
  // crosses it. The thalweg position is needed later to work out which side is upstream.
  const samples = Math.max(2, Math.ceil(lengthCells) + 1);
  let baseElevation = Infinity;
  let thalweg = { col: start.col, row: start.row };

  for (let i = 0; i < samples; i += 1) {
    const t = i / (samples - 1);
    const c = Math.round(start.col + dCol * t);
    const r = Math.round(start.row + dRow * t);
    if (c < 0 || c >= ground.width || r < 0 || r >= ground.height) continue;
    const z = ground.data[r * ground.width + c];
    if (z < baseElevation) {
      baseElevation = z;
      thalweg = { col: c, row: r };
    }
  }

  if (baseElevation === Infinity) baseElevation = 0;

  // The controlling elevation is the LOWER of the two abutments, not the higher ground
  // anywhere along the axis. A dam built above its lower abutment does not impound more
  // water; the water simply goes around that end. Defaulting to the higher point
  // produces absurd reservoirs when the user drags an abutment part-way up a valley
  // wall, which is exactly what a first-time click tends to do.
  const abutment = (point) => {
    const c = Math.round(point.col);
    const r = Math.round(point.row);
    if (c < 0 || c >= ground.width || r < 0 || r >= ground.height) return baseElevation;
    return ground.data[r * ground.width + c];
  };

  const controllingElevation = Math.min(abutment(start), abutment(end));
  const crest = crestElevation ?? Math.max(controllingElevation, baseElevation + freeboard);

  return {
    start: { ...start },
    end: { ...end },
    thalweg,
    controllingElevation,
    crestElevation: crest,
    // A real embankment crest is tens of metres wide. Default to three cells or 60 m,
    // whichever is larger, so the dam is always thick enough to hold water on a coarse
    // grid: a one-cell dam leaks through numerical diffusion.
    crestWidth: crestWidth ?? Math.max(60, cellSize * 3),
    length,
    baseElevation,
    height: Math.max(0, crest - baseElevation),
  };
}

/**
 * Raise the elevation grid to form the dam embankment.
 *
 * The embankment has a flat crest of the given width and batters that slope down to meet
 * the ground, which stops a vertical wall of terrain from appearing in the 3D view and
 * gives the water something physical to sit against.
 *
 * @param {Grid} grid modified in place
 * @param {DamDefinition} dam
 * @param {number} cellSize m
 * @param {number} [batterSlope=2.2] horizontal run per unit rise on the embankment faces
 * @returns {Grid} the same grid
 */
export function rasterizeDam(grid, dam, cellSize, batterSlope = 2.2) {
  const { width, height, data } = grid;

  const ax = dam.start.col;
  const ay = dam.start.row;
  const bx = dam.end.col;
  const by = dam.end.row;

  const halfCrest = dam.crestWidth / 2 / cellSize;
  const maxRise = Math.max(0, dam.crestElevation - dam.baseElevation);
  const batterCells = (maxRise * batterSlope) / cellSize;
  const influence = halfCrest + batterCells + 2;

  const minCol = Math.max(0, Math.floor(Math.min(ax, bx) - influence));
  const maxCol = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + influence));
  const minRow = Math.max(0, Math.floor(Math.min(ay, by) - influence));
  const maxRow = Math.min(height - 1, Math.ceil(Math.max(ay, by) + influence));

  const segDx = bx - ax;
  const segDy = by - ay;
  const segLenSq = segDx * segDx + segDy * segDy;
  if (segLenSq === 0) return grid;

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      // Perpendicular distance to the segment, in cells.
      const t = Math.max(0, Math.min(1, ((col - ax) * segDx + (row - ay) * segDy) / segLenSq));
      const projX = ax + segDx * t;
      const projY = ay + segDy * t;
      const distCells = Math.hypot(col - projX, row - projY);

      let target;
      if (distCells <= halfCrest) {
        target = dam.crestElevation;
      } else if (distCells <= halfCrest + batterCells) {
        const into = (distCells - halfCrest) * cellSize;
        target = dam.crestElevation - into / batterSlope;
      } else {
        continue;
      }

      const index = row * width + col;
      if (target > data[index]) data[index] = target;
    }
  }

  return grid;
}

/**
 * Work out which side of a dam the reservoir forms on.
 *
 * The obvious answer, "whichever side is lower", is wrong, and wrong in a way that looks
 * plausible until you read the arrival times. In a river valley the ground falls
 * continuously downstream, so the lower side of a dam across that valley is the
 * downstream side. Seeding a pool fill there floods the valley below the dam instead of
 * impounding anything, and because that flooded area is genuinely lower it fills to an
 * enormous size and runs off the edge of the domain.
 *
 * The reliable criterion is drainage, not elevation: from the point where the valley
 * floor crosses the dam axis, follow steepest descent on the terrain as it was before
 * the dam existed. That path goes downstream by definition. The reservoir is on the
 * other side.
 *
 * @param {Grid} ground elevation WITHOUT the dam
 * @param {DamDefinition} dam
 * @param {number} cellSize m
 * @returns {{normalX: number, normalY: number, sign: number, confident: boolean}}
 *   a unit normal to the dam axis and the sign that points upstream along it
 */
export function upstreamSide(ground, dam, cellSize) {
  const dCol = dam.end.col - dam.start.col;
  const dRow = dam.end.row - dam.start.row;
  const length = Math.hypot(dCol, dRow) || 1;

  // Unit normal to the axis.
  const normalX = -dRow / length;
  const normalY = dCol / length;

  const thalweg = dam.thalweg ?? {
    col: (dam.start.col + dam.end.col) / 2,
    row: (dam.start.row + dam.end.row) / 2,
  };

  // Walk far enough to get clear of the embankment footprint, so the direction found is
  // the valley's and not the dam's own batter.
  const footprintCells = (dam.crestWidth / 2 + dam.height * 2.2) / cellSize;
  const steps = Math.ceil(Math.max(8, footprintCells + 6));

  let col = Math.round(thalweg.col);
  let row = Math.round(thalweg.row);

  const neighbours = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  for (let step = 0; step < steps; step += 1) {
    const here = ground.data[row * ground.width + col];
    let bestSlope = 0;
    let bestCol = col;
    let bestRow = row;

    for (const [dc, dr] of neighbours) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= ground.width || nr < 0 || nr >= ground.height) continue;
      const distance = dc !== 0 && dr !== 0 ? cellSize * Math.SQRT2 : cellSize;
      const slope = (here - ground.data[nr * ground.width + nc]) / distance;
      if (slope > bestSlope) {
        bestSlope = slope;
        bestCol = nc;
        bestRow = nr;
      }
    }

    if (bestCol === col && bestRow === row) break;
    col = bestCol;
    row = bestRow;
  }

  // How far the descent path ended up on each side of the axis.
  const perp = (col - thalweg.col) * normalX + (row - thalweg.row) * normalY;

  if (Math.abs(perp) > 1.5) {
    // The descent clearly favoured one side, so upstream is the other.
    return { normalX, normalY, sign: perp > 0 ? -1 : 1, confident: true };
  }

  // The descent ran along the axis, which happens when the dam is placed along the
  // valley rather than across it. Fall back to comparing how the floor behaves away
  // from the dam: upstream the ground rises, downstream it keeps falling.
  const probe = (sign) => {
    const far = Math.max(6, footprintCells + 8);
    const near = Math.max(2, footprintCells + 1);

    const sample = (distance) => {
      const c = Math.round(thalweg.col + normalX * sign * distance);
      const r = Math.round(thalweg.row + normalY * sign * distance);
      if (c < 0 || c >= ground.width || r < 0 || r >= ground.height) return NaN;
      return ground.data[r * ground.width + c];
    };

    const nearZ = sample(near);
    const farZ = sample(far);
    if (Number.isNaN(nearZ) || Number.isNaN(farZ)) return -Infinity;
    return farZ - nearZ;
  };

  const risePositive = probe(1);
  const riseNegative = probe(-1);

  return {
    normalX,
    normalY,
    sign: risePositive >= riseNegative ? 1 : -1,
    confident: false,
  };
}

/**
 * Uniform block describing the breach to the shaders, and the CPU equivalent.
 *
 * Grid coordinates are converted to metres relative to the grid origin so that the same
 * numbers work in the shader, which thinks in grid space, and on the CPU.
 *
 * @typedef {object} BreachGeometry
 * @property {number} active 1 when a breach exists, 0 otherwise
 * @property {number} axisX grid-space x of the dam axis start, cells
 * @property {number} axisY grid-space y of the dam axis start, cells
 * @property {number} dirX unit direction along the axis, cells
 * @property {number} dirY unit direction along the axis, cells
 * @property {number} axisLengthCells
 * @property {number} centreAlongCells distance along the axis to the breach centre
 * @property {number} halfThicknessCells perpendicular reach of the cut
 * @property {number} bottomHalfWidthCells
 * @property {number} topHalfWidthCells
 * @property {number} invertElevation m
 * @property {number} crestElevation m
 */

/**
 * Build the breach geometry for the current opening.
 *
 * @param {DamDefinition} dam
 * @param {object} opening from breach.breachOpeningAt
 * @param {object} options
 * @param {number} options.cellSize m
 * @param {number} [options.centreFraction=0.5] where along the dam the breach sits, 0-1
 * @returns {BreachGeometry}
 */
export function breachGeometry(dam, opening, options) {
  const { cellSize, centreFraction = 0.5 } = options;

  const dCol = dam.end.col - dam.start.col;
  const dRow = dam.end.row - dam.start.row;
  const lengthCells = Math.hypot(dCol, dRow);

  if (lengthCells === 0 || opening.depth <= 0) {
    return {
      active: 0,
      axisX: dam.start.col,
      axisY: dam.start.row,
      dirX: 1,
      dirY: 0,
      axisLengthCells: 0,
      centreAlongCells: 0,
      halfThicknessCells: 0,
      bottomHalfWidthCells: 0,
      topHalfWidthCells: 0,
      invertElevation: dam.crestElevation,
      crestElevation: dam.crestElevation,
    };
  }

  return {
    active: 1,
    axisX: dam.start.col,
    axisY: dam.start.row,
    dirX: dCol / lengthCells,
    dirY: dRow / lengthCells,
    axisLengthCells: lengthCells,
    centreAlongCells: lengthCells * centreFraction,
    // The cut must reach right through the embankment including its batters, or water
    // would be held back by the downstream face of a breached dam.
    halfThicknessCells:
      (dam.crestWidth / 2 + opening.depth * 2.2 + cellSize) / cellSize,
    bottomHalfWidthCells: opening.bottomWidth / 2 / cellSize,
    topHalfWidthCells: opening.topWidth / 2 / cellSize,
    invertElevation: opening.invertElevation,
    crestElevation: dam.crestElevation,
  };
}

/**
 * Effective bed elevation at a cell, with the breach notch applied.
 *
 * This is the CPU twin of the GLSL `effectiveBed` function in the solver shaders. The
 * two implementations must stay in step; a change to one is a change to both.
 *
 * @param {number} groundElevation m
 * @param {number} col grid column
 * @param {number} row grid row
 * @param {BreachGeometry} geometry
 * @returns {number} effective bed elevation, m
 */
export function effectiveBed(groundElevation, col, row, geometry) {
  if (!geometry.active) return groundElevation;

  const relX = col - geometry.axisX;
  const relY = row - geometry.axisY;

  // Component along the axis, and perpendicular to it.
  const along = relX * geometry.dirX + relY * geometry.dirY;
  const perp = relX * -geometry.dirY + relY * geometry.dirX;

  if (Math.abs(perp) > geometry.halfThicknessCells) return groundElevation;
  if (along < -geometry.halfThicknessCells) return groundElevation;
  if (along > geometry.axisLengthCells + geometry.halfThicknessCells) return groundElevation;

  const s = Math.abs(along - geometry.centreAlongCells);
  if (s > geometry.topHalfWidthCells) return groundElevation;

  let notch;
  if (s <= geometry.bottomHalfWidthCells) {
    notch = geometry.invertElevation;
  } else {
    const span = geometry.topHalfWidthCells - geometry.bottomHalfWidthCells;
    const ramp = span > 0 ? (s - geometry.bottomHalfWidthCells) / span : 1;
    notch =
      geometry.invertElevation + ramp * (geometry.crestElevation - geometry.invertElevation);
  }

  return Math.min(groundElevation, notch);
}

/**
 * Apply the breach notch across a whole grid, producing a new grid.
 *
 * Used for station analysis and for the downstream path trace, which both need the
 * breached terrain rather than the intact dam.
 *
 * @param {Grid} ground
 * @param {BreachGeometry} geometry
 * @returns {Grid} a new grid
 */
export function applyBreachToGrid(ground, geometry) {
  const out = { data: ground.data.slice(), width: ground.width, height: ground.height };
  if (!geometry.active) return out;

  for (let row = 0; row < ground.height; row += 1) {
    for (let col = 0; col < ground.width; col += 1) {
      const index = row * ground.width + col;
      out.data[index] = effectiveBed(ground.data[index], col, row, geometry);
    }
  }

  return out;
}

/**
 * The grid cell at the centre of the breach, which is where the downstream path starts.
 *
 * @param {BreachGeometry} geometry
 * @returns {{col: number, row: number}}
 */
export function breachCentreCell(geometry) {
  return {
    col: geometry.axisX + geometry.dirX * geometry.centreAlongCells,
    row: geometry.axisY + geometry.dirY * geometry.centreAlongCells,
  };
}
