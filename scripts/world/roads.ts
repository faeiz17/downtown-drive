// Road network: filter OSM highways, split into a graph, chain into render strokes, detect medians/roundabouts/signals.
import type { GraphNode, Island, MedianStrip, RoadClass, RoadEdge, Stroke } from '../../src/data/types';
import { ROAD_CLASSES, classifyHighway, isMajor } from '../../src/data/roadClasses';
import {
  SpatialGrid, cumulative, sampleAt, projectPointSeg, segIntersect, leftNormal, polylineLength, simplify,
} from '../../src/core/geom2d';
import { inExtent, displayName, type ParsedOsm } from './osm';

const DROP_SERVICE = new Set(['driveway', 'parking_aisle', 'drive-through', 'parking', 'parking_access', 'emergency_access']);

export interface RoadNetwork {
  nodes: GraphNode[];
  edges: RoadEdge[];
  strokes: Stroke[];
  medians: MedianStrip[];
  islands: Island[];
  segGrid: SpatialGrid<{ edge: number; i: number }>;
  dropped: Record<string, number>;
}

interface SubWay {
  nodes: number[];
  tags: Record<string, string>;
  cls: RoadClass;
}

export function buildRoads(osm: ParsedOsm, waterLines: number[][]): RoadNetwork {
  const dropped: Record<string, number> = {};
  const drop = (why: string) => (dropped[why] = (dropped[why] ?? 0) + 1);

  // --- 1. filter + clip -------------------------------------------------------------------------
  const subs: SubWay[] = [];
  for (const w of osm.ways) {
    const t = w.tags;
    if (!t.highway) continue;
    const cls = classifyHighway(t.highway);
    if (!cls) {
      drop('class:' + t.highway);
      continue;
    }
    if (t.area === 'yes') {
      drop('area');
      continue;
    }
    if (t.highway === 'service' && t.service && DROP_SERVICE.has(t.service)) {
      drop('service:' + t.service);
      continue;
    }
    const isBridge = !!t.bridge && t.bridge !== 'no';
    const isTunnel = !!t.tunnel && t.tunnel !== 'no';
    const layered = !!t.layer && t.layer !== '0';
    if (isTunnel) {
      drop('tunnel');
      continue;
    }
    if (isBridge || layered) {
      // Bridges over the canal/drains are effectively at grade and keep the network connected; flyovers over roads are dropped.
      const overWater = isBridge && crossesWater(w.pts, waterLines);
      if (!overWater) {
        drop(isBridge ? 'flyover' : 'layer');
        continue;
      }
    }
    // clip to extent (+margin), splitting at runs outside
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 2) subs.push({ nodes: run, tags: t, cls });
      run = [];
    };
    for (const nid of w.nodes) {
      const c = osm.coord.get(nid)!;
      if (inExtent(c[0], c[1], 60)) run.push(nid);
      else flush();
    }
    flush();
  }

  // --- 2. graph ---------------------------------------------------------------------------------
  const usage = new Map<number, number>();
  for (const s of subs) {
    for (const n of s.nodes) usage.set(n, (usage.get(n) ?? 0) + 1);
    usage.set(s.nodes[0], (usage.get(s.nodes[0]) ?? 0) + 1);
    usage.set(s.nodes[s.nodes.length - 1], (usage.get(s.nodes[s.nodes.length - 1]) ?? 0) + 1);
  }
  const nodeIndex = new Map<number, number>();
  const nodes: GraphNode[] = [];
  const gnode = (osmId: number) => {
    let i = nodeIndex.get(osmId);
    if (i === undefined) {
      const c = osm.coord.get(osmId)!;
      i = nodes.length;
      nodes.push({ x: round1(c[0]), z: round1(c[1]), edges: [], r: 0 });
      nodeIndex.set(osmId, i);
    }
    return i;
  };

  const edges: RoadEdge[] = [];
  for (const s of subs) {
    const t = s.tags;
    let ids = s.nodes;
    let oneway = ['yes', 'true', '1'].includes(t.oneway ?? '') || t.junction === 'roundabout' || t.junction === 'circular';
    if (t.oneway === '-1') {
      ids = ids.slice().reverse();
      oneway = true;
    }
    const info = ROAD_CLASSES[s.cls];
    let lanes = parseInt(t.lanes ?? '', 10);
    if (!isFinite(lanes) || lanes < 1 || lanes > 8) lanes = oneway ? info.lanesOneWay : info.lanesTwoWay;
    let lanesF: number, lanesB: number;
    if (oneway) {
      lanesF = lanes;
      lanesB = 0;
    } else {
      const lf = parseInt(t['lanes:forward'] ?? '', 10);
      const lb = parseInt(t['lanes:backward'] ?? '', 10);
      if (isFinite(lf) && isFinite(lb) && lf > 0 && lb > 0) {
        lanesF = lf;
        lanesB = lb;
      } else {
        lanesF = Math.max(1, Math.ceil(lanes / 2));
        lanesB = Math.max(1, Math.floor(lanes / 2));
      }
    }
    const tagWidth = parseFloat(t.width ?? '');
    let width = isFinite(tagWidth) && tagWidth >= 3 && tagWidth <= 40 ? tagWidth : (lanesF + lanesB) * info.laneWidth + (isMajor(s.cls) ? 0.6 : 0.2);
    if (s.cls === 'link') width = Math.max(width, oneway ? 5.5 : 7);
    if (s.cls === 'service') width = Math.max(width, oneway ? 3.6 : 4.6);
    if (s.cls === 'residential') width = Math.max(width, oneway ? 4.5 : 6.0);
    const maxspeed = parseInt(t.maxspeed ?? '', 10);
    const speed = isFinite(maxspeed) && maxspeed >= 20 && maxspeed <= 120 ? maxspeed : info.speed;
    const name = displayName(t);

    // split at junction nodes
    let start = 0;
    for (let i = 1; i < ids.length; i++) {
      const u = usage.get(ids[i]) ?? 1;
      if (u >= 2 || i === ids.length - 1) {
        const seg = ids.slice(start, i + 1);
        start = i;
        const pts: number[] = [];
        for (const nid of seg) {
          const c = osm.coord.get(nid)!;
          pts.push(round1(c[0]), round1(c[1]));
        }
        const clean = simplify(pts, 0.15);
        if (polylineLength(clean) < 0.5) continue;
        const a = gnode(seg[0]);
        const b = gnode(seg[seg.length - 1]);
        if (a === b && clean.length <= 4) continue;
        const e: RoadEdge = {
          id: edges.length,
          a,
          b,
          pts: clean,
          name,
          cls: s.cls,
          width: round1(width),
          lanesF,
          lanesB,
          oneway,
          speed,
          stroke: -1,
          sidewalk: info.sidewalk,
        };
        if (t.junction === 'roundabout' || t.junction === 'circular') e.roundabout = true;
        edges.push(e);
        nodes[a].edges.push(e.id);
        nodes[b].edges.push(e.id);
      }
    }
  }

  // junction radii
  for (const n of nodes) {
    if (n.edges.length >= 3) {
      let r = 0;
      for (const ei of n.edges) r = Math.max(r, edges[ei].width / 2);
      n.r = round1(Math.min(18, Math.max(3, r + 1.2)));
    }
  }

  // --- 3. strokes -------------------------------------------------------------------------------
  const strokes: Stroke[] = [];
  const compatible = (e1: RoadEdge, e2: RoadEdge) =>
    e1.cls === e2.cls && Math.abs(e1.width - e2.width) < 1.6 && e1.oneway === e2.oneway && !!e1.roundabout === !!e2.roundabout && (e1.name ?? '') === (e2.name ?? '');
  const visited = new Uint8Array(edges.length);
  for (const e0 of edges) {
    if (visited[e0.id]) continue;
    visited[e0.id] = 1;
    // chain holds [edgeId, reversed]
    const chain: [number, boolean][] = [[e0.id, false]];
    // extend forward from e0.b
    const extend = (forward: boolean) => {
      let cur: RoadEdge = e0;
      let curRev = false;
      for (let guard = 0; guard < 10000; guard++) {
        const endNode: number = forward ? (curRev ? cur.a : cur.b) : curRev ? cur.b : cur.a;
        const n: GraphNode = nodes[endNode];
        if (n.edges.length !== 2) return;
        const nextId: number = n.edges[0] === cur.id ? n.edges[1] : n.edges[0];
        if (nextId === cur.id || visited[nextId]) return;
        const nxt: RoadEdge = edges[nextId];
        if (!compatible(cur, nxt)) return;
        // orientation so that chain continues through endNode
        const nxtRev: boolean = forward ? nxt.b === endNode && nxt.a !== endNode : nxt.a === endNode && nxt.b !== endNode;
        if (nxt.oneway && nxtRev) return; // would reverse a oneway
        visited[nextId] = 1;
        if (forward) chain.push([nextId, nxtRev]);
        else chain.unshift([nextId, nxtRev]);
        cur = nxt;
        curRev = nxtRev;
      }
    };
    extend(true);
    extend(false);

    const pts: number[] = [];
    for (const [ei, rev] of chain) {
      const p = edges[ei].pts;
      const seq: number[] = [];
      if (!rev) seq.push(...p);
      else for (let i = p.length - 2; i >= 0; i -= 2) seq.push(p[i], p[i + 1]);
      if (pts.length) seq.splice(0, 2);
      pts.push(...seq);
    }
    const first = edges[chain[0][0]];
    const last = edges[chain[chain.length - 1][0]];
    const startNode = chain[0][1] ? first.b : first.a;
    const endNode = chain[chain.length - 1][1] ? last.a : last.b;
    const closed = startNode === endNode && chain.length > 1;
    const st: Stroke = {
      id: strokes.length,
      edges: chain.map((c) => c[0]),
      pts,
      cls: e0.cls,
      width: e0.width,
      sidewalk: e0.sidewalk,
      oneway: e0.oneway,
      lanes: e0.lanesF + e0.lanesB,
      name: e0.name,
      closed,
      trimStart: closed ? 0 : nodes[startNode].r,
      trimEnd: closed ? 0 : nodes[endNode].r,
    };
    strokes.push(st);
    for (const [ei] of chain) edges[ei].stroke = st.id;
  }

  // segment grid over edges (used for dual detection + later raster/queries)
  const segGrid = new SpatialGrid<{ edge: number; i: number }>(40);
  for (const e of edges) {
    for (let i = 0; i + 3 < e.pts.length; i += 2) {
      const ax = e.pts[i], az = e.pts[i + 1], bx = e.pts[i + 2], bz = e.pts[i + 3];
      segGrid.insert({ edge: e.id, i }, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
    }
  }

  // --- 4. dual carriageways → median strips ---------------------------------------------------
  const medians: MedianStrip[] = [];
  for (const A of strokes) {
    if (!A.oneway || !isMajor(A.cls) || A.closed) continue;
    const cum = cumulative(A.pts);
    const L = cum[cum.length - 1];
    let l: number[] = [],
      r: number[] = [],
      widths: number[] = [];
    const flush = () => {
      if (l.length >= 4) medians.push({ l, r, width: round1(widths.reduce((a, b) => a + b, 0) / widths.length) });
      l = [];
      r = [];
      widths = [];
    };
    for (let s = A.trimStart + 1; s < L - A.trimEnd - 1; s += 4) {
      const p = sampleAt(A.pts, cum, s);
      let best: { B: Stroke; x: number; z: number; d: number; vx: number; vz: number } | null = null;
      for (const cand of segGrid.queryRadius(p.x, p.z, 48)) {
        const Be = edges[cand.edge];
        const B = strokes[Be.stroke];
        if (B.id === A.id || !B.oneway || !isMajor(B.cls)) continue;
        if (A.name && B.name && A.name !== B.name) continue;
        const ax = Be.pts[cand.i], az = Be.pts[cand.i + 1], bx = Be.pts[cand.i + 2], bz = Be.pts[cand.i + 3];
        const pr = projectPointSeg(p.x, p.z, ax, az, bx, bz);
        if (pr.d < 3 || pr.d > 48) continue;
        const sl = Math.hypot(bx - ax, bz - az) || 1;
        const dot = (p.tx * (bx - ax) + p.tz * (bz - az)) / sl;
        if (dot > -0.8) continue;
        const vx = (pr.x - p.x) / pr.d, vz = (pr.z - p.z) / pr.d;
        if (Math.abs(vx * p.tx + vz * p.tz) > 0.35) continue;
        if (!best || pr.d < best.d) best = { B, x: pr.x, z: pr.z, d: pr.d, vx, vz };
      }
      if (!best || best.B.id < A.id) {
        if (best && best.B.id < A.id) {
          // still mark dual on A so sidewalks/lamps are placed right; the strip itself comes from B's pass
          markDual(A, best.vx, best.vz, p.tx, p.tz);
        }
        flush();
        continue;
      }
      const mw = best.d - A.width / 2 - best.B.width / 2;
      if (mw < 0.6) {
        flush();
        continue;
      }
      const lx = p.x + best.vx * (A.width / 2), lz = p.z + best.vz * (A.width / 2);
      const rx = best.x - best.vx * (best.B.width / 2), rz = best.z - best.vz * (best.B.width / 2);
      // any other road crossing between the two carriageways? → break the median (junction gap)
      let crossed = false;
      for (const c2 of segGrid.query(Math.min(lx, rx) - 1, Math.min(lz, rz) - 1, Math.max(lx, rx) + 1, Math.max(lz, rz) + 1)) {
        const e2 = edges[c2.edge];
        if (e2.stroke === A.id || e2.stroke === best.B.id) continue;
        if (segIntersect(p.x, p.z, best.x, best.z, e2.pts[c2.i], e2.pts[c2.i + 1], e2.pts[c2.i + 2], e2.pts[c2.i + 3])) {
          crossed = true;
          break;
        }
      }
      if (crossed) {
        flush();
        continue;
      }
      // also break near junction nodes of the carriageways themselves
      markDual(A, best.vx, best.vz, p.tx, p.tz);
      const bs = best.B;
      const bdx = -p.tx, bdz = -p.tz; // B runs opposite
      markDual(bs, -best.vx, -best.vz, bdx, bdz);
      l.push(round1(lx), round1(lz));
      r.push(round1(rx), round1(rz));
      widths.push(mw);
    }
    flush();
  }
  // propagate dual/median-side to edges
  for (const st of strokes) {
    if (!st.dual) continue;
    for (const ei of st.edges) edges[ei].dual = true;
  }

  // raised central median on wide two-way majors
  for (const st of strokes) {
    if (st.oneway || !isMajor(st.cls) || st.dual) continue;
    if (st.lanes >= 4 || st.width >= 12) {
      st.median = st.cls === 'trunk' || st.cls === 'primary' ? 1.6 : 1.1;
      st.width = round1(st.width + st.median);
      for (const ei of st.edges) {
        edges[ei].median = st.median;
        edges[ei].width = st.width;
      }
    }
  }

  // --- 5. roundabout islands --------------------------------------------------------------------
  const islands: Island[] = [];
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const rEdges = edges.filter((e) => e.roundabout);
  for (const e of rEdges) {
    if (!parent.has(e.a)) parent.set(e.a, e.a);
    if (!parent.has(e.b)) parent.set(e.b, e.b);
    parent.set(find(e.a), find(e.b));
  }
  const groups = new Map<number, RoadEdge[]>();
  for (const e of rEdges) {
    const g = find(e.a);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(e);
  }
  for (const g of groups.values()) {
    let sx = 0, sz = 0, n = 0, w = 0;
    let name: string | undefined;
    for (const e of g) {
      for (let i = 0; i < e.pts.length; i += 2) {
        sx += e.pts[i];
        sz += e.pts[i + 1];
        n++;
      }
      w += e.width;
      name = name ?? e.name;
    }
    const cx = sx / n, cz = sz / n;
    let rs = 0;
    for (const e of g) for (let i = 0; i < e.pts.length; i += 2) rs += Math.hypot(e.pts[i] - cx, e.pts[i + 1] - cz);
    const avgR = rs / n;
    const r = avgR - w / g.length / 2 - 0.4;
    // only proper loops (points spread around the centre)
    if (r > 2.5 && g.reduce((a, e) => a + polylineLength(e.pts), 0) > avgR * 4) islands.push({ x: round1(cx), z: round1(cz), r: round1(r), name });
  }

  return { nodes, edges, strokes, medians, islands, segGrid, dropped };
}

