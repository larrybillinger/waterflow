/**
 * Breach equation tests.
 *
 * Each published equation is checked against a hand calculation worked from the
 * citation in docs/hydraulics.md, not against whatever the code happens to produce.
 * That is the only kind of test that can catch a transcription error in a coefficient.
 */

import { describe, it, expect } from 'vitest';

import {
  froehlich2008,
  froehlich1995,
  vonThunGillette,
  VON_THUN_CB,
  PROGRESSION_CURVES,
  breachOpeningAt,
  trapezoidalWeirDischarge,
  analyticPeakOutflow,
  geometryFromPercentages,
  percentagesFromGeometry,
} from '../src/sim/breach.js';
import { GRAVITY } from '../src/config.js';

describe('Froehlich (2008)', () => {
  // Hand calculation for Vw = 1e8 m^3, hb = 30 m, overtopping so ko = 1.3:
  //
  //   B_avg = 0.27 * 1.3 * (1e8)^0.32 * 30^0.04
  //         = 0.351 * 363.078 * 1.14574
  //         = 146.0 m
  //
  //   t_f   = 63.2 * sqrt(1e8 / (9.80665 * 900))
  //         = 63.2 * sqrt(11330.6)
  //         = 63.2 * 106.446
  //         = 6727 s  (1.87 hours)
  const result = froehlich2008({
    reservoirVolume: 1e8,
    breachHeight: 30,
    mode: 'overtopping',
  });

  it('matches the hand-calculated average width', () => {
    expect(result.averageWidth).toBeCloseTo(146.0, 0);
  });

  it('matches the hand-calculated formation time', () => {
    expect(result.formationSeconds).toBeCloseTo(6727, -1);
  });

  it('produces a formation time in seconds, not hours', () => {
    // A common transcription error is to mix the 1995 equation's hours with the 2008
    // equation's seconds. 6727 seconds is plausible; 6727 hours is not.
    expect(result.formationSeconds / 3600).toBeGreaterThan(0.5);
    expect(result.formationSeconds / 3600).toBeLessThan(10);
  });

  it('uses the published side slopes', () => {
    expect(result.sideSlope).toBe(1.0);
    expect(
      froehlich2008({ reservoirVolume: 1e8, breachHeight: 30, mode: 'piping' }).sideSlope,
    ).toBe(0.7);
  });

  it('applies the mode coefficient, so overtopping is wider than piping', () => {
    const piping = froehlich2008({ reservoirVolume: 1e8, breachHeight: 30, mode: 'piping' });
    expect(result.averageWidth / piping.averageWidth).toBeCloseTo(1.3, 3);
  });

  it('derives the bottom width from the average width and the side slope', () => {
    expect(result.bottomWidth).toBeCloseTo(result.averageWidth - 1.0 * 30, 6);
  });

  it('satisfies its own formula directly', () => {
    const vw = 4.2e7;
    const hb = 22;
    const expected = 0.27 * 1.3 * Math.pow(vw, 0.32) * Math.pow(hb, 0.04);
    const check = froehlich2008({ reservoirVolume: vw, breachHeight: hb });
    expect(check.averageWidth).toBeCloseTo(expected, 8);
    expect(check.formationSeconds).toBeCloseTo(
      63.2 * Math.sqrt(vw / (GRAVITY * hb * hb)),
      8,
    );
  });

  it('widens with reservoir volume and shortens with dam height', () => {
    const small = froehlich2008({ reservoirVolume: 1e7, breachHeight: 30 });
    const large = froehlich2008({ reservoirVolume: 1e9, breachHeight: 30 });
    expect(large.averageWidth).toBeGreaterThan(small.averageWidth);

    const low = froehlich2008({ reservoirVolume: 1e8, breachHeight: 10 });
    const high = froehlich2008({ reservoirVolume: 1e8, breachHeight: 60 });
    // Taller dams fail faster, which the equation captures through the h^2 denominator.
    expect(high.formationSeconds).toBeLessThan(low.formationSeconds);
  });

  it('flags a reservoir far outside the fitted range', () => {
    const tiny = froehlich2008({ reservoirVolume: 500, breachHeight: 2 });
    expect(tiny.notes.length).toBeGreaterThan(0);
  });

  it('degenerates to a triangular breach rather than a negative width', () => {
    // A very tall dam with a small reservoir: the average width is less than the side
    // slope width, so the bottom width should clamp at zero.
    const narrow = froehlich2008({ reservoirVolume: 1e5, breachHeight: 90 });
    expect(narrow.bottomWidth).toBe(0);
    expect(narrow.notes.join(' ')).toMatch(/triangular/);
  });
});

