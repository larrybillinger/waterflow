/**
 * The 3D view: renderer, scene, camera, and everything drawn in it.
 *
 * Owns the render loop's draw step but not its logic. The application tells the viewer
 * what to show; the viewer never decides what the simulation does.
 *
 * Two things here are worth knowing about:
 *
 *   Picking is a ray march against the CPU elevation grid, not a Three.js raycast. The
 *   terrain geometry on the CPU is a flat plane, because the height is applied in the
 *   vertex shader, so a raycast would return hits on a flat sheet at elevation zero.
 *   Marching the real heightfield is both correct and faster than uploading displaced
 *   geometry just so it can be intersected.
 *
 *   Render resolution adapts. If frames run long the pixel ratio steps down rather than
 *   the frame rate falling, which is requirement N-03.
 */

import * as THREE from 'three';

import { visual, performance as perfConfig } from '../config.js';
import { sceneToGrid, gridToScene } from '../data/geo.js';
import { sampleBilinear } from '../util/grid.js';
import TerrainMesh from './TerrainMesh.js';
import WaterMesh from './WaterMesh.js';
import Sky from './Sky.js';
import EarthControls from './EarthControls.js';
import CameraDirector from './CameraDirector.js';
import DrifterLayer from './Drifters.js';
import { StationMarkers, WatchPointMarker } from './Markers.js';

