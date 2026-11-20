/**
 * Shared GLSL chunks for the render shaders.
 *
 * The sky function in particular must be identical in the sky dome and in the water
 * reflection, or the water will mirror a sky that is not the one on screen. Sharing one
 * chunk makes that structurally impossible rather than merely intended.
 */

import skyChunk from './shaders/sky.glsl?raw';
import noiseChunk from './shaders/noise.glsl?raw';

const CHUNKS = {
  'sky.glsl': skyChunk,
  'noise.glsl': noiseChunk,
};

/**
 * Resolve `#include "name.glsl"` directives in a render shader.
 *
 * @param {string} source
 * @returns {string}
 */
export function resolveRenderIncludes(source) {
  return source.replace(/^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm, (_match, name) => {
    const chunk = CHUNKS[name];
    if (chunk === undefined) {
      throw new Error(
        `Render shader #include "${name}" could not be resolved. Known chunks: ` +
          `${Object.keys(CHUNKS).join(', ')}.`,
      );
    }
    return chunk;
  });
}

export default { resolveRenderIncludes };
