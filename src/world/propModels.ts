// Procedural low-poly prop models for instancing. Geometries carry vertex colours; multi-material props use groups.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../core/rng';

function colorize(g: THREE.BufferGeometry, col: THREE.Color, jitter = 0, rng?: RNG): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    const f = jitter && rng ? 1 + rng.range(-jitter, jitter) : 1;
    for (let k = 0; k < 3 && i + k < n; k++) {
      c[(i + k) * 3] = col.r * f;
      c[(i + k) * 3 + 1] = col.g * f;
      c[(i + k) * 3 + 2] = col.b * f;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function jitterVerts(g: THREE.BufferGeometry, amt: number, rng: RNG): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  // jitter consistently per unique position so the blob stays closed
  const map = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let o = map.get(k);
    if (!o) map.set(k, (o = [rng.range(-amt, amt), rng.range(-amt, amt), rng.range(-amt, amt)]));
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  return g;
}

const bark = new THREE.Color(0x5b4632);
const leaf = [new THREE.Color(0x3f6b2a), new THREE.Color(0x4d7a2e), new THREE.Color(0x355d25), new THREE.Color(0x2f5a33)];

export interface TreeModel {
  near: THREE.BufferGeometry;
  far: THREE.BufferGeometry;
  height: number;
  trunkR: number;
}

export function buildTreeModels(): TreeModel[] {
  const rng = new RNG(5150);
  const blob = (r: number, x: number, y: number, z: number, col: THREE.Color, sy = 1) => {
    const g = jitterVerts(new THREE.IcosahedronGeometry(r, 1), r * 0.18, rng);
    g.scale(1, sy, 1);
    g.translate(x, y, z);
    g.computeVertexNormals();
    return colorize(g, col, 0.12, rng);
  };
  const trunk = (r0: number, r1: number, h: number, lean = 0) => {
    const g = new THREE.CylinderGeometry(r1, r0, h, 6, 2);
    g.translate(0, h / 2, 0);
    if (lean) {
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + (p.getY(i) / h) * lean);
    }
    return colorize(g, bark, 0.1, rng);
  };
  const models: TreeModel[] = [];
  // 0: broadleaf (neem / sheesham)
  {
    const parts = [trunk(0.22, 0.13, 3.4), blob(1.8, 0, 4.4, 0, leaf[0]), blob(1.4, 1.1, 4.0, 0.5, leaf[1]), blob(1.4, -1.0, 4.1, -0.6, leaf[2]), blob(1.2, 0.2, 5.3, -0.2, leaf[1]), blob(1.1, -0.3, 4.2, 1.1, leaf[0])];
    const far = [colorize(new THREE.CylinderGeometry(0.15, 0.2, 3.4, 4).translate(0, 1.7, 0), bark), colorize(new THREE.IcosahedronGeometry(2.4, 0).scale(1, 0.85, 1).translate(0, 4.5, 0), leaf[0], 0.1, rng)];
    models.push({ near: mergeGeometries(parts)!, far: mergeGeometries(far)!, height: 6.5, trunkR: 0.25 });
  }
  // 1: palm
  {
    const parts: THREE.BufferGeometry[] = [];
    const H = 7.5;
    parts.push(trunk(0.24, 0.17, H, 0.6));
    const frondCol = new THREE.Color(0x4f7d2a);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const len = rng.range(2.6, 3.3);
      const g = new THREE.PlaneGeometry(len, 0.7, 5, 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) + len / 2; // 0..len
        const t = x / len;
        const droop = -t * t * 1.6;
        p.setXYZ(i, x, droop + p.getY(i) * 0.15, p.getY(i) * (1 - t * 0.7));
      }
      g.computeVertexNormals();
      g.rotateY(a);
      g.translate(0.6, H, 0);
      parts.push(colorize(g, frondCol, 0.15, rng));
    }
    parts.push(colorize(new THREE.IcosahedronGeometry(0.35, 0).translate(0.6, H - 0.2, 0), new THREE.Color(0x6b5a2a)));
    const far = [colorize(new THREE.CylinderGeometry(0.15, 0.2, H, 4).translate(0.3, H / 2, 0), bark), colorize(new THREE.ConeGeometry(2.6, 1.6, 6).rotateX(Math.PI).translate(0.6, H - 0.2, 0), frondCol)];
    models.push({ near: mergeGeometries(parts)!, far: mergeGeometries(far)!, height: 8.5, trunkR: 0.22 });
  }
  // 2: ashoka (Polyalthia longifolia – tall columnar, very common along Lahore roads)
  {
    const parts = [trunk(0.13, 0.08, 2.0)];
    for (let k = 0; k < 5; k++) parts.push(blob(0.95 - k * 0.1, rng.range(-0.15, 0.15), 2.4 + k * 1.35, rng.range(-0.15, 0.15), leaf[3], 1.35));
    const far = [colorize(new THREE.ConeGeometry(1.0, 7.5, 5).translate(0, 5.2, 0), leaf[3])];
    models.push({ near: mergeGeometries(parts)!, far: mergeGeometries(far)!, height: 9, trunkR: 0.15 });
  }
  // 3: banyan / peepal (big canopy in parks and green belts)
  {
    const parts = [trunk(0.55, 0.35, 3.2), blob(2.8, 0, 5.4, 0, leaf[2]), blob(2.3, 2.2, 5.0, 0.8, leaf[0]), blob(2.3, -2.1, 5.1, -0.9, leaf[1]), blob(2.1, 0.5, 6.6, -1.5, leaf[0]), blob(2.0, -0.6, 5.2, 2.0, leaf[2])];
    const far = [colorize(new THREE.CylinderGeometry(0.4, 0.5, 3.2, 4).translate(0, 1.6, 0), bark), colorize(new THREE.IcosahedronGeometry(3.6, 0).scale(1.1, 0.75, 1.1).translate(0, 5.6, 0), leaf[2], 0.1, rng)];
    models.push({ near: mergeGeometries(parts)!, far: mergeGeometries(far)!, height: 8, trunkR: 0.55 });
  }
  return models;
}

