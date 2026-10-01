// Raycast vehicle on a Rapier rigid body: suspension (spring/damper + anti-roll bars), weight transfer,
// combined-slip tyres, FWD automatic drivetrain, brakes, handbrake, aero drag, speed-sensitive steering.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld, GROUP, groups } from './PhysicsWorld';
import { Drivetrain } from './Drivetrain';
import { tireForces, TIRE } from './Tire';
import { SPEC, WHEELS } from '../car/spec';
import type { DriveInput } from '../core/Input';

interface WheelState {
  local: THREE.Vector3; // hardpoint (top of travel) in body space
  front: boolean;
  left: boolean;
  k: number; // spring rate N/m
  bump: number; // damping N·s/m
  rebound: number;
  travel: number; // max spring length (m)
  length: number; // current spring length
  lastLength: number;
  contact: boolean;
  fz: number;
  omega: number; // rad/s
  spin: number; // accumulated angle for visuals (rad)
  steer: number;
  slip: number;
  slipLat: number;
  kappa: number; // longitudinal slip ratio last step
  point: THREE.Vector3;
  normal: THREE.Vector3;
  onGrass: boolean;
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _wf = new THREE.Vector3(), _wl = new THREE.Vector3(), _r = new THREE.Vector3(), _pv = new THREE.Vector3(), _F = new THREE.Vector3(), _acc = new THREE.Vector3();
const up = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();

export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly wheels: WheelState[] = [];
  readonly drivetrain = new Drivetrain();
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  readonly angVel = new THREE.Vector3();
  readonly com = new THREE.Vector3(0, 0.48, 0.12);
  speed = 0; // forward speed m/s (signed)
  steerInput = 0; // smoothed −1..1
  steerAngle = 0; // road-wheel angle (rad, + = left)
  braking = false;
  reversing = false;
  handbrake = false;
  maxSlip = 0;
  lateralG = 0;
  longG = 0;
  airborne = false;
  assists = true;
  surfaceGrass = false;
  private reverseHold = 0;
  private prevVel = new THREE.Vector3();
  readonly radius = SPEC.tireRadius;
  private wheelInertia = 1.1;
  /** traction-control torque factor (assists): trims drive torque when the front wheels spin */
  tcs = 1;

  constructor(private physics: PhysicsWorld, x: number, z: number, heading: number) {
    const R = physics.R;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(x, 0.02, z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCcdEnabled(true)
      .setLinearDamping(0)
      .setAngularDamping(0.08)
      .setAdditionalMassProperties(SPEC.massKg, { x: this.com.x, y: this.com.y, z: this.com.z }, { x: 1750, y: 2050, z: 520 }, { x: 0, y: 0, z: 0, w: 1 });
    this.body = physics.world.createRigidBody(desc);
    // chassis: rounded boxes for the lower body and the cabin (mass comes from additional mass properties)
    const cg = groups(GROUP.PLAYER, GROUP.STATIC | GROUP.TRAFFIC);
    const lower = R.ColliderDesc.roundCuboid(0.78, 0.18, 2.1, 0.06).setTranslation(0, 0.56, -0.02).setDensity(0).setFriction(0.35).setRestitution(0.1).setCollisionGroups(cg).setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(3000);
    const cabin = R.ColliderDesc.roundCuboid(0.66, 0.2, 1.05, 0.08).setTranslation(0, 1.08, -0.4).setDensity(0).setFriction(0.3).setCollisionGroups(cg);
    physics.world.createCollider(lower, this.body);
    physics.world.createCollider(cabin, this.body);

    // suspension setup: static wheel-centre height = SPEC.wheelY; front carries ~60 % of the weight (FWD)
    const g = 9.81;
    for (const wd of WHEELS) {
      const load = (SPEC.massKg * g * (wd.front ? 0.6 : 0.4)) / 2;
      const k = wd.front ? 38000 : 30000;
      const mCorner = load / g;
      const staticComp = load / k;
      const travel = 0.24;
      const staticLen = travel - staticComp;
      const hpY = SPEC.wheelY + staticLen;
      const crit = 2 * Math.sqrt(k * mCorner);
      this.wheels.push({
        local: new THREE.Vector3(wd.x, hpY, wd.z), front: wd.front, left: wd.x > 0,
        k, bump: crit * 0.32, rebound: crit * 0.55, travel, length: staticLen, lastLength: staticLen,
        contact: false, fz: 0, omega: 0, spin: 0, steer: 0, slip: 0, slipLat: 0, kappa: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), onGrass: false,
      });
    }
    this.syncState();
  }

