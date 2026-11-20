/**
 * Water surface mesh and material.
 *
 * Shares the terrain's grid so every water vertex sits above its own simulation cell.
 * Depth comes from the solver state texture and velocity from the flux texture, both
 * read directly in the shaders, so the surface is always showing the current state of
 * the simulation with no copy step in between.
 */

import * as THREE from 'three';

import { visual, GRAVITY } from '../config.js';
import { resolveRenderIncludes } from './shaderChunks.js';

import waterVert from './shaders/water.vert.glsl?raw';
import waterFrag from './shaders/water.frag.glsl?raw';

export class WaterMesh {
  /**
   * @param {object} params
   * @param {object} params.domain
   * @param {THREE.Texture} params.bedTexture
   * @param {THREE.Texture} params.stateTexture
   * @param {THREE.Texture} params.fluxTexture
   */
  constructor({ domain, bedTexture, stateTexture, fluxTexture }) {
    this.domain = domain;

    const worldSize = domain.gridSize * domain.cellSize;
    const segments = domain.gridSize - 1;

    const geometry = new THREE.PlaneGeometry(worldSize, worldSize, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: resolveRenderIncludes(waterVert),
      fragmentShader: resolveRenderIncludes(waterFrag),
      transparent: true,
      // Depth testing on so terrain correctly hides water behind a ridge, but no depth
      // writing: a single transparent surface does not need to occlude itself, and
      // writing depth here would make the foam fringe punch holes in the water.
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,

      // The water sits a few centimetres above the terrain and shares its triangulation,
      // so over a large scene the two are coplanar as far as the depth buffer is
      // concerned and they z-fight. On a regular grid that shows up as a diamond
      // lattice: alternate triangles of each quad win the test. A fixed vertical bias
      // cannot fix it, because the depth resolution needed grows with viewing distance
      // while the bias does not. Polygon offset works in depth-buffer units instead, so
      // it holds at every distance, which is exactly the case it exists for.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      uniforms: {
        uBed: { value: bedTexture },
        uState: { value: stateTexture },
        uFlux: { value: fluxTexture },
        uImagery: { value: null },
        uHasImagery: { value: 0 },

        uTexel: { value: new THREE.Vector2(1 / domain.gridSize, 1 / domain.gridSize) },
        uCellSize: { value: domain.cellSize },
        uTime: { value: 0 },
        uVerticalExaggeration: { value: visual.verticalExaggeration },

        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uCameraPos: { value: new THREE.Vector3() },
        uFogDensity: { value: visual.fogDensity },

        uMinDrawDepth: { value: visual.minDrawDepth },
        uShorelineFade: { value: visual.shorelineFadeDepth },
        uExtinction: { value: new THREE.Vector3(...visual.extinction) },
        uWaterTint: { value: new THREE.Vector3(...visual.waterTint) },
        uSedimentTint: { value: new THREE.Vector3(...visual.sedimentTint) },
        uSedimentFullSpeed: { value: visual.sedimentFullSpeed },
        uFoamFroude: { value: visual.foamFroude },
        uRippleAmplitude: { value: visual.rippleAmplitude },
        uRippleWavelength: { value: visual.rippleWavelength },
        uGravity: { value: GRAVITY },
      },
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'water';
  }

  /**
   * The solver ping-pongs its targets, so the textures the water samples change every
   * frame and must be re-pointed.
   *
   * @param {THREE.Texture} stateTexture
   * @param {THREE.Texture} fluxTexture
   */
  setSolverTextures(stateTexture, fluxTexture) {
    this.material.uniforms.uState.value = stateTexture;
    this.material.uniforms.uFlux.value = fluxTexture;
  }

  /**
   * @param {THREE.Texture|null} texture
   */
  setImagery(texture) {
    this.material.uniforms.uImagery.value = texture;
    this.material.uniforms.uHasImagery.value = texture ? 1 : 0;
  }

  /**
   * @param {THREE.Vector3} sunDirection
   * @param {THREE.Vector3} cameraPosition
   * @param {number} elapsedSeconds wall clock, for ripple animation
   */
  update(sunDirection, cameraPosition, elapsedSeconds) {
    const u = this.material.uniforms;
    u.uSunDirection.value.copy(sunDirection);
    u.uCameraPos.value.copy(cameraPosition);
    u.uTime.value = elapsedSeconds;
  }

  /**
   * @param {number} factor
   */
  setVerticalExaggeration(factor) {
    this.material.uniforms.uVerticalExaggeration.value = factor;
  }

  /**
   * @param {boolean} visible
   */
  setVisible(visible) {
    this.mesh.visible = visible;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export default WaterMesh;
