// Ghost-mode drift rehearsals at many spots: records each path, checks it against the real prop positions and keeps the clean ones.
import { readFileSync, writeFileSync } from 'node:fs';
import { withGame } from '../shot';
import { makeClearance } from './obstacles';

const { pathClearance } = makeClearance();
const spots = (JSON.parse(readFileSync('smoke-output/spots.json', 'utf8')) as { x: number; z: number; clr: number; w: number; name: string }[]).filter((s) => Math.abs(s.x) < 1600 && Math.abs(s.z) < 1600 && s.w >= 9 && s.clr >= 12).slice(0, 14);
const core = readFileSync('scripts/trailer/core.js', 'utf8');
const results: Record<string, unknown>[] = [];
const { errors } = await withGame(async (open) => {
  const page = await open('capture&autoplay&quality=low&shots=1', 640, 360, 1);
  await page.waitForTimeout(2500);
  await page.evaluate(core);
  await page.evaluate(`(() => { window.__T2.init(false); window.__game.renderEnabled = false; window.__game.car.vehicle.setGhost(true); })()`);
  for (const s of spots) {
    for (const flip of [0, 1]) for (const kmh of [70, 90, 110]) for (const dir of [-1, 1]) for (const hold of [0.8, 1.0]) {
      const r = (await page.evaluate(`(() => {
        const T = window.__T2, g = T.g;
        T.scene(21, 1);
        const rd = T.roadAt(${s.x}, ${s.z}, 50);
        if (!rd) return null;
        let hd = Math.atan2(rd.tx, rd.tz) + ${flip} * Math.PI;
        const run = ${kmh} / 3.6 * 1.0;
        T.place(rd.x - Math.sin(hd) * run, rd.z - Math.cos(hd) * run, hd, ${kmh}, { radius: 220 });
        let t = 0; const path = []; let slipSum = 0, slipN = 0, slipMax = 0;
        T.drive = (d) => {
          d.throttle = t < 1.0 ? 0.8 : 1;
          if (t >= 1.0 && t < 1.3) { d.handbrake = true; d.steer = ${dir}; }
          else if (t >= 1.3 && t < 4.0) d.steer = ${dir} * ${hold};
        };
        for (let i = 0; i < 150; i++) {
          t = i / 30; T.step(1 / 30);
          const v = g.car.vehicle, p = g.car.object.position;
          path.push([p.x, p.z, v.heading]);
          if (t > 1.6 && t < 3.8) { const a = Math.abs(v.slipAngle) * 57.3; slipSum += a; slipN++; slipMax = Math.max(slipMax, a); }
        }
        const v = g.car.vehicle;
        return { path, roll: T.stats.maxRoll, slip: slipSum / slipN, slipMax, end: v.groundKmh, flip: T.stats.flipped };
      })()`)) as { path: number[][]; roll: number; slip: number; slipMax: number; end: number; flip: number } | null;
      if (!r) continue;
      const clr = pathClearance(r.path.slice(20));
      results.push({ x: s.x, z: s.z, name: s.name, w: s.w, flip, kmh, dir, hold, clr, roll: r.roll, slip: r.slip, slipMax: r.slipMax, end: r.end, path: r.path });
    }
    const mine = results.filter((q) => q.x === s.x && q.z === s.z) as { clr: number; slip: number; roll: number }[];
    console.log(`${s.name || 'node'} (${Math.round(s.x)},${Math.round(s.z)}) best clearance ${Math.max(...mine.map((q) => q.clr)).toFixed(1)} · best slip ${Math.max(...mine.map((q) => q.slip)).toFixed(0)}°`);
  }
});
writeFileSync('smoke-output/drift-takes.json', JSON.stringify(results));
const good = (results as { x: number; z: number; name: string; kmh: number; dir: number; hold: number; flip: number; clr: number; roll: number; slip: number; end: number }[])
  .filter((q) => q.clr > 2.5 && q.roll < 20 && q.slip > 22 && q.end > 30)
  .sort((a, b) => b.clr * 3 + b.slip - (a.clr * 3 + a.slip));
console.log(`\n${good.length} clean takes of ${results.length}. Best:`);
for (const q of good.slice(0, 18)) console.log(`${q.name || 'node'} (${Math.round(q.x)},${Math.round(q.z)}) flip${q.flip} ${q.kmh}km/h dir${q.dir} hold${q.hold}  clr ${q.clr.toFixed(1)}  slip ${q.slip.toFixed(0)}°  roll ${q.roll.toFixed(0)}°  end ${q.end.toFixed(0)}`);
console.log(errors.filter((e) => !e.includes('deprecated')).slice(0, 3).join('\n') || 'no console errors');
