// Edit the base Lancer CS mesh into the owner's car (docs/car-reference.md):
//  • dark-blue metallic paint, beige interior converted to right-hand drive, steering wheel split onto its own pivot
//  • roof rack and fog lamps removed, stock tail-light internals replaced by chrome "Altezza" twin-round units
//  • body-colour ducktail spoiler, glass sunroof, smoked door visors, mud flaps, Punjab plates, GLX / TEXAS EDITION badges
//  • 15" satin-black cross-spoke wheels with Dunlop SP Touring tyres (blue lettering), separate light nodes
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { loadBase, type BakedPrim } from './base';
import { components } from './components';
import { Part } from '../../src/car/builder/part';
import { buildWheel } from '../../src/car/builder/wheels';
import { WHEELS, SPEC } from '../../src/car/spec';

export interface NodeDef {
  name: string;
  parent?: string;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  parts: Part[];
}

type Bucket = Map<string, Map<string, Part>>; // node → material → part

export async function buildLancerNodes(log = console.log): Promise<{ nodes: NodeDef[]; info: Record<string, unknown> }> {
  const prims = (await loadBase()).filter((p) => p.node !== 'pessima_rollcage'); // roof rack: not on the owner's car
  const out: Bucket = new Map();
  const part = (node: string, mat: string): Part => {
    let m = out.get(node);
    if (!m) out.set(node, (m = new Map()));
    let p = m.get(mat);
    if (!p) m.set(mat, (p = new Part(node, mat)));
    return p;
  };
  /** copy triangles (optionally mirrored across X) into a bucket part */
  const copy = (src: BakedPrim, tris: Iterable<number>, node: string, mat: string, mirror = false) => {
    const p = part(node, mat);
    const remap = new Map<number, number>();
    for (const t of tris) {
      const ids: number[] = [];
      for (let k = 0; k < 3; k++) {
        const i = src.idx[t * 3 + k];
        let j = remap.get(i);
        if (j === undefined) {
          const s = mirror ? -1 : 1;
          j = p.v([src.pos[i * 3] * s, src.pos[i * 3 + 1], src.pos[i * 3 + 2]], [src.nor[i * 3] * s, src.nor[i * 3 + 1], src.nor[i * 3 + 2]]);
          remap.set(i, j);
        }
        ids.push(j);
      }
      if (mirror) p.tri(ids[0], ids[2], ids[1]);
      else p.tri(ids[0], ids[1], ids[2]);
    }
  };
  const allTris = (p: BakedPrim) => Array.from({ length: p.idx.length / 3 }, (_, i) => i);
  const centroid = (p: BakedPrim, t: number): [number, number, number] => {
    const c: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const i = p.idx[t * 3 + k];
      c[0] += p.pos[i * 3] / 3;
      c[1] += p.pos[i * 3 + 1] / 3;
      c[2] += p.pos[i * 3 + 2] / 3;
    }
    return c;
  };
  const triNormalZ = (p: BakedPrim, t: number) => {
    const a = p.idx[t * 3], b = p.idx[t * 3 + 1], c = p.idx[t * 3 + 2];
    const v = (i: number) => new THREE.Vector3(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]);
    return new THREE.Vector3().crossVectors(v(b).sub(v(a)), v(c).sub(v(a))).normalize();
  };

  // --- steering wheel extraction (salon_gray components around the rim, left-hand drive in the source) --------
  const sg = prims.find((p) => p.node === 'pessima_body' && p.material === 'salon_gray')!;
  const comps = components(sg);
  const rim = comps.filter((c) => c.min[0] > 0.17 && c.max[0] < 0.67 && c.min[1] > 0.54 && c.max[1] < 1.0 && c.min[2] > 0.36 && c.max[2] < 0.62).sort((a, b) => b.tris.length - a.tris.length)[0];
  const rimPts: THREE.Vector3[] = [];
  for (const t of rim.tris) for (let k = 0; k < 3; k++) {
    const i = sg.idx[t * 3 + k];
    rimPts.push(new THREE.Vector3(sg.pos[i * 3], sg.pos[i * 3 + 1], sg.pos[i * 3 + 2]));
  }
  const pivot = rimPts.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / rimPts.length);
  const axis = planeNormal(rimPts, pivot);
  if (axis.z > 0) axis.negate(); // point towards the driver (backwards)
  const steerTris = new Set<number>();
  for (const c of comps) {
    const cc = new THREE.Vector3((c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, (c.min[2] + c.max[2]) / 2);
    const d = cc.clone().sub(pivot);
    const along = d.dot(axis);
    const radial = d.clone().addScaledVector(axis, -along).length();
    const size = Math.max(c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]);
    if (radial < 0.23 && along > -0.06 && along < 0.06 && size < 0.5) for (const t of c.tris) steerTris.add(t);
  }
  log(`[car] steering wheel: ${steerTris.size} tris, pivot ${pivot.toArray().map((v) => v.toFixed(3))}, axis ${axis.toArray().map((v) => v.toFixed(3))}`);

  // --- classify all source triangles ------------------------------------------------------------------------------
  for (const p of prims) {
    const m = p.material;
    const inBody = p.node === 'pessima_body';
    const tris = allTris(p);
    switch (m) {
      case 'body1':
        copy(p, tris, 'Body', 'Paint');
        break;
      case 'black1':
        copy(p, tris, 'Trim_Black', 'BlackPlastic');
        break;
      case 'dno1':
        copy(p, tris, 'Underbody', 'Underbody');
        break;
      case 'fog1': // fog lamps are not fitted on the owner's car → blank black vents
      case 'setka':
      case 'material_0':
        copy(p, tris, 'Trim_Black', 'BlackPlastic');
        break;
      case 'material': // grille centre piece
        copy(p, tris, 'Trim_Black', 'BlackGloss');
        break;
      case 'zad_bump': // the owner's rear bumper has no reflectors → painted over
        copy(p, tris, 'Body', 'Paint');
        break;
      case 'doorcart1':
        copy(p, tris, 'Interior', 'InteriorTrim');
        break;
      case 'glass1': {
        if (!inBody) {
          const side = p.node.replace('pessima_door_', '');
          copy(p, tris, `Glass_Side_${side}`, 'GlassTint');
          break;
        }
        const groups: Record<string, number[]> = {};
        for (const t of tris) {
          const [x, y, z] = centroid(p, t);
          let g: string;
          if (z > 1.45 && y < 0.86) g = x > 0 ? 'HeadlightLens_L' : 'HeadlightLens_R';
          else if (z < -1.8 && y < 0.9) g = x > 0 ? 'TaillightLens_L' : 'TaillightLens_R';
          else if (y > 0.84 && z > 0.15) g = 'Glass_Windshield';
          else if (y > 0.84 && z < -0.95) g = 'Glass_Rear';
          else g = 'Glass_Quarter';
          (groups[g] ??= []).push(t);
        }
        for (const [g, ts] of Object.entries(groups)) copy(p, ts, g, g.includes('Lens') ? 'LensClear' : g === 'Glass_Windshield' ? 'GlassClear' : g === 'Glass_Rear' ? 'GlassDark' : 'GlassTint');
        break;
      }
      case 'fara_f1':
      case 'dalniy1':
        copy(p, tris, 'HeadlightHousing', 'Reflector');
        break;
      case 'fara_r1': // becomes the chrome back of the aftermarket tail lights
        copy(p, tris, 'TaillightHousing', 'Chrome');
        break;
      case 'fara_r_f': {
        const L: number[] = [], R: number[] = [];
        for (const t of tris) (centroid(p, t)[0] > 0 ? L : R).push(t);
        copy(p, L, 'ReverseLight_L', 'Light_Reverse');
        copy(p, R, 'ReverseLight_R', 'Light_Reverse');
        break;
      }
      case 'zad1':
      case 'material_7':
      case 'material_8':
        break; // stock tail-light internals: replaced
      case 'seat_2':
        if (!inBody) copy(p, tris, 'Trim_Black', 'BlackPlastic'); // fog-lamp surround in the front bumper
        else copy(p, tris, 'Interior', 'Leather', true);
        break;
      case 'chrome1':
        if (inBody) copy(p, tris, 'Interior', 'Chrome', true);
        else copy(p, tris, 'Trim_Chrome', 'Chrome');
        break;
      case 'salon_gray': {
        if (!inBody) {
          copy(p, tris, 'Interior', 'InteriorTrim');
          break;
        }
        const dark: number[] = [], light: number[] = [];
        for (const t of tris) {
          if (steerTris.has(t)) continue;
          const [, y, z] = centroid(p, t);
          const n = triNormalZ(p, t);
          // dashboard top (dark grey on the owner's car), the rest beige
          if (y > 0.86 && z > 0.45 && z < 1.25 && Math.abs(n.y) > 0.55) dark.push(t);
          else light.push(t);
        }
        copy(p, dark, 'Interior', 'InteriorDark', true);
        copy(p, light, 'Interior', 'InteriorTrim', true);
        break;
      }
      case 'fara_f': {
        const head: number[] = [], gauge: number[] = [];
        for (const t of tris) (centroid(p, t)[2] > 1.3 ? head : gauge).push(t);
        copy(p, head, 'HeadlightHousing', 'Reflector');
        copy(p, gauge, 'Gauges', 'GaugeMarks', true);
        break;
      }
      case 'priborka':
        copy(p, tris, 'Gauges', 'Gauge', true);
        break;
      case 'seat_1':
      case 'koja1':
        copy(p, tris, 'Interior', 'Leather', true);
        break;
      case 'gray_plast':
        copy(p, tris, 'Interior', 'Headliner', true);
        break;
      case 'kover1':
        copy(p, tris, 'Interior', 'Carpet', true);
        break;
      case 'knopk1':
      case 'magnitola':
      case 'wood':
      case 'tabl':
        copy(p, tris, 'Interior', 'InteriorDark', true);
        break;
      default:
        log(`[car] unmapped source material ${m} on ${p.node} (${p.idx.length / 3} tris) → Trim_Black`);
        copy(p, tris, 'Trim_Black', 'BlackPlastic');
    }
  }

  // steering wheel: mirror to the right-hand side and express in its pivot frame (local +Z = column axis)
  const pivotR = new THREE.Vector3(-pivot.x, pivot.y, pivot.z);
  const axisR = new THREE.Vector3(-axis.x, axis.y, axis.z);
  const qCol = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisR);
  const toLocal = new THREE.Matrix4().compose(pivotR, qCol, new THREE.Vector3(1, 1, 1)).invert();
  const steering = new Part('SteeringWheel', 'SteeringWheel');
  {
    const tmp = new Part('tmp', 'SteeringWheel');
    const remap = new Map<number, number>();
    for (const t of steerTris) {
      const ids: number[] = [];
      for (let k = 0; k < 3; k++) {
        const i = sg.idx[t * 3 + k];
        let j = remap.get(i);
        if (j === undefined) {
          j = tmp.v([-sg.pos[i * 3], sg.pos[i * 3 + 1], sg.pos[i * 3 + 2]], [-sg.nor[i * 3], sg.nor[i * 3 + 1], sg.nor[i * 3 + 2]]);
          remap.set(i, j);
        }
        ids.push(j);
      }
      tmp.tri(ids[0], ids[2], ids[1]);
    }
    const g = partGeometry(tmp);
    g.applyMatrix4(toLocal);
    steering.addGeometry(g);
  }

  // --- raycast helpers against the edited body -----------------------------------------------------------------
  const meshFrom = (names: string[]) => {
    const geos: THREE.BufferGeometry[] = [];
    for (const n of names) for (const p of out.get(n)?.values() ?? []) geos.push(partGeometry(p));
    const g = mergeSimple(geos);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld();
    return mesh;
  };
  const rc = new THREE.Raycaster();
  const cast = (mesh: THREE.Mesh, o: number[], d: number[]) => {
    rc.set(new THREE.Vector3(o[0], o[1], o[2]), new THREE.Vector3(d[0], d[1], d[2]).normalize());
    const h = rc.intersectObject(mesh, false)[0];
    if (!h) return null;
    const n = h.face!.normal.clone();
    if (n.dot(rc.ray.direction) > 0) n.negate();
    return { p: h.point, n };
  };
  const exterior = meshFrom(['Body', 'Trim_Black', 'Trim_Chrome']);
  const place = (g: THREE.BufferGeometry, p: THREE.Vector3, n: THREE.Vector3, offset = 0) => {
    const z = n.clone().normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(z.dot(up)) > 0.95) up = new THREE.Vector3(0, 0, 1);
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    return g.clone().applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(p.clone().addScaledVector(z, offset)));
  };
  const info: Record<string, unknown> = { steeringPivot: pivotR.toArray(), steeringAxis: axisR.toArray() };

  // --- aftermarket tail lights: two round red lenses in a chrome housing, clear lower section ----------------------
  const tailLens = meshFrom(['TaillightLens_L']);
  const lensBox = rearFacingBox(out.get('TaillightLens_L')!.get('LensClear')!);
  log(`[car] tail lens rear face x ${lensBox.x0.toFixed(2)}..${lensBox.x1.toFixed(2)} y ${lensBox.y0.toFixed(2)}..${lensBox.y1.toFixed(2)}`);
  const brakeL = new Part('BrakeLight_L', 'Light_Brake'), tailL = new Part('TailLight_L', 'Light_Tail'), cupL = new Part('TailCup_L', 'Chrome');
  const w = lensBox.x1 - lensBox.x0, h = lensBox.y1 - lensBox.y0;
  const r = Math.min(0.062, h * 0.4, w * 0.2);
  for (const f of [0.34, 0.7]) {
    const cx = lensBox.x0 + w * f, cy = lensBox.y0 + h * 0.6;
    const hit = cast(tailLens, [cx, cy, -3.5], [0, 0, 1]) ?? cast(exterior, [cx, cy, -3.5], [0, 0, 1]);
    if (!hit) continue;
    const back = new THREE.Vector3(0, 0, -1); // light faces rearwards
    const dome = new THREE.SphereGeometry(r * 0.64, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
    dome.scale(1, 1, 0.5);
    brakeL.addGeometry(place(dome, hit.p, back, -0.03));
    tailL.addGeometry(place(new THREE.RingGeometry(r * 0.64, r * 0.98, 32), hit.p, back, -0.02));
    const cup = new THREE.CylinderGeometry(r, r * 0.8, 0.03, 32, 1, true).rotateX(Math.PI / 2);
    cupL.addGeometry(place(cup, hit.p, back, -0.035));
    const cupBack = new THREE.CircleGeometry(r * 0.8, 32);
    cupL.addGeometry(place(cupBack, hit.p, back, -0.05));
  }
  const indRL = new Part('Indicator_RL', 'Light_Indicator');
  {
    const hit = cast(meshFrom(['ReverseLight_L']), [lensBox.x1 - 0.07, 0.655, -3.5], [0, 0, 1]);
    if (hit) indRL.addGeometry(place(new RoundedBoxGeometry(0.08, 0.026, 0.02, 2, 0.008), hit.p, new THREE.Vector3(0, 0, -1), -0.02));
  }

  // --- headlights: projector bulbs + amber inner-corner indicator (as on the owner's car) ----------------------------
  const headL = new Part('Headlight_L', 'Light_Head'), indFL = new Part('Indicator_FL', 'Light_Indicator'), bowlL = new Part('HeadlightBowl_L', 'Reflector');
  {
    const lens = out.get('HeadlightLens_L')!.get('LensClear')!;
    const bb = boxOf(lens);
    const hl = meshFrom(['HeadlightLens_L']);
    const cyL = bb.y0 + (bb.y1 - bb.y0) * 0.45;
    for (const fx of [0.62, 0.36]) {
      const x = bb.x0 + (bb.x1 - bb.x0) * fx;
      const hit = cast(hl, [x, cyL, 4], [0, 0, -1]);
      if (hit) {
        const r = fx > 0.5 ? 0.036 : 0.03;
        const lensDisc = new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.32).rotateX(Math.PI / 2).translate(0, 0, -r * 0.95);
        headL.addGeometry(place(lensDisc, hit.p, new THREE.Vector3(0, 0, 1), -0.04));
        bowlL.addGeometry(place(new THREE.CylinderGeometry(r * 1.45, r * 0.9, 0.045, 24, 1, true).rotateX(Math.PI / 2), hit.p, new THREE.Vector3(0, 0, 1), -0.062));
      }
    }
    const hit = cast(hl, [bb.x0 + 0.05, bb.y0 + (bb.y1 - bb.y0) * 0.4, 4], [0, 0, -1]);
    if (hit) indFL.addGeometry(place(new THREE.SphereGeometry(0.022, 14, 10), hit.p, new THREE.Vector3(0, 0, 1), -0.035));
    info.headlight = { x0: bb.x0, x1: bb.x1, y0: bb.y0, y1: bb.y1, z0: bb.z0, z1: bb.z1 };
  }
  // side repeaters on the front fenders
  const repL = new Part('Indicator_SL', 'Light_Indicator');
  {
    const hit = cast(exterior, [2, 0.72, 0.98], [-1, 0, 0]);
    if (hit) repL.addGeometry(place(new THREE.CylinderGeometry(0.024, 0.024, 0.008, 20).rotateX(Math.PI / 2).scale(1.35, 0.8, 1), hit.p, hit.n, 0.002));
  }

  // --- plates, badges ------------------------------------------------------------------------------------------------
  const plateF = new Part('Plate_Front', 'Plate'), plateR = new Part('Plate_Rear', 'Plate'), holder = new Part('PlateHolder', 'BlackPlastic');
  {
    // front plate: on a black holder right of centre, low on the bumper (as on the owner's car)
    const px = -0.17, py = 0.43;
    // sit the holder in front of the most forward bumper point under its whole footprint
    let zf = -Infinity;
    for (let dx = -0.23; dx <= 0.23; dx += 0.023) for (const dy of [-0.09, 0, 0.09]) {
      const f = cast(exterior, [px + dx, py + dy, 4], [0, 0, -1]);
      if (f) zf = Math.max(zf, f.p.z);
    }
    zf += 0.014;
    holder.addGeometry(new RoundedBoxGeometry(0.44, 0.18, 0.024, 2, 0.01).translate(px, py, zf));
    plateF.addGeometry(new THREE.PlaneGeometry(0.36, 0.16).translate(px, py, zf + 0.0135));
    const rr = cast(exterior, [0, 0.83, -4], [0, 0, 1])!;
    plateR.addGeometry(new THREE.PlaneGeometry(0.36, 0.16).rotateY(Math.PI).translate(0, 0.83, rr.p.z - 0.004));
    info.plates = { front: zf, rear: rr.p.z };
  }
  const badgeGLX = new Part('Badge_GLX', 'Badge'), badgeTexas = new Part('Badge_Texas', 'Badge');
  {
    const lancer = chromeBadgeOnTrunk(prims);
    const gx = cast(exterior, [-Math.abs(lancer.x), lancer.y, -4], [0, 0, 1]);
    if (gx) badgeGLX.addGeometry(place(new THREE.PlaneGeometry(0.085, 0.028), gx.p, gx.n, 0.003));
    const tx = cast(exterior, [0.36, lancer.emblemY - 0.005, -4], [0, 0, 1]);
    if (tx) badgeTexas.addGeometry(place(new THREE.PlaneGeometry(0.1, 0.032), tx.p, tx.n, 0.003));
    info.badges = lancer;
  }

  // --- ducktail spoiler (body colour, kicked-up lip across the trunk edge, no stilts) ------------------------------------
  const spoiler = new Part('Spoiler', 'Paint');
  {
    const deck = (x: number, z: number) => cast(exterior, [x, 3, z], [0, -1, 0])!.p.y;
    const zLead = -1.93, chord = 0.2, halfW = 0.38; // tail lamps start at |x| = 0.46: the lip stays clear of them
    const prof = new THREE.Shape(); // side profile, s = distance rearwards, y = height above the lid
    prof.moveTo(0, 0);
    prof.bezierCurveTo(0.07, 0.004, 0.14, 0.02, chord, 0.072); // sweeps up into the lip
    prof.lineTo(chord + 0.004, 0.066);
    prof.lineTo(chord - 0.01, 0.0);
    prof.lineTo(0, -0.01);
    const duck = new THREE.ExtrudeGeometry(prof, { depth: halfW * 2, bevelEnabled: false, steps: 32, curveSegments: 12 });
    const dp = duck.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < dp.count; i++) {
      const sx = dp.getX(i), yy = dp.getY(i), x = dp.getZ(i) - halfW;
      const taper = 1 - Math.pow(Math.abs(x) / halfW, 3) * 0.55; // lip fades out towards the corners
      const z = zLead - sx;
      dp.setXYZ(i, x, deck(Math.max(-halfW * 0.92, Math.min(halfW * 0.92, x)), z) + 0.012 + yy * (yy > 0 ? taper : 1), z);
    }
    duck.computeVertexNormals();
    spoiler.addGeometry(duck);
  }

  // --- glass sunroof -----------------------------------------------------------------------------------------------------
  const sunroof = new Part('Glass_Sunroof', 'GlassDark'), sunFrame = new Part('SunroofFrame', 'BlackPlastic');
  {
    const roof = meshFrom(['Body']);
    const xs = 12, zs = 12, hx = 0.36, z0 = 0.03, z1 = -0.62;
    const grid: THREE.Vector3[][] = [];
    for (let i = 0; i <= zs; i++) {
      const row: THREE.Vector3[] = [];
      for (let j = 0; j <= xs; j++) {
        const x = -hx + (2 * hx * j) / xs, z = z0 + ((z1 - z0) * i) / zs;
        const hit = cast(roof, [x, 3, z], [0, -1, 0]);
        row.push(new THREE.Vector3(x, (hit?.p.y ?? 1.38) + 0.004, z));
      }
      grid.push(row);
    }
    for (let i = 0; i < zs; i++) for (let j = 0; j < xs; j++) {
      const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j + 1], d = grid[i + 1][j];
      sunroof.quad([a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z], [d.x, d.y, d.z], [0, 1, 0]);
    }
    const ring: THREE.Vector3[] = [...grid[0], ...grid.map((r) => r[xs]).slice(1), ...grid[zs].slice().reverse().slice(1), ...grid.map((r) => r[0]).reverse().slice(1)];
    for (let k = 0; k < ring.length - 1; k++) {
      const a = ring[k], b = ring[k + 1];
      const cx = 0, cz = (z0 + z1) / 2;
      const oa = new THREE.Vector3(a.x - cx, 0, a.z - cz).normalize().multiplyScalar(0.022), ob = new THREE.Vector3(b.x - cx, 0, b.z - cz).normalize().multiplyScalar(0.022);
      sunFrame.quad([a.x, a.y + 0.001, a.z], [b.x, b.y + 0.001, b.z], [b.x + ob.x, b.y, b.z + ob.z], [a.x + oa.x, a.y, a.z + oa.z], [0, 1, 0]);
    }
  }

  // --- smoked door visors along the top of the door windows ---------------------------------------------------------
  const visorL = new Part('Visor_L', 'Visor');
  {
    const glassFL = meshFrom(['Glass_Side_FL']), glassRL = meshFrom(['Glass_Side_RL']);
    for (const [g, z0, z1] of [[glassFL, 0.62, -0.25], [glassRL, -0.36, -1.12]] as [THREE.Mesh, number, number][]) {
      const top: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
      for (let z = z0; z >= z1; z -= 0.04) {
        let lo = 0.95, hi = 1.4;
        let last: { p: THREE.Vector3; n: THREE.Vector3 } | null = null;
        for (let it = 0; it < 18; it++) {
          const mid = (lo + hi) / 2;
          const hit = cast(g, [1.6, mid, z], [-1, 0, 0]);
          if (hit) {
            lo = mid;
            last = hit;
          } else hi = mid;
        }
        if (last) top.push(last);
      }
      for (let i = 0; i + 1 < top.length; i++) {
        const A = top[i], B = top[i + 1];
        const up = new THREE.Vector3(0, 1, 0);
        const oa = A.n.clone().setY(0).normalize(), ob = B.n.clone().setY(0).normalize();
        const a1 = A.p.clone().addScaledVector(up, 0.03).addScaledVector(oa, 0.012), b1 = B.p.clone().addScaledVector(up, 0.03).addScaledVector(ob, 0.012);
        const a2 = A.p.clone().addScaledVector(up, -0.03).addScaledVector(oa, 0.05), b2 = B.p.clone().addScaledVector(up, -0.03).addScaledVector(ob, 0.05);
        visorL.quad(a1.toArray() as [number, number, number], b1.toArray() as [number, number, number], b2.toArray() as [number, number, number], a2.toArray() as [number, number, number], [oa.x, 0.4, oa.z]);
      }
    }
  }

  // --- mud flaps ------------------------------------------------------------------------------------------------------
  const flapsL = new Part('MudFlaps_L', 'BlackPlastic');
  for (const [z, hgt] of [[WHEELS[0].z - 0.42, 0.16], [WHEELS[2].z - 0.43, 0.22]] as [number, number][]) {
    const hit = cast(exterior, [0.8, -1, z], [0, 1, 0]);
    const top = (hit?.p.y ?? 0.3) + 0.03;
    flapsL.addGeometry(new RoundedBoxGeometry(0.15, hgt, 0.012, 2, 0.004).translate(0.77, top - hgt / 2, z));
  }

  // --- assemble nodes --------------------------------------------------------------------------------------------------
  const nodes: NodeDef[] = [{ name: 'Lancer', parts: [] }];
  for (const [name, mats] of out) nodes.push({ name, parent: 'Lancer', parts: [...mats.values()] });
  const sided = (p: Part) => {
    nodes.push({ name: p.name, parent: 'Lancer', parts: [p] });
    const rn = p.name.replace(/_L$/, '_R').replace(/_FL$/, '_FR').replace(/_RL$/, '_RR').replace(/_SL$/, '_SR');
    nodes.push({ name: rn, parent: 'Lancer', parts: [p.mirrored(rn)] });
  };
  [brakeL, tailL, indRL, headL, bowlL, indFL, repL, visorL, flapsL].forEach(sided);
  // tail cups join the chrome housing of each side
  nodes.push({ name: 'TailCups', parent: 'Lancer', parts: [both(cupL)] });
  for (const p of [plateF, plateR, holder, badgeGLX, badgeTexas, spoiler, sunroof, sunFrame]) nodes.push({ name: p.name, parent: 'Lancer', parts: [p] });
  nodes.push({ name: 'SteeringColumn', parent: 'Lancer', translation: pivotR.toArray() as [number, number, number], rotation: qCol.toArray() as [number, number, number, number], parts: [] });
  nodes.push({ name: 'SteeringWheel', parent: 'SteeringColumn', parts: [steering] });

  // wheels
  const wheel = buildWheel();
  const rotY = new THREE.Matrix4().makeRotationY(Math.PI);
  for (const wd of WHEELS) {
    const left = wd.x > 0;
    const mount = `WheelMount_${wd.name}`;
    nodes.push({ name: mount, parent: 'Lancer', translation: [wd.x, SPEC.wheelY, wd.z], parts: [] });
    let parent = mount;
    if (wd.front) {
      nodes.push({ name: `SteerPivot_${wd.name}`, parent: mount, parts: [] });
      parent = `SteerPivot_${wd.name}`;
    }
    const wp: Part[] = [];
    for (const src of [wheel.tire, wheel.lettering, wheel.rim, wheel.cap, wheel.disc]) {
      if (left) {
        const c = new Part(src.name, src.material);
        c.merge(src);
        wp.push(c);
      } else {
        const c = new Part(src.name, src.material);
        const g = partGeometry(src);
        g.applyMatrix4(rotY);
        c.addGeometry(g);
        wp.push(c);
      }
    }
    nodes.push({ name: `Wheel_${wd.name}`, parent, parts: wp });
    const cal = new Part('Caliper', 'Caliper');
    if (left) cal.merge(wheel.caliper);
    else cal.merge(wheel.caliper.mirrored('Caliper'));
    nodes.push({ name: `Caliper_${wd.name}`, parent, parts: [cal] });
  }
  return { nodes, info };
}

