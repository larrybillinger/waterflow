/**
 * Movie recorder and replay.
 *
 * Records simulation state and camera pose at each frame into a compact timeline,
 * then replays that recording with a scrub slider. This is the feature ChatGPT
 * implemented as "Movie replay with scrub timeline" — record a run once, then
 * rewind and re-watch from any point.
 *
 * The recording stores:
 *   • simulationTime  — solver clock at the frame
 *   • eye (x,y,z)     — camera position
 *   • look (x,y,z)    — camera look-at target
 *
 * During playback the solver is paused and the scrubber drives time. The camera
 * interpolates between keyframes with Catmull-Rom smoothing.
 */

import * as THREE from 'three';

/** @typedef {{ t: number, eye: Float64Array, look: Float64Array }} Keyframe */

export default class MovieRecorder {
  constructor() {
    /** @type {Keyframe[]} */
    this.keyframes = [];

    /** Whether we are actively recording frames. */
    this.recording = false;

    /** Whether we are in replay/scrub mode. */
    this.replaying = false;

    /** Current playback time in seconds. */
    this.playbackTime = 0;

    /** Playback speed multiplier (1 = real-time). */
    this.playbackSpeed = 1;

    /** Whether playback is paused (scrubbing). */
    this.paused = false;

    /** Duration of the recording in simulation seconds. */
    this.duration = 0;

    /** Minimum interval between keyframes in seconds, to avoid bloat. */
    this.keyframeInterval = 0.1;

    this.#lastRecordTime = -Infinity;
  }

  #lastRecordTime;

  /** Start a new recording, clearing any previous one. */
  startRecording() {
    this.keyframes = [];
    this.recording = true;
    this.replaying = false;
    this.duration = 0;
    this.#lastRecordTime = -Infinity;
  }

  /** Stop recording. */
  stopRecording() {
    this.recording = false;
    if (this.keyframes.length > 0) {
      this.duration = this.keyframes[this.keyframes.length - 1].t;
    }
  }

  /**
   * Capture a keyframe from the current state.
   *
   * @param {number} simulationTime
   * @param {THREE.Vector3} eye  camera position
   * @param {THREE.Vector3} look camera look-at
   */
  capture(simulationTime, eye, look) {
    if (!this.recording) return;
    if (simulationTime - this.#lastRecordTime < this.keyframeInterval) return;

    this.keyframes.push({
      t: simulationTime,
      eye: new Float64Array([eye.x, eye.y, eye.z]),
      look: new Float64Array([look.x, look.y, look.z]),
    });
    this.#lastRecordTime = simulationTime;
  }

  /** @returns {boolean} Whether there is a recording available to replay. */
  get hasRecording() {
    return this.keyframes.length >= 2;
  }

  /** Enter replay mode. */
  startReplay() {
    if (!this.hasRecording) return;
    this.replaying = true;
    this.recording = false;
    this.playbackTime = 0;
    this.paused = false;
  }

  /** Exit replay mode. */
  stopReplay() {
    this.replaying = false;
    this.paused = false;
  }

  /**
   * Seek to a specific time (for scrub slider).
   *
   * @param {number} t  time in simulation seconds
   */
  seek(t) {
    this.playbackTime = Math.max(0, Math.min(this.duration, t));
  }

  /**
   * Advance playback by a wall-clock delta.
   *
   * @param {number} deltaSeconds
   * @returns {{ eye: THREE.Vector3, look: THREE.Vector3, simulationTime: number } | null}
   */
  advance(deltaSeconds) {
    if (!this.replaying || !this.hasRecording) return null;

    if (!this.paused) {
      this.playbackTime += deltaSeconds * this.playbackSpeed;
      if (this.playbackTime >= this.duration) {
        this.playbackTime = this.duration;
        this.paused = true;
      }
    }

    return this.sampleAt(this.playbackTime);
  }

  /**
   * Sample the recorded camera pose at a given time using Catmull-Rom interpolation.
   *
   * @param {number} t  simulation time
   * @returns {{ eye: THREE.Vector3, look: THREE.Vector3, simulationTime: number }}
   */
  sampleAt(t) {
    const kf = this.keyframes;
    const n = kf.length;

    // Clamp to recording bounds.
    if (t <= kf[0].t) {
      return {
        eye: new THREE.Vector3(kf[0].eye[0], kf[0].eye[1], kf[0].eye[2]),
        look: new THREE.Vector3(kf[0].look[0], kf[0].look[1], kf[0].look[2]),
        simulationTime: kf[0].t,
      };
    }
    if (t >= kf[n - 1].t) {
      const last = kf[n - 1];
      return {
        eye: new THREE.Vector3(last.eye[0], last.eye[1], last.eye[2]),
        look: new THREE.Vector3(last.look[0], last.look[1], last.look[2]),
        simulationTime: last.t,
      };
    }

    // Find the segment: kf[i].t <= t < kf[i+1].t.
    let i = 0;
    let lo = 0;
    let hi = n - 2;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (kf[mid].t <= t) {
        i = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const alpha = (t - kf[i].t) / (kf[i + 1].t - kf[i].t);

    // Catmull-Rom needs four control points: p0, p1, p2, p3.
    const i0 = Math.max(0, i - 1);
    const i1 = i;
    const i2 = i + 1;
    const i3 = Math.min(n - 1, i + 2);

    const eye = catmullRom3(kf[i0].eye, kf[i1].eye, kf[i2].eye, kf[i3].eye, alpha);
    const look = catmullRom3(kf[i0].look, kf[i1].look, kf[i2].look, kf[i3].look, alpha);

    return {
      eye: new THREE.Vector3(eye[0], eye[1], eye[2]),
      look: new THREE.Vector3(look[0], look[1], look[2]),
      simulationTime: kf[i1].t + alpha * (kf[i2].t - kf[i1].t),
    };
  }
}

/**
 * Catmull-Rom interpolation for a 3-component vector stored as a typed array.
 *
 * @param {Float64Array} p0
 * @param {Float64Array} p1
 * @param {Float64Array} p2
 * @param {Float64Array} p3
 * @param {number} t  0…1
 * @returns {[number, number, number]}
 */
function catmullRom3(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;

  const result = /** @type {[number, number, number]} */ ([0, 0, 0]);
  for (let c = 0; c < 3; c++) {
    result[c] =
      0.5 *
      (2 * p1[c] +
        (-p0[c] + p2[c]) * t +
        (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 +
        (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
  }
  return result;
}
