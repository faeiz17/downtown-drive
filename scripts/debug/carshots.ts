// Render the car from several angles into smoke-output/car-<angle>.png
import { withGame, saveCanvas } from '../shot';
const angles = (process.argv[2] ?? 'front34,rear34,side,front,rear').split(',');
const extra = process.argv[3] ?? '';
const { errors } = await withGame(async (open) => {
  for (const a of angles) {
    const page = await open(`view=car&capture&angle=${a}${extra ? '&' + extra : ''}`, 1400, 800);
    await page.waitForTimeout(800);
    await saveCanvas(page, `smoke-output/${process.argv[4] ?? 'car'}-${a}${extra.includes('lights') ? '-lights' : ''}.png`);
    await page.close();
  }
});
console.log(errors.filter((e) => !e.includes('deprecated')).slice(0, 10).join('\n') || 'no errors');
