/**
 * Canvas charts: the outflow hydrograph and the valley long profile.
 *
 * Both follow the project's data visualisation rules:
 *
 *   One y-axis per chart. Never two scales. Discharge and elevation are different
 *   measures and live in different charts.
 *
 *   Series colours come from the validated categorical palette, assigned in fixed slot
 *   order. Slot 1 blue and slot 2 orange were checked against this app's dark panel
 *   surface: worst-pair colour-vision-deficiency separation 26.8 and normal-vision 31.8
 *   on the OKLab scale, both comfortably clear of the 8 and 15 floors, and both above
 *   3:1 contrast against the surface.
 *
 *   Identity is never carried by colour alone. The two-series chart has a legend and
 *   direct labels on the lines.
 *
 *   Text wears text tokens, not the series colour. A coloured swatch next to a label
 *   carries the identity; the words stay in ink.
 *
 *   Grid and axes are recessive. The data is the loudest thing on the canvas.
 *
 *   Reference lines are annotations, not series, so they are drawn in muted ink and
 *   dashed rather than given a palette colour that would imply another measurement.
 *
 * Charts are interactive by default: both carry a crosshair and a readout on hover.
 */

/** Validated categorical slots for this app's dark surface. */
const SERIES = {
  slot1: '#3987e5',
  slot2: '#d95926',
};

const INK = {
  primary: '#e8eef5',
  secondary: '#9fb0c3',
  muted: '#6c7f94',
  grid: 'rgba(130, 160, 190, 0.14)',
  axis: 'rgba(130, 160, 190, 0.34)',
  surface: '#0e151f',
};

/**
 * Choose round axis tick values covering a range.
 *
 * Ticks at arbitrary values make a reader do arithmetic. Ticks at 1, 2, 5 and their
 * decades do not.
 *
 * @param {number} min
 * @param {number} max
 * @param {number} [target=5] desired tick count
 * @returns {{ticks: number[], min: number, max: number, step: number}}
 */
export function niceScale(min, max, target = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { ticks: [0, 1], min: 0, max: 1, step: 1 };
  }

  const roughStep = (max - min) / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalised = roughStep / magnitude;

  let step;
  if (normalised <= 1) step = magnitude;
  else if (normalised <= 2) step = 2 * magnitude;
  else if (normalised <= 5) step = 5 * magnitude;
  else step = 10 * magnitude;

  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks = [];
  // Epsilon guards against the last tick being dropped by floating point drift.
  for (let v = niceMin; v <= niceMax + step * 1e-6; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }

  return { ticks, min: niceMin, max: niceMax, step };
}

/** Format a number with a sensible number of significant figures for an axis. */
function axisFormat(value, step) {
  if (value === 0) return '0';
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  if (Math.abs(value) >= 10000) {
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  }
  return value.toFixed(decimals);
}

/** Simulation time as a compact axis label. */
function timeFormat(seconds) {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  const hours = seconds / 3600;
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
}

/**
 * Base canvas chart: sizing, axes, grid, hover.
 */
class CanvasChart {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @param {number} [options.height] CSS pixels
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.cssHeight = options.height ?? 150;
    this.context = canvas.getContext('2d');

    // Generous left margin: a discharge axis can reach five digits and a clipped axis
    // label is worse than a narrower plot.
    this.padding = { top: 12, right: 14, bottom: 26, left: 52 };

