// Road surface, markings, curbs, sidewalks, medians and roundabout islands.
// Stroke data is prepared once globally; each chunk emits the segments whose midpoints fall inside it.
import type { WorldData, Stroke, MedianStrip, Island } from '../data/types';
import { ROAD_CLASSES, isMajor } from '../data/roadClasses';
import { cumulative, sampleAt, offsetPolyline, leftNormal, convexHull } from '../core/geom2d';
import type { MeshBuilder, V3 } from './meshBuilder';
import type { WorldAtlas } from './atlas';

export const Y_ROAD = 0.03;
export const Y_MARK = 0.045;
export const Y_WALK = 0.17;
export const Y_MEDIAN = 0.2;
export const Y_VERGE = 0.02;

export interface StrokePrep {
  st: Stroke;
  cum: number[];
  L: number;
  left: number[]; // asphalt left edge (full length)
  right: number[];
  sub: number[]; // trimmed centreline (junction-free part)
  subCum: number[];
  subStart: number; // arc length of sub[0] along the stroke
  sides: { side: 1 | -1; inner: number[]; outer: number[]; kind: 'walk' | 'verge' }[];
  median?: { l: number[]; r: number[] };
}

/** Build the trimmed sub-polyline between arc lengths a..b (includes original vertices in range). */
export function subPolyline(pts: number[], cum: number[], a: number, b: number): number[] {
  if (b - a < 0.5) return [];
  const out: number[] = [];
  const pa = sampleAt(pts, cum, a);
  out.push(pa.x, pa.z);
  for (let i = 0; i < cum.length; i++) if (cum[i] > a + 0.05 && cum[i] < b - 0.05) out.push(pts[i * 2], pts[i * 2 + 1]);
  const pb = sampleAt(pts, cum, b);
  out.push(pb.x, pb.z);
  return out;
}

export function prepareStrokes(world: WorldData): StrokePrep[] {
  return world.strokes.map((st) => {
    const cum = cumulative(st.pts);
    const L = cum[cum.length - 1];
    const hw = st.width / 2;
    const left = offsetPolyline(st.pts, hw);
    const right = offsetPolyline(st.pts, -hw);
    const a = st.trimStart, b = L - st.trimEnd;
    const sub = subPolyline(st.pts, cum, a, b);
    const prep: StrokePrep = { st, cum, L, left, right, sub, subCum: sub.length ? cumulative(sub) : [0], subStart: a, sides: [] };
    if (sub.length >= 4 && st.cls !== 'service') {
      // roundabouts: skip the curb on the side facing the island (drawn separately)
      let islandSide = 0;
      if (world.edges[st.edges[0]]?.roundabout) {
        const mid = sampleAt(st.pts, cum, L / 2);
        let best = Infinity;
        for (const is of world.islands) {
          const d = Math.hypot(is.x - mid.x, is.z - mid.z);
          if (d < best && d < is.r + 40) {
            best = d;
            const [lx, lz] = leftNormal(mid.tx, mid.tz);
            islandSide = (is.x - mid.x) * lx + (is.z - mid.z) * lz > 0 ? 1 : -1;
          }
        }
      }
      for (const side of [1, -1] as const) {
        if (st.dual && st.medianSide === side) continue;
        if (side === islandSide) continue;
        if (st.sidewalk > 0) {
          prep.sides.push({ side, inner: offsetPolyline(sub, side * hw), outer: offsetPolyline(sub, side * (hw + st.sidewalk)), kind: 'walk' });
        } else if (st.cls === 'residential' || st.cls === 'link') {
          prep.sides.push({ side, inner: offsetPolyline(sub, side * hw), outer: offsetPolyline(sub, side * (hw + 0.25)), kind: 'verge' });
        }
      }
      if (st.median) {
        const ms = subPolyline(st.pts, cum, a + 3, b - 3);
        if (ms.length >= 4) prep.median = { l: offsetPolyline(ms, st.median / 2), r: offsetPolyline(ms, -st.median / 2) };
      }
    }
    return prep;
  });
}

type InChunk = (x: number, z: number) => boolean;

const UP: V3 = [0, 1, 0];

