// Control pass. One texel, run once per rendered frame, before the substeps.
//
// Output channels:
//   r  dt, the adaptive timestep for every substep of this frame
//   g  maximum depth in the domain, carried through for the UI
//   b  simulation time at the START of this frame
//   a  total water volume in the domain, m^3
//
// The timestep comes from the CFL condition for this scheme, Bates et al. (2010)
// section 2.2:
//
//   dt = alpha * dx / sqrt(g * h_max)
//
// Keeping dt in a texture rather than a JavaScript uniform is what lets the timestep
// adapt without a GPU-to-CPU round trip inside the substep loop. A readback per substep
// would stall the pipeline and cost more than the solver itself.
//
// Simulation time is advanced here using the PREVIOUS frame's dt, which is still in the
// texture being read. That is why the clock is exact rather than drifting: frame k
// advances the clock by frame k-1's dt times the substep count, and the depth pass adds
// the within-frame offset itself.

precision highp float;

uniform sampler2D uPrevControl;
uniform sampler2D uReduced;  // 1x1: r = max depth, g = sum of depths

uniform float uCellSize;
uniform float uCellArea;
uniform float uGravity;
uniform float uCflAlpha;
uniform float uDtMin;
uniform float uDtMax;
uniform float uSubsteps;

/** 1 resets the clock and volume, used when a run starts. */
uniform float uReset;

layout(location = 0) out vec4 outControl;

void main() {
  vec4 prev = texture(uPrevControl, vec2(0.5));
  vec2 reduced = texture(uReduced, vec2(0.5)).rg;

  float maxDepth = reduced.r;
  float volume = reduced.g * uCellArea;

  // A floor on the depth used for the CFL condition. Without it, a domain that is almost
  // entirely dry drives dt to dtMax and the first wave of a release can jump several
  // cells in one step.
  float cflDepth = max(maxDepth, 0.01);
  float dt = clamp(uCflAlpha * uCellSize / sqrt(uGravity * cflDepth), uDtMin, uDtMax);

  float previousDt = prev.r;
  float previousTime = prev.b;
  float time = (uReset > 0.5) ? 0.0 : previousTime + previousDt * uSubsteps;

  outControl = vec4(dt, maxDepth, time, volume);
}
