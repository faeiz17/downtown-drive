// WebGL renderer + post-processing chain: scene → SSAO (half-res) → motion blur + sanitize → bloom + tone mapping
// + vignette → SMAA. Includes GPU timing (EXT_disjoint_timer_query_webgl2) and dynamic resolution scaling so the
// frame stays inside its budget on high-DPI screens (three-best-practices: pixel ratio, post-processing, merged passes).
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, Effect, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { MotionBlurEffect } from './MotionBlurEffect';
import { TAAPass } from './TAAPass';
import type { QualityPreset } from './Quality';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly motionBlur = new MotionBlurEffect();
  readonly bloom: BloomEffect;
  readonly toneMapping: ToneMappingEffect;
  private renderPass: RenderPass;
  private aoPass: N8AOPostPass;
  readonly taa: TAAPass;
  private mbPass: EffectPass;
  private mainPass: EffectPass;
  private smaaPass: EffectPass;
  quality!: QualityPreset;
  /** GPU time of the last completed frame (ms), if EXT_disjoint_timer_query_webgl2 is available */
  gpuMs = 0;
  private timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null | undefined = undefined;
  private queries: WebGLQuery[] = [];
  // dynamic resolution
  private gpuHistory = new Float32Array(30);
  private gpuHistN = 0;
  private dynTimer = 0;
  pixelRatio = 1; // current render pixel ratio
  private pendingPixelRatio = 0; // applied at the START of the next frame (see render())
  gpuBudgetMs = 13; // set by the frame pacer
  dynamicResolution = true;
  private readonly lastCamPos = new THREE.Vector3();
  private readonly lastCamQuat = new THREE.Quaternion();

  constructor(readonly canvas: HTMLCanvasElement, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, preserveDrawingBuffer: new URLSearchParams(location.search).has('capture') });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.aoPass = new N8AOPostPass(scene, camera, 1, 1);
    this.aoPass.configuration.gammaCorrection = false;
    this.aoPass.configuration.aoRadius = 2.0;
    this.aoPass.configuration.distanceFalloff = 1.2;
    this.aoPass.configuration.intensity = 2.2;
    this.composer.addPass(this.aoPass);
    // Temporal AA sits after SSAO (so the AO noise is also filtered) and before everything that works on the
    // anti-aliased image (motion blur, bloom, tone mapping).
    this.taa = new TAAPass(camera);
    this.composer.addPass(this.taa);
    // Motion blur and the NaN/HDR sanitiser share one full-screen pass. The sanitiser must run in a pass BEFORE
    // bloom: bloom builds its mip chain from its own pass's raw input, so a clamp inside the bloom pass would not
    // stop a single NaN pixel (full-screen black flash) or a sun glint on the clearcoat (white flash).
    this.mbPass = new EffectPass(camera, this.motionBlur, new SanitizeEffect(4.0));
    this.composer.addPass(this.mbPass);
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.55, luminanceSmoothing: 0.35, intensity: 0.35, radius: 0.42 });
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.45 });
    this.mainPass = new EffectPass(camera, this.bloom, this.toneMapping, vignette);
    this.composer.addPass(this.mainPass);
    this.smaaPass = new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM }));
    this.composer.addPass(this.smaaPass);
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
    this.renderPass.mainCamera = camera;
    this.aoPass.camera = camera;
    this.taa.renderCamera = camera;
    this.mbPass.mainCamera = camera;
    this.mainPass.mainCamera = camera;
    this.smaaPass.mainCamera = camera;
  }

  applyQuality(q: QualityPreset): void {
    const shadowsChanged = !this.quality || this.quality.shadows !== q.shadows;
    this.quality = q;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = q.shadows;
    this.aoPass.enabled = q.ssao;
    this.aoPass.setQualityMode(q.ssaoMode);
    this.aoPass.configuration.halfRes = true;
    this.bloom.intensity = q.bloom ? 0.35 : 0;
    this.taa.enabled = q.taa;
    this.taa.invalidate();
    // SMAA is the fallback when TAA is off (it cannot fix sub-pixel crawl, TAA can)
    this.smaaPass.enabled = q.smaa && !q.taa;
    // postprocessing only presents the pass flagged renderToScreen: make it the last *enabled* pass
    const passes = [this.renderPass, this.aoPass, this.taa, this.mbPass, this.mainPass, this.smaaPass];
    passes.forEach((p) => (p.renderToScreen = false));
    [...passes].reverse().find((p) => p.enabled)!.renderToScreen = true;
    this.gpuHistN = 0;
    this.resize();
    // shadow map on/off changes shader variants: recompile once
    if (shadowsChanged)
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
      });
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  set exposure(v: number) {
    this.renderer.toneMappingExposure = v;
  }

  /**
   * Dynamic resolution: pixel count scales with pixelRatio², so step the ratio by √(budget/gpu) when over budget
   * and creep back up when there is headroom. Changes are quantised and rate-limited (render targets reallocate).
   */
  private updateDynamicResolution(dt: number): void {
    if (!this.quality || !this.timerExt || !this.dynamicResolution) return;
    this.dynTimer += dt;
    if (this.dynTimer < 1.0 || this.gpuHistN < 20) return;
    this.dynTimer = 0;
    const xs = Array.from(this.gpuHistory.subarray(0, Math.min(this.gpuHistN, this.gpuHistory.length))).sort((a, b) => a - b);
    const p80 = xs[Math.floor(xs.length * 0.8)];
    const maxPR = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    const minPR = Math.min(maxPR, this.quality.minPixelRatio);
    let pr = this.pixelRatio;
    if (p80 > this.gpuBudgetMs) pr *= Math.max(0.8, Math.min(0.97, Math.sqrt(this.gpuBudgetMs / p80)));
    else if (p80 < this.gpuBudgetMs * 0.62) pr *= 1.05;
    pr = Math.round(Math.max(minPR, Math.min(maxPR, pr)) * 20) / 20;
    // Resizing the canvas clears it. Applying the change here (after this frame was drawn) would put a black
    // canvas on screen until the next frame: defer it to the start of the next render instead.
    if (Math.abs(pr - this.pixelRatio) >= 0.05) this.pendingPixelRatio = pr;
  }

  render(dt: number, motionStrength: number): void {
    if (this.pendingPixelRatio) {
      this.pixelRatio = this.pendingPixelRatio;
      this.pendingPixelRatio = 0;
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      this.gpuHistN = 0;
      this.motionBlur.reset();
    }
    // camera cut (mode change, reset, teleport): drop temporal history instead of smearing the old view
    const cp = this.camera.position;
    if (cp.distanceToSquared(this.lastCamPos) > 36 || this.camera.quaternion.dot(this.lastCamQuat) ** 2 < 0.93) {
      this.taa.invalidate();
      this.motionBlur.reset();
    }
    this.lastCamPos.copy(cp);
    this.lastCamQuat.copy(this.camera.quaternion);
    this.taa.applyJitter(this.camera);
    this.renderer.info.reset();
    this.motionBlur.updateCamera(this.camera, this.quality?.motionBlur ? motionStrength : 0);
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (this.timerExt === undefined) this.timerExt = (gl.getExtension('EXT_disjoint_timer_query_webgl2') as typeof this.timerExt) ?? null;
    let q: WebGLQuery | null = null;
    if (this.timerExt && this.queries.length < 4) {
      q = gl.createQuery();
      if (q) gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, q);
    }
    this.composer.render(dt);
    this.camera.clearViewOffset();
    if (q && this.timerExt) {
      gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
      this.queries.push(q);
    }
    if (this.timerExt && this.queries.length) {
      const oldest = this.queries[0];
      if (gl.getQueryParameter(oldest, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(this.timerExt.GPU_DISJOINT_EXT)) {
          this.gpuMs = gl.getQueryParameter(oldest, gl.QUERY_RESULT) / 1e6;
          this.gpuHistory[this.gpuHistN++ % this.gpuHistory.length] = this.gpuMs;
        }
        gl.deleteQuery(oldest);
        this.queries.shift();
      }
    }
    this.updateDynamicResolution(dt);
  }
}

/** Replaces NaN/Inf pixels with black and caps pre-tonemap HDR so one bad pixel cannot flood the bloom chain. */
class SanitizeEffect extends Effect {
  constructor(limit: number) {
    super('SanitizeEffect', /* glsl */ `
      uniform float uLimit;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        bool bad = any(isnan(c)) || any(isinf(c)) || any(greaterThan(abs(c), vec3(60000.0)));
        c = bad ? vec3(0.0) : clamp(c, vec3(0.0), vec3(uLimit));
        outputColor = vec4(c, 1.0);
      }
    `, {
      uniforms: new Map<string, THREE.Uniform>([['uLimit', new THREE.Uniform(limit)]]),
    });
  }
}
