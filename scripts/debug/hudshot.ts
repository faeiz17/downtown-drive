// Full-frame capture (game canvas + HUD overlay composited) after scripted key presses.
//   npx tsx scripts/debug/hudshot.ts out.jpg "hour=21&quality=high" "KeyW:3000,KeyW+ShiftLeft:1500" [cam]
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { withGame } from '../shot';

const out = process.argv[2] ?? 'smoke-output/hud.jpg';
const query = process.argv[3] ?? 'quality=high';
const script = process.argv[4] ?? 'KeyW:3500';
const cam = process.argv[5] ?? 'chase';
mkdirSync(dirname(out), { recursive: true });
const { errors, result } = await withGame(async (open) => {
  const page = await open(`capture&autoplay&${query}`, 1600, 900, 1);
  await page.waitForTimeout(2500);
  await page.evaluate(`(() => { const g = window.__game; g.rig.mode = '${cam}'; g.rig.snap(); })()`);
  for (const step of script.split(',')) {
    const [keys, ms] = step.split(':');
    const ks = keys === '-' ? [] : keys.split('+');
    for (const k of ks) await page.keyboard.down(k);
    await page.waitForTimeout(parseInt(ms, 10));
    if (step !== script.split(',').at(-1)) for (const k of ks) await page.keyboard.up(k);
  }
  const url = (await page.evaluate(`document.getElementById('game').toDataURL('image/png')`)) as string;
  writeFileSync('smoke-output/_game.png', Buffer.from(url.split(',')[1], 'base64'));
  const stats = await page.evaluate(`(() => { const g = window.__game, v = g.car.vehicle; return { kmh: Math.round(v.groundKmh), gear: v.drivetrain.gearLabel, rpm: Math.round(v.drivetrain.rpm), nitro: +v.nitro.toFixed(2), drift: +v.drift.toFixed(2), slipDeg: +(v.slipAngle * 57.3).toFixed(0), fps: Math.round(g.fps), gpu: +g.renderer.gpuMs.toFixed(1) }; })()`);
  await page.evaluate(`(() => { document.body.style.background = 'transparent'; document.documentElement.style.background = 'transparent'; document.getElementById('game').style.visibility = 'hidden'; })()`);
  await page.screenshot({ path: 'smoke-output/_hud.png', omitBackground: true });
  return stats;
});
execSync(`ffmpeg -v error -y -i smoke-output/_game.png -i smoke-output/_hud.png -filter_complex "[0]scale=1600:900[g];[g][1]overlay" -q:v 3 ${out}`);
console.log(JSON.stringify(result), errors.filter((e) => !e.includes('deprecated')).slice(0, 6).join('\n') || 'no console errors');
