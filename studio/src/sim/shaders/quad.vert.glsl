// Full-screen quad vertex shader shared by every solver pass.
//
// The quad is a 2x2 plane centred on the origin, so position.xy is already in clip
// space and no projection is needed. uv runs 0..1 across the grid, with v = 0 at
// row 0, which is the north edge. That convention is fixed here and relied on
// everywhere downstream: see the note in src/util/grid.js.

out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
