// Mesh accumulator for the car builder (runs in Node at build time; uses three.js math/geometry only).
import * as THREE from 'three';

export type Vec3 = [number, number, number];

export class Part {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  constructor(public name: string, public material: string) {}

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  v(p: Vec3, n: Vec3, u = 0, w = 0): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, w);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Quad with flat normal; winding chosen so the normal matches `want` (if given). */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, want?: Vec3, uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]): void {
    let n = normal(a, b, c);
    let flip = false;
    if (want && dot(n, want) < 0) {
      flip = true;
      n = [-n[0], -n[1], -n[2]];
    }
    const i0 = this.v(a, n, ...uvs[0]), i1 = this.v(b, n, ...uvs[1]), i2 = this.v(c, n, ...uvs[2]), i3 = this.v(d, n, ...uvs[3]);
    if (flip) this.idx.push(i0, i2, i1, i0, i3, i2);
    else this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  /** Append a three.js BufferGeometry, optionally transformed. */
  addGeometry(g: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    const geo = g.clone();
    if (m) geo.applyMatrix4(m);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const base = this.vertexCount;
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), uv = geo.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  /** Mirrored copy across the X=0 plane (left ↔ right). */
  mirrored(name: string): Part {
    const m = new Part(name, this.material);
    for (let i = 0; i < this.pos.length; i += 3) {
      m.pos.push(-this.pos[i], this.pos[i + 1], this.pos[i + 2]);
      m.nor.push(-this.nor[i], this.nor[i + 1], this.nor[i + 2]);
    }
    m.uv = this.uv.slice();
    for (let i = 0; i < this.idx.length; i += 3) m.idx.push(this.idx[i], this.idx[i + 2], this.idx[i + 1]);
    return m;
  }

  /** Append another part's geometry (same material assumed). */
  merge(o: Part): void {
    const base = this.vertexCount;
    this.pos.push(...o.pos);
    this.nor.push(...o.nor);
    this.uv.push(...o.uv);
    for (const i of o.idx) this.idx.push(base + i);
  }

  /** Translate all vertices (used to re-centre parts on their pivot). */
  translate(x: number, y: number, z: number): this {
    for (let i = 0; i < this.pos.length; i += 3) {
      this.pos[i] += x;
      this.pos[i + 1] += y;
      this.pos[i + 2] += z;
    }
    return this;
  }

  /** Recompute smooth normals for indexed geometry (welds by index only). */
  smoothNormals(): this {
    const n = new Float32Array(this.pos.length);
    for (let i = 0; i < this.idx.length; i += 3) {
      const a = this.idx[i], b = this.idx[i + 1], c = this.idx[i + 2];
      const pa: Vec3 = [this.pos[a * 3], this.pos[a * 3 + 1], this.pos[a * 3 + 2]];
      const pb: Vec3 = [this.pos[b * 3], this.pos[b * 3 + 1], this.pos[b * 3 + 2]];
      const pc: Vec3 = [this.pos[c * 3], this.pos[c * 3 + 1], this.pos[c * 3 + 2]];
      const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2];
      const vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // area weighted
      for (const k of [a, b, c]) {
        n[k * 3] += nx;
        n[k * 3 + 1] += ny;
        n[k * 3 + 2] += nz;
      }
    }
    for (let i = 0; i < n.length; i += 3) {
      const L = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      this.nor[i] = n[i] / L;
      this.nor[i + 1] = n[i + 1] / L;
      this.nor[i + 2] = n[i + 2] / L;
    }
    return this;
  }
}

export function normal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const L = Math.hypot(nx, ny, nz) || 1;
  return [nx / L, ny / L, nz / L];
}
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const norm = (a: Vec3): Vec3 => {
  const L = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / L, a[1] / L, a[2] / L];
};
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Build a thin strip along a polyline of surface points (with normals), offset outward. */
export function strip(part: Part, pts: Vec3[], nrms: Vec3[], width: number, offset: number, closed = false): void {
  const n = pts.length;
  if (n < 2) return;
  const L: Vec3[] = [], R: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], nm = nrms[i];
    const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const t = norm(sub(next, prev));
    const side = norm(cross(nm, t));
    const c = add(p, nm, offset);
    L.push(add(c, side, width / 2));
    R.push(add(c, side, -width / 2));
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const want = norm(add(nrms[i], nrms[j]));
    part.quad(L[i], L[j], R[j], R[i], want);
  }
}
