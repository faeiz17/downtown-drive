// Police pursuit. Triggered by speeding or hitting traffic. Patrol cars follow the player's own trail (breadcrumbs), so
// they stay on the road network without a path planner, close in when near, and ram. Outcomes:
//   ESCAPED: stay out of reach for a while  ·  BUSTED: they box you in (close and you are nearly stopped)
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld, GROUP, groups } from '../physics/PhysicsWorld';

export type PoliceEvent = 'started' | 'escaped' | 'busted' | 'escalated';

interface Cop {
  group: THREE.Group;
  x: number;
  z: number;
  heading: number;
  speed: number;
  body: RAPIER.RigidBody | null;
  bar: THREE.MeshBasicMaterial[];
  phase: number;
}

export interface PlayerState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  kmh: number;
  heading: number;
}

const MAX_COPS = 4;
const CRUMB_STEP = 6; // metres between trail points
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Police {
  readonly group = new THREE.Group();
  private cops: Cop[] = [];
  private trail: { x: number; z: number }[] = [];
  /** 0 = none, 1..4 = pursuit level */
  level = 0;
  /** seconds spent out of reach (escape timer) and boxed in (bust timer) */
  private away = 0;
  private caught = 0;
  private speedingFor = 0;
  private cooldown = 0;
  private flash = 0;
  onEvent: ((e: PoliceEvent) => void) | null = null;
  /** nearest siren: distance (m) and left/right pan -1..1, for the audio engine */
  nearest = { dist: Infinity, pan: 0 };
  private readonly q = new THREE.Quaternion();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly bodyMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.4, metalness: 0.5 });
  private readonly whiteMat = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.45, metalness: 0.3 });
  private readonly glassMat = new THREE.MeshStandardMaterial({ color: 0x0b1118, roughness: 0.1, metalness: 0.8 });

  constructor(scene: THREE.Scene, private physics: PhysicsWorld, private roadPoint: (x: number, z: number) => { x: number; z: number; tx: number; tz: number } | null) {
    scene.add(this.group);
    for (let i = 0; i < MAX_COPS; i++) this.cops.push(this.makeCop());
  }

  private makeCop(): Cop {
    const g = new THREE.Group();
    const box = (w: number, h: number, d: number, y: number, z: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(0, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    box(1.86, 0.62, 4.5, 0.62, 0, this.bodyMat);
    box(1.88, 0.3, 2.3, 0.94, 0.1, this.whiteMat); // white doors / roof section
    box(1.7, 0.42, 2.0, 1.2, -0.15, this.glassMat);
    box(1.6, 0.06, 1.7, 1.43, -0.15, this.whiteMat);
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.2, 0.2), toneMapped: false });
    const blue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.9, 10), toneMapped: false });
    for (const [x, m] of [[-0.42, red], [0.42, blue]] as [number, THREE.MeshBasicMaterial][]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.13, 0.32), m);
      bar.position.set(x, 1.52, -0.15);
      g.add(bar);
    }
    // headlights + tail lights (unlit emissive)
    const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.8, 3.2), toneMapped: false });
    const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.1, 0.1), toneMapped: false });
    for (const x of [-0.65, 0.65]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.06), head);
      h.position.set(x, 0.7, 2.27);
      g.add(h);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.06), tail);
      t.position.set(x, 0.72, -2.27);
      g.add(t);
    }
    for (const x of [-0.95, 0.95])
      for (const z of [-1.4, 1.4]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.8 }));
        w.position.set(x, 0.33, z);
        g.add(w);
      }
    g.visible = false;
    this.group.add(g);
    return { group: g, x: 0, z: 0, heading: 0, speed: 0, body: null, bar: [red, blue], phase: Math.random() * 6 };
  }

  private activate(c: Cop, x: number, z: number, heading: number, speed: number): void {
    c.x = x;
    c.z = z;
    c.heading = heading;
    c.speed = speed;
    c.group.visible = true;
    if (!c.body) {
      const R = this.physics.R;
      c.body = this.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 0.02, z));
      this.physics.world.createCollider(R.ColliderDesc.cuboid(0.93, 0.6, 2.25).setTranslation(0, 0.72, 0).setCollisionGroups(groups(GROUP.TRAFFIC, GROUP.PLAYER)).setFriction(0.2), c.body);
    } else c.body.setEnabled(true);
  }

  private deactivate(c: Cop): void {
    c.group.visible = false;
    c.body?.setEnabled(false);
  }

  /** Start / raise the pursuit (hit traffic, speeding). */
  alert(p: PlayerState, amount = 1): void {
    if (this.cooldown > 0) return;
    if (this.level === 0) {
      this.level = 1;
      this.away = 0;
      this.caught = 0;
      this.onEvent?.('started');
      this.spawn(p, 2);
    } else if (this.level < 4 && amount > 1) {
      this.level++;
      this.onEvent?.('escalated');
      this.spawn(p, 1);
    }
  }

  private spawn(p: PlayerState, n: number): void {
    for (let k = 0; k < n; k++) {
      const c = this.cops.find((x) => !x.group.visible);
      if (!c) return;
      // a point on the trail roughly 160–230 m behind the player (or on the nearest road if the trail is short)
      let sx = p.x - Math.sin(p.heading) * 180, sz = p.z - Math.cos(p.heading) * 180, hd = p.heading;
      let back = 0;
      for (let i = this.trail.length - 1; i > 0; i--) {
        back += CRUMB_STEP;
        if (back > 160 + 50 * k) {
          sx = this.trail[i].x;
          sz = this.trail[i].z;
          hd = Math.atan2(this.trail[i + 1].x - sx, this.trail[i + 1].z - sz);
          break;
        }
      }
      const r = this.roadPoint(sx, sz);
      if (r) {
        sx = r.x;
        sz = r.z;
        if (this.trail.length < 30) hd = Math.atan2(r.tx, r.tz);
      }
      this.activate(c, sx, sz, hd, 20);
    }
  }

  private end(e: PoliceEvent): void {
    for (const c of this.cops) this.deactivate(c);
    this.level = 0;
    this.away = 0;
    this.caught = 0;
    this.cooldown = e === 'busted' ? 6 : 14;
    this.nearest.dist = Infinity;
    this.onEvent?.(e);
  }

  /** The player teleported (reset / restart): drop the trail. */
  clearTrail(): void {
    this.trail.length = 0;
  }

  update(dt: number, p: PlayerState, enabled: boolean): void {
    // breadcrumb trail
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > CRUMB_STEP) {
      if (last && Math.hypot(p.x - last.x, p.z - last.z) > 60) this.trail.length = 0;
      this.trail.push({ x: p.x, z: p.z });
      if (this.trail.length > 400) this.trail.shift();
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!enabled) {
      if (this.level) this.end('escaped');
      return;
    }
    // speeding raises the alarm (a cop is "nearby" once you have been flat out for a few seconds)
    this.speedingFor = p.kmh > 175 ? this.speedingFor + dt : Math.max(0, this.speedingFor - dt * 2);
    if (this.level === 0 && this.speedingFor > 5) this.alert(p);
    if (this.level === 0) {
      this.nearest.dist = Infinity;
      return;
    }
    this.flash += dt;
    let nearest = Infinity, pan = 0;
    let anyClose = false;
    for (const c of this.cops) {
      if (!c.group.visible) continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      // target: the oldest trail point still ahead of us and within reach; direct pursuit when close
      let tx = p.x, tz = p.z;
      if (d > 28) {
        let best = -1, bd = Infinity;
        for (let i = 0; i < this.trail.length; i++) {
          const q = this.trail[i];
          const qd = Math.hypot(q.x - c.x, q.z - c.z);
          if (qd < bd) {
            bd = qd;
            best = i;
          }
        }
        const ti = Math.min(this.trail.length - 1, best + 2 + Math.round(c.speed / 14));
        if (best >= 0 && ti >= 0) {
          tx = this.trail[ti].x;
          tz = this.trail[ti].z;
        }
      }
      const want = Math.atan2(tx - c.x, tz - c.z);
      const turn = wrapPi(want - c.heading);
      const maxRate = 2.4 / (1 + c.speed / 22);
      c.heading += Math.max(-maxRate * dt, Math.min(maxRate * dt, turn));
      // rubber-banded speed: hold roughly the player's speed + a little, hit the brakes in tight turns
      const vp = Math.hypot(p.vx, p.vz);
      let target = Math.min(60 + this.level * 3, Math.max(22, vp * 0.98 + 7 + (d > 120 ? (d - 120) * 0.12 : 0)));
      target *= 1 - Math.min(0.5, Math.abs(turn) * 0.6);
      if (d < 14) target = Math.max(target, vp * 1.05 + 3);
      c.speed += Math.max(-24 * dt, Math.min(15 * dt, target - c.speed));
      c.x += Math.sin(c.heading) * c.speed * dt;
      c.z += Math.cos(c.heading) * c.speed * dt;
      c.group.position.set(c.x, 0.02, c.z);
      c.group.rotation.y = c.heading;
      c.body?.setNextKinematicTranslation({ x: c.x, y: 0.02, z: c.z });
      const q = this.q.setFromAxisAngle(this.yAxis, c.heading);
      c.body?.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      // light bar flashes alternate red / blue
      const on = Math.floor((this.flash + c.phase) * 7) % 2 === 0;
      c.bar[0].color.setRGB(on ? 8 : 0.4, 0.2, 0.2);
      c.bar[1].color.setRGB(0.3, on ? 0.5 : 0.9, on ? 1 : 10);
      if (d < nearest) {
        nearest = d;
        pan = Math.max(-1, Math.min(1, (dx * Math.cos(p.heading) - dz * Math.sin(p.heading)) / Math.max(10, d)));
      }
      if (d < 11) anyClose = true;
      // a car that has fallen far behind is respawned closer (keeps the chase alive on long straights)
      if (d > 420) this.deactivate(c);
    }
    this.nearest.dist = nearest;
    this.nearest.pan = pan;
    if (!this.cops.some((c) => c.group.visible)) this.spawn(p, 1);
    // outcomes
    if (nearest > 300) this.away += dt;
    else this.away = Math.max(0, this.away - dt * 1.5);
    if (anyClose && p.kmh < 28) this.caught += dt;
    else this.caught = Math.max(0, this.caught - dt * 2);
    if (this.away > 10) this.end('escaped');
    else if (this.caught > 3) this.end('busted');
    // the longer the chase, the more cars
    this.chaseTime += dt;
    if (this.chaseTime > 25 * this.level && this.level < 3) {
      this.chaseTime = 0;
      this.alert(p, 2);
    }
  }
  private chaseTime = 0;
  /** nothing to do on a fresh start */
  resetChase(): void {
    this.chaseTime = 0;
  }
}
