// Effective bed elevation, with the breach notch cut out of the dam.
//
// This is the GLSL twin of `effectiveBed` in src/sim/dam.js. The two implementations
// must stay in step, and the maths is documented once in that file's header comment.
// A change to one is a change to both.
//
// The including shader must declare these uniforms:
//
//   uniform float uBreachActive;            1 when a breach exists
//   uniform vec2  uBreachAxisOrigin;        dam axis start, grid cells
//   uniform vec2  uBreachDir;               unit direction along the axis, cells
//   uniform float uBreachAxisLength;        cells
//   uniform float uBreachCentreAlong;       cells along the axis to the breach centre
//   uniform float uBreachHalfThickness;     perpendicular reach of the cut, cells
//   uniform float uBreachBottomHalfWidth;   cells
//   uniform float uBreachTopHalfWidth;      cells
//   uniform float uBreachInvert;            metres
//   uniform float uBreachCrest;             metres

float effectiveBed(float ground, vec2 cell) {
  if (uBreachActive < 0.5) {
    return ground;
  }

  vec2 rel = cell - uBreachAxisOrigin;

  // Component along the dam axis, and perpendicular to it.
  float along = dot(rel, uBreachDir);
  float perp = rel.x * -uBreachDir.y + rel.y * uBreachDir.x;

  // Only cut within the embankment footprint. Without this the notch would carve a
  // trench through the valley upstream and downstream of the dam.
  if (abs(perp) > uBreachHalfThickness) return ground;
  if (along < -uBreachHalfThickness) return ground;
  if (along > uBreachAxisLength + uBreachHalfThickness) return ground;

  float s = abs(along - uBreachCentreAlong);
  if (s > uBreachTopHalfWidth) return ground;

  float notch;
  if (s <= uBreachBottomHalfWidth) {
    notch = uBreachInvert;
  } else {
    // Trapezoid side slopes: the cut ramps back up to the crest over the side width.
    float span = max(uBreachTopHalfWidth - uBreachBottomHalfWidth, 1e-6);
    float ramp = clamp((s - uBreachBottomHalfWidth) / span, 0.0, 1.0);
    notch = mix(uBreachInvert, uBreachCrest, ramp);
  }

  // min() so the notch only ever removes material. It can never raise terrain, and it
  // can never cut below ground that was already lower than the invert.
  return min(ground, notch);
}
