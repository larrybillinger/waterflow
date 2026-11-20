/**
 * Dam breach geometry, timing and outflow.
 *
 * Every equation here is cited in docs/hydraulics.md section 2. Nothing in this file is
 * tuned by eye. SI throughout.
 *
 * The important design point, from decision D-003: this module does not produce an
 * inflow hydrograph for the solver to consume. It produces breach *geometry* as a
 * function of time. The solver cuts that geometry out of the terrain and the water
 * leaves the reservoir because of the physics, not because it was told to. That makes
 * reservoir drawdown, outflow and downstream routing one mass-conserving calculation
 * instead of three that can disagree.
 *
 * The weir equations below are therefore used for an independent analytic cross-check
 * shown next to the simulated hydrograph, not as the driver.
 */

import { GRAVITY } from '../config.js';

/**
 * Failure mode. Affects the Froehlich mode coefficient and the breach side slopes.
 * @typedef {'overtopping'|'piping'} FailureMode
 */

/**
 * @typedef {object} BreachParameters
 * @property {number} averageWidth  average breach width, m
 * @property {number} bottomWidth   trapezoid bottom width, m
 * @property {number} sideSlope     horizontal run per unit vertical rise, dimensionless
 * @property {number} formationSeconds breach formation time, s
 * @property {string} method        which published equation produced this
 * @property {string[]} notes       caveats worth showing the user
 */

/**
 * Froehlich (2008) breach parameters.
 *
 * Froehlich, D. C. (2008). "Embankment dam breach parameters and their uncertainties."
 * Journal of Hydraulic Engineering, 134(12), 1708-1721. Fitted to 74 embankment dam
 * failures.
 *
 *   B_avg = 0.27 * k_o * V_w^0.32 * h_b^0.04
 *   t_f   = 63.2 * sqrt(V_w / (g * h_b^2))
 *
 * k_o is 1.3 for overtopping and 1.0 for piping. Side slopes are 1.0H:1V for
 * overtopping and 0.7H:1V for piping and seepage.
 *
 * Check t_f dimensionally: m^3 / ((m/s^2) * m^2) = s^2, so the root is in seconds.
 *
 * @param {object} params
 * @param {number} params.reservoirVolume V_w, reservoir volume at failure, m^3
 * @param {number} params.breachHeight h_b, height of the final breach, m
 * @param {FailureMode} [params.mode='overtopping']
 * @returns {BreachParameters}
 */
export function froehlich2008({ reservoirVolume, breachHeight, mode = 'overtopping' }) {
  const notes = [];

  const volume = Math.max(reservoirVolume, 1);
  const height = Math.max(breachHeight, 0.1);

  if (reservoirVolume < 1e4) {
    notes.push(
      'Reservoir volume is far below the range Froehlich fitted. Treat the breach ' +
        'geometry as a rough guess.',
    );
  }
  if (height < 3) {
    notes.push('Dam height is below the range of the fitted data.');
  }

  const modeCoefficient = mode === 'overtopping' ? 1.3 : 1.0;
  const sideSlope = mode === 'overtopping' ? 1.0 : 0.7;

  const averageWidth = 0.27 * modeCoefficient * Math.pow(volume, 0.32) * Math.pow(height, 0.04);
  const formationSeconds = 63.2 * Math.sqrt(volume / (GRAVITY * height * height));

  // B_avg is the average width of a trapezoid of height h_b with the given side slopes,
  // so the bottom width is the average less one slope width. Clamped at zero, which is
  // the degenerate triangular breach for a tall, narrow opening.
  const bottomWidth = Math.max(0, averageWidth - sideSlope * height);
  if (bottomWidth === 0) {
    notes.push(
      'The predicted average width is narrower than the side slopes require, so the ' +
        'breach is triangular rather than trapezoidal.',
    );
  }

  return {
    averageWidth,
    bottomWidth,
    sideSlope,
    formationSeconds,
    method: 'Froehlich (2008)',
    notes,
  };
}

