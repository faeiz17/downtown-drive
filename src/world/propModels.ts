// Procedural low-poly prop models for instancing. Geometries carry vertex colours; multi-material props use groups.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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


/** Foliage atlas: bottom half = plain opaque (bark / far canopy, tinted by vertex colour), top half = a sprig of leaves with alpha. */
export function makeLeafAtlas(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const rng = new RNG(31337);
  // bottom half (v 0..0.5): opaque with fine grain
  const img = x.createImageData(S, S / 2);
  for (let i = 0; i < S * (S / 2); i++) {
    const v = 214 + Math.floor(rng.next() * 42);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, S / 2);
  // top half (v 0.5..1): sprig of leaves on twigs
  x.clearRect(0, 0, S, S / 2);
  const twig = (x0: number, y0: number, a: number, len: number, depth: number) => {
    const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
    x.strokeStyle = 'rgb(150,150,150)';
    x.lineWidth = depth ? 3 : 4;
    x.beginPath();
    x.moveTo(x0, y0);
    x.lineTo(x1, y1);
    x.stroke();
    const n = depth ? 5 : 8;
    for (let k = 0; k < n; k++) {
      const t = (k + 1) / (n + 1), px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      for (const side of [-1, 1]) {
        const la = a + side * (0.7 + rng.next() * 0.5), ll = 38 + rng.next() * 26 - depth * 8;
        const shade = 190 + Math.floor(rng.next() * 65);
        x.save();
        x.translate(px, py);
        x.rotate(la);
        x.fillStyle = `rgb(${shade},${shade},${shade})`;
        x.beginPath();
        x.ellipse(ll / 2, 0, ll / 2, ll * 0.2, 0, 0, Math.PI * 2);
        x.fill();
        x.strokeStyle = 'rgba(120,120,120,0.9)';
        x.lineWidth = 1.2;
        x.beginPath();
        x.moveTo(0, 0);
        x.lineTo(ll * 0.92, 0);
        x.stroke();
        x.restore();
      }
      if (depth < 1 && k % 2 === 1) twig(px, py, a + (k % 4 === 1 ? 0.9 : -0.9), len * 0.42, depth + 1);
    }
    // terminal leaf
    x.fillStyle = 'rgb(235,235,235)';
    x.save();
    x.translate(x1, y1);
    x.rotate(a);
    x.beginPath();
    x.ellipse(18, 0, 22, 8, 0, 0, Math.PI * 2);
    x.fill();
    x.restore();
  };
  twig(30, 190, -0.05, 410, 0);
  twig(40, 90, 0.18, 380, 0);
  twig(60, 150, -0.35, 330, 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

const uvSolid = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) a.set([0.25, 0.22], i * 2);
  g.setAttribute('uv', new THREE.BufferAttribute(a, 2));
  return g;
};

/** Tapered branch between two points (8-sided), solid-uv, vertex coloured. */
function branch(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, col: THREE.Color, rng: RNG): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, 8, 1).translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q).translate(a.x, a.y, a.z);
  return uvSolid(colorize(g, col, 0.12, rng));
}

