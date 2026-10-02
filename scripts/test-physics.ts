/**
 * Headless driving test (Rapier in Node) for the arcade handling: launch, top speed, gear shifts, braking,
 * drifting (entry, hold, speed kept, exit), nitrous, cornering, reverse.
 *   npm run test:physics
 */
import { initRapier, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { Vehicle } from '../src/physics/Vehicle';
import type { DriveInput } from '../src/core/Input';

const R = await initRapier();
const input = (o: Partial<DriveInput>): DriveInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false, lookBack: false, nitro: false, ...o });

function sim(fn: (v: Vehicle, t: number) => DriveInput | null, maxT = 120, log?: (v: Vehicle, t: number) => void) {
  const p = new PhysicsWorld(R);
  const v = new Vehicle(p, 0, 0, 0);
  let t = 0;
  // settle
  for (let i = 0; i < 240; i++) {
    v.step(p.dt, input({}));
    p.step();
  }
  for (; t < maxT; t += p.dt) {
    const inp = fn(v, t);
    if (!inp) break;
    v.step(p.dt, inp);
    p.step();
    log?.(v, t);
  }
  return { v, t };
}
const upY = (v: Vehicle) => 1 - 2 * (v.quaternion.x ** 2 + v.quaternion.z ** 2);
const deg = (r: number) => (r * 180) / Math.PI;

const results: Record<string, unknown> = {};
const problems: string[] = [];

// settle height
{
  const { v } = sim(() => null);
  results.rideHeight = +v.position.y.toFixed(3);
  results.settledSpeed = +v.kmh.toFixed(2);
  if (Math.abs(v.position.y) > 0.08) problems.push('car does not settle at ground level: y=' + v.position.y);
}

// launch, top speed, gear shifts
{
  let t100 = -1, t200 = -1;
  const shifts: string[] = [];
  let lastGear = 1;
  let top = 0;
  const { v } = sim((v, t) => (t < 60 ? input({ throttle: 1 }) : null), 70, (v, t) => {
    if (t100 < 0 && v.kmh >= 100) t100 = t;
    if (t200 < 0 && v.kmh >= 200) t200 = t;
    top = Math.max(top, v.kmh);
    if (v.drivetrain.gear !== lastGear) {
      shifts.push(`${lastGear}→${v.drivetrain.gear}@${v.kmh.toFixed(0)}km/h`);
      lastGear = v.drivetrain.gear;
    }
  });
  results.zeroTo100 = +t100.toFixed(2);
  results.zeroTo200 = +t200.toFixed(2);
  results.topSpeed = +top.toFixed(1);
  results.shifts = shifts.join(' ');
  if (t100 < 2.6 || t100 > 4.6) problems.push(`0–100 ${t100.toFixed(1)} s outside 2.6–4.6 s`);
  if (t200 < 7 || t200 > 14) problems.push(`0–200 ${t200.toFixed(1)} s outside 7–14 s`);
  if (top < 280 || top > 320) problems.push(`top speed ${top.toFixed(0)} outside 280–320`);
  if (Math.abs(v.position.x) > 15) problems.push('car pulls sideways under full throttle: x=' + v.position.x.toFixed(2));
  if (shifts.length !== 5) problems.push('expected 5 upshifts, got ' + shifts.length);
}

// nitrous: faster 100→200, tank drains and refills
{
  const run = (nitro: boolean) => {
    let t1 = -1, t2 = -1, minTank = 1;
    sim((v, t) => (t2 < 0 && t < 40 ? input({ throttle: 1, nitro: nitro && v.kmh >= 100 }) : null), 40, (v, t) => {
      if (t1 < 0 && v.kmh >= 100) t1 = t;
      if (t2 < 0 && v.kmh >= 200) t2 = t;
      minTank = Math.min(minTank, v.nitro);
    });
    return { dt: t2 - t1, minTank };
  };
  const a = run(false), b = run(true);
  results.t100to200 = +a.dt.toFixed(2);
  results.t100to200Nitro = +b.dt.toFixed(2);
  results.nitroTankAfter = +b.minTank.toFixed(2);
  if (b.dt > a.dt * 0.8) problems.push(`nitrous barely helps: 100–200 in ${b.dt.toFixed(2)} s vs ${a.dt.toFixed(2)} s`);
  if (b.minTank > 0.6) problems.push('nitrous tank did not drain');
  let top = 0;
  sim((v, t) => (t < 45 ? input({ throttle: 1, nitro: t > 28 }) : null), 50, (v) => (top = Math.max(top, v.kmh)));
  results.topSpeedNitro = +top.toFixed(1);
  if (top < 300 || top > 345) problems.push(`nitrous top speed ${top.toFixed(0)} outside 300–345`);
}

// braking 100 → 0 and 200 → 0
for (const from of [100, 200]) {
  let phase = 0, start = 0, dist = 0;
  sim((v) => {
    if (phase === 0 && v.kmh >= from) {
      phase = 1;
      start = v.position.z;
    }
    if (phase === 1 && v.kmh < 0.5) {
      dist = v.position.z - start;
      return null;
    }
    return phase === 0 ? input({ throttle: 1 }) : input({ brake: 1 });
  }, 60);
  results[`brake${from}to0`] = +dist.toFixed(1);
  const [lo, hi] = from === 100 ? [18, 34] : [70, 125];
  if (dist < lo || dist > hi) problems.push(`${from}–0 braking distance ${dist.toFixed(1)} m outside ${lo}–${hi} m`);
}