    this.hover = null;
    this.#bindHover();
  }

  #bindHover() {
    const onMove = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      this.hover = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      this.redraw();
    };

    const onLeave = () => {
      this.hover = null;
      this.redraw();
    };

    this.canvas.addEventListener('pointermove', onMove);
    this.canvas.addEventListener('pointerleave', onLeave);
    this.#listeners = [
      ['pointermove', onMove],
      ['pointerleave', onLeave],
    ];
  }

  #listeners = [];

  /** Match the backing store to the CSS size and device pixel ratio. */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = this.canvas.clientWidth || 300;

    this.canvas.style.height = `${this.cssHeight}px`;

    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(this.cssHeight * dpr);

    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }

    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = width;
    this.height = this.cssHeight;

    this.plot = {
      x: this.padding.left,
      y: this.padding.top,
      w: Math.max(10, width - this.padding.left - this.padding.right),
      h: Math.max(10, this.cssHeight - this.padding.top - this.padding.bottom),
    };
  }

  clear() {
    this.context.clearRect(0, 0, this.width, this.height);
  }

  /** Placeholder, overridden by subclasses so hover can trigger a redraw. */
  redraw() {}

  /**
   * Draw the axes, grid and axis titles.
   *
   * @param {object} params
   * @param {{ticks: number[], min: number, max: number, step: number}} params.xScale
   * @param {{ticks: number[], min: number, max: number, step: number}} params.yScale
   * @param {(v: number) => string} params.formatX
   * @param {(v: number) => string} params.formatY
   * @param {string} params.yTitle
   * @param {string} params.xTitle
   */
  drawAxes({ xScale, yScale, formatX, formatY, yTitle, xTitle }) {
    const ctx = this.context;
    const { x, y, w, h } = this.plot;

    ctx.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
    ctx.lineWidth = 1;

    // Horizontal grid lines, recessive.
    ctx.strokeStyle = INK.grid;
    ctx.fillStyle = INK.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (const tick of yScale.ticks) {
      const py = y + h - ((tick - yScale.min) / (yScale.max - yScale.min)) * h;
      ctx.beginPath();
      ctx.moveTo(x, Math.round(py) + 0.5);
      ctx.lineTo(x + w, Math.round(py) + 0.5);
      ctx.stroke();
      ctx.fillText(formatY(tick), x - 7, py);
    }

    // X ticks: labels only, no vertical grid. Vertical grid on a time series competes
    // with the line for attention and adds nothing a tick mark does not.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const tick of xScale.ticks) {
      const px = x + ((tick - xScale.min) / (xScale.max - xScale.min)) * w;
      ctx.strokeStyle = INK.axis;
      ctx.beginPath();
      ctx.moveTo(Math.round(px) + 0.5, y + h);
      ctx.lineTo(Math.round(px) + 0.5, y + h + 3);
      ctx.stroke();
      ctx.fillStyle = INK.muted;
      ctx.fillText(formatX(tick), px, y + h + 6);
    }

    // Baseline.
    ctx.strokeStyle = INK.axis;
    ctx.beginPath();
    ctx.moveTo(x, Math.round(y + h) + 0.5);
    ctx.lineTo(x + w, Math.round(y + h) + 0.5);
    ctx.stroke();

    // Axis titles. The y title is rotated, which is the only way to fit a unit string
    // next to a narrow plot without stealing width from the data.
    ctx.save();
    ctx.fillStyle = INK.secondary;
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.translate(11, y + h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(yTitle, 0, 0);
    ctx.restore();

    ctx.fillStyle = INK.secondary;
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(xTitle, x + w, this.height - 1);
  }

  /**
   * Draw a crosshair and a readout box.
   *
   * @param {number} px
   * @param {string[]} lines
   */
  drawReadout(px, lines) {
    const ctx = this.context;
    const { x, y, w, h } = this.plot;

    ctx.strokeStyle = 'rgba(232, 238, 245, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(px) + 0.5, y);
    ctx.lineTo(Math.round(px) + 0.5, y + h);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    const boxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 14;
    const boxHeight = lines.length * 13 + 9;

    // Flip the box to the other side of the crosshair near the right edge, so it is
    // never clipped.
    let boxX = px + 9;
    if (boxX + boxWidth > x + w) boxX = px - boxWidth - 9;
    const boxY = y + 4;

    ctx.fillStyle = 'rgba(8, 13, 20, 0.93)';
    ctx.strokeStyle = 'rgba(140, 200, 240, 0.4)';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = INK.primary;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, boxX + 7, boxY + 5 + i * 13);
    });
  }

  /** Centre a message when there is nothing to plot. */
  drawEmpty(message) {
    const ctx = this.context;
    ctx.fillStyle = INK.muted;
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, this.width / 2, this.height / 2);
  }

  dispose() {
    for (const [type, handler] of this.#listeners) {
      this.canvas.removeEventListener(type, handler);
    }
  }
}

/**
 * Outflow hydrograph: discharge through the breach against simulation time.
 *
 * One series, so no legend box; the panel title names it. The analytic peak estimate is
 * an annotation drawn as a dashed reference line in muted ink, because it is a
 * cross-check and not a second measurement.
 */
export class HydrographChart extends CanvasChart {
  constructor(canvas) {
    super(canvas, { height: 148 });
    /** @type {Array<{t: number, q: number}>} */
    this.series = [];
    this.peakReference = null;
    this.peakReferenceLabel = '';
  }

  /**
   * @param {Array<{t: number, q: number}>} series simulation seconds and m^3/s
   * @param {object} [options]
   * @param {number|null} [options.peakReference]
   * @param {string} [options.peakReferenceLabel]
   */
  setData(series, options = {}) {
    this.series = series;
    if (options.peakReference !== undefined) this.peakReference = options.peakReference;
    if (options.peakReferenceLabel !== undefined) {
      this.peakReferenceLabel = options.peakReferenceLabel;
    }
    this.redraw();
  }

