import { loadBase, bounds } from '../car/base';
const prims = await loadBase();
const paint = prims.filter((p) => p.material === 'body1');
const bw = bounds(paint.filter((p) => !p.node.includes('door')));
console.log('paint (no doors) x', bw.min.x.toFixed(3), bw.max.x.toFixed(3), 'y', bw.min.y.toFixed(3), bw.max.y.toFixed(3), 'z', bw.min.z.toFixed(3), bw.max.z.toFixed(3));
for (const c0 of [1.3, -1.3]) {
  const pts: [number, number][] = [];
  for (let zb = c0 - 0.5; zb <= c0 + 0.5; zb += 0.01) {
    let ymin = 9;
    for (const p of [...paint, ...prims.filter((q) => q.material === 'black1')]) for (let i = 0; i < p.pos.length; i += 3) {
      const x = Math.abs(p.pos[i]), y = p.pos[i + 1], z = p.pos[i + 2];
      if (x < 0.8 || Math.abs(z - zb) > 0.006 || y > 0.9 || p.material !== 'body1') continue;
      ymin = Math.min(ymin, y);
    }
    if (ymin < 9 && ymin > 0.28) pts.push([zb, ymin]);
  }
  // algebraic circle fit (Kasa)
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxxx = 0, syyy = 0, sxyy = 0, sxxy = 0; const n = pts.length;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxxx += x ** 3; syyy += y ** 3; sxyy += x * y * y; sxxy += x * x * y; }
  const A = n * sxx - sx * sx, B = n * sxy - sx * sy, C = n * syy - sy * sy;
  const D = 0.5 * (n * sxyy - sx * syy + n * sxxx - sx * sxx), E = 0.5 * (n * sxxy - sy * sxx + n * syyy - sy * syy);
  const cz = (D * C - B * E) / (A * C - B * B), cy = (A * E - B * D) / (A * C - B * B);
  const r = Math.sqrt(pts.reduce((a, [x, y]) => a + (x - cz) ** 2 + (y - cy) ** 2, 0) / n);
  console.log(`arch near ${c0}: n=${n} centre z=${cz.toFixed(3)} y=${cy.toFixed(3)} r=${r.toFixed(3)} span ${pts[0]?.[0].toFixed(2)}..${pts[n - 1]?.[0].toFixed(2)}`);
  console.log('  pts', pts.filter((_, i) => i % 6 === 0).map(([z, y]) => `${z.toFixed(2)}:${y.toFixed(2)}`).join(' '));
}
// width of paint at arch height (for wheel track)
for (const zc of [1.3, -1.3]) {
  let xmax = 0;
  for (const p of paint) for (let i = 0; i < p.pos.length; i += 3) if (Math.abs(p.pos[i + 2] - zc) < 0.5 && p.pos[i + 1] > 0.3 && p.pos[i + 1] < 0.6) xmax = Math.max(xmax, Math.abs(p.pos[i]));
  console.log('paint half width near arch', zc, xmax.toFixed(3));
}
