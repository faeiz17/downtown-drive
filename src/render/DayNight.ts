// Dynamic day/night: real solar position for Lahore, photographed skies (Poly Haven HDRIs) for the background,
// reflections and ambient light, a sun/moon light with cascaded shadows, and smog fog.
//
// Three skies are used: a hazy partly-cloudy day, a sunset, and a night sky with city glow. Each exists twice:
//   <name>.jpg  4096×1152 tone-mapped upper hemisphere, shown as the visible sky (sharp clouds, small file)
//   <name>.hdr  1k HDR equirect, rendered into a cubemap and pre-filtered (PMREM) for reflections + ambient light
// The skies are cross-faded by sun elevation and rotated so the photographed sun sits at the computed solar azimuth
// (the day sky is also stretched vertically so its sun sits at the computed elevation). Sunrise reuses the sunset.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { LAHORE } from '../data/geo';
import type { SunShadows } from './SunShadows';

export interface SunState {
  elevation: number; // degrees
  azimuth: number; // degrees clockwise from north
  dir: THREE.Vector3; // unit vector toward the sun (world)
  night: number; // 0 day … 1 night
}

/** NOAA simplified solar position. hour = local clock time (PKT, UTC+5). */
export function solarPosition(dayOfYear: number, hour: number, lat = LAHORE.lat, lon = LAHORE.lon, tz = LAHORE.utcOffsetHours): { elevation: number; azimuth: number } {
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hour - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hour * 60 + eqtime + 4 * lon - 60 * tz;
  const ha = ((tst / 4 - 180) * Math.PI) / 180;
  const la = (lat * Math.PI) / 180;
  const cosZ = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  // azimuth clockwise from north: 0 = N, 90 = E, 180 = S, 270 = W
  let az = (Math.atan2(-Math.sin(ha), Math.tan(decl) * Math.cos(la) - Math.sin(la) * Math.cos(ha)) * 180) / Math.PI;
  if (az < 0) az += 360;
  return { elevation: 90 - (zen * 180) / Math.PI, azimuth: az };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type SkyName = 'day' | 'dusk' | 'night';
/** per-sky constants: where the sun/moon is in the photo, and how bright the photo should be shown / lit */
const SKY: Record<SkyName, { sunU: number; sunEl: number; show: number; light: number; tint: [number, number, number] }> = {
  // sunU = horizontal texture coordinate of the brightest point, sunEl = its elevation in degrees (scripts/debug/hdr-sun.ts)
  day: { sunU: 0.5996, sunEl: 43.2, show: 1.7, light: 1.0, tint: [1.0, 0.985, 0.95] },
  dusk: { sunU: 0.6045, sunEl: 2.1, show: 1.0, light: 0.5, tint: [1.0, 0.93, 0.9] },
  night: { sunU: 0.7822, sunEl: 84.4, show: 0.1, light: 0.4, tint: [1.0, 0.86, 0.72] },
};

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww; // on the far plane: only pixels nothing else covered are shaded
}`;

const skyFrag = /* glsl */ `
precision highp float;
uniform sampler2D tA;
uniform sampler2D tB;
uniform float uMix;
uniform vec4 uA; // rotation (rad), sun elevation in game (rad), sun elevation in photo (rad), brightness
uniform vec4 uB;
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform vec3 uFog;
uniform vec3 uGround;
uniform float uHaze;
uniform float uClamp;
varying vec3 vDir;
const float PI = 3.141592653589793;
const float HALF_PI = 1.5707963267948966;

