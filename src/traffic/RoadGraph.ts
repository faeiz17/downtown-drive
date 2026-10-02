// Lane-level view of the compiled road network for AI traffic. Pakistan drives on the LEFT.
import type { WorldData, RoadEdge } from '../data/types';
import { ROAD_CLASSES } from '../data/roadClasses';
import { cumulative, offsetPolyline, sampleAt, SpatialGrid } from '../core/geom2d';
import { DRIVE_SIDE } from '../data/geo';
import { subPolyline } from '../world/roadGeom';

export interface Lane {
  key: string;
  edge: number;
  dir: 1 | -1; // 1 = a→b
  lane: number; // 0 = kerb-side (left) lane
  lanes: number;
  pts: number[];
  cum: number[];
  length: number;
  fromNode: number;
  toNode: number;
  speed: number; // m/s limit
}

export class RoadGraph {
  private cache = new Map<string, Lane | null>();
  readonly driveEdges: number[] = [];
  readonly edgeGrid = new SpatialGrid<number>(80);

  constructor(readonly world: WorldData) {
    world.edges.forEach((e, i) => {
      if (e.cls === 'service') return;
      this.driveEdges.push(i);
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let k = 0; k < e.pts.length; k += 2) {
        minX = Math.min(minX, e.pts[k]);
        maxX = Math.max(maxX, e.pts[k]);
        minZ = Math.min(minZ, e.pts[k + 1]);
        maxZ = Math.max(maxZ, e.pts[k + 1]);
      }
      this.edgeGrid.insert(i, minX, minZ, maxX, maxZ);
    });
  }

  lanesIn(e: RoadEdge, dir: 1 | -1): number {
    return dir === 1 ? e.lanesF : e.lanesB;
  }

  /** Lane polyline for edge/dir/lane, trimmed out of junction areas. */
  lane(edge: number, dir: 1 | -1, lane: number): Lane | null {
    const key = `${edge}:${dir}:${lane}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const e = this.world.edges[edge];
    const n = this.lanesIn(e, dir);
    if (!n || lane >= n) {
      this.cache.set(key, null);
      return null;
    }
    let pts = e.pts;
    if (dir === -1) {
      pts = [];
      for (let i = e.pts.length - 2; i >= 0; i -= 2) pts.push(e.pts[i], e.pts[i + 1]);
    }
    const lw = e.oneway ? e.width / n : Math.min(ROAD_CLASSES[e.cls].laneWidth, (e.width - (e.median ?? 0)) / (e.lanesF + e.lanesB));
    // offset to the LEFT of travel (left-hand traffic); lane 0 is the kerb lane
    const off = e.oneway ? (n / 2 - lane - 0.5) * lw : (e.median ?? 0) / 2 + lw * (n - lane - 0.5);
    const offPts = offsetPolyline(pts, off * DRIVE_SIDE);
    const cum = cumulative(offPts);
    const L = cum[cum.length - 1];
    const fromNode = dir === 1 ? e.a : e.b, toNode = dir === 1 ? e.b : e.a;
    const t0 = Math.min(L * 0.35, this.world.nodes[fromNode].r * 0.9 + 0.5);
    const t1 = Math.min(L * 0.35, this.world.nodes[toNode].r * 0.9 + 0.5);
    const sub = subPolyline(offPts, cum, t0, L - t1);
    if (sub.length < 4) {
      this.cache.set(key, null);
      return null;
    }
    const sc = cumulative(sub);
    const l: Lane = { key, edge, dir, lane, lanes: n, pts: sub, cum: sc, length: sc[sc.length - 1], fromNode, toNode, speed: (e.speed / 3.6) * 0.95 };
    this.cache.set(key, l);
    return l;
  }

  /** Lanes leaving a node (excluding the reverse of the arriving edge unless it's a dead end). */
  exits(node: number, arrivingEdge: number): { edge: number; dir: 1 | -1 }[] {
    const out: { edge: number; dir: 1 | -1 }[] = [];
    const n = this.world.nodes[node];
    for (const ei of n.edges) {
      const e = this.world.edges[ei];
      if (e.cls === 'service') continue;
      if (e.a === node && e.lanesF > 0) out.push({ edge: ei, dir: 1 });
      if (e.b === node && e.lanesB > 0) out.push({ edge: ei, dir: -1 });
    }
    const noU = out.filter((o) => o.edge !== arrivingEdge);
    return noU.length ? noU : out;
  }

  point(l: Lane, s: number) {
    return sampleAt(l.pts, l.cum, s);
  }
}
