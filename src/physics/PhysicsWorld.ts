// Thin wrapper around Rapier: world stepping, static collider streaming, ray queries, contact force events.
import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;

let rapierReady: Promise<Rapier> | null = null;
export function initRapier(): Promise<Rapier> {
  if (!rapierReady) rapierReady = RAPIER.init().then(() => RAPIER);
  return rapierReady;
}

/** Collision groups: membership (high 16 bits) / filter (low 16 bits). */
export const GROUP = {
  STATIC: 0x0001,
  PLAYER: 0x0002,
  TRAFFIC: 0x0004,
};
export const groups = (member: number, filter: number) => (member << 16) | filter;

export interface ImpactEvent {
  force: number;
  handle1: number;
  handle2: number;
}

export class PhysicsWorld {
  readonly R: Rapier;
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  readonly staticBody: RAPIER.RigidBody;
  readonly impacts: ImpactEvent[] = [];
  readonly dt = 1 / 120;

  constructor(R: Rapier) {
    this.R = R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.dt;
    this.world.integrationParameters.numSolverIterations = 6;
    this.events = new R.EventQueue(true);
    this.staticBody = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    // infinite-ish ground slab (top at y = 0.0)
    const ground = R.ColliderDesc.cuboid(5000, 1, 5000).setTranslation(0, -1, 0).setFriction(1.0).setCollisionGroups(groups(GROUP.STATIC, 0xffff));
    this.world.createCollider(ground, this.staticBody);
  }

  step(): void {
    this.world.step(this.events);
    this.events.drainContactForceEvents((e) => {
      this.impacts.push({ force: e.totalForceMagnitude(), handle1: e.collider1(), handle2: e.collider2() });
    });
  }

  addTrimesh(vertices: Float32Array, indices: Uint32Array): RAPIER.Collider {
    const d = this.R.ColliderDesc.trimesh(vertices, indices).setFriction(0.8).setRestitution(0.05).setCollisionGroups(groups(GROUP.STATIC, 0xffff));
    return this.world.createCollider(d, this.staticBody);
  }

  addBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number): RAPIER.Collider {
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const d = this.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setRotation(q).setFriction(0.6).setRestitution(0.05).setCollisionGroups(groups(GROUP.STATIC, 0xffff));
    return this.world.createCollider(d, this.staticBody);
  }

  addCylinder(x: number, z: number, r: number, h: number): RAPIER.Collider {
    const d = this.R.ColliderDesc.cylinder(h / 2, r).setTranslation(x, h / 2, z).setFriction(0.6).setRestitution(0.1).setCollisionGroups(groups(GROUP.STATIC, 0xffff));
    return this.world.createCollider(d, this.staticBody);
  }

  remove(c: RAPIER.Collider): void {
    this.world.removeCollider(c, false);
  }

  /** Ray cast against static world (and optionally traffic); returns distance + normal or null. */
  castRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, filterGroups = groups(GROUP.PLAYER, GROUP.STATIC | GROUP.TRAFFIC), exclude?: RAPIER.RigidBody): { toi: number; nx: number; ny: number; nz: number; collider: RAPIER.Collider } | null {
    const ray = new this.R.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, filterGroups, undefined, exclude);
    if (!hit) return null;
    return { toi: hit.timeOfImpact, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z, collider: hit.collider };
  }
}
