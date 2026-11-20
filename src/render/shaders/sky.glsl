// Analytic sky, evaluated for any direction.
//
// Decision D-008: the water shader calls this same function along the reflected view ray
// instead of sampling a cubemap. That gives a reflection with a mathematically correct
// horizon, costs one function call, needs no assets, and stays correct when the sun
// moves. A cubemap would need re-rendering on every sun change and would still be
// lowest-resolution exactly at the horizon, which is where water reflections are most
// visible.
//
// The gradient is a hand-tuned approximation of a clear daytime sky, not a physical
// atmospheric scattering model. It lives in the render layer and affects nothing that is
// reported as a number. See the Hydraulics Rule in AGENTS.md.

const vec3 SKY_ZENITH = vec3(0.129, 0.286, 0.588);
const vec3 SKY_HORIZON = vec3(0.706, 0.804, 0.902);
const vec3 SKY_GROUND = vec3(0.278, 0.306, 0.290);
const vec3 SUN_COLOR = vec3(1.0, 0.937, 0.792);

/**
 * Sky radiance in a direction.
 *
 * @param dir     normalised view direction, y up
 * @param sunDir  normalised direction toward the sun
 */
vec3 skyRadiance(vec3 dir, vec3 sunDir) {
  vec3 d = normalize(dir);
  float up = clamp(d.y, -1.0, 1.0);

  // Zenith to horizon gradient. The exponent controls how tightly the pale band hugs
  // the horizon; 2.2 reads as clear air rather than haze.
  float t = pow(1.0 - max(up, 0.0), 2.2);
  vec3 colour = mix(SKY_ZENITH, SKY_HORIZON, t);

  // Below the horizon the dome darkens toward a ground tone, so water reflecting
  // downward does not pick up bright sky.
  if (up < 0.0) {
    colour = mix(colour, SKY_GROUND, clamp(-up * 3.0, 0.0, 1.0));
  }

  float cosAngle = dot(d, sunDir);

  // Sun disc, then a wide halo. The disc exponent sets the apparent size; the halo is
  // what makes a specular highlight on water look like sunlight rather than a lamp.
  float disc = pow(max(cosAngle, 0.0), 2200.0);
  float halo = pow(max(cosAngle, 0.0), 8.0);

  colour += SUN_COLOR * (disc * 60.0 + halo * 0.22);

  return colour;
}

/** Ambient sky light arriving at an upward-facing surface. */
vec3 skyAmbient(vec3 sunDir) {
  return mix(SKY_HORIZON, SKY_ZENITH, 0.45) * 0.55 + SUN_COLOR * max(sunDir.y, 0.0) * 0.1;
}
