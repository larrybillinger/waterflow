// Sky dome shading. Shares skyRadiance with the water reflection, so the sky the water
// mirrors is exactly the sky that is drawn. See decision D-008.

precision highp float;

uniform vec3 uSunDirection;

in vec3 vDirection;

layout(location = 0) out vec4 outColor;

#include "sky.glsl"

void main() {
  vec3 colour = skyRadiance(normalize(vDirection), uSunDirection);
  outColor = vec4(colour, 1.0);
}
