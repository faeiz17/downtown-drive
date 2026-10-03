// Starts a pursuit and drives for a while; prints cop distances and saves a frame with the HUD.
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { withGame } from '../shot';
const { result, errors } = await withGame(async (open) => {
  const page = await open('capture&autoplay&hour=21&quality=medium&rain=1', 1600, 900, 1);
  await page.waitForTimeout(2000);
  await page.evaluate(`(() => { const g = window.__game, v = g.car.vehicle; g.police.alert({ x: v.position.x, z: v.position.z, vx: 0, vz: 0, kmh: 0, heading: v.heading }); })()`);
  await page.keyboard.down('KeyW');
  const log: unknown[] = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1500);
    log.push(await page.evaluate(`(() => { const g = window.__game, v = g.car.vehicle; return { lvl: g.police.level, near: Math.round(g.police.nearest.dist), kmh: Math.round(v.groundKmh), cops: g.police.group.children.filter(c => c.visible).length }; })()`));
  }
  const url = (await page.evaluate(`document.getElementById('game').toDataURL('image/png')`)) as string;
  writeFileSync('smoke-output/_game.png', Buffer.from(url.split(',')[1], 'base64'));
  await page.evaluate(`(() => { document.body.style.background = 'transparent'; document.getElementById('game').style.visibility = 'hidden'; })()`);
  await page.screenshot({ path: 'smoke-output/_hud.png', omitBackground: true });
  return log;
});
execSync('ffmpeg -v error -y -i smoke-output/_game.png -i smoke-output/_hud.png -filter_complex "[0]scale=1600:900[g];[g][1]overlay" -q:v 3 smoke-output/police.jpg');
console.log(JSON.stringify(result));
console.log(errors.filter((e) => !e.includes('deprecated')).slice(0, 5).join('\n') || 'no console errors');