/** Asphalt ribbons + junction fills for a chunk. Asphalt uses world-space UVs so overlaps are seamless. */
export function emitAsphalt(b: MeshBuilder, preps: StrokePrep[], world: WorldData, inChunk: InChunk, atlasDummy: WorldAtlas): void {
  const cell = atlasDummy.cell('concrete'); // unused by asphalt material; required by builder
  const S = 7; // metres per texture repeat
  const uvOf = (x: number, z: number): [number, number] => [x / S, z / S];
  for (const p of preps) {
    const pts = p.st.pts;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const mx = (pts[i] + pts[i + 2]) / 2, mz = (pts[i + 1] + pts[i + 3]) / 2;
      if (!inChunk(mx, mz)) continue;
      const l0: V3 = [p.left[i], Y_ROAD, p.left[i + 1]], l1: V3 = [p.left[i + 2], Y_ROAD, p.left[i + 3]];
      const r0: V3 = [p.right[i], Y_ROAD, p.right[i + 1]], r1: V3 = [p.right[i + 2], Y_ROAD, p.right[i + 3]];
      b.quad(l0, r0, r1, l1, [uvOf(l0[0], l0[2]), uvOf(r0[0], r0[2]), uvOf(r1[0], r1[2]), uvOf(l1[0], l1[2])], cell, UP);
    }
  }
  // junction fills
  world.nodes.forEach((n, ni) => {
    if (n.edges.length < 3 || !inChunk(n.x, n.z)) return;
    const hull: [number, number][] = [];
    for (const ei of n.edges) {
      const e = world.edges[ei];
      const cum = cumulative(e.pts);
      const L = cum[cum.length - 1];
      const d = Math.min(L * 0.5, n.r + 0.5);
      const s = e.a === ni ? d : L - d;
      const sp = sampleAt(e.pts, cum, s);
      const [lx, lz] = leftNormal(sp.tx, sp.tz);
      const hw = e.width / 2;
      hull.push([sp.x + lx * hw, sp.z + lz * hw], [sp.x - lx * hw, sp.z - lz * hw]);
    }
    const h = convexHull(hull);
    if (h.length < 3) return;
    for (let k = 1; k + 1 < h.length; k++) {
      const a: V3 = [h[0][0], Y_ROAD + 0.001, h[0][1]], bb: V3 = [h[k][0], Y_ROAD + 0.001, h[k][1]], c: V3 = [h[k + 1][0], Y_ROAD + 0.001, h[k + 1][1]];
      b.tri(a, bb, c, [uvOf(a[0], a[2]), uvOf(bb[0], bb[2]), uvOf(c[0], c[2])], cell, UP);
    }
  });
}

const WHITE: [number, number, number] = [0.92, 0.92, 0.9];
const YELLOW: [number, number, number] = [0.95, 0.72, 0.08];