function markDual(st: Stroke, vx: number, vz: number, tx: number, tz: number) {
  st.dual = true;
  if (st.medianSide === undefined) {
    const [nx, nz] = leftNormal(tx, tz);
    st.medianSide = nx * vx + nz * vz > 0 ? 1 : -1;
  }
}

function crossesWater(pts: number[], water: number[][]): boolean {
  for (const w of water)
    for (let i = 0; i + 3 < pts.length; i += 2)
      for (let j = 0; j + 3 < w.length; j += 2)
        if (segIntersect(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], w[j], w[j + 1], w[j + 2], w[j + 3])) return true;
  return false;
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Assign traffic signal clusters to major junctions and named chowks. */
export function assignSignals(net: RoadNetwork, osm: ParsedOsm): { name: string; x: number; z: number }[] {
  const { nodes, edges } = net;
  const grid = new SpatialGrid<number>(60);
  nodes.forEach((n, i) => {
    if (n.edges.length >= 3) grid.insertPoint(i, n.x, n.z);
  });
  const nearestJunction = (x: number, z: number, maxD: number) => {
    let best = -1, bd = maxD;
    for (const i of grid.queryRadius(x, z, maxD)) {
      const d = Math.hypot(nodes[i].x - x, nodes[i].z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  const isSignal = new Uint8Array(nodes.length);
  const landmarks: { name: string; x: number; z: number }[] = [];
  for (const on of osm.nodes) {
    if (on.tags.highway === 'traffic_signals') {
      const j = nearestJunction(on.x, on.z, 30);
      if (j >= 0) isSignal[j] = 1;
    }
    const nm = displayName(on.tags) ?? '';
    const isBusiness = !!(on.tags.shop || on.tags.office || on.tags.craft || (on.tags.amenity && on.tags.amenity !== 'bus_station'));
    if (!isBusiness && (/chowk/i.test(nm) || /chowk/i.test(on.tags.name ?? ''))) {
      const j = nearestJunction(on.x, on.z, 70);
      if (j >= 0) {
        const n = nodes[j];
        const touchesRoundabout = n.edges.some((ei) => edges[ei].roundabout);
        if (!touchesRoundabout) isSignal[j] = 1;
        const clean = nm.replace(/^Kalmah/i, 'Kalma');
        if (!n.name) n.name = clean;
        if (!landmarks.some((l) => l.name === clean)) landmarks.push({ name: clean, x: on.x, z: on.z });
      }
    }
  }
  nodes.forEach((n, i) => {
    if (n.edges.length < 3) return;
    if (n.edges.some((ei) => edges[ei].roundabout)) return;
    const big = n.edges.filter((ei) => ['trunk', 'primary', 'secondary'].includes(edges[ei].cls)).length;
    const mid = n.edges.filter((ei) => isMajor(edges[ei].cls)).length;
    if (big >= 2 && mid >= 3) isSignal[i] = 1;
    else if (n.edges.length >= 4 && mid >= 4) isSignal[i] = 1;
  });
  // cluster signal nodes within 40 m (dual carriageway crossings produce 2–4 nodes per chowk)
  let cluster = 0;
  const assigned = new Int32Array(nodes.length).fill(-1);
  for (let i = 0; i < nodes.length; i++) {
    if (!isSignal[i] || assigned[i] >= 0) continue;
    const stack = [i];
    assigned[i] = cluster;
    while (stack.length) {
      const k = stack.pop()!;
      for (const j of grid.queryRadius(nodes[k].x, nodes[k].z, 40)) {
        if (!isSignal[j] || assigned[j] >= 0) continue;
        if (Math.hypot(nodes[j].x - nodes[k].x, nodes[j].z - nodes[k].z) <= 40) {
          assigned[j] = cluster;
          stack.push(j);
        }
      }
    }
    cluster++;
  }
  nodes.forEach((n, i) => {
    if (assigned[i] >= 0) n.signal = assigned[i];
  });
  return landmarks;
}