describe('Froehlich (1995)', () => {
  // Hand calculation for Vw = 1e8, hb = 30, overtopping so ko = 1.4:
  //   B_avg = 0.1803 * 1.4 * (1e8)^0.32 * 30^0.19
  //         = 0.25242 * 363.078 * 1.90843 = 174.9 m
  //   t_f   = 0.00254 * (1e8)^0.53 * 30^-0.90
  //         = 0.00254 * 17378.0 * 0.046857 = 2.069 hours = 7448 s
  const result = froehlich1995({
    reservoirVolume: 1e8,
    breachHeight: 30,
    mode: 'overtopping',
  });

  it('matches the hand-calculated average width', () => {
    expect(result.averageWidth).toBeCloseTo(174.9, 0);
  });

  it('converts its formation time from hours to seconds', () => {
    expect(result.formationSeconds).toBeCloseTo(7448, -2);
  });

  it('uses the 1995 mode coefficient of 1.4, not the 2008 value of 1.3', () => {
    const piping = froehlich1995({ reservoirVolume: 1e8, breachHeight: 30, mode: 'piping' });
    expect(result.averageWidth / piping.averageWidth).toBeCloseTo(1.4, 3);
  });

  it('says in its notes that the unit conversion happened', () => {
    expect(result.notes.join(' ')).toMatch(/hours/);
  });
});

describe('Von Thun & Gillette (1990)', () => {
  it('matches B = 2.5 h_w + C_b', () => {
    // A reservoir over 1.2335e7 m^3 takes C_b = 54.9 m.
    const result = vonThunGillette({
      waterDepthAboveBreach: 44.26,
      reservoirVolume: 5e7,
      breachHeight: 44.26,
    });
    expect(result.averageWidth).toBeCloseTo(2.5 * 44.26 + 54.9, 6);
  });

  it('picks the storage coefficient from the published table', () => {
    const expectations = [
      [1e6, 6.1],
      [3e6, 18.3],
      [1e7, 42.7],
      [1e8, 54.9],
    ];

    for (const [volume, cb] of expectations) {
      const result = vonThunGillette({
        waterDepthAboveBreach: 10,
        reservoirVolume: volume,
        breachHeight: 10,
      });
      expect(result.averageWidth).toBeCloseTo(25 + cb, 6);
    }
  });

  it('has a table whose thresholds are exact acre-foot conversions', () => {
    // 1000, 5000 and 10000 acre-feet at exactly 1233.48183754752 m^3 each.
    expect(VON_THUN_CB[0].maxStorage).toBeCloseTo(1000 * 1233.48183754752, 6);
    expect(VON_THUN_CB[1].maxStorage).toBeCloseTo(5000 * 1233.48183754752, 6);
    expect(VON_THUN_CB[2].maxStorage).toBeCloseTo(10000 * 1233.48183754752, 6);
    expect(VON_THUN_CB[3].maxStorage).toBe(Infinity);
  });

  it('has C_b values that are the published feet converted to metres', () => {
    // 20, 60, 140 and 180 feet at 0.3048 m per foot.
    expect(VON_THUN_CB[0].cb).toBeCloseTo(20 * 0.3048, 1);
    expect(VON_THUN_CB[1].cb).toBeCloseTo(60 * 0.3048, 1);
    expect(VON_THUN_CB[2].cb).toBeCloseTo(140 * 0.3048, 1);
    expect(VON_THUN_CB[3].cb).toBeCloseTo(180 * 0.3048, 1);
  });

  it('says plainly that the timing comes from elsewhere', () => {
    const result = vonThunGillette({
      waterDepthAboveBreach: 20,
      reservoirVolume: 1e7,
      breachHeight: 20,
    });
    expect(result.method).toMatch(/Froehlich/);
    expect(result.notes.join(' ')).toMatch(/width only/);
  });
});

