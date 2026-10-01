/**
 * Headless play pass: drive, check the console, save day / night / interior frames.
 *   npm run smoke
 */
import { mkdirSync } from 'node:fs';
import { withGame, saveCanvas } from './shot';

mkdirSync('smoke-output', { recursive: true });
const problems: string[] = [];

const { errors } = await withGame(async (open) => {
  const page = await open('autoplay&capture&hour=16&quality=medium', 1600, 900);
  await page.waitForTimeout(1800);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(4500);
  await saveCanvas(page, 'smoke-output/drive-day.png');
  const day = await page.evaluate(() => {
    const g = (window as any).__game;
    return {
      stats: g.stats(),
      hud: {
        speed: document.querySelector('.hud-speed')?.textContent ?? '',
        gear: document.querySelector('.hud-gear')?.textContent ?? '',
        map: !!document.querySelector('.minimap'),
        visible: (document.querySelector('.hud') as HTMLElement | null)?.style.display !== 'none',
      },
    };
  });
  console.log('day', JSON.stringify(day));
  if (!day.hud.visible) problems.push('HUD hidden during play');
  if (!day.hud.map) problems.push('minimap missing');
  if (day.stats.kmh < 25) problems.push(`car barely moved (${day.stats.kmh} km/h)`);
  if (day.stats.traffic < 15) problems.push(`traffic too sparse (${day.stats.traffic})`);
  if (day.stats.fps < 50) problems.push(`fps ${day.stats.fps} below 50 on this machine`);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(400);
  await saveCanvas(page, 'smoke-output/drive-lights.png');
  await page.close();

  const night = await open('autoplay&capture&hour=21.5&quality=medium', 1600, 900);
  await night.waitForTimeout(1200);
  await night.keyboard.down('KeyW');
  await night.waitForTimeout(2800);
  await saveCanvas(night, 'smoke-output/drive-night.png');
  const ns = await night.evaluate(() => (window as any).__game.stats());
  console.log('night', JSON.stringify(ns));
  if (ns.hour < 20) problems.push(`night hour did not stick (${ns.hour})`);
  await night.keyboard.up('KeyW');
  await night.close();

  const cam = await open('autoplay&capture&hour=16&quality=low', 1280, 720);
  await cam.waitForTimeout(700);
  for (let i = 0; i < 3; i++) await cam.keyboard.press('KeyC');
  await cam.waitForTimeout(500);
  await saveCanvas(cam, 'smoke-output/drive-interior.png');
  const cs = await cam.evaluate(() => (window as any).__game.stats());
  console.log('camera', cs.camera, 'kmh', cs.kmh);
  if (cs.camera !== 'interior') problems.push(`expected interior camera, got ${cs.camera}`);
});

const real = errors.filter((e) => !e.includes('deprecated') && !e.includes('PCFSoft'));
if (real.length) problems.push('console:\n' + real.slice(0, 12).join('\n'));
if (problems.length) {
  console.error('SMOKE FAIL\n' + problems.join('\n'));
  process.exit(1);
}
console.log('SMOKE OK');
