// Parse the cached Overpass JSON into projected nodes / ways / relations.
import { project, EXTENT } from '../../src/data/geo';
import { reverseRing, signedArea, type Pts } from '../../src/core/geom2d';

export interface ONode {
  id: number;
  x: number;
  z: number;
  tags: Record<string, string>;
}
export interface OWay {
  id: number;
  nodes: number[];
  pts: Pts; // projected, same order as nodes
  tags: Record<string, string>;
  closed: boolean;
}
export interface ORelation {
  id: number;
  tags: Record<string, string>;
  outers: Pts[]; // assembled closed rings (open form, CCW)
}

export interface ParsedOsm {
  nodes: ONode[]; // tagged nodes only
  ways: OWay[];
  relations: ORelation[];
  coord: Map<number, [number, number]>; // every node id seen in way geometry
}

export function parseOsm(elements: any[]): ParsedOsm {
  const nodes: ONode[] = [];
  const ways: OWay[] = [];
  const relations: ORelation[] = [];
  const coord = new Map<number, [number, number]>();

  for (const e of elements) {
    if (e.type === 'node') {
      const [x, z] = project(e.lat, e.lon);
      coord.set(e.id, [x, z]);
      if (e.tags) nodes.push({ id: e.id, x, z, tags: e.tags });
    } else if (e.type === 'way' && e.geometry) {
      const pts: Pts = [];
      for (let i = 0; i < e.geometry.length; i++) {
        const g = e.geometry[i];
        const [x, z] = project(g.lat, g.lon);
        pts.push(x, z);
        coord.set(e.nodes[i], [x, z]);
      }
      const closed = e.nodes.length > 3 && e.nodes[0] === e.nodes[e.nodes.length - 1];
      ways.push({ id: e.id, nodes: e.nodes, pts, tags: e.tags ?? {}, closed });
    }
  }
  for (const e of elements) {
    if (e.type !== 'relation' || !e.members) continue;
    const outerParts: Pts[] = [];
    for (const m of e.members) {
      if (m.type !== 'way' || !m.geometry || (m.role && m.role !== 'outer')) continue;
      const pts: Pts = [];
      for (const g of m.geometry) {
        if (!g) continue;
        const [x, z] = project(g.lat, g.lon);
        pts.push(x, z);
      }
      if (pts.length >= 4) outerParts.push(pts);
    }
    relations.push({ id: e.id, tags: e.tags ?? {}, outers: assembleRings(outerParts) });
  }
  return { nodes, ways, relations, coord };
}

/** Join open way fragments into closed rings by matching endpoints. Returns open-form CCW rings. */
export function assembleRings(parts: Pts[]): Pts[] {
  const eq = (ax: number, az: number, bx: number, bz: number) => Math.abs(ax - bx) < 0.05 && Math.abs(az - bz) < 0.05;
  const pool = parts.map((p) => p.slice());
  const rings: Pts[] = [];
  while (pool.length) {
    let cur = pool.shift()!;
    let guard = 0;
    while (!eq(cur[0], cur[1], cur[cur.length - 2], cur[cur.length - 1]) && guard++ < 1000) {
      const ex = cur[cur.length - 2],
        ez = cur[cur.length - 1];
      let found = -1,
        rev = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (eq(p[0], p[1], ex, ez)) {
          found = i;
          break;
        }
        if (eq(p[p.length - 2], p[p.length - 1], ex, ez)) {
          found = i;
          rev = true;
          break;
        }
      }
      if (found < 0) break;
      let nxt = pool.splice(found, 1)[0];
      if (rev) nxt = reverseRing(nxt);
      cur = cur.concat(nxt.slice(2));
    }
    if (eq(cur[0], cur[1], cur[cur.length - 2], cur[cur.length - 1]) && cur.length >= 8) {
      rings.push(normalizeRing(cur.slice(0, -2)));
    }
  }
  return rings;
}

/** Make a ring open-form (drop duplicated last vertex) and CCW (positive signed area). */
export function normalizeRing(r: Pts): Pts {
  let ring = r;
  const n = ring.length;
  if (n >= 4 && Math.abs(ring[0] - ring[n - 2]) < 1e-6 && Math.abs(ring[1] - ring[n - 1]) < 1e-6) ring = ring.slice(0, -2);
  if (signedArea(ring) < 0) ring = reverseRing(ring);
  return ring;
}

export function inExtent(x: number, z: number, margin = 0): boolean {
  return x >= EXTENT.minX - margin && x <= EXTENT.maxX + margin && z >= EXTENT.minZ - margin && z <= EXTENT.maxZ + margin;
}

export function displayName(tags: Record<string, string>): string | undefined {
  const en = tags['name:en'];
  const n = tags.name;
  if (en && en.trim()) return en.trim();
  if (n && n.trim()) return n.trim();
  return undefined;
}

export function parseHeight(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /([\d.]+)/.exec(v);
  if (!m) return undefined;
  const h = parseFloat(m[1]);
  if (!isFinite(h) || h <= 0) return undefined;
  if (/ft|'/.test(v)) return h * 0.3048;
  return h;
}
