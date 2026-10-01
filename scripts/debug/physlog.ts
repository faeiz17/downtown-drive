import { initRapier, PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { Vehicle } from '../../src/physics/Vehicle';
const R = await initRapier();
const p = new PhysicsWorld(R);
const v = new Vehicle(p, 0, 0, 0);
const inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false, lookBack: false };
for (let i = 0; i < 240; i++) { v.step(p.dt, inp); p.step(); }
inp.throttle = 1;
for (let t = 0; t < 60; t += p.dt) {
  v.step(p.dt, inp); p.step();
  if (Math.abs(t % 3) < p.dt) {
    const w = v.wheels;
    console.log(`t=${t.toFixed(0)} v=${v.kmh.toFixed(1)} gear=${v.drivetrain.gearLabel} rpm=${v.drivetrain.rpm.toFixed(0)} tq=${v.drivetrain.torqueOut.toFixed(0)} wR=${(w[0].omega * v.radius * 3.6).toFixed(1)} fz=${w.map((x) => x.fz.toFixed(0)).join('/')} slip=${w[0].slip.toFixed(2)} y=${v.position.y.toFixed(3)} pitchW=${v.quaternion.x.toFixed(3)}`);
  }
}
