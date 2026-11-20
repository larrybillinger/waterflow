/**
 * Terrain mesh and material.
 *
 * One vertex per simulation cell. The geometry never changes: height comes from the
 * elevation texture in the vertex shader, so a terrain edit is a texture upload. That
 * means the renderer and the solver cannot disagree about where the ground is, which
 * would otherwise be a subtle and very confusing class of bug.
 */

import * as THREE from 'three';

import { visual } from '../config.js';
import { resolveRenderIncludes } from './shaderChunks.js';

import terrainVert from './shaders/terrain.vert.glsl?raw';
import terrainFrag from './shaders/terrain.frag.glsl?raw';

/** Overlay modes for the result maps. Keep in step with terrain.frag.glsl. */
export const OVERLAY_MODES = {
  none: 0,
  maxDepth: 1,
  arrival: 2,
  velocity: 3,
  liveDepth: 4,
};

export class TerrainMesh {
  /**
   * @param {object} params
   * @param {object} params.domain from geo.createDomain
   * @param {THREE.Texture} params.bedTexture
   * @param {THREE.Texture} params.stateTexture
   */
  constructor({ domain, bedTexture, stateTexture }) {
    this.domain = domain;

    const worldSize = domain.gridSize * domain.cellSize;
    const segments = domain.gridSize - 1;

    const geometry = new THREE.PlaneGeometry(worldSize, worldSize, segments, segments);
    // Lay the plane into the ground plane. Local +y becomes world -z, which is why the
    // shaders flip v. See the note in terrain.vert.glsl.
    geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: resolveRenderIncludes(terrainVert),
      fragmentShader: resolveRenderIncludes(terrainFrag),
      uniforms: {
        uBed: { value: bedTexture },
        uState: { value: stateTexture },
        uImagery: { value: null },
        uHasImagery: { value: 0 },

        uTexel: { value: new THREE.Vector2(1 / domain.gridSize, 1 / domain.gridSize) },
        uCellSize: { value: domain.cellSize },
        uVerticalExaggeration: { value: visual.verticalExaggeration },

        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uFogDensity: { value: visual.fogDensity },
        uCameraPos: { value: new THREE.Vector3() },

        uMinElevation: { value: 0 },
        uMaxElevation: { value: 1000 },

        uOverlayMode: { value: OVERLAY_MODES.none },
        uOverlayOpacity: { value: 0.75 },
        uOverlayMaxDepth: { value: 10 },
        uOverlayMaxTime: { value: 3600 },
        uOverlayMaxSpeed: { value: 5 },

        uBrushActive: { value: 0 },
        uBrushCentre: { value: new THREE.Vector2() },
        uBrushRadius: { value: 0.05 },
        uBrushColour: { value: new THREE.Color(0.35, 0.85, 1.0) },

        uGuideActive: { value: 0 },
        uGuideStart: { value: new THREE.Vector2() },
        uGuideEnd: { value: new THREE.Vector2() },
      },
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.mesh.name = 'terrain';
  }

  /**
   * @param {number} min metres
   * @param {number} max metres
   */
  setElevationRange(min, max) {
    this.material.uniforms.uMinElevation.value = min;
    this.material.uniforms.uMaxElevation.value = max;
  }

  /**
   * @param {THREE.Texture|null} texture
   */
  setImagery(texture) {
    this.material.uniforms.uImagery.value = texture;
    this.material.uniforms.uHasImagery.value = texture ? 1 : 0;
  }

  /**
   * @param {THREE.Vector3} sunDirection normalised, pointing toward the sun
   * @param {THREE.Vector3} cameraPosition
   */
  updateLighting(sunDirection, cameraPosition) {
    this.material.uniforms.uSunDirection.value.copy(sunDirection);
    this.material.uniforms.uCameraPos.value.copy(cameraPosition);
  }

  /**
   * @param {keyof OVERLAY_MODES} mode
   * @param {object} [scales]
   * @param {number} [scales.maxDepth]
   * @param {number} [scales.maxTime]
   * @param {number} [scales.maxSpeed]
   * @param {number} [scales.opacity]
   */
  setOverlay(mode, scales = {}) {
    const u = this.material.uniforms;
    u.uOverlayMode.value = OVERLAY_MODES[mode] ?? OVERLAY_MODES.none;
    if (scales.maxDepth !== undefined) u.uOverlayMaxDepth.value = scales.maxDepth;
    if (scales.maxTime !== undefined) u.uOverlayMaxTime.value = scales.maxTime;
    if (scales.maxSpeed !== undefined) u.uOverlayMaxSpeed.value = scales.maxSpeed;
    if (scales.opacity !== undefined) u.uOverlayOpacity.value = scales.opacity;
  }

  /**
   * Show the brush cursor on the surface.
   *
   * Drawn into the terrain shader rather than as a separate ring mesh so it follows the
   * ground exactly, including over a ridge, with no clipping or floating.
   *
   * @param {{col: number, row: number}|null} cell null hides the cursor
   * @param {number} [radiusCells]
   * @param {THREE.Color|number} [colour]
   */
  setBrushCursor(cell, radiusCells = 10, colour = 0x59d9ff) {
    const u = this.material.uniforms;
    if (!cell) {
      u.uBrushActive.value = 0;
      return;
    }
    u.uBrushActive.value = 1;
    u.uBrushCentre.value.set(
      (cell.col + 0.5) / this.domain.gridSize,
      (cell.row + 0.5) / this.domain.gridSize,
    );
    u.uBrushRadius.value = radiusCells / this.domain.gridSize;
    u.uBrushColour.value.set(colour);
  }

  /**
   * Show the dam axis guide line.
   *
   * @param {{col: number, row: number}|null} start
   * @param {{col: number, row: number}|null} end
   */
  setGuideLine(start, end) {
    const u = this.material.uniforms;
    if (!start || !end) {
      u.uGuideActive.value = 0;
      return;
    }
    u.uGuideActive.value = 1;
    const n = this.domain.gridSize;
    u.uGuideStart.value.set((start.col + 0.5) / n, (start.row + 0.5) / n);
    u.uGuideEnd.value.set((end.col + 0.5) / n, (end.row + 0.5) / n);
  }

  /**
   * @param {number} factor 1 is true scale
   */
  setVerticalExaggeration(factor) {
    this.material.uniforms.uVerticalExaggeration.value = factor;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export default TerrainMesh;
