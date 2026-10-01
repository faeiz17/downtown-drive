// Building meshes: OSM footprints and procedural plots (atlas material), signboards and billboards.
import type { Building } from '../data/types';
import { RNG, hash32 } from '../core/rng';
import { signedArea, reverseRing, centroid, pointInPolygon, bboxOf } from '../core/geom2d';
import { MeshBuilder, offsetRing, type V3 } from './meshBuilder';
import type { WorldAtlas, Cell } from './atlas';
import type { Signage } from './signage';
import type { PlotLayout } from './plots';

export interface ColliderSink {
  /** oriented boxes: cx, cy, cz, hx, hy, hz, yaw */
  boxes: number[];
  /** vertical cylinders: x, z, radius, height */
  cylinders: number[];
}

export interface BuildCtx {
  atlas: WorldAtlas;
  signage: Signage;
  b: MeshBuilder; // atlas geometry (collide list enabled)
  signs: MeshBuilder;
  ads: MeshBuilder;
  col: ColliderSink;
  /** props emitted while meshing (instanced elsewhere) */
  tanks: number[]; // x,y,z,s
  solar: number[]; // x,y,z,yaw
  lanterns: number[]; // x,y,z
}

const UP: V3 = [0, 1, 0];

export function normalize(ring: number[]): number[] {
  return signedArea(ring) < 0 ? reverseRing(ring) : ring;
}

interface ExtrudeOpts {
  facade: Cell;
  shop?: Cell;
  shopH?: number;
  roofCell: Cell;
  parapet: boolean;
  collide: boolean;
}

/** Extrude a positive-area ring to height h with facade walls, optional shopfront band, parapet and flat roof. */
export function extrude(b: MeshBuilder, ringIn: number[], h: number, o: ExtrudeOpts): { roofY: number; inner: number[] } {
  const ring = normalize(ringIn);
  const n = ring.length / 2;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2], az = ring[i * 2 + 1];
    const bx = ring[((i + 1) % n) * 2], bz = ring[((i + 1) % n) * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const nx = (bz - az) / L, nz = -(bx - ax) / L; // outward (left normal of CCW ring)
    if (o.shop && o.shopH && h > o.shopH + 0.5) {
      b.wall(ax, az, bx, bz, 0, o.shopH, o.shop, nx, nz, u, 0, o.collide);
      b.wall(ax, az, bx, bz, o.shopH, h, o.facade, nx, nz, u, o.shopH, o.collide);
    } else b.wall(ax, az, bx, bz, 0, h, o.facade, nx, nz, u, 0, o.collide);
    u += L;
  }
  const area = signedArea(ring);
  let roofY = h;
  let inner = ring;
  if (o.parapet && n <= 28 && area > 25) {
    const cand = offsetRing(ring, -0.25);
    const ca = signedArea(cand);
    if (ca > 0 && ca < area) {
      inner = cand;
      roofY = h - 0.7;
      // parapet inner faces (point inward) + cap
      let ui = 0;
      for (let i = 0; i < n; i++) {
        const ax = inner[i * 2], az = inner[i * 2 + 1];
        const bx = inner[((i + 1) % n) * 2], bz = inner[((i + 1) % n) * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.05) continue;
        const nx = -(bz - az) / L, nz = (bx - ax) / L;
        b.wall(ax, az, bx, bz, roofY, h, o.roofCell, nx, nz, ui, roofY);
        ui += L;
        const oax = ring[i * 2], oaz = ring[i * 2 + 1], obx = ring[((i + 1) % n) * 2], obz = ring[((i + 1) % n) * 2 + 1];
        b.quad([oax, h, oaz], [obx, h, obz], [bx, h, bz], [ax, h, az], [[0, 0], [L / 2, 0], [L / 2, 0.1], [0, 0.1]], o.roofCell, UP);
      }
    }
  }
  b.polygon(inner, roofY, o.roofCell, true);
  return { roofY, inner };
}

/** Random points inside a polygon (for roof tanks etc.). */
function pointsIn(ring: number[], count: number, rng: RNG, margin = 1): [number, number][] {
  const bb = bboxOf(ring);
  const out: [number, number][] = [];
  for (let t = 0; t < count * 12 && out.length < count; t++) {
    const x = rng.range(bb.minX + margin, bb.maxX - margin), z = rng.range(bb.minZ + margin, bb.maxZ - margin);
    if (pointInPolygon(x, z, ring)) out.push([x, z]);
  }
  return out;
}

