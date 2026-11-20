/**
 * Visual representation of drifters: the raft, the figure riding it, markers, and the
 * trail each one leaves behind.
 *
 * Everything is built from primitives in code. No model files, no texture downloads, and
 * nothing else to keep in sync with the repository.
 *
 * A note on scale honesty. A 3 metre raft in a 24 kilometre domain is about one eighth of
 * one simulation cell. Viewed from 10 km up it is far smaller than a pixel. So the raft
 * can optionally be drawn larger than life to stay findable, and when it is, the UI says
 * so plainly and the figure is drawn in the same exaggeration so the proportions stay
 * truthful. The beacon above it is always drawn at a screen-stable size, because a
 * navigation aid is allowed to be a navigation aid.
 */

import * as THREE from 'three';

import { DRIFTER_STATE } from '../sim/Drifter.js';
import { visual } from '../config.js';

const WOOD = 0x8a6239;
const WOOD_DARK = 0x5e4126;
const ROPE = 0xc9b183;
const SHIRT = 0xd94f3d;
const SKIN = 0xe0b08a;
const TROUSERS = 0x3c4a63;
const HAT = 0xcbb278;

/** A raft of lashed logs with someone sitting on it holding a pole. */
function buildRaft() {
  const group = new THREE.Group();
  group.name = 'raft';

  const woodMaterial = new THREE.MeshStandardMaterial({
    color: WOOD,
    roughness: 0.85,
    metalness: 0,
  });
  const darkWoodMaterial = new THREE.MeshStandardMaterial({
    color: WOOD_DARK,
    roughness: 0.9,
    metalness: 0,
  });
  const ropeMaterial = new THREE.MeshStandardMaterial({
    color: ROPE,
    roughness: 1,
    metalness: 0,
  });

  // Six logs lying along the raft's long axis, which is +z, the direction of travel.
  const logGeometry = new THREE.CylinderGeometry(0.19, 0.19, 3.4, 8);
  logGeometry.rotateX(Math.PI / 2);

  for (let i = 0; i < 6; i += 1) {
    const log = new THREE.Mesh(logGeometry, i % 2 === 0 ? woodMaterial : darkWoodMaterial);
    log.position.set((i - 2.5) * 0.4, 0, 0);
    // A touch of variation so it does not read as a machined pallet.
    log.rotation.z = (i % 3) * 0.04;
    log.scale.z = 0.94 + (i % 4) * 0.03;
    group.add(log);
  }

  // Two cross spars lashing the logs together.
  const sparGeometry = new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6);
  sparGeometry.rotateZ(Math.PI / 2);
  for (const z of [-1.15, 1.15]) {
    const spar = new THREE.Mesh(sparGeometry, ropeMaterial);
    spar.position.set(0, 0.2, z);
    group.add(spar);
  }

  // --- The passenger ---------------------------------------------------------------
  const person = new THREE.Group();
  person.name = 'passenger';
  person.position.set(0, 0.19, -0.15);

  const shirtMaterial = new THREE.MeshStandardMaterial({ color: SHIRT, roughness: 0.75 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.6 });
  const trouserMaterial = new THREE.MeshStandardMaterial({ color: TROUSERS, roughness: 0.8 });
  const hatMaterial = new THREE.MeshStandardMaterial({ color: HAT, roughness: 0.9 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), shirtMaterial);
  torso.position.set(0, 0.44, 0);
  // Leaning forward a little, the way anyone braced on a moving raft sits.
  torso.rotation.x = 0.16;
  person.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 12), skinMaterial);
  head.position.set(0, 0.84, 0.03);
  person.add(head);

  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.17, 14), hatMaterial);
  hat.position.set(0, 0.95, 0.03);
  person.add(hat);

  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 16), hatMaterial);
  brim.position.set(0, 0.885, 0.03);
  person.add(brim);

  // Legs, folded forward as if sitting.
  const thighGeometry = new THREE.CapsuleGeometry(0.095, 0.3, 3, 8);
  for (const x of [-0.11, 0.11]) {
    const thigh = new THREE.Mesh(thighGeometry, trouserMaterial);
    thigh.position.set(x, 0.17, 0.22);
    thigh.rotation.x = Math.PI / 2.1;
    person.add(thigh);
  }

  // Arms reaching out to the pole.
  const armGeometry = new THREE.CapsuleGeometry(0.068, 0.34, 3, 8);
  const leftArm = new THREE.Mesh(armGeometry, shirtMaterial);
  leftArm.position.set(-0.24, 0.52, 0.14);
  leftArm.rotation.set(0.75, 0, -0.25);
  person.add(leftArm);

  const rightArm = new THREE.Mesh(armGeometry, shirtMaterial);
  rightArm.position.set(0.24, 0.55, 0.05);
  rightArm.rotation.set(0.35, 0, 0.3);
  person.add(rightArm);

  // A punt pole, held across the body at an angle.
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.038, 2.9, 7),
    darkWoodMaterial,
  );
  pole.position.set(0.12, 0.6, 0.35);
  pole.rotation.set(0.9, 0.2, 0.42);
  person.add(pole);

  group.add(person);
  group.userData.passenger = person;

  return group;
}

