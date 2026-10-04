/**
 * Renders a 15 s cinematic of the game (1920×1080, 30 fps) frame by frame, then adds title, fades and sound.
 *   npx tsx scripts/cinematic.ts            → showcase/downtown-drive-15s.mp4
 * Shots: 1 dusk hero orbit · 2 rainy night chase with nitro · 3 trackside pass-by on nitro · 4 cockpit in rain
 *        · 5 afternoon pull-back to the skyline + title.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { withGame } from './shot';

const FPS = 30, SECONDS = 15, W = 1920, H = 1080;
const frames = 'smoke-output/cine';
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
mkdirSync('showcase', { recursive: true });

const setup = `(() => {
  const g = window.__game;
  g.renderer.renderer.setAnimationLoop(null);
  g.renderer.dynamicResolution = false;
  g.hud.visible = false;
  g.autopilotKmh = 125;
  window.__T = 0; window.__fix = null; window.__t = performance.now() + 1000;
  window.__scene = (hour, rain, mode) => {
    g.dayNight.hour = hour; g.rainTarget = rain; g.rain = rain; g.wet = rain;
    g.car.headlightsOn = hour > 18.5 || hour < 6;
    g.rig.mode = mode; g.rig.snap();
  };
  window.__scene(18.65, 0, 'chase');
  g.scriptDrive = (d) => {
    const T = window.__T;
    d.nitro = (T > 4.3 && T < 9.6) || (T > 11.2 && T < 12.4);
  };
  window.__shotCam = (T) => {
    const c = g.camera, car = g.car.object.position, h = g.car.vehicle.heading;
    const sx = Math.sin(h), cz = Math.cos(h);
    let px, py, pz, lx, ly, lz, fov;
    if (T < 3.5) {
      const u = T / 3.5, a = 0.45 + 0.95 * u, r = 5.4;
      px = car.x + Math.sin(h + a) * r; pz = car.z + Math.cos(h + a) * r; py = car.y + 0.6 + 0.3 * u;
      lx = car.x + sx * 0.6; lz = car.z + cz * 0.6; ly = car.y + 0.55; fov = 34;
    } else if (T < 7) {
      const u = (T - 3.5) / 3.5, boost = T > 4.3 ? Math.min(1, (T - 4.3) * 2.5) : 0, r = 5.6 + 0.8 * u;
      px = car.x - sx * r; pz = car.z - cz * r; py = car.y + 0.95;
      lx = car.x + sx * 7; lz = car.z + cz * 7; ly = car.y + 0.8; fov = 50 + 26 * boost;
      px += (Math.random() - 0.5) * 0.03 * boost; py += (Math.random() - 0.5) * 0.03 * boost;
    } else if (T < 10.5) {
      if (!window.__fix) window.__fix = { x: car.x + sx * 40 + cz * 11, z: car.z + cz * 40 - sx * 11 };
      px = window.__fix.x; pz = window.__fix.z; py = car.y + 1.1;
      lx = car.x; lz = car.z; ly = car.y + 0.6; fov = 30;
    } else if (T < 12.5) {
      return; // cockpit: the game's own interior camera
    } else {
      const u = (T - 12.5) / 2.5, e = u * u * (3 - 2 * u), a = e * 0.5, r = 7 + 34 * e;
      px = car.x - Math.sin(h - a) * r; pz = car.z - Math.cos(h - a) * r; py = car.y + 1.5 + 17 * e;
      lx = car.x + sx * (3 + 10 * e); lz = car.z + cz * (3 + 10 * e); ly = car.y + 0.5; fov = 48;
    }
    c.position.set(px, py, pz); c.lookAt(lx, ly, lz); c.fov = fov; c.near = 0.1; c.updateProjectionMatrix();
  };
  g.cine = () => window.__shotCam(window.__T);
  g.mode = 'play'; g.input.enabled = true;
})()`;

const cuts: [number, string][] = [
  [0, `window.__scene(18.65, 0, 'chase')`],
  [3.5, `window.__scene(22, 1, 'chase')`],
  [7, `window.__scene(19.7, 1, 'chase')`],
  [10.5, `window.__scene(22, 1, 'interior')`],
  [12.5, `window.__scene(16.2, 0, 'chase')`],
];

const { errors } = await withGame(async (open) => {
  const page = await open(`capture&autoplay&hour=18.65&quality=high&shots=1`, W, H, 1);
  await page.waitForTimeout(2500);
  await page.evaluate(setup);
  const step = (T: number) => `(() => { const g = window.__game; window.__T = ${T}; window.__t += 1000 / ${FPS}; g.frame(window.__t); })()`;
  // warm-up: get up to speed before the first shot (camera is set from T = 0)
  for (let i = 0; i < 150; i++) await page.evaluate(step(0));
  const total = FPS * SECONDS;
  let cut = 0;
  for (let i = 0; i < total; i++) {
    const T = i / FPS;
    while (cut < cuts.length && T >= cuts[cut][0]) {
      await page.evaluate(cuts[cut][1]);
      if (cut > 0) for (let k = 0; k < 6; k++) await page.evaluate(step(T)); // let the new scene settle (TAA / env / rain) without being filmed
      cut++;
    }
    const url = (await page.evaluate(`(${step(T)}, document.getElementById('game').toDataURL('image/jpeg', 0.94))`)) as string;
    writeFileSync(`${frames}/${String(i).padStart(4, '0')}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
    if (i % 60 === 0) console.log(`frame ${i}/${total}`);
  }
});
console.log(errors.filter((e) => !e.includes('deprecated')).slice(0, 5).join('\n') || 'no console errors');

// --- encode: title, fades, vignette, sound ---
const font = '/System/Library/Fonts/Supplemental/Impact.ttf', font2 = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
const A = 'assets-src/audio', P = 'public/audio';
const vf = [
  'vignette=PI/5',
  `drawtext=fontfile=${font}:text='DOWNTOWN DRIVE':fontsize=150:fontcolor=white:alpha='if(lt(t,12.9),0,min(1,(t-12.9)*2.5))':x=(w-text_w)/2:y=h*0.40:shadowcolor=black@0.6:shadowx=4:shadowy=4`,
  `drawtext=fontfile=${font2}:text='ARCADE STREET RACING  ·  REAL LOS ANGELES  ·  LIVE IN YOUR BROWSER':fontsize=34:fontcolor=white:alpha='if(lt(t,13.3),0,min(1,(t-13.3)*2.5))':x=(w-text_w)/2:y=h*0.40+170:shadowcolor=black@0.6:shadowx=2:shadowy=2`,
  `drawtext=fontfile=${font2}:text='Three.js · Rapier physics · OpenStreetMap':fontsize=26:fontcolor=white@0.8:alpha='if(lt(t,13.8),0,min(1,(t-13.8)*2.5))':x=(w-text_w)/2:y=h*0.40+230`,
  'fade=t=in:st=0:d=0.5',
  'fade=t=out:st=14.4:d=0.6',
].join(',');
const filter = [
  `[1:a]atrim=1.0:16.0,asetpts=PTS-STARTPTS,volume=1.5[eng]`,
  `[2:a]aloop=loop=-1:size=300000,atrim=0:11.6,adelay=3400|3400,volume=0.55,afade=t=in:st=3.4:d=0.8[rain]`,
  `[3:a]adelay=4300|4300,volume=0.6[nos]`,
  `[4:a]atrim=0:2.6,adelay=7300|7300,volume=0.7,afade=t=out:st=9.4:d=0.8[sq]`,
  `[eng][rain][nos][sq]amix=inputs=4:normalize=0,afade=t=in:st=0:d=0.4,afade=t=out:st=14.2:d=0.8,alimiter=limit=0.95[a]`,
].join(';');
execSync(
  `ffmpeg -v error -y -framerate ${FPS} -i ${frames}/%04d.jpg -i ${A}/freesound-496171-editboy23-import-car-dyno-turbo.mp3 -i ${P}/rain.wav -i ${P}/nitro.wav -i ${P}/squeal.wav ` +
    `-filter_complex "[0:v]${vf}[v];${filter}" -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k -t ${SECONDS} showcase/downtown-drive-15s.mp4`,
  { stdio: 'inherit' },
);
// contact sheet to check the shots
execSync(`ffmpeg -v error -y -i showcase/downtown-drive-15s.mp4 -vf "fps=1/1.5,scale=640:-1,tile=5x2" -frames:v 1 smoke-output/cine-sheet.jpg`);
console.log('done → showcase/downtown-drive-15s.mp4');
