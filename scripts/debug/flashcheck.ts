// Drive with each camera and sample frame brightness every 100 ms: a flash shows up as a spike/drop in the average.
import { withGame } from '../shot';
const sampler = `(() => {
  const c = document.getElementById('game');
  const t = document.createElement('canvas'); t.width = 32; t.height = 18;
  const x = t.getContext('2d'); x.drawImage(c, 0, 0, 32, 18);
  const d = x.getImageData(0, 0, 32, 18).data; let s = 0, w = 0, k = 0;
  for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i+1] + d[i+2]) / 3; s += l; if (l > 250) w++; if (l < 3) k++; }
  return [Math.round(s / (d.length / 4)), w, k];
})()`;
const { result, errors } = await withGame(async (open) => {
  const out: string[] = [];
  for (const hour of ['12', '17.8', '21']) {
    const page = await open(`capture&autoplay&hour=${hour}&quality=medium`, 1280, 720);
    await page.waitForTimeout(1200);
    await page.keyboard.down('KeyW');
    for (const cam of ['chase', 'far', 'hood', 'interior']) {
      const samples: number[][] = [];
      for (let i = 0; i < 40; i++) {
        if (i === 20) await page.keyboard.down('KeyA');
        if (i === 30) await page.keyboard.up('KeyA');
        await page.waitForTimeout(100);
        samples.push(await page.evaluate(sampler));
      }
      const avgs = samples.map((s) => s[0]);
      let maxJump = 0;
      for (let i = 1; i < avgs.length; i++) maxJump = Math.max(maxJump, Math.abs(avgs[i] - avgs[i - 1]));
      const whiteMax = Math.max(...samples.map((s) => s[1])), blackMax = Math.max(...samples.map((s) => s[2]));
      const st = await page.evaluate('window.__game.stats()') as any;
      out.push(`${hour}h ${cam.padEnd(8)} avg ${Math.min(...avgs)}–${Math.max(...avgs)} maxJump ${maxJump} whitePx ${whiteMax}/576 blackPx ${blackMax}/576 kmh ${st.kmh} fps ${st.fps}`);
      await page.keyboard.press('KeyC');
    }
    await page.keyboard.up('KeyW');
    await page.close();
  }
  return out;
});
console.log(result.join('\n'));
console.log(errors.filter((e) => !e.includes('deprecated')).slice(0, 8).join('\n') || 'no console errors');
