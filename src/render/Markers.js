/**
 * Station markers and watch-point tags.
 *
 * Stations are drawn as staff gauges: a slim post at the thalweg whose coloured section
 * runs from the bed up to the peak water surface. A line of them down the valley shows
 * the flood profile at a glance, which is the thing the brief actually asks for, and it
 * reads instantly in a way a table never does.
 *
 * One InstancedMesh per part keeps the draw call count at two no matter how many
 * stations there are.
 */

import * as THREE from 'three';

const MAX_STATIONS = 256;

/** Shallow to deep, matching the depthRamp in terrain.frag.glsl. */
const DEPTH_STOPS = [
  { t: 0.0, colour: new THREE.Color(1.0, 0.937, 0.608) },
  { t: 0.33, colour: new THREE.Color(0.4, 0.8, 0.733) },
  { t: 0.66, colour: new THREE.Color(0.145, 0.459, 0.722) },
  { t: 1.0, colour: new THREE.Color(0.243, 0.165, 0.478) },
];

/**
 * @param {number} t 0 to 1
 * @returns {THREE.Color}
 */
function depthColour(t) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  for (let i = 1; i < DEPTH_STOPS.length; i += 1) {
    if (clamped <= DEPTH_STOPS[i].t) {
      const a = DEPTH_STOPS[i - 1];
      const b = DEPTH_STOPS[i];
      const local = (clamped - a.t) / (b.t - a.t);
      return a.colour.clone().lerp(b.colour, local);
    }
  }
  return DEPTH_STOPS.at(-1).colour.clone();
}

export class StationMarkers {
  /**
   * @param {object} domain
   */
  constructor(domain) {
    this.domain = domain;
    this.group = new THREE.Group();
    this.group.name = 'stations';

    // The wetted section of each gauge, scaled vertically to the peak depth.
    const postGeometry = new THREE.CylinderGeometry(1, 1, 1, 7);
    // Translate so the geometry grows upward from its origin, which makes the scale
    // multiply cleanly into a water depth.
    postGeometry.translate(0, 0.5, 0);

    this.posts = new THREE.InstancedMesh(
      postGeometry,
      new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }),
      MAX_STATIONS,
    );
    this.posts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.posts.count = 0;
    this.posts.frustumCulled = false;
    this.group.add(this.posts);

    // A cap disc sitting exactly at the peak water surface: the high water mark.
    const capGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
    this.caps = new THREE.InstancedMesh(
      capGeometry,
      new THREE.MeshStandardMaterial({
        color: 0xf5f5f0,
        roughness: 0.4,
        emissive: 0x222222,
      }),
      MAX_STATIONS,
    );
    this.caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.caps.count = 0;
    this.caps.frustumCulled = false;
    this.group.add(this.caps);

    this.#matrix = new THREE.Matrix4();
    this.#scale = new THREE.Vector3();
    this.#position = new THREE.Vector3();
    this.#quaternion = new THREE.Quaternion();
  }

  #matrix;
  #scale;
  #position;
  #quaternion;

  /**
   * Rebuild the markers from a station list.
   *
   * @param {import('../sim/stations.js').Station[]} stations
   * @param {(col: number, row: number) => {x: number, z: number}} toScene
   * @param {object} [options]
   * @param {number} [options.radius] post radius in metres
   */
  setStations(stations, toScene, options = {}) {
    const count = Math.min(stations.length, MAX_STATIONS);
    const radius = options.radius ?? Math.max(this.domain.cellSize * 0.35, 8);

    const peakDepth = stations.reduce((max, s) => Math.max(max, s.peakDepth), 0.1);

    for (let i = 0; i < count; i += 1) {
      const station = stations[i];
      const scene = toScene(station.col, station.row);

      // The gauge shows the depth actually reached at the thalweg. A minimum height
      // keeps a dry station visible as a marker rather than vanishing.
      const height = Math.max(station.thalwegDepth, 0.6);

      this.#position.set(scene.x, station.groundElevation, scene.z);
      this.#scale.set(radius, height, radius);
      this.#matrix.compose(this.#position, this.#quaternion, this.#scale);
      this.posts.setMatrixAt(i, this.#matrix);
      this.posts.setColorAt(i, depthColour(station.thalwegDepth / peakDepth));

      this.#position.set(scene.x, station.groundElevation + height, scene.z);
      this.#scale.set(radius * 2.1, Math.max(radius * 0.18, 1.2), radius * 2.1);
      this.#matrix.compose(this.#position, this.#quaternion, this.#scale);
      this.caps.setMatrixAt(i, this.#matrix);
    }

    this.posts.count = count;
    this.caps.count = count;
    this.posts.instanceMatrix.needsUpdate = true;
    this.caps.instanceMatrix.needsUpdate = true;
    if (this.posts.instanceColor) this.posts.instanceColor.needsUpdate = true;
  }

  clear() {
    this.posts.count = 0;
    this.caps.count = 0;
  }

  /**
   * @param {boolean} visible
   */
  setVisible(visible) {
    this.group.visible = visible;
  }

  dispose() {
    this.posts.geometry.dispose();
    this.posts.material.dispose();
    this.caps.geometry.dispose();
    this.caps.material.dispose();
  }
}

/** A tagged spot the camera can watch, placed by the user. */
export class WatchPointMarker {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'watch-point';
    this.group.visible = false;

    const material = new THREE.MeshBasicMaterial({
      color: 0x7bf7a0,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 8, 28), material);
    ring.rotation.x = Math.PI / 2;
    this.group.add(ring);

    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.07, 6, 20), material);
    inner.rotation.x = Math.PI / 2;
    this.group.add(inner);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5, 5), material);
    stem.position.y = 2.5;
    this.group.add(stem);

    this.scaler = this.group;
  }

  /**
   * @param {{x: number, z: number}} scene
   * @param {number} elevation
   */
  setPosition(scene, elevation) {
    this.group.position.set(scene.x, elevation + 0.5, scene.z);
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  /**
   * Hold a constant screen size.
   *
   * @param {THREE.Vector3} cameraPosition
   */
  update(cameraPosition) {
    if (!this.group.visible) return;
    const distance = cameraPosition.distanceTo(this.group.position) || 1;
    this.group.scale.setScalar(THREE.MathUtils.clamp(distance / 55, 0.6, 320));
  }

  dispose() {
    this.group.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
  }
}

export default StationMarkers;
