// The player's car: physics vehicle + visual model + light logic (headlights, brake/reverse lights, indicators).
import * as THREE from 'three';
import { Vehicle } from '../physics/Vehicle';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { CarVisual } from './CarVisual';
import type { DriveInput } from '../core/Input';

export class Car {
  readonly vehicle: Vehicle;
  readonly visual: CarVisual;
  headlightsOn = false;
  indicator: 'off' | 'left' | 'right' | 'hazard' = 'off';
  private indicatorSteerPeak = 0;
  private prevPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private curPos = new THREE.Vector3();
  private curQuat = new THREE.Quaternion();
  private hasPrev = false;

  constructor(physics: PhysicsWorld, gltfScene: THREE.Group, x: number, z: number, heading: number) {
    this.vehicle = new Vehicle(physics, x, z, heading);
    this.visual = new CarVisual(gltfScene);
  }

  get object(): THREE.Object3D {
    return this.visual.root;
  }

  physicsStep(dt: number, input: DriveInput): void {
    // Previous state for render interpolation = the body's pose right before this step runs. (It must be read
    // from the body: vehicle.position is only refreshed inside vehicle.step, so it is one step older.)
    const t = this.vehicle.body.translation(), r = this.vehicle.body.rotation();
    this.prevPos.set(t.x, t.y, t.z);
    this.prevQuat.set(r.x, r.y, r.z, r.w);
    this.hasPrev = true;
    this.vehicle.step(dt, input);
  }

  toggleIndicator(side: 'left' | 'right' | 'hazard'): void {
    this.indicator = this.indicator === side ? 'off' : side;
    this.indicatorSteerPeak = 0;
  }

  /** Interpolate the visual between physics steps (alpha 0..1) and update lights/wheels. */
  updateVisual(dt: number, alpha: number): void {
    const v = this.vehicle;
    const t = v.body.translation(), r = v.body.rotation();
    const cur = this.curPos.set(t.x, t.y, t.z), curQ = this.curQuat.set(r.x, r.y, r.z, r.w);
    if (this.hasPrev) {
      this.visual.root.position.lerpVectors(this.prevPos, cur, alpha);
      this.visual.root.quaternion.slerpQuaternions(this.prevQuat, curQ, alpha);
    } else {
      this.visual.root.position.copy(cur);
      this.visual.root.quaternion.copy(curQ);
    }
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      this.visual.setWheel(i, 0, w.front ? w.steer : 0, v.suspensionOffset(i));
      this.visual.wheels[i].rotation.x = w.spin * (i % 2 === 0 ? 1 : -1);
    }
    this.visual.setSteeringWheel(-v.steerInput * 7.8 * 0.6 / (1 + Math.pow(Math.abs(v.speed) / 19, 1.35)) * 1.6);
    // indicator auto-cancel after completing a turn
    if (this.indicator === 'left' || this.indicator === 'right') {
      const s = v.steerInput * (this.indicator === 'left' ? -1 : 1);
      this.indicatorSteerPeak = Math.max(this.indicatorSteerPeak, s);
      if (this.indicatorSteerPeak > 0.45 && s < 0.08) this.indicator = 'off';
    }
    const L = this.visual.lights;
    L.head = this.headlightsOn;
    L.brake = v.braking && !v.reversing ? true : v.reversing && v.braking;
    L.reverse = v.reversing;
    L.indicatorLeft = this.indicator === 'left' || this.indicator === 'hazard';
    L.indicatorRight = this.indicator === 'right' || this.indicator === 'hazard';
    this.visual.update(dt);
  }
}
