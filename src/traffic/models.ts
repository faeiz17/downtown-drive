// Low-poly traffic vehicles typical of Lahore. Each type = paint geometry (tinted per instance), fixed-colour
// geometry (glass, tyres, trim) and light geometry (head/tail lamps, brightened at night).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type VehicleKind = 'sedan' | 'hatch' | 'rickshaw' | 'bike' | 'pickup';

export interface VehicleModel {
  kind: VehicleKind;
  paint: THREE.BufferGeometry;
  fixed: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
  length: number;
  width: number;
  height: number;
  speedFactor: number;
  /** weight relative to a sedan (how hard it is to shove out of the way) */
  massFactor: number;
  palette: number[];
}

function col(g: THREE.BufferGeometry, c: number | THREE.Color): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const color = c instanceof THREE.Color ? c : new THREE.Color(c);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([color.r, color.g, color.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  geo.deleteAttribute('uv');
  return geo;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number, r = 0) =>
  col((r > 0 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d)).translate(x, y, z), c);
const wheel = (r: number, w: number, x: number, z: number, c = 0x151515) => col(new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2).translate(x, r, z), c);
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs)!;

const GLASS = 0x1b2530, TRIM = 0x202020, CHROME = 0xb8bcc0;

function carBody(L: number, W: number, H: number, hood: number, trunk: number, cabinH: number, round: number) {
  const bodyH = H - cabinH;
  const paint = [box(W, bodyH - 0.25, L, 0, 0.25 + (bodyH - 0.25) / 2, 0, 0xffffff, round)];
  const cabL = L - hood - trunk;
  const cz = (trunk - hood) / 2;
  paint.push(box(W * 0.9, cabinH, cabL, 0, bodyH + cabinH / 2 - 0.02, cz, 0xffffff, Math.min(round * 1.5, 0.12)));
  const fixed = [
    box(W * 0.91, cabinH * 0.62, cabL * 0.98, 0, bodyH + cabinH * 0.42, cz, GLASS), // glass band
    box(W * 0.8, cabinH * 0.66, 0.02, 0, bodyH + cabinH * 0.42, cz + cabL / 2 + 0.005, GLASS),
    box(W * 0.8, cabinH * 0.6, 0.02, 0, bodyH + cabinH * 0.42, cz - cabL / 2 - 0.005, GLASS),
    box(W * 1.01, 0.12, L * 1.005, 0, 0.3, 0, TRIM), // bumpers/rub strip
  ];
  return { paint, fixed, bodyH };
}

