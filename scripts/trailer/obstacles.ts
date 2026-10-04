import { readFileSync } from 'node:fs';
/** Distance field of everything a car could hit (buildings, plots, trees, lamps, poles, medians, islands, billboards). */
export function makeClearance() {
  const w = JSON.parse(readFileSync('public/world/city.world.json', 'utf8'));
  const segs: number[][] = [];
  const pts: [number, number][] = [];
  for (const b of w.buildings) for (let i = 0; i < b.pts.length; i += 2) { const j = (i + 2) % b.pts.length; segs.push([b.pts[i], b.pts[i + 1], b.pts[j], b.pts[j + 1]]); }
  for (let i = 0; i < w.plots.length; i += 8) {
    const [x, z, a, F, D] = w.plots.slice(i, i + 5), c = Math.cos(a), s = Math.sin(a), hw = F / 2;
    const q = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
    const r = [q(-hw, -1), q(hw, -1), q(hw, D), q(-hw, D)];
    for (let k = 0; k < 4; k++) segs.push([r[k][0], r[k][1], r[(k + 1) % 4][0], r[(k + 1) % 4][1]]);
  }
  for (let i = 0; i < w.trees.length; i += 5) pts.push([w.trees[i], w.trees[i + 1]]);
  for (let i = 0; i < w.lamps.length; i += 4) pts.push([w.lamps[i], w.lamps[i + 1]]);
  for (let i = 0; i < w.poles.length; i += 6) pts.push([w.poles[i], w.poles[i + 1]]);
  for (const m of w.medians) for (const arr of [m.l, m.r]) for (let i = 0; i < arr.length; i += 2) pts.push([arr[i], arr[i + 1]]);
  for (const is of w.islands) pts.push([is.x, is.z]);
  for (let i = 0; i < w.billboards.length; i += 4) pts.push([w.billboards[i], w.billboards[i + 1]]);
  const CELL = 40, grid = new Map<string, number[]>(), pgrid = new Map<string, number[]>();
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const put = (m: Map<string, number[]>, k: string, i: number) => { const a = m.get(k); if (a) a.push(i); else m.set(k, [i]); };
  segs.forEach((s, i) => { const n = Math.ceil(Math.hypot(s[2] - s[0], s[3] - s[1]) / 20); for (let k = 0; k <= n; k++) put(grid, key(s[0] + ((s[2] - s[0]) * k) / n, s[1] + ((s[3] - s[1]) * k) / n), i); });
  pts.forEach((p, i) => put(pgrid, key(p[0], p[1]), i));
  const dSeg = (px: number, pz: number, s: number[]) => { const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((px - s[0]) * dx + (pz - s[1]) * dz) / l2)); return Math.hypot(px - (s[0] + t * dx), pz - (s[1] + t * dz)); };
  const clearance = (px: number, pz: number, cap = 40) => {
    let m = cap;
    const r = Math.ceil(cap / CELL), cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      for (const i of grid.get(`${cx + a},${cz + b}`) ?? []) m = Math.min(m, dSeg(px, pz, segs[i]));
      for (const i of pgrid.get(`${cx + a},${cz + b}`) ?? []) m = Math.min(m, Math.hypot(px - pts[i][0], pz - pts[i][1]) - 0.6);
    }
    return m;
  };
  /** minimum free distance of a car (4.4 × 1.8 m, treated as 5 discs of radius 1.1) along a path of [x, z, heading] */
  const pathClearance = (path: number[][]) => {
    let m = 99;
    for (const [x, z, h] of path) for (const f of [-2.2, -1.1, 0, 1.1, 2.2]) m = Math.min(m, clearance(x + Math.sin(h) * f, z + Math.cos(h) * f, 12) - 1.1);
    return m;
  };
  return { world: w, clearance, pathClearance };
}
