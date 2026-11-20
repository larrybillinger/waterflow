/**
 * Camera director for movie mode.
 *
 * Takes over the camera from EarthControls and drives it in one of several cinematic
 * modes. Every mode computes a desired eye position and a desired look-at point, then
 * both are damped toward those targets. The damping is what separates a camera that
 * follows a raft from a camera that is bolted to one: a rigid follow transmits every
 * jitter in the velocity field straight into the viewer's eyes.
 *
 * Handing control back to EarthControls writes the current pose into it, so the view
 * never jumps when movie mode ends.
 */

import * as THREE from 'three';

/** @typedef {'chase'|'onboard'|'orbit'|'watch'|'flyover'} DirectorMode */

export const DIRECTOR_MODES = {
  chase: {
    id: 'chase',
    label: 'Chase',
    describe: 'Behind and above, looking downstream. The classic follow shot.',
  },
  onboard: {
    id: 'onboard',
    label: 'Onboard',
    describe: 'Riding on the raft, looking where it is heading.',
  },
  orbit: {
    id: 'orbit',
    label: 'Orbit',
    describe: 'Circles the raft slowly while it drifts.',
  },
  watch: {
    id: 'watch',
    label: 'Watch point',
    describe: 'Camera holds still and watches the water arrive at a chosen spot.',
  },
  flyover: {
    id: 'flyover',
    label: 'Valley flyover',
    describe: 'Flies the downstream path from the dam, independent of the simulation.',
  },
};

