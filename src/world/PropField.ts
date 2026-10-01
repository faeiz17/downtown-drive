// Instanced props with CPU distance culling and two LOD levels. One InstancedMesh per (LOD, model) → few draw calls.
// Shadow casting is limited to an inner ring (shadowRadius): instanced meshes are not frustum-culled per instance,
// so without the split every near instance would be drawn into the sun's shadow map every frame.
import * as THREE from 'three';

export interface PropFieldOptions {
  near: THREE.BufferGeometry;
  far?: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  farMaterial?: THREE.Material | THREE.Material[];
  nearRadius: number;
  farRadius: number;
  castShadow?: boolean;
  /** only instances within this radius cast shadows (default: all near instances if castShadow) */
  shadowRadius?: number;
  maxNear?: number;
  maxFar?: number;
}

const CELL = 64;

/** Instances stored as [x, y, z, yaw, scale] */
export class PropField {
  readonly group = new THREE.Group();
  readonly nearMesh: THREE.InstancedMesh;
  readonly shadowMesh: THREE.InstancedMesh | null;
  readonly farMesh: THREE.InstancedMesh | null;
  shadowRadius: number;
  private data: Float32Array;
  private count: number;
  private grid = new Map<number, number[]>();
  private lastX = Infinity;
  private lastZ = Infinity;
  nearRadius: number;
  farRadius: number;

  constructor(instances: number[] | Float32Array, opts: PropFieldOptions) {
    this.data = instances instanceof Float32Array ? instances : new Float32Array(instances);
    this.count = this.data.length / 5;
    this.nearRadius = opts.nearRadius;
    this.farRadius = opts.farRadius;
    for (let i = 0; i < this.count; i++) {
      const k = this.key(Math.floor(this.data[i * 5] / CELL), Math.floor(this.data[i * 5 + 2] / CELL));
      let c = this.grid.get(k);
      if (!c) this.grid.set(k, (c = []));
      c.push(i);
    }
    const maxNear = Math.min(this.count, opts.maxNear ?? 4000) || 1;
    this.nearMesh = new THREE.InstancedMesh(opts.near, opts.material, maxNear);
    this.nearMesh.count = 0;
    this.nearMesh.frustumCulled = false;
    this.shadowRadius = opts.castShadow ? opts.shadowRadius ?? Infinity : 0;
    const split = !!opts.castShadow && isFinite(this.shadowRadius);
    this.nearMesh.castShadow = !!opts.castShadow && !split;
    this.nearMesh.receiveShadow = true;
    this.nearMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.nearMesh);
    if (split) {
      this.shadowMesh = new THREE.InstancedMesh(opts.near, opts.material, Math.min(maxNear, 1500));
      this.shadowMesh.count = 0;
      this.shadowMesh.frustumCulled = false;
      this.shadowMesh.castShadow = true;
      this.shadowMesh.receiveShadow = true;
      this.shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(this.shadowMesh);
    } else this.shadowMesh = null;
    if (opts.far) {
      const maxFar = Math.min(this.count, opts.maxFar ?? 12000) || 1;
      this.farMesh = new THREE.InstancedMesh(opts.far, opts.farMaterial ?? opts.material, maxFar);
      this.farMesh.count = 0;
      this.farMesh.frustumCulled = false;
      this.farMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(this.farMesh);
    } else this.farMesh = null;
  }

  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  get total(): number {
    return this.count;
  }

  instance(i: number): [number, number, number, number, number] {
    const d = this.data;
    return [d[i * 5], d[i * 5 + 1], d[i * 5 + 2], d[i * 5 + 3], d[i * 5 + 4]];
  }

  /** Indices of instances within radius r of (x, z). */
  queryRadius(x: number, z: number, r: number, out: number[] = []): number[] {
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    const r2 = r * r;
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const c = this.grid.get(this.key(i, j));
        if (!c) continue;
        for (const k of c) {
          const dx = this.data[k * 5] - x, dz = this.data[k * 5 + 2] - z;
          if (dx * dx + dz * dz <= r2) out.push(k);
        }
      }
    return out;
  }

  setRadii(near: number, far: number, shadow?: number): void {
    this.nearRadius = near;
    this.farRadius = far;
    if (shadow !== undefined && this.shadowMesh) this.shadowRadius = shadow;
    this.lastX = Infinity;
  }

  update(x: number, z: number, force = false): void {
    if (!force && Math.hypot(x - this.lastX, z - this.lastZ) < 10) return;
    this.lastX = x;
    this.lastZ = z;
    const nearR2 = this.nearRadius * this.nearRadius;
    const shadowR2 = this.shadowMesh ? this.shadowRadius * this.shadowRadius : -1;
    const sArr = this.shadowMesh ? (this.shadowMesh.instanceMatrix.array as Float32Array) : null;
    const maxS = this.shadowMesh ? this.shadowMesh.instanceMatrix.count : 0;
    let ns = 0;
    const farR = this.farMesh ? this.farRadius : this.nearRadius;
    const farR2 = farR * farR;
    const nArr = this.nearMesh.instanceMatrix.array as Float32Array;
    const fArr = this.farMesh ? (this.farMesh.instanceMatrix.array as Float32Array) : null;
    const maxN = this.nearMesh.instanceMatrix.count, maxF = this.farMesh ? this.farMesh.instanceMatrix.count : 0;
    let nn = 0, nf = 0;
    const i0 = Math.floor((x - farR) / CELL), i1 = Math.floor((x + farR) / CELL);
    const j0 = Math.floor((z - farR) / CELL), j1 = Math.floor((z + farR) / CELL);
    const d = this.data;
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const c = this.grid.get(this.key(i, j));
        if (!c) continue;
        for (const k of c) {
          const px = d[k * 5], pz = d[k * 5 + 2];
          const dx = px - x, dz = pz - z;
          const d2 = dx * dx + dz * dz;
          if (d2 > farR2) continue;
          const yaw = d[k * 5 + 3], s = d[k * 5 + 4];
          const cs = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
          let arr: Float32Array, o: number;
          if (sArr && d2 <= shadowR2 && ns < maxS) {
            arr = sArr;
            o = ns++ * 16;
          } else if (d2 <= nearR2 && nn < maxN) {
            arr = nArr;
            o = nn++ * 16;
          } else if (fArr && nf < maxF) {
            arr = fArr;
            o = nf++ * 16;
          } else continue;
          arr[o] = cs; arr[o + 1] = 0; arr[o + 2] = -sn; arr[o + 3] = 0;
          arr[o + 4] = 0; arr[o + 5] = s; arr[o + 6] = 0; arr[o + 7] = 0;
          arr[o + 8] = sn; arr[o + 9] = 0; arr[o + 10] = cs; arr[o + 11] = 0;
          arr[o + 12] = px; arr[o + 13] = d[k * 5 + 1]; arr[o + 14] = pz; arr[o + 15] = 1;
        }
      }
    this.nearMesh.count = nn;
    this.nearMesh.instanceMatrix.needsUpdate = true;
    if (this.shadowMesh) {
      this.shadowMesh.count = ns;
      this.shadowMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.farMesh) {
      this.farMesh.count = nf;
      this.farMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
