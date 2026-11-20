// Parallel reduction over the depth field, 4x4 per pass.
//
// Produces two quantities at once because both are needed every frame and a second
// chain would double the passes:
//
//   red    maximum depth anywhere in the block, which sets the CFL timestep
//   green  sum of depths in the block, which gives total water volume for the
//          mass balance check that makes risk R-007 visible instead of silent
//
// A hierarchical sum like this also has far better floating point error behaviour than
// adding 262,144 values in sequence, which matters when the result is used to claim
// mass is conserved.
//
// Reads outside the source are skipped rather than clamped. Clamping would count edge
// cells several times and inflate the volume.

precision highp float;

uniform sampler2D uSource;

/** Edge length of the source texture in texels. */
uniform float uSourceSize;

/** Edge length of this pass's output in texels. */
uniform float uTargetSize;

/** 1 on the first pass, which reads depth from state.r; 0 on later passes. */
uniform float uFirstPass;

in vec2 vUv;
layout(location = 0) out vec4 outReduced;

void main() {
  vec2 target = floor(vUv * uTargetSize);
  vec2 base = target * 4.0;

  float maxDepth = 0.0;
  float sumDepth = 0.0;

  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 texel = base + vec2(float(i), float(j));
      if (texel.x >= uSourceSize || texel.y >= uSourceSize) continue;

      vec2 uv = (texel + 0.5) / uSourceSize;
      vec4 sampled = texture(uSource, uv);

      // The first pass reads the solver state, where depth is in red. Later passes read
      // the previous reduction, where red is already a maximum and green a sum.
      float blockMax = (uFirstPass > 0.5) ? sampled.r : sampled.r;
      float blockSum = (uFirstPass > 0.5) ? sampled.r : sampled.g;

      maxDepth = max(maxDepth, blockMax);
      sumDepth += blockSum;
    }
  }

  outReduced = vec4(maxDepth, sumDepth, 0.0, 0.0);
}
