// Terrain surface shading.
//
// Normals are reconstructed here from the elevation texture rather than interpolated
// from vertex normals. At one vertex per simulation cell, per-vertex normals visibly
// facet the hillsides; a central difference in the fragment shader costs four texture
// reads and gives smooth relief that still shows real terrain detail.
//
// Colour is built in layers:
//   1. Base: draped imagery, or a hypsometric ramp plus rock-on-slope when there is none
//   2. Relief: a hillshade from the reconstructed normal against the sun
//   3. Ambient: sky light, which keeps shadowed slopes blue rather than black
//   4. Wet ground: darkening where the flood has been, which is what a real receding
//      flood leaves behind and a strong visual cue for extent
//   5. Result overlay: an optional colour ramp for depth, arrival time or velocity
//   6. Distance fog, matched to the sky so the horizon dissolves instead of ending

precision highp float;

uniform sampler2D uBed;
uniform sampler2D uImagery;
uniform sampler2D uState;      // r depth, g max depth, b arrival, a max speed
uniform float uHasImagery;

uniform vec2 uTexel;
uniform float uCellSize;
uniform float uVerticalExaggeration;

uniform vec3 uSunDirection;
uniform float uFogDensity;
uniform vec3 uCameraPos;

uniform float uMinElevation;
uniform float uMaxElevation;

/** 0 none, 1 max depth, 2 arrival time, 3 peak velocity. */
uniform float uOverlayMode;
uniform float uOverlayOpacity;
uniform float uOverlayMaxDepth;
uniform float uOverlayMaxTime;
uniform float uOverlayMaxSpeed;

/** Brush cursor, drawn into the surface so it follows the terrain exactly. */
uniform float uBrushActive;
uniform vec2 uBrushCentre;     // in uv space
uniform float uBrushRadius;    // in uv space
uniform vec3 uBrushColour;

/** Dam axis highlight while the user is placing it, in uv space. */
uniform float uGuideActive;
uniform vec2 uGuideStart;
uniform vec2 uGuideEnd;

in vec2 vUv;
in vec3 vWorldPosition;
in float vElevation;

layout(location = 0) out vec4 outColor;

#include "sky.glsl"
#include "noise.glsl"

/**
 * Bilinear sample of the solver state, for appearance only.
 *
 * Same reasoning as the water shader: the state texture must use nearest filtering so
 * the physics and the readbacks see cell values, but the wet-ground tint and the result
 * overlays would then be drawn as hard cell squares. Interpolating here affects nothing
 * that is reported as a number.
 *
 * Arrival time is interpolated along with the rest, which is harmless for a colour ramp
 * but would not be for a reported figure; the station tables sample it nearest-neighbour
 * on the CPU for exactly that reason.
 */
vec4 sampleStateSmooth(vec2 uv) {
  vec2 coord = uv / uTexel - 0.5;
  vec2 base = floor(coord);
  vec2 f = coord - base;

  vec2 uv00 = (base + 0.5) * uTexel;
  vec4 s00 = texture(uState, uv00);
  vec4 s10 = texture(uState, uv00 + vec2(uTexel.x, 0.0));
  vec4 s01 = texture(uState, uv00 + vec2(0.0, uTexel.y));
  vec4 s11 = texture(uState, uv00 + uTexel);

  return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}

/** Surface normal from a central difference on the elevation texture. */
vec3 terrainNormal(vec2 uv) {
  float left = texture(uBed, uv - vec2(uTexel.x, 0.0)).r;
  float right = texture(uBed, uv + vec2(uTexel.x, 0.0)).r;
  float north = texture(uBed, uv - vec2(0.0, uTexel.y)).r;
  float south = texture(uBed, uv + vec2(0.0, uTexel.y)).r;

  float dzdx = ((right - left) * uVerticalExaggeration) / (2.0 * uCellSize);
  float dzdz = ((south - north) * uVerticalExaggeration) / (2.0 * uCellSize);

  return normalize(vec3(-dzdx, 1.0, -dzdz));
}

/** Hypsometric ramp used when there is no imagery: lowland green to alpine grey. */
vec3 hypsometric(float t) {
  vec3 low = vec3(0.278, 0.361, 0.231);
  vec3 mid = vec3(0.459, 0.447, 0.278);
  vec3 high = vec3(0.561, 0.494, 0.400);
  vec3 peak = vec3(0.729, 0.722, 0.698);

  if (t < 0.33) return mix(low, mid, t / 0.33);
  if (t < 0.66) return mix(mid, high, (t - 0.33) / 0.33);
  return mix(high, peak, (t - 0.66) / 0.34);
}

/** Depth ramp: shallow yellow through to deep violet. Reads clearly at every value. */
vec3 depthRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(1.000, 0.937, 0.608);
  vec3 c1 = vec3(0.400, 0.800, 0.733);
  vec3 c2 = vec3(0.145, 0.459, 0.722);
  vec3 c3 = vec3(0.243, 0.165, 0.478);

  if (t < 0.33) return mix(c0, c1, t / 0.33);
  if (t < 0.66) return mix(c1, c2, (t - 0.33) / 0.33);
  return mix(c2, c3, (t - 0.66) / 0.34);
}

/** Time ramp: red for the first water to arrive, blue for the last. */
vec3 timeRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.839, 0.188, 0.192);
  vec3 c1 = vec3(0.992, 0.682, 0.380);
  vec3 c2 = vec3(0.671, 0.851, 0.914);
  vec3 c3 = vec3(0.192, 0.361, 0.651);

  if (t < 0.33) return mix(c0, c1, t / 0.33);
  if (t < 0.66) return mix(c1, c2, (t - 0.33) / 0.33);
  return mix(c2, c3, (t - 0.66) / 0.34);
}

