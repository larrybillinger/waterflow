// Water surface shading.
//
// The aim stated in the brief is water that is beautiful and reads as real. What makes
// water look like water is not blue paint, it is four things happening together:
//
//   Absorption   Light that enters the body is attenuated with distance travelled, more
//                strongly at the red end. That is Beer-Lambert, and it is why shallow
//                water shows the bed and deep water goes blue-green. Flood water also
//                carries sediment, so the body tint shifts brown as the flow speeds up.
//
//   Fresnel      The proportion reflected rises sharply toward grazing angles. Water
//                seen from above is mostly transmissive; seen across a valley it is
//                nearly a mirror. Schlick's approximation with F0 = 0.02 for water.
//
//   Surface      Ripples. Their direction and amplitude follow the actual flow velocity
//                taken from the solver's flux texture, so fast water looks fast and a
//                still reservoir looks still. This is the detail that sells motion.
//
//   Breaking     Foam where flow is shallow and fast, which in practice means a high
//                Froude number, plus the shoreline edge and the breach itself.
//
// Everything here is visual. The constants are in src/config.js under `visual` and none
// of them touches a reported number. See the Hydraulics Rule in AGENTS.md.

precision highp float;

uniform sampler2D uBed;
uniform sampler2D uState;   // r depth, g max depth, b arrival, a max speed
uniform sampler2D uFlux;    // r east face unit discharge, g south face
uniform sampler2D uImagery;
uniform float uHasImagery;

uniform vec2 uTexel;
uniform float uCellSize;
uniform float uTime;
uniform float uVerticalExaggeration;

uniform vec3 uSunDirection;
uniform vec3 uCameraPos;
uniform float uFogDensity;

uniform float uMinDrawDepth;
uniform float uShorelineFade;
uniform vec3 uExtinction;
uniform vec3 uWaterTint;
uniform vec3 uSedimentTint;
uniform float uSedimentFullSpeed;
uniform float uFoamFroude;
uniform float uRippleAmplitude;
uniform float uRippleWavelength;
uniform float uGravity;

in vec2 vUv;
in vec3 vWorldPosition;
in float vDepth;
in float vBedElevation;

layout(location = 0) out vec4 outColor;

#include "sky.glsl"
#include "noise.glsl"

/**
 * Bilinear depth sample, for appearance only.
 *
 * The solver state has to use nearest filtering: interpolating between a wet cell and a
 * dry one would invent water the mass balance never accounted for, and the readbacks
 * that build the results tables would read interpolated values rather than cell values.
 *
 * But nearest filtering also means the shoreline snaps to cell boundaries, and at a cell
 * size of tens of metres seen from close up that is a hard staircase across the whole
 * flood edge. Interpolating here, in the fragment shader, after the physics has been
 * computed and recorded, costs four taps and removes it. Nothing read from this function
 * reaches a reported number.
 */
float sampleDepthSmooth(vec2 uv) {
  vec2 coord = uv / uTexel - 0.5;
  vec2 base = floor(coord);
  vec2 f = coord - base;

  vec2 uv00 = (base + 0.5) * uTexel;
  float d00 = texture(uState, uv00).r;
  float d10 = texture(uState, uv00 + vec2(uTexel.x, 0.0)).r;
  float d01 = texture(uState, uv00 + vec2(0.0, uTexel.y)).r;
  float d11 = texture(uState, uv00 + uTexel).r;

  return mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);
}

/** Bilinear bed sample. Same display-only reasoning as sampleDepthSmooth. */
float sampleBedSmooth(vec2 uv) {
  vec2 coord = uv / uTexel - 0.5;
  vec2 base = floor(coord);
  vec2 f = coord - base;

  vec2 uv00 = (base + 0.5) * uTexel;
  float z00 = texture(uBed, uv00).r;
  float z10 = texture(uBed, uv00 + vec2(uTexel.x, 0.0)).r;
  float z01 = texture(uBed, uv00 + vec2(0.0, uTexel.y)).r;
  float z11 = texture(uBed, uv00 + uTexel).r;

  return mix(mix(z00, z10, f.x), mix(z01, z11, f.x), f.y);
}

