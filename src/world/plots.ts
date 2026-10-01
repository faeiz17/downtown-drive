// Deterministic layout of procedural plots (Lahore kothis with boundary walls & gates, or commercial plazas).
import { PLOT_STRIDE, type WorldData } from '../data/types';
import { RNG } from '../core/rng';

export interface PlotLayout {
  x: number;
  z: number;
  angle: number;
  F: number;
  D: number;
  commercial: boolean;
  floors: number;
  seed: number;
  /** building footprint (world, CCW open ring) */
  ring: number[];
  height: number;
  facade: number; // index into style list (resolved by the mesher)
  roof: 'flat' | 'hip';
  roofTile: number;
  mumty: { x: number; z: number; yaw: number } | null;
  walls: [number, number, number, number][]; // world segments
  wallH: number;
  wallStyle: number;
  gate: { x: number; z: number; yaw: number; w: number; style: number } | null;
  pillars: { x: number; z: number }[];
  porch: { ring: number[]; y: number; pillars: { x: number; z: number }[] } | null;
  lawn: number[] | null;
  paving: number[] | null;
  pavingKind: 'pavers' | 'pavers_red' | 'concrete';
  trees: { x: number; z: number; type: number; scale: number }[];
  tanks: { x: number; y: number; z: number; s: number }[];
  solar: { x: number; y: number; z: number; yaw: number }[];
  front: [number, number, number, number]; // world segment of the road-facing facade (for signs)
  tint: [number, number, number];
}

export function layoutPlots(world: WorldData): PlotLayout[] {
  const out: PlotLayout[] = [];
  const p = world.plots;
  for (let i = 0; i < p.length; i += PLOT_STRIDE) {
    out.push(layoutPlot(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5] === 1, p[i + 6], p[i + 7]));
  }
  return out;
}