/** Multi-material prop: group 0 = body material, group 1 = emissive (lamp) material. */
function withGroups(body: THREE.BufferGeometry[], emissive: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const a = mergeGeometries(body.map((g) => stripForMerge(g)))!;
  const parts = [a];
  if (emissive.length) parts.push(mergeGeometries(emissive.map((g) => stripForMerge(g)))!);
  const merged = mergeGeometries(parts, true)!;
  return merged;
}

function stripForMerge(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  if (!geo.getAttribute('color')) colorizeInPlace(geo, new THREE.Color(1, 1, 1));
  return geo;
}

function colorizeInPlace(g: THREE.BufferGeometry, c: THREE.Color) {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

const metalGrey = new THREE.Color(0x8a8e92);
const concreteGrey = new THREE.Color(0x9c9890);

/** Street light types: 0 single arm, 1 double arm (median), 3 high mast. Returns geometry + light head offsets (local). */
export function buildLampModels(): { geo: THREE.BufferGeometry[]; heads: THREE.Vector3[][] } {
  const geo: THREE.BufferGeometry[] = [];
  const heads: THREE.Vector3[][] = [];
  const pole = (h: number, r0: number, r1: number) => colorize(new THREE.CylinderGeometry(r1, r0, h, 8).translate(0, h / 2, 0), metalGrey);
  const arm = (len: number, h: number, dirX: number, dirZ: number) => {
    const g = new THREE.BoxGeometry(0.07, 0.07, len);
    g.translate(0, 0, len / 2);
    g.rotateX(-0.12);
    g.rotateY(Math.atan2(dirX, dirZ));
    g.translate(0, h, 0);
    return colorize(g, metalGrey);
  };
  const head = (x: number, y: number, z: number, yaw: number) => {
    const g = new THREE.BoxGeometry(0.34, 0.12, 0.7);
    g.rotateY(yaw);
    g.translate(x, y, z);
    return colorize(g, new THREE.Color(0x6f7377));
  };
  const lens = (x: number, y: number, z: number, yaw: number) => {
    const g = new THREE.PlaneGeometry(0.28, 0.62);
    g.rotateX(Math.PI / 2);
    g.rotateY(yaw);
    g.translate(x, y - 0.065, z);
    return colorize(g, new THREE.Color(1, 1, 1));
  };
  // 0: single arm toward +Z
  geo[0] = withGroups([pole(9, 0.11, 0.07), arm(1.9, 8.9, 0, 1), head(0, 9.1, 1.95, 0)], [lens(0, 9.1, 1.95, 0)]);
  heads[0] = [new THREE.Vector3(0, 9.0, 1.95)];
  // 1: double arm toward ±X (median)
  geo[1] = withGroups([pole(10, 0.13, 0.08), arm(2.0, 9.9, 1, 0), arm(2.0, 9.9, -1, 0), head(2.05, 10.12, 0, Math.PI / 2), head(-2.05, 10.12, 0, Math.PI / 2)], [lens(2.05, 10.12, 0, Math.PI / 2), lens(-2.05, 10.12, 0, Math.PI / 2)]);
  heads[1] = [new THREE.Vector3(2.05, 10.0, 0), new THREE.Vector3(-2.05, 10.0, 0)];
  geo[2] = geo[0];
  heads[2] = heads[0];
  // 3: high mast (roundabouts)
  {
    const body = [pole(22, 0.35, 0.16), colorize(new THREE.TorusGeometry(0.9, 0.08, 4, 12).rotateX(Math.PI / 2).translate(0, 21.6, 0), metalGrey)];
    const em: THREE.BufferGeometry[] = [];
    const hs: THREE.Vector3[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const x = Math.cos(a) * 0.9, z = Math.sin(a) * 0.9;
      body.push(colorize(new THREE.BoxGeometry(0.4, 0.3, 0.3).translate(x, 21.9, z), new THREE.Color(0x555a5e)));
      em.push(colorize(new THREE.PlaneGeometry(0.35, 0.28).rotateX(Math.PI / 2).translate(x, 21.74, z), new THREE.Color(1, 1, 1)));
      hs.push(new THREE.Vector3(x, 21.7, z));
    }
    geo[3] = withGroups(body, em);
    heads[3] = hs;
  }
  return { geo, heads };
}

/** Concrete electricity poles (with crossarms, insulators); variants with lamp arm and with transformer. */
export function buildPoleModels(): { base: THREE.BufferGeometry; lamp: THREE.BufferGeometry; transformer: THREE.BufferGeometry; lampHead: THREE.Vector3; wireAttach: THREE.Vector3[] } {
  const post = new THREE.CylinderGeometry(0.09, 0.15, 9.6, 4, 1);
  post.rotateY(Math.PI / 4);
  post.translate(0, 4.8, 0);
  const cross = new THREE.BoxGeometry(2.1, 0.11, 0.11).translate(0, 8.75, 0);
  const cross2 = new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0, 7.9, 0);
  const parts = [colorize(post, concreteGrey), colorize(cross, new THREE.Color(0x6b6b66)), colorize(cross2, new THREE.Color(0x6b6b66))];
  const wireAttach: THREE.Vector3[] = [];
  for (const x of [-0.95, -0.35, 0.35, 0.95]) {
    parts.push(colorize(new THREE.CylinderGeometry(0.045, 0.06, 0.18, 6).translate(x, 8.9, 0), new THREE.Color(0xd8d4c4)));
    wireAttach.push(new THREE.Vector3(x, 8.98, 0));
  }
  for (const x of [-0.6, 0.6]) wireAttach.push(new THREE.Vector3(x, 7.95, 0));
  wireAttach.push(new THREE.Vector3(0, 6.3, 0.12)); // telecom cable
  const base = mergeGeometries(parts.map(stripForMerge))!;
  const armG = new THREE.BoxGeometry(0.06, 0.06, 1.3).translate(0, 0, 0.65).rotateX(-0.2).translate(0, 6.6, 0.1);
  const headG = new THREE.BoxGeometry(0.26, 0.1, 0.5).translate(0, 6.85, 1.35);
  const lensG = new THREE.PlaneGeometry(0.22, 0.44).rotateX(Math.PI / 2).translate(0, 6.79, 1.35);
  const lamp = withGroups([colorize(armG, metalGrey), colorize(headG, new THREE.Color(0x6f7377))], [colorize(lensG, new THREE.Color(1, 1, 1))]);
  const tbox = new THREE.BoxGeometry(0.8, 1.1, 0.6).translate(0, 5.2, 0.45);
  const tplat = new THREE.BoxGeometry(1.2, 0.08, 0.9).translate(0, 4.6, 0.45);
  const fins = new THREE.BoxGeometry(0.9, 0.9, 0.08).translate(0, 5.2, 0.8);
  const transformer = mergeGeometries([colorize(tbox, new THREE.Color(0x6e7a70)), colorize(tplat, new THREE.Color(0x555)), colorize(fins, new THREE.Color(0x5d675f))].map(stripForMerge))!;
  return { base, lamp, transformer, lampHead: new THREE.Vector3(0, 6.75, 1.35), wireAttach };
}

