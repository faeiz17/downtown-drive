/**
 * Stage 2/3: compile the cached OSM data into the game world (public/world/gulberg.world.json).
 * Deterministic: the same OSM cache always produces the same world.
 *
 *   npm run build:world
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN, EXTENT } from '../src/data/geo';
import type { WorldData, Shop } from '../src/data/types';
import { PLOT_STRIDE, TREE_STRIDE, LAMP_STRIDE, POLE_STRIDE, BILLBOARD_STRIDE } from '../src/data/types';
import { cumulative, sampleAt, leftNormal } from '../src/core/geom2d';
import { ROAD_CLASSES } from '../src/data/roadClasses';
import { OSM_CACHE, readOsmCache, fetchOsm } from './fetch-osm';
import { parseOsm, displayName, inExtent } from './world/osm';
import { buildRoads, assignSignals, round1 } from './world/roads';
import { buildAreas } from './world/areas';
import { buildOsmBuildings } from './world/buildings';
import { Raster, ROAD, BUILDING, AREA } from './world/raster';
import { buildPlots } from './world/infill';
import { placeBillboards, placeTrees, placeLamps, placePoles } from './world/props';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WORLD_OUT = resolve(ROOT, 'public/world/city.world.json');

export async function buildWorld(): Promise<void> {
  const t0 = Date.now();
  if (!existsSync(OSM_CACHE)) await fetchOsm();
  const cache = readOsmCache();
  const osm = parseOsm(cache.elements);
  console.log(`[build-world] parsed ${osm.ways.length} ways, ${osm.nodes.length} tagged nodes, ${osm.relations.length} relations`);

  // areas first: water lines are needed to decide which bridges to keep
  const ar = buildAreas(osm);
  const net = buildRoads(osm, ar.water.map((w) => w.pts));
  console.log(`[build-world] roads: ${net.edges.length} edges, ${net.nodes.length} nodes, ${net.strokes.length} strokes, ${net.medians.length} median strips, ${net.islands.length} roundabout islands`);
  console.log(`[build-world] dropped:`, net.dropped);
  const landmarks = assignSignals(net, osm);
  // named places for minimap / debug (Liberty Market etc.)
  for (const n of osm.nodes) {
    const nm = displayName(n.tags);
    if (!nm || !inExtent(n.x, n.z)) continue;
    if ((n.tags.place || n.tags.amenity === 'marketplace' || n.tags.shop === 'mall' || n.tags.leisure === 'stadium') && !landmarks.some((l) => l.name === nm))
      landmarks.push({ name: nm, x: round1(n.x), z: round1(n.z) });
  }
  const signalClusters = new Set(net.nodes.filter((n) => n.signal !== undefined).map((n) => n.signal)).size;

  // --- occupancy raster ------------------------------------------------------------------------
  const raster = new Raster(1);
  for (const e of net.edges) {
    const verge = e.sidewalk > 0 ? e.sidewalk : e.cls === 'service' ? 0.6 : 2.2;
    raster.stampPolyline(e.pts, e.width / 2 + verge, ROAD);
  }
  for (const m of net.medians) {
    const ring = m.l.slice();
    for (let i = m.r.length - 2; i >= 0; i -= 2) ring.push(m.r[i], m.r[i + 1]);
    raster.fillPolygon(ring, ROAD);
  }
  for (const is of net.islands) raster.stampSegment(is.x, is.z, is.x, is.z, is.r + 1, ROAD);
  for (const w of ar.water) raster.stampPolyline(w.pts, w.width / 2 + (w.kind === 'canal' ? 6 : 2), AREA);
  for (const r of ar.rail) raster.stampPolyline(r, 6, AREA);
  for (const z of ar.noBuildZones) raster.fillPolygon(z, AREA);
  for (const a of ar.areas) if (a.kind === 'parking' || a.kind === 'plaza') raster.fillPolygon(a.pts, AREA);

  const civicAreas = ar.areas.filter((a) => a.kind === 'campus' || a.kind === 'cemetery').map((a) => ({ pts: a.pts, kind: a.kind }));
  const buildings = buildOsmBuildings(osm, net.edges, net.segGrid, ar.commercialZones, civicAreas);
  for (const b of buildings) {
    raster.fillPolygon(b.pts, BUILDING);
    raster.stampPolyline(b.pts.concat(b.pts.slice(0, 2)), 1.5, BUILDING, false);
  }

  const billboards = placeBillboards(net.strokes, landmarks, raster);
  const { plots, stats: plotStats } = buildPlots(net.strokes, raster, ar.commercialZones);
  const osmTrees = osm.nodes.filter((n) => n.tags.natural === 'tree' && inExtent(n.x, n.z)).map((n) => ({ x: n.x, z: n.z }));
  const trees = placeTrees(net.strokes, net.medians, ar.areas, ar.treeRows, osmTrees, raster);
  const lamps = placeLamps(net.strokes, net.medians, net.islands, raster);
  const poles = placePoles(net.strokes, raster);

  // --- shops (real OSM names for signboards) -----------------------------------------------------
  const shops: Shop[] = [];
  for (const n of osm.nodes) {
    const t = n.tags;
    const nm = t['name:en'] || t.name;
    if (!nm || !inExtent(n.x, n.z)) continue;
    const kind = t.shop ?? (['restaurant', 'cafe', 'fast_food', 'bank', 'pharmacy', 'clinic', 'dentist', 'ice_cream', 'fuel'].includes(t.amenity ?? '') ? t.amenity : undefined) ?? t.office;
    if (!kind) continue;
    shops.push({ x: round1(n.x), z: round1(n.z), name: nm.trim().slice(0, 32), kind });
  }
  for (const w of osm.ways) {
    const t = w.tags;
    const nm = t['name:en'] || t.name;
    if (!nm || !(t.shop || ['restaurant', 'bank', 'fast_food', 'cafe'].includes(t.amenity ?? ''))) continue;
    let sx = 0, sz = 0;
    for (let i = 0; i < w.pts.length; i += 2) {
      sx += w.pts[i];
      sz += w.pts[i + 1];
    }
    const x = sx / (w.pts.length / 2), z = sz / (w.pts.length / 2);
    if (inExtent(x, z)) shops.push({ x: round1(x), z: round1(z), name: nm.trim().slice(0, 32), kind: t.shop ?? t.amenity });
  }

  // --- spawn: Main Boulevard beside Mega Tower (next to KFC Gulberg), left lane ---------------------------
  const spawn = computeSpawn(net, buildings);

  // --- validation ------------------------------------------------------------------------------------------
  const problems: string[] = [];
  if (net.edges.length < 500) problems.push('too few roads');
  if (problems.length) throw new Error('World validation failed: ' + problems.join('; '));

  const stats = {
    edges: net.edges.length,
    nodes: net.nodes.length,
    strokes: net.strokes.length,
    medianStrips: net.medians.length,
    islands: net.islands.length,
    signalClusters,
    osmBuildings: buildings.length,
    ...plotStats,
    trees: trees.length / TREE_STRIDE,
    lamps: lamps.length / LAMP_STRIDE,
    poles: poles.length / POLE_STRIDE,
    billboards: billboards.length / BILLBOARD_STRIDE,
    areas: ar.areas.length,
    water: ar.water.length,
    rail: ar.rail.length,
    shops: shops.length,
    roadKm: Math.round(net.edges.reduce((a, e) => a + cumulative(e.pts).pop()!, 0) / 100) / 10,
  };

  const world: WorldData = {
    version: 1,
    generated: new Date().toISOString(),
    osmBase: cache.osmBase,
    attribution: 'Map data © OpenStreetMap contributors, available under the Open Database License (ODbL). Buildings/props partly procedural.',
    origin: { lat: ORIGIN.lat, lon: ORIGIN.lon },
    extent: { minX: round1(EXTENT.minX), maxX: round1(EXTENT.maxX), minZ: round1(EXTENT.minZ), maxZ: round1(EXTENT.maxZ) },
    nodes: net.nodes,
    edges: net.edges,
    strokes: net.strokes,
    medians: net.medians,
    islands: net.islands,
    areas: ar.areas,
    water: ar.water,
    rail: ar.rail,
    buildings,
    plots,
    trees,
    lamps,
    poles,
    billboards,
    shops,
    landmarks,
    spawn,
    stats,
  };
  mkdirSync(dirname(WORLD_OUT), { recursive: true });
  const json = JSON.stringify(world);
  writeFileSync(WORLD_OUT, json);
  console.log(`[build-world] stats:`, stats);
  console.log(`[build-world] landmarks: ${landmarks.map((l) => l.name).join(', ')}`);
  console.log(`[build-world] spawn:`, spawn);
  console.log(`[build-world] wrote ${(json.length / 1e6).toFixed(2)} MB → ${WORLD_OUT} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  void PLOT_STRIDE;
}

function computeSpawn(net: ReturnType<typeof buildRoads>, _buildings: unknown) {
  // the longest straight two-way major street near the middle of the map, right-hand lane
  let best: { st: (typeof net.strokes)[number]; score: number } | null = null;
  for (const st of net.strokes) {
    if (!['primary', 'secondary', 'tertiary', 'trunk'].includes(st.cls) || st.pts.length < 6) continue;
    const cum = cumulative(st.pts);
    const L = cum[cum.length - 1];
    const mid = sampleAt(st.pts, cum, L / 2);
    const d = Math.hypot(mid.x, mid.z);
    const score = Math.min(L, 400) - d * 0.8;
    if (L > 160 && (!best || score > best.score)) best = { st, score };
  }
  if (!best) return { x: 0, z: 0, heading: 0 };
  const cum = cumulative(best.st.pts);
  const p = sampleAt(best.st.pts, cum, cum[cum.length - 1] * 0.3);
  const laneW = ROAD_CLASSES[best.st.cls].laneWidth;
  const off = best.st.oneway ? best.st.width / 2 - laneW / 2 - 0.3 : laneW / 2 + (best.st.median ?? 0) / 2;
  const [lx, lz] = leftNormal(p.tx, p.tz);
  return { x: round1(p.x - lx * off), z: round1(p.z - lz * off), heading: Math.round(Math.atan2(p.tx, p.tz) * 1000) / 1000 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildWorld().catch((err) => {
    console.error('[build-world] FAILED:', err);
    process.exit(1);
  });
}