/** Crown of leaf cards: random cards in an ellipsoid, normals pointing out from the crown centre (soft, round shading). */
function leafCrown(rng: RNG, c: THREE.Vector3, rad: THREE.Vector3, count: number, size: number, cols: THREE.Color[], top: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [];
  const tmp = new THREE.Vector3(), n = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // point in ellipsoid, pushed outwards so the crown is mostly shell with some interior
    let d: THREE.Vector3;
    do d = tmp.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).clone();
    while (d.lengthSq() > 1 || d.lengthSq() < 0.0001);
    const r = Math.pow(d.length(), 0.45);
    d.normalize().multiplyScalar(r);
    const p = new THREE.Vector3(c.x + d.x * rad.x, c.y + d.y * rad.y * (d.y > 0 ? top : 1), c.z + d.z * rad.z);
    n.copy(d).normalize();
    // card plane: random orientation, loosely facing outwards
    u.set(rng.range(-1, 1), rng.range(-0.6, 0.6), rng.range(-1, 1)).normalize();
    v.crossVectors(u, n.clone().add(new THREE.Vector3(rng.range(-0.5, 0.5), rng.range(-0.5, 0.5), rng.range(-0.5, 0.5))).normalize()).normalize();
    if (v.lengthSq() < 0.01) v.set(0, 1, 0);
    u.crossVectors(v, n).normalize();
    const sz = size * rng.range(0.8, 1.35);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => p.clone().addScaledVector(u, a * sz).addScaledVector(v, b * sz * 0.8));
    const light = THREE.MathUtils.clamp(0.55 + 0.35 * (d.y * 0.5 + 0.5) + 0.2 * r + rng.range(-0.12, 0.12), 0.3, 1.15);
    color.copy(cols[Math.floor(rng.next() * cols.length)]).multiplyScalar(light);
    const quad = [0, 1, 2, 0, 2, 3];
    const uvs = [[0, 0.5], [1, 0.5], [1, 1], [0, 1]];
    for (const k of quad) {
      pos.push(corners[k].x, corners[k].y, corners[k].z);
      nor.push(n.x, n.y, n.z);
      col.push(color.r, color.g, color.b);
      uv.push(uvs[k][0], uvs[k][1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function leafyTree(rng: RNG, h: number, spread: number, trunkR: number, clumps: number, cards: number, leafSize: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const barkC = new THREE.Color(0x6a5440);
  const top = new THREE.Vector3(rng.range(-0.15, 0.15), h * 0.52, rng.range(-0.15, 0.15));
  parts.push(branch(new THREE.Vector3(0, 0, 0), top, trunkR, trunkR * 0.55, barkC, rng));
  // root flare
  parts.push(uvSolid(colorize(new THREE.CylinderGeometry(trunkR * 1.05, trunkR * 1.5, 0.35, 8).translate(0, 0.17, 0), barkC, 0.1, rng)));
  const cols = [new THREE.Color(0x56822f), new THREE.Color(0x4a7a2b), new THREE.Color(0x62903a), new THREE.Color(0x3d6a28)];
  for (let k = 0; k < clumps; k++) {
    const a = (k / clumps) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const reach = spread * rng.range(0.45, 0.8);
    const cy = h * rng.range(0.62, 0.82);
    const centre = new THREE.Vector3(Math.cos(a) * reach, cy, Math.sin(a) * reach);
    const mid = new THREE.Vector3(centre.x * 0.45, top.y + (cy - top.y) * 0.4, centre.z * 0.45);
    parts.push(branch(top.clone(), mid, trunkR * 0.45, trunkR * 0.3, barkC, rng));
    parts.push(branch(mid, centre.clone().multiplyScalar(0.85).setY(cy - 0.3), trunkR * 0.3, trunkR * 0.12, barkC, rng));
    parts.push(leafCrown(rng, centre, new THREE.Vector3(spread * 0.55, h * 0.2, spread * 0.55), cards, leafSize, cols, 0.9));
  }
  parts.push(leafCrown(rng, new THREE.Vector3(0, h * 0.82, 0), new THREE.Vector3(spread * 0.6, h * 0.17, spread * 0.6), Math.round(cards * 0.9), leafSize, cols, 1));
  for (const g of parts) if (g.index) g.setIndex(null);
  for (const g of parts) if (!g.attributes.normal) g.computeVertexNormals();
  return mergeGeometries(parts.map((g) => (g.attributes.uv ? g : uvSolid(g))))!;
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
    void parts;
    models.push({ near: leafyTree(rng, 8.5, 3.6, 0.22, 5, 38, 0.62), far: mergeGeometries(far.map(uvSolid))!, height: 8.5, trunkR: 0.25 });
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
    void parts;
    models.push({ near: leafyTree(rng, 10.5, 5.4, 0.5, 6, 48, 0.78), far: mergeGeometries(far.map(uvSolid))!, height: 10.5, trunkR: 0.55 });
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
  const pole = (h: number, r0: number, r1: number) => {
    // tapered 12-sided shaft on a round plinth with a collar, like a galvanised street-light column
    const shaft = new THREE.CylinderGeometry(r1, r0, h, 12).translate(0, h / 2 + 0.35, 0);
    const plinth = new THREE.CylinderGeometry(r0 * 1.9, r0 * 2.3, 0.35, 12).translate(0, 0.175, 0);
    const collar = new THREE.CylinderGeometry(r0 * 1.35, r0 * 1.6, 0.18, 12).translate(0, 0.44, 0);
    return mergeGeometries([colorize(shaft, metalGrey), colorize(plinth, new THREE.Color(0x777b7e)), colorize(collar, new THREE.Color(0x5e6266))])!;
  };
  const arm = (len: number, h: number, dirX: number, dirZ: number) => {
    // curved bracket: rises from the column and arches out over the road
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.45, len * 0.12), new THREE.Vector3(0, 0.78, len * 0.5), new THREE.Vector3(0, 0.68, len * 0.9), new THREE.Vector3(0, 0.55, len)]);
    const g = new THREE.TubeGeometry(curve, 14, 0.045, 7, false);
    g.rotateY(Math.atan2(dirX, dirZ));
    g.translate(0, h - 0.3, 0);
    return colorize(g, metalGrey);
  };
  const head = (x: number, y: number, z: number, yaw: number) => {
    // cobra-head luminaire: rounded housing, slightly tilted down, with a rear cap
    const body = new RoundedBoxGeometry(0.38, 0.15, 0.82, 3, 0.06);
    const cap = new THREE.CylinderGeometry(0.1, 0.12, 0.08, 10).translate(0, 0.1, -0.2);
    const g = mergeGeometries([colorize(body, new THREE.Color(0x7c8186)), colorize(cap, new THREE.Color(0x4f5357))])!;
    g.rotateX(0.05);
    g.rotateY(yaw);
    g.translate(x, y, z);
    return g;
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
