import { readFileSync, writeFileSync } from 'node:fs';
const w = JSON.parse(readFileSync('public/world/city.world.json', 'utf8'));
const out: { name: string; cls: string; width: number; len: number; x: number; z: number; ex: number; ez: number; dev: number; hd: number; bld: number }[] = [];
// building density near a point
const bx = w.buildings.map((b: { pts: number[] }) => { let sx = 0, sz = 0; for (let i = 0; i < b.pts.length; i += 2) { sx += b.pts[i]; sz += b.pts[i + 1]; } return [sx / (b.pts.length / 2), sz / (b.pts.length / 2)]; });
for (const st of w.strokes) {
  if (st.pts.length < 6 || !['primary', 'secondary', 'tertiary', 'trunk'].includes(st.cls)) continue;
  const p = st.pts; const n = p.length / 2;
  for (let a = 0; a < n - 1; a += 1) {
    let best = -1, bestLen = 0;
    for (let b = a + 1; b < n; b++) {
      const dx = p[2 * b] - p[2 * a], dz = p[2 * b + 1] - p[2 * a + 1], L = Math.hypot(dx, dz);
      if (L < 1) continue;
      let ok = true;
      for (let k = a + 1; k < b; k++) { const ex = p[2 * k] - p[2 * a], ez = p[2 * k + 1] - p[2 * a + 1]; if (Math.abs(ex * dz - ez * dx) / L > 3.5) { ok = false; break; } }
      if (!ok) break;
      best = b; bestLen = L;
    }
    if (best > 0 && bestLen > 300) {
      const ex = p[2 * best], ez = p[2 * best + 1];
      const mx = (p[2 * a] + ex) / 2, mz = (p[2 * a + 1] + ez) / 2;
      let c = 0; for (const [x, z] of bx) if (Math.hypot(x - mx, z - mz) < 120) c++;
      out.push({ name: st.name ?? '', cls: st.cls, width: st.width, len: bestLen, x: p[2 * a], z: p[2 * a + 1], ex, ez, dev: 0, hd: Math.atan2(ex - p[2 * a], ez - p[2 * a + 1]), bld: c });
    }
  }
}
out.sort((a, b) => b.bld * (a.len > 0 ? 1 : 0) - a.bld);
const seen = new Set<string>(), pick = [];
for (const o of out) { const k = `${o.name}${Math.round(o.x / 200)}${Math.round(o.z / 200)}`; if (seen.has(k)) continue; seen.add(k); pick.push(o); if (pick.length >= 14) break; }
writeFileSync('smoke-output/straights.json', JSON.stringify(pick, null, 1));
for (const o of pick) console.log(`${o.bld} bld  ${o.len.toFixed(0)} m  w${o.width.toFixed(0)} ${o.cls} ${o.name}  from (${o.x.toFixed(0)}, ${o.z.toFixed(0)}) to (${o.ex.toFixed(0)}, ${o.ez.toFixed(0)})`);
