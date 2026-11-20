// Terrain vertex displacement from the elevation texture.
//
// The mesh is a flat plane whose rotation into the ground plane is BAKED INTO THE
// GEOMETRY by rotateX(-PI/2) on the CPU. That detail decides which component to
// displace, and getting it wrong is not subtle: after the bake, every vertex has
// position.y == 0, and position.z carries the north-south coordinate. Writing the
// elevation into position.z therefore overwrites the north-south layout and collapses
// the whole terrain into a ribbon.
//
// So the displacement goes into position.y, which the bake left free and which is
// already world up.
//
// The v flip matters and is not cosmetic. The bake sends local +y to world -z. Grid
// row 0 is the NORTH edge and north is -z, so v must be flipped for row 0 to land at
// -z. Every shader in this project uses the flipped convention, matching the note in
// src/util/grid.js.

uniform sampler2D uBed;
uniform float uVerticalExaggeration;

out vec2 vUv;
out vec3 vWorldPosition;
out float vElevation;

void main() {
  vUv = vec2(uv.x, 1.0 - uv.y);

  float elevation = texture(uBed, vUv).r;
  vElevation = elevation;

  vec3 displaced = position;
  displaced.y = elevation * uVerticalExaggeration;

  vec4 world = modelMatrix * vec4(displaced, 1.0);
  vWorldPosition = world.xyz;

  gl_Position = projectionMatrix * viewMatrix * world;
}