function both(p: Part): Part {
  const m = new Part(p.name, p.material);
  m.merge(p);
  m.merge(p.mirrored(p.name));
  return m;
}

export function partGeometry(p: Part): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
  g.setIndex(p.idx);
  return g;
}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (const g of geos) {
    const base = pos.length / 3;
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const I = g.getIndex()!;
    for (let i = 0; i < I.count; i++) idx.push(base + I.getX(i));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

function planeNormal(pts: THREE.Vector3[], c: THREE.Vector3): THREE.Vector3 {
  // smallest-variance direction via power iteration on (trace·I − C)
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += d[i] * d[j];
  }
  const tr = C[0] + C[4] + C[8];
  const M = C.map((v, k) => (k % 4 === 0 ? tr - v : -v));
  let v = new THREE.Vector3(0.3, 0.3, 0.9).normalize();
  for (let it = 0; it < 200; it++) {
    const nv = new THREE.Vector3(M[0] * v.x + M[1] * v.y + M[2] * v.z, M[3] * v.x + M[4] * v.y + M[5] * v.z, M[6] * v.x + M[7] * v.y + M[8] * v.z);
    v = nv.normalize();
  }
  return v;
}

function boxOf(p: Part) {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (let i = 0; i < p.pos.length; i += 3) {
    b.x0 = Math.min(b.x0, p.pos[i]);
    b.x1 = Math.max(b.x1, p.pos[i]);
    b.y0 = Math.min(b.y0, p.pos[i + 1]);
    b.y1 = Math.max(b.y1, p.pos[i + 1]);
    b.z0 = Math.min(b.z0, p.pos[i + 2]);
    b.z1 = Math.max(b.z1, p.pos[i + 2]);
  }
  return b;
}