export class Viewer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      // Needed so a screenshot can be taken from the canvas after a frame is drawn.
      preserveDrawingBuffer: false,
    });

    this.renderer.setClearColor(0x87a3bd, 1);
    // ACES filmic tone mapping with sRGB output. Without tone mapping the specular
    // highlights on water clip to flat white and the whole scene reads as a video game
    // from 2004; with it the sun glint rolls off the way a camera would see it.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.pixelRatioCap = Math.min(window.devicePixelRatio || 1, perfConfig.maxPixelRatio);
    this.currentPixelRatio = this.pixelRatioCap;
    this.renderer.setPixelRatio(this.currentPixelRatio);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / Math.max(window.innerHeight, 1),
      1,
      400000,
    );

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);

    // Lights exist only for the raft and the markers, which use standard materials. The
    // terrain and water shaders light themselves from the same sun vector, so these two
    // are kept in step with it rather than being set independently.
    this.sunLight = new THREE.DirectionalLight(0xfff2d9, 2.1);
    this.sunLight.position.copy(this.sky.sunDirection).multiplyScalar(1000);
    this.scene.add(this.sunLight);

    this.ambientLight = new THREE.HemisphereLight(0xa8c4e0, 0x4a4433, 1.0);
    this.scene.add(this.ambientLight);

    /** @type {TerrainMesh|null} */
    this.terrain = null;
    /** @type {WaterMesh|null} */
    this.water = null;
    /** @type {DrifterLayer|null} */
    this.drifters = null;
    /** @type {StationMarkers|null} */
    this.stations = null;

    this.watchPoint = new WatchPointMarker();
    this.scene.add(this.watchPoint.group);

    /** @type {import('../util/grid.js').Grid|null} */
    this.elevationGrid = null;
    /** @type {import('../util/grid.js').Grid|null} */
    this.depthGrid = null;
    this.domain = null;

    this.controls = null;
    this.director = new CameraDirector(this.camera, {
      sampleHeight: (x, z) => this.sampleHeight(x, z),
    });

    this.frameTimes = [];

    this.#onResize = this.#handleResize.bind(this);
    window.addEventListener('resize', this.#onResize);
    this.#handleResize();
  }

  #onResize;

  /**
   * Build the scene for a loaded domain.
   *
   * @param {object} params
   * @param {object} params.domain
   * @param {import('../util/grid.js').Grid} params.elevationGrid
   * @param {THREE.Texture} params.bedTexture
   * @param {THREE.Texture} params.stateTexture
   * @param {THREE.Texture} params.fluxTexture
   */
  setDomain({ domain, elevationGrid, bedTexture, stateTexture, fluxTexture }) {
    this.disposeDomain();

    this.domain = domain;
    this.elevationGrid = elevationGrid;

    this.terrain = new TerrainMesh({ domain, bedTexture, stateTexture });
    this.scene.add(this.terrain.mesh);

    this.water = new WaterMesh({ domain, bedTexture, stateTexture, fluxTexture });
    this.scene.add(this.water.mesh);

    this.drifters = new DrifterLayer(domain);
    this.scene.add(this.drifters.group);

    this.stations = new StationMarkers(domain);
    this.scene.add(this.stations.group);

    const worldSize = domain.gridSize * domain.cellSize;
    const worldRadius = worldSize / 2;

    // Fog has to scale with the domain. A fixed density tuned for a few kilometres turns
    // a 24 km view into a flat grey wash: at that distance a density of 4.2e-5 blends
    // more than half the scene into the sky and the relief disappears. Tying it to the
    // world size keeps the far edge at a consistent, modest haze whatever area is
    // loaded, which is what actually conveys depth.
    const fogDensity = 0.35 / worldSize;
    this.terrain.material.uniforms.uFogDensity.value = fogDensity;
    this.water.material.uniforms.uFogDensity.value = fogDensity;

    // Depth precision in a perspective projection is governed by the near:far ratio, and
    // this scene spans metres to tens of kilometres. A near plane fixed low enough for
    // the onboard camera leaves only decimetres of depth resolution a couple of
    // kilometres out, which is not enough to separate the water from the ground it sits
    // on. So the near plane adapts to altitude each frame; see #updateNearPlane.
    this.camera.near = 1.0;
    this.camera.far = worldSize * 3;
    this.camera.updateProjectionMatrix();

    this.controls = new EarthControls(this.camera, this.canvas, {
      sampleHeight: (x, z) => this.sampleHeight(x, z),
      minDistance: 25,
      maxDistance: worldSize * 2.2,
      worldRadius,
    });

    // Open on an oblique view of the whole domain, which is the shot that shows what the
    // place looks like. Straight down tells the user nothing about relief.
    this.controls.setPose({
      focus: new THREE.Vector3(0, this.sampleHeight(0, 0), 0),
      distance: worldSize * 0.85,
      heading: Math.PI * 0.08,
      pitch: (34 * Math.PI) / 180,
    });

    this.sky.mesh.scale.setScalar(Math.max(worldSize * 2, 20000));
  }

  /**
   * @param {THREE.Texture|null} texture
   */
  setImagery(texture) {
    this.terrain?.setImagery(texture);
    this.water?.setImagery(texture);
  }

  /**
   * Keep the CPU-side copy of depth, used for drifter rendering and for the water
   * surface height under the raft.
   *
   * @param {import('../util/grid.js').Grid|null} depthGrid
   */
  setDepthGrid(depthGrid) {
    this.depthGrid = depthGrid;
  }

  /**
   * Ground elevation at a scene position, bilinear from the elevation grid.
   *
   * @param {number} x scene metres
   * @param {number} z scene metres
   * @returns {number} metres
   */
  sampleHeight(x, z) {
    if (!this.elevationGrid || !this.domain) return 0;
    const { col, row } = sceneToGrid(this.domain, x, z);
    return sampleBilinear(this.elevationGrid, col, row) * visual.verticalExaggeration;
  }

  /**
   * Water surface elevation at grid coordinates, for placing a drifter on the surface.
   *
   * @param {number} col
   * @param {number} row
   * @returns {number} metres
   */
  sampleSurface(col, row) {
    if (!this.elevationGrid) return 0;
    const bed = sampleBilinear(this.elevationGrid, col, row);
    const depth = this.depthGrid ? Math.max(0, sampleBilinear(this.depthGrid, col, row)) : 0;
    return (bed + depth) * visual.verticalExaggeration;
  }

  /**
   * Convert grid coordinates to scene coordinates.
   *
   * @param {number} col
   * @param {number} row
   * @returns {{x: number, z: number}}
   */
  toScene(col, row) {
    if (!this.domain) return { x: 0, z: 0 };
    return gridToScene(this.domain, col, row);
  }

  /**
   * Find where a screen position meets the terrain.
   *
   * Marches the ray in steps scaled to the cell size, detects the first step where the
   * ray passes below the surface, then bisects to refine. A fixed number of bisections
   * is enough: eight halvings of one cell is well under a metre, which is far finer than
   * the data justifies.
   *
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{col: number, row: number, x: number, z: number, elevation: number}|null}
   */
  pickTerrain(clientX, clientY) {
    if (!this.domain || !this.elevationGrid) return null;

    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);

    const origin = raycaster.ray.origin.clone();
    const direction = raycaster.ray.direction.clone().normalize();

    const worldSize = this.domain.gridSize * this.domain.cellSize;
    const step = Math.max(this.domain.cellSize * 0.5, 2);
    const maxDistance = worldSize * 3;

    let previousT = 0;
    let previousAbove = origin.y - this.sampleHeight(origin.x, origin.z);

    for (let t = step; t < maxDistance; t += step) {
      const point = origin.clone().addScaledVector(direction, t);

      // Give up once the ray is far outside the domain and still climbing.
      if (
        Math.abs(point.x) > worldSize * 1.6 ||
        Math.abs(point.z) > worldSize * 1.6
      ) {
        if (direction.y >= 0) break;
      }

      const above = point.y - this.sampleHeight(point.x, point.z);

      if (above <= 0 && previousAbove > 0) {
        // Bisect between previousT and t.
        let lo = previousT;
        let hi = t;
        for (let i = 0; i < 10; i += 1) {
          const mid = (lo + hi) / 2;
          const midPoint = origin.clone().addScaledVector(direction, mid);
          const midAbove = midPoint.y - this.sampleHeight(midPoint.x, midPoint.z);
          if (midAbove > 0) lo = mid;
          else hi = mid;
        }

        const hit = origin.clone().addScaledVector(direction, (lo + hi) / 2);
        const { col, row } = sceneToGrid(this.domain, hit.x, hit.z);

        if (
          col < -0.5 ||
          row < -0.5 ||
          col > this.domain.gridSize - 0.5 ||
          row > this.domain.gridSize - 0.5
        ) {
          return null;
        }

        return {
          col,
          row,
          x: hit.x,
          z: hit.z,
          elevation: sampleBilinear(this.elevationGrid, col, row),
        };
      }

      previousT = t;
      previousAbove = above;
    }

    return null;
  }

  /**
   * @param {number} elevationDeg
   * @param {number} azimuthDeg
   */
  setSun(elevationDeg, azimuthDeg) {
    this.sky.setSun(elevationDeg, azimuthDeg);
    this.sunLight.position.copy(this.sky.sunDirection).multiplyScalar(1000);
  }

  /**
   * @param {number} factor
   */
  setVerticalExaggeration(factor) {
    visual.verticalExaggeration = factor;
    this.terrain?.setVerticalExaggeration(factor);
    this.water?.setVerticalExaggeration(factor);
  }

  /**
   * Move the near plane with the camera's altitude.
   *
   * Nothing can be closer to the camera than roughly its height above the ground, so the
   * near plane can follow that instead of sitting at the minimum the closest shot needs.
   * Pulling it from 1 m to a few hundred metres when viewing from altitude recovers
   * orders of magnitude of depth precision, which is what keeps the water surface from
   * z-fighting with the bed it covers.
   *
   * Only updated when it has drifted appreciably: rebuilding the projection matrix every
   * frame is wasted work, and a continuously changing near plane makes depth values
   * jitter.
   */
  #updateNearPlane() {
    const ground = this.sampleHeight(this.camera.position.x, this.camera.position.z);
    const altitude = Math.max(1, this.camera.position.y - ground);

    const near = THREE.MathUtils.clamp(altitude * 0.05, 0.5, this.camera.far * 0.01);

    if (Math.abs(near - this.camera.near) / this.camera.near > 0.2) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  #handleResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  /**
   * Step the adaptive render resolution.
   *
   * Averaged over a window so one slow frame, which every browser produces occasionally,
   * does not drop the resolution.
   *
   * @param {number} frameMs
   * @returns {boolean} true if the resolution changed
   */
  #adaptResolution(frameMs) {
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length < 45) return false;

    const mean = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;

    if (mean > perfConfig.frameBudgetMs && this.currentPixelRatio > 0.6) {
      this.currentPixelRatio = Math.max(0.6, this.currentPixelRatio - 0.2);
      this.renderer.setPixelRatio(this.currentPixelRatio);
      return true;
    }

    if (mean < perfConfig.frameBudgetMs * 0.55 && this.currentPixelRatio < this.pixelRatioCap) {
      this.currentPixelRatio = Math.min(this.pixelRatioCap, this.currentPixelRatio + 0.2);
      this.renderer.setPixelRatio(this.currentPixelRatio);
      return true;
    }

    return false;
  }

  /**
   * Draw one frame.
   *
   * @param {object} params
   * @param {number} params.deltaSeconds
   * @param {number} params.elapsedSeconds
   * @returns {{frameMs: number, resolutionChanged: boolean}}
   */
  render({ deltaSeconds, elapsedSeconds }) {
    const start = performance.now();

    if (this.director.active) {
      // The director has the camera; EarthControls must not fight it.
      if (this.controls) this.controls.enabled = false;
    } else {
      if (this.controls) {
        this.controls.enabled = true;
        this.controls.update(deltaSeconds);
      }
    }

    this.#updateNearPlane();

    const sunDirection = this.sky.sunDirection;

    this.terrain?.updateLighting(sunDirection, this.camera.position);
    this.water?.update(sunDirection, this.camera.position, elapsedSeconds);

    this.drifters?.update({
      toScene: (col, row) => this.toScene(col, row),
      surfaceHeight: (col, row) => this.sampleSurface(col, row),
      elapsed: elapsedSeconds,
      cameraPosition: this.camera.position,
    });

    this.watchPoint.update(this.camera.position);

    this.renderer.render(this.scene, this.camera);

    const frameMs = performance.now() - start;
    return { frameMs, resolutionChanged: this.#adaptResolution(frameMs) };
  }

  /** Release the per-domain objects, keeping the renderer and scene. */
  disposeDomain() {
    if (this.terrain) {
      this.scene.remove(this.terrain.mesh);
      this.terrain.dispose();
      this.terrain = null;
    }
    if (this.water) {
      this.scene.remove(this.water.mesh);
      this.water.dispose();
      this.water = null;
    }
    if (this.drifters) {
      this.scene.remove(this.drifters.group);
      this.drifters.dispose();
      this.drifters = null;
    }
    if (this.stations) {
      this.scene.remove(this.stations.group);
      this.stations.dispose();
      this.stations = null;
    }
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }
  }

  dispose() {
    window.removeEventListener('resize', this.#onResize);
    this.disposeDomain();
    this.watchPoint.dispose();
    this.sky.dispose();
    this.renderer.dispose();
  }
}

export default Viewer;