describe('progression curves', () => {
  it('all start closed and finish fully open', () => {
    for (const [id, curve] of Object.entries(PROGRESSION_CURVES)) {
      if (id === 'instant') {
        expect(curve.fn(0)).toBe(1);
        continue;
      }
      expect(curve.fn(0)).toBeCloseTo(0, 9);
      expect(curve.fn(1)).toBeCloseTo(1, 9);
    }
  });

  it('are monotonic, so a breach never closes up again', () => {
    for (const curve of Object.values(PROGRESSION_CURVES)) {
      let previous = -Infinity;
      for (let i = 0; i <= 50; i += 1) {
        const value = curve.fn(i / 50);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = value;
      }
    }
  });

  it('opens the sinusoidal curve gently at each end, so it lags linear then overtakes it', () => {
    // This is the defining property: an erosional failure starts slowly, accelerates
    // through the middle, and eases off as the breach reaches its final size. So the
    // sinusoidal curve sits below linear in the first half and above it in the second.
    expect(PROGRESSION_CURVES.sinusoidal.fn(0.25)).toBeLessThan(
      PROGRESSION_CURVES.linear.fn(0.25),
    );
    expect(PROGRESSION_CURVES.sinusoidal.fn(0.75)).toBeGreaterThan(
      PROGRESSION_CURVES.linear.fn(0.75),
    );
    expect(PROGRESSION_CURVES.sinusoidal.fn(0.5)).toBeCloseTo(0.5, 9);
  });

  it('keeps the quadratic curve the slowest to open throughout', () => {
    for (const tau of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(PROGRESSION_CURVES.quadratic.fn(tau)).toBeLessThanOrEqual(
        PROGRESSION_CURVES.linear.fn(tau) + 1e-9,
      );
    }
  });
});

describe('breachOpeningAt', () => {
  const params = {
    formationSeconds: 3600,
    finalBottomWidth: 100,
    finalDepth: 30,
    crestElevation: 500,
    sideSlope: 1,
    progression: 'linear',
  };

  it('is closed at time zero', () => {
    const opening = breachOpeningAt(0, params);
    expect(opening.fraction).toBe(0);
    expect(opening.bottomWidth).toBe(0);
    expect(opening.depth).toBe(0);
    expect(opening.invertElevation).toBe(500);
  });

  it('is fully formed at the formation time', () => {
    const opening = breachOpeningAt(3600, params);
    expect(opening.fraction).toBeCloseTo(1, 9);
    expect(opening.bottomWidth).toBeCloseTo(100, 9);
    expect(opening.invertElevation).toBeCloseTo(470, 9);
    expect(opening.complete).toBe(true);
  });

  it('does not keep growing after it is formed', () => {
    const later = breachOpeningAt(100000, params);
    expect(later.bottomWidth).toBeCloseTo(100, 9);
    expect(later.depth).toBeCloseTo(30, 9);
  });

  it('is fully open immediately when the formation time is zero', () => {
    const opening = breachOpeningAt(0, { ...params, formationSeconds: 0 });
    expect(opening.fraction).toBe(1);
  });

  it('computes a top width consistent with the side slopes', () => {
    const opening = breachOpeningAt(1800, params);
    expect(opening.topWidth).toBeCloseTo(opening.bottomWidth + 2 * 1 * opening.depth, 9);
  });
});