  redraw() {
    this.resize();
    this.clear();

    if (this.series.length < 2) {
      this.drawEmpty('Run the simulation to see the outflow');
      return;
    }

    const ctx = this.context;
    const { x, y, w, h } = this.plot;

    const maxTime = this.series.at(-1).t;
    let maxQ = 0;
    for (const point of this.series) if (point.q > maxQ) maxQ = point.q;
    if (this.peakReference) maxQ = Math.max(maxQ, this.peakReference);

    const xScale = niceScale(0, Math.max(maxTime, 1), 5);
    const yScale = niceScale(0, Math.max(maxQ, 1), 4);

    this.drawAxes({
      xScale,
      yScale,
      formatX: (v) => timeFormat(v),
      formatY: (v) => axisFormat(v, yScale.step),
      yTitle: 'Discharge  m³/s',
      xTitle: 'Simulation time',
    });

    const toX = (t) => x + ((t - xScale.min) / (xScale.max - xScale.min)) * w;
    const toY = (q) => y + h - ((q - yScale.min) / (yScale.max - yScale.min)) * h;

    // Reference line for the analytic peak. Dashed, muted, directly labelled.
    if (this.peakReference && this.peakReference > 0) {
      const refY = toY(this.peakReference);
      ctx.strokeStyle = 'rgba(159, 176, 195, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, Math.round(refY) + 0.5);
      ctx.lineTo(x + w, Math.round(refY) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = INK.secondary;
      ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = refY < y + 14 ? 'top' : 'bottom';
      ctx.fillText(this.peakReferenceLabel || 'Weir estimate', x + 4, refY - 2);
    }

    // Filled area under the line, which makes the volume released legible at a glance.
    ctx.beginPath();
    ctx.moveTo(toX(this.series[0].t), toY(0));
    for (const point of this.series) ctx.lineTo(toX(point.t), toY(point.q));
    ctx.lineTo(toX(this.series.at(-1).t), toY(0));
    ctx.closePath();

    const fill = ctx.createLinearGradient(0, y, 0, y + h);
    fill.addColorStop(0, 'rgba(57, 135, 229, 0.34)');
    fill.addColorStop(1, 'rgba(57, 135, 229, 0.02)');
    ctx.fillStyle = fill;
    ctx.fill();

    // The series line: 2px, per the mark specs.
    ctx.strokeStyle = SERIES.slot1;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.series.forEach((point, i) => {
      const px = toX(point.t);
      const py = toY(point.q);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    if (this.hover && this.hover.x >= x && this.hover.x <= x + w) {
      // Nearest sample to the cursor.
      const targetT = xScale.min + ((this.hover.x - x) / w) * (xScale.max - xScale.min);
      let nearest = this.series[0];
      let bestDistance = Infinity;
      for (const point of this.series) {
        const distance = Math.abs(point.t - targetT);
        if (distance < bestDistance) {
          bestDistance = distance;
          nearest = point;
        }
      }

      const px = toX(nearest.t);
      const py = toY(nearest.q);

      this.drawReadout(px, [
        `t  ${timeFormat(nearest.t)}`,
        `Q  ${nearest.q.toFixed(0)} m³/s`,
      ]);

      // Marker at least 8px across, with a surface ring so it reads against the line.
      ctx.fillStyle = SERIES.slot1;
      ctx.strokeStyle = INK.surface;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

/**
 * Valley long profile: ground elevation and peak water surface against distance
 * downstream.
 *
 * Two series, so a legend is present and both lines are directly labelled. The band
 * between them is the flood depth, which is the thing the chart exists to show.
 */
export class LongProfileChart extends CanvasChart {
  constructor(canvas) {
    super(canvas, { height: 168 });
    /** @type {import('../sim/stations.js').Station[]} */
    this.stations = [];
    this.onSelect = null;
  }

  /**
   * @param {import('../sim/stations.js').Station[]} stations
   */
  setData(stations) {
    this.stations = stations;
    this.redraw();
  }

  redraw() {
    this.resize();
    this.clear();

    if (this.stations.length < 2) {
      this.drawEmpty('Run the simulation to see the profile');
      return;
    }

    const ctx = this.context;
    const { x, y, w, h } = this.plot;

    const maxDistance = this.stations.at(-1).distance;

    let minElevation = Infinity;
    let maxElevation = -Infinity;
    for (const station of this.stations) {
      minElevation = Math.min(minElevation, station.groundElevation);
      maxElevation = Math.max(maxElevation, station.groundElevation);
      if (Number.isFinite(station.peakWaterSurface)) {
        maxElevation = Math.max(maxElevation, station.peakWaterSurface);
      }
    }

    const xScale = niceScale(0, Math.max(maxDistance, 1), 5);
    const yScale = niceScale(minElevation, maxElevation, 4);

    this.drawAxes({
      xScale,
      yScale,
      formatX: (v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)} km` : `${v} m`),
      formatY: (v) => axisFormat(v, yScale.step),
      yTitle: 'Elevation  m',
      xTitle: 'Distance downstream',
    });

    const toX = (d) => x + ((d - xScale.min) / (xScale.max - xScale.min)) * w;
    const toY = (e) => y + h - ((e - yScale.min) / (yScale.max - yScale.min)) * h;

    // The flood band: between the ground and the peak water surface.
    const wet = this.stations.filter((s) => Number.isFinite(s.peakWaterSurface));
    if (wet.length > 1) {
      ctx.beginPath();
      ctx.moveTo(toX(wet[0].distance), toY(wet[0].groundElevation));
      for (const station of wet) ctx.lineTo(toX(station.distance), toY(station.peakWaterSurface));
      for (let i = wet.length - 1; i >= 0; i -= 1) {
        ctx.lineTo(toX(wet[i].distance), toY(wet[i].groundElevation));
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(57, 135, 229, 0.28)';
      ctx.fill();
    }

    /** Draw one series line. */
    const drawLine = (accessor, colour, filter) => {
      const points = filter ? this.stations.filter(filter) : this.stations;
      if (points.length < 2) return;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      points.forEach((station, i) => {
        const px = toX(station.distance);
        const py = toY(accessor(station));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    };

    // Slot 2 for the ground, slot 1 for the water. Assigned in fixed palette order.
    drawLine((s) => s.groundElevation, SERIES.slot2);
    drawLine(
      (s) => s.peakWaterSurface,
      SERIES.slot1,
      (s) => Number.isFinite(s.peakWaterSurface),
    );

    // Direct labels at the right-hand end, so identity never depends on colour.
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = INK.secondary;

    const last = this.stations.at(-1);
    ctx.fillText('ground', toX(last.distance) - 2, toY(last.groundElevation) - 3);
    if (wet.length > 0) {
      const lastWet = wet.at(-1);
      ctx.fillText('peak water', toX(lastWet.distance) - 2, toY(lastWet.peakWaterSurface) - 3);
    }

    if (this.hover && this.hover.x >= x && this.hover.x <= x + w) {
      const targetD = xScale.min + ((this.hover.x - x) / w) * (xScale.max - xScale.min);
      let nearest = this.stations[0];
      let bestDistance = Infinity;
      for (const station of this.stations) {
        const distance = Math.abs(station.distance - targetD);
        if (distance < bestDistance) {
          bestDistance = distance;
          nearest = station;
        }
      }

      const px = toX(nearest.distance);
      const lines = [
        `Station ${nearest.index}  ${(nearest.distance / 1000).toFixed(2)} km`,
        `Ground     ${nearest.groundElevation.toFixed(1)} m`,
      ];
      if (Number.isFinite(nearest.peakWaterSurface)) {
        lines.push(`Peak water ${nearest.peakWaterSurface.toFixed(1)} m`);
        lines.push(`Depth      ${nearest.peakDepth.toFixed(1)} m`);
      } else {
        lines.push('Stayed dry');
      }

      this.drawReadout(px, lines);

      ctx.fillStyle = SERIES.slot2;
      ctx.strokeStyle = INK.surface;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, toY(nearest.groundElevation), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (Number.isFinite(nearest.peakWaterSurface)) {
        ctx.fillStyle = SERIES.slot1;
        ctx.beginPath();
        ctx.arc(px, toY(nearest.peakWaterSurface), 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

/**
 * Build a legend as DOM rather than drawing it on the canvas, so the text is selectable
 * and inherits the interface's fonts.
 *
 * @param {Array<{label: string, colour: string}>} entries
 * @returns {HTMLElement}
 */
export function buildLegend(entries) {
  const legend = document.createElement('div');
  legend.style.cssText =
    'display:flex;gap:14px;flex-wrap:wrap;font-size:10.5px;color:#9fb0c3;padding:4px 0 0;';

  for (const entry of entries) {
    const item = document.createElement('span');
    item.style.cssText = 'display:inline-flex;align-items:center;gap:5px;';

    const swatch = document.createElement('span');
    swatch.style.cssText =
      `width:9px;height:9px;border-radius:2px;flex:none;background:${entry.colour};`;

    const text = document.createElement('span');
    text.textContent = entry.label;

    item.append(swatch, text);
    legend.append(item);
  }

  return legend;
}

export const CHART_SERIES_COLOURS = SERIES;
