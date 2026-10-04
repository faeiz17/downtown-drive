/** Finds wide open road areas (clearance from buildings, plots, trees, lamps, poles, medians) for filming drifts. */
import { readFileSync, writeFileSync } from 'node:fs';
const w = JSON.parse(readFileSync('public/world/city.world.json', 'utf8'));
type P = [number, number];
const segs: [number, number, number, number][] = [];
const pts: P[] = [];
for (const b of w.buildings) for (let i = 0; i < b.pts.length; i += 2) {
  const j = (i + 2) % b.pts.length;
  segs.push([b.pts[i], b.pts[i + 1], b.pts[j], b.pts[j + 1]]);
}
for (let i = 0; i < w.plots.length; i += 8) {
  const [x, z, a, F, D] = w.plots.slice(i, i + 5), c = Math.cos(a), s = Math.sin(a);
  const hw = F / 2, d = D;
  const corner = (u: number, v: number): P => [x + u * c + v * s, z - u * s + v * c];
  const q = [corner(-hw, -1), corner(hw, -1), corner(hw, d), corner(-hw, d)];
  for (let k = 0; k < 4; k++) segs.push([q[k][0], q[k][1], q[(k + 1) % 4][0], q[(k + 1) % 4][1]]);
}
for (let i = 0; i < w.trees.length; i += 5) pts.push([w.trees[i], w.trees[i + 1]]);
for (let i = 0; i < w.lamps.length; i += 4) pts.push([w.lamps[i], w.lamps[i + 1]]);
for (let i = 0; i < w.poles.length; i += 6) pts.push([w.poles[i], w.poles[i + 1]]);
for (const m of w.medians) for (const arr of [m.l, m.r]) for (let i = 0; i < arr.length; i += 2) pts.push([arr[i], arr[i + 1]]);
for (const is of w.islands) pts.push([is.x, is.z]);
for (let i = 0; i < w.billboards.length; i += 4) pts.push([w.billboards[i], w.billboards[i + 1]]);
const dSeg = (px: number, pz: number, s: number[]) => {
  const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - s[0]) * dx + (pz - s[1]) * dz) / l2));
  return Math.hypot(px - (s[0] + t * dx), pz - (s[1] + t * dz));
};
// grid index
const CELL = 40, grid = new Map<string, number[]>(), pgrid = new Map<string, number[]>();
const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
segs.forEach((s, i) => { for (const [x, z] of [[s[0], s[1]], [s[2], s[3]], [(s[0] + s[2]) / 2, (s[1] + s[3]) / 2]]) { const k = key(x, z); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); } });
pts.forEach((p, i) => { const k = key(p[0], p[1]); (pgrid.get(k) ?? pgrid.set(k, []).get(k)!).push(i); });
function clearance(px: number, pz: number, cap = 60): number {
  let m = cap;
  const r = Math.ceil(cap / CELL);
  const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
    for (const i of grid.get(`${cx + a},${cz + b}`) ?? []) m = Math.min(m, dSeg(px, pz, segs[i]));
    for (const i of pgrid.get(`${cx + a},${cz + b}`) ?? []) m = Math.min(m, Math.hypot(px - pts[i][0], pz - pts[i][1]) - 0.6);
  }
  return m;
}
// candidates: junction nodes and points along wide edges; on a road, off-median
const cands: { x: number; z: number; w: number; name: string }[] = [];
for (const n of w.nodes) if (n.edges.length >= 3) cands.push({ x: n.x, z: n.z, w: n.r * 2, name: 'node' });
for (const e of w.edges) {
  if (e.width < 10) continue;
  for (let i = 0; i + 3 < e.pts.length; i += 2) cands.push({ x: (e.pts[i] + e.pts[i + 2]) / 2, z: (e.pts[i + 1] + e.pts[i + 3]) / 2, w: e.width, name: e.name ?? '' });
}
const out = cands.map((c) => ({ ...c, clr: clearance(c.x, c.z) })).sort((a, b) => b.clr - a.clr);
const picked: typeof out = [];
for (const c of out) if (picked.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > 60)) picked.push(c);
writeFileSync('smoke-output/spots.json', JSON.stringify(picked.slice(0, 40), null, 1));
console.log('candidates', cands.length, 'spawn', w.spawn);
for (const c of picked.slice(0, 14)) console.log(`${c.clr.toFixed(1).padStart(5)} m  at (${c.x.toFixed(0)}, ${c.z.toFixed(0)})  w=${c.w.toFixed(0)}  ${c.name}`);
