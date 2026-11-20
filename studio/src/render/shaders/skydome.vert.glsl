// Sky dome. A large sphere rendered from the inside, so the direction from the camera to
// each fragment is the view ray and the sky function can be evaluated directly.

out vec3 vDirection;

void main() {
  // World-space direction of this vertex from the sphere centre, which is the camera.
  vDirection = normalize(position);

  // Translation is dropped so the dome is always centred on the camera and can never be
  // flown out of, and w = 1 with a depth of 1 puts it behind everything else.
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(clip.xy, clip.w * 0.999999, clip.w);
}
