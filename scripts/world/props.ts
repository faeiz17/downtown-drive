// Street furniture placement: trees, streetlights, electricity poles, billboards.
import type { Area, Island, MedianStrip, Stroke } from '../../src/data/types';
import { TREE_TYPES } from '../../src/data/types';
import { RNG, hash32 } from '../../src/core/rng';
import { cumulative, sampleAt, leftNormal, pointInPolygon, bboxOf, signedArea, SpatialGrid } from '../../src/core/geom2d';
import { isMajor } from '../../src/data/roadClasses';
import { Raster, BUILDING, PROP } from './raster';
import { round1 } from './roads';

const r100 = (v: number) => Math.round(v * 100);

export function placeBillboards(strokes: Stroke[], landmarks: { name: string; x: number; z: number }[], raster: Raster): number[] {
  const out: number[] = [];
  let ad = 0;
  for (const st of strokes) {
    if (!isMajor(st.cls) || st.closed) continue;
    const cum = cumulative(st.pts);
    const L = cum[cum.length - 1];
    const rng = new RNG(hash32('bb', st.id));
    const busy = /main boulevard|mm alam|m\.m\. alam|ferozepur|firozpur|jail|canal|liberty|gurumangat/i.test(st.name ?? '');
    const spacing = busy ? 170 : st.cls === 'tertiary' ? 600 : 320;
    for (let s = st.trimStart + 20 + rng.range(0, spacing / 2); s < L - st.trimEnd - 15; s += spacing * rng.range(0.8, 1.2)) {
      const p = sampleAt(st.pts, cum, s);
      const nearChowk = landmarks.some((l) => Math.hypot(l.x - p.x, l.z - p.z) < 180);
      if (!busy && !nearChowk && !rng.chance(0.6)) continue;
      let side = rng.chance(0.5) ? 1 : -1;
      if (st.dual && st.medianSide === side) side = -side;
      const [lx, lz] = leftNormal(p.tx, p.tz);
      const off = st.width / 2 + (st.sidewalk || 2) + 2.2;
      const x = p.x + lx * side * off, z = p.z + lz * side * off;
      let ok = true;
      for (let a = -4; a <= 4 && ok; a += 2) for (let b = -2; b <= 2 && ok; b += 2) {
        const v = raster.get(x + p.tx * a + lx * b, z + p.tz * a + lz * b);
        if (v === BUILDING || v === PROP || v === 255) ok = false;
      }
      if (!ok) continue;
      raster.stampSegment(x - p.tx * 4, z - p.tz * 4, x + p.tx * 4, z + p.tz * 4, 2.5, PROP);
      // board faces oncoming traffic: perpendicular to road, slightly angled
      const face = Math.atan2(p.tx, p.tz) + Math.PI + side * 0.35;
      out.push(round1(x), round1(z), r100(face), ad++ % 16);
    }
  }
  return out;
}

