/**
 * Google-Earth-style camera controls.
 *
 * Written from scratch rather than using OrbitControls, because the feel the brief asks
 * for comes from two behaviours OrbitControls does not have:
 *
 *   Grab-and-drag panning. The terrain point under the cursor when the drag starts stays
 *   under the cursor as the mouse moves. OrbitControls pans by a screen-space delta
 *   scaled by distance, which feels approximately right at the centre of the screen and
 *   wrong everywhere else.
 *
 *   Zoom toward the cursor. Scrolling moves the camera toward the point under the
 *   pointer, not toward the centre of the screen. This is the single thing that makes
 *   Google Earth feel like you are handling a globe rather than driving a turntable.
 *
 * The camera is described by a focus point on the ground, a distance from it, a heading
 * and a pitch. Everything is damped toward a target value, so motion carries a little
 * inertia and never snaps.
 */

import * as THREE from 'three';

const DEG = Math.PI / 180;

export class EarthControls {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement
   * @param {object} [options]
   * @param {(x: number, z: number) => number} [options.sampleHeight] ground height lookup
   * @param {number} [options.minDistance]
   * @param {number} [options.maxDistance]
   * @param {number} [options.worldRadius] half the domain edge, used to bound panning
   */
  constructor(camera, domElement, options = {}) {
    this.camera = camera;
    this.domElement = domElement;

    this.sampleHeight = options.sampleHeight ?? (() => 0);
    this.minDistance = options.minDistance ?? 40;
    this.maxDistance = options.maxDistance ?? 120000;
    this.worldRadius = options.worldRadius ?? 20000;

    /** Where the camera is looking, on the ground. */
    this.focus = new THREE.Vector3(0, 0, 0);
    this.targetFocus = this.focus.clone();

    this.distance = Math.min(this.maxDistance, this.worldRadius * 1.4);
    this.targetDistance = this.distance;

    /** Radians. 0 looks north. */
    this.heading = 0;
    this.targetHeading = 0;

    /** Radians above the horizon. */
    this.pitch = 48 * DEG;
    this.targetPitch = this.pitch;

    this.minPitch = 3 * DEG;
    this.maxPitch = 89 * DEG;

    /** Higher is snappier. 1 would be instant. */
    this.damping = 0.16;

    this.enabled = true;

    this.#state = {
      mode: null,
      pointerId: null,
      lastX: 0,
      lastY: 0,
      grabPoint: new THREE.Vector3(),
      grabFocus: new THREE.Vector3(),
    };

