// GPU cost of N8AO settings at a fixed view (Retina 2x window, preset pixel ratio).
import { withGame } from '../shot';
const quality = process.argv[2] ?? 'medium';
const measure = `(async () => {
  const g = window.__game; const r = g.renderer;
  r.dynamicResolution = false; g.mode = 'pause';
  let stop = false; (function tick(){ if (stop) return; r.render(0.016, 0); requestAnimationFrame(tick); })();
  const sample = async (n = 60) => { const xs = []; for (let i = 0; i < n; i++) { await new Promise(res => requestAnimationFrame(res)); if (i > 10 && r.gpuMs) xs.push(r.gpuMs); } xs.sort((a,b)=>a-b); return +xs[Math.floor(xs.length/2)].toFixed(2); };
  const c = r.aoPass.configuration; const out = {};
  const cfgs = { ao8_dn4: [8,4,12], ao6_dn2: [6,2,12], ao4_dn2: [4,2,8], ao4_dn1: [4,1,6], noAO: null, noTAA: 'taa', noShadow: 'sh' };
  // interleaved rounds, keep the lowest median per config (another GPU client may be running)
  for (let round = 0; round < 4; round++) for (const [k, v] of Object.entries(cfgs)) {
    r.aoPass.enabled = v !== null; r.taa.enabled = v !== 'taa';
    if (Array.isArray(v)) { c.aoSamples = v[0]; c.denoiseSamples = v[1]; c.denoiseRadius = v[2]; } else { c.aoSamples = 8; c.denoiseSamples = 4; c.denoiseRadius = 12; }
    g.shadows.lights.forEach((l) => (l.castShadow = v !== 'sh'));
    const ms = await sample(36); out[k] = Math.min(out[k] ?? 99, ms);
  }
  stop = true; return out;
})()`;
const { result } = await withGame(async (open) => {
  const page = await open(`capture&autoplay&hour=16&quality=${quality}`, 1512, 945, 2);
  await page.waitForTimeout(2500);
  return page.evaluate(measure);
});
console.log(quality, JSON.stringify(result));
