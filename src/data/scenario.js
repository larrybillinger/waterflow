/**
 * Scenario export and import.
 *
 * A scenario captures everything needed to reproduce a study: location, grid, dam
 * placement, breach settings, and terrain edits as a sparse array of delta values.
 * It is saved as JSON and can be reloaded to restore the state.
 *
 * The sparse array format is adopted from ChatGPT's implementation: rather than
 * saving the entire grid (which at 512×512 is 1 MB of floats), we save only the
 * cells that differ from the loaded terrain, as [index, deltaMetres] pairs.
 *
 * The format is versioned so future changes can be read.
 */

const FORMAT_VERSION = 1;

/**
 * Build a JSON-serialisable scenario object from the current app state.
 *
 * @param {object} params
 * @param {object} params.domain
 * @param {object|null} params.dam
 * @param {object|null} params.damEndpoints
 * @param {object} params.breach
 * @param {number} params.crestElevation
 * @param {number} params.poolElevation
 * @param {import('../edit/TerrainEditor.js').TerrainEditor} params.editor
 * @param {string} params.imagerySource
 * @param {number} params.manningN
 * @param {string} params.version  App version string.
 * @returns {object}
 */
export function exportScenario({
  domain,
  dam,
  damEndpoints,
  breach,
  crestElevation,
  poolElevation,
  editor,
  imagerySource,
  manningN,
  version,
}) {
  // Build sparse terrain edits: only cells that differ from the original DEM.
  const edits = [];
  if (editor && editor.editedCells.size > 0) {
    const original = editor.originalGrid.data;
    const current = editor.grid.data;
    for (const index of editor.editedCells) {
      const delta = current[index] - original[index];
      if (Math.abs(delta) > 0.001) {
        edits.push([index, Math.round(delta * 1000) / 1000]);
      }
    }
  }

  return {
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: version,

    location: {
      lat: domain.lat,
      lon: domain.lon,
      domainMeters: domain.domainMeters,
      gridSize: domain.gridSize,
    },

    imagerySource,
    manningN,

    dam: damEndpoints
      ? {
          start: { col: damEndpoints.start.col, row: damEndpoints.start.row },
          end: { col: damEndpoints.end.col, row: damEndpoints.end.row },
          crestElevation,
          crestWidth: dam?.crestWidth ?? 10,
        }
      : null,

    poolElevation: damEndpoints ? poolElevation : null,

    breach: { ...breach },

    terrainEdits: edits,
  };
}

/**
 * Trigger a JSON file download.
 *
 * @param {object} scenario
 */
export function downloadScenario(scenario) {
  const json = JSON.stringify(scenario, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const name = `waterflow-scenario-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Read a scenario JSON file chosen by the user.
 *
 * @returns {Promise<object>} Parsed scenario object.
 */
export function loadScenarioFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(/** @type {string} */ (reader.result));
          if (!data.formatVersion || !data.location) {
            reject(new Error('Not a valid Waterflow scenario file.'));
            return;
          }
          resolve(data);
        } catch (e) {
          reject(new Error(`Invalid JSON: ${e.message}`));
        }
      };
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsText(file);
    });
    input.click();
  });
}

/**
 * Apply saved terrain edits (sparse deltas) onto a freshly loaded grid.
 *
 * @param {import('../util/grid.js').Grid} grid
 * @param {Array<[number, number]>} edits  [index, deltaMetres] pairs.
 * @param {Set<number>} [editedCells]  Optional set to track which cells were edited.
 */
export function applyTerrainEdits(grid, edits, editedCells) {
  for (const [index, delta] of edits) {
    if (index >= 0 && index < grid.data.length) {
      grid.data[index] += delta;
      editedCells?.add(index);
    }
  }
}

export default { exportScenario, downloadScenario, loadScenarioFile, applyTerrainEdits };
