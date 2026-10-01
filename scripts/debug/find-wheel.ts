import { loadBase } from '../car/base';
import { components } from '../car/components';
const prims = await loadBase();
for (const mat of ['salon_gray', 'koja1', 'black1', 'chrome1', 'knopk1']) {
  const p = prims.find((q) => q.node === 'pessima_body' && q.material === mat)!;
  const comps = components(p);
  console.log(mat, 'components', comps.length);
  for (const c of comps) {
    const cx = (c.min[0] + c.max[0]) / 2, cy = (c.min[1] + c.max[1]) / 2, cz = (c.min[2] + c.max[2]) / 2;
    if (cx > 0.1 && cx < 0.7 && cz > 0.0 && cz < 0.9 && cy > 0.6 && cy < 1.2)
      console.log('  cand tris', c.tris.length, 'min', c.min.map((v) => v.toFixed(2)).join(','), 'max', c.max.map((v) => v.toFixed(2)).join(','));
  }
}