/**
 * Froehlich (1995) breach parameters, retained as an alternative.
 *
 * As reproduced in FEMA P-946 Table 9-1:
 *
 *   B_avg = 0.1803 * k_o * V_w^0.32 * h_b^0.19
 *   t_f   = 0.00254 * V_w^0.53 * h_b^(-0.90)      <-- RESULT IS IN HOURS
 *
 * k_o is 1.4 for overtopping and 1.0 otherwise. Side slope factors 1.4 overtopping,
 * 0.9 otherwise.
 *
 * The unit difference in t_f from the 2008 equation is a genuine trap and is converted
 * explicitly here.
 *
 * @param {object} params
 * @param {number} params.reservoirVolume m^3
 * @param {number} params.breachHeight m
 * @param {FailureMode} [params.mode='overtopping']
 * @returns {BreachParameters}
 */
export function froehlich1995({ reservoirVolume, breachHeight, mode = 'overtopping' }) {
  const volume = Math.max(reservoirVolume, 1);
  const height = Math.max(breachHeight, 0.1);

  const modeCoefficient = mode === 'overtopping' ? 1.4 : 1.0;
  const sideSlope = mode === 'overtopping' ? 1.4 : 0.9;

  const averageWidth = 0.1803 * modeCoefficient * Math.pow(volume, 0.32) * Math.pow(height, 0.19);
  const formationHours = 0.00254 * Math.pow(volume, 0.53) * Math.pow(height, -0.9);

  return {
    averageWidth,
    bottomWidth: Math.max(0, averageWidth - sideSlope * height),
    sideSlope,
    formationSeconds: formationHours * 3600,
    method: 'Froehlich (1995)',
    notes: ['Formation time from this equation is published in hours and converted here.'],
  };
}

/**
 * Von Thun & Gillette (1990) storage coefficient C_b, in metres, keyed by reservoir
 * storage in cubic metres.
 *
 * The published table is in acre-feet and feet. The thresholds below are written as the
 * acre-foot figures times the exact conversion factor, rather than as rounded metric
 * numbers, so the derivation stays visible and cannot drift. The C_b values are the
 * published 20, 60, 140 and 180 feet converted to metres.
 */
export const VON_THUN_CB = [
  { maxStorage: 1000 * 1233.48183754752, cb: 6.1 },
  { maxStorage: 5000 * 1233.48183754752, cb: 18.3 },
  { maxStorage: 10000 * 1233.48183754752, cb: 42.7 },
  { maxStorage: Infinity, cb: 54.9 },
];

/**
 * Von Thun & Gillette (1990) average breach width.
 *
 *   B_avg = 2.5 * h_w + C_b
 *
 * Only the width equation is implemented. Their formation time relationships are not,
 * because the published forms differ between secondary sources and the Hydraulics Rule
 * forbids guessing. Formation time falls back to Froehlich (2008).
 *
 * @param {object} params
 * @param {number} params.waterDepthAboveBreach h_w, m
 * @param {number} params.reservoirVolume m^3
 * @param {number} params.breachHeight m
 * @param {FailureMode} [params.mode='overtopping']
 * @returns {BreachParameters}
 */
export function vonThunGillette({
  waterDepthAboveBreach,
  reservoirVolume,
  breachHeight,
  mode = 'overtopping',
}) {
  const entry = VON_THUN_CB.find((row) => reservoirVolume <= row.maxStorage) ?? VON_THUN_CB.at(-1);
  const averageWidth = 2.5 * Math.max(waterDepthAboveBreach, 0) + entry.cb;

  // Von Thun & Gillette describe breach side slopes of 1.0H:1V for most embankments.
  const sideSlope = 1.0;
  const height = Math.max(breachHeight, 0.1);

  const timing = froehlich2008({ reservoirVolume, breachHeight: height, mode });

  return {
    averageWidth,
    bottomWidth: Math.max(0, averageWidth - sideSlope * height),
    sideSlope,
    formationSeconds: timing.formationSeconds,
    method: 'Von Thun & Gillette (1990) width, Froehlich (2008) timing',
    notes: [
      'Von Thun & Gillette give width only in this implementation. Formation time comes ' +
        'from Froehlich (2008).',
    ],
  };
}

/** The estimation methods offered in the UI. */
export const BREACH_METHODS = {
  'froehlich-2008': { label: 'Froehlich (2008)', fn: froehlich2008 },
  'froehlich-1995': { label: 'Froehlich (1995)', fn: froehlich1995 },
  'von-thun-gillette': { label: 'Von Thun & Gillette (1990)', fn: vonThunGillette },
};

/**
 * Breach progression curves. See docs/hydraulics.md section 2.4.
 *
 * Each maps normalised elapsed time tau in [0, 1] to the fraction of the final opening
 * that exists. The same fraction scales both width and depth, so the notch grows in both
 * dimensions together.
 */