// handbrake drift at 110 km/h: tap the handbrake while steering, then hold steering + throttle for 3 s.
// The car should take a clear drift angle, hold it, keep most of its speed, stay upright, and straighten on release.
{
  let phase = 0, t0 = 0, v0 = 0, maxA = 0, sumA = 0, n = 0, vEnd = 0, endA = 99, score = 0, spun = false;
  const { v } = sim((v, t) => {
    if (phase === 0 && v.kmh >= 110) {
      phase = 1;
      t0 = t;
      v0 = v.groundKmh;
    }
    if (phase === 0) return input({ throttle: 1 });
    const el = t - t0;
    if (el < 3.2) {
      const a = Math.abs(v.slipAngle);
      maxA = Math.max(maxA, a);
      if (el > 1) {
        sumA += a;
        n++;
      }
      if (a > 1.3) spun = true;
      score = Math.max(score, v.driftScore);
      vEnd = v.groundKmh;
      return input({ steer: -1, handbrake: el < 0.35, throttle: 1 });
    }
    if (el < 5.2) {
      endA = Math.abs(v.slipAngle);
      return input({ throttle: 0.6 });
    }
    return null;
  }, 60);
  results.driftMaxAngleDeg = +deg(maxA).toFixed(0);
  results.driftHeldAngleDeg = +deg(sumA / Math.max(1, n)).toFixed(0);
  results.driftSpeedKept = +(vEnd / v0).toFixed(2);
  results.driftExitAngleDeg = +deg(endA).toFixed(1);
  results.driftScore = Math.round(score);
  results.driftUpright = +upY(v).toFixed(2);
  if (deg(sumA / Math.max(1, n)) < 18) problems.push(`drift angle not held (${deg(sumA / Math.max(1, n)).toFixed(0)}° average)`);
  if (spun) problems.push('car spun out during the drift');
  if (vEnd / v0 < 0.75) problems.push(`drift loses too much speed (${(vEnd / v0).toFixed(2)} of entry speed left)`);
  if (deg(endA) > 6) problems.push(`car does not straighten after the drift (${deg(endA).toFixed(1)}° left)`);
  if (upY(v) < 0.9) problems.push('car not upright after the drift');
}

// brake-tap drift: steer, tap the brake, back on the throttle
{
  let phase = 0, t0 = 0, maxA = 0;
  sim((v, t) => {
    if (phase === 0 && v.kmh >= 120) {
      phase = 1;
      t0 = t;
    }
    if (phase === 0) return input({ throttle: 1 });
    const el = t - t0;
    if (el > 3) return null;
    maxA = Math.max(maxA, Math.abs(v.slipAngle));
    if (el < 0.35) return input({ steer: 1, throttle: 1 });
    if (el < 0.55) return input({ steer: 1, brake: 1 });
    return input({ steer: 1, throttle: 1 });
  }, 60);
  results.brakeTapDriftDeg = +deg(maxA).toFixed(0);
  if (deg(maxA) < 18) problems.push(`brake tap does not start a drift (${deg(maxA).toFixed(0)}°)`);
}

// plain cornering without drift inputs: grips, no spin, no rollover. Lateral g should be arcade-high.
{
  let rolled = false, maxA = 0, maxG = 0;
  const { v } = sim((v, t) => (t < 16 ? input({ throttle: v.kmh < 100 ? 0.9 : 0.25, steer: t > 7 ? 0.7 : 0 }) : null), 30, (v, t) => {
    if (upY(v) < 0.6) rolled = true;
    if (t > 8) {
      maxA = Math.max(maxA, Math.abs(v.slipAngle));
      maxG = Math.max(maxG, Math.abs(v.lateralG));
    }
  });
  results.cornerSpeed = +v.kmh.toFixed(1);
  results.cornerLatG = +maxG.toFixed(2);
  results.cornerSlipDeg = +deg(maxA).toFixed(1);
  if (rolled) problems.push('car rolled over in steady cornering');
  if (deg(maxA) > 14) problems.push(`car slides in plain cornering (${deg(maxA).toFixed(0)}° slip)`);
  if (maxG < 1.0) problems.push(`cornering grip too low (${maxG.toFixed(2)} g)`);
}

// high-speed lane change at 250 km/h: stable, no spin
{
  let maxA = 0, phase = 0, t0 = 0;
  const { v } = sim((v, t) => {
    if (phase === 0 && v.kmh >= 250) {
      phase = 1;
      t0 = t;
    }
    if (phase === 0) return input({ throttle: 1 });
    const el = t - t0;
    if (el > 4) return null;
    maxA = Math.max(maxA, Math.abs(v.slipAngle));
    return input({ throttle: 1, steer: el < 0.5 ? 1 : el < 1.0 ? -1 : 0 });
  }, 60);
  results.laneChange250SlipDeg = +deg(maxA).toFixed(1);
  results.laneChange250Offset = +v.position.x.toFixed(1);
  if (deg(maxA) > 9) problems.push(`unstable at 250 km/h (${deg(maxA).toFixed(1)}° slip in a lane change)`);
}

// reverse: hold brake from standstill → reverse gear, backs up
{
  const { v } = sim((v, t) => (t < 5 ? input({ brake: 1 }) : null), 8);
  results.reverseGear = v.drivetrain.gearLabel;
  results.reverseSpeed = +(v.speed * 3.6).toFixed(1);
  if (v.drivetrain.mode !== 'R' || v.speed > -2) problems.push('holding brake at standstill does not reverse');
}

console.log(JSON.stringify(results, null, 2));
if (problems.length) {
  console.error('PHYSICS PROBLEMS:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('physics OK');
