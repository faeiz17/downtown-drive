import { initRapier, PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { Vehicle } from '../../src/physics/Vehicle';
const R = await initRapier();
const p = new PhysicsWorld(R);
const v = new Vehicle(p, 0, 0, 0);
const inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false, lookBack: false };
for (let i = 0; i < 240; i++) { v.step(p.dt, inp); p.step(); }
inp.throttle = 1;
for (let t = 0; t < 9; t += p.dt) {
  v.step(p.dt, inp); p.step();
  if (Math.abs((t * 2) % 1) < p.dt * 2) {
    const w = v.wheels[0];
    const d = v.drivetrain;
    console.log(`t=${t.toFixed(1)} kmh=${v.kmh.toFixed(1)} ${d.gearLabel} rpm=${d.rpm.toFixed(0)} tq=${d.torqueOut.toFixed(0)} wheelKmh=${(w.omega * v.radius * 3.6).toFixed(1)} slip=${w.slip.toFixed(2)} fzF=${w.fz.toFixed(0)} fzR=${v.wheels[2].fz.toFixed(0)} longG=${v.longG.toFixed(2)}`);
  }
}