export const PROGRESSION_CURVES = {
  linear: {
    label: 'Linear',
    describe: 'Opens at a constant rate. The conservative default in many studies.',
    fn: (tau) => tau,
  },
  sinusoidal: {
    label: 'Sinusoidal',
    describe: 'Gentle at the start and end. Usually the most realistic erosional failure.',
    fn: (tau) => 0.5 - 0.5 * Math.cos(Math.PI * tau),
  },
  quadratic: {
    label: 'Quadratic (accelerating)',
    describe: 'Slow start that accelerates. Closer to a piping failure that collapses.',
    fn: (tau) => tau * tau,
  },
  instant: {
    label: 'Instantaneous',
    describe: 'The whole breach exists at t=0. An upper bound, not a real failure.',
    fn: () => 1,
  },
};

/**
 * Breach opening at a moment in time.
 *
 * @param {number} timeSeconds simulation time since breach initiation
 * @param {object} params
 * @param {number} params.formationSeconds t_f
 * @param {number} params.finalBottomWidth m
 * @param {number} params.finalDepth vertical drop from crest to breach invert, m
 * @param {number} params.crestElevation m
 * @param {number} params.sideSlope horizontal run per unit rise
 * @param {keyof PROGRESSION_CURVES} [params.progression='sinusoidal']
 * @returns {{fraction: number, bottomWidth: number, depth: number, invertElevation: number,
 *   topWidth: number, complete: boolean}}
 */
export function breachOpeningAt(timeSeconds, params) {
  const {
    formationSeconds,
    finalBottomWidth,
    finalDepth,
    crestElevation,
    sideSlope,
    progression = 'sinusoidal',
  } = params;

  const curve = PROGRESSION_CURVES[progression] ?? PROGRESSION_CURVES.sinusoidal;

  const tau =
    formationSeconds > 0 ? Math.min(1, Math.max(0, timeSeconds / formationSeconds)) : 1;
  const fraction = Math.min(1, Math.max(0, curve.fn(tau)));

  const depth = finalDepth * fraction;
  const bottomWidth = finalBottomWidth * fraction;

  return {
    fraction,
    bottomWidth,
    depth,
    invertElevation: crestElevation - depth,
    topWidth: bottomWidth + 2 * sideSlope * depth,
    complete: tau >= 1,
  };
}

/**
 * Discharge through a trapezoidal opening treated as a weir.
 *
 * This is the textbook decomposition of a trapezoidal weir into a rectangular section
 * plus the two side triangles, both derived from Bernoulli rather than regressed from
 * data, which is why the coefficients are transparent:
 *
 *   rectangular:  Q = (2/3) * Cd * sqrt(2g) * B * H^(3/2)
 *   triangular:   Q = (8/15) * Cd * sqrt(2g) * z * H^(5/2)
 *
 * The two side triangles of a trapezoid with side slope z (horizontal run per unit rise)
 * together form one triangle whose half-angle tangent is z, which is why a single
 * triangular term covers both sides.
 *
 * With Cd = 0.6 the rectangular coefficient evaluates to about 1.77, consistent with the
 * usual broad-crested weir value of 1.7 in SI. Cd is exposed as a setting rather than
 * fixed, because the appropriate value for a breach is genuinely uncertain and that is
 * the operator's call, not this file's.
 *
 * Reference: standard weir hydraulics, e.g. Chow, V. T. (1959), Open-Channel Hydraulics,
 * and Henderson, F. M. (1966), Open Channel Flow.
 *
 * Submergence is handled with the Villemonte (1947) correction, which reduces discharge
 * as tailwater rises toward the upstream head.
 *
 * @param {object} params
 * @param {number} params.bottomWidth B, m
 * @param {number} params.sideSlope z, dimensionless
 * @param {number} params.head H, upstream head above the breach invert, m
 * @param {number} [params.tailwaterHead] downstream head above the invert, m
 * @param {number} [params.dischargeCoefficient=0.6] Cd
 * @returns {number} discharge in m^3/s
 */
