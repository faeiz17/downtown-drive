// Camera-motion blur: reconstructs world position from depth, reprojects with last frame's view-projection matrix
// and blurs along the screen-space velocity. Nearby pixels (the player's car in chase/interior view) are masked out.
import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

const frag = /* glsl */ `
uniform mat4 uPrevViewProj;
uniform mat4 uInvViewProj;
uniform float uStrength;
uniform float uNear;
uniform float uFar;

float linDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (uStrength < 0.001) { outputColor = inputColor; return; }
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 world = uInvViewProj * ndc;
  world /= world.w;
  vec4 prev = uPrevViewProj * world;
  if (prev.w < 0.05) { outputColor = inputColor; return; }
  vec2 prevUv = (prev.xy / prev.w) * 0.5 + 0.5;
  vec2 vel = (uv - prevUv) * uStrength;
  float d = linDepth(depth);
  vel *= smoothstep(8.0, 18.0, d);
  float len = length(vel);
  if (len > 0.035) vel *= 0.035 / len;
  if (len < 0.0004) { outputColor = inputColor; return; }
  vec4 acc = inputColor;
  const int N = 8;
  for (int i = 1; i < N; i++) {
    float t = float(i) / float(N - 1) - 0.5;
    acc += texture2D(inputBuffer, uv + vel * t);
  }
  outputColor = acc / float(N);
}
`;

export class MotionBlurEffect extends Effect {
  private prev = new THREE.Matrix4();
  private cur = new THREE.Matrix4();
  private hasPrev = false;

  constructor() {
    super('MotionBlurEffect', frag, {
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['uPrevViewProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uInvViewProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uStrength', new THREE.Uniform(0)],
        ['uNear', new THREE.Uniform(0.1)],
        ['uFar', new THREE.Uniform(5000)],
      ]),
    });
  }

  /** Call once per frame after the camera matrices are final. strength ~ 0..1 */
  updateCamera(camera: THREE.PerspectiveCamera, strength: number): void {
    this.cur.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const u = this.uniforms;
    u.get('uInvViewProj')!.value.copy(this.cur).invert();
    u.get('uPrevViewProj')!.value.copy(this.hasPrev ? this.prev : this.cur);
    u.get('uStrength')!.value = this.hasPrev ? strength : 0;
    u.get('uNear')!.value = camera.near;
    u.get('uFar')!.value = camera.far;
    this.prev.copy(this.cur);
    this.hasPrev = true;
  }

  reset(): void {
    this.hasPrev = false;
  }
}
