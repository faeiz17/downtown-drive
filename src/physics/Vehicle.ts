// Arcade raycast vehicle on a Rapier rigid body.
// The base is physical (spring/damper suspension, anti-roll bars, combined-slip tyres, wheel spin, AWD drivetrain),
// and on top of it sit the things that make it drive like an arcade street racer rather than a road car:
//   - steering lock that follows the grip limit, so full lock is always "as hard as the tyres can turn"
//   - a yaw helper that points the car where the steering asks (no ploughing understeer)
//   - drifting: handbrake or a brake tap while steering kicks the tail out; the stick then sets the drift angle, a
//     controller holds it, the front wheels counter-steer by themselves, and most of the speed lost to sliding is
//     given back while the throttle is down
//   - downforce, strong brakes with ABS, and nitrous
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
  /** how hard the contact patch is sliding over the road (m/s), for smoke / skid marks / sound */
  skid: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  onGrass: boolean;
}

/** Handling numbers in one place. */
export const HANDLING = {
  yawInertia: 2050,
  downforceClA: 1.35, // m², lift coefficient × area (pushes the car down with speed²)
  dragCdA: 0.64,
  brakeFront: 3600, // Nm per wheel at full pedal
  brakeRear: 2400,
  handbrakeTorque: 5200,
  steerHelp: 3.0, // 1/s, yaw-rate helper gain while gripping
  // drifting
  driftAngleMax: 0.62, // rad, drift angle at full stick (about 35°)
  driftAngleMaxFast: 0.4, // … above ~250 km/h
  driftGain: 3.2, // 1/s, how quickly the drift angle follows the stick
  driftYawGain: 7, // 1/s, yaw-rate servo
  driftRearGrip: 0.6, // rear lateral grip while drifting
  driftFrontGrip: 1.1,
  driftSpeedKeep: 0.85, // share of the sliding losses given back under throttle
  driftEnterSlip: 0.22, // rad of body slip that counts as "already sliding"
  // nitrous
  nitroSeconds: 4.5,
  nitroRefill: 0.05, // tank per second
  nitroRefillDrift: 0.14, // extra while drifting
  nitroTorque: 1.35,
  nitroPush: 4200, // N
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _wf = new THREE.Vector3(), _wl = new THREE.Vector3(), _r = new THREE.Vector3(), _pv = new THREE.Vector3(), _F = new THREE.Vector3(), _acc = new THREE.Vector3();
const _sum = new THREE.Vector3(), _vh = new THREE.Vector3();
const up = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly wheels: WheelState[] = [];
  readonly drivetrain = new Drivetrain();
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  readonly angVel = new THREE.Vector3();
  readonly com = new THREE.Vector3(0, 0.4, 0.06);
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
  /** ABS + traction control. The arcade helpers (steering, drift) are always on. */
  assists = true;
  surfaceGrass = false;
  /** 0 dry … 1 soaked road: a little less grip */
  wet = 0;
  // --- arcade state (read by camera, HUD, audio, effects)
  /** nitrous tank 0..1 */
  nitro = 1;
  nitroActive = false;
  /** smoothed 0..1 while nitrous is burning */
  boostFx = 0;
  /** 0..1, how much the car is in drift mode */
  drift = 0;
  /** body slip angle (rad): + when the car travels to the left of where its nose points */
  slipAngle = 0;
  /** points of the drift in progress, and the last finished one */
  driftScore = 0;
  driftBanked = 0;
  driftBankedCount = 0;
  /** seconds spent on the roof or side (the game resets the car after a moment) */
  flipped = 0;
  private nitroLock = false;
  private driftHold = 0;
  private wasBraking = false;
  private prevVelHeading = 0;
  private pathRate = 0;
  private reverseHold = 0;
  private prevVel = new THREE.Vector3();
  private grounded = 4;
  readonly radius = SPEC.tireRadius;
  private wheelInertia = 1.1;
  /** traction-control torque factor (assists): trims drive torque when the driven wheels spin up */
  tcs = 1;

  constructor(private physics: PhysicsWorld, x: number, z: number, heading: number) {
    const R = physics.R;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(x, 0.02, z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCcdEnabled(true)
      .setLinearDamping(0)
      .setAngularDamping(0.15)
      .setAdditionalMassProperties(SPEC.massKg, { x: this.com.x, y: this.com.y, z: this.com.z }, { x: 1750, y: HANDLING.yawInertia, z: 520 }, { x: 0, y: 0, z: 0, w: 1 });
    this.body = physics.world.createRigidBody(desc);
    // chassis: rounded boxes for the lower body and the cabin (mass comes from additional mass properties).
    // Low friction so the car glances along walls and traffic instead of digging in.
    const cg = groups(GROUP.PLAYER, GROUP.STATIC | GROUP.TRAFFIC);
    const lower = R.ColliderDesc.roundCuboid(0.78, 0.18, 2.1, 0.06).setTranslation(0, 0.56, -0.02).setDensity(0).setFriction(0.08).setRestitution(0.15).setCollisionGroups(cg).setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(3000);
    const cabin = R.ColliderDesc.roundCuboid(0.66, 0.2, 1.05, 0.08).setTranslation(0, 1.08, -0.4).setDensity(0).setFriction(0.1).setCollisionGroups(cg);
    physics.world.createCollider(lower, this.body);
    physics.world.createCollider(cabin, this.body);

    // suspension setup: static wheel-centre height = SPEC.wheelY; 54 % of the weight on the front axle
    const g = 9.81;
    for (const wd of WHEELS) {
      const load = (SPEC.massKg * g * (wd.front ? 0.54 : 0.46)) / 2;
      const k = wd.front ? 52000 : 46000;
      const mCorner = load / g;
      const staticComp = load / k;
      const travel = 0.2;
      const staticLen = travel - staticComp;
      const hpY = SPEC.wheelY + staticLen;
      const crit = 2 * Math.sqrt(k * mCorner);
      this.wheels.push({
        local: new THREE.Vector3(wd.x, hpY, wd.z), front: wd.front, left: wd.x > 0,
        k, bump: crit * 0.38, rebound: crit * 0.62, travel, length: staticLen, lastLength: staticLen,
        contact: false, fz: 0, omega: 0, spin: 0, steer: 0, slip: 0, slipLat: 0, kappa: 0, skid: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), onGrass: false,
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
    const H = HANDLING;
    up.set(0, 1, 0).applyQuaternion(this.quaternion);
    fwd.set(0, 0, 1).applyQuaternion(this.quaternion);
    right.set(-1, 0, 0).applyQuaternion(this.quaternion); // car's right = −X
    this.speed = this.velocity.dot(fwd);
    const absV = Math.abs(this.speed);
    const vRight = this.velocity.dot(right);
    const planar = Math.hypot(this.speed, vRight);
    const yawRate = this.angVel.dot(up);
    // body slip angle: + when the velocity points to the left of the nose
    const beta = planar > 3 && this.speed > 0 ? Math.atan2(-vRight, this.speed) : 0;
    this.slipAngle = beta;
    // how fast the direction of travel is turning (rad/s), smoothed
    const velHeading = Math.atan2(this.velocity.x, this.velocity.z);
    if (planar > 3) this.pathRate += (wrapPi(velHeading - this.prevVelHeading) / dt - this.pathRate) * Math.min(1, dt * 14);
    else this.pathRate = 0;
    this.prevVelHeading = velHeading;
    this.flipped = up.y < 0.25 ? this.flipped + dt : 0;

    // --- driver intent → throttle / brake / gear (S brakes, then reverses) ------------------------------------
    const dtn = this.drivetrain;
    let throttle = 0, brake = 0;
    if (dtn.mode === 'R') {
      throttle = input.brake;
      brake = input.throttle;
      if (input.throttle > 0.1 && absV < 1.2) dtn.setMode('D');
    } else {
      throttle = input.throttle;
      brake = input.brake;
      if (input.brake > 0.1 && absV < 0.8 && input.throttle < 0.1) {
        this.reverseHold += dt;
        if (this.reverseHold > 0.2) {
          dtn.setMode('R');
          this.reverseHold = 0;
        }
      } else this.reverseHold = 0;
      if (dtn.mode !== 'D' && input.throttle > 0.1) dtn.setMode('D');
    }
    this.braking = brake > 0.05;
    this.reversing = dtn.mode === 'R';
    this.handbrake = input.handbrake;
    const mu0 = TIRE.muRoad + (TIRE.muWet - TIRE.muRoad) * this.wet;
    const onRoad = this.grounded >= 2;

    // --- drifting: entry, state --------------------------------------------------------------------------------
    const steerLeft = -this.steerInput; // + = left
    const fast = this.speed > 8;
    const brakeTap = brake > 0.3 && !this.wasBraking;
    this.wasBraking = brake > 0.3;
    if (fast && onRoad && this.drift < 0.3) {
      const viaHandbrake = this.handbrake && Math.abs(steerLeft) > 0.15;
      const viaBrake = brakeTap && Math.abs(steerLeft) > 0.45 && this.speed > 14;
      if (viaHandbrake || viaBrake) {
        // kick the tail out into the turn
        const kick = Math.sign(steerLeft) * (0.5 + Math.min(0.4, this.speed / 90));
        const J = H.yawInertia * kick;
        body.applyTorqueImpulse({ x: up.x * J, y: up.y * J, z: up.z * J }, true);
        this.driftHold = 0.7;
      }
    }
    this.driftHold = Math.max(0, this.driftHold - dt);
    const sliding = fast && Math.abs(beta) > H.driftEnterSlip;
    const wantDrift = fast && onRoad && (sliding || this.driftHold > 0 || this.handbrake || (this.drift > 0.5 && Math.abs(beta) > 0.07));
    this.drift += ((wantDrift ? 1 : 0) - this.drift) * Math.min(1, dt * (wantDrift ? 12 : 4));
    if (this.drift < 0.01) this.drift = 0;
    const drift = this.drift;
    // drift score: angle × speed while it lasts, banked when the drift ends
    if (drift > 0.5 && Math.abs(beta) > 0.17) this.driftScore += Math.abs(beta) * this.speed * dt * 6;
    else if (drift < 0.2 && this.driftScore > 0) {
      if (this.driftScore > 40) {
        this.driftBanked = Math.round(this.driftScore);
        this.driftBankedCount++;
      }
      this.driftScore = 0;
    }

    // --- steering: the lock follows the grip limit, plus a little extra slip for bite ---------------------------
    const hs = smoothstep(40, 85, absV);
    const steerRate = Math.abs(input.steer) > Math.abs(this.steerInput) ? 7 - 3.8 * hs : 9;
    this.steerInput += Math.max(-steerRate * dt, Math.min(steerRate * dt, input.steer - this.steerInput));
    const L = SPEC.wheelbase, T = SPEC.track;
    const aLat = mu0 * 9.81 * (1 - 0.35 * hs);
    const maxLock = Math.min(0.62, Math.atan((L * aLat) / Math.max(absV * absV, 9)) + 0.11 - 0.07 * hs);
    const playerSteer = -this.steerInput * maxLock; // input +1 = right → road-wheel angle negative (left is +)
    // front wheels counter-steer by themselves towards the direction of travel while the car slides
    let steer = playerSteer;
    if (this.speed > 4) steer += THREE.MathUtils.clamp(beta * (0.35 + 0.5 * drift), -0.5, 0.5) * (1 - 0.35 * drift) + playerSteer * 0.6 * drift;
    steer = THREE.MathUtils.clamp(steer, -0.66, 0.66);
    this.steerAngle = steer;
    if (Math.abs(steer) > 1e-4) {
      const Rt = L / Math.tan(Math.abs(steer));
      const inner = Math.atan(L / (Rt - T / 2)), outer = Math.atan(L / (Rt + T / 2));
      for (const w of this.wheels) {
        if (!w.front) continue;
        const isInner = (steer > 0 && w.left) || (steer < 0 && !w.left);
        w.steer = Math.sign(steer) * (isInner ? inner : outer);
      }
    } else for (const w of this.wheels) if (w.front) w.steer = 0;

    // --- nitrous ---------------------------------------------------------------------------------------------------
    if (this.nitro <= 0.01) this.nitroLock = true;
    else if (this.nitro > 0.15) this.nitroLock = false;
    this.nitroActive = !!input.nitro && !this.nitroLock && throttle > 0.3 && dtn.mode === 'D';
    if (this.nitroActive) this.nitro = Math.max(0, this.nitro - dt / H.nitroSeconds);
    else this.nitro = Math.min(1, this.nitro + dt * (H.nitroRefill + (drift > 0.5 && Math.abs(beta) > 0.17 ? H.nitroRefillDrift : 0)));
    this.boostFx += ((this.nitroActive ? 1 : 0) - this.boostFx) * Math.min(1, dt * 7);
    dtn.nitroGain = this.nitroActive ? H.nitroTorque : 1;

    // --- drivetrain torque (AWD, rear-biased; more to the rear while drifting) -----------------------------------
    const frontSplit = dtn.frontSplit * (1 - 0.55 * drift);
    const frontOmega = (this.wheels[0].omega + this.wheels[1].omega) / 2, rearOmega = (this.wheels[2].omega + this.wheels[3].omega) / 2;
    let axleTorque = dtn.step(dt, throttle, frontOmega * frontSplit + rearOmega * (1 - frontSplit), this.speed, brake > 0.3);
    // traction control (assist): keep the driven wheels near peak slip. Off while drifting (wheelspin is the point).
    if (this.assists && drift < 0.3) {
      let k = 0;
      for (const w of this.wheels) if (w.contact) k = Math.max(k, w.kappa);
      const target = k > 0.2 ? Math.max(0.25, 1 - (k - 0.2) * 4) : 1;
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
    this.grounded = contacts;
    // anti-roll bars (front stiffer)
    const arb = [26000, 26000, 18000, 18000];
    const sum = _sum.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.contact) {
        w.fz = 0;
        w.slip = 0;
        w.skid = 0;
        continue;
      }
      const comp = comps[i];
      const vel = (w.lastLength - w.length) / dt; // + compressing
      const damp = vel > 0 ? w.bump * vel : w.rebound * vel;
      const other = i ^ 1;
      const roll = (comp - comps[other]) * arb[i];
      let fz = w.k * comp + damp + roll;
      if (comp >= w.travel - 0.005) fz += 90000 * (comp - (w.travel - 0.005)) + 2000; // bump stop
      fz = Math.max(0, Math.min(fz, 60000));
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

      // surface friction: off-road (grass/dirt) is a bit slippery
      const mu = w.onGrass ? TIRE.muGrass : mu0;
      // lateral grip: drifting loosens the rear and sharpens the front; the handbrake loosens the rear further
      const latScale = w.front ? 1 + (H.driftFrontGrip - 1) * drift : (1 + (H.driftRearGrip - 1) * drift) * (this.handbrake ? 0.7 : 1);
      // drive + brake torques
      const drive = (axleTorque * (w.front ? frontSplit : 1 - frontSplit)) / 2;
      // ABS (assist): cap brake torque at what the tyre can transmit, so the wheels don't lock,
      // and release a wheel whose slip ratio passes the peak (wheel much slower than the road)
      const brakeCap = this.assists ? mu * fz * this.radius * 0.97 : Infinity;
      let brakeReq = Math.min(brake * (w.front ? H.brakeFront : H.brakeRear), brakeCap);
      if (this.assists && brakeReq > 0 && Math.abs(vLong) > 2 && (w.omega * this.radius - vLong) / Math.abs(vLong) * Math.sign(vLong) < -0.16) brakeReq *= 0.25;
      const brakeT = brakeReq + (this.handbrake && !w.front ? H.handbrakeTorque : 0);
      // implicit wheel spin: I dω/dt = drive − R·Fx(ω) − brake. Driven wheels carry the engine/gearbox inertia
      // reflected through the gear ratio (this is what stops the wheels spinning up instantly).
      let tf = tireForces(vLong, vLat, w.omega * this.radius, fz, mu, this.radius, latScale);
      const gearR = dtn.ratio * dtn.finalDrive;
      const I = this.wheelInertia + (dtn.shiftTimer <= 0 ? (0.14 * gearR * gearR * (w.front ? frontSplit : 1 - frontSplit)) / 2 : 0);
      const k = this.radius * tf.dFxdOmega;
      let omega = (I * w.omega + dt * (drive - this.radius * tf.fx + k * w.omega)) / (I + dt * k);
      // brake as a friction clamp towards zero (never reverses the wheel)
      if (brakeT > 0) {
        const dOmega = (brakeT * dt) / (I + dt * k);
        if (Math.abs(omega) <= dOmega) omega = 0;
        else omega -= Math.sign(omega) * dOmega;
      }
      // rolling resistance
      omega -= Math.sign(omega) * Math.min(Math.abs(omega), (0.012 * fz * this.radius * dt) / I);
      w.omega = omega;
      tf = tireForces(vLong, vLat, w.omega * this.radius, fz, mu, this.radius, latScale);
      // low-speed lateral damping so the car doesn't creep sideways when parked (and the stiff tyre stays stable)
      let fy = tf.fy;
      const lowV = 3;
      if (Math.abs(vLong) < lowV) fy = THREE.MathUtils.clamp(-vLat * fz * 0.9, -mu * fz, mu * fz) * (1 - Math.abs(vLong) / lowV) + fy * (Math.abs(vLong) / lowV);
      const F = _F.copy(wf).multiplyScalar(tf.fx).addScaledVector(wl, fy);
      sum.add(F);
      body.applyImpulseAtPoint({ x: F.x * dt, y: F.y * dt, z: F.z * dt }, { x: w.point.x, y: w.point.y, z: w.point.z }, true);
      w.slip = tf.slip;
      w.slipLat = Math.abs(vLat);
      w.kappa = ((w.omega * this.radius - vLong) / Math.max(Math.abs(vLong), 1.5)) * Math.sign(vLong || 1);
      w.skid = Math.hypot(w.omega * this.radius - vLong, vLat) * Math.min(1, fz / 2500);
      this.maxSlip = Math.max(this.maxSlip, tf.slip);
    }
    // free-spinning wheels in the air: drive torque spins them, slow decay
    for (const w of this.wheels) {
      if (w.contact) continue;
      const drive = (axleTorque * (w.front ? frontSplit : 1 - frontSplit)) / 2;
      w.omega += (drive / (this.wheelInertia + 4)) * dt;
      w.omega *= 1 - dt * 0.5;
      if (this.handbrake && !w.front) w.omega = 0;
      if (this.braking) w.omega *= 1 - Math.min(1, dt * 8);
    }
    for (const w of this.wheels) w.spin += w.omega * dt;

    // --- aero: drag and downforce ---------------------------------------------------------------------------------
    const v2 = this.velocity.lengthSq();
    if (v2 > 0.01) {
      const drag = 0.5 * 1.2 * H.dragCdA * Math.sqrt(v2);
      body.applyImpulse({ x: -this.velocity.x * drag * dt, y: -this.velocity.y * drag * dt, z: -this.velocity.z * drag * dt }, true);
      if (contacts > 0) {
        const down = 0.5 * 1.2 * H.downforceClA * this.speed * this.speed * dt;
        body.applyImpulse({ x: -up.x * down, y: -up.y * down, z: -up.z * down }, true);
      }
    }
    // nitrous shove, felt in every gear (fades out near the top end)
    if (this.nitroActive && contacts >= 2) {
      const push = H.nitroPush * (1 - smoothstep(88, 98, absV)) * dt;
      body.applyImpulse({ x: fwd.x * push, y: 0, z: fwd.z * push }, true);
    }

    // --- yaw helpers ---------------------------------------------------------------------------------------------
    if (contacts >= 3 && absV > 2) {
      let tq = 0;
      // gripping: steer the car's rotation towards what the steering asks for
      const wMax = aLat / Math.max(absV, 6);
      const wGrip = THREE.MathUtils.clamp((this.speed * Math.tan(playerSteer)) / L, -wMax, wMax);
      tq += THREE.MathUtils.clamp((wGrip - yawRate) * H.steerHelp, -5, 5) * (1 - drift);
      // drifting: the stick sets the drift angle and a servo holds it (lifting off lets the car straighten)
      if (drift > 0.02) {
        const maxA = H.driftAngleMax + (H.driftAngleMaxFast - H.driftAngleMax) * smoothstep(33, 70, absV);
        const hold = throttle > 0.2 || this.handbrake ? 1 : 0.3;
        const betaDes = -steerLeft * maxA * hold;
        // dβ/dt = pathRate − yawRate, so to move β towards βdes: yawRate = pathRate − gain·(βdes − β)
        const wDrift = this.pathRate - H.driftGain * (betaDes - beta);
        tq += THREE.MathUtils.clamp((wDrift - yawRate) * H.driftYawGain, -9, 9) * drift;
        // give back most of the speed the sliding tyres scrub off while the throttle is down
        if (throttle > 0.3 && planar > 5) {
          const vh = _vh.set(this.velocity.x, 0, this.velocity.z).normalize();
          const along = sum.dot(vh);
          if (along < 0) {
            const give = -along * H.driftSpeedKeep * drift * throttle * dt;
            body.applyImpulse({ x: vh.x * give, y: 0, z: vh.z * give }, true);
          }
        }
      }
      const J = tq * H.yawInertia * dt;
      body.applyTorqueImpulse({ x: up.x * J, y: up.y * J, z: up.z * J }, true);
    } else if (contacts === 0) {
      // in the air: bleed off roll/pitch so jumps land on the wheels
      const k = Math.min(1, dt * 1.5);
      body.applyTorqueImpulse({ x: -this.angVel.x * 900 * k, y: 0, z: -this.angVel.z * 900 * k }, true);
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
    this.drift = 0;
    this.driftScore = 0;
    this.flipped = 0;
    this.prevVel.set(0, 0, 0);
    this.syncState();
  }

  /** speed along the car's nose (what the wheels see) */
  get kmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  /** speed over the ground whatever way the car points (what the HUD shows, so a drift doesn't read as slowing) */
  get groundKmh(): number {
    return Math.hypot(this.velocity.x, this.velocity.z) * 3.6;
  }

  get heading(): number {
    fwd.set(0, 0, 1).applyQuaternion(this.quaternion);
    return Math.atan2(fwd.x, fwd.z);
  }
}