export function placeTrees(
  strokes: Stroke[], medians: MedianStrip[], areas: Area[], treeRows: number[][],
  osmTrees: { x: number; z: number }[], raster: Raster,
): number[] {
  const out: number[] = [];
  const grid = new SpatialGrid<number>(8);
  const add = (x: number, z: number, type: number, scale: number, rng: RNG, minSpacing = 4.5) => {
    for (const i of grid.queryRadius(x, z, minSpacing)) {
      if (Math.hypot(out[i] - x, out[i + 1] - z) < minSpacing) return false;
    }
    const v = raster.get(x, z);
    if (v === BUILDING || v === 255 || v === PROP) return false;
    grid.insertPoint(out.length, x, z);
    out.push(round1(x), round1(z), type, Math.round(scale * 100), Math.round(rng.range(0, 360)));
    return true;
  };

  // street trees
  for (const st of strokes) {
    if (st.cls === 'service' || st.cls === 'link' || st.closed) continue;
    const rng = new RNG(hash32('trees', st.id));
    const cum = cumulative(st.pts);
    const L = cum[cum.length - 1];
    const major = isMajor(st.cls);
    for (const side of [1, -1]) {
      if (st.dual && st.medianSide === side) continue;
      const off = st.width / 2 + (st.sidewalk > 0 ? st.sidewalk * 0.55 : 1.4);
      const spacingMin = major ? 9 : 13, spacingMax = major ? 14 : 24;
      const prob = major ? 0.8 : 0.5;
      for (let s = st.trimStart + 6 + rng.range(0, 6); s < L - st.trimEnd - 6; s += rng.range(spacingMin, spacingMax)) {
        if (!rng.chance(prob)) continue;
        const p = sampleAt(st.pts, cum, s);
        const [lx, lz] = leftNormal(p.tx, p.tz);
        const x = p.x + lx * side * off, z = p.z + lz * side * off;
        const type = major ? rng.weighted([TREE_TYPES.broadleaf, TREE_TYPES.ashoka, TREE_TYPES.palm], [0.6, 0.25, 0.15]) : rng.weighted([TREE_TYPES.broadleaf, TREE_TYPES.ashoka, TREE_TYPES.palm], [0.72, 0.18, 0.1]);
        add(x, z, type, rng.range(0.8, 1.25), rng);
      }
    }
  }
  // median trees
  medians.forEach((m, mi) => {
    if (m.width < 2.2) return;
    const rng = new RNG(hash32('mtrees', mi));
    const c: number[] = [];
    for (let i = 0; i < m.l.length; i += 2) c.push((m.l[i] + m.r[i]) / 2, (m.l[i + 1] + m.r[i + 1]) / 2);
    const cum = cumulative(c);
    const L = cum[cum.length - 1];
    const wide = m.width > 6;
    for (let s = 4; s < L - 4; s += rng.range(7, 11)) {
      const p = sampleAt(c, cum, s);
      const type = wide ? rng.weighted([0, 1, 2, 3], [0.55, 0.2, 0.15, 0.1]) : rng.weighted([0, 1, 2], [0.4, 0.4, 0.2]);
      add(p.x, p.z, type, rng.range(0.85, 1.3), rng, 5);
      if (m.width > 12 && rng.chance(0.6)) {
        const [lx, lz] = leftNormal(p.tx, p.tz);
        const o = rng.range(-m.width / 3, m.width / 3);
        add(p.x + lx * o, p.z + lz * o, rng.weighted([0, 3], [0.7, 0.3]), rng.range(0.9, 1.4), rng, 6);
      }
    }
  });
  // park / grass / golf / cemetery / campus trees
  areas.forEach((a, ai) => {
    const density = { park: 1 / 110, golf: 1 / 420, grass: 1 / 220, cemetery: 1 / 140, campus: 1 / 320, pitch: 0, water: 0, parking: 1 / 600, plaza: 0 }[a.kind];
    if (!density) return;
    const area = Math.abs(signedArea(a.pts));
    const target = Math.min(3000, Math.round(area * density));
    const bb = bboxOf(a.pts);
    const rng = new RNG(hash32('atrees', ai));
    let placed = 0;
    for (let tries = 0; tries < target * 6 && placed < target; tries++) {
      const x = rng.range(bb.minX, bb.maxX), z = rng.range(bb.minZ, bb.maxZ);
      if (!pointInPolygon(x, z, a.pts)) continue;
      const v = raster.get(x, z);
      if (v === BUILDING || v === 1 /* road */) continue;
      const type = a.kind === 'golf' ? rng.weighted([0, 3, 2], [0.5, 0.35, 0.15]) : rng.weighted([0, 1, 2, 3], [0.5, 0.15, 0.15, 0.2]);
      if (add(x, z, type, rng.range(0.85, 1.45), rng, a.kind === 'golf' ? 9 : 6.5)) placed++;
    }
  });
  // OSM trees and tree rows
  const rng = new RNG(1234);
  for (const t of osmTrees) add(t.x, t.z, TREE_TYPES.broadleaf, rng.range(0.9, 1.3), rng, 2);
  for (const row of treeRows) {
    const cum = cumulative(row);
    const L = cum[cum.length - 1];
    for (let s = 0; s < L; s += 8) {
      const p = sampleAt(row, cum, s);
      add(p.x, p.z, rng.weighted([0, 2], [0.6, 0.4]), rng.range(0.9, 1.2), rng, 4);
    }
  }
  return out;
}

