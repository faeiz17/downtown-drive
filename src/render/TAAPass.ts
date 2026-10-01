// Temporal anti-aliasing with reprojection, for the pmndrs/postprocessing chain (WebGL).
//
// three's TAARenderPass only accumulates while nothing moves (and otherwise re-renders the scene 2^n times per
// frame), so it cannot be used in a driving game. This pass does what game TAA does:
//   1. the camera projection is jittered by a sub-pixel Halton offset every frame (applyJitter, before the scene pass)
//   2. each pixel is reprojected into last frame's resolved image:
//        - static world: from the depth buffer and the previous view-projection matrix
//        - the player's car: from a small velocity pass that knows how the car's root transform changed, so the
//          hero object stays sharp instead of smearing or jittering
//   3. the history sample is clamped to the 3×3 neighbourhood of the current frame (YCoCg) to reject stale colour
//      (disocclusion, moving traffic, lighting changes), then blended with the current frame.
// Thin geometry (wires, poles, lane lines, railings) converges to a stable anti-aliased result instead of crawling.
import * as THREE from 'three';
import { Pass } from 'postprocessing';

// Halton (2, 3) sequence, 16 samples, centred on 0
const JITTER: [number, number][] = [];
for (let i = 1; i <= 16; i++) {
  const h = (b: number) => {
    let f = 1, r = 0, k = i;
    while (k > 0) {
      f /= b;
      r += f * (k % b);
      k = Math.floor(k / b);
    }
    return r;
  };
  JITTER.push([h(2) - 0.5, h(3) - 0.5]);
}

const fullscreenVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const resolveFrag = /* glsl */ `
precision highp float;
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform sampler2D tVelocity;
uniform mat4 uReproject;  // jittered NDC of this frame -> unjittered clip space of the previous frame
uniform mat4 uUnjitter;   // jittered NDC of this frame -> unjittered clip space of this frame
uniform vec2 uTexel;
uniform float uBlend;
uniform float uReset;
uniform float uLimit;
varying vec2 vUv;

vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
vec3 sane(vec3 c) {
  // NaN/Inf guard + HDR clamp: one bad pixel must not poison the history
  bool bad = any(isnan(c)) || any(isinf(c));
  return bad ? vec3(0.0) : clamp(c, vec3(0.0), vec3(uLimit));
}

// Catmull-Rom history fetch in 5 bilinear taps (Jimenez, SIGGRAPH 2016): bilinear resampling of the history every
// frame blurs the image while the camera moves, a bicubic fetch keeps it sharp.
vec3 historyCatmullRom(vec2 uv) {
  vec2 pos = uv / uTexel;
  vec2 c = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (c - 1.0) * uTexel;
  vec2 t3 = (c + 2.0) * uTexel;
  vec2 t12 = (c + w2 / w12) * uTexel;
  vec3 s = texture2D(tHistory, vec2(t12.x, t0.y)).rgb * (w12.x * w0.y)
         + texture2D(tHistory, vec2(t0.x, t12.y)).rgb * (w0.x * w12.y)
         + texture2D(tHistory, vec2(t12.x, t12.y)).rgb * (w12.x * w12.y)
         + texture2D(tHistory, vec2(t3.x, t12.y)).rgb * (w3.x * w12.y)
         + texture2D(tHistory, vec2(t12.x, t3.y)).rgb * (w12.x * w3.y);
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(s / wsum, vec3(0.0));
}

void main() {
  vec3 cur = sane(texture2D(tCurrent, vUv).rgb);
  if (uReset > 0.5) { gl_FragColor = vec4(cur, 1.0); return; }

  // closest depth in a small cross: edge pixels take the motion of the nearer surface
  vec2 best = vUv;
  float dMin = texture2D(tDepth, vUv).r;
  vec2 o = uTexel;
  float d;
  d = texture2D(tDepth, vUv + vec2(o.x, o.y)).r; if (d < dMin) { dMin = d; best = vUv + vec2(o.x, o.y); }
  d = texture2D(tDepth, vUv + vec2(-o.x, o.y)).r; if (d < dMin) { dMin = d; best = vUv + vec2(-o.x, o.y); }
  d = texture2D(tDepth, vUv + vec2(o.x, -o.y)).r; if (d < dMin) { dMin = d; best = vUv + vec2(o.x, -o.y); }
  d = texture2D(tDepth, vUv + vec2(-o.x, -o.y)).r; if (d < dMin) { dMin = d; best = vUv + vec2(-o.x, -o.y); }

  vec2 vel;
  vec4 v = texture2D(tVelocity, best);
  if (v.a > 0.5) {
    vel = v.rg; // dynamic object (player car)
  } else {
    // both matrices are composed on the CPU in double precision, so no world-space float32 cancellation here
    vec4 ndc = vec4(best * 2.0 - 1.0, dMin * 2.0 - 1.0, 1.0);
    vec4 pc = uReproject * ndc;
    vec4 cc = uUnjitter * ndc;
    vel = pc.w * cc.w > 0.0 ? (cc.xy / cc.w - pc.xy / pc.w) * 0.5 : vec2(0.0);
  }
  vec2 huv = vUv - vel;
  if (huv.x < 0.0 || huv.x > 1.0 || huv.y < 0.0 || huv.y > 1.0) { gl_FragColor = vec4(cur, 1.0); return; }

  // neighbourhood min/max of the current frame (YCoCg)
  vec3 c0 = toYCoCg(cur);
  vec3 mn = c0, mx = c0;
  vec3 m1 = c0, m2 = c0 * c0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      if (x == 0 && y == 0) continue;
      vec3 s = toYCoCg(sane(texture2D(tCurrent, vUv + vec2(float(x), float(y)) * uTexel).rgb));
      mn = min(mn, s); mx = max(mx, s);
      m1 += s; m2 += s * s;
    }
  }
  // Variance clipping tightens the box (less ghosting than a plain min/max). Pixels that barely move on screen
  // (distant wires, poles, railings) keep the full min/max box: a sub-pixel feature is only present in some jitter
  // samples, and a tight box would throw its history away and make it flicker.
  float speed = length(vel / uTexel);
  float moving = clamp(speed * 0.6, 0.0, 1.0);
  vec3 mu = m1 / 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - mu * mu, vec3(0.0)));
  float gamma = mix(3.0, 1.25, moving);
  mn = max(mn, mu - gamma * sigma);
  mx = min(mx, mu + gamma * sigma);

  vec3 hist = toYCoCg(sane(speed > 0.02 ? historyCatmullRom(huv) : texture2D(tHistory, huv).rgb));
  hist = clamp(hist, mn, mx);

  // faster convergence where the pixel moved a lot on screen
  // (and slower where it is at rest: more jitter samples are averaged, so edges settle instead of pulsing)
  float blend = mix(mix(uBlend * 0.4, uBlend, moving), 0.25, clamp(speed * 0.02, 0.0, 1.0));
  // luminance-weighted blend (stops bright pixels flickering)
  float wc = blend / (1.0 + c0.x);
  float wh = (1.0 - blend) / (1.0 + hist.x);
  vec3 outc = (c0 * wc + hist * wh) / (wc + wh);
  gl_FragColor = vec4(max(fromYCoCg(outc), vec3(0.0)), 1.0);
}`;

const copyFrag = /* glsl */ `
precision highp float;
uniform sampler2D tResolved;
uniform vec2 uTexel;
uniform float uSharpen;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tResolved, vUv).rgb;
  if (uSharpen > 0.0) {
    // mild unsharp mask to counter the softening from bilinear history resampling
    vec3 n = texture2D(tResolved, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tResolved, vUv - vec2(0.0, uTexel.y)).rgb
           + texture2D(tResolved, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tResolved, vUv - vec2(uTexel.x, 0.0)).rgb;
    vec3 sharp = c + (c - n * 0.25) * uSharpen;
    // never brighter/darker than the local range, so no ringing
    c = clamp(sharp, c * 0.6, c * 1.5 + 0.02);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const velocityVert = /* glsl */ `
