// Cameras: third-person chase (speed-based FOV, look-ahead, mouse/stick orbit, obstacle avoidance), far chase,
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
}

/** Tuning (kept together instead of scattered literals). */
const CHASE = {
  distance: 5.7, height: 1.95, targetHeight: 1.05, distPerKmh: 0.008, maxExtraKmh: 160,
  farDistance: 8.4, farHeight: 2.9, farDistPerKmh: 0.011,
  headingLambda: 7.5, // how quickly the camera swings round behind the car
  reverseHeadingLambda: 2.0,
  positionLambda: 16, // residual positional smoothing (very tight: the heading does the work)
  lookLambda: 14,
  velocityBlend: 0.3, // share of velocity direction in the target heading when moving (shows drift angle)
  fovBase: 60, fovPerKmh: 0.095, fovMaxKmh: 190, fovLambda: 3,
  orbitReturnDelay: 1.6, orbitReturnLambda: 2.5,
};

const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);
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
  // scratch
  private readonly fwd = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly local = new THREE.Vector3();

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
    const fwd = this.fwd.set(0, 0, 1).applyQuaternion(car.quaternion);
    fwd.y = 0;
    fwd.normalize();
    const speed = Math.abs(car.speed);
    const kmh = speed * 3.6;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.orbitIdle += dt;
    if (this.orbitIdle > CHASE.orbitReturnDelay) {
      const k = damp(CHASE.orbitReturnLambda, dt);
      this.orbitYaw -= this.orbitYaw * k;
      this.orbitPitch -= this.orbitPitch * k;
    }

    if (this.mode === 'chase' || this.mode === 'far') {
      // target heading: the car's heading, blended towards its velocity when moving forward so drifts show the car's
      // angle. The blend fades in with speed so low-speed velocity noise can't wobble the camera.
      const carHeading = Math.atan2(fwd.x, fwd.z);
      let targetHeading = carHeading;
      if (car.speed > 1) {
        const velHeading = Math.atan2(car.velocity.x, car.velocity.z);
        let dv = velHeading - carHeading;
        dv = Math.atan2(Math.sin(dv), Math.cos(dv));
        targetHeading = carHeading + dv * CHASE.velocityBlend * smoothstep(4, 14, speed);
      }
      if (!this.initialised) this.heading = targetHeading;
      let dh = targetHeading - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * damp(car.speed < -1 ? CHASE.reverseHeadingLambda : CHASE.headingLambda, dt);

      const far = this.mode === 'far';
      const extra = Math.min(kmh, CHASE.maxExtraKmh);
      const dist = far ? CHASE.farDistance + extra * CHASE.farDistPerKmh : CHASE.distance + extra * CHASE.distPerKmh;
      const height = (far ? CHASE.farHeight : CHASE.height) + this.orbitPitch * 3.5;
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
      else this.pos.lerp(desired, damp(CHASE.positionLambda, dt));
      if (this.pos.y < car.position.y + 0.5) this.pos.y = car.position.y + 0.5;

      const ahead = Math.min(speed * 0.12, 3.5) * (lookBack ? -1 : 1);
      const lookAhead = this.lookTarget.copy(target).addScaledVector(fwd, ahead);
      if (!this.initialised) this.look.copy(lookAhead);
      else this.look.lerp(lookAhead, damp(CHASE.lookLambda, dt));
      cam.position.copy(this.pos);
      const fovTarget = CHASE.fovBase + Math.min(kmh, CHASE.fovMaxKmh) * CHASE.fovPerKmh;
      this.fov += (fovTarget - this.fov) * damp(CHASE.fovLambda, dt);
      cam.near = 0.1;
    } else {
      const interior = this.mode === 'interior';
      const local = interior ? this.local.set(DRIVER_EYE.x, DRIVER_EYE.y, DRIVER_EYE.z) : this.local.set(0, 1.2, 0.55);
      const k = damp(4, dt);
      this.sway.x += (THREE.MathUtils.clamp(-car.lateralG, -1, 1) - this.sway.x) * k;
      this.sway.y += (THREE.MathUtils.clamp(-car.longG, -1, 1) - this.sway.y) * k;
      if (interior) {
        local.x += this.sway.x * 0.03;
        local.z += this.sway.y * 0.025;
      }
      cam.position.copy(local).applyQuaternion(car.quaternion).add(car.position);
      this.lookTarget.set(local.x * (interior ? 0.85 : 1) - this.orbitYaw * 2, local.y - 0.12 - this.orbitPitch, local.z + (lookBack ? -10 : 10));
      this.look.copy(this.lookTarget).applyQuaternion(car.quaternion).add(car.position);
      const fovTarget = (interior ? 68 : 66) + Math.min(kmh, 190) * 0.04;
      this.fov += (fovTarget - this.fov) * damp(3, dt);
      cam.near = interior ? 0.03 : 0.08;
    }
    if (this.shake > 0.01) {
      const s = this.shake * this.shake * 0.12;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    this.initialised = true;
  }

  /** Slow orbit used behind the main menu. */
  menuOrbit(t: number, center: THREE.Vector3): void {
    const r = 7.5, a = t * 0.12;
    this.camera.position.set(center.x + Math.sin(a) * r, center.y + 1.9, center.z + Math.cos(a) * r);
    this.camera.lookAt(center.x, center.y + 0.7, center.z);
    this.camera.fov = 45;
    this.camera.near = 0.1;
    this.camera.updateProjectionMatrix();
    this.initialised = false;
  }
}
