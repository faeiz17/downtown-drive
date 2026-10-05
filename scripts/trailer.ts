/**
 * 45 s Need-for-Speed-style trailer → showcase/downtown-drive-trailer-45s.mp4 (+ 9:16 cut).
 *   npx tsx scripts/trailer.ts preview [aspect]                 one frame per shot (contact sheets) to check the cameras
 *   npx tsx scripts/trailer.ts render  [aspect] [seq,seq,…]     render every shot (crashes are re-taken automatically); optional subset
 *   npx tsx scripts/trailer.ts post    [aspect]                 grade, titles, audio mastering, final encode
 * aspect = landscape (rendered 2.39:1 and letterboxed into 1920×1080) | portrait (1080×1920, reframed per shot)
 * Needs scripts/trailer/audio.py to have been run (smoke-output/trailer/audio-raw.wav) and smoke-output/drift-takes.json
 * from scripts/trailer/rehearse.ts.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { withGame } from './shot';

const mode = process.argv[2] ?? 'preview';
const aspect = (process.argv[3] ?? 'landscape') as 'landscape' | 'portrait';
const only = (process.argv[4] ?? '').split(',').filter(Boolean);
const portrait = aspect === 'portrait';
const VW = portrait ? 1080 : 1920, VH = portrait ? 1920 : 804; // landscape is rendered at 2.39:1 and letterboxed to 1080p
const root = 'smoke-output/trailer';
const core = readFileSync('scripts/trailer/core.js', 'utf8');
const shots = readFileSync('scripts/trailer/shots.js', 'utf8');

// ---- takes: clean ghost-mode drift paths from the rehearsals
type Take = { x: number; z: number; name: string; kmh: number; dir: number; hold: number; flip: number; clr: number; roll: number; slip: number; end: number; path: number[][] };
const order = ['open', 'launch', 'montage', 'drift1', 'drift2', 'drift3', 'drift4', 'nitro', 'timelapse', 'puddle', 'cuts', 'final', 'plate'];

function pickTakes() {
  const all = JSON.parse(readFileSync('smoke-output/drift-takes.json', 'utf8')) as Take[];
  const clean = all.filter((q) => q.clr > 2.5 && q.roll < 20 && q.slip > 28 && q.end > 30);
  const oly = clean.filter((q) => /Olympic/.test(q.name)).sort((a, b) => b.clr - a.clr);
  const seen = new Set<string>();
  const olyPick: Take[] = [];
  for (const q of oly) { const k = `${q.kmh}${q.dir}${q.flip}`; if (!seen.has(k)) { seen.add(k); olyPick.push(q); } }
  const first = clean.filter((q) => /1st Street/.test(q.name)).sort((a, b) => b.clr - a.clr)[0];
  const picked = [olyPick[0], olyPick[1], olyPick[2], olyPick[3] ?? olyPick[0], first ?? olyPick[4] ?? olyPick[0]];
  const takes = picked.map((q) => ({ sx: q.path[0][0], sz: q.path[0][1], h0: q.path[0][2], kmh: q.kmh, dir: q.dir, hold: q.hold, clr: q.clr, name: q.name, path: q.path }));
  const olympic = { x: takes[0].sx + Math.sin(takes[0].h0) * 30, z: takes[0].sz + Math.cos(takes[0].h0) * 30, h: takes[0].h0 };
  return { takes, olympic };
}

async function run() {
  const { takes, olympic } = pickTakes();
  const dir = `${root}/${mode === 'preview' ? 'preview' : aspect}`;
  if (mode === 'render' && !only.length) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const reportFile = `${dir}/report.json`;
  const report: Record<string, unknown> = mode === 'render' && only.length && existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : {};
  const { errors } = await withGame(async (open) => {
    const page = await open(`capture&autoplay&quality=high&shots=1`, VW, VH, 1);
    await page.waitForTimeout(2500);
    await page.evaluate(core);
    await page.evaluate(`window.__T2.init(${portrait})`);
    await page.evaluate(`window.__T2.cfg = ${JSON.stringify({ takes, olympic })}`);
    await page.evaluate(shots);
    for (const name of order) {
      if (only.length && !only.includes(name)) continue;
      let rep: Record<string, unknown> = {};
      let info: { frames: number; shots: { id: string; t0: number; t1: number }[] } | null = null;
      for (let variant = 0; variant < 4; variant++) {
        const sd = `${dir}/${name}`;
        rmSync(sd, { recursive: true, force: true });
        mkdirSync(sd, { recursive: true });
        info = (await page.evaluate(`window.__T2.begin('${name}', ${variant}, ${portrait})`)) as typeof info;
        const want = new Set<number>();
        if (mode === 'preview') for (const s of info!.shots) want.add(Math.round(((s.t0 + s.t1) / 2) * 30));
        for (let i = 0; i < info!.frames; i++) {
          const cap = mode === 'preview' ? want.has(i) : true;
          if (mode === 'preview') await page.evaluate(`window.__game.renderEnabled = ${cap}`);
          const url = (await page.evaluate(`window.__T2.render(${i}, ${cap}, ${mode === 'preview' ? 0.8 : 0.93})`)) as string | null;
          if (url) writeFileSync(`${sd}/${String(i).padStart(4, '0')}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
        }
        await page.evaluate(`window.__game.renderEnabled = true`);
        rep = (await page.evaluate(`window.__T2.end()`)) as Record<string, unknown>;
        console.log(`${name} variant ${variant}: ${JSON.stringify(rep)}`);
        if (rep.ok) break;
      }
      report[name] = { ...rep, frames: info!.frames, shots: info!.shots };
    }
  });
  writeFileSync(reportFile, JSON.stringify(report, null, 1));
  console.log(errors.filter((e) => !e.includes('deprecated')).slice(0, 6).join('\n') || 'no console errors');
  if (mode === 'preview') {
    const files: string[] = [];
    for (const name of order) for (const s of (report[name] as { shots: { id: string; t0: number; t1: number }[] }).shots) {
      const f = `${dir}/${name}/${String(Math.round(((s.t0 + s.t1) / 2) * 30)).padStart(4, '0')}.jpg`;
      if (existsSync(f)) files.push(`${s.id}|${f}`);
    }
    const cols = 4, w = 480;
    for (let page = 0; page * 16 < files.length; page++) {
      const part = files.slice(page * 16, page * 16 + 16);
      const inputs = part.map((p) => `-i ${p.split('|')[1]}`).join(' ');
      const fc = part.map((p, i) => `[${i}]scale=${w}:-1,drawtext=text='${p.split('|')[0]}':x=6:y=6:fontsize=18:fontcolor=yellow:box=1:boxcolor=black@0.6[s${i}]`).join(';') + ';' + part.map((_, i) => `[s${i}]`).join('') + `xstack=inputs=${part.length}:layout=${part.map((_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * Math.round((w * VH) / VW)}`).join('|')}`;
      execSync(`ffmpeg -v error -y ${inputs} -filter_complex "${fc}" -frames:v 1 ${root}/preview-${aspect}-${page + 1}.jpg`);
    }
    console.log('contact sheets: ' + root + '/preview-' + aspect + '-N.jpg');
  }
}

// =============================================================================================== title card frames
/** Transparent PNG sequence for the title: slam-in, RGB-split glitch with sliced offsets, tagline / call-to-action fade-ins. */
async function renderTitle(dir: string, frames: number, W: number, H: number): Promise<void> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const lines = portrait ? ['DOWNTOWN', 'DRIVE'] : ['DOWNTOWN DRIVE'];
  const size = portrait ? 205 : 165;
  const top = portrait ? 0.27 * H : 0.17 * H;
  const s1y = portrait ? top + size * 2.1 : top + size * 1.2;
  await page.setContent(`<style>
    html,body{margin:0;background:transparent;width:${W}px;height:${H}px;overflow:hidden}
    .scrim{position:absolute;left:0;top:0;width:100%;height:100%;background:radial-gradient(ellipse 70% 38% at 50% ${portrait ? 40 : 52}%,rgba(0,0,0,.62),rgba(0,0,0,0) 72%)}
    .wrap{position:absolute;left:0;top:${top}px;width:100%;text-align:center;font-family:Impact,"Haettenschweiler","Arial Narrow Bold",sans-serif;font-size:${size}px;line-height:${size * 0.96}px;letter-spacing:6px;color:#fff;text-transform:uppercase}
    .l{position:absolute;left:0;top:0;width:100%;transform-origin:50% 55%;white-space:nowrap}
    .sub{position:absolute;left:0;width:100%;text-align:center;font-family:"Arial Narrow","Helvetica Neue",Arial,sans-serif;font-weight:800;color:#fff;text-shadow:0 3px 12px rgba(0,0,0,.7)}
  </style><div class="scrim" id="scrim"></div><div class="wrap" id="w" style="height:${size * lines.length}px">${[0, 1, 2, 3, 4].map((k) => `<div class="l" id="l${k}">${lines.map((t) => `<div>${t}</div>`).join('')}</div>`).join('')}</div>
  <div id="ics" style="position:absolute;left:0;top:${s1y}px;width:100%;display:flex;justify-content:center;gap:${portrait ? 44 : 78}px">${ICONS.map((ic, k) => `<div id="ic${k}" style="text-align:center;opacity:0"><svg width="${portrait ? 118 : 100}" height="${portrait ? 118 : 100}" viewBox="0 0 100 100" style="filter:drop-shadow(0 3px 8px rgba(0,0,0,.75))">${ic.svg}</svg><div style="font:800 ${portrait ? 25 : 22}px 'Arial Narrow',Arial,sans-serif;letter-spacing:4px;color:#fff;margin-top:8px;text-shadow:0 2px 8px #000">${ic.label}</div></div>`).join('')}</div>
  <div class="sub" id="s2" style="top:${s1y + (portrait ? 220 : 164)}px;font-size:${portrait ? 64 : 50}px;letter-spacing:14px">PLAY IN YOUR BROWSER</div>`);
  await page.evaluate(`(() => {
    window.__t = (f) => {
      const t = f / 30, ease = (u) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
      let seed = f * 9301 + 49297; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const slam = t < 0.14 ? 1 + (1 - ease(t / 0.14)) * 1.5 : 1;
      const glitching = t < 0.6 || (t > 1.5 && t < 1.58) || (t > 2.55 && t < 2.62);
      const set = (id, css) => Object.assign(document.getElementById(id).style, css);
      const amp = t < 0.6 ? 34 * (1 - t / 0.6) + 6 : 24;
      set('l0', { color: '#00e5ff', opacity: glitching ? 0.85 : 0, transform: 'translateX(' + ((rnd() - 0.5) * 2 * amp) + 'px) scale(' + slam + ')', mixBlendMode: 'screen' });
      set('l1', { color: '#ff2a55', opacity: glitching ? 0.85 : 0, transform: 'translateX(' + ((rnd() - 0.5) * 2 * amp) + 'px) scale(' + slam + ')', mixBlendMode: 'screen' });
      set('l2', { opacity: Math.min(1, t * 30), transform: 'translateX(' + (glitching ? (rnd() - 0.5) * 12 : 0) + 'px) scale(' + slam + ')', textShadow: '6px 6px 0 rgba(0,0,0,.55), 0 0 40px rgba(0,0,0,.6)' });
      for (const k of [3, 4]) {
        const a = rnd() * 80, b = a + 6 + rnd() * 14;
        set('l' + k, { opacity: glitching ? 1 : 0, clipPath: 'inset(' + a + '% 0 ' + (100 - b) + '% 0)', transform: 'translateX(' + ((rnd() - 0.5) * 2 * amp * 2.2) + 'px) scale(' + slam + ')' });
      }
      set('scrim', { opacity: Math.min(1, t * 6) });
      for (let k = 0; k < 4; k++) { const e = document.getElementById('ic' + k); const u = Math.min(1, Math.max(0, (t - 0.9 - k * 0.18) * 6)); e.style.opacity = u; e.style.transform = 'translateY(' + ((1 - u) * 18) + 'px) scale(' + (0.8 + 0.2 * u) + ')'; }
      set('s2', { opacity: Math.min(1, Math.max(0, (t - 1.5) * 5)) });
    };
  })()`);
  for (let f = 0; f < frames; f++) {
    await page.evaluate(`window.__t(${f})`);
    await page.screenshot({ path: `${dir}/${String(f).padStart(4, '0')}.png`, omitBackground: true });
  }
  await browser.close();
}