/** Distance from a point to a line segment, all in uv space. */
float distanceToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float lenSq = dot(ab, ab);
  if (lenSq < 1e-12) return distance(p, a);
  float t = clamp(dot(p - a, ab) / lenSq, 0.0, 1.0);
  return distance(p, a + ab * t);
}

void main() {
  vec3 normal = terrainNormal(vUv);
  vec4 state = sampleStateSmooth(vUv);

  float elevationRange = max(uMaxElevation - uMinElevation, 1.0);
  float elevationT = clamp((vElevation - uMinElevation) / elevationRange, 0.0, 1.0);
  float slope = 1.0 - normal.y;

  // --- 1. Base colour -------------------------------------------------------------
  vec3 base;
  if (uHasImagery > 0.5) {
    base = texture(uImagery, vUv).rgb;
    // A touch of noise breaks up the flat look of imagery stretched over a coarse grid
    // when the camera is close in.
    base *= 0.96 + 0.08 * fbm(vUv * 900.0);
  } else {
    base = hypsometric(elevationT);
    // Rock shows through on steep faces, which is what makes a hypsometric map read as
    // terrain rather than as a coloured sheet.
    float rock = smoothstep(0.08, 0.45, slope);
    vec3 rockColour = vec3(0.459, 0.431, 0.396) * (0.85 + 0.3 * fbm(vUv * 420.0));
    base = mix(base, rockColour, rock * 0.75);
  }

  // --- 2 and 3. Light -------------------------------------------------------------
  float sunLambert = max(dot(normal, uSunDirection), 0.0);

  // Cheap self-shadowing proxy: compare this cell to the mean of a wider neighbourhood
  // along the sun azimuth. Hollows darken, ridges catch the light. Not a shadow map, but
  // on terrain it reads convincingly and costs two texture reads.
  vec2 sunStep = normalize(uSunDirection.xz + vec2(1e-5)) * uTexel * 3.0;
  float upslope = texture(uBed, vUv + sunStep).r;
  float relief = clamp((vElevation - upslope) / max(uCellSize * 0.75, 1.0), -1.0, 1.0);
  float occlusion = 0.82 + 0.18 * relief;

  vec3 sunLight = SUN_COLOR * 1.45 * sunLambert * occlusion;
  vec3 ambient = skyAmbient(uSunDirection) * (0.45 + 0.35 * normal.y);

  vec3 colour = base * (sunLight + ambient);

  // --- 4. Wet ground --------------------------------------------------------------
  // Ground the flood has touched but is no longer under water. Darker and slightly
  // desaturated, the way wet soil actually looks.
  float everWet = smoothstep(0.02, 0.25, state.g);
  float currentlyWet = smoothstep(0.0, 0.05, state.r);
  float dampOnly = everWet * (1.0 - currentlyWet);
  vec3 damp = mix(colour, colour * vec3(0.52, 0.50, 0.46), 0.75);
  colour = mix(colour, damp, dampOnly);

  // --- 5. Result overlay ----------------------------------------------------------
  if (uOverlayMode > 0.5) {
    float value = 0.0;
    vec3 overlayColour = vec3(0.0);
    bool show = false;

    if (uOverlayMode < 1.5) {
      value = state.g / max(uOverlayMaxDepth, 0.01);
      overlayColour = depthRamp(value);
      show = state.g > 0.05;
    } else if (uOverlayMode < 2.5) {
      // Arrival uses -1 for "never arrived", so only non-negative values are real.
      show = state.b >= 0.0;
      value = state.b / max(uOverlayMaxTime, 1.0);
      overlayColour = timeRamp(value);
    } else if (uOverlayMode < 3.5) {
      value = state.a / max(uOverlayMaxSpeed, 0.1);
      overlayColour = depthRamp(value);
      show = state.g > 0.05;
    } else {
      // Live depth: current water depth (state.r) rather than peak (state.g).
      value = state.r / max(uOverlayMaxDepth, 0.01);
      overlayColour = depthRamp(value);
      show = state.r > 0.05;
    }

    if (show) {
      // Modulated by the light so the overlay still shows the terrain's shape.
      float shade = 0.65 + 0.35 * (sunLambert * occlusion + ambient.g * 0.4);
      colour = mix(colour, overlayColour * shade, uOverlayOpacity);
    }
  }

  // --- Editing guides -------------------------------------------------------------
  if (uGuideActive > 0.5) {
    float d = distanceToSegment(vUv, uGuideStart, uGuideEnd);
    float line = 1.0 - smoothstep(uTexel.x * 1.2, uTexel.x * 3.0, d);
    colour = mix(colour, vec3(1.0, 0.85, 0.25), line * 0.85);
  }

  if (uBrushActive > 0.5) {
    float d = distance(vUv, uBrushCentre);
    float ring = 1.0 - smoothstep(uBrushRadius * 0.93, uBrushRadius, d);
    float inner = 1.0 - smoothstep(uBrushRadius * 0.86, uBrushRadius * 0.93, d);
    float outline = clamp(ring - inner, 0.0, 1.0);
    float fill = (1.0 - smoothstep(0.0, uBrushRadius, d)) * 0.16;
    colour = mix(colour, uBrushColour, clamp(outline + fill, 0.0, 1.0) * 0.8);
  }

  // --- 6. Fog ---------------------------------------------------------------------
  float viewDistance = length(vWorldPosition - uCameraPos);
  vec3 viewDirection = normalize(vWorldPosition - uCameraPos);
  float fog = 1.0 - exp(-uFogDensity * viewDistance);
  vec3 fogColour = skyRadiance(vec3(viewDirection.x, max(viewDirection.y, -0.05), viewDirection.z), uSunDirection);
  colour = mix(colour, fogColour, clamp(fog, 0.0, 0.92));

  outColor = vec4(colour, 1.0);
}
