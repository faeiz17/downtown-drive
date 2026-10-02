// Cameras: low third-person chase tuned for a sense of speed (the view widens, drops and pulls back as the car goes
// faster, kicks on nitrous, swings wide in a drift so the car is seen side-on, and shakes with speed), far chase,
// hood camera and right-hand-drive interior camera with g-force head sway.
// Smoothing uses frame-rate independent exponential damping (1 − e^(−λ·dt)), not springs: no overshoot, no wobble,
// identical feel at 60 / 120 / 144 Hz. No allocations per frame (all scratch vectors are preallocated).
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { GROUP, groups } from '../physics/PhysicsWorld';
import { DRIVER_EYE } from '../car/spec';

export type CameraMode = 'chase' | 'far' | 'hood' | 'interior';
const ORDER: CameraMode[] = ['chase', 'far', 'hood', 'interior'];

export interface CarPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  speed: number; // signed forward m/s
  lateralG: number;
  longG: number;
  /** 0..1 nitrous burning */
  boost: number;
  /** 0..1 drifting */
  drift: number;
}

/** Tuning (kept together instead of scattered literals). */
const CHASE = {
  distance: 4.7, height: 1.4, targetHeight: 0.9, distPerKmh: 0.0009, maxExtraKmh: 300,
  farDistance: 7.6, farHeight: 2.5, farDistPerKmh: 0.008,
  dropPerKmh: 0.0009, // the camera sinks a little with speed: the road rushes past closer to the lens
  boostDistance: 0.2,
  headingLambda: 6.5, // how quickly the camera swings round behind the car
  reverseHeadingLambda: 2.0,
  positionLambda: 16, // residual positional smoothing (very tight: the heading does the work)
  lookLambda: 14,
  velocityBlend: 0.32, // share of velocity direction in the target heading when moving
  velocityBlendDrift: 0.8, // … while drifting: the camera follows the direction of travel, the car hangs sideways
  fovBase: 61, fovPerKmh: 0.078, fovMaxKmh: 310, fovBoost: 7, fovLambda: 3.2,
  orbitReturnDelay: 1.6, orbitReturnLambda: 2.5,
  shakeSpeed: 0.022, shakeBoost: 0.03, // metres of shake at top speed / on nitrous
  roll: 0.016, // rad of camera roll per g of lateral acceleration
};

const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);

/**
 * Exact exponential follow of a target that moved linearly from `prev` to `cur` during dt.
 * Plain damping (x += (cur − x)·(1 − e^(−λdt))) trails a moving target by an amount that depends on dt, so frame
 * time jitter shows up as camera jitter. The closed-form solution of dx/dt = λ(target(t) − x) trails by exactly
 * velocity/λ whatever the frame time is.
 */
