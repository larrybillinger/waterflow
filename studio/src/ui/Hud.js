/**
 * The whole interface: panels, timeline, legend, charts and the persistent limitations
 * notice.
 *
 * The HUD knows nothing about the simulation or the renderer. It raises intents through
 * one `emit` callback and exposes setters the application calls to write values back in.
 * That boundary is what keeps a UI change from being able to break the physics.
 *
 * The limitations notice is built here and has no close button. That is deliberate and is
 * required by the Accuracy Honesty Rule in AGENTS.md: this tool produces an estimate from
 * roughly 10 metre terrain, one roughness value and an assumed breach, and it is easy to
 * mistake a convincing 3D view for an engineering product. See risk R-005.
 */

import {
  el,
  slider,
  select,
  numberField,
  toggle,
  button,
  readout,
  group,
  icon,
  ICONS,
  formatNumber,
  formatVolume,
} from './dom.js';
import { HydrographChart, LongProfileChart, buildLegend, CHART_SERIES_COLOURS } from './Chart.js';
import { groupedRoughness, ROUGHNESS_TABLE } from '../sim/manning.js';
import { BREACH_METHODS, PROGRESSION_CURVES } from '../sim/breach.js';
import { BRUSHES } from '../edit/TerrainEditor.js';
import { DIRECTOR_MODES } from '../render/CameraDirector.js';
import { SITE_CATALOG, IMAGERY } from '../data/sources.js';
import { formatDuration } from '../sim/stations.js';
import { defaults, visual } from '../config.js';

const TABS = [
  { id: 'place', label: 'Place' },
  { id: 'dam', label: 'Dam' },
  { id: 'breach', label: 'Breach' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'movie', label: 'Movie' },
  { id: 'results', label: 'Results' },
];

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8];

export class Hud {
  /**
   * @param {object} params
   * @param {(name: string, payload?: object) => void} params.emit
   * @param {string} params.version
   */
  constructor({ emit, version }) {
    this.emit = emit;
    this.version = version;

    this.root = el('div', { id: 'ui' });
    this.controls = {};
    this.activeTab = 'place';
    this.hidden = false;

    this.#buildBrand();
    this.#buildStatus();
    this.#buildRail();
    this.#buildCharts();
    this.#buildTimeline();
    this.#buildLegend();
    this.#buildDisclaimer();

    document.body.append(this.root);

    this.#buildCinema();
    this.#buildToast();
  }

  // -------------------------------------------------------------------------------
  // Brand and status
  // -------------------------------------------------------------------------------