export function layoutPlot(px: number, pz: number, angle: number, F: number, D: number, commercial: boolean, floors: number, seed: number): PlotLayout {
  const rng = new RNG(seed * 7919 + 13);
  const c = Math.cos(angle), s = Math.sin(angle);
  const W = (lx: number, lz: number): [number, number] => [px + lx * c + lz * s, pz - lx * s + lz * c];
  const ringW = (pts: [number, number][]) => pts.flatMap(([lx, lz]) => W(lx, lz));
  const hf = F / 2;
  const tintV = rng.range(0.86, 1.06);
  const L: PlotLayout = {
    x: px, z: pz, angle, F, D, commercial, floors, seed,
    ring: [], height: 0, facade: rng.int(0, 5), roof: 'flat', roofTile: rng.int(0, 1), mumty: null,
    walls: [], wallH: rng.range(2.1, 2.6), wallStyle: rng.int(0, 4), gate: null, pillars: [], porch: null,
    lawn: null, paving: null, pavingKind: 'pavers', trees: [], tanks: [], solar: [],
    front: [0, 0, 0, 0], tint: [tintV * rng.range(0.97, 1.03), tintV, tintV * rng.range(0.95, 1.02)],
  };

  if (commercial) {
    const fs = rng.range(3.5, 6.5), rs = 0.8, ss = 0.25;
    const x0 = -hf + ss, x1 = hf - ss, z0 = fs, z1 = Math.max(fs + 8, D - rs);
    // orientation does not matter here: the building mesher normalises rings to positive area
    L.ring = ringW([[x0, z0], [x0, z1], [x1, z1], [x1, z0]]);
    L.height = 4.4 + (floors - 1) * 3.4 + 0.8;
    L.front = [...W(x0, z0), ...W(x1, z0)] as [number, number, number, number]; // a→b so the left normal faces the road
    L.paving = ringW([[-hf + 0.1, 0.2], [-hf + 0.1, fs], [hf - 0.1, fs], [hf - 0.1, 0.2]]);
    L.pavingKind = rng.chance(0.5) ? 'pavers_red' : 'concrete';
    const nt = rng.int(1, 3);
    for (let k = 0; k < nt; k++) {
      const [tx, tz] = W(rng.range(x0 + 1.5, x1 - 1.5), rng.range(z1 - 5, z1 - 1.5));
      L.tanks.push({ x: tx, y: L.height - 0.8, z: tz, s: rng.range(0.9, 1.3) });
    }
    if (rng.chance(0.3)) {
      const [tx, tz] = W(rng.range(x0 + 2, x1 - 2), (z0 + z1) / 2);
      L.solar.push({ x: tx, y: L.height - 0.8, z: tz, yaw: angle });
    }
    return L;
  }

  // --- residential kothi --------------------------------------------------------------------------------------
  const fs = Math.min(8, Math.max(4.5, D * 0.22)), rs = Math.min(3, Math.max(1.2, D * 0.08));
  const ss = rng.range(1.0, 2.0);
  let x0 = -hf + ss, x1 = hf - ss;
  const z0 = fs, z1 = D - rs;
  const gateLeft = rng.chance(0.5);
  const gw = 4.2;
  const gx = gateLeft ? -hf + 0.35 + gw / 2 + rng.range(0, 1.5) : hf - 0.35 - gw / 2 - rng.range(0, 1.5);
  const lShape = rng.chance(0.4) && x1 - x0 > 9;
  let localRing: [number, number][];
  if (lShape) {
    // notch the front corner on the gate side → car porch
    const nw = Math.min(5, (x1 - x0) * 0.42), nd = 4.2;
    if (gateLeft) {
      localRing = [[x0, z0 + nd], [x0, z1], [x1, z1], [x1, z0], [x0 + nw, z0], [x0 + nw, z0 + nd]];
      L.porch = {
        ring: ringW([[x0 - 0.1, z0 - 0.6], [x0 - 0.1, z0 + nd], [x0 + nw, z0 + nd], [x0 + nw, z0 - 0.6]]),
        y: 3.0,
        pillars: [W(x0 + 0.2, z0 - 0.4)].map(([x, z]) => ({ x, z })),
      };
    } else {
      localRing = [[x0, z0], [x0, z1], [x1, z1], [x1, z0 + nd], [x1 - nw, z0 + nd], [x1 - nw, z0]];
      L.porch = {
        ring: ringW([[x1 - nw, z0 - 0.6], [x1 - nw, z0 + nd], [x1 + 0.1, z0 + nd], [x1 + 0.1, z0 - 0.6]]),
        y: 3.0,
        pillars: [W(x1 - 0.2, z0 - 0.4)].map(([x, z]) => ({ x, z })),
      };
    }
  } else {
    if (x1 - x0 < 6) {
      x0 = -hf + 0.6;
      x1 = hf - 0.6;
    }
    localRing = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
  }
  L.ring = ringW(localRing);
  L.height = floors * 3.2 + 0.6;
  L.front = [...W(x0, z0), ...W(x1, z0)] as [number, number, number, number]; // a→b so the left normal faces the road
  if (!lShape && rng.chance(0.2)) L.roof = 'hip';
  if (L.roof === 'flat' && rng.chance(0.6)) {
    const [mx, mz] = W(rng.range(x0 + 2, x1 - 2), z1 - 2.2);
    L.mumty = { x: mx, z: mz, yaw: angle };
    L.tanks.push({ x: mx, y: L.height - 0.6 + 2.9, z: mz, s: rng.range(0.9, 1.2) });
  } else if (L.roof === 'flat') {
    const [tx, tz] = W(rng.range(x0 + 1.2, x1 - 1.2), z1 - 1.3);
    L.tanks.push({ x: tx, y: L.height - 0.6, z: tz, s: rng.range(0.8, 1.1) });
  }
  if (L.roof === 'flat' && rng.chance(0.28)) {
    const [sx2, sz2] = W((x0 + x1) / 2, (z0 + z1) / 2);
    L.solar.push({ x: sx2, y: L.height - 0.6, z: sz2, yaw: angle });
  }

  // boundary walls (inset 0.12 so neighbouring plots' walls sit side by side instead of z-fighting)
  const e = 0.12;
  const wf = 0.2;
  const g0 = gx - gw / 2, g1 = gx + gw / 2;
  const seg = (ax: number, az: number, bx: number, bz: number) => L.walls.push([...W(ax, az), ...W(bx, bz)] as [number, number, number, number]);
  seg(-hf + e, wf, g0 - 0.3, wf);
  seg(g1 + 0.3, wf, hf - e, wf);
  seg(-hf + e, wf, -hf + e, D - e);
  seg(hf - e, wf, hf - e, D - e);
  seg(-hf + e, D - e, hf - e, D - e);
  const [gxw, gzw] = W(gx, wf);
  L.gate = { x: gxw, z: gzw, yaw: angle, w: gw, style: rng.int(0, 3) };
  for (const px2 of [g0 - 0.3, g1 + 0.3]) {
    const [x, z] = W(px2, wf);
    L.pillars.push({ x, z });
  }
  // lawn + driveway
  L.lawn = ringW([[-hf + 0.35, 0.45], [-hf + 0.35, z0 - 0.15], [hf - 0.35, z0 - 0.15], [hf - 0.35, 0.45]]);
  L.paving = ringW([[g0, 0.3], [g0, z0 + (lShape ? 4 : 0)], [g1, z0 + (lShape ? 4 : 0)], [g1, 0.3]]);
  L.pavingKind = 'pavers';
  if (rng.chance(0.6)) {
    const tx = gateLeft ? rng.range(g1 + 1.5, hf - 1.5) : rng.range(-hf + 1.5, g0 - 1.5);
    if (Math.abs(tx) < hf - 1) {
      const [x, z] = W(tx, rng.range(1.5, Math.max(1.6, z0 - 1.5)));
      L.trees.push({ x, z, type: rng.weighted([0, 1, 2], [0.6, 0.25, 0.15]), scale: rng.range(0.7, 1.05) });
    }
  }
  return L;
}
