// AI traffic on the OSM road graph: lanes on the city's driving side, IDM car-following (incl. the player), timed
// signals, give-way reservations at other junctions, spawn/despawn ring around the player.
// Bodies are kinematic while the AI drives them. A car the player is about to hit is switched to a light dynamic
// body just before contact, so it gets punted out of the way (arcade "traffic checking") instead of acting like a
// wall; it stays a wreck for a few seconds and is then recycled.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { WorldData } from '../data/types';
import { ROAD_CLASSES } from '../data/roadClasses';
import { RNG } from '../core/rng';
import { cumulative, sampleAt, SpatialGrid, leftNormal } from '../core/geom2d';
import { RoadGraph, type Lane } from './RoadGraph';
import { buildVehicleModels, KIND_WEIGHTS, type VehicleModel } from './models';
import { PhysicsWorld, GROUP, groups } from '../physics/PhysicsWorld';

type SignalState = 'green' | 'amber' | 'red';

interface Path {
  pts: number[];
  cum: number[];
  length: number;
}

class AIVehicle {
  model: number;
  color = new THREE.Color();
  lane!: Lane;
  s = 0;
  v = 0;
  turning: Path | null = null;
  next: { lane: Lane } | null = null;
  x = 0;
  z = 0;
  hx = 0;
  hz = 1;
  blocked = 0;
  honkCd = 0;
  waiting = 0;
  reserved = -1;
  age = 0;
  body: RAPIER.RigidBody | null = null;
  targetSpeedJitter = 1;
  /** 0 = driven by the AI, 1 = armed (dynamic, about to be hit), 2 = wrecked (dynamic, free) */
  wreck = 0;
  wreckT = 0;
  y = 0.02;
  readonly q = new THREE.Quaternion();
  /** last frame's position along the player's heading (near-miss detection) */
  along = 0;
  constructor(model: number) {
    this.model = model;
  }
}

const CYCLE = { green: 16, amber: 3, allRed: 2 };
const CYCLE_T = 2 * (CYCLE.green + CYCLE.amber + CYCLE.allRed);

export interface PlayerInfo {
  x: number;
  z: number;
  hx: number;
  hz: number;
  speed: number;
  /** ground velocity (m/s) */
  vx: number;
  vz: number;
}

/** traffic is deliberately light so hitting it costs speed but doesn't stop the car dead */
const TRAFFIC_MASS = 430;
const WRECK_SECONDS = 7;

export class TrafficManager {
  readonly group = new THREE.Group();
  readonly graph: RoadGraph;
  private models: VehicleModel[];
  private meshes: { paint: THREE.InstancedMesh; fixed: THREE.InstancedMesh; lights: THREE.InstancedMesh }[] = [];
  private vehicles: AIVehicle[] = [];
  private rng = new RNG(20260927);
  private time = 0;
  private spawnTimer = 0;
  private grid = new SpatialGrid<number>(30);
  private occupancy = new Map<number, Set<AIVehicle>>();
  private clusters = new Map<number, { offset: number; axis: number }>();
  private lightMat: THREE.MeshBasicMaterial;
  private signalBulbs: THREE.InstancedMesh | null = null;
  private approaches: { cluster: number; group: number; bulb: number }[] = [];
  private lastSignalState = '';
  target = 45;
  onHonk: ((x: number, z: number, kind: string) => void) | null = null;
  /** called when the player threads past a car at speed (closing speed in m/s) */
  onNearMiss: ((closing: number) => void) | null = null;
  private owners = new Map<number, AIVehicle>(); // collider handle → vehicle
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s3 = new THREE.Vector3(1, 1, 1);
  private p3 = new THREE.Vector3();