export function placeLamps(strokes: Stroke[], medians: MedianStrip[], islands: Island[], raster: Raster): number[] {
  const out: number[] = [];
  for (const st of strokes) {
    if (!isMajor(st.cls) && st.cls !== 'link') continue;
    if (st.closed) continue;
    const rng = new RNG(hash32('lamps', st.id));
    const cum = cumulative(st.pts);
    const L = cum[cum.length - 1];
    if (st.dual) continue; // dual carriageways are lit from the median strips below
    if (st.median) {
      for (let s = st.trimStart + 8; s < L - st.trimEnd - 8; s += 34) {
        const p = sampleAt(st.pts, cum, s);
        out.push(round1(p.x), round1(p.z), r100(Math.atan2(-p.tz, p.tx)), 1);
      }
      continue;
    }
    let side = rng.chance(0.5) ? 1 : -1;
    const spacing = st.cls === 'link' ? 40 : 32;
    for (let s = st.trimStart + 6; s < L - st.trimEnd - 6; s += spacing) {
      const p = sampleAt(st.pts, cum, s);
      const [lx, lz] = leftNormal(p.tx, p.tz);
      const off = st.width / 2 + 0.55;
      const x = p.x + lx * side * off, z = p.z + lz * side * off;
      if (raster.get(x, z) === BUILDING) continue;
      // arm (local +Z) points back across the road: -normal
      out.push(round1(x), round1(z), r100(Math.atan2(-lx * side, -lz * side)), 0);
      if (st.width > 9) side = -side; // wide roads: alternate sides
    }
  }
  for (const m of medians) {
    const c: number[] = [];
    for (let i = 0; i < m.l.length; i += 2) c.push((m.l[i] + m.r[i]) / 2, (m.l[i + 1] + m.r[i + 1]) / 2);
    const cum = cumulative(c);
    const L = cum[cum.length - 1];
    for (let s = 6; s < L - 4; s += 34) {
      const p = sampleAt(c, cum, s);
      // double-arm lamp: arms along local ±X, so align local X across the median (normal)
      out.push(round1(p.x), round1(p.z), r100(Math.atan2(-p.tz, p.tx)), 1);
    }
  }
  for (const is of islands) out.push(is.x, is.z, 0, 3); // high-mast light on roundabout islands
  return out;
}

export function placePoles(strokes: Stroke[], raster: Raster): number[] {
  const out: number[] = [];
  let chain = 0;
  for (const st of strokes) {
    if (!(st.cls === 'residential' || st.cls === 'tertiary') || st.closed) continue;
    const rng = new RNG(hash32('poles', st.id));
    const cum = cumulative(st.pts);
    const L = cum[cum.length - 1];
    if (L < 30) continue;
    const side = rng.chance(0.5) ? 1 : -1;
    if (st.dual && st.medianSide === side) continue;
    const off = st.width / 2 + (st.sidewalk > 0 ? st.sidewalk - 0.4 : 0.9);
    for (let s = st.trimStart + 3 + rng.range(0, 8); s < L - st.trimEnd - 2; s += rng.range(32, 40)) {
      const p = sampleAt(st.pts, cum, s);
      const [lx, lz] = leftNormal(p.tx, p.tz);
      const x = p.x + lx * side * off, z = p.z + lz * side * off;
      const v = raster.get(x, z);
      if (v === BUILDING || v === 255) {
        chain++;
        continue;
      }
      // pole local +Z (lamp arm) points towards the road centre; crossarm along local X (along the road)
      const rot = Math.atan2(-lx * side, -lz * side);
      out.push(round1(x), round1(z), r100(rot), chain, rng.chance(0.55) ? 1 : 0, rng.chance(0.07) ? 1 : 0);
    }
    chain++;
  }
  return out;
}