/** A simple floating marker, for when a raft and rider would be too much. */
function buildBuoy() {
  const group = new THREE.Group();
  group.name = 'buoy';

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xffa23a, roughness: 0.5 }),
  );
  body.scale.y = 0.8;
  group.add(body);

  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.56, 0.56, 0.16, 16),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6 }),
  );
  group.add(stripe);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 1.5, 6),
    new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.7 }),
  );
  mast.position.y = 0.8;
  group.add(mast);

  return group;
}

/** Tumbling debris, for showing the flow without implying anyone is in it. */
function buildDebris() {
  const group = new THREE.Group();
  group.name = 'debris';

  const material = new THREE.MeshStandardMaterial({ color: WOOD_DARK, roughness: 0.95 });
  const geometry = new THREE.CylinderGeometry(0.16, 0.13, 2.6, 6);
  geometry.rotateZ(Math.PI / 2);

  for (let i = 0; i < 3; i += 1) {
    const log = new THREE.Mesh(geometry, material);
    log.position.set((i - 1) * 0.1, i * 0.12, (i - 1) * 0.5);
    log.rotation.y = i * 0.7;
    group.add(log);
  }

  return group;
}

/**
 * The beacon drawn above a drifter so it can be found from altitude.
 *
 * Scaled every frame to hold a roughly constant screen size, which is what makes it a
 * usable navigation aid rather than either a speck or a skyscraper.
 */
function buildBeacon(colour) {
  const group = new THREE.Group();
  group.name = 'beacon';

  const material = new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 5), material);
  stem.position.y = 3;
  group.add(stem);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), material);
  head.position.y = 6.4;
  group.add(head);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.1, 6, 24), material);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.2;
  group.add(ring);

  return group;
}

/** Per-drifter view: the floating object, its beacon, and its trail. */
class DrifterView {
  /**
   * @param {import('../sim/Drifter.js').Drifter} drifter
   * @param {object} domain
   */
  constructor(drifter, domain) {
    this.drifter = drifter;
    this.domain = domain;

    this.group = new THREE.Group();
    this.group.name = `drifter-${drifter.id}`;

    if (drifter.kind === 'buoy') this.body = buildBuoy();
    else if (drifter.kind === 'debris') this.body = buildDebris();
    else this.body = buildRaft();

    this.scaleGroup = new THREE.Group();
    this.scaleGroup.add(this.body);
    this.group.add(this.scaleGroup);

    const colour = drifter.kind === 'raft' ? 0xffd34d : 0x59d9ff;
    this.beacon = buildBeacon(colour);
    this.group.add(this.beacon);

    // Trail. Pre-allocated to the drifter's cap so the buffer is never reallocated
    // mid-flight, which would stutter.
    const positions = new Float32Array(drifter.maxTrailPoints * 3);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    trailGeometry.setDrawRange(0, 0);

    this.trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    );
    this.trail.frustumCulled = false;
    this.trail.name = `drifter-trail-${drifter.id}`;