function followLinear(x: number, prev: number, cur: number, lambda: number, dt: number): number {
  if (dt <= 0) return x;
  const u = (cur - prev) / dt / lambda;
  return cur - u + (x - prev + u) * Math.exp(-lambda * dt);
}
function followVec(x: THREE.Vector3, prev: THREE.Vector3, cur: THREE.Vector3, lambda: number, dt: number): void {
  x.set(followLinear(x.x, prev.x, cur.x, lambda, dt), followLinear(x.y, prev.y, cur.y, lambda, dt), followLinear(x.z, prev.z, cur.z, lambda, dt));
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class CameraRig {
  mode: CameraMode = 'chase';
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private orbitYaw = 0;
  private orbitPitch = 0;
  private orbitIdle = 0;
  private fov = 60;
  private initialised = false;
  private heading = 0;
  private sway = new THREE.Vector2();
  private shake = 0;
  private obstacleDist = Infinity;
  private time = 0;
  private roll = 0;
  private velBlend = CHASE.velocityBlend;
  /** scales the speed shake (settings / photo mode) */
  shakeScale = 1;
  // scratch
  private readonly fwd = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private readonly prevDesired = new THREE.Vector3();
  private readonly prevLookTarget = new THREE.Vector3();
  private readonly rollQ = new THREE.Quaternion();
  private readonly axisZ = new THREE.Vector3(0, 0, 1);
  private prevTargetHeading = 0;

  constructor(readonly camera: THREE.PerspectiveCamera, private physics: PhysicsWorld) {}

  cycle(): CameraMode {
    this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length];
    this.initialised = false;
    return this.mode;
  }

  /** Jump straight to the target pose next frame (after resets / teleports). */
  snap(): void {
    this.initialised = false;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  orbit(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.orbitYaw -= dx * 0.005;
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.003, -0.25, 0.9);
    this.orbitIdle = 0;
  }

  update(dt: number, car: CarPose, lookBack: boolean): void {
    const cam = this.camera;
    this.time += dt;
    const fwd = this.fwd.set(0, 0, 1).applyQuaternion(car.quaternion);
    fwd.y = 0;
    fwd.normalize();
    const groundSpeed = Math.hypot(car.velocity.x, car.velocity.z);
    const kmh = groundSpeed * 3.6;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.orbitIdle += dt;
    if (this.orbitIdle > CHASE.orbitReturnDelay) {
      const k = damp(CHASE.orbitReturnLambda, dt);
      this.orbitYaw -= this.orbitYaw * k;
      this.orbitPitch -= this.orbitPitch * k;
    }
    const chase = this.mode === 'chase' || this.mode === 'far';

    if (chase) {
      // target heading: the car's heading, blended towards its velocity when moving forward. While drifting the
      // blend goes most of the way to the direction of travel, so the car is seen sideways and the road stays
      // ahead. The blend fades in with speed so low-speed velocity noise can't wobble the camera.
      const carHeading = Math.atan2(fwd.x, fwd.z);
      let targetHeading = carHeading;
      this.velBlend += (CHASE.velocityBlend + (CHASE.velocityBlendDrift - CHASE.velocityBlend) * car.drift - this.velBlend) * damp(5, dt);
      if (car.speed > 1) {
        const velHeading = Math.atan2(car.velocity.x, car.velocity.z);
        let dv = velHeading - carHeading;
        dv = Math.atan2(Math.sin(dv), Math.cos(dv));
        targetHeading = carHeading + dv * this.velBlend * smoothstep(4, 14, groundSpeed);
      }
      if (!this.initialised) {
        this.heading = targetHeading;
        this.prevTargetHeading = targetHeading;
      }
      // unwrap the target relative to last frame so the follow works across the ±π seam
      let dT = targetHeading - this.prevTargetHeading;
      dT = Math.atan2(Math.sin(dT), Math.cos(dT));
      const unwrapped = this.prevTargetHeading + dT;
      let dh = this.heading - this.prevTargetHeading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading = followLinear(this.prevTargetHeading + dh, this.prevTargetHeading, unwrapped, car.speed < -1 ? CHASE.reverseHeadingLambda : CHASE.headingLambda, dt);
      this.prevTargetHeading = targetHeading;

      const far = this.mode === 'far';
      const extra = Math.min(kmh, CHASE.maxExtraKmh);
      const dist = (far ? CHASE.farDistance + extra * CHASE.farDistPerKmh : CHASE.distance + extra * CHASE.distPerKmh) + car.boost * CHASE.boostDistance;
      const height = (far ? CHASE.farHeight : CHASE.height) - extra * CHASE.dropPerKmh + this.orbitPitch * 3.5;
      const h = this.heading + this.orbitYaw + (lookBack ? Math.PI : 0);
      const target = this.target.set(car.position.x, car.position.y + CHASE.targetHeight, car.position.z);
      const desired = this.desired.set(target.x - Math.sin(h) * dist, car.position.y + height, target.z - Math.cos(h) * dist);
      // obstacle avoidance: pull in front of walls between car and camera (smoothed so it doesn't pop)
      const dir = this.dir.subVectors(desired, target);
      const L = dir.length();
      dir.divideScalar(L || 1);
      const hit = this.physics.castRay(target.x, target.y, target.z, dir.x, dir.y, dir.z, L, groups(GROUP.PLAYER, GROUP.STATIC));
      const want = hit && hit.toi < L ? Math.max(1.2, hit.toi - 0.3) : L;
      this.obstacleDist = !this.initialised || want < this.obstacleDist ? want : this.obstacleDist + (want - this.obstacleDist) * damp(3, dt);
      if (this.obstacleDist < L) desired.copy(target).addScaledVector(dir, this.obstacleDist);
      if (!this.initialised) this.pos.copy(desired);
      else followVec(this.pos, this.prevDesired, desired, CHASE.positionLambda, dt);
      this.prevDesired.copy(desired);
      if (this.pos.y < car.position.y + 0.45) this.pos.y = car.position.y + 0.45;

      // look a little ahead of the car, along the camera's own heading (so a drifting car is not centred on its nose)
      const ahead = Math.min(groundSpeed * 0.1, 5) * (lookBack ? -1 : 1);
      const lookAhead = this.lookTarget.set(target.x + Math.sin(this.heading) * ahead, target.y, target.z + Math.cos(this.heading) * ahead);
      if (!this.initialised) this.look.copy(lookAhead);
      else followVec(this.look, this.prevLookTarget, lookAhead, CHASE.lookLambda, dt);
      this.prevLookTarget.copy(lookAhead);
      cam.position.copy(this.pos);
      const fovTarget = CHASE.fovBase + Math.min(kmh, CHASE.fovMaxKmh) * CHASE.fovPerKmh + car.boost * CHASE.fovBoost + (far ? -3 : 0);
      this.fov += (fovTarget - this.fov) * damp(CHASE.fovLambda, dt);
      cam.near = 0.1;
    } else {
      const interior = this.mode === 'interior';
      const local = interior ? this.local.set(DRIVER_EYE.x, DRIVER_EYE.y, DRIVER_EYE.z) : this.local.set(0, 1.12, 0.62);
      const k = damp(4, dt);
      this.sway.x += (THREE.MathUtils.clamp(-car.lateralG, -1.5, 1.5) - this.sway.x) * k;
      this.sway.y += (THREE.MathUtils.clamp(-car.longG, -1.5, 1.5) - this.sway.y) * k;
      if (interior) {
        local.x += this.sway.x * 0.03;
        local.z += this.sway.y * 0.03;
      }
      cam.position.copy(local).applyQuaternion(car.quaternion).add(car.position);
      this.lookTarget.set(local.x * (interior ? 0.85 : 1) - this.orbitYaw * 2, local.y - 0.12 - this.orbitPitch, local.z + (lookBack ? -10 : 10));
      this.look.copy(this.lookTarget).applyQuaternion(car.quaternion).add(car.position);
      const fovTarget = (interior ? 70 : 72) + Math.min(kmh, 300) * 0.055 + car.boost * 6;
      this.fov += (fovTarget - this.fov) * damp(3, dt);
      cam.near = interior ? 0.03 : 0.08;
    }
    // speed shake: smooth (band-limited) noise, a few hertz, growing with speed² and on nitrous; impacts add a jolt
    const sp = Math.min(1, kmh / 300);
    const amp = (sp * sp * CHASE.shakeSpeed + car.boost * CHASE.shakeBoost) * this.shakeScale + this.shake * this.shake * 0.1;
    if (amp > 0.0005) {
      const t = this.time;
      cam.position.x += (Math.sin(t * 31.7) * 0.6 + Math.sin(t * 57.3 + 1.3) * 0.4) * amp;
      cam.position.y += (Math.sin(t * 37.9 + 0.7) * 0.6 + Math.sin(t * 71.1 + 2.1) * 0.4) * amp;
      cam.position.z += (Math.sin(t * 29.3 + 2.9) * 0.6 + Math.sin(t * 63.7 + 0.4) * 0.4) * amp * 0.5;
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    // lean into corners (chase) — interior and hood already roll with the body
    const rollTarget = chase ? THREE.MathUtils.clamp(car.lateralG * CHASE.roll, -0.05, 0.05) : 0;
    this.roll += (rollTarget - this.roll) * damp(4, dt);
    if (Math.abs(this.roll) > 1e-4) cam.quaternion.multiply(this.rollQ.setFromAxisAngle(this.axisZ, this.roll));
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    this.initialised = true;
  }

  /** Slow orbit used behind the main menu. */
  menuOrbit(t: number, center: THREE.Vector3): void {
    const r = 6.4, a = t * 0.12;
    this.camera.position.set(center.x + Math.sin(a) * r, center.y + 1.25, center.z + Math.cos(a) * r);
    this.camera.lookAt(center.x, center.y + 0.62, center.z);
    this.camera.fov = 42;
    this.camera.near = 0.1;
    this.camera.updateProjectionMatrix();
    this.initialised = false;
  }
}
