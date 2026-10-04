/**
 * 30 s feature tour of the game inside a macOS-style browser window (1920×1080, 30 fps).
 * The game is stepped frame by frame; each frame is the WebGL canvas + the DOM UI (menus, HUD, cursor) composited,
 * placed in a drawn browser window on a desktop, with captions and sound added by ffmpeg.
 *   npx tsx scripts/cinematic-browser.ts   → showcase/downtown-drive-tour-30s.mp4
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { withGame } from './shot';

const FPS = 30, SECONDS = 30;
const GW = 1664, GH = 936; // game viewport inside the browser window
const WX = 128, WY = 40, BAR = 96; // window position on the 1920×1080 desktop, height of the browser chrome
const dirs = { cv: 'smoke-output/tour/cv', ui: 'smoke-output/tour/ui' };
if (!process.env.COMPOSE_ONLY) rmSync('smoke-output/tour', { recursive: true, force: true });
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
mkdirSync('showcase', { recursive: true });

// ---------------------------------------------------------------------------------------------------- desktop + browser chrome
async function drawChrome(): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent(`<style>
    *{box-sizing:border-box;margin:0} body{width:1920px;height:1080px;overflow:hidden;font-family:-apple-system,"SF Pro Text","Helvetica Neue",Arial,sans-serif;
      background:radial-gradient(1200px 700px at 78% 18%,#6f5cc9 0%,rgba(111,92,201,0) 60%),radial-gradient(1000px 800px at 12% 90%,#1d6fa5 0%,rgba(29,111,165,0) 60%),linear-gradient(135deg,#1b1740,#30206b 45%,#0f3b63)}
    .menubar{position:absolute;left:0;top:0;width:100%;height:28px;background:rgba(20,18,40,.55);backdrop-filter:blur(20px);color:#fff;font-size:13.5px;display:flex;align-items:center;padding:0 14px;gap:22px}
    .menubar b{font-weight:700}.menubar .r{margin-left:auto;display:flex;gap:18px;opacity:.95}
    .win{position:absolute;left:${WX}px;top:${WY}px;width:${GW}px;height:${BAR + GH}px;border-radius:12px;background:#000;box-shadow:0 40px 90px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.18);overflow:hidden}
    .tabs{height:44px;background:#dcdde1;display:flex;align-items:flex-end;padding:0 14px 0 14px;position:relative}
    .lights{position:absolute;left:16px;top:14px;display:flex;gap:8px}.lights i{width:13px;height:13px;border-radius:50%;display:block}
    .tab{margin-left:78px;height:34px;width:248px;background:#f6f6f8;border-radius:10px 10px 0 0;display:flex;align-items:center;gap:9px;padding:0 14px;font-size:13px;color:#222}
    .tab .fav{width:16px;height:16px;border-radius:50%;background:#1d3658;display:flex;align-items:center;justify-content:center}.tab .fav:after{content:"";width:8px;height:3px;background:#fff;border-radius:2px}
    .tab .x{margin-left:auto;color:#777;font-size:16px}
    .plus{margin:0 0 7px 12px;color:#666;font-size:20px}
    .tool{height:52px;background:#f6f6f8;display:flex;align-items:center;padding:0 16px;gap:16px;border-bottom:1px solid #d3d4d8;color:#6a6a70;font-size:19px}
    .url{flex:1;height:34px;background:#e8e9ed;border-radius:17px;display:flex;align-items:center;padding:0 16px;font-size:14.5px;color:#222;gap:9px}.url span{color:#888}
    .dot{width:26px;height:26px;border-radius:50%;background:#7a6cf0;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;font-weight:700}
  </style>
  <div class="menubar"><b>&#63743;</b><b>Chrome</b><span>File</span><span>Edit</span><span>View</span><span>History</span><span>Bookmarks</span><span>Window</span><span>Help</span>
    <div class="r"><span>⌁</span><span>􀙇</span><span>Sun 4 Oct&nbsp; 9:41 AM</span></div></div>
  <div class="win">
    <div class="tabs"><div class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
      <div class="tab"><div class="fav"></div>Downtown Drive<span class="x">×</span></div><div class="plus">+</div></div>
    <div class="tool"><span>←</span><span style="opacity:.45">→</span><span>⟳</span>
      <div class="url"><span>🔒</span>localhost:5173</div><span>☆</span><span>⬇</span><div class="dot">F</div><span>⋮</span></div>
  </div>`);
  await page.screenshot({ path: 'smoke-output/tour/chrome.png' });
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------- the tour
type Act = { t: number; kind: 'move' | 'click' | 'key' | 'js'; sel?: string; key?: string; js?: string; dur?: number };
const seg = (k: string, v: string) => `.seg[data-k=${k}] button[data-v=${v}]`;
const acts: Act[] = [
  { t: 0.6, kind: 'move', sel: 'button[data-a=settings]', dur: 0.7 }, { t: 1.4, kind: 'click', sel: 'button[data-a=settings]' },
  { t: 1.9, kind: 'move', sel: seg('quality', 'high'), dur: 0.5 }, { t: 2.45, kind: 'click', sel: seg('quality', 'high') },
  { t: 2.8, kind: 'move', sel: seg('scene', 'dawn'), dur: 0.4 }, { t: 3.25, kind: 'click', sel: seg('scene', 'dawn') },
  { t: 3.6, kind: 'move', sel: seg('scene', 'day'), dur: 0.3 }, { t: 3.95, kind: 'click', sel: seg('scene', 'day') },
  { t: 4.3, kind: 'move', sel: seg('scene', 'afternoon'), dur: 0.3 }, { t: 4.65, kind: 'click', sel: seg('scene', 'afternoon') },
  { t: 5.0, kind: 'move', sel: seg('scene', 'evening'), dur: 0.3 }, { t: 5.35, kind: 'click', sel: seg('scene', 'evening') },
  { t: 5.7, kind: 'move', sel: seg('scene', 'night'), dur: 0.3 }, { t: 6.05, kind: 'click', sel: seg('scene', 'night') },
  { t: 6.4, kind: 'move', sel: seg('rain', 'true'), dur: 0.4 }, { t: 6.9, kind: 'click', sel: seg('rain', 'true') },
  { t: 7.5, kind: 'move', sel: 'button[data-a=back]', dur: 0.5 }, { t: 8.1, kind: 'click', sel: 'button[data-a=back]' },
  { t: 8.4, kind: 'move', sel: 'button[data-a=play]', dur: 0.4 }, { t: 8.9, kind: 'click', sel: 'button[data-a=play]' },
  { t: 9.0, kind: 'js', js: `window.__game.autopilotKmh = 118` },
  { t: 16.4, kind: 'key', key: 'KeyC' }, { t: 17.2, kind: 'key', key: 'KeyC' }, { t: 18.0, kind: 'key', key: 'KeyC' },
  { t: 21.0, kind: 'key', key: 'KeyC' },
  { t: 21.6, kind: 'key', key: 'Escape' },
  { t: 22.0, kind: 'move', sel: 'button[data-a=settings]', dur: 0.5 }, { t: 22.6, kind: 'click', sel: 'button[data-a=settings]' },
  { t: 23.0, kind: 'move', sel: seg('scene', 'afternoon'), dur: 0.4 }, { t: 23.5, kind: 'click', sel: seg('scene', 'afternoon') },
  { t: 23.8, kind: 'move', sel: seg('rain', 'false'), dur: 0.3 }, { t: 24.2, kind: 'click', sel: seg('rain', 'false') },
  { t: 24.5, kind: 'move', sel: 'button[data-a=back]', dur: 0.3 }, { t: 24.9, kind: 'click', sel: 'button[data-a=back]' },
  { t: 25.2, kind: 'move', sel: 'button[data-a=resume]', dur: 0.3 }, { t: 25.6, kind: 'click', sel: 'button[data-a=resume]' },
];

const setup = `(() => {
  const g = window.__game;
  g.renderer.renderer.setAnimationLoop(null);
  g.renderer.dynamicResolution = false;
  g.renderer.resize();
  window.__t = performance.now() + 1000;
  document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent';
  document.getElementById('game').style.visibility = 'hidden';
  const cur = document.createElement('div');
  cur.id = 'cur';
  cur.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;z-index:99999;pointer-events:none;transform:translate(1200px,520px);filter:drop-shadow(0 3px 5px rgba(0,0,0,.5))';
  cur.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M3 2l15 9-6.5 1.6L9 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cur);
  const ring = document.createElement('div');
  ring.id = 'ring';
  ring.style.cssText = 'position:fixed;left:0;top:0;width:44px;height:44px;margin:-6px 0 0 -6px;border-radius:50%;border:3px solid rgba(255,255,255,.9);z-index:99998;pointer-events:none;opacity:0';
  document.body.appendChild(ring);
  g.scriptDrive = (d) => { const T = window.__T; d.nitro = (T > 13 && T < 16.2) || (T > 26.2 && T < 29); };
  g.rig.mode = 'chase';
})()`;

const COMPOSE_ONLY = !!process.env.COMPOSE_ONLY;
if (!COMPOSE_ONLY) await drawChrome();
const { errors } = COMPOSE_ONLY ? { errors: [] as string[] } : await withGame(async (open) => {
  const page = await open(`capture&shots=1`, GW, GH, 1); // no ?hour / ?quality so the settings screen really drives it
  await page.waitForTimeout(2500);
  await page.evaluate(setup);
  const step = (T: number) => `(() => { const g = window.__game; window.__T = ${T}; window.__t += 1000 / ${FPS}; g.frame(window.__t); })()`;
  // let the menu scene settle
  for (let i = 0; i < 45; i++) await page.evaluate(step(0));
  await page.evaluate(`window.__game.renderer.resize()`);
  for (let i = 0; i < 8; i++) await page.evaluate(step(0));
  let cx = 1200, cy = 520, from = { x: cx, y: cy }, to = { x: cx, y: cy }, moveStart = 0, moveDur = 0.01, ringT = -1;
  let ai = 0;
  const total = FPS * SECONDS;
  for (let i = 0; i < total; i++) {
    const T = i / FPS;
    while (ai < acts.length && T >= acts[ai].t) {
      const a = acts[ai++];
      if (a.kind === 'move' || a.kind === 'click') {
        const r = (await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(a.sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width * 0.5, y: b.top + b.height * 0.5 }; })()`)) as { x: number; y: number } | null;
        if (!r) console.warn('missing', a.sel);
        else if (a.kind === 'move') {
          from = { x: cx, y: cy };
          to = { x: r.x, y: r.y };
          moveStart = T;
          moveDur = a.dur ?? 0.5;
        } else {
          await page.evaluate(`document.querySelector(${JSON.stringify(a.sel)}).click()`);
          ringT = T;
        }
      } else if (a.kind === 'key') await page.keyboard.press(a.key!);
      else await page.evaluate(a.js!);
    }
    // cursor easing + click ring
    const u = Math.min(1, Math.max(0, (T - moveStart) / moveDur)), e = u * u * (3 - 2 * u);
    cx = from.x + (to.x - from.x) * e;
    cy = from.y + (to.y - from.y) * e;
    const rt = ringT >= 0 ? (T - ringT) / 0.35 : 2;
    await page.evaluate(`(() => { const c = document.getElementById('cur'), r = document.getElementById('ring');
      c.style.transform = 'translate(${cx.toFixed(1)}px,${cy.toFixed(1)}px)';
      r.style.transform = 'translate(${cx.toFixed(1)}px,${cy.toFixed(1)}px) scale(${(0.4 + Math.min(1, Math.max(0, rt)) * 1.1).toFixed(2)})';
      r.style.opacity = '${rt >= 0 && rt < 1 ? (1 - rt).toFixed(2) : 0}'; })()`);
    const url = (await page.evaluate(`(${step(T)}, document.getElementById('game').toDataURL('image/jpeg', 0.92))`)) as string;
    writeFileSync(`${dirs.cv}/${String(i).padStart(4, '0')}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
    await page.screenshot({ path: `${dirs.ui}/${String(i).padStart(4, '0')}.png`, omitBackground: true });
    if (i % 60 === 0) console.log(`frame ${i}/${total}`);
  }
});
console.log(errors.filter((x) => !x.includes('deprecated')).slice(0, 5).join('\n') || 'no console errors');

// ---------------------------------------------------------------------------------------------------- compose
const bold = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
const caps: [number, number, string][] = [
  [0.3, 2.4, 'Arcade street racing, live in your browser'],
  [2.4, 6.9, 'Pick any time of day - dawn, day, afternoon, evening, night'],
  [6.9, 8.4, 'Add rain to any of them'],
  [9.2, 13, 'Real Los Angeles streets, rain-soaked and reflective'],
  [13.1, 16.2, 'Nitrous - flames, speed lines, wind roar'],
  [16.4, 21, 'Chase · hood · cockpit cameras, with wipers'],
  [21.7, 25.6, 'Change time and weather mid-drive'],
  [26.0, 29, 'Drift, boost, repeat'],
];
const cap = caps
  .map(([a, b, t]) => `drawtext=fontfile=${bold}:text='${t.replace(/'/g, '')}':fontsize=34:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=16:x=(w-text_w)/2:y=${WY + BAR + 40}:enable='between(t,${a},${b})'`)
  .join(',');
const filter = [
  `[0:v][1:v]overlay=format=auto[g]`,
  `[2:v]split=3[c0][c1][c2]`,
  `[c0][g]overlay=${WX}:${WY + BAR}:shortest=1[w]`,
  `[c1]crop=24:24:${WX}:${WY + BAR + GH - 24}[cl]`,
  `[c2]crop=24:24:${WX + GW - 24}:${WY + BAR + GH - 24}[cr]`,
  `[w][cl]overlay=${WX}:${WY + BAR + GH - 24}[w2]`,
  `[w2][cr]overlay=${WX + GW - 24}:${WY + BAR + GH - 24}[w3]`,
  `[w3]${cap},fade=t=in:st=0:d=0.5,fade=t=out:st=29.3:d=0.7[v]`,
  `[3:a]atrim=0.5:30.5,asetpts=PTS-STARTPTS,volume=1.4,adelay=8900|8900,afade=t=in:st=8.9:d=0.5,afade=t=out:st=28:d=1.8[eng]`,
  `[4:a]aloop=loop=-1:size=400000,atrim=0:23,adelay=7000|7000,volume=0.5,afade=t=in:st=7:d=1.5,afade=t=out:st=24:d=1[rain]`,
  `[5:a]asplit=2[n1][n2]`,
  `[n1]adelay=13000|13000,volume=0.6[nos]`,
  `[n2]adelay=26200|26200,volume=0.6[nos2]`,
  `[eng][rain][nos][nos2]amix=inputs=4:normalize=0,alimiter=limit=0.95[a]`,
].join(';');
execSync(
  `ffmpeg -v error -y -framerate ${FPS} -i ${dirs.cv}/%04d.jpg -framerate ${FPS} -i ${dirs.ui}/%04d.png -loop 1 -framerate ${FPS} -i smoke-output/tour/chrome.png ` +
    `-i assets-src/audio/freesound-496171-editboy23-import-car-dyno-turbo.mp3 -i public/audio/rain.wav -i public/audio/nitro.wav ` +
    `-filter_complex "${filter}" -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k -t ${SECONDS} showcase/downtown-drive-tour-30s.mp4`,
  { stdio: 'inherit' },
);
execSync(`ffmpeg -v error -y -i showcase/downtown-drive-tour-30s.mp4 -vf "fps=1/3,scale=640:-1,tile=5x2" -frames:v 1 smoke-output/tour-sheet.jpg`);
console.log('done → showcase/downtown-drive-tour-30s.mp4');