describe('trapezoidal weir discharge', () => {
  it('matches the textbook decomposition', () => {
    // Cd = 0.6, B = 100 m, z = 1, H = 10 m.
    //   k    = 0.6 * sqrt(2 * 9.80665)         = 2.6572143
    //   rect = (2/3) * k * 100 * 10^1.5        = 5601.900
    //   tri  = (8/15) * k * 1 * 10^2.5         =  448.152
    //   total                                  = 6050.052
    const q = trapezoidalWeirDischarge({
      bottomWidth: 100,
      sideSlope: 1,
      head: 10,
      dischargeCoefficient: 0.6,
    });
    expect(q).toBeCloseTo(6050.05, 1);
  });

  it('has an effective rectangular coefficient near the usual 1.7 for SI', () => {
    // Q / (B * H^1.5) for a rectangular opening should land close to 1.77.
    const q = trapezoidalWeirDischarge({
      bottomWidth: 50,
      sideSlope: 0,
      head: 4,
      dischargeCoefficient: 0.6,
    });
    const coefficient = q / (50 * Math.pow(4, 1.5));
    expect(coefficient).toBeGreaterThan(1.6);
    expect(coefficient).toBeLessThan(1.9);
  });

  it('is zero with no head', () => {
    expect(trapezoidalWeirDischarge({ bottomWidth: 50, sideSlope: 1, head: 0 })).toBe(0);
    expect(trapezoidalWeirDischarge({ bottomWidth: 50, sideSlope: 1, head: -3 })).toBe(0);
  });

  it('rises as the three-halves power of head for a rectangular opening', () => {
    const q1 = trapezoidalWeirDischarge({ bottomWidth: 40, sideSlope: 0, head: 2 });
    const q2 = trapezoidalWeirDischarge({ bottomWidth: 40, sideSlope: 0, head: 8 });
    // Four times the head is eight times the discharge.
    expect(q2 / q1).toBeCloseTo(Math.pow(4, 1.5), 6);
  });

  it('is reduced by tailwater submergence', () => {
    const free = trapezoidalWeirDischarge({ bottomWidth: 60, sideSlope: 1, head: 6 });
    const submerged = trapezoidalWeirDischarge({
      bottomWidth: 60,
      sideSlope: 1,
      head: 6,
      tailwaterHead: 5,
    });
    expect(submerged).toBeLessThan(free);
    expect(submerged).toBeGreaterThan(0);
  });
});

describe('analyticPeakOutflow', () => {
  it('equals the weir discharge at the starting head', () => {
    const result = analyticPeakOutflow({ bottomWidth: 120, sideSlope: 1, initialHead: 25 });
    const direct = trapezoidalWeirDischarge({
      bottomWidth: 120,
      sideSlope: 1,
      head: 25,
      dischargeCoefficient: 0.6,
    });
    expect(result.peakDischarge).toBeCloseTo(direct, 6);
  });

  it('describes itself as an upper bound', () => {
    const result = analyticPeakOutflow({ bottomWidth: 50, sideSlope: 1, initialHead: 10 });
    expect(result.basis).toMatch(/upper bound/);
  });
});

describe('percentage controls', () => {
  it('round trips geometry through percentages', () => {
    const damLength = 800;
    const damHeight = 40;

    const geometry = geometryFromPercentages({
      damLength,
      damHeight,
      widthPercent: 35,
      depthPercent: 100,
      mode: 'overtopping',
    });

    const back = percentagesFromGeometry({
      damLength,
      damHeight,
      bottomWidth: geometry.bottomWidth,
      depth: geometry.depth,
      sideSlope: geometry.sideSlope,
    });

    expect(back.widthPercent).toBeCloseTo(35, 6);
    expect(back.depthPercent).toBeCloseTo(100, 6);
  });

  it('treats the percentage as the opening in the crest', () => {
    const geometry = geometryFromPercentages({
      damLength: 1000,
      damHeight: 50,
      widthPercent: 50,
      depthPercent: 100,
      mode: 'overtopping',
    });
    // Top width should be half the dam length.
    const topWidth = geometry.bottomWidth + 2 * geometry.sideSlope * geometry.depth;
    expect(topWidth).toBeCloseTo(500, 6);
  });

  it('clamps the bottom width at zero for a narrow, deep breach', () => {
    const geometry = geometryFromPercentages({
      damLength: 100,
      damHeight: 60,
      widthPercent: 5,
      depthPercent: 100,
      mode: 'overtopping',
    });
    expect(geometry.bottomWidth).toBe(0);
  });

  it('clamps percentages into range', () => {
    const over = geometryFromPercentages({
      damLength: 500,
      damHeight: 30,
      widthPercent: 400,
      depthPercent: 400,
      mode: 'overtopping',
    });
    expect(over.depth).toBeCloseTo(30, 6);
  });
});