  private syncState() {
    const t = this.body.translation(), r = this.body.rotation(), lv = this.body.linvel(), av = this.body.angvel();
    this.position.set(t.x, t.y, t.z);
    this.quaternion.set(r.x, r.y, r.z, r.w);
    this.velocity.set(lv.x, lv.y, lv.z);
    this.angVel.set(av.x, av.y, av.z);
  }

  /** Called at the fixed physics rate before world.step(). */
  step(dt: number, input: DriveInput): void {
    this.syncState();
    const body = this.body;
    up.set(0, 1, 0).applyQuaternion(this.quaternion);
    fwd.set(0, 0, 1).applyQuaternion(this.quaternion);
    right.set(-1, 0, 0).applyQuaternion(this.quaternion); // car's right = −X
    this.speed = this.velocity.dot(fwd);
    const absV = Math.abs(this.speed);

    // --- driver intent → throttle / brake / gear (GTA-style: S brakes, then reverses) -----------------------
    const dtn = this.drivetrain;
    let throttle = 0, brake = 0;
    if (dtn.mode === 'R') {
      throttle = input.brake;
      brake = input.throttle;
      if (input.throttle > 0.1 && absV < 0.8) dtn.setMode('D');
    } else {
      throttle = input.throttle;
      brake = input.brake;
      if (input.brake > 0.1 && absV < 0.8 && input.throttle < 0.1) {
        this.reverseHold += dt;
        if (this.reverseHold > 0.25) {
          dtn.setMode('R');
          this.reverseHold = 0;
        }
      } else this.reverseHold = 0;
      if (dtn.mode !== 'D' && input.throttle > 0.1) dtn.setMode('D');
    }
    this.braking = brake > 0.05;
    this.reversing = dtn.mode === 'R';
    this.handbrake = input.handbrake;

    // --- steering: speed-sensitive lock + rate limit, Ackermann per wheel ---------------------------------------
    // steering-rack rate limit (mainly smooths analogue sticks; keyboard input is already ramped in Input)
    const steerRate = Math.abs(input.steer) > Math.abs(this.steerInput) ? 6 : 8;
    this.steerInput += Math.max(-steerRate * dt, Math.min(steerRate * dt, input.steer - this.steerInput));
    const maxLock = 0.6 / (1 + Math.pow(absV / 19, 1.35)); // 34° parked → ~11° at 110 km/h
    let steer = -this.steerInput * maxLock; // input +1 = right → road-wheel angle negative (left is +)
    // counter-steer assist while sliding (keeps drifts catchable on keyboard)
    if (this.assists && absV > 4) {
      const vLatBody = this.velocity.dot(right);
      const slipAngle = Math.atan2(-vLatBody, absV); // < 0 when sliding right (rear stepping out left) → steer right
      steer += THREE.MathUtils.clamp(slipAngle * 0.35, -0.12, 0.12) * (this.handbrake ? 0.3 : 1);
    }
    this.steerAngle = steer;
    const L = SPEC.wheelbase, T = SPEC.track;
    if (Math.abs(steer) > 1e-4) {
      const Rt = L / Math.tan(Math.abs(steer));
      const inner = Math.atan(L / (Rt - T / 2)), outer = Math.atan(L / (Rt + T / 2));
      for (const w of this.wheels) {
        if (!w.front) continue;
        const isInner = (steer > 0 && w.left) || (steer < 0 && !w.left);
        w.steer = Math.sign(steer) * (isInner ? inner : outer);
      }
    } else for (const w of this.wheels) if (w.front) w.steer = 0;

    // --- drivetrain torque (front axle) --------------------------------------------------------------------------
    const frontOmega = (this.wheels[0].omega + this.wheels[1].omega) / 2;
    let axleTorque = dtn.step(dt, throttle, frontOmega, this.speed);
    // traction control (assist): hold the driven wheels near peak slip instead of spinning them up
    if (this.assists) {
      const k = Math.max(this.wheels[0].contact ? this.wheels[0].kappa : 0, this.wheels[1].contact ? this.wheels[1].kappa : 0);
      const target = k > 0.1 ? Math.max(0.2, 1 - (k - 0.1) * 5) : 1;
      this.tcs += (target - this.tcs) * Math.min(1, dt * (target < this.tcs ? 30 : 6));
      if (throttle > 0.05) axleTorque *= this.tcs;
    } else this.tcs = 1;

    // --- suspension + tyres ----------------------------------------------------------------------------------------
    const comW = _v.copy(this.com).applyQuaternion(this.quaternion).add(this.position);
    const filter = groups(GROUP.PLAYER, GROUP.STATIC | GROUP.TRAFFIC);
    let contacts = 0;
    this.maxSlip = 0;
    const comps = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const hp = _w.copy(w.local).applyQuaternion(this.quaternion).add(this.position);
      const hit = this.physics.castRay(hp.x, hp.y, hp.z, -up.x, -up.y, -up.z, w.travel + this.radius, filter, body);
      w.lastLength = w.length;
      if (hit) {
        w.contact = true;
        w.length = Math.max(0, hit.toi - this.radius);
        w.point.set(hp.x - up.x * hit.toi, hp.y - up.y * hit.toi, hp.z - up.z * hit.toi);
        w.normal.set(hit.nx, hit.ny, hit.nz);
        contacts++;
      } else {
        w.contact = false;
        w.length = w.travel;
      }
      comps[i] = w.travel - w.length;
    }
    this.airborne = contacts === 0;
    // anti-roll bars (front stiffer)
    const arb = [22000, 22000, 12000, 12000];
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.contact) {
        w.fz = 0;
        w.slip = 0;
        continue;
      }
      const comp = comps[i];
      const vel = (w.lastLength - w.length) / dt; // + compressing
      const damp = vel > 0 ? w.bump * vel : w.rebound * vel;
      const other = i ^ 1;
      const roll = (comp - comps[other]) * arb[i];
      let fz = w.k * comp + damp + roll;
      if (comp >= w.travel - 0.005) fz += 90000 * (comp - (w.travel - 0.005)) + 2000; // bump stop
      fz = Math.max(0, fz);
      w.fz = fz;
      // suspension force along the body's up axis, applied at the contact point
      body.applyImpulseAtPoint({ x: up.x * fz * dt, y: up.y * fz * dt, z: up.z * fz * dt }, { x: w.point.x, y: w.point.y, z: w.point.z }, true);

      // wheel frame on the contact plane
      const n = w.normal;
      const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
      // steered forward: rotate body fwd around body up by steer (+ = left)
      const wf = _wf.copy(fwd).multiplyScalar(cs).addScaledVector(right, -sn);
      wf.addScaledVector(n, -wf.dot(n)).normalize();
      const wl = _wl.crossVectors(n, wf).normalize(); // wheel's left
      // contact point velocity
      const r = _r.subVectors(w.point, comW);
      const pv = _pv.crossVectors(this.angVel, r).add(this.velocity);
      const vLong = pv.dot(wf), vLat = pv.dot(wl);

      // surface friction: off-road (grass/dirt) is slippery
      const mu = (w.onGrass ? TIRE.muGrass : TIRE.muRoad) * (this.handbrake && !w.front ? 0.8 : 1);
      // drive + brake torques
      const drive = w.front ? axleTorque / 2 : 0;
      // ABS (assist): cap brake torque at what the tyre can transmit, so the wheels don't lock
      // and release a wheel whose slip ratio passes the peak (wheel much slower than the road)
      const brakeCap = this.assists ? mu * fz * this.radius * 0.97 : Infinity;
      let brakeReq = Math.min(brake * (w.front ? 2600 : 1400), brakeCap);
      if (this.assists && brakeReq > 0 && Math.abs(vLong) > 2 && (w.omega * this.radius - vLong) / Math.abs(vLong) * Math.sign(vLong) < -0.14) brakeReq *= 0.25;
      const brakeT = brakeReq + (this.handbrake && !w.front ? 3200 : 0);
      // implicit wheel spin: I dω/dt = drive − R·Fx(ω) − brake. Driven wheels carry the engine/gearbox inertia
      // reflected through the gear ratio (this is what stops a real car's wheels spinning up instantly).
      let tf = tireForces(vLong, vLat, w.omega * this.radius, fz, mu, this.radius, 1);
      const gearR = dtn.ratio * dtn.finalDrive;
      const I = this.wheelInertia + (w.front && dtn.shiftTimer <= 0 ? (0.16 * gearR * gearR) / 2 : 0);
      const k = this.radius * tf.dFxdOmega;
      let omega = (I * w.omega + dt * (drive - this.radius * tf.fx + k * w.omega)) / (I + dt * k);
      // brake as a friction clamp towards zero (never reverses the wheel)
      if (brakeT > 0) {
        const dOmega = (brakeT * dt) / (I + dt * k);
        if (Math.abs(omega) <= dOmega) omega = 0;
        else omega -= Math.sign(omega) * dOmega;
      }
      // rolling resistance
      omega -= Math.sign(omega) * Math.min(Math.abs(omega), (0.013 * fz * this.radius * dt) / I);
      w.omega = omega;
      tf = tireForces(vLong, vLat, w.omega * this.radius, fz, mu, this.radius, 1);
      // low-speed lateral damping so the car doesn't creep sideways when parked
      let fy = tf.fy;
      if (Math.abs(vLong) < 1.5) fy = THREE.MathUtils.clamp(-vLat * fz * 0.9, -mu * fz, mu * fz) * (1 - Math.abs(vLong) / 1.5) + fy * (Math.abs(vLong) / 1.5);
      const F = _F.copy(wf).multiplyScalar(tf.fx).addScaledVector(wl, fy);
      body.applyImpulseAtPoint({ x: F.x * dt, y: F.y * dt, z: F.z * dt }, { x: w.point.x, y: w.point.y, z: w.point.z }, true);
      w.slip = tf.slip;
      w.slipLat = Math.abs(vLat);
      w.kappa = ((w.omega * this.radius - vLong) / Math.max(Math.abs(vLong), 1.5)) * Math.sign(vLong || 1);
      this.maxSlip = Math.max(this.maxSlip, tf.slip);
    }
    // free-spinning wheels in the air: drive torque spins them, slow decay
    for (const w of this.wheels) {
      if (w.contact) continue;
      const drive = w.front ? axleTorque / 2 : 0;
      w.omega += (drive / this.wheelInertia) * dt * 0.3;
      w.omega *= 1 - dt * 0.5;
      if (this.handbrake && !w.front) w.omega = 0;
      if (this.braking) w.omega *= 1 - Math.min(1, dt * 8);
    }
    for (const w of this.wheels) w.spin += w.omega * dt;

    // aero drag + stationary hold (automatic "brake hold" when stopped with the brake on)
    const v2 = this.velocity.lengthSq();
    if (v2 > 0.01) {
      const drag = 0.5 * 1.2 * 0.31 * 2.0 * Math.sqrt(v2); // Cd 0.31, frontal area 2.0 m²
      body.applyImpulse({ x: -this.velocity.x * drag * dt, y: -this.velocity.y * drag * dt, z: -this.velocity.z * drag * dt }, true);
    }
    // yaw assist: gentle yaw damping when not sliding intentionally
    if (this.assists && !this.handbrake && contacts >= 3) {
      const yawRate = this.angVel.dot(up);
      const target = (this.speed * Math.tan(this.steerAngle)) / L;
      const err = yawRate - target;
      if (Math.abs(err) > 0.25) {
        const tq = -Math.sign(err) * Math.min(Math.abs(err) - 0.25, 1.5) * 2500 * dt;
        body.applyTorqueImpulse({ x: up.x * tq, y: up.y * tq, z: up.z * tq }, true);
      }
    }

    // accelerations for camera sway / HUD
    const acc = _acc.subVectors(this.velocity, this.prevVel).divideScalar(dt);
    this.prevVel.copy(this.velocity);
    this.lateralG = THREE.MathUtils.lerp(this.lateralG, acc.dot(right) / 9.81, 0.1);
    this.longG = THREE.MathUtils.lerp(this.longG, acc.dot(fwd) / 9.81, 0.1);
  }

  /** Visual suspension offset for wheel i relative to the static ride height (m, + = up into the arch). */
  suspensionOffset(i: number): number {
    const w = this.wheels[i];
    const staticLen = w.local.y - SPEC.wheelY;
    return staticLen - w.length;
  }

  setSurface(grassPerWheel: boolean[]): void {
    for (let i = 0; i < 4; i++) this.wheels[i].onGrass = grassPerWheel[i];
    this.surfaceGrass = grassPerWheel.some(Boolean);
  }

  /** Teleport upright at (x, z) facing heading; zero all motion. */
  reset(x: number, z: number, heading: number, y = 0.15): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) {
      w.omega = 0;
      w.length = w.lastLength = w.local.y - SPEC.wheelY;
    }
    this.drivetrain.setMode('D');
    this.drivetrain.gear = 1;
    this.steerInput = 0;
    this.prevVel.set(0, 0, 0);
    this.syncState();
  }

  get kmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  get heading(): number {
    fwd.set(0, 0, 1).applyQuaternion(this.quaternion);
    return Math.atan2(fwd.x, fwd.z);
  }
}