export function buildTankModel(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.58, 0.55, 1.15, 14, 3).translate(0, 0.575 + 0.12, 0);
  const lid = new THREE.CylinderGeometry(0.2, 0.25, 0.12, 10).translate(0, 1.33, 0);
  const stand = new THREE.BoxGeometry(1.2, 0.12, 1.2).translate(0, 0.06, 0);
  return mergeGeometries([colorize(body, new THREE.Color(0x1d1d1f)), colorize(lid, new THREE.Color(0x2a2a2c)), colorize(stand, new THREE.Color(0x777))].map(stripForMerge))!;
}

export function buildSolarModel(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 2; j++) {
      const p = new THREE.BoxGeometry(1.0, 0.04, 1.65);
      p.rotateX(-0.45);
      p.translate(-1.1 + i * 1.1, 0.9, -1.0 + j * 2.0);
      parts.push(colorize(p, new THREE.Color(0x1b2a44)));
      const leg = new THREE.BoxGeometry(0.05, 0.9, 0.05).translate(-1.1 + i * 1.1, 0.45, -1.0 + j * 2.0 + 0.6);
      parts.push(colorize(leg, new THREE.Color(0x999)));
    }
  return mergeGeometries(parts.map(stripForMerge))!;
}

export function buildLanternModel(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.26, 0.34, 0.26).translate(0, 0.17 + 0.05, 0);
  const cap = new THREE.ConeGeometry(0.24, 0.16, 4).rotateY(Math.PI / 4).translate(0, 0.47, 0);
  const base = new THREE.BoxGeometry(0.3, 0.05, 0.3).translate(0, 0.025, 0);
  return withGroups([colorize(cap, new THREE.Color(0x3a2a1a)), colorize(base, new THREE.Color(0x3a2a1a))], [colorize(body, new THREE.Color(1, 1, 1))]);
}

/** Radial gradient texture for fake light pools under street lamps at night. */
export function makePoolTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}
