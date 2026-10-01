// Sun/moon light with cascaded shadow maps (three/addons/csm/CSM.js).
//
// One shadow map cannot be both sharp under the car and reach down the boulevard. CSM splits the view into
// cascades, each with its own map: a tight one around the camera, a medium one, and a wide one for distant trees
// and buildings. three's CSM creates one DirectionalLight per cascade and patches the lighting shader chunk so every
// fragment is lit by exactly one of them (the cascade its view depth falls in).
//
// What this wrapper adds:
//  - patch(): CSM.setupMaterial replaces material.onBeforeCompile, which would drop the atlas / tree shader patches.
//    Here the CSM uniforms are chained in front of whatever the material already does, with shared uniform objects.
//    EVERY lit material must be patched, or it is lit once per cascade (3× too bright).
//  - a proxy camera with a fixed field of view, so cascade bounds do not change (and shadows do not shimmer) when
//    the chase camera's FOV opens up with speed, and the TAA jitter never reaches the shadow fit.
//  - staggered updates: the near cascade renders every frame, the middle every 2nd, the far every 4th frame.
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';

export interface ShadowSettings {
  enabled: boolean;
  mapSize: number;
  /** how far from the camera shadows reach (m) */
  maxFar: number;
}

const CASCADES = 3;
// cascade far planes as a fraction of maxFar (near cascade ≈ the car and the road just ahead)
const SPLITS = [0.1, 0.34, 1];
const FIT_FOV = 80; // ≥ the widest gameplay FOV

/** the built-in materials that run the lighting chunks CSM patches */
function isLit(m: THREE.Material): boolean {
  const x = m as unknown as Record<string, boolean | undefined>;
  return !!(x.isMeshStandardMaterial || x.isMeshPhongMaterial || x.isMeshLambertMaterial || x.isMeshToonMaterial);
}

export class SunShadows {
  readonly csm: CSM;
  private readonly fitCamera: THREE.PerspectiveCamera;
  private readonly breaks = { value: [] as THREE.Vector2[] };
  private readonly near = { value: 0.1 };
  private readonly far = { value: 100 };
  private frame = 0;
  private settings: ShadowSettings = { enabled: true, mapSize: 1024, maxFar: 150 };
  private readonly dir = new THREE.Vector3(0, -1, 0);
  /** set to false to render all cascades every frame (debug / screenshots) */
  stagger = true;

  constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.fitCamera = new THREE.PerspectiveCamera(FIT_FOV, camera.aspect, camera.near, camera.far);
    this.csm = new CSM({
      camera: this.fitCamera,
      parent: scene,
      cascades: CASCADES,
      maxFar: this.settings.maxFar,
      mode: 'custom',
      customSplitsCallback: (_n: number, _near: number, _far: number, target: number[]) => {
        for (const s of SPLITS) target.push(s);
      },
      shadowMapSize: this.settings.mapSize,
      lightDirection: this.dir,
      lightIntensity: 3,
      lightNear: 1,
      lightFar: 700,
      lightMargin: 160,
      shadowBias: -0.00025,
    });
    this.refit();
  }

  get lights(): THREE.DirectionalLight[] {
    return this.csm.lights;
  }

  /** Lit materials must be registered so the cascade lights count as one light. Safe to call repeatedly. */
  patch(material: THREE.Material | THREE.Material[] | null | undefined): void {
    if (!material) return;
    if (Array.isArray(material)) {
      for (const m of material) this.patch(m);
      return;
    }
    const m = material;
    if (m.userData.csm || !isLit(m)) return;
    m.userData.csm = true;
    m.defines = m.defines || {};
    m.defines.USE_CSM = 1;
    m.defines.CSM_CASCADES = CASCADES;
    const prev = m.onBeforeCompile;
    const ownKey = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey : null;
    const prevKey = () => (ownKey ? ownKey.call(m) : prev.toString());
    m.onBeforeCompile = (shader, renderer) => {
      shader.uniforms.CSM_cascades = this.breaks;
      shader.uniforms.cameraNear = this.near;
      shader.uniforms.shadowFar = this.far;
      prev.call(m, shader, renderer);
    };
    m.customProgramCacheKey = () => `csm|${prevKey()}`;
    m.needsUpdate = true;
  }

  /** Patch every lit material under an object (chunks, car, traffic). */
  patchObject(root: THREE.Object3D): void {
    root.traverse((o) => this.patch((o as THREE.Mesh).material));
  }

  /** Names of lit materials that were not patched (should be empty; used by the smoke test). */
  unpatched(root: THREE.Object3D): string[] {
    const out = new Set<string>();
    root.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        if (isLit(m) && !m.userData.csm) out.add(`${o.name || o.type}:${m.type}`);
      }
    });
    return [...out];
  }

  configure(s: ShadowSettings): void {
    const sizeChanged = s.mapSize !== this.settings.mapSize;
    this.settings = { ...s };
    this.csm.maxFar = s.maxFar;
    this.csm.shadowMapSize = s.mapSize;
    this.csm.lights.forEach((l, i) => {
      l.castShadow = s.enabled;
      if (sizeChanged) {
        l.shadow.mapSize.set(s.mapSize, s.mapSize);
        l.shadow.map?.dispose();
        l.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      }
      l.shadow.autoUpdate = i === 0;
      l.shadow.needsUpdate = true;
    });
    this.refit();
  }

  /** Recompute cascade bounds (resize, quality change). */
  refit(): void {
    this.fitCamera.aspect = this.camera.aspect;
    this.fitCamera.near = this.camera.near;
    this.fitCamera.far = this.camera.far;
    this.fitCamera.updateProjectionMatrix();
    this.csm.updateFrustums();
    // (near, far) of each cascade as a fraction of the shadow distance
    this.breaks.value = SPLITS.map((s, i) => (this.breaks.value[i] ?? new THREE.Vector2()).set(i ? SPLITS[i - 1] : 0, s));
    this.near.value = this.fitCamera.near;
    this.far.value = Math.min(this.fitCamera.far, this.csm.maxFar);
    // bias grows with the cascade's texel size
    this.csm.lights.forEach((l) => {
      const cam = l.shadow.camera;
      const texel = (cam.right - cam.left) / this.settings.mapSize;
      l.shadow.normalBias = Math.min(0.5, texel * 1.6);
      l.shadow.bias = -0.00025;
    });
  }

  /** dir = unit vector pointing TOWARD the light (sun or moon). */
  setLight(dirToLight: THREE.Vector3, color: THREE.Color, intensity: number): void {
    this.dir.copy(dirToLight).negate();
    this.csm.lightDirection.copy(this.dir);
    for (const l of this.csm.lights) {
      l.color.copy(color);
      l.intensity = intensity;
    }
  }

  /** Call once per frame after the camera has been positioned. */
  update(): void {
    if (Math.abs(this.fitCamera.aspect - this.camera.aspect) > 1e-4) this.refit();
    this.fitCamera.position.copy(this.camera.position);
    this.fitCamera.quaternion.copy(this.camera.quaternion);
    this.fitCamera.updateMatrixWorld();
    this.csm.update();
    this.frame++;
    if (!this.settings.enabled) return;
    const L = this.csm.lights;
    if (!this.stagger) {
      for (const l of L) l.shadow.needsUpdate = true;
      return;
    }
    if (this.frame % 2 === 0) L[1].shadow.needsUpdate = true;
    if (this.frame % 4 === 1) L[2].shadow.needsUpdate = true;
  }
}
