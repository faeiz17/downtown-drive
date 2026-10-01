// Capture reference screenshots from public Three.js / WebGL driving demos into docs/references/.
import { chromium } from 'playwright-core';
const targets: { name: string; url: string; wait: number; actions?: string[] }[] = [
  { name: 'threejs-materials-car', url: 'https://threejs.org/examples/webgl_materials_car.html', wait: 9000 },
  { name: 'bruno-simon', url: 'https://bruno-simon.com/', wait: 20000, actions: ['clickat:1360:140', 'wait:2000', 'click', 'wait:6000', 'key:ArrowUp:2500', 'wait:500'] },
  { name: 'threejs-punk-drive', url: 'https://threejspunk.vercel.app/', wait: 26000, actions: ['clickat:800:586', 'wait:9000', 'clickat:830:673', 'wait:1500', 'clickat:1520:36', 'wait:9000', 'key:KeyW:6000', 'wait:200'] },
  { name: 'puredrive-rt', url: 'https://puredrive-rt.nourtin.com/', wait: 22000, actions: ['click', 'wait:4000'] },
];
const only = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required', '--disable-quic'] });
for (const t of targets) {
  if (only && !t.name.includes(only)) continue;
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  try {
    await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(t.wait);
    for (const a of t.actions ?? []) {
      if (a === 'click') await page.mouse.click(800, 450);
      else if (a.startsWith('clickat:')) { const [, x, y] = a.split(':'); await page.mouse.click(parseInt(x, 10), parseInt(y, 10)); }
      else if (a.startsWith('wait:')) await page.waitForTimeout(parseInt(a.slice(5), 10));
      else if (a.startsWith('key:')) { const [, k, ms] = a.split(':'); await page.keyboard.down(k); await page.waitForTimeout(parseInt(ms, 10)); await page.keyboard.up(k); }
    }
    await page.screenshot({ path: `docs/references/${t.name}.png` });
    console.log('ok', t.name, await page.title());
  } catch (e) {
    console.log('FAILED', t.name, (e as Error).message.slice(0, 120));
  }
  await page.close();
}
await browser.close();
