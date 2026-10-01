/**
 * Temporal anti-aliasing check. Drives at a steady 60 km/h and measures temporal flicker: the mean absolute second
 * difference in time of each pixel's luma (smooth motion gives a small value; aliasing crawl gives a large one),
 * with TAA off and on. Also saves a 3x crop of the same frame for both, moving and at rest.
 *   npx tsx scripts/debug/taa-check.ts [quality]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { withGame } from '../shot';
const quality = process.argv[2] ?? 'medium';
const out = 'docs/screenshots/taa';
mkdirSync(out, { recursive: true });
const run = `(async (taa, kmh) => {
  const g = window.__game, r = g.renderer;
  r.renderer.setAnimationLoop(null);
  r.dynamicResolution = false;
  r.applyQuality({ ...r.quality, taa, smaa: false, motionBlur: false });
  g.traffic.setDensity?.(0);
  g.autopilotKmh = kmh;
  g.rig.mode = 'chase'; g.rig.snap();
  let t = performance.now() + 1000;
  const step = () => { t += 1000 / 60; g.frame(t); };
  for (let i = 0; i < (kmh ? 540 : 120); i++) step();
  const src = document.getElementById('game');
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const lum = () => { ctx.drawImage(src, 0, 0); const d = ctx.getImageData(0, 0, c.width, c.height).data; const L = new Float32Array(c.width * c.height); for (let i = 0; i < L.length; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return L; };
  const frames = [];
  for (let i = 0; i < 12; i++) { step(); frames.push(lum()); }
  let sum = 0, n = 0;
  // upper 55% of the frame only: sky line, wires, poles, lamp arms, facades, distant lane lines (not the near road)
  const lim = Math.floor(c.height * 0.55) * c.width;
  for (let f = 1; f < frames.length - 1; f++) { const a = frames[f - 1], b = frames[f], d = frames[f + 1]; for (let i = 0; i < lim; i += 3) { sum += Math.abs(a[i] - 2 * b[i] + d[i]); n++; } }
  return { flicker: sum / n, gpu: r.gpuMs, png: src.toDataURL('image/png') };
})`;
const rows: string[] = [];
const { errors } = await withGame(async (open) => {
  for (const kmh of [60, 8, 0]) {
    for (const taa of [false, true]) {
      const page = await open(`capture&autoplay&autopilot=${kmh || 1}&hour=13&quality=${quality}`, 1280, 720, 1);
      await page.waitForTimeout(1200);
      const r = (await page.evaluate(`${run}(${taa}, ${kmh})`)) as { flicker: number; gpu: number; png: string };
      await page.close();
      const name = `${kmh > 20 ? 'moving' : kmh ? 'creep' : 'still'}-${taa ? 'taa' : 'off'}`;
      writeFileSync(`${out}/${name}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
      rows.push(`${name.padEnd(12)} temporal flicker ${r.flicker.toFixed(3)} (luma levels / frame²)`);
    }
  }
});
console.log(rows.join('\n'));
// 3x crops of the upper-middle of the frame (wires, poles, lamp arms, distant lane lines)
for (const m of ['moving', 'creep', 'still']) {
  execSync(`ffmpeg -v error -y -i ${out}/${m}-off.png -i ${out}/${m}-taa.png -filter_complex "[0]crop=420:236:430:150,scale=1260:708:flags=neighbor[a];[1]crop=420:236:430:150,scale=1260:708:flags=neighbor[b];[a][b]hstack=2" -q:v 2 ${out}/${m}-compare.jpg`);
}
console.log(errors.filter((e) => !e.includes('deprecated')).slice(0, 5).join('\n') || 'no console errors');