/** Bounding box of the rear-facing (normal.z < −0.5) triangles of a lens part. */
function rearFacingBox(p: Part) {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (let t = 0; t < p.idx.length; t += 3) {
    const v = [0, 1, 2].map((k) => new THREE.Vector3(p.pos[p.idx[t + k] * 3], p.pos[p.idx[t + k] * 3 + 1], p.pos[p.idx[t + k] * 3 + 2]));
    const n = new THREE.Vector3().crossVectors(v[1].clone().sub(v[0]), v[2].clone().sub(v[0])).normalize();
    if (Math.abs(n.z) < 0.5) continue;
    for (const q of v) {
      b.x0 = Math.min(b.x0, q.x);
      b.x1 = Math.max(b.x1, q.x);
      b.y0 = Math.min(b.y0, q.y);
      b.y1 = Math.max(b.y1, q.y);
    }
  }
  return b;
}

/** The base model's chrome "LANCER" script and triple-diamond on the trunk lid (positions for the extra badges). */
function chromeBadgeOnTrunk(prims: BakedPrim[]): { x: number; y: number; emblemY: number } {
  const p = prims.find((q) => q.node === 'pessima_trunk' && q.material === 'chrome1')!;
  const comps = components(p);
  let lancer = { x: 0.35, y: 0.66 }, emblemY = 0.92;
  for (const c of comps) {
    const cx = (c.min[0] + c.max[0]) / 2, cy = (c.min[1] + c.max[1]) / 2;
    if (Math.abs(cx) < 0.06) emblemY = cy;
  }
  const side = comps.filter((c) => (c.min[0] + c.max[0]) / 2 > 0.15);
  if (side.length) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of side) {
      x0 = Math.min(x0, c.min[0]);
      x1 = Math.max(x1, c.max[0]);
      y0 = Math.min(y0, c.min[1]);
      y1 = Math.max(y1, c.max[1]);
    }
    lancer = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }
  return { ...lancer, emblemY };
}