  #buildBrand() {
    this.root.append(
      el('div', { id: 'brand', className: 'panel' }, [
        el('div', { className: 'mark' }),
        el('div', {}, [
          el('div', { className: 'name', textContent: 'Waterflow GPU Studio' }),
          el('div', { className: 'version', textContent: this.version }),
        ]),
        el('a', {
          className: 'mode-switch',
          href: '/',
          textContent: '← Classic 3D',
          title: 'Return to MapLibre Classic 3D Lab. These engines store separate scenarios.',
        }),
      ]),
    );
  }

  #buildStatus() {
    this.statusBar = el('div', { id: 'status' });
    this.chips = {};

    const definitions = [
      ['location', 'Location', '—'],
      ['cell', 'Cell', '—'],
      ['relief', 'Relief', '—'],
      ['reservoir', 'Pool', '—'],
      ['peak', 'Peak Q', '—'],
      ['fps', 'FPS', '—'],
    ];

    for (const [key, label, initial] of definitions) {
      const value = el('span', { className: 'v', textContent: initial });
      const chip = el('div', { className: 'chip' }, [
        el('span', { className: 'k', textContent: label }),
        value,
      ]);
      this.chips[key] = { chip, value };
      this.statusBar.append(chip);
    }

    this.root.append(this.statusBar);
  }

  /**
   * @param {string} key
   * @param {string} value
   * @param {'' | 'good' | 'warn' | 'danger'} [tone]
   */
  setChip(key, value, tone = '') {
    const entry = this.chips[key];
    if (!entry) return;
    entry.value.textContent = value;
    entry.chip.className = `chip${tone ? ` ${tone}` : ''}`;
  }

  // -------------------------------------------------------------------------------
  // Left rail
  // -------------------------------------------------------------------------------

  #buildRail() {
    this.rail = el('div', { id: 'rail', className: 'panel' });

    const tabStrip = el('div', { id: 'rail-tabs' });
    this.tabButtons = {};

    for (const tab of TABS) {
      const btn = el('button', {
        className: `tab${tab.id === this.activeTab ? ' active' : ''}`,
        textContent: tab.label,
        type: 'button',
        onClick: () => this.setTab(tab.id),
      });
      this.tabButtons[tab.id] = btn;
      tabStrip.append(btn);
    }

    this.railBody = el('div', { id: 'rail-body' });
    this.pages = {
      place: this.#buildPlacePage(),
      dam: this.#buildDamPage(),
      breach: this.#buildBreachPage(),
      terrain: this.#buildTerrainPage(),
      movie: this.#buildMoviePage(),
      results: this.#buildResultsPage(),
    };

    for (const [id, page] of Object.entries(this.pages)) {
      page.classList.toggle('active', id === this.activeTab);
      this.railBody.append(page);
    }

    this.rail.append(tabStrip, this.railBody);
    this.root.append(this.rail);
  }

  /**
   * @param {string} id
   */
  setTab(id) {
    this.activeTab = id;
    for (const [tabId, btn] of Object.entries(this.tabButtons)) {
      btn.classList.toggle('active', tabId === id);
    }
    for (const [pageId, page] of Object.entries(this.pages)) {
      page.classList.toggle('active', pageId === id);
    }
  }

  // --- Place ---------------------------------------------------------------------

  #buildPlacePage() {
    const siteSelect = select({
      label: 'Example sites',
      value: '',
      options: [
        { value: '', label: 'Choose a site…' },
        ...SITE_CATALOG.map((site, i) => ({ value: String(i), label: site.name })),
      ],
      onChange: (value) => {
        if (value === '') return;
        const site = SITE_CATALOG[Number(value)];
        this.controls.lat.input.value = String(site.lat);
        this.controls.lon.input.value = String(site.lon);
        this.controls.domain.setValue(site.domainMeters);
        this.siteNote.textContent = site.note;
        this.siteNote.style.display = 'block';
      },
      hint: 'Starting viewpoints only. The app derives every figure from the terrain.',
    });

    this.siteNote = el('div', {
      className: 'notice info',
      style: 'display:none',
      textContent: '',
    });

    this.controls.lat = numberField({
      label: 'Latitude',
      value: defaults.lat,
      step: 0.0001,
      min: -85,
      max: 85,
    });

    this.controls.lon = numberField({
      label: 'Longitude',
      value: defaults.lon,
      step: 0.0001,
      min: -180,
      max: 180,
    });

    this.controls.domain = slider({
      label: 'Area width',
      min: 4000,
      max: 48000,
      step: 1000,
      value: defaults.domainMeters,
      format: (v) => `${(v / 1000).toFixed(0)} km`,
      onInput: () => this.#updateGridEstimate(),
    });

    this.controls.grid = select({
      label: 'Simulation grid',
      value: String(defaults.gridSize),
      options: [
        { value: '256', label: '256 × 256  (fastest)' },
        { value: '384', label: '384 × 384' },
        { value: '512', label: '512 × 512  (recommended)' },
        { value: '768', label: '768 × 768' },
        { value: '1024', label: '1024 × 1024  (slowest)' },
      ],
      onChange: () => this.#updateGridEstimate(),
    });

    this.gridEstimate = el('div', { className: 'hint', textContent: '' });

    this.controls.imagery = select({
      label: 'Map imagery',
      value: defaults.imagerySource,
      options: Object.values(IMAGERY).map((source) => ({
        value: source.id,
        label: source.label,
      })),
      hint: 'If a source is unavailable the next is tried, then relief shading alone.',
    });

    this.loadButton = button('Load this area', {
      variant: 'primary',
      onClick: () =>
        this.emit('load-domain', {
          lat: Number(this.controls.lat.input.value),
          lon: Number(this.controls.lon.input.value),
          domainMeters: Number(this.controls.domain.input.value),
          gridSize: Number(this.controls.grid.input.value),
          imagerySource: this.controls.imagery.input.value,
        }),
    });

    this.dataReadout = readout([
      ['Elevation source', '—'],
      ['Tile zoom', '—'],
      ['Source resolution', '—'],
      ['Tiles fetched', '—'],
      ['Elevation range', '—'],
      ['Imagery', '—'],
    ]);

    this.controls.exaggeration = slider({
      label: 'Vertical exaggeration',
      min: 1,
      max: 3,
      step: 0.1,
      value: visual.verticalExaggeration,
      format: (v) => `${v.toFixed(1)}×`,
      onInput: (v) => this.emit('exaggeration-change', { value: v }),
      hint: 'Above 1× the relief is stretched, which makes a flood look deeper than it is.',
    });

    this.controls.sunElevation = slider({
      label: 'Sun elevation',
      min: 5,
      max: 85,
      step: 1,
      value: visual.sunElevationDeg,
      format: (v) => `${v}°`,
      onInput: () => this.#emitSun(),
    });

    this.controls.sunAzimuth = slider({
      label: 'Sun azimuth',
      min: 0,
      max: 359,
      step: 1,
      value: visual.sunAzimuthDeg,
      format: (v) => `${v}°`,
      onInput: () => this.#emitSun(),
    });

    const page = el('div', { className: 'tab-page' }, [
      group('Where', [
        siteSelect,
        this.siteNote,
        this.controls.lat,
        this.controls.lon,
        this.controls.domain,
        this.controls.grid,
        this.gridEstimate,
        this.controls.imagery,
        this.loadButton,
      ]),
      group('Loaded data', [this.dataReadout]),
      group('View', [
        this.controls.exaggeration,
        this.controls.sunElevation,
        this.controls.sunAzimuth,
      ]),
    ]);

    this.#updateGridEstimate();
    return page;
  }

  #emitSun() {
    this.emit('sun-change', {
      elevation: Number(this.controls.sunElevation.input.value),
      azimuth: Number(this.controls.sunAzimuth.input.value),
    });
  }

  #updateGridEstimate() {
    const domain = Number(this.controls.domain.input.value);
    const grid = Number(this.controls.grid.input.value);
    const cell = domain / grid;
    this.gridEstimate.textContent =
      `${cell.toFixed(1)} m cells. Finer grids resolve narrow channels better but ` +
      'need more elevation tiles and more GPU work.';
  }

  // --- Dam ----------------------------------------------------------------------

  #buildDamPage() {
    this.placeDamButton = button('Draw the dam', {
      variant: 'primary',
      onClick: () => this.emit('mode-change', { mode: 'place-dam' }),
    });

    this.controls.crest = slider({
      label: 'Crest elevation',
      min: 0,
      max: 100,
      step: 0.5,
      value: 0,
      format: (v) => `${v.toFixed(1)} m`,
      onInput: (v) => this.emit('crest-change', { value: v }),
    });

    this.controls.crestWidth = slider({
      label: 'Crest width',
      min: 20,
      max: 400,
      step: 10,
      value: 80,
      format: (v) => `${v} m`,
      onChange: (v) => this.emit('crest-width-change', { value: v }),
      hint: 'A dam thinner than two or three cells leaks through numerical diffusion.',
    });

    this.controls.pool = slider({
      label: 'Reservoir water level',
      min: 0,
      max: 100,
      step: 0.25,
      value: 0,
      format: (v) => `${v.toFixed(2)} m`,
      onInput: (v) => this.emit('pool-change', { value: v }),
    });

    this.fillToCrestButton = button('Fill to crest', {
      onClick: () => this.emit('fill-to-crest'),
    });

    this.clearDamButton = button('Remove dam', {
      variant: 'danger',
      onClick: () => this.emit('clear-dam'),
    });

    this.reservoirReadout = readout([
      ['Dam length', '—'],
      ['Dam height', '—'],
      ['Water level', '—'],
      ['Depth at dam', '—'],
      ['Surface area', '—'],
      ['Impounded volume', '—'],
      ['Volume (acre-feet)', '—'],
    ]);

    this.damNotice = el('div', { className: 'notice', style: 'display:none' });

    return el('div', { className: 'tab-page' }, [
      group('Build the dam', [
        el('div', {
          className: 'hint',
          textContent:
            'Click once on each side of a valley to run a dam across it. The crest ' +
            'becomes real terrain, so the reservoir fills behind it by itself.',
        }),
        this.placeDamButton,
        this.controls.crest,
        this.controls.crestWidth,
        this.clearDamButton,
      ]),
      group('Reservoir', [
        this.controls.pool,
        this.fillToCrestButton,
        this.damNotice,
        this.reservoirReadout,
      ]),
    ]);
  }

  // --- Breach -------------------------------------------------------------------

  #buildBreachPage() {
    this.controls.breachMode = select({
      label: 'Failure mode',
      value: defaults.breachMode,
      options: [
        { value: 'overtopping', label: 'Overtopping' },
        { value: 'piping', label: 'Piping / internal erosion' },
      ],
      onChange: () => this.#emitBreach(),
      hint: 'Changes the side slopes and the mode coefficient in the published equations.',
    });

    this.controls.breachWidth = slider({
      label: 'Breach width',
      min: 1,
      max: 100,
      step: 1,
      value: defaults.breachWidthPercent,
      format: (v) => `${v}% of dam`,
      onInput: () => this.#emitBreach(),
    });

    this.controls.breachDepth = slider({
      label: 'Breach depth',
      min: 5,
      max: 100,
      step: 1,
      value: defaults.breachDepthPercent,
      format: (v) => `${v}% of height`,
      onInput: () => this.#emitBreach(),
    });

    this.controls.breachTime = slider({
      label: 'Formation time',
      min: 0,
      max: 360,
      step: 1,
      value: defaults.breachFormationMinutes,
      format: (v) => (v === 0 ? 'instant' : `${v} min`),
      onInput: () => this.#emitBreach(),
    });

    this.controls.breachProgression = select({
      label: 'Progression',
      value: defaults.breachProgression,
      options: Object.entries(PROGRESSION_CURVES).map(([id, curve]) => ({
        value: id,
        label: curve.label,
      })),
      onChange: () => this.#emitBreach(),
    });

    this.progressionHint = el('div', {
      className: 'hint',
      textContent: PROGRESSION_CURVES[defaults.breachProgression].describe,
    });

    this.controls.breachMethod = select({
      label: 'Estimation method',
      value: 'froehlich-2008',
      options: Object.entries(BREACH_METHODS).map(([id, method]) => ({
        value: id,
        label: method.label,
      })),
    });

    this.estimateButton = button('Fill from published equations', {
      onClick: () =>
        this.emit('estimate-breach', { method: this.controls.breachMethod.input.value }),
    });

    this.estimateReadout = readout([
      ['Method', '—'],
      ['Average breach width', '—'],
      ['Bottom width', '—'],
      ['Side slopes', '—'],
      ['Formation time', '—'],
    ]);

    this.estimateNotes = el('div', { className: 'notice', style: 'display:none' });

    const roughnessOptions = new Map();
    for (const [groupName, entries] of groupedRoughness()) {
      roughnessOptions.set(
        groupName,
        entries.map((entry) => ({
          value: entry.id,
          label: `${entry.label}  (n = ${entry.normal})`,
        })),
      );
    }

    this.controls.roughnessPreset = select({
      label: "Surface type",
      value: 'plain-scattered-brush',
      options: roughnessOptions,
      onChange: (id) => {
        const entry = ROUGHNESS_TABLE.find((row) => row.id === id);
        if (!entry) return;
        this.controls.manning.input.min = String(entry.min);
        this.controls.manning.input.max = String(entry.max);
        this.controls.manning.setValue(entry.normal);
        this.emit('manning-change', { n: entry.normal });
      },
      hint: "Manning's n from Chow (1959) Table 5-6. One value for the whole area.",
    });

    this.controls.manning = slider({
      label: "Manning's n",
      min: 0.011,
      max: 0.2,
      step: 0.001,
      value: defaults.manningN,
      format: (v) => v.toFixed(3),
      onInput: (v) => this.emit('manning-change', { n: v }),
    });

    this.controls.boundary = toggle({
      label: 'Let water leave the area edges',
      checked: true,
      onChange: (on) => this.emit('boundary-change', { open: on }),
    });

    this.controls.substeps = slider({
      label: 'Solver substeps per frame',
      min: 1,
      max: 24,
      step: 1,
      value: 6,
      format: (v) => String(v),
      onChange: (v) => this.emit('substeps-change', { value: v }),
      hint: 'More substeps advance simulation time faster at the cost of frame rate.',
    });

    return el('div', { className: 'tab-page' }, [
      group('How it fails', [
        this.controls.breachMode,
        this.controls.breachWidth,
        this.controls.breachDepth,
        this.controls.breachTime,
        this.controls.breachProgression,
        this.progressionHint,
      ]),
      group('Estimate it for me', [
        el('div', {
          className: 'hint',
          textContent:
            'Fills the controls above from a published regression on historical dam ' +
            'failures, using the reservoir volume and dam height from your terrain.',
        }),
        this.controls.breachMethod,
        this.estimateButton,
        this.estimateReadout,
        this.estimateNotes,
      ]),
      group('Hydraulics', [
        this.controls.roughnessPreset,
        this.controls.manning,
        this.controls.boundary,
        this.controls.substeps,
      ]),
    ]);
  }

  #emitBreach() {
    const progression = this.controls.breachProgression.input.value;
    this.progressionHint.textContent = PROGRESSION_CURVES[progression]?.describe ?? '';

    this.emit('breach-change', {
      mode: this.controls.breachMode.input.value,
      widthPercent: Number(this.controls.breachWidth.input.value),
      depthPercent: Number(this.controls.breachDepth.input.value),
      formationMinutes: Number(this.controls.breachTime.input.value),
      progression,
    });
  }

  // --- Terrain ------------------------------------------------------------------

  #buildTerrainPage() {
    this.brushButtons = {};
    const brushGrid = el('div', { className: 'btn-grid' });

    for (const brush of Object.values(BRUSHES)) {
      const btn = button(brush.label, {
        title: brush.describe,
        onClick: () => {
          this.setActiveBrush(brush.id);
          this.emit('brush-change', { brush: brush.id });
          this.emit('mode-change', { mode: 'edit' });
        },
      });
      this.brushButtons[brush.id] = btn;
      brushGrid.append(btn);
    }

    this.brushHint = el('div', { className: 'hint', textContent: BRUSHES.raise.describe });

    this.controls.brushRadius = slider({
      label: 'Brush size',
      min: 20,
      max: 3000,
      step: 20,
      value: 300,
      format: (v) => `${v} m`,
      onInput: (v) => this.emit('brush-change', { radius: v }),
    });

    this.controls.brushStrength = slider({
      label: 'Strength',
      min: 0.25,
      max: 30,
      step: 0.25,
      value: 4,
      format: (v) => `${v.toFixed(2)} m`,
      onInput: (v) => this.emit('brush-change', { strength: v }),
    });

    this.controls.strokeMagnitude = slider({
      label: 'Channel depth / levee height',
      min: 1,
      max: 60,
      step: 1,
      value: 8,
      format: (v) => `${v} m`,
      onInput: (v) => this.emit('brush-change', { strokeMagnitude: v }),
    });

    this.controls.strokeWidth = slider({
      label: 'Channel / levee width',
      min: 40,
      max: 2000,
      step: 20,
      value: 240,
      format: (v) => `${v} m`,
      onInput: (v) => this.emit('brush-change', { strokeWidth: v }),
    });

    this.undoButton = button('Undo', { onClick: () => this.emit('undo') });
    this.revertButton = button('Revert all edits', {
      variant: 'danger',
      onClick: () => this.emit('revert'),
    });

    this.earthworkReadout = readout([
      ['Cells changed', '0'],
      ['Material added', '—'],
      ['Material removed', '—'],
    ]);

    this.navigateButton = button('Done editing', {
      onClick: () => this.emit('mode-change', { mode: 'navigate' }),
    });

    return el('div', { className: 'tab-page' }, [
      group('Reshape the ground', [
        el('div', {
          className: 'hint',
          textContent:
            'Edits go straight into the terrain the solver reads, so you can cut a ' +
            'spillway or raise a levee and run again to see what changes.',
        }),
        brushGrid,
        this.brushHint,
        this.navigateButton,
      ]),
      group('Brush', [this.controls.brushRadius, this.controls.brushStrength]),
      group('Channel and levee', [this.controls.strokeMagnitude, this.controls.strokeWidth]),
      group('Earthworks', [
        el('div', { className: 'btn-row' }, [this.undoButton, this.revertButton]),
        this.earthworkReadout,
      ]),
    ]);
  }

  /**
   * @param {string} brushId
   */
  setActiveBrush(brushId) {
    for (const [id, btn] of Object.entries(this.brushButtons)) {
      btn.classList.toggle('active', id === brushId);
    }
    this.brushHint.textContent = BRUSHES[brushId]?.describe ?? '';
  }

  // --- Movie --------------------------------------------------------------------

  #buildMoviePage() {
    this.dropRaftButton = button('Drop a raft on the water', {
      variant: 'primary',
      onClick: () => this.emit('mode-change', { mode: 'drop-raft' }),
    });

    this.controls.drifterKind = select({
      label: 'What to drop',
      value: 'raft',
      options: [
        { value: 'raft', label: 'Raft with a rider' },
        { value: 'buoy', label: 'Marker buoy' },
        { value: 'debris', label: 'Floating debris' },
      ],
    });

    this.clearRaftsButton = button('Remove all', {
      variant: 'danger',
      onClick: () => this.emit('drifter-clear'),
    });

    this.drifterList = el('div', { className: 'group' });
    this.#renderDrifterList([]);

    this.cameraButtons = {};
    const cameraGrid = el('div', { className: 'btn-grid' });

    const freeButton = button('Free look', {
      onClick: () => {
        this.setCameraMode('free');
        this.emit('camera-mode', { mode: 'free' });
      },
    });
    this.cameraButtons.free = freeButton;
    cameraGrid.append(freeButton);

    for (const mode of Object.values(DIRECTOR_MODES)) {
      const btn = button(mode.label, {
        title: mode.describe,
        onClick: () => {
          this.setCameraMode(mode.id);
          this.emit('camera-mode', { mode: mode.id });
        },
      });
      this.cameraButtons[mode.id] = btn;
      cameraGrid.append(btn);
    }

    this.cameraHint = el('div', { className: 'hint', textContent: 'Normal map navigation.' });

    this.setWatchButton = button('Tag a watch point', {
      onClick: () => this.emit('mode-change', { mode: 'set-watch' }),
    });

    this.controls.cinematic = toggle({
      label: 'Cinematic presentation',
      checked: false,
      onChange: (on) => this.emit('cinematic', { on }),
    });

    this.controls.raftScale = toggle({
      label: 'Enlarge raft so it stays visible',
      checked: true,
      onChange: (on) => this.emit('raft-scale', { on }),
    });

    this.raftScaleHint = el('div', {
      className: 'hint',
      textContent:
        'A 3 m raft is a fraction of one simulation cell. Enlarging it keeps it ' +
        'findable from altitude; turn this off for a true-scale view up close.',
    });

    return el('div', { className: 'tab-page' }, [
      group('Follow the water', [
        el('div', {
          className: 'hint',
          textContent:
            'A raft drifts on the simulated velocity field, so where it goes is where ' +
            'the water goes. It needs water under it, so drop it in the reservoir or ' +
            'somewhere the flood will reach.',
        }),
        this.controls.drifterKind,
        this.dropRaftButton,
        this.clearRaftsButton,
      ]),
      this.drifterList,
      group('Camera', [cameraGrid, this.cameraHint, this.setWatchButton]),
      group('Presentation', [
        this.controls.cinematic,
        this.controls.raftScale,
        this.raftScaleHint,
      ]),
    ]);
  }

  /**
   * @param {string} mode
   */
  setCameraMode(mode) {
    for (const [id, btn] of Object.entries(this.cameraButtons)) {
      btn.classList.toggle('active', id === mode);
    }
    this.cameraHint.textContent =
      mode === 'free' ? 'Normal map navigation.' : (DIRECTOR_MODES[mode]?.describe ?? '');
  }

  /**
   * @param {Array<import('../sim/Drifter.js').Drifter>} drifters
   */
  setDrifters(drifters) {
    this.#renderDrifterList(drifters);
  }

  #renderDrifterList(drifters) {
    this.drifterList.replaceChildren();

    if (drifters.length === 0) {
      this.drifterList.append(
        el('div', { className: 'group-title', textContent: 'Afloat' }),
        el('div', { className: 'hint', textContent: 'Nothing on the water yet.' }),
      );
      return;
    }

    this.drifterList.append(el('div', { className: 'group-title', textContent: 'Afloat' }));

    for (const drifter of drifters) {
      const stats = readout([
        ['Status', drifter.describeState()],
        ['Travelled', `${(drifter.distanceTravelled / 1000).toFixed(2)} km`],
        ['Speed', `${drifter.speed.toFixed(2)} m/s`],
        ['Depth below', `${drifter.depth.toFixed(1)} m`],
      ]);

      this.drifterList.append(
        el('div', { className: 'field' }, [
          el('div', { className: 'field-row' }, [
            el('span', { className: 'field-label', textContent: drifter.label }),
            el('span', {
              className: 'field-value',
              textContent: drifter.launchedAt !== null ? formatDuration(drifter.launchedAt) : '—',
            }),
          ]),
          stats,
          el('div', { className: 'btn-row' }, [
            button('Follow', { onClick: () => this.emit('drifter-focus', { id: drifter.id }) }),
            button('Remove', { onClick: () => this.emit('drifter-remove', { id: drifter.id }) }),
          ]),
        ]),
      );
    }
  }

  // --- Results ------------------------------------------------------------------

  #buildResultsPage() {
    this.controls.overlay = select({
      label: 'Map overlay',
      value: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'maxDepth', label: 'Maximum depth reached' },
        { value: 'arrival', label: 'Flood arrival time' },
        { value: 'velocity', label: 'Peak velocity' },
      ],
      onChange: (mode) => this.emit('overlay-change', { mode }),
      hint: 'Drawn on the ground, so it shows where water went even after it drained.',
    });

    this.controls.stationSpacing = slider({
      label: 'Station spacing',
      min: 100,
      max: 5000,
      step: 100,
      value: defaults.stationSpacing,
      format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${v} m`),
      onChange: () => this.#emitStations(),
    });

    this.controls.sectionWidth = slider({
      label: 'Cross-section half-width',
      min: 200,
      max: 6000,
      step: 100,
      value: defaults.crossSectionHalfWidth,
      format: (v) => `${(v / 1000).toFixed(1)} km`,
      onChange: () => this.#emitStations(),
    });

    this.recomputeButton = button('Recompute results', {
      variant: 'primary',
      onClick: () => this.emit('recompute'),
    });

    this.exportButton = button('Export CSV', { onClick: () => this.emit('export-csv') });

    this.summaryReadout = readout([
      ['Simulated', '—'],
      ['Peak outflow', '—'],
      ['Weir estimate', '—'],
      ['Water released', '—'],
      ['Still impounded', '—'],
      ['Furthest flooding', '—'],
      ['Stations', '—'],
    ]);

    this.tableBody = el('tbody');
    const table = el('table', { className: 'results' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { textContent: 'Stn' }),
          el('th', { textContent: 'km' }),
          el('th', { textContent: 'Ground' }),
          el('th', { textContent: 'Peak WS' }),
          el('th', { textContent: 'Depth' }),
          el('th', { textContent: 'Width' }),
          el('th', { textContent: 'Vel' }),
          el('th', { textContent: 'Arrives' }),
        ]),
      ]),
      this.tableBody,
    ]);

    this.tableNotice = el('div', {
      className: 'hint',
      textContent:
        'Click a row to fly there. Rows marked * are close enough to the breach that ' +
        'the simplified momentum equation is least reliable.',
    });

    return el('div', { className: 'tab-page' }, [
      group('Show', [this.controls.overlay]),
      group('Where to measure', [
        this.controls.stationSpacing,
        this.controls.sectionWidth,
        this.recomputeButton,
      ]),
      group('Summary', [this.summaryReadout]),
      group('Stations', [
        el('div', { className: 'table-wrap' }, [table]),
        this.tableNotice,
        this.exportButton,
      ]),
    ]);
  }

  #emitStations() {
    this.emit('stations-change', {
      spacing: Number(this.controls.stationSpacing.input.value),
      halfWidth: Number(this.controls.sectionWidth.input.value),
    });
  }

  // -------------------------------------------------------------------------------
  // Charts
  // -------------------------------------------------------------------------------

  #buildCharts() {
    const hydrographCanvas = el('canvas');
    const profileCanvas = el('canvas');

    this.chartsPanel = el('div', { id: 'charts' }, [
      el('div', { className: 'panel chart-panel' }, [
        el('div', { className: 'panel-head' }, [
          el('span', { className: 'panel-title', textContent: 'Outflow through the breach' }),
        ]),
        el('div', { className: 'panel-body' }, [hydrographCanvas]),
      ]),
      el('div', { className: 'panel chart-panel' }, [
        el('div', { className: 'panel-head' }, [
          el('span', { className: 'panel-title', textContent: 'Valley long profile' }),
        ]),
        el('div', { className: 'panel-body' }, [
          profileCanvas,
          buildLegend([
            { label: 'Peak water surface', colour: CHART_SERIES_COLOURS.slot1 },
            { label: 'Ground elevation', colour: CHART_SERIES_COLOURS.slot2 },
          ]),
        ]),
      ]),
    ]);

    this.root.append(this.chartsPanel);

    this.hydrograph = new HydrographChart(hydrographCanvas);
    this.profile = new LongProfileChart(profileCanvas);

    // Charts size from their container, which is not laid out until after the first
    // frame, so the initial draw waits for it.
    requestAnimationFrame(() => {
      this.hydrograph.redraw();
      this.profile.redraw();
    });

    window.addEventListener('resize', () => {
      this.hydrograph.redraw();
      this.profile.redraw();
    });
  }

  // -------------------------------------------------------------------------------
  // Timeline
  // -------------------------------------------------------------------------------

  #buildTimeline() {
    this.playButton = el(
      'button',
      {
        className: 'icon-btn play',
        type: 'button',
        title: 'Play or pause (Space)',
        onClick: () => this.emit('toggle-play'),
      },
      [icon(ICONS.play)],
    );

    this.resetButton = el(
      'button',
      {
        className: 'icon-btn',
        type: 'button',
        title: 'Reset to the moment before failure (R)',
        onClick: () => this.emit('reset'),
      },
      [icon(ICONS.reset)],
    );

    this.stepButton = el(
      'button',
      {
        className: 'icon-btn',
        type: 'button',
        title: 'Advance one frame',
        onClick: () => this.emit('step'),
      },
      [icon(ICONS.step)],
    );

    this.clockElement = el('div', { className: 'clock' }, [
      el('span', { textContent: '00:00:00' }),
      el('span', { className: 'clock-label', textContent: 'since failure' }),
    ]);
    this.clockValue = this.clockElement.firstChild;

    this.breachProgressBar = slider({
      label: 'Breach opening',
      min: 0,
      max: 100,
      step: 1,
      value: 0,
      format: (v) => `${v}%`,
    });
    this.breachProgressBar.input.disabled = true;
    this.breachProgressBar.style.cssText = 'flex:1;min-width:120px';

    this.speedButtons = {};
    const speedRow = el('div', { className: 'speed' });
    for (const speed of SPEED_OPTIONS) {
      const btn = el('button', {
        className: `speed-btn${speed === 1 ? ' active' : ''}`,
        textContent: `${speed}×`,
        type: 'button',
        onClick: () => {
          this.setSpeed(speed);
          this.emit('speed-change', { multiplier: speed });
        },
      });
      this.speedButtons[speed] = btn;
      speedRow.append(btn);
    }

    this.root.append(
      el('div', { id: 'timeline', className: 'panel' }, [
        this.resetButton,
        this.playButton,
        this.stepButton,
        this.clockElement,
        this.breachProgressBar,
        speedRow,
      ]),
    );
  }

  /**
   * @param {boolean} playing
   */
  setPlaying(playing) {
    this.playButton.replaceChildren(icon(playing ? ICONS.pause : ICONS.play));
  }

  /**
   * @param {number} multiplier
   */
  setSpeed(multiplier) {
    for (const [speed, btn] of Object.entries(this.speedButtons)) {
      btn.classList.toggle('active', Number(speed) === multiplier);
    }
  }

  /**
   * @param {number} seconds simulation time
   * @param {number} breachFraction 0 to 1
   */
  setClock(seconds, breachFraction) {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const text = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    this.clockValue.textContent = text;
    this.breachProgressBar.setValue(Math.round(breachFraction * 100));
    if (this.cinemaTimecode) this.cinemaTimecode.textContent = `T+ ${text}`;
  }

  // -------------------------------------------------------------------------------
  // Legend and disclaimer
  // -------------------------------------------------------------------------------

  #buildLegend() {
    this.legendTitle = el('div', { className: 'legend-title', textContent: '' });
    this.legendBar = el('div', { className: 'legend-bar' });
    this.legendScale = el('div', { className: 'legend-scale' });

    this.legendPanel = el('div', { id: 'legend', className: 'panel hidden' }, [
      this.legendTitle,
      this.legendBar,
      this.legendScale,
    ]);

    this.root.append(this.legendPanel);
  }

  /**
   * @param {object|null} legend null hides it
   * @param {string} legend.title
   * @param {string} legend.gradient CSS gradient
   * @param {string[]} legend.labels
   */
  setLegend(legend) {
    if (!legend) {
      this.legendPanel.classList.add('hidden');
      return;
    }

    this.legendPanel.classList.remove('hidden');
    this.legendTitle.textContent = legend.title;
    this.legendBar.style.background = legend.gradient;
    this.legendScale.replaceChildren(
      ...legend.labels.map((label) => el('span', { textContent: label })),
    );
  }

  #buildDisclaimer() {
    this.root.append(
      el('div', { id: 'disclaimer', className: 'panel' }, [
        el('strong', { textContent: 'Estimate, not an engineering product' }),
        el('span', {
          textContent:
            'Built from public ~10 m elevation data, one roughness value, no structures ' +
            'and an assumed breach. Useful for understanding and comparing scenarios. ' +
            'Not a dam breach inundation study, and not a basis for decisions about ' +
            'life or property.',
        }),
      ]),
    );
  }

  // -------------------------------------------------------------------------------
  // Cinematic overlay and toast
  // -------------------------------------------------------------------------------

  #buildCinema() {
    this.cinemaTimecode = el('div', { className: 'timecode', textContent: 'T+ 00:00:00' });
    this.cinemaShot = el('div', { className: 'shot', textContent: '' });

    this.cinema = el('div', { id: 'cinema' }, [
      el('div', { className: 'bar top' }),
      el('div', { className: 'bar bottom' }),
      el('div', { className: 'rec', textContent: 'SIM' }),
      this.cinemaTimecode,
      this.cinemaShot,
    ]);

    document.body.append(this.cinema);
  }

  /**
   * @param {boolean} on
   * @param {string} [shotLabel]
   */
  setCinematic(on, shotLabel = '') {
    this.cinema.classList.toggle('active', on);
    this.cinemaShot.textContent = shotLabel;
    this.setUiHidden(on);
    if (this.controls.cinematic.input.checked !== on) {
      this.controls.cinematic.input.checked = on;
    }
  }

  /**
   * @param {boolean} hidden
   */
  setUiHidden(hidden) {
    this.hidden = hidden;
    this.root.classList.toggle('hidden', hidden);
  }

  toggleUi() {
    this.setUiHidden(!this.hidden);
  }

  #buildToast() {
    this.toastElement = el('div', { id: 'toast' });
    document.body.append(this.toastElement);
    this.toastTimer = null;
  }

  /**
   * @param {string} message
   * @param {number} [durationMs=2600]
   */
  toast(message, durationMs = 2600) {
    this.toastElement.textContent = message;
    this.toastElement.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastElement.classList.remove('show');
    }, durationMs);
  }

  // -------------------------------------------------------------------------------
  // Value setters called by the application
  // -------------------------------------------------------------------------------

  /**
   * @param {object} info
   */
  setDataInfo(info) {
    this.dataReadout.set('Elevation source', info.elevationSource ?? '—');
    this.dataReadout.set('Tile zoom', info.zoom !== undefined ? String(info.zoom) : '—');
    this.dataReadout.set(
      'Source resolution',
      info.sourceResolution ? `${info.sourceResolution.toFixed(1)} m/px` : '—',
    );
    this.dataReadout.set(
      'Tiles fetched',
      info.tileCount !== undefined
        ? `${info.tileCount}${info.failedTiles ? ` (${info.failedTiles} failed)` : ''}`
        : '—',
    );
    this.dataReadout.set(
      'Elevation range',
      info.minElevation !== undefined
        ? `${info.minElevation.toFixed(0)} – ${info.maxElevation.toFixed(0)} m`
        : '—',
    );
    this.dataReadout.set('Imagery', info.imageryLabel ?? '—');
  }

  /**
   * @param {object|null} dam
   * @param {object|null} pool
   */
  setReservoirInfo(dam, pool) {
    const r = this.reservoirReadout;

    if (!dam) {
      for (const key of [
        'Dam length',
        'Dam height',
        'Water level',
        'Depth at dam',
        'Surface area',
        'Impounded volume',
        'Volume (acre-feet)',
      ]) {
        r.set(key, '—');
      }
      this.damNotice.style.display = 'none';
      return;
    }

    r.set('Dam length', `${formatNumber(dam.length)} m`);
    r.set('Dam height', `${dam.height.toFixed(1)} m`);

    if (!pool || pool.cellCount === 0) {
      r.set('Water level', '—');
      r.set('Depth at dam', '—');
      r.set('Surface area', '—');
      r.set('Impounded volume', '—');
      r.set('Volume (acre-feet)', '—');
      return;
    }

    r.set('Water level', `${pool.surfaceElevation.toFixed(1)} m`);
    r.set('Depth at dam', `${pool.maxDepth.toFixed(1)} m`);
    r.set('Surface area', `${formatNumber(pool.area / 1e6, 2)} km²`);
    r.set('Impounded volume', formatVolume(pool.volume));
    r.set('Volume (acre-feet)', formatNumber(pool.acreFeet));

    if (pool.touchesEdge) {
      this.damNotice.textContent =
        'The reservoir reaches the edge of the loaded area, so its volume is cut off ' +
        'by the boundary rather than by terrain. Load a wider area for a true figure.';
      this.damNotice.style.display = 'block';
    } else {
      this.damNotice.style.display = 'none';
    }
  }

  /**
   * @param {object} params
   */
  setCrestRange({ min, max, value }) {
    this.controls.crest.input.min = String(min);
    this.controls.crest.input.max = String(max);
    this.controls.crest.setValue(value);
  }

  /**
   * @param {object} params
   */
  setPoolRange({ min, max, value }) {
    this.controls.pool.input.min = String(min);
    this.controls.pool.input.max = String(max);
    this.controls.pool.setValue(value);
  }

  /**
   * @param {object|null} estimate
   */
  setBreachEstimate(estimate) {
    const r = this.estimateReadout;

    if (!estimate) {
      for (const key of [
        'Method',
        'Average breach width',
        'Bottom width',
        'Side slopes',
        'Formation time',
      ]) {
        r.set(key, '—');
      }
      this.estimateNotes.style.display = 'none';
      return;
    }

    r.set('Method', estimate.method);
    r.set('Average breach width', `${formatNumber(estimate.averageWidth, 1)} m`);
    r.set('Bottom width', `${formatNumber(estimate.bottomWidth, 1)} m`);
    r.set('Side slopes', `${estimate.sideSlope.toFixed(1)}H : 1V`);
    r.set('Formation time', formatDuration(estimate.formationSeconds));

    if (estimate.notes && estimate.notes.length > 0) {
      this.estimateNotes.textContent = estimate.notes.join(' ');
      this.estimateNotes.style.display = 'block';
    } else {
      this.estimateNotes.style.display = 'none';
    }
  }

  /**
   * @param {object} values
   */
  setBreachControls({ widthPercent, depthPercent, formationMinutes, mode }) {
    if (widthPercent !== undefined) {
      this.controls.breachWidth.setValue(Math.round(widthPercent));
    }
    if (depthPercent !== undefined) {
      this.controls.breachDepth.setValue(Math.round(depthPercent));
    }
    if (formationMinutes !== undefined) {
      this.controls.breachTime.setValue(Math.round(formationMinutes));
    }
    if (mode !== undefined) this.controls.breachMode.input.value = mode;
  }

  /**
   * @param {object} info
   */
  setEarthworkInfo({ cells, added, removed, canUndo }) {
    this.earthworkReadout.set('Cells changed', formatNumber(cells));
    this.earthworkReadout.set('Material added', formatVolume(added));
    this.earthworkReadout.set('Material removed', formatVolume(removed));
    this.undoButton.disabled = !canUndo;
  }

  /**
   * @param {object} summary
   */
  setSummary(summary) {
    const s = this.summaryReadout;
    s.set('Simulated', formatDuration(summary.simulatedSeconds ?? 0));
    s.set(
      'Peak outflow',
      summary.peakOutflow ? `${formatNumber(summary.peakOutflow)} m³/s` : '—',
    );
    s.set(
      'Weir estimate',
      summary.analyticPeak ? `${formatNumber(summary.analyticPeak)} m³/s` : '—',
    );
    s.set('Water released', formatVolume(summary.released));
    s.set('Still impounded', formatVolume(summary.remaining));
    s.set(
      'Furthest flooding',
      summary.furthestKm !== undefined ? `${summary.furthestKm.toFixed(1)} km` : '—',
    );
    s.set('Stations', summary.stationCount !== undefined ? String(summary.stationCount) : '—');
  }

  /**
   * @param {import('../sim/stations.js').Station[]} stations
   */
  setStations(stations) {
    this.tableBody.replaceChildren();

    for (const station of stations) {
      const row = el(
        'tr',
        {
          className: station.nearField ? 'near-field' : '',
          onClick: () => this.emit('fly-to-station', { index: station.index }),
        },
        [
          el('td', { textContent: String(station.index) }),
          el('td', { textContent: (station.distance / 1000).toFixed(2) }),
          el('td', { textContent: station.groundElevation.toFixed(1) }),
          el('td', {
            textContent: Number.isFinite(station.peakWaterSurface)
              ? station.peakWaterSurface.toFixed(1)
              : '—',
          }),
          el('td', { textContent: station.peakDepth.toFixed(1) }),
          el('td', { textContent: formatNumber(station.floodWidth) }),
          el('td', { textContent: station.peakVelocity.toFixed(2) }),
          el('td', { textContent: formatDuration(station.arrivalSeconds) }),
        ],
      );
      this.tableBody.append(row);
    }

    this.profile.setData(stations);
  }

  /**
   * @param {Array<{t: number, q: number}>} series
   * @param {object} [options]
   */
  setHydrograph(series, options) {
    this.hydrograph.setData(series, options);
  }

  /**
   * @param {string} mode
   */
  setBusy(mode) {
    this.recomputeButton.disabled = mode === 'busy';
    this.loadButton.disabled = mode === 'busy';
    this.loadButton.textContent = mode === 'busy' ? 'Loading…' : 'Load this area';
  }
}

export default Hud;
