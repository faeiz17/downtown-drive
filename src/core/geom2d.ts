// 2D geometry helpers on the ground plane (x, z). Polylines/polygons are flat number arrays [x0,z0,x1,z1,...].

export type Pts = number[];

export function len2(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(bx - ax, bz - az);
}

export function polylineLength(p: Pts): number {
  let L = 0;
  for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return L;
}

/** Cumulative arc length at each vertex. */
export function cumulative(p: Pts): number[] {
  const out = [0];
  for (let i = 2; i < p.length; i += 2) out.push(out[out.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
  return out;
}

export interface Sample {
  x: number;
  z: number;
  tx: number; // unit tangent
  tz: number;
  seg: number;
}

/** Point + tangent at arc length s (clamped). `cum` from cumulative(). */
export function sampleAt(p: Pts, cum: number[], s: number): Sample {
  const n = cum.length;
  if (n < 2) return { x: p[0], z: p[1], tx: 1, tz: 0, seg: 0 };
  s = Math.max(0, Math.min(cum[n - 1], s));
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi] - cum[lo] || 1e-9;
  const t = (s - cum[lo]) / segLen;
  const ax = p[lo * 2],
    az = p[lo * 2 + 1],
    bx = p[hi * 2],
    bz = p[hi * 2 + 1];
  const dx = bx - ax,
    dz = bz - az;
  const L = Math.hypot(dx, dz) || 1e-9;
  return { x: ax + dx * t, z: az + dz * t, tx: dx / L, tz: dz / L, seg: lo };
}

/** Left normal of tangent (tx,tz) in X-east/Z-south coords, looking from above (+Y).
 *  "Left" relative to direction of travel: rotate tangent by +90° about +Y → (tz, -tx). */
export function leftNormal(tx: number, tz: number): [number, number] {
  return [tz, -tx];
}

/**
 * Offset a polyline sideways by `d` (positive = left of travel direction) with mitred joins.
 * Miter length is limited to avoid spikes at sharp corners.
 */
export function offsetPolyline(p: Pts, d: number, miterLimit = 3): Pts {
  const n = p.length / 2;
  const out: Pts = new Array(p.length);
  if (n < 2) return p.slice();
  for (let i = 0; i < n; i++) {
    let nx = 0,
      nz = 0;
    if (i > 0) {
      const dx = p[i * 2] - p[i * 2 - 2],
        dz = p[i * 2 + 1] - p[i * 2 - 1];
      const L = Math.hypot(dx, dz) || 1;
      nx += dz / L;
      nz += -dx / L;
    }
    if (i < n - 1) {
      const dx = p[i * 2 + 2] - p[i * 2],
        dz = p[i * 2 + 3] - p[i * 2 + 1];
      const L = Math.hypot(dx, dz) || 1;
      nx += dz / L;
      nz += -dx / L;
    }
    let L = Math.hypot(nx, nz);
    if (L < 1e-6) {
      nx = 0;
      nz = 0;
      L = 1;
    }
    nx /= L;
    nz /= L;
    // miter scale = 1 / cos(half angle)
    let scale = 1;
    if (i > 0 && i < n - 1) {
      const dx = p[i * 2 + 2] - p[i * 2],
        dz = p[i * 2 + 3] - p[i * 2 + 1];
      const Ls = Math.hypot(dx, dz) || 1;
      const sn = dz / Ls,
        sz = -dx / Ls;
      const cos = nx * sn + nz * sz;
      scale = Math.min(miterLimit, 1 / Math.max(0.2, cos));
    }
    out[i * 2] = p[i * 2] + nx * d * scale;
    out[i * 2 + 1] = p[i * 2 + 1] + nz * d * scale;
  }
  return out;
}

export function distPointSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax,
    dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function projectPointSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { t: number; x: number; z: number; d: number } {
  const dx = bx - ax,
    dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + dx * t,
    z = az + dz * t;
  return { t, x, z, d: Math.hypot(px - x, pz - z) };
}

/** Closest point on polyline. Returns arc length too. */
export function closestOnPolyline(p: Pts, px: number, pz: number): { x: number; z: number; d: number; s: number; seg: number } {
  let best = { x: p[0], z: p[1], d: Infinity, s: 0, seg: 0 };
  let acc = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const r = projectPointSeg(px, pz, p[i], p[i + 1], p[i + 2], p[i + 3]);
    const segLen = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (r.d < best.d) best = { x: r.x, z: r.z, d: r.d, s: acc + r.t * segLen, seg: i / 2 };
    acc += segLen;
  }
  return best;
}

