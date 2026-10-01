// Debug: render a top-down SVG of the compiled world around a point and screenshot it with system Chrome.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import type { WorldData } from '../../src/data/types';
import { PLOT_STRIDE, TREE_STRIDE, POLE_STRIDE, LAMP_STRIDE } from '../../src/data/types';

const w: WorldData = JSON.parse(readFileSync('public/world/gulberg.world.json', 'utf8'));
const cx = parseFloat(process.argv[2] ?? String(w.spawn.x));
const cz = parseFloat(process.argv[3] ?? String(w.spawn.z));
const R = parseFloat(process.argv[4] ?? '350');
const out = process.argv[5] ?? 'smoke-output/map.png';
const S = 1000 / (2 * R);
const X = (x: number) => ((x - cx + R) * S).toFixed(1);
const Z = (z: number) => ((z - cz + R) * S).toFixed(1);
const inView = (x: number, z: number, m = 50) => Math.abs(x - cx) < R + m && Math.abs(z - cz) < R + m;
const path = (p: number[], close = false) => 'M' + p.reduce<string[]>((a, v, i) => (i % 2 ? a : a.concat(`${X(p[i])},${Z(p[i + 1])}`)), []).join('L') + (close ? 'Z' : '');
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" style="background:#cfc9b6">`;
for (const a of w.areas) if (a.pts.some((_, i) => i % 2 === 0 && inView(a.pts[i], a.pts[i + 1], 400))) svg += `<path d="${path(a.pts, true)}" fill="${{ park: '#8fbf7a', grass: '#9ccf86', golf: '#7fb56b', pitch: '#79b86a', cemetery: '#a8b38f', water: '#6aa8d8', parking: '#9a9a9a', campus: '#d8d2c0', plaza: '#bbb' }[a.kind]}"/>`;
for (const wl of w.water) svg += `<path d="${path(wl.pts)}" stroke="#4d8fc9" stroke-width="${wl.width * S}" fill="none"/>`;
for (let i = 0; i < w.plots.length; i += PLOT_STRIDE) {
  const [x, z, ang, F, D, kind] = w.plots.slice(i, i + 6);
  if (!inView(x, z)) continue;
  const ax = Math.cos(ang), az = -Math.sin(ang), nx = Math.sin(ang), nz = Math.cos(ang);
  const c = [x - ax * F / 2, z - az * F / 2, x + ax * F / 2, z + az * F / 2, x + ax * F / 2 + nx * D, z + az * F / 2 + nz * D, x - ax * F / 2 + nx * D, z - az * F / 2 + nz * D];
  svg += `<path d="${path(c, true)}" fill="${kind ? '#e3b9a0' : '#efe3c8'}" stroke="#8a7a60" stroke-width="0.6"/>`;
}
for (const b of w.buildings) if (inView(b.pts[0], b.pts[1])) svg += `<path d="${path(b.pts, true)}" fill="${b.kind === 'commercial' ? '#c0704f' : b.kind === 'residential' ? '#b89a78' : '#8f8fa8'}" stroke="#333" stroke-width="0.5"/>`;
for (const st of w.strokes) {
  if (!st.pts.some((_, i) => i % 2 === 0 && inView(st.pts[i], st.pts[i + 1], 100))) continue;
  if (st.sidewalk) svg += `<path d="${path(st.pts)}" stroke="#bdb8ad" stroke-width="${(st.width + st.sidewalk * 2) * S}" fill="none" stroke-linecap="round"/>`;
}
for (const st of w.strokes) {
  if (!st.pts.some((_, i) => i % 2 === 0 && inView(st.pts[i], st.pts[i + 1], 100))) continue;
  svg += `<path d="${path(st.pts)}" stroke="${st.dual ? '#3a3f4a' : '#4a4a4a'}" stroke-width="${st.width * S}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}
for (const m of w.medians) {
  const ring = m.l.slice();
  for (let i = m.r.length - 2; i >= 0; i -= 2) ring.push(m.r[i], m.r[i + 1]);
  if (inView(ring[0], ring[1], 300)) svg += `<path d="${path(ring, true)}" fill="#5fa05a" stroke="#ddd" stroke-width="0.8"/>`;
}
for (const is of w.islands) if (inView(is.x, is.z)) svg += `<circle cx="${X(is.x)}" cy="${Z(is.z)}" r="${is.r * S}" fill="#5fa05a" stroke="#eee"/>`;
for (let i = 0; i < w.trees.length; i += TREE_STRIDE) if (inView(w.trees[i], w.trees[i + 1])) svg += `<circle cx="${X(w.trees[i])}" cy="${Z(w.trees[i + 1])}" r="${2.2 * S * w.trees[i + 3] / 100}" fill="${['#2f6b2a', '#6b8f2a', '#1f5a3a', '#255520'][w.trees[i + 2]]}" opacity="0.85"/>`;
for (let i = 0; i < w.poles.length; i += POLE_STRIDE) if (inView(w.poles[i], w.poles[i + 1])) svg += `<rect x="${X(w.poles[i])}" y="${Z(w.poles[i + 1])}" width="2" height="2" fill="#000"/>`;
for (let i = 0; i < w.lamps.length; i += LAMP_STRIDE) if (inView(w.lamps[i], w.lamps[i + 1])) svg += `<circle cx="${X(w.lamps[i])}" cy="${Z(w.lamps[i + 1])}" r="2" fill="#ffd400" stroke="#000" stroke-width="0.5"/>`;
w.nodes.forEach((n) => { if (n.signal !== undefined && inView(n.x, n.z)) svg += `<circle cx="${X(n.x)}" cy="${Z(n.z)}" r="4" fill="none" stroke="#f00" stroke-width="2"/>`; });
for (let i = 0; i < w.billboards.length; i += 4) if (inView(w.billboards[i], w.billboards[i + 1])) svg += `<rect x="${X(w.billboards[i]) }" y="${Z(w.billboards[i + 1])}" width="5" height="5" fill="#f0f"/>`;
for (const st of w.strokes) {
  if (!st.name || st.pts.length < 4) continue;
  const mid = Math.floor(st.pts.length / 4) * 2;
  if (!inView(st.pts[mid], st.pts[mid + 1], 0)) continue;
  svg += `<text x="${X(st.pts[mid])}" y="${Z(st.pts[mid + 1])}" font-size="11" font-family="Arial" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke">${st.name.replace(/&/g, '&amp;')}</text>`;
}
svg += `<circle cx="${X(w.spawn.x)}" cy="${Z(w.spawn.z)}" r="6" fill="#00f"/><line x1="${X(w.spawn.x)}" y1="${Z(w.spawn.z)}" x2="${X(w.spawn.x + Math.sin(w.spawn.heading) * 30)}" y2="${Z(w.spawn.z + Math.cos(w.spawn.heading) * 30)}" stroke="#00f" stroke-width="3"/>`;
svg += '</svg>';
mkdirSync('smoke-output', { recursive: true });
writeFileSync('smoke-output/map.svg', svg);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
await page.setContent(svg);
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
