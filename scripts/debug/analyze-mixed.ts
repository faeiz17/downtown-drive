import { loadBase } from '../car/base';
import { components } from '../car/components';
const prims = await loadBase();
for (const [node, mat] of [['pessima_body', 'fara_f'], ['pessima_body', 'chrome1'], ['pessima_bumper_F', 'chrome1'], ['pessima_trunk', 'chrome1'], ['pessima_door_FL', 'chrome1'], ['pessima_body', 'tabl']]) {
  const p = prims.find((q) => q.node === node && q.material === mat);
  if (!p) continue;
  const comps = components(p);
  const summary = new Map<string, number>();
  for (const c of comps) {
    const cx = (c.min[0] + c.max[0]) / 2, cy = (c.min[1] + c.max[1]) / 2, cz = (c.min[2] + c.max[2]) / 2;
    const k = `x${cx.toFixed(1)} y${cy.toFixed(1)} z${cz.toFixed(1)}`;
    summary.set(k, (summary.get(k) ?? 0) + c.tris.length);
  }
  console.log(node, mat, [...summary.entries()].map(([k, v]) => `${k}:${v}`).join(' | '));
}
// steering selection preview
const sg = prims.find((q) => q.node === 'pessima_body' && q.material === 'salon_gray')!;
const sel = components(sg).filter((c) => c.min[0] > 0.17 && c.max[0] < 0.67 && c.min[1] > 0.54 && c.max[1] < 1.0 && c.min[2] > 0.36 && c.max[2] < 0.8);
console.log('steering comps', sel.map((c) => `${c.tris.length}[${c.min.map((v) => v.toFixed(2))}→${c.max.map((v) => v.toFixed(2))}]`).join(' '));