/** Bilinear flux sample, both face components at once. */
vec2 sampleFluxSmooth(vec2 uv) {
  vec2 coord = uv / uTexel - 0.5;
  vec2 base = floor(coord);
  vec2 f = coord - base;

  vec2 uv00 = (base + 0.5) * uTexel;
  vec2 q00 = texture(uFlux, uv00).rg;
  vec2 q10 = texture(uFlux, uv00 + vec2(uTexel.x, 0.0)).rg;
  vec2 q01 = texture(uFlux, uv00 + vec2(0.0, uTexel.y)).rg;
  vec2 q11 = texture(uFlux, uv00 + uTexel).rg;

  return mix(mix(q00, q10, f.x), mix(q01, q11, f.x), f.y);
}

/** Water surface elevation, smoothly interpolated, for the macro normal. */
float sampleSurfaceSmooth(vec2 uv) {
  return sampleBedSmooth(uv) + sampleDepthSmooth(uv);
}

/**
 * Cell-centred flow velocity in m/s, from the solver's face fluxes.
 *
 * Interpolated, because a nearest-sampled velocity makes the Froude number piecewise
 * constant over each cell, and the foam that follows it then appears as a lattice of
 * hard cell-shaped patches rather than as foam.
 */
vec2 flowVelocity(vec2 uv, float depth) {
  if (depth <= 0.001) return vec2(0.0);

  vec2 here = sampleFluxSmooth(uv);
  float qWest = sampleFluxSmooth(uv - vec2(uTexel.x, 0.0)).r;
  float qNorth = sampleFluxSmooth(uv - vec2(0.0, uTexel.y)).g;

  // x is east, z is south, matching the scene axes.
  return vec2(0.5 * (qWest + here.r), 0.5 * (qNorth + here.g)) / depth;
}

/**
 * Ripple normal from a sum of directional waves plus fine detail.
 *
 * Analytic derivatives rather than a normal map: no texture to load, correct at any
 * zoom, and the wave directions can follow the flow field per fragment.
 *
 * Each component is faded out once its wavelength drops below the size of a pixel.
 * Without that, the waves alias badly at distance and at grazing angles: frequencies
 * past the sampling limit fold back into a large regular diamond lattice that looks
 * like woven fabric rather than water. This is the same reasoning as mipmapping a
 * texture, applied to a procedural one, and it is why the surface goes smooth and
 * glassy far away instead of sparkling with detail it cannot resolve.
 *
 * @param p      world position in metres, xz
 * @param flow   flow velocity, m/s
 * @param scale  overall amplitude multiplier
 */
