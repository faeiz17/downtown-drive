/**
 * Driving benchmark: autopilot at speed through streets (stresses chunk streaming, colliders, traffic),
 * then prints per-system frame timings and jank.   npx tsx scripts/bench.ts [quality] [seconds]
 */
import { withGame } from './shot';
const quality = process.argv[2] ?? 'medium';
const secs = parseInt(process.argv[3] ?? '40', 10);
const scale = parseFloat(process.argv[4] ?? '2'); // MacBook Retina = 2
const { result, errors } = await withGame(async (open) => {
  const page = await open(`capture&autoplay&autopilot=90&hour=16&quality=${quality}`, 1512, 945, scale);
  await page.waitForTimeout(3000);
  await page.evaluate('window.__game.profiler.reset()');
  await page.waitForTimeout(secs * 1000);
  return page.evaluate(`({ profile: window.__game.profile(), stats: window.__game.stats(), pr: window.__game.renderer.pixelRatio, divider: window.__game.pacer.divider, refresh: window.__game.pacer.refreshMs })`) as Promise<any>;
});
const { profile, stats } = result;
console.log(`pixelRatio ${result.pr} (dynamic)  pacer divider ${result.divider} @ ${result.refresh.toFixed(2)} ms refresh`);
console.log(`quality=${quality}  distance=${stats.distance.toFixed(0)} m  maxKmh=${stats.maxKmh.toFixed(0)}  resets=${stats.resets}  traffic=${stats.traffic}  calls=${stats.drawCalls}  tris=${(stats.triangles / 1e3).toFixed(0)}k`);
console.log(`frame interval ms: avg ${profile.frameInterval.avg}  p95 ${profile.frameInterval.p95}  max ${profile.frameInterval.max}   jank(>25ms) ${profile.jank}`);
console.log(`frame CPU ms:      avg ${profile.frameCpu.avg}  p95 ${profile.frameCpu.p95}  max ${profile.frameCpu.max}`);
const rows = Object.entries(profile.sections as Record<string, { avg: number; p95: number; max: number }>).sort((a, b) => b[1].max - a[1].max);
for (const [k, s] of rows) console.log(`  ${k.padEnd(16)} avg ${String(s.avg).padStart(6)}  p95 ${String(s.p95).padStart(6)}  max ${String(s.max).padStart(7)}`);
console.log(errors.filter((e) => !e.includes('deprecated')).slice(0, 5).join('\n') || 'no console errors');
