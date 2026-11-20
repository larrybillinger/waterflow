// Water surface vertex displacement.
//
// The water mesh shares the terrain's grid, one vertex per simulation cell, and is
// displaced to the water surface elevation: bed + depth. Dry vertices sit on the bed, so
// the triangle between a wet cell and a dry one forms a natural shoreline wedge, and the
// fragment shader discards the part of it that is genuinely dry.
//
// The rotation into the ground plane is baked into the geometry, so the displacement
// goes into position.y and never position.z. See the note in terrain.vert.glsl: writing
// elevation into position.z destroys the north-south coordinate.
//
// The v flip matches terrain.vert.glsl too.

uniform sampler2D uBed;
uniform sampler2D uState;
uniform float uVerticalExaggeration;
uniform float uMinDrawDepth;

out vec2 vUv;
out vec3 vWorldPosition;
out float vDepth;
out float vBedElevation;

void main() {
  vUv = vec2(uv.x, 1.0 - uv.y);

  float bed = texture(uBed, vUv).r;
  float depth = texture(uState, vUv).r;

  vBedElevation = bed;
  vDepth = depth;

  // A small upward bias keeps the surface clear of the terrain where the water is
  // only millimetres deep, which otherwise z-fights along every shoreline.
  float surface = bed + max(depth, 0.0) + 0.03;

  vec3 displaced = position;
  displaced.y = surface * uVerticalExaggeration;

  vec4 world = modelMatrix * vec4(displaced, 1.0);
  vWorldPosition = world.xyz;

  gl_Position = projectionMatrix * viewMatrix * world;
}
