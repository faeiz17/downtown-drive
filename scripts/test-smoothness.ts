/**
 * Smoothness proof: drive at steady speed and step the frame loop with synthetic timestamps at several display
 * rates (headless Chrome only offers 60 Hz, where 120 Hz physics divides evenly and hides problems).
 * For each rate, with interpolation on and off, it measures
 *   - visual speed error: (car displacement on screen per frame ÷ frame time) ÷ physics speed, as % std-dev
 *   - camera-to-car distance: RMS of the second difference (a saw-tooth shows up as a large alternating value)
 *   npm run test:smoothness
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { withGame } from './shot';

const run = `(async (hz, jitterMs, interpolate, frames) => {
  const g = window.__game;
  g.renderer.renderer.setAnimationLoop(null);
  g.renderer.dynamicResolution = false;
  g.interpolate = interpolate;
  g.rig.mode = 'chase'; g.rig.snap();
  let t = performance.now() + 1000;
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const step = () => { const dt = 1000 / hz + (rnd() - 0.5) * 2 * jitterMs; t += dt; g.frame(t); return dt / 1000; };
  // settle at cruising speed
  for (let i = 0; i < 12 * hz; i++) { step(); if (i > 3 * hz && Math.abs(g.car.vehicle.kmh - g.autopilotKmh) < 1.5) break; }
  for (let i = 0; i < hz; i++) step();
  const out = { dist: [], ratio: [], kmh: [] };
  const p = g.car.object.position; let px = p.x, pz = p.z;
  for (let i = 0; i < frames; i++) {
    const dt = step();
    const moved = Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z;
    const v = Math.abs(g.car.vehicle.speed);
    out.ratio.push(moved / dt / v);
    out.dist.push(g.camera.position.distanceTo(p));
    out.kmh.push(g.car.vehicle.kmh);
  }
  return out;
})`;

const cases: [number, number][] = [[60, 0], [60, 3], [90, 0], [120, 0], [144, 0], [144, 1.5]];
const rows: string[] = [];
const series: Record<string, number[]> = {};
let failed = false;
const { errors } = await withGame(async (open) => {
  for (const [hz, jitter] of cases) {
    for (const interp of [true, false]) {
      const page = await open('capture&autoplay&autopilot=60&hour=13&quality=low', 960, 540, 1);
      await page.waitForTimeout(1200);
      const r = (await page.evaluate(`${run}(${hz}, ${jitter}, ${interp}, 480)`)) as { dist: number[]; ratio: number[]; kmh: number[] };
      await page.close();
      const mean = r.ratio.reduce((a, b) => a + b, 0) / r.ratio.length;
      const std = Math.sqrt(r.ratio.reduce((a, b) => a + (b - mean) ** 2, 0) / r.ratio.length) * 100;
      let s2 = 0;
      for (let i = 2; i < r.dist.length; i++) s2 += (r.dist[i] - 2 * r.dist[i - 1] + r.dist[i - 2]) ** 2;
      const camRms = Math.sqrt(s2 / (r.dist.length - 2)) * 1000;
      const label = `${hz} Hz${jitter ? ` ±${jitter} ms` : ''}`;
      const ok = !interp || (std < 1.5 && camRms < 2);
      if (!ok) failed = true;
      rows.push(`${label.padEnd(15)} interpolation ${interp ? 'on ' : 'off'}  speed ${r.kmh[0].toFixed(0)} km/h  visual-speed error ${std.toFixed(2).padStart(6)} %  camera-distance saw-tooth ${camRms.toFixed(2).padStart(7)} mm ${interp ? (ok ? ' PASS' : ' FAIL') : ''}`);
      if (hz === 144 && !jitter) series[interp ? 'on' : 'off'] = r.dist.slice(0, 120);
    }
  }
});
console.log(rows.join('\n'));
// small SVG chart of camera-to-car distance at 144 Hz, interpolation off vs on
const all = [...series.on, ...series.off];
const lo = Math.min(...all), hi = Math.max(...all);
const path = (d: number[]) => d.map((v, i) => `${i ? 'L' : 'M'}${(40 + (i / (d.length - 1)) * 740).toFixed(1)},${(260 - ((v - lo) / (hi - lo || 1)) * 220).toFixed(1)}`).join('');
mkdirSync('docs', { recursive: true });
writeFileSync('docs/smoothness.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" font-family="Arial" font-size="12"><rect width="800" height="300" fill="#fff"/><text x="40" y="20">Camera-to-car distance over 120 frames at 144 Hz, 60 km/h (range ${((hi - lo) * 1000).toFixed(1)} mm)</text><path d="${path(series.off)}" fill="none" stroke="#d33" stroke-width="1.2"/><path d="${path(series.on)}" fill="none" stroke="#1a6" stroke-width="1.8"/><text x="600" y="40" fill="#d33">interpolation off</text><text x="600" y="56" fill="#1a6">interpolation on</text></svg>`);
console.log(errors.filter((e) => !e.includes('deprecated')).slice(0, 5).join('\n') || 'no console errors');
if (failed) { console.error('SMOOTHNESS FAILED'); process.exit(1); }
console.log('smoothness OK (chart: docs/smoothness.svg)');