  constructor(private world: WorldData, private physics: PhysicsWorld | null, scene: THREE.Scene) {
    this.graph = new RoadGraph(world);
    this.models = buildVehicleModels();
    const paintMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4, vertexColors: true });
    const fixedMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1, vertexColors: true });
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const MAX = 110;
    for (const m of this.models) {
      const paint = new THREE.InstancedMesh(m.paint, paintMat, MAX);
      paint.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
      const fixed = new THREE.InstancedMesh(m.fixed, fixedMat, MAX);
      const lights = new THREE.InstancedMesh(m.lights, this.lightMat, MAX);
      for (const im of [paint, fixed, lights]) {
        im.count = 0;
        im.frustumCulled = false;
        im.castShadow = im !== lights;
        im.receiveShadow = true;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(im);
      }
      this.meshes.push({ paint, fixed, lights });
    }
    scene.add(this.group);
    this.buildSignals(scene);
  }

  // ------------------------------------------------------------------ signals
  private buildSignals(scene: THREE.Scene): void {
    const w = this.world;
    // cluster axis = direction of the highest-ranked road through the cluster
    const best = new Map<number, { rank: number; axis: number }>();
    w.nodes.forEach((n) => {
      if (n.signal === undefined) return;
      for (const ei of n.edges) {
        const e = w.edges[ei];
        const rank = ROAD_CLASSES[e.cls].rank;
        const dx = e.pts[e.pts.length - 2] - e.pts[0], dz = e.pts[e.pts.length - 1] - e.pts[1];
        const cur = best.get(n.signal);
        if (!cur || rank > cur.rank) best.set(n.signal, { rank, axis: Math.atan2(dx, dz) });
      }
    });
    for (const [c, b] of best) this.clusters.set(c, { offset: this.rng.range(0, CYCLE_T), axis: b.axis });
    // signal heads: one pole per approach, on the kerb (left) side just before the stop line
    const poles: number[] = [];
    const bulbs: number[] = [];
    w.nodes.forEach((n, ni) => {
      if (n.signal === undefined) return;
      for (const ei of n.edges) {
        const e = w.edges[ei];
        const arrivingDir = e.b === ni ? 1 : -1; // direction of travel that arrives at this node
        if ((arrivingDir === 1 ? e.lanesF : e.lanesB) === 0) continue;
        const cum = cumulative(e.pts);
        const L = cum[cum.length - 1];
        if (L < n.r + 6) continue;
        const s = arrivingDir === 1 ? L - n.r - 4.5 : n.r + 4.5;
        const sp = sampleAt(e.pts, cum, s);
        const tx = sp.tx * arrivingDir, tz = sp.tz * arrivingDir;
        const [lx, lz] = leftNormal(tx, tz);
        const off = e.width / 2 + 0.7;
        const px = sp.x + lx * off, pz = sp.z + lz * off;
        const yaw = Math.atan2(-tx, -tz); // head faces oncoming traffic
        poles.push(px, pz, yaw);
        const group = this.approachGroup(n.signal, tx, tz);
        this.approaches.push({ cluster: n.signal, group, bulb: bulbs.length / 4 });
        for (let k = 0; k < 3; k++) bulbs.push(px, pz, yaw, k);
      }
    });
    if (!poles.length) return;
    const poleGeo = mergeSimple([
      new THREE.CylinderGeometry(0.07, 0.09, 3.2, 8).translate(0, 1.6, 0),
      new THREE.BoxGeometry(0.34, 0.95, 0.24).translate(0, 3.55, 0),
      new THREE.BoxGeometry(0.5, 1.1, 0.03).translate(0, 3.55, -0.12),
    ]);
    const poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 }), poles.length / 3);
    for (let i = 0; i < poles.length / 3; i++) {
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), poles[i * 3 + 2]);
      poleMesh.setMatrixAt(i, this.m4.compose(this.p3.set(poles[i * 3], 0, poles[i * 3 + 1]), this.q, this.s3));
    }
    poleMesh.castShadow = true;
    scene.add(poleMesh);
    const bulbGeo = new THREE.CircleGeometry(0.1, 14).translate(0, 0, 0.125);
    this.signalBulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs.length / 4);
    this.signalBulbs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((bulbs.length / 4) * 3), 3);
    for (let i = 0; i < bulbs.length / 4; i++) {
      const yaw = bulbs[i * 4 + 2];
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const y = 3.85 - bulbs[i * 4 + 3] * 0.3;
      this.signalBulbs.setMatrixAt(i, this.m4.compose(this.p3.set(bulbs[i * 4], y, bulbs[i * 4 + 1]), this.q, this.s3));
    }
    scene.add(this.signalBulbs);
  }

  private approachGroup(cluster: number, tx: number, tz: number): number {
    const c = this.clusters.get(cluster);
    if (!c) return 0;
    const a = Math.atan2(tx, tz);
    return Math.abs(Math.cos(a - c.axis)) > 0.707 ? 0 : 1;
  }

  signal(cluster: number, group: number): SignalState {
    const c = this.clusters.get(cluster);
    if (!c) return 'green';
    let t = (this.time + c.offset) % CYCLE_T;
    const half = CYCLE.green + CYCLE.amber + CYCLE.allRed;
    if (group === 1) t = (t + half) % CYCLE_T;
    if (t < CYCLE.green) return 'green';
    if (t < CYCLE.green + CYCLE.amber) return 'amber';
    return 'red';
  }

  private updateSignalVisuals(): void {
    if (!this.signalBulbs) return;
    const states = this.approaches.map((a) => this.signal(a.cluster, a.group));
    const key = states.join('');
    if (key === this.lastSignalState) return;
    this.lastSignalState = key;
    const c = this.signalBulbs.instanceColor!;
    const dim = 0.08;
    this.approaches.forEach((a, i) => {
      const st = states[i];
      const set = (k: number, r: number, g: number, b: number) => c.setXYZ(a.bulb + k, r, g, b);
      set(0, st === 'red' ? 5 : dim * 2, st === 'red' ? 0.3 : dim * 0.2, dim * 0.2);
      set(1, st === 'amber' ? 5 : dim * 2, st === 'amber' ? 2.6 : dim, 0);
      set(2, st === 'green' ? 0.2 : 0, st === 'green' ? 4.5 : dim * 1.5, st === 'green' ? 1.6 : dim * 0.6);
    });
    c.needsUpdate = true;
  }

  // ------------------------------------------------------------------ spawning
  private pickModel(): number {
    const kinds = this.models.map((m) => m.kind);
    return kinds.indexOf(this.rng.weighted(kinds, kinds.map((k) => KIND_WEIGHTS[k])));
  }

  /** @returns whether a vehicle was placed */
  private spawn(player: PlayerInfo, camX: number, camZ: number, camFx: number, camFz: number, allowVisible: boolean): boolean {
    const cand = this.graph.edgeGrid.queryRadius(player.x, player.z, 340);
    if (!cand.length) return false;
    const minD = allowVisible ? 30 : 80;
    const maxD = 300;
    for (let tries = 0; tries < (allowVisible ? 20 : 14); tries++) {
      const ei = this.rng.pick(cand);
      const e = this.world.edges[ei];
      if (e.cls === 'service') continue;
      const dirs: (1 | -1)[] = [];
      if (e.lanesF > 0) dirs.push(1);
      if (e.lanesB > 0) dirs.push(-1);
      if (!dirs.length) continue;
      const dir = this.rng.pick(dirs);
      const n = dir === 1 ? e.lanesF : e.lanesB;
      const lane = this.graph.lane(ei, dir, this.rng.int(0, n - 1));
      if (!lane || lane.length < 12) continue;
      // long edges overlap the query box even when most of the lane is kilometres away — only keep arc samples in the ring
      const spots: number[] = [];
      const step = Math.max(14, lane.length / 12);
      for (let s = 4; s < lane.length - 4; s += step) {
        const q = sampleAt(lane.pts, lane.cum, s);
        const d = Math.hypot(q.x - player.x, q.z - player.z);
        if (d < minD || d > maxD) continue;
        const vx = q.x - camX, vz = q.z - camZ;
        const vd = Math.hypot(vx, vz) || 1;
        if (!allowVisible && vd < 50 && (vx * camFx + vz * camFz) / vd > 0.6) continue;
        spots.push(s);
      }
      if (!spots.length) continue;
      const s = this.rng.pick(spots);
      const p = sampleAt(lane.pts, lane.cum, s);
      if (this.grid.queryPoints(p.x, p.z, 14, this.near).some((i) => Math.hypot(this.vehicles[i].x - p.x, this.vehicles[i].z - p.z) < 11)) continue;
      const model = this.pickModel();
      const v = new AIVehicle(model);
      v.color.setHex(this.rng.pick(this.models[model].palette));
      v.lane = lane;
      v.s = s;
      v.targetSpeedJitter = this.rng.range(0.85, 1.12);
      v.v = lane.speed * this.models[model].speedFactor * 0.8;
      this.place(v);
      this.createBody(v);
      this.vehicles.push(v);
      this.grid.insertPoint(this.vehicles.length - 1, v.x, v.z);
      return true;
    }
    return false;
  }

  /** Object pool of kinematic bodies per vehicle model (game-developer skill: never create/destroy in the loop). */
  private bodyPool = new Map<number, RAPIER.RigidBody[]>();

  private createBody(v: AIVehicle): void {
    if (!this.physics) return;
    const pool = this.bodyPool.get(v.model);
    const pooled = pool?.pop();
    if (pooled) {
      pooled.setEnabled(true);
      pooled.setTranslation({ x: v.x, y: 0.02, z: v.z }, false);
      v.body = pooled;
      this.owners.set(pooled.collider(0).handle, v);
      return;
    }
    const R = this.physics.R;
    const m = this.models[v.model];
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(v.x, 0, v.z).setCcdEnabled(true));
    // collides with the world too, which only matters once a car has been knocked loose (kinematic bodies ignore it)
    const col = R.ColliderDesc.cuboid(m.width / 2, m.height / 2 - 0.12, m.length / 2).setTranslation(0, m.height / 2 + 0.12, 0)
      .setCollisionGroups(groups(GROUP.TRAFFIC, GROUP.PLAYER | GROUP.STATIC | GROUP.TRAFFIC)).setFriction(0.5).setRestitution(0.2).setMass(TRAFFIC_MASS * m.massFactor);
    const c = this.physics.world.createCollider(col, body);
    v.body = body;
    this.owners.set(c.handle, v);
  }

  /** Switch a car to a dynamic body moving at its current speed (just before the player hits it). */
  private arm(v: AIVehicle): void {
    if (!this.physics || !v.body || v.wreck !== 0) return;
    const R = this.physics.R;
    v.body.setBodyType(R.RigidBodyType.Dynamic, true);
    v.body.setLinvel({ x: v.hx * v.v, y: 0, z: v.hz * v.v }, true);
    v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    v.body.setLinearDamping(0.05);
    v.body.setAngularDamping(0.4);
    v.wreck = 1;
    v.wreckT = 0;
  }

  private disarm(v: AIVehicle): void {
    if (!this.physics || !v.body) return;
    v.body.setBodyType(this.physics.R.RigidBodyType.KinematicPositionBased, true);
    v.wreck = 0;
    v.y = 0.02;
  }

  /** Contact between two colliders: if one is a traffic car, it becomes a wreck. @returns true if it was traffic */
  impact(handle1: number, handle2: number): boolean {
    const v = this.owners.get(handle1) ?? this.owners.get(handle2);
    if (!v || !v.body) return false;
    if (v.wreck === 0) this.arm(v);
    if (v.wreck === 1) {
      v.wreck = 2;
      v.wreckT = 0;
      v.body.setLinearDamping(0.7);
      v.body.setAngularDamping(1.4);
      if (v.reserved >= 0) this.occupancy.get(v.reserved)?.delete(v);
      v.reserved = -1;
    }
    return true;
  }

  private removeVehicle(i: number): void {
    const v = this.vehicles[i];
    if (v.body) {
      if (v.wreck) this.disarm(v);
      this.owners.delete(v.body.collider(0).handle);
      v.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false);
      v.body.setEnabled(false);
      let pool = this.bodyPool.get(v.model);
      if (!pool) this.bodyPool.set(v.model, (pool = []));
      pool.push(v.body);
      v.body = null;
    }
    if (v.reserved >= 0) this.occupancy.get(v.reserved)?.delete(v);
    // swap-remove (order doesn't matter) instead of splice
    const last = this.vehicles.pop()!;
    if (i < this.vehicles.length) this.vehicles[i] = last;
  }

  /** Pre-warm the body pool during loading so spawning never allocates physics objects mid-drive. */
  prewarm(count: number): void {
    if (!this.physics) return;
    for (let i = 0; i < count; i++) {
      const model = this.pickModel();
      const v = new AIVehicle(model);
      this.createBody(v);
      this.owners.delete(v.body!.collider(0).handle);
      v.body!.setEnabled(false);
      let pool = this.bodyPool.get(model);
      if (!pool) this.bodyPool.set(model, (pool = []));
      pool.push(v.body!);
    }
  }

  clear(): void {
    while (this.vehicles.length) this.removeVehicle(this.vehicles.length - 1);
  }

  private near: number[] = [];

  private rebuildGrid(): void {
    this.grid.clear();
    for (let i = 0; i < this.vehicles.length; i++) this.grid.insertPoint(i, this.vehicles[i].x, this.vehicles[i].z);
  }

  // ------------------------------------------------------------------ motion
  private place(v: AIVehicle): void {
    const path = v.turning ?? v.lane;
    const p = sampleAt(path.pts, path.cum, v.s);
    v.x = p.x;
    v.z = p.z;
    v.hx = p.tx;
    v.hz = p.tz;
  }

  private chooseNext(v: AIVehicle): void {
    const exits = this.graph.exits(v.lane.toNode, v.lane.edge);
    if (!exits.length) {
      v.next = null;
      return;
    }
    // prefer going straight-ish and bigger roads
    const endT = sampleAt(v.lane.pts, v.lane.cum, v.lane.length);
    const weights = exits.map((x) => {
      const e = this.world.edges[x.edge];
      const l = this.graph.lane(x.edge, x.dir, 0);
      if (!l) return 0;
      const st = sampleAt(l.pts, l.cum, 0);
      const straight = endT.tx * st.tx + endT.tz * st.tz;
      return (0.4 + ROAD_CLASSES[e.cls].rank * 0.35) * (straight > 0.7 ? 2.2 : straight > -0.3 ? 1 : 0.15);
    });
    if (weights.every((w) => w === 0)) {
      v.next = null;
      return;
    }
    const pick = this.rng.weighted(exits, weights);
    const n = pick.dir === 1 ? this.world.edges[pick.edge].lanesF : this.world.edges[pick.edge].lanesB;
    const lane = this.graph.lane(pick.edge, pick.dir, Math.min(v.lane.lane, n - 1));
    v.next = lane ? { lane } : null;
  }

  private buildTurn(from: Lane, to: Lane): Path {
    const a = sampleAt(from.pts, from.cum, from.length), b = sampleAt(to.pts, to.cum, 0);
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const k = Math.max(1, d * 0.45);
    const pts: number[] = [];
    const N = 10;
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      const x = u * u * u * a.x + 3 * u * u * t * (a.x + a.tx * k) + 3 * u * t * t * (b.x - b.tx * k) + t * t * t * b.x;
      const z = u * u * u * a.z + 3 * u * u * t * (a.z + a.tz * k) + 3 * u * t * t * (b.z - b.tz * k) + t * t * t * b.z;
      pts.push(x, z);
    }
    const cum = cumulative(pts);
    return { pts, cum, length: cum[cum.length - 1] };
  }

  /** Distance to an obstacle ahead (vehicle or player) and its speed. */
  private leader(i: number, player: PlayerInfo): { gap: number; v: number; isPlayer: boolean } {
    const me = this.vehicles[i];
    const myLen = this.models[me.model].length;
    let gap = Infinity, lv = 0, isPlayer = false;
    const look = 45;
    for (const j of this.grid.queryPoints(me.x + me.hx * look * 0.5, me.z + me.hz * look * 0.5, look * 0.6, this.near)) {
      if (j === i) continue;
      const o = this.vehicles[j];
      const rx = o.x - me.x, rz = o.z - me.z;
      const along = rx * me.hx + rz * me.hz;
      if (along <= 0 || along > look) continue;
      const lat = Math.abs(rx * me.hz - rz * me.hx);
      const width = (this.models[me.model].width + this.models[o.model].width) / 2 + 0.25;
      if (lat > width) continue;
      if (o.wreck !== 2 && o.hx * me.hx + o.hz * me.hz < 0.2) continue; // oncoming / crossing traffic handled by junction rules
      const g = along - (myLen + this.models[o.model].length) / 2;
      if (g < gap) {
        gap = g;
        lv = o.wreck === 2 ? 0 : o.v;
      }
    }
    // player car
    const rx = player.x - me.x, rz = player.z - me.z;
    const along = rx * me.hx + rz * me.hz;
    if (along > 0 && along < look) {
      const lat = Math.abs(rx * me.hz - rz * me.hx);
      if (lat < this.models[me.model].width / 2 + 1.1) {
        const g = along - (myLen + 4.45) / 2;
        if (g < gap) {
          gap = g;
          lv = Math.max(0, player.speed * (player.hx * me.hx + player.hz * me.hz));
          isPlayer = true;
        }
      }
    }
    return { gap, v: lv, isPlayer };
  }

  update(dt: number, player: PlayerInfo, camX: number, camZ: number, camFx: number, camFz: number): void {
    this.time += dt;
    this.updateSignalVisuals();
    // rebuild the spatial grid (arrays reused)
    this.rebuildGrid();
    // spawn / despawn
    this.spawnTimer -= dt;
    const filling = this.vehicles.length < this.target * 0.85;
    if (this.vehicles.length < this.target && (this.spawnTimer <= 0 || filling)) {
      const budget = filling ? 4 : 1;
      for (let n = 0; n < budget && this.vehicles.length < this.target; n++) {
        if (!this.spawn(player, camX, camZ, camFx, camFz, this.time < 2)) break;
      }
      this.spawnTimer = filling ? 0.08 : 0.4;
    }
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      v.age += dt;
      if (Math.hypot(v.x - player.x, v.z - player.z) > 420 || (v.waiting > 40 && v.age > 60) || this.vehicles.length > this.target + 10 || (v.wreck === 2 && v.wreckT > WRECK_SECONDS)) this.removeVehicle(i);
    }
    this.rebuildGrid();

    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      const m = this.models[v.model];
      // --- the player and this car: near misses, and switching to a dynamic body just before a hit
      const pdx = v.x - player.x, pdz = v.z - player.z;
      const pd = Math.hypot(pdx, pdz);
      if (pd < 40 && v.wreck !== 2) {
        const rvx = player.vx - v.hx * v.v, rvz = player.vz - v.hz * v.v;
        const closing = (rvx * pdx + rvz * pdz) / (pd || 1);
        if (v.wreck === 0 && closing > 5 && pd < 4.2 + closing * 0.17) this.arm(v);
        const along = pdx * player.hx + pdz * player.hz;
        if (v.along > 0 && along <= 0 && v.wreck === 0) {
          const lat = Math.abs(pdx * player.hz - pdz * player.hx);
          const rel = Math.hypot(rvx, rvz);
          if (lat < 3.1 && rel > 14) this.onNearMiss?.(rel);
        }
        v.along = along;
      } else v.along = 0;
      if (v.wreck) {
        v.wreckT += dt;
        const t = v.body!.translation(), r = v.body!.rotation();
        if (v.wreck === 2) {
          // free body: follow the physics
          v.x = t.x;
          v.z = t.z;
          v.y = t.y;
          v.q.set(r.x, r.y, r.z, r.w);
          v.v = 0;
          if (t.y < -3) v.wreckT = WRECK_SECONDS + 1;
          continue;
        }
        if (v.wreckT > 0.6) this.disarm(v); // the player missed: hand it back to the AI
      }
      const vmax = (v.turning ? Math.min(v.lane.speed, 7.5) : v.lane.speed) * m.speedFactor * v.targetSpeedJitter;
      let { gap, v: lv, isPlayer } = this.leader(i, player);
      // junction ahead: signals / give way
      if (!v.turning) {
        if (!v.next) this.chooseNext(v);
        const remain = v.lane.length - v.s;
        const node = this.world.nodes[v.lane.toNode];
        let mustStop = false;
        if (node.signal !== undefined) {
          const endT = sampleAt(v.lane.pts, v.lane.cum, v.lane.length);
          const st = this.signal(node.signal, this.approachGroup(node.signal, endT.tx, endT.tz));
          if (st === 'red' || (st === 'amber' && remain > (v.v * v.v) / 6 + 2)) mustStop = true;
        } else if (node.edges.length >= 3 && remain < 12) {
          const occ = this.occupancy.get(v.lane.toNode);
          if (occ && [...occ].some((o) => o !== v && o.lane.edge !== v.lane.edge)) mustStop = v.waiting < 5;
        }
        if (!v.next) mustStop = true; // dead end: stop
        if (mustStop) {
          const g = remain - 1.5;
          if (g < gap) {
            gap = g;
            lv = 0;
            isPlayer = false;
          }
        }
      }
      // IDM
      const a = 1.6, b = 2.8, s0 = 2.2, T = 1.25;
      const sStar = s0 + Math.max(0, v.v * T + (v.v * (v.v - lv)) / (2 * Math.sqrt(a * b)));
      let acc = a * (1 - Math.pow(v.v / Math.max(0.5, vmax), 4)) - (gap < Infinity ? a * Math.pow(sStar / Math.max(0.3, gap), 2) : 0);
      acc = Math.max(-9, acc);
      v.v = Math.max(0, v.v + acc * dt);
      if (gap < 0.3) v.v = 0;
      v.waiting = v.v < 0.3 ? v.waiting + dt : 0;
      // horn when the player blocks the way
      v.honkCd -= dt;
      if (isPlayer && v.v < 0.5 && gap < 6) {
        v.blocked += dt;
        if (v.blocked > 3 && v.honkCd <= 0) {
          this.onHonk?.(v.x, v.z, m.kind);
          v.honkCd = this.rng.range(2.5, 6);
        }
      } else v.blocked = 0;
      // advance along lane / turn
      v.s += v.v * dt;
      if (v.turning) {
        if (v.s >= v.turning.length) {
          v.s -= v.turning.length;
          v.turning = null;
          if (v.reserved >= 0) this.occupancy.get(v.reserved)?.delete(v);
          v.reserved = -1;
          v.lane = v.next!.lane;
          v.next = null;
        }
      } else if (v.s >= v.lane.length) {
        if (v.next) {
          v.s -= v.lane.length;
          v.turning = this.buildTurn(v.lane, v.next.lane);
          const node = v.lane.toNode;
          if (!this.occupancy.has(node)) this.occupancy.set(node, new Set());
          this.occupancy.get(node)!.add(v);
          v.reserved = node;
        } else v.s = v.lane.length;
      }
      this.place(v);
    }
  }

  /** Push instance matrices + kinematic bodies. */
  sync(night: number): void {
    const counts = this.meshes.map(() => 0);
    const up = new THREE.Vector3(0, 1, 0);
    for (const v of this.vehicles) {
      const k = v.model;
      const idx = counts[k]++;
      if (v.wreck === 2) this.m4.compose(this.p3.set(v.x, v.y, v.z), v.q, this.s3);
      else {
        const yaw = Math.atan2(v.hx, v.hz);
        this.q.setFromAxisAngle(up, yaw);
        this.m4.compose(this.p3.set(v.x, 0.02, v.z), this.q, this.s3);
      }
      const ms = this.meshes[k];
      ms.paint.setMatrixAt(idx, this.m4);
      ms.fixed.setMatrixAt(idx, this.m4);
      ms.lights.setMatrixAt(idx, this.m4);
      ms.paint.setColorAt(idx, v.color);
      if (v.body && v.wreck === 0) {
        v.body.setNextKinematicTranslation({ x: v.x, y: 0.02, z: v.z });
        v.body.setNextKinematicRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
      }
    }
    this.meshes.forEach((ms, k) => {
      for (const im of [ms.paint, ms.fixed, ms.lights]) {
        im.count = counts[k];
        im.instanceMatrix.needsUpdate = true;
      }
      if (ms.paint.instanceColor) ms.paint.instanceColor.needsUpdate = true;
    });
    this.lightMat.color.setScalar(0.55 + night * 3.2);
  }

  get count(): number {
    return this.vehicles.length;
  }

  /** Nearest few vehicles to a point (for positional engine hum). */
  nearest(x: number, z: number, n: number): { x: number; z: number; v: number; kind: string }[] {
    return this.vehicles
      .map((v) => ({ x: v.x, z: v.z, v: v.v, kind: this.models[v.model].kind, d: Math.hypot(v.x - x, v.z - z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n);
  }

  private posOut: { x: number; z: number; hx: number; hz: number }[] = [];
  /** For the minimap (reused array: no per-frame garbage). */
  positions(): { x: number; z: number; hx: number; hz: number }[] {
    const out = this.posOut;
    while (out.length < this.vehicles.length) out.push({ x: 0, z: 0, hx: 0, hz: 1 });
    out.length = this.vehicles.length;
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i], o = out[i];
      o.x = v.x;
      o.z = v.z;
      o.hx = v.hx;
      o.hz = v.hz;
    }
    return out;
  }
}

function mergeSimple(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [];
  for (const g0 of gs) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