export function emitOsmBuilding(ctx: BuildCtx, bld: Building, shopName: string | undefined, facing: { nx: number; nz: number } | null): void {
  const { atlas, b } = ctx;
  const rng = new RNG(hash32('bmesh', bld.id));
  const ring = normalize(bld.pts);
  const t = rng.range(0.85, 1.06);
  b.setTint(t, t * rng.range(0.97, 1.02), t * rng.range(0.94, 1.0));
  const roofCell = atlas.cell('roof');
  switch (bld.kind) {
    case 'canopy': {
      const y = Math.max(4.2, Math.min(bld.h, 6));
      const light = atlas.cell('pillar_light');
      const metal = atlas.cell('plaster_plain');
      // slab: top, lit underside, edges
      b.polygon(ring, y, metal, true);
      b.polygon(ring, y - 0.5, light, false);
      const n = ring.length / 2;
      for (let i = 0; i < n; i++) {
        const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[((i + 1) % n) * 2], bz = ring[((i + 1) % n) * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        b.wall(ax, az, bx, bz, y - 0.5, y, atlas.cell('curb_white'), (bz - az) / L, -(bx - ax) / L);
      }
      const [cx, cz] = centroid(ring);
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 4))) {
        const px = ring[i * 2] + (cx - ring[i * 2]) * 0.2, pz = ring[i * 2 + 1] + (cz - ring[i * 2 + 1]) * 0.2;
        b.box(px, pz, 0, 0.45, 0.45, y - 0.5, 0, metal, metal, true);
        ctx.col.cylinders.push(px, pz, 0.3, y);
      }
      break;
    }
    case 'religious': {
      const { roofY, inner } = extrude(b, ring, bld.h, { facade: atlas.cell('res_white'), roofCell, parapet: true, collide: true });
      const [cx, cz] = centroid(inner);
      const bb = bboxOf(inner);
      const r = Math.max(2, Math.min(bb.maxX - bb.minX, bb.maxZ - bb.minZ) * 0.32);
      emitDome(b, cx, roofY, cz, r, atlas.cell('dome_white'));
      // minaret at the first vertex
      const mx = ring[0] + (cx - ring[0]) * 0.08, mz = ring[1] + (cz - ring[1]) * 0.08;
      emitMinaret(b, mx, mz, bld.h + 9, atlas.cell('dome_white'));
      ctx.col.cylinders.push(mx, mz, 1.0, bld.h + 9);
      break;
    }
    default: {
      let facade: Cell;
      let shop: Cell | undefined;
      if (bld.kind === 'commercial') {
        facade = atlas.cell(rng.pick(atlas.facadeCommercial));
        if (bld.levels >= 2) shop = atlas.cell(rng.pick(atlas.shopfronts));
      } else if (bld.kind === 'residential') facade = atlas.cell(rng.pick(atlas.facadeResidential));
      else if (bld.kind === 'civic') facade = atlas.cell(rng.pick(['com_plaster_cream', 'res_white', 'com_brick', 'res_brick']));
      else if (bld.kind === 'industrial') facade = atlas.cell('com_panel_grey');
      else facade = atlas.cell('concrete'); // stadium stands
      const { roofY, inner } = extrude(b, ring, bld.h, { facade, shop, shopH: 4.4, roofCell, parapet: bld.kind !== 'stadium', collide: true });
      const area = signedArea(inner);
      const nt = Math.min(6, 1 + Math.floor(area / 250));
      for (const [x, z] of pointsIn(inner, nt, rng, 1.5)) ctx.tanks.push(x, roofY, z, rng.range(0.9, 1.4));
      if (bld.kind === 'commercial' && area > 150 && rng.chance(0.35)) {
        const [x, z] = pointsIn(inner, 1, rng, 3)[0] ?? [NaN, NaN];
        if (!isNaN(x)) ctx.solar.push(x, roofY, z, rng.range(0, Math.PI));
      }
      if (bld.kind === 'commercial' && facing) emitSignOnRing(ctx, ring, bld.h, bld.levels, shopName, bld.id, facing);
      break;
    }
  }
  b.setTint(1, 1, 1);
}

