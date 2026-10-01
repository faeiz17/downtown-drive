// Connected components of a baked primitive (vertices welded by position).
import type { BakedPrim } from './base';
export interface Component { tris: number[]; min: number[]; max: number[] }
export function components(p: BakedPrim): Component[] {
  const key = (i: number) => `${Math.round(p.pos[i * 3] * 1e4)},${Math.round(p.pos[i * 3 + 1] * 1e4)},${Math.round(p.pos[i * 3 + 2] * 1e4)}`;
  const weld = new Map<string, number>();
  const vid = new Int32Array(p.pos.length / 3);
  for (let i = 0; i < vid.length; i++) {
    const k = key(i);
    let w = weld.get(k);
    if (w === undefined) weld.set(k, (w = weld.size));
    vid[i] = w;
  }
  const parent = Array.from({ length: weld.size }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const T = p.idx.length / 3;
  for (let t = 0; t < T; t++) {
    const a = find(vid[p.idx[t * 3]]), b = find(vid[p.idx[t * 3 + 1]]), c = find(vid[p.idx[t * 3 + 2]]);
    parent[b] = a; parent[find(c)] = find(a);
  }
  const groups = new Map<number, Component>();
  for (let t = 0; t < T; t++) {
    const r = find(vid[p.idx[t * 3]]);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = { tris: [], min: [9, 9, 9], max: [-9, -9, -9] }));
    g.tris.push(t);
    for (let k = 0; k < 3; k++) {
      const i = p.idx[t * 3 + k];
      for (let d = 0; d < 3; d++) { g.min[d] = Math.min(g.min[d], p.pos[i * 3 + d]); g.max[d] = Math.max(g.max[d], p.pos[i * 3 + d]); }
    }
  }
  return [...groups.values()];
}
