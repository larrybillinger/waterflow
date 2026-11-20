// Straight texture copy, used to seed the solver state from a CPU-uploaded data texture
// and to initialise the control texel.

precision highp float;

uniform sampler2D uSource;

in vec2 vUv;
layout(location = 0) out vec4 outColor;

void main() {
  outColor = texture(uSource, vUv);
}
