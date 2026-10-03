/**
 * Screenshot helper: starts Vite, opens the game in system Chrome with URL params, captures console errors,
 * waits for the game to settle and saves screenshots. Used during development to verify each stage visually.
 *
 *   npx tsx scripts/shot.ts "debug=fly&x=0&z=0&y=40" out.png [waitMs] [width] [height]
 */
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

export async function withGame<T>(fn: (open: (query: string, w?: number, h?: number, scale?: number) => Promise<import('playwright-core').Page>) => Promise<T>, headless = true): Promise<{ result: T; errors: string[] }> {
  const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const port = (server.httpServer!.address() as { port: number }).port;
  const browser = await chromium.launch({
    channel: 'chrome',
    headless,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'],
  });
  const errors: string[] = [];
  const pages: import('playwright-core').Page[] = [];
  try {
    const open = async (query: string, w = 1600, h = 900, scale = 1) => {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
      pages.push(page);
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
      await page.goto(`http://localhost:${port}/?${query}`, { waitUntil: 'load' });
      try {
        await page.waitForFunction(() => !!(window as any).__game && ((window as any).__game.mode !== 'loading'), null, { timeout: 60_000 });
      } catch (e) {
        console.error('Game did not finish loading. Console output:\n' + errors.slice(0, 12).join('\n'));
        throw e;
      }
      return page;
    };
    const result = await fn(open);
    return { result, errors };
  } finally {
    await browser.close();
    await server.close();
  }
}

/** Save the WebGL canvas (+ DOM overlay screenshot composited on top) — headless compositing drops GPU canvases. */
export async function saveCanvas(page: import('playwright-core').Page, out: string): Promise<void> {
  const dataUrl: string = await page.evaluate(() => {
    const g = (window as any).__game;
    g.renderer.render(0.016, 0);
    return (document.getElementById('game') as HTMLCanvasElement).toDataURL('image/png');
  });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const query = process.argv[2] ?? 'debug=fly';
  const out = process.argv[3] ?? 'smoke-output/shot.png';
  const wait = parseInt(process.argv[4] ?? '2500', 10);
  const w = parseInt(process.argv[5] ?? '1600', 10), h = parseInt(process.argv[6] ?? '900', 10);
  mkdirSync('smoke-output', { recursive: true });
  const { result, errors } = await withGame(async (open) => {
    const page = await open(query, w, h);
    await page.waitForTimeout(wait);
    await saveCanvas(page, out);
    return page.evaluate(() => (window as any).__game.stats());
  });
  console.log('stats', JSON.stringify(result));
  console.log(errors.length ? `console errors/warnings (${errors.length}):\n` + errors.slice(0, 20).join('\n') : 'no console errors');
  console.log('wrote', out);
}
