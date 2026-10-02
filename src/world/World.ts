// The game world: builds static geometry in streamed chunks from the compiled OSM world data, instanced props,
// night lighting helpers and streamed static physics colliders.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { WorldData, Building } from '../data/types';
import { TREE_STRIDE, LAMP_STRIDE, POLE_STRIDE, BILLBOARD_STRIDE } from '../data/types';
import { SpatialGrid, centroid, distPointSeg, projectPointSeg } from '../core/geom2d';
import { isMajor } from '../data/roadClasses';
import { WorldAtlas } from './atlas';
import { MeshBuilder, type V3 } from './meshBuilder';
import { createAtlasMaterial, createAsphaltMaterial, createMarkingMaterial, createWaterMaterial, createWireMaterial } from './materials';
import { Signage } from './signage';
import { prepareStrokes, emitAsphalt, emitMarkings, emitCurbs, type StrokePrep } from './roadGeom';
import { layoutPlots, type PlotLayout } from './plots';
import { emitOsmBuilding, emitPlot, emitBillboard, normalize, type BuildCtx } from './buildingGeom';
import { PropField } from './PropField';
import { buildTreeModels, makeLeafAtlas, buildLampModels, buildPoleModels, buildTankModel, buildSolarModel, buildLanternModel, makePoolTexture, type TreeModel } from './propModels';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Profiler } from '../core/Profiler';

export const CHUNK = 320;

interface ChunkColliderData {
  tri: Float32Array;
  boxes: number[];
  cylinders: number[];
}

class Chunk {
  group: THREE.Group | null = null;
  colliders: RAPIER.Collider[] | null = null;
  colData: ChunkColliderData | null = null;
  constructor(public ix: number, public iz: number) {}
  get minX() { return this.ix * CHUNK; }
  get minZ() { return this.iz * CHUNK; }
  get cx() { return (this.ix + 0.5) * CHUNK; }
  get cz() { return (this.iz + 0.5) * CHUNK; }
}

export interface WorldQuality {
  drawDistance: number;
  propNear: number;
  propFar: number;
  shadows: boolean;
  shadowRange: number;
}

export class World {
  readonly scene = new THREE.Group();
  readonly atlas = new WorldAtlas();
  readonly signage = new Signage();
  readonly atlasMat: THREE.MeshStandardMaterial;
  readonly asphaltMat: THREE.MeshStandardMaterial;
  readonly markMat: THREE.MeshStandardMaterial;
  readonly signMat: THREE.MeshStandardMaterial;
  readonly adMat: THREE.MeshStandardMaterial;
  readonly waterMat: THREE.MeshStandardMaterial;
  readonly wireMat: THREE.LineBasicMaterial;
  readonly lampLensMat: THREE.MeshStandardMaterial;
  readonly propMat: THREE.MeshStandardMaterial;
  readonly treeMat: THREE.MeshStandardMaterial;
  readonly poolMat: THREE.MeshBasicMaterial;
  private readonly treeUniforms = { uTime: { value: 0 } };

  readonly preps: StrokePrep[];
  readonly plots: PlotLayout[];
  /** spatial index of road edge segments: {edge, i} */
  readonly roadGrid = new SpatialGrid<{ edge: number; i: number }>(50);
  readonly shopGrid = new SpatialGrid<number>(60);
  /** world positions of every street light head (x,y,z) for night light pools / point lights */
  readonly lampHeads: number[] = [];
  readonly fields: PropField[] = [];
  treeField: PropField[] = [];
  private treeModels: TreeModel[];
  private lampHeadsLocal: THREE.Vector3[][] = [];

  private chunks = new Map<number, Chunk>();
  private strokeChunks = new Map<number, number[]>(); // chunk key → stroke indices
  private medianChunks = new Map<number, number[]>();
  private buildingChunks = new Map<number, number[]>();
  private plotChunks = new Map<number, number[]>();
  private billboardChunks = new Map<number, number[]>();
  private spanChunks = new Map<number, number[]>(); // pole index (span start)
  quality: WorldQuality = { drawDistance: 800, propNear: 140, propFar: 500, shadows: true, shadowRange: 55 };
  private get shadowRadius(): number {
    return this.quality.shadowRange + 20;
  }
  /** every lit material the world uses (registered with the shadow cascades at start-up) */
  get litMaterials(): THREE.Material[] {
    return [this.atlasMat, this.asphaltMat, this.markMat, this.signMat, this.adMat, this.waterMat, this.lampLensMat, this.propMat, this.treeMat];
  }
  private nightFactor = 0;
  stats = { chunksBuilt: 0, chunksVisible: 0, colliders: 0, lastBuildMs: 0 };

