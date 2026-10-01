// Dynamic day/night: real solar position for Lahore, Preetham sky, sun/moon/hemisphere lights, smog fog, stars,
// and an environment map regenerated from the sky as the sun moves.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { LAHORE } from '../data/geo';

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

export class DayNight {
  readonly sky = new Sky();
  /** one directional light is the sun by day and the moon by night (keeps the per-pixel light count low) */
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbfd4ff, 0x6b5a45, 0.6);
  readonly fog = new THREE.FogExp2(0xc8c0ac, 0.0011);
  readonly stars: THREE.Points;
  readonly state: SunState = { elevation: 45, azimuth: 180, dir: new THREE.Vector3(0, 1, 0), night: 0 };
  hour = 16.5;
  dayOfYear = 270; // late September
  /** real minutes for a full 24 h cycle (0 = frozen) */
  cycleMinutes = 24;
  smog = 1;
  private pmrem: THREE.PMREMGenerator;
  private skyScene = new THREE.Scene();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvElevation = 999;
  private envTimer = 0;
  // The Preetham sky shader is expensive per pixel (~5 ms at Retina 2×). It is rendered into a cubemap only when
  // the sun has moved, and the cubemap is used as the scene background and as the source of the environment map.
  private cubeRT: THREE.WebGLCubeRenderTarget;
  private cubeCam: THREE.CubeCamera;
  private lastSkyElevation = 999;
  private lastSkyTurbidity = -1;
  private skyTimer = 0;
  private readonly moonDir = new THREE.Vector3();
  private readonly dayC = new THREE.Color(0.8, 0.77, 0.68);
  private readonly duskC = new THREE.Color(0.86, 0.6, 0.42);
  private readonly nightC = new THREE.Color(0.1, 0.095, 0.11);

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.sky.scale.setScalar(1000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 7;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.82;
    this.skyScene.add(this.sky);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(1, 3000, this.cubeRT);
    this.skyScene.add(this.cubeCam);
    scene.background = this.cubeRT.texture;

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;

    // stars
    const n = 1800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u1 = Math.random(), v1 = Math.random() * 0.95 + 0.05;
      const th = u1 * Math.PI * 2, ph = Math.acos(1 - v1);
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * 7000;
      pos[i * 3 + 1] = Math.cos(ph) * 7000;
      pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 7000;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  setShadowQuality(enabled: boolean, size: number, range: number): void {
    this.sun.castShadow = enabled;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    const c = this.sun.shadow.camera;
    c.left = -range;
    c.right = range;
    c.top = range;
    c.bottom = -range;
    c.near = 1;
    c.far = 600;
    c.updateProjectionMatrix();
  }

  /** Advance time and update everything. focus = point the shadow camera follows (the car). */
  update(dt: number, focus: THREE.Vector3, cameraPos: THREE.Vector3): void {
    if (this.cycleMinutes > 0) this.hour = (this.hour + (dt / (this.cycleMinutes * 60)) * 24) % 24;
    const { elevation, azimuth } = solarPosition(this.dayOfYear, this.hour);
    const el = (elevation * Math.PI) / 180, az = (azimuth * Math.PI) / 180;
    const dir = this.state.dir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
    this.state.elevation = elevation;
    this.state.azimuth = azimuth;
    const night = 1 - smoothstep(-5, 7, elevation);
    this.state.night = night;
    this.sky.material.uniforms.sunPosition.value.copy(dir);
    this.stars.position.copy(cameraPos);

    // sun
    const day = smoothstep(-2, 8, elevation);
    const warm = 1 - smoothstep(2, 35, elevation);
    if (day > 0.02) {
      this.sun.color.setRGB(1, 0.93 - warm * 0.35, 0.84 - warm * 0.55);
      this.sun.intensity = day * (2.2 + 0.6 * smoothstep(10, 50, elevation)) * (1 - 0.2 * (this.smog - 1));
      this.sun.position.copy(focus).addScaledVector(dir, 300);
    } else {
      // the same light becomes the moon: high in the sky roughly opposite the sun, cool and dim
      this.moonDir.set(-dir.x, 0.8, -dir.z).normalize();
      this.sun.color.setRGB(0.55, 0.64, 1);
      this.sun.intensity = night * 0.35;
      this.sun.position.copy(focus).addScaledVector(this.moonDir, 300);
    }
    this.sun.target.position.copy(focus);
    // sky/ground fill
    const dusk = smoothstep(-6, 6, elevation) * (1 - smoothstep(6, 25, elevation));
    this.hemi.color.setRGB(0.62 - 0.4 * night + 0.25 * dusk, 0.7 - 0.45 * night + 0.05 * dusk, 0.85 - 0.5 * night - 0.1 * dusk);
    this.hemi.groundColor.setRGB(0.42 - 0.3 * night, 0.36 - 0.26 * night, 0.28 - 0.2 * night);
    // sky light lingers through twilight (the sky is still bright for ~30 min after sunset)
    this.hemi.intensity = 0.2 + 0.28 * day + 0.22 * smoothstep(-9, 2, elevation) * (1 - day);
    // smog/haze: yellow-grey by day, orange at dusk, sodium-tinged dark at night
    const fc = this.fog.color;
    fc.copy(this.dayC).lerp(this.duskC, dusk * 0.8).lerp(this.nightC, night);
    this.fog.density = (0.0005 + 0.00055 * this.smog) * (1 + night * 0.4);
    this.sky.material.uniforms.turbidity.value = 2.5 + 2.5 * this.smog;
    (this.stars.material as THREE.PointsMaterial).opacity = smoothstep(0.55, 1, night) * 0.9;
    // sky cubemap (background) when the sun moved; environment map (PMREM) less often
    this.skyTimer += dt;
    this.envTimer += dt;
    const turb = this.sky.material.uniforms.turbidity.value as number;
    if (Math.abs(elevation - this.lastSkyElevation) > 0.3 || turb !== this.lastSkyTurbidity || this.skyTimer > 10) {
      this.skyTimer = 0;
      this.lastSkyElevation = elevation;
      this.lastSkyTurbidity = turb;
      this.cubeCam.update(this.renderer, this.skyScene);
      if (Math.abs(elevation - this.lastEnvElevation) > 1.5 || this.envTimer > 30) this.captureEnv(night);
    }
  }

  private captureEnv(night: number): void {
    this.envTimer = 0;
    this.lastEnvElevation = this.state.elevation;
    const rt = this.pmrem.fromCubemap(this.cubeRT.texture);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.12 + 0.2 * (1 - night);
  }

  /** Suggested tone-mapping exposure for the current light. */
  get exposure(): number {
    // open up gradually from late afternoon through twilight into night
    const el = this.state.elevation;
    return 0.78 + 0.75 * (1 - smoothstep(-6, 14, el));
  }
}