/** Lane markings, zebra crossings, stop lines. */
export function emitMarkings(b: MeshBuilder, preps: StrokePrep[], world: WorldData, inChunk: InChunk, atlas: WorldAtlas): void {
  const cell = atlas.cell('concrete');
  const line = (sub: number[], cum: number[], off: number, s0: number, s1: number, w: number, color: [number, number, number]) => {
    const a = sampleAt(sub, cum, s0), c = sampleAt(sub, cum, s1);
    if (!inChunk(a.x, a.z)) return;
    const [la, lza] = leftNormal(a.tx, a.tz), [lc, lzc] = leftNormal(c.tx, c.tz);
    const ax = a.x + la * off, az = a.z + lza * off, cx = c.x + lc * off, cz = c.z + lzc * off;
    const dx = cx - ax, dz = cz - az;
    const L = Math.hypot(dx, dz) || 1;
    const nx = (dz / L) * w * 0.5, nz = (-dx / L) * w * 0.5;
    b.setTint(color[0], color[1], color[2]);
    b.quad([ax + nx, Y_MARK, az + nz], [ax - nx, Y_MARK, az - nz], [cx - nx, Y_MARK, cz - nz], [cx + nx, Y_MARK, cz + nz], [[0, 0], [1, 0], [1, 1], [0, 1]], cell, UP);
  };
  for (const p of preps) {
    const st = p.st;
    if (!(isMajor(st.cls) || st.cls === 'link') || p.sub.length < 4) continue;
    const L = p.subCum[p.subCum.length - 1];
    if (L < 6) continue;
    const med = st.median ?? 0;
    const w = st.width - med;
    const lanes = Math.max(1, st.lanes);
    const dashed = (off: number, color = WHITE) => {
      for (let s = 2; s + 3 < L - 2; s += 9) line(p.sub, p.subCum, off, s, s + 3, 0.12, color);
    };
    const solid = (off: number, color = WHITE, width = 0.15) => {
      for (let s = 1; s < L - 1; s += 4) line(p.sub, p.subCum, off, s, Math.min(L - 1, s + 4), width, color);
    };
    if (st.oneway) {
      const lw = st.width / lanes;
      for (let k = 1; k < lanes; k++) dashed(st.width / 2 - k * lw);
      if (isMajor(st.cls)) {
        solid(st.width / 2 - 0.35, st.dual && st.medianSide === 1 ? YELLOW : WHITE);
        solid(-st.width / 2 + 0.35, st.dual && st.medianSide === -1 ? YELLOW : WHITE);
      }
    } else {
      const per = Math.max(1, Math.floor(lanes / 2));
      const lw = w / (per * 2);
      if (!med) {
        if (isMajor(st.cls)) dashed(0, st.cls === 'tertiary' ? WHITE : YELLOW);
      }
      for (let k = 1; k < per; k++) {
        dashed(med / 2 + k * lw);
        dashed(-(med / 2 + k * lw));
      }
      if (isMajor(st.cls) && st.cls !== 'tertiary') {
        solid(st.width / 2 - 0.35);
        solid(-st.width / 2 + 0.35);
      }
    }
  }
  // zebra crossings + stop lines at signalised junction approaches
  world.nodes.forEach((n, ni) => {
    if (n.signal === undefined) return;
    for (const ei of n.edges) {
      const e = world.edges[ei];
      const cum = cumulative(e.pts);
      const L = cum[cum.length - 1];
      if (L < n.r + 8) continue;
      const atStart = e.a === ni;
      const s0 = atStart ? n.r + 1 : L - n.r - 1;
      const dir = atStart ? 1 : -1;
      const sp = sampleAt(e.pts, cum, s0);
      if (!inChunk(sp.x, sp.z)) continue;
      const [lx, lz] = leftNormal(sp.tx, sp.tz);
      const hw = e.width / 2 - 0.3;
      b.setTint(WHITE[0], WHITE[1], WHITE[2]);
      // stripes parallel to the road, 0.5 m wide every 1 m across the carriageway, 3 m long
      for (let o = -hw + 0.25; o < hw - 0.25; o += 1.0) {
        const ax = sp.x + lx * o, az = sp.z + lz * o;
        const cx = ax + sp.tx * 3 * dir, cz = az + sp.tz * 3 * dir;
        const nx = lx * 0.25, nz = lz * 0.25;
        b.quad([ax + nx, Y_MARK, az + nz], [ax - nx, Y_MARK, az - nz], [cx - nx, Y_MARK, cz - nz], [cx + nx, Y_MARK, cz + nz], [[0, 0], [1, 0], [1, 1], [0, 1]], cell, UP);
      }
      // stop line for traffic approaching the junction (left-hand traffic: approach lanes are on the left when heading in)
      const sx = sp.x + sp.tx * 4.2 * dir, sz = sp.z + sp.tz * 4.2 * dir;
      const inSide = atStart ? -1 : 1; // lanes travelling toward the node are on the left of the inbound direction
      const o0 = e.oneway ? -hw : 0, o1 = e.oneway ? hw : hw * inSide;
      const a0 = Math.min(o0, o1), a1 = Math.max(o0, o1);
      const tx = sp.tx * 0.2, tz = sp.tz * 0.2;
      b.quad(
        [sx + lx * a0 - tx, Y_MARK, sz + lz * a0 - tz], [sx + lx * a1 - tx, Y_MARK, sz + lz * a1 - tz],
        [sx + lx * a1 + tx, Y_MARK, sz + lz * a1 + tz], [sx + lx * a0 + tx, Y_MARK, sz + lz * a0 + tz],
        [[0, 0], [1, 0], [1, 1], [0, 1]], cell, UP,
      );
    }
  });
  b.setTint(1, 1, 1);
}