  constructor(readonly data: WorldData, private physics: PhysicsWorld | null) {
    const t0 = performance.now();
    this.atlas.build();
    this.signage.build(data.shops.map((s) => s.name));
    this.atlasMat = createAtlasMaterial(this.atlas);
    this.asphaltMat = createAsphaltMaterial();
    this.markMat = createMarkingMaterial();
    this.signMat = new THREE.MeshStandardMaterial({ map: this.signage.signTexture, emissiveMap: this.signage.signTexture, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.5 });
    this.adMat = new THREE.MeshStandardMaterial({ map: this.signage.adTexture, emissiveMap: this.signage.adTexture, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.45 });
    // digital billboards: each face cycles through the 16 campaigns with a cross-fade, drawn as an LED panel
    // (dot grid that fades out with distance, slow scan roll, a little shimmer) and emissive even in daylight
    this.adMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.treeUniforms.uTime;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
          uniform float uTime;
          vec3 adSample(float idx, vec2 loc, vec2 dx, vec2 dy) {
            idx = mod(idx, 16.0);
            vec2 cell = vec2(mod(idx, 4.0), 3.0 - floor(idx / 4.0));
            return textureGrad(map, (cell + clamp(loc, 0.004, 0.996)) / 4.0, dx, dy).rgb;
          }
          vec3 adColor;`)
        .replace('#include <map_fragment>', `
          vec2 aUv4 = vMapUv * 4.0;
          vec2 aCell = floor(aUv4);
          float aIdx = (3.0 - aCell.y) * 4.0 + aCell.x;
          vec2 aLoc = fract(aUv4);
          vec2 aDx = dFdx(vMapUv), aDy = dFdy(vMapUv);
          float aT = uTime / 9.0 + aIdx * 0.37;
          float aMix = smoothstep(0.86, 1.0, fract(aT));
          vec3 aCur = adSample(aIdx + floor(aT), aLoc, aDx, aDy);
          adColor = aMix > 0.001 ? mix(aCur, adSample(aIdx + floor(aT) + 1.0, aLoc, aDx, aDy), aMix) : aCur;
          vec2 aPx = aLoc * vec2(170.0, 85.0);
          float aFade = 1.0 - clamp(max(fwidth(aPx.x), fwidth(aPx.y)) * 1.4, 0.0, 1.0);
          vec2 aG = abs(fract(aPx) - 0.5) * 2.0;
          adColor *= 1.0 - aFade * 0.32 * smoothstep(0.55, 1.0, max(aG.x, aG.y));
          adColor *= 0.95 + 0.05 * sin(aLoc.y * 120.0 - uTime * 6.0) + 0.02 * sin(uTime * 37.0 + aIdx);
          diffuseColor.rgb *= adColor;`)
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= adColor;');
    };
    this.adMat.customProgramCacheKey = () => 'led-billboard-v1';
    this.waterMat = createWaterMaterial();
    this.wireMat = createWireMaterial();
    this.lampLensMat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.3 });
    this.propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 });
    this.treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, map: makeLeafAtlas(), alphaTest: 0.42, side: THREE.DoubleSide });
    this.treeMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.treeUniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           #ifdef USE_INSTANCING
             float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
             float bend = max(0.0, position.y - 2.0) * 0.018;
             transformed.x += sin(uTime * 1.3 + ph) * bend;
             transformed.z += cos(uTime * 1.1 + ph * 1.3) * bend * 0.7;
           #endif`,
        );
    };
    this.treeMat.customProgramCacheKey = () => 'tree-sway';
    this.poolMat = new THREE.MeshBasicMaterial({ map: makePoolTexture(), color: 0xffcf8a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });

    this.preps = prepareStrokes(data);
    this.plots = layoutPlots(data);
    this.treeModels = buildTreeModels();
    this.indexData();
    this.buildGlobalMeshes();
    this.buildPropFields();
    console.info(`[world] prepared in ${(performance.now() - t0).toFixed(0)} ms: ${this.plots.length} plots, ${data.buildings.length} OSM buildings, ${this.fields.length} prop fields`);
  }

  private key(ix: number, iz: number) {
    return (ix + 512) * 1024 + (iz + 512);
  }
  private chunkKeyAt(x: number, z: number) {
    return this.key(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
  }
  private push(map: Map<number, number[]>, k: number, v: number) {
    let a = map.get(k);
    if (!a) map.set(k, (a = []));
    if (a[a.length - 1] !== v) a.push(v);
  }

  private indexData(): void {
    const d = this.data;
    d.edges.forEach((e) => {
      for (let i = 0; i + 3 < e.pts.length; i += 2) {
        const ax = e.pts[i], az = e.pts[i + 1], bx = e.pts[i + 2], bz = e.pts[i + 3];
        this.roadGrid.insert({ edge: e.id, i }, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
      }
    });
    this.preps.forEach((p, si) => {
      const pts = p.st.pts;
      const seen = new Set<number>();
      for (let i = 0; i + 3 < pts.length; i += 2) seen.add(this.chunkKeyAt((pts[i] + pts[i + 2]) / 2, (pts[i + 1] + pts[i + 3]) / 2));
      for (const sd of p.sides) for (let i = 0; i + 3 < sd.inner.length; i += 2) seen.add(this.chunkKeyAt((sd.inner[i] + sd.inner[i + 2]) / 2, (sd.inner[i + 1] + sd.inner[i + 3]) / 2));
      if (p.median) for (let i = 0; i + 3 < p.median.l.length; i += 2) seen.add(this.chunkKeyAt(p.median.l[i], p.median.l[i + 1]));
      for (const k of seen) this.push(this.strokeChunks, k, si);
    });
    d.medians.forEach((m, mi) => {
      const seen = new Set<number>();
      for (let i = 0; i < m.l.length; i += 2) seen.add(this.chunkKeyAt(m.l[i], m.l[i + 1]));
      for (const k of seen) this.push(this.medianChunks, k, mi);
    });
    d.buildings.forEach((b, bi) => {
      const [cx, cz] = centroid(b.pts);
      this.push(this.buildingChunks, this.chunkKeyAt(cx, cz), bi);
    });
    this.plots.forEach((p, pi) => this.push(this.plotChunks, this.chunkKeyAt(p.x, p.z), pi));
    for (let i = 0; i < d.billboards.length; i += BILLBOARD_STRIDE) this.push(this.billboardChunks, this.chunkKeyAt(d.billboards[i], d.billboards[i + 1]), i);
    for (let i = 0; i + POLE_STRIDE < d.poles.length; i += POLE_STRIDE) {
      if (d.poles[i + 3] !== d.poles[i + POLE_STRIDE + 3]) continue; // different chain
      this.push(this.spanChunks, this.chunkKeyAt(d.poles[i], d.poles[i + 1]), i);
    }
    d.shops.forEach((s, i) => this.shopGrid.insertPoint(i, s.x, s.z));
    const { minX, maxX, minZ, maxZ } = d.extent;
    for (let ix = Math.floor(minX / CHUNK); ix <= Math.floor(maxX / CHUNK); ix++)
      for (let iz = Math.floor(minZ / CHUNK); iz <= Math.floor(maxZ / CHUNK); iz++) this.chunks.set(this.key(ix, iz), new Chunk(ix, iz));
  }

  /** Areas, water, rail and the ground: small enough to be one always-visible group. */
  private buildGlobalMeshes(): void {
    const d = this.data;
    const b = new MeshBuilder();
    const cellFor: Record<string, string> = { park: 'grass_lawn', grass: 'grass', golf: 'grass_lawn', pitch: 'grass', cemetery: 'grass_dry', parking: 'concrete', campus: 'grass_dry', plaza: 'pavers', water: 'grass' };
    for (const a of d.areas) {
      if (a.kind === 'water') continue;
      const y = a.kind === 'parking' || a.kind === 'plaza' ? 0.026 : 0.018;
      b.polygon(normalize(a.pts), y, this.atlas.cell(cellFor[a.kind]), true);
    }
    // ground plane (dry grass/dirt) covering the playable area and beyond
    const g = this.atlas.cell('grass_dry');
    const E = 6000;
    b.quad([-E, 0, -E], [E, 0, -E], [E, 0, E], [-E, 0, E], [[-E / g.sx, -E / g.sy], [E / g.sx, -E / g.sy], [E / g.sx, E / g.sy], [-E / g.sx, E / g.sy]], g, [0, 1, 0]);
    // rail: ballast + rails
    const ballast = this.atlas.cell('ballast');
    const rail = this.atlas.cell('metal_dark');
    for (const r of d.rail) {
      let u = 0;
      for (let i = 0; i + 3 < r.length; i += 2) {
        const ax = r[i], az = r[i + 1], bx = r[i + 2], bz = r[i + 3];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (bz - az) / L, nz = -(bx - ax) / L;
        const w = 1.7;
        b.quad([ax + nx * w, 0.06, az + nz * w], [ax - nx * w, 0.06, az - nz * w], [bx - nx * w, 0.06, bz - nz * w], [bx + nx * w, 0.06, bz + nz * w], [[0, u / ballast.sy], [1, u / ballast.sy], [1, (u + L) / ballast.sy], [0, (u + L) / ballast.sy]], ballast, [0, 1, 0]);
        for (const o of [-0.72, 0.72]) b.segmentBox(ax + nx * o, az + nz * o, bx + nx * o, bz + nz * o, 0.07, 0.06, 0.2, rail);
        u += L;
      }
    }
    const geo = b.build();
    if (geo) {
      const m = new THREE.Mesh(geo, this.atlasMat);
      m.receiveShadow = true;
      m.name = 'areas+ground';
      this.scene.add(m);
    }
    // water: canal / drains + natural=water polygons
    const w = new MeshBuilder();
    const wc = this.atlas.cell('concrete');
    const bank = new MeshBuilder();
    for (const wl of d.water) {
      const hw = wl.width / 2;
      for (let i = 0; i + 3 < wl.pts.length; i += 2) {
        const ax = wl.pts[i], az = wl.pts[i + 1], bx = wl.pts[i + 2], bz = wl.pts[i + 3];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (bz - az) / L, nz = -(bx - ax) / L;
        const uv = (x: number, z: number): [number, number] => [x / 12, z / 12];
        const pts: V3[] = [[ax + nx * hw, 0.035, az + nz * hw], [ax - nx * hw, 0.035, az - nz * hw], [bx - nx * hw, 0.035, bz - nz * hw], [bx + nx * hw, 0.035, bz + nz * hw]];
        w.quad(pts[0], pts[1], pts[2], pts[3], pts.map((p) => uv(p[0], p[2])), wc, [0, 1, 0]);
        // concrete banks
        for (const sgn of [1, -1]) {
          const o0 = hw * sgn, o1 = (hw + 1.2) * sgn;
          bank.quad([ax + nx * o0, 0.04, az + nz * o0], [bx + nx * o0, 0.04, bz + nz * o0], [bx + nx * o1, 0.04, bz + nz * o1], [ax + nx * o1, 0.04, az + nz * o1], [[0, 0], [L / 3, 0], [L / 3, 0.4], [0, 0.4]], wc, [0, 1, 0]);
        }
      }
    }
    for (const a of d.areas) if (a.kind === 'water') w.polygon(normalize(a.pts), 0.035, wc, true, false);
    const wg = w.build();
    if (wg) {
      const wm = new THREE.Mesh(wg, this.waterMat);
      wm.receiveShadow = true;
      wm.name = 'water';
      this.scene.add(wm);
    }
    const bg = bank.build();
    if (bg) this.scene.add(new THREE.Mesh(bg, this.atlasMat));
  }

  private buildPropFields(): void {
    const d = this.data;
    const q = this.quality;
    // trees: OSM/placed + plot trees
    const perType: number[][] = [[], [], [], []];
    for (let i = 0; i < d.trees.length; i += TREE_STRIDE) perType[d.trees[i + 2]]?.push(d.trees[i], 0, d.trees[i + 1], (d.trees[i + 4] * Math.PI) / 180, d.trees[i + 3] / 100);
    for (const p of this.plots) for (const t of p.trees) perType[t.type].push(t.x, 0, t.z, t.x * 1.7, t.scale);
    this.treeField = perType.map((inst, ti) => {
      const f = new PropField(inst, { near: this.treeModels[ti].near, far: this.treeModels[ti].far, material: this.treeMat, nearRadius: q.propNear, farRadius: q.propFar, castShadow: true, shadowRadius: this.shadowRadius, maxNear: 2500, maxFar: 9000 });
      this.scene.add(f.group);
      this.fields.push(f);
      return f;
    });

    // street lights
    const lampModels = buildLampModels();
    this.lampHeadsLocal = lampModels.heads;
    const lampInst: number[][] = [[], [], [], []];
    for (let i = 0; i < d.lamps.length; i += LAMP_STRIDE) {
      const x = d.lamps[i], z = d.lamps[i + 1], yaw = d.lamps[i + 2] / 100, type = d.lamps[i + 3];
      lampInst[type].push(x, 0, z, yaw, 1);
      for (const h of this.lampHeadsLocal[type]) {
        const c = Math.cos(yaw), s = Math.sin(yaw);
        this.lampHeads.push(x + h.x * c + h.z * s, h.y, z - h.x * s + h.z * c);
      }
    }
    for (const t of [0, 1, 3]) {
      if (!lampInst[t].length) continue;
      const f = new PropField(lampInst[t], { near: lampModels.geo[t], material: [this.propMat, this.lampLensMat], nearRadius: q.propFar * 0.8, farRadius: q.propFar * 0.8, castShadow: true, shadowRadius: this.shadowRadius, maxNear: 3000 });
      this.scene.add(f.group);
      this.fields.push(f);
    }

    // electricity poles (+ lamp arms, transformers)
    const pm = buildPoleModels();
    const base: number[] = [], lamp: number[] = [], trans: number[] = [];
    for (let i = 0; i < d.poles.length; i += POLE_STRIDE) {
      const x = d.poles[i], z = d.poles[i + 1], yaw = d.poles[i + 2] / 100;
      base.push(x, 0, z, yaw, 1);
      if (d.poles[i + 4]) {
        lamp.push(x, 0, z, yaw, 1);
        const c = Math.cos(yaw), s = Math.sin(yaw);
        this.lampHeads.push(x + pm.lampHead.z * s, pm.lampHead.y, z + pm.lampHead.z * c);
      }
      if (d.poles[i + 5]) trans.push(x, 0, z, yaw, 1);
    }
    this.poleWireAttach = pm.wireAttach;
    for (const [inst, geo, mat] of [[base, pm.base, this.propMat], [lamp, pm.lamp, [this.propMat, this.lampLensMat]], [trans, pm.transformer, this.propMat]] as const) {
      if (!inst.length) continue;
      const f = new PropField(inst, { near: geo, material: mat as THREE.Material | THREE.Material[], nearRadius: q.propFar * 0.7, farRadius: q.propFar * 0.7, castShadow: true, shadowRadius: this.shadowRadius, maxNear: 3000 });
      this.scene.add(f.group);
      this.fields.push(f);
    }
    // roof tanks, solar, lanterns come from building/plot meshing (static data) → gather now without meshing
    const tanks: number[] = [], solar: number[] = [], lanterns: number[] = [];
    for (const p of this.plots) {
      for (const t of p.tanks) tanks.push(t.x, t.y, t.z, (t.x * 13) % 6.28, t.s);
      for (const s of p.solar) solar.push(s.x, s.y, s.z, s.yaw, 1);
      for (const pl of p.pillars) lanterns.push(pl.x, p.wallH + 0.45, pl.z, p.angle, 1);
    }
    this.roofTankField = new PropField(tanks, { near: buildTankModel(), material: this.propMat, nearRadius: q.propNear * 1.6, farRadius: q.propNear * 1.6, castShadow: false, maxNear: 6000 });
    this.solarField = new PropField(solar, { near: buildSolarModel(), material: this.propMat, nearRadius: q.propNear * 1.6, farRadius: q.propNear * 1.6, maxNear: 2000 });
    this.lanternField = new PropField(lanterns, { near: buildLanternModel(), material: [this.propMat, this.lampLensMat], nearRadius: q.propNear * 1.4, farRadius: q.propNear * 1.4, maxNear: 4000 });
    for (const f of [this.roofTankField, this.solarField, this.lanternField]) {
      this.scene.add(f.group);
      this.fields.push(f);
    }
    // night light pools under lamps
    const pools: number[] = [];
    for (let i = 0; i < this.lampHeads.length; i += 3) pools.push(this.lampHeads[i], 0.08, this.lampHeads[i + 2], 0, this.lampHeads[i + 1] > 12 ? 16 : 7.5);
    const poolGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.poolField = new PropField(pools, { near: poolGeo, material: this.poolMat, nearRadius: 260, farRadius: 260, maxNear: 5000 });
    this.poolField.nearMesh.renderOrder = 2;
    this.scene.add(this.poolField.group);
    this.fields.push(this.poolField);
  }
  private poleWireAttach: THREE.Vector3[] = [];
  roofTankField!: PropField;
  solarField!: PropField;
  lanternField!: PropField;
  poolField!: PropField;

  setQuality(q: WorldQuality): void {
    this.quality = q;
    for (const f of this.treeField) f.setRadii(q.propNear, q.propFar, this.shadowRadius);
    for (const f of this.fields) {
      if (this.treeField.includes(f) || f === this.poolField) continue;
      if (f === this.roofTankField || f === this.solarField || f === this.lanternField) f.setRadii(q.propNear * 1.6, q.propNear * 1.6);
      else f.setRadii(q.propFar * 0.75, q.propFar * 0.75, this.shadowRadius);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // chunk building

  private buildChunk(ch: Chunk): void {
    const t0 = performance.now();
    const d = this.data;
    const k = this.key(ch.ix, ch.iz);
    const minX = ch.minX, minZ = ch.minZ, maxX = minX + CHUNK, maxZ = minZ + CHUNK;
    const inChunk = (x: number, z: number) => x >= minX && x < maxX && z >= minZ && z < maxZ;
    const asphalt = new MeshBuilder();
    const marks = new MeshBuilder();
    const atlasB = new MeshBuilder();
    atlasB.collide = [];
    const signs = new MeshBuilder();
    const ads = new MeshBuilder();
    const ctx: BuildCtx = { atlas: this.atlas, signage: this.signage, b: atlasB, signs, ads, col: { boxes: [], cylinders: [] }, tanks: [], solar: [], lanterns: [] };

    const strokes = (this.strokeChunks.get(k) ?? []).map((i) => this.preps[i]);
    emitAsphalt(asphalt, strokes, d, inChunk, this.atlas);
    emitMarkings(marks, strokes, d, inChunk, this.atlas);
    const meds = (this.medianChunks.get(k) ?? []).map((i) => d.medians[i]);
    emitCurbs(atlasB, strokes, meds, d.islands, inChunk, this.atlas);

    for (const bi of this.buildingChunks.get(k) ?? []) {
      const bld = d.buildings[bi];
      const { name, facing } = this.buildingContext(bld);
      emitOsmBuilding(ctx, bld, name, facing);
    }
    for (const pi of this.plotChunks.get(k) ?? []) {
      const p = this.plots[pi];
      emitPlot(ctx, p, p.commercial ? this.nearestShopName(p.x, p.z, 30) : undefined);
    }
    for (const bi of this.billboardChunks.get(k) ?? []) emitBillboard(ctx, d.billboards[bi], d.billboards[bi + 1], d.billboards[bi + 2] / 100, d.billboards[bi + 3]);

    const group = new THREE.Group();
    group.name = `chunk ${ch.ix},${ch.iz}`;
    const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material, cast: boolean, order = 0) => {
      if (!geo) return;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      m.renderOrder = order;
      group.add(m);
    };
    add(asphalt.build(), this.asphaltMat, false, 0);
    add(marks.build(), this.markMat, false, 1);
    for (const g of atlasB.buildQuadrants(ch.cx, ch.cz)) add(g, this.atlasMat, true);
    add(signs.build(), this.signMat, false);
    add(ads.build(), this.adMat, false);

    // electricity wires (catenary spans between consecutive poles of a chain)
    const wires: number[] = [];
    for (const i of this.spanChunks.get(k) ?? []) this.emitSpan(wires, i);
    if (wires.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
      const ls = new THREE.LineSegments(g, this.wireMat);
      group.add(ls);
    }

    // collider data: trimesh soup from atlas geometry flagged `collide`, boxes, cylinders (+ prop trunks)
    const cyl = ctx.col.cylinders;
    const tmp: number[] = [];
    for (const f of this.treeField) {
      tmp.length = 0;
      f.queryRadius(ch.cx, ch.cz, CHUNK * 0.75, tmp);
      for (const idx of tmp) {
        const [x, , z, , s] = f.instance(idx);
        if (!inChunk(x, z)) continue;
        const ti = this.treeField.indexOf(f);
        cyl.push(x, z, this.treeModels[ti].trunkR * s, 3);
      }
    }
    for (let i = 0; i < d.lamps.length; i += LAMP_STRIDE) if (inChunk(d.lamps[i], d.lamps[i + 1])) cyl.push(d.lamps[i], d.lamps[i + 1], d.lamps[i + 3] === 3 ? 0.4 : 0.16, 9);
    for (let i = 0; i < d.poles.length; i += POLE_STRIDE) if (inChunk(d.poles[i], d.poles[i + 1])) cyl.push(d.poles[i], d.poles[i + 1], 0.2, 9);
    ch.colData = { tri: new Float32Array(atlasB.collide), boxes: ctx.col.boxes, cylinders: cyl };

    ch.group = group;
    this.scene.add(group);
    this.stats.chunksBuilt++;
    this.stats.lastBuildMs = performance.now() - t0;
  }

  private emitSpan(out: number[], i: number): void {
    const d = this.data;
    const j = i + POLE_STRIDE;
    const ax = d.poles[i], az = d.poles[i + 1], ay = d.poles[i + 2] / 100;
    const bx = d.poles[j], bz = d.poles[j + 1], by = d.poles[j + 2] / 100;
    const L = Math.hypot(bx - ax, bz - az);
    if (L > 60 || L < 5) return;
    const ca = Math.cos(ay), sa = Math.sin(ay), cb = Math.cos(by), sb = Math.sin(by);
    const seg = 8;
    this.poleWireAttach.forEach((w, wi) => {
      const p0x = ax + w.x * ca + w.z * sa, p0z = az - w.x * sa + w.z * ca;
      // match attachment by lateral offset sign relative to span direction so wires don't cross
      const q0x = bx + w.x * cb + w.z * sb, q0z = bz - w.x * sb + w.z * cb;
      const q1x = bx - w.x * cb + w.z * sb, q1z = bz + w.x * sb + w.z * cb;
      const useQ1 = Math.hypot(q1x - p0x, q1z - p0z) < Math.hypot(q0x - p0x, q0z - p0z);
      const qx = useQ1 ? q1x : q0x, qz = useQ1 ? q1z : q0z;
      const sag = (wi === 6 ? 0.9 : 0.45) + L * 0.008;
      let px = p0x, py = w.y, pz = p0z;
      for (let s = 1; s <= seg; s++) {
        const t = s / seg;
        const x = p0x + (qx - p0x) * t, z = p0z + (qz - p0z) * t;
        const y = w.y - sag * 4 * t * (1 - t);
        out.push(px, py, pz, x, y, z);
        px = x;
        py = y;
        pz = z;
      }
    });
  }

  private buildingContext(b: Building): { name?: string; facing: { nx: number; nz: number } | null } {
    if (b.kind !== 'commercial') return { facing: null };
    const [cx, cz] = centroid(b.pts);
    let best: { d: number; x: number; z: number } | null = null;
    for (const c of this.roadGrid.queryRadius(cx, cz, 60)) {
      const e = this.data.edges[c.edge];
      if (!isMajor(e.cls) && e.cls !== 'residential') continue;
      const pr = projectPointSeg(cx, cz, e.pts[c.i], e.pts[c.i + 1], e.pts[c.i + 2], e.pts[c.i + 3]);
      const w = isMajor(e.cls) ? 0 : 15; // prefer major roads
      if (!best || pr.d + w < best.d) best = { d: pr.d + w, x: pr.x, z: pr.z };
    }
    const name = b.name ?? this.nearestShopName(cx, cz, 40);
    if (!best) return { name, facing: null };
    const dx = best.x - cx, dz = best.z - cz;
    const L = Math.hypot(dx, dz) || 1;
    return { name, facing: { nx: dx / L, nz: dz / L } };
  }

  private nearestShopName(x: number, z: number, r: number): string | undefined {
    let best: string | undefined, bd = r;
    for (const i of this.shopGrid.queryRadius(x, z, r)) {
      const s = this.data.shops[i];
      const dd = Math.hypot(s.x - x, s.z - z);
      if (dd < bd) {
        bd = dd;
        best = s.name;
      }
    }
    return best;
  }

  private disposeChunk(ch: Chunk): void {
    if (!ch.group) return;
    ch.group.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
    this.scene.remove(ch.group);
    ch.group = null;
  }

  /** Stream chunks + props around the camera; stream colliders around the car. */
  update(camX: number, camZ: number, carX: number, carZ: number, dt: number, budgetMs = 6, P?: Profiler): void {
    P?.begin('world.chunks');
    this.treeUniforms.uTime.value += dt;
    const dd = this.quality.drawDistance + CHUNK * 0.71;
    let visible = 0;
    const want: Chunk[] = [];
    for (const ch of this.chunks.values()) {
      const dist = Math.hypot(ch.cx - camX, ch.cz - camZ);
      if (dist < dd) {
        if (ch.group) {
          ch.group.visible = true;
          visible++;
        } else want.push(ch);
      } else if (ch.group) {
        ch.group.visible = false;
        if (dist > dd * 1.8) this.disposeChunk(ch);
      }
    }
    this.stats.chunksVisible = visible;
    want.sort((a, b) => Math.hypot(a.cx - camX, a.cz - camZ) - Math.hypot(b.cx - camX, b.cz - camZ));
    const t0 = performance.now();
    for (const ch of want) {
      if (performance.now() - t0 > budgetMs && ch !== want[0]) break;
      this.buildChunk(ch);
    }
    P?.end();
    P?.begin('world.props');
    for (const f of this.fields) f.update(camX, camZ);
    P?.end();
    P?.begin('world.colliders');
    this.updateColliders(carX, carZ);
    P?.end();
  }

  /** Build everything near a point synchronously (loading screen). */
  prebuild(x: number, z: number, radius: number): void {
    for (const ch of this.chunks.values()) if (!ch.group && Math.hypot(ch.cx - x, ch.cz - z) < radius) this.buildChunk(ch);
    for (const f of this.fields) f.update(x, z, true);
    this.updateColliders(x, z);
  }

  private updateColliders(x: number, z: number): void {
    if (!this.physics) return;
    for (const ch of this.chunks.values()) {
      const dist = Math.max(Math.abs(ch.cx - x), Math.abs(ch.cz - z)) - CHUNK / 2;
      if (dist < 220) {
        if (!ch.colliders) {
          if (!ch.colData) this.buildChunk(ch);
          this.createColliders(ch);
        }
      } else if (ch.colliders && dist > 380) {
        for (const c of ch.colliders) this.physics.remove(c);
        this.stats.colliders -= ch.colliders.length;
        ch.colliders = null;
      }
    }
  }

  private createColliders(ch: Chunk): void {
    const p = this.physics!;
    const cd = ch.colData!;
    const list: RAPIER.Collider[] = [];
    if (cd.tri.length >= 9) {
      const idx = new Uint32Array(cd.tri.length / 3);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      list.push(p.addTrimesh(cd.tri, idx));
    }
    for (let i = 0; i < cd.boxes.length; i += 7) list.push(p.addBox(cd.boxes[i], cd.boxes[i + 1], cd.boxes[i + 2], cd.boxes[i + 3], cd.boxes[i + 4], cd.boxes[i + 5], cd.boxes[i + 6]));
    for (let i = 0; i < cd.cylinders.length; i += 4) list.push(p.addCylinder(cd.cylinders[i], cd.cylinders[i + 1], cd.cylinders[i + 2], cd.cylinders[i + 3]));
    ch.colliders = list;
    this.stats.colliders += list.length;
  }

  /** 0 = day … 1 = full night: drives window/sign/lamp emissives and light pools. */
  setNight(f: number): void {
    this.nightFactor = f;
    this.atlasMat.emissiveIntensity = f * 1.6;
    this.signMat.emissiveIntensity = f * 1.4;
    this.adMat.emissiveIntensity = 0.45 + f * 1.5;
    this.lampLensMat.emissiveIntensity = f * 9;
    this.poolMat.opacity = f * 0.55;
    this.poolField.group.visible = f > 0.02;
  }
  get night(): number {
    return this.nightFactor;
  }

  /** Nearest point on any drivable road (for resets / spawning). */
  nearestRoad(x: number, z: number, radius = 120): { x: number; z: number; tx: number; tz: number; edge: number; d: number } | null {
    let best: { x: number; z: number; tx: number; tz: number; edge: number; d: number } | null = null;
    for (const c of this.roadGrid.queryRadius(x, z, radius)) {
      const e = this.data.edges[c.edge];
      if (e.cls === 'service') continue;
      const ax = e.pts[c.i], az = e.pts[c.i + 1], bx = e.pts[c.i + 2], bz = e.pts[c.i + 3];
      const d = distPointSeg(x, z, ax, az, bx, bz);
      if (!best || d < best.d) {
        const pr = projectPointSeg(x, z, ax, az, bx, bz);
        const L = Math.hypot(bx - ax, bz - az) || 1;
        best = { x: pr.x, z: pr.z, tx: (bx - ax) / L, tz: (bz - az) / L, edge: e.id, d };
      }
    }
    return best;
  }
}
