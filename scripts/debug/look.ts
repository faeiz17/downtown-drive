// Quick look-dev sheet: one camera at several hours, side by side.  npx tsx scripts/debug/look.ts [cam] [hours] [quality] [extra query]
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { withGame } from '../shot';
const cam = process.argv[2] ?? 'chase';
const hours = (process.argv[3] ?? '12.5,17.6,21').split(',');
const quality = process.argv[4] ?? 'high';
const extra = process.argv[5] ?? '';
mkdirSync('smoke-output', { recursive: true });
const grab = `(async () => { const g = window.__game; g.shadows.stagger = false; for (let i = 0; i < 20; i++) await new Promise(r => requestAnimationFrame(r)); return document.getElementById('game').toDataURL('image/jpeg', 0.92); })()`;
const files: string[] = [];
const { errors } = await withGame(async (open) => {
  for (const h of hours) {
    const page = await open(`capture&autoplay&hour=${h}&quality=${quality}${extra ? '&' + extra : ''}`, 1600, 900, 1);
    await page.waitForTimeout(3000);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2600);
    await page.keyboard.up('KeyW');
    await page.evaluate(`(() => { const g = window.__game; g.rig.mode = '${cam}'; g.rig.snap(); })()`);
    await page.waitForTimeout(400);
    const url = (await page.evaluate(grab)) as string;
    const f = `smoke-output/look-${cam}-${h}.jpg`;
    writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
    files.push(f);
    await page.close();
  }
});
execSync(`ffmpeg -v error -y ${files.map((f) => `-i ${f}`).join(' ')} -filter_complex "${files.map((_, i) => `[${i}]scale=1000:-1[s${i}]`).join(';')};${files.map((_, i) => `[s${i}]`).join('')}${files.length > 1 ? `vstack=${files.length}` : 'null'}" -q:v 3 smoke-output/look.jpg`);
console.log(errors.filter((e) => !e.includes('deprecated')).slice(0, 5).join('\n') || 'no console errors');