    this.#bobPhase = Math.random() * Math.PI * 2;
  }

  #bobPhase = 0;

  /**
   * @param {object} params
   * @param {(col: number, row: number) => {x: number, z: number}} params.toScene
   * @param {(col: number, row: number) => number} params.surfaceHeight
   * @param {number} params.elapsed wall-clock seconds, for bobbing
   * @param {number} params.cameraDistance metres from the camera to the drifter
   * @param {number} params.exaggeration 1 is true scale
   * @param {boolean} params.showBeacon
   */
  update({ toScene, surfaceHeight, elapsed, cameraDistance, exaggeration, showBeacon }) {
    const d = this.drifter;
    const scene = toScene(d.col, d.row);

    // Prefer the depth the drifter itself sampled this frame. The viewer's CPU depth
    // grid only refreshes every few dozen frames, and during the first surge that lag
    // is metres, which would leave the raft briefly buried or hovering.
    const ownSurface =
      d.depth > 0.01 ? (d.bedElevation + d.depth) * visual.verticalExaggeration : null;
    const surface = ownSurface ?? surfaceHeight(d.col, d.row);

    // Bob and pitch with the water. Amplitude rises with speed, because fast water is
    // rough water, and a raft on a still reservoir should sit almost perfectly flat.
    const motion = Math.min(1, d.speed / 3);
    const bob = Math.sin(elapsed * 1.7 + this.#bobPhase) * 0.09 * (0.3 + motion);
    const roll = Math.sin(elapsed * 1.25 + this.#bobPhase * 1.7) * 0.07 * motion;
    const pitch = Math.sin(elapsed * 2.1 + this.#bobPhase * 0.6) * 0.05 * motion;

    this.group.position.set(scene.x, surface + bob, scene.z);

    // Heading is a compass bearing, 0 north. The raft's long axis is +z, which is south,
    // so the yaw needed to point it along the heading is heading plus pi.
    this.body.rotation.set(pitch, d.heading + Math.PI, roll);

    const scale = Math.max(0.2, exaggeration);
    this.scaleGroup.scale.setScalar(scale);

    // Beacon held at a near-constant screen size.
    const beaconScale = THREE.MathUtils.clamp(cameraDistance / 420, 0.35, 70);
    this.beacon.scale.setScalar(beaconScale);
    this.beacon.visible = showBeacon;

    // A grounded raft stops bobbing and settles.
    if (d.state === DRIFTER_STATE.stranded) {
      this.body.rotation.set(0.04, d.heading + Math.PI, 0.02);
    }
    this.group.visible = d.state !== DRIFTER_STATE.leftDomain;

    this.#updateTrail(toScene, surfaceHeight);
  }

  #updateTrail(toScene, surfaceHeight) {
    const points = this.drifter.trail;
    const attribute = this.trail.geometry.getAttribute('position');
    const count = Math.min(points.length, this.drifter.maxTrailPoints);

    for (let i = 0; i < count; i += 1) {
      const p = points[i];
      const scene = toScene(p.col, p.row);
      attribute.setXYZ(i, scene.x, surfaceHeight(p.col, p.row) + 0.4, scene.z);
    }

    attribute.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, count);
    this.trail.visible = count > 1;
  }

  dispose() {
    this.group.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
    this.trail.geometry.dispose();
    this.trail.material.dispose();
  }
}

/** Manages every drifter's view. */
export class DrifterLayer {
  /**
   * @param {object} domain
   */
  constructor(domain) {
    this.domain = domain;
    this.group = new THREE.Group();
    this.group.name = 'drifters';
    this.views = new Map();

    /** Draw the raft larger than life so it stays findable. Labelled in the UI. */
    this.exaggerateScale = true;
    this.showBeacons = true;
  }

  /**
   * @param {import('../sim/Drifter.js').Drifter} drifter
   */
  add(drifter) {
    if (this.views.has(drifter.id)) return;
    const view = new DrifterView(drifter, this.domain);
    this.views.set(drifter.id, view);
    this.group.add(view.group);
    this.group.add(view.trail);
  }

  /**
   * @param {number} id
   */
  remove(id) {
    const view = this.views.get(id);
    if (!view) return;
    this.group.remove(view.group);
    this.group.remove(view.trail);
    view.dispose();
    this.views.delete(id);
  }

  clear() {
    for (const id of [...this.views.keys()]) this.remove(id);
  }

  /**
   * @param {object} params
   * @param {(col: number, row: number) => {x: number, z: number}} params.toScene
   * @param {(col: number, row: number) => number} params.surfaceHeight
   * @param {number} params.elapsed
   * @param {THREE.Vector3} params.cameraPosition
   */
  update({ toScene, surfaceHeight, elapsed, cameraPosition }) {
    for (const view of this.views.values()) {
      const distance = cameraPosition.distanceTo(view.group.position) || 1;

      // Grow the raft with distance up to a ceiling, so it is true scale when you are
      // close enough for that to mean anything and findable when you are not.
      const exaggeration = this.exaggerateScale
        ? THREE.MathUtils.clamp(distance / 260, 1, 14)
        : 1;

      view.update({
        toScene,
        surfaceHeight,
        elapsed,
        cameraDistance: distance,
        exaggeration,
        showBeacon: this.showBeacons && distance > 220,
      });
    }
  }

  dispose() {
    this.clear();
  }
}

export default DrifterLayer;
