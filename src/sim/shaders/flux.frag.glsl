// Momentum pass: the local inertial approximation of the shallow water equations.
//
// Bates, P. D., Horritt, M. S., & Fewtrell, T. J. (2010). "A simple inertial formulation
// of the shallow water equations for efficient two-dimensional flood inundation
// modelling." Journal of Hydrology, 387(1-2), 33-45.
//
// Each invocation computes the unit discharge across this cell's EAST face (red) and its
// SOUTH face (green). Faces that do not exist, at the far domain edges, are written as
// zero and the depth pass applies the boundary condition there instead.
//
// Full derivation and the units of every term are in docs/hydraulics.md section 1.

precision highp float;

uniform sampler2D uState;    // r = depth, g = max depth, b = arrival, a = max speed
uniform sampler2D uFlux;     // r = east face unit discharge, g = south face
uniform sampler2D uBed;      // r = ground elevation after edits, g = original ground
uniform sampler2D uControl;  // 1x1: r = dt, g = domain max depth, b = simulation time

uniform vec2 uTexel;       // 1 / grid size
uniform float uGrid;       // grid cells per edge
uniform float uCellSize;   // dx, metres
uniform float uManningN;   // s/m^(1/3)
uniform float uGravity;    // m/s^2
uniform float uFroudeMax;  // dimensionless cap, see docs/hydraulics.md 1.4
uniform float uDryDepth;   // metres below which a face carries no flow

uniform float uBreachActive;
uniform vec2 uBreachAxisOrigin;
uniform vec2 uBreachDir;
uniform float uBreachAxisLength;
uniform float uBreachCentreAlong;
uniform float uBreachHalfThickness;
uniform float uBreachBottomHalfWidth;
uniform float uBreachTopHalfWidth;
uniform float uBreachInvert;
uniform float uBreachCrest;

in vec2 vUv;
layout(location = 0) out vec4 outFlux;

#include "bed.glsl"

/** Cell coordinates for a uv, matching src/util/grid.js: col 0 west, row 0 north. */
vec2 cellOf(vec2 uv) {
  return uv * uGrid - 0.5;
}

/** Bed elevation at a uv, with the breach applied. */
float bedAt(vec2 uv) {
  return effectiveBed(texture(uBed, uv).r, cellOf(uv));
}

/**
 * Unit discharge across one face.
 *
 * hA, zA are the depth and bed of the cell on the negative side of the face, hB and zB
 * the cell on the positive side. Positive q flows from A to B.
 */
float faceFlux(float qOld, float hA, float zA, float hB, float zB, float dt) {
  float wseA = zA + hA;
  float wseB = zB + hB;

  // Depth available for flow across the face. Using the difference of water surface
  // elevations over the HIGHER of the two beds is what makes wetting and drying work:
  // a wet cell beside a dry one that sits higher gets no flow until the water rises
  // above that higher bed.
  float hflow = max(wseA, wseB) - max(zA, zB);
  if (hflow <= uDryDepth) return 0.0;

  float slope = (wseB - wseA) / uCellSize;

  // The scheme itself. Friction is semi-implicit, which is what keeps an explicit
  // integration stable at small depths.
  float numerator = qOld - uGravity * dt * hflow * slope;
  float denominator =
    1.0 + uGravity * dt * uManningN * uManningN * abs(qOld) / pow(hflow, 7.0 / 3.0);
  float q = numerator / denominator;

  // Froude cap. Stabilises the supercritical jet below the breach, where the local
  // inertial approximation is least valid. See risk R-002.
  float froude = (abs(q) / hflow) / sqrt(uGravity * hflow);
  if (froude > uFroudeMax) {
    q = sign(q) * uFroudeMax * hflow * sqrt(uGravity * hflow);
  }

  // Positivity. A face must not remove more water than the donor cell holds. The factor
  // of four shares the cell's water between its four faces, so four simultaneously
  // draining faces still cannot drive the depth negative.
  float limit = (dt > 0.0) ? uCellSize / (dt * 4.0) : 0.0;
  if (q > 0.0) {
    q = min(q, hA * limit);
  } else {
    q = max(q, -hB * limit);
  }

  return q;
}

void main() {
  vec4 control = texture(uControl, vec2(0.5));
  float dt = control.r;

  vec2 cell = cellOf(vUv);
  float col = cell.x;
  float row = cell.y;

  float hHere = texture(uState, vUv).r;
  float zHere = bedAt(vUv);
  vec4 fluxHere = texture(uFlux, vUv);

  // East face: between this cell and the one at col + 1.
  float qEast = 0.0;
  if (col < uGrid - 1.5) {
    vec2 uvEast = vUv + vec2(uTexel.x, 0.0);
    qEast = faceFlux(
      fluxHere.r,
      hHere, zHere,
      texture(uState, uvEast).r, bedAt(uvEast),
      dt
    );
  }

  // South face: between this cell and the one at row + 1. South is +row, which is +v.
  float qSouth = 0.0;
  if (row < uGrid - 1.5) {
    vec2 uvSouth = vUv + vec2(0.0, uTexel.y);
    qSouth = faceFlux(
      fluxHere.g,
      hHere, zHere,
      texture(uState, uvSouth).r, bedAt(uvSouth),
      dt
    );
  }

  outFlux = vec4(qEast, qSouth, 0.0, 0.0);
}