/** Raised sidewalks with painted curbs, residential yellow curbs + grass verges, medians and islands (atlas builder). */
export function emitCurbs(b: MeshBuilder, preps: StrokePrep[], medians: MedianStrip[], islands: Island[], inChunk: InChunk, atlas: WorldAtlas): void {
  const pav = atlas.cell('pavers');
  const curb = atlas.cell('curb');
  const curbW = atlas.cell('curb_white');
  const curbY = atlas.cell('curb_yellow');
  const grass = atlas.cell('grass');
  const conc = atlas.cell('concrete');
  for (const p of preps) {
    const cum = p.subCum;
    for (const sd of p.sides) {
      const { inner, outer } = sd;
      const n = inner.length / 2;
      const walk = sd.kind === 'walk';
      const h = walk ? Y_WALK : 0.13;
      const curbCell = walk ? (p.st.cls === 'tertiary' ? curbW : curb) : curbY;
      for (let i = 0; i + 1 < n; i++) {
        const mx = (inner[i * 2] + inner[i * 2 + 2]) / 2, mz = (inner[i * 2 + 1] + inner[i * 2 + 3]) / 2;
        if (!inChunk(mx, mz)) continue;
        const u0 = cum[i], u1 = cum[i + 1];
        const I0: V3 = [inner[i * 2], h, inner[i * 2 + 1]], I1: V3 = [inner[i * 2 + 2], h, inner[i * 2 + 3]];
        const O0: V3 = [outer[i * 2], h, outer[i * 2 + 1]], O1: V3 = [outer[i * 2 + 2], h, outer[i * 2 + 3]];
        // road-facing curb face (normal points toward road centre = -side * leftNormal)
        const dx = I1[0] - I0[0], dz = I1[2] - I0[2];
        const Ls = Math.hypot(dx, dz) || 1;
        const lnx = dz / Ls, lnz = -dx / Ls;
        const toRoad: V3 = [-sd.side * lnx, 0, -sd.side * lnz];
        const cu0 = u0 / curbCell.sx, cu1 = u1 / curbCell.sx;
        b.quad([I0[0], Y_ROAD - 0.02, I0[2]], [I1[0], Y_ROAD - 0.02, I1[2]], I1, I0, [[cu0, 0], [cu1, 0], [cu1, 1], [cu0, 1]], curbCell, toRoad, true);
        if (walk) {
          // curb top band (0.25 m) + paved sidewalk
          const f = 0.25 / p.st.sidewalk;
          const C0: V3 = [I0[0] + (O0[0] - I0[0]) * f, h, I0[2] + (O0[2] - I0[2]) * f];
          const C1: V3 = [I1[0] + (O1[0] - I1[0]) * f, h, I1[2] + (O1[2] - I1[2]) * f];
          b.quad(I0, I1, C1, C0, [[cu0, 0], [cu1, 0], [cu1, 1], [cu0, 1]], curbCell, UP, true);
          b.quad(C0, C1, O1, O0, [[C0[0] / pav.sx, C0[2] / pav.sy], [C1[0] / pav.sx, C1[2] / pav.sy], [O1[0] / pav.sx, O1[2] / pav.sy], [O0[0] / pav.sx, O0[2] / pav.sy]], pav, UP, true);
          // back face (toward plots)
          b.quad([O0[0], 0, O0[2]], [O1[0], 0, O1[2]], O1, O0, [[u0 / conc.sx, 0], [u1 / conc.sx, 0], [u1 / conc.sx, h / conc.sy], [u0 / conc.sx, h / conc.sy]], conc, [-toRoad[0], 0, -toRoad[2]]);
        } else {
          b.quad(I0, I1, O1, O0, [[cu0, 0], [cu1, 0], [cu1, 1], [cu0, 1]], curbCell, UP, true);
          // grass verge beyond the curb (flat)
          const vx0 = O0[0] + (O0[0] - I0[0]) * 7.6, vz0 = O0[2] + (O0[2] - I0[2]) * 7.6;
          const vx1 = O1[0] + (O1[0] - I1[0]) * 7.6, vz1 = O1[2] + (O1[2] - I1[2]) * 7.6;
          b.quad([O0[0], Y_VERGE, O0[2]], [O1[0], Y_VERGE, O1[2]], [vx1, Y_VERGE, vz1], [vx0, Y_VERGE, vz0],
            [[O0[0] / grass.sx, O0[2] / grass.sy], [O1[0] / grass.sx, O1[2] / grass.sy], [vx1 / grass.sx, vz1 / grass.sy], [vx0 / grass.sx, vz0 / grass.sy]], grass, UP);
        }
      }
      // end caps
      if (walk && n >= 2) {
        for (const i of [0, n - 1]) {
          const ix = inner[i * 2], iz = inner[i * 2 + 1], ox = outer[i * 2], oz = outer[i * 2 + 1];
          if (!inChunk(ix, iz)) continue;
          const j = i === 0 ? 1 : n - 2;
          const tx = ix - inner[j * 2], tz = iz - inner[j * 2 + 1];
          b.quad([ix, 0, iz], [ox, 0, oz], [ox, h, oz], [ix, h, iz], [[0, 0], [1, 0], [1, 0.3], [0, 0.3]], curbCell, [tx, 0, tz], true);
        }
      }
    }
    if (p.median) emitStrip(b, p.median.l, p.median.r, inChunk, conc, curb, Y_MEDIAN);
  }
  for (const m of medians) emitStrip(b, m.l, m.r, inChunk, m.width >= 2.2 ? grass : conc, curb, Y_MEDIAN);
  for (const is of islands) {
    if (!inChunk(is.x, is.z)) continue;
    const seg = Math.max(16, Math.min(64, Math.round(is.r * 3)));
    const ring: number[] = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      ring.push(is.x + Math.cos(a) * is.r, is.z + Math.sin(a) * is.r);
    }
    b.polygon(ring, Y_MEDIAN + 0.05, grass, true, true);
    let u = 0;
    for (let k = 0; k < seg; k++) {
      const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[((k + 1) % seg) * 2], bz = ring[((k + 1) % seg) * 2 + 1];
      const nx = (ax + bx) / 2 - is.x, nz = (az + bz) / 2 - is.z;
      const L = Math.hypot(bx - ax, bz - az);
      b.wall(ax, az, bx, bz, 0, Y_MEDIAN + 0.05, curb, nx, nz, u, 0, true);
      u += L;
    }
  }
}