export class CameraDirector {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} [options]
   * @param {(x: number, z: number) => number} [options.sampleHeight]
   */
  constructor(camera, options = {}) {
    this.camera = camera;
    this.sampleHeight = options.sampleHeight ?? (() => 0);

    this.active = false;
    /** @type {DirectorMode} */
    this.mode = 'chase';

    this.eye = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.targetEye = new THREE.Vector3();
    this.targetLook = new THREE.Vector3();

    /** Chase shot framing. */
    this.chaseDistance = 34;
    this.chaseHeight = 13;
    /** How far ahead of the subject the camera looks, in metres. */
    this.lead = 26;

    /** Orbit shot framing. */
    this.orbitRadius = 30;
    this.orbitHeight = 14;
    this.orbitSpeed = 0.17;
    this.orbitAngle = 0;

    /** Onboard framing. */
    this.onboardHeight = 1.5;

    /** Flyover framing. */
    this.flyoverHeight = 180;
    this.flyoverSpeed = 420;
    this.flyoverDistance = 0;
    /** @type {Array<{x: number, z: number, distance: number}>} */
    this.flyoverPath = [];

    /** Positional damping. Lower is smoother and laggier. */
    this.eyeDamping = 0.045;
    this.lookDamping = 0.1;

    this.#initialised = false;
  }

  #initialised = false;

  /**
   * Begin directing, seeding the pose from where the camera already is so the first
   * frame does not cut.
   *
   * @param {DirectorMode} mode
   */
  begin(mode) {
    this.mode = mode;
    this.active = true;

    if (!this.#initialised) {
      this.eye.copy(this.camera.position);
      // Look-at is not stored on a Three.js camera, so derive it from the orientation.
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.look.copy(this.camera.position).addScaledVector(forward, 60);
      this.#initialised = true;
    }

    if (mode === 'orbit') this.orbitAngle = 0;
    if (mode === 'flyover') this.flyoverDistance = 0;
  }

  /** Stop directing. */
  end() {
    this.active = false;
  }

  /**
   * Set the downstream path used by the flyover mode.
   *
   * @param {Array<{x: number, z: number, distance: number}>} path scene coordinates
   */
  setFlyoverPath(path) {
    this.flyoverPath = path;
    this.flyoverDistance = 0;
  }

  /**
   * Advance and apply the camera.
   *
   * @param {object} params
   * @param {number} params.deltaSeconds wall clock
   * @param {THREE.Vector3|null} params.subject position of the thing being followed
   * @param {number} [params.heading] subject heading in radians, 0 north
   * @param {number} [params.speed] subject speed in m/s, used to frame faster shots wider
   * @param {THREE.Vector3|null} [params.watchPoint] for watch mode
   * @param {THREE.Vector3|null} [params.watchEye] camera position for watch mode
   */
  update({ deltaSeconds, subject, heading = 0, speed = 0, watchPoint, watchEye }) {
    if (!this.active) return;

    const dt = Math.min(Math.max(deltaSeconds, 0.0001), 0.1);

    switch (this.mode) {
      case 'onboard':
        this.#frameOnboard(subject, heading);
        break;
      case 'orbit':
        this.#frameOrbit(subject, dt);
        break;
      case 'watch':
        this.#frameWatch(watchPoint, watchEye);
        break;
      case 'flyover':
        this.#frameFlyover(dt);
        break;
      case 'chase':
      default:
        this.#frameChase(subject, heading, speed);
        break;
    }

    // Frame-rate independent damping. Onboard is nearly rigid, because a passenger's
    // eyes do move with the raft; the exterior shots lag deliberately.
    const eyeBlend =
      this.mode === 'onboard'
        ? 1 - Math.pow(1 - 0.5, dt * 60)
        : 1 - Math.pow(1 - this.eyeDamping, dt * 60);
    const lookBlend = 1 - Math.pow(1 - this.lookDamping, dt * 60);

    this.eye.lerp(this.targetEye, eyeBlend);
    this.look.lerp(this.targetLook, lookBlend);

    // Keep the camera above the ground. A chase camera rounding a bend will otherwise
    // clip straight through the inside bank.
    const ground = this.sampleHeight(this.eye.x, this.eye.z);
    const floor = ground + (this.mode === 'onboard' ? 0.6 : 4);
    if (this.eye.y < floor) this.eye.y = floor;

    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld();
  }

  #frameChase(subject, heading, speed) {
    if (!subject) return;

    // Behind the subject, where "behind" is opposite its heading. Heading 0 is north,
    // which is -z, so the forward vector is (sin h, 0, -cos h).
    const forward = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));

    // Open the shot out as the raft speeds up, which is how a real follow shot keeps a
    // fast subject in frame and reads as faster rather than just closer.
    const widen = 1 + Math.min(speed / 6, 1.1);

    this.targetEye
      .copy(subject)
      .addScaledVector(forward, -this.chaseDistance * widen)
      .add(new THREE.Vector3(0, this.chaseHeight * (0.85 + widen * 0.3), 0));

    this.targetLook.copy(subject).addScaledVector(forward, this.lead * widen);
    this.targetLook.y = subject.y + 1.5;
  }

  #frameOnboard(subject, heading) {
    if (!subject) return;

    const forward = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));

    this.targetEye.copy(subject).add(new THREE.Vector3(0, this.onboardHeight, 0));
    // Sit slightly back on the deck so the raft itself is in shot, which is what makes
    // a point of view shot read as being on board rather than hovering.
    this.targetEye.addScaledVector(forward, -1.1);

    this.targetLook
      .copy(subject)
      .addScaledVector(forward, 70)
      .add(new THREE.Vector3(0, this.onboardHeight - 2.5, 0));
  }

  #frameOrbit(subject, dt) {
    if (!subject) return;

    this.orbitAngle += this.orbitSpeed * dt;

    this.targetEye.set(
      subject.x + Math.cos(this.orbitAngle) * this.orbitRadius,
      subject.y + this.orbitHeight,
      subject.z + Math.sin(this.orbitAngle) * this.orbitRadius,
    );
    this.targetLook.copy(subject);
  }

  #frameWatch(watchPoint, watchEye) {
    if (!watchPoint) return;
    this.targetLook.copy(watchPoint);
    if (watchEye) this.targetEye.copy(watchEye);
  }

  #frameFlyover(dt) {
    if (this.flyoverPath.length < 2) return;

    this.flyoverDistance += this.flyoverSpeed * dt;

    const total = this.flyoverPath.at(-1).distance;
    if (this.flyoverDistance > total) this.flyoverDistance = 0;

    const here = this.#samplePath(this.flyoverDistance);
    const ahead = this.#samplePath(Math.min(total, this.flyoverDistance + 450));

    this.targetEye.set(here.x, this.sampleHeight(here.x, here.z) + this.flyoverHeight, here.z);
    this.targetLook.set(
      ahead.x,
      this.sampleHeight(ahead.x, ahead.z) + this.flyoverHeight * 0.25,
      ahead.z,
    );
  }

  /**
   * Linear interpolation along the flyover path by accumulated distance.
   *
   * @param {number} distance metres
   * @returns {{x: number, z: number}}
   */
  #samplePath(distance) {
    const path = this.flyoverPath;
    if (path.length === 0) return { x: 0, z: 0 };
    if (distance <= 0) return path[0];

    for (let i = 1; i < path.length; i += 1) {
      if (path[i].distance >= distance) {
        const a = path[i - 1];
        const b = path[i];
        const span = b.distance - a.distance;
        const t = span > 0 ? (distance - a.distance) / span : 0;
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      }
    }

    return path.at(-1);
  }

  /**
   * The current pose, for handing back to EarthControls without a cut.
   *
   * @returns {{focus: THREE.Vector3, distance: number, heading: number, pitch: number}}
   */
  getPose() {
    const toLook = new THREE.Vector3().subVectors(this.look, this.eye);
    const distance = Math.max(toLook.length(), 30);

    const horizontal = Math.hypot(toLook.x, toLook.z);
    const pitch = Math.atan2(-toLook.y, horizontal);
    // Inverse of the offset construction in EarthControls.
    const heading = Math.atan2(-toLook.x, toLook.z) + Math.PI;

    return {
      focus: this.look.clone(),
      distance,
      heading,
      pitch: THREE.MathUtils.clamp(pitch, 3 * (Math.PI / 180), 89 * (Math.PI / 180)),
    };
  }
}

export default CameraDirector;
