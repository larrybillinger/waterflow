// Continuity pass, plus the running statistics the results tables are built from.
//
//   h_new = h + (dt / dx) * (qWest - qEast + qNorth - qSouth)
//
// Fluxes are per unit width and cells are square, so one division by dx turns a flux
// divergence into a depth rate. See docs/hydraulics.md section 1.2.
//
// Sign convention, fixed in src/util/grid.js and relied on here:
//   east  = +col = +u,  positive q flows east
//   south = +row = +v,  positive q flows south
// So a positive flux on the WEST face is water entering, and a positive flux on the
// EAST face is water leaving.

precision highp float;

uniform sampler2D uState;
uniform sampler2D uFlux;
uniform sampler2D uBed;
uniform sampler2D uControl;

uniform vec2 uTexel;
uniform float uGrid;
uniform float uCellSize;
uniform float uGravity;
uniform float uDryDepth;

/** 1 lets water leave the domain edge, 0 makes the edges solid walls. */
uniform float uBoundaryOpen;

/** Which substep within this frame, 0-based, so simulation time is exact. */
uniform float uSubstep;

/** Depth above which a cell counts as flooded for the arrival time record. */
uniform float uArrivalDepth;

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
layout(location = 0) out vec4 outState;

#include "bed.glsl"

vec2 cellOf(vec2 uv) {
  return uv * uGrid - 0.5;
}

/**
 * Outflow across a domain edge.
 *
 * Critical flow, Froude = 1, which is the standard non-reflecting outflow condition for
 * a shallow water model: water leaves at the rate the depth allows and no wave is
 * bounced back into the domain to contaminate the result.
 *
 * `outwardSign` is +1 at the east and south edges, -1 at the west and north edges.
 */
float edgeOutflow(float h, float outwardSign) {
  if (uBoundaryOpen < 0.5) return 0.0;
  if (h <= uDryDepth) return 0.0;
  return outwardSign * h * sqrt(uGravity * h);
}

void main() {
  vec4 control = texture(uControl, vec2(0.5));
  float dt = control.r;
  float frameStartTime = control.b;

  // Exact simulation time at the end of this substep.
  float now = frameStartTime + (uSubstep + 1.0) * dt;

  vec4 state = texture(uState, vUv);
  float h = state.r;
  float maxDepth = state.g;
  float arrival = state.b;
  float maxSpeed = state.a;

  vec2 cell = cellOf(vUv);
  float col = cell.x;
  float row = cell.y;

  // This cell owns its east and south faces. Its west and north faces belong to the
  // neighbours on those sides.
  vec4 fluxHere = texture(uFlux, vUv);

  float qEast = (col > uGrid - 1.5)
    ? edgeOutflow(h, 1.0)
    : fluxHere.r;

  float qSouth = (row > uGrid - 1.5)
    ? edgeOutflow(h, 1.0)
    : fluxHere.g;

  float qWest = (col < 0.5)
    ? edgeOutflow(h, -1.0)
    : texture(uFlux, vUv - vec2(uTexel.x, 0.0)).r;

  float qNorth = (row < 0.5)
    ? edgeOutflow(h, -1.0)
    : texture(uFlux, vUv - vec2(0.0, uTexel.y)).g;

  float dh = (dt / uCellSize) * (qWest - qEast + qNorth - qSouth);
  float hNew = max(0.0, h + dh);

  // Cell-centred velocity from the mean of opposing faces. Done after the depth update
  // so the speed reported belongs with the depth reported.
  float speed = 0.0;
  if (hNew > uDryDepth) {
    float ux = 0.5 * (qWest + qEast) / hNew;
    float uy = 0.5 * (qNorth + qSouth) / hNew;
    speed = length(vec2(ux, uy));
  }

  // Running statistics. These are what the station table and the map overlays read.
  maxDepth = max(maxDepth, hNew);
  maxSpeed = max(maxSpeed, speed);

  // Arrival time uses -1 as "never arrived" rather than a large float, so that a
  // readback can distinguish it unambiguously. Cells wet at t = 0, which means the
  // reservoir, correctly record an arrival of 0.
  if (arrival < 0.0 && hNew > uArrivalDepth) {
    arrival = now;
  }

  outState = vec4(hNew, maxDepth, arrival, maxSpeed);
}
