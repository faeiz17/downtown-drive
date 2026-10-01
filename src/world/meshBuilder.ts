// Accumulates triangles (position, normal, tile-uv, atlas cell, colour) and produces a BufferGeometry.
import * as THREE from 'three';
import type { Cell } from './atlas';

export type V3 = [number, number, number];

export class MeshBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  cell: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  /** optional collision triangle soup (positions only) */
  collide: number[] | null = null;
  private tint: V3 = [1, 1, 1];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  setTint(r: number, g: number, b: number): this {
    this.tint = [r, g, b];
    return this;
  }

  private vert(p: V3, n: V3, u: number, v: number, c: Cell): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.cell.push(c.u0, c.v0, c.du, c.dv);
    this.col.push(this.tint[0], this.tint[1], this.tint[2]);
    return i;
  }

  /** Quad from 4 corners (any winding); flipped if needed so the face normal matches `want`. uvs = 4 [u,v]. */
  quad(a: V3, b: V3, c: V3, d: V3, uvs: [number, number][], cell: Cell, want?: V3, collide = false): void {
    let n = faceNormal(a, b, c);
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) n = faceNormal(a, c, d); // first triangle degenerate
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) return; // fully degenerate quad: nothing to draw
    let flip = false;
    if (want && n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
      flip = true;
      n = [-n[0], -n[1], -n[2]];
    }
    const i0 = this.vert(a, n, uvs[0][0], uvs[0][1], cell);
    const i1 = this.vert(b, n, uvs[1][0], uvs[1][1], cell);
    const i2 = this.vert(c, n, uvs[2][0], uvs[2][1], cell);
    const i3 = this.vert(d, n, uvs[3][0], uvs[3][1], cell);
    if (flip) this.idx.push(i0, i2, i1, i0, i3, i2);
    else this.idx.push(i0, i1, i2, i0, i2, i3);
    if (collide && this.collide) this.collide.push(...a, ...b, ...c, ...a, ...c, ...d);
  }

  tri(a: V3, b: V3, c: V3, uvs: [number, number][], cell: Cell, want?: V3, collide = false): void {
    let n = faceNormal(a, b, c);
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) return; // degenerate
    let flip = false;
    if (want && n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
      flip = true;
      n = [-n[0], -n[1], -n[2]];
    }
    const i0 = this.vert(a, n, uvs[0][0], uvs[0][1], cell);
    const i1 = this.vert(b, n, uvs[1][0], uvs[1][1], cell);
    const i2 = this.vert(c, n, uvs[2][0], uvs[2][1], cell);
    if (flip) this.idx.push(i0, i2, i1);
    else this.idx.push(i0, i1, i2);
    if (collide && this.collide) this.collide.push(...a, ...b, ...c);
  }

  /**
   * Vertical wall from (ax,az) to (bx,bz) between y0..y1, facing outward normal `n` (horizontal).
   * uStart = distance offset along the facade (m) so textures continue around corners. vBase = y at v=0.
   */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, cell: Cell, nx: number, nz: number, uStart = 0, vBase = 0, collide = false): void {
    const L = Math.hypot(bx - ax, bz - az);
    const u0 = uStart / cell.sx, u1 = (uStart + L) / cell.sx;
    const v0 = (y0 - vBase) / cell.sy, v1 = (y1 - vBase) / cell.sy;
    this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], cell, [nx, 0, nz], collide);
  }

  /** Flat horizontal polygon (CCW or CW ring, open form) at height y; uv = world xz / cell size. */
  polygon(ring: number[], y: number, cell: Cell, up = true, collide = false, uvOffset: [number, number] = [0, 0]): void {
    const n = ring.length / 2;
    if (n < 3) return;
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(ring[i * 2], ring[i * 2 + 1]));
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      return;
    }
    const nrm: V3 = up ? [0, 1, 0] : [0, -1, 0];
    const base = this.pos.length / 3;
    for (let i = 0; i < n; i++) this.vert([ring[i * 2], y, ring[i * 2 + 1]], nrm, (ring[i * 2] + uvOffset[0]) / cell.sx, (ring[i * 2 + 1] + uvOffset[1]) / cell.sy, cell);
    for (const t of tris) {
      const a = t[0], b = t[1], c = t[2];
      // ensure winding gives +Y (or -Y) facing
      const ax = ring[a * 2], az = ring[a * 2 + 1], bx = ring[b * 2], bz = ring[b * 2 + 1], cx = ring[c * 2], cz = ring[c * 2 + 1];
      // normal.y of (b-a)×(c-a) = (bz-az)*(cx-ax) - (bx-ax)*(cz-az)
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const faceUp = ny > 0;
      if (faceUp === up) this.idx.push(base + a, base + b, base + c);
      else this.idx.push(base + a, base + c, base + b);
      if (collide && this.collide) this.collide.push(ax, y, az, bx, y, bz, cx, y, cz);
    }
  }

  /** Oriented box: base centre (x,z) at y0, size (w along local X, d along local Z, h), rotated by yaw. */
  box(x: number, z: number, y0: number, w: number, d: number, h: number, yaw: number, cell: Cell, cellTop?: Cell, collide = false, skipBottom = true): void {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
    const hw = w / 2, hd = d / 2;
    const corners = [P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd)];
    const y1 = y0 + h;
    let u = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      // local ring (-,-),(+,-),(+,+),(-,+) has positive shoelace area (and rotation keeps it), so the
      // outward normal is the left normal of each edge: (dz, -dx)
      const nx = (bz - az) / L, nz = -(bx - ax) / L;
      this.wall(ax, az, bx, bz, y0, y1, cell, nx, nz, u, y0, collide);
      u += L;
    }
    const top = cellTop ?? cell;
    this.quad(
      [corners[0][0], y1, corners[0][1]], [corners[1][0], y1, corners[1][1]], [corners[2][0], y1, corners[2][1]], [corners[3][0], y1, corners[3][1]],
      [[0, 0], [w / top.sx, 0], [w / top.sx, d / top.sy], [0, d / top.sy]], top, [0, 1, 0], collide,
    );
    if (!skipBottom)
      this.quad(
        [corners[0][0], y0, corners[0][1]], [corners[1][0], y0, corners[1][1]], [corners[2][0], y0, corners[2][1]], [corners[3][0], y0, corners[3][1]],
        [[0, 0], [w / top.sx, 0], [w / top.sx, d / top.sy], [0, d / top.sy]], top, [0, -1, 0],
      );
  }

  /** Box spanning a segment (a→b) with thickness t, from y0..y1 (walls, rails, curbs). */
  segmentBox(ax: number, az: number, bx: number, bz: number, t: number, y0: number, y1: number, cell: Cell, cellTop?: Cell, collide = false): void {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.01) return;
    const yaw = Math.atan2(bx - ax, bz - az); // local +Z along segment
    this.box((ax + bx) / 2, (az + bz) / 2, y0, t, L, y1 - y0, yaw, cell, cellTop, collide);
  }

  /**
   * Build up to four geometries split by triangle centroid around (cx, cz). Smaller bounds let the camera and the
   * shadow camera frustum-cull most of a 320 m chunk instead of drawing all of it.
   */
  buildQuadrants(cx: number, cz: number): THREE.BufferGeometry[] {
    const buckets: number[][] = [[], [], [], []];
    const p = this.pos, idx = this.idx;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const x = (p[a] + p[b] + p[c]) / 3, z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
      buckets[(x >= cx ? 1 : 0) + (z >= cz ? 2 : 0)].push(idx[t], idx[t + 1], idx[t + 2]);
    }
    const out: THREE.BufferGeometry[] = [];
    for (const tri of buckets) {
      if (!tri.length) continue;
      const remap = new Map<number, number>();
      const sub = new MeshBuilder();
      for (const v of tri) {
        let j = remap.get(v);
        if (j === undefined) {
          j = sub.pos.length / 3;
          remap.set(v, j);
          sub.pos.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
          sub.nor.push(this.nor[v * 3], this.nor[v * 3 + 1], this.nor[v * 3 + 2]);
          sub.uv.push(this.uv[v * 2], this.uv[v * 2 + 1]);
          sub.cell.push(this.cell[v * 4], this.cell[v * 4 + 1], this.cell[v * 4 + 2], this.cell[v * 4 + 3]);
          sub.col.push(this.col[v * 3], this.col[v * 3 + 1], this.col[v * 3 + 2]);
        }
        sub.idx.push(j);
      }
      const g = sub.build();
      if (g) out.push(g);
    }
    return out;
  }

  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('cell', new THREE.Float32BufferAttribute(this.cell, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export function faceNormal(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const L = Math.hypot(nx, ny, nz);
  if (L < 1e-10) return [0, 0, 0];
  nx /= L;
  ny /= L;
  nz /= L;
  return [nx, ny, nz];
}

/** Closed-ring mitred offset. Positive d = left of travel = OUTWARD for positive-area (CCW) rings; negative = inward. */
export function offsetRing(r: number[], d: number, miterLimit = 2.5): number[] {
  const n = r.length / 2;
  const out: number[] = new Array(r.length);
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n, q = (i + 1) % n;
    const ax = r[i * 2] - r[p * 2], az = r[i * 2 + 1] - r[p * 2 + 1];
    const bx = r[q * 2] - r[i * 2], bz = r[q * 2 + 1] - r[i * 2 + 1];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    const n1x = az / la, n1z = -ax / la, n2x = bz / lb, n2z = -bx / lb;
    let nx = n1x + n2x, nz = n1z + n2z;
    const L = Math.hypot(nx, nz) || 1;
    nx /= L;
    nz /= L;
    const cos = nx * n2x + nz * n2z;
    const sc = Math.min(miterLimit, 1 / Math.max(0.25, cos));
    out[i * 2] = r[i * 2] + nx * d * sc;
    out[i * 2 + 1] = r[i * 2 + 1] + nz * d * sc;
  }
  return out;
}