    this.#keys = new Set();
    this.#raycaster = new THREE.Raycaster();
    this.#groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.#bind();
    this.update(0);
  }

  #state;
  #keys;
  #raycaster;
  #groundPlane;
  #listeners = [];

  #bind() {
    const el = this.domElement;

    const add = (target, type, handler, opts) => {
      target.addEventListener(type, handler, opts);
      this.#listeners.push([target, type, handler]);
    };

    add(el, 'pointerdown', this.#onPointerDown.bind(this));
    add(window, 'pointermove', this.#onPointerMove.bind(this));
    add(window, 'pointerup', this.#onPointerUp.bind(this));
    add(window, 'pointercancel', this.#onPointerUp.bind(this));
    add(el, 'wheel', this.#onWheel.bind(this), { passive: false });
    add(el, 'contextmenu', (event) => event.preventDefault());
    add(window, 'keydown', this.#onKeyDown.bind(this));
    add(window, 'keyup', this.#onKeyUp.bind(this));

    // Two-finger pinch and twist on a tablet, which is requirement N-06.
    this.#touches = new Map();
    add(el, 'touchstart', this.#onTouchStart.bind(this), { passive: false });
    add(el, 'touchmove', this.#onTouchMove.bind(this), { passive: false });
    add(el, 'touchend', this.#onTouchEnd.bind(this));
  }

  #touches;
  #pinch = null;

  /**
   * Normalised device coordinates for a pointer event.
   *
   * @param {number} clientX
   * @param {number} clientY
   * @returns {THREE.Vector2}
   */
  #ndc(clientX, clientY) {
    const rect = this.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  /**
   * Where a screen position hits the ground.
   *
   * The plane is placed at the height of the terrain under the current focus, which is a
   * good approximation over a valley and avoids a ray march. For panning it only needs
   * to be consistent between the drag start and the drag move, which it is.
   *
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} [planeHeight]
   * @returns {THREE.Vector3|null}
   */
  screenToGround(clientX, clientY, planeHeight) {
    const ndc = this.#ndc(clientX, clientY);
    this.#raycaster.setFromCamera(ndc, this.camera);

    const height = planeHeight ?? this.sampleHeight(this.focus.x, this.focus.z);
    this.#groundPlane.set(new THREE.Vector3(0, 1, 0), -height);

    const hit = new THREE.Vector3();
    const result = this.#raycaster.ray.intersectPlane(this.#groundPlane, hit);
    return result ? hit : null;
  }

  #onPointerDown(event) {
    if (!this.enabled) return;
    if (event.pointerType === 'touch') return; // handled by the touch path

    this.domElement.setPointerCapture?.(event.pointerId);
    this.#state.pointerId = event.pointerId;
    this.#state.lastX = event.clientX;
    this.#state.lastY = event.clientY;

    const wantsOrbit = event.button === 2 || event.button === 1 || event.ctrlKey || event.shiftKey;
    this.#state.mode = wantsOrbit ? 'orbit' : 'pan';

    if (this.#state.mode === 'pan') {
      const ground = this.screenToGround(event.clientX, event.clientY);
      if (ground) {
        this.#state.grabPoint.copy(ground);
        this.#state.grabFocus.copy(this.targetFocus);
      } else {
        this.#state.mode = 'orbit';
      }
    }
  }

  #onPointerMove(event) {
    if (!this.enabled || this.#state.mode === null) return;
    if (event.pointerId !== this.#state.pointerId) return;

    if (this.#state.mode === 'pan') {
      // Keep the grabbed ground point under the cursor. Solve for the focus offset that
      // makes the current ray hit the originally grabbed point.
      const planeHeight = this.#state.grabPoint.y;
      const ground = this.screenToGround(event.clientX, event.clientY, planeHeight);
      if (ground) {
        const delta = new THREE.Vector3().subVectors(this.#state.grabPoint, ground);
        this.targetFocus.copy(this.#state.grabFocus).add(delta);
        this.#clampFocus();
      }
    } else {
      const dx = event.clientX - this.#state.lastX;
      const dy = event.clientY - this.#state.lastY;
      this.targetHeading -= dx * 0.005;
      this.targetPitch = THREE.MathUtils.clamp(
        this.targetPitch - dy * 0.005,
        this.minPitch,
        this.maxPitch,
      );
    }

    this.#state.lastX = event.clientX;
    this.#state.lastY = event.clientY;
  }

  #onPointerUp(event) {
    if (this.#state.pointerId !== null && event.pointerId === this.#state.pointerId) {
      this.domElement.releasePointerCapture?.(event.pointerId);
    }
    this.#state.mode = null;
    this.#state.pointerId = null;
  }

  #onWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();

    // Normalise across the three deltaMode values browsers use, so a trackpad and a
    // wheel mouse both behave sanely.
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= 100;

    const factor = Math.exp(THREE.MathUtils.clamp(delta, -400, 400) * 0.0016);
    const newDistance = THREE.MathUtils.clamp(
      this.targetDistance * factor,
      this.minDistance,
      this.maxDistance,
    );

    // Zoom toward the cursor: move the focus a fraction of the way toward the ground
    // point under the pointer, proportional to how much closer we just got.
    const ground = this.screenToGround(event.clientX, event.clientY);
    if (ground && newDistance < this.targetDistance) {
      const pull = 1 - newDistance / this.targetDistance;
      this.targetFocus.lerp(new THREE.Vector3(ground.x, this.targetFocus.y, ground.z), pull * 0.85);
      this.#clampFocus();
    }

    this.targetDistance = newDistance;
  }

  #onKeyDown(event) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      return;
    }
    this.#keys.add(event.code);
  }

  #onKeyUp(event) {
    this.#keys.delete(event.code);
  }

  #onTouchStart(event) {
    if (!this.enabled) return;
    event.preventDefault();

    for (const touch of event.changedTouches) {
      this.#touches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }

    if (this.#touches.size === 1) {
      const [touch] = event.touches;
      this.#state.mode = 'pan';
      this.#state.lastX = touch.clientX;
      this.#state.lastY = touch.clientY;
      const ground = this.screenToGround(touch.clientX, touch.clientY);
      if (ground) {
        this.#state.grabPoint.copy(ground);
        this.#state.grabFocus.copy(this.targetFocus);
      }
    } else if (event.touches.length === 2) {
      this.#pinch = this.#pinchState(event.touches);
      this.#state.mode = 'pinch';
    }
  }

  #pinchState(touches) {
    const [a, b] = touches;
    return {
      distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      angle: Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX),
      centreY: (a.clientY + b.clientY) / 2,
      startDistance: this.targetDistance,
      startHeading: this.targetHeading,
      startPitch: this.targetPitch,
    };
  }

  #onTouchMove(event) {
    if (!this.enabled) return;
    event.preventDefault();

    if (this.#state.mode === 'pinch' && event.touches.length === 2 && this.#pinch) {
      const now = this.#pinchState(event.touches);
      const scale = this.#pinch.distance / Math.max(now.distance, 1);
      this.targetDistance = THREE.MathUtils.clamp(
        this.#pinch.startDistance * scale,
        this.minDistance,
        this.maxDistance,
      );
      // Twist rotates, vertical drag of the pinch centre tilts.
      this.targetHeading = this.#pinch.startHeading - (now.angle - this.#pinch.angle);
      this.targetPitch = THREE.MathUtils.clamp(
        this.#pinch.startPitch - (now.centreY - this.#pinch.centreY) * 0.004,
        this.minPitch,
        this.maxPitch,
      );
      return;
    }

    if (this.#state.mode === 'pan' && event.touches.length === 1) {
      const [touch] = event.touches;
      const ground = this.screenToGround(touch.clientX, touch.clientY, this.#state.grabPoint.y);
      if (ground) {
        const delta = new THREE.Vector3().subVectors(this.#state.grabPoint, ground);
        this.targetFocus.copy(this.#state.grabFocus).add(delta);
        this.#clampFocus();
      }
    }
  }

  #onTouchEnd(event) {
    for (const touch of event.changedTouches) this.#touches.delete(touch.identifier);
    if (this.#touches.size < 2) this.#pinch = null;
    if (this.#touches.size === 0) this.#state.mode = null;
  }

  #clampFocus() {
    // A generous margin beyond the domain so the edges can be inspected, but not so far
    // that the user can lose the terrain entirely and not know how to get back.
    const limit = this.worldRadius * 1.5;
    this.targetFocus.x = THREE.MathUtils.clamp(this.targetFocus.x, -limit, limit);
    this.targetFocus.z = THREE.MathUtils.clamp(this.targetFocus.z, -limit, limit);
  }

  /**
   * Fly the camera to a point on the ground.
   *
   * @param {number} x scene metres
   * @param {number} z scene metres
   * @param {number} [distance]
   */
  flyTo(x, z, distance) {
    this.targetFocus.set(x, this.sampleHeight(x, z), z);
    if (distance !== undefined) {
      this.targetDistance = THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance);
    }
    this.#clampFocus();
  }

  /**
   * Set the camera pose directly, used when handing control back from a movie camera so
   * the view does not jump.
   *
   * @param {object} pose
   * @param {THREE.Vector3} pose.focus
   * @param {number} pose.distance
   * @param {number} pose.heading radians
   * @param {number} pose.pitch radians
   */
  setPose({ focus, distance, heading, pitch }) {
    this.focus.copy(focus);
    this.targetFocus.copy(focus);
    this.distance = distance;
    this.targetDistance = distance;
    this.heading = heading;
    this.targetHeading = heading;
    this.pitch = pitch;
    this.targetPitch = pitch;
  }

  /** @returns {{focus: THREE.Vector3, distance: number, heading: number, pitch: number}} */
  getPose() {
    return {
      focus: this.focus.clone(),
      distance: this.distance,
      heading: this.heading,
      pitch: this.pitch,
    };
  }

  /**
   * Advance the damping and write the camera transform.
   *
   * @param {number} deltaSeconds
   */
  update(deltaSeconds) {
    // Keyboard navigation. Pan speed scales with distance so the same key feels right
    // whether you are 200 m up or 20 km up.
    if (this.enabled && this.#keys.size > 0) {
      const panSpeed = this.distance * 0.9 * Math.min(deltaSeconds, 0.05);
      const forward = new THREE.Vector3(Math.sin(this.heading), 0, -Math.cos(this.heading));
      const right = new THREE.Vector3(forward.z, 0, -forward.x);

      if (this.#keys.has('KeyW') || this.#keys.has('ArrowUp')) {
        this.targetFocus.addScaledVector(forward, panSpeed);
      }
      if (this.#keys.has('KeyS') || this.#keys.has('ArrowDown')) {
        this.targetFocus.addScaledVector(forward, -panSpeed);
      }
      if (this.#keys.has('KeyA') || this.#keys.has('ArrowLeft')) {
        this.targetFocus.addScaledVector(right, -panSpeed);
      }
      if (this.#keys.has('KeyD') || this.#keys.has('ArrowRight')) {
        this.targetFocus.addScaledVector(right, panSpeed);
      }
      if (this.#keys.has('KeyQ')) this.targetHeading += 1.2 * deltaSeconds;
      if (this.#keys.has('KeyE')) this.targetHeading -= 1.2 * deltaSeconds;
      if (this.#keys.has('KeyR')) {
        this.targetPitch = Math.min(this.maxPitch, this.targetPitch + 0.8 * deltaSeconds);
      }
      if (this.#keys.has('KeyF')) {
        this.targetPitch = Math.max(this.minPitch, this.targetPitch - 0.8 * deltaSeconds);
      }
      this.#clampFocus();
    }

    // Frame-rate independent damping. A fixed lerp factor would make the camera feel
    // different at 30 fps and at 120 fps.
    const blend = 1 - Math.pow(1 - this.damping, Math.max(deltaSeconds, 0.0001) * 60);

    this.targetFocus.y = this.sampleHeight(this.targetFocus.x, this.targetFocus.z);
    this.focus.lerp(this.targetFocus, blend);
    this.distance += (this.targetDistance - this.distance) * blend;
    this.heading += (this.targetHeading - this.heading) * blend;
    this.pitch += (this.targetPitch - this.pitch) * blend;

    this.#applyToCamera();
  }

  #applyToCamera() {
    const horizontal = Math.cos(this.pitch) * this.distance;
    const vertical = Math.sin(this.pitch) * this.distance;

    const offset = new THREE.Vector3(
      -Math.sin(this.heading) * horizontal,
      vertical,
      Math.cos(this.heading) * horizontal,
    );

    this.camera.position.copy(this.focus).add(offset);

    // Never let the camera drop below the terrain it is looking at. Flying through a
    // hillside is disorienting and looks broken.
    const groundHere = this.sampleHeight(this.camera.position.x, this.camera.position.z);
    const minHeight = groundHere + 12;
    if (this.camera.position.y < minHeight) this.camera.position.y = minHeight;

    this.camera.lookAt(this.focus);
    this.camera.updateMatrixWorld();
  }

  dispose() {
    for (const [target, type, handler] of this.#listeners) {
      target.removeEventListener(type, handler);
    }
    this.#listeners = [];
    this.#keys.clear();
  }
}

export default EarthControls;