vec3 rippleNormal(vec2 p, vec2 flow, float scale) {
  float speed = length(flow);
  vec2 along = speed > 0.02 ? flow / speed : vec2(1.0, 0.0);
  vec2 across = vec2(-along.y, along.x);

  // World metres covered by one pixel here. fwidth is the screen-space derivative, so
  // this grows with distance and with grazing view angles, which is exactly when the
  // detail has to go.
  float footprint = max(fwidth(p.x), fwidth(p.y));

  // Waves travel with the flow, so advection speed rises with the current.
  float drift = 0.6 + speed * 1.4;

  float k = 6.28318 / max(uRippleWavelength, 0.5);
  float dHdx = 0.0;
  float dHdz = 0.0;

  // Four components: two aligned with the flow at different scales, two oblique. The
  // mix keeps the surface from looking like a corduroy pattern.
  vec2 dirs[4];
  dirs[0] = along;
  dirs[1] = normalize(along * 1.6 + across * 0.7);
  dirs[2] = normalize(along * 0.9 - across * 1.1);
  dirs[3] = across;

  float wavelengthScale[4];
  wavelengthScale[0] = 1.0;
  wavelengthScale[1] = 0.47;
  wavelengthScale[2] = 2.15;
  wavelengthScale[3] = 0.72;

  float amplitudeScale[4];
  amplitudeScale[0] = 1.0;
  amplitudeScale[1] = 0.55;
  amplitudeScale[2] = 0.8;
  amplitudeScale[3] = 0.35;

  for (int i = 0; i < 4; i++) {
    float lambda = uRippleWavelength * wavelengthScale[i];
    float detail = 1.0 - smoothstep(lambda * 0.15, lambda * 0.6, footprint);
    if (detail <= 0.0) continue;

    float ki = k / wavelengthScale[i];
    float amplitude = uRippleAmplitude * amplitudeScale[i] * scale * detail;
    float phase = dot(p, dirs[i]) * ki - uTime * drift * ki * 0.55;
    float c = cos(phase) * amplitude * ki;
    dHdx += c * dirs[i].x;
    dHdz += c * dirs[i].y;
  }

  // Fine chop, which is what catches the sun and makes the surface sparkle. Its features
  // are about a metre across, so it is the first thing to disappear with distance.
  float chopDetail = 1.0 - smoothstep(0.18, 0.7, footprint);
  if (chopDetail > 0.0) {
    float n1 = valueNoise(p * 0.85 + vec2(uTime * 0.35, -uTime * 0.21));
    float n2 = valueNoise(p * 0.85 + vec2(0.17, 0.11) + vec2(uTime * 0.35, -uTime * 0.21));
    float chop = (n2 - n1) * 0.9 * scale * (0.4 + speed * 0.5) * chopDetail;
    dHdx += chop;
    dHdz += chop * 0.7;
  }

  return normalize(vec3(-dHdx, 1.0, -dHdz));
}