function emitSignOnRing(ctx: BuildCtx, ring: number[], h: number, levels: number, name: string | undefined, seed: number, facing: { nx: number; nz: number }) {
  const n = ring.length / 2;
  let best = -1, bestScore = 0;
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[((i + 1) % n) * 2], bz = ring[((i + 1) % n) * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 4) continue;
    const nx = (bz - az) / L, nz = -(bx - ax) / L;
    const dot = nx * facing.nx + nz * facing.nz;
    const score = dot > 0.6 ? L * dot : 0;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return;
  const ax = ring[best * 2], az = ring[best * 2 + 1], bx = ring[((best + 1) % n) * 2], bz = ring[((best + 1) % n) * 2 + 1];
  const y0 = levels >= 2 ? 4.5 : Math.max(2.6, h - 1.4);
  emitSign(ctx, ax, az, bx, bz, y0, name, seed);
}

/** Signboard across the wall segment a→b (outward = left normal), text from the sign atlas. */
export function emitSign(ctx: BuildCtx, ax: number, az: number, bx: number, bz: number, y0: number, name: string | undefined, seed: number): void {
  const L = Math.hypot(bx - ax, bz - az);
  const w = Math.min(L * 0.86, 16);
  const h = Math.min(1.3, Math.max(0.9, w / 8));
  const tx = (bx - ax) / L, tz = (bz - az) / L;
  const nx = tz, nz = -tx;
  const mx = (ax + bx) / 2 + nx * 0.18, mz = (az + bz) / 2 + nz * 0.18;
  const yaw = Math.atan2(nx, nz);
  ctx.b.box(mx, mz, y0, w + 0.1, 0.3, h + 0.1, yaw, ctx.atlas.cell('metal_dark'));
  const idx = ctx.signage.signFor(name, seed);
  const [u0, v0, u1, v1] = ctx.signage.signUv(idx);
  const fx = mx + nx * 0.16, fz = mz + nz * 0.16;
  // sign face: from viewer's left (b side) to right (a side) when looking at the wall from outside
  const lx = fx + tx * (w / 2), lz = fz + tz * (w / 2); // b side (viewer's left)
  const rx = fx - tx * (w / 2), rz = fz - tz * (w / 2);
  ctx.signs.quad([lx, y0 + 0.05, lz], [rx, y0 + 0.05, rz], [rx, y0 + h + 0.05, rz], [lx, y0 + h + 0.05, lz], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], dummyCell, [nx, 0, nz]);
}

const dummyCell: Cell = { u0: 0, v0: 0, du: 1, dv: 1, sx: 1, sy: 1 };

function emitDome(b: MeshBuilder, cx: number, y: number, cz: number, r: number, cell: Cell) {
  const lat = 6, lon = 20;
  const P = (i: number, j: number): V3 => {
    const th = (i / lat) * (Math.PI / 2), ph = (j / lon) * Math.PI * 2;
    return [cx + Math.cos(th) * Math.cos(ph) * r, y + 0.6 + Math.sin(th) * r * 1.1, cz + Math.cos(th) * Math.sin(ph) * r];
  };
  for (let i = 0; i < lat; i++)
    for (let j = 0; j < lon; j++) {
      const a = P(i, j), bb = P(i, j + 1), c = P(i + 1, j + 1), d = P(i + 1, j);
      const mid: V3 = [(a[0] + c[0]) / 2 - cx, (a[1] + c[1]) / 2 - y, (a[2] + c[2]) / 2 - cz];
      b.quad(a, bb, c, d, [[j / 4, i / 3], [(j + 1) / 4, i / 3], [(j + 1) / 4, (i + 1) / 3], [j / 4, (i + 1) / 3]], cell, mid);
    }
  // drum
  for (let j = 0; j < lon; j++) {
    const a0 = (j / lon) * Math.PI * 2, a1 = ((j + 1) / lon) * Math.PI * 2;
    b.wall(cx + Math.cos(a0) * r, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, cz + Math.sin(a1) * r, y, y + 0.6, cell, Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2));
  }
}