function emitStrip(b: MeshBuilder, l: number[], r: number[], inChunk: InChunk, top: ReturnType<WorldAtlas['cell']>, curb: ReturnType<WorldAtlas['cell']>, h: number) {
  const n = Math.min(l.length, r.length) / 2;
  let ul = 0, ur = 0;
  for (let i = 0; i + 1 < n; i++) {
    const L0: V3 = [l[i * 2], h, l[i * 2 + 1]], L1: V3 = [l[i * 2 + 2], h, l[i * 2 + 3]];
    const R0: V3 = [r[i * 2], h, r[i * 2 + 1]], R1: V3 = [r[i * 2 + 2], h, r[i * 2 + 3]];
    const segL = Math.hypot(L1[0] - L0[0], L1[2] - L0[2]), segR = Math.hypot(R1[0] - R0[0], R1[2] - R0[2]);
    const mx = (L0[0] + R1[0]) / 2, mz = (L0[2] + R1[2]) / 2;
    if (inChunk(mx, mz)) {
      b.quad(L0, L1, R1, R0, [[L0[0] / top.sx, L0[2] / top.sy], [L1[0] / top.sx, L1[2] / top.sy], [R1[0] / top.sx, R1[2] / top.sy], [R0[0] / top.sx, R0[2] / top.sy]], top, UP, true);
      // side faces point away from the strip centre
      const cx = (L0[0] + R0[0]) / 2, cz = (L0[2] + R0[2]) / 2;
      b.wall(L0[0], L0[2], L1[0], L1[2], 0, h, curb, L0[0] - cx, L0[2] - cz, ul, 0, true);
      b.wall(R0[0], R0[2], R1[0], R1[2], 0, h, curb, R0[0] - cx, R0[2] - cz, ur, 0, true);
      if (i === 0) {
        const tx = L0[0] - L1[0], tz = L0[2] - L1[2];
        b.wall(L0[0], L0[2], R0[0], R0[2], 0, h, curb, tx, tz, 0, 0, true);
      }
      if (i + 2 === n) {
        const tx = L1[0] - L0[0], tz = L1[2] - L0[2];
        b.wall(L1[0], L1[2], R1[0], R1[2], 0, h, curb, tx, tz, 0, 0, true);
      }
    }
    ul += segL;
    ur += segR;
  }
}

export function laneWidthOf(st: Stroke): number {
  return ROAD_CLASSES[st.cls].laneWidth;
}
