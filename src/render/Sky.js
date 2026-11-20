/**
 * Sky dome.
 *
 * A sphere rendered from the inside, centred on the camera, using the same skyRadiance
 * function the water reflects. See decision D-008.
 */

import * as THREE from 'three';

import { visual } from '../config.js';
import { resolveRenderIncludes } from './shaderChunks.js';

import skyVert from './shaders/skydome.vert.glsl?raw';
import skyFrag from './shaders/skydome.frag.glsl?raw';

/**
 * Sun direction from elevation and azimuth.
 *
 * Azimuth is measured clockwise from north, which is the convention every compass and
 * every solar table uses. In scene axes north is -z and east is +x.
 *
 * @param {number} elevationDeg degrees above the horizon
 * @param {number} azimuthDeg degrees clockwise from north
 * @returns {THREE.Vector3} unit vector pointing toward the sun
 */
export function sunDirectionFrom(elevationDeg, azimuthDeg) {
  const elevation = (elevationDeg * Math.PI) / 180;
  const azimuth = (azimuthDeg * Math.PI) / 180;

  const horizontal = Math.cos(elevation);
  return new THREE.Vector3(
    horizontal * Math.sin(azimuth),
    Math.sin(elevation),
    -horizontal * Math.cos(azimuth),
  ).normalize();
}

export class Sky {
  constructor() {
    this.sunDirection = sunDirectionFrom(visual.sunElevationDeg, visual.sunAzimuthDeg);

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: resolveRenderIncludes(skyVert),
      fragmentShader: resolveRenderIncludes(skyFrag),
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uSunDirection: { value: this.sunDirection.clone() },
      },
    });

    // Radius is irrelevant because the dome follows the camera and writes no depth, so a
    // modest sphere with enough segments for a smooth sun disc is the right trade.
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.name = 'sky';
  }

  /**
   * @param {number} elevationDeg
   * @param {number} azimuthDeg
   */
  setSun(elevationDeg, azimuthDeg) {
    this.sunDirection = sunDirectionFrom(elevationDeg, azimuthDeg);
    this.material.uniforms.uSunDirection.value.copy(this.sunDirection);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export default Sky;