function emitMinaret(b: MeshBuilder, x: number, z: number, h: number, cell: Cell) {
  const seg = 8, r = 0.9;
  for (let j = 0; j < seg; j++) {
    const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
    b.wall(x + Math.cos(a0) * r, z + Math.sin(a0) * r, x + Math.cos(a1) * r, z + Math.sin(a1) * r, 0, h, cell, Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), j * 0.7);
    // balcony ring
    b.wall(x + Math.cos(a0) * (r + 0.5), z + Math.sin(a0) * (r + 0.5), x + Math.cos(a1) * (r + 0.5), z + Math.sin(a1) * (r + 0.5), h * 0.72, h * 0.72 + 0.8, cell, Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2));
    // cone cap
    b.tri([x + Math.cos(a0) * r, h, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, h, z + Math.sin(a1) * r], [x, h + 2.5, z], [[0, 0], [1, 0], [0.5, 1]], cell, [Math.cos((a0 + a1) / 2), 0.4, Math.sin((a0 + a1) / 2)]);
  }
}

function emitHipRoof(b: MeshBuilder, ring: number[], y: number, cell: Cell) {
  if (ring.length !== 8) return;
  const p = [0, 1, 2, 3].map((i) => [ring[i * 2], ring[i * 2 + 1]] as [number, number]);
  const e01 = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
  const e12 = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
  // long axis along p0→p1 if e01 ≥ e12
  const q = e01 >= e12 ? p : [p[1], p[2], p[3], p[0]];
  const lng = Math.max(e01, e12), sht = Math.min(e01, e12);
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cz = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  const ax = (q[1][0] - q[0][0]) / lng, az = (q[1][1] - q[0][1]) / lng;
  const half = (lng - sht) / 2;
  const hr = sht * 0.32;
  const r0: V3 = [cx - ax * half, y + hr, cz - az * half], r1: V3 = [cx + ax * half, y + hr, cz + az * half];
  const eave = 0.4;
  const E = q.map(([x, z]) => {
    const dx = x - cx, dz = z - cz, L = Math.hypot(dx, dz) || 1;
    return [x + (dx / L) * eave, y - 0.15, z + (dz / L) * eave] as V3;
  });
  const out = (a: V3, c: V3): V3 => [(a[0] + c[0]) / 2 - cx, 1, (a[2] + c[2]) / 2 - cz];
  b.quad(E[0], E[1], r1, r0, [[0, 0], [lng / cell.sx, 0], [(lng - half) / cell.sx, hr / cell.sy * 1.6], [half / cell.sx, hr / cell.sy * 1.6]], cell, out(E[0], E[1]));
  b.quad(E[2], E[3], r0, r1, [[0, 0], [lng / cell.sx, 0], [(lng - half) / cell.sx, hr / cell.sy * 1.6], [half / cell.sx, hr / cell.sy * 1.6]], cell, out(E[2], E[3]));
  b.tri(E[1], E[2], r1, [[0, 0], [sht / cell.sx, 0], [sht / 2 / cell.sx, hr / cell.sy * 1.6]], cell, out(E[1], E[2]));
  b.tri(E[3], E[0], r0, [[0, 0], [sht / cell.sx, 0], [sht / 2 / cell.sx, hr / cell.sy * 1.6]], cell, out(E[3], E[0]));
}

