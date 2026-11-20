/**
 * Entry point.
 *
 * Keeps startup failures legible. A WebGL2 or float-texture failure throws from deep
 * inside the solver's constructor, and without this the user would see a black screen
 * and no reason for it. See the Logging Rule in AGENTS.md.
 */

import './ui/styles.css';
import WaterflowApp from './app.js';

const VERSION = 'v0.1.0';

function showFatal(message) {
  const loading = document.getElementById('loading');
  if (!loading) {
    // Nothing to render into, so the console is the only channel left.
    console.error('[waterflow]', message);
    return;
  }

  loading.classList.remove('done');
  loading.style.display = 'grid';

  const step = loading.querySelector('.step');
  if (step) step.textContent = 'Could not start';

  const error = loading.querySelector('.error');
  if (error) {
    error.textContent = message;
    error.style.display = 'block';
  }
}

async function boot() {
  const canvas = document.getElementById('viewport');
  const loading = document.getElementById('loading');

  if (!(canvas instanceof HTMLCanvasElement)) {
    showFatal('The page is missing its canvas element. The build may be incomplete.');
    return;
  }

  let app;
  try {
    app = new WaterflowApp({ canvas, loadingElement: loading, version: VERSION });
  } catch (error) {
    showFatal(
      `${error?.message ?? String(error)}\n\n` +
        'Waterflow needs WebGL2 with floating point render targets. On a desktop that ' +
        'usually means enabling hardware acceleration in the browser settings.',
    );
    return;
  }

  // Exposed deliberately so the solver and the grids can be inspected from the console
  // while debugging a scenario, which is far more useful than adding log statements.
  window.waterflow = app;

  await app.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