vec3 sampleSky(sampler2D t, vec3 d, vec4 p) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  // vertical stretch so the photographed sun lands on the computed sun elevation
  float w = el < p.y ? el * (p.z / p.y) : p.z + (el - p.y) * ((HALF_PI - p.z) / (HALF_PI - p.y));
  float u = (atan(d.z, d.x) + p.x) / (2.0 * PI) + 0.5;
  #ifdef SKY_HDR
    vec3 c = texture2D(t, vec2(u, clamp(w / PI + 0.5, 0.001, 0.999))).rgb;
    c = min(c, vec3(uClamp)); // the sun itself is a separate directional light
  #else
    // cropped tone-mapped photo: +90° .. -11.25°
    vec3 c = texture2D(t, vec2(u, clamp((w * 180.0 / PI + 11.25) / 101.25, 0.004, 0.996))).rgb;
    c = c / max(vec3(1.0) - c * 0.86, vec3(0.1)); // undo the photo's tone curve: highlights back above 1 (bloom)
  #endif
  return c * p.w;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 c = sampleSky(tA, d, uA) * uTintA;
  if (uMix > 0.001) c = mix(c, sampleSky(tB, d, uB) * uTintB, uMix);
  float el = asin(clamp(d.y, -1.0, 1.0));
  // smog: the sky dissolves into the fog colour toward the horizon, so distant buildings fade into it seamlessly
  float haze = exp(-max(el, 0.0) * 7.0) * uHaze;
  c = mix(c, uFog, clamp(haze, 0.0, 1.0));
  #ifdef SKY_HDR
    // below the horizon the environment is the ground (bounce light), not a mirrored sky
    c = mix(c, uGround, smoothstep(0.02, -0.12, d.y));
  #else
    c = mix(c, uFog, smoothstep(0.0, -0.04, d.y));
  #endif
  gl_FragColor = vec4(c, 1.0);
}`;

export class DayNight {
  /** visible sky dome */
  readonly sky: THREE.Mesh;
  /** light colour/intensity that the cascaded sun/moon lights follow */
  readonly sunColor = new THREE.Color(1, 1, 1);
  sunIntensity = 3;
  readonly fog = new THREE.FogExp2(0xc8c0ac, 0.0011);
  readonly state: SunState = { elevation: 45, azimuth: 180, dir: new THREE.Vector3(0, 1, 0), night: 0 };
  hour = 16.5;
  dayOfYear = 270; // late September
  /** real minutes for a full 24 h cycle (0 = frozen) */
  cycleMinutes = 24;
  smog = 1;
  /** multipliers exposed to the dev tuning panel (F2) */
  tune = { sun: 1, ambient: 1, sky: 1, exposure: 1, fog: 1 };
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private cubeRT: THREE.WebGLCubeRenderTarget;
  private cubeCam: THREE.CubeCamera;
  private skyMat: THREE.ShaderMaterial;
  private envMat: THREE.ShaderMaterial;
  private ldr: Partial<Record<SkyName, THREE.Texture>> = {};
  private hdr: Partial<Record<SkyName, THREE.Texture>> = {};
  private lastEnvKey = '';
  private envTimer = 0;
  private envIntensity = 1;
  private readonly lightDir = new THREE.Vector3();
  private readonly dayC = new THREE.Color(0.74, 0.74, 0.7);
  private readonly duskC = new THREE.Color(0.78, 0.52, 0.38);
  private readonly nightC = new THREE.Color(0.075, 0.066, 0.07);
  private readonly ground = new THREE.Color();

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, private shadows: SunShadows) {
    const uniforms = () => ({
      tA: { value: null as THREE.Texture | null }, tB: { value: null as THREE.Texture | null }, uMix: { value: 0 },
      uA: { value: new THREE.Vector4(0, 1, 1, 1) }, uB: { value: new THREE.Vector4(0, 1, 1, 1) },
      uTintA: { value: new THREE.Vector3(1, 1, 1) }, uTintB: { value: new THREE.Vector3(1, 1, 1) },
      uFog: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uHaze: { value: 0.9 }, uClamp: { value: 14 },
    });
    const opts = { vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false };
    this.skyMat = new THREE.ShaderMaterial({ ...opts, uniforms: uniforms() });
    this.envMat = new THREE.ShaderMaterial({ ...opts, uniforms: uniforms(), defines: { SKY_HDR: 1 } });
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = 1000; // after the opaque world: early-z rejects everything but visible sky
    this.sky.name = 'sky';
    scene.add(this.sky);
    scene.background = null;
    const envDome = new THREE.Mesh(geo, this.envMat);
    envDome.frustumCulled = false;
    this.envScene.add(envDome);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(0.1, 10, this.cubeRT);
    this.envScene.add(this.cubeCam);
    scene.fog = this.fog;
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  /** Load the sky photographs (visible) and HDRIs (lighting). */
  async load(base: string): Promise<void> {
    const tl = new THREE.TextureLoader();
    const hl = new HDRLoader().setDataType(THREE.HalfFloatType);
    const names: SkyName[] = ['day', 'dusk', 'night'];
    await Promise.all(names.flatMap((n) => [
      tl.loadAsync(`${base}sky/${n}.jpg`).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.generateMipmaps = false; // always magnified; mip selection would also show a seam at the atan wrap
        t.minFilter = THREE.LinearFilter;
        this.ldr[n] = t;
      }),
      hl.loadAsync(`${base}sky/${n}.hdr`).then((t) => {
        t.wrapS = THREE.RepeatWrapping;
        t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        this.hdr[n] = t;
      }),
    ]));
    this.lastEnvKey = '';
  }

  /** Advance time and update everything. */
  update(dt: number): void {
    if (this.cycleMinutes > 0) this.hour = (this.hour + (dt / (this.cycleMinutes * 60)) * 24) % 24;
    const { elevation, azimuth } = solarPosition(this.dayOfYear, this.hour);
    const el = (elevation * Math.PI) / 180, az = (azimuth * Math.PI) / 180;
    const dir = this.state.dir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
    this.state.elevation = elevation;
    this.state.azimuth = azimuth;
    const night = 1 - smoothstep(-5, 7, elevation);
    this.state.night = night;

    // sun / moon (one light: the sun by day, the moon by night)
    const day = smoothstep(-2, 8, elevation);
    const warm = 1 - smoothstep(2, 35, elevation);
    if (day > 0.02) {
      this.sunColor.setRGB(1, 0.95 - warm * 0.33, 0.87 - warm * 0.56);
      this.sunIntensity = day * (2.6 + 1.0 * smoothstep(10, 50, elevation)) * (1 - 0.2 * (this.smog - 1)) * this.tune.sun;
      // keep the light off the horizon: a grazing sun makes metre-long acne and a shadow map the size of the city
      this.lightDir.set(dir.x, Math.max(dir.y, 0.1), dir.z).normalize();
    } else {
      this.lightDir.set(-dir.x, 0.8, -dir.z).normalize();
      this.sunColor.setRGB(0.55, 0.64, 1);
      this.sunIntensity = night * 0.3 * this.tune.sun;
    }
    this.shadows.setLight(this.lightDir, this.sunColor, this.sunIntensity);

    // smog/haze: pale warm grey by day, orange at dusk, sodium-tinged dark at night
    const dusk = smoothstep(-6, 6, elevation) * (1 - smoothstep(6, 25, elevation));
    const fc = this.fog.color;
    fc.copy(this.dayC).lerp(this.duskC, dusk * 0.85).lerp(this.nightC, night);
    this.fog.density = (0.0005 + 0.00055 * this.smog) * (1 + night * 0.4) * this.tune.fog;

    // --- which two skies, and how far between them
    const wDay = smoothstep(3, 14, elevation);
    const wNight = 1 - smoothstep(-10, -3, elevation);
    const a: SkyName = elevation >= 3 ? 'day' : wNight > 0 ? 'night' : 'dusk';
    const b: SkyName = 'dusk';
    const mix = a === 'day' ? 1 - wDay : a === 'night' ? 1 - wNight : 0;
    // photographed-sun azimuth in the shader's convention: phi = atan(z, x)
    const phiGame = Math.atan2(dir.z, dir.x);
    const rot = (n: SkyName) => (n === 'night' ? 0.6 : (SKY[n].sunU - 0.5) * 2 * Math.PI - phiGame);
    const elGame = (n: SkyName) => (n === 'day' ? (Math.max(22, Math.min(66, elevation)) * Math.PI) / 180 : (SKY[n].sunEl * Math.PI) / 180);
    // the sunset photo is brightest with the sun on the horizon and fades through twilight
    const duskLevel = 0.25 + 0.75 * smoothstep(-9, 1, elevation);
    const level = (n: SkyName) => (n === 'dusk' ? duskLevel : 1);
    const set = (mat: THREE.ShaderMaterial, tex: Partial<Record<SkyName, THREE.Texture>>, key: 'show' | 'light') => {
      const u = mat.uniforms;
      u.tA.value = tex[a] ?? null;
      u.tB.value = tex[b] ?? null;
      u.uMix.value = mix;
      const k = key === 'show' ? this.tune.sky : 1;
      u.uA.value.set(rot(a), elGame(a), (SKY[a].sunEl * Math.PI) / 180, SKY[a][key] * level(a) * k);
      u.uB.value.set(rot(b), elGame(b), (SKY[b].sunEl * Math.PI) / 180, SKY[b][key] * level(b) * k);
      u.uTintA.value.fromArray(SKY[a].tint);
      u.uTintB.value.fromArray(SKY[b].tint);
      u.uFog.value.copy(fc);
      u.uHaze.value = Math.min(1, 0.55 + 0.35 * this.smog);
    };
    set(this.skyMat, this.ldr, 'show');
    set(this.envMat, this.hdr, 'light');
    // ground bounce for the lower half of the environment: lit ground albedo, warm by day, dim sodium at night
    const sunUp = Math.max(0, this.lightDir.y) * this.sunIntensity;
    this.ground.setRGB(0.3, 0.27, 0.22).multiplyScalar(0.12 + 0.2 * sunUp * (1 - night) + 0.05 * (1 - night)).lerp(this.nightC, night * 0.6);
    this.envMat.uniforms.uGround.value.copy(this.ground);
    this.envMat.uniforms.uHaze.value *= 0.6;
    this.envIntensity = (0.95 - 0.35 * night) * this.tune.ambient;
    this.scene.environmentIntensity = this.envIntensity;

    // environment map: re-filter when the sky changed visibly (elevation step, smog) or every 30 s
    this.envTimer += dt;
    const key = `${Math.round(elevation / 1.5)}|${a}|${this.smog.toFixed(2)}|${this.hdr[a] ? 1 : 0}`;
    if (this.hdr[a] && (key !== this.lastEnvKey || this.envTimer > 30)) {
      this.lastEnvKey = key;
      this.captureEnv();
    }
  }

  private captureEnv(): void {
    this.envTimer = 0;
    this.cubeCam.update(this.renderer, this.envScene);
    const rt = this.pmrem.fromCubemap(this.cubeRT.texture);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
  }

  /** Suggested tone-mapping exposure for the current light. */
  get exposure(): number {
    // open up gradually from late afternoon through twilight into night
    const el = this.state.elevation;
    return (1.0 + 0.3 * (1 - smoothstep(-8, 10, el))) * this.tune.exposure;
  }
}
