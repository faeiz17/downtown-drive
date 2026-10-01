import { withGame } from '../shot';
const code = `(async () => {
  const g = window.__game;
  g.renderer.renderer.setAnimationLoop(null);
  let t = performance.now() + 1000;
  for (let i = 0; i < 600; i++) { t += 1000 / 144; g.frame(t); }
  const rows = [];
  for (let i = 0; i < 12; i++) {
    t += 1000 / 144; g.frame(t);
    const b = g.car.vehicle.body.translation();
    rows.push([g.accumulator.toFixed(5), g.interpolate, g.car.object.position.z.toFixed(4), b.z.toFixed(4), g.car.prevPos.z.toFixed(4), g.car.vehicle.position.z.toFixed(4), g.mode, g.stepsTotal].join(' '));
  }
  return rows;
})()`;
const { result } = await withGame(async (open) => {
  const page = await open('capture&autoplay&autopilot=60&hour=13&quality=low', 960, 540, 1);
  await page.waitForTimeout(1000);
  return page.evaluate(code);
});
console.log('accumulator interp objZ bodyZ prevZ vehZ mode steps');
console.log((result as string[]).join('\n'));