export function buildVehicleModels(): VehicleModel[] {
  const models: VehicleModel[] = [];
  // sedan (Corolla / City class)
  {
    const L = 4.45, W = 1.72, H = 1.46;
    const { paint, fixed, bodyH } = carBody(L, W, H, 1.2, 0.85, 0.52, 0.08);
    for (const x of [-0.74, 0.74]) for (const z of [-1.35, 1.3]) fixed.push(wheel(0.31, 0.2, x, z));
    const lights = [box(0.34, 0.1, 0.02, 0.58, bodyH - 0.12, L / 2 + 0.005, 0xfff4d6), box(0.34, 0.1, 0.02, -0.58, bodyH - 0.12, L / 2 + 0.005, 0xfff4d6), box(0.3, 0.12, 0.02, 0.62, bodyH - 0.1, -L / 2 - 0.005, 0xff1a0a), box(0.3, 0.12, 0.02, -0.62, bodyH - 0.1, -L / 2 - 0.005, 0xff1a0a)];
    models.push({ kind: 'sedan', paint: merge(paint), fixed: merge(fixed), lights: merge(lights), massFactor: 1, length: L, width: W, height: H, speedFactor: 1, palette: [0xf2f2f0, 0xf2f2f0, 0xc9ccd0, 0x9ea3a8, 0x1a1a1c, 0x1a1a1c, 0x2b3a55, 0x7a1f1f, 0xf2c400, 0xf2c400, 0xf2c400, 0xb8bcc0] }); // incl. taxi yellow
  }
  // small hatch (Mehran / Alto / Cultus)
  {
    const L = 3.55, W = 1.5, H = 1.42;
    const { paint, fixed, bodyH } = carBody(L, W, H, 0.75, 0.25, 0.58, 0.06);
    for (const x of [-0.63, 0.63]) for (const z of [-1.05, 1.1]) fixed.push(wheel(0.27, 0.17, x, z));
    const lights = [box(0.24, 0.12, 0.02, 0.5, bodyH - 0.12, L / 2 + 0.005, 0xfff4d6), box(0.24, 0.12, 0.02, -0.5, bodyH - 0.12, L / 2 + 0.005, 0xfff4d6), box(0.16, 0.2, 0.02, 0.6, bodyH, -L / 2 - 0.005, 0xff1a0a), box(0.16, 0.2, 0.02, -0.6, bodyH, -L / 2 - 0.005, 0xff1a0a)];
    models.push({ kind: 'hatch', paint: merge(paint), fixed: merge(fixed), lights: merge(lights), massFactor: 0.85, length: L, width: W, height: H, speedFactor: 0.9, palette: [0xf2f2f0, 0xf2f2f0, 0xc9ccd0, 0x8a1c1c, 0x1f3f7a, 0x2e2e2e, 0xd8c7a0, 0x47704a] });
  }
  // auto rickshaw (green body, yellow roof edge, black canopy – Lahore CNG rickshaw)
  {
    const paint = [
      box(1.25, 0.5, 1.4, 0, 0.55, -0.35, 0xffffff, 0.06), // passenger tub
      box(0.9, 0.55, 0.8, 0, 0.62, 0.75, 0xffffff, 0.08), // driver front
    ];
    const fixed = [
      box(1.32, 0.06, 2.2, 0, 1.68, -0.05, 0x151515), // canopy
      box(1.3, 0.9, 0.05, 0, 1.22, -1.05, 0x151515), // back
      box(0.05, 0.85, 1.4, 0.64, 1.25, -0.3, 0x151515),
      box(0.05, 0.85, 1.4, -0.64, 1.25, -0.3, 0x151515),
      box(0.85, 0.5, 0.03, 0, 1.25, 1.12, GLASS),
      box(1.33, 0.08, 2.22, 0, 1.64, -0.05, 0xf2c200), // yellow trim
      box(0.4, 0.35, 0.5, 0, 0.9, 0.35, 0x2a2a2a), // driver seat
      wheel(0.22, 0.12, 0, 1.0),
      wheel(0.22, 0.14, 0.58, -0.75),
      wheel(0.22, 0.14, -0.58, -0.75),
    ];
    const lights = [box(0.16, 0.16, 0.03, 0, 0.95, 1.16, 0xfff4d6), box(0.12, 0.1, 0.02, 0.5, 0.5, -1.06, 0xff1a0a), box(0.12, 0.1, 0.02, -0.5, 0.5, -1.06, 0xff1a0a)];
    models.push({ kind: 'rickshaw', paint: merge(paint), fixed: merge(fixed), lights: merge(lights), massFactor: 0.45, length: 2.7, width: 1.33, height: 1.75, speedFactor: 0.6, palette: [0x1f7a3a, 0x1f7a3a, 0x167f5b, 0x1f5f9a, 0x2b2b2b] });
  }
  // motorbike + rider (Honda CD-70)
  {
    const paint = [box(0.28, 0.24, 0.55, 0, 0.78, 0.15, 0xffffff, 0.05)]; // tank / side panels
    const fixed = [
      col(new THREE.TorusGeometry(0.29, 0.05, 6, 16).rotateY(Math.PI / 2).translate(0, 0.33, 0.62), 0x111111),
      col(new THREE.TorusGeometry(0.29, 0.05, 6, 16).rotateY(Math.PI / 2).translate(0, 0.33, -0.62), 0x111111),
      box(0.12, 0.08, 1.3, 0, 0.5, 0, 0x333333), // frame
      box(0.3, 0.1, 0.62, 0, 0.9, -0.28, 0x151515), // seat
      box(0.6, 0.04, 0.04, 0, 1.08, 0.55, CHROME), // handlebar
      box(0.1, 0.5, 0.1, 0, 0.8, 0.6, 0x333333), // forks
      // rider: shalwar kameez torso, head, legs
      box(0.4, 0.55, 0.26, 0, 1.3, -0.2, 0xd9d2c3, 0.08),
      col(new THREE.SphereGeometry(0.12, 10, 8).translate(0, 1.7, -0.16), 0x7a5a45),
      col(new THREE.SphereGeometry(0.125, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.72, -0.16), 0x1a1a1a),
      box(0.12, 0.12, 0.5, 0.14, 0.95, 0.05, 0xd9d2c3),
      box(0.12, 0.12, 0.5, -0.14, 0.95, 0.05, 0xd9d2c3),
      box(0.1, 0.45, 0.12, 0.2, 0.62, 0.3, 0xd9d2c3),
      box(0.1, 0.45, 0.12, -0.2, 0.62, 0.3, 0xd9d2c3),
      box(0.1, 0.1, 0.45, 0.2, 1.3, 0.12, 0xd9d2c3),
      box(0.1, 0.1, 0.45, -0.2, 1.3, 0.12, 0xd9d2c3),
    ];
    const lights = [col(new THREE.CircleGeometry(0.07, 10).translate(0, 0.98, 0.72), 0xfff4d6), box(0.1, 0.06, 0.02, 0, 0.82, -0.66, 0xff1a0a)];
    models.push({ kind: 'bike', paint: merge(paint), fixed: merge(fixed), lights: merge(lights), massFactor: 0.25, length: 1.95, width: 0.75, height: 1.8, speedFactor: 0.85, palette: [0xb3121b, 0xb3121b, 0xb3121b, 0x1a1a1a, 0x1f3f7a] });
  }
  // Suzuki pickup (Ravi / Bolan)
  {
    const L = 3.4, W = 1.42;
    const paint = [box(W, 1.0, 1.25, 0, 1.05, 1.0, 0xffffff, 0.06), box(W, 0.35, 2.1, 0, 0.72, -0.6, 0xffffff, 0.03)];
    const fixed = [
      box(W * 0.95, 0.42, 0.03, 0, 1.3, 1.63, GLASS),
      box(W * 0.02 + 0.01, 0.4, 0.9, W / 2, 1.3, 1.05, GLASS),
      box(W * 0.02 + 0.01, 0.4, 0.9, -W / 2, 1.3, 1.05, GLASS),
      box(W, 0.35, 0.05, 0, 1.05, -1.64, 0x777777),
      box(0.05, 0.35, 2.1, W / 2 - 0.02, 1.05, -0.6, 0x777777),
      box(0.05, 0.35, 2.1, -W / 2 + 0.02, 1.05, -0.6, 0x777777),
      box(W * 1.02, 0.1, 0.1, 0, 0.45, 1.68, TRIM),
      wheel(0.26, 0.16, 0.6, 1.05), wheel(0.26, 0.16, -0.6, 1.05), wheel(0.26, 0.16, 0.6, -1.1), wheel(0.26, 0.16, -0.6, -1.1),
    ];
    const lights = [box(0.2, 0.14, 0.02, 0.5, 0.75, 1.64, 0xfff4d6), box(0.2, 0.14, 0.02, -0.5, 0.75, 1.64, 0xfff4d6), box(0.14, 0.18, 0.02, 0.6, 0.7, -1.67, 0xff1a0a), box(0.14, 0.18, 0.02, -0.6, 0.7, -1.67, 0xff1a0a)];
    models.push({ kind: 'pickup', paint: merge(paint), fixed: merge(fixed), lights: merge(lights), massFactor: 1.15, length: L, width: W, height: 1.8, speedFactor: 0.85, palette: [0xf2f2f0, 0x1a1a1c, 0x8a1c1c, 0x4a5058, 0x2b4a7a, 0xdcdcdc] });
  }
  for (const m of models) for (const g of [m.paint, m.fixed, m.lights]) g.computeVertexNormals();
  return models;
}

/** Relative spawn weights reflecting Lahore's traffic mix. */
export const KIND_WEIGHTS: Record<VehicleKind, number> = { sedan: 0.42, hatch: 0.2, rickshaw: 0, bike: 0.07, pickup: 0.14 };
