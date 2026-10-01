/**
 * Headless driving test (Rapier in Node): acceleration, top speed, gear shifts, braking, handbrake slide, reverse.
 *   npm run test:physics
 */
import { initRapier, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { Vehicle } from '../src/physics/Vehicle';
import type { DriveInput } from '../src/core/Input';

const R = await initRapier();
const input = (o: Partial<DriveInput>): DriveInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false, lookBack: false, ...o });

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

const results: Record<string, unknown> = {};
const problems: string[] = [];

// settle height
{
  const { v } = sim(() => null);
  results.rideHeight = +v.position.y.toFixed(3);
  results.settledSpeed = +v.kmh.toFixed(2);
  if (Math.abs(v.position.y) > 0.08) problems.push('car does not settle at ground level: y=' + v.position.y);
}

// 0–100 and top speed, gear shifts
{
  let t100 = -1, t60 = -1;
  const shifts: string[] = [];
  let lastGear = 1;
  let top = 0;
  const { v } = sim((v, t) => (t < 70 ? input({ throttle: 1 }) : null), 80, (v, t) => {
    if (t60 < 0 && v.kmh >= 60) t60 = t;
    if (t100 < 0 && v.kmh >= 100) t100 = t;
    top = Math.max(top, v.kmh);
    if (v.drivetrain.gear !== lastGear) {
      shifts.push(`${lastGear}→${v.drivetrain.gear}@${v.kmh.toFixed(0)}km/h/${v.drivetrain.rpm.toFixed(0)}rpm`);
      lastGear = v.drivetrain.gear;
    }
  });
  results.zeroTo60 = +t60.toFixed(2);
  results.zeroTo100 = +t100.toFixed(2);
  results.topSpeed = +top.toFixed(1);
  results.shifts = shifts;
  results.heading = +v.heading.toFixed(3);
  if (t100 < 9 || t100 > 16) problems.push(`0–100 ${t100.toFixed(1)} s outside 9–16 s`);
  if (top < 165 || top > 200) problems.push(`top speed ${top.toFixed(0)} outside 165–200`);
  if (Math.abs(v.position.x) > 15) problems.push('car pulls sideways under full throttle: x=' + v.position.x.toFixed(2));
}

// braking 100 → 0
{
  let phase = 0, start = 0, dist = 0;
  sim((v) => {
    if (phase === 0 && v.kmh >= 100) {
      phase = 1;
      start = v.position.z;
    }
    if (phase === 1 && v.kmh < 0.5) {
      dist = v.position.z - start;
      return null;
    }
    return phase === 0 ? input({ throttle: 1 }) : input({ brake: 1 });
  }, 60);
  results.brake100to0 = +dist.toFixed(1);
  if (dist < 30 || dist > 55) problems.push(`100–0 braking distance ${dist.toFixed(1)} m outside 30–55 m`);
}

// handbrake turn at ~60 km/h: the car should rotate significantly (drift) and slide
{
  let phase = 0, h0 = 0, maxSlip = 0, maxYaw = 0;
  const { v } = sim((v, t) => {
    if (phase === 0 && v.kmh >= 60) {
      phase = 1;
      h0 = v.heading;
    }
    if (phase === 1) {
      maxSlip = Math.max(maxSlip, v.maxSlip);
      maxYaw = Math.max(maxYaw, Math.abs(v.heading - h0));
      if (v.kmh < 5 || t > 40) return null;
      return input({ steer: -1, handbrake: true, throttle: 0.2 });
    }
    return input({ throttle: 1 });
  }, 60);
  results.handbrakeYawDeg = +((maxYaw * 180) / Math.PI).toFixed(0);
  results.handbrakeMaxSlip = +maxSlip.toFixed(2);
  results.handbrakeUpright = +v.quaternion.w.toFixed(2);
  if (maxYaw < 1.2) problems.push('handbrake turn does not rotate the car enough (' + ((maxYaw * 180) / Math.PI).toFixed(0) + '°)');
}

// steady cornering at 50 km/h with half lock: must not spin or roll over
{
  let rolled = false;
  const { v } = sim((v, t) => (t < 20 ? input({ throttle: v.kmh < 50 ? 0.6 : 0.2, steer: t > 6 ? 0.5 : 0 }) : null), 30, (v) => {
    const upY = 1 - 2 * (v.quaternion.x ** 2 + v.quaternion.z ** 2);
    if (upY < 0.6) rolled = true;
  });
  results.cornerSpeed = +v.kmh.toFixed(1);
  results.cornerLatG = +v.lateralG.toFixed(2);
  if (rolled) problems.push('car rolled over in steady cornering');
}

// reverse: hold brake from standstill → reverse gear, backs up
{
  const { v } = sim((v, t) => (t < 6 ? input({ brake: 1 }) : null), 8);
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