const W_ = '#fff';
const ICONS = [
  { label: 'NIGHT / DAY', svg: `<g fill="#ffd23f"><circle cx="30" cy="50" r="13"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect x="28.5" y="22" width="3" height="9" rx="1.5" transform="rotate(${a} 30 50)"/>`).join('')}</g><path d="M82 30a24 24 0 1 0 6 36 20 20 0 0 1-6-36z" fill="${W_}"/>` },
  { label: 'RAIN', svg: `<path d="M28 58a15 15 0 0 1 3-29 20 20 0 0 1 38-3 16 16 0 0 1 3 32z" fill="${W_}"/><g stroke="#35c8ff" stroke-width="5" stroke-linecap="round"><path d="M32 70l-5 14M50 70l-5 14M68 70l-5 14"/></g>` },
  { label: 'NITRO', svg: `<path d="M58 6L22 56h24l-8 38 40-54H54z" fill="#35c8ff" stroke="${W_}" stroke-width="3" stroke-linejoin="round"/>` },
  { label: 'NO BRAKES', svg: `<circle cx="50" cy="50" r="30" fill="none" stroke="${W_}" stroke-width="9"/><circle cx="50" cy="50" r="9" fill="${W_}"/><g fill="${W_}">${[0, 72, 144, 216, 288].map((a) => `<circle cx="50" cy="29" r="3.2" transform="rotate(${a} 50 50)"/>`).join('')}</g><circle cx="50" cy="50" r="44" fill="none" stroke="#ff2a3d" stroke-width="7"/><path d="M19 81L81 19" stroke="#ff2a3d" stroke-width="7" stroke-linecap="round"/>` },
];

// =============================================================================================== browser window
/** Desktop + macOS-style Chrome window (opaque PNG); the game video is overlaid on the viewport area. */
async function drawChrome(file: string, DW: number, DH: number, WX: number, WY: number, GW: number, GH: number, BAR: number): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: DW, height: DH } });
  await page.setContent(`<style>
    *{box-sizing:border-box;margin:0} body{width:${DW}px;height:${DH}px;overflow:hidden;font-family:-apple-system,"SF Pro Text","Helvetica Neue",Arial,sans-serif;
      background:radial-gradient(${DW * 0.6}px ${DH * 0.6}px at 78% 18%,#6f5cc9 0%,rgba(111,92,201,0) 60%),radial-gradient(${DW * 0.5}px ${DH * 0.7}px at 12% 90%,#1d6fa5 0%,rgba(29,111,165,0) 60%),linear-gradient(135deg,#1b1740,#30206b 45%,#0f3b63)}
    .menubar{position:absolute;left:0;top:0;width:100%;height:28px;background:rgba(20,18,40,.55);color:#fff;font-size:13.5px;display:flex;align-items:center;padding:0 14px;gap:22px;white-space:nowrap;overflow:hidden}
    .menubar b{font-weight:700}.menubar .r{margin-left:auto;display:flex;gap:18px;opacity:.95}
    .win{position:absolute;left:${WX}px;top:${WY}px;width:${GW}px;height:${BAR + GH}px;border-radius:12px;background:#000;box-shadow:0 40px 90px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.18);overflow:hidden}
    .tabs{height:44px;background:#dcdde1;display:flex;align-items:flex-end;padding:0 14px;position:relative}
    .lights{position:absolute;left:16px;top:14px;display:flex;gap:8px}.lights i{width:13px;height:13px;border-radius:50%;display:block}
    .tab{margin-left:78px;height:34px;width:248px;background:#f6f6f8;border-radius:10px 10px 0 0;display:flex;align-items:center;gap:9px;padding:0 14px;font-size:13px;color:#222}
    .tab .fav{width:16px;height:16px;border-radius:50%;background:#1d3658}.tab .x{margin-left:auto;color:#777;font-size:16px}
    .plus{margin:0 0 7px 12px;color:#666;font-size:20px}
    .tool{height:52px;background:#f6f6f8;display:flex;align-items:center;padding:0 16px;gap:16px;border-bottom:1px solid #d3d4d8;color:#6a6a70;font-size:19px}
    .url{flex:1;height:34px;background:#e8e9ed;border-radius:17px;display:flex;align-items:center;padding:0 16px;font-size:14.5px;color:#222;gap:9px}.url span{color:#888}
    .dot{width:26px;height:26px;border-radius:50%;background:#7a6cf0;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;font-weight:700}
  </style>
  <div class="menubar"><b>&#63743;</b><b>Chrome</b><span>File</span><span>Edit</span><span>View</span><span>History</span><span>Bookmarks</span><span>Window</span><span>Help</span>
    <div class="r"><span>Sun 4 Oct&nbsp; 9:41 AM</span></div></div>
  <div class="win"><div class="tabs"><div class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
      <div class="tab"><div class="fav"></div>Downtown Drive<span class="x">×</span></div><div class="plus">+</div></div>
    <div class="tool"><span>←</span><span style="opacity:.45">→</span><span>⟳</span><div class="url"><span>🔒</span>localhost:5173</div><span>☆</span><span>⬇</span><div class="dot">F</div><span>⋮</span></div></div>`);
  await page.screenshot({ path: file });
  await browser.close();
}

// =============================================================================================== post
type Rep = Record<string, { frames: number; shots: { id: string; t0: number; t1: number }[] }>;
async function post() {
  const dir = `${root}/${aspect}`;
  const rep = JSON.parse(readFileSync(`${dir}/report.json`, 'utf8')) as Rep;
  const seqOrder = [...order.slice(0, order.indexOf('plate'))];
  const lines: string[] = [];
  const starts: Record<string, number> = {};
  const streak: [number, number][] = [];
  let frame = 0;
  const fd = 1 / 30;
  for (const name of seqOrder) {
    starts[name] = frame;
    for (let i = 0; i < rep[name].frames; i++) lines.push(`file '${process.cwd()}/${dir}/${name}/${String(i).padStart(4, '0')}.jpg'\nduration ${fd}`);
    for (const s of rep[name].shots) if (/M6|C5/.test(s.id)) streak.push([(frame + Math.round(s.t0 * 30)) / 30, (frame + Math.round(s.t1 * 30)) / 30]);
    frame += rep[name].frames;
  }
  const freezeStart = frame / 30;
  const lastFinal = `${process.cwd()}/${dir}/final/${String(rep.final.frames - 1).padStart(4, '0')}.jpg`;
  for (let i = 0; i < 23; i++) lines.push(`file '${lastFinal}'\nduration ${fd}`), frame++;
  const titleT = frame / 30;
  for (let i = 0; i < rep.plate.frames; i++) lines.push(`file '${process.cwd()}/${dir}/plate/${String(i).padStart(4, '0')}.jpg'\nduration ${fd}`), frame++;
  lines.push(`file '${process.cwd()}/${dir}/plate/${String(rep.plate.frames - 1).padStart(4, '0')}.jpg'`);
  writeFileSync(`${dir}/frames.txt`, lines.join('\n'));
  const total = frame / 30;
  console.log(`frames ${frame} (${total.toFixed(3)} s), freeze at ${freezeStart.toFixed(3)}, title at ${titleT.toFixed(3)}, streak shots ${JSON.stringify(streak)}`);
  writeFileSync(`${dir}/timing.json`, JSON.stringify({ total, freezeStart, titleT, starts, streak }));

  const W = portrait ? 1080 : 1920, H = portrait ? 1920 : 804, OW = W, OH = H;
  // the finished video sits in a macOS Chrome window on a desktop (landscape 1920x1080, portrait 1080x1920)
  const BAR = 96, DW = portrait ? 1080 : 1920, DH = portrait ? 1920 : 1080;
  const GW = portrait ? 972 : 1760, GH = portrait ? 1728 : 736;
  const WX = Math.round((DW - GW) / 2), WY = Math.round((DH + 28 - BAR - GH) / 2);
  await drawChrome(`${dir}/chrome.png`, DW, DH, WX, WY, GW, GH, BAR);
  const tx = titleT;
  const dt = (a: number, b: number) => `between(t,${(tx + a).toFixed(3)},${(tx + b).toFixed(3)})`;
  await renderTitle(`${dir}/title`, Math.ceil((total - titleT) * 30) + 2, OW, OH);
  // white flash at the slam
  const flash = [[0, 0.04, 1.0], [0.04, 0.09, 0.65], [0.09, 0.15, 0.35], [0.15, 0.24, 0.14]].map(([a, b, al]) => `drawbox=x=0:y=0:w=iw:h=ih:color=white@${al}:t=fill:enable='${dt(a, b)}'`);
  const lagWin = streak.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+') || '0';
  const zf = `clip((t-${freezeStart.toFixed(3)})/0.778,0,1)*between(t,${freezeStart.toFixed(3)},${titleT.toFixed(3)})`;
  const zoom = `scale=w='iw*(1+0.05*${zf})':h='ih*(1+0.05*${zf})':eval=frame,crop=${W}:${H}`;
  const d2 = starts.drift2 / 30;
  const filter = [
    `[0:v]fps=30,format=yuv420p,${zoom},setsar=1[src]`,
    `[src]split=2[s1][s2]`,
    `[s2]lagfun=decay=0.93[lag]`,
    `[s1][lag]overlay=enable='${lagWin}':format=auto,format=gbrp[base]`,
    // grade: teal shadows / warm highlights, deep but not crushed blacks (eq runs in YUV, the rest in RGB planes)
    `[base]format=yuv420p,eq=contrast=1.06:saturation=1.10:gamma=1.05,format=gbrp,colorbalance=rs=-0.07:gs=0.01:bs=0.10:rm=-0.01:bm=0.02:rh=0.07:bh=-0.06,curves=all='0/0.01 0.15/0.10 0.5/0.52 0.85/0.88 1/0.97',split=3[g0][g1][g2]`,
    // strong bloom on lights, plus anamorphic horizontal streaks (blue) from the brightest points
    `[g1]curves=all='0/0 0.6/0 0.8/0.45 1/1',gblur=sigma=${portrait ? 16 : 20}[bloom]`,
    `[g2]curves=all='0/0 0.85/0 0.95/0.5 1/1',gblur=sigma=${portrait ? 70 : 110}:sigmaV=1.2,colorchannelmixer=rr=0.4:gg=0.8:bb=1.5[flare]`,
    `[g0][bloom]blend=all_mode=screen:all_opacity=0.40[b1]`,
    // warm dawn look for the dawn drift shot, then film look: chromatic aberration, grain, vignette
    `[b1][flare]blend=all_mode=screen:all_opacity=0.55,colorbalance=rm=0.10:gm=0.02:bm=-0.10:rh=0.16:gh=0.05:bh=-0.14:rs=0.06:bs=-0.05:enable='between(t,${d2.toFixed(3)},${(d2 + 2.667).toFixed(3)})',format=yuv420p,rgbashift=rh=-2:bh=2:rv=0,noise=alls=8:allf=t+u,vignette=PI/4.6,unsharp=5:5:0.4[graded]`,
    `[graded]null[padded]`,
    `[padded][1:v]overlay=eof_action=pass:format=auto,${flash.join(',')},scale=${GW}:${GH}[vs]`,
    `[2:v][vs]overlay=${WX}:${WY + BAR}:format=auto,fade=t=in:st=0:d=0.45:color=black[v]`,
  ].join(';');
  writeFileSync(`${dir}/filter.txt`, filter);
  const vout = `${dir}/video.mp4`;
  execSync(`ffmpeg -v error -y -f concat -safe 0 -i ${dir}/frames.txt -itsoffset ${titleT.toFixed(3)} -framerate 30 -i ${dir}/title/%04d.png -loop 1 -framerate 30 -i ${dir}/chrome.png -filter_complex "${filter}" -map "[v]" -c:v libx264 -preset slow -crf 19 -maxrate 32M -bufsize 64M -pix_fmt yuv420p -r 30 -t ${total.toFixed(3)} ${vout}`, { stdio: 'inherit' });
  // audio: master to about -14 LUFS (two-pass loudnorm), then mux
  const raw = `${root}/audio-raw.wav`;
  const meas = execSync(`ffmpeg -v info -i ${raw} -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p'`).toString();
  const j = JSON.parse(meas);
  const mastered = `${root}/audio.wav`;
  execSync(`ffmpeg -v error -y -i ${raw} -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,alimiter=limit=0.89:level=disabled" -ar 48000 ${mastered}`);
  // loudnorm leaves a little headroom error after the limiter: measure the result and trim to -14.0 LUFS
  const lufs = (f: string) => parseFloat((execSync(`ffmpeg -nostats -i ${f} -af ebur128 -f null - 2>&1 | grep -A3 Summary | grep "I:" | awk '{print $2}'`).toString().trim()) || '-14');
  for (let pass = 0; pass < 3; pass++) {
    const delta = -14 - lufs(mastered);
    if (Math.abs(delta) <= 0.2) break;
    const trimmed = `${root}/audio-trim.wav`;
    execSync(`ffmpeg -v error -y -i ${mastered} -af "volume=${delta.toFixed(2)}dB,alimiter=limit=0.89:level=disabled" ${trimmed}`);
    execSync(`mv ${trimmed} ${mastered}`);
  }
  console.log(`audio integrated loudness ${lufs(mastered).toFixed(1)} LUFS`);
  const final = portrait ? 'showcase/downtown-drive-trailer-45s-vertical.mp4' : 'showcase/downtown-drive-trailer-45s.mp4';
  execSync(`ffmpeg -v error -y -i ${vout} -i ${mastered} -c:v copy -c:a aac -b:a 320k -t ${total.toFixed(3)} -movflags +faststart ${final}`);
  console.log('wrote', final);
}

if (mode === 'preview' || mode === 'render') await run();
if (mode === 'post') await post();
