import { loadBase, bounds } from '../car/base';
const prims = await loadBase();
const all = bounds(prims, (p) => p.node !== 'pessima_rollcage');
console.log('overall (no rack)', all.min.toArray().map((v) => +v.toFixed(3)), all.max.toArray().map((v) => +v.toFixed(3)));
const body = prims.filter((p) => p.material === 'body1');
// side silhouette bottom profile: for each z bin, min y of paint vertices with |x| > 0.6
const bins = new Map<number, number>();
for (const p of body) for (let i = 0; i < p.pos.length; i += 3) {
  const x = p.pos[i], y = p.pos[i + 1], z = p.pos[i + 2];
  if (Math.abs(x) < 0.7) continue;
  const k = Math.round(z * 50);
  bins.set(k, Math.min(bins.get(k) ?? 9, y));
}
const ks = [...bins.keys()].sort((a, b) => a - b);
let line = '';
for (const k of ks) if (k % 5 === 0) line += `${(k / 50).toFixed(1)}:${bins.get(k)!.toFixed(2)} `;
console.log('bottom profile (z:ymin)', line);
// arch detection: bins where ymin > 0.45 and between
const archBins = ks.filter((k) => bins.get(k)! > 0.42);
const groups: number[][] = [];
for (const k of archBins) { const g = groups[groups.length - 1]; if (g && k - g[g.length - 1] <= 2) g.push(k); else groups.push([k]); }
for (const g of groups) {
  const z0 = g[0] / 50, z1 = g[g.length - 1] / 50;
  const top = Math.max(...g.map((k) => bins.get(k)!));
  console.log(`arch z ${z0.toFixed(3)}..${z1.toFixed(3)} centre ${((z0 + z1) / 2).toFixed(3)} width ${(z1 - z0).toFixed(3)} top ${top.toFixed(3)}`);
}
// roof top profile along centreline
const roof = new Map<number, number>();
for (const p of body) for (let i = 0; i < p.pos.length; i += 3) {
  if (Math.abs(p.pos[i]) > 0.1) continue;
  const k = Math.round(p.pos[i + 2] * 10);
  roof.set(k, Math.max(roof.get(k) ?? -9, p.pos[i + 1]));
}
console.log('centre top profile', [...roof.entries()].sort((a, b) => a[0] - b[0]).map(([k, y]) => `${(k / 10).toFixed(1)}:${y.toFixed(2)}`).join(' '));
for (const mat of ['glass1', 'fara_r1', 'fara_r_f', 'zad1', 'material_7', 'material_8', 'fog1', 'seat_2', 'setka', 'material_0', 'material', 'zad_bump', 'dalniy1', 'fara_f1']) {
  for (const p of prims.filter((q) => q.material === mat)) {
    const b = bounds([p]);
    console.log(mat.padEnd(10), p.node.padEnd(18), 'min', b.min.toArray().map((v) => v.toFixed(2)).join(','), 'max', b.max.toArray().map((v) => v.toFixed(2)).join(','), 'tris', p.idx.length / 3);
  }
}
