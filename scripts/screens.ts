/**
 * Standard screenshot set for before/after comparison: noon, dusk, night × chase, hood, interior at the spawn
 * (hero stretch of Main Boulevard Gulberg), plus a contact sheet.
 *   npx tsx scripts/screens.ts docs/screenshots/before [quality]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { withGame } from './shot';

const outDir = process.argv[2] ?? 'docs/screenshots/current';
const quality = process.argv[3] ?? 'high';
mkdirSync(outDir, { recursive: true });
const times: [string, string][] = [['noon', '12.5'], ['dusk', '17.6'], ['night', '21']];
const cams = ['chase', 'hood', 'interior'];
const grab = `(async () => {
  const g = window.__game;
  for (let i = 0; i < 6; i++) await new Promise(r => requestAnimationFrame(r));
  g.renderer.render(0.016, 0);
  return document.getElementById('game').toDataURL('image/jpeg', 0.92);
})()`;
const { errors } = await withGame(async (open) => {
  for (const [name, hour] of times) {
    const page = await open(`capture&autoplay&hour=${hour}&quality=${quality}&shots=1`, 1600, 900, 1);
    await page.waitForTimeout(3500);
    // roll forward a little so the car is moving and settled in lane
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2600);
    await page.keyboard.up('KeyW');
    for (const cam of cams) {
      await page.evaluate(`(() => { const g = window.__game; g.rig.mode = '${cam}'; g.rig.snap(); })()`);
      await page.waitForTimeout(500);
      const url = (await page.evaluate(grab)) as string;
      writeFileSync(`${outDir}/${name}-${cam}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
    }
    await page.close();
  }
});
const files = times.flatMap(([n]) => cams.map((c) => `${outDir}/${n}-${c}.jpg`));
const inputs = files.map((f) => `-i ${f}`).join(' ');
const fc = files.map((_, i) => `[${i}]scale=800:450[s${i}]`).join(';') + ';' + [0, 1, 2].map((r) => `[s${r * 3}][s${r * 3 + 1}][s${r * 3 + 2}]hstack=3[r${r}]`).join(';') + ';[r0][r1][r2]vstack=3';
execSync(`ffmpeg -v error -y ${inputs} -filter_complex "${fc}" -q:v 3 ${outDir}/sheet.jpg`);
console.log('wrote', outDir, errors.filter((e) => !e.includes('deprecated')).slice(0, 5).join('\n') || '(no console errors)');