export function trapezoidalWeirDischarge({
  bottomWidth,
  sideSlope,
  head,
  tailwaterHead = 0,
  dischargeCoefficient = 0.6,
}) {
  if (!(head > 0)) return 0;

  const k = dischargeCoefficient * Math.sqrt(2 * GRAVITY);
  const rectangular = (2 / 3) * k * Math.max(0, bottomWidth) * Math.pow(head, 1.5);
  const triangular = (8 / 15) * k * Math.max(0, sideSlope) * Math.pow(head, 2.5);
  const freeDischarge = rectangular + triangular;

  if (tailwaterHead <= 0) return freeDischarge;

  // Villemonte (1947) submerged weir correction.
  const ratio = Math.min(0.999, tailwaterHead / head);
  const reduction = Math.pow(1 - Math.pow(ratio, 1.5), 0.385);
  return freeDischarge * reduction;
}

/**
 * Analytic peak outflow estimate, used as the reference line on the hydrograph chart.
 *
 * Evaluates the weir discharge through the fully-formed breach at the initial reservoir
 * head. That is an upper bound on outflow: in reality the reservoir draws down while the
 * breach is still forming, so the real peak is lower, and by how much is exactly the
 * thing the simulation answers.
 *
 * Froehlich (2008) also published a peak outflow regression. It is deliberately not used
 * here, because its storage coefficient is published in acre-feet and feet and importing
 * it without confirming the conversion against the original paper would be guesswork.
 * See open question Q-007.
 *
 * @param {object} params
 * @param {number} params.bottomWidth m
 * @param {number} params.sideSlope dimensionless
 * @param {number} params.initialHead m, reservoir surface above the final breach invert
 * @param {number} [params.dischargeCoefficient=0.6]
 * @returns {{peakDischarge: number, basis: string}}
 */
export function analyticPeakOutflow({
  bottomWidth,
  sideSlope,
  initialHead,
  dischargeCoefficient = 0.6,
}) {
  const peakDischarge = trapezoidalWeirDischarge({
    bottomWidth,
    sideSlope,
    head: initialHead,
    dischargeCoefficient,
  });

  return {
    peakDischarge,
    basis:
      'Weir discharge through the fully formed breach at the starting reservoir level. ' +
      'An upper bound, because the reservoir drains while the breach is still opening.',
  };
}

/**
 * Convert the user's percentage controls into absolute breach geometry.
 *
 * The brief asks for "how quickly or a percentage of a dam failure", so the percentages
 * are the primary controls and the published equations are an optional way to fill them
 * in. This keeps the user in charge.
 *
 * @param {object} params
 * @param {number} params.damLength length of the dam crest line, m
 * @param {number} params.damHeight crest elevation above the valley floor at the dam, m
 * @param {number} params.widthPercent percentage of the dam length that fails, 0-100
 * @param {number} params.depthPercent percentage of the dam height that erodes, 0-100
 * @param {FailureMode} [params.mode='overtopping']
 * @returns {{bottomWidth: number, depth: number, sideSlope: number}}
 */
export function geometryFromPercentages({
  damLength,
  damHeight,
  widthPercent,
  depthPercent,
  mode = 'overtopping',
}) {
  const sideSlope = mode === 'overtopping' ? 1.0 : 0.7;
  const depth = damHeight * Math.min(100, Math.max(0, depthPercent)) / 100;
  const topWidth = damLength * Math.min(100, Math.max(0, widthPercent)) / 100;

  // The user's percentage describes the opening in the crest, which is the top of the
  // trapezoid. Work back to the bottom width.
  const bottomWidth = Math.max(0, topWidth - 2 * sideSlope * depth);

  return { bottomWidth, depth, sideSlope };
}

/**
 * Convert absolute breach geometry back into the percentage controls, so that pressing
 * "estimate" updates the sliders to consistent values.
 *
 * @param {object} params
 * @param {number} params.damLength m
 * @param {number} params.damHeight m
 * @param {number} params.bottomWidth m
 * @param {number} params.depth m
 * @param {number} params.sideSlope dimensionless
 * @returns {{widthPercent: number, depthPercent: number}}
 */
export function percentagesFromGeometry({
  damLength,
  damHeight,
  bottomWidth,
  depth,
  sideSlope,
}) {
  const topWidth = bottomWidth + 2 * sideSlope * depth;
  return {
    widthPercent: damLength > 0 ? Math.min(100, (topWidth / damLength) * 100) : 0,
    depthPercent: damHeight > 0 ? Math.min(100, (depth / damHeight) * 100) : 0,
  };
}