uniform mat4 uCurProj;        // unjittered projection
uniform mat4 uPrevFromView;   // this frame's view space -> previous frame's clip space, for a point fixed to the car
varying vec4 vCur;
varying vec4 vPrev;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vCur = uCurProj * mv;
  vPrev = uPrevFromView * mv;
  gl_Position = projectionMatrix * mv;
}`;

const velocityFrag = /* glsl */ `
precision highp float;
uniform sampler2D tDepth;
uniform vec2 uResolution;
varying vec4 vCur;
varying vec4 vPrev;
void main() {
  // manual depth test against the scene depth (no shared depth attachment needed)
  float sceneDepth = texture2D(tDepth, gl_FragCoord.xy / uResolution).r;
  if (gl_FragCoord.z > sceneDepth + 0.00012) discard;
  vec2 vel = (vCur.xy / vCur.w - vPrev.xy / vPrev.w) * 0.5;
  gl_FragColor = vec4(vel, 0.0, 1.0);
}`;

export class TAAPass extends Pass {
  private history: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private velocity: THREE.WebGLRenderTarget;
  private idx = 0;
  private frame = 0;
  private reset = true;
  private resolveMat: THREE.ShaderMaterial;
  private copyMat: THREE.ShaderMaterial;
  private velocityMat: THREE.ShaderMaterial;
  private depthTexture: THREE.Texture | null = null;
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly curViewProj = new THREE.Matrix4();
  private readonly curViewProjJ = new THREE.Matrix4();
  private readonly unjitteredProj = new THREE.Matrix4();
  private readonly prevRoot = new THREE.Matrix4();
  private readonly tmp = new THREE.Matrix4();
  private hasPrev = false;
  private width = 1;
  private height = 1;
  private readonly clearColor = new THREE.Color();
  private dynamicRoot: THREE.Object3D | null = null;
  private dynamicMeshes: THREE.Mesh[] = [];
  private dynamicHidden: THREE.Object3D[] = [];
  private readonly savedMaterials: (THREE.Material | THREE.Material[])[] = [];
  private readonly savedVisible: boolean[] = [];
  blend = 0.08;
  sharpen = 0.25;

  constructor(private mainCameraRef: THREE.PerspectiveCamera) {
    super('TAAPass');
    this.needsDepthTexture = true;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.history = [new THREE.WebGLRenderTarget(1, 1, opts), new THREE.WebGLRenderTarget(1, 1, opts)];
    this.velocity = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.resolveMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert, fragmentShader: resolveFrag, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        tCurrent: { value: null }, tHistory: { value: null }, tDepth: { value: null }, tVelocity: { value: this.velocity.texture },
        uReproject: { value: new THREE.Matrix4() }, uUnjitter: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2() }, uBlend: { value: 0.1 }, uReset: { value: 1 }, uLimit: { value: 4.0 },
      },
    });
    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert, fragmentShader: copyFrag, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { tResolved: { value: null }, uTexel: { value: new THREE.Vector2() }, uSharpen: { value: 0.35 } },
    });
    this.velocityMat = new THREE.ShaderMaterial({
      vertexShader: velocityVert, fragmentShader: velocityFrag, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      uniforms: {
        tDepth: { value: null }, uResolution: { value: new THREE.Vector2() },
        uCurProj: { value: new THREE.Matrix4() }, uPrevFromView: { value: new THREE.Matrix4() },
      },
    });
    this.fullscreenMaterial = this.resolveMat;
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.depthTexture = depthTexture;
  }

  override setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    for (const t of this.history) t.setSize(width, height);
    this.velocity.setSize(width, height);
    this.reset = true;
  }

  set renderCamera(camera: THREE.PerspectiveCamera) {
    this.mainCameraRef = camera;
    this.reset = true;
  }

  /**
   * The moving hero object (player car). Its opaque meshes are drawn into the velocity buffer; everything else under
   * it (glass, sprites, lines) is skipped so that what is seen through the windows keeps the world's reprojection.
   */
  setDynamicRoot(root: THREE.Object3D | null): void {
    this.dynamicRoot = root;
    this.dynamicMeshes = [];
    this.dynamicHidden = [];
    root?.traverse((o) => {
      const m = o as THREE.Mesh;
      const drawable = m.isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Line).isLine || (o as THREE.Points).isPoints;
      if (!drawable) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (m.isMesh && mats.every((x) => x && !x.transparent)) this.dynamicMeshes.push(m);
      else this.dynamicHidden.push(o);
    });
  }

  /** Drop the history (camera cut, teleport, resolution change). */
  invalidate(): void {
    this.reset = true;
  }

  /** Call once per frame BEFORE the scene is rendered: offsets the projection by a sub-pixel jitter. */
  applyJitter(camera: THREE.PerspectiveCamera): void {
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    this.unjitteredProj.copy(camera.projectionMatrix);
    camera.updateMatrixWorld();
    this.curViewProj.multiplyMatrices(this.unjitteredProj, camera.matrixWorldInverse);
    this.curViewProjJ.copy(this.curViewProj);
    if (!this.enabled) return;
    const [jx, jy] = JITTER[this.frame % JITTER.length];
    camera.setViewOffset(this.width, this.height, jx, jy, this.width, this.height);
    this.curViewProjJ.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget | null): void {
    const read = this.history[this.idx], write = this.history[1 - this.idx];
    const cam = this.mainCameraRef;

    // --- velocity of the dynamic root (player car)
    const root = this.dynamicRoot;
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.velocity);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    if (root && this.hasPrev && !this.reset) {
      const vu = this.velocityMat.uniforms;
      vu.tDepth.value = this.depthTexture;
      vu.uResolution.value.set(this.width, this.height);
      vu.uCurProj.value.copy(this.unjitteredProj);
      // previous clip <- previous world <- (car moved rigidly) <- current world <- current view
      vu.uPrevFromView.value.copy(this.prevViewProj).multiply(this.prevRoot).multiply(this.tmp.copy(root.matrixWorld).invert()).multiply(cam.matrixWorld);
      // The car subtree is rendered on its own (not through the scene) so the scene's light state is untouched:
      // rendering the scene with a different light set would force a program lookup for every material each frame.
      const meshes = this.dynamicMeshes, hidden = this.dynamicHidden;
      for (let i = 0; i < meshes.length; i++) {
        this.savedMaterials[i] = meshes[i].material;
        meshes[i].material = this.velocityMat;
      }
      for (let i = 0; i < hidden.length; i++) {
        this.savedVisible[i] = hidden[i].visible;
        hidden[i].visible = false;
      }
      const autoUpdate = renderer.shadowMap.autoUpdate, autoClear = renderer.autoClear;
      renderer.shadowMap.autoUpdate = false;
      renderer.autoClear = false;
      renderer.render(root, cam);
      renderer.autoClear = autoClear;
      renderer.shadowMap.autoUpdate = autoUpdate;
      for (let i = 0; i < meshes.length; i++) meshes[i].material = this.savedMaterials[i];
      for (let i = 0; i < hidden.length; i++) hidden[i].visible = this.savedVisible[i];
    }
    renderer.setClearColor(this.clearColor, clearAlpha);

    // --- resolve into the new history
    const u = this.resolveMat.uniforms;
    u.tCurrent.value = inputBuffer.texture;
    u.tHistory.value = read.texture;
    u.tDepth.value = this.depthTexture;
    this.tmp.copy(this.curViewProjJ).invert();
    u.uReproject.value.multiplyMatrices(this.prevViewProj, this.tmp);
    u.uUnjitter.value.multiplyMatrices(this.curViewProj, this.tmp);
    u.uTexel.value.set(1 / this.width, 1 / this.height);
    u.uBlend.value = this.blend;
    u.uReset.value = this.reset || !this.hasPrev ? 1 : 0;
    this.fullscreenMaterial = this.resolveMat;
    renderer.setRenderTarget(write);
    renderer.render(this.scene, this.camera);

    // --- present (with a mild sharpen)
    const cu = this.copyMat.uniforms;
    cu.tResolved.value = write.texture;
    cu.uTexel.value.set(1 / this.width, 1 / this.height);
    cu.uSharpen.value = this.sharpen;
    this.fullscreenMaterial = this.copyMat;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);

    this.idx = 1 - this.idx;
    this.frame++;
    this.reset = false;
    this.prevViewProj.copy(this.curViewProj);
    if (root) this.prevRoot.copy(root.matrixWorld);
    this.hasPrev = true;
  }

  override dispose(): void {
    for (const t of this.history) t.dispose();
    this.velocity.dispose();
    this.resolveMat.dispose();
    this.copyMat.dispose();
    this.velocityMat.dispose();
  }
}
