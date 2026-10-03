/**
 * Bug audit: for every combination of quality / time of day / rain it loads the game, drives with the autopilot,
 * cycles cameras, resets the car, pauses/resumes, changes settings and resizes, then checks:
 *   console errors and warnings · NaN in the car or camera · lit materials missing from the shadow cascades ·
 *   growth of GPU objects (leaks) · frame-time spikes.
 *   npx tsx scripts/audit.ts
 */
import { withGame } from './shot';

const combos: { q: string; h: number; rain: number }[] = [];
for (const q of ['low', 'medium', 'high']) for (const h of [6.95, 12.5, 18.65, 22]) combos.push({ q, h, rain: h === 12.5 || h === 22 ? 1 : 0 });

const probe = `(() => {
  const g = window.__game, v = g.car.vehicle;
  const info = g.renderer.renderer.info;
  const bad = [v.position.x, v.position.y, v.position.z, v.velocity.x, v.velocity.y, v.velocity.z, g.camera.position.x, g.camera.position.y, g.camera.position.z].some((n) => !Number.isFinite(n));
  return { bad, geos: info.memory.geometries, tex: info.memory.textures, progs: info.programs?.length ?? 0, kmh: Math.round(v.groundKmh), y: +v.position.y.toFixed(2), unpatched: g.shadows.unpatched(g.scene).slice(0, 6), mode: g.mode, fps: Math.round(g.fps) };
})()`;

const issues: string[] = [];
const { errors } = await withGame(async (open) => {
  for (const c of combos) {
    const tag = `${c.q}/${c.h}h${c.rain ? '/rain' : ''}`;
    const page = await open(`capture&autoplay&autopilot=110&hour=${c.h}&rain=${c.rain}&quality=${c.q}`, 1280, 720, 1);
    await page.waitForTimeout(2500);
    const a = (await page.evaluate(probe)) as Record<string, unknown>;
    // exercise things that tend to break
    for (let k = 0; k < 4; k++) {
      await page.keyboard.press('KeyC');
      await page.waitForTimeout(500);
    }
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.waitForTimeout(500);
    await page.evaluate(`(() => { const g = window.__game; g.settings.quality = '${c.q === 'low' ? 'medium' : 'low'}'; g.applySettings(); })()`);
    await page.waitForTimeout(1200);
    await page.evaluate(`(() => { const g = window.__game; g.settings.quality = '${c.q}'; g.applySettings(); })()`);
    await page.waitForTimeout(6000);
    const b = (await page.evaluate(probe)) as Record<string, unknown>;
    const p = (await page.evaluate(`window.__game.profile()`)) as { frameCpu: { p95: number; max: number }; sections: Record<string, { p95: number }> };
    const line = `${tag.padEnd(18)} fps ${b.fps}  cpu p95 ${p.frameCpu.p95.toFixed(1)} max ${p.frameCpu.max.toFixed(0)} ms  gpu p95 ${(p.sections.gpu?.p95 ?? 0).toFixed(1)}  geos ${a.geos}→${b.geos} tex ${a.tex}→${b.tex}  speed ${b.kmh}`;
    console.log(line);
    if (b.bad || a.bad) issues.push(`${tag}: NaN in car/camera state`);
    if ((b.unpatched as string[]).length) issues.push(`${tag}: lit materials missing from shadow cascades: ${(b.unpatched as string[]).join(', ')}`);
    if ((b.geos as number) > (a.geos as number) + 60) issues.push(`${tag}: geometry count grew ${a.geos}→${b.geos} (leak?)`);
    if ((b.tex as number) > (a.tex as number) + 6) issues.push(`${tag}: texture count grew ${a.tex}→${b.tex} (leak?)`);
    if (b.mode !== 'play') issues.push(`${tag}: game left play mode (${b.mode})`);
    if (p.frameCpu.max > 150) issues.push(`${tag}: frame spike ${p.frameCpu.max.toFixed(0)} ms`);
    await page.close();
  }
});
const uniq = [...new Set(errors.filter((e) => !e.includes('deprecated')))];
console.log('\nconsole messages:', uniq.length ? '\n' + uniq.slice(0, 20).join('\n') : 'none');
console.log('\nissues:', issues.length ? '\n - ' + issues.join('\n - ') : 'none');