export function segIntersect(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Signed area (positive = counter-clockwise in the x/z shoelace sense). Ring is open (no repeated first point). */
export function signedArea(r: Pts): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return a / 2;
}

export function reverseRing(r: Pts): Pts {
  const out: Pts = [];
  for (let i = r.length / 2 - 1; i >= 0; i--) out.push(r[i * 2], r[i * 2 + 1]);
  return out;
}

export function centroid(r: Pts): [number, number] {
  let cx = 0,
    cz = 0,
    a = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const f = r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
    cx += (r[i * 2] + r[j * 2]) * f;
    cz += (r[i * 2 + 1] + r[j * 2 + 1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0,
      sz = 0;
    for (let i = 0; i < n; i++) {
      sx += r[i * 2];
      sz += r[i * 2 + 1];
    }
    return [sx / n, sz / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function pointInPolygon(px: number, pz: number, r: Pts): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2],
      zi = r[i * 2 + 1],
      xj = r[j * 2],
      zj = r[j * 2 + 1];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Douglas–Peucker simplification for open polylines (or rings, treated as open). */
export function simplify(p: Pts, tol: number): Pts {
  const n = p.length / 2;
  if (n <= 2) return p.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = -1,
      idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distPointSeg(p[i * 2], p[i * 2 + 1], p[a * 2], p[a * 2 + 1], p[b * 2], p[b * 2 + 1]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: Pts = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

export function bboxOf(p: Pts): { minX: number; minZ: number; maxX: number; maxZ: number } {
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < minX) minX = p[i];
    if (p[i] > maxX) maxX = p[i];
    if (p[i + 1] < minZ) minZ = p[i + 1];
    if (p[i + 1] > maxZ) maxZ = p[i + 1];
  }
  return { minX, minZ, maxX, maxZ };
}

export function convexHull(points: [number, number][]): [number, number][] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Uniform grid spatial index over arbitrary items with bounding boxes. */
export class SpatialGrid<T> {
  private cells = new Map<number, T[]>();
  constructor(public cellSize: number) {}
  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }
  insert(item: T, minX: number, minZ: number, maxX: number, maxZ: number): void {
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs),
      x1 = Math.floor(maxX / cs),
      z0 = Math.floor(minZ / cs),
      z1 = Math.floor(maxZ / cs);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(item);
      }
  }
  insertPoint(item: T, x: number, z: number): void {
    this.insert(item, x, z, x, z);
  }
  /** Unique items whose cells overlap the query box. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: T[] = []): T[] {
    const cs = this.cellSize;
    const seen = new Set<T>();
    const x0 = Math.floor(minX / cs),
      x1 = Math.floor(maxX / cs),
      z0 = Math.floor(minZ / cs),
      z1 = Math.floor(maxZ / cs);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const c = this.cells.get(this.key(ix, iz));
        if (!c) continue;
        for (const it of c)
          if (!seen.has(it)) {
            seen.add(it);
            out.push(it);
          }
      }
    return out;
  }
  queryRadius(x: number, z: number, r: number, out: T[] = []): T[] {
    return this.query(x - r, z - r, x + r, z + r, out);
  }

  /** For grids where every item was inserted as a single point: no de-duplication Set, no allocation. */
  queryPoints(x: number, z: number, r: number, out: T[]): T[] {
    out.length = 0;
    const cs = this.cellSize;
    const x0 = Math.floor((x - r) / cs), x1 = Math.floor((x + r) / cs), z0 = Math.floor((z - r) / cs), z1 = Math.floor((z + r) / cs);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const c = this.cells.get(this.key(ix, iz));
        if (c) for (let k = 0; k < c.length; k++) out.push(c[k]);
      }
    return out;
  }

  /** Empty all cells but keep their arrays (reused every frame without garbage). */
  clear(): void {
    for (const c of this.cells.values()) c.length = 0;
  }
}