void main() {
  // Re-sample depth rather than trusting the value interpolated across the triangle,
  // which would leave a fringe of water hanging over dry ground. Smoothed, so the
  // shoreline follows a continuous contour instead of the cell grid.
  float depth = sampleDepthSmooth(vUv);
  if (depth < uMinDrawDepth) discard;

  vec2 flow = flowVelocity(vUv, depth);
  float speed = length(flow);

  // --- Surface normal -------------------------------------------------------------
  // Ripple amplitude is scaled down in very shallow water: a 5 cm sheet cannot carry a
  // 5 cm wave, and letting it try makes the flood edge boil unnaturally.
  float shallowScale = smoothstep(0.0, 0.6, depth);

  // Large-scale slope of the water surface itself, so a steep flood wave front reads as
  // a slope and not as a flat plate.
  // Central differences of the smoothly interpolated water surface. Taking these from
  // nearest-sampled textures makes the normal piecewise constant over each cell, and at
  // a specular exponent of several hundred that turns into a bright lattice of
  // cell-shaped highlights across the whole surface. The interpolation is what makes the
  // water read as a continuous sheet rather than as a grid.
  float surfaceWest = sampleSurfaceSmooth(vUv - vec2(uTexel.x, 0.0));
  float surfaceEast = sampleSurfaceSmooth(vUv + vec2(uTexel.x, 0.0));
  float surfaceNorth = sampleSurfaceSmooth(vUv - vec2(0.0, uTexel.y));
  float surfaceSouth = sampleSurfaceSmooth(vUv + vec2(0.0, uTexel.y));

  vec3 macroNormal = normalize(vec3(
    -(surfaceEast - surfaceWest) / (2.0 * uCellSize),
    1.0,
    -(surfaceSouth - surfaceNorth) / (2.0 * uCellSize)
  ));

  vec3 ripple = rippleNormal(vWorldPosition.xz, flow, shallowScale);

  // Blend the fine ripple into the macro slope. Normalising the sum is enough here and
  // avoids a full tangent frame for a surface that is nearly horizontal.
  vec3 normal = normalize(macroNormal * 1.0 + vec3(ripple.x, 0.0, ripple.z) * 1.6);

  vec3 viewVector = uCameraPos - vWorldPosition;
  float viewDistance = length(viewVector);
  vec3 viewDirection = viewVector / viewDistance;

  // --- Transmitted colour: Beer-Lambert through the water body --------------------
  vec3 bedColour = uHasImagery > 0.5 ? texture(uImagery, vUv).rgb : vec3(0.35, 0.33, 0.28);

  // Path length is longer than the depth at a slant. cos of the refracted angle is
  // approximated by the view angle, which is close enough and cheap.
  float cosView = max(dot(normal, viewDirection), 0.08);
  float pathLength = depth / cosView;

  vec3 transmittance = exp(-uExtinction * pathLength);

  // Sediment load rises with speed, so the body tint shifts from clear green-blue toward
  // muddy brown. Real flood water is brown, and leaving it blue is the single thing that
  // most makes a flood simulation look fake.
  float sediment = clamp(speed / max(uSedimentFullSpeed, 0.1), 0.0, 1.0);
  sediment = mix(sediment, 1.0, clamp(depth / 30.0, 0.0, 0.35));
  vec3 bodyColour = mix(uWaterTint, uSedimentTint, sediment);

  vec3 refracted = bedColour * transmittance + bodyColour * (1.0 - transmittance);

  // --- Reflected colour: the sky, evaluated analytically ---------------------------
  vec3 reflectDirection = reflect(-viewDirection, normal);
  vec3 reflected = skyRadiance(reflectDirection, uSunDirection);

  // --- Fresnel --------------------------------------------------------------------
  float fresnel = 0.02 + 0.98 * pow(1.0 - cosView, 5.0);

  vec3 colour = mix(refracted, reflected, fresnel);

  // --- Specular sun glint ---------------------------------------------------------
  vec3 halfVector = normalize(uSunDirection + viewDirection);
  float specular = pow(max(dot(normal, halfVector), 0.0), 420.0);
  colour += SUN_COLOR * specular * 2.6;

  // --- Foam -----------------------------------------------------------------------
  // Froude number is the physical indicator of broken, aerated flow.
  float froude = speed / sqrt(max(uGravity * depth, 0.001));
  float froudeFoam = smoothstep(uFoamFroude, uFoamFroude + 0.5, froude);

  // The advancing edge of the flood, where a real wave front piles up and breaks.
  float edgeFoam = (1.0 - smoothstep(0.05, 0.9, depth)) * smoothstep(0.25, 1.2, speed);

  // Foam texture is about eight metres across, so it fades to its mean value once a
  // pixel covers more ground than that. Left in, it aliases into the same woven lattice
  // the ripples do.
  float foamFootprint = max(fwidth(vWorldPosition.x), fwidth(vWorldPosition.z));
  float foamDetail = 1.0 - smoothstep(1.5, 6.0, foamFootprint);
  float foamNoise = mix(0.5, fbm(vWorldPosition.xz * 0.12 - flow * uTime * 0.09), foamDetail);

  float foam = clamp((froudeFoam + edgeFoam) * (0.45 + 0.75 * foamNoise), 0.0, 1.0);

  colour = mix(colour, vec3(0.94, 0.95, 0.95), foam * 0.82);

  // --- Opacity --------------------------------------------------------------------
  // Fades out over the first few centimetres so the shoreline is soft, and never quite
  // reaches opaque at a glancing angle, which is where Fresnel does the work instead.
  float alpha = smoothstep(uMinDrawDepth, uShorelineFade, depth);
  alpha = clamp(alpha * 0.82 + fresnel * 0.4 + foam * 0.5, 0.0, 1.0);

  // --- Fog ------------------------------------------------------------------------
  float fog = 1.0 - exp(-uFogDensity * viewDistance);
  vec3 fogColour = skyRadiance(
    vec3(-viewDirection.x, max(-viewDirection.y, -0.05), -viewDirection.z),
    uSunDirection
  );
  colour = mix(colour, fogColour, clamp(fog, 0.0, 0.92));

  outColor = vec4(colour, alpha);
}
