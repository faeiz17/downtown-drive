// 1 m occupancy raster used to place procedural plots and props without overlapping roads/buildings/parks.
import { EXTENT } from '../../src/data/geo';
import type { Pts } from '../../src/core/geom2d';

export const FREE = 0, ROAD = 1, BUILDING = 2, AREA = 3, PLOT = 4, PROP = 5;

export class Raster {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
  readonly ox = EXTENT.minX;
  readonly oz = EXTENT.minZ;
  constructor(public res = 1) {
    this.w = Math.ceil((EXTENT.maxX - EXTENT.minX) / res) + 1;
    this.h = Math.ceil((EXTENT.maxZ - EXTENT.minZ) / res) + 1;
    this.data = new Uint8Array(this.w * this.h);
  }
  ix(x: number): number {
    return Math.floor((x - this.ox) / this.res);
  }
  iz(z: number): number {
    return Math.floor((z - this.oz) / this.res);
  }
  get(x: number, z: number): number {
    const i = this.ix(x), j = this.iz(z);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return 255;
    return this.data[j * this.w + i];
  }
  set(x: number, z: number, v: number): void {
    const i = this.ix(x), j = this.iz(z);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return;
    this.data[j * this.w + i] = v;
  }

  /** Stamp a thick segment (capsule of radius r). Only overwrites FREE cells unless force. */
  stampSegment(ax: number, az: number, bx: number, bz: number, r: number, v: number, force = true): void {
    const x0 = this.ix(Math.min(ax, bx) - r), x1 = this.ix(Math.max(ax, bx) + r);
    const z0 = this.iz(Math.min(az, bz) - r), z1 = this.iz(Math.max(az, bz) + r);
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz || 1e-9;
    const r2 = r * r;
    for (let j = Math.max(0, z0); j <= Math.min(this.h - 1, z1); j++) {
      const pz = this.oz + (j + 0.5) * this.res;
      for (let i = Math.max(0, x0); i <= Math.min(this.w - 1, x1); i++) {
        const px = this.ox + (i + 0.5) * this.res;
        let t = ((px - ax) * dx + (pz - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - (ax + dx * t), ez = pz - (az + dz * t);
        if (ex * ex + ez * ez <= r2) {
          const k = j * this.w + i;
          if (force || this.data[k] === FREE) this.data[k] = v;
        }
      }
    }
  }

  stampPolyline(p: Pts, r: number, v: number, force = true): void {
    for (let i = 0; i + 3 < p.length; i += 2) this.stampSegment(p[i], p[i + 1], p[i + 2], p[i + 3], r, v, force);
  }

  /** Scanline polygon fill. */
  fillPolygon(ring: Pts, v: number, force = true): void {
    const n = ring.length / 2;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minZ = Math.min(minZ, ring[i * 2 + 1]);
      maxZ = Math.max(maxZ, ring[i * 2 + 1]);
    }
    const j0 = Math.max(0, this.iz(minZ)), j1 = Math.min(this.h - 1, this.iz(maxZ));
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const pz = this.oz + (j + 0.5) * this.res;
      xs.length = 0;
      for (let a = 0, b = n - 1; a < n; b = a++) {
        const za = ring[a * 2 + 1], zb = ring[b * 2 + 1];
        if (za > pz !== zb > pz) {
          const xa = ring[a * 2], xb = ring[b * 2];
          xs.push(xa + ((pz - za) / (zb - za)) * (xb - xa));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, this.ix(xs[k])), i1 = Math.min(this.w - 1, this.ix(xs[k + 1]));
        for (let i = i0; i <= i1; i++) {
          const idx = j * this.w + i;
          if (force || this.data[idx] === FREE) this.data[idx] = v;
        }
      }
    }
  }

  /** Fraction of non-free cells inside an oriented rectangle given by origin, axis u (unit) and extents. */
  rectOccupancy(ox: number, oz: number, ux: number, uz: number, lenU: number, lenV: number, step = 1): number {
    const vx = -uz, vz = ux; // left of u
    let occ = 0, tot = 0;
    for (let a = step / 2; a < lenU; a += step)
      for (let b = step / 2; b < lenV; b += step) {
        const x = ox + ux * a + vx * b, z = oz + uz * a + vz * b;
        tot++;
        if (this.get(x, z) !== FREE) occ++;
      }
    return tot ? occ / tot : 1;
  }

  fillRect(ox: number, oz: number, ux: number, uz: number, lenU: number, lenV: number, v: number): void {
    const vx = -uz, vz = ux;
    this.fillPolygon([ox, oz, ox + ux * lenU, oz + uz * lenU, ox + ux * lenU + vx * lenV, oz + uz * lenU + vz * lenV, ox + vx * lenV, oz + vz * lenV], v);
  }
}
