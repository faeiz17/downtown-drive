// Runtime wrapper around lancer.glb: wheels (spin/steer/suspension), steering wheel, lights, indicators, decals.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { plateTexture, badgeTextures, tireLetteringTexture } from './decals';
import { SPEC } from './spec';

export interface LightState {
  head: boolean;
  brake: boolean;
  reverse: boolean;
  indicatorLeft: boolean;
  indicatorRight: boolean;
}

const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'] as const;

export async function loadLancerGltf(url: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  return gltf.scene;
}

export class CarVisual {
  readonly root: THREE.Group;
  readonly mounts: THREE.Object3D[] = [];
  readonly steerPivots: (THREE.Object3D | null)[] = [];
  readonly wheels: THREE.Object3D[] = [];
  private steeringWheel: THREE.Object3D | null;
  private mats: Record<string, THREE.MeshStandardMaterial[]> = {};
  private blinkT = 0;
  readonly headlights: THREE.SpotLight[] = [];
  readonly lights: LightState = { head: false, brake: false, reverse: false, indicatorLeft: false, indicatorRight: false };
  private baseY: number[] = [];
  private spin = [0, 0, 0, 0];
  night = 0;

  constructor(gltfScene: THREE.Group) {
    this.root = gltfScene;
    const get = (n: string) => this.root.getObjectByName(n) ?? null;
    for (const w of WHEEL_NAMES) {
      const m = get(`WheelMount_${w}`)!;
      this.mounts.push(m);
      this.baseY.push(m.position.y);
      this.steerPivots.push(get(`SteerPivot_${w}`));
      this.wheels.push(get(`Wheel_${w}`)!);
    }
    this.steeringWheel = get('SteeringWheel');

    // separate emissive materials per light group & side so they toggle independently
    const group = (key: string, names: string[]) => {
      const list: THREE.MeshStandardMaterial[] = [];
      for (const n of names) {
        const o = get(n);
        o?.traverse((c) => {
          const mesh = c as THREE.Mesh;
          if (!mesh.isMesh) return;
          const m = (mesh.material as THREE.MeshStandardMaterial).clone();
          m.emissiveIntensity = 0;
          mesh.material = m;
          list.push(m);
        });
      }
      this.mats[key] = list;
    };
    group('head', ['Headlight_L', 'Headlight_R']);
    group('tail', ['TailLight_L', 'TailLight_R']);
    group('brake', ['BrakeLight_L', 'BrakeLight_R']);
    group('reverse', ['ReverseLight_L', 'ReverseLight_R']);
    group('indL', ['Indicator_FL', 'Indicator_RL', 'Indicator_SL']);
    group('indR', ['Indicator_FR', 'Indicator_RR', 'Indicator_SR']);
    group('gauges', ['Gauges']);

    // decals
    const plate = plateTexture();
    for (const n of ['Plate_Front', 'Plate_Rear']) {
      const mesh = get(n) as THREE.Mesh | null;
      if (mesh?.isMesh) {
        const m = (mesh.material as THREE.MeshStandardMaterial).clone();
        m.map = plate;
        m.needsUpdate = true;
        mesh.material = m;
      }
    }
    const badges = badgeTextures();
    for (const [n, t] of Object.entries(badges)) {
      const mesh = get(n) as THREE.Mesh | null;
      if (mesh?.isMesh) {
        const m = (mesh.material as THREE.MeshStandardMaterial).clone();
        m.map = t;
        m.transparent = true;
        m.alphaTest = 0.35;
        m.depthWrite = false;
        m.metalness = 0.85;
        m.roughness = 0.2;
        m.polygonOffset = true;
        m.polygonOffsetFactor = -2;
        m.needsUpdate = true;
        mesh.material = m;
      }
    }
    const tireTex = tireLetteringTexture();
    this.root.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mm of mats as THREE.MeshStandardMaterial[]) {
        if (mm.name === 'TireLettering') {
          mm.map = tireTex;
          mm.transparent = true;
          mm.alphaTest = 0.3;
          mm.depthWrite = false;
          mm.polygonOffset = true;
          mm.polygonOffsetFactor = -2;
          mm.needsUpdate = true;
        }
        if (mm.name.startsWith('Glass') || mm.name === 'LensClear' || mm.name === 'Visor') {
          mm.transparent = true;
          mm.depthWrite = false;
          mm.envMapIntensity = 0.8;
          // a touch of roughness keeps the sun's reflection from being a single-pixel HDR spike
          // (Renderer's sanitize pass clamps what is left before bloom)
          if (mm.name !== 'LensClear') mm.roughness = Math.max(mm.roughness, 0.06);
        }
        const pm = mm as THREE.MeshPhysicalMaterial;
        if (pm.isMeshPhysicalMaterial && pm.clearcoat > 0) pm.clearcoatRoughness = Math.max(pm.clearcoatRoughness, 0.08);
        if (mm.name === 'Paint') mm.envMapIntensity = 0.9;
        if (mm.name === 'LensClear') {
          mm.roughness = 0.18;
          mm.color.set(0x8e979e);
        }
        if (mm.name === 'Chrome' || mm.name === 'Reflector' || mm.name === 'Mirror') {
          mm.envMapIntensity = 1.0;
          mm.roughness = Math.max(mm.roughness, 0.12);
        }
      }
      mesh.castShadow = !(mesh.name.startsWith('Glass') || mesh.name.includes('Lens') || mesh.name.startsWith('Visor'));
      mesh.receiveShadow = true;
    });
    // render transparent glass after the opaque car
    for (const o of this.root.children) if (o.name.startsWith('Glass') || o.name.includes('Lens') || o.name.startsWith('Visor')) o.renderOrder = 3;

    // One spot light for both beams (every dynamic light costs per-pixel shading everywhere on screen; the lamps
    // themselves are emissive). It sits just ahead of the bumper so it lights the road, not the chrome bowls.
    const s = new THREE.SpotLight(0xfff1d8, 0, 70, 0.6, 0.7, 1.5);
    s.position.set(0, 0.62, 2.45);
    s.target.position.set(0, 0.15, 24);
    this.root.add(s, s.target);
    this.headlights.push(s);
  }

  /** Wheel i: spin angle (rad, forward roll positive), steer angle (rad, +left), suspension offset (m, +up). */
  setWheel(i: number, spinDelta: number, steer: number, suspension: number): void {
    this.spin[i] += spinDelta;
    const w = this.wheels[i];
    // right wheels were rotated 180° about Y, so their local X points the other way
    const sign = i % 2 === 0 ? 1 : -1;
    w.rotation.x = this.spin[i] * sign;
    const sp = this.steerPivots[i];
    if (sp) sp.rotation.y = steer;
    this.mounts[i].position.y = this.baseY[i] + suspension;
  }

  setSteeringWheel(angle: number): void {
    if (this.steeringWheel) this.steeringWheel.rotation.z = angle;
  }

  setHeadlightShadows(on: boolean): void {
    this.headlights[0].castShadow = on;
    this.headlights[0].shadow.mapSize.set(1024, 1024);
  }

  update(dt: number): void {
    this.blinkT += dt;
    const blinkOn = (this.blinkT % 0.8) < 0.45;
    const L = this.lights;
    const set = (key: string, v: number) => {
      for (const m of this.mats[key] ?? []) m.emissiveIntensity = v;
    };
    set('head', L.head ? 2.2 : 0);
    set('tail', L.head ? 0.7 : 0);
    set('brake', L.brake ? 3.5 : L.head ? 0.45 : 0);
    set('reverse', L.reverse ? 2.2 : 0);
    set('indL', L.indicatorLeft && blinkOn ? 2.4 : 0);
    set('indR', L.indicatorRight && blinkOn ? 2.4 : 0);
    set('gauges', L.head ? 0.35 : 0);
    for (const s of this.headlights) s.intensity = L.head ? 70 : 0;
  }

  get blinkPhase(): boolean {
    return (this.blinkT % 0.8) < 0.45;
  }
}

export const CAR_DIMENSIONS = SPEC;