export function emitPlot(ctx: BuildCtx, L: PlotLayout, shopName: string | undefined): void {
  const { atlas, b } = ctx;
  b.setTint(L.tint[0], L.tint[1], L.tint[2]);
  const roofCell = atlas.cell('roof');
  if (L.commercial) {
    const facade = atlas.cell(atlas.facadeCommercial[L.facade % atlas.facadeCommercial.length]);
    const shop = atlas.cell(atlas.shopfronts[L.seed % atlas.shopfronts.length]);
    extrude(b, L.ring, L.height, { facade, shop, shopH: 4.4, roofCell, parapet: true, collide: true });
    const [ax, az, bx, bz] = L.front;
    emitSign(ctx, ax, az, bx, bz, 4.55, shopName, L.seed);
  } else {
    const facade = atlas.cell(atlas.facadeResidential[L.facade % atlas.facadeResidential.length]);
    if (L.roof === 'hip') {
      const ring = normalize(L.ring);
      extrude(b, ring, L.height - 0.6, { facade, roofCell, parapet: false, collide: true });
      emitHipRoof(b, ring, L.height - 0.6, atlas.cell(L.roofTile ? 'tile_green' : 'tile_terracotta'));
    } else {
      extrude(b, L.ring, L.height, { facade, roofCell, parapet: true, collide: true });
    }
    if (L.mumty) b.box(L.mumty.x, L.mumty.z, L.height - 0.6, 3.2, 3.2, 2.9, L.mumty.yaw, facade, roofCell, false);
    if (L.porch) {
      b.polygon(normalize(L.porch.ring), L.porch.y, atlas.cell('plaster_plain'), true);
      b.polygon(normalize(L.porch.ring), L.porch.y - 0.25, atlas.cell('plaster_plain'), false);
      for (const p of L.porch.pillars) b.box(p.x, p.z, 0, 0.35, 0.35, L.porch.y - 0.25, L.angle, atlas.cell('plaster_plain'));
    }
    // boundary walls + gate + pillars with lanterns
    const wallCell = atlas.cell(atlas.wallStyles[L.wallStyle % atlas.wallStyles.length]);
    for (const [ax, az, bx, bz] of L.walls) {
      b.segmentBox(ax, az, bx, bz, 0.22, 0, L.wallH, wallCell, wallCell, false);
      const len = Math.hypot(bx - ax, bz - az);
      if (len > 0.1) ctx.col.boxes.push((ax + bx) / 2, L.wallH / 2, (az + bz) / 2, 0.11, L.wallH / 2, len / 2, Math.atan2(bx - ax, bz - az));
    }
    if (L.gate) {
      const g = L.gate;
      const gateCell = atlas.cell(atlas.gates[g.style % atlas.gates.length]);
      // gate leaves (thin box): local X along frontage
      b.box(g.x, g.z, 0.05, g.w, 0.08, 2.35, g.yaw, gateCell, atlas.cell('metal_dark'));
      ctx.col.boxes.push(g.x, 1.2, g.z, g.w / 2, 1.2, 0.06, g.yaw);
    }
    for (const p of L.pillars) {
      b.box(p.x, p.z, 0, 0.6, 0.6, L.wallH + 0.45, L.angle, wallCell, wallCell);
      ctx.lanterns.push(p.x, L.wallH + 0.45, p.z);
      ctx.col.cylinders.push(p.x, p.z, 0.35, L.wallH + 0.5);
    }
  }
  // ground: lawn + paving
  if (L.lawn) b.polygon(normalize(L.lawn), 0.03, atlas.cell('grass_lawn'), true);
  if (L.paving) b.polygon(normalize(L.paving), 0.035, atlas.cell(L.pavingKind), true);
  for (const t of L.tanks) ctx.tanks.push(t.x, t.y, t.z, t.s);
  for (const s of L.solar) ctx.solar.push(s.x, s.y, s.z, s.yaw);
  b.setTint(1, 1, 1);
}

/** Unipole billboard: steel post + board with advert on both faces. */
export function emitBillboard(ctx: BuildCtx, x: number, z: number, yaw: number, ad: number): void {
  const { b, ads, atlas } = ctx;
  const metal = atlas.cell('metal_dark');
  const postH = 8.5, bw = 11, bh = 5.2;
  b.box(x, z, 0, 0.7, 0.7, postH + 0.4, yaw, metal);
  b.box(x, z, postH, bw + 0.4, 0.5, bh + 0.4, yaw, metal);
  ctx.col.cylinders.push(x, z, 0.5, postH);
  const [u0, v0, u1, v1] = ctx.signage.adUv(ad);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const side of [1, -1]) {
    // face normal = local ±Z
    const nx = s * side, nz = c * side;
    const fx = x + nx * 0.27, fz = z + nz * 0.27;
    // local +X in world = (c, -s)
    const ex = c * (bw / 2) * side, ez = -s * (bw / 2) * side;
    const l: V3 = [fx - ex, postH + 0.2, fz - ez], r: V3 = [fx + ex, postH + 0.2, fz + ez];
    ads.quad(l, r, [r[0], postH + 0.2 + bh, r[2]], [l[0], postH + 0.2 + bh, l[2]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], dummyCell, [nx, 0, nz]);
  }
}
